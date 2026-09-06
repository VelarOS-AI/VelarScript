# 完整性审计 —— 0.30.0 新增面（2026-09-06，约 260 个探针）

审计对象：**0.30.0（`a0231a4`）这一版新增的表面** —— D115 §六「每版一审」的第一次
执行。范围由 `CHANGELOG.md` 的 `## 0.30.0` 段与 D114 的七段落地记录（「定案：P6
设计层十三项」·`F5-core 落地`·`F7-core 落地`·`F7-web 落地`·`F7-web-b 落地`·
`F7-node 落地`·`F7-node-b 落地`·`F7-node-c 落地`）划定；每一波自己记下的
**caveat 就是本轮的第一批探针**（`Upload.save` 的进程工作目录、SVG 命名空间里的
fatal 元素、只收 `Length` 的构建器双报、`browserStopGraceMs` 未被钉住）。

方法学沿用 [[COMPLETENESS-AUDITS]] 审计一与三份 0.29.0 账本：对每个特性面做
**charter / 文档承诺 vs 编译器与运行时行为 vs 作者合理预期** 的逐条对照，目标是
消灭未定义而不是找 bug；DECIDED-AND-CORRECT 必须记录，否则「完整」无法凭失败清单
成立。**消息质量是契约的一部分**：一个错误 → 一条报告 → 那条报告给的改法编译得过。

探针在隔离 worktree `/private/tmp/velar-d114/audit-p6a`（分支
`audit/p7-0.30.0-surface`，HEAD `a0231a4` ＝ 0.30.0 的 main）的已构建 `dist` 上实测：

* **Core**：`node packages/cli/dist/cli.js check|run|format|fix <file>`（独立模式，
  无 `velar.json`），跨模块与 advisory 用一个 `formatVersion: 2` 的草稿工程。
* **Web**：草稿工程钉 `"surfaces": {"core": "0.8", "web": "0.14"}` 并把
  `packages/web` 软链进 `node_modules/@velarscript/web`，编译期用单文件 `check`；
  运行期用**仓库自己的 document 替身**（`tests/support/document.ts`）加一段
  prelude（`createElementNS`、命名空间可见的 `dumpTree`、
  `globalThis.__velarDevelopmentHooks.frozenRead`），经
  `node --input-type=module` 执行编译产物 —— 挂载、区域重建、生命周期次序、
  fatal 元素的命名空间都可观测，**无浏览器**。
* **Node / Server**：`formatVersion: 2` + `"extensions": ["@velarscript/node"]` 的
  Node 草稿工程，HTTP 用 `node:http` / `fetch` 宿主脚本驱动，服务器一律 `port=0`
  并从程序自己的 stdout 读实际端口；Worker 原型投毒用 `--import` 预载脚本
  （加载前）与定时补丁（加载后）两种；旧协议形态直接对着构建出的
  `velar/node-host-v1` 调。
* **gates**：只读地读 `tests/ownership.generated.json`、`scripts/gate-scope.mjs`、
  `docs/decisions/D116-SCOPED-GATES.md`，以及只读脚本
  `scripts/check-surface-versions.mjs` 与一段一次性的 `surfaceInventory()` 查询。

输出逐字引用。探针文件在 `/private/tmp/velar-d114/scratch-p7/`，不入仓。

> **本轮的自伤记录（沿 0.29.0 Web 账本的规矩）**：我给 document 替身补的
> `textContent` 存取器最初对**文本节点**也走「清空子节点再 append」的分支，于是
> 「prop 读不实时更新已渲染文本」看起来像一条 DEFECT，直指 web-api 第 300 行的
> 围栏。补正替身（`nodeType === 3` 时就地写 `value`）后，DECIDED-AND-CORRECT 的
> 「插值区域重建」一条证明文档写的两条语义**逐字为真**。替身的缺陷不是被审对象的
> 缺陷 —— 本轮所有运行时结论都在替身补正之后复测过。

分类：**DEFECT**（编译通过后崩溃/静默错误，或工具产出坏源码）· **CHARTER-DRIFT**
（文档与实现不符）· **INCONSISTENT**（两条相关规则互相矛盾；含：同一个错误报两次、
一个意思两种拼写、一条消息给的改法编译器随后拒绝）· **UNDEFINED**（文档沉默、
行为偶然 —— 记下的实测行为即应成文的答案）· **DECIDED-AND-CORRECT**（探过且正确
—— 完整性凭证）。

审计面与前缀：**CO** Core 0.8（约 130 个探针）· **WB** Web 0.14（约 50 个）·
**NO** Node 0.17 / Server 0.15（70 个：`HttpProblem.reason` 14 · 静态 root 11 · 退出 13
10 · Worker 引用记账 23 · 就绪期限 3 · 旧协议形态 9）· **GA** 按范围门禁的盲区
（约 10 个）。

---

## DEFECT

### CO-D1 —— `Pair` 的类型实参个数**不检查**，少一个就把 `unknown` 静默放进程序

0.30.0 把 `Pair<A, B>` 加成 Core 常驻记录类型，`zip` 的结果因此可以注解。但
`Pair` **没有进 arity 表**：`packages/compiler/src/parser/type-syntax.ts:140`

```ts
const expectedArguments = typeName === "Map" ? 2 : typeName === "List" || typeName === "Set" || typeName === "Record" || typeName === "Promise" || typeName === "Type" ? 1 : null;
```

而 `types/from-syntax.ts:54` 按 `arguments_[n] ?? unknownType` 构造两个字段。
后果：**多一个实参不报，少一个实参把第二个字段变成 `unknown`**。

```text
$ cat p05.vel
@main:
    const p: Pair<string, number, bool> = {first: "a", second: 1, third: true}
    print(p.first)
$ velar check p05.vel
p05.vel:2:67 error VEL4001: Object has no field 'third'
```

—— 只报了记录字面量多写的字段，`Pair<…, …, …>` 三个实参一个字都没说。对照组：
用户泛型与 `List` 都报：

```text
p09.vel:6:14 error VEL4001: Generic type 'Sides' takes 2 type arguments, not 3; write 'Sides<A, B>'
p10.vel:2:14 error VEL2012: Type 'List' expects 1 type argument
```

少一个实参更糟 —— 编译干净，第二个字段成 `unknown`：

```text
$ cat p12.vel
@main:
    const p: Pair<string> = {first: "a", second: 5}
    print(f"{p.second}")
$ velar check p12.vel
p12.vel:3:14 error VEL4026: An f-string renders strings, numbers, bools, enums, null, and extension values
  with a declared text form; format unknown explicitly — print(value) to inspect it, …
```

作者没写过 `unknown`，也没跨任何边界，一个漏掉的类型实参就把静态承诺撤了。
**零实参是有检查的**（`Generic type 'Pair' needs 2 type arguments; write 'Pair<A, B>'
with concrete types`）—— 所以这一格不是「Pair 不检查 arity」，而是「只检查 0，不检查
1 和 3」，最像是漏了一行表。

### CO-D2 —— extern 契约把**每一个带替换名的 guided spelling** 当作合法类名接受，声明出的类没有任何注解够得着

0.30.0 的 CHANGELOG 写：

> a declaration spelled with a Core type name is refused in every declaring
> position the 0.29.0 rule missed — a type parameter (…) and **an extern class in
> either extern form**

extern class 位的判据在 `packages/compiler/src/parser/statements/classes.ts:715`：

```ts
const refusal = head.kind === "identifier" ? null : refusedDeclarationName(head);
```

**`head.kind === "identifier"` 时根本不问 parser 的名册**。于是保留字
（`null`）被拒、Core 类型名与 `object`/`Object`/`Callable` 被 analyzer 拒，而
`sourceTypeGuidance` 里**十一个带替换名的拼写全部通过**：

```text
$ for n in str Array array list dict set String Number boolean Boolean void; do …
str        Checked 1 module …
Array      Checked 1 module …
array      Checked 1 module …
list       Checked 1 module …
dict       Checked 1 module …
set        Checked 1 module …
String     Checked 1 module …
Number     Checked 1 module …
boolean    Checked 1 module …
Boolean    Checked 1 module …
void       Checked 1 module …
```

同一批名字在 `class` / `type` / `enum` / 类型参数位都被拒（`parser.ts:1228`
`parseDeclarationName` 无条件问同一个名册）：

```text
z_Array.vel:1:7 error VEL3007: 'Array' is guided to 'List' in every type position, so it cannot name a class; every use of it would read as 'List'
```

代价不是「多一条漏网」，而是**声明写得下、每一个使用都被拒**，正是这条规则存在的
理由所要防的形态：

```text
$ cat y2.vel
extern module "text-tools":
    export class Array:
        get label() -> string

    export def make() -> Array

@main:
    const v = make()
    print(v.label)
$ velar check y2.vel
y2.vel:5:26 error VEL2012: Use 'List<T>' for ordered collections; VelarScript exposes one source-level List type
    export def make() -> Array
                         ^^^^^
y2.vel:8:15 error VEL3001: Unknown name 'make'
              ^^^^
```

两条报告都在**使用**处，都不说「问题在类名」，而且第二条把整个 extern 块的其它
导出也一并判成未知名。

两种 extern 形态共用 `parseExternContract` → `parseExternClass`，但只有
`extern module "…":` 真的暴露 —— `extern js\`…\`:` 里契约名必须与 JavaScript 源码的
具名导出逐字相同，而 JS 侧那一关先拦下了：

```text
xjs1.vel:2:18 error VEL2037: JavaScript export "Array" cannot enter VelarScript scope; export it under a valid, non-reserved VelarScript binding name
xjs1.vel:4:5  error VEL2037: Inline JavaScript contract declares 'Array', but the source has no named ESM export 'Array'
```

—— 挡住它的是另一条规则，而且第二条报告仍然不说「`Array` 不能命名一个 extern class」。
保留字（`export class null:`）在两种形态里都正确地报一条 VEL3007。

