import { useEffect, useState } from 'react'
import type { Asset, AssetType } from '../types'
import { listAssets } from '../utils/idb'
import { insertAssetAt } from '../utils/createNodes'
import { AudioIcon, ImageIcon, VideoIcon } from './NodeTypeIcons'

interface Props {
  worldX: number
  worldY: number
  onDone: () => void
  onBack?: () => void
}

const ASSET_LABEL: Record<AssetType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  file: '文件',
}

// 菜单里的资产选择器：只展示可放入画布的图片 / 视频 / 音频，点一项直接插到画布
export default function AssetPicker({ worldX, worldY, onDone, onBack }: Props) {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listAssets()
      .then((list) => {
        if (!cancelled) setAssets(list.filter((a) => a.type !== 'file'))
      })
      .catch(() => {
        if (!cancelled) setAssets([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="asset-pick">
      {assets === null && <div className="asset-pick-empty">正在加载资产…</div>}
      {assets !== null && assets.length === 0 && (
        <div className="asset-pick-empty">资产库暂无图片 / 视频 / 音频</div>
      )}
      {assets !== null && assets.length > 0 && (
        <div className="asset-pick-list">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="asset-pick-item"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(asset.id)
                const ok = await insertAssetAt(asset, { x: worldX, y: worldY })
                if (ok) onDone()
                else setBusy(null)
              }}
            >
              <span className="asset-pick-icon">
                {asset.type === 'image' ? <ImageIcon /> : asset.type === 'video' ? <VideoIcon /> : <AudioIcon />}
              </span>
              <span className="asset-pick-name">{asset.name}</span>
              <span className="asset-pick-type">{busy === asset.id ? '添加中…' : ASSET_LABEL[asset.type]}</span>
            </button>
          ))}
        </div>
      )}
      {onBack && (
        <button type="button" className="asset-pick-back" onClick={onBack}>
          返回节点列表
        </button>
      )}
    </div>
  )
}
