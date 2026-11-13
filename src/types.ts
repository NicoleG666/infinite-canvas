// 节点类型
export type NodeType = 'text' | 'image' | 'video' | 'audio' | 'link' | 'code'

// 代码块语言
export type CodeLanguage = 'js' | 'python' | 'html'

// 画布节点
export interface CanvasNode {
  id: string
  type: NodeType
  x: number // 世界坐标（左上角）
  y: number
  width: number
  height: number
  // 名称：默认「图片1 / 文本1」这类，双击可编辑
  name?: string
  // 标签颜色：五色标签之一，未设置表示无标签
  tagColor?: string
  // 内容
  text?: string
  url?: string // 图片/视频/音频 blob URL 或链接
  fileKey?: string // IndexedDB 中文件 blob 的 key（用于恢复 url）
  fileName?: string // 上传时的原始文件名（音频节点用于展示名称）
  linkUrl?: string // 链接节点的 URL
  language?: CodeLanguage // 代码块语言，未设置时按内容自动判断
  remark?: string // 备注
  // 引用
  groupId?: string
  createdAt: number
}

// 连线
export interface Connection {
  id: string
  sourceId: string
  targetId: string
  createdAt: number
}

// 分组
export interface CanvasGroup {
  id: string
  name: string
  nodeIds: string[]
  createdAt: number
}

// 拖动节点时的对齐参考线（世界坐标）：axis='x' 为竖线，axis='y' 为横线
export interface SnapGuide {
  axis: 'x' | 'y'
  position: number
  start: number
  end: number
}

// 视口变换
export interface Viewport {
  x: number // 平移量（像素）
  y: number
  scale: number // 缩放比例
}

// 拖拽连线状态
export interface DraggingConnection {
  sourceId: string
  cursorX: number // 世界坐标
  cursorY: number
}

// 上下文菜单状态
export interface ContextMenuState {
  x: number // 屏幕坐标
  y: number
  sourceId: string
}

// 画布文档元数据（列表展示用，不含内容）
export interface CanvasDocMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number
  connectionCount: number
  groupCount: number
  sizeBytes: number
}

// 画布文档（完整内容 = 元数据 + 画布数据）
export interface CanvasDoc extends CanvasDocMeta {
  // 文档结构版本，用于后续兼容旧数据
  schemaVersion?: number
  // 写入版本号：每次落盘 +1，多标签页据此检测覆盖冲突
  rev?: number
  // 进入回收站的时间；为空表示正常文档
  trashedAt?: number
  nodes: CanvasNode[]
  connections: Connection[]
  groups: CanvasGroup[]
  viewport: Viewport
}

// 资产库：笔记级素材（跨画布共享）
export type AssetType = 'image' | 'video' | 'audio' | 'file'

export interface Asset {
  id: string
  name: string
  type: AssetType
  mime: string
  size: number
  fileKey: string
  categoryId?: string
  createdAt: number
}

export interface AssetCategory {
  id: string
  name: string
  kind?: AssetType // 默认分类按类型自动归类
  createdAt: number
}

// 右键菜单（画布空白 / 节点 / 分组）
export interface RightMenuState {
  x: number
  y: number
  targetType: 'canvas' | 'node' | 'group'
  targetId?: string
}

// 本地用户资料：无账号体系，仅保存在本机 IndexedDB
export interface UserProfile {
  id: string // 展示用用户 ID，如 IC-7K3F-92QM
  nickname: string
  avatarIndex: number // 头像渐变预设下标
  plan: 'free' | 'pro' // 会员状态（本地记录）
  createdAt: number
}
