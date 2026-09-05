# 完整性审计 —— 0.29.0 语言标准层第二轮（2026-09-06，约 350 个探针）

审计对象：0.29.0（`206136a`）的 Core 语言面，重点是 0.28.0 账本没有覆盖的四个面
（异步与工作所有权 · 错误与断言 · 模块与 JavaScript 边界 · 字符串与 Text），
外加对 0.29.0 CHANGELOG 每一条承诺的**变体**复验。方法学沿用
[[COMPLETENESS-AUDITS]] 审计一与 [[COMPLETENESS-AUDIT-0.28.0-2026-09-05]]：
对每个特性面做 **charter 承诺 vs 编译器行为 vs 作者合理预期** 的逐条对照，
目标是消灭未定义而不是找 bug；DECIDED-AND-CORRECT 必须记录，否则「完整」
无法凭失败清单成立。

探针在隔离 worktree `/private/tmp/velar-d114/audit-p6a`（分支
`audit/p6-audit-p6a`，HEAD `206136a`）的已构建 `dist` 上实测：Core 用
`node packages/cli/dist/cli.js check <file>`（独立模式，无 velar.json），
运行时用 `node packages/cli/dist/cli.js run <file>`，格式化用
`velar format`，机械修复用 `velar fix`，hover 用 `velar lsp` 的
`textDocument/hover`（一个一次性 JSON-RPC 客户端）。目标边界那一条
（VEL6006）用一个钉了 `@velarscript/web` 的草稿工程验。输出逐字引用。
探针文件在 `/private/tmp/velar-d114/scratch-p6a/{as,er,md,tx,re}/`，不入仓。

分类：**DEFECT**（编译通过后崩溃/静默错误，或工具产出坏源码）· **CHARTER-DRIFT**
（文档与实现不符）· **INCONSISTENT**（两条相关规则互相矛盾；同一个错误报两次；
一个意思两种拼写；一条消息的修法编译器随后拒绝）· **UNDEFINED**
（charter 沉默、行为偶然）· **DECIDED-AND-CORRECT**（探过且正确 —— 完整性凭证）。

审计面：**AS** 异步 / 任务 / 工作所有权（约 68 个探针）· **ER** 错误与断言
（约 52 个）· **MD** 模块与 JavaScript 边界（约 60 个）· **TX** 字符串与 Text
（约 45 个）· **RE** 0.29.0 复验与三条所有者裁决项（约 130 个）。

---

## DEFECT —— 1 条

### AS-D1 —— 异步 `@iterate:` 对**元素本身可为 null** 的流静默截断，编译零诊断

宪章 §10 把「答 `T?`」定为异步拉取形式的判据，并在排除**同步**拉取形式时把
这条歧义写了出来：

> A synchronous block answering `T?` would spend `null` on exhaustion, so a
> sequence whose elements may be `null` could not be written at all; the
> asynchronous form pays that price because a stream has no collection to
> answer with, and a synchronous source always has one.

「pays that price」说的是这一格的设计代价，但**没有一句写明作者写出这种流时
会发生什么**，编译器也一个字都不说。实测是运行期静默丢数据。

最小探针 `as70.vel`：

```velar
class Source:
    let sent: number = 0

    @iterate:
        self.sent += 1
        if self.sent > 3:
            return null
        const value: string? = self.sent == 2 ? null : f"item{self.sent}"
        return value

@main:
    const source = Source()
    let seen = 0
    async for value in source:
        seen += 1
        print(f"got {value}")
    print(f"seen={seen} sent={source.sent}")
```

```text
$ node packages/cli/dist/cli.js check .../as/as70.vel
Checked 1 module from /…/as/as70.vel
$ node packages/cli/dist/cli.js run .../as/as70.vel
got item1
seen=1 sent=2
```

第 2 个元素是**数据里的 null**，被当成耗尽；第 3 个元素永不投递。退出码 0。
对照探针 `as71.vel`（同一个类，只把中间那个 null 换成非 null）证明这不是循环
本身的问题：

```text
got item1
got item2
got item3
seen=3 sent=4
```

编译器其实已经**判定过**元素类型是非可选的 —— 循环体里 `value ?? "NULL"`
被拒：

```text
/…/as/as68.vel:13:22 error VEL4001: Left side of '??' is not optional: string
        print(f"got {value ?? "NULL"}")
                     ^^^^^
```

所以静态侧知道 `T = string`，而 `@iterate:` 的 `return value`（`value: string?`，
可选性来自作者的注解而不是耗尽字面量）没有任何提示。可关闭的水槽是明摆着的：
`@iterate:` 的返回表达式静态类型是可选、且该可选性不是来自 `return null` 时报
一条诊断。分类为 DEFECT，因为**编译通过后静默丢数据**；宪章那句只解释了同步
形式为什么不存在，没有授权这条静默。

---

## INCONSISTENT —— 24 条

### AS-I1 —— `velar run` 对未捕获错误隐藏 Node 内部帧，对**宿主错误通道**的报告不隐藏，且 `--stack` 对后者无效

`docs/cli.md`：「`run` executes a framework-free CLI program; `--stack` keeps the
full trace instead of hiding internal frames.」未捕获路径完全兑现：

```text
$ node packages/cli/dist/cli.js run .../as/as18.vel
velar run: uncaught error while running /…/as/as18.vel
Error: sync boom
    throw Error("sync boom")
          ^
    at boom (/…/as/as18.vel:2:11)
    at <anonymous> (/…/as/as18.vel:5:5)
  (2 Node.js internal frames hidden; rerun with 'velar run --stack' for the full trace)
```

宪章 §7 说 detach 的失败「reports it through the host error channel …
the console error channel on Node output」。同一次运行、同一个通道：

```text
$ node packages/cli/dist/cli.js run .../as/as17.vel
after detach
Detached task failed: Error: detached boom
    at save (/…/as/as17.vel:2:11)
    at <anonymous> (/…/as/as17.vel:5:12)
    at ModuleJob.run (node:internal/modules/esm/module_job:437:25)
    at async node:internal/modules/esm/loader:639:26
```

内部帧原样露出，没有「N frames hidden」那一行，源码行回显也没有；`--stack`
输出**逐字相同**（实测），所以那个开关在这条路径上什么也不控制。
§9 的释放失败报告是同族（`as24.vel`）：

```text
Resource release failed while another error was in flight: Error: release failed
    at Bad.__velar:dispose (/…/as/as24.vel:3:15)
    at go (/…/as/as24.vel:7:17)
    at <anonymous> (/…/as/as24.vel:11:9)
    at ModuleJob.run (node:internal/modules/esm/module_job:437:25)
    at async node:internal/modules/esm/loader:639:26
```

一个概念（`velar run` 的程序打印的调用栈），两个定义。**不是拼写问题，是整类**：
两条宿主错误通道都这样。

### AS-I2 —— 两种超时，两种错误身份

宪章 §11：「An error has exactly one classification: **its class.**」而
`Promise.timeout` 与 `velar/task` 的 `withTimeout` 对同一件事给两个答案。

`as40.vel`（`withTimeout`）：

```text
withTimeout: code=TaskTimeoutError is=true msg=Task timed out after 10ms
```

`as41.vel`（`Promise.timeout`，带自定义消息）：

```text
code=Error name=Error msg=load took too long
```

`docs/standard-library.md` 的 `Promise.` 表只写「`timeout` | Rejects if a Promise
does not settle before a `Duration`; accepts an optional message.」，没说它不带
可判别的类。宪章 §11 的兜底理由是「Every other capability failure stays an
ordinary `Error`, because a caller writes the same recovery for all of them:
none」—— 但超时**恰好**是一个有独立恢复动作的失败（加大预算重试），这正是
`TaskTimeoutError` 存在的理由。`try await Promise.timeout(...)` 的调用者今天
无法把「超时」和「任务自己失败了」分开。

### AS-I3 —— `@main` 里的 `using` 双报，且第二条的修法在 `@main` 里不存在

`as19.vel`：

```velar
import {task, Cancellation} from "velar/task"

async def work(cancellation: Cancellation) -> number:
    await Promise.sleep(10ms)
    return 42

@main:
    using t = task(work)
    const v = await t.result()
    print(f"{v}")
```

```text
/…/as/as19.vel:8:5 error VEL3018: A module lives until the process ends, so a module-level 'using' has no scope to release at; own the resource inside a function, or use 'const' and release it explicitly
    using t = task(work)
    ^^^^^^^^^^^^^^^^^^^^

/…/as/as19.vel:8:5 error VEL4033: Releasing Task<number> awaits, so its 'using' needs an async scope; declare the enclosing function 'async def'
    using t = task(work)
    ^^^^^^^^^^^^^^^^^^^^
```

同一位置两条错误。而且 VEL4033 的修法「declare the enclosing function
'async def'」在 `@main:` 区域里**不可执行** —— `@main` 不是函数（宪章 §3：
「it is not a function, has no parameters or return value」）。同步释放的孪生
`as21.vel` 只报一条 VEL3018，所以第二条纯属多出来的。这是 0.28.0 B-I2 的同族
（「消息的修法在该位置不可执行」）。

### AS-I4 —— 具名类型的字段拼错**不给**「did you mean」，结构对象给

`as13b.vel`（结构对象）：

```text
/…/as/as13b.vel:3:14 error VEL4001: Object has no field 'alpah'; did you mean 'alpha'?
```

`as13c.vel`（同一个拼写错误，字段来自 `type Rec:`）：

```text
/…/as/as13c.vel:6:14 error VEL4001: Type 'Rec' has no field 'alpah'
```

同一个问题（一个字段名拼错），两条路径两个答案，而拿不到建议的恰好是更常见、
更「被声明过」的那条。

### AS-I5 —— 四个常驻命名空间的未知成员一律报 `Object has no field`

`as11b.vel`：

```text
/…/as/as11b.vel:2:15 error VEL4001: Object has no field 'nosuch'
    const a = Text.nosuch("x")
/…/as/as11b.vel:3:15 error VEL4001: Object has no field 'nosuch'
    const b = Json.nosuch("y")
/…/as/as11b.vel:4:15 error VEL4001: Object has no field 'nosuch'
    const c = Promise.nosuch()
```

