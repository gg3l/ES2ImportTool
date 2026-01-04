const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const os = require('os');
const { AssetOperationLog, normalizeAssetRelativePath } = require('./assetLog');

function defaultUgcRoot() {
  return path.join(os.homedir(), 'AppData', 'LocalLow', 'Pine Studio', 'Escape Simulator 2', 'UGC');
}

function tryReadRoomNameFast(roomPath) {
  const maxBytes = 16 * 1024;
  try {
    const fd = fs.openSync(roomPath, 'r');
    const stat = fs.fstatSync(fd);
    const size = Math.min(maxBytes, Math.max(1, stat.size));
    const buf = Buffer.alloc(size);
    const read = fs.readSync(fd, buf, 0, size, 0);
    fs.closeSync(fd);
    if (read <= 0) return null;

    let text = buf.toString('utf8', 0, read);
    if (text.length > 0 && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const key = '"name"';
    let i = text.toLowerCase().indexOf(key);
    if (i < 0) return null;
    i = text.indexOf(':', i + key.length);
    if (i < 0) return null;
    i++;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length || text[i] !== '"') return null;
    i++;

    let sb = '';
    let escaped = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (escaped) {
        sb += (c === 'n') ? '\n' : (c === 'r') ? '\r' : (c === 't') ? '\t' : c;
        escaped = false;
        continue;
      }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') return sb;
      sb += c;
    }

    return null;
  } catch {
    return null;
  }
}

function scan(ugcRoot) {
  const root = ugcRoot || defaultUgcRoot();
  if (!fs.existsSync(root)) return [];

  const result = [];
  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(root, dirent.name);
    const roomPath = path.join(dir, 'Room.room');
    if (!fs.existsSync(roomPath)) continue;

    const backupDir = path.join(dir, 'Backups');
    let roomName = tryReadRoomNameFast(roomPath) || '(Unnamed room)';

    result.push({
      folderPath: dir,
      roomPath,
      backupFolderPath: backupDir,
      roomName: String(roomName).trim(),
      folderName: dirent.name
    });
  }

  result.sort((a, b) => a.roomName.localeCompare(b.roomName, undefined, { sensitivity: 'base' }));
  return result;
}

function getBackupFolderFromRoomPath(roomPath) {
  const parent = path.dirname(roomPath);
  return path.join(parent, 'Backups');
}

function tryParseRestoreIndex(fileName) {
  let name = path.basename(fileName);
  if (name.toLowerCase().endsWith('.json')) name = name.slice(0, -5);
  if (name.toLowerCase().endsWith('.assets')) name = name.slice(0, -7);

  const prefix = 'Room.roomrst';
  if (!name.toLowerCase().startsWith(prefix.toLowerCase())) return null;

  const suffix = name.slice(prefix.length);
  const digits = (suffix.match(/^\d+/) || [''])[0];
  if (!digits) return null;
  const idx = parseInt(digits, 10);
  return Number.isFinite(idx) ? idx : null;
}

