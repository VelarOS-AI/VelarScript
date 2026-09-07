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
## 0.28.0 表面审计（2026-09-05，账本 `archive/COMPLETENESS-AUDIT-0.28.0-2026-09-05.md`）

约 165 探针：DEFECT 4、INCONSISTENT 9、CHARTER-DRIFT 2、UNDEFINED 4、DECIDED-AND-CORRECT
约 318 项。全部为实现层，无需所有者裁决；三条实施裁决记下：

- **H-D1 → VEL5077 覆盖深写**：`watch form: form.name = …`、`watch items: items[0].done = …`
  与 `items.append(…)` 同为「写自己的主题」——§15 说 watch 对深层变更也触发，所以以主题路径
  为前缀的无条件写同样拒绝；§15 补一句。
- **G-I1 → A17 对 `unknown` 形参位静默，`print(…)` 同样静默**：把 `["a", 1]` 交给一个接受任何值的
  形参（`print`、`Json.stringify`）是把数据交出去，不是元组反射——异构 JSON 数组是真实数据；
  按 D89 近零误报门槛两处都不报。
- **C-I1 → `List<null>.compact()` 仍拒绝，但理由改对**：全体元素都是 null，结果没有元素类型
  可言；消息说这一点，不再说「没有 null 臂」。
- 其余按账本的修复优先序执行：D-D1（嵌套 retired 调用的 `velar fix` 产出坏源码，迁移前必修）、
  B-D1（`case 泛型子类:` 对已应用父类误报「永不匹配」）、I-D1（`velar format` 对解析失败的文件
  把 JSX 改写成比较运算——格式化器解析失败时不得写回）、A-I1（`??` 回退位对泛型调用也传上下文）、
  B-I1/B-I2/F-I1/D-I1（消息与双报）、I-I1（`groupBy/keyBy/countBy/zip` 成员契约对 K/U 泛型，
  与 `reduce` 同法——D114 S3b 上报 (e) 至此清算）、I-I2（泛型类悬停带 `<T>`）、H-U1（经普通 `def`
  的自失效报告补写入路径）、I-C1/I-C2/A-U1（宪章对齐）。C-U1（`chunk`/`repeat` 字面量不在编译期
  检查，与 `string.repeat` 一致）保持。
- 分两波：F1 先修不与 R1b 搬移区域重叠的项（watch 深写、格式化器、悬停、宪章），F2 在 R1b
  落地后修集合/调用推断区域的项。
- **L 波上报（更正 S2 上报 (c)）**：`library.Box<string>` 在类型位不解析**不是解析器缺口**——
  命名空间成员从来不是类型拼写（ENM-I9，宪章 §12「用名字导入再标注」），裸 `library.Box` 今天
  就是这条 VEL4001；缺的只是带 `<T>` 的拼写会级联成多条解析错误。L 波让它整体解析、只报那一条
  并点名 `import {Box}` 与 `Box<string>` 的改写；`library.Status.pending` 同法。ENM-I9 维持，不重开。
  同批：保留名声明「一处错误一条报告」（`class Text:` 只留 VEL4021；Web 里 `type Duration:` 只留
  VEL5065，新 `protected markTypeNameRefused` 钩子）；`type/class/enum null:`、`type readonly:` 在
  名字槽按 VEL3007 句式拒绝；被指引的拼写（`Array`、`str`、`dict` …）作为声明名同样拒绝。
  留门：`object`/`Object`/`Callable` 有指引无替换，仍可作声明名但每次使用都报 VEL2012——
  是否收回这几个名字，另议。
- **所有者 2026-09-05：姊妹仓迁移不做。**「波次布局」里的迁移波取消；本仓只保证 `velar fix` 对退役
  拼写的机械改写正确（审计 D-D1 修复后），迁移本身不由本仓发起。

## R1 进度记录（2026-09-05，分支 `refactor/r1-compiler-split`）

| 片 | 内容 | analyzer.ts | 结果 |
|---|---|---:|---|
| R1a | `contracts.ts`；`analysis/lowering-recorder.ts`（52 张侧表）；`analysis/advisories.ts`（A 名册 20 方法，A8 因读活跃遍历深度留下） | 17,485 → 16,403 | 指纹一致、缝 140 不变、导出不变；emitter↔analyzer 值边消失 |
| R1b | `analysis/{collections,calls,members,vocabulary}.ts`；六个大方法（721/394/376/303/141/135 行）按族拆到 120 行内；边界门禁改目录遍历并去注释扫描 | 16,403 → 13,246 | 同上；超 120 行函数 41 → 35 |
| R1c | 协议类型入 `contracts.ts`（环缩到 4 模块 / 3 条类再导出值边）；`types/` 七模块、`parser/` 十模块、`emit/` 十模块；`parseStatementBody` 402 → 41、`emit()` 653 → 69 | 13,323 | 同上；allowlist 44 文件 / 75 函数 → 43 / 60 |

| R1d | `analysis/flow/`（5）、`declarations/`（5）、`classes/`（4）、`modules/`（3）、`scopes.ts`、`matching.ts`、`match-coverage.ts`、`functions.ts`；20 个宿主接口共 401 成员（从按目录并集 953 收窄）；`analyzeStatement` 1,004 → 69、`inferExpressionType` 597 → 63 | 13,318 → 7,310 | 同上；allowlist 43 / 60 → 43 / 52 |

| R1e | `analysis/expressions/`（12 个协作者 + `semantic-index.ts`）；`calls/`（5）与 `collections/`（9）子目录取代两个超限文件；`analysis/modules/interfaces/`（3）承接 `index.ts` 的 `interfaceOf`（404 行 → 45 行编排）；`index.ts` 1,363 → 742 | 7,310 → 4,759 | 同上；allowlist 43 / 52 → 40 / 48（合并 main 0.28.x 后 40 / 46） |

约定落地：一个 worktree、一条分支、同一绝对路径比对指纹；语言波合入后重取基线（F1 的 H-U1
改了发射的运行时前奏，产物按设计变化）。下一片 R1d：analyzer 余下簇（流事实与收窄、类、声明、
模块接口、作用域）、`analysis/collections.ts`（1,706）与 `calls.ts`（1,661）按 D115 §三拆子目录、
lexer / formatter / semantic 拆分——等 F2 合入后开。
- 2026-09-06：集成头合入 Codex 的 0.28.1/0.28.2；其发版提交在 GitHub CI 上 Node suite 红（`[A-007]`
  仍期待打包器的 ERROR 行，而 0.28.1 的依赖目标检查已把 Web 项目内嵌 JS 的 `node:` 导入提前到编译期
  拒绝 VEL6006，报告仍指向作者行）——在集成分支更新该断言；Codex 也在主目录改同一测试文件，不往
  main 挑拣。

## 0.29.0（2026-09-06）

发版提交 `9f1e22f`，`core@0.7`。内容：L、F1、F2 三波语言修复（审计的 4 缺陷 9 不一致全部关闭）、
W/W2 之后的 watch 防护补全、R1a–R1e 五片零语义重组（产物指纹逐字节一致）、`check:file-budget`
门禁、Codex 的 0.28.1/0.28.2 合入。发布由编排会话执行（所有者 2026-09-05 授权）。R1f（statements
簇、lexer/、format/、semantic/）在发版后继续，进下一版。
- 0.29.0 的 main CI：macOS 的 Node suite 在「Node process and HTTP runtimes preserve secret, cancellation,
  timeout, and streaming boundaries」上以 `Error: kill EPERM` 失败，ubuntu 绿；F2 波在本机也遇到过一次、
  重跑通过——macOS 上对刚退出的子进程 `kill` 会抛 EPERM。列为后续实现项：Node 进程运行时的停止路径
  应把「子进程已退出后的 EPERM」当作已停止处理，测试不再依赖时序。另一条只在 CI 出现过的
  「velar dev reloads npm and frozen prebundles …」一并观察。

## 后续项队列（2026-09-06，0.29.0 之后）

实现层（直接派波）：`kill EPERM`——Node 进程运行时停止路径把子进程退出后的 EPERM 当作已停止；
`case Shape<number>:` 在 `Shape<number>` 主题上同时报 VEL4022 与后续 `case _:` 的 VEL4014「已覆盖」
（一处错误两条报告）；`boundVocabularyGuidance` 归 `analysis/vocabulary.ts`，删掉 `declarations → calls`
这条边；宪章 120 个 `velar` 围栏中 50 个不是规范格式化形态——整体过一遍 `velar format`；
`createSemanticMembersOf` 重复实现成员解析（一个概念两处定义）；方法声明符号不发布类型，
悬停约束规则够不到。
设计层（待所有者）：表面摘要是否纳入退役拼写、A 名册与内建类型名名册（会让历史摘要回溯变动）；
`object`/`Object`/`Callable` 有指引无替换、仍可作声明名；`extern class` 以内建名声明的门。

### 队列的派发（编排会话，2026-09-06）

实现层六项拆成两波：**F3**（worktree `f3-fixes`，分支 `wave/d114-f3-hygiene`）拿前四项——
`kill EPERM` 停止路径、`case Shape<number>:` 的双报、`boundVocabularyGuidance` 归位、
宪章围栏的规范格式化（新脚本 `scripts/check-fence-format.mjs`，`check:fence-format` 挂进
`gate:check`，覆盖 charter / language / standard-library / web-api / best-practices 五份文档的
`velar` 围栏）；后两项（`createSemanticMembersOf` 的重复成员解析、方法声明符号不发布类型）
落在 `semantic.ts`，而 R1f 正在把它拆成 `semantic/`，所以等 R1f 落地后另派 **F4**，避免同一
文件两边改（D115 §五的原则）。

设计层三项不裁：交给 P6 审计取证（`object`/`Object`/`Callable` 与 `extern class` 内建名门各探一组，
表面摘要的输入以 `scripts/check-surface-versions.mjs` 的实际读取为准写一段事实），事实到手再问所有者。

**P6 第二轮语言审计同日派发**，三份账本并行、只读（D115 §五「审计是只读的，随时可与重构并行」）：
`archive/COMPLETENESS-AUDIT-0.29.0-CORE-2026-09-06.md`（异步与工作归属、错误、模块与 JS 边界、
字符串与 `Text.`、0.29.0 新增面复审）、`…-WEB-…`（组件与 JSX、Look、状态/资源/动作/watch、
生命周期与应用库）、`…-NODE-…`（`velar/serve` 与 Node `velar/http`、process/host/terminal、
fs/path/hash/env/validation）。方法学与分类沿用 0.28.0 账本；DEFECT/INCONSISTENT 直接开修复波，
UNDEFINED 与设计题回到本文待裁决清单。

### R1f 落地（2026-09-06，合并 `4729c45`，已推 main）

`analyzer.ts` 4,759 → 3,251；`lexer.ts` 1,957 → 714（`lexer/` 九个模块）；`formatter.ts` 1,823 → 99
（`format/` 七个模块）；`semantic.ts` 1,191 → 78（`semantic/` 六个模块，`buildSemanticIndex` 830 行闭包
成为 `SemanticIndexBuilder` 类；`semantic-declarations.ts` 并入）；语句簇进 `analysis/statements/`
六个模块，A 名册按族拆进 `analysis/advisories/`，`checkArguments` 进 `analysis/calls/arguments.ts`。
允许名单 40 文件 / 46 函数 → 37 / 41，无新增。三个入口类的 protected 缝（66 / 44 / 32）与
`index.ts` / `extension.ts` 的导出（160 / 140）逐字不变；`packages/compiler/src` 333 个源文件零值导入环。
指纹：R1f 自己的起点基线（`d1a6f80`）已被 0.29.0 发版提交改掉（清单含版本号），所以在集成头
`5d1303f` 重取基线再比——828 文件逐字节相同。

**裁决：`analyzer.ts` 是组合根，留在 3,251 行。** 余下内容是 166 个字段（协作者实时读取）、
17 个宿主构造器（953 行）、66 条 protected 缝（551 行）、三个分派器与 25 个公开读取器。
宿主构造器不能搬到别的模块——`private` 成员在类外不可读（TS2341，已在本仓 tsc 7.0.2 下实证），
搬出去只能靠放宽 `Analyzer` 的公开面。D115 §五 P2 的完成条件「`analyzer.ts` ≤ 800 行」**修订为**
「`analyzer.ts` 不含分析逻辑：只有状态、缝、宿主构造器与分派器，分段预算写进
`compiler-architecture.md`」。可选的 R1g（把字段收进一个公开字段的 `AnalyzerState`，直接交给协作者，
构造器缩成方法绑定；类型参数/擦除泛型那一族 ≈200 行进 `analysis/declarations/generics.ts`；
`registerBuiltinErrorClasses` 进 `classes/`；`predeclareTopLevel` 进 `modules/`）等 P3/P4 之后再评，
不现在做。

R1f 发现未修，归 F4：`scripts/check-runtime-boundary.mjs` 第 333–336 行读了 ast / parser / formatter /
semantic 四份源码却一条断言都没有（这道门从未覆盖它们）；`analysis/classes/members.ts` 的
`ClassMembersHost.findMethod` 声明了两次。

### F3 落地（2026-09-06，合并 `be1a4d5`）

四项全落：① `kill EPERM`——机制实证为 pid 复用（macOS 顺序发号，根子进程退出后进程组号落到
本进程无权发信号的进程上）；`processGroupExitConfirmed`：根子进程已退出时 EPERM 与 ESRCH 同为
「组已不在」的证据，子进程还活着时 EPERM 仍是错误；5 秒确认窗口不动，`node-platform.test.ts`
一字未改，新测试在 `tests/node-process-stop.test.ts`。② 被拒模式不计入覆盖：
`creditMatchPatternCoverage` 读模式分析自己的判决，被拒的臂直接返回。③ `boundVocabularyGuidance`
归 `analysis/vocabulary.ts`，读者其实是三处（`generic-calls`、`declarations/generics`、
`expressions/assignability`），`declarations → calls` 这条边没了；合并时顺手删掉 `analyzer.ts`
的死导入与 `generic-calls.ts` 的门面再导出。④ `scripts/check-fence-format.mjs` +
共享的 `markdown-fences.mjs` / `documentation-fence-language.mjs`（`check-documentation-examples`
改为导入，输出逐字节不变）；197 个围栏里 76 个重写（charter 49/122、language 9/18、
standard-library 4/13、web-api 4/31、best-practices 10/13），全部是单语句套折叠与尾注对齐，
76 个的发射 JS 与诊断在临时名归一后完全一致；`check:fence-format` 挂在 `check:docs` 之后。
宪章第 135 行「Blocks use a trailing colon and indentation」的示例被折成单行后不再示范缩进——
改成两语句分支（`start()` + `print("started")`），格式化后保持缩进形态。

F3 的两条上报进 F4：(a) `case Shape<number>:` **单独**出现时从 1 条变 3 条
（VEL4006 + VEL4015 + VEL4022）——「计为空」的另一面。裁决：**被拒的臂让整条 `match` 的穷尽判决
悬停**——只要有臂被拒，就不报 VEL4006 / VEL4015 / VEL4014；作者先修那条臂，再听覆盖。
(b) `packages/node/src/compiler.ts:971` `__velarNodeProcessOwnerAlive` 把一切非 ESRCH 当作「还活着」，
在 pid 被复用时会对一个已不属于我们的进程组发 SIGKILL——套用 ① 的判据（根子进程已退出 + EPERM
= 组已不在，不再发信号）。

### F4 范围（R1f 落地后即派）

`createSemanticMembersOf` 的重复成员解析（`semantic/` 里一处定义）；方法声明符号发布类型（悬停
约束规则够得到）；被拒臂悬停穷尽判决；`check-runtime-boundary.mjs` 四份死读改成真断言或删掉；
`ClassMembersHost.findMethod` 去重；`__velarNodeProcessOwnerAlive` 的判据。全部实现层。

## Web 面审计裁决（账本 `archive/COMPLETENESS-AUDIT-0.29.0-WEB-2026-09-06.md`，约 256 探针：3 DEFECT / 7 INCONSISTENT / 6 DRIFT / 9 UNDEFINED）

**实现层（F5-web 波，直接派）**

- LC-D1：`publicConfig(Type)` 在编译期把清单值对上声明类型——缺字段、类型不符在 `check` 与 `build`
  报错并指到调用处；web-api §`velar/config` 写明这是构建期证明。
- ST-D1：VEL5064 覆盖资源**面**本身（消息里已写「or a resource field」，判据补上这一格）。
- ST-D2 + ST-U1：`finally` 是体内唯一无条件必然执行的块，顶层 `finally` 里的自写并进 VEL5077；
  `for` 体（可能零次）、`try` 体（可能被抛出打断）、`match` 臂（由数据选择）留给运行时上限，
  宪章 §15 把这条界线和理由写出来。
- LK-I1：按宪章 §17「one table, two constructs」把 `look:` / `keyframes:` 补进调用实参、集合、记录
  三个位置（解析器），并去掉集合位/记录位的 VEL2001 级联——实现向宪章靠，不是反过来。
- JX-I1 / JX-I2 / LK-I2：各留一条——具名实参调用组件只报第一条 VEL4001；组件体里的 `match`
  不再逐臂报 VEL3003，VEL5008 的消息点名两条改法（`match` 里给 `let node` 赋值再统一 `return`，
  或抽 `def` 返回 `WebNode`）；停位里越界的具名实参只报 VEL5042。
- LC-I1：`velar/browser` 七个入口的「宿主不在」统一为一句（照 `velar/storage`），失败位置不变。
- LC-I2：`Component<Props>` 上的 `ref` 拒绝说契约缺第二个类型实参并给出
  `Component<(title: string) -> WebNode, Handle>`；真正没有 `exposes` 的组件另一句。
- LK-C3：`min` / `max` / `clamp` 每个槽位接受 `Length` 或 `Percentage`，结果在同时接受两者的属性上
  可用（CSS 的 length-percentage）——文档承诺在先。
- LK-C1 / LK-C2 / LK-C4 / JX-C1（若所有者认可下面第 3 条）：宪章 §17 具名实参两句改成实测行为
  （越界具名实参也是编译错误；停位接受范围内的具名实参，web-api 那句留下）；`strokeLinecap`
  「and nothing else」改为「plus the CSS-wide keywords」。