`Text`/`Json`/`Promise`/`Math` 是 `PERMANENT_NAMESPACE_NAMES` 里的四个常驻命名空间
（`packages/compiler/src/core-vocabulary.ts:50`），在诊断里被当成匿名结构对象。
近似匹配是通的（`Promise.slep` → `did you mean 'sleep'?`），所以缺的只是那句
「`Promise` 没有这个成员」。最直接的受害形态是 JavaScript 反射
（`Promise.allSettled`、`Promise.resolve`）—— 见 AS-U3。

### AS-I6 —— 表达式位的 `detach` 报「keyword cannot be a name」，从不说「只在语句位」

宪章 §7：「`detach <expression>` is statement-position only」。`as16.vel`：

```text
/…/as/as16.vel:5:15 error VEL2002: 'detach' is a VelarScript keyword and cannot be a name; choose another name
    const x = detach save()
              ^^^^^^

/…/as/as16.vel:5:22 error VEL2032: A statement ends at its newline; move 'save' to its own line, or join it to the value before it with an operator
    const x = detach save()
                     ^^^^
```

作者并没有把 `detach` 当名字用；他把它写在了表达式位。两条报告，两个都不是
规则，规则那句一次也没出现。

### AS-I7 —— 错误产生的 `unknown` 继续参与下游检查，在**另一行**再报一条修法错误的诊断

`as63.vel`：

```velar
@main:
    const v = nosuchname
    print(f"{v}")
```

```text
/…/as/as63.vel:2:15 error VEL3001: Unknown name 'nosuchname'
    const v = nosuchname
              ^^^^^^^^^^

/…/as/as63.vel:3:14 error VEL4026: An f-string renders strings, numbers, bools, enums, null, and extension values with a declared text form; format unknown explicitly — print(value) to inspect it, or Json.stringify(value) for data text
    print(f"{v}")
             ^
```

第 3 行是正确的代码，它被要求改写。对照 `as64.vel`（类型没被污染的错误）证明
编译器**会**抑制级联：

```text
/…/as/as64.vel:5:20 error VEL4001: Cannot assign string to number
    const v = take("text")
                   ^^^^^^
```

只有这一条。所以水槽是「错误造成的 `unknown` 没有被标成错误类型」。本轮在
AS/ER/MD/TX/RE 五个面上都撞到这条（`await 5`、`s[0]`、`Promise.allSettled`、
`error.path`、`Text.findMatch` 的坏 pattern、`velar/collections` 命名空间导入…），
是本轮出现次数最多的单一噪声源。

### ER-I1 —— `class X extends Error: pass` 静默取零参构造；同形态的**普通**子类在声明处被拒并给出修法

宪章 §11 指路：「extend `Error` for custom hierarchies」，紧挨着写三个编译器
内建错误类「may be constructed and thrown directly」（实测 `ValidationError("bad
shape")`、`IndexError("out of range")` 都吃一个 message 实参）。作者照抄：

`er03.vel`：

```velar
class TimeoutError extends Error:
    pass

@main:
    try:
        throw TimeoutError("slow")
    catch error:
        print(f"name={error.name} code={error.code} is={error is TimeoutError}")
```

```text
/…/er/er03.vel:6:15 error VEL4001: Expected 0 arguments but received 1
        throw TimeoutError("slow")
              ^^^^^^^^^^^^^^^^^^^^
```

声明处一个字都没说。而**普通**基类的同形态子类在声明处就被拒，并给出修法
（`er18.vel`）：

```text
/…/er/er18.vel:5:1 error VEL4001: Class 'Derived' requires a constructor that calls 'super(...)'
class Derived extends Base:
^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

同一个问题（基类构造器带必需参数、子类没声明构造器），两个答案，而**宪章亲自
推荐的那条路**（`extends Error`）是没有帮助的那条。修法存在且简单
（`er08.vel`：`constructor(message: string): super(message)` → `name=TimeoutError
code=TimeoutError msg=slow`），只是没人说。
附注：`docs/javascript-bridge.md:210` 为 **extern** 类明写了这条反直觉
（「a derived extern class without its own `constructor(...)` line takes zero
construction arguments — the opposite of JavaScript's default」），源码类没有对应句子。

### ER-I2 —— Error 契约成员：作**字段**重声明点名规则，作**方法**重声明只给通用消息

宪章 §11：「An `Error` subclass cannot redeclare any of them **in any form**」。
五个成员作字段各有一句到位的规则（`er04`/`er09`–`er12`）：

```text
'code'    is the Error contract's own member: both report the declared class name, so a subclass cannot redeclare either — rename this field, or rename the class
'name'    is the Error contract's own member: both report the declared class name, so a subclass cannot redeclare either — rename this field, or rename the class
'message' is the Error contract's own member; pass the text to 'super(...)' instead of redeclaring the field
'stack'   is the Error contract's own member, filled in where the failure happens; a subclass cannot redeclare it
'cause'   is the Error contract's own member, filled in where the failure happens; a subclass cannot redeclare it
```

同样三个名字作**方法**（`er05`/`er13`/`er14`）：

```text
/…/er/er13.vel:2:5 error VEL4001: Method 'code' conflicts with an inherited field or getter
/…/er/er14.vel:2:5 error VEL4001: Method 'name' conflicts with an inherited field or getter
/…/er/er05.vel:2:5 error VEL4001: Method 'message' conflicts with an inherited field or getter
```

「in any form」这半句在实现里只兑现了「拒绝」，没兑现「同一句话」。

### ER-I3 —— 裸 `try` 语句双报，两条给相反口径的建议

`er36.vel`：

```velar
def go():
    throw Error("x")

@main:
    try go()
```

```text
/…/er/er36.vel:5:5 error VEL4034: A 'try' result must be consumed — bind it, test it, or supply a fallback with '??'; to run something and ignore its failure on purpose, use a try/catch block
    try go()
    ^^^^^^^^

/…/er/er36.vel:5:5 error VEL4034: This expression produces null on success, so a 'try' result cannot tell success from failure; use try/catch to handle the failure
```

同一位置、同一诊断码、两条消息：第一条让你「绑定它或给 `??` 兜底」，第二条说
这个表达式成功时就是 null、绑定不了。作者要同时读两条才知道真正能走的只有
try/catch。一个错误一条报告的纪律在这一格没生效。

### MD-I1 —— 模块解析诊断族**没有诊断码、没有行列**

本轮采集到六条这种形状（`md33`/`md11`/`md40`/`md38`/`md48`/`md39`）：

```text
/…/md/md33.vel: Module './lib.vel' has no export named 'ttle'
/…/md/md11.vel: VelarScript modules have no default export; import the names you need — import {name} from "./lib.vel"
/…/md/md40.vel: Relative import '../../../etc/hosts.vel' cannot escape the entry source directory
/…/md/md38.vel: Standard module 'velar/collections' retired; every collection operation is a checked List member — values.groupBy(key) — and 'range' is a Core prelude name that needs no import
/…/md/md48.vel: Module './live.vel' exports live values; import them by name instead of using a namespace import
/…/md/md39.vel: Module 'velar/test' has no export named 'test'
```

对照同一个族里**有**码有位的两条（`md31`/`md41`）：

```text
/…/md/md31.vel:2:31 error VEL6001: Module "./libb.vel" does not exist; did you mean "./lib.vel"?
/…/md/webproj/main.vel:1:32 error VEL6006: JavaScript Node builtin import "node:fs" is available only to the Node target; the current target is 'web'
```

分界线在源码里：`ProjectFailure`（`packages/cli/src/project.ts:92`）只有
`path` 和 `message` 两个字段，而同文件的 `recordResolution`
（`packages/cli/src/project.ts:269`）带 `code` 和位置。落在前者的 20 多个
`failures.push` 站点全部无码无位。后果具体：编辑器无法定位它们，`velar-allow`
和缺陷报告都没有码可以引用，退出码仍然是 1。

### MD-I2 —— 导出名拼错不给「did you mean」，模块路径拼错给

`md33.vel`（`import {ttle} from "./lib.vel"`，模块导出 `title`）：

```text
/…/md/md33.vel: Module './lib.vel' has no export named 'ttle'
```

`md32.vel`（`import {title} from "./libb.vel"`）：

```text
/…/md/md32.vel:1:22 error VEL6001: Module "./libb.vel" does not exist; did you mean "./lib.vel"?
```

同一行上两种拼错，一种给最近名，另一种不给 —— 而不给的那种是更常见的那个。

### MD-I3 —— 自导入一个模块**没有**导出的名字时，VEL6004 根本不报

宪章 §12：「A module cannot import from or re-export from itself: the self edge
has no valid evaluation order, so the answer is to use (or declare) the binding
directly.」

名字**存在**时规则如实报出（`md19.vel`，代价是三条报告）：

```text
/…/md/md19.vel:1:22 advisory VEL6010: Circular module dependency includes md19.vel; extract shared contracts into a lower-level module so dependencies flow in one direction
/…/md/md19.vel:1:22 error VEL6004: A module cannot import from itself; use the declaration directly (rename it if the import was an alias)
/…/md/md19.vel:3:1 error VEL3004: Name 'greet' is already imported from "./md19.vel"; rename this declaration, or alias the import — import {greet as other}
```

名字**不存在**时 VEL6004 消失（`md16.vel`）：

```text
/…/md/md16.vel:1:22 advisory VEL6010: Circular module dependency includes md16.vel; extract shared contracts into a lower-level module so dependencies flow in one direction
import {greet} from "./md16.vel"
                     ^^^^^^^^^^
