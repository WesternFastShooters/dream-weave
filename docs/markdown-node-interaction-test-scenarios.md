# 文本节点用户交互测试场景

## 目标

验证 Markdown 文本节点从选择、编辑、缩放、自适应高度、拖动、连接到复制和删除的完整用户交互。文本节点指 `CanvasItem.kind === 'markdown'`，渲染组件为 [`MarkdownNode`](../packages/creative-nodes/src/nodes.tsx)。

本文定义用户可观察的行为，不把 CSS 像素和 Crepe 内部实现细节当作产品契约。

## 测试分层

| 层 | 验证内容 | 测试位置 |
| --- | --- | --- |
| 组件单元测试 | 选择/编辑状态、自动高度计算、resize 持久化命令、复制和删除命令 | `packages/creative-nodes/test/markdown-node*.test.tsx` |
| renderer 单元测试 | 四个连接手柄、手柄定位、从手柄创建 connection 命令 | `packages/canvas-renderer/test/canvas-connectable-node.test.tsx`、`canvas-renderer-connections.test.tsx` |
| Fixture Playwright | 鼠标、键盘、真实 React Flow 拖动、全部 resize 方向、可见的连接和操作菜单 | `apps/canvas/test/e2e/markdown-node.fixture-ui.spec.ts` |
| Real-service Playwright | 复制、删除、尺寸、内容和连接 reload 后的持久化 | `apps/canvas/test/e2e/markdown-node.real-service.spec.ts` |

每个涉及持久化的场景都要断言：本地 DOM 结果、发出的 canvas command、reload 后服务端 canvas snapshot 三者一致。

## 统一前置条件

1. 创建一个项目，放置两个不重叠的文本节点：`markdown-a` 与 `markdown-b`。
2. `markdown-a` 的初始 placement 为 `x=100, y=100, width=550, height=100, zIndex=1`。
3. `markdown-a` 初始 Markdown 为一行短文本；`markdown-b` 用作连接目标。
4. 画布处于 pointer 工具，缩放为 `1`，没有节点被选中。
5. 用 role、`data-id`、`aria-label` 和 canvas command 响应同步测试；不通过修改节点 `zIndex`、`pointerEvents` 或生产样式制造可点击状态。

## 场景 MN-01：首次点击选中并显示操作蒙层

层级：组件单元测试 + Fixture Playwright。

操作：

1. 点击未选中的 `markdown-a` 内容区域。
2. 不移动指针，释放鼠标。

断言：

1. `markdown-a` 成为唯一选中节点，React Flow 节点带 selected 状态。
2. 可见选中框、四角控制点和八个 resize 控件；控件仅在选中且未编辑时出现。
3. 内容编辑器仍为只读：`contenteditable="false"`、`aria-readonly="true"`。
4. `.dw-product-brief__interaction-overlay` 保持存在并覆盖内容区域，具备 `data-drag-handle` 和可访问名称“选择或拖拽文本节点”。
5. 节点 HoverToolbar 出现，至少含“复制一份”“导出 Markdown”“删除”；本场景不触发任何文档或 placement 命令。

反例：点击空白画布后，选中框、resize 控件、HoverToolbar 和 overlay 的选中交互状态全部消失。

## 场景 MN-02：选中后再次单击解除蒙层并进入编辑

层级：组件单元测试 + Fixture Playwright。

操作：

1. 在 MN-01 的选中状态下，于内容区域 click，不产生超过 3px 的位移。

断言：

1. interaction overlay 消失，编辑器获得焦点。
2. 编辑器变为 `contenteditable="true"` 和 `aria-readonly="false"`。
3. NodeResizer 与 HoverToolbar 在编辑期间隐藏，防止编辑输入同时触发缩放、复制或删除。
4. 输入文字后，Markdown 草稿更新；点击节点外部或按 Escape 后提交并退出编辑。
5. 提交后恢复 readonly overlay；文本内容与 `updateMarkdown` 命令一致。

边界：第一次点击只选中，拖动距离大于 3px 只执行拖动，不进入编辑；编辑器失焦时提交最后一个尚未被编辑器防抖回调传播的字符。

## 场景 MN-03：缩放尺寸、边界与持久化

