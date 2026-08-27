import { create } from 'zustand'

export type ModalName =
  | 'newNotebook'
  | 'settings'
  | 'export'
  | 'templatePicker'
  | 'importImage'
  | 'importPdf'
  | 'importPdfNote'
  | 'imageSizeChoice'
  | 'addPagePicker'
  | 'cloudSync'
  | 'moveNotebook'
  | 'moveFolder'
  | 'copyNotebook'
  | 'backgroundColor'
  | 'syncConflict'
  | 'prompt'
  | 'confirmDelete'
  | 'update'
  | 'trash'
  | 'alert'
  | 'confirm'

interface UiState {
  openModal: ModalName | null
  modalData: Record<string, unknown>
  open: (name: ModalName, data?: Record<string, unknown>) => void
  close: () => void
}

export const useUiStore = create<UiState>((set) => ({
  openModal: null,
  modalData: {},
  open: (name, data = {}) => set({ openModal: name, modalData: data }),
  close: () => set({ openModal: null, modalData: {} }),
}))
