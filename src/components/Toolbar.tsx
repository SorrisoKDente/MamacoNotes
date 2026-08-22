import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useAppStore } from '../store'
import { useTextStore } from '../textStore'
import { PRESET_COLORS, normalizeHex } from '../utils/colors'
import { getSystemFonts } from '../utils/fonts'
import type { EraserMode, SelectMode, TextAlign, TextDirection, TextMarker, ToolKind } from '../types'
import { getActiveLayer } from '../types'
import { useI18n } from '../i18n'

export function Toolbar() {
  const { t } = useI18n()
  const tool = useAppStore((s) => s.tool)
  const setTool = useAppStore((s) => s.setTool)
  const settings = useAppStore((s) => s.settings)
  const canUndo = useAppStore((s) => s.canUndo)
  const canRedo = useAppStore((s) => s.canRedo)
  const undo = useAppStore((s) => s.undo)
  const redo = useAppStore((s) => s.redo)

  const [panelOpen, setPanelOpen] = useState(false)
  const rotationOpen = useAppStore((s) => s.rotationOpen)
  const setRotationOpen = useAppStore((s) => s.setRotationOpen)
  const toolbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onEsc = () => {
      setPanelOpen(false)
      setRotationOpen(false)
    }
    window.addEventListener('ink:esc', onEsc)
    return () => window.removeEventListener('ink:esc', onEsc)
  }, [setRotationOpen])

  useEffect(() => {
    const onPointerDownOutside = (e: PointerEvent) => {
      const el = toolbarRef.current
      if (!el) return
      if (!el.contains(e.target as Node)) {
        setPanelOpen(false)
        setRotationOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDownOutside)
    return () => document.removeEventListener('pointerdown', onPointerDownOutside)
  }, [setRotationOpen])

  function selectTool(t: ToolKind) {
    setRotationOpen(false)
    if (t === tool) {
      setPanelOpen((v) => !v)
    } else {
      setTool(t)
      setPanelOpen(true)
    }
  }

  function toggleRotation() {
    setPanelOpen(false)
    setRotationOpen(!rotationOpen)
  }

  return (
    <div ref={toolbarRef} className="toolbar">
      {rotationOpen && <RotationPanel />}
      {panelOpen && <ToolPanel tool={tool} />}

      <div className="toolbar-buttons">
        <ToolbarButton
          icon={<IconPen />}
          label={t('tool.pen')}
          active={tool === 'pen'}
          onClick={() => selectTool('pen')}
          shortcut={settings.shortcuts.pen}
        />
        <ToolbarButton
          icon={<PenIcon size={settings.lastHighlighterSize} color={settings.lastHighlighterColor} line />}
          label={t('tool.highlighter')}
          active={tool === 'highlighter'}
          onClick={() => selectTool('highlighter')}
          shortcut={settings.shortcuts.highlighter}
        />
        <ToolbarButton
          icon={<IconEraser />}
          label={t('tool.eraser')}
          active={tool === 'eraser'}
          onClick={() => selectTool('eraser')}
          shortcut={settings.shortcuts.eraser}
        />
        <ToolbarButton
          icon={<IconKeyboard />}
          label={t('tool.text')}
          active={tool === 'text'}
          onClick={() => selectTool('text')}
          shortcut={settings.shortcuts.text}
        />
        <ToolbarButton
          icon={<IconCursor />}
          label={t('tool.select')}
          active={tool === 'select'}
          onClick={() => selectTool('select')}
        />
        <ToolbarButton
          icon={<IconHand />}
          label={t('tool.pan')}
          active={tool === 'pan'}
          onClick={() => selectTool('pan')}
        />
        <ToolbarButton
          icon="↻"
          label={t('tool.rotation')}
          active={rotationOpen}
          onClick={toggleRotation}
        />
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-buttons">
        <ToolbarButton icon="↶" label={t('tool.undo')} disabled={!canUndo} onClick={undo} />
        <ToolbarButton icon="↷" label={t('tool.redo')} disabled={!canRedo} onClick={redo} />
      </div>
    </div>
  )
}

function ToolbarButton({
  icon,
  label,
  active,
  onClick,
  shortcut,
  disabled,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick: () => void
  shortcut?: string
  disabled?: boolean
}) {
  return (
    <button
      className={`toolbar-btn ${active ? 'active' : ''}`}
      onClick={onClick}
      title={label + (shortcut ? ` (${shortcut})` : '')}
      disabled={disabled}
    >
      <span className="toolbar-btn-icon">{icon}</span>
      <span className="toolbar-btn-label">{label}</span>
    </button>
  )
}

