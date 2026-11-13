import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { NODE_TYPE_ITEMS } from './NodeTypeIcons'
import { createNodesFromFiles } from '../utils/createNodes'
import AssetPicker from './AssetPicker'

interface Props {
  x: number
  y: number
  worldX: number
  worldY: number
  onClose: () => void
}

const MENU_W = 208
const MENU_H = 392

/**
 * 双击空白画布弹出的新建节点菜单。
 * 节点会创建在双击位置；资产库按资产类型插入对应节点，本地上传支持多选。
 */
export default function CreateMenu({ x, y, worldX, worldY, onClose }: Props) {
  const addNode = useCanvasStore((s) => s.addNode)
  const [mode, setMode] = useState<'nodes' | 'assets'>('nodes')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_W - 12))
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_H - 12))

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 99 }}
        onMouseDown={onClose}
        onWheel={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        className="create-menu animate-fade-rise"
        style={{ left, top, width: MENU_W }}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="create-menu-title">{mode === 'nodes' ? '新建节点' : '从资产库添加'}</div>

        {mode === 'nodes' ? (
          <>
            <div className="create-menu-list">
              {NODE_TYPE_ITEMS.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className="create-menu-item"
                  onClick={() => {
                    addNode({ type: item.type, x: worldX, y: worldY })
                    onClose()
                  }}
                >
                  <span className="create-menu-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            <div className="create-menu-divider" />

            <button type="button" className="create-menu-item" onClick={() => setMode('assets')}>
              <span className="create-menu-icon">
                <LibraryIcon />
              </span>
              <span>从资产库添加</span>
            </button>
            <button
              type="button"
              className="create-menu-item"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="create-menu-icon">
                <UploadIcon />
              </span>
              <span>本地上传</span>
            </button>
          </>
        ) : (
          <AssetPicker
            worldX={worldX}
            worldY={worldY}
            onDone={onClose}
            onBack={() => setMode('nodes')}
          />
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
          await createNodesFromFiles(files, { x: worldX, y: worldY })
          onClose()
        }}
      />
    </>
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
