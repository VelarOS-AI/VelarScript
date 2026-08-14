# 波 Z2 — 报告（2026-08-14）

分支 `wave/z2`（基于 `450a13c`），三个提交：

| 提交 | 内容 |
|---|---|
| `4951db3` | `Text.normalize` + 码点身份那一句（TXT-U3） |
| `bdabfeb` | 六条流分析裁定（FLW-N7/N2/S1/N6/S2/N4） |
| `6117385` | `import type`（MOD-U3 / D38 第 49 条） |

回归测试全部在 `tests/hardening-wave-z2.test.ts`（30 例）。账本证据是执行级的地方，
测试也是执行级的：六个流条目里有四个带 `run(...)` 的运行断言，`Text.normalize`
带三个，`import type` 的发射断言直接读 `result.code`。

---

## 1. TXT-U3 —— `Text.normalize`

**探针复现**：`Text.normalize("cafe")` → `Object has no field 'normalize'`。

**落地**：`Text.normalize(text, form = "NFC")` 进永久 `Text` 命名空间，接受且只接受
四个 Unicode 形式（`"NFC"`/`"NFD"`/`"NFKC"`/`"NFKD"`），其余是 `RangeError`。
`slug` 早就捕获了 `String.prototype.normalize`，这里只是把它作为边界工具暴露出来 ——
没有新的宿主 ABI，`check:boundaries` 的捕获清单不变。

**charter**（§5 字符串值空间段落）新增：文本相等是码点序列身份，故规范等价的文本
不相等 —— 同样渲染、`size` 不同、互不认作 Map/Set 键；在文本进入程序的边界规范化，
因为 macOS 文件名是分解式而键入的文本通常是合成式。`docs/standard-library.md`
与两份 ai-skill 镜像同步。

**迁移落差**：`tests/compiler.test.ts` 的 `0.5` 用例数着标准库导出总数，
`velar/text` 22 → 23、前九个模块 118 → 119、总数 281 → 282。这是新增一个名字的
机械后果，注释已改为记录 `Text.normalize` 是此后唯一移动过总数的名字。

---

## 2. 六条流分析裁定

每条都先复验探针仍复现，再决定。**选择与健全性论证**如下。

### FLW-N7 —— `flag == true` 收窄 `bool?`

**选择**：`true` 与 `false` 是 `bool` 的两个成员，所以与任一布尔字面量的相等
把单例事实带回所有者 —— 与 §6 的枚举单例规则同一条规则，不是新规则。
**只有证明相等的那一臂学到东西**。

**健全性**：`flag == true` 为真 ⇒ `flag` 的运行时值是 `true` ⇒ 它是 `bool`，不是
缺席值。反向不成立：`flag != true` 仍同时容纳 `false` 与缺席值，所以否定臂
不留事实 —— 这正是 charter 已经写下的「`if flag:` 的 else 臂什么都不学」的同一
理由，两条规则因此不会互相矛盾。

**边界**：已经是 `bool` 的位置不记事实。多记一条事实只会给之后每次读买一个
运行时重查（FLW-N8 的成本），却证明不了任何新东西 —— 发射产物零 `__velarNarrow`
的断言在测试里。

### FLW-N2 —— `v.a?.b != null` 蕴含 `v.a != null`

**选择**：产生了非空值的可选链证明链上每一环都在场。取这个事实。

**健全性**：可选链在遇到缺席环时**恰好**短路为 `null`。所以整链结果非空
⇒ 没有任何一环缺席。反向（`== null` 那一臂）证明不了任何东西：任何一环缺席都
产生同一个 `null`，看不出是哪一环 —— 测试对两个方向都断言了。

**实现**：复用既有的 `optionalExecutionNarrowings`（「这个表达式确实执行了」的
事实集），只在证明非空的那一臂并入。链根是标识符时同样成立
（`if v?.a != null:` 收窄 `v`）。

### FLW-S1 —— 不可 break 的 `while` 保留否定事实