- UNDEFINED 成文：ST-U3（上限触发后那条 watch 到页面结束不再运行，其它照常）、JX-U1（重复键在
  首屏是 `mount` 相失败，走 fatal state）、LC-U1（挂载自底向上、清理自顶向下且同级逆序）、
  LC-U2（重复 `mount` 经错误链上报、正常返回）、LK-U1（`linearGradient` 方向是 `Angle`，
  `to right` 写 `90deg`）、LK-U2（单停位 `keyframes:` 合法）。

**设计层（待所有者，附建议）**

1. **JX-I3 属性展开 `{...props}`**：今天是两条 VEL5002 的偶然拒绝。建议：**按设计不存在**，进宪章
   §19（组件的 prop 由契约点名，展开会藏起「设了哪些」），拒绝改成一条、点名「展开」并给改法。
2. **LK-I3 `hsl` 的饱和度/亮度**：今天是 `number`（0–100），语言自己的 `%` 被拒。建议：**只收
   `Percentage`**（语言有一等单位；CSS 的主流拼写也是 `50%`），裸数字拒绝并给 `50%` 的改法；
   另一个选项是两种都收（一个意思两种拼写，与语言口味相悖）。
3. **JX-C1 插值区域的重建条件**：实现只在「决定区域形状的读」变化时重建，prop 表达式的读让实例
   活着并实时更新；web-api 说 prop 一变就重建。建议：**文档跟实现**（更少重建、实例连续），
   删掉那条今天多余的改结构建议。
4. **LC-C1 `tick()` 的拒绝承诺**：实现里浏览器宿主把无人认领的刷新失败抛给宿主 error 事件、
   `tick()` 照常 resolve；只有非浏览器宿主才 reject。建议：**一律先交给正在等待的 `tick()`**
   （有等待者就 reject 给它——这就是「认领」），没有等待者才走宿主事件 / 报告；否则
   `velar/web-test` 在浏览器里会静静跨过坏更新。备选：只在两份文本里写上宿主条件。
5. **LC-C2 动态区域首次构造失败**：留下的是 HTML 注释，不可见也不可访问。建议：区域留下一个
   `role="alert"` 的可访问内联标记（与根的 fatal state 同一套措辞），隔离不变；备选是把 web-api
   那句「covers every initial-render path」缩到根路径。
6. **ST-U2 `watch <computed>:` 写它的同模块一跳来源 state**：今天 50,000 轮后被每任务预算停住。
   建议：VEL5077 的静态判据**顺同模块 `computed` 的来源走一跳**（这是可证的环）；备选保持运行时。
7. **ST-U4 state 里的类实例**：读它字段的 `computed` 永久陈旧、零诊断。建议：不包装（web-api 已定），
   但开发宿主加一条像冻结读探测器那样的检测（`computed` / `watch` 读到经 state 到达的、
   未包装类实例的字段时报告），并把后果写进 web-api。

## Core 面审计裁决（账本 `archive/COMPLETENESS-AUDIT-0.29.0-CORE-2026-09-06.md`，约 355 探针：1 DEFECT / 24 INCONSISTENT / 5 DRIFT / 12 UNDEFINED）

0.28.0 账本的九条已修项全部复验通过（D-D1、B-D1、I-D1、C-I1、D-I1、F-I1、I-I1、I-I2、G-I1）。

**实现层（F5-core 波，等 F4 与 F5-web 落地后在合并头上派，避免与它们同改 `matching.ts` / `parser/`）**

- AS-D1：异步 `@iterate:` 的 `return` 表达式静态类型是可选、且可选性不来自 `null` 字面量时报一条
  新诊断（流的元素不能是 `null`——`null` 是耗尽的答案；把元素包起来或返回非可选），宪章 §10 加这一句。
- RE-I3 / RE-I4：类型位的裸 `List` / `Map` / `Set` / `Record` / `Type` 报「Generic type 'List' needs a type
  argument」（与用户泛型同一句）；目标是泛型的 guided spelling（`Array` / `dict` / `list`）只报指引一条。
- RE-C2 / RE-I6 / RE-I7（0.29.0 名册的漏格，套用 0.29.0 的裁决「声明可写、每次使用被拒的名字不许声明」）：
  类型参数位覆盖 guided spellings、`readonly` 与 `null`（一句名册消息，替掉解析错）；extern class 两种拼写
  （`extern module` 契约与 `extern js` 内联块）对内建类型名同答——名册拒绝，位置词是「extern class」。
  这就是待裁项 (b) 的答案：门关上，因为放行的那一格随后每处使用都被拒。
- RE-I1 / RE-I2：`int` / `float` / `undefined` / `NaN` / `Infinity` 走词法改写，名册对改写后的词开火；改成
  对作者写的词报一条，消灭「挪一个不存在的 `'0'`」那条级联。
- AS-I7：错误产生的 `unknown` 标成错误类型，下游检查不再对它报第二条（本轮五个面都撞到的最大噪声源）。
- MD-I5：`match value: case Formatter:` 对 `unknown` 主题做类判别，与 `is` 同答（0.28.0 B-D1 的邻格）。
- ER-I1：`class X extends Error: pass` 在声明处拒绝并给修法 `constructor(message: string): super(message)`，
  与普通子类同一句（宪章亲自推荐的路不能是没帮助的那条）。
- MD-I4：VEL6010 改为 A 名册的 `A18`（循环模块依赖），`velar-allow A18` 可压制；`diagnostic.ts` 的规则
  （advisory id 不用 VELxxxx 族）成立。
- AS-I1：宿主错误通道（detach 失败、释放失败）的调用栈与 `velar run` 未捕获路径同一处理——隐藏 Node
  内部帧、`--stack` 生效；连带 PR-U4：编译器自有的 `velar/*.js` 运行时帧默认也隐藏、计入「N frames hidden」。
- AS-U2 / ER-U2：运行时诊断报行列不报字节偏移；`IndexError` 点名下标与长度（与字段守卫同规）。
- TX-U3：字面量实参的运行时契约在编译期查（`repeat(-1)`、`char(1.5)`、坏 pattern）——只把必然的运行时
  错误提前，不改语义。
- MD-U3：同一名字从同一模块分两行导入（一次改名）报 VEL3004，与同一子句内一致。
- SV-I5（Node 账本，根因在 Core）：具名实参的规范拼写是 `name=value`（宪章 §7 第 1828 行），格式化器在
  调用跨行时写成 `name = value` 是缺陷——修格式化器，围栏门自动把文档拉回。
- 措辞与去重一批：AS-I3（`@main` 里的 `using` 只报 VEL3018，不叫作者去声明不存在的函数）· AS-I4（具名类型
  字段拼错也给最近名）· AS-I5（常驻命名空间的未知成员点名 `Promise` / `Text` / `Json` / `Math`，JS 反射
  `resolve` / `reject` / `allSettled` 给去处）· AS-I6（表达式位的 `detach` 说「只在语句位」）· ER-I2（Error
  契约成员作方法重声明用字段那句）· ER-I3（裸 `try` 语句只报一条）· RE-I5 / RE-C1（`any` 出内建类型名名册，
  只留「不是 VelarScript 类型；无检查边界用 `unknown`」）· RE-I8（`??` 右臂的空记录字面量拿到期望类型）·
  TX-I1（`"ab" * 3` 给 `.repeat(3)`）· TX-U1（布局字符串消息说「内容要比开行更深」）· AS-C1（标准库文档：
  `trySend` 对已关闭的 channel 抛 `ChannelClosedError`，布尔答案只对满缓冲）。
- 成文：AS-U1（`@main` 不是 owning scope，体内联到模块作用域，宪章 §9 列进排除）· AS-U3（`Promise.` 表写明
  没有 `resolve` / `reject` / `allSettled` 的理由）· ER-U1（`finally` → 释放 → 返回；多个 `using` 逆序；释放
  失败不跳过后续）· MD-U1（独立模式的 Core 文件按 Node 程序检查）· MD-U2（`velar/test` 的真实规则是
  `*.test.vel` 模块约定，消息照此说）· TX-C1（宪章 §2 一句「格式化器规范拼写、不重排行，没有行宽」）。

**设计层（待所有者，附建议）**

8. **AS-I2 两种超时两种身份**：`Promise.timeout` 抛裸 `Error`，`velar/task` 的 `withTimeout` 抛
   `TaskTimeoutError`。建议：Core 增内建错误类 `TimeoutError`（与 `IndexError` 同列），两处都抛它
   （`TaskTimeoutError` 退役为它）——超时是唯一有独立恢复动作的能力失败。
9. **RE-C3 / RE-U1 `object` / `Object` / `Callable`（待裁项 (a)）**：事实——`object` / `Callable` 可声明
   `type` / `class` / `enum` 并能运行，但每处注解被拒；`Object` 的拒绝句既不说规则也不给替代。建议：三个名字
   进 guided-spelling 名册（`object` / `Object` → 具名 `type` 或 `unknown`；`Callable` → 显式函数类型），声明位
   一句名册拒绝；宪章 §5「a guided spelling that names no replacement, such as `object`, is ordinary」改掉——
   实现本来就给了它替代。
10. **TX-U2 结构对象类型没有源码拼写**：诊断里打印 `{first: number, second: U}`，作者写不出来，`zip` 的结果
    类型无法注解。建议：Core 增常驻记录类型 `Pair<A, B>`（`first` / `second`），`zip` 返回 `List<Pair<T, U>>`；
    诊断只对无名结构打印结构拼写。备选：允许内联结构类型注解（与 VEL2012「object shape 要具名 type」相悖）。
11. **表面摘要范围（待裁项 (c)）**：事实——Core 摘要 369 条、11 类；**不在**摘要里的有内建类型名名册、
    退役拼写表、A 名册、保留错误类名，以及宪章 §7 规范表里 `string` / `number` 的全部检查值方法
    （`padStart` / `toFixed` / `isNaN` … 改签名门不红）。建议：五样全部纳入 Core 摘要，随下一版一次性
    移动摘要（历史 `surface-lock.json` 记录的是各版当时的摘要，不回溯）。

## Node 面审计裁决（账本 `archive/COMPLETENESS-AUDIT-0.29.0-NODE-2026-09-06.md`，约 255 探针：6 DEFECT / 8 INCONSISTENT / 2 DRIFT / 16 UNDEFINED）

**实现层（F5-node 波，直接派：`packages/node`、`packages/server`、`packages/cli/src/project.ts` 的模块解析
诊断族、标准库文档 Node 各节、Node/Server skill 与 tour）**

- PR-D1 + PR-D2：操作系统拒绝的 spawn（ENOENT / EACCES / ENOTDIR / cwd 不存在 / 只给命令名）是应用级失败：
  按调用报、点名可执行文件与 errno，不毒化代理，不从 MessagePort 处理器逃逸——`try/catch` 的承诺成立。
- SV-D1：响应复制的 `json` 分支保留 `contentType`。
- SV-D3 / SV-I2 / FS-D1：文本读路径不再剥 BOM（文档承诺「从不修补」）；`Json.parse` 在 Core 与 Node 对
  BOM 同答（拒绝）——带 BOM 的请求体成为 422 问题文档；文档写明。
- SV-D4 + SV-U5：路由的每一种结局（`HttpProblem`、转成不透明 500 的意外错误、框架自己的 404）在离开路由
  包装层时已经是响应，因此都经过应用中间件——安全头与 CORS 头出现在 4xx/5xx 上；`middleware.errors`
  保持文档给它的角色。
- SV-I1：请求行解析完成后的框架拒绝（413、415、坏路径 400、静态 404/416）都是问题文档，与 `openapi()`
  发布的一致；只有请求还没成形的传输层失败保持一句 `text/plain`。
- SV-I3：客户端挂断是一条独立的、非错误措辞的记录，不走「Unhandled server request failed」。
- SV-I4 / SR-U2：GET 与 `@websocket` 同路径、`listen({path})` 与 `@websocket` 并用，在编译期裁判处拒绝，
  与 `openapi()` 同答。
- SV-I6：`velar check` 与 `velar build` 在同一处检查清单声明的 Server 配置文件存在。
- SR-I1：`application()` 接受 `server.port: 0`（任意空闲端口），与 `serve(app, port=0)` 一致，文档写界。
- FS-I1：`issues[].path` 只有一套约定——字段名段，不带类型名前缀。
- SV-U4：路径参数只匹配非空段，`/n/` 对 `/n/{id:number}` 是 404 不是 422。
- MD-I1 / MD-I2 / MD-U2 / MD-I3 / SV-C2（Core 账本的同族，都在 `project.ts`）：模块解析失败族带诊断码与
  行列（`ProjectFailure` 补 `code` 与位置，二十多个站点改用 `recordResolution` 的形状）；导出名拼错给最近名；
  `velar/test` 在非测试文件报真实规则；自导入不存在的名字仍报 VEL6004；Web 侧对七个 Node 本地模块的拒绝
  逐个给去处（`velar/path` → `velar/url` 等），`velar/serve` 导入 Core 名只报一条并说「无需导入」。
- 成文：SV-U1（`stream()` 只发调用者给的头，`content-type` 由调用者设）· SV-U3（路由返回 `null` 是 200 +
  JSON `null`，204 用 `noContent()`）· SV-U6（流中途失败立即 FIN、不发终止块）· PR-U1（`timeout: 0` = 无超时，
  与 `velar/http` 同）· PR-U2（`terminal.close()` 之后写抛错）· PR-U3（第二个信号强退以 1 退出，视为失败的
  关停）· PR-U5（`velar/host` 只有 `exit` 与 `onShutdown`，不发布主机值）· FS-U1（Node 文件观察者对自身写入
  会照常再触发、无上限——构建工具向被观察目录写产物是合法用法，不设护栏）· FS-U2（`makeDirectory` 幂等）·
  FS-U3（`field(name, select, …)` 用 `name` 报告、用 `select` 取值）· EN-U1（存在但为空不算缺失；不加载
  `.env`；无带类型读法）。

**设计层（待所有者，附建议）**

12. **SV-D2 / SV-C1 `HttpProblem.code`**：宪章 §11 禁止 Error 子类重声明 `code`，Node 契约却把语义码
    （`route.not_found`）声明成 `code` 字段，降级后恒为类名，skill 与 tour 教的 `outcome.problem.code`
    产出常量。建议：源码字段改名 `reason: string`（线上问题文档的 JSON 字段名 `code` 不变——那是发布给
    客户端的契约），`HttpProblem.code` 按宪章等于类名，skill / tour / 标准库文档同步。
13. **SV-U2 静态 `root` 相对什么**：今天相对进程工作目录，换目录启动全部 404。建议：相对路径以应用自己的
    目录（发射入口所在目录）为基，绝对路径照给；写进文档。

### R2 落地（2026-09-06，D115 P3 的编译器部分；合并 `105219f`）

15 个 `*-runtime.ts`（3,321 行，33 个 `String.raw` 常量）成为 `packages/compiler/runtime/` 下 34 个真 JS 文件
加 `manifest.json`（族、常量、组成部分、每个文件定义与依赖的 `__velar…` 助手名——用 acorn 解析得出，
不手写）。`scripts/generate-runtime-sources.mjs` 生成 `src/runtime-sources.generated.ts`（每个常量一个
`export const`，JSON 字串字面量或由先前常量拼接），并对 12 处「插值已解析进文件文本」的站点逐一断言
它仍等于所属常量渲染出的文本（改 `VELAR_TYPE_REGISTRY_VERSION` 门立刻红——比模板时代更严）。
26 处 `${VELAR_X_RUNTIME}` 片段组合不解析进文本（否则同一段运行时写两遍、共享模块与独立内联形态漂移），
由 manifest 的部分表在生成时拼接。模块说明符与导出名册这些非运行时体的 TS 常量进手写的
`src/runtime-modules.ts`；`runtime-abi.ts` 只有 TS 常量与类型，原样保留。旧路径全部删除、无门面。
与 D115 §三平铺 15 个名字的两处偏差：`collection-host` 是六个片段文件（发射器逐片选用于独立输出），
没有 `primitive.js`（该模块就是 `text.js` + `number.js` + 导出块）。

门禁：`check:runtime-sources`（重生成 + diff，拒绝 manifest 未列的运行时文件）挂在 `check:file-budget` 之后；
`build-packages` 先重生成再构建；`check-runtime-boundary` 经 manifest 读 `runtime/*.js`，新增规则拒绝
`packages/compiler/src` 里任何多行 `String.raw` 字面量（留空名单与作用域表给 web / node / core / desktop
后续片），R1f 发现的四处死读删掉（git 史证明它们自 R1b 改成目录遍历后就成了孤儿，遍历本身覆盖这四个文件）。
`packages/compiler/package.json` 不变——`runtime/` 是构建输入，打包消费验收绿证明之。
828 文件指纹逐字节相同；允许名单 37 → 36 文件（`collection-lowering-runtime.ts` 离开）。

一条旁证进后续队列：`tests/desktop-services.test.ts:481`「a crashing service backs off to a terminal state」
断言 5 条重启日志、在 CPU 争用下见到 4 条（三个 worktree 并发跑门时出现一次，单跑 10/10 绿）——
Desktop 服务监督器的退避计数按墙钟，测试要改成按事件等待。


### F4 落地（2026-09-06，合并 `678711c`）

