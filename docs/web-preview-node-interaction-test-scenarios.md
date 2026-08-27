# 网页预览节点用户交互测试场景

## 目标

验证网页预览节点（`CanvasItem.kind === 'web-preview'`）从工具栏放置、输入 URL、渲染、拖动、连接、复制/删除到进入网页交互的完整用户路径。

组件边界：

- 放置和 URL 表单：[`CanvasRenderer`](../packages/canvas-renderer/src/canvas-renderer.tsx)。
- 节点和 iframe：[`WebPreviewNode`](../packages/creative-nodes/src/nodes.tsx)。
- 四个连接点：[`withConnectionHandles`](../packages/canvas-renderer/src/canvas-connectable-node.tsx)。
- 复制和删除：[`CanvasNodeToolbarService`](../packages/creative-nodes/src/creative-node-service.ts)。

## 测试分层

| 层 | 验证内容 | 测试位置 |
| --- | --- | --- |
| renderer 单元测试 | 放置点转换、URL 成功/失败状态、connection 命令 | `packages/canvas-renderer/test/canvas-renderer-web-preview.test.tsx` |
| 节点单元测试 | iframe 沙箱、拖动句柄、选中/交互模式、复制删除命令 | `packages/creative-nodes/test/web-preview-node.test.tsx` |
| Fixture Playwright | 鼠标跟随、精确落座、URL 表单、拖动、四个连接点、选择与二次点击 | `apps/canvas/test/e2e/web-preview-node.fixture-ui.spec.ts` |
| Real-service Playwright | HTTPS URL 创建、服务端验证、持久化、reload 与 iframe 交互 | `apps/canvas/test/e2e/web-preview-node.real-service.spec.ts` |

对所有持久化场景，断言浏览器 DOM、发出的 canvas command 和 reload 后的 `GET /canvas` snapshot 一致。

## 统一前置条件

1. 画布使用 pointer 工具，viewport zoom 为 `1`，没有节点被选中。
2. 准备两个可见且不重叠节点：网页预览源节点 `web-a`，以及连接目标 `markdown-b`。
3. 准备可控的 HTTPS 页面 `https://preview.test/interactive.html`。页面显示唯一文本“预览加载成功”，包含可点击的计数按钮；它由测试运行环境提供，禁止依赖 `example.com` 等外部网站。
4. 页面 fixture 必须允许被 iframe 加载，且内容不请求外部资源。Real-service 运行时提供可验证的 HTTPS 解析和路由。
5. 使用 role、`data-id`、`aria-label`、网络响应和 snapshot 同步。不得通过直接修改节点 `zIndex`、`pointerEvents` 或生产 DOM 样式来绕过用户路径。

## 场景 WP-01：工具栏启动幽灵卡片并精确落座

层级：renderer 单元测试 + Fixture Playwright。

操作：

1. 点击画布工具栏“添加网页预览”。
2. 把鼠标移动到画布内的四个不同位置：左上、右上、左下、右下，且每个位置不与既有节点相交。
3. 在其中一个位置单击画布。

断言：

1. 点击工具栏后，在鼠标第一次进入画布前不显示幽灵卡片；进入后显示 `.dw-placement-draft--web.dw-placement-draft--moving`。
2. 幽灵卡片始终以鼠标位置为中心，尺寸为 `520 × 360`，不会随 viewport 或已有节点偏移。
3. 移动鼠标时幽灵卡片连续更新位置；其内部 URL 表单为 `inert`，不能抢占点击或焦点。
4. 单击画布后，幽灵卡片停止跟随，并在同一中心点变成可编辑 URL 表单。
5. 表单左上坐标应满足：`placement.x = screenToFlowPosition(click).x - 520 / (2 * zoom)`，`placement.y = screenToFlowPosition(click).y - 360 / (2 * zoom)`。
6. 放置阶段不创建节点、不发送 canvas command；仅在 URL 提交成功后创建节点。

边界：缩放为 `0.5`、`1`、`2` 时分别执行一次，断言最终 flow 坐标正确，避免以屏幕坐标直接保存导致偏移。

## 场景 WP-02：输入合法 URL 并成功渲染网页

层级：renderer 单元测试 + Fixture Playwright + Real-service Playwright。

操作：

1. 完成 WP-01 放置。
2. 在 URL 输入框填入 `https://preview.test/interactive.html`。
3. 点击“立即预览”。

断言：

1. 表单进入 saving 状态，重复提交被阻止。
2. 成功后表单和幽灵卡片消失，创建一个 `web-preview` 节点。
3. 节点 title 为 URL hostname，`url` 为输入 URL，placement 与 WP-01 落座坐标、`520 × 360` 尺寸一致。
4. 节点 iframe 的 `src` 为输入 URL，带 `sandbox="allow-scripts"` 与 `referrerpolicy="no-referrer"`；不提供“在新标签页打开”入口。
5. iframe 内显示“预览加载成功”，证明实际加载了受控网页，而非只验证 iframe 标签存在。
6. Real-service 场景等待 `CreateWebAsset` 和 canvas create command 均成功；reload 后 iframe、URL、title 和 placement 保持一致。

失败边界：对 `http:`、带 userinfo 的 URL、无效 URL 和服务端拒绝分别测试。断言表单保留输入、展示 `role="status"` 错误、没有创建节点或发送 create-item 命令。

## 场景 WP-03：网页预览内容区与左上标题都可拖动

层级：节点单元测试 + Fixture Playwright + Real-service Playwright。

### WP-03A 内容区拖动

操作：网页预览尚未进入网页交互模式时，从卡片内容区按住并移动超过拖动阈值后释放。

断言：

