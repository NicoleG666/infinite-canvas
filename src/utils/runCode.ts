// 代码块运行：JS / Python 在 Web Worker 沙箱执行，HTML 交给沙箱 iframe 预览

export type CodeMode = 'js' | 'python' | 'html'

export interface RunLog {
  level: 'log' | 'info' | 'warn' | 'error' | 'result'
  text: string
}

export interface RunResult {
  ok: boolean
  logs: RunLog[]
  error?: string
  timedOut?: boolean
  mode: CodeMode
}

// JS 执行上限：超时直接终止 Worker，避免死循环卡住页面
const RUN_TIMEOUT = 3000

// 以 HTML 标签开头的代码视为 HTML，其余按 JS 执行
export function detectCodeMode(code: string): CodeMode {
  const t = code.trim()
  if (!t) return 'js'
  if (/^<!doctype\s+html/i.test(t) || /^<html[\s>]/i.test(t)) return 'html'
  if (
    /^<(body|div|span|script|style|p|h[1-6]|a|button|canvas|svg|template|section|main|header|footer|ul|ol|li|table|form|input|textarea|meta|title)[\s>]/i.test(
      t,
    )
  ) {
    return 'html'
  }
  return 'js'
}

const WORKER_SRC = `
self.onmessage = async (event) => {
  const logs = []
  const seen = new WeakSet()

  const format = (value) => {
    if (typeof value === 'string') return value
    if (typeof value === 'function') return String(value)
    try {
      const text = JSON.stringify(value, (key, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]'
          seen.add(val)
        }
        return val
      })
      return text === undefined ? String(value) : text
    } catch (e) {
      return String(value)
    }
  }

  // 注意不要返回 push 的数组长度，否则 eval 会把它当成表达式结果
  const push = (level) => (...args) => {
    logs.push({ level, text: args.map(format).join(' ') })
  }
  console.log = push('log')
  console.info = push('info')
  console.warn = push('warn')
  console.error = push('error')

  try {
    let value
    try {
      // 直接 eval 能拿到最后一条表达式的值（脚本式用法更直观）
      value = eval(event.data)
    } catch (err) {
      // 语法错误可能来自顶层 await，回退到 AsyncFunction 再执行一次
      if (!(err && err.name === 'SyntaxError')) throw err
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
      value = await new AsyncFunction(event.data)()
    }
    if (value !== undefined) logs.push({ level: 'result', text: format(value) })
    // 留一点时间收集 0~100ms 的异步 console 输出
    setTimeout(() => self.postMessage({ ok: true, logs }), 120)
  } catch (err) {
    self.postMessage({ ok: false, logs, error: (err && err.stack) || String(err) })
  }
}
`

export function runJavaScript(code: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
    const worker = new Worker(url)
    let settled = false

    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      resolve(result)
    }

    const timer = window.setTimeout(() => {
      finish({ ok: false, logs: [], error: '执行超时（3 秒），已强制终止', timedOut: true, mode: 'js' })
    }, RUN_TIMEOUT)

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data as { ok: boolean; logs: RunLog[]; error?: string }
      finish({ ok: data.ok, logs: data.logs ?? [], error: data.error, mode: 'js' })
    }
    worker.onerror = (e) => {
      finish({ ok: false, logs: [], error: e.message || '脚本执行失败', mode: 'js' })
    }

    worker.postMessage(code)
  })
}

const PYTHON_TIMEOUT = 8000

// Python 在独立 Worker 里用 Skulpt 解释执行（含首次加载解释器的时间）
export function runPython(code: string): Promise<RunResult> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('skulpt-worker.js', window.location.href))
    } catch (e) {
      resolve({ ok: false, logs: [], error: e instanceof Error ? e.message : String(e), mode: 'python' })
      return
    }
    let settled = false

    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      worker.terminate()
      resolve(result)
    }

    const timer = window.setTimeout(() => {
      finish({ ok: false, logs: [], error: '执行超时（8 秒），已强制终止', timedOut: true, mode: 'python' })
    }, PYTHON_TIMEOUT)

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data as { ok: boolean; logs: RunLog[]; error?: string }
      finish({ ok: data.ok, logs: data.logs ?? [], error: data.error, mode: 'python' })
    }
    worker.onerror = (e) => {
      finish({ ok: false, logs: [], error: e.message || 'Python 解释器加载失败', mode: 'python' })
    }

    worker.postMessage(code)
  })
}
