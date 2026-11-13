// 首次打开时生成的「示例画布」：用一组节点把无限画布的主要能力演示出来，
// 让第一次访问的人不用看文档就知道这个工具能做什么。
import { saveFile } from './idb'
import { measureMedia } from '../components/NodeCard'
import type { CanvasDoc, CanvasGroup, CanvasNode, Connection } from '../types'

export const DEMO_DOC_NAME = '示例画布'

// 截图随应用一起发布，这里读一遍存进本地文件库，用来演示图片节点
const DEMO_IMAGE_SRC = './screenshot.png'

// 固定的节点 / 分组 ID，便于在这里直接写连线关系
const ID = {
  title: 'demo_title',
  text: 'demo_text',
  image: 'demo_image',
  code: 'demo_code',
  link: 'demo_link',
  groupA: 'demo_group_a',
  groupB: 'demo_group_b',
  data: 'demo_data',
  group: 'demo_group_frame',
} as const

interface DemoParts {
  nodes: CanvasNode[]
  connections: Connection[]
  groups: CanvasGroup[]
}

// 构造示例画布内容；媒体文件写入失败时自动退化为纯文本演示
async function buildParts(): Promise<DemoParts> {
  const now = Date.now()
  const nodes: CanvasNode[] = []
  const connections: Connection[] = []
  const groups: CanvasGroup[] = []

  const addNode = (node: Omit<CanvasNode, 'createdAt'>) => {
    nodes.push({ ...node, createdAt: now + nodes.length })
  }

  const connect = (sourceId: string, targetId: string) => {
    connections.push({
      id: `demo_conn_${connections.length + 1}`,
      sourceId,
      targetId,
      createdAt: now + connections.length,
    })
  }

  // ① 文本节点
  addNode({
    id: ID.text,
    type: 'text',
    x: 140,
    y: 330,
    width: 250,
    height: 170,
    name: '① 文本节点',
    tagColor: '#4d8dff',
    text: '双击卡片就能直接编辑。\n灵感、待办、段落都可以先扔在这里。',
    remark: '',
  })

  // ② 图片节点：把自带的界面截图存进 IndexedDB，演示媒体文件也留在本地
  let imageWidth = 420
  let imageHeight = 236
  let imageFileKey: string | undefined
  try {
    const res = await fetch(DEMO_IMAGE_SRC)
    if (res.ok) {
      const blob = await res.blob()
      imageFileKey = await saveFile(blob)
      const objectUrl = URL.createObjectURL(blob)
      const dim = await measureMedia(blob.type || 'image/png', objectUrl)
      URL.revokeObjectURL(objectUrl)
      if (dim) {
        imageWidth = dim.width
        imageHeight = dim.height
      }
    }
  } catch {
    imageFileKey = undefined
  }

  if (imageFileKey) {
    addNode({
      id: ID.image,
      type: 'image',
      x: 430,
      y: 330,
      width: imageWidth,
      height: imageHeight,
      name: '② 图片节点',
      fileKey: imageFileKey,
      fileName: 'screenshot.png',
      text: '',
    })
  }

  // ③ 代码节点：可以在沙箱里直接运行
  addNode({
    id: ID.code,
    type: 'code',
    x: 880,
    y: 330,
    width: 340,
    height: 200,
    name: '③ 代码节点',
    language: 'js',
    text: "// 点卡片上的「运行」试试\nconst squares = [1, 2, 3, 4, 5].map((n) => n * n)\nconsole.log('平方数：', squares.join(' · '))",
    remark: '备注：卡片右上角可以给节点写补充说明，不会影响正文。',
  })

  // ④ 链接节点
  addNode({
    id: ID.link,
    type: 'link',
    x: 1250,
    y: 330,
    width: 280,
    height: 140,
    name: '④ 链接节点',
    linkUrl: 'https://github.com/NicoleG666/infinite-canvas',
    text: '',
  })

  // ⑤ 分组：同一组的节点可以整体拖动，双击进入组内编辑
  addNode({
    id: ID.groupA,
    type: 'text',
    x: 140,
    y: 640,
    width: 250,
    height: 130,
    name: '分组 A',
    groupId: ID.group,
    text: '把相关的东西框成一组：\n选中多张卡片，点底部工具栏的「分组」。',
    remark: '',
  })
  addNode({
    id: ID.groupB,
    type: 'text',
    x: 430,
    y: 640,
    width: 250,
    height: 130,
    name: '分组 B',
    groupId: ID.group,
    text: '整组可以一起拖动；\n双击分组框进入组内，才能单独编辑里面的卡片。',
    remark: '',
  })
  groups.push({
    id: ID.group,
    name: '分组演示：拖动我试试',
    nodeIds: [ID.groupA, ID.groupB],
    createdAt: now,
  })

  // ⑥ 数据说明
  addNode({
    id: ID.data,
    type: 'text',
    x: 880,
    y: 640,
    width: 340,
    height: 190,
    name: '⑤ 数据存在本地',
    tagColor: '#33d17a',
    text: '画布和媒体文件都保存在当前浏览器的 IndexedDB 里，不会上传服务器。\n换设备时，用「分享」面板导出 JSON 备份，再到新环境导入。',
    remark: '',
  })

  // 标题
  addNode({
    id: ID.title,
    type: 'text',
    x: 140,
    y: 100,
    width: 620,
    height: 160,
    name: '欢迎来到无限画布',
    text: '拖动空白处平移，滚轮缩放，双击空白处新建节点。\n下面几张卡片演示了它的主要能力，可以直接拖动、编辑、删除。',
    remark: '',
  })

  connect(ID.title, ID.text)
  connect(ID.text, ID.image)
  connect(ID.image, ID.code)
  connect(ID.code, ID.link)

  return { nodes, connections, groups }
}

// 生成示例画布文档
export async function buildDemoDoc(id: string): Promise<CanvasDoc> {
  const now = Date.now()
  const parts = await buildParts()
  return {
    id,
    name: DEMO_DOC_NAME,
    createdAt: now,
    updatedAt: now,
    nodeCount: parts.nodes.length,
    connectionCount: parts.connections.length,
    groupCount: parts.groups.length,
    sizeBytes: 0,
    schemaVersion: 1,
    nodes: parts.nodes,
    connections: parts.connections,
    groups: parts.groups,
    // 让示例内容在首屏完整可见；顶部再下移一点，避开悬浮顶栏
    viewport: { x: -40, y: 40, scale: 0.8 },
  }
}
