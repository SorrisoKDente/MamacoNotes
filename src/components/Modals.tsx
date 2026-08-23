import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { useUiStore } from '../uiStore'
import { logger } from '../utils/logger'
import type {
  AppTheme,
  ConflictChoice,
  DeleteScope,
  Page,
  PageTemplate,
  ShortcutActionId,
  SyncConflictItem,
  TemplateId,
} from '../types'
import { makePage, newId, getActiveLayer, APP_VERSION } from '../types'
import { DEFAULT_SHORTCUTS } from '../types'
import { renderPdfPages } from '../utils/pdf'
import type { RenderedPdfPage } from '../utils/pdf'
import { renderThumbnail } from '../renderer/thumbnail'
import { exportPageAsPng, exportPagesAsPdf } from '../utils/export'
import { testWebdavConnection, ensureRemoteStructure } from '../utils/webdav'
import { shortcutLabel, normalizeKey, findShortcutAction } from '../utils/shortcuts'
import { pickSaveDirectory } from '../utils/localSave'
import { exportBackup, importBackup } from '../utils/backup'
import { useI18n } from '../i18n'
import { SUPPORTED_LANGUAGES } from '../i18n/languages'
import { checkForUpdates } from '../utils/updateCheck'

function templateOptions(t: (key: string, params?: Record<string, string | number>) => string): { id: TemplateId; label: string; hint: string }[] {
  return [
    { id: 'blank', label: t('modal.templateBlank'), hint: t('modal.templateBlankHint') },
    { id: 'ruled', label: t('modal.templateRuled'), hint: t('modal.templateRuledHint') },
    { id: 'grid', label: t('modal.templateGrid'), hint: t('modal.templateGridHint') },
    { id: 'dot', label: t('modal.templateDot'), hint: t('modal.templateDotHint') },
  ]
}

let promptResolver: ((value: string | null) => void) | null = null

export function promptName(title: string, defaultValue = ''): Promise<string | null> {
  return new Promise((resolve) => {
    promptResolver = resolve
    useUiStore.getState().open('prompt', { title, defaultValue })
  })
}

let deleteResolver: ((scope: DeleteScope | null) => void) | null = null

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

export type TemplateImageMode = 'keep' | 'cover'

let imageModeResolver: ((mode: TemplateImageMode | null) => void) | null = null

export function chooseTemplateImageMode(): Promise<TemplateImageMode | null> {
  return new Promise((resolve) => {
    imageModeResolver = resolve
    useUiStore.getState().open('imageSizeChoice', {})
  })
}

function PromptModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const modalData = useUiStore((s) => s.modalData)
  const title = (modalData.title as string) ?? t('modal.promptTitle')
  const defaultValue = (modalData.defaultValue as string) ?? ''
  const [value, setValue] = useState(defaultValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function finish(result: string | null) {
    if (promptResolver) {
      promptResolver(result)
      promptResolver = null
    }
    close()
  }

  function submit() {
    finish(value.trim() || null)
  }

  return (
    <>
      <h2>{title}</h2>
      <input
        ref={inputRef}
        className="form-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
      />
      <div className="modal-actions">
        <button className="btn primary" onClick={submit}>{t('modal.ok')}</button>
        <button className="btn" onClick={() => finish(null)}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

function ConfirmDeleteModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const modalData = useUiStore((s) => s.modalData)
  const kind = modalData.kind as 'notebook' | 'folder' | 'multi'
  const name = (modalData.name as string) ?? ''

  function finish(scope: DeleteScope | null) {
    if (deleteResolver) {
      deleteResolver(scope)
      deleteResolver = null
    }
    close()
  }

  const title =
    (modalData.title as string | undefined) ??
    (kind === 'folder'
      ? t('modal.deleteFolderTitle', { name })
      : kind === 'multi'
        ? t('modal.deleteItemsTitle', { name })
        : t('modal.deleteNotebookTitle', { name }))
  const description =
    (modalData.description as string | undefined) ??
    (kind === 'folder'
      ? t('modal.deleteFolderDesc')
      : kind === 'multi'
        ? t('modal.deleteItemsDesc')
        : t('modal.deleteNotebookDesc'))
  const itemLabel =
    kind === 'folder'
      ? t('modal.deleteItemLabelFolder')
      : kind === 'multi'
        ? t('modal.deleteItemLabelItems')
        : t('modal.deleteItemLabelNote')

  useEffect(() => {
    return () => {
      if (deleteResolver) {
        deleteResolver(null)
        deleteResolver = null
      }
    }
  }, [])

  return (
    <>
      <h2>{title}</h2>
      <p className="modal-hint">{description}</p>
      <div className="delete-scope-options">
        <button className="delete-scope-option" onClick={() => finish('local')}>
          <span className="delete-scope-title">{t('modal.deleteLocalOnly')}</span>
          <span className="modal-hint">
            {t('modal.deleteLocalOnlyHint', { item: itemLabel })}
          </span>
        </button>
        <button className="delete-scope-option danger" onClick={() => finish('remote')}>
          <span className="delete-scope-title">{t('modal.deleteAlsoCloud')}</span>
          <span className="modal-hint">
            {t('modal.deleteAlsoCloudHint')}
          </span>
        </button>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => finish(null)}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

function ImageSizeChoiceModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)

  function finish(mode: TemplateImageMode | null) {
    if (imageModeResolver) {
      imageModeResolver(mode)
      imageModeResolver = null
    }
    close()
  }

  return (
    <>
      <h2>{t('modal.imageSizeChoiceTitle')}</h2>
      <p className="modal-hint">{t('modal.imageSizeChoiceHint')}</p>
      <div className="delete-scope-options">
        <button className="delete-scope-option" onClick={() => finish('keep')}>
          <span className="delete-scope-title">{t('modal.imageSizeKeep')}</span>
          <span className="modal-hint">{t('modal.imageSizeKeepHint')}</span>
        </button>
        <button className="delete-scope-option" onClick={() => finish('cover')}>
          <span className="delete-scope-title">{t('modal.imageSizeCover')}</span>
          <span className="modal-hint">{t('modal.imageSizeCoverHint')}</span>
        </button>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => finish(null)}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

export function ModalsHost() {
  const openModal = useUiStore((s) => s.openModal)
  const modalData = useUiStore((s) => s.modalData)
  const close = useUiStore((s) => s.close)

  useEffect(() => {
    const onEsc = () => {
      if (promptResolver) {
        promptResolver(null)
        promptResolver = null
      }
      if (deleteResolver) {
        deleteResolver(null)
        deleteResolver = null
      }
      if (imageModeResolver) {
        imageModeResolver(null)
        imageModeResolver = null
      }
      close()
    }
    window.addEventListener('ink:esc', onEsc)
    return () => window.removeEventListener('ink:esc', onEsc)
  }, [close])

  if (!openModal) return null
  return (
    <div className="modal-overlay">
      <ModalShell>
        {openModal === 'newNotebook' && <NewNotebookModal />}
        {openModal === 'addPagePicker' && <AddPageModal />}
        {openModal === 'templatePicker' && <TemplateModal />}
        {openModal === 'importImage' && <ImportImageModal />}
        {openModal === 'importPdf' && <ImportPdfModal />}
        {openModal === 'importPdfNote' && <ImportPdfNoteModal />}
        {openModal === 'imageSizeChoice' && <ImageSizeChoiceModal />}
        {openModal === 'export' && <ExportModal />}
        {openModal === 'settings' && <SettingsModal />}
        {openModal === 'cloudSync' && <CloudSyncModal />}
        {openModal === 'moveNotebook' && <MoveModal />}
        {openModal === 'moveFolder' && <MoveModal />}
        {openModal === 'copyNotebook' && <MoveModal />}
        {openModal === 'backgroundColor' && <BackgroundColorModal />}
        {openModal === 'syncConflict' && <SyncConflictModal />}
        {openModal === 'prompt' && <PromptModal />}
        {openModal === 'confirmDelete' && <ConfirmDeleteModal />}
        {openModal === 'update' && <UpdateModal />}
      </ModalShell>
      <span className="modal-data-keep" data-json={JSON.stringify(modalData)} />
    </div>
  )
}

function ModalShell({ children }: { children: React.ReactNode }) {
  const close = useUiStore((s) => s.close)
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={close}>✕</button>
        {children}
      </div>
    </div>
  )
}

