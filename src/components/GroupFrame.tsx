import { useRef, useState } from 'react'
import type { CanvasGroup, CanvasNode } from '../types'
import { useCanvasStore } from '../store/canvasStore'
import { groupBBox } from '../utils/geometry'
import MagneticHandle from './MagneticHandle'
import { useProximity } from '../hooks/useProximity'

interface Props {
  group: CanvasGroup
  nodes: Record<string, CanvasNode>
  scale: number
}

/**
 * 分组框：细线边界 + 标题标签 + 左右磁吸锚点。
 * 未进入时：框内空白区域整组拖拽；双击进入内部空间。
 * 进入后：框只作为视觉容器，不再拦截内部事件，内部节点可自由拖拽、双击上传。
 */
export default function GroupFrame({ group, nodes, scale }: Props) {
  const setDraggingConnection = useCanvasStore((s) => s.setDraggingConnection)
  const renameGroup = useCanvasStore((s) => s.renameGroup)
  const setRightMenu = useCanvasStore((s) => s.setRightMenu)
  const setNodePositions = useCanvasStore((s) => s.setNodePositions)
  const selectGroup = useCanvasStore((s) => s.selectGroup)
  const enterGroup = useCanvasStore((s) => s.enterGroup)
  const focusedId = useCanvasStore((s) => s.focusedGroupId)
  const selectedGroupId = useCanvasStore((s) => s.selectedGroupId)

  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const rootRef = useRef<HTMLDivElement>(null)

  const focused = focusedId === group.id
  // 鼠标靠近分组框即显示分组加号，远离后隐藏；进入内部后交给内部节点
  // 注意：hook 必须在任何 return 之前调用，保证 hooks 顺序稳定
  const near = useProximity(rootRef, { enter: 50, exit: 100, enabled: !focused })

  const members = group.nodeIds.map((id) => nodes[id]).filter(Boolean) as CanvasNode[]
  const bbox = groupBBox(members)
  if (!bbox) return null

  const isSelected = selectedGroupId === group.id
  const active = hovered || dragging || isSelected
  const showHandles = !focused && near

  const startConnection = () => {
    setDraggingConnection({
      sourceId: group.id,
      cursorX: bbox.x + bbox.width,
      cursorY: bbox.y + bbox.height / 2,
    })
  }

  // 拖拽整组：组内所有节点同步位移，分组框由成员 bbox 自动伸缩
  const onFrameMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    selectGroup(group.id)

    const startX = e.clientX
    const startY = e.clientY
    const origin = members.map((m) => ({ id: m.id, x: m.x, y: m.y }))

    setDragging(true)
    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / scale
      const dy = (ev.clientY - startY) / scale
      const positions: Record<string, { x: number; y: number }> = {}
      origin.forEach((o) => {
        positions[o.id] = { x: o.x + dx, y: o.y + dy }
      })
      setNodePositions(positions)
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const commitName = () => {
    const v = draft.trim()
    if (v) renameGroup(group.id, v)
    else setDraft(group.name)
    setEditing(false)
  }

  return (
    <div
      ref={rootRef}
      className={`group-frame${focused ? ' is-focused' : ''}${isSelected ? ' is-selected' : ''}${near ? ' near' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setRightMenu({ x: e.clientX, y: e.clientY, targetType: 'group', targetId: group.id })
      }}
      style={{
        position: 'absolute',
        left: bbox.x,
        top: bbox.y,
        width: bbox.width,
        height: bbox.height,
        borderRadius: 20,
        border: `1px solid ${
          focused
            ? 'rgba(88,216,255,0.62)'
            : active
              ? 'rgba(88,216,255,0.4)'
              : 'rgba(255,255,255,0.13)'
        }`,
        background: focused
          ? 'linear-gradient(160deg, rgba(88,216,255,0.055), rgba(88,216,255,0.012))'
          : active
            ? 'linear-gradient(160deg, rgba(88,216,255,0.045), rgba(88,216,255,0.012))'
            : 'rgba(255,255,255,0.012)',
        // 进入内部后整框不拦截事件，内部节点/画布操作与外部完全一致
        pointerEvents: 'none',
        boxShadow: focused ? 'inset 0 0 40px rgba(88,216,255,0.06)' : 'none',
        zIndex: 1,
        transition: 'border-color 0.22s ease, background 0.22s ease',
      }}
    >
      {/* 外层拖拽层：仅在未进入分组时生效，覆盖框内空白区域 */}
      {!focused && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 20,
            pointerEvents: 'auto',
            cursor: dragging ? 'grabbing' : 'grab',
          }}
          onMouseDown={onFrameMouseDown}
          onDoubleClick={(e) => {
            e.stopPropagation()
            enterGroup(group.id)
          }}
        />
      )}

      {/* 标题标签：单击选中整组、双击改名、可拖动整组 */}
      <div
        style={{
          position: 'absolute',
          top: -11,
          left: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 10px',
          fontSize: 11.5,
          letterSpacing: '0.02em',
          color: active || focused ? 'var(--cyan)' : 'var(--text-2)',
          background: 'rgba(13,16,21,0.94)',
          border: `1px solid ${active || focused ? 'rgba(88,216,255,0.34)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 999,
          pointerEvents: 'auto',
          cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
          transition: 'color 0.2s ease, border-color 0.2s ease',
        }}
        onMouseDown={(e) => {
          // 编辑态下不触发整组拖拽，避免抢走输入焦点
          if (editing) {
            e.stopPropagation()
            return
          }
          onFrameMouseDown(e)
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(group.name)
          setEditing(true)
        }}
      >
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.7 }}>
          <rect x="0.8" y="0.8" width="8.4" height="8.4" rx="1.6" stroke="currentColor" strokeWidth="1" />
        </svg>
        {editing ? (
          <input
            autoFocus
            className="bg-transparent outline-none"
            style={{ color: 'var(--text-1)', width: Math.max(60, draft.length * 8) }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') {
                setDraft(group.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span>{group.name}</span>
        )}
        <span style={{ opacity: 0.4, fontSize: 10 }}>{members.length}</span>
      </div>

      {/* 进入内部空间的提示 */}
      {focused && (
        <div
          style={{
            position: 'absolute',
            bottom: -11,
            right: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '2px 9px',
            fontSize: 10.5,
            letterSpacing: '0.02em',
            color: 'rgba(88,216,255,0.85)',
            background: 'rgba(13,16,21,0.92)',
            border: '1px solid rgba(88,216,255,0.26)',
            borderRadius: 999,
            pointerEvents: 'none',
          }}
        >
          <span className="pulse-dot" />
          内部编辑 · Esc 退出
        </div>
      )}

      {/* 组间连线锚点：容器不拦截事件，仅按钮自身可交互 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: showHandles ? 1 : 0,
          transition: 'opacity 0.18s ease',
        }}
      >
        <MagneticHandle side="left" onDragStart={startConnection} />
        <MagneticHandle side="right" onDragStart={startConnection} />
      </div>
    </div>
  )
}