### NO-D1 —— 搬走的 `dist/` 会去服务**别人的** `public/`：相对 root 的两个候选按「哪个目录存在」二选一

这是本轮最重的一条，也是本文唯一一条**安全形状**的发现。

第 13 项把相对 `root` 解析成两个候选（`packages/node/runtime/serve.js:1008`
`__velarServeApplicationRoot`）：`<入口目录>/<烤进的偏移>/<root>`（在树内的构建与
`velar run`）与 `<入口目录>/<root>`（搬迁后的产物）。挑选的判据只有**存在性**
（`packages/node/runtime/node-host-static-file.js:33` 与
`packages/node/runtime/serve-listener.js:119`，两条传输同一段代码）：

```js
try {
  const resolved = await realpath(primary);
  if ((await stat(resolved)).isDirectory()) return resolved;
} catch { /* The project root the build knew is not here; this output moved. */ }
return realpath(resolve(boundedPath(relocatedValue, "fileResponse")));
```

没有任何一步证明那个目录属于这个应用。把 `dist/` 拷到 `deploy/app/`，而
`deploy/` 下恰好已经有一个**陌生人的** `public/`：

```text
$ tree（要点）
deploy/public/hello.txt     "FOREIGN-sibling-asset"
deploy/public/secret.txt    "FOREIGN-SECRET"
deploy/app/                 ← 拷贝过来的 dist/
deploy/app/public/hello.txt "OWN-app-asset"      ← 应用自己带的资源

$ cd /private/tmp && node deploy/app/main.js
LISTENING 51372
$ node client.mjs 51372
/assets/hello.txt  200 "FOREIGN-sibling-asset\n"
/assets/secret.txt 200 "FOREIGN-SECRET\n"
/direct            200 "FOREIGN-sibling-asset\n"
```

应用自己的 `deploy/app/public/hello.txt` 一次都没被读到；`secret.txt` 是应用从未
发布过的文件。`/assets/*` 走特权宿主传输、`/direct` 走原生监听器传输 ——
「一条规则、两种传输」是自洽的，两边**都**错。把 `dist/` 部署到 `/srv/app/` 而
`/srv/public/` 已经存在，就等于把 `/srv/public` 发布到公网，零诊断。

工程外的 `--out-dir` 烤进空偏移，因而免疫（同一段代码的 `if
(__velarServeProjectRootOffset === "") return {root: beside, relocated: null};`）——
**同一个程序安不安全取决于它是在哪里被构建的**。

### NO-D2 —— 在运行时加载**之前**污染 `Worker.prototype.unref`：程序跑完、进程永不退出、三个家族全中、零输出

三个 Worker 家族都在**加载时**捕获 `Worker.prototype.unref`
（`node-host.js:34` / `process.js:157` / `terminal.js:37`）—— 这防住了「之后」的
污染（F7-node-c 的成果，本轮复验有效），却原样收下了「之前」就装好的污染
（APM / OTel 探针正是这样打 `worker_threads` 的补丁）。而释放路径把失败吞掉：

```js
function __velarNodeHostReleaseWorker() {
  try { __velarNodeHostCall(__velarNodeHostWorkerUnref, __velarNodeHostWorker, []); return true; }
  catch { return false; }
}
```

（`packages/node/runtime/node-host.js:177`，`process.js:232` / `terminal.js:166` 同形。）
三个 boot 文件调用它并**丢掉返回值**（`node-host-boot.js:34`、
`process-worker-boot.js:37`、`terminal-boot.js:36`）。实测（只污染 `unref`）：

```text
### velar/terminal      poison=""             ELAPSED   58ms EXIT 0    STDOUT="terminal only\nend\n"
### velar/terminal      poison="worker.unref" ELAPSED 8007ms EXIT null SIG SIGKILL  STDOUT="terminal only\nend\n"
### node host (velar/fs) poison=""            ELAPSED   90ms EXIT 0    STDOUT="node-host only 101\nend\n"
### node host (velar/fs) poison="worker.unref" ELAPSED 8005ms EXIT null SIG SIGKILL
### velar/process       poison=""             ELAPSED   75ms EXIT 0    STDOUT="process only 0\nend\n"
### velar/process       poison="worker.unref" ELAPSED 8007ms EXIT null SIG SIGKILL
```

**`velar run` 的 13 号网也接不住** —— 那是一个 `beforeExit` 处理器，而事件循环
从未排空：

```text
ELAPSED 20008ms EXIT null SIG SIGKILL
--- STDOUT ---   process only 0 / end
```

对照：加载前污染 `Worker.prototype.ref` 与 `Worker.prototype.terminate` **都没事**
（各 exit 0）—— F7-node-c 的自有属性钉法生效；`unref` 是唯一一个还留在原型路径上
且失败被吞掉的成员。

### NO-D3 —— `velar run` 不看护自己的子进程：启动者被杀，程序与它占的端口留在原地

`packages/cli/src/program-runner.ts:73` 用 `spawn(..., {stdio: "inherit"})` 起程序并
转发 SIGINT/SIGTERM，但**没有** `watchParentDeath` / `guardChildOnExit` ——
而 B1/B2 恰恰给同仓的另外三处装上了（`dev-server.ts:318`、`preview-server.ts:133`、
`browser-process-owner.ts:165` 与 `:252`）。

```text
program listening on 50707; velar run pid = 56969
children of the velar run pid: "56970"
--- SIGKILL 掉 velar run 之后 ---
COMMAND   PID USER   FD   TYPE  DEVICE  NODE NAME
node    56970  mac   15u  IPv4  0x22…   TCP localhost:50707 (LISTEN)
```

本轮**独立复现了两次**：审计代理在切到进程组杀法之前留下的 `pid 13670` 与
`pid 32939`，两个都以 `PPID 1` 继续持有端口，是由编排代理在自己的收尾核对里发现的。
B1 的整条论证（「启动者一死，什么都不该留下」）在 `velar run` 这一格没有落地。

### WB-D1 —— SVG 命名空间里的区域 fatal 元素是 **HTML `<section>`**，插在 SVG 内容里不渲染

F7-web 自己把这一格记成「边角，未演练」。0.30.0 的行为（本轮实测，供正在飞的修复
作基线）：`__velarFatalNode` 无条件建 HTML 元素 ——
`packages/web/runtime/emitted-components.js:87`

```js
const fallback = __velarDomCreateElement("section");
```

而同一个包的其它区域机器是**认命名空间的**（`web-routing.js:111` 用
`__velarDomCreateElementNS("http://www.w3.org/2000/svg", "g")`）。实测（document
替身补了 `createElementNS`，树打印带命名空间）：

```text
$ node webrun2.mjs svg1.vel dev.prelude.js svg1.js
report render|region failed
<div> ns=html attrs=[]
  <svg> ns=2000/svg attrs=[["aria-hidden","true"]]
    <g> ns=2000/svg attrs=[]
      #comment velar:start
      <section> ns=html attrs=[["role","alert"],["data-velar-fatal",""]]
        #text "This part of the page could not start: region failed"
      #comment velar:end
```

HTML 面对照组正确（`<section>` 落在 `<div>` 里，兄弟 `<b>sibling</b>` 照常）。
浏览器里 SVG 内容模型不渲染无 `<foreignObject>` 包裹的 HTML 元素，所以 web-api 的
「covers every initial-render path」在 SVG 区域里仍然是假的 —— 读者与辅助技术都拿
不到那句话，而这正是这个标记存在的全部理由。

---

## INCONSISTENT

### CO-I1 —— VEL3004 的**同拼写**分支给出的改法，被 0.30.0 的新规则拒绝

`analysis/scopes.ts:366` 对「同一个名字从同一模块导入两次、拼写相同」说：

```text
main.vel:2:9 error VEL3004: Name 'title' is already imported from "./lib.vel"; alias one of the imports — import {title as other}
```

照做：

```text
$ cat src/main.vel
import {title} from "./lib.vel"
import {title as other} from "./lib.vel"
$ velar check .
main.vel:2:9 error VEL3004: Name 'title' is already imported from "./lib.vel" as 'title'; importing it twice binds one value under two names — drop this import and use 'title'
```

一个错误、两轮 `velar check`、第一条消息的改法是第二条消息的错误。0.30.0 恰恰是
把别名形态并进 VEL3004 的那一版，别名建议因此成了这一版自己造出的死路 ——
而且**同一个测试文件把两边都钉住了**：
`tests/cli/import-duplicates.test.ts:46` 断言别名形态被拒，`:80` 断言同拼写形态给
「alias one of the imports」。两条断言都绿，矛盾在测试里被固定了下来。设计意图是
清楚的（该文件头注：同拼写时「the scope collision already names it, and this would be
a second report of one mistake」）—— 保留旧那条本身没错，错的是它随身带的那句
**早于 0.30.0** 的建议。

### CO-I2 —— `velar-allow A18` **永不过期**，宪章第 3 条规则对工程图 advisory 不成立

宪章的三条压制规则写着每条都由「an ordinary diagnostic」强制。第 2 条（必须给理由）
对 A18 成立：

```text
src/a.vel:1:35 error VEL1011: A 'velar-allow' comment must give a reason: write '// velar-allow A18: why this spelling is intended'
```

第 3 条（过期即错）不成立 —— 把 `// velar-allow A18: nothing here` 放在一条根本不
报 A18 的行上：

```text
$ velar check .
… 三条 A18 advisory …
Checked 7 modules from … — 3 advisories
```

没有 VEL1012。对照 A1 同形态：

```text
a2.vel:2:27 error VEL1012: No A1 advisory is reported on this line, so this 'velar-allow' suppresses nothing; delete it
```

根因在 `advisory-suppression.ts:177` 与 `:287`：过期检查显式排除工程图码
（`!PROJECT_GRAPH_ADVISORY_CODES.has(suppression.code)`），而后来应用延后压制的
`applyDeferred…` 只过滤、不报告：

```ts
if (deferred.length === 0 || advisories.length === 0) return advisories;
```

