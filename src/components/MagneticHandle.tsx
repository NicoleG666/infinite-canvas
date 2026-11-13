import { useEffect, useRef, useState } from 'react'

interface Props {
  side: 'left' | 'right'
  onDragStart: () => void
}

const HANDLE_R = 13 // 加号半径（对应 CSS 中 26px 直径）
const PULL_MAX = 20 // 向外 / 垂直最大跟手位移（px）
const PULL_IN = 5 // 向节点内侧最大位移，保证与卡片至少留 3px
const FOLLOW = 0.8 // 跟手系数：位移 = 鼠标相对按钮静止中心的偏移 × 系数
const GAP = 9 // 按钮静止时与节点边缘的间距，保证完全位于节点外

/**
 * 磁吸加号按钮。
 * 防抖关键：基准点取自「父节点边缘中点」，而不是按钮自身的 rect。
 * 按钮位移不会反过来影响基准点，因此不会形成正反馈回路。
 * 位移以按钮静止中心为基准朝鼠标小幅跟手：
 * 水平最多向内 5px（始终与卡片留 3px）、向外 10px，垂直上下各 10px；
 * 鼠标位于节点内部时完全不做吸附。
 */
export default function MagneticHandle({ side, onDragStart }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pull, setPull] = useState(0)
  const [pullY, setPullY] = useState(0)
  // 鼠标不在本侧时隐藏该侧加号，保证同一时刻只出现一边
  const [offSide, setOffSide] = useState(false)

  useEffect(() => {
    let raf = 0
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        // 父节点 rect：稳定基准，不随按钮自身 transform 变化
        const parent = ref.current?.parentElement
        if (!parent) return
        const rect = parent.getBoundingClientRect()

        // 只有鼠标所在的一侧显示并跟手，另一侧隐藏且保持静止
        const centerX = rect.left + rect.width / 2
        const onThisSide = side === 'right' ? e.clientX >= centerX : e.clientX < centerX
        setOffSide(!onThisSide)

        // 鼠标位于节点内部时完全不吸附，水平与垂直位移都归零
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          setPull(0)
          setPullY(0)
          return
        }

        if (!onThisSide) {
          setPull(0)
          setPullY(0)
          return
        }

        // 按钮的静止中心（位于节点边缘外侧 GAP + 半径处）
        const homeX =
          side === 'right' ? rect.right + GAP + HANDLE_R : rect.left - GAP - HANDLE_R
        const homeY = rect.top + rect.height / 2

        // 跟手：位移与鼠标相对静止中心的偏移成正比，方向始终朝鼠标
        const dx = (e.clientX - homeX) * FOLLOW
        const dy = (e.clientY - homeY) * FOLLOW

        // 水平限制方向：右侧向内最多 PULL_IN（留 3px），左侧对称，
        // 这样既不会出现排斥，也永远不会压进卡片
        const nextX =
          side === 'right'
            ? Math.max(-PULL_IN, Math.min(PULL_MAX, dx))
            : Math.max(-PULL_MAX, Math.min(PULL_IN, dx))
        const nextY = Math.max(-PULL_MAX, Math.min(PULL_MAX, dy))

        setPull(Number(nextX.toFixed(2)))
        setPullY(Number(nextY.toFixed(2)))
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [side])

  // 完全放在节点外侧：右侧从节点右边缘再向右 GAP，左侧从节点左边缘再向左 GAP
  const translateX =
    side === 'right'
      ? `calc(${GAP}px + ${pull}px)`
      : `calc(-100% - ${GAP}px + ${pull}px)`

  return (
    <div
      ref={ref}
      className={`mag-handle ${offSide ? 'off-side' : ''}`}
      style={{
        position: 'absolute',
        top: '50%',
        left: side === 'right' ? '100%' : 0,
        // 显隐与缩放由邻近感应（父元素 .near 类）驱动，这里只负责磁吸位移
        transform: `translate(${translateX}, calc(-50% + ${pullY}px))`,
        transition: 'background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.22s ease, opacity 0.18s ease, scale 0.22s cubic-bezier(0.34, 1.4, 0.64, 1), transform 0.12s cubic-bezier(0.22, 1, 0.36, 1)',
        zIndex: 25,
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onDragStart()
      }}
    >
      {/* 加号整体用一条 path 绘制：横竖同一 stroke-width + 圆头，中心严格落在 (12,12) */}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 7.5V16.5M7.5 12H16.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}
