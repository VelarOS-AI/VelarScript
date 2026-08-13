# 波 L —— CLI 与工具链（D38 §48、D39 §54、MIG-3、MOD-U10）

分支 `wave/l`（基线 `aef9e9b`）。四项全部落地，三道门禁全绿。

---

## 一、`velar fix` 与机械修复家族（D38 第 48 条）

### 机制：诊断自带重写，实现处登记

`Diagnostic` 新增可选 `fix`：

```ts
export interface DiagnosticEdit { readonly span: Span; readonly text: string }
export interface DiagnosticFix { readonly edits: readonly DiagnosticEdit[]; readonly title: string }
```

`diagnostic()` / `recoveredDiagnostic()` 接受第四参数，`mechanicalFix(span, text, title)`
建单编辑重写，`mechanicalEdits(edits, title)` 建"一次拼写改动、多处编辑"的重写
（`[T]` → `<T>` 要动两个方括号；`for await` → `async for` 要挪一个关键字）。

三个消费者，一个来源：

| 消费者 | 行为 |
|---|---|
| `velar fix`（新命令） | 应用全部已登记重写 → 重新编译 → 直到某一趟零改动 |
| LSP quick fix | 直接读已登记重写（**删除了 language-server.ts 里手写的 90 行重推表**） |
| 诊断本身 | 措辞不变 |

LSP 原先按 code + 原文文本**重新推导**重写，与编译器实现是两份代码。改为读登记后，
两个界面不可能再漂移——顺手治好一个潜伏缺陷：旧表把 `!False` 的 `!` 替换成 `"not"`，
产出 `notFalse`；登记版按相邻字符补空格，产出 `not False`（`tests/compiler.test.ts`
的断言随之更新为 `"not "`，注释写明原因）。

### 家族成员（逐条给出行为保持论证）

判定标准两条，缺一不成员：

1. **诊断已经点名唯一后继拼写**（不是两个选项，不是"某个方向"）。
2. **重写不是对意图的猜测**：源拼写在父语言里没有另一种成立的含义，改写后不可能
   "编译干净但运行时是另一回事"（MIG-1 点名的最坏诊断类）。

