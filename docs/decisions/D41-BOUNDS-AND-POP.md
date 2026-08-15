# D41 — 封闭词汇类型约束 + `pop` 去重 + 三项文档/清理（已批准，待实施）

用户于 2026-08-12 裁决：类型约束「能不能做到可控，尽量规则简单支持优先，
未来看情况拓展」→ **做，按封闭词汇有界多态**；并指出 **`removeLast` 与 `pop`
重复** → 去重（本文第 62 条）；其余按编排代理推荐执行。

---

## 第 61 条 —— 封闭词汇类型约束 `<T: Text>`（归批次 M）

### 为什么现在可行

修复波 1 为堵 `str` 一等值的钩子洞，已在内部建成 **`textConvertible` 标记
类型 + `isTextConvertibleType` 可赋性判定**（`packages/compiler/src/types.ts`、
`analyzer.ts`）。暴露为约束是**复用现成机器**，不是新造机制。

### 解决的真实问题（实测）

```
def label<T>(value: T) -> string:
    return f"{value}"
→ VEL4026: format T explicitly   —— 泛型 label/render 辅助函数写不出来
```

### 三条硬规则（可控性的全部保证）

1. **约束名是编译器自有的封闭集合，用户不可定义**。词汇**一次性设计完整**
   —— 由编译器反查「所有拒绝无约束类型参数的位置」系统导出，不是发一个等
   撞墙再补（用户 2026-08-12 方法论纠正：证据门控品类、不门控边界内完整性）。
2. **只有 `def` 的类型参数可带约束**（`type`/`class`/`component` 本就不能有
   类型参数，charter §7 已成文）。
3. **约束只做两件事**：调用点检查（T 解出后验证）+ 函数体内解锁（T 视为满足
   该约束）。**没有**条件类型、映射类型、约束间运算、约束推断、约束的默认值。

与 charter 规则 4 的关系成文：规则 4 排除的是 TS 式**类型级编程**（条件类型、
映射类型、重载集 —— 图灵味的类型计算）；封闭词汇的**有界多态**是
Java/C#/Kotlin/Swift/Rust 的基础设施，属不同品类。TS 的 `extends` 可拿任意
类型作界，故危险；本设计的界是编译器给的固定少数几个词。

### 目标语义

```
def label<T: Text>(value: T) -> string:
    return f"{value}"

label(5)       // ✓
label(user)    // ✗ 调用点：User does not satisfy Text
```

- 语法：类型参数列表内 `T: Bound`，多参数各自可带（`<T: Text, U>`）。
- 检查时机：泛型两阶段推断（D8）解出 T 之后验证；诊断落在**导致该绑定的实参**
  （沿用 D31 第 27 条 bind-then-check 的「错误报在因处」原则）。
- 函数体内：`T` 参与 `isTextConvertible` 判定为真，故 f-string/`str()` 放行。
- 未标注约束的类型参数行为**完全不变**（现有泛型全部不受影响）。
- 诊断：未知约束名 → 定向列出可用约束集；`<T: SomeUserType>` → 明确
  「约束是编译器自有的封闭集合，不接受任意类型」。
- charter §7 类型参数段落增补一小节；AI 简报加一行。
- 回归：`label(5)`/`label("x")`/`label(Status.a)` 通过；`label(user)`/
  `label(list)` 在实参处报错；未标注泛型不回归；`<T: Unknown>` 与
  `<T: UserType>` 各自定向拒绝；跨模块导出的带约束 def 保持约束。

### 完整词汇（编译器反查导出，2026-08-12；74 个探针全部实测）

**恰好三个约束，且构成一条包含链**：

```
Comparable ⊂ Text ⊂ Data
```

| 约束 | 含义 | 解锁的操作 | 复用的既有谓词 |
|---|---|---|---|
| `Text` | 可无钩子转文本 | f-string 插值、`str(value)`、`str` 作一等值传递 | `isTextConvertibleType`（types.ts:110，修复波 1 已建） |
| `Comparable` | 有运行时可用的全序 | `<` `<=` `>` `>=`、`sorted()` 无比较器、`min()`/`max()`、`sorted(by=)`、`sortBy`/`minBy`/`maxBy` 键 | `isCollectionOrderKey`（analyzer.ts:6484） |
| `Data` | 严格 JSON 形状 | `stringify`/`stableStringify`、`json.clone`、`http.request` body、`storage.set`、`realtime.sendJson` | `jsonSerializable`（analyzer.ts:6458，扩展钩子已存在） |

**链关系是发现而非设计**：每个 Comparable 类型都可文本化（`bool` 是 Text 但非
Comparable，故严格包含）；每个 Text 类型都可 JSON 序列化（`List<string>` 是 Data
但非 Text，故严格包含）。

