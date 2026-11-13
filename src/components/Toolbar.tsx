import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { findFreeSpot, groupBBox, screenToWorld } from '../utils/geometry'
import { saveFile } from '../utils/idb'
import { measureMedia } from './NodeCard'
import { NODE_TYPE_ITEMS } from './NodeTypeIcons'
import MiniMap from './MiniMap'
import type { CanvasNode, NodeType } from '../types'

const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4]
const ARRANGE_GAP = 48
const ASSET_PANEL_W = 360

interface ArrangeBlock {
  key: string
  kind: 'node' | 'group'
  w: number
  h: number
  createdAt: number
  node?: CanvasNode
  members?: CanvasNode[]
  bbox?: { x: number; y: number; width: number; height: number }
}

interface PlacedBlock {
  block: ArrangeBlock
  x: number
  y: number
}

/**
 * 整理画布：
 * 1. 有连线的单元按脑图分层排布（根节点在左列，子节点逐列向右，层内按父节点顺序并垂直对齐）；
 * 2. 没有连线的节点按尺寸在图形下方铺排（行高对齐）；
 * 3. 最后自动缩放并居中到当前可视区域（资产面板打开时避开面板）。
 */
function arrangeCanvas() {
  const state = useCanvasStore.getState()
  const allNodes = Object.values(state.nodes)
  if (allNodes.length === 0) return

  // 1. 可移动单元：分组（整体）+ 未分组节点
  const grouped = new Set<string>()
  const blockByKey = new Map<string, ArrangeBlock>()

  Object.values(state.groups).forEach((g) => {
    const members = g.nodeIds.map((id) => state.nodes[id]).filter(Boolean) as CanvasNode[]
    if (members.length === 0) return
    const bbox = groupBBox(members)
    if (!bbox) return
    members.forEach((m) => grouped.add(m.id))
    blockByKey.set(g.id, {
      key: g.id,
      kind: 'group',
      w: bbox.width,
      h: bbox.height,
      createdAt: g.createdAt,
      members,
      bbox,
    })
  })

  allNodes.forEach((n) => {
    if (grouped.has(n.id)) return
    blockByKey.set(n.id, {
      key: n.id,
      kind: 'node',
      w: n.width,
      h: n.height,
      createdAt: n.createdAt,
      node: n,
    })
  })

  const blocks = Array.from(blockByKey.values()).sort((a, b) => a.createdAt - b.createdAt)
  if (blocks.length === 0) return

  // 2. 连线映射到单元：连到组内节点时归到该分组
  const unitOf = (id: string): string | null => {
    if (state.groups[id]) return id
    const n = state.nodes[id]
    if (!n) return null
    return n.groupId && state.groups[n.groupId] ? n.groupId : n.id
  }

  const out = new Map<string, string[]>()
  const inc = new Map<string, string[]>()
  blocks.forEach((b) => {
    out.set(b.key, [])
    inc.set(b.key, [])
  })

  const connected = new Set<string>()
  const seenEdges = new Set<string>()
  Object.values(state.connections).forEach((c) => {
    const from = unitOf(c.sourceId)
    const to = unitOf(c.targetId)
    if (!from || !to || from === to) return
    if (!out.has(from) || !out.has(to)) return
    const edgeKey = `${from}->${to}`
    if (seenEdges.has(edgeKey)) return
    seenEdges.add(edgeKey)
    out.get(from)!.push(to)
    inc.get(to)!.push(from)
    connected.add(from)
    connected.add(to)
  })

  // 3. 可视区域：左侧资产面板打开时，画布只剩面板右侧
  const leftInset = state.assetPanelOpen ? ASSET_PANEL_W : 0
  const sidePad = 48
  const topPad = 72
  const bottomPad = 88
  const availW = Math.max(200, window.innerWidth - leftInset - sidePad * 2)
  const availH = Math.max(200, window.innerHeight - topPad - bottomPad)

  // 无连线时的网格布局：枚举列数，按缩放与宽高比选最优
  const gridLayout = (list: ArrangeBlock[]): PlacedBlock[] => {
    const viewAspect = availW / availH
    const maxCols = Math.min(list.length, 20)
    let best: { placed: PlacedBlock[]; score: number } | null = null
    for (let cols = 1; cols <= maxCols; cols++) {
      const placed: PlacedBlock[] = []
      let y = 0
      let gridW = 0
      for (let i = 0; i < list.length; i += cols) {
        const row = list.slice(i, i + cols)
        const rowH = Math.max(...row.map((b) => b.h))
        let x = 0
        row.forEach((block) => {
          placed.push({ block, x, y })
          x += block.w + ARRANGE_GAP
          gridW = Math.max(gridW, x - ARRANGE_GAP)
        })
        y += rowH + ARRANGE_GAP
      }
      const gridH = Math.max(1, y - ARRANGE_GAP)
      const scale = Math.min(1, Math.max(0.1, Math.min(availW / gridW, availH / gridH)))
      const aspectScore = Math.abs(Math.log(gridW / gridH / viewAspect))
      const score = scale - aspectScore * 0.03
      if (!best || score > best.score) best = { placed, score }
    }
    return best?.placed ?? []
  }

  const placed: PlacedBlock[] = []
  const graphBlocks = blocks.filter((b) => connected.has(b.key))

  if (graphBlocks.length === 0) {
    placed.push(...gridLayout(blocks))
  } else {
    // 4. 脑图分层：按最长路径分层，DAG 下所有连线都指向右侧；
    //    Kahn 处理不到的环状部分再用 BFS 补层
    const level = new Map<string, number>()
    const indeg = new Map<string, number>()
    graphBlocks.forEach((b) => indeg.set(b.key, (inc.get(b.key) ?? []).length))

    const queue: string[] = []
    graphBlocks.forEach((b) => {
      if ((indeg.get(b.key) ?? 0) === 0) {
        level.set(b.key, 0)
        queue.push(b.key)
      }
    })

    for (let head = 0; head < queue.length; head++) {
      const key = queue[head]
      const lv = level.get(key) ?? 0
      out.get(key)?.forEach((to) => {
        level.set(to, Math.max(level.get(to) ?? 0, lv + 1))
        const d = (indeg.get(to) ?? 0) - 1
        indeg.set(to, d)
        if (d === 0) queue.push(to)
      })
    }

    let remaining = graphBlocks.filter((b) => !level.has(b.key))
    while (remaining.length > 0) {
      const rootKey = remaining[0].key
      const start = level.size > 0 ? Math.max(...level.values()) + 1 : 0
      level.set(rootKey, start)
      const bfs = [rootKey]
      for (let head = 0; head < bfs.length; head++) {
        const key = bfs[head]
        const lv = level.get(key) ?? start
        out.get(key)?.forEach((to) => {
          if (!level.has(to)) {
            level.set(to, lv + 1)
            bfs.push(to)
          }
        })
      }
      remaining = graphBlocks.filter((b) => !level.has(b.key))
    }

    // 层内排序：同一层按父节点在该层的序号排列，减少连线交叉
    const byLevel = new Map<number, ArrangeBlock[]>()
    graphBlocks.forEach((b) => {
      const l = level.get(b.key) ?? 0
      if (!byLevel.has(l)) byLevel.set(l, [])
      byLevel.get(l)!.push(b)
    })
    const levelKeys = Array.from(byLevel.keys()).sort((a, b) => a - b)
    const orderIndex = new Map<string, number>()

    levelKeys.forEach((l, idx) => {
      const arr = byLevel.get(l)!
      if (idx > 0) {
        arr.sort((a, b) => {
          const minParentOrder = (key: string) => {
            const parents = (inc.get(key) ?? []).filter((k) => (level.get(k) ?? l) < l)
            if (parents.length === 0) return 1e9
            return Math.min(...parents.map((k) => orderIndex.get(k) ?? 1e9))
          }
          const ma = minParentOrder(a.key)
          const mb = minParentOrder(b.key)
          if (ma !== mb) return ma - mb
          return a.createdAt - b.createdAt
        })
      } else {
        arr.sort((a, b) => a.createdAt - b.createdAt)
      }
      arr.forEach((b, i) => orderIndex.set(b.key, i))
    })

    // 列位置：每列宽度取该层最大块宽
    const colW = new Map<number, number>()
    levelKeys.forEach((l) => {
      colW.set(l, Math.max(...byLevel.get(l)!.map((b) => b.w)))
    })
    const xByLevel = new Map<number, number>()
    let gx = 0
    levelKeys.forEach((l) => {
      xByLevel.set(l, gx)
      gx += colW.get(l)! + ARRANGE_GAP
    })

    // 初始垂直居中，再把子节点向父节点垂直对齐
    const stackH = (l: number) => {
      const arr = byLevel.get(l)!
      return arr.reduce((s, b) => s + b.h, 0) + ARRANGE_GAP * (arr.length - 1)
    }
    const maxStackH = Math.max(...levelKeys.map((l) => stackH(l)))
    const yMap = new Map<string, number>()

    levelKeys.forEach((l) => {
      const arr = byLevel.get(l)!
      let y = (maxStackH - stackH(l)) / 2
      arr.forEach((b) => {
        yMap.set(b.key, y)
        y += b.h + ARRANGE_GAP
      })
    })

    levelKeys.forEach((l, idx) => {
      if (idx === 0) return
      const arr = byLevel.get(l)!
      let prevBottom = -Infinity
      arr.forEach((b) => {
        const parents = (inc.get(b.key) ?? []).filter((k) => (level.get(k) ?? l) < l)
        let y = yMap.get(b.key) ?? 0
        if (parents.length > 0) {
          const centers = parents.map((k) => {
            const pb = blockByKey.get(k)!
            return (yMap.get(k) ?? 0) + pb.h / 2
          })
          y = centers.reduce((s, c) => s + c, 0) / centers.length - b.h / 2
        }
        if (prevBottom !== -Infinity && y < prevBottom + ARRANGE_GAP) {
          y = prevBottom + ARRANGE_GAP
        }
        yMap.set(b.key, y)
        prevBottom = y + b.h
      })
    })

    graphBlocks.forEach((b) => {
      const l = level.get(b.key) ?? 0
      placed.push({ block: b, x: xByLevel.get(l) ?? 0, y: yMap.get(b.key) ?? 0 })
    })

    // 5. 无连线节点：在图形下方按尺寸铺排，行高对齐
    const loose = blocks.filter((b) => !connected.has(b.key))
    if (loose.length > 0) {
      const gMinX = Math.min(...placed.map((p) => p.x))
      const gMaxX = Math.max(...placed.map((p) => p.x + p.block.w))
      const gMaxY = Math.max(...placed.map((p) => p.y + p.block.h))
      const targetW = Math.max(300, gMaxX - gMinX)
      let lx = gMinX
      let ly = gMaxY + ARRANGE_GAP * 2
      let rowH = 0
      loose.forEach((b) => {
        if (lx > gMinX && lx + b.w > gMinX + targetW) {
          lx = gMinX
          ly += rowH + ARRANGE_GAP
          rowH = 0
        }
        placed.push({ block: b, x: lx, y: ly })
        lx += b.w + ARRANGE_GAP
        rowH = Math.max(rowH, b.h)
      })
    }
  }

  if (placed.length === 0) return

  // 6. 写入节点位置（分组整体位移），并计算整体包围盒
  const positions: Record<string, { x: number; y: number }> = {}
  placed.forEach(({ block, x, y }) => {
    if (block.kind === 'node' && block.node) {
      positions[block.node.id] = { x, y }
    } else if (block.members && block.bbox) {
      const dx = x - block.bbox.x
      const dy = y - block.bbox.y
      block.members.forEach((m) => {
        positions[m.id] = { x: m.x + dx, y: m.y + dy }
      })
    }
  })

  state.setNodePositions(positions)

  const minX = Math.min(...placed.map((p) => p.x))
  const minY = Math.min(...placed.map((p) => p.y))
  const maxX = Math.max(...placed.map((p) => p.x + p.block.w))
  const maxY = Math.max(...placed.map((p) => p.y + p.block.h))
  const bboxW = Math.max(1, maxX - minX)
  const bboxH = Math.max(1, maxY - minY)

  // 7. 自动缩放：最大 100%、最小 10%，居中到可视区域
  const scale = Math.min(1, Math.max(0.1, Math.min(availW / bboxW, availH / bboxH)))
  const cx = leftInset + sidePad + availW / 2
  const cy = topPad + availH / 2
  state.setViewport({
    x: cx - (minX + bboxW / 2) * scale,
    y: cy - (minY + bboxH / 2) * scale,
    scale,
  })
}

