import type { ReactNode } from 'react'
import type { NodeType } from '../types'

// 节点类型图标：底部 + 号菜单与右键「引用生成」菜单共用
const s = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' } as const
const st = { stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round' as const }

// 文本类型：三道横线，底行略短（与画布节点名称栏的图标一致）
export function TextIcon() {
  return (
    <svg {...s}>
      <path d="M2.6 3.8h10.8M2.6 8h10.4M2.6 12.2h8.8" {...st} />
    </svg>
  )
}

export function ImageIcon() {
  return (
    <svg {...s}>
      <rect x="2.2" y="3" width="11.6" height="10" rx="1.8" {...st} />
      <path d="M2.6 11l3-3 2.4 2.4 2-2 3.4 3.4" {...st} />
      <circle cx="5.9" cy="6.2" r="0.95" {...st} />
    </svg>
  )
}

export function VideoIcon() {
  return (
    <svg {...s}>
      <rect x="2.2" y="3.6" width="8" height="8.8" rx="1.6" {...st} />
      <path d="M10.4 7.2l3.1-1.7v5l-3.1-1.7" {...st} />
    </svg>
  )
}

export function AudioIcon() {
  return (
    <svg {...s}>
      <path d="M9.4 2.6l-4.2 1v5.9" {...st} />
      <circle cx="4.1" cy="11.4" r="1.5" {...st} />
      <circle cx="10.6" cy="10.4" r="1.5" {...st} />
      <path d="M9.4 2.6v7.8" {...st} />
    </svg>
  )
}

export function LinkIcon() {
  return (
    <svg {...s}>
      <path d="M6.4 9.6a2.6 2.6 0 000 3.7 2.6 2.6 0 003.7 0l1.3-1.3" {...st} />
      <path d="M9.6 6.4a2.6 2.6 0 000-3.7 2.6 2.6 0 00-3.7 0L4.6 4.0" {...st} />
    </svg>
  )
}

export function CodeIcon() {
  return (
    <svg {...s}>
      <path d="M5.8 4.6 2.6 8l3.2 3.4M10.2 4.6 13.4 8l-3.2 3.4" {...st} />
      <path d="M9.2 3.1 6.8 12.9" {...st} />
    </svg>
  )
}

export const NODE_TYPE_ITEMS: { type: NodeType; label: string; icon: ReactNode }[] = [
  { type: 'text', label: '文本', icon: <TextIcon /> },
  { type: 'image', label: '图片', icon: <ImageIcon /> },
  { type: 'video', label: '视频', icon: <VideoIcon /> },
  { type: 'audio', label: '音频', icon: <AudioIcon /> },
  { type: 'link', label: '链接', icon: <LinkIcon /> },
  { type: 'code', label: '代码', icon: <CodeIcon /> },
]