结果：一条腐烂的 A18 压制可以永远留在 import 行上，误导后来的读者 —— 正是宪章
第 3 条明写要防的事。

### CO-I3 —— extern class 位上，lexer 名册的名字报的位置名词是「class」而不是「extern class」

同一个位置，两条路径两种措辞（并且下划线跨度也不同 —— 名册名下划整行，lexer 名
只下划名字）：

```text
x_Object.vel:2:5  error VEL3007: 'Object' is a guided spelling no type position accepts, so it cannot name an extern class; …
x_bool.vel:2:5    error VEL3007: 'bool' is a Core type name, so it cannot also name an extern class; …
x_int.vel:2:18    error VEL3007: 'int' is guided to 'number' in every position, so it cannot name a class; …
x_NaN.vel:2:18    error VEL3007: 'NaN' is not a literal in VelarScript, so it cannot name a class; …
```

`lexer/identifiers.ts:143` 的 `declarationNameNoun` 只认 `class`/`enum`/`def`/
`const`/`let`/`type` 六个前置词符，extern class 的 `class` 落进第一格，于是作者被
告知「不能命名一个 class」，而他写的是 extern class。

### CO-I4 —— 导入 Core prelude 名报两次，第二条教作者去给 `print` 写 extern 契约

0.30.0 明写「importing a Core prelude name is told the name needs no import」，
第一条报告正确；第二条不该在：

```text
$ cat pr03.vel
import {readText, print} from "velar/fs"

@main:
    print("x")
$ velar check pr03.vel
pr03.vel:1:19 error VEL3007: 'print' is a Core prelude name and needs no import; delete it from the import
pr03.vel:4:5 error VEL4001: Cannot call an unknown JavaScript value without a declaration or validation; declare the signature — an 'extern module' contract or a contracted 'extern js' block gives 'print' a checked type — or validate the data it came from with 'Type.parse' first
```

被拒的导入仍然遮蔽了 prelude 绑定，于是每一个调用点都再报一次，而且报的是一条对
`print` 完全错误的建议。同一位置上 `Promise` 又是第三种措辞、且不带改法：

```text
pr04.vel:1:15 error VEL3007: 'Promise' is a reserved Core binding
```

### CO-I5 —— 由错误而生的 `unknown` 仍在 `for … in` 一格里级联

0.30.0 的承诺是「an `unknown` born from an error poisons nothing downstream」。
实测九种形态干净（成员读、`+`、调用、下标、`match`、`await`、赋给 `List<string>`、
`is` 收窄、传给具名参数），只有循环不干净：

```text
$ cat u03.vel
@main:
    const v = nosuchname
    for item in v:
        print(str(item))
$ velar check u03.vel
u03.vel:2:15 error VEL3001: Unknown name 'nosuchname'
u03.vel:3:17 error VEL4001: Cannot iterate over unknown
u03.vel:4:19 error VEL4026: str() converts strings, numbers, bools, enums, null, …
```

一个拼错的名字、三条报告，后两条都是第一条的影子。

### CO-I6 —— 「Detached task failed:」有两个写手，只有一个过滤帧、只有一个认 `--stack`

0.30.0 写：宿主错误通道「hides Node-internal and compiler-runtime frames like the
uncaught path and honours `--stack`」。发射器那一路确实如此
（`emit/runtime-imports.ts:73` 的 `__velarDetachedTrace`，过滤 `node:` 与
`/node_modules/velar/`）。**标准模块自己那一路不是**
（`packages/core/runtime/async.js:40` `reportAsyncLoser`，直接写
`failure.stack`）。嵌套 `Promise.timeout` 是普通写法，落在后一路：

```text
$ velar run tn1.vel          # 没有 --stack
code=TimeoutError is=true msg=outer budget
Detached task failed: TimeoutError: inner budget
    at Timeout.<anonymous> (file:///…/co/.velar/run-PThxZf/node_modules/velar/async.js:137:558)
    at listOnTimeout (node:internal/timers:605:17)
    at process.processTimers (node:internal/timers:541:7)
```

三帧全是本该隐藏的那两类，没有「(N Node.js internal frames hidden…)」那句，
而且第一帧指向一个**运行结束即删除**的沙箱目录。加 `--stack` 输出逐字节相同
（两次运行的差别只有沙箱目录名）。同一个句首、两种行为。

对照组 —— 同一条 CHANGELOG 里的**释放失败**通道完全正确：

```text
$ velar run ds1.vel
Resource release failed while another error was in flight: Error: release blew up
    at Handle.__velar:dispose (/…/ds1.vel:5:15)
    at work (/…/ds1.vel:9:17)
    at <anonymous> (/…/ds1.vel:13:9)
  (2 Node.js internal frames hidden; rerun with 'velar run --stack' for the full trace)
caught: body blew up
```

`--stack` 把两帧加回来。所以缺的不是机制，是 `velar/async` 那一路没接上它。

### CO-I7 —— `Pair` 在诊断里有两种打印法

赋值消息打名字，成员未命中消息打结构名：

```text
p13.vel:3:23 error VEL4001: Cannot assign Pair<string, number> to number
p02.vel:4:14 error VEL4001: Object has no field 'frist'; did you mean 'first'?
```

具名类型两处都打名字（`Type 'User' has no field 'nmae'; did you mean 'name'?`）。
D114 第 10 项写的是「诊断只对无名结构打印结构拼写，有名的打印名字」，`Pair` 是
结构记录，于是它在自己被命名的那条消息里仍然叫 `Object`。

### CO-I8 —— `??` 右臂的空记录字面量**收到了**期望类型，但旧的那条报告没撤

0.30.0 写「an empty record literal in a `??` right arm receives the expected type」。
后一条报告证明它确实收到了；前一条是本该消失的那条，而且打印出一个作者写不出来的
结构拼写（`{  }`，两个空格）：

```text
mq5.vel:6:23 error VEL4001: Cannot assign Config | {  } to Config
    const d: Config = c ?? {}
                      ^^^^^^^
mq5.vel:6:28 error VEL4001: Object is missing required field 'name'
```

实参位同形（`use(c ?? {})` 得同样两条）。一个错误、两条报告，其中一条讲的是修好
之后就不存在的那个联合类型。

### WB-I1 —— 只收 `Length` 的构建器仍是 VEL4001 + VEL5042 **双报**

F7-web-b 自己把这一格放进队列。实测（0.30.0）：

```text
m2.vel:3:17 error VEL4001: Cannot assign number to Length
m2.vel:3:17 error VEL5042: blur composes CSS lengths, so 4 requires a unit; write a unit value such as 4px or 4rem (only 0 is unitless)
m2.vel:4:19 error VEL4001: Cannot assign number to Length
m2.vel:4:19 error VEL5042: border composes CSS lengths, so 1 requires a unit; …
m2.vel:6:28 error VEL4001: Cannot assign number to Length
m2.vel:6:28 error VEL5042: dropShadow composes CSS lengths, so 2 requires a unit; …
```

同一版里 `hsl` 与 `min`/`max`/`clamp` 已是单报（见 DECIDED-AND-CORRECT），所以这是
同一条规则的三种写法里最后一种没改的。

### WB-I2 —— 那条 VEL5042 说「only 0 is unitless」，而编译器**拒绝 `0`**

```text
m3.vel:4:25 error VEL4001: Cannot assign number to Length
const s0: Filter = blur(0)
                        ^
m3.vel:5:27 error VEL4001: Cannot assign number to Length
const sh: Shadow = shadow(0, 12px, 32px, ink)
                          ^
```

`0` 走不到 VEL5042（那条规则把零排除了），于是作者只拿到一条**没有任何改法**的
类型错误 —— 而同一个构建器的兄弟消息刚刚向他保证过零是合法的无单位长度。
`shadow(0px, …)` 编译通过，所以改法存在，只是没人说出来。

### WB-I3 —— 陈旧读探测器给的改法，实例嵌在 cell 下一层时**编译不过**

`stateCellName` 沿所有权图往上找一两层 cell（F7-web 第 7 项），消息模板却把那个
cell 当成实例本身：

```text
$ state holder: Holder = {box: Box()}      # Holder.box: Box
DEV: This reactive value reads 'value' on the Box held in state 'holder'. … only replacing the cell -- 'holder = Box(...)' -- publishes. …
$ state boxes: List<Box> = [Box()]
DEV: … only replacing the cell -- 'boxes = Box(...)' -- publishes. …
```

照做：

```text
st4fix.vel:11:14 error VEL4001: Cannot assign Box to Holder
    holder = Box()
             ^^^^^
```

顶层形态（`state box: Box = Box()`）的那句是对的；**恰恰是那次向上走带来的两种
新形态给出了编译不过的改法**。

### WB-I4 —— 探测器对 `const` 字段也报，而 `const` 字段的读永远不会陈旧

```text
$ cat st7.vel
class Box:
    const value: number = 1

state box: Box = Box()
computed doubled = box.value * 2
$ …
DEV: This reactive value reads 'value' on the Box held in state 'box'. A class instance is never wrapped, so changing 'value' publishes nothing and this value stays as it is: … Hold the field in its own 'state' if it is meant to be followed.
```

`const` 字段没人能改，所以「changing 'value' publishes nothing」讲的是一件不会发生
的事，而「Hold the field in its own 'state'」对一个不可写的字段是错的建议。
`graph.js:711` 的判据是 JS 描述符（`writable && configurable`），`const` 字段发射成
普通可写数据属性，于是运行时分不出编译器分得出的两类。

### WB-I5 —— `hsla` 不存在报两次，第二条教作者给 `hsla` 写 extern 契约

```text
h4.vel:1:27 error VEL6007: Module 'velar/look' has no export named 'hsla'; did you mean 'hsl'?
h4.vel:3:20 error VEL4001: Cannot call an unknown JavaScript value without a declaration or validation; declare the signature — an 'extern module' contract or a contracted 'extern js' block gives 'hsla' a checked type — …
```

与 CO-I4 同族（被拒的导入仍然绑定了名字），只是发生在 Web 面。

