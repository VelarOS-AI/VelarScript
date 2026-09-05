# D115：面向 agent 维护的代码组织重设计与排期（2026-09-05）

所有者 2026-09-05：「继续审查语言存在的问题，以及设计不好的地方，还有代码重构这些都需要
进行排期，不让现在一个文件中的代码太多了，后面很难维护，你按照对于 agent 来说最好维护的
方式来进行重新设计。」本文把 D114 第二部分的 R0–R6 细化为一套**以 agent 为维护者**的代码
组织设计，并给出语言审查与重构交错推进的排期。D114 的裁决与 R0 基线账本继续有效；
本文只在其上加细则与顺序。

## 一、判据：什么叫「对 agent 最好维护」

维护者是模型，不是人。模型读代码要付上下文，改代码靠局部证据，而且不会自发抱怨结构差——
它会绕过去。于是可维护性的判据不是「人读着舒服」，而是下面七条，每条都能被门禁或
测试量出来：

1. **一次读完**：一个源文件在一次 `Read` 内读完并理解——硬上限 800 行，目标 500 行；
   一个函数在一屏内读完——硬上限 120 行，目标 60 行。今天 `analyzer.ts` 17,485 行、
   `analyzeStatement` 1,009 行，任何一次改动都要求模型先读一个它读不完的东西。
2. **路径即概念**：文件在目录树里的位置就说明它管什么（`analysis/flow/narrowing.ts`），
   不需要先读别处才知道去哪改。过程名（wave、audit、batch、closeout）不进源码和测试文件名，
   只留在 D 记录与提交信息里。
3. **依赖面写在门口**：一个协作者模块显式声明它需要宿主提供的**窄接口**（它调用的那几个
   方法），而不是拿整个 `Analyzer`。改一个模块前，模型只需读它的接口声明就知道波及面。
4. **运行时是真源码**：今天四个包里约 1.4 万行发射用的 JavaScript 存在 TypeScript 模板字串里
   （`serve-runtime.ts` 4,228 行中 4,024 行是字串）。字串里的代码没有语法检查、没有高亮、
   测试只能整段拼接后跑。它们要变成真正的 `.js` 源文件，构建时生成字串常量。
5. **结构由门禁守**：文件预算、函数预算、模块地图、运行时源码同步，全部是 `npm run check`
   的一部分；违例只能减少不能增加。约定对模型无效，门禁有效。
6. **测试镜像源码**：`tests/<领域>/<主题>.test.ts` 与 `packages/*/src/<领域>/<主题>.ts` 对应，
   一处概念一处测试；共享助手只有一份。今天 210 个测试文件里 147 个按波次命名、`run` 助手
   被重定义 53 次、60.7% 的测试只在 `test:full` 跑。
7. **零语义改动可证明**：每一步重组的验收不是「测试过了」，而是 R0 的产物指纹逐字节一致
   （828 个文件）、`protected` 缝签名与公开导出清单不变、五道门全绿。

## 二、硬约束与门禁（新增三道，扩一道）

| 门禁 | 规则 | 机制 |
|---|---|---|
| `check:file-budget` | 源文件 ≤ 800 行、函数/方法 ≤ 120 行；测试文件 ≤ 800 行 | 用仓内已有的 `typescript` 走 AST 计函数行数；`file-budget-allowlist.json` 冻结当前违例（43 个 >500 行的文件、所有 >120 行函数），只允许缩小与删除，新增违例即红 |
| `check:module-map` | `docs/contributing/module-map.md` 每个源文件一行：路径、职责、实现的宪章章节、对应测试 | 门禁比对文件系统与地图：缺行、多行、路径不存在都红 |
| `check:runtime-sources` | `packages/*/runtime/**/*.js` 是唯一真源，`src/*.generated.ts` 里的字串常量由脚本生成 | `scripts/generate-runtime-sources.mjs` 重新生成并 diff；生成文件入库（测试从 `src` 导入） |
| `check:boundaries`（扩） | 运行时边界检查改读 `runtime/*.js`，并禁止 `src/` 内出现新的多行 JS 模板字串 | 现有脚本加一条扫描 |

预算数字是**上限不是目标**：800 行是「一次读完」的边，500 行才是设计的落点。allowlist 存在
只是为了让门禁今天就能上线，它的长度是重构进度的度量，目标是空。

## 三、目标布局

### `packages/compiler`

