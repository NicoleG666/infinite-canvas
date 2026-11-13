import { useEffect, useRef } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { anchorOf } from '../utils/geometry'

const MAP_W = 232
const MAP_H = 128
const PAD = 10

/**
 * 左下角小地图：点击按钮在上方弹出画布缩略图。
 * 节点按内容包围盒等比缩放（灰色块），连线用细线示意，
 * 浅色矩形表示当前视口范围。
 */
export default function MiniMap() {
  const nodes = useCanvasStore((s) => s.nodes)
  const groups = useCanvasStore((s) => s.groups)
  const connections = useCanvasStore((s) => s.connections)
  const viewport = useCanvasStore((s) => s.viewport)
  const setViewport = useCanvasStore((s) => s.setViewport)
  const activeMenu = useCanvasStore((s) => s.activeMenu)
  const setActiveMenu = useCanvasStore((s) => s.setActiveMenu)
  const open = activeMenu === 'minimap'
  const mapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
    vpScale: number
  } | null>(null)

  // 点击小地图以外的地方关闭；不用遮罩，保证滚轮缩放仍能实时更新小地图
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.minimap-wrap')) setActiveMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, setActiveMenu])

  const list = Object.values(nodes)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  list.forEach((n) => {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  })

  const contentW = Math.max(1, maxX - minX)
  const contentH = Math.max(1, maxY - minY)
  const scale = Math.min((MAP_W - PAD * 2) / contentW, (MAP_H - PAD * 2) / contentH)
  const offsetX = (MAP_W - contentW * scale) / 2
  const offsetY = (MAP_H - contentH * scale) / 2
  const mapX = (x: number) => offsetX + (x - minX) * scale
  const mapY = (y: number) => offsetY + (y - minY) * scale

  // 当前视口在缩略图上的位置
  const viewRect = {
    left: mapX(-viewport.x / viewport.scale),
    top: mapY(-viewport.y / viewport.scale),
    width: (window.innerWidth / viewport.scale) * scale,
    height: (window.innerHeight / viewport.scale) * scale,
  }

  // 在小地图上按下：视口框内直接拖动，框外点击则先把视口中心跳过去，再继续拖动
  const onMapMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || list.length === 0) return
    const el = mapRef.current
    if (!el) return
    e.preventDefault()

    const rect = el.getBoundingClientRect()
    const worldX = minX + (e.clientX - rect.left - offsetX) / scale
    const worldY = minY + (e.clientY - rect.top - offsetY) / scale
    const vpScale = viewport.scale
    const vwWorld = window.innerWidth / vpScale
    const vhWorld = window.innerHeight / vpScale
    const originX0 = -viewport.x / vpScale
    const originY0 = -viewport.y / vpScale
    const insideView =
      worldX >= originX0 &&
      worldX <= originX0 + vwWorld &&
      worldY >= originY0 &&
      worldY <= originY0 + vhWorld

    let originX = originX0
    let originY = originY0
    if (!insideView) {
      // 点击视口框外：视口中心对准点击位置
      originX = worldX - vwWorld / 2
      originY = worldY - vhWorld / 2
      setViewport({ x: -originX * vpScale, y: -originY * vpScale })
    }

    dragRef.current = { startX: e.clientX, startY: e.clientY, originX, originY, vpScale }
    const onMove = (ev: MouseEvent) => {
      const s = dragRef.current
      if (!s) return
      const nextX = s.originX + (ev.clientX - s.startX) / scale
      const nextY = s.originY + (ev.clientY - s.startY) / scale
      setViewport({ x: -nextX * s.vpScale, y: -nextY * s.vpScale })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className={`minimap-wrap ${open ? 'is-open' : ''}`} data-tip="画布小地图">
      <button
        type="button"
        className={`minimap-btn ${open ? 'is-open' : ''}`}
        aria-label="画布小地图"
        onClick={() => setActiveMenu(open ? null : 'minimap')}
      >
        <MinimapIcon />
      </button>

      {open && (
        <>
          <div className="minimap-pop">
            <div
              ref={mapRef}
              className="minimap-map"
              style={{ width: MAP_W, height: MAP_H }}
              onMouseDown={onMapMouseDown}
            >
              {list.length === 0 ? (
                <div className="minimap-empty">画布暂无节点</div>
              ) : (
                <>
                  <svg className="minimap-lines" width={MAP_W} height={MAP_H}>
                    {Object.values(connections).map((c) => {
                      const a = anchorOf(c.sourceId, 'right', nodes, groups)
                      const b = anchorOf(c.targetId, 'left', nodes, groups)
                      if (!a || !b) return null
                      return (
                        <line
                          key={c.id}
                          x1={mapX(a.x)}
                          y1={mapY(a.y)}
                          x2={mapX(b.x)}
                          y2={mapY(b.y)}
                          stroke="rgba(168, 182, 198, 0.45)"
                          strokeWidth="1"
                          strokeLinecap="round"
                        />
                      )
                    })}
                  </svg>

                  {list.map((n) => (
                    <span
                      key={n.id}
                      className="minimap-node"
                      style={{
                        left: mapX(n.x),
                        top: mapY(n.y),
                        width: Math.max(3, n.width * scale),
                        height: Math.max(3, n.height * scale),
                      }}
                    />
                  ))}

                  <span className="minimap-view" style={viewRect} />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MinimapIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M8 4.7c-1.2 0-2.15.96-2.15 2.15 0 1.55 2.15 3.45 2.15 3.45s2.15-1.9 2.15-3.45C10.15 5.66 9.2 4.7 8 4.7Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="6.9" r="0.8" fill="currentColor" />
    </svg>
  )
}
