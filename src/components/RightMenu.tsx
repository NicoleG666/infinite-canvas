import { useCanvasStore } from '../store/canvasStore'
import CanvasMenu from './CanvasMenu'

interface Item {
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

// 右键菜单：画布空白 / 节点 / 分组（连线改用选中后的剪刀按钮切断）
export default function RightMenu() {
  const rightMenu = useCanvasStore((s) => s.rightMenu)
  const setRightMenu = useCanvasStore((s) => s.setRightMenu)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const groupSelected = useCanvasStore((s) => s.groupSelected)
  const ungroup = useCanvasStore((s) => s.ungroup)
  const removeNode = useCanvasStore((s) => s.removeNode)
  const setRemarkOpen = useCanvasStore((s) => s.setRemarkOpen)
  const setSelected = useCanvasStore((s) => s.setSelected)
  const nodes = useCanvasStore((s) => s.nodes)
  const groups = useCanvasStore((s) => s.groups)

  if (!rightMenu) return null

  const close = () => setRightMenu(null)

  // 画布空白处右键：双栏菜单（新建节点 / 粘贴 / 撤销重做）
  if (rightMenu.targetType === 'canvas') {
    return <CanvasMenu x={rightMenu.x} y={rightMenu.y} onClose={close} />
  }

  let items: Item[] = []

  if (rightMenu.targetType === 'node' && rightMenu.targetId) {
    const id = rightMenu.targetId
    items = [
      {
        label: '添加备注',
        onClick: () => {
          setRemarkOpen(id)
          close()
        },
      },
      {
        label: '创建分组',
        hint: selectedIds.length >= 2 ? `${selectedIds.length} 个节点` : '需先框选多个节点',
        disabled: selectedIds.length < 2,
        onClick: () => {
          groupSelected()
          close()
        },
      },
      {
        label: '删除节点',
        danger: true,
        onClick: () => {
          removeNode(id)
          close()
        },
      },
    ]
  } else if (rightMenu.targetType === 'group' && rightMenu.targetId) {
    const gid = rightMenu.targetId
    const g = groups[gid]
    items = [
      {
        label: '选中整组',
        onClick: () => {
          if (g) setSelected([...g.nodeIds])
          close()
        },
      },
      {
        label: '取消分组',
        danger: true,
        onClick: () => {
          ungroup(gid)
          close()
        },
      },
    ]
  }

  // 避免菜单溢出视口
  const MENU_W = 196
  const MENU_H = items.length * 38 + 20
  const left = Math.min(rightMenu.x, window.innerWidth - MENU_W - 12)
  const top = Math.min(rightMenu.y, window.innerHeight - MENU_H - 12)

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 99 }}
        onMouseDown={close}
        onContextMenu={(e) => {
          e.preventDefault()
          close()
        }}
      />
      <div
        className="glass-panel animate-fade-rise"
        style={{ position: 'fixed', left, top, zIndex: 100, padding: 6, width: MENU_W }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {items.map((it) => (
          <button
            key={it.label}
            disabled={it.disabled}
            onClick={it.onClick}
            className="w-full flex items-center justify-between px-2.5 py-[7px] rounded-lg text-[12.5px] text-left"
            style={{
              color: it.danger ? '#ff8b8b' : it.disabled ? 'var(--text-3)' : 'var(--text-1)',
              opacity: it.disabled ? 0.45 : 1,
              cursor: it.disabled ? 'not-allowed' : 'pointer',
              background: 'transparent',
            }}
            onMouseEnter={(e) => {
              if (!it.disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span>{it.label}</span>
            {it.hint && (
              <span style={{ color: 'var(--text-3)', fontSize: 10.5 }}>{it.hint}</span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
