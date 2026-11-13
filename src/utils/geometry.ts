import type { CanvasGroup, CanvasNode, SnapGuide } from '../types'

// 世界坐标 -> 屏幕坐标
export function worldToScreen(
  wx: number,
  wy: number,
  vp: { x: number; y: number; scale: number },
) {
  return {
    x: wx * vp.scale + vp.x,
    y: wy * vp.scale + vp.y,
  }
}

// 屏幕坐标 -> 世界坐标
export function screenToWorld(
  sx: number,
  sy: number,
  vp: { x: number; y: number; scale: number },
) {
  return {
    x: (sx - vp.x) / vp.scale,
    y: (sy - vp.y) / vp.scale,
  }
}

// 节点右侧锚点（世界坐标）
export function rightAnchor(n: CanvasNode) {
  return { x: n.x + n.width, y: n.y + n.height / 2 }
}

// 节点左侧锚点
export function leftAnchor(n: CanvasNode) {
  return { x: n.x, y: n.y + n.height / 2 }
}

const SNAP_EPS = 0.01

export interface SnapResult {
  x: number
  y: number
  guides: SnapGuide[]
}

/**
 * 网格吸附：拖动时把节点的左 / 中 / 右、上 / 中 / 下对齐到其它节点的同类位置。
 * 返回吸附后的坐标，以及用于展示的对齐参考线（世界坐标）。
 * threshold 同时用作参考线两端的外扩距离。
 */
export function snapNodePosition(
  moving: { width: number; height: number },
  x: number,
  y: number,
  others: CanvasNode[],
  threshold: number,
): SnapResult {
  const xEdges = [x, x + moving.width / 2, x + moving.width]
  const yEdges = [y, y + moving.height / 2, y + moving.height]

  let dx = 0
  let dy = 0
  let bestX = threshold + 1
  let bestY = threshold + 1
  // 记录命中的是移动节点的第几条参考边，用于只展示最匹配的一条参考线
  let bestXEdge = -1
  let bestYEdge = -1

  others.forEach((n) => {
    const nxs = [n.x, n.x + n.width / 2, n.x + n.width]
    const nys = [n.y, n.y + n.height / 2, n.y + n.height]
    xEdges.forEach((mx, mi) => {
      nxs.forEach((nx) => {
        const d = nx - mx
        if (Math.abs(d) <= threshold && Math.abs(d) < bestX) {
          bestX = Math.abs(d)
          dx = d
          bestXEdge = mi
        }
      })
    })
    yEdges.forEach((my, mi) => {
      nys.forEach((ny) => {
        const d = ny - my
        if (Math.abs(d) <= threshold && Math.abs(d) < bestY) {
          bestY = Math.abs(d)
          dy = d
          bestYEdge = mi
        }
      })
    })
  })

  const snappedX = x + dx
  const snappedY = y + dy
  const sx = [snappedX, snappedX + moving.width / 2, snappedX + moving.width]
  const sy = [snappedY, snappedY + moving.height / 2, snappedY + moving.height]

  // 每个方向只展示一条参考线，避免同尺寸卡片一次出现三条虚线
  const guides: SnapGuide[] = []
  if (bestXEdge >= 0) {
    guides.push({
      axis: 'x',
      position: sx[bestXEdge],
      start: snappedY,
      end: snappedY + moving.height,
    })
  }
  if (bestYEdge >= 0) {
    guides.push({
      axis: 'y',
      position: sy[bestYEdge],
      start: snappedX,
      end: snappedX + moving.width,
    })
  }

  // 参考线延伸到参与对齐的其它节点，两端略作外扩
  guides.forEach((g) => {
    if (g.axis === 'x') {
      others.forEach((n) => {
        const nxs = [n.x, n.x + n.width / 2, n.x + n.width]
        if (!nxs.some((nx) => Math.abs(nx - g.position) < SNAP_EPS)) return
        g.start = Math.min(g.start, n.y)
        g.end = Math.max(g.end, n.y + n.height)
      })
      g.start -= threshold
      g.end += threshold
    } else {
      others.forEach((n) => {
        const nys = [n.y, n.y + n.height / 2, n.y + n.height]
        if (!nys.some((ny) => Math.abs(ny - g.position) < SNAP_EPS)) return
        g.start = Math.min(g.start, n.x)
        g.end = Math.max(g.end, n.x + n.width)
      })
      g.start -= threshold
      g.end += threshold
    }
  })

  return { x: snappedX, y: snappedY, guides }
}

