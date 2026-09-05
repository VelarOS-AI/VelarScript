# D114：语言标准层完整性审计与代码重构评估（2026-09-05）

所有者 2026-09-05 提问：「该仓库是否需要重构一下代码，以及现在还有没有语言标准
层面设计的不合理的地方，先把语言标准层的问题和缺少的能力补齐然后再重构代码。」
本文是对这两问的审计结论。所有探针在 0.27.3（`0d8b7dc`）的已构建 `dist` 上以
`velar check` 实测，输出逐字引用；对姊妹仓（openvoxel 14,986 行、Website 13,948
行、Libraries 7,205 行、Desktop-Vel 12,763 行 `.vel`）的迁移面用 grep 计数。

## 结论

1. **语言标准层不是「设计得不合理」，是「裁决过的没做完」。** 两条已有裁决尚未
   落地（D77 第 194 条上下文泛型推断 → 泛型类；D35 开放子决策 `velar/collections`
   方法化），一族规则 3 双拼写（`velar/collections` 十二个函数与 List 方法逐一
   重合，`Function<...>` 与箭头函数类型重合）从未被清点，`@iterate:` 的 2×2 形态
   表缺一格且宪章未明写为什么。真正「缺少的能力」只有泛型类一项，其余是拼写
   统一与教学诊断。
2. **代码需要重构，且是结构性拆分而不是重写。** 语义层是健康的（2,548 个测试，
   四道门禁，`buildId` 决定性）；不健康的是形状：Core 分析器 15,892 行一个类、
   427 个方法、145 个状态字段、59 张按 span 键控的降级侧表；测试的 68% 挂在按
   「波次」命名的 83 个文件里且默认门禁不跑。
3. **顺序按所有者说的：标准层先，重构后。** 理由不只是听话——标准层的每一项都
   改 `analyzer.ts`/`emitter.ts`/`parser.ts`，正是要拆的文件；先拆后改会让每个
   波次与拆分互相打架，先改后拆则让新代码一次落进它最终的家。

---

## 第一部分：语言标准层

分类沿用 COMPLETENESS-AUDITS 的词：**已裁决未建** / **已记录未执行** /
**双拼写**（规则 3）/ **边界未成文** / **教学缺口** / **文档与代码不一致**。
每条标明是否需要所有者裁决；不需要的按 [[vel-marathon-protocol]] 直接做。

### S1 — 上下文泛型推断（已裁决未建，D77 第 194 条，所有者裁决）

三处位置全部实测被拒，且是同一条 VEL4001：

```text
def empty<T>() -> List<T>:
    return []

const names: List<string> = empty()          → VEL4001 Cannot assign List<unknown> to List<string>
def use(values: List<string>) -> number ...
use(empty())                                  → VEL4001 Cannot assign List<unknown> to List<string>
def names() -> List<string>:
    return empty()                            → VEL4001 Cannot assign List<unknown> to List<string>
```

宪章 §7 今天写的是「A parameter the call leaves unsolved becomes `unknown`」。
D77 第 194 条留给实施者的唯一问题是**期望类型传播到多远**。

**建议（待裁决 ①）**：传播集合 = §8 空集合规则已经枚举的「上下文类型位置」——
带注解的绑定、实参位、返回位、带注解的记录字段、`state`、JSX 属性位（Web）。
一个概念一个定义：「什么是上下文类型」在两条规则里必须是同一张表，否则
`const xs: List<string> = []` 通过而 `= empty()` 不通过这种断层会换个地方再出现。
D77 点名的风险（TypeScript 式的「错误更晚更难懂」）用一条纪律封住：期望类型
**只播种未解的参数**，永不覆盖由实参解出的参数；两者冲突时在调用处同时报出
两个类型，而不是让期望类型赢。

### S2 — 泛型类（已裁决未建，D55 第 120 条推迟，D77 第 194 条定案）

```text
class Stack<T>:                               → VEL2025 Class 'Stack' cannot declare type parameters;
                                                'def' functions and 'type' records take '<T>'
```

