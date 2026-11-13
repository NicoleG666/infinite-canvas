import { useEffect, useMemo, useRef, useState } from 'react'
import { Stage, Layer } from 'react-konva'
import type Konva from 'konva'
import { useCanvasStore } from '../store/canvasStore'
import { findFreeSpot, groupBBox, screenToWorld } from '../utils/geometry'
import { saveFile } from '../utils/idb'
import GridBackground from './GridBackground'
import ConnectionLayer from './ConnectionLayer'
import NodeCard, { measureMedia } from './NodeCard'
import GroupFrame from './GroupFrame'
import RemarkPanel from './RemarkPanel'
import StartupHint from './StartupHint'
import ConnectionCutter from './ConnectionCutter'
import CreateMenu from './CreateMenu'
import SnapGuides from './SnapGuides'
import type { NodeType } from '../types'

interface Props {
  onViewportChange?: () => void
  loading?: boolean
}

/**
 * 主画布。视口变换只在 store.viewport 一处补偿：
 * Konva Stage 与 DOM 覆盖层共用同一组 x/y/scale。
 * 交互：左键拖空白=框选；中键或空格+左键=平移；右键=菜单。
 */
export default function Canvas({ onViewportChange, loading }: Props) {
  const nodes = useCanvasStore((s) => s.nodes)
  const connections = useCanvasStore((s) => s.connections)
  const groups = useCanvasStore((s) => s.groups)
  const viewport = useCanvasStore((s) => s.viewport)
  const draggingConnection = useCanvasStore((s) => s.draggingConnection)
  const setDraggingConnection = useCanvasStore((s) => s.setDraggingConnection)
  const addConnection = useCanvasStore((s) => s.addConnection)
  const setContextMenu = useCanvasStore((s) => s.setContextMenu)
  const setRightMenu = useCanvasStore((s) => s.setRightMenu)
  const setSelected = useCanvasStore((s) => s.setSelected)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const addNode = useCanvasStore((s) => s.addNode)
  const exitGroup = useCanvasStore((s) => s.exitGroup)
  const focusedGroupId = useCanvasStore((s) => s.focusedGroupId)

  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  // 拖拽连线时鼠标命中的目标节点：卡片一圈高亮，松手后清除
  const [connectTargetId, setConnectTargetId] = useState<string | null>(null)
  // 鼠标在目标卡片上的世界坐标，用于按光标位置做 3D 悬浮倾斜
  const [connectPoint, setConnectPoint] = useState<{ x: number; y: number } | null>(null)
  // 双击画布弹出的新建节点菜单
  const [createMenu, setCreateMenu] = useState<{
    x: number
    y: number
    worldX: number
    worldY: number
  } | null>(null)
  const panStart = useRef<{ cx: number; cy: number; vx: number; vy: number } | null>(null)
  // 平移时把连续 mousemove 合并到一帧，避免每个事件都触发整棵节点树重渲染
  const panRaf = useRef<number | null>(null)
  const panTarget = useRef<{ x: number; y: number } | null>(null)
  const marqueeStart = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const spaceRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 空格键作为平移修饰键
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input, textarea')) {
        spaceRef.current = true
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // 命中检测（世界坐标）
  const hitNode = (wx: number, wy: number) =>
    Object.values(nodes).find(
      (n) => wx >= n.x && wx <= n.x + n.width && wy >= n.y && wy <= n.y + n.height,
    )

  // 视口裁剪：大画布只挂载可视区（含预加载边距）内的节点，避免上百个卡片同时渲染
  const visibleArea = useMemo(() => {
    const pad = 480 / viewport.scale
    return {
      x1: -viewport.x / viewport.scale - pad,
      y1: -viewport.y / viewport.scale - pad,
      x2: (size.w - viewport.x) / viewport.scale + pad,
      y2: (size.h - viewport.y) / viewport.scale + pad,
    }
  }, [viewport, size.w, size.h])

  const visibleNodes = useMemo(() => {
    const all = Object.values(nodes)
    // 小画布不裁剪，行为与之前完全一致
    if (all.length <= 80) return all
    const selected = new Set(selectedIds)
    return all.filter(
      (n) =>
        selected.has(n.id) ||
        (n.x < visibleArea.x2 &&
          n.x + n.width > visibleArea.x1 &&
          n.y < visibleArea.y2 &&
          n.y + n.height > visibleArea.y1),
    )
  }, [nodes, selectedIds, visibleArea])

  const visibleGroups = useMemo(() => {
    const all = Object.values(groups)
    if (all.length <= 40) return all
    return all.filter((g) => {
      const b = groupBBox(g.nodeIds.map((id) => nodes[id]).filter(Boolean))
      if (!b) return false
      return (
        b.x < visibleArea.x2 &&
        b.x + b.width > visibleArea.x1 &&
        b.y < visibleArea.y2 &&
        b.y + b.height > visibleArea.y1
      )
    })
  }, [groups, nodes, visibleArea])

  const hitGroup = (wx: number, wy: number) =>
    Object.values(groups).find((g) => {
      const b = groupBBox(g.nodeIds.map((id) => nodes[id]).filter(Boolean))
      if (!b) return false
      const pad = 4
      return wx >= b.x - pad && wx <= b.x + b.width + pad && wy >= b.y - pad && wy <= b.y + b.height + pad
    })

  // Konva 空白按下：左键=框选起点（中键/空格平移由容器统一处理，见下方根节点事件）
  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const evt = e.evt
    const isBlank = e.target === e.target.getStage() || !e.target.isListening()
    if (!isBlank) return

    setContextMenu(null)
    setRightMenu(null)
    // 点分组之外的空白才退出内部空间；分组内部空白保持进入状态，框选逻辑与外部一致
    if (focusedGroupId) {
      const w = screenToWorld(evt.clientX, evt.clientY, viewport)
      const g = hitGroup(w.x, w.y)
      if (!g || g.id !== focusedGroupId) exitGroup()
    }

    if (evt.button === 1 || spaceRef.current) {
      evt.preventDefault()
      return
    }
    if (evt.button !== 0) return

    marqueeStart.current = { x: evt.clientX, y: evt.clientY, moved: false }
    setMarquee({ x1: evt.clientX, y1: evt.clientY, x2: evt.clientX, y2: evt.clientY })
  }

  // 双击空白：初始空画布直接建文本节点（对应启动提示）；有内容后弹出新建节点菜单
  const onStageDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const isBlank = e.target === e.target.getStage() || !e.target.isListening()
    if (!isBlank || e.evt.button !== 0) return
    const w = screenToWorld(e.evt.clientX, e.evt.clientY, viewport)
    if (Object.keys(nodes).length === 0) {
      const id = addNode({ type: 'text', x: w.x, y: w.y })
      setSelected([id])
      return
    }
    setRightMenu(null)
    setContextMenu(null)
    setCreateMenu({ x: e.evt.clientX, y: e.evt.clientY, worldX: w.x, worldY: w.y })
  }

  // 中键 / 空格+左键平移：挂在画布容器上，节点层之上同样生效
  const onRootMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 1 && !(e.button === 0 && spaceRef.current)) return
    e.preventDefault()
    setContextMenu(null)
    setRightMenu(null)
    panStart.current = {
      cx: e.clientX,
      cy: e.clientY,
      vx: useCanvasStore.getState().viewport.x,
      vy: useCanvasStore.getState().viewport.y,
    }
  }

  // 滚轮缩放：挂在画布容器上（passive:false 才能阻止页面滚动），
  // 这样鼠标位于节点/分组之上时也能正常缩放
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      useCanvasStore.getState().zoomAt(e.clientX, e.clientY, e.deltaY)
      onViewportChange?.()
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [onViewportChange])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (panStart.current) {
        const s = panStart.current
        panTarget.current = {
          x: s.vx + (e.clientX - s.cx),
          y: s.vy + (e.clientY - s.cy),
        }
        if (panRaf.current === null) {
          panRaf.current = window.requestAnimationFrame(() => {
            panRaf.current = null
            const p = panTarget.current
            if (!p) return
            useCanvasStore.getState().setViewport(p)
            onViewportChange?.()
          })
        }
      }
      if (marqueeStart.current) {
        const s = marqueeStart.current
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 3) s.moved = true
        setMarquee({ x1: s.x, y1: s.y, x2: e.clientX, y2: e.clientY })
      }
      if (draggingConnection) {
        const w = screenToWorld(e.clientX, e.clientY, viewport)
        const node = hitNode(w.x, w.y)
        const target = node && node.id !== draggingConnection.sourceId ? node : null
        setConnectTargetId(target?.id ?? null)
        setConnectPoint(target ? { x: w.x, y: w.y } : null)
        // 拖拽时连线始终跟随鼠标；松手后由已建立的连线渲染到目标左侧中点
        setDraggingConnection({
          ...draggingConnection,
          cursorX: w.x,
          cursorY: w.y,
        })
      }
    }

    const onUp = (e: MouseEvent) => {
      if (panStart.current) panStart.current = null

      // 结束框选（直接使用按下点与松开点，避免依赖 marquee 状态的时序）
      if (marqueeStart.current) {
        const s = marqueeStart.current
        if (s.moved) {
          const x1 = Math.min(s.x, e.clientX)
          const x2 = Math.max(s.x, e.clientX)
          const y1 = Math.min(s.y, e.clientY)
          const y2 = Math.max(s.y, e.clientY)
          const hits = Object.values(nodes)
            .filter((n) => {
              const a = { x: n.x * viewport.scale + viewport.x, y: n.y * viewport.scale + viewport.y }
              const b = { x: a.x + n.width * viewport.scale, y: a.y + n.height * viewport.scale }
              return a.x < x2 && b.x > x1 && a.y < y2 && b.y > y1
            })
            .map((n) => n.id)
          setSelected(hits)
        } else {
          // 单击空白：清空选择
          setSelected([])
        }
        marqueeStart.current = null
        setMarquee(null)
      }

      // 结束拖拽连线
      if (draggingConnection) {
        const w = screenToWorld(e.clientX, e.clientY, viewport)
        const targetNode = hitNode(w.x, w.y)
        const targetGroup = hitGroup(w.x, w.y)
        if (targetNode && targetNode.id !== draggingConnection.sourceId) {
          addConnection(draggingConnection.sourceId, targetNode.id)
        } else if (targetGroup && targetGroup.id !== draggingConnection.sourceId) {
          addConnection(draggingConnection.sourceId, targetGroup.id)
        } else {
          setContextMenu({ x: e.clientX, y: e.clientY, sourceId: draggingConnection.sourceId })
        }
        setDraggingConnection(null)
        setConnectTargetId(null)
        setConnectPoint(null)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (panRaf.current !== null) {
        window.cancelAnimationFrame(panRaf.current)
        panRaf.current = null
      }
    }
  }, [draggingConnection, viewport, nodes, groups])

  // 快捷键：撤销 / 重做 / 复制 / 粘贴；Delete 删除选中；Esc 退出分组
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return
      const state = useCanvasStore.getState()

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase()
        if (key === 'z') {
          e.preventDefault()
          if (e.shiftKey) state.redo()
          else state.undo()
          return
        }
        if (key === 'y') {
          e.preventDefault()
          state.redo()
          return
        }
        if (key === 'c') {
          state.copySelection()
          return
        }
        if (key === 'v') {
          e.preventDefault()
          state.pasteClipboard()
          return
        }
      }

      if (e.key === 'Escape') {
        state.exitGroup()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // 选中连线时优先删除连线
        if (state.selectedConnectionId) {
          state.removeConnection(state.selectedConnectionId)
          return
        }
        selectedIds.forEach(removeNode)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, removeNode])

  // 文件拖入：按真实宽高比创建节点（blob 存 IndexedDB），并自动避让已有节点
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    const w = screenToWorld(e.clientX, e.clientY, viewport)
    let offset = 0
    for (const file of files) {
      const type: NodeType = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : file.type.startsWith('audio/')
            ? 'audio'
            : 'text'

      if (type === 'text') {
        const text = await file.text().catch(() => file.name)
        const spot = findFreeSpot(Object.values(useCanvasStore.getState().nodes), 260, 160, w.x, w.y)
        addNode({ type, x: spot.x, y: spot.y, text: text.slice(0, 2000) })
      } else {
        // 本地库不可用时仍创建节点（仅无法持久化文件 blob）
        const key = await saveFile(file).catch(() => undefined)
        const url = URL.createObjectURL(file)
        const dim = await measureMedia(file.type, url)
        const nw = dim?.width ?? 320
        const nh = dim?.height ?? 220
        const spot = findFreeSpot(
          Object.values(useCanvasStore.getState().nodes),
          nw,
          nh,
          w.x + offset,
          w.y + offset,
        )
        addNode({
          type,
          x: spot.x,
          y: spot.y,
          width: nw,
          height: nh,
          url,
          fileKey: key,
          // 音频节点在卡片内展示原始文件名
          ...(type === 'audio' ? { fileName: file.name } : {}),
        })
      }
      offset += 32
    }
  }

  return (
    <div
      ref={rootRef}
      style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--ink-0)' }}
      onMouseDown={onRootMouseDown}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(e) => {
        // 画布空白处右键（节点/分组会自行 stopPropagation）
        e.preventDefault()
        setCreateMenu(null)
        setRightMenu({ x: e.clientX, y: e.clientY, targetType: 'canvas' })
      }}
    >
      {/* 氛围光晕：为玻璃拟态提供色彩层 */}
      <div className="aurora">
        <span className="aurora-blob a" />
        <span className="aurora-blob b" />
        <span className="aurora-blob c" />
      </div>

      <Stage
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        onMouseDown={onStageMouseDown}
        onDblClick={onStageDblClick}
      >
        <Layer listening={false}>
          <GridBackground viewport={viewport} width={size.w} height={size.h} />
        </Layer>
        <ConnectionLayer
          nodes={nodes}
          groups={groups}
          connections={Object.values(connections)}
          dragging={draggingConnection}
        />
      </Stage>

      {/* DOM 覆盖层：同一视口变换源 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          transformOrigin: '0 0',
        }}
      >
        {visibleGroups.map((g) => (
          <GroupFrame key={g.id} group={g} nodes={nodes} scale={viewport.scale} />
        ))}
        {visibleNodes.map((n) => (
          <div key={n.id} style={{ pointerEvents: 'auto' }}>
            <NodeCard
              node={n}
              scale={viewport.scale}
              connectTarget={connectTargetId === n.id}
              connectPoint={connectTargetId === n.id ? connectPoint ?? undefined : undefined}
            />
          </div>
        ))}
        <div style={{ pointerEvents: 'auto' }}>
          <RemarkPanel />
        </div>
        <ConnectionCutter />
      </div>

      {/* 拖动节点时的对齐参考线 */}
      <SnapGuides />

      {/* 空画布启动提示：数据加载完成后且没有任何节点时显示 */}
      {!loading && Object.keys(nodes).length === 0 && <StartupHint />}

      {/* 双击空白弹出的新建节点菜单 */}
      {createMenu && (
        <CreateMenu
          x={createMenu.x}
          y={createMenu.y}
          worldX={createMenu.worldX}
          worldY={createMenu.worldY}
          onClose={() => setCreateMenu(null)}
        />
      )}

      {/* 框选矩形 */}
      {marquee && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(marquee.x1, marquee.x2),
            top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1),
            height: Math.abs(marquee.y2 - marquee.y1),
            border: '1px solid rgba(88,216,255,0.65)',
            background: 'rgba(88,216,255,0.07)',
            borderRadius: 4,
            zIndex: 80,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}
