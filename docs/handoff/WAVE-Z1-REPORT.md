# 波 Z1 —— 补齐波 N-3 静默丢掉的诊断与消息欠账

基线 `450a13c`，分支 `wave/z1`。任务来源：`docs/handoff/WAVE-CD-REPORT.md` §6.1 与
§6.5 第 1 条 —— 波 N-3（提交 `5e70b4b`）只落了文档，把指派给它的每一条诊断/消息
工单静默丢掉，其中含三条已批准的用户裁决（D45 第 76/78/79 条）。本波关闭该欠账
的全部 17 条，外加一条在验证 D45-78 推荐写法时发现的缺陷。

每条诊断改动都在 `tests/hardening-wave-z1.test.ts` 有一条以 ID 命名的回归测试
断言新消息**逐字**文本（36 例，全绿）。

---

## 1. 诊断类（10 条）

### 1.1 CLS-I1 —— 字段初始化器 / 静态成员里的 `self`

**根因**：`self` 走普通未知名字路径（`analyzer.ts` 的 `IdentifierExpression`
分支），得到 `VEL3001 Unknown name 'self'` 并返回 `unknownType`；那个 unknown
再生出两条级联（`Cannot access 'x' on unknown without validation` +
`Cannot assign unknown to T`）。charter 只说过「`self` 在方法体内显式」，从未说
它在哪些位置**不存在**。

**修复**：`analyzer.ts` 新增 `unavailableSelfGuidance()`，按位置给出规则本身，
并返回 `invalidType` 截断级联：

- 字段初始化器 → `'self' is available in constructor, method, and getter bodies; a field initializer runs before the instance is complete, so assign this field in the constructor instead`
- 静态成员（含静态字段初始化器） → `'self' is available in constructor, method, and getter bodies; a static member has no instance — reach class-owned members through the class name, as in 'Counter.member'`

静态字段初始化器同时满足两个条件，先判静态 —— 「没有实例」是无论何时运行都成立
的那一条。类外的 `self` 仍是普通未知名字（连同它的两条级联），因为那里确实只是
一个不存在的名字。D31 第 28 条第 1/4 项要求的正是这两条消息，本波一并落地。

**测试**：`[CLS-I1]` ×3（含实例方法体不受影响的执行级证明）。

### 1.2 CLS-I4 —— `extends <extern class>`（D45 第 78 条）

**根因**：基类检查要求 `this.classes.has(baseName)`，而 extern 类以 `js:` 身份
（`js:<source>#<Name>`）为键，源类以 `velar:` 为键。于是一个**解析得完全正确**的
extern 基类掉进 `Unknown base class 'Chart'`，读起来像拼写错误。

**修复**：`analyzer.ts` 增加一条前置分支，用 `isExternClassIdentity()`（`js:`
前缀是唯一可靠判据）识别 extern 基类，报 D45-78 的定向文本：

```
Extern class 'Chart' cannot be extended; wrap the instance by composition — hold it in a field and expose the behavior as methods or functions
```

charter §19 增「extending an `extern` class」条目（含 `extends Error` 不受影响的
说明）。真正拼错的基类仍得 `Unknown base class`；`extends Error` 回归有测试。

**测试**：`[CLS-I4]` ×3。

### 1.3 CLS-I5 —— 方法/getter 上的 `readonly`

**根因**：`readonly` 在类体修饰符扫描处**立即**报错，那时还不知道后面是什么成员，
所以字段和可执行成员共用一条消息「use 'const' for a read-only field」——
对方法/getter 是无法采纳的建议。

**修复**：`parser.ts` 把 `readonly` 记为 `readonlyModifier` token，延迟到成员种类
已知时由 `reportClassMemberReadonly(modifier, kind, code)` 报出。源类体与 extern
类体两处修饰符扫描都改造：

