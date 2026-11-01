import type { ToolKind } from '../types'

export function isDrawingTool(tool: ToolKind): boolean {
  return tool === 'pen' || tool === 'highlighter' || tool === 'eraser'
}

export function shouldUseCursorOnlyPointerPath(
  tool: ToolKind,
  pointerType: string,
  isDragging: boolean,
): boolean {
  return pointerType === 'mouse' && isDrawingTool(tool) && !isDragging
}
