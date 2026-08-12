# D30 — 第二轮语法排查：保留字、字面量、优先级、语句纯度（已批准，待实施）

用户于 2026-08-12 批准（「这些问题按照你的建议来修」）。判据同 D28/D29：
正常语言用法 → 盲写者不看文档能打对 → 一个明显拼写 > 少写几个字。
所有结论均由真编译器探针验证；复现片段内嵌于各节。

**与 D29 同款前提**：诊断系统没有警告级别，每条诊断都让编译失败；
「合法但不推荐」只能进文档与 LSP 提示。

---

## 第 16 条 —— 保留字软化（本轮最重）

### 现状（实测）

以下常用词**连绑定名都不能当**，报错是不点名原因的裸
`VEL2011: Expected a binding name`：

| 词 | Core | Web 项目 | 亲代语言 |
|---|---|---|---|
| `type` | 拒绝 | 拒绝 | Python 3.12 软关键字、TS 上下文关键字 —— 均合法 |
| `match` / `case` | 拒绝 | 拒绝 | Python 为此发明软关键字 —— 合法；JS 不保留 `match` |
| `from` / `as` | 拒绝 | 拒绝 | 两边均合法（JS 中仅 import 位有意义） |
| `state` / `action` | **合法** | **拒绝** | 均合法；`state` 是 JS 最常见变量名之一 |
| `enum` | 拒绝 | 拒绝 | **JS FutureReservedWord —— 必须保留** |

三个具体伤害：

1. `const type = payload.type` 不能写 —— 协议代码最高频形态。对象解构 shorthand
   已有定向教学（`Keyword-named field 'type' requires ': name'`，质量好），但普通
   绑定位、`for case in cases:` 循环位是裸 VEL2011，从不说这是保留字。
2. `state` / `action` 在 Core 合法、Web 非法 —— 同一行代码换个项目类型就编译失败，
   W-1 型重构陷阱的语言级复刻。
3. charter §19 自己的保留理由（「JS 保留词不能作绑定名，因为产物必须是合法 JS」）
   只覆盖 `enum`，**不覆盖 type/match/case/from/as** —— 这五个词 JS 不保留。

### 目标语义

- **软化为上下文关键字**：`type`、`match`、`case`、`from`、`as`（Core），以及 Web
  扩展语句头词（`state`、`action`、`resource`、`watch`、`look`、`component`；实施时
  以扩展注册表为准枚举，勿信本清单穷尽）。软化后这些词可作绑定名、参数名、循环
  变量、解构 shorthand —— `const {type, data} = event` 直接可写，原 shorthand 定向
  诊断对已软化词退役（对仍硬保留词保留）。
- **保持硬保留**：`enum`（JS 保留词，产物约束）；运算符词 `in`/`is`/`and`/`or`/`not`
  （Python 同样保留，双亲用户无此习惯）；结构词 `def`/`class`/`if`/`else`/`while`/
  `for`/`return`/`import`/`export`/`const`/`let`/`try`/`catch`/`finally`/`throw`/
  `async`/`await`/`assert`/`abstract`/`override`/`static`/`private`/`extern`/
  `unsafe`/`pass`/`break`/`continue`/`extends`/`super`/`self`/`constructor`/`get`
  （维持现状；`invert` 按 D28 第 7 条撤销后自然归还）。

### 消歧原则（实施核心，通用于全部软化词）

**语句边界检查（VEL2032，已落地）是使能器**：`IDENT IDENT` 永远不是合法表达式
语句，因此 ——

> 语句头的软化词，若后随 token **无法延续表达式**（典型：另一个标识符），
> 则它是声明关键字；否则它是普通标识符。

逐词展开：

- `type` / `state` / `resource`：语句头 + 标识符（+ `:` / `=` / 记录体）→ 声明；
  `type = 5`（后随 `=`）→ 对名为 type 的绑定赋值；`type(x)` → 调用。