function PenIcon({ size, color, line = false }: { size: number; color: string; line?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const dim = 22
    c.width = dim * dpr
    c.height = dim * dpr
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, dim, dim)
    const r = Math.max(1, Math.min(8, size / 2))
    if (line) {
      ctx.lineCap = 'round'
      ctx.lineWidth = r
      ctx.strokeStyle = color
      ctx.beginPath()
      ctx.moveTo(5, 16)
      ctx.lineTo(17, 6)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(dim / 2, dim / 2, r, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }
  }, [size, color, line])

  return <canvas ref={ref} className="pen-icon-canvas" />
}

function ToolPanel({ tool }: { tool: ToolKind }) {
  if (tool === 'pen') return <PenPanel />
  if (tool === 'highlighter') return <PenPanel highlighter />
  if (tool === 'eraser') return <EraserPanel />
  if (tool === 'text') return <TextPanel />
  if (tool === 'select') return <SelectPanel />
  if (tool === 'pan') return <PanPanel />
  return null
}

function clampNum(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function SizeStepper({
  value,
  min = 1,
  max = 100,
  step = 1,
  onChange,
  unit = 'px',
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  unit?: string
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  function commit() {
    const n = Math.round(Number(draft))
    if (!Number.isNaN(n)) {
      onChange(clampNum(n, min, max))
    } else {
      setDraft(String(value))
    }
  }

  return (
    <div className="size-stepper">
      <button className="stepper-btn" onClick={() => onChange(clampNum(value - step, min, max))} title={t('tool.decrease')}>
        −
      </button>
      <div className="stepper-value-editable">
        <input
          className="stepper-edit"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          title={t('tool.valueEnter', { min, max })}
        />
        <span className="stepper-unit">{unit}</span>
      </div>
      <button className="stepper-btn" onClick={() => onChange(clampNum(value + step, min, max))} title={t('tool.increase')}>
        +
      </button>
    </div>
  )
}

function PenPanel({ highlighter = false }: { highlighter?: boolean }) {
  const { t } = useI18n()
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const [customColor, setCustomColor] = useState(
    highlighter ? settings.lastHighlighterColor : settings.lastPenColor,
  )
  const [hexInput, setHexInput] = useState(
    (highlighter ? settings.lastHighlighterColor : settings.lastPenColor).replace('#', ''),
  )
  const [showHex, setShowHex] = useState(false)

  const currentColor = highlighter ? settings.lastHighlighterColor : settings.lastPenColor
  const currentSize = highlighter ? settings.lastHighlighterSize : settings.lastPenSize

  function applyColor(color: string) {
    setCustomColor(color)
    setHexInput(color.replace('#', ''))
    if (highlighter) setSettings({ lastHighlighterColor: color })
    else setSettings({ lastPenColor: color })
  }

  function applyHex(value: string) {
    const hex = normalizeHex(value)
    if (hex) applyColor(hex)
  }

  return (
    <div className="tool-panel">
      <div className="panel-label">
        {highlighter ? t('tool.highlighterThickness') : t('tool.penThickness')}
      </div>
      <SizeStepper
        value={currentSize}
        onChange={(v) =>
          highlighter ? setSettings({ lastHighlighterSize: v }) : setSettings({ lastPenSize: v })
        }
      />
      <div className="panel-label">{t('tool.color')}</div>
      <div className="color-options">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            className={`color-btn ${currentColor === c ? 'active' : ''}`}
            style={{ background: c, borderColor: c === '#ffffff' ? '#999' : c }}
            onClick={() => applyColor(c)}
            title={c}
          />
        ))}
      </div>
      <div className="panel-row">
        <label className="custom-color">
          <input
            type="color"
            value={customColor}
            onChange={(e) => applyColor(e.target.value)}
            title={t('tool.colorRgb')}
          />
        </label>
        <div className="hex-picker">
          <button className="hex-toggle" onClick={() => setShowHex((v) => !v)} title={t('tool.hexCode')}>
            #
          </button>
          {showHex && (
            <input
              className="hex-input"
              value={hexInput}
              placeholder="RRGGBB"
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={() => applyHex(hexInput)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyHex(hexInput)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function EraserPanel() {
  const { t } = useI18n()
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const mode: EraserMode = settings.eraserMode

  const modes: { id: EraserMode; label: string }[] = [
    { id: 'strokes', label: t('tool.eraseStrokes') },
    { id: 'images', label: t('tool.eraseImage') },
    { id: 'both', label: t('tool.eraseBoth') },
  ]

  return (
    <div className="tool-panel">
      <div className="panel-label">{t('tool.eraseWhat')}</div>
      <div className="mode-buttons">
        {modes.map((m) => (
          <button
            key={m.id}
            className={`mode-btn ${mode === m.id ? 'active' : ''}`}
            onClick={() => setSettings({ eraserMode: m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="panel-hint">{t('tool.eraserHint')}</div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={settings.eraserEraseWholeStroke}
          onChange={(e) => setSettings({ eraserEraseWholeStroke: e.target.checked })}
        />
        <span>
          {t('tool.eraseWholeStroke')}
          <span className="toggle-hint">{t('tool.eraseWholeStrokeHint')}</span>
        </span>
      </label>
      <div className="panel-label">{t('tool.eraserThickness')}</div>
      <SizeStepper value={settings.lastEraserSize} onChange={(v) => setSettings({ lastEraserSize: v })} />
    </div>
  )
}

function SelectPanel() {
  const { t } = useI18n()
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const notebooks = useAppStore((s) => s.notebooks)
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId)
  const currentPageIndex = useAppStore((s) => s.currentPageIndex)
  const mode: SelectMode = settings.lastSelectMode

  const [imageId, setImageId] = useState<string | null>(null)
  const [imageRotation, setImageRotation] = useState(0)
  const [degDraft, setDegDraft] = useState('0')
  const [selDeg, setSelDeg] = useState(0)
  const [selDegDraft, setSelDegDraft] = useState('0')
  const selDegRef = useRef(0)
  const suppressSelBlurRef = useRef(false)
  const suppressImgBlurRef = useRef(false)

  const notebook = notebooks.find((n) => n.id === selectedNotebookId)
  const page = notebook?.pages[currentPageIndex]
  const selectedImage = page ? getActiveLayer(page).images.find((i) => i.id === imageId) : undefined

  useEffect(() => {
    const onImg = (e: Event) => {
      const id = ((e as CustomEvent).detail as { id: string | null }).id ?? null
      setImageId(id)
      if (!id) {
        selDegRef.current = 0
        setSelDeg(0)
        setSelDegDraft('0')
        setImageRotation(0)
        setDegDraft('0')
      }
    }
    window.addEventListener('ink:image-selected', onImg)
    return () => window.removeEventListener('ink:image-selected', onImg)
  }, [])

  useEffect(() => {
    if (selectedImage) {
      const rot = (((selectedImage.rotation % 360) + 360) % 360)
      setImageRotation(rot)
      setDegDraft(String(Math.round(rot)))
      selDegRef.current = rot
      setSelDeg(rot)
      setSelDegDraft(String(Math.round(rot)))
    }
  }, [selectedImage])

  const modes: { id: SelectMode; label: string; hint: string; icon: ReactNode }[] = [
    { id: 'click', label: t('tool.selectClick'), hint: t('tool.selectClickHint'), icon: <IconMouseClick /> },
    { id: 'free', label: t('tool.selectFree'), hint: t('tool.selectFreeHint'), icon: <IconLasso /> },
    { id: 'circle', label: t('tool.selectCircle'), hint: t('tool.selectCircleHint'), icon: <IconSelectCircle /> },
    { id: 'rect', label: t('tool.selectRect'), hint: t('tool.selectRectHint'), icon: <IconSelectRect /> },
  ]

  function dispatch(action: string) {
    window.dispatchEvent(new CustomEvent('ink:selection-action', { detail: action }))
  }

  function liveImageRotation(): number {
    if (!imageId) return 0
    const st = useAppStore.getState()
    const nb = st.notebooks.find((n) => n.id === st.selectedNotebookId)
    const pg = nb?.pages[st.currentPageIndex]
    const img = pg ? getActiveLayer(pg).images.find((i) => i.id === imageId) : undefined
    return img ? (((img.rotation % 360) + 360) % 360) : 0
  }

  function rotateSelection(delta: number) {
    window.dispatchEvent(new CustomEvent('ink:selection-rotate', { detail: { delta } }))
    const next = imageId
      ? liveImageRotation()
      : (((selDegRef.current + delta) % 360) + 360) % 360
    selDegRef.current = next
    setSelDeg(next)
    setSelDegDraft(String(Math.round(next)))
  }

  function commitSelDeg() {
    const n = parseFloat(selDegDraft)
    if (Number.isNaN(n)) {
      setSelDegDraft(String(Math.round(selDegRef.current)))
      return
    }
    const target = ((Math.round(n) % 360) + 360) % 360
    const current = imageId ? liveImageRotation() : selDegRef.current
    const delta = target - current
    if (Math.abs(delta) >= 1) {
      window.dispatchEvent(new CustomEvent('ink:selection-rotate', { detail: { delta } }))
    }
    selDegRef.current = target
    setSelDeg(target)
    setSelDegDraft(String(target))
  }

  function rotateImage(degrees: number) {
    const norm = ((degrees % 360) + 360) % 360
    window.dispatchEvent(new CustomEvent('ink:image-rotate', { detail: norm }))
    setImageRotation(norm)
    setDegDraft(String(Math.round(norm)))
    selDegRef.current = norm
    setSelDeg(norm)
    setSelDegDraft(String(Math.round(norm)))
  }

  function commitImageDeg() {
    const n = parseFloat(degDraft)
    if (Number.isNaN(n)) {
      setDegDraft(String(imageRotation))
      return
    }
    const norm = ((Math.round(n) % 360) + 360) % 360
    rotateImage(norm)
    setDegDraft(String(norm))
  }

  return (
    <div className="tool-panel">
      <div className="panel-label">{t('tool.selectionMode')}</div>
      <div className="mode-buttons">
        {modes.map((m) => (
          <button
            key={m.id}
            className={`mode-btn ${mode === m.id ? 'active' : ''}`}
            title={m.hint}
            onClick={() => setSettings({ lastSelectMode: m.id })}
          >
            <span className="btn-icon">{m.icon}</span>
            <span className="btn-label">{m.label}</span>
          </button>
        ))}
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={settings.selectDelimitedOnly}
          onChange={(e) => setSettings({ selectDelimitedOnly: e.target.checked })}
        />
        <span>
          {t('tool.selectDelimitedOnly')}
          <span className="toggle-hint">{t('tool.selectDelimitedOnlyHint')}</span>
        </span>
      </label>
      {imageId && (
        <div className="image-rotate-section">
          <div className="panel-label">{t('tool.rotateImage')}</div>
          <div className="rotate-stepper">
            <button className="stepper-btn rotate-btn" onClick={() => rotateImage(liveImageRotation() - 15)} title={t('tool.decrease15')}>
              −15°
            </button>
            <div className="deg-input-wrap">
              <input
                className="deg-input"
                value={degDraft}
                onChange={(e) => setDegDraft(e.target.value)}
                onFocus={(e) => e.target.select()}
                onBlur={() => {
                  if (suppressImgBlurRef.current) {
                    suppressImgBlurRef.current = false
                    return
                  }
                  commitImageDeg()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitImageDeg()
                    suppressImgBlurRef.current = true
                    ;(e.target as HTMLInputElement).blur()
                  }
                }}
                title={t('tool.degreesHint')}
              />
              <span className="deg-unit">°</span>
            </div>
            <button className="stepper-btn rotate-btn" onClick={() => rotateImage(liveImageRotation() + 15)} title={t('tool.increase15')}>
              +15°
            </button>
          </div>
          <div className="panel-row">
            <button
              className="btn small"
              onClick={() => rotateImage(0)}
              title={t('tool.resetImageRotation')}
            >
              {t('tool.resetRotation0')}
            </button>
          </div>
          <div className="panel-hint">
            {t('tool.freeRotateImageHint')}
          </div>
        </div>
      )}
      <div className="panel-label">{t('tool.actions')}</div>
      <div className="selection-actions">
        <button className="btn small" onClick={() => dispatch('copy')} title={t('tool.copyTitle')}>
          <IconCopy />
          {t('tool.copy')}
        </button>
        <button className="btn small" onClick={() => dispatch('cut')} title={t('tool.cutTitle')}>
          <IconCut />
          {t('tool.cut')}
        </button>
        <button className="btn small" onClick={() => dispatch('paste')} title={t('tool.pasteTitle')}>
          <IconPaste />
          {t('tool.paste')}
        </button>
        <button className="btn small" onClick={() => dispatch('duplicate')} title={t('tool.duplicateTitle')}>
          <IconDuplicate />
          {t('tool.duplicate')}
        </button>
        <button className="btn small danger" onClick={() => dispatch('delete')} title={t('tool.deleteTitle')}>
          <IconTrash />
          {t('tool.delete')}
        </button>
      </div>
      <div className="panel-label">{t('tool.rotateSelection')}</div>
      <div className="rotate-stepper">
        <button
          className="stepper-btn rotate-btn"
          onClick={() => rotateSelection(-15)}
          title={t('tool.decrease15')}
        >
          −15°
        </button>
        <div className="deg-input-wrap">
          <input
            className="deg-input"
            value={selDegDraft}
            onChange={(e) => setSelDegDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={() => {
              if (suppressSelBlurRef.current) {
                suppressSelBlurRef.current = false
                return
              }
              commitSelDeg()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitSelDeg()
                suppressSelBlurRef.current = true
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            title={t('tool.degreesHint')}
          />
          <span className="deg-unit">°</span>
        </div>
        <button
          className="stepper-btn rotate-btn"
          onClick={() => rotateSelection(15)}
          title={t('tool.increase15')}
        >
          +15°
        </button>
      </div>
      <div className="panel-row">
        <button
          className={`btn small ${selDeg === 0 ? 'active-toggle' : ''}`}
          onClick={() => {
            const current = imageId ? liveImageRotation() : selDegRef.current
            if (current === 0) return
            window.dispatchEvent(new CustomEvent('ink:selection-rotate', { detail: { delta: -current } }))
            selDegRef.current = 0
            setSelDeg(0)
            setSelDegDraft('0')
          }}
          title={t('tool.resetSelectionRotationTitle')}
        >
          {t('tool.resetRotation0')}
        </button>
      </div>
      <div className="panel-hint">
        {t('tool.rotateSelectionHint')}
      </div>
      <div className="panel-hint">
        {t('tool.selectionHint')}
      </div>
    </div>
  )
}

function PanPanel() {
  const { t } = useI18n()
  return (
    <div className="tool-panel">
      <div className="panel-label">{t('tool.moveScreen')}</div>
      <div className="panel-hint">
        {t('tool.moveScreenHint1a')} <b>Alt</b> {t('tool.moveScreenHint1b')}
      </div>
      <div className="panel-hint">
        {t('tool.moveScreenHint2a')} <b>{t('tool.twoFingers')}</b> {t('tool.moveScreenHint2b')}
      </div>
      <div className="panel-hint">
        {t('tool.pinchZoomHint')}
      </div>
    </div>
  )
}

function RotationPanel() {
  const { t } = useI18n()
  const notebooks = useAppStore((s) => s.notebooks)
  const selectedNotebookId = useAppStore((s) => s.selectedNotebookId)
  const currentPageIndex = useAppStore((s) => s.currentPageIndex)
  const rotatePageBy = useAppStore((s) => s.rotatePageBy)
  const updatePage = useAppStore((s) => s.updatePage)
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const page = notebooks.find((n) => n.id === selectedNotebookId)?.pages[currentPageIndex]
  const rotation = (((page?.rotation ?? 0) % 360) + 360) % 360
  const [degDraft, setDegDraft] = useState(String(Math.round(rotation)))

  useEffect(() => {
    setDegDraft(String(Math.round(rotation)))
  }, [rotation])

  function commitDeg() {
    const n = parseFloat(degDraft)
    if (Number.isNaN(n)) {
      setDegDraft(String(Math.round(rotation)))
      return
    }
    const norm = ((Math.round(n) % 360) + 360) % 360
    void updatePage(currentPageIndex, { rotation: norm })
    setDegDraft(String(norm))
  }

  return (
    <div className="tool-panel rotate-screen">
      <div className="panel-label">{t('tool.rotateScreen')}</div>
      <div className="rotate-stepper">
        <button className="stepper-btn rotate-btn" onClick={() => void rotatePageBy(currentPageIndex, -15)} title={t('tool.decrease15')}>
          −15°
        </button>
        <div className="deg-input-wrap">
          <input
            className="deg-input"
            value={degDraft}
            onChange={(e) => setDegDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commitDeg}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitDeg()
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            title={t('tool.degreesHint')}
          />
          <span className="deg-unit">°</span>
        </div>
        <button className="stepper-btn rotate-btn" onClick={() => void rotatePageBy(currentPageIndex, 15)} title={t('tool.increase15')}>
          +15°
        </button>
      </div>
      <div className="panel-row">
        <button
          className={`btn small ${rotation === 0 ? 'active-toggle' : ''}`}
          onClick={() => void updatePage(currentPageIndex, { rotation: 0 })}
          title={t('tool.resetRotationTitle', { shortcut: settings.shortcuts.rotateReset })}
        >
          {t('tool.resetRotationButton', { shortcut: settings.shortcuts.rotateReset })}
        </button>
      </div>
      <div className="panel-hint">{t('tool.rotationHint')}</div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={settings.freeRotate}
          onChange={(e) => setSettings({ freeRotate: e.target.checked })}
        />
        <span>
          {t('tool.freeRotate')}
          <span className="toggle-hint">{t('tool.freeRotateHint')}</span>
        </span>
      </label>
    </div>
  )
}

const FONT_SIZE_MIN = 8
const FONT_SIZE_MAX = 200

function TextPanel() {
  const { t } = useI18n()
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const selectedTextId = useTextStore((s) => s.selectedTextId)
  const draftRotation = useTextStore((s) => s.draftRotation)
  const setDraftRotation = useTextStore((s) => s.setDraftRotation)

  const [fonts, setFonts] = useState<string[]>([])
  const [hexColor, setHexColor] = useState(settings.lastTextColor)
  const [hexBg, setHexBg] = useState(settings.lastTextBackground ?? '#ffff00')

  useEffect(() => {
    void getSystemFonts().then((list) => {
      const cur = settings.lastTextFontFamily
      if (cur && !list.includes(cur)) list = [cur, ...list]
      setFonts(list)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applySettings(patch: Partial<typeof settings>) {
    setSettings(patch)
    if (selectedTextId) {
      window.dispatchEvent(
        new CustomEvent('ink:text-update', { detail: { id: selectedTextId, patch } }),
      )
    }
  }

  function applyRotation(deg: number) {
    if (selectedTextId) {
      window.dispatchEvent(new CustomEvent('ink:text-rotate', { detail: { id: selectedTextId, degrees: deg } }))
    } else {
      setDraftRotation(deg)
    }
  }

  function deleteSelected() {
    window.dispatchEvent(new CustomEvent('ink:text-delete'))
  }

  const currentRotation = selectedTextId ? null : draftRotation

  return (
    <div className="tool-panel tool-panel-wide">
      <div className="panel-label">{t('tool.fontSize')}</div>
      <SizeStepper
        value={settings.lastTextFontSize}
        min={FONT_SIZE_MIN}
        max={FONT_SIZE_MAX}
        onChange={(v) => applySettings({ lastTextFontSize: v })}
      />
      <div className="panel-label">{t('tool.font')}</div>
      <select
        className="form-input"
        value={settings.lastTextFontFamily}
        onChange={(e) => applySettings({ lastTextFontFamily: e.target.value })}
      >
        {fonts.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <div className="panel-label">{t('tool.style')}</div>
      <div className="text-style-buttons">
        <button
          className={`style-btn ${settings.lastTextBold ? 'active' : ''}`}
          onClick={() => applySettings({ lastTextBold: !settings.lastTextBold })}
          title={t('tool.bold')}
        >
          <strong>B</strong>
        </button>
        <button
          className={`style-btn ${settings.lastTextItalic ? 'active' : ''}`}
          onClick={() => applySettings({ lastTextItalic: !settings.lastTextItalic })}
          title={t('tool.italic')}
        >
          <em>I</em>
        </button>
        <button
          className={`style-btn ${settings.lastTextUnderline ? 'active' : ''}`}
          onClick={() => applySettings({ lastTextUnderline: !settings.lastTextUnderline })}
          title={t('tool.underline')}
        >
          <u>U</u>
        </button>
        <button
          className={`style-btn ${settings.lastTextStrikethrough ? 'active' : ''}`}
          onClick={() => applySettings({ lastTextStrikethrough: !settings.lastTextStrikethrough })}
          title={t('tool.strikethrough')}
        >
          <s>S</s>
        </button>
      </div>
      <div className="panel-label">{t('tool.textColor')}</div>
      <ColorOptions
        value={settings.lastTextColor}
        onSelect={(c) => {
          setHexColor(c)
          applySettings({ lastTextColor: c })
        }}
        hexValue={hexColor}
        onHex={(h) => {
          const hex = normalizeHex(h)
          if (hex) {
            setHexColor(hex)
            applySettings({ lastTextColor: hex })
          }
        }}
      />
      <div className="panel-label">{t('tool.textBackground')}</div>
      <div className="panel-row">
        <button
          className={`btn small ${settings.lastTextBackground === null ? 'active-toggle' : ''}`}
          onClick={() => applySettings({ lastTextBackground: null })}
        >
          {t('tool.noBackground')}
        </button>
      </div>
      <ColorOptions
        value={settings.lastTextBackground ?? '#ffff00'}
        onSelect={(c) => {
          setHexBg(c)
          applySettings({ lastTextBackground: c })
        }}
        hexValue={hexBg}
        onHex={(h) => {
          const hex = normalizeHex(h)
          if (hex) {
            setHexBg(hex)
            applySettings({ lastTextBackground: hex })
          }
        }}
      />
      <div className="panel-label">{t('tool.alignment')}</div>
      <div className="align-buttons">
        <button
          className={`align-btn ${settings.lastTextAlign === 'left' ? 'active' : ''}`}
          onClick={() => applySettings({ lastTextAlign: 'left' as TextAlign })}
          title={t('tool.alignLeft')}
        >
          <IconAlignLeft />
        </button>
        <button
          className={`align-btn ${settings.lastTextAlign === 'center' ? 'active' : ''}`}
          onClick={() => applySettings({ lastTextAlign: 'center' as TextAlign })}
          title={t('tool.alignCenter')}
        >
          <IconAlignCenter />
        </button>
        <button
          className={`align-btn ${settings.lastTextAlign === 'right' ? 'active' : ''}`}
          onClick={() => applySettings({ lastTextAlign: 'right' as TextAlign })}
          title={t('tool.alignRight')}
        >
          <IconAlignRight />
        </button>
      </div>
      <div className="panel-label">{t('tool.markers')}</div>
      <div className="marker-buttons">
        <button
          className={`marker-btn ${settings.lastTextMarker === 'none' ? 'active' : ''}`}
          onClick={() => applySettings({ lastTextMarker: 'none' as TextMarker })}
          title={t('tool.noMarker')}
        >
          <IconListNone />
        </button>
        <button
          className={`marker-btn ${settings.lastTextMarker === 'disc' ? 'active' : ''}`}
          onClick={() => applySettings({ lastTextMarker: 'disc' as TextMarker })}
          title={t('tool.bulletList')}
        >
          <IconListBullet />
        </button>
        <button
          className={`marker-btn ${settings.lastTextMarker === 'number' ? 'active' : ''}`}
          onClick={() => applySettings({ lastTextMarker: 'number' as TextMarker })}
          title={t('tool.numberedList')}
        >
          <IconListNumbered />
        </button>
      </div>
      <div className="panel-label">{t('tool.textDirection')}</div>
      <div className="mode-buttons">
        {(
          [
            { id: 'horizontal', label: t('tool.horizontal') },
            { id: 'vertical', label: t('tool.vertical') },
          ] as { id: TextDirection; label: string }[]
        ).map((d) => (
          <button
            key={d.id}
            className={`mode-btn ${settings.lastTextDirection === d.id ? 'active' : ''}`}
            onClick={() => applySettings({ lastTextDirection: d.id })}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="panel-label">{t('tool.textRotation')}</div>
      <div className="rotate-buttons">
        {[0, 90, 180, 270].map((deg) => (
          <button key={deg} className={`btn small ${currentRotation === deg ? 'active-toggle' : ''}`} onClick={() => applyRotation(deg)}>
            {deg}°
          </button>
        ))}
      </div>
      <div className="panel-hint">
        {t('tool.freeRotateTextHint')}
      </div>
      <div className="panel-label">{t('tool.text')}</div>
      <div className="panel-hint">
        {t('tool.textHint')}
      </div>
      <div className="panel-row">
        <button className="btn small danger" onClick={deleteSelected} disabled={!selectedTextId}>
          {t('tool.deleteSelected')}
        </button>
      </div>
    </div>
  )
}

function ColorOptions({
  value,
  onSelect,
  hexValue,
  onHex,
}: {
  value: string
  onSelect: (c: string) => void
  hexValue: string
  onHex: (h: string) => void
}) {
  const { t } = useI18n()
  const [showHex, setShowHex] = useState(false)
  return (
    <div className="panel-row color-row">
      <div className="color-options">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            className={`color-btn ${value.toLowerCase() === c ? 'active' : ''}`}
            style={{ background: c, borderColor: c === '#ffffff' ? '#999' : c }}
            onClick={() => onSelect(c)}
            title={c}
          />
        ))}
      </div>
      <div className="hex-picker">
        <button className="hex-toggle" onClick={() => setShowHex((v) => !v)} title={t('tool.hexCode')}>
          #
        </button>
        {showHex && (
          <input
            className="hex-input"
            value={hexValue.replace('#', '')}
            placeholder="RRGGBB"
            onChange={(e) => onHex(e.target.value)}
          />
        )}
      </div>
    </div>
  )
}

function Svg({ children, viewBox = '0 0 24 24' }: { children: ReactNode; viewBox?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

function IconKeyboard() {
  return (
    <Svg>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <line x1="6" y1="10" x2="6" y2="10" strokeWidth="2.6" />
      <line x1="10" y1="10" x2="10" y2="10" strokeWidth="2.6" />
      <line x1="14" y1="10" x2="14" y2="10" strokeWidth="2.6" />
      <line x1="18" y1="10" x2="18" y2="10" strokeWidth="2.6" />
      <line x1="6" y1="14" x2="18" y2="14" />
    </Svg>
  )
}

function IconPen() {
  return (
    <Svg>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </Svg>
  )
}

function IconEraser() {
  return (
    <Svg>
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </Svg>
  )
}

function IconCursor() {
  return (
    <Svg>
      <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
    </Svg>
  )
}

function IconMouseClick() {
  return (
    <Svg>
      <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
      <circle cx="18" cy="6" r="2.6" />
    </Svg>
  )
}

function IconLasso() {
  return (
    <Svg>
      <path d="M4 10c0-3.5 2.5-6 6-6 4 0 6.5 2.5 6.5 6 0 4.5-4 6.5-8 6.5-2.5 0-4.5-1.5-4.5-3.5s2-3.5 4.5-3.5 4.5 1.5 4.5 3.5" strokeDasharray="3 2.5" />
    </Svg>
  )
}

function IconSelectCircle() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="8.5" strokeDasharray="4 3" />
    </Svg>
  )
}

function IconSelectRect() {
  return (
    <Svg>
      <rect x="3.5" y="5" width="17" height="14" rx="1" strokeDasharray="4 3" />
    </Svg>
  )
}

function IconCopy() {
  return (
    <Svg>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  )
}

function IconCut() {
  return (
    <Svg>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </Svg>
  )
}

function IconPaste() {
  return (
    <Svg>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </Svg>
  )
}

function IconDuplicate() {
  return (
    <Svg>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1" />
    </Svg>
  )
}

function IconTrash() {
  return (
    <Svg>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Svg>
  )
}

function IconHand() {
  return (
    <Svg viewBox="0 0 24 24">
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M6 14v-2a2 2 0 0 0-4 0v4a6 6 0 0 0 6 6h2a5 5 0 0 0 5-5v-5" />
      <path d="M18 11h1a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-3" />
    </Svg>
  )
}

function IconAlignLeft() {
  return (
    <Svg>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="15" y2="12" />
      <line x1="3" y1="18" x2="18" y2="18" />
    </Svg>
  )
}

function IconAlignCenter() {
  return (
    <Svg>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </Svg>
  )
}

function IconAlignRight() {
  return (
    <Svg>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <line x1="6" y1="18" x2="21" y2="18" />
    </Svg>
  )
}

function IconListNone() {
  return (
    <Svg>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
    </Svg>
  )
}

function IconListBullet() {
  return (
    <Svg>
      <circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <line x1="9" y1="6" x2="21" y2="6" />
      <circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <line x1="9" y1="12" x2="21" y2="12" />
      <circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <line x1="9" y1="18" x2="21" y2="18" />
    </Svg>
  )
}

function IconListNumbered() {
  return (
    <Svg>
      <text x="2" y="8" fontSize="7" fill="currentColor" stroke="none" fontFamily="inherit">
        1
      </text>
      <line x1="9" y1="6" x2="21" y2="6" />
      <text x="2" y="14" fontSize="7" fill="currentColor" stroke="none" fontFamily="inherit">
        2
      </text>
      <line x1="9" y1="12" x2="21" y2="12" />
      <text x="2" y="20" fontSize="7" fill="currentColor" stroke="none" fontFamily="inherit">
        3
      </text>
      <line x1="9" y1="18" x2="21" y2="18" />
    </Svg>
  )
}
