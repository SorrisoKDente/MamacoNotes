import type { AppSettings, ToolKind } from '../types'

export function isDrawingTool(tool: ToolKind): boolean {
  return tool === 'pen' || tool === 'highlighter' || tool === 'eraser'
}

export function isMousePointer(pointerType: string): boolean {
  return pointerType === 'mouse' || pointerType === ''
}

export function isPenPointer(pointerType: string): boolean {
  return pointerType === 'pen'
}

export function isTouchPointer(pointerType: string): boolean {
  return pointerType === 'touch'
}

export function isToolCursorHidden(
  tool: ToolKind,
  settings: Pick<AppSettings, 'hideToolCursor' | 'hidePenCursor' | 'hideHighlighterCursor' | 'hideEraserCursor'>,
): boolean {
  if (settings.hideToolCursor) return true
  if (tool === 'pen') return settings.hidePenCursor
  if (tool === 'highlighter') return settings.hideHighlighterCursor
  if (tool === 'eraser') return settings.hideEraserCursor
  return false
}

export function shouldUseCursorOnlyPointerPath(
  tool: ToolKind,
  pointerType: string,
  isDragging: boolean,
): boolean {
  return isMousePointer(pointerType) && isDrawingTool(tool) && !isDragging
}
