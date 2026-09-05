# 完整性审计 —— 0.29.0 Node / Server 面（2026-09-06，约 210 个探针）

审计对象：0.29.0（`206136a`）的 `node@0.16` 与 `server@0.15` 两个面 ——
`velar/serve`、Node `velar/http`、`velar/process`、`velar/host`、`velar/terminal`、
`velar/fs`、`velar/path`、`velar/hash`、`velar/env`、`velar/validation`，以及
`@velarscript/server` 的配置 / 认证 / 数据库生命周期。方法学沿用
[[COMPLETENESS-AUDITS]] 审计一与 [[COMPLETENESS-AUDIT-0.28.0-2026-09-05]]：对每个
特性面做 **文档承诺 vs 运行时行为 vs 作者合理预期** 的逐条对照，目标是消灭未定义
而不是找 bug；DECIDED-AND-CORRECT 必须记录，否则「完整」无法凭失败清单成立。

探针在隔离 worktree `/private/tmp/velar-d114/audit-p6b`（分支
`audit/p6-audit-p6b`，HEAD `206136a`）的已构建 `dist` 上实测。Core 侧用
`node packages/cli/dist/cli.js run <file>`（独立模式，无 velar.json）；Node 侧用
带 `surfaces: {core: "0.7", node: "0.16"}` 钉版的草稿工程；Server 侧用
`surfaces: {core: "0.7", server: "0.15"}` 与 `server.configuration`。HTTP 行为一律
用两个宿主脚本实测：`client.mjs`（`node:http`，可控方法/头/体）与 `raw.mjs`
（裸 socket，可发出 Node 客户端本身会拒绝的报文）。服务器一律 `port=0` 或固定
临时端口并在探针结束时 `kill`。输出逐字引用。探针文件在
`/private/tmp/velar-d114/scratch-p6c/`，不入仓。

分类：**DEFECT**（编译通过后崩溃/静默错误，或工具产出坏结果）· **CHARTER-DRIFT**
（文档与实现不符）· **INCONSISTENT**（两条相关规则互相矛盾；含：同一个错误报两次、
一个意思两种拼写、消息给出的改法编译器又拒绝、Core 规则与 Node 模块对同一个值不
同意）· **UNDEFINED**（文档沉默、行为偶然 —— 下列实测行为即应成文的答案）·
**DECIDED-AND-CORRECT**（探过且正确 —— 完整性凭证）。

审计面与前缀：**SV** `velar/serve` 与 Node `velar/http` · **PR** `velar/process` /
`velar/host` / `velar/terminal` · **FS** `velar/fs` / `velar/path` / `velar/hash` /
`velar/validation` · **EN** `velar/env` · **SR** `@velarscript/server` 扩展。

> **已知在飞，不重开**：`velar/process` 停止路径在 macOS 上对已退出子进程抛
> `kill EPERM` —— 另一个 worktree 正在修。本轮未复现该形态，也不计入。

---

## DEFECT —— 6 条

### SV-D1 —— 加响应头的中间件把 `application/problem+json` 静默改成 `application/json`

`__velarServeResponseCopy`（`packages/node/src/serve-runtime.ts:1009`）在复制响应
外壳时，**`text` 分支保留 `contentType`，`json` 分支丢掉它**：

```js
if (__velarServeOwnDescriptor(value, "json")) output.json = value.json;
else if (__velarServeOwnDescriptor(value, "text")) { output.text = value.text; if (value.contentType != null) output.contentType = value.contentType; }
```

框架自己的问题文档正是「json 本体 + `application/problem+json` contentType」，
所以每一个经过「加响应头」的中间件、或带 `background` 任务的响应复制，问题文档的
媒体类型都会退回 `application/json`。

最小探针 `main.vel`（Node 工程）：

```velar
import {HttpProblem, middleware, run, serve, text, use} from "velar/serve"

export server inner:
    @get ok(p"/ok") => {ok: true}
    @get prob(p"/prob"):
        throw HttpProblem({status: 409, code: "a.conflict", title: "Conflict"})

const plain = inner
const wrapped = use(inner, [middleware.requestId()])
```

裸 app 的 405：

```text
--- bare POST /ok
status 405
headers {"allow":"GET, HEAD, OPTIONS","content-type":"application/problem+json; charset=utf-8", …}
```

同一个 405，只多了一个 `middleware.requestId()`：

```text
--- mw POST /ok
status 405
headers {"allow":"GET, HEAD, OPTIONS","x-request-id":"velar-1788637288220-3","content-type":"application/json; charset=utf-8", …,"content-length":"152"}
```

`middleware.securityHeaders()` 同款：

```text
--- POST /ok 405
status 405
headers {"allow":"GET, HEAD, OPTIONS","x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer","cross-origin-resource-policy":"same-origin","content-type":"application/json; charset=utf-8", …}
```

第二个触发点是 `background`：`middleware.timeout(500)` 的 504 出口带
`[continuation]` 后台任务，于是同样走 `__velarServeResponseCopy`：

```text
--- timeout hang
status 504
headers {"content-type":"application/json; charset=utf-8", …}
body "{\"type\":\"about:blank\",\"title\":\"Request timed out\",\"status\":504,\"code\":\"request.timeout\",\"instance\":\"/hang\"}"
```

对照：同一个 app 上 `text("hello", contentType="text/csv; charset=utf-8")` 经
`securityHeaders` 后 `content-type: text/csv; charset=utf-8` 完好 —— 断层只在 json 侧。

测的是哪句话：`docs/standard-library.md` §`velar/serve`「`HttpProblem(options)`
exits a route with a checked 4xx/5xx problem; the default encoder uses
`application/problem+json`」，以及 `docs/ai-skill-node.md`「The framework renders
unhandled problems as `application/problem+json` …」。而
`openapi(app, …)` 自己发布的正是这个媒体类型（见 SV-I1 的实测），所以文档、
OpenAPI 与线上响应三者在装了中间件之后不一致。DEFECT：编译通过，线上媒体类型
静默变了，没有任何诊断。

### SV-D2 —— `HttpProblem.code` 恒等于字符串 `"HttpProblem"`，而文档与 tour 都读它

`HttpProblem` 的公开契约声明了 `code: string` 字段
（`packages/node/src/compiler.ts:146` 的 `httpProblemClass.fields`），运行时构造器
也确实把语义码写了进去（`serve-runtime.ts` 里
`["code", fields.code]` 经 `Object.defineProperty` 定义）。但源码里的
`.code` 读被降级到 Error 契约的 code 访问器。

最小探针：

```velar
import {HttpProblem} from "velar/serve"

@main:
    const p = HttpProblem({status: 409, code: "x.conflict", title: "Conflict", detail: "d", instance: "/i", source: "body", parameter: "title"})
    const dash = "-"
    print(f"code={p.code}")
    print(f"status={p.status} title={p.title} type={p.type}")
    print(f"detail={p.detail ?? dash} instance={p.instance ?? dash} source={p.source ?? dash} parameter={p.parameter ?? dash}")
    print(f"message={p.message} name={p.name}")
```

```text
code=HttpProblem
status=409 title=Conflict type=about:blank
detail=d instance=/i source=body parameter=title
message=d name=HttpProblem
```

`velar build --mode readable` 的发射逐字说明了机制：

```js
const p = new HttpProblem({ status: 409, code: "x.conflict", title: "Conflict", detail: "d", instance: "/i", source: "body", parameter: "title" });
console.log(`code=${__velarErrorCode(p)}`);
```

八个声明字段里只有 `code` 被劫持。后果落在文档教的那一句上 ——
`docs/ai-skill-node.md`「The final application may declare one response policy」
的范例与 `examples/tour/node/01-server.vel` 都写
`return json({ok: false, error: outcome.problem.code}, …)`。实测（Node 工程，
`@response` 策略照抄该范例）：

