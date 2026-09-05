# 完整性审计 —— 0.29.0 Web 扩展面（2026-09-06，约 256 个探针）

审计对象：0.29.0（`206136a`，`web@0.12`）的 Web 扩展全部面 —— 组件与 JSX、Look、
反应式（state / computed / resource / action / watch）、生命周期与应用模块。
方法学沿用 [[COMPLETENESS-AUDITS]] 审计一与 [[COMPLETENESS-AUDIT-0.28.0-2026-09-05]]：
对每个特性面做 **charter 承诺 vs 编译器行为 vs 作者合理预期** 的逐条对照，目标是
消灭未定义而不是找 bug；DECIDED-AND-CORRECT 必须记录，否则「完整」无法凭失败清单成立。

探针在隔离 worktree `/private/tmp/velar-d114/audit-p6b`（分支 `audit/p6-audit-p6b`，
HEAD `206136a`）的已构建 `dist` 上实测，三条通道：

1. **编译**：草稿工程 `/private/tmp/velar-d114/scratch-p6b/web/`（`velar.json` 按
   0.28.0 账本的配方钉 `"surfaces": {"core": "0.7", "web": "0.12"}`、
   `"extensions": ["@velarscript/web"]`），探针写进 `web/probes/<名>.vel`，用
   `node packages/cli/dist/cli.js check <该文件>` 单文件取诊断（工程内单文件仍加载
   Web 扩展，见 CLI 参考「Naming a single file instead … scopes the run to that
   file's own graph」）。
2. **样式表**：`velar build <草稿工程> --mode readable`，读 `dist/assets/styles-*.css`
   与 `dist/assets/main-*.js` —— Look 的类名稳定性、去重、秩编码、`before/after look`
   次序只能在这里看。
3. **运行时**：`tests/reactive-task-budget.test.ts` 的 Node 工程 harness（编译整个
   草稿工程、链接 `velar/*`、`node main.js`），另加 **仓库自己的数据型 document 替身**
   —— 逐字取自 `tests/hardening-closeout-live-props.test.ts` 的 `dom` 块，用
   `--import` 在任何模块初始化之前装好，并补齐 `classList` / `textContent` /
   `document.body` / `querySelector("#app")` 与 `__velarDevelopmentHooks.frozenRead`。
   于是挂载、渲染、键控复用、生命周期次序、Look 落到元素上的属性都可观测，**无浏览器**。

> 探针环境的一个自伤记录：替身最初的 `textContent` 存取器对文本节点写在了子节点上，
> 于是「实时 prop 不更新已渲染文本」看起来像一条 DEFECT。补正替身后 JX-R7 证明
> prop 到渲染位、`computed`、f-string 三条路径全部实时。**替身的缺陷不是被审对象的
> 缺陷** —— 本轮所有运行时结论都在替身补正之后复测过。

输出逐字引用。探针文件在 `/private/tmp/velar-d114/scratch-p6b/`，不入仓。

分类：**DEFECT**（编译通过后崩溃/静默错误，或工具产出坏源码）· **CHARTER-DRIFT**
（文档与实现不符）· **INCONSISTENT**（两条相关规则互相矛盾；含：同一个错误报两次、
一个意思两种拼写、消息给出的改法编译器随后拒绝、Look 规则与 JSX 指令互相不同意）·
**UNDEFINED**（charter 沉默、行为偶然 —— 记下的实测行为即应成文的答案）·
**DECIDED-AND-CORRECT**（探过且正确 —— 完整性凭证）。

审计面：**JX** 组件与 JSX（71 编译 + 11 运行时）· **LK** Look（74 编译 + 12 样式表/运行时）·
**ST** state/computed/resource/action/watch（23 编译 + 17 运行时）· **LC** 生命周期与
应用模块（25 编译 + 13 运行时）· 横切格式化与 `velar fix`（10）。

---

## DEFECT —— 3 条

### LC-D1 —— `publicConfig(Type)` 与清单不符：`check` 与 `build` 全静默，应用在 `@main` 之前就死

`velar/config` 的值是**构建输入**（web-api §`velar/config`：「Public configuration is
baked into the content-hashed application entry at build time.」），`Type` 是编译器已知的
运行时类型，两边在编译期都在手上 —— 但没有一条检查把它们对上。

最小探针（工程 `/…/cfg/`，`velar.json` 里**没有** `web.publicConfig`）：

```velar
import {has, keys, publicConfig} from "velar/config"

type RuntimeConfig:
    apiBase: string
    releaseChannel: string

const config = publicConfig(RuntimeConfig)

component App():
    return <p>{config.apiBase}</p>

@main: mount(<App />, "#app")
```

```text
--- check with NO publicConfig in velar.json ---
Checked 1 module from /…/cfg
--- build ---
Built readable Web app -> /…/cfg/dist
```

发射出来的清单值是空对象，检查推到运行时：

```js
var source = {};
…
function publicConfig(Type) {
  Type = __velarRequireRuntimeType(Type, "publicConfig");
  return Type.parse(value);
}
```

跑构建产物（Node + document 替身）：

```text
HOST-UNCAUGHT: Value does not match RuntimeConfig — field 'apiBase' is missing
```

把清单改成 `{"apiBase": "/api", "releaseChannel": 123}`（类型错而非缺字段）——
`check`/`build` 同样干净，运行时：

```text
HOST-UNCAUGHT: Value does not match RuntimeConfig — field 'releaseChannel' does not match string
```

要害有两层：① 这是**构建期可证**的失败，却只在首屏出现；② 失败发生在**模块求值期**，
早于 `@main`，所以 `velar/app` 的错误链还没装、web-api 承诺的
「renders a compiler-owned accessible fatal state instead of a blank page」这条路径
**根本没轮到**——用户拿到的是一张白页加一条宿主未捕获错误。对照 LC-B6：根组件构造抛出
时 fatal state 是到位的，说明缺的正是「清单不满足声明类型」这一格的编译期证明。

### ST-D1 —— `watch <resource>:` 编译干净，运行时**永不触发**，而 VEL5064 本该拦住它

web-api「Watch forms and lifetime」把主题枚举为「the name of a `state`, a `computed`,
a prop, or a **`resource` field**」，并且写明「A subject must also be able to change,
and that question is asked first, so one shape never draws two messages」。资源**面本身**
不在名单里，也确实永不改变 —— 但它被接受了。

最小探针 `/…/probes/st14.vel`：

```velar
type User:
    name: string

async def loadUser(id: string) -> User:
    return {name: id}

export component P(userId: string):
    resource profile: User = loadUser(userId)

    watch profile:
        detach profile.reload()

    return <p>{profile.value?.name ?? ""}</p>
```

```text
Checked 1 module from /…/probes/st14.vel
```

运行时（ST-E，同一组件里再放一条 `watch profile.loading:` 作对照，`@mounted` 里
`detach profile.reload()` 一次）：

```text
loading watch ran 1
loading watch ran 2
loading watch ran 3
loads=2
```

`watch profile:` 的体一次都没跑（它会打印 `surface watch ran N`，输出里没有），
`watch profile.loading:` 三次。也就是说：**作者写了一段永远不会执行的代码，
零诊断**。同一位置的 `watch profile.value:` 被正确拒绝：

