import { create } from 'zustand'
import type {
  CanvasNode,
  Connection,
  CanvasGroup,
  Viewport,
  DraggingConnection,
  ContextMenuState,
  RightMenuState,
  CanvasDocMeta,
  NodeType,
  SnapGuide,
  UserProfile,
} from '../types'

let nodeIdCounter = 0
export const genId = (prefix = 'n') =>
  `${prefix}_${Date.now().toString(36)}_${(nodeIdCounter++).toString(36)}`

// 节点默认名称前缀，与底部新建菜单的类型文案一致
const TYPE_LABEL: Record<NodeType, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  link: '链接',
  code: '代码',
}

// 默认名称：同类型已有名称中的最大编号 + 1（图片1、图片2…）
function defaultNodeName(type: NodeType, nodes: Record<string, CanvasNode>) {
  const label = TYPE_LABEL[type]
  let max = 0
  Object.values(nodes).forEach((n) => {
    if (!n.name) return
    const m = new RegExp(`^${label}(\\d+)$`).exec(n.name)
    if (m) max = Math.max(max, Number(m[1]))
  })
  return `${label}${max + 1}`
}

interface DocSnapshot {
  nodes: Record<string, CanvasNode>
  connections: Record<string, Connection>
  groups: Record<string, CanvasGroup>
}

const HISTORY_LIMIT = 60
const HISTORY_DELAY = 450
const PASTE_OFFSET = 36

const snapshotOf = (s: DocSnapshot): DocSnapshot => ({
  nodes: s.nodes,
  connections: s.connections,
  groups: s.groups,
})

let historyPast: DocSnapshot[] = []
let historyFuture: DocSnapshot[] = []
let lastCommitted: DocSnapshot | null = null
let historyTimer: number | null = null
let suppressHistory = false
let clipboard: { nodes: CanvasNode[]; connections: Connection[] } | null = null

function syncHistoryFlags() {
  useCanvasStore.setState({
    canUndo: historyPast.length > 0,
    canRedo: historyFuture.length > 0,
  })
}

// 把「上一段稳定状态」压入撤销栈；连续操作（拖拽、输入）会合并成一条
function flushPendingHistory() {
  if (historyTimer !== null) {
    window.clearTimeout(historyTimer)
    historyTimer = null
  }
  if (!lastCommitted) return
  const current = snapshotOf(useCanvasStore.getState())
  if (
    current.nodes === lastCommitted.nodes &&
    current.connections === lastCommitted.connections &&
    current.groups === lastCommitted.groups
  ) {
    return
  }
  historyPast.push(lastCommitted)
  if (historyPast.length > HISTORY_LIMIT) historyPast.shift()
  historyFuture = []
  lastCommitted = current
  syncHistoryFlags()
}

function applySnapshot(snap: DocSnapshot) {
  suppressHistory = true
  useCanvasStore.setState({
    nodes: snap.nodes,
    connections: snap.connections,
    groups: snap.groups,
    selectedIds: [],
    selectedGroupId: null,
    selectedConnectionId: null,
    focusedGroupId: null,
    draggingConnection: null,
    contextMenu: null,
    rightMenu: null,
    remarkOpenId: null,
    snapGuides: [],
  })
  lastCommitted = snap
  suppressHistory = false
}

function resetHistory() {
  if (historyTimer !== null) {
    window.clearTimeout(historyTimer)
    historyTimer = null
  }
  historyPast = []
  historyFuture = []
  lastCommitted = snapshotOf(useCanvasStore.getState())
  syncHistoryFlags()
}

interface CanvasState {
  // 文档
  docId: string | null
  docMetas: CanvasDocMeta[]

  nodes: Record<string, CanvasNode>
  connections: Record<string, Connection>
  groups: Record<string, CanvasGroup>
  viewport: Viewport
  selectedIds: string[]
  selectedGroupId: string | null
  selectedConnectionId: string | null
  focusedGroupId: string | null
  draggingConnection: DraggingConnection | null
  contextMenu: ContextMenuState | null
  rightMenu: RightMenuState | null
  remarkOpenId: string | null
  // 顶栏 / 底栏的浮层菜单，同一时间只允许一个
  activeMenu: 'canvas' | 'help' | 'nodes' | 'share' | 'user' | 'zoom' | 'minimap' | null
  // 本地用户资料（昵称 / 头像 / 会员状态）
  profile: UserProfile | null
  setProfile: (profile: UserProfile | null) => void
  // 资产抽屉
  assetPanelOpen: boolean
  toggleAssetPanel: () => void
  // 网格吸附：拖动节点时对齐其它节点的边 / 中心并显示参考线
  snapEnabled: boolean
  snapGuides: SnapGuide[]
  toggleSnap: () => void
  setSnapGuides: (guides: SnapGuide[]) => void

