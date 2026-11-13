import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import type { CodeMode } from './runCode'

// 代码模式 → Prism 语言名：Prism 用 markup 表示 HTML
const LANG_MAP: Record<CodeMode, string> = {
  js: 'javascript',
  python: 'python',
  html: 'markup',
}

/**
 * 把代码转成带 token 的 HTML 片段。
 * Prism.highlight 会对代码本身做转义，可直接用于 dangerouslySetInnerHTML。
 */
export function highlightCode(code: string, mode: CodeMode): string {
  const lang = LANG_MAP[mode]
  const grammar = Prism.languages[lang]
  if (!grammar) return escapeHtml(code)
  return Prism.highlight(code, grammar, lang)
}

function escapeHtml(code: string): string {
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