① `analysis/published-members.ts` 成为「接收者发布哪些成员」的唯一定义：检查器（`MemberAccess`）与语义
索引读同一个 `member()` / `roster()`，索引里那套第二实现删掉；两边原先不一致处以检查器为准——编辑器
少了 S3 新增的十个 List 管道成员、枚举别名只给 `is`/`parse`、私有字段经应用接收者显示 `T?` 而非
`number?`，全部归一。`Target.from` 保留为有解释的不对称（补全给、裸读拒——投影规则只认调用形态）。
② 方法 / 静态方法 / getter / 泛型方法的声明符号发布类形状已算出的可调用类型，悬停与 `def` 同形
（构造器没有独立符号：Vel 的构造器是类声明的参数表，类符号已发布）。③ 被拒臂悬停整条 `match` 的
判决：VEL4014 记在 `MatchCoverage.redundancy` 上、走完全部臂再发，`blockAlwaysReturns` 把带被拒臂的
match 视为离开块——`case Shape<number>:` 单独出现一条、加 `case _:` 一条。④ `ClassMembersHost` 与
`ClassRolesHost` 各一处重复 `findMethod` 删除（全仓 329 个源文件的接口只有这两处）。⑤ `analyzer.ts`
27 个死导入 + R1 拆分留在兄弟模块的 7 个 + 提取自留的 4 个，全部删除；`noUnusedLocals` 在 root
tsconfig 关着，在 create / node / server / web 的 build tsconfig 开着，compiler / cli / core / desktop 没开
——正是死导入所在。⑥ Node 收割器的 `__velarNodeProcessOwnerAlive(pid, exited)`：ESRCH 即消失，EPERM
在收割器自己的 SIGKILL 已送达后即消失（pid 复用）；答 EPERM 的组从 100 次尝试 / 200 次信号 ≈ 5 秒
降到 1 次 / 2 次，答 ESRCH 的组零信号释放。进程组信号函数移到 `process-runtime.ts`，`compiler.ts`
留在预算内（1,482 / 1,490）。指纹只变 `velar/process.js` 两个文件（⑥），①–⑤ 逐字节不变。

进后续队列（F6 卫生波）：`tests/desktop-services.test.ts`「a crashing service backs off to a terminal
state」`rm -rf` 并断言的是**共享的绝对宿主路径** `~/Library/Application Support/dev.velarscript.services/
service-logs`，不随 worktree 隔离——多个 checkout 并发跑 node 套件必然互相污染（`gate-lock` 只在
checkout 内串行）；Desktop 宿主夹具要有按 checkout 的应用数据根。`compiler` / `cli` / `core` / `desktop`
四包的 build tsconfig 补 `noUnusedLocals: true`，让死导入这一类自我执行（`packages/cli/src` 尚有四个：
`ownership-graph.ts` `SemanticReference`、`preview-server.ts` `join`、`project.ts` `stat`、
`typescript-declarations.ts` `describeType`——等 F5-node 落地后一并清）。

### F5-node 落地（2026-09-06，提交 `d280e50`，合并进集成分支）

十二项全落。要点：spawn 被操作系统拒绝（ENOENT / EACCES / ENOTDIR / cwd 不存在 / 只给命令名）在 worker
里于句柄铸出之前就按调用拒绝，消息点名命令与 errno，代理不毒化、不逃逸；`__velarServeResponseCopy`
两个分支都带 `contentType`；四个共享解码器 `ignoreBOM: true`（原先 `false` 会删掉 U+FEFF），
`request.json()` 对坏 JSON 走框架自己的 **400 `request.invalid.json`**（账本 DECIDED 段已记录的既有状态码，
不是裁决里写的 422——以框架现有码为准）；路由的每种结局在中间件链内成为响应，`use()` 把中间件记到
应用上，框架 404 也从中经过；请求行之后的框架拒绝全部是问题文档（414 / 431 预检留 `text/plain`），
`openapi()` 不改而变真；客户端挂断一句独立日志；编译期重叠裁判把 GET 与 WEBSOCKET 同形视为冲突；
`listen({path})` 与 websocket 并用在装配期点名路径拒绝（编译期需要 `astNodesOfKind` 从
`@velarscript/compiler/extension` 导出——进 F6）；`serverConfigurationFailure` 一处定义供 check 与 build；
`application()` 收 0–65535；校验 `issues[].path` 只剩字段名段；路径参数不匹配空段。模块解析族：
`ProjectFailure` 带 `code` / `span`，七处格式化并成 `formatProjectFailure`（LSP 同用），新码 VEL6007
（未知导出，含最近名、`*.test.vel` 规则、自导入与 Core 前置名不双报）与 VEL6008（Web 侧拒绝，逐模块给去处）。
未能在本波做的：VEL3007 的「该名无需导入」措辞在 `analysis/scopes.ts`（F5-core 的文件）——进 F6。
指纹 26 个 Node 面文件变化（含 tour 的 `01-server.js`：`stream(...)` 现在自己设 `content-type`）。
允许名单不增不涨，触到的条目全部下降（serve-runtime 4,228 → 3,800 等）。

### R2b 落地（2026-09-06，D115 P3 的 core 与 desktop 部分；提交 `60ff4bd`）

`packages/core/src/index.ts` 3,239 → 276（汇总器），`interfaces/<module>.ts` 每个 `velar/*` 一个，
19 个 `runtime/*.js`，`hash-runtime.ts` / `validation-runtime.ts` 删除；`packages/desktop/src/compiler.ts`
2,867 → 129，`test-runtime.ts` 1,206 → 240，`interfaces/` 7 个、`modules/` 5 个、23 个 `runtime/*.js`。
生成器成为多包（`RUNTIME_PACKAGES = compiler, core, desktop`，加一个根 = 一行加一个 manifest）；
跨包片段用 `imports` 声明并由生成模块导入而不复述；21 处每次编译不同的授权行保留薄 TS 装配并记进
manifest 的 `assemblies`（带样本），使每个片段仍在某个解析单元里；生成时常量解析进文本的 8 处各带断言
（改 `VELAR_COLLECTION_LOWERING_MODULE` 门即红）。两包公开导出、25 个模块源码、15 张接口表、
23 个回退源码与 23 个工程封闭源码、两个 init 脚本全部与 HEAD 逐字节相同；`core@0.7` 与 `desktop@0.10`
摘要不动；828 文件指纹相同。允许名单 36 → 33 文件、41 → 36 函数。

三条记录：`DESKTOP_SECURE_STORAGE_PREFIX` 没有自己的文件（该模块授权行之上没有不变行）；`velar/id`
的模块文本以两个空格结尾（闭合反引号的缩进），作为尾部 `separator` 部分保留；`interfaces/types.ts`
的 `mapUnknown` 原本就无人使用、现为未用导出（F6 清）。

后续队列再加三条（都是 CPU 争用下的测试形状，程序本身逐字节相同）：`tests/performance-runtime.test.ts`
的 Core/JS 算术比值在机器忙时 1.21（安静时 1.00）；`tests/hardening-cli-dev-server.test.ts:380`
`[cli-13]` 与 `tests/hardening-marathon-web.test.ts:113` `[beta-1]` 各红过一次、单跑全绿；
`scripts/run-node-tests.mjs` 把被信号终止的子进程（`code === null`）映射成 exit 1 却不打印原因——
要说出「测试子进程被信号 N 终止」。

合并 R2b 时的一条门禁空洞（进 F6）：F5-node 改了 `packages/core/src/validation-runtime.ts`（FS-I1），
R2b 把该文件搬成 `runtime/validation.js`，git 按重命名把两边合进 `validation.js`——但 R2b 提交的
`runtime-sources.generated.ts` 是搬家前生成的；合并后 `build:packages` 先重生成再检查，于是
`check:runtime-sources` 对着刚刚重写的磁盘文件比对、必然绿，而提交里的生成文件已经陈旧。
补法：CI（`CI=true`）下 `build-packages` 重生成若改写了任何生成文件即失败并点名；本地仍重生成并提示。
本次以一笔跟进提交补上重生成结果。

### F5-web 落地（2026-09-06，提交 `05e6492`，`web@0.12 → 0.13`）

八项全落。LC-D1：新码 **VEL5080**——`publicConfig(Type)` 在编译期把清单对上声明类型（新增
`AnalysisContext.extensionProjectConfig` / `CompileOptions.extensionConfig` 通道，由 `project.ts` 传入；
`packages/web/src/analysis/public-config.ts`），运行时校验保留。ST-D1：`watchedResourceSurfaceRefusal`
在冻结规则之前回答。ST-D2 + ST-U1：`finallySelfWrite` 与 `watchSelfWrite` 同住 `analysis/watch-cycles.ts`，
`for` / `try` / `match` / 条件下的 `finally` 留给运行时上限，宪章 §15 成文。LK-I1：块开启原先等 `indent`
词符而括号内缩进被挂起，故块在括号内永远开不了——Web 词法器改读源码（`visualBlockOpening`），
`visual-blocks.ts` 持四向布局规则，Core 解析器不再把 `name:` + 扩展词符认成写错的具名实参；
VEL2001 级联消失，错位的 `look:` 只报一条。JX-I1 / JX-I2 / LK-I2：具名实参调用组件一句带元素；
基础分析器新增 `extensionOwnsFunctionlessReturn()` 缝穿到 `statements/control.ts`，组件体内嵌套
`return` 不再报 VEL3003，VEL5008 点名两条出路；停位里被拒的构建器调用不再附带 VEL5060。LC-I1：
`browser-host-runtime.ts` 的 `__velarBrowserRequireHost` 供七个入口。LC-I2：以 `component.role ===
"contract"` 判别，消息拼出加宽的契约。LK-C3：新增 `length-percentage` 构建器结果种类，全同类折回原类
（`clamp(16px, 3vw, 24px)` 仍是 `Length`，`lineHeight` 仍拒混合结果）。文本：宪章 §14（重复键：首屏
`mount` 相 fatal state；之后是 `render` 相报告、区域保留原内容、下一次不同键的更新照常）、§15、§16、
§17 与附录，web-api `velar/look` / `mount` and `tick` / `velar/config`。

表面：LK-C3 改了已发布签名，`web@0.13`（摘要 `2b3717d3…`），五处钉版与四份 `velar.json` 同步；
CHANGELOG 由发版提交补。指纹 58 个 Web 工程文件变化（`framework.apiVersion` 与 `velar/browser` 运行时
文本导致的资源名变化），core / node / desktop / server 输出逐字节不变。
波内注：F5-web 的 worktree 从 `be1a4d5` 分出，比 D114 的「Web 面审计裁决」段早一笔，故按简报清单执行，
结果与裁决段一致。

### 第二批并行波的派发（编排会话，2026-09-06 晚）

F5-core 仍在跑（worktree `f5-core`，从 F4 合并头 `678711c` 分出）。在 F5-web 合并头 `d7a28a2` 上再派三波：
**F6a**（worktree `f4-fixes`，分支 `wave/d114-f6a`）——不碰 compiler 的卫生项：Desktop 宿主夹具的按 checkout
应用数据根（`desktop-services` 共享绝对路径）、`run-node-tests.mjs` 说出被信号终止、`build-packages` 在
`CI` 下对陈旧生成文件失败而不是改写、四条争用形状测试改事件驱动、cli / core / desktop 的 build tsconfig
开 `noUnusedLocals` 并清死代码、`gate-lock` 跨 checkout 的取证；**R2c**（worktree `f5-web`，分支
`refactor/r2c-runtime-web-node`，只做 web 包）与 **R2d**（worktree `f5-node`，分支
`refactor/r2d-runtime-node-server`，node + server 包）——D115 P3 的最后两片：运行时体成真文件、代码生成片段
留 TS 并进 `check-runtime-boundary` 的具名缩减名单、Worker 源码同为运行时体。三波共享文件只在
`RUNTIME_PACKAGES` / `rawTemplateScopes` 各加一行。等 F5-core 落地后再派 **F6b**（compiler 侧：
`noUnusedLocals`、MD-I4 VEL6010 → A18、VEL3007 措辞、`astNodesOfKind` 从 extension 导出并让
`listen({path})` 编译期裁判、AS-I6 若 F5-core 未能）。

### main CI 红：F5-node 的 spawn 拒绝在 Linux 上失效（2026-09-06，热修）

`c52f831` 与 `7b78a54` 的 ubuntu Node 套件红在 `tests/node-process-spawn-failures.test.ts` 两条：
worker「exited unexpectedly with code 1」，macOS 全绿。机制：F5-node 的 `spawnChild` 以 `child.pid`
为真作「进程已启动」的信号；libuv 在 Linux 上先 fork 再 exec，exec 失败时 `child.pid` 仍是那个已死
子进程的 pid，于是被拒的命令走进 `launchProcess`，`child.stdin.end()` 撞上已关闭的管道，无人监听的
流错误把 Worker 打死；macOS 的 posix_spawn 失败时 pid 为 undefined，所以本地看不见。修法：不再看
pid，等 Node 自己的下一拍事件——`'spawn'` 即启动、`'error'` 即拒绝（两者互斥、由 Node 保证发出）；
并给 `child.stdin` 挂错误监听（EPIPE / ERR_STREAM_DESTROYED / ECONNRESET 是子进程先退出的故事，
由退出码讲述；其它错误终止任务）。本机无 Linux 容器，Linux 面由 main CI 验证。教训：Node 的
`ChildProcess` 文档说失败时 pid 为 undefined，在 Linux 上不成立；跨平台判据只能是事件。

### F5-core 落地（2026-09-06，提交 `86fbcb5`）

十四项全落。要点：AS-D1 新码 **VEL4041**（`analysis/returns.ts` 的 `blockReturnStatements` 与
`inferredReturns` 按源码顺序配对，只在两边长度一致时判定——不可达的 `return` 或扩展语句块让配对不可靠时
宁可不报）；RE-I3/I4 由 `parser-names.ts` 的 `markGuidedTypeNames` 标记「作者没写的名字」，
`builtinGenericParameterNames` 给裸 Core 泛型与用户泛型同一句；RE-I6 的 `<null>` 不需要改解析器
（`parseTypeParameters` 在 `parser.ts`），被拒的参数名丢弃并抑制空表 VEL2025；RE-I7 「extern class」
进 `BuiltinTypeNamePosition`；RE-I1/I2 `lexer/identifiers.ts` 的 `declarationNameNoun` 在六个声明槽位
对作者的词报一条 VEL3007 并推入作者的标识符而不是后继名（25 种组合全部一条）；AS-I7 用已存在的
`invalidType`（所有消费者本就容忍），把「报了错还返回 `unknownType`」的站点全部改掉；MD-I5 去掉
`matching.ts` 里对 `unknown` 主题的整体拒绝，通配要求进 `reportMissingMatchArms`；ER-I1 类注册表里
`Error` 是 `parameters: [string], requiredParameters: 0`，原门永不触发，补兄弟分支、修法由基类契约推出
（与普通基类一样在调用点还多一条元数错误——同形，进 F6b 去重）；AS-I1/PR-U4 `hostErrorTraceSource`
一处生成 `__velarDetachedTrace` 与 `__velarDisposalTrace`，过滤 `node:` 与 `/node_modules/velar/` 帧，
开关是 `velar run` 启动器设置的 `Symbol.for("velar.run.stack")`——构建产物与测试宿主不受影响；
TX-U3 `analysis/literal-contracts.ts` 关的是整类（`char` `repeat` `padStart` `padEnd` `slice` `index`
与五个 pattern 成员）；AS-U2/ER-U2 `Emitter.runtimeLocation(offset)` 给 `basename:line:column`
（basename 保证发射跨 checkout 逐字节一致），`IndexError` 只在 `typeof requested === "number"` 时点名
下标——测试抓到第一版在守卫里触发了 `Symbol.toPrimitive`；MD-U3 只对 VelarScript 导入报 VEL3004，
**`import js` 免除**：同一导出既 checked 又 unsafe 是两个值（tour 第 13 章刻意如此）；SV-I5 格式化器按行工作、
跨行调用的 `(` 在更早的物理行上——`format/lines.ts` 记每个开括号开的是什么并穿到 `needsSpace`，一个围栏
（web-api 第 1866 行）与三份 tour 源码随之重排。文本：宪章 §2 / §9 / §10 / §12，标准库 `trySend` /
`Promise.`，cli.md 独立模式。指纹 70 文件变、14 重命名，全部归于 J（运行时消息文本与 `__velarNarrow`
的位置实参）与 H（重生成的两个 trace 助手）。

进 F6b：`parser/statements/modules.ts` 的 extern 契约里 `export class null:` 仍是六条解析错（名槽用
`expect("identifier")`，要像 `parseTypeParameters` 那样吞下保留字并报名册句）；`parser/expressions/
primary.ts:315` AS-I6 报了 `detach` 却没消费词符，尾随一条 VEL2032；ER-I1 声明处已拒时抑制构造调用点的
元数错误；`scripts/check-documentation-examples.mjs` 的「`unknown` 级联」宽容子句因 AS-I7 已近乎死亡，
退役之。

## 定案：P6 设计层十三项（所有者 2026-09-06：「按你的建议执行这 13 项」）

全部按上文建议执行，成为语言标准：

1. JSX 属性展开 `{...props}` **按设计不存在**，进宪章 §19；一条拒绝点名「展开」并给改法（把 prop 逐个写出）。
2. `hsl` 的饱和度与亮度**只收 `Percentage`**（`hsl(200, 50%, 50%)`）；裸数字拒绝并给 `50%` 的改法。
3. 插值区域的重建条件：**文档跟实现**——只有决定区域形状的读变化时重建，prop 表达式的读让实例活着并实时
   更新；web-api 删掉那条多余的改结构建议。
4. `tick()`：无人认领的刷新失败**先交给正在等待的 `tick()`**（reject 给它即为认领）；没有等待者才走宿主
   error 事件（浏览器）或报告（Node）。宪章 §16 与 web-api 两处同句。
5. 动态区域首次构造失败留下 **`role="alert"` 的可访问内联标记**（与根 fatal state 同一套措辞），隔离不变；
   web-api「covers every initial-render path」因此为真。
6. VEL5077 的静态判据**顺同模块 `computed` 的来源走一跳**：`watch doubled:` 体内写 `count`（`doubled` 由
   `count` 算出）在编译期拒绝；跨模块与多跳仍留给运行时预算。
7. state 里的类实例不包装（web-api 既定）；**开发宿主加探测器**：`computed` / `watch` 读到经 state 到达的
   未包装类实例的字段时报告（与冻结读探测器同族）；web-api 写明后果。
8. Core 增内建错误类 **`TimeoutError`**（与 `IndexError` 同列）；`Promise.timeout` 与 `velar/task` 的
   `withTimeout` 都抛它，`TaskTimeoutError` 退役（`velar fix` 改写名字）。
9. `object` / `Object` / `Callable` **进 guided-spelling 名册**：声明位一句名册拒绝；`object` / `Object` →
   具名 `type` 或 `unknown`，`Callable` → 显式函数类型；宪章 §5「a guided spelling that names no
   replacement, such as `object`, is ordinary」删除。