```text
--- /nope (notFound)
"HTTP/1.1 404 Not Found\r\n… {\"ok\":false,\"code\":\"HttpProblem\"}"
--- /prob (HttpProblem)
"HTTP/1.1 409 Conflict\r\n… {\"ok\":false,\"code\":\"HttpProblem\"}"
--- POST /ok (405)
"HTTP/1.1 405 Method Not Allowed\r\n… {\"ok\":false,\"code\":\"HttpProblem\"}"
--- 415
"HTTP/1.1 415 Unsupported Media Type\r\n… {\"ok\":false,\"code\":\"HttpProblem\"}"
```

同一次请求里，框架自己写的问题文档 `code` 是对的
（`"code":"route.not_found"` / `"route.method_not_allowed"` /
`"request.unsupported.media.type"`），策略读到的 `code` 是常量。一个概念两个定义。
DEFECT：编译通过、零诊断、线上载荷静默错误，且错的正是官方 skill 与 tour 的拼写。
它的宪章一侧见 SV-C1。

### SV-D3 —— 每一条文本读路径都静默删掉开头的 U+FEFF

`velar/http` 的 `text()/json()/parse()`、`velar/serve` 的
`request.text()/json()/parse()`、以及 `velar/fs.readText` 全部把首字节序标记
无声吃掉。`bytes()` 不吃。

最小探针（同一进程内起服务并自己请求）：

```velar
import {Request, run, serve, text} from "velar/serve"
import {http} from "velar/http"

export server app:
    @get t(p"/t") => text("\u{FEFF}hello")
    @post e(p"/e", request: Request):
        const body = await request.text()
        return {size: body.size}

@main:
    const server = await serve(app, port=0)
    const base = f"http://127.0.0.1:{server.port}"
    const got = await http.get(base + "/t").text()
    const bytes = await http.get(base + "/t").bytes()
    print(f"text/plain body: text size={got.size} bytes size={bytes.size}")
```

```text
text/plain body: text size=5 bytes size=8
--- POST /e with BOM text
"HTTP/1.1 200 OK\r\n… {\"size\":5}"
```

`velar/fs` 同款（`bom.txt` 的磁盘内容是 `EF BB BF 42 4F 4D 54 45 58 54 0A`，11 字节）：

```text
read BOM file: "BOMTEXT\n"
```

后果一（完整性）：用文档教的写法算文件摘要得到的不是文件的摘要。

```text
sha256Text(readText(bom.txt)) = 3e81c5cf4934a66c0967012988e4212047027be1a72bb1257edaff475a432146
$ shasum -a 256 bom.txt
084da9a5cbcc65a5013713b630b0497f8352b0b6e91bce483d6773ca467debba
```

（`velar/hash` 自己是对的：`sha256Text("\u{FEFF}abc")` =
`1c28dc3f1f804a1ad9c9b4b4cf5e2658d16ad4ed08e3020d04a8d2865018947c`，与 Python
`hashlib.sha256('\ufeffabc'.encode())` 逐字符相同。被改的是喂给它的文本。）

后果二（Core 与 Node 对同一串字节不同意）见 SV-I2。

测的是哪句话：`docs/standard-library.md` §Node `velar/http`「All text and JSON
readers, including Web `text()` after a buffered `bytes()` read, require valid
UTF-8; malformed bytes are never repaired with replacement characters.」——
这句承诺的是「不修复」，而实测是「删掉一个合法字符」；文档没有任何一处写过
BOM 会被剥离。DEFECT：静默数据丢失，且落在校验和这类正确性最敏感的用法上。

### SV-D4 —— 路由抛出的 `HttpProblem` 绕过它自己的中间件，安全响应头因此缺席于所有错误响应

中间件链是 `finalize(await middleware(request, next))`；handler 抛出时异常从
`next()` 一路展开出中间件体，中间件的「拿到响应再加工」那一半根本不执行，错误
最后在 `__velarServeHandleAppResponse` 的外层 catch 里被单独 finalize。

探针（`use(inner, [middleware.securityHeaders()])` 与
`use(inner, [middleware.cors(origins=["https://x.example"])])` 两台）：

```text
===== securityHeaders on error =====
--- /ok
status 200
headers {"x-content-type-options":"nosniff","x-frame-options":"DENY","referrer-policy":"no-referrer","cross-origin-resource-policy":"same-origin","content-type":"application/json; charset=utf-8", …}
--- /prob
status 409
headers {"content-type":"application/problem+json; charset=utf-8","date":"…","connection":"keep-alive","keep-alive":"timeout=5, max=1000","content-length":"93"}
--- /nope 404
status 404
headers {"content-type":"application/problem+json; charset=utf-8", …}
```

```text
===== cors with Origin =====
--- /ok with Origin
headers {"access-control-allow-origin":"https://x.example","access-control-allow-methods":"GET, POST, PUT, PATCH, DELETE, OPTIONS", …,"vary":"Origin", …}
--- /prob with Origin
headers {"content-type":"application/problem+json; charset=utf-8", …}
--- /boomless 404 with Origin
headers {"content-type":"application/problem+json; charset=utf-8", …}
```

即：成功响应带 `nosniff` / `access-control-allow-origin`，**同一路由的 409 与 500
一个都不带**。浏览器侧的实际后果是错误响应被 CORS 拦成不可读 —— 文档承诺的
「framework renders unhandled problems as `application/problem+json` … 并做
`Accept` 协商」在跨源场景里作者根本拿不到。

测的是哪句话：`docs/standard-library.md`「Built-in middleware covers CORS,
trusted hosts, request IDs, access logs, security headers, compression, error
recovery, timeouts, and concurrency.」＋「`use(app, middleware)` wraps only that
app's routes after composition.」—— 「wraps that app's routes」在实测里等于
「wraps that app's routes' **successful** responses」。DEFECT：静默的安全头缺口，
零诊断。（`middleware.errors` 能兜住这条路径，但它是另一个中间件，文档没有把
「要装 errors 才有安全头」写成前置条件。）

### PR-D1 —— 一次操作系统拒绝的 spawn 永久毒化 `velar/process`

命令不存在、目标不可执行、目标是目录、只给命令名（不给绝对路径）、以及
`cwd` 指向不存在的目录 —— 五种形态全部得到同一句内部消息，并且**此后本进程内
所有 `run`/`start` 都用同一句拒绝**。

探针 `pr2.vel`：

```velar
import {run} from "velar/process"

const dash = "-"

async def report(label: string, command: string, args: List<string>):
    try:
        const r = await run(command, args)
        print(f"{label}: code={r.code ?? -999} signal={r.signal ?? dash} out={Json.stringify(r.stdout)}")
    catch failure:
        print(f"{label}: ERROR[{failure.code}] {failure.message}")

@main:
    await report("good first", "/bin/echo", ["one"])
    await report("missing executable", "/no/such/binary", [])
    await report("good after missing", "/bin/echo", ["two"])
    await report("good again", "/bin/echo", ["three"])
```

```text
good first: code=0 signal=- out="one\n"
missing executable: ERROR[Error] Node process worker returned an invalid owned handle
good after missing: ERROR[Error] Node process worker returned an invalid owned handle
good again: ERROR[Error] Node process worker returned an invalid owned handle
```

同一句消息覆盖的五种形态（`pr1.vel`，注意其中 `stderr only` 本身是完全合法的
命令，它之所以失败只是因为排在 `missing executable` 之后）：

```text
missing executable: ERROR[Error] Node process worker returned an invalid owned handle
non-executable file: ERROR[Error] Node process worker returned an invalid owned handle
directory as executable: ERROR[Error] Node process worker returned an invalid owned handle
relative name without path: ERROR[Error] Node process worker returned an invalid owned handle
stderr only: ERROR[Error] Node process worker returned an invalid owned handle
```