// 底部浮动栏：左侧缩放，中间 + 号 / 分组 / 解组 / 重置
export default function Toolbar() {
  const viewport = useCanvasStore((s) => s.viewport)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const zoomAt = useCanvasStore((s) => s.zoomAt)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const nodes = useCanvasStore((s) => s.nodes)
  const groups = useCanvasStore((s) => s.groups)
  const groupSelected = useCanvasStore((s) => s.groupSelected)
  const ungroup = useCanvasStore((s) => s.ungroup)
  const addNode = useCanvasStore((s) => s.addNode)
  const toggleAssetPanel = useCanvasStore((s) => s.toggleAssetPanel)
  const snapEnabled = useCanvasStore((s) => s.snapEnabled)
  const toggleSnap = useCanvasStore((s) => s.toggleSnap)

  const activeMenu = useCanvasStore((s) => s.activeMenu)
  const setActiveMenu = useCanvasStore((s) => s.setActiveMenu)
  const menuOpen = activeMenu === 'nodes'
  const zoomOpen = activeMenu === 'zoom'
  const mapOpen = activeMenu === 'minimap'
  const helpOpen = activeMenu === 'help'

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Esc 关闭底部菜单
  useEffect(() => {
    if (!menuOpen && !zoomOpen && !mapOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, zoomOpen, mapOpen, setActiveMenu])

  // Alt+Shift+F 整理画布
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.altKey && e.shiftKey && (e.code === 'KeyF' || e.key.toLowerCase() === 'f')) {
        e.preventDefault()
        arrangeCanvas()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cx = window.innerWidth / 2
  const cy = window.innerHeight / 2

  // 选中节点所属的组（取第一个有 groupId 的）
  const selectedGroupId = selectedIds
    .map((id) => nodes[id]?.groupId)
    .find((g): g is string => !!g)

  // 以视口中心为锚点缩放
  const zoomTo = (scale: number) => {
    const w = screenToWorld(cx, cy, useCanvasStore.getState().viewport)
    const s = Math.min(4, Math.max(0.1, scale))
    setViewport({ x: cx - w.x * s, y: cy - w.y * s, scale: s })
  }

  const resetZoom = () => zoomTo(1)

  // 适合屏幕：按所有节点包围盒缩放并居中
  const fitScreen = () => {
    const list = Object.values(useCanvasStore.getState().nodes)
    if (!list.length) {
      resetZoom()
      return
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    list.forEach((n) => {
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + n.width)
      maxY = Math.max(maxY, n.y + n.height)
    })
    const pad = 60
    const w = Math.max(1, maxX - minX + pad * 2)
    const h = Math.max(1, maxY - minY + pad * 2)
    const availW = window.innerWidth - 160
    const availH = window.innerHeight - 220
    const s = Math.min(4, Math.max(0.1, Math.min(availW / w, availH / h)))
    const wcx = (minX + maxX) / 2
    const wcy = (minY + maxY) / 2
    setViewport({ x: cx - wcx * s, y: cy - wcy * s, scale: s })
  }

  // 在可视区域中心创建节点，并自动避让已有节点
  const create = (type: NodeType) => {
    const { nodes, viewport } = useCanvasStore.getState()
    const w = window.innerWidth
    const h = window.innerHeight
    const center = screenToWorld(w / 2, h / 2, viewport)
    const tl = screenToWorld(24, 80, viewport)
    const br = screenToWorld(w - 24, h - 100, viewport)
    const spot = findFreeSpot(Object.values(nodes), 260, 160, center.x, center.y, {
      left: tl.x,
      top: tl.y,
      right: br.x,
      bottom: br.y,
    })
    addNode({ type, x: spot.x, y: spot.y, width: 260, height: 160, text: '' })
    setActiveMenu(null)
  }

  // 上传本地资源：按文件类型创建节点，并按真实宽高比适配
  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const list = Array.from(files)
    const { viewport } = useCanvasStore.getState()
    const center = screenToWorld(window.innerWidth / 2, window.innerHeight / 2, viewport)
    let offset = 0
    for (const file of list) {
      const type: NodeType | null = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : file.type.startsWith('audio/')
            ? 'audio'
            : null
      if (!type) continue
      const key = await saveFile(file).catch(() => undefined)
      const url = URL.createObjectURL(file)
      const dim = await measureMedia(file.type, url)
      const w = dim?.width ?? 320
      const h = dim?.height ?? 220
      const spot = findFreeSpot(
        Object.values(useCanvasStore.getState().nodes),
        w,
        h,
        center.x + offset,
        center.y + offset,
      )
      addNode({
        type,
        x: spot.x,
        y: spot.y,
        width: w,
        height: h,
        url,
        fileKey: key,
        // 音频节点在卡片内展示原始文件名
        ...(type === 'audio' ? { fileName: file.name } : {}),
      })
      offset += 32
    }
    setActiveMenu(null)
  }

  const q = query.trim()
  const filteredItems = NODE_TYPE_ITEMS.filter((it) => !q || it.label.includes(q))

  return (
    <>
      <div className="bottom-left">
        <button
          className="asset-toggle"
          title="资产管理"
          onClick={() => {
            setActiveMenu(null)
            toggleAssetPanel()
          }}
        >
          <PanelIcon />
          <span>资产管理</span>
        </button>

        <button className="arrange-btn" title="整理画布 Alt+Shift+F" onClick={arrangeCanvas}>
          <ArrangeIcon />
        </button>

        <MiniMap />

        <button
          className={`arrange-btn snap-btn ${snapEnabled ? 'is-active' : ''}`}
          title={`网格吸附（${snapEnabled ? '已开启' : '已关闭'}）`}
          aria-pressed={snapEnabled}
          onClick={toggleSnap}
        >
          <MagnetIcon />
        </button>

        <div className="zoom-wrap">
          <div className="zoom-pill">
            <button className="zoom-btn" title="缩小" onClick={() => zoomAt(cx, cy, 100)}>
              <MinusIcon />
            </button>
            <button
              className="zoom-value"
              title="缩放选项"
              onClick={() => setActiveMenu(zoomOpen ? null : 'zoom')}
            >
              {Math.round(viewport.scale * 100)}%
            </button>
            <button className="zoom-btn" title="放大" onClick={() => zoomAt(cx, cy, -100)}>
              <PlusIcon />
            </button>
          </div>

          {zoomOpen && (
            <>
              <div
                className="menu-backdrop"
                style={{ pointerEvents: 'auto' }}
                onMouseDown={() => setActiveMenu(null)}
              />
              <div className="zoom-menu" onMouseDown={(e) => e.stopPropagation()}>
                <div className="zoom-menu-title">缩放</div>
                <button className="zoom-menu-item" onClick={() => zoomAt(cx, cy, -100)}>
                  放大
                  <span className="zoom-menu-hint">滚轮上</span>
                </button>
                <button className="zoom-menu-item" onClick={() => zoomAt(cx, cy, 100)}>
                  缩小
                  <span className="zoom-menu-hint">滚轮下</span>
                </button>
                <button
                  className="zoom-menu-item"
                  onClick={() => {
                    fitScreen()
                    setActiveMenu(null)
                  }}
                >
                  适合屏幕
                </button>
                <div className="zoom-menu-divider" />
                {ZOOM_PRESETS.map((p) => (
                  <button
                    key={p}
                    className={`zoom-menu-item ${Math.abs(viewport.scale - p) < 0.001 ? 'is-active' : ''}`}
                    onClick={() => {
                      zoomTo(p)
                      setActiveMenu(null)
                    }}
                  >
                    缩放至 {p * 100}%
                    {Math.abs(viewport.scale - p) < 0.001 && <CheckIcon />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <span className="bottom-hint">
          {Object.keys(nodes).length} 节点 · {Object.keys(groups).length} 组
        </span>
      </div>

      <div className="bottom-bar">
        <div className="bb-bar">
          <div className="bb-plus-wrap">
            <button
              className="bb-primary"
              title="添加节点"
              onClick={() => {
                if (menuOpen) {
                  setActiveMenu(null)
                  return
                }
                setSearchOpen(false)
                setQuery('')
                setActiveMenu('nodes')
              }}
            >
              <BigPlusIcon />
            </button>

            {menuOpen && (
              <>
                <div
                  className="menu-backdrop"
                  style={{ pointerEvents: 'auto' }}
                  onMouseDown={() => setActiveMenu(null)}
                />
                <div className="node-menu" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="node-menu-head">
                    {searchOpen ? (
                      <input
                        autoFocus
                        className="node-menu-input"
                        placeholder="搜索节点类型"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    ) : (
                      <span className="node-menu-title">添加节点</span>
                    )}
                    <button
                      className="node-menu-search"
                      title={searchOpen ? '关闭搜索' : '搜索'}
                      onClick={() => {
                        setSearchOpen((v) => !v)
                        setQuery('')
                      }}
                    >
                      {searchOpen ? <CloseIcon /> : <SearchIcon />}
                    </button>
                  </div>

                  <div className="node-menu-list">
                    {filteredItems.map((it) => (
                      <button key={it.type} className="node-menu-item" onClick={() => create(it.type)}>
                        <span className="node-menu-icon">{it.icon}</span>
                        <span className="node-menu-label">{it.label}</span>
                      </button>
                    ))}
                    {filteredItems.length === 0 && (
                      <div className="node-menu-empty">没有匹配的节点类型</div>
                    )}
                  </div>

                  {!q && (
                    <>
                      <div className="node-menu-section">添加资源</div>
                      <button
                        className="node-menu-item"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <span className="node-menu-icon">
                          <UploadIcon />
                        </span>
                        <span className="node-menu-label">上传</span>
                        <span className="node-menu-hint">本地文件</span>
                      </button>
                      <button
                        className="node-menu-item is-disabled"
                        disabled
                        title="暂未接入生成历史"
                      >
                        <span className="node-menu-icon">
                          <HistoryIcon />
                        </span>
                        <span className="node-menu-label">从生成历史选择</span>
                        <span className="node-menu-badge">未接入</span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>

          <span className="bb-divider" />

          <BBtn
            title="分组（选中 ≥2 个节点）"
            disabled={selectedIds.length < 2}
            onClick={groupSelected}
          >
            <GroupIcon />
          </BBtn>

          <span className="bb-divider" />

          <BBtn title="解散所选分组" disabled={!selectedGroupId} onClick={() => selectedGroupId && ungroup(selectedGroupId)}>
            <UngroupIcon />
          </BBtn>

          <span className="bb-divider" />

          <BBtn title="回到原点（100%）" onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}>
            <ResetIcon />
          </BBtn>

          <span className="bb-divider" />

          <BBtn title="快捷键" onClick={() => setActiveMenu(helpOpen ? null : 'help')}>
            <KeyboardIcon />
          </BBtn>
          <div className="bb-pill" title="节点数">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" stroke="currentColor" strokeWidth="1.2" />
              <path d="M5.4 8h5.2M8 5.4v5.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span>{Object.keys(nodes).length}</span>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        hidden
        onChange={(e) => {
          uploadFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </>
  )
}

function BBtn({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button title={title} disabled={disabled} onClick={onClick} className="bb-btn">
      {children}
    </button>
  )
}

/* ---------------- 图标 ---------------- */

const svg = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none' } as const
const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function BigPlusIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 14 14" fill="none">
      <path d="M7 2.2v9.6M2.2 7h9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg {...svg}>
      <path d="M2.6 7h8.8" {...stroke} />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg {...svg}>
      <path d="M7 2.6v8.8M2.6 7h8.8" {...stroke} />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg {...svg}>
      <path d="M2.4 7.2a4.6 4.6 0 1 0 1.4-3.3" {...stroke} />
      <path d="M2.4 2.4v3.1h3.1" {...stroke} />
    </svg>
  )
}

function GroupIcon() {
  return (
    <svg {...svg}>
      <rect x="1.6" y="1.6" width="6.6" height="6.6" rx="1.5" {...stroke} />
      <rect x="5.8" y="5.8" width="6.6" height="6.6" rx="1.5" {...stroke} />
    </svg>
  )
}

function KeyboardIcon() {
  return (
    <svg {...svg}>
      <rect x="1.8" y="4" width="12.4" height="8" rx="1.8" {...stroke} />
      <path d="M4.4 6.4h.01M7 6.4h.01M9.6 6.4h.01M12.2 6.4h.01M4.4 9.2h.01M7 9.2h.01M9.6 9.2h.01M11.6 9.6h.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function UngroupIcon() {
  return (
    <svg {...svg}>
      <rect x="1.6" y="1.6" width="5.2" height="5.2" rx="1.2" {...stroke} />
      <rect x="7.2" y="7.2" width="5.2" height="5.2" rx="1.2" {...stroke} />
    </svg>
  )
}

function ArrangeIcon() {
  return (
    <svg {...svg}>
      <rect x="1.6" y="1.6" width="4.5" height="4.5" rx="1.2" {...stroke} />
      <rect x="7.9" y="1.6" width="4.5" height="4.5" rx="1.2" {...stroke} />
      <rect x="1.6" y="7.9" width="4.5" height="4.5" rx="1.2" {...stroke} />
      <rect x="7.9" y="7.9" width="4.5" height="4.5" rx="1.2" {...stroke} />
    </svg>
  )
}

function MagnetIcon() {
  return (
    <svg {...svg}>
      <path d="M3.2 2.3v4.4a3.8 3.8 0 0 0 7.6 0V2.3" {...stroke} />
      <path d="M3.2 2.3h2.2M8.6 2.3h2.2" {...stroke} />
    </svg>
  )
}

function PanelIcon() {
  return (
    <svg {...svg}>
      <rect x="1.6" y="2.2" width="10.8" height="9.6" rx="1.6" {...stroke} />
      <path d="M6.4 2.2v9.6" {...stroke} />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg {...svg}>
      <circle cx="6.2" cy="6.2" r="3.9" {...stroke} />
      <path d="M9.2 9.2l2.4 2.4" {...stroke} />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg {...svg}>
      <path d="M3.4 3.4l7.2 7.2M10.6 3.4L3.4 10.6" {...stroke} />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg {...svg}>
      <path d="M7 9.6V2.6M4.4 5.2 7 2.6l2.6 2.6" {...stroke} />
      <path d="M2.4 9.2v1.8c0 .7.5 1.2 1.2 1.2h6.8c.7 0 1.2-.5 1.2-1.2V9.2" {...stroke} />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg {...svg}>
      <circle cx="7" cy="7" r="4.6" {...stroke} />
      <path d="M7 4.4V7l1.9 1.2" {...stroke} />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg {...svg}>
      <path d="M2.8 7.2l2.8 2.8 5.6-6" {...stroke} />
    </svg>
  )
}