  // 撤销 / 重做 / 剪贴板
  canUndo: boolean
  canRedo: boolean
  hasClipboard: boolean
  undo: () => void
  redo: () => void
  copySelection: () => void
  pasteClipboard: () => void

  // 文档
  setDocId: (id: string | null) => void
  setDocMetas: (metas: CanvasDocMeta[]) => void
  resetCanvas: () => void

  // 视口
  setViewport: (vp: Partial<Viewport>) => void
  pan: (dx: number, dy: number) => void
  zoomAt: (screenX: number, screenY: number, delta: number) => void

  // 节点
  addNode: (node: Partial<CanvasNode> & { type: NodeType; x: number; y: number }) => string
  updateNode: (id: string, patch: Partial<CanvasNode>) => void
  removeNode: (id: string) => void
  setNodeSize: (id: string, width: number, height: number) => void
  // 批量设置节点坐标（整组拖拽时一次更新，避免多次渲染）
  setNodePositions: (positions: Record<string, { x: number; y: number }>) => void

  // 选择
  setSelected: (ids: string[]) => void
  toggleSelected: (id: string) => void
  selectConnection: (id: string | null) => void

  // 连线
  addConnection: (sourceId: string, targetId: string) => void
  removeConnection: (id: string) => void
  setDraggingConnection: (dc: DraggingConnection | null) => void
  setContextMenu: (cm: ContextMenuState | null) => void
  setRightMenu: (rm: RightMenuState | null) => void

  // 分组
  groupSelected: () => string | null
  ungroup: (groupId: string) => void
  renameGroup: (groupId: string, name: string) => void
  selectGroup: (groupId: string | null) => void
  // 进入 / 退出分组内部空间
  enterGroup: (groupId: string) => void
  exitGroup: () => void

  // 备注
  setRemarkOpen: (id: string | null) => void
  setActiveMenu: (menu: 'canvas' | 'help' | 'nodes' | 'share' | 'user' | 'zoom' | 'minimap' | null) => void

  // 整体
  loadState: (data: {
    nodes: CanvasNode[]
    connections: Connection[]
    groups: CanvasGroup[]
    viewport?: Viewport
  }) => void
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  docId: null,
  docMetas: [],

  nodes: {},
  connections: {},
  groups: {},
  viewport: { x: 0, y: 0, scale: 1 },
  selectedIds: [],
  selectedGroupId: null,
  selectedConnectionId: null,
  focusedGroupId: null,
  draggingConnection: null,
  contextMenu: null,
  rightMenu: null,
  remarkOpenId: null,
  activeMenu: null,
  profile: null,
  assetPanelOpen: false,
  snapEnabled: false,
  snapGuides: [],
  canUndo: false,
  canRedo: false,
  hasClipboard: false,

  setDocId: (id) => set({ docId: id }),
  setDocMetas: (metas) => set({ docMetas: metas }),

  resetCanvas: () => {
    set({
      nodes: {},
      connections: {},
      groups: {},
      viewport: { x: 0, y: 0, scale: 1 },
      selectedIds: [],
      selectedGroupId: null,
      selectedConnectionId: null,
      focusedGroupId: null,
      draggingConnection: null,
      contextMenu: null,
      rightMenu: null,
      remarkOpenId: null,
      activeMenu: null,
      snapGuides: [],
    })
    resetHistory()
  },

  setViewport: (vp) => set((s) => ({ viewport: { ...s.viewport, ...vp } })),

  pan: (dx, dy) =>
    set((s) => ({
      viewport: { ...s.viewport, x: s.viewport.x + dx, y: s.viewport.y + dy },
    })),

  zoomAt: (screenX, screenY, delta) => {
    const { viewport } = get()
    const factor = delta < 0 ? 1.1 : 1 / 1.1
    const newScale = Math.min(4, Math.max(0.1, viewport.scale * factor))
    // 以鼠标为中心缩放：保持鼠标下的世界点不动
    const worldX = (screenX - viewport.x) / viewport.scale
    const worldY = (screenY - viewport.y) / viewport.scale
    const newX = screenX - worldX * newScale
    const newY = screenY - worldY * newScale
    set({ viewport: { x: newX, y: newY, scale: newScale } })
  },

  addNode: (node) => {
    const id = genId()
    const full: CanvasNode = {
      id,
      type: node.type,
      x: node.x,
      y: node.y,
      width: node.width ?? 260,
      height: node.height ?? 160,
      name: node.name ?? defaultNodeName(node.type, get().nodes),
      tagColor: node.tagColor,
      text: node.text ?? '',
      url: node.url,
      fileKey: node.fileKey,
      fileName: node.fileName,
      linkUrl: node.linkUrl,
      remark: node.remark ?? '',
      groupId: node.groupId,
      createdAt: Date.now(),
    }
    set((s) => ({ nodes: { ...s.nodes, [id]: full } }))
    return id
  },