### WB-I6 —— `keyframes:` 的百分号停靠点在同一跨度上报两条

```text
h7.vel:4:5 error VEL5060: Use 'from:'; 0% has one canonical keyframe spelling
h7.vel:4:5 error VEL5060: A keyframes block requires at least one valid stop
h7.vel:6:5 error VEL5060: Use 'to:'; 100% has one canonical keyframe spelling
```

第二条是第一条的后果（停靠点被拒之后表空了），同码同跨度，作者读到的是「改成
`from:`」和「你一个停靠点都没写」两句互相矛盾的话。改成 `from:`/`to:` 之后块里的
`hsl` 百分号规则正常生效（h9）。

### WB-I7 —— 折叠绑定的 `hsl` 消息把常量的字面量贴在了绑定名的跨度上

```text
$ cat h6.vel
const sat = 70
const sky: Color = hsl(210, sat, 45%)
$ velar check h6.vel
h6.vel:4:29 error VEL4001: HSL saturation is a percentage, and 70 is a number; write 70%
const sky: Color = hsl(210, sat, 45%)
                            ^^^
```

下划线下的文本是 `sat`，改法说的是 `70%`，而真正要改的行在上面一行。`velar fix`
正确地**不**给这一格挂机械修法（`applied 0 mechanical fixes; 1 diagnostic remains`），
所以只剩措辞问题 —— 但作者若照字面在 caret 处改，就把绑定的使用换成了字面量。

### NO-I1 —— `HttpProblem({code: …})` 这个**每个 0.29 程序都要改的构造点**得两条泛型报告、没有后继名、没有 `velar fix`

读取侧是模范（一条报告、点名 `reason`、带机械修法、`velar fix` 一次改完四处、
改完能跑）。同一次改名的**构造**侧不是：

```text
a6/src/main.vel:4:33 error VEL4001: Object is missing required field 'reason'
    const problem = HttpProblem({status: 409, code: "a.conflict", title: "Conflict"})
                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
a6/src/main.vel:4:47 error VEL4001: Object has no field 'code'
                                              ^^^^^^^^^^^^^^^^^^
applied 0 mechanical fixes; 2 diagnostics remain
```

一个错误、两条报告，两条都不说 `code` 的后继是 `reason`；`velar fix` 把读改完、
把 throw 留在原地。读取侧的规则在 `packages/node/src/serve-problem-analysis.ts:81`
（一个专门的新模块），选项记录则是 `packages/node/src/compiler.ts:136` 上一个不知道
退役键的普通 `object({...})`。

### NO-I2 —— `Upload.save(path, root)` 的相对 root 以**进程工作目录**为基，同一模块里 `file()` / `staticFiles()` 以工程为基

同一个模块、同一个参数名、两种基准，而写入侧那一种**一个字的文档都没有**
（`Upload` 在 `docs/standard-library.md` 里 grep 不到）。从工程外的 cwd 启动，
handler 是 `await image.save("out.txt", "uploads")`：

```text
--- POST /save   status 200  body "{\"saved\":\"pic.txt\"}"
=== 工程里的 uploads ===        （空）
=== 外部 cwd 的 uploads ===     -rw-r--r--  14  out.txt
```

在没有 `uploads/` 的 cwd 下则是一个不透明的 500（stderr：`Unhandled server request
failed: Upload.save root does not resolve to an existing directory`）。
`packages/node/runtime/serve.js:777` 的 `__velarServeUploadTarget` 直接
`__velarServeFsCanonical(root)`。F7-node-b 把这一格记进了队列，0.30.0 照原样发了 ——
本文只是把它的可观察后果钉住：**同一份代码在开发机与部署机上写到两个不同的地方**。

### NO-I3 —— Worker 释放失败被吞，紧挨着的端口记账失败却有名字

同一个文件、同一件事、两种政策：

```js
function __velarNodeHostUpdateReference() {
  const outstanding = __velarNodeHostOutstanding();
  if (__velarNodeHostReferencePort(outstanding ? …Ref : …Unref)) return;
  __velarNodeHostFail(new __velarNodeHostError("Node host worker reference accounting is unavailable"));
}
```

（`node-host.js:188`，`process.js:245` / `terminal.js:180` 同形）对上 NO-D2 里那个
`catch { return false; }`。有名字的那条是端口；**决定进程能不能退出**的那条是
Worker 释放，而它一声不吭。（附带：端口那条有名失败在实践中似乎不可达 ——
加载后污染 `MessagePort.prototype.ref/unref` 被捕获击败，加载前污染在模块加载之前
就在 Node 自己的 worker 管线里崩掉。）

### GA-I1 —— `check-runtime-boundary` 钉住浏览器寿命三个常量里的两个，漏掉 B2 新造的那个

D114 的 B2 段自己记下了这条遗留。今天仍然成立：

```text
$ grep -c browserRunDeadlineMs scripts/check-runtime-boundary.mjs   → 4
$ grep -c browserStopGraceMs   scripts/check-runtime-boundary.mjs   → 0
```

门在 1161–1189、1220 行钉了
`"export const browserRunDeadlineMs = 20 * 60_000"`、
`"export const browserCleanupTimeoutMs = 10_000"`、`"deadlineMs: browserRunDeadlineMs"`、
`"cleanupTimeoutMs: browserCleanupTimeoutMs"`，唯独没钉
`browserStopGraceMs = 5_000`（`packages/cli/src/browser-process-owner.ts:39`）。
而 B2 的整条论证就是「宽限不该由清理超时派生」—— 那个不该回来的派生式今天可以悄悄
回来，唯一挡着它的是一条**重层**测试。

### GA-I2 —— 归属推导的「发布方收窄」会丢掉真正的发布方；109 条里 57 条至少丢一个

`scripts/gate-scope.mjs` 的 `fileOwners`：

```js
const narrowed = [...publishers].filter((package_) => direct.has(package_));
```

一个文件只要直接点名了 `@velarscript/web`，它用到的 `"velar/http"`（发布方是
`desktop, node, web` 三家）就被收窄成 `web` 一家。后果是 `desktop` 与 `server` 常常
从 union 里消失 —— 本轮抽样的十条里有三条（`web/velar-unknown`、
`compiler/diagnostics/node-global-guidance`、`compiler/diagnostics/foreign-reflex-guidance`）
正是这样丢掉了 `desktop`。

### GA-I3 —— 109 条 `consistency` 里 89 条的 union 含 `cli`，其「归属」是装饰性的

`cli` 在 `PACKAGE_UPSTREAM` 里位于全部六个包的下游，而 `tests/support/velar-project.ts`
把 `cli` 带进了几乎每一个跑 CLI 的测试。于是这 89 条**只有 `packages/create` 的改动
才会跳过**它们 —— 包括 0.30.0 的 Core 头条 `tests/core/timeout-error.test.ts`
（union `[cli, compiler, core, node]`，**没有 `web`**；它在 `packages/web` 改动下能跑，
纯粹是因为那条 `cli`）。删掉一处 `runVelarProject` 导入，这批测试一夜之间变成可跳过。
`consistency` 段本身**不是漏跑通道**（`tests[name]` 取的是目录 ∪ 推导的并集，
所以 `exercises` 里的那个所有者本来就在选择集里）；真正的漏跑通道是「推导从未见过的
包」与「`cli` 当了普遍救生圈」这两件事，而账本里没有任何一栏在说它们。

---

## CHARTER-DRIFT

### CO-C1 —— 格式化器有一条 **120 列规则**；宪章 §2 与本版 CHANGELOG 都说「没有行宽」

宪章 §2（本版还专门重申过）：

> what it canonicalizes is spelling — quote form, spacing, the `name=value` of a
> named argument, indentation, the two suite shapes above — not the author's line
> breaks. **There is no line width**: a long call, a long string literal, and a
> long f-string are left on the line they were written on …

实测：一个语句的函数体，接上标题行后 **≤ 120 列就被并成一行，121 列就不并**：

```text
pad=90   collapsedLen=118  COLLAPSED
pad=91   collapsedLen=119  COLLAPSED
pad=92   collapsedLen=120  COLLAPSED
pad=93   collapsedLen=18   kept
```

反向也成立 —— 作者自己写成一行的 139 列 suite 被**拆开**：

```text
--- before ---
def f() -> string: return "xxx…"          (139 列)
--- after ---
def f() -> string:
    return "xxx…"
```

而且这不是「格式化器可以这么做」而是「格式化器必须这么做」—— 普通的缩进两行体被
`--check` 判为未格式化，于是 `velar format --check` 与围栏门都在强制这条行宽：

```text
$ cat fc.vel
def stop() -> string:
    return "x"
$ velar format --check fc.vel
fc.vel is not formatted
1 of 1 VelarScript source file require formatting
[exit=1]
```

源码承认这条规则：`packages/compiler/src/format/options.ts:23`
`export const FORMAT_PRINT_WIDTH = 120;`，`format/lines.ts:292`
`if (inlineLine.length <= FORMAT_PRINT_WIDTH)`，文件头注释写着「This is also where
the **120-column rule** is applied」。同一句宪章里「canonicalizes … the two suite
shapes」与「there is no line width」互相作废：suite 形状的选择就是行宽的选择。
0.29.0 Core 账本第 12 条把「Core 没有行宽这件事」列为待成文项，0.30.0 把它写进了
宪章 —— 写成了与实现相反的那一半。

### CO-C2 —— 宪章 §11 用 `TimeoutError` 举例讲「自定义 Error 子类」，而本版把它变成保留 Core 绑定

`docs/language-charter.md:3393`：

> An `Error` subclass reports under its declared name: the class lowering sets
> `.name` to the class name, so reports and `print(error.name)` say
> `TimeoutError`, not `Error`.

```text
$ cat co04.vel
class TimeoutError extends Error:
    constructor(message: string):
        super(message)
$ velar check co04.vel
co04.vel:1:1 error VEL3007: 'TimeoutError' is a reserved Core binding
```