10. Core 增常驻记录类型 **`Pair<A, B>`**（`first` / `second`）；`zip` 返回 `List<Pair<T, U>>`，可注解；
    诊断只对无名结构打印结构拼写，有名的打印名字。
11. 表面摘要纳入五样：`string` / `number` 的检查值方法、保留错误类名、内建类型名名册、A 名册、退役拼写表；
    随下一版一次性移动 Core 摘要（历史 `surface-lock.json` 不回溯）。
12. `HttpProblem` 的语义码字段改名 **`reason: string`**；`HttpProblem.code` 按宪章等于类名；线上问题文档的
    JSON 字段名 `code` 不变；skill / tour / 标准库文档同步，`velar fix` 改写 `.problem.code` 读取。
13. 静态文件 `root` 的相对路径**以应用自己的目录为基**（发射入口所在目录），绝对路径照给；文档写明。

派发：F7-core（8–11 + F6b 的 compiler 卫生项，F5-core 合并后即派）；F7-web（1–7，等 R2c 落地后派，
4 / 5 / 7 落在运行时文件上）；F7-node（12–13，等 R2d 落地后派）。发版 0.30.0 在三波之后：
Core 摘要因第 11 项与新拒绝移动（`core@0.8`），web 因第 2 项签名变化再移一次，node 因第 12 项契约变化移动。

### 同侪会话发了 0.29.1（2026-09-06 晚，编排会话记录）

Codex 会话在 main 上（我的 Linux spawn 热修 `435f38b` 之上）推了四笔：`790d288` cli 构建与包边界加固
（186 文件、2.4 万行，含 `scripts/release-output-transaction.mjs` 与 `check-runtime-boundary.mjs` +397 行）、
`4e00380` release 0.29.1、`b34305a`、`4680c24`；标签 `v0.29.1`，发布工作流由它自己触发。其 CHANGELOG 0.29.1
段只记了 `web@0.13`（F5-web 的内容）与它自己的工具链条目——**漏记**了同在该版里的 F3 / F4 语言项、F5-node
的全部 Node 变化（BOM、spawn、中间件、问题文档、VEL6007 / VEL6008）、R1f / R2 / R2b / 围栏门。
处理：把这些条目补进 0.29.1 段（记录不是重算，D110 规则 3 只约束表面计数），0.30.0 从 F5-core 起算；
`origin/main` 并回集成分支（干跑无冲突）。R2c / R2d 正在改的 `check-runtime-boundary.mjs` 与
`packages/server/src/{compiler,runtime}.ts` 与 Codex 的改动会撞，合并时按「两边都要」解。
教训（第三次）：Codex 发版前不看 D114 的发版计划，也不会补别人的 CHANGELOG 条目——每次它推 main 后
先 `git log origin/main`，再决定自己的版本号与条目归属。

### 浏览器测试进程残留（所有者 2026-09-06 报告；B1 波）

所有者机器上一组 VelarScript 浏览器测试进程在启动者消失后活了近 2 小时：主进程 95–100% 单核、
输出管道已断，外加 4 个 Chromium 子进程与一个旧版应用辅助进程。已读到的泄漏路径：
`scripts/run-project-gate.mjs` 用 `spawnSync` 起 `velar test --browser`——无进程组所有权、无超时、
无 IPC；而 `velar test` 的监督进程只靠 IPC `disconnect` 事件（`observeBrowserWorkerParent`）得知父进程
已死，这条路径上根本没有 IPC，于是门脚本一被杀，监督进程、工作进程与 Chromium 全部成为孤儿。
CPU 打满的原因需要复现（候选：管道关闭后的写循环、Playwright 重连循环、页面对死服务的重试风暴）。
B1 波（worktree `b1-browser`，从 `origin/main` = v0.29.1 分出，因为 Codex 的 0.29.1 大改了 `packages/cli`）：
复现 + `sample` 取热帧；每个长命进程按秒看 `process.ppid`、把 stdout/stderr 的 EPIPE 当作「读者已走」；
门脚本以进程组拥有子进程并带截止时间（复用 `browser-process-owner.ts`，不写第二个监督器）；运行器
`exit` 处理器同步杀 Playwright 浏览器服务进程作最后手段；所有路径的上限收成一个常量；测试用环境变量
标记验证 SIGKILL 父进程后 15 秒内无残留。

### 并发波数的上限（编排会话，2026-09-06）

六个波同时在所有者机器上跑门，负载均值 36–48，所有按墙钟计预算的测试全红（`performance-runtime` 25 条里
7 条、`hardening-cli-project-graph` 的节点上限预算）——程序逐字节未变，红的是机器。裁定：编排会话同时最多
派 **三** 个波；预算类测试全部进重层（D116：只在发版前、安静机器上跑一次）。集成头 `83ad163`
（0.29.1 合并 + CHANGELOG 补记）的重门结果：打包验收绿、浏览器绿、全量套件只有这三条预算测试红。

### 0.29.2 合并与一条红测试（编排会话，2026-09-06）

Codex 又发了 0.29.2（`6c3d055` / `cf5ec4c` / `1693c04`），并回集成分支无冲突。快层只红一条：
`tests/server-configuration-output.test.ts:195`「standalone Server snapshots follow a transitive extension
runtime dependency after relocation」——`directory/main.js` 不存在。在 `origin/main`（`1693c04`）的干净
worktree 上同样红，所以不是 F5-core 合并引入的；是 Codex 的测试在本机环境上的问题（或真缺陷），
以它自己的 CI 结论为准，等 CI 出来再定归属。另：worktree 的 `node_modules` 从「符号链接到主 checkout」
改为**真拷贝**（工作区链接除外），因为 0.29.1 的构建边界把经符号链接解析到工程外的路径当作逃逸——
`directory-build-input-safety` 在链接式 worktree 上会以错误的理由变红。

### B1 落地（2026-09-06，提交 `a1acf7b`）

复现（`run-project-gate.mjs browser` 被 `kill -9`）：监督进程与工作进程以 ppid=1 存活、CPU 0.0、三分钟不退——
是**确定性挂起**而不是自旋。根因：① `exitBrowserWorker` 先 `await flushWritable(process.stdout)`，而 flush 在
EPIPE 上**拒绝**，`process.exit` 与 `process.disconnect()` 都没跑到，活着的 IPC 通道把事件循环永远挂住，
监督进程则永远等 `child.once("exit")`；② 监督进程只靠 IPC `disconnect` 得知父进程已死，`spawnSync` 没给通道；
③ 无 `error` 监听的 EPIPE 成为 uncaughtException，被测试通道吞成失败、再写出更多输出、再失败——自喂的写风暴；
④ `velar dev` / preview 对被遗弃无应答；⑤ Playwright 的浏览器在自己的进程组里，对工作进程组的 kill 够不到它；
⑥ `browser.acceptance.ts` 的 `stopChild` 只发给进程不发给组，漏掉 esbuild 孙进程。
修法：新 `packages/cli/src/process-lifetime.ts`——`watchParentDeath`（按秒看 `process.ppid`、stdout/stderr 的
EPIPE / ERR_STREAM_DESTROYED、IPC `disconnect`，任一触发即走调用方自己的 SIGTERM 停止路径）与同步 `exit`
兜底网（对拥有的子进程组 SIGKILL）；`browser-process-owner.ts` 导出唯一的运行上限 `browserRunDeadlineMs`
= 20 分钟与清理宽限 10 秒，flush 不再拒绝且有界，`launchOwnedBrowserServer` 把 Playwright 进程登记进兜底网；
`run-project-gate.mjs` 与 `installed-browser.acceptance.ts` 改经 `superviseBrowserWorker`（独立进程组、截止时间、
信号转发、兜底网），不再 `spawnSync`；dev / preview 服务器看护父进程；`check-runtime-boundary` 钉住这些形态并拒绝
`spawnSync` 回流。六条卫生测试在各层级杀启动者并断言带标记的进程 15 秒内全无（关掉看护即红，非空转）。
所有者看到的 95–100% CPU 本机未复现；同机另有 openvoxel 工程（ChatGPT/Codex 会话的 `test:web-ui`）留下的
`chrome-headless-shell` 550% CPU，不属本仓。

### R2d 落地（2026-09-06，提交 `2e8247d`；D115 P3 的 node 与 server 部分——P3 至此**全部完成**）

27 个 `String.raw` 字面量 → 34 个 `runtime/*.js`（10,299 行）加两份 manifest；`packages/{node,server}/src`
不再含任何模板运行时，两个作用域的原始模板名单为空——每个字面量都是运行时体、Worker 源码或组合，
没有代码生成片段。Worker 源码（node-host、process、terminal、stdin 子进程）成为普通运行时文件，由新的
`json` 部分种类启动（启动器借用常量，生成器发出 `JSON.stringify(X)`），两处 `.replace("WORKER_SOURCE", …)`
占位替换退役。两处每次编译不同的洞保留为装配：`velar/server` 的 `applicationConfigurationPath`，
`velar/serve` 的 `routeShapeFromSegments.toString()`（D90 R19(c)：必须经 `dist` 读取，源码形态与
tsc 产物不同，解析进文件会改变另一边的发射）。`IMPORT_SOURCES` 新增文件形式：一个包可在任何 `dist`
存在之前借用另一个包运行时文件的文本（desktop 借 `VELAR_PROCESS_HOST_RUNTIME`），`publishedRuntimeFiles`
交叉检查发布方常量仍恰是该文件。`check-runtime-boundary` 的 11 个 Node 源码读取器全部改经 manifest
（约 140 条短语检查、动态加载与 `node:` 导入扫描、`requests.delete` 计数、`ServeRequest.parse` 顺序规则），
F4 那条 `import { VELAR_PROCESS_HOST_RUNTIME } …` 精确字串规则改为对生成模块与组合的断言。
828 文件逐字节相同（重切整行前后各比一次）；`node@0.16` / `server@0.15` 摘要不动；允许名单 33 → 31 文件、
36 → 35 函数（`packages/node/src/compiler.ts` 1,414 → 894）。

后续队列：① `packages/node/runtime/serve.js:177` 注释仍写着 `node-host-worker-runtime.ts`，该注释在发射的
`velar/serve` 模块里，改它会动指纹——搭下一个允许改产物的波；② `tests/node-process-spawn-failures.test.ts`
以 10 秒就绪握手赛跑、机器饱和时假红——改事件等待（与 `desktop-services` 共享路径项同队）；
③ `scripts/build-packages.mjs` 声称按 `RUNTIME_PACKAGES` 顺序重生成以让后根借到前根的常量，但
`generateAllRuntimeSources` 先算完再写，改 compiler 运行时后 core / desktop 要跑两遍生成器——改成迭代到
不动点或按依赖序逐根写入。

### R2c 落地（2026-09-06，提交 `78e56de`；D115 P3 的 web 部分）

34 个 `String.raw` 字面量（加一个普通模板）→ 52 个 `runtime/*.js`（8,004 行）加 manifest；全部是运行时体，
零代码生成片段，`packages/web/src` 的原始模板名单为空。1,108 行的 `webRuntimeFoundation` 看似逐次编译的构建器，
其唯一的洞在模块级绑定到两个生成时常量之一（内联 vs 导入错误规范化），所以是**组合而非装配**：体成为
`foundation.js` + `flush.js` + `graph.js`，两个导出常量是两张部分表；`runtime-foundation.ts` 删除（1,685 → 0），
该函数离开允许名单。唯一逐次编译的内容是 `webRuntime` 的 Look 关键字名册，作为两个装配保留。17 处解析进文本的
插值各带断言（注册键、schema 版本、`LOOK_TRANSITION_PROPERTY_KEYWORDS`、`LOOK_TOKEN_NAME_PATTERN`、
`LOOK_PROPERTIES` 名册及其大小）。`runtime.ts` 3,774 → 57，`emitter.ts` 3,445 → 1,365；六个运行时模块删除、
无门面。`check-runtime-boundary` 的 Web 扫描全部经 manifest；五条 `includes("${X}")` 组合断言改为部分表检查。
828 文件逐字节相同；`web@0.13` 摘要不动；允许名单 33 → 31 / 36 → 35。
记录三条：`emitted-settle.js` 是唯一没有尾随换行的运行时文件（`WEB_RUNTIME_BODY` 曾被 `.trim()`；补一个换行
会让每个发射的 Web 程序多一字节而 `check:runtime-sources` 仍绿——与 R2b 的 `velar/id` 尾空格同形）；
`check-runtime-boundary.mjs` 的 `constantSource()` 现为死代码，留待 R2d 合并后在 F6 删；
`tests/node-process-spawn-failures.test.ts` 在负载 46–60 下假红（与 R2d 所见一致），进争用形状名单。

**P3 收官**：五个包的运行时 JavaScript 全部成为 `packages/*/runtime/*.js` 真源码（compiler 34、core 19、
desktop 23、web 52、node 31、server 3 个文件），一个生成器、一个 manifest 约定、一道 `check:runtime-sources` 门，
`src/` 里不再有多行 JS 模板字串；每片发射产物逐字节相同。合并顺序：B1 → R2d（与 Codex 0.29.2 的
`packages/server/src` 改动有冲突：新的 `artifactConfigurationPath` 洞要进 R2d 的装配）→ R2c（与 R2d 在
`generate-runtime-sources.mjs` / `check-runtime-boundary.mjs` / `runtime-sources.test.ts` 的共享行相撞）。

### F6a 落地（2026-09-06，提交 `74cb0d7`）

① Desktop 应用支持根可移（`VELAR_DESKTOP_APP_DATA_ROOT`，两个宿主各一处定义：`development-services.ts`
与 `VelarDesktopHost.swift`），`run-node-tests` 给每次运行一个按 checkout 的根和按 checkout 的 `TMPDIR`——
20 个测试文件里 32 个固定 `tmpdir()` 名字与共享的 `service-logs` 一并隔离；② 被信号终止的测试子进程说出信号、
已完成测试数与正在跑的文件（第二个无输出的 reporter 同步追加进度）；③ `build-packages` 在 `CI` 下拒绝陈旧的
生成文件并点名包 / 文件 / 首个不同常量 / 改法；④ 争用形状：`performance-runtime` 的 Core/JS 比值改用能塞进
一个调度量子的 1M 迭代样本（31 轮交替、各取最小）——两倍超订下 0.95–1.05（原 1.49）；`cli-13` 的 500 ms
静默等待改为哨兵写入 + 事件等待；`beta-1` 探针内取五次最小；`desktop-worker` 九处偶然截止时间共用一个 30 s
常量；⑤ cli / core / desktop 的 build tsconfig 开 `noUnusedLocals`，清掉七处死导入 / 死函数与 `mapUnknown`。
`noUnusedParameters` 不开（cli 两处会红，只给两包开是第三种拼写）。指纹逐字节相同。

F6a 发现的两项**产品缺陷**，归 F7-node（`packages/node`）：
- **`velar run` 在 CPU 争用下静默以 0 退出、`@main` 未跑完**（16 个自旋进程 / 10 核下约 1/3–1/10 复现：
  stdout 只有 `entering main`，status 0，无 stderr）。疑点：`__velarNodeProcessUpdateReference()` 只 re-ref
  `__velarNodeProcessPort`，`__velarNodeProcessWorker` 在 ready 后被 unref 且再不 re-ref，一个在飞的调用可以
  让事件循环里没有任何东西撑着。这是「成功却没做完」，优先级最高。
- `tests/node-process-spawn-failures.test.ts` 的 10 s 就绪握手在饱和机器上赛跑（与上一条同源）。
另两条进 T2 / F6b：`tests/compiler.test.ts`（33 处）与 `hardening-cli-dev-server.test.ts`（12 处）共用 16 个
固定 TCP 端口 42880–42896——两个 checkout 同跑 `npm test` 时第二个的 `fetch` 会被第一个的 dev 服务器应答；
改成 port 0 + 发现（仓里已有 `freePort()`），比机器级锁更好；`performance-runtime`「acyclic runtime Type checks」
是 66–157 ms 的固定墙钟预算，无法用量子法救——归重层（D116），或按同窗参照归一化。
compiler 包的 `noUnusedLocals` 会报 95 处（名单在 scratch-f6a），F7-core 的 h 项处理。

### T1 落地（2026-09-06，提交 `2dfd799`；D116 的实现）

`scripts/gate-scope.mjs` 把改动集（与 `origin/main` 的 merge-base 之后的 diff ∪ 工作区）按前缀归到所有者，
沿包图向下游闭包，选出归属相交的测试；`tests/ownership.generated.json` 由导入分析推导（起始 273 个文件、
零未分类；十个最难判的：`compiler.test.ts` 因起 `check-documentation-examples.mjs` 而属 `repo`、
`server-port-zero.test.ts` 读 `docs/ai-skill-server.md` 因而**文档改动也能改变一个 Node 结论**——所以 `docs`
成为测试可持有的所有者，纯文档改动跑恰好两个读文档的测试，这是对 D116 §三「文档只跑 check」的有据偏离，
接受）。`tests/heavy.json`：140 个历史 `hardening-*` + 超 20 s 的快层文件。`npm run gate` = check + 与入库
`output-fingerprint.lock` 比对 + 范围内 Node 文件 + 工程单元门；`release:check` 是重层唯一的家。
实测：`npm test` 1,497 测试 / 480 s → `npm run gate` 895 测试 / 202 s，浏览器与打包验收整个离开每波路径。
**指纹 lock 的可移植性**：原先把工程构建到临时目录，Web 包的 source map `sources` 相对输出目录、内容哈希
资源名随之变化——同一 checkout 搬深三层目录就有 6 个文件变、24 个重命名；现改为构建到工程下固定深度
`.velar/fingerprint/<mode>`（gitignore、构建前后清理），跨 checkout 路径逐字节相同。**此前会话里所有旧格式的
基线文件不再可比，以入库 lock 为准。** CI：`scope` 作业喂快层作业；重层作业只在标签、每日 03:00 UTC 与手动触发。
落地时的两项裁决：`compiler.test.ts`（55 s、快层 40% 的测试）**留在快层**直到 D115 P5 拆完；
`release:check` 增加 lock 比对。B1 的六条卫生测试（41 s）进重层。所有者机器上并发波数上限三个（见上）。

