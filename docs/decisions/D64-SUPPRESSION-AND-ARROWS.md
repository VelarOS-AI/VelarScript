# D64 — 片段抑制、异步箭头与三处表面缺陷（2026-08-16）

来源：波 P2 的上报。其中第 167 条是**本批最重的一条** ——
它说的是 `check:docs` 的覆盖面比它自称的小得多。

---

## 第 162 条 —— VEL4037 在「函数体返回值」情形要换一条消息

实施波指出：我只裁了「不携带机械修复」，**没管消息**。于是现在

```
def f() -> null:
    return 2
```

得到的仍是「infers `-> null` from its body; **delete the annotation**」——
**而删除正是这条裁决刚刚禁止工具去做的事。**

**这是 D57 第 136 条那个形状**：诊断在教一条它自己下一步就拒绝的出路。

**裁决：采纳实施波的建议 (b)**，非推断情形换一条消息，大意为

> Function 'f' takes its result from its body, which returns number, not null;
> change the body or the result you meant — deleting the annotation would
> widen the signature.

**它没有自行改，是对的** —— 消息措辞是设计层的，规格没写就该问。

## 第 163 条 —— 异步结果标注在两个位置要求相反的拼写

实测（我复验）：

| 位置 | `-> string` | `-> Promise<string>` |
|---|---|---|
| `async def` 声明 | **干净** | **VEL4018 拒绝** |
| 异步箭头的函数**类型** | **VEL4001 拒绝** | **干净** |

**两个位置各自拒绝对方的拼写。**

### 这不是语义 bug —— 两边各自自洽

声明的标注命名**解析值**（调用类型仍是 `Promise<T>`，charter 明写）；
函数**类型**描述的是那个值的真实类型，而异步函数返回的确实是 Promise。
两边分别成立。

### 但 VEL4018 的措辞是假通则

> An async result annotation names the resolved value

**这句话在函数类型位置是错的。** 一个刚被 VEL4018 教过的作者，
到类型位置会写 `-> string`，然后被 VEL4001 拒绝 —— **语言先教了他一条规则，
再因为他照做而拒绝他。**

### 裁决

1. **VEL4018 的消息加上作用域**：「in a declaration」。它管的是声明位，不是全语言。
2. **类型位置的 VEL4001 要教正确拼写** —— 现在只报「Cannot assign
   `(id: string) -> Promise<string>` to `(id: string) -> string`」，
   不说该怎么写。要点名 `-> Promise<string>`。
3. **charter 把两个位置并排写出来。**

第 3 点与盲测三轮第 4.2 条**同源**：那条说值级 `=>` 与类型级 `->`
「简报缺少并排例子」，这条是同一个毛病往下一层 ——
**同一个概念在两个位置拼写不同，而语言从未把它们并排展示过。**

## 第 164 条 —— `readonly` 不能作记录字段名（缺陷）

```
type Holder:
    readonly: number        → VEL2001 Expected a field name
const h = {readonly: 1}     → 干净
```

`parser.ts:1284` 先把这个词读成修饰符，再看它后面是什么。
**其余每个上下文关键字都只被自己的形状认领**，而「关键字后跟 `:` 就是关键字命名的字段」
在别处处处成立。charter §3 的七位置承诺对 `readonly` 不成立。

**裁决：修**。实施波给了一行修法（`checkWord(readonly) && peekKind(1) !== "colon"`），
并且**只钉住了今天的行为、明确注明不是背书** —— 处置正确。

## 第 165 条 —— `{match}` 记录简写在箭头体里被拒（缺陷）

```
const f = (x: number) => {match}      → VEL2030 An arrow body is a single expression…
const f = (x: number) => {type}       → 干净（`using`/`test`/`as`/`from`/`get`/`readonly`/`constructor` 同）
```

`arrowBraceHoldsStatements`（`parser.ts:2515`）把语句起始词当作证据，
除非下一个 token 是 `:`；而简写的下一个 token 是 `}` 或 `,`。