F7-core 把 tour 里的 `class TimeoutError extends Error` 改名成 `BudgetError`，宪章
这句散文没跟上；它现在描述的是一段不可能存在的源码。（散文不是围栏，
`check:fence-format` 与文档覆盖门都看不见它。）

### CO-C3 —— A18 是**每条构成环的 import 边**报一次，不是整图一次；压制因此要写 N 条

宪章（advisory 段）：

> `A18` reports a circular module dependency, and it is the project graph's
> advisory rather than any one module's: it is raised once the whole graph is
> read, and **a `velar-allow A18` on the import line that closes the cycle**
> answers it (section 12).

三模块环实测：

```text
… a.vel:1:21 advisory A18: Circular module dependency includes a.vel, b.vel, c.vel; …
… b.vel:1:22 advisory A18: Circular module dependency includes a.vel, b.vel, c.vel; …
… c.vel:1:22 advisory A18: Circular module dependency includes a.vel, b.vel, c.vel; …
Checked 7 modules from … — 3 advisories
```

两模块环里只压 `a.vel` 一条，`b.vel` 那条照报；两条都压才干净。哪一条是「the import
line that closes the cycle」没有答案 —— 每一条都是。作者要为一个事实写 N 份同样的
理由，而其中 N−1 份在环缩小后会变成永不过期的僵尸压制（CO-I2）。

### WB-C1 —— `tick()` 「cannot step over a broken update」对**第二个并发等待者**不成立

宪章 §16 与 web-api 同句：

> if the flush reported a failure that no handler claimed, `tick()` rejects with
> it, **so awaiting `tick()` cannot step over a broken update**. **The awaiting
> caller is the claimant, in every host** …

两个 `tick()` 同时等同一次坏刷新：

```text
$ …
a rejected: watch blew up
b resolved
done
```

`b` 等的是同一次坏刷新，它 resolve 了 —— 它跨过了一次坏更新。后半句「the awaiting
caller is the claimant」（单数）确实解释了为什么，但前半句是无条件的，而
`velar/web-test` 与任何并行 `await` 都会命中这一格。**两个宿主同款**（无 document
的 Node 宿主实测同样是 `a rejected` / `b resolved`），所以「in every host」这一半
成立，不成立的是「cannot step over」。

同一段还有第二处出入：那句说宿主通道是**替代**（「only when none is pending does it
go to the host — the browser's error event, **or the report channel elsewhere**」），
而 Node 宿主下失败**同时**交给等待的 `tick()` **并且**写进报告通道：

```text
--- stdout ---            --- stderr ---
a rejected: watch blew up  Unhandled VelarScript error report: Error: watch blew up
```

仓库自己的测试把这条钉住了（`tests/web/web-tick-rejection.test.ts`：「the Node host
is **unchanged**: it traces the failure and still rejects the tick()」）—— 所以是文本
没跟上，不是实现走偏。

---

## UNDEFINED

### CO —— Core 0.8

| ID | 未定之处 | 实测行为（即应成文的答案） |
|---|---|---|
| CO-U1 | `--stack` 对未捕获错误**减少**信息 | 默认输出带源码片段与 caret（`print("ab".repeat(n))` / `^`）；`--stack` 换成完整 JS 帧但**去掉**片段与 caret。两种输出各有对方没有的东西，没有一句说明 |
| CO-U2 | 编译器运行时帧的隐藏判据是**路径**不是名字 | `AssertionError` 的默认输出留着 `at __velarRequired (file:///…/.velar/run-K55sB5/n03.js:5:11)` —— 内联进程序模块的运行时助手不在 `node:` 也不在 `/node_modules/velar/`，于是逃过过滤；那个目录在运行结束时已被删除 |
| CO-U3 | 未捕获 `NarrowingError` 的帧重复 | `at <anonymous> (…/n04.vel:14:15)` 连打两次（收窄守卫与读点同一位置）；赋值位（`nw2.vel:14:25`）同款 |
| CO-U4 | `"abc".char(-1)` | 编译通过、运行返回 `"c"`。字面量契约只关「必须是整数」（`String.char index must be an integer`），负下标是从尾部读，没有任何文档说这件事 |
| CO-U5 | 被拒的类型参数名在**函数体里的使用**各报一次 | `type Box<Callable>: item: Callable` 得 2 条（VEL4021 + VEL2012）；`def f<str>(x: str) -> str` 得 3 条。`<null>` / `<readonly>` 只有 1 条，因为体里没用到 |
| CO-U6 | 恰是 `{first, second}` 的匿名记录**打印成 `Pair<A, B>`** | `const p = {first: "a", second: 1}` 之后 `const q: number = p` 报 `Cannot assign Pair<string, number> to number` —— 作者从没写过 `Pair` |
| CO-U7 | 嵌套 `Promise.timeout`：内层超时**在外层已经失败之后**仍然作为「detached」写 stderr | 退出码 0，程序照常结束，但 stderr 上多一段作者无法处置的内部栈（见 CO-I6） |
| CO-U8 | 发射的 `@dispose:` 方法在栈里的名字 | `at Handle.__velar:dispose (…/ds1.vel:5:15)` —— 位置对、名字是编译器内部拼写；没有文档说作者会在自己的栈里看到 `__velar:` 前缀 |

### WB —— Web 0.14

| ID | 未定之处 | 实测行为（即应成文的答案） |
|---|---|---|
| WB-U1 | 同一次坏刷新有**两个** `tick()` 在等 | 第一个被 reject，第二个 resolve（见 WB-C1） |
| WB-U2 | `tick()` 在失败**已经刷完之后**才被 await | 不认领 —— 失败走宿主路径（本探针里进程以 1 退出），后来的 `tick()` 与它无关 |
| WB-U3 | 一次刷新里**两个**未认领失败 | 排队：第一个 `tick()` 拿第一个，第二个 `tick()` 拿第二个；没有 `tick()` 时第一个走宿主、进程即止 |
| WB-U4 | 探测器点名的是**底层数据字段**，不是作者写的那个成员 | `get value()` 背后的 `inner`、`def read()` 里读的 `value` 都以字段名报出，而作者的行上写的是 `box.value` / `box.read()` |
| WB-U5 | VEL5077 的**两跳**与**条件写** | 都不在编译期判据内（留给运行时观察者预算），与 D114 第 6 项一致但没有文档说边界在一跳 |

### NO —— Node 0.17 / Server 0.15

| ID | 未定之处 | 实测行为（即应成文的答案） |
|---|---|---|
| NO-U1 | 树内的 `dist/` **永远读不到自己的** `dist/public/` | `velar build` 会把 `public/` 拷进 `dist/public/`，但只要 `dist/` 还在工程里，工程根候选就赢。`dist/public/hello.txt` 写 `hello-from-DIST-public`、`public/hello.txt` 写 `hello-from-public` 时，`node dist/main.js` 服务的是后者。后果值得写明：任何对 `dist/public` 的构建后加工在本地是静默空转，只有目录被搬走之后才生效 |
| NO-U2 | 带 `..` 的 root **逃出工程且静默解析** | `root="../shared-public"`：`velar check` 过、`velar run` 服务 `shared-public-file`。文档只说过 root-contained（那说的是请求路径），没说 root 本身能不能离开工程 —— 而工具链的其它每一处都拒绝离开工程的源码 |
| NO-U3 | 不存在的 root | 请求期 404（`"code":"static.not_found"`），**从不**是构建期或启动期诊断。源码注释说这是有意的（`serve-listener.js:129`：报成失败会答 500 并把部署绝对路径写进 stderr），但 `root="pubic"` 这样的拼写错与「文件不在」无法区分，也没有一句文档 |
| NO-U4 | 13 号退出路径上的 `--stack` | 不带时说「(1 Node.js internal frame hidden; rerun with 'velar run --stack' for the full trace)」；带上之后多出来的**全部**内容是 `at process.emit (node:events:509:28)` —— 一个启动器帧，没有任何 `.vel` 帧。提示宣传了一个没有诊断价值的补救 |
| NO-U5 | 加载**前**污染 `MessagePort.prototype.ref` / `unref` | 在 `new Worker` 期间就在 Node 自己的管线里崩（`at setupPortReferencing (node:internal/worker/io:216:8)`），exit 1、裸崩溃转储 —— 不是有名的模块失败，但**进程确实退出、不挂起**。加载后污染同二者被完全防住（exit 0） |
| NO-U6 | 就绪期限失败在 `node dist/main.js` 下的形态 | 以未捕获崩溃转储逃出，先打印被压缩的运行时行（288）再打印消息；退出码 1，不挂起 |
| NO-U7 | 只 `throw HttpProblem` 的路由的 `openapi()` 输出 | 发布 `"200": {"schema": {"type":"null"}}`，且**没有任何 4xx** —— 一条只会失败的路由在契约里长得像一条只会成功的 |

### GA —— 按范围门禁的盲区（本轮新增的一类）

判据（`scripts/gate-scope.mjs`）：`:505` 快层的**全集**先把每个 `.slow.test.ts` 排除
（`nodeTestFiles(…, "quick")`），`:533` 再按 union 与改动包的下游闭包过滤。所以
「只有 `.slow` 测试钉住」＝「`npm run gate` 永远不跑它，只有 `release:check` 与 CI 的
标签／每日／手动运行跑一次」。

**好消息先记**：0.30.0 CHANGELOG 的 Language / Web / Node **每一条**都有快层钉子
（D115 P5 的搬迁把七个 F7 波的新测试全部放进了 `tests/<owner>/*.test.ts`；逐条对照见
下文 DECIDED-AND-CORRECT 的 GA 段）。以下是例外，按本轮的约定记为 UNDEFINED：