```text
/…/probes/st15.vel:11:16 error VEL5078: This watch reloads 'profile' — the resource it watches — so every completed load re-triggers it; watch the input the load reads instead, as 'watch userId:' with 'detach profile.reload()' in its body
        detach profile.reload()
               ^^^^^^^^^^^^^^^^
```

而裸 `const` 主题被 VEL5064 拒绝并说明了理由：

```text
/…/probes/st20.vel:2:7 error VEL5064: This watch subject never changes, so its body can never run — 'fixed' is not a reactive source; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run
watch fixed:
      ^^^^^
```

VEL5064 的这句话（「watch … or a resource **field**」）已经把答案写在消息里了，
只是判据没覆盖资源面这一格。

### ST-D2 —— 写在 watch 体顶层 `finally` 里的自写：编译静默，运行时转到 100 轮上限

宪章 §15 把被拒的形态定义为「a body whose top level **unconditionally** writes the
watch's own subject, or any part of it」，理由是「the write that can only be a loop」。
`finally` 是语言里**唯一无条件必然执行**的块：body 的任何一条执行路径都经过它。

最小探针 `/…/probes/st11.vel`：

```velar
state count = 0

watch count:
    try:
        print("x")
    finally:
        count = count + 1
```

```text
Checked 1 module from /…/probes/st11.vel
```

运行时（ST-A）：

```text
runs=101 reports=1
watch|A reactive watch cannot invalidate itself more than 100 times (watching count): it writes state 'count' while reading it. Read it into a binding before the code that writes it, so the write cannot reach the read that tracked it.||

after second write count=5000 runs=101 reports=1
```

与 0.28.0 的 H-D1 同一形状（编译静默 → 运行时 100 轮），只是这次缺的是**位置**而不是
拼写。0.29.0 的 CHANGELOG 说 VEL5077 现在覆盖「a write of any part of the watch
subject … with the conditional, nested and cross-state exclusions kept」——
`finally` 被「nested」吞掉了，但它不是条件，也没有任何执行路径绕过它。

同族的 `for` 体与 `try` 体见 ST-U1：那两格「nested」的排除站得住（体可被跳过 / 可被
抛出打断），`finally` 这一格站不住。三者的运行时行为完全一致：

```text
--- for body ---   count=102 reports=1  watch|A reactive watch cannot invalidate itself more than 100 times (watching count)…
--- try body ---   count=102 reports=1  watch|…（同上）
--- finally ---    （同上，101 轮）
```

---

## INCONSISTENT —— 7 条

### LK-I1 —— 宪章说「一张表两个构造」，实测 `look:` 只在两个位置开块，`<` 在五个位置开元素

宪章 §17 开篇：

> A `look:` or `keyframes:` block is a value, so it is written where a value is
> written: after `=`, after `return`, or **inside a call, a collection, or a
> record**. Section 14 lists those positions in full, and they are **the same ones
> that decide whether `<` opens an element — one table, two constructs**.

实测三格全拒。**调用实参位**（`/…/probes/lk55.vel`）：

```velar
import {rgb} from "velar/look"
def take(value: Look) -> Look:
    return value
export const a = take(look:
    color = rgb(1, 1, 1)
)
```

```text
/…/probes/lk55.vel:4:23 error VEL2024: Write '=' between the name and value for named argument 'look': look = value
export const a = take(look:
                      ^^^^

/…/probes/lk55.vel:5:11 error VEL2024: A named argument takes one value; remove the extra '='
    color = rgb(1, 1, 1)
          ^
```

**集合位**（`lk50.vel`，`const looks: List<Look> = [look: …]`）：

```text
/…/probes/lk50.vel:2:28 error VEL5038: A Look value is written as 'look:' followed by an indented block of 'property = value' entries
const looks: List<Look> = [look:
                           ^^^^

/…/probes/lk50.vel:4:2 error VEL2001: Expected ']' after list elements
```

**记录位**（`lk56.vel`，`{main: look: …}`）与 `keyframes:` 同款（`lk58.vel`）：

```text
/…/probes/lk56.vel:3:11 error VEL5038: A Look value is written as 'look:' followed by an indented block of 'property = value' entries
/…/probes/lk58.vel:3:11 error VEL5060: A keyframes value is written as 'keyframes:' followed by indented 'from:', 'to:', or 'N%:' stops
```

而**同一批位置上 JSX 全部通过**（`lk61.vel`/`lk62.vel`）：

```velar
export component P():
    const nodes: List<WebNode> = [<p>a</p>, <b>c</b>]
    const rec = {main: <p>a</p>}
    return <div>{nodes}{rec.main}</div>
```

```text
Checked 1 module from /…/probes/lk61.vel
Checked 1 module from /…/probes/lk62.vel   （def take(node: WebNode)；take(<p>a</p>)）
```

`= ` 与 `return` 两格 `look:` 是好的（`lk60.vel` 干净）。所以是**一张表被两个构造读成了
两张表** —— 这正是分类词表里点名的「一个 Look 规则和一个 JSX 指令互相不同意」。
附带：集合位与记录位每次都是 VEL5038/VEL5060 + 一条 VEL2001 级联，一个拼写两条错误。

### JX-I1 —— 具名实参调用组件报两条，位置实参报一条

```velar
component Card(title: string):
    return <p>{title}</p>

export component Page():
    return <div>{Card(title="a")}</div>
```

```text
/…/probes/jx41.vel:5:18 error VEL4001: Render component 'Card' with JSX
    return <div>{Card(title="a")}</div>
                 ^^^^^^^^^^^^^^^

/…/probes/jx41.vel:5:18 error VEL4001: Components use JSX props rather than named call arguments
    return <div>{Card(title="a")}</div>
                 ^^^^^^^^^^^^^^^
```

同一码、同一跨度、两句话。位置实参 `Card("a")`（`jx41b.vel`）只报第一条 ——
所以是「一个错误报两次」，与 0.28.0 的 D-I1 同族。

### JX-I2 —— 组件体里的 `match` 让编译器说「`return` 只能用在函数里」，而组件本来就有 `return`

```velar
enum Mode:
    One
    Two

export component Page(mode: Mode):
    match mode:
        case Mode.One:
            return <p>one</p>
        case Mode.Two:
            return <p>two</p>
```

```text
/…/probes/jx24.vel:5:1 error VEL5008: Component 'Page' must have exactly one top-level return
export component Page(mode: Mode):
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

/…/probes/jx24.vel:8:13 error VEL3003: 'return' can only be used inside a function
            return <p>one</p>
            ^^^^^^^^^^^^^^^^^

/…/probes/jx24.vel:10:13 error VEL3003: 'return' can only be used inside a function
            return <p>two</p>
            ^^^^^^^^^^^^^^^^^
```

两条规则合起来自相矛盾：VEL5008 说组件必须**恰好有一个**顶层 `return`，VEL3003 说
`return` 在这里根本不合法。作者读第二条会得出「组件不能 `return`」的结论。可走的两条
路（`jx24b.vel` 抽 `def` 返回 `WebNode`、`jx24c.vel` 在 `match` 里给 `let node` 赋值后
统一 `return`）都干净通过，但两条消息都没指它们。

### JX-I3 —— JSX 属性展开 `{...props}` 报两条「Expected a JSX attribute」，且从不点名「展开」

```velar
type Props:
    title: string

export component Page():
    const props: Props = {title: "a"}
    return <p {...props}>x</p>
```