层级：组件单元测试 + Fixture Playwright + Real-service Playwright。

尺寸契约：`minWidth=550`、`maxWidth=1100`、`minHeight=100`、`maxHeight=924.333`。

前置：`markdown-a` 处于 MN-01 的选中未编辑状态。

| 子场景 | 用户操作 | 必须断言 |
| --- | --- | --- |
| MN-03A 宽度 | 拖动右侧线控件向右、再向左越过最小宽度 | 宽度分别增大、被限制为 550；高度不变；结束时仅提交一次完整 placement。 |
| MN-03B 高度 | 拖动底侧线控件向下、再向上越过最小高度 | 高度分别增大、被限制为 100；宽度不变；结束时仅提交一次完整 placement。 |
| MN-03C 宽高同时变化 | 拖动右下角控制点向右下、再向左上越过最小值 | 宽高同时变化，并分别受上下限限制；结束时提交 x、y、width、height 四个完整字段。 |
| MN-03D 左/上锚点 | 分别拖动左侧与上侧线控件 | 宽度/高度变化时 x/y 跟随改变，对侧边缘在画布坐标中保持不动。 |
| MN-03E 其余角 | 拖动左上、右上、左下角控制点 | 两个相邻边的几何变化正确；不产生 NaN、负尺寸或超过边界的尺寸。 |

通用断言：

1. 选中且未编辑时恰好八个 `.react-flow__resize-control` 可见；未选中或编辑时为零。
2. 每个 resize 结束后 history 只有一个 `set-placements` 命令，命令带原 `itemId`、最终 `x/y/width/height/zIndex`。
3. Real-service 场景 reload 后尺寸、位置和 z-index 与提交后的 snapshot 完全一致。

## 场景 MN-04：新增段落、自动换行与最大高度滚动

层级：组件单元测试 + Fixture Playwright + Real-service Playwright。

### MN-04A 新段落立即增高

操作：进入编辑，重复输入 `Enter` 和一行短文本。

断言：

1. 每次新段落完成布局后，节点高度在下一个异步布局周期内增长；测试使用事件/高度轮询，不使用固定等待时间。
2. 每次增长前，节点高度不得低于 100；未达到最大值时，内容区域没有垂直滚动条。
3. 退出编辑时，所有本次自动高度变化合并为一个 `set-placements` 命令，不为每个按键持久化一次。

### MN-04B 自动换行立即增高

操作：把宽度保持在 550，在一行内连续输入足够长的无换行文本，使文本自动换为多行。

断言：

1. 高度按实际换行后的内容增加，不能只在 Enter 时增长。
2. 内容不被裁剪；在最大高度之前，内容区不需要滚动。
3. 调整节点宽度变窄后再次输入，自动换行仍触发同一增长规则。

### MN-04C 最大高度后滚动

操作：持续新增段落或长文本，直至达到 924.333。

断言：

1. 节点高度严格等于 924.333，继续输入不再增加节点高度。
2. 外层 surface 保持裁剪，内部 `.dw-product-brief__content` 成为可滚动区域，`overflow-y` 为 `auto` 或 `scroll`。
3. 最后一个段落可通过滚动到达；文本没有丢失。
4. 退出编辑、reload 后高度仍为最大值，内容和 placement 一致。

## 场景 MN-05：节点内容区与左上标题均可拖动

层级：组件单元测试 + Fixture Playwright + Real-service Playwright。

### MN-05A 内容区域拖动

操作：未选中或已选中但未编辑时，在 overlay 内 pointerdown，移动超过 3px 后 pointerup。

断言：

1. 节点在画布中按照指针位移移动，不进入编辑模式。
2. content 仍保持 `nodrag`；拖动权只由 overlay 的 `data-drag-handle` 提供。
3. 拖动结束只提交一次 `set-placements`；Real-service reload 后位置正确。

### MN-05B 左上“文本”标题拖动

操作：从节点左上角 `CanvasNodeTitle`（标题“文本”）开始拖动。

断言：

1. 标题具有 `data-drag-handle`，节点按位移移动。
2. 不进入编辑模式，不选中标题文字，不触发 Markdown 内容修改。
3. 位移和 MN-05A 一样以一次 placement 命令持久化。