| ID | 只由重层覆盖的行为 | 唯一的钉子 |
|---|---|---|
| GA-U1 | Repository 条「Browser test processes die with their launcher：ppid / EPIPE / IPC 父进程死亡看护 + 5 秒停止宽限」的**启动者之死**那一半（门脚本被杀、无人读的运行、无通道无读者、忽略一切信号的 worker）；`browserStopGraceMs` 也只在这里被按名字引用 | `tests/cli/browser-process-hygiene.slow.test.ts`（快层的 `tests/cli/browser-lifecycle.test.ts` 只覆盖顽固子孙的回收、SIGTERM 与 IPC disconnect 排空） |
| GA-U2 | Web 条「every initial-render path is covered」的**真实引擎**那一半 | `tests/web/runtime.slow.test.ts:354`（`[WEB-D3] … shows the fatal state on every engine`）；快层的 `web-region-fatal-marker.test.ts` 是无头的 |
| GA-U3 | Node 条「a program cannot drain and exit 0 with `@main` unfinished **under load**」的整面 ABI 那一半 —— 而且 `packages/node` 唯一的端到端测试（3,617 行）**即便在只改 `packages/node` 时也不跑** | `tests/node/node-platform.slow.test.ts` |
| GA-U4 | Node 条 `file()`/`staticFiles()` 的**机制**（`__velarServeProjectRootOffset`：输出相对工程根的深度烤进 `velar/serve`）—— `grep -rn projectRootOffset` 在 `tests/` 下**零命中**；行为由 `tests/node/node-static-root.test.ts` 黑盒钉住，常量本身只由 `output-fingerprint.lock` 间接守着 | 无（仅指纹） |
| GA-U5 | Repository 条「`noUnusedLocals` is on for every package」—— `grep -rl noUnusedLocals tests scripts` **零命中**，只活在 `tsconfig*.json` 里 | 无 |
| GA-U6 | Language 条列的宪章 §2 / §9 / §10 / §12 与标准库**文本**本身 —— `grep -rn language-charter tests` 零命中；两个文档门（`documentation-coverage.slow` / `tour-coverage.slow`）都只对**夹具** Markdown 跑，从不读仓库自己的宪章 | 无任何层（其下的行为主张有快层钉子，暴露面是散文与行为分叉 —— CO-C1 与 CO-C2 就是这条盲区的两个实例） |

**十条最出人意料的归属**（`tests/ownership.generated.json` 的 `consistency` 段今天
仍是 109 条：compiler 83 / core 11 / node 7 / web 4 / cli 3 / server 1；其中 **7 条是
`.slow` 文件**，它们的 union 根本不被咨询）。「被跳过」是按 `buildPlan` 每包改一个
文件模拟出来的，不是猜的：

| # | 测试 | union | 一个会改行为却不跑它的改动 |
|---|---|---|---|
| 1 | `tests/compiler/emit/runtime-generation.test.ts` | compiler, core, web | 改 **node**：它钉的是「一次构建里两代 `@velarscript/*` 收敛到同一批全局注册表」，却只经 `packages/web` 的 `runtime-sources.generated.ts` 验；0.30.0 刚把 `packages/node/runtime/*.js` 变成真源码 |
| 2 | `tests/core/hash.test.ts` | compiler, core, node | 改 **web**：它的第一条断言是「`velar/hash` 是 Core 摘要契约、不是目标能力」，只对 Node 名册验；`packages/web` 把 `velar/hash` 加进 `VELAR_WEB_MODULES` 正好破坏它 |
| 3 | `tests/web/velar-unknown.test.ts` | compiler, core, node, web | 改 **desktop**（被 GA-I2 收窄掉）：普查「任何目标发布的位置都不许出现 `any`」，desktop 重新把同一批 `velar/*` 声明成 `any` 时不受检 |
| 4 | `tests/compiler/diagnostics/core-message-wording.test.ts` | compiler, core（全段最窄） | 改 **cli / web / node / desktop / server** 任一：这一个文件同时钉了 0.30.0 四条 Language 条目（模块级 `using` VEL3018、裸 `try` 的 VEL4034、Error 契约成员改写成方法、`"ab" * 3`） |
| 5 | `tests/compiler/diagnostics/reserved-type-name-single-report.test.ts` | compiler, core, web | 改 **node**：它钉的是本版头条 breaking change，且 `[D114 S4b b]` 那一格是**跨名册**的，却只导入 `packages/web/src/compiler.ts`；对 `VELAR_NODE_MODULES` 的同款碰撞既没断言也不被选中 |
| 6 | `tests/compiler/diagnostics/node-global-guidance.test.ts` | compiler, core, node, web | 改 **desktop**：断言的是 Node 与 Web 扩展各自把宿主全局答成替代模块；desktop 发布同一家族 |
| 7 | `tests/compiler/types/any-export-boundary.test.ts` | compiler, core, web | 改 **node**：D90 R12（导出位不许有 `any`）只经 web 扩展注入宿主导入 |
| 8 | `tests/compiler/diagnostics/foreign-reflex-guidance.test.ts` | compiler, core, node | 改 **web / desktop**：它编译自己指引里点名的每一个后继拼写（「a message can never drift onto a spelling that does not exist」），目标包退役一个拼写就破规而不跑 |
| 9 | `tests/compiler/analysis/text-conversion.test.ts` | compiler, web（**没有 core**） | 改 **node**：整篇的主题是 VEL4026、`str()`／f-string 对 **Core** 值的转换；它躲过 `packages/core` 的改动纯属侥幸（web 在 core 下游） |
| 10 | `tests/core/timeout-error.test.ts` | cli, compiler, core, node（**没有 web**） | 见 GA-I3：它在 `packages/web` 改动下能跑只因为那条从 `tests/support/velar-project.ts` 带来的 `cli`；这是 89 条同形态里最贵的一条 |

模拟出的跳过量（每包改一个文件，快层共 383 个测试）：`create` 跳 342 · `server` 90 ·
`cli` 91 · `desktop` 87 · `node` 80 · `web` 48 · `core` 43 · `compiler` 0。

---

## DECIDED-AND-CORRECT

### CO —— Core 0.8（压缩记录）

**`TimeoutError`（12 项）**：`Promise.timeout` 与 `velar/task.withTimeout` 抛同一个类
（`code=TimeoutError is=true`，`name` 为 `TimeoutError`）；消息可自带
（`msg=load took too long`）；任务自身的失败不被误判成超时；`class SlowError extends
TimeoutError` 被拒并给「extend Error」；用户 `class TimeoutError extends Error:` 被拒
（`'TimeoutError' is a reserved Core binding`）；`import {TaskTimeoutError}` 报一条
VEL3008 并点名 `TimeoutError`；`velar fix` **同时改写导入、值位与类型位**
（`def describe(failure: TaskTimeoutError)` → `TimeoutError`）且修完 `velar check`
干净；嵌套超时里外层拿到自己的预算消息。

**guided spelling（30+ 项）**：`object` / `Object` / `Callable` 在 `type` / `class` /
`enum` / `def` / `const` / 类型参数六个位各一条，措辞按位置换名词、按名字换改法
（「declare a named 'type' … or use 'unknown'」/「write an explicit function type such as
'(value: string) -> bool'」）；注解位保留 VEL2012；**成员名与记录键全部放行**
（`let object: number`、`def Callable()`、`get Object()`、`{object: 1, Object: 2,
Callable: 3}`、`enum Kind: object` 全部编译通过并运行）。`int` / `float` /
`undefined` / `NaN` / `Infinity` × 六个声明槽位 = **30 组，每组恰一条**，且每条点名
作者写的词。类型参数位的 `<str>` / `<readonly>` / `<any>` / `<null>` / `<Duration>`
各一条，措辞分别是 guided / 修饰符 / 「'any' is not a VelarScript type」/ 保留字 /
Core 类型名。

**`Pair<A, B>`（7 项）**：`zip` 的结果可注解并运行（`List<Pair<string, number>>`）；
解构 `const {first, second} = p` 可用；字段拼错给 did-you-mean；`type Pair:` 与
`type Pair<A, B>:` 都被拒（`'Pair' is a Core type name…`）；缺字段与多字段各一条；
零实参给 `needs 2 type arguments; write 'Pair<A, B>' with concrete types`；
**hover 打名字** —— `velar lsp` 的 `textDocument/hover` 在 `zip` 结果上答
`const pairs: List<Pair<string, number>>`。

**「消息点名规则与改法」（5 项）**：`Promise.resolve` → 「an 'async def' result is
already a Promise, so pass the value itself and let the awaiting side see it」；
`Promise.allSettled` → 「Promise.all is the whole-list wait, and 'try await' turns one
failure into null …」；`Math.nosuch` → 「Math has no member 'nosuch'」（点名命名空间）；
`"ab" * 3` → 「Use '.repeat(3)'; strings do not multiply」；三引号 → 「Use a '"' layout
string; VelarScript uses indentation rather than triple-quote delimiters」。

**其余 Core 格（14 项）**：`export class null:` 在 extern 契约里**一条**报告
（`'null' is a reserved word, so it cannot name an extern class`，六条解析错已消失）；
`detach` 在表达式位一条（`'detach' is statement-position only; write 'detach save()'
as its own statement — a detached task has no result to bind`），语句位正常；
`class X extends Error: pass` 只在**声明处**报一条，构造点不再重复
（三种形态实测：无 throw、有 throw、带自有字段）；字面量实参契约用**运行时自己那句
话**（`String.repeat count must be an integer from 0 through 16777216` 逐字相同，
`velar run` 下的 RangeError 与 `velar check` 下的 VEL4001 一字不差）并且边界正确
（`repeat(0)` 过、`repeat(16777216)` 过、`repeat(16777217)` 拒、`char(1.5)` 拒、
`padStart(-2)` 拒、`slice(1.5, 3)` 拒、`index("c", 1.5)` 拒、非字面量不查）；
`Text.findMatch("abc", "[a-")` 在编译期给 `Invalid text pattern: Unterminated
character class`；VEL3004 跨两条 import 子句成立、单子句内成立；`velar-allow A18`
的理由规则（VEL1011）成立；A18 在两模块与三模块环上都报出参与环的模块名；
`NarrowingError` 在读点与赋值点两种位置都报 `file:line:column`
（`… expected User at n04.vel:14:15` / `… at nw2.vel:14:25`）、`AssertionError` 报
`Required value 'value' is absent at n03.vel:3:15`、`IndexError` 三种形态都点名下标
与大小（`List index 10 is out of range for 3 elements` ·
`List index -5 is out of range for 3 elements` · `List index 1.5 is not an integer`）；`velar format` 把换行调用里的具名实参
写成 `name=value`（单行与多行两种形态各一，且是 `--check` 的不动点）；
`velar run --stack` 退出码与不带时一致（均为 1）。

