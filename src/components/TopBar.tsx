import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CanvasDocMeta } from '../types'
import { useCanvasStore } from '../store/canvasStore'
import UserMenu from './UserMenu'
import { AVATAR_STYLES, avatarInitial } from '../utils/profile'
import { clearErrorLogs, errorLogCount, formatErrorLogs } from '../utils/errorLog'
import {
  buildShareUrl,
  createSharePayload,
  downloadCardImage,
  encodeShareToken,
  isLocalShareOrigin,
  renderShareCard,
} from '../utils/share'

interface Props {
  loading: boolean
  storageError: string | null
  storageWarning: string | null
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onExport: () => void
  onExportAll: () => void
  onImport: () => void
  onCopy: () => Promise<boolean>
  trashMetas: (CanvasDocMeta & { trashedAt: number })[]
  onRestore: (id: string) => void
  onPurge: (id: string) => void
}

function fmtSize(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 复制文本：优先 Clipboard API，失败时退回隐藏 textarea
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

// 复制卡片图片（仅支持 ClipboardItem 的浏览器）
async function copyImage(dataUrl: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false
    const blob = await (await fetch(dataUrl)).blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

const SHORTCUT_GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: '画布',
    rows: [
      ['拖拽空白', '框选节点'],
      ['中键 / 空格 + 拖拽', '平移画布'],
      ['滚轮', '缩放画布'],
      ['左下角百分比', '缩放选项 / 适合屏幕'],
    ],
  },
  {
    title: '节点',
    rows: [
      ['拖拽节点', '移动节点'],
      ['双击节点', '编辑文本 / 上传媒体'],
      ['拖出 + 号', '创建连线'],
      ['点击连线', '剪刀切断 / Delete 删除'],
      ['Ctrl+C / Ctrl+V', '复制 / 粘贴节点'],
      ['Ctrl+Z / Ctrl+Shift+Z', '撤销 / 重做'],
      ['Delete', '删除选中节点'],
    ],
  },
  {
    title: '分组',
    rows: [
      ['选中 ≥ 2 个', '工具栏「分组」'],
      ['选中分组', '工具栏「解组」'],
      ['双击分组', '进入内部空间'],
      ['Esc', '退出分组'],
    ],
  },
  {
    title: '界面',
    rows: [
      ['底部 + 号', '添加节点 / 上传'],
      ['左上角画布名', '画布管理'],
      ['右上角导出', '导出与分享'],
      ['Esc', '关闭浮层菜单'],
    ],
  },
]

