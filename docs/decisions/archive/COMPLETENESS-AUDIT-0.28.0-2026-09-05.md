# 完整性审计 —— 0.28.0 语言标准层（2026-09-05，约 160 个探针）

审计对象：D114 五条裁决 + W/W2 裁决在 0.28.0（`8bea026`）落地后的全部新增面。
方法学沿用 [[COMPLETENESS-AUDITS]] 审计一：对每个特性面做 **charter 承诺 vs
编译器行为 vs 作者合理预期** 的逐条对照，目标是消灭未定义而不是找 bug；
DECIDED-AND-CORRECT 必须记录，否则「完整」无法凭失败清单成立。

探针在隔离 worktree `/private/tmp/velar-d114/audit`（分支 `audit/d114-followup`，
HEAD `8bea026`）的已构建 `dist` 上实测：Core 用 `node packages/cli/dist/cli.js
check <file>`（独立模式，无 velar.json），Web/Node 用带 `surfaces` 钉版的草稿工程，
Web 运行时用 `tests/reactive-task-budget.test.ts` 的 Node 工程harness（无浏览器）。
输出逐字引用。探针文件在 `/private/tmp/velar-d114/scratch-audit/`，不入仓。

分类：**DEFECT**（编译通过后崩溃/静默错误，或工具产出坏源码）· **CHARTER-DRIFT**
（文档与实现不符）· **INCONSISTENT**（两条相关规则互相矛盾）· **UNDEFINED**
（charter 沉默、行为偶然）· **DECIDED-AND-CORRECT**（探过且正确 —— 完整性凭证）。

审计面：A 上下文泛型推断 · B 泛型类 · C List 管道成员 · D `velar/collections`
退役与 `velar fix` · E `Function<...>` 退役 · F 内建类型名保留 · G A17 ·
H watch 死循环防护 · I 横切（格式化 / 修复 / 消息形状 / hover / 文档）。

---

## DEFECT —— 4 条

### D-D1 —— `velar fix` 对**嵌套**的退役集合调用产出**不可解析的源码**

同一表达式里有两个改写点时，编辑区间互相不感知：外层调用的右括号被留下，
内层调用**根本没有改写**，而 import 行已经被删掉 —— 于是内层名同时变成未绑定名。
这是 D114 S3 列的迁移主形态之一（`sum(unique(xs))` → `xs.unique().sum()`）。

最小探针 `dnest.vel`：

```velar
import {sum, unique} from "velar/collections"
const xs: List<number> = [3, 1, 2, 3]
print(f"{sum(unique(xs))}")
```

`velar fix` 之后文件内容：

```velar
const xs: List<number> = [3, 1, 2, 3]
print(f"{unique(xs).sum())}")
```

```text
/…/fix/dnest.vel:2:26 error VEL2006: Unexpected tokens in interpolated expression
print(f"{unique(xs).sum())}")
                         ^
```

f-string 之外同形态（`dnest2.vel`：`const total = sum(unique(xs))`）：

```text
/…/fix/dnest2.vel:2:31 error VEL2032: A statement ends at its newline; move ')' to its own line, or join it to the value before it with an operator
const total = unique(xs).sum())
                              ^
```

同名嵌套（`dnest3.vel`：`sum(xs.map(inner => sum(inner)))`）同样：

```text
const total = xs.map(inner => sum(inner)).sum())
```

`velar fix` 自己的收尾行是 `applied 1 mechanical fix in 1 file; 1 diagnostic
remains` —— 它**不知道自己把文件写坏了**。这同时违反横切纪律「`velar fix` 永不
产出带新诊断的程序」：VEL2006/VEL2032 是修复**引入**的，原文件里没有。

非嵌套的接收者（`sum(source())`、`sum(true ? [1] : [2])`、`sum(await source())`）
全部正确加括号，见 DECIDED-AND-CORRECT/D 表 —— 缺陷只在「两个改写点在同一表达式里」。

### B-D1 —— 泛型子类的裸 `case` 模式被判为「永不匹配」，而同形态的 `is` 被接受

`class Round<T> extends Shape<T>` 对主语 `Shape<number>`：宪章 §10 写
「Bare `is Stack` and `case Stack:` are accepted」，实测两者不一致，`case` 侧拒绝
**运行时必然可以匹配**的合法代码。

最小探针 `b26.vel`：

```velar
class Shape<T>:
    let tag: T? = null

class Round<T> extends Shape<T>:
    pass

def name(value: Shape<number>) -> string:
    match value:
        case Round:
            return "round"
        case _:
            return "other"
```

```text
/…/core/b26.vel:9:14 error VEL4001: Type pattern Round can never match Shape<number>
        case Round:
             ^^^^^
```

三个对照探针把范围钉死：

| 探针 | 形状 | 结果 |
|---|---|---|
| `b26m.vel` | 同结构的**单态**孪生（`class Round extends Shape`） | `Checked 1 module`（干净） |
| `b27.vel` | 子类**非泛型**（`class Round extends Shape<number>`） | `Checked 1 module`（干净） |
| `b28.vel` | 同类型、改用 `if value is Round:` | `Checked 1 module`（干净） |

即：**只有「泛型子类 + 已实例化的父类主语 + `case` 模式」这一格**被拒。
`b12.vel` 证明可赋值性链本身是对的（`let b: Stack<number> = Logged()` 通过），
所以缺陷在 `case` 模式的类型比较路径，不在 `isSubclassOf`。

### H-D1 —— VEL5077 漏掉「深写主题」这一拼写：编译静默，运行时转到 100 轮上限

