// 本地用户资料：默认资料、头像预设、成长等级
import type { UserProfile } from '../types'

// 头像渐变预设（与大厂账号卡片一致的低饱和霓虹渐变）
export const AVATAR_STYLES = [
  { from: '#6a5cff', to: '#58d8ff' },
  { from: '#ff7a59', to: '#ffd166' },
  { from: '#2dd4bf', to: '#60a5fa' },
  { from: '#f472b6', to: '#a78bfa' },
  { from: '#34d399', to: '#a3e635' },
  { from: '#fbbf24', to: '#f97316' },
]

// 头像文字：取昵称首个字符，中文取第一个字
export function avatarInitial(nickname: string): string {
  const chars = Array.from(nickname.trim())
  return chars[0] ?? '画'
}

// 活跃度 → 成长等级：画布 / 节点 / 连线加权
export const LEVEL_STEPS = [0, 40, 120, 260, 480]
const LEVEL_NAMES = ['入门', '进阶', '熟练', '专家', '大师']

export function levelOf(xp: number): { level: number; name: string; xp: number; nextAt: number | null } {
  let idx = 0
  for (let i = 0; i < LEVEL_STEPS.length; i++) {
    if (xp >= LEVEL_STEPS[i]) idx = i
  }
  return {
    level: idx + 1,
    name: LEVEL_NAMES[idx],
    xp,
    nextAt: idx + 1 < LEVEL_STEPS.length ? LEVEL_STEPS[idx + 1] : null,
  }
}

function randomBlock(len: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = new Uint8Array(len)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf)
  } else {
    for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join('')
}

// 首次启动生成默认资料
export function createUserProfile(): UserProfile {
  return {
    id: `IC-${randomBlock(4)}-${randomBlock(4)}`,
    nickname: '画布用户',
    avatarIndex: 0,
    plan: 'free',
    createdAt: Date.now(),
  }
}