### MN-05C 编辑保护

操作：在 MN-02 的编辑状态内，在文字内容上拖动以选择文本。

断言：文本选择/caret 行为保留；节点位置不改变；不会提交 `set-placements`。

## 场景 MN-06：四个连接点均可创建连接

层级：renderer 单元测试 + Fixture Playwright + Real-service Playwright。

前置：`markdown-a` 和 `markdown-b` 都可见，均未处于编辑状态。

| source handle | target handle |
| --- | --- |
| top | top、right、bottom、left |
| right | top、right、bottom、left |
| bottom | top、right、bottom、left |
| left | top、right、bottom、left |

对每一个 4 × 4 组合执行从 `markdown-a` 的 source handle 拖到 `markdown-b` 的 target handle。

断言：

1. `markdown-a` 渲染恰好四个 source handle，其 accessible name 依次为“从上侧连接”“从右侧连接”“从下侧连接”“从左侧连接”。
2. 手柄中心与文本 surface 的对应上/右/下/左边框对齐；节点 resize 后重新计算，不漂移。
3. 拖动时出现连接预览；释放后只创建一条边。
4. 创建命令包含 source/target item ID、准确的 source/target handle、唯一 connection ID 和默认样式 `curve/solid/forward`。
5. reload 后边仍存在，端点 handle 与 snapshot 完全一致。
6. 从手柄开始的 pointer 事件不得进入文本编辑或节点拖动。

## 场景 MN-07：复制与删除

层级：组件单元测试 + Fixture Playwright + Real-service Playwright。

### MN-07A 复制

操作：选中 `markdown-a`，在“节点操作”工具栏点击“复制一份”。

断言：

1. 产生一个新节点，ID 不同，Markdown、title 和 summary 与源节点一致。
2. 新节点 placement 为源节点的 `x+32, y+32`，并拥有当前最高 `zIndex+1`。
3. 源节点不改变；节点总数增加一；复制动作在执行期间工具栏处于 busy，重复点击不创建第二份。
4. Real-service reload 后两个节点均存在，几何和内容正确。

### MN-07B 删除未连接文本节点

操作：选中一个独立文本节点，点击“删除”。

断言：

1. 节点立即从画布消失，节点总数减少一。
2. 发出一个 `delete-item` 命令，item ID 与选中节点相同；工具栏操作不会传播为画布拖拽。
3. undo 恢复同一 ID、内容和 placement；redo 再次删除。
4. Real-service reload 后结果与当前 history 状态一致。

### MN-07C 删除已连接文本节点

操作：先按 MN-06 创建一条连接，再删除连接源文本节点。

断言：

1. 文本节点与其关联连接同时消失；未关联节点不受影响。
2. undo 同时恢复文本节点和连接；redo 同时删除二者。
3. Real-service snapshot 与 reload 后均没有残留 connection。

## 现有覆盖与新增范围

已有测试已部分覆盖二次点击编辑、Enter 新段落增长、最大高度和右边缩放：

- [`markdown-node-drag.test.tsx`](../packages/creative-nodes/test/markdown-node-drag.test.tsx)
- [`fixture-ui.spec.ts`](../apps/canvas/test/e2e/fixture-ui.spec.ts)

新增测试必须补齐 MN-03 的所有方向与最小边界、MN-04 的自动换行、MN-05 的标题拖动与编辑保护、MN-06 的 16 组连接端点、MN-07 的复制/删除及真实服务 reload。不要以现有的源码字符串检查替代这些用户交互断言。

## 验收命令

```bash
cd /path/to/dream-weave
pnpm --filter @dream-weave/creative-nodes test
pnpm --filter @dream-weave/canvas-renderer test
pnpm --filter @dream-weave/canvas-app exec playwright test --project=fixture-ui
pnpm --filter @dream-weave/canvas-app exec playwright test --project=real-service
```

完成标准：MN-01 至 MN-07 全部自动化；所有持久化场景均经 reload 验证；测试既覆盖正常路径，也覆盖最小/最大尺寸、编辑与拖动互斥、自动换行和已连接节点删除的边界。