| # | 诊断 | 重写 | 行为保持论证 |
|---|---|---|---|
| 1 | VEL1005 行尾 `;` | 删 `;` 及其前置空白 | 词法恢复本就跳过它；行尾分号删掉后仍是同一条语句。**只登记行尾**（后面只剩 `;`、空白或注释）：语句之间的 `;` 要换行，那是版式变更不是拼写变更，留作诊断 |
| 2 | VEL1005 `===` / `!==` | `==` / `!=` | JS 严格相等 = Vel 相等，逐字对译 |
| 3 | VEL1005 `&&` / `\|\|` / `!` | `and` / `or` / `not` | 父语言逻辑运算符的唯一 Vel 拼写。词换符号需要两侧留白，重写自带（`a&&b` → `a and b`，`a && b` 不变） |
| 4 | VEL1002 缩进 Tab | 四空格 | 缩进宽度不变（词法本就按 4 计宽） |
| 5 | VEL1007 `1.` / `.5` | `1.0` / `0.5` | 同一个数值，消息里已逐字写出目标 |
| 6 | VEL1005 `fr"..."` | `rf"..."` | 同一前缀语义，仅拼写顺序 |
| 7 | VEL1005 裸十六进制色 `#3366ff` | `"#3366ff"` | 词法恢复就是该字符串 token，意图无歧义 |
| 8 | VEL1005 `#name` | 去 `#` | 恢复即该标识符；Vel 自有 class 私有制度 |
| 9 | VEL1005 行首 `#` 注释 | `//` | 恢复即注释，整行内容不变 |
| 10 | VEL1005 退役标识符 `undefined`/`none`/`None`/`True`/`False`/`elif`/`int`/`float`/`switch`/`this`/`new` | `null`/`null`/`null`/`true`/`false`/`else if`/`number`/`number`/`match`/`self`/删除 | 恢复 token 表本就唯一；`new` 删除时连吞后随空格 |
| 11 | VEL2012 类型名 `Array`/`array`/`list`/`dict`/`set`/`str`/`String`/`Number`/`boolean`/`Boolean`/`void` | 表里 `replacement` | 表本就带 `replacement` + `title`（LSP 早已按它出 quick fix） |
| 12 | VEL2012 `Name[]` | `List<Name>` | 恢复即 `List<Name>` 语法树 |
| 13 | VEL2012 `Name[T]` | `Name<T>` | 两处括号替换，中间类型文本原样保留。**名字为空的裸 `[...]` 不登记**（那是别的错误，见"实现中发现的缺陷"） |
| 14 | VEL2012 `null?` | `null` | 恢复即 `null`，`?` 冗余 |
| 15 | VEL2017 `assert c, m` | `assert c else m` | 逗号到下一 token 起点整段替换为 ` else `，吸收原有空格；末尾无消息时不登记 |
| 16 | VEL2017 `for await` | `async for` | 两处编辑：`for` 前插 `async `，删 `await` 及其后空格 |
| 17 | VEL2026 `fn`/`func`/`function`/`record`/`struct`/`interface`/`schema` | `def` / `type` | 表里 `keyword` 唯一，且只在恢复形状成立时登记 |
| 18 | VEL2031 `instanceof` | `is` | 唯一后继，消息点名 |
| 19 | VEL2031 `++x` / `--x` | `x += 1` / `x -= 1` | 消息本就逐字写出目标；只在目标是标识符时登记。若原本用作表达式，改写后落到 VEL2028（赋值是语句）——报错而非静默 |
| 20 | VEL2031 调用点显式泛型 `f<T>(...)` | 删 `<T>` | 类型实参本就在每个调用点被推断，删除不改变含义 |
| 21 | VEL2033 `is null` / `is not null` | `== null` / `!= null` | 恢复即该比较表达式 |
| 22 | VEL2035 `match` 的 `else:` | `case _:` | 恢复即通配 case |
| 23 | VEL2024 命名实参 `f(name: v)` | `f(name = v)` | 冒号替换为 `=`，唯一拼写 |
| 24 | VEL4001 集合退役成员 `length`/`at`/`includes`/`contains`/`add`/`addAll`/`push`/`deleteAt`/`indexOf`/`any`/`all`（List）、`length`/`addAll`/`append`/`push`/`includes`/`contains`/`delete`（Set）、`length`/`setAll`/`put`/`includes`/`includesKey`/`contains`/`containsKey`/`delete`（Map） | 表里 `replacement`（仅成员名段） | 表本就带 `replacement` + `title`；类型不合的用法（如 `get` 返回 `T?`）由类型系统当场报错，不会静默通过 |

### 明确不入家族（逐条给理由，记档防复议）

| 拼写 | 不入的理由 |
|---|---|
| `:=` | 消息点名**两个**拼写（`const x = ...` 或 `x = ...`），选哪个是作者的决定 |
| `var` | 同上：`let` 或 `const`，是否重新赋值只有作者知道 |
| `&` / `^`（以及表达式位 `\|`） | 父语言里它们是**位运算**。Vel 没有位运算，所以恢复成 `and`/`**`/`or` 是对意图的猜测；`2 ^ 3` 改成 `2 ** 3` 会编译干净、算出另一个数——正是 MIG-1 点名的最坏类 |
| `"""..."""` → 版式字符串 | 目标形态依赖缩进边距重建，不是"一个已点名的替换文本" |
| `x if c else y` → `c ? x : y` | 需要重排三个子表达式并重新打印，是重写不是改拼写 |
| `not x in y` → `x not in y` | 同上，需要重排操作数 |
| `typeof` / `delete` / `??` 与布尔混用 / 类型测试加括号 | 诊断本就不点名唯一替换（`??` 混用的**全部要点**就是两种分组不同） |
| 字符串成员表（`stringMemberGuidance`） | 该表混着两类：一类是纯改名（`toUpperCase` → `upper`），一类的后继是 `velar/text` **函数**（要加导入、改调用形状）；而且 `substr(start, length)` → `slice(start, end)` 第二参数含义就变了、`length` 与 `size` 计的单位不同（UTF-16 码元 vs 码点）。逐条裁决属于设计动作，不是机械推导 —— **建议下一波单独裁决**，本波不猜 |

### 命令行为

```
velar fix [entry.vel | project-directory]
```

- 编译 → 应用 → 重编译，直到某一趟零改动（上限 8 趟纯属终止保险）。一趟内互相
  重叠的重写只应用一个，其余留给下一趟——所以"跑第二遍零改动"是构造性保证，
  不是巧合。
