# D91：官方非标准库伴生仓库边界

## 结论

VelarScript 建立独立伴生仓库 `VelarScript-Libraries`，用于维护跨项目复用的
非标准库、外部适配器与编辑器接入套件。它是一个包含多个独立安装包的
monorepo；每个包从公开 npm scope `@velarscript-labs/*` 独立安装。它不是一个
聚合依赖包，也不是 VelarScript Core 的第二个工作区层。

这项裁决不允许 `libraries/`、`adapters/` 或 `integrations/` 回到 Core。
Core 继续只有 `packages/*`，并只拥有语言、官方目标框架和必需工具。伴生仓库
拥有的是“官方维护的可选包”，不是 Standard API 或随工具链自动获得的能力。

## 身份与依赖方向

四种身份保持可区分：

1. `velar/*` 是语言或官方目标拥有的 Standard/能力模块，随匹配工具链发布；
2. Core 中的 `@velarscript/compiler`、`node`、`web`、`desktop`、`cli` 与
   `create-velar` 是同步发布的官方工具链；
3. `VelarScript-Libraries` 中的 `@velarscript-labs/*` 是显式安装、独立版本的
   官方实验与可选包；`@velarscript/*` 不再承载非标准库；
4. `@openvoxel/*`、`@velaros/*` 与其他作用域继续由各自产品或第三方拥有。

依赖方向是单向的：应用可以依赖 Core 与 Libraries，Libraries 只能依赖已发布的
Core 公共契约，Core 的源码、构建、测试和发布不得依赖 Libraries。Libraries
不得通过仓库相对路径、私有子路径、隐藏 CLI 资产或 `velar/*` 别名获得特权。

## 包与发布模型

- 仓库使用 `packages/*`，一个目录对应一个独立包；不得建立
  `@velarscript-labs/library` 聚合巨包。
- 每包拥有自己的 SemVer、CHANGELOG 和发布候选；可以在一次发布操作中处理多个
  已验证包，但不使包版本彼此同步，也不与工具链版本同步。
- VelarScript 源包使用现有 `velar.entry`、`velar.targets` 与
  `velar.requires.capabilities`；编辑器或部署工具使用普通 package `exports`。
- 纯源码包只有在真实依赖官方 JavaScript API 时才声明对应 peer dependency；
  不为表达“用 VelarScript 编写”而依赖 compiler 或 CLI。
- 发布必须从打包后的 tarball 验证：内容清单、许可证、完整性、隔离安装、支持
  目标执行和最老/最新支持工具链兼容矩阵。包清单声明 public access，并只允许
  `@velarscript-labs/*` 名字。npm 发布与 Git 推送仍是单独授权边界。
- 包状态明确标为 `experimental`、`stable` 或 `deprecated`。历史
  `@velarscript/*` 非标准包在新 scope 验证后下架；如果 registry 策略阻止删除，
  则 deprecate 并明确迁移到对应 `@velarscript-labs/*` 包。

## 编辑器与 LSP 边界

`velar lsp` 服务端继续由 `@velarscript/cli` 拥有。它直接依赖编译器项目图、
诊断、格式化和已启用扩展，不能搬到伴生仓库。

伴生仓库可以提供 `@velarscript-labs/editor-kit`，集中维护语言 id、`.vel` 文件关联、
`velar.json` 项目标记、项目本地 `velar lsp` 启动描述、协议兼容检查、命令清单
和最小词法降级数据。它不得拥有类型表、补全表、格式器、Web 语义或第二份
编译器。编辑器宿主继续使用标准 LSP；只有至少两个宿主重复维护 transport、
取消、重启或坐标转换时，才从真实重复中抽取单独的通用客户端包。

## 准入规则

一个包进入伴生仓库至少满足以下条件：

- 已有两个真实消费者，或已经出现跨仓库重复维护同一外部桥；
- API 与某一产品的业务模型、界面和部署策略无关；
- 目标、能力、第三方依赖和错误边界明确；
- 内存、结果、队列、并发、取消和清理等适用上限被记录并验证；
- 有维护负责人、状态、兼容范围、真实依赖执行测试与隔离消费者测试。

“可能对 VelarScript 应用有用”仍不构成准入理由。旧实现只能作为迁移种子，
不能因曾经发布过就原样恢复。

## 首批范围

首批低争议候选为 `@velarscript-labs/text-buffer`、`noise`、`msgpack`、
`compression` 与新建的 `editor-kit`。`script-analysis` 在出现真实编辑器消费者后
恢复；`sqlite` 必须先修正事务具体类型、并发、容量和清理契约；通用
`database` 模型至少经过两个消费者验证后再决定；部署厂商包归 integration
类别并保持相同的独立发布规则。

## 与既有裁决的关系

- D48 的“编辑器域功能不进入 Standard、作为显式依赖安装”继续有效；其“放在
  Core 的 `libraries/`”仍由 D88 废止。官方非标准包使用独立 npm scope
  `@velarscript-labs/*`，而不是复用工具链的 `@velarscript/*`。
- D88 的 Core 仓库边界完全保留；本裁决只收窄“所有可选实现必须由消费项目
  单独拥有”为“可跨项目复用的实现可以由独立伴生仓库明确拥有”。
- D87 的数据库与适配器 API 不自动恢复；其中实现必须重新通过本裁决的准入、
  类型和运行时边界。