**由错误而生的 `unknown`（9 项）**：`f"{v}"` · `v.field` 链 · `v + 1` · `v()` ·
`v[0]` · `match v:` · `await v` · `const l: List<string> = v` · `use(v)` 全部只报
「Unknown name 'nosuchname'」一条。

**表面摘要（1 项）**：`scripts/check-surface-versions.mjs` 绿，`core@0.8 468 names
b6ef31d5…` 与 `surface-lock.json` 一致；五个新类别齐备且计数与 D114 记录逐一相符
—— `value-method 28`、`error-class 11`、`builtin-type-name 14`、`advisory 18`、
`retired-spelling 29`（共 16 类 468 项）；`TimeoutError` 在 `error-class`、`Pair` 在
`builtin-type-name`、`A18` 在 `advisory`、`velar/task TaskTimeoutError` 在
`retired-spelling`。

### WB —— Web 0.14（压缩记录）

**`hsl`（8 项）**：`hsl(210, 70%, 45%)` 过；两个裸数字**各一条**且点名槽位
（`HSL saturation is a percentage, and 70 is a number; write 70%`）；只错一个时只报
一个；`Percentage` 绑定可用；`hsla` 不存在（did-you-mean `hsl`）；`velar fix` 把两个
字面量都改对且改完编译干净；`look:` 块里与 `keyframes:` 的 `from:`/`to:` 停靠点里
规则与 `velar fix` 都同样生效（各 `applied 2 mechanical fixes in 1 file; 0
diagnostics remain`）；折叠绑定正确地**不**给机械修法。`min`/`max`/`clamp` 正确地
一个修法都不给（`applied 0 mechanical fixes; 3 diagnostics remain`），
0.29.1 的混合 `Length`/`Percentage` 仍然可用。

**JSX 展开（4 项）**：组件与原生元素、字面量记录实参、空 `{...}` 四种形态都是一条
VEL5002（`JSX has no attribute spread; a component's props are named by its contract,
so write the attributes out`），两个展开报两条（两处各自的错误）；`look:` 的
`...spread` 仍然合法并编译通过。

**`min`/`max`/`clamp`（3 项）**：裸数字**单报**并点名槽位与两种改法
（`min's first argument is a Length or a Percentage, and 100 is a number; write 100px
or 100%`），不给机械修法 —— 与 F7-web-b 的裁决一致。

**区域 fatal 元素（3 项）**：HTML 形态正确 —— `role="alert"` + `data-velar-fatal` +
`This part of the page could not start: region failed`，落在区域自己的
`velar:start`/`velar:end` 之间，兄弟元素照常挂载并继续更新。

**VEL5077（4 项）**：同模块一跳成立（消息点名 `count` 与 `doubled` 的派生关系并给
两种改法）；自写主题的那句仍在；两跳与条件写不报（设计如此）；跨模块由更强的
VEL3002 先拦（`Cannot assign to imported reactive binding 'count'`）；同名局部
`const` 不误伤，别处的同名参数不影响判定。

**陈旧读探测器（6 项）**：`computed`、`watch` 主题、DOM 插值三个读者都报，措辞只换
读者的名词（`This reactive value reads …` / `This interpolation reads …`）；生产
（无 `__velarDevelopmentHooks`）**完全静默**；同一 (cell, class, field) 只报一次；
`stateCellName` 在记录与 List 两种嵌套下都找到了 cell 名（改法句子的缺陷见 WB-I3）。

**插值区域重建（1 项，两条语义）**：文档的围栏逐字为真 ——
prop 读（`draft`）让实例活着并**就地**更新文本，无 `@cleanup`/`@mounted`；
形状读（`tag`）即使分支没翻也重建（`preview cleanup` → `preview mounted`）：

```text
preview mounted / preview mounted
A|d1tagged t1
-- write draft --
B|d2tagged t1
-- write tag (same branch) --
preview cleanup / preview mounted
C|d2tagged t2
```

**`tick()`（4 项）**：有等待者时失败交给它并且程序继续（`tick rejected: watch blew
up` / `still running`）；干净刷新的 `tick()` 正常 resolve；无等待者时走宿主；
一次刷新里的多个失败按序排队给后续的 `tick()`。

### NO —— Node 0.17 / Server 0.15（压缩记录）

**`HttpProblem.reason`（14 项）**：线上问题文档不变 ——
`{"type":"about:blank","title":"Conflict","status":409,"code":"a.conflict","instance":"/prob"}`
配 `application/problem+json; charset=utf-8`，框架自己的 404/405 同样带
`"code":"route.not_found"` / `"route.method_not_allowed"`；`openapi()` 发布的问题
schema 仍声明并要求 `code`（`"required":["type","title","status","code"]`，
`serve-routing.js:2199`）；在 `HttpProblem` 类型的接收者上读 `.code` **在每一种能
构造出的边界上都恰好一条并点名后继** —— `const`、`type` 别名、值别名、
`catch error:` 经 `is HttpProblem` 收窄、f-string 插值、位置实参、具名实参、
可选上的 `maybe?.code`、`List<HttpProblem>` 上的 `problems[0].code`、
`@response` 策略里经 `!= null` 收窄的 `outcome.problem.code`；一个文件里四个站点得
四条报告、无级联，`velar fix` 一次改完（`applied 4 mechanical fixes in 1 file;
0 diagnostics remain`）且结果能跑；运行期 Error 契约成立（宽 `catch` 打出
`class-name-code=HttpProblem`）；在世的文档与 tour 里没有残留的 `.code`。

**静态 root（11 项）**：`velar run`、`velar dev`、`node dist/main.js` 三条路径从工程外
的 cwd（`/private/tmp`）都正确服务 `public/hello.txt`，`staticFiles(…, root="public")`
与 `file(…, root="public")` 两种都对；**没有兄弟碰撞**的真搬迁产物正确回退到入口
旁边；绝对 root 照给；工程外的 `--out-dir` 烤空偏移、无视种下的诱饵兄弟 `public/`，
只服务入口旁那一份。

**`velar run` 的 13 号退出（10 项）**：永不结算的 `@main` → `EXIT CODE: 13`，stderr
恰是 `velar run: the program's @main did not finish: the event loop drained while an
awaited value never settled`；同一程序构建后 `node dist/main.js` **也是 13**（走
Node 自己的主模块顶层 await 未决路径）；无清单的独立 `.vel` 文件同样 13 同样这句；
有界的待决定时器把报告推迟但不改变它（6,285 ms、六次 tick，然后 13）；无界定时器
让进程活着且不报告（Node 语义要求如此）；正常结束 → 0 且静默；`@main` 抛出 → 1 并
带源码映射的 `.vel` 帧；`velar/host` 的 `exit(0)` 在 `@main` 仍在等待时 → 0 且不报告；
**stdout 不截断**（停顿前打 5,000 行，`first: line 0` / `last: line 4999`）。

**加载后污染的防线（F7-node-c 复验）**：`Worker.prototype.ref`/`unref`/`terminate`
与 `MessagePort.prototype.ref`/`unref` 五者在加载后 400 ms 全部污染，三家族程序在两个
窗口里完成每一次调用并以 0 退出（704 ms）；加载前单独污染 `Worker.prototype.ref` 与
`Worker.prototype.terminate` 也各自 exit 0。

**就绪期限（3 项）**：每个家族一个有名的 30 s 常量；terminal 家族被实测触发
（`ELAPSED 30044ms EXIT 1`，消息恰是 `Error: Node terminal worker did not become
ready within 30000 ms`），另两条从源码引用未触发（`node-host-boot.js:26` /
`process-worker-boot.js:28`，常量分别在 `node-host.js:62` 与 `process.js:175`）。

**0.30.0 之前的协议形态（9 次尝试）**：向后接受成立，错误的元数仍被拒 ——
`serve.readFile` 的 3 参旧式 `[root, path, fallback]` 与 4 参新式
`[root, relocated, path, fallback]` 都 OK（含「主候选缺失、用 relocated」那一格），
2 参与 5 参报 `TypeError: serve.readFile arguments are invalid`；`serve.respondFile`
的 6 参旧式与 7 参新式都通过元数关（报的是「请求句柄未知」这个后续错误），5 参与
8 参报 `arguments are invalid`。源码：`node-host-worker-serve.js:506-511` 与 `:560-565`。

### GA —— 按范围门禁（压缩记录）

