# D107 — 目标运行时清单与类型契约保持单一所有者（所有者委托裁决 2026-08-28）

## 问题

D83 已把 `velar/worker` 定为 Node/Web 共用能力，Core 也已经拥有它的唯一
`ModuleInterface`。Node 和 Web 分别提供宿主实现。Web 实现可以通过
`webModuleSource("velar/worker")` 单独取得，却没有进入 `webModuleSources`；而
通用 CLI 正是枚举 source map 来生成开发 import map。开发服务器同时只编译应用
入口，没有像 check/build 那样把 manifest 声明的 Worker 入口作为项目根。结果是
类型检查和直接源码查询都成功，浏览器开发文档缺少 `velar/worker` 的地址，补上
地址后 Worker 入口本身仍返回 404。

把 Worker 类型再复制进 Web 可以让两个表看起来相等，却会制造第二个类型权威；
让 CLI 特判 Web Worker 则会把目标知识倒灌进通用装配层。两种做法都违反现有
Core/目标/CLI 边界。

## 裁决

1. `velar/worker` 的公开类型契约继续只由 Core 定义。Web 和 Node 不复制该
   `ModuleInterface`。
2. 目标扩展的 runtime source 清单枚举该目标实际提供的全部实现，包括其为
   Core 契约提供的宿主实现。因此 Web 的公开 runtime roster 和
   `webModuleSources` 都包含 `velar/worker`。
3. `interfaces` 表示扩展新增或目标特化的类型契约；`sources` 表示目标提供的
   运行时实现。两个表不以逐键相等为目标，组合后的标准模块视图才要求每个公开
   source 都有且只有一个类型契约。
4. 静态运行时不得只藏在 `source(specifier)` 的特判中。动态配置替换继续走该
   函数；可枚举静态源码以 source map 为权威，让开发 import map、测试运行时包、
   打包验收和模块所有权检查消费同一份清单。
5. 开发服务器与 check/build 使用同一组项目入口：应用入口加 manifest 声明的
   全部 Worker 入口。Worker 入口因此参与诊断、增量编译和模块路由，运行时清单
   发布的 URL 不会指向未编译文件。
6. 这是 Web API 0.11 已有且已成文 Worker 能力的可发现性修复，不新增 Vel
   源码表面，也不提升 Web API 版本。

## 验收

- Web runtime roster、source map 与打包后的公开清单一致；组合接口从 Core 取得
  `velar/worker`，Web 接口表中不存在副本。
- 开发文档的 import map 含 `velar/worker`，相应路由返回浏览器实现。
- 同一个 manifest 声明的 Worker 入口在 Chromium 开发服务器和 CSP 生产构建中
  完成真实的受检请求/响应。
- Node 现有的 Core 契约 + 目标 source 结构保持同型。
