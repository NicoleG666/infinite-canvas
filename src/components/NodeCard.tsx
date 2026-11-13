import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CanvasNode } from '../types'
import { useCanvasStore } from '../store/canvasStore'
import { saveFile } from '../utils/idb'
import { detectCodeMode, runJavaScript, runPython } from '../utils/runCode'
import type { CodeMode, RunResult } from '../utils/runCode'
import { snapNodePosition, snapNodeResize } from '../utils/geometry'
import { highlightCode } from '../utils/highlight'
import AudioPlayer from './AudioPlayer'
import MagneticHandle from './MagneticHandle'
import { useProximity } from '../hooks/useProximity'
import { NODE_TYPE_ITEMS } from './NodeTypeIcons'

interface Props {
  node: CanvasNode
  scale: number
  // 拖拽连线时鼠标正悬停在本节点上：显示一圈高亮，松手后取消
  connectTarget?: boolean
  // 鼠标当前的世界坐标，用于计算目标卡片的悬浮倾斜方向
  connectPoint?: { x: number; y: number }
}

// 目标卡片跟随光标的最大倾斜角度
const CONNECT_TILT = 14
// 吸附判定距离（屏幕像素），缩放后换算成世界坐标
const SNAP_SCREEN_PX = 6
// 按比例缩放节点时的最小尺寸与最大倍数
const MIN_RESIZE_W = 120
const MIN_RESIZE_H = 90
const MAX_RESIZE_FACTOR = 4

// 标签面板的 5 种默认醒目颜色
const TAG_COLORS = [
  { value: '#ff5d6c', label: '红色' },
  { value: '#ffa62b', label: '橙色' },
  { value: '#33d17a', label: '绿色' },
  { value: '#4d8dff', label: '蓝色' },
  { value: '#b06bff', label: '紫色' },
]

