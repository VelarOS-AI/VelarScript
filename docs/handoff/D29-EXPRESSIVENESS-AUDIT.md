# D29 — 表达力税、采用缺口与一致性（已批准，待实施）

用户于 2026-08-12 逐批确认通过：审计报告第 8-11 条（表达力税）、第 12-15 条
（一致性），外加两条会话中追加的附议。判据同 D28：正常语言用法 →
盲写者不看文档能打对 → 一个明显拼写 > 少写几个字。

编号约定：**第 N 条沿用审计报告的权威编号**；会话中追加的两项记为附议 A / B，
以免与报告编号撞车。

本轮结论分量很轻 —— **真改动只有三项**：`isInteger()`（第 10b）、三处位置参数
收紧（附议 B）、丢弃纯结果报错（第 14 条）。其余是文档、采用迁移、账本改判与
示例清扫，另有两项经评估决定**不做**（附议 A 的 `int` 类型、第 12 条的下标统一）。

**审计过程中五条原始判断被证伪或改判，均已在下文修正** —— 实施者按本文执行，
不要照抄对话里的早期说法：诊断无警告级别（故「合法但不推荐」只能进文档）、
`Map`/`Record` 下标不统一是正确设计、`extern default` 早已成文、
`expose`/`exposes` 不是双拼写、Infinity 之于 `x == x.floor()` 是坑而非活 bug。

## 实施前必读：诊断系统没有警告级别

`packages/compiler/src/diagnostic.ts` 只有一种严重度 —— 每条诊断都让编译失败，
`recoveredDiagnostic` 也计入零诊断门禁。因此**凡是"合法但不推荐"的写法都不能用
诊断表达**，只能落在文档与语言服务器提示（charter §4 给 `invert` 的
"language server offers a preferred quick fix" 即此先例）。

本文所有"提示"一律指 **文档 + 可选 LSP 提示**，不新增编译诊断。D28 的三条诊断
不受影响 —— 那些拼写是被真正移除的，报错是正确的。

---

## 第 8 条 —— 有限状态的分发与映射

### 现状证据

- Lite 把 `AgentEventKind` 的分发阶梯（`else if event.kind == ...`）在三处各写一遍：
  `app/src/store.vel:296-328`（9 臂）、`cli/src/main.vel:93-114`、
  `shared/src/agent-stream.vel:18-53`。
- `app/src/components/tool-activity.vel` 为同一枚举写了**四个**平行 `match` 函数
  （`statusText` / `statusName` / `toolLabel` / `dotColor`），每个 6 臂 12 行。
- 示例同款：`support-desk/src/domain.vel:62-69`（`priorityRank`）、
  `flow-board/src/components/task-card.vel:5-12`（`statusAction`）。

### 8a 分发（各分支做不同的事）—— 不加语法，补惯用法文档

`match event: case {kind: EventKind.text}:` 已经是正确工具（W-53 落地的枚举单例
记录模式）。Lite 写三遍 `else if` 是**可发现性问题**（D 类），不是语言缺口。

实施：

- charter §9 把「枚举单例记录模式的 `match`」明确立为有限状态分发的惯用法，
  并写明它比 `else if event.kind ==` 阶梯多给什么（穷尽性参与非空返回分析、
  变体独有字段在分支内可用）。
- `else if` 阶梯**保持完全合法**。若语言服务器侧成本低，可在同一枚举字段被
  连续比较 ≥3 次时提供改写为 `match` 的 quick fix；**不新增编译诊断**
  （见开头：阶梯是合法代码）。

### 8b 映射（各分支返回同类型值）—— 先补采用缺口，暂不加语法

**实测结论（本轮审计的主要发现）**：字符串背书枚举可以直接当字符串读 ——

```velar
enum Kind:
    awaitingApproval = "awaiting-approval"
    running = "running"

def name(k: Kind) -> string:
    return k          // 编译通过，运行输出 awaiting-approval
```