三条定案已在 D77：泛型类**不变**；`is Stack<number>` **拒绝**（复用 VEL4022 措辞族）；
`Stack<number>()` 的拼写靠 S1 的注解流入。**不需要新裁决**，只需要 S1 先落地。
落地后宪章 §5「generic `class` and `component` declarations are not part of the
language」改为只排除 `component`（D55 第 120 条层三永久排除不变）。

### S3 — `velar/collections` 与 List 方法的双拼写（已记录未执行 + 双拼写）

D17 把字符串/数字全部方法化并撤销了 `velar/text`；D35 开放子决策写明
「velar/collections 除 `range` 外的存留函数归属：**方法化归 List**；enumerate 已被
双槽 for 取代，直接退役给指引」。三周后：

```text
import {find, first, last, sum, sortBy, has, index, count, some, every, join, reversed} from "velar/collections"
… 十二个函数与 values.find / .get(0) / .get(-1) / .sum() / .sorted(by=) / .has / .index /
  .count / .some / .every / .join / .reversed 并排调用           → Checked 1 module（零诊断）

import {enumerate} from "velar/collections"
for entry in enumerate(names): …                                → Checked 1 module（零诊断）
```

而根 `AGENTS.md` 第 48 行写着 `enumerate(xs)` → **error**。这正是 AGENTS.md
自己点名的「一个概念，两个定义」：文档说它是错误，编译器说它合法。

按规则 3 清点 27 个导出，判据是「List 已经拥有同一契约的方法」：

| 判定 | 导出 | 说明 |
|---|---|---|
| 精确重复，退役 | `find` `index` `has` `count` `some` `every` `sum` `join` `reversed` | 与同名 List 方法契约逐字相同 |
| 近似重复，退役 | `first` `last` `take` `drop` | 即 `get(0)` `get(-1)` `slice(0, n)` `slice(n)`；文档自己已写「direct positional windows normally use `List.slice`」 |
| 已裁决退役 | `enumerate` | D35；双槽 `for` 是唯一拼写 |
| 选择器家族未完整 | `sortBy` `minBy` `maxBy` | List 有 `sorted(by=)` 却没有 `min(by=)` `max(by=)`，也没有降序；这三个函数活着是因为方法侧缺了三格 |
| 无方法等价物 | `zip` `chunk` `flatten` `unique` `compact` `partition` `groupBy` `keyBy` `countBy` `repeat` | 归属待裁决 |

**建议（待裁决 ②）**：走 D35 写下的方向到底——(A) 全部方法化归 List
（`values.unique()`、`values.groupBy(key)`、`values.zip(other)` …），`velar/collections`
随之消失（与 D17 对 `velar/text` 的处理同一条纪律），`range` 仍是前奏名；同时补齐
选择器家族 `min(by=)`、`max(by=)`、`sorted(by=, descending=)`，`sortBy/minBy/maxBy`
随之退役。备选 (B) 只退役上表前三行，保留 itertools 血统的函数（D52 第 115 条
的口径）。我推荐 (A)：D17 的盲测证据是「每个写手本能写 `.trim()`」，没有理由认为
`.unique()` 会不同；(B) 留下「有的集合操作打点、有的不打点」这条读者要记的线。
迁移面：姊妹仓 7 个文件导入该模块（`groupBy`×6、`sum`×4、`sortBy`×4、`enumerate`×4
居前），精确重复项全部可由 `velar fix` 机械改写。

### S4 — `Function<...>` 是箭头函数类型的第二拼写（双拼写，无裁决记录）

宪章 §5 把 `Function<Input..., Result>` 称为「bounded convenience spelling」，
但 `Function<number, string>` 与 `(number) -> string` 是**同一个类型的两种写法**，
Website 的类型页甚至专门展示「两种写法互相赋值」。D 系列没有任何一条为它给出
理由——它是 D28 之前留下的、从未被清点的双拼写。用量：姊妹仓 5 处，本仓
tour/测试/文档 17 处。

**建议（待裁决 ③）**：整族退役（含裸 `Function`），函数类型只剩 `(A) -> R`，
`velar fix` 机械改写。裸 `Promise` = `Promise<null>` 不在此列：它是缺省实参，
不是第二套语法。

