# 组件与接口说明（component-api）

> 约定：组件不持有业务状态，全部读写 [canvasStore](src/store/canvasStore.ts)。标记「store 驱动」的组件不需要外部 props。

## 1. 组件总表

| 组件 | 文件 | Props | 说明 |
| --- | --- | --- | --- |
| `App` | [App.tsx](src/App.tsx) | — | 应用壳：文档生命周期、自动保存、导出、布局装配 |
| `Canvas` | [Canvas.tsx](src/components/Canvas.tsx) | `loading?: boolean; onViewportChange?: () => void` | 画布双图层与全部指针 / 键盘交互 |
| `ConnectionLayer` | [ConnectionLayer.tsx](src/components/ConnectionLayer.tsx) | 见下 | Konva 连线层：底纹、选中、光丝 |
| `ConnectionCutter` | [ConnectionCutter.tsx](src/components/ConnectionCutter.tsx) | — | 选中连线的剪刀按钮（store 驱动：`selectedConnectionId`） |
| `MiniMap` | [MiniMap.tsx](src/components/MiniMap.tsx) | — | 左下角小地图按钮与缩略图弹窗（store 驱动：`activeMenu = 'minimap'`） |
| `CreateMenu` | [CreateMenu.tsx](src/components/CreateMenu.tsx) | `x, y, worldX, worldY, onClose` | 双击空白弹出的新建节点菜单 |
| `CanvasMenu` | [CanvasMenu.tsx](src/components/CanvasMenu.tsx) | `x, y, onClose` | 画布右键双栏菜单（新建节点 / 粘贴 / 重做 / 撤销） |
| `AssetPicker` | [AssetPicker.tsx](src/components/AssetPicker.tsx) | `worldX, worldY, onDone, onBack?` | 菜单内资产选择，点选后插入画布 |
| `StartupHint` | [StartupHint.tsx](src/components/StartupHint.tsx) | — | 空画布居中启动提示 |
| `GridBackground` | [GridBackground.tsx](src/components/GridBackground.tsx) | `viewport, width, height` | 只画可视区内的点阵网格 |
| `NodeCard` | [NodeCard.tsx](src/components/NodeCard.tsx) | `node: CanvasNode, scale: number, connectTarget?: boolean` | 节点卡片（DOM），拖拽 / 编辑 / 重命名 / 标签色 / 上传 / 加号 / 右下角等比缩放 |
| `AudioPlayer` | [AudioPlayer.tsx](src/components/AudioPlayer.tsx) | `src: string` | 音频节点的律动波形 + 自定义液态玻璃控制栏（播放 / 暂停 / 进度 / 时间） |
| `SnapGuides` | [SnapGuides.tsx](src/components/SnapGuides.tsx) | — | 网格吸附的虚线参考线（store 驱动：`snapGuides`，按 `viewport` 换算到屏幕坐标） |
| `MagneticHandle` | [MagneticHandle.tsx](src/components/MagneticHandle.tsx) | `side: 'left' \| 'right'; onDragStart: () => void` | 节点外侧磁吸加号 |
| `GroupFrame` | [GroupFrame.tsx](src/components/GroupFrame.tsx) | `group: CanvasGroup, nodes: Record<string, CanvasNode>, scale: number` | 分组边框、标题、整组拖动、组级加号 |
| `RemarkPanel` | [RemarkPanel.tsx](src/components/RemarkPanel.tsx) | — | 备注浮层（store 驱动：`remarkOpenId`） |
| `TopBar` | [TopBar.tsx](src/components/TopBar.tsx) | 见下 | 顶部浮动栏 |
| `Toolbar` | [Toolbar.tsx](src/components/Toolbar.tsx) | — | 底部工具栏 + 整理画布算法（store 驱动） |
| `AssetPanel` | [AssetPanel.tsx](src/components/AssetPanel.tsx) | `onOpenDoc(id)`, `onNewDoc()` | 左侧资产抽屉（store 驱动 + 文档回调） |
| `RightMenu` | [RightMenu.tsx](src/components/RightMenu.tsx) | — | 右键菜单（store 驱动：`rightMenu`） |
| `ContextMenu` | [ContextMenu.tsx](src/components/ContextMenu.tsx) | — | 「引用该节点生成」（store 驱动：`contextMenu`） |

## 2. 组件明细