因此 Lite 的 `statusName`（12 行 match，把成员映射到自身的 kebab-case 拼写）
**完全多余** —— 把枚举声明成字符串背书后 `return status` 即可。W-54 落地的能力
无人使用，这是采用缺口而非语言缺口。

实施：

1. **迁移**：Lite `ToolActivityStatus` 等「成员名 → 线上/DOM 字符串」的映射函数，
   改为字符串背书枚举并删除对应 `match` 函数。示例同类站点一并处理。
2. **文档**：charter §6 在字符串背书枚举段落补一句「成员可直接用于 `string`
   契约」，并给出替代手写映射函数的示例 —— 这是当前唯一未被文档教到的用法。
3. **`Map<Enum, V>` 的陷阱写进文档，不报错**（早期说法「给定向诊断」已修正）：
   `Map<Status, V>` 是**部分映射**，`.get` 返回 optional，`?? fallback` 会让新增
   枚举成员静默落到兜底、穷尽性全丢。部分映射是正当用途，故不可报错；文档必须
   写明「穷尽映射用 `match` 或字符串背书枚举，`Map<Enum, V>` 只表达部分映射」。
4. **重新计数规则（给未来的决策留判据）**：上述迁移完成后重新统计「枚举 → 非字符串
   值」的手写映射函数（如 `priorityRank` 返数字、`dotColor` 返颜色）。若仍 ≥5 处，
   才把「枚举穷尽表」作为新语法提案立项；低于该数不立项。`match` 表达式化维持封存，
   本条不得作为翻案入口。

---

## 第 9 条 —— 块体箭头：永久有意取舍（仅改判账本）

### 现状

`=>` 后的 `{` 解析为记录字面量，故多语句回调必须提成命名 `def`。W-24 当年以
「仅应用暴露」结案，但纯 Vel 证据持续复现：Lite `openai-responses.vel:249-264`
的 `markProgress`、`server/src/main.vel:140-143` 的 `cleanupTurn`、
`server/src/agent.vel:31-57` 的 `executeRun`/`cancelRun`（含一个只为满足记录类型
存在的 `async def cancel() -> null: return`）、示例 `api-dashboard/src/chart.test.vel:17-26`
为 `expect(...).toThrow()` 准备的两个零参函数。

### 决定：不加块体箭头

这个限制**买到了一个 JS 拿不到的好处** —— `session => {session: session, ...}`
无需 `({...})` 包裹即可返回记录字面量，Lite 账本「预期的墙没出现」一节已把它
记为胜利（LEDGER.md 约 160 行）。加块体箭头就要把这个好处退回去，净亏。
Python 同为表达式-only lambda，命名函数是其正常风格。

实施（纯记账，零语言改动）：

- Lite `LEDGER.md` 的 W-24：从「closed as application exposure」改判为
  **永久有意取舍**，写明理由是保住免括号记录返回。
- charter §19「Deliberately absent」加入块体箭头条目，并附上该理由 ——
  目的是让后来者读到取舍依据，不再反复翻案。

---

## 第 10 条 —— 整数运算：加 `isInteger()`，不加整除

### 10a 整除：明确不加（记录理由，防复议）

`//` 是行注释拼写，已被占死；`idiv` / `divFloor` 等候选全是新造词，违背「正常
语言用法」。`(a / b).floor()` 保留 —— 它至少是自明的，且已在两处手写二分中使用
（`shared/src/persistence.vel:114`、`server/src/disclosure.vel:81`）。

charter §7 的数字成员段落写明这条取舍（`//` 被注释占用），避免重复提案。

### 10b `isInteger()`：加

**理由一（主要）**：JS 有 `Number.isInteger`、Python 有 `x.is_integer()`，盲写者
会伸手去找它；`x == x.floor()` 无人能猜到，属民间惯用法。

**理由二（支持）**：该惯用法对 `Infinity` 不成立 —— 实测

```
const overflow = 1e308 * 10
overflow == overflow.floor()      // true —— Infinity 通过了整数检查
```