/…/md/md16.vel: Module './md16.vel' has no export named 'greet'
```

作者拿到的是一条「循环依赖」advisory（不是规则）加一条无码无位的解析失败。
自导入这件事本身一次都没被说出来。这是 AGENTS.md「The example fixed, the class
left open」的形状：规则在名字解析得到的那一格生效，在解析不到的那一格漏掉。

### MD-I4 —— VEL6010 是 VELxxxx 号的 advisory，而 `velar-allow VEL6010` 被拒

`packages/compiler/src/diagnostic.ts:71` 写着：

> /** The advisory roster id, e.g. "A1". **Deliberately not the VELxxxx family.** */

`packages/cli/src/project.ts:1174` 却有 `const CIRCULAR_IMPORT_ADVISORY = "VEL6010"`，
而且它进 advisory 通道、进 advisory 计数（`Checked 2 modules … — 2 advisories`）。
AGENTS.md 的仓库契约写「Resolve every advisory `velar check` prints, one of
exactly two ways: change the spelling it names, or write
`// velar-allow <CODE>: <reason>`」。第二条路走不通（`md24`）：

```text
/…/md/circ-c.vel:1:22 advisory VEL6010: Circular module dependency includes circ-c.vel, circ-d.vel; extract shared contracts into a lower-level module so dependencies flow in one direction
import {fromD} from "./circ-d.vel"  // velar-allow VEL6010: the two modules are one unit and split only for size
                     ^^^^^^^^^^^^
/…/md/circ-c.vel:1:40 error VEL1011: A 'velar-allow' comment must name the advisory it suppresses ('A1', 'A2', …) and say why: write '// velar-allow A1: why this spelling is intended'. There is no blanket form
```

作者**已经**点名了它要压制的 advisory，编译器回答「你必须点名它要压制的
advisory」。这是本轮唯一一条「一条消息的修法编译器随后拒绝」的干净标本，
而第一条路（「change the spelling it names」）在这里也不是拼写，是重构模块图。

### MD-I5 —— `is` 可以对 `unknown` 做类判别，`match` 不行

`md46.vel`：

```velar
class Formatter:
    def format(value: number) -> string:
        return f"{value}"

def go(value: unknown):
    if value is Formatter:
        print(value.format(1))
```

```text
Checked 1 module from /…/md/md46.vel
```

`md47.vel`（同一个类、同一个 `unknown`、换成 `match`）：

```text
/…/md/md47.vel:6:11 error VEL4001: Validate an unknown value before matching it
    match value:
          ^^^^^
```

宪章 §9 的 Match 一节没有这条限制的任何文字，§12 的 `unknown` 一节也没有。
这是 0.28.0 **B-D1**（`is` 接受、`case` 拒绝）的**邻居**：那一条修的是泛型子类
这一格，`unknown` 主语这一格原样留着。AGENTS.md：「Close the sink, not the
spelling.」

### RE-I1 —— `type int:` / `type float:` 双报，且第一条点名**作者没写过的名字**

0.29.0 的 Breaking 一条写「a declaration spelled with a reserved name **reports
once and reports the rule**」，并列举 guided spellings（`Array`, `str`, `dict`,
`list`, `String`, `Number`, `boolean`, `void`, …）。`int`/`float` 是同一族
（都被导向 `number`），实测走的是 0.29.0 之前的路：

```text
/…/re/re01.vel:1:1 error VEL3007: 'number' is a Core type name, so it cannot also name a type; every use of it resolves to the built-in. Rename this declaration
type int:
^^^^^^^^^

/…/re/re01.vel:1:6 error VEL1005: Use 'number'; VelarScript has one JavaScript numeric type
type int:
     ^^^
```

第一条消息里的 `'number'` 是作者从没写过的词符 —— 词法层先把 `int` 改写成
`number`，名册再对改写后的名字开火。`class int:` / `enum int:` 同形态，
`def int()` 与 `const int = 1` 也同形态（后两者第一条退化成
`'number' is a reserved Core binding`）。对照 `type str:`：

```text
/…/re/tmp.vel:1:6 error VEL3007: 'str' is guided to 'string' in every type position, so it cannot name a type; every use of it would read as 'string'
```

一条，点名作者写的词，点名规则 —— 这才是 0.29.0 要的形状。

### RE-I2 —— `type undefined:` / `type NaN:` / `type Infinity:` 多报，其中一条引用**建议文本里的**词符

```text
/…/re/re03.vel:1:6 error VEL1005: Use 'null'; VelarScript does not expose 'undefined'
type undefined:
     ^^^^^^^^^

/…/re/re03.vel:1:6 error VEL3007: 'null' is a reserved word, so it cannot name a type; every use of it would read as the literal
type undefined:
     ^^^^^^^^^
```

`type NaN:` 三条，第二条无从下手：

```text
/…/re/re02.vel:1:6 error VEL1007: NaN is not a literal in VelarScript; produce it with arithmetic such as 0 / 0 and detect it with value.isNaN()
type NaN:
     ^^^

/…/re/re02.vel:1:6 error VEL2032: A statement ends at its newline; move '0' to its own line, or join it to the value before it with an operator
type NaN:
     ^^^

/…/re/re02.vel:2:1 error VEL2002: A statement ends at its newline; this indented line continues nothing — parenthesize an expression to span lines, or align the line with its block
    a: number
^^^^
```

插入符指着 `NaN`，消息叫作者去挪一个 `'0'` —— 文件里没有 `0`；那个 `0` 来自
上一条诊断的**建议文本**（`0 / 0`），被词法恢复当成了源码。本轮消息质量最差的一条。
`type Infinity:` 同形态（`1 / 0`）。

### RE-I3 —— 裸 `List`/`Map`/`Set`/`Record`/`Type` 在类型位报 `Unknown type 'List'`，用户泛型报「needs a type argument」

`re12.vel` 一个文件里并排：

```text
/…/re/re12.vel:7:10 error VEL4001: Generic type 'Rec' needs a type argument; write 'Rec<T>' with concrete types
const a: Rec = {value: 1}
         ^^^

/…/re/re12.vel:8:10 error VEL4001: Generic class 'Cls' needs a type argument; write 'Cls<T>' with concrete types
const b: Cls = Cls()
         ^^^

/…/re/re12.vel:9:10 error VEL4001: Unknown type 'List'
const c: List = []
         ^^^^

/…/re/re12.vel:10:10 error VEL4001: Unknown type 'Map'
const d: Map = Map()
         ^^^
```

`Set`、`Record`、`Type` 同样。同一编译器对 `type List:` 说的是
`'List' is a Core type name … every use of it resolves to the built-in`，
所以两条消息互相否定：一条说它是内建类型名，另一条说它是未知类型。而这一格
（`const c: List = []`，忘了写类型实参）是这门语言里最常见的手滑之一。

### RE-I4 —— `Array` / `dict` / `list` 裸用双报，第二条是 RE-I3 的假消息

```text
=== Array === 1:10 error VEL2012: Use 'List<T>' for ordered collections; VelarScript exposes one source-level List type | 1:10 error VEL4001: Unknown type 'List'
=== dict  === 1:10 error VEL2012: Use 'Map<K, V>' for keyed collections | 1:10 error VEL4001: Unknown type 'Map'
=== list  === 1:10 error VEL2012: Use 'List<T>' for ordered collections | 1:10 error VEL4001: Unknown type 'List'
```

带实参时改写成功、只剩指引一条（`Array<string>` → 仅 VEL2012）。所以裂缝是：
guided spelling 的目标是**泛型**类型时，改写后的裸名再走一次类型查找并失败。
目标是裸类型的那半边（`str`/`String`/`Number`/`boolean`/`Boolean`）只报一条，正确。

### RE-I5 —— `'any' is a Core type name` 与 `'any' is not a VelarScript type` 同时为真

```text
/…/re/re40.vel:1:1 error VEL3007: 'any' is a Core type name, so it cannot also name a type; every use of it resolves to the built-in. Rename this declaration
type any:
^^^^^^^^^
```

```text
/…/re/re41.vel:1:10 error VEL4001: 'any' is not a VelarScript type; a foreign value arrives as 'unknown', which is what you annotate; declare a type naming the shape you rely on — 'type X:' — then validate first: 'const checked = X.parse(value)' and use 'checked' from there
const v: any = 1
         ^^^
```

第一条说「每次使用都会解析到内建」，可是并没有一个内建的 `any` 供它解析到 ——
第二条就是这么说的。名册的来源是 `packages/compiler/src/analysis/scopes.ts:130`
的 `builtinTypeNames`，`any` 在里面。见 RE-C1（对宪章的偏离）。

### RE-I6 —— 类型参数位：guided spellings 与 `readonly` 不在名册，`<null>` 只给解析错

0.29.0：「A type parameter spelled with a Core type name gets **the same roster
sentence the other declaring positions use**.」Core 类型名那半边如实兑现：

```text
=== <List>     === VEL4021: 'List' is a Core type name, so it cannot also name a type parameter; every use of it resolves to the built-in. Rename this declaration
=== <Map>      === 同上   === <Set> === 同上   === <Promise> === 同上   === <Duration> === 同上
=== <Text>     === VEL4021: 'Text' is a reserved type-parameter bound — the bounds are Comparable, Text, Data — so it cannot also name a type parameter; rename it
```

guided spelling 那半边和 `readonly` 全部放行：

```text
=== <str>      === (clean)
=== <Array>    === (clean)
=== <readonly> === (clean)
=== <object>   === (clean)
=== <Callable> === (clean)
=== <null>     === VEL2025: A type parameter list requires at least one name | VEL2001: Expected a type parameter name
```

放行之后是 0.28.0 记的那种「声明可写、每次使用被拒」（`re04`/`re05`/`re06`）：

```text
/…/re/re04.vel:1:26 error VEL2012: Use 'string' for text values; str(value) is only the explicit text conversion function
def identity<str>(value: str) -> str:
                         ^^^
/…/re/re04.vel:1:34 error VEL2012: Use 'string' for text values; str(value) is only the explicit text conversion function
def identity<str>(value: str) -> str:
                                 ^^^
/…/re/re04.vel:5:23 error VEL4001: Cannot assign string to number
    const a: number = identity(1)
                      ^^^^^^^^^^^
/…/re/re04.vel:5:32 error VEL4001: Cannot assign number to string
    const a: number = identity(1)
                               ^
```

