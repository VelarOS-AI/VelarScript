# L3 — 产品服务进程一等化可执行规格（任务简报，D101 第 5 条的落实）

状态：spec approved for implementation。实施顺序：在 L1b 与 L2 之后于同一
分支链进行（冲突面：manifest、Swift 宿主、build.ts、打包签名）。

## 1. 概念与信任模型（先说清楚）

服务进程是**产品拥有的长驻进程**：产品的策略、产品的权限、产品的代码。
语言提供的只有四件事——声明、拉起与监督、退出收敛、一条受认证的回环
通道。语言**不**对服务进程施加 capability 权限模型（它不经过 capability
worker），manifest 声明它是为了审计可见，不是为了沙箱；这与
`ai-skill-desktop.md` 的排除清单一致（产品级服务不是语言能力）。

## 2. Manifest

```json
{
  "desktop": {
    "services": {
      "core": {
        "payload": "dist/service-core",
        "entry": "main.js",
        "restart": "always"
      }
    }
  }
}
```

- `services` 映射，键名规则与窗口种类一致（小写连字符，≤8 个服务）。
- `payload`：项目内目录，`velar package` 时整目录复制进
  `Contents/Resources/services/<name>/`；`entry` 是 payload 内相对路径的
  JS 入口。payload 尺寸单独成清单组件，计入应用预算（它是应用代码）。
- `restart`：`"always" | "never"`。`always` = 指数退避重启（1s 起、上限
  30s、连续 5 次失败进入 `failed` 终态并停止重启）。
- 运行时：**捆绑的 Node**（L2 的嵌入运行时），不允许声明其他可执行文件
  ——需要别的进程用 `velar/process` 与 `processes` 白名单，那是短任务
  模型；服务进程模型只此一种运行时，避免第二个供应面。
- dev 模式：`velar dev` 用系统 Node（既有解析顺序）直接以
  `<project>/<payload>/<entry>` 拉起同一组服务，随 dev server 退出收敛。
  监视与重建是产品自己的工具链的事，`velar dev` 不做服务热重载。

## 3. 通道：宿主分配端点，服务端听，应用连

- 宿主为每个服务生成 128 位随机 token 与一个回环 TCP 端口（127.0.0.1:0
  取容），以环境变量交给服务进程：`VELAR_SERVICE_ENDPOINT=127.0.0.1:<port>`、
  `VELAR_SERVICE_TOKEN=<token>`。服务必须在该端点上起 WebSocket 服务端
  （产品侧用任意实现；Vel 写的服务可用 `velar/websocket.listen`）。
- 就绪判定：宿主对端点做认证握手探测（连接后首帧
  `{"velar":"service-hello","token":...}`，服务回
  `{"velar":"service-ready"}` 后关闭探测连接）。握手细节由实现钉死并写入
  `packages/desktop/README.md`，两端各自超时（默认 30s）。
- 渲染侧新模块 `velar/service`：
  - `connect(name: string) -> Promise<ServiceConnection>` —— 返回已认证的
    WebSocket 形连接，类型与 `velar/websocket` 客户端一致（发送背压、
    有界拉取接收、`using` 所有权）；未声明的服务名在调用处失败关闭。
    token 由宿主注入通道完成，**不经过应用代码**（应用拿不到 token）。
  - `watchServices() -> ServiceStateStream` —— 有界拉取流，事件
    `{name, state}`，`state` 枚举
    `starting | ready | restarting | failed | stopped`；慢消费者对同名
    服务合并保最新。
- 服务进程之间、服务与外界的其他通信（unix socket、HTTP、Kernel RPC）
  全是产品自己的事，语言不管也不挡。

## 4. 生命周期

- 启动：宿主在渲染器加载**之前**开始拉起服务（并行），不等就绪——应用
  自己用 `watchServices()`/`connect()` 处理未就绪状态。
- 退出：应用退出时宿主向服务发 SIGTERM，30s 期限后 SIGKILL（与
  `velar/host.onShutdown` 的既有语义同型）；服务退出码不影响应用退出码。
- 崩溃：按 `restart` 策略处理并通过 `watchServices()` 可见；`failed`
  终态不自动恢复（产品可提示用户重启应用）。
- 单窗口/多窗口无关：服务随应用生命周期，与窗口无关。

## 5. 打包与签名

- payload 内的 Mach-O（原生插件 `.node`、`.dylib`）纳入 L2 的 inside-out
  签名遍历（按发现顺序先签叶再签根）；hashTree 覆盖 payload。
- `--headless-smoke` 扩展：声明了服务的应用，烟测包含「服务拉起 →
  认证握手 → ready → 收敛退出」一轮。
- 清单 v4 增 `services` 组件（名称、字节数、入口哈希）。

## 6. `velar/desktop-test` 假件

- 假服务注册表：`setServiceState(name, state)` 注入状态事件；
  `serveService(name, handler)` 在测试内起真实回环 WebSocket 供
  `connect()` 走通（与 `velar/websocket` 测试基建复用）。

## 7. 验收

- 声明/未声明矩阵；token 错误被服务端拒绝；就绪超时进入 `restarting`；
  退避与 `failed` 终态；SIGTERM 收敛与 SIGKILL 期限；`velar dev` 与打包
  两形态各跑一轮真实往返；文档（ai-skill-desktop、cli.md、README）与
  tour 示例（desktop-test 驱动 + 一个真实回环服务示例）齐备过门。
