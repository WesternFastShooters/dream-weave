# CanvasBottomToolbar React 行为语义测试

## 目标

为 [`CanvasBottomToolbar`](../packages/canvas-renderer/src/canvas-bottom-toolbar.tsx) 建立 React 组件级测试。测试用户可感知的行为、无障碍语义和组件与服务的边界调用。

本计划只覆盖该组件。画布框选、节点创建落点、文件上传 API、后端持久化和 Playwright 端到端流程不在此范围内。

## 被测边界

组件输入：

- `assetUpload`：上传状态、订阅和 `upload(files)`。
- `onBeginMarkdownPlacement`：启动文本放置。
- `onBeginWebPreviewPlacement`：启动网页预览放置。
- `onBeginFrameDrawing`：启动画框。
- `lassoShape` / `onLassoShapeChange`：矩形与线条套索的选择状态。
- `ICanvasInteractionService`：当前工具状态与状态订阅。
- `ICanvasEventService`：`set-tool-mode` 请求。

组件输出：DOM、ARIA 属性、回调、上传服务调用与事件服务请求。

## 测试位置与工具

在 `packages/canvas-renderer/test/canvas-bottom-toolbar.behavior.test.tsx` 新增用例。

使用：

- Vitest。
- React Testing Library 的 `render`、`screen`、`fireEvent` 和 `within`。
- `@testing-library/user-event`；若当前包未安装，将其加入 `packages/canvas-renderer/devDependencies`。
- DI 容器或现有 `useService` 测试辅助方法，为两个服务提供 fake 实现。

保留现有 [`canvas-bottom-toolbar.test.ts`](../packages/canvas-renderer/test/canvas-bottom-toolbar.test.ts)，但把它限定为源码/图标/样式约束测试。不得把字符串匹配当作行为测试。

## 测试夹具

每个用例创建独立的组件夹具，禁止共享可变状态。

```ts
type UploadPhase = 'idle' | 'uploading' | 'failed';

interface ToolbarFixture {
  interaction: {
    snapshot: { toolMode: 'pointer' | 'hand' | 'freeform-lasso' };
    emit(next: Partial<{ toolMode: 'pointer' | 'hand' | 'freeform-lasso' }>): void;
  };
  events: { request: Mock };
  upload: {
    snapshot: { phase: UploadPhase; errorMessage: string | null };
    upload: Mock;
    emit(next: Partial<{ phase: UploadPhase; errorMessage: string | null }>): void;
  };
  callbacks: {
    beginMarkdown: Mock;
    beginWebPreview: Mock;
    beginFrame: Mock;
    changeLassoShape: Mock;
  };
}
```

夹具要求：

1. `interaction.getSnapshot()` 返回当前 `snapshot`，`onDidChange.subscribe` 注册订阅并返回可验证的 dispose。
2. `interaction.emit()` 触发订阅，模拟画布快捷键或其他组件改变工具状态。
3. `events.request` 使用 `vi.fn()`，记录完整 `{ type: 'set-tool-mode', toolMode }`。
4. `upload.getSnapshot()` 与 `upload.onDidChange.subscribe` 同样可主动发射 `idle`、`uploading`、`failed`。
5. 组件通过真实 DI Provider 渲染；不 mock `CanvasBottomToolbar` 内部的 `useState`、`useEffect` 或事件处理函数。

## 必须覆盖的行为

### 1. 初始语义与状态同步

1. 默认 `toolMode: 'pointer'` 时，工具栏有 `role="toolbar"` 和名称“画布工具”。
2. “矩形套索”具有 `aria-pressed="true"`，手形工具具有 `aria-pressed="false"`。
3. 初始 `toolMode: 'hand'` 时，状态反转且手形按钮带 active class。
4. `interaction.emit({ toolMode: 'hand' })` 后，已渲染按钮状态更新；再次发射 `pointer` 后恢复。
5. 卸载后两个服务订阅均 dispose 一次，之后发射状态不引起 React 更新。

