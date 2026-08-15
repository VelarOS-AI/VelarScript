# 波 M 报告 —— 新语法波（D41 第 61 条、D43 第 69 条、D39 第 51/53 条）

分支 `wave/m`（基于 `aef9e9b`），六个提交，三道门禁全绿。

| 提交 | 内容 |
|---|---|
| `7b29d9e` | feat: closed-vocabulary type bounds (D41 item 61) |
| `2033bee` | feat: ownership-scoped resource release with using and @dispose (D43 item 69) |
| `1170b6d` | feat: the try expression turns an expected failure into an optional (D39 item 51) |
| `d3279d4` | feat: test "name": blocks replace test_* discovery (D39 item 53) |
| `c2791f0` | test: migrate the remaining test sources to test blocks |
| `df4d2de` | fix: an owned binding declares its name to the scope prescan and the index |

---

## 1. 封闭词汇类型约束 `<T: Bound>`（D41 第 61 条）

### 落地内容

- **语法**：`parseTypeParameters`（parser.ts）一处改动覆盖全部七个调用点；
  `<T: Text, U>` 逐参数可带。`TypeParameterDeclaration` 新增 `bound?`/`boundSpan?`。
- **词汇**：`Comparable ⊂ Text ⊂ Data`，实现为 types.ts 的
  `boundCapabilityGrants` 4×3 常量表 + `boundGrants()`。检查器只读表，
  不计算约束间关系；`boundAccepts()` 亦逐能力读同一张表。**语法不含 `+`**。
- **体内解锁**：`Text` → `isTextConvertibleType` 新增 `parameter` 分支（经
  `TypeEnvironment.boundOf`）；`Comparable` → `orderedTypeCategory` 新增
  `"comparable"` 类别；`Data` → `jsonSerializable` 新增 `parameter` 分支。
- **调用点检查**（站点 1）：`inferGenericCall` 解出 bindings 之后、既有
  `requireAssignable` 循环之前，`reportGenericBoundViolations`。未解出的 T
  跳过（`collectGenericBoundViolations` 里显式 `solved == null → continue`）。
- **首类值路径**（站点 2）：`instantiateGenericCallable` 接受可选
  `violations` 出参；`isAssignable` 用它把违约变成「不可赋」（健全性），
  analyzer 包装层 `concreteCallableFor` / `requireAssignable` 用它给定向诊断，
  两条路径共用一个 `reportedBoundViolations` 去重集，一处一条诊断。
- **诊断**：`VEL4031`（约束不满足，三种措辞：报在实参 / 报在调用点 /
  报在首类值处）、`VEL4021`（未知约束名列出可用集合；用户类型明确说
  「约束是编译器自有的封闭集合」）。

### 「错误报在因处」

`inferGenericCall` 里按「恰有一个计划实参提及该类型参数」判定：
是 → 报在该实参 span；否 → 报在 callSpan 并写出解出的类型
（`pick(1, user)` → `the arguments solve it to number | User`）。

### 五条实现风险的答复

1. **约束不可放进 `parameter` 类型 kind** —— 遵守。约束落在 callable 上的
   `typeParameterBounds?: readonly (TypeParameterBound | null)[]`，与
   `typeParameterNames` 同下标。`parameter` 的 `typeIdentity` 仍只编码 index。
   风险文提到的另一半（排除在身份之外 → `<T: Text>(T)->T` 与 `<U>(U)->U`
   同型）由 **callable 身份编码 bounds 向量**堵住：`typeIdentity` 的
   function/action/intrinsic 分支新增一个 `bounds` 节点（全 null 时不写，
   故既有类型的身份字符串逐字节不变，无非回归风险）。
   回归测试：`a bounded callable is not the same type as an unbounded one`。