- `match`：语句头 + 表达式 + 行尾 `:` + 缩进块首 token 为 `case` → match 语句。
  块首必为 `case` 是 Vel 独有的两行消歧器，零误报（不存在「调用 + 冒号」的
  合法语句形态）。
- `case`：仅在 match 块体内保留；其余位置为标识符。
- `from` / `as`：仅在 import/export 与模式（`case X as y`）、watch 子句
  （`watch e as c, p`）的既有产生式内保留；其余位置为标识符。
- `action` / `component`：语句头 + 标识符 + `(` / `:` / `exposes` → 声明。
- `watch`：语句头 + 表达式 + 顶层 `as` + 行尾 `:` → watch 块；`watch = 5` /
  `watch(x)` → 标识符。
- `look`：表达式位后随 `:` + 缩进 → look 块；否则标识符
  （`const a = look` 读绑定，`const a = look:` 开块）。

### 诊断配套

- 仍硬保留的词在绑定位出现时，裸 VEL2011 升级为点名诊断：
  `'enum' is a VelarScript keyword and cannot be a binding name; rename the binding`
  —— 与既有 shorthand 教学（`': name'`）同族同语气。
- 软化不改变已有声明语法的一切诊断与恢复路径；新增回归必须证明
  「同名绑定 + 同词声明」在同一模块内共存无歧义（如 `const state = 1` 之后
  `state count = 0` 仍是声明）。

### 回归（永久）

- 五个 Core 词 + `state`/`action` 各自覆盖：绑定、参数、循环变量、解构 shorthand、
  成员访问、具名实参位全部可用（编译 + 执行）。
- `match` 作绑定名与 match 语句在同文件共存；`type` 同理。
- Web 项目与 Core 项目对同一段代码判定一致（W-1 型回归）。
- `enum` 仍被拒且新诊断点名保留字。

---

## 第 17 条 —— 纯表达式语句必须报错（`x == 5` 笔误）

### 现状（实测）

```
let x = 1
x == 5      // 想写 x = 5，打成 ==。零诊断，静默丢弃
print(x)    // 1
```

`=`/`==` 镜像笔误。D29 第 14 条只覆盖**方法调用**的纯结果丢弃；本条覆盖其余
表达式语句。语句边界修复（VEL2032）管的是悬空 token，`x == 5` 是语法完整的
语句，两者不重叠。

### 目标语义

表达式语句的**顶层节点**必须是有效果的形态：调用、可选调用、方法调用、`await`。
其余顶层形态一律报错：比较/相等/算术/逻辑二元表达式、比较链、`??`、一元
`not`/`-`、裸标识符、裸字面量、裸成员读、三元表达式、下标读。

判定依据是**顶层结果被丢弃即无意义**，与子表达式是否有副作用无关
（`f(x) == 5` 作语句同样报错 —— 比较结果被丢弃就是 bug；想要副作用就直接写
`f(x)`）。诊断教修法：`Use '=' to assign, or use the result`（按顶层形态微调文案，
沿用「一个当前拼写」语气）。

与 D29 第 14 条的边界：第 14 条管「调用形态 + 编译器已知纯方法」，本条管
「非调用形态」。两条合并覆盖后，合法的表达式语句只剩真正可能有效果的调用族。

---

## 第 18 条 —— 数字字面量家族与「Unknown numeric unit」误导工厂

### 现状（实测）

四种用户意图撞进同一条误导消息，而 Core 根本没有单位系统：

| 用户写的 | 意图 | 实际报错 |
|---|---|---|
| `1_000_000` | 数字分隔符（Python/JS 均有） | `Unknown numeric unit '_000_000'` |
| `0xFF` | 十六进制（Python/JS 均有） | `Unknown numeric unit 'xFF'` |
| `f"{x:.2f}"` | Python 格式规格 | `VEL2006` + `Unknown numeric unit 'f'` |
| `#f0f0f0` | hex 颜色（盲测账本二期 #20，已知） | `Unknown numeric unit 'f6'` |