- 字段（`const`/`let`，以及无法识别的成员）→ 原文不变
- 方法 / getter / 构造器 → `'readonly' is a data-type modifier, not a class member modifier; a method, getter, or constructor is executable and has no readonly contract — mark the data it works with, as in 'readonly List<number>'`

**迁移落地**：`tests/readonly-class.test.ts:39`、`tests/compiler.test.ts:18611`
两处逐字断言改为新文本（均为设计性改动，非行为回归）。

**测试**：`[CLS-I5]` ×2（含 extern 类成员与字段仍指向 `const`）。

### 1.4 CLS-U1 —— 无 setter（D45 第 79 条）

**根因**：解析器没有 `set` 形态的识别路径，`set x(v):` 落进类体兜底，得
`VEL2007` ×2 + `VEL2004`，三条都没说「没有 setter」。

**修复**：`parser.ts` 在类体识别 `set <identifier>(` 形态（`get` 有专门解析路径，
`set` 获得同款识别但只用于教学拒绝），发**一条** `VEL2007`：

```
VelarScript classes have no setters; assign the field directly, or declare a method such as 'def setSize(value: T)'
```

随后 `skipMistypedDeclaration()` 吞掉该成员及其块，因此不级联。charter §19 增
「class setters」条目。`def set(...)` 与名为 `set` 的字段仍合法（执行级回归）。

**测试**：`[CLS-U1]` ×2。

### 1.5 CLS-U7 —— 没有可选字段语法

**根因**：`let x?: number = 1` 里的 `?` 让 `this.match("colon")` 失败，于是报
`Class fields require an explicit type` —— 类型明明就写着，消息**是假的**，而且
掩盖了真规则。

**修复**：`parser.ts` 消费 `?`、照常解析类型，然后报真规则，并把作者写的类型
原样拼进建议里：

```
VelarScript has no optional-field syntax; a field carries an optional type instead — write 'let x: number? = null'
```

已是可选的类型不会被写成 `number??`；完全没有类型标注的字段仍报缺类型。
charter §19 增「optional-field syntax」条目。

**测试**：`[CLS-U7]` ×2。

### 1.6 CLS-C2 —— `super.member` 的真实范围

**根因**：charter §10 承诺 `super.member`，实测只有方法与 getter 能解析（字段是
整个实例共享的一处存储，`super.field` 什么都不命名）；裸 `super` 的消息连 getter
都没提。

**修复**：

- charter §10 重写该段：`super` 到达的是方法与 getter，基类**字段**经
  `self.field` 读写；位置规则（构造器/方法/getter/字段初始化器/嵌套箭头，嵌套
  `def` 不继承）保留。
- `analyzer.ts` 裸 `super` 消息改为 `'super' must be followed by a base method or getter name`。
- 同段顺带成文 CLS-I1 的位置规则与 CLS-U9（见 2.3）。

`Base class 'X' has no method or getter 'n'` 本来就提了 getter，不动。

**测试**：`[CLS-C2]` ×2（含 `super.describe()` / `super.doubled` / `self.n` 的
执行级证明）。

### 1.7 LOK-I5 —— Core 文件里的 Web 单位

**根因**：Core 的 `numericSuffixes` 只有 `ms`/`s`，Look 单位由 `@velarscript/web`
注入。于是 Core 里 `16px` 得 `Unknown numeric unit 'px'`（拼写完全正确却被叫做
未知），而 `50%` 因为 `%` 不被消费，掉进 `VEL2002` 续行消息。

**修复**：

- `language-guidance.ts` 新增 Core 侧 `webNumericUnitOwner()`（px/rem/em/vw/vh/
  vmin/vmax/%/fr/deg/turn；`ms`/`s` 不在其中，它们是 Core 的），与解析器里
  `keyframes:`/`look:` 的跨扩展指引同一做法。
- `lexer.ts` 用 D37 第 45 条的声音：
  `The numeric unit 'px' belongs to @velarscript/web; add "@velarscript/web" to velar.json extensions, or move this module into a Web project`