```text
/…/probes/jx13.vel:6:15 error VEL5002: Expected a JSX attribute
    return <p {...props}>x</p>
              ^

/…/probes/jx13.vel:6:24 error VEL5002: Expected a JSX attribute
    return <p {...props}>x</p>
                       ^
```

一个拼写两条错误；而且宪章 §19 的「不存在」清单里点名了「magical JSX control-flow
attributes」，没点名属性展开，所以作者拿到的既不是规则也不是改法。对照 Look 侧
`...spread` 在 `look:` 块里是**合法**的（`lk26.vel` 通过），两处的 `...` 一个是语言的
一个不是，而 JSX 这边只说「这里要一个属性」。

### LK-I2 —— `keyframes:` 停位里的越界具名实参报两条

```velar
import {rgba} from "velar/look"
export const emerge = keyframes:
    from:
        color = rgba(0, 0, 0, alpha=2)
    to:
        color = rgba(0, 0, 0, 1)
```

```text
/…/probes/lk20.vel:4:17 error VEL5060: A keyframe value must resolve to static CSS from literals, unit values, arithmetic, velar/look builders, or const bindings — local or imported — that hold any of those, and the text it resolves to must read as one declaration value: no ';', '{', '}', or '@' outside a string, with parentheses, strings, and comments all closed
        color = rgba(0, 0, 0, alpha=2)
                ^^^^^^^^^^^^^^^^^^^^^^

/…/probes/lk20.vel:4:37 error VEL5042: RGB alpha must be from 0 through 1; rgba received 2
        color = rgba(0, 0, 0, alpha=2)
                                    ^
```

VEL5042 是真原因；VEL5060 是它的后果（值解不出来所以不是静态 CSS），并且这句
「must resolve to static CSS…」会把作者引向「具名实参不能进停位」这个**错误**结论 ——
`lk19.vel` 证明**在范围内**的具名实参在停位里完全合法：

```velar
import {shadow, rgb} from "velar/look"
export const emerge = keyframes:
    from:
        boxShadow = shadow(0px, 0px, 18px, rgb(120, 150, 255), spread=2px)
    to:
        boxShadow = shadow(0px, 0px, 2px, rgb(120, 150, 255), spread=0px)
```

```text
Checked 1 module from /…/probes/lk19.vel
```

### LK-I3 —— `hsl` 的百分比参数是 `number`，而语言自己的 `%` 在那里被拒

```velar
import {hsl} from "velar/look"
export const a = look:
    color = hsl(200, 50%, 50%)
```

```text
/…/probes/lk67.vel:3:59 error VEL4001: Cannot assign Percentage to number
```

范围检查证明这两位就是百分比：

```text
/…/probes/lk73.vel:3:22 error VEL5042: HSL saturation must be from 0 through 100; hsl received -3
    color = hsl(200, -3, 9)
                     ^^
```

也就是说 0–100 的那个数**就是**百分数，而 `%` 是本语言的一等单位（`const content:
Percentage = 75%`）。同一个意思两种拼写，其中一种被拒，消息只说「Cannot assign
Percentage to number」，不说「写 50，HSL 饱和度是 0 到 100 的百分数」。CSS 作者写
`hsl(200, 50%, 50%)` 是常态，不是笔误。

### LC-I1 —— 「宿主不在」这一件事，`velar/browser` 用四种句式说，两种压根没提宿主

宪章「Standard library membership boundary」写：「**A capability fails where it is
called, never where it is imported.** … the error arrives from the call that needed
the host.」七个入口在 Node（无 document）宿主下实测：

```text
environment():      Browser online state must be bool
location():         Browser location URL must be a string
watchOnline:        The browser does not expose native global addEventListener
watchVisibility:    The browser does not expose native addEventListener
scrollTo:           The browser does not expose native scrollTo
frame():            The browser does not expose native requestAnimationFrame
clipboard:          Clipboard access requires a secure browser context
```

对照 `velar/storage` 的同一问题只有一句：

```text
set failed: velar/storage requires a browser storage environment
get failed: velar/storage requires a browser storage environment
```

`environment()` 与 `location()` 的两句是**字段校验**措辞：作者读到「Browser online
state must be bool」会去查自己的数据，而真正的事实是「这个宿主没有浏览器」。
`watchOnline` 与 `watchVisibility` 是同一件缺失，句子差一个词（`global`）。
失败位置全部正确（都在调用处），缺的是「一族一条消息」。

### LC-I2 —— `Component<Props>`（不带 Handle 参数）上的 `ref` 被报成「组件没有 exposes」

```velar
type Handle:
    open: () -> null
type View = Component<(title: string) -> WebNode>
component Dialog(title: string) exposes Handle:
    def open():
        print("o")
    expose {open}
    return <dialog>{title}</dialog>
export component Page():
    let h: Handle? = null
    const V: View = Dialog
    return <V ref={h} title="t" />
```

```text
/…/probes/jx60.vel:12:15 error VEL5057: Component 'V' does not expose a Handle
    return <V ref={h} title="t" />
              ^^^^^^^
```

拒绝是对的（宪章 §14：「Bare `Component` and the one-argument `Component<Props>`
contract do not authorize a component ref.」），但 `Dialog` **恰恰**声明了 `exposes
Handle`；不授权的是契约，不是构造器。消息把原因安在了组件身上，也没给改法
（`Component<(title: string) -> WebNode, Handle>`）。同一码在真正没有 `exposes` 的
组件上（`jx19.vel`）说的是同一句话 —— 两种不同的错误共用一句诊断。

---

## CHARTER-DRIFT —— 6 条

### LK-C1 —— 宪章说越界的具名实参「留到运行时证」，实测是编译错误

宪章 §17「Builders」：

> The range table is read by position, and `animate` is the only builder that
> resolves its options by name, so a named argument carries no position for the
> table to read: `rgba(0, 0, 0, 2)` is a compile error, and **the same
> out-of-range opacity written `alpha=2` is proved at run time instead**, like a
> genuinely unknown one.

实测两种写法都是编译错误，连**打乱声明次序**的具名调用也照报：

```text
/…/probes/lk16.vel:3:33 error VEL5042: RGB alpha must be from 0 through 1; rgba received 2
    color = rgba(0, 0, 0, alpha=2)
                                ^

/…/probes/lk17.vel:3:24 error VEL5042: RGB alpha must be from 0 through 1; rgba received 2
    color = rgba(alpha=2, red=0, green=0, blue=0)
                       ^
```

实现比宪章严，是好事；漂的是文本。

### LK-C2 —— 宪章说 `keyframes:` 停位「先以不是静态 CSS 为由拒绝具名实参」，实测接受

同一段紧接着写：「A `keyframes:` stop is unaffected, because a named argument does
not resolve to static CSS and the stop refuses it on that ground first.」
`lk19.vel`（见 LK-I2）证明范围内的 `spread=2px` 在停位里干净通过。
web-api「Motion: transitions and checked keyframes」与实现一致：「**a builder call in
a stop may use named arguments**」。所以是宪章 §17 与 web-api 直接互相矛盾，实现站在
web-api 一侧。

### JX-C1 —— web-api 说插值里的组件元素「prop 表达式一变就重建」，实测不重建

web-api「Hosts, fragments, and JSX directives」：

