# 完整性审计账本（2026-08-12 起）

用户方法论纠正（「尽可能考虑到所有情况，在边界设计之内」）后立项：对每个特性面
做 **charter 承诺 vs 编译器行为 vs 作者合理预期** 的逐条对照，目标不是找 bug 而是
**消灭未定义**。

分类：**DEFECT**（编译通过后崩溃/静默错误）· **CHARTER-DRIFT**（文档与实现不符）
· **INCONSISTENT**（两条相关规则互相矛盾）· **UNDEFINED**（charter 沉默、行为偶然）
· **DECIDED-AND-CORRECT**（探过且正确 —— 完整性凭证，必须记录）。

处置二分：**实现缺陷 → 代理直接修**；**语义设计 → 记录待用户裁决**（马拉松协议
第 1 条）。

---

## 审计一 —— 类系统（2026-08-12，约 140 个探针）

方法学记录：A′ 波并发改写 `analyzer.ts`/`emitter.ts`，审计代理用
`git archive HEAD` 冻结自洽快照单独构建，全部头条发现再回实时工作树复验一致。

### DEFECT —— 编译通过后崩溃或静默错误（8 条，实现层，代理可直接修）

| ID | 位置 | 现象 |
|---|---|---|
| **CLS-D1** | `analyzer.ts:1349` `registerClassShapes` 只遍历 `program.body`；`:1619` 无作用域守卫（`EnumDeclaration` 在 `:1590` 有 VEL3011） | **块内 class 被解析分析但形状永不注册** → 最坏形态：函数内同名类遮蔽顶层类且形状不同，`-> number` 的函数**返回字符串**，零诊断（实测输出 `not a number1`）。无遮蔽时成员全不可见；缺字段时崩 `TypeError`。**`type` 别名在函数体内同款** |
| **CLS-D2** | 同上 | 块内 `export class` **发射出 Node 无法解析的 JS**（`SyntaxError: Unexpected token 'export'`）—— 随 D1 修复消解 |
| **CLS-D3** | `analyzer.ts:1415` `requiredParameters` 未排除 rest；`constructorRest` **只为 extern 类设置**（`:934`） | 构造器 rest 参数被接受后**两种拼写各错一种**：`...values: number` 使构造器**不可调用**；`...values: List<number>` 类型通过但**运行时静默错**（`total` 得 1 而非 3，因发射为 `constructor(...values)`）。extern 声明同形态**正确** —— 两者不一致。**parser 已有现成诊断 VEL2016**（`parser.ts:1043`）只是没接进 `parseClassConstructorParameters` |
| **CLS-D4** | `analyzer.ts:3949-3956` 只查 `constructorDepth === 0` | 构造器**非顶层**位置的第二次 `super(...)` 被接受 → 运行时 `ReferenceError: Super constructor may only be called once`（`if flag: super("b")`、`for` 内同样）。箭头与方法内正确拒绝；`validateConstructorShape` 已算出哪条是首语句，只是没用于嵌套 super |
| **CLS-D5** | `emitter.ts:1592` `` `new ${…}` `` | `new` + 收窄 IIFE 时**括号错位** → `TypeError: (intermediate value) is not a constructor`（发射成 `new (arrow)(x)()`）。修法：`new (${…})` |
| **CLS-D7** | 实例字段初始化器无自引用检查 | `let child: A? = A()` 编译通过，模块加载即 `RangeError: 栈溢出`。**静态字段有对应检查**（`VEL4001: Static field is read before it is initialized`），实例没有 |
| **CLS-D8** | 类名对 analyzer 提升、但 `class` 无运行时提升 | 声明前使用类名被接受 → 裸 `ReferenceError: Cannot access 'Later' before initialization`。**值绑定有检查**（`VEL3001`），类名没有。最坏形态：`class Derived extends Base` 写在 `Base` 之前 → 模块加载失败且错误不指明修法 |
| **CLS-D9** | 基类构造器可调用抽象/被覆盖成员 | 编译通过、**必然崩溃**（`TypeError: Field 'score' was read before initialization`）。运行时守卫让它响亮失败（好），但消息是编译器内部术语、不指源码位置，且 charter 从未提及此危险或该守卫。**编译器静态可知基类构造器只能观察基类状态** |

### 待用户裁决（语义设计，不擅动）

- **CLS-D6（最深的洞）**：`Type.is`/`Type.parse` **接受类实例** —— 静态是标称的
  （`const p: Point = P()` 被拒），运行时是结构的。实测：`Point.parse(instance)`
  成功、返回的记录视图**别名活实例**，`point.x = 99` **写穿了类的 `const` 字段**
  （`instance.read()` 输出 99），全程零诊断。两条规则互相矛盾。可选修法：记录验证
  拒绝原型非 `Object.prototype` 的值；或 charter 明写「验证过的记录视图可能别名
  类实例，且类 `const` 字段无运行时保护」。
- **CLS-U6**：**类值是半个一等值** —— `const factory = P` 可用、`print(P)` 可用、
  别名读静态可用；但 `List<P> = [P]` 被拒（消息还把 `classConstructor P` 与
  `class P` 用同一显示名对比）、`(() -> P)` 参数位被拒、`[P, Q]` 元素类型成
  `P | Q` 后不可调用、经 null 检查后间接调用触发 CLS-D5。需裁决：给构造器值一个
  可拼写类型（`Class<P>` 之类），还是把 class-as-value 限制为直接引用与静态访问。
- **CLS-U3**：override **签名严格不变**（`-> number` 覆盖 `-> number?` 被拒）。
  结果协变是多数作者的预期，禁止它是有意还是偶然？charter 只说「`abstract` 与
  `override` 被检查」。
- **CLS-U5（readonly 所有权故事最大的洞）**：`readonly` 传递性**在类类型成员处
  终止** —— `def look(h: readonly Holder)` 内 `h.item.x = 5` **被接受并真的改了**
  （`item` 是类实例）。这是 §5 两条规则（传递性 + 类在边界外）叠加的必然结果，
  但从未有人陈述该交互。
- **CLS-C1**：§18 承诺「类降级为 JS 类与原型」，但**实例方法不走原型** ——
  发射器把每个公开非静态方法 `bind` 到实例上。可观察后果：`print(instance)`
  显示方法；**带函数字段的记录类型在运行时被类实例满足**（`Runner.is(P())` 为
  true，而走原型则应为 false —— §12 明写「继承字段与访问器不满足记录契约」，
  该规则的答案取决于一个未文档化的降级选择）；方法引用（`const f = a.read`）
  能用**只因为**这个降级。需裁决：改用原型（破坏方法引用），还是把绑定降级
  成文并修正 §12 的答案。
- **CLS-U1（setters）**：`set x(v)` 得到三连级联通用错误，从不说「Vel 没有
  setter」；§19 有意缺席清单也**没列它**。需裁决：加 §19 条目 + 定向诊断
  （我倾向如此，`get` 是软关键字有专门解析路径，`set` 应同款）。