宪章 §15 把被拒的写法枚举为「an assignment, a compound assignment, or a mutating
collection call on the watched collection」。**对被观察值自身做字段/元素写**是
第四种拼写，语义上是同一个环，今天完全静默。

探针 A（记录字段深写，`watch form: form.name = …`）编译：`Checked 2 modules`。
运行时（Node 工程 harness）：

```text
runs=101 reports=1
watch|A reactive watch cannot invalidate itself more than 100 times (watching form): it writes a nested value of a collection while reading it. Read it into a binding before the code that writes it, so the write cannot reach the read that tracked it.||
```

探针 B（List 元素字段写，`watch items: items[0].done = not items[0].done`）编译：
`Checked 2 modules`。运行时：

```text
runs=101 reports=1
watch|A reactive watch cannot invalidate itself more than 100 times (watching items): it writes a nested value of a List while reading it. …
```

而**同一位置**的 `items.append(2)` 被正确拒绝：

```text
/…/web/probe.vel:4:9 error VEL5077: This watch writes its own subject 'items' at the top of its body, so every run re-triggers it and the runtime stops the loop after 100 rounds; write the condition that ends it, or watch the input this value follows and declare 'computed items = ...' instead
        items.append(2)
        ^^^^^^^^^^^^^^^
```

W 裁决的判据是「watch 体顶层、无条件、直接写自己的主题路径」＝「可证的死环 → 错误」。
深写满足全部三条。附带：记录主语的运行时消息说 "a nested value of **a collection**"
—— `form` 是记录不是集合，措辞不真。

### I-D1 —— `velar format` 会把工程之外的 JSX 源码改写成比较运算（既有缺陷，非本轮引入）

强制的「每个能编译的探针文件都过一遍 format 幂等」扫描（99 个 Core 文件全部
幂等且不破坏编译）之外，Web 模块暴露出：**`velar check` 拒绝解析的文件，
`velar format` 照样改写并保存**。

最小探针（目录内及其祖先均无 `velar.json`）：

```velar
export component Panel(userId: string):
    return <p title="t">{userId}</p>
```

```text
--- check ---
/…/lone/j.vel:1:8 error VEL2026: Unknown declaration keyword 'component'; VelarScript declarations start with 'def', 'type', 'enum', 'class', 'const', or 'let'
--- format ---
Formatted /…/lone/j.vel
--- after ---
export component Panel(userId: string):
    return < p title = "t" > {userId} < / p >
```

同一文件通过工程路径（`velar format <project-dir>` 或工程内的文件路径）格式化时
JSX 完好 —— 差别是扩展有没有加载。风险面窄（Web 文件正常都在工程里），但
「解析出错仍然落盘改写」是数据损失形状：格式化器应当在解析产生诊断时拒绝写回。

---

## INCONSISTENT —— 9 条

### A-I1 —— `??` 的分支：`[]` 拿得到期望类型，泛型调用拿不到；而三元分支两者都拿得到

裁决 ① 写的是「期望类型传播集 = §8 空集合规则的上下文类型位置」，理由是
「一个概念一个定义」。`??` 分支上两条规则今天不同意。

```velar
def empty<T>() -> List<T>:
    return []

def go():
    const d: List<string>? = null
    const e: List<string> = d ?? []           // 通过：[] 拿到了 List<string>
    const f: List<string> = empty() ?? []
    const h: List<string> = (try empty()) ?? []
```

```text
/…/core/a05b.vel:7:29 error VEL4001: Cannot assign List<unknown> | List<string> to List<string>
    const f: List<string> = empty() ?? []
                            ^^^^^^^^^^^^^
/…/core/a05b.vel:9:30 error VEL4001: Cannot assign List<unknown> | List<string> to List<string>
    const h: List<string> = (try empty()) ?? []
                             ^^^^^^^^^^^^^^^^^^
```

消息本身就把断层写出来了：**同一个 `??` 里 `[]` 变成 `List<string>`，
`empty()` 停在 `List<unknown>`**。对照 `a05.vel` 的三元分支：
`const c: List<string> = true ? empty() : empty()` —— 干净通过。
所以不是「`??` 不是位置」，而是「`??` 对 `[]` 是位置、对泛型调用不是」。

### B-I1 —— VEL4015 的兜底建议给出的是 VEL4022 会拒绝的拼写

```velar
class Shape<T>:
    let tag: T? = null
class Round extends Shape<number>:
    pass
def name(value: Shape<number>) -> string:
    match value:
        case Round:
            return "round"
```

```text
/…/core/itmp.vel:8:5 error VEL4015: Match on Shape<number> is missing a fallback; class hierarchies are open — end with 'case Shape<number>:' or 'case _:'
```

而 `case Shape<number>:` 正是被拒的拼写（`b29.vel`）：

```text
/…/core/b29.vel:11:14 error VEL4022: Type arguments are erased at runtime, so 'Shape<number>' cannot be checked; check 'Shape' itself
        case Shape<number>:
             ^^^^^^^^^^^^^
```

单态孪生 `b30.vel` 的同一条消息是 `end with 'case Shape:' or 'case _:'` —— 正确。
缺陷是兜底建议把**已实例化的主语类型**直接代入了模板，而模板位只接受裸名。

### B-I2 —— VEL4039 的修法在 `using` 与 `for ... in` 头部不可执行

宪章 §10 说构造处无人求解时「the report names both ways out: annotate the
position, or pass an argument that fixes it」。`using` 绑定**不允许注解**。

```text
/…/core/b17.vel:12:5 error VEL2036: A 'using' binding takes its type from the initializer; write 'using name = expression'
    using r: Res<number> = Res()
    ^^^^^^^^
```

