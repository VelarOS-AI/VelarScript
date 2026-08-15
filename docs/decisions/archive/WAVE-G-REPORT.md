# 波 G 报告 —— 软关键字 + `@name` 约定（分支 `wave/g`，基线 `aef9e9b`）

依据：D30 第 16 条（保留字软化）、D43 第 67 条（`@name` 约定 + `$velar` 退役）、
COMPLETENESS-AUDITS.md 审计十一「软关键字碰撞网格」的三条工单。

三道门禁全绿（逐字尾部见文末）。提交序列：

| hash | 内容 |
|---|---|
| `48d3c6b` | `$velar` 前缀退役，统一 `__velar` |
| `1c17125` | `@mounted:` / `@cleanup:` 生命周期钩子 |
| `3ace31b` | Core 五词软化（`type`/`match`/`from`/`as`/`case`） |
| `d46dda7` | Web 全词软化 + `{computed}` 简写 + `from` 对称 |
| `28ded86` | 碰撞网格回归测试 + `case` 归入 JS 保留名 + 文档迁移 |
| `229cc9c` | 保留字诊断收尾 + 删除死 token 类别 |

---

## 一、最终碰撞网格（before → after）

每格两位：**Core 文件 / Web 文件**，`y` = 编译并执行通过，`n` = 被拒。
探针与审计同形：绑定、参数、`for` 绑定、具名实参标签、记录字段、成员访问、记录简写。
（具名实参位的拼写是 `f(name = value)`；审计前状态由 `def f(name: T)` 声明侧先失败带出。）

| 词 | bind C/W | param C/W | for C/W | named C/W | field C/W | member C/W | short C/W |
|---|---|---|---|---|---|---|---|
| `type` | nn → **yy** | nn → **yy** | nn → **yy** | nn → **yy** | yy → yy | yy → yy | nn → **yy** |
| `match` | nn → **yy** | nn → **yy** | nn → **yy** | nn → **yy** | yy → yy | yy → yy | nn → **yy** |
| `case` | nn → nn | nn → nn | nn → nn | nn → nn | yy → yy | yy → yy | nn → nn |
| `from` | nn → **yy** | nn → **yy** | nn → **yy** | nn → **yy** | yy → yy | yy → yy | nn → **yy** |
| `as` | nn → **yy** | nn → **yy** | nn → **yy** | nn → **yy** | yy → yy | yy → yy | nn → **yy** |
| `enum` | nn → nn | nn → nn | nn → nn | nn → nn | yy → yy | yy → yy | nn → nn |
| `state` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `action` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `resource` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `watch` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `look` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `component` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `computed` | yn → yn | yn → yn | yn → yn | yn → yn | yy → yy | yy → yy | yn → yn |
| `mounted` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `cleanup` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `keyframes` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `css` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `expose` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |
| `exposes` | yn → **yy** | yn → **yy** | yn → **yy** | yn → **yy** | yy → yy | yy → yy | yn → **yy** |

266 格中 241 格通过。**每一格 Core 与 Web 的判定完全一致 —— W-1 单行可移植性破坏关闭。**
剩下 25 格是三类有理由的拒绝，且每条诊断都点名原因：

- **`enum`（10 格）** —— JS 保留词，D30 原判维持。`'enum' is a VelarScript keyword and
  cannot be a binding name; choose another name`（参数位说 `parameter name`，表达式位说
  `name`，简写位说 `write 'enum: value'`）。
- **`case`（10 格）** —— **见第三节：D30 归类有误，JS 同样保留 `case`**。
  `'case' is reserved by JavaScript and cannot be used as a VelarScript binding`。
- **`computed`（Web 5 格）** —— 真实运行时入口（`analysis.reservedBindings`），
  `'computed' is a reserved extension binding`；简写位见第二节第 2 条。

审计原文点名的另外两句也已消除：`from` 声明/调用不对称（第 2 节第 3 条）、
`mounted` 生命周期词（第 4 节）。

---

