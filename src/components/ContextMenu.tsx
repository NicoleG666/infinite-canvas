import { useCanvasStore } from '../store/canvasStore'
import { findFreeSpot, screenToWorld } from '../utils/geometry'
import { AudioIcon, ImageIcon, TextIcon, VideoIcon } from './NodeTypeIcons'
import type { NodeType } from '../types'

const OPTIONS: { type: NodeType; label: string; icon: React.ReactNode }[] = [
  { type: 'text', label: '文本', icon: <TextIcon /> },
  { type: 'image', label: '图片', icon: <ImageIcon /> },
  { type: 'video', label: '视频', icon: <VideoIcon /> },
  { type: 'audio', label: '音频', icon: <AudioIcon /> },
]

// 「引用该节点生成」上下文菜单（屏幕坐标 fixed 定位）
export default function ContextMenu() {
  const contextMenu = useCanvasStore((s) => s.contextMenu)
  const viewport = useCanvasStore((s) => s.viewport)
  const setContextMenu = useCanvasStore((s) => s.setContextMenu)
  const addNode = useCanvasStore((s) => s.addNode)
  const addConnection = useCanvasStore((s) => s.addConnection)

  if (!contextMenu) return null

  const pick = (type: NodeType) => {
    const w = screenToWorld(contextMenu.x, contextMenu.y, viewport)
    const spot = findFreeSpot(Object.values(useCanvasStore.getState().nodes), 260, 160, w.x, w.y)
    const newId = addNode({ type, x: spot.x, y: spot.y })
    addConnection(contextMenu.sourceId, newId)
    setContextMenu(null)
  }

  return (
    <div
      className="glass-panel animate-fade-rise"
      style={{
        position: 'fixed',
        left: contextMenu.x,
        top: contextMenu.y,
        zIndex: 100,
        padding: 6,
        minWidth: 176,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: '0.08em',
          color: 'var(--text-3)',
          padding: '5px 10px 7px',
        }}
      >
        引用该节点生成
      </div>
      {OPTIONS.map((o) => (
        <button
          key={o.type}
          className="w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[12.5px] text-left"
          style={{ color: 'var(--text-2)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
            e.currentTarget.style.color = 'var(--text-1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-2)'
          }}
          onClick={() => pick(o.type)}
        >
          <span style={{ color: 'var(--text-3)', display: 'flex' }}>{o.icon}</span>
          {o.label}
        </button>
      ))}
    </div>
  )
}
