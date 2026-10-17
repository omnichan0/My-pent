const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pentagiDesktop", {
  action: (request) => ipcRenderer.invoke("app:action", request),
  resources: () => ipcRenderer.invoke("app:resources"),
  openApp: () => ipcRenderer.invoke("app:open"),
  openDockerInstall: () => ipcRenderer.invoke("app:open-docker-install"),
  openDockerStartup: () => ipcRenderer.invoke("app:open-docker-startup"),
  openToolInventory: () => ipcRenderer.invoke("app:open-tool-inventory"),
  getLoginSetting: () => ipcRenderer.invoke("app:login-setting-state"),
  setLoginSetting: (enabled) => ipcRenderer.invoke("app:login-setting", enabled),
  onEvent: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on("task:event", handler);
    return () => ipcRenderer.removeListener("task:event", handler);
  },
});
