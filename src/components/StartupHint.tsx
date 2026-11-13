/**
 * 空画布启动提示：画布上没有任何节点时居中显示「双击画布 创建节点」。
 * 纯展示层，不接收鼠标事件，也不随视口缩放。
 */
export default function StartupHint() {
  return (
    <div className="startup-hint" aria-hidden="true">
      <div className="startup-hint-row">
        <span className="startup-hint-text">双击画布</span>

        <span className="startup-tap">
          <span className="hint-ripple">
            <span className="hint-ring" />
            <span className="hint-ring" />
            <span className="hint-ring" />
          </span>
          <svg className="hint-cursor" viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient
                id="hintCursorFill"
                x1="4"
                y1="4"
                x2="20"
                y2="20"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stopColor="#eafbff" />
                <stop offset="0.42" stopColor="#58d8ff" />
                <stop offset="1" stopColor="#2f6fe4" />
              </linearGradient>
            </defs>
            <g transform="rotate(20 12 12)">
              <path
                d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
                fill="url(#hintCursorFill)"
                stroke="#f2f8ff"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </g>
          </svg>
        </span>

        <span className="startup-hint-text">创建节点</span>
      </div>
    </div>
  )
}