- 逐条报告改了什么：`src/main.vel:6:22 fixed VEL1005: Use VelarScript strict equality '=='`
- 收尾一行按裁决措辞：`applied 8 mechanical fixes in 1 file; 0 diagnostics remain`
- 剩余诊断照常打到 stderr（`velar check` 的同一形态），退出码：还有诊断 → 1，否则 0。
  这就是 AI 闭环的黄金形态：编译 → fix → 只剩真问题。
- README 命令表、`velar help fix`、AI 简报工作循环（第 3 步）都补了。

---

## 二、格式化器 JSX 政策（D39 第 54 条）

### 提出的政策

1. **打印宽度 120 列。** 这是本仓的实际手写宽度：200–400 列的markup 会断，
   而一个带属性的普通元素仍留在一行。
2. **格式化器只拥有"同一物理行内开合"的元素**：放得下就写成一行；放不下就取块形态
   ——开标签、每个子节点一行缩进一级、闭标签回到元素自身缩进。
3. **属性同规则下沉一级**：开标签本身放得下就跟着开标签；放不下则一属性一行，
   `>` 或 `/>` 单独落在元素缩进上。
4. **两样东西永不重排，因为在 markup 里它们是内容不是版式**：
   - 子节点之间的**书写空格**会渲染，而换行加缩进不会。所以只有当没有任何文本子节点
     带前后空格时元素才断行，文本本身永不重新折行、永不重新加空格。
   - 作者已经跨行摊开的元素保持其行结构，和语言里其它每一种构造一样：格式化器
     规范的是拼写，不是作者的换行。`{...}` 洞是代码，代码保持自己的行。
5. 形态是"元素 + 宽度"的纯函数 → 幂等是构造性的。

已写入 charter §14（含一段范例 fence，随 `check:docs` 编译）。

### 实现路径（与既有架构的关系，以及主动上报的取舍）

既有格式化器对 markup 是**文本切片**：`formatInline` 遇到嵌入起点就把该行剩余部分
当不透明文本，`nextEmbeddedDepth` 只负责后续行的缩进跟踪。要给出"唯一形态"必须
知道元素结构，所以本波在 formatter 内部加了一个**局部 markup 扫描器 + 打印器**
（`scanMarkupElement` / `renderMarkupElement`，约 250 行，全在 `formatter.ts` 内）：

- 它**不碰编译器 AST**，也不依赖 Web 扩展的 parser：只用扩展已经声明的
  `angleBracketEmbedding.voidElements`，与 `nextEmbeddedDepth` 已有的标签扫描同源。
- 它**只在一行内**求平衡：元素在本行没闭合、遇到 HTML 注释、遇到未闭合字符串或
  表达式——任何一处不确定，扫描返回 null，该文本原样留下（回到既有行为）。
- 于是"跨行 markup 的整体重排"（把作者的多行元素合并回一行，或跨行重新分配子节点）
  **没有做**。那需要把格式化器的逐行循环改成能吞掉后续行的构造，并对 `{...}` 洞里的
  多行代码做表达式级打印——那才是真正的 AST 打印级改造。**这是本波主动上报的边界**：
  按简报要求，需要 AST 打印的部分先报告范围，不擅自开工。
  - 代价：一个被作者摊开的短元素不会被合并回一行，所以严格意义上的"唯一形态"
    只在"单行内开合的元素"这个域上成立。
  - 收益：本波零风险地消掉了 §54 点名的缺陷形态（403 列单行 JSX），且与"格式化器
    不重排代码行结构"的既有惯例完全一致（普通 Vel 代码同样保留作者的换行）。

### 同波重排

`examples/**`（4 个应用 + todo）与两个项目模板全部重排；模板此前**不在任何门禁里**
——`check:format` 只走磁盘上的 `.vel`，模板源码嵌在 TypeScript 字符串里，是一次完整
browser acceptance 才撞出来的。已把模板并入 `scripts/check-velar-format.mjs`
（现在报 `53 formatted VelarScript source files and 25 project template sources`）。

重排的**行为等价性**由三道门禁里最硬的一道背书：4 个示例应用在 chromium/firefox/webkit
三引擎下的 browser 测试全绿（断言里就有 `data-result-count`、文本内容、焦点等渲染断言）。

前后对照（`examples/production-web/src/app.vel`，原 403 列）：

