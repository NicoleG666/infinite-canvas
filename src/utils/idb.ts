// IndexedDB 封装：多画布文档 + 文件 blob
import type {
  CanvasDoc,
  CanvasDocMeta,
  CanvasNode,
  Connection,
  CanvasGroup,
  Viewport,
  Asset,
  AssetCategory,
  UserProfile,
} from '../types'

const DB_NAME = 'infinite-canvas-notes'
const STORE_FILES = 'files'
const STORE_DOCS = 'docs'
const STORE_LEGACY = 'canvas' // 旧版单画布存储，仅用于迁移
const STORE_ASSETS = 'assets'
const STORE_ASSET_CATEGORIES = 'assetCategories'
const STORE_PROFILE = 'profile'
const PROFILE_KEY = 'local'
const REQUIRED_STORES = [
  STORE_FILES,
  STORE_DOCS,
  STORE_LEGACY,
  STORE_ASSETS,
  STORE_ASSET_CATEGORIES,
  STORE_PROFILE,
]

let dbPromise: Promise<IDBDatabase> | null = null

// 打开数据库请求：不指定版本时打开现有版本，指定版本时触发升级
function openRequest(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false
    // 超时保护：避免 open 被 blocked 时整个应用静默挂起
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('timeout'))
    }, 8000)

    let req: IDBOpenDBRequest
    try {
      req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version)
    } catch (e) {
      window.clearTimeout(timer)
      settled = true
      reject(e)
      return
    }

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES)
      }
      if (!db.objectStoreNames.contains(STORE_LEGACY)) {
        db.createObjectStore(STORE_LEGACY)
      }
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        db.createObjectStore(STORE_DOCS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_ASSET_CATEGORIES)) {
        db.createObjectStore(STORE_ASSET_CATEGORIES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_PROFILE)) {
        // 单条记录，外部键固定为 PROFILE_KEY
        db.createObjectStore(STORE_PROFILE)
      }
    }

    // 旧连接占用导致升级被阻塞时，明确失败而不是无限等待
    req.onblocked = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(new Error('blocked'))
    }

    req.onsuccess = () => {
      if (settled) {
        req.result.close()
        return
      }
      settled = true
      window.clearTimeout(timer)
      const db = req.result
      // 其他标签页请求升级时主动让出连接，避免后续被阻塞
      db.onversionchange = () => db.close()
      resolve(db)
    }

    req.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(req.error)
    }
  })
}

async function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    // 以现有版本打开：库可能被旧版代码升到更高版本，写死版本会抛 VersionError
    let db = await openRequest()
    // 若缺少所需 store，则在现有版本上 +1 触发升级补齐（版本只能升不能降）
    if (REQUIRED_STORES.some((name) => !db.objectStoreNames.contains(name))) {
      const next = db.version + 1
      db.close()
      db = await openRequest(next)
    }
    return db
  })()
  // 失败后允许下次重试
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

/* ---------------- 文件 blob ---------------- */