诚实限定：Lite 那 14 处（`server/src/tools.vel:62,218`、`config.vel:75`、
`shared/src/sse.vel:13`、`agent-stream.vel:64`、`turn-gate.vel:14`、
`persistence.vel:23`、`openai-responses.vel:355` 等）大多同时带范围上界
（`<= 64` 会拦住 Infinity），所以**不是活 bug**，是留给任何缺范围约束站点的坑。
数字字面量 `1e400` 本身被 VEL2017 拒绝，Infinity 的现实来源是算术溢出与外部数值输入。

实施：

- 数字成员表加 `isInteger() -> bool`，语义对齐 `Number.isInteger`
  （`Infinity` / `NaN` 均为 `false`）。现有成员仅 5 个（`abs` `round` `floor`
  `ceil` `toFixed`），扩充成本极低。
- 按既有编译器自有值方法的规矩实现：接收者受检、只求值一次、可作为绑定值取出。
- charter §7 的数字成员段落与 `docs/standard-library.md`（若列有该表）同步。
- 迁移 Lite 14 处与示例同类站点到 `isInteger()`。
- 回归：`Infinity`、`NaN`、`3.0`、`3.5`、负数、`-0` 六种输入的执行级断言。

---

## 第 11 条 —— 响应式读取：语言不动，示例清扫，删 `resource.ready`

### 11a 三种读法保持不变

`state` 裸读、`computed` 调用读 `label()`、`resource` 读 `.value` —— 三者各自
诚实（`computed` 本就是返回访问器的函数；`resource` 本就是 value/loading/error
的捆包），且属 D14'' 封存范围。**不翻案。**

### 11b 删除 `resource.ready`

`ready` 是第四种问同一个问题的方式，可由 `not loading and error == null` 推出，
且不参与收窄（`if r.ready:` 证明不了 `r.value` 非空 ——
`packages/web/src/analyzer.ts:787` 只是普通 `boolType`）。

**使用量实测为零**：`examples/**` 零处、VelarOS-Lite 零处、文档正文仅
charter:1638 那一句字段枚举提到它。

实施：从 `resource` 的字段表移除 `ready`，charter §15 那句同步改为
`value`、`loading`、`error`、`reload` 四字段，并写明规范的就绪读法是
`value != null`（空值判断唯一拼写见 D30 第 22 条）。零迁移成本。

### 11c 示例清扫（发布关键：示例即官网教材）

语言比示例展示的好用 —— 实测 `if data.value != null: return data.value.label`
直接收窄。示例里的解包舞蹈是自己制造的：先把字段包进 `computed(() => x.error)`
（属性级追踪下毫无必要），再被「getter 不可收窄」的正确边界逼出 `const current = ...`。

清扫清单（以门禁与实际行号为准，本表为起点）：

| 项 | 站点 | 处理 |
|---|---|---|
| `computed` 纯包装（8 处） | `api-dashboard/src/main.vel:177-178`；`production-web/components/web-capabilities.vel:123,203`、`activity-feed.vel:30`、`newsletter.vel:48`；`support-desk/pages/tickets.vel:92`、`ticket-detail.vel:86` | 直接读 `x.error` / `x.value` |
| 解包舞蹈（14 处） | `api-dashboard/src/main.vel:183,189,193,197`；`support-desk/pages/ticket-detail.vel:98-103`；`newsletter.vel:31-34`；`support-desk/components/ticket-form.vel:62-66` | 直接 `if x.value != null:` 收窄 |
| f-string 里多余 `str()`（30+ 处） | 示例 `api-dashboard/src/main.vel:17-18` 的 `formatValue` 包装；Lite `openai-responses.vel`(16)、`agent-core.vel`(12)、`tool-registry.vel`(6) | 直接嵌数字（实测合法） |
| todo 示例未展示 D26 | `examples/todo/main.vel:88-101` 全量重建（`todos = [...todos]`、`map` 重建翻转） | 改 `todos.append(...)` 与直接字段突变 |
| JSX 重复调用 computed | `flow-board/pages/board.vel:120-122`（3×`visibleTasks()`）、`components/board-column.vel:49-50`（3×`items()`）、`api-dashboard/main.vel:123-125`（5×`scale()`） | 先读进 `const` |
| 记录 shorthand 未用 | Lite `server/src/tools.vel` 8 处全字段记录字面量 | 用 shorthand |
| 测试断言风格不一 | `support-desk/src/domain.test.vel` 手抛 `Error` vs 其余用 `expect(...)` | 统一到 `expect` |

