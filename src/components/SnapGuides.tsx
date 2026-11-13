import { useCanvasStore } from '../store/canvasStore'

/**
 * 网格吸附参考线：世界坐标 → 屏幕坐标后绘制固定定位的虚线，
 * 不受画布缩放影响，也不会拦截鼠标事件。
 */
export default function SnapGuides() {
  const guides = useCanvasStore((s) => s.snapGuides)
  const viewport = useCanvasStore((s) => s.viewport)
  if (guides.length === 0) return null

  return (
    <div className="snap-guides" aria-hidden="true">
      {guides.map((g, i) => {
        if (g.axis === 'x') {
          return (
            <span
              key={`x-${i}`}
              className="snap-guide snap-guide-v"
              style={{
                left: g.position * viewport.scale + viewport.x,
                top: g.start * viewport.scale + viewport.y,
                height: Math.max(0, (g.end - g.start) * viewport.scale),
              }}
            />
          )
        }
        return (
          <span
            key={`y-${i}`}
            className="snap-guide snap-guide-h"
            style={{
              top: g.position * viewport.scale + viewport.y,
              left: g.start * viewport.scale + viewport.x,
              width: Math.max(0, (g.end - g.start) * viewport.scale),
            }}
          />
        )
      })}
    </div>
  )
}
