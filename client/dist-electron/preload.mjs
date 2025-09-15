"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  }
  // You can expose other APTs you need here.
  // ...
});
electron.contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => electron.ipcRenderer.invoke("select-folder"),
  openFile: (filePath) => electron.ipcRenderer.invoke("open-file", filePath),
  openFolder: (filePath) => electron.ipcRenderer.invoke("open-folder", filePath),
  selectFile: () => electron.ipcRenderer.invoke("select-file"),
  copyToClipboard: (text) => electron.ipcRenderer.invoke("copy-to-clipboard", text)
});
electron.contextBridge.exposeInMainWorld("electronStore", {
  get: (key) => electron.ipcRenderer.invoke("store:get", key),
  set: (key, value) => electron.ipcRenderer.invoke("store:set", key, value),
  delete: (key) => electron.ipcRenderer.invoke("store:delete", key),
  has: (key) => electron.ipcRenderer.invoke("store:has", key)
});
