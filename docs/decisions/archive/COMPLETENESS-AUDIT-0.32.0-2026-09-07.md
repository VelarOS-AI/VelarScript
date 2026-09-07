# 完整性审计 —— 0.31.0 / 0.32.0 与五个公共面（2026-09-07，约 700 个探针）

审计对象：**0.31.0（`dae269c8`）与 0.32.0（`66d43616`）这两版改动的表面**，加上
「五个公共面作为整体」与「门禁与工具」两条横切。范围由 `CHANGELOG.md` 的
`## 0.32.0` / `## 0.31.0` / `## 0.30.1` 三段，与 D114 从「0.30.0 面审计裁决」到末尾的
十七段落地记录（F9-core · F9-web · F9-node-cli · T3b · X · X2 · X3 · `velar.json`
可选 `name` · P4 R3-0/R3a/R3b/R3c/R3d/R3e/R4a/R4b/R4c/R4d-1/R4d-2/R6）划定。
0.31.0 的整条主线是**对 0.30.0 账本的答复** —— 「一个错误一条报告、改法编译得过、
失败是宪章命名的那一类」—— 所以本轮的第一批探针就是把 0.30.0 的每一条 finding
按原样再跑一遍（结果见文末「held」表），第二批才是新句子，第三批才是「整个面」。

方法学沿用 [[COMPLETENESS-AUDITS]] 与 0.30.0 账本：对每个特性面做
**charter / 文档承诺 vs 编译器与运行时行为 vs 作者合理预期** 的逐条对照，目标是
消灭未定义而不是找 bug；DECIDED-AND-CORRECT 必须记录，否则「完整」无法凭失败清单
成立。**消息质量是契约的一部分**：一个错误 → 一条报告 → 那条报告给的改法编译得过 ——
本轮把最后半句变成了一条系统性探针：**每一条给出改法的消息，都把改法逐字贴回源码
再 `velar check` 一次**。

探针在隔离 worktree `/private/tmp/velar-d114/f5-web`（分支 `audit/0.32.0`，HEAD
`0f7d79d8` ＝ 0.32.0 的 main）自己构建的 `dist` 上实测，`velar` ＝
`node packages/cli/dist/cli.js`（`velar 0.32.0 / core@0.8 web@0.14 node@0.17
server@0.15 desktop@0.10`，Node v24.15.0）：

* **Core**：`velar check|run|fix|format <file>`（独立模式）与 `velar create --template
  library` 工程（跨模块、工程图 advisory）。
* **Web**：`velar create --template web` 工程做编译期探针；运行期用仓库自己那套
  document 替身（照抄 `tests/web/web-tick-rejection.test.ts` 的 `FakeNode`，补
  `createElementNS` / `textContent` / 命名空间可见的树打印），经
  `node --input-type=module` 执行 `compileCore(…, {extensions:[velarCompilerExtension]})`
  的产物 —— tick 认领、陈旧读探测器、SVG 区域 fatal 都可观测，**无浏览器**。
* **Node / Server**：`velar create --template node` 工程；HTTP 由 `node:http` /
  `fetch` 宿主脚本驱动，服务器一律 `PORT=0` 并从程序自己的 stdout 读实际端口；
  Worker 投毒用 `--import` 预载（抛错与静默两种）；搬迁攻击按 0.30.0 NO-D1 的原样重搭。
* **Desktop**：`velar create --template desktop` 工程做编译期探针（本轮**没有**驱动
  Electron 宿主，`velar/desktop-test` 的 29 个导出因此未探）。
* **门禁与工具**：六个模板（web · node · desktop · docs · library · component）各自跑
  `velar check|fix|format|test|build|run|dev|serve|repro|skill|graph|verify|package`；
  只读地跑 `check-file-budget` / `check-module-map` / `check-runtime-boundary` /
  `check-surface-versions` / `check-runtime-sources` / `check-fence-format`。
* **面清册**：只读地跑 `scripts/surface-inventory.mjs` 的 `surfaceInventory()`（468
  core / 468 web / 99 node / 12 server / 73 desktop 自有名，0 partition failure），
  把五个面的 `module-export` 项逐个对 `docs/**/*.md` 与八个包 README 做存在性对照。

输出逐字引用。探针文件在会话草稿目录
`…/scratchpad/audit-0.32/{co,wb,no,gt,sv,dt,verify}/`，**不入仓，收尾即删**。

> **本轮的自伤记录（沿 0.29.0 Web 账本的规矩）**：面清册的第一版把
> `retired-spelling` 类（`velar/collections` 的 `sortBy` / `minBy` / `enumerate` 等
> 29 项）当成活的模块导出，于是「219 个 Core 名字没有文档」看起来像一条头条 ——
> 那些名字**本来就该没有文档**，它们是退役拼写；按 `module-export` 类重算之后是 12。
> 同一轮里 `class str:` 的 SVG 探针一度因为替身注册 `errorHandlers` 的时机不对而
> 看起来「fatal 元素没生成」，补正后 WB-D1（0.30.0）的修复被证实为真。替身与脚本的
> 缺陷不是被审对象的缺陷 —— 本轮所有运行时结论都在补正之后复测过。

分类：**DEFECT**（编译通过后崩溃/静默错误，或工具产出坏源码/坏产物）·
**CHARTER-DRIFT**（文档与实现不符）· **INCONSISTENT**（两条相关规则互相矛盾；含：
同一个错误报两次、一个意思两种拼写、**一条消息给的改法编译器随后拒绝**、
**消息点名了错的槽位**）· **UNDEFINED**（文档沉默、行为偶然 —— 记下的实测行为即应
成文的答案）· **DECIDED-AND-CORRECT**（探过且正确 —— 完整性凭证）。

审计面与前缀：**CO** Core 0.8 · **WB** Web 0.14 · **NO** Node 0.17 ·
**SV** Server 0.15 · **DT** Desktop 0.10 · **GA** 门禁与工具。

---

## DEFECT

### NO-D1 —— 0.30.0 的那条安全形状**只对声明了 `name` 的工程闭合**；没声明的工程原样中招

这是本轮最重的一条，也是本文唯一一条安全形状的发现 —— 与 0.30.0 的头条是同一条。

0.31.0 的句子是无条件的：

> so a `dist/` copied beside a stranger's `public/` **no longer serves the
> stranger's files**

身份在没有 `name` 时回落成 `entry:<工程相对入口路径>`，而
`packages/node/src/project-config.ts:87` 的 `nodeProjectIdentity` 把缺失/非串的
`entry` 默认成字面量 `"src/main.vel"` —— **六个模板写的都是这个入口**。于是任何
没写 `name` 的工程与任何带 `velar.json` 的陌生目录身份相符。

编排代理在一个全新工程上从头独立复现（`velar create --template node`，只从
`velar.json` 里删掉 `name` —— 也就是 0.32.0 之前脚手架出来的每一个工程的样子）：

```text
$ tree（要点）
deploy/public/hello.txt      "FOREIGN-sibling-asset"
deploy/public/secret.txt     "FOREIGN-SECRET"
deploy/velar.json            {"formatVersion":2,"kind":"application","entry":"src/main.vel"}
deploy/app/                  ← cp -R nd1/dist
deploy/app/public/hello.txt  "OWN-app-asset"

$ cd /private/tmp && node drive.mjs /private/tmp …/deploy/app/main.js /assets/hello.txt /assets/secret.txt /direct
PORT=3000
/assets/hello.txt  200  "FOREIGN-sibling-asset\n"
/assets/secret.txt  200  "FOREIGN-SECRET\n"
/direct  200  "FOREIGN-sibling-asset\n"
--- STDOUT ---
nd1 is running at http://127.0.0.1:3000
--- STDERR ---
（空）
```

应用自己的 `deploy/app/public/hello.txt` 一次都没被读到；`secret.txt` 是应用从未
发布过的文件；**两条传输都中**（`/assets/*` 走特权宿主传输、`/direct` 走原生
`file()` 路径），零诊断。探针代理另测：原生监听器传输
（`velar/websocket.listen({http: app})`）同款；陌生 `velar.json` 是 **`{}` 就够了**：

```text
$ printf '{}' > deploy/velar.json && node drive.mjs … /assets/secret.txt
/assets/secret.txt  200  "FOREIGN-SECRET\n"
--- STDERR ---（空）
```

**对照组 —— 声明了 `name` 的同一个应用完全正确**（本轮的完整性凭证）：

```text
/assets/hello.txt  200  "OWN-app-asset\n"
/assets/secret.txt  404  {"type":"about:blank","title":"Not found","status":404,"code…
/direct  200  "OWN-app-asset\n"
--- STDERR ---
velar/serve: /…/deploy/app/../velar.json belongs to a different project (entry:src/main.vel, not name:nd1), so relative static and upload roots resolve beside /…/deploy/app instead
```

一条报告、点名两个身份、回落到入口目录 —— 机制是对的，缺的只是「没有 `name` 时
身份是一个常数」这件事没有任何东西挡着。源码自己记着这条残留
（`packages/cli/src/project-format.ts:58-62`：「two projects that both take the
default entry share the identity `entry:src/main.vel`, and either one's output
believes the other's project.」），`docs/standard-library.md:1027-1033` 陈述了身份
规则但没有一句提醒这一格。

### NO-D2 —— 从工程目录以外的任何 cwd 跑 `velar run <project>`，**在原封不动的 node 模板上**就失败

0.31.0 Server 条：

> a relative static root (`file()`, `staticFiles(root="public")`, `fileResponse`)
> resolves against the directory holding `velar.json` under `velar run`,
> `velar dev`, `velar test` and a directory build alike

静态根确实如此。Server 的**配置文件路径**不是：没有烤进产物配置路径时它被逐字使用
（`packages/server/runtime/server-application.js:1-9`、`:91`），而只有目录构建会烤。

```text
$ velar create p1 --template node        # 完全不改
$ cd /private/tmp && velar run …/no/p1
ELAPSED 305ms EXIT 1
--- STDERR ---
velar run: uncaught error while running /…/no/p1/src/main.vel
TypeError: Cannot read server configuration 'application.yml': ENOENT: no such file or directory, stat 'application.yml'
  (2 Node.js internal frames hidden; rerun with 'velar run --stack' for the full trace)
```

从父目录（`velar run p1`）同款。**只有 cwd ＝ 工程目录时可用**（`velar run .` →
`PORT=65237`、`/direct 200`）。同一工程的 `velar dev p1` 与 `velar serve p1` 从
`/private/tmp` 都正常 —— 三条命令里恰好只有 `velar run` 没接上，而
`docs/cli.md:203-205` 讲的是静态根，对配置路径沉默。

### NO-D3 —— 缺失静态根的审计行把 `velar test` 变红

0.31.0：「reports each missing one with its resolved path, **then serves as
before**」。它同时让测试跑失败：

```text
$ velar test n1                 # cwd=/private/tmp
ELAPSED 382ms EXIT 1
--- STDOUT ---
0 passed, 1 failed
--- STDERR ---
velar/serve: static root 'nope' does not name a directory (/…/n1/nope); requests for it answer 404 until it exists
✗ "src/app.test.vel" :: "relative static root under velar test"
an unowned error was reported while this test ran
velar/serve: static root 'nope' does not name a directory (/…/n1/nope); …
```

删掉那个缺失的根：`1 passed, 0 failed`、exit 0。`@velarscript/server` 工程同款。
一条「审计并照常服务」的诊断行成了测试失败的原因。

### GA-D1 —— `velar fix` 留下一个 `velar format --check` 拒绝的文件；模板自己的 `npm run validate` 因此红

条件精确：被删掉的 import 是文件里**唯一**的 import 时。编排代理独立复现
（`library` 模板，先 `velar format` 到绿）：

