# D56 附录 —— 展示的章节清单与硬约束

D56 第 128-133 条的实施规格。章节切分与四条硬约束由一次系统推导得出
（2026-08-15，读编译器表格 + 实测探针，非估计）。

---

## 四条硬约束（实测，决定目录形态）

### 1. `velar check` 不检查从 entry 不可达的 `.vel`

实测：带明显类型错误的 `orphan.vel` 放进项目，门禁绿。只有 `*.test.vel`
走第二遍（`packages/cli/src/cli.ts` 的 `projectTestModules`）。

**后果**：D56 第 130 条「展示即门禁语料」**不会因为把文件放进目录就成立**。
`check:format` 按目录遍历，格式那一半自动成立；**编译那一半不自动成立**。
所以**每章必须至少导出一个名字，`main.vel` 逐个具名导入**
（裸副作用导入被 charter §12 禁止）。

### 2. Core / Web 的分界是 7 个 node-only 模块

`velar/terminal`、`velar/serve`、`velar/fs`、`velar/process`、`velar/env`、
`velar/host`、`velar/path` 在 web 项目里被拒；web 模块在 Core 项目里得
`VEL6003`。**凡 Core 能编译的一律进 `core/`，`web/` 只放 Core 编译不了的。**

Core-universal 的 6 个模块（`velar/collections`/`id`/`log`/`test`/`time`/`url`）
与四个常驻命名空间在 web 下也可用 —— **只放 `core/`，`web/` 不重复**。

### 3. 四个模块只能经前缀覆盖，不能经 import 覆盖

`velar/math`、`velar/json`、`velar/text`、`velar/async` 的全部成员已进常驻
命名空间，`import` 它们得 VEL3008。**必须按 `Math.` / `Json.` / `Text.` /
`Promise.` 前缀去覆盖。** 覆盖门禁若按「模块 → import 行」建索引，这四个全体误报。

### 4. `velar/http` 在两个目标下导出集不同

node 有 `secretHeader`，web 有 `formBody`，其余 16 项共享。
**覆盖必须按 (模块, 目标) 建键，不能按模块名。**

---

## `examples/tour/core/` —— Core 项目（`extensions: []`）

`velar.json` + `main.vel`（逐个具名导入下列每一章）+ 17 章：

| 文件 | 主旨 | 权威来源 |
|---|---|---|
| `01-values.vel` | 注释族、缩进块、续行、全部字面量与字符串前缀、转义、解构 | charter §2 + §3 |
| `02-operators.vel` | 12 层优先级表全体、比较链、`??`/`?:`/`in`/`is`/`?.` | §4 |
| `03-types-and-optionals.vel` | 类型标注词汇、`readonly` 视图、可选值与全部收窄形态 | §5 |
| `04-records-aliases-enums.vel` | `type` 记录/别名、`Type<T>` 载体、`enum` 全部形态、判别联合 | §6 |
| `05-functions-and-calls.vel` | `def`/箭头/具名实参/rest/async/类型参数与三个约束 | §7（除受检值方法） |
| `06-text-and-numbers.vel` | 字符串与数字的受检方法 + `Text.` 23 项 + `str`/`number` | §7 尾 + 常驻表 |
| `07-list-set-map.vel` | `List`/`Set`/`Map`/`Record<T>` 每个成员与迭代顺序 | §8 |
| `08-collections-and-math.vel` | `velar/collections` 27 项 + 前奏 `range` + `Math.` 30 项 | §8 尾 + 常驻表 |
| `09-control-flow.vel` | `if`/`match` 全模式语法/五种 `for`/`while`/`async for` | §9（除拥有的资源） |
| `10-classes-and-ownership.vel` | `class` 全体修饰符 + `@dispose:` + `using` | §9 尾 + §10 |
| `11-errors-and-assertions.vel` | `try/catch/finally`、9 个错误类、`try` 表达式、`assert` | §11 |
| `12-modules.vel` + 3 个邻居 | import/export/再导出/`export let` 活绑定/动态 `import()` | §12 前半 |
| `13-javascript-boundary.vel` | `extern module` + `import js` + `import js unsafe` + `any` | §12 尾 + §18 |
| `14-files-and-host.vel` | `velar/fs`/`path`/`env`/`host`/`id`/`time`/`url`/`log` | 标准库边界 |
| `15-process-and-network.vel` | `velar/process`/`terminal`/`serve`/`http`(node) + `Promise.` + `Json.` | 标准库边界 |
| `16-contextual-names.vel` | 每个上下文关键字**作为普通名字**的七种位置 | §3 该条 |
| `17-testing.test.vel` | `test "…":` + `expect` 九个匹配器（且哪些可用取决于接收者静态类型） | §12 测试 |

**切分理由（不要随意合并）**

1. **01 与 02 分开**：01 是词法器拥有的表面，02 是解析器的优先级表。
   第 130 条的格式化器语料收益几乎全落在 01 —— `velar format` 的定界符选择表
   只有在一个文件里并排放十几个字符串才被走到。
2. **06 与 02 分开**：字符串/数字成员是**编译器拥有的方法**而非运算符，
   `Text.` 是这一族的延伸。
3. **07 与 08 分开**：`List.map` 是受检方法，`velar/collections` 没有 `map`
   却有 `groupBy` —— 两张表长得像但归属不同，合并会让门禁分不清一个 `sortBy`
   属于哪张表。
4. **`using` 必须跟 class 走**：`@dispose:` 是类成员，`using` 读的是静态类型的
   释放契约，拆开会重复声明同一个类。
5. **12 需要邻居文件**（`12-modules-dependency.vel` / `-barrel.vel` / `-lazy.vel`）：
   再导出、`export let` 活绑定、`await import(...)` 都需要真实的第二个模块。