- `%`：只在**右操作数不可能出现的位置**（行尾、EOF、`)`、`]`、`}`、`,`、`;`、`:`）
  才当单位读。Web 侧行为逐字不变（`numericSuffixes.has("%")` 优先）。

**上报（重要）**：第一版实现让 Core 无条件消费 `%`，直接撞上既有的
DECIDED-AND-CORRECT 契约 `tests/hardening-statement-boundary.test.ts:78`
（「Core has no percent suffix, so both remainder spellings evaluate to 1」）。
按 ops 纪律第 6 条，既有契约优先：`10%3` 与 `10 % 3` 在 Core 仍都求值为 1，只有
`50%`（后面接不了操作数）拿到单位指引。谁也不拥有的单位仍是
`Unknown numeric unit 'qq'`。

**测试**：`[LOK-I5]` ×4（含余数两种拼写的执行级回归与 Web 侧不回归）。

### 1.8 MOD-I2 —— 副作用导入：两种拼写都拒绝（D50 第 99 条）

**根因**：`import "./fx.vel"` 被读成缺少默认导入名（`Expected a default import
name` + `Expected 'from' after imports`），而 `import {} from "./fx.vel"` 却编译
干净、跑副作用、格式化器祝福 —— 两个候选形互相矛盾，且其中一个是**隐形动作**。

**⚠ 本条经历了一次裁决反转，最终实现 = 双拒绝。** 先按任务书与
`COMPLETENESS-AUDITS.md:593` 的旧定案实现了「祝福裸字符串形」（并上报了它与
D31 第 28.3 条「维持不支持」的冲突）；上报后用户以 **D50 第 99 条** 推翻旧定案：
副作用导入是隐形动作，读者看到那一行无法知道发生了什么，与 D43 第 68 条排除
用户自定义装饰器**同源**（任何机制都不得把行为藏在代码主人看不见的地方）；
「双亲都有」从来不是无条件理由 —— Vel 已删掉双亲都有的真值判断、`==` 强转、
`switch`。D31 第 28.3 条的原意由此兑现。

**最终修复**：

- `parser.ts` `parseImport`：`import` 后直接是字符串 → 报 `VEL2029` 并返回 null；
  空花括号形解析出源之后同样报同一条、同样返回 null。**一条消息，两种拼写**：
  `A module's effects must be visible where they happen; export a function and call it — import {install} from "./fx.vel", then install()`
- **不注册机械改写**：要导出并调用哪个函数是作者的决定，不是拼写变换
  （D38 第 48 条的机械修复只覆盖诊断已知唯一答案的情形）。
- 返回 null ⇒ 被拒的导入**不产生依赖边**，模块不存在时也不会在那条消息上再叠一条
  `VEL6xxx`（同 MOD-I1/BRG-D1 的纪律）。零 specifier 的 `ImportDeclaration` 因此
  不再可能产生，先前为它加的 emitter 分支**已回退**，不留死代码。
- `import css unsafe "./x.css" before look` **不受影响**（已裁决的资源边界，
  且 CSS 没有可调用的等价物），有回归测试钉住。
- charter §12 改写为该规则本身 + 可见形的 fence 示例（`import {installFormats}`
  再 `installFormats()`）+ 例外说明；连带把上一段「unused import」的措辞收紧为
  「导入一个名字仍会初始化它所属的模块」，以免读成对副作用导入的祝福。

**迁移落地**：仓库内无需迁移 —— 逐一扫过 `.vel` 源、`examples/**`、
`packages/create` 模板、stdlib、测试与文档 fence，`import {} from` 与裸字符串
导入的出现处只有本波自己写的那几处（已改），以及 handoff 记录（属历史记载，不动）。

**测试**：`[MOD-I2]` ×6（裸字符串拒绝 / 空花括号同一条消息 / 无 fix 无 recovered /
不产生依赖边 / 具名与命名空间导入不受影响 / 可见形 CLI 端到端执行 +
`import css unsafe` 豁免）。

