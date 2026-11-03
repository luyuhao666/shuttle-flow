'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// The renderer can manage its own room, but cannot access Node, the filesystem,
// arbitrary IPC channels, or a server belonging to another window.
contextBridge.exposeInMainWorld('shuttleDesktop', Object.freeze({
  hostLan: options => ipcRenderer.invoke('shuttle:host-lan', options),
  stopLan: () => ipcRenderer.invoke('shuttle:stop-lan')
}));