6. **13 用 `node:` 说明符**：`extern module "node:crypto"` + `import js` +
   `import js unsafe` 实测全部 clean，项目驱动跳过 `node:` 前缀的存在性探测，
   所以 `js`/`unsafe`/`extern`/`module` 四个硬关键字**不需要任何第三方依赖**就能示范。
7. **14 与 15 按能力域分不按字母序**：14 是同步/文件系统族，
   15 是「拿到句柄再释放」族（`using` 与 `async for` 的真实站点）。
8. **16 独立成章**：charter §3 那条是关于整张关键字表的横切声明
   （七个位置），散着写门禁看不见，集中写才能逐项断言。
9. **17 必须是 `.test.vel`**：`test "…":` 只在该后缀顶层成立
   （`VEL3019`）。

## `examples/tour/web/` —— Web 项目（`extensions: ["@velarscript/web"]`）

`velar.json`（含 `web.publicConfig`，`velar/config` 的前置条件）+ `main.vel` + 13 章：

| 文件 | 主旨 |
|---|---|
| `01-components.vel` | `component` 声明面：props、`exposes`/`expose`、`Component<…>`、片段、`host` |
| `02-jsx-directives.vel` | 指令表：`on:`(+5 修饰符)、`class:`、`bind:`(4 种)、`ref`、`key`、`look`/`look:`/`style:`、`unsafe:html` |
| `03-state-and-derived.vel` | `state` 三种作用域 + `computed` + `watch` 三种写法 |
| `04-resources-and-actions.vel` | `resource` 五字段 + `action` 两字段 + 模块级 action |
| `05-lifecycle-and-mount.vel` | `@mounted:` `@cleanup:` `mount` `tick` |
| `06-look.vel` | `look:` 字面量：20 builder、17 公开类型、13 单位后缀、9 `@状态`、7 `@目标`、5 媒体主语、单位算术、spread |
| `07-look-motion.vel` | `keyframes:` 停靠语法 + `animate(...)` 四张闭集 + `transition` |
| `08-look-escape.vel` + `before.css` + `after.css` | `import css unsafe … before/after look` + 层叠优先级 |
| `09-routing-and-app.vel` | `velar/web` 15 项 + `velar/app` 2 项 + `velar/config` 3 项 |
| `10-browser-forms-files.vel` | `velar/browser` 28 项 + `velar/forms` 14 项 + `velar/files` 4 项 |
| `11-storage-realtime-http.vel` | `velar/storage`(含 `scope`/`database`) + `velar/realtime` 2 句柄 + `velar/http` 的 `formBody` |
| `12-unit.test.vel` | 组件单元测试：`tick()` 观察一次状态写入 |
| `13-browser.browser.test.vel` | `velar/web-test` 全部 4 个控制器约 32 个成员 |

**切分理由**：01/02 是声明面与指令面两张互不重叠的闭表；03/04 是同步反应式
与带异步生命周期的两族；06/07/08 是属性与条件、`keyframes` 停靠、外部资源
三套语法（08 还必带两个 `.css` 兄弟文件）；09-11 按模块族分而非按主题 ——
它们唯一的职责是把 web 侧 11 个模块的每个导出走一遍。

## `examples/tour/desktop/`（D56 第 132 条）

3-4 章覆盖 `velar/desktop` 15 导出 + `velar/desktop-test` 6 导出：
`01-desktop-host.vel` / `02-project-tasks.vel` / `03-desktop-test.test.vel`。

---

## 豁免（D56 第 133 条，理由已裁决）

| 族 | 豁免理由 |
|---|---|
| charter §19「刻意缺席」全表、`forbiddenSourceIdentifiers`(14)、web `forbiddenIdentifiers`(4) | **反向语料** —— 只在拒绝里可观察，编译得过的展示写不出来。归 `tests/corpus/` |
| 4×3 授予表的「无约束」行 | `boundGrants(null, …)` 恒 false，只在报错里可见 |
| Look 的 36 个被排除属性 + 10 个被排除媒体主语 | 同上 |
| 枚举/类的保留成员名（`is`/`parse`/`values`/`pass`/`constructor`） | 同上 |
| `velar.json` 的配置词汇 | 不是**源语言**拼写；两个 `velar.json` 是语料，但门禁不该扫它们 |
| `velar/javascript`、`velar/text-buffer` | 已迁出 `velar/*`，现为普通 npm 包，不属于标准库词汇表 |
| 「指向真实第三方 npm 包的 `import js`」 | 仓库无第三方运行时依赖；`node:crypto` 覆盖了那四个关键字 |

**另一类豁免是「被执行」而非「被书写」**：`velar/host.exit`、`serve`、
`process.start`、`terminal.close`、`browser.open`、`files.download` 等能力调用
**必须写在不被调用的 `def` 里** —— 否则 `velar run` 会真的开端口、起子进程。

**已确认不需要豁免**：40 个硬关键字**全部有归宿，零豁免**
（推导时曾猜 `enum` 需要豁免 —— 不需要）。

---

## 推导中发现、尚未处置的语言问题

1. **`velar/fs` 的 `Blob`** —— 已由 D57 第 137 条退役。
2. **`velar/web-test` 在普通模块无门禁** —— 已由 D57 第 138 条封住。
3. **常驻命名空间可被遮蔽** —— 已由 D57 第 135 条修复。
   **注意其对覆盖门禁的连带影响**：门禁若用文本检索断言「`Text.slug` 出现在
   展示中」，一个把 `Text` 定义成局部记录的文件就能伪造覆盖。第 135 条落地后
   该伪造已不可能，但**门禁仍应按解析后的引用判定**。
4. **VEL6003 的模块清单** —— 已由 D57 第 136 条标注。