机制：macOS 上 `spawn` 一个不存在的可执行文件返回 `child.pid === undefined`，
worker 于是 `pid: 0` 地发出 `{kind:"owned", …}`；应用侧的握手校验
（`packages/node/src/compiler.ts:1036`）要求 `pid >= 1`，不满足就抛

```js
throw new __velarProcessNativeTypeError("Node process worker returned an invalid owned handle");
```

而这一抛发生在 MessagePort 消息处理器里，被记成「第一次宿主失败」并永久保留。

放大形态（Node 服务器）：一个请求点名了不存在的程序，此后**整台服务器**的进程
能力报废。

```velar
export server app:
    @get proc(p"/proc"):
        const r = await runProcess("/bin/echo", ["from a handler"])
        return {code: r.code ?? -1, out: r.stdout}
    @get badproc(p"/badproc"):
        const r = await runProcess("/no/such/binary", [])
        return {code: r.code ?? -1}
```

```text
--- /proc
"HTTP/1.1 200 OK\r\n… {\"code\":0,\"out\":\"from a handler\\n\"}"
--- /badproc
"HTTP/1.1 500 Internal Server Error\r\n… \"code\":\"server.internal\",\"instance\":\"/badproc\"…"
--- /proc after badproc
"HTTP/1.1 500 Internal Server Error\r\n… \"code\":\"server.internal\",\"instance\":\"/proc\"…"
--- server log ---
Unhandled server request failed: Node process worker returned an invalid owned handle
Unhandled server request failed: Node process worker returned an invalid owned handle
```

测的是哪句话：`docs/standard-library.md` §`velar/process`「The proxy records the
first host failure permanently, rejects both pending and later calls with that
same failure」—— 这句写的是 **Worker 的内部失败**；「要跑的程序不存在」是最普通不过
的应用级失败（打错名字、工具没装、用户提供的命令），它被归到了同一格。同节还写
「These Workers are not restarted inside the current application process …
Restarting the application is the explicit authority and identity reset.」——
于是唯一的恢复手段是重启进程。DEFECT，且消息既不点名失败的可执行文件，也不点名
`ENOENT`/`EACCES`，作者拿到的是实现细节。

### PR-D2 —— 同一失败会作为不可捕获的 `TypeError` 逃出 MessagePort 处理器并终止应用

上一条的抛出点在 `__velarNodeProcessPort.onmessage` 里。在有若干次先行 `await`
的程序里，它会在 `catch` 已经吃过一次之后**再逃逸一次**，把整个应用打死。

探针 `pr4.vel`（stdin / env / cwd 一串 `run`，第五个是 `cwd: "/no/such/dir"`，
每一个都写在 `try:` / `catch failure:` 里）。连跑两次，逐次相同：

```text
bad cwd: ERROR[Error] Node process worker returned an invalid owned handle
velar run: uncaught error while running /…/scratch-p6c/cli/pr4.vel
TypeError: Node process worker returned an invalid owned handle
    at __velarNodeProcessMessage (file:///…/node_modules/velar/process.js:513:13)
    at __velarNodeProcessPort.onmessage (file:///…/node_modules/velar/process.js:566:5)
  (3 Node.js internal frames hidden; rerun with 'velar run --stack' for the full trace)
```

```text
pr4 run1 EXIT=1
pr4 run2 EXIT=1
```

`catch` 那一行先打印了错误（说明 Promise 侧确实被拒绝并被捕获），随后同一个失败
从消息处理器再抛一次、无人可捕，`@main` 后续语句全部不执行。DEFECT：`try/catch`
的承诺在这条路径上不成立。

### FS-D1 —— 见 SV-D3

`velar/fs.readText` 的 BOM 静默删除与 `velar/serve`/`velar/http` 是同一个缺陷，
统一记在 SV-D3，不重复立项。

---

## INCONSISTENT —— 8 条

### SV-I1 —— 框架错误响应有两种线上形态，而 OpenAPI 只发布其中一种

路由级问题是 `application/problem+json` 的问题文档；路由之前与传输层的拒绝是
`text/plain` 的一句话。

```text
--- content-length 2147483648 (2GiB) declared
"HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n…\r\n\r\nRequest body too large"
--- body over bodyLimit 64
"HTTP/1.1 413 Payload Too Large\r\nContent-Type: application/problem+json; charset=utf-8\r\n…\r\n\r\n{\"type\":\"about:blank\",\"title\":\"Request input is too large\",\"status\":413,\"code\":\"request.request.too.large\",\"instance\":\"/make\"}"
```

同族还有：路径含 `..` / `%2F` / `%00` / 坏百分号 / 非法 UTF-8 一律
`"HTTP/1.1 400 Bad Request\r\n…\r\n\r\nBad request"`；`staticFiles` 的 404 与 416 是
`Not found` / `Range not satisfiable`；**流生产者在第一次 `write` 之前抛出**也是
`text/plain`：

```text
--- producer throws before first write
"HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/plain; charset=utf-8\r\n…\r\n\r\nInternal server error"
```

而同一台服务器上 handler 直接抛出得到的是问题文档：

```text
--- /boom
status 500
headers {"content-type":"application/problem+json; charset=utf-8", …}
body "{\"type\":\"about:blank\",\"title\":\"Internal server error\",\"status\":500,\"code\":\"server.internal\",\"instance\":\"/boom\"}"
```

`openapi()` 发布的是问题文档那一种，且明确把 413 列进去：

```text
/a post -> ['200', '400', '413', '415', '422']
    400 ['application/problem+json'] Malformed request input
    413 ['application/problem+json'] Request body or upload is too large
    415 ['application/problem+json'] Unsupported request content type
    422 ['application/problem+json'] Request validation failed
```

测的是哪句话：`docs/standard-library.md`「It also documents the
framework-generated 400, 401, 413, 415, and 422 responses that apply to each
route」。声明的 `Content-Length` 超过应用预算走的正是那个 413，客户端拿到的却是
`text/plain`。一个意思两种拼写，而契约文档只承认一种。

### SV-I2 —— Core `Json.parse` 拒绝的字节，Node 传输接受

```velar
type A:
    a: number

@main:
    const withBom = "\u{FEFF}{\"a\":1}"
    try:
        const parsed = Json.parse(withBom, A)
        print(f"Core Json.parse accepted BOM: a={parsed.a}")
    catch failure:
        print(f"Core Json.parse rejected BOM: {failure.message}")
```

```text
Core Json.parse rejected BOM: Unexpected token '﻿', "﻿{"a":1}" is not valid JSON
Core Json.parse plain ok: a=1
```

同样的 10 个字节走 Node 传输：

```text
response.text() size=7 startsWithBom=false
response.json() = {"a":1}
response.parse(A).a = 1
--- POST /body with BOM json
"HTTP/1.1 200 OK\r\n… {\"got\":1}"
```

测的是哪句话：`docs/standard-library.md` §`velar/serve`「`json()` then applies
the same finite, bounded, accessor-free JSON contract as `velar/json` and every
`velar/http` target」。「same contract」在同一串字节上给出两个判决 —— 这正是分类
里点名的「Core 规则与 Node 模块对同一个值不同意」。成因是 SV-D3。

### SV-I3 —— 客户端挂断被当作「handler 失败」写进同一条 stderr 通道

探针：三次连接，发出请求后 100 ms 断开；handler 本身正常返回 `{ok: true}`。

```text
client 0 hung up mid-request
client 1 hung up mid-request
client 2 hung up mid-request
--- server log ---
Unhandled server request failed: Node serve client connection is closed
Unhandled server request failed: Node serve client connection is closed
Unhandled server request failed: Node serve client connection is closed
```

