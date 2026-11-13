import { useEffect, useRef, useState, type RefObject } from 'react'

interface Options {
  enter?: number // 进入距离（距元素外框，屏幕像素）
  exit?: number // 离开距离（迟滞区间，避免边界反复闪烁）
  enabled?: boolean
}

/**
 * 邻近感应：鼠标进入元素外框一定距离内返回 true，离开更远距离后才返回 false。
 * 采用「外框距离」而不是元素自身 rect，因此元素外部的空白区域也能感应到靠近。
 */
export function useProximity(
  ref: RefObject<HTMLElement | null>,
  { enter = 30, exit = 80, enabled = true }: Options = {},
) {
  const [near, setNear] = useState(false)
  const nearRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      nearRef.current = false
      setNear(false)
      return
    }
    let raf = 0
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return
        const r = el.getBoundingClientRect()
        // 点到矩形的最近距离（在矩形内为 0）
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right)
        const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom)
        const dist = Math.hypot(dx, dy)
        const next = nearRef.current ? dist < exit : dist < enter
        if (next !== nearRef.current) {
          nearRef.current = next
          setNear(next)
        }
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [ref, enter, exit, enabled])

  return near
}
