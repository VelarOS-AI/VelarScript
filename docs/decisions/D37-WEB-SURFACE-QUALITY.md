# D37 — 第七轮语法排查：Look 值收紧与 Web 表面错误质量（已批准，待实施）

用户于 2026-08-12 批准。判据同 D28-D36。所有现状结论均由真编译器探针验证。
同轮裁决背景：`async` 语句关键字维持不换 `sync`（sync 字面义与行为相反，
反向误解；母亲 Python 有语句位独立 async 先例 `async for`/`async with`；
若第五期盲测出现混淆证据再议 `detach`）。

---

## 第 42 条 —— Look 字符串值收紧：按属性关键字表（归批次 I）

### 现状（实测）

```
padding = "big"       // 通过 —— 任意垃圾字符串
padding = "12px"      // 通过 —— 单位值的第二拼写
```

维度属性的接受联合含 `string`（为 `"auto"` 类 CSS 关键字而设），但无按属性
关键字验证 —— 垃圾静默流向 CSS 被浏览器丢弃；`"12px"` 与 `12px` 构成双拼写。
D11 已对「有构建器属性上的多 token 字符串」定向拒绝，本条补单 token 的洞。

### 目标语义

- 每个接受字符串的属性带**关键字允许集**（`padding`: auto/inherit/initial/
  unset/revert 等通用关键字 + 属性特有关键字；`display`: grid/flex/... 表已
  在值检查中存在的沿用）。集外字符串 → 定向诊断。
- 长得像单位值的字符串（数字+已知后缀形态，如 `"12px"`、`"50%"`）→ 专门指引
  `Use the unit literal 12px; quoted unit values are not part of Look`。
- 表维护成本与 D36 第 38 条（原生属性表）同一诚实标注；实施同批（I），
  两张表同族。
- **42-补（用户实地标本，2026-08-12）**：D11 的多 token 字符串定向拒绝存在
  且质量高（`border = "1px solid red"` 会重组教 `border(1px, color("red"))`；
  padding/boxShadow 同），但 **grid-template 族从未注册**：
  `gridTemplateColumns = "240px minmax(0, 1fr)"` 与 `"1fr 1fr"` 实测放行 ——
  而它恰是构建器最富的属性（tracks/minmax/repeat）。修法：(a) 注册 grid
  模板族进多 token 检查，消息按 border 先例重组
  `Use 'tracks(240px, minmax(0px, 1fr))'`；(b) **全量注册审计** —— 逐一核对
  每个有构建器的属性（transition、背景渐变族等）都进了 D11 检查，缺一个补
  一个；(c) 每个构建器属性各一条多 token 拒绝回归（注册完备性由测试固化，
  不再靠人记）。
- 回归：合法关键字通过、垃圾拒绝、引号单位值得到指引、`display = "grid"` 等
  既有示例全绿。

---

## 第 43 条 —— 事件名已知表检查（归批次 I，扩展 D36 第 38 条）

`on:clik={go}` 现静默通过。与属性名同族：`on:` 后的事件名必须命中已知类型化
事件表，未知名定向诊断带最近拼写建议。回归：`on:click` 通过、`on:clik` 报错
带建议、既有全部事件名不回归。

## 第 44 条 —— 组件声明强制 PascalCase（归批次 I）

`component card:` 现通过，但 charter 明文「Component names are PascalCase」，
且小写组件在 JSX 使用位被当作原生标签 —— 静默混乱。声明位首字母非大写 →
定向诊断 `Component names are PascalCase; rename 'card' to 'Card'`。

## 第 45 条 —— 跨扩展指引族：无 web 扩展项目里的 web 形态（归批次 E/解析层）

Core/Node 项目里写 JSX 现报裸 `VEL2002: Expected an expression` —— AI 在错误
项目类型里写组件时是死胡同。新增指引族：以下形态在未启用 `@velarscript/web`
的项目中出现 → 教 `Add "@velarscript/web" to velar.json extensions`：

- 表达式位 `<Identifier`/`<identifier` 的 JSX 形态（本轮实测）
- 语句头 `component Name(`/`component Name:`、`state name =`（本轮实测：
  现吃通用 VEL2032）、`look:` 表达式、`resource`/`action`/`watch`/`mounted:`/
  `cleanup:` 形态
- 消息统一含「或该模块本应属于 web 项目」的另一半提示。
- 回归：每个形态各一条指引命中；启用 web 后同源码正常编译。

## 第 46 条 —— 两处消息质量（归各自批次）

1. `<img>child</img>` 空元素带子节点 → 现报无关的 VEL2032。定向：
   `'img' is a void element and cannot have children`（归 I）。
2. 单位混算 `12px + 200ms` → 现报裸联合倾倒。定向：
   `Length and Duration cannot be added; visual arithmetic needs one
   dimension`（归 E/F 的单位算术检查处）。

## 第七轮正面清单（记档防重查）

JSX 未闭合 VEL5004、`bind:value` 错误元素 VEL5019 定向、重复属性 VEL5014、
Look 未知属性 VEL5038、Look 重复属性 VEL5039、Look 坏展开类型错、look 条件
`else` 可用、`await` 进 watch 的教学诊断优秀（「Computed callbacks and watch
blocks are synchronous; use resource, action, or mounted for async work」）、
`mounted:` 直接 `await` 可用、`async` 语句在组件体/mounted 内合法、空 enum/
class 报错清晰。

## 组件内异步的完整使用图（本轮用户提问的成文答案，进 charter §15/§16 与 AI 简报）

| 需求 | 拼写 | 生命周期与失败面 |
|---|---|---|
| 异步**数据** | `resource data: T = load()` | 组件所有；stale 处理与销毁绑定 |
| 用户触发的**操作** | `action save(): await ...` | 组件/模块所有；`pending`/`error` 面；销毁后调用被拒 |
| 挂载后需要**等待**的初始化 | `mounted:` 内直接 `await` | 组件生命周期钩子本身 async-capable |
| 变更响应 | `watch`（同步体） | 异步工作转 action/mounted（诊断已教） |
| 明确**不等**、可越过组件生命周期的旁路任务 | `async task()` | **页面生命周期**，非组件所有；失败走 velar/app `detached` 阶段，不进组件 error 面 |

**卸载竞态语义（用户 2026-08-12 裁决：安全丢弃）**：`mounted:` 的 `await`
未完成时组件被卸载，续体继续执行（JS 不可取消 Promise），但对**该实例自有
单元**（组件 state、refs）的写入安全丢弃 —— 不发布、不报错、不触
NarrowingError、不碰已销毁 DOM。边界三条：**模块级 state 的写入照常生效**
（store 活得比组件久，丢弃反而惊人）；`action` 销毁后调用维持既有「拒绝」
契约不变；awaited Promise 在卸载后 **rejection 仍走 velar/app 报告**（丢弃
的是写入，不是失败可见性 —— 永不静默）。实现形态：销毁实例的响应单元打
墓碑标记，写路径变 no-op。归批次 I；回归为浏览器执行级：卸载中途续体写
组件 state 无错无渲染、写模块 state 生效、rejection 上报命中。web-api 成文。

## 批次归属汇总

第 42/43/44/46.1 条 → I；第 45 条 → E（解析层指引，web 形态检测在 Core 侧）；
第 46.2 条 → E/F。全局序不变。
