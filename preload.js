// preload.js
const { contextBridge } = require('electron');

// Expose safe APIs to your web app
contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    isPackaged: process.env.NODE_ENV === 'production',
    version: process.env.npm_package_version || '1.0.0'
});