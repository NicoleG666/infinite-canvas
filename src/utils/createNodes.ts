import { useCanvasStore } from '../store/canvasStore'
import { getFile, saveFile } from './idb'
import { measureMedia } from '../components/NodeCard'
import type { Asset, NodeType } from '../types'

// 按文件 mime 推断节点类型；其他文件统一当作文本读取
export function nodeTypeFromFile(file: File): NodeType {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'text'
}

// 从本地文件批量创建节点（菜单「本地上传」使用）
export async function createNodesFromFiles(files: File[], at: { x: number; y: number }) {
  let offset = 0
  for (const file of files) {
    const type = nodeTypeFromFile(file)
    if (type === 'text') {
      const text = await file.text().catch(() => file.name)
      useCanvasStore.getState().addNode({
        type,
        x: at.x + offset,
        y: at.y + offset,
        text: text.slice(0, 2000),
      })
    } else {
      const key = await saveFile(file).catch(() => undefined)
      const url = URL.createObjectURL(file)
      const dim = await measureMedia(file.type, url)
      useCanvasStore.getState().addNode({
        type,
        x: at.x + offset,
        y: at.y + offset,
        width: dim?.width ?? 320,
        height: dim?.height ?? 220,
        url,
        fileKey: key,
        // 音频节点在卡片内展示原始文件名
        ...(type === 'audio' ? { fileName: file.name } : {}),
      })
    }
    offset += 32
  }
}

// 从资产库插入一个媒体资产到画布；文件类资产暂不支持
export async function insertAssetAt(asset: Asset, at: { x: number; y: number }): Promise<boolean> {
  if (asset.type === 'file') return false
  const blob = await getFile(asset.fileKey).catch(() => null)
  if (!blob) return false
  const type: NodeType = asset.type === 'image' ? 'image' : asset.type === 'video' ? 'video' : 'audio'
  const url = URL.createObjectURL(blob)
  const dim = await measureMedia(asset.mime, url)
  useCanvasStore.getState().addNode({
    type,
    x: at.x,
    y: at.y,
    width: dim?.width ?? 320,
    height: dim?.height ?? 220,
    url,
    fileKey: asset.fileKey,
    // 音频节点在卡片内展示资产名称（即原始文件名）
    ...(type === 'audio' ? { fileName: asset.name } : {}),
  })
  return true
}