放弃一个流也各写一行，并且额外多一行框架自己的簿记：

```text
producer saw failure at 1: Node serve client connection is closed
producer finally at index 1
Unhandled server request failed: Node serve request is unknown or already completed
```

测的是哪句话：`docs/standard-library.md`「Handler failures are reported to
stderr and return an opaque `500 Internal server error`」。这里 handler 没有失败、
也没有 500 可返回；用户按了停止键与代码里有 bug 用同一句话、同一条通道上报，
运维无法区分。

### SV-I4 —— GET 与 `@websocket` 同路径：编译沉默、装配接受、`openapi()` 拒绝

```velar
export server clash:
    @get same(p"/w") => {ok: true}
    @websocket dup(p"/w", connection: WebSocketConnection):
        async for message in connection:
            await connection.send(message)
```

```text
Checked 1 module from /…/nodechk/ws1.vel
```

运行时：

```text
openapi: ERROR[Error] OpenAPI cannot describe both GET and WebSocket operations at '/w'
listen: ERROR[Error] listen path is unavailable when the ServeApp declares @websocket routes
listen without legacy path; port=55049
```

即：不生成文档就能起服务。测的是哪句话：`docs/standard-library.md`「Declarative
WebSocket routes appear in the same `paths` table as GET upgrades … an HTTP GET
and WebSocket upgrade cannot share one documented path.」＋
`docs/ai-skill-node.md`「Overlapping routes are refused by two referees … the
runtime judges it there: an overlapping table refuses to build」。第三个裁判
（OpenAPI）拒绝，前两个放行。

### SV-I5 —— Node skill 里的路由输入范例不是语言自己的规范格式

`docs/ai-skill-node.md`「Use ordinary values for the cases that need more than
inference」那段代码块原样落盘后：

```text
/…/nodechk/fmt2.vel is not formatted
1 of 1 VelarScript source file require formatting
```

```diff
-    inputs={token: security.bearer()},
-    resolve=async values => {id: values.token},
+    inputs = {token: security.bearer()},
+    resolve = async values => {id: values.token},
-        user=input.dependency(currentUser),
-        tenant=input.header("x-tenant"),
-        session=input.cookie("session", default=null),
+        user = input.dependency(currentUser),
+        tenant = input.header("x-tenant"),
+        session = input.cookie("session", default=null),
```

根因不在 Node：具名实参的规范拼写取决于调用是否换行。Core 对照探针：

```velar
const oneLine = named(alpha=1, beta=2)
const multi = named(
    alpha=1,
    beta=2,
)
```

`velar format` 之后：

```velar
const oneLine = named(alpha=1, beta=2)
const multi = named(
    alpha = 1,
    beta = 2,
)
```

一个意思两种拼写，而两种都是格式化器自己产出的。`examples/tour/node/01-server.vel`
用的是带空格那种，`docs/ai-skill-node.md` 用的是不带空格那种 —— 与 0.28.0 的
I-C2 同族（宪章/文档代码块只过编译门、不过格式门）。

### SV-I6 —— `velar check` 不检查清单声明的 Server 配置文件是否存在，`velar build` 检查

```text
=== check with nonexistent declared config ===
Checked 1 module from /…/scratch-p6c/server
=== build with nonexistent declared config ===
velar build: Configured Server configuration '/…/scratch-p6c/server/config/app.yml' does not exist
```

测的是哪句话：`docs/ai-skill-server.md`「A missing declared file fails closed.」，
以及 `docs/cli.md`「A rule about how the *project* is arranged … is enforced
where the project is resolved rather than where a module is compiled, and both
commands now read it from one place, so `fix` can no longer report "0
diagnostics remain" over a tree `check` refuses.」——「配置文件必须存在」正是一条
工程编排规则，`check` 说干净、`build` 拒绝。

### SR-I1 —— `serve(app, port=0)` 是文档教的写法，`application()` 拒绝 `server.port: 0`

`application.yml`：

```yaml
server:
  host: 127.0.0.1
  port: 0
```

```text
config path = application.yml
settings = {"server":{"host":"127.0.0.1","port":0},"database":{"path":"./db.sqlite","busyTimeoutMilliseconds":5000}}
velar run: uncaught error while running /…/server/main.vel
RangeError: application server.port must be an integer from 1 through 65535
    at __velarServerOptions (file:///…/node_modules/velar/server.js:373:11)
    at application (file:///…/node_modules/velar/server.js:391:19)
```

而同一版本的 Node 面上 `serve(app, port=0)` 正常，`Server.port` 返回实际端口：

```text
first port=64025
AddressInUseError: listen EADDRINUSE: address already in use 127.0.0.1:64025
```

测的是哪句话：`docs/standard-library.md`「`serve` reports a port already bound as
`AddressInUseError` (bind another port, or `0` for any free one)」＋
`docs/ai-skill-server.md`「Use direct `serve(app, port=0)` in tests or embedded
low-level adapters.」；Server 侧的配置节文档只写「All three fields are optional.
Their defaults are `127.0.0.1`, `3000`, and 16 MiB.」，1–65535 这个界一处未写。
同一发布里两个官方面对同一个值不同意，且收紧的一侧没有成文。

### FS-I1 —— 一个 `issues` 列表里有两套 path 约定

```text
safeParse missing field: {"success":false,"value":null,"issues":[{"path":["Options.port"],"message":"field 'port' is missing"}]}
safeParse semantic: {"success":false,"value":null,"issues":[{"path":["host"],"message":"must not be blank or exceed 8 code units"}]}
safeParse wrong type: {"success":false,"value":null,"issues":[{"path":["Options.port"],"message":"field 'port' does not match number"}]}
```

结构层（`Type.parse`）把类型名塞进**同一个** path 段（`"Options.port"`），语义层
（规则）用裸字段名（`"port"`）。渲染 `issue.path` 的消费者对同一个字段会得到
`Options.port` 和 `port` 两种结果。抛出面同款两种句式：

```text
validate: ERROR[ValidationError] value.host: must not be blank or exceed 8 code units
parse wrong type: ERROR[ValidationError] Value does not match Options — field 'port' does not match number
```

测的是哪句话：`docs/standard-library.md` §`velar/validation`「`field`, `each`,
`optional`, and `all` compose rules while preserving field and List-index
paths.」＋「`safeParse` performs the same work … it returns `{success, value,
issues}`」—— 一个 `issues` 契约，两套路径拼写。

---

## CHARTER-DRIFT —— 2 条

### SV-C1 —— `HttpProblem` 公开声明了一个宪章禁止 Error 子类声明的成员名

宪章 §11「Discrimination is the class; `code` is its string form」：

> Class identity cannot cross a JSON or log boundary, so every checked `Error`
> also carries a readonly `code: string` beside `message` and `cause`. Its value
> is the instance's declared class name … `name`, `code`, `message`, `stack`,
> and `cause` are the Error contract's own members. An `Error` subclass cannot
> redeclare any of them in any form.

`HttpProblem` 的 `base` 是 `"Error"`（`packages/node/src/compiler.ts:146` 起），
而它的 `fields` 里明写 `["code", { mutable: false, type: stringType }]`，构造器
选项里也明写 `code: stringType`。宪章说不能重声明，Node 面的公开契约重声明了，
降级又按宪章执行 —— 于是字段存在、类型正确、值永远是类名（SV-D2）。这三方
（宪章条文、Node 契约、发射）没有一处能同时为真。文档一侧同时受影响：
`docs/standard-library.md`「`HttpProblem(options)` exits a route with a checked
4xx/5xx problem」与 `docs/ai-skill-node.md`「stable `code` fields」都把
`code` 当作可读回的语义值。

### SV-C2 —— Web 侧对 Node 模块的拒绝没有「平台化指引」，也没有码与位置