### M1 落地——P3 收官（2026-09-06，合并 `34e625d` / `40a7ef2`，集成提交 `4e92eba`）

R2d 与集成分支的冲突按「同侪的发射文本为真、R2d 的结构为真」解：`server.js` 只剩导入块（含 0.29.2 新增的
`node:path` / `node:url`），两个相邻的整行洞（`applicationConfigurationPath` 与
`__velarServerArtifactConfigurationPath`）各带样本，`server-application.js` 以 `__velarServerResolveConfigurationPath`
开头并接过原先结尾的内建捕获块；`serverConfigurationLocationRuntime` 的模板消失（`packages/server/src`
在原始模板作用域里）；对同侪函数四组实参逐字节相等。R2c 合并：`RUNTIME_PACKAGES = compiler, core, desktop,
web, node, server`（顺序只为读者——借用的常量从磁盘读，不从生成模块读）；两边的 `IMPORT_SOURCES` 文件形式与
`RESOLVED_INTERPOLATIONS["web"]` 都保留；`check-runtime-boundary` 取并集并删掉死的 `constantSource()`；
允许名单逐条三方合并（任一侧删则删，否则取低），只有 `emitter.ts` 留在集成分支自己长到的 1613。
字节一致的证明要点：旧格式的基线跨目录不可比（Web source map 的 `sources` 相对输出目录、内容哈希资源名随之变；
同侪新增的 `.velar-build-output.json` 回执记录构建的绝对输出目录与随机 `buildId`）——同一绝对路径下
`05f7d6e` 与合并头各构建一次比对：836 文件里 832 相同、4 个回执按构造不可复现。据此 `output-fingerprint.mjs`
**排除回执文件**（它记录的是构建，不是程序），T1 已把构建目录固定在工程下 `.velar/fingerprint/<mode>`；
两者合起来，入库的 `output-fingerprint.lock`（832 个文件）跨 checkout 与 CI 可比。
`npm run gate` 在合并头上：check 绿、指纹与 lock 逐字节相同、165 个快层文件里唯一的红仍是同侪的
`server-configuration-output.test.ts:195`（macOS CI 上同红，F6c 在查）。

### F6c 诊断（2026-09-06）——同侪四条红测试的归因

① `server-configuration-output.test.ts:195`：**不是平台问题**。`6c3d055` 让清单工程里的显式源码保留工程相对路径，
`velar build src/main.vel --out-dir directory` 发射到 `directory/src/main.js`（`docs/cli.md` 同笔已写明，
兄弟断言 `explicit-entry-scope.test.ts` 同笔已改），只是漏了这一条。改一行测试。
② ③ `build-output-claim.test.ts:390 / :531`：两条都只靠 `(dev, ino)` 证明「对象被替换」，却先 `rm` 再在同路径
新建——APFS 永不复用 inode 号，ext4 / tmpfs 常复用，所以只在 macOS 绿。改成原对象仍在时先建替换物再 `rename`
进位（两文件不能同时占一个 inode 号）。**设计层给所有者 / 同侪**：产品的目录身份模型只有 `(dev, ino)`，Linux 上
inode 复用因此按构造不可察觉——加 `birthtime` / `ctime` 或 fd 钉住的 stat 要动证据格式。
④ `build-output-claim.test.ts:652`「concurrent CLI tree and nested standalone builds cannot both succeed」：
墙钟赛跑——20,000 文件的树声明窗口（本机 584 ms，纯 unlink 吞吐）对冷启动嵌套 CLI（219–245 ms），CI 的
3–4 vCPU 与 ext4 让两边反转。同一拒绝已在 `:85` 由进程内确定性覆盖；`:652` 唯一的内容就是 CLI 对 CLI 的时序。
交同侪：需要 CLI 里一个环境门控的确定性持有点，不是调大种子数；并把 `directoryBuild.exitCode` 并进断言消息。
⑤ `[WEB-D3]`：八个作业日志里出现一次，firefox `page.goto` 30 s 超时，启动抖动，不追。
⑥ **B1 的卫生测试 `browser-process-hygiene.test.ts:95` 在 ubuntu 上红**（监督进程、两个 worker、
`chrome-headless-shell` 四个带标记的进程存活）——B1 只在 macOS 验证过；Linux 上孤儿的 `ppid` 变化与进程组信号
可能受 GitHub runner 的 subreaper 影响。该文件在重层，快门看不见。**B2**：本机无 Linux，用 PR 驱动 CI 迭代。
指纹回执问题 F6c 独立证实（同一回执只替换 checkout 路径即得 lock 里的哈希）——`07129b0` 已排除回执。

### F7-core 落地（2026-09-06，提交 `3cf0e2c`；设计层第 8–11 项 + F6b 编译器卫生；`core@0.7 → 0.8`）

**8** `TimeoutError` 是 Core 的**宿主错误类**（不是编译器错误类——判据是谁抛：编译器注入的守卫抛
`IndexError` / `NarrowingError` / `ValidationError`，超时由 Core 运行时模块的能力抛，与 `FileNotFoundError` 同族；
`is TimeoutError` 降级成对一个类的 `instanceof`，两处抛出者都得导入它）；`Promise.timeout` 与 `velar/task.withTimeout`
都抛它，`TaskTimeoutError` 退役（`RETIRED_MODULE_EXPORTS` 的迁移现在也改写类型位）。**9** 三个名字进 guided
名册：七个声明位各一句拒绝并给替换，`class object:` 不再能运行；注解位保留 VEL2012。**10** `Pair<A, B>` 在
`types/from-syntax.ts` 解析为结构记录 `{first, second}`——字面量即构造器，可赋值性与发射按构造不变
（tour 的 `08-collections-and-math.js` 不在指纹差里）；`display.ts` 对恰是该形状的对象打印 `Pair<A, B>`；
`Pair` 进内建类型名名册。**11** `surface-inventory.mjs` 新增五类规范表（value-method 28、error-class 11、
builtin-type-name 14、advisory 18、retired-spelling 29），369 / 11 类 → 468 / 16 类，`core@0.8`
（摘要 `b6ef31d5…`），退役的模块导出不再算 `module-export`（79）。
F6b：`A18` 替 VEL6010（`ADVISORY_ROSTER` A1–A18；`velar-allow A18` 需要 `advisory-suppression` 把工程图码的
压制**延后**到 `compile()` 之后再应用，故 `project.ts` 改了一处导入与一处表达式，行数不变）；VEL3007 对前置名
说「无需导入，删掉它」；extern 契约里 `export class null:` 六条解析错 → 一条，`detach` 表达式位一条；
`extends Error` 无构造器只报声明处（`ClassInfo.constructorRefused`）；文档覆盖门的 `unknown` 级联宽容退役，
两处动态导入围栏由新的 `// velar-module <path>` 前言声明兄弟模块后完整检查；`astNodesOfKind` 出扩展面
（79 → 80）；compiler 开 `noUnusedLocals`，96 处修掉，`analyzer.ts` 3,243 → 3,166（内建错误注册表移到
`analysis/builtin-errors.ts`）；`dev-server-dependency-reload` 改为等服务器自己的「rebuilt in」行。
指纹：56 文件变、38 资源重命名，全部归于 8（共享错误运行时）、11（清单里的 `core@0.8`）与三处 tour 重命名
（宪章 / tour 里的 `type Pair<A,B>` → `Sides`、tour 的 `class TimeoutError extends Error` → `BudgetError`）。
留档：`TaskTimeoutError` 在 `interfaces/task.ts` 留作墓碑（删掉会让工程驱动在迁移旁再报一句「无此导出」）；
`packages/core/src/index.ts` 的 `coreModuleDependencies` 加两行（`velar/async` / `velar/task` 导入编译器错误模块）；
`docs/web-api.md` 改一个名词（worker 调用超时现在抛 `TimeoutError`）。

### F6d 落地（2026-09-06）——同侪赛跑测试的确定性持有点

新模块 `packages/cli/src/test-hold-points.ts`：`VELAR_TEST_HOLD_TREE_CLAIM` 指向一个文件路径时，目录构建在
取得树声明之后、交还预留之前（`build-output-directory.ts` 的 `reserveBuildStaging`）按 25 ms 轮询等该文件出现，
上限 30 s（超时继续构建而非抛出，让测试死在自己的断言上）。生产从不设置它——门证明发射产物逐字节不变。
`tests/build-output-claim.test.ts:652` 不再种 20,000 个文件撑窗口：一文件种子、设变量起目录构建、观察磁盘上的
声明标记、起嵌套独立构建断言 `:85` 同一句拒绝（消息里带上目录构建的退出码与已输出内容）、再创建释放文件、
断言目录构建以 0 退出。三次连跑与 12 个自旋进程下三次全绿；持有点是承重的（释放延迟 0 s → 1.6 s 退出，
5 s → 5.1 s）。至此同侪四条红测试三条修复、一条确定化，main CI 应回绿（ubuntu 上 B1 卫生测试仍红，在重层）。

### F7-web 落地（2026-09-06，提交 `8e46a12`；设计层第 1–7 项；`web@0.13 → 0.14`）

**1** 属性展开：词法器在属性名位整块读取花括号区域、只报一次，`...` 开头时说「JSX 没有属性展开；组件的
prop 由契约点名，把属性写出来」；`scanElement` 超 120 行，属性扫描抽成 `scanAttributes`；宪章 §19 加条目
（`look:` 块的 `...spread` 除外）。**2** `hsl` 的两个槽位改为 `Percentage`（`compiler.ts` 发布签名、`look.ts` 的
范围元组带单位、`look-static.ts` 折叠 `%`、`runtime/look-head.js` 的 `lookPercentageRange`）；裸数字每槽只报一次
——把 Core 自己的 VEL4001 就地改写成「HSL saturation is a percentage, and 50 is a number; write 50%」并带
`velar fix` 编辑，而不是追加第二条；`hsla` 不存在。**3** 只改文档：区域只在决定形状的读变化时重建，删掉
「搬出去或加 key」那句，加 JX-R9 形状的围栏。**4** `runtime/foundation.js` 加全局 tick 等待者单元
（`Symbol.for("velar.web.tick.waiters.v1")`，观察者序列的同一套模式——等待的 `tick()` 与失败的刷新可能在两份
运行时里），`escalate` 在任何宿主下只要有 `tick()` 在等就把失败交给它；Node 不变（仍 trace 且 reject）。
**5** `__velarFatalNode(message)` 从 fatal state 拆出，`__velarChild` 的 catch 返回该元素（`role="alert"`、
`data-velar-fatal`、「This part of the page could not start: …」），隔离与 `render` 相不变。**6** 新
`analysis/reactive-names.ts`（派生表、state 名册、显式的 `unconditionalReads` 遍历），`watch-cycles.ts` 的
`watchDerivedSourceWrite` 出消息；遮蔽从两侧封死（模块名册答「恰声明一次」，`reactiveBindingKind` 答「这次写
真是写 state」）。**7** `runtime/graph.js` 在 `reactiveValue` 交回经 state 图到达的未包装类实例的唯一咽喉处，
开发宿主用存取器对（保留身份、原型与 `self`；proxy 做不到）观察其可写数据字段，`computed` / `watch` 观察者运行中
的读经冻结读探测器的 `frozenRead` 通道报一次并点名 cell、类、字段；`stateCellName` 沿所有权图有界广度优先
找到一两层之上的 cell；生产只多一个恒假常量。
发现：watch 的**体**是不追踪地运行的，读类字段是活的、不陈旧——陈旧的是 watch **主题**读该字段，探测器报的
正是它（两个方向都有测试）；**邻格未关**：DOM 插值 `{box.value}` 同样永久陈旧却不在裁决之内——编排裁定
纳入（`mode === "dom"` 的读同规），进下一小波；`min(100, 600px)` 仍是 Core VEL4001 + Web VEL5042 双报——按
`hsl` 的改写路径处理，同一小波；区域的 fatal 元素是 HTML `<section>`，SVG 命名空间区域里会是 SVG 内容中的
HTML 元素——边角，未演练。
表面：`web@0.14`（摘要 `28e2b3d1…`），`packages/desktop/package.json` 的 `composes` 钉版随之（desktop 的契约
从 web 的 `apiVersion` 派生并校验）；`tests/surface-versions.test.ts:143` 硬编码「下一个 web 版本」文字，每次
web 升号都要动。lock：Web 面五个工程 × 两种模式 75 行变化（36 处资源重命名），Core / Node / Server 逐字节不变。
合并时与 F7-core 的 `core@0.8` 在四份 `velar.json`、`create/src/types.ts` 与 lock 上相撞，两边升号都取。

### F7-node 落地（2026-09-06，提交 `78aa69b`；设计层第 12–13 项 + F6a 的缺陷；`node@0.16 → 0.17`）

**A `velar run` 静默以 0 退出**：本机约 850 次尝试（16–24 个自旋进程）未复现，但机制被确定性地证明了——
`packages/cli/src/uncaught-program-error.ts:116` 的 `import(entryUrl).catch(...)` **不 await**，发射的 `@main`
（`dist/main.js` 里的顶层 await 块）是被动态导入的模块而不是主模块：主模块的顶层 await 未决 Node 以 13 退出，
动态导入的未决则排空事件循环、以 **0** 退出、stdout 截断——正是 F6a 的症状。引用记账的洞同时修了：
`process` / `node-host` / `terminal` 三个 Worker 家族各一个 `…Outstanding()` 谓词（就绪握手 + 每个在飞请求 +
每个存活的自有资源，从不是已定的失败），`…UpdateReference()` 据此**同时** ref / unref Worker 与端口；三个
`*-boot.js` 里就绪后的双 `unref` 换成一次 `…UpdateReference()`。**未关的那半在 cli**：启动器应持有入口的
promise，`beforeExit` 时入口未决就报有名失败、非零退出——任何未来的排空都成为有名失败而不是 0。→ F7-cli。
**B** 就绪期限三处 `10000` 字面量收成各家族一个 `…ReadyDeadlineMs = 30_000`，超时走各模块自己的失败路径并
点名。**12** 契约与运行时把 `code` 改名 `reason`；线上问题文档的 JSON 字段仍是 `"code"`（编码器把
`problem.reason` 写进去），OpenAPI 不变；`HttpProblem.code` 回到 Error 契约的类名；在 `HttpProblem` 类型的接收者上
读 `.code` 报 VEL4001 并带机械改写到 `.reason`（`velar fix` 只吃诊断修法，advisory 不进 fix——所以是诊断而不是
advisory，与退役集合成员同形；`.code` 因此不再编译）。**13** `fileResponse()` 把相对 root 解析到
`import.meta.dirname` 上两层（发射的 `velar/serve` 在 `<app>/node_modules/velar/serve.js`），三个消费者一个漏斗；
不能用 `velar/path` 的 `fromFileUrl`，因为 `check-runtime-boundary.mjs:1509` 钉死了 `velar/serve` 的依赖数组。
**13 的后果与修订**：`velar run` 把工程编进 `<project>/.velar/run-XXXX/` 沙箱，「发射入口所在目录」于是是沙箱，
相对 root 在开发时找不到作者的 `public/`；目录构建 `dist/` 同理会指向 `dist/public`。所有者说的「应用自己的目录」
意思是**工程目录**。编排修订：编译期已知输出目录相对工程根的偏移，把偏移烤进发射的入口
（`__velarServeProjectRootOffset`），相对 root 先按 `<入口目录>/<偏移>` 解析（在树内的构建与 `velar run` 都回到
工程根），该路径不存在时回退到入口目录（搬迁后的独立产物把资源放在入口旁）；文档写两句。→ F7-node-b。
**C** `serve.js:177` 注释改指 `VELAR_NODE_HOST_WORKER_SOURCE` 组合的三个文件。
表面：`node@0.17`（摘要 `ba56696d…`），`server@0.15` 不动；desktop / server 的 `composes` 钉版随之。
lock：20 个文件（tour/core 与 tour/node 的 `velar/process.js` / `terminal.js` / `node-host-v1.js` / `serve.js`、
`01-server.js`、四个运行时包回执与两个 `velar-node.json`）。合并时与 F7-core / F7-web 的升号在
`create/types.ts`、`desktop/package.json`、三个测试文件与 lock 上相撞，三边升号都取。
新规则进了自己的模块 `packages/node/src/serve-problem-analysis.ts`（86 行），`compiler.ts` 与 `server-analyzer.ts`
回到各自上限。

### F7-web-b 落地（2026-09-06，提交 `3d91c0d`）

① 陈旧读探测器覆盖 DOM 插值（`observer.mode === "dom"` = 全部渲染观察者），报告措辞只换点名读者的两个短语，
去重键与通道不变；web-api 段落点名三种读者。② `min` / `max` / `clamp` 的裸数字按 `hsl` 的就地改写路径只报一条
（「min's first argument is a Length or a Percentage, and 100 is a number; write 100px or 100%」），不给 `velar fix`
（`100px` 与 `100%` 是两幅图，无机械答案）；零也纳入（这三个槽位的规则统一）；`taught` 标记让写进 Core 报告的
教导仍算「调用自拒」（LK-I2）。`hardening-web-surface.test.ts` 的 `clamp(100, …)` 行迁到 `web-hsl-percentages.test.ts`。
裁决：开发宿主运行时与消息的变化**不动** `web` 计数（无新名字）；`webUntracked` 的临时观察者被措辞为
「interpolation」，事实为真、名词松，不加 `stopped` 例外。**队列**：只收 `Length` 的构建器（`blur` / `border` /
`shadow` / `dropShadow`）仍是 VEL4001 + VEL5042 双报——同法、长度句；SVG 命名空间区域里的 fatal 元素。

### B2 落地（2026-09-06，提交 `7a36913`）——F6c 第 ⑥ 项：B1 的卫生测试在 ubuntu 上红

归因是**算术**，不是平台，证据在同一份日志里：`34009713955` 的 ubuntu 作业中，同一棵树、同样的杀法、
给 60 秒窗口的那条（`✔ a browser gate whose launcher is killed leaves nothing behind`）**用 22.78 秒通过**，
给 15 秒的 `:95` 红；而四个存活进程里第一个就是门脚本自己（`8265 node scripts/run-project-gate.mjs browser`）——
它「被 `kill -9` 过」却还在，说明测试杀的根本不是它。两件事合起来是全部真相。

