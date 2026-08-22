/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const src: string
  export default src
}

interface InkfolioDesktopApi {
  isDesktop: boolean
  platform: string
  pickDirectory: () => Promise<string | null>
  writeFile: (dir: string, filename: string, content: string) => Promise<boolean>
  readFile: (dir: string, filename: string) => Promise<string | null>
  saveFile: (defaultName: string, content: string) => Promise<boolean>
  openFile: () => Promise<string | null>
  setLanguage: (lang: string) => void
  checkForUpdates: () => Promise<any>
  downloadUpdate: () => Promise<any>
  installUpdate: () => void
  onUpdateAvailable: (callback: (info: any) => void) => () => void
  onUpdateDownloaded: (callback: (info: any) => void) => () => void
  onUpdateError: (callback: (msg: string) => void) => () => void
}

interface Window {
  inkfolioDesktop?: InkfolioDesktopApi
}
