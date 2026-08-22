import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export interface RenderedPdfPage {
  dataUrl: string
  width: number
  height: number
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export async function renderPdfPages(file: File): Promise<RenderedPdfPage[]> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages: RenderedPdfPage[] = []
  const scale = 3.0
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport }).promise
    pages.push({
      dataUrl: canvas.toDataURL('image/png'),
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
    })
    page.cleanup()
  }
  pdf.destroy()
  return pages
}

export async function pdfPageToImage(file: File): Promise<RenderedPdfPage> {
  const pages = await renderPdfPages(file)
  return pages[0]
}