清扫**只碰 `.vel`，不碰编译器**，因此可与编译器批次并行准备，但必须在条件裁决
批次之后落地（该批次正在改写同一批示例文件的条件写法）。

---

---

## 附议 A —— `int` 类型与 `int()` 包装器：认真评估后决定不做

用户 2026-08-12 提问：「是否需要加个 int 类型，用 int 包装器处理整除的问题，
因为我发现很多时候都需要整数」。评估后决定**不做**。本节记录拒绝理由，
目的是让同一想法半年后被重提时不必重新论证。

### 决定性证据：整数约束已在边界上强制执行

```
v[3 / 2]                  → IndexError: List index must be an in-range integer
"hello".slice(1.5, 3.5)   → TypeError: String.slice positions must be integers
```

小数流进位置参数不是静默出错，而是当场报错。`int` 类型能买到的只是「把已有检查从
运行时提前到编译期」，而检查本身已经存在且失败干净。校验放在 API 里而不是类型系统里，
正是「框架可以任意复杂、对外必须简单」的正确落点。

### `int` 类型的三个成本

1. **除法不闭合，而除法正是动机本身**。`int ± int`、`int * int` 仍是 int，但
   `int / int` 不是（`7 / 2 = 3.5`），于是每个除法点都要重新决策；且 `int * int`
   越过 2^53 会静默丢失整数性（JS 只有 double）。
2. **要真好用就需要流敏感整数推理**（`(a+b)/2` 是否整数取决于是否 floor），
   那是 charter 规则 4 明文排除的类型级编程；做不到则处处写转换。
3. **标准库全表要选边，注解会病毒式扩散**：`get`/`slice`/`padStart`/`range`/`toFixed`
   全要决定收 `int` 还是 `number`；一旦收 `int`，每个喂给索引的算术表达式都要证明
   整数性。这直接违反最高设计法则（对外必须简单、不增加心智负担）。

走 BigInt 更不可行：改运行时模型、JSON 序列化与 `typeof` 语义、不可与 double 混算，
违背规则 1。

### `int()` 包装器是明确的坑

Python 的 `int()` **向零截断**（`int(-3.5) == -3`），而语言里已有的整数化操作
`.floor()` **向下取整**（`(-3.5).floor() == -4`）。一个名叫 `int()` 的东西会被
Python 用户按截断理解，与既有操作在负数上静默分叉 —— 正是「别埋坑」禁止的形态。
`(a / b).floor()` 把取整方式写在脸上，是诚实拼写，保留。

### 唯一可接受的变体及其立项门槛

若日后证据显示真实痛点是「**JSON 边界上反复手写整数校验**」，唯一可接受的形态是
**`Int` 作为 `Type<number>` 精化验证器，仅用于记录字段，完全不参与算术**：

```
type Options:
    maxSteps: Int        // Options.parse() 自动校验，替代手写 assert
```

它复用现成 `Type<T>` 载体与记录验证器，算术上 `Int` 即 `number`，无病毒式注解，
无除法闭合问题。但它开启**精化类型**品类（接着会有 `Positive`、`NonEmpty`、区间）。

**立项门槛**：第 10b 的 `isInteger()` 迁移完成后，重新统计「记录字段的整数校验」
站点，**≥8 处才允许立项**（当前 Lite 3 处、示例 0 处，不达标）。与第 8b 的
枚举穷尽表同一套纪律：用迁移后的真实数字决定，不用当下印象决定。

---

## 附议 B —— 非整数位置参数一律报错（收紧三个异类）

用户 2026-08-12 确认收紧。

### 现状：政策已存在，只有三个成员没服从