```text
src/
  index.ts                 compile()/inspectModule() 与公开再导出（门面，≤300 行）
  extension.ts             扩展协议：只有类型与协议常量，不再再导出实现类的值
  contracts.ts             分析器↔发射器共享的类型与常量（R1a 已建）
  source/                  source.ts  source-names.ts  diagnostic.ts  advisory-suppression.ts  limits.ts
  lexer/                   scanner.ts  strings.ts（内联/布局/f-string）  numbers.ts  hygiene.ts（bidi/控制字符）
                           embedded-source.ts  continuation.ts（前导点续行与 A1 回读）
  parser/                  parser.ts（入口与语句分派）
                           statements/{declarations,control-flow,classes,modules,types,tests}.ts
                           expressions/{primary,postfix,operators,literals}.ts  patterns.ts  type-syntax.ts
  ast/                     nodes/{statements,expressions,types,patterns}.ts  constructs.ts（构造名册）  walk.ts
  types/                   model.ts（ValueType）  assignability.ts  unification.ts（泛型）  bounds.ts
                           display.ts  from-syntax.ts  readonly.ts
  analysis/                analyzer.ts（门面：作用域栈、语句分派、protected 缝；≤800 行）
                           scopes.ts  flow/{facts,narrowing,loops,merge}.ts
                           declarations/{records,aliases,enums,generics}.ts
                           classes/{registry,members,inheritance,roles}.ts（roles = @dispose/@iterate）
                           calls/{inference,named-arguments,generic-calls,seeding}.ts
                           collections/{operations,list,set,map,record}.ts
                           members/{strings,numbers,namespaces}.ts
                           modules/{imports,exports,interfaces,initialization}.ts
                           advisories/{roster,a1-a6,collections,records,tuples}.ts（R1a 已建 advisories.ts，后续按族拆）
                           lowering-recorder.ts（R1a 已建）  vocabulary/{text,math,json,promise}.ts  guidance.ts
  emit/                    emitter.ts（门面）  statements.ts  expressions.ts  classes.ts  matching.ts
                           validators.ts（Type 校验器发射）  runtime-imports.ts  source-map.ts
  format/                  formatter.ts  tokens.ts  lines.ts  strings.ts
  semantic/                index.ts  symbols.ts  references.ts  documentation.ts
  runtime-sources.generated.ts   由 runtime/**/*.js 生成
runtime/                   collection-host.js  collection-lowering.js  type-validation.js  narrowing.js  error.js
                           promise.js  primitive.js  class.js  utf8.js  number.js  json.js  text.js  range.js
                           reactive-bridge.js  manifest.json（模块名、导出名、依赖）
```

### `packages/web`

`analysis/{components,jsx,look,look-static,reactivity,resources-actions,lifecycle,watch-cycles}.ts`；
`emit/{components,jsx,look,runtime-imports}.ts`；`runtime/` 拆为 `graph.js`（依赖图与调度，
今天的 runtime-foundation）、`flush.js`（预算与 runaway 报告）、`dom.js`、`components.js`、
`look.js`、`http.js`、`storage.js`、`browser.js`、`forms.js`、`realtime.js`、`worker.js`、
`app.js`（错误链与 mount/tick）。今天 `runtime.ts` 3,779 行是十几个 `velar/*` 模块挤在一起。

### `packages/node`、`packages/server`、`packages/desktop`

`serve-runtime.ts` 拆成 `runtime/serve/{router,request,response,middleware,static,openapi,
websocket,lifecycle,limits}.js`；`node-host-worker-runtime.ts` 拆成 `runtime/host/{protocol,
process,filesystem,terminal}.js`；`server-analyzer/parser/emitter` 保持但归入 `analysis/`、
`emit/`。desktop 的 `compiler.ts` 2,867 行同样是运行时字串为主，同法拆入 `runtime/`。

### `packages/core`

`index.ts` 3,239 行 = 十余个 `velar/*` 模块的接口表 + 运行时源码。拆为
`interfaces/<module>.ts`（每个 `velar/*` 一个文件，导出该模块的 `moduleInterface`）与
`runtime/<module>.js`；`index.ts` 只做汇总。

### `packages/cli`

`project.ts`（2,887 行，`compileProjectEntries` 560 行）拆为 `project/{graph,interfaces,
incremental,entries,diagnostics}.ts`；`language-server.ts` 按 LSP 能力拆
`lsp/{hover,completion,rename,semantic-tokens,diagnostics,transport}.ts`。

### `tests/`

```text
tests/
  support/           compile.ts  run-cli.ts  execute-module.ts  web-project.ts  temporary-directory.ts（唯一一份助手）
  compiler/          lexer/  parser/  types/  analysis/  emit/  format/  semantic/   ← 与 src 目录一一对应
  core/  web/  node/  server/  desktop/  cli/
  acceptance/        package.acceptance.ts  release.acceptance.ts  browser.acceptance.ts
  corpus/ fixtures/
```

`hardening-*` 全部**按所钉的主题**并入上面目录，测试体逐字搬移、计数只增不减；跑得慢的
（进程/浏览器/正则超时）改名 `*.slow.test.ts` 留在同一目录，默认门禁按后缀排除而不是按历史
排除。`compiler.test.ts`（29,911 行、530 个测试）按主题拆完即删。