const BUILTIN_TEMPLATE_IDS: TemplateId[] = ['blank', 'ruled', 'grid', 'dot']

function isCustomTemplateChoice(value: string): boolean {
  return !(BUILTIN_TEMPLATE_IDS as string[]).includes(value)
}

function TemplatePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { t } = useI18n()
  const templates = useAppStore((s) => s.templates)
  const addTemplate = useAppStore((s) => s.addTemplate)
  const deleteTemplate = useAppStore((s) => s.deleteTemplate)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pdfPages, setPdfPages] = useState<RenderedPdfPage[] | null>(null)
  const [pdfFileName, setPdfFileName] = useState('')
  const [pdfSelected, setPdfSelected] = useState<number | null>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        const rendered = await renderPdfPages(file)
        setPdfPages(rendered)
        setPdfFileName(file.name)
        setPdfSelected(rendered.length === 1 ? 0 : null)
      } else {
        const mode = await chooseTemplateImageMode()
        if (!mode) {
          setBusy(false)
          return
        }
        const pages = await buildTemplatePages(file, mode)
        const name = file.name.replace(/\.[^.]+$/, '') || t('modal.templateFallbackName')
        const template = await addTemplate(name, pages)
        onChange(template.id)
      }
    } catch (err) {
      setError(t('modal.templateImportError', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  async function confirmPdfPage() {
    if (pdfPages === null || pdfSelected === null) return
    setBusy(true)
    setError(null)
    try {
      const rp = pdfPages[pdfSelected]
      const page = buildPdfTemplatePage(rp, pdfFileName, pdfSelected + 1)
      const name = pdfFileName.replace(/\.[^.]+$/, '') || t('modal.templateFallbackName')
      const template = await addTemplate(name, [page])
      onChange(template.id)
      setPdfPages(null)
      setPdfFileName('')
      setPdfSelected(null)
    } catch (err) {
      setError(t('modal.templateImportError', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  function cancelPdfPage() {
    setPdfPages(null)
    setPdfFileName('')
    setPdfSelected(null)
    setError(null)
  }

  if (pdfPages !== null) {
    return (
      <div className="template-picker">
        <div className="form-label">{t('modal.choosePdfTemplatePage')}</div>
        <div className="pdf-pages-grid">
          {pdfPages.map((rp, i) => (
            <button
              key={i}
              className={`pdf-page-card ${pdfSelected === i ? 'active' : ''}`}
              onClick={() => setPdfSelected(i)}
            >
              <img src={rp.dataUrl} alt={t('modal.pdfPageAlt', { number: i + 1 })} />
              <span className="pdf-page-number">{i + 1}</span>
            </button>
          ))}
        </div>
        <div className="template-import">
          <button
            className="btn primary small"
            onClick={confirmPdfPage}
            disabled={busy || pdfSelected === null}
          >
            {busy ? t('modal.importing') : t('modal.usePdfPageAsTemplate')}
          </button>
          <button className="btn small" onClick={cancelPdfPage} disabled={busy}>
            {t('modal.cancel')}
          </button>
        </div>
        {error && <div className="modal-result error">{error}</div>}
      </div>
    )
  }

  return (
    <div className="template-picker">
      <div className="template-options">
        {templateOptions(t).map((opt) => (
          <button
            key={opt.id}
            className={`template-card ${value === opt.id ? 'active' : ''}`}
            onClick={() => onChange(opt.id)}
          >
            <div className={`template-preview template-${opt.id}`} />
            <div className="template-label">{opt.label}</div>
            <div className="template-hint">{opt.hint}</div>
          </button>
        ))}
      </div>

      {templates.length > 0 && (
        <div className="custom-templates">
          <div className="form-label">{t('modal.myTemplates')}</div>
          <div className="custom-template-list">
            {templates.map((tmpl) => (
              <div
                key={tmpl.id}
                className={`custom-template-card ${value === tmpl.id ? 'active' : ''}`}
                onClick={() => onChange(tmpl.id)}
              >
                <CustomTemplatePreview template={tmpl} />
                <div className="custom-template-name" title={tmpl.name}>
                  {tmpl.name}
                </div>
                <button
                  className="custom-template-remove"
                  title={t('modal.removeTemplate')}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(t('modal.removeTemplateConfirm', { name: tmpl.name }))) {
                      void deleteTemplate(tmpl.id)
                      if (value === tmpl.id) onChange('ruled')
                    }
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="template-import">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button className="btn small" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? t('modal.importing') : t('modal.importTemplate')}
        </button>
        <span className="modal-hint">
          {t('modal.templateLocalHint')}
        </span>
      </div>
      {error && <div className="modal-result error">{error}</div>}
    </div>
  )
}

function CustomTemplatePreview({ template }: { template: PageTemplate }) {
  const [thumb, setThumb] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const page = template.pages[0]
    if (!page) {
      setThumb(null)
      return
    }
    void renderThumbnail(page, 80, 110).then((url) => {
      if (!cancelled) setThumb(url)
    })
    return () => {
      cancelled = true
    }
  }, [template])
  return (
    <div className="template-preview custom-template-preview">
      {thumb ? (
        <img src={thumb} alt="" className="custom-template-thumb" draggable={false} />
      ) : (
        <div className="template-preview-loading" />
      )}
    </div>
  )
}

function buildPdfTemplatePage(rp: RenderedPdfPage, fileName: string, pageNumber: number): Page {
  const page = makePage('blank', {
    width: Math.max(400, Math.round(rp.width)),
    height: Math.max(400, Math.round(rp.height)),
  })
  page.pdf = { dataUrl: rp.dataUrl, name: fileName, pageNumber }
  return page
}

async function buildTemplatePages(
  file: File,
  imageMode: TemplateImageMode = 'cover',
): Promise<Page[]> {
  const reader = new FileReader()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read the image'))
    reader.readAsDataURL(file)
  })
  const img = new Image()
  await new Promise<void>((resolve) => {
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = dataUrl
  })
  const page = makePage('blank')
  let w: number
  let h: number
  if (imageMode === 'cover') {
    w = page.width
    h = page.height
  } else {
    w = img.width
    h = img.height
  }
  getActiveLayer(page).images.push({
    id: newId(),
    name: file.name,
    dataUrl,
    x: Math.round((page.width - w) / 2),
    y: Math.round((page.height - h) / 2),
    width: w,
    height: h,
    rotation: 0,
  })
  return [page]
}

function NewNotebookModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const modalData = useUiStore((s) => s.modalData)
  const folders = useAppStore((s) => s.folders)
  const createNotebook = useAppStore((s) => s.createNotebook)
  const createNotebookFromTemplate = useAppStore((s) => s.createNotebookFromTemplate)
  const settings = useAppStore((s) => s.settings)
  const selectedFolderId = useAppStore((s) => s.selectedFolderId)
  const initialFolderId = (modalData.folderId as string | null | undefined) ?? selectedFolderId
  const [name, setName] = useState(t('modal.newNotebookDefaultName'))
  const [folderId, setFolderId] = useState<string | null>(initialFolderId)
  const [choice, setChoice] = useState<string>(settings.defaultTemplate)

  async function submit() {
    const noteName = name.trim() || t('modal.untitled')
    if (isCustomTemplateChoice(choice)) {
      const template = useAppStore.getState().templates.find((tmpl) => tmpl.id === choice)
      if (template) {
        await createNotebookFromTemplate(noteName, folderId, template)
        close()
        return
      }
    }
    await createNotebook(noteName, folderId, choice as TemplateId)
    close()
  }

  return (
    <>
      <h2>{t('modal.newNotebook')}</h2>
      <label className="form-label">{t('modal.name')}</label>
      <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <label className="form-label">{t('modal.folder')}</label>
      <select className="form-input" value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)}>
        <option value="">{t('modal.noFolder')}</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      <label className="form-label">{t('modal.firstPageTemplate')}</label>
      <TemplatePicker value={choice} onChange={setChoice} />
      <div className="modal-actions">
        <button className="btn primary" onClick={submit}>{t('modal.createNote')}</button>
        <button className="btn" onClick={close}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

function AddPageModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const addPage = useAppStore((s) => s.addPage)
  const addPagesFromTemplate = useAppStore((s) => s.addPagesFromTemplate)
  const settings = useAppStore((s) => s.settings)
  const [choice, setChoice] = useState<string>(settings.defaultTemplate)

  async function submit() {
    if (isCustomTemplateChoice(choice)) {
      const template = useAppStore.getState().templates.find((tmpl) => tmpl.id === choice)
      if (template) {
        await addPagesFromTemplate(template)
        close()
        return
      }
    }
    await addPage(choice as TemplateId)
    close()
  }

  return (
    <>
      <h2>{t('modal.newPage')}</h2>
      <p className="modal-hint">{t('modal.chooseTemplateHint')}</p>
      <TemplatePicker value={choice} onChange={setChoice} />
      <div className="modal-actions">
        <button className="btn primary" onClick={submit}>{t('modal.addPage')}</button>
        <button className="btn" onClick={close}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

function TemplateModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const data = useUiStore((s) => s.modalData)
  const [choice, setChoice] = useState<string>(data.template as string ?? 'ruled')
  const currentPageIndex = useAppStore((s) => s.currentPageIndex)
  const updatePage = useAppStore((s) => s.updatePage)
  const applyTemplateToPage = useAppStore((s) => s.applyTemplateToPage)
  const index = (data.index as number) ?? currentPageIndex

  async function submit() {
    if (isCustomTemplateChoice(choice)) {
      const template = useAppStore.getState().templates.find((tmpl) => tmpl.id === choice)
      if (template) {
        await applyTemplateToPage(index, template)
        close()
        return
      }
    }
    await updatePage(index, { template: choice as TemplateId })
    close()
  }

  return (
    <>
      <h2>{t('modal.changePageTemplate')}</h2>
      <TemplatePicker value={choice} onChange={setChoice} />
      <div className="modal-actions">
        <button className="btn primary" onClick={submit}>{t('modal.apply')}</button>
        <button className="btn" onClick={close}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

const BG_PRESETS = ['#ffffff', '#fff9e6', '#fff4d6', '#e8f4ff', '#eaf7e8', '#fdeef2', '#f3ecff', '#f0f0f0', '#202030', '#1c1c1c']

function BackgroundColorModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const data = useUiStore((s) => s.modalData)
  const notebooks = useAppStore((s) => s.notebooks)
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId)
  const updatePage = useAppStore((s) => s.updatePage)
  const persistNotebook = useAppStore((s) => s.persistNotebook)
  const [color, setColor] = useState('#ffffff')

  const notebook = notebooks.find((n) => n.id === selectedNotebookId)
  const index = (data.index as number) ?? 0

  async function applyToCurrent() {
    if (!notebook) return
    await updatePage(index, { backgroundColor: color })
    close()
  }

  async function applyToAll() {
    if (!notebook) return
    const nb = { ...notebook }
    nb.pages = nb.pages.map((p) => ({ ...p, backgroundColor: color, updatedAt: Date.now() }))
    nb.updatedAt = Date.now()
    await persistNotebook(nb)
    close()
  }

  return (
    <>
      <h2>{t('modal.pageBackgroundColor')}</h2>
      <p className="modal-hint">{t('modal.bgHint')}</p>
      <div className="panel-label">{t('tool.color')}</div>
      <div className="color-options bg-color-options">
        {BG_PRESETS.map((c) => (
          <button
            key={c}
            className={`color-btn ${color === c ? 'active' : ''}`}
            style={{ background: c, borderColor: c === '#ffffff' || c === '#fff9e6' || c === '#fff4d6' ? '#999' : c }}
            onClick={() => setColor(c)}
            title={c}
          />
        ))}
      </div>
      <div className="panel-row">
        <label className="custom-color">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title={t('modal.customColor')} />
        </label>
        <span className="panel-hint">{t('modal.customColorLabel')}</span>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={applyToAll}>{t('modal.applyToAllPages')}</button>
        <button className="btn primary" onClick={applyToCurrent}>{t('modal.applyToCurrentPage')}</button>
        <button className="btn" onClick={close}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

function ImportImageModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const addImageToPage = useAppStore((s) => s.addImageToPage)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      setPreview(dataUrl)
      await addImageToPage(dataUrl, file.name)
      setBusy(false)
      close()
    }
    reader.readAsDataURL(file)
  }

  return (
    <>
      <h2>{t('modal.importImage')}</h2>
      <p className="modal-hint">{t('modal.importImageHint')}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button className="btn primary" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? t('modal.importing') : t('modal.chooseImage')}
      </button>
      {preview && <div className="import-preview"><img src={preview} alt={t('modal.preview')} /></div>}
      <div className="modal-actions">
        <button className="btn" onClick={close}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

function ImportPdfModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId)
  const notebooks = useAppStore((s) => s.notebooks)
  const addPage = useAppStore((s) => s.addPage)
  const persistNotebook = useAppStore((s) => s.persistNotebook)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [pages, setPages] = useState<RenderedPdfPage[]>([])
  const [fileName, setFileName] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setResult(null)
    try {
      const rendered = await renderPdfPages(file)
      setPages(rendered)
      setFileName(file.name)
      setSelected(rendered.length === 1 ? 0 : null)
    } catch (err) {
      setResult(t('modal.pdfImportError', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setBusy(false)
    }
  }

  async function addSelectedPage() {
    if (selected === null) return
    const notebook = notebooks.find((n) => n.id === selectedNotebookId)
    if (!notebook) {
      setResult(t('modal.selectNotebookFirst'))
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const rp = pages[selected]
      const template = notebook.pages[0]?.template ?? 'blank'
      await addPage(template)
      const n = useAppStore.getState().notebooks.find((nn) => nn.id === notebook.id)
      if (!n) return
      const p = n.pages[n.pages.length - 1]
      p.pdf = {
        dataUrl: rp.dataUrl,
        name: fileName,
        pageNumber: n.pages.length,
      }
      p.updatedAt = Date.now()
      n.updatedAt = Date.now()
      await persistNotebook(n)
      close()
    } catch (err) {
      setResult(t('modal.pdfImportError', { message: err instanceof Error ? err.message : String(err) }))
      setBusy(false)
    }
  }

  return (
    <>
      <h2>{t('modal.importPdf')}</h2>
      <p className="modal-hint">
        {t('modal.importPdfHint')}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {pages.length === 0 && (
        <button className="btn primary" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? t('modal.processingPdf') : t('modal.choosePdf')}
        </button>
      )}
      {pages.length > 0 && (
        <>
          <div className="form-label">{t('modal.choosePdfPage')}</div>
          <div className="pdf-pages-grid">
            {pages.map((rp, i) => (
              <button
                key={i}
                className={`pdf-page-card ${selected === i ? 'active' : ''}`}
                onClick={() => setSelected(i)}
              >
                <img src={rp.dataUrl} alt={t('modal.pdfPageAlt', { number: i + 1 })} />
                <span className="pdf-page-number">{i + 1}</span>
              </button>
            ))}
          </div>
          <button className="btn small" onClick={() => inputRef.current?.click()} disabled={busy}>
            {t('modal.choosePdf')}
          </button>
          <div className="modal-actions">
            <button
              className="btn primary"
              onClick={addSelectedPage}
              disabled={busy || selected === null}
            >
              {busy ? t('modal.processingPdf') : t('modal.addSelectedPage')}
            </button>
            <button className="btn" onClick={close}>{t('modal.close')}</button>
          </div>
        </>
      )}
      {result && <div className="modal-result">{result}</div>}
    </>
  )
}

function ImportPdfNoteModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const folders = useAppStore((s) => s.folders)
  const selectedFolderId = useAppStore((s) => s.selectedFolderId)
  const importPdfNotebook = useAppStore((s) => s.importPdfNotebook)
  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState<string | null>(selectedFolderId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const rendered = await renderPdfPages(file)
      const noteName = name.trim() || file.name.replace(/\.pdf$/i, '')
      await importPdfNotebook(noteName, folderId, rendered)
      close()
    } catch (err) {
      setError(t('modal.pdfImportError', { message: err instanceof Error ? err.message : String(err) }))
      setBusy(false)
    }
  }

  return (
    <>
      <h2>{t('modal.pdfAsNote')}</h2>
      <p className="modal-hint">
        {t('modal.pdfNoteHint')}
      </p>
      <label className="form-label">{t('modal.notebookName')}</label>
      <input
        className="form-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('modal.placeholderUseFileName')}
      />
      <label className="form-label">{t('modal.folder')}</label>
      <select className="form-input" value={folderId ?? ''} onChange={(e) => setFolderId(e.target.value || null)}>
        <option value="">{t('modal.noFolder')}</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button className="btn primary" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? t('modal.processingPdf') : t('modal.choosePdf')}
      </button>
      {error && <div className="modal-result error">{error}</div>}
      <div className="modal-actions">
        <button className="btn" onClick={close}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

function ExportModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const notebooks = useAppStore((s) => s.notebooks)
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId)
  const currentPageIndex = useAppStore((s) => s.currentPageIndex)
  const [scope, setScope] = useState<'all' | 'single'>('single')
  const [format, setFormat] = useState<'png' | 'pdf'>('png')
  const [busy, setBusy] = useState(false)

  const notebook = notebooks.find((n) => n.id === selectedNotebookId)

  async function submit() {
    if (!notebook) return
    setBusy(true)
    try {
      if (format === 'png') {
        if (scope === 'single') {
          await exportPageAsPng(notebook.pages[currentPageIndex], `${safeName(notebook.name)}-pagina-${currentPageIndex + 1}.png`)
        } else {
          for (let i = 0; i < notebook.pages.length; i++) {
            await exportPageAsPng(notebook.pages[i], `${safeName(notebook.name)}-pagina-${i + 1}.png`)
          }
        }
      } else {
        if (scope === 'single') {
          await exportPagesAsPdf([notebook.pages[currentPageIndex]], `${safeName(notebook.name)}-pagina-${currentPageIndex + 1}.pdf`)
        } else {
          await exportPagesAsPdf(notebook.pages, `${safeName(notebook.name)}.pdf`)
        }
      }
    } finally {
      setBusy(false)
      close()
    }
  }

  return (
    <>
      <h2>{t('modal.exportNotebooks')}</h2>
      <label className="form-label">{t('modal.pages')}</label>
      <div className="radio-group">
        <label><input type="radio" checked={scope === 'single'} onChange={() => setScope('single')} /> {t('modal.onlyCurrentPage')}</label>
        <label><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> {t('modal.allPages')}</label>
      </div>
      <label className="form-label">{t('modal.format')}</label>
      <div className="radio-group">
        <label><input type="radio" checked={format === 'png'} onChange={() => setFormat('png')} /> {t('modal.imagePng')}</label>
        <label><input type="radio" checked={format === 'pdf'} onChange={() => setFormat('pdf')} /> {t('modal.pdfFormat')}</label>
      </div>
      <div className="modal-actions">
        <button className="btn primary" onClick={submit} disabled={busy}>
          {busy ? t('modal.exporting') : t('modal.export')}
        </button>
        <button className="btn" onClick={close}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

function SettingsModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const setShortcut = useAppStore((s) => s.setShortcut)
  const folders = useAppStore((s) => s.folders)
  const notebooks = useAppStore((s) => s.notebooks)
  const replaceAllData = useAppStore((s) => s.replaceAllData)
  const [tab, setTab] = useState<'geral' | 'atalhos' | 'nuvem' | 'aparencia' | 'logs'>('geral')
  const [capturing, setCapturing] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [dirBusy, setDirBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [logs, setLogs] = useState(() => logger.getLogs())
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (tab === 'logs') {
      const interval = setInterval(() => {
        setLogs(logger.getLogs())
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [tab])
  const [conflict, setConflict] = useState<{
    action: ShortcutActionId
    value: string
    existing: ShortcutActionId
  } | null>(null)

  useEffect(() => {
    if (!capturing) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const normalized = normalizeKey(e)
      if (!normalized) return
      const action = capturing as ShortcutActionId
      const shortcuts = useAppStore.getState().settings.shortcuts
      const existing = findShortcutAction(shortcuts, normalized)
      if (existing && existing !== action) {
        setConflict({ action, value: normalized, existing })
        setCapturing(null)
        return
      }
      void setShortcut(action, normalized)
      setCapturing(null)
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [capturing, setShortcut])

  async function applyReplace() {
    if (!conflict) return
    const { action, value, existing } = conflict
    const shortcuts = {
      ...useAppStore.getState().settings.shortcuts,
      [action]: value,
      [existing]: '',
    }
    await setSettings({ shortcuts })
    setConflict(null)
  }

  async function applySwap() {
    if (!conflict) return
    const { action, value, existing } = conflict
    const current = useAppStore.getState().settings.shortcuts[action] ?? ''
    const shortcuts = {
      ...useAppStore.getState().settings.shortcuts,
      [action]: value,
      [existing]: current,
    }
    await setSettings({ shortcuts })
    setConflict(null)
  }

  function cancelConflict() {
    setConflict(null)
  }

  async function doExport() {
    setBackupBusy(true)
    setBackupMsg(null)
    const ok = await exportBackup(folders, notebooks, settings)
    setBackupBusy(false)
    setBackupMsg(ok ? t('modal.backupExported') : t('modal.backupExportFailed'))
  }

  async function doImport() {
    setBackupBusy(true)
    setBackupMsg(null)
    const data = await importBackup()
    setBackupBusy(false)
    if (!data) {
      setBackupMsg(t('modal.backupImportFailed'))
      return
    }
    if (!confirm(t('modal.importBackupConfirm'))) {
      return
    }
    await replaceAllData(data.folders, data.notebooks, data.settings)
    setBackupMsg(t('modal.backupImported'))
  }

  return (
    <>
      <h2>{t('modal.settings')}</h2>
      <div className="tabs">
        <button className={`tab ${tab === 'geral' ? 'active' : ''}`} onClick={() => setTab('geral')}>{t('modal.tabGeneral')}</button>
        <button className={`tab ${tab === 'aparencia' ? 'active' : ''}`} onClick={() => setTab('aparencia')}>{t('modal.tabAppearance')}</button>
        <button className={`tab ${tab === 'atalhos' ? 'active' : ''}`} onClick={() => setTab('atalhos')}>{t('modal.tabShortcuts')}</button>
        <button className={`tab ${tab === 'nuvem' ? 'active' : ''}`} onClick={() => setTab('nuvem')}>{t('modal.tabCloud')}</button>
        <button className={`tab ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>{t('modal.tabLogs')}</button>
      </div>

      {tab === 'geral' && (
        <div className="settings-body">
          <div className="settings-section">
            <div className="settings-section-title">{t('modal.sectionPreferences')}</div>
            <label className="form-label">{t('modal.defaultPageTemplate')}</label>
            <select
              className="form-input"
              value={settings.defaultTemplate}
              onChange={(e) => setSettings({ defaultTemplate: e.target.value as TemplateId })}
            >
              {templateOptions(t).map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            <label className="form-label">{t('modal.language')}</label>
            <select className="form-input" value={settings.language} onChange={(e) => setSettings({ language: e.target.value })}>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>{lang.label}</option>
              ))}
            </select>
            <div className="settings-check">
              <label>
                <input
                  type="checkbox"
                  checked={settings.autoSave}
                  onChange={(e) => setSettings({ autoSave: e.target.checked })}
                />
                {t('modal.autoSave')}
              </label>
              <span className="modal-hint">{t('modal.autoSaveHint')}</span>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">{t('modal.sectionDirectory')}</div>
            <label className="form-label">{t('modal.notesDirectory')}</label>
            <div className="panel-row">
              <input
                className="form-input"
                value={settings.saveDirectory}
                placeholder={t('modal.noDirectorySelected')}
                readOnly
              />
              <button
                className="btn"
                disabled={dirBusy}
                onClick={async () => {
                  setDirBusy(true)
                  try {
                    const result = await pickSaveDirectory(settings)
                    if (result) {
                      await setSettings({
                        saveDirectory: result.path,
                        saveDirectoryHandle: result.handle ?? null,
                      })
                    }
                  } finally {
                    setDirBusy(false)
                  }
                }}
              >
                {dirBusy ? t('modal.selecting') : t('modal.select')}
              </button>
            </div>
            <div className="modal-hint">
              {settings.saveDirectory
                ? t('modal.saveDirHint', { dir: settings.saveDirectory })
                : t('modal.saveDirHintEmpty')}
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">{t('modal.sectionBackup')}</div>
            <div className="settings-reset">
              <div className="panel-label">{t('modal.notesBackup')}</div>
              <p className="modal-hint">
                {t('modal.backupHint')}
              </p>
              <div className="panel-row">
                <button className="btn" onClick={doExport} disabled={backupBusy}>
                  {backupBusy ? t('modal.processing') : t('modal.exportBackup')}
                </button>
                <button className="btn" onClick={doImport} disabled={backupBusy}>
                  {backupBusy ? t('modal.processing') : t('modal.importBackup')}
                </button>
              </div>
              {backupMsg && <div className="modal-result">{backupMsg}</div>}
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">{t('modal.sectionRestore')}</div>
            <div className="settings-reset">
              <div className="panel-label">{t('modal.restoreShortcutsAndDir')}</div>
              <p className="modal-hint">
                {t('modal.restoreDefaultsHint')}
              </p>
              <button
                className="btn"
                onClick={() => {
                  if (confirm(t('modal.restoreConfirm'))) {
                    void setSettings({
                      saveDirectory: '',
                      saveDirectoryHandle: null,
                    })
                  }
                }}
              >
                {t('modal.restoreShortcutsAndDir')}
              </button>
            </div>
          </div>
          <div className="settings-section">
            <div className="settings-section-title">{t('modal.sectionVersion')}</div>
            <div className="settings-reset">
              <div className="panel-label">{t('modal.currentVersion', { version: APP_VERSION })}</div>
              <p className="modal-hint">
                {updateMsg || t('modal.upToDate')}
              </p>
              <button
                className="btn"
                disabled={updateBusy}
                onClick={async () => {
                  setUpdateBusy(true)
                  setUpdateMsg(t('modal.checkingUpdates'))
                  const res = await checkForUpdates()
                  setUpdateBusy(false)
                  if (!res) {
                    setUpdateMsg(t('modal.noUpdateFound'))
                    return
                  }
                  if (res.available) {
                    setUpdateMsg(null)
                    useUiStore.getState().open('update', { info: res })
                  } else {
                    setUpdateMsg(t('modal.upToDate'))
                  }
                }}
              >
                {updateBusy ? t('modal.checkingUpdates') : t('modal.checkForUpdates')}
              </button>
              {updateMsg && <div className="modal-result">{updateMsg}</div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'aparencia' && (
        <div className="settings-body">
          <div className="settings-section">
            <div className="settings-section-title">{t('modal.sectionAppearance')}</div>

            <label className="form-label">{t('modal.theme')}</label>
            <select
              className="form-input"
              value={settings.theme}
              onChange={(e) => setSettings({ theme: e.target.value as AppTheme })}
            >
              <option value="system">{t('modal.themeSystem')}</option>
              <option value="light">{t('modal.themeLight')}</option>
              <option value="dark">{t('modal.themeDark')}</option>
            </select>

            <div className="settings-check">
              <label>
                <input
                  type="checkbox"
                  checked={settings.hideTopBar}
                  onChange={(e) => setSettings({ hideTopBar: e.target.checked })}
                />
                {t('modal.hideTopBar')}
              </label>
              <span className="modal-hint">{t('modal.hideTopBarHint')}</span>
            </div>
            <div className="settings-check">
              <label>
                <input
                  type="checkbox"
                  checked={settings.hideToolbar}
                  onChange={(e) => setSettings({ hideToolbar: e.target.checked })}
                />
                {t('modal.hideToolbar')}
              </label>
              <span className="modal-hint">{t('modal.hideToolbarHint')}</span>
            </div>
            <div className="settings-check">
              <label>
                <input
                  type="checkbox"
                  checked={settings.hideSidebar}
                  onChange={(e) => setSettings({ hideSidebar: e.target.checked })}
                />
                {t('modal.hideSidebar')}
              </label>
              <span className="modal-hint">{t('modal.hideSidebarHint')}</span>
            </div>
            <div className="settings-check">
              <label>
                <input
                  type="checkbox"
                  checked={settings.hidePageList}
                  onChange={(e) => setSettings({ hidePageList: e.target.checked })}
                />
                {t('modal.hidePageList')}
              </label>
              <span className="modal-hint">{t('modal.hidePageListHint')}</span>
            </div>
            <div className="settings-check">
              <label>
                <input
                  type="checkbox"
                  checked={settings.hidePageCount}
                  onChange={(e) => setSettings({ hidePageCount: e.target.checked })}
                />
                {t('modal.hidePageCount')}
              </label>
              <span className="modal-hint">{t('modal.hidePageCountHint')}</span>
            </div>
            <div className="settings-check">
              <label>
                <input
                  type="checkbox"
                  checked={settings.hideToolCursor}
                  onChange={(e) => setSettings({ hideToolCursor: e.target.checked })}
                />
                {t('modal.hideToolCursor')}
              </label>
              <span className="modal-hint">{t('modal.hideToolCursorHint')}</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'atalhos' && (
        <div className="settings-body shortcuts-list">
          <div className="modal-hint">{t('modal.shortcutsHint')}</div>
          <input
            className="form-input shortcuts-search"
            type="search"
            placeholder={t('modal.searchShortcuts')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {conflict && (
            <div className="shortcut-conflict">
              <div className="panel-label">{t('modal.shortcutConflictTitle')}</div>
              <p className="modal-hint">
                {t('modal.shortcutConflictMsg', {
                  key: formatShortcut(conflict.value),
                  other: shortcutLabel(conflict.existing),
                })}
              </p>
              <div className="delete-scope-options">
                <button className="delete-scope-option" onClick={applyReplace}>
                  <span className="delete-scope-title">{t('modal.shortcutConflictReplace')}</span>
                  <span className="modal-hint">
                    {t('modal.shortcutConflictReplaceHint', {
                      action: shortcutLabel(conflict.action),
                      other: shortcutLabel(conflict.existing),
                      key: formatShortcut(conflict.value),
                    })}
                  </span>
                </button>
                <button className="delete-scope-option" onClick={applySwap}>
                  <span className="delete-scope-title">{t('modal.shortcutConflictSwap')}</span>
                  <span className="modal-hint">
                    {t('modal.shortcutConflictSwapHint', {
                      action: shortcutLabel(conflict.action),
                      other: shortcutLabel(conflict.existing),
                      key: formatShortcut(conflict.value),
                      old: formatShortcut(settings.shortcuts[conflict.action] ?? ''),
                    })}
                  </span>
                </button>
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={cancelConflict}>{t('modal.cancel')}</button>
              </div>
            </div>
          )}
          {(() => {
            const query = search.trim().toLowerCase()
            const allActions = Object.keys(settings.shortcuts) as ShortcutActionId[]
            const actions = query
              ? allActions.filter((a) => shortcutLabel(a).toLowerCase().includes(query))
              : allActions
            return (
              <>
                {actions.length === 0 && <div className="modal-hint">{t('modal.searchNoResults')}</div>}
                {actions.map((action) => (
                  <div
                    key={action}
                    className={`shortcut-row ${conflict && (conflict.action === action || conflict.existing === action) ? 'conflict' : ''}`}
                  >
                    <span className="shortcut-label">{shortcutLabel(action)}</span>
                    <button
                      className={`shortcut-value ${capturing === action ? 'capturing' : ''}`}
                      onClick={() => {
                        setConflict(null)
                        setCapturing(capturing === action ? null : action)
                      }}
                    >
                      {capturing === action ? t('modal.pressKeys') : formatShortcut(settings.shortcuts[action])}
                    </button>
                  </div>
                ))}
              </>
            )
          })()}

          <div className="settings-section" style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
            <div className="settings-reset">
              <div className="panel-label">{t('modal.restoreShortcuts')}</div>
              <p className="modal-hint">
                {t('modal.restoreShortcutsConfirm')}
              </p>
              <button
                className="btn"
                onClick={() => {
                  if (confirm(t('modal.restoreShortcutsConfirm'))) {
                    void setSettings({
                      shortcuts: { ...DEFAULT_SHORTCUTS },
                    })
                  }
                }}
              >
                {t('modal.restoreShortcuts')}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'nuvem' && (
        <div className="settings-body">
          <label className="form-label">{t('modal.webdavUrl')}</label>
          <input className="form-input" placeholder={t('modal.webdavUrlPlaceholder')}
            value={settings.cloud.webdavUrl}
            onChange={(e) => setSettings({ cloud: { ...settings.cloud, webdavUrl: e.target.value } })} />
          <label className="form-label">{t('modal.username')}</label>
          <input className="form-input" value={settings.cloud.webdavUsername}
            onChange={(e) => setSettings({ cloud: { ...settings.cloud, webdavUsername: e.target.value } })} />
          <label className="form-label">{t('modal.password')}</label>
          <div className="password-field">
            <input
              className="form-input"
              type={showPassword ? 'text' : 'password'}
              value={settings.cloud.webdavPassword}
              onChange={(e) => setSettings({ cloud: { ...settings.cloud, webdavPassword: e.target.value } })}
            />
            <button
              type="button"
              className="password-toggle"
              title={showPassword ? t('modal.hidePassword') : t('modal.showPassword')}
              aria-label={showPassword ? t('modal.hidePassword') : t('modal.showPassword')}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
          <label className="form-label">{t('modal.remoteBaseFolder')}</label>
          <input className="form-input" value={settings.cloud.webdavPath}
            onChange={(e) => setSettings({ cloud: { ...settings.cloud, webdavPath: e.target.value } })} />
          <div className="settings-check">
            <label>
              <input
                type="checkbox"
                checked={settings.cloud.autoSync}
                onChange={(e) =>
                  setSettings({ cloud: { ...settings.cloud, autoSync: e.target.checked } })
                }
              />
              {t('modal.autoSync')}
            </label>
            <span className="modal-hint">
              {t('modal.autoSyncHint')}
            </span>
          </div>
          <div className="modal-hint">
            {t('modal.webdavHint')}
          </div>
          <div className="modal-hint">
            {t('modal.koofrHintA')} <code>https://app.koofr.net/dav</code> {t('modal.koofrHintB')} {t('modal.koofrHintC', { path: settings.cloud.webdavPath })}
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="settings-body logs-list">
          <div className="modal-actions" style={{ marginTop: 0, marginBottom: '12px' }}>
            <button className="btn" onClick={() => {
              const text = logs.map(l => `[${new Date(l.timestamp).toLocaleString()}] [${l.level.toUpperCase()}] ${l.message}\n${l.details || ''}`).join('\n---\n')

              const copyToClipboard = (str: string) => {
                if (navigator.clipboard && window.isSecureContext) {
                  return navigator.clipboard.writeText(str)
                } else {
                  const textArea = document.createElement("textarea")
                  textArea.value = str
                  textArea.style.position = "fixed"
                  textArea.style.left = "-999999px"
                  textArea.style.top = "-999999px"
                  document.body.appendChild(textArea)
                  textArea.focus()
                  textArea.select()
                  return new Promise<void>((res, rej) => {
                    document.execCommand('copy') ? res() : rej()
                    textArea.remove()
                  })
                }
              }

              copyToClipboard(text).then(() => {
                alert(t('modal.logsCopied'))
              }).catch(err => {
                logger.error('Failed to copy logs', err)
              })
            }}>{t('modal.copyLogs')}</button>
            <button className="btn danger" onClick={() => {
              logger.clear()
              setLogs([])
            }}>{t('modal.clearLogs')}</button>
          </div>
          {logs.length === 0 ? (
            <div className="modal-hint">{t('modal.noLogs')}</div>
          ) : (
            <div className="logs-container">
              {logs.slice().reverse().map((log, i) => (
                <div key={i} className={`log-entry ${log.level}`}>
                  <div className="log-header">
                    <span className="log-time">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span className="log-level">{log.level.toUpperCase()}</span>
                  </div>
                  <div className="log-message">{log.message}</div>
                  {log.details && (
                    <pre className="log-details">{log.details}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="modal-actions">
        <button className="btn" onClick={close}>{t('modal.close')}</button>
      </div>
    </>
  )
}

function CloudSyncModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const settings = useAppStore((s) => s.settings)
  const syncNow = useAppStore((s) => s.syncNow)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function test() {
    setBusy(true)
    setError(null)
    setStatus(t('modal.testingConnection'))
    const res = await testWebdavConnection(settings.cloud)
    setStatus(res.ok ? res.message : t('modal.connectionFailed'))
    if (!res.ok) setError(res.message)
    setBusy(false)
  }

  async function doSync() {
    if (!settings.cloud.webdavUrl) {
      setError(t('modal.configureWebdavFirst'))
      return
    }
    setBusy(true)
    setError(null)
    setStatus(t('modal.syncing'))
    const result = await syncNow()
    if (!result) {
      setStatus(t('modal.syncInProgress'))
      setBusy(false)
      return
    }
    if (result.conflicts.length > 0) {
      setStatus(
        t('modal.waitingConflictResolution', { count: result.conflicts.length }),
      )
    } else {
      setStatus(
        t('modal.syncSummary', { pushed: result.pushed.length, pulled: result.pulled.length, deleted: result.deleted.length }),
      )
    }
    if (result.errors.length > 0) setError(result.errors.join(' · '))
    setBusy(false)
  }

  async function doCreateFolders() {
    setBusy(true)
    setError(null)
    setStatus(t('modal.creatingFolders'))
    const res = await ensureRemoteStructure(settings.cloud)
    setStatus(res.ok ? res.message : t('modal.createFoldersFailed'))
    if (!res.ok) setError(res.message)
    setBusy(false)
  }

  return (
    <>
      <h2>{t('modal.cloudSync')}</h2>
      <p className="modal-hint">
        {t('modal.cloudSyncHint')}
      </p>
      <div className="cloud-status">
        {settings.cloud.enabled && settings.cloud.lastSyncAt ? (
          <span>{t('modal.lastSync', { time: new Date(settings.cloud.lastSyncAt).toLocaleString() })}</span>
        ) : (
          <span>{t('modal.noSyncYet')}</span>
        )}
      </div>
      {!settings.cloud.webdavUrl && (
        <div className="modal-hint warn">
          {t('modal.webdavFirst')}
        </div>
      )}
      {status && <div className="modal-result">{status}</div>}
      {error && <div className="modal-result error">{error}</div>}
      <div className="modal-actions">
        <button className="btn" onClick={test} disabled={busy}>{t('modal.testConnection')}</button>
        <button className="btn" onClick={doCreateFolders} disabled={busy || !settings.cloud.webdavUrl}>{t('modal.createFolders')}</button>
        <button className="btn primary" onClick={doSync} disabled={busy}>
          {busy ? t('modal.syncing') : t('modal.syncNow')}
        </button>
        <button className="btn" onClick={close}>{t('modal.close')}</button>
      </div>
    </>
  )
}

function getConflictOptions(t: (key: string, params?: Record<string, string | number>) => string): Record<SyncConflictItem['conflictType'], { value: ConflictChoice; label: string }[]> {
  return {
    bothModified: [
      { value: 'keepLocal', label: t('modal.keepLocal') },
      { value: 'useServer', label: t('modal.useServer') },
      { value: 'keepBoth', label: t('modal.keepBoth') },
    ],
    deletedLocalModifiedRemote: [
      { value: 'confirmDelete', label: t('modal.confirmDelete') },
      { value: 'restoreFromServer', label: t('modal.restoreFromServer') },
    ],
    deletedRemoteModifiedLocal: [
      { value: 'keepLocal', label: t('modal.keepLocal') },
      { value: 'confirmDelete', label: t('modal.confirmDeleteServer') },
    ],
  }
}

function SyncConflictModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const resolveConflicts = useAppStore((s) => s.resolveConflicts)
  const conflicts = useUiStore((s) => s.modalData.conflicts) as SyncConflictItem[]
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>(() => {
    const opts = getConflictOptions(t)
    const init: Record<string, ConflictChoice> = {}
    for (const c of conflicts) {
      const list = opts[c.conflictType]
      if (list && list.length > 0) init[c.id] = list[0].value
    }
    return init
  })

  if (!conflicts || conflicts.length === 0) return null

  function applyToAll() {
    const first = conflicts[0]
    const choice = choices[first.id]
    const next: Record<string, ConflictChoice> = {}
    for (const c of conflicts) next[c.id] = choice
    setChoices(next)
  }

  async function confirm() {
    await resolveConflicts(choices)
    close()
  }

  return (
    <>
      <h2>{t('modal.syncConflicts')}</h2>
      <p className="modal-hint">
        {t('modal.syncConflictsHint')}
      </p>
      {conflicts.map((c) => {
        const opts = getConflictOptions(t)[c.conflictType] ?? []
        return (
          <div key={c.id} className="conflict-item">
            <div className="conflict-name">
              {c.name}
              {c.kind === 'folders' && <span className="conflict-tag">{t('modal.foldersTag')}</span>}
            </div>
            <div className="modal-hint">
              {t('modal.localTime', { time: c.localUpdatedAt ? new Date(c.localUpdatedAt).toLocaleString() : '—' })} ·
              {t('modal.serverTime', { time: c.remoteUpdatedAt ? new Date(c.remoteUpdatedAt).toLocaleString() : '—' })}
            </div>
            {opts.map((opt) => (
              <label key={opt.value} className="conflict-option">
                <input
                  type="radio"
                  name={`conflict-${c.id}`}
                  value={opt.value}
                  checked={choices[c.id] === opt.value}
                  onChange={() => setChoices((prev) => ({ ...prev, [c.id]: opt.value }))}
                />
                {opt.label}
              </label>
            ))}
          </div>
        )
      })}
      <div className="modal-actions">
        <button className="btn" onClick={applyToAll}>{t('modal.applyToAll')}</button>
        <button className="btn primary" onClick={confirm}>{t('modal.confirm')}</button>
        <button className="btn" onClick={close}>{t('modal.close')}</button>
      </div>
    </>
  )
}

function MoveModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const openModal = useUiStore((s) => s.openModal)
  const modalData = useUiStore((s) => s.modalData)
  const folders = useAppStore((s) => s.folders)
  const moveNotebook = useAppStore((s) => s.moveNotebook)
  const copyNotebook = useAppStore((s) => s.copyNotebook)
  const moveFolder = useAppStore((s) => s.moveFolder)
  const notebooks = useAppStore((s) => s.notebooks)
  const [folderId, setFolderId] = useState<string | null>(null)

  const id = modalData.id as string | undefined
  const isFolder = openModal === 'moveFolder'
  const isCopy = openModal === 'copyNotebook'

  const itemName = isFolder
    ? folders.find((f) => f.id === id)?.name
    : notebooks.find((n) => n.id === id)?.name

  async function submit() {
    if (!id) return
    if (isFolder) {
      await moveFolder(id, folderId)
    } else if (isCopy) {
      await copyNotebook(id, folderId)
    } else {
      await moveNotebook(id, folderId)
    }
    close()
  }

  return (
    <>
      <h2>{isCopy ? t('modal.copyNotebook') : t('modal.moveItem')}</h2>
      <p className="modal-hint">
        {itemName ? (
          <>
            <strong>{itemName}</strong>
            {isCopy ? t('modal.willBeCopied') : t('modal.willBeMoved')} {t('modal.toSelectedFolder')}
          </>
        ) : (
          t('modal.selectDestination')
        )}
      </p>
      <label className="form-label">{t('modal.destinationFolder')}</label>
      <select
        className="form-input"
        value={folderId ?? ''}
        onChange={(e) => setFolderId(e.target.value || null)}
      >
        <option value="">{t('modal.noFolder')}</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      <div className="modal-actions">
        <button className="btn primary" onClick={submit}>
          {isCopy ? t('modal.copy') : t('modal.move')}
        </button>
        <button className="btn" onClick={close}>{t('modal.cancel')}</button>
      </div>
    </>
  )
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

function formatShortcut(s: string): string {
  return s.replace(/\+/g, '+')
}

function UpdateModal() {
  const { t } = useI18n()
  const close = useUiStore((s) => s.close)
  const modalData = useUiStore((s) => s.modalData)
  const setSettings = useAppStore((s) => s.setSettings)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const info = modalData.info as { latestVersion: string; releaseNotes: string; url: string }
  const isDesktop = !!window.inkfolioDesktop

  useEffect(() => {
    if (!isDesktop || !window.inkfolioDesktop) return
    const desktop = window.inkfolioDesktop
    const unA = desktop.onUpdateAvailable(() => setDownloading(true))
    const unD = desktop.onUpdateDownloaded(() => {
      setDownloading(false)
      setDownloaded(true)
    })
    const unE = desktop.onUpdateError((msg: string) => {
      setDownloading(false)
      setError(msg)
    })
    return () => {
      unA()
      unD()
      unE()
    }
  }, [isDesktop])

  function doUpdate() {
    if (isDesktop && window.inkfolioDesktop) {
      if (downloaded) {
        window.inkfolioDesktop.installUpdate()
      } else {
        setDownloading(true)
        void window.inkfolioDesktop.downloadUpdate()
      }
    } else {
      window.open(info.url, '_blank')
      close()
    }
  }

  function ignore() {
    void setSettings({ ignoreVersion: info.latestVersion })
    close()
  }

  return (
    <>
      <h2>{t('modal.updateAvailable')}</h2>
      <p className="modal-hint">
        {t('modal.updateAvailableDesc', { version: info.latestVersion })}
      </p>

      {info.releaseNotes && (
        <div className="update-notes">
          <h3>{t('modal.updateNotes')}</h3>
          <div
            className="update-notes-content"
            dangerouslySetInnerHTML={{ __html: info.releaseNotes }}
          />
        </div>
      )}

      {error && <div className="modal-result error">{error}</div>}

      <div className="modal-actions">
        <button className="btn primary" onClick={doUpdate} disabled={downloading}>
          {downloading
            ? t('modal.processing')
            : downloaded
              ? t('modal.apply')
              : t('modal.downloadUpdate')}
        </button>
        <button className="btn" onClick={close} disabled={downloading}>
          {t('modal.later')}
        </button>
        <button className="btn" onClick={ignore} disabled={downloading}>
          {t('modal.dontShowAgain')}
        </button>
      </div>
    </>
  )
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
