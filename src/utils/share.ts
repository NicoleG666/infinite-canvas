// 画布分享：链接编解码 + 分享卡片绘制
// 纯前端方案：画布结构压缩后放进 URL hash，打开链接即导入为新画布；
// 媒体文件（图片 / 视频 / 音频）的 blob 无法随链接传递，只保留占位节点。
import type { CanvasNode, CanvasGroup, Connection, Viewport } from '../types'

export interface SharePayload {
  v: 1
  name: string
  author: string
  nodes: CanvasNode[]
  connections: Connection[]
  groups: CanvasGroup[]
  viewport: Viewport
  // 未随链接传输的媒体文件数量
  mediaCount: number
}

const MEDIA_TYPES: CanvasNode['type'][] = ['image', 'video', 'audio']

export function createSharePayload(
  doc: {
    name: string
    nodes: CanvasNode[]
    connections: Connection[]
    groups: CanvasGroup[]
    viewport: Viewport
  },
  author: string,
): SharePayload {
  let mediaCount = 0
  const nodes = doc.nodes.map((n) => {
    if (!MEDIA_TYPES.includes(n.type)) return n
    mediaCount++
    // 运行时 objectURL 与本地 blob key 都不可分享，仅保留位置 / 尺寸占位
    const { url, fileKey, fileName, ...rest } = n
    return rest
  })
  return {
    v: 1,
    name: doc.name,
    author,
    nodes,
    connections: doc.connections,
    groups: doc.groups,
    viewport: doc.viewport,
    mediaCount,
  }
}

/* ---------------- base64url ---------------- */

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/* ---------------- 编解码 ---------------- */

// 编码结果带模式前缀：1 = deflate-raw 压缩，0 = 明文
export async function encodeShareToken(payload: SharePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      const buf = await new Response(stream).arrayBuffer()
      return `1.${bytesToBase64Url(new Uint8Array(buf))}`
    } catch {
      // 压缩失败时退回明文，保证分享可用
    }
  }
  return `0.${bytesToBase64Url(bytes)}`
}

export async function decodeShareToken(token: string): Promise<SharePayload | null> {
  try {
    const dot = token.indexOf('.')
    if (dot < 0) return null
    const mode = token.slice(0, dot)
    let bytes = base64UrlToBytes(token.slice(dot + 1))
    if (mode === '1') {
      if (typeof DecompressionStream === 'undefined') return null
      // 复制到独立 ArrayBuffer，兼容裁剪过的 Uint8Array 类型定义
      const raw = new ArrayBuffer(bytes.byteLength)
      new Uint8Array(raw).set(bytes)
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    } else if (mode !== '0') {
      return null
    }
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as SharePayload
    if (!payload || payload.v !== 1 || !Array.isArray(payload.nodes)) return null
    return payload
  } catch {
    return null
  }
}

// 从地址栏读取分享 token（只在 #share= 开头时有效）
export function readShareTokenFromLocation(): string | null {
  const hash = window.location.hash
  if (!hash.startsWith('#share=')) return null
  return hash.slice('#share='.length)
}

// 线上站点地址：本地开发时生成的分享链接也指向它，避免发出只能在本机打开的 localhost 链接
const PUBLIC_ORIGIN = 'https://37jg3fszh5ayb212c06.traesite.cn'
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)$/

// 当前是否在本地/内网环境打开
export function isLocalShareOrigin(): boolean {
  return LOCAL_HOST.test(window.location.hostname)
}

export function buildShareUrl(token: string): string {
  const origin = isLocalShareOrigin() ? PUBLIC_ORIGIN : window.location.origin
  // 固定指向画布页，避免在根路径（介绍页）里生成分享链接
  return `${origin}/app.html#share=${token}`
}

/* ---------------- 分享卡片（Canvas 2D） ---------------- */

const CARD_W = 640
const CARD_H = 360
const FONT_STACK = "'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', system-ui, sans-serif"