### 多重约束：不需要，且可证

判决性例子（唯一看起来需要两个的形态）：

```
def topLabels<T: Comparable>(values: List<T>) -> List<string>:
    return values.sorted().map(str)     // 既要排序又要文本
```

链关系下用单词 `Comparable` 即可。**语法不含 `+`**（编排代理决定，用户可否决）：
实现为一张 4×3 的**能力授予常量表**而非约束间子类型计算 ——

| 约束 | Text 能力 | Comparable 能力 | Data 能力 |
|---|---|---|---|
| 无 | 否 | 否 | 否 |
| `Data` | 否 | 否 | 是 |
| `Text` | 是 | 否 | 是 |
| `Comparable` | 是 | 是 | 是 |

检查器只读常量表、不计算关系，故字面满足「约束间无子类型」规则。诚实标注：
它**是伪装的关系**；采用它的理由是它让语法更简单（去掉 `+`），符合用户
「规则简单」的方向。

### 排除清单（与纳入同等重要）

**今天已可用，无需约束**：`Equatable`（`==` 对任何类型都不检查操作数，实测干净）；
`Key`/`Hashable`（`Map<T,V>`、`Set<T>`、`groupBy`/`keyBy`/`unique`、`in` 全部
已接受裸参数 —— 键身份是原生 JS 身份，不需静态承诺）；`Iterable`（`for x in
List<T>/Set<T>/Map<T,V>` 已可用）；`Type<T>`（`target.is/parse` 已可用）。

**在本语言里无意义**：`Numeric`（**Vel 只有一种数值类型**，`T: Numeric` 等于
`T = number`，纯仪式）；`Bool`（同理，单一居民）；`Error`（`throw` 已通过普通类
子类型接受任何 Error 子类，写 `e: Error` 严格优于 `<T: Error>`）。

**按规则 1 不可能**（用户不可定义约束）：结构/成员约束（`value.size`、
`value()` —— 必然要指名用户形状）；裸 `T` 的 `Iterable`（五种可迭代物元素类型
互不兼容，无关联类型机制只能产出 `unknown`，比现有「标注 `List<T>`」更差）。

**形状问题而非能力问题**（解法是标注形状）：展开、`await`、Map 构造、解构、
索引赋值、`readonly T`（`readonly List<T>` 已可用）、`Record` 索引。

**擦除问题而非能力问题**：`value is T` / `case T` → VEL4022，无静态约束能提供
运行时身份，`Type<T>` 是设计答案（charter 已成文）。

### 规则 2 的措辞修正（反查发现）

原写「只有 `def` 的类型参数可带约束」不精确：**类方法与 extern 函数声明合法地
带类型参数**（charter 第 877 行明文）。正确措辞：**凡类型参数已合法之处**
（顶层 `def`、导出 `def`、extern `def`、类方法）；`type`/`class`/`component`
仍由 VEL2025/VEL2023 拒绝（实测确认）。

### 检查时机（两个站点，不是一个）

1. `inferGenericCall`（analyzer.ts:4108-4200）解出 `bindings[]` 之后、既有
   `requireAssignable` 循环之前。回调解出的 T 亦正确落在 lambda 实参（实测）。
   **必须跳过未解出的 T**（`bindings[i] === null` → `unknown` → 谓词为假 →
   否则每个未解出参数都误报）。
2. **首类值路径**：`concreteCallableFor`（analyzer.ts:4208）→
   `instantiateGenericCallable`（types.ts:924）静默求解并擦除类型参数名，
   `const f: (number) -> string = label` 今天可编译，故该路径也必须查约束；
   后者无诊断通道，检查归 analyzer 包装层。

**「错误报在因处」的唯一例外**：`def pick<T>(a: T, b: T)` 传 `(1, user)` 时
T 被合并成联合，无单一实参可归因。规则：**恰有一个计划实参提及该参数时报在
实参处，否则报在调用点并写出解出的类型** —— 这是 D31 第 27 条无法字面遵守的
唯一位置。

### 实现风险（批次 M 必读）

1. **约束不可放进 `parameter` 类型 kind**：`typeIdentity` 有意只编码 index
   （De Bruijn，types.ts:526-529 附注释说明原因）。放进去会破坏该契约；排除在
   身份之外则使 `<T: Text>(T)->T` 与 `<U>(U)->U` 成为**同一类型** —— 赋值上的
   健全性洞。安全位置：callable 上与 `typeParameterNames` 并列的
   `typeParameterBounds?: readonly (string | null)[]`，同下标。
