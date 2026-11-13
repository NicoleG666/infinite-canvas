import { useEffect, useRef, useState } from 'react'
import Canvas from './components/Canvas'
import TopBar from './components/TopBar'
import Toolbar from './components/Toolbar'
import AssetPanel from './components/AssetPanel'
import ContextMenu from './components/ContextMenu'
import RightMenu from './components/RightMenu'
import { useCanvasStore } from './store/canvasStore'
import {
  DocConflictError,
  cleanupOrphanFiles,
  deleteDoc as purgeDoc,
  getAllDocs,
  getDoc,
  getFile,
  getProfile,
  getStorageEstimate,
  listDocMetas,
  listTrashMetas,
  migrateLegacyIfNeeded,
  purgeExpiredTrash,
  putDoc,
  putDocGuarded,
  putProfile,
  restoreDoc,
  trashDoc,
} from './utils/idb'
import {
  DOC_SCHEMA_VERSION,
  buildBackupBundle,
  mediaMissingCount,
  normalizeDoc,
  parseImportFile,
} from './utils/docIO'
import { createUserProfile } from './utils/profile'
import { buildDemoDoc, DEMO_DOC_NAME } from './utils/demoCanvas'
import { decodeShareToken, readShareTokenFromLocation } from './utils/share'
import type { CanvasDoc, CanvasDocMeta } from './types'

