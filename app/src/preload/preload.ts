const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  sendCommand: (text: string) => ipcRenderer.invoke("command:send", text),
  getStatuses: () => ipcRenderer.invoke("services:status"),
  onServiceStatus: (cb: (data: any) => void) => {
    ipcRenderer.on("service:status", (_e: any, data: any) => cb(data));
  },
  onServerLog: (cb: (data: any) => void) => {
    ipcRenderer.on("server:log", (_e: any, data: any) => cb(data));
  },
});