export default function NodeCard({ node, scale, connectTarget, connectPoint }: Props) {
  const updateNode = useCanvasStore((s) => s.updateNode)
  const setSelected = useCanvasStore((s) => s.setSelected)
  const toggleSelected = useCanvasStore((s) => s.toggleSelected)
  const setDraggingConnection = useCanvasStore((s) => s.setDraggingConnection)
  const draggingConnection = useCanvasStore((s) => s.draggingConnection)
  const setRemarkOpen = useCanvasStore((s) => s.setRemarkOpen)
  const setRightMenu = useCanvasStore((s) => s.setRightMenu)
  const remarkOpenId = useCanvasStore((s) => s.remarkOpenId)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const selected = selectedIds.includes(node.id)
  const focusedGroupId = useCanvasStore((s) => s.focusedGroupId)
  const exitGroup = useCanvasStore((s) => s.exitGroup)
  const enterGroup = useCanvasStore((s) => s.enterGroup)
  const selectGroup = useCanvasStore((s) => s.selectGroup)

  // 处于未进入的分组内时，不显示本节点加号（只显示分组加号）
  const handlesLocked = !!node.groupId && node.groupId !== focusedGroupId

  // 分组内的节点需先进入分组内部，才允许编辑/上传
  const requireEntered = () => {
    if (handlesLocked && node.groupId) {
      enterGroup(node.groupId)
      return false
    }
    return true
  }

  const requestUpload = () => {
    if (requireEntered()) fileInputRef.current?.click()
  }

  const [editing, setEditing] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [runPanel, setRunPanel] = useState<{
    mode: CodeMode
    code: string
    running: boolean
    result: RunResult | null
  } | null>(null)
  const dragStart = useRef<{ cx: number; cy: number; nx: number; ny: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  // 代码编辑态的高亮层：与透明文字的 textarea 同步滚动
  const codePreRef = useRef<HTMLPreElement>(null)

  // 鼠标靠近节点（含外部空白）即显示加号，远离后隐藏
  const near = useProximity(rootRef, { enter: 30, exit: 80, enabled: !handlesLocked })

  // 图片 / 视频 / 音频 / 代码节点：内容铺满整张卡片
  const isMedia = node.type === 'image' || node.type === 'video' || node.type === 'audio'
  const fullBleed = isMedia || node.type === 'code'
  const typeItem = NODE_TYPE_ITEMS.find((item) => item.type === node.type)
  const displayName = node.name || typeItem?.label || ''
  // 代码语言：优先用户显式选择，否则按内容自动判断 JS / HTML
  const codeLang: CodeMode = node.language ?? detectCodeMode(node.text || '')
  // 只读态语法高亮；编辑态仍是纯文本 textarea，避免引入完整编辑器
  const highlightedCode = useMemo(
    () => (node.type === 'code' ? highlightCode(node.text || '', codeLang) : ''),
    [node.type, node.text, codeLang],
  )

  // 悬浮压感：光标所在的角向屏幕内压下，中心（轴心）保持不动
  const tiltStyle =
    connectTarget && connectPoint
      ? (() => {
          const ox = Math.max(-0.5, Math.min(0.5, (connectPoint.x - node.x) / node.width - 0.5))
          const oy = Math.max(-0.5, Math.min(0.5, (connectPoint.y - node.y) / node.height - 0.5))
          return {
            transform: `perspective(700px) rotateX(${(-oy * 2 * CONNECT_TILT).toFixed(2)}deg) rotateY(${(ox * 2 * CONNECT_TILT).toFixed(2)}deg) scale(1.02)`,
            transformOrigin: '50% 50%',
          }
        })()
      : undefined

  // 点击标签面板以外的地方时收起
  useEffect(() => {
    if (!tagMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.node-tag-wrap')) setTagMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [tagMenuOpen])

  // 运行结果面板打开时支持 Esc 关闭
  useEffect(() => {
    if (!runPanel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRunPanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runPanel])

  const startRename = () => {
    if (!requireEntered()) return
    setNameDraft(displayName)
    setEditingName(true)
  }

  const commitName = () => {
    const next = nameDraft.trim()
    updateNode(node.id, { name: next || displayName })
    setEditingName(false)
  }

  // 节点拖拽移动（世界坐标 = 屏幕位移 / scale）
  const onBodyMouseDown = (e: React.MouseEvent) => {
    if (editing) return
    // 只处理左键：中键留给画布平移，右键留给菜单
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.mag-handle, button, textarea, input, select, audio, a')) return
    // 视频底部是原生控制条，把那一带留给播放控件，其余区域可拖动
    if (target.tagName === 'VIDEO') {
      const r = target.getBoundingClientRect()
      if (e.clientY > r.bottom - 36) return
    }
    // 点击分组外的节点时自动退出当前分组
    if (focusedGroupId && node.groupId !== focusedGroupId) exitGroup()
    e.stopPropagation()
    if (handlesLocked && node.groupId) {
      // 未进入分组时，点内部节点等同于选中整个分组
      selectGroup(node.groupId)
    } else if (e.shiftKey) {
      toggleSelected(node.id)
    } else if (!selected) {
      setSelected([node.id])
    }
    dragStart.current = { cx: e.clientX, cy: e.clientY, nx: node.x, ny: node.y }
    const onMove = (ev: MouseEvent) => {
      const s = dragStart.current
      if (!s) return
      const dx = (ev.clientX - s.cx) / scale
      const dy = (ev.clientY - s.cy) / scale
      const rawX = s.nx + dx
      const rawY = s.ny + dy

      const state = useCanvasStore.getState()
      if (!state.snapEnabled) {
        updateNode(node.id, { x: rawX, y: rawY })
        return
      }
      // 网格吸附：对齐其它节点的边 / 中心，并驱动参考线显示
      const threshold = SNAP_SCREEN_PX / state.viewport.scale
      const others = Object.values(state.nodes).filter((n) => n.id !== node.id)
      const snapped = snapNodePosition(
        { width: node.width, height: node.height },
        rawX,
        rawY,
        others,
        threshold,
      )
      updateNode(node.id, { x: snapped.x, y: snapped.y })
      state.setSnapGuides(snapped.guides)
    }
    const onUp = () => {
      dragStart.current = null
      useCanvasStore.getState().setSnapGuides([])
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 右下角拖拽：按原宽高比等比缩放节点
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!requireEntered()) return
    const start = { x: e.clientX, y: e.clientY, w: node.width, h: node.height }
    setResizing(true)

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - start.x) / scale
      const dy = (ev.clientY - start.y) / scale
      // 以位移更大的方向决定缩放比例，保证拖动跟手
      const raw = Math.abs(dx) >= Math.abs(dy) ? (start.w + dx) / start.w : (start.h + dy) / start.h
      const minFactor = Math.min(1, Math.max(MIN_RESIZE_W / start.w, MIN_RESIZE_H / start.h))
      const factor = Math.min(MAX_RESIZE_FACTOR, Math.max(minFactor, raw))

      const state = useCanvasStore.getState()
      if (!state.snapEnabled) {
        updateNode(node.id, {
          width: Math.round(start.w * factor),
          height: Math.round(start.h * factor),
        })
        return
      }
      // 网格吸附：右 / 下边缘对齐其它节点的边或中心，并驱动参考线显示
      const threshold = SNAP_SCREEN_PX / state.viewport.scale
      const others = Object.values(state.nodes).filter((n) => n.id !== node.id)
      const snapped = snapNodeResize(
        { x: node.x, y: node.y },
        { width: start.w, height: start.h },
        { width: start.w * factor, height: start.h * factor },
        others,
        threshold,
      )
      updateNode(node.id, { width: snapped.width, height: snapped.height })
      state.setSnapGuides(snapped.guides)
    }
    const onUp = () => {
      setResizing(false)
      useCanvasStore.getState().setSnapGuides([])
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // 选择文件：读取真实宽高比后适配节点尺寸
  const pickFile = async (file: File) => {
    // 本地库不可用时仍创建节点（仅无法持久化文件 blob）
    const key = await saveFile(file).catch(() => undefined)
    const url = URL.createObjectURL(file)
    const dim = await measureMedia(file.type, url)
    // 替换节点媒体时释放旧的 objectURL，避免内存持续增长
    if (node.url?.startsWith('blob:')) URL.revokeObjectURL(node.url)
    updateNode(node.id, {
      url,
      fileKey: key,
      // 音频节点记录原始文件名，用于卡片内展示
      ...(node.type === 'audio' ? { fileName: file.name } : {}),
      ...(dim ? { width: dim.width, height: dim.height } : {}),
    })
  }

  const startConnection = () => {
    setDraggingConnection({
      sourceId: node.id,
      cursorX: node.x + node.width,
      cursorY: node.y + node.height / 2,
    })
  }

  // 运行代码：HTML 进沙箱 iframe 预览，JS / Python 在各自 Worker 里执行
  const executeCode = async () => {
    const code = node.text || ''
    if (!code.trim() || !requireEntered()) return
    const mode: CodeMode = node.language ?? detectCodeMode(code)
    if (mode === 'html') {
      setRunPanel({ mode, code, running: false, result: null })
      return
    }
    setRunPanel({ mode, code, running: true, result: null })
    const result = mode === 'python' ? await runPython(code) : await runJavaScript(code)
    setRunPanel((panel) => (panel && panel.code === code ? { ...panel, running: false, result } : panel))
  }

  const renderContent = () => {
    switch (node.type) {
      case 'text':
        return editing ? (
          <textarea
            autoFocus
            className="w-full h-full bg-transparent resize-none outline-none text-[13.5px] leading-relaxed"
            style={{ color: 'var(--text-1)' }}
            value={node.text}
            onChange={(e) => updateNode(node.id, { text: e.target.value })}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <div
            className="w-full h-full text-[13.5px] leading-relaxed whitespace-pre-wrap overflow-hidden cursor-text"
            style={{ color: node.text ? 'var(--text-1)' : 'var(--text-3)' }}
            onDoubleClick={() => {
              if (requireEntered()) setEditing(true)
            }}
          >
            {node.text || '双击编辑文本'}
          </div>
        )

      case 'code':
        return (
          <>
            <div className="code-block">
              {editing ? (
                <div className="code-edit">
                  {/* 高亮层垫在下方，textarea 文字透明只保留光标，输入时也能彩色预览 */}
                  <pre ref={codePreRef} className="code-highlight" aria-hidden="true">
                    <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
                  </pre>
                  <textarea
                    autoFocus
                    spellCheck={false}
                    className="code-input"
                    value={node.text}
                    onChange={(e) => updateNode(node.id, { text: e.target.value })}
                    onScroll={(e) => {
                      const pre = codePreRef.current
                      if (!pre) return
                      pre.scrollTop = e.currentTarget.scrollTop
                      pre.scrollLeft = e.currentTarget.scrollLeft
                    }}
                    onBlur={() => setEditing(false)}
                    onKeyDown={(e) => {
                      // Ctrl/Cmd + Enter 直接运行
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault()
                        void executeCode()
                      }
                    }}
                  />
                </div>
              ) : node.text ? (
                <div
                  className="code-view"
                  onDoubleClick={() => {
                    if (requireEntered()) setEditing(true)
                  }}
                  dangerouslySetInnerHTML={{ __html: highlightedCode }}
                />
              ) : (
                <div
                  className="code-view"
                  style={{ color: 'var(--text-3)' }}
                  onDoubleClick={() => {
                    if (requireEntered()) setEditing(true)
                  }}
                >
                  双击编辑代码
                </div>
              )}
            </div>
            {!editing && (
              <select
                className="code-lang"
                value={codeLang}
                title="代码语言"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => updateNode(node.id, { language: e.target.value as CodeMode })}
              >
                <option value="js">JavaScript</option>
                <option value="python">Python</option>
                <option value="html">HTML</option>
              </select>
            )}
            {!editing && !!node.text?.trim() && (
              <button
                type="button"
                className="code-run-btn"
                title="运行代码（Ctrl+Enter）"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  void executeCode()
                }}
              >
                <PlayIcon />
                运行
              </button>
            )}
          </>
        )

      case 'image':
        return node.url ? (
          <img
            src={node.url}
            alt=""
            className="w-full h-full rounded-[21px]"
            style={{ objectFit: 'contain' }}
            draggable={false}
          />
        ) : (
          <Placeholder label="双击上传图片" onUpload={requestUpload} />
        )

      case 'video':
        return node.url ? (
          <video
            src={node.url}
            controls
            className="w-full h-full rounded-[21px] bg-black/50"
            style={{ objectFit: 'contain' }}
          />
        ) : (
          <Placeholder label="双击上传视频" onUpload={requestUpload} />
        )

      case 'audio':
        return node.url ? (
          <AudioPlayer src={node.url} name={node.fileName || node.name} />
        ) : (
          <Placeholder label="双击上传音频" onUpload={requestUpload} />
        )

      case 'link': {
        const safeHref = safeLinkHref(node.linkUrl || '')
        const commitLink = () => {
          const next = (node.linkUrl || '').trim()
          if (next !== (node.linkUrl || '')) updateNode(node.id, { linkUrl: next })
          setEditing(false)
        }
        return (
          <div className="w-full h-full flex flex-col justify-center">
            {editing ? (
              <input
                autoFocus
                className="field-input text-[13px] px-2 py-1.5"
                value={node.linkUrl || ''}
                placeholder="https://…"
                onChange={(e) => updateNode(node.id, { linkUrl: e.target.value })}
                onBlur={commitLink}
                onKeyDown={(e) => e.key === 'Enter' && commitLink()}
              />
            ) : (
              <div className="link-row">
                <a
                  href={safeHref ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="link-url text-[13px] break-all"
                  style={{ color: 'var(--cyan)' }}
                  onClick={(e) => {
                    // 单击只选中节点；双击编辑；Ctrl/Cmd+单击直接打开
                    e.preventDefault()
                    if ((e.ctrlKey || e.metaKey) && safeHref) {
                      window.open(safeHref, '_blank', 'noopener,noreferrer')
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault()
                    setEditing(true)
                  }}
                >
                  {node.linkUrl || '双击输入链接'}
                </a>
                {safeHref && (
                  <button
                    type="button"
                    className="link-open"
                    title="打开链接"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      window.open(safeHref, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    <ExternalLinkIcon />
                  </button>
                )}
              </div>
            )}
          </div>
        )
      }
    }
  }

  const acceptType =
    node.type === 'image'
      ? 'image/*'
      : node.type === 'video'
        ? 'video/*'
        : node.type === 'audio'
          ? 'audio/*'
          : undefined

  const header = (
    <div className="node-head">
      <span className="node-head-icon">{typeItem?.icon}</span>
      {editingName ? (
        <input
          autoFocus
          className="node-head-input"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') {
              setNameDraft(displayName)
              setEditingName(false)
            }
          }}
          style={{ width: Math.min(200, Math.max(46, nameDraft.length * 12 + 16)) }}
        />
      ) : (
        <span className="node-head-name" title="双击重命名" onDoubleClick={startRename}>
          {displayName}
        </span>
      )}
    </div>
  )

  return (
    <div
      ref={rootRef}
      className={`glass-node ${selected ? 'selected' : ''} ${handlesLocked ? 'no-handles' : ''} ${near ? 'near' : ''} ${node.tagColor ? 'has-tag' : ''} ${tagMenuOpen ? 'tag-open' : ''} ${connectTarget ? 'connect-target' : ''} ${draggingConnection ? 'hide-handles' : ''}`}
      style={
        {
          position: 'absolute',
          left: node.x,
          top: node.y,
          width: node.width,
          height: node.height,
          padding: fullBleed ? 0 : 16,
          overflow: 'visible',
          // 节点永远在分组框之上，分组内节点才能被正常拖拽/双击；
          // 邻近时再抬一层，避免相邻节点卡片裁掉外侧的加号
          zIndex: near ? 4 : 3,
          cursor: dragStart.current ? 'grabbing' : 'grab',
          ...(node.tagColor ? { '--tag-color': node.tagColor } : {}),
          ...tiltStyle,
        } as React.CSSProperties
      }
      onMouseDown={onBodyMouseDown}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!selected) setSelected([node.id])
        setRightMenu({ x: e.clientX, y: e.clientY, targetType: 'node', targetId: node.id })
      }}
    >
      {/* 顶部工具条：hover 或选中时由 CSS 显现 */}
      <div
        className="node-toolbar absolute -top-[26px] right-0 flex gap-1"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <ToolBtn
          title="备注"
          active={remarkOpenId === node.id || !!node.remark}
          onClick={() => setRemarkOpen(remarkOpenId === node.id ? null : node.id)}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 2.2h8M2 5.6h8M2 9h5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </ToolBtn>

        <div className="node-tag-wrap" onMouseDown={(e) => e.stopPropagation()}>
          <ToolBtn
            title="标签"
            active={tagMenuOpen || !!node.tagColor}
            accent={node.tagColor}
            onClick={() => setTagMenuOpen((open) => !open)}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path
                d="M2.3 2.3h4.1l3.8 3.8a.85.85 0 0 1 0 1.2l-3 3a.85.85 0 0 1-1.2 0L2.3 6.5V2.3Z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <circle cx="4.5" cy="4.5" r="0.9" fill="currentColor" />
            </svg>
          </ToolBtn>

          {tagMenuOpen && (
            <div className="node-tag-pop">
              <div className="node-tag-title">标签颜色</div>
              <div className="node-tag-row">
                {TAG_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    title={color.label}
                    aria-label={color.label}
                    className={`node-tag-swatch ${node.tagColor === color.value ? 'is-active' : ''}`}
                    style={{ background: color.value, color: color.value }}
                    onClick={() => {
                      updateNode(node.id, { tagColor: color.value })
                      setTagMenuOpen(false)
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                className="node-tag-clear"
                onClick={() => {
                  updateNode(node.id, { tagColor: undefined })
                  setTagMenuOpen(false)
                }}
              >
                全部清空颜色
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 有备注且未展开时的角标 */}
      {node.remark && remarkOpenId !== node.id && (
        <div
          className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full"
          style={{
            background: 'var(--cyan)',
            boxShadow: '0 0 8px rgba(88,216,255,0.9)',
            animation: 'pulse-dot 2.4s ease-in-out infinite',
          }}
        />
      )}

      {/* 名称在卡片外侧左上角，与右上角工具条同一条水平线 */}
      {header}

      {renderContent()}

      <input
        ref={fileInputRef}
        type="file"
        accept={acceptType}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) pickFile(f)
          e.target.value = ''
        }}
      />

      <MagneticHandle side="left" onDragStart={startConnection} />
      <MagneticHandle side="right" onDragStart={startConnection} />

      {/* 右下角缩放手柄：悬停时显示白色圆弧，拖拽等比缩放 */}
      <button
        type="button"
        className={`node-resize-handle ${resizing ? 'is-resizing' : ''}`}
        title="拖拽按比例缩放节点"
        aria-label="拖拽按比例缩放节点"
        onMouseDown={onResizeStart}
        onClick={(e) => e.stopPropagation()}
      >
        <svg
          className="node-resize-arc"
          width="28"
          height="28"
          viewBox="0 0 28 28"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M25 3A22 22 0 0 1 3 25"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {/* 代码运行结果：Portal 到 body，避免被画布缩放/位移影响 */}
      {runPanel &&
        createPortal(
          <div
            className="code-run-overlay"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setRunPanel(null)}
          >
            <div
              className="code-run-panel"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="code-run-head">
                <div>
                  <div className="code-run-title">
                    {runPanel.mode === 'html'
                      ? 'HTML 预览'
                      : runPanel.mode === 'python'
                        ? 'Python 运行结果'
                        : 'JS 运行结果'}
                  </div>
                  <div className="code-run-sub">沙箱执行 · 仅在本地浏览器内运行</div>
                </div>
                <button
                  type="button"
                  className="code-run-close"
                  title="关闭（Esc）"
                  onClick={() => setRunPanel(null)}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M2.6 2.6l6.8 6.8M9.4 2.6 2.6 9.4"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              {runPanel.mode === 'html' ? (
                <iframe
                  className="code-run-frame"
                  title="HTML 预览"
                  sandbox="allow-scripts allow-modals allow-forms allow-popups"
                  srcDoc={runPanel.code}
                />
              ) : (
                <div className="code-run-logs">
                  {runPanel.running && <div className="code-run-line system">运行中…</div>}
                  {!runPanel.running &&
                    runPanel.result?.logs.map((log, i) => (
                      <div key={i} className={`code-run-line ${log.level}`}>
                        {log.text}
                      </div>
                    ))}
                  {!runPanel.running && runPanel.result && !runPanel.result.ok && (
                    <div className="code-run-line error">{runPanel.result.error}</div>
                  )}
                  {!runPanel.running &&
                    runPanel.result &&
                    runPanel.result.ok &&
                    runPanel.result.logs.length === 0 && (
                      <div className="code-run-line system">（无输出）</div>
                    )}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

/* ---------------- 辅助组件 ---------------- */

function ToolBtn({
  children,
  title,
  active,
  accent,
  onClick,
}: {
  children: React.ReactNode
  title: string
  active?: boolean
  accent?: string
  onClick: () => void
}) {
  // 有标签色时，激活态按钮跟随标签颜色（颜色通过 CSS 变量传给玻璃样式）
  return (
    <button
      title={title}
      onClick={onClick}
      className={`node-tool-btn ${active ? 'is-active' : ''}`}
      style={accent ? ({ '--tool-accent': accent } as React.CSSProperties) : undefined}
    >
      {children}
    </button>
  )
}

// 占位：无边框、无虚线，仅冷光氛围 + 提示；单击/拖拽可移动节点，双击才唤起文件选择
function Placeholder({ label, onUpload }: { label: string; onUpload: () => void }) {
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-2.5 rounded-[21px]"
      style={{
        background:
          'radial-gradient(circle at 50% 42%, rgba(88,216,255,0.07), transparent 68%)',
        transition: 'background 0.25s ease',
        cursor: 'inherit',
      }}
      onDoubleClick={onUpload}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.background =
          'radial-gradient(circle at 50% 42%, rgba(88,216,255,0.14), transparent 70%)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.background =
          'radial-gradient(circle at 50% 42%, rgba(88,216,255,0.07), transparent 68%)'
      }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-3)' }}>
        <rect x="3" y="4" width="18" height="16" rx="2.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3 15.5l4.5-4.5 3.5 3.5 3-3L21 16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="8.6" cy="8.6" r="1.4" stroke="currentColor" strokeWidth="1.1" />
      </svg>
      <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>
        {label}
      </span>
    </div>
  )
}

