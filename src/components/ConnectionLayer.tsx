import { useEffect, useRef } from 'react'
import { Layer, Path, Shape } from 'react-konva'
import Konva from 'konva'
import type { CanvasGroup, CanvasNode, Connection, DraggingConnection } from '../types'
import { anchorOf, bezierPath, bezierPoint } from '../utils/geometry'
import { useCanvasStore } from '../store/canvasStore'

interface Props {
  nodes: Record<string, CanvasNode>
  groups: Record<string, CanvasGroup>
  connections: Connection[]
  dragging: DraggingConnection | null
}

const LIGHT_RATIO = 0.20 // 光丝长度占连线弧长的比例，随节点间距自适应
const LIGHT_COUNT = 3 // 每条连线固定 3 条光丝
const PHASE_SPEED_PER_SEC = 0.20 // 每秒走过的弧长比例；连线越长，光丝实际移动越快
const CURVE_SAMPLES = 48

// 曲线长度用于把光段换算成固定像素长度，避免短连线光段变短
function bezierLength(x1: number, y1: number, x2: number, y2: number) {
  let prev = bezierPoint(x1, y1, x2, y2, 0)
  let len = 0
  for (let i = 1; i <= CURVE_SAMPLES; i++) {
    const p = bezierPoint(x1, y1, x2, y2, i / CURVE_SAMPLES)
    len += Math.hypot(p.x - prev.x, p.y - prev.y)
    prev = p
  }
  return len
}

/**
 * 单条连线：默认只画浅灰底纹；
 * 只有关联到选中节点的连线（glow=true）才绘制渐变拖尾光效。
 */
function ConnectionShape({
  x1,
  y1,
  x2,
  y2,
  phaseRef,
  glow,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  phaseRef: React.MutableRefObject<number>
  glow: boolean
}) {
  // 两端锚点在同一水平线上时用直线，否则用贝塞尔曲线
  const isStraight = Math.abs(y1 - y2) <= 2
  const curveLen = isStraight ? Math.hypot(x2 - x1, y2 - y1) : bezierLength(x1, y1, x2, y2)
  const pointAt = (t: number) =>
    isStraight
      ? { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }
      : bezierPoint(x1, y1, x2, y2, t)

  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        if (!glow) return

        // 光丝长度随连线长度自适应：固定占 22% 弧长
        const tLen = LIGHT_RATIO
        // 所有连线共用同一相位速度：连线越长，光丝的实际移动越快
        const baseProgress = phaseRef.current
        const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context
        const steps = 12
        ctx.lineCap = 'round'

        const FULL_STOPS: [number, string][] = [
          [0, 'rgba(88,216,255,0)'],
          [0.35, 'rgba(88,216,255,0.2)'],
          [0.72, 'rgba(110,225,255,0.78)'],
          [1, 'rgba(228,251,255,0.95)'],
        ]

        const drawPiece = (fromT: number, toT: number, stops: [number, string][]) => {
          if (toT <= fromT + 1e-4) return
          const pA = pointAt(fromT)
          const pB = pointAt(toT)
          const grad = native.createLinearGradient(pA.x, pA.y, pB.x, pB.y)
          stops.forEach(([offset, color]) => grad.addColorStop(offset, color))

          const trace = () => {
            ctx.beginPath()
            for (let s = 0; s <= steps; s++) {
              const t = fromT + (toT - fromT) * (s / steps)
              const p = pointAt(t)
              if (s === 0) ctx.moveTo(p.x, p.y)
              else ctx.lineTo(p.x, p.y)
            }
          }

          // 细而淡的外晕
          trace()
          ctx.globalAlpha = 0.35
          ctx.strokeStyle = grad
          ctx.lineWidth = 7
          ctx.stroke()
          ctx.globalAlpha = 1

          // 细长核心光线
          trace()
          ctx.strokeStyle = grad
          ctx.lineWidth = 2.4
          ctx.shadowColor = 'rgba(88,216,255,0.85)'
          ctx.shadowBlur = 10
          ctx.stroke()
          ctx.shadowBlur = 0
        }

        // 每条连线固定 3 条光丝。
        // 头部走到 1 后不会立刻消失：继续推进，让尾部逐渐走到终点，
        // 可见段从 [head - tLen, head] 收缩成 [tail, 1]，直到尾部到达终点才完全消失。
        // 起点同理，头部未走满一个长度时只画 [0, head]，从起点逐渐驶出。
        const travel = 1 + tLen
        for (let i = 0; i < LIGHT_COUNT; i++) {
          const headT = ((baseProgress + i / LIGHT_COUNT) % 1) * travel
          const tailT = headT - tLen
          const fromT = Math.max(0, tailT)
          const toT = Math.min(1, headT)

          if (toT <= fromT + 1e-4) continue
          drawPiece(fromT, toT, FULL_STOPS)
        }
      }}
    />
  )
}

