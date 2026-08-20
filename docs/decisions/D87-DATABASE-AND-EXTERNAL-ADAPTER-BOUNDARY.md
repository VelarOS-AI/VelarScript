# D87 — 数据库模型规范与外部适配器边界（用户裁决 2026-08-20）

这是一份已实施裁决的历史记录。当前契约见
[数据库模型与适配器规范](../database-model.md)、
[标准库](../standard-library.md) 与
[运行时边界账本](../contributing/runtime-boundary.md)。

## 问题

SQLite、MessagePack、压缩和噪声曾以 `velar/*` 模块进入 CLI 或 Node 实现。
这把具体引擎、第三方依赖和语言/目标能力放进了同一层，也会迫使服务器框架默认
选择一个数据库。用户裁决：「把非语言内部需要的东西都整出去，比如 sqlite
这种东西不应该是外部适配的吗，我们是不是应该弄一个数据库模型规范什么的」。

## 裁决

1. `velar/*` 只保留语言语义与官方目标能力。具体驱动、编解码算法和第三方集成
   不因常用而获得保留命名空间。
2. `@velarscript/database` 是普通、目标中立的 VelarScript 源包。它只定义模型、
   查询/变更计划、显式迁移、事务所有权、能力报告、容量错误和适配器 SPI；不含
   SQL、驱动、连接池、Worker 或编译器语义。
3. `@velarscript/sqlite` 是独立版本的外部适配器，拥有 `node:sqlite`、方言、原始
   SQL 逃生口、隔离 Worker、队列/结果/行/缓存上限、流式背压、迁移指纹、并发
   与清理语义。`@velarscript/node` 和服务器框架不得依赖它。
4. `@velarscript/msgpack`、`@velarscript/compression`、
   `@velarscript/noise` 同样作为外部源包安装和锁定，不再由 CLI 暗藏依赖或发布
   `velar/msgpack`、`velar/compression`、`velar/noise`。
5. 数据库不增加关键字，也不扩展 `@`。模型和适配器 API 都使用已有函数、类型、
   类、Runtime Type、`using` 与包机制。
6. 仓库分成 `packages/*`（工具链）、`libraries/*`（纯源库）、`adapters/*`
   （具体集成）三层。后两者独立版本、独立发布，不进入工具链发布候选。

## 强制边界

- 通用计划中没有 SQL 字符串，值始终作为参数数据；具体适配器再次校验计划和
  标识符。
- 不做隐式查询、惰性关系加载、脏跟踪、自动 schema diff 或自动破坏性迁移。
- 适配器必须公开真实能力，限制队列、参数、行、单行、总结果、流批次、缓存与
  连接，并在慢消费者和过载时施加背压或显式拒绝。
- 所有数据库、事务和语句均为受所有权管理的资源；未提交事务释放时回滚，关闭
  幂等，终止失败必须结算等待者。
- 服务器可以通过应用 Provider 接收通用 `Database`，但不得内建 SQLite。

## 完成证据

当前实现以真实 SQLite 文件验证模型迁移、CRUD、Runtime Type 行校验、有界流、
结果上限、事务提交/回滚、预编译语句、队列背压、独占句柄并发错误和 Worker
释放；永久门禁同时拒绝四个旧 Standard/Node 模块重新出现。
