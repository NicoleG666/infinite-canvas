/* Python 代码块运行器：在 Worker 里用 Skulpt 解释执行，避免阻塞主线程 */
const base = new URL('.', self.location.href).href
importScripts(base + 'skulpt/skulpt.min.js', base + 'skulpt/skulpt-stdlib.js')

self.onmessage = (event) => {
  const code = String(event.data || '')
  const logs = []
  let buffer = ''

  const flush = () => {
    if (!buffer) return
    logs.push({ level: 'log', text: buffer })
    buffer = ''
  }

  const readFile = (path) => {
    if (!Sk.builtinFiles || !Sk.builtinFiles.files[path]) {
      throw new Error("File not found: '" + path + "'")
    }
    return Sk.builtinFiles.files[path]
  }

  Sk.configure({
    output: (text) => {
      // Skulpt 按片段输出，这里按换行聚合，保证一行一条日志
      buffer += text
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) logs.push({ level: 'log', text: line })
    },
    read: readFile,
    __future__: Sk.python3,
  })

  try {
    Sk.importMainWithBody('<stdin>', false, code, true)
    flush()
    self.postMessage({ ok: true, logs })
  } catch (err) {
    flush()
    const text =
      typeof err === 'string'
        ? err
        : err && typeof err.toString === 'function' && err.toString() !== '[object Object]'
          ? err.toString()
          : String(err)
    self.postMessage({ ok: false, logs, error: text })
  }
}
