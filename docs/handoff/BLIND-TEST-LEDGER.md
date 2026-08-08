# 盲测账本（四期）

## 第四期：0.10.0 发版闸门（2026-08-09）

### 协议与范围

一位全新独立盲写者，不继承当前会话，不调用工具，不读取仓库、README、文档、示例或
测试；只知道稳定基础词汇 `const`/`let`、`type`、`def`、`component`、`state`、缩进块与
JSX。提交两个完整程序，真实 0.10 编译器逐轮裁判，每轮只回传原始诊断，最多三轮。

本期只测第三期后新增或改变的表面：字符串/数字方法链、双槽 `for`、`range`、Set/Map
集合构造、布局字符串（含三反引号围栏与插值）、深层 state 的 record/List/Map 直接突变。

### 结果：16 → 2 → 2，L=0

| 轮次 | Core | Web | 合计 | 结果 |
|---|---:|---:|---:|---|
| r1 | 9 | 7 | **16** | 方法链、Set/Map 构造、record/List 深层突变直觉命中；其余由诊断裁判 |
| r2 | 2 | 0 | **2** | Web 全过；双槽 `for` 直接写对；布局字符串进入正确模式但漏关闭引号 |
| r3 | 2 | 0 | **2** | 布局字符串关闭边界写对；仅剩盲猜的 `List.range` 两条级联 |

**官网证据数字：无文档 AI 首次编译错误数 = 16。** 口径是一位独立盲写者、两个覆盖
本期六个表面的完整程序、首轮真实编译器原始诊断总数；不得写成“首次编译通过”。

### 命中、收敛与分类

- 零文档首轮直接命中：`trim().lower().upper()`、`abs().round()`、`Set(List)`、
  `Map([[key, value]])`、嵌套 record 字段直接赋值、List 直接 `append`。数字方法的三条
  级联来自盲写者把循环变量命名为保留的 Core `number`，不是方法面缺失。
- 三引号收到“使用普通引号布局字符串”的定向诊断后，r2 正确进入布局模式；漏写关闭
  引号又收到“在 opening line 缩进处用引号关闭”的定向诊断，r3 正确收敛。最高风险的
  无先例语法因此通过可发现性闸门。
- Map 下标、List `.length`、`onClick`、`void` 都收到一个当前拼写的定向诊断，并在 r2
  全部自愈；Web 深层 state 程序从 r2 起为零诊断。
- `enumerate(...)` 只有 unknown-name 诊断，但盲写者在 r2 自行改成直接双槽
  `for value, index in values`。记 **D 轻**，不构成语言缺口。
- `range` 是显式 `velar/collections` 导入；r1 的裸 `range` 只有 unknown-name，r2/r3
  猜成 `List.range` 后仍未得到正确导入指引。记 **D**（标准模块位置不可发现），不是
  **L**：规范参考程序显式导入后零诊断并实际得到 `[0, 2, 4, 6, 8]`。
- 盲写者沿用 JS 的 `${...}`。它在普通或布局字符串中是合法文本，编译器不能在不误伤
  真实模板文本的前提下断言用户想插值；规范写法 `f"..."` 已由参考程序执行验证。记
  **D/上手文档证据**，不增加启发式编译错误。

规范参考程序使用同一真实编译器检查 Core/Web 均为零诊断，并实际输出：

````text
# 2 normalized words
```
Words: ALPHA, BETA
Numbers: 0:1, 1:3; evens=5; two=2
```
````

第四期确认 **L 类 0 条**；没有需要阻断 0.10.0 的语言能力缺陷。D 项进入官网上手内容与
后续证据 backlog，不在发版路上新增语法、别名或有误报风险的启发式。

## 前三期总判定

## 总判定

三期漏斗：残余诊断 151 → 40 → 23，且每层残余的「定向率」递增至 ~100%。
三位独立盲写者、九轮提交的完整证据链产出：
- **L 类共 1 条**（多行方法链缺失，D10 修复中）—— 语言设计以压倒性优势通过检验
- **D 类 ~20 条**，三个批次全部修复或修复中（4ab2c70、f31367c、批次 3）
- **标准库缺口 2 个**（字符串 API —— 批次 3 补齐；enter 键语义 —— 留证待议）
- **设计收紧 1 处**（D11：Look 字符串逃逸门）
- 直觉零成本命中面：泛型、enum、T?、?? / ?.、扩展运算、bind:value、key、
  look={value} 挂载、const look 值语义 —— 全部被至少一位盲写者零文档写对

结论：可发现性闭环（测→修→重测）已收敛，新未知不再涌现。批次 3 落地后
协议关闭，Lite S1 开工线达成。

