const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('inkfolioDesktop', {
  isDesktop: true,
  platform: process.platform,
  saveFile: (defaultName, content) => ipcRenderer.invoke('save-file', defaultName, content),
  openFile: () => ipcRenderer.invoke('open-file'),
  setLanguage: (lang) => ipcRenderer.send('set-language', lang),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateAvailable: (callback) => {
    const subscription = (_e, info) => callback(info)
    ipcRenderer.on('update-available', subscription)
    return () => ipcRenderer.removeListener('update-available', subscription)
  },
  onUpdateDownloaded: (callback) => {
    const subscription = (_e, info) => callback(info)
    ipcRenderer.on('update-downloaded', subscription)
    return () => ipcRenderer.removeListener('update-downloaded', subscription)
  },
  onUpdateProgress: (callback) => {
    const subscription = (_e, percent) => callback(percent)
    ipcRenderer.on('update-progress', subscription)
    return () => ipcRenderer.removeListener('update-progress', subscription)
  },
  onUpdateError: (callback) => {
    const subscription = (_e, err) => callback(err)
    ipcRenderer.on('update-error', subscription)
    return () => ipcRenderer.removeListener('update-error', subscription)
  },
})