```text
/…/web/main.vel: velar/fs is a local runtime module and cannot run in a web application

/…/web/main.vel: velar/serve is a local runtime module; web applications use the dev server and velar/http

/…/web/main.vel: velar/process is a local runtime module and cannot run in a web application

/…/web/main.vel: velar/env is a local runtime module and cannot run in a web application

/…/web/main.vel: velar/terminal is a local runtime module and cannot run in a web application

/…/web/main.vel: velar/host is a local runtime module and cannot run in a web application

/…/web/main.vel: velar/path is a local runtime module and cannot run in a web application
```

测的是哪句话：`docs/standard-library.md` §Contract「Local platform modules
(`velar/serve`, `velar/fs`, `velar/env`, `velar/host`, `velar/terminal`,
`velar/path`, `velar/process`) are compile-time rejected for Web targets **with
platform-specific guidance**.」—— 七个模块里只有 `velar/serve` 给了去处
（dev server 与 `velar/http`）；其余六个只说「不能在 web 应用里跑」。
`velar/path` 尤其刺眼：它是纯词法计算，Web 侧确有 `velar/url`，但消息不提。

附带（同一形状，另一处）：从 `velar/serve` 导入 Core 名时一个拼写两条诊断，
其中一条同样无码无位置：

```text
/…/node/main.vel: Module 'velar/serve' has no export named 'AddressInUseError'

/…/node/main.vel: Module 'velar/serve' has no export named 'PermissionError'

/…/node/main.vel:1:9 error VEL3007: 'AddressInUseError' is a reserved Core binding
import {AddressInUseError, PermissionError} from "velar/serve"
        ^^^^^^^^^^^^^^^^^
```

与 0.28.0 的 D-I1（`range` 双报）同族；VEL3007 也没有像退役模块那句一样补上
「这些名字无需导入」的改法。

---

## UNDEFINED —— 14 条（文档沉默处；下列实测行为即应成文的答案）

| ID | 未定之处 | 实测行为 |
|---|---|---|
| **SV-U1** | `stream(...)` 响应的媒体类型 | **完全不发 `content-type`**：`headers {"date":"…","connection":"keep-alive","keep-alive":"timeout=5, max=1000","transfer-encoding":"chunked"}`。文档只写 `{status, stream, headers?}` 与 `stream(producer, status=200, headers=null)`，没有默认类型也没有说没有默认类型；作者不显式给 header 时浏览器只能嗅探 |
| **SV-U2** | `file(path, root)` / `staticFiles(path, root)` 的 `root` 相对于什么 | **进程工作目录**。同一份工程，从仓库根启动时 `/assets/a.txt` 全部 404；`cd` 到工程目录后同一请求 200。文档只写「resolves the real root and target」 |
| **SV-U3** | 路由返回 `null` | 200 + `content-type: application/json` + 响应体 `null`（`content-length: 4`）。`noContent()` 才是 204。文档说「Ordinary Data becomes a negotiated 200 response」，没说 `null` 算不算 Data |
| **SV-U4** | 请求路径以空段结尾（`/n/` 对 `/n/{id:number}`） | 匹配到该路由，捕获为空串，按 422 `request.invalid.request` 拒绝（`"instance":"/n/"`）。文档只列了「Invalid percent-encoded UTF-8, encoded path separators, NULs, and dot segments are rejected before routing」，空段不在其中；作者更可能预期 404 |
| **SV-U5** | 未匹配路径是否经过中间件 | **不经过**（无 `@notFound` 时）：装了 `middleware.requestId()` 的 app 上 `/nope` 的 404 没有 `x-request-id`。文档说 `@notFound`「participates in application middleware and lifecycle handling」，但没说没有 `@notFound` 时那条 404 从哪里出来 |
| **SV-U6** | 流生产者写出首块之后再失败 | 服务器立刻 `FIN`，chunked 体没有终止块：`"HTTP/1.1 200 OK\r\n…Transfer-Encoding: chunked\r\n\r\n6\r\nfirst\n\r\n"`，`server sent FIN after 5ms`。这是正确且可检测的做法，但文档没写 |
| **PR-U1** | `velar/process` 的 `timeout: 0` | **不设超时**：`start("/bin/sh", ["-c","sleep 1; echo late"], {timeout: 0})` 正常返回 `out="late\n"`。`0` 作为「显式无超时」只在 `velar/http` 那节成文（"reserves `0` as the explicit no-timeout mode"），`velar/process` 一侧没写 |
| **PR-U2** | `terminal.close()` 之后还能不能输出 | 不能：`write after close: ERROR[Error] Terminal is closed` / `writeError after close: ERROR[Error] Terminal is closed`，而 `readLine` 按文档返回 `null`、`args()`/`isInteractive()` 照常。文档只写「a later `readLine()` returns `null` instead of opening stdin again」，读侧成文、写侧没有 —— 一个提示完就关掉 stdin 的 CLI 会从此打不出字 |
| **PR-U3** | 第二个信号强退的退出码 | `1`。文档写「Successful shutdown exits with conventional status 130 or 143 … A second signal force-quits immediately」，没写强退用哪个码；实测 `second-signal EXIT=1`，与「清理失败」同码，运维无法区分 |
| **PR-U4** | `velar run` 隐藏的「internal frames」指谁 | 只指 Node 内建帧。编译产物自己的帧照常出现：`at __velarNodeProcessMessage (file:///….velar/run-…/node_modules/velar/process.js:513:13)`、`at __velarServeRunStartup (…/velar/serve.js:3192:28)`、`at __velarTerminalInvoke (…/velar/terminal.js:273:12)`。`docs/cli.md` 只写「`--stack` keeps the full trace instead of hiding internal frames」 |
| **PR-U5** | `velar/host` 有没有可读的「主机值」 | 没有。整个模块只有 `exit(code=0)` 与 `onShutdown(cleanup)` 两个导出（`packages/node/src/compiler.ts` 的 `["velar/host", moduleInterface(...)]`）。平台名、CPU 数、主机名一概不在 Standard API 内 —— 这一点文档从正面说过（§Deliberately omissions 的精神），但没有一句直说 |
| **FS-U1** | Node `FileWatcher` 有没有像 Web `watch` 那样的自失效护栏 | **没有**。在 `next()` 循环体内向被观察目录写文件，12 轮全部照常触发（`round 1..12: paths=1 rescan=false`），没有任何上限或报告。Web 侧同形态在 100 轮被停并点名。文档只从「A watcher is for changes another actor makes」的角度劝阻，没有机制 |
| **FS-U2** | `makeDirectory` 对已存在目录 | 静默成功（幂等）。文档只写「Creates the requested directory and missing parents」；对已存在的**文件**则是 `FileExistsError` |
| **FS-U3** | `field(name, select, rule)` 的 name 与 select 不一致时 | 报告用 `name`，检查用 `select`：`field("port", (v: Options) => v.host, nonBlank())` 在 `{host: "", port: 1}` 上给出 `[{"path":["port"],"message":"must not be blank"}]` —— 路径指向的字段不是失败的字段。编译期无法关联两者，文档也没有把「name 是标签、不是选择器」写明 |
| **EN-U1** | `require` 与「空值」；`.env` | 「存在但为空」不是「缺失」：`require PROBE_EMPTY = ""`，只有缺失才抛（`VelarScript environment variable 'PROBE_ABSENT' is required`）。`.env` 不加载（工程根有 `.env` 时 `get DOTENV_ONLY = null`），也没有任何带类型的读法 —— 三点都符合模块的最小主义，但都没成文 |
| **SR-U2** | `listen({… path: …})` 与 `@websocket` 路由并用 | 编译期沉默，运行时拒绝：`listen: ERROR[Error] listen path is unavailable when the ServeApp declares @websocket routes`。文档把它写成声明式模式的属性（"does not accept the listener's legacy single `path` option"），读起来像编译期规则 |