  updateNode: (id, patch) =>
    set((s) => ({
      nodes: { ...s.nodes, [id]: { ...s.nodes[id], ...patch } },
    })),

  removeNode: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.nodes
      // 移除相关连线
      const connections = { ...s.connections }
      Object.keys(connections).forEach((cid) => {
        const c = connections[cid]
        if (c.sourceId === id || c.targetId === id) delete connections[cid]
      })
      // 从所属分组中移除
      const groups = { ...s.groups }
      Object.keys(groups).forEach((gid) => {
        const g = groups[gid]
        if (g.nodeIds.includes(id)) {
          const nodeIds = g.nodeIds.filter((n) => n !== id)
          if (nodeIds.length === 0) delete groups[gid]
          else groups[gid] = { ...g, nodeIds }
        }
      })
      return { nodes: rest, connections, groups }
    }),

  setNodeSize: (id, width, height) =>
    set((s) => ({
      nodes: { ...s.nodes, [id]: { ...s.nodes[id], width, height } },
    })),

  setNodePositions: (positions) =>
    set((s) => {
      const nodes = { ...s.nodes }
      Object.entries(positions).forEach(([id, pos]) => {
        if (nodes[id]) nodes[id] = { ...nodes[id], x: pos.x, y: pos.y }
      })
      return { nodes }
    }),

  setSelected: (ids) =>
    set({ selectedIds: ids, selectedGroupId: null, selectedConnectionId: null }),

  selectConnection: (id) =>
    set((s) => ({
      selectedConnectionId: id,
      ...(id ? { selectedIds: [], selectedGroupId: null } : {}),
    })),

  selectGroup: (groupId) =>
    set((s) => {
      if (!groupId) return { selectedGroupId: null, selectedIds: [], selectedConnectionId: null }
      const g = s.groups[groupId]
      return {
        selectedGroupId: groupId,
        selectedConnectionId: null,
        // 选中分组等同于选中全部成员（工具栏分组/解组、删除等沿用同一套选择语义）
        selectedIds: g ? [...g.nodeIds] : [],
      }
    }),

  enterGroup: (groupId) =>
    set({ focusedGroupId: groupId, selectedGroupId: groupId, selectedConnectionId: null }),

  exitGroup: () => set({ focusedGroupId: null, selectedGroupId: null }),

  toggleSelected: (id) =>
    set((s) => {
      const exists = s.selectedIds.includes(id)
      return {
        selectedIds: exists ? s.selectedIds.filter((i) => i !== id) : [...s.selectedIds, id],
        selectedConnectionId: null,
      }
    }),

  addConnection: (sourceId, targetId) => {
    if (sourceId === targetId) return
    // 去重（允许无向重复检查）
    const exists = Object.values(get().connections).some(
      (c) =>
        (c.sourceId === sourceId && c.targetId === targetId) ||
        (c.sourceId === targetId && c.targetId === sourceId),
    )
    if (exists) return
    const id = genId('c')
    set((s) => ({
      connections: {
        ...s.connections,
        [id]: { id, sourceId, targetId, createdAt: Date.now() },
      },
    }))
  },

  removeConnection: (id) =>
    set((s) => {
      const { [id]: _r, ...rest } = s.connections
      return {
        connections: rest,
        selectedConnectionId: s.selectedConnectionId === id ? null : s.selectedConnectionId,
      }
    }),

  setDraggingConnection: (dc) => set({ draggingConnection: dc }),
  setContextMenu: (cm) => set({ contextMenu: cm }),
  setRightMenu: (rm) => set({ rightMenu: rm }),

  groupSelected: () => {
    const { selectedIds, nodes } = get()
    if (selectedIds.length < 2) return null
    const groupId = genId('g')
    const group: CanvasGroup = {
      id: groupId,
      name: `分组 ${Object.keys(get().groups).length + 1}`,
      nodeIds: [...selectedIds],
      createdAt: Date.now(),
    }
    set((s) => {
      const newNodes = { ...s.nodes }
      selectedIds.forEach((nid) => {
        if (newNodes[nid]) newNodes[nid] = { ...newNodes[nid], groupId }
      })
      return { groups: { ...s.groups, [groupId]: group }, nodes: newNodes }
    })
    return groupId
  },

  ungroup: (groupId) =>
    set((s) => {
      const { [groupId]: _r, ...rest } = s.groups
      const newNodes = { ...s.nodes }
      Object.values(newNodes).forEach((n) => {
        if (n.groupId === groupId) newNodes[n.id] = { ...n, groupId: undefined }
      })
      return {
        groups: rest,
        nodes: newNodes,
        selectedGroupId: s.selectedGroupId === groupId ? null : s.selectedGroupId,
        focusedGroupId: s.focusedGroupId === groupId ? null : s.focusedGroupId,
      }
    }),

  renameGroup: (groupId, name) =>
    set((s) => {
      const g = s.groups[groupId]
      if (!g) return {}
      return { groups: { ...s.groups, [groupId]: { ...g, name } } }
    }),

  setRemarkOpen: (id) => set({ remarkOpenId: id }),
  setActiveMenu: (menu) => set({ activeMenu: menu }),
  setProfile: (profile) => set({ profile }),
  toggleAssetPanel: () => set((s) => ({ assetPanelOpen: !s.assetPanelOpen })),

  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled, snapGuides: [] })),
  setSnapGuides: (guides) => set({ snapGuides: guides }),

  undo: () => {
    flushPendingHistory()
    const prev = historyPast.pop()
    if (!prev) {
      syncHistoryFlags()
      return
    }
    historyFuture.push(snapshotOf(get()))
    applySnapshot(prev)
    syncHistoryFlags()
  },

  redo: () => {
    flushPendingHistory()
    const next = historyFuture.pop()
    if (!next) {
      syncHistoryFlags()
      return
    }
    historyPast.push(snapshotOf(get()))
    applySnapshot(next)
    syncHistoryFlags()
  },

  copySelection: () => {
    const { selectedIds, nodes, connections } = get()
    const picked = selectedIds.map((id) => nodes[id]).filter(Boolean) as CanvasNode[]
    if (picked.length === 0) return
    const ids = new Set(picked.map((n) => n.id))
    clipboard = {
      nodes: picked.map((n) => ({ ...n })),
      connections: Object.values(connections)
        .filter((c) => ids.has(c.sourceId) && ids.has(c.targetId))
        .map((c) => ({ ...c })),
    }
    set({ hasClipboard: true })
  },

  pasteClipboard: () => {
    if (!clipboard) return
    const data = clipboard
    set((s) => {
      const nodes = { ...s.nodes }
      const connections = { ...s.connections }
      const idMap = new Map<string, string>()
      data.nodes.forEach((n) => {
        const id = genId()
        idMap.set(n.id, id)
        nodes[id] = {
          ...n,
          id,
          x: n.x + PASTE_OFFSET,
          y: n.y + PASTE_OFFSET,
          name: defaultNodeName(n.type, nodes),
          groupId: undefined,
          createdAt: Date.now(),
        }
      })
      data.connections.forEach((c) => {
        const sourceId = idMap.get(c.sourceId)
        const targetId = idMap.get(c.targetId)
        if (!sourceId || !targetId) return
        const cid = genId('c')
        connections[cid] = { id: cid, sourceId, targetId, createdAt: Date.now() }
      })
      return {
        nodes,
        connections,
        selectedIds: Array.from(idMap.values()),
        selectedGroupId: null,
        selectedConnectionId: null,
      }
    })
  },

  loadState: (data) => {
    const nodes: Record<string, CanvasNode> = {}
    // 兼容旧文档：按创建顺序给没有名称的节点补默认名称
    const counters: Record<string, number> = {}
    ;[...data.nodes]
      .sort((a, b) => a.createdAt - b.createdAt)
      .forEach((n) => {
        let name = n.name
        if (!name) {
          counters[n.type] = (counters[n.type] ?? 0) + 1
          name = `${TYPE_LABEL[n.type]}${counters[n.type]}`
        } else {
          const m = new RegExp(`^${TYPE_LABEL[n.type]}(\\d+)$`).exec(name)
          if (m) counters[n.type] = Math.max(counters[n.type] ?? 0, Number(m[1]))
        }
        nodes[n.id] = { ...n, name }
      })
    const connections: Record<string, Connection> = {}
    data.connections.forEach((c) => (connections[c.id] = c))
    const groups: Record<string, CanvasGroup> = {}
    data.groups.forEach((g) => (groups[g.id] = g))
    set({
      nodes,
      connections,
      groups,
      viewport: data.viewport ?? { x: 0, y: 0, scale: 1 },
      selectedIds: [],
      selectedGroupId: null,
      selectedConnectionId: null,
      focusedGroupId: null,
      snapGuides: [],
    })
    resetHistory()
  },
}))

// 文档内容变化后延迟合并为一条历史记录；视口 / 选择等 UI 状态不进入历史
lastCommitted = snapshotOf(useCanvasStore.getState())
useCanvasStore.subscribe((state) => {
  if (suppressHistory) return
  if (!lastCommitted) return
  if (
    state.nodes === lastCommitted.nodes &&
    state.connections === lastCommitted.connections &&
    state.groups === lastCommitted.groups
  ) {
    return
  }
  if (historyTimer !== null) window.clearTimeout(historyTimer)
  historyTimer = window.setTimeout(() => {
    historyTimer = null
    flushPendingHistory()
  }, HISTORY_DELAY)
})