### CHARTER-DRIFT（文档修正，代理可直接改）

- **CLS-C2**：§10 说 `super.member`，但只有**方法与 getter** 可用；读基类字段
  被拒（诊断本身正确，charter 的「member」措辞不对）。`super` 单独出现的诊断
  也漏了 getter。
- **CLS-C3**：§9 的穷尽性清单**漏了不可反驳的类模式** —— `match value: case Base:`
  确实参与非空返回分析，但清单没写。

### INCONSISTENT（实现层，代理可修）

- **CLS-I1**：字段初始化器里 `super.seed()` 可用（`this` 已绑定）但 `self`
  **未声明** → `VEL3001: Unknown name 'self'` + 两条级联。静态方法内 `self.n`
  同款弱诊断。charter 只说「`self` 在方法体内显式」，从未说它在哪些位置**不存在**。
- **CLS-I2**：enum 有模块作用域规则、class 与 type 别名没有（= CLS-D1）。
- **CLS-I3**：match 穷尽性对 enum 强制、对**类层级不强制**（缺少分支静默什么都
  不打印；enum 同形态给 `VEL4015`）。类层级 match 能否/是否必须穷尽 —— 未定。
- **CLS-I4**：`extends Error` 完全可用，`extends <extern class>` 被拒
  （`Unknown base class`），而 §10 与 javascript-bridge.md 都没说不能继承 extern 类。
- **CLS-I5**：`readonly def` 的拒绝消息建议「用 `const` 声明只读字段」——
  对方法/getter 是无意义的建议（拒绝本身正确）。

### UNDEFINED（charter 沉默处，需成文；代理可按下述答案补文档）

| ID | 未定之处 | 实测行为（即应成文的答案） |
|---|---|---|
| CLS-U2 | 「一次直接 `self.field =` 赋值」的**边界** | 仅构造器体**语法顶层**、仅 `=`、仅字面 `self` 接收者。if 两分支各赋一次 / for 内 / try-catch 两分支 / `+=` / 经别名 / 被调方法内 —— **全部拒绝**（规则自洽且强制确定赋值，但 charter 未说「直接」= 语法顶层，诊断也没说） |
| CLS-U4 | **基类**初始化顺序 | 参数属性默认值 → 参数属性赋值 → 体字段初始化器 → 方法绑定 → 构造器体（§10 只文档化了派生类顺序） |
| CLS-U7 | 可选字段语法 | `let x?: number = 1` → 错误消息说「字段需要显式类型」（**措辞错误**，类型是显式的）。无可选字段概念；工作形态是 `let x: number? = null` —— 无任何指引指向它 |
| CLS-U8 | **注入的运行时守卫** | 每个公开实例字段读降级为 `__velarReadInstanceField`，抛 `TypeError: Field '<name>' was read before initialization`；静态用 `__velarReadStaticField` 带 owner 深度遍历。它们是 D1/D9 与静态间接前向引用的失败面。charter 从未提及守卫、消息、或哪些读会抛；§11「只有 Error 可被抛出」也没承认编译器注入的 `TypeError` |
| CLS-U9 | 类字段可命名 `self` | `let self: number = 7` 被接受、`self.self` 可读（保留名检查覆盖绑定与参数、不覆盖成员名）。当前降级下无害，但没人决定过 |

### DECIDED-AND-CORRECT（完整性凭证，压缩记录）

**字段 14 项**：let/const 初始化器有无、`const` 仅构造器内可赋一次、`private const`、
缺初始化器需一次直接赋值、静态需初始化器、显式类型必需、初始化器可读自类/他类/
私有/后声明静态并可调静态方法、`private static const` 外部不可见、`static let/const`
可变性、重名拒绝（含参数属性 vs 体字段）、每实例独立、静态共享、直接静态前向引用
编译期捕获、`readonly T` 作字段类型双向强制、`readonly` 作成员修饰符对 let/def/get
均拒、`readonly ClassInstance` 精确边界消息。

**构造器 9 项**：参数属性三种前缀 + 默认值 + 显式类型 + private 不可见、参数属性
rest 拒绝（VEL2016）、仅一个构造器、无 `new`（VEL1005）、无类头构造器、无 `init:`、
无构造器修饰符、无 `await`、无 `return`、初始化器 XOR 赋值、派生须先 `super(...)`、
基类有必需参数而派生无构造器时拒绝、`self` 在四种位置保留。

**继承 13 项**：3-4 层链 + `super.m()` 链式、抽象类四种途径均不可实例化、未实现
抽象成员（含经抽象中间类与再抽象）被捕获、`abstract`+`static`/`override`、
`private`+`abstract`/`override` 对方法与 getter 均拒、`override` 必需性与签名检查、
覆盖参数标签行为符合 §7、静态方法与静态 getter 覆盖、继承静态字段重声明拒绝、
私有静态按类隔离、继承字段须保持 let/const + 类型契约、循环继承拒绝、`super.member`
在五种位置可用、嵌套 `def` 内与非派生类中拒绝、抽象 getter。

**成员 9 项**：getter 作属性/无参/无类型参数/无 async/显式结果/可变；私有方法与
getter 与静态内部可用外部拒绝且消息各异；`#field` 拒绝并给 charter 的确切修法；
完整重名冲突矩阵（六种）各有不同消息；静态与实例同名允许（字段/方法/getter）；
`constructor`/`prototype`/`__proto__` 作成员名拒绝（含静态）；泛型方法可用、
泛型类拒绝（VEL2025）；方法引用可用；`self` 在嵌套箭头与嵌套 def 内。

**身份与类型 6 项**：类是标称的（同形状不可互换、不满足记录、跨模块同名类各自
独立且都能运行）；`is` 与 `match case Class:` 遵循层级、`as` 绑定、无关模式拒绝
（`can never match`）；`stringify`/`str()`/f-string/对象展开**全部拒绝类实例**并
给具体指引；`print(instance)` 可用；实例可进 List/Set/Map；基类模式参与非空返回分析。

**错误 6 项**：`extends Error` + `super(message)`、自定义字段、throw/catch、
两级错误层级的 `is` 收窄、抽象错误基类 + `override`、非 Error 类不可抛
（`Only Error values can be thrown, received Boom`）、非 Error 内建不可继承、
`message` 不可重声明。

**降级 4 项**：`private` 是原生 `#` 且不出现在检查输出中；实例字段初始化器在
`super()` 后、构造器体前按 charter 文档化顺序运行；extern 类的 rest 构造器正确；
跨模块同名类运行时共存。

### 修复优先序（审计代理建议，编排代理认可）