2. 因此 `TypeEnvironment` 需新增可选钩子 `boundOf(parameter)`，由 analyzer 对
   一个与 `typeParameterFrames` 并行的约束帧栈实现。**`.at(-1)` 单帧即健全** ——
   引用外层 def 的类型参数已被 VEL4021 拒绝（实测确认嵌套泛型 def 合法但封闭）。
3. 成本极不均衡：`Data` 一个私有谓词（最便宜，扩展钩子已存在）；`Text` 一个
   谓词 + 一个已存在的 `isAssignable` 分支（便宜）；**`Comparable` 跨六个站点
   四套机制**（3650 直接 kind 检查、7116/7122 两个近重复私有谓词、6484
   `isCollectionOrderKey`、4866 函数类型可赋性）—— 最贵，且**被下述三缺陷阻塞**。
4. **`typeParameterNames` 在三处独立构造**（analyzer.ts:5879、5900、
   index.ts:846）。三处都要带上约束，否则约束会在某条路径上静默消失 ——
   `index.ts:846` 正是跨模块导出接口那条，决定「导出的带约束 def 保持约束」
   这条回归成败。
5. 解析器与格式化器低风险：`parseTypeParameters`（parser.ts:807）一处改动覆盖
   全部七个调用点；格式化器是文本切片不重打 AST，无需改动。

**永不放宽**：用户不可定义约束。封闭是完整性负担得起的前提；若某天需要开放，
那是另一次显式语言裁决，不是本设计的自然延伸。

---

## 第 62 条 —— `pop` 严格化并删除 `removeLast`（用户指出的重复，去重）

### 现状是我方引入的重复（D29 附议 D 的错误）

```
v.pop()          // 弹末项，空表返 null
v.removeLast()   // 弹末项，空表抛错   ← 同一操作的第二个名字
```

当初以「`[]` 严格 / `.get()` 可空」为其辩护，但那一对是**读**的两种意图；
此处是同一个**变更**操作有两个名字，且名字本身看不出是一对 —— 规则 3 违例。

### 目标语义

- **`pop(index=-1) -> T`**：移除并返回该位置的值；**空表或越界抛
  `IndexError`**（与 `[]` 一致；父亲 Python 的 `list.pop()` 同样抛 IndexError）。
- **`removeLast()` 删除**（D29 附议 D 撤销，理由记档；批次 A 已落地的 5 处
  stdlib 迁移改为 `pop()`）。
- **排空惯用法改为大小守卫**：
  `while chunks.size > 0:` + `const chunk = chunks.pop(0)` ——
  比 charter §9 现教的 `while true: … if null: break` 更短更直白。
- 顺带消噪：`blocks.pop() ?? ""` 这类 `?? fallback`（因 pop 可空而生、而
  `split` 本就保证非空）全部退役 —— 批次 A 实施者当时已注意到该别扭。
- 本条**涵盖**编排代理原推荐 #2（`pop(i)` 越界收紧）：pop 整体严格。
- charter §8 List 成员表与 §9 排空示例、AI 简报、典章同步。
- 迁移：全仓 `pop()` 站点按语义分流 —— 需要「可空」的原意其实是「先判空」，
  改大小守卫；stdlib 与 Lite 的 `?? fallback` 噪音删除。
- 回归：非空弹出、空表抛、越界抛、负索引从末尾计数、排空循环执行级、
  `remove(value)`（按值删，返 bool）不受影响。

---

## 第 63 条 —— 三项按推荐执行（用户「其他的按你的推荐走」）

1. **`str()` 不是逃生阀，成文**（归批次 C）：`unknown`/`any` 被 `str()` 拒绝
   后，JS 边界值没有直接转文本的路径。charter §7 明写一句 + 指出正路
   （先 `Type.parse` 验证再转），避免读者预期它是逃生阀。
2. **扩展文本钩子**（归批次 I，方向已定：**单位值可进 f-string**）：
   `f"gap: {16px}"` 应当合法（文本形 `16px` 无歧义、是自然写法）。实现 D32
   当时后置的扩展文本钩子；在钩子落地前，VEL4026 对扩展值只教 `print(value)`
   （现在教的 `stringify(value)` 对 Length 同样失败 —— 断掉的出口，D40 第 60 条）。
3. **`velar/math` 的 `isFinite`/`isInteger` 函数删除**（归批次 K）：与新增数字
   方法构成双拼写；D17 方法化时 `abs`/`round`/`floor`/`ceil` 的函数形式已删，
   这两个漏网。按同先例删函数、留方法、给定向指引。

---

## 批次归属

第 61 条 → M（新语法波，与 using/try/test 同批，都深改 parser 与类型层）；
第 62 条 → 新增小波 **A′**（值方法表 + 迁移，可紧随修复波 2）；
第 63.1 → C；63.2 → I；63.3 → K。
