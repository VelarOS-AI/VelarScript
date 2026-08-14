# 收尾波 C/D — 报告（2026-08-14）

范围：D50 第 97.2、97.3、91 条 + 文档与示例清扫 + 账本对账。
基线 `5a64a7c`（干净树）。三门禁全绿，逐字尾部见文末。

---

## 1. [D50 97.2] `toEqual` 改由 `equals` 实现

### 根因

`velar/test` 的运行时里住着第二份内容比较（`deepEqualRuntime` 中的
`__velarEqualValue` / `__velarDeepEqual`），与语言自己的 `__velarEquals`
（`packages/compiler/src/collection-lowering-runtime.ts:703`）**在三处给出不同答案**：

| 输入 | 旧 `toEqual` | `equals` |
|---|---|---|
| `NaN` 与自身 | `false`（顶层只做 `===`） | `true`（SameValueZero，D42） |
| Set of records | `false`（`Set.has` 只按身份查） | `true`（结构化单射匹配） |
| 深度 > 512 | `false`（`depth >= 512` 静默截断） | 到 1000 层才**抛出**，之前照实比较 |
| 环 / 稀疏数组 / getter 记录 | 静默 `false` | 说出理由并抛出 |

### 修复

- `packages/cli/src/standard-modules.ts`
  - 删除 `__velarDeepEqualRaw` / `__velarEqualValue` / `__velarDeepEqual`
    共 59 行，以及只服务于它们的 5 个捕获常量
    （`__velarDeepSymbolFor`、`__velarDeepMapHas`、`__velarDeepMapGet`、
    `__velarDeepSetHas`）。
  - `deepEqualRuntime` 更名 **`testDisplayRuntime`** —— 它剩下的全部内容是
    断言**报告器**的结构走查器，名字必须说实话。
  - 新增 `collectionLoweringImport`，`velar/test` 模块头部
    `import { __velarEquals } from "velar/compiler-runtime-collection-lowering-v1";`。
  - `toEqual` 改为 `if (!__velarEquals(actual, expected))`。
  - `coreModuleDependencies` 增加 `velar/test → 集合降级运行时` 边，
    未打包目标才会把它物化出来；该表的注释相应改写（左侧首次出现公开模块）。
- `scripts/check-runtime-boundary.mjs` —— 边界守卫跟着改名，并**新增一条不变式**：
  `velar/test` 必须 import Core 的 `__velarEquals` 且 `toEqual` 必须调用它。
  这条守卫的意义是：将来任何人想在这里再写一份比较，门禁会拦住。

### 迁移落地

`tests/compiler.test.ts` 有 5 处把 `velar/test` 源码内联执行；模块现在带 import，
于是新增 `linkedStandardModuleSource(name)` 助手（按 `standardModuleClosure`
逆序把依赖链接成 data URL）。其中一例
`the test matcher's data comparison compares owned structures without recursive graph failure`
本身就是给已删除实现做加固的，**改指向 `__velarEquals`**（同一批敌意输入，
最后三例由静默 `false` 变为具名拒绝），并改名为
`the language's data comparison compares owned structures without recursive graph failure`。

### 测试（`tests/hardening-closing.test.ts`）

| 测试名 | 层次 |
|---|---|
| `[D50-97.2] toEqual and equals agree that NaN equals itself` | 真 `velar test` 运行器 + `test "…":` 块 |
| `[D50-97.2] toEqual and equals agree on a Set of records` | 同上 |
| `[D50-97.2] toEqual and equals agree past 512 levels of nesting` | 运行时级（见下） |
| `[D50-97.2] toEqual refuses what equals refuses, with the same words` | 运行时级 |
| `[D50-97.2] velar/test carries no second comparison implementation` | 源码不变式 + 依赖闭包 |

**上报一处规格与现实的落差**：>512 层的分歧**在 Vel 源码里不可达**。
词法层 `Delimiter nesting cannot exceed 512 levels` 挡住字面量，递归类型别名被
`Type alias 'Deep' is recursive` 拒绝，`any` 被 D47 的 parse-first 纪律拒绝 ——
没有一条合法路径能在 Vel 里造出 600 层结构。因此这一条与「环」一条改为
**运行时级**回归（直接对链接好的 `velar/test` 与降级运行时喂同一份 JS 数据），
测试文件里写明了理由。NaN 与 Set-of-records 两条在 Vel 源码里完全可达，
按执行级（真运行器）覆盖。