### S5 — `@iterate:` 的 2×2 表缺一格，宪章未写为什么（边界未成文）

```text
class Counter:
    @iterate:
        self.current += 1
        return self.current <= 3 ? self.current : null

for value in Counter():   → VEL4001 Cannot iterate over Counter; '@iterate' on this class is the
                            asynchronous pull form, which 'async for' drives — use 'async for',
                            or answer a List, Set, Map, or Record to iterate here
```

同步 × 集合 ✓、异步 × 拉取 ✓、同步 × 拉取 ✗。语言自己已经付过一次这格的代价：
D99 为 Map 单独造了 `iterator()` 游标，因为物化 `keys()` 太贵——那是编译器拥有的
同步惰性序列，而作者的类没有同一件东西的拼写。按 [[vel-design-completeness-not-accretion]]，
边界内的空格要么填、要么写明为什么不填。

**建议（待裁决 ④）**：**明写排除**。理由写进 §10：同步拉取以 `T?` 回答会让 `null`
不能是元素（异步形态已接受这一代价，但那里没有集合可选）；应用层里一个惰性的
同步序列要么装得下一个 List，要么已经是在流式读取——那是异步的。再开条件：
出现一个真实站点，其序列装不下 List 且不是异步来源。若所有者反而想填这格，
判别子必须换成显式的 `async @iterate:` / `@iterate:`，因为今天靠回答类型区分两形态。

### S6 — 异构 List 当元组用，没有教学（教学缺口，A 名册候选）

```text
const pair = ["a", 1]
const [name, count] = pair
print(name.upper())      → VEL4001 string | number has no common field 'upper'
print(str(count + 1))    → VEL4001 Cannot assign string | number to number

def locate(text: string) -> List<string | number>:
    return [text.upper(), text.size]
const [upper, size] = locate("ab")                 → Checked 1 module（零诊断，两个绑定都是 string | number）
```

Python 的 `return a, b` 和 JS 的 `return [a, b]` 都是父母的反射；Vel 的答案是记录
`{name, count}`（更好，字段有名字），但今天写错的人只在下游三行外撞到
「no common field」，写对类型标注的人根本不会被提醒。这是 D89 名册的准入形状：
父母反射被接受为另一个含义，且有明确的改写。改写要发明字段名，所以**不带机械修复**
（A7 同例）。

**建议（待裁决 ⑤）**：立 **A16**——在 List 字面量的元素静态类型两两不相交、且该
字面量处于 `return` 位或被定长解构时报出，命名记录拼写。姊妹仓实测零处
`const [a, b] =` 定长解构，说明写手已在用记录；A16 是给下一个模型的教学，不是修
既有代码。

### S7 — 类实例 vs 结构记录契约：裁决已定，诊断不教惯用法（教学缺口，实现层）

```text
type Closer:
    close: () -> null
class Terminal:
    def close(): …
shutdown(Terminal())                       → VEL4001 Cannot assign Terminal to Closer
shutdown({close: terminal.close})          → Checked 1 module
```

§12「类实例永不满足记录契约」是对的，§10「类名不是值、行为以函数值传递」也是对的，
两者合起来的惯用法——**绑定方法记录**——宪章没写，诊断也不教。**不需要裁决**：
VEL4001 在「类实例遇到全函数字段的记录类型且方法同名」时点名 `{close: value.close}`
拼写；§10 加一段。

### S8 — 文档与代码不一致（实现层，直接修）

- 根 `AGENTS.md` 第 48 行 `enumerate(xs)` → error，编译器接受（随 S3 一并对齐）。
- `docs/decisions/README.md` D41 一行写「the removal of `pop` as a duplicate of
  `removeLast`」，实际裁决相反（D41 第 62 条：`pop` 严格化并删除 `removeLast`）。
- D35 的开放子决策没有指针指向执行状态；S3 落地后在 D35 末尾加一行指向本文。
- 宪章 §5/§7 关于泛型类与「unsolved → unknown」两句随 S1/S2 改写。

### S9 — 看过、暂不立项的能力（记录判断，免得重议）

