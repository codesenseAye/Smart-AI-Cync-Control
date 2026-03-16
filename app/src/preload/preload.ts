const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  sendCommand: (text: string) => ipcRenderer.invoke("command:send", text),
  getStatuses: () => ipcRenderer.invoke("services:status"),
  getRooms: () => ipcRenderer.invoke("rooms:get"),
  pollDevices: () => ipcRenderer.invoke("devices:poll"),
  getMesh: () => ipcRenderer.invoke("settings:getMesh"),
  getConfig: () => ipcRenderer.invoke("settings:getConfig"),
  getSettingsRooms: () => ipcRenderer.invoke("settings:getRooms"),
  openFile: (path: string) => ipcRenderer.invoke("settings:openFile", path),
  cloudRequestOtp: (email: string) => ipcRenderer.invoke("cloud:requestOtp", email),
  cloudSync: (email: string, password: string, otp: string) => ipcRenderer.invoke("cloud:sync", email, password, otp),
  moveDevice: (deviceId: string, fromRoom: string, toRoom: string) => ipcRenderer.invoke("settings:moveDevice", deviceId, fromRoom, toRoom),
  onServiceStatus: (cb: (data: any) => void) => {
    ipcRenderer.on("service:status", (_e: any, data: any) => cb(data));
  },
  onServerLog: (cb: (data: any) => void) => {
    ipcRenderer.on("server:log", (_e: any, data: any) => cb(data));
  },
  onDeviceEvent: (cb: (data: any) => void) => {
    ipcRenderer.on("device:event", (_e: any, data: any) => cb(data));
  },
});