---

## DECIDED-AND-CORRECT —— 完整性凭证（压缩记录）

### SV —— `velar/serve` 路由与响应（约 62 个探针）

**声明形态 10 项**：`@get`/`@post`/`@put`/`@patch`/`@delete` 五个角色 · 静态路径 ·
`{id:number}` 路径捕获 · `?{tag:string?}` 查询捕获 · 具名操作身份 ·
`p"/files/*"` 通配被拒 —— `VEL6005: Source route patterns cannot use a wildcard;
use staticFiles for a bounded static subtree`。同形冲突在编译期被拒且点名两侧：
`VEL4001: Route 'GET /articles/{slug:string}' conflicts with
'GET /articles/{id:number}'; parameter names do not make two route shapes
distinct`；字面段与捕获段（`/articles/list` vs `/articles/{id:string}`）不冲突。

**响应形态 16 项**：记录 → `{"ok":true}` + `application/json` · 字符串 →
`text/plain` · 数字 `42` · List `[1,2,3]` · `created({id:1})` → 201 ·
`respond(v, status=202, headers=…)` → 202 且自定义头在位 · `json(v, status=201)` ·
`redirect("/rec")` → 302 + `location` + 空体 · `noContent()` → 204 且无
`content-length` · `text(...)` · handler 抛出 → 500 问题文档 + stderr 一行 ·
未匹配 → 404 `route.not_found` 且 `"parameter":"/missing"` · `POST` 到只有 GET 的
路径 → 405 + `allow: GET, HEAD, OPTIONS` · `HEAD` 复用 GET 且不写体 ·
`OPTIONS` → 204 + `Allow` · `Map` 作路由结果被编译期拒 ——
`VEL4001: Route 'GET /raw' must return Data or a response from velar/serve;
received { q: Map<string, string>, all: Map<string, List<string>> }`。

**请求体 9 项**：`application/json` · 缺 media type（接受）·
`application/vnd.x+json`（接受）· `text/plain` → 415
`request.unsupported.media.type` 且 `"detail":"Expected application/json"` ·
坏 JSON → 400 `request.invalid.json` · 空体 → 400 · 字段类型错 → 422
`request.invalid.request` 且 `"parameter":"input"` · 多余字段被丢弃、请求成功 ·
`1e400` → 400（不进 `Infinity`）· chunked 传输体正常。

**路径与查询类型 11 项**：`/n/12` → `{"id":12}` · `/n/0x10` → 422 · `/n/%2012`
（前导空格）→ 422 · `/b/true` → `{"flag":true}` · `/b/1` → 422 · 必填查询缺失 →
422 `request.missing.parameter` · 重复查询 → 422 `request.duplicate.parameter` ·
坏数字查询 → 422 · `Request.query` 取首值、`Request.queryAll` 取全部
（`{"x":"1","xs":["1","2"]}`）· `input.header` 缺失 → 422 且 `"parameter":"x-tenant"` ·
`input.cookie(default=null)` 缺失 → `null`、存在 → 值。

**传输边界 10 项**（裸 socket）：声明 2 GiB `Content-Length` → 413 + `Connection: close` ·
超 `bodyLimit(app, 64)` → 413 问题文档 · 头值折行 → `400 Bad Request` +
`Connection: close`（Node 解析器层）· 头值内嵌 CR 注入 → 同上 · 路径含 `..` ·
含 `%2F` · 含 `%00` · 含 `%zz` · 含 `%FF` —— 五者全部 400 且在路由之前 ·
chunked 请求体正常解码。

**中间件 12 项**：`middleware.timeout(500)` 对永不 resolve 的 handler → 504
`request.timeout` · `next()` 调用两次 → 不透明 500 +
`Unhandled server request failed: A middleware next function can be called only
once per request` · `requestId` / `securityHeaders` / `cors` / `compression`
在成功响应上各自的头正确 · 无 `Origin` 时 CORS 不加头 · `trustedHosts` 未装时
`Host: evil.example` 不被拒（默认策略如文档）· `bodyLimit` 收窄生效 ·
`use` 只作用于它接到的路由。

**流 5 项**：客户端中途断开 → 生产者的 `write` 以
`Node serve client connection is closed` 拒绝、`finally` 执行 · 单块 2 MB →
`ServeResponse.stream chunks cannot exceed 1 MiB` · 首块前失败 → 500 ·
首块后失败 → 立即 FIN、chunked 不终止 · 正常两块 `ab` 经 `transfer-encoding: chunked`。

**静态文件 14 项**（cwd = 工程目录）：`/assets/a.txt` 200 + `ETag` + `Last-Modified` +
`Accept-Ranges` · 子目录 · `..` → 400（路由前）· 逃逸符号链接 → 404 ·
根内符号链接 → 200 · 目录 → 404 · 缺失 → 404 · `HEAD` → 200 无体 ·
`Range: bytes=0-3` → 206 + `Content-Range: bytes 0-3/12` · 越界 Range → 416 +
`Content-Range: bytes */12` · `file()` 的 `..%2F..%2F` 参数 → 400 ·
`file()` 逃逸链接 → 404 · `file(fallback=)` → 200 且用 `index.html` 的
`text/html` · `file()` 根内链接 → 200。

**生命周期 7 项**：`serve(app, port=0)` 返回真实端口 · 同端口二次绑定 →
`AddressInUseError: listen EADDRINUSE: address already in use 127.0.0.1:64025` ·
端口 80 → `PermissionError: listen EACCES: permission denied 127.0.0.1:80` ·
`stop()` 幂等（第二次正常返回）· 停后同端口重启成功 ·
`lifecycle(startup=)` 抛出 → 进程退出码 1 · `@main` 抛出 → 退出码 1。

**`@notFound` / `@response` 7 项**：`@notFound` 收到 `Request` 并保 404 ·
`@response` 收到全部语义结果（`policy saw status=200/404/409/500/405/415`）·
策略只跑一次 · 策略透传 `outcome.status` · 405 的 `allow` 头在策略之后仍在 ·
问题的 `outcome.problem != null` 判据正确 · 传输层 413 不进策略。

**认证 4 项**：`security.bearer()` 缺凭据 → 401 + `www-authenticate: Bearer` +
`security.not.authenticated` · 凭据格式错（`Basic zzz`）→ 同一条不透明 401 ·
凭据正确 → 200 · 提供者结果按请求缓存。

**格式 3 项**：含 `server` 块、五个角色、`p"..."`、`as route`、路由输入默认值、
`...prefix`/`...staticFiles`、`@notFound`、`@response` 的文件 `velar format`
稳定且**幂等**（第二遍 `diff` 无输出），格式化后 `velar check` 结论不变；
`?details={details:bool?}` 正确报 `advisory A11: Query wire name 'details'
repeats its field name; use the shorter '{details:bool?}' contract`，
`?include-details={details:bool?}` 静默。

### SV —— Node `velar/http`（约 14 个探针）

`timeout: 100` 对 2 s 的路由 → `HttpAbortError HTTP request timed out` ·
`timeout: 0` 正常 · `timeout: -1` 与 `600001` →
`HTTP timeout must be an integer from 0 through 600000 milliseconds` ·
非 2xx → `HttpResponseError status=404 HTTP 404 for http://127.0.0.1:…/gone`
（且消息里是最终 URL）· 两跳重定向自动跟随 · 自指重定向 →
`HTTP redirect limit of 20 was exceeded` · `maxBytes: 10` 对 100 KB 响应 →
`HTTP response exceeds maxBytes` · 同一请求 `text()` 两次都成功且同值 ·
`json()` 在 `text()` 之后仍成功（共享缓存）· `cancel()` 后读体 →
`HttpAbortError HTTP request cancelled` · 三类错误各自可 `is` 判别 ·
`parse(Type)` 返回受检值。