```text
// 之前（一行 403 列）
    return <div class="shell" look={shellLook}><nav look={navLook} data-release-primary aria-label="Application pages"><NavLink to="/" exact={true} look={navLinkLook}>Home</NavLink>…</nav><Router routes={routes} fallback={RouteNotFound} /></div>

// 之后
    return <div class="shell" look={shellLook}>
        <nav look={navLook} data-release-primary aria-label="Application pages">
            <NavLink to="/" exact={true} look={navLinkLook}>Home</NavLink>
            <NavLink to="/about" exact={true} look={navLinkLook}>About</NavLink>
            <NavLink to="/construction-failure" exact={true} look={navLinkLook}>Failure probe</NavLink>
        </nav>
        <Router routes={routes} fallback={RouteNotFound} />
    </div>
```

安全规则的实证（`ticket-card.vel`，同一次重排里**没有**被断开）：

```text
        <div class="footer" look={rowLook}>
            <p look={bodyLook}>{ticket.requester} · <time>{format(ticket.updatedAt, "en-US", "UTC")}</time></p>
            <Link look={linkLook} to={f"/tickets/{ticket.id}"}>View ticket</Link>
        </div>
```

外层 `<div>` 断了（子节点全是元素）；内层 `<p>` 没断（` · ` 两侧的书写空格会渲染，
断行会把它们变没）。

---

## 三、MIG-3 打包体积预算失败带分项

**之前**（`packages/desktop/src/build.ts`，只有总量）：

```
Desktop bundle is 15500000 bytes, exceeding the 12582912-byte size budget
```

**之后**（同一组尺寸、同一个预算）：

```
Desktop bundle is 14.78 MiB (15500000 bytes), exceeding the 12.00 MiB (12582912-byte) size budget by 2.78 MiB (2917088 bytes)
Composition:
      7400000 bytes   47.7%  build engine (velar-build-engine) [mandatory first-party tooling]
      3500000 bytes   22.6%  language server (velar-language-server) [mandatory first-party tooling]
      2400000 bytes   15.5%  project task host (velar-project-task) [mandatory first-party tooling]
       900000 bytes    5.8%  renderer (application code and assets)
       400000 bytes    2.6%  terminal host (VelarTerminalHost) [mandatory first-party tooling]
       400000 bytes    2.6%  native host (VelarDesktopHost)
       300000 bytes    1.9%  capability host (worker.js) [mandatory first-party tooling]
       200000 bytes    1.3%  bundle metadata (Info.plist, icon, desktop.json)
Mandatory first-party tooling: 13.35 MiB (14000000 bytes, 90.3% of the bundle) ships in every Desktop application and no project change removes it, so any budget below that floor can never pass
Largest contributor: build engine (velar-build-engine) at 7.06 MiB (47.7%)
Raise desktop.build.sizeBudgetBytes to at least 15500000 to accept this bundle, or remove bytes from the non-mandatory components above
```

裁判当初需要"上游考古"才敢改预算的三件事——**谁占的**、**哪些是不可移除的一方工具链**、
**改到多少才够**——现在一次读全。判定与消息同源（`desktopSizeBudgetFailure` 既是
判定也是措辞），`package-host.ts` 里重复的 `formatBytes` 一并合并。

---

## 四、MOD-U10 未捕获错误的呈现

**之前**（`velar run`，模块初始化抛错，逐字）：

```
/…/probe-run/src/boom.vel:2
    throw Error("module initialization failed")
          ^

Error: module initialization failed
    at explode (/…/probe-run/src/boom.vel:2:11)
    at <anonymous> (/…/probe-run/src/boom.vel:4:30)
    at ModuleJob.run (node:internal/modules/esm/module_job:437:25)
    at async node:internal/modules/esm/loader:639:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.15.0
```

**之后**（默认）：

```
velar run: uncaught error while running /…/probe-run/src/main.vel
Error: module initialization failed
    throw Error("module initialization failed")
          ^
    at explode (/…/probe-run/src/boom.vel:2:11)
    at <anonymous> (/…/probe-run/src/boom.vel:4:30)
  (2 Node.js internal frames hidden; rerun with 'velar run --stack' for the full trace)
```

**之后**（`velar run --stack`，真栈仍在）：

