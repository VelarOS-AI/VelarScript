# D74 — 组件 prop 默认可改，`readonly` 改为显式选择（用户裁决 2026-08-16）

用户：「默认传递的 props 我坚持响应式对象可改，如若不然会导致用起来不舒服，
很别扭，这和 vel 的理念冲突。」

---

## 第 188 条 —— 默认可改，`readonly` opt-in

### 决定性的证据是 charter 自己

**实测，同一个对象**：

```text
component Row(task: Task):
    task.title = x            → VEL3002 Cannot assign through readonly Task
    tasks[0].title = x        → 编译干净
```

而 `docs/language-charter.md:2947`：

> VelarScript intentionally does not pretend to have an ownership system
> **by rejecting only some aliases** or forcing product-layer copies.

**只读 prop 恰恰就是「只拒绝其中一些别名」。**
这门语言在一处明确声明自己不做的事，在另一处做了。

### 所以这条规则并不做它声称做的事

它**不能阻止子组件改父状态** —— 子组件 import 那个 store 就改到了。
它只阻止了**方便的那条路**。

一个拦不住行为、只拦得住拼写的规则，**不是保护，是摩擦**。

### 母语言那一侧也不支持它

**JS 是母亲：传一个对象给你的是可变引用。** Vel 在这里比母亲严，
而严的那部分又是漏的 —— 两头都不占。

### 但有一条相反的证据，你应该看到

**盲测三轮明确说这个"咬"是有价值的**：

> readonly 投影会咬人，但诊断能一轮教会 …… 它会咬，但**咬在真正的 owner seam**，
> 而且诊断把直接修法和传播规则都说清了；**这比依靠 TypeScript 团队约定
> "别在展示组件里改"更可靠。**

一个第一次接触这门语言的人，撞上之后认为它值。**这条不该被忽略。**

### 裁决：你自己给的中间路

> 或者可以控制是只读还是可改

**默认可改；作者要保证时显式写 `readonly`。** 实测该拼写**今天就成立**：

```text
component Row(task: Task):            // 可改，写入照常发布
component Guarded(task: readonly Task):   // 作者选择了保证
```

**用的是既有词汇，不发明新词。** 保证从「无论你要不要都有」变成「你要了才有」。

这同时保住了盲测那条价值：**要那个 owner seam 的人仍然能要**，
只是它不再强加给不要的人。

---

## 第 189 条 —— 单向数据流从「语言规则」降为「房规」

`examples/app` 今天把「组件 prop 是 transitive readonly 投影，改动按 id 回到 store」
列为它教的四件事之一。**那个模式仍然是对的，但它的地位变了**：
从**语言强制**变成**最佳实践推荐**。

理由与用户对测试控制器那条的框架同源：
**语言该管的是它真能管住的事。** 单向数据流是好设计，
但语言拦不住反向写（别名还在），所以**推荐它、并在文档里说清为什么**，
比假装强制它诚实。

**落地**：`docs/best-practices.md` 增一条典章，配可运行的完整程序 ——
把 store 写入集中在一处的好处、以及什么时候该给 prop 加 `readonly`。

---

## 实施要求

1. **prop 默认不再是 readonly 投影**；写入照常经反应式发布。
2. **`readonly T` 作为 prop 类型**保留并成为**显式选择**（实测已可写，
   确认它在新默认下仍然强制传播规则）。
3. **迁移**：`examples/app`、展示、charter §14/§15、简报里所有讲
   「prop 是 readonly 投影」的地方。**盲测二轮与三轮把这条列为痛点/价值，
   两份记录都要在裁决里留着，别只留支持本条的那一半。**
4. **诊断**：给 `readonly` prop 的写入拒绝要说清这是**作者选的**，
   不是语言强加的 —— 措辞要与今天不同。
5. **调查并上报**：子组件写入 prop 时，反应式发布路径是否与写 store 完全一致？
   （深层反应性应当让它一致，但**要实测，不要假设**。）
6. `readonly` 在**非 prop** 位置的语义不变（记录字段、`readonly List<T>` 等）。

## 排期

`packages/web`，**排在波 S1（反应式链）之后** —— 两者同文件。