```text
$ velar format --check lib3
Checked formatting of 1 VelarScript source file          [exit 0]
$ velar fix lib3
…/src/index.vel:1:1 fixed VEL3008: Drop the import; the name needs none
applied 1 mechanical fix in 1 file; 0 diagnostics remain
$ head -c 40 …/src/index.vel | od -c
0000000   \n   e   x   p   o   r   t       t   y   p   e       G   r   e
$ velar format --check lib3
…/src/index.vel is not formatted
1 of 1 VelarScript source file require formatting        [exit 1]
$ velar check lib3
Checked 1 module from …/lib3                              [exit 0]
```

残留是一行前导空行。模板 `package.json` 的 `validate` 是
`format:check && check && test && build`，`docs/getting-started.md:225-229` 的升级
例程是 `--version` → `fix` → `check` —— 走完那条例程之后 `velar check` 干净而
`npm run validate` 红。文件里还有第二条 import 时不复现。

### GA-D2 —— 清单入口文件缺失时，一条 Node 原生 `ENOENT` 串直接进了诊断通道

```text
$ velar create w2 --template web && rm w2/src/main.vel
$ velar check w2
/…/w2/src/main.vel: ENOENT: no such file or directory, stat '/…/w2/src/main.vel'
Run 'velar repro /…/w2' to write a minimal reproduction of this failure.
[exit=1]
```

没有 `:line:column`、没有 `error`、没有 `VELxxxx`、没有源码框，路径**打了两遍**
（第二份是宿主 `stat` 自己那句）。对照 `docs/getting-started.md:140-141`：

> ```src/app.vel:2:12 error VEL1005: Use 'not'; …```
> This is the shape of **every diagnostic** in Vel

同一批探针里缺失的 **import** 恰是文档的形状：
`pr5/src/index.vel:1:18 error VEL6001: Module "./nope.vel" does not exist` 带 caret。

### GA-D3 —— `velar build` 在 `kind: "library"` 工程里**静默销毁**这个包声明的 ABI-1 产物

编排代理独立复现（全新 `library` 模板）：

```text
$ velar build-library lib2
Built Velar library ABI 1 lib2@0.1.0 (core) -> …/lib2/dist/velar-library.json
$ ls lib2/dist
index.js  index.js.map  index.veli.json  velar-library.json

$ velar build lib2
Built production 1 module -> …/lib2/dist          [exit 0]
$ ls lib2/dist
index.js  node_modules

$ node -e 'console.log(JSON.stringify(require("./lib2/package.json").velar))'
{"entry":"src/index.vel","artifacts":{"core":"dist/velar-library.json"},"targets":["core"],…}
```

`velar-library.json`、`index.veli.json`、`index.js.map` 全没了 —— 而 `package.json`
的 `velar.artifacts.core` 正指着第一个，`files` 又把 `dist` 发出去。之后
`velar check`（exit 0）与 `velar test`（`2 passed, 0 failed`）什么都不说。
**反方向是有守卫的**：`velar build-library` 在 web / node 工程里答
`velar build-library: velar.json 'kind' must be 'library' to build a library
artifact`（exit 1）。`velar build` 没有对应的 `kind` 守卫。

### CO-D1 —— 十三个被拒的类名把**后面那段正确的代码**也报错：一个错误两到三条报告

0.31.0 把 extern class 头部并进了 `class` 的名册，并且**新的 extern 位干净**
（24 个名字逐一实测，每个恰一条）。**旧的 `class` 位没有**：

```text
$ cat cls3_str.vel
class str:
    let x: number = 1

@main:
    print("ok")
$ velar check cls3_str.vel
cls3_str.vel:1:7 error VEL3007: 'str' is guided to 'string' in every type position, so it cannot name a class; every use of it would read as 'string'
class str:
      ^^^

cls3_str.vel:5:1 error VEL2002: A statement ends at its newline; this indented line continues nothing — parenthesize an expression to span lines, or align the line with its block
    print("ok")
^^^^
```

第二条指着 `print("ok")` 的**前导空白**，说那一行「什么都没有续上」—— 那一行完全
正确。跟一个 `def` 的时候是**三条**，而且第三条讲了一件不真的事：

```text
$ cat cls9.vel
class str:
    let x: number = 1

def f() -> string:
    return "y"

@main:
    print(f())
$ velar check cls9.vel
cls9.vel:1:7 error VEL3007: 'str' is guided to 'string' …
cls9.vel:5:1 error VEL2002: A statement ends at its newline; this indented line continues nothing …
    return "y"
^^^^
cls9.vel:5:1 error VEL2022: Executable module code must be placed inside the module's '@main' region
    return "y"
^^^^
```

`return "y"` 在一个 `def` 体里，它不是「模块级可执行代码」。

**这一格可以精确划线**（24 个名字 × `class` 位，体为 `let x: number = 1`）：

| 报一条 | 报两条 |
|---|---|
| `int` `float` `undefined` `NaN` `Infinity` `bool` `number` `string` `object` `Object` `Callable` | `str` `Array` `array` `list` `dict` `set` `String` `Number` `boolean` `Boolean` `void` `readonly` `null` |

右栏恰是 0.31.0 那句话点名的集合（「the eleven replacement-carrying spellings and
`readonly`」）加 `null`。同一批名字在 **`type` 位与 `enum` 位同款**（`str` / `Array` /
`readonly` / `null` 各 2 条，`int` 1 条），在**新造的 extern class 位一条都没有**。
控制组 `class Thing:` 同结构 0 条、编译并运行。文件里没有后续语句时也只有一条 ——
触发条件是「被拒的声明后面还有代码」，也就是每一个真实文件。Desktop 工程同款。

### CO-D2 —— `extern class any:` 被收下；`class` / `type` / `enum` / 类型参数四个位都拒它

0.31.0 写：「an `extern class` head is refused through the same roster as `class`」。

```text
$ cat x_any.vel
extern module "text-tools":
    export class any:
        get label() -> string

@main:
    print("ok")
$ velar check x_any.vel
Checked 1 module from …/x_any.vel
```

同一个名字在别的四个声明位各一条：

```text
class any:      → VEL3007: 'any' is not a VelarScript type, so it cannot name a class; an unchecked boundary value is 'unknown', which is what you annotate
type any:       → VEL3007: … so it cannot name a type; …
enum any:       → VEL3007: … so it cannot name an enum; …
type Box<any>:  → VEL4021: … so it cannot name a type parameter; …
```

后果是 0.30.0 CO-D2 记过的形态原样回来 —— **声明写得下、每一个使用被拒、报告全在
使用处，而且把整个 extern 块的其它导出一并判成未知名**：

```text
xa1.vel:5:26 error VEL4001: 'any' is not a VelarScript type; a foreign value arrives as 'unknown', which is what you annotate; declare a type naming the shape you rely on — 'type X:' — then validate first: 'const checked = X.parse(value)' and use 'checked' from there
    export def make() -> any
                         ^^^

xa1.vel:8:15 error VEL3001: Unknown name 'make'
    const v = make()
              ^^^^
```

其余 23 个名字在 extern class 位全部恰一条并带位置名词「extern class」。

### WB-D1 —— Web 的报告通道是**第三个**宿主栈写手，直接读 `failure.stack`

0.31.0：

> Host error traces have one policy, in the compiler runtime's `error.js`
> (`hostErrorTrace`) … The runtime-boundary gate pins the policy and refuses a
> direct `failure.stack` read.

门禁钉的是 `packages/core/runtime/async.js`（`check-runtime-boundary.mjs:1933-1944`），
`error.js` 的头注把范围写成「Everything `velar run` prints goes through this」。
Web 运行时那一路不在里面 —— `packages/web/runtime/foundation.js:20`：

```js
let trace = "An unhandled VelarScript failure was reported";
try { const stack = error.stack; if (typeof stack === "string" && stack !== "") trace = stack; } catch {}
…
__velarFoundationReflectApply(__velarFoundationConsoleError, __velarFoundationConsole, ["Unhandled VelarScript error report: " + trace]);
```

实测（一次刷新里两个失败，第二个无人认领 → 走宿主报告通道）：

```text
--- STDERR ---
Unhandled VelarScript error report: Error: second failure
    at file:///…/[eval1]:4329:9
    at file:///…/[eval1]:2700:30
    at __velarUntracked (file:///…/[eval1]:2219:16)
    at file:///…/[eval1]:2700:7
    at Object.runTracked (file:///…/[eval1]:1203:18)
    at Object.run (file:///…/[eval1]:2282:28)
    at step (file:///…/[eval1]:1126:20)
    at __velarFlushSettle (file:///…/[eval1]:1149:9)
    at __velarFlush (file:///…/[eval1]:1074:9)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
```

`__velarUntracked` / `__velarFlushSettle` / `__velarFlush` 三帧命中策略里的
`__velar` 保留名前缀，`node:internal/process/task_queues` 命中 `node:` 前缀 ——
**恰恰是那条策略明写要隐藏的两类**，一条都没隐藏，也没有那句
「(N frames hidden; rerun with …)」。这是 0.30.0 CO-I6 在 Web 面重演，只是这一次
门禁看不见它。

### DT-D1 —— Desktop 的七条权限诊断没有码、没有行列、没有 caret

```text
$ cat dtapp/src/probe.vel
import {NotificationActivation} from "velar/notification"

@main:
    print("ok")
$ velar check dtapp/src/probe.vel
/…/dtapp/src/probe.vel: Desktop source imports 'velar/notification' but desktop.permissions.notifications is not true
Run 'velar repro /…/dtapp/src/probe.vel' to write a minimal reproduction of this failure.
```

import 就在第 1 行，位置是知道的。同族共七条
（`packages/desktop/src/host.ts:56-85`，覆盖 `velar/fs` · `velar/process` ·
`velar/http` · `velar/env` · `velar/notification` · `velar/secure-storage` ·
`velar/service`），逐条只有一句英文散文，工具拿不到码来分类。规则本身正确
（对应的导入确实该被拒），坏的是报告形状。

---

## INCONSISTENT

> 本节按「一条消息给的改法编译器随后拒绝」「消息点名了错的槽位」「一个错误两条
> 报告」「一个意思两种拼写」四种形态分组，**每一条改法都逐字贴回源码复验过**。

### 一、改法编译不过

#### CO-I1 —— 0.31.0 特意留下的那条别名建议，改法编译不过

0.31.0：「the alias advice survives only when two *different* exports want one
local name」。同拼写与别名两种形态确实合并成了一句（0.30.0 CO-I1 的主体已修）；
保留下来的那一支给的改法用**本地名**当导出名：

```text
$ cat src/index.vel
import {alpha as shared} from "./lib.vel"
import {beta as shared} from "./lib.vel"
$ velar check src/index.vel
index.vel:2:9 error VEL3004: Name 'shared' is already imported from "./lib.vel"; alias one of the imports — import {shared as other}

$ 照做
index.vel:2:31 error VEL6007: Module './lib.vel' has no export named 'shared'
import {shared as other} from "./lib.vel"
                              ^^^^^^^^^^^
```

**跨模块同名的那一格是对的** —— `import {alpha} from "./lib.vel"` ＋
`import {alpha} from "./lib2.vel"` 的建议 `import {alpha as other}` 照做后
`Checked 3 modules`。不对的只有「同一模块、两个不同导出、一个本地名」这一支，而那
正是 0.31.0 特意保留别名建议的唯一理由。

#### CO-I2 —— `Map.x(…)` / `Set.x(…)` 的改法让作者去声明一个 Core 类型名，而那件事编译器下一秒就拒

```text
$ velar check mv2.vel
mv2.vel:2:15 error VEL4001: Cannot access 'get' on unknown without validation; declare a type naming the fields you rely on — 'type Map:' with the 'get' field — then validate first: 'const checked = Map.parse(Map)' and read 'checked.get'
    print(str(Map.get(Map({a: 1}), "a")))
              ^^^^^^^

$ 照做（type Map: / get: string）
mv3.vel:1:1 error VEL3007: 'Map' is a Core type name, so it cannot also name a type; every use of it resolves to the built-in. Rename this declaration
```