### PR —— `velar/process`（约 20 个探针）

**参数与结果 6 项**：含空格、双引号、单引号、`$`、`*` 的实参逐字送达，无 shell
展开（`out="a b c\"d e'f g$h *\n"`）· `exit 3` → `code=3 signal=-` ·
`kill -9 $$` → `code=-999 signal=SIGKILL`（`code` 为 `null`）· `stdin` 写入并关闭
（`/bin/cat` 拿到 `"hello stdin\n"`；不给 `stdin` 时 `/bin/cat` 拿到 `""` 并正常退出）·
空命令 → `Process command must be non-empty text`。

**环境 3 项**：默认基线正好是 `HOME PATH SHELL TMPDIR USER` 五项（`/usr/bin/env`
实测），父进程其它变量不外泄；显式 `env` 叠加在基线上；`cwd: "/tmp"` 生效。

**边界 5 项**：`timeout: 300` 对 `sleep 5` → `Process timed out after 300
milliseconds` · `maxOutputBytes: 100` 对 100 KB 输出 →
`Process output exceeded maxOutputBytes` · `timeout: -1` →
`Process timeout must be an integer from 0 through 600000 milliseconds` ·
`maxOutputBytes: 0` → `Process maxOutputBytes must be an integer from 1 through
16777216` · `timeout: 0` 无超时。

**拉取协议 4 项**：`pid > 0` · `async for output in child:` 给出
enum 标记的分块（`OUT: "o1\no2\n"` / `ERR: "e1\n"` / `ERR: "e2\n"`）· 排空后
`wait()` 给出聚合（`stdout="o1\no2\n" stderr="e1\ne2\n"`）· 第二次 `wait()` 命中缓存。

**停止 4 项**：忽略 SIGTERM 的子进程 —— `stop confirmed after 2005 ms`，
`wait after stop: code=-999 signal=SIGKILL out="child up 44220\nchild ignored
SIGTERM\n"`，两秒升级到 SIGKILL 与文档逐字相符，事后 `ps` 无残留 ·
第二次 `stop()` 幂等 · 停后 `wait()` 给出终态 · 被 `using` 拥有的作用域退出时
`@dispose:` 正常运行，而未释放的子进程按文档「still owns its lifecycle until it
settles」保持进程存活（3 s `sleep` → 整程 3.226 s）。

### PR —— `velar/host` 与 `velar/terminal`（约 10 个探针）

`exit(7)` → 退出码 7 且其后语句不执行 · `exit(256)` / `exit(-1)` / `exit(1.5)` →
`exit code must be an integer from 0 through 255` 且进程继续 ·
SIGTERM 下两个 `onShutdown` 按注册顺序运行、退出码 143 ·
清理抛出 → `[velar/host] shutdown cleanup failed: cleanup failed`、后续清理仍运行、
退出码 1。

`terminal`（stdout 为管道）：`args()` 只含 `--` 之后的实参（`["a","b","c d"]`）·
`isInteractive()` 为 `false` · `write`/`writeError` 分流正确 ·
`readLine(prompt)` 返回不含换行的一行、EOF 返回 `null` ·
超过 1 MiB 的一行 → `Terminal input text exceeds its 1 MiB boundary`，
**且下一次 `readLine` 仍能正确读到 `"ok"`**（拒绝的是那个 Promise，不是流）·
`close()` 幂等、其后 `readLine()` 返回 `null`。

### FS —— `velar/fs`（约 25 个探针）

**读 8 项**：正常读 · 缺失 → `FileNotFoundError` 且 `path` 字段为失败路径 ·
目录当文件读 → 普通 `Error: readText requires a file path` · `chmod 000` →
`PermissionError` 且带 `path` · 非法 UTF-8 → `readText requires valid UTF-8 text` ·
`maxBytes=2` → `readText file exceeds maxBytes` · 路径中间是文件 →
`NotADirectoryError` · `list` 目标是文件 → `NotADirectoryError`。

**写与目录 10 项**：写进不存在的目录 → `FileNotFoundError` ·
`makeDirectory` 递归建 · 建在已存在文件上 → `FileExistsError` ·
`createText` 新建成功、重复 → `FileExistsError: createText target already exists` ·
`replaceTextIfMatches` 匹配 → `true`、不匹配 → `false`（不写）、目标缺失 →
`FileNotFoundError` · `copyFile` 无 `replace` 覆盖 → `FileExistsError`、
带 `replace=true` 成功 · `move` 覆盖 → `FileExistsError` ·
`removeFile` 对目录 → `removeFile refuses directories`、对缺失 →
`FileNotFoundError` · `appendText` 追加正确。

**原子性承诺 vs 发射 2 项**：文档只对 `createText` 与 `replaceTextIfMatches`
承诺原子性，发射与之一致 —— `createText` 走 `await writeFile(path, data, {flag:
"wx"})` 一次宿主操作；`replaceTextIfMatches` 走同目录临时文件 + `rename`
（`node-host-worker-runtime.ts:409` 与 `:417`）。`writeText`/`appendText` 是普通
`writeFile`/`appendFile`，文档也没有对它们承诺原子性。

**边界与观察 5 项**：空路径 → `readText requires a non-empty path string` ·
含 NUL → `readText path is outside the supported bounds` · `exists` 对缺失为
`false`、对无权限文件为 `true` · `info` 对缺失返回 `null` · `canonical` 对缺失
→ `FileNotFoundError`。

**`watchFiles` 4 项**：并发第二个 `next()` →
`FileWatcher.next already has an active pull` · `close()` 让挂起的拉取以 `null`
结算 · 关闭后 `next()` 返回 `null` · 第二次 `close()` 幂等。

### FS —— `velar/path`（约 19 个探针）

`join(["a","b"])="a/b"` · `join(["a","..","b"])="b"` · `join(["/x","/y"])="/x/y"` ·
`join(["a/","/b"])="a/b"` · `join([])="."` · 空段 →
`join requires a non-empty path string` · 反斜杠是普通字符（`"a\\b/c"`）·
`resolve(["/x","y"])="/x/y"` · `resolve(["/x","/y"])="/y"` · `resolve([])` = cwd ·
`normalize("a/./b/../c")="a/c"` · `normalize("../../x")` 保留 ·
`normalize("/a//b/")="/a/b/"`（保留尾斜杠）· `relative("/a/b","/a/c")="../c"` ·
`relative("/a","/a")=""` · `dirname("/a/b/")="/a"` · `basename("/")=""` ·
`basename("a/..")=".."` · `extension("a/.hidden")=""` · `extension("a.tar.gz")=".gz"` ·
`isAbsolute("C:\\x")=false` · `contains` 四格（子路径 true、`..` 逃逸 false、
自身 true、前缀相似 `/ab` false）· `toFileUrl("/a b/c")="file:///a%20b/c"` 与其逆 ·
`fromFileUrl("https://x/y")` → `fromFileUrl requires a file URL` ·
`fromFileUrl("file:///a%2Fb")` → `File URL path must not include encoded /
characters` · `fromFileUrl("file://host/a")` → `File URL host must be
"localhost" or empty on darwin` · 超 4096 的合成结果 →
`join result is outside the supported bounds`。

### FS —— `velar/hash` 与 `velar/validation`（约 21 个探针）

**hash 5 项**：`sha256Text("")`、`("abc")`、非 ASCII、带 BOM 四个摘要与
Python `hashlib` 逐字符相同；输出恒为 64 个小写十六进制字符。模块只导出
`sha256Text`（`packages/core/src/index.ts:401`）—— 没有算法名参数、没有字节入口、
没有可变 `Hash` 对象，与文档「it exposes neither an algorithm string nor a
mutable host `Hash` object」逐字相符，所以「未知算法名」在这个 API 上不可拼写。