export interface ResizeSnapResult {
  width: number
  height: number
  guides: SnapGuide[]
}

/**
 * 缩放吸附：在保持宽高比的前提下，把移动中的右 / 下边缘吸附到其它节点的
 * 左 / 中 / 右、上 / 中 / 下，便于和周边卡片对齐尺寸。
 * size 为未吸附的候选宽高；返回吸附后的宽高与世界坐标参考线。
 */
export function snapNodeResize(
  origin: { x: number; y: number },
  base: { width: number; height: number },
  size: { width: number; height: number },
  others: CanvasNode[],
  threshold: number,
): ResizeSnapResult {
  const current = base.width > 0 ? size.width / base.width : 1
  let bestFactor = current
  let bestDelta = threshold + 1

  // 每个候选边换算成缩放因子，找离当前比例最近且落在阈值内的一条
  const consider = (edge: number, fixed: number, span: number) => {
    if (span <= 0) return
    const factor = (edge - fixed) / span
    const delta = Math.abs(factor - current) * span
    if (delta <= threshold && delta < bestDelta) {
      bestDelta = delta
      bestFactor = factor
    }
  }

  const xEdgesOf = (n: CanvasNode) => [n.x, n.x + n.width / 2, n.x + n.width]
  const yEdgesOf = (n: CanvasNode) => [n.y, n.y + n.height / 2, n.y + n.height]

  others.forEach((n) => {
    xEdgesOf(n).forEach((edge) => consider(edge, origin.x, base.width))
    yEdgesOf(n).forEach((edge) => consider(edge, origin.y, base.height))
  })

  // 比例锁定：宽高共用同一个缩放因子
  const width = base.width * bestFactor
  const height = base.height * bestFactor
  const right = origin.x + width
  const bottom = origin.y + height

  const guides: SnapGuide[] = []
  const alignedX = others.filter((n) => xEdgesOf(n).some((x) => Math.abs(x - right) < SNAP_EPS))
  if (alignedX.length > 0) {
    let start = origin.y
    let end = bottom
    alignedX.forEach((n) => {
      start = Math.min(start, n.y)
      end = Math.max(end, n.y + n.height)
    })
    guides.push({ axis: 'x', position: right, start: start - threshold, end: end + threshold })
  }
  const alignedY = others.filter((n) => yEdgesOf(n).some((y) => Math.abs(y - bottom) < SNAP_EPS))
  if (alignedY.length > 0) {
    let start = origin.x
    let end = right
    alignedY.forEach((n) => {
      start = Math.min(start, n.x)
      end = Math.max(end, n.x + n.width)
    })
    guides.push({ axis: 'y', position: bottom, start: start - threshold, end: end + threshold })
  }

  return { width, height, guides }
}

// 计算贝塞尔曲线路径（水平三次贝塞尔，类似 Figma 连线）
export function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const dx = Math.abs(x2 - x1)
  const offset = Math.max(40, dx * 0.5)
  const c1x = x1 + offset
  const c1y = y1
  const c2x = x2 - offset
  const c2y = y2
  return `M ${x1} ${y1} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`
}

// 沿贝塞尔曲线采样点（用于粒子/发光段动画）
// t in [0,1]
export function bezierPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
) {
  const dx = Math.abs(x2 - x1)
  const offset = Math.max(40, dx * 0.5)
  const c1x = x1 + offset
  const c1y = y1
  const c2x = x2 - offset
  const c2y = y2
  const u = 1 - t
  const x = u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2
  const y = u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2
  return { x, y }
}

