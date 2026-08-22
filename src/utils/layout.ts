import type { Page, PageViewMode } from '../types'

export interface PageOffset {
  x: number
  y: number
}

const PAGE_GAP = 36

export function pageVisualBox(page: Page): { w: number; h: number } {
  const rot = ((page.rotation % 360) + 360) % 360
  if (rot === 0) return { w: page.width, h: page.height }
  const rad = (rot * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return {
    w: page.width * cos + page.height * sin,
    h: page.width * sin + page.height * cos,
  }
}

// The visual (axis-aligned) box of a rotated page is centered on the page's
// own center, not anchored at the page origin. This returns where that visual
// box sits relative to the page's origin, so hit-testing, panning and layout
// stay consistent with how the page is actually rendered.
export function pageVisualRect(page: Page): { x: number; y: number; w: number; h: number } {
  const box = pageVisualBox(page)
  return {
    x: (page.width - box.w) / 2,
    y: (page.height - box.h) / 2,
    w: box.w,
    h: box.h,
  }
}

export function computePageOffsets(
  pages: Page[],
  mode: PageViewMode,
): PageOffset[] {
  if (mode === 'separate') {
    return pages.map(() => ({ x: 0, y: 0 }))
  }
  if (mode === 'horizontal') {
    let x = 0
    return pages.map((p) => {
      const vr = pageVisualRect(p)
      const off = { x: x - vr.x, y: 0 }
      x += vr.w + PAGE_GAP
      return off
    })
  }
  let y = 0
  return pages.map((p) => {
    const vr = pageVisualRect(p)
    const off = { x: 0, y: y - vr.y }
    y += vr.h + PAGE_GAP
    return off
  })
}

export function totalDocumentSize(
  pages: Page[],
  mode: PageViewMode,
  offsets: PageOffset[],
): { width: number; height: number } {
  if (pages.length === 0) return { width: 0, height: 0 }
  if (mode === 'separate') {
    const p = pages[0]
    return { width: p.width, height: p.height }
  }
  let maxX = 0
  let maxY = 0
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    const off = offsets[i] ?? { x: 0, y: 0 }
    const vr = pageVisualRect(p)
    maxX = Math.max(maxX, off.x + vr.x + vr.w)
    maxY = Math.max(maxY, off.y + vr.y + vr.h)
  }
  return { width: maxX, height: maxY }
}

export function pageUnderPoint(
  pages: Page[],
  offsets: PageOffset[],
  dx: number,
  dy: number,
): number | null {
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    const off = offsets[i] ?? { x: 0, y: 0 }
    const vr = pageVisualRect(p)
    if (
      dx >= off.x + vr.x &&
      dx <= off.x + vr.x + vr.w &&
      dy >= off.y + vr.y &&
      dy <= off.y + vr.y + vr.h
    ) {
      return i
    }
  }
  return null
}