1. **CLS-D1/D2** —— 一行作用域守卫同时消灭健全性破坏、运行时崩溃、非法 JS 发射。
2. **CLS-D6** —— 记录/类标称性分裂是最深的洞，静默击穿 `const` 字段（**待裁决**）。
3. **CLS-D3** —— 复用现成 VEL2016；今天一种拼写不可调用、另一种静默错。
4. **CLS-D4/D5/D8** —— 三个小而局部的修复，各自把「干净编译」变成「裸 JS 错误」。
5. **CLS-D9** —— 基类构造器静态不可能观察派生状态，应拒绝而非依赖运行时守卫。
6. **CLS-U2/U5/U8 + I1** —— charter 的沉默（而非编译器的行为）才是缺口。
7. **CLS-U6** —— 决定类构造器是否为值（**待裁决**）。
8. **CLS-U1（setters）/U7/I5 + `self` 级联** —— 规则存在但消息没传达。


---

## 审计二 —— 收窄与流分析（2026-08-12，约 190 个探针）

**历史 blocker #1（循环回边不作废事实）确认仍然关闭**，且在能构造的全部变体下
都关闭：成员路径、别名、嵌套 if、continue 臂、三层嵌套、`async for`、try、
finally、循环内 match、`while` 头部重建。

### UNSOUND —— 1 条，blocker 级（实现层，最高优先）

**FLW-U1：导入的记录类型，其运行时收窄守卫退化为「仅存在性」检查**
—— 陈旧事实静默交付错误数据，或漏出裸 JS `TypeError`。

charter §5（527-533 行）承诺：记录与集合用**深度验证器**；证据陈旧时读操作抛
`NarrowingError` 带源码偏移与期望类型，「不会静默漏出 JavaScript `TypeError`」。

完全类型化的复现（无 `unknown`、无强转、无宿主边界）：跨模块导入 `User`/`Slot`，
`if s.value is User:` 后经不透明跨模块调用把 `s.value` 改成 `Error("boom")`，
随后 `print(s.value.name)` —— **check 干净、run 输出 `Error` 与 `name is Error`、
退出码 0**。字符串 `"Error"` 流进 `string` 类型的读与 f-string。

对照组（同样字节但 `User`/`Slot`/`replace` 本地声明）正确抛出：
`__VelarNarrowingError: Flow narrowing for '.value' no longer holds: expected User
at source offset 215`。

另一形态漏出**裸 TypeError**：导入 `User` + 跨模块 `h.payload = 5` + `.name.upper()`
→ `TypeError: String methods require a string receiver` —— 正是 charter 说该设计
消除掉的结果。

**机制**：`emitter.ts` 的 `emitNarrowingCheck` 在 `case "named"` 下，若名字不在
`hints.enumNames`/`hints.classNames`/发射器自有 `typeDeclarations` 中，就退化为
`` `${value} != null` ``。而 `typeDeclarations` **只**由本地 `TypeDeclaration`
填充，`classNames`/`enumNames` 来自 analyzer 的 map **却包含导入项** —— 所以
导入的类与枚举正确、导入的记录退化。同文件的 `emitIsCheck` 已经在发射
`` `${type.name}.is(${value})` `` 且跨模块可用，收窄路径只是没去用它。

**受影响面已确认**：从 `unknown` 收窄的导入记录（输出 `undefined` / `5`）、
联合中的导入记录、`List<导入记录>` 元素检查退化为 `item != null`、
**导入记录的本地别名**（`type U2 = User`）也不恢复。
**不受影响**：导入的类与枚举（均正确抛出）、全部本地声明类型、`is` 测试本身
（始终用真验证器）。

**覆盖缺口**：现有全部收窄测试都用单模块 `compile()` API，**跨模块 recheck
零回归覆盖**；`WebJavaScriptEmitter` 继承同一方法。

**修法**：`emitNarrowingCheck` 的 `named` 分支改走 `emitIsCheck`（或让导入记录
验证器对发射器可见），并补第一批跨模块收窄回归。

### CHARTER-DRIFT —— 2 条

**FLW-D2：任何成员写作废帧内**全部**成员路径事实**。charter §5（518 行）明写
「无关的根保持其事实」，但实测：写一个**不同类型的不同变量**的成员
（`other.count = 2`）会杀掉 `box.value` 的事实；写兄弟字段同样。analyzer 对
**任何** `MemberExpression` 赋值目标都调 `invalidateCurrentMemberNarrowings()`
—— 一把大锤，使别名作废平凡地健全（六个别名探针全过），代价是 charter 承诺
的保证不成立。局部**绑定**事实不受影响。**这句话和这段代码不能同时成立**：
要么改代码、要么改 charter；修代码时不得丢掉别名情形。

**FLW-D3：比较链的事实不流入后续链节**。charter §4（315-317 行）两句话，
第二句成立（完整链为真时事实在受控体内可用），**第一句不成立**：
`if null != x < 100:` 中 `null != x` 建立的存在性，`x < 100` 看不到 →
报错。`assert null != x <= 100` 与 `number | string` 联合同款。
（诊断文本属在途的有序比较工作，落地后需复验；但事实流的缺口与操作数定型正交。）

### OVER-STRICT —— 2 条

**FLW-S1：不可 break 的循环之后，`while` 条件的否定事实被丢弃**。charter §9
（1222-1223 行）说「可 break 的循环可能在条件仍成立时退出，故否定事实不持续
到循环后」—— 暗示不可 break 时应持续。实测 `while w is number: w = "s"` 之后
`w.upper()` 报错。代码路径存在但被 `blockAlwaysReturns(body) && !sawBreak` 门控
—— 体是裸 `return` 时可用。**最常见形态（体不返回、无 break）丢失事实**。

**FLW-S2：无用的 getter 检查被静默接受，且诊断把作者指向错误方向**。
getter 不是稳定位置这条实现正确，但检查本身**不给诊断**，读操作说
「Use optional access '?.'」—— 照做（`self.label?.upper()`）会**静默двойное求值
getter**，而正路是 `const snapshot = self.label`。

### UNDEFINED —— 9 条（charter 沉默，行为偶然）