**validation 16 项**：`integer(minimum=,maximum=)` 对越界、小数、`NaN` 各报一条 ·
`nonBlank(maximum=)` 对空串与超长各报一条 · `all` 汇总多条 ·
`each` 保留 List 下标路径（`[{"path":[1],…},{"path":[3],…}]`）·
`optional(rule)` 对 `null` 放行、对空串报 · `refine` 用自带消息（`"must be even"`）·
`inspect` 返回全部问题、`validate` 抛 `ValidationError` ·
`safeParse` 成功时 `{"success":true,"value":…,"issues":[]}` ·
结构失败与语义失败都进 `issues` 且 `value` 为 `null` ·
`parse` 抛 `ValidationError` · `validator(Type, rule)` 四个操作可用 ·
多余字段按 `Type.parse` 规则丢弃 · 「通过校验但不满足声明类型」在公开 API 上
**不可达**：`validate`/`inspect` 的入参已是 `T`，只有 `parse`/`safeParse` 收
`unknown` 而它们先跑 `Type.parse` —— 顺序上语义规则永远在结构之后。

**一处措辞记录（不立项）**：`inspect(<记录字面量>, rule)` 会因为 `T` 从两个实参
解成联合而被拒 ——
`VEL4001: Cannot assign (value: Options, path: List<string | number>) -> … to
(value: { host: string, port: number, tag: null } | Options, path: …) -> …`，
消息没有点名作者真正需要的改法（先写一个带注解的绑定）。文档自己的范例用
`const input: unknown = {...}` 绕开了这一格。

### EN —— `velar/env`（约 8 个探针）

`get` 命中 · 空值 → `""` · 缺失 → `null` · `require` 缺失 →
`VelarScript environment variable 'PROBE_ABSENT' is required` · 小写名可读 ·
含连字符、空名、300 字符名一律
`Environment variable names use ASCII letters, digits, and underscores, starting
with a letter or underscore`（**注**：超长那一格的消息只讲形状不讲 256 上限）·
工程根的 `.env` 不被加载 · 在 `velar/serve` handler 里读取正常
（`{"home":"/Users/mac"}`）。

### SR —— `@velarscript/server`（约 14 个探针）

**清单 5 项**：`server.configuration` 指向工程外 →
`'server.configuration' must stay inside the project root` · 后缀不在
`.yml/.yaml/.json` → `'server.configuration' must end in .yml, .yaml, or .json` ·
同时列出两个扩展 → `Velar module 'velar/websocket' has more than one extension
owner (@velarscript/node, @velarscript/server)` · 缺 `server` 键 →
`'server' must be an object` · 合法配置 `Checked 1 module`。

**配置装载 4 项**：`configuration(Type)` 返回受检值、
`applicationConfigurationPath` 为工程相对路径（`application.yml`）·
文件缺失 → `Cannot read server configuration 'application.yml': ENOENT …` ·
YAML 重复键 → `Cannot parse server YAML configuration 'application.yml': Map keys
must be unique` · 类型不符 / 缺节 → `ValidationError: Value does not match
Settings — field 'server' does not match ServerSettings` /
`field 'database' is missing`（四者全部 fail-closed，退出码 1）。

**运行 5 项**：`application(routes)` 起服务并返回真实端口 ·
`authenticate(security.bearer(), verify)` —— 缺凭据与无效凭据得到**同一条**
不透明 401、verifier 抛出得到 500（不是 401，与文档「a thrown verifier failure
remains an opaque 500」相符）· `database(connect, disconnect)` 在启动时
`database connect`、注入同一个值、关停时 `database disconnect primary` ·
`velar build` 产出可独立运行的目录（`main.js` / `package.json` /
`velar-node.json` / `application.yml` / `node_modules/velar` /
`node_modules/yaml`），`velar-node.json` 的 `formatVersion: 5` 逐项带 sha256 与
`role`；直接 `node main.js` 起得来并监听声明端口。

---

## 修复优先序（建议，不含实施）

1. **PR-D1 + PR-D2（一次失败的 spawn 毒化并可能打死应用）** —— 唯一一条会让
   **长驻服务被单个请求废掉**的缺陷，且逃逸路径让 `try/catch` 的语言承诺失效。
   两条同源，应一起处理。附带把消息从「invalid owned handle」换成点名可执行文件
   与 `ENOENT`/`EACCES` 的那句。
2. **SV-D2 + SV-C1（`HttpProblem.code` 恒为类名）** —— 官方 skill 与仓内 tour
   教的写法产出常量；先要一次裁决（`HttpProblem` 是否可以是 Error 子类而仍然
   拥有自己的 `code`），再动降级或契约，最后同步 `docs/ai-skill-node.md` 与
   `examples/tour/node/01-server.vel`。
3. **SV-D3 + SV-I2（BOM 被静默删除）** —— 数据丢失形状，且已经能证明它让
   `sha256Text(readText(path))` 不等于文件摘要、让 Core 与 Node 对同一串字节
   给出两个 JSON 判决。三处读路径同源（增量 UTF-8 解码器）。
4. **SV-D4（错误响应拿不到中间件的响应头）** —— 安全相关：`nosniff` 与
   CORS 头在 4xx/5xx 上全部缺席，浏览器侧连问题文档都读不到。
5. **SV-D1（问题文档媒体类型被响应复制改写）** —— 一行不对称
   （`json` 分支不带 `contentType`），后果是线上与自己发布的 OpenAPI 不符。
6. **SV-I1（两种错误线上形态）** —— 需要一次裁决：传输层拒绝要不要也走问题文档，
   还是把 OpenAPI 对 413 的声明改成如实的两种。
7. **SR-I1（`port: 0` 两个面不同意）** —— 要么让 `application()` 接受 0，要么把
   1–65535 这个界写进 `docs/ai-skill-server.md` 的配置节；今天两者都没做。
8. **SV-I4（GET 与 `@websocket` 同路径三个裁判两种结论）** —— 让编译期或装配期
   与 `openapi()` 站在一起。
9. **SV-I3 / SV-I6 / FS-I1（通道、门与路径约定）** —— 客户端挂断不该用
   handler 失败的措辞；`velar check` 补上「声明的配置文件必须存在」；
   `velar/validation` 的结构层与语义层统一 path 拼写。
10. **SV-C2（Web 拒绝的指引与诊断形状）** —— 七条里六条补上去处，并让这一族
    诊断带上码与位置（同一形状还有 `velar/serve` 导入 Core 名的双报）。
11. **SV-I5（文档代码块不是规范格式）** —— 与 0.28.0 的 I-C2 同族；根因是
    Core 的具名实参空格随换行改变，值得单独裁决一次。
12. **成文（14 条 UNDEFINED）** —— 其中优先级最高的三条是 **SV-U1**（流响应
    没有 `content-type`）、**SV-U2**（静态 `root` 相对进程工作目录）、
    **PR-U2**（`terminal.close()` 之后不能再输出）：三者都会让照文档写的程序
    在部署时才发现行为不同。

---

## 本文的出身

本文由 P6 审计代理在编排者的 D115 §五 P6 排期下完成，隔离 worktree
`/private/tmp/velar-d114/audit-p6b`（分支 `audit/p6-audit-p6b`，HEAD `206136a`
＝ 0.29.0 时的 main）。只读仓库、只写本账本；未派实施代理，未提交任何 git 写操作，
未运行任何仓库构建或测试门。探针工程与宿主脚本在会话草稿目录
`/private/tmp/velar-d114/scratch-p6c/`，不入仓；每个探针服务器都绑定 `port=0`
或临时端口并在探针结束时终止，收尾核对
（`lsof -iTCP -sTCP:LISTEN -P | grep node`）无本轮遗留监听。