五条假设的处置：**(a)(e) 排除**——Linux 对僵尸的 `/proc/<pid>/environ` 返回空，本就匹配不上标记，
发现路径也没有跨用户权限问题；**(b) 排除**——`watchParentDeath` 比的是**起始 ppid** 而不是 1，subreaper 不影响；
**(d) 本机实测排除**——`chrome-headless-shell` 由 `--remote-debugging-pipe` 拴在启动者身上，
把启动它的 node 进程 `kill -9` 后浏览器**1 秒内自行退出**，所以「组杀够不到 Playwright 的进程组」不构成残留；
**(c) 成立**：`superviseBrowserWorker` 的强杀宽限是 `cleanupTimeoutMs + 5s` = 15 秒，而且**每层监督各付一次**。
浏览器门是三层（`run-project-gate.mjs` → `velar test` 监督进程 → worker），于是「1 秒察觉重定父 + 15 秒才动手 +
1–2 秒浏览器看到管道关闭」≈ 19 秒，对着 15 秒的断言。macOS 上同一条只用几秒，纯粹是那台机器快。

修法四条。① **产品**：强杀宽限成为自己的常量 `browserStopGraceMs = 5_000`，不再由清理超时派生——那 15 秒买不到
东西：worker 停在可放弃的 await 上不到一秒就交出浏览器，停在放弃不了的 page 调用里则给多久都不答话，
而浏览器两种情况都会走（Playwright 用管道拴着它，启动者一死管道就关）。宽限买的是**回话**，不是卫生；
已经定下来的停止不是谈判。五秒，每层各一次。② **测试**：窗口不再写死，由两个源文件导出的常量推出——
`3 × (parentDeathPollIntervalMs + browserStopGraceMs + 2s)` = 24 秒（`parentDeathPollIntervalMs` 因此导出）；
写死的数字在下一台机器上还会错一次。③ **测试**：发现路径读回 parent / pgid / state（macOS 多两个 `ps` 列，
Linux 多读一个 `/proc/<pid>/stat`），忽略僵尸（内核只留退出状态的进程不持有任何浏览器），失败时打印
**每次轮询的树形变化**加启动者自己的输出——CI 上登不进去的机器，红了要能自己说出停在哪一级。
④ **测试保真**：`:95` 原本用 `command.includes("run-project-gate.mjs")` 找门脚本，而
`/bin/sh -c "node scripts/run-project-gate.mjs browser; echo gate-done"` 的 cmdline **也**含这个名字、pid 还更小——
它一直在杀那个 shell，即第一条测试的复制品；改为按 ppid 认门脚本（门脚本是 shell 自己的孩子）。

本机六条绿，`npm run gate` 绿，`output-fingerprint.lock` 逐字节不动。CI 一次（`workflow_dispatch` 打在
`wave/b2-linux-process-hygiene`，重层才跑该文件，运行 `34017864608`）：ubuntu 重层六条全绿，
`:95` 从 18.51 秒的红变成 3.77 秒的绿，第一条从 22.78 秒降到 4.34 秒；该作业 3,534 条里唯一的红是
`build-output-claim.test.ts:662`（F6c 第 ④ 项的墙钟赛跑，main 上同样红，属他波）。
`docs/contributing/continuous-integration.md` 的进程归属段同笔改：三个数字（20 分钟运行截止、
10 秒单次清理超时、5 秒停止宽限），并写明宽限为什么短、卫生测试的窗口为什么是推出来的。
遗留一条：`scripts/check-runtime-boundary.mjs` 钉住了该家族的形状短语，但没钉 `browserStopGraceMs`
（该文件不属本波）——想让宽限不被悄悄改回派生式，下一个动 scripts/ 的波补一条短语即可。

### 所有者 2026-09-06：「继续，两个波落地后直接发 0.30.0」

F7-node-b 与 T2 落地后即发 0.30.0（`core@0.8 · web@0.14 · node@0.17 · server@0.15 · desktop@0.10`），
按 D116：发版前在安静机器上跑一次 `release:check`（重层唯一的家），绿则打标签、触发发布工作流、验证 npm。

### F7-node-b 落地（2026-09-06，提交 `1ac247f`）

① 启动器持有入口的 import promise，`beforeExit` 时未决则经同一格式化器打印一条报告
（「velar run: the program's @main did not finish: the event loop drained while an awaited value never settled」）
并以 **13** 退出——Node 对主模块顶层 await 未决的码，`velar run <p>` 与 `node dist/main.js` 因此同终；
「已知原因」槽只写能证明的（各 Worker 的 `…Outstanding()` 谓词是模块私有的，接一条永远不会走的分支还会动指纹）。
② 偏移烤进发射的 `velar/serve.js`（与 `velar/server` 的 `artifactConfiguration` 同一条通道，不是入口模块——
入口由 `test-output.ts` 与 `cli.ts` 两个漏斗写出，后者在缩减名单上）；只烤纯 `..` 链（工程内的输出深度，
不是 checkout 的绝对路径，lock 与 `velar verify` 因此可复现），工程外的 `--out-dir` 得 `""`、按搬迁产物处理；
`run` / `dev` / `serve` / `test` / 目录构建五条漏斗都供偏移；存在性检查放在 `fs` 已在的地方
（`node-host-static-file.js` 的 `staticRoot` 与 `serve-listener.js` 的 `__velarServeNativeRoot`），两种传输一条规则。
顺手修了 F7-node 遗留的一处红：`hardening-node-serve-hardening.test.ts:699` 仍断言 `code: "server.outbound_budget"`
（12 项改成了 `reason`）。**邻格进队列**：`Upload.save(path, root)` 的相对 `root` 仍以进程工作目录为基——同规
（写入侧），下一个 node 小波。lock：14 个文件（`velar/serve.js`、`node-host-v1.js`、运行时包回执、`velar-node.json`）。

### 所有者 2026-09-06：「等到都弄完再发」

0.30.0 等 T2（测试镜像）落地后再发；发布 worktree 上已备的发版提交只作重层的预演，T2 并入 main 后在最终树上
重做版本号与 lock、再跑一次 `release:check`、打标签发布。附一条发版规则：发版提交改变发射清单里的编译器版本号，
所以**必须在同一笔提交里重写 `output-fingerprint.lock`**（`release:check` 先比 lock）。

### T2 落地——D115 P5 收官（2026-09-06，提交 `344c498`，合并 `12a9811`）

四个阶段：① `tests/support/` 一份助手（8 个搬入、5 个从 27–39 处内联重复里抽出：`execute-module`、`run-cli`、
`compile`、`web-project`、`document`）；② 179 个非 hardening 测试按所有者进 `tests/{compiler/{lexer,parser,types,
analysis,emit,format,semantic,diagnostics},core,web,node,server,desktop,cli,acceptance,repo}/`，归属 = 目录 ∪ 导入推导
（缺一个所有者会让测试不跑，多一个只会多跑），推导留作 `ownership.generated.json` 的 `consistency` 段（109 条，
按目录 compiler 83 / core 11 / node 7 / web 4 / cli 3 / server 1，只报不搬）；③ 147 个 `hardening-*` 按所钉主题
改名归位，测试体一字未动，`tests/heavy.json` 退役——重层就是 `.slow.test.ts` 后缀（23 个文件），历史前缀规则删除；
④ `compiler.test.ts`（29,953 行、530 个测试）拆成 78 个文件（最大 722 行），22 个模块级声明抬进
`tests/support/compiler-suite.ts`，按主题去各自所有者目录（compiler 40 / web 17 / cli 16 / core 5）。
数字：快层 182 文件 1,830 测试 → 382 文件 3,250 测试；全量 3,595 前后不变；发射产物逐字节不变。
45 个固定端口（42879–42896）全部改为 `tests/support/free-port.ts` 的端口发现（`velar dev` 打印的是请求的端口不是
绑定的端口，`--port 0` 无法用于发现——服务器若改为打印实际端口，该助手即可退役）。
历史排除藏住的两条烂测试：`hardening-node-serve-hardening` 断言 `code:` 而运行时已写 `reason:`；
`hardening-d90-front-end-performance` 的模板字面量动态导入路径。
**重层里藏着一条 F7-node 的回归**：`tests/node/node-platform.slow.test.ts:2579`「Node process and HTTP runtimes
preserve secret…」以 `Error: poisoned process intrinsic` 在 `Worker.ref` 处失败并随后**挂起**（120 s 单测超时
不触发），干净树上逐字节复现——F7-node 的引用记账经可被投毒的原型调用 `Worker.ref`，而该测试刻意投毒原型来证明
运行时只用捕获的内建；发版预演 `release:check` 正是卡在这里两小时。→ F7-node-c：改用捕获的 `ref` / `unref`，
并让失败后不挂起。
合并冲突两处（B2 的导入 vs T2 的路径改写；F7-node-b 与 T2 各自修的同一行 `reason:`），均取并集。

### F7-node-c 落地（2026-09-06，提交 `31e1b60`）——修正 F7-node 的引用记账

根因：Node 自己的 `Worker.prototype.ref` 是 `this[kHandle].ref(); this[kPublicPort].ref()`，后半句**实时**查
`MessagePort.prototype.ref`，所以捕获 `Worker.prototype.ref` 也挡不住投毒（`terminate()` 同样先 `this.ref()`）。
挂起：抛出逃出 `invoke()` 的 promise 执行器时句柄与端口已被 ref、待决项仍登记、`…Fail()` 从未被调，端口不关、
Worker 不停——测试本身 60 ms 就失败了，挂的是进程退出。修法：`…UpdateReference()` 只切换代理自有的 MessagePort
（经捕获的 `MessagePort.prototype.ref/unref`），Worker 就绪后释放一次、离开逐调用路径；端口操作失败成为模块自己的
有名失败（与就绪期限同一条 `…Fail()`），拆除步骤 unref → close → release → terminate 逐步报告不抛
（`velar/process` 以前失败时根本不终止 Worker）；三个 boot 文件把 `ref` 钉成自有 Worker 的自有属性，让 Node 的
`terminate()` 在原型被换掉时仍能到 `stopThread()`。**上文 F7-node 段「同时 ref / unref Worker 与端口」据此作废**：
保证不变（有待决即撑住循环，空闲即释放），承载它的句柄变了。`node-platform.slow` 42/42、28.9 s 自行终止。

## 0.30.0 发版记录（2026-09-06）

发版提交 `943e89c`「release: VelarScript 0.30.0」，表面 `core@0.8 · web@0.14 · node@0.17 · server@0.15 · desktop@0.10`；
标签 `v0.30.0`；发布工作流 run 34032160214 绿（5m18s），npm `@velarscript/cli` / `@velarscript/compiler` 均为 0.30.0。发版前在安静机器上跑 `release:check`（D116 重层唯一的家）：
`check` + 指纹与 lock 一致 + 全量 3,601 测试 0 失败 + 打包消费验收 + Chromium 套件全绿。
本版承载：D114 五条裁决的收尾（F5-core / F5-web / F5-node 三份审计账本的实现层全部落地）、P6 设计层十三项
（F7-core / F7-web / F7-web-b / F7-node / F7-node-b）、D115 P3 全部五个包的运行时成真源码（R2 / R2b / R2c / R2d）、
D115 P5 测试镜像源码（T2）、D116 按范围门禁（T1）、进程卫生（B1 / B2）、仓库卫生（F6a–F6d）、以及 F7-node 引用记账
的回归修正（F7-node-c）。0.29.1 / 0.29.2 由同侪会话在中途发出，其漏记的条目已补进 0.29.1 段。
本次发版的两条经验：发版提交必须重写 `output-fingerprint.lock`（清单里的编译器版本号）；重层里藏着的回归
（`Worker.ref` 投毒、协议参数个数）只在 `release:check` 或 T2 把测试拉回快层时才浮现——每版一次的重层不可省。

### F8-web 落地（2026-09-06，0.30.0 之后第一批）

① 只收 `Length` 的构建器槽位（`blur` / `border` / `shadow` / `dropShadow` …）按 `hsl` 路径就地改写 Core 的
VEL4001 并给 `velar fix`（`blur's radius argument is a Length, and 4 is a number; write 4px`）；槽位类型从调用
解析到的绑定的**已发布签名**读，删掉了手工维护的排除名单；槽位名用签名里的参数名而不是序数（`shadow's y
argument` 比「第二个」好读，序数还要第二张表）——接受。② SVG 命名空间区域的 fatal 标记是 SVG `<g role="alert"
data-velar-fatal>` + `<text>`（`foreignObject` 在 Chromium 里无尺寸不渲染；与 `VelarLazy` 失败路径同拼写）。
③ 边界门钉住 `browserStopGraceMs` 的定义与用法两半，回退到派生值即红。指纹 53 项（Web 工程的内容哈希资源名）。

### F8-node-cli 落地（2026-09-06）

① `Upload.save(path, root)` 的相对 `root` 经同一个 `__velarServeApplicationRoot(root, caller)` 解析（拒绝句点名
调用者），两个候选用 `velar/fs` 的 `canonical` + `info(...).kind === "directory"` 选定——与 `staticRoot` /
`__velarServeNativeRoot` 同规；上传从不经特权宿主，存在性检查就放在 `velar/serve` 里 `velar/fs` 已在之处；
包含 / `..` / 符号链接的拒绝不变。② `velar dev` 打印实际绑定的端口（`server.address().port`），`--port 0` =
任意空闲端口（`cli.ts` 两处就地改行、行数不变；`preview` 不变，Node 工程仍拒 `--port`）；
`tests/support/free-port.ts` 的退役条件已满足，`tests/cli/` 下 17 处调用全部改为 `--port 0` + 解析横幅，
只剩 `tests/desktop/desktop-services.slow.test.ts` 一处。指纹 10 项（`velar/serve.js` 与运行时包回执）。
顺手结束了两个 F7-node-c 修复前遗留的挂起测试进程（`node-platform.slow` 的旧形态，在 f5-node 与 scratch-t2）。

## 0.30.0 面审计裁决（账本 `archive/COMPLETENESS-AUDIT-0.30.0-2026-09-06.md`，≈260 探针：6 DEFECT / 21 INCONSISTENT / 4 DRIFT / 26 UNDEFINED）

好消息先记：0.30.0 CHANGELOG 里每一条语言 / Web / Node 条目都有快层测试钉住（P5 的搬迁没丢东西），表面摘要的
五张新表与 D114 记录的计数逐一相符。**已被 F8 波修掉的**：WB-D1（SVG 区域 fatal 元素）、WB-I1（只收 Length 的
构建器双报）、NO-I2（`Upload.save` 相对 root）、GA-I1（`browserStopGraceMs` 未钉）——只需在账本旁标注。

**实现层，F9-core（compiler / core）**：CO-D1 `Pair<A>` / `Pair<A,B,C>` 静默编译、缺的实参成 `unknown`——
`parser/type-syntax.ts` 的元数表补 `Pair`；CO-D2 `extern module` 契约以 guided 拼写（`str` / `Array` / `void` …）
命名类被放行（`parseExternClassHead` 只对非标识符词符问名册）——关上；CO-I1 VEL3004 的「alias one of the
imports」改法被本版新规拒绝——同一导出两次是一个错误，改法是删掉一个，要两个名字就 `const other = title`，
两条消息与测试同改；CO-I2 `velar-allow A18` 永不过期——延后压制在图遍历后一个都没压中即按 VEL1012 报陈旧；
CO-C3 A18 每条导入边报一次、N 模块环要 N 个压制——宪章是契约：每个环报一次、落在闭合环的那条导入行；
CO-I3 extern class 位的词法名册说「a class」——统一为「an extern class」与同一跨度；CO-I4 / WB-I5 导入 Core 前置名
或 `velar/*` 模块没有的名字双报、第二条叫作者写 extern 契约——一条；CO-I5 `for … in` 形态里错误产生的 `unknown`
仍级联；CO-I6 两个「Detached task failed:」写者——`core/runtime/async.js` 走与发射通道同一格式化器（隐藏
`node:` 帧、`--stack` 生效）；CO-I7 `Pair` 在成员缺失消息里印成「Object」；CO-I8 `??` 右臂空记录旧报告仍在
（`Config | {  }`）；CO-C1 **宪章漂移**：格式化器有 120 列的套折叠规则（`FORMAT_PRINT_WIDTH = 120`，120 折 /
121 不折，`velar format --check` 强制），而 §2 刚写的「There is no line width」是假话——**保留行为、改文本**：
单语句套只在整行不超过 120 列时折到头部，字面量与表达式永不折行；CO-C2 §11 的子类范例名 `TimeoutError` 已是保留名
——换名；CO-U1 `--stack` 丢源码片段——保留；CO-U2 运行时帧按路径隐藏、内联的 `__velarRequired` 帧漏出已删的
沙箱路径——按运行时标记而非路径隐藏；CO-U3 未捕获 `NarrowingError` 帧印两次；CO-U4 `"abc".char(-1)` 从尾部读——
裁定 `char(i)` 要求 `0 ≤ i < size`，负字面量编译期拒绝（与 TX-U3 同规）、运行时 `IndexError`；CO-U5 被拒的类型参数名
每次使用再报一条——一条；CO-U8 发射的 `@dispose:` 在栈里显示为 `Handle.__velar:dispose`——标签改 `Handle.dispose`；
CO-U6 / CO-U7 成文（匿名 `{first, second}` 印作 `Pair<A, B>`；嵌套 `Promise.timeout` 外层先到期后内层作为分离失败上报）。

**实现层，F9-web**：WB-I2 VEL5042 的「(only 0 is unitless)」在零已被拒的槽位上是假话——按槽位改句；WB-I3 陈旧读
探测器的改法（`holder = Box(...)`）在实例位于记录 / List 之下时不编译——改法按形状写；WB-I4 探测器对 `const` 类字段
误报——排除；WB-I6 `0%:` 停位一跨度两条 VEL5060；WB-I7 折叠绑定的 `hsl` 消息插入符指 `sat`、真正的改动在上一行——
指向初始化器；WB-C1 **裁定**：刷新失败交给**每一个**待决的 `tick()`（每个等待者都是认领者），有等待者时 Node 宿主
不再同时上报；WB-U1 / U2 / U3 据此成文（刷新之后才 await 的 `tick()` 不认领；同一刷新的多个失败依次交给后续
`tick()`）；WB-U4 探测器点名底层数据字段——同时点名读到的成员；WB-U5 成文（一跳、无条件写）。

