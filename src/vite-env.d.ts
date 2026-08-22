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
  setLanguage: (lang: string) => void
}

interface Window {
  inkfolioDesktop?: InkfolioDesktopApi
}
