import type { DeleteScope } from '../types'
import { useUiStore } from '../uiStore'

export type TemplateImageMode = 'keep' | 'cover'

/**
 * Modal-trigger helpers used by non-React modules (e.g. `chunkedIo`, `store`,
 * sync). They live OUTSIDE `components/Modals.tsx` so that importing a pure
 * data module (`db`, `store`) never drags in the React component tree — which
 * would otherwise pull `utils/pdf.ts` (and its `?url`-imported pdf.js worker)
 * into the module graph and break Node/tsx scripts.
 *
 * When a dialog is opened (`promptName` & co.), the pending resolver is stored
 * here; `ModalsHost` in `components/Modals.tsx` calls the matching `resolve*`
 * function when the user submits/cancels the modal, resolving the promise.
 */
let promptResolver: ((value: string | null) => void) | null = null
let genericConfirmResolver: ((value: boolean) => void) | null = null
let alertResolver: (() => void) | null = null
let deleteResolver: ((scope: DeleteScope | null) => void) | null = null
let imageModeResolver: ((mode: TemplateImageMode | null) => void) | null = null

export function promptName(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    promptResolver = resolve
    useUiStore.getState().open('prompt', { title, defaultValue })
  })
}

export function confirmAction(title: string, description?: string): Promise<boolean> {
  return new Promise((resolve) => {
    genericConfirmResolver = resolve
    useUiStore.getState().open('confirm', { title, description })
  })
}

export function alertAction(title: string, description?: string): Promise<void> {
  return new Promise((resolve) => {
    alertResolver = resolve
    useUiStore.getState().open('alert', { title, description })
  })
}

export function confirmDeleteScope(opts: {
  kind: 'notebook' | 'folder' | 'multi'
  name: string
  title?: string
  description?: string
}): Promise<DeleteScope | null> {
  return new Promise((resolve) => {
    deleteResolver = resolve
    useUiStore.getState().open('confirmDelete', { ...opts })
  })
}

export function chooseTemplateImageMode(): Promise<TemplateImageMode | null> {
  return new Promise((resolve) => {
    imageModeResolver = resolve
    useUiStore.getState().open('imageSizeChoice', {})
  })
}

/** Resolves the pending prompt dialog with the typed value (or null on cancel). */
export function resolvePrompt(value: string | null): void {
  if (promptResolver) {
    promptResolver(value)
    promptResolver = null
  }
}

/** Resolves the pending generic confirm dialog with the user's choice. */
export function resolveConfirm(value: boolean): void {
  if (genericConfirmResolver) {
    genericConfirmResolver(value)
    genericConfirmResolver = null
  }
}

/** Resolves the pending alert dialog. */
export function resolveAlert(): void {
  if (alertResolver) {
    alertResolver()
    alertResolver = null
  }
}

/** Resolves the pending delete-scope dialog with the chosen scope (or null). */
export function resolveDeleteScope(scope: DeleteScope | null): void {
  if (deleteResolver) {
    deleteResolver(scope)
    deleteResolver = null
  }
}

/** Resolves the pending image-size-choice dialog with the chosen mode (or null). */
export function resolveImageMode(mode: TemplateImageMode | null): void {
  if (imageModeResolver) {
    imageModeResolver(mode)
    imageModeResolver = null
  }
}

/** Cancels every pending dialog (used when the modal host is dismissed, e.g. Esc). */
export function clearDialogResolvers(): void {
  resolvePrompt(null)
  resolveConfirm(false)
  resolveAlert()
  resolveDeleteScope(null)
  resolveImageMode(null)
}