实测全语言位置/数量参数对非整数输入的行为：

| 已严格报错 | 软吞返回 `null` |
|---|---|
| `[]` 直接索引、`List.slice`、`string.slice`、`string.index`、`repeat`、`padStart`、`toFixed`、`List.insert` | **`List.get`**、**`string.char`**、**`List.pop`** |

所以这不是新立政策，而是让三个异类服从语言其余部分已在执行的政策。软吞的危害是
**掩盖计算 bug**：本该算出 `2` 的索引算成了 `1.5`，调用方只看到一个 `null`，
与「越界」不可区分。

### 目标语义

- **非整数**位置参数 → **报错**（`List.get`、`string.char`、`List.pop` 三处新增）。
- **越界的整数**位置参数 → **仍返回 `null`**。这是 `[]` 严格 / `.get` 可空的成文
  分工，不变；负整数继续从末尾计数。
- **`Map.get` 与 `Record.get` 不在范围内**。实测 `Map<number, V>` 的键 `1.5`
  返回正确值 —— Map 键是任意身份值而非位置，收紧它会破坏合法用法。Record 键是字符串，
  不适用。

### 实施

- 三处的错误类型与消息**沿用同族既有严格操作的惯例**，不要新造风格：
  List 族参照 `List.slice` / `List.insert`（`__VelarIndexError`），
  string 族参照 `String.slice` / `String.index`（TypeError 家族）。
  例如 `List.get index must be an integer`、`String.char index must be an integer`。
- charter §8 List 成员表的 `get(index)`、`pop(index=-1)` 与 §7 字符串成员表的
  `char(index)` 三处说明补上「非整数索引报错」，与既有 `slice` 等条目的表述对齐。
- 这是运行时语义收紧（破坏性）。若门禁发现有代码依赖旧的软吞行为，那正是本条要
  暴露的隐藏 bug —— 修正调用方，不要放宽规则。

---

## 第 12 条 —— 三套下标政策：不改语义，写成一条规则

用户 2026-08-12 确认通过。**审计中改变了原结论**：原报告建议「`[]` 一律 strict」，
复核后改为**只补文档**。本节记录改判理由，防止后人按原报告去统一语义。

### 现状

`data[k]` 的语义完全取决于静态类型：

| 类型 | `data[k]` |
|---|---|
| `List` | 越界抛 `IndexError`；`.get` 才是可空读 |
| `Record` | 缺键返回 `T?` |
| `Map` | 非法（`Use Map.get(key) instead of bracket access`，analyzer.ts:3481） |

### 为什么不统一（改判理由）

- **Map 禁用的真理由是 JS 语义分叉**：JS 里 `m['a']` 是**属性访问**而非取条目
  （返回 `undefined`），`m['a'] = 2` 设的是属性而非条目 —— JS 的经典 bug 源。
  Vel 允许该拼写就是在同一语法上制造语义分叉，比禁用更糟。charter 规则 2
  「移除源码陷阱而不是加兼容别名」正好支持现状。
- **`Record` 返 optional 是因为它的全部用途就是键不确定的 JSON 对象** —— 缺席是
  常态。改成 strict 会让 `[]` 沦为「生产环境遇到意外数据就抛」的少数正确操作，
  比现状更危险。

三套政策各有正确理由，缺的只是从未作为一条规则写出来（List 在 §8 List 段、
Record 在 §8 Dynamic Record 段、Map 的禁令**只存在于一条诊断里**）。

### 实施（纯文档 + 一条诊断文案）

- charter §8 增设一段显式的三分政策，把三条规则与各自理由并排写出，让读者一次读懂
  「为什么同一个 `[]` 在三种集合上不同」。
- Map 的 bracket 诊断从单纯重定向升级为**教学**：说明 JS 里 `map[k]` 是属性访问，
  因此 Vel 不提供该拼写。（这是既有诊断的文案升级，不是新增诊断。）
- **不改任何语义。** 附议 B 的整数收紧只作用于非整数索引，与本条的越界政策正交。

---