作者声明了一个泛型，拿回来一个 `(value: string) -> string`，四条诊断里没有一条
提到类型参数。`class Holder<Array>` 更糟，每处都撞上 RE-I4 的假消息：

```text
/…/re/re05.vel:2:21 error VEL2012: Use 'List<T>' for ordered collections; VelarScript exposes one source-level List type
    let items: List<Array> = []
                    ^^^^^
/…/re/re05.vel:2:21 error VEL4001: Unknown type 'List'
```

`type Box<readonly>: value: readonly` 是 0.28.0 「留门」条目的逐字复现：

```text
/…/re/re06.vel:2:20 error VEL2001: Expected a type name
    value: readonly
                   ^
```

`<null>` 那两条不点名保留字规则，而同一个词在 `type null:` 处拿到的是完美的
单条名册消息 —— 同一个 0.29.0 修复，两个位置两个结果。

### RE-I7 —— extern class 名：`extern module` 形式放行、`extern js` 形式按「imported name」拒、`class null:` 三条解析错

`re17.vel`（`extern module` 契约形式）：

```velar
extern module "some-lib":
    export class List:
        constructor()
    export class Promise:
        constructor()
    export class Text:
        constructor()
    export class null:
        constructor()
```

`List`/`Promise`/`Text` 一条诊断都没有；只有 `null` 报，而且报的是解析错：

```text
/…/re/re17.vel:12:18 error VEL2001: Expected an extern class name
    export class null:
                 ^^^^
/…/re/re17.vel:12:18 error VEL2001: Expected ':' before an extern class body
/…/re/re17.vel:12:18 error VEL2001: Expected a newline before an extern class body
```

`re18.vel`（`extern js` 内联块形式，同样 `export class List:`）：

```text
/…/re/re18.vel:4:5 error VEL3007: 'List' is a Core type name, so it cannot also name an imported name; every use of it resolves to the built-in. Rename this declaration
    export class List:
    ^^^^^^^^^^^^^^^^^^
```

两个 extern 拼写对同一个名字给相反答案，而拒绝的那个用的位置词是
「imported name」，不是 extern class。被放行的那个是「声明可写、每次使用被拒」
的第三个实例（`re19.vel`）：

```text
/…/re/re19.vel:6:13 error VEL4001: Unknown type 'List'
def take(v: List) -> number:
            ^^^^
```

### RE-I8 —— `??` 右臂对空**记录**字面量不是「期望类型位置」，消息退化

0.29.0：「Contextual generic inference reaches a `??` subject the way it reaches a
ternary arm」。泛型调用与 `[]` 都通了（`re21`/`re24` 全绿），空记录字面量没通。
直接位与三元臂给的是到位的指引（`re26`）：

```text
/…/re/re26.vel:5:41 error VEL4001: Use 'Map()' to create an empty Map; a record literal '{}' builds a record, not a Map
    const direct: Map<string, number> = {}
                                        ^^
/…/re/re26.vel:6:39 error VEL4001: Use 'Map()' to create an empty Map; a record literal '{}' builds a record, not a Map
    const tern: Map<string, number> = true ? {} : {}
                                      ^^^^^^^^^^^^^^
```

`??` 右臂给的是通用不匹配（`re24`）：

```text
/…/re/re24.vel:10:36 error VEL4001: Cannot assign Map<string, number> | {  } to Map<string, number>
    const c: Map<string, number> = maybeMap() ?? {}
                                   ^^^^^^^^^^^^^^^^
```

拒绝都对，但「`??` 两臂是不是上下文类型位置」这个概念今天仍有两个定义 ——
0.28.0 A-I1 的裂缝换了个接缝还在：泛型推断进去了，字面量形状指引没进去。

### TX-I1 —— `"ab" * 3` 只给 `Cannot assign string to number`

同一族的两条邻居消息都到位：

```text
/…/tx/tx04.vel:2:11 error VEL4001: String concatenation requires two strings; use an f-string or str(value), received string and number
    print("a" + 1)
          ^^^^^^^
/…/tx/tx31.vel:3:14 error VEL4001: Use '.char(index)'; strings are not indexable and string positions count Unicode code points
    print(f"{s[0]}")
             ^^^^
```

Python 的字符串重复没有：

```text
/…/tx/tx30.vel:2:14 error VEL4001: Cannot assign string to number
    print(f"{"ab" * 3}")
             ^^^^
```

作者的意图是 `"ab".repeat(3)`（语言里有这个成员），消息读起来像在要一次类型转换。
AGENTS.md 的反射表覆盖了 `//`、`%`、`enumerate`、`f"${}"`，没有 `str * int`。

---

## CHARTER-DRIFT —— 5 条

### RE-C1 —— `'any' is a Core type name` 与宪章 §5 直接矛盾

宪章 §5 第 985–1001 行把内建 Core 类型逐条列出（`string` `number` `bool` `null`
`List<T>` `Set<T>` `Map<K, V>` `Record<T>` `Promise<T>` `T?` 小联合 enum 单例
函数类型 `readonly` 视图 `unknown`）—— **`any` 不在其中**。紧接着第 1003 行：

> `any` is not a type VelarScript source may write. The word is refused in every
> annotation position, and the message names `unknown` — which is also what an
> undeclared foreign value arrives as.

而声明槽里的消息是 `'any' is a Core type name, so it cannot also name a type;
every use of it resolves to the built-in. Rename this declaration` —— 断言了一个
宪章说不存在的内建，给的理由（「每次使用都解析到内建」）在源码里为假，
并且没有点名 `unknown`（宪章要求的那半句）。拒绝本身正确，句子不真。
源码位置：`packages/compiler/src/analysis/scopes.ts:130` 的 `builtinTypeNames`
含 `"any"`。

### RE-C2 —— CHANGELOG 0.29.0 的「type parameter 拿到同一句名册」在 guided spellings 与 `readonly` 上不成立

0.29.0 的 Language 段：

> the guided spellings (`Array`, `str`, `dict`, `list`, `String`, `Number`,
> `boolean`, `void`, …) **can no longer name a declaration that every use would
> then rewrite** … A type parameter spelled with a Core type name gets the same
> roster sentence the other declaring positions use.

实测（RE-I6）：`<str>`、`<Array>`、`<readonly>` 全部放行，随后每处使用被改写或
被拒；`type readonly:` 已被 0.29.0 关掉，`type Box<readonly>:` 原样留着。
宪章 §5 第 1015 行给出的判据是「Each of them would declare a name **no
annotation can reach**」—— 类型参数正是一个只能在注解里用的名字，所以它落在
判据之内，而实现没覆盖它。

### RE-C3 —— 宪章 §5 说 `object` 「names no replacement」，实现给它点了两个替代拼写并拒绝每一处注解

宪章 §5 第 1023 行：

> A guided spelling that names no replacement, such as `object`, is ordinary: it
> still means the declaration.

实测 `object` 在类型位有指引，而且指引里点了替代（`re10`/`re14`/`re44`）：

```text
/…/re/re10.vel:4:10 error VEL2012: Declare a named 'type' for an object shape, or use 'unknown' at an unchecked boundary
const v: object = {a: 1}
         ^^^^^^
```

于是 `type object:` 被接受、`const v: object` 被拒 —— 正是同一段前面写的
「would declare a name no annotation can reach」。`Callable` 同形态且指引更具体：

```text
/…/re/re16.vel:2:10 error VEL2012: Write an explicit function type such as '(value: string) -> bool'
const f: Callable = v => v > 1
         ^^^^^^^^
```

第三个不一致：`class object:` 与 `enum object:` 编译并**运行**（`re13` 打印 `1`，
`re15` 打印 `a`），所以这个名字在值位完全可用、在类型位完全不可用。详见 RE-U1。

### AS-C1 —— `trySend` 在**关闭**的 channel 上抛，`docs/standard-library.md` 把布尔答案写给「buffer is full」、把 `ChannelClosedError` 写给「waiting senders」

`docs/standard-library.md`（Workers 前一节）：

> `trySend(value)` never waits and returns `false` when the buffer is full.
> … `close()` is idempotent: buffered values remain readable, **waiting senders**
> receive `ChannelClosedError`, and no new value is accepted.

实测 `as32.vel`（`trySend` 在 `close()` 之后）：

```text
velar run: uncaught error while running /…/as/as32.vel
ChannelClosedError: Channel is closed
    at Object.value [as trySend] (…/velar/task.js:286:29)
    at <anonymous> (/…/as/as32.vel:10:17)
  (2 Node.js internal frames hidden; rerun with 'velar run --stack' for the full trace)
```

对照 `as34.vel`（`trySend` 在**满**的 channel 上）如实答 `false`：

```text
true false
```

`trySend` 的整个立意是「不等待、给一个答案」，而关闭是它唯一会抛的路径，
文档把这条路径归给了 `send`。`send` 在关闭后抛（`as33`）是对的：

```text
send after close: ChannelClosedError / Channel is closed
```

### TX-C1 —— 宪章只在 §14 的 JSX 段落里说过格式化器不重排行

`velar format` 对 217 字符的单行字面量与 12 个插值的 f-string 一律原样保留
（`tx21`/`tx22`，两次格式化 diff 为空）。这是对的，但宪章里能引到的唯一一句是
§14 第 4056 行 JSX 段落中的「the formatter canonicalizes spelling, not the
author's line breaks」。Core 的格式化契约（§2、§3）没有对应条文，
`docs/cli.md` 的 format 段也只说「the single canonical layout — there are no
options」。规范文本缺一句一般性的「没有行宽」。

---

## UNDEFINED —— 12 条（charter 沉默处；下列实测行为即应成文的答案）