- **数字的本地化格式化**（千分位/货币/百分比）：`velar/time.format` 有时间的一半，
  数字没有对应物。姊妹仓四个项目零处 reach-through 证据。类别是否存在由证据决定
  （[[vel-design-completeness-not-accretion]] 的例外正是这一条），暂不立项。
- **`Bytes` 与 base64/hex 文本互转**：D83 的边界内没有文本编解码；openvoxel 只在
  字符串层检查 `data:image/png;base64,` 前缀。同上，等证据。
- **端到端类型的服务端调用**（web → `server` 路由）：D34 A2 车道，不是标准层缺陷；
  阶段门未过，不在本文范围。

### 待裁决清单（所有者）

| # | 问题 | 我的建议 |
|---|---|---|
| ① | S1 期望类型传播到哪些位置 | 与 §8 空集合规则同一张表；只播种未解参数 |
| ② | S3 `velar/collections` 走 (A) 全部方法化并撤销模块，还是 (B) 只退役重复项 | (A)，并补齐 `min(by=)` `max(by=)` `sorted(by=, descending=)` |
| ③ | S4 `Function<...>` 整族退役 | 退役，只留 `(A) -> R` |
| ④ | S5 同步拉取形态：明写排除，还是填格 | 明写排除，写再开条件 |
| ⑤ | S6 是否立 A16 | 立，不带机械修复 |

S2、S7、S8 不需要裁决。①② 定下后 S1→S2 与 S3 可以并行两波；③④⑤ 各自独立。
本轮全部落地后 `core` 表面号至少 +1（D110）。

---

## 第二部分：代码重构评估

### 实测形状

| 位置 | 数字 | 说明 |
|---|---|---|
| `packages/compiler/src/analyzer.ts` | 15,892 行 / 1 个类 / 427 个方法 / 145 个状态字段 | `analyzeStatement` 1,023 行、`file` 634、`inferCollectionCall` 610、`inferExpressionType` 571、`inferIntrinsicCall` 438、`inferMember` 385、`inferCall` 372、构造函数 307 |
| `LoweringHints` | 59 张侧表 | 分析器→发射器的全部契约，按 span 身份字符串键控 |
| 60 天提交热度 | analyzer 136 次、emitter 87、parser 78、web/analyzer 66 | 最常改的文件正是最大的文件 |
| Core 模块环 | analyzer ↔ emitter ↔ extension ↔ parser ↔ lexer | `extension.ts` 既是协议类型又 re-export 三个类的值；`emitter.ts` 从 `analyzer.ts` 取值常量 |
| `packages/web/src/analyzer.ts` | 4,745 行 | 一个 515 行的内联 `walk` 闭包 |
| `packages/node/src/serve-runtime.ts` | 4,228 行 | 362 个顶层声明一个文件 |
| `packages/core/src/index.ts` | 3,544 行 | 十余个 `velar/*` 模块的接口表 + 运行时 JS 源码字符串同文件 |
| `stable-order.ts` | 三份逐字相同的实现 | compiler / web / desktop 各一份，只有注释不同 |
| 测试 | 2,548 个 `test()`，200 个文件 | `compiler.test.ts` 29,911 行 / 530 个测试；83 个 `hardening-<波次>` 文件承载 1,734 个测试（68%），本地默认 `npm test` 不跑它们（只跑 7 个 closeout），只有 CI 的 `test:full` 才跑；48 个文件各自重定义 `run`/`compile`/`messages`/`executeModule` |

### 判断

**需要重构，性质是结构性拆分，语义零变化。** 不是重写：语言语义、扩展协议、
运行时 ABI 都是对的，且被 2,548 个测试和 `buildId` 决定性钉住——这恰恰给了拆分
一条比测试更强的验收：**tour 与 examples 全部编译产物字节一致**。

三条边界纪律沿用现状：Core 不认识任何目标名（规则 5）；`protected` 缝（Analyzer
64 处、Parser 43、Emitter 32）是 Web/Node 子类的依赖面，拆分只能保持签名；每段
「D 编号 / 审计编号」溯源注释随代码搬家，不删。