2. **`TypeEnvironment` 新增 `boundOf(parameter)`，`.at(-1)` 单帧** —— 遵守。
   实现为 `typeParameterFrameBounds: WeakMap<frame, Map<name, bound>>`，
   由 `typeParameterFrame()` 在建帧时登记。**选择 WeakMap 而非并行栈**是
   对规范的机械适配：帧的 push/pop 分散在三处（3299/3379 显式、
   `withTypeParameterFrame`），并行栈需要三处保持同步；以帧对象为键则
   push/pop 天然携带，不可能失同步。`boundOf` 只读 `.at(-1)`，与规范一致。
3. **成本不均衡；`Comparable` 跨六站点四机制，且被三缺陷阻塞** ——
   **规范此处已过时**：D42 第 65 条已把六个站点收敛到唯一权威
   `orderedTypeCategory`（analyzer.ts:8026，注释写明「the single place in the
   compiler that answers "is this ordered"」）。因此 `Comparable` 的实现成本
   降为**一个分支**，不再是最贵的一个，也无缺陷阻塞。
   唯一附带修正：`sorted(by=)` 的选择器可赋性目标从
   `(E) -> number | string` 改为 `(E) -> unknown`（`selectorShape`），键是否
   有序改由 `orderedTypeCategory` 单独判定 —— 否则先于约束存在的联合拼写
   会拒绝 `Comparable` 键。这恰是 D42「一个权威回答有序性」的落实，且把
   坏键的诊断从泛泛的 `Cannot assign` 升级为定向的
   `sorted(by=) key must return only string or only number`。
4. **`typeParameterNames` 三处独立构造** —— 三处都带上约束：
   `analyzer.functionType`（顶层 def + 类方法，二者共用此函数）、
   `analyzer.externFunctionType`、`index.ts functionSignature`（跨模块导出
   接口）。回归测试
   `an exported bounded def keeps its bound across a module boundary` 直接
   覆盖第三处。
5. **解析器一处、格式化器零改动** —— 属实。格式化器是文本切片，
   `<T: Text, U>` 只按既有逗号规则归一化空格，实测稳定且幂等。

### 一处超出规范的实现决定（已记录，供复议）

`T: Comparable` 之间的 `<` `<=` `>` `>=`：运行期类别未知，静态选不了
比较器。新增 `dynamicOrderings` 提示 + `__velarOrderCompare` 派发比较器
（两侧皆 string → 走既有 `__velarStringCompare` 码点序，否则平凡关系序）。
不这么做的话，`T: Comparable` 上的字符串比较会退回 UTF-16 序，与
TXT-D1「码点序在每个有序面上」冲突。`sorted()`/`min()`/`max()` 无需改动，
集合运行时本就按实际值派发（`__velarOrderedCompare`）。

### 测试

`tests/hardening-wave-m-bounds.test.ts`，17 条，含执行级：Text 解锁插值并
接受五类实参；Comparable 解锁 `<`、`sorted()`、`min`/`max`、`sorted(by=)`
并在 astral 字符上验证码点序；Data 解锁 `Json.stringify` 且 Comparable 经链
继承；三条拒绝（实参处 / 调用点合并 / 首类值）；`<T: Unknown>` 与
`<T: UserType>` 各自定向拒绝；`type`/`class` 上的约束仍被 VEL2025/VEL2023
拒绝；类方法带约束；未标注泛型不回归；未解出 T 不误报；跨模块保约束；
有界与无界 callable 非同型。

---

## 2. `using` + `@dispose`（D43 第 69 条）

### 落地内容

- **`@` 词法**：核心 lexer 新增 `at` token（此前 `@` 走 `invalidCharacter`）。
  Look 的 `@hover` 在 web 扫描器内部，零影响。
- **`@dispose:`**：类体成员，与 `constructor`/字段/`get`/方法并列解析；
  `ClassDeclaration.dispose: ClassDisposeBlock | null`。一个类至多一个；
  `@` 后的其他名字被定向拒绝（`VEL2022 Unknown language member '@x'`）。
  **按 G 波会用的同一形状解析**（`at` token + 标识符 + 块），合并应是机械的。
