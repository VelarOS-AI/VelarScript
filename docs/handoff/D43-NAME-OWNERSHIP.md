# D43 — 名字所有权统一约定 + 装饰器永久排除（已批准，待实施）

用户于 2026-08-12 裁决：`using` 不应强迫所有能力面改名 `close()`（「会让 API
语义开始变怪」），应定义**资源协议**；随后要求名字「类似 js 的那种内部约定式
的写法防止撞车」，并**要求统一** —— 一条约定覆盖包括既有运行时变量在内的全部
编译器自有名字；再追问装饰器如何安置。本文是该统一约定的定稿。

判据同 D28-D42。

---

## 第 67 条 —— 一条约定：`@name` = 语言拥有的名字

### 现状：五套并存的机制

| 现存机制 | 例子 | 保护方式 |
|---|---|---|
| 生成代码前缀 | `$velar…` **和** `__velar…` | 两个前缀做同一件事（本身即双拼写） |
| JSX 指令命名空间 | `on:click`、`bind:value`、`unsafe:html` | 冒号 + 有语义的命名空间词 |
| Look 的 `@` | `@hover`、`@before` | 符号，标识符中不可能出现 |
| 声明上的编译器已知成员 | `Type.parse`、`Type.is` | 注册表保护（普通名字） |
| 组件块成员 | `mounted:`、`cleanup:` | **裸词占名，无保护** |

### 统一约定：三条规则，按「读者 + 位置」划分

**规则 1 —— `@name` = 这个名字属于语言**。用在**用户名字也能出现的位置**：
类体成员、组件体成员、Look 的状态与目标。

```
class Terminal:
    def close() -> null:        // 我的公开动词，我的名字
        ...
    @dispose:                   // 语言的契约，语言的名字空间
        self.close()

component Panel:
    def mounted() -> null: ...  // 我的方法，合法且不冲突
    @mounted:                   // 语言的生命周期钩子
        start()

const card = look:
    @hover:                     // 已经符合本约定，零改动
        color = accent
```

撞车免疫来自**语法结构**（`@` 不是标识符字符），而非命名习惯 —— 前缀约定永远
只是「不太可能」，符号是「不可能」。

**规则 2 —— 修饰符关键字 = 这个声明的语言属性**，来自封闭词汇：
`export`、`abstract`、`override`、`static`、`private`、`readonly`、`async`。
位置在声明头，是真关键字，不可撞。

**规则 3 —— `__velar` 前缀 = 生成的 JS 标识符**。**退役 `$velar`** —— 两个前缀
做同一件事是待消灭的双拼写。读者是产物读者，源码永不出现（charter §3 既有的
「源绑定不得以此开头」保持不变，只是从两个前缀收敛为一个）。

**规则 4 —— `ns:name` = 带参数且命名空间有语义的指令**。用在**用户名字不可能
出现的位置**（JSX 属性位）：`on:` 事件系统、`bind:` 双向绑定、`look:`/`style:`
样式、`unsafe:` 不安全边界。高频书写、必须短，位置本身已排除撞车。**零改动**。

### 为什么 `@` 是安全的选择：Vel 已经有装饰器机制

见第 68 条 —— 修饰符关键字**就是** Vel 的装饰器，来自封闭词汇；用户自定义装饰器
永久排除，故 `@` 不会与未来的装饰器语法争夺。

### 附带的长期收益

将来任何新能力钩子（序列化、相等定制、比较定制…）**自动落进 `@` 命名空间**，
不需要每次重新发明防撞机制 —— 一条约定容纳整个品类，而非一次一个特例
（用户方法论纠正的直接应用）。

### 迁移面

| 改动 | 范围 |
|---|---|
| `mounted:` → `@mounted:`、`cleanup:` → `@cleanup:` | 两个词；examples、Lite、charter §16、AI 简报、典章 |
| 新增 `@dispose:` | 新的（第 69 条） |
| Look 的 `@hover`/`@before` 等 | **零改动**，已符合 |
| `$velar` → 统一为 `__velar` | 生成代码内部；charter §3 与 §18 的两处措辞收敛 |
| JSX 指令 | **零改动** |
| `Type.parse`/`is`、`expose`/`exposes` | 零改动（前者注册表保护、后者真关键字，位置不可撞） |

