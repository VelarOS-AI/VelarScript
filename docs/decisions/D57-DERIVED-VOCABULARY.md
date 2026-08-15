# D57 — 手工名单缺陷族（2026-08-15）

来源：为 D56 的展示推导内容清单时，只读调查撞出的五处问题。全部经我复验。
其中两处与 D55 第 127.2 条**同一个根因**，因此本文先给这个族命名。

---

## 第 134 条 —— 缺陷族：本该派生的名单被手工维护

**族的定义**：编译器某处需要一份名单，而该名单**已经有一份权威来源**
（一张表、一个名册、一个注册表），实现却**另抄了一份手工副本**。
副本从写下的那天起就开始漂移，而且**漂移是静默的** —— 它不报错，
它只是对新成员视而不见。

### 已确认的三例

| 手工名单 | 权威来源 | 漂移后果 |
|---|---|---|
| `formatter.ts:22` 的 `genericNames`（6 个名字） | 任何带类型实参的类型 | `x: Record<string>` 被格式成 `Record < string >`（D55 第 127.2 条） |
| `source-names.ts:45` 的 `coreReservedBindings` | 常驻命名空间名册 + 前奏名字 | `Json`/`Promise`/`Text`/`equals`/`range` 可被静默遮蔽（第 135 条） |
| VEL6003 的「可用标准模块」清单 | 标准模块表**与常驻迁移状态** | 教一条走不通的路（第 136 条） |

### 为什么值得单独立条

三处的表征完全不同（格式化难看、遮蔽、错误提示过期），**但修法是同一条**，
而且**只修表征不修根因，下一个成员加进来时会再犯**。

尤其要注意 `coreReservedBindings` 里 `Math` 之所以被保护，
**是因为它恰好也是一个 JavaScript 全局** —— 不是因为它是常驻命名空间。
**保护是意外来的。** 这正是手工名单最危险的形态：它看起来在工作。

### 裁决：凡属本族，一律改为从权威来源派生

- **禁止**「把缺的那个名字补进名单」这种修法 —— 那是把同一个洞留给下一个成员。
- 派生不可行时（确有此情形），名单处**必须写明它派生自哪张表、
  以及新增成员时必须同步改这里**，并**尽量加一条断言把两者钉在一起**。
- D56 第 129 条的覆盖门禁是这条纪律的正面形态：反查编译器自有表格，
  禁止手工清单。**本条与它同源。**

---

## 第 135 条 —— 常驻命名空间与前奏名字不可被遮蔽

### 实测（复验，非转述）

```
const Json = 1      → 无诊断
const Promise = 1   → 无诊断
const Text = 1      → 无诊断
const equals = 1    → 无诊断
const range = 1     → 无诊断
const Math = 1      → VEL3007（仅因为 Math 也是 JS 全局）
const print = 1     → VEL3007
```

遮蔽是彻底的 —— 下面这段**编译干净**：

```
const Text = {slug: "not a function"}

export def broken() -> string:
    return Text.slug
```

### 这同时违反两条既有裁决

1. **charter §3**：「Core bindings … cannot be shadowed」——
   文档声称的保护并不存在。
2. **D51 第 106 条**：命名空间「不是值，是词汇」，在成员访问头之外的
   每个位置都被拒绝。**而一个同名的局部绑定把整个词汇顶掉了** ——
   第 106 条堵了展开、解构、导出、`print` 四条侧门，
   **正门（同名绑定）一直开着。**

### 裁决

`Json`、`Promise`、`Text`、`Math` 四个常驻命名空间与
`print`、`str`、`number`、`equals`、`range` 五个前奏名字，
**一律不可作为绑定名**，诊断沿用 VEL3007 的既有形态。

**实施要求（第 134 条的直接应用）**：不要把五个名字补进
`coreReservedBindings`。**改为从常驻名册与前奏名册派生** ——
将来 D55 泛型或别的工作再加一个常驻名字时，保护必须自动跟上。