### 1.9 MOD-U7 —— 普通 import 一个 JS-only 包

**根因**：`resolveVelarSourcePackage`（`packages/cli/src/project.ts`）对
「manifest 读到了、但没有 `velar.entry`」抛普通 `Error`，调用点包成
`Cannot resolve VelarScript package import 'left-pad': package.json must declare
'velar.entry'` —— 抱怨一个作者无法处理的字段，一个字都没提桥。

**修复**：新增 `JavaScriptOnlyPackageError`，调用点给出 BRG-U2 的**镜像**教学
（BRG-U2 是「VelarScript 包被 `import js` 导入」，这条是反方向）：

```
'left-pad' is a JavaScript package, not a VelarScript package; reach it across the bridge — import js {name} from "left-pad", and declare 'extern module "left-pad":' when you want the contract checked
```

根本没装的包仍得 `package 'x' is not installed`（那是真的缺件）。

**测试**：`[MOD-U7]` ×2（CLI 项目级，含未安装包不回归）。

### 1.10 BRG-D2 —— extern 成员的无类型参数（D38 第 47 条）

**根因（与账本记载不同，见下）**：`resolveValidatedExternAnnotation(null, …)`
返回 `unknownType`，而 `unknown` 作为形参类型接受**任何**实参
（`isAssignable(…, unknown)` → true）。所以缺类型的 extern 成员既不报错也不消失
—— 它被**静默接受并降级**，`render(12345)` 编译干净。

**修复**（`parser.ts`，D38 批准文本）：

- `reportUntypedExternParameters()`：extern module 的 `def`、extern class 的方法
  与构造器，逐参数在**声明处**报
  `Extern parameter 'source' requires an explicit type; there is no body to infer from`
- `reportExternDeclarationBody()`：签名后出现 `:` 或 `{`（TS 声明习惯）→
  `Extern declarations have no body; the JavaScript package provides it`，
  跳过该成员并继续，同 module 其余成员照常解析。
- 成员仍留在 module 契约里（不从导出表里删），所以使用处不再被牵连报第二条 ——
  「在成员处诊断、永不无声」达成，且零级联。

**上报：账本证据已过期**。D38 第 47 条记的是「成员被整个丢弃、
`render(12345) → VEL3001 Unknown name 'render'`」。今天不是丢弃而是静默接受
（声明处零诊断、使用处**也**零诊断），比记录的那条更安静。D38 关于「解析恢复 =
跳过该成员」的措辞按其目的（永不无声 + 后续成员不受累）实现，缺类型这一支没有
可跳过的语法，故保留成员以免把声明缺陷记到使用处头上。

**测试**：`[BRG-D2]` ×6（缺类型 / 同 module 其余成员 / extern 类方法与构造器 /
`:` 体 / `{}` 体 / 全类型化仍干净）。

---

## 2. 文档类（7 条）

行为本来就正确，缺的是句子。charter fence 全部经 `check:docs` 编译。

### 2.1 CLS-U3（D45 第 76 条）—— charter §10

override 签名严格不变：参数类型、元数、**结果类型**必须与基类逐字一致，
`-> number` 不可覆写 `-> number?`（逻辑无害也不放开）；参数**名**归覆写方自己。
成文时按 D43 第 68 条纪律记为**可反证的排除**。回归测试 `[CLS-U3]` 钉住两侧。

### 2.2 CLS-U8 —— charter §11 + §18

§11 首句原为「Only `Error` values can be thrown from checked VelarScript」，
现补：那是关于 `throw` 的规则，不声称每个失败都源自源码 —— 编译器注入的守卫会
raise，且它们经 §11 的归一化以 `Error` 抵达 catch 绑定，但顺着 `throw` 回溯的
读者找不到任何 `throw`。§18 新增一条 bullet 讲机制：类实例字段读取是注入的
守卫读（`__velarReadInstanceField`），字段声明为 `T` 就不能放 `undefined`，
读到 `undefined` 直接 raise 宿主 `TypeError` 并指名字段；private/static 同款；
`Error.cause` 豁免；这也是唯一「读取是一次调用」的类成员，因此热循环里值得
`const` 一次。

