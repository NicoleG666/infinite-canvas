# 架构和数据流（architecture）

## 1. 总览

```
┌─────────────────────────────────────────────────────────────┐
│ 交互层（DOM 事件 / 快捷键）                                    │
│   Canvas 根节点事件 · NodeCard 拖拽 · MagneticHandle · 菜单     │
└───────────────────────────┬─────────────────────────────────┘
                            │ 只通过 store action 改数据
┌───────────────────────────▼─────────────────────────────────┐
│ 状态层：Zustand store（唯一数据源）                             │
│   nodes · connections · groups · viewport · 选择 · 菜单 · 抽屉   │
└───────────┬───────────────────────────────┬─────────────────┘
            │                               │
┌───────────▼─────────────┐      ┌──────────▼─────────────────┐
│ 渲染层                   │      │ 持久化层                    │
│  Konva：网格 + 连线       │      │ IndexedDB（动态版本）       │
│  DOM：节点 + 分组 + 备注  │      │ docs / files / assets /    │
│  DOM：顶栏 / 底栏 / 菜单  │      │ assetCategories / profile  │
└─────────────────────────┘      └────────────────────────────┘
```

关键点：**渲染层不各自维护数据**。Konva 与 DOM 都是 store 的投影。

## 2. 视口变换

```ts
// utils/geometry.ts
worldToScreen(wx, wy, vp) => { x: wx * vp.scale + vp.x, y: wy * vp.scale + vp.y }
screenToWorld(sx, sy, vp) => { x: (sx - vp.x) / vp.scale, y: (sy - vp.y) / vp.scale }
```

- Konva Stage 使用同一个 `viewport`；DOM 覆盖层用 `transform: translate(x, y) scale(s)`。
- 缩放以鼠标为锚点（`zoomAt`）：先算鼠标下的世界点，再反解新的 `x / y`，保证该点不动。
- 缩放范围硬限制 `[0.1, 4]`。

## 3. 启动与文档生命周期

```
应用启动
  └─ migrateLegacyIfNeeded()         // docs 为空时，把旧 canvas/current 迁移成首个文档
  └─ listDocMetas()
       ├─ 有文档 → openDoc(最近更新)
       └─ 无文档 → createDoc()
  └─ setLoading(false)
```

- **打开文档**：先 `persist` 当前文档 → `getDoc(id)` → `loadState()` → 对带 `fileKey` 的节点重新 `getFile` 并生成 `objectURL`。
- **新建文档**：落盘当前文档 → `resetCanvas()` → `putDoc()`。
- **删除文档**：删库 → 刷新列表 → 若删的是当前文档，切到最近一张或新建。
- **自动保存**：`useCanvasStore.subscribe` 监听 `nodes / connections / groups / viewport` 的**引用**是否变化，700ms 防抖后 `putDoc(buildDoc())` 并刷新元数据。存储失败时降级为内存列表，界面继续可用，并通过 `storageError` 提示。

序列化注意：`buildDoc` 只保留 `fileKey`，把运行时 `url`（objectURL）置为 `undefined`，避免把失效的 blob URL 写进文档。

## 4. IndexedDB 结构

库名 `infinite-canvas-notes`，不写死版本号：先按现有版本打开，缺少所需 store 时在 `version + 1` 上触发升级（IndexedDB 只允许升版本）。这样浏览器里已存在的更高版本库不会因 `VersionError` 导致应用退回内存态。

| store | key | value | 用途 |
| --- | --- | --- | --- |
| `docs` | `id` (keyPath) | `CanvasDoc` | 画布文档（含节点、连线、分组、视口） |
| `files` | 生成的 `file_*` 字符串 | `Blob` | 所有二进制文件（节点媒体 + 资产共用） |
| `assets` | `id` | `Asset` | 资产元数据（指向 `files`） |
| `assetCategories` | `id` | `AssetCategory` | 资产分类 |
| `profile` | `'local'`（外部键） | `UserProfile` | 本地用户资料（昵称 / 头像 / 会员状态 / 用户 ID） |
| `canvas` | `'current'` | 旧版单画布状态 | **仅迁移用**，新代码不再写入 |

约束与保护：
- `open` 有 8000ms 超时（隐私模式 / 被阻塞时明确失败）。
- `onblocked` 立即 reject；`onversionchange` 主动 `close()`，避免多标签页互相卡死。
- 失败后清空 `dbPromise`，允许重试。
- `deleteAsset` 在同一事务里删记录 + 删 blob；`deleteAssetCategory` 把该分类下资产置为未分类。

## 5. 渲染层

### 5.1 Canvas

[Canvas.tsx](src/components/Canvas.tsx) 负责：

1. 挂载 Konva `Stage`，内含 `GridBackground` + `ConnectionLayer`。
2. 挂载 DOM 覆盖层：分组框、节点卡片、备注面板，统一套 `viewport` 变换。
3. 交互分发：
   - 左键空白拖动 → 框选（世界坐标命中检测 `hitNode / hitGroup`）
   - 中键、或空格 + 左键 → 平移
   - 滚轮 → `zoomAt`
   - 右键 → `setRightMenu`
   - 文件拖入 → 按 mime 决定节点类型，`saveFile` 存 blob，`findFreeSpot` 避让
   - `Delete / Backspace` → 优先删除 `selectedConnectionId`，否则删除选中节点
   - `Esc` → `exitGroup()`
