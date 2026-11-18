"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("convene", {
  calculate: (config) => ipcRenderer.invoke("solver:calculate", config),
  cancel: () => ipcRenderer.send("solver:cancel"),
  onProgress: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("solver:progress", listener);
    return () => ipcRenderer.off("solver:progress", listener);
  },
});
