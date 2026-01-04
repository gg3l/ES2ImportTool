const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');

if (process.platform === 'win32') {
  try { app.setAppUserModelId('com.gg3l.es2importtool'); } catch {}
}

const path = require('path');
const os = require('os');
const fs = require('fs');
const RoomScanner = require('./roomScanner');
const RoomDocument = require('./roomDocument');

const docCache = new Map();

function getOrLoadDoc(roomPath) {
  const key = path.resolve(roomPath);
  const cached = docCache.get(key);
  if (cached && cached.mtimeMs) {
    try {
      const stat = require('fs').statSync(key);
      if (stat.mtimeMs === cached.mtimeMs) return cached.doc;
    } catch {
      // fallthrough
    }
  }

  const doc = RoomDocument.loadSync(key);
  try {
    const stat = require('fs').statSync(key);
    docCache.set(key, { doc, mtimeMs: stat.mtimeMs });
  } catch {
    docCache.set(key, { doc, mtimeMs: 0 });
  }
  return doc;
}

function invalidateDoc(roomPath) {
  const key = path.resolve(roomPath);
  docCache.delete(key);
}

function createWindow() {
  const iconPath = process.platform === 'win32'
    ? path.join(__dirname, '..', 'assets', 'icon.ico')
    : path.join(__dirname, '..', 'assets', 'icon.png');

  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#141414',
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: true,
  });

  try {
    Menu.setApplicationMenu(null);
    win.setMenuBarVisibility(false);
  } catch {}

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-version', async () => app.getVersion());

ipcMain.handle('get-default-ugc-root', async () => {
  return RoomScanner.defaultUgcRoot();
});

ipcMain.handle('choose-folder', async (_evt, opts) => {
  const res = await dialog.showOpenDialog({
    title: opts?.title || 'Select folder',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths?.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('validate-dir', async (_evt, dirPath) => {
  if (!dirPath) return false;
  try {
    const st = fs.statSync(dirPath);
    return st.isDirectory();
  } catch {
    return false;
  }
});


ipcMain.handle('scan-rooms', async (_evt, ugcRoot) => {
  return RoomScanner.scan(ugcRoot);
});

ipcMain.handle('load-room', async (_evt, roomPath) => {
  const doc = getOrLoadDoc(roomPath);
  const roots = doc.createPropNodesSnapshot(false);
  return {
    roomPath: doc.roomPath,
    propCount: doc.propsCount(),
    roots,
  };
});

ipcMain.handle('list-restore-points', async (_evt, roomPath) => {
  return RoomScanner.listRestorePoints(roomPath);
});

ipcMain.handle('copy-subtree', async (_evt, payload) => {
  const { sourceRoomPath, targetRoomPath, sourcePropId, targetParentId } = payload;
  if (!sourceRoomPath || !targetRoomPath) throw new Error('Missing source/target room.');

  const sourceDoc = getOrLoadDoc(sourceRoomPath);
  const targetDoc = getOrLoadDoc(targetRoomPath);

  const sourceRecord = sourceDoc.getRecord(sourcePropId);
  if (!sourceRecord) throw new Error('The selected source prop no longer exists.');

  const sourceDir = path.dirname(sourceRoomPath);
  const targetDir = path.dirname(targetRoomPath);

  const backupPath = RoomScanner.createRestorePointSync(targetRoomPath);

  const insertedCount = targetDoc.insertSubtree(sourceRecord, targetParentId || 0);

  const assetPaths = sourceDoc.getAssetPathsForSubtree(sourceRecord.id);
  const backupFolder = path.dirname(backupPath);
  const assetResult = RoomScanner.copyAssetsWithHistorySync(assetPaths, sourceDir, targetDir, backupFolder);

  targetDoc.saveSync(targetRoomPath);
  invalidateDoc(targetRoomPath);

  if (assetResult.assetLog && !assetResult.assetLog.isEmpty()) {
    assetResult.assetLog.saveToFileSync(backupPath + '.assets.json');
  }

  const refreshed = getOrLoadDoc(targetRoomPath);
  return {
    insertedCount,
    assets: {
      copied: assetResult.copied,
      total: assetResult.totalRequested,
      missing: assetResult.missing,
    },
    target: {
      propCount: refreshed.propsCount(),
      roots: refreshed.createPropNodesSnapshot(false),
    },
    restorePoints: RoomScanner.listRestorePoints(targetRoomPath),
  };
});

ipcMain.handle('restore-target', async (_evt, payload) => {
  const { targetRoomPath, restoreFilePath } = payload;
  if (!targetRoomPath || !restoreFilePath) throw new Error('Missing target/restore point.');

  RoomScanner.restoreFromPointSync(targetRoomPath, restoreFilePath);
  invalidateDoc(targetRoomPath);

  const refreshed = getOrLoadDoc(targetRoomPath);
  return {
    target: {
      propCount: refreshed.propsCount(),
      roots: refreshed.createPropNodesSnapshot(false),
    },
    restorePoints: RoomScanner.listRestorePoints(targetRoomPath),
  };
});

ipcMain.handle('confirm', async (evt, opts) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  const res = await dialog.showMessageBox(win, {
    type: opts?.type || 'warning',
    title: opts?.title || 'Confirm',
    message: opts?.message || 'Are you sure?',
    detail: opts?.detail || '',
    buttons: opts?.buttons || ['Cancel', 'OK'],
    defaultId: typeof opts?.defaultId === 'number' ? opts.defaultId : 1,
    cancelId: typeof opts?.cancelId === 'number' ? opts.cancelId : 0,
    noLink: true,
  });
  const okIndex = typeof opts?.okId === 'number' ? opts.okId : 1;
  return res.response === okIndex;
});

ipcMain.handle('open-path', async (_evt, p) => {
  if (!p) return;
  await shell.openPath(p);
});