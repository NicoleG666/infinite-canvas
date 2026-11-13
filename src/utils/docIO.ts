// 画布文档的规范化 / 备份导入导出
// 目标：外部 JSON（旧版导出、手工编辑、损坏数据）进来时先校验并补默认值，
// 保证后续代码拿到的始终是结构完整的 CanvasDoc。
import type {
  CanvasDoc,
  CanvasNode,
  CanvasGroup,
  Connection,
  NodeType,
  CodeLanguage,
  Viewport,
} from '../types'

export const DOC_SCHEMA_VERSION = 1

const NODE_TYPES: NodeType[] = ['text', 'image', 'video', 'audio', 'link', 'code']
const LANGUAGES: CodeLanguage[] = ['js', 'python', 'html']

let idSeq = 0
function genId(prefix: string): string {
  idSeq += 1
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function normalizeNode(raw: unknown): CanvasNode | null {
  if (!isObj(raw)) return null
  if (!NODE_TYPES.includes(raw.type as NodeType)) return null

  // blob: URL 只在当次会话有效，持久化/导入后必定失效，直接丢弃依赖 fileKey 恢复
  const rawUrl = optStr(raw.url)
  const url = rawUrl && !rawUrl.startsWith('blob:') ? rawUrl : undefined
  const language = LANGUAGES.includes(raw.language as CodeLanguage)
    ? (raw.language as CodeLanguage)
    : undefined

  return {
    id: optStr(raw.id) ?? genId('n'),
    type: raw.type as NodeType,
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: Math.max(40, num(raw.width, 260)),
    height: Math.max(40, num(raw.height, 160)),
    name: optStr(raw.name),
    tagColor: optStr(raw.tagColor),
    text: typeof raw.text === 'string' ? raw.text : undefined,
    url,
    fileKey: optStr(raw.fileKey),
    fileName: optStr(raw.fileName),
    linkUrl: optStr(raw.linkUrl),
    language,
    remark: typeof raw.remark === 'string' ? raw.remark : undefined,
    groupId: optStr(raw.groupId),
    createdAt: num(raw.createdAt, Date.now()),
  }
}

function normalizeViewport(raw: unknown): Viewport {
  if (!isObj(raw)) return { x: 0, y: 0, scale: 1 }
  return {
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    scale: Math.min(4, Math.max(0.1, num(raw.scale, 1))),
  }
}

/**
 * 把任意来源的数据规范化为 CanvasDoc。
 * 结构不可识别（没有节点数组）时返回 null。
 */
export function normalizeDoc(raw: unknown): CanvasDoc | null {
  if (!isObj(raw)) return null
  if (!Array.isArray(raw.nodes)) return null

  const nodes = raw.nodes.map(normalizeNode).filter((n): n is CanvasNode => !!n)
  const nodeIds = new Set(nodes.map((n) => n.id))

  const rawConnections = Array.isArray(raw.connections) ? raw.connections : []
  const connections: Connection[] = rawConnections
    .filter(isObj)
    .filter((c) => nodeIds.has(String(c.sourceId)) && nodeIds.has(String(c.targetId)))
    .map((c) => ({
      id: optStr(c.id) ?? genId('c'),
      sourceId: String(c.sourceId),
      targetId: String(c.targetId),
      createdAt: num(c.createdAt, Date.now()),
    }))

  const rawGroups = Array.isArray(raw.groups) ? raw.groups : []
  const groups: CanvasGroup[] = rawGroups
    .filter(isObj)
    .map((g) => ({
      id: optStr(g.id) ?? genId('g'),
      name: optStr(g.name) ?? '分组',
      nodeIds: Array.isArray(g.nodeIds)
        ? g.nodeIds.map(String).filter((id) => nodeIds.has(id))
        : [],
      createdAt: num(g.createdAt, Date.now()),
    }))
    .filter((g) => g.nodeIds.length > 0)

  const now = Date.now()
  const name = (optStr(raw.name) ?? '未命名画布').trim() || '未命名画布'
  const createdAt = num(raw.createdAt, now)
  const updatedAt = num(raw.updatedAt, createdAt)

  return {
    id: optStr(raw.id) ?? genId('doc'),
    name,
    createdAt,
    updatedAt,
    nodeCount: nodes.length,
    connectionCount: connections.length,
    groupCount: groups.length,
    sizeBytes: 0,
    schemaVersion: num(raw.schemaVersion, DOC_SCHEMA_VERSION),
    rev: num(raw.rev, 0),
    trashedAt: typeof raw.trashedAt === 'number' ? raw.trashedAt : undefined,
    nodes,
    connections,
    groups,
    viewport: normalizeViewport(raw.viewport),
  }
}

/** 文档里引用了媒体、但本次备份不含媒体文件的数量（用于导入后提示） */
export function mediaMissingCount(doc: CanvasDoc): number {
  return doc.nodes.filter((n) => !!n.fileKey && !n.url).length
}

/* ---------------- 备份文件 ---------------- */

export interface BackupBundle {
  app: 'infinite-canvas-notes'
  kind: 'backup'
  version: number
  exportedAt: number
  docs: CanvasDoc[]
}

export function buildBackupBundle(docs: CanvasDoc[]): BackupBundle {
  return {
    app: 'infinite-canvas-notes',
    kind: 'backup',
    version: DOC_SCHEMA_VERSION,
    exportedAt: Date.now(),
    docs,
  }
}

export interface ImportResult {
  docs: CanvasDoc[]
  skipped: number
}

/**
 * 解析导入文件，兼容三种形态：
 * 1. 单画布导出（当前「导出 JSON」）
 * 2. 全部备份（{ app, kind, docs: [] }）
 * 3. 画布数组
 */
export function parseImportFile(text: string): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('文件不是合法的 JSON')
  }

  let list: unknown[]
  if (Array.isArray(data)) {
    list = data
  } else if (isObj(data) && Array.isArray(data.docs)) {
    list = data.docs
  } else {
    list = [data]
  }

  const docs: CanvasDoc[] = []
  let skipped = 0
  for (const item of list) {
    const doc = normalizeDoc(item)
    if (doc) docs.push(doc)
    else skipped += 1
  }

  if (docs.length === 0) throw new Error('文件里没有可识别的画布数据')
  return { docs, skipped }
}