另：`007` 静默等于十进制 7（Python 与 JS strict 均拒绝前导零）。

### 决定

1. **加数字分隔符** `1_000_000`：双亲语言均有；Lite 的 `12 * 1024 * 1024` 就是在
   绕它。规则取双亲交集：下划线仅允许出现在两个数字之间（禁首尾、禁连续、禁贴
   小数点/后缀）；对单位字面量作用于数字部分（`1_000px` 合法）。
2. **不加 hex/二进制/八进制字面量**，给定向指引：`0x`/`0b`/`0o` 前缀 →
   `Hexadecimal literals are not part of VelarScript; write the decimal value`
   （Look 颜色场景由既有 hex 颜色指引覆盖）。理由：颜色有 rgb()/字符串，位运算
   不存在，加了没有消费场景。此为「评估过不做」，记档防复议。
3. **f-string 格式规格给定向指引**：插值内出现顶层 `:` 后随格式样式文本时 →
   `Format specifications are not part of f-strings; use value.toFixed(2), padStart, or padEnd`。
4. **拒绝前导零**：`007` → 定向诊断 `Remove the leading zeros; octal literals are
   not part of VelarScript`（`0.5`、单个 `0` 不受影响）。
5. **消息卫生**：未注册任何单位后缀（Core）时，该词法路径不得出现 "unit" 措辞，
   改为 `Unexpected characters after a number` + 上述定向指引；注册了单位（Web）
   时保留单位消息，但 1-4 的定向指引优先命中。

---

## 第 19 条 —— `not` 优先级：保持现状，补文档与两条指引

### 现状（实测）

`not 1 == 2` 解析为 `(not 1) == 2` —— `not` 绑得比比较紧，与 Python 相反
（与 JS 的 `!` 相同）。伤害有限的原因值得记档：对纯 bool 操作数，
`(not a) == b ≡ not (a == b)`（两者都是 XOR），其余情形被「操作数必须是 bool」
拦住，不构成静默错误源。**保持现状优先级**，配套两件事：

1. **charter §4 增设运算符优先级表** —— 目前全文对优先级零说明（grep 证实）。
   实施者从 parser.ts 的 `binaryPrecedence` 与一元处理中提取真实表格；
   已验证事实：`-2 ** 2 == -4`（`**` 高于一元负号，Python 侧）、`-2.abs() == -2`
   （成员访问高于一元负号）、`not` 高于比较（JS 侧）、`%` 与 `*` 同级。
   表格必须与实现逐行核对，不得凭印象写。
2. **两条定向指引**：二元 `in` / `is` 的左操作数是一元 `not` 节点时 ——
   `not x in y` → `Use 'x not in y'`；`not x is T` → `Use 'x is not T'`。
   检测点干净（binary 循环里 left 为 not-unary 即命中），正好接住刚落地的
   `not in` / `is not`（feae43e）。现状报错是不知所云的类型错误。

---

## 第 20 条 —— 比较链限同向

### 现状（实测）

`1 < 2 > 1` 合法，值 `true`。混向链是 Python 的知名混乱源（Python 因兼容无法
收紧），Vel 没有包袱。

### 目标语义

- 链内全部环节必须同向：全 `<`/`<=`，或全 `>`/`>=`。
- 混向（`a < b > c`）→ 诊断：`Comparison chains must point one way; split with 'and'`。
- `==`/`!=` 不参与链（`a == b == c` → 同款诊断）；实施者先核实当前 parser 的
  `comparisonOperators` 表是否已把相等排除在链外，按实际现状写回归。
- 同向链的既有语义（每操作数求值一次、事实沿链传播）不变。

---

## 第 21 条 —— 三处文档补缺

1. **setter 记入 deliberately-absent**：`get label()` 存在而 `set` 被 VEL2007 拒绝，
   但 charter §19 未列。补条目，理由：突变走显式方法；响应式字段不需要访问器。
   VEL2007 消息尾部追加 `use an explicit method to mutate`。