- **`using name = expression`**：上下文关键字（语句头 + 标识符 + `=`），
  零新保留字；`using x: T = ...` 得到定向诊断 `VEL2036`。
- **释放契约**：类走自己的 `@dispose`（含继承，沿基类链查找）；
  能力句柄由编译器内建，委托到各自既有动词。
- **降级**：`emitStatementLines` 把 `using` 之后的整段语句移入释放帧，
  第二个 `using` 嵌进第一个 —— LIFO 是这个结构的自然结果。释放帧形状：
  `try { … } catch (e) { released = true; try { dispose } catch (f) { report(f) } throw e } finally { if (!released) dispose }`。
- **失败优先级**（规则 8）：在途错误存在时原错误抛出、释放失败经
  `__velarDisposalReport` 归一化后走宿主 console 通道；无在途错误时释放失败
  正常抛出。新增 runtime-boundary 台账行 `B-USING-DISPOSE`。
- **异步**：`@dispose` 体内 `await` 由 `blockContainsDirectAwait`（新增于
  ast.ts，语句级走查，遇嵌套函数边界即停）静态判定；为真则要求 `using`
  所在作用域 async，否则 `VEL4033`。获取端 `using x = await open()` 照常。
- **幂等**：语言层不强制，作用域只释放一次；标准库 `close` 已幂等，
  「先手动 close 再作用域释放」实测无害（有执行级回归）。

### 编译器内建能力类型的判定方式（与规范措辞的差异，需知悉）

规范写「编译器为能力类型内建（FileWatcher/TerminalSession/LanguageServer →
`close()`；Server/Process/ProjectTask → `stop()`）」。**实现没有把这六个
类型名写进 Core**，那会违反宪章规则 5（目标能力留在扩展里）。改为结构判定：

> 一个 `named` 类型，其身份以 `velar/` 开头（标准能力模块自有的句柄类型；
> 用户 `type` 的身份是 `velar:<path>#type:<Name>`，冒号，永不匹配），
> 且恰有一个 `close`/`stop` 成员、零必需参数、结果为 `null` 或
> `Promise<null>`。

六个句柄全部命中，且未来任何能力模块的新句柄自动获得 `using` 支持。
记录被拒（记录是数据）由此自动成立 —— 记录的身份前缀不同。

### 一处与规范的语义偏离（需用户知悉）

D43 第 69 条规则 6 列「组件体合法」。实现**拒绝**组件体内的直接 `using`
（`VEL3018`，定向指向 action / 方法 / cleanup 钩子）。理由：组件体是构造段
而非会结束的作用域 —— 在 setup 结束时释放显然错误（资源要活到卸载），
而「卸载时释放」需要 web 扩展的 `$velarScope.cleanups` 机制，与 G 波正在
改的组件成员直接相邻，且异步释放在同步 cleanup 通道里的语义、以及
「在途错误优先」在那里如何成立，规范都没有裁决。组件内的 action、
方法、`@mounted` 体是真作用域，`using` 在其中完全可用（有执行级回归）。
**若用户认为组件体应当支持，这是一次独立的小设计（释放时机 + 异步通道），
建议随 G 波一并裁决。**

### 其他实现层记录

- `@dispose` 降级为原型成员 `["__velar:dispose"]`。键含冒号，不是合法源标识符，
  故**源码不可能拼出它**，也不可能与作者声明的成员撞车（宪章 §3 明写属性名
  不受 `__velar` 前缀保留约束，所以不能用 `__velarDispose` 这类普通名字）。
  由此「`@dispose` 不可直接调用」与「`@dispose` 和 `def dispose()` 共存」
  都是结构结论，不是额外检查。
- `using` 绑定参与既有的「后声明遮蔽先读取」规则（VEL3017），
  与 `const` 同等（`df4d2de`）。
- `async for` 协同：`using source = await watchFiles(p)` + `async for`
  实测通过；宪章 async-for 节里那句「caller remains responsible, normally
  with try/finally」已改写为指向 `using`。

### 测试