### 与 D30 第 16 条的联动（在撞车发生前挡住它）

D30 要把 `state`/`action`/`resource`/`watch`/`look`/`component` 软化为上下文
关键字（好让用户写 `const state = ...`）。软化后 `mounted`/`cleanup` 也是软词，
组件内同时存在 `def mounted()` 与 `mounted:` 钩子就**真的会撞**。`@` 前缀在
撞车发生前把它挡住 —— 而不是等撞了再补。**故第 67 条应与 G 波（软化）同批或先行。**

### 回归

`@mounted:`/`@cleanup:` 与同名 `def mounted()` 在同一组件内共存；`@dispose:` 与
`def dispose()` 在同一类内共存；Look 的 `@` 不回归；`$velar` 在全仓（含发射产物
与 boundary 门禁）已无残留；JSX 指令不回归。

---

## 第 68 条 —— 用户自定义装饰器：永久排除（含反证条件）

### 裁决

**Vel 的装饰器就是修饰符关键字**（`export`/`abstract`/`override`/`static`/
`private`/`readonly`/`async`）—— 语义上就是「declaration 上的标注」，区别只在
**它们来自封闭的、编译器自有的词汇，不是用户自定义的**。

与「用户不可定义类型约束」（D41 第 61 条）**是同一条原则、同一个理由**：

> **一个库不能改变某个声明的含义。**

否则 AI 读到 `@Injectable class Foo` 无法知道它做什么（除非去读装饰器实现），
那是「千人千面」在框架层的复活 —— 正对使命（[docs/why-velarscript.md]）。

### 主流装饰器用途在 Vel 里各有显式答案（排除的实证基础）

| 装饰器典型用途 | Vel 的现成答案 |
|---|---|
| DI / 框架注册（Angular、Nest） | 模块 state + 显式注册 |
| 校验（class-validator） | `Type.parse` 运行时验证器 |
| 序列化提示 | 字符串背书枚举、`Record<T>` |
| 记忆化 | D26 退役（属性级追踪自动生效） |
| 测试标记 `@Test` | `test "名字":` 块（D39 第 53 条） |
| 路由 `@Get("/x")` | `route(path, component)` 显式注册 |
| 弃用标记 `@deprecated` | 教学式诊断（语言直接移除，不留标记） |

每一条都已有非装饰器的显式答案 —— 装饰器是「表面表达不了这些事」的语言的
元编程逃生阀，而 Vel 的表面一直在直接表达它们。

### 反证条件（本项目曾栽在「永不」上，故明写falsifier）

「完全不做异步迭代」的旧结论被真实 ChunkStream 证据推翻（HANDOFF 有记录）。
因此本排除的反证条件是：

> 出现一个真实需求，**既不能表达为封闭词汇的修饰符关键字、也不能表达为显式
> 注册调用**。

### 扩张路径（不是开装饰器，而是加关键字）

将来需要新的声明标注 → **往封闭词汇加一个修饰符关键字**（`readonly def` 就是
W-75 这样加进来的，成本已知、路径已验证），而不是开一个用户可扩展的机制。

### 成文

charter §19「Deliberately absent」加入「用户自定义装饰器/属性标注」条目，
附上「Vel 的等价物是封闭词汇的修饰符关键字」与本条的反证条件。

---

## 第 69 条 —— `using` 的契约改为 `@dispose` 能力（D39 第 50 条改稿）

### 撤销的部分

D39 第 50 条原写「值必须带 `close() -> null` 或 `close() -> Promise<null>` 成员」。
**撤销**，理由是用户的论证：

> 强迫所有东西都 `close()` 会让 API 语义变怪；`using` 表达的是「我获得了这个
> 资源的所有权，并承诺由当前 scope disposal」，而不是「这个东西恰好有个叫
> close 的方法」—— **这是两个抽象层级**。