## ★ L-1（全场首个确认的语言缺陷）：无多行方法链

`return tasks\n    .filter(...)\n    .map(...)` 无法编译（首点、尾点续行均不
支持，仅单行链可行）。已验证（chain.vel/chain2.vel/chain3.vel）。两位独立盲
写者本能使用；prettier 默认强制此风格；Lite 的集合操作将高频撞击。报错为非
定向裸 VEL2002。**决策 D10：支持首点续行（`.`/`?.` 开头的行延续上一逻辑行，
缩进语言下零歧义）**，三期结束后实施 + formatter 规范化 + charter 记录。

## 批次 3 候选（三期新发现）
- `#` 注释 → 裸 VEL1001，需指引 "Use '//'"（Python 高频直觉）
- 裸 JSX `for message in messages:`（无花括号）→ VEL2006 裸错，需与 VEL5049 同款指引
- Look 值裸词（flex/bold/none/pointer/auto）与复合值（1px solid #hex）→ VEL5038
  通用形态消息，可给「引号字符串 / border() 构建器」的具体指引
- `onInput={event => draft = event.value}` 型受控输入直觉 → 观察终轮 bind:value 收敛

## 终轮（r3）判定

- tasks 39 错 / helpers 32 错 / chat 40 错 —— 均未编译通过，≤3 轮全过 **未达成**
- `record`→`type` 字段块第三轮写对（靠裁判提示语，非诊断本身）；`fn`→`function`
  第三猜仍错（真答案 `def` 三轮零信号）；`render→show→view` 三连猜全错
- Look 大幅收敛：值加引号、`if own:`、组合、拆子组件全对；仍卡 kebab-case 属性、
  多值简写、hex 颜色
- L 类确认数：**0**（≤5 达成）；引导型诊断一轮自愈率≈100%，无指引关键词自愈率 0%

## 修复包（第一期产出 → 交 ops 实施）

1. 词表扩充：fn/function/func→def；record/struct/interface→type；with→记录展开
2. 结构性修复：语句头 `IDENT IDENT(:|()` 模式优先报「未知声明关键词」而非表达式级联
3. web 扩展：render:/show:/view: 块 → 「component 直接 return JSX」；bind={}→bind:value；
   onClick/onEnter→on: 系（enter 语义查 web-api 后定）
4. Look：kebab-case → camelCase 指引；`look name:` → const 值指引；多值简写 → spacing()；
   hex 字符串颜色行为核实后给指引
5. 语义层：{} 对 Map 契约 → Map()；map[k]=v → .set；Task(id=…) 类型对象调用 → 字面量指引；
   字符串 API（trim/toUpperCase/[0]）现状核实 + 指引
6. 设计维持不动：def/type/look 值语义/camelCase/引号关键词 —— 证据显示诊断到位即一轮自愈

## 第二期：修复落地后换新盲写者重测，轮计数清零

### 二期 r1（1+1+63 诊断）
新写手直觉分布偏 Python（`[Task]` 注解、`x if c else y`、`none`、`not in`），
但 `T?` 与 `on:click` 一次写对。新指引全面命中：type/def/render→return/with 替代。

### 二期 r2（11+7+32 诊断）
一轮吸收全部 r1 指引（def/type/记录展开/return JSX/look 条目形态）。剩余：
| # | 现象 | 分类 | 处置 |
|---|---|---|---|
| 20 | 裸 hex 颜色 `#f0f0f0` → `'#'` 词法错 + 「Unknown numeric unit 'f6'」误导 | D | 加词法指引：引号字符串或颜色构建器 |
| 21 | Python 条件式 `x if c else y` → 裸 VEL2002/2001 级联 | D | charter 明确排除该形态 → 加「Use c ? x : y」指引 |
| 22 | JSX 内 `{for m in messages: ...}` → VEL2006 裸错 | D | 加「Use messages.map(...)」指引（charter：无魔法 JSX 控制流）|
| 23 | `Task[]` 后缀数组注解 → VEL2012 措辞是「泛型实参用 <>」，未直接给 `List<Task>` | D轻 | 措辞可优化为直接拼出 List<T>；看 r3 收敛情况 |
| 24 | camelCase/spacing() 新指引整排命中，写手预期一轮自愈 | ✓ | 修复包成效验证 |

分类：L=语言缺陷 · D=可发现性缺陷（诊断没把人引到正确写法）· N=正常成本

## 第一轮（提交 → 12 诊断实际 + chat 63 级联）