// 解析连线端点的锚点：节点 id → 节点左右锚点；分组 id → 分组包围盒锚点
export function anchorOf(
  id: string,
  side: 'left' | 'right',
  nodes: Record<string, CanvasNode>,
  groups: Record<string, CanvasGroup>,
): { x: number; y: number } | null {
  const n = nodes[id]
  if (n) return side === 'right' ? rightAnchor(n) : leftAnchor(n)
  const g = groups[id]
  if (g) {
    const bbox = groupBBox(g.nodeIds.map((nid) => nodes[nid]).filter(Boolean) as CanvasNode[])
    if (bbox) {
      return side === 'right'
        ? { x: bbox.x + bbox.width, y: bbox.y + bbox.height / 2 }
        : { x: bbox.x, y: bbox.y + bbox.height / 2 }
    }
  }
  return null
}

/**
 * 点 p 到连线的最近点（世界坐标），返回最近点与距离。
 * 直线按线段投影；曲线按贝塞尔采样取最近点（96 段足够在屏幕像素级对齐）。
 */
export function nearestPointOnConnection(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
): { x: number; y: number; distance: number } {
  if (Math.abs(a.y - b.y) <= 2) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    const x = a.x + dx * t
    const y = a.y + dy * t
    return { x, y, distance: Math.hypot(p.x - x, p.y - y) }
  }

  let best = { x: a.x, y: a.y, distance: Infinity }
  const samples = 96
  for (let i = 0; i <= samples; i++) {
    const q = bezierPoint(a.x, a.y, b.x, b.y, i / samples)
    const distance = Math.hypot(p.x - q.x, p.y - q.y)
    if (distance < best.distance) best = { x: q.x, y: q.y, distance }
  }
  return best
}

// 计算分组包围盒
export function groupBBox(
  nodes: CanvasNode[],
): { x: number; y: number; width: number; height: number } | null {
  if (nodes.length === 0) return null
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  })
  const pad = 24
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  }
}

const GAP = 24 // 节点间最小间隙

export interface WorldBounds {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * 在 (cx, cy) 附近寻找不与现有节点重叠的位置。
 * 以中心为起点按环形向外扩展，保证新建节点不会叠在一起。
 * 传入 bounds 时，只在可视区域内选点，避免新节点被侧边栏/工具栏遮挡。
 */
export function findFreeSpot(
  nodes: CanvasNode[],
  width: number,
  height: number,
  cx: number,
  cy: number,
  bounds?: WorldBounds,
): { x: number; y: number } {
  const start = { x: cx - width / 2, y: cy - height / 2 }

  const overlaps = (x: number, y: number) =>
    nodes.some(
      (n) =>
        x < n.x + n.width + GAP &&
        x + width + GAP > n.x &&
        y < n.y + n.height + GAP &&
        y + height + GAP > n.y,
    )

  const inBounds = (x: number, y: number) =>
    !bounds ||
    (x >= bounds.left && x + width <= bounds.right && y >= bounds.top && y + height <= bounds.bottom)

  // 优先向下、再向两侧，避免一开始就被左右固定面板遮挡
  const ANGLES = [90, 45, 0, 135, 180, 225, 270, 315]
  const ringSearch = (
    pred: (x: number, y: number) => boolean,
    maxRing: number,
  ): { x: number; y: number } | null => {
    for (let ring = 1; ring <= maxRing; ring++) {
      const r = ring * 70
      for (const a of ANGLES) {
        const rad = (a * Math.PI) / 180
        const x = start.x + Math.cos(rad) * r
        const y = start.y + Math.sin(rad) * r
        if (pred(x, y)) return { x, y }
      }
    }
    return null
  }

  if (inBounds(start.x, start.y) && !overlaps(start.x, start.y)) return start

  // 1) 先在可视安全区内找空位
  const inView = ringSearch((x, y) => inBounds(x, y) && !overlaps(x, y), 10)
  if (inView) return inView

  // 2) 可视区被占满时允许超出可视区，但绝不重叠（用户可平移查看）
  const anywhere = ringSearch((x, y) => !overlaps(x, y), 24)
  if (anywhere) return anywhere

  // 3) 极端兜底：沿对角线错开，保证不会完全重合
  return {
    x: start.x + nodes.length * (GAP + 8),
    y: start.y + nodes.length * (GAP + 8),
  }
}