| ID | 未定之处 | 实测行为 |
|---|---|---|
| **AS-U1** | `@main` 是不是 owning scope | 宪章 §9 列举可拥有的作用域（function bodies, methods, actions, lifecycle cleanup hooks, `watch` bodies, loop bodies）**不含 `@main`**，也没说它被排除。实测拒绝，理由是「module-level」；发射侧证实 `@main` 体直接内联到模块作用域（`velar build` 后 `@main: print(f"{a}")` 出来就是 `console.log("1");`），所以拒绝有实现依据 —— 缺的是宪章那一句，以及一条不叫作者「declare the enclosing function 'async def'」的消息（AS-I3） |
| **AS-U2** | 运行时诊断报「source offset N」还是行列 | `NarrowingError: Flow narrowing for 'value' no longer holds: expected string **at source offset 135**`（`as31`），同一栈帧下一行已经写着 `as31.vel:9:18`。同族第二处：`packages/compiler/src/emit/runtime-imports.ts:408` 的 `Required value … is absent at source offset`。两处都把字节偏移交给作者 |
| **AS-U3** | `Promise.resolve` / `Promise.allSettled` 这类 JavaScript 反射 | 无指引，且级联三条：`Cannot await unknown; …` + `Object has no field 'allSettled'` + f-string 的 VEL4026（`as11`）。`Promise.` 表里没有 `resolve`/`reject`/`allSettled`，宪章也没说它们为什么不在；近似匹配对 `slep`→`sleep` 有效，对这三个词无效 |
| **ER-U1** | `finally` 与 `using` 释放的先后 | 宪章 §9 说释放发生在「every exit from the enclosing scope」，§11 说 `finally` 「is analyzed after those paths」，都没排序。实测 `er21.vel`（函数体里 `using` + `try/finally` + `return`）：`finally` → `release` → 返回值。多个 `using` 之间是逆序（`as23`：`release B` → `release A`），释放失败不跳过后续释放（`as67`：B 抛错、A 仍然释放、错误照常传播） |
| **ER-U2** | `IndexError` 的运行时消息说不说是哪个下标 | 不说：`IndexError: List index must be an in-range integer`（`er39`，`xs[5]` 在一个 1 元素 List 上）。对照同族的字段守卫，宪章 §18 明写它「raises a host `TypeError` **naming the field**」—— 两个编译器注入的守卫，一个点名一个不点名 |
| **MD-U1** | 独立模式（无 velar.json）的 Core 文件按哪个目标编译 | 按 `node`：`import js {readFileSync} from "node:fs"`（`md36`）与 `import {readText} from "velar/fs"`（`md37`）都是 `Checked 1 module`。VEL6006 的判据是 `context.packageTarget !== "node"`（`packages/cli/src/project.ts:881`），钉了 Web 的工程里如实报在作者行（`md41`，见 DECIDED-AND-CORRECT/MD）。`docs/cli.md` 只说「a Core project — which declares none — prints `core` and `node` alone」，没说这等于 Core 文件可以用 Node 能力 |
| **MD-U2** | `velar/test` 出现在非测试文件 | 报 `Module 'velar/test' has no export named 'test'`（`md39`）—— 无码无位（MD-I1 同族），而且诊断本身不真：`velar/test` 确实导出 `test`，真正的规则是宪章 §12 的「Test modules use named `test "…":` declarations」加 `*.test.vel` 的文件名约定。作者被指向了一个不存在的导出问题 |
| **MD-U3** | 同一个名字从同一模块导入两次（一次改名） | `import {title} …` + `import {title as other} …` 静默通过（`md34`）。同一条 import 子句里重复则报 `VEL3004: Name 'title' is already imported from "./lib.vel"; alias one of the imports`（`md35`）。两行的形态没有规则可引 |
| **TX-U1** | 布局字符串的内容缩进必须**严格深于**开行 | 内容与开行同缩进时报 `VEL1003: Unterminated layout string; close it with a quote at the opening line's indentation` 加一串级联（`tx09` 第一版），消息没说内容要更深。宪章 §3 说「Its first nonblank content line establishes a structural indentation margin, and a quote back at the opening line's indentation closes the value」—— 两者相等时的行为要成文 |
| **TX-U2** | 结构对象类型在诊断里被打印成源码写不出的拼写 | `{ a: number }`、`{ value: string, index: number, groups: List<string?> }`、`List<{ first: number, second: U }>` 出现在多条消息里，而 `const a: {x: number} = {x: 1}` 报 `VEL2001: Expected a type name`（`re29`）。后果具体：`zip` 的结果类型今天**无法写进注解**，只能不写 |
| **TX-U3** | 字面量实参的运行时契约仍只在运行时查 | 0.28.0 C-U1 的同族，本轮新增三处：`"ab".repeat(-1)` → `RangeError: String.repeat count must be an integer from 0 through 16777216`；`"abc".char(1.5)` → `TypeError: String.char index must be an integer`；`Text.findMatch("x", "([")` → `TypeError: Invalid text pattern: Unterminated character class`。最后一条尤其值得成文：pattern 源是字面量，编译器已经为它维护了 4,096 code unit 的上限 |
| **RE-U1** | `object` / `Object` / `Callable` 作声明名（**所有者裁决项 (a)**） | 见下表。三个名字三种答案，`Object` 那条不说规则也不给替代 |

**所有者裁决项 (a) 的事实表**（`re10`–`re16`、`re42`–`re44` 与名册扫描）：

| 名字 | `type X:` | `class X:` / `enum X:` | 值位使用 | 类型位使用 | 有没有替代拼写 |
|---|---|---|---|---|---|
| `object` | 接受 | 接受 | 可用（`re13` 运行打印 `1`，`re15` 打印 `a`） | `VEL2012: Declare a named 'type' for an object shape, or use 'unknown' at an unchecked boundary` | 有，指引里点了两个 |
| `Object` | `VEL3007: 'Object' is a reserved Core binding` | — | — | 同上那句 VEL2012 | 有（同上），但拒绝句里没写 |
| `Callable` | 接受 | 接受 | 可用 | `VEL2012: Write an explicit function type such as '(value: string) -> bool'` | 有，指引里点了 |

三个名字都不能命名类型参数以外的东西而不留后患：`object`/`Callable` 的声明
写得出、注解引不到；`Object` 的拒绝句是名册里最短的一句，既不说位置也不给改法。
`class object:` 与 `enum object:` 甚至能跑起来，所以「接受」不是纸面上的。

**所有者裁决项 (b) 的事实**（extern class 用内建类型名，`re17`–`re20`）：
`extern module "pkg": export class List:` **不拒**（`Promise`、`Text` 同），
`extern js\`…\`: export class List:` 拒，且用的位置词是 `imported name`；
`export class null:` 在 extern 契约里只有三条解析错，没有 0.29.0 给
`class null:` 的那条名册消息。被放行的 extern `List` 随后在类型位撞
`Unknown type 'List'`（RE-I3 的假消息），按名导入则撞名册拒绝。

---

## DECIDED-AND-CORRECT —— 完整性凭证（压缩记录）

### AS —— 异步、任务、工作所有权（约 68 个探针）

**`await` 位置 6 项**：同步 `def` 里 → `VEL4007: 'await' can only be used in an
async function or at module scope`（点名规则与两条出路）· 普通箭头体里同款 ·
模块顶层接受并正确运行 · `async` 箭头接受 · 有 `@main` 时模块顶层的
`await` 仍接受且先于 `@main` 运行 · `await 5` → `Cannot await number`。

**`async` 推断 2 项**：`async () => 1` 的类型是 `() -> Promise<number>`；
`async () => inner()`（内部已是 Promise）也是 `() -> Promise<number>` ——
原生 Promise adoption，不需要 `return await`。

**`Promise.` 组合子 9 项**：`all` 的异构 List 被拒并教记录形式
（`Mixed result types need named fields; use Promise.all({name: loadName(), count: loadCount()})`）·
`all` 的记录形式运行正确（`1 x`）· `all` 记录形式**保留错误类身份**
（`as65`：`code=Named is=true`）· `race` 正确 · `race([])` →
`Expected a List of Promises, received List<unknown>` · `retry` 重试到成功
（`3 after 3`）· `map` 保序（完成顺序 3/2/1，结果 `[2,4,6]`）· `series` 顺序执行
（`one` `two` → `[1,2]`）· `timeout` 生效。

**`detach` 4 项**：Promise 表达式语句被拒并给两条出路
（`VEL4027: This call returns Promise<null>; 'await save()' to wait for it, or
'detach save()' to run it detached`）· 非 null 结果的 `detach` 被拒
（`VEL4028: The result would be lost; await it, or discard it explicitly in an
async def`）· 分离任务失败经宿主通道报告且**不结束程序**（退出码 0）·
`@main` 结束后才失败的分离任务仍被报告（`as66`）。

**退出码 4 项**：`@main` 里的同步 throw、`@main` 里的 `await` throw、
模块顶层的同步 throw、模块顶层的 `await` rejection —— 四条路径**全部退出 1**
并打印 `velar run: uncaught error while running …`。

**`then` 冲突 3 项**：可调用 `then` 数据字段的记录做 async 结果被拒
（`VEL4024: A Promise cannot resolve to Thenable because type 'Thenable' exposes
a callable 'then' data field; JavaScript would treat the value as a magic
thenable. Rename 'then' or keep this value outside an async result`）·
`then: string` 放行且运行正常 · `Promise<List<Thenable>>` 放行（不检查元素）。

**`using` 12 项**：逆序释放 · 异步 `@dispose:` 让释放也 await 且排在挂起
`await` 之后 · 派生类 `@dispose:` 先于基类 · 子类开始 await 而基类不 await 被拒
（`VEL4035: Class 'Derived' awaits in '@dispose', but 'Base' releases without
awaiting; …`）· `return handle` 被拒（`VEL4036`，两条出路都点名）· 逃逸闭包捕获
被拒、不捕获的闭包放行 · 记录不能被拥有（`VEL4032: 'using' releases a value whose
type declares '@dispose'; { a: number } does not; a record is data, so it has
nothing to release`）· `using` 不接受注解（`VEL2036`）· 循环体每轮释放
（`body 1 / release 1 / body 2 / release 2`）· 释放失败在有错在飞时经宿主通道报告
且原错传播 · 释放失败在无错在飞时正常抛出且**不跳过**其余释放。