```text
/…/core/b17b.vel:7:15 error VEL4039: Constructing 'Res' leaves type parameter 'T' unsolved; nothing at this position says what it stands for — annotate the binding ('const value: Res<string> = Res(...)'), or pass an argument that solves it
    using r = Res()
              ^^^^^
```

两条规则合起来：**无构造实参的泛型可释放类不能直接进 `using`**。绕法存在
（`const typed: Res<number> = Res()` 再 `using r = typed`，`b17c.vel` 通过），
但消息没指它。`for value in Seq():`（`b17e.vel`）同款：位置里没有注解槽。

### C-I1 —— `List<null>.compact()` 的拒绝理由对 `List<null>` 不成立

```text
/…/core/c07.vel:4:11 error VEL4001: List<null>.compact() has nothing to remove; the element type has no null arm, so drop the call
const b = allNull.compact()
          ^^^^^^^^^^^^^^^
```

`List<null>` 的元素类型**只有** null 臂。拒绝本身可辩护（结果必为空 List），
理由句不真。`List<number>` 上的同一条消息是对的。

### D-I1 —— 从退役模块导入 `range` 双报

```text
/…/core/d02.vel:1:128 error VEL3007: 'range' is a reserved Core binding
/…/core/d02.vel:1:128 error VEL3008: Use range(...) directly; the Core prelude needs no import
```

与 D114 S4b 如实记下的 `type Duration:` 双报（VEL3007 + VEL5065）同一形状：
一个拼写两条错误。两句都真，但同一位置只该有一条。

### F-I1 —— 类型参数位用的是 VEL4021 的通用措辞，不是内建名册那条 VEL3007

D114 S4b 裁决写「五个位置（`type`/别名/`class`/`enum`/导入别名与同名导入）
全部按 VEL3007 一条消息拒绝」，并把类型参数列入名册。实测四个位置措辞对齐、
位置名准确：

```text
'List' is a Core type name, so it cannot also name a type;        …
'Map'  is a Core type name, so it cannot also name a class;       …
'Set'  is a Core type name, so it cannot also name an enum;       …
'List' is a Core type name, so it cannot also name an import alias; …
'List' is a Core type name, so it cannot also name an imported name; …
```

类型参数位则是：

```text
/…/core/ftmp.vel:1:8 error VEL4021: Type parameter 'List' shadows an existing type name; choose another name
def go<List>(v: List) -> List:
       ^^^^
```

对照探针证明这条**不是名册规则**，是通用遮蔽规则在兜底 —— 用户自己的类型同款：

```text
/…/core/ftmp.vel:4:8 error VEL4021: Type parameter 'Foo' shadows an existing type name; choose another name
```

拒绝是到位的；缺的是「这是 Core 内建名」这句话，和裁决说的「一族一条消息」。

### G-I1 —— A17 在 `print(["a", 1])` 报，在 `take(value: unknown)` 不报

裁决 ⑤ 的准入是「字面量所在位置**没有**上下文元素类型（未注解绑定、体推断的
`return`、箭头体）」—— 实参位根本不在表里，但 `print` 触发了：

```text
/…/core/gtmp.vel:1:7 advisory A17: A List holds one element type, so every value read back out of '["a", 1]' is 'string | number'. …
print(["a", 1])
```

而同一轮里 `def take(value: unknown)` 的实参位静默、`def takeList(value: List<unknown>)`
也静默。三个实参位，两种答案。`unknown` 算不算「上下文元素类型」没被写下来。

### I-I1 —— 一等绑定 / `?.` 接收者调用新成员时丢掉解出的键类型；同一轮里 `reduce` 却被泛型化了

```velar
const xs: List<number> = [1, 2, 3]
const g = xs.groupBy
const solved: Map<bool, List<number>> = g(v => v > 1)
const direct: Map<bool, List<number>> = xs.groupBy(v => v > 1)   // 通过
```

```text
/…/core/itmp.vel:3:41 error VEL4001: Cannot assign Map<unknown, List<number>> to Map<bool, List<number>>
```

`?.` 接收者同款：`Cannot assign Map<unknown, List<number>>? to Map<bool, List<number>>?`。

D114 S3b(e) 把这条记为「成员契约非泛型所致 … 留作后续设计项，本轮不做」，
但同一轮的 S3c **把 `reduce` 的公开契约做成了对累加器泛型**（hover 实测
`method reduce: <U>(combine: (U, number, number) -> U, initial: U) -> U`），
而新加的 `groupBy`/`keyBy`/`countBy`/`zip` 四个成员带着同一个洞进来了。
0.28.0 的 CHANGELOG 承诺的是「accepts the same callbacks a direct call does」
—— 字面为真（回调确实被接受），但结果类型不等价。

### I-I2 —— 泛型类的 hover 丢掉 `<T>`

语言服务实测（`textDocument/hover`）：

```text
class Stack decl       => ``class Stack: Stack``
Stack() construction   => ``class Stack: Stack``
numbers binding        => ``const numbers: Stack<number>``
empty() call           => ``function empty: <T>() -> List<T>``
reduce member          => ``method reduce: <U>(combine: (U, number, number) -> U, initial: U) -> U``
```

`def` 与方法都发布 `<T>`/`<U>`，泛型类不发布 —— 声明位与构造位都只写
`class Stack: Stack`。绑定位是对的。

---

## CHARTER-DRIFT —— 2 条

### I-C1 —— 宪章两处仍把 `sortBy`/`minBy`/`maxBy` 写成活拼写