`tests/hardening-wave-m-using.test.ts`，14 条，绝大多数执行级：五条退出路径
（正常/return/break/continue/throw）+ LIFO 顺序；循环体每轮释放；幂等；
失败优先级（含 stderr 上的宿主报告断言）；async 释放在非 async 作用域被拒 +
async 场景执行；`@dispose` 不可调用且与 `def dispose()` 共存；重复 `@dispose`
与未知 `@` 成员；模块顶层与组件体各自被拒；记录被拒；`using` 在别处仍是普通名字
+ `using x: T =` 的定向诊断；三个内建能力句柄（FileWatcher→close、
Process→stop、Server→stop，含发射断言）+ 漏 await 的定向诊断；跨模块类保契约；
继承的契约仍运行；遮蔽读取规则。

---

## 3. `try` 表达式（D39 第 51 条）

### 落地内容

- **语法**：`parsePowerBase` 里与 `await` 同层 —— 捕获范围就是整条后缀链，
  `try a().b().c()` 是一次尝试，`try await load()` 捕获 rejection。
- **语句头消歧**：`try` 后紧跟 `:` → 既有块形；否则落到表达式解析。
- **类型**：`optionalOf(inner)`；已 optional 则保持（失败与 null 合流）。
- **必须被消费**：裸 `try` 表达式语句 → `VEL4034`，并抑制原本会重复出现的
  VEL4030「结果被丢弃」，一个错一条诊断。
- **降级**：`(() => { try { return E } catch { return null } })()`，
  内含 await 时为 `await (async () => {…})()`。

### 两处超出规范的拒绝（按规范自身的理由推出，需知悉）

规范只明写「裸表达式语句拒绝」「`try try` 拒绝」。实现另加两条，
理由都是规范禁裸语句的同一句话（「无可见消费的静默吞错」）：

1. **成功值为 `null` 的尝试被拒**（`try act()` 其中 `act() -> null`）：
   成功与失败都得到 `null`，即使「被消费」也分辨不了，诊断指向 try/catch。
2. **Promise 值的尝试被定向到 `try await`**：`try load()` 在表达式求值期间
   不会失败（rejection 在之后），静默地什么也不捕获；诊断写明写
   `try await ...`。

两条都可按用户裁决撤回，撤回后仅需删诊断分支。

### 测试

`tests/hardening-wave-m-try.test.ts`，10 条，含执行级：失败→null / 成功保值；
整条后缀链；`try await`；结果类型 `T?` 与已 optional 保持（读模块接口）；
裸语句拒绝；`try try` 与 null 成功值拒绝；Promise 定向；块形不回归；
`try` 比 `??` 紧（`try f() ?? -1` 求值为 -1）；尝试不吞掉链外的抛出。

---

## 4. `test "名字":` 块（D39 第 53 条）

### 落地内容

- **语法**：上下文关键字（`.test.vel` 模块顶层 + 字符串字面量 + 块）。
  别处 `test` 仍是普通标识符（`def test(...)`、`const test = ...` 不受影响）。
- **上下文判定**：`AnalysisContext` 新增 `path`（index.ts 注入
  `parsed.source.path`）；非 `.test.vel`、非顶层、空名、重名各有定向诊断
  （`VEL3019`）。
- **体内可直接 `await`**：体作为 async 帧分析并发射为
  `export async function __velarTest<span>()`。
- **接口**：`ModuleInterface.testFunctions: string[]` → `tests: ModuleTest[]`
  （`{ name, title }`）。两个 runner 都改为**逐字引用 title**。
- **未拥有错误的立场**：块与旧函数走同一条 `await test()` + `drainUnowned()`
  路径，立场自动覆盖（有执行级回归：detached 失败归属到发起它的那个测试）。
- **一个拼写**：`.test.vel` 顶层的 `def test_*` 被拒，诊断直接给出应写的
  `test "…":`（名字由蛇形还原为句子）。空测试文件的失败措辞由
  「contains no test_* functions」改为「declares no tests」。

### 迁移（穷尽）