**选择**：把原来门控在「体总是 return」上的那条路径放宽到「本循环没有自己的
reachable break」—— 即 charter §9 已经暗示的读法。同时把带出的事实定义为
**入口测试与回边测试两者的并集**。

**健全性**：没有 break 时，离开循环的唯一方式是条件测试失败。条件测试发生在
两个状态之一：0 次迭代（入口状态）或 ≥1 次迭代（回边状态）。出口事实因此是
两次测试各自证明的并（join）。只取第一遍的答案是不健全的 —— 体可能把绑定
写宽；测试 `[FLW-S1] the fact carried out is what both condition tests prove`
用的正是那个形状：入口证明 `string`，回边证明 `string | bool`，带出 `string | bool`。
只有一遍存在时（回边不影响任何事实）第一遍就是全部答案。

`continue` 是回边不是出口，仍保留事实；嵌套循环的 break 属于那个循环，不影响
外层 —— 两者都在测试里。

**顺带修的既有缺陷（见 §4）**：这条依赖「体里的赋值确实作废外层事实」，而当时
不成立。

### FLW-N6 —— 事实跨 break 边

**选择**：**实现了，但只对 `while true:`**，并说明为什么这不是取巧的边界而是
唯一有内容的情形。

**健全性**：循环后的状态是所有出口状态的合并。出口有两类：条件测试失败，和每一条
break。`applyFlowInvalidations` 已经把每条 break 的作废并进去了，所以此时还站着的
事实是所有路径都没作废的；`persistNarrowings` 只增不减，因此再并上「所有出口都同意」
的事实集仍然健全。取所有 break 的 `commonNarrowings`，第一遍与回边重分析两遍的
break 都要参与（回边状态下 break 可能证明更少 —— 有测试）。

**为什么只有 `while true:` 有内容**：条件可失败的循环，其正常出口不带任何 break 的
事实，因此 `commonNarrowings` 必然把它删掉 —— 结论恒为「什么都不带出」。`for` 同理
（空集合直接跳过循环体）。只有 `while true:` 没有正常出口，breaks 是它全部的出口。
所以这条规则的可说版本是：**`while true:` 的 breaks 是它唯一的出口，每条 break 都
证明的事实在循环后成立；有一条 break 证明得少，就什么都不带出**。charter §9 已成文。

### FLW-S2 —— 无用的 getter 检查

**选择**：两处都改。写在 getter 上的收窄检查**在它所在的行**被诊断；随后那次读
不再教 `?.`（会二次求值 getter），改教 `const` 绑定。

**健全性/精度**：诊断只在检查**本可以收窄**的形状上开火 —— 主语类型是 optional
（或类型测试下的 union）。返回单一具体类型的 getter 是被测试而不是被收窄的，保持
沉默（`if box.ready:` 干净）。覆盖 `!= null`/`== null`、`== true`/`== false`、
裸 `bool?`、`is T`、`assert`、静态 getter。全仓无 optional 类型的 getter，
故迁移面为零（见 §5）。

**教的拼写**：`const label = box.label`，即 charter §5 早已写下的那条边界的
具体拼写。

### FLW-N4 —— 从当前行为重新推导

**先复验**（账本证据确已过期）：

| 形状 | 今天的行为 |
|---|---|
| `x in c`（`x: string?`, `c: List<string>`） | 干净编译（记录的可赋性诊断确已消失） |
| `if x in c: return x` | `Cannot assign string? to string` —— 不收窄 |
| `x in Map<string, number>` / `Set<string>` / `string` | 干净，同样不收窄 |
| `x in List<string?>` | 干净且不收窄（正确：null 可以是元素） |

**结论**：**接受行为是对的，沉默不是**。`string?` 与 `string` 有交集，所以那条
可赋性诊断本就不该在；它的消失是对的。剩下的错处是：charter §4 明写
「成员探测一次问一个元素的 `==` 问题」，而 `==` 会把事实带回主语，`in` 却不带。