执行级证明（`[CLS-U8]`）：`import js unsafe` 灌入 `undefined` 的字段被读时输出
`TypeError: Field 'value' was read before initialization or contains undefined`。

### 2.3 CLS-U9 —— charter §10

类字段可以叫 `self`（`self.self` 实测返回 7）。按任务书建议**成文现状而不加限制**
——当前 lowering 下无害，保留一条没有缺陷支撑的规则只会白白拿走词汇。成文位置在
§10 的 `self` 位置规则段落末尾：接收者关键字与成员命名空间是两个空间。
执行级回归 `[CLS-U9]`。

### 2.4 RDO-1（D47 第 85 条）—— charter §5 + §12

§5「read-only data views」段末新增一整段：`readonly` 是静态纪律，`unknown` 正是
该纪律停止的地方；从 `unknown` 验证出的值是**一个新的独立断言**（验证断言形状、
不复制、不携带来源视图的记忆），因此从 `readonly` 记录的 `unknown` 字段 parse 出
的可变值别名着该视图正在保护的结构，写它就是穿过该视图写 —— 且零诊断，因为已经
没有什么可查了。§12 在「Validation proves the shape…」句后补同一条的短版本 +
指回 §5。执行级证明 `[RDO-1]`：打印 `{"name":"mutated"}`。

### 2.5 BRG-U1（D47 第 83 条）—— 三个指派产物全部落地

- `docs/javascript-bridge.md` 新增小节「Extern arguments are read-only」：过桥的是
  **raw 身份**；外来写入落在真数据上而 Vel 侧听不见（响应式失效靠 Vel 侧赋值，
  外来写入不是赋值 → 不重算、不重渲染、不触发 watch；事实也有同一盲区），因此
  每次调用只单向携带数据 —— 包要产出数据就 **return**，由 Vel 侧赋值（带一个
  gate 编译的 fragment 示例，形参声明 `readonly` 把契约写进签名）。
- charter §18 一句同款 + 指向 bridge 文档。
- AI 简报一条（**两份副本逐字相同**，619 行 ≤ 750）。

### 2.6 FLW-N5 —— charter §5

「Two boundaries remain」改为「Three」，第三条：下标与 `Map.get` 也不是位置 ——
`values[0]`、`lookup.get(key)` 每次书写都在求值，测一次不为下一次收窄任何东西；
读进 `const` 再测，两次读取合成一次。

### 2.7 FLW-N8 —— charter §5

在「every later read … rechecks the available runtime evidence」段后补成本模型：
重查发生在**每一次依赖该事实的读取**，不是每次检查一次；记录/集合是一次验证性
遍历；一次检查十次读取就是十次重查。默认如此才让事实能跨调用存活，但热循环里
应把收窄值 `const` 绑定一次再读 —— `const` 直接持有已检类型，无事实、无重查。
`[FLW-N8]` 用发射产物钉住：三次收窄读 = 3 个 `__velarNarrow(__velarValue,` 调用，
绑定 `const` 后 = 1 个。

---

## 3. 顺带发现并修复的缺陷（**不在工单内，需裁决是否保留**）

**extern 类名在类字段 / 记录字段标注里不解析为该 extern 类。**

发现路径：验证 CLS-I4 新消息推荐的写法（「hold it in a field」）是否真的成立。
实测五个标注位置里有两个是坏的：

