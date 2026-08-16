# D76 — 内联外语块落地后的裁决与更正（2026-08-16）

D53 第 117 条留了六个「待实施者定案并呈报的角落」。实施完成，本文结掉其中一个
需要裁决的，并更正三处我写错的规格。

---

## 第 191 条 —— 带捕获的块不支持顶层 `await`，这是裁决不是缺口

### 被拒的形态（实测）

```text
extern js(factor: number)`
    const table = await import("node:crypto")     ← 块内 JS 的顶层 await
    export function scale(n) { return n * factor }
`:
```

```
VEL2037: A captured inline JavaScript block cannot use top-level await;
         captures are passed to a synchronous factory,
         and an async factory has not been specified
```

**原因**：带捕获的块发射为**同步工厂函数** `function make(factor) { … }`，
普通函数里写不了顶层 `await`。

### 没被拒的（我实测确认，两件事别混）

**捕获的值本身需要 await 才能拿到 —— 照常可写**：

```text
const factor = number(await readText("factor.txt")) ?? 3
extern js(factor: number)`…`:
```

`await` 发生在 Vel 这一侧。**这正是本条要保住的形态。**

### 裁决：不加异步工厂

**一、绕法已经是更好的写法。** 需要 await 就在 Vel 这边 await 完再捕获 ——
那样 `await` 是**可见的、受检的、在 Vel 里**，而不是藏在一段原生 JS 块内。
**逃生通道该尽量小，不该长出自己的生命周期。**

**二、异步实例化会引出一个真问题**：块的导出什么时候可用？
在 await 完成之前用到 `scale` 会怎样？那需要一整套模块生命周期语义，
而 D53 的立意是**「给已有能力一个好拼写」**，不是引入新的模块生命周期。

**三、零证据。** 三轮盲测加一次裁判迁移**一次都没撞上「我需要写原生 JS」**；
这条更细的需求证据更少。

### 反证条件（写下来，免得将来靠印象重议）

出现**一个真实的 npm 包，其初始化必须在块内 await**，
且「在 Vel 侧 await 完再捕获」覆盖不了它 —— 那时重开本条。
**"想想觉得可能有用"不算。**

### 记一句：那条诊断本身是对的形态

它说清了**为什么**（同步工厂）与**缺什么**（异步工厂未被规定），
不是一句「不支持」。**实施波做定向拒绝而不是猜一个语义，判断正确。**

---

## 三处我写错的规格（实施波上报，确认）

### 一、任务 #17 的立论是错的

我写「`moduleInterfaceIdentity` 不含 `dispose`，所以增删 `@dispose:` 块
**不会让依赖模块的缓存接口失效**」。

**实测反馈：那个机制根本不管这件事** ——
`moduleInterfaceIdentity` 负责的是**循环组的接口收敛**，
下游重编译由**反向路径依赖**负责。

**把 `dispose` 加进身份仍然是对的**（身份该完整），
**但我给的理由不成立**。记下来，因为一条"修对了但理由错了"的记录，
将来会误导任何想理解那个机制的人。

### 二、D68 第 176 条的归属划窄了

我写「归 `packages/web` + `docs/web-api.md`」。
**真正的 Playwright owner 在 CLI**（`packages/cli/src/browser-test-runner.ts`）。
`box()`/`style()` 要贯通类型、运行时与驱动三层，只给 web 是做不完的。

### 三、D53 的 CSS 示例与正文自相矛盾

正文要求 `import css unsafe` **强制写 `before look` / `after look`**，
而我举的内联 CSS 例子**省略了 placement**。实施按强制显式规则做，**正确**。

---

## 未结的角落（D53 六个里的其余）

第 6 条「相对 `.js` 文件是否随之放开」—— **本波仍不做**，理由不变：
先给一条好拼写，别一次给两条；真实频率仍未观察到。