export async function saveFile(blob: Blob): Promise<string> {
  const db = await openDB()
  const key = `file_${Date.now()}_${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite')
    tx.objectStore(STORE_FILES).put(blob, key)
    tx.oncomplete = () => resolve(key)
    tx.onerror = () => reject(tx.error)
  })
}

export async function getFile(key: string): Promise<Blob | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readonly')
    const req = tx.objectStore(STORE_FILES).get(key)
    req.onsuccess = () => resolve((req.result as Blob) || null)
    req.onerror = () => reject(req.error)
  })
}

/* ---------------- 画布文档 ---------------- */

// 计算文档体积（字节）
function docSize(doc: CanvasDoc): number {
  try {
    return new Blob([JSON.stringify(doc)]).size
  } catch {
    return 0
  }
}

// 只取元数据，避免列表加载全部内容
function toMeta(doc: CanvasDoc): CanvasDocMeta {
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    nodeCount: doc.nodes?.length ?? 0,
    connectionCount: doc.connections?.length ?? 0,
    groupCount: doc.groups?.length ?? 0,
    sizeBytes: docSize(doc),
  }
}

// 多标签页写冲突：库中版本与期望版本不一致时抛出，由调用方提示用户而不是静默覆盖
export class DocConflictError extends Error {
  docId: string
  constructor(docId: string) {
    super('另一个标签页已修改该画布')
    this.name = 'DocConflictError'
    this.docId = docId
  }
}

/**
 * 写入文档。
 * 传入 expectedRev 时启用乐观锁：只有库中版本一致才写入，否则抛 DocConflictError。
 * 返回写入后的新版本号，调用方需要保存它用于下一次写入。
 */
export async function putDocGuarded(doc: CanvasDoc, expectedRev?: number): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readwrite')
    const store = tx.objectStore(STORE_DOCS)
    let nextRev = 1
    let conflict = false
    const req = store.get(doc.id)
    req.onsuccess = () => {
      const existing = req.result as CanvasDoc | undefined
      const currentRev = existing?.rev ?? 0
      if (expectedRev !== undefined && currentRev !== expectedRev) {
        conflict = true
        return
      }
      nextRev = currentRev + 1
      store.put({ ...doc, rev: nextRev })
    }
    tx.oncomplete = () => (conflict ? reject(new DocConflictError(doc.id)) : resolve(nextRev))
    tx.onerror = () => reject(tx.error ?? new Error('storage-error'))
    tx.onabort = () => reject(tx.error ?? new Error('storage-aborted'))
  })
}

export async function putDoc(doc: CanvasDoc): Promise<number> {
  return putDocGuarded(doc)
}

export async function getDoc(id: string): Promise<CanvasDoc | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readonly')
    const req = tx.objectStore(STORE_DOCS).get(id)
    req.onsuccess = () => resolve((req.result as CanvasDoc) || null)
    req.onerror = () => reject(req.error)
  })
}

// 读取全部文档（含回收站），用于备份导出与文件清理
export async function getAllDocs(): Promise<CanvasDoc[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readonly')
    const req = tx.objectStore(STORE_DOCS).getAll()
    req.onsuccess = () => resolve((req.result as CanvasDoc[]) || [])
    req.onerror = () => reject(req.error)
  })
}

export async function listDocMetas(): Promise<CanvasDocMeta[]> {
  const docs = await getAllDocs()
  const metas = docs
    .filter((doc) => !doc.trashedAt)
    .map(toMeta)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return metas
}

// 回收站列表
export async function listTrashMetas(): Promise<(CanvasDocMeta & { trashedAt: number })[]> {
  const docs = await getAllDocs()
  return docs
    .filter((doc) => !!doc.trashedAt)
    .map((doc) => ({ ...toMeta(doc), trashedAt: doc.trashedAt as number }))
    .sort((a, b) => b.trashedAt - a.trashedAt)
}

// 物理删除（彻底删除 / 清理过期回收站）
export async function deleteDoc(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readwrite')
    tx.objectStore(STORE_DOCS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// 移入回收站：保留内容，只打删除时间标记
export async function trashDoc(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readwrite')
    const store = tx.objectStore(STORE_DOCS)
    const req = store.get(id)
    req.onsuccess = () => {
      const doc = req.result as CanvasDoc | undefined
      if (!doc) return
      store.put({ ...doc, trashedAt: Date.now(), rev: (doc.rev ?? 0) + 1 })
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('storage-error'))
  })
}

// 从回收站恢复
export async function restoreDoc(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOCS, 'readwrite')
    const store = tx.objectStore(STORE_DOCS)
    const req = store.get(id)
    req.onsuccess = () => {
      const doc = req.result as CanvasDoc | undefined
      if (!doc) return
      const { trashedAt: _trashed, ...rest } = doc
      const restored: CanvasDoc = { ...rest, updatedAt: Date.now(), rev: (doc.rev ?? 0) + 1 }
      store.put(restored)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('storage-error'))
  })
}

// 清理超过保留期的回收站文档，返回被清理的 ID
export async function purgeExpiredTrash(retentionDays = 30): Promise<string[]> {
  const docs = await getAllDocs()
  const limit = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const expired = docs.filter((doc) => doc.trashedAt && doc.trashedAt < limit).map((doc) => doc.id)
  for (const id of expired) await deleteDoc(id)
  return expired
}

// 清理没有被任何画布 / 资产引用的媒体文件，避免磁盘只增不减
export async function cleanupOrphanFiles(): Promise<number> {
  const db = await openDB()
  const [docs, assets] = await Promise.all([getAllDocs(), listAssets()])
  const used = new Set<string>()
  docs.forEach((doc) => {
    doc.nodes?.forEach((n) => {
      if (n.fileKey) used.add(n.fileKey)
    })
  })
  assets.forEach((a) => {
    if (a.fileKey) used.add(a.fileKey)
  })

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite')
    const store = tx.objectStore(STORE_FILES)
    let removed = 0
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      if (!used.has(String(cursor.key))) {
        cursor.delete()
        removed += 1
      }
      cursor.continue()
    }
    tx.oncomplete = () => resolve(removed)
    tx.onerror = () => reject(tx.error)
  })
}

// 本地存储配额：用于写入失败前给出明确提示
export async function getStorageEstimate(): Promise<{
  usage: number
  quota: number
  ratio: number
} | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    if (!quota) return null
    return { usage, quota, ratio: usage / quota }
  } catch {
    return null
  }
}

/* ---------------- 旧版迁移 ---------------- */

interface LegacyState {
  nodes?: CanvasNode[]
  connections?: Connection[]
  groups?: CanvasGroup[]
}

// 若 docs 为空且存在旧单画布数据，则迁移为首个文档
export async function migrateLegacyIfNeeded(): Promise<CanvasDoc | null> {
  const db = await openDB()
  const existing = await listDocMetas()
  if (existing.length > 0) return null

  const legacy = await new Promise<LegacyState | null>((resolve, reject) => {
    const tx = db.transaction(STORE_LEGACY, 'readonly')
    const req = tx.objectStore(STORE_LEGACY).get('current')
    req.onsuccess = () => resolve((req.result as LegacyState) || null)
    req.onerror = () => reject(req.error)
  })
  if (!legacy || !legacy.nodes?.length) return null

  const now = Date.now()
  const doc: CanvasDoc = {
    id: `doc_${now.toString(36)}`,
    name: '我的第一个画布',
    createdAt: now,
    updatedAt: now,
    nodeCount: legacy.nodes.length,
    connectionCount: legacy.connections?.length ?? 0,
    groupCount: legacy.groups?.length ?? 0,
    sizeBytes: 0,
    nodes: legacy.nodes,
    connections: legacy.connections ?? [],
    groups: legacy.groups ?? [],
    viewport: { x: 0, y: 0, scale: 1 } as Viewport,
  }
  doc.sizeBytes = docSize(doc)
  await putDoc(doc)
  return doc
}

/* ---------------- 资产库 ---------------- */

export async function listAssets(): Promise<Asset[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly')
    const req = tx.objectStore(STORE_ASSETS).getAll()
    req.onsuccess = () => {
      const list = (req.result as Asset[]) || []
      resolve(list.sort((a, b) => b.createdAt - a.createdAt))
    }
    req.onerror = () => reject(req.error)
  })
}

export async function putAsset(asset: Asset): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite')
    tx.objectStore(STORE_ASSETS).put(asset)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// 删除资产记录的同时清理 blob，避免文件库泄漏
export async function deleteAsset(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ASSETS, STORE_FILES], 'readwrite')
    const req = tx.objectStore(STORE_ASSETS).get(id)
    req.onsuccess = () => {
      const asset = req.result as Asset | undefined
      if (!asset) return
      tx.objectStore(STORE_ASSETS).delete(id)
      if (asset.fileKey) tx.objectStore(STORE_FILES).delete(asset.fileKey)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function listAssetCategories(): Promise<AssetCategory[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSET_CATEGORIES, 'readonly')
    const req = tx.objectStore(STORE_ASSET_CATEGORIES).getAll()
    req.onsuccess = () => {
      const list = (req.result as AssetCategory[]) || []
      resolve(list.sort((a, b) => a.createdAt - b.createdAt))
    }
    req.onerror = () => reject(req.error)
  })
}

export async function putAssetCategory(category: AssetCategory): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSET_CATEGORIES, 'readwrite')
    tx.objectStore(STORE_ASSET_CATEGORIES).put(category)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// 删除分类时把其下资产改为未分类
export async function deleteAssetCategory(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ASSET_CATEGORIES, STORE_ASSETS], 'readwrite')
    tx.objectStore(STORE_ASSET_CATEGORIES).delete(id)
    const store = tx.objectStore(STORE_ASSETS)
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      const asset = cursor.value as Asset
      if (asset.categoryId === id) cursor.update({ ...asset, categoryId: undefined })
      cursor.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/* ---------------- 本地用户资料 ---------------- */

export async function getProfile(): Promise<UserProfile | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROFILE, 'readonly')
    const req = tx.objectStore(STORE_PROFILE).get(PROFILE_KEY)
    req.onsuccess = () => resolve((req.result as UserProfile) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function putProfile(profile: UserProfile): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROFILE, 'readwrite')
    tx.objectStore(STORE_PROFILE).put(profile, PROFILE_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