function generateBackupFilePath(backupFolder) {
  fse.ensureDirSync(backupFolder);
  const prefix = 'Room.roomrst';
  let maxIndex = 0;

  for (const file of fs.readdirSync(backupFolder)) {
    if (!file.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const suffix = file.slice(prefix.length);
    const digits = (suffix.match(/^\d+/) || [''])[0];
    if (!digits) continue;
    const parsed = parseInt(digits, 10);
    if (Number.isFinite(parsed)) maxIndex = Math.max(maxIndex, parsed);
  }

  const next = maxIndex + 1;
  return path.join(backupFolder, `${prefix}${next}`);
}

function createRestorePointSync(targetRoomPath) {
  const backupFolder = getBackupFolderFromRoomPath(targetRoomPath);
  const backupPath = generateBackupFilePath(backupFolder);
  fse.ensureDirSync(path.dirname(backupPath));
  if (fs.existsSync(backupPath)) throw new Error('Restore point already exists: ' + backupPath);
  fse.copyFileSync(targetRoomPath, backupPath);
  return backupPath;
}

function listRestorePoints(roomPath) {
  const backupFolder = getBackupFolderFromRoomPath(roomPath);
  if (!fs.existsSync(backupFolder)) return [];

  const points = [];
  for (const file of fs.readdirSync(backupFolder)) {
    if (!file.toLowerCase().startsWith('room.roomrst')) continue;
    if (file.toLowerCase().endsWith('.assets.json')) continue;
    const idx = tryParseRestoreIndex(file);
    if (!idx) continue;

    const full = path.join(backupFolder, file);
    try {
      const stat = fs.statSync(full);
      points.push({
        filePath: full,
        displayName: file,
        timestamp: stat.birthtime || stat.ctime,
        index: idx
      });
    } catch {}
  }

  points.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return points;
}

function copyAssetsWithHistorySync(assetPaths, sourceRoot, targetRoot, backupFolder) {
  const missing = [];
  let copied = 0;
  const totalRequested = assetPaths ? assetPaths.length : 0;
  let log = totalRequested > 0 ? new AssetOperationLog(backupFolder) : null;

  for (const original of assetPaths || []) {
    const normalized = normalizeAssetRelativePath(original);
    const relOs = normalized.replace(/\//g, path.sep);
    const sourcePath = path.join(sourceRoot, relOs);
    const targetPath = path.join(targetRoot, relOs);

    if (!fs.existsSync(sourcePath)) {
      missing.push(normalized);
      continue;
    }

    try {
      fse.ensureDirSync(path.dirname(targetPath));
      const before = fs.existsSync(targetPath) ? targetPath : null;
      fse.copyFileSync(sourcePath, targetPath);
      copied++;
      if (log) log.addEntry(normalized, before, sourcePath);
    } catch {
      missing.push(normalized);
    }
  }

  if (log && log.isEmpty()) log = null;
  const skipped = Math.max(0, totalRequested - copied - missing.length);

  return { copied, skipped, missing, totalRequested, assetLog: log };
}

function loadAssetLogsNewerThan(backupFolder, minIndex) {
  const result = [];
  if (!fs.existsSync(backupFolder)) return result;

  for (const file of fs.readdirSync(backupFolder)) {
    if (!file.toLowerCase().endsWith('.assets.json')) continue;
    if (!file.toLowerCase().startsWith('room.roomrst')) continue;
    const idx = tryParseRestoreIndex(file);
    if (idx === null || idx <= minIndex) continue;
    const full = path.join(backupFolder, file);
    const log = AssetOperationLog.loadFromFileSync(full, backupFolder);
    if (!log || log.isEmpty()) continue;
    result.push({ index: idx, log });
  }

  result.sort((a, b) => b.index - a.index);
  return result;
}

function combineInverseLogs(logTuples) {
  let combined = null;
  for (const { log } of logTuples) {
    if (!log || log.isEmpty()) continue;
    if (!combined) combined = new AssetOperationLog(log.backupFolder);
    combined.appendLog(log.createInverse());
  }
  return combined;
}

function restoreFromPointSync(targetRoomPath, restoreFilePath) {
  if (!fs.existsSync(restoreFilePath)) throw new Error('Restore file is missing.');

  fse.copyFileSync(restoreFilePath, targetRoomPath);

  const backupFolder = getBackupFolderFromRoomPath(targetRoomPath);
  const idx = tryParseRestoreIndex(path.basename(restoreFilePath));
  const minIndex = (idx || 0) - 1;
  const logsToUndo = loadAssetLogsNewerThan(backupFolder, minIndex);
  const inverse = combineInverseLogs(logsToUndo);
  if (inverse && !inverse.isEmpty()) {
    const targetDir = path.dirname(targetRoomPath);
    inverse.apply(targetDir, 'redo');
  }
}

module.exports = {
  defaultUgcRoot,
  scan,
  listRestorePoints,
  createRestorePointSync,
  copyAssetsWithHistorySync,
  restoreFromPointSync,
  getBackupFolderFromRoomPath,
};
