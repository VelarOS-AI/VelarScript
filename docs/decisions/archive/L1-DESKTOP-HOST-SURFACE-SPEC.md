# L1 — 宿主能力面 v2 可执行规格（任务简报，D101 第 1/3 条的落实）

状态：spec approved for implementation（设计者：本场；依据 D101）。
完备性边界 = VelarOS-Desktop 实际使用的宿主符号清单（评估 2026-08-27）。
边界内穷尽设计；菜单栏、托盘、全局快捷键、深链**不在本规格**（产品零使用，
类别由未来真实消费者证据决定）。

本规格全部落在 `@velarscript/desktop` 扩展；Core 与 Web 不认识其中任何概念。
所有权限先于 API：manifest 未声明的能力，check 期能拒绝的拒绝，运行期一律
fail-closed。所有特权操作是异步受检调用，在**使用处**失败（D60 第 153 条），
handle 是 `using` 所有权资源，事件一律有界拉取（无回调堆积）。

## 1. Manifest v2（`desktop` 段重构）

```json
{
  "desktop": {
    "productName": "Example",
    "identifier": "com.example.app",
    "windows": {
      "main": {
        "title": "Example",
        "width": 1280, "height": 820,
        "minWidth": 720, "minHeight": 520,
        "titleBar": "standard",
        "material": "none"
      },
      "browser-preview": {
        "style": "panel",
        "frame": false,
        "level": "floating",
        "visibleOnAllWorkspaces": true,
        "aspectRatio": 1.6,
        "width": 480, "height": 300
      }
    },
    "permissions": {
      "files": ["app-data", "project", "dropped"],
      "processes": [],
      "network": [],
      "environment": [],
      "secrets": [],
      "links": ["https", "mailto"],
      "notifications": true,
      "secureStorage": ["cloud-session"]
    }
  }
}
```

- 旧 `desktop.window` 单数形态**删除**，由 `desktop.windows` 映射取代；
  `"main"` 条目必填、启动时自动打开。`velar fix` 提供
  `window: {...}` → `windows: {main: {...}}` 的机械迁移。
- 窗口种类名是封闭集合：小写字母与连字符，≤32 个种类。未声明的种类在
  `openWindow` 调用处是 check 期错误（字面量时）与运行期拒绝（动态时）。
- 每种窗口的字段（全部有默认值，knownFields 封闭）：
  `title`（默认 productName）、`width/height/minWidth/minHeight`（沿用现有
  边界校验）、`titleBar: "standard" | "hidden-inset"`、
  `material: "none" | "sidebar"`（macOS vibrancy；`sidebar` 隐含透明背景）、
  `style: "window" | "panel"`（panel = NSPanel，非激活、浮动、不参与窗口
  循环）、`frame: bool`（默认 true；false = 无边框）、
  `level: "normal" | "floating"`、`visibleOnAllWorkspaces: bool`、
  `aspectRatio: number?`（>0，锁定纵横比）、`resizable: bool`（默认 true）。
- 新权限类别：
  - `links`：`openExternal` 允许的 **scheme 白名单**，值域封闭
    `["http", "https", "mailto"]`（对应产品 ExternalOpenPolicy 现状）。
  - `notifications: bool`（默认 false）——声明意图；真实授权仍由 OS 向
    用户请求。
  - `secureStorage`：钥匙串条目名的有限白名单（与 `secrets` 语义不同：
    `secrets` 是环境注入的只读不透明值，`secureStorage` 是应用读写的
    命名凭据槽）。名字规则与 `secrets` 相同，两个清单不得重名。
  - `files` 新增特殊根 `"dropped"`：授权读取**用户拖入手势**带来的文件
    与获取其真实路径。用户手势即授权，会话内有效。

## 2. `velar/window`（新模块）

```velar
import {openWindow, currentWindow, currentWindowKind, windows} from "velar/window"

const preview = await openWindow("browser-preview", {
    route: "/browser-preview?session=42",
    key: "session-42",
})
```

- `currentWindowKind() -> string` — 同步，返回本执行环境所在窗口的种类。
- `currentWindow() -> Window` — 本窗口的 handle（不拥有：close 当前窗口即
  关窗，但 `using` 释放**不**关闭当前窗口）。
- `openWindow(kind: string, options: OpenWindowOptions) -> Promise<Window>`
  - `OpenWindowOptions`: `route: string`（应用内路径+查询串；新窗口加载同一
    应用入口，Router 看到该位置）、`key: string?`（实例键；同 kind+key 已
    存在时聚焦既有窗口并返回其 handle）、`bounds: WindowBounds?`（初始位置
    尺寸，越界钳到所在屏幕工作区）。
  - 返回的 `Window` 是 `using` 所有权资源：释放 = 关闭该窗口（幂等）。
- `windows() -> Promise<List<WindowInfo>>` — `{kind, key?, focused}` 快照。
- `Window` 成员（全部异步受检）：
  `focus()`、`close()`、`bounds() -> WindowBounds`、
  `setBounds(bounds: WindowBounds)`、`display() -> Display`、
  `watchState() -> WindowStateStream`。
- `WindowStateStream` 是有界拉取流（形态对齐 `watchFiles`）：事件
  `moved | resized | focused | blurred | closed`；`closed` 后流正常耗尽；
  队列有界，慢消费者合并同类事件（moved/resized 只保留最新）。