**选择**：让 `in` 收窄。`x in c` 为真 ⇒ 某个元素与 `x` 相等 ⇒ `x` 是容器
元素/键类型。

**健全性**：直接来自 charter 已经写下的成员探测语义。`List<string?>` 不收窄，
因为缺席值本就是合法元素 —— 规则自动给出正确答案，不需要特例。否定臂什么都不
证明（任何一个元素都可能是没匹配上的那个），`not in` 则在它自己的落空路径上
证明同一件事 —— 三个方向都有测试。

charter §5 新增一段，把布尔字面量相等、成员探测、可选链三条一起写成「等式把事实
带回主语」的同一族。

---

## 3. MOD-U3 / D38 第 49 条 —— `import type`

**探针复现**：`import type {User} from "./x.vel"` → `Expected 'from' after imports`。

落地按 D38 第 49 条逐项：

1. **语法**：`import type {User, Status as S} from "./x.vel"` 与
   `export type {User} from "./x.vel"` 合法。`type` 仍是软关键字：
   `import type from "./x.vel"` 依旧读作名为 `type` 的默认导入，
   `const type = ...`、`type Row:` 都不受影响。行内混写
   （`import {loadUser, type User}`）按裁定拒绝并指引拆两行；命名空间形式、
   默认形式、`import js type` 各有定向消息。
2. **检查**：type-import 的名字只在类型位解析。值位一律拒绝并带
   `velar fix` 可应用的机械改写（删掉 `type`）。
3. **模块环放行**：type-only 边不进初始化顺序图。测试用同一对模块做对照：
   普通导入的回边给 `VEL3019`，`import type` 干净。
4. **发射**：type-only 声明不发射任何东西 —— 只被 type-only 边到达的模块
   根本不加载，验证器不进产物（断言 `result.code` 不含目标模块）。
5. **双向规则**：**只落地了一个方向**，另一个方向作为规格落差上报，见下。
6. **迁移**：全仓无一处需要改写（见 §5）；charter §12 与两份 ai-skill 补齐。
7. **回归**：六个 `[MOD-U3]` 用例。

### 规格落差（必须裁决）—— 第 49 条第 5 项的正向

D38 第 49 条第 5 项要求双向：type-import 名字用于值位 → 反向教（已落地，就是
第 2 项）；**普通导入的名字若全部用途都在类型位 → 诊断教 `import type`**，
并把两个方向都归入第 48 条自动修复类。

**正向没有落地，因为它在 Vel 里不是一次保语义的机械改写。两条独立理由：**

1. **它会静默拿掉一条运行时边。** charter §12 现有一句：「An unused import is not
   an error… **The import still runs the module**, so a module imported only for
   its initialization side effects behaves exactly as written.」把一个普通导入
   改成 `import type`，按第 4 项该模块就不再加载 —— 求值顺序变了，只为初始化副作用
   而存在的导入被删掉了。这不是拼写改动。
2. **「全部用途都在类型位」在 Vel 里不能由语法判定。** Vel 的类型是带验证器的值，
   所以**类型位的用途也可能需要运行时验证器**：被该类型标注的值一旦被收窄读取，
   重查就要拿这个类型的验证器。本波实测过这条 —— 早期实现里
   `import type {User}` + `if user != null: return user.name` 编译干净、运行时
   `ReferenceError: User is not defined`（已修：这类读取现在按值位拒绝）。也就是说
   一个「全部用途都在类型位」的名字改写成 `import type` 之后可能**编译不过**。
   判定它需要分析结果而不只是语法，改写也就不再是确定性的。

**建议**：正向作废，或降格为不改变加载行为的编辑器提示（且必须排除任何会触发
运行时验证的用途）。charter §12 已按现状成文：「An ordinary import of a name used
only in annotations stays legal and keeps its runtime edge — the import still runs
the module, and demanding the type-only spelling there would silently stop it from
running.」若用户裁决要正向，需先裁决它与上面那句 charter 承诺的取舍。

