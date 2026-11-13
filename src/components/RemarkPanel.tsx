import { useEffect, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'

// 备注编辑面板：定位在节点正下方（世界坐标系内渲染）
export default function RemarkPanel() {
  const remarkOpenId = useCanvasStore((s) => s.remarkOpenId)
  const node = useCanvasStore((s) => (s.remarkOpenId ? s.nodes[s.remarkOpenId] : null))
  const updateNode = useCanvasStore((s) => s.updateNode)
  const setRemarkOpen = useCanvasStore((s) => s.setRemarkOpen)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (node) setDraft(node.remark || '')
  }, [remarkOpenId])

  if (!node || !remarkOpenId) return null

  const save = () => {
    updateNode(node.id, { remark: draft })
    setRemarkOpen(null)
  }

  return (
    <div
      className="glass-panel"
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y + node.height + 28,
        width: Math.max(node.width, 280),
        minHeight: 110,
        padding: 14,
        zIndex: 50,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 小箭头 */}
      <div
        style={{
          position: 'absolute',
          top: -7,
          left: node.width / 2 - 7,
          width: 14,
          height: 14,
          transform: 'rotate(45deg)',
          background: 'rgba(22,25,31,0.82)',
          borderLeft: '1px solid rgba(255,255,255,0.1)',
          borderTop: '1px solid rgba(255,255,255,0.1)',
        }}
      />
      <div className="text-xs text-gray-400 mb-2">备注</div>
      <textarea
        autoFocus
        className="w-full bg-transparent outline-none resize-none text-sm text-gray-200"
        rows={3}
        placeholder="记录补充说明、标签或想法…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          className="px-3 py-1 rounded-md text-xs text-gray-300 hover:text-white"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
          onClick={() => setRemarkOpen(null)}
        >
          关闭
        </button>
        <button
          className="px-3 py-1 rounded-md text-xs"
          style={{ background: 'rgba(79,195,255,0.25)', border: '1px solid rgba(79,195,255,0.5)', color: '#7fd4ff' }}
          onClick={save}
        >
          保存
        </button>
      </div>
    </div>
  )
}