## 第 13 条 —— 记录 `?` 的「缺席/null 合并」：保持，补写数据侧文档

用户 2026-08-12 确认通过。

### 现状

同一个 `?` 在两套类型世界里含义不同：

- **记录**：`avatar: string?` 表示可缺席，且**缺席绑 `null`** —— 缺席与 null 合并为
  一件事，不可区分。
- **组件契约**（charter §14 已写明）：`compact?: bool` 表示可省略，
  `compact: bool?` 表示必传但可为 `null` —— 两回事。

代价：数据层无法建模 JSON Merge Patch 一类协议（`null` = 删除、缺席 = 不动）。

### 决定：保持合并

区分「缺席」必须**表示缺席本身**，这与两条承重简化直接冲突 —— charter §3
「`null` is the only ordinary empty value」与 §18 的全局 undefined→null 归一化。
为小众协议动这两条，代价远大于收益；需要三态的应用显式建模
（例如 `{present: bool, value: T?}`）。

### 实施（纯文档）

charter §6（或 §3 的可选值段落）补明：**记录字段的 `T?` 表示「可缺席或为 null」，
两者有意不可区分**；并指向 §14 说明组件契约为何区分 `compact?: bool` 与
`compact: bool?`。组件侧已有说明，数据侧的空白是读者会踩的坑。

---

## 第 14 条 —— 丢弃纯结果必须报错（本轮第二项真改动）

用户 2026-08-12 确认通过。

### 现状

```
const values = [3, 1, 2]
values.sorted()          // 零诊断，什么都不做（排序副本被丢弃）
```

这是 Python `sort()` / `sorted()` 经典坑的镜像。

### 目标语义

编译器自有、且**不修改接收者**的值/集合方法，其非 null 结果被丢弃时报错
（错误级正当：丢弃纯结果永远是 bug，没有正当用途 —— 与第 8a 的 `else if` 阶梯
不同，那个是合法代码只能靠文档）。

### 作用域纪律（关键，勿做宽）

- **覆盖**：`sorted` `reversed` `copy` `slice` `map` `filter` `reduce` `find` `some`
  `every` `count` `index` `join` `sum` `min` `max` `has` `get` `keys` `values`
  `entries`，字符串族（`trim` `upper` `lower` `slice` `char` `startsWith`
  `endsWith` `replace` `replaceAll` `padStart` `padEnd` `repeat` `split`），
  数字族（`abs` `round` `floor` `ceil` `toFixed`，以及第 10b 新增的 `isInteger`）。
- **必须排除**（返值但改接收者，丢弃合法）：`pop()`（丢弃即「删掉末项」）、
  `remove(value)`（返 `bool` 且已完成删除）。返回 `null` 的变更方法
  （`append` `extend` `insert` `clear` `set` `add` `update`）本就不在范围内。
- **不要分析任意用户函数的纯度**。D26 已把 purity/memo 机制整套退役
  （「仓库已无 purity/memo 优化路径」），不得复活。编译器只对自己拥有的操作下判断。

### 与在途语句边界修复的关系

语句边界修复处理的是 `3;` 这类**悬空 token**；`values.sorted()` 是**语法完整的
语句**，属不同检查。两者互补、不重叠，但都在批次顺序上依赖条件裁决批次先落地。

### 实施

- 分配下一个空闲 VEL 码位（先 grep 全仓，检查集中注册表/清单测试）。
- charter §8 与 §7 的成员表说明补一句：这些操作返回新值，丢弃其结果是错误。
- 迁移：门禁会找出所有站点。示例与 Lite 若有丢弃站点，那正是本条要暴露的真 bug。

---

## 第 15 条 —— 文档缺口：只剩 `%`，两条撤回

用户 2026-08-12 确认通过。

### 必补：`%` 取模与 `%=`

charter:298 只讲了 `**`、`in`、`not in`、`is`、`is not`，**全篇未提 `%`**；
`%` 的唯一出现是 §17 的 Percentage 单位。取模运算符存在（lexer 的
`percent` / `percentAssign`）却从未成文。

