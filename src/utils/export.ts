import type { ImageElement, Page } from '../types'
import { drawTemplate, drawStroke, drawTextOnCanvas } from '../renderer/drawUtils'

export async function renderPageToCanvas(page: Page, outputScale = 2): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(page.width * outputScale)
  canvas.height = Math.round(page.height * outputScale)
  const ctx = canvas.getContext('2d')!
  drawTemplate(ctx, page, outputScale)

  if (page.pdf) {
    await loadAndDrawPdf(ctx, page, outputScale)
  }

  for (const layer of page.layers) {
    if (!layer.visible) continue
    ctx.save()
    ctx.globalAlpha = layer.opacity
    for (const imgEl of layer.images) {
      await loadAndDrawImage(ctx, imgEl, outputScale)
    }
    for (const textEl of layer.texts) {
      drawTextOnCanvas(ctx, textEl, outputScale)
    }
    for (const stroke of layer.strokes) {
      drawStroke(ctx, stroke, outputScale)
    }
    ctx.restore()
  }
  return canvas
}

function loadAndDrawPdf(ctx: CanvasRenderingContext2D, page: Page, scale: number): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min((page.width * scale) / img.width, (page.height * scale) / img.height)
      const w = img.width * s
      const h = img.height * s
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(
        img,
        Math.floor((page.width * scale - w) / 2),
        Math.floor((page.height * scale - h) / 2),
        Math.floor(w),
        Math.floor(h),
      )
      ctx.restore()
      resolve()
    }
    img.onerror = () => resolve()
    img.src = page.pdf!.dataUrl
  })
}

function loadAndDrawImage(
  ctx: CanvasRenderingContext2D,
  el: ImageElement,
  scale: number,
): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.translate(Math.floor((el.x + el.width / 2) * scale), Math.floor((el.y + el.height / 2) * scale))
      ctx.rotate((el.rotation * Math.PI) / 180)
      ctx.drawImage(
        img,
        Math.floor((-el.width / 2) * scale),
        Math.floor((-el.height / 2) * scale),
        Math.floor(el.width * scale),
        Math.floor(el.height * scale),
      )
      ctx.restore()
      resolve()
    }
    img.onerror = () => resolve()
    img.src = el.dataUrl
  })
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function exportPageAsPng(page: Page, filename?: string): Promise<void> {
  const canvas = await renderPageToCanvas(page)
  const dataUrl = canvas.toDataURL('image/png')
  downloadDataUrl(dataUrl, filename ?? `pagina-${Date.now()}.png`)
}

export async function exportPagesAsPdf(pages: Page[], filename?: string): Promise<void> {
  const first = pages[0]
  const scale = Math.min(2400 / first.width, 3400 / first.height, 2.5)
  const pageW = Math.round(first.width * scale)
  const pageH = Math.round(first.height * scale)

  const rendered = await Promise.all(pages.map((p) => renderPageToCanvas(p, scale)))
  const jpegs: string[] = rendered.map((c) => c.toDataURL('image/jpeg', 0.92))

  const pdf = buildSimplePdf(jpegs, pageW, pageH)
  const blob = new Blob([new Uint8Array(pdf)], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `anotacoes-${Date.now()}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function buildSimplePdf(
  jpegDataUrls: string[],
  pageWidth: number,
  pageHeight: number,
): Uint8Array {
  const header = stringToBytes('%PDF-1.4\n')
  const objects: Uint8Array[] = []
  const offsets: number[] = []

  const pageCount = jpegDataUrls.length
  // Deterministic object ids given the fixed emission order:
  // catalog, then all image streams, then all content streams, then all pages, then pages object.
  const catalogId = 1
  const streamIds = pageCount > 0 ? Array.from({ length: pageCount }, (_, i) => 2 + i) : []
  const contentIds = pageCount > 0 ? Array.from({ length: pageCount }, (_, i) => 2 + pageCount + i) : []
  const pageIds = pageCount > 0 ? Array.from({ length: pageCount }, (_, i) => 2 + 2 * pageCount + i) : []
  const pagesId = 2 + 3 * pageCount

  let currentOffset = header.length
  let objId = 1

  function emit(body: string, stream?: Uint8Array) {
    const id = objId
    offsets[id] = currentOffset
    let part = stringToBytes(`${id} 0 obj\n${body}`)
    currentOffset += part.length
    if (stream) {
      const streamHeader = stringToBytes('\nstream\n')
      currentOffset += streamHeader.length
      part = concatBytes([part, streamHeader, stream])
      currentOffset += stream.length
      const streamFooter = stringToBytes('\nendstream')
      part = concatBytes([part, streamFooter])
      currentOffset += streamFooter.length
    }
    const endobj = stringToBytes('\nendobj\n')
    part = concatBytes([part, endobj])
    currentOffset += endobj.length
    objects.push(part)
    objId += 1
  }

  emit(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

  for (let i = 0; i < pageCount; i++) {
    const data = dataUrlToBytes(jpegDataUrls[i])
    emit(
      `<< /Type /XObject /Subtype /Image /Width ${pageWidth} /Height ${pageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>`,
      data,
    )
  }

  for (let i = 0; i < pageCount; i++) {
    const contentStream = stringToBytes(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im${i + 1} Do\nQ`)
    emit(`<< /Length ${contentStream.length} >>`, contentStream)
  }

  for (let i = 0; i < pageCount; i++) {
    emit(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im${i + 1} ${streamIds[i]} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`,
    )
  }

  emit(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`)

  const body = concatBytes(objects)
  const startXref = currentOffset

  const xrefTable = buildXref(offsets, objId - 1)
  const trailer = `trailer\n<< /Size ${objId} /Root ${catalogId} 0 R >>\nstartxref\n${startXref}\n%%EOF`

  return concatBytes([header, body, stringToBytes(xrefTable), stringToBytes(trailer)])
}

function buildXref(offsets: number[], count: number): string {
  let out = 'xref\n0 ' + (count + 1) + '\n0000000000 65535 f \n'
  for (let i = 1; i <= count; i++) {
    const off = offsets[i] ?? 0
    out += off.toString().padStart(10, '0') + ' 00000 n \n'
  }
  return out
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const a of arrays) {
    out.set(a, pos)
    pos += a.length
  }
  return out
}
