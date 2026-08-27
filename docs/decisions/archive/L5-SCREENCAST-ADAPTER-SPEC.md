# L5 — 画面帧渲染外部适配器可执行规格（任务简报，D101 第 1/2 条的落实）

状态：spec approved for implementation。交付物落在 **VelarScript-Libraries**
（`@velarscript-labs/screencast`，`kind: "adapter"`）。不新增 `velar/canvas`，
不动语言（D101 第 2 条明文；`velar/game` 维持延后，本包不预支它）。
消费者：VelarOS-Desktop-Vel 的浏览器工作区与预览窗（P3），产品裁决 0001-6
（CDP screencast 替代 `<webview>`）。

## 1. 边界（先说清楚不做什么）

适配器只做一件事：**把编码帧流画到一个宿主给的 canvas 元素上**。
- 不说 CDP：`Page.screencastFrame` 的会话、ack、传输全归产品的 browser
  core（TS sidecar 既有能力）。
- 不合成输入事件、不做坐标反投——产品自己算（适配器只暴露当前
  letterbox 几何,见 §3）。
- 不创建 canvas：元素由 Vel 应用的 JSX 渲染,以 `ref` 交给适配器
  （extern 实参按语言契约以裸身份跨界,这正是把 DOM 节点交给外语的
  既定姿势）。

## 2. API（Vel 源包 + 带契约的 `extern js` 内联实现）

```text
attach(canvas, options?) -> ScreencastSurface     // using 所有权资源
ScreencastSurface.submitFrame(bytes: Bytes, frame: FrameInfo) -> null
ScreencastSurface.geometry() -> SurfaceGeometry
ScreencastSurface.watchErrors() -> 有界拉取错误流
释放 = 停止解码、清空挂起帧、断开 canvas
```

- `FrameInfo = {width, height, format: jpeg | png}`；`bytes` 是解码前的
  帧数据（`Bytes`，≤16 MiB 上限，超限拒绝）。
- 解码用 `createImageBitmap`,绘制用 2D context;**挂起解码永远最多一帧**:
  新帧到来时丢弃未开始解码的旧帧（keep-latest）,解码中则标记待替换。
  慢消费者永不积压内存。
- 尺寸与 DPR:适配器按 canvas 的 CSS 尺寸 × devicePixelRatio 维护后备
  存储,帧按等比 letterbox 绘制;`SurfaceGeometry =
  {contentBounds, scale}` 供产品做坐标映射。
- 解码失败进错误流（帧序号 + 原因）,不崩溃、不中断后续帧。

## 3. 验收

- 生成帧夹具（确定性图案序列）驱动:keep-latest 在人为慢解码下丢弃
  正确的帧;几何在 resize/DPR 变化后正确;释放后 submitFrame 失败关闭。
- 浏览器测试跑 chromium 与 webkit（产品目标是 WKWebView）。
- `supportedVelarScript` 钉当前代;登记 catalog.json
  （status: experimental）;仓门（check/test/pack:check）全绿。
- 一个最小可运行示例:Vel 应用 + 假帧源,README 演示 attach→submit→
  dispose 全链。
