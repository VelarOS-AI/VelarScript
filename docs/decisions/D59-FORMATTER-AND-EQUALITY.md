# D59 — 格式化器的位置判定与 `toBe` 的相等语义（2026-08-15）

来源：为 D56 写 core 展示时撞出的 14 条。展示的第一个收益兑现得比预期还准 ——
**`check:format` 一直绿，不是因为格式化器对，而是因为语料里没有那些情形。**
实测：全仓 `.vel` 里 `async (` 出现 **0** 次、`const [`/`let [` 解构 **0** 次、
具名实参调用点只有 **3** 处。

---

## 第 141 条 —— `toBe` 必须用语言自己的 `==`

### 实测

```
test "the language says NaN == NaN is true":   ✓
test "equals agrees":                          ✓
test "toEqual agrees":                         ✓
test "toBe agrees":                            ✗  Expected NaN to be NaN
```

机制：`packages/cli/src/standard-modules.ts` 里 `toBe` 是
`if (actual !== expected) throw …` —— **原生 JavaScript `!==`**。
而 Vel 的 `==` 降级为 SameValueZero，`toEqual` 调 `__velarEquals`。
`toBe` 是全语言唯一一个不按语言自己的相等来比的比较。
`-0`/`0` 恰好一致，所以 `NaN` 是唯一的分歧点。

### 这让语言有了三套相等语义

| 拼写 | 语义 | 职责 |
|---|---|---|
| `==` | SameValueZero | 值相等 |
| `equals(a, b)` / `toEqual` | 深结构 | 内容相等 |
| **`toBe`** | **JS `===`** | **——** |

前两个是**两件不同的活**（值 vs 内容），合法。`toBe` 是第三套，**没有对应的活**。

`docs/standard-library.md:1259-1265` 写着「An assertion that disagreed with
the language's own equality would be the worst kind of trap, so there is only
one comparison」—— 那句话紧接着只说了 `toEqual`。**`toBe` 就是它描述的那个陷阱，
而它就在同一段的上一行。**

### 裁决：`toBe` 改用 `==` 的语义（SameValueZero）

判据与 D50 第 99 条完全相同（那条强制 `toEqual` 调 `equals`），
**只是当时没有把同一条论证应用到 `toBe`**。之后：

- `toBe` = `==`（值相等），`toEqual` = `equals`（内容相等）
- 两个匹配器、两件活，**各自按语言自己的拼写去比**

`docs/standard-library.md` 那段一并改写：现在的措辞让读者以为陷阱不存在。

---

## 第 142 条 —— 具名实参是 `name=value`，格式化器不得加空格

### 实测

```
输入   const x = label("a", prefix="<")
输出   const x = label("a", prefix = "<")
```

charter:1085 明写 **`Named arguments use `name=value``**；
docs 里紧凑写法出现 **74 次**，带空格 **0 次**
（`add(value="web")`、`exit(code=0)`、`pop(index=-1)`、`range(end=…)`…）。
**格式化器与 charter 和全部文档表格相反**，而 `--check` 逼着源码跟格式化器走。

仓库里现存的 3 个调用点已经是格式化器的拼写 —— **因为门禁把它们改成那样了**。

### 裁决：紧凑形是唯一形

理由不止「charter 这么写」：`name=value` 在视觉上**把名字绑在值上**，
它是一个实参；加了空格就长得像赋值语句，而赋值在这门语言里是**语句不是表达式**。
让实参看起来像语句是最不该有的歧义。

---

## 第 143 条 —— 格式化器的一元/括号判定必须按位置，不按词表

四处缺陷，同一个根因，**且是 D57 第 134 条那一族的又一次复发**：

| 输入 | 格式化器写成 | 机制 |
|---|---|---|
| `const [head, ...tail] = values` | `const[head, ...tail]` | `needsSpace` 对 `word` 后的 `[` 一律返回 false |
| `const f = async (id: string) => …` | `async(id: string)` | `async` 不在 `parenthesizedKeywordWords` 里 |
| `return -1` | `return - 1` | `isUnaryOperator` 不查 `expressionStatementWords`，`return` 只是个 `word` |
| 续行首的 `+` / `-` | `+ 1` / `- 2` | 见下 |