**这是 charter §3 对 `match` 的违反。** 实施波**因此没有扩大
`statementStarterWords`** —— 扩大会把这个 bug 一并扩到 `type`/`test`/`using`。
**那个判断是对的**：先修 bug，再谈扩大。

**裁决：修** —— 词分支排除 `rightBrace`/`comma`。

## 第 166 条 —— charter §3 的两份清单是错的

- 它把 `constructor` 与 `get` 列进「保留、用作名字会被报出」，
  **而两者的 `bindingNameRestriction` 都返回 `null`** —— 实测七个位置都能当普通名字用。
- 它的上下文关键字清单（`type, match, from, as, using, test`）**漏了
  `constructor`、`get`、`readonly`**，而解析器对这三个的认领方式完全相同。

**裁决：按第 157 条的名册改写这两处** —— 名册现在是权威，charter 引它。

---

## 第 167 条 —— `check:docs` 的片段：73% 因无关理由通过

### 实测（实施波用插桩副本跑全量 docs）

```
围栏 188；片段 110
抑制规则实际生效的片段：              80   （占片段 73%）
  仅子句 1（未解析引用自身）：         16
  子句 2 生效（诊断包住该引用）：       60
  仅子句 3（纯因为出现 unknown 而丢）： 14
```

### 但这个数字**低估了**弱点，而 D59 第 144.2 条就是证据

**一旦一个名字未解析，分析器把它定为 `unknown` 并停止检查其下游** ——
于是缺陷可以**根本不产生诊断**，从而永远不会走到任何抑制子句。

D59 第 144.2 条那个 `Cannot assign unknown to string` **不在上面的清单里**，
因为 `fetchUser` 未解析时它压根没被发射。**那个坏例子在 charter 里躺了很久，
门禁每次都绿。**

所以这一族的形状不是「抑制规则太宽」，而是：

> **一个未解析的引用会关掉它下游的检查，而 73% 的片段里有一个。**

### 裁决

**一、片段可以声明它引用的名字。** 机制用 markdown 注释，写在围栏之前：

```
<!-- velar-preamble
def fetchUser(id: string) -> string:
    return id
-->
```

它**渲染不可见、门禁编译**。有前言的片段**按完整例子全量检查，不再抑制**。

**二、门禁必须报出它没能完整检查的片段数。** 这条比第一条更重要 ——
今天那 73% 是**隐形**的，门禁只说「Checked 188 examples」。
**没有静默的覆盖缺口**（D56 第 129 条同一纪律）：数字必须打印出来，
然后才谈把它降下去。

**三、迁移按证据驱动，不按数量指标**：先给**抑制真的掩盖了诊断**的片段补前言。
先跑第二条拿到数字，再决定第三条做到哪。

**不采纳「把片段全部改成完整例子」** —— 那会让文档为了门禁而变啰嗦，
是让工具支配读者。前言的存在意义正是：**给门禁的上下文不必给读者看。**

---

## 确认实施波的两处判断

1. **名册成员偏离 D62 的表，是对的。** 它排除了 `init`/`set`/`default`
   （只为拒绝而存在 —— 上名册会让覆盖率门禁**把已删除的特性要回来**，
   正是 D62 自己警告的陷阱）与 `dispose`（只在 `@` 后读）；
   补入 `get`/`readonly`（活语法，D62 的表漏了）。
   **D62 那张表是我从调查波的转述里抄的，实施波去查了源码 —— 以它为准。**
2. **它没有扩大 `statementStarterWords`**（见第 165 条），理由正确。

## 归属

第 162/163 条 → `packages/compiler`（消息）+ charter。
第 164/165 条 → `packages/compiler/src/parser.ts`。
第 166 条 → charter（等 `packages/web` 那波放开）。
第 167 条 → `scripts/check-documentation-examples.mjs` + 文档迁移，**单独一波**。