---

## 2. [D50 97.3] 退役模块的命名空间导入

### 根因

`permanentNamespaceImportMessage` 只在**具名说明符**分支被调用
（`packages/cli/src/project.ts` 两处），namespace 分支直接构造对象类型后
`continue`。于是 `import * as text from "velar/text"` 合法，
`text.slug(...)` 照常工作 —— 退役等于没发生。`velar/json`、`velar/async`
（批次 K）与 `velar/look` 同洞。

### 修复

`packages/cli/src/project.ts`：`permanentNamespaceImportMessage` 的 `imported`
参数放宽为 `string | null`，`null` 表示命名空间形；namespace 分支在建绑定之前
先要这条诊断。消息：

```
Use Text directly; VelarScript's pure namespaces need no import
```

四个退役模块各得一条（`Text` / `Json` / `Promise` / `Look`）。

`export * from` 无需处理 —— 解析器早已拒绝
（`parser.ts:657`「Namespace re-export 'export * from' is not supported」）。

### 测试

| 测试名 |
|---|
| `[D50-97.3] a namespace import of a retired module earns the same migration` |
| `[D50-97.3] a namespace import of a module that still needs importing stays legal` |

第二条是非回归契约：`import * as math from "velar/math"` 必须零诊断。

### 上报：同形残留一处，未擅自扩权

`import * as collections from "velar/collections"` 之后 `collections.range(...)`
**仍然绕过**「`range` 是 prelude，无需导入」的教学（`range` 确实在
`velar/collections` 的运行时导出里，`standard-modules.ts:569`）。

未修，理由：`velar/collections` **不是退役模块**，它的命名空间导入是正当的
（另外 20 个成员都需要导入）。要堵这个洞需要的是**成员访问级**诊断
（"这个命名空间对象的 `.range` 字段"），而编译器今天没有这种机制
（`globalGuidance`/`stringMemberGuidance` 都不覆盖导入命名空间的字段）。
裁决原文只写「退役的模块，其命名空间导入」，扩到「非退役模块的单个退役成员」
是新增设计。**待裁决**；建议：给 `ModuleInterface` 加
`retiredMembers: Map<string, string>`，让分析器在命名空间字段访问处发这条教学，
`range` 是它唯一的当前用户。

---

## 3. [D50 91] 监视器的武装语义成文

纯文档，两处：

- `docs/standard-library.md` `velar/fs` 段新增一段（`watchFiles` 表格行之后）：
  **「A watcher reports only the changes that happen after it is armed.」**
  连同实测证据（macOS FSEvents 高负载下 40 丢 4，一次窗口 25 秒）、两条正路
  （先写再监视 / 写入前后各查一次状态），以及一句话立场：
  「A watcher is for changes another actor makes; it is not a delivery receipt
  for your own.」
- `docs/language-charter.md` 「Standard library membership boundary」段尾新增
  能力面一句，措辞与裁决原文一致，并说明为什么不加魔法
  （「a watcher that promised to catch a change racing its own creation would
  be promising something no filesystem delivers」）。

---

## 4. 文档清扫 —— 完整的过期陈述清单

方法：三路并行通读（charter / stdlib+web-api / 其余 14 份），每条可疑句
**先对编译器源码或探针复验再报告**。门禁只编译围栏里的代码，散文从来没人查过。

### 4.1 `docs/language-charter.md`（12 条）