## 二、三条工单的处置

### 1. 软化机制

**Core**：`type`/`match`/`from`/`as`/`case` 移出 `keywordKinds`，词法产出 `identifier`。
**Web**：`lexical.keywords`（硬关键字注册表）整体退役，改为
`lexical.contextualKeywords: ReadonlySet<string>` —— 语义从「保留这个拼写」变成
「这是本扩展在语句/表达式头拥有的词」。词法不再产出 `extensionKeyword`，
该 token 类别已删除（无生产者）。`bindingNameRestriction` 随之去掉
`extensionKeywords` 参数：扩展的上下文词不再限制绑定名。

消歧一律走「声明形状」，形状不成立就走标识符读法：

| 词 | 声明形状 |
|---|---|
| `type` | 词 + 标识符 + (`:` \| `=` \| `<`) |
| `match` | 词 + ≥1 token + 行尾 `:` + 缩进块 |
| `case` | 仅 match 块体内（`matchWord`）；块外仅当「词 + 模式 + 行尾 `:`」才保留「不跟随匹配块」诊断 |
| `from` / `as` | 仅 import / re-export / `case X as y` / `watch e as a, b` 既有产生式内 |
| `component` | 词 + 标识符 + (`(` \| `:` \| `<` \| 标识符（即 `exposes`）) |
| `state` / `resource` | 词 + 标识符 + (`=` \| `:`) |
| `action` | 词 + 标识符 + `(` |
| `watch` | 词 + ≥1 token + 行尾 `:` + 缩进块（同 `match`） |
| `look` / `keyframes` | 词 + `:`（块值表达式） |
| `css` | 仅 `import` 后 + (`unsafe` \| 字符串) |
| `expose` | 组件体内 + 下一 token 开启一个新值 |
| `exposes` | 组件头 prop 列表之后（位置唯一） |

### 2. `{computed}` 简写静默捕获内建

根因：记录简写是「读一个同名绑定」，而 `computed` 是保留名，永远不可能有那个绑定 ——
于是简写越过作者直接抓到了运行时入口，字段类型泄漏成 `(read: () -> unknown) -> () -> unknown`。

修法是一条覆盖整个品类的规则，而非一次一个特例：**AST 的 `ObjectProperty` 新增
`shorthand` 标记；简写名若是保留绑定（Core 保留 / 扩展保留 / JS 保留）且当前作用域无同名绑定，
定向拒绝**：

```
VEL3007 Write 'computed: value'; 'computed' is a reserved extension binding,
        so the shorthand has no binding of that name to read
VEL3007 Write 'print: value'; 'print' is a reserved Core binding, ...
VEL3007 Write 'case: value'; 'case' is a name JavaScript reserves, ...
```

这就是「与兄弟一致」的准确含义：软化后 `{state}` 解析为一个普通绑定（无则
`VEL3001 Unknown name 'state'`），`{computed}` 同样必须解析为绑定 —— 而它没有，就说出来。
`{computed: computed(() => ...)}` 与 `const computed = 1`（Core 文件）照常。

### 3. `from` 声明/调用不对称

调用侧的 `this.check("from")` 特判已删除。`from` 是普通标识符后，
`def slice(from: number, to: number)` 与 `slice(from = 1, to = 4)` 走同一条路径（回归测试执行级验证），
未知标签照常报 `Unknown named argument 'from'`。
`tests/compiler.test.ts` 的 `unavailableOfficialParameterNames`（官方签名参数名必须可在调用点书写）
随之只剩硬保留词与 forbidden 拼写 —— 该不变量正是这条不对称当初的成因。

### 4. D43 第 67 条 `@` 钩子

`@` 成为 Core token（`at`）。组件生命周期钩子改为 `@mounted:` / `@cleanup:`，
裸词 `mounted` / `cleanup` 从扩展词表移除、完全归还给作者。

- `def mounted()` 与 `@mounted:` 同组件共存（回归测试）。
- 退役拼写有定向指引且**仍按钩子解析**，块体在同一次编译里继续分析：
  `VEL5061 Use '@mounted:'; a lifecycle hook is a language-owned name, which leaves 'mounted' free for your own method`
- 未知 `@` 成员：`VEL5061 A component has no '@started' block; the lifecycle hooks are '@mounted:' and '@cleanup:'`
- Core 文件里的 `@name`：`VEL2002 '@mounted' names a language-owned member and appears only inside a declaration body, ...`
- Look 的 `@hover` / `@before` 零改动（Look 块是整块原文扫描，不经 token）。
- 重复钩子诊断改用 `@` 拼写（VEL5009/VEL5010）。

### 5. `$velar` 退役 —— **134 处**

全仓 `$velar` → `__velar`，涉及 9 个文件：
`packages/web/src/emitter.ts` 36、`packages/compiler/src/emitter.ts` 33、
`tests/compiler.test.ts` 45、`tests/hardening-web-surface.test.ts` 4、
`packages/cli/src/project-semantic.ts` 1、`packages/compiler/src/source-names.ts` 1、
`packages/compiler/src/analyzer.ts` 1、`tests/readonly-class.test.ts` 1、
`docs/language-charter.md` 3。

**一处必须改名而非合并**：`$velarScope`（组件作用域**变量**）与 `__velarScope`（创建作用域的
**运行时函数**）合并后会在组件体内自我遮蔽（`const __velarScope = __velarScope(...)` → TDZ）。
该变量改名为 `__velarComponentScope`。其余 20 个名字直接换前缀，已逐个核对无碰撞。
`bindingNameRestriction` 与 charter §3/§18 从两个前缀收敛为一个；`$velarRoot` 之类现在是合法源码拼写。

---

## 三、规格偏差：`case` 必须与 `enum` 同列（**最重要的一条**）

D30 第 16 条把 `case` 与 `match` 一并归入「JS 不保留、可软化」，并给出
`for case in cases:` 作为目标形态。**这条归类是错的**：`case` 是 ECMAScript 保留字，
`const case = "x"` 发射出的 JavaScript 直接语法错误 —— 这一点由本波的执行级网格测出：

```
SyntaxError: Unexpected token 'case'
```

D30 自己为 `enum` 写下的理由（「产物必须是合法 JS」）逐字适用于 `case`。因此：

- `case` **仍作为 Vel 词软化**：记录字段、成员名、match 分支关键字全部照常（JS 也允许
  保留字作属性名），`case` 不再是 token 类别。
- `case` 进入 `javaScriptReservedBindings`，与 `default`/`typeof`/`function` 同列：
  绑定 / 参数 / `for` 绑定 / 简写位被拒，诊断说真实原因
  `'case' is reserved by JavaScript and cannot be used as a VelarScript binding`。
- 附带修正：保留名被拒后**仍然声明该绑定**，一个坏名字只报一条，不再每次使用各报一条
  `Unknown name`（`def probe(case: number) -> number: return case` 从 3 条降到 1 条）。

**任务简报把 `enum` 也列进「必须可作绑定名」的清单**（scope 第 1 条），这与 D30 第 16 条
「保持硬保留：`enum`（JS 保留词，产物约束）」以及其回归条款「`enum` 仍被拒且新诊断点名保留字」
直接冲突。本波按 D30 执行 —— `enum` 维持拒绝、诊断点名。若这是简报有意改判，需要用户裁决，
因为它要求发射器重命名源绑定，与「产物即可读逃生通道」的承诺相抵。

---

## 四、消歧判断（简报要求逐条报告）

1. **`match` 的块首 token 不检查。** D30 写的是「缩进块首 token 为 `case`」。实施时放宽为
   「行尾 `:` + 存在缩进块」，理由：零误报论证不变（**没有任何合法表达式语句以 `:` 结尾**），
   而收紧到 `case` 会让两类既有教学掉回裸标识符读法 —— D28 第 4 条的 `else:` 回收
   （`Use 'case _:' for the fallback case`）与 `VEL2015 A match block accepts only case branches`。
   放宽方向恰好只影响诊断质量，不影响任何合法程序。`watch` 用同一条规则。

2. **`match:`（无主语）不算 match 语句。** 要求 `match` 与行尾 `:` 之间至少一个 token
   （`offset < 3` 拒绝）。`match:` 落回标识符读法。

3. **`expose (handle)` 读作调用。** `expose` 是唯一「词 + 裸表达式」的语句头，无法靠
   「名字 + 形状 token」判定。采用「下一 token 开启一个新值」白名单
   （标识符、字面量、`{`、`super`、扩展 token）。因此 `expose (self.handle)` 与
   `expose [a]` 走标识符读法（调用 / 下标）—— 按 D30「歧义处优先标识符」的原则，
   并且 `expose x` / `expose {..}` 这两种真实写法不受影响。

4. **`import css ...` 只在 `unsafe` 或字符串跟随时是 CSS 边界。** 否则
   `import css from "./mod.vel"` 这个默认导入会被夺走。`import css "./a.css"`
   仍走 CSS 分支，以保住既有的 `Native CSS is an unsafe boundary` 教学。

5. **`component Name exposes T:` 的形状表含 `identifier`。** `exposes` 软化后是标识符，
   所以 component 声明形状必须接受「名字后跟一个标识符」。这使
   `component Foo bar` 这类写坏的头也被认作 component 声明（随后在 `expect("colon")` 处报错）——
   比落回「未知声明关键字」更有教学价值。

6. **`look` / `class` 作组件 prop 名**：`look` 软化后本可当普通 prop 名，会与「每个组件
   都已接受 `look`」的通用 prop 静默相撞。保留原诊断，判定改为按值匹配，
   同时覆盖 `class`（硬关键字 token）与 `look`（现在是标识符）。

7. **格式化器**：`match` / `case` 从 `parenthesizedKeywordWords` 移出（否则 `match(2)`
   被格式化成 `match (2)`），改为只在**行首**（`index === 1`）加空格。
   `match (n):` 语句、`match(2)` 调用、`@mounted:` 全部往返稳定（回归测试）。

8. **`arrowBraceHoldsStatements`**：`statementStarterKinds` 里的 `match` 换成按词判定
   （`statementStarterWords`），否则 `=>` 后花括号的记录/语句判定会因 `match` 变成标识符而改判。

---

## 五、顺带修好的相邻缺口（同族、成本极低）

- **硬保留词在表达式位**也点名：`print(enum)` 从 `Expected an expression` 变成
  `'enum' is a VelarScript keyword and cannot be a name; choose another name`。
- **`look:` 在 Core 文件**得到与 `keyframes:` 同款的定向指引
  （`belongs to @velarscript/web; add "@velarscript/web" to velar.json extensions, ...`）——
  此前 `keyframes` 有、`look` 没有，是同一位置的不一致。
- **记录简写的关键字教学**改为点名：`{enum}` → `'enum' is a VelarScript keyword, so no
  binding spells it; write 'enum: value'`；引号字段单独措辞。
- **保留参数名不再级联**：`def probe(enum: number, count: number)` 从 12 条降到 1 条
  （报错后消费该 token）。

**未修、记档**：`state n = 1` 出现在 Core 文件时仍是 `VEL2032` 语句边界消息，而
`component P:` 有 `VEL2026 Unknown declaration keyword`。这是软化前就存在的差异
（Core 从不认识 Web 声明词），本波未扩大 Core 对 Web 词表的硬编码知识。
若要修，路径是把 `IDENT IDENT` 指引扩展到 `assign` 形状并点名扩展包。

---

## 六、迁移清单（穷尽）

**编译器 / 运行时**
- `packages/compiler/src/token.ts` —— 移除 `type`/`match`/`case`/`from`/`as` 与
  `extensionKeyword` 三类 token；新增 `at`；`keywordKinds` 加注释说明硬/软边界。