| ID | 未定之处 | 实测行为 |
|---|---|---|
| **FLW-N1**（本类最重） | **赋值/声明从不建立事实**，即使值可证非空 | `const x: string? = "a"` 后 `x.upper()` **报错**；`x = "a"` 后同样；if/else 两臂都赋非空、全部 match 分支都赋、try/catch 两臂都赋 —— 合并后事实仍缺席。charter §5 只说 `=` **作废**，从未说它是否**建立**。看起来**有意**（同一代码路径使作废规则成立），但**这是本子系统最大的人体工学悬崖** —— 带字面量初始化器的 `const` 失败很难辩护 |
| FLW-N2 | 可选链不是事实主体，且**不蕴含自身接收者的存在性** | `if v.a?.b != null:` 后 `v.a.b` 报两条错 —— 而 `v.a?.b != null` 逻辑上蕴含 `v.a != null` |
| FLW-N3 | **`Type.is(value)` 不收窄** | 而 §6（628 行）正指引作者「调用具体验证器的 `is(value)` 方法」当验证器需被存储时 —— 指引通向一条不收窄的路 |
| FLW-N4 | 成员测试既非存在性测试也非收窄手段 | `x in allowed`（`x: string?`）在运算符处报**可赋性**消息而非成员消息；`List<string?>` 则编译且不收窄（正确，null 可能是元素）。行为可辩护，未定的是诊断与沉默 |
| FLW-N5 | 下标与 `Map.get()` 读不是事实主体 | `r["k"]`、`m.get("k")`、`items[0]` 第二次读失败；先读进 `const` 可用。健全且与稳定路径规则一致，未成文 |
| FLW-N6 | 事实不跨 `break` 边传播，只有作废跨 | `while true:` 内 `if x == null: return` 后 `break`，循环后 `x.upper()` 报错 —— 而该 break 被守卫支配，事实可证 |
| FLW-N7 | `flag == true` **不收窄** `bool?` | 而 §6（691 行）说相等把枚举单例事实带回所有者；布尔字面量的对应事实缺席。真值判断（`if flag:`）确实收窄。（邻近在途的相等工作，需复验） |
| FLW-N8 | recheck 是**每次收窄读的完整深度重验证**，无成本模型、无成文规避 | 收窄的 2 万元素 `List<string>` 读 2000 次：**守卫 3.17s / 无守卫 0.29s / 先读进 const 0.34s** —— **约 10×**，O(读次数 × 规模)。一行 `const` 的缓解手段 §5 没提 |
| FLW-N9 | 守卫诊断泄漏内部并欠标识位置 | 成员读的 description 是 `.property` **无根名** —— 多个根都有 `value` 字段时歧义；未捕获时打印内部构造器名 `__VelarNarrowingError`（因 `this.name` 在 `super(message)` 之后赋值，V8 已冻结栈头）；位置是**裸字符偏移**（`215`）而紧下一帧已经打印 `file.vel:10:11` |

### DECIDED-AND-CORRECT（完整性凭证，压缩）

**建立事实 13 项**：`!= null`、`== null` + 早返回、`assert x != null`、assert 与
`and` 组合、`is Type`、`is not Type` 双臂、and/or 短路流、or-否定与
`not (a and b)`、`not (x == null)`、三元条件、`while` 条件、比较链在受控体内、
f-string 读保持事实。

**`bool?` 真值语义（批次 A）10 项**：`if flag:` 收窄为 bool、**else 臂什么都不学**
（false 与 null 都到达）、`not flag` 收窄 else、`a and b` 双臂收窄、`a or b` 双臂
不收窄、`while flag:` 收窄体、`assert flag`、bool? 记录字段、`flag ? flag : false`、
`match flag: case true/false/null`。

**作废 14 项**：直接赋值、复合赋值**保持**事实（§5:495）、同根成员写、经检查前
声明与检查后声明的别名、链式别名、函数返回的别名、List 元素、反向别名、
`self.field`、循环回边（11 种形态）、无条件 break 之后的写**正确地不**作废、
下标赋值**正确地不**作废（是槽替换非别名）、无关接收者的可变集合方法调用不作废、
参数是 const（消除重赋值风险）。**附带发现**：解构**赋值**根本不是语句形态
（`{left: a} = p` 是 VEL2005），故 charter「including destructuring」一句目前**空转**。

**调用不作废、运行时 recheck 触发 12 项**：普通不透明调用、`await`、分离
`async f()`、嵌套 def 改成员、嵌套 def 改模块级 let（标识符守卫）、
`extern module`/`import js` 宿主边界；且**写侧路径全部有守卫**（成员赋值、
复合成员赋值、陈旧接收者上的方法调用、下标赋值、可变集合方法）。
**证据强度与 §5 完全一致**：记录存在性、记录深层字段类型、集合深层元素、
类标称身份、原始值运行时种类；擦除泛型/`Type<T>` 载体按设计只发存在性。
Velar `catch` 能捕获并读 `.message`。循环值被验证器拒绝而非爆栈。

**合并 16 项**：每条继续分支都建立的事实存活；终止守卫（return/throw/break/
continue）在落空路径留下否定事实；if/else 兄弟独立性（绑定**与**成员路径）；
match 分支互斥性（绑定**与**成员路径）；到达 match 之后代码的分支确实作废；
模式失败把事实带给后续分支；带守卫的分支正确地不算穷尽；`else if` 链；
try 的突变在 catch 内可见；返回的 catch 不能擦除 try 续体的事实；到达正常续体
的 try 写确实作废；finally 效应应用于全部路径并逃出语句；finally 效应**不**在
更早的 catch 内可见；try 内或 match 内的 break 仍带出其写；循环后状态；
带可达 break 的 `while true` 之后作废；无可达 break 的满足非空结果；嵌套循环
break 归属；只能 return 的体不泄漏写到被跳过路径；**全部零迭代情形健全**
（守卫/assert/成员路径守卫在可能零次执行的循环内均不逃出）。

**边界 10 项**：收窄不进入箭头体、嵌套 def、方法内嵌套 def、内联 map 回调；
只**读**的箭头不作废外层事实；嵌套函数自己的检查可用；成文的 `const` 规避在
闭包内可用；getter 不是稳定位置；getter 读进 const 收窄；收窄对象上的 getter
收窄；遮蔽的箭头参数取得收窄后的元素类型。

**成员路径 7 项**：`a.b.c` 收窄；替换 `a.b` 或 `a` 作废；`v.a != null and
v.a.b != null` 组合；`v.a = null` 作废子事实；`Record<T>` 读进 const 收窄；
持有旧成员值的 const 在成员被覆写后**正确保持**其事实。

**其他 8 项**：枚举单例事实经 `==` 与经 match 记录模式；`case X as u` 同时收窄
别名与原值；match List 模式收窄原可选值；readonly 视图收窄；可选下标与可选调用
的接收者存在性在下标/实参表达式内可用（§5:567-569，其中可选调用探针甚至被判为
**冗余检查**，反证事实确实在）；`Record` 双槽迭代；带守卫的通配 `case _ if …`；
`throw` 作终止臂。

### 修复优先序（审计代理建议，编排代理认可）

1. **FLW-U1** —— blocker，与当年循环回边缺陷同类。改 `emitNarrowingCheck` 的
   `named` 分支走 `emitIsCheck`，并补**第一批跨模块收窄回归**（现有测试全是单模块，
   这个面零覆盖是缺陷能存活的原因）。
2. **FLW-D2** —— **待用户裁决**：「无关的根保持其事实」是契约、还是大锤是契约？
   这句话与这段代码不能同时成立。
3. **FLW-N1** —— **待用户裁决**：赋值是否建立事实？沉默的代价是每个写
   `x = "a"` 的作者。
4. FLW-D3、S1、N2、N3、N6、N7 —— 小而各自可决的缺口。
5. FLW-N8、N9 —— 成本模型与错误面打磨。


---

## 审计三 —— 枚举与 match（2026-08-12，约 130 个探针，快照构建 + 活树复验字节一致）

### DEFECT（编译通过、运行静默错误，执行级证据）

