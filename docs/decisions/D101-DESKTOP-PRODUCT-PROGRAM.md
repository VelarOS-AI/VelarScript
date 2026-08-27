# D101 — 桌面产品级目标计划（用户裁决 2026-08-27）

## 背景

VelarOS-Desktop（Electron 41 + React 19，`src` 约 22.6 万行）将把外层壳换成
VelarScript desktop 目标；完整评估与七项产品侧裁决记录在新仓
`VelarOS-Desktop-Vel`（`docs/decisions/0001-program-rulings.md`）。产品对宿主的
真实依赖面出乎意料地窄——17 个 Electron 符号、6 个 preload 桥成员——它构成本
计划语言侧能力清单的完备性边界。

用户当日裁决，全程有效：

- 语言问题先处理；实现过程中发现的语言缺陷**优先**处理；
- **语言边界不可破坏**；
- Web 扩展性能未经测试，需要先拿到证据；
- 实现层面的坑直接修；**设计冲突层面的问题先向用户汇报**。

## 裁决

1. 语言侧以六个工作包把 desktop 目标从最小应用补到产品级：
   **L1** 宿主能力面 v2；**L2** 自包含运行时与签名发布链；**L3** 产品服务进程
   一等化；**L4** 外语契约代码生成器；**L5** 画面帧渲染的外部适配器；
   **L6** 稳定判据与 CI 收口。每包启动前有单独的可执行规格（存于
   `archive/`，按任务简报惯例）。
2. **边界不动摇。** Core 不认识窗口、通知、钥匙串；一切宿主能力经
   `@velarscript/desktop` 扩展进入，权限清单先于 API。具体引擎与第三方集成
   按 D87/D88/D91 的三层归属留在外部：L4 生成器是 `@velarscript-labs` 工具
   包（不进语言语义），L5 是 labs 外部适配器（不新增 `velar/canvas`；
   `velar/game` 维持延后，此裁决不预支它）。
3. L1 的完备性边界是**产品实际使用的宿主符号清单**：多窗口与窗口控制、通知、
   dock、安全存储（钥匙串）、电源与屏幕信息、拖入文件取路径、外链打开、系统
   权限探针、单实例。边界内穷尽设计，不做站点计数门控。菜单栏、托盘、全局
   快捷键、深链**不进入本计划**——产品现状零使用，类别是否存在由真实消费者
   证据决定（与 D83 归档条件同型）；这是边界的一部分，不是欠账。
4. L2：`velar package` 产物必须自包含——嵌入受支持的 Node 运行时，最终用户
   不需要预装任何东西——并且可签名、可公证、可更新。签名身份、entitlements、
   更新 feed 策略归产品；机制（打包、校验、替换、回滚原语）归 CLI。
5. L3：desktop 清单允许声明**产品拥有的长驻服务进程**（拉起、监督、崩溃
   处置、随应用退出收敛），壳与服务经回环 WebSocket 通信。这不开放通用 IPC
   面；产品级服务本身仍不属于语言能力，与 `ai-skill-desktop.md` 的排除清单
   一致——语言提供的是「宿主一个服务进程」的机制，不是服务本身。
6. L6 稳定判据（「先把语言层做稳定」的可执行定义）：
   - 0.20 冻结点 = CI 运行完整门（`check` + `test:full` + `test:browser` +
     `test:packages`），不再只跑 `check`。此条**取代**此前「CI 只跑源质量
     门、不重复发布套件」的姿态（旧姿态成文于
     `docs/contributing/continuous-integration.md` 并由
     `tests/ci.acceptance.ts` 强制；两处已随本条改写）；
   - `VelarOS-Desktop-Vel` 进入 project gate，成为 dogfood 消费者；
   - 计划期间的破坏性变更必须附迁移说明，且尽可能被 `velar fix` 机械迁移；
   - 会话流渲染基准（聊天流场景：流式追加、keyed 列表、高频状态发布）建立
     后纳入门禁——Web 扩展的性能主张此前视为未证。
7. 平台广度：本计划只交付 macOS 宿主（WKWebView）。Windows（WebView2）与
   Linux（WebKitGTK）是 desktop 目标的后续里程碑，不阻塞本计划，也不因本
   计划的 macOS 实现形状而被预先决定。

## 所有权

语言仓拥有 L1/L2/L3/L6 与 `@velarscript/desktop` 扩展本体；L4 与 L5 归
`VelarScript-Libraries`（`@velarscript-labs`）；产品侧裁决、重制蓝图与分期
（P0–P4）归 `VelarOS-Desktop-Vel` 仓。评估全文与依据（三仓探查报告）见该仓
`docs/blueprint.md`。
