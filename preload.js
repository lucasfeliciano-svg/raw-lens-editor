// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    isPackaged: process.env.NODE_ENV === 'production',
    version: process.env.npm_package_version || '1.0.0',
    getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
    selectFolder: () => ipcRenderer.invoke('select-folder')
});