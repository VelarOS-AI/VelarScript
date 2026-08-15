# D56 — `examples/` 退役与「用法展示」（用户裁决 2026-08-15）

用户原话：「仓库的 examples 也应该退役了，换成当前的所有的用法的一个展示。」
并选定形态：**展示 + 一个完整真实应用**。

本文是 D52 第 115 条中 examples 部分的细化规格，取代该条对示例的原有描述。

---

## 第 128 条 —— `examples/` 的新形态

```
examples/
  README.md            —— 展示地图：每一部分教什么、按什么顺序读
  tour/                —— 系统展示：每个拼写一处，穷尽
    core/     velar.json + main.vel + 17 章
    web/      velar.json + main.vel + 13 章
    desktop/  velar.json + main.vel + 3–4 章（第 132 条）
  app/                 —— 一个完整真实应用
    README.md + velar.json + src/ + 测试
```

**章数取自实测推导，不是估计**（清单推导波，2026-08-15）。本条初稿写的
core 14 / web 7 是占位数，真实词汇量需要 core 17 / web 13。初稿另有一处**错误**：
写作 `14-testing.vel` —— `test "…":` 只在 `*.test.vel` 顶层成立
（实测 `VEL3019 Tests live in a '*.test.vel' module`），该文件名编译不过，
更正为 `17-testing.test.vel`。

### 组织约束：每个文件必须从 entry 可达（实测，决定目录形态）

**`velar check <项目>` 不检查从 entry 不可达的 `.vel`。** 实测：一个带明显类型
错误的 `orphan.vel` 放在项目里，门禁绿。只有 `*.test.vel` 走第二遍
（`packages/cli/src/cli.ts:421` 的 `projectTestModules`）。

**所以第 130 条「tour 是门禁语料」不会因为把文件放进目录就自动成立**：

- `check:format` 按目录遍历（`scripts/check-velar-format.mjs` 走 `examples/**`），
  **格式那一半自动成立**；
- **编译那一半不自动成立** —— 每个 tour 文件必须**要么被 entry 具名导入、
  要么叫 `*.test.vel`**。而裸副作用导入被禁（charter §12），
  所以每章至少导出一个名字，`main.vel` 逐个具名导入。

这条要写进 `examples/README.md`，否则后来者加一章而不改 entry，那一章就静默失去覆盖。

**两者分工必须写进 `examples/README.md`，因为它们教的是不同的东西**：

| | 教什么 | 读者何时来 |
|---|---|---|
| `tour/` | **每个拼写怎么写** | 「这个东西在 Vel 里怎么说」 |
| `app/` | **模块怎么划、状态归谁、路由与测试怎么组织** | 「真实规模的 Vel 长什么样」 |

盲测二轮的证据支持这个分工：新表面 7/7 零返工（拼写可发现），
而返工集中在**结构性**问题（`velar/storage` 用法、组件 props 的 readonly 投影）
—— 拼写和结构是两类知识，需要两类展示。

---

## 第 129 条 —— 穷尽性是**门禁**，不是声明

「所有的用法」是一句可以造假的话。**本条把它做成可验证的。**

新门禁 `check:tour-coverage`：**反向查询编译器自有的封闭词汇表**，
逐项断言它出现在 `tour/` 中；缺一项则红，并指名缺哪一项。

### 清单必须机械推导，**禁止手工维护的名单**

手工名单会过期 —— 那正是它要防的问题。已确认可枚举的来源：

| 词汇表 | 来源（实测确认可枚举） |
|---|---|
| 硬关键字（**40 个**） | `packages/compiler/src/token.ts:105` 的 `keywordKinds` |
| 扩展的上下文关键字 | 各扩展声明的 `contextualKeywords`，由 `parser.ts:151` 汇总 |
| Core 上下文关键字 | `parser.ts` 的 `statementStarterWords` 等表（`match`、`test` …） |
| 标准模块与**其每一个导出** | `packages/cli/src/standard-modules.ts` 的 `moduleInterface(new Map([…]))` |
| 类型约束 | `types.ts:104-141` 的 4×3 授予表（`Comparable`/`Text`/`Data`） |
| 常驻命名空间 | 常驻名册（`Json`/`Promise`/`Text`/`Math`，波 I1 落地后为四个） |

**允许豁免，但豁免必须具名并写理由**（例如 `enum` 若在某处无法示范）。
豁免表进门禁脚本，**不进 tour 本身** —— 让「我们没覆盖什么」在一个地方看得见。

### 为什么这条值得做

它把用户的方法论**机械化**了：新增一个拼写而不写进展示，门禁当场变红。
「等用到了再加」在结构上不再可能
（见 `memory/vel-design-completeness-not-accretion.md`）。

---

## 第 130 条 —— 展示**同时是门禁语料**，据此关掉 gate-gap 族

`tour/` 下的 `.vel` **必须**被 `check:format` 与整编门禁覆盖。理由是一条实测教训：

D55 第 127.2 条查实的格式化器缺陷（`x: Record<string>` → `x: Record < string >`）
之所以长期没被发现，是因为**全仓 `.vel` 里 `: Record<` 出现 0 次** ——
**门禁通过的原因是语料恰好没有那个情形，不是格式化器正确。**

