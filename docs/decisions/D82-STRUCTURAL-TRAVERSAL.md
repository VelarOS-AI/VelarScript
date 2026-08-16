# D82 — 结构化遍历落地后的一条待裁决与三条记录（波 X1，2026-08-16）

审计 A-010（S1）已修：依赖发现不再按 kind 走，改为对 AST 的结构化下降。
**顺带删掉了同一缺陷的第二份副本** —— 扩展协议里的
`CompilerDependencyContext` 与两个 `visitDependency*` 钩子，
它们让每个扩展各自维护一份 AST 的手抄镜像，各自独立漂移。

---

## 第 203 条（待裁决）—— `CORE_EXPRESSION_CONSTRUCTS` 要不要发布

### 现状不对称

| | 完备性由什么保证 |
|---|---|
| `CORE_STATEMENT_CONSTRUCTS` | **`satisfies` 映射类型 —— 抄漏一个 `tsc` 就不过**（U1 实测过） |
| Core 表达式种类 | **没有对应名册**。X1 的测试里手打了 19 个 |

**后果**：往 `CoreExpression` 加一个新种类，**什么都不会红** ——
它会被静默归类成「不是表达式」，从探针名册里掉出去。

### 我的建议：加（与 X1 一致）

**修复本身两种选择都安全** —— 结构化遍历不认 kind，所以运行时行为不受影响。
**但门禁的完备性现在压在一份手抄件上，而这正是本波存在的目的所要铲除的那一族。**
D56 第 129 条的论证逐字适用；加了之后，tour 覆盖门禁将来还能顺势要求表达式构造。

**X1 没有做，理由正当**：它会改一份已发布的 Core 名册并触及
tour 覆盖门禁，而当时另一波（X3）正在编辑那个门禁。

---

## 第 204 条 —— `statementContainsDirectAwait` 是同族剩下的最后一处

`packages/compiler/src/ast.ts` 里的这个 switch **是手工维护的，
带一个静默的 `default: return false`，并且没有任何
`ExtensionStatement:` 的 case**。D43 第 69 条用它决定
释放一个 `@dispose` 值是否需要异步作用域。

**X1 如实报告它构造不出活的失败**（组件体不能 await；
`mounted:`/`cleanup:`/`watch` 体各自是独立帧），
**所以不记为缺陷，只记为同族的同一形状换了个问题**。

**下一轮审计从这里开始。** 一个带静默 `default: return false`
的手抄 switch，在这一场已经被证明是什么了。

---

## 第 205 条 —— 语料派生名册的真实边界：只以简写出现的容器不可见

`ExtensionStatement:web:expose.value` **在 tour 里够不到** ——
tour 只写简写形式 `expose {focus, label}`，它的 value span 就是 key span，
所以任何改写都落不进那个槽。该容器现由测试内自带源码覆盖。

**这是语料派生的固有限制，不是这次的疏漏**：
**任何只以简写出现的容器，对语料派生的名册都是隐形的。**
已写进测试正文，不要在将来把它当成新发现。

---

## 第 206 条 —— 静态 import 仍走顶层扫描，这是对的，别去「修」它

**记下来，免得将来有人把它当成 A-010 的漏网。**

静态 import 与 web 的 `resources()` 都只扫 `program.body` 顶层。
**X1 验证过这由语言规则兜底，不是运气**：

| 形态 | 语言的回答 |
|---|---|
| 嵌套的 `import` | `VEL3011 Imports can only be declared at module scope` |
| 嵌套的 `import css unsafe … before look` | `VEL5037 Unsafe CSS is module-level; move the declaration to the top of the module so its order against Look stays visible` |

**嵌套的 import 永远不可能需要进模块图**，因为它根本不合法。
顶层扫描在这里是完备的。

---

## 记一处公开协议变更

`@velarscript/compiler/extension` 移除了 `CompilerDependencyContext`
与 `CompilerInspectionExtension` 的 `visitDependencyExpression` /
`visitDependencyStatement`。**仓内消费者只有 `packages/web/src/inspection.ts`，已更新**；
`docs/`、`tests/`、`scripts/`、`packages/*/skill/` 全无引用。

**没有任何东西发布过，所以不存在需要迁移的第三方扩展。**