0.28.0 把三者退役（`analyzer.ts:1423` 起是 `retiredCollectionMethod` 表）。宪章：

- §4 第 847 行：「One rule answers "is this ordered" for `<`, `<=`, `>`, `>=`,
  `min()`, `max()`, default `sorted()`, `sorted(by=selector)`, and the
  `sortBy`/`minBy`/`maxBy` keys, so no two of them can disagree.」
- §7 Bounds 表第 2124 行：「`Comparable` | the type has a runtime order |
  `<` `<=` `>` `>=`, `sorted()`, `min()`, `max()`, `sorted(by=)`, and
  `sortBy`/`minBy`/`maxBy` keys, plus text form and JSON shape」

§7 那张表在其上一段被宣布为规范文本（「the table below is the whole definition
of what a bound grants」），所以这是规范条文引用已退役拼写。实测拒绝：

```text
/…/core/d01.vel:1:33 error VEL3008: Use 'values.sorted(by=key, descending=descending)'; velar/collections retired into checked List members
```

### I-C2 —— 宪章 §10 的泛型类范例不是语言自己的规范格式（表面问题）

把 §10 的 `class Stack<T: Comparable>` 代码块原样落盘后 `velar format` 会把
每个单语句方法体折成一行；tour 的 `examples/tour/core/10-classes-and-ownership.vel`
写的正是折行形态且 format 稳定。宪章代码块只过 `check:docs` 的编译门、不过
格式门，所以两处规范文本的排版不一致。

---

## UNDEFINED —— 4 条（charter 沉默处；下列实测行为即应成文的答案）

| ID | 未定之处 | 实测行为 |
|---|---|---|
| **H-U1** | 100 轮自失效报告是否必须给出**写入路径** | 深写形态给（"it writes a nested value of a List while reading it. Read it into a binding…"），**经普通 `def` 的写不给**：`watch\|A reactive watch cannot invalidate itself more than 100 times (watching count)\|\|` —— detail/component 两栏为空，作者被告知有环但不知道写在哪。D114 记 P2b-9 为「报出写入路径」，这一格没有 |
| **H-U2** | watch 主题的**元素/字段写**算不算「写自己的主题」 | 宪章 §15 只枚举三种拼写（赋值、复合赋值、对被观察集合的变更方法调用），深写不在其中；运行时把它当同一个环处理（见 H-D1）。规则要么补第四种拼写，要么写明为什么不补 |
| **C-U1** | `chunk(size)`「positive integer」/ `repeat(count)`「non-negative integer」在**字面量**处是否编译期可查 | 全部编译期静默，只有运行时 `RangeError`：`chunk(0)`/`chunk(-1)`/`chunk(1.5)` → `List.chunk size requires a positive integer`；`repeat(-1)`/`repeat(1.5)` → `List.repeat count requires a non-negative integer`；`repeat(2000000)` → `A List cannot exceed 1000000 items`。**与 `string.repeat(-1)` 一致**（同样只在运行时报），所以是一致的沉默而不是断层 —— 但宪章把它写成契约，字面量处不查这一点没有成文 |
| **A-U1** | **联合**作为期望类型是不是一个位置 | 不是，且 `[]` 与泛型调用**一致**地不是：`const u: List<string> \| number = []` 与 `= empty()` 都报 `Cannot assign List<unknown> to List<string> \| number`。裁决 ① 的位置表没说联合被排除 |

---

## DECIDED-AND-CORRECT —— 完整性凭证（压缩记录）

### A —— 上下文泛型推断（约 30 个探针）

**位置 9 项**：带注解绑定 · 实参位 · **具名实参**（`named(count=1, values=empty())`）·
**rest 实参** · 返回位 · `async` 返回位 · 带注解记录字段 · Web `state` · Web `resource` ·
JSX 属性位（`<Row labels={empty()} />`）—— 全部播种成功。

**包装子透明 4 项**：`await`（`const rows: List<string> = await loadAll(url)`）·
`try`（`const g: List<string>? = try empty()`）· 括号 · 三元两臂。

**类型形状 8 项**：嵌套泛型 `Map<string, List<number>>` · `List<List<string>>` ·
泛型记录应用 `Box<string>` · 泛型记录**别名** · `readonly List<string>` 期望 ·
可选期望 `List<string>?` · `Type<T>` 载体（`carry(User)` 解出 `List<User>`）·
结果不提 `T` 的泛型（`def nothing<T>() -> number`）。

**纪律 3 项**：实参解出的参数**永不被覆盖** —— `const conflict: List<string> = seed(1)`
按普通不匹配报 `Cannot assign List<number> to List<string>`；无上下文位置
静默成 `unknown`（宪章明写，与泛型**类**构造处报错的姿态刻意不同）；
经播种触及的界违规点名期望类型作为求解者 ——
`VEL4031: Type parameter 'T' is bound by Comparable but the expected type solves it to Point; a Comparable parameter accepts the types with a runtime order — numbers and strings`（D114「上报 C」采纳的句式，实测到位）。

**跨模块 3 项**：具名导入 · 重命名导入 · `import * as` 命名空间导入 —— 三种全部保 `T`。

**其它 2 项**：泛型调用作回调实参（`items.map(wrap)` → `List<List<number>>`）·
带默认参数与 rest 参数的泛型 `def`。

### B —— 泛型类（约 32 个探针）

**声明 6 项**：`class Stack<T>` · 带界 `<T: Comparable>`（`ordered()` 得以 `sorted()`）·
`abstract class Box<T>` + `extends Box<number>` + `extends Box<T>` · 方法自带 `<U>` ·
`@iterate:`/`@dispose:` 内 `T` 在作用域 · 构造器参数属性内 `T` 在作用域。

