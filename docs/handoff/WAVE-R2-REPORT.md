# 波 R2 报告 —— D50 第 89/90/92 条（分支 `wave/r2`，基于 `aef9e9b`）

三项裁决全部落地：错误可判别性（第 89 条）、纯计算全部常驻（第 90 条）、
死表面清理（第 92 条）。三道门禁全绿，逐字尾部见文末。

---

## 第 89 条 —— 错误的可判别性

### `code` 的实现：一处真相，不可能分叉

`code: string` 加入 checked `Error` 契约（与 `name`/`message`/`stack`/`cause`
并列）。它**不是储存的属性**：analyzer 记录「在 Error 契约上读 `code`」的成员
span，emitter 把该读降级为 `__velarErrorCode(value)`，运行时读回实例**自有的
`name` 属性** —— 也就是第 74 条的类降级写进去的那一个 —— 没有则回答 `"Error"`。

```js
function __velarErrorCode(value) {
  if (value === null || typeof value !== "object" && typeof value !== "function") return "Error";
  const descriptor = __velarErrorGetOwnPropertyDescriptor(value, "name");
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" && descriptor.value.length > 0
    ? descriptor.value
    : "Error";
}
```

因此二者**共用同一处真相**（类降级写 `.name` 的那一行），分叉在结构上不可能。
三个既有内建（ValidationError/NarrowingError/IndexError）和模块类
（HttpError 等）都在构造函数里写 `this.name`，所以同样命中。跨模块已验证
（`tests/hardening-wave-r2.test.ts` 的第一个用例跨函数边界传 `Error` 再读）。

**宿主错误**：原生 `TypeError` 的 `name` 在原型上而非自有属性，因此 `code` 是
`"Error"` —— 正是裁决表格「无包装则 `Error`」那一格，也正是它在 Vel 里唯一为真
的 `is` 事实。副作用是它同时挡住了冒充：Node 的 fs 错误自带 `.code === "ENOENT"`，
若把 `.code` 降级成裸属性读，Vel 程序会读到宿主 errno 词汇；投影读 `name` 使之
不可能。

### 抛错点反查表（方法学：反查代码而非想象）

走查范围：`packages/cli/src/standard-modules.ts` 全部核心模块运行时源、
`packages/node/**`（filesystem/http/serve/process/terminal/environment/host/
node-host/三个 worker）、`packages/web/**`（runtime.ts + runtime-foundation.ts）、
`packages/desktop/**`（compiler.ts 的模块源 + test-runtime.ts）。

抛错点按「**调用方会写出不同恢复逻辑**」归组，结果是四组：

| 组 | 抛错点形态 | 数量级 | 类 | 理由 |
|---|---|---|---|---|
| A | 实参形状/预算违例（`readText requires a file path`、`cannot exceed 16 MiB`…） | 数百 | 无 | 恢复只有一种：改代码。分类不会产生第二条恢复路径 |
| B | 宿主协议违例（`host returned an invalid result`） | 数十 | 无 | 同上，且不可恢复 |
| C | 能力不可用（`The browser URL API is unavailable`） | 数十 | 无 | 同上 |
| D | **环境失败** | 见下表 | 五个类 | 每个对应一条不同的恢复路径 |

D 组逐条（**每个类都有真实抛错点**）：