| 位置 | 修复前 | 修复后 |
|---|---|---|
| 局部绑定 `const c: Chart = Chart()` | 正常 | 正常 |
| `def` 形参 `def go(c: Chart)` | 正常 | 正常 |
| 类字段 `let inner: Chart` | 声明干净，`self.inner = chart` 报「Cannot assign Chart to a different Chart contract」 | 正常 |
| 参数属性 `constructor(let inner: Chart)` | 声明干净，`self.inner.draw()` 报「Type 'Chart' has no field 'draw'」 | 正常 |
| 记录字段 `type Holder: chart: Chart` | 同上 | 正常 |

**根因**：`analyzer.ts` 的 `resolveNamedClasses()` 只接受 `classConstructor` 种类
的导入绑定，而 `externTypeImports` 记的是 **`class` 种类**本身。类成员在
`predeclareTopLevel` 阶段解析，那时 `import js` 的绑定还没进作用域，于是只有
`externTypeImports` 能作答 —— 它被那个种类检查挡掉，标注冻结成结构化 named 类型。
声明看起来干净、成员读取才炸，正是桥不允许的静默降级（与 BRG-D2 同类）。

**修复**：一行分支 —— **只有** `externTypeImports` 可以用 `class` 种类作答
（`lookup` 里恰好持有某实例的同名局部绑定绝不能变成类型名，故显式比对来源）。
源类同位置的控制组本来就正常，行为不变。

**为什么在本波做**：D45 第 78 条是已批准的用户裁决，其批准文本推荐的正是这条坏
掉的写法；发一条推荐坏形状的消息不如把形状修好。改动最小、注释写明了来由，
若裁决认为应独立成票，回退点是 `analyzer.ts` 的 `resolveNamedClasses()` 一处分支
加上 `[CLS-I4] composition across the bridge is the shape that works` 一个测试。

---

## 4. 迁移落地（穷尽）

1. `tests/readonly-class.test.ts:39` —— CLS-I5 新文本。
2. `tests/compiler.test.ts:18611-18613` —— CLS-I5 新文本（extern getter + method 两条）。
3. 其余既有测试逐字不变，含 `hardening-statement-boundary.test.ts` 的
   Core 余数契约（见 1.7）与 Web 侧百分比契约。
4. 无 `.vel` 源、示例、模板、stdlib 需要迁移：逐一扫过 `examples/**`、
   `packages/create` 模板、stdlib、`.vel` 源与文档 fence —— 仓库里没有
   `import {} from`、没有裸字符串导入、没有紧贴的 `%` 算术、没有
   `readonly def`/`readonly get`、没有无类型 extern 形参。

## 5. 上报清单（规格 vs 代码）

1. **MOD-I2 的规格冲突已上报并由用户反转**：`D31-STRUCTURAL-AUDIT.md` 第 28.3 条
   （维持不支持）与审计账本 MOD-I2 行（祝福裸字符串形）互相矛盾。上报后用户以
   **D50 第 99 条**裁定**两种拼写都拒绝**，账本 MOD-I2 决案作废。本波已按第 99 条
   重做（见 1.8），先前实现的「祝福」连同为它加的 emitter 分支一并回退。
   `COMPLETENESS-AUDITS.md:593` 那一行的决案文本现已过期，建议在账本上盖
   SUPERSEDED-by-D50-99。
2. **D38 第 47 条的现状证据已过期**（静默丢弃 → 静默接受降级），见 1.10。
3. **LOK-I5 第一版实现撞既有 DECIDED-AND-CORRECT 契约**，已按 ops 纪律第 6 条
   收窄，见 1.7。
4. **一条工单外缺陷已修**（extern 类名标注解析），见第 3 节。D50 第 99 条的附带
   确认已追认该越界为正确（「教出去的路必须走得通」），回退点仍记在第 3 节。
5. 无「待用户裁决」项：本波 17 条的语义都由 D38/D45/D47/D50 或账本定案给定。

---

## 门禁（逐字尾部）

