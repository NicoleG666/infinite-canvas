# AGENTS.md

> AI 进入本项目后**首先**需要读的文件。它只写「必须知道、必须遵守」的信息，深入细节见文末文档地图。

## 1. 项目是什么

「无限画布」是一个纯前端的无限画布笔记工具：节点（文本 / 图片 / 视频 / 音频 / 链接）+ 连线 + 分组 + 备注 + 资产库，全部数据保存在浏览器 IndexedDB，无后端、无账号。

- 技术栈：React 18 + TypeScript + Vite 5 + Tailwind 3 + Zustand 4 + Konva / react-konva
- 入口：[index.html](index.html) → [src/main.tsx](src/main.tsx) → [src/App.tsx](src/App.tsx)
- 版本：0.1.0

## 2. 常用命令

```powershell
npm install        # 安装依赖
npm run dev        # 开发服务器（Vite，默认 http://localhost:5173）
npm run build      # 类型检查 + 生产构建（输出 dist/）
npx tsc -b         # 仅做类型检查
```

**Windows PowerShell 5 不支持 `&&`**，串联命令请用 `;` 或分行：

```powershell
npx tsc -b; if ($LASTEXITCODE -eq 0) { npm run build }
```

## 3. 目录结构

```
src/
├─ components/          # 所有 UI 组件（画布、顶栏、底栏、菜单、抽屉）
│  ├─ Canvas.tsx        # 主画布：Konva Stage + DOM 覆盖层 + 交互分发
│  ├─ ConnectionLayer.tsx # 连线底纹 / 选中命中 / 光丝动画
│  ├─ ConnectionCutter.tsx # 选中连线后的剪刀切断按钮
│  ├─ MiniMap.tsx       # 左下角小地图（缩略图 + 视口框）
│  ├─ CreateMenu.tsx    # 双击空白的新建节点菜单
│  ├─ CanvasMenu.tsx    # 画布右键双栏菜单
│  ├─ AssetPicker.tsx   # 菜单内资产选择与插入
│  ├─ StartupHint.tsx   # 空画布启动提示
│  ├─ NodeCard.tsx      # 节点卡片（DOM）
│  ├─ AudioPlayer.tsx   # 音频律动波形 + 液态玻璃播放控制栏
│  ├─ SnapGuides.tsx    # 网格吸附的对齐参考线
│  ├─ MagneticHandle.tsx# 节点左右外侧磁吸加号
│  ├─ GroupFrame.tsx    # 分组框
│  ├─ TopBar.tsx        # 顶部浮动栏
│  ├─ Toolbar.tsx       # 底部工具栏 + 整理画布算法
│  ├─ AssetPanel.tsx    # 左侧资产抽屉（画布 / 资产 两页）
│  ├─ RightMenu.tsx     # 右键菜单（画布 / 节点 / 分组）
│  ├─ ContextMenu.tsx   # 「引用该节点生成」菜单
│  ├─ UserMenu.tsx      # 右上角用户资料浮层（ID / 昵称 / 头像 / 会员状态）
│  └─ RemarkPanel.tsx / GridBackground.tsx / NodeTypeIcons.tsx
├─ store/canvasStore.ts # Zustand 单 store，全局唯一数据源
├─ utils/idb.ts         # IndexedDB 封装（docs / files / assets / 分类 / profile / 旧数据迁移）
├─ utils/profile.ts     # 本地用户资料：默认资料 / 头像预设 / 成长等级
├─ utils/createNodes.ts # 菜单内本地文件上传 / 资产库点选插入节点
├─ utils/runCode.ts     # 代码块沙箱执行（JS Worker / HTML iframe）
├─ utils/geometry.ts    # 坐标换算、锚点、贝塞尔、包围盒、空位搜索
├─ hooks/useProximity.ts# 鼠标邻近感应（磁吸加号显隐）
├─ types.ts             # 全部领域类型
└─ index.css            # 设计 token + 全局样式（Tailwind 之上）
```

## 4. 硬性约定（改动前必读）

### 4.1 坐标与渲染
- 节点坐标一律存**世界坐标**；屏幕坐标 = `world * scale + viewport.x/y`。
- **视口补偿只做一次**：Konva Stage 与 DOM 覆盖层共用同一组 `viewport.x / y / scale`，禁止在两层各自再加偏移。
- 网格与连线用 Konva 画布；节点、分组框、备注、菜单用 DOM。不要在 Konva 里画节点卡片。

