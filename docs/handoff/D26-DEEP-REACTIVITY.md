# D26 — 深层响应式为唯一默认（设计定稿，待实施）

用户已批准（「可以，这样最好」）。最高设计法则：**框架可以任意复杂但必须做对；
对外必须简单、零新增心智负担**。本文是可执行设计 —— 实施者不需要重新决策。

## 目标语义（用户可见的全部内容）

```velar fragment
state tasks: List<Task> = []

tasks.append(task)          // 直接生效并触发更新
tasks[0].done = true        // 嵌套突变，同样生效
session.messages[2].text = "edited"
tasks = filtered            // 整值替换照旧发布
```

对外只有一句话：**「state 怎么改都会更新界面」**。随之退役的用户规则：复制三连、
`copy()` 税、state 别名/传参禁令（VEL5046 全家 7 个发射点）、charter §15 的别名
段落。`memo`/`batch` 公开 API 退场（属性级追踪完全覆盖 —— 用户裁决「能完全覆盖
就不要了」）。

## 架构（Solid 骨架 + Vue 手感）

侦察结论（五路，2026-08-09）：响应式内核在 `packages/web/src/emitter.ts` 的
WEB_RUNTIME 模板串（865-1873 行区域）+ `runtime-foundation.ts` 跨 bundle 共享单元。
现有观察器体系（duck-typed observer、domQueue/watchQueue、flushPending 微任务闩、
双向依赖清理）**结构上无需改动** —— 属性级 track/trigger 以
`WeakMap<target, Map<key, Set<observer>>>` 挂进现有 `__velarTrack`。

### 关键捷径（VelarScript 独有，务必利用）

**List/Map/Set 不用 Proxy。** 语言的集合操作本来就全部经过编译器所有的助手
（collectionCalls 逐调用点分类：append/extend/insert/set/add/update/remove/clear/pop）
—— 在助手层直接 `trigger(target, …)` 即可发布。这绕开了侦察标出的最硬阻塞：

- Map/Set 的 uncurried 原生调用（`Map.prototype.entries.call(v)` 等遍布
  headersOf/deepEqual/__velarMapTypeIs/url/log）遇 Proxy 内部槽缺失**必炸**
- `__velarListSnapshot` 的稠密校验走 ownKeys+descriptor，经陷阱既是热点开销
  又会追踪每个下标

**只有普通 record 需要懒代理**（get/set/has/deleteProperty 陷阱；
**不陷阱 getOwnPropertyDescriptor** —— 见不变量 2）。

### 硬性不变量（每条对应一个已确认的坑）

1. **包装白名单**：只包普通 record（plain object）。冻结对象、非扩展对象、类实例、
   DOM 节点、List/Map/Set（走助手埋点）、函数 —— 一律不包（Vue 的 skip 规则入编，
   写成测试）。否则三个 WeakMap 身份注册表（nativeFiles/formBodies/运行时类型注册）
   与 Look 冻结组合全部炸。
2. **不陷阱 `getOwnPropertyDescriptor`**：全部边界校验器与 JSON 内核靠 descriptor
   读取裸子值 ——「校验即解包」是特性，升格为成文不变量 + 测试。代价：keyed 行
   渲染器今天经 snapshot 拿到裸 item（正确性悬崖，见 4）。
3. **每目标版本号 + 父链上浮**：record 代理 set 陷阱与集合助手在 trigger 时同步
   `version++` 并沿 parent 链上浮通知根订阅者 —— `watch`、整值观察者、prop cell 的
   `Object.is` 抑制由此全部绕开（否则 watch 对深层突变永不触发 —— 已在代码确认）。
   watch 的 previous 语义：深层源上 previous 与 current 同引用，照 Vue 先例**成文
   声明**，不做快照（快照成本不可控）。
4. **keyed 行走追踪读**：`__velarKeyed` 把 item 交给行渲染器前重新包装（proxy of
   item），snapshot 的裸值只用于稠密校验 —— 否则属性级突变**不会重渲染 keyed 行**
   （侦察原话：correctness cliff）。
5. **prop 边界单向流**：子组件深改父 state = 分析器诊断（新 VEL 码，语气照旧直给）
   —— 保持「props 只读」既有契约；运行时 dev 侧可加只读视图兜底。
6. **边界统一解包**：单一 `toRaw` 助手落在共享 runtime 串（json-runtime、deepEqual
   同步继承），velar/json、storage、http、realtime、forms、unsafe 桥、`unsafe:html`、
   velar/test 断言全部过它。Map 键/Set 成员查找先解包（身份分裂 = 静默假阴性）。
7. **跨 bundle 单一身份**：track/trigger 订阅表与 raw↔proxy 缓存必须进
   `runtime-foundation.ts` 共享字段表，版本号升 `0.11` —— 否则跨 bundle 状态双包裹、
   订阅表分裂。
8. **`__velarMemo` 整体退役**：身份键缓存在深层突变下必然陈旧（Lite store 第 57 行
   有一颗已确认的活雷 —— memoPreview 缓存消息身份，流式 `text+=chunk` 后侧栏预览
   冻结）。D14' 落地的自动 memo 一并移除/内化；web-api.md 74-80 行以别名禁令为前提
   的纯度论述整段重写。

### 静态降级（自动性能层 v1，保守版）

编译器全程序分析已存在。v1 只降级**类型上不含可变引用位**的 state（纯原始值/枚举/
不可变形状）—— 不装追踪、退化整值语义。完整逃逸分析（集合回调元素别名
`tasks.map(t => t.done = true)`、存储闭包、跨模块参数突变摘要 —— 侦察已列锚点）留
二期，宁可不降级也不能降错。`frozen(value)` 逃生舱**规格封存不上架**（见
D18-VELAR-SERVE.md 顶部的三层纪律）。

### 跨模块语义

导入绑定的深层突变 = 合法且发布（模块 store 是既定模式）；整值赋值仍按 const 导入
禁（VEL3002 不动）。此不对称成文写进 charter §12/§15。

## 迁移面（普查数字）

24 处 `copy()` 调用（Lite 7 + examples 17）、14 处复制重建、~6 处别名绕行结构全部
简化；compiler.test.ts 中 VEL5046 测试（4960-5007）整删（其 invalid 夹具变 happy
path）、memo 身份测试（4771-4883）按新契约重做；charter §15 三段 ~25 行 +
web-api.md ~65 行重写。估算 13-15 文件、350-450 行（不含运行时新实现与新测试）。

## 验收（不可协商）

重跑 Lite S4 探针全套（LEDGER.md 648-852 的委托场景 + S=10/M=200/167-chunk 投影）：
**必须打败 memo 化基线**（每 chunk 10 次构建/~7 次 M 扫描）—— 属性级目标为每 chunk
O(1) 重渲染。结果写进 LEDGER 新章。全部既有门禁绿（npm test 全量 + test:browser
三引擎矩阵 + Lite check/test/browser/build/format）。

## 时序依赖

- 前置：D14'（memo/batch 终态）必须已落地 —— D26 直接改同一片 WEB_RUNTIME
- D26 之后才排 L1/L2（见 D17-METHOD-STYLE.md、D19-D24-ERGONOMICS.md）与 D18
- 注意共享工作树里可能有用户芯片会话的未提交 WIP —— 沿用「隔离 worktree 验证 +
  主树精确 hunk 提交」协议