- `packages/compiler/src/lexer.ts` —— `@` 词法；扩展词不再特殊化；`chainContinuationEndKinds` 去 `extensionKeyword`。
- `packages/compiler/src/parser.ts` —— `checkWord`/`matchWord`/`expectWord`/`expectBindingName`/
  `reservedWordMessage`；`typeDeclarationAhead`/`matchStatementAhead`/`orphanCaseClauseAhead`；
  `contextualKeywords` 集合；`containsExtensionBlockStart` 改按词；`parsePrimary` 的
  identifier 分支接手扩展表达式；`@` 的 Core 指引；记录简写标记与诊断措辞；命名实参去 `from` 特判。
- `packages/compiler/src/extension.ts` —— `lexical.keywords` → `lexical.contextualKeywords`。
- `packages/compiler/src/source-names.ts` —— `bindingNameRestriction` 去扩展词参数；
  `case` 入 JS 保留名；`switch` 恢复 token 改 identifier；`$velar` 前缀退役。
- `packages/compiler/src/ast.ts` —— `ObjectProperty.shorthand`。
- `packages/compiler/src/analyzer.ts` —— `checkShorthandReservedName`；保留名被拒后仍声明绑定；前缀措辞。
- `packages/compiler/src/index.ts` —— 扩展词不再参与绑定名限制。
- `packages/compiler/src/formatter.ts` —— `match`/`case` 只在行首吃关键字空格。
- `packages/compiler/src/emitter.ts`、`packages/web/src/emitter.ts` —— `$velar` → `__velar`（含 `__velarComponentScope`）。
- `packages/web/src/lexer.ts` —— `WEB_CONTEXTUAL_KEYWORDS`；`visualBlockKeyword` 改按标识符。
- `packages/web/src/parser.ts` —— 全部声明头形状判定；`@mounted`/`@cleanup`；退役拼写与未知 `@` 的诊断；通用 prop 判定。
- `packages/web/src/compiler.ts` —— 词表改 `contextualKeywords`（去 `mounted`/`cleanup`）；
  编辑器文档与补全改 `@mounted`/`@cleanup`；`forbiddenIdentifiers` 指引改 `@` 拼写。
- `packages/web/src/analyzer.ts` —— 重复钩子诊断改 `@` 拼写。
- `packages/cli/src/project-semantic.ts` —— 重命名限制去扩展词参数；前缀措辞。

**脚本 / 示例 / 测试**
- `scripts/check-velar-format.mjs` —— Web 归属探测改用 `@mounted`/`@cleanup`。
- `examples/web-counter/main.vel`、`examples/production-web/src/components/web-capabilities.vel`、
  `examples/production-web/src/pages/broken.vel`、`examples/production-web/src/pages/construction-failure.vel`
  —— 共 7 处钩子改 `@`。
- `tests/compiler.test.ts`（钩子 27 处 + `$velar` 45 处 + 官方参数名不变量）、
  `tests/desktop.test.ts`、`tests/hardening-web-surface.test.ts`（WEB-N4 关键字 prop 改 `enum` 并新增软化词正例）、
  `tests/readonly-class.test.ts`。
- 新增 `tests/hardening-wave-g.test.ts`（19 个测试）。

**文档**（fence 全部经 `check:docs` 全量分析）
- `docs/language-charter.md` —— §3 新增「上下文关键字」与「`@name`」两条 + 一段门禁编译示例；
  §13 词表改「十个上下文关键字 + 两个生命周期钩子」并列 `@mounted`/`@cleanup`；
  §16 全节改 `@` 拼写；§19 保留词理由改写（`enum` 因 JS 保留、五词软化）；§3/§18 前缀收敛。
- `docs/web-api.md`（16 处）、`docs/contributing/compiler-architecture.md`（2 处）、`docs/standard-library.md`（2 处）。
- `docs/ai-skill.md` + `packages/cli/skill/ai-skill.md`（逐字节相同，测试强制）——
  陷阱表新增两行（「不要为了避开关键字改名」「`mounted:` → `@mounted:`」），
  组件章新增生命周期 fence。