一份穷尽的 `tour/` 就是穷尽的门禁语料：**每个拼写都被格式化器与编译器走过一遍**。
这是本次改造除教学之外的第二个收益，而且可能是更大的那个。

**推论（写给实施者）**：`tour/` 追求的是**拼写覆盖**，不是场景真实感。
一个文件里并排放十个只差一点的写法是**对的**，不要为了"像真实代码"而合并或省略。
真实感由 `app/` 负责。

---

## 第 131 条 —— `app/` 的净化：夹具不是示例

`examples/production-web` 今天是**混合体**：`src/pages/broken.vel`、
`construction-failure.vel`、`state-lab.vel` 是**错误路径的测试夹具**，
不是应用代码。这正是它读起来不像样的原因。

**裁决：**

1. **错误路径夹具移进 `tests/`**（与 D52 把 `core.vel`/`foundation.vel`/
   `inheritance.vel`/`standard-library.vel` 移进测试语料同一条原则：
   **语料不是示例**）。移动时同步更新引用它们的测试。
2. `app/` 只留**真实应用代码**，按当前典章与新导入风格重写，
   带 README 说明它教什么、模块怎么划分。
3. **域保持不变**（Release Studio），除非实施者发现它在去掉夹具后不成立 ——
   那种情况停下来上报，不要自行换域。
4. `app/` 必须有**真实的单元测试与 browser test**，
   且 browser test 要用 `velar/web-test` 的正路（盲测二轮的头号痛点是这条不可发现）。

### 其余六个应用目录

`api-dashboard`、`flow-board`、`modules`、`support-desk`、`todo`、`web-counter`
**全部退役**。其中被测试引用的（`modules`、`todo`、`api-dashboard`）
—— 测试要么改指 `tour/` 的对应文件，要么把所需夹具移进 `tests/`。
**不许为了让旧测试继续通过而把应用留在 `examples/`。**

顶层四个散 `.vel`（`core.vel`、`foundation.vel`、`inheritance.vel`、
`standard-library.vel`）按 D52 第 115 条移入 `tests/corpus/`，
门禁引用同步更新。**它们不与 `tour/` 合并** —— `tour/` 要重写，
旧语料只是保住既有覆盖，两者角色不同。

---

## 第 132 条 —— Desktop 进展示，不进豁免表

清单推导发现 `velar/desktop`（15 导出）与 `velar/desktop-test`（6 导出）
在 core+web 的骨架里无处安放，而 `velar create` 已有 `desktop` 模板、
charter §1 第 5 条把 Desktop 写成一等目标。

**裁决：加 `tour/desktop/`（3–4 章），覆盖这 21 个导出。**

理由是第 129 条自身的逻辑：那个门禁反查的是**编译器自有的封闭词汇表**，
而 desktop 的模块表就在那张表里。**豁免掉它，等于承认门禁反查的范围小于
词汇表本身 —— 而那正是第 129 条要消灭的口子。** 21 项也会是豁免表里最大的
一块，一个占了半张表的豁免不叫豁免，叫没覆盖。

不采纳的两条：把 desktop 塞进 `app/`（会推翻第 131 条第 3 点的域裁决）；
具名豁免（理由同上）。

## 第 133 条 —— 豁免表的边界：负向语料不进展示

推导给出的「无处安放」清单里，除 Desktop 外的每一项都是**负向语料** ——
只在**拒绝**里可观察的东西，编译得过的展示按定义写不出来：

| 族 | 例 |
|---|---|
| charter §19「刻意缺席」全表 | `var`、`switch`、`this`、`new`、位运算、`++`、生成器、用户装饰器…… |
| `forbiddenSourceIdentifiers`（15）+ web `forbiddenIdentifiers`（4） | `undefined`、`None`、`elif`、`effect`、`onMount`…… |
| 4×3 授予表的「无约束」行 | `boundGrants(null, …)` 恒 false，只在 `def f<T>(v: T) -> string: return f"{v}"` 的报错里可见 |
| Look 的 36 个被排除属性 + 10 个被排除媒体主语 | 同上 |
| 枚举/类的保留成员名 | `is`/`parse`/`values`/`pass`/`constructor` |

**裁决：这些统一豁免，理由记为「反向语料，归 `tests/corpus/`」。**
展示的定义是「当前所有**用法**」，而这些按定义**不是用法**。

**另一类豁免是「被执行」而非「被书写」**：`velar/host.exit`、`serve`、
`process.start`、`terminal.close`、`browser.open`、`files.download` 等能力调用
**必须写在不被调用的 `def` 里** —— 否则 `velar run` 会真的开端口、起子进程。
豁免的是执行，不是拼写。

## 排期与依赖

**`tour/` 与 `app/` 的正文必须在波 I1 落地之后写**，因为它们要用新的导入风格
（具名 `Look` 导入 + `Math.` 常驻）。在此之前可以做的：
第 129 条的门禁脚本、目录骨架、旧夹具的搬迁、退役目录的删除与测试改指。

**顺序**：I1 → 本文（骨架与门禁可提前）→ D53 内联块 / D55 泛型层一。
