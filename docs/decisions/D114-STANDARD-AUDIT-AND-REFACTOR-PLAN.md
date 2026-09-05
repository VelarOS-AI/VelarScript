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
