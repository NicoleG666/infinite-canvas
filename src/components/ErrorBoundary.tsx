import { Component, type ErrorInfo, type ReactNode } from 'react'
import {
  clearErrorLogs,
  formatErrorLogs,
  listErrorLogs,
  recordError,
} from '../utils/errorLog'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  notice: string | null
}

// 兜底 UI：避免任一组件抛错导致整页白屏，并给用户可执行的恢复路径
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, notice: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordError({
      source: 'react',
      message: error.message || error.name || '渲染错误',
      detail: `${error.stack ?? ''}\n组件栈：${info.componentStack ?? ''}`,
    })
  }

  private copyDiagnostics = async () => {
    const text = formatErrorLogs()
    try {
      await navigator.clipboard.writeText(text)
      this.setState({ notice: '诊断信息已复制，可粘贴发送给开发者' })
    } catch {
      this.setState({ notice: '复制失败，请在开发者工具中查看控制台错误' })
    }
  }

  private clearLogs = () => {
    clearErrorLogs()
    this.setState({ notice: '错误记录已清空' })
  }

  render() {
    const { error, notice } = this.state
    if (!error) return this.props.children

    const recent = listErrorLogs().slice(0, 3)

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#131314',
          color: '#e8e8ea',
          fontFamily: 'inherit',
          zIndex: 9999,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 520,
            padding: '26px 26px 22px',
            borderRadius: 18,
            background: 'rgba(30,30,32,0.98)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 28px 70px -22px rgba(0,0,0,0.95)',
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
            页面遇到问题，已中断本次渲染
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.75, color: 'rgba(232,232,234,0.7)' }}>
            已保存的画布数据仍保留在本地浏览器中。建议先复制诊断信息，再重新加载页面；
            如果反复出现，请把诊断信息反馈给开发者。
          </div>

          <div
            style={{
              marginTop: 14,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              fontSize: 12,
              color: '#ff9b9b',
              wordBreak: 'break-word',
            }}
          >
            {error.message || String(error)}
          </div>

          {recent.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.7, color: 'rgba(232,232,234,0.5)' }}>
              {recent.map((item) => (
                <div key={`${item.time}-${item.message}`}>
                  {new Date(item.time).toLocaleTimeString()} · {item.message}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                borderRadius: 9,
                border: 'none',
                background: '#58d8ff',
                color: '#06202a',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              重新加载
            </button>
            <button
              onClick={this.copyDiagnostics}
              style={{
                padding: '8px 14px',
                borderRadius: 9,
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.05)',
                color: '#e8e8ea',
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              复制诊断信息
            </button>
            <button
              onClick={this.clearLogs}
              style={{
                padding: '8px 14px',
                borderRadius: 9,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'transparent',
                color: 'rgba(232,232,234,0.65)',
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              清空错误记录
            </button>
          </div>

          {notice && (
            <div style={{ marginTop: 12, fontSize: 11.5, color: 'rgba(88,216,255,0.85)' }}>
              {notice}
            </div>
          )}
        </div>
      </div>
    )
  }
}