### 计划（实现层，我定；每片单独过四门）

| 片 | 内容 | 验收 |
|---|---|---|
| R0 | 干净 worktree 基线：四门时长、测试数、dist 字节、tour/examples 产物哈希 | 数字入 archive 账本 |
| R1 | Core：`analyzer.ts` 按领域拆为协作对象（流事实与收窄、类型声明与泛型、类、调用与具名实参、集合操作、成员、模块接口、A 名册、`LoweringHints` 记录器、常驻词汇）；`emitter.ts` 拆出运行时导入装配与按族发射；`parser.ts` 按语句族拆；抽出 `contracts.ts` 打断五模块环 | 四门绿 + 产物哈希不变 + `protected` 签名不变 |
| R2 | `packages/core/src/index.ts` 按 `velar/*` 模块拆：接口表与运行时源码分文件 | 同上 |
| R3 | Web：`analyzer.ts` 抽出 Look 分析；`runtime.ts`（3,755 行）按调度/DOM/组件生命周期/HTTP/存储拆 | 同上 + 浏览器门 |
| R4 | Node `serve-runtime.ts`、CLI `project.ts`（`compileProjectEntries` 560 行） | 同上 |
| R5 | 测试：`tests/support/` 共享助手；83 个 `hardening-*` 按主题并入命名套件并进入本地默认 `npm test`（今天只有 CI 的 `test:full` 覆盖它们）；`compiler.test.ts` 按主题拆。测试体逐字搬移，计数只增不减 | 2,548+ 全绿；默认门禁跑全部 |
| R6 | `docs/contributing/compiler-architecture.md` 与各 `AGENTS.md` 指向新布局；三份 `stable-order.ts` 归一 | `check:docs` 绿 |

**排期**：R0 随时可做（只测量）；R1–R6 在第一部分全部落地并发版之后开始。

### 本文的出身

审计由本会话（编排）完成，未派实施代理；探针文件在会话草稿目录，不入仓。
所有者对待裁决清单的回答将追加为本文「第 X 条 —— 定案」一节，而不是另开记录。

---

## 定案（所有者 2026-09-05：「可以，按照你的决策来」）

| # | 定案 |
|---|---|
| ① | 期望类型传播集 = §8 空集合规则的上下文类型位置（带注解的绑定、实参位、返回位、带注解的记录字段、`state`、JSX 属性位）；只播种未解的类型参数，实参解出的参数永不被覆盖，冲突在调用处按普通不匹配报出 |
| ② | `velar/collections` 走 (A)：全部方法化归 List，模块撤销，`range` 仍是前奏名；补齐 `min(by=)`、`max(by=)`、`sorted(by=, descending=)` |
| ③ | `Function<...>` 整族退役（含裸 `Function`），函数类型只剩 `(A) -> R`；裸 `Promise` 不变 |
| ④ | 同步拉取形态明写排除，写再开条件 |
| ⑤ | 立 A16，不带机械修复 |

所有者对①–⑤整体照准。以下是从这五条推出的实施层细则，由编排会话决定，写在这里
是为了可见，不是为了再问：

- **S2 构造时类型参数未解是错误**，与 §8「空集合在自己的位置定型」同一姿态：
  `const stack = Stack()` 无实参无注解时在构造处报错并点名注解拼写；`is Stack` /
  `case Stack` 裸名合法（运行时就是 `instanceof`），`is Stack<number>` 拒绝；类型位
  裸 `Stack` 与裸 `Box` 同规则（缺元数）；静态成员不得引用类的类型参数。
- **S3 的三个拼写细节**：`List.repeat(count)` 重复整个 List `count` 次（与
  `string.repeat` 同义，`repeat(v, n)` 机械改写为 `[v].repeat(n)`）；`descending=`
  只与默认序或 `by=` 同用，与比较器同用拒绝（比较器已经说明了顺序）；`enumerate`
  退役为纯指引诊断，不带机械修复（`{index, value}` 记录的消费点不可机械改写）。