const newDocId = () => `doc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// 同一浏览器多标签页之间的文档变更通知
const CHANNEL_NAME = 'infinite-canvas-docs'

// 示例画布只播种一次：用户删掉后刷新不再重新出现
const DEMO_SEEDED_KEY = 'infinite-canvas-demo-seeded'

function demoAlreadySeeded(): boolean {
  try {
    return localStorage.getItem(DEMO_SEEDED_KEY) === '1'
  } catch {
    return false
  }
}

function markDemoSeeded() {
  try {
    localStorage.setItem(DEMO_SEEDED_KEY, '1')
  } catch {
    // 隐私模式下 localStorage 不可用，忽略即可
  }
}

type TrashMeta = CanvasDocMeta & { trashedAt: number }
type DocConflict = { docId: string; kind: 'changed' | 'deleted' }

// 存储错误 → 用户可读文案
function describeStorageError(e: unknown): string {
  const err = e as { name?: string; message?: string } | null
  const msg = err?.message ?? (e instanceof Error ? e.message : String(e))
  if (err?.name === 'QuotaExceededError' || msg.includes('quota')) {
    return '本地存储空间不足，请先导出备份，再清理回收站或删除不需要的媒体'
  }
  if (msg.includes('timeout')) return '浏览器未响应本地数据库（可能处于隐私模式）'
  if (msg.includes('blocked')) return '另一个标签页正占用数据库，请关闭后刷新'
  return msg || '未知错误'
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // 下载开始后再回收，避免部分浏览器取消下载
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function dateStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

export default function App() {
  const loadState = useCanvasStore((s) => s.loadState)
  const resetCanvas = useCanvasStore((s) => s.resetCanvas)
  const setDocId = useCanvasStore((s) => s.setDocId)
  const setDocMetas = useCanvasStore((s) => s.setDocMetas)
  const updateNode = useCanvasStore((s) => s.updateNode)
  const setProfile = useCanvasStore((s) => s.setProfile)

  const [loading, setLoading] = useState(true)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [trashMetas, setTrashMetas] = useState<TrashMeta[]>([])
  const [conflict, setConflict] = useState<DocConflict | null>(null)
  const assetPanelOpen = useCanvasStore((s) => s.assetPanelOpen)

  const metaRef = useRef({ createdAt: Date.now(), name: '未命名画布' })
  const initedRef = useRef(false)
  // 每个文档最后一次成功写入的版本号，用于乐观锁
  const revMapRef = useRef<Record<string, number>>({})
  // 是否有尚未落盘的改动
  const dirtyRef = useRef(false)
  // 待保存改动里是否含节点 / 连线 / 分组（而不只是视口）
  const pendingContentRef = useRef(false)
  // 当前文档是否处于冲突暂停状态
  const conflictRef = useRef<DocConflict | null>(null)
  // 已彻底删除 / 移入回收站的文档，阻止残留的自动保存把内容写回
  const suppressedRef = useRef<Set<string>>(new Set())
  // 最近一次保存是否失败（用于关闭页面前的提醒）
  const saveFailedRef = useRef(false)
  // 正在装载文档（恢复媒体 URL），期间不触发自动保存
  const restoringRef = useRef(false)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const persistRef = useRef<((id?: string) => Promise<boolean>) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 由当前 store 状态构建完整文档
  const buildDoc = (id: string): CanvasDoc => {
    const { nodes, connections, groups, viewport } = useCanvasStore.getState()
    return {
      id,
      name: metaRef.current.name,
      createdAt: metaRef.current.createdAt,
      updatedAt: Date.now(),
      nodeCount: Object.keys(nodes).length,
      connectionCount: Object.keys(connections).length,
      groupCount: Object.keys(groups).length,
      sizeBytes: 0,
      schemaVersion: DOC_SCHEMA_VERSION,
      nodes: Object.values(nodes).map((n) => ({
        ...n,
        // 运行时 objectURL 不可持久化，仅保留 fileKey，加载时重新生成
        url: n.fileKey ? undefined : n.url,
      })),
      connections: Object.values(connections),
      groups: Object.values(groups),
      viewport,
    }
  }

  // 释放当前画布占用的媒体 objectURL（切换 / 新建文档时调用），避免内存持续增长
  const revokeMediaUrls = () => {
    Object.values(useCanvasStore.getState().nodes).forEach((n) => {
      if (n.url?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(n.url)
        } catch {
          // 忽略单个 URL 的回收失败
        }
      }
    })
  }

  const broadcast = (msg: Record<string, unknown>) => {
    try {
      channelRef.current?.postMessage(msg)
    } catch {
      // 通道不可用时忽略，乐观锁仍然能兜住冲突
    }
  }

  // 重新读取画布列表与回收站
  const refreshDocs = async (): Promise<CanvasDocMeta[]> => {
    try {
      const [metas, trash] = await Promise.all([listDocMetas(), listTrashMetas()])
      setDocMetas(metas)
      setTrashMetas(trash)
      return metas
    } catch (e) {
      setStorageError(describeStorageError(e))
      return useCanvasStore.getState().docMetas
    }
  }

  // 立即落盘当前文档；带版本校验，冲突时暂停保存而不是覆盖
  const persist = async (id?: string): Promise<boolean> => {
    const state = useCanvasStore.getState()
    const target = id ?? state.docId
    if (!target) return false
    if (suppressedRef.current.has(target)) return false
    if (conflictRef.current?.docId === target) return false

    const isCurrent = target === state.docId
    const expected = isCurrent ? revMapRef.current[target] ?? 0 : revMapRef.current[target]
    const doc = buildDoc(target)
    const hasContent = pendingContentRef.current

    try {
      const rev = await putDocGuarded(doc, expected)
      revMapRef.current[target] = rev
      broadcast({ type: 'doc-saved', docId: target, rev, content: hasContent })
      if (isCurrent) {
        dirtyRef.current = false
        pendingContentRef.current = false
        saveFailedRef.current = false
      }
      setStorageError(null)
      await refreshDocs()
      return true
    } catch (e) {
      if (e instanceof DocConflictError) {
        if (isCurrent) {
          conflictRef.current = { docId: target, kind: 'changed' }
          setConflict({ docId: target, kind: 'changed' })
        } else {
          setToast('另一个标签页已更新该画布，切换前的改动未写入')
        }
        return false
      }
      saveFailedRef.current = true
      setStorageError(describeStorageError(e))
      // 内存兜底：把当前文档计入列表，避免侧边栏出现空列表
      const meta = {
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        nodeCount: doc.nodeCount,
        connectionCount: doc.connectionCount,
        groupCount: doc.groupCount,
        sizeBytes: new Blob([JSON.stringify(doc)]).size,
      }
      const others = useCanvasStore.getState().docMetas.filter((m) => m.id !== doc.id)
      setDocMetas([meta, ...others])
      return false
    }
  }
  persistRef.current = persist

  // 把文档内容装载进 store，并恢复媒体 blob 的 objectURL
  const applyDoc = async (doc: CanvasDoc) => {
    restoringRef.current = true
    revokeMediaUrls()
    metaRef.current = { createdAt: doc.createdAt, name: doc.name }
    setDocId(doc.id)
    revMapRef.current[doc.id] = doc.rev ?? 0
    conflictRef.current = null
    setConflict(null)
    loadState({
      nodes: doc.nodes ?? [],
      connections: doc.connections ?? [],
      groups: doc.groups ?? [],
      viewport: doc.viewport,
    })
    for (const n of doc.nodes ?? []) {
      if (n.fileKey) {
        const blob = await getFile(n.fileKey).catch(() => null)
        if (blob) {
          updateNode(n.id, {
            url: URL.createObjectURL(blob),
            // 旧音频节点没有 fileName，从存档的 File 对象里补回文件名
            ...(n.type === 'audio' && !n.fileName && blob instanceof File
              ? { fileName: blob.name }
              : {}),
          })
        }
      }
    }
    // 装载过程会触发 store 订阅，这里明确清掉脏标记
    restoringRef.current = false
    dirtyRef.current = false
    pendingContentRef.current = false
  }

  // 打开文档
  const openDoc = async (id: string): Promise<boolean> => {
    const current = useCanvasStore.getState().docId
    if (current === id) return true
    if (current) await persist(current)
    if (suppressedRef.current.has(id)) return false

    let doc: CanvasDoc | null = null
    try {
      const raw = await getDoc(id)
      doc = raw ? normalizeDoc(raw) : null
      if (doc?.trashedAt) doc = null
    } catch (e) {
      setStorageError(describeStorageError(e))
      return false
    }
    if (!doc) return false
    await applyDoc(doc)
    return true
  }

  // 新建文档
  const createDoc = async () => {
    const current = useCanvasStore.getState().docId
    if (current) await persist(current)
    const id = newDocId()
    metaRef.current = {
      createdAt: Date.now(),
      name: `未命名画布 ${useCanvasStore.getState().docMetas.length + 1}`,
    }
    setDocId(id)
    revMapRef.current[id] = 0
    conflictRef.current = null
    setConflict(null)
    revokeMediaUrls()
    resetCanvas()
    dirtyRef.current = true
    pendingContentRef.current = true
    await persist(id)
  }

  // 首次打开：创建「示例画布」，让访客一进来就能看到功能
  const createDemoDoc = async () => {
    const id = newDocId()
    let doc: CanvasDoc | null = null
    try {
      doc = await buildDemoDoc(id)
    } catch {
      doc = null
    }
    if (!doc) {
      await createDoc()
      return
    }
    try {
      const rev = await putDoc(doc)
      await applyDoc({ ...doc, rev })
      markDemoSeeded()
    } catch (e) {
      setStorageError(describeStorageError(e))
      await createDoc()
    }
  }

  // 删除文档：先移入回收站，可恢复
  const removeDoc = async (id: string) => {
    // 先落盘一次，保证回收站里的是最新内容
    if (id === useCanvasStore.getState().docId) await persist(id)
    suppressedRef.current.add(id)
    if (conflictRef.current?.docId === id) {
      conflictRef.current = null
      setConflict(null)
    }
    try {
      await trashDoc(id)
      broadcast({ type: 'doc-deleted', docId: id })
    } catch (e) {
      setStorageError(describeStorageError(e))
      suppressedRef.current.delete(id)
      return
    }
    const metas = await refreshDocs()
    if (id !== useCanvasStore.getState().docId) {
      setToast('画布已移入回收站，可在画布菜单中恢复')
      return
    }
    dirtyRef.current = false
    pendingContentRef.current = false
    delete revMapRef.current[id]
    if (metas.length > 0) {
      useCanvasStore.setState({ docId: null })
      const ok = await openDoc(metas[0].id)
      if (!ok) await createDoc()
    } else {
      await createDoc()
    }
    setToast('画布已移入回收站，可在画布菜单中恢复')
  }

  // 从回收站恢复
  const restoreDocAction = async (id: string) => {
    suppressedRef.current.delete(id)
    try {
      await restoreDoc(id)
      await refreshDocs()
      setToast('画布已从回收站恢复')
    } catch (e) {
      setStorageError(describeStorageError(e))
    }
  }

  // 彻底删除（不可恢复）
  const purgeDocAction = async (id: string) => {
    suppressedRef.current.add(id)
    try {
      await purgeDoc(id)
      delete revMapRef.current[id]
      // 清理由此变成孤儿的媒体文件
      await cleanupOrphanFiles().catch(() => 0)
      await refreshDocs()
      setToast('画布已彻底删除')
    } catch (e) {
      setStorageError(describeStorageError(e))
    }
  }

  // 重命名
  const renameDoc = async (id: string, name: string) => {
    if (id === useCanvasStore.getState().docId) metaRef.current.name = name
    setDocMetas(
      useCanvasStore.getState().docMetas.map((m) => (m.id === id ? { ...m, name } : m)),
    )
    try {
      const doc = await getDoc(id)
      if (!doc) return
      // 用读到的版本做乐观锁，避免重命名把别处的新内容覆盖掉
      const rev = await putDocGuarded({ ...doc, name, updatedAt: Date.now() }, doc.rev ?? 0)
      revMapRef.current[id] = rev
      broadcast({ type: 'doc-saved', docId: id, rev, content: false })
      await refreshDocs()
    } catch (e) {
      if (e instanceof DocConflictError) {
        setToast('该画布已在另一个标签页更新，重命名未保存')
      } else {
        setStorageError(describeStorageError(e))
      }
      await refreshDocs()
    }
  }

  // 导出当前画布为 JSON 文件
  const exportDoc = () => {
    const id = useCanvasStore.getState().docId
    if (!id) return
    const doc = buildDoc(id)
    downloadJson(`${doc.name || 'canvas'}.json`, doc)
    setToast('已导出当前画布的 JSON 备份')
  }

  // 导出全部画布（不含媒体文件）
  const exportAllDocs = async () => {
    try {
      const docs = (await getAllDocs()).filter((d) => !d.trashedAt)
      if (docs.length === 0) {
        setToast('还没有可导出的画布')
        return
      }
      const normalized = docs.map((d) => normalizeDoc(d) ?? d)
      downloadJson(`无限画布备份-${dateStamp()}.json`, buildBackupBundle(normalized))
      const missing = normalized.reduce((sum, d) => sum + mediaMissingCount(d), 0)
      setToast(
        `已导出 ${docs.length} 个画布${missing > 0 ? '；JSON 不含媒体文件，图片/视频需重新上传' : ''}`,
      )
    } catch (e) {
      setToast(`导出失败：${describeStorageError(e)}`)
    }
  }

  // 复制当前画布数据到剪贴板
  const copyDoc = async (): Promise<boolean> => {
    const id = useCanvasStore.getState().docId
    if (!id) return false
    const doc = buildDoc(id)
    try {
      await navigator.clipboard.writeText(JSON.stringify(doc))
      return true
    } catch {
      return false
    }
  }

  // 从 JSON 文件导入画布
  const importFromFile = async (file: File) => {
    let text = ''
    try {
      text = await file.text()
    } catch {
      setToast('读取文件失败，请重试')
      return
    }

    let parsed: ReturnType<typeof parseImportFile>
    try {
      parsed = parseImportFile(text)
    } catch (e) {
      setToast(`导入失败：${e instanceof Error ? e.message : '文件格式不正确'}`)
      return
    }

    const current = useCanvasStore.getState().docId
    if (current) await persist(current)

    const imported: CanvasDoc[] = []
    try {
      for (const doc of parsed.docs) {
        const existing = await getDoc(doc.id)
        let target: CanvasDoc = { ...doc, trashedAt: undefined }

        if (existing) {
          const overwrite = confirm(
            `画布「${existing.name}」已存在。\n\n确定：用导入内容覆盖（覆盖前自动保留旧版本为副本）\n取消：导入为一份新副本`,
          )
          if (overwrite) {
            const backup: CanvasDoc = {
              ...(normalizeDoc(existing) ?? existing),
              id: newDocId(),
              name: `${existing.name}（覆盖前备份）`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              trashedAt: undefined,
            }
            await putDoc({ ...backup, rev: undefined })
          } else {
            target = {
              ...doc,
              id: newDocId(),
              name: `${doc.name}（导入）`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              trashedAt: undefined,
            }
          }
        }

        const rev = await putDoc({ ...target, rev: undefined })
        revMapRef.current[target.id] = rev
        imported.push({ ...target, rev })
      }
    } catch (e) {
      setStorageError(describeStorageError(e))
      setToast(`导入中断：${describeStorageError(e)}`)
      await refreshDocs()
      return
    }

    await refreshDocs()
    if (imported.length > 0) await applyDoc(imported[0])

    const missing = imported.reduce((sum, d) => sum + mediaMissingCount(d), 0)
    setToast(
      `已导入 ${imported.length} 个画布${
        parsed.skipped > 0 ? `，跳过 ${parsed.skipped} 个无法识别的条目` : ''
      }${missing > 0 ? `；${missing} 个媒体文件需重新上传` : ''}`,
    )
  }

  // 冲突处理：加载另一个标签页的最新版本（丢弃本地未保存改动）
  const resolveConflictReload = async () => {
    const c = conflictRef.current
    if (!c) return
    const confirmText =
      c.kind === 'deleted'
        ? '当前未保存的改动会被丢弃，返回画布列表？'
        : '当前未保存的改动会被丢弃，加载另一个标签页的最新版本？'
    if (dirtyRef.current && !confirm(confirmText)) return
    conflictRef.current = null
    setConflict(null)
    dirtyRef.current = false
    pendingContentRef.current = false

    let doc: CanvasDoc | null = null
    try {
      const raw = await getDoc(c.docId)
      doc = raw ? normalizeDoc(raw) : null
    } catch {
      doc = null
    }

    if (!doc || doc.trashedAt) {
      const metas = await refreshDocs()
      setToast('该画布已在另一个标签页被删除')
      useCanvasStore.setState({ docId: null })
      if (metas.length > 0) {
        const ok = await openDoc(metas[0].id)
        if (!ok) await createDoc()
      } else {
        await createDoc()
      }
      return
    }

    await applyDoc(doc)
    setToast('已加载另一个标签页的最新版本')
  }

  // 冲突处理：把当前内容另存为新画布，原画布保留对方版本
  const saveAsCopy = async () => {
    const state = useCanvasStore.getState()
    if (!state.docId) return
    const copyId = newDocId()
    const copyName = `${metaRef.current.name}（副本）`
    conflictRef.current = null
    setConflict(null)
    metaRef.current = { createdAt: Date.now(), name: copyName }
    setDocId(copyId)
    revMapRef.current[copyId] = 0
    dirtyRef.current = true
    pendingContentRef.current = true
    const ok = await persist(copyId)
    setToast(ok ? `已另存为「${copyName}」` : '另存为副本失败，请重试')
  }

  // 启动：迁移旧数据 → 清理回收站 / 孤儿文件 → 打开最近文档 → 无则新建
  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true
    ;(async () => {
      try {
        await migrateLegacyIfNeeded().catch(() => null)
        // 回收站保留 30 天，启动时清理过期项；孤儿媒体后台清理
        await purgeExpiredTrash(30).catch(() => [])
        void cleanupOrphanFiles().catch(() => 0)
        // 本地用户资料：首次启动生成，之后复用
        const stored = await getProfile().catch(() => null)
        const profile = stored ?? createUserProfile()
        if (!stored) await putProfile(profile).catch(() => {})
        setProfile(profile)
        const metas = await refreshDocs()

        // 存储配额提示：快满时提前告知，而不是等写入失败
        const estimate = await getStorageEstimate()
        if (estimate && estimate.ratio >= 0.9) {
          setStorageWarning(
            `本地存储已使用 ${Math.round(estimate.ratio * 100)}%（${fmtBytes(estimate.usage)} / ${fmtBytes(
              estimate.quota,
            )}），建议导出备份并清理回收站`,
          )
        }

        // 分享链接：解码后导入为新画布，并清掉地址栏 hash
        const token = readShareTokenFromLocation()
        if (token) {
          const shared = await decodeShareToken(token)
          if (shared) {
            const id = newDocId()
            metaRef.current = { createdAt: Date.now(), name: shared.name || '分享的画布' }
            setDocId(id)
            revMapRef.current[id] = 0
            loadState({
              nodes: shared.nodes,
              connections: shared.connections,
              groups: shared.groups,
              viewport: shared.viewport,
            })
            await persist(id)
            window.history.replaceState(null, '', window.location.pathname + window.location.search)
            setToast(
              shared.mediaCount > 0
                ? `已导入分享的画布「${metaRef.current.name}」，其中 ${shared.mediaCount} 个媒体文件未随链接传输。`
                : `已导入分享的画布「${metaRef.current.name}」。`,
            )
            return
          }
          setToast('分享链接已损坏或不完整，已打开本地画布')
        }

        // ?demo=1：从介绍页进入时直接打开示例画布（已有则复用）
        if (new URLSearchParams(window.location.search).get('demo') === '1') {
          const existing = metas.find((m) => m.name === DEMO_DOC_NAME)
          if (existing) {
            useCanvasStore.setState({ docId: null })
            await openDoc(existing.id)
          } else {
            await createDemoDoc()
          }
          window.history.replaceState(null, '', window.location.pathname + window.location.hash)
          return
        }

        if (metas.length > 0) {
          useCanvasStore.setState({ docId: null })
          const ok = await openDoc(metas[0].id)
          if (!ok) await createDoc()
        } else if (!demoAlreadySeeded()) {
          await createDemoDoc()
        } else {
          await createDoc()
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // 自动保存：仅当画布数据引用变化时触发，避免元数据更新引起循环
  useEffect(() => {
    let timer: number | undefined
    let prev = useCanvasStore.getState()

    const unsub = useCanvasStore.subscribe((state) => {
      if (!initedRef.current) return
      const contentChanged =
        state.nodes !== prev.nodes ||
        state.connections !== prev.connections ||
        state.groups !== prev.groups
      const viewportChanged = state.viewport !== prev.viewport
      prev = state
      if (!contentChanged && !viewportChanged) return

      dirtyRef.current = true
      if (contentChanged) pendingContentRef.current = true

      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const id = useCanvasStore.getState().docId
        if (!id || !dirtyRef.current || restoringRef.current) return
        if (conflictRef.current?.docId === id) return
        if (suppressedRef.current.has(id)) return
        void persistRef.current?.(id)
      }, 700)
    })

    return () => {
      unsub()
      window.clearTimeout(timer)
    }
  }, [])

  // 关闭 / 切走页面前强制落盘，避免丢掉最后不到 1 秒的修改
  useEffect(() => {
    const flush = () => {
      const id = useCanvasStore.getState().docId
      if (!id || !dirtyRef.current || restoringRef.current) return
      if (conflictRef.current?.docId === id) return
      if (suppressedRef.current.has(id)) return
      void persistRef.current?.(id)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // 保存失败或存在冲突时，明确提醒用户不要直接关闭
      if (dirtyRef.current && (conflictRef.current || saveFailedRef.current)) {
        e.preventDefault()
        e.returnValue = ''
      }
      flush()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  // 多标签页变更通知：本页没有未保存改动时自动跟随，有改动时提示冲突
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = channel

    channel.onmessage = (event: MessageEvent) => {
      const msg = event.data as { type?: string; docId?: string; rev?: number; content?: boolean }
      const currentId = useCanvasStore.getState().docId
      if (!msg?.docId || msg.docId !== currentId) return

      if (msg.type === 'doc-deleted') {
        conflictRef.current = { docId: msg.docId, kind: 'deleted' }
        setConflict({ docId: msg.docId, kind: 'deleted' })
        return
      }

      if (msg.type !== 'doc-saved') return
      const localRev = revMapRef.current[msg.docId] ?? 0
      if ((msg.rev ?? 0) <= localRev) return

      // 只是视口变化：不重载画布，直接跟上版本号即可
      if (msg.content === false) {
        revMapRef.current[msg.docId] = msg.rev ?? localRev
        return
      }

      if (!dirtyRef.current) {
        void (async () => {
          const raw = await getDoc(msg.docId as string).catch(() => null)
          const doc = raw ? normalizeDoc(raw) : null
          if (doc && !doc.trashedAt && useCanvasStore.getState().docId === doc.id) {
            await applyDoc(doc)
            setToast('已同步另一个标签页的修改')
          }
        })()
        return
      }

      conflictRef.current = { docId: msg.docId, kind: 'changed' }
      setConflict({ docId: msg.docId, kind: 'changed' })
    }

    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [])

  // 用户资料变更后落盘（本地资料，失败不影响画布使用）
  useEffect(() => {
    const unsub = useCanvasStore.subscribe((state, prev) => {
      if (state.profile && state.profile !== prev.profile) {
        putProfile(state.profile).catch(() => {})
      }
    })
    return unsub
  }, [])

  // 提示 9 秒后自动消失
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 9000)
    return () => window.clearTimeout(timer)
  }, [toast])

  return (
    <>
      <Canvas loading={loading} />
      <TopBar
        loading={loading}
        storageError={storageError}
        storageWarning={storageWarning}
        onNew={createDoc}
        onOpen={openDoc}
        onDelete={removeDoc}
        onRename={renameDoc}
        onExport={exportDoc}
        onExportAll={exportAllDocs}
        onImport={() => fileInputRef.current?.click()}
        onCopy={copyDoc}
        trashMetas={trashMetas}
        onRestore={restoreDocAction}
        onPurge={purgeDocAction}
      />
      <Toolbar />
      {assetPanelOpen && <AssetPanel onOpenDoc={openDoc} onNewDoc={createDoc} />}
      <ContextMenu />
      <RightMenu />

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.currentTarget.value = ''
          if (file) void importFromFile(file)
        }}
      />

      {conflict && (
        <div className="doc-conflict" role="alert">
          <div className="doc-conflict-text">
            <strong>
              {conflict.kind === 'deleted'
                ? '该画布已在另一个标签页被删除'
                : '该画布已在另一个标签页被修改'}
            </strong>
            <span>
              {conflict.kind === 'deleted'
                ? '当前内容可以另存为副本，或返回画布列表。'
                : '为避免覆盖，自动保存已暂停。请加载最新版本，或把当前内容另存为副本。'}
            </span>
          </div>
          <div className="doc-conflict-actions">
            <button className="doc-conflict-primary" onClick={resolveConflictReload}>
              {conflict.kind === 'deleted' ? '返回画布列表' : '加载最新版本'}
            </button>
            <button onClick={saveAsCopy}>另存为副本</button>
          </div>
        </div>
      )}

      {toast && (
        <div className="share-toast">
          <span>{toast}</span>
          <button onClick={() => setToast(null)}>知道了</button>
        </div>
      )}
    </>
  )
}