- 仓库 8 个 `*.test.vel`，30 个测试。
- `velar create` 全部六个模板（web/node/desktop/docs/library/component）。
- TS 套件里内嵌的测试源与报告断言：`browser-lifecycle`、`desktop-worker`、
  `hardening-detached-async`、`hardening-marathon-web`、`hardening-reactivity`、
  `hardening-spelling`、`hardening-web-runtime`、`hardening-web-surface`、
  `hardening-web-syntax`、`hardening-audit-runtime`、`compiler`、
  `installed-browser.acceptance`。
- 文档：charter §12 新增 *Tests* 小节、AI 简报、`docs/standard-library.md`、
  `docs/web-api.md`。
- 文档门禁：声明测试的示例改用 `.test.vel` 入口名编译
  （`scripts/check-documentation-examples.mjs`）。
- 全仓已无 `test_*` 发现机制残留（`HANDOFF.md` 的历史记述与本波诊断文本除外）。

### 测试

`tests/hardening-wave-m-test-blocks.test.ts`，10 条，其中 5 条是真正跑
`velar test` 的端到端：发现与逐字报告；失败归属到该测试且运行继续；
体内 await；未拥有错误立场；空测试文件失败；上下文/顶层/空名/重名拒绝；
`def test_*` 退役诊断且同模块的普通 `def` 助手不受影响；`test` 在别处仍是
普通名字；模块接口同时带发射名与作者名。

---

## 规范读起来与代码不同的地方（汇总）

1. **D41 风险 3 已过时**：`Comparable` 的「六站点四机制 + 三缺陷阻塞」在
   D42 第 65 条落地后已收敛为单一 `orderedTypeCategory`；实现按现状适配，
   成本远低于规范预估。
2. **D41 风险 1 的后半句**（排除在身份之外会造成同型洞）需要 callable 身份
   编码 bounds 才能堵住；已实现并有回归。规范只说了「安全位置」，没说身份
   编码，属机械补全。
3. **D43「编译器为能力类型内建」**：实现用结构判定而非类型名清单，理由是
   宪章规则 5（见上）。覆盖面与规范列举的六个句柄一致。
4. **D43「组件体合法」**：实现拒绝，理由与建议见上，**待用户裁决**。
5. **D39 第 51 条**：新增两条拒绝（null 成功值、未 await 的 Promise），
   依据是规范自身禁裸语句的理由，**待用户确认或撤回**。
6. **D39 第 51 条**「捕获任何抛出的 `Error`」：降级用的是无过滤 `catch`。
   受检 Vel 只抛 Error，JS 边界值在边界处已归一化，故行为一致；写在这里
   以免读者以为运行期还有一次 `is Error` 过滤。

## 新增诊断码

`VEL2036`（`using` 语法）、`VEL3018`（`using` 无可释放的作用域）、
`VEL3019`（`test` 块的声明位置/名字/退役指引）、`VEL4031`（约束不满足）、
`VEL4032`（值未声明 `@dispose`）、`VEL4033`（异步释放需要 async 作用域）、
`VEL4034`（`try` 表达式的消费与形态规则）。`VEL2022` 复用于 `@` 成员错误，
`VEL4021` 复用于未知/非法约束名。

---

## 门禁逐字尾部

### `npm run check`

```
> velarscript-workspace@0.10.0 check:format
> node scripts/check-velar-format.mjs

Checked 53 formatted VelarScript source files

> velarscript-workspace@0.10.0 check:docs
> node scripts/check-documentation-examples.mjs

Checked 182 VelarScript documentation examples (76 complete, 106 fragments), all under full project analysis

> velarscript-workspace@0.10.0 check:boundaries
> node scripts/check-runtime-boundary.mjs

Checked 77 runtime boundary operations and the shared registry, strict JSON, Web DOM, host-event, browser-platform, storage-host, and Desktop-host ABIs
```

### `npm test`

```
ℹ tests 1007
ℹ suites 0
ℹ pass 1007
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 151288.389083
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