**拒绝 6 项**：静态成员引用 `T` → `VEL4021: … a static member belongs to the class
rather than to an instantiation, so 'T' has no value here; declare '<T>' on this
member, or make it an instance member`（字段与方法各一）· 方法 `<T>` 与类 `<T>` 重名
→ `VEL4021: Type parameter 'T' is already declared by class 'Collide' and is in
scope here; rename this one` · 裸 `extends Bare` → `VEL4001: Generic class 'Bare'
needs a type argument; write 'extends Bare<T>' with concrete types` · 类型位裸 `Stack`
→ 同族消息（与裸泛型记录 `VEL4001: Generic type 'Rec' needs a type argument` 措辞对齐）·
`readonly Stack<number>` → `VEL4001: 'readonly' applies only to data records,
structural objects, List, Set, Map, and Record values; Stack<number> is outside
that boundary` · 类名作值 → `VEL4001: A class name is not a value; call 'Stack()'
directly, or wrap a factory as an arrow '() => Stack()'`（确认：**类不是 `Type<T>` 载体**）。

**构造求解 4 项**：实参解（`Stack(1)`）· 位置解（`const fromPos: Stack<string> = Stack("a")`）·
实参位解（`use(Stack(2))`）· 无人解 → `VEL4039: Constructing 'Stack' leaves type
parameter 'T' unsolved; nothing at this position says what it stands for —
annotate the binding ('const value: Stack<string> = Stack(...)'), or pass an
argument that solves it`。

**类型位 6 项**：注解 · 别名 `type Alias = Stack<number>` · 记录字段 ·
`List<Stack<bool>>` · `Map<string, Stack<number>>` · `Stack<Stack<number>>` ·
参数位与结果位。

**不变性与继承 5 项**：双向不变（`Cannot assign Stack<number> to
Stack<number | string>` 与其反向各一）· `Doubled extends Stack<number>` 与
`Logged<T> extends Stack<T>` 都可赋值给 `Stack<number>` · 替换后的 override 不变性
（`VEL4001: Override 'push' must keep the base method signature (value: number) -> null`）。

**自引用 3 项**：同构自引用接受（`let next: Node<T>?`、`List<Node<T>>`）·
换位拒绝 `Bad<B, A>` · 加深拒绝 `Bad2<List<T>>`，两条消息都解释了原因
（"arguments that change with the depth would need a new instantiation at every
depth, without end"）。

**擦除 3 项**：裸 `is Stack` 接受 · `is Stack<number>` 与 `is not Stack<number>`
→ `VEL4022: Type arguments are erased at runtime, so 'Stack<number>' cannot be
checked; check 'Stack' itself`。

**模块接口 2 项**：`export class Stack<T>` 经具名导入与重命名导入可用；
`namespace.Stack<number>` 在类型位不解析（**KNOWN**，D114 S2 上报 (c) 另立小项）：

```text
/…/core/b21.vel:3:18 error VEL2001: Expected '=' after binding pattern
const a: st.Stack<number> = st.Stack()
                 ^
```

**发射与运行时 3 项**：与单态孪生的可读发射**逐字节相同**（`diff` 无输出）·
`instanceof`、字段、方法、getter 运行正常（`2 2 true`）· `velar format` 对
泛型类稳定且幂等。

**组合 3 项**：泛型类持有泛型记录、泛型记录持有泛型类 · 字段是自身的 List
（`private let kids: List<Tree<T>>`）+ 私有字段与 getter 在替换下正常 ·
`using` 与 `@iterate:` 在有构造实参时正常（`b17d`/`b01`）。

### C —— List 管道成员（约 35 个探针）

**类型 14 项**：`unique compact flatten chunk partition groupBy keyBy countBy zip
repeat min(by=) max(by=) sorted(by=,descending=) reduce` 结果类型全部正确
（`partition` → `{matches, rest}`；`groupBy` → `Map<K, List<T>>`；
`keyBy` → `Map<K, T>`；`countBy` → `Map<K, number>`；`zip` → `List<{first, second}>`）。

**接收者 4 项**：`readonly` 接收者 · `?.` 接收者 · `List<unknown>` 接收者 ·
一等绑定（`const bound = xs.unique; bound()`）—— 全部可调用（S3b(b) 的通用可赋值性规则生效）。

**回调 5 项**：每个元素回调都收 `(value, index)`（`sorted(by=)` 已并入规则）·
`reduce` 的 combine 收 `(accumulator, value, index)` · 少声明参数一律接受
（1、2、3 参三种都试过）· 多要一个参数被拒 —— `Cannot assign (value: number,
index: number, extra: unknown) -> bool to (number, number) -> bool` 与
`Cannot assign (acc: number, value: number, index: number, extra: unknown) ->
number to (number, number, number) -> number` · 比较器保持 `(left, right)`。

**参数检查 3 项**：`sorted(comparator, descending=true)` 被拒 ——
`sorted(descending=) applies to the default order or a 'by=selector'; the
comparator already states the order`；`descending=` 与 `by=` 同用、单用均可。

**边界 4 项**：`compact()` 在非可选元素上被拒并给出改法 ——
`List<number>.compact() has nothing to remove; the element type has no null arm,
so drop the call`；`flatten()` 只脱一层，`List<List<List<T>>>` → `List<List<T>>`；
`flatten()` 在非 List 上 → `List.flatten removes exactly one List level, so it
requires List<List<T>>, received List<number>`；`"text".flatten()` → `string has
no member 'flatten'`。