---

## 七、门禁逐字尾部

### `npm run check`（EXIT=0）

```
Checked 53 formatted VelarScript source files

> velarscript-workspace@0.10.0 check:docs
> node scripts/check-documentation-examples.mjs

Checked 174 VelarScript documentation examples (75 complete, 99 fragments), all under full project analysis

> velarscript-workspace@0.10.0 check:boundaries
> node scripts/check-runtime-boundary.mjs

Checked 76 runtime boundary operations and the shared registry, strict JSON, Web DOM, host-event, browser-platform, storage-host, and Desktop-host ABIs
```

### `npm test`（EXIT=0）

```
ℹ tests 975
ℹ suites 0
ℹ pass 975
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 158664.495542
Checked 15 modules from examples/production-web
Checked 9 modules from examples/flow-board
Checked 8 modules from examples/support-desk
Checked 3 modules from examples/api-dashboard
✓ src/store.test.vel :: test_theme_store

1 passed, 0 failed
✓ src/domain.test.vel :: test_task_workflow_uses_finite_states
✓ src/domain.test.vel :: test_board_mutations_are_direct_and_typed
✓ src/domain.test.vel :: test_task_draft_uses_named_record_fields

3 passed, 0 failed
✓ src/domain.test.vel :: test_ticket_selection_and_pagination
✓ src/domain.test.vel :: test_ticket_resolution_mutates_the_owned_ticket
✓ src/domain.test.vel :: test_ticket_draft_crosses_the_domain_boundary

3 passed, 0 failed
✓ src/chart.test.vel :: test_chart_coordinates_are_bounded
✓ src/chart.test.vel :: test_chart_scale_owns_derived_internal_state
✓ src/chart.test.vel :: test_chart_scale_constructor_rejects_invalid_values

3 passed, 0 failed
```

### `npm run test:browser`（EXIT=0）

```
✓ webkit :: src/app.browser.test.vel :: test_dialog_cancel_restores_trigger_focus
✓ webkit :: src/app.browser.test.vel :: test_support_desk_http_filter_and_pagination
✓ webkit :: src/app.browser.test.vel :: test_typed_form_route_context_and_persistence
✓ webkit :: src/app.browser.test.vel :: test_direct_detail_route_recovers_data
✓ webkit :: src/app.browser.test.vel :: test_query_page_uses_strict_optional_number_parsing

15 passed, 0 failed
✓ chromium :: src/app.browser.test.vel :: test_dashboard_loads_typed_data_and_real_svg
✓ chromium :: src/app.browser.test.vel :: test_dashboard_resource_reloads_without_replacing_the_chart_contract
✓ firefox :: src/app.browser.test.vel :: test_dashboard_loads_typed_data_and_real_svg
✓ firefox :: src/app.browser.test.vel :: test_dashboard_resource_reloads_without_replacing_the_chart_contract
✓ webkit :: src/app.browser.test.vel :: test_dashboard_loads_typed_data_and_real_svg
✓ webkit :: src/app.browser.test.vel :: test_dashboard_resource_reloads_without_replacing_the_chart_contract

6 passed, 0 failed
Installed VelarScript browser-project acceptance passed
```

---

## 八、待用户裁决

**G-1（`case`）**：本波按「JS 保留 → 不可作绑定名」执行，与 `enum` 同列。若坚持 D30
原文（`case` 可作绑定名、`for case in cases:` 合法），唯一实现路径是发射器重命名源绑定，
这会推翻 charter §19「产物必须是合法 JS，故 JS 保留词不可作绑定名」与「产物可读」的承诺。
实施者建议维持本波判定，并在 D30 第 16 条上标注这条更正。

**G-2（简报 scope 第 1 条含 `enum`）**：同一问题的另一面 —— 见第三节末。本波按 D30 维持 `enum` 硬保留。