**语句边界修复落地后本条更紧急**：web 项目里 `10%3` 会从静默错编变成报错，
用户必须知道该运算符存在且需要空格（该定向诊断由条件裁决批次实施）。

实施：charter §4 在 `**` 同段补入 `%` 与 `%=`，并写明 Web 扩展下
数字紧贴 `%` 是百分比字面量、取模需要空格。

### 已在别处覆盖

事件修饰符 `.prevent` / `.self` / `.stop` 的文档化归 D28 第 6 条（用户裁决保留 →
必须文档化）。

### 撤回两条（原报告有误）

- **extern `default` 导出契约：已成文，W-8 早已闭合。** `docs/javascript-bridge.md:152-153`
  明写「This is a supported contract, not a parser accident」，并给出
  `export class default:` / `export const default:` 两种示例。原报告称其为缺口有误，
  从清单撤销。
- **`expose` / `exposes` 不构成规则 3 违例。** 二者是不同构造 —— 声明头子句
  （`component Dialog(...) exposes DialogHandle:`）与语句（`expose {open, close}`），
  英语语法本身要求不同词形，不是一件事的两种拼写。不改。

---

## 批次与门禁

严格按序，避免文件冲突：

1. **进行中：条件裁决批次**（语句边界 + `bool` 条件真值化 + 非 bool 可选值禁裸判）
   —— 正在改 `parser.ts` / `analyzer.ts` / `emitter.ts` / `web/parser.ts` 与 9 个示例。
   **后续所有批次都等它三道门禁全绿。**
2. **批次 A（Core 编译器）**：D28 第 4 条（`case _:` 唯一）+ D28 第 7 条（撤 `invert`）
   + 本文 10b（`isInteger()`）+ 附议 B（三处位置参数收紧）+ 本文第 14 条（丢弃纯
   结果报错）。同族文件一次改完 —— 这四项都动数字/集合运行时与同两张 charter
   成员表，拆批会反复改同文件。附议 A 无实施动作（决定不做），仅作拒绝理由存档。
3. **批次 B（Web）**：D28 第 5 条（`null` 唯一 + `WebNode?`）+ D28 第 6 条文档
   + 本文 11b（删 `ready`）。
4. **批次 C（纯文档与账本）**：本文 8a / 8b 文档、9（charter §19 + Lite LEDGER 改判）、
   10a 取舍记录、第 12 条（§8 三分政策 + Map 诊断文案升级）、第 13 条（§6 缺席/null
   合并）、第 15 条（§4 补 `%` 与 `%=`）。可与 B 并行（不碰同文件）。
5. **批次 D（示例与 Lite 清扫）**：本文 8b 迁移、10b 迁移、11c 全表。最后做。

每批次跑 `npm run check` → `npm test` → `npm run test:browser`。全部批次结束后
按惯例复跑一次对抗搜捕的相关维度（值方法、枚举、响应式读取三路）。

## 新增回归（永久）

- 字符串背书枚举成员满足 `string` 契约（编译 + 执行）。
- `isInteger()` 六输入断言（含 `Infinity` / `NaN` 为 `false`）。
- `List.get` / `string.char` / `List.pop` 对非整数索引报错，对越界整数仍返回 `null`，
  负整数仍从末尾计数（执行级，三个成员各自覆盖）。
- `Map<number, V>` 的小数键读写保持正确（防止附议 B 误伤 Map）。
- 丢弃 `sorted()` / `slice()` / `trim()` 等纯结果被诊断；丢弃 `pop()` / `remove()`
  与返回 `null` 的变更方法保持合法（第 14 条作用域证明，正反两侧各自覆盖）。
- `Map` bracket 诊断的教学文案有断言，`Record[k]` 与 `List[i]` 的既有语义未被
  第 12 条改动。
- `resource` 字段表不再暴露 `ready`；`value is not null` 收窄有执行级证明。
- 示例清扫后四个示例应用的整编、测试与三浏览器门禁保持全绿（防止清扫引入回归）。