> Every other position rebuilds, because every other position is a region rather
> than a child — a component element inside an interpolation, `{ready ? <Preview
> text={draft} /> : <Empty />}` included, **is rebuilt whenever anything that
> interpolation reads changes, `draft` included**. That is not the ternary's
> doing: the region's dependencies are every tracked read inside it, so a branch
> that never flips still rebuilds when a prop expression changes.

探针（JX-R9）把两种读法分开：

```velar
state draft = "d1"
state tag = "t1"

component Preview(text: string):
    @mounted:
        print(f"mounted {text}")
    @cleanup:
        print(f"cleanup {text}")
    return <b>{text}</b>

component App():
    return <div>
        {<Preview text={draft} />}
        {tag == "" ? <Empty /> : <Preview text={f"tagged {tag}"} />}
    </div>
```

```text
mounted d1
mounted tagged t1
--- change draft (read by the first region's prop) ---
--- change tag (read by the second region's condition AND prop) ---
cleanup tagged t2
mounted tagged t2
--- done ---
```

`draft` 只被 prop 表达式读到 —— **区域没有重建**（没有 cleanup/mounted 一对）。
`tag` 被区域的条件读到 —— 重建。也就是说：**prop 表达式里的读不是区域依赖**。
实现比文档保守（更好），但文档据此给出的建议（「Move the element out of the
interpolation and branch inside the child, or give the position a key, when the
instance is meant to live across updates」）今天是多余的，读者会按一条不存在的
行为改结构。

### LC-C1 —— `tick()` 拒绝无人认领的失败这条承诺，只在**非浏览器**宿主为真

宪章 §16：「It is also the point where an unowned failure surfaces: if the flush
reported a failure that no handler claimed, `tick()` **rejects** with it, so
awaiting `tick()` cannot step over a broken update.」web-api「`mount` and `tick`」
同句。两处都没有条件从句。

同一段源码，只换宿主（LC-F4 / r11）：

```velar
state count = 0

watch count:
    throw Error("watch blew up")

@main:
    count = 1
    try:
        await tick()
        print("tick resolved")
    catch e:
        print(f"tick rejected: {e.message}")
    print("still running")
```

```text
##### with a document present (browser-shaped host)
HOST-UNCAUGHT: watch blew up
tick resolved
still running

##### with no document (Node host)
Unhandled VelarScript error report: Error: watch blew up
    …
tick rejected: watch blew up
still running
```

`render` 相（LC-F5）与 `detached` 相（LC-F6）在浏览器形态宿主下同样是
`tick resolved`。分支在实现里是明写的（`packages/web/src/runtime-foundation.ts`
`escalate`）：

```js
  const escalate = (error) => {
    if (__velarDomDocument !== null) {
      __velarEnqueue(() => { throw error; });
      return;
    }
    if (__velarGraphSetCount(unhandledFailures) < 100) __velarGraphSetInsert(unhandledFailures, error);
    __velarFoundationTrace(error);
  };
```

代码注释把理由写清楚了（浏览器里微任务抛出会走宿主 error 事件、页面存活；非浏览器
里会终止进程，所以停泊到 `tick()`）—— 缺的是把这个条件写进两份规范文本。今天的
文本对唯一一个 `tick()` 被文档化的宿主（浏览器）是假的。

### LC-C2 —— 「首屏失败一律渲染可访问的 fatal state」对**动态区域**不成立

web-api §`velar/app`：

> Root mounting is lazy. If the initial render fails, the application receives the
> report and renders a compiler-owned accessible fatal state instead of a blank
> page. **That covers every initial-render path in every build: a setup throw, a
> dynamic or keyed region that throws while it is first constructed**, a mount
> target that does not exist, and a root written into a module binding …

被挂载的**根**抛出时承诺兑现（LC-B6）：

```text
reports=1 :: mount|root failed||

--- #app ---
<el >
  <el role="alert" data-velar-fatal="">
    #text "The application could not start: root failed"
```

**首次构造就抛出的动态区域**（LC-B7，`{ready ? <Bad /> : <Empty />}`）没有：

```text
reports=1 :: render|region failed||Root

--- #app ---
<el >
  <el >
    <!--velar:start-->
    <!--velar:component-error-->
    <!--velar:end-->
```

留下的是一个 HTML 注释：对用户不可见，对辅助技术不可见，没有 `role="alert"`。
失败确实上报了（相是 `render` 而不是 `mount`），页面其余部分继续工作（LC-B5：
同级 `<Good />` 正常挂载、它的 watch 之后照常触发）—— 所以行为本身是**有意的
局部隔离**，漂的是那句「covers every initial-render path」。

### LK-C3 —— `min` / `max` / `clamp` 只吃 `Length`，而文档说布局构建器吃百分比

web-api §`velar/look`：「Visual addition and subtraction require compatible
dimensions.」宪章 §17「Builders」：「Layout builders accept bounded strings, typed
lengths, **percentages**, track fractions, and their declared track values.」
`min`/`max`/`clamp` 在两处的布局构建器名单里。

```text
/…/probes/lk70.vel:3:20 error VEL4001: Cannot assign Percentage to Length
    maxWidth = min(100%, 600px)
                   ^^^^

/…/probes/lk68.vel:6:20 error VEL4001: Cannot assign Percentage to Length
    maxWidth = min(100%, 60%)
                   ^^^^
/…/probes/lk68.vel:8:25 error VEL4001: Cannot assign Percentage to Length
    width = clamp(16px, 50%, 24px)
                        ^^^
```

全 `Length` 的形态（`clamp(16px, 3vw, 24px)`，正是 web-api 自己的示例）通过。
CSS 的 `min()`/`max()`/`clamp()` 存在的首要理由就是混合 `%` 与 `px`；今天这条路
在 Look 里没有拼写，而文档说有。

### LK-C4 —— web-api 说 `strokeLinecap` 只收三个词，实测收八个

web-api §`velar/look`：「`strokeLinecap` accepts `butt`, `round`, and `square` and
**nothing else**, so a plausible `strokeLinecap = "none"` is a compile error」。
拒绝是对的，名单不是：

```text
/…/probes/lk40.vel:2:21 error VEL5038: Look property 'strokeLinecap' does not accept 'none'; write one of butt, round, square, inherit, initial, revert, revert-layer, unset
```

`strokeLinecap = "inherit"` 与 `display = "revert-layer"`（`lk41.vel`）干净通过。
CSS 全局关键字进每个关键字集是对的设计；「and nothing else」这句话不真。

---

## UNDEFINED —— 9 条（charter 沉默处；下列实测行为即应成文的答案）