4. 空白点击 → `setSelected([])`（store 内同时清空分组与连线选择）。

### 5.2 连线渲染（ConnectionLayer）

两层结构：

1. **底纹 / 命中层**：`ConnectionPath`（Konva `Path`），灰线 1.6px，`hitStrokeWidth 14`，`listening`，负责左键选中与右键菜单。选中时变青、加粗、发光。
2. **光效层**：`ConnectionShape`（Konva `Shape` + 自定义 `sceneFunc`），`listening={false}`，只在 `isGlow(c)` 为真时绘制。

`isGlow` 判定：连线的 `sourceId / targetId` 属于「选中节点集合 ∪ 其所属分组 ∪ 选中分组」。拖拽新连线时始终发光。

动画：只有存在高亮连线（或正在拖线）时启动 `requestAnimationFrame`；相位 `phaseRef` 按 `PHASE_SPEED_PER_SEC * dt / 1000` 推进（用真实时间差，不受刷新率影响）。默认静态，无隐藏耗电。

几何：
- 两端锚点：`rightAnchor(source)` → `leftAnchor(target)`（世界坐标）。
- `|y1 - y2| <= 2` 用直线，否则水平三次贝塞尔 `bezierPath`，控制点水平偏移 `max(40, dx / 2)`。
- 光丝长度按弧长比例 `LIGHT_RATIO`（0.20）自适应，3 条固定错相位。
- 头部推进到 `1 + tLen`，可见段 `[max(0, head - tLen), min(1, head)]`：起点渐出、尾部到终点才消失，避免「突然冒出来」的割裂感。

### 5.3 磁吸加号（MagneticHandle）

- 出现在节点左右外侧（`GAP = 9px`），**完全位于节点外**，不侵入卡片。
- 显隐由 `useProximity` 控制：进入 88px 显示、离开 128px 隐藏（迟滞防闪烁）；节点内部禁用吸附与显隐。
- 位移以「按钮静止中心」为基准跟手：水平只允许向外最多 `PULL_MAX`、向内最多 `PULL_IN`（留 3px），垂直 ±`PULL_MAX`，系数 `FOLLOW`。
- 视觉：透明填充 + 26px 描边圆环 + CSS 胶囊笔画拼成的加号（避免 SVG 端点被裁成平角）。
- 邻近节点通过 `zIndex`（`near ? 4 : 3`）避免遮挡。

## 6. 整理画布算法

实现位于 [Toolbar.tsx](src/components/Toolbar.tsx) 的 `arrangeCanvas()`。

```
1) 单元化：分组 = 一个整体块（包围盒），未分组节点各自成块
2) 连线映射：端点若属于分组，则归到该分组；去重无向边，标记 connected
3) 无任何连线 → 网格布局：枚举列数，按 (可放大倍数 - 宽高比偏差) 打分选最优
4) 有连线 → 脑图分层：
   a. Kahn 最长路径分层：入度 0 为第 0 层，子层 = max(父层 + 1)
   b. 环 / 不可达部分用 BFS 补层（接在已有最大层之后）
   c. 层内排序：按父节点在上一层的位置序号（减小交叉），同父按 createdAt
   d. 列坐标：每层宽度取该层最大块宽 + 间距
   e. 垂直：先整层居中；再从第 1 层起，把子块中心对齐父块中心均值，并阻止相邻重叠
5) 孤立节点在连通图下方按尺寸逐行铺排（宽度不超过图形总宽）
6) 写入坐标 + 计算整体包围盒 + 自动 fit：
   scale ∈ [0.1, 1]，左内边距在资产抽屉打开时为 360px
```

## 7. 资产体系

- 资产是**笔记级**的，跨画布共享；画布节点是**画布级**的。
- 抽屉两个 tab：
  - `画布`：列出当前画布的节点（按类型命名「文本节点 1…」），可搜索、筛选、点击聚焦（把视口中心对准抽屉右侧的可视区中心）。
  - `资产`：上传素材、按分类筛选、管理模式下新建 / 删除分类、移动资产、删除资产。
- 空状态提供「创建默认资产分类」（按类型 hydrated 出图片 / 视频 / 音频 / 文件分类）。
- 缩略图：从 `files` 读 blob 生成 objectURL，图片资产才渲染。

## 8. 性能与边界

- 网格只绘制可视区域内的点。
- `setNodePositions` 批量写坐标，避免整组拖动时多次 setState。
- 光效动画按需启动；`dt` 上限 50ms，切回前台不会突进。
- 查找空位 `findFreeSpot` 用环形搜索，先锁定可视安全区，再允许出界，兜底对角错开。
- 存储不可用时应用降级为内存态，不阻塞界面。

## 9. 相关文档

- 组件逐个说明：[component-api.md](component-api.md)
- 视觉规范：[DESIGN.md](DESIGN.md)
- 已知问题与后续计划：[TODO.md](TODO.md)