**`velar/task` 6 项**：`task(work)` + `t.result()` 运行得 42 · `cancel` 后
`try await t.result()` 得 null · `withTimeout` 抛 `TaskTimeoutError` 且 `is` narrow ·
`channel` 的 `trySend`/`next`/`close`/`closed`/`size` 全部按文档 · `close()` 幂等且
缓冲值仍可读 · `async for` 驱动 channel 直到 drain。

**表达式位的 `await` 6 项**：f-string 内 · 一个 f-string 内两处 · 三元臂 ·
`??` 左臂 · `??` 链式三段 · `match` 主语（`match await n():` 语句形式接受）。

**跨 `await` 的窄化 1 项**：模块级 `let` 在被 `await` 的调用里被清空后再读 ——
编译通过（守卫读），运行期正确抛 `NarrowingError`（宪章 §11/§18 的机制如实生效）。

**异步迭代 2 项**：`async for` 对 List 被拒并点名契约
（`async for requires next() -> Promise<T?>; List<number> does not expose that
pull contract`）· channel 的记录元素带可空字段时正常（`as69`：`got NULL` /
`got second`）—— 可空**字段**没问题，可空**元素**是 AS-D1。

**`try` 与 Promise 2 项**：`try load()`（未 await）被拒并给改法
（`VEL4034: … write 'try await ...' so the rejection is what is caught`）·
`try try` 被拒。

**格式 1 项**：37 个能编译的 AS 探针 `velar format` **全部幂等、零破坏**；
折行是把单语句块折成一行（`@dispose: print("release B")`、`try: await c.send(...)`），
语义不变。

### ER —— 错误与断言（约 52 个探针）

**`throw` 边界 2 项**：`throw "just text"` → `Only Error values can be thrown,
received string`；`throw {a: 1}` → `… received { a: number }`。

**Error 契约 6 项**：`name`/`code`/`message`/`stack`/`cause` 作字段重声明各有一句
到位的规则（见 ER-I2 引文）· 三个编译器内建错误类不可扩展
（`The builtin error type 'ValidationError' cannot be extended; extend Error and
declare your own fields`）· `class FileNotFoundError extends Error` →
`VEL3007: 'FileNotFoundError' is a reserved Core binding`。

**`code` 与 `is` 一致 6 项**：用户子类（`code=TimeoutError`，`is` 为真）·
`ValidationError("bad shape")` 与 `IndexError("out of range")` 可直接构造并抛 ·
`FileNotFoundError()` 的 `code` 与 `is` 一致、narrow 后 `path` 可读 ·
被 JavaScript 改名的 host error 报 `name=TimeoutError code=Error`
（宪章：「`.name` still shows whatever the value carries, which is why the
discriminating question is `is`, never `name`」）。

**JS 边界归一 3 项**（`extern js` 内联块实测）：抛字符串 →
`msg='plain string failure'`；抛对象 → `msg='A non-Error value was thrown by
JavaScript' causeNull=false`（原值留在 `cause`）；抛数字 → `msg='42'`。
无 cause 时 `error.cause == null` 为真。

**`finally` 4 项**：`finally` 在 `return` 之后运行、返回值不变（`finally ran` /
`try`）· `return` 在 `finally` 里被拒并给改法（`VEL3015: 'return' cannot leave a
finally block; assign a result before finally and return afterward`）·
`try` 无 `catch` 无 `finally` 被拒（`VEL2008`）· 第二个 `catch` 块被拒。

**窄化与身份 5 项**：`catch` 绑定是 `Error`（`Class 'Error' has no member 'path'`）·
`is` narrow 后成员可读 · `match` 对错误的类模式可用（`case NotFound as e:`）·
rethrow 保持身份（`error == original` 为 `true`）· `===` 被拒并教 `==`
（`VEL1005: Use '=='; equality is already strict in VelarScript`）。

**期望失败的 optional 6 项**：`try readPort() ?? 8080` · `try User.parse(...)` 配
`?.` · `try try` 被拒并说明理由 · 成功即 null 的表达式上的 `try` 被拒
（`This expression produces null on success, so a 'try' result cannot tell success
from failure`）· 三条永不转 null 的失败全部穿透 `try`（`AssertionError`
两处、`IndexError` 一处，实测都到了未捕获路径）· `Promise.retry` 也不吞
`IndexError`（`retry caught code=IndexError`）。

**断言 3 项**：`assert 0 < width <= 4096 else "…"` 在生产运行里生效并打印
`AssertionError: Width is outside the supported range` · 断言窄化可选
（`assert value != null` 后 `return value` 通过）· 断言消息按**被拒事实**检查
（`f"absent: {value.size}"` → `null has no member 'size'`）。

**泛型错误类 2 项**：`class ParseError<T> extends Error` 声明通过；
`const e: ParseError<string> = ParseError()` 构造并抛通过；
`throw ParseError<string>()` 被拒并教推断（`VEL2031: Type arguments are inferred
at each call site; write 'ParseError(...)' without '<...>'`）。

**格式 1 项**：23 个能编译的 ER 探针 `velar format` 全部幂等、零破坏。

### MD —— 模块与 JavaScript 边界（约 60 个探针）

**命名空间成员 8 项**（0.29.0 的新面，含变体）：`library.Point` / `library.Box<string>` /
`List<library.Box<string>>` / `is library.Stack<number>` / `library.Status`
在类型位**整体解析**并各拿一条点名改写的拒绝；措辞按被引名字变形
（`import 'Box' by name … and write 'Box<string>'` vs `import 'Status' by name …
or bind an enum object first with const Status = library.Status`）·
`library.Status.pending` 在**值位**与**模式位**都合法且与按名导入的孪生行为一致
（`md06b` 干净、`md06c` 的穷尽性照报 `Match on Status is missing: done`）·
`library.Point.parse(...)` 可用。

**导入/导出形式 9 项**：`export default` 被拒并教具名导出 · `.vel` 的默认导入被拒 ·
`import type` / `export type` 被拒并给理由与机械修复（`velar fix` 实测把 `type`
删掉）· `export * from` 被拒并教逐名再导出 · 具名再导出（含改名）通过 ·
副作用导入与空导入两种拼写都被拒并教「export a function and call it」·
未使用的导入不报也不被 `fix` 删。

**自导入与循环 5 项**：三种自导入拼写（具名、再导出、命名空间）在名字可解析时
都报 VEL6004 · 双模块循环得 advisory VEL6010 · 循环里的**初始化位读**得
`VEL3019: Move this read into a function, or extract the shared value into a third
module; './circ-a.vel' has not initialized when this line runs` · 循环里只经函数体
的读放行且运行正确（`C+D`）· 菱形依赖只初始化一次（`c initialized` 一行）。

**动态导入 6 项**：字面相对路径通过并运行 · 变量路径被拒
（`Dynamic imports require a literal relative .vel path`）· `velar/*` 被拒
（`VEL2014: Dynamic imports require a literal relative path ending in '.vel'`）·
不存在的路径报 VEL6001 **并给最近名** · 命名空间是检查过的接口（未导出名报错）·
初始化失败被记住：两次 `await import("./boom.vel")` 只打印一次
`boom module initializing`，两次都拿到同一个 `init failed`。

**live export 3 项**：`export let` 经具名导入可见写回（`bump()` 后读到 `1`）·
命名空间导入被拒并教按名导入 · 写导入名被拒
（`VEL3002: Cannot assign to imported binding 'counter'; imports are read-only.
Change the value in its owning module ("./live.vel"), or copy it into a local
'let' first`）。

**导出的类型形态 4 项**：`type` 别名、记录 `type`、`enum`、泛型记录 `Pair<T>`
经具名导入全部可用并运行正确（`1 1 red 1`）。

**JS 桥 7 项**：泛型 extern `def` 接受 · 泛型 extern **class** 被拒并给改法
（`VEL2025: Extern class 'Formatter' cannot declare type parameters; declare the
class without them and use generic 'def' members or 'unknown' where the type
varies`）· 内联 `extern js` 块的 extern class 在 `is` 与 `case` 里可用并运行
（`p:1` / `formatter`）· extern 主语的 `match` 只认 `case _:` 作穷尽
（`VEL4015: Match on Formatter is missing a fallback; class hierarchies are open —
end with 'case _:'`，与宪章 §9「only `case _:` proves an extern subject」一致）·
未安装的包导入报 VEL6006 并点名 · `import js unsafe` 的绑定是 `unknown`。

**目标边界 1 项**：钉了 `@velarscript/web` 的工程里，`import js {readFileSync}
from "node:fs"` 报在**作者行**：

```text
/…/md/webproj/main.vel:1:32 error VEL6006: JavaScript Node builtin import "node:fs" is available only to the Node target; the current target is 'web'
import js {readFileSync} from "node:fs"
                               ^^^^^^^
```

**退役模块 2 项**：`velar/collections` 的命名空间导入给专门一句
（`drop the namespace import and call the member on the List — values.groupBy(key)`）·
从退役模块导入 `range` 现在**只报一条**（0.28.0 D-I1 已修，见 RE 段）。

**格式 1 项**：20 个能编译的 MD 探针 `velar format` 全部幂等、零破坏；
`extern js` 块体逐字保留。

### TX —— 字符串与 Text（约 45 个探针）

**f-string 8 项**：插值里嵌套双引号（`f"nested {"inner"} quote"` → `nested inner
quote`）· `{{` / `}}` 字面花括号 · `${name}` 保持字面并触发 A6（消息给出完整改写）·
`?.` 与 `??` 组合 · lambda 与链式调用 · 括号表达式 · 三元 · 格式规格被拒并教两个
真实改法（`VEL2009: An interpolation holds one expression; VelarScript has no ':'
format specs. Format the value first — value.toFixed(2) for fixed decimals,
str(value).padStart(size) for width`）。

