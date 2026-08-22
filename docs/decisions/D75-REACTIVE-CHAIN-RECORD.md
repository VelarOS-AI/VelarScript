# D75 — 反应式链的实施记录（波 S1，2026-08-16）

**本文不是新裁决，是记录。** 波 S1 实施了 D71/D69/D70/D72/D73 五条，
交回了三类东西：对我裁决的更正、我留给它的问题的答案、以及新发现。
**它的门禁一次都没跑成**（并发方把树写成了不可构建状态），
所以本文记的是它报告的内容，**验证待树稳定后由我补做**。

---

## 一、对我裁决的两处更正

| 我写的 | 实际 | 我怎么错的 |
|---|---|---|
| D71：迁移面 **21** 处 | **约 75** 处 | 我扫了 `examples/` 与 `docs/`，**漏了 `tests/**` 的 53 处与两个 README** |
| D73：`lookDefaultKeywords` **39** 个 | **46** 个（41 字面 + 5 CSS-wide） | 转述上一波的数字，没自己数 |

**第一处的错法是新的。** 前几次是「方法看不见完整答案」或「根本没用方法」；
这次**我确实跑了扫描，但把范围划小了** —— 只扫了我想到的两个目录。

**规矩再补一条**：迁移面的扫描**范围本身要先证明是全的**
（本仓能编译 `.vel`/带 velar 围栏的位置有：`examples/`、`docs/`、
`tests/`、`packages/*/README.md`、**两个根 README**、
`packages/*/stdlib`、`packages/create` 的模板字符串）。

---

## 二、我留给它的三个问题，答案

### D71 第 9 项：`readonly` 与 `computed` —— **不自动 readonly 投影**

实测，不是推理：

| | 能写穿吗 |
|---|---|
| `const alias = tasks[0]` 后 `alias.title = "x"` | 接受 |
| `computed first = tasks[0]` 后 `first.title = "x"` | 接受 |
| `component Row(task: readonly Task)` 后 `task.title = "x"` | 拒绝 |

**`readonly` 守的是「跨组件的所有权」，不是「派生」。**
`computed x = tasks[0]` 与 `const x = tasks[0]` 命名的是本作用域已经拥有的同一个对象；
让其中一个只读，会在网格里放进一条网格没有的区别。

**并且 D74 让 props 默认可改之后，这个答案更站得住** ——
`readonly` 现在处处都是显式选择，而这正是那个框架。

### D69 的两个邻居：**都不拒绝**

- **`cached(() => 5)` / `computed x = 5` 无反应式依赖 —— 不拒绝。**
  它们求值一次，每次读都拿到那个值，**什么也没有被丢弃**。
  `watch` 的缺陷是**一整块语句永不执行**；一个常量派生值**完整地做完了它的活**。
  （2026-08-22 附注：D90 R15(b) 删除 `cached` 之后，`cached(() => 5)` 已经不是一个
  拼写；这个答案由 `computed x = 5` 独自承担，实测仍不拒绝。）
- **`resource` 的 input 非反应式 —— 不是同一形状。**
  它照样在挂载时加载、照样能按需 reload，charter 本来就写明 resource 不自动重取。

**两条都写进了回归**，所以将来有人要改判得先推翻那条测试。

### D70 第 181 条：`state` 覆盖率门禁 —— **可行但建议推迟**

- **静态：不值得建。** 语义索引免费给出每个 `state` 声明与每处写引用，
  但「`*.test.vel` 里存在一次写」**两个方向都答错**：
  测试里只要有个赋值就通过；而常见形态是测试调用一个导出的 action 去写，那样会误报。
- **动态：可行**，`__velarState.set` 就是现成的钩子点，约一天。
- **让它变成多天的是**：单元测试与浏览器测试**跑在不同进程、覆盖不同模块集**，
  门禁必须每次运行产出覆盖产物再合并，否则每个只在浏览器里被写的 `state`
  都会被报成未覆盖。

**建议与 D26 二期同期建**，纪律先写进 `best-practices.md`。

---

## 三、新发现

### D73 的范围比我写的宽：`border` 与 `shadow` 也说假话

同一句「use one of the closed X keywords」也对 `border`/`shadow` 两个 kind 触发，
**而 D73 没提它们**。同缺陷同修法。

### 一条镜像缺陷 —— 值得单独记

`angle`、`duration`、`number` 三个 kind **在类型层拒绝一切字符串**。
所以按 D73 给它们发布闭集，**那些值将永远够不到** ——
`zIndex = "auto"` 是 CSS 初始值、五个 CSS-wide 关键字在别处处处合法。

**发布一张类型层禁止的表，是 D50 第 92 条的反方向**：
那条说「发布一个够不到的名字比不发布更糟」，
而这是「发布一张够不到的表」。**同一条原则，镜像的违反。**

修法是先让那三个 kind 接受 `string`，闭集才成其为表面。
**这条我没有想到，D73 也没有。**

### 我们自己的 charter 里就有 D72 描述的那个静默丢失

`docs/language-charter.md` 有 `type Event = TextEvent | ToolEvent` ——
**正是 D72 第 186 条说的「用户类型静默输给 Web 内建」**。已改名。

### 两处边界外、需要后续处理