**实现层，F9-node-cli**：NO-D1 **安全形状**——`dist/` 复制到陌生人的 `public/` 旁会把陌生人的文件当作应用资源服务
（候选根只看 `stat().isDirectory()`）：构建时把工程身份（`velar.json` 的 `name`，无则工程相对路径的哈希）烤进
`velar/serve`，主候选只在 `<入口>/<偏移>/velar.json` 存在**且**身份相符时成立，否则回退入口目录；NO-D2 / NO-I3
预加载投毒 `Worker.prototype.unref` 让三族 Worker 做完活后永不退出——`…ReleaseWorker()` 的失败是模块失败，三个
boot 文件读它的布尔值；NO-D3 `velar run` 起的程序没有 `watchParentDeath`——启动器被杀即孤儿并占着端口，与 B1/B2
同法；NO-I1 `HttpProblem({code: …})` 构造位（每个 0.29 程序都有）两条泛报告、无后继名、无 `velar fix`——一条点名
`reason` 并带改写；NO-U2 `..` 根静默逃出工程——构建 / 启动时拒绝；NO-U3 不存在的根只在请求时 404——启动时报一次；
NO-U6 就绪期限失败在 `node dist/main.js` 下是原始崩溃转储——经程序的未捕获路径；NO-U7 `openapi()` 给只抛出的路由
发布 `200: {type: null}`——成文（静态判「只抛出」不做）；GA-U4 `projectRootOffset` 无测试点名——加。
NO-U1 / U4 / U5 成文。

**门禁层，T3b（T3 之后）**：GA-I2 `fileOwners` 的发布者收窄丢掉真发布者（109 条里 57 条丢 `server` / `desktop`）；
GA-I3 89 条经 `tests/support/velar-project.ts` 带上 `cli`——`cli` 在所有包之下，多一个 `cli` 不改变任何决策，记为
「经助手」即可，不再当作发现；GA-U3 3,617 行的 Node 平台测试从不进 `npm run gate`（即使改了 `packages/node`）——
拆成快层核心用例 + `.slow` 余下；GA-U5 `noUnusedLocals` 无测试——加一条「死局部变量红构建」；GA-U1 / U2 / U6 成文
（浏览器卫生的启动者死亡半边、真实引擎半边只在重层；宪章散文没有测试——设计如此）。

### T3 落地（2026-09-06）——归属一致性归零

109 条：**0 搬迁**、106 条进 `tests/ownership.exceptions.json`（每条一句理由）、推导修了三处缺陷——注释被当证据
（`stripComments` 先扫字串 / 模板 / 正则再匹配，全仓 826 个 TS 文件前后比对无丢失）、工程路径只认整写（补
`join(root, "tests", "fixtures", …)` 拼法）、文件名前缀无条件并入而文档说它是决胜规则（改为只在五条证据规则全空时读）。
`--check-ownership` 对无解释、陈旧、无理由三种状态皆红（注入验证）。最难的十条判断记在账本旁：34 条 `compiler → web`
全来自 `tests/support/compiler-suite.ts`（一个助手就是信号，不能不跟）；`node-server-framework` 搬去 `tests/server/`
能免费消音但那是按方便归档；`tests/core/hash.test.ts` 导入 Node 编译器只为断言 `velar/hash` 不在其名册——否定断言也是
真依赖。发射产物逐字节不变。

### 官网升级到 0.30.0 时发现的一条编译器缺陷（2026-09-06，待 F9-core 之后修）

**FC-X1** 「一个错误一条报告」漏了一格：结果未注解、函数体里有错误的函数，同时报 VEL4025（结果推断未收敛）与那条真正的错误。
复现：`type Entry = TextEntry | ToolEntry` 后 `export def toolIdOf(entry: Entry): return entry.toolId` → 声明处 VEL4025 + 读取处 VEL4001；
补上 `-> string` 只剩 VEL4001。裁决：结果推断因函数体已报错而放弃时不报 VEL4025——函数体的错误就是原因，也是唯一的报告；
函数体无错而结果真不收敛时 VEL4025 保留（测试两个方向）。归编译器诊断，F9-core 落地后单独派。

### F9-web 落地（2026-09-06）——0.30.0 面审计 Web 八项

WB-I2 单位建议按槽位公开类型生成，「或 0」只出现在联合里有 number 的槽（blur/shadow 不再承诺裸 0）；WB-I3 陈旧读检测器的
单元格行走携带路径，补救按形状写出（平铺 `box = Counter(...)`、记录 `holder = {...holder, box: Box(...)}`、List `boxes[0] = Box(...)`，
Map/Set 持有者给形状中立的一句），并点名路径；WB-I4 **裁决调整**：不做编译期 const 名册（要逐类发标记，且非 Web 模块声明的类漏网），
改为「字段在无法跟随的读者之下真的变化时」报告（先读后写、先写后读两个顺序都覆盖）——const 字段从不被写，结构上永不报告；代价是
会话内从未被写的 let 字段不再报告，这与冻结读检测器同规则；WB-I6 keyframes 块级「至少一个有效 stop」总结与逐行报告必然重复，删除；
WB-I7 折叠绑定的槽位教训指向初始化处并点名绑定（整个家族）；WB-C1/U1–U3 规则：**flush 时每个挂起的 `tick()` 都以该次 flush 的第一个
无人认领的失败拒绝；被认领的失败不再去任何别处；无人认领的一律进宿主**——晚到的 `tick()` 不认领；无 AggregateError 式载体（语言里
表达不出）。WB-U4 报告同时点名读取的成员（getter/方法）与其读到的字段。WB-U5 章程 §15 一句说明 VEL5077 的编译期触及范围。
检测器移入 `packages/web/runtime/stale-class.js`（graph.js 794→677）。Web 运行时变更，指纹锁重写（63 行）。

**新发现，排队 WB-X1**：`tracks(8px, 4)` 无任何诊断——`teachLookLengthSlot` 读 `declared.parameters[position]`，rest 构建器首参之后
没有条目，单位规则在位置 0 之后停下；`tracks(4, 8px)` 却被拒。任何 rest 构建器同形。与 FC-X1 一并派小波。

### 集成热修（2026-09-07）——process worker 的 stdin ENOTCONN

F9-web 落地门禁在 `node-run-completion`「CPU 争用下每次都跑完」第 6 次尝试红：程序以 `write ENOTCONN` 未捕获退出。根因在
`packages/node/runtime/process-worker.js`：stdin 的 error 监听只放过 EPIPE / ERR_STREAM_DESTROYED / ECONNRESET；macOS 上 stdio 管道
是 UNIX socket，子进程（`/bin/echo`）先退出、`stdin.end()` 落在对端消失之后就是 ENOTCONN——与 F5-node 热修同一族，漏了一个码。
放过 ENOTCONN；Node 运行时变更，指纹锁重写。教训：错误码集合按平台穷举（EPIPE / ECONNRESET / ENOTCONN 三兄弟一起列）。

### W2 / W2b 落地（2026-09-07）——仓库文档升到 0.30.0

所有者要求 README 与文档跟上官网（官网已于 09-06 升到 0.30.0，website main 7afd643，新增 /changes 页）。README.md 重写为
官网的定位（应用层语言、语言即框架、不承诺兼容而以拒绝为机制）+「版本，以及升级之后要重读什么」（五个计数器、三条命令）+
「在这个仓库上开发」（D116 两层门禁、D115 布局与预算）；README.zh-CN.md 逐节镜像、五个围栏逐字节相同；getting-started /
why-velarscript / 八个包 README 的版本钉、`surfaces` 块、退役写法全部更新；CONTRIBUTING 的本地验证改为 `gate` / `release:check`。
**数字不靠人记**：`check-surface-versions.mjs` 新增第 5 遍「引用这些数字的散文」——11 个文件 49 处站点（安装版本行、
`surface@N.M`、`surfaces` 条目、`@velarscript/*` 钉）逐个对照 `VELAR_VERSION` 与 `SURFACE_VERSIONS`，缺站点的文件也红；
`tests/repo/surface-versions.test.ts` 三例（通过、一处陈旧点名 file:line 与两值、无版本站点被拒）。发版脚本（scratchpad
release-bump.py）下次发版前要跟上这 11 个文件，否则门禁替它记。官网对 `detach` 的一处引用陈旧（/why 的 VEL4027 原文）已修。

### F9-core 落地（2026-09-07）——0.30.0 面审计 Core 十九项

CO-D1 `Pair` 元数表缺行（`Pair<A>` 第二字段静默 unknown）→ 表加 `Pair→2`；CO-D2/CO-I3 extern class 头部与词法层名册都按 class 的
同一套规则拒绝（lexer 新增 `externBodyStack`）；CO-I1 重复导入两条报告同一句、只有「两个不同导出争一个本地名」才保留别名建议
（`ModuleImports.registerImportSpecifiers` 先记重复 specifier 的跨度）；CO-I2/CO-C3 A18 每个强连通分量一条、落在闭环的那条 import，
`velar-allow A18` 无所匹配时报 VEL1012（`packages/cli/src/project-graph-advisories.ts` 新文件）；CO-I4/WB-I5 被模块拒绝的导入绑定
`invalidType`，其使用处不再教 extern；CO-I5 无效可迭代对象毒化两个循环槽；CO-I6/CO-U2 宿主栈裁剪策略只在 `compiler/runtime/error.js`
一处（`hostErrorTrace`），`core/runtime/async.js` 调它；帧按保留名前缀 `__velar` 隐藏（内联助手也被抓住）；CO-U1/U3/U8 启动器从
第一个自有帧起切代码框、相邻逐字节相同的帧折叠、角色成员命名（`defineProperty(...,"name")` 包在 try 里——标签永不能让程序起不来）；
CO-I7/I8/U5 Pair 显示、`??` 右臂被拒时毒化、被拒类型参数不重复教；CO-C1/C2/U6/U7 章程 §2 折行真规则、§11 子类例改 `BudgetError`、
Pair 名随形状、TimeoutError 表加嵌套预算段；CO-U4 负 `char` 索引编译期拒绝、运行时守卫点名索引与大小，tour 06 改写。
指纹锁重写。

**未闭合，排入 X 波**：(1) CO-U4b `char` 越界抛的是 `RangeError` 而非可点名的 `IndexError`——`is IndexError` 不匹配、`try` 转成 null；
要 `velar/compiler-runtime-primitives-v1` 从 collection-lowering 导入 `__VelarIndexError`（`packages/core/src/index.ts` 的
`coreModuleDependencies` + `check-runtime-boundary.mjs` 的位置钉）；(2) CO-I6 边界门禁未钉「async.js 经 hostErrorTrace」。
f5-core 那条红测试（`directory-build-input-safety`「outDir 经符号链接逃逸」）是该 worktree 旧式 node_modules 的 esbuild 符号链接
所致，集成树复制模式下不复现。

### T3b 落地（2026-09-07）——门禁层五项

GA-I2 `fileOwners` 收窄不再丢**叶子**发布者（desktop / server，按 `PACKAGE_UPSTREAM` 算出而非列举）：97 个测试文件找回 105 个
所有者；只由图给出的所有者记在 `viaRoster` 而不当发现（与 `TOOLING_PACKAGES` 同一先例——文件点名的是 specifier，图点名的是包，
「搬去 tests/desktop/」不是任何人会给的答案）。裁决原以为例外表会缩，实测 106→107（0 删 0 改 1 增：新的快层 node-platform 文件）；
原因可查：修复只增所有者，增的那些被记录而非报告，既有发现一条未动。GA-I3 只经助手带上的所有者记在 `viaHelper`（97 个测试，
其中 56 个的 `cli` 来自 `tests/support/velar-project.ts`）。GA-U3 3,617 行的 node-platform.slow 拆出快层
`node-platform.test.ts` + `node-platform-serve.test.ts`（9 例 2.3 s；两个文件是因为单文件会到 840 行），慢层余 33 例 2,809 行，
allowlist 只降不增。GA-U5 `noUnusedLocals` 在八个 `tsconfig.build.json` 而非根 tsconfig——`tests/repo/no-unused-locals.test.ts`
两半：每个包都设了（从工作区名册推导，第九个包也逃不掉）+ 复制的包种下死局部变量后 TS6133 点名。GA-U1/U2/U6 成文于 gates.md
「只有重层持有的」小节。发射产物逐字节不变。

### F9-node-cli 落地（2026-09-07）——0.30.0 面审计 Node / CLI 十项

NO-D1 构建把 `__velarServeProjectIdentity` 烤在根偏移旁（`packages/node/src/project-config.ts` `nodeProjectIdentity`：清单有 `name` 用
`name:`，否则 `entry:<工程相对入口路径>`），`velar/serve` 在模块求值时只定**一个**应用根基——`<入口>/<偏移>/velar.json` 存在且身份相符
才是工程根，否则入口目录——双候选机制从两条传输、`Upload.save` 与宿主协议里一并退场（`serve.respondFile` 回到 6 参、`readFile` 3 参）。
NO-D2/NO-I3 三个 Worker boot 文件读 `…ReleaseWorker()` 的布尔值、失败即模块失败（投毒 `unref` 抛错：从 8 s SIGKILL 变 ~70 ms 退出 1）。
NO-D3 `velar run` 启动器带上 B1/B2 的三种观察（ppid 轮询间隔从 `process-lifetime.ts` 导入而非抄）并自送 SIGTERM。NO-I1
`HttpProblem({code: …})` 一条报告点名 `reason` 并带机械修复（`packages/node/src/serve-call-analysis.ts`）。NO-U2 `..` 根两端拒绝
（构建看字面量、按名字与声明参数元组匹配，`velar/serve` 看到达的一切）。NO-U3 `serve()` 起动时审计一次声明的根、缺的逐个点名后
照常服务（只在烤了偏移时审计）。NO-U6 就绪期限的拒绝在模块体重抛，带程序自己的帧。NO-U7/U1/U4/U5 成文；GA-U4 测试点名偏移与身份。
指纹锁重写（18 处，tour core / node 的 node-host-v1 / process / serve / terminal 与运行时包回执）。

**残留，待裁决**：(1) 身份是 `entry:<路径>`——`velar.json` 今天没有 `name` 字段（`CORE_PROJECT_MANIFEST_FIELDS` 拒绝），两个都用默认
`src/main.vel` 的工程共享身份，把 `dist/` 丢进另一个同入口的 VelarScript 工程仍会被相信；给清单加可选 `name` 是表面裁决，交所有者
（绝对路径不能进身份：整树搬家会把静态根打回入口目录）。(2) 预加载静默返回而不 unref 的 Worker 仍会挂——调用点无法与成功区分，
要闭合需 `process.getActiveResourcesInfo()` 一类核验，是设计题。**新缺陷，排入 X2 波 SV-X1**：`@velarscript/server` 工程根本不烤
根偏移（F7-node-b / F8 只接了 `@velarscript/node`），server 工程的相对静态根在 `velar run` / `dev` / `test` 下从未解析到工程根，
`hello-node` 模板正踩在这上面；同一波检查 desktop 是否同样漏接。

### X 波落地（2026-09-07）——FC-X1 / WB-X1 / CO-U4b / CO-I6 钉

FC-X1 `recordFunctionResultInference` 只在「推断结果是 invalidType **且** 函数体已报错」时不报 VEL4025（粗规则「函数体报过错就不报」
会把互递归对的两半都静音——占位符引发的 VEL4001 也算函数体报错），另外两种放弃推断的原因（占位符在场、结果在两遍之间移动）
是真的不收敛，照报；结果键加入 `reportedResultHoles`，调用者返回被毒化的结果时不再上移一层重报。WB-X1 look 词汇里 rest 构建器
恰两个：`tracks`（收 Length 槽，报告改变）与 `filters`（收 Filter，`slotAccepts` 拒绝，保持 core 的赋值报告）；rest 位置无参数名，
措辞为 `tracks' argument 2 is …`，具名位置逐字节不变。CO-U4b `__VelarIndexError` 移入 `compiler/runtime/index-error.js`，`text.js`
的 `char` 守卫抛它，primitive 模块从 collection-lowering 导入（`coreModuleDependencies` 加边）；顺带暴露并闭合一个缺陷：
`velar/text` 与 `velar/browser` 内嵌 TEXT_METHOD_RUNTIME 却没绑定 `__VelarIndexError`——新门禁规则拒绝任何点名该类却不声明
也不导入的标准模块源。`try` 不再吞掉它、`char(3)` 仍答 null。CO-I6 边界门禁钉 `__velarHostErrorTrace` 与 async 家族的调用、
拒绝直接读 `failure.stack`，测试从门禁里读回钉语再对变异副本验证。指纹锁重写（67 行）。

**待裁决 CO-U4c**：`String.char index must be an integer` 仍是 TypeError，而 `List.get` 的同类失败是 IndexError——章程 §11 把
「越界或非整数的 List 位置」都归 IndexError，`char` 应同规则；排入下一小波。

### X2 落地（2026-09-07）——SV-X1 Server 工程的根偏移与身份

两个独立的漏接叠在同一个错误假设上（`velar/serve` 只属于 `@velarscript/node`）：`standardModuleSource` 只把
`projectConfig.get(extension.id)` 交给各扩展，Server 工程的 `extensionConfig` 根本没有 `@velarscript/node` 键；而
`packages/server/src/compiler.ts` 对非 `velar/server` 的 specifier 答的是静态表里**未参数化**的 Node 源。实测 `--template node`
工程构建出的偏移与身份都是空串。修法只有一条共享路径、归 `@velarscript/node`：`velarNodeServeProjectConfig(extensionConfig,
extensions, offset, identity)` 把两条构建事实登记在**模块表里带 `velar/serve` 的每个扩展**名下（从模块表推导而非包名列表），
Server 的 `modules.source` 对其余 specifier 委托给 Node 的（与它已有的 parser/analyzer/emitter 组合习惯一致）；run/dev/serve/test
沙箱与目录构建都调这一个函数；`projectCompilerExtensions()` 暴露既有的 withDefaultNode 规则，无扩展的裸 `.vel` 工程仍登记在
`@velarscript/node` 下。Desktop 与 Web 不烤（模块表里没有 `velar/serve`），指纹证实其产物逐字节未动。新测试
`tests/server/server-static-root.test.ts`（6 例）镜像 Node 的；create 模板测试改为从工程外启动 `velar serve` 取 `/`——那是
新建工程服务的第一个请求，此前是 404。指纹锁 6 处（tour node 的 serve.js 与两份回执）。