| 抛错点（文件:形态） | errno | 类 | 为什么与其他类不同 |
|---|---|---|---|
| `node-host-worker-runtime.ts` `regularFile()` → `stat`/`readFile`（`fs.readFile`，即 readText/readBlob） | ENOENT | `FileNotFoundError` | 建它，或退回默认值 |
| 同上 `readdir`（`fs.list`）、`realpath`（`fs.canonical`）、`rename`/`copyFile` 源、`rm`（`fs.removeFile`）、`fs.replaceFileIfMatches` | ENOENT | `FileNotFoundError` | 同一恢复 → 同一个类 |
| 任一 fs 系统调用被拒 | EACCES / EPERM | `PermissionError` | 重试无用，只能上报操作者 |
| `startServer()` → `server.listen` 绑定特权端口 | EACCES | `PermissionError` | **同一恢复**，所以复用同一个类（这也是它们必须是全局可命名而非模块导出的实证） |
| `readdir`/`stat` 目标是文件或路径中段是文件（`fs.list`） | ENOTDIR | `NotADirectoryError` | 路径指向的是文件 —— 改走文件分支 |
| `writeFile(..., {flag:"wx"})`（`fs.createFile`） | EEXIST | `FileExistsError` | 换个名字，或显式 replace |
| `absent()` 预检（`fs.copyFile`/`fs.move` 未 replace） | 显式 EEXIST（新增 `AlreadyExists`，携带 code/path） | `FileExistsError` | 同一恢复 → 同一个类；预检与 errno 两种拼写现在携带同一证据 |
| `startServer()` → `server.listen` 端口被占 | EADDRINUSE | `AddressInUseError` | 换端口，或用 `0` 取任意空闲端口 |

字段：四个文件系统类携带 `path: string?`（恢复第一步永远是「哪一个」）；
`AddressInUseError` 不带字段 —— 「换个端口」不需要 message 之外的任何东西，
不为对称造字段。

**落地路径**：worker 的 `errorRecord()` 按 errno 映射类名（+ `path`），
`__velarNodeHostErrorOf()` 在应用 Realm 内重建编译器自有的类（沿用
`HttpTransportError` 既有先例：只有类名与字段穿过边界，特权对象不外泄）。
类本体住在 `velar/compiler-runtime-errors-v1`，与三个既有内建同规接线：
analyzer classes map + `builtin()` classConstructor + `coreReservedBindings` +
不可被继承 + emitter 身份映射（含 shared-runtime 与内联两条路径）。

### 定案时驳回的候选（附理由）

| 候选 | 判定 | 理由 |
|---|---|---|
| `velar/env` 的 `require(name)` 缺失 | 不设类 | 想恢复的调用方写 `get(name)` 拿 `null`；`require` 就是「不可恢复」的拼写 |
| `velar/process` 非零退出 | 不设类 | 根本不抛 —— `run` 返回 `{code, signal, stdout, stderr}` |
| `velar/process` spawn 失败（命令不存在） | **报告，未实施** | 恢复确实不同（装工具），但 worker 把它并进通用 `task.terminate` 失败路径且不带 errno；要分类须新增 worker 协议字段，而现有测试无法把它与「子进程崩溃」区分开。属于「不为想象造类」的边界，交由裁决 |
| `velar/http` 的 `RequestFailedError`/`NetworkError`/`TimeoutError`（裁决预期形态） | **已由既有类满足，未改名** | `HttpError`（带 `status`/`url`/`body`）、`HttpTransportError`（带 `phase`）、`HttpAbortError`（带 `reason: cancelled|timeout`）一一对应。改名会churn 一个公开面而不带来任何新的恢复能力；裁决原文「实施者按实际抛错点定案，多退少补」授权此判断 |
| `velar/serve` 请求体超限 | 已有 `RequestBodyTooLargeError`（带 `maxBytes`） | 无需新增 |
| `velar/storage`（Web）配额耗尽 | **报告，未实施** | 恢复确实不同（清理后重试 / 退回内存），但抛错点是浏览器的 `setItem`，名字跨引擎不一致（`QuotaExceededError` vs Safari 的 legacy code 22），且没有确定性测试能产出它。列为不确定项 |
| 桌面 `velar/fs` | **报告，未实施**（见讨论区） | 走外部原生 bridge，其错误协议在本仓库之外 |

---

## 第 90 条 —— Json 补全、Text 建立、deepEqual 退役

### `deepEqual` vs `equals` 实测差异

探针直接加载两份运行时实现（`__velarEquals` 来自 collection-lowering 模块，
`deepEqual` 来自 velar/json 模块源）逐例对比，**逐字输出**：

