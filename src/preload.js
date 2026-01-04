const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('es2', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  getDefaultUgcRoot: () => ipcRenderer.invoke('get-default-ugc-root'),
  chooseFolder: (opts) => ipcRenderer.invoke('choose-folder', opts),
  validateDir: (dirPath) => ipcRenderer.invoke('validate-dir', dirPath),
  scanRooms: (ugcRoot) => ipcRenderer.invoke('scan-rooms', ugcRoot),
  loadRoom: (roomPath) => ipcRenderer.invoke('load-room', roomPath),
  listRestorePoints: (roomPath) => ipcRenderer.invoke('list-restore-points', roomPath),
  copySubtree: (payload) => ipcRenderer.invoke('copy-subtree', payload),
  restoreTarget: (payload) => ipcRenderer.invoke('restore-target', payload),
  confirm: (opts) => ipcRenderer.invoke('confirm', opts),
  openPath: (p) => ipcRenderer.invoke('open-path', p)
});