盲写者直觉命中（零成本项，值得记录）：
- 泛型语法 `<T, U>`、箭头函数、`?.`/`??`、扩展运算 `[...xs, x]`、`bind:value`、
  `key={...}`、`state x: T = v`、缩进块、`-> 返回类型`、`enum Priority:` 全部直觉正确
- `enum` 声明形态与 VelarScript 完全一致（一次写对）

| # | 现象 | 分类 | 处置 |
|---|---|---|---|
| 1 | `var` → VEL1005 定向指引 let/const | N | 诊断自愈，无动作 |
| 2 | `&&`/`!`/`None` → 定向指引 and/not/null | N | 同上 |
| 3 | `boolean` → VEL2012 指引 bool | N | 同上 |
| 4 | `with {…}` 记录更新表达式 → 只说 "does not expose 'with'"，**没给替代写法** | D | 指引应补 "use a record spread: {...value, field: next}" |
| 5 | `record X:` → chat 里是裸 VEL2002 级联 ×5，**无指引** | D | 补 VEL1005 级指引 "Use 'type'"（charter 承诺常见错拼给直接指引）|
| 6 | `fn` → 完全静默（被词法阶段门控 or 解析当普通标识符）| D | 待第二轮确认后补指引 "Use 'def'" |
| 7 | `render:` 块 → 裸 VEL2003 | D | 待观察第二轮能否自愈；否则补指引（component 直接 return JSX）|
| 8 | look 写成 CSS 类选择器风格（29×VEL5038）| D? | VEL5038 说了合法形态但没说「look 是值、按元素挂 look={…}、无选择器」；观察第二轮 |
| 9 | 词法指引错误门控解析层 → 修完一批才见下一批，费轮次 | D(架构) | 候选：guidance 错误不阻断解析（需评估）|
| 10 | `Task(id: "...", ...)` 记录当构造函数调用 + `id:` 具名实参用冒号 | 待定 | VelarScript 记录字面量 `{...}`、具名参数用 `=`；第二轮看诊断如何引导 |
| 11 | `"t{...}"` 插值不带 f 前缀 | 待定 | 第二轮看是否有指引 |
| 12 | `.length`（List/string）、`.trim()`/`.toUpperCase()`、`w[0]` 字符串索引 | 待定 | 语义层诊断还没跑到；VelarScript 是 size/…；关注 API 直觉差距 |

## 第二轮（43+32+43 诊断）

自愈成功：`and/not/let/null/bool` 全修正；`Option<T>` → `T | null`（正中设计）；
从 Look 诊断的 `property = value` 反推出具名实参 `=`（歪打正着蒙对了 VelarScript）。
Look 形态大幅收敛：`property = value`、`if own:`、`@target:`、`...bubble` 组合全对。

| # | 现象 | 分类 | 处置 |
|---|---|---|---|
| 13 | `fn first<T>(...)` 按比较链解析 → 报错位置与真因无关（"Expected ')'" 在泛型尖括号处）；写手三轮无法发现该用 `def` | **D 重度** | 必修：`fn`/`function` → VEL1005 "Use 'def'" 指引 |
| 14 | `record Task(id: string)` 触发 VEL2024「具名实参用 = 不用 :」→ **反向误导**，把类型声明当成了调用来纠正 | **D 重度** | 必修：`record`/`interface`/`struct` → "Use 'type'" 指引；表达式位置的裸 `record` 词优先按错拼关键词报 |
| 15 | `look bubble:` 独立声明形态（vs `const bubble = look:`）| D | 诊断应给出 "Look is a value; write 'const bubble = look:'"；设计维持值语义 |
| 16 | `show:` / `render:` 块直觉持续（两轮换了两个词）| D | component 直接 `return <jsx>`；考虑对 `render:`/`show:` 给定向指引 |
| 17 | `@author:` 元素 id 作 Look target → VEL5038 明确说了「@ 是伪元素」| N | 诊断合格，观察第三轮自愈 |
| 18 | kebab-case Look 属性（`max-width`）→ VEL2005「赋值目标必须是名字/成员/索引」（把 `max-width` 当减法表达式）| D | camelCase 是设计决定；诊断应识别连字符属性名并指引 camelCase |
| 19 | 裸关键词值 `flex`/`white`、`#hex`、`8px 12px` 多值 → VEL1001 散错 | 待第三轮 | charter 设计如此（串引号/rgb()/spacing()）；看诊断能否引导 |

## 阶段性判断（第二轮末）

语言设计本身零 L 类确认 —— 所有卡点都是 D 类（诊断可发现性）。
最重的两条（13/14）都是「错拼关键词落入表达式解析产生误导性级联」这一同根问题：
词法指引词表需要扩充 fn/function/record/interface/struct/render/show/with-替代。