### Canvas
- **职责**：挂载 Konva `Stage`（`GridBackground` + `ConnectionLayer`）；挂载 DOM 覆盖层（`GroupFrame`、`NodeCard`、`RemarkPanel`、`ConnectionCutter`）与空画布 `StartupHint`；处理指针与快捷键。
- **依赖 store**：`nodes / connections / groups / viewport / draggingConnection / selectedIds`，动作 `setViewport / setDraggingConnection / addConnection / setContextMenu / setRightMenu / setSelected / removeNode / removeConnection / exitGroup`。
- **行为**
  - 左键空白拖动 → 框选；中键或 `Space + 左键` → 平移；滚轮 → `zoomAt`；右键 → `setRightMenu`。
  - 双击空白：空画布（无节点）直接创建并选中文本节点，与启动提示一致；已有节点时打开 `CreateMenu`（节点创建在双击位置）。
  - 快捷键：`Ctrl+Z` 撤销、`Ctrl+Shift+Z` / `Ctrl+Y` 重做、`Ctrl+C` 复制选中节点、`Ctrl+V` 粘贴；输入框内不拦截。
  - 拖拽连线时：连线端点始终跟随鼠标；鼠标命中的目标节点加 `connect-target` 一圈白色高亮，并按光标在卡片内的相对位置把世界坐标传给 `connectPoint`，驱动目标卡片 3D 倾斜；移出卡片即取消，松手建立连线后清除（此时静态连线渲染到目标左侧中点）。拖拽期间节点用 `hide-handles` 隐藏磁吸加号。
  - `Delete / Backspace`：先删 `selectedConnectionId`，否则删 `selectedIds`。
  - `Esc`：`exitGroup()`。
  - `onDrop`：按 mime 建立 `image / video / audio / text` 节点，`saveFile` 落盘，`findFreeSpot` 避让。
- **注意**：视口补偿只在这里做一次，子层不要再叠加 transform。

### ConnectionLayer

```ts
interface Props {
  nodes: Record<string, CanvasNode>
  groups: Record<string, CanvasGroup>
  connections: Connection[]
  dragging: DraggingConnection | null
}
```

- **内部组件**
  - `ConnectionPath`：可命中的 `Path` 底纹（`hitStrokeWidth = 14`），只负责选中。选中样式由 `selected` 控制。
  - `ConnectionShape`：只读 `Shape`，`sceneFunc` 内绘制 3 条光丝，`listening = false`。