**键 5 项**：`groupBy`/`keyBy`/`countBy` 的键走 Map 键规则 —— bool、单一 enum、
`null`、记录、NaN 全部接受，与 `Map<Rec, number>`/`Map<null, number>`/
`Map<string?, number>` 直接声明一致；NaN 键运行时按 SameValueZero 归一格（`size=1`）。

**丢弃结果 14 项**：`unique compact chunk partition groupBy keyBy countBy zip
repeat min max sorted reduce` 作裸表达式语句全部报
`VEL4029: '<name>' does not modify its receiver, so the result is discarded;
keep the returned value or remove the call`。

**执行 14 项**（`velar run`，源 `[3,1,2,3,1]`）：
`unique=3 compact=2 flatten=3 chunk=3 partition=3/2 groupBy=2 keyBy=3 countBy=2
zip=2 repeat=10 min=1 max=3 minBy=b maxBy=a reduce=18 sortedDesc=3,3,2,1,1`。

**稳定性 1 项**：`[a(2), b(1), c(2)]` 上 `sorted(by=rank)` → `bac`，
`sorted(by=rank, descending=true)` → **`acb`** —— 相等键保持源序，
证明 `descending=` 是稳定降序而不是升序结果的反转（反转会给 `cab`）。

**快照 7 项**：`groupBy keyBy countBy partition sorted(by=) min(by=) reduce`
的回调各自 `append` 一个元素，源从 3 长到 6，而每个操作都只处理了快照里的 3 个。

**空与不等长 4 项**：`zip` 与空 List、与更短的 List、空接收者 zip；`min()`/`min(by=)`
在空 List 上答 null。

**D97 1 项**：只用 `unique` 的模块只导入 `__velarListUnique`（加 `__velarListSize`）；
只用 `chunk` 的只导入 `__velarListChunk` —— 逐成员按需装配成立。

**反应式 14 项**：对每个新成员各建一个 `computed`，`xs.append(9)` 后全部重算
（`before=3,2,3,2,2,2,3,2,3,6,1,3,3,6` → `after=4,3,4,2,3,2,4,2,4,8,1,9,4,15`）。

### D —— `velar/collections` 退役与 `velar fix`（约 22 个探针）

**诊断 27 项**：模块级一条总述（`Standard module 'velar/collections' retired;
every collection operation is a checked List member — values.groupBy(key) — and
'range' is a Core prelude name that needs no import`）+ 每个导出各一条 VEL3008
点名它变成了哪个成员，含近似重复的四个（`first` → `values.get(0)`、`last` →
`values.get(-1)`、`take` → `values.slice(0, count)`、`drop` → `values.slice(count)`）、
选择器家族（`sortBy` → `values.sorted(by=key, descending=descending)`、
`minBy`/`maxBy` → `values.min(by=key)`/`values.max(by=key)`）、
`repeat` 的语义变更说明（`Use '[value].repeat(count)', which repeats the whole
List the way string.repeat does`）与 `enumerate` 的纯指引
（`Use 'for value, index in values:'`）。

**机械修复 9 项**：位置实参 · 具名实参（`sortBy(xs, key=…, descending=…)`
→ `xs.sorted(by=…, descending=…)`）· 别名导入（`{groupBy as g}`）·
接收者是调用（`sum(source())` → `source().sum()`）· 接收者是三元
（→ `(true ? [1] : [2]).sum()`，加括号正确）· 接收者是 `await`
（→ `(await source()).sum()`）· 链式（`take(xs, 2).map(...)` → `xs.slice(0, 2).map(...)`）·
`first(xs) ?? default` 优先级（→ `xs.get(0) ?? 0`，无多余括号）· f-string / JSX 属性
/ JSX 子节点内的调用点。注释里的同名文本不被改写。

**保守拒绝 4 项**：同一名字既被调用又作为值使用时该名字不迁移、import 行保留它
（同一行上其它可迁移的名字仍然迁移 —— 一行一张编辑表，S3 上报 (b) 的裁决生效）·
命名空间导入只给指引（`drop the namespace import and call the member on the List
— values.groupBy(key)`）· 再导出给专门一句（`a re-export cannot restore a retired
import spelling`）· `enumerate` 不带机械修复。

**混合 1 项**：`import {sum, range}` 一行两条修复（`Use the List member '.sum()'`
+ `Drop the import; the Core prelude needs none`），结果 0 诊断。

**修复后 16 项**：8 个修复文件全部 `Checked 1 module`、`velar run` 结果正确
（`6 / 3 / 2 / 31 / 63 / 2 / 3 / total is 3`）、`velar format` 全部稳定。

### E —— `Function<...>` 退役（约 14 个探针）

**位置 9 项**：类型别名 · 记录字段 · 类字段 · 参数位 · 结果位 · 绑定注解 ·
extern module 契约 · `List<Function<string>>` · `Map<string, Function<number, bool>>` ·
`Type<Function<string>>` · 函数类型参数内的嵌套（`(Function<string>) -> number`）——
每处 `VEL2012` 都带**该处的**箭头改写：`() -> string` / `(number) -> string` /
`(number, string) -> bool` / `(number) -> bool`。裸 `Function` → `() -> null`。

**无效形态 1 项**：`Function<>` → `VEL2012: 'Function<>' names no type; a function
type is written as an arrow — '() -> null' takes no input and answers null`。

**修复 3 项**：7 处一趟改完、结果 `Checked 1 module`、`velar format` 稳定。