/* ---------------- 媒体尺寸测量 ---------------- */

const MAX_W = 420
const MAX_H = 340

// 只允许 http/https；没有协议时补 https://；其他协议（javascript: 等）返回 null
function safeLinkHref(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null
  return `https://${t}`
}

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M5 2.6h4.4V7M9.4 2.6 5.6 6.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M9 7.8v1.6a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1h1.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2.6 1.8 8.2 5 2.6 8.2V1.8Z" fill="currentColor" />
    </svg>
  )
}

// 按真实宽高比计算节点尺寸，并限制最大值
export async function measureMedia(
  mime: string,
  url: string,
): Promise<{ width: number; height: number } | null> {
  try {
    if (mime.startsWith('image/')) {
      const img = await loadImage(url)
      return fitSize(img.naturalWidth, img.naturalHeight)
    }
    if (mime.startsWith('video/')) {
      const v = await loadVideo(url)
      return fitSize(v.videoWidth, v.videoHeight)
    }
  } catch {
    return null
  }
  return null
}

function fitSize(w: number, h: number) {
  if (!w || !h) return { width: 320, height: 220 }
  const ratio = w / h
  let width = MAX_W
  let height = width / ratio
  if (height > MAX_H) {
    height = MAX_H
    width = height * ratio
  }
  if (width < 160) {
    width = 160
    height = width / ratio
  }
  return { width: Math.round(width), height: Math.round(height) }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve(v)
    v.onerror = reject
    v.src = url
  })
}