| ID | 未定之处 | 实测行为 |
|---|---|---|
| **ST-U1** | watch 体里**嵌套但必然执行**的自写算不算「顶层无条件」 | `for` 体、`try` 体、`match` 臂里的自写全部编译静默，运行时 101 轮后被 100 轮上限停住并报 `watch\|A reactive watch cannot invalidate itself more than 100 times (watching count): it writes state 'count' while reading it. …`。宪章只列了三种「untouched」（条件下的写、写别的 state、经调用的写），这三格都不在其中。`finally` 这一格另立为 ST-D2 |
| **ST-U2** | `watch <computed>:` 体里写该 computed 的来源 state | 编译静默；运行时不走 100 轮上限（watch 没写自己的主题），走**每任务 100,000 观察者**预算，跑满 50,000 轮后停：`runs=50000 base=50002 reports=1` / `update\|Reactive updates cannot run more than 100000 observers in one task\|Ran most in this task: a computed observer (50000 runs), the watch on 'doubled' (50000 runs)\|`。宪章「a write of a different state … untouched」把它排除了，但这是同模块、一跳、无条件、可证的环 |
| **ST-U3** | 100 轮自失效上限触发**之后**那条 watch 的命运 | 永久停摆：`1: loopRuns=101 otherRuns=0 reports=1` → 写别的 state → `2: loopRuns=101 otherRuns=1` → 再写自己的主题 `count = 9000` → `3: loopRuns=101 otherRuns=1 count=9000 reports=1`。写照常生效、别的 watch 照常跑、报告只发一次，**只有那条 watch 到页面结束都不再运行**。宪章只说「is stopped and reported」，没说停多久 |
| **ST-U4** | `state` 里放类实例时的反应性 | `class Counter` 实例存进 `state box`，`box.bump()` 改 `self.value`：`computed shown = box.value` **永不更新**，`watch shown:` 一次不跑，零诊断（`start shown=0` → `after bump shown=0 value=1 watchRuns=0`）。替换整个 cell（`box = Counter()`）才发布。web-api 的「Classes … are never wrapped」解释了机制，但「读一个类字段的 computed 会永久陈旧」这条后果没有成文，也没有像 `const` 冻结读那样的开发期探测器 |
| **JX-U1** | 键控列表里的**重复键** | 编译静默（`items.map(item => <Row key={item.id} … />)`，两行同 `id`）。运行时**整个应用起不来**：`mount\|Duplicate JSX key 'k'\|\|`，`#app` 里只剩 `<el role="alert" data-velar-fatal="">The application could not start: Duplicate JSX key 'k'</el>`，第一行已构造的组件跑了 `@cleanup` 而没跑 `@mounted`。宪章只说「stable `key` values」，没说重复键的后果 |
| **LC-U1** | `@mounted` / `@cleanup` 的**次序** | 挂载自底向上（`mounted leaf a` → `mounted leaf b` → `mounted middle` → `mounted root`）；清理自顶向下且子节点逆序（`cleanup middle` → `cleanup leaf b` → `cleanup leaf a`）。同级 `@cleanup` 之间：先声明的**后**清理（`twin cleanup` 在 `step 1` 之前）。宪章 §16 只写「The Web runtime owns their ordering」 |
| **LC-U2** | 重复 `mount` 同一个实例时**调用者**看到什么 | 只经错误链上报，`mount` 正常返回，不向调用者抛：`try:` 分支里的 `catch` 没进，报告是 `mount\|Cannot mount a VelarScript component more than once\|\|`。宪章说「a repeated mount fails **explicitly**」，没说「显式」是抛出还是上报 |
| **LK-U1** | `linearGradient` 的方向参数 | 是 `Angle`，CSS 的关键字形态没有 Look 拼写：`linearGradient("to right", …)` → `VEL4001: Cannot assign string to Angle`；`linearGradient(90deg, …)` 通过。宪章与 web-api 都只把 `linearGradient` 列进构建器名单，不给签名 |
| **LK-U2** | 只有一个停位的 `keyframes:` | 合法，发射一条单停位规则：`@keyframes velar-kf-e8b77b6e7c280955a4c8e5f7c9614bde{from{rotate:0deg}}`。只有 `to:` 的同样合法。附录说「A stop is `from:`, `to:`, or an integer percentage … Stops may not repeat and declaration groups must progress in ascending order」，没说至少要两个 |

---

## DECIDED-AND-CORRECT —— 完整性凭证（压缩记录）

### JX —— 组件与 JSX（约 82 个探针）

**Prop 契约 6 项**：缺必填 → `VEL5012: Component 'Card' requires prop 'title'`；
重复属性 → `VEL5014: JSX element 'Card' has duplicate attributes`；未知 prop →
`VEL5013: Component 'Card' has no prop 'subtitle'`；`children: WebNode?` 无默认值
仍是必填并给出改法（`VEL5012: … a prop becomes omittable through its default
value — declare 'children: WebNode? = null' on the component`）；prop 与标签体同给
→ `VEL5014: Component 'Card' receives children both as a prop and as JSX content`；
未声明 `children` 的组件收到子节点 → `VEL5018: … declare a 'children: WebNode' prop`。

**children 形状 5 项**：单节点 · `List<WebNode>` · 字符串 · `null` · 省略（带默认值）
全部通过；函数形态被拒并点名可渲染集合 —— `VEL5047: JSX can render only text,
finite numbers, bool, enums, WebNode values, and Lists of those values; received
() -> WebNode`。

**Component 契约 5 项**：`Component<(row: Row, compact?: bool) -> WebNode>` 正常
（`jx39`）· rest 参数 → `Component signatures use named props and cannot declare a
rest parameter` · 无名参数 → `Every Component signature prop requires a name` ·
结果非 `WebNode` → `A Component signature must return WebNode, received string` ·
组件值必须以 PascalCase 标签渲染（`const Chosen: RowView = Narrow` + `<Chosen …/>`
通过，`jx40c`）。

**Handle / ref 6 项**：`exposes` + 单个 `expose` 正常；两个 `expose` →
`VEL5056: … has more than one expose declaration`；只声明不给值 →
`VEL5056: … declares an exposed Handle but does not provide an expose value`；
无 `exposes` 的组件收 `ref` → `VEL5057`；`ref` 要可变 `let`（`const` →
`VEL5020: ref requires a mutable let binding`）；prop 不能叫 `ref` →
`VEL5056: 'ref' is a compiler-owned JSX directive and cannot be declared as a
component prop`。运行时：实例销毁后旧 Handle 抛
`Component Dialog Handle is no longer active`（LC-K）。

**host / fragment 4 项**：多根必须标 `host`（`VEL5043: … must mark exactly one
native element with 'host'`）· 两个 `host` → `… declares more than one host
element` · `host="yes"` → `The host directive is a valueless marker` ·
片段里的 `key` → `VEL5050: This JSX key has no effect: '<p>' is rendered in a
fixed position, and keys reuse children by identity only inside
'items.map(item => <Row key={item.id} />)' …`。

**VEL5075 1 项**：`def rowFor(...) -> WebNode: return <Card … />` 被拒，整段消息
把「实例 vs 节点」的分别、失败时机与两条改法都写出来了。

**原生元素与保留属性 5 项**：`<dvi>` → `VEL5061: … did you mean '<div>'?` ·
`<user-card>` 通过 · `onclick=` → `VEL5025` 指向 `on:click` 并说明浏览器会当脚本编译 ·
`onward=` → 同码另一句，说明整个 `on` 前缀按名封闭 · 未知/重复事件修饰符各一条
（`Unknown event modifier 'debounce'` / `Event modifiers cannot be repeated`）。

**文本与属性契约 6 项**：`{count}{flag}{maybe}{tone}{null}` 全部合法 · 记录与
`unknown` 被 VEL5047 拒 · `aria-busy={count}` 合法（数字是允许的属性值）·
`flag ? "true" : "false"` → `advisory A14` 并给出 `str(condition)` ·
`unsafe:html` 与子节点并用 → `VEL5015` · JSX 无注释形态（`<!-- -->` 与
`{/* */}` 都是 `VEL5002: JSX has no comment form; write a '//' comment on its own
line outside the markup`）。