**每条 0.30.0 行为都有快层钉子（约 40 条逐一对照）**。Language：
`compiler/types/builtin-type-name-roster.test.ts`（RE-I1..I7 / RE-C1 / C2）＋
`compiler/diagnostics/reserved-type-name-single-report.test.ts`（声明位名册）·
`compiler/analysis/error-subclass-constructor.test.ts`（`extends Error` 无构造器）·
`compiler/analysis/async-iterate-nullable-elements.test.ts`（VEL4041）·
`compiler/types/literal-argument-contracts.test.ts` · `cli/import-duplicates.test.ts`
（VEL3004 与 `import js` 豁免）· `core/timeout-error.test.ts`（AS-I2 全套含 `velar fix`）·
`compiler/diagnostics/guided-spelling-object-callable.test.ts` ·
`compiler/types/pair-type.test.ts` · `repo/surface-digest-scope.test.ts`（摘要纳入五表）·
`cli/advisory-a18-circular-imports.test.ts` ·
`compiler/types/extern-class-reserved-names.test.ts`（`export class null:`）·
`compiler/diagnostics/core-message-wording.test.ts`（`detach` 表达式位、prelude 名、
模块级 `using`、裸 `try`、Error 契约成员）· `compiler/types/error-poison-type.test.ts` ·
`compiler/analysis/match-unknown-subject.test.ts` · `cli/host-error-channel-stacks.test.ts` ·
`compiler/diagnostics/runtime-diagnostic-positions.test.ts` ·
`compiler/format/named-argument-format.test.ts` · `core/core-task-channel.test.ts`。
（`velar run` 宿主错误通道的**释放失败**那一半本轮实测正确：过滤 `node:` 帧、带
「(2 Node.js internal frames hidden…)」、`--stack` 恢复；detach 那一半也正确 ——
不正确的是 CO-I6 里那个第二写手。）
Web 七条各一个新文件（`web-hsl-percentages` · `web-jsx-spread-absent` ·
`web-tick-rejection`（**双宿主**驱动） · `web-region-fatal-marker` ·
`web-watch-computed-hop` · `web-class-instance-state` · `web-region-rebuild`）。
Node 四条（`node-http-problem-reason` · `node-static-root` · `node-run-completion` ·
`node-process-readiness` ＋ `process-worker-intrinsics` ＋ `host-worker-bounds`）。
逐一核对 F7 各波（`3cf0e2c` / `8e46a12` / `78aa69b` / `3d91c0d` / `1ac247f` /
`31e1b60` / `344c498`）对**后来成为 `.slow`** 的文件的改动，全部是机械迁移
（`Pair` 组件改名 `Sides`、`code:` → `reason:`），没有一条新覆盖只落在重层。

**`.slow.test.ts` 今天恰是 23 个文件**（与 D114 T2 记录一致），按主题：
cli 9（浏览器进程卫生 / 浏览器测试隔离 / 构建输出所有权 / dev 依赖重载 / dev 会话 /
dev 服务器 / 模块与运行时界 / 最小复现 / 测试运行器）· compiler 5（分析器性能 /
运行时墙钟预算 / 软关键字网格 / 模块图容器 / 有界泛型与 `@dispose`）· web 4
（ARIA 与 Look 面 / 反应图与运行时 ABI / 反应性 / Web 运行时）· node 1 ·
desktop 1 · core 1 · repo 2（文档覆盖 / tour 覆盖）。

---

## 修复优先序（建议，不含实施）

1. **NO-D1（搬走的产物服务别人的 `public/`）** —— 唯一一条安全形状：候选之间只按
   「目录存在」二选一，于是一次普通的部署就可能把邻居目录发布到公网，零诊断，
   两种传输都中。而同一个程序在工程外 `--out-dir` 构建时免疫 —— 「安不安全取决于
   在哪里构建」本身就该被裁决掉。
2. **NO-D2（加载前污染 `Worker.prototype.unref` → 进程永不退出）** —— 三个家族同形，
   `velar run` 的 13 号网接不住（`beforeExit` 永不触发），而这一版的整条 Node 主线
   就是「程序不能排空后以 0 退出」。同一个文件里端口那条失败已经有名字了。
3. **CO-D1（`Pair` arity）** —— 一行 arity 表的遗漏，今天让一个打字错误把
   `unknown` 放进一个从不碰边界的程序。同一格里 0 个实参已有正确的句子，1 个和 3
   个没有。
4. **CO-D2（extern class 接受 guided spelling）** —— `head.kind === "identifier"`
   那个守卫是本版明写要关的格；后果是「声明写得下、每一个使用被拒」，而且报告全在
   使用处。
5. **NO-D3（`velar run` 不看护子进程）** —— B1/B2 已经给 dev / preview / browser 三处
   装了 `watchParentDeath`，`program-runner.ts` 是同族里唯一没装的；本轮**独立复现
   两次**（两个 `PPID 1` 的孤儿进程各持一个端口）。
6. **WB-D1（SVG 里的 fatal 元素）** —— 修复正在飞；本文只固定 0.30.0 的基线与
   `emitted-components.js:87` 的单点。
7. **CO-C1（格式化器的 120 列）** —— 需要一次裁决而不是一次实现：要么删掉宪章
   §2 的「There is no line width」并把 suite 的行宽规则写成规范（连同
   `FORMAT_PRINT_WIDTH` 这个数字），要么让 suite 形状不看列数。今天二者互相作废，
   而且这一版刚把那句话写进宪章，而 `velar format --check` 在强制它。
8. **WB-I3 + WB-I2 + CO-I1（消息给的改法编译器随后拒绝）** —— 三条同族，都是
   「照做一次得到第二个错误」：嵌套实例的 `holder = Box(...)`、说了零合法却拒绝零的
   长度构建器、别名建议撞上新的双导入规则。这一族是本审计线最看重的形态。
9. **NO-I1（`HttpProblem({code: …})` 的构造点）** —— 迁移路径缺了一半：读取侧模范、
   构造侧两条泛型报告且 `velar fix` 不动。这是每一个 0.29 程序都要走的那一步。
10. **NO-I2（`Upload.save` 的 root 以 cwd 为基）** —— 同一模块同一个参数名两个基准，
    写入侧一个字的文档都没有；F7-node-b 把它记进队列后原样发了版。
11. **CO-I2 + CO-C3（A18 的压制与计数）** —— 先裁决 A18 是「一个图的一条事实」还是
    「每条边一条事实」，再改宪章或改实现；过期检查（VEL1012）必须随之覆盖工程图码，
    否则每个环都会留下 N−1 条永不过期的压制。
12. **CO-I4 + WB-I5（被拒导入仍绑定名字，级联出一条错误建议）** —— 同一形状两个面，
    第二条报告教作者给 `print` / `hsla` 写 extern 契约。
13. **CO-I5（`for … in` 的 unknown 级联）** —— 九种形态已干净，只剩循环这一格。
14. **CO-I6 + CO-U2 + NO-I3（三条通道的措辞与过滤）** ——
    `core/runtime/async.js` 的 `reportAsyncLoser` 应走同一个 trace 助手；内联的
    `__velarRequired` 帧应按名字而不是按路径隐藏；Worker 释放失败应像它旁边的端口
    记账失败一样有名字。
15. **WB-I1 + WB-I6 + CO-I3（双报与位置名词）** —— 队列里那批：只收 `Length` 的四个
    构建器按 `hsl` 的就地改写路径处理；keyframes 停靠点被拒后抑制「至少一个停靠点」；
    `declarationNameNoun` 认得 extern class。
16. **WB-I4（`const` 字段的假阳性）** —— 探测器需要编译期已知的可变性，而不是 JS
    描述符。
17. **GA-I1 + GA-U1（浏览器进程卫生只由重层守着）** —— 补一条短语把
    `browserStopGraceMs` 钉进 `check-runtime-boundary.mjs`（B2 自己留的那条），
    并考虑把「启动者被杀后无残留」的最短一条拉回快层：这条卫生规则的整个论证今天
    每版只验一次 —— 而 NO-D3 正是它没覆盖到的那一格。
18. **GA-I2 + GA-I3（归属推导的两个盲区）** —— 发布方收窄丢掉真正的发布方（57/109），
    以及 `cli` 当普遍救生圈（89/109）。两者都不在 `consistency` 段的视野里，
    所以「只报不搬」的那 109 条读起来比实际情况乐观。建议：让 `fileOwners` 保留全部
    发布方，并在生成物里单列「若 `cli` 不在 union 会被跳过的测试」这一栏。
19. **GA-U4 + GA-U5（无任何测试的两条）** —— `projectRootOffset` 的偏移常量只由
    指纹间接守着；`noUnusedLocals` 只活在 tsconfig 里。两条都是一行断言的事。
20. **成文（CO-U1…U8 · WB-U1…U5 · NO-U1…U7 · GA-U6 · CO-C2）** —— 其中最值得先写的
    五条是 **NO-U1/U2/U3**（树内 `dist/` 读不到自己的 `dist/public/`、`..` 的 root
    静默逃出工程、不存在的 root 是请求期 404）、**WB-U1/U2/U3**（`tick()` 的认领
    规则：一次失败一个认领者、必须在失败时已在等、多个失败排队）、
    **CO-U4**（`char(-1)` 是从尾部读）；宪章 §11 的 `TimeoutError` 举例改名是一处
    一行的文档修正。

---

## 本文的出身

本文由 P7 审计代理在编排会话的 D115 §六「每版一审」排期下完成，隔离 worktree
`/private/tmp/velar-d114/audit-p6a`（分支 `audit/p7-0.30.0-surface`，HEAD `a0231a4`
＝ 0.30.0 的 main）。**只读仓库、只写本账本**；未派实施代理，未提交任何 git 写操作，
未运行 `npm run build*` / `npm test` / `npm run gate` / `release:check`。唯一运行过的
仓库脚本是只读的 `scripts/check-surface-versions.mjs` 与一段一次性的
`surfaceInventory()` 查询（写在会话草稿目录里）。

Core 与 Web 两面由本代理逐条实测。Node / Server 面与门禁盲区两节由两个受同样只读
约束的探针代理跑出；**头条结论由本代理独立复验**：NO-D1 在一个全新的工程上从头复现
（构建 → 拷到陌生 `public/` 旁 → 两条传输都服务了陌生人的文件，含应用从未发布的
`secret.txt`），NO-D2 / NO-D3 / NO-I3 与 GA 的四条数字断言逐一回到源码与
`grep` 上核对过。

探针工程、宿主脚本与 document 替身的 prelude 在
`/private/tmp/velar-d114/scratch-p7/{co,wb2,no,ga,hj,host}/`，不入仓；每个探针服务器
都绑定 `port=0` 并在探针结束时终止。收尾核对
（`lsof -iTCP -sTCP:LISTEN -P | grep node`）无本轮遗留监听 —— 过程中出现过三个孤儿
进程，它们本身就是 NO-D3 的证据，已全部终止。