同一类错误、四个 Core 集合类型名、**三种诊断**：`List.repeat(…)` →
`VEL3008: Lists are created with a '[]' literal (or [...values] to copy);
'List<T>' is a type name, not a constructor`（正确的那一种）；`Map.x` / `Set.x` →
上面那条把作者引进死路的 VEL4001；`Record.x` → `VEL3001: Unknown name 'Record'`。

#### CO-I3 —— `velar/log` 的 `Map({...})` 改法被拒，第二个显而易见的改法也被拒且双报

```text
$ const scoped2 = logger("build", {a: 1})
probe.vel:22:37 error VEL4001: Use 'Map({...})' to convert record fields into string-keyed entries; a record literal '{...}' builds a record, not a Map

$ 照做
probe.vel:4:36 error VEL4001: Cannot assign Map<string, number> to Map<string, unknown>
    const scoped = logger("build", Map({a: 1}))
                                   ^^^^^^^^^^^

$ 显式写实参
probe.vel:7:32 error VEL4001: Cannot assign Map<string, number> to Map<string, unknown>
probe.vel:7:35 error VEL2031: Type arguments are inferred at each call site; write 'Map(...)' without '<...>'
```

唯一编译得过的拼写是先声明一个 `Map<string, unknown>` 绑定再传进去 —— 没有一条
消息说这件事。`docs/standard-library.md:838` 与 `:841` 陈述了类型
（`logger(scope, fields=Map())`、`Fields are Map<string, unknown> values`），
文档自己的例子从不传 fields，因此也没有暴露「没有字面量拼写」这件事。

#### CO-I4 —— 退役的 `Function` 简写给出一个写死的 `() -> null`，与站点无关

```text
probe.vel:1:14 error VEL2012: The 'Function' type shorthand is retired; a function type has one spelling, the arrow — write '() -> null'
def take(cb: Function):
             ^^^^^^^^
probe.vel:8:14 error VEL2012: … — write '() -> null'
    const g: Function = (a: number) => a + 1
             ^^^^^^^^
probe.vel:8:25 error VEL4001: Cannot assign (a: number) -> number to () -> null
```

照做：`const f: () -> null = () => 1` → `Cannot assign () -> number to () -> null`。
同一句在每个站点逐字相同，从不反映初始化式的真实签名。（附带：`const g: Function
= …` 一个错误两条报告 —— 退役那条与随之而来的赋值错。）

#### CO-I5 —— 工具链重复最多的那条改法 `'Type.parse'` 不是一个编译得过的拼写

`Type.parse` 出现在四条诊断里（`analysis/calls/inference.ts:627`、
`analysis/expressions/projections.ts:140,249`、`analysis/expressions/operators.ts:131`）。
`Type` 在清册里是 `builtin-type-name`，注解位合法（`const t: Type<User> = User` 编译
通过），但它不是一个值绑定：

```text
probe.vel:9:15 error VEL3001: Unknown name 'Type'
    print(str(Type.is(1)))
              ^^^^
```

意图可以推断出来（占位符），但逐字贴回去编译不过。

> **本组的对照面**：Web 那一族改法全部通过 —— 陈旧读探测器的三种形状
> （`box = Counter(...)` / `holder = {...holder, box: Box(...)}` / `boxes[0] =
> Box(...)`）与 `hsl` 折叠绑定的 `write 70%` 逐字贴回源码后 `velar check` 干净。
> 0.31.0 在 Web 面做到了「改法编译得过」，本组的五条是 Core 面还没做到的那些。

### 二、消息点名了错的槽位

#### CO-I6 —— `Unknown named argument 'X'` 的 caret 永远在实参**值**上，不在名字上

```text
na1.vel:2:35 error VEL4001: Unknown named argument 'stop'
    print(str(range(start=1, stop=4).size))
                                  ^
```

`stop` 在第 30–33 列，caret 在第 35 列的 `4` 上。lambda 形态更明显：
`[1, 2].sorted(key=(v: number) => v)` 的 caret 覆盖那 16 个字符的 lambda，
而要改的是它前面的 `key`。本轮抽样的每一个具名实参站点都是这样。

#### CO-I7 —— `VEL6007` 的 caret 在**模块说明符**上，而错的是导入名

```text
im1.vel:1:20 error VEL6007: Module 'velar/time' has no export named 'nope'; did you mean 'now'?
import {nope} from "velar/time"
                   ^^^^^^^^^^^^
```

要改的 `nope` 在第 9 列；caret 落在整行里唯一正确的部分。同一类导入错误的兄弟诊断
**点名字**：

```text
im2.vel:1:9 error VEL3008: Use Json.parse directly; VelarScript's pure namespaces need no import
import {parse} from "velar/json"
        ^^^^^
```

#### CO-I8 —— `throw` 出现在箭头体里被诊断成一个命名错误

```text
probe.vel:2:21 error VEL2002: 'throw' is a VelarScript keyword and cannot be a name; choose another name
    const f = () => throw Error("x")
                    ^^^^^
probe.vel:2:27 error VEL2032: A statement ends at its newline; move 'Error' to its own line, or join it to the value before it with an operator
    const f = () => throw Error("x")
                          ^^^^^
```

作者没有在命名任何东西，「choose another name」指向一个不存在的决定；第二条的 caret
落在 `Error` 上，而 `Error` 不该动。在 `.test.vel` 里同一段源码得三条。

#### WB-I1 —— 折叠绑定的槽位教训指对了，`filters` 的兄弟消息什么都不指

`tracks` 与 `filters` 是 look 词汇里仅有的两个 rest 构建器。第二个位置写错类型：

```text
$ const t1: TrackList = tracks(8px, 4)
probe.vel:3:35 error VEL5042: tracks' argument 2 is a Length, a Percentage, or 0, and 4 is none of those; write 4px or 4%

$ const f1: Filter = filters(blur(4px), 3)
probe.vel:3:39 error VEL4001: Cannot assign number to Filter
```

后者不点名槽位、不给改法。D114 X 波记的裁决是「`filters` 保持 core 的赋值报告」，
所以这是一条**已知的**两政策 —— 本文只钉住它的可观察后果。

#### NO-I1 —— `file(path, root=…)` 的拒绝说的是 `fileResponse`，而代码注释说这不许发生

`packages/node/runtime/serve.js:1024-1026`：「`caller` is the name a refusal has to
say, because an author who wrote `root="uploads"` must not be told about
`fileResponse`.」但 `file()` 委托过去（`serve.js:1219`）时传的就是 `"fileResponse"`：

```text
--- STDERR ---
Unhandled server request failed: fileResponse root '../shared-public' leaves the project at /…/dd1: a relative root names a directory inside it, and a directory outside it is named by an absolute path
```

`staticFiles` 与 `Upload.save` 都正确地说自己的名字。

#### NO-I2 —— `HttpProblem(<变量记录>)` 的 caret 在变量上，不在上一行的 `code:` 键上

```text
hp2/src/app.vel:7:34 error VEL4001: Cannot assign { status: number, code: string, title: string } to { status: number, reason: string, title?: string?, … }
const fromVariable = HttpProblem(record)
                                 ^^^^^^
applied 0 mechanical fixes; 1 diagnostic remains
```

一条报告，但不说 `code` 的后继是 `reason`、不带修法。（字面量与 `options=` 具名两种
形态都完美 —— 见 DECIDED-AND-CORRECT 的七站点记录。）

#### GA-I1 —— `velar fix` 报的位置是 `velar check` 从没报过的那个

多点改写报的是**第一处编辑**的位置：

```text
VEL5042  check: …/src/app.vel:9:15 error VEL5042: Write a design token reference as token("--brand"); …
         fix  : src/app.vel:2:1 fixed VEL5042: Use token("--brand")     ← 2:1 是 velar/look 的 import 行

VEL3008  check: src/index.vel:1:9 error VEL3008: Use TimeoutError directly; …
         fix  : src/index.vel:1:1 fixed VEL3008: Drop the import; the name needs none
```

单点改写两边逐字一致（`hsl` 的 `7:22` / `7:26`；`HttpProblem` 的 `10:41`）。

### 三、一个错误两条以上报告

#### CO-I9 —— 一个真的不可迭代对象让循环槽变成 `unknown`（不是毒），体里每一次使用再报一条

0.31.0：「an invalid iterable poisons both loop slots instead of adding 'Cannot
iterate over'」。由**错误产生**的 `unknown` 那一半确实修好了（0.30.0 CO-I5）。
真的类型错那一半没有：

```text
$ cat r10.vel
@main:
    const v = true
    for item in v:
        print(item.field)
        print(item + 1)
        print(str(item))
$ velar check r10.vel
r10.vel:3:17 error VEL4001: Cannot iterate over bool
r10.vel:4:15 error VEL4001: Cannot access 'field' on unknown without validation; declare a type naming the fields you rely on — 'type Item:' with the 'field' field — …
r10.vel:5:15 error VEL4001: Cannot assign unknown to number; a boundary value stays unknown until validated at the edge — …
r10.vel:6:19 error VEL4026: str() converts strings, numbers, bools, enums, null, …
```

一个错误、四条报告，后三条都在教作者怎么处理一个他从没写过的 `unknown`。两槽形态
（`for index, item in 42:` → 3 条）与记录形态（`for k in {a: 1}:` → 2 条）同款。
VEL4025 那一格留着同样的尾巴：`def loop(n: number): return loop(n)` 得 VEL4025 ＋
一条 `str(loop(1))` 的 VEL4026。

#### CO-I10 —— 元数错误随身带一条它自己制造的类型错误：五个面同款

```text
core   probe.vel:6:21 error VEL4001: Expected 1 argument but received 0
       probe.vel:6:21 error VEL4001: Expected a List of Promises or a record of Promises, received unknown
                                                （同文件、同码、同 6:21、同 caret 宽度）
core   probe.vel:13:5  error VEL4001: Expected 1 argument but received 2         m.update("a", fn)
       probe.vel:13:14 error VEL4001: Cannot assign string to Map<string, number>
web    probe.vel:13:15 error VEL4001: Expected 2 arguments but received 1        route("/")
       probe.vel:13:15 error VEL4001: A route requires a component, received unknown
web    probe.vel:17:15 error VEL4001: Expected 2-4 arguments but received 0      lazy()
       probe.vel:17:15 error VEL4001: A lazy loader must be written as () => import("./module.vel")
node   probe.vel:25:11 error VEL4001: Expected 0-1 arguments but received 2      join("a", "b")
       probe.vel:25:16 error VEL4001: Cannot assign string to List<string>
```

第二条永远是第一条留下的 `unknown` 或位移了的实参再报一次。

#### CO-I11 —— 一个字段拼错：记录字面量报两条、具名实参报两条且没有后继名、enum 报一条

```text
# 记录字面量：两条
b8.vel:6:21 error VEL4001: Object is missing required field 'age'
b8.vel:6:33 error VEL4001: Type 'User' has no field 'aeg'; did you mean 'age'?

# 类构造器的具名实参：两条，且第二条不给后继名
b10.vel:10:15 error VEL4001: Missing required named argument: name
b10.vel:10:25 error VEL4001: Unknown named argument 'nmae'

# enum 成员：一条
b11.vel:6:21 error VEL4001: Enum 'Kind' has no member 'frist'; Kind.values() lists the members in declaration order
```

`velar fix` 对记录字面量那一格不给机械修法（`applied 0 mechanical fixes;
2 diagnostics remain`），尽管消息自己已经点名了 `age`。同族第三例（Node）：
`HttpProblem(problem={…})` 一个错误三条报告（`Missing required named argument:
options` ＋ `Unknown named argument 'problem'` ＋ 那条真正的 `reason` 教学；前两条
是一个错误）。

#### NO-I3 —— 错的模块说明符报两次，第二条带上编译不过的 `Type.parse` 改法

