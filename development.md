# 开发方式与回归清单（development）

## 1. 环境要求

- Node.js 18+，npm 9+
- Windows PowerShell 5（本项目主要开发环境）
- 浏览器：Chrome / Edge（需要 IndexedDB 与 Canvas 正常可用）

## 2. 命令

```powershell
npm install                 # 首次安装
npm run dev                 # 开发服务器（热更新）
npx tsc -b                  # 类型检查
npm run build               # 类型检查 + 生产构建（dist/）
npm run preview             # 预览生产构建
```

- PowerShell 5 **不支持 `&&`**：

```powershell
npx tsc -b; if ($LASTEXITCODE -eq 0) { npm run build }
```

- 构建配置：[vite.config.ts](vite.config.ts)、[tsconfig.json](tsconfig.json)、[tailwind.config.js](tailwind.config.js)。Tailwind 只负责原子类，主题色与组件样式在 [index.css](src/index.css)。

## 3. 开发流程建议

1. 先读 [AGENTS.md](AGENTS.md) 的硬性约定。
2. 涉及数据模型 / 存储的改动，先更新 [architecture.md](architecture.md)。
3. 涉及界面样式的改动，先在 [DESIGN.md](DESIGN.md) 找到对应规则，没有就补规则再写代码。
4. 改完跑 `npx tsc -b`，再按下面回归清单自测。
5. 完成的需求从 [TODO.md](TODO.md) 的待办移到「已完成」。

## 4. 常见改动怎么做

### 4.1 新增节点类型
1. [types.ts](src/types.ts) 的 `NodeType` 加值。
2. [NodeTypeIcons.tsx](src/components/NodeTypeIcons.tsx)：加图标 + 往 `NODE_TYPE_ITEMS` 追加。
3. [NodeCard.tsx](src/components/NodeCard.tsx)：渲染分支、内容编辑 / 上传逻辑、默认尺寸。
4. [Toolbar.tsx](src/components/Toolbar.tsx) 与 [ContextMenu.tsx](src/components/ContextMenu.tsx)：菜单选项（后者自行维护 `OPTIONS`）。
5. [AssetPanel.tsx](src/components/AssetPanel.tsx)：`NODE_LABEL` 文案。
6. [Canvas.tsx](src/components/Canvas.tsx)：拖入文件时的类型映射。

### 4.2 新增 store 字段 / 动作
1. 在 `CanvasState` 接口声明字段与签名。
2. 在初始 state 里给默认值。
3. 实现动作时保持不可变更新（`set((s) => ({ ... }))`）。
4. 若与选择有关，必须与 `selectedIds / selectedGroupId / selectedConnectionId` 保持互斥。
5. 若属于文档内容（会落盘），加入 `buildDoc` / `loadState` / `resetCanvas` 三处。

### 4.3 新增菜单项
- 顶栏 / 底栏菜单用 `activeMenu` 互斥；浮层层级按 [DESIGN.md](DESIGN.md#6-层级z-index) 的 99 / 100。
- 右键菜单直接在 [RightMenu.tsx](src/components/RightMenu.tsx) 的 `items` 里加，注意 `danger` / `disabled` / `hint`。

### 4.4 新增持久化数据
1. 在 [idb.ts](src/utils/idb.ts) 的 `onupgradeneeded` 中 `createObjectStore`，并把新 store 名加入 `REQUIRED_STORES`（版本号自动 +1，无需手改常量）。
2. 写读写函数时保持「一个事务内完成关联操作」（例如删记录同时删 blob）。
3. 更新 [architecture.md](architecture.md#4-indexeddb-结构) 的表格。

## 5. 调试方法

- **浏览器 DevTools → Application → IndexedDB → `infinite-canvas-notes`**：直接看 `docs / files / assets` 内容。
- **事件排查**：Konva 节点没有 DOM 结构，可在 `sceneFunc` 或事件回调里临时 `console.log`。
- **状态排查**：`useCanvasStore` 未挂到 window。需要时可在 `main.tsx` 临时加一行 `(window as any).__cs = useCanvasStore`（提交前删除）。
- **rAF 相关动画**：保持标签页在前台调试，后台标签页会被节流。
- **构建产物**：`dist/` 可直接部署到任意静态托管（Nginx / OSS / GitHub Pages），无需后端。

## 6. 回归清单（改动后至少过一遍）

### 基础
- [ ] 刷新页面：自动打开最近画布；无数据时自动新建。
- [ ] 新建节点（5 种类型）都能创建且不重叠。
- [ ] 拖入图片 / 视频 / 音频文件，节点尺寸正确；刷新后仍能显示。

### 画布交互
- [ ] 滚轮缩放以鼠标为中心；缩放到 10% / 400% 时被限制。
- [ ] 中键 / 空格 + 左键平移正常，不与框选冲突。
- [ ] 空白框选可选中多个节点；点击空白清空选择。
- [ ] `Delete` 删除选中节点，关联连线与分组引用一并清理。

### 连线
- [ ] 靠近节点才出现左右加号，且不压到卡片；远离后消失。
- [ ] 拖加号可建立连线；重复连线被拒绝；不能连自己。
- [ ] 未选中节点时无光效；选中节点后其前后连线出现 3 条光丝。
- [ ] 同水平连线为直线；光丝从起点渐出、尾部到终点才消失，无突然出现 / 跳变。
- [ ] 点击连线可选中并高亮；`Delete` 与右键「删除连线」都能删除。

### 分组
- [ ] 框选 ≥2 节点可创建分组；整组拖动时组内相对位置不变。
- [ ] 组内节点未进入分组时不显示加号、不可编辑；进入后可编辑，`Esc` 退出。
- [ ] 解组后节点保留坐标，分组选择状态被清理。

### 整理画布
- [ ] 有连线：分层从左到右，连线不逆流；层内无重叠。
- [ ] 无连线：按尺寸网格铺排，无重叠。
- [ ] 整理后自动缩放居中；资产抽屉打开时内容在抽屉右侧可见。

### 资产抽屉
- [ ] 底栏按钮可打开 / 关闭；打开后立即可见（不能有停在左外的动画）。
- [ ] 「画布」页列出当前画布节点，搜索 / 筛选生效，点击聚焦。
- [ ] 「资产」页可上传、分类筛选、管理模式移动 / 删除；删除分类后资产变未分类。

### 文档管理
- [ ] 顶栏下拉可新建 / 切换 / 重命名 / 删除画布。
- [ ] 导出 JSON 可下载；复制画布数据写入剪贴板。
- [ ] 自动保存：改动后 700ms 内落盘，刷新不丢。

## 7. 提交前

- `npx tsc -b` 与 `npm run build` 必须干净。
- 不要提交 `dist/`、`tsconfig.tsbuildinfo`、临时截图（`.screenshots/`）等产物。
- 文档与代码同步：改了行为就改对应 md，别让文档变成历史遗迹。