### 对 D56 第 129 条的连带影响（重要）

覆盖门禁若用**文本检索**断言「`Text.slug` 出现在展示中」，
一个把 `Text` 定义成局部记录的文件就能**伪造覆盖**。
**门禁必须按解析后的引用判定，不能按文本判定** —— 或者本条先落地。
两者取其一，不可都不做。

---

## 第 136 条 —— VEL6003 的模块清单必须反映常驻迁移

Core 项目里写一个不存在的 `velar/` 模块，得到：

```
VEL6003 Unknown standard module "velar/look"; did you mean "velar/log"?
The standard modules are: velar/async, velar/collections, velar/env, velar/fs,
velar/host, velar/http, velar/id, velar/json, velar/log, velar/math, velar/path,
velar/process, velar/serve, velar/terminal, velar/test, velar/text, velar/time, velar/url
```

其中 **`velar/async`、`velar/json`、`velar/math`、`velar/text` 的每一个成员
都已迁进常驻命名空间**（波 I1）。照这份清单写
`import {sqrt} from "velar/math"` 会立刻撞上 VEL3008「直接用 `Math.sqrt`」。

**裁决：清单必须与迁移状态一致。** 要么移出这四个，要么标注
「其成员经 `Math.`/`Json.`/`Text.`/`Promise.` 直接可用，无需导入」——
**倾向后者**，因为作者要找的能力确实在那儿，只是拼写不同；
直接移出会让「`Math` 从哪来」失去线索。

一条诊断把人送上一条它自己下一步就要拒绝的路，是最坏的一种诊断。

---

## 第 137 条 —— `velar/fs` 的 `Blob` 是死端，删除

`blobClass`（`packages/node/src/compiler.ts:109`）：`abstract: true`，
`fields`/`getters`/`methods`/`staticFields`/`staticGetters`/`staticMethods`
**全为空**。`blobType` 全仓只被 `readBlob` 的返回类型引用，
**没有任何 API 接受它**，它也没有文本形式。
一个 `Blob` 值除了被持有之外做不了任何事。

**裁决：删除，与 D50 第 92 条同判据** —— 那一条以
「publishing an unreachable name is worse than publishing nothing」
为由删掉了 `Opacity`，本条逐字适用。

`readBlob` 的处置随之定案，由实施者在两条里选并上报：
它若也无人可用，一并退役；若它是将来 `velar/http` 上传路径的前置，
则**保留但补上至少一个消费方**，不留悬空返回类型。
**不接受「先留着以后可能用」** —— 那正是被禁止的累积式设计。

---

## 第 138 条 —— `velar/web-test` 在导入侧设卡

实测：一个**普通**（非测试）web 模块

```
import {browser} from "velar/web-test"

export async def peek() -> string:
    return await browser.text("#x")
```

**编译干净**。普通 `.test.vel` 里同样无诊断。但它只在
`velar test --browser` 下有运行时 —— 其余场合是一个必然失败的调用。

`packages/web/src/compiler.ts` 里已有 `browserTestDrivingGuidance()` 这条
为浏览器测试写的教学文案，**说明这个边界是被意识到的，只是没在导入侧设卡**。

**裁决：`velar/web-test` 仅可从 `*.browser.test.vel` 导入**，
其余位置在**导入处**拒绝并教正确的文件名。

理由与 D51 第 109 条同型（在声明处拒绝优于在使用处产生歧义）：
错误落在 `import` 那一行，比落在运行时的一次失败调用上早得多。
盲测二轮的头号痛点正是这条边界不可发现 —— 现在它连误用都不报。

---

## 归属与排期

第 135/136 条 → Core 分析器与诊断，可与 D55 第 127.2 条同波
（三者同属第 134 条的族，一起修根因最省）。
第 137 条 → `packages/node`；第 138 条 → `packages/web`。
四条均**不阻塞** D56 的展示骨架，但**第 135 条必须先于覆盖门禁落地**，
否则门禁可被伪造（见第 135 条末段）。