/**
 * 可点击的连线底纹：用 Path + hitStrokeWidth 提供约 14px 的透明命中区，
 * 选中时高亮；切断由选中后跟随鼠标的剪刀按钮负责。
 */
function ConnectionPath({
  x1,
  y1,
  x2,
  y2,
  selected,
  interactive = true,
  onSelect,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  selected: boolean
  interactive?: boolean
  onSelect?: () => void
}) {
  const straight = Math.abs(y1 - y2) <= 2
  const data = straight ? `M ${x1} ${y1} L ${x2} ${y2}` : bezierPath(x1, y1, x2, y2)

  return (
    <Path
      data={data}
      stroke={selected ? 'rgba(88,216,255,0.9)' : 'rgba(198,208,220,0.32)'}
      strokeWidth={selected ? 2.2 : 1.6}
      hitStrokeWidth={interactive ? 14 : 0}
      listening={interactive}
      shadowColor={selected ? 'rgba(88,216,255,0.5)' : 'transparent'}
      shadowBlur={selected ? 8 : 0}
      onMouseDown={(e) => {
        if (!interactive) return
        e.cancelBubble = true
        onSelect?.()
      }}
      onMouseEnter={(e) => {
        if (!interactive) return
        const container = e.target.getStage()?.container()
        if (container) container.style.cursor = 'pointer'
      }}
      onMouseLeave={(e) => {
        const container = e.target.getStage()?.container()
        if (container) container.style.cursor = 'default'
      }}
    />
  )
}

export default function ConnectionLayer({ nodes, groups, connections, dragging }: Props) {
  const layerRef = useRef<Konva.Layer>(null)
  const phaseRef = useRef(0)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const selectedGroupId = useCanvasStore((s) => s.selectedGroupId)
  const selectedConnectionId = useCanvasStore((s) => s.selectedConnectionId)
  const selectConnection = useCanvasStore((s) => s.selectConnection)

  // 选中节点的前后连线：选中节点本身 + 其所属分组 + 选中的分组
  const activeEndpoints = new Set<string>(selectedIds)
  selectedIds.forEach((id) => {
    const g = nodes[id]?.groupId
    if (g) activeEndpoints.add(g)
  })
  if (selectedGroupId) activeEndpoints.add(selectedGroupId)
  // 单独选中某条连线时，该连线自身也流光
  const isGlow = (c: Connection) =>
    selectedConnectionId === c.id ||
    activeEndpoints.has(c.sourceId) ||
    activeEndpoints.has(c.targetId)

  const hasGlow = !!dragging || connections.some(isGlow)

  // 只有存在高亮连线时才运行动画，默认静态底纹
  useEffect(() => {
    if (!hasGlow) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      // 用真实时间推进，保证不同刷新率下速度一致
      const dt = Math.min(50, now - last)
      last = now
      phaseRef.current = (phaseRef.current + PHASE_SPEED_PER_SEC * (dt / 1000)) % 1
      layerRef.current?.batchDraw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [hasGlow])

  return (
    <Layer ref={layerRef}>
      {/* 底纹 + 点击命中区 */}
      {connections.map((c) => {
        const a = anchorOf(c.sourceId, 'right', nodes, groups)
        const b = anchorOf(c.targetId, 'left', nodes, groups)
        if (!a || !b) return null
        return (
          <ConnectionPath
            key={`path-${c.id}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            selected={selectedConnectionId === c.id}
            onSelect={() => selectConnection(c.id)}
          />
        )
      })}

      {/* 选中节点或连线时才绘制的流动光丝 */}
      {connections.map((c) => {
        if (!isGlow(c)) return null
        const a = anchorOf(c.sourceId, 'right', nodes, groups)
        const b = anchorOf(c.targetId, 'left', nodes, groups)
        if (!a || !b) return null
        return (
          <ConnectionShape
            key={`glow-${c.id}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            phaseRef={phaseRef}
            glow
          />
        )
      })}

      {dragging &&
        (() => {
          const a = anchorOf(dragging.sourceId, 'right', nodes, groups)
          if (!a) return null
          return (
            <ConnectionPath
              x1={a.x}
              y1={a.y}
              x2={dragging.cursorX}
              y2={dragging.cursorY}
              selected={false}
              interactive={false}
            />
          )
        })()}
      {dragging &&
        (() => {
          const a = anchorOf(dragging.sourceId, 'right', nodes, groups)
          if (!a) return null
          return (
            <ConnectionShape
              x1={a.x}
              y1={a.y}
              x2={dragging.cursorX}
              y2={dragging.cursorY}
              phaseRef={phaseRef}
              glow
            />
          )
        })()}
    </Layer>
  )
}
