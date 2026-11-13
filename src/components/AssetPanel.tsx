import { useEffect, useRef, useState } from 'react'
import type { Asset, AssetCategory, AssetType, CanvasNode, NodeType } from '../types'
import { useCanvasStore } from '../store/canvasStore'
import {
  deleteAsset,
  deleteAssetCategory,
  getFile,
  listAssetCategories,
  listAssets,
  putAsset,
  putAssetCategory,
  saveFile,
} from '../utils/idb'
import { AudioIcon, ImageIcon, LinkIcon, TextIcon, VideoIcon } from './NodeTypeIcons'

interface Props {
  onOpenDoc: (id: string) => void
  onNewDoc: () => void
}

const PANEL_W = 360

const NODE_LABEL: Record<NodeType, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  link: '链接',
  code: '代码',
}

const ASSET_LABEL: Record<AssetType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  file: '文件',
}

function fmtSize(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function assetTypeOf(mime: string): AssetType {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 资产管理抽屉：左侧全高面板。
 * 「画布」页列出当前画布内的节点，「资产」页是笔记级素材库（上传 / 分类 / 管理）。
 */
export default function AssetPanel({ onOpenDoc, onNewDoc }: Props) {
  const nodes = useCanvasStore((s) => s.nodes)
  const docId = useCanvasStore((s) => s.docId)
  const docMetas = useCanvasStore((s) => s.docMetas)
  const setSelected = useCanvasStore((s) => s.setSelected)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const toggleAssetPanel = useCanvasStore((s) => s.toggleAssetPanel)

  const [tab, setTab] = useState<'canvas' | 'assets'>('canvas')
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<NodeType | 'all'>('all')
  const [assets, setAssets] = useState<Asset[]>([])
  const [categories, setCategories] = useState<AssetCategory[]>([])
  const [catFilter, setCatFilter] = useState<string | 'all'>('all')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [manage, setManage] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [canvasMenu, setCanvasMenu] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const docName = docMetas.find((m) => m.id === docId)?.name ?? '未命名画布'

  const refresh = async () => {
    const [a, c] = await Promise.all([listAssets(), listAssetCategories()])
    setAssets(a)
    setCategories(c)
  }

  useEffect(() => {
    ;(async () => {
      await refresh().catch(() => {})
      setLoadingAssets(false)
    })()
  }, [])

  // 图片资产缩略图：从 IndexedDB 读 blob 生成 objectURL
  useEffect(() => {
    let cancelled = false
    const created: string[] = []
    ;(async () => {
      const next: Record<string, string> = {}
      for (const a of assets) {
        if (a.type !== 'image') continue
        const blob = await getFile(a.fileKey).catch(() => null)
        if (!blob) continue
        const url = URL.createObjectURL(blob)
        created.push(url)
        next[a.id] = url
      }
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u))
        return
      }
      setThumbs(next)
    })()
    return () => {
      cancelled = true
      created.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [assets])

  // 画布节点列表：优先使用节点名称（默认「图片1」这类，可双击编辑）
  const orderedNodes = Object.values(nodes).sort((a, b) => a.createdAt - b.createdAt)
  const typeCounts: Record<string, number> = {}
  const namedNodes = orderedNodes.map((node) => {
    typeCounts[node.type] = (typeCounts[node.type] || 0) + 1
    return {
      node,
      name: node.name || `${NODE_LABEL[node.type]}${typeCounts[node.type]}`,
      label: NODE_LABEL[node.type],
    }
  })

  const q = query.trim().toLowerCase()
  const filteredNodes = namedNodes.filter(({ node, name, label }) => {
    if (typeFilter !== 'all' && node.type !== typeFilter) return false
    if (!q) return true
    return name.toLowerCase().includes(q) || label.toLowerCase().includes(q) ||
      (node.text || '').toLowerCase().includes(q) || (node.linkUrl || '').toLowerCase().includes(q)
  })

  const filteredAssets = assets.filter((a) => {
    if (catFilter !== 'all' && a.categoryId !== catFilter) return false
    if (!q) return true
    return a.name.toLowerCase().includes(q) || ASSET_LABEL[a.type].includes(q)
  })

  const catName = (id?: string) => categories.find((c) => c.id === id)?.name ?? '未分类'

  // 点击画布节点：选中并把视口中心对准「面板右侧的可视区域」
  const focusNode = (node: CanvasNode) => {
    const scale = useCanvasStore.getState().viewport.scale
    const cx = (PANEL_W + window.innerWidth) / 2
    const cy = window.innerHeight / 2
    setSelected([node.id])
    setViewport({
      x: cx - (node.x + node.width / 2) * scale,
      y: cy - (node.y + node.height / 2) * scale,
    })
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    const list = Array.from(files)
    const cats = categories.length ? categories : await listAssetCategories().catch(() => [])
    for (const file of list) {
      const type = assetTypeOf(file.type || '')
      const fileKey = await saveFile(file).catch(() => null)
      if (!fileKey) continue
      const cat = cats.find((c) => c.kind === type)
      await putAsset({
        id: uid('asset'),
        name: file.name || `${ASSET_LABEL[type]}素材`,
        type,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        fileKey,
        categoryId: cat?.id,
        createdAt: Date.now(),
      })
    }
    await refresh()
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const createDefaultCategories = async () => {
    const defaults: { name: string; kind: AssetType }[] = [
      { name: '图片', kind: 'image' },
      { name: '视频', kind: 'video' },
      { name: '音频', kind: 'audio' },
      { name: '文件', kind: 'file' },
    ]
    const now = Date.now()
    const created: AssetCategory[] = []
    for (const d of defaults) {
      if (categories.some((c) => c.kind === d.kind)) continue
      const cat: AssetCategory = { id: uid('cat'), name: d.name, kind: d.kind, createdAt: now }
      await putAssetCategory(cat)
      created.push(cat)
    }
    // 顺手把未分类资产按类型归入新分类
    if (created.length > 0) {
      for (const a of assets) {
        if (a.categoryId) continue
        const cat = created.find((c) => c.kind === a.type)
        if (cat) await putAsset({ ...a, categoryId: cat.id })
      }
    }
    await refresh()
  }

  const createCategory = async () => {
    const name = newCatName.trim()
    if (!name) return
    await putAssetCategory({ id: uid('cat'), name, createdAt: Date.now() })
    setNewCatName('')
    await refresh()
  }

  const removeCategory = async (id: string) => {
    await deleteAssetCategory(id)
    if (catFilter === id) setCatFilter('all')
    await refresh()
  }

  const removeAsset = async (id: string) => {
    if (!confirm('删除该资产？此操作不可撤销。')) return
    await deleteAsset(id)
    await refresh()
  }

  const assignCategory = async (asset: Asset, categoryId: string) => {
    await putAsset({ ...asset, categoryId: categoryId || undefined })
    await refresh()
  }

  return (
    <aside className="asset-panel">
      <div className="asset-head">
        <div className="asset-head-top">
          <span className="brand-mark asset-brand" aria-hidden="true">
            <img className="brand-mark-img" src="/logo-infinity.png" alt="" draggable={false} />
          </span>
          <button className="asset-head-close" title="收起资产面板" onClick={toggleAssetPanel}>
            <CloseIcon />
          </button>
        </div>

        <div className="asset-project">
          <span className="asset-note">我的工作区</span>
          <span className="asset-note-sep">|</span>
          <button
            className="asset-canvas-btn"
            title="切换画布"
            onClick={() => setCanvasMenu((v) => !v)}
          >
            {docName}
            <ChevronIcon />
          </button>

          {canvasMenu && (
            <>
              <div className="asset-canvas-backdrop" onMouseDown={() => setCanvasMenu(false)} />
              <div className="asset-canvas-menu" onMouseDown={(e) => e.stopPropagation()}>
                <div className="asset-canvas-menu-title">画布</div>
                {docMetas.map((m) => (
                  <button
                    key={m.id}
                    className={`asset-canvas-item ${m.id === docId ? 'active' : ''}`}
                    onClick={() => {
                      if (m.id !== docId) onOpenDoc(m.id)
                      setCanvasMenu(false)
                    }}
                  >
                    <span className="asset-canvas-item-name">{m.name}</span>
                    <span className="asset-canvas-item-meta">{m.nodeCount} 节点</span>
                  </button>
                ))}
                <button
                  className="asset-canvas-new"
                  onClick={() => {
                    onNewDoc()
                    setCanvasMenu(false)
                  }}
                >
                  <PlusIcon />
                  新建画布
                </button>
              </div>
            </>
          )}
        </div>

        <div className="asset-tabs">
          <button
            className={`asset-tab ${tab === 'canvas' ? 'active' : ''}`}
            onClick={() => {
              setTab('canvas')
              setCanvasMenu(false)
            }}
          >
            画布
          </button>
          <button
            className={`asset-tab ${tab === 'assets' ? 'active' : ''}`}
            onClick={() => {
              setTab('assets')
              setCanvasMenu(false)
            }}
          >
            资产
          </button>
        </div>
      </div>

      <div className="asset-toolbar">
        <div className="asset-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'canvas' ? '搜索画布节点' : '搜索资产'}
          />
        </div>

        {tab === 'canvas' ? (
          <select
            className="asset-select"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as NodeType | 'all')}
            title="按类型筛选"
          >
            <option value="all">所有类型</option>
            <option value="text">文本</option>
            <option value="image">图片</option>
            <option value="video">视频</option>
            <option value="audio">音频</option>
            <option value="link">链接</option>
            <option value="code">代码</option>
          </select>
        ) : (
          <>
            <button className="asset-icon-btn" title="上传资产" onClick={() => fileInputRef.current?.click()}>
              <PlusIcon />
            </button>
            <button
              className={`asset-manage ${manage ? 'active' : ''}`}
              onClick={() => setManage((v) => !v)}
            >
              <FolderIcon />
              管理
            </button>
          </>
        )}
      </div>

      {tab === 'assets' && categories.length > 0 && (
        <div className="asset-cats">
          <button
            className={`asset-cat ${catFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCatFilter('all')}
          >
            全部
            <span className="asset-cat-count">{assets.length}</span>
          </button>
          {categories.map((c) => {
            const count = assets.filter((a) => a.categoryId === c.id).length
            return (
              <button
                key={c.id}
                className={`asset-cat ${catFilter === c.id ? 'active' : ''}`}
                onClick={() => setCatFilter(c.id)}
              >
                {c.name}
                <span className="asset-cat-count">{count}</span>
                {manage && (
                  <span
                    className="asset-cat-del"
                    title="删除分类"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeCategory(c.id)
                    }}
                  >
                    ×
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {tab === 'assets' && manage && (
        <div className="asset-newcat">
          <input
            value={newCatName}
            placeholder="新分类名称"
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createCategory()
            }}
          />
          <button onClick={createCategory}>创建分类</button>
        </div>
      )}

      <div className="asset-body">
        {tab === 'canvas' ? (
          <>
            {namedNodes.length === 0 && (
              <div className="asset-empty">
                <FolderIcon big />
                <div className="asset-empty-title">画布暂无节点</div>
                <div className="asset-empty-desc">在画布中添加节点后，这里会同步显示</div>
              </div>
            )}
            {namedNodes.length > 0 && filteredNodes.length === 0 && (
              <div className="asset-empty">
                <div className="asset-empty-title">没有匹配的节点</div>
                <div className="asset-empty-desc">换个关键词或类型试试</div>
              </div>
            )}
            {filteredNodes.map(({ node, name, label }) => (
              <button
                key={node.id}
                className="asset-row"
                onClick={() => focusNode(node)}
                title="在画布中定位该节点"
              >
                <span className="asset-thumb">
                  {node.type === 'image' && node.url ? (
                    <img src={node.url} alt="" />
                  ) : (
                    <NodeTypeIcon type={node.type} />
                  )}
                </span>
                <span className="asset-row-main">
                  <span className="asset-row-name">{name}</span>
                  <span className="asset-row-meta">
                    {label} · {Math.round(node.width)}×{Math.round(node.height)}
                  </span>
                </span>
              </button>
            ))}
          </>
        ) : (
          <>
            {loadingAssets && <div className="asset-empty-desc">正在加载资产…</div>}

            {!loadingAssets && assets.length === 0 && (
              <div className="asset-empty">
                <FolderIcon big />
                <div className="asset-empty-title">暂无资产</div>
                {categories.length === 0 && (
                  <button className="asset-empty-primary" onClick={createDefaultCategories}>
                    创建默认资产分类
                  </button>
                )}
                <button
                  className="asset-empty-secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? '上传中…' : '上传资产'}
                </button>
              </div>
            )}

            {!loadingAssets && assets.length > 0 && filteredAssets.length === 0 && (
              <div className="asset-empty">
                <div className="asset-empty-title">没有匹配的资产</div>
                <div className="asset-empty-desc">换个关键词或分类试试</div>
              </div>
            )}

            {filteredAssets.map((a) => (
              <div key={a.id} className="asset-row is-static">
                <span className="asset-thumb">
                  {a.type === 'image' && thumbs[a.id] ? (
                    <img src={thumbs[a.id]} alt="" />
                  ) : (
                    <AssetTypeIcon type={a.type} />
                  )}
                </span>
                <span className="asset-row-main">
                  <span className="asset-row-name" title={a.name}>
                    {a.name}
                  </span>
                  <span className="asset-row-meta">
                    {ASSET_LABEL[a.type]} · {fmtSize(a.size)}
                    {categories.length > 0 ? ` · ${catName(a.categoryId)}` : ''}
                  </span>
                </span>
                {manage && categories.length > 0 && (
                  <select
                    className="asset-row-cat"
                    title="移动到分类"
                    value={a.categoryId ?? ''}
                    onChange={(e) => assignCategory(a, e.target.value)}
                  >
                    <option value="">未分类</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
                {manage && (
                  <button className="asset-row-del" title="删除资产" onClick={() => removeAsset(a.id)}>
                    <TrashIcon />
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="asset-foot">
        <button className="asset-back" title="收起资产面板" onClick={toggleAssetPanel}>
          <BackIcon />
        </button>
        <span className="asset-foot-count">
          {tab === 'canvas' ? `共 ${filteredNodes.length} 节点` : `共 ${filteredAssets.length} 资产`}
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          uploadFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </aside>
  )
}

/* ---------------- 图标 ---------------- */

function NodeTypeIcon({ type }: { type: NodeType }) {
  if (type === 'image') return <ImageIcon />
  if (type === 'video') return <VideoIcon />
  if (type === 'audio') return <AudioIcon />
  if (type === 'link') return <LinkIcon />
  return <TextIcon />
}

function AssetTypeIcon({ type }: { type: AssetType }) {
  if (type === 'image') return <ImageIcon />
  if (type === 'video') return <VideoIcon />
  if (type === 'audio') return <AudioIcon />
  return <FileIcon />
}

const i = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none' } as const
const s = { stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function SearchIcon() {
  return (
    <svg {...i}>
      <circle cx="6.2" cy="6.2" r="3.9" {...s} />
      <path d="M9.2 9.2l2.5 2.5" {...s} />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg {...i}>
      <path d="M7 2.2v9.6M2.2 7h9.6" {...s} />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
      <path d="M2 3.6 5 6.6l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg {...i}>
      <path d="M3.2 3.2l7.6 7.6M10.8 3.2 3.2 10.8" {...s} />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg {...i}>
      <path d="M10.8 7H3.2M6.4 3.8 3.2 7l3.2 3.2" {...s} />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg {...i}>
      <path d="M2.6 3.8h8.8M5.2 3.8V2.5h3.6v1.3M3.7 3.8l.6 7.2h5.4l.6-7.2" {...s} />
    </svg>
  )
}

function FolderIcon({ big }: { big?: boolean }) {
  const size = big ? 28 : 14
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M2 4.6c0-.8.6-1.4 1.4-1.4h3l1.4 1.6h5.8c.8 0 1.4.6 1.4 1.4v6c0 .8-.6 1.4-1.4 1.4H3.4c-.8 0-1.4-.6-1.4-1.4V4.6Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M2.4 6.4h11.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.5" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg {...i}>
      <path d="M8.2 1.6H4.3c-.5 0-.9.4-.9.9v9c0 .5.4.9.9.9h5.4c.5 0 .9-.4.9-.9V4.6L8.2 1.6Z" {...s} />
      <path d="M8 1.8v3h3" {...s} />
    </svg>
  )
}