1. 节点跟随指针移动，iframe 不接收此次点击，且不触发页面内按钮。
2. 节点移动后只产生一条 `set-placements`，包含最终 x/y 和不变的 width/height/zIndex。
3. Real-service reload 后 placement 一致。

### WP-03B 左上标题拖动

操作：从左上角标题（hostname）开始按住并拖动。

断言：

1. 标题具有 `data-drag-handle`，节点位移与指针位移一致。
2. 不进入 iframe 交互模式，不触发 iframe 内按钮，不修改 URL。
3. 产生与 WP-03A 相同的一次 placement 持久化语义。

## 场景 WP-04：四个连接点均可拉出连接线

层级：renderer 单元测试 + Fixture Playwright + Real-service Playwright。

针对 `web-a` 的每个 source handle，分别连接到 `markdown-b` 的四个 target handle，执行完整 4 × 4 矩阵。

| source | target |
| --- | --- |
| top | top、right、bottom、left |
| right | top、right、bottom、left |
| bottom | top、right、bottom、left |
| left | top、right、bottom、left |

每组断言：

1. 网页预览节点渲染恰好四个手柄，accessible name 为“从上侧连接”“从右侧连接”“从下侧连接”“从左侧连接”。
2. 手柄中心与 `.dw-resource-node__surface` 对应边框对齐；节点拖动后仍保持对齐。
3. 从手柄拖动时显示连接预览，释放到目标后只创建一条 edge；不会拖动网页节点或进入网页交互。
4. `create-connection` 包含准确的 source/target node ID、source/target handle、唯一 ID 和默认样式 `curve/solid/forward`。
5. Real-service reload 后 edge 和 snapshot 的端点字段一致。

## 场景 WP-05：复制与删除

层级：节点单元测试 + Fixture Playwright + Real-service Playwright。

### WP-05A 复制

操作：选中 `web-a`，在节点操作工具栏点击“复制一份”。

断言：

1. 网页预览节点只显示“复制一份”和“删除”，不显示下载或导出 Markdown。
2. 创建新 ID 的节点；`assetId`、URL、title、summary、`embeddable` 与源节点一致。
3. 复制 placement 为源节点 `x+32, y+32`，并使用当前最大 z-index 加一。
4. 操作忙碌期间两个按钮 disabled，重复点击不能创建第二份。
5. Real-service reload 后两个独立节点都存在，URL 与几何一致。

### WP-05B 删除

操作：选中一个未连接网页预览节点，点击“删除”。

断言：

1. 节点立即从 DOM 消失，发出一个 `delete-item`，节点总数减一。
2. undo 恢复同一节点 ID、URL、title 和 placement；redo 再次删除。
3. 若节点已有连接，删除同时移除关联 edge；undo 同时恢复节点和 edge。
4. Real-service reload 后 snapshot 不含已删除节点或悬挂 connection。

## 场景 WP-06：选中后再次点击进入 iframe 交互

层级：节点单元测试 + Fixture Playwright + Real-service Playwright。

这是网页预览节点的两阶段交互契约：先选择/拖动节点，再明确进入页面，避免 iframe 抢走画布操作。

| 状态 | 用户操作 | 预期 |
| --- | --- | --- |
| 未选中 | 点击 iframe 覆盖的内容区 | 选中节点；iframe 不接收点击；显示节点操作工具栏。 |
| 已选中、未交互 | 再次点击内容区，位移不超过 3px | 进入 iframe 交互模式；iframe `pointer-events:auto`；不拖动节点。 |
| iframe 交互中 | 点击受控页面“计数”按钮 | iframe 内计数从 `0` 变为 `1`，证明真实输入被页面接收。 |
| iframe 交互中 | 点击画布空白处或选择其他节点 | 退出 iframe 交互模式；iframe `pointer-events:none`；恢复画布选择/拖动。 |
| iframe 交互中 | 从节点标题或连接手柄操作 | 标题仍可拖动、手柄仍可创建连接；iframe 不吞掉这些画布操作。 |

当前实现差距：`.dw-resource-node--web-preview .dw-web-preview-frame` 被固定为 `pointer-events:none`，`WebPreviewNode` 也没有“选中后再次点击”状态。因此 WP-06 在现有代码下应作为**先失败的验收测试**；实现须新增明确的 `interacting` 状态、iframe 交互开关和退出路径后才能通过。不得通过测试代码修改 iframe 的 inline `pointerEvents` 来伪造通过。

## 现有覆盖与新增范围

当前 Fixture Playwright 已部分覆盖幽灵卡片中心定位、`520 × 360` 表单尺寸、URL 创建和复制节点数量；当前 `web-preview-node.test.tsx` 覆盖 iframe 的基础卡片结构与 toolbar action 集合。

本计划新增或强化：

1. 三种 zoom 下的精确 flow 坐标与最终 placement。
2. 可控 HTTPS 页面真正渲染，以及 URL 失败路径。
3. 内容区与标题拖动、一次 placement 持久化和 reload。
4. 四个连接手柄的 16 组组合。
5. 删除、undo/redo、连接级联和 reload。
6. WP-06 的 iframe 二次点击交互；这是当前产品代码尚未实现的缺口。

## 验收命令

```bash
cd /path/to/dream-weave
pnpm --filter @dream-weave/creative-nodes test
pnpm --filter @dream-weave/canvas-renderer test
pnpm --filter @dream-weave/canvas-app exec playwright test --project=fixture-ui
pnpm --filter @dream-weave/canvas-app exec playwright test --project=real-service
```

完成标准：WP-01 至 WP-05 全部通过；WP-06 在实现 iframe 两阶段交互后通过。所有涉及创建、移动、连接、复制或删除的场景都经真实服务 reload 验证。