2. **`catch:` 免绑定合法但未记档**：charter §11 只展示 `catch error:`。补一句
   「绑定可省略」。
3. **本轮正面确认随文记录**（防止后人重查）：字符串 `<` 与 `sorted()` 为码点序，
   与语言码点承诺一致（U+E000 排 😀 前；JS 原生是码单元序，Vel 特意做对了 ——
   charter §7/§8 值得把这句「ordered comparison follows code points」写成成文
   契约）；enum 成员 `parse`/`is` 已有守卫（VEL4014）；`await` 误用诊断（VEL4007）
   定向清晰；`.5`/`5.` 拒绝合理。

---

## 第 22 条 —— 「`is` 测类型，`==`/`!=` 测值」：空值判断唯一拼写 `!= null`（已批准）

用户 2026-08-12 批准，并加码裁决：「写 `!=` 更简单」—— 指出 `is not null` 与
`!= null` 并存是新的双拼写问题。定案原则一句话：

> **`is` 测运行时类型，`==`/`!=` 测值 —— 而 `null` 是个值。**

- **空值判断唯一拼写**：`!= null` / `== null`。`x is null` / `x is not null` 成为
  移除拼写，**解析层**定向指引（必须在解析层：否则 `x is not null ? a : b` 先死在
  VEL2031 的 optional 类型混淆上，用户看不到指引），并恢复为等值比较继续编译。
- `x is not Error`、`x not in list` **不受影响** —— 类型测试与成员测试没有等值等价物，
  feae43e 的两个自然负形式保留。
- 条件诊断（VEL4001 truth 变体）的教学拼写从 `is not null` 改回 `!= null`；
  上一波迁到 `is not null` 的 145 处站点再迁到 `!= null`，9 处加括号的三元
  `(x is not null) ? …` 改为免括号的 `x != null ? …`（纯表达式文法，实测无需括号）。
- 溯源：最初裁决原话本就是「判断null需要执行 !=null」；中途经 `not null` 提案
  绕道 `is not null`，本条回归原点并把原则成文，防止第三次摇摆。

**残余（批次 F）**：非 null 类型的同款括号问题（`x is not Error ? a : b`）仍需
「`is` 目标禁 optional + 解析器不把 `?` 吃进 is 目标类型」的解析器修正 —— 该部分
维持已批准状态，随批次 F 实施。

---

## 批次编排（并入 D28/D29 全局序）

前置不变：**条件裁决批次**（进行中）先全绿。此后：

- **批次 A**（D28/D29 既定，不变）：`case _:` 唯一、撤 `invert`、`isInteger()`、
  位置参数收紧、丢弃纯结果报错。
- **批次 E（词法与字面量）**：第 18 条全部（分隔符、前导零、消息卫生、hex 与
  格式规格指引）。纯 lexer + 少量 f-string 解析，与 A 不同文件族，可紧随 A。
- **批次 F（语句与运算符）**：第 17 条（纯表达式语句）+ 第 19 条两指引 +
  第 20 条（链限同向）。动 parser/analyzer，排在 A 后。
- **批次 G（保留字软化，最大件）**：第 16 条。深改 parser 与 web 扩展 parser，
  依赖 A（match 兜底改动）与语句边界检查已稳定，**排全部编译器批次最后**。
- **批次 C（文档，D29 既定）追加**：第 19 条优先级表、第 21 条三项。
- **批次 B / D（D28/D29 既定）**：不变；D（示例清扫）仍最后。

每批次 `npm run check` → `npm test` → `npm run test:browser`。批次 G 结束后按惯例
复跑对抗搜捕的词法/解析维度，并加一轮「笔误语料」（漏运算符、`==`/`=` 互换、
粘连 token、保留字作绑定名）—— 这是七A节教训的直接落实。
