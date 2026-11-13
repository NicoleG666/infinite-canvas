import { useMemo } from 'react'
import { Shape } from 'react-konva'
import type { Viewport } from '../types'

interface Props {
  viewport: Viewport
  width: number
  height: number
}

// 点状网格：根据可视区域绘制点，避免性能问题
export default function GridBackground({ viewport, width, height }: Props) {
  const spacing = 40

  // 可视区域的世界坐标范围
  const visible = useMemo(() => {
    const left = -viewport.x / viewport.scale
    const top = -viewport.y / viewport.scale
    const right = (width - viewport.x) / viewport.scale
    const bottom = (height - viewport.y) / viewport.scale
    return { left, top, right, bottom }
  }, [viewport, width, height])

  return (
    <Shape
      listening={false}
      sceneFunc={(ctx, shape) => {
        ctx.beginPath()
        const startX = Math.floor(visible.left / spacing) * spacing
        const startY = Math.floor(visible.top / spacing) * spacing
        for (let x = startX; x <= visible.right; x += spacing) {
          for (let y = startY; y <= visible.bottom; y += spacing) {
            ctx.moveTo(x, y)
            ctx.arc(x, y, 1.3, 0, Math.PI * 2)
          }
        }
        ctx.fillStyle = 'rgba(255,255,255,0.10)'
        ctx.fill()
        ;(ctx as any).fillStrokeShape(shape)
      }}
    />
  )
}