**脚本边界 5 项**：`srcdoc` 无 `sandbox` → `VEL5066` 并给出 `sandbox=""` ·
`sandbox="allow-scripts allow-same-origin"` → 同码另一句 ·
`href="javascript:…"` → `VEL5067` 指向 `on:click` · `src="data:image/svg+xml,…"`
→ `VEL5067` 并**列全**惰性媒体类型 · `href="ftp://…"` 编译通过（宪章明写），
运行时写入器拒绝：首屏时 `mount|JSX attribute 'href' rejected the 'ftp:' URL
scheme`，更新时 `render|JSX attribute 'href' rejected the 'javascript:' URL
scheme`，属性保留旧值，后续合法值照常写入（JX-R11）。

**条件渲染 4 项**：三元 · `??` 兜底 · 自递归组件 · `{ready and <Panel />}` →
`VEL5029: 'and' combines bool values and cannot yield an element; render
conditionally with '{ready ? <p ... : null}'`。

**A4 4 项**：赋值形态与 `computed` 形态各一条消息，两条都点名了行、后果（输入框
失焦）与替代写法；行尾 `// velar-allow A4: <reason>` 生效；写在**上一行**正确报
`VEL1012: No A4 advisory is reported on this line …`。

**运行时 8 项**：插值留下的东西按类型分（`string`/`number` 是裸文本节点，`bool`、
可选、`WebNode` 被 `<!--velar:start-->`/`<!--velar:end-->` 括起，键控列表用
`velar:keyed-start`/`velar:keyed-end`）· JSX 文本规范化逐条为真（跨行折成
`"alpha beta"`、同行的 `<b>bold</b> <i>italic</i>` 保住中间那个空格、只有空白的
文本子节点不建节点、`"  spaced   out  "` → `" spaced out "`）· 键控复用两问皆对
（字段就地写保住行、重排保住行、`items.map(item => {…})` 重建全部行、删行跑
`@cleanup`）· 实时 prop 到渲染位/`computed`/f-string 三条路径全部更新（JX-R7）·
作为普通子节点的组件元素跨更新保住实例。

### LK —— Look（约 86 个探针）

**属性名 6 项**：拼写近似 → `VEL5038: Unknown Look property 'backgroundColour';
did you mean 'backgroundColor'?` · 别名 `radius` → 同码并讲规则（`Look properties
use the DOM camelCase spelling of a CSS property`）· 三个被排除族各自带**本族的
理由句**与 `import css unsafe` 出口（`font` / `float` / `animationName`）。

**单位 5 项**：`padding = 16` → `… is a CSS length and requires a unit; write a
unit value such as 16px, 1rem, or 50%` · `padding = 0` 合法 · 无单位属性
（`opacity` `zIndex`）合法 · `100% / 0` → `VEL5042: Look unit arithmetic cannot
divide by zero` · `100% - 32px` → `LengthPercentage` 合法。

**设计令牌 6 项**：缺 `--` · 绑定名 · f-string 名，三种各自被拒且第二三条同句
（讲清「名字是编译器唯一能看见的部分」）· `animation` 上的 `token()` 被拒并说明
理由与两条出路 · `color("var(--x)")` → 指向 `token("--x")` · 自由文本属性上的
`var()` → `advisory A12`，并说明「更大的值里的 `var()` 不建议」。

**范围 6 项**：`rgb(300,0,0)` · `rgba(…, 2)` · `alpha(…, 2)` · `lighten(…, 5)` ·
`darken(…, -1)` · `grayscale(3)` 全部编译期报，句式统一（`X must be from A
through B; <builder> received V`）。

**animate 5 项**：`0s` → `Animation duration must be greater than zero` ·
`delay=-100ms` → `cannot be negative` · `count` 与 `loop` 并用 → 一句解释为什么
互斥 · `count=1000001` → 上界 · 未知 easing → 列全七个。

**keyframes 4 项**：停位重复 → `Keyframe stop 'from' duplicates from` ·
降序 → `Keyframe stops must be declared in ascending order` · 逗号共享体
（`50%, 75%:`）合法且格式化稳定 · 结构相同的两个 keyframes 共用一条
`@keyframes velar-kf-…` 规则。

**条件、目标、作用域 6 项**：`@hover`/媒体/组合三向嵌套合法（`if @hover: @before:
content` + 其中再嵌媒体条件）· 目标不可嵌套 → `Look targets cannot be nested` ·
同属性重复 → `VEL5039: Look property 'color' is defined more than once in the same
scope` · **互补条件是同一个作用域**：`if scheme.dark` 与 `if not scheme.light` 报重复、
`viewport.width <= 720px` 与 `not (viewport.width > 720px)` 报重复 ·
简写与长写同域 → `VEL5039` 并点名四个长写 · 元素上的 `look:` 指令同规
（`look:padding` + `look:paddingTop` 被拒），而 `style:` 指令按 web-api 豁免。

**反应式与组合 5 项**：`look:` 字面量里读 state → `VEL5058` 并给出两条元素上的写法 ·
`look={[a, b]}` 同属性冲突 → `VEL5068` 点名两个 Look 与属性，并给出
「写一个 `...a` 开头的 Look」的改法 · 已组合过的一对（`b` 里有 `...a`）合法 ·
条件返回 Look 的 `def` 合法 · `List<Look>` 的元素与 `list.get(0)`（`Look?`）都能进
`look={}`。

**媒体阈值 2 项**：函数结果 → `VEL5052: A viewport breakpoint must resolve at
compile time to a px, rem, or em value; use a const unit token or an imported
const unit token`；`token("--bp")` 同句（令牌在这里也不行，与「媒体规则必须在程序
运行前抽出」一致）。

**指令 4 项**：重复 `look:color` → `VEL5014` · `look:hover:color` →
`Unknown inline Look property 'hover:color'; look:* uses the same camelCase
property names as a Look block` · `style:hover:color` → 同族另一句 ·
`style="…"` → `VEL5041: Raw JSX style is not supported; use style:property …`。

**样式表输出 8 项**（`velar build --mode readable`）：
① 结构相同的两个 Look 只发射**一份**规则；
② 秩编码可读且单调 —— 无条件 1 个属性选择器（=(0,1,0)，与一个简单类同级，正是宪章
   讲外部覆盖时依赖的那条），媒体 2–4，元素状态 5–7，两者兼有 8–10，第 4 个条件起
   饱和（`active+disabled+focus+hover` 仍是 7）；
③ 类名是可读令牌（`base:color`、`hover:color`、
   `hover+scheme-dark+viewport-width-lte-720px:color`）配 `--velar-look-*` 自定义属性；
④ 两次构建字节相同（`diff` 无输出）；
⑤ `import css unsafe "./a.css" before look` / `after look` 在生成表里就是前后两段；
⑥ `@disabled` 展开成 `:disabled` 与 `[aria-disabled="true"]` 两个选择器；
⑦ `content` 的 CSS 字符串规则逐条为真 —— `attr(data-x)` 被**当字面文本加引号**
   （元素上是 `--velar-look-before-base-content: "attr(data-x)"`）、`he said "hi"` →
   `"he said \"hi\""`、`line\nbreak` → `"line\A break"`（反斜杠 + 十六进制 + 一个终止
   空格，与宪章的转义规则逐字一致）、`none` 不加引号；