**字面量与转义 7 项**：布局字符串（内容与相对缩进逐字保留，`len=36`，format 稳定）·
`r"C:\path\"` · `r"He said ""hello"""` · `rf` 组合 · `fr` 被拒并教 `rf` ·
`\uXXXX` 被拒并教 `\u{...}` · `\u{D800}` 代理被拒 · `"""triple"""` 被拒并教布局字符串。

**分隔符规范化 1 项**：`velar format` 按宪章 §3 的表逐条正确
（无 `"` → `"..."`；有 `"` 无 `` ` `` → `` `...` ``；两者都有 → 转义更少者，
平手取 `"`），格式化前后运行输出逐字相同。

**Unicode 7 项**：ZWJ 家族 emoji `size=5`（码点，不是字素）· 区域指示符旗帜 `size=2` ·
`slice(0, 1)` 与 `char(0)` 都答 `👨` · 组合字符与预组合字符 `size` 分别是 2 和 1
且 `==` 为 false（宪章「Text equality is code-point-sequence identity」）·
`"straße".upper()` = `STRASSE`（长度变化，宪章 §7 明写）·
`upper().lower()` 不可逆（`strasse` ≠ `straße`，宪章 §7 用同一个例子说了）·
排序是码点序（`["Apple","apple","banana","zebra","Äpfel","éclair"]`，
宪章 §4「String order is Unicode code-point order … never UTF-16 code-unit order」）。

**成员契约 8 项**：`slice(0,5)` / `slice(start=6)` / `slice(-5)` 三种形态 ·
`index("o", start=5)` 具名实参 · `char(100)` 越界答 null · `split("")` 按码点切 ·
`"lo" in t` 与 `t.has("lo")` 同解 · `s[0]` 被拒并教 `.char(index)`。

**`Text.` 命名空间 10 项**：`capitalize` `title` `words` `slug`（`Café ½ ﬁn` →
`cafe-1-2-fin`，NFKD 兼容折叠如实生效）`truncate`（`abcdefgh`,5 → `abcd…`，
给后缀留位）`utf8Size`（`🔥` → 4）`codePoint`/`fromCodePoint` 互逆 ·
`lineStarts("a\nb\n")` → `[0,2,4]` · `chunks("🔥🔥🔥", 2)` → `["🔥🔥","🔥"]`
（不切代理对）· `normalize` 的非法 form 抛 `RangeError: normalize form must be
NFC, NFD, NFKC, or NFKD`。

**pattern 操作 6 项**：`matches` `findMatch`（`index` 是码点位）`findMatches`
`replaceMatches` `splitPattern` 全部按文档；Unicode 模式下的 identity escape
（`\@`）与未闭合字符类都在边界抛 `TypeError` 并带引擎理由。

**其它 5 项**：`"a" + 1` 被拒并教 f-string / `str(value)` · `+=` 字符串拼接 ·
`str(...)` 对 enum/number/bool/null 的文本形式（`red` `1.5` `true` `null`）·
f-string 插值 `null` 打印 `null`、记录与 List 被拒并给两条出路 ·
字符串作 `match` 主语（值模式、守卫、`case _:`）与穷尽性
（`VEL4006: Function 'go' can finish without returning string`）。

**格式与语义 2 项**：20 个能编译的 TX 探针 `velar format` 全部幂等、零破坏；
12 个可运行探针格式化前后**运行输出逐字相同**。

### RE —— 0.29.0 复验（约 130 个探针）

**保留名单条报告 12 项**（0.29.0 Breaking 的主承诺，变体覆盖）：
`type/class/enum` × `null` / `readonly` / `true` / `false` 十二格**全部单条**、
全部点名规则，且位置词随声明形式变形：

```text
'null'     is a reserved word, so it cannot name a type/a class/an enum; every use of it would read as the literal
'readonly' is the read-only view modifier, so it cannot name a type/a class/an enum; every use of it would read as the modifier
'true'     is a reserved word, …    'false' is a reserved word, …
```

**guided spelling 名册 9 项**：`Array` `str` `dict` `list` `String` `Number`
`boolean` `void` `Boolean` 作 `type` 声明全部单条并点名目标
（`'Array' is guided to 'List' in every type position, so it cannot name a type;
every use of it would read as 'List'`）。

**Core 类型名名册 8 项**：`List` `Map` `Set` `Record` `Promise` `Function` `Type`
`Duration` 作 `type` 声明全部 VEL3007 单条。`Text` 按宪章 §5「the sentence that
says *why* the name is taken is the one reported」正确降到 bound 那一句
（`'Text' is a reserved type-parameter bound — the bounds are Comparable, Text,
Data — so it cannot also name a type`）。

**类型参数位 6 项**：`<List>` `<Map>` `<Set>` `<Promise>` `<Duration>` 拿到名册句
（`VEL4021: … it cannot also name a type parameter; every use of it resolves to
the built-in. Rename this declaration`）；`<Comparable>` `<Text>` `<Data>` 拿到
bound 那一句。0.28.0 **F-I1**（类型参数位用通用遮蔽措辞）**已修**。

**命名空间成员类型拼写 5 项**：见 MD 段，五种形态全部整体解析、各一条拒绝。
0.28.0 记的 `const a: st.Stack<number>` 级联解析错（`VEL2001: Expected '=' after
binding pattern`）**已修**。

**`??` 上下文推断 6 项**：`maybe() ?? empty()` · 链式两段 · 链式三段配 `[]` ·
`??` 结果进三元 · `??` 结果进实参位 · `Map()` 右臂 —— 全部解出 `T`。
（空**记录**字面量右臂见 RE-I8。）

**泛型子类模式 2 项**：`case Round:` 对 `Shape<number>` 主语现在干净通过
（0.28.0 **B-D1** 已修）· `case Shape<number>:` 仍报 `VEL4022` + `VEL4014`
（`re25`）—— **KNOWN-IN-FLIGHT**，按简报不重开：

```text
/…/re/re25.vel:6:14 error VEL4022: Type arguments are erased at runtime, so 'Shape<number>' cannot be checked; check 'Shape' itself
/…/re/re25.vel:8:14 error VEL4014: This match branch is already covered
```

**成员泛型 13 项**（0.28.0 **I-I1** 已修，含简报要求的变体）：
`groupBy` `keyBy` `countBy` `zip` `map` `flatMap` 六个成员分别经**一等绑定**
（`const g = xs.groupBy`）与 **`?.` 接收者**（`opt?.map(...)`）解出正确结果类型；
`readonly` 接收者上的一等绑定同样解出；`opt?.zip` 的一等绑定在 `opt` 真可选时
是可选函数并被正确要求先做在场检查
（`Use a presence check or an optional access chain before calling an optional
function`），在编译器能证明在场时正确去掉可选性。运行结果
`2 3 2 2 3 3` 与直接调用一致。

**`List<null>.compact()` 1 项**（0.28.0 **C-I1** 已修）：

```text
/…/re/re32.vel:4:15 error VEL4001: List<null>.compact() removes every element; the element type is only null, so the result would have no element type — drop the call
```

**退役模块的 `range` 3 项**（0.28.0 **D-I1** 已修）：具名、混合、改名三种形态
现在都**只报一条** `VEL3008: Use range(...) directly; the Core prelude needs no
import`，不再叠 VEL3007。

**`velar fix` 嵌套改写 6 项**（0.28.0 **D-D1** 已修，含三层与四层变体）：

| 探针 | 原文 | 修复后 | check | run |
|---|---|---|---|---|
| `f1` | `print(f"{sum(unique(xs))}")` | `print(f"{xs.unique().sum()}")` | 干净 | `6` |
| `f2` | `sum(unique(compact(xs)))` | `xs.compact().unique().sum()` | 干净 | `4` |
| `f3` | `sum(unique(compact(flatten(xs))))` | `xs.flatten().compact().unique().sum()` | 干净 | `4` |
| `f4` | `sum(unique(first(xs) ?? []))` | `(xs.get(0) ?? []).unique().sum()` | 干净 | `4` |
| `f5` | 外层不可改写（`enumerate`） | 内层照迁移、`enumerate` 保留在 import 行、退出非零并如实报 `applied 1 mechanical fix in 1 file; 4 diagnostics remain` | — | — |
| `f6` | 具名实参 + 链式 + f-string 内嵌套 | `rows.sorted(by=…).map(…)` + `f"{ranks.unique().sum()} …"` | 干净 | `3 2` |

另两项：`Function<string>` 的机械修复到位（`const v: () -> string = …`，0 诊断）；
保留名声明**不带**机械修复（`applied 0 mechanical fixes; 1 diagnostic remains`），
正确 —— 新名字是作者的选择。

**A17 6 项**（0.29.0 的静默承诺，含变体）：`print(["a", 1])` 静默 ·
`Json.stringify(["a", 1])` 静默 · `def take(value: unknown)` 实参位静默 ·
`def take(values: List<unknown>)` 静默 · `def take(...values: unknown)` rest 位静默 ·
未注解绑定照报。0.28.0 **G-I1** 已闭合。

**`velar format` 拒绝写回 4 项**（0.28.0 **I-D1** 已修）：工程外的 JSX 文件
（`velar check` 拒解析）现在原样保留：

```text
$ node packages/cli/dist/cli.js format .../re/lone/j.vel
velar format: /…/re/lone/j.vel does not parse, so it was left unchanged; fix the syntax first
/…/re/lone/j.vel:1:8 error VEL2026: Unknown declaration keyword 'component'; VelarScript declarations start with 'def', 'type', 'enum', 'class', 'const', or 'let'
```

文件内容 diff 为空；退出码 1。`--check` 在未格式化文件上退 1、在已格式化文件上退 0。
（文案小疵：单数情形打印 `1 of 1 VelarScript source file require formatting`。）

**泛型声明 hover 8 项**（0.28.0 **I-I2** 已修，`velar lsp` 实测）：

```text
class Stack decl             => ``class Stack: Stack<T: Comparable>``
type Box decl                => ``type Box: Box<T>``
def empty decl               => ``function empty: <T>() -> List<T>``
enum Color decl              => ``enum Color: enum Color``
numbers binding              => ``const numbers: Stack<number>``
Stack() construction         => ``class Stack: Stack<T: Comparable>``
b binding                    => ``const b: Box<string>``
empty() call                 => ``function empty: <T>() -> List<T>``
```