**`.d.ts` 桥 6 项**（`parseTypeScriptDeclarations` + `describeType` 实测）：
TypeScript 的 `Function` 一律降为 `unknown` 并带警告
（`TypeScript type 'Function' is outside the VelarScript declaration bridge and
was kept as unknown`），箭头类型如实映射 —— `(x: number) => string` → `(number) -> string`，
`{ go: (a: string) => number }` → `{ go: (string) -> number }`，
`Function[]` → `List<unknown>`。

### F —— 内建类型名保留（约 20 个探针）

**Core 名册 8×1 项**：`List Map Set Record Promise Function Type Duration`
作 `type` 声明全部 VEL3007。

**位置 5 项**：`type` · 别名（`type List = string`）· `class` · `enum` ·
导入别名与 `import js {List}` 同名导入 —— 措辞按位置变形且正确
（"name a type" / "name a class" / "name an enum" / "name an import alias" /
"name an imported name"）。

**Web 3 项**：`type Event:` → `VEL5065: 'Event' is a Web type name, so it cannot
also name a type; every use of it in a Web module resolves to the built-in.
Rename this declaration`；`type Duration:` 在 Web 模块双报 VEL3007 + VEL5065
（**KNOWN**，见 D-I1 同族）；`velar/look` 以本名导入 `Duration` 不算重声明，静默通过。

**留门 2 项（KNOWN，D114 S4b 已如实记）**：`extern module` 里以 `List` 命名
extern class **不拒**（extern 契约名必须等于外来导出名）；`type readonly:`
被接受但类型不可用（`const r: readonly` → `VEL2001: Expected a type name`）。
`type null:` 只有解析器的关键字恢复消息。

**Node/Server 3 项（本轮新探，无缺口）**：Node 拥有的类型名（`Request`、`Server`、
`HttpOutcome`、`Upload`、`Provider`、`Process`、`FileWatcher` …）**不是环境名**，
是 `velar/serve` 等模块的导出 —— 无导入时 `Request` → `VEL4001: Unknown type
'Request'`，所以用户的 `type Request:` 不会被内建吞掉；同模块内既导入又声明时
给出精确的 `VEL3004: Name 'Request' is already imported from "velar/serve";
rename this declaration, or alias the import — import {Request as other}`。
Web 的 `Event`/`Duration` 需要名册是因为它们是环境名；Node 侧不需要同一条规则。

### G —— A17（约 18 个探针）

**触发 6 项**：未注解绑定 · 三类别（`["a", 1, true]` → `'string | number | bool'`，
建议 `{text: "a", count: 1, flag: true}`）· 体推断的 `return` · 箭头体 ·
嵌套字面量 `[["a", 1]]`（内层报）· 未注解记录字段里的字面量（`{pair: ["a", 1]}`）·
enum + number 两类别。

**静默 6 项**：带注解绑定 · 带注解的 `return` · 带注解的记录字段 ·
`null` 元素（`["a", null]` 是 `List<string?>`）· 记录元素 · 同类别元素
（`["a", "b"]`、`[1, 2.5]`）· 展开（`[...base, 1]`）。

**豁免 4 项**：`// velar-allow A17: <reason>` 作行尾注释生效（单行字面量、
多行字面量的**开头行**均生效、`return` 位生效）；写在多行字面量的**结束行**
正确报 `VEL1012: No A17 advisory is reported on this line, so this
'velar-allow' suppresses nothing; delete it`；缺 reason 报
`VEL1011: A 'velar-allow' comment must give a reason`。

**计数 1 项**：两处 A17 汇总为 `Checked 1 module … — 2 advisories`。

**与 A13 无冲突 1 项**：两槽 List 构建器路径上不双报。

> 观察（不立项）：多行字面量在消息里被回显为 `'[ "a", 1, ]'`（换行折成空格、
> 保留尾逗号）；enum 元素的建议字段名取自成员名（`{Red: Color.Red, count: 1}`），
> 读起来像常量而不是角色名。A17 不带机械修复，所以两者都只是文案。

### H —— watch 死循环防护（约 24 个探针）

**VEL5077 触发 4 项**：`count = count + 1` · `x = x` · `x = 5`（W2 明确裁决：
收敛的自写同样拒）· `items.append(2)`（对被观察集合的变更方法调用）。

**VEL5077 静默 5 项（全部为真阴性）**：写同一记录的**另一个字段**
（`watch form.name: form.email = …`）· 条件下的自写（`if count > 3: count = 0`）·
`match`/`for` 体内的写 · 经普通 `def` 的写（按规则静默，运行时兜底）·
`watch total as current, _:` 的形态本身合法（体内自写才报，且报了）。

**VEL5078 4 项**：`watch profile.ready: detach profile.reload()` 报；
不带 `detach` 的直接调用报 VEL4027 + VEL5078（两句都真）；
消息点名了真实输入名（`watch the input the load reads instead, as 'watch userId:'
with 'detach profile.reload()' in its body`）；`watch profile.value: detach
other.reload()`（另一个 resource）静默。

**VEL5079 5 项**：`action` 与 `async def` 两种写回者都报；带参数的 `action` 照报；
条件下的启动静默；被遮蔽的同名局部绑定（写回者体内 `const total = 5`）静默 —— 无误报。

**VEL5079 边界 2 项**：经别名的写（`const target = box; target.n = 1`）静默 ——
裁决的「单跳、同模块、无条件、直接赋值」如实执行；写回者**声明在 watch 之后**时
VEL5079 仍报，与 `VEL3001: Unknown name 'bump'` 并列（级联噪声，写回者确实被找到了）。

