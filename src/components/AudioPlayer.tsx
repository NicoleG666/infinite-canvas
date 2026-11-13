import { useEffect, useRef, useState } from 'react'

// 波形基础高度：播放时在此基础上做缩放律动
const WAVE_BARS = [10, 22, 34, 18, 38, 26, 14, 30, 12]

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// 音频节点：上方律动波形 + 中间文件名 + 下方液态玻璃控制栏
export default function AudioPlayer({ src, name }: { src: string; name?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [failed, setFailed] = useState(false)

  // 换音频源时重置播放状态
  useEffect(() => {
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
    setFailed(false)
  }, [src])

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) {
      el.play().catch(() => setFailed(true))
    } else {
      el.pause()
    }
  }

  const seek = (value: number) => {
    setCurrent(value)
    const el = audioRef.current
    if (el) el.currentTime = value
  }

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0

  return (
    <div className="audio-node">
      {/* 波形：播放中由 CSS 驱动不规则律动 */}
      <div className={`audio-wave ${playing ? 'is-playing' : ''}`} aria-hidden="true">
        {WAVE_BARS.map((h, i) => (
          <span key={i} className="audio-bar" style={{ height: h }} />
        ))}
      </div>

      {name && <AudioName text={name} />}

      <div className="audio-dock">
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => {
            setPlaying(true)
            setFailed(false)
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setCurrent(0)
          }}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
          onError={() => setFailed(true)}
        />

        <button
          type="button"
          className="audio-play"
          title={playing ? '暂停' : '播放'}
          aria-label={playing ? '暂停' : '播放'}
          onClick={togglePlay}
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>

        <input
          type="range"
          className="audio-seek"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(current, duration || 0)}
          disabled={!duration}
          aria-label="播放进度"
          onChange={(e) => seek(Number(e.target.value))}
          style={{ '--audio-progress': `${progress}%` } as React.CSSProperties}
        />

        <span className="audio-time">
          {fmtTime(current)} / {fmtTime(duration)}
        </span>
      </div>

      {failed && <span className="audio-error">音频无法播放</span>}
    </div>
  )
}

// 文件名展示：放得下就居中显示，超长时用双份文本做无缝横向滚动
function AudioName({ text }: { text: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [scrolling, setScrolling] = useState(false)
  const [duration, setDuration] = useState(10)

  useEffect(() => {
    const box = boxRef.current
    const measure = measureRef.current
    if (!box || !measure) return
    const update = () => {
      // 用隐藏的单份文本量出真实宽度，再与容器宽度比较（节点缩放后重新判断）
      const width = measure.getBoundingClientRect().width
      const overflow = width > box.clientWidth + 1
      setScrolling(overflow)
      // 约 32px/s 的匀速滚动，过短的文件名也至少 6s，避免忽快忽慢
      if (overflow) setDuration(Math.max(6, Math.round(width / 32)))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(box)
    return () => observer.disconnect()
  }, [text])

  return (
    <div ref={boxRef} className={`audio-name ${scrolling ? 'is-scrolling' : ''}`} title={text}>
      <span ref={measureRef} className="audio-name-measure" aria-hidden="true">
        {text}
      </span>
      {scrolling ? (
        <span
          className="audio-name-track"
          style={{ '--marquee-duration': `${duration}s` } as React.CSSProperties}
        >
          <span>{text}</span>
          <span aria-hidden="true">{text}</span>
        </span>
      ) : (
        <span className="audio-name-static">{text}</span>
      )}
    </div>
  )
}

function PlayGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2.6 1.7 8.3 5 2.6 8.3V1.7Z" fill="currentColor" />
    </svg>
  )
}

function PauseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="2.4" y="1.9" width="1.9" height="6.2" rx="0.6" fill="currentColor" />
      <rect x="5.7" y="1.9" width="1.9" height="6.2" rx="0.6" fill="currentColor" />
    </svg>
  )
}
