const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ASSET_HISTORY_FOLDER_NAME = 'AssetHistory';

function normalizeAssetRelativePath(p) {
  const normalized = String(p || '').replace(/\\/g, '/');
  return normalized.replace(/^\/+/, '');
}

class AssetOperationLog {
  constructor(backupFolder, id, createdUtc) {
    this.backupFolder = backupFolder;
    this.historyFolder = path.join(backupFolder, ASSET_HISTORY_FOLDER_NAME);
    this.id = id || uuidv4();
    this.createdUtc = createdUtc || new Date().toISOString();
    this.segments = [];
  }

  ensureSegment() {
    if (this.segments.length === 0) this.segments.push({ entries: [] });
    return this.segments[this.segments.length - 1];
  }

  isEmpty() {
    return this.segments.length === 0 || this.segments.every(s => !s.entries || s.entries.length === 0);
  }

  addEntry(relativeAssetPath, beforeSourcePath, afterSourcePath) {
    if (!afterSourcePath) throw new Error('afterSourcePath missing');

    const segment = this.ensureSegment();
    const entry = {
      relativeAssetPath: normalizeAssetRelativePath(relativeAssetPath),
      beforeSnapshotPath: beforeSourcePath ? this._saveSnapshot(beforeSourcePath) : null,
      afterSnapshotPath: this._saveSnapshot(afterSourcePath)
    };
    segment.entries.push(entry);
  }

  _saveSnapshot(sourcePath) {
    fse.ensureDirSync(this.historyFolder);
    const ext = path.extname(sourcePath);
    const fileName = `${uuidv4().replace(/-/g, '')}${ext}`;
    const dest = path.join(this.historyFolder, fileName);
    fse.copyFileSync(sourcePath, dest);
    return dest;
  }

  createInverse() {
    const inv = new AssetOperationLog(this.backupFolder, uuidv4(), new Date().toISOString());
    for (const seg of this.segments) {
      const invSeg = { entries: [] };
      for (let i = (seg.entries?.length || 0) - 1; i >= 0; i--) {
        const e = seg.entries[i];
        invSeg.entries.push({
          relativeAssetPath: e.relativeAssetPath,
          beforeSnapshotPath: e.afterSnapshotPath,
          afterSnapshotPath: e.beforeSnapshotPath
        });
      }
      inv.segments.push(invSeg);
    }
    return inv;
  }

  appendLog(other) {
    for (const seg of other.segments || []) {
      this.segments.push({
        entries: (seg.entries || []).map(e => ({ ...e }))
      });
    }
  }

  apply(targetRoot, direction) {
    if (this.isEmpty()) return;
    const redo = direction === 'redo';

    const segments = redo ? this.segments : [...this.segments].reverse();
    for (const seg of segments) {
      const entries = seg.entries || [];
      const ordered = redo ? entries : [...entries].reverse();
      for (const entry of ordered) {
        this._applyEntry(entry, targetRoot, redo ? 'redo' : 'undo');
      }
    }
  }

  _applyEntry(entry, targetRoot, direction) {
    const relOs = entry.relativeAssetPath.replace(/\//g, path.sep);
    const targetPath = path.join(targetRoot, relOs);

    const isCreate = !entry.beforeSnapshotPath && entry.afterSnapshotPath;
    const isDelete = entry.beforeSnapshotPath && !entry.afterSnapshotPath;

    if (direction === 'undo') {
      if (isCreate) {
        safeDelete(targetPath);
        cleanupEmptyDirsUpwards(path.dirname(targetPath), targetRoot);
        return;
      }
      if (entry.beforeSnapshotPath) {
        copySnapshot(entry.beforeSnapshotPath, targetPath);
      }
      return;
    }

    if (isDelete) {
      safeDelete(targetPath);
      cleanupEmptyDirsUpwards(path.dirname(targetPath), targetRoot);
      return;
    }
    if (entry.afterSnapshotPath) {
      copySnapshot(entry.afterSnapshotPath, targetPath);
    }
  }

  saveToFileSync(filePath) {
    const dto = {
      id: this.id,
      createdUtc: this.createdUtc,
      segments: (this.segments || []).map(seg => ({
        entries: (seg.entries || []).map(e => ({
          relativeAssetPath: e.relativeAssetPath,
          beforeSnapshotPath: toRelative(this.backupFolder, e.beforeSnapshotPath),
          afterSnapshotPath: toRelative(this.backupFolder, e.afterSnapshotPath)
        }))
      }))
    };
    fs.writeFileSync(filePath, JSON.stringify(dto, null, 2), 'utf8');
  }

  static loadFromFileSync(filePath, backupFolder) {
    if (!fs.existsSync(filePath)) return null;
    const txt = fs.readFileSync(filePath, 'utf8');
    let dto;
    try {
      dto = JSON.parse(txt);
    } catch {
      return null;
    }
    const log = new AssetOperationLog(backupFolder, dto.id || uuidv4(), dto.createdUtc || new Date().toISOString());
    if (Array.isArray(dto.segments)) {
      for (const segDto of dto.segments) {
        const seg = { entries: [] };
        if (Array.isArray(segDto.entries)) {
          for (const eDto of segDto.entries) {
            seg.entries.push({
              relativeAssetPath: normalizeAssetRelativePath(eDto.relativeAssetPath || ''),
              beforeSnapshotPath: resolveRelative(backupFolder, eDto.beforeSnapshotPath),
              afterSnapshotPath: resolveRelative(backupFolder, eDto.afterSnapshotPath)
            });
          }
        }
        log.segments.push(seg);
      }
    }
    return log;
  }
}

function toRelative(backupFolder, p) {
  if (!p) return '';
  return path.relative(backupFolder, p);
}

function resolveRelative(backupFolder, rel) {
  if (!rel) return null;
  return path.resolve(path.join(backupFolder, rel));
}

function copySnapshot(source, target) {
  const dir = path.dirname(target);
  if (dir) fse.ensureDirSync(dir);
  fse.copyFileSync(source, target);
}

function safeDelete(p) {
  try {
    if (fs.existsSync(p)) {
      try {
        const stat = fs.statSync(p);
        fs.chmodSync(p, stat.mode | 0o200);
      } catch {}
      fs.unlinkSync(p);
    }
  } catch {}
}

function cleanupEmptyDirsUpwards(startDir, stopDir) {
  if (!startDir || !stopDir) return;
  const stop = path.resolve(stopDir);
  let dir = startDir;

  while (dir) {
    const resolved = path.resolve(dir);
    if (resolved === stop) break;
    if (!resolved.startsWith(stop + path.sep) && resolved !== stop) break;

    let entries;
    try {
      entries = fs.readdirSync(resolved);
    } catch {
      break;
    }
    if (entries.length > 0) break;

    try {
      fs.rmdirSync(resolved);
    } catch {
      break;
    }

    dir = path.dirname(resolved);
  }
}

module.exports = {
  AssetOperationLog,
  normalizeAssetRelativePath,
  ASSET_HISTORY_FOLDER_NAME,
};