### 4.2 状态
- [canvasStore.ts](src/store/canvasStore.ts) 是唯一业务数据源。组件里只允许放纯 UI 临时状态（输入框、悬停、编辑中）。
- 选择是互斥的：`selectedIds` / `selectedGroupId` / `selectedConnectionId` 任一被选中时，其余必须被清空（store 动作里已保证，新增动作必须沿用）。
- 删除节点必须同时清理连线与分组引用（`removeNode` 已内置，不要绕过）。
- 自动保存订阅 `nodes / connections / groups / viewport` 的**引用变化**，不要用深比较；更新时保持不可变写法。

### 4.3 存储
- IndexedDB 名 `infinite-canvas-notes`，**不写死版本号**：以现有版本打开，检测到缺少所需 store 时在现有版本上 +1 触发升级（只升不降），避免旧代码写死版本导致 `VersionError`。新增 store 时在 `onupgradeneeded` 里 `createObjectStore`、加入 `REQUIRED_STORES`，并同步更新本文件与 [architecture.md](architecture.md)。
- 现有 store：`docs / files / assets / assetCategories / profile / canvas（旧，仅迁移）`。`profile` 是单条本地用户资料（外部键 `local`）。
- `blob` 存 `files` store，节点只保留 `fileKey`；`objectURL` 是运行时产物，**不可持久化**，加载文档后重新生成。

### 4.4 视觉
- 颜色、边框、文字层级只用 [index.css](src/index.css) 里的 CSS 变量（`--ink-*`、`--text-*`、`--cyan`、`--line*`），不要新增硬编码色值。
- 详细规范见 [DESIGN.md](DESIGN.md)。

### 4.5 容易被用户手动调参的地方
以下常量在产品调试阶段被反复手调，**修改前先确认需求**，不要凭感觉重写：

| 位置 | 常量 | 作用 |
| --- | --- | --- |
| [ConnectionLayer.tsx](src/components/ConnectionLayer.tsx#L15-L18) | `LIGHT_RATIO` / `LIGHT_COUNT` / `PHASE_SPEED_PER_SEC` | 光丝长度、条数、速度 |
| [MagneticHandle.tsx](src/components/MagneticHandle.tsx#L8-L12) | `HANDLE_R` / `PULL_MAX` / `PULL_IN` / `FOLLOW` / `GAP` | 磁吸加号尺寸与跟手 |
| [NodeCard.tsx](src/components/NodeCard.tsx#L51) | `useProximity` 的 `enter / exit` | 加号显示距离 |

### 4.6 语言
- 界面文案、代码注释、文档统一用中文。

## 5. 完成改动前必须做的验证

1. `npx tsc -b` 通过（无类型错误）。
2. `npm run build` 通过。
3. 涉及交互的改动，按 [development.md](development.md) 的回归清单手动过一遍关键路径。
4. 不要声称「已验证」而没有实际运行命令或实际点击验证。

## 6. 已知坑

- **后台标签页 `requestAnimationFrame` 会被节流**：依赖 rAF 的 CSS 动画可能停在第 0 帧。资产抽屉曾因 `translateX(-100%)` 入场动画而不可见，已移除位移动画——不要再加回。
- **Konva 命中需要 `hitStrokeWidth`**：1.6px 的细线几乎点不中，连线命中区固定 14px。
- Konva 的 `Path` 需要 `listening` 且 `cancelBubble = true`，右键还要 `e.evt.stopPropagation()`，否则会被 Canvas 根节点的右键逻辑覆盖。
- `indexedDB.open` 可能因其他标签页占用而 `blocked`，[idb.ts](src/utils/idb.ts) 有 8s 超时与明确错误文案，不要删掉。
- 分组内的节点默认锁定（不显示加号、不可编辑），需先进入分组（`focusedGroupId`）。

## 7. 文档地图

| 文档 | 回答什么问题 |
| --- | --- |
| [project-overview.md](project-overview.md) | 项目是什么、给谁用、做到什么程度 |
| [architecture.md](architecture.md) | 分层、数据流、存储结构、核心算法 |
| [DESIGN.md](DESIGN.md) | 视觉规则、颜色、动效、组件样式 |
| [component-api.md](component-api.md) | 每个组件 / store / utils 的接口 |
| [user-guide.md](user-guide.md) | 使用者怎么操作 |
| [development.md](development.md) | 怎么开发、怎么调试、回归清单 |
| [TODO.md](TODO.md) | 当前任务、优先级、已知问题 |