**同时记录一处裁定文本的扩张**：第 49 条第 2 项举的值位是 `User.parse`、
`value is User`、传参。实测这三项之外还有两个：`case User:` 类型模式，以及
上面说的**被收窄读取**。两者都用同一条消息和同一个修复，属于第 2 项那句
「runtime validation needs the value import」的字面覆盖，不算改设计。

---

## 4. 顺带发现并修掉的缺陷（不在任务书里）

### 写不作废被遮蔽的收窄影子（HEAD 上已存在）

**探针**（在 `4951db3` 与 `450a13c` 上行为相同）：

```velar
def read(initial: number | string | bool) -> string:
    let value = initial
    if value is not bool:
        while value is number:
            value = true
        if value is number:
            return "n"
        return value.upper()
    return ""
```

**当时**：编译零诊断，运行时 `NarrowingError`。

**根因**：收窄检查会在它进入的作用域里安装一个绑定影子；`while` 的条件收窄同一个
名字时，循环体又装了一层。赋值只清最内层那个影子（`invalidateAssignmentNarrowings`
走 `this.lookup(name)`），体作用域一弹出，循环所在作用域那个仍然带着已被写falsified
的事实。属于「失败关闭但太晚」：charter 承诺的运行时重查兜住了，编译期没兜住。

**修法**：赋值现在清掉同一存储位置的**每一层**影子。这是纯保守方向（只会多作废、
不会少），零现有用例受影响。FLW-S1 依赖它 —— 否则那条新持有的事实是建在沙上的。

### 被拒绝的 `is` 检查仍在收窄

实现 MOD-U3 时暴露：`raw is User` 被拒绝后仍建立事实，于是被守护体里每一次读
都把同一个错误再报一遍。现在被拒绝的检查不建立事实，一处错误一条诊断。

---

## 5. 迁移落差（穷举）

- `tests/compiler.test.ts` `0.5`：三个标准库导出计数 +1（`Text.normalize`）。
- `tests/compiler.test.ts` "getter results are not stable narrowing locations"：
  断言 `/optional access/` 出现 1 次的那行改为 0 次，并逐字断言 FLW-S2 的两条新消息。
- `tests/hardening-audit-runtime.test.ts` `[MOD-I1 + BRG-D1]`：该用例把
  `import type` 当作「尚不是拼写」的恢复形状。拆成两半：`import unsafe` 仍断言
  `VEL2001`；`import type` 现在断言诚实的 `has no export named 'User'`，并断言
  type-only 依赖记为 `typeOnly: true`（不再是空依赖表 —— 类型确实来自那个模块，
  只是不带运行时边）。
- **源码零改写**：全仓无 optional 类型的 getter（FLW-S2 因此零站点），
  也无一处普通导入需要变 `import type`（正向未落地，且即便落地也无站点）。
  `examples/`、`packages/*/src/*.vel`、charter/文档围栏均未改。

---

## 6. 门禁（逐字尾部）

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
ℹ tests 1083
ℹ suites 0
ℹ pass 1083
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 165215.832542
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

（1053 → 1083：本波 `tests/hardening-wave-z2.test.ts` 30 例。）

### `npm run test:browser`

```
30 passed, 0 failed
✓ chromium :: src/app.browser.test.vel :: flow board crud and persistence
✓ chromium :: src/app.browser.test.vel :: search and lazy analytics route
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

三个门禁各跑一次通过，无需重跑 —— 未见与并发波次串扰的迹象。

---

## 7. 待用户裁决

1. **D38 第 49 条第 5 项的正向**（普通导入全类型位 → 强制 `import type`）：
   见 §3。建议作废或降格；若保留，需先裁决它与 charter §12「导入仍然运行模块」
   那句承诺的取舍。
2. **FLW-N6 的边界成文**：本波把它实现为「`while true:` 的 breaks 是它唯一的
   出口」。条件可失败的循环恒为空结论（§2 有论证），所以没有别的可实现的内容 ——
   若用户认为账本条目的意图更宽，需要重新裁决它到底要什么。