```text
probe.vel:1:28 error VEL6003: Unknown standard module "velar/server"; did you mean "velar/serve"? The standard modules are: …
probe.vel:4:26 error VEL4001: Cannot call an unknown JavaScript value without a declaration or validation; declare the signature — an 'extern module' contract or a contracted 'extern js' block gives 'application' a checked type — or validate the data it came from with 'Type.parse' first
```

从一个现成工程可达：`velar create --template node` 写的是
`extensions: ["@velarscript/server"]`，把它换成 `@velarscript/node` 而不改
`src/main.vel` 的读者拿到的正是这一对。

### 四、一个意思两种拼写 / 两条规则互相作废

#### CO-I12 —— 「(N Node.js internal frames hidden)」把三类帧当成一类，并且数错

策略隐藏三类帧（`packages/compiler/runtime/error.js:77-82`）：`node:` 内建、
保留名前缀 `__velar`、`/node_modules/velar/` 路径。计数句只有一种说法
（`error.js:100`，`packages/cli/src/uncaught-program-error.ts:111` 同形）。三个实测，
每一次都有一到两帧**不是** Node 内建：

```text
$ velar run n03.vel                     # AssertionError
  (3 Node.js internal frames hidden; …)
$ velar run --stack n03.vel
    at __velarRequired (file:///…/.velar/run-0QKQig/n03.js:5:11)      ← 程序自己模块里的内联助手
    at <anonymous> (…/n03.vel:6:15)
    at ModuleJob.run (node:internal/modules/esm/module_job:437:25)     ← 只有这两条
    at async node:internal/modules/esm/loader:639:26                    ← 才是 Node 内建

$ velar run ie1.vel   → (4 …hidden)     实为 2 个 velar 包帧 ＋ 2 个 Node 帧
$ velar run tn1.vel   → (3 …hidden)     实为 1 个 velar 包帧 ＋ 2 个 Node 帧
```

`ds1.vel`（释放失败）那一格恰好只隐藏两个真 Node 帧，句子在那里是对的 —— 所以这不是
措辞糙，是**同一个数字在不同格里含义不同**。

#### CO-I13 —— extern class 位的两条路径，措辞统一了、**下划线跨度没有**

```text
x_str.vel:2:18 …, so it cannot name an extern class; …
    export class str:
                 ^^^          ← 只下划名字
x_bool.vel:2:5 …, so it cannot also name an extern class; …
    export class bool:
    ^^^^^^^^^^^^^^^^^^        ← 下划整条声明
```

分界（词法名册 vs 分析器名册）与 CO-D1 的那条（带替换名 vs 不带）不同。

#### CO-I14 —— `??` 右臂的空记录：记录类型那一格修好了，**类类型那一格没有**，仍然印 `{  }`

```text
$ cat q2.vel
class Foo:
    let x: number = 1

@main:
    const f: Foo? = null
    const g: Foo = f ?? {}
$ velar check q2.vel
q2.vel:6:20 error VEL4001: Cannot assign Foo | {  } to Foo
```

`{  }`（两个空格）在源码里写不出来，`Foo | {  }` 这个联合类型修好之后也不存在。
记录类型形态一条且是有用的那条（`Object is missing required field 'name'`）。

#### CO-I15 —— `VEL4039` 的改法是一句固定例句，从不点名作者的绑定、类型或声明词

```text
g7.vel:2:19 error VEL4039: Empty '[]' requires an explicit type; … — write 'let items: List<string> = []'
    const names = []            ← 下一行就是 names.append("a")
g8.vel:2:18 error VEL4039: Empty 'Map()' … — write 'const users: Map<string, User> = Map()'
    let scores = Map()          ← 下一行就是 scores.set("a", 1)
g9.vel:2:18 error VEL4039: Empty 'Set()' … — write 'const tags: Set<string> = Set()'
```

绑定名、声明词与元素类型全是虚构的。同一版里 Web 面的整条论证是「按槽位公开类型
生成」「按形状写出改法并点名路径」，两边政策相反。

#### CO-I16 —— `velar format --check` 的动词不随数变

`packages/cli/src/commands/format.ts:89` 只把名词复数化：
`1 of 1 VelarScript source file **require** formatting` /
`2 of 2 VelarScript source files require formatting`。

#### CO-I17 —— `join` 在两个 `velar/*` 模块里是两种调用约定

`velar/url.join` 变参（`join("https://a.dev", "x", "y")` 编译干净）；
`velar/path.join` 收一个 `List<string>`（`join(["a", "b"])`）。两处都有文档
（`docs/standard-library.md:51-52` 与 `:1434-1437`），所以是已裁决的不一致；但它是
`velar/*` 里唯一一个跨模块换形状的名字，而读者拿到的错误
（`Expected 0-1 arguments but received 2` ＋ `Cannot assign string to List<string>`）
不提另一个模块。

#### WB-I2 —— `velar fix` 不施加 `web-api` 承诺的那条 A16 修法，摘要也不提示还剩东西

```text
$ velar fix probe.vel
probe.vel:3:21 fixed VEL4001: Write 50%
probe.vel:3:25 fixed VEL4001: Write 50%
applied 2 mechanical fixes in 1 file; 0 diagnostics remain
$ velar check probe.vel
probe.vel:6:14 advisory A16: Look property 'filter' accepts CSS filter text, but this complete filter list has the checked equivalent filters(blur(26px), brightness(1.09))
Checked 1 module from probe.vel — 1 advisory
```

`docs/web-api.md:427-429` 承诺这一格有「an **editor** fix」——「editor」这个词把它
归给语言服务器（`tests/web/look-filter-code-action.test.ts` 证实那条 code action
存在），所以摘要里的「0 diagnostics remain」按字面不假（A16 走 advisory 通道）。
记在这里是因为**同一个词汇表里的两条修法走两条通道**：`hsl` 百分号与 `token(...)`
`velar fix` 会做，`filters(...)` 只有编辑器会做，而没有一句话告诉作者这条界线在哪。
（附带：同一次运行改写 `color("var(...)")` → `token("...")` 之后，已经用不到的
`color` 导入留在原地。）

#### NO-I4 —— 就绪期限失败**不带任何程序帧**，产品构建仍然先打印被压缩的运行时行

0.31.0：「it carries the program's own frames and reaches the `velar run` launcher
like any uncaught error, not as a raw timer dump.」**产品构建**：