```
NaN vs NaN                     equals=true             deepEqual=false
[NaN] vs [NaN]                 equals=true             deepEqual=false
-0 vs 0                        equals=true             deepEqual=true
[-0] vs [0]                    equals=true             deepEqual=true
{a:1} vs {a:1}                 equals=true             deepEqual=true
key order {a,b} vs {b,a}       equals=true             deepEqual=true
Set of records                 equals=true             deepEqual=false
Set of numbers                 equals=true             deepEqual=true
Map record keys                equals=true             deepEqual=false
Map record values              equals=true             deepEqual=true
cyclic self-reference          equals=throws(TypeError) deepEqual=false
depth 600 nesting              equals=true             deepEqual=false
depth 1200 nesting             equals=throws(TypeError) deepEqual=false
class instance same shape      equals=false            deepEqual=false
undefined vs null              equals=true             deepEqual=false
symbol field vs plain          equals=throws(TypeError) deepEqual=false
Date vs Date                   equals=false            deepEqual=false
str vs String object           equals=false            deepEqual=false
frozen record                  equals=throws(TypeError) deepEqual=true
null-prototype record          equals=true             deepEqual=true
```

逐条判读：

| 差异 | 判读 | 处置 |
|---|---|---|
| `NaN` | `equals` 用 SameValueZero，与 D42 定案的 `==` 一致；`deepEqual` 与语言的相等语义相矛盾 | 删 |
| `-0`/`0` | 无差异 | — |
| Set 成员 / Map 键为结构值 | `deepEqual` 只用原生 `has` 身份匹配，`equals` 做单射结构匹配 —— `equals` **严格更强** | 删 |
| 512 层以上嵌套 | `deepEqual` 静默答 `false`（600 层完全相同的结构被判不等 —— 一个**错误答案**）；`equals` 答真值直到 1000 层再抛 | 删 |
| 环 | `deepEqual` 静默 `false`；`equals` 抛（与 stringify 同一立场，D47 已裁） | 删 |
| 冻结记录 / 带 symbol 字段 | `equals` fail closed（不是合法 Vel 记录）；`deepEqual` 放行 | 删 —— 这些值只能经 JS 互操作进入，而 `equals` 的静态域检查本来就拒 `any`/`unknown` |
| `undefined` vs `null` | `equals` 归一（Vel 没有 `undefined`）；`deepEqual` 答 false | 删 |

**结论：`deepEqual` 没有任何 `equals` 不具备的比较能力**，每一处差异都是
「`equals` 正确 / `deepEqual` 给出更弱或错误的答案」。因此**直接删除，不扩展
`equals`**。唯一一处 `deepEqual` 能做而 `equals` 不能的事是**静态上接受
`any`/`unknown`** —— 那不是比较能力，而是绕开 D47 第 81 条的 parse-first 纪律，
删掉它恰好把纪律补回来（讨论区已记）。

### Json / Text 常驻

- `Json.` 补全为全量六员：`parse`、`tryParse`、`stringify`、`stableStringify`、
  `clone`、`isSerializable`。`velar/json` 的具名导入全部退役（沿用批次 K 的
  `permanentNamespace` 机制与诊断文案）；`deepEqual` 从接口与运行时一并删除，
  `deepEqualRuntime` 不再进 velar/json 的产物（体积净减）。
- `Text.` 常驻命名空间建立，收纳 `velar/text` 的**全部** 20 个既有导出，
  加 `codePoint`/`fromCodePoint` 共 22 员。核心字符串方法表**一个都没动**
  （不新增、不迁出），法律一句话已写进 charter 与简报：
  **字符串方法是核心操作，`Text.*` 是扩展工具箱**。
