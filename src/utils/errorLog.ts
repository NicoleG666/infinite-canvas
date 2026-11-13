// 轻量本地错误记录
// 目的：出问题后用户能在本机查到发生了什么，不依赖外网上报。
// 日志只写入 localStorage，最多保留 50 条，超出后丢弃最旧的记录。

export type ErrorSource = 'react' | 'window' | 'promise' | 'storage' | 'manual'

export interface ErrorLogEntry {
  time: number
  source: ErrorSource
  message: string
  detail?: string
  url?: string
}

const STORAGE_KEY = 'ic:error-log:v1'
const MAX_ENTRIES = 50

// 把任意抛出物转成可读文案
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

function readEntries(): ErrorLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ErrorLogEntry =>
        !!item && typeof item.time === 'number' && typeof item.message === 'string',
    )
  } catch {
    return []
  }
}

export function recordError(entry: Omit<ErrorLogEntry, 'time'>): void {
  try {
    const list = readEntries()
    list.push({ ...entry, time: Date.now() })
    while (list.length > MAX_ENTRIES) list.shift()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // localStorage 不可用（隐私模式 / 配额满）时静默跳过，不影响主流程
  }
}

export function listErrorLogs(): ErrorLogEntry[] {
  return readEntries().sort((a, b) => b.time - a.time)
}

export function errorLogCount(): number {
  return readEntries().length
}

export function clearErrorLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}

// 生成可直接粘贴给开发者 / 客服的诊断文本
export function formatErrorLogs(): string {
  const list = listErrorLogs()
  const head = [
    `无限画布诊断信息`,
    `时间：${new Date().toISOString()}`,
    `地址：${window.location.href}`,
    `UA：${navigator.userAgent}`,
    `错误数：${list.length}`,
    '',
  ]
  const body = list.map((e) => {
    const time = new Date(e.time).toLocaleString()
    const lines = [`[${time}] (${e.source}) ${e.message}`]
    if (e.url) lines.push(`  位置：${e.url}`)
    if (e.detail) lines.push(`  详情：${e.detail.split('\n').slice(0, 8).join('\n  ')}`)
    return lines.join('\n')
  })
  return [...head, ...body].join('\n')
}

// 安装全局兜底监听，返回卸载函数
export function installGlobalErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => {
    recordError({
      source: 'window',
      message: event.message || '未知脚本错误',
      detail: event.error instanceof Error ? event.error.stack : undefined,
      url: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
    })
  }

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason
    recordError({
      source: 'promise',
      message: describeError(reason) || '未处理的 Promise 拒绝',
      detail: reason instanceof Error ? reason.stack : undefined,
    })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
