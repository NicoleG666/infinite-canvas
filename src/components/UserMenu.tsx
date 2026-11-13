import { useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { AVATAR_STYLES, avatarInitial, levelOf } from '../utils/profile'

const PANEL_W = 304

function fmtSize(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 用户资料浮层：挂在头像按钮下方，展示 ID / 昵称 / 头像 / 会员状态与本地统计
export default function UserMenu({ anchorRef }: { anchorRef: RefObject<HTMLElement> }) {
  const profile = useCanvasStore((s) => s.profile)
  const setProfile = useCanvasStore((s) => s.setProfile)
  const setActiveMenu = useCanvasStore((s) => s.setActiveMenu)
  const docMetas = useCanvasStore((s) => s.docMetas)
  const nodes = useCanvasStore((s) => s.nodes)
  const connections = useCanvasStore((s) => s.connections)

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  // 贴着头像按钮定位（右对齐、下方 8px），窗口过窄时自动夹在视口内
  useLayoutEffect(() => {
    const r = anchorRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({
      left: Math.max(8, Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 8)),
      top: r.bottom + 8,
    })
  }, [anchorRef])

  // 卸载时清理复制提示定时器
  useLayoutEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    },
    [],
  )

  if (!profile) return null

  const style = AVATAR_STYLES[profile.avatarIndex] ?? AVATAR_STYLES[0]
  const level = levelOf(
    docMetas.length * 20 + Object.keys(nodes).length * 2 + Object.keys(connections).length,
  )
  const storage = docMetas.reduce((sum, m) => sum + m.sizeBytes, 0)

  const commitNickname = () => {
    const v = draft.trim()
    if (v && v !== profile.nickname) setProfile({ ...profile, nickname: v.slice(0, 16) })
    setEditing(false)
  }

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(profile.id)
      setCopied(true)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <>
      <div
        className="menu-backdrop"
        style={{ pointerEvents: 'auto' }}
        onMouseDown={() => setActiveMenu(null)}
      />
      <div
        className="user-menu"
        style={{
          left: pos?.left ?? 8,
          top: pos?.top ?? 52,
          pointerEvents: 'auto',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="um-head">
          <div
            className="um-avatar"
            style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
          >
            {avatarInitial(profile.nickname)}
          </div>
          <div className="um-ident">
            {editing ? (
              <input
                autoFocus
                className="um-name-input"
                value={draft}
                maxLength={16}
                placeholder="输入昵称"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitNickname}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitNickname()
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setEditing(false)
                  }
                }}
              />
            ) : (
              <div className="um-name-row">
                <span className="um-name" title={profile.nickname}>
                  {profile.nickname}
                </span>
                <button
                  className="um-edit"
                  onClick={() => {
                    setDraft(profile.nickname)
                    setEditing(true)
                  }}
                >
                  编辑
                </button>
              </div>
            )}
            <div className="um-id-row">
              <span className="um-id">ID {profile.id}</span>
              <button className="um-copy" title={copied ? '已复制' : '复制 ID'} onClick={copyId}>
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
            <div className="um-badges">
              <span className={`um-badge ${profile.plan === 'pro' ? 'is-pro' : ''}`}>
                {profile.plan === 'pro' ? 'Pro 会员' : '免费版'}
              </span>
              <span className="um-badge um-badge-level" title={`活跃度 ${level.xp}`}>
                Lv.{level.level} {level.name}
              </span>
            </div>
          </div>
        </div>

        {editing && (
          <div className="um-avatars">
            {AVATAR_STYLES.map((s, i) => (
              <button
                key={`${s.from}-${s.to}`}
                className={`um-avatar-dot ${i === profile.avatarIndex ? 'is-active' : ''}`}
                style={{ background: `linear-gradient(135deg, ${s.from}, ${s.to})` }}
                title={`头像 ${i + 1}`}
                onClick={() => setProfile({ ...profile, avatarIndex: i })}
              />
            ))}
          </div>
        )}

        <div className="um-stats">
          <div className="um-stat">
            <b>{docMetas.length}</b>
            <span>画布</span>
          </div>
          <div className="um-stat">
            <b>{Object.keys(nodes).length}</b>
            <span>节点</span>
          </div>
          <div className="um-stat">
            <b>{Object.keys(connections).length}</b>
            <span>连线</span>
          </div>
        </div>

        <div className="um-rows">
          <div className="um-row">
            <span>本地占用</span>
            <span>{fmtSize(storage)}</span>
          </div>
          <div className="um-row">
            <span>加入时间</span>
            <span>{fmtDate(profile.createdAt)}</span>
          </div>
          <div className="um-row">
            <span>存储位置</span>
            <span>浏览器本地</span>
          </div>
        </div>

        <div className="um-benefits">
          <div className="um-benefits-head">
            <span>会员权益</span>
            <span className="um-benefits-plan">
              {profile.plan === 'pro' ? 'Pro' : '免费版'} · 全部可用
            </span>
          </div>
          {['无限画布与节点', '本地自动保存', '导出与分享'].map((t) => (
            <div className="um-benefit" key={t}>
              <CheckIcon />
              {t}
            </div>
          ))}
          <div className="um-tip">当前为本地版，会员体系暂未接入，所有权益免费开放。</div>
        </div>

        <div className="um-footer">
          <span className="um-version">v0.1.0</span>
        </div>
      </div>
    </>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.6 7.4 5.6 10.4 11.4 3.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2.2" y="2.2" width="7.2" height="7.2" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M5 11.8h5.4c.6 0 1-.4 1-1V5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}