**第一处是同一个洞第二次犯。** `formatter.ts` 的注释记录着 D51 NEW-D9 曾为
`for i in [1, 2]` 加过一份**白名单**，并写明坏形态「stayed idempotent and
check-clean，所以 `--check` 把它固化了」—— **`const`/`let` 从来没被加进那份白名单。**
这正是第 134 条：本该按位置派生的判断被写成了一份手工词表。

**裁决：改成按位置判定，禁止再往白名单里补词。**

### 续行那一处是架构问题，不是词表问题

格式化器**逐物理行独立处理**，所以续行首的运算符没有前一个 token，
`isUnaryOperator` 把它判成一元。只有 `+`/`-` 中招（`*`、`/`、`%`、`**`、`==`、
`and` 都保住空格），因为只有这两个有一元形态。

**它破坏的是 charter §2 自己的例子**（`+ shipping` / `- discount`）。
这条要求格式化器在续行间携带上下文，比补一条规则大 —— **实施者若判断成本过高，
停下来报给我，不要塞一条特例。**

---

## 第 144 条 —— charter 三处与编译器不符（文档更正 + 一处诊断修正）

### 144.1 `(flag or name) ?? fallback` 写不出来

charter §4 把它当作两种合法拼写之一给出。实测：

```
error VEL4001: Left side of '??' is not optional: bool
```

`and`/`or` 只接受 `bool`/`bool?` 且**总是产出非可选 `bool`**，
所以 `??` 的左边**永远不可能**是 and/or 链。两种拼写里只有
`flag or (name ?? fallback)` 存在。**改 charter。**

（这段是行内散文不是围栏，所以 `check:docs` 从未编译过它。）

### 144.2 `const load = async id => await fetchUser(id)` 不编译

它通过 `check:docs` **只是因为 `fetchUser` 未解析** —— 触发了
`significantFragmentDiagnostics` 的第 3 条（片段里有未解析引用时抑制
`unknown` 级联）。把 `fetchUser` 真正声明出来后：

```
error VEL4001: Cannot assign unknown to string
```

**与 `Record<` 那一课同型：门禁通过的理由与例子对不对无关。**
改 charter 的例子，并记下这条门禁弱点。

### 144.3 `Duration` 在 Core 没有文本形式，而诊断指向一条被拒的出路

charter 称 `Duration` 是 **Core** 值类型；它的文本形式却由 **Web** 扩展声明。
Core 项目里：

```
VEL4026: … format Duration explicitly — print(value) to inspect it,
         or Json.stringify(value) for data text
VEL4001: JSON accepts only records, Lists, enums, primitives, and optionals;
         received Duration          ← 诊断推荐的第二条出路自己被拒
```

**一条诊断给了两条出路，其中一条是它下一步就要拒绝的。** 与 D57 第 136 条同型。
**裁决：Core 声明 `Duration` 的文本形式**（它是 Core 类型，文本形式就该在 Core），
诊断随之只剩正确出路。

---

## 第 145 条 —— 三处未记录的表面

1. **函数类型里的可省参数有真实但未记载的拼写。**
   `(user: User, prefix?: string) -> string` 是**元数**标记，与 `prefix: string?`
   **不同**：前者可省略实参且传 `null` 被拒，后者必须传。charter §5 提到
   「optional parameters」却从未给出拼写，而 §19 拒绝 `let name?: T` 读起来像
   一条通禁。**charter 补上这个拼写并说清它与 `T?` 的区别。**
2. **rest 参数被排除在上下文类型之外。**
   `const total: (...values: number) -> number = (...values) => …`
   → `VEL2016: A rest parameter requires an element type`，
   而定参**是**被上下文类型化的。**要么让它一致，要么记录为有意为之。**