三道门禁在 D50 第 99 条反转落地后的最终树上按序重跑（每道各自持 `gate-lock`，
运行期间未触碰工作树）；`tests/hardening-wave-z1.test.ts` 38 例含在其中，全绿。
同期 sibling worktree `wave/z2` 也在跑，未观察到 fd 串扰。

### `npm run check`（exit 0）

```
> velarscript-workspace@0.10.0 check:format
> node scripts/check-velar-format.mjs

Checked 53 formatted VelarScript source files and 25 project template sources

> velarscript-workspace@0.10.0 check:docs
> node scripts/check-documentation-examples.mjs

Checked 186 VelarScript documentation examples (77 complete, 109 fragments), all under full project analysis

> velarscript-workspace@0.10.0 check:boundaries
> node scripts/check-runtime-boundary.mjs

Checked 77 runtime boundary operations and the shared registry, strict JSON, Web DOM, host-event, browser-platform, storage-host, and Desktop-host ABIs
```

### `npm test`（exit 0）

```
ℹ tests 1091
ℹ pass 1091
ℹ fail 0
```

```
Checked 15 modules from examples/production-web
Checked 9 modules from examples/flow-board
Checked 8 modules from examples/support-desk
Checked 3 modules from examples/api-dashboard
✓ src/store.test.vel :: theme store

1 passed, 0 failed
✓ src/domain.test.vel :: task workflow uses finite states
✓ src/domain.test.vel :: board mutations are direct and typed
✓ src/domain.test.vel :: task draft uses named record fields

3 passed, 0 failed
✓ src/domain.test.vel :: ticket selection and pagination
✓ src/domain.test.vel :: ticket resolution mutates the owned ticket
✓ src/domain.test.vel :: ticket draft crosses the domain boundary

3 passed, 0 failed
✓ src/chart.test.vel :: chart coordinates are bounded
✓ src/chart.test.vel :: chart scale owns derived internal state
✓ src/chart.test.vel :: chart scale constructor rejects invalid values

3 passed, 0 failed
```

**中途一次自伤失败，已排除**：在 `release.acceptance.ts` 运行期间，我在门禁之外
单独跑了 `npm run --workspace @velarscript/compiler build`（绕过 `gate-lock`），
它 clean 掉 `packages/compiler/dist`，于是该测试的
`.workspace-release.sentinel` 报 ENOENT。属同一 checkout 内的门禁互踩（正是
`gate-lock` 存在的理由），非代码缺陷也非 sibling 串扰；最终树上按序重跑
1089/1089 通过。

### `npm run test:browser`（exit 0）

```
✓ firefox :: src/app.browser.test.vel :: support desk http filter and pagination
✓ firefox :: src/app.browser.test.vel :: typed form route context and persistence
✓ firefox :: src/app.browser.test.vel :: direct detail route recovers data
✓ firefox :: src/app.browser.test.vel :: query page uses strict optional number parsing
✓ webkit :: src/app.browser.test.vel :: dialog cancel restores trigger focus
✓ webkit :: src/app.browser.test.vel :: support desk http filter and pagination
✓ webkit :: src/app.browser.test.vel :: typed form route context and persistence
✓ webkit :: src/app.browser.test.vel :: direct detail route recovers data
✓ webkit :: src/app.browser.test.vel :: query page uses strict optional number parsing

15 passed, 0 failed
✓ chromium :: src/app.browser.test.vel :: dashboard loads typed data and real svg
✓ chromium :: src/app.browser.test.vel :: dashboard resource reloads without replacing the chart contract
✓ firefox :: src/app.browser.test.vel :: dashboard loads typed data and real svg
✓ firefox :: src/app.browser.test.vel :: dashboard resource reloads without replacing the chart contract
✓ webkit :: src/app.browser.test.vel :: dashboard loads typed data and real svg
✓ webkit :: src/app.browser.test.vel :: dashboard resource reloads without replacing the chart contract

6 passed, 0 failed
Installed VelarScript browser-project acceptance passed
```
