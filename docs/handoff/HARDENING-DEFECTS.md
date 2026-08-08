# 0.10.0 硬化：确认缺陷清单（2026-08-09 对抗性搜捕）

六路猎手 · 380+ 个探针程序 · 48 条原始发现 · **41 条经对抗性复核确认**（blocker 4 / major 29 / minor 8）。

复核默认立场是驳回：必须自己复现并对照 charter 才成立；设计分歧与既定排除项不计。

**修完之前不发布。** 探针程序保留在搜捕 scratch 目录。

## 修复与复核状态

41 条缺陷已按第七 A 节的两波编排全部修复，并为每条缺陷建立了永久回归覆盖：

- `tests/hardening-flow.test.ts`：#1、#5、#6、#23、#24
- `tests/hardening-cli.test.ts`：#7、#31、#33、#38
- `tests/hardening-reactivity.test.ts`：#2–#4、#25–#30
- `tests/hardening-language.test.ts`：#8、#11–#22、#34–#37、#40、#41
- `tests/hardening-web-syntax.test.ts`：#9、#10、#32、#39

两波合并后重新执行了六路对抗性搜捕。结果为 **blocker 0 / new major 0**；复搜捕额外发现并关闭了三处原缺陷的变形：JSX 布局文本中的普通引号（#9）、Unicode 空串分割与空搜索替换（#15/#20），以及跨解构、条件、浅容器、函数返回和传递 helper 的 prop 所有权绕过（#28）。#28 的独立复核覆盖 14 个非法 mutation、15 个合法对照、37 个 Chromium 场景与 4 个 keyed 压力场景，未发现误拒。

最终门禁：`npm run check`、425/425 测试、包消费者验收、开发/生产/外部预览浏览器矩阵，以及四个示例在 Chromium、Firefox、WebKit 下的 48 个浏览器测试全部通过。发布动作仍保持中止；本轮没有创建 tag、提交、推送或执行 npm publish。

## 1. [blocker] Loop back edges never invalidate narrowing facts: a write inside a for/while body is invisible to the next iteration

- **类型**：unsound-accept
- **期望**：Charter section 5: a fact "is invalidated by exactly two things: an assignment to that location ..., and merging branches where an assignment can reach the same location." The `s = null` at the end of the body reaches the top of the body through the loop back edge, so `out += s` on iterations 2 and 3 must be rejected with VEL4001 ("Use optional access '?.' for string?"), exactly as the identical w
- **实际**：$ node .../cli.ts check n27_str_concat.vel
Checked 1 module from n27_str_concat.vel

$ node .../cli.ts run n27_str_concat.vel
[anullnull]

The program compiles clean and silently produces the string "anullnull" — JavaScript's null-to-text coercion, one of the exact traps the charter says the language removes.
- **复核**：CONFIRMED — I tried to refute this and could not. Every refutation avenue closes against the compiler.

1) Reproduces with the real compiler. `n27_str_concat.vel` checks clean (exit 0) and prints `[anullnull]`. The contrast case `n10_same_iter.vel` (identical write, but placed *before* the read in the same iteration) is correctly rejected with VEL4001 at 5:15 — so the analyzer knows this write inv

<details><summary>复现</summary>

```
File: /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/v4_smallest_silent.vel (5 lines)

let s: string? = "a"
if s != null:
    for i in [1, 2]:
        print(s + "!")
        s = null

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check v4_smallest_silent.vel
Checked 1 module from v4_smallest_silent.vel        # exit 0, no diagnostic

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run v4_smallest_silent.vel
a!
null!

Expected: VEL4001 on `s + "!"` (the `s = null` from iteration 1 reaches that read through the back edge). Actual: clean compile, and JavaScript null-to-text coercion produces "null!".

Control that proves the analyzer is otherwise fine (same directory, v3_while_cond_fact.vel): `while x != null:` with `x = null` at the end of the body compiles AND runs correctly, because the loop head genuinely re-establishes the fact each iteration. The bug is confined to facts the loop head does not re-derive.
```

</details>

## 2. [blocker] Iterating an empty List/Map/Set registers no dependency, so the first item added never renders

- **类型**：runtime-wrong
- **期望**：Charter line 1083: "`state` is deeply reactive. Assigning the binding, mutating a `List`, `Set`, or `Map` ... all publish the affected reactive reads." `items.append("first")` must invalidate the computed, so `label` becomes "first;".
- **实际**：items.size    = 1
computed label= ''
✗ chromium :: src/repro.browser.test.vel :: test_empty_iteration_registers_no_dependency
Expected "" to be "first;"

0 passed, 1 failed
- **复核**：CONFIRMED — I reproduced it with the real compiler and could not refute it on design grounds. It is also worse than the report states.

**1. Reproduces.** Built the project under the verify scratchpad and ran `node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts test . --browser chromium`. A 19-line program fails: `state items: List<string> = []`, a `computed` fed by a helper containing `

<details><summary>复现</summary>

```
Project at <scratch>/bughunt/verify/r2 with node_modules symlinked to the repo's.

velar.json:
{"formatVersion": 2, "entry": "src/main.vel", "outDir": "dist",
 "extensions": ["@velarscript/web"], "web": {"title": "r2"}}

src/main.vel (19 lines):
def joinLoop(source: List<string>) -> string:
    let out = ""
    for item in source:
        out += item
    return out

component App:
    state items: List<string> = []
    computed label: string = joinLoop(items)

    def add():
        items.append("x")

    return <main>
        <p data-label>{label}</p>
        <button data-btn on:click={add}>add</button>
    </main>

mount(<App />, "#app")

src/repro.browser.test.vel:
import {expect} from "velar/test"
import {browser} from "velar/web-test"

async def test_for_loop_over_empty_list_never_updates():
    await browser.open("/")
    await browser.click("button")
    expect(await browser.text("[data-label]")).toBe("x")

Command:
node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts test . --browser chromium

Result: Expected "" to be "x"  (0 passed, 1 failed). Never recovers on further clicks.

--- Stronger variant: NON-empty Map, two-slot for, new key missed ---
src/main.vel:
def joinPairs(source: Map<string, number>) -> string:
    let out = ""
    for id, score in source:
        out += id + ";"
    return out