3. **`velar/log` 不发布 sink 记录的类型名。**
   `import {LogRecord} from "velar/log"` → 无此导出。于是 sink 写不成具名 `def`。
   `velar/fs` 发布 `FileWatchBatch`/`FileWatcher`，`velar/serve` 发布
   `ServeRequest`/`Server`/`ServeResponse` —— **`velar/log` 是唯一的例外。**
   **裁决：发布它**，与同族模块一致。

---

## 第 146 条 —— 诊断质量：跨模块同名枚举

两个不同模块里显示名相同的枚举，得到
`Cannot assign Status.done to Status?` —— **读起来像自相矛盾**，
且不指明任何一方的出处。消息要能区分两个来源。

---

## 附录更正（我自己写错的）

`D56-TOUR-INVENTORY.md` 说第 17 章覆盖「`expect` 六个匹配器」。
**编译器的表里有九个**：`toBe`、`toEqual`、`toBeTruthy`、`toBeFalsy`、
`toContain`、`toHaveLength`、`toMatch`、`toThrow`、`toReject` ——
**且哪些可用取决于接收者的静态类型**。附录已按九个更正。

---

### 第 141.1 条 —— `toContain` 同判（实施波上报，裁决）

第 141 条落地后，`toContain` 成了**新的唯一一个不按语言自己的相等来比的比较**：

```
expect([nan]).toContain(nan)   →  false
values.has(nan)                →  true      （List.has 降级为 __velarSameValueZero）
```

它的 List 分支走的是原生 `===`。

**裁决：List 分支改走 `__velarSameValueZero`，与 `List.has` / `in` 一致。**
文本分支不动 —— `String.includes` 本来就是码点同一性。

理由就是第 141 条那句话原样再说一遍：本条的表里只有两件活
（`==` 值相等、`equals` 内容相等），**`toContain` 没有第三件活可做**。
我在第 141 条只裁了 `toBe`，是因为当时只看见了 `toBe` ——
**论证从来不止于被举报的那一个**。

---

## 本文四处不准确（实施波实测更正，2026-08-15）

**1. 第 143 条那张表的续行一行写反了。** 我记的是格式化器写出 `+ 1` / `- 2`；
对着 HEAD 实测，它做的是**删空格**：`+ shipping` → `+shipping`。
我那格里填的是 charter 的**正确拼写**，不是缺陷的**输出**。缺陷与修法不受影响。

**2. 第 143 条续行那条的例子形状本身不合法。** 裸续行
（`const total = subtotal` ⏎ `    + shipping`）根本不是一种续行形式 ——
charter §2 的真实例子是**带括号的**。回归应当用带括号的形状。

**3. 第 143 条列了四项，同一机制下有第五项**：`case -1:` 被写成 `case - 1:`
（`case` 是格式化器在语句头已经认识的上下文关键字，而 `isUnaryOperator` 从不查它）。

**4. 第 142 条说「docs 里紧凑 74 次、带空格 0 次」—— 后半句是错的，有 1 处**：
`docs/standard-library.md:289` 的 `Text.normalize(text, form = "NFC")`，
而同一文件里它的 11 个邻居全是紧凑的。

**第 4 条的错法值得单独记：我的 grep 模式只能匹配紧凑形，
所以它在结构上不可能找到带空格的那一处。** 我用一个只能产出我预期答案的方法
去数，然后把结果当成证据写进了裁决。这与本文第 144.2 条批评 `check:docs`
的毛病**是同一个** —— 通过的理由与被验证的命题无关。
自己刚写下这条，一段之后就犯了它。

---

## 排期

第 141 条（`toBe`）→ `packages/cli`，**独立且最急**：它是测试判定行，
信任链的最后一环（D51 第 105 条同源理由）。

第 142/143 条（格式化器）→ `packages/compiler/src/formatter.ts`。
**必须在展示正文定稿之后落地**，因为展示今天是按格式化器的拼写写的；
落地后**要重跑 `velar format examples/tour/`**，否则 `--check` 会红。

第 144/145/146 条 → 文档更正 + 两处小实现，可并行。