| # | 行 | 过期陈述 | 为什么假 | 处置 |
|---|---|---|---|---|
| 1 | 189–191 | 「a local or imported `color` or `clamp` naturally wins」 | Look builder 已不是 Web 模块里的裸名（`webGlobals` 只有 `mount`/`tick`/`computed`/`Look`），且「imported」形已退役 | 改举 `state`/`look` 为例 |
| 2 | 197–206 | `case` 列为可作绑定的软词；「A Web module and a Core module therefore accept exactly the same bindings」 | `case` 是 JS 保留字（D50 94，探针：`VEL3007`）；Web 另有 6 个保留绑定 | `case` 移入保留段并说明原因；删除同名断言；补上 D50/波 M 新增的软词 `using`、`test`（探针确认二者可作绑定） |
| 3 | 214–217 | `@name` 家族只列 `@mounted`/`@cleanup`/`@hover` | 波 M 加了 `@dispose:` | 补入 |
| 4 | 573–590 | 优先级表自称完整，第 11 级只有 `await` | `try` 是同一层的前缀算子（`parser.ts:2452`），charter 自己在 2001 行这么说 | 第 11 级改为 `await`、`try` |
| 5 | 848 | 「`Json.stringify(value)` from `velar/json`」 | 该 import 已退役 | 删掉来源从句 |
| 6 | 1706 | 「`range(...)` from `velar/collections`」 | 导入它是编译错误；charter 3345 行自相矛盾 | 改为 prelude 名 |
| 7 | 2090 | 「a future `velar fix` removes them mechanically」 | `velar fix` 已发布（波 L），且**永远不会**做这件事 —— 它只应用诊断注册过的重写，而未用 import 没有诊断 | 改写为「`velar fix` 只应用诊断注册过的重写，所以它不动未用 import」 |
| 8 | 2265–2270 | 「Every word here … remains available as an ordinary name」（列表含三个保留全局） | `computed`/`mount`/`tick` 与三个媒体主语正是 Web 拒绝的绑定名 | 限定为「Every *contextual keyword* here …」，并点名那六个例外 |
| 9 | 2833–2836 | 「Look builders are ordinary named exports from `velar/look` … Import only the functions a module uses」 | `Look.` 是常驻命名空间，builder 的具名导入已退役 | 改写；保留「可别名、可传递」这半（探针确认仍成立） |
| 10 | 3203–3207 | 「`type`, `match`, `case`, `from`, `as` — which JavaScript does not reserve」 | JS 保留 `case` | 与 #2 同改 |
| 11 | 3345 | 「The prelude adds `print`, `str`, `equals`, and `range`」 | 漏了 `number(text)`（charter 1150 行自己称它为 prelude 函数） | 补入 |
| 12 | 3359 | 「**Named** imports of these permanent members are retired」 | 本波之后命名空间形同样退役 | 改为「Named and namespace imports」 |

另外按 D50 97.1 改写了常驻准入规则本身（原文「pure computation never appears
on an import line」与四命名空间名册自相矛盾）：**纯度是资格，普遍性是准入**，
并列出 collections/math/url/test（纯但不普遍）与 time/id/log（不纯）两组。

补两处**缺失**（不是假，是漏）：
- §19 新增「user-defined decorators or declaration annotations」条目
  （D43 第 68 条明确指派给 §19，从未落地）。
- §11 `try` 段补上 D50 96.4 确认的第二条拒绝（未 await 的 Promise）及其理由。

### 4.2 `docs/standard-library.md`（11 条）