```
velar run: uncaught error while running /…/probe-run/src/main.vel
Error: module initialization failed
    throw Error("module initialization failed")
          ^
    at explode (/…/probe-run/src/boom.vel:2:11)
    at <anonymous> (/…/probe-run/src/boom.vel:4:30)
    at ModuleJob.run (node:internal/modules/esm/module_job:437:25)
    at async node:internal/modules/esm/loader:639:26
```

实现：`velar run` 经一个 VelarScript 自有 launcher 进入程序
（`packages/cli/src/uncaught-program-error.ts`，写进沙箱的 `.velar-run-entry.mjs`）。
四个设计点：

1. **只接管 Node 本来会判定为致命的错误**：handler 里先看
   `process.listeners("uncaughtException").length > 1`——程序自己装了 handler 就说明
   错误归程序，launcher 原样退场（有回归测试）。退出码仍是 1，与 Node 一致。
2. **不 `await` 入口**：改用 `import(entry).catch(...)`。`await` 会把 launcher 自己的帧
   塞进程序**每一个**异步栈——包括 detached task 报告那种我们不控制的输出。实测确认
   detached 报告与改动前逐字一致。
3. `.vel` 代码帧（源码行 + 插入符）自己重建，因为它对读者有用而 Node 的 fatal 打印被我们
   替掉了；读不到源码就跳过。
4. cause 链、非 Error 抛值（`throw "text"`）都有自有措辞。

---

## 五、实现中发现并顺手修掉的缺陷（都带回归）

1. **符号换词不留白**：`!same` 的 `!` → `not` 产出 `notsame`（LSP 旧 quick fix 同样
   会产出 `notFalse`）。现按相邻字符补空格。
2. **无名裸 `[...]` 被当成类型实参重写**：`counts: [number]` 的诊断会给出 `<number>`，
   把一个语法错误改成另一个。现在只在括号前有真名字时才登记重写。
3. **模板不在格式门禁内**（见上）。

---

## 六、门禁（逐字尾部）

`npm run check`

```
Checked 53 formatted VelarScript source files and 25 project template sources

> velarscript-workspace@0.10.0 check:docs
> node scripts/check-documentation-examples.mjs

Checked 173 VelarScript documentation examples (74 complete, 99 fragments), all under full project analysis

> velarscript-workspace@0.10.0 check:boundaries
> node scripts/check-runtime-boundary.mjs

Checked 76 runtime boundary operations and the shared registry, strict JSON, Web DOM, host-event, browser-platform, storage-host, and Desktop-host ABIs
```

`npm test`

```
ℹ tests 963
ℹ suites 0
ℹ pass 963
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 155902.153208
```

`npm run test:browser`

```
✓ webkit :: src/app.browser.test.vel :: test_dashboard_resource_reloads_without_replacing_the_chart_contract

6 passed, 0 failed
Installed VelarScript browser-project acceptance passed
```

## 七、回归测试

`tests/hardening-wave-l.test.ts`（7 个，全执行级）：

| 测试 | 覆盖 |
|---|---|
| `[D38 §48] velar fix applies every mechanical rewrite the diagnostics named, and only those` | 一个夹具带齐**全部家族成员**，逐条断言改后拼写；改完 `velar run` 真跑通；第二趟零改动且字节一致 |
| `[D38 §48] velar fix leaves every spelling that needs a decision to its diagnostic` | `&`、`^`、`:=` 一个字节都不动，诊断照旧 |
| `[D38 §48] velar fix reports what is left and answers to help` | 收尾措辞（单复数）、剩余诊断、退出码、`--help`、未知选项 |
| `[MIG-3] a Desktop size budget failure reports the bundle's composition, not only its total` | 逐项字节/占比/强制工具链底线/最大贡献者/可通过的预算，且消息行数固定 |
| `[MOD-U10] an uncaught program error presents as a VelarScript failure…` | 默认呈现无 `ModuleJob`/`node:internal`/版本横幅；`--stack` 有真栈；`--help` 说明 |
| `[MOD-U10] the launcher presents a later uncaught error and stands down when the program owns it` | 后续 tick 抛错、程序自装 handler 时退场、非 Error 抛值 |
| `[D39 §54] markup takes its canonical shape and formatting stays idempotent` | 断行/不断行/属性逐行/作者多行保持/插值内不断行，每条都跑二次格式化 |

另有 `tests/compiler.test.ts` 两处断言更新：`[T]` quick fix 现在是两处编辑（中间类型
文本原样保留）、`!` quick fix 现在是 `"not "`。
