import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { installGlobalErrorHandlers } from './utils/errorLog'
import './index.css'

// 先装全局错误兜底，保证启动阶段的异常也能被记录
installGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