泛型类与泛型记录的声明位现在都发布 `<T>` 与界。
（文案小疵：`class Stack: Stack<…>` 与 `enum Color: enum Color` 把类别词重复了一遍。）

**表面版本门 1 项**：`node scripts/check-surface-versions.mjs` 在 HEAD 绿：

```text
Hashed 5 language surfaces (D110):
  core     core@0.7        369 names  9091c76a307dc9a2…
  web      web@0.12        468 names  f03e196b7a0497af…  (over core; 470 published in all)
  node     node@0.16        99 names  91b378800bc51926…  (over core; 99 published in all)
  server   server@0.15      12 names  91274c0270f81fa3…  (over core, node; 111 published in all)
  desktop  desktop@0.10     73 names  e884e8e24097aeff…  (over core, node, web; 333 published in all)
  lock: surface-lock.json
```

---

## 所有者裁决项 (c) —— 表面摘要今天到底散列了什么

`scripts/check-surface-versions.mjs:1` 把枚举整个委托给
`scripts/surface-inventory.mjs`，摘要由 `surfaceDigest`
（`scripts/surface-inventory.mjs:264–270`）对「排序后的条目键 + 该条目的
canonical public contract」做 SHA-256；Core 面今天是 **369 个条目、11 个类别**，
逐类别的来源是：`hard-keyword` 41 个（`keywordKinds`，
`packages/compiler/src/token.ts`）· `type-parameter-bound` 3 个
（`Comparable Text Data`，`packages/compiler/src/types/model.ts`）·
`generic-declaration` 3 个（`def type class`，`TYPE_PARAMETER_DECLARATION_FORMS`，
`packages/compiler/src/core-vocabulary.ts:169`）· `permanent-namespace` 4 个
（`Json Promise Text Math`，`core-vocabulary.ts:50`）· `prelude-name` 5 个
（`number str print equals range`，`core-vocabulary.ts:53`）· `contextual-keyword`
11 个与 `numeric-suffix` 2 个（`core-vocabulary.ts:97` 与 `:159`）·
`statement-construct` 33 个（`CORE_STATEMENT_CONSTRUCTS`，
`packages/compiler/src/ast.ts`）· `collection-member` 123 个
（`Analyzer.coreCollectionMemberContracts()`，`packages/compiler/src/analyzer.ts:1734`，
覆盖 List/Map/Set/Record 的可变与 `readonly` 两种接收者，来源是
`packages/compiler/src/analysis/collections/members.ts`）· `module-export` 80 个与
`namespace-member` 64 个（`standardModuleInterfaces`，`packages/core/src/index.ts`）。
**不在**摘要里的三样恰好是简报点名的三样，我用一段脚本对 369 个条目键逐一查过：
内建类型名名册（`builtinTypeNames`，`packages/compiler/src/analysis/scopes.ts:130`，
含 `List` `Map` `Set` `Record` `Promise` `Function` `Type` `Duration` `any` …）
**ABSENT**；退役拼写表（`packages/compiler/src/analysis/collections/retired.ts`
的 `sortBy`/`minBy`/`maxBy`/`enumerate` 与退役模块 `velar/collections`）
**ABSENT**；A 名册（`packages/compiler/src/analysis/advisories.ts` 的 `A1`–`A17`）
**ABSENT** —— 三个文件都不在 `surface-inventory.mjs:1–25` 的 import 列表里，
所以对它们的任何增删改都不会移动 Core 摘要。同一次检查还查出两处简报没问但同族的
空洞：保留的错误类名（`IndexError` `ValidationError` `NarrowingError`
`FileNotFoundError` `PermissionError` …）**ABSENT**，以及宪章 §7 明写为规范表的
**`string` 与 `number` 的检查值方法**（`size` `upper` `lower` `slice` `char` `has`
`index` `count` `startsWith` `endsWith` `isBlank` `split` `replace` `replaceAll`
`repeat` `padStart` `padEnd` `abs` `round` `floor` `ceil` `toFixed` `isInteger`
`isNaN` `isFinite`）**ABSENT** —— `coreCollectionMemberContracts` 只走
List/Map/Set/Record，`padStart`/`toFixed`/`isNaN`/`upper`/`char` 逐一查询全部
返回 `(NOT HASHED)`，所以给 `string.padStart` 改签名或增删一个字符串成员，
`core` 摘要不动、门不红。

---

## 修复优先序（建议，不含实施）

1. **AS-D1（异步 `@iterate:` 静默丢元素）** —— 本轮唯一一条编译通过后静默错误的。
   宪章已经把这条歧义写进了排除同步形式的理由里，缺的是「作者写出来时发生什么」
   这一句，以及一条能在编译期发出的诊断。
2. **RE-I3 / RE-I4（`Unknown type 'List'`）** —— 一条**为假**的消息，落在
   `const c: List = []` 这种最常见的手滑上，并且与同一编译器的名册消息互相否定。
   用户泛型那条（`Generic type 'Rec' needs a type argument`）已经是正确形状。
3. **MD-I1（模块解析诊断族无码无位）** —— 20 多个站点、六种作者天天撞见的形态，
   编辑器定位不了、缺陷报告引用不了。`ProjectFailure`
   （`packages/cli/src/project.ts:92`）比 `recordResolution` 少了两个字段。
4. **RE-C2 / RE-I6 / RE-I7 / RE-U1（0.29.0 名册的三处漏格）** ——
   类型参数位的 guided spellings 与 `readonly`、extern class 名、
   `object`/`Object`/`Callable`。三处都是「声明可写、每次使用被拒」，
   正是 0.29.0 那条 Breaking 要消灭的形状；宪章 §5 第 1015 行的判据
   （「would declare a name no annotation can reach」）已经把它们圈进去了。
   `object` 那一格需要所有者先裁：宪章说它「names no replacement」，
   实现给了它两个替代 —— 改宪章还是改实现。
5. **RE-I1 / RE-I2（`int`/`float`/`undefined`/`NaN`/`Infinity` 多报且点名错名字）**
   —— 同一条 Breaking 的另一半：这几个词今天走词法改写路径，名册对改写后的名字
   开火。`type NaN:` 那条引用建议文本里 `'0'` 的诊断优先级最高，它读起来不可理解。
6. **MD-I4（VEL6010 不可压制）** —— AGENTS.md 的仓库契约要求作者解决每一条
   advisory，而这一条的两条出路都不通；`diagnostic.ts:71` 的注释已经把规则写了
   （advisory id 不用 VELxxxx 族）。
7. **AS-I1（宿主错误通道不隐藏内部帧、`--stack` 无效）** —— 两条通道
   （detach 失败、释放失败），一个类，不是一个拼写。
8. **ER-I1（`extends Error` 的零参构造无声）** —— 宪章亲自推荐这条路；
   普通子类那条路的消息已经是正确形状，照搬即可。
9. **MD-I5 / MD-I3（`match` 对 `unknown`、自导入漏 VEL6004）** ——
   两条都是 0.28.0 已修条目的**邻居**：`is`/`case` 那一对、以及只在名字解析
   成功时生效的自导入规则。
10. **AS-I7（错误产生的 `unknown` 级联出第二条修法错误的诊断）** ——
    影响面最广的单一噪声源，本轮五个面都撞到；一次抑制换掉几十条假报告。
11. **AS-I2 / AS-C1 / ER-I2 / ER-I3 / AS-I3 / AS-I4 / AS-I5 / AS-I6 / MD-I2 /
    RE-I5 / RE-I8 / TX-I1（措辞、双报与两处身份分叉）** —— 一批文案与去重：
    两种超时统一身份或写明为什么不统一；`trySend` 的关闭路径与文档对齐；
    Error 契约成员的方法形态改用字段那句；裸 `try` 只报一条；`@main` 的 `using`
    只报一条且不叫作者去声明不存在的函数；具名类型的字段拼错补「did you mean」；
    常驻命名空间的未知成员点名命名空间；表达式位的 `detach` 说「只在语句位」；
    导出名拼错补最近名；`any` 的两句话统一；`??` 右臂并入字面量指引的位置表；
    `"ab" * 3` 补一句 `.repeat(3)`。
12. **成文（AS-U1/U2/U3 · ER-U1/U2 · MD-U1/U2/U3 · TX-U1/U2/U3 · RE-C1 · TX-C1）**
    —— 十三条写进宪章或标准库文档：`@main` 是不是 owning scope；运行时诊断报行列
    而不是字节偏移；`Promise.` 为什么没有 `resolve`/`allSettled`；
    `finally` 与 `using` 的先后；`IndexError` 点不点名下标；独立模式 Core 文件的
    目标；`velar/test` 的真实规则；同名双导入；布局字符串的缩进关系；
    结构对象类型没有源码拼写（连带：`zip` 的结果无法注解）；字面量实参只在运行时查；
    `any` 的两处措辞；Core 没有行宽这件事。
13. **表面摘要的覆盖面（所有者裁决项 c 的延伸）** —— 最低优先，但值得单独裁：
    `string`/`number` 的检查值方法是宪章 §7 的规范表，今天不进 Core 摘要，
    改它一个签名门不会红。内建类型名名册、退役拼写表与 A 名册同理。

---

## 本文的出身

本文由 P6 审计代理在编排代理的 D115 §五 P6 排期下产出，工作树
`/private/tmp/velar-d114/audit-p6a`（分支 `audit/p6-audit-p6a`，HEAD `206136a`
= main at 0.29.0）。只读仓库、只写本账本；未派实施代理，未运行任何构建或测试
脚本，未执行任何 git 写操作。唯一运行过的仓库脚本是只读的
`scripts/check-surface-versions.mjs`（以及一段一次性的 `surfaceInventory()`
查询脚本，写在会话草稿目录里）。探针文件在
`/private/tmp/velar-d114/scratch-p6a/{as,er,md,tx,re}/`，不入仓。