| ID | 现象 | 处置 |
|---|---|---|
| **ENM-D1** | **Map/Set 键把标称不同的枚举成员合一**：`Map<A \| B, string>` 下 `set(A.x, …)` + `set(B.x, …)` → size **1**、`get(A.x)` 返回 B 的值；`Set<A \| B>` 同款。D42 关掉了 `==` 与排序，这是**同一个洞剩下的那块** —— 恰好经枚举联合键类型可达 | 修：交集规则延伸到 Map/Set 键与成员测试位（D42 第 64 条既定原则的补齐） |
| **ENM-D2** | **match 值模式与 `==` 在 NaN 上不一致**：`0/0 == box.nan` 为 true（SameValueZero），`case box.nan:` 却落到 `case _`。emitter:1841 用 `===` 而 `==` 走 `__velarSameValueZero`。charter §8 明诺「exact-value operations agree with `==` … including on NaN」 | 修：值模式走同一 SameValueZero 路径（一行级） |

### INCONSISTENT（九条）

| ID | 现象 | 处置 |
|---|---|---|
| **ENM-I1** | **`is` 是最后一个还在跨枚举洗钱的相等面**：`B.is(A.x)` 返回 true、`if v is B:`（v: A）进分支。`==` 与 `case` 都已拒绝 | 修：静态不相交枚举间 `is`/`is not` 编译错误（同交集判定） |
| **ENM-I2** | **一个联合注解就绕过枚举-字符串例外**：`w: Status \| string` 后 `w == Status.done` 编译且为 true —— 裸字符串没经 parse 就等于成员，D42 第 65 条自己的理由被击穿。情形表「联合含交集成员 ✓」没考虑这个组合 | 修（按既定理由补齐）：枚举域与字符串域在 `==` 中**永不相遇，联合臂也不行**；诊断教先 `is Status` 收窄再比。**编排代理决定，可否决** |
| **ENM-I3** | **成员测试词汇与相等词汇矛盾**：`A.x in ["x"]` → true、`List<string>.has(A.x)` → true、`Map<string,·>.get(A.x)` 命中 —— 同样的问题用 `==` 问是编译错误 | 修：交集规则延伸到 `in`/`has`/`index`/`count`/`remove`/`get` 实参位（与 D1 同一条规则） |
| **ENM-I4** | `type S2 = Status` 是**半个枚举**：`S2.parse` 可用、`S2.done` 被拒（"no runtime member"——而 parse 恰是 runtime member）。§12 承诺身份跟随别名 | 修：成员访问跟随别名，与 parse/is 一致 |
| **ENM-I5** | **括号把值模式静默重分类成类型模式并丢穷尽信用**：`case (S.a):` + `case (S.b):` 全覆盖仍报 VEL4015，但每个分支运行时真的匹配 | 修：enumMember 类的覆盖类型计入成员覆盖 |
| **ENM-I6** | **`Status?` 主体让穷尽检查整个静默消失**：裸 `Status` 漏成员硬错误；`Status?` 漏 `case null` 或成员 → 语句位**完全静默**落空。analyzer:1909 精确匹配 `kind === "enum"` | 修：可选枚举主体同等强制（要求 case null + 全成员） |
| **ENM-I7** | **关键字成员名：能声明、能访问、不能匹配**：`enum S: null` 合法、`S.null` 可读、`case S.null:` 七连解析级联 | 修：模式点后接受关键字成员名（与成员访问一致；记录 `pass` 例外见 I8） |
| **ENM-I8** | **enum 体里的 `pass` 静默声明一个叫 pass 的成员**：占位符直觉（类体如此）在枚举体变成状态机多一个 `pass` 状态，零诊断 | 修：枚举体的裸 `pass` 行是占位符（与类体一致）→ 空枚举规则接管；成员名 `pass` 成为唯一不可声明的软词（体位置有占位含义），成文 |
| **ENM-I9** | **命名空间导入无类型/模式拼写**且消息错误：`def f(u: m.User)` → "'m' is not an enum…"（对记录完全驴唇不对马嘴）。§6 承诺接口经命名空间导入保留 | 分两步：定向诊断先行（教按名导入或 `const S = m.Status`——后者实测连穷尽信用都有）；**限定类型位 `m.Type` 支持**排入后续批次（父母 Python/TS 都支持，charter 已承诺） |

### CHARTER-DRIFT（两条）

- **ENM-C1**：§12「identities follow … aliases」对值成立、对类型面不成立（I4/I9 修复后消解）。
- **ENM-C2**：§8「exact-value operations agree with `==` … including on NaN」在 D42 后双向破裂（I3 与 D2 修复后消解，措辞需同步改）。

### UNDEFINED（六条）

| ID | 未定之处 | 处置 |
|---|---|---|
| **ENM-U1** | **成员枚举不存在**（疑似缺口确认）：`for s in Status`、`[...Status]`、`Status.values()` 三种尝试三种拒绝，零指引；`<select>` 选项列表只能手列且无穷尽检查 | **定案（可否决）：`Status.values() -> List<Status>`**，声明序，每次新 List（与 split 等一致）；`values` 加入保留成员名（parse/is 旁）；诊断三处全教它。完整性纠正案的直接应用（HANDOFF 已预记方向） |
| **ENM-U2** | `case` 后能接什么没定完：裸标识符误报 "Unknown type"；`case config.max:`（一点路径）**是没文档的通用值模式**；两点路径解析级联 | 定案：**点路径值模式成文并支持任意深度**（父亲 Python 同款规则：点路径=值、裸名=其他），SameValueZero 比较（D2 之后自动一致）；裸标识符给定向教学 |
| **ENM-U3** | `case a \| b` 七连级联零指引（逗号是既定拼写，类型模式间 `\|` 却合法） | 修：定向诊断教逗号 |
| **ENM-U4** | **`ValidationError` charter 点名却不可拼写**：`error is ValidationError` → Unknown type；失败形只有消息可嗅 | 修（履行 charter 承诺）：三个内建错误类型（ValidationError/NarrowingError/IndexError）可命名、可 `is` 判别；ValidationError 带出错值与期望描述 |
| **ENM-U5** | 记录字段默认值裸报 VEL2003 零指引（函数参数默认值存在，加深意外） | 修：§19 列入有意缺席 + 定向诊断 |
| **ENM-U6** | 小角落打包：成员名 `_`/`S.S`/`constructor` 无人决定但无害；VEL4013 泄漏内部键（"number:5"）；重复枚举声明的伪级联；守卫成员的 VEL4015 不解释原因 | 修：消息打磨一批 |

### DECIDED-AND-CORRECT（完整性凭证，压缩）