### 2. 手形、指针和工具事件

1. 点击“手形工具”只发送一次：
   ```ts
   { type: 'set-tool-mode', toolMode: 'hand' }
   ```
2. 点击“矩形套索”只发送一次：
   ```ts
   { type: 'set-tool-mode', toolMode: 'pointer' }
   ```
3. 按钮 `pointerdown` 不向父容器冒泡，避免触发画布选择或拖拽。
4. 每次工具切换都关闭已打开的套索菜单。

### 3. 套索下拉菜单

1. 点击“选择套索工具”后，按钮 `aria-expanded="true"`，显示一个 `role="menu"`。
2. 菜单含两个 `role="menuitemradio"`：矩形套索与线条套索。
3. `lassoShape="rectangle"` 时矩形项 `aria-checked="true"`；`lassoShape="line"` 时线条项为 true，主按钮 accessible name 变为“线条套索”。
4. 选择矩形项时调用 `onLassoShapeChange('rectangle')`，并发送一次 pointer 工具请求，再关闭菜单。
5. 选择线条项时调用 `onLassoShapeChange('line')`，并发送一次 pointer 工具请求，再关闭菜单。
6. 点击工具栏外部的 `document.body` 后关闭菜单，且移除 document listener。
7. 菜单打开时按 Escape 后关闭菜单；该按键不得额外调用 `events.request`。

### 4. 三个创建动作

1. 点击“添加文本”只调用 `onBeginMarkdownPlacement` 一次。
2. 点击“添加网页预览”只调用 `onBeginWebPreviewPlacement` 一次。
3. 点击“画框工具”只调用 `onBeginFrameDrawing` 一次。
4. 三个按钮均不产生 `set-tool-mode`、上传调用或其他创建回调。
5. 三个按钮的 `pointerdown` 都不会冒泡。

### 5. 文件上传语义与状态

1. 未传入 `assetUpload` 时，“添加文件”处于 disabled；点击不访问隐藏 input。
2. `assetUpload` 为 `idle` 时，点击“添加文件”调用隐藏 `input[type=file]` 的 `click()` 一次。
3. 通过 input change 选择两个 `File` 后，调用一次 `upload([fileA, fileB])`，顺序与 FileList 一致。
4. 上传调用后 input value 被清空；同一文件再次选择时仍会触发上传。
5. `uploading` 时按钮 disabled 且 `aria-busy="true"`，显示省略号；点击不重复打开选择器。
6. `failed` 时显示 `role="status"` 与服务提供的错误文案；恢复为 `idle` 后状态消失。
7. 断言 input 同时有 `multiple`、`aria-hidden="true"` 和当前的 `accept` 值；仅断言语义，不重复枚举图标 SVG 路径。

## 不测试的事项

以下逻辑由其他层负责，不能在本组件测试中以 mock 方式重复验证：

- pointer、hand 和 freeform-lasso 在 React Flow 中的真实拖拽、平移与选择效果。
- Markdown、Web、Frame 在画布中的实际位置和持久化。
- 上传文件类型的服务端识别、S3 上传、预览任务和错误码。
- CSS 像素、SVG path、截图和 tooltip 外观。
- 浏览器真实文件选择器打开。

## 实施顺序

1. 添加 Test Provider 与三种 fake 服务；先写“初始语义与状态同步”。
2. 添加手形/指针及套索菜单测试，覆盖所有 event request 和 ARIA 状态。
3. 添加三个创建动作与 pointer 事件隔离测试。
4. 添加上传 input、uploading、failed 和订阅清理测试。
5. 运行 renderer package 全量测试，确认原字符串测试与新增行为测试都通过。

## 验收命令

```bash
cd /path/to/dream-weave
pnpm --filter @dream-weave/canvas-renderer test
```

完成标准：新增测试渲染真实 `CanvasBottomToolbar`，每个公开按钮都有用户事件断言，每个状态变更都有 DOM/ARIA 或服务调用断言；测试不读取组件源码字符串来证明行为。