- **S6 A16 的准入收窄到原始类别**：元素静态类型落在 string / number / bool / enum
  至少两个不同类别，且字面量所在位置**没有**上下文元素类型（未注解绑定、体推断的
  `return`、箭头体）；`null` 元素不计（`["a", null]` 是 `List<string?>`），记录元素
  不参与（异构记录列表是真实数据形状，D89 的近零误报门槛不允许猜）。
- **波次布局**：三个并行 worktree——S1→S2 串行一支，S3 一支，S4+S5+S6+S7 一支；
  每支各自过四门；编排会话合并、在干净 worktree 复验、统一把 `core` 表面号提到
  `0.5`（各支若门禁要求可先各自提到 0.5，合并时归一）、写 CHANGELOG、发版。
  姊妹仓迁移在发版后用 `velar fix` 跑，单独成波。S8 的两处文档由编排会话直接修。

### 波次上报后的实施裁决（编排会话，2026-09-05）

- **S1 上报 A：`await` 吞掉了位置。** `const rows: List<string> = await loadAll(url)` 仍报
  `List<unknown>`，因为一元表达式不传上下文类型。裁决：前缀包装子对位置**透明**——
  `await` 把 `Promise<期望类型>` 传给被等待的调用，`try` 传非可选部分，括号本就透明。
  这不是给 §8 的表加位置，是同一个位置穿过包装子；随 S2 波落地，宪章 §7 一句话。
- **S1 上报 B：两处顺序限制**（后置实参解参数、箭头体产出 `unknown`）——保持现状，
  与 `[]` 在同一位置的行为一致；有真实站点再议。
- **S1 上报 C：VEL4031 主语换成「the expected type solves it to …」** ——采纳，
  同一句式、真实主语。
- **S4 上报：表面摘要看不见拼写退役与 A 名册**（`check:surface-versions` 未变红），
  `core` 提到 0.5 由编排会话在合并时手动完成；是否把退役拼写与 A 名册纳入摘要
  另立小项，不在本轮。
- **S4 上报：`type List = string`、`type Function:` 被静默接受再被忽略，而 `type Promise`
  被 VEL3007 拒绝** ——「修了例子、类没关」的形状。裁决：内建类型名名册整体不得被
  用户 `type`/`class`/`enum`/类型参数/导入别名重声明，VEL3007 一族一条消息；已派
  跟进波（S4b）在同一分支关闭。
- **S4b 上报（内建类型名重声明）**：五个位置（`type`/别名/`class`/`enum`/导入别名与同名导入）
  全部按 VEL3007 一条消息拒绝，`velar/*` 模块以本名再发布内建名（`velar/look` 的 `Duration`）
  不算重声明。四条留门如实记下：`extern class` 以内建名声明**不拒**——extern 契约名必须等于
  外来导出名，而 JS 包真的导出 `Map`/`Set`/`Type`，拒了就无法描述；Web 模块里 `type Duration:`
  双报（VEL5065 + VEL3007，两句都真）；`type null:` 只有解析器的关键字恢复消息；`readonly`
  在证据名册里但不是类型名，`type readonly:` 仍被接受后不可用。`builtinTypeNames` 不在表面
  摘要的哈希表里，与上一条同一缺口。
- **S3 上报**：(a) `List.join` 原本没有模块版 `join` 承诺的 16 MiB 输出上界——D114 表里
  「逐字相同」写错了；退役时补上上界，确认。(b) 逐名的 import 修复无法收敛（同一 import
  语句一个 span），改为同一行所有可机械迁移的名字共享一份编辑表，一趟完成——采纳，与
  常驻命名空间导入退役的先例一致。(c) `sorted(by=)` 是唯一不带 index 的元素回调——裁决：
  补齐，List 的元素回调一律 `(value, index)`，无例外（S3b）。(d) 回调型 List 方法经
  一等绑定或 `?.` 接收者调用时全部被拒（`const keep = values.filter; keep(v => v > 1)`），
  以及 `optional?.copy()` 类型丢掉可选——D113 之前就有的实现缺陷，宪章的承诺没被代码
  兑现；S3b 修。(e) `standard-library.md` 里的退役叙事删掉，参考文档不是迁移指南。