声明 17 项（含 300 成员、双重复检测、非 ASCII 值可用/名拒绝、保留成员名、
模块作用域）；身份与运行时 10 项（枚举→字符串单向出口全面、JSON 往返经
unknown 降级并经 parse 重入、非联合跨枚举静态拒绝）；parse/is 10 项（wire 值
不是成员名、大小写敏感、幂等、Type<T> 载体跨模块）；位置 10 项（单例类型全家、
泛型推断、readonly 边界消息）；跨模块 8 项（**导入枚举陈旧收窄正确抛
NarrowingError** —— 钉住 FLW-U1 家族「枚举正确」的断言；同名枚举标称隔离但
str/parse 互通）；match 30+ 项（全字面量形、逗号多值+as+守卫、记录/列表模式
全形、不可能模式精确拒绝、主体求值一次、重复/不可达/缺失三类诊断、字符串背书
按**名**计穷尽、联合/bool/可选各形穷尽）；事实 5 项（成员路径主体收窄、case 内
赋值作废、兄弟隔离）。**D42 核心健康**：缺陷全在规则边缘，不在核心。

### 处置总结

全部归**波 N-2b（枚举与 match 收口）**，排 N-2 之后（同样重改 analyzer/emitter/
parser，必须串行）。四项编排代理按既定原则定案、用户可否决：I2 联合收紧、
U1 `values()`、U2 点路径值模式成文、U4 内建错误类型可命名。


---

## 审计四 —— 异步面（2026-08-12，60+ 探针，快照构建 + 活树复验）

本面的判定基准：**失败被丢 = 最坏缺陷类**（charter 自己的杆：「A detached task
never floats … reports it through the host error channel」）。

### DEFECT —— 失败被丢（执行级证据，活树复验）

| ID | 现象 | 处置 |
|---|---|---|
| **ASY-D1（本面最重）** | **组合子的「输家」失败静默蒸发**：`race([quick(), slowFail()])` 赢家结算后，slowFail 55ms 后的 rejection 无 stderr、无通道、exit 0；`timeout(lateFail(), 10)` 同款；`all` 捕获首败后其余输家的失败消失；`map` 在拒绝后**继续执行剩余项**（副作用无主继续跑）且第二个 worker 失败也丢 | 修（按既定「失败必有主」原则）：输家结算后交给现成的 `__velarDetachedTask` 观察者 —— 输家的失败走 detached 通道上报。**编排代理决定，可否决**。归批次 K（D35 本就重规 all/race） |
| **ASY-D2** | **测试内的 detached 失败让套件照样全绿**：`async boom()` 在 test 里 stderr 打了报告，但测试 ✓、"2 passed, 0 failed"、exit 0 —— **CI 里失败等于丢了**。test-runner.ts 对 detached 零立场 | 修：测试运行期间的 detached 失败计入该测试的失败（async `def test_*` 被 await 的部分已正确） |

### UNDEFINED（五条）

| ID | 未定之处 | 处置 |
|---|---|---|
| **ASY-U1** | **运行时空列表的 `race` 永不结算**：编译期空字面量已拦，但运行时空的 `List<Promise<null>>` → 永挂（模块顶层 Node 退出码 13 + Node 腔调警告；detached 内**完全静默停摆**） | 修：运行时 `RangeError("race requires at least one Promise")`，镜像 requireTimer |
| **ASY-U2** | **`await` 一个 `any` 收养外来 thenable 并漏出裸 `undefined`**：执行敌意 `then` 钩子、跳过 undefined→null 归一化 —— `value == null` 打印 **false** 而值是 `undefined`，空值守卫看不见它。与 D32 第 29 条（f-string 拒 any，理由「unsafe 域正是钩子藏身处」）不一致 | 修：`Cannot await any; validate first`（与既有 `Cannot await unknown` 对称）。**编排代理决定，可否决** |
| **ASY-U3** | **`error.cause` charter 承诺却不可达**：§11 说非 Error rejection「remain available as the JavaScript `cause`」，实测 `error.cause` → VEL4001 no member | 修（履行承诺）：checked Error 契约加 `cause: unknown` 只读成员。**可否决** |
| **ASY-U4** | 组件内 `async submit()`（分离一个 action 调用）编译通过，按代码走读失败会**报两次**（action 的 web 链 + detached 相位）——没丢但翻倍 | 修：恰好报一次契约（action 自有报告优先，detached 观察者跳过已报告者），实施者落细节 |
| **ASY-U5** | 文档缺口打包：模块级 await 已实现被依赖但 charter 从未声明存在；`velar/browser` 的 `after`/`every` 有良好失败故事（同步抛与 rejection 都归一化、timer 相位、响亮兜底）却零文档、§16 自动清理清单缺 timer 条目 | N-3 文档波 |

### 已确认的规格缺口无碰撞

`Promise.all` 今天 = VEL3001 无指引；异构 `all` 仍发 D35 引用的自相矛盾诊断；
`sleep(2s)` → VEL1007；`try await` 通用解析错。**今天没人能写出依赖这些的代码
—— D35/D39 可干净落地**（这正是要的答案）。

### 微裁决一条（随波带走）

Error 子类的 `.name` 停在 "Error"（JS 默认）—— 类降级时构造器把 `.name` 设为
声明的类名（子类惯例，同时改善 detached 报告头）。

### DECIDED-AND-CORRECT（完整性凭证，压缩）

async def 全形（值/无返回/嵌套/方法/静态/箭头/extern 双拼写；VEL4018 禁
`-> Promise<T>` 于 async def 含 extern；async getter/构造器定向拒）；await 位置
矩阵（if/f-string/match/list/args/binary/assert/while 头/catch/finally 合法，
非 Promise/null/联合/unknown 全拒；`Promise<Promise<T>>` 可拼写、一次 await
深展平、检查器与运行时一致）；**detached 语句全家健康**（`Promise<null>` 门精确、
六种位置可用、失败所有权对 Error 子类/extern 字符串/双并发失败/晚失败/外来
thenable/undefined 返回/同步抛全部成立、进程存活、web 链 detached 相位 + 前
运行时响亮兜底、**修复波 1 的闭合保持闭合 11/11**）；async for（拉取契约、break
不再拉且不自动释放（与 D43 using 注记一致）、中流 rejection 传播且源可续、
thenable 拉取结果失败有主）；跨 await 错误（子类字段 + is 收窄存活、finally
顺序、非 Error 对象稳定通用消息、extern 回调抛有主）；宿主边界（thenable 永不
能变 checked Promise —— extern 调用点急切归一化、`Type.parse` 拒 thenable 收
真 Promise、**跨 realm 真 Promise 通过**、resolve(undefined)→null、双 await 无害、
then 冲突 VEL4024 双处触发）；计时（sleep 范围错误有主可捕、async 测试被运行器
await）。

### 处置总结

ASY-D1 + 微裁决归**批次 K**（D35 重规 all/race 的同批）；ASY-D2/U1/U2/U3/U4
归 **N-2b**（与枚举波同车，均不冲突 N-1 文件——test-runner 与 standard-modules
除外，实施时注意 project.ts 让路）；ASY-U5 归 N-3。


---

## 审计五 —— 集合面（2026-08-13 凌晨，~120 探针，双快照 + 活树复验 DEFECT）

### DEFECT（执行级，活树复验）

