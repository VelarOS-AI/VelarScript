# D55 — 泛型类型与泛型类（2026-08-15）

用户 2026-08-15：「泛型类型与泛型类这个可以设计一下。」
本文是设计裁决。调查报告见本波的只读探查（探针全部在 `git archive HEAD` 快照上
跑过并在稳定后的活树复验）。

---

## 第 119 条 —— 出身澄清：这是**补完**，不是**推翻**

调查结论决定性，先立此条，因为它决定后面所有条款的性质。

**全仓唯一给出理由的地方是 D8 的提交说明**（`79cc19a`）末段：

> Generic type, class, and component declarations, bounds, and variance are
> deliberately out of scope.

这句话点了**三样**：泛型声明、**约束**、变型。而**约束后来被设计并建成了**
（D41 第 61 条、批次 M）。因此 D8 的 "deliberately out of scope"
**已经被证明意思是「本增量不做」，不是「永不做」**。`archive/HANDOFF.md:31` 的决策日志
用词一致：「**泛型 v1** —— 仅 def、调用点两阶段推断、de Bruijn 身份」。

此后每一处提及都是**观察性的，没有一处是论证性的**：D41:129「实测确认」、
WAVE-M-REPORT:96 是断言、COMPLETENESS-AUDITS:146 列在「已定且正确」枚举里。
charter 两处（657-660、1291-1294）都是 D8 那句话的复述。

**裁决：不存在「命名类型不得携带参数」的裁决。** 本文因此是补完既有增量，
按正常设计流程推进，不需要推翻任何东西。

---

## 第 120 条 —— 层级：记录先行，类押后，组件永久排除

| 层 | 形态 | 裁决 |
|---|---|---|
| **一** | `type Box<T>`（泛型记录） | **批准**，本设计的主体 |
| **二** | `class Stack<T>`（泛型类） | **推迟到第二增量**，不否决 —— 但**理由与直觉相反**，见下 |
| **三** | `component Foo<T>` | **永久排除** |

### 层二为什么押后：它**不比层一便宜，而是更贵**

直觉是「类没有运行时校验器，所以更便宜」。**一半对，一半正好反过来**：

- **运行时确实更便宜**：类检查是 `instanceof`（`emitter.ts:1512`），
  **对类型实参天然无视**，所以在擦除下本来就是可靠的，零校验器工作。
- **静态显著更贵**：类的可赋值性走 `isSubclassOf`（`analyzer.ts:1653`），
  是**沿基类链走字符串，完全没有结构成分**。记录能从
  `objectFieldsAssignable` 白拿变型（见第 122 条），**类一点也拿不到**。
  泛型类需要全新的变型逻辑；而且与记录字段不同，**类的方法把 `T` 放在逆变位置**
  —— 这个情形今天全仓没有任何东西建模过。继承还会叠加
  （`class IntStack extends Stack<number>` 要沿一条今天只带名字的基类链做代换）。

两层代码路径与测试互不相干，**可分**；但必须**记录在前、类在后**，
且**记录的工作不会为类的工作降低风险** —— 这一点要写进排期，避免将来
误以为「层一做完层二就顺手了」。

### 层三为什么永久排除

组件的 props **本来就是只读投影**，而它的实例化位置是 JSX 调用点，
那里的 `<` 是标记。解析歧义是真的，收益可忽略。**入 D54 的「考虑并否决」族。**

---

## 第 121 条 —— 机制：类型实参进身份串（类型级单态化）

### 裁决

`Box<string>` 与 `Box<number>` 是**两个身份**，各自注册一份**已代换**的字段表
与一个**单态化**的校验器。命名类型携带实参，`parameter` 种类**不携带**。

### 为什么不动 `parameter`

D41 遇到过**同一个问题**并已给出先例（`types.ts:642-648` 原注释）：

> 约束不能进 `parameter` 种类的身份，否则会破坏它的 De Bruijn 契约，
> 所以由 callable 携带 —— 否则 `<T: Text>(T) -> T` 与 `<U>(U) -> U`
> 会共享一个身份，两者之间的赋值就不受检了。

**同一条先例逐字适用**：判别信息移到**外层构造**上，不进 `parameter`。
De Bruijn 契约（「任意两个声明在同一 index 上的参数是同一个类型」）保持为真。

### 为什么是身份串，而不是给 `named` 加 `arguments` 字段

| 方案 | 代价 |
|---|---|
| **(a) 实参进身份串**（采纳） | `typeIdentity` 的 `named` 分支不动、`fieldsOf` 不动、**38 处 `fieldsOf` 调用点全部不动** |
| (b) `named` 上加 `arguments?: ValueType[]` | 更「有原则」，但 `fieldsOf` 返回的是**泛型**字段表，于是**38 处调用点每一处都要自己做代换** |

