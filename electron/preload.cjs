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
})
