# L4 — 外语契约代码生成器可执行规格（任务简报，D101 第 1/2 条的落实）

状态：spec approved for implementation。交付物落在 **VelarScript-Libraries**
（`@velarscript-labs/contract-codegen`，`kind: "tooling"`，同 editor-kit 一栏），
不进语言工具链、不进语言语义（D101 第 2 条）。消费者是 VelarOS-Desktop-Vel：
壳要以受检类型消费 sidecar 的 252 个 IPC 契约与 `@velaros-ai/agent/protocol`
（`ChatStreamEvent` 11-case 判别联合）等 zod wire 契约。

## 1. 机制：运行时内省，不做 TS AST 解析

- 工具在 Node 里**加载**契约包的编译产物，遍历导出的 zod schema 对象
  （`_def` 内省），输出 `.vel` 类型声明。zod 是数据，内省比语法分析可靠。
- 支持的 zod 主版本 = platform 锁定的那一个；运行时校验版本，不匹配即
  拒绝并说出两边版本。
- 输入是消费项目里的一份 JSON 清单：要加载的模块标识符、要遍历的导出
  （或全部 zod 导出）、输出目录、命名规则。CLI：
  `velar-contract-codegen generate <manifest>`；`--check` 模式重新生成并
  逐字节比对（机器可读清单 + 字节比对门，仿 platform 的
  `check:package-catalog` 惯例）。输出确定性排序，过 `velar format`。

## 2. 类型映射（封闭表，超出表的形状 fail-closed 并点名 schema 路径）

| zod | Vel |
| --- | --- |
| string / number / boolean / null | string / number / bool / null |
| optional / nullable / undefined | `T?`（沿 interop 的 undefined→null 归一） |
| literal 字符串联合、z.enum | Vel enum（非标识符字面量走成员映射 wire 值机制） |
| strictObject / object(strict) | 记录 type |
| discriminatedUnion | 标签 enum + 各 case 记录 + 联合别名（charter §6 形状） |
| 原始类型联合 | Vel 联合 |
| array | List |
| record(string, V) | 语言的字符串键映射形（实现时按 charter 当前拼写选定） |
| lazy / 自引用 | 实现期验证语言递归类型支持；不支持即停下报告（设计冲突路径） |

- 非 strict 的 object、transform/refine/effects、z.date、无判别式的记录
  联合：**不猜**。默认 fail-closed；清单可按 schema 路径显式豁免为
  `unknown` 降级，每个豁免进生成报告（对齐 VEL9002 的「降级要出声」姿态）。
- 语义约束（refinement 的谓词）不跨语言：记录进报告，消费侧自负。

## 3. 通道表（v1 的第二产物；传输 stub 明确不做）

- 对 `@velaros/ipc` 形状的「通道名 → 请求/响应类型」映射，生成 Vel 数据表
  （通道名常量 + 类型引用），供产品侧薄传输层用 `Type.parse` 在边界校验。
- **不生成传输 stub**：信封（id/ok/error 形状）、重试、超时是产品协议，
  烘进 labs 工具就是越界。P1 出现真实消费者后如证明模板值得做，另立
  规格（边界规则：类别由消费者证据决定）。

## 4. 等价性验收（工具自身的门）

- 金样本夹具：每类映射形状配 N 个正/负样本 payload，断言
  `zod.parse 通过 ⟺ 生成类型的 Type.parse 通过`（含判别联合的窄化行为、
  optional 归一、enum wire 值）。以 platform 真实 schema 的快照
  （`agent/protocol` 的 `ChatStreamEvent`、kernel protocol 若干）作端到端
  夹具，锁定回归。
- `supportedVelarScript` 按 catalog 惯例钉精确版本区间；生成头注记录
  工具版本 + 来源包版本 + schema 摘要哈希。

## 5. 实现与验收要求

- 仓库：VelarScript-Libraries，登记 `catalog.json`（status: experimental）。
  遵守该仓 ROADMAP 的「历史代码是迁移输入不是权威」姿态——不翻旧实现。
- 工具自身用 TS 写（它是 Node 工具，处理的是 TS 生态的对象）；生成的
  `.vel` 必须通过消费项目的 `velar check`。
- 验收跑一次真实目标：对 `@velaros-ai/agent` 的 `./protocol` 与
  `@velaros-ai/kernel` 的 `/contracts/protocol` 实际生成，产物在一个
  最小 Vel 项目里 `velar check` 通过，并跑通等价性夹具。
- 报告需列出：两个真实目标各降级/豁免了什么（数目与路径）、映射表
  覆盖率、发现的语言表达力缺口（若有，停下报告，不擅自绕）。