(b) 正是批次 M 已经付过一次学费的那类危险 —— 「同一件事在 N 个独立地方构造」。
**采纳 (a)。**

---

## 第 122 条 —— 变型：白拿，且**按字段**而非按参数

**这是本次调查最强的正面发现。** `objectFieldsAssignable`（`types.ts:1144-1156`）
**今天就在逐字段判变型**：只读字段协变，可变字段不变。实测（活树）：

```
readonly 字段 BoxDog -> BoxAnimal        → 接受
可变字段   BoxDog -> BoxAnimal           → VEL4001 Cannot assign BoxDog to BoxAnimal
readonly List<Dog> -> readonly List<Animal> → 接受
List<Dog> -> List<Animal>                → VEL4001
```

**裁决：**

1. **「可变不变、只读协变」立为泛型记录的变型规则** —— 它已经是实现行为，
   与 charter 的 `readonly List<T>` 协变规则自动一致。
2. 在方案 (a) 下（两个身份 + 各自已代换的字段表），变型**需要零行新代码**。
3. **不引入声明处变型标注**（`in`/`out`）。按字段判定**严格更精确**
   —— 同一个 `Box<T>` 里只读字段协变、可变字段不变，声明处标注做不到这种
   区分 —— 且**零新语法**。这与本语言「封闭词汇表、不给用户新标记」的纪律一致
   （charter §19 的用户自定义标注禁令同源）。

---

## 第 123 条 —— 拼写：命名实例化，不进表达式位

### 用户的直觉是对的，问题不在语义而在文法

用户问过：「`Box<string>.parse(raw)` 这个拼写有什么问题吗，我感觉可以被理解。」

**语义上没有问题，用户是对的** —— 类型实参在实例化点静态已知，校验器可由
单态化或既有 `Type<T>` 载体构造出来（第 124 条给出证据）。

**问题在文法，而且是双亲共有的老问题**：表达式位的 `<` 是比较。解析器有一个
启发式（`explicitTypeArgumentsEnd`，`parser.ts:2730`）能认出 `name<Type,...>(`，
但它**要求后面紧跟 `(`**（parser.ts:2760），所以 `Box<string>.parse(x)`
会掉进比较链解析。实测：

```
const t: Type<List<string>> = List<string>
→ VEL2031 Comparison chains must point one way
```

### 裁决：给值就命名它 —— **零文法改动**

```
type Boxed = Box<string>
const value = Boxed.parse(raw)
```

理由不止于「绕开歧义」：

- **这已经是本语言教的写法。** `docs/ai-skill.md:547-549` 现就教「读取需要一个
  **具名**运行时类型 —— 原始类型或泛型拼写是类型，不是值」，并以
  `type SavedItems = List<SavedItem>` 为正路。**「命名一个实例化」本来就是 Vel
  把泛型拼写变成值的既有惯用法**，泛型记录只是让它适用于用户自己的容器。
- 因此本条**不新增概念**，也不动解析器。TypeScript 需要 `f<T>()` 消歧、
  `a < b > c` 永远歧义 —— 我们用命名绕过整个问题族。

---

## 第 124 条 —— 校验器：机制已经建好，不可校验集合极小且已有诊断

三条独立证据：

1. **组合式校验器已支持任意嵌套。** `emitTypeCheck`（`emitter.ts:1477`）递归组合：
   `type Items = List<Item>` 发射
   `__velarListTypeIs(value, item => __velarTypeCheck_Item(item, __state))`。
   把 `T := string` 代换进字段类型后跑现有发射器，**就是全部工作**。
2. **具体化路径端到端已存在。** charter 940-958 的 `Type<T>` 是官方机制；
   实测发射产物里，运行时校验器已经在**作为值传递、动态派发、并用于收窄到擦除的 `T`**。
3. **不可校验集合极小，且诊断已存在。** 函数型字段按载体校验（`typeof === "function"`），
   与 promise 字段一致，**能过**；唯一真正过不去的是 `Type<User>` 型字段，
   而它今天就在**声明处**被 VEL4022 拒绝
   （`typeContainsRuntimeTypeCheck`，`types.ts:797`）。

**裁决：**