- **常量**（[L15-L18](src/components/ConnectionLayer.tsx#L15-L18)）：`LIGHT_RATIO = 0.20`、`LIGHT_COUNT = 3`、`PHASE_SPEED_PER_SEC = 0.20`、`CURVE_SAMPLES = 48`。
- **依赖 store**：`selectedIds / selectedGroupId / selectedConnectionId / selectConnection`。
- **高亮判定**：`activeEndpoints = 选中节点 ∪ 这些节点的分组 ∪ 选中分组`；连线任一端命中，或连线本身被选中，即 `glow`。
- **动画**：仅 `hasGlow` 时启动 rAF，`phaseRef += PHASE_SPEED_PER_SEC * dt / 1000`，`dt` 上限 50ms。
- **几何**：`|y1-y2| <= 2` 直线，否则 `bezierPath`；光丝可见段 `[max(0, head - tLen), min(1, head)]`，`head ∈ [0, 1 + tLen)`。

### NodeCard

```ts
interface Props {
  node: CanvasNode
  scale: number
  connectTarget?: boolean
  connectPoint?: { x: number; y: number }
}
```

- **交互**：按下卡片空白拖动移动节点（`screen delta / scale`，世界坐标）；双击文本进入编辑；媒体区双击 / 工具条上传；右键 `setRightMenu('node')`；左右 `MagneticHandle` 拉线；备注面板。
- **名称**：卡片外侧左上角（`top: -28px`，与右上角工具条中心线对齐）显示类型图标 + `node.name`（默认「文本1 / 图片1」这类，由 store 生成），文字为灰色常规字重；鼠标移入名称区域时图标与文字变白（仅文字高亮，无背景底）；双击名称进入 `node-head-input`，`Enter / 失焦` 提交，`Esc` 取消。
- **标签**：工具条「标签」按钮展开 `.node-tag-pop`，5 个预设颜色写 `node.tagColor`，卡片加 `has-tag` 类并通过 `--tag-color` 驱动边框与外晕；「全部清空颜色」清除当前节点颜色。面板展开时卡片加 `tag-open` 类，工具条常驻可点，鼠标穿过面板上方间隙不会收起。
- **悬浮压感**：`connectTarget` 且传入 `connectPoint` 时，按光标相对卡片中心的偏移做 `perspective(700px) rotateX/rotateY`（最大 14°，光标所在的角向屏幕内压下）+ `scale(1.02)`，`transform-origin: 50% 50%` 保证轴心不动；移出卡片后 transform 复位。
- **代码节点**：`type === 'code'` 时内容区为 `.code-block`（深色底 + 等宽字体），双击进入 `textarea` 编辑，内容存 `node.text`。
- **链接节点**：单击链接文字只选中、不跳转；双击进入 URL 编辑；右侧 `.link-open` ↗ 按钮或 `Ctrl/Cmd + 单击` 打开新标签页。`safeLinkHref` 只接受 http/https，无协议时补 `https://`，其他协议（如 `javascript:`）返回 null。
- **等比缩放**：右下角 `.node-resize-handle`（40×40 命中区，`cursor: nwse-resize`），悬停 / 拖拽时显示白色圆弧 `.node-resize-arc`；拖拽以位移较大的方向计算比例，最小 120×90、最大 4 倍，左上角锚定，宽高按整数写回 `width / height`。
- **锁定**：`handlesLocked = !!node.groupId && node.groupId !== focusedGroupId`，此时不显示加号与缩放手柄，首次交互会先 `enterGroup`。
- **邻近**：`useProximity(rootRef, { enter: 88, exit: 128, enabled: !handlesLocked })`；`near` 时 `zIndex = 4`。
- **导出函数** `measureMedia(mime, url)`：按真实宽高比算出受上限约束的节点宽高，供上传后 `updateNode` 使用。

### MagneticHandle

```ts
interface Props { side: 'left' | 'right'; onDragStart: () => void }
```

- 常量：`HANDLE_R = 13`、`PULL_MAX = 20`、`PULL_IN = 5`、`FOLLOW = 0.5`、`GAP = 9`。
- 位置：右 `calc(GAP + pull)`，左 `calc(-100% - GAP + pull)`；`translateY(pullY)`。
- 位移以「静止中心」为基准，水平向内夹到 `PULL_IN`，鼠标在节点内部时重置为 0。
- 视觉由 CSS `.mag-handle` 负责（26px 圆环 + `::before/::after` 胶囊加号）。

### GroupFrame
- 负责分组包围盒、标题、整组拖动（`setNodePositions` 批量写）、组级左右加号、右键菜单、进入分组。
- 依赖 `focusedGroupId / selectedGroupId` 决定编辑态与高亮。

### TopBar

```ts
interface Props {
  loading: boolean
  storageError: string | null
  onNew: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onExport: () => void
  onCopy: () => Promise<boolean>
}
```

- 菜单：画布下拉（列表 + 新建 + 重命名 + 删除）、导出、分享、帮助（快捷键）。
- 顶栏菜单互斥通过 `activeMenu`；`Esc` 关闭。

### Toolbar
- 结构：`+` 菜单（搜索 + 5 类节点 + 上传 + 生成历史占位）、资产管理开关、整理画布、缩放菜单、节点数胶囊。
- 导出函数 `arrangeCanvas()`：脑图分层排版（详见 [architecture.md](architecture.md#6-整理画布算法)）。
- 快捷键：`Alt + Shift + F`。

### AssetPanel
- `PANEL_W = 360`；`tab: 'canvas' | 'assets'`。
- 画布页：节点列表（按类型编号命名）、搜索、类型筛选、`focusNode`（选中 + 视口居中到抽屉右侧）。
- 资产页：`listAssets / putAsset / deleteAsset / listAssetCategories / putAssetCategory / deleteAssetCategory`、上传、分类管理、移动、删除。
- 空状态：创建默认分类 / 上传资产。

### ConnectionCutter
- **职责**：连线被选中后，把鼠标位置投影到连线最近点（直线投影 / 曲线 96 段采样），在最近点渲染剪刀按钮；点击 `removeConnection` 切断连线。
- **显隐**：鼠标离连线超过 `SHOW_DISTANCE = 64`（屏幕像素）时隐藏；随视口缩放。
- **坐标**：渲染在 Canvas 的 DOM 覆盖层内，`left/top` 直接用世界坐标，不再额外补偿视口。

### MiniMap
- 按钮位于左下角工具栏（资产管理之后），悬浮提示「画布小地图」；点击切换 `activeMenu = 'minimap'`，在按钮上方弹出缩略图面板。
- 内容区 `232 × 128`：按所有节点的包围盒等比缩放，节点画成灰色圆角块（最小 3px），连线按左右锚点画细线，当前视口用浅色描边矩形表示。
- 视口框联动：在框内按住拖动直接平移主画布；框外点击先把视口中心对准点击位置，之后可继续拖拽。拖动时主画布内容实时跟随。
- 关闭：再次点击按钮、点击外部（window mousedown，不使用遮罩）或 Esc；不使用遮罩可让滚轮缩放时视口框实时更新。
- 无节点时显示「画布暂无节点」。

### RightMenu
- 目标：`canvas / node / group`（连线改由选中后的剪刀按钮切断）。
- 画布：交给 `CanvasMenu`，双栏结构：左侧 `新建节点 / 粘贴 / 重做 / 撤销`（后三项按 `hasClipboard / canRedo / canUndo` 置灰），右侧是节点类型列表 + 「从资产库添加 / 本地上传」。
- 节点：添加备注、创建分组（需 ≥2 选中）、删除节点。
- 分组：选中整组、取消分组。
- 单栏尺寸 `MENU_W = 196`，`MENU_H = items * 38 + 20`，越界时向内收。

### CreateMenu
- 双击空白打开，定位在双击点并夹取到视口内；条目为 `NODE_TYPE_ITEMS`（文本 / 图片 / 视频 / 音频 / 链接 / 代码）+「从资产库添加 / 本地上传」。
- 创建：`addNode` 到双击世界坐标；图片 / 视频 / 音频先建空壳节点，回画布后再双击上传。
- 「本地上传」：隐藏的 `input[multiple]` → `createNodesFromFiles`（按 32px 依次偏移）。
- 「从资产库添加」：切到 `AssetPicker`，点资产后 `getFile` → `measureMedia` → `addNode`（带 `fileKey`）。

### CanvasMenu
- 画布右键的双栏菜单：左栏「新建节点」（可折叠右栏）+ 粘贴 / 重做 / 撤销（按 store 标志置灰），右栏节点类型列表 + 资源入口。
- 创建 / 资产 / 上传都落在右键位置的世界坐标，逻辑与 `CreateMenu` 共用 `createNodes` 工具。

### AssetPicker
- `listAssets()` 后过滤掉 `file` 类型；点击某项调用 `insertAssetAt()` 插入图片 / 视频 / 音频节点并回调 `onDone`；`onBack` 可返回节点列表。

### ContextMenu
- 由 `contextMenu: { x, y, sourceId }` 驱动。
- 「引用该节点生成」：在点击位置新建文本 / 图片 / 视频 / 音频节点，并 `addConnection(sourceId, newId)`。

### RemarkPanel
- 由 `remarkOpenId` 驱动，编辑草稿，保存写回 `node.remark`。

### GridBackground
- 间距 40px，根据 `viewport` 计算可视世界范围，只绘制可见点。

### NodeTypeIcons
- 导出 `TextIcon / ImageIcon / VideoIcon / AudioIcon / LinkIcon` 与 `NODE_TYPE_ITEMS`（`{ type, label, icon }[]`）。14×14 线性图标，`strokeWidth 1.25`。

## 3. Store API（[canvasStore.ts](src/store/canvasStore.ts)）

### 3.1 状态字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `docId` | `string \| null` | 当前文档 id |
| `docMetas` | `CanvasDocMeta[]` | 文档列表元数据 |
| `nodes` | `Record<string, CanvasNode>` | 节点（世界坐标） |
| `connections` | `Record<string, Connection>` | 连线 |
| `groups` | `Record<string, CanvasGroup>` | 分组 |
| `viewport` | `{ x, y, scale }` | 视口 |
| `selectedIds` | `string[]` | 选中节点 |
| `selectedGroupId` | `string \| null` | 选中分组 |
| `selectedConnectionId` | `string \| null` | 选中连线 |
| `focusedGroupId` | `string \| null` | 当前进入的分组 |
| `draggingConnection` | `DraggingConnection \| null` | 正在拉的连线 |
| `contextMenu` | `{ x, y, sourceId } \| null` | 「引用生成」菜单 |
| `rightMenu` | `{ x, y, targetType, targetId? } \| null` | 右键菜单 |
| `remarkOpenId` | `string \| null` | 备注面板打开节点 |
| `activeMenu` | `'canvas' \| 'help' \| 'nodes' \| 'share' \| 'zoom' \| 'minimap' \| null` | 顶栏 / 底栏下拉互斥 |
| `assetPanelOpen` | `boolean` | 资产抽屉 |
| `snapEnabled` | `boolean` | 网格吸附开关（拖节点时对齐边 / 中心并显示参考线） |
| `snapGuides` | `SnapGuide[]` | 当前对齐参考线（世界坐标，拖拽结束清空） |
| `canUndo` / `canRedo` | `boolean` | 撤销 / 重做是否可用 |
| `hasClipboard` | `boolean` | 是否复制过节点 |

### 3.2 动作

| 动作 | 签名 | 行为要点 |
| --- | --- | --- |
| `setDocId` | `(id: string \| null) => void` | 仅写 id |
| `setDocMetas` | `(metas: CanvasDocMeta[]) => void` | 刷新列表 |
| `resetCanvas` | `() => void` | 清空内容与全部选择 / 菜单 |
| `setViewport` | `(vp: Partial<Viewport>) => void` | 合并写视口 |
| `pan` | `(dx, dy) => void` | 平移 |
| `zoomAt` | `(screenX, screenY, delta) => void` | 以鼠标为中心，scale ∈ [0.1, 4] |
| `addNode` | `(node) => string` | 补默认尺寸 260×160、时间戳，返回 id |
| `updateNode` | `(id, patch) => void` | 局部更新 |
| `removeNode` | `(id) => void` | 同时清理连线与分组；空组自动删除 |
| `setNodeSize` | `(id, w, h) => void` | 媒体尺寸回写 |
| `setNodePositions` | `(Record<id, {x,y}>) => void` | 批量写坐标（整组拖动） |
| `setSelected` | `(ids) => void` | 清空分组 / 连线选择 |
| `toggleSelected` | `(id) => void` | 反选，清空连线选择 |
| `selectConnection` | `(id \| null) => void` | 选中连线时清空节点 / 分组选择；传 null 只取消连线 |
| `addConnection` | `(sourceId, targetId) => void` | 拒绝自连与重复（无向判重） |
| `removeConnection` | `(id) => void` | 若正被选中则一并清空 |
| `setDraggingConnection` | `(dc \| null) => void` | 拖线状态 |
| `setContextMenu` | `(cm \| null) => void` | 引用生成菜单 |
| `setRightMenu` | `(rm \| null) => void` | 右键菜单 |
| `undo` / `redo` | `() => void` | 快照式历史；`undo` 先 flush 未提交的变更再回退，`redo` 反向恢复 |
| `copySelection` | `() => void` | 复制选中节点及两端都在选区内的连线到内存剪贴板 |
| `pasteClipboard` | `() => void` | 以 +36px 偏移粘贴、重新生成 id / 默认名称，并选中新节点 |
| `groupSelected` | `() => string \| null` | 需 ≥2 选中；回写节点 `groupId` |
| `ungroup` | `(groupId) => void` | 清成员 `groupId`，清相关选择 / 聚焦 |
| `renameGroup` | `(groupId, name) => void` | 重命名 |
| `selectGroup` | `(groupId \| null) => void` | 选中分组=选中全部成员 |
| `enterGroup` | `(groupId) => void` | 设置 `focusedGroupId` 与选中 |
| `exitGroup` | `() => void` | 清 `focusedGroupId / selectedGroupId` |
| `setRemarkOpen` | `(id \| null) => void` | 备注面板 |
| `setActiveMenu` | `(menu \| null) => void` | 下拉互斥 |
| `toggleAssetPanel` | `() => void` | 抽屉开关 |
| `toggleSnap` | `() => void` | 切换网格吸附，同时清空参考线 |
| `setSnapGuides` | `(guides: SnapGuide[]) => void` | 拖动过程中更新参考线，松手置空 |
| `loadState` | `({ nodes, connections, groups, viewport? }) => void` | 数组转 map，清空选择，重置历史 |

> 历史：`nodes / connections / groups` 的不可变快照，文档变化后 450ms 合并为一条（拖拽 / 连续输入只算一步），上限 60 条；撤销/重做历史只放当前会话内存、不做持久化（画布内容本身仍由 App 自动保存到 IndexedDB）。`loadState` / `resetCanvas` 会重置历史。视口、选择等 UI 状态不进入历史。

`genId(prefix = 'n')` 也在此导出，格式 `prefix_time36_counter36`。

## 4. 领域类型（[types.ts](src/types.ts)）

```ts
type NodeType = 'text' | 'image' | 'video' | 'audio' | 'link' | 'code'
type AssetType = 'image' | 'video' | 'audio' | 'file'

interface CanvasNode {
  id: string; type: NodeType; x: number; y: number; width: number; height: number
  name?: string; tagColor?: string
  text?: string; url?: string; fileKey?: string; linkUrl?: string
  remark?: string; groupId?: string; createdAt: number
}
interface Connection { id: string; sourceId: string; targetId: string; createdAt: number }
interface CanvasGroup { id: string; name: string; nodeIds: string[]; createdAt: number }
interface Viewport { x: number; y: number; scale: number }
interface DraggingConnection { sourceId: string; cursorX: number; cursorY: number }
interface ContextMenuState { x: number; y: number; sourceId: string }
interface RightMenuState { x: number; y: number; targetType: 'canvas'|'node'|'group'; targetId?: string }

interface CanvasDocMeta {
  id: string; name: string; createdAt: number; updatedAt: number
  nodeCount: number; connectionCount: number; groupCount: number; sizeBytes: number
}
interface CanvasDoc extends CanvasDocMeta {
  nodes: CanvasNode[]; connections: Connection[]; groups: CanvasGroup[]; viewport: Viewport
}

interface Asset { id, name, type: AssetType, mime, size, fileKey, categoryId?, createdAt }
interface AssetCategory { id, name, kind?: AssetType, createdAt }
```

## 5. Utils

### geometry.ts

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `worldToScreen` | `(wx, wy, vp)` | 世界 → 屏幕 |
| `screenToWorld` | `(sx, sy, vp)` | 屏幕 → 世界 |
| `rightAnchor` | `(node)` | 右侧中点 `{ x: n.x + n.width, y: n.y + h/2 }` |
| `leftAnchor` | `(node)` | 左侧中点 |
| `bezierPath` | `(x1,y1,x2,y2) => string` | 水平三次贝塞尔 SVG path（偏移 `max(40, dx/2)`） |
| `bezierPoint` | `(x1,y1,x2,y2,t)` | 曲线上采样点 |
| `groupBBox` | `(nodes) => bbox \| null` | 成员包围盒，外扩 24px |
| `findFreeSpot` | `(nodes, w, h, cx, cy, bounds?)` | 环形搜索不重叠空位；优先可视区内 |
| `snapNodePosition` | `(moving, x, y, others, threshold) => { x, y, guides }` | 边 / 中心对齐吸附，每轴最多返回一条参考线 |

### idb.ts

| 函数 | 说明 |
| --- | --- |
| `saveFile(blob)` | 写 `files`，返回 `file_*` key |
| `getFile(key)` | 读 blob 或 null |
| `putDoc` / `getDoc` / `listDocMetas` / `deleteDoc` | 文档读写（列表只算元数据与体积） |
| `migrateLegacyIfNeeded()` | docs 为空时迁移旧 `canvas/current` 为「我的第一个画布」 |
| `listAssets` / `putAsset` / `deleteAsset` | 删除资产同时删 blob |
| `listAssetCategories` / `putAssetCategory` / `deleteAssetCategory` | 删分类后其资产置为未分类 |

### runCode.ts

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `detectCodeMode` | `(code) => 'js' \| 'html'` | 未选择语言时按内容判断（HTML 标签开头视为 `html`） |
| `runJavaScript` | `(code) => Promise<RunResult>` | Blob Worker 沙箱执行；代理 `console`、支持顶层 await、3 秒超时终止 |
| `runPython` | `(code) => Promise<RunResult>` | 独立 Worker 加载 [skulpt-worker.js](public/skulpt-worker.js) + [public/skulpt](public/skulpt) 中的 Skulpt；8 秒超时终止 |

`RunResult`：`{ ok, logs, error?, timedOut?, mode }`，`mode` 为 `'js' | 'python' | 'html'`；`logs` 每项为 `{ level: 'log'|'info'|'warn'|'error'|'result', text }`。HTML 模式不经过 Worker，由代码节点用 `sandbox="allow-scripts …"`（不含 `allow-same-origin`）的 iframe 直接渲染 `srcDoc`。代码节点用 `node.language` 持久化语言选择，未设置时才调用 `detectCodeMode`。

## 6. Hooks

```ts
useProximity(ref, { enter = 64, exit = 104, enabled = true }): boolean
```

- 以「到元素外框的最近距离」判定，因此元素外围空白也能感应。
- `enter / exit` 形成迟滞区间；`enabled = false` 时强制 false。
- 内部用 `requestAnimationFrame` 做事件节流。