⑧ 单停位 keyframes 发射单停位规则（见 LK-U2）。

**运行时 3 项**：`look:color={hot ? rgb(2,2,2) : null}` 在 `hot` 变假时**同时**移除
令牌与自定义属性（`data-velar-look="base:padding"`，`--velar-look-base-color` 不见了），
被组合的 `look={base}` 的 `color` 不回来 —— 与宪章「each owns the properties it names」
一致；`look:` 指令无论属性次序都压过 `look={}`；跨组件边界**调用方赢**
（`<Badge look={callerLook} look:padding={8px} class="extra" />` 落到宿主上，得到
`--velar-look-base-color:"rgb(9 9 9)" --velar-look-base-padding:"8px"
--velar-look-base-margin:"2px"` 与 `class="extra"`）。

### ST —— 反应式（约 40 个探针）

**VEL5077 触发 4 项**：`count = count + 1` · `count = current + 1`（`as` 形态）·
`m.set("a", 1)` · **深写两格**（0.29.0 新增，逐字到位）——
`This watch writes 'form.name', a part of its subject 'form', at the top of its
body, …` 与 `This watch writes 'items[0]', a part of its subject 'items', …`。

**VEL5077 静默 3 项（真阴性）**：条件下的自写 · 经一跳 `def` 的写 · 经**两跳** `def`
链的写 —— 宪章明写「a write reached through a call」不管。

**VEL5079 4 项**：`action` 与 `async def` 两种写回者都报，且点名写的是什么 ——
浅写 `which writes 'total' — the reactive value this watch is on`；**深写**
`which writes 'form.name', a part of its subject 'form'`；集合变更调用
`which writes 'items'`。`detach` 与裸调用两种拼写都报（裸调用并列 VEL4027，两句都真）。

**主题形状 3 项**：`watch count + 1:` → `VEL5071: A watch subject names what to
watch, not what to compute … Declare it — 'computed value = count + 1' — then
'watch value:'` · 裸 `const` → `VEL5064`（见 ST-D1 引文）· 块作用域的 `watch` →
`VEL3010: 'watch' is only valid at module or component scope`。

**深度追踪 7 项**（运行时，逐格计数）：`task.done = true` 只失效 `doneFlag`、不碰
`title`；替换整条记录两者都失效；`items.append(4)` 失效 `size`、`items[0] = 9` 不失效；
`m.set("b", 5)` 不碰 `keyA` 也不碰 `keys()`；`m.set("a", 7)` 只碰 `keyA`。
（`seed 0/0/0/1/1` → `deep write 0/1` → `replaced 1/1` → `append 1` → `index write 1`
→ `other key 1/1` → `same key 2/1`）

**resource 6 项**（运行时，一条组件里走完全程）：

```text
1 value=u-1 loading=false ready=true error=-
2 value=u-1 loading=false ready=true error=boom 2
3 during reload loading=true error=-
4 value=u-3 error=-
5 superseded value=u-5 attempts=5
reports=1
resource|boom 2|profile|P
```

失败保住上一次成功的 `value`、`ready=true`/`loading=false`、`error` 有值；
`reload()` 起手就清 `error` 并把 `loading` 打开；后发先至的结果被丢弃（5 次尝试，
显示的是最后一次）；失败经错误链上报，相是 `resource`、detail 是资源声明名、
component 是 `P` —— 与 web-api 的每一句对上。

**action 6 项**（运行时）：并行不排队（两次 `detach save()` 都跑完，`done=1 2`）·
`pending` 是「有调用在飞」而不是每调用状态 · `error` 归最新一代且**起手清空** ·
失败既上报又拒绝调用（`caught save 3 failed`）· 两次重叠失败**各报一次**、公共
`error` 只归后者（`error=fail 2 reports=2`，两条报告 detail 都是 `save`）·
模块 action 的报告 component 栏为空。

**computed 3 项**：链式 `computed` 无毛刺（`base` 从 1 到 6，watch 只看到
`4/5`、`6/7`、`12/13`，中间态一个没漏）· 同步赋值突发只发布一次（三连写只产生
一次 watch 运行）· 首次访问即算、被观察时缓存。

**冻结读探测器 1 项**：装上 `__velarDevelopmentHooks.frozenRead` 后，组件构建期读进
`const` 的值在源变化时准确报出 ——
`A reactive value read while P was being built was frozen at 0, and the source has
now changed to 1. … If it is meant to follow, declare it with 'computed name =
<expression>'; …`（`.vel` 行号由开发宿主的 source map 解析，Node harness 里看不到）。

**watch 次序 1 项**：同模块两条 watch 按源序运行；两条都写同一个 state 不是错误。

### LC —— 生命周期与应用模块（约 38 个探针）

**位置规则 5 项**：模块级 `@mounted` → `VEL2022: Unknown compiler-owned name
'@mounted' at statement scope; the module namespace contains only '@main:'` ·
函数内同款 · 两个 `@mounted` → `VEL5009` · `@cleanup` 里 `await` →
`VEL4007: Component setup and cleanup are synchronous; use resource, action, or
mounted for async work` · `@mounted` 里 `await` 合法。

**mount / tick 4 项**：`mount(await …)` → `VEL4007: mount constructs its root
synchronously; await the root in a separate module binding before calling mount` ·
`let mount = 5` → `VEL3007: 'mount' is a reserved extension binding` ·
缺失目标 → `mount|VelarScript mount target was not found` 并把 fatal state 渲进
`document.body` · 根构造抛出 → `mount|root failed` + `role="alert"
data-velar-fatal` 的可访问 fatal state。

**清理语义 3 项**：一步失败不挡其余（`twin cleanup` 照跑，失败经
`cleanup|cleanup one failed||Leaf` 上报）· 组件销毁跑 `@cleanup`、条件分支切换跑
· 失效的 Handle 抛 `Component Dialog Handle is no longer active`。

**局部隔离 2 项**：同级组件构造抛出时**只有那一格**被换成
`<!--velar:component-error-->`，其余树继续挂载并保持活着（同级 `<Good />` 的
`@mounted` 跑了、之后 `pulse` 变化时它的 watch 照常触发）；报告相是 `render`、
component 栏是外层组件名。

**velar/storage 3 项**：非数据值被编译期拒 —— `VEL4001: Storage values accept only
records, Lists, enums, primitives, and optionals; received Thing` ·
`get/set/watch` 的三段式签名（含 `maxBytes`）编译通过 · 无浏览器宿主时**在调用处**
失败且句子点名模块（`velar/storage requires a browser storage environment`）。

**velar/forms 6 项**：`read` 的解码边界逐字准确 —— 嵌套记录
`Form field 'profile' cannot decode Nested; use string, number, bool, an enum, an
optional scalar, or List<string>`、`Map` 同句；`string`/`List<string>`/`number`/
`bool`/`string?` 五种字段一次通过；`<form ref={…}>` 要 `Element?`
（`VEL5024: A <form> ref requires Element? or a parent element type so cleanup can
restore null`）；`setError`/`errors`/`focusFirstError`/`setPending`/`reset`/
`values`/`textValue`/`numberValue` 全部按 web-api 的签名编译通过。

**bind 3 项**：`computed`、`const`、prop 三种目标都被
`VEL5019: bind:value requires a writable reactive location: a state name, or a
field or index path on one such as bind:value={form.name} or
bind:value={items[0]}` 拒绝；`bind:group` 在 radio 与 checkbox 上分别接受
`string` 与 `List<string>` state。