同时**撤销**编排代理上一轮提出的「统一 `close`/`stop` 拼写」提案 —— 不再需要：
调查已确认能力面一半叫 `close`（FileWatcher、TerminalSession、LanguageServer）、
一半叫 `stop`（Server、Process、ProjectTask），而 `stop` 的信号升级与进程树语义
是**实现差异而非概念差异**；`@dispose` 让两者都不必改名。

### 为什么不用 `protocol` / `implements`

用户给了两个拼写选项。选**特殊能力成员**，因为 `protocol Disposable` +
`implements` 要**反转一条成文的有意缺席**：charter §6 明写「没有平行的
`schema`/`interface`/`typedef` 声明家族」，§19 把「TypeScript 式接口」列入有意
缺席。而特殊能力成员**零新声明家族**，且 Vel 已有同款先例 —— 组件的
`mounted:`/`cleanup:` 就是编译器已知的块成员。

### 目标语义

三个概念各归其位、互不重叠：

| 概念 | 拼写 | 层级 |
|---|---|---|
| 我拥有它，本作用域负责释放 | `using x = ...` | 所有权 |
| 我如何释放自己 | `@dispose:` 块 | 契约 |
| 停止/关闭这个东西 | `close()` / `stop()` | 公开 API 动词 |

1. **`using name = expression`**：绑定不可重赋（const 语义）。上下文关键字
   （语句头 + 标识符 + `=`；D30 消歧原则），零新保留字。
2. **释放契约**：值的类型必须声明 `@dispose` 能力。作用域退出（正常/throw/
   return/break/continue）按**声明逆序**调用。
3. **`@dispose:` 不可直接调用**（同组件的 `@cleanup:`）—— 否则它就成了
   `close()` 的第二拼写，把刚消灭的双拼写从后门放回来。它纯粹是所有权契约。
4. **异步释放**：`@dispose:` 体内可 `await`（同 `@mounted:`）；编译器静态可见
   其是否 await，若 await 则要求 `using` 所在作用域为 async，否则定向报错。
   获取端异步照常：`using proc = await start(...)`。
5. **谁能有 `@dispose`**：类（自己声明）+ **编译器为能力类型内建**（委托到各自
   既有动词：FileWatcher/TerminalSession/LanguageServer → `close()`；
   Server/Process/ProjectTask → `stop()`）。**记录不行** —— 记录是数据、释放是
   行为，与 readonly 边界排除行为值的既有规则一致。
6. **模块顶层 `using` 拒绝** —— 模块活到进程结束，「作用域释放」无意义。
   函数体、组件体、循环体（每轮释放）合法。
7. **幂等契约**：`@dispose` 必须可重复调用无害（标准库的 `close` 已是永久且
   幂等）。故「提前手动 `close()`、作用域再释放一次」安全，无需早退语法。
8. **释放失败不吞不盖**：有在途错误时原错误优先、`@dispose` 失败归一化后走
   宿主报告通道；无在途错误时正常抛出（与 finally 哲学一致）。
9. **与 `async for` 的协同**：charter 说异步拉取循环永不自动释放源、
   「caller remains responsible, normally with try/finally」—— 现在那句话有了
   正式拼写：`using source = ...` + `async for x in source`。既有裁决从
   「你自己小心」升级为「语言给你工具」。

### 回归

执行级 LIFO 释放、throw/return/break/continue 四条退出路径、async `@dispose`
在非 async 作用域被拒、双 `using`、模块顶层被拒、记录被拒、幂等（手动 close
后再作用域释放）、释放失败与在途错误的优先级、内建能力类型（Server 走 `stop()`、
FileWatcher 走 `close()`）各一条、`@dispose:` 不可直接调用。

---

## 批次归属

第 67 条（`@` 约定 + `$velar` 退役 + `mounted`/`cleanup` 迁移）→ **与 G 波
（保留字软化）同批或先行**（联动理由见第 67 条）；
第 68 条（charter §19 条目）→ 批次 C；
第 69 条（`using` 全套）→ 批次 M（与 `try` 表达式、`test` 块、类型约束同批）。