- `Box<() -> null>` **合法**（按载体校验），不是失败情形。
- `Box<Type<User>>` 由**既有的** VEL4022 在写下它的位置拒绝，不需要新机制。
- **不把 `Data` 约束做成可校验性的承载物。** 理由两条：`Data` 比「可校验」**更严**
  （函数型实参可按载体校验但不是 `Data`，强制 `T: Data` 会误拒能工作的
  `Box<() -> null>`）；且 `satisfiesBound` 的 `Data` 分支回答的是 JSON 问题，
  不是校验器问题。**`type` 上的约束应与 `def` 上同义 —— 「体内可用的能力」**，
  可校验性继续由已经拥有它的 `typeContainsRuntimeTypeCheck` 把关。

### `type`/`class` 上的约束基本白拿

解析**免费**（`parseTypeParameters` 九个站点都已读 `<T: Bound>`）；
词汇表与保留名校验**免费**（与声明形状无关）；4×3 授予表
（`types.ts:104-141`）**原样可用**（`boundGrants`/`boundAccepts` 是纯函数，
从不看是谁声明的参数）；`boundOf` 读参数帧栈，`type`/`class` 帧直接插入即可。
**新的只有一件**：实例化点的约束检查 —— `collectGenericBoundViolations`
（`types.ts:1053`）今天收 `CallableType`，需要一个收 `(names, bounds, arguments)`
的兄弟函数。那是对一个本来就以这三样为参数的函数做一次诚实重构。

---

## 第 125 条 —— 多态递归：声明处语法规则，不是深度上限

`type Tree<T>: kids: List<Tree<T>>` 是**齐次**递归，`Tree<string>` 只需要
`Tree<string>`，单态化能到不动点，且运行时环保护
（`emitter.ts:1385-1401` 的 per-value memo + 深度上限）今天就覆盖它。

`type Bad<T>: next: Bad<List<T>>?` 是**多态**递归 —— 要求
`Bad<List<string>>`、`Bad<List<List<string>>>`……**无穷**。全仓没有任何东西
挡得住（`limits.ts` 只有一个常量）。

**裁决：立声明处语法规则 —— 泛型类型对自身的引用必须原样使用它自己的参数。**
不采用「实例化深度上限」。理由：

- **可在声明处检查**，错误落在写下 `Bad` 的那一行，而不是某次实例化爆栈时；
- **诊断能说清楚**（「`Bad` 对自身的引用必须写成 `Bad<T>`」），深度上限只能说
  「太深了」，那是 D42 全程在拔的那类无指向诊断；
- **对用户零真实代价** —— 多态递归在数据建模里近乎不出现。

静态闭包遍历用 `findClassInReadonlyData`（`analyzer.ts:1615-1683`，D44 第 72 条）
为模板：按身份记忆 + `seen` 环切 + **缓存投毒防护**
（经环切得到的干净结论不入缓存，analyzer.ts:1681）。**三样都要，缺一不可。**

---

## 第 126 条 —— 裸 `Box`（不带实参）拒绝，诊断报出元数

`Box` 不带实参时**没有身份、没有字段表、没有校验器** —— 它是类型**构造器**，
不是类型。三个选项：(a) 拒绝并教元数；(b) 视为 `Box<unknown>`
（比照 charter 626「裸 `Promise` 即 `Promise<null>`」）；(c) 按上下文推断。

**裁决：(a) 拒绝。**

理由，第二条是决定性的：

1. 裸 `Promise` 是一个**有据可查的一次性便利**（它的实参通常无关紧要）；
   裸的用户容器**几乎总是作者漏写了实参**，而定向报错正是本语言诊断风格的正路。
2. **`unknown` 满足每一条约束** —— 这是审计十二的头号缺陷之一。于是
   `Box<unknown>` 的校验器会**接受一切**：作者漏写实参，换来一个静默放行的
   运行时校验器。**那正是 D42 全程在拔的静默逻辑错误族**，不能在新特性里重新种一遍。

---

## 第 127 条 —— 顺带修的两处（与主裁决独立，各自成立）

### 127.1 `enum Color<T>:` 的级联

`enum` 是这一族里**唯一没有 `parseTypeParameters` 调用点**的声明，于是
`enum Color<T>:` 炸出**六个**解析错误而不是一条定向消息。
**裁决：给它一条定向 VEL2025**，与 `type`/`class`/`component` 一致。
无论主裁决怎么走，这条都成立。

### 127.2 格式化器在**冒号标注位**不认泛型尖括号 —— **已实测证实，今天就可复现**

`formatter.ts:22` 的 `genericNames` 是硬编码白名单
`["List","Set","Map","Promise","Function","Type"]` —— **没有 `Record`**；
`beginsTypeBracket`（`formatter.ts:482`）另外接受 `def`/`type`/`class` 之后与
`->`/`|`/`is`/`case` 之后 —— **冒号引入的标注位不在其中**。

**实测（活树 `packages/compiler/dist/formatter.js`，非推断）**：