**运行时预算 5 项**（Node 工程 harness，Web 运行时逐字节同一份）：
① 跨微任务的环被停并点名同一批 watch（`Reactive updates cannot run more than
100000 observers in one task` + `Ran most in this task: the watch on 'x'`）；
② 跨**宏任务**的链不被停 —— `detach` 里 `await Promise.sleep(0ms)` 后写回，
300 轮 `rounds=300 reports=0`（`frame()` 需要 document，此处以同为宏任务的
`Promise.sleep` 代测）；③ 一个任务内 150,000 次观察者运行、没有观察者启动异步工作
—— `seen=150000 reports=0`，W2 的窗口收窄生效；④ 从 watch 启动的合法 `action`
链写**另一个** state 1,000 次 —— `other=1000 reports=0`；⑤ 溢出之后 `tick()`
仍然结算、后续写入正常生效且不再重复报告（`second tick resolved x=900 reports=1`）。

### I —— 横切（约 15 个探针）

**格式 2 项**：99 个能编译的 Core 探针文件 `velar format` 全部**幂等**且不破坏编译；
0.28.0 新构造（泛型类、新 List 成员、箭头函数类型、修复后的源码）逐个稳定。

**消息形状 1 项**：本轮采集到的全部诊断文本里没有 `undefined` / `[object Object]`
泄漏；涉及的码为 VEL1005 1011 1012 2001 2002 2006 2011 2012 2025 2026 2030 2032
2036 3001 3004 3007 3008 4001 4006 4015 4021 4022 4026 4027 4028 4029 4031 4037
4039 5012 5047 5065 5077 5078 5079 6001 6003 6006 与 A17。

**hover 15 项**：14 个新 List 成员全部发布签名与「compiler-checked List member」
文档（`reduce` 正确显示 `<U>` 泛型）；绑定位的泛型类实例化显示 `Stack<number>`。

**文档 3 项**：`docs/ai-skill.md` / `ai-skill-web.md`（及全部 `docs/*.md`、
`README*`）中 **零处** `velar/collections`、零处可执行的 `Function<`
（宪章仅在 §5/§19 的退役叙事里提名）、零处 `enumerate(` 示例；
根 `AGENTS.md:50` 已改为 `| enumerate(xs) | for value, index in xs: | error |`
（D114 S8 的对齐生效）。

---

## 修复优先序（建议，不含实施）

1. **D-D1（`velar fix` 产出坏源码）** —— 唯一会让工具**损坏用户文件**的一条，
   且正落在这一轮唯一的破坏性迁移路径上。姊妹仓迁移波尚未跑，先修再跑。
   修法方向：同一表达式内的多个改写点按区间收集后一次成文（与 S3 上报 (b)
   对 import 行采用的「一行一张编辑表」同一条纪律，推广到表达式）；在写回前
   对修复结果重新解析，解析失败则整份放弃并报告 —— 这条护栏顺带兑现横切纪律
   「`velar fix` 永不产出带新诊断的程序」。
2. **B-D1（泛型子类的 `case` 被判永不匹配）** —— 拒绝合法且运行时正确的代码，
   泛型类 + `match` 是宪章 §10 明写支持的组合。`is` 路径已经对，把 `case`
   模式的比较改走同一条即可。
3. **H-D1（VEL5077 漏深写）+ H-U2** —— 一起处理：要么把「对被观察值的字段/元素写」
   补进 §15 的枚举并让 VEL5077 认它，要么写明为什么这一格留给运行时。
   顺带修记录主语的运行时措辞（"a nested value of a collection" → 记录不是集合）。
4. **I-C1（宪章两处引用已退役的 `sortBy`/`minBy`/`maxBy`）** —— §7 那张表是
   规范文本，纯文档改，代价最低、误导最直接。
5. **B-I1 / B-I2（两条不可执行的修法建议）** —— VEL4015 的兜底模板改用裸名；
   VEL4039 在 `using` / `for ... in` 位置改说该位置真正可用的走法。
6. **A-I1（`??` 分支的断层）** —— 需要一次实施层裁决：把 `??` 两臂并入位置表
   （与三元一致，也与 `[]` 今天的行为一致），还是把 `[]` 在 `??` 上的行为收回。
   我倾向前者：今天是 `[]` 已经在那里了，泛型调用没跟上。
7. **I-I1（新成员的公开契约非泛型）** —— `reduce` 已经走通了做法（S3c），
   把 `groupBy`/`keyBy`/`countBy`/`zip` 补齐即可闭合 S3b(e) 里因本轮新增而变宽的洞。
8. **I-D1（format 改写解析失败的文件）** —— 既有缺陷，但是数据损失形状：
   解析产生诊断时拒绝写回。
9. **F-I1 / D-I1 / C-I1 / I-I2 / G-I1（措辞与双报）** —— 一批文案与去重：
   类型参数位改用名册那句 VEL3007；退役模块里的 `range` 只报一条；
   `List<null>.compact()` 换个理由句；泛型类 hover 补 `<T>`；
   写明 `unknown` 实参位算不算 A17 的上下文。
10. **C-U1 / A-U1 / H-U1（成文）** —— 三条写进宪章：字面量的 `chunk`/`repeat`
    参数只在运行时查（并说明与 `string.repeat` 同规）；联合不是上下文类型位置；
    100 轮自失效报告在哪些形态下带写入路径。
11. **I-C2（宪章 §10 范例排版）** —— 最低优先，或索性把宪章代码块纳入格式门。

---

## 本文的出身

审计由 D114 后续审计代理在隔离 worktree 完成，只读仓库、只写本账本；
未派实施代理，未提交任何 git 写操作。探针文件在会话草稿目录
`/private/tmp/velar-d114/scratch-audit/`，不入仓。