```text
ELAPSED 30035ms EXIT 1
--- STDERR ---
file:///…/wtermp/dist/node_modules/velar/terminal.js:288
`,{eval:!0,workerData:{port:L.port2},transferList:[L.port2]});o(ye,c,[g,"ref",…
…（约 3,000 列的 caret 填充）…

Error: Node terminal worker did not become ready within 30000 ms
    at file:///…/wtermp/dist/node_modules/velar/terminal.js:288:421
```

这正是 0.30.0 NO-U6 记下的形态，未变。可读构建同款。`velar run` 下的启动器报告是
好的，但 `--stack` 只补出一条运行时帧、仍无 `.vel` 帧。`docs/cli.md:209-211` 只对
**13 号**路径写了「`--stack` adds only the launcher's own frames」；这里是 1 号未捕获
路径。

#### NO-I5 —— 折叠出来的 `..` 根在 `node dist/main.js` 下以约 3,000 列的压缩代码框崩在启动期

```text
$ node drive.mjs /private/tmp …/dd2/dist/main.js /assets/hello.txt
PORT=null
--- STDERR ---
file:///…/dd2/dist/node_modules/velar/serve.js:2
`])))throw new d("ServeResponse.contentType must be bounded single-line text");…  [约 3,000 列]

TypeError: staticFiles root '../shared-public' leaves the project at /…/dd2: …
    at Ii (file:///…/dd2/dist/node_modules/velar/serve.js:2:10622)
    …
    at file:///…/dd2/dist/app.js:1:254
```

同一失败在 `velar run dd2` 下报得完美（代码框是
`...staticFiles("/assets", root=folded)` 带 caret，`at <anonymous>
(…/dd2/src/app.vel:9:8)`）。坏的是部署形态。

#### NO-I6 —— 构建期的 `..` 拒绝不点名目录，而且对一个**没有**离开工程的根说它「离开了」

0.31.0：「naming the root and the directory it would have left.」**运行期**消息两个
都点名；**构建期**只点名根：

```text
dd1/src/app.vel:8:39 error VEL4001: A relative static root names a directory inside the project; '../shared-public' leaves it. Name a directory inside the project, or pass an absolute root for one outside it
        return file("hello.txt", root="../shared-public")
                                      ^^^^^^^^^^^^^^^^^^
```

（三个构建器各一条、跨度正确，`packages/node/src/serve-call-analysis.ts:78`。）
一个不逃逸的根被描述成逃逸：`'public/../public' leaves it.`
`..` 单独与 `..\x` 被拒，`..foo` 正确接受。

#### NO-I7 —— 折叠的 `const` `..` 根在构建期漏网 —— 在教会了 Web 单位教训「读折叠绑定」的这一版里

`const folded = "../shared-public"` 与 `get("VELAR_PROBE_ROOT") ?? "…"` 两种形态 →
`Checked 3 modules from dd1`，都只在请求期才失败。与 Node 条的字面措辞（只说
literal）一致，与这一版自己不一致。

#### NO-I8 —— `"pubic"` 与 `"./pubic"` 被审计成两个根，第二条印出没归一化的路径

```text
velar/serve: static root './pubic' does not name a directory (/…/ar3/./pubic); requests for it answer 404 until it exists
velar/serve: static root 'pubic' does not name a directory (/…/ar3/pubic); …
```

重复的 `"pubic"` 正确去重成一条；`"./pubic"` 是同一个目录的第二条报告，
其「resolved path」带着 `/./`。报告顺序也与声明顺序相反
（`__velarServeAuditStaticRoots` 从尾部弹出）。

#### NO-I9 —— 「100 characters」是 100 个 UTF-16 码元，而运行时的再推导接受 214

`"🚀".repeat(50)`（50 个 emoji ＝ 100 码元）被接受，加一个 `a` 被拒。
`assertProjectName` 卡 `value.length ≤ 100`（`packages/cli/src/project-format.ts:49,77`），
`nodeProjectIdentity` 接受 `name.length <= 214`（`packages/node/src/project-config.ts:83`）
—— 两个裁判对上界不一致；只有 100 那一侧从合法清单可达。

#### GA-I2 —— `docs/cli.md:623` 的 `velar skill` 选项表漏了 `server`

* `docs/cli.md:623`：`velar skill [core|web|node|desktop]`
* `velar --help` 与 `velar skill --help`：`velar skill [core|web|node|server|desktop]`
* 实测：`velar skill server` exit 0，打印 `# The VelarScript Server AI skill brief`；
  `velar skill bogus` → `velar skill: expected core, web, node, server, or desktop`（exit 2）
* `node` 模板自己生成的 `AGENTS.md` 写着：「Load `velar skill core`, `velar skill
  node`, then `velar skill server`」

#### GA-I3 —— 同一个 `AssertionError`，`velar run` 点名 `file:line:column`，`velar test` 什么都不点

```text
$ velar run err4
AssertionError: A greeting requires a name
    assert recipient != "" else "A greeting requires a name"
                        ^
    at greet (/…/err4/src/index.vel:3:25)
    at <anonymous> (/…/err4/src/index.vel:6:14)
  (2 Node.js internal frames hidden; …)

$ velar test err3
✗ "src/index.test.vel" :: "greeting"
Expected "Hello, Velar!" to be "Hello, WRONG!"
✗ "src/index.test.vel" :: "throws"
A greeting requires a name

0 passed, 2 failed
```

`expect` 不匹配与抛出的错误都没有行、列、帧。`docs/cli.md` 与
`docs/project-lifecycle.md` 都没有陈述失败测试的报告形状。

#### GA-I4 —— 三条「工程编排」规则报告时没有站点、没有码

`docs/cli.md:143-147` 点名了这三条，三条全测：

```text
/…/err1/src/main.vel: Application entry must declare '@main' and perform startup inside that region
/…/lb2/src/index.vel: A library entry cannot declare '@main'; move startup into an application project
Configured Server configuration '/…/pr1/application.yml' does not exist
```

三条都在 `check` 通道、都跟着 `Run 'velar repro' …`、都 exit 1，都没有
`:line:column` / `error` / `VELxxxx`。第三条既不点名 `velar.json` 也不点名声明它的
`server.configuration` 键，而且头两个词重复。同一家族的**机械**那一半是对的、
并且点名站点：

```text
src/main.vel:7:18 fixed VEL4037: Delete the inferred '-> null'
src/main.vel:12:1 fixed application-entry: Move the entry's startup statement into its '@main' region
applied 2 mechanical fixes in 1 file; 0 diagnostics remain
```

（`application-entry` 是一个 `check` 通道从不打印的码。）

#### GA-I5 —— `velar verify` 让你去跑一条你刚跑过的命令

`p-library` 上先后跑完 `velar build`（exit 0）与 `velar build-library`（exit 0）之后：

```text
velar verify: /…/p-library/dist does not contain velar-build.json or velar-node.json; run 'velar build' first
EXIT=1
```

`docs/cli.md:255` 列的是 `velar verify [project-directory | build-directory]`，
没有 `kind` 限制。

#### GA-I6 —— `check-surface-versions` 在同一次运行里既拒了一个文件，又说「all read」

`scripts/check-surface-versions.mjs:309` 无条件打印那句摘要。用 `--prose-root` 指向
草稿目录里的一份拷贝（**仓库未动**）触发拒绝路径：

```text
  prose: 11 files, 47 version sites, all read against velar 0.32.0 (under /…/gt/prose)

The surface versions do not describe the surfaces (D110 rule 4):

packages/core/README.md carries no version site at all — no 'velar <x.y.z>' or 'VelarScript <x.y.z>' line, … 
EXIT=1
```

---

## CHARTER-DRIFT

### CO-C1 —— `docs/standard-library.md:531` 把 `sign` 与 `trunc`列进 `Math.` 表，而编译器拒绝这两个成员

```text
| Bounds | `min`, `max`, `clamp`, `sign`, `trunc` |          ← docs/standard-library.md:531
```

```text
$ velar check mv1.vel
mv1.vel:2:15 error VEL4001: Math has no member 'abs'
mv1.vel:3:15 error VEL4001: Math has no member 'round'
mv1.vel:4:15 error VEL4001: Math has no member 'floor'
mv1.vel:5:15 error VEL4001: Math has no member 'ceil'
mv1.vel:6:15 error VEL3008: Use '(0 - 1).sign()'; 'sign' is a number method, not a Math namespace member
mv1.vel:7:15 error VEL3008: Use '(1.5).trunc()'; 'trunc' is a number method, not a Math namespace member
```

同一节 `:536-538` 列出接收者形操作时**恰恰漏了这两个**：

> The receiver-shaped operations are number members: `.abs()`, `.round()`,
> `.floor()`, `.ceil()`, `.toFixed(digits)`, and the predicates `.isInteger()`,
> `.isNaN()`, and `.isFinite()`.

`sign` 与 `trunc` 站错了列表。两条改法本身编译得过（`(-2).sign()` / `(1.5).trunc()`
均干净）—— **附带的第二个问题是消息质量分叉**：`sign` / `trunc` 有引导（VEL3008 带
逐字替换，`packages/compiler/src/analysis/calls/inference.ts:258`），而同一句文档点
名的另外四个接收者形操作 `abs` / `round` / `floor` / `ceil` 只得到一句
`Math has no member 'X'`，没有任何引导。

### WB-C1 —— `docs/web-api.md` 自相矛盾：`velar/look` 的具名导入既是「the import list」又是「retired」

```text
:384-385  The builders are named imports from `velar/look`, so the import list at the
          top of a file names the visual vocabulary that file uses.
:386-387  `velar/look` remains importable only for its visual Type objects — `Length`,
          `LengthPercentage`, `Color`, and the rest of the published vocabulary:
:423-424  Importing one by name from `velar/look` is retired and teaches the namespace
          spelling.
```

文档自己的 fenced 例子（`:392-407`）第一行就是
`import {border, clamp, rgb, spacing} from "velar/look"`，逐字复制后
`Checked 1 module`。本轮把**32 个有文档的构建器全部具名导入**，全部编译干净；
不存在可以被「teach」的 `Look.` 命名空间拼写（`Look` 只是一个类型对象）。
「retired」那半句是假的。

### CO-C2 —— CHANGELOG 说「`char` 越界是 `IndexError`」，而非负越界答 `null`；宪章是对的

0.31.0 第一条：

> a bad string position is an `IndexError`, as it is on a List: **`char` with an
> index out of range** or not an integer …

```text
$ "abc".char(10)   →  null
$ "abc".char(-1)   →  IndexError: String.char index -1 is out of range for 3 characters; the index domain is 0 through size - 1
$ "abc".char(1.5)  →  IndexError: String.char index must be an integer
```

同一段 CHANGELOG 的下一句自己给出了反例（「`char(3)` on a shorter string still
answers `null`」）。**宪章 §7 是准确的那一份**（`docs/language-charter.md:1909`）。

### CO-C3 —— 「as it is on a List」不成立：List 的可选读对越界答 `null`，字符串的可选读抛

同一句的第二个断言。`char` 是**字符串唯一的读**（`s[0]` 被拒并被导向
`.char(index)`），而它把 List 的两种读混在一格里：越界像 `get`（答 `null`），
负数像 `[]`（抛 IndexError）。

```text
$ [1,2,3].get(-5)   →  null
$ [1,2,3][-5]       →  IndexError: List index -5 is out of range for 3 elements
$ "abc".char(-1)    →  IndexError: String.char index -1 is out of range for 3 characters; …
$ "abc".char(10)    →  null
$ velar check 's[0]' → VEL4001: Use '.char(index)'; strings are not indexable and string positions count Unicode code points
```

宪章把两边都写清楚了（§7 的 `char` 行与 §15 的 `get`/`[]` 段），所以不是未定义 ——
是 CHANGELOG 的类比不成立，而那个类比正是这条 breaking change 的理由。附带：
X 波说新句子「沿用 `List.get` / `List.slice` 的原句（只差接收者名）」，实测多了半句。

### CO-C4 —— 宪章 §11 拿来当范例的那行声明，编译不过

`docs/language-charter.md:3407-3409`：

> … so `class BudgetError extends Error:` makes reports and `print(error.name)`
> say `BudgetError`, not `Error`.

```text
$ velar check h3.vel
h3.vel:1:1 error VEL4001: Class 'BudgetError' requires a constructor that calls 'super(...)'; a derived class without one takes no construction arguments, so 'Error' would lose its message — write 'constructor(message: string): super(message)'
class BudgetError extends Error:
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

散文里的行内代码不过围栏门（`check:fence-format` 只读 fenced block），所以这条
0.31.0 刚换上去的范例没有任何东西验它。

### NO-C1 —— CHANGELOG 说 `serve()` 审计「the declared static roots」；两种声明形态不在其中

0.31.0：「`serve()` audits the declared static roots once at start and reports each
missing one with its resolved path」。两个例外，**两者 `docs/standard-library.md`
都写对了，只有 CHANGELOG 写成了无条件**：

1. **只经 `file()` / `fileResponse()` 声明的根不审计**：五个根全部只在 handler 内
   出现、其中三个缺失时 stderr 全空，缺失的根只在请求期答 404。机制：
   `__velarServeDeclareStaticRoot` 在 `fileResponse()` 里跑，而 handler 只在
   `serve()` 已经排空清单之后才到（`packages/node/runtime/serve-dispatch.js:85`）。
2. **没烤偏移时不审计**：`velar build … --out-dir <工程外>` 烤出
   `const zn="",In=""`（偏移与身份都是空串），跑起来两个缺失根静默。

`docs/standard-library.md:1044-1050` 两条都写对了（「when the build recorded where
the project root is」「a root first named inside a handler is checked no earlier
than that handler runs」）。

---

## UNDEFINED

### CO —— Core 0.8

| ID | 未定之处 | 实测行为（即应成文的答案） |
|---|---|---|
| CO-U1 | 折叠得出的负 `char` 下标不在编译期契约里 | `s.char(-1)` 编译期拒（`String.char index -1 is out of range; the index domain is 0 through size - 1`，此处**不报 size**，运行时那条才报）；`s.char(0 - 1)` 编译干净、运行时 IndexError。0.31.0 只说「a negative **literal** `char` index is refused at compile time」 |
| CO-U2 | `Type.parse` 失败的源码框指向**类型声明**，不是调用点 | `User.parse(raw)` 在第 6 行失败，框是 `type User:` / `^`（第 1 行）——「第一个自有帧」是 `at Object.parse (…:1:1)`；栈里第二帧才是 `…:6:15` |
| CO-U3 | 忘了 `await` 完全静默 | `const v = f()`（`f` 是 `async def`）后 `print(v)` 编译干净、运行打印 `Promise { <pending> }`。`print` 被宪章定为 the inspection exit，但没有一句说这个形态 |
| CO-U4 | `def readonly()` / `const readonly = 1` 合法 | `readonly` 在 `class` / `type` / `enum` / 类型参数 / extern class 五个位被拒，在 `def` 与 `const` 位通过并运行。与「成员名与记录键全部放行」同规，但顶层值名没被写进那条规则 |
| CO-U5 | 12 个活的 Core 模块导出在 `docs/**/*.md` 与八个包 README 里一个字都没有 | `velar/binary` 八项（`uint8Buffer` `uint8FromBytes` `uint32Buffer` `uint32FromBytes` `uint32Builder` `float32Buffer` `float32FromBytes` `float32Builder` —— 只有 `uint16Buffer`/`uint16FromBytes` 出现在 `docs/standard-library.md:246-254` 的片段里）· `velar/task` 一项（`CancellationError`）· `velar/worker` 三项（`WorkerCallError` `WorkerClosedError` `WorkerBackpressureError`）。全部实测存在、编译干净 |

### WB —— Web 0.14

| ID | 未定之处 | 实测行为（即应成文的答案） |
|---|---|---|
| WB-U1 | 应用级 fatal（`__velarFatal`）不带命名空间 | `packages/web/runtime/emitted-components.js:112` 调 `__velarFatalNode(message)`，第二参缺省，于是根 fatal 永远是 HTML `<section>`；区域那一路（`emitted-props.js:131`）传了 `namespace` 并已修好。**本轮未能在替身里驱动到「挂载进 SVG 宿主的根失败」这一格**，故只记源码事实，不记为 DEFECT |
| WB-U2 | 6 个活的 Web 模块导出无文档 | `velar/look` 一项（`Shadow`）· `velar/realtime` 两项（`RealtimeClientState` `RealtimeCodec`）· `velar/websocket` 三项（`WebSocketBackpressureError` `WebSocketProtocolError` `WebSocketTimeoutError`） |
| WB-U3 | `velar/storage` 的 `scope` 不在它自己的成员句里 | `docs/web-api.md:1578-1579` 写「Both provide typed `get`, JSON `set`, `has`, `keys`, `remove`, `clear`, and `watch`」，没有 `scope` —— 而同一节 `:1557` 的例子用的就是 `storage.scope("studio")` |
| WB-U4 | `domId("1bad")` 编译干净 | `docs/web-api.md:1379-1381` 给出的前缀语法说这个字面量非法，编译期不查。本轮只跑 `velar check`，运行期是否抛未验 |

### NO —— Node 0.17

| ID | 未定之处 | 实测行为（即应成文的答案） |
|---|---|---|
| NO-U1 | `velar.json` 的 `name` 规则在 `docs/` 里一个字都没有 | `grep -rn "at most 100" docs/` 零命中；`docs/project-lifecycle.md:54-71` 是格式 2 的正典范例、不含 `name`，而 `:120` 说「Unknown project fields … also fail closed」，读者会由此断定 `name` 会被拒；`docs/getting-started.md:56` 只在 create 输出的清单里露出 `"name": "my-app"`，没有规则、没有上界、没说它是服务身份。规则本身只在 `CHANGELOG.md` 里 |
| NO-U2 | `docs/node-api.md` 不存在 | `docs/*.md` 共 20 个文件，没有 `node-api.md`（也没有 `server-api.md` / `desktop-api.md`），仓库里也没有任何东西引用它们。Web 面有专门的 API 文档；Node / Server 的模块章节在 `docs/standard-library.md` 里，Desktop 的只在 `docs/ai-skill-desktop.md` 与包 README 里 |
| NO-U3 | `readBytes` / `writeBytes` / `createBytes` 不在 `velar/fs` 的导出表里 | 三个都存在并可用（`readBytes size 3 first 97` / exit 0）。`docs/standard-library.md:1272-1289` 的表有 16 行，一行都没有它们；`readBytes` 只在 `:237` 的散文里，另两个只在 `docs/binary-data-and-concurrency.md:139` |
| NO-U4 | `RoutePattern` / `setCookie` / `clearCookie` 在 `velar/serve` 文档段里出现 0 次 | 三个都是 `velar/serve` 导出（`packages/node/src/modules/serve.ts:160, :190, :191`）；`setCookie`/`clearCookie` 只在 `docs/ai-skill-node.md:305-306, 327-328`。`Upload` 在文档段里只被点名一次（`:1266`），其成员 `name` `filename` `contentType` `size` `text()` `bytes()` 只在 `docs/ai-skill-node.md:218`。另有 5 项 Node 导出全库无文档：`velar/server-test` 的 `TestClient` `TestResponse`、`velar/websocket` 的三个错误类 |
| NO-U5 | 构建之后删掉或写坏工程自己的 `velar.json`，根基**静默**翻到 `dist/` | 工程 `sil`（树内 dist）：清单在 → `PROJECT-public`；删掉清单 → `DIST-public`；清单不可解析 → `DIST-public`。三种情况 stderr 全空。`docs/standard-library.md:1031-1033` 只把**身份不符**的清单写成会报告，`:1023-1026` 把回落说成适用于「copied away … or written to an `--out-dir` outside it」，两条都不覆盖删除与损坏 |
| NO-U6 | `velar create` 保留标点，`...` 目录得到 `"name": "..."`；`velar-app` 只在纯空白/控制字符时出现 | `normal`→`normal` · `my app`→`my app` · `My.App-v2_x`→`My.App-v2_x` · `中文项目`→`中文项目` · 120 个 `z`→截到 100（但 `package.json` 的 name 保留 120） · `...`→`...` · `" leading"`→`leading` · `🚀rocket`→`🚀rocket` · `"./ "`→`velar-app`。`projectName`（`packages/create/src/templates.ts:665`）只剥 `\p{Cc}` 并 trim |

### SV —— Server 0.15

| ID | 未定之处 | 实测行为（即应成文的答案） |
|---|---|---|
| SV-U1 | 12 项 Server 面里 4 项无文档 | `velar/realtime` 三项（`RealtimeBackpressureError` `RealtimeCodec` `RealtimePeerState`）· `velar/server` 一项（`applicationConfigurationPath`，实测存在并编译干净）。Server 面共 12 个 module-export，三分之一没有文档 |

### DT —— Desktop 0.10

| ID | 未定之处 | 实测行为（即应成文的答案） |
|---|---|---|
| DT-U1 | Desktop 面**没有参考文档** | Core 有 `docs/standard-library.md`，Web 有 `docs/web-api.md`，Node / Server 的模块章节在 `standard-library.md` 里。Desktop 的六个专有模块（`velar/desktop` `velar/window` `velar/service` `velar/notification` `velar/secure-storage` `velar/desktop-test`）在这两份里 **grep 零命中**，只出现在 `docs/ai-skill-desktop.md`（给 AI 的简报）与 `packages/desktop/README.md` |
| DT-U2 | 12–15 个活的 Desktop 导出全库无文档 | `velar/desktop`：`DesktopPlatform` `PermissionStatus` `DroppedFiles` `DroppedFilesStream` `PowerStream` `homeDirectory` · `velar/notification`：`NotificationActivation` `NotificationActivationStream` · `velar/service`：`ServiceClose` `ServiceStateStream` · `velar/window`：`WindowBounds` `WindowStateStream`（清册全量对照另计入 `velar/desktop-test` 五项）。全部实测存在并编译干净 |

### GA —— 门禁与工具

| ID | 未定之处 | 实测行为（即应成文的答案） |
|---|---|---|
| GA-U1 | `velar graph --max-nodes` / `--max-edges` 只活在 `velar graph --help` 里 | 两个 flag 不出现在 `velar --help`、`docs/cli.md:46` 或 `:624`（源码 `packages/cli/src/arguments.ts:336-341`） |
| GA-U2 | `velar repro` 在干净工程上 exit 1 | 六个模板全部：`velar repro: /…/velar.json checks without errors; there is no failure to reproduce`，**exit 1**。`docs/cli.md:169-180` 只描述写出 bundle 的那条路 |
| GA-U3 | `velar run` 在 `kind: "library"` 工程上 exit 0 且无输出 | stdout 空、exit 0。与 `docs/project-lifecycle.md:138-140` 自洽，但没有一句说 `run` 对一个 library 意味着什么 |
| GA-U4 | 三处 `docs/cli.md` 用法行与 CLI 不一致（`skill` 之外） | `:624` `velar graph [project-directory] …` vs `:46` `velar graph [entry.vel \| project-directory] …`（同一份文档自相矛盾）；`:252` 的 `velar build` 用法漏了 `[--force]`（`velar --help` 有，`:285` 只在散文里讲）；`velar --version` 不在任何一个 `docs/cli.md` 围栏里 |
| GA-U5 | `--port 0` 被 `dev` 接受、被 `preview` 拒绝 | `velar dev --port 0` → `http://127.0.0.1:64582/`，exit 0；`velar preview --port 0` → `velar preview: --port requires an integer from 1 to 65535`，exit 2。各自 `--help` 自洽，`docs/cli.md:213` 只对 `dev` 写了临时端口规则 |
| GA-U6 | 命令级拒绝不点名决定它的那一项 | `velar run: this project enables the '@velarscript/web' application framework; use 'velar dev' or 'velar build' instead` · `velar serve: the project does not activate a Node-capable application target such as @velarscript/server or @velarscript/node` · `velar dev: the project does not declare a Web, Desktop, or Node application target` —— 三条都不点名 `velar.json` 也不点名 `extensions` 条目，而同一情形下的 `velar repro` 点名了清单路径 |
| GA-U7 | `velar graph` 的人读跨度是字节偏移，不是 `line:column` | `n4 component "App" src/app.vel@1453:1456` · `n5 state "count" src/app.vel@1468:1473`；`docs/cli.md:99` 只说「the same stable IDs and source spans」。`--json` 一致（`"span": {"start": 0, "end": 346}`） |
| GA-U8 | `velar --version` 的按工程面裁剪未能证实 | `docs/cli.md:19-24` 说「a Core project — which declares none — prints `core` and `node` alone」；实测六个模板与一个无工程目录**都打印五个面**。成因可能是探针环境而非代码：`readSurfaceVersions`（`packages/cli/src/surface-versions.ts:43-47`）从 CLI 自身位置解析三个可选 peer，在这个已构建的 monorepo worktree 里三个都解析得到。判定需要一次真实 `npm install` 的工程（需网络），本轮未做 |

### 面清册的全貌（`module-export` 类逐项对 `docs/**/*.md` ＋ 八个包 README 全文）

| 面 | 清册项 | 其中 module-export | 文档里一个字都没有 |
|---|---|---|---|
| core@0.8 | 468 | 79 | **12** |
| web@0.14 | 468 | 149 | **6** |
| node@0.17 | 99 | 97 | **5** |
| server@0.15 | 12 | 12 | **4** |
| desktop@0.10 | 73 | 73 | **12** |
| 合计 | — | 410 | **39** |

另有 5 项**存在于模块表却不在自己那张文档表里**（`velar/fs` 的 `readBytes` /
`writeBytes` / `createBytes`、`velar/storage` 的 `scope`、`velar/serve` 的
`RoutePattern`），只在别处的散文或 ai-skill 简报里出现。

（`retired-spelling` / `collection-member` / `namespace-member` 等其余十五类不在这张表
里 —— 退役拼写本来就不该有文档，把它们算进来会得到「219 个 Core 名字无文档」这个假
头条，见本文开头的自伤记录。）

---

## DECIDED-AND-CORRECT

### CO —— Core 0.8（约 300 个成员名，压缩记录）

**字符串位置的 IndexError 家族（12 项）**：`char` 非整数 · `slice` 非整数位置 ·
`index(text, start)` 非整数 start 三处全部抛 `IndexError`（`error is IndexError`
为 true，`try` 不再吞成 `null`）；负字面量编译期一条、运行时点名索引与大小；
计数（`repeat` / `padStart`）仍是 `RangeError` 且句子未动；`char(10)` 答 `null`、
`index` 的负 start 从尾部数（`s.index("e", -2)` → 4）、越界 start 答 `null`、
`slice` 越界钳位（`s.slice(-99, 99)` → `abcdef`）。

**`Pair` 元数（6 项）**：`Pair<A>` 与 `Pair<A, B, C>` 各一条
（`VEL2012: Type 'Pair' expects 2 type arguments`）；零实参仍是
`Generic type 'Pair' needs 2 type arguments; write 'Pair<A, B>' with concrete types`；
成员未命中现在打名字 —— `Pair<string, number> has no field 'frist'; did you mean
'first'?`；匿名 `{first, second}` 印作 `Pair<string, number>` 且宪章 2487-2489 已成文。

**extern class 名册（24 项）**：每个恰一条，位置名词一律「extern class」，措辞按名字
换改法。唯一漏网是 `any`（CO-D2）；跨度两套（CO-I13）。

**重复导入（6 项）** · **A18（6 项）** · **一个错误一条报告的五格** · **VEL4025
（3 项）** · **宿主栈策略（6 项）** · **角色成员命名（2 项）** · **格式化器（4 项）**
—— 与 0.30.0 的对照见「held」表；每一格的逐字输出在探针目录里。

**永久命名空间与 prelude（约 70 项）**：`Text.` 23/23 · `Math.` 28 个真成员 ·
`Json.` 6/6 · `Promise.` 7/7（含记录形 `all`、带消息的 `timeout`、带延迟的 `retry`、
带并发上限的 `map`、`series`；三个被拒的 JS 静态方法给出逐字的替换句）· prelude 5/5
（`range` 三种元数 ＋ 具名 `start/end/step`、`equals`、`str`、`print`、`number`）。

**集合成员 69 项**（List 34 · Map 14 · Set 11 · Record 10）· **值方法 28/28**
（18 个 string、10 个 number 含 `.sign()` / `.trunc()`）· **错误类 11/11** ·
**内建类型名 13/14**（`Function` 是退役的那个）。

**模块导出 79/79 全部导入并演练**：`velar/url` 10 · `velar/time` 8 · `velar/id` 2 ·
`velar/log` 6（＋6 个 `LogRecord` 字段、4 个级别）· `velar/hash` 1 · `velar/random` 2
（＋`Random` 六个成员）· `velar/validation` 13（文档例子逐字）· `velar/binary` 18 ·
`velar/task` 9（＋11 个 `Task`/`Channel`/`Cancellation` 成员；`TaskTimeoutError` 正确
退役）· `velar/worker` 9 · `velar/test` 9 个匹配器。**退役的永久命名空间导入**
（`velar/json` · `velar/async` · `velar/math`）全部答
`VEL3008: Use X.member directly; VelarScript's pure namespaces need no import`。

### WB —— Web 0.14（约 200 个成员名，压缩记录）

**`tick()` 认领规则（5 项）**：两个并发等待者**都**被 reject 且拿到同一个失败
（两宿主逐字相同）；Node 宿主在有认领者时**不再**同时写报告通道；一次刷新里两个失败
时两个等待者都拿第一个、第二个走宿主；刷新之后才 await 的 `tick()` 不认领并 resolve。
宪章 §16（`language-charter.md:4794-4809`）与 `web-api.md:881-892` 逐字陈述同一规则。

**陈旧读探测器（8 项）**：平铺给 `box = Counter(...)`；记录嵌套点名路径并给
`holder = {...holder, box: Box(...)}`；List 嵌套给 `boxes[0] = Box(...)`；Map 持有者给
形状中立的一句；**三条改法逐字放进一个 Web 工程里 `velar check` 干净**；getter 同时
点名读到的成员与它读的字段；`const` 字段**完全静默**；生产静默。

**单位教训（6 项）**：`blur(4)` / `shadow(2, …)` 现在是**单报**且点名槽位；
`blur(0)` 被拒并给 `write 0px`；`tracks(8px, 4)` 在**第 2 个位置**被拒。
**折叠绑定（3 项）**：教训指向初始化处并点名绑定，照做后 `velar check` 干净，
`velar fix` 正确地不给机械修法。**keyframes（3 项）**：块级总结已删。
**VEL5077（3 项）**：一跳成立、两跳与条件写静默、宪章 §15 已成文。

**`velar/look` 32/32 有文档的构建器**在一个文件里全部具名导入并编译干净，
＋17 个类型对象；`hsl(200,50,50)` 逐槽报 `HSL saturation is a percentage, and 50 is a
number; write 50%`；`color("var(--x)")` → VEL5042 点名 `token("--x")`；A16 / A12
advisory 与 `docs/web-api.md:427-429,464-466` 相符。

**`velar/browser` 28/28** · **`velar/web` 15/15** · **`velar/config` 3/3**
（编译期清单校验是范例：`VEL5080: Value does not match RuntimeConfig — field
'apiBase' is missing. 'publicConfig' reads the manifest's 'web.publicConfig', which
this build bakes into the application entry, so the value is already known here: add
the field to 'web.publicConfig' in velar.json, or widen the declared type` ——
`docs/web-api.md:1229-1233` 逐字承诺了这一条）· **`velar/app` 2/2** ·
**`velar/http`（web）** 5 类 ＋ 7 方法 ＋ 读者全套（`HttpTransportPhase.connect` 的
`values()` 建议编译得过）· **`velar/storage` 6 ＋ 8 成员**（`storage.get("k")` 那条很长
的教学消息**逐字照做编译得过**）· **`velar/forms` 14/14** · **`velar/files` 4/4** ·
**`velar/realtime` 10/10** · **`velar/web-test` 3 ＋ 28 个控制器成员**（在
`.browser.test.vel` 里；在别处导入 → `VEL5062` 点名改名）· **保留绑定 5/5** ·
**VEL6008 平台模块拒绝 7/7 逐字**，与 `docs/standard-library.md:100-106` 相符。

**SVG 区域 fatal（0.30.0 WB-D1 已修）**：

```text
report render|chart failed
<div> ns=html
  <svg> ns=http://www.w3.org/2000/svg attrs=[["aria-label","Chart"],["viewBox","0 0 100 40"]]
    #comment velar:start
    <g> ns=http://www.w3.org/2000/svg attrs=[["role","alert"],["data-velar-fatal",""]]
      <text> ns=http://www.w3.org/2000/svg
        #text "This part of the page could not start: chart failed"
    #comment velar:end
    <circle> ns=http://www.w3.org/2000/svg attrs=[["cx","8"],["cy","8"],["r","4"]]
```

### NO / SV —— Node 0.17 / Server 0.15（97 个导出全部导入，压缩记录）

**NO-D1 对**声明了 `name` 的工程**已闭合，两条传输（4 探针）**：陌生目录无清单 ·
`name` 不同 · `entry` 不同 · 清单不可解析 —— 每一种都服务 `OWN-app-asset` 并对
`secret.txt` 答 `404 {"code":"static.not_found"}`；`/assets/*`、`file()` 路由与原生
监听器传输三条路径一致。**身份不符的报告恰一条并点名两个身份**（2 探针）。
**双候选机制从宿主协议里退场**：`serve.readFile` 回到 `args.length !== 3`、
`serve.respondFile` 回到 `!== 6`（`node-host-worker-serve.js:507, :561`）。

**0.30.0 NO-I2（`Upload.save` 以 cwd 为基）已闭（4 探针）**，且已成文
（`docs/standard-library.md:1266-1268`）。**字面量 `..` 根在构建期被三个构建器各拒
一条、跨度正确（6 探针）**；**运行期的 `..` 拒绝同时点名根与目录（4 探针）**。

**`HttpProblem({code: …})` —— 一条报告、机械修法、`velar fix` 后干净、程序能跑
（一个文件里 7 个站点）**：位置记录字面量 · `options=` 具名形态 · `def` 的 return 里 ·
`throw` 里 · 三个读站点 → `applied 7 mechanical fixes in 1 file; 0 diagnostics
remain` → `Checked 3 modules` → `/one 409 {"…","code":"b.conflict"}`。

**`staticFiles` 根的缺失审计：一次、路径正确、照常服务、去重（8 探针）**。
**`velar run` 的子进程看护（4 探针）**：SIGKILL 后 **1032/1034 ms**、
SIGTERM **13 ms**、SIGINT **13 ms**，四次 `leftover ps` 均为空。
**Worker fail-closed，三家族抛错预载（9 探针）**：45–54 ms exit 1，各自有名字；
**静默预载仍然挂，而文档说了这件事** —— `docs/standard-library.md:1583-1586`：
「A replacement that answers without doing the work it stands for is
indistinguishable from the operation itself, and a released reference that was never
released can still leave a finished program unable to exit.」

**Node 模板的第一个请求不再是 404（2 探针）**：`velar serve p1` 与 `velar dev p1`
从 `/private/tmp` 起都 `/ 200`。**相对静态根解析到工程根**：node 工程四条路径
（7 探针）、server 工程三条路径（3 探针）。**Desktop 与 Web 未被波及（4 探针）**。

**清单 `name` 规则的每一条边界（21 探针）**：接受 —— 缺省 · 100 字符 · 100 码元 emoji ·
`中文项目` · `🚀app`；拒绝且恰一行、点名清单路径 —— `""` · 101 字符 · 101 码元 emoji ·
前导/尾随空格 · 控制字符 · tab · 换行 · `42` · `null` · `["a"]` · `{a:1}` · `true` ·
`"   "` · NBSP 两种。

**模块面**：`velar/fs` **19/19** · `velar/process` 4 ＋ 4 成员 ＋ `async for` ＋ 选项 ·
`velar/env` 2/2 · `velar/host` 2/2 · `velar/terminal` 1 ＋ 6 成员（文档片段逐字）·
`velar/path` 11/11 · `velar/http`（node）6 方法 ＋ `secretHeader` ＋ 全部读者（文档片段
逐字）· `velar/serve` **41/41 导入**且文档例子（`docs/standard-library.md:925-941`）
逐字编译 · `velar/websocket` 9/9 ＋ 12 成员 · `velar/server-test` 3/3 ＋ 11 成员 ·
`velar/server` 5/5 · Server 的 `velar/realtime` 7/7 ＋ 4 个 `RealtimePeer` 成员
（`packages/server/README.md:33-58` 例子逐字）。

**0.30.0 NO-U1 / NO-U7 已成文**（`docs/standard-library.md:1034-1039` / `:1069-1073`）。

### DT —— Desktop 0.10（44/73 名，压缩记录）

`velar/desktop` 20/20 · `velar/window` 8 ＋ 6 个 `Window` 成员 ＋
`WindowStateStream.next/close` · `velar/notification` 6/6 · `velar/secure-storage`
3/3 · `velar/service` 7/7 —— 清单授权到位后全部编译干净。权限拒绝规则对七个模块全部
生效（规则正确，消息形状见 DT-D1）。

### GA —— 门禁与工具（约 230 个探针，压缩记录）

**六个模板全部干净到货（24/24）**：`check` · `format --check` · `test` · `build`
各 exit 0；`fix` 六次 `applied 0 mechanical fixes; 0 diagnostics remain`；
`format` 六次 `Formatted 0 of N`（源码 `shasum` 前后不变）；`test` 得
`1|2|1|1|2|1 passed, 0 failed`。可运行产物已核实：`node dist/main.js`（node）
`/ 200` 与 `/api/hello {"message":"Hello from VelarScript Node","target":"node"}`；
`dist/index.js`（library）在 Node 里 import 返回
`{"message":"Hello, Audit!","recipient":"Audit"}`；`velar preview`（web）
`Verified build: 15b4e44a…` / `GET / HTTP=200`；`velar package`（desktop）
`Packaged Desktop application -> …/dist/desktop/p-desktop.app`。

**三条承诺的机械修法全部落地且事后 `velar check` 干净（3/3）**：`HttpProblem` 的
`code:` → `reason`；`hsl` 百分号（顶层与 `look:` 块内各一）→
`applied 2 mechanical fixes in 1 file; 0 diagnostics remain`；`TaskTimeoutError` →
`TimeoutError` 同时改类型位与值位。

**`velar create` 写 `name` 与 0.32.0 那句逐字相符（14 项）**：大小写、空格、标点、
文字系统全部保留，截到 100，纯空白 → `velar-app`；每一种 `velar check` 都 exit 0。

**`velar repro` / `skill` / `graph`（18/18）**：`repro` 在失败工程上写出 bundle 并
自检（`The extracted bundle produces the same diagnostics.`），README 带
`Versions: velar 0.32.0 · node v24.15.0 · darwin arm64`、逐字的
*What the compiler said*、只用工程相对路径、以及「Nothing was uploaded」——
`docs/cli.md:169-180` 的每一项都核实过；`skill` 六次打印**逐字节相同**的 Core 简报
（`shasum 1b9068478c989249ebcb91c7e09ecc258fc9e8ce` ×6）；`graph` 六次 exit 0，
`--focus App --depth 2` → `scope=focus:"App" depth:2 nodes=28 edges=74`，
`--depth 9` exit 2。

**`velar dev` 六个模板（6/6）**：`--port 0` 绑到临时端口且打印的就是它，
`GET / 200` 且 `<title>` 是工程自己的；**SIGTERM → exit 0，零孤儿**。

**22 条命令的文档双向覆盖**：`commandNames` 里的 22 条全部出现在 `docs/cli.md` 的
围栏里，反之亦然 —— **没有一条被文档记载却不存在，也没有一条存在却没有文档**。
Advisory 通道逐字符合文档并 **exit 0**；每一次 `velar check` 失败都以
`Run 'velar repro' …` 结尾。

**六条只读门禁全绿**（实测退出码）：`check-file-budget` · `check-module-map` ·
`check-runtime-boundary` · `check-surface-versions` · `check-runtime-sources` ·
`check-fence-format` 均 `exit=0`。

**0.32.0 的 D115 P4 断言成立**：`file-budget-allowlist.json` 里 15 个超 800 行的文件与
7 个超 120 行的函数**没有一个**在 `packages/web` / `packages/node` / `packages/cli` 的
`src` 下。`check-module-map` 自报：「every directory holding source is declared …
0 functions over 120 lines inside a composition root … 0 cycles among 632 modules and
2272 relative value imports」。

**0.31.0 的第 5 遍散文门禁成立**：`prose: 11 files, 49 version sites, all read against
velar 0.32.0`；`proseVersionFiles`（`check-surface-versions.mjs:360-370`）算出的正是
两个根 README ＋ `docs/getting-started.md` ＋ 八个包 README ＝ **11 个文件，与
CHANGELOG 那句逐字相符**。

**T3b 的五项成立**：`consistency 107` · `viaHelper 98` · `viaRoster 99` ·
`unclassified 0`，例外表 4 条；`tests/repo/no-unused-locals.test.ts` 与
`tests/server/server-static-root.test.ts` 在位；`.slow.test.ts` 今天 25 个文件。
**GA-I1（0.30.0）已闭**：`grep -c browserStopGraceMs
scripts/check-runtime-boundary.mjs` → 2。

---

## 「held」—— 0.30.0 findings 的今日状态

| 0.30.0 ID | 今日 | 一句话 |
|---|---|---|
| CO-D1 `Pair` arity | **holds** | `Pair<A>` / `Pair<A,B,C>` 各一条 VEL2012 |
| CO-D2 extern class 收 guided 拼写 | **部分** | 23 个名字已拒；`any` 仍被收下 → 本文 CO-D2 |
| NO-D1 搬走的 `dist/` 服务陌生人的 `public/` | **部分（安全形状）** | 声明 `name` 的工程已闭合并有报告；**没声明 `name` 的工程原样中招** → 本文 NO-D1 |
| NO-D2 加载前投毒 `Worker.prototype.unref` | **holds** | 三家族 45–54 ms exit 1，各自有名字；静默投毒仍挂且已成文 |
| NO-D3 `velar run` 不看护子进程 | **holds** | SIGKILL 后 ~1.03 s、SIGTERM/SIGINT 13 ms，零孤儿 |
| WB-D1 SVG 区域 fatal 是 HTML `<section>` | **holds** | `<g role="alert">` ＋ `<text>`，命名空间正确 |
| CO-I1 VEL3004 别名建议死路 | **部分** | 两形态已合并成一句且改法可编译；保留下来的那支改法编译不过 → 本文 CO-I1 |
| CO-I2 `velar-allow A18` 永不过期 | **holds** | 陈旧压制报 VEL1012，无环模块里也报 |
| CO-I3 extern class 位说「a class」 | **部分** | 措辞已统一；下划线跨度仍两套 → 本文 CO-I13 |
| CO-I4 导入 Core prelude 名双报 | **holds** | 一条 |
| CO-I5 `for … in` 的 unknown 级联 | **部分** | 错误产生的 unknown 已干净；真类型错仍级联 → 本文 CO-I9 |
| CO-I6 两个 detached 写手 | **部分** | `velar/async` 已归一；Web 的 `foundation.js` 是第三个写手 → 本文 WB-D1；计数句 → 本文 CO-I12 |
| CO-I7 `Pair` 印成 `Object` | **holds** | 打名字 |
| CO-I8 `??` 右臂旧报告 | **部分** | 记录类型一条；类类型仍印 `Foo \| {  }` → 本文 CO-I14 |
| WB-I1 只收 `Length` 的构建器双报 | **holds** | 单报并点名槽位 |
| WB-I2 「only 0 is unitless」而零被拒 | **holds** | `blur(0)` 给 `write 0px` |
| WB-I3 陈旧读改法不编译 | **holds** | 三种形状的改法逐字编译得过 |
| WB-I4 `const` 字段假阳性 | **holds** | 完全静默 |
| WB-I5 `hsla` 双报 | **holds** | 一条 VEL6007 |
| WB-I6 keyframes 停靠点双报 | **holds** | 块级总结已删 |
| WB-I7 折叠绑定 caret 错位 | **holds** | 指向初始化处并点名绑定 |
| NO-I1 `HttpProblem({code:…})` 构造点 | **holds** | 一条、点名 `reason`、`velar fix` 一次改完 7 个站点（变量记录形态例外 → 本文 NO-I2） |
| NO-I2 `Upload.save` 以 cwd 为基 | **holds** | 以工程为基；已成文 |
| NO-I3 Worker 释放失败被吞 | **holds** | 失败即模块失败，有名字 |
| GA-I1 `browserStopGraceMs` 未钉 | **holds** | 钉了 2 处 |
| GA-I2 发布方收窄丢叶子 | **holds** | `viaRoster` 99 条 |
| GA-I3 `cli` 当普遍救生圈 | **holds（改记法）** | `viaHelper` 98 条，记录而不当发现 |
| CO-C1 格式化器 120 列 vs 宪章 | **holds** | §2 改写为真规则，实测 120/121 分界与之相符 |
| CO-C2 §11 举例用保留名 | **holds** | 已改 `BudgetError`（该行本身编译不过 → 本文 CO-C4） |
| CO-C3 A18 每条边一次 | **holds** | 每个强连通分量一条 |
| WB-C1 `tick()` 跨过坏更新 | **holds** | 每个挂起的 `tick()` 都被 reject；有认领者时报告通道静默 |
| CO-U1 `--stack` 减信息 | **holds** | 只加不减 |
| CO-U2 内联运行时帧按路径隐藏 | **holds** | `__velarRequired` 被保留名前缀抓住 |
| CO-U3 `NarrowingError` 帧重复 | **holds** | 一条 |
| CO-U4 `char(-1)` 从尾部读 | **holds** | 编译期拒负字面量，运行时 IndexError |
| CO-U5 被拒类型参数每次使用再报 | **holds** | 一条 |
| CO-U6 / CO-U7 / CO-U8 | **holds** | 宪章 2487-2489 · `TimeoutError` 表加段 · `at Handle.dispose` |
| WB-U1/U2/U3 `tick()` 认领 | **holds（成文）** | 宪章 §16 与 `web-api.md` |
| WB-U4 探测器只点名底层字段 | **holds** | 同时点名 getter 与字段 |
| WB-U5 VEL5077 的边界 | **holds（成文）** | 宪章 §15 |
| NO-U1 树内 `dist/` 读不到自己的 `dist/public/` | **holds（成文）** | `standard-library.md:1034-1039` |
| NO-U2 `..` 根静默逃出工程 | **holds** | 构建与运行两端都拒（折叠形态例外 → 本文 NO-I7） |
| NO-U3 不存在的根只在请求期 404 | **部分** | `staticFiles` 根启动时审计；`file()`/`fileResponse` 根与未烤偏移仍静默 → 本文 NO-C1 |
| NO-U4 / NO-U5 | **holds（成文）** | 13 号路径的 `--stack`、加载前 `MessagePort` 投毒 |
| NO-U6 就绪期限失败是原始崩溃转储 | **未闭** | 产品构建仍先打压缩运行时行，无 `.vel` 帧 → 本文 NO-I4 |
| NO-U7 只抛出路由的 `openapi()` | **holds（成文）** | `standard-library.md:1069-1073` |
| GA-U3 Node 平台测试不进快层 | **holds** | 已拆出快层 |
| GA-U4 `projectRootOffset` 无测试 | **holds** | `tests/server/server-static-root.test.ts` |
| GA-U5 `noUnusedLocals` 无测试 | **holds** | `tests/repo/no-unused-locals.test.ts` |
| GA-U1 / GA-U2 / GA-U6 | **holds（成文）** | `docs/contributing/gates.md`「只有重层持有的」小节 |

**统计**：0.30.0 的 51 条里 **38 条 holds**、**10 条部分闭合**、**1 条未闭**
（NO-U6），另有 2 条（GA-I2 / GA-I3 的十条归属抽样）本轮只核对了生成物的总数与新增的
`viaRoster` / `viaHelper` 两栏，未逐条复验。

---

## 汇总（计数按面 × 类）

| 面 | DEFECT | INCONSISTENT | CHARTER-DRIFT | UNDEFINED | 合计 |
|---|---|---|---|---|---|
| **CO** Core 0.8 | 2 | 17 | 4 | 5 | **28** |
| **WB** Web 0.14 | 1 | 2 | 1 | 4 | **8** |
| **NO** Node 0.17 | 3 | 9 | 1 | 6 | **19** |
| **SV** Server 0.15 | 0 | 0 | 0 | 1 | **1** |
| **DT** Desktop 0.10 | 1 | 0 | 0 | 2 | **3** |
| **GA** 门禁与工具 | 3 | 6 | 0 | 8 | **17** |
| **合计** | **10** | **34** | **6** | **26** | **76** |

其中 **10 条是 0.30.0 findings 的未闭残留**（CO-D2 · CO-I1 · CO-I9 · CO-I12 ·
CO-I13 · CO-I14 · WB-D1 · NO-D1 · NO-C1 · NO-I4）。

按证据形态：**改法编译不过 5 条**（CO-I1 · CO-I2 · CO-I3 · CO-I4 · CO-I5）·
**消息点名错槽位 7 条**（CO-I6 · CO-I7 · CO-I8 · WB-I1 · NO-I1 · NO-I2 · GA-I1）·
**一个错误多条报告 4 族**（CO-I9 · CO-I10 · CO-I11 · NO-I3）·
**文档写了不存在的成员 1 条**（`Math.sign` / `Math.trunc`）·
**存在却全库无文档的活成员 39 个**。

---

## 本文的出身

本文由 0.32.0 审计代理在隔离 worktree `/private/tmp/velar-d114/f5-web`
（分支 `audit/0.32.0`，HEAD `0f7d79d8` ＝ 0.32.0 的 main）完成。**只读仓库、只写本
账本**；未派实施代理，未提交任何 git 写操作，未运行 `npm test` / `npm run gate` /
`release:check`。唯一运行过的构建是一次 `npm run build:packages`（任务书要求），
仓库脚本只跑了六个只读门禁与一段一次性的 `surfaceInventory()` 查询（写在会话草稿
目录里）。`check-surface-versions` 的拒绝路径用 `--prose-root` 指向草稿目录里的一份
拷贝触发，**仓库文件一个字节都没动**。

Core / Web / Desktop 三面的 0.31 / 0.32 条目与面清册对照由编排代理逐条实测；
Node / Server 面、门禁工具面与五面的成员抽样由三个受同样只读约束的探针代理跑出。
**头条结论由编排代理独立复验**：NO-D1 在一个全新的 `velar create --template node`
工程上从头复现（删掉 `name` → 构建 → 拷到陌生 `public/` 旁 → 两条传输都服务了陌生人的
`secret.txt`；补回 `name` 后同一攻击 404 并给出身份不符报告）；GA-D1 / GA-D2 / GA-D3
各自在新建工程上重跑；CO-C1（`Math.sign`/`trunc`）、CO-I2（`type Map:` 死路）、
CO-I6（具名实参 caret）、CO-I7（VEL6007 caret）、WB-C1（`velar/look` 具名导入）、
WB-I3（A16 未被 `velar fix` 施加）逐条重跑。

探针工程、宿主脚本与 document 替身在
`…/scratchpad/audit-0.32/{co,wb,no,gt,sv,dt,verify}/`，不入仓；每个探针服务器都绑定
`PORT=0` 并在探针结束时终止。收尾核对（`lsof -iTCP -sTCP:LISTEN -P | grep node`）
无本轮遗留监听 —— 唯一在听的是所有者自己的 `velar dev --port 7173`（pid 14250，
另一个仓库）。

**本轮未能探到的**：`velar/desktop-test`（29 个导出，需 `velar test --browser` 与一次
Playwright 运行）· `look-property` 的 225 个属性名与 21 个 hook/target/media-feature
（只抽样了构建器与六个属性的取值检查）· Core 的 29 个退役拼写与 18 条 advisory 中的
大部分（只探了 5 条退役导入与 A3 / A12 / A16）· 一切**运行期**语义（面抽样全程只跑
`velar check`；`Text.normalize("a","NFX")` 之类的运行期契约只证实编译，未证实抛出）·
`velar --version` 的按工程裁剪（需一次真实 `npm install` 的工程，需网络）·
`velar/fs` 与 `velar/process` 两族的就绪期限（只触发了 terminal 一族，每族一次要花
30 秒墙钟）· `velar dev` 下缺失根是否也会把什么变红。