| # | 过期陈述 | 为什么假 | 处置 |
|---|---|---|---|
| 1 | 整个 `## velar/async` 段仍按「导出表」写 | `Promise.` 是常驻命名空间，两个兄弟段（`Text.`/`Json.`）早已改标题，这段被漏 | 标题改 `## Promise.` (permanent, no import)，列头改 `Member`，补退役句 |
| 2 | 「`all`, `race` 是 JS `Promise.all`/`race` 的 List 等价」 | `Promise.all` 还接受**记录**并解析同形；混类型 List 已被拒绝并教记录形（`analyzer.ts:5980-6004`） | 拆成两行并写明记录形 |
| 3 | `sleep`/`timeout`/`retry` 描述为「millisecond duration」 | 参数是 Core `Duration`；全文 0 次出现 `Duration`/`ms`/`s` | 改为 `Duration`（`250ms`、`1s`）；`retry` 的 `delay` 参数补上 |
| 4 | 行内 `await map(urls, …)` | 裸 `map` 不在作用域 | 改 `Promise.map` |
| 5 | 「`range`… 因此保持位置参数、没有关键字面」 | `range` 有 `start`/`end`/`step`，本文件自己的门禁围栏就在用 `range(start=5, end=0, step=-2)` | 从名单删掉 `range` |
| 6 | 「the remaining pure modules — collections, math, url, **time, id, log**, test — 因为名字是程序有权占用的普通词汇」 | D50 97 裁决 time/id/log **不纯**，且 collections/math/url 留在 import 的理由是**普遍性**不是名字所有权 | 拆成三组重写（纯但不普遍 / 不纯 / 能力） |
| 7 | 「pure computation never appears on [an import line]」 | 与下一节自相矛盾（D50 97 正为此而发） | 与 charter 同步改写 |
| 8 | Web 拒绝的 Node-only 模块列表少两个 | `velar/path`、`velar/process` 同样是 Node-only（`packages/node/src/compiler.ts:915`） | 补入 |
| 9 | 「Standard API 0.5 deliberately keeps … filesystem streams/**watchers** … out of Core」 | `watchFiles`/`FileWatcher`/`FileWatchBatch` 已发布，本文件 709 行就在写它们 | 删 `watchers` |
| 10 | 排序拒绝清单漏了枚举 | D42 第 65 条把枚举移出 `Comparable`，且 `Comparable` 约束的类型参数现在**被接受** | 两侧都补 |
| 11 | 核心字符串成员句说 17 个，实为 18 | 漏 `isBlank` | 补入 |
| — | `range` 行的表头是「Export」 | 导入它是硬失败 | 行名改 `range` (prelude, no import) 并写明 |
| — | prelude 名单漏 `number(text)` | 同 charter #11 | 补入 |
| — | D50 89 第 5 项未落地：只有 `velar/fs`/`velar/serve` 有「Errors it raises」 | 其余五个能力模块只抛普通 `Error`，但文档从没说 | 「Local platform modules」段新增一段统一说明，并给出理由（「A class exists only where a caller would write different recovery for it」） |
| — | `toEqual` 的整段描述 | 本波把它变成了 `equals` | 重写（见 4.4） |

### 4.3 `docs/web-api.md`（2 条）

1. **218 / 241–242**：「The constructors are ordinary named module functions」+
   「**There are no implicit Look builder globals**」—— 后一句正是 `Look` 全局
   对象否定的东西。伤疤可见：220–235 的围栏早已被批次 K 改成 `Look.rgb(...)`，
   而 221–222 留着删掉 import 后的**两行空白**，围栏上方的散文原封不动。
   改写为常驻命名空间说明，并保留 `velar/look` 仍可为其 Type 对象导入这一事实。
2. **1418–1421**：`browser` 控制器表面清单漏了 `animation`
   （`packages/web/src/compiler.ts:317`，`examples/production-web/src/app.browser.test.vel`
   在用）。补入并写明它返回 `{name, rotating}`。

### 4.4 其余 14 份（8 条）

| 文件 | 过期陈述 | 处置 |
|---|---|---|
| `ai-skill.md` + `packages/cli/skill/ai-skill.md` | `case` 列在「别改名」的软词表里，只把 `enum` 标为例外 —— **本轮唯一的静默陷阱级错误**：简报在主动告诉模型 `const case = …` 可以写 | `case` 移出软词表，例外句改为 `enum` 与 `case` 两个，并说明二者作为记录字段/成员名/`match` 分支仍合法。两份逐字节相同（已 `diff` 验证） |
| `release-process.md` | 「six independently installable npm packages」×5 处 | 波 S 之后是**八个**（`scripts/release-toolchain.mjs:24-33`）；全部改正 |
| `release-process.md` | 「CLI pins compiler, Node, and creator」 | 实为 compiler/Node/Web/Desktop/creator/script-analysis（`release-toolchain.mjs:241-253`）；改正 |
| `continuous-integration.md` | 「`fragment` blocks must **still pass the real lexer and parser**」 | `08fc490` 之后每个围栏都在**完整项目分析**下编译；改写 |
| `continuous-integration.md` | 打包 tarball 清单少两个；工作流名写作 `VelarScript CI` | 改为八个；改为 `Velar CI`（`.github/workflows/ci.yml`） |
| `runtime-boundary.md` | `B-CORE-JSON-HOST` 行三处：「and owned structural equality」、「`velar/test` consumes one captured Map/Set/WeakSet graph ABI for `toEqual`」、「and test-matcher comparison source」 | 三处全假（JSON 运行时从不拥有 `equals`；本波之后 `toEqual` 就是 `equals`）；重写 |
| `runtime-boundary.md` | `velar/text.utf8Size` | 波 R2 自称清干净了本文件，这一处漏网；改 `Text.utf8Size` |
| `package-distribution.md` | `create-velar` 模板清单缺 `node`、`desktop` | 六个模板（`packages/create/src/arguments.ts:16`）；补入 |
| `project-lifecycle.md` | `velar run` 概要缺 `--stack` | 补入，并补一句未捕获错误的呈现（MOD-U10） |
| `workbench-integration.md` | `velar lsp` 能力清单缺 code actions / quick fixes | 补入（`language-server.ts:395`） |
| `README.md` | 命令块缺 `velar verify-deployment`；`Language in one page` 对 `using`/`@dispose`、`try` 表达式、`test "…":` 块、类型约束、四常驻命名空间只字未提；`Repository validation` 列 `check:docs` 而非伞命令 `check` | 全部补齐 |
| `best-practices.md` / `escape-hatches.md` | 元规则只说「run `velar check` and do what the diagnostic says」 | 补 `velar fix`，并带上 D50 95 的家族边界（只做可证行为保持的重写） |

### 4.5 复验为**正确**的（负面结果，同样是交付物）

charter：四常驻命名空间的成员名册（6/7/22/20）逐一对表；`Json.deepEqual` 已
全清；`def test_*` 退役表述正确；`using`/`@dispose` 全套（含组件体拒绝）与
D50 96.3 一致；`try` 表达式与裸 `try` 语句拒绝；`@mounted:`/`@cleanup:` 无裸形
残留；`$velar` 零出现；反引号字符串（D46）；封闭词汇约束（`Comparable ⊂ Text ⊂
Data`）；D42 相等与有序性全段；错误 `code` 与五个能力类；`Opacity` 已清；
以及 225 个 Look 属性 / 36 个排除项 / 9 个元素状态 / 5 个媒体主语 / 20 个
builder / 18 个字符串成员等全部计数。

stdlib + web-api：`Opacity` 已清；`def test_*` 零出现；`@mounted:`/`@cleanup:`
一致；`Json.deepEqual` 已清且 `equals` 描述与 R2 实测表一致；波 S 逐出的编辑器
域模块无残留；`Text.` 22 成员与 `Look.` 20 builder 逐一对表；错误类名册与
`error-runtime.ts:56-65` 一致；VEL3008 十个禁用全局；五个事件修饰符；Web API
`0.10` / Standard API `0.5` 版本号；八个模块导出名册（web/forms/browser/files/
realtime/app/config/path）。

其余 14 份：`$velar`、`def test_*`、`Json.deepEqual`、`Opacity`、裸
`mounted:`/`cleanup:` 在全部 14 份中零出现；简报 613 行 / 750 行上限；
`javascript-bridge.md` 的「four operations are refused on an `any`」四条逐一
复验成立。

**一条横切观察**（记档，不在本波范围）：三条最强发现（`velar/async` 标题、
Look builder 散文、web-api 221–222 的两行空白）**同一个成因** —— 模块变成常驻
命名空间时，围栏门禁改写了**代码**，却让引出这段代码的**句子**原地不动。
成本很低的后续门禁：任何 `## \`velar/<name>\`` 标题若其模块带
`permanentNamespace`，就报错。

---

## 5. 示例清扫

**结论：示例已经在用语言现有的东西，没有一处需要改。** 逐项核过：

| 检查 | 结果 |
|---|---|
| `test "名字":` 块迁移是否完成 | **完成**。8 个示例测试文件 + `packages/create` 的 3 个模板全部是块形；全仓 `.vel` 里 `def test_` 零出现 |
| 退役的具名/命名空间导入 | 零出现（`velar/text`/`json`/`async`/`look` 与 `import * as` 均无） |
| `Json.` / `Promise.` / `Text.` / `Look.` | 已在用。`examples/standard-library.vel` 四个都用；`examples/todo/main.vel` 全篇 `Look.` |
| 反引号（字符串内含引号时） | 已在用：`Json.parse(\`{"name":"Nova","role":"admin"}\`, User)`。全仓示例里**零处**转义引号 `\"`，没有可改的了 |
| `using` / `@dispose` | **未引入，且不应引入**。没有一个示例导入 `velar/fs` 或 `velar/serve` —— 全部是 Web 应用与纯计算。为演示而给 Web demo 塞一段文件系统代码，正是任务书里「不要硬塞」的那种改动。组件里的生命期资源已经在用正确的 `@cleanup:`（D50 96.3） |
| `try` 表达式 | **不适用**。示例里仅有的两处 `try:`（`examples/core.vel:59`、`examples/production-web/src/components/web-capabilities.vel:232`）都**读取了捕获到的错误的细节**，这正是 `try`/`catch` 该留下的场合 |

---

## 6. 账本对账（`docs/handoff/COMPLETENESS-AUDITS.md`）

方法：在 `5a64a7c` 的独立 `git worktree` 里单独构建，重跑所有以 ID 命名的回归套件
（219 例，0 失败：audit-core/-semantics/-class/-runtime 130；batch-k/lexical/
value-semantics/wave-l/web-surface 82（含 Chromium）；web-runtime 6；
marathon-web `[WEB-D1]` 1），无测试者逐个现编现跑探针。

**总量：约 160 条记录，约 120 条实际已关闭但账本仍写着原始处置。**

### 6.1 确实仍开放（22 条）

| id | 一句话 | 证据 |
|---|---|---|
| CLS-C2 | §10 说 `super.member`，实际只有方法与 getter | 探针 `super.n` → "has no method or getter"；裸 `super` 的消息连 getter 都没提 |
| CLS-I1 | 字段初始化器/静态方法里 `self` → `VEL3001` + 2 条级联 | 探针两个位置均未变 |
| CLS-I4 | `extends <extern class>` → "Unknown base class"（D45-78 要求定向消息 + §19 条目） | 探针未变；§19 无条目 |
| CLS-I5 | 方法上的 `readonly def` 消息建议改用 `const` | 探针措辞未变 |
| CLS-U1 | 无 setter：`set x(v)` 得三条通用级联（D45-79 要求定向消息） | 探针 VEL2007×2 + VEL2004 |
| CLS-U3 | 覆写签名严格不变（D45-76 指派 charter §10） | §10 只说「`abstract` 与 `override` 被检查」 |
| CLS-U7 | `let x?: number = 1` → "fields require an explicit type" | 探针措辞仍错 |
| CLS-U8 | 注入的 `__velarReadInstanceField` 守卫未成文 | 发射产物有守卫，charter §11/§18 只字未提 |
| CLS-U9 | 类字段可命名为 `self` | 探针编译通过并打印 7；无 charter 文本 |
| RDO-1 | `readonly` 视图 + `unknown` → `parse` 产出可变别名（D47-85 指派文档） | 探针复现（打印 `{"name":"mutated"}`，零诊断）；charter §5/§12 无该句 |
| FLW-S1 | 不可 break 的 `while` 丢掉它的否定事实 | 探针复现 |
| FLW-S2 | 无用的 getter 判空被静默接受，随后读取又教 `?.` | 探针编译干净、零诊断 |
| FLW-N2 | `v.a?.b != null` 不蕴含 `v.a != null` | 探针 2 条诊断，与记录一致 |
| FLW-N4 | 成员测试既不测存在也不收窄 | **账本证据已过期**：记录的可赋性诊断已消失，今天编译干净并返回 `true` |
| FLW-N5 | 下标 / `Map.get` 读取不是事实主语 | 探针未变；charter 那句话早于该审计 |
| FLW-N6 | 事实过不了 `break` 边 | 探针复现 |
| FLW-N7 | `flag == true` 不收窄 `bool?` | 探针 `Cannot assign bool? to bool` |
| FLW-N8 | 重查成本模型与 const 缓解未成文 | 发射产物每次读取一个 `__velarNarrow(...)`；charter 无成本文本 |
| LOK-I5 | Core 文件里的单位拼写走两条不同轨道 | Core 探针：`16px` → `VEL1007 Unknown numeric unit 'px'`（无 Web 重定向）；`50%` → `VEL2002` 续行消息 |
| MOD-I2 | 副作用导入没有被祝福的拼写 | `import "./fx.vel"` → "Expected a default import name"；`import {} from` 仍编译干净 |
| MOD-U3 | `import type`（D38-49）未实现 | 探针「Expected 'from' after imports」；批次 E/F 发布时没带上 |
| BRG-D2 | D38-47：extern 成员的无类型参数被静默丢弃 | 探针在声明处**零诊断**，只在使用处 `VEL3001` |
| BRG-U1 | extern JS 变异未发布却被追认（D47-83 指派文档） | 三个指派产物一个都不存在（bridge 文档段、charter §18 一行、简报一行） |
| MOD-U7 | 普通 import 一个 JS-only 包不教 `import js`（半条） | CLI 探针 `VEL6002`，无桥接教学 |
| TXT-U3 | NFC/NFD 陷阱：无 `Text.normalize`，charter 无一句 | `Text.normalize` → "Object has no field 'normalize'" |
| — | 并发门禁 fd 串扰 | 运维工单，无修复提交 |
| — | D36-37 可选链尾部短路 | 账本自己记的「未落地」准确；探针确认 |

### 6.2 部分关闭（4 条）

| id | 已关闭的部分 | 仍缺的部分 |
|---|---|---|
| CLS-U2 | charter §10:1830 写了规则 | 「一处直接 `self.f =`」的语法边界仍未成文，诊断也不说 |
| CLS-U4 | charter §10:1831 写了派生类顺序 | 方法绑定那一步在 D44-74 之后已无意义 |
| BRG-U6 | 两条教学已落地 | extern `async def` 仍未进 `javascript-bridge.md` |
| WEB-U9 | 探针编译干净（即「祝福」已生效） | charter/web-api 没有对应句子 |
| WEB-U10 | 形式与生命期已成文（web-api.md:473） | 自失效消息在 `mode === "watch"` 时仍说 "render"（`packages/web/src/emitter.ts:1357`） |

### 6.3 被后续裁决作废（1 条）

**FLW-D3**（比较链的事实不传给后继链接）：D30 第 20 条裁定 `==`/`!=` 永不成链，
探针 `null != x < 100` → `VEL2031 Equality comparisons do not chain`。
该形状不可拼写，findings 随之消失。

### 6.4 已关闭但账本仍记为开放（约 120 条）

CLS-D1..D9、CLS-D6/C1/C3/I3/U5/U6；FLW-U1/D2/N1/N3；ENM 全族（D1–D2、I1–I9、
C1–C2、U1–U6）；ASY-D1/D2、U1–U5；COL-D1/D2、I1–I5、U1–U10；TXT-D1、U1/U2/U4–U9、
I1–I3；MOD-D1–D3、I1/I3/I4/I5、U1/U2/U4/U5/U6/U8/U9/U10；BRG-D1、N1–N4、
U2/U3/U4/U5/U7/U8/U9/U10；WEB-D1–D3、N1–N5、C1、U1–U8、U12–U15;
LOK-D1–D5、U1–U8、I1–I4/I6；GRM-D1–D3、A1–A5、T1–T4/T6 及三批诊断缺口；
BLD-D1/U1；MIG-1–MIG-4。每一条都有一个以 ID 命名的回归测试或一处 charter/文档
行号作证（完整对照表见本波的审计输出，此处按族汇总以免复述 120 行）。

### 6.5 账本自身没记、但显然该记的（6 条）

1. **波 N-3 只落了文档，静默丢掉了指派给它的每一条诊断/消息工单。**
   D44 的批次计划把 CLS-I1/I5 的消息交给 N-3，D45 把第 76/78/79 条交给它；
   提交 `5e70b4b` 只动了 `docs/*.md` 与简报。结果 CLS-U1、CLS-I4、CLS-I1、
   CLS-I5、CLS-U7 全未触碰，CLS-U3/C2/U8/U9/RDO-1 从未拿到自己的句子。
   账本没有任何「N-3 部分完成」的记录 —— **这是最大的一簇过期开放项
   （11 条，其中 3 条是已批准的用户裁决）。**
2. **批次 E/F 收工时没带 D38-47 与 D38-49。** BRG-D2 与 MOD-U3 记的是
   「归批次 F 不变」；F 已发布（`f27f775`），两条都没做。BRG-D2 今天仍是
   产品承诺的逃生通道上的**静默丢弃**缺陷。
3. **MOD-U7 掉在两本账之间。** 它被移交桥审计，而桥审计只为 `import js` 方向
   开了 BRG-U2；「普通 import 一个 JS-only 包」这半没有任何 owner。
4. **FLW-N4 的记录证据已过期到改变了 findings 本身**（见 6.1）。
   D42/ENM-I3 的交集工作移走了那条诊断，而没有人决定「收窄还是静默」——
   现在它是纯粹的「静默不收窄」，比写下来的那条更安静。
5. **账本没有任何人维护的状态列。** 约 120/160 条已关闭，每行却仍显示原始处置，
   整份文档读起来像整个表面都还开着。建议给每行盖章
   （CLOSED/OPEN/SUPERSEDED + 测试名）—— 回归测试已经带着 ID，映射是机械的。
6. **D50 97.2 与 97.3 在这本账里根本没有行**，尽管它们与已有行的 COL-I3/D47-81
   是同一缺陷类。若这本账是审计发现的记录，两条都该进。

---

## 门禁（逐字尾部）

### `npm run check`

```
> velarscript-workspace@0.10.0 check:format
> node scripts/check-velar-format.mjs

Checked 53 formatted VelarScript source files and 25 project template sources

> velarscript-workspace@0.10.0 check:docs
> node scripts/check-documentation-examples.mjs

Checked 184 VelarScript documentation examples (77 complete, 107 fragments), all under full project analysis

> velarscript-workspace@0.10.0 check:boundaries
> node scripts/check-runtime-boundary.mjs

Checked 77 runtime boundary operations and the shared registry, strict JSON, Web DOM, host-event, browser-platform, storage-host, and Desktop-host ABIs
```

### `npm test`

```
ℹ tests 1053
ℹ suites 0
ℹ pass 1053
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 164375.712625
Checked 15 modules from examples/production-web
Checked 9 modules from examples/flow-board
Checked 8 modules from examples/support-desk
Checked 3 modules from examples/api-dashboard
✓ src/store.test.vel :: theme store

1 passed, 0 failed
✓ src/domain.test.vel :: task workflow uses finite states
✓ src/domain.test.vel :: board mutations are direct and typed
✓ src/domain.test.vel :: task draft uses named record fields

3 passed, 0 failed
✓ src/domain.test.vel :: ticket selection and pagination
✓ src/domain.test.vel :: ticket resolution mutates the owned ticket
✓ src/domain.test.vel :: ticket draft crosses the domain boundary

3 passed, 0 failed
✓ src/chart.test.vel :: chart coordinates are bounded
✓ src/chart.test.vel :: chart scale owns derived internal state
✓ src/chart.test.vel :: chart scale constructor rejects invalid values

3 passed, 0 failed
```

### `npm run test:browser`

```
✓ firefox :: src/app.browser.test.vel :: flow board crud and persistence
✓ firefox :: src/app.browser.test.vel :: search and lazy analytics route
✓ webkit :: src/app.browser.test.vel :: flow board crud and persistence
✓ webkit :: src/app.browser.test.vel :: search and lazy analytics route

6 passed, 0 failed
✓ chromium :: src/app.browser.test.vel :: dialog cancel restores trigger focus
✓ chromium :: src/app.browser.test.vel :: support desk http filter and pagination
✓ chromium :: src/app.browser.test.vel :: typed form route context and persistence
✓ chromium :: src/app.browser.test.vel :: direct detail route recovers data
✓ chromium :: src/app.browser.test.vel :: query page uses strict optional number parsing
✓ firefox :: src/app.browser.test.vel :: dialog cancel restores trigger focus
✓ firefox :: src/app.browser.test.vel :: support desk http filter and pagination
✓ firefox :: src/app.browser.test.vel :: typed form route context and persistence
✓ firefox :: src/app.browser.test.vel :: direct detail route recovers data
✓ firefox :: src/app.browser.test.vel :: query page uses strict optional number parsing
✓ webkit :: src/app.browser.test.vel :: dialog cancel restores trigger focus
✓ webkit :: src/app.browser.test.vel :: support desk http filter and pagination
✓ webkit :: src/app.browser.test.vel :: typed form route context and persistence
✓ webkit :: src/app.browser.test.vel :: direct detail route recovers data
✓ webkit :: src/app.browser.test.vel :: query page uses strict optional number parsing

15 passed, 0 failed
✓ chromium :: src/app.browser.test.vel :: dashboard loads typed data and real svg
✓ chromium :: src/app.browser.test.vel :: dashboard resource reloads without replacing the chart contract
✓ firefox :: src/app.browser.test.vel :: dashboard loads typed data and real svg
✓ firefox :: src/app.browser.test.vel :: dashboard resource reloads without replacing the chart contract
✓ webkit :: src/app.browser.test.vel :: dashboard loads typed data and real svg
✓ webkit :: src/app.browser.test.vel :: dashboard resource reloads without replacing the chart contract

6 passed, 0 failed
Installed VelarScript browser-project acceptance passed
```

（四个浏览器套件共 30 + 6 + 15 + 6 例，跨 Chromium/Firefox/WebKit，全部通过。）
