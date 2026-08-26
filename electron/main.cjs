const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

const isDev = !!process.env.VITE_DEV_SERVER_URL

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.exit(0)
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  let appLang = 'pt-BR'

  const menuMessages = {
    'pt-BR': {
      'menu.file': 'Arquivo',
      'menu.edit': 'Editar',
      'menu.view': 'Exibir',
      'menu.quit': 'Sair',
      'menu.undo': 'Desfazer',
      'menu.redo': 'Refazer',
      'menu.cut': 'Recortar',
      'menu.copy': 'Copiar',
      'menu.paste': 'Colar',
      'menu.selectAll': 'Selecionar tudo',
      'menu.reload': 'Recarregar',
      'menu.toggleFullscreen': 'Alternar tela cheia',
      'menu.toggleDevTools': 'Ferramentas de desenvolvedor',
      'electron.pickDirectoryTitle': 'Selecionar diretório de anotações',
      'electron.backupFilter': 'Backup Mamaco Notes',
      'electron.jsonFilter': 'JSON',
    },
    en: {
      'menu.file': 'File',
      'menu.edit': 'Edit',
      'menu.view': 'View',
      'menu.quit': 'Quit',
      'menu.undo': 'Undo',
      'menu.redo': 'Redo',
      'menu.cut': 'Cut',
      'menu.copy': 'Copy',
      'menu.paste': 'Paste',
      'menu.selectAll': 'Select All',
      'menu.reload': 'Reload',
      'menu.toggleFullscreen': 'Toggle Full Screen',
      'menu.toggleDevTools': 'Developer Tools',
      'electron.pickDirectoryTitle': 'Select notes directory',
      'electron.backupFilter': 'Mamaco Notes Backup',
      'electron.jsonFilter': 'JSON',
    },
  }

  function m(key) {
    return menuMessages[appLang][key] ?? menuMessages['pt-BR'][key] ?? key
  }

  const portableDir =
    process.env.PORTABLE_EXECUTABLE_DIR ||
    (process.env.APPIMAGE ? path.dirname(process.env.APPIMAGE) : null)

  if (portableDir) {
    app.setPath('userData', path.join(portableDir, 'mamaco-notes-data'))
  }

  function createWindow() {
    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 940,
      minHeight: 600,
      title: 'Mamaco Notes',
      icon: path.join(__dirname, '../build-resources/icon.png'),
      backgroundColor: '#1e1e2e',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    win.setMenuBarVisibility(true)

    if (isDev) {
      win.loadURL(process.env.VITE_DEV_SERVER_URL)
      win.webContents.openDevTools({ mode: 'detach' })
    } else {
      win.loadFile(path.join(__dirname, '../dist/index.html'))
    }
  }

  function buildMenu() {
    return Menu.buildFromTemplate([
      {
        label: m('menu.file'),
        submenu: [{ role: 'quit', label: m('menu.quit') }],
      },
      {
        label: m('menu.edit'),
        submenu: [
          { role: 'undo', label: m('menu.undo') },
          { role: 'redo', label: m('menu.redo') },
          { type: 'separator' },
          { role: 'cut', label: m('menu.cut') },
          { role: 'copy', label: m('menu.copy') },
          { role: 'paste', label: m('menu.paste') },
          { role: 'selectAll', label: m('menu.selectAll') },
        ],
      },
      {
        label: m('menu.view'),
        submenu: [
          { role: 'reload', label: m('menu.reload') },
          { role: 'togglefullscreen', label: m('menu.toggleFullscreen') },
          { role: 'toggleDevTools', label: m('menu.toggleDevTools') },
        ],
      },
    ])
  }

  Menu.setApplicationMenu(buildMenu())

  app.whenReady().then(() => {
    ipcMain.on('set-language', (_e, lang) => {
      if (lang && menuMessages[lang]) {
        appLang = lang
        Menu.setApplicationMenu(buildMenu())
      }
    })

    ipcMain.handle('pick-directory', async () => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const result = await dialog.showOpenDialog(win, {
        title: m('electron.pickDirectoryTitle'),
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    })

    ipcMain.handle('write-file', async (_e, dir, filename, content) => {
      try {
        await fs.promises.mkdir(dir, { recursive: true })
        await fs.promises.writeFile(path.join(dir, filename), content, 'utf-8')
        return true
      } catch (err) {
        console.error('Falha ao gravar arquivo local:', err)
        return false
      }
    })

    ipcMain.handle('read-file', async (_e, dir, filename) => {
      try {
        return await fs.promises.readFile(path.join(dir, filename), 'utf-8')
      } catch {
        return null
      }
    } )

    ipcMain.handle('save-file', async (_e, defaultName, content) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const result = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters: [{ name: m('electron.jsonFilter'), extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return false
      try {
        await fs.promises.writeFile(result.filePath, content, 'utf-8')
        return true
      } catch (err) {
        console.error('Falha ao salvar arquivo:', err)
        return false
      }
    })

    ipcMain.handle('open-file', async (_e, _extensions) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: m('electron.backupFilter'), extensions: ['json'] }],
      })
      if (result.canceled || result.filePaths.length === 0) return null
      try {
        return await fs.promises.readFile(result.filePaths[0], 'utf-8')
      } catch (err) {
        console.error('Falha ao abrir arquivo:', err)
        return null
      }
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })

    // --- Auto-Updater Logic ---
    autoUpdater.on('update-available', (info) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('update-available', info)
    })

    autoUpdater.on('update-downloaded', (info) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('update-downloaded', info)
    })

    autoUpdater.on('error', (err) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) win.webContents.send('update-error', err?.message || 'Update error')
    })

    ipcMain.handle('check-for-updates', async () => {
      try {
        return await autoUpdater.checkForUpdates()
      } catch (err) {
        console.error('Failed to check for updates:', err)
        return null
      }
    })

    ipcMain.handle('download-update', async () => {
      return await autoUpdater.downloadUpdate()
    })

    ipcMain.on('install-update', () => {
      autoUpdater.quitAndInstall()
    })
  })
}

app.on('before-quit', () => {
  app.exit(0)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
