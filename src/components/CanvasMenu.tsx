import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { screenToWorld } from '../utils/geometry'
import { createNodesFromFiles } from '../utils/createNodes'
import { NODE_TYPE_ITEMS } from './NodeTypeIcons'
import AssetPicker from './AssetPicker'

interface Props {
  x: number
  y: number
  onClose: () => void
}

const PANEL_W = 158
const ADD_W = 196
const GAP = 8

/**
 * 画布右键菜单：左侧画布动作（新建节点 / 粘贴 / 重做 / 撤销），
 * 右侧是新建节点列表与「从资产库添加 / 本地上传」。
 */
export default function CanvasMenu({ x, y, onClose }: Props) {
  const viewport = useCanvasStore((s) => s.viewport)
  const addNode = useCanvasStore((s) => s.addNode)
  const pasteClipboard = useCanvasStore((s) => s.pasteClipboard)
  const undo = useCanvasStore((s) => s.undo)
  const redo = useCanvasStore((s) => s.redo)
  const canUndo = useCanvasStore((s) => s.canUndo)
  const canRedo = useCanvasStore((s) => s.canRedo)
  const hasClipboard = useCanvasStore((s) => s.hasClipboard)

  const [addOpen, setAddOpen] = useState(true)
  const [mode, setMode] = useState<'nodes' | 'assets'>('nodes')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const world = screenToWorld(x, y, viewport)
  const totalW = addOpen ? PANEL_W + GAP + ADD_W : PANEL_W
  const MENU_H = 424
  const left = Math.max(8, Math.min(x, window.innerWidth - totalW - 12))
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_H - 12))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const create = (type: (typeof NODE_TYPE_ITEMS)[number]['type']) => {
    addNode({ type, x: world.x, y: world.y })
    onClose()
  }

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 99 }}
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        className="ctx-wrap animate-fade-rise"
        style={{ left, top }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="ctx-panel" style={{ width: PANEL_W }}>
          <button
            type="button"
            className="ctx-item ctx-item-head"
            onClick={() => setAddOpen((v) => !v)}
          >
            <span>新建节点</span>
            <span className={`ctx-chevron ${addOpen ? 'is-open' : ''}`}>
              <ChevronIcon />
            </span>
          </button>

          <button
            type="button"
            className="ctx-item"
            disabled={!hasClipboard}
            onClick={() => {
              pasteClipboard()
              onClose()
            }}
          >
            <span>粘贴</span>
            <span className="ctx-shortcut">Ctrl+V</span>
          </button>

          <button
            type="button"
            className="ctx-item"
            disabled={!canRedo}
            onClick={() => {
              redo()
              onClose()
            }}
          >
            <span>重做</span>
            <span className="ctx-shortcut">Ctrl+Shift+Z</span>
          </button>

          <button
            type="button"
            className="ctx-item"
            disabled={!canUndo}
            onClick={() => {
              undo()
              onClose()
            }}
          >
            <span>撤销</span>
            <span className="ctx-shortcut">Ctrl+Z</span>
          </button>
        </div>

        {addOpen && (
          <div className="ctx-panel" style={{ width: ADD_W }}>
            <div className="ctx-title">{mode === 'nodes' ? '添加节点' : '从资产库添加'}</div>

            {mode === 'nodes' ? (
              <>
                {NODE_TYPE_ITEMS.map((item) => (
                  <button
                    key={item.type}
                    type="button"
                    className="ctx-item"
                    onClick={() => create(item.type)}
                  >
                    <span className="ctx-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}

                <div className="ctx-divider" />

                <button type="button" className="ctx-item" onClick={() => setMode('assets')}>
                  <span className="ctx-icon">
                    <LibraryIcon />
                  </span>
                  <span>从资产库添加</span>
                </button>
                <button
                  type="button"
                  className="ctx-item"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="ctx-icon">
                    <UploadIcon />
                  </span>
                  <span>本地上传</span>
                </button>
              </>
            ) : (
              <AssetPicker
                worldX={world.x}
                worldY={world.y}
                onDone={onClose}
                onBack={() => setMode('nodes')}
              />
            )}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length === 0) return
          await createNodesFromFiles(files, { x: world.x, y: world.y })
          onClose()
        }}
      />
    </>
  )
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.6 2.8 7.8 6l-3.2 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LibraryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.2" y="2.6" width="11.6" height="10.8" rx="1.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.2 5.4h11.6M5.6 2.6v2.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 10.4V2.8M4.8 5.8 8 2.6l3.2 3.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.8 10v2.2a1.2 1.2 0 0 0 1.2 1.2h8a1.2 1.2 0 0 0 1.2-1.2V10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