| ID | 现象 | 处置 |
|---|---|---|
| **COL-D1** | **Record 双槽 `for` 中途 remove 未访问键 → 裸 JS TypeError**（`Cannot read properties of undefined`）—— 违反「本参考拥有全部用户可观察语义」。collection-lowering-runtime.ts:166-167 读 descriptor 不判 undefined；**Map 同款探针正确跳过** | 修：descriptor undefined → continue（Map 对齐），归 N-2b |
| **COL-D2** | **展开把开放记录的多余字段走私进 `Record<T>`**：`User.parse({name, age: 39})` 后 `{...u}` 编译进 `Record<string>`，size=2，39 在里面 —— 每次后续读都在**远离肇因处**爆炸。直接赋值 `wantRecord(u)` 被拒的理由正是这个 | 修：命名记录值展开进 `Record<T>` 上下文与直接赋值同规则拒绝（教显式字段复制），归 N-2b；顺带给 COL-I5 的拒绝消息补上这条理由 |

### INCONSISTENT（五条）

| ID | 现象 | 处置 |
|---|---|---|
| **COL-I1** | **迭代中变更：三个家族三种行为，全部无文档**——List 按下标活跃（`for x in v: v.append(x)` 跑到 100 万上限）、Set/Map 活迭代器（增访删跳）、Record 键快照 + 幽灵访问 | 定案（可否决）：**照实成文各家契约**（D1 修后 Record = 快照且删除键跳过），charter §8 一段 |
| **COL-I2** | **同一作者错误三种错误身份**：`v[i]`→IndexError、`slice(0.5)`→裸 TypeError、`insert(-1)`→裸 RangeError；且 insert 拒负下标与 §8「负下标从尾计数」邻座矛盾，0..size 契约只活在运行时消息里 | 修：List 位置错误统一 IndexError；charter insert 行写明边界 |
| **COL-I3** | **集合 `==` 是引用身份，新建字面量做操作数恒为假**：`[1] == [1]` → false。D42 自己的理由（「恒定条件是逻辑 bug」）字面适用；**全审计盲测风险最高项**（Python 形表面就是在邀请 `[1,2] == [1,2]`） | 两半：**字面量操作数静态拒绝**（恒假可证，D42 既定理由，可否决）归 N-2b；**元素级相等要不要词汇**（`a.equals(b)`？深 `==`？还是不提供？）→ **记档待用户裁决**（行为优先 js 说引用，父亲 Python 说元素级 —— 亲代冲突，须用户拍板） |
| **COL-I4** | 编译器教 `stringify(value)`，照写却得 `VEL3001: Unknown name` —— 两跳死胡同，两条消息都不提 `import {stringify} from "velar/json"` | 修：诊断带上导入行 |
| **COL-I5** | 命名记录 → `Record<T>` 被无理由拒绝（匿名对象按 §8 承诺双向正确；命名记录因开放性而拒**是对的**，但消息零解释，且 `{...u}` 还「能用」= COL-D2 的洞） | 修：消息给理由 + charter 措辞消歧（与 D2 同批） |

### UNDEFINED（十条，含四条决案可否决）

| ID | 未定 | 处置 |
|---|---|---|
| **COL-U1** | 无 `flat`/`flatMap`，裸报无成员、无指引、§19 也没列 | 定案（可否决）：**加 `flatMap`**（map 家族的标准成员，边界内补完）；`flat` 不加（reduce+extend 可表达，flatMap 是常用形） |
| **COL-U2** | **Set 代数缺席**（union/intersection/difference —— JS 2025 与 Python 都有）；Set 无函数式方法且无人教 `.values()` 桥 | 定案（可否决）：加三个代数方法（复制语义，同 sorted）；函数式走 `.values()` 桥 + 定向教学 |
| **COL-U3** | **`filter(x => x != null)` 不收窄** `List<T?>`→`List<T>`（NaN 双胞胎有官方教法，null 这边零词汇） | 定案（可否决）：编译器特判这一个谓词形状（TS 同款能力的封闭词汇版）；不开放用户谓词类型 |
| **COL-U4** | **冻结宿主数组是全墙**：读/求和/展开/readonly 视图/parse 全拒，库数据无进语言之路 | 定案（可否决）：先教学消息（JS 侧复制一行），接纳冻结数组延后立项 |
| **COL-U5** | **ValidationError 零细节**：永远只有 `Value does not match {Name}` —— 无路径、无字段、无原因；这是 wire 验证语言每次 parse 失败的调试故事 | 修：带路径+字段+原因（与枚举审计 ENM-U4 内建错误类型可命名同族合并），归 N-2b |
| **COL-U6** | **整数样字符串键重排**：`{"2":…,"1":…}` 迭代出 1,2（JS 整数键序泄漏）；数字 ID 键的 JSON 静默重排 | 修：成文陷阱 + 教序敏感场景用 Map-from-entries |
| COL-U7 | 迭代顺序处处是插入序（含 set 保位、remove+re-add 移尾）但 charter 只说 "in order" | 成文（N-3） |
| COL-U8 | `List()`/`Array()` 值位置裸报无指引（Set()/Map() 是真构造器 —— 对称猜测的不对称陷阱） | 修：定向教 `[]` / `List<T>` |
| COL-U9 | `map((x, i) => …)` 裸可赋性错误，没人指两槽循环 | 修：定向教 `for value, index in v` |
| COL-U10 | 跨集合桥拒绝全不教 `.values()`/`.entries()`/`.keys()` | 修：消息一批 |

### CHARTER-DRIFT

无存活项 —— §8 「structural object → Record<T>」句是歧义（I5）非漂移；其协变
子句对匿名对象与 Record→Record 拓宽实测为真。

### DECIDED-AND-CORRECT（压缩）

相等/身份 5 项（跨种类 `==` 全拒且消息正确、别名身份、readonly 对比）；构造
10 项（空推断全位置、Map 三源构造新拷贝、重复键后胜、千元素字面量）；List
20+ 项（slice 负/夹紧、extend(self) 原子翻倍、SameValueZero 成员全家含 NaN、
空聚合契约、NaN 聚合错误逐字符合 charter、枚举排序拒绝带定向指引、回调快照
语义实证、VEL4029 含可选调用、join 严格 List<string>）；Map 10 项（NaN/-0 键、
null 键可用、嵌套变更、update 合并、记录字面量进 update 有定向指引）；Set 6 项；
**Record 敌意键探针干净**（`__proto__`/`constructor` 是普通自有字段、零污染、
has 无视原型 —— §3/§19 兑现）；横切 12 项（解构判定、调用展开仅限 rest、
readonly 视图消息优秀且传递、copy() 逃逸容器而元素保视图、绑定方法 + 命名实参
全词汇）；边界 6 项（洞数组两路拒、getter 记录双向拒、子类化数组安全接纳、
透明 Proxy 快照后操作、百万上限活迭代中强制）。

### 处置总结