- **编号更正**：Codex 会话发布的 0.27.4（`8632dc2`）已把 **A16** 给了 CSS `filter` 字符串的
  规范形建议，本文 S6/⑤ 的元组建议因此以 **A17** 落地；文中写 A16 之处按时间读，代码与
  宪章以 A17 为准。同一原因，本轮发版为 0.28.0、`core@0.6`（0.27.4 已用掉 0.5）。

---

## W：`watch` 死循环防护（所有者 2026-09-05「顺便看一下 … 一起处理一下」）

审计结论：同步环有两层闸门——每次 flush 100,000 次观察者运行的预算（溢出停掉重入最多者并
点名 watch 与组件，R21 测试钉住）与单观察者 100 次自失效上限（computed / watch / render 三种，
P2b-9 报出写入路径）；编译期有 D69 死 watch、主题是计算、调用 computed 三条拒绝。互写形状的
编译期拒绝是 D90 R21 所有者撤销的，运行时预算是其唯一闸门，有意为之。两处缺口与裁决：

- **B（编译期）**：`watch count: count = count + 1`——watch 体顶层、无条件、直接写自己的主题
  路径（含复合赋值与对主题集合的变更方法调用）是可证的死环，今天编译干净、跑到 100 次才报。
  裁决：**错误**（不是建议）——它不是「被接受为另一含义的拼写」，是编译期可证的 bug。
  只认顶层无条件语句；`if`/`match`/循环/`try`/闭包内的写不算。
- **A（异步环）**：`watch profile.value: detach profile.reload()`、`watch items: detach save()`
  （`save` 在 `await` 后写回 `items`）——每次写都是新 flush、新预算，环跨过 `await` 无限转、无报告。
  裁决两半：**A1 运行时**——预算按**任务**计而不是按 flush：flush 结束时挂一个宏任务哨兵，
  哨兵触发前开始的下一次 flush 属于同一条链，共享 token 与运行计数（沿用溢出时的 token 传递
  机制）；纯微任务的异步环因此被同一预算兜住，报告点名同一批 watch。宏任务边界（网络、计时器）
  之后重置——一个每帧写状态的动画不会被误停。**A2 编译期**——两个真实形状按近零误报做成错误：
  (a) watch 的主题是某 `resource` 的 `value`/`loading`/`ready`/`error`，体内无条件调用（直接或
  经 `detach`）同一 resource 的 `reload()`；(b) watch 无条件 `detach`/调用**同模块**的 `action`
  或 `async def`，而该函数体顶层无条件赋值被 watch 的绑定。单跳、同模块、无条件；其余保持
  运行时兜底。跨网络的异步环在运行时仍不可判定，这一点写进 web-api。
- 落点：Web 扩展（analyzer / runtime-foundation / emitter），charter §15 与 web-api 各一句；
  新测试文件；`web` 表面号是否变动由门禁决定。作为波 W 从集成分支分出，合并回集成分支。
- **S2 上报**：泛型类按 D55 第 121 条的机制向外推一层——实例化以 `genericApplicationIdentity`
  注册、基类键已是实例化后的键，`isSubclassOf` 沿键走即可携带实参，不需要另一张实参表；类成员
  的类型参数索引布局为「成员自身 0..M-1、类的在其上」。三条待裁决：(a) 自引用只认位置一致
  （`Pair<B, A>` 拒绝），记录与类同一条规则，保持；(b) 重命名导入的显示文本以首次拼写为准
  （记录今天同样如此），保持；(c) `namespace.Generic<T>` 在类型位不解析——记录与类共有的解析器
  缺口，另立小项，本轮不做。`await`/`try` 透明一并落地；`resource` 初始化式本就不写 `await`，
  无需处理。