- `Text.codePoint(char) -> number?`：恰好一个码点才回答，空串/多字符/**落单代理
  半体**一律 `null`。`Text.fromCodePoint(number) -> string`：范围外抛 RangeError，
  **代理半体拒收**，所以没有任何调用能造出不是字符序列的文本。
- 能力模块零回归：测试断言常驻集合恰为
  `["velar/async", "velar/json", "velar/text"]`（Web 的 `Look` 由扩展登记），
  且 collections/math/url/time/id/log/test 全部无 `permanentNamespace`。

---

## 第 92 条 —— 死表面

| 项 | 处置 |
|---|---|
| `Opacity` | **已删**。先验证不可达：无任何 builder 产出它，`opacity` 属性的声明类型在 `look.ts` 的类型表里是 `number`。从 `LOOK_PUBLIC_TYPE_NAMES`、`LOOK_NUMERIC_TYPE_NAMES`、web analyzer 的 `textualWebPrimitiveNames`、runtime 的 `export const Opacity` 四处一并移除 |
| `packages/cli/stdlib/` | **本分支基线 `aef9e9b` 上不存在**（`git ls-files packages/cli/stdlib` 为空）。无可删；若主干仍有残留，是另一波的树 |
| 附带发现：`Opacity` 曾同时被登记在 `textualWebPrimitiveNames` 里 | 一并删除。它的谓词是数值判定，登记为「文本型 Web 基元」本身就是错的 —— 一个不可达的名字被登记在错误的类别里 |

其余「疑似死表面」逐一复核后**不删**（可达，附证据）：`velar/json` 的
`deepEqualRuntime` 仍被 `velar/test` 的 `toEqual` 使用（见讨论区）；
`HttpTransportPhase`/`HttpAbortError.reason` 等 Web/Node 枚举均有真实产出点。

---

## 迁移清单（穷尽）

`.vel` 源（7 个文件）：

| 文件 | 变更 |
|---|---|
| `examples/standard-library.vel` | 删 `import {title} from "velar/text"`；`title(...)` → `Text.title(...)` |
| `examples/flow-board/src/store.vel` | 删 `import {deepEqual} from "velar/json"`；`deepEqual(...)` → `equals(...)` |
| `examples/flow-board/src/domain.test.vel` | 同上 |
| `examples/production-web/src/components/web-capabilities.vel` | 删 text 导入；`matches(...)` → `Text.matches(...)` |
| `examples/production-web/src/components/newsletter.vel` | 删 text 导入；`findMatch(...)` → `Text.findMatch(...)` |
| `packages/script-analysis/src/index.vel` | 删 text 导入；`matches`/`chunks` → `Text.*` |
| `packages/text-buffer/src/index.vel` | 删 text 导入；`lineStarts`/`utf8Size`/`chunks` → `Text.*`（并按格式门禁重排） |

文档（fence 现在全量跑完整分析，173 例全绿）：

- `docs/language-charter.md` —— §11 新增「Discrimination is the class; `code` is
  its string form」小节（含判别示例与五类恢复表）；常驻命名空间小节改写为
  一句法律 + 四命名空间表 + 方法/工具箱分界 + 码点两员。
- `docs/standard-library.md` —— 新增「Two halves of the library」（常驻纯计算 /
  须导入）；`velar/text` → `Text.`（含 fence 去导入）；`velar/json` → `Json.`
  （删 deepEqual 条目与对照段，改写为「内容比较只有一个拼写」）；
  `velar/fs`、`velar/serve` 各新增「Errors it raises」段；`toEqual` 描述改为
  自述其 JSON 形语义并点明它不是 `equals`。
- `docs/ai-skill.md` + `packages/cli/skill/ai-skill.md` —— 常驻段落改写（四命名
  空间 + Text 全员 + 方法/工具箱一句话 + prelude 含 `equals`）；错误段新增判别
  一行与可命名类名单。两份**逐字节相同**（测试强制）。
- `docs/best-practices.md`、`docs/web-api.md`、`docs/compiler-architecture.md`、
  `docs/runtime-boundary.md` —— 清掉全部 `velar/json.deepEqual` / `velar/text.*`
  的过期指称。
- `scripts/check-runtime-boundary.mjs` —— Web 共享错误规范化的导入断言随
  `errorCode` 同步。

测试：`tests/hardening-wave-r2.test.ts`（12 例，全部执行级或项目级）。

---

## 规格 vs 代码的分歧（报告，未擅自改设计）

1. **「每一个纯计算函数都进常驻命名空间」与四命名空间 roster 冲突。**
   `velar/collections`、`velar/math`、`velar/url`、`velar/time`、`velar/id`、
   `velar/log` 都是纯计算，却按 D17/D35 维持显式导入（`time.`/`math.` 不回潮
   是既有裁决）。本波按裁决**明列的四个**落地（Json/Promise/Text/Look），并在
   standard-library.md 里如实写出「其余纯模块仍需导入，因为它们的名字是程序有权
   自己占用的普通词汇」。若用户要的是字面意义上的「全部」，需要一条新裁决。
2. **`deepEqual` 唯一的「独有能力」是静态上接受 `any`/`unknown`。** 裁决说
   「若有 `equals` 不具备的能力则扩展 `equals` 吸收之」。此处未吸收：那不是比较
   能力，而是绕开 D47 第 81 条的 parse-first 纪律；吸收它等于用一条实现细节推翻
   一条已成文裁决。删除即恢复纪律。
3. **`velar/test` 的 `toEqual` 仍用退役的 JSON 形比较实现。**（`deepEqualRuntime`
   因此保留，仅供 velar/test。）实测意味着 `expect(x).toEqual(y)` 在
   NaN、Set-of-records、>512 层嵌套三处会给出与 `equals` **不同**的答案。裁决只点名
   `Json.deepEqual`，`toEqual` 是断言匹配器而非语言拼写，故未改。
   **建议**：下一波把 `toEqual` 切到 `equals` 语义（代价：环与冻结数据由静默
   `false` 变为抛出）。待裁决。
4. **命名空间导入 `import * as text from "velar/text"` 仍合法。** 退役诊断只作用
   于具名说明符（批次 K 对 Json/Promise 亦然）。这留下了同一批函数的第二个拼写。
   **建议**：把 `permanentNamespaceImportMessage` 扩展到 namespace 说明符。未做，
   因为裁决原文只写「具名导入退役」，改它属于新增行为。待裁决。
5. **`Error` 现在同时可读 `name` 与 `code`。** 裁决明确让二者并存并同源
   （「第 74 条已让 Error 子类设置 .name，code 与之同源」），故未删 `name`。
   二者对 Vel 声明的错误恒等；仅对宿主错误分叉（原生 TypeError 的
   `name == "TypeError"`、`code == "Error"`），这正是裁决表格要求的行为。
6. **桌面目标的 `velar/fs`/`velar/process` 不产出新类。** 桌面走
   `__velarDesktopInvoke` 原生 bridge，其错误记录协议（`{name, message}`，只认
   Error/TypeError/RangeError）由仓库外的宿主产生。要让桌面也分类，需要改 bridge
   协议并在宿主侧映射 errno —— 超出本波与本仓库。类本身是全局可命名的，所以
   桌面代码写 `if error is FileNotFoundError:` 合法，只是当前永不为真。待裁决。
7. **`velar/process` spawn 失败未分类**（理由见第 89 条驳回表）。

---

## 门禁（逐字尾部）

### `npm run check`

```
Checked 53 formatted VelarScript source files
Checked 173 VelarScript documentation examples (74 complete, 99 fragments), all under full project analysis
Checked 76 runtime boundary operations and the shared registry, strict JSON, Web DOM, host-event, browser-platform, storage-host, and Desktop-host ABIs
```

### `npm test`

（见文末追加）

### `npm run test:browser`

（见文末追加）

---

## 附：本波额外触及的两处

- **`velar/look` 的公开导出少了一个**（`Opacity`），因此 `standardModuleApi()` 的
  总导出数保持 281 不变：Text +2、Json −1、Look −1。相关断言已同步并写明原因。
- **语言服务补全**：`Text.` 与 `equals` 加入核心补全项，`velar/text`/`velar/json`
  从「可导入模块」补全里移除（它们的具名导入已退役，补全不该再教一个会被诊断
  拒绝的拼写）。