D1/D2/I2/I4/I5/U5/U8/U9/U10 + I3 前半（字面量拒绝）→ **N-2b**；
I1/U1/U2/U3/U4 决案可否决随 N-2b 规格走；U6/U7 → N-3 文档；
**I3 后半（元素级相等词汇）→ 待用户裁决**（亲代冲突：JS 引用 vs Python 元素级）。


---

## 审计六 —— 文本面（2026-08-13 凌晨，快照 + 活树全复验）

### DEFECT（单位混用，执行级）

| ID | 现象 | 处置 |
|---|---|---|
| **TXT-D1** | **字符串排序是 UTF-16 码元序，其余全语言是码点序** —— 全表面唯一混单位处：`"\uFFFD" < "🔥"` → false（码点真值 true）；`sorted()` 输出 `z,🔥,�`（码点序应 `z,�,🔥`）。传播到 `< <= > >=`、min/max、sorted、sorted(by=)、sortBy/minBy/maxBy 六个面。**违反 runtime-boundary.md B-RUNTIME-TEXT 明文**（「UTF-16 offsets remain internal implementation details」）；Python/Rust/Go 全按码点 | 修（charter 合规，非新设计）：有序比较按码点序（= UTF-8 二进制序）；text-runtime 现成的无代理快路径让代价只落在含代理对的字符串上。归 N-2b |

### 待用户裁决（morning queue，一项两半）

**TXT-U1 + TXT-U2 —— `\u{...}` 转义 + 隐形字符政策（一个设计的两半）**：
- 现状 A：**无数字转义** —— 转义集只有 `\\ \" \n \r \t`，写异域码点只能裸贴不可见字符。
  **仓库自己已付此代价**：stdlib javascript.vel:163 的 `value < ""` 里藏着裸贴的
  **不可见 U+0080**（hexdump 实证 c2 80）。
- 现状 B：**字面量内隐形/双向控制字符零诊断**（裸 NUL、DEL、U+202E RTL-override
  全部静默接受）—— 木马源（CVE-2021-42574）的真实载体在字面量，标识符已拒 ZWSP，
  D36 第 39 条当年只裁了「字符串之外」。本语言使命是人可审计的 AI 代码。
- **推荐**：加 `\u{...}`（拒 D800-DFFF 保住无孤代理字面量保证）→ 隐形与双向
  控制字符须转义书写、裸贴给诊断。两半互为前提，D36 的理由直接延伸。
  **表面新增，等用户批**。

### UNDEFINED（其余，决案可否决或归文档）

| ID | 未定 | 处置 |
|---|---|---|
| **TXT-U3** | **规范化陷阱无文档无工具**：NFC "café" vs NFD "café" —— `==` false、size 4 vs 5、Set/Map 互不认；渲染完全相同；macOS 文件名就是 NFD 来的。`slug` 内部有去音符机制却不暴露 | 定案（可否决）：velar/text 加 `normalize(text, form="NFC")` + charter 一句「相等是码点序列身份，规范等价不相等」 |
| **TXT-U4** | **码点↔数字无桥**（ord/chr 缺席零指引）：stdlib 自己的 JS 词法器被迫**热循环里每字符建一个新正则**（javascript.vel:173-194 实证） | 定案（可否决）：velar/text 加 `codePoint(char) -> number?` / `fromCodePoint(number) -> string`（代理半拒收） |
| TXT-U5 | `number(text)` 全 charter 零出现（唯一入向转换拼写！），且实测**吞前后空白**而 standard-library.md 写 "strictly" | 文档：charter 一段钉死文法含 trim（母亲 JS 的 Number() 同款 trim） |
| TXT-U6 | `str(-0)`→"0"、`str(1e21)`→"1e+21" 等边缘全由 JS 继承决定 | 文档一句 |
| TXT-U7 | **charter 表从未说 `replace` 只换第一处**（Python 的 replace 是全换 —— 主要作者群体误期待） | 文档两格（行为随母亲 JS 不变） |
| TXT-U8 | 字符串值空间（孤代理、NUL）charter 未定义 —— 机制已在 runtime-boundary 决定且全方法不崩（实测），charter 缺一句 | 文档一句 |
| TXT-U9 | 大小写不敏感比较无受祝福惯用法（lower() 不是 folding："STRASSE" vs "straße" 实证）；locale 排序未文档化缺席 | 文档：教 lower() 近似 + locale 排序列有意缺席 |

### INCONSISTENT（诊断层，全归 N-2b）

| ID | 现象 |
|---|---|
| **TXT-I1** | **拼写指引教 JS 不教 Python** —— 11 条现有条目全是 JS 拼写；`strip`/`startswith`/`find`/`splitlines`/`casefold`/`format`/**`len(`（最常见的 Python 调用！）**全裸报；`title`/`capitalize` **在 velar/text 里存在**却不指路（而 trimStart 指）；`parseInt`/`parseFloat` 裸报而 Number(/String(/int( 有教学；`"ab".toString()` 裸报而 `(5).toString()` 有教学 —— 同规则不同接收者。**对盲测 KPI 是最高杠杆的廉价修复** |
| **TXT-I2** | `f"{x:.2f}"` → 误导级联（VEL2006 + "Unknown numeric unit 'f'"）—— Python f-string 肌肉记忆必撞；修：插值顶层 `:` 一条定向诊断教真实拼写（实施者核实 toFixed 是否存在，否则教受祝福的舍入惯用法） |
| **TXT-I3** | `"don\'t"` 硬错误且修法指错方向（真修法是删反斜杠）—— 双亲都接受 `\'`，生成代码必然含有 | 修：接受 `\'`（双亲一致、零陷阱） |

**顺带核对**：`1_000` 数字分隔符被拒 —— **非新发现**，D30 已批准、归批次 E/F 待实施。

### DECIDED-AND-CORRECT（压缩）

**单位契约除排序外处处成立**（🔥/👨‍👩‍👧/🇨🇳/👍🏽 全套过 size/slice/char/index/count/
split("")/padStart（**pad 宽度按码点计** —— JS 原生会错）/repeat/for-in/truncate）；
charter 18 成员表全实现无暗成员；velar/text 20 导出全符合文档；索引访问全家
（s[0] 定向教 char、空串边缘全理智、clamp 契约）；f-string 全家（同引号嵌套、
{{}}、await/三元、布局 rf、相邻字面量拒绝带指引）；字面量（未知转义硬 VEL1008
永不静吞、""" 教布局串、布局串精确保白）；转换（"a"+1 教 f-string、named-arg）；
不可变性（全方法复制、VEL4029、+= 是重绑定）；宿主边界（String 包装对象与
Symbol 关死不强转不执行钩子、16MiB/1M 预算先于分配触发、绑定方法与可选接收者）。

### 处置总结

TXT-D1 + I1/I2/I3 → **N-2b**；U3/U4 决案可否决随 N-2b；U5-U9 → N-3 文档；
**U1+U2（\u{...} 转义 + 隐形字符政策）→ 待用户裁决**（表面新增）。