1. **`packages/compiler/src/analyzer.ts:2426` 的 VEL4025 与 `computed` 名字耦合**，
   不随改名走 —— 导出的 `cached(...)` 访问器会静默失去导出边界的契约要求。
   S1 在 web 侧补了一条，**Core 那条现在是只对退役拼写触发的死代码，该删**。
   （2026-08-22 附注：已了结，但**不是被 R15(b) 了结的**。本项点名的 Core 死分支
   在 2026-08-16 随提交 `3bb18e2`（「让拥有这个词的扩展拥有它的诊断」）删除，
   理由正是本项写的那条：Core 不拥有这个词。S1 补在 web 侧的那条替身，才是
   D90 R15(b) 随 `cached` 一起退役的 —— 见 D71 的取代附记。`VEL4025` 这个码
   在 Core 里仍然活着，管的是递归结果推断不收敛。）
2. **`packages/cli/src/project.ts:704-727` 会把导出的 computed 叫作 "state binding"**
   并建议「Export a mutator」。S1 让它不可达，但文案是错的。
   （2026-08-22 附注：已了结，与上一项同一个提交 `3bb18e2`。今天的消息是
   「Cannot assign to imported reactive binding '…'; it is read-only here.
   Export an action from the owning module that changes it and call that
   instead」——「mutator」不再出现，语言真有的那个词 `action` 出现了；
   `importedReactiveAssignmentDiagnostics` 上方留了一段契约注释，记着
   `reactiveExports` 的 `"state"` 是「反应式」这个标记，不是源语言里的名词。）

---

## 四、它自己抓到的三个错，方法值得记

1. **一次真实的误编译，不是诊断。** 第一版把「导入的 computed 降级为 prop」
   **按名字**做，于是一个组件内 `state openTasks` 遮蔽同名导入时**也被降级**，
   它的 `+=` 发射成普通赋值而不是 `.set(...)`。
   **编译干净、行为错误。** 改为按解析后的绑定 span 做。
2. **`velar fix` 的跨模块盲区**：它改了 `store.vel` 里的 `export computed dark`，
   却留下了 `home.vel` 里的 `dark()` —— **别的模块里的读取，单模块 pass 看不见**。
   补了一条永久规则（调用不可调用的 computed → VEL5063 带删括号的编辑），
   让多趟修复能收敛。
3. **D70 实现期抓到三个真缺陷**：框架内部的 prop 读取会误报活代码、
   web 运行时按模块内联导致 setup 栈跨模块失效、
   冻结读取若隔着一个 computed 则没有订阅者因而永不上报。

**第 1 条最值得记**：那是**它自己引入又自己抓住的误编译**，
而误编译比缺失诊断危险得多。它是靠给那条降级写回归测试才发现的。

---

## 五、一处它主动上报的边界例外

它改了 `README.md` 与 `README.zh-CN.md` —— 两份都在禁改清单里。
理由：`scripts/check-documentation-examples.mjs` **编译每一个根 README**
（那是我今天早些时候加的），而两份都写着 `const remaining = computed(...)`。
**不改则 gate 1 必红。**

**处置正确，且它明确标注了这是有意的边界例外。**

---

---

## 六、波 S2（泛型第一层）同期完成，记要点

**`type Box<T: Bound>` 那一层完成**：解析/AST、类型模型
（`GenericApplication`、唯一的规范身份构造器、替换 + 合一 + 越界报告）、
分析器（按身份键入的替换字段表、元数、约束、多态递归在声明处拒绝、
`readonly` 深数据规则达到实例化）、发射器（每声明一个带记忆化的实例化工厂、
按实参参数化的验证器）、**跨模块**（`ModuleInterface` 模板 + 全部导入传播站点 +
`moduleInterfaceIdentity` 哈希，用真实的双模块与三模块项目端到端验过）、
展示第 4 章、一条**证明过会红**的覆盖率门禁类别、charter 一节、17 个测试。

**`class Stack<T>` 未开始，且是有意的** —— D55 第 120 条本来就把类推到第二增量，
我的任务书也写的是「先做 `type Box<T>`，类单独评估」。它只是把那条拒绝消息
改成读共享名册。

### 它在并发风险下的处置值得记

被告知有并发编辑者后，它**先把三份快照做出来再回话**
（全树 diff、只含自己文件的 diff、15 个文件的逐字副本），
然后**逐个核对自己的标记是否还在**（`emitter.ts` 18 处、`parser.ts` 4 处、
`analyzer.ts` 39 处），并确认 Codex 的符号是**并排**而不是覆盖。

**「先保住再汇报」是对的顺序。**

### 它交回的两条

1. **`packages/web/src/parser.ts:481` 仍写着 "only 'def' functions take '<T>'"** ——
   泛型类型落地后**这句话已经是假的**。边界外未动，进队列。
2. 它再次清掉了游离符号链接 `packages/create/create`（指向 scratchpad）——
   **这是第二次出现**，是各波做快照隔离时留下的。它不在 git 里，
   但会让 `release.acceptance` 对所有人变红。**值得让快照流程自己清理。**

---

## 待办

- 树稳定后**我补跑四门**并按来源拆提交
- 上面两处「边界外」（VEL4025 死代码、`project.ts` 文案）与
  `packages/web/src/parser.ts:481` 的过期消息进队列
- D73 的 `border`/`shadow` 与三个 kind 的类型层放宽，进 D73 的实施
- 快照流程留下的游离符号链接要自清理