- **S3b 上报**：(a) `sorted(by=)` 改走与 `min/max` 同一条 `inferListCallback`，index 是排序前
  快照位置；(b) 「声明参数少于契约的函数可赋值，只要它要求的不多于契约传的」立为通用可赋值性
  规则（不是 List 特例），成员契约如实写出运行时传的两个参数，一等绑定与 `?.` 接收者调用
  自此可用；(c) `optional?.copy()` 丢可选**不成立**——58 个形状全部返回可选类型，S3 看到的是
  初始化式处的流收窄，测试钉住契约即可；(d) `reduce` 的 combine 是唯一还没有 index 的元素回调
  ——裁决：补成 `(accumulator, value, index)`（S3c），比较器 `(left, right)` 不动；(e) 一等绑定
  与 `?.` 经过的回调型成员丢掉回调结果类型（`values?.map(v => v)` 是 `List<unknown>`）——成员
  契约非泛型所致，宪章只承诺接收者被捕获，留作后续设计项，本轮不做。
- **S3c 上报**：`reduce` 的 combine 补成 `(accumulator, value, index)`；顺带把 `reduce` 的公开
  成员契约做成对累加器泛型（此前一等绑定与 `?.` 形态答 `unknown` 并级联报错，是波前就有的
  缺陷）。审计全部回调调用点：除比较器外无遗漏。
- **W 上报**：三条新诊断 VEL5077（自写主题）、VEL5078（watch 某 resource 的字段却 reload 它）、
  VEL5079（无条件启动同模块写回者），VEL5076 是退役码不复用。A1 按任务计预算落地后发现波及面
  比裁决意图宽：一个任务内不间断做 100,000 次以上观察者运行的程序（基准测试的 `@main`、按行写
  进度的批量导入循环）没有环也会被停。裁决（W2）：**任务窗口只在观察者启动了异步工作时跨 flush
  延续**——`detach` 在观察者运行中执行、或 `action` 从观察者体内被调用时在窗口上记一笔；没有这
  笔的 flush 链按 W 之前的每 flush 计。基准测试的适配回退以证明批量工作不受影响，动画用例保持。
  `watch n: n = 5` 这种会收敛的自写同样被拒——所有者点名了 `=`，措辞软化为「每次运行都重新触发，
  运行时在 100 轮后停掉」。tour 的 web/03 按 D69/D90 R15 惯例加三行被拒形状注释。`web` 表面摘要
  未变（0.12）。

---

## R0 定案与实施记录（2026-09-05）

- 基线账本 `docs/decisions/archive/REFACTOR-BASELINE-2026-09-05.md` 与指纹清单
  `…fingerprint.txt`（828 个产物文件，摘要 `9aca6f25…`）是 R1–R6 的验收依据；工具是
  `npm run fingerprint -- --compare <清单>`。**本文第二部分的数字以该账本为准**：审计时
  （0.27.3）analyzer.ts 15,892 行 / 427 方法 / 145 字段，S 波落地后（0.28.0）17,485 / 470 / 190；
  审计表里「`file` 634 行」是我把 `NearestNameRoster.file` 误算进 Analyzer，作废；
  「web/analyzer 515 行内联 walk」在 0.28.0 已不存在；serve-runtime / web runtime / core index
  的行数大半是模板字符串里的运行时 JS，账本对 TS 与内嵌 JS 分别计数。
- 指纹工具上报：开了 `build.sourceMaps` 的两个项目（examples/app、tests/fixtures/web-capabilities）
  的 source map `sources` 记录的是从**输出目录**到源文件的相对路径，输出目录在 checkout 之外时
  会把 checkout 的绝对路径写进去，34/828 行随 checkout 位置变化；构建进项目自身 outDir 时稳定，
  `buildId` 仍是内容派生。裁决：**不是缺陷**，属于 source map 的固有语义；R1–R6 一律在同一
  绝对路径的 worktree（`/private/tmp/velar-d114/r0-baseline`）上比对指纹。
- R1 分片执行：一个 worktree、一条分支 `refactor/r1-compiler-split`，按内聚簇逐片搬移
  （降级侧表记录器 → A 名册建议 → 集合推断 → 调用推断 → 流事实与收窄 → 类 → 模块接口 →
  发射器与解析器），每片：四门 + `test:full` + 指纹逐字节一致 + `protected` 缝签名与
  `@velarscript/compiler` 导出清单不变。`analyzer.ts` 保留为门面模块，原有导出原样可导入。