// 节点类型 → 缩略图配色（低饱和，贴近深色卡片）
const NODE_COLORS: Record<CanvasNode['type'], string> = {
  text: 'rgba(232, 238, 246, 0.34)',
  image: 'rgba(125, 211, 252, 0.5)',
  video: 'rgba(196, 181, 253, 0.5)',
  audio: 'rgba(252, 211, 77, 0.45)',
  link: 'rgba(88, 216, 255, 0.4)',
  code: 'rgba(156, 224, 168, 0.45)',
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// 单行 / 两行标题换行，超出两行时末尾加省略号
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const chars = Array.from(text)
  const lines: string[] = []
  let line = ''
  for (let i = 0; i < chars.length; i++) {
    const test = line + chars[i]
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line)
      line = ''
      if (lines.length === maxLines) {
        lines[maxLines - 1] += '…'
        return lines
      }
    }
    line += chars[i]
  }
  if (line) lines.push(line)
  return lines.slice(0, maxLines)
}

// 在卡片右侧画布布缩略图：可见内容等比缩放，连线用细线示意
function drawThumbnail(
  ctx: CanvasRenderingContext2D,
  payload: SharePayload,
  x: number,
  y: number,
  size: number,
) {
  ctx.save()
  roundRect(ctx, x, y, size, size, 14)
  ctx.clip()

  // 缩略图底：比卡片更深的纯色
  ctx.fillStyle = '#0b0d12'
  ctx.fillRect(x, y, size, size)
  // 细网格，避免空白区域过于单调
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)'
  ctx.lineWidth = 1
  for (let g = 16; g < size; g += 16) {
    ctx.beginPath()
    ctx.moveTo(x + g, y)
    ctx.lineTo(x + g, y + size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, y + g)
    ctx.lineTo(x + size, y + g)
    ctx.stroke()
  }

  const nodes = payload.nodes
  if (nodes.length === 0) {
    ctx.fillStyle = 'rgba(150, 162, 180, 0.6)'
    ctx.font = `400 13px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('空画布', x + size / 2, y + size / 2)
    ctx.restore()
    return
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  })
  const pad = 18
  const contentW = Math.max(1, maxX - minX)
  const contentH = Math.max(1, maxY - minY)
  const scale = Math.min((size - pad * 2) / contentW, (size - pad * 2) / contentH)
  const ox = x + (size - contentW * scale) / 2
  const oy = y + (size - contentH * scale) / 2
  const px = (v: number) => ox + (v - minX) * scale
  const py = (v: number) => oy + (v - minY) * scale
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  // 连线在节点下方
  ctx.strokeStyle = 'rgba(125, 211, 252, 0.3)'
  ctx.lineWidth = 1
  payload.connections.forEach((c) => {
    const a = nodeMap.get(c.sourceId)
    const b = nodeMap.get(c.targetId)
    if (!a || !b) return
    ctx.beginPath()
    ctx.moveTo(px(a.x + a.width / 2), py(a.y + a.height / 2))
    ctx.lineTo(px(b.x + b.width / 2), py(b.y + b.height / 2))
    ctx.stroke()
  })

  nodes.forEach((n) => {
    const w = Math.max(3, n.width * scale)
    const h = Math.max(3, n.height * scale)
    roundRect(ctx, px(n.x), py(n.y), w, h, Math.min(3, w / 2, h / 2))
    ctx.fillStyle = NODE_COLORS[n.type] ?? NODE_COLORS.text
    ctx.fill()
  })
  ctx.restore()

  // 圆角描边压在裁切层之上
  roundRect(ctx, x + 0.5, y + 0.5, size - 1, size - 1, 14)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 1
  ctx.stroke()
}

let logoPromise: Promise<HTMLImageElement | null> | null = null
// 品牌 logo 预加载；失败时回退为绘制的 ∞ 图形
function loadLogo(): Promise<HTMLImageElement | null> {
  if (!logoPromise) {
    logoPromise = new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = '/logo-infinity.png'
    })
  }
  return logoPromise
}

// 生成 B 站链接卡片风格的分享图（640×360，2x 清晰度）
export async function renderShareCard(payload: SharePayload): Promise<string> {
  const dpr = 2
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W * dpr
  canvas.height = CARD_H * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.scale(dpr, dpr)

  const P = 28

  // 卡片底：深色斜向渐变 + 细边
  roundRect(ctx, 1, 1, CARD_W - 2, CARD_H - 2, 20)
  const bg = ctx.createLinearGradient(0, 0, CARD_W, CARD_H)
  bg.addColorStop(0, '#262a32')
  bg.addColorStop(0.55, '#1a1d23')
  bg.addColorStop(1, '#121419')
  ctx.fillStyle = bg
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 1
  ctx.stroke()

  // 右下角品牌柔光
  ctx.save()
  roundRect(ctx, 1, 1, CARD_W - 2, CARD_H - 2, 20)
  ctx.clip()
  const glow = ctx.createRadialGradient(CARD_W - 40, CARD_H - 10, 8, CARD_W - 40, CARD_H - 10, 300)
  glow.addColorStop(0, 'rgba(88, 216, 255, 0.16)')
  glow.addColorStop(0.5, 'rgba(106, 92, 255, 0.06)')
  glow.addColorStop(1, 'rgba(88, 216, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // 顶部细高光
  const sheen = ctx.createLinearGradient(0, 0, CARD_W, 0)
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0)')
  sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0.16)')
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = sheen
  ctx.fillRect(P, 0.5, CARD_W - P * 2, 1)
  ctx.restore()

  // 右侧缩略图
  const THUMB = 136
  const thumbX = CARD_W - P - THUMB
  const thumbY = 30
  drawThumbnail(ctx, payload, thumbX, thumbY, THUMB)

  // 标题：最多两行
  const titleMaxW = thumbX - 22 - P
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#f2f6fb'
  ctx.font = `600 30px ${FONT_STACK}`
  const titleLines = wrapText(ctx, payload.name || '未命名画布', titleMaxW, 2)
  titleLines.forEach((line, i) => ctx.fillText(line, P, 30 + i * 40))

  // 作者与内容概览
  const infoY = 216
  ctx.fillStyle = '#9aa6b6'
  ctx.font = `400 15px ${FONT_STACK}`
  ctx.fillText(`UP主：${payload.author || '画布用户'}`, P, infoY)
  ctx.fillStyle = '#7d8797'
  ctx.font = `400 14px ${FONT_STACK}`
  ctx.fillText(
    `内容：${payload.nodes.length} 个节点 · ${payload.connections.length} 条连线`,
    P,
    infoY + 28,
  )

  // 底部品牌行
  const brandY = CARD_H - 50
  const logo = await loadLogo()
  if (logo) {
    roundRect(ctx, P, brandY, 26, 26, 8)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
    ctx.fill()
    ctx.save()
    roundRect(ctx, P, brandY, 26, 26, 8)
    ctx.clip()
    ctx.drawImage(logo, P, brandY, 26, 26)
    ctx.restore()
  } else {
    const lg = ctx.createLinearGradient(P, brandY, P + 26, brandY + 26)
    lg.addColorStop(0, '#6a5cff')
    lg.addColorStop(1, '#58d8ff')
    roundRect(ctx, P, brandY, 26, 26, 8)
    ctx.fillStyle = lg
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 17px ${FONT_STACK}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('∞', P + 13, brandY + 14)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
  }
  // 产品名与副标题统一用 middle 基线，垂直中心对齐 logo（brandY + 13）
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#e8eef6'
  ctx.font = `600 15px ${FONT_STACK}`
  ctx.fillText('无限画布', P + 36, brandY + 13)
  const brandW = ctx.measureText('无限画布').width
  ctx.fillStyle = '#5d6878'
  ctx.font = `400 12px ${FONT_STACK}`
  ctx.fillText('本地无限画布笔记', P + 36 + brandW + 10, brandY + 13)
  ctx.textBaseline = 'top'

  return canvas.toDataURL('image/png')
}

export function downloadCardImage(dataUrl: string, name: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `${name || '画布'}-分享卡片.png`
  a.click()
}