// 顶部浮动栏：左侧品牌 + 画布下拉，右侧导出 / 快捷键 / 节点数 / 头像
export default function TopBar({
  loading,
  storageError,
  storageWarning,
  onNew,
  onOpen,
  onDelete,
  onRename,
  onExport,
  onExportAll,
  onImport,
  onCopy,
  trashMetas,
  onRestore,
  onPurge,
}: Props) {
  const docMetas = useCanvasStore((s) => s.docMetas)
  const docId = useCanvasStore((s) => s.docId)

  const current = docMetas.find((m) => m.id === docId)
  const activeMenu = useCanvasStore((s) => s.activeMenu)
  const setActiveMenu = useCanvasStore((s) => s.setActiveMenu)
  const menuOpen = activeMenu === 'canvas'
  const helpOpen = activeMenu === 'help'
  const shareOpen = activeMenu === 'share'
  const userOpen = activeMenu === 'user'
  const profile = useCanvasStore((s) => s.profile)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const shareBtnRef = useRef<HTMLButtonElement>(null)
  const avatarBtnRef = useRef<HTMLButtonElement>(null)
  const nameRef = useRef<HTMLSpanElement>(null)
  const clickTimerRef = useRef<number | null>(null)
  const nameEditingRef = useRef(false)
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  const [sharePos, setSharePos] = useState<{ left: number; top: number } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [nameEditing, setNameEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameWidth, setNameWidth] = useState(140)
  // 分享：链接 token、卡片图、媒体提示与操作反馈
  const [shareUrl, setShareUrl] = useState('')
  const [shareCard, setShareCard] = useState('')
  const [shareMediaCount, setShareMediaCount] = useState(0)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareNote, setShareNote] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  // 诊断面板：错误计数与操作反馈
  const [diagNote, setDiagNote] = useState<string | null>(null)
  const errorCount = errorLogCount()

  // 切换画布时退出顶栏重命名，避免把名字写到另一份画布
  useEffect(() => {
    nameEditingRef.current = false
    setNameEditing(false)
  }, [docId])

  // 卸载时清理单击延时
  useEffect(
    () => () => {
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current)
    },
    [],
  )

  // 菜单打开时支持 Esc 关闭
  useEffect(() => {
    if (!menuOpen && !helpOpen && !shareOpen && !userOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, helpOpen, shareOpen, userOpen, setActiveMenu])

  // 分享面板打开时贴着右上角按钮定位（右侧对齐、按钮下方 6px）
  useLayoutEffect(() => {
    if (!shareOpen) return
    const r = shareBtnRef.current?.getBoundingClientRect()
    if (!r) return
    const w = 360
    setSharePos({
      left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)),
      top: r.bottom + 6,
    })
  }, [shareOpen])

  // 打开分享面板时生成链接与卡片（取当下快照，面板打开期间不重复重绘）
  useEffect(() => {
    if (!shareOpen) return
    let alive = true
    setShareBusy(true)
    setShareNote(null)
    setLinkCopied(false)
    ;(async () => {
      const state = useCanvasStore.getState()
      const meta = state.docMetas.find((m) => m.id === state.docId)
      const payload = createSharePayload(
        {
          name: meta?.name ?? '未命名画布',
          nodes: Object.values(state.nodes),
          connections: Object.values(state.connections),
          groups: Object.values(state.groups),
          viewport: state.viewport,
        },
        state.profile?.nickname ?? '画布用户',
      )
      const token = await encodeShareToken(payload)
      const card = await renderShareCard(payload)
      if (!alive) return
      setShareUrl(buildShareUrl(token))
      setShareCard(card)
      setShareMediaCount(payload.mediaCount)
      setShareBusy(false)
    })()
    return () => {
      alive = false
    }
  }, [shareOpen, docId])

  const shareTitle = current?.name ?? '未命名画布'
  const shareText = `${profile?.nickname ?? '画布用户'} 在「无限画布」分享了「${shareTitle}」`
  // 本地开发时链接会自动指向线上站点，这里只做说明，不再提示「只能本机打开」
  const shareLocalOnly = isLocalShareOrigin()
  // QQ 官方分享页：用 <a target="_blank"> 打开，比 window.open 更不容易被拦截
  const qqShareUrl = shareUrl
    ? `https://connect.qq.com/widget/shareqq/index.html?url=${encodeURIComponent(
        shareUrl,
      )}&title=${encodeURIComponent(shareTitle)}&summary=${encodeURIComponent(shareText)}`
    : ''

  const handleCopyLink = async () => {
    if (!shareUrl) return
    const ok = await copyText(shareUrl)
    setLinkCopied(ok)
    setShareNote(ok ? '链接已复制，粘贴到微信 / QQ 聊天即可分享' : '复制失败，请长按链接手动复制')
  }

  // 微信：移动端调起系统分享面板（可带卡片图），桌面端复制链接引导粘贴
  const handleWeChat = async () => {
    if (!shareUrl) return
    const mobile = navigator.maxTouchPoints > 0
    try {
      if (mobile && shareCard && typeof navigator.share === 'function') {
        const blob = await (await fetch(shareCard)).blob()
        const file = new File([blob], `${shareTitle}-分享卡片.png`, { type: 'image/png' })
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: shareTitle, text: shareText, url: shareUrl })
          setShareNote('已调起系统分享，选择微信即可发送卡片与链接')
          return
        }
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
    }
    const ok = await copyText(shareUrl)
    setLinkCopied(ok)
    setShareNote(
      ok
        ? '链接已复制，打开微信粘贴给好友即可；想带卡片图可先「保存图片」再一起发送'
        : '复制失败，请手动复制链接',
    )
  }

  // QQ：由 <a> 打开官方分享页，点击时同时复制链接兜底
  const handleQQ = async () => {
    const ok = await copyText(shareUrl)
    setLinkCopied(ok)
    setShareNote(
      ok
        ? '链接已复制；在打开的 QQ 分享页选择好友发送，若未打开可直接到 QQ 粘贴'
        : '请在弹出的 QQ 分享页选择好友，复制失败时可手动选中链接复制',
    )
  }

  const handleMore = async () => {
    if (!shareUrl) return
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl })
        setShareNote('已调起系统分享面板')
        return
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
    }
    const ok = await copyText(shareUrl)
    setLinkCopied(ok)
    setShareNote(ok ? '当前浏览器不支持系统分享，链接已复制' : '复制失败，请手动复制链接')
  }

  const toggleMenu = () => {
    if (menuOpen) {
      setActiveMenu(null)
      return
    }
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) {
      setMenuPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - 348)),
        top: Math.min(r.bottom + 6, window.innerHeight - 240),
      })
    }
    setActiveMenu('canvas')
  }

  const startRename = (m: CanvasDocMeta) => {
    setEditingId(m.id)
    setDraft(m.name)
  }

  const commitRename = () => {
    const v = draft.trim()
    if (editingId && v) onRename(editingId, v)
    setEditingId(null)
  }

  // 单击延迟 220ms：给双击留出判定时间，双击时不弹出菜单
  const handleCanvasClick = () => {
    if (nameEditingRef.current || clickTimerRef.current !== null) return
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null
      toggleMenu()
    }, 220)
  }

  const startNameEdit = () => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    setActiveMenu(null)
    setNameDraft(current?.name ?? '')
    const w = nameRef.current?.getBoundingClientRect().width ?? 0
    setNameWidth(Math.max(110, Math.min(210, w + 18)))
    nameEditingRef.current = true
    setNameEditing(true)
  }

  const commitNameEdit = () => {
    if (!nameEditingRef.current) return
    nameEditingRef.current = false
    const v = nameDraft.trim()
    const id = useCanvasStore.getState().docId
    if (id && v && v !== current?.name) onRename(id, v)
    setNameEditing(false)
  }

  return (
    <nav className="top-bar">
      <div className="top-left">
        <div className="brand-mark" title="无限画布">
          <img className="brand-mark-img" src="/logo-infinity.png" alt="" draggable={false} />
        </div>
        <span className="workspace">我的工作区</span>
        {nameEditing ? (
          <input
            autoFocus
            className="tb-canvas-input"
            style={{ width: nameWidth }}
            value={nameDraft}
            title="回车保存，Esc 取消"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitNameEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitNameEdit()
              if (e.key === 'Escape') {
                e.stopPropagation()
                nameEditingRef.current = false
                setNameEditing(false)
              }
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            ref={triggerRef}
            className="tb-btn tb-canvas"
            title="单击切换 / 管理画布，双击重命名"
            onClick={handleCanvasClick}
            onDoubleClick={startNameEdit}
          >
            <span ref={nameRef} className="tb-canvas-name">
              {current?.name ?? '未命名画布'}
            </span>
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 3.6 5 6.6l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="top-right">
        <button
          ref={shareBtnRef}
          className="tb-btn tb-icon"
          title="导出与分享"
          onClick={() => {
            setCopied(false)
            setActiveMenu(shareOpen ? null : 'share')
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 10.4V2.4M5.2 5.2 8 2.4l2.8 2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 9.8v2.6c0 .6.4 1 1 1h8c.6 0 1-.4 1-1V9.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button
          ref={avatarBtnRef}
          className="tb-avatar"
          title="账号与资料"
          style={{
            background: `linear-gradient(135deg, ${
              (AVATAR_STYLES[profile?.avatarIndex ?? 0] ?? AVATAR_STYLES[0]).from
            }, ${(AVATAR_STYLES[profile?.avatarIndex ?? 0] ?? AVATAR_STYLES[0]).to})`,
          }}
          onClick={() => setActiveMenu(userOpen ? null : 'user')}
        >
          {avatarInitial(profile?.nickname ?? '画布用户')}
        </button>
      </div>

      {userOpen && <UserMenu anchorRef={avatarBtnRef} />}

      {menuOpen && (
        <>
          <div
            className="menu-backdrop"
            style={{ pointerEvents: 'auto' }}
            onMouseDown={() => setActiveMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setActiveMenu(null)
            }}
          />
          <div
            className="canvas-menu"
            style={{
              left: menuPos?.left ?? 8,
              top: menuPos?.top ?? 48,
              pointerEvents: 'auto',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="canvas-menu-head">
              <div>
                <div className="canvas-menu-title">画布</div>
                <div className="canvas-menu-sub">{docMetas.length} 个 · 本地存储</div>
              </div>
              <button
                className="canvas-menu-new"
                onClick={() => {
                  onNew()
                  setActiveMenu(null)
                }}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M6 1.4v9.2M1.4 6h9.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                新建
              </button>
            </div>

            <div className="canvas-menu-list">
              {storageError && (
                <div className="storage-error">
                  本地存储不可用，当前画布仅保存在内存中。
                  <br />
                  <span style={{ opacity: 0.65 }}>{storageError}</span>
                </div>
              )}
              {storageWarning && (
                <div
                  className="storage-error"
                  style={{
                    color: '#ffd48a',
                    borderColor: 'rgba(255, 196, 106, 0.35)',
                    background: 'rgba(255, 196, 106, 0.08)',
                  }}
                >
                  {storageWarning}
                </div>
              )}
              {loading && <div className="canvas-menu-empty">正在加载画布…</div>}
              {!loading && docMetas.length === 0 && (
                <div className="canvas-menu-empty">
                  还没有画布
                  <br />
                  点击右上角「新建」开始
                </div>
              )}
              {docMetas.map((m) => {
                const active = m.id === docId
                return (
                  <div
                    key={m.id}
                    className={`doc-item ${active ? 'active' : ''}`}
                    style={{ padding: '9px 10px 8px', marginBottom: 4, cursor: 'pointer', position: 'relative' }}
                    onClick={() => {
                      if (editingId === m.id) return
                      if (!active) onOpen(m.id)
                      setActiveMenu(null)
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: active ? 'var(--cyan)' : 'var(--text-3)',
                          boxShadow: active ? '0 0 8px rgba(88,216,255,0.9)' : 'none',
                          flexShrink: 0,
                        }}
                      />
                      {editingId === m.id ? (
                        <input
                          autoFocus
                          className="field-input"
                          style={{ fontSize: 12, padding: '2px 6px', width: '100%' }}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          style={{
                            fontSize: 12.5,
                            color: 'var(--text-1)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            startRename(m)
                          }}
                        >
                          {m.name}
                        </span>
                      )}
                      <button
                        title="删除画布"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (confirm(`删除画布「${m.name}」？将移入回收站，30 天内可恢复。`)) onDelete(m.id)
                        }}
                        style={{ color: 'var(--text-3)', flexShrink: 0, opacity: 0.75 }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = '#ff8b8b')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path
                            d="M2.2 3.4h7.6M4.6 3.4V2.2h2.8v1.2M3.2 3.4l.5 6.2h4.6l.5-6.2"
                            stroke="currentColor"
                            strokeWidth="1.1"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        marginTop: 5,
                        paddingLeft: 12,
                        fontSize: 10.5,
                        color: 'var(--text-3)',
                      }}
                    >
                      <span>{fmtTime(m.createdAt)}</span>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span>{m.nodeCount} 节点</span>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span>{fmtSize(m.sizeBytes)}</span>
                    </div>
                  </div>
                )
              })}
              {trashMetas.length > 0 && (
                <div className="canvas-trash">
                  <div className="canvas-trash-head">
                    回收站 · {trashMetas.length} 个（30 天后自动清理）
                  </div>
                  {trashMetas.map((m) => (
                    <div className="canvas-trash-item" key={m.id}>
                      <span className="canvas-trash-name" title={m.name}>
                        {m.name}
                      </span>
                      <button
                        className="canvas-trash-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRestore(m.id)
                        }}
                      >
                        恢复
                      </button>
                      <button
                        className="canvas-trash-btn danger"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (confirm(`彻底删除画布「${m.name}」？删除后不可恢复。`)) onPurge(m.id)
                        }}
                      >
                        彻底删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {shareOpen && (
        <>
          <div
            className="menu-backdrop"
            style={{ pointerEvents: 'auto' }}
            onMouseDown={() => setActiveMenu(null)}
          />
          <div
            className="share-menu"
            style={{
              left: sharePos?.left ?? 8,
              top: sharePos?.top ?? 48,
              pointerEvents: 'auto',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="share-head">
              <div className="canvas-menu-title">分享画布</div>
              <div className="canvas-menu-sub">链接可直接发给好友，也可以发送卡片图片</div>
            </div>

            <div className="share-section">
              <div className="share-label">分享卡片</div>
              <div className="share-desc">
                {shareBusy
                  ? '正在生成卡片…'
                  : shareMediaCount > 0
                    ? `卡片只含文字与缩略图，${shareMediaCount} 个媒体文件不会随链接发送。`
                    : '像视频卡片一样展示画布名称、作者与内容概览。'}
              </div>
              {shareCard ? (
                <img className="share-card-img" src={shareCard} alt="分享卡片预览" />
              ) : (
                <div className="share-card-skeleton" />
              )}
              <div className="share-card-actions">
                <button
                  className="share-action"
                  disabled={!shareCard}
                  onClick={() => shareCard && downloadCardImage(shareCard, shareTitle)}
                >
                  <DownloadIcon />
                  保存图片
                </button>
                <button
                  className="share-action"
                  disabled={!shareCard}
                  onClick={async () => {
                    const ok = shareCard ? await copyImage(shareCard) : false
                    setShareNote(
                      ok
                        ? '卡片图片已复制，可直接粘贴到聊天窗口'
                        : '当前浏览器不支持复制图片，请用「保存图片」',
                    )
                  }}
                >
                  <ImageIcon />
                  复制图片
                </button>
              </div>
            </div>

            <div className="share-section">
              <div className="share-label">分享链接</div>
              <div className="share-desc">打开链接即可导入这份画布（作为新画布打开，不影响原件）。</div>
              <div className="share-link-row">
                <input
                  className="share-link-input"
                  readOnly
                  value={shareBusy ? '正在生成分享链接…' : shareUrl}
                  title={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button className="share-link-copy" title="复制链接" onClick={handleCopyLink}>
                  {linkCopied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
              <div className="share-channels">
                <button className="share-channel wechat" onClick={handleWeChat}>
                  <WeChatIcon />
                  <span>微信</span>
                </button>
                <a
                  className="share-channel qq"
                  href={qqShareUrl || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    if (!qqShareUrl) {
                      e.preventDefault()
                      return
                    }
                    void handleQQ()
                  }}
                >
                  <QQIcon />
                  <span>QQ</span>
                </a>
                <button className="share-channel more" onClick={handleMore}>
                  <MoreIcon />
                  <span>更多</span>
                </button>
              </div>
              {shareNote && <div className="share-note">{shareNote}</div>}
              {shareLocalOnly && (
                <div className="share-warn">
                  当前在本地开发：分享链接已自动指向线上站点，微信 / QQ 可直接发给好友。
                </div>
              )}
              {shareUrl.length > 8000 && (
                <div className="share-warn">
                  画布较大，链接可能被聊天工具截断，建议同时发送卡片图片或导出文件。
                </div>
              )}
            </div>

            <div className="share-section">
              <div className="share-label">备份与导出</div>
              <div className="share-desc">
                JSON 含节点、连线、分组和视口，媒体文件不随 JSON 导出；导入时会先校验数据，覆盖前会自动保留旧版本。
              </div>
              <div className="share-card-actions">
                <button className="share-action" onClick={onExport}>
                  <DownloadIcon />
                  导出 JSON
                </button>
                <button className="share-action" onClick={onImport}>
                  <UploadIcon />
                  导入 JSON
                </button>
                <button className="share-action" onClick={onExportAll}>
                  <DownloadIcon />
                  备份全部画布
                </button>
                <button
                  className="share-action"
                  onClick={async () => {
                    const ok = await onCopy()
                    setCopied(ok)
                  }}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                  {copied ? '已复制' : '复制数据'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {helpOpen && (
        <>
          <div
            className="menu-backdrop"
            style={{ pointerEvents: 'auto' }}
            onMouseDown={() => setActiveMenu(null)}
          />
          <div
            className="help-sheet"
            style={{ pointerEvents: 'auto' }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {SHORTCUT_GROUPS.map((g) => (
              <div className="help-col" key={g.title}>
                <div className="help-col-title">{g.title}</div>
                {g.rows.map(([keys, desc]) => (
                  <div className="help-row" key={`${g.title}-${keys}-${desc}`}>
                    <span className="help-keys">{keys}</span>
                    <span className="help-desc">{desc}</span>
                  </div>
                ))}
              </div>
            ))}

            {/* 诊断：本地错误日志，方便出问题时自查 / 反馈 */}
            <div
              className="help-col"
              style={{
                flexBasis: '100%',
                flexDirection: 'row',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
                borderTop: '1px solid rgba(255,255,255,0.07)',
                paddingTop: 10,
                marginTop: 2,
              }}
            >
              <div className="help-col-title" style={{ margin: 0 }}>
                诊断
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                {errorCount > 0 ? `本地记录了 ${errorCount} 条错误` : '最近没有错误记录'}
              </span>
              <button
                className="share-action"
                style={{ padding: '4px 10px', fontSize: 11.5 }}
                onClick={async () => {
                  const ok = await copyText(formatErrorLogs())
                  setDiagNote(ok ? '诊断信息已复制' : '复制失败，请查看控制台')
                }}
              >
                复制诊断信息
              </button>
              {errorCount > 0 && (
                <button
                  className="share-action"
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                  onClick={() => {
                    clearErrorLogs()
                    setDiagNote('错误记录已清空')
                  }}
                >
                  清空
                </button>
              )}
              {diagNote && (
                <span style={{ fontSize: 11, color: 'var(--cyan)' }}>{diagNote}</span>
              )}
            </div>
          </div>
        </>
      )}
    </nav>
  )
}

/* ---------------- 图标 ---------------- */

const iconProps = { width: 13, height: 13, viewBox: '0 0 14 14', fill: 'none' } as const
const iconStroke = {
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function DownloadIcon() {
  return (
    <svg {...iconProps}>
      <path d="M7 9.4V2.4M4.4 5 7 2.4 9.6 5" {...iconStroke} />
      <path d="M2.4 9.4v1.8c0 .6.4 1 1 1h7.2c.6 0 1-.4 1-1V9.4" {...iconStroke} />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg {...iconProps}>
      <path d="M7 2.4v7M4.4 4.8 7 2.2l2.6 2.6" {...iconStroke} />
      <path d="M2.4 9.4v1.8c0 .6.4 1 1 1h7.2c.6 0 1-.4 1-1V9.4" {...iconStroke} />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg {...iconProps}>
      <rect x="2.2" y="2.2" width="7.2" height="7.2" rx="1.4" {...iconStroke} />
      <path d="M5 11.8h5.4c.6 0 1-.4 1-1V5" {...iconStroke} />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg {...iconProps}>
      <path d="M2.8 7.2l2.8 2.8 5.6-6" {...iconStroke} />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg {...iconProps}>
      <rect x="2.2" y="2.2" width="9.6" height="9.6" rx="1.8" {...iconStroke} />
      <circle cx="5.4" cy="5.4" r="1" fill="currentColor" stroke="none" />
      <path d="M3 10.4l2.6-2.6 2.6 2.6M8.6 9l1.4-1.4 1.8 1.8" {...iconStroke} />
    </svg>
  )
}

function WeChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M9.4 4.2C5.5 4.2 2.4 6.7 2.4 9.9c0 1.8 1.1 3.4 2.8 4.5l-.7 2.2 2.6-1.3c.7.2 1.4.2 2.1.2h.3a4.8 4.8 0 0 1-.2-1.3c0-3.2 3-5.8 6.9-5.8h.5c-.7-2.4-3.6-4.2-7.3-4.2ZM6.7 7.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm5.2 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
      <path d="M21.6 14.2c0-2.7-2.7-4.9-6-4.9s-6 2.2-6 4.9 2.7 4.9 6 4.9c.7 0 1.4-.1 2-.3l2.2 1.1-.6-2c1.5-.9 2.4-2.2 2.4-3.7Zm-8-1.2a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm4 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Z" />
    </svg>
  )
}

function QQIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.6c-3.5 0-5.8 2.5-5.8 6 0 .8.1 1.6.2 2.3-.9 1.2-1.5 2.6-1.5 3.8 0 .9.3 1.5.7 1.8-.4 1-.7 2-.7 2.9 0 .9.5 1.5 1.3 1.5.6 0 1.1-.3 1.5-.9.7.6 1.6 1 2.6 1.2l.2 1.4c.1.5.6.9 1.2.9h1.2c.7 0 1.1-.4 1.2-.9l.2-1.4c1-.2 1.9-.6 2.6-1.2.4.6.9.9 1.5.9.8 0 1.3-.6 1.3-1.5 0-.9-.2-1.9-.7-2.9.4-.3.7-.9.7-1.8 0-1.2-.6-2.6-1.5-3.8.1-.7.2-1.5.2-2.3 0-3.5-2.3-6-5.8-6Z" />
      <circle cx="9.7" cy="8.9" r="1.15" fill="#101216" />
      <circle cx="14.3" cy="8.9" r="1.15" fill="#101216" />
      <ellipse cx="12" cy="12.1" rx="2.4" ry="1.5" fill="#101216" opacity="0.9" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="18" cy="12" r="1.7" fill="currentColor" />
    </svg>
  )
}
