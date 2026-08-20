# D86 — 必需值解包 `value!`（用户裁决 2026-08-20）

这是一份已实施裁决的历史记录。当前语言契约见
[语言宪章](../language-charter.md#required-values)。

## 问题

用户 2026-08-20：「我打算增加一下 `!` 断言」「这样可以简化 assert null 这种写法」。

裁决前，把一个 `T?` 变成 `T` 只有语句形态：

```
const tags = self.tagsById.get(blockId)
assert tags != null else f"Missing tag index for block id {blockId}"
return tag in tags
```

三行。本仓自己的库里就有同一形状（`libraries/text-buffer/src/index.vel` 的
`requiredLeft` / `requiredRight`），所以这不是个别写法的问题。

---

## 第 212 条 —— 主裁决：`value!` 是**检查式**解包

### 裁决（用户在设计层直接选定的三项）

1. **语义：检查，不是声明。** `value!` 取 `T?` 得 `T`；值缺席时在**该位置**
   抛 `AssertionError`。
2. **拼写：`x!`**，保持 `!=` 的最长匹配（见第 213 条）。
3. **与 `assert` 按位置分工**：`value!` 是**表达式位**的解包，消息由编译器写；
   `assert value != null else "..."` 是**语句位**的契约，消息由作者写。

### 为什么不是 TypeScript 的 `!`

TS 的 `!` 是**不检查**的：它擦除，写错时 `undefined` 流到十行之外才炸。
它与本语言三处正面冲突：

- **规则 2**「移除源码陷阱而不是加兼容别名」—— 它是 TS 最著名的陷阱；
- **charter §19** 明列「TypeScript-style interfaces, **assertions**, overloads」
  为刻意缺席；
- **窄化设计整体反着来** —— Vel 的流事实在**每个读取点**重新校验、失败抛
  `NarrowingError`（charter §5）。一门专门花代价保证「陈旧事实会响」的语言，
  不能同时提供一个「我说有就有」。

**语言没有「相信我」的拼写。** 编译器看不见的信念正是规则 2 要拔掉的东西。

### 为什么抛 `AssertionError`，而不是新错误类

与 `assert` 同一个理由：这里缺席意味着**程序错了**。charter §11 已经把
`AssertionError` / `NarrowingError` / `IndexError` 立为「不被 `try` 转成 null」
的三个，`!` 直接落进这一族，不需要新概念。实测确认 `try find()!` 不吞、
`catch` 照常收到。

### 与 [D54 第 118 条](D54-CONSIDERED-AND-REJECTED.md) 的关系：**不冲突，不推翻**

第 118 条否决的是**前缀** `!` 作为 `not` 的第二拼写，理由是「一个概念一个拼写」
与「`!` 在人眼里第一直觉是强调而非否定」。本条加的是**后缀** `!`，它不是任何
既有概念的第二拼写 —— 解包在裁决前只有语句形态，没有表达式形态。第 118 条
关于前缀的裁决**原样保留**：`!ready` 仍然是 VEL1005 教学诊断，仍然教改 `not`。

一个字符两种读法确实是本条付出的代价。它可接受的原因是**位置把它们完全分开**，
且分工与人眼直觉一致：`!value` 是「否定」，`value!` 是「强调它在」——
后者恰好是第 118 条说的那个直觉。

---

## 第 213 条 —— 词法：读法由位置决定，`!=` 仍然最长匹配

### 裁决

- 裸 `!` 词法化为一个 **`bang`** 记号，**词法层不再判断它是什么**；
- **前缀位**（`parseUnary` 见到 `bang`）→ 按 `not` 解析，并在**解析器**发出
  第 118 条那条 VEL1005（含带空格的机械修复：`!ready` → `not ready`，
  `and!ready` → `and not ready`）；
- **后缀位**（`parsePostfix` 在操作数之后见到 `bang`）→ `RequiredExpression`。

VEL1005 从词法器移到解析器，是因为**只有解析器知道这个 `!` 站在哪一侧**。
诊断码、文案、机械修复三样都不变。

### `!==` 保持不动（实施中试过改写，据实回退）

`!=` 仍然最长匹配，所以 `value!==other` 是解包唯一拿不到的拼写，作者必须写
`value! == other`。

实施中先按「看前一个记号」改写过：若 `!` 前面是操作数，就把 `!==` 恢复成
`bang` + `equal` 并报一条定向诊断。**回退，理由是它打坏了更常见的情形** ——
`a !== 1`（JavaScript 严格不等）前面同样是操作数，于是那条启发式把一个**极常见**
的 JS 习惯重定向到了解包读法，还多报一条。两种读法在这个拼写上不可判别。

**最终形态**：恢复与机械修复都按 JavaScript 读法（那是常见的那一个），
**只把另一种读法写进文案**：

```
Use '!='; inequality is already strict in VelarScript — and if the '!' unwraps
the value before it, give '==' its space: 'value! == other'
```

一条诊断、一个修复、两种读法都被点名。

---

## 第 214 条 —— 边界（穷尽）

### 合法

```
lookup.get(key)!          // 解包一次读取
owner.profile!.email      // 后缀，与整条 postfix 链同级绑定
rows[0]!.size
run!()                    // 解包一个可选可调用值
f"{name!}"                // 表达式位处处可用
(await load())!           // 括号让解包够到 resolved value
```

### 非法，各有定向诊断

| 写法 | 诊断 |
|---|---|
| `name!`（`name: string`） | **VEL4040**「已经是 string，去掉 `!`」+ 机械修复。冗余检查在本语言一律是错误，与「重复的存在性检查是错误」同源 |
| `value!`（`value: unknown`） | **VEL4040**「`unknown` 不是可选；先用 `is` 或 `parse` 校验」，**不给**机械修复 —— 去掉 `!` 解决不了它的问题 |
| `await load()!` | **VEL4040**「这是 `Promise<...>`；写 `(await ...)!`」。与 `try` 对未 await 的 Promise 的定向诊断同一族 |
| `held! = "b"` | **VEL2005**「`!` 解包的是被读的值，不能站在赋值目标上」+ 机械修复。写入既没有结果可解包也没有事实可证明，且把 `null` 写回可选是合法的 |

`any` 不报错也不解包 —— 它是逃生通道，`!` 在它上面返回 `any`。

### 格式化

后缀 `!` 紧贴它解包的值（`lookup.get(key)!`、`a! == 1`、`owner.profile!.email`）。
实现上把 `!` 记号并入 `endsExpression`，于是 `x!(...)`、`x![0]` 也自然紧贴。

---

## 第 215 条 —— `value!` **不**建立流事实（刻意）

`assert value != null` 之后，`value` 在其后整段作用域里读作 `T`。
`value!` **不**这么做：它只产生一个 `T` 值。

理由：

- **求值顺序**。`assert` 是语句，事实的起点无歧义；`!` 可以出现在
  `f(x!, g(x))` 这种位置，「从哪里开始成立」需要一套表达式内的事实传播规则，
  而买到的东西很少；
- **主用法不需要它**。`const definition = catalog.get(id)!` 绑定的 `const`
  本来就持有 `T`，没有事实可用；
- **它正是第 212 条那条分工**。需要「此后都成立」的是**契约**，那是 `assert`
  的位置。

---

## 实施记录：内联 helper，不新增 runtime module

`__velarRequired` 走 `integrityFailureHelpers` 那条既有路径 —— 一个按需发射的
模块内联函数，**不新增 runtime module**，因此运行时边界网关
（`scripts/check-runtime-boundary.mjs`）零改动。发射形态：

```
__velarRequired((__velarMapGet(rows, "a") ?? null), "'rows.get(...)'", 63)
```

消息里的名字由一个小的 AST 描述器给出（标识符、点路径、下标、调用各自读回
作者写的形状），配上源偏移量。与 `assert` 的降级形态一致：`new Error(...)` 加
`.name = "AssertionError"`，因此 `__velarIsIntegrityFailure` 原样认得它。

---

## 重开条件（证伪判据）

1. 盲测显示模型把 `!` 当成 TypeScript 的擦除式断言来用（说明「检查」这一点
   没教清楚，届时该改的是诊断与简报，不是语义）；
2. 出现真实需求要求 `value!` 建立流事实（第 215 条重开，届时要先解决表达式内
   事实起点的定义）。

**不构成重开理由**：与 TypeScript 一致、少打字符。