- `WindowBounds = {x: number, y: number, width: number, height: number}`，
  屏幕坐标，原点左上。
- 宿主固定行为（无旋钮）：关闭 main 窗口先关闭全部其他窗口再退出应用；
  最后一个窗口关闭即退出。第二次启动同一应用由 macOS 激活既有实例
  （打包产物天然单实例；作为宿主保证写入测试）。

## 3. `velar/notification`（新模块）

```velar
import {requestPermission, show, activations} from "velar/notification"
```

- `requestPermission() -> Promise<NotificationPermission>`，枚举
  `granted | denied | undetermined`。未授权时 `show` 以能力错误失败关闭
  （不静默吞掉）。
- `show(notification: {title: string, body: string, tag: string?}) ->
  Promise<null>` — 系统通知中心投递；字段长度有界（title ≤256，body ≤1024，
  tag ≤128）。
- `activations() -> NotificationActivationStream` — 有界拉取流；用户点击
  通知产生 `{tag: string?}`，宿主同时把对应窗口带到前台（无窗口时打开
  main）。
- manifest `notifications: true` 缺席时，三个函数在调用处失败关闭。

## 4. `velar/secure-storage`（新模块）

```velar
import {set, get, remove} from "velar/secure-storage"
```

- `set(name: string, value: string) -> Promise<null>`（value ≤ 8 KiB）、
  `get(name: string) -> Promise<string?>`、`remove(name: string) ->
  Promise<null>`（幂等）。
- `name` 必须在 manifest `secureStorage` 白名单内，否则调用处失败关闭。
- macOS 实现：钥匙串 generic password，service = bundle identifier，
  account = name。值不进入日志、不进入诊断、不参与 `velar repro`。

## 5. `velar/desktop` 增量

- `openExternal(url: string) -> Promise<null>` — 交给系统默认处理器打开；
  scheme 必须在 `links` 白名单，主机侧再验一次后 `NSWorkspace.open`。
- `displays() -> Promise<List<Display>>`，
  `Display = {id: string, bounds: WindowBounds, workArea: WindowBounds,
  scale: number, primary: bool}`。
- `watchPower() -> PowerStream` — 有界拉取流，事件 `suspended | resumed`
  （对应产品 powerMonitor 的睡眠/唤醒消费）。
- `watchDroppedFiles() -> DroppedFilesStream` — 有界拉取流；每次用户拖入
  手势产生 `{paths: List<string>}`（真实文件系统路径，顺序与拖入一致）。
  需要 `files` 含 `"dropped"`；DOM 侧照常拿到 `File` 内容，本流只补路径。
  宿主实现：WKWebView 拖放拦截登记路径表，与 DOM drop 事件同手势对应。
- `permissionStatus(kind) -> Promise<PermissionStatus>`，`kind` 枚举
  `screen-recording | accessibility | microphone`，返回
  `granted | denied | undetermined`（只读探针，对应产品 systemPreferences
  的 computer-use 就绪检查；不提供申请函数——申请属于消费它的产品流程）。

## 6. 明确不做（本规格的边界裁决，将来翻案需新证据）

- 菜单栏 / 托盘 / 全局快捷键 / 深链 / dock badge / 剪贴板宿主面 /
  崩溃上报 / 光标全局位置 / `nativeImage` 等价物 / 通用 save 面板 /
  webview 分区策略（随 `<webview>` 之死一并退场）/ 窗口间同 JS 上下文
  （popout 的跨窗口状态是应用经其服务进程解决的事，语言不提供共享上下文）。
- 渲染器内导航、DevTools 开关、视口恢复：宿主内部行为，不成 API。

## 7. 实现与验收要求

- 全部新模块进 `desktopModuleInterfaces` 与桥 ABI（`velar.desktop.bridge.v1`
  不升版：新增 host field/capability 即可；bridge 缺席时行为遵守 D60 153）。
- Swift 宿主：窗口注册表（kind+key → NSWindow/NSPanel）、通知
  （UNUserNotificationCenter）、钥匙串（Security.framework）、显示器与
  电源（NSScreen / NSWorkspace notifications）、拖入路径登记、外链 scheme
  复验。worker.js 预计零改动（以上全为 Swift 侧能力）。
- `velar/desktop-test` 为每个新模块提供同形假件（`setPlatform` 模式）：
  假窗口注册表、假通知收件箱、假钥匙串、假拖入注入、假电源事件。
- 权限缺席矩阵逐项测试：无 grant → 调用处 fail-closed 且错误报出缺哪条。
- `examples/tour/desktop/` 新增窗口/通知/安全存储/拖入四个可运行示例；
  browser tests 覆盖。`docs/ai-skill-desktop.md`、`docs/standard-library.md`
  的 Desktop 段、`docs/cli.md` 的 manifest 文档同步；文档代码块过
  `check-documentation-examples`。
- `velar fix` 携带 `window` → `windows.main` 迁移；`velar check` 对旧形态
  给出指向迁移的错误。
- 分两波实现：**L1a** = manifest v2 + `velar/window` + Swift 窗口系统 +
  迁移；**L1b** = notification / secure-storage / desktop 增量 + 假件补全
  + tour 与文档收尾。每波结束跑 desktop 全部测试与打包门。
