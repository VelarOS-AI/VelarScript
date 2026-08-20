# D85 — 空集合必须在自己的位置定型（用户裁决 2026-08-20）

这是一份已实施裁决的历史记录。当前语言契约见
[语言宪章](../language-charter.md#collections)。

## 问题

用户 2026-08-20：「我觉得直接禁止这种用法就好了 `const tags = Set()` 必须标注类型啊，
因为没法在定义的位置推断，如果放任的话只会增加一堆问题和不确定性，
而用户实际也并没有什么收益。」

裁决当天的行为：空 `Set()` / `Map()` / `[]` 绑定若不带标注，分析器开一个
**开放推断组**，由**后面第一次变更**倒着把元素类型填回声明处
（`analyzer.ts` 的 `CollectionInferenceGroup` 一族）。

---

## 第 207 条 —— 主裁决：元素类型必须在构造点就定得下来

### 裁决

**一个空集合构造的元素/键类型，必须在它自己的位置定下来。** 三个来源：

1. 声明上的标注；
2. 上下文类型（形参位、返回位、记录字段位、已标注的字段/`state`）；
3. 构造实参本身（`Set(["a"])`、`Map(entries)`、`Map(record)`）。

三者皆无 → **定向报错**，不推断、不静默取 `unknown`。首次变更推断机制整体删除。

### 理由一：与 [D55 第 126 条](D55-GENERIC-TYPES.md) 是同一个问题的两个相反答案

D55 第 126 条已裁定裸 `Box`（不带类型实参）**拒绝**，理由逐字适用于裸 `Set()`：

> `unknown` 满足每一条约束……于是 `Box<unknown>` 的校验器会**接受一切**：
> 作者漏写实参，换来一个静默放行的运行时校验器。

裁决前，`Box` 漏写实参报错，`Set()` 漏写实参却从后面几行倒着补回来。
本条把两者拉齐到同一个答案。

### 理由二：全仓零自然使用（实测）

94 个 `.vel` 文件里，未标注的空集合绑定共 **4 处**：

| 站点 | 性质 |
|---|---|
| `examples/tour/core/07-list-set-map.vel` ×3 | 在一个**名叫 `inferredFromFirstMutation`、专门演示该机制本身**的函数里 |
| `tests/corpus/core.vel:43` | 格式化/编译语料 |

**这个机制唯一的用户是它自己的展示柜。** 与此同时，语言的全部教材写的都是标注形式
—— charter §8 自己教 `const tags: Set<string> = Set()` 与
`const users: Map<string, User> = Map()`；`ai-skill.md` 教
`const tasks: List<Task> = []`；`web-api.md` 教
`state messagesById: Map<string, Message> = Map()`。**没有一份教材用过它。**

### 理由三：它是语言里唯一的「倒着推断」，且已经在制造错误的诊断

语言其余所有推断都是**前向**的：窄化沿控制流走，赋值在赋值点立事实。
只有这一处让**后面的语句改写前面声明的类型**。代价是实测可复现的坏诊断：

```
def make() -> List<string>:
    const a = []
    return a
→ VEL4001 Cannot assign List<unknown> to List<string>
```

返回类型就在上一行，读者眼里 `a` 显然是 `List<string>`，编译器却说 `unknown`
—— 因为该机制**只认变更、不认上下文**。同族还有「先传参后变更」：

```
const a = []
take(a)               // take(values: List<string>)
a.append("x")
→ VEL4001 Cannot assign List<unknown> to List<string>
```

它还与窄化的既有边界**互相矛盾**：charter §5 明写「窄化不流入嵌套函数体」，
但集合推断流入 —— `const a = Set()` 后跟 `const f = () => a.add("x")`
实测推断成功。同一个「后面的代码能不能改前面的事实」问题，语言给了两个答案。

### 理由四：机制成本与收益不成比例

删除面：`CollectionInferenceGroup` 接口、2 个 WeakMap、6 个方法、14 处调用点，
其中包括一段 53 行、带 WeakMap-of-WeakSet 环切的递归
`freezeEscapedCollectionInference`，以及在推断收敛时**回溯重写已发出的语义绑定**
（编辑器 hover 要被追认修正）。全部成本用来省掉一个标注。

---

## 第 208 条 —— 边界（穷尽）

### 禁止

```
const items = []
const tags  = Set()
const byId  = Map()
let   seen  = Set()
state rows  = []          // Web 侧 module 与 component 两处 state 同规则
```

**`[]` 必须同族。** 用户给出的理由（「没法在定义的位置推断」）对 `[]`
一字不改地成立，且 `[]` 是三者中最常见的。半禁会留下全部机制代码外加一条不一致，
严格更差。

### 保持合法

```
const tags: Set<string> = Set()    // 标注
take(Set())                        // 实参位上下文
const t: T = {items: []}           // 记录字段位上下文
const initial = Set(["a", "b"])    // 实参定型
const r = {}                       // 空记录字面量：没有元素类型的洞，不同族

def make() -> Set<string>:
    return Set()                   // 返回位上下文
```

### 不覆盖：非绑定位的一次性表达式

`print(Set().size)` 不报错。规则挂在**绑定**上 —— 需要类型的是「后面会被读的那个名字」，
不是一个立刻丢弃的值。

### 本条拿掉的唯一真能力：匿名记录元素

标注里**没有匿名记录类型语法**（实测 `List<{a: number}>` 解析失败），所以裁决前

```
const rows = []
rows.append({a: 1, b: "x"})
```

是「元素为匿名记录的 List」的唯一写法。裁决后必须先 `type Row:`。

判定为**净收益**：类型拿到名字，正对「AI 写、人读」的定位；且语言其他位置本来就
不允许它（类字段必须标注，而标注拼不出匿名记录），匿名记录元素在裁决前已经是
只能活在局部变量里的二等公民。

---

## 第 209 条 —— 诊断：VEL4039，说清为什么，不给机械修复

照 extern 参数那条的模式（`parser.ts`：`...requires an explicit type;
there is no body to infer from`）—— **说清为什么**：

```
VEL4039  Empty Set() requires an explicit type; nothing at this position says
         what it holds — write 'const tags: Set<string> = Set()'
```

`Map()` 版说 key and value types，`[]` 版说 element type。一个码三条文案，
与 VEL2021 同时覆盖类字段和构造器参数字段的做法一致。

**不给机械修复** —— 编译器不知道该填什么，一个猜出来的修复会把作者的疏忽
变成一个静默错误的标注。

判据函数 `isFreshUnresolvedCollection` 在裁决前就已存在，原地改成报错即可
（另加两条收紧：只有**真正空**的构造才算未定型 —— `[value]` 里恰好是 `unknown`
的元素说清了它装什么；`Set(values)` 有实参也不算）。

### 与 VEL2031 的交接：一个错误只报一次

`const tags = Set<string>()` 实施中暴露一处级联：VEL2031 先教「类型实参不写在
调用位」并把实参从 AST 里摘掉，接着 VEL4039 又说「你没说它装什么」——
**同一个错误报两遍，而且两条话互相打架。** 两处一起修：

1. 摘掉类型实参的调用在 AST 上留一个 `typeArgumentsRemoved` 标记，
   VEL4039 见到它就不报 —— 作者确实说了类型，只是位置不对；
2. 空 `Set<string>()` / `Map<K, V>()` 的 VEL2031 换一条**能落地**的文案
   （`an empty 'Set()' takes its type from the binding — write
   'const values: Set<string> = Set()'`），并**撤掉它的机械修复** ——
   原来的修复只删尖括号，改完仍然编译不过，那种修复比没有更坏。

非空的泛型调用（`mapValues<string, bool>(...)`）文案与机械修复原样不动。

---

## 第 210 条 —— 顺带修：成员探测不得加宽（与主裁决独立，各自成立）

排查主裁决时实测发现的独立缺陷：**成员探测在容器元素/键类型为 `unknown` 时，
把探测对象从它的声明类型「窄化」成 `unknown`** —— 那是加宽。

```
def check(items: List<string>, tags: Set<unknown>):
    for tag in items:
        if tag in tags:
            print(f"{tag}")     // VEL4026：f-string 拒绝 unknown
```

`Set` / `List` / `Map` 键探测三处均复现。根因在 `runtimeCheckedType`：
类型重叠时**无条件返回 `checked`**，是替换而非求交，于是 `string ∩ unknown`
算成了 `unknown`。

**裁决：`unknown` 是唯一什么也不证明的被检域，对它的检查保持主体原类型不变。**
修在 `runtimeCheckedType` 而非三个探测点 —— 那是「同一件事在 N 个独立地方构造」
的反面，与 D55 第 121 条选方案 (a) 同源。

### 范围只到 `unknown`，不写成「窄化永不加宽」（试过，据实收窄）

实施中先按更宽的形式写过：**输入已可赋给被检域时就保持输入**。它立刻打红
`[COL-D2]` —— `const raw: unknown = {name: "n", age: 39}` 之后 `assert raw is User`，
`raw` 的赋值事实是**结构类型** `{name, age}`，它可赋给开放的具名 `User`，
于是新守卫把 `is User` 的**具名**窄化吞掉，`{...u}` 的定向诊断
（"a named record is open"）退化成 `Cannot assign number to string`。

也就是说，「保持更精确的输入」在**具名**类型上是错的：`is User` 建立的是
具名事实，不是结构事实，而语言的开放具名记录规则挂在前者上。因此本条**只**
覆盖 `unknown` —— 那是唯一一个「被检域什么都不证明」因而保持输入必然正确的情形。

charter §8 关于成员探测的措辞（「proves `value` is of the container's element or
key type」）保持不变：当那个类型是 `unknown` 时，这句话本来就什么也没证明。

**本条独立于第 207 条成立**：主裁决只关掉了通向它的一条常见路径
（未标注空集合让容器停在 `unknown`），显式 `Set<unknown>` 上缺陷照样复现。

---

## 第 211 条 —— 顺带修：`Map.set` 必须提供上下文类型（与主裁决独立）

第 207 条把「上下文类型」立为三个定型来源之一，随即暴露：**`Map.set` 根本不把
接收者的声明类型交给实参**。`List.append` / `Set.add` 一直传
（`inferArgument(0, object.element)`），`Map.set` 不传。后果实测（**裁决前就存在**，
在已发布的 0.10.1 上复现过，不是本次引入）：

```
const m: Map<string, List<number>> = Map()
m.set("a", [])              → VEL4001 Cannot assign List<unknown> to List<number>
m.set("a", v => v + 1)      → VEL4001 Cannot assign unknown to number   ← 箭头参数没被定型
```

**裁决：`Map.set` 的键与值都传上下文类型。** 理由是它与第 207 条是同一条规则的
两面 —— 声明写在标注上，然后语言拒绝在该标注供得起的位置使用它，那条规则就是
半真的。而 `Map.set` 的值位与 `List.append` 的元素位是同一种位置（单个值），
本就该有同一种待遇。

### 但**不**推广到 `extend` / `update`（试过，据实回退）

`List.extend`、`Map.update`、`Set.update` 也不传，实施中一并改过，实测后回退：

- **收益近零** —— 它们收的是整个集合，实参几乎不可能是需要上下文的字面量；
  唯一被修好的是 `l.extend([])` 这种空扩展，那是个空操作，没人写；
- **代价真实** —— 传了上下文之后，`l.extend(["bad"])` 从一条诊断变成**两条**
  （容器一条、元素一条）。一个错误报两遍，正是第 209 条刚拔掉的那类；
- `Set.update` 的期望类型是联合 `Set<T> | List<T>`，上下文**对空 List 字面量
  根本不生效** —— 连那点收益也没有。

**本条独立于第 207 条成立**：`Map.set` 在裁决前同样报错，只是当时可以退回
「不标注、让首次变更去猜」，而那条退路本身就是第 207 条要删的东西。

---

## 重开条件（证伪判据）

以下任一出现，第 207 条重开：

1. 出现一个真实的元素类型，**三种定型来源都表达不了** —— 匿名记录已知且已在
   第 208 条权衡过，不算；
2. 盲测中模型被 VEL4039 教过之后仍反复写未标注空集合（说明教学没生效，
   而不是规则错）。

**不构成重开理由**：少打字符、与 TypeScript 的 evolving array 一致
（那是 TS 限定于 `let`/`var` 的已知疣，不是先例）、「看起来更顺手」。