**velar/browser 4 项**：`after`/`every` 返回幂等停止函数、停止后不再触发；
`every(0ms)` → `every requires a Duration above 0ms through 2147483647ms`；
`after(-1ms)` → `after requires a Duration from 0ms through 2147483647ms`；
纯函数在无宿主时照常运行（宪章「a `velar test` that has no host still runs the pure
functions in such a module」为真）。

**velar/app 3 项**：`onError` 返回显式清理函数、报告五个字段齐全
（`error`/`phase`/`detail`/`component`/`timestamp`）· `reportError(error, phase,
detail)` 三参形态编译通过 · 相的取值实测覆盖 `mount`/`render`/`watch`/`cleanup`/
`resource`/`action`/`update`/`timer`/`detached`。

### 横切 —— 格式化与 `velar fix`（约 10 个探针）

**0.28.0 I-D1 已闭合 2 项**：工程之外的 JSX 文件不再被改写 ——

```text
--- format (out of project) ---
velar format: /…/lone/j.vel does not parse, so it was left unchanged; fix the syntax first
/…/lone/j.vel:1:8 error VEL2026: Unknown declaration keyword 'component'; …
--- after ---
export component Panel(userId: string):
    return <p title="t">{userId}</p>
```

工程**之内**的解析失败文件同样保持原样（`format` 与 `format --check` 两条路径都拒绝
写回）。

**格式幂等 4 项**：Look 块、`keyframes:`（含 `50%, 75%:` 共享体）、JSX（属性折行、
块形态、`{}` 洞保持自己的行）、`velar fix` 的产物 —— 全部一次成型、第二次运行零改动、
改后仍编译。

**JSX 排版语义 2 项**：**有文本子节点**的元素即使超过 120 列也留在一行
（`<p>alpha <b>beta</b> gamma …</p>` 未被折），**没有文本子节点**的元素折成块形态 ——
正是宪章「markup drops a line break with its indentation but keeps a written space」
所要求的「不改变意义」。

**`velar fix` 2 项**：`color("var(--ui-color)")` → `token("--ui-color")` 并把 `token`
带进 import（`fixed VEL5042: Use token("--ui-color")`，`0 diagnostics remain`）；
advisory（A12/A16）**不**被 `fix` 应用，与 CLI 参考「anything requiring a judgment
call stays a diagnostic … and that includes every advisory」一致。

> 观察（不立项）：`fix` 之后 `import {color, token} from "velar/look"` 里的 `color`
> 已经没有用处，但未被移除，也没有任何未使用导入的提示。
>
> 观察（不立项，非 Web 面）：`Promise.resolve(1)` 与 `Math.floor(1.5)` 在 Core 与 Web
> 模块里都报 `VEL4001: Object has no field 'resolve'` / `'floor'` —— 永久命名空间被
> 当成「Object」，消息既不点名 `Promise`/`Math` 也不给名册。Core 面的事，留给 Core。

---

## 修复优先序（建议，不含实施）

1. **LC-D1（`publicConfig` 与清单不符时全静默）** —— 唯一一条会让**构建成功的应用
   打不开首屏**、而且失败早于 `velar/app` 装好、连 fatal state 都轮不到的缺口。
   清单与类型两边在编译期都在手上。
2. **ST-D1（`watch <resource>:` 永不触发）** —— 作者写下的代码一次都不会跑，零诊断；
   VEL5064 的消息里已经写着正确答案（「or a resource **field**」），缺的是判据覆盖。
3. **ST-D2 + ST-U1（`finally` / `for` / `try` 里的自写）** —— 一起处理：要么把
   「体内必然执行的写」并进 VEL5077 的判据，要么把「只有语法顶层算数」写进宪章 §15
   并说明为什么 `finally` 留给运行时。0.28.0 的 H-D1/H-U2 是同一对。
4. **LC-C1（`tick()` 的拒绝承诺只在非浏览器宿主为真）** —— 纯文档改，但它是**测试
   能不能信**的那条承诺：今天 `await tick()` 在浏览器里会静静跨过一次坏更新。
   宪章 §16 与 web-api「`mount` and `tick`」两处都要加上宿主条件。
5. **LK-I1（`look:`/`keyframes:` 与 `<` 不共用一张位置表）** —— 需要一次实施层裁决：
   把三个位置补给 `look:`，还是把宪章 §17 那句「one table, two constructs」收回。
   顺带去掉集合位/记录位的 VEL2001 级联。
6. **LC-C2（动态区域首屏失败没有可访问的 fatal state）** —— 要么让区域失败也留下
   一个 `role="alert"` 的可访问标记，要么把 web-api 那句「covers every initial-render
   path」缩到它真正覆盖的路径上。
7. **LK-C1 / LK-C2（宪章 §17 关于具名实参的两句话都不真）** —— 纯文档改，代价最低；
   LK-C2 还与 web-api 直接打架，两份规范里只能留一句。
8. **JX-C1（插值区域的重建条件比文档窄）** —— 文档据此给了一条今天不必要的改结构
   建议，先把句子改对；若认为文档描述才是想要的语义，那是一次语义裁决。
9. **LK-C3 / LK-C4（`min`/`max`/`clamp` 不吃百分比；`strokeLinecap` 的名单）** ——
   前者是能力缺口（CSS 里 `min()` 的首要用法在 Look 里没有拼写），后者是一句话。
10. **JX-I1 / JX-I2 / JX-I3 / LK-I2（四处双报与一句不真的级联）** —— 一批去重：
    具名实参调用组件只留一条；组件体里的 `match` 不再报「`return` 只能用在函数里」；
    属性展开点名「展开」并给出改法；停位里的越界具名实参只报 VEL5042。
11. **LC-I1 / LC-I2 / LK-I3（三处措辞）** —— `velar/browser` 的「宿主不在」统一成
    一句（照 `velar/storage` 的样子）；`Component<Props>` 上的 `ref` 拒绝改说契约缺
    第二个类型实参；`hsl` 的百分比参数在消息里说明「写 50，不写 50%」。
12. **UNDEFINED 九条成文** —— ST-U2（`watch <computed>` 写来源 state 的代价）·
    ST-U3（上限触发后那条 watch 永久停摆）· ST-U4（类实例在 state 里不深度反应，
    读它的 `computed` 会永久陈旧）· JX-U1（重复键让整个应用起不来）·
    LC-U1（挂载/清理的确切次序）· LC-U2（重复 `mount` 上报而不抛）·
    LK-U1（`linearGradient` 的方向是 `Angle`）· LK-U2（单停位 keyframes 合法）·
    ST-U1（见第 3 条）。

---

## 本文的出身

本审计由 P6 审计代理在编排者的 D115 §五 P6 排期下完成，隔离 worktree
`/private/tmp/velar-d114/audit-p6b`（分支 `audit/p6-audit-p6b`，HEAD `206136a`
= main 于 0.29.0），只读仓库、只写本账本；未派实施代理，未提交任何 git 写操作，
未运行 `npm run build*` 或 `npm test`。探针工程与草稿文件在
`/private/tmp/velar-d114/scratch-p6b/`，不入仓。同一 worktree 上另有一名 Node 面
审计代理并发只读工作，两者均不构建、不改文件。