## 四、迁移策略（R1a 已在执行）

- **组合而非继承拆分**：`Analyzer`/`Parser`/`JavaScriptEmitter` 仍是 Web/Node 子类继承的唯一
  入口；私有状态与私有方法按内聚簇搬进 `analysis/*` 协作者，`this.<协作者>.方法()` 调用；
  `protected` 成员一个不动（字段仍是字段——子类会赋值）。协作者自己声明所需宿主接口。
- **门面不变**：`analyzer.ts` 等原模块保留并再导出搬走的名字，导入路径全部不变；
  `@velarscript/compiler` 的 116 + 111 个导出名不变。
- **每片可证明**：四门 + `test:full` + `npm run fingerprint -- --compare` 逐字节一致 +
  缝与导出清单 diff 为空。不一致就不合并。
- **同一 worktree、同一绝对路径**（`/private/tmp/velar-d114/r0-baseline`）跑指纹——R0 记录了
  source map 相对路径对 checkout 位置的依赖。
- **溯源注释随代码走**：D 编号、审计编号注释一律搬到新位置，不删。

## 五、排期：语言审查与重构交错

原则：审计是只读的，随时可与重构并行；修复波要落在重构片之间（重组后的代码上修，
避免同一文件两边改）。每个阶段的完成条件写死，不按日历算。

| 阶段 | 内容 | 完成条件 |
|---|---|---|
| **P0（今日）** | 0.28.0 发布 ✓；0.28.0 表面审计（约 200 探针）；L 波（`namespace.Generic<T>`、保留名单报告）；R1a（contracts / 降级记录器 / A 名册） | 审计账本落地；L 与 R1a 各自五门绿 + 指纹一致 |
| **P1** | 审计的 DEFECT/INCONSISTENT 修复波（一到两波，落在 R1a 之上）；`check:file-budget` 上线（allowlist 冻结当前违例） | 账本零 DEFECT；门禁绿 |
| **P2** | R1b–R1d：analyzer 余下簇（集合推断 → 调用推断与泛型 → 流事实与收窄 → 类 → 模块接口）、emitter 与 parser 按族拆、`types.ts` 拆；每簇一片 | `analyzer.ts` ≤ 800 行；compiler 无 >800 行文件；指纹一致 |
| **P3** | 运行时成真源码：compiler `runtime/*.js` + 生成脚本 + `check:runtime-sources`；随后 web、node、core、desktop 同法 | 四包 `src/` 无多行 JS 字串；指纹一致 |
| **P4** | web `analysis/`、`emit/`、`runtime/` 拆；node/cli/core 拆；`check:module-map` 上线 | 全仓无 >800 行源文件；模块地图门禁绿 |
| **P5** | 测试镜像：`tests/support/` 助手归一；147 个 `hardening-*` 按主题并入；`compiler.test.ts` 拆完；慢测试改后缀；默认门禁覆盖全部非慢测试 | 测试数 ≥ 2,758；`npm test` 覆盖率不再按历史排除 |
| **P6** | 语言设计审查第二轮：未被 0.28.0 审计覆盖的面（异步与 task/channel、错误、模块、字符串与 Text、Web Look/JSX、Node server）；D114 延后项（一等绑定回调成员丢结果类型、表面摘要不含退役拼写与 A 名册、`extern class` 内建名门）逐条裁决 | 新审计账本 + 裁决记录 |
| **P7** | 姊妹仓迁移（所有者 2026-09-05 指示延后）；D34 路线图车道择一启动 | 所有者另行下令 |

每个阶段结束发一版（P1、P2、P4、P5 各一次；P3 若指纹一致可不单独发版，随下一版走），
`core`/`web` 表面号按 D110 由门禁决定。

## 六、语言审查的常设节律

- **每版一审**：发版后对该版新增表面做对抗性审计，账本进 `docs/decisions/archive/`，
  DEFECT/INCONSISTENT 直接开修复波，UNDEFINED 与设计题进 D 记录待所有者裁决。
- **设计题只问所有者**（[[vel-marathon-protocol]]）：实现缺陷直接修；语义、拼写、表面变动
  一律先记后问。
- **延后项有账**：D114 各波「上报」段里标为「后续/另立小项」的条目，P6 统一清算，
  不允许悬着不记。

## 七、与 D114 的关系

D114 第二部分的 R0–R6 编号继续使用：R0 已落地（基线与指纹），R1 按本文第四节的簇顺序
拆片（R1a 在跑），R2 = 本文 P3 的 core 部分，R3 = P4 的 web，R4 = P4 的 node/cli，
R5 = P5，R6 = 模块地图与文档。本文新增的是**门禁三道、运行时成真源码、测试镜像布局、
以及与语言审查交错的顺序**。