component App:
    state scores: Map<string, number> = Map([["Ada", 9]])
    computed label: string = joinPairs(scores)

    def add():
        scores.set("Lin", 
```

</details>

## 3. [blocker] Two-slot `for key, value in map` never tracks the iterate key and hands out raw keys: new entries, clear(), and writes through the key slot are all invisible

- **类型**：runtime-wrong
- **期望**：After `entries.set("b", "2")` the label is "a=1;b=2;"; after `entries.clear()` the label is "". Single-slot `for key in map` gets this right, so the two-slot form must too.
- **实际**：initial  label='a=1;' size=1
after set label='a=1;' size=2
after clr label='a=1;' size=0
✗ chromium :: src/repro.browser.test.vel :: test_two_slot_map_loop_misses_new_keys_and_clear
Expected "a=1;" to be ""
- **复核**：CONFIRMED — I reproduced it with the real compiler and it contradicts the documented design.

Reproduction (my own probe, /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/r3, `cli.ts test . --browser chromium`), with a single-slot reader added as a control on the same Map:
  initial  two-slot='a=1;' single='a;'   size=1
  after

<details><summary>复现</summary>

```
Project: velar.json {"formatVersion":2,"entry":"src/main.vel","outDir":"dist","extensions":["@velarscript/web"],"web":{"title":"r3"}}, node_modules symlinked to the repo's.

src/main.vel:
def render(source: Map<string, string>) -> string:
    let out = ""
    for key, value in source:
        out += key + "=" + value + ";"
    return out

component App:
    state entries: Map<string, string> = Map([["a", "1"]])
    computed label: string = render(entries)

    def addKey():
        entries.set("b", "2")

    return <main>
        <p data-label>{label}</p>
        <button data-btn="add" on:click={addKey}>add</button>
    </main>

mount(<App />, "#app")

src/repro.browser.test.vel:
import {expect} from "velar/test"
import {browser} from "velar/web-test"

async def test_new_key_is_invisible():
    await browser.open("/")
    await browser.click('[data-btn="add"]')
    expect(await browser.text("[data-label]")).toBe("a=1;b=2;")

Run: node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts test . --browser chromium
Fails with: Expected "a=1;" to be "a=1;b=2;". Changing the loop to the single-slot `for key in source` (reading `source.get(key)` or just the key) makes the same test pass. `entries.clear()` is stale the same way; `entries.set("a","9")` on an existing key and `entries.remove("a")` do repaint.
```

</details>

## 4. [blocker] Deep reactivity is silently lost for object destructuring, `match` record/List patterns, and record spread

- **类型**：runtime-wrong
- **期望**：All four reads are consumers of the same `tasks[0].done` property, so per charter §15 ("`state` is deeply reactive. Assigning ... a field anywhere inside a nested record all publish the affected reactive reads" / "Record properties and collection keys are tracked independently, so changing `task.done` invalidates consumers of that property") all four paragraphs must show `:done` after the click. 4
- **实际**：✓ chromium :: src/app.browser.test.vel :: test_member_read
✗ chromium :: src/app.browser.test.vel :: test_destructure_read
Expected "destructure:open" to be "destructure:done"
✗ chromium :: src/app.browser.test.vel :: test_match_record_pattern_read
Expected "match:open" to be "match:done"
✗ chromium :: src/app.browser.test.vel :: test_record_spread_read
Expected "spread:open" to be "spread:done"


- **复核**：CONFIRMED — real defect, severity blocker. I tried hard to refute it and could not.

1) REPRODUCED with the real compiler. The reported web4 project gives exactly the claimed output (1 passed / 3 failed: destructure, match record pattern, spread all stale; member read updates). I then reduced it much further than the report: the List, `match`, and spread are all incidental. The minimal failing pro

<details><summary>复现</summary>

```
Smallest reproducer (19 lines, no List, no `match`, no spread) at
/private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/dr3/

src/main.vel:
```
type Box:
    on: bool

export component Board:
    state box: Box = {on: false}

    def label() -> string:
        const {on} = box
        return on ? "on" : "off"

    def flip():
        box.on = not box.on

    return <section data-board>
        <p data-out>{label()}</p>
        <button type="button" data-flip on:click={flip}>flip</button>
    </section>

mount(<Board />, "#app")
```

src/app.browser.test.vel:
```
import {expect} from "velar/test"
import {browser} from "velar/web-test"

async def test_destructured_read_updates():
    await browser.open("/")
    await browser.waitFor("[data-board]")
    await browser.click("[data-flip]")
    expect(await browser.text("[data-out]")).toBe("on")
```

velar.json: {"formatVersion":2,"entry":"src/main.vel","outDir":"dist","publicDir":"public","extensions":["@velarscript/web"],"web":{"title":"DR1"}}

`node packages/cli/src/cli.ts check dr3` -> "Checked 1 module from dr3" (no diagnostic).
`node packages/cli/src/cli.ts test dr3 --browser chromium` -> Expected "off" to be "on"; 0 passed, 1 failed.

Swapping `const {on} = box` for `box.on` makes the same program pass.
```

</details>

## 5. [major] Same loop back edge silently returns null from a function declared -> string

- **类型**：runtime-wrong
- **期望**：`pick` declares `-> string`, and charter section 7 says "A function with a non-null result must declare it and return on every reachable path." Either the `return x` must be rejected (x is provably null on iteration 2) or the function must never yield null. Callers are entitled to treat the result as a non-null string.
- **实际**：$ node .../cli.ts check n35_contract_break.vel
Checked 1 module from n35_contract_break.vel

$ node .../cli.ts run n35_contract_break.vel
[null]

A `-> string` function returns `null`, and the value flows into a `const out` typed `string` with no diagnostic anywhere.
- **复核**：REPRODUCED with the real compiler, and it contradicts the documented design rather than following it.

1. Reproduction. The reporter's n35_contract_break.vel checks clean (exit 0) and prints `[null]`. I reduced it to p8_final.vel (above) and confirmed the null escapes the `-> string` contract into a caller-side `const out` typed `string`, where the first method call throws a runtime TypeError whos

<details><summary>复现</summary>

```
File: /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/p8_final.vel

def pick(x: string?) -> string:
    let s = x
    if s == null:
        return "fb"
    for i in [1, 2]:
        if i == 2:
            return s
        s = null
    return "fb"

const out = pick("hi")
print(out.upper())

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check p8_final.vel
Checked 1 module from p8_final.vel        # exit 0, no diagnostic

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run p8_final.vel
TypeError: String methods require a string receiver    # exit 1

Swap `print(out.upper())` for `print(f"[{out}]")` and it runs to completion printing `[null]` — a `-> string` function yielding null with no diagnostic anywhere.
```

</details>

## 6. [major] Same loop back edge lets a validated `unknown` de-validate, and JavaScript `undefined` reaches an f-string as the text "undefined"

- **类型**：runtime-wrong
- **期望**：Two charter rules are violated. Section 5/12: after `raw = 5` the `is User` fact for `raw` must be invalidated, so `raw.name` on iteration 2 must be rejected with "Cannot access 'name' on unknown without validation" (the compiler does emit exactly that message when the write precedes the read — see u04_unknown_use.vel). Section 18: "Every expression typed as optional, null, or unknown translates J
- **实际**：$ node .../cli.ts check n34_unknown_escape.vel
Checked 1 module from n34_unknown_escape.vel

$ node .../cli.ts run n34_unknown_escape.vel
name=Ada
name=undefined

An unvalidated value is read through a stale `is User` fact, and the word "undefined" is printed as program output.
- **复核**：CONFIRMED — reproduces exactly as reported, and it contradicts the documented design rather than following it.

**Reproduction (real compiler, unmodified repo):**
`check` on `/private/tmp/.../bughunt/analyzer/n34_unknown_escape.vel` emits zero diagnostics; `run` prints `name=Ada` then `name=undefined`.

**Root cause (not the reporter misreading the design).** `/Users/mac/Documents/VelarScript/pack

<details><summary>复现</summary>

```
8 lines, no imports — /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/v7_minimal.vel

type User:
    name: string

let raw: unknown = {name: "Ada"}
if raw is User:
    for i in [1, 2]:
        print(f"name={raw.name}")
        raw = 5

check: "Checked 1 module" (no diagnostics)
run:   name=Ada
       name=undefined

Expected: the `raw = 5` write must invalidate the `is User` fact across the back edge, so iteration 2's `raw.name` is rejected (the analyzer does reject it when the write precedes the read in straight-line code — /private/tmp/.../verify/v1_writefirst.vel yields `VEL4001: number has no member 'name'`).

Smallest crashing variant (optional narrowing, 6 lines) — /private/tmp/.../verify/v4_optional_stale.vel:

type User:
    name: string

let u: User? = {name: "Ada"}
if u != null:
    for i in [1, 2]:
        print(f"name={u.name}")
        u = null

check: clean; run: prints name=Ada then TypeError: Cannot read properties of null (reading 'name')
```

</details>

## 7. [major] `import js unsafe` from a relative .js path compiles and builds clean but emits an unresolvable import

- **类型**：crash
- **期望**：Either the relative JavaScript asset is copied/rewritten so the emitted module resolves (the program prints `42`), or the compiler reports at check time that a relative `import js unsafe` target cannot be emitted. A clean `check` followed by a clean `build` that produces a module which cannot be loaded is the worst of both.
- **实际**：$ node .../cli.ts check main.vel
Checked 1 module from main.vel

$ node .../cli.ts run main.vel
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/private/tmp/.../relproj/.velar/run-n5tpiA/helper.js' imported from /private/tmp/.../relproj/.velar/run-n5tpiA/main.js
Did you mean to import "../../helper.js"?
    at finalizeResolu
- **复核**：I tried to refute this and could not.

REPRODUCES. `print(f"a\rb" == "a\rb")` prints `false` with no diagnostic from `check` or `run`. Verified in a fresh file under verify/, not by trusting the reporter's artifacts.

ROOT CAUSE IS AS CLAIMED AND ISOLATED TO THE EMITTER. packages/compiler/src/emitter.ts:1580-1582 in `emitExpression`: a plain string LiteralExpression goes through `JSON.stringify` (

<details><summary>复现</summary>

```
One line, no interpolation needed. File /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/tiny.vel:

    print(f"a\rb" == "a\rb")

  $ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run tiny.vel
  false          <- expected true

`check` on the same file is clean (exit 0, "Checked 1 module"), so the divergence is silent.

Emitted JS (from `build`, viewed with cat -v) shows the CR going into the template literal raw:

    const interp = `a^Mb`;      // f-string  -> CR is cooked to LF by ECMAScript
    const plain  = "a\rb";      // plain     -> JSON.stringify, correct

Confirming the CR really became LF: `print(f"a\rb" == "a\nb")` prints true.

Two further confirmations run against the real compiler:

1. Realistic CRLF-protocol case (/private/tmp/.../verify/http.vel):
       const n = 5
       const head = f"HTTP/1.1 200 OK\r\nContent-Length: {n}\r\n\r\n"
       print(head.size)                                              -> 35 (expected 38)
       print(head == "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n") -> false
   All three CRs are dropped.

2. CRLF-saved source file (/private/tmp/.../verify/crlf_min.vel, written with newline=''):
       plain layout string a.size -> 8   ("one\r\ntwo", lexer preserves CR correctly)
       f layout string     b.size -> 7   ("one\ntwo")
       a == b                     -> false
   This isolates the fault to the emitter, not the lexer: the lexer hands bo
```

</details>

## 8. [major] f-strings silently convert carriage returns to newlines (emitter never escapes CR inside the template literal)

- **类型**：wrong-codegen
- **期望**：Charter section 3: ordinary inline and layout strings keep the familiar \\, \", \n, \r and \t escapes, and for layout strings "Internal line endings ... are preserved exactly". `f"a\rb"` must equal `"a\rb"` (both printed booleans: true then false), and the CRLF layout f-string must have the same size (8) and content as the plain one (a == b true).
- **实际**：$ node .../cli.ts run final_cr.vel
false
true

$ tail -8 final_cr.js | cat -v
const plain = "a\rb";

const interp = `a^Mb`;

console.log((plain === interp));

console.log((interp === "a\nb"));

$ node .../cli.ts run crlf01.vel
8
7
false

$ tail -12 crlf01.js | cat -v
const a = "one\r\ntwo";

const b = `one^M
two`;
- **复核**：CONFIRMED. Reproduced all three commands exactly as reported with the real compiler: check exits 0, run dies with ERR_MODULE_NOT_FOUND in .velar/run-XXXX/, and build exits 0 producing dist/main.js with `import { value } from "./helper.js";` emitted verbatim and helper.js never copied.

Root cause located: packages/cli/src/project.ts:225 -- `if (dependency.javascript) continue;` -- short-circuits t

<details><summary>复现</summary>

```
Two files in an empty directory (no velar.json needed):

helper.js:
  export function value() { return 42; }

main.vel:
  import js unsafe {value} from "./helper.js"

  print(str(value()))

Commands from that directory:
  node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check main.vel
    -> "Checked 1 module from main.vel", exit 0
  node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run main.vel
    -> Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<dir>/.velar/run-XXXXXX/helper.js'
       imported from '<dir>/.velar/run-XXXXXX/main.js'

With a velar.json present, `build .` also exits 0 and writes dist/main.js containing
`import { value } from "./helper.js";` verbatim while helper.js is never copied, so
`node dist/main.js` fails the same way.

Stronger variant showing this is NOT the `unsafe` contract -- the fully checked bridge
form also compiles clean and emits the same unloadable module:

  extern module "./helper.js":
      export def value() -> number

  import js {value} from "./helper.js"

  print(str(value()))
```

</details>

## 9. [major] A charter-conformant layout string cannot be used inside a JSX `{...}` expression container

- **类型**：wrong-reject
- **期望**：Charter section 3: "Its first nonblank content line establishes a structural indentation margin, and a quote back at the opening line's indentation closes the value." The opening quote sits on a line indented 8 spaces and the closing quote is at 8 spaces, so this is a well-formed layout string and the component should compile with the child text "plain content". Charter section 14 explicitly says 
- **实际**：$ node .../cli.ts check web
/private/tmp/.../web/main3.vel:3:21 error VEL1003: Unterminated layout string; close it with a quote at the opening line's indentation
        <p id="p1">{"
                    ^

/private/tmp/.../web/main3.vel:5:1 error VEL1004: Layout string lines must keep the indentation established by the first content line
        "}</p>
^^^^^^^^
- **复核**：CONFIRMED — I tried hard to refute this and could not.

1. Reproduces with the real compiler, on a freshly created Web project (velar.json copied from examples/web-counter, node_modules symlinked), not just the reporter's tree:

   /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/jsxmin/main.vel
   `node packages/cli/src/cli.ts

<details><summary>复现</summary>

```
Web project (velar.json with "extensions": ["@velarscript/web"], entry main.vel), main.vel:

export component P():
    return <p>{"
        hi
    "}</p>

mount(<P />, "#app")

$ node packages/cli/src/cli.ts check <project-dir>
main.vel:2:16 error VEL1003: Unterminated layout string; close it with a quote at the opening line's indentation
main.vel:4:1  error VEL1004: Layout string lines must keep the indentation established by the first content line

Expected: compiles, child text "hi" (charter §3: closing quote at the opening line's indentation closes the value; the opening `"` is on a line indented 4 and the closing `"` is at 4).

Contrast A — dedent the closing quote to column 0 (the spelling §3 calls wrong) and it compiles, emitting `line one\nline two` for a two-line body:

export component P():
    return <p>{"
        hi
"}</p>

mount(<P />, "#app")
$ ... check → Checked 1 module

Contrast B — Core, same shape inside a call's parentheses (the equivalence charter §14 promises), works:

def wrap(t: string) -> string:
    return t

def main() -> null:
    const value = wrap("
        hello
    ")
    print(value)

main()
$ node packages/cli/src/cli.ts run core_paren.vel → hello

Probe files: /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/jsxmin/ (reject), .../jsxstr3/ (accepted col-0 + build), .../corestr/core_paren.vel (Core baseline).
```

</details>

## 10. [major] Backslashes in JSX attribute string values are silently deleted (neither HTML nor VelarScript escape semantics)

- **类型**：wrong-codegen
- **期望**：Either HTML/JSX semantics (backslash is an ordinary character, attribute value = C:\new\table) or VelarScript string semantics (\n and \t decode, giving C: LF ew TAB able). Charter section 3 lists \\, \", \n, \r, \t as the escapes strings keep.
- **实际**：$ node .../cli.ts check web
Checked 1 module from web

$ python3 -c "..."
z(a,"id","p1"),z(a,"data-path","C:newtable"),a.append(document.createT
- **复核**：REPRODUCED with the real compiler, and I could not refute it on any of the three available grounds.

1. Reproduction. The reporter's case reproduces exactly: `data-path="C:\new\table"` emits `z(a,"data-path","C:newtable")`. I reduced it further to the strongest ordinary-code case, a standard HTML form-validation attribute: `<input pattern="\d{3}" />` emits `ge(s,"pattern","d{3}")`. `check` reports

<details><summary>复现</summary>

```
Web project (velar.json with "extensions": ["@velarscript/web"]), main.vel:

    export component Probe():
        return <input pattern="\d{3}" />

    mount(<Probe />, "#app")

Commands:
    node packages/cli/src/cli.ts check web   # -> "Checked 1 module from web" (ZERO diagnostics)
    node packages/cli/src/cli.ts build web
    python3 -c "import glob; s=open(glob.glob('web/dist/assets/main-*.js')[0]).read(); i=s.find('pattern'); print(repr(s[i-15:i+40]))"

ACTUAL:   ge(s,"pattern","d{3}")      <- backslash silently deleted
EXPECTED: pattern value "\d{3}" (HTML/JSX semantics), or a diagnostic.

The corruption is silent and the result is still a VALID regex that matches different input (literal letter "d" instead of a digit), so the form validates wrong at runtime with nothing to notice at compile time.
```

</details>

## 11. [major] Whitespace-only lines inside a layout string are trimmed, contradicting the charter's "no trim pass" rule

- **类型**：runtime-wrong
- **期望**：Charter section 3: "The opening and closing newlines and the structural margin are syntax, not text. Internal line endings, blank lines, quotes, and indentation beyond that margin are preserved exactly; there is no common-dedent or trim pass." The middle line has 8 spaces and the margin is 4, so 4 spaces are "indentation beyond that margin" and must survive: "one\n    \ntwo".
- **实际**：$ node .../cli.ts run final_blank.vel
"one\n\ntwo"
- **复核**：CONFIRMED. I reproduced it end-to-end with the committed compiler (formatter.ts is not among the dirty files in `git status`, so this is committed behavior).

Reproduction (fresh file, not the reporter's already-formatted artifact — the copy at bughunt/strings/fmt3/mk.vel was left in its post-format broken state, so I rebuilt the original from the printf):
- `run mk2.vel` -> prints `all:` / TAB `e

<details><summary>复现</summary>

```
Five lines; line 3 begins with a single literal TAB.

  printf 'if true:\n  const t = "\n\tx\n  "\n  print(t)\n' > final.vel

  $ node packages/cli/src/cli.ts run final.vel
  x                                    # exit 0, no diagnostics

  $ node packages/cli/src/cli.ts format final.vel
  Formatted final.vel                  # opening/closing quote lines 2sp -> 4sp, "\tx" untouched

  $ node packages/cli/src/cli.ts run final.vel
  final.vel:2:15 error VEL1003: Unterminated layout string; close it with a quote at the opening line's indentation
  final.vel:3:1  error VEL1002: Tabs are not allowed for indentation

  $ node packages/cli/src/cli.ts format final.vel   # second run: "\tx" becomes " x", print(t) dedented to 1 space -- tab lost

File: /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/final.vel
```

</details>

## 12. [major] Deeply nested f-strings crash the compiler with a JS stack overflow instead of the nesting-limit diagnostic

- **类型**：crash
- **期望**：A diagnostic. The lexer already enforces this class of limit for other nesting: `const a = ((((...1...))))` with 2000 parens gives "VEL1006: Delimiter nesting cannot exceed 512 levels", and 600 nested brackets gives the same. Interpolation nesting should hit an equivalent bounded diagnostic rather than an internal error.
- **实际**：$ node .../cli.ts check deep_400.vel
Checked 1 module from deep_400.vel

$ node .../cli.ts check deep_450.vel
velar: Maximum call stack size exceeded

$ node .../cli.ts check paren.vel   # 2000 nested parens, for contrast
/private/tmp/.../paren.vel:1:524 error VEL1006: Delimiter nesting cannot exceed 512 levels
- **复核**：CONFIRMED. Reproduced with the real compiler at /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/. The reported program prints "Hello NAME" / "cost: $5" instead of "Hello $&" / "cost: $$5". A wider probe confirms exactly the four JS GetSubstitution tokens are interpreted: "$$" -> "$", "$&" -> match, "$`" -> prefix ("hello world

<details><summary>复现</summary>

```
def main() -> null:
    print("a".replace("a", "$&"))
    return null

main()

# node packages/cli/src/cli.ts run min.vel
# expected: $&
# actual:   a
```

</details>

## 13. [major] .replace()/.replaceAll() interpret JavaScript $ substitution patterns in the replacement string

- **类型**：runtime-wrong
- **期望**：Both arguments of `replace(from, to)` / `replaceAll(from, to)` are plain strings. The charter (§7 "Checked value methods") says these are "compiler-owned operations, not JavaScript prototype calls", and docs/standard-library.md contrasts the literal `.has()`/`.startsWith()`/`.endsWith()` family with the pattern family, where only `replaceMatches` is described as replacing "with one literal string"
- **实际**：Hello NAME
cost: $5

(`$&` expanded to the matched text "NAME"; `$$` collapsed to a single `$`.)
- **复核**：REPRODUCED with the real compiler, and it contradicts a documented guarantee.

1. Reproduction. `node packages/cli/src/cli.ts run p66_budget.vel` prints "replaceAll returned without a RangeError", then dies later inside `__velarStringSize`. Reduced to a smaller program that removes the `.size` read entirely (so nothing else can be blamed for the throw): `"a".repeat(5794).replaceAll("a", "$'")` ret

<details><summary>复现</summary>

```
File: /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/min.vel

def main() -> null:
    const blown = "a".repeat(5794).replaceAll("a", "$'")
    print("replaceAll returned; no RangeError")
    return null

main()

Command:
node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run min.vel

Expected: RangeError "String.replaceAll output cannot exceed 16 MiB" before the result is allocated.
Actual: prints "replaceAll returned; no RangeError" and exits 0. The returned string is 16,782,321 code units (~32 MB), 5,105 over the 16,777,216 budget, while __velarTextReplacementOutputUnits predicted 11,588.

Same root cause, wrong results (no size needed):
File: .../verify/lit.vel

def main() -> null:
    print("ab".replaceAll("a", "$&$&"))   # prints "aab",  expected "$&$&b"
    print("ab".replaceAll("a", "$$"))     # prints "$b",   expected "$$b"
    print("ab".replaceAll("b", "[$`]"))   # prints "a[a]", expected "a[$`]"
    print("a-b".replace("-", "$'"))       # prints "abb",  expected "a$'b"
    return null

main()
```

</details>

## 14. [major] .min(), .max(), .sorted() and .sorted(by=) throw a TypeError on Infinity, which ordinary division produces

- **类型**：runtime-wrong
- **期望**：The charter's List table says `min()`, `max()` return the "Smallest/largest number or string, or `null` when empty" — no finiteness restriction — and Infinity is a first-class VelarScript number (`velar/math` exports `infinity`). Expected output:
speeds=25,Infinity,50
fastest=Infinity
- **实际**：speeds=25,Infinity,50
file:///.../.velar/run-tq9Ot1/p56_div.js:246
function __velarOrderedListValue(value, name, kind = null) { const current = typeof value; if ((current !== "string" && current !== "number") || (current === "number" && !Number.isFinite(value)) || (kind !== null && current !== kind)) throw new TypeError(name + " requires uniform finite numbers or strings"); return current; }

Type
- **复核**：I tried to refute this and could not. It reproduces exactly as reported, and the deciding evidence is that the codebase contains two validators for the same conceptual rule that disagree with each other.

REPRODUCTION (all confirmed with the real compiler):
- The reported p56_div.vel prints `speeds=25,Infinity,50` then dies on `.max()`.
- Minimal form, no imports: `[1, 100 / 0].max()` -> `TypeErro

<details><summary>复现</summary>

```
def main() -> null:
    const xs: List<number> = [1, 100 / 0]
    print(f"max={xs.max() ?? -1}")
    return null

main()

Command:
node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run v2_min.vel

Expected: max=Infinity
Actual:   TypeError: List.max requires uniform finite numbers or strings

Substituting xs.min(), xs.sorted(), or xs.sorted(by=v => v) for xs.max() reproduces identically ("List.min", "List.sorted()", "List.sorted by"). No imports are needed — ordinary division supplies the Infinity.
```

</details>

## 15. [major] padStart/padEnd count UTF-16 code units instead of code points and can emit lone surrogates

- **类型**：runtime-wrong
- **期望**：docs/standard-library.md: "`size`, `char(index)`, and `slice(start=0, end=size)` use Unicode code points, matching string iteration rather than JavaScript UTF-16 units." `padStart(size, fill)` is documented in the same code-point string surface (charter §7 table), so `x.padStart(n).size` should be >= n and the result should never contain an unpaired surrogate. Expected:
padStart(4, dash) = [---😀] 
- **实际**：padStart(4, dash) = [--😀] size=3 (expected size 4)
padStart(6, emoji) size=5 (expected size 6)
char(1).size=1 equalsEmoji=false equalsA=false

(char(1) is a lone high surrogate: a size-1 string equal to neither the emoji nor any letter. Confirmed independently: node -e '...' reports "😀\ud83dabc", length 6, [...s].length 5, isWellFormed() false.)
- **复核**：I tried to refute this and could not.

1. It reproduces exactly as reported with the real compiler. `"😀".padStart(4, "-").size` is 3, `"abc".padStart(6, "😀").size` is 5, and the padded string genuinely contains an unpaired surrogate (byte dump shows U+FFFD substitution on write, which only happens for a lone surrogate). A `for c in padded` loop independently counts 3, so the language's own iterati

<details><summary>复现</summary>

```
Smallest program showing the width defect (2 lines of body):

    def main() -> null:
        print(str("😀".padStart(4, "-").size))
        return null

    main()

Run: node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run v_pad_min.vel
Expected: 4 (or more). Actual: 3.

Confirmed the language's own two code-point views agree with each other and disagree with pad:

    const padded = "😀".padStart(4, "-")
    let n = 0
    for c in padded:
        n = n + 1
    print(f"loopCount={n} size={padded.size} asked=4")
    -> loopCount=3 size=3 asked=4

Second symptom (needs a non-BMP *fill*, obscure on its own) — `"abc".padStart(6, "😀")` yields a string holding an unpaired high surrogate. Byte dump of stdout: f09f9880 efbfbd 616263, i.e. 😀 + U+FFFD + "abc" — the U+FFFD is Node transcoding the lone surrogate on write, proving the in-memory string is malformed.

Contrast inside the same text surface (velar/text `truncate`, packages/cli/src/standard-modules.ts:680) which IS code-point correct:

    |apple.....| size=10
    |日本語テキスト...| size=10
    |🙂🙂......| size=8     <- padEnd(10) produced size 8
    |ok........| size=10
```

</details>

## 16. [major] .sorted(by=selector) statically accepts key types that sortBy/minBy/maxBy reject

- **类型**：unsound-accept
- **期望**：docs/standard-library.md, in the paragraph that also governs `List.sorted(by=selector)`: "Ordering never uses JavaScript's mixed-type relational coercion. The compiler rejects known boolean/record/optional/mixed key results..." A compile-time diagnostic, matching the one `sortBy` already emits for the identical selector.
- **实际**：$ ... check p15_by_bool.vel
Checked 1 module from p15_by_bool.vel

$ ... run p15_by_bool.vel
TypeError: List.sorted by requires uniform finite numbers or strings
    at __velarOrderedListValue (file:///.../p15_by_bool.js:375:242)

Whereas the imported helper with the same selector is rejected statically (p16_sortby_bool.vel):
p16_sortby_bool.vel:5:21 error VEL4001: sortBy key must return only stri
- **复核**：CONFIRMED. I reproduced it independently with the real compiler at all three levels.

1. Runtime reproduction. bug_cr.vel reproduces exactly as reported (plain size = 4, interp size = 4, interp contains CR = false). bug_crlf_layout.vel reproduces (size=9 / has CR=false) while the byte-identical layout string without the `f` prefix (p43_crlf.vel) gives size=8 / has CR=true.

2. Codegen reproduction

<details><summary>复现</summary>

```
def main() -> null:
    const n = "N"
    print(str(f"x\r\ny{n}".size))
    print(str("x\r\ny".size + 1))

main()

Command: node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run min.vel
ACTUAL:   4  /  5
EXPECTED: 5  /  5   (x, CR, LF, y, N)

Even smaller variant showing silent corruption with no size change:

def main() -> null:
    const n = "N"
    print(str("\r" in f"a\rb{n}"))
    print(str("\n" in f"a\rb{n}"))

main()

ACTUAL:   false / true   (the CR was turned into an LF)
EXPECTED: true  / false
```

</details>

## 17. [major] Unknown string escapes silently drop the backslash instead of being diagnosed

- **类型**：unsound-accept
- **期望**：The charter §3 defines a closed escape set: "Ordinary inline and layout strings keep the familiar `\\`, `\"`, `\n`, `\r`, and `\t` escapes", and `r"..."` exists precisely so a literal backslash has one obvious spelling. An escape outside that set should be a lexer diagnostic (the charter's own discipline is that a removed/unsupported spelling "reports the direct current spelling", not that it sile
- **实际**：$ ... check f7_escape.vel
Checked 1 module from f7_escape.vel

$ ... run f7_escape.vel
emoji=[u{1F600}] size=8
hex=[x41] size=3
nul=[0] size=1
- **复核**：CONFIRMED, and the real hole is wider than the report states, so I raised severity from minor to major.

REPRODUCTION: `w.sorted(by=item => item.size > 0)` passes `check` and throws `TypeError: List.sorted by requires uniform finite numbers or strings` at run time; `sortBy(w, item => item.size > 0)` rejects the identical selector statically with `VEL4001: sortBy key must return only string or only

<details><summary>复现</summary>

```
Smallest program matching the claim (key type) — passes `check`, throws at run time:

def main() -> null:
    const w: List<string> = ["a"]
    print(w.sorted(by=item => item.size > 0).join(","))
    return null

main()

$ node packages/cli/src/cli.ts check p15_by_bool.vel
Checked 1 module from p15_by_bool.vel
$ node packages/cli/src/cli.ts run p15_by_bool.vel
TypeError: List.sorted by requires uniform finite numbers or strings

Sharpest demonstration of the underlying root cause (named args disable ALL checking on `sorted`, not just key types) — also passes `check`:

def main() -> null:
    const w: List<string> = ["b", "a"]
    print(w.sorted(by=5).join(","))
    return null

main()

$ node packages/cli/src/cli.ts check min.vel
Checked 1 module from min.vel
$ node packages/cli/src/cli.ts run min.vel
TypeError: List.sorted by must be a function

Ordinary-code case that motivates the major rating (optional key), verify/v13_optional_clean.vel:

type Row:
    name: string
    score: number?

def make(name: string, score: number?) -> Row:
    return {name: name, score: score}

def main() -> null:
    const rows: List<Row> = [make("a", 2), make("b", null)]
    print(rows.sorted(by=row => row.score).map(row => row.name).join(","))
    return null

main()

-> `Checked 1 module`, then `TypeError: List.sorted by requires uniform finite numbers or strings`, whereas `minBy(rows, row => row.score)` reports `VEL4001: minBy key must return only string or only number, received number?`.

P
```

</details>

## 18. [major] Set/List built from a host array keep raw JavaScript undefined: iteration yields null but .has(null) is false

- **类型**：runtime-wrong
- **期望**：`Set(values)` is a validating boundary (charter §8: it "copies one checked dense List" and rejects sparse/malformed lists), and the language normalises host `undefined` to `null` everywhere else it crosses in (object spread per charter §3, callback results per docs/standard-library.md). So the element should be `null` consistently: has(null)=true, and `values.has(null)`/`spread.has(null)` true.
- **实际**：size=3
has(null)=false
values[0] isNull=false
values[1] isNull=true
values[2] isNull=false
list has null = false
spread has null = false
- **复核**：CONFIRMED — reproduces with the real compiler, and it contradicts the documented design rather than instantiating it.

Reproduction. The reporter's bug_pad.vel reproduces exactly as claimed (padStart(5) size = 4, padEnd(5) size = 4). I reduced it to a two-line program that type-checks cleanly and uses the public named-argument form: "😀".padEnd(size=5, fill="-").size == 4. I also confirmed the ill-

<details><summary>复现</summary>

```
File /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/tiny.vel (the escape below is a literal U+1F600 in the file):

def main() -> null:
    print(str("😀".padEnd(size=5, fill="-").size))

main()

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run tiny.vel
4          <- expected 5

Corruption variant, /private/tmp/.../verify/lone.vel:

def main() -> null:
    print("ab".padStart(5, "😀"))

main()

$ node .../cli.ts run lone.vel | xxd
00000000: f09f 9880 efbf bd61 620a       <- U+1F600, then U+FFFD (a lone
                                            surrogate that the UTF-8 encoder
                                            could not represent), then "ab"
```

</details>

## 19. [major] Carriage returns inside interpolated (f) strings are silently turned into line feeds by the emitted template literal

- **类型**：wrong-codegen
- **期望**：`plain size = 4` and `interp size = 5` (a, CR, LF, b, X), and `interp contains CR = true`. The `\r` escape is documented in the charter ("Ordinary inline and layout strings keep the familiar `\\`, `\"`, `\n`, `\r`, and `\t` escapes") and an f-string differs from a plain string only by adding interpolation.
- **实际**：plain size = 4
interp size = 4
interp contains CR = false
- **复核**：CONFIRMED, and I am raising severity from the claimed minor to major.

REPRODUCTION. Verbatim, on the real compiler. `check` exits 0 with no diagnostic; `run` prints `emoji=[u{1F600}] size=8 / hex=[x41] size=3 / nul=[0] size=1`. Root cause is a single fallback branch, duplicated at two sites:

  /Users/mac/Documents/VelarScript/packages/compiler/src/lexer.ts:495  (plain + layout strings)
  /Users/

<details><summary>复现</summary>

```
3 lines, no function needed (/private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/minimal.vel):

    import {matches} from "velar/text"

    print(matches("add", "\d+"))

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check minimal.vel
Checked 1 module from minimal.vel          <- exit 0, no diagnostic
$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run minimal.vel
true                                       <- WRONG; correct answer is false

The literal "\d+" is decoded to the pattern d+, which matches the letter 'd' in "add". Full contrast set (verify/regex2.vel), all check-clean:

    matches("abc123", "\d+")  -> false   (raw r"\d+"  -> true)   false negative
    matches("add",    "\d+")  -> true                            false positive
    matches("aXc",   "a\.c")  -> true    (raw r"a\.c" -> false)  literal dot silently became wildcard

Original cosmetic form also reproduces verbatim: "\u{1F600}"->"u{1F600}" (size 8), "\x41"->"x41", "\0"->"0"; same in f-strings and layout strings.
```

</details>

## 20. [major] String.replace/replaceAll interpret JavaScript `$` substitution patterns in the replacement text

- **类型**：runtime-wrong
- **期望**：The charter documents `replace(from, to)` / `replaceAll(from, to)` as compiler-owned checked value methods ("They are compiler-owned operations, not JavaScript prototype calls") whose result is simply the "Replaced string", and Core deliberately has no regular expressions. `to` must be inserted literally:
1: a$&$&c
2: a[$`|$']c
4: $$$$$$
- **实际**：1: abbc
2: a[a|c]c
4: $$$
- **复核**：CONFIRMED — I tried to refute this and could not. It reproduces on the real compiler and contradicts the documented design in two independent ways.

REPRODUCTION: The reporter's file reproduces exactly as claimed (`1: abbc`, `2: a[a|c]c`, `4: $$$`). Minimal form is a one-liner that type-checks clean and silently returns the wrong string.

NOT A DOCUMENTED EXCLUSION: I checked both places I was poi

<details><summary>复现</summary>

```
def main() -> null:
    print("abc".replaceAll("b", "$&"))

main()

`check` is clean ("Checked 1 module"); `run` prints `abc`. Expected `a$&c` — the `$&` expanded to the matched text instead of being inserted literally.

Affected replacement sequences are exactly `$$`, `$&`, `` $` ``, `$'`:
    "a{X}b".replaceAll("{X}", "$$")   -> a$b     (expected a$$b)
    "a{X}b".replaceAll("{X}", "$&")   -> a{X}b   (expected a$&b)
    "a{X}b".replaceAll("{X}", "$`")   -> aab     (expected a$`b)
    "a{X}b".replaceAll("{X}", "$'")   -> abb     (expected a$'b)
Currency (`$5`, `$100`, `US$ 5`, `50$`) and `$<n>` are unaffected.

Second, independent symptom — the documented 16 MiB output budget is bypassed:
def main() -> null:
    // 20,000 code units, 2,000 matches; guard predicts 20000 + 2000*(2-1) = 22,000
    const value = "@yyyyyyyyy".repeat(2000)
    const out = value.replaceAll("@", "$'")
    try:
        print("size " + str(out.size))
    catch error:
        print("actual output blew past the budget: " + error.message)

main()
prints `actual output blew past the budget: Strings cannot exceed 16 MiB` — `.replaceAll` itself returned normally, having allocated a >16 MiB string from a 20 KB input (~800x past its own predicted budget).
```

</details>

## 21. [major] String.padStart/padEnd count UTF-16 code units, not code points, and can produce lone surrogates

- **类型**：runtime-wrong
- **期望**：Every other string member in the charter's table is defined in code points — `size` is the "Unicode code-point count", `slice` is a "Code-point slice", `char(index)` is a "Code point", and `for` over a string yields code points ("a surrogate pair is one character"). `padStart`'s first parameter is literally named `size`, so `"ab".padStart(5, emoji).size` must be 5 and the result must be well-forme
- **实际**：s.size = 2
padStart(5) size = 4
per-char sizes = 1,1,1,1
padEnd(5) size = 4
- **复核**：I tried hard to refute this and could not.

REPRODUCED with the real compiler. `v1.vel`, `v4.vel`, `v5.vel` and my own reductions all emit `VEL4006: Function 'f' can finish without returning string`. Minimal form is 5 lines (a bare `try:` with neither `catch` nor `finally` is separately rejected by VEL2008, and the `finally` body needs one statement, so this cannot shrink further).

NOT THE DOCUME

<details><summary>复现</summary>

```
def f() -> string:
    try:
        return "a"
    finally:
        print("x")

# node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check c_min.vel
# c_min.vel:1:1 error VEL4006: Function 'f' can finish without returning string
```

</details>

## 22. [major] Front end blows the JavaScript stack on a flat ~800-term expression and reports an internal error instead of a diagnostic

- **类型**：crash
- **期望**：Either the program compiles (it is a legal, if silly, VelarScript expression — 700 terms works fine and prints 700), or it is refused with a VelarScript source-limit diagnostic carrying a VELxxxx code, a file/line/column and a caret, the way delimiter nesting already is (`VEL1006: Delimiter nesting cannot exceed 512 levels`).
- **实际**：velar: Maximum call stack size exceeded

(exit code 1; `velar run deep_800.vel` prints `velar run: Maximum call stack size exceeded`, also exit 1)
- **复核**：CONFIRMED, and the claimed severity is too low — it is major, not minor.

REPRODUCTION
The reporter's exact program reproduces verbatim with the real compiler (probe at /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/undef1):
  size=3 / has(null)=false / values[1] isNull=true / list has null = false / spread has null = false



<details><summary>复现</summary>

```
Smallest program showing it, with NO `import js unsafe` (project at /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/undefmin):

velar.json:
{
  "formatVersion": 2,
  "entry": "main.vel",
  "outDir": "dist",
  "publicDir": "public",
  "extensions": []
}

node_modules/host-data/package.json:
{ "name": "host-data", "version": "1.0.0", "type": "module", "main": "index.js" }

node_modules/host-data/index.js:
export function lookup() { return [undefined]; }

main.vel:
extern module "host-data":
    export def lookup() -> List<number?>

import js {lookup} from "host-data"

def main() -> null:
    const found: List<number?> = lookup()
    print(f"read says null: {found.get(0) == null}")
    print(f"has(null): {found.has(null)}")
    return null

main()

Commands:
node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts build .
node dist/main.js

EXPECTED (charter §18: normalization follows the checked type "through ... collections"):
read says null: true
has(null): true

ACTUAL:
read says null: true
has(null): false

Extended probe (undef3) shows index(null)=null, count(null)=0, remove(null)=false, size unchanged at 3 — every membership operation denies an element that iteration reports as null.

Note: when a probe project imports a sibling .js file, `build` does not copy it into dist/; `cp hostile.js dist/` is needed before `node dist/main.js`. Using an extern module under node_modules/ avoids this.
```

</details>

## 23. [major] `try` with `finally` but no `catch` is wrongly reported as able to finish without returning

- **类型**：wrong-reject
- **期望**：Compiles and prints:
cleanup
a

The charter says "A function with a non-null result must declare it and return on every reachable path", and it also guarantees that `finally` "cannot `return` or use `break`/`continue` to leave the block". The try body returns unconditionally and the finally block provably cannot divert control, so there is no reachable path on which `f` finishes without returning 
- **实际**：/private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/jsboundary/v1.vel:1:1 error VEL4006: Function 'f' can finish without returning string
def f() -> string:
^^^^^^^^^^^^^^^^^^
- **复核**：CONFIRMED — reproduces on the real compiler, and it contradicts the repo's own documented design rather than matching it.

1) Reproduction (node v24.15.0, macOS). `check` on a 750-term flat `+` chain prints `velar: Maximum call stack size exceeded`, exit 1. Bisected on this machine: n=700 clean, n=750/800+ crash (reporter saw 700/800 — same behavior, threshold is stack-dependent, see (4)). `velar 

<details><summary>复现</summary>

```
One line, no function wrapper needed:

  python3 -c "print('const x = ' + ' + '.join(['1']*750))" > minimal.vel
  node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check minimal.vel
  # velar: Maximum call stack size exceeded   (exit 1)

Sharper variant that violates a documented ceiling directly — 450 nested calls, well under the documented 512-level syntax budget and 512-level delimiter budget:

  python3 -c "
  k=450
  print('def id(v: number) -> number:')
  print('    return v')
  print('')
  print('const x = ' + 'id('*k + '1' + ')'*k)
  " > c_450.vel
  node .../cli.ts check c_450.vel
  # velar: Maximum call stack size exceeded   (exit 1)
  # (k=600 correctly gives VEL1006; k=420 compiles clean)
```

</details>

## 24. [major] Keyword-named record keys cannot be used in destructuring or match object patterns, though they work everywhere else

- **类型**：wrong-reject
- **期望**：Compiles. Charter §19: "JavaScript reserved words that are not already VelarScript keywords cannot be used as binding names ... They remain valid as ordinary record keys and class member names, so external data and Web APIs do not need renamed fields." The same `class` key is already accepted in the `type` declaration, in the object literal, and in `row.class`; only the destructuring *key* positio
- **实际**：/private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/jsboundary/bug_destr_key.vel:8:12 error VEL2001: Expected an object binding name
    const {class: label, id} = row
           ^^^^^

/private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/jsboundary/bug_destr_key.vel:8:12 error 
- **复核**：CONFIRMED — reproduced with the real compiler, and it contradicts the documented design rather than following it.

1. Reproduction. The reported errors reproduce exactly. I then isolated the cause: `base.vel` (same `class` key in the `type` declaration, the object literal, and `row.class`, with the destructuring line removed) compiles and runs, printing `alpha`. `ctrl.vel` (`const {id: n} = row`) 

<details><summary>复现</summary>

```
File: /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/min.vel

type Row:
    class: string

def main() -> null:
    const row: Row = {class: "alpha"}
    const {class: label} = row
    print(label)

main()

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check min.vel
min.vel:6:12 error VEL2001: Expected an object binding name
    const {class: label} = row
           ^^^^^
(+3 cascading errors on the same line)

Delete line 6-7 and the file runs, printing "alpha" — so `class` is fine as a type field, an object-literal key, and a member read. Replace the key with a non-keyword (`const {id: n} = row`) and the rename form compiles and runs. Only the keyword-in-key-position inside a binding pattern fails.

Same hole, two more positions:
  match row:
      case {class: label}:      => VEL2001: Expected a field name in an object pattern
  for {class: label} in rows:   => VEL2001: Expected an object binding name
```

</details>

## 25. [major] velar/json serializers drop the reactive dependency: stringify(state) in a computed or JSX freezes forever, even for a plain List.append

- **类型**：runtime-wrong
- **期望**：Both serialized views track their source. `stringify(root)` shows `{"inner":{"depth":2}}` after the deep mutation, and `stringify(items)` shows `["a","b"]` after the append — the append case is not even a deep mutation, it is the charter's plain "mutating a `List` ... publishes" clause.
- **实际**：root.inner.depth   = 2
stringify(root)    = {"inner":{"depth":1}}
items.size         = 2
stringify(items)   = ["a"]
✗ chromium :: src/repro.browser.test.vel :: test_json_boundary_loses_tracking
Expected "{\"inner\":{\"depth\":1}}" to be "{\"inner\":{\"depth\":2}}"
- **复核**：CONFIRMED — reproduced independently with the real compiler at minimal size, and every refutation attempt failed.

REPRODUCTION (my own projects, not the reporter's):
1. /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/v_listget_min — 11-line main.vel, fails: Expected "no-first" to be "first".
2. /private/tmp/.../verify/v_listg

<details><summary>复现</summary>

```
Project /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/v_listget_min (velar.json: formatVersion 2, entry src/main.vel, extensions ["@velarscript/web"]).

src/main.vel:
component App:
    state items: List<string> = []

    def add():
        items.append("first")

    return <main>
        <p data-first>{items.get(0) ?? "no-first"}</p>
        <button data-btn="add" on:click={add}>1</button>
    </main>

mount(<App />, "#app")

src/probe.browser.test.vel:
import {expect} from "velar/test"
import {browser} from "velar/web-test"

async def test_minimal():
    await browser.open("/")
    await browser.click('[data-btn="add"]')
    expect(await browser.text("[data-first]")).toBe("first")

Run: node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts test . --browser chromium
Actual: 0 passed, 1 failed — Expected "no-first" to be "first". The node never updates for the rest of the session.
```

</details>

## 26. [major] List.get(index) out of range registers no dependency, so the read never re-runs when the item arrives

- **类型**：runtime-wrong
- **期望**：`items.get(0)` re-runs after `items.append("first")` and renders "first". `Map.get` of an absent key already behaves this way — verified in scratchpad/bughunt/reactivity/p10, where `lookup.get("missing")` correctly flipped from "no-key" to "now-present" after `lookup.set("missing", ...)`.
- **实际**：items.size    = 1
items.get(0)  = 'no-first'
✗ chromium :: src/repro.browser.test.vel :: test_out_of_range_list_get_registers_no_dependency
Expected "no-first" to be "first"
- **复核**：CONFIRMED — reproduced against the real compiler, and the attempt to refute it from the docs fails on the project's own internal controls.

REPRODUCTION
The reporter's r1 case reproduces byte-for-byte in a fresh project (/private/tmp/.../scratchpad/bughunt/verify/jr1):
  root.inner.depth   = 2
  stringify(root)    = {"inner":{"depth":1}}
  items.size         = 2
  stringify(items)   = ["a"]

I red

<details><summary>复现</summary>

```
Project verify/jr2 (velar.json: formatVersion 2, entry src/main.vel, extensions ["@velarscript/web"]).

src/main.vel — 12 lines, plain List append, no nesting, no deep mutation:

    import {stringify} from "velar/json"
    import {join} from "velar/collections"

    component App:
        state items: List<string> = ["a"]

        def append():
            items.append("b")

        return <main>
            <p data-join>{join(items, ",")}</p>
            <p data-json>{stringify(items)}</p>
            <button data-btn on:click={append}>go</button>
        </main>

    mount(<App />, "#app")

src/probe.browser.test.vel:

    import {expect} from "velar/test"
    import {browser} from "velar/web-test"

    async def test_list_append_json():
        await browser.open("/")
        await browser.click("[data-btn]")
        expect(await browser.text("[data-json]")).toBe("[\"a\",\"b\"]")

Run: node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts test . --browser chromium

Observed:
    join(items)      = a,b
    stringify(items) = ["a"]
    ✗ Expected "[\"a\"]" to be "[\"a\",\"b\"]"

The `join` node is the built-in control: it updates because __velarRequireList registers collectionRead(iterateKey) (packages/cli/src/standard-modules.ts:363), while __velarInspectJson only unwraps (packages/compiler/src/json-runtime.ts:33). Drop the `join` line and the file is a 10-line self-contained repro.
```

</details>

## 27. [major] Keyed JSX re-links every row record to every derived List it ever rendered: unbounded retention plus linear per-mutation slowdown

- **类型**：other
- **期望**：The cost of 30 property writes is independent of how many times the keyed region has re-rendered, and no derived List is retained after it stops being displayed. D26 targets "每 chunk O(1) 重渲染" for exactly this streaming/keyed shape.
- **实际**：cycles = 3000
30 row mutations BEFORE 3000 keyed re-renders (ms) = 0.2999999523162842
30 row mutations AFTER  3000 keyed re-renders (ms) = 3.9000000953674316
✓ chromium :: src/repro.browser.test.vel :: test_parent_link_growth_cost

(a second run of the same program measured 0.7999 -> 3.7000 ms; a 400-cycle run measured 0.7999 -> 0.5999, i.e. the regression scales with the number of past re-renders
- **复核**：Reproduced independently with the real compiler, both as a check-only unsound accept and end-to-end in chromium.

REPRODUCTION. An 8-line module at /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/r6min/src/main.vel checks clean ("Checked 1 module from ."). Replacing the two-line alias-then-assign with a direct `node.title = ..

<details><summary>复现</summary>

```
Project at .../scratchpad/bughunt/verify/r6min (velar.json: formatVersion 2, entry "src/main.vel", extensions ["@velarscript/web"]).

src/main.vel — `node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check .` reports NO diagnostic:

type Node:
    title: string

component Child(node: Node):
    const alias = node
    alias.title = "written-by-child"
    return <span>{node.title}</span>

mount(<Child node={{title: "a"}} />, "#app")

Contrast — deleting `const alias = node` and writing the assignment directly IS rejected:

component Child(node: Node):
    node.title = "written-by-child"
    return <span>{node.title}</span>

=> src/main.vel:5:5 error VEL5051: Component prop 'node' is read-only; ask the parent to update it instead of mutating a nested value

Runtime confirmation (.../verify/r6, `cli.ts test . --browser chromium`): a Child with `const alias = node; alias.title = "written-by-child"` in a click handler, mounted under a parent holding `state root: Node = {title: "owned-by-parent"}`, prints `before = owned-by-parent` / `after = written-by-child` — the parent's own rendered state is overwritten by the child.

Same clean-check + same runtime write with no alias at all, via the charter-blessed helper idiom (.../verify/r6helper):

def retitle(node: Node, title: string):
    node.title = title

component Child(node: Node):
    def sneak():
        retitle(node, "written-by-child")
    return <button data-child on:click={sneak}>{node.title}</button>
```

</details>

## 28. [major] Component prop read-only rule (VEL5051) is defeated by a one-line local alias; a child silently writes parent state

- **类型**：unsound-accept
- **期望**：Charter line 1109: "Component props remain read-only in the child. A child may call a callback supplied by its parent to request a mutation, but it may not assign a prop record field or invoke a mutating collection method on a prop." D26 invariant 5 makes this an analyzer diagnostic. Writing `node.title` directly is correctly rejected with VEL5051, so routing the identical write through a one-line
- **实际**：$ node .../cli.ts check .
Checked 1 module from .

$ node .../cli.ts test . --browser chromium
before = owned-by-parent
after  = written-by-child
✗ chromium :: src/repro.browser.test.vel :: test_child_writes_parent_state_through_a_local_alias
Expected "written-by-child" to be "owned-by-parent"
- **复核**：CONFIRMED — reproduced with the real compiler/runtime, and not a documented design choice.

(1) Reproduction. `check` passes, the bind succeeds, the program prints a healthy `PORT=` line, and then every single request returns `500 Internal server error`. Verified for host="::1" (requested via http://[::1]:PORT) and host="::" (requested via both http://127.0.0.1:PORT and http://[::1]:PORT). Control

<details><summary>复现</summary>

```
File: min.vel

import {ServeRequest, ServeResponse, serve} from "velar/serve"

async def handle(request: ServeRequest) -> ServeResponse:
    return {status: 200, text: "ok"}

await serve(handle, port=9411, host="::1")

Commands:
  node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check min.vel   # passes
  node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run min.vel &
  curl -s -o /dev/null -w "status=%{http_code}\n" 'http://[::1]:9411/'

Observed: status=500, and on stderr:
  [velar/serve] request handler failed: TypeError: Invalid URL
      at new URL (node:internal/url:819:25)
      at serveRequest (.../node_modules/velar/serve.js:261:15)
    code: 'ERR_INVALID_URL', input: '/', base: 'http://::1'

Note the handler body never touches `request`, proving the throw happens in the
runtime's own request construction before the handler is entered. Identical
failure with host="::" (all interfaces, dual stack). Bracketing the host as a
workaround does not help: host="[::1]" escapes serve()'s "error" listener and
kills the process with an uncaught `Error: getaddrinfo ENOTFOUND [::1]`.
Control: host="127.0.0.1" and host="localhost" both return 200 normally.
```

</details>

## 29. [major] List.pop() returns an unwrapped record, so later writes through that reference are silently non-reactive

- **类型**：runtime-wrong
- **期望**："State references may be aliased, returned, and passed through ordinary functions; helpers can mutate the owned value directly" (charter line 1085). Writing `taken.title` must publish exactly like writing `moved[0].title` does. Every other accessor — `list[i]`, `list.get(i)`, `list.find`, `list.min/max`, `list.slice`, `map.get`, and both collection iterators — hands back a reactive record.
- **实际**：after move    rows='Alpha' probe='0:Alpha'
after mutate  rows='Alpha' probe='0:Alpha'
after nudge   rows='Alpha' probe='1:MUTATED'
✗ chromium :: src/repro.browser.test.vel :: test_pop_returns_an_unwrapped_record
Expected "Alpha" to be "MUTATED"
- **复核**：I tried to refute this and could not. It reproduces verbatim with the real compiler, and it contradicts an explicit written contract with no exclusion covering it.

REPRODUCED (Part 1 — contract violation). `node packages/cli/src/cli.ts run p17.vel` then `curl --path-as-is`:
  /caf%C3%A9      -> {"path":"/caf%C3%A9","method":"GET"}
  /a%2Fb          -> {"path":"/a%2Fb","method":"GET"}
  /%70rivate

<details><summary>复现</summary>

```
Smallest program showing the contract violation (3 statements):

--- /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/p17.vel ---
import {ServeRequest, ServeResponse, serve} from "velar/serve"

async def handle(request: ServeRequest) -> ServeResponse:
    return {status: 200, json: {path: request.path}}

async def main():
    const server = await serve(handle, port=8801)
    print(f"READY {server.port}")

await main()

  node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run p17.vel &
  curl -s --path-as-is 'http://127.0.0.1:8801/caf%C3%A9'

  expected (docs/standard-library.md:444 "decoded URL path"): {"path":"/café"}
  actual:                                                     {"path":"/caf%C3%A9"}

Smallest program showing the security impact (needs site/private/secret.txt):

--- .../verify/p6.vel ---
import {ServeRequest, ServeResponse, fileResponse, serve} from "velar/serve"

async def handle(request: ServeRequest) -> ServeResponse:
    if request.path.startsWith("/private/"):
        return {status: 403, text: "Forbidden"}
    return fileResponse(root="site", path=request.path, fallback="index.html")

async def main():
    const server = await serve(handle, port=8792)
    print(f"PORT={server.port}")

await main()

  curl -s --path-as-is 'http://127.0.0.1:8792/private/secret.txt'    -> 403 Forbidden
  curl -s --path-as-is 'http://127.0.0.1:8792/%70rivate/secret.txt'  -> 200 TOP SECRET

Se
```

</details>

## 30. [major] A render expression that deeply mutates the state it reads hangs the page forever with no diagnostic and no recursion guard

- **类型**：crash
- **期望**：Either a compile-time diagnostic (a render/computed expression must not mutate reactive state) or a runtime recursion guard reported through the `velar/app` `render` phase, the way the runtime already caps queue size and reports render failures. Something must reach the DOM.
- **实际**：$ node .../cli.ts check .
Checked 1 module from .

$ node .../cli.ts test . --browser chromium
✗ chromium :: src/repro.browser.test.vel :: test_render_time_deep_mutation
locator.textContent: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('[data-render]')

0 passed, 1 failed
- **复核**：CONFIRMED — reproduced with the real compiler, and it contradicts the documented design rather than matching a deliberate exclusion.

Reproduction (three independent runs, all with `node packages/cli/src/cli.ts test . --browser chromium`):
1. The reporter's exact program: `after move rows='Alpha'` / `after mutate rows='Alpha'` / `after nudge rows='1:MUTATED'`. The third line proves this is a lost 

<details><summary>复现</summary>

```
Project at .../scratchpad/bughunt/verify/r5c — velar.json is the standard web shape ("entry": "src/main.vel", "extensions": ["@velarscript/web"], "web": {"title": "r5c", "base": "/"}), node_modules symlinked to the repo's.

src/main.vel:

    type Node:
        id: string
        title: string

    let held: Node? = null

    component App:
        state rows: List<Node> = [{id: "a", title: "Alpha"}]

        def take():
            held = rows.pop()
            const taken = held
            if taken != null:
                rows.append(taken)

        def edit():
            const taken = held
            if taken != null:
                taken.title = "EDITED"

        return <main>
            <p data-probe>{rows.size > 0 ? rows[0].title : "-"}</p>
            <button data-btn="take" on:click={take}>take</button>
            <button data-btn="edit" on:click={edit}>edit</button>
        </main>

    mount(<App />, "#app")

src/min.browser.test.vel:

    import {expect} from "velar/test"
    import {browser} from "velar/web-test"

    async def test_pop_alias_write_publishes():
        await browser.open("/")
        await browser.click('[data-btn="take"]')
        await browser.click('[data-btn="edit"]')
        print("probe='" + await browser.text("[data-probe]") + "'")
        expect(await browser.text("[data-probe]")).toBe("EDITED")

`node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check .` → clean ("Checked 1 module from .").
`node /Users/mac/Documents/Ve
```

</details>

## 31. [major] velar/serve binds an IPv6 host successfully, then fails every request with 500 (Invalid URL)

- **类型**：crash
- **期望**：`serve(handler, port, host)` documents `host` as an ordinary bounded host string; `::` (all interfaces incl. IPv6) and `::1` (IPv6 loopback) are the two most common non-default values. Either the bind should be refused up front, or requests should be served normally.
- **实际**：PORT=8793

HTTP/1.1 500 Internal Server Error
Content-Type: text/plain; charset=utf-8

[velar/serve] request handler failed: TypeError: Invalid URL
    at new URL (node:internal/url:819:25)
    at serveRequest (file:///.../.velar/run-Qk4sUE/node_modules/velar/serve.js:261:15)
    at file:///.../.velar/run-Qk4sUE/node_modules/velar/serve.js:292:42
    at process.processTicksAndRejections (node:inte
- **复核**：CONFIRMED — I tried to refute this and could not.

Reproduction (my own project, /private/tmp/.../scratchpad/bughunt/verify/vfy1, node_modules -> /Users/mac/Documents/VelarScript/node_modules):
- JSX attribute interpolation, closing quote at the opening line's indent (4): VEL1003 + VEL1004, exactly as reported.
- JSX child interpolation `<pre>{"..."}</pre>`: same two errors.
- Closing quote at col

<details><summary>复现</summary>

```
Web project (JSX is Web-only). velar.json:

{"formatVersion": 2, "entry": "src/main.vel", "outDir": "dist", "publicDir": "public", "extensions": ["@velarscript/web"]}

src/main.vel (no `f` prefix and no `mount` needed):

export component Board:
    return <pre>{"
        alpha
    "}</pre>

node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check .

  src/main.vel:2:18 error VEL1003: Unterminated layout string; close it with a quote at the opening line's indentation
  src/main.vel:4:1  error VEL1004: Layout string lines must keep the indentation established by the first content line

Moving the closing `"` to column 0 (the only accepted spelling) compiles: "Checked 1 module from .".

Core control, accepted and correct (prints alpha\nbeta) — the shape §14 says JSX must match:

def main():
    print(f"
        alpha
        beta
    ")

main()
```

</details>

## 32. [major] A layout string inside a `look:` block is rejected as an unterminated inline string with cascading Look-indentation errors

- **类型**：bad-diagnostic
- **期望**：Charter §17 describes Look property values as ordinary VelarScript expressions, and a multi-line string is exactly what CSS `grid-template-areas` wants. Either accept it, or emit a diagnostic that names the actual restriction ("layout strings cannot open inside a `look:` block; assign it to a binding first").
- **实际**：/private/tmp/.../scratchpad/bughunt/web2/src/main.vel:5:25 error VEL1003: Unterminated string literal before the end of the line
    gridTemplateAreas = "
                        ^

/private/tmp/.../scratchpad/bughunt/web2/src/main.vel:6:9 error VEL5038: Unexpected Look indentation
        head head
        ^^^^^^^^^

/private/tmp/.../scratchpad/bughunt/web2/src/main.vel:7:9 error VEL5038: Unexpec
- **复核**：REPRODUCED, and I could not refute it on design grounds.

1. Reproduction (real compiler, `packages/cli/src/cli.ts check`): the reported program fails exactly as claimed — `VEL2003: Expected the end of a statement`, caret on `"yes"`. It is not specific to user-defined types or to `const` initialisers; it fires in every ordinary expression position:
   - `const c = value is string ? "yes" : "no"` →

<details><summary>复现</summary>

```
One line, top level (file tiny.vel):

const label = 1 is number ? "y" : "n"

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check tiny.vel
tiny.vel:1:33 error VEL2002: Expected an expression
const label = 1 is number ? "y" : "n"
                                ^

Three-line form reproducing the originally reported VEL2003 text (file min.vel):

def main():
    print(1 is number ? "y" : "n")

main()

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check min.vel
min.vel:2:25 error VEL2001: Expected ')' after arguments
min.vel:2:25 error VEL2003: Expected the end of a statement
    print(1 is number ? "y" : "n")
                        ^^^

Controls that pin the cause (all clean):
  print((1 is number) ? "y" : "n")      -> runs, prints y
  const c = value is string? ? "y" : "n" -> checks clean (two '?')
  print("a" in ["a"] ? "y" : "n")        -> runs, prints y   (sibling operator composes)
```

</details>

## 33. [major] Assigning an imported reactive `state` reports "Cannot assign to const binding", naming a declaration form the source never used

- **类型**：bad-diagnostic
- **期望**：Charter §15: "Reactive imports keep the same split as ordinary imports: assigning an imported binding is forbidden, while mutating the value inside an imported state binding is legal." Rejecting the write is right; the message should say the binding is imported and read-only here, and point at the fix (export a mutator from the owning module).
- **实际**：/private/tmp/.../scratchpad/bughunt/web2/src/main.vel:5:9 error VEL3002: Cannot assign to const binding 'limit'
        limit = limit + 1
        ^^^^^
- **复核**：CONFIRMED — I tried to refute it and could not. Reproduced three independent ways with the shipped compiler.

1) Original repro re-run verbatim (`node .../cli.ts test . --browser chromium` in /private/tmp/.../scratchpad/bughunt/verify/r7): 30 property writes cost 1.30 ms before 3000 keyed re-renders and 3.60 ms after.

2) Instrumented, JIT/noise-resistant version of the same app (600 writes per ch

<details><summary>复现</summary>

```
22-line program; leaks one dead List per keyed re-render. No `computed`, no timing needed — retention is counted directly.

/private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/r8/src/main.vel
(velar.json: standard formatVersion 2 web project, entry src/main.vel, extensions ["@velarscript/web"])

    import {range} from "velar/collections"

    type Row:
        id: string
        on: bool

    component App:
        state rows: List<Row> = [{id: "a", on: true}, {id: "b", on: true}]
        state ticks = 0

        action churn():
            for index in range(500):
                rows[0].on = not rows[0].on
                ticks += 1
                await tick()

        return <main>
            <p data-ticks>{ticks}</p>
            <ul data-rows>{rows.filter(row => row.on or true).map(row => <li key={row.id}>{row.id}</li>)}</ul>
            <button data-btn="churn" on:click={churn}>go</button>
        </main>

    mount(<App />, "#app")

Build and serve, then count live row-shaped arrays after a forced GC:
    node .../cli.ts build .   &&   node .../cli.ts preview . --port 5988
    driver: /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/drive3.mjs 5988
      (Playwright + CDP HeapProfiler.collectGarbage + Runtime.queryObjects over Array.prototype)

Observed:
    live row-Lists @start: 2
    live row-Lists after 500 keyed re-renders: 5
```

</details>

## 34. [minor] `velar format` turns a working program containing a tab-indented layout string into a compile error

- **类型**：other
- **期望**：Formatting is meaning-preserving: the program should still compile and still print the same two lines ("all:" / TAB "echo hi") after `velar format`.
- **实际**：$ node .../cli.ts run fmt3/mk.vel
all:
	echo hi

$ node .../cli.ts format fmt3/mk.vel
Formatted fmt3/mk.vel

$ node .../cli.ts run fmt3/mk.vel
/private/tmp/.../fmt3/mk.vel:2:12 error VEL1003: Unterminated layout string; close it with a quote at the opening line's indentation
    return "
           ^

/private/tmp/.../fmt3/mk.vel:3:1 error VEL1002: Tabs are not allowed for indentation
	all:
^
- **复核**：REPRODUCED, and it is neither documented design nor a listed deliberate exclusion. Verdict: real defect, severity minor (agreeing with the reporter's own rating), with one of the reporter's impact claims corrected as overstated.

1. Reproduction (real compiler, HEAD)
Re-created the probe independently at /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/

<details><summary>复现</summary>

```
File /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/minimal.vel (line 4 is exactly 8 spaces; margin is 4; shown via `cat -e`, `$` = end of line):

    import {stringify} from "velar/json"$
    const a = "$
        x$
            $
    "$
    print(stringify(a))$

Written with:
    python3 - <<'PY'
    open('minimal.vel','w',newline='').write(
    'import {stringify} from "velar/json"\nconst a = "\n    x\n        \n"\nprint(stringify(a))\n')
    PY

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run minimal.vel
"x\n"

Expected per charter section 3 ("indentation beyond that margin [is] preserved exactly; there is no common-dedent or trim pass"): "x\n    " — the 4 spaces beyond the 4-space margin should survive.
```

</details>

## 35. [minor] A legal raw inline string beginning with a doubled delimiter is mis-lexed as a legacy triple-quoted string

- **类型**：wrong-reject
- **期望**：Charter section 3: "a delimiter inside raw inline text is doubled: r\"He said \"\"hello\"\"\"". Scanning r"""quoted"" text" by that rule gives content ""quoted"" text which decodes to `"quoted" text`, so the program should compile and print "\"quoted\" text". The equivalent string with the doubled delimiter anywhere but the first position works fine (p08.vel: r"He said ""hello""" prints "He said \
- **实际**：$ node .../cli.ts check p10.vel
/private/tmp/.../p10.vel:3:11 error VEL1003: Unterminated legacy triple-quoted string
const q = r"""quoted"" text"
          ^^^^^^^^^^^^^^^^^^

/private/tmp/.../p10.vel:3:11 error VEL1005: Use a 'r"' layout string; VelarScript uses indentation rather than triple-quote delimiters
const q = r"""quoted"" text"
          ^^^^^^^^^^^^^^^^^^
- **复核**：CONFIRMED — reproduces with the real compiler and contradicts the documented design.

1. Reproduction. `print(r"""x")` is rejected with VEL1003 "Unterminated legacy triple-quoted string" plus a VEL1005 telling the author to rewrite it as a layout string. The control `print(r"y""x")` — the identical construct with one ordinary character before the doubled delimiter — runs and prints `y"x`. So the s

<details><summary>复现</summary>

```
print(r"""x")

Command: node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run min.vel

ACTUAL:
  min.vel:1:7 error VEL1003: Unterminated legacy triple-quoted string
  min.vel:1:7 error VEL1005: Use a 'r"' layout string; VelarScript uses indentation rather than triple-quote delimiters
  min.vel:2:1 error VEL2001: Expected ')' after arguments

EXPECTED: prints  "x  (content is the doubled delimiter "" decoding to one quote, then x)

Control proving the leading position is the sole trigger — insert one ordinary character before the doubled delimiter and it works:
  print(r"y""x")   ->  y"x   (exit 0)
```

</details>

## 36. [minor] .replaceAll() allocates a string larger than the documented 16 MiB output budget

- **类型**：runtime-wrong
- **期望**：docs/standard-library.md: "Text composition such as `.replace`, `.replaceAll`, `escapeHtml`, and `indent` checks its complete output budget before allocating the final string." So `replaceAll` itself should raise `RangeError: String.replaceAll output cannot exceed 16 MiB` before building the result.
- **实际**：replaceAll returned without a RangeError
file:///.../.velar/run-zsUnB6/p66_budget.js:16
  if (value.length > __velarMaxTextCodeUnits) throw new RangeError("Strings cannot exceed 16 MiB");
                                                    ^

RangeError: Strings cannot exceed 16 MiB
    at __velarTextValue (file:///.../p66_budget.js:16:53)
    at __velarStringSize (file:///.../p66_budget.js:59:71)
- **复核**：CONFIRMED. I tried to refute this three ways (reproduce, documented-design check, deliberate-exclusion check) and it survived all three.

1) Reproduction. It reproduces exactly as claimed, and the boundary is sharper than reported: 426 nested f-strings prints "Checked 1 module", 427 prints "velar: Maximum call stack size exceeded". `run` fails the same way ("velar run: Maximum call stack size exce

<details><summary>复现</summary>

```
python3 -c "
s='1'
for _ in range(427): s='f\"{'+s+'}\"'
open('deep.vel','w').write('const a = '+s+'\nprint(a)\n')"
node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check deep.vel
# ACTUAL:   velar: Maximum call stack size exceeded
# (426 levels -> "Checked 1 module from deep.vel"; 427 is the exact CLI boundary)
# EXPECTED: a bounded diagnostic (VEL2008 / VEL1006), never an internal error

Also reproduces through the library API, so it is not a CLI-only artifact:
  import { compile } from ".../packages/compiler/src/index.ts"  ->  compile() throws
  RangeError "Maximum call stack size exceeded" (boundary ~444 there).
Isolated to the parse phase: new Lexer(text,[]).lex() succeeds, then
new Parser(lexed.tokens,[]).parse() throws.
```

</details>

## 37. [minor] Named arguments to an extern function send explicit `undefined` for skipped and trailing omitted parameters

- **类型**：wrong-codegen
- **期望**：javascript-bridge.md: "An extern default parameter controls call arity only: omitting it sends no argument to JavaScript, and the written default expression is never executed as a declaration body." `arity(b=8)` omits both `a` and `c`; at minimum the trailing omitted `c` must not be sent, so:
arity(b=8)   -> argc=2 values=["<undefined>",8]   (or argc=0/1/2 per the arity rule, never 3)
- **实际**：arity()      -> argc=0 values=[]
arity(9)     -> argc=1 values=[9]
arity(c=9)   -> argc=3 values=["<undefined>","<undefined>",9]
arity(b=8)   -> argc=3 values=["<undefined>",8,"<undefined>"]
- **复核**：REPRODUCED, and it contradicts the documented design rather than misreading it.

1) Reproduction (real compiler, `packages/cli/src/cli.ts run`):
   `/private/tmp/.../scratchpad/bughunt/verify/p1` gives exactly the reported output —
     arity()      -> argc=0
     arity(9)     -> argc=1
     arity(c=9)   -> argc=3 values=["<undefined>","<undefined>",9]
     arity(b=8)   -> argc=3 values=["<undefin

<details><summary>复现</summary>

```
Project dir: /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/p2
velar.json copied verbatim from /Users/mac/Documents/VelarScript/examples/modules/velar.json

node_modules/probe2/package.json:
{"name":"probe2","version":"1.0.0","type":"module","main":"index.js","exports":{".":"./index.js"}}

node_modules/probe2/index.js:
export function argc(...args) { return args.length; }

main.vel:
extern module "probe2":
    export def argc(a: number = 1, b: number = 2) -> number

import js {argc} from "probe2"

print(argc(7))
print(argc(a=7))

Command:
node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts run /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/p2

EXPECTED (javascript-bridge.md:114 "omitting it sends no argument to JavaScript"; language-charter.md:446 "This keeps positional and named calls identical"):
1
1

ACTUAL:
1
2

Emitted lowering for the second call:
argc(...((__namedArguments) => [__namedArguments[0], undefined])([__velarHostRaw(7)]))

Wrong-value variant (same defect, ordinary reduce-forwarding callee), /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/p5:
  JS:  export function total(values, initial) { return arguments.length < 2 ? values.reduce((a,b)=>a+b) : values.reduce((a,b)=>a+b, initial); }
  VEL: export def total(values: List<number>, initia
```

</details>

## 38. [minor] ServeRequest.path is not URL-decoded despite the documented "decoded URL path", letting an application route guard be bypassed while fileResponse decodes and serves the file

- **类型**：runtime-wrong
- **期望**：docs/standard-library.md, `velar/serve`: "The handler receives a `ServeRequest` with method, decoded URL path, first-value query and normalized header Maps". `/caf%C3%A9` should surface as `/café` and `/%70rivate/secret.txt` as `/private/secret.txt`, so the guard sees the same string `fileResponse` will act on and returns 403 for both spellings.
- **实际**：# Part 1 — path arrives percent-encoded
/caf%C3%A9         {"path":"/caf%C3%A9","method":"GET"}
/a%2Fb             {"path":"/a%2Fb","method":"GET"}
/%70rivate/x       {"path":"/%70rivate/x","method":"GET"}
/space%20here      {"path":"/space%20here","method":"GET"}
/tilde%7E          {"path":"/tilde%7E","method":"GET"}

# Part 2 — guard bypassed, private file served
--- guard direct
HTTP/1.1 403 Fo
- **复核**：CONFIRMED, with two corrections to the reporter's analysis.

Reproduction: the exact repro reproduces. `node packages/cli/src/cli.ts check .` prints "Checked 1 module from ." (no diagnostic) and `... test . --browser chromium` fails with `locator.textContent: Timeout 30000ms exceeded` waiting for `[data-render]`.

Mechanism verified in source, not inferred. In /Users/mac/Documents/VelarScript/pack

<details><summary>复现</summary>

```
Smallest program that still hangs (no nested records, no deep mutation — D26 is not required).

Project at /private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/r8a

velar.json:
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "outDir": "dist",
  "publicDir": "public",
  "extensions": ["@velarscript/web"],
  "web": {"title": "r8a"}
}

src/main.vel:
component App:
    state count: number = 1

    def bump() -> number:
        count += 1
        return count

    return <main><p data-render>{bump()}</p></main>

mount(<App />, "#app")

src/repro.browser.test.vel:
import {expect} from "velar/test"
import {browser} from "velar/web-test"

async def test_case():
    await browser.open("/")
    expect(await browser.text("[data-render]")).toBe("2")

Commands and observed output:
$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check .
Checked 1 module from .

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts test . --browser chromium
✗ chromium :: src/repro.browser.test.vel :: test_case
locator.textContent: Timeout 30000ms exceeded.
  - waiting for locator('[data-render]')
0 passed, 1 failed

Independent confirmation that the tab is hard-frozen with no signal (production build + `velar preview` + direct Playwright): console messages [], no pageerror, `page.evaluate` times out, and CDP `DOM.getDocument` times out.

Rule: any render/computed observer that reads reactive key K and then unco
```

</details>

## 39. [minor] A layout string inside a JSX interpolation only closes at column 0, contradicting the documented "bracket context, exactly as inside a call's parentheses"

- **类型**：wrong-reject
- **期望**：Charter §14: "JSX expressions use ordinary VelarScript expressions, and the interpolation braces are a bracket context: the expression inside `{...}` continues across physical lines without parentheses, exactly as it would inside a call's parentheses." Charter §3: the layout string closes with "a quote back at the opening line's indentation". The opening line is indented 4, the closing quote is at
- **实际**：/private/tmp/.../scratchpad/bughunt/web/src/main.vel:2:27 error VEL1003: Unterminated layout string; close it with a quote at the opening line's indentation
    return <p data-title={f"
                          ^^

/private/tmp/.../scratchpad/bughunt/web/src/main.vel:5:1 error VEL1004: Layout string lines must keep the indentation established by the first content line
    "}>body</p>
^^^^
- **复核**：CONFIRMED — reproduces exactly with the real compiler, and it is not a documented restriction or a listed deliberate exclusion.

Reproduction: verbatim repro reproduces at /private/tmp/.../scratchpad/bughunt/verify/w2, and reduces to the 4-line program above (no `state`, no component, no `mount`).

Documentation check (this is where I tried hardest to refute):
- Charter §3 (docs/language-charter.m

<details><summary>复现</summary>

````text
Web project (`extensions: ["@velarscript/web"]`), src/main.vel — 4 lines, no state/JSX/mount needed:

```text
export const cardLook = look:
    gridTemplateAreas = "
        head head
    "
```

`node packages/cli/src/cli.ts check <project>` emits:

```
2:25 error VEL1003: Unterminated string literal before the end of the line
    gridTemplateAreas = "
                        ^
3:9  error VEL5038: Unexpected Look indentation
        head head
4:5  error VEL5038: Look entries use 'property = value', 'if condition:', '@target:', or composition with '...'
    "
```

Contrast (both `Checked 1 module`):
- same layout string bound outside the block, then `gridTemplateAreas = areas`
- the identical layout string inside a JSX attribute: `<section title={"\n    head head\n"}>` — this one enters layout mode and, when closed at the opening line's indentation, compiles clean.
````

</details>

## 40. [minor] `value is Type ? a : b` is rejected with "Expected the end of a statement" because `Type ?` is greedily parsed as the optional type `Type?`

- **类型**：bad-diagnostic
- **期望**：`is` (charter §4) and the inline `condition ? then : else` form (charter §9) are both first-class; combining them is the obvious spelling. Either parse it as a type test followed by a conditional, or say so: "'?' after a type is read as the optional type 'User?'; parenthesise the 'is' test".
- **实际**：/private/tmp/.../scratchpad/bughunt/interact/i10.vel:6:35 error VEL2003: Expected the end of a statement
    const label = value is User ? "yes" : "no"
                                  ^^^^^
- **复核**：CONFIRMED, but narrowed: the rejection is correct and documented; only the message text is defective.

Reproduced verbatim with the real compiler on the reported project (`.../bughunt/web2`): `main.vel:5:9 error VEL3002: Cannot assign to const binding 'limit'`.

Design check (the refutation attempt): the rejection itself is explicitly documented, so nothing about the error's existence is a bug. do

<details><summary>复现</summary>

```
Two core-language files, no web extension and no `state` needed.

/private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/min/store.vel
    export let counter = 0

/private/tmp/claude-501/-Users-mac-Documents-VelarScript/d52801e6-2893-4ee8-9bbe-b07fe43eaa99/scratchpad/bughunt/verify/min/main.vel
    import {counter} from "./store.vel"

    counter = 1

Command:
    node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check main.vel

Actual:
    main.vel:3:1 error VEL3002: Cannot assign to const binding 'counter'
    counter = 1
    ^^^^^^^

Expected: a message naming the real restriction — the binding is imported and therefore read-only in this module — since no `const` appears in either file and charter line 920 says an `export let` is a live binding its owning module can reassign. The originally reported `export state limit` case (.../bughunt/web2) reproduces identically and is the same code path.
```

</details>

## 41. [minor] Explicit type arguments `f<T>(x)` produce three cascading nonsense diagnostics including "Unknown name 'string'"

- **类型**：bad-diagnostic
- **期望**：Charter §7: "Type arguments are inferred at each call site; there is no explicit instantiation syntax." Per the charter's own removed-spelling doctrine (§19: "When a removed spelling is common enough to be a likely mistake, the compiler reports the direct current spelling"), this should be one diagnostic naming the current spelling, e.g. "type arguments are inferred; write identity(\"x\")".
- **实际**：/private/tmp/.../scratchpad/bughunt/interact/i6.vel:5:15 error VEL4001: Ordered comparison requires two numbers or two strings, received <T>(value: T) -> T and unknown
    const a = identity<string>("x")
              ^^^^^^^^^^^^^^^^^^^^

/private/tmp/.../scratchpad/bughunt/interact/i6.vel:5:24 error VEL3001: Unknown name 'string'
    const a = identity<string>("x")
                       ^^^^^^

- **复核**：REPRODUCED verbatim with the real compiler, and reduced from 8 lines to 4 (no main() wrapper needed).

I tried three refutations; all failed.

REFUTATION 1 — "this is documented design." Partially true but does not cover the defect. The charter documents the SYNTAX exclusion at docs/language-charter.md:516 ("Type arguments are inferred at each call site; there is no explicit instantiation syntax")

<details><summary>复现</summary>

```
--- min.vel ---
def identity<T>(value: T) -> T:
    return value

print(identity<string>("x"))

$ node /Users/mac/Documents/VelarScript/packages/cli/src/cli.ts check min.vel
min.vel:4:7 error VEL4001: Ordered comparison requires two numbers or two strings, received <T>(value: T) -> T and unknown
print(identity<string>("x"))
      ^^^^^^^^^^^^^^^^^^^^

min.vel:4:16 error VEL3001: Unknown name 'string'
print(identity<string>("x"))
               ^^^^^^

min.vel:4:16 error VEL4001: Ordered comparison requires two numbers or two strings, received unknown and string
print(identity<string>("x"))
               ^^^^^^^^^^^

Second, worse presentation (parse phase) when the call has 2+ arguments:

--- m5.vel ---
def identity<T>(value: T) -> T:
    return value

const a = identity<string>("x", "y")

m5.vel:4:31 error VEL2001: Expected ')' after expression
const a = identity<string>("x", "y")
                              ^
(caret on the comma; the suggested insertion of ')' cannot fix the program)

Third presentation, nested type arguments:
  identity<List<string>>(["x"])  ->  VEL2002: Expected an expression, caret on the '>>'
```

</details>