```
def take(x: Record<string>) -> null:  →  def take(x: Record < string >) -> null:   ← 坏
def take(x: List<string>)   -> null:  →  def take(x: List<string>)   -> null:      ← 好（在白名单里）
type Node:  kids: Record<string>      →      kids: Record < string >               ← 坏
const x: Record<string> = {}          →  const x: Record < string > = {}           ← 坏
def make() -> Record<string>:         →  def make() -> Record<string>:             ← 好（走 `->` 那条）
```

**严重度（同样实测，据实下调）**：改坏后的文本**仍然编译干净**
（`compile()` 前后都零诊断），所以这是**观感缺陷，不是损坏**。
另已验证**幂等**（第 2、3 遍稳定在难看形态），所以不会来回震荡 ——
但会**永久改写成难看形态，并让格式门禁从此按难看形态要求它**。

**为什么门禁一直没抓到 —— 门禁缺口（gate-gap 族）**：
全仓 `.vel` 文件里 `: Record<` 出现 **0 次**（111 处命中全在 `.test.ts`
的字符串夹具里，`check:format` 不覆盖）。
**门禁通过的原因是语料恰好没有这个情形，不是格式化器正确。**

**修法要求（这条是重点）：不要把 `Record` 加进白名单。**
白名单本身是错的机制 —— 加一个名字，就给下一个泛型名字留同一个洞，
而 **D55 层一正要让用户自己造泛型名字**，那时白名单必然失守。
**修成按位置判定的词法规则**（`:` 引入的标注位与 `def`/`type`/`class`/`->`
同等对待）。格式化器是 **token 级不是 AST 级**，所以这是一条词法规则，
不是遍历改动。

「等用到了再加一个名字」正是用户明令禁止的思维方式
（见 `memory/vel-design-completeness-not-accretion.md`）—— 本条按边界内穷尽修。

**回归**：修缺陷**同时**要往 `.vel` 语料里加进这些情形
（`: Record<…>` 的参数位／字段位／`const` 位），否则门禁缺口原样留着，
下次照样是「语料没有 ≠ 正确」。**这条不做，本项不算完成。**

**本项与泛型工作独立，不等层一，可立即插入实施。**

---

## 落地：波及面与排期

### 波及面（实施者按此清点，勿自行删减）

- **解析器**：五处拒绝点（parser.ts:864/1266/1374/1647、web/parser.ts:480）；
  `enum` 无站点；`explicitTypeArgumentsEnd`（2730）与 VEL2031（2639）划定
  表达式位可达的拼写。
- **类型**：`types.ts:71-72`（模型）、`228-241`（语法解析，注意 241 行今天把实参
  **字符串化进名字**）、`600-605`（身份）、`1053`（约束违规）。
- **分析器**：`fieldsOf`（1569，**34 个调用方**）、`namedTypes` 两个写入点
  （924 导入 / 1872 本地）、`findClassInReadonlyData`（1615，记忆化模板）、
  `rejectErasedRuntimeCheck`（9269）。
- **发射器**：`emitTypeDeclaration`（1332）、`emitTypeCheck`（1477，`parameter`
  今天返回字面 `"false"`）、`emitNarrowingCheck`（1546）、
  `runtimeTypeCheckName`（1584，今天按**源名**做名字修饰，需改成实例化感知）。
- **跨模块九站**（这是批次 M 教训的放大版，三站变九站）：
  `extension.ts:337`、`index.ts:556-558` 与 `827`、`analyzer.ts:394/924/1872`、
  `cli/project.ts` 的五处管线（1472/1496/1306/1339/1396）、
  以及 **`cli/project.ts:1066` 的 `moduleInterfaceIdentity` 哈希** ——
  **参数表或约束不进这个哈希，改了约束不会让下游缓存失效**，
  正是批次 M 那个「静默消失的约束」再往外一层。
- **干净的**：LSP / 扩展协议 / script-analysis / desktop / cli 其余部分。
- **钉住现状的测试**（本裁决明确退役它们）：`tests/compiler.test.ts:1894-1896`、
  `tests/hardening-audit-runtime.test.ts:603`、
  `tests/hardening-wave-m-bounds.test.ts:219,223`。

### 排期

**不排在仓库整理之前。** 用户已定序：「在做真项目之前，先整理仓库」。
故顺序为 **波 I1（导入风格）→ 仓库整理（第 115 条）→ 本文层一**。
理由不只是听令：示例要按第 114 条的导入风格重写一次，泛型记录落地后
示例又会想用它 —— 让示例只重写一次，就必须让整理排在两者之间的位置。
第 127 条的两处顺带修**不受此约束**，可随时插入。
