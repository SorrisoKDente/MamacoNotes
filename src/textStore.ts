import { create } from 'zustand'

interface TextUiState {
  draft: string
  draftPos: { x: number; y: number } | null
  draftRotation: number
  selectedTextId: string | null
  editingExisting: boolean
  setDraft: (text: string) => void
  setDraftPos: (pos: { x: number; y: number } | null) => void
  setDraftRotation: (rotation: number) => void
  selectText: (id: string | null) => void
  setEditingExisting: (editing: boolean) => void
  reset: () => void
}

export const useTextStore = create<TextUiState>((set) => ({
  draft: '',
  draftPos: null,
  draftRotation: 0,
  selectedTextId: null,
  editingExisting: false,
  setDraft: (text) => set({ draft: text }),
  setDraftPos: (pos) => set({ draftPos: pos }),
  setDraftRotation: (rotation) => set({ draftRotation: rotation }),
  selectText: (id) => set({ selectedTextId: id }),
  setEditingExisting: (editing) => set({ editingExisting: editing }),
  reset: () => set({ draft: '', draftPos: null, draftRotation: 0, selectedTextId: null, editingExisting: false }),
}))
