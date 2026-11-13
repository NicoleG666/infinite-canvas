import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { anchorOf, nearestPointOnConnection, screenToWorld } from '../utils/geometry'

// 鼠标离连线超过该屏幕距离时隐藏剪刀，避免按钮孤零零地停在线段端点
const SHOW_DISTANCE = 64

/**
 * 选中连线后的剪刀按钮：把鼠标位置投影到连线最近点，
 * 剪刀贴在该点跟随移动，点击即切断（删除）连线。
 * 渲染在画布的 DOM 覆盖层内，坐标与世界坐标一致，随视口缩放。
 */
export default function ConnectionCutter() {
  const connection = useCanvasStore((s) =>
    s.selectedConnectionId ? s.connections[s.selectedConnectionId] : undefined,
  )
  const nodes = useCanvasStore((s) => s.nodes)
  const groups = useCanvasStore((s) => s.groups)
  const removeConnection = useCanvasStore((s) => s.removeConnection)

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)

  // 始终记录最近一次鼠标位置，选中连线时才能立刻把剪刀放到鼠标附近
  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', onPointer)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('mousemove', onPointer)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [])

  useEffect(() => {
    if (!connection) {
      setPos(null)
      return
    }
    const a = anchorOf(connection.sourceId, 'right', nodes, groups)
    const b = anchorOf(connection.targetId, 'left', nodes, groups)
    if (!a || !b) {
      setPos(null)
      return
    }

    let raf = 0
    const update = () => {
      raf = 0
      const pointer = pointerRef.current
      if (!pointer) return
      const vp = useCanvasStore.getState().viewport
      const world = screenToWorld(pointer.x, pointer.y, vp)
      const near = nearestPointOnConnection(a, b, world)
      if (near.distance * vp.scale > SHOW_DISTANCE) {
        setPos(null)
        return
      }
      setPos({ x: near.x, y: near.y })
    }
    const onMove = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [connection, nodes, groups])

  if (!connection || !pos) return null

  return (
    <button
      type="button"
      className="connection-cutter"
      style={{ left: pos.x, top: pos.y }}
      title="点击切断连线"
      aria-label="切断连线"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        removeConnection(connection.id)
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <line x1="20" y1="4" x2="8.12" y2="15.88" />
        <line x1="14.47" y1="14.48" x2="20" y2="20" />
        <line x1="8.12" y1="8.12" x2="12" y2="12" />
      </svg>
    </button>
  )
}
