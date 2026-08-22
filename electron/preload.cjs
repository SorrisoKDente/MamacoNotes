const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('inkfolioDesktop', {
  isDesktop: true,
  platform: process.platform,
  pickDirectory: () => ipcRenderer.invoke('pick-directory'),
  writeFile: (dir, filename, content) =>
    ipcRenderer.invoke('write-file', dir, filename, content),
  readFile: (dir, filename) => ipcRenderer.invoke('read-file', dir, filename),
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
  onUpdateError: (callback) => {
    const subscription = (_e, err) => callback(err)
    ipcRenderer.on('update-error', subscription)
    return () => ipcRenderer.removeListener('update-error', subscription)
  },
})