### X3 落地（2026-09-07）——CO-U4c 字符串位置一律 IndexError

`text.js` 里三个位置守卫（`char` 非整数、`slice` 非整数位置、`index(text, start)` 非整数 start）抛的是宿主 TypeError，`try` 的
完整性判定按 `.name` 只认 AssertionError / NarrowingError / IndexError，计算出来的小数索引因此变成读作「没找到」的 null。
三处改抛 `__VelarIndexError`，句子沿用 `List.get` / `List.slice` 的原句（只差接收者名）；计数（`repeat` / `padStart` / `padEnd`）
仍是 RangeError——计数说的是长度不是位置。边界门禁钉三个守卫并拒绝 `__velarTextNativeTypeError("String.(char|slice|index) …")`
形式。章程 §7 三行与 §11 名册句改为「List 或字符串里越界或非整数的位置」。指纹锁重写（8 改名 / 17 改动）。

**已办（2026-09-07）**：`tests/cli/shared-runtime-validation.test.ts`（796/800 行）按主题拆成六个文件（最大 221 行），九条测试逐字不动，
归属重生成、例外表不变、产物逐字节不变。

### 0.31.0 发版记录与所有者授权（2026-09-07）

所有者：「发，你来决策就行」。发版提交 dae269c8（基于 Codex 同伴当天先发的 0.30.1 = e88f2e6d；第一版 a34496d3 因祖先检查
未推出，重建后重跑重层）；`release:check` 在发版提交上 3,726 项 0 失败；tag v0.31.0；发布工作流 34071098637。五个表面计数器
未动（core@0.8 · web@0.14 · node@0.17 · server@0.15 · desktop@0.10）。同伴 0.30.1 的散文版本站点由第 5 遍门禁逼着一并更新——
门禁按设计起了作用。

所有者把余下三件交我裁决，裁决如下：
1. **`velar.json` 加可选 `name`**——是。`velar/serve` 的工程身份改为 `name:<name>`（无 `name` 时仍 `entry:<路径>`）；
   `velar create` 给新工程写 `name`（目录名）；`CORE_PROJECT_MANIFEST_FIELDS` 收下它；不是表面词汇变更（清单字段不在 Core
   摘要的五类里），CHANGELOG 记。理由：两个默认入口的工程共享身份是 NO-D1 留下的洞，唯一不把绝对路径卷进身份的补法就是
   清单里的名字。排为独立一波。
2. **预加载静默不 unref 的 Worker**——只成文不做。抛错的投毒已在毫秒内退出；静默返回在调用点与成功不可分辨，闭合要加
   `getActiveResourcesInfo()` 一类核验，代价与收益不成比例（那是敌意预加载的纵深防御边角）。
3. **官网生产部署**——官网先升到 0.31.0，再从 VelarScript-Website 主检出用部署脚本自带的回退
   （`VELARSCRIPT_DEPLOY_SKIP_CI_CHECK=1`，GitHub Actions 因账单不能给出 CI 结论，脚本在本机重跑同一套门禁）一次部署到生产。

### `velar.json` 可选 `name` 落地（2026-09-07，裁决 1）

根因：NO-D1 的 `nodeProjectIdentity(name, entry)` 与 `node-project-identity.ts` 早已读 `manifest.name`，但 `name` 不在加载器名册里——
声明它的清单被 `unknown 'project' field 'name'` 拒绝，`name:` 分支不可达，所有脚手架工程共享 `entry:src/main.vel`。改法：`name`
进 `CORE_PROJECT_MANIFEST_FIELDS`（`formatVersion` 位置之后），`assertProjectName` 在加载时校验（非空、≤100、无控制字符、首尾无空白，
一条诊断），副作用即意图：`name` 成为保留键，扩展不能占用；`formatVersion` 仍为 2（名册是允许表，多一个可选键不改变任何既有
清单的加载）。`velar create` 写 `basename(target)`，只删规则禁止的东西（控制字符、首尾空白、截到 100 再修一次），什么都不剩
时回退 `velar-app`（与 `packageName` 同一回退）——大小写、空格、标点、文字系统都保留，与旁边的 npm 名、反向 DNS 标识不同。
文档只改 getting-started 那段「create 之后的 velar.json 长这样」；`project-lifecycle.md` 的格式 2 示例是格式说明不是 create 产物，
不加（同意代理判断）。`standard-library.md:1029` 早已承诺「其 `name`，或它声明的入口」，此改让既有句子成真。
测试：加载器接受 / 拒绝各例、同入口异名的邻居 `dist/` 回退入口目录且报一次两个身份、Server 也烤 `name:`、六个模板都写
`name`、真实 `velar create` 写 `name: "my-app"`。产物逐字节不变，表面摘要未动。下一版 CHANGELOG 记。

### P4 R3-0 落地（2026-09-07）——门禁钉读家族、cli 进 P3

`tests/web/api-contract.test.ts` 18 处 web / cli 单文件读取改经 `compilerLayer(entry, ...directories)`（目录尚不存在时只读入口；
`web/compiler.ts` 保持单文件——那七条断言说的正是「冻结的扩展字面量装配在这里」，读层会让 R3e 把它散进 `modules/` 而无人察觉）。
`check-runtime-boundary.mjs` 七个家族经 `sourceFamily`，`cli.ts` 的两条结构规则（`indexOf` 顺序比较、两函数名之间的切片）改为
`functionBody` 函数级断言——旧的顺序比较在两个短语都删掉时是 `-1 > -1`，静默为绿；29 条规则逐条变异：旧新皆红，无一减弱；
八个家族把短语搬进 P4 目录后旧规则误红、新规则仍绿。cli 进 D115 P3：`RUNTIME_PACKAGES` 与 `rawTemplateScopes` 加 `cli`，
浏览器性能脚本 216 行 `String.raw` 成为 `packages/cli/runtime/browser-performance.js`（唯一插值经 `browser-performance-abi.ts`
的 `requireText`，与 web / node 同法；提取体与原模板解析后逐字节相同），`browser-test-runner.ts` 允许名单 1218→997。
产物逐字节不变。事故记录：代理的搬移实验清理步骤 `rm -rf` 了已存在的 `packages/node/src/modules`（删了 `serve.ts`），
以 `git show HEAD:…` 复原、diff 为空；实验脚本改为拒绝任何已存在的目录。

### v0.31.0 tag CI 的 macOS 重层两条红（2026-09-07）——测试自身的不确定性

ubuntu 重层与本机 `release:check` 都绿，红的是共享 macOS runner 上的两条测试。(1) `dev-server-dependency-reload.slow`：实测一次
`build-library` 到达浏览器是**三次**整页重载导航（相隔 14 / 51 ms），`changeUntilRendered` 在第一份新文档显示标签时就返回，
裸 `page.evaluate` 落进后两次导航之间——`Execution context was destroyed`。修法只在测试：`reloadMarker` 只在「上下文被销毁」这一
错误上等新文档的 `load` 再问；`markDocument` 写后回读、被重载吞掉就重写；frozen 块写标记前先等重建计数稳定。姊妹测试无同一竞态。
(2) `project-graph`「节点上限约束工作量」用墙钟比值，共享 runner 上 18 ms vs 22 ms 就红；已有的 `modulesVisited`（两边都是 1）
与取消轮询数（两边都是 305）都不能区分——上限让每次访问变便宜而不是消失。加 `activity.work`（每推进一个节点或边计一步），
满 9,604、上限 3,252，逐次精确相同；断言 `capped.work * 2 < full.work`，`durationMs` 留作报告。
`buildOwnershipGraphScoped` 223→219。教训：共享 runner 上时间不是证人，计数才是。

### P4 R4b 落地（2026-09-07）——cli/project.ts → project/

`project.ts` 2,653→251：只剩公开形状、`compileProject` 与 58 行的相位序列 `compileProjectEntries`（相位间传 `ProjectCompilation`
记录：35 个只读字段——选项面、四个目标答案、入口、十七个跨相位累加器；随发现循环消亡的九个留在 `graph.ts` 内的
`ModuleGraphWalk`）。`project/{options,graph,incremental,diagnostics,entries,types}.ts` + `project/interfaces/{identity,resolution,
analysis-context}.ts`；五个超长函数各拆成具名相位（`moduleInterfaceIdentity` 141→33、`resolvedModuleInterface` 148→28、
`createAnalysisContext` 171→24、`appendInitializationCycleDiagnostics` 212→五段、发现循环 278 行成 `discoverProjectModules`）。
23 个导出名原路不变，30 余个导入者与全部测试一字未改；allowlist 删六条（27 文件 / 29 函数）；门禁钉经家族读取一条未改。
代理留下的一处双向导入（diagnostics ↔ incremental，为 `stronglyConnectedPaths` 与 `importedReactiveAssignmentDiagnostics`）
由我拆开：Tarjan 进 `project/scc.ts`，两边单向。**R6 规则记此**：协作者模块之间不得成环（`desktop/config.ts ↔ manifest-migration.ts`
是现存的一对，R6 时一并处理）。`importInterface` 恰 120 行——下一次改动它就得拆。

### P4 R4a 落地（2026-09-07）——node 的组合根与模块表

`server-analyzer.ts` 1,236→22（门面再导出十个名字）：`analysis/server-analyzer.ts` 是组合根（11 字段、`analyze`、4 条缝、
`compositionHost()`——`private` 状态只能在类内造宿主，TS2341），协作者 `analysis/{routes,handlers,composition,collisions,
response-shapes,openapi}.ts` 与 `analysis/calls/intrinsics/serve.ts`（`inferNodeIntrinsic` 190 行的 23 个 case 全是 `serve.*`——勘察
以为跨六个家族是错的，按子家族拆成四个 ≤90 行的函数），`contracts.ts` 放路由提示编解码与组合类型。宿主接口一物三面：
`RouteAnalysisHost ⊂ HandlerAnalysisHost ⊂ ServerCompositionHost`，`moduleProgram` / `routePatternValues` 是 getter（逐程序替换）。
`compiler.ts` 894→212：十个 `velar/*` 表面各一文件（`modules/{serve,http,websocket,process,fs,server-test,terminal,path,host,env}.ts`
各自导出自己的 `nodeModuleInterfaces` 条目，家族读取的钉原文不动）、`modules/types.ts`（原语与构造器，镜像 core 的
`interfaces/types.ts`）、`module-policy.ts` 持有有序名册（`compiler.ts` 反向导入会 TDZ 成环）。allowlist 删三条（26 文件 / 33 函数），
表面摘要未动，产物逐字节不变。

### P4 R3a 落地（2026-09-07）——web/analyzer.ts 类外 1,660 行进 analysis/

`analyzer.ts` 5,153→3,506，类体逐字节不动，类外的表与助手按关注点进 `analysis/{web-types,look-vocabulary-guidance,url-attributes,
media-conditions,look-conditions,look-sites,routes,retired-accessors,watch-subject,keyed-rebuild,jsx-detection}.ts` 与
`analysis/calls/intrinsics.ts` + `intrinsics/{reactive,web,http,storage,config,forms}.ts`（`inferWebIntrinsic` 的十个 case 只落在这
六个家族，勘察列的 realtime / browser / files 没有臂，不造空文件；`storageReadGuidance` 只有 storage 臂读，跟着它走）；
`renderWatchSubject` 125 行拆成 13 个按表达式种类命名的渲染器。`analyzer.ts` 门面再导出两个名字，`compiler.ts` 未动，钉一条未改。
allowlist：analyzer.ts 5154→3506，删两条函数（28 文件 / 32 函数）。产物逐字节不变。

**顺带**：R4a 落地门禁在快层红了一条与之无关的墙钟比值测试（`front-end-performance` 的「多字面量一行只付一次长度」，
`long ≤ short×24+5`，三个代理门禁并行时漂）。同文件另一条 `lineText` 不扫全文的比值同理。两条移入
`front-end-performance.slow.test.ts`（D116：比值不是负载下的证人，重层发版前单独跑）；功能断言留在快层。

### P4 R4c 落地（2026-09-07）——语言服务器与语义查询

`language-server.ts` 1,743→95：`runLanguageServer` 60 行（`createSession`、52 行的 28 臂 `handle` 每臂一调、`listenToTransport`、
关闭汇合）；`lsp/{protocol,transport,session,diagnostics,positions,paths,documentation,kinds}.ts` + 每个能力一文件
（lifecycle / documents / workspace / ownership-graph / emitted-javascript / completion / hover / navigation / rename / symbols /
signature-help / inlay-hints / semantic-tokens / code-actions / formatting）；三处模块级可变量（编码、两处工作区限定）成为会话字段，
各能力声明自己要的会话接口面（`DocumentRequestSession` 等七个）。`project-semantic.ts` 1,296→47，29 个名字经门面不变，
`semantic/` 十四文件；`symbol-lookup.ts` 因 `projectSymbolAt` 与 `enumMemberAt` 互递归而独立。两目录 0 环
（`lsp/protocol.ts`、`semantic/types.ts` 是叶子）。allowlist 删四条（25 文件 / 27 函数）。产物逐字节不变，钉未动。

### P4 R4d-1 落地（2026-09-07）——cli.ts 分派器与四个超长函数

`cli.ts` 1,740→101，`main` 675→18：`COMMAND_ARMS` 是 `Map`（对象字面量会让 `velar constructor` 变成已知命令），
`commands/<命令>.ts` 各一臂（help 三臂一文件、install 四词一臂），`commands/build-tail.ts` 是 check / build / package 共用的
解析→解析工程→检查→报告前奏，写出器在 `build/{generic,framework,node,single-file,staging,compiled}.ts`，`arguments.ts` 405 行、
`help.ts` 107 行。三处逐字搬会改行为的地方都处理了：`velar skill` 的 `../skill/` URL 多一层、`velar repro` 的 `toolchainEntry`
必须仍指向入口文件（留在 `cli.ts` 传入）、Map 而非对象。四个超长函数：`runDevServer` 245→28（`dev/{state,http,source-map,
request-handler}.ts`；请求处理器每次读 `state.snapshot`——原来的 `let` 会在 `await` 之间被重建改写）、`resolveBrowserNpm` 123→26、
`buildOwnershipGraphScoped` 219→11、`applyProjectMechanicalFixes` 123→40。allowlist 删六条；合并时 allowlist 冲突按新规矩用
`--write` 重生成（22 文件 / 19 函数）。产物逐字节不变，钉未动。`npm.ts` 784、`ownership-graph.ts` 777 逼近上限——R6 时看。

### P4 R3b 落地（2026-09-07）——web 分析器的 JSX / Look / keyframes 三组成为协作者

形状：宿主作第一参数的自由函数（R4a 同形）。`analysis/look/{host,edits,tokens,values,builders,conditions,entries}.ts`、
`analysis/keyframes-analysis.ts`、`analysis/jsx/{host,security,keys,attributes,elements}.ts`；`LookAnalysisHost` 16 项、
`JsxAnalysisHost extends LookAnalysisHost` +23 项（`look:` / `style:` 是 JSX 位置上的 Look 值，JSX 是更宽的一面）；逐程序替换的
状态经 getter，`jsxDepth` 用访问器对以保留 `host.jsxDepth += 1` 原文。`analyzeNativeJsxAttribute` 152→94（六个臂就地抽出，
守卫链本身保持整体——顺序即规则）；`look/edits.ts` 拆开 tokens↔builders 与 values↔builders 两处真环；不造 `jsx/children.ts`
（子节点循环就是对 `inferJsx` 的递归，独立成文件必成环）。宿主接口按代码枚举依赖：`lookDeclarations` 只有 JSX 面读，
`derivedReactiveNames` 只经 `derivedReactiveRead` 操作到达。根不需要任何转发方法：仅四个搬走的方法仍被缝调用，缝直接调协作者。
`analyzer.ts` 3,506→1,842，缝签名逐字节不动；36 个模块零环；47/47 搬移体可逆向还原为 HEAD 原文。allowlist：analyzer.ts →1842、
删 `analyzeNativeJsxAttribute`。产物逐字节不变。

**顺带**：又一条快层绝对墙钟预算（`collection-read-path` 的 COL-P1 两条：200 次 insert、两百万次元素读各卡 100 ms）在并行门禁下
漂过一次；两条移入 `collection-read-path.slow.test.ts`，功能断言留在快层。至此快层里已知的墙钟断言已清（front-end 两条、
COL-P1 两条、ownership-graph 一条改计数）。

### P4 R4d-2 落地（2026-09-07）——typescript-declarations 与 browser-test-runner

`typescript-declarations.ts` 1,736→9：`typescript/{bridge,scanning,signatures,package-exports,parameters,types,classes,declarations,
graph,entry}.ts` 单向（`bridge.ts` 是勘察没列的共享叶子：`parameters` 要 `unsupportedType` 而 `types` 要 `parameters`）；
`parseTypeScriptDeclarations` 310→42（十个具名阶段）、`parseClassDeclaration` 186→74（按成员种类分派）、`parseTsType` 144→31
（五个识别器）、`loadTypeScriptDeclarationGraph` 163→16 与嵌套 `load` 146→34。`browser-test-runner.ts` 997→8：`browser-test/`
16 个模块，`runBrowserTestsInWorker` 302→73（prepare / preview / engines / file / test / verdict，`finally` 留作 teardown，
`engineEntries:` 标签改成 `"continue" | "retire"` 结果）、`installBrowserRuntime` 241→36（八个 runtime-api 家族，30 个方法体
逐字节相同、属性顺序不变——`currentPath` / `viewport` 夹在 `waitForText` 与 `timings` 之间，navigation 因此导出两段）。
门面保留全部公开名；边界门禁 `browser-test-runner.ts` 的单文件读改为家族读（R3-0 先例）。allowlist 删九条，合并后重生成为
20 文件 / 11 函数。产物逐字节不变。
