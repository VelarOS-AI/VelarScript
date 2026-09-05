# VelarScript language reference

This document defines the current VelarScript source language. It is a clean
reference, not a migration guide. Removed spellings and earlier experiments are
not part of the language.

## 1. Design contract

VelarScript is an extensible application-layer programming language for the AI
era, in which the framework is the language: one language covers markup,
styling, state, tests, and the server side, and the compiler checks all of it.
**Velar** names the platform that compiles and runs it — Core, the target
extensions, and the toolchain — and "application layer" bounds what that
platform accepts, which is rule 5 stated outward. A model can write code
faster than anyone can check it, so the bottleneck is trust rather than
authorship — the human supplies intent, the model writes the VelarScript, and
the compiler guards each change. Every rule below serves that: uniform output,
diagnostics that teach, mistakes that stay silent elsewhere made loud here, and
a readable JavaScript exit. Rule 5 is the other half of the positioning and not
merely hygiene — unification is only affordable because capability lives in
extensions rather than in Core. The full statement is in
[Why VelarScript exists](why-velarscript.md).

VelarScript is designed for people and AI systems that already understand
JavaScript, Python, HTML, CSS, or JSX.

The language follows five rules:

1. Keep JavaScript's runtime semantics where the compiler cannot honestly
   replace them: objects, references, prototypes, garbage collection, Promises,
   the event loop, and browser APIs remain JavaScript.
2. Remove source-level traps instead of adding compatibility aliases.
3. Prefer one obvious spelling over several nearly equivalent spellings.
4. Use lightweight static checks to catch ordinary mistakes without adding
   type-level programming.
5. Keep target capabilities in explicit extensions rather than hiding Web,
   Node, or Desktop behavior in Core. An application selects one application
   framework; capability and language extensions compose through a versioned,
   cycle-free semantic graph backed by ordinary npm dependencies. A future
   target such as Game must register its own syntax nodes, type families,
   semantic/editor categories, lowering, modules, runtime, and host contract
   through the same public extension protocol; adding it must not add Game
   names or branches to the Core AST, analyzer, formatter, or emitter.

VelarScript compiles to modern JavaScript. Look compiles to readable selectors,
CSS variables, and DOM bindings owned by the Web package. There is no VelarScript VM.

Desktop does not define a second source language. A Desktop application uses
one VelarScript module graph with the same components, JSX, Look, state,
derived values, and actions as Web. Files, paths, processes, HTTP, environment,
and native window hosting are permission-scoped framework capabilities.
Renderer/main processes and their versioned transport are internal security
boundaries, not user-facing project concepts. Host-effectful resource
acquisition such as `velar/process.start` is asynchronous on every target.

### 1.1 Runtime and JavaScript boundary authority

Every public operation belongs to one or more explicit boundary classes:
host-inherited behavior, compile-erased semantics, compiler lowering,
runtime-controlled behavior, a checked foreign ABI, or an explicit unsafe
boundary. These classes apply to operations rather than whole value families;
for example, records retain JavaScript reference identity while construction,
validation, and foreign entry use separate controlled boundaries.

Those classes also settle where a correctness question is answered. A question
the compiler can decide is decided at compile time. A question whose answer
exists only once a value has taken shape is decided by the runtime at the moment
it takes shape, loudly and by name: *the compiler cannot see this one* changes
the referee, it does not cancel the match. A question neither referee can reach
is a design question and is reported as one, rather than allowed to pass as a
silence. The rule is visible throughout this reference — a record literal at an
annotated position is closed because all of its keys are in front of the
compiler, while a value arriving from outside the program has none of them in
front of it and is judged by `Type.parse` at the moment it arrives (section 12)
— and it governs anything a later target adds: a check that moves off the
compiler moves onto the runtime, never off both.

This reference owns all user-observable semantics. The
[runtime and JavaScript boundary ledger](contributing/runtime-boundary.md) maps those
semantics to boundary classes, implementation owners, runtime ABI, failure
phase, and proof tests. The ledger and implementation may not add behavior that
is absent from or contradicts this reference.

### 1.2 Surfaces and their versions

The language and each target extension publish a **surface**: the complete set
of spellings a program can observe — the keywords, the resident namespaces, the
statement forms, the type-parameter bounds, the `velar/*` module members, and,
for the Web extension, the Look vocabulary. There are five. `core` is this
reference together with the standard library; `web`, `node`, `server`, and
`desktop` are the official target extensions.

Each surface carries a **surface version** of its own, separate from the npm
version every package in a release steps together. It is a counter, not a
compatibility grade: any addition, removal, or change to a surface raises that
surface's number by one, and a surface that did not move keeps its number, so
the number answers the one question an upgrade raises — which code has to be
re-read. This reference deliberately does not reproduce the numbers; a version
written into prose goes stale, which is the defect the mechanism exists to
remove. `velar --version` prints the five your toolchain ships, each changelog
section names the ones its release shipped, and a project may record the ones
it was written against in `velar.json`'s `surfaces`, where a mismatch with what
is installed is refused rather than allowed through.

An extension's surface version is the `apiVersion` of its published contract.
That field belongs to `protocolVersion: 1` and keeps its spelling; every text a
person reads calls it a surface version.

## 2. Files, comments, and blocks

VelarScript source files use the `.vel` extension.

```velar
// A normal comment.

/*
A block comment, which /* nests */ so commenting out a region that already
contains a block comment works.
*/

/// Documentation attached to the following declaration.
export def greet(name: string) -> string:
    const version = /* pinned by the release */ 1
    return f"Hello, {name} ({version})"
```

A `/* */` comment may sit inside a line, as above, or span lines. A multi-line
one occupies whole lines: only `/*` on its opening line and only `*/` on its
closing line, so the comment's extent is visible without reading to the end of a
code line. Nesting is counted, so an unclosed inner `/*` is reported as an
unterminated comment rather than silently swallowing the rest of the file, and
the formatter keeps a nested block together and reindents it with the block that
owns it.

Blocks use a trailing colon and indentation. Four spaces are conventional.
Tabs are normalized for indentation, but mixed or inconsistent indentation is
rejected.

```velar fragment
if ready:
    start()
else:
    wait()
```

Semicolons and braces are not statement syntax. Ordinary executable blocks use
the same two suite shapes as Python: one non-block statement may follow the
colon on the same logical line, while multiple statements and every nested
block use the indented form. This applies uniformly to functions, tests,
control-flow bodies and clauses, class executable members, and executable
blocks supplied by an active compiler extension. Structural bodies that list
members or branches — including `type`, `enum`, `class`, `component`, and the
`match` case list — remain indentation-owned.

```velar fragment
def stop(): return
```

A statement normally ends at its newline. One continuation form exists: a line
whose first token is `.` or `?.` continues the previous logical line, so
method chains can span physical lines in the familiar formatted style. The
continuation must follow the line it continues directly — no blank line and no
comment line between them — and must be indented past the statement being
continued; the canonical indentation is one level past it. A leading-dot line
that is not both is rejected rather than silently attached to whatever stands
above it, because a line beginning with a member step cannot be a statement of
its own. Trailing-dot continuation is not supported.

```velar fragment
const urgent = tasks
    .filter(task => not task.done)
    .map(task => task.title)
```

Inside brackets the newline is not a statement boundary at all. While `(`,
`[`, or `{` is open — a call's arguments, a parenthesized expression, a List, a
record, and the `{...}` of a JSX interpolation — line breaks and indentation are
insignificant, exactly as in JavaScript and Python, so a long expression wraps by
opening a bracket. A type argument list is not a bracket context: `Map<K, V>`
stays on one line.

```velar fragment
const total = (
    basePrice
    + shipping
    - discount
)
const rows = [
    {label: "open", count: 3},
    {label: "done", count: 7},
]
```

Those two rules are the whole story: leading `.`/`?.` continues a statement,
and an open bracket suspends the line rule until it closes. A bare operator at
the end of a line does not continue anything — `const total = basePrice +`
ends the statement after `+` and is reported there, so wrap the expression in
parentheses instead of trailing the operator.

A statement exists to do something. An expression statement is therefore
restricted to the shapes that can: a call, an assignment, `await`, and the
detached `detach` statement. A statement whose whole content is a value —
a comparison, a literal, a name, arithmetic, a `??` fallback, a conditional, an
index, a collection, a unary value, or a bare string — is rejected, because the
result is computed and thrown away. Each shape is answered with the thing the
author meant: a bare comparison teaches `=` or using the result, `++i` and
`--i` teach `+= 1` and `-= 1`, and a bare string teaches `//`, since a string
on its own line is a docstring habit rather than a comment.

## Advisories

Diagnostics are one channel. Advisories are the second. Most exist for the
spellings neither channel could honestly take: a spelling VelarScript accepts
with a meaning other than the one a Python or JavaScript reflex intended.
`const half = total // 2` binds `total`, because `//` opens a comment. Staying
silent about that is the trap the language exists to remove; rejecting it would
refuse a legal comment. So it is reported instead, in a channel of its own.
Several deliberately narrow canonicalization classes join those traps. When an
adjacent empty collection declaration and one identity-only loop are provably
the long spelling of an existing collection snapshot or constructor, the
compiler names that one built-in spelling. When a single-slot List loop is an
exact early-return query under one stable bool condition, the compiler names
`List.some`, `List.every`, or `List.find`. A transform, call, getter, side
effect, optional condition, wider body, computed source, or intervening
statement proves nothing and stays silent. When a closed target
literal mirrors two or more same-name fields from one typed record and every
remaining field is an identifier or literal override, the compiler names the
target-owned exact projection `Target.from(source, overrides)`. Partial
targets, spreads, mixed sources, and effectful overrides stay silent. When a
fresh List is filled only by appending or extending one stable per-item projection,
optionally under one stable bool guard, the compiler names `List.map`,
`List.filter`, `List.flatMap`, or their pipeline. Arbitrary calls, getters,
effects, destination reads, wider loop bodies, and computed sources stay
silent. An unguarded two-slot projection keeps the original List position in a
two-parameter callback; an indexed guarded projection stays explicit because a
later map would observe post-filter positions. A target extension may prove an
owned value expression, such as native Web JSX construction, without making
Core depend on that target's syntax.

An advisory **never blocks a build**. It is not a diagnostic with a softer
label: it travels in a separate list, and code generation is gated on the
diagnostics alone, so no advisory can stop an emit and no later change can
quietly promote one. `velar check` prints advisories, names their count in its
summary line, and exits 0. An editor shows an advisory as a warning, not an
error. Advisory ids are the `A` roster, deliberately not part of the `VEL`
diagnostic family. The roster is open-ended: an id joins it whenever a spelling
a Python or JavaScript reflex produces is accepted here with another meaning
and an unambiguous rewrite exists, or the exact collection-conversion proof
above has one canonical built-in replacement. The exact existential-query
proof and the bounded record-projection proof follow the same bar. No advisory's rule is stated in
this section; each is written where the rule it guards is. The roster today is `A1`
for `//` read as floor division and `A3` for `%` on a negative literal
(section 4), `A2` for a two-slot `for` written index-first (section 9), `A4`
for a keyed list rebuilt by `map` (section 14), and `A5` and `A6` for
JavaScript `${...}` in a string, without and under the `f` prefix (section 3).
`A7` reports a proven manual collection conversion and `A8` a proven manual
early-return List query (section 8). `A9` reports a proven manual exact record
projection and `A10` a proven large same-field mapped projection (section 6).
`A11` reports a redundant same-name query mapping in a Node `RoutePattern` and
mechanically removes its repeated `name=` prefix. `A12` reports a design token
reference written as free text in a Look property that accepts free text, and
rewrites it to the checked `token("--name")` spelling (section 17). `A13`
reports a proven manual List projection/filter builder and names the existing
collection pipeline (section 8). `A14` rewrites an exact bool-to-text
conditional in a native text attribute from `flag ? "true" : "false"` to the
equivalent `str(flag)` spelling (section 14). `A15`
reports an ordinary record entry whose identifier key and identifier value have
the same name, and rewrites `{name: name}` to the equivalent `{name}` shorthand
(section 3).

An advisory that is right about the line is answered by writing the unambiguous
spelling it names. An advisory that is wrong about *this* line is answered in
place, by a line comment that says why:

```text
const step = total // 2   // velar-allow A1: 2 is a step number, not a divisor
```

Three rules govern that comment, and each is enforced by an ordinary
diagnostic, so a badly written suppression fails the build the advisory itself
never could:

1. **It names one advisory.** `velar-allow` is followed by the id it silences.
   There is no blanket form; silencing a line wholesale would also silence the
   next advisory that lands on it.
2. **It gives a reason.** The text after the colon must be non-empty. A bare
   `velar-allow A1` is a compile error rather than a quieter advisory: a
   suppression with no stated reason is exactly the silence this channel
   replaces, and the reason is what reaches a reader through the diff.
3. **It expires.** A `velar-allow A1` on a line that does not raise A1 is a
   compile error too, so a suppression cannot rot in place and mislead a later
   reader about what the line does.

A suppression sits on the line the advisory is reported on, and covers that
line and that one id — a multi-line expression does not carry it downward. Only
a `//` line comment carries one; a `/* */` comment does not. The marker may
stand anywhere in the comment's text, so the ordinary shape above — the
advised code, then the clause — is read as one comment and works. The
formatter preserves the comment and its reason verbatim.

## 3. Bindings and literals

Bindings deliberately retain the familiar JavaScript words `const` and `let`.

```velar
const applicationName = "Atlas"
let attempts = 0
attempts += 1
```

- `const` cannot be reassigned.
- `let` can be reassigned.
- Binding mutability and value mutability are separate contracts. `const user`
  fixes which value the name refers to but does not make a record or collection
  read-only. Use a `readonly` type view when mutation through that reference
  must be forbidden.
- Both are lexically scoped.
- `$` is allowed in identifiers. Teams may use a leading `$` as a visual
  convention for values whose changes can affect the view, in the same spirit
  as `_` for a private-looking field, but the compiler never infers reactivity
  from the spelling. The `__velar` prefix is the sole exception: it belongs to
  hygienic generated JavaScript and cannot begin a source binding.
- A binding cannot be declared twice in the same scope.
- Shadowing follows ordinary lexical lookup everywhere, including module
  reactive bindings: a parameter or local binding may reuse a `state` name,
  and inside that scope the name is that ordinary binding.
  Reads and writes of a shadowing binding are ordinary lexical reads and
  writes; only assignment that resolves to the module reactive binding itself
  publishes an update.
- A shadowing declaration owns its name for its entire scope. Referencing the
  shadowed outer binding anywhere in that scope before the declaration —
  including in the declaration's own initializer — is a compile-time error,
  because emitted JavaScript would read the not-yet-initialized shadow.
  Rename the shadow, or read the outer value in an enclosing scope, to keep
  both values reachable. A function parameter default reads the enclosing
  scope and is not affected by a body shadow. A for-loop binding owns its
  name the same way in the loop head and body: the iterable expression
  cannot reference the outer binding the loop pattern shadows. Because the
  loop binding's scope begins at the loop head, reading the iterable into a
  differently named binding earlier in the same scope stays legal.
- Core bindings and the JavaScript host capabilities used directly by generated
  runtime code cannot be shadowed. An extension's contextual keywords follow
  ordinary lexical lookup, so a local `state` or `look` naturally wins.
  An extension may reserve an actual runtime entry point such as Web `mount` or
  `tick` when shadowing would make emitted behavior ambiguous.
- Binding names beginning with `__velar`, case-insensitively, are
  reserved for hygienic generated helpers. Object fields and JavaScript
  property names are unaffected because they cannot capture a lexical helper.
- Most declaration words are **contextual**, not reserved. Core's eleven are
  `as`, `case`, `constructor`, `from`, `get`, `json`, `match`, `readonly`,
  `test`, `type`, and `using`; the compiler owns that roster as
  `CORE_CONTEXTUAL_KEYWORDS`, and
  this sentence quotes it rather than keeping a second copy of it. Every word
  the Web extension adds — `component`, `state`, `computed`, `resource`,
  `action`, `watch`, `look`, `keyframes`, `css`, `expose`,
  `exposes` — belongs
  to the same family, and the compiler owns that roster as
  `WEB_CONTEXTUAL_KEYWORDS`.
  All of them are ordinary names anywhere a name can stand: a binding, a
  parameter, a loop binding, a named argument, a record field, a member name,
  and a record shorthand. Each becomes a declaration only in the shape that
  declaration has, and nothing else can take that shape. Where the two readings
  could compete, the name wins: `match(value)` calls a function, `state = 1`
  assigns a binding, `look.brand` reads a field, `readonly: number` declares a
  field named `readonly`, and `{match}` is the record shorthand for a binding
  of that name.
- `case` is the one word with a shorter reach, and only in the three positions
  that **bind**: JavaScript reserves it, so a binding, a parameter, or a loop
  binding named `case` would not parse in the emitted module. As a record
  field, a member name, a named argument, a record shorthand, and a `match`
  branch it reads as a name like the rest.
- The words that stay reserved are the ones JavaScript reserves — including
  `enum` and `case` — the operator words `in`, `is`, `and`, `or`, `not`, and the
  structural words `def`, `class`, `if`, `else`, `while`, `for`, `return`,
  `import`, `export`, `const`, `let`, `try`, `catch`, `finally`, `throw`,
  `async`, `await`, `assert`, `abstract`, `override`, `static`, `private`,
  `extern`, `unsafe`, `pass`, `break`, `continue`, `extends`, `super`, and
  `self`. Using one as a binding name is reported by name. `constructor` and
  `get` are **not** among them: both name a class member in their own shape and
  are ordinary names everywhere else, which is what puts them on the roster
  above.
```velar
const event = {type: "ping", from: "worker"}
const {type, from} = event          // ordinary names
const state = "ready"               // an ordinary binding, in a Web module too
const match = "ping"                // and so is a word with a statement shape

type Payload:                       // a name and ':' — the declaration
    type: string
    readonly: number                // a field named 'readonly', not a modifier
    readonly get: string            // the modifier, over a field named 'get'

const shorthand = () => {match}     // a record built from the binding above
const constructor = shorthand().match

match type:                         // a header ending in ':' above a block
    case "ping":
        print(state + from + constructor)
    case _:
        pass
```

### Context markers: `@name`

VelarScript calls `@name` a **context marker**. `@` is the **marker
introducer**: it attaches a compiler-owned compile-time role to the declaration
or structural entry immediately after it, with the accepted name and role
chosen by the current syntactic context. The marker never chooses its own
meaning. The module context therefore accepts `@main:`, a class accepts
`@dispose:` and `@iterate:`, a component accepts `@mounted:` and `@cleanup:`,
and Look accepts names such as `@hover` and `@before:` under one marker rule,
not separate entry, decorator, lifecycle, selector, or protocol meanings for
`@`.

The contract is closed and static:

- A context marker never performs lexical or member lookup. It cannot be
  shadowed by an author's binding, and `@` is not an identifier character, so
  `def mounted()` and `@mounted:` can coexist without collision.
- Core or the active syntax-owning compiler extension owns every accepted
  marker and the contexts in which it is valid. Source code and libraries
  cannot declare, import, export, alias, or register an `@name`. An unknown
  name, or a known name in the wrong context, is a compile-time error that
  names the vocabulary accepted there.
- A context marker is not an ordinary runtime value. It cannot be stored,
  passed, returned, called, reflected, or assembled dynamically. The compiler
  resolves its role statically and lowers that role directly; no `@` name or
  decorator lookup survives in emitted JavaScript.
- Any punctuation or payload a particular role permits after `@name` belongs
  to that role's grammar. Parentheses, if a future compiler-owned role defines
  them, carry static compiler input; they do not turn a context marker into a
  function call or a runtime wrapper around the following declaration.
- One role has one accepted spelling. A compiler diagnostic may recover from a
  retired bare spelling to continue checking the file, but the recovered form
  remains an error, never an alias. New contextual roles in this family use
  a context marker; they do not add a competing bare keyword for the same role.

This rule does not apply to `@` characters inside strings, module specifiers,
comments, or extension-owned embedded foreign source: those are data for their
own grammar, not VelarScript `@name` syntax.

At module scope, `@main` is the one compiler-owned program-entry role. A module
may declare it once, as its final top-level region, with either a one-statement
suite or an indented body:

```velar
def run():
    print("ready")

@main: run()
```

```velar
class Application:
    async def start():
        return null

def createApplication() -> Application:
    return Application()

@main:
    const application = createApplication()
    await application.start()
```

Only a source selected as a program entry executes this region. Importing the
same source checks its complete `@main` body but does not run or emit that body.
Bindings declared inside the region are local to it; it is not a function, has
no parameters or return value, and cannot be exported or called. When a module
declares `@main`, its executable module statements belong inside that region;
imports, values, types, functions, classes, tests, and extension-owned module
declarations remain outside it. Test modules use named `test "…":` declarations
and do not also declare a program entry.

The Node extension applies this same rule to HTTP servers. Directly inside a
`server` declaration, `@get`, `@post`, `@put`, `@patch`, `@delete`, and
`@websocket` select one compiler-owned route role, while `@notFound` selects the application's one
unmatched-path fallback. They are anonymous structural declarations, not
decorators and not references to functions of those names. A route's first
item is the Node-owned path-pattern literal `p"..."`:

```velar
export server articles:
    @get(p"/articles/{id:string}?{details:bool?}"):
        return {id, details: details ?? false}

    @notFound() => {error: "not_found"}
```

`p"..."` is not a fifth Core string prefix. Core owns ordinary, raw, and
interpolated strings; only an active `@velarscript/node` lexical extension
recognizes the first-class `RoutePattern` value. The extension checks the
entire literal at compile time. It must be a normalized absolute path; a path
capture occupies one complete segment and has the exact `{name:type}` form
with a half-width `:`. Query fields follow the same contract after `?`; a type
suffix `?` makes that field optional, and an explicit `wire-name={name:type}`
may map a different URL name. An explicit same-name mapping remains valid but
advisory `A11` rewrites it to `{name:type}`. A capture type is `string`, `number`, `bool`, or
a named enum type. An inline pattern projects its captures and query fields as
immutable handler locals. A referenced pattern must be explicit about its
namespace with `@get(articlePath as route)`; that `RouteMatch` exposes
`route.pattern`, `route.pathname`, `route.params`, and `route.query`, while
`str(route)` and `str(route.pattern)` return the complete declaration. The obsolete `path=`
spelling is rejected with a mechanical positional-and-`as` fix. A single concrete Data record on
`POST`, `PUT`, or `PATCH` is the
checked JSON body, and `Request` is the explicit low-level request input.
Route bodies are async-capable without an `async` modifier and use either
`=> expression` or the ordinary indented `:` block. A plain string in the path
position, an interpolated `f"..."`, an escaped path pattern, an unknown
compiler-owned verb, or a route role outside a `server` block is a compile-time
error.

Literals are intentionally small:

```velar
const title = "VelarScript"
const count = 42
const budget = 1_000_000
const ratio = 0.75
const enabled = true
const missing = null
const message = f"{title}: {count}"
const payload = `{"name":"Nova","role":"admin"}`
const poem = "
    first line
    second "quoted" line
"
const report = f"
    owner: {title}
    count: {count}
"
const windows = r"C:\Users\foo"
const asset = rf"{windows}\assets\main.js"
const values = [1, 2, 3]
const user = {id: "user-1", title}
```

`null` is the only ordinary empty value. `undefined`, `none`, and `None` are
not VelarScript values.

A string is delimited by double quotes or by backticks. The two produce the
same `string` value with the same capabilities — the same escapes, the same
prefixes, the same positions — and only the escaping differs, because `"` is
ordinary text inside a backtick string. That is the case backticks exist for: a
JSON body, an HTML fragment, or a quoted attribute selector is written once
instead of escaped character by character.

```velar fragment
const payload = Json.parse(`{"name":"Nova","role":"admin"}`, User)
```

Single-quoted strings are rejected, with a message naming both legal
delimiters. `'` is ordinary text inside either one, and `\'` is accepted as
well, so text pasted from another language does not need editing.

An inline string must close before its physical line ends; otherwise the lexer
diagnoses that line and resumes at the next one. A backtick string is always
inline: a line break inside one receives the same guidance to a layout string
that a double-quoted inline string does. A double quote followed immediately by
a newline instead opens a layout string. Its first nonblank content line
establishes a structural indentation margin, and a quote back at the opening
line's indentation closes the value:

````velar fragment
const markdown = "
    ```html
    <script>alert(1)</script>
    ```
"
````

The opening and closing newlines and the structural margin are syntax, not
text. Internal line endings, blank lines, quotes, and indentation beyond that
margin are preserved exactly; there is no common-dedent or trim pass. A dedent
without the closing quote diagnoses the layout string before the dedented line,
so following code remains independently lexable. Multi-line text is therefore
the layout string's job and single-line text is the inline string's; a backtick
string never spans lines, and a layout string is always double-quoted.

Outside a raw string, both delimiters keep the familiar `\\`, `\n`, `\r`, `\t`,
`\"`, and `\'` escapes, plus `` \` `` for a literal backtick and `\u{...}` for
a code point. `\u{...}` takes one to six hexadecimal digits and produces that
code point, so `"\u{1F525}"` is one emoji. A value above `U+10FFFF` is rejected,
and so is a surrogate in `U+D800`–`U+DFFF`, which keeps every literal free of
lone surrogates. `\uXXXX` and `\xNN` are not second spellings: both receive a
direct message teaching the braced form.

The only string prefixes are `f`, `r`, and `rf`, and the prefix is independent
of the delimiter — all combinations exist, and `f` interpolation stays
`{expression}` in both. `f` enables interpolation, `r` makes backslashes
literal, and canonical `rf` combines both. `fr` receives a direct “use `rf`”
diagnostic rather than becoming a second spelling. In a raw inline string,
backslash never escapes the closing delimiter, so `r"C:\path\"` includes the
final backslash; a delimiter inside raw inline text is doubled, in whichever
delimiter the string uses: `r"He said ""hello"""`. Layout-string quotes are
ordinary content unless they appear as the dedented closing delimiter. Literal
interpolation braces in an `f` or `rf` string remain `{{` and `}}`. JavaScript
`${...}` is never interpolation — in a backtick string it is literal text,
exactly as in a double-quoted one, because generating JavaScript source is a
real use of these literals. That use is why the spelling cannot be rejected, so
the compiler points the JavaScript reflex at the `f` prefix instead: advisory
`A5` reports `${...}` in a string carrying no prefix, and `A6` reports it under
`f` or `rf`, where the `$` holds the brace after it literal and the
interpolation the author meant never happens. Each quotes the whole rewritten
literal — `f"Hello {name}"` — when that rewrite is mechanical and stays short,
and otherwise teaches only the occurrence it names: the `{name}` the author
should have written. Either way it reports once per string. A string that really
is generating JavaScript source answers with a reasoned `velar-allow`.
Triple-quoted strings are not part of the language; that spelling receives
guidance to a quoted layout string.

Both delimiters are legal wherever the author writes, but formatted source has
one spelling per string. `velar format` picks the delimiter from the text:

| String content | Canonical delimiter |
|---|---|
| no `"` | `"..."` |
| a `"` and no `` ` `` | `` `...` `` |
| both | whichever escapes fewer characters; a tie takes `"..."` |

The rule is deterministic, so any given text has exactly one formatted
spelling, and formatting is idempotent. It applies to inline strings of every
prefix; a layout string keeps its double quotes because its content is text.

Source hygiene is part of the lexer, not a linter. All twelve `Bidi_Control`
code points (`U+061C`, `U+200E`, `U+200F`, `U+202A`–`U+202E`, `U+2066`–`U+2069`)
cannot appear literally anywhere in a source file — not in a string, not in a
comment — because that is exactly how source is made to read differently than
it runs. The only way one enters a program is `\u{202E}` inside a string, which
stays visible to a reviewer; and because that escape is legal, a test report
that quotes author text escapes it again before printing, so a verdict line
cannot be reordered on the reader's terminal. Other control characters — `U+0000`–`U+001F` other than the line
endings a layout string owns, `U+007F`, and `U+0080`–`U+009F` — are rejected
inside a literal with the same guidance to `\u{...}`, so a tab inside text is
written `\t` and only structural indentation may be a real tab. Characters that
carry meaning in ordinary text are deliberately untouched: the zero-width joiner
(`U+200D`) that builds emoji families, variation selectors such as `U+FE0F`,
and the zero-width space all remain legal literal content.

Number literals accept `_` as a digit-group separator between digits, in the
integer part, the fraction, and the exponent alike: `1_000`, `1_000.5`, and
`1e1_0` are all legal, and the separator is not part of the value. A separator
that is not between two digits — leading, trailing, or doubled — is rejected.
Integer literals also accept the explicit radix prefixes `0x`, `0b`, and `0o`:
`0xff`, `0b1010`, and `0o17`. Their digits are checked for the selected base,
their value must remain finite like every other number literal, and formatting
preserves the author's explicit radix.

An integer literal must also be exactly representable. A literal written as an
integer — no fraction part, no exponent, in any radix — whose value cannot be
held exactly is rejected, so `9007199254740993` and `0x20000000000001` are
errors rather than silently becoming `9007199254740992`. The report quotes the
literal as the author wrote it, digit separators and radix prefix included,
beside the value it would have become. A literal that spells a decimal — one
carrying a fraction part or an exponent — keeps the ordinary nearest-value
reading, so `0.1`, `1e21`, and `9007199254740993.0` are unaffected. A language
whose whole claim is that a silent mistake elsewhere is a compile error here
cannot compile a literal to a different number than the one on the page.

A legacy leading zero
(`007`), a point with no digit on one side (`.5`, `5.`), and bare `Infinity` or
`NaN` remain rejected. The last two values are produced by arithmetic (`1 / 0`,
`0 / 0`) and detected with `value.isNaN()` rather than written.

A bare `return` returns `null`, including at JavaScript and asynchronous
boundaries. Falling through a function without another result has the same
meaning.

Object fields support JavaScript-style shorthand. Spreads are supported in
records and lists:

```velar fragment
const nextUser = {...user, title: "Owner"}
const nextValues = [...values, 4]
```

The explicit `{id: id}` form remains legal, but advisory `A15` offers the
equivalent `{id}` shorthand when the key and value are the same ordinary
identifier. Quoted keys, aliases, member reads, calls, and parenthesized values
remain explicit mappings. A comment inside the entry keeps the advisory but
withholds its mechanical rewrite, while commas, surrounding layout, and a
trailing comment sit outside the edit and remain byte-for-byte unchanged.

Record construction is controlled even though its surface stays familiar.
Fields evaluate once from left to right, later fields replace earlier fields,
and names such as `__proto__` are ordinary own data fields rather than object
literal magic. Object spread copies only own enumerable string data fields. It
never invokes an accessor, ignores the source prototype, rejects symbol fields,
and converts an unsafe JavaScript `undefined` field to `null`. Direct `await` is
valid anywhere in an async record expression without adopting Promise-valued
fields that were not explicitly awaited.

Declarations and `for` loops share one controlled binding-pattern contract:

<!-- velar-preamble
type Profile:
    name: string
    nickname: string
    tier: number

const profile: Profile = {name: "Ada", nickname: "ada", tier: 1}
const values = [1, 2, 3]
const pairs: List<List<string>> = [["region", "north"]]
-->
```velar fragment
const {name, nickname, ...details} = profile
const [first, ...rest] = values

for [key, value] in pairs:
    print(f"{key}: {value}")
```

Object bindings read present own enumerable data fields and never invoke
accessors. A field declared with an optional `T?` contract may be absent and
binds `null`; a missing required field fails at the binding instead of leaking
JavaScript `undefined`. Object rest produces a new ordinary record containing
the remaining enumerable data fields.

List bindings use one shape rule everywhere. Without `...rest`, the List must
have exactly as many items as the pattern, so `[first, second]` requires two.
With `...rest`, it must contain at least the fixed prefix, so
`[first, ...rest]` requires one or more and creates a fresh List for `rest`.
The same rules apply to nested declaration patterns and `for` bindings. Use
`match` when shape mismatch is an expected branch; binding mismatch is a
runtime error because a declaration asserts that shape.

## 4. Operators

VelarScript keeps familiar operators but removes coercive JavaScript behavior.

```velar fragment
const total = price * quantity
const accepted = total >= 10 and enabled
const label = accepted ? "Accepted" : "Rejected"
const fallback = optionalValue ?? defaultValue
```

The fallback is checked only for the null path and receives the expected result
type. This keeps direct fallbacks such as `names ?? []`, `scores ?? Map()`, and
`callback ?? (value => value)` fully typed without extra annotations.

Logical operators are `and`, `or`, and `not`; `!` before a value is the
JavaScript spelling and is rewritten to `not`. After a value the same
character is the required-value unwrap, a different operator entirely
(section 5). Their operands are `bool` or
`bool?` — an absent `bool?` behaves as `false` — and they are not general
value-selection operators: an operand of any other optional type is rejected,
because a condition judges truth rather than presence (section 9). `and` and
`or` short-circuit in source order, and the right side receives the facts
established by the path that reaches it, so an explicit presence test narrows
for the rest of the expression: `user != null and user.active` and
`user == null or not user.active` need no optional-access workaround.

`??` never shares one bare chain with `and` or `or`: the two possible
groupings read differently, so the mix requires explicit parentheses.
`(flag or name) ?? fallback` and `flag or (name ?? fallback)` are both legal
spellings; the unparenthesized mix is rejected with guidance. Pure `??`
chains and pure `and`/`or` chains are unaffected.

A writable `bool` reverses with ordinary assignment:

```velar fragment
let active = false
active = not active
panel.visible = not panel.visible
flags[index] = not flags[index]
```

This is a plain read-modify-write, exactly as in JavaScript and Python:
receivers and indexes on both sides evaluate per ordinary expression rules.
There is no dedicated toggle statement, and `invert` is an ordinary
identifier — a name, a function, a field. The removed `invert x` statement is
the one shape that is not: it is answered with `x = not x`.

Equality uses `==` and `!=` in source and compiles to SameValueZero
comparison: strict identity/value equality with one repair — `NaN == NaN` is
`true`. Equality is therefore reflexive (`x == x` always holds) and agrees
with `Set` and `Map` key identity and with List membership (`has`, `index`,
`count`, `remove`, `in`). `-0 == 0` stays `true`. There is no coercive
equality spelling. Comparisons whose operands cannot both be numbers compile
to plain JavaScript `===`; only number-capable comparisons carry the NaN
repair.

`==` and `!=` require the two operand types to **intersect**: some single
value must be able to inhabit both. `1 == "1"`, `user == "a"`, `true == 1`,
`List<number> == List<string>`, and a comparison between members of two
different enums are compile errors, because a strict comparison between types
that share no value is a constant, and a silently constant condition is a
logic bug rather than a coercion bug. Intersection is decided by
assignability in either direction, so structurally identical records
intersect regardless of their names, a partial union overlap
(`(string | number) == string`) is enough, and `unknown` or `any` on either
side stays legal. `null` inhabits every optional, so `value == null` and
`value != null` — the language's only null test — are unaffected; a
comparison of a *non-optional* value against `null` is rejected as the
constant it is, with guidance to drop the check or declare the value
optional.

The one place assignability does not decide is an enum against the scalar its
wire values are. An enum member converts to that scalar — `string` for a
string-backed member, `number` for one pinned to an integer — as a one-way wire
exit (section 6), and equality is symmetric, so honoring that direction here
would open a read path around `Enum.parse`. `raw == Kind.textDelta` is therefore rejected and teaches both
honest spellings together with the rule for choosing between them, because they
differ on the value the author has not thought about yet — an unknown one.
`Kind.parse(raw) == Kind.textDelta` states that the text must name a member:
`parse` throws on anything else, which is right for a closed set and wrong for a
protocol that must ignore tags it does not know. `str(Kind.textDelta) == raw`
compares strings deliberately and answers `false` for an unknown value, which
is what a forward-compatible wire handler needs. The boundary holds through
union arms: a `Kind | string` operand still puts a raw string
and an enum member into one comparison, so it is rejected with guidance to
narrow first (`if value is Kind:`) — the enum domain and the string domain
never meet in `==`. An enum pinned to integers draws the same boundary against
`number`, so `code == Proto.v2` against a bare number is refused for the same
reason and by the same rule. The same intersection requirement (including the
enum/string boundary) governs every membership probe — `in`, `has`, `index`,
`count`, `remove`, and the key of `Map.get` — because a membership test asks
the `==` question one element at a time.

A freshly constructed collection literal is rejected as an equality operand:
collection `==` is reference identity, and a `[1] == [1]` comparison builds a
new object that can never be identical to anything, so the result is provably
constant. Content comparison has its own spelling: the prelude function
`equals(a, b) -> bool` compares data structurally — Lists ordered
element-wise, Sets as the same member set, Maps as the same key/value pairs,
records as the same field set — with SameValueZero at the leaves, so `NaN`
agrees with `==`. Its operands must intersect, exactly like `==`. Class
instances are rejected (behavior objects compare by identity — use `==`),
as are functions, Promises, and unvalidated `unknown`/`any`; cyclic
structures throw, the same stance `stringify` takes.

Ordered comparisons accept numbers with numbers or strings with strings.
Ordering is exactly that set — `number`, `string`, and a union whose members
are all one of those two categories. String order is Unicode code-point order
(identical to UTF-8 byte order) on every ordered surface — the operators,
`min`/`max`, default `sorted()`, and ordered keys — never UTF-16 code-unit
order, so an astral character always orders after every basic-plane one. Enums are excluded: an enum's runtime
value is its wire value — the member's own name unless the declaration maps one
— so ordering enum members sorts them by that, which is never the order the
author means. One rule answers "is this ordered"
for `<`, `<=`, `>`, `>=`, `min()`, `max()`, default `sorted()`,
`sorted(by=selector)`, and the `sortBy`/`minBy`/`maxBy` keys, so no two of
them can disagree. A business order is stated explicitly —
`sorted(by=row => row.rank)`, an explicit comparator, or a string-backed enum
whose values encode the order (`low = "1-low"`).

One policy governs `NaN`. A `NaN` may be held, passed, and stored, and
`value.isNaN()` is the one legitimate way to ask whether you have one. Any
operation that orders or aggregates a `NaN` raises instead of answering, because
a plausible-looking answer derived from an unordered value is worse than a stop:
the ordered aggregations (`sum`, `min`, `max`, default-ordered and `by=`-keyed
`sorted`), `Math.min`, `Math.max`, and `Math.clamp` all raise, and so does the
ordering a `Comparable`-bounded type parameter uses — the comparison a generic
performs when the category of its two values is known only at run time. Each of
them names `filter(x => not x.isNaN())` as the way out.

The bare relational operators on a plain `number` are the exception, and the
exception is deliberate. `<`, `<=`, `>`, and `>=` keep IEEE behavior there:
every ordered comparison against `NaN` is `false`, which is the defined and
universally known answer, and the compiler can see the category at the site. A
generic ordering primitive has no such option — it must return an ordering, and
a `NaN` has none to return. Answering "equal" is what made `NaN <= x` and
`NaN >= x` both true inside a generic while the identical source on a plain
`number` answered `false`, and it produced genuinely mis-sorted output.

Python-style comparison chains evaluate each operand once:

```velar fragment
assert 0 < percentage <= 100
assert high >= middle > low
```

Each later operand is checked only under the facts established by every earlier
successful link. When the complete chain is true, those facts are available in
the controlled body.

A chain must point one way. `<` and `<=` chain with each other and `>` and `>=`
chain with each other; a mixed-direction chain such as `a < b > c` is rejected
and asks for `and`, because it reads as a range in Python and as a comparison of
a boolean in JavaScript and there is no reading that is obviously right.
Equality never chains: `a == b == c` is rejected outright with the same
guidance, since the two languages disagree on it and the `and` spelling says
which comparison is meant. `in` and `is` are not chain links either — a
membership or type test used inside another comparison must be parenthesized,
`(a < b) in flags`, or split with `and`.

Power uses `**`. Membership uses `in`, with `not in` as its direct negative.
Runtime type checks use `is`, with `is not` as its direct negative:

```velar fragment
if "admin" in roles:
    print("Allowed")

if route not in ignoredRoutes:
    print("Visible")

if candidate is User:
    print(candidate.name)

if candidate is not Error:
    print("Usable")
```

Membership evaluates the candidate first and the collection second, exactly
once each in source order. The controlled helper uses that same source-shaped
argument order. A runtime type test also evaluates its value exactly once,
including union and structural checks. `not (value in collection)` and
`not (value is Type)` remain ordinary logical compositions, but canonical
source uses `value not in collection` and `value is not Type`. An `is` target
is always a concrete runtime type; `null` is a value, so a null test is
spelled `== null` or `!= null`, and the removed `is null` / `is not null`
spellings receive guidance to the equality form.

Bitwise computation uses `~`, `&`, `|`, `^`, `<<`, `>>`, and `>>>`, with the
matching compound assignments. It is a strict 32-bit integer boundary rather
than JavaScript coercion: each data operand must be an integer in
`[-2147483648, 4294967295]`, and a shift count must be an integer from 0 through
31. A fraction, `NaN`, infinity, a wider integer, or a wrapped shift count throws
before the host operator runs. Results follow the familiar signed result for
`~`, `&`, `|`, `^`, `<<`, and `>>`; `>>>` produces the unsigned 32-bit result.

### Precedence and associativity

This is the complete table, loosest binding first. Assignment is a statement
rather than an expression, and there is no comma operator.

| Level | Operators | Associativity and notes |
| --- | --- | --- |
| 1 | `=>` | The arrow body extends as far as it can; a multi-statement body needs a named `def`. |
| 2 | `?:` | Right-nesting, so `a ? b : c ? d : e` groups as `a ? b : (c ? d : e)`. As an operand of any binary operator it must be parenthesized. |
| 3 | `??` | Left to right. Never shares a bare chain with `and`/`or`. |
| 4 | `or` | Left to right, short-circuit. |
| 5 | `and` | Left to right, short-circuit. |
| 6 | `|` | Left to right. |
| 7 | `^` | Left to right. |
| 8 | `&` | Left to right. |
| 9 | `== != < <= > >=`, `is`, `in` | The comparison layer. `<`/`<=` chain with each other and `>`/`>=` chain with each other; `==`/`!=` never chain, and a mixed-direction chain is rejected. `is` and `in` are not chain links: inside another comparison they must be parenthesized. |
| 10 | `<< >> >>>` | Left to right. Shift counts are checked integers from 0 through 31. |
| 11 | `+ -` (binary) | Left to right. |
| 12 | `* / %` | Left to right. `%` keeps JavaScript's sign, so `-3 % 2` is `-1`. |
| 13 | `not`, `~`, unary `+ -` | Binds *looser* than `**`. |
| 14 | `**` | Right to left, so `2 ** 3 ** 2` is `512`. |
| 15 | `await`, `try` | Prefix, tighter than every operator above. `try` reaches exactly as far as `await` does — over the whole postfix chain that follows it, and no further. |
| 16 | `()`, `.`, `?.`, `[]` | Postfix, left to right; the tightest level. |

Two rows have consequences worth stating outright.

Unary minus is looser than `**`, so `-2 ** 2` is `-4` — Python's grouping,
`-(2 ** 2)`. Write `(-2) ** 2` for `4`.

Member access is tighter than unary minus, so `-2.abs()` is `-2`: the method
runs on `2` and the sign applies to the result. Write `(-2).abs()` for `2`.
Member access on a number literal needs no ceremony either — `1.abs()`,
`1 .abs()`, and `(1).abs()` are all legal and all mean the same thing, because
`1.` is not a number literal in this language (section 3) and therefore cannot
swallow the dot.

`//` is always a comment, in every code position. There is no floor-division
operator, and `7 // 2` binds `7`: the comment starts at `//`, and the statement
before it is already complete. The compiler cannot rule the line out — a comment
is legal there — so it advises instead, and advisory `A1` reports the line while
still emitting. Floor division is `(a / b).floor()`.

"Code position" is the same boundary section 3's `@` rule draws: a string, a
module specifier, and extension-owned embedded foreign source are data for
their own grammar, so a `//` inside one is whatever that grammar says it is and
not a comment. `"http://host"` is a string containing a URL, and a Web
extension's markup children are text. Because a comment is the reading an
author expects there and never gets, an embedded grammar that has no comment
form must refuse the shapes that can only be comment attempts rather than
accept them as data; the Web extension's `VEL5002` is that refusal.

`%` keeps the dividend's sign for the same reason JavaScript does, so `-7 % 3`
is `-1` where Python answers `2`. A literal negative dividend draws advisory
`A3`, which names both answers and gives the Python one as `((a % b) + b) % b`.
A variable dividend draws nothing: its sign is not on the page.

## 5. Core types

The built-in Core types are:

- `string`
- `number`
- `bool`
- `null`
- `List<T>`
- `Set<T>`
- `Map<K, V>`
- `Record<T>`
- `Promise<T>`, with bare `Promise` as `Promise<null>`
- `T?`
- small unions such as `string | number`
- enum singleton types such as `Status.pending`
- function types such as `(string, number) -> bool`, plus the positional
  `Function<Input..., Result>` shorthand
- read-only data views such as `readonly User` and `readonly List<User>`
- `unknown` for unvalidated dynamic input

`any` is not a type VelarScript source may write. The word is refused in every
annotation position, and the message names `unknown` — which is also what an
undeclared foreign value arrives as. Ordinary VelarScript code uses `unknown`
and validates it before use (section 12).

`Promise` and `Function` have bounded convenience spellings that normalize to
the existing Core types; they do not introduce runtime constructors or a second
callable model:

| Shorthand | Canonical type |
| --- | --- |
| `Promise` | `Promise<null>` |
| `Function` | `() -> null` |
| `Function<Result>` | `() -> Result` |
| `Function<Input, Result>` | `(Input) -> Result` |
| `Function<First, Second, Result>` | `(First, Second) -> Result` |

For `Function<...>`, the final type argument is always the result and every
preceding argument is a positional input. Use the canonical arrow form whenever
the contract needs parameter names, optional parameters, or a rest parameter.
`Function<>` and `Promise<>` are invalid. This does not expose JavaScript's
`Function` or `Promise` constructors as built-in callable values; the shorthand
spellings exist only in type positions.

#### The two arrows, and the two async positions

The language writes two arrows and they never trade places. `=>` introduces a
lambda **body** and appears only in a value; `->` introduces a **result type**
and appears only in a type. A function type written with `=>` is refused with
the rewrite named.

The same pair of positions asks for opposite async spellings, and both are
right. A *declaration* carries `async`, so its result annotation names the
resolved value. A function *type* carries no `async` and describes the value
the call hands back, which is a Promise. They are written side by side here
because seeing only one of them makes the other look like a mistake:

<!-- velar-preamble
type User:
    id: string
    name: string

async def fetchUser(id: string) -> User:
    return {id, name: "Ada"}

type Api:
    user: (id: string) -> Promise<User>

const api: Api = {user: fetchUser}
const users: List<User> = []
-->
```velar fragment
async def loadUser(id: string) -> User:                  // declaration: '-> User'
    return await api.user(id)

const named: (id: string) -> Promise<User> = loadUser    // type: '-> Promise<User>'
const inline: (id: string) -> Promise<User> = async (id: string) => await api.user(id)

const titles = users.map(user => user.name)              // '=>' opens a body
const project: (user: User) -> string = user => user.name
```

A named parameter in a function type may end its name with `?`, which says the
argument may be **omitted**. That is a statement about arity, and it is a
different statement from `T?`, which is about the value: `prefix?: string`
allows a one-argument call and still rejects `null`, while `prefix: string?`
requires both arguments and accepts `null` as one of them. The two answer
different questions — "must I pass this?" and "may this be absent?" — so a
contract that means both writes both: `prefix?: string?`. Only a named
parameter carries the marker, because `?` after a bare type is already `T?`;
a positional function type has no way to say "omissible" and does not need one,
since the name is what a caller omits by.

```velar
def label(name: string, prefix: string = "@") -> string:
    return f"{prefix}{name}"

def tag(name: string, prefix: string?) -> string:
    return f"{prefix ?? "@"}{name}"

const omissible: (name: string, prefix?: string) -> string = label
print(omissible("ada"))
print(omissible("ada", "#"))

const nullable: (name: string, prefix: string?) -> string = tag
print(nullable("ada", null))
```

This marker lives in a function type, not in a declaration: a `def`, a field,
or a binding says the same thing with a default value or with `T?`. Section 19
rejects `let name?: T` for that reason and not as a ban on the character.

A function that declares **fewer** parameters than a contract satisfies it: the
arguments it did not ask for are passed and ignored, so `a => a` is a
`(a: number, b: number) -> number`. What a function may not do is require an
argument its contract does not guarantee — a `(a: number, b: string) -> bool`
needing `b` is not a `(a: number) -> bool`, which never passes one. This is why
a one-parameter callback satisfies a collection contract that hands every
callback `(value, index)` (section 8).

VelarScript does not provide TypeScript conditional types, mapped types,
overload sets, declaration merging, or type assertions. Type parameters exist
on `def` functions and on `type` records; generic `class` and `component`
declarations are not part of the language.

### Read-only data views

`readonly T` is a compile-time view over typed data, not a second runtime
collection family and not an implicit `Object.freeze`. The emitted JavaScript
keeps the same object identity. Mutable data may flow into a read-only
parameter or binding; a read-only view cannot flow back into a mutable
contract because that would let the recipient mutate through the alias.

```velar fragment
readonly type Profile:
    id: string
    details: Details
    tags: List<Tag>

def display(profile: readonly Profile) -> string:
    return profile.id + profile.details.label

const owned: Profile = loadProfile()
let selected: readonly Profile = owned
selected = loadProfile()
print(display(owned))
```

`readonly type Name:` is the declaration-level spelling when every field is
read-only. It covers fields inherited from a base record as well as fields
written in the body. Use the field modifier only for a deliberately mixed
record whose remaining fields stay writable.

A `readonly` record view is transitive through reads: `profile.details`, list
elements, Map keys and values, Set elements, Record values, destructuring, and
shallow spreads retain read-only views of shared nested data. A new collection
returned by `copy`, `slice`, `values`, or similar operations owns its outer
container and may be changed, but any aliased elements obtained from the
read-only source remain read-only. This prevents a shallow copy from becoming
a mutation escape hatch. Read-only `List`, `Set`, `Map`, and `Record` views are
covariant in their element, key, and value types because their checked surface
cannot insert a wider value. Mutable collections remain invariant.

`readonly` applies only to named record types, structural object data, `List`,
`Set`, `Map`, and `Record`. Aliases, optionals, and unions preserve it when their
contained values are data. Functions, methods, getters, promises,
host/capability objects, primitives, and unconstrained type parameters are
deliberately outside the boundary. Those values have behavior or authority that
a data qualifier cannot describe honestly.

Classes never appear inside readonly types, at any depth. A readonly view
promises that everything reachable through it is protected data, and a class
member is behavior that promise cannot cover, so `readonly` over a type that
contains a class anywhere — a record field, a collection element, a union arm,
however deeply nested — is a compile-time error at the declaration site. The
diagnostic teaches the two ways out: model the member as a data record, or drop
`readonly`. A bare unconstrained type parameter element such as
`readonly List<T>` stays legal because an opaque element offers no member to
mutate, and `unknown`/`any` members pass because they are already where static
promises end.

`readonly` is static discipline, and `unknown` is exactly where that discipline
stops. A value validated out of an `unknown` is a **fresh, independent
assertion** about the data — and it is a fresh value: `parse` returns a copy,
not the object it was handed. Validated therefore means "and it stays valid",
not "it was correct at the instant of the check". A write through a binding that
still names the source cannot falsify a field of the copy; a value reached
through a `readonly` view does not regain mutable authority by passing through
`parse`; and a frozen source parses into an ordinary writable value, so a later
field write does not die with a host `TypeError`. The copy follows the declared
shape — fields the type names are rebuilt, nested records and collections
included, while a class instance, a promise, a function, a `Duration`, an enum
member, and an `unknown` field pass through by reference — and a shared or
cyclic subgraph is copied once, so the copy preserves the sharing the source
had. Recovering mutable authority over data still requires an explicit copy, and
`parse` is where the boundary from untrusted data into checked code pays for
one.

A field declaration such as `readonly details: Details` forbids replacing the
field and projects nested data through the same transitive read-only view. This
makes a readonly field and a field read through `readonly Profile` obey one rule.
Optional and union wrappers preserve the capability relation: a `readonly User`
may enter `readonly User?` or a union containing that view, but no wrapper permits
it to enter a mutable `User` contract. A field write through a union is valid only
when every possible variant exposes that field as writable; otherwise the owner
must be narrowed first.

The qualifier is compile-time only. It creates no wrapper, copy, proxy, freeze,
runtime branch, or new identity. A mutable data value may be viewed as readonly;
recovering mutable authority requires an explicit copy written by the program.
There is no readonly class or readonly executable-member contract.

Because read-only is part of the function type, helpers state their ownership
contract directly:

```velar fragment
def inspect(profile: readonly Profile) -> string:
    return profile.id

def update(profile: Profile):
    profile.details.label = "Updated"
```

Passing a component prop to `inspect` is valid; passing it to `update` is a
compile-time error.

### Optional values

`T?` means `T | null`.

Nullability has one canonical type shape. A union such as `Left? | Right?`
becomes `(Left | Right)?`, so presence checks, `?.`, `?.[...]`, optional calls,
`??`, inference, and module interfaces cannot lose the possible `null` arm.
Every optional access result normalizes JavaScript short-circuit `undefined`
back to VelarScript `null`.

```velar fragment
const user: User? = findUser(id)

if user != null:
    print(user.name)

if user == null:
    print("Missing")
else:
    print(user.name)
```

A condition judges truth, never presence. `bool` and `bool?` are the only types
a condition accepts, and both ask the same question: the branch runs when the
value is `true`, so `false` and `null` take the same `else` path. Every other
optional must say which question it is asking, because "holds a value" and "is
true" are different tests: write `!= null` (or `== null`) to test for a
value. A null test is therefore always explicit, and it distinguishes `null`
from valid `0`, `""`, and `false` values.
Facts narrow local names and stable record fields within the owned branch. A
plain `=` still checks against the location's declared type, then invalidates
the old fact for that location and its child fields. Reassigning an optional
value to `null` is therefore valid, and later reads must prove presence again.
Compound assignment uses the current fact because the operation itself requires
and preserves the checked non-null value.

An assignment also establishes a fact: after `=` (including a declaration
initializer), the location holds the assigned expression's type, so
`const x: string? = "a"` reads as `string` without a further check, a member
assignment establishes the fact for its own path after invalidating aliases,
and branches that each assign a value of the same refined type merge that fact
past the branch. Assigning a value whose type is the declared type establishes
nothing — `x = maybeNull()` leaves `string?` open — and assigning `null`
leaves the declared question open rather than pinning the location to `null`.
An assignment-established fact refines reads; it never turns a later test into
a constant. `x == null` after `x = "a"` is still the declared `string?`
question — only facts established by checks make a repeated check an error.

Mutually exclusive branches are analyzed independently. A write in one branch
does not contaminate a sibling that cannot execute it, while any write that can
reach the following statement invalidates the merged fact. Facts established
with the same type on every continuing branch remain available after the
branch. A guard whose arm ends in `return`, `throw`, or — inside a loop —
`break` or `continue` never reaches the following statement, so the negated
facts persist on the fall-through path. A terminating guard therefore reads
naturally:

```velar fragment
type User:
    name: string

def label(user: User?) -> string:
    if user == null:
        return "Missing"
    return user.name
```

Equality carries a fact back to its subject wherever one literal answers the
question. `flag == true` and `flag == false` each prove a `bool?` holds a
`bool`, exactly as `status == Status.done` proves an enum singleton; the
opposite arm learns nothing, because `flag != true` still admits `false` and an
absent value. Membership does the same, since a membership probe asks the `==`
question one element at a time (section 4): `value in names` proves `value` is
of the container's element or key type, so a `string?` narrows to `string`
against a `List<string>` but not against a `List<string?>`, where an absent
value is a legitimate element. The negative arm of a membership probe proves
nothing — any element could be the one that failed to match. An optional chain
that produced a value proves every link along it was present, since an absent
link is exactly what the chain short-circuits on: `if user.profile?.email !=
null:` narrows `user.profile` as well as the address.

Narrowing is flow-based and deliberately practical. A fact established by a
check persists across calls, getters, callbacks, `await`, and string
interpolation. A known assignment to that location (including destructuring or
a compound target), or a reachable branch merge containing such a write,
invalidates it statically. A member write invalidates facts between roots
whose types could alias — two roots with no values in common cannot be the
same object, so their facts survive each other's writes, while same-type
roots (including every visible alias of the written object) still invalidate
each other.

```velar fragment
if form != null:
    setError(form, "email", "Required")
    focusFirstError(form)
```

Calls are intentionally not modeled with a whole-program write-effect system.
Instead, every later read that relies on a still-active narrowing fact rechecks
the available runtime evidence. Records and collections use deep validators. A
declared record answers through the validator its declaration emits; a
structural object type has no declaration to hang a function on, so the same
evidence is spelled inline as one expression over the field table the type
already carries. The two prove the same thing except in three places, all of
them consequences of being an expression rather than a function, and naming a
record type strengthens the guard exactly there and nowhere else. The inline
form is bounded, because an expression can only recurse by growing: a structural
type already being expanded, or one nested past the emitter's structural
field-depth limit, falls back to the presence test, while a declared record's
validator recurses through a call and carries no such bound. It reads its fields
directly rather than through property descriptors, so unlike a declared record's
validator it does not distinguish an own data property from an inherited one or
an accessor. And a field whose own check folds to a constant is dropped from the
conjunction rather than emitted. Classes use nominal identity, primitives use
their runtime kind, and erased generics or opaque capabilities can promise only
presence. If an opaque call, getter, callback, host boundary, or suspended task
made that evidence stale,
the read throws `NarrowingError` with the source offset and expected type. This
keeps ordinary source concise without silently leaking a JavaScript `TypeError`.
Runtime narrowing guards are separate from `readonly`: the former validates a
fact at a use site; the latter removes mutation capability from a data type at
compile time.

The recheck runs at **every read that relies on a fact which may become stale**,
not once per check, and for a record or collection it is a validating walk over
the data. One check followed by ten reads is ten rechecks. A local `const` copy
of an optional has one narrower rule: when the check removes only `null`, the
fact cannot become stale because no alias can reassign that local binding. Its
record or collection contents may remain mutable, but later reads do not walk
those contents to re-prove the unrelated presence fact. Parameters, `let`,
members, imports, reactive bindings, and checks that select a more specific
union arm retain the ordinary runtime recheck.

Three boundaries remain because they are visible in source:

- Narrowing does not flow into a nested function body. A callback may run at
  any later time, so it re-checks what it needs or receives checked values as
  parameters.
- A getter is a computed value, not a stable location. Read it into a `const`
  to narrow the result. A check written directly on a getter is reported where
  it stands, because it looks like every other narrowing check and establishes
  nothing, and a read that would need `?.` names the `const` binding rather
  than `?.` — the operator would compute the getter a second time.
- An index or a `Map.get` is a read, not a location either. `values[0]` and
  `lookup.get(key)` compute a result each time they are written, so testing one
  narrows nothing for the next — the collection may hold something else by
  then. Read the value into a `const` and test that; the two reads become one.
An f-string converts each embedded value at its source position under the
language's one text-conversion contract: conversion accepts `string`,
`number`, `bool`, enums, and `null` — plus optionals and unions of those —
and is inert. A `bool` renders `true` or `false`, `null` renders `null`,
enums render their runtime wire value, and non-finite numbers print
honestly. Records, collections, functions, class instances, `unknown`, and
`any` never convert implicitly: JavaScript string coercion would execute
conversion hooks such as a `toString` field, so those values are rejected at
compile time — `print(value)` inspects a value, and `Json.stringify(value)`
builds data text. `str(value)` and JSX text positions apply this
same contract.

Optional access is explicit at each optional continuation:

```velar fragment
const city = account?.profile?.address?.city
const first = values?.[0]
const result = callback?.()
```

Skipped indexes and call arguments are not evaluated. Optional chains cannot
be assignment targets. On the path where an optional index or call continues,
its guarded receiver or callable is known to be present inside the index and
argument expressions. Optional function annotations also contextually type a
function expression assigned to them.

### Required values

`value!` is the required-value unwrap: it takes `T?` to `T`, and raises
`AssertionError` at that position when the value turns out to be absent. It is
a check, not a claim — the language has no spelling for "trust me", because a
belief the compiler cannot see is exactly the trap section 1 rule 2 removes.
It is `AssertionError` for the same reason `assert` raises it: an absent value
here means the program is wrong, so `try` and every other failure-to-value
combinator pass it through rather than turning a bug into a "not found"
(section 11).

```velar fragment
const definition = catalog.get(id)!
const address = user.profile!.email
```

`!` is postfix and binds with the rest of a postfix chain, so `a!.b` unwraps
`a` and then reads `b`, while `a.b!` unwraps the field. It reads a value, so it
cannot stand on an assignment target — assign to the location. A `!` on
something that is not optional is an error rather than a no-op, exactly as a
repeated presence check is: the value already answers the question.

`!` and `assert` divide by position, not by meaning. `value!` is the
expression-position unwrap and carries the message the compiler writes;
`assert value != null else "..."` is the statement-position contract and
carries the one the author writes. Reach for the assertion when the failure
has something to say to whoever reads the report, and for `!` when the only
thing to say is that this cannot be absent.

`!=` still wins by longest match, so an unwrap followed by an equality test
needs its space: `value! == other`. A `!` written *before* a value is the
JavaScript negation, which the compiler still rewrites to `not`
(section 4).

## 6. Records, aliases, and enums

One `type` keyword owns both record shapes and aliases.

```velar
export type User:
    id: string
    name: string
    avatar: string?

export type UserId = string
export type UserHandler = (User) -> null
```

There is no parallel `schema`, `interface`, or `typedef` declaration family.
Those words remain ordinary data names; when `schema Name:` or
`interface Name:` appears in declaration position, diagnostics guide it to
`type Name:` without reserving the identifier globally.

A record may extend one concrete record type. Inheritance reuses and extends a
data contract; it does not create behavior or a JavaScript prototype chain:

```velar
type Entity:
    readonly id: string
    createdAt: number

type User extends Entity:
    name: string
    avatar: string?
```

`User` contains all four fields, a `User` is assignable to `Entity`, and
`User.is`/`User.parse` validate the inherited fields together with its own.
This remains structural assignability: an unrelated record with the same
required fields can still satisfy either contract, and `extends` does not add a
nominal test.

The base may be local or imported, and a generic record may apply its own type
parameters in the base:

```velar fragment
type Box<T>:
    readonly value: T

type LabelledBox<T> extends Box<T>:
    label: string
```

Only one base is accepted. It must resolve, including through an alias, to one
concrete record declaration or generic-record application; classes, primitives,
collections, unions, and `readonly` views are not bases. Inherited fields keep
their original type and `readonly` contract and cannot be redeclared in the
child. Direct, indirect, alias-mediated, and cross-module inheritance cycles are
rejected. A declaration that only needs another name for the same contract uses
an alias (`type PublicUser = User`) rather than an empty derived record. There is
no record `override`, `super`, constructor, abstract member, multiple
inheritance, or runtime parent object.

A concrete record Type also owns one compiler-checked exact constructor:

```velar fragment
type SourceUser:
    id: string
    name: string
    internalToken: string

type PublicUser:
    id: string
    name: string
    requestId: string

const response = PublicUser.from(source, {requestId})
```

`Target.from(source, overrides?)` reads only fields declared by `Target`, in
the target's inherited-then-local declaration order. Surplus source fields are
not copied or inspected. Every required target field must exist with an
assignable type on the statically known source shape or be replaced by the
override literal; an absent optional target field is omitted. Overrides must
be one explicit record literal without spreads, so misspellings and hidden
fields are checked at the call. The operation is shallow: nested record and
collection values keep their ordinary sharing and readonly boundaries.

The source must already have a statically known record shape. `unknown` and
`any` are rejected with guidance to validate first; `from` is construction, not
the untrusted-data boundary owned by `Type.parse`. Only a concrete record name
or named concrete generic alias owns `from`; it is not a member of the
first-class `Type<T>` carrier and primitive aliases do not gain it.

Both call arguments are evaluated once in authored call-argument order,
including named calls, before projection begins. At runtime the projection
accepts only own enumerable data fields from source and overrides, rejects
accessors and missing required fields, preserves reactive collection reads,
and uses the normal bounded record writer. This fail-closed runtime check is
defence in depth for typed values arriving from a host boundary.

A concrete record Type also owns a mapped projection for the case where the
field names already agree but every field value needs the same conversion:

```velar fragment
type Slots<T>:
    air: T
    water: T

type IdentitySlots = Slots<string>
type RuntimeSlots = Slots<number>

const runtime = RuntimeSlots.mapFrom(identities, resolveRuntimeId)
```

`Target.mapFrom(source, transform)` visits the target's fields in target
declaration order, reads each same-name source field once, calls `transform`
once for that value, and writes the result under the same name. The source must
have a statically known record shape and every required target field; the
transform must accept the union of source field types and its result must be
assignable to every target field type. This deliberately serves homogeneous
record families such as configuration identities, runtime ids, indexes, and
flags. A transform whose behavior depends on the field name remains an
ordinary explicit construction rather than a hidden dependent-type facility.

Like `from`, `mapFrom` is shallow typed construction rather than validation.
It ignores surplus source fields, omits an absent optional target field, and
rejects an optional source for a required target. Both arguments are evaluated
once in authored call-argument order before mapping. Runtime reads accept only
own enumerable data fields and reuse the bounded record writer and reactive
read path.

Advisory `A9` catches the closed literal long form when every target field is
written, at least two fields are direct same-name data reads from one plain
record binding, and every other value is an identifier or literal. Computed
values, calls, spreads, optional omissions, mixed sources, a missing target
context, or only one mirrored field stay silent. Because Record insertion order
is observable, `from` deliberately canonicalizes even a differently ordered
literal to target declaration order. The report states that change; a wire
format that intentionally depends on authored field order keeps the literal
with `// velar-allow A9: <reason>` on its opening line.

Advisory `A10` catches the large mapped long form when a complete target record
of at least four fields writes every field as
`field: transform(source.field)`. Every field must use the same plain source
binding and transform binding, and authored property order must already equal
target declaration order so an effectful transform keeps exactly the same call
order. Smaller records, reordered fields, mixed sources, mixed transforms,
spreads, partial targets, and complex callees stay silent. The canonical form
is `Target.mapFrom(source, transform)`.

Record types have a runtime validator:

```velar fragment
const user = User.parse(untrusted)

if untrusted is User:
    print(untrusted.name)
```

`parse` returns a validated value or throws `ValidationError`. Runtime
validation proves every declared field and observes bounded data rules; records
remain structurally open to additional owned data fields as described below.

Runtime validators are first-class through the compiler-known `Type<T>`
carrier. This lets an ordinary VelarScript package write reusable decoding
logic without a compiler intrinsic or a JavaScript bridge:

```velar fragment
def decode<T>(value: unknown, target: Type<T>) -> T:
    return target.parse(value)

def accepts<T>(value: unknown, target: Type<T>) -> bool:
    return target.is(value)

const user: User = decode(untrusted, User)
```

Record, alias, and enum declarations produce the only values assignable to
`Type<T>`. A class or object that merely declares compatible `is` and `parse`
members cannot forge that capability. Generic inference and module interfaces
preserve `T` through named imports, renamed imports, namespace imports, and
re-exports.

`Type<T>` describes a runtime validator value; it is not itself a reified
metatype. The target relationship is compile-time information, while the value
is protected by the shared runtime-Type registry. Therefore `value is
Type<User>` and a runtime-validated `type` field or alias containing `Type<T>`
are rejected. Call the concrete validator's `is(value)` method instead, and
keep validator values in functions, classes, or ordinary variables when they
must be stored.

### Generic records

A `type` record takes the same type-parameter list a `def` takes, bounds
included. The parameters stand for field types, and each set of type arguments
is its own type:

```velar fragment
type Box<T>:
    value: T

type Pair<A, B>:
    left: A
    right: B

type Sorted<T: Comparable>:
    items: List<T>

const kept: Box<string> = {value: "kept"}
const counted: Box<number> = {value: 1}
const labelled: Pair<string, number> = {left: "count", right: 2}
const ranked: Sorted<number> = {items: [3, 1, 2]}
```

`Box<string>` and `Box<number>` are two types: the type arguments are part of
the type's identity, so assigning one to the other is refused, and each carries
its own runtime validator that checks the field against the argument it was
given. An alias inside a type argument is transparent — with `type Id = string`,
`Box<Id>` and `Box<string>` are one type.

Variance is decided field by field rather than declared on the parameter: a
`readonly` field is covariant and a mutable field is invariant, exactly as
`readonly List<T>` and `List<T>` already differ. There is no `in`/`out`
annotation, because a per-field decision is strictly the more precise one — the
same `Box<T>` can be covariant in a `readonly` field and invariant in a mutable
one, which a declaration-site annotation cannot express.

A generic record's reference to itself must pass its own type parameters
through, which is what keeps a recursive shape finite:

```velar fragment
type Tree<T>:
    label: T
    kids: List<Tree<T>>

const tree: Tree<string> = {label: "root", kids: [{label: "leaf", kids: []}]}
```

`Tree<string>` needs only `Tree<string>`, so it reaches a fixed point. A
reference that changed the arguments with the depth — `type Bad<T>: next:
Bad<List<T>>?` — would need `Bad<List<string>>`, `Bad<List<List<string>>>`,
without end, and is refused on the line that declares it.

A bare `Box` is not a type. It is a type constructor: without arguments it has
no identity, no field table, and no validator, so writing it names the arity it
is missing instead of quietly meaning `Box<unknown>` — which would accept
everything, `unknown` being the one type no bound admits.

Naming an instantiation is what turns it into a value, which is the move
`type Scores = Map<string, number>` already makes for a built-in generic:

```velar fragment
type Box<T>:
    value: T

type StringBox = Box<string>

const validated = StringBox.parse({value: "raw"})
const matches = StringBox.is({value: 1})
```

The name *is* that instantiation's runtime validator, so `StringBox` is exactly
the `Type<Box<string>>` value the `Type<T>` carrier above accepts, and
`decode(untrusted, StringBox)` answers a `Box<string>`. There is no explicit
instantiation in expression position: `Box<string>.parse(raw)` is not written,
because `<` in an expression is a comparison. Type arguments are supplied where
a type is written, and named when a value is wanted.

Enums represent finite string-backed states:

```velar
export enum Status:
    pending
    active
    done

const status: Status = Status.active
const parsed = Status.parse("done")
const members = Status.values()
```

`Status.values()` returns the members in declaration order as a fresh mutable
`List<Status>` on every call — the member enumeration for `<select>` options,
iteration, and spreading (`for member in Status.values():`,
`[...Status.values()]`; the enum object itself is not iterable or
spreadable). `is`, `parse`, and `values` are the enum's reserved runtime
surface and cannot be member names. A bare `pass` line inside an enum body is
the placeholder statement, exactly as in a class body — never a member — so
`pass` is the one name an enum cannot declare, and an enum whose body is only
`pass` still requires at least one member.

An enum's identity follows aliases (section 12) on the type side and the
value side alike: after `type S = Status`, member access (`S.done`), `parse`,
`is`, and `values()` all answer through the same frozen enum object, and the
alias is that object at runtime.

Open strings do not silently become enum members.
When an external protocol already owns the wire spelling, a member may map its
readable VelarScript name onto one explicit inline string:

```velar
enum ProviderEventKind:
    textDelta = "response.output_text.delta"
    completed = "response.completed"

print(ProviderEventKind.textDelta) // response.output_text.delta
```

The member name remains the nominal type identity
(`ProviderEventKind.textDelta`); the mapped string is its runtime value.
Unmapped members continue to use their own name. Runtime values must be unique
inside an enum, interpolation and layout strings are not enum declarations,
and the generated validator uses strict equality without calling mutable
collection helpers. This keeps third-party JSON/SSE tags precise without
adding structural literal types or a second protocol declaration family.

A wire value may also be a safe integer, for the protocols that pin a version
number rather than a tag:

```velar
enum KernelProtocol:
    v1 = 1
    v2 = 2

print(str(KernelProtocol.v2)) // 2
```

The mapped value takes exactly the shape section 3 calls an integer literal —
decimal or an explicit radix, digit separators allowed, an optional leading
minus — so a spelling carrying a fraction part or an exponent is refused rather
than rounded, and an integer that cannot be held exactly is refused by section
3's own rule. Uniqueness is by value identity across both kinds: `"2"` and `2`
are two wire values and may stand in one enum, because neither parses as the
other. Everything else is unchanged — the member is the same nominal singleton
in type position, `match` carries the same fact, and `parse` and `is` compare
with the same strict equality, which is what makes `Kind.parse("2")` throw for
a member pinned to `2`.

Which scalar an enum exits to (section 4) follows its wire value: a
string-backed member satisfies a `string` contract, an integer-pinned one
satisfies a `number` contract, and an enum whose members disagree exits only
after narrowing to one of them.

An enum member may also appear in type position. Combined with records and a
small union, this models protocols whose payload depends on one finite tag
without adding a second declaration family:

```velar
enum EventKind:
    text
    tool

type TextEvent:
    kind: EventKind.text
    text: string

type ToolEvent:
    kind: EventKind.tool
    toolId: string

type StreamEvent = TextEvent | ToolEvent

def describe(event: StreamEvent) -> string:
    if event.kind == EventKind.text:
        return event.text
    return event.toolId
```

(The alias is `StreamEvent` rather than `Event` because `Event` is a Web type
name: in a Web module a user declaration of one is refused where it is written,
since every use of it would resolve to the built-in instead.)

`EventKind.text` is a nominal singleton below `EventKind`, not an open string.
Reading a field shared by every union member produces the union of its field
types. Equality, inequality, `assert`, and `match` carry a singleton fact back
to the owning record, so variant-only fields are available in the matching
branch. A field whose variants require different types cannot be assigned
through the un-narrowed union; narrow the owner first. This prevents changing a
tag without constructing the payload required by the new variant.

## 7. Functions and calls

Functions use `def`. Parameters and public results can be annotated directly.

```velar fragment
def formatUser(user: User, prefix: string = "@") -> string:
    return f"{prefix}{user.name}"
```

A body-backed function, method, or Web action may omit its result annotation.
The compiler infers the union of its reachable returned values and includes
`null` when control can reach the end; a function with no value result therefore
infers `-> null`, while a partial `T` return infers `-> T?`. Where the inferred
result is `null`, omitting is required rather than a matter of style: `-> null`
is the one annotation that names nothing a caller can use — a caller that
ignores a result already knows as much — so writing it on a body-backed
declaration is rejected and `velar fix` deletes it. Every other annotation names
something the caller can use and stays the author's to write or omit. An
explicit `-> T` remains a checked contract and a non-null contract must return
on every reachable path. An async declaration infers or annotates its resolved
value, while its call type remains `Promise<T>`. Recursive result dependencies
are solved to a fixed point; a recursive group whose result cannot converge must
add an explicit annotation. Extern functions and abstract methods have no body
to infer and therefore always declare their result, and a function type always
writes one, `-> null` included. Components retain their dedicated render result,
class constructors retain their non-returning construction contract, getters
retain their explicit property result, and contextually typed arrows may infer
their result from the surrounding function type.

Calls support positional and named arguments:

```velar fragment
const first = formatUser(user)
const second = formatUser(user, prefix="#")
```

Named arguments use `name=value`, the same assignment-shaped spelling Python
users expect and JavaScript users can read immediately.

- Positional arguments come first.
- Names are checked against the declaration.
- Parameter names label calls through that declaration or annotated function
  type; they do not participate in structural function assignability. A
  callback may use a local name such as `_request` while satisfying a
  `(request: Request) -> Result` contract. The same rule applies to class and
  extern overrides: the base declaration keeps its labels for base-typed
  calls, while the implementation's parameter names remain local to calls
  through that concrete declaration.
- A name cannot appear twice.
- Arguments evaluate from left to right.
- The callee, including its receiver and any getter, evaluates before arguments.
- An optional call that short-circuits does not evaluate its arguments.
- Lowered JavaScript receives arguments in declaration order.
- No runtime keyword-argument record is created.
- Core checked value and collection methods follow this same contract and expose the parameter
  names documented in their signatures.
- Official fixed-signature APIs follow it too. Positional overloads and pure
  rest calls do not invent names for positions that have no single meaning.
- Once a fixed parameter has a default value, every following fixed parameter
  also has a default value. This keeps positional and named calls identical.

Arrows are concise expression functions:

```velar fragment
const doubled = values.map(value => value * 2)
const load = async id => await fetchUser(id)
```

An arrow body is one expression. After `=>`, `{` opens a **record**, never a
block — `() => {id: "a"}` is a record factory and `() => {}` builds an empty
record. There is no braced arrow body in this language, so a callback that needs
two statements becomes a named `def` and is passed by name. A function that
should do nothing is `() => null`; an empty record where a `null` result is
expected is reported rather than silently accepted.

### Checked value methods

Everyday string and number operations use the same dot-method surface as
collections. They are compiler-owned operations, not JavaScript prototype
calls: the receiver is checked, evaluated once, and captured when a method is
stored as a value.

String members are:

| Member | Result |
| --- | --- |
| `size` | Unicode code-point count. |
| `trim()`, `upper()`, `lower()` | Transformed string. |
| `isBlank()` | Whether the string is empty or whitespace-only — the identity is `trim().size == 0`. Unlike Python's `isspace()`, the empty string is blank. |
| `slice(start=0, end=size)` | Code-point slice. |
| `char(index)` | Code point or `null`; negative indexes count from the end; a non-integer index throws. |
| `has(text)`, `startsWith(text)`, `endsWith(text)` | Membership or boundary check. |
| `index(text, start=0)` | First code-point position at or after `start`, or `null`; negative starts count from the end and out-of-range starts clamp. |
| `count(text)` | Non-overlapping occurrence count; an empty search has `size + 1` positions. |
| `split(separator)` | `List<string>`. An empty separator splits per Unicode code point, so `"a😀b".split("")` is `["a", "😀", "b"]` — the character-list spelling; `"".split("")` is `[]`. |
| `replace(from, to)` | The **first** occurrence of `from` replaced by `to`. |
| `replaceAll(from, to)` | Every occurrence replaced. |
| `padStart(size, fill=" ")`, `padEnd(size, fill=" ")` | Padded string. |
| `repeat(count)` | Repeated string. |

`replace` and `replaceAll` follow JavaScript here, not Python: `replace` stops
after one hit, so `"a-b-a".replace("a", "z")` is `"z-b-a"` while
`replaceAll` gives `"z-b-z"`. Both search for literal text and insert literal
text — `$&`, `$1`, and the other JavaScript replacement patterns are ordinary
characters in `to`.

`"ad" in title` is the operator form of substring membership and follows the
same left-then-right evaluation order as collection membership. Direct string
indexing is intentionally absent; use `text.char(index)` when absence is an
expected result.

A `string` is a sequence of Unicode code points, and the value space is the
whole one JavaScript admits: any code point, including `U+0000`, and including
an unpaired surrogate that arrives from a JavaScript boundary. `size`,
iteration, `split("")`, `slice`, and every other member count a valid surrogate
pair as one character and an unpaired half as one character; no member fails on
such a value. Source literals stay narrower than the value space on purpose:
`\u{D800}`–`\u{DFFF}` are rejected (section 3), so a lone surrogate can only
enter a program across a JavaScript boundary, never from Velar text.

The search members count the same unit. `has`, `index`, `count`, `startsWith`,
`endsWith`, `split`, `replace`, and `replaceAll` accept a match only where it
begins and ends on a code-point boundary, so the addressing half and the
searching half speak one language: a position `index` reports can be handed
straight to `char` or `slice` with no translation, and a count from `count`
counts in the same unit `size` counts in.

No String operation can produce an unpaired surrogate out of well-formed text. A
needle that begins or ends with a lone surrogate does not match inside a
surrogate pair, so `split` cannot hand back half a character and `replace` and
`replaceAll` cannot cut one out; padding walks its fill by code points for the
same reason. Half a character is not a value this language will construct for
you.

Grapheme clusters are deliberately outside Core. A grapheme rule needs a
segmentation table that moves with every Unicode release, and pinning language
semantics to a table that moves is the wrong trade for a language that never
promises compatibility — it would also be heavy for something most programs
never ask for. Code points are the honest middle: the unit Python 3, Swift's
`unicodeScalars`, and Rust's `chars` count, and the choice that removes "half a
character" from the set of values a program can hold. Grapheme segmentation
belongs to a text library, not to Core.

Text equality is code-point-sequence identity, so canonically equivalent text
is not equal: a word typed with one precomposed accented character and the same
word read back from a macOS filename as a plain letter plus a combining accent
render identically, yet they compare unequal, report different `size`, and miss
each other as Map and Set keys. Normalize at the boundary where such text
enters the program — `Text.normalize(text)` produces NFC, and `"NFD"`,
`"NFKC"`, and `"NFKD"` are the other three accepted forms.

Case-insensitive comparison is spelled `a.lower() == b.lower()`, and that is an
approximation rather than Unicode case folding: `"STRASSE".lower()` is
`"strasse"` while `"straße".lower()` is unchanged, so the two do not compare
equal. `lower()` and `upper()` may also change a string's length —
`"İ".lower()` is two code points. Full case folding and locale-aware collation
are deliberately absent: ordering is code-point order everywhere (section 4),
never a language-sensitive collation, so a user-facing alphabetical order for a
specific language is an application concern and crosses a JavaScript boundary
explicitly.

Number members are `abs()`, `round()`, `floor()`, `ceil()`,
`toFixed(digits) -> string`, and the three predicates
`isInteger() -> bool`, `isNaN() -> bool`, and `isFinite() -> bool`.
`isInteger` follows `Number.isInteger`: `Infinity` and `NaN` are not
integers, so it replaces the `x == x.floor()` folk test, which `Infinity`
passes. `isNaN()` is the one NaN test — equality already answers it honestly
(`x == x` is always `true`), so the JavaScript `x !== x` idiom has no Velar
spelling. Conversion still has one spelling: use
`str(value)` or an f-string, never `.toString()`. Both enforce the section 5
text-conversion contract — values outside strings, numbers, bools, enums, and
`null` (with their optionals and unions) are rejected, and data is formatted
explicitly.

Number text is JavaScript's number text, which is what a reader of the emitted
program sees. `str(-0)` is `"0"`, `str(1e21)` is `"1e+21"` (the exponent form
takes over at 1e21 and below 1e-6), `str(0.1 + 0.2)` is
`"0.30000000000000004"`, and `str(1 / 0)` and `str(0 / 0)` are `"Infinity"` and
`"NaN"`. Fixed decimal places are `value.toFixed(digits)`.

The one inbound conversion is the prelude function `number(text) -> number?`,
and its grammar is closed. The text is trimmed first — leading and trailing
whitespace, including newlines and tabs, is ignored — and what remains must be
one complete decimal number: an optional `+` or `-`, then digits with an
optional fractional part (`42`, `4.`, `.5`, `4.5`), then an optional `e`/`E`
exponent with an optional sign. Anything else answers `null` rather than
throwing or guessing: an empty or blank string, a partial parse (`"12ab"`), a
digit separator (`"1_000"`), a radix form (`"0x10"`), the words `"Infinity"`
and `"NaN"`, and a value that overflows to infinity (`"1e999"`). A non-string
argument is a compile error, and an unvalidated boundary value is one too,
because `unknown` is assignable to no checked type (section 12); the runtime
keeps its own guard and throws a `TypeError` if a foreign contract that lied
lands a non-string here anyway. The
accepted grammar is deliberately wider than the source literal grammar in one
place — `"4."` and `".5"` parse even though `4.` and `.5` are rejected as
literals — because the input is data from outside the program, not source a
person wrote.

Every string and number method above returns a new value and never modifies
its receiver. An expression statement that calls one and discards the result
is a compile error — there is nothing the call could have accomplished.

Rest parameters use `...values`. A rest parameter is always final and may
follow defaulted fixed parameters. A declaration writes its element type, since
there is nothing to take one from; a contextually typed arrow takes it from the
surrounding function type's own rest, exactly as its fixed parameters take
theirs, and is refused only where no context supplied one.

```velar
const total: (...values: number) -> number = (...values) => values.sum()
print(str(total(1, 2, 3)))
```

Call spread uses the same boundary in reverse: it targets a declared rest
parameter after every fixed argument has been written explicitly. The spread
value must be a checked dense List; instance iterator overrides are ignored.

### Async functions

An async declaration annotates the resolved value:

```velar fragment
async def loadUser(id: string) -> User:
    return await api.user(id)
```

Its call type is `Promise<User>`. Do not write `-> Promise<User>` on an async
*declaration* — the `async` is already standing there. A function **type** is
the other position and takes the opposite spelling, because it has no `async`
on it and describes the value the call hands back: `(id: string) ->
Promise<User>`. Section 5 writes the two side by side. JavaScript Promise
adoption and the JavaScript event loop remain the runtime behavior. Because the JavaScript Promise representation reserves a
resolved value's top-level `then` member, a checked Promise cannot resolve
directly to a record or class with a callable `then` data member, or to a class
with any `then` getter. The compiler reports that conflict on explicit Promise
types, async declarations and arrows, generic instantiations, calls, awaits,
typed async combinators, and each concrete async return expression. A value may
have been widened to `unknown`, a base class, or a cross-module contract that no
longer exposes its concrete member set, so generated async returns whose checked
actual type can carry an object also inspect the top-level `then` data descriptor
and prototype chain before native Promise adoption. Primitive and
already-checked Promise returns keep the direct path. A callable data member or
any getter fails closed without executing the getter. A non-callable data member
such as `then: string` is valid,
as is a nested value such as `Promise<List<Box>>`; Promise resolution does not
inspect List elements. Rename a conflicting top-level member or keep that value
outside the resolved result.

A Promise-typed expression statement is rejected: nothing waits for it and
nothing owns its failure. The two ownership spellings state the intent
explicitly — `await` waits, and `detach` starts detached work:

```velar fragment
await save()
detach save()
```

`detach <expression>` is statement-position only and requires a checked
`Promise<null>`. A non-null resolved value would be lost silently, so a
result is awaited, or discarded explicitly inside an async def, before the
task detaches. A detached task never floats: the compiler hands its Promise
to a compiler-owned observer that normalizes rejection to `Error` and reports
it through the host error channel without ending the program — the console
error channel on Node output, and the `velar/app` error chain with the
distinct `detached` phase on web output. Inside components, UI-owned async
work still belongs to `action`, which carries reactive pending/error state
and the component lifecycle; the `detach` statement serves process- and
page-lifetime work.

### Type parameters

`def` functions can declare type parameters after their name:

```velar fragment
def mapValues<T, U>(items: List<T>, transform: (T) -> U) -> List<U>:
    return items.map(transform)

const flags: List<bool> = mapValues(["a", ""], value => value != "")
```

Type arguments are inferred at each call site; there is no explicit
instantiation syntax. Fixed arguments bind parameters first, then callback
arrows are checked against those bindings and their results solve the rest.
A parameter the call leaves unsolved becomes `unknown`. Type parameters are
erased at runtime, so `is T`, `case T`, and every other runtime-checked
position require a concrete type instead. `def` declarations — top-level,
exported, extern, and class methods — and `type` records take type parameters;
generic `class` and `component` declarations do not.

#### Bounds

A type parameter may name one bound, written `<T: Bound>`. A bound does two
things and nothing else: the call site checks the type the parameter solved
to, and the body may use the capability the bound promises. There are no
conditional types, mapped types, operations between bounds, inferred bounds,
or default bounds — the type-level programming rule 4 excludes stays excluded.

The bound vocabulary is closed and the compiler owns it. There are exactly
three, and each one stands on its own: the table below is the whole definition
of what a bound grants, and nothing computes a relation between two bounds.
There is no syntax for combining two, because no real function needs to demand
both — a value that must be both ordered and JSON-shaped is asking two
questions one signature has no reason to ask together.

| Bound | Promise | What the body may do |
| --- | --- | --- |
| `Comparable` | the type has a runtime order | `<` `<=` `>` `>=`, `sorted()`, `min()`, `max()`, `sorted(by=)`, and `sortBy`/`minBy`/`maxBy` keys, plus text form and JSON shape |
| `Text` | the type has a hook-free text form | f-string interpolation, `str(value)`, passing `str` itself, plus JSON shape |
| `Data` | the type is JSON-shaped | `Json.stringify`, `Json.stableStringify`, `Json.clone`, request bodies, stored values |

The grants overlap, but they are not a containment chain over *types*: a Web
extension's text-shaped values (`Length`, `Duration`) satisfy `Text` and are
refused by `Data`, because they are not JSON-serializable. Read the table as
what the body may do, never as "every `Text` type is also a `Data` type".

```velar fragment
def label<T: Text>(value: T) -> string:
    return f"{value}"

def ranked<T: Comparable>(values: List<T>) -> List<T>:
    return values.sorted()

print(label(5))
print(ranked(["b", "a"]).size)
```

`Comparable`, `Text`, and `Data` are reserved type names: a user `type`,
`class`, `enum`, type parameter, or imported name may not be spelled with one
of them, because a same-named user type would silently lose to the bound at
every `<T: Data>`. A user type is never a bound: `<T: User>` is rejected, and
so is any name outside the three. The vocabulary is closed for the same reason user-defined
decorators are absent — a library must not be able to change what a
declaration means. An unbounded type parameter behaves exactly as before, a
bound survives export so an imported generic keeps its contract, and the
rejected call names the argument that solved the parameter to the type the
bound refuses.

## 8. Collections

The public collection names are `List`, `Set`, and `Map`.

### List

```velar
let names: List<string> = ["Ada", "Lin"]
names.append("Grace")
names.extend(["Edsger", "Margaret"])
names.insert(1, "Barbara")
names.insert(value="Alan", index=0)
```

List members:

| Member | Result |
| --- | --- |
| `size` | Number of values. |
| `get(index)` | Value or `null`; negative indexes count from the end; a non-integer index throws. |
| `has(value)` | Whether the exact value is present. |
| `append(value)` | Add one value; returns `null`. |
| `extend(values)` | Add a List atomically; returns `null`. |
| `insert(index, value)` | Insert at a position from `0` through `size` (inclusive); an out-of-range or non-integer index throws `IndexError`; returns `null`. |
| `remove(value)` | Remove the first exact value; returns `bool`. |
| `pop(index=-1)` | Remove and return the value at a position; an empty List, an out-of-range index, or a non-integer index throws `IndexError`. |
| `clear()` | Remove every value; returns `null`. |
| `copy()` | Shallow copy. |
| `slice(start=0, end=size)` | Shallow range copy; negative positions count from the end, out-of-range positions clamp, and a non-integer position throws `IndexError`. |
| `count(value)` | Exact-value count. |
| `index(value)` | Exact-value position or `null`. |
| `find(test)` | First matching value or `null`. |
| `some(test)` | Whether at least one predicate result is true. |
| `every(test)` | Whether every predicate result is true. |
| `map(transform)` | Transformed List. |
| `flatMap(transform)` | Transformed then flattened one level: the transform returns a List for each element and the results concatenate in order. |
| `filter(test)` | Filtered List; the exact predicate `x => x != null` narrows `List<T?>` to `List<T>`. |
| `reduce(combine, initial)` | Folded result. |
| `sum()` | Sum of a `List<number>` from zero. |
| `min()`, `max()` | Smallest/largest ordered element, or `null` when empty. |
| `min(by=selector)`, `max(by=selector)` | The element with the smallest/largest ordered key, or `null` when empty; the key obeys `sorted(by=)`'s rules. |
| `sorted(compare?)`, `sorted(by=selector)`, `sorted(descending=false)` | Sorted copy by a comparator or ordered key. `descending` reverses the comparison, so equal keys keep their input order in both directions; it applies to the default order and to `by=`, and combining it with a comparator is an error because the comparator already states the order. |
| `reversed()` | Reversed copy. |
| `join(separator="")` | Joined string for `List<string>`. |
| `unique()` | First occurrence of each value, by the same identity `has` and Set membership use. |
| `compact()` | `List<T?>` without its `null` values, as `List<T>`; an element type with no `null` arm has nothing to remove and is an error. |
| `flatten()` | `List<List<T>>` joined one level into `List<T>`; any other element type is an error. |
| `chunk(size)` | `List<List<T>>` of consecutive runs; `size` is a positive integer. |
| `partition(test)` | `{matches, rest}`, both in source order. |
| `groupBy(key)` | `Map<K, List<T>>` keyed by the callback result. |
| `keyBy(key)` | `Map<K, T>`; the last value wins for a repeated key. |
| `countBy(key)` | `Map<K, number>` counting the callback results. |
| `zip(other)` | `List<{first, second}>` up to the shorter length. |
| `repeat(count)` | The whole List `count` times, as `string.repeat` repeats a whole string; `count` is a non-negative integer. |

Advisory `A8` catches exact early-return long forms of `some`, `every`, and
`find`: a synchronous single-slot loop over a plain List binding, whose sole
body statement is an `if` with no `else`, immediately followed by the matching
exhausted return in the same function block. Its condition must have the exact
type `bool` and consist only of literals, bindings, checked data-field reads,
and operators. For example:

```velar
type SchemaColumnRow:
    name: string

def hasColumn(columns: List<SchemaColumnRow>, name: string) -> bool:
    return columns.some(column => column.name == name)

def everyColumnHasAName(columns: List<SchemaColumnRow>) -> bool:
    return columns.every(column => column.name != "")

def columnNamed(columns: List<SchemaColumnRow>, name: string) -> SchemaColumnRow?:
    return columns.find(column => column.name == name)
```

The matching expanded early-return loops report those spellings. A call, class getter,
`bool?` condition, second loop slot, async loop, second body statement,
computed source, `else`, or intervening statement stays ordinary code. Those
forms can change state or depend on List iteration's live length, while query
methods use a stable input snapshot, so the compiler does not claim equivalence. The
report carries a mechanical edit only when replacing the loop and following
return cannot erase comments; otherwise the author writes the named return or
keeps the loop with a reasoned `velar-allow A8` on its `for` line.

Advisory `A13` applies the same proof standard to a fresh typed List immediately
followed by a synchronous List loop. When the sole body operation is
`append` or `extend`, optionally inside one pure `if` guard, it names `map`,
`filter`, `filter(...).map(...)`, or `flatMap`. The source must be a stable List
binding or stable data-field path; the predicate and projection may use only
literals, bindings, checked data-field reads, operators, and the compiler-owned
pure `str(value)` and `Target.from(value)` projections. An unguarded two-slot
loop becomes a two-parameter `map` or `flatMap` callback and preserves its
original snapshot index. An indexed guarded loop, arbitrary call, class getter,
index read, destination read, computed source, or wider body stays explicit.
An extension may admit its own stable expression form; Web admits native JSX
whose eager holes pass this same proof, while component/custom-element setup,
refs, and bindings remain explicit. A13 offers a comment-preserving mechanical
edit under the same rule as A8.

Direct indexing and indexed assignment are strict. Negative indexes count from
the end; indexes outside `-size` through `size - 1` throw `IndexError`. Use
`get` for an optional read: an in-range read returns the value, an
out-of-range **integer** returns `null`, and a non-integer index is an error
rather than a silent `null` — a fractional index is a computation bug, not an
absence. `pop` is on the strict side with `[]`, not with `get`: it returns
`T`, and an empty List, an out-of-range index, or a non-integer index all
throw `IndexError` — the same contract as Python's `list.pop`. Negative
indexes count from the end. Draining a List is therefore a size guard rather
than a null dance:

```velar fragment
while chunks.size > 0:
    assembled += chunks.pop(0)
```

`sorted` and `reversed` do not
mutate the source. Exact-value operations (`has`, `index`, `count`, `remove`)
compare by SameValueZero, so they agree with `==` and with Set/Map key
identity, including on `NaN` — and they carry `==`'s static intersection
requirement on the probe (section 4), so a probe that could never equal an
element is a compile error. A `match` value pattern whose subject and
candidate can both be `NaN` also compares by SameValueZero, so every
exact-value operation in the language answers the way `==` answers. A Set
element type or Map key type may not mix members of different enums, or an enum
with the scalar its wire values are: enum members are bare wire values at
runtime — strings, or integers where the declaration pins one — so such keys
would silently collapse into one slot. The ordered aggregations and `sorted` accept
ordered elements and keys only — `number`, `string`, or a single-category
union of them — so an enum element or key is rejected with guidance to
`sorted(by=rank)` or a string-backed enum (section 4). A `groupBy`, `keyBy`,
or `countBy` key is a Map key instead of an ordered one, so it obeys the Map
key rule above rather than the ordering rule. `sum`, `min`, `max`,
and `sorted` (default order and numeric `by=` keys) throw a targeted error on
a `NaN` element — `NaN` has no ordering and poisons totals; the message
points to `filter(x => not x.isNaN())`. Collection methods that return a new
value without mutating their receiver (`copy`, `slice`, the callback family,
the aggregations, the pipeline members `unique`, `compact`, `flatten`,
`chunk`, `partition`, `groupBy`, `keyBy`, `countBy`, `zip` and `repeat`,
`get`, `has`, `keys`, `values`, `entries`) are compile
errors as bare expression statements: the result is discarded. Discarding
`pop()` or `remove(value)` stays legal — they mutate and also report.
Callback operations (`find`, `some`, `every`, `map`, `flatMap`, `filter`, `reduce`, keyed `sorted`,
`sum`, `min`, `max`, `partition`, `groupBy`, `keyBy`, and `countBy`) read one
checked shallow snapshot, so a callback may mutate the original List without
changing which values belong to the current operation. So do the members that
take no callback at all: `unique`, `compact`, `flatten`, `chunk`, `zip`, and
`repeat` answer a fresh container built from one snapshot, and every result
stays under the 1,000,000-item ceiling.
Every callback that receives an element receives `(value, index)` — the
zero-based position in that snapshot — and may declare only `value` when it
does not need the position. There is no exception: `sorted(by=)` is an element
callback like the rest, and its index is the position before the sort, the only
one that exists while the keys are computed. Two callbacks receive no element
of their own and keep their own shapes: `sorted`'s comparator weighs two
elements against each other as `(left, right)`, and `reduce`'s combine folds an
accumulator with a value as `(accumulator, value)`. The `by` selector is called
exactly once per snapshot value. Comparator and `by` forms are mutually
exclusive.

VelarScript does not expose `splice`, variadic `push`, `shift`, `unshift`, or
mutating `sort`/`reverse`.

### Set

```velar
const tags: Set<string> = Set()
const initialTags = Set(["web", "tooling"])
tags.add("web")
tags.update(["game", "tooling"])
```

Set members are `size`, `add`, `update`, `remove`, `has`, `clear`, `copy`,
`values`, `union(other)`, `intersection(other)`, and `difference(other)`. The
algebra methods take another Set, answer membership by SameValueZero (the
`==` question per member, with the same static intersection requirement on
the element domains), and return a new Set — like `sorted`, they never mutate
either operand.

### Map

<!-- velar-preamble
type User:
    id: string
    name: string

type Write:
    id: string

const user: User = {id: "user-1", name: "Ada"}
const writesByStage: Map<string, List<Write>> = Map()
const write: Write = {id: "write-1"}
-->
```velar fragment
const users: Map<string, User> = Map()
users.set(user.id, user)
const selected = users.get("user-1")
const terrainWrites = writesByStage.getOrSet("terrain", [])
terrainWrites.append(write)
const scores = Map([["Ada", 9], ["Lin", 7]])
const flags = Map({preview: true, compact: false})
```

Map members are `size`, `get`, `set`, `getOrSet`, `getOrSetWith`, `update`,
`remove`, `has`, `clear`, `copy`, `iterator`, `keys`, `values`, and `entries`.

`get(key)` is the read contract and returns `V?`. `getOrSet(key, fallback)` is
the mutating grouping/cache contract: it returns the stored `V` when the key is
present; otherwise it stores and returns `fallback`. Like every ordinary call,
the fallback expression is evaluated before the method runs. The result is
`V`, not `V?`, so repeated bucket appends do not create a collection-valued
flow narrowing whose safety guard must walk the growing bucket on every read.
`getOrSet` is unavailable through a `readonly Map`.

`getOrSetWith(key, factory)` is the lazy form. The zero-argument factory runs
only when the key is absent, after the Map has accepted the insertion; its
result is inserted and returned as `V`. The existing-value path never invokes
the factory. Like `getOrSet`, it is unavailable through a `readonly Map`.

`iterator()` creates a live insertion-order key cursor. Its `next()` method
pulls at most one key and returns `{value: K}`; after exhaustion it returns
`null` permanently. The item wrapper is deliberate: a Map may legally contain
`null` in its key type, so `{value: null}` must remain distinct from cursor
exhaustion. Creating and advancing the cursor does not copy the Map. `keys()`,
`values()`, and `entries()` keep their separate snapshot contract and return
fresh Lists.

<!-- velar-preamble
const users: Map<string, string> = Map([["user-1", "Ada"]])
-->
```velar fragment
const cursor = users.iterator()
const first = cursor.next()
if first != null:
    print(first.value)
```

`Set(values)` copies one checked dense List (or another Set). `Map(entries)`
accepts a checked dense List whose every item is exactly `[key, value]`;
`Map(record)` converts own enumerable string data fields into entries. Both
forms reject accessors, sparse or malformed Lists, symbol fields, and
overridable collection iterators at their runtime boundary.

Advisory `A7` catches the exact long form of those conversions and snapshots.
It requires an empty destination declaration immediately followed by a loop
whose only statement copies the corresponding loop slot into that destination.
The source must be a plain name, so replacing the two statements cannot move a
getter, call, or other effect across the destination declaration. The canonical
forms are:

| Destination | Iterated source and copied slot | Initialize from |
| --- | --- | --- |
| List | List values | `source.copy()` |
| List | Set members | `source.values()` |
| List | Map/Record keys or values | `source.keys()` / `source.values()` |
| Set | List values | `Set(source)` |
| Set | Set members | `source.copy()` |
| Set | Map/Record keys or values | `Set(source.keys())` / `Set(source.values())` |
| Map | Map key/value pairs | `source.copy()` |
| Map | Record key/value pairs | `Map(source)` |

For example, `const result: List<string> = []` followed immediately by
`for value in values: result.append(value)` over a `Set<string>` reports
`values.values()`. A non-empty destination, an intervening statement, a
computed source, a transform such as `append(value.trim())`, a condition, or
any second loop-body statement stays ordinary code and raises no advisory.
The report carries no automatic edit: replacing two statements could erase
comments between them, so the author performs the named initialization or
keeps the loop with a reasoned `velar-allow A7`.

An empty collection settles its element type where it is written. `Set()`,
`Map()`, and `[]` carry no items to infer from, so one of three things must
say what they hold: an annotation on the binding, a contextual type (an
argument position, a return position, an annotated field, `state`, or a record
field), or the constructor's own arguments. A binding with none of the three is
an error rather than a collection of `unknown` waiting for a later line to fill
it in — a later mutation never reaches back to type an earlier declaration.

```velar fragment
const tags: Set<string> = Set()      // the annotation says it
const initial = Set(["web"])         // the argument says it

def empty() -> Set<string>:
    return Set()                     // the return type says it
```

### Dynamic Record

`Record<T>` is the JSON-shaped counterpart to `Map<K, V>`: it is a plain data
record with arbitrary string keys whose values all satisfy `T`. It is intended
for JSON objects, schema property tables, headers encoded as data, and other
wire formats where object keys are not known in advance.

<!-- velar-preamble
type Property:
    type: string
    description: string
-->
```velar fragment
const properties: Record<Property> = {
    path: {type: "string", description: "Relative path"},
}
properties["limit"] = {type: "integer", description: "Result limit"}
const selected = properties["path"]
```

Bracket reads return `T?` because a dynamic key may be absent. Keys are strings;
bracket assignment and `set` validate the value contract. Members are `size`,
`get`, `set`, `remove`, `has`, `clear`, `copy`, `keys`, `values`, and `entries`.
A one-slot `for` visits keys, while `for key, value in record` visits both in
own-field order. Runtime operations accept only plain records with own
ordinary mutable enumerable data fields, reject symbols, accessors, frozen or
sealed fields, and remain bounded to 1,000,000 fields. Runtime `Type<Record<T>>`
validation proves that complete mutable shape up front, so a value cannot gain
`set`, `remove`, and `clear` statically only to fail because its host properties
were read-only or non-configurable.

`Record<T>` is not a spelling for `Map<string, T>`. A Map retains native key
identity and insertion semantics and is deliberately rejected by strict JSON;
a Record retains JSON object representation and only has string keys.
Because a mutable Record may overwrite any existing key, assigning a structural
object to `Record<T>` requires every existing field to be invariant with `T`
and rejects read-only fields. A `readonly Record<T>` has no mutation surface,
so the same structural conversion may safely widen field values covariantly.

Every method signature in the tables is also its named-argument vocabulary.
For example, `slice(end=5, start=1)`, `Map.set(value=user, key=user.id)`, and
`Set.add(value="web")` and `properties.set(key="path", value=property)` are checked exactly like calls to user-defined
functions. Source expressions still evaluate from left to right even when the
named values are reordered for the runtime call.
Checked value and collection methods are first-class bound values. `const add = tags.add` keeps
the checked `tags` receiver, and calling `add(value="web")` uses the same typed
helper as `tags.add(value="web")`; the receiver expression is evaluated once
when the method value is created. Optional collection method access returns
either that bound callable or `null`.

All collection growth is bounded. Every language collection operation validates
its JavaScript boundary and calls compiler-owned helpers rather than an
instance's overridable collection methods. A `for` loop visits string
characters, List and Set values, or Map/Record keys in order. String iteration follows
JavaScript Unicode code points, so a surrogate pair is one character. Native Map and Set brands are checked
through their internal slots, so legitimate values from another browser realm
work without trusting an overridable `instanceof`, `size`, iterator, or method.

An empty `[]`, `Set()`, or `Map()` must have its element or key/value type
settled where it is written: by an annotation on the binding, by a contextual
type — a parameter, a return position, an annotated record field or `state` — or
by the construction's own arguments. Nothing infers
it from a later mutation. A position with none of the three is reported at the
construction itself, and that includes a body-inferred `return`, an unannotated
record-literal field, a ternary arm, a list element, and a `??` fallback. A
construction whose element type never reaches a name is outside the rule, so
`print(Set().size)` stays legal. An optional collection annotation still
contextually types a present collection value, so `[]`, `Set()`, and `Map()`
written under one do not lose their element or key/value contracts.

List spread evaluates each ordinary item and spread source once in source order.
Every spread source is validated and copied by index rather than through a
replaceable iterator. Direct `await` remains valid in any part of an async List
expression and does not cause non-awaited Promise values in other items to be
adopted accidentally.

### Iteration order

Order is insertion order, everywhere. A `List` visits positions `0` upward; a
`Set`, `Map`, and `Record` visit their members, keys, and fields in the order
they were first added. Replacing the value at an existing key keeps that key's
position, so `scores.set("a", 9)` on an existing `"a"` does not move it.
Removing a key and adding it again does move it to the end — the second `add`
or `set` is a first insertion for a key that no longer existed.

`Record` has one exception, inherited from the JavaScript object it is: keys
that spell a non-negative integer come first, in ascending numeric order,
ahead of every other key. `{"2": …, "1": …, "b": …, "a": …}` therefore iterates
`1`, `2`, `b`, `a`, and a JSON object keyed by numeric IDs is silently
reordered by every `for`, `keys()`, and re-serialization. When the order of
such keys carries meaning, do not route them through a `Record` at all — build
the `Map` from entries. `Map(entries)` keeps true insertion order for keys of
any spelling. `Map(record)` cannot restore it: the record was reordered before
`Map` ever saw it, so `Map({"2": …, "1": …, "b": …, "a": …})` iterates `1`, `2`,
`b`, `a` exactly as the record does. Reach for `Map(record)` to gain a Map's
other guarantees, never to recover an order the record has already lost:

```velar fragment
const byId: Record<string> = {"2": "second", "1": "first"}
const ordered = Map([["2", "second"], ["1", "first"]])
```

### Mutation during iteration

Mutating a collection while a `for` loop walks it is legal and each family has
one stated contract. It is still worth avoiding in new code — iterate a `copy()`
or build a new collection when the body must add and remove — but the behavior
is defined rather than accidental.

- **List** — the loop is index-live. It re-reads the size and the element at
  the current position on every step, so a value appended during the loop is
  visited, and removing a value shifts the tail left and skips the element that
  moved into the current position. `for value in values: values.append(value)`
  therefore runs until the 1,000,000-item ceiling fails the append, exactly as
  the same loop diverges in JavaScript and Python.
- **Set and Map** — the loop holds a live native iterator. `Map.iterator()`
  exposes the same live key order one pull at a time. A member or key
  added during the loop is visited; one removed before the loop reaches it is
  skipped. A `Map`'s two-slot `for` reads each value at the moment its key is
  visited.
- **Record** — the loop takes a snapshot of the field names when it starts, so
  a field added during the loop is never visited. A field removed before it is
  reached is skipped by the two-slot form; the one-slot form still yields that
  name, and reading it answers `null` like any other absent key.

A JavaScript boundary is not a special case: a foreign function that grows a
`List` while a Velar loop is walking it extends that loop, and one that
shortens the List ends the loop early and silently, because the size is read
per step.

How much an element read re-proves depends on who wrote the elements. A `List`
VelarScript wrote in full is read with a plain load: it either built the value
itself — every `copy`, `map`, `filter`, `slice`, `sorted`, `reversed`, and
spread result — or it started from an empty `List` literal written in
VelarScript source and every element since arrived through a `List` operation.
Every other `List` re-proves the slot on every element read and refuses one that
is not an ordinary data element, so a JavaScript accessor installed on an index
after that `List` was checked is caught at the read instead of running. That
covers every array arriving from JavaScript, including one handed over empty: at
run time an empty array from JavaScript and an empty `List` literal are the same
value, and only the compiler knows which one it wrote.

A hole is refused on every checked `List`, and on a `List` VelarScript wrote in
full wherever the slot reads as `undefined`. The plain load notices that value —
no `List` element is ever `undefined` — and falls back to the per-element proof,
which refuses it in the same voice a checked `List` uses. A hole that something
on the array's prototype chain answers for does not read as `undefined`, so the
plain load returns what the prototype answered; that is the foreign-write
exposure stated below rather than a second one.

Size is what ends ownership. If JavaScript changes the size of a `List`
VelarScript wrote, that `List` is proved per element from then on and never
returns to the plain read.

Handing a `List` to JavaScript hands over authority for its contents. While
JavaScript holds a `List` VelarScript wrote in full, a value it puts in a slot —
by assigning to it, by installing an accessor on it, or by deleting the slot
while leaving `length` unchanged so a polluted array prototype answers for that
index — is the value VelarScript reads back. Emptying the array is not one of
them: that moves the size, and the paragraph above ends ownership there.
VelarScript does not re-prove what it wrote itself, so the copy is the boundary:
pass `values.copy()` when the other side must not be able to change what you
read. This is the exposure a plain foreign write has always had.

A frozen array is refused on arrival from JavaScript, with the message that
names the fix. Freezing a `List` VelarScript already holds makes `append`, index
assignment, `insert`, `pop`, `remove`, and `clear` refuse — on every `List`,
whoever built it, and never with a bare JavaScript error.

## 9. Control flow

### If

```velar fragment
if score >= 90:
    grade = "A"
else if score >= 80:
    grade = "B"
else:
    grade = "C"
```

As with every ordinary suite, an `if` or `else` branch with exactly one
non-block statement may share the header's logical line, including an `else
if` branch. A comment after the colon does not count as a body, so the following
statement still uses indentation.

```velar fragment
if render.animation != null: animations.add(render.animation)
```

A condition judges truth, not presence. `if`, `else if`, `while`, `assert`, the
`?:` test, and the operands of `and`/`or`/`not` accept `bool` and `bool?`, where
an absent `bool?` is `false`. Every other type is rejected, including optionals:
JavaScript truthiness would make `0`, `""`, and an empty collection take the
`else` branch, so a presence test is written `value != null` and an emptiness
test is written `values.size == 0`. The diagnostic names the explicit form for
the value's type.

Conditional values use the JavaScript-shaped `condition ? then : else` form.
Python's sentence-like `x if condition else y` expression form is not used;
that is separate from the single-statement `if condition: action()` branch
shorthand above.

### Match

`match` handles finite values, runtime type branches, and structural record or
List patterns without JavaScript fallthrough.

```velar fragment
match status:
    case Status.pending, Status.active:
        print("Open")
    case Status.done:
        print("Closed")
```

Any pattern may bind the whole matched value with `as`. Type patterns may also
add a guard:

```velar fragment
match result:
    case User as user if user.active:
        show(user)
    case User as user:
        archive(user)
    case Error as error:
        throw error
    case null:
        pass
    case _:
        print("Unsupported")
```

Record patterns use the same field spelling as records and object
destructuring. A shorthand field captures that field, a nested pattern follows
`:`, and `...rest` captures the remaining fields:

<!-- velar-preamble
type ListedUser:
    name: string

type Response:
    kind: string
    users: List<ListedUser>
    requestId: string
    message: string

const response: Response = {kind: "success", users: [{name: "Ada"}], requestId: "r-1", message: ""}
-->
```velar fragment
match response:
    case {kind: "success", users: [first, ...rest], requestId} as result:
        print(first.name)
        print(rest.size)
        print(result.kind)
    case {kind: "failure", message}:
        print(message)
    case _:
        print("Unsupported response")
```

Enum singleton fields make the same record pattern a discriminating pattern:

```velar fragment
match event:
    case {kind: EventKind.text}:
        print(event.text)
    case {kind: EventKind.tool}:
        run(event.toolId)
```

`[first, second]` matches a List of exactly two items. `[first, ...rest]`
matches one or more items and creates a new List for `rest`; `[]` matches only
an empty List. Object patterns require each named field to be a present own data
field, permit additional fields, and never invoke accessors while checking or
capturing. Nested object and List patterns follow the same rules. `_` is the
only wildcard and never creates a binding; it covers every position, so the
fallback branch is also spelled `case _:` — `match` has no `else` clause, and
the removed `else:` spelling receives guidance. Reusing a binding name inside
one pattern is an error.

A dotted path is a value pattern at any depth: `case config.limits.max:`
reads the path once and compares by SameValueZero, exactly as `==` would —
the father language's rule that a dotted name is a value while a bare name is
a binding. A bare local binding cannot be matched directly; use a dotted path
or a guard (`case _ if value == limit:`). Alternatives are spelled with a
comma (`case a, b:`); `|` joins types only in type annotations. Keyword
member names follow the ordinary member-access grammar in patterns
(`case S.null:` matches the member named `null`).

Match exhaustiveness over an enum subject demands every member; over an
optional enum subject (`Status?`) it demands every member plus `case null:`.
A parenthesized singleton pattern — `case (Status.done):`, the type-pattern
spelling of one member — credits that member's coverage exactly as the value
pattern does. A guarded case matches only when its condition holds, so it
never counts toward exhaustiveness; the diagnostic says so when a guard is
the only mention of a missing member.

The matched expression evaluates once. Guards run only after their pattern
matches, and a successful guard narrows its case body by the same rules as
`if`. A successful pattern also narrows the original matched identifier or
stable data field in its guard and body, so `case User:` makes the matched value
a `User` without requiring an `as` alias. Pattern failure also carries facts to
later cases, so the path after `case null` treats an optional matched
location as present. A failed guard continues to the next case after
retaining any effects it already performed. Cases are mutually exclusive: a
write in one case cannot erase a fact used only by a sibling, but facts
invalidated by a case that reaches the code after `match` stay invalidated.
Facts established by every continuing
case remain available after an exhaustive match. Guarded cases do not count as
exhaustive because the guard may be false. A match whose subject's static type
is a class — or a union containing one — must be provably exhaustive, exactly
as strict as the enum rule: class hierarchies are open, so the match ends with
the subject's own class or a base of it, with `case _:`, or covers every union
member (a subclass instance still satisfies its base pattern). An extern class
check may fail at runtime, so only `case _:` proves an extern subject.
Complete enum matches, an unguarded
wildcard, exhaustive List length patterns, and irrefutable patterns over
required typed record fields participate in required-return analysis. `match`
remains a statement; branches use ordinary `return` or assignments instead of
introducing a second expression form.

A case body uses the ordinary suite rule, so exactly one non-block statement may
share its header's logical line. The `match` header and its case list remain
indentation-owned, and a case with multiple statements or a nested block uses
the ordinary indented body.

```velar fragment
match status:
    case Status.pending: print("Pending")
    case Status.active: print("Active")
    case _: print("Done")
```

`switch` is not VelarScript syntax.

### Loops

<!-- velar-preamble
type User:
    name: string

type Reply:
    next: () -> Promise<string?>

async def nextChunk() -> string?:
    return null

const users: List<User> = [{name: "Ada"}]
const usersById: Map<string, User> = Map([["user-1", {name: "Ada"}]])
const reply: Reply = {next: nextChunk}
let attempts = 0
-->
```velar fragment
for user in users:
    print(user.name)

for user, index in users:
    print(f"{index}: {user.name}")

for id, {name} in usersById:
    print(f"{id}: {name}")

async for chunk, index in reply:
    print(f"{index}: {chunk}")

while attempts < 3:
    attempts += 1
```

`break` and `continue` are available only inside loops. A single-slot `for`
keeps its original contract: List/Set values, Unicode string characters, and
Map keys. A two-slot `for first, second in value` yields value/index for Lists,
Sets, and strings (the string index counts code points), and key/value for Maps.
Both slots accept the complete binding-pattern grammar. Brackets continue to
mean destructuring one item, so `for [left, right] in pairs` is not a two-slot
loop; three slots are rejected. Both slots bind whatever stands in them, so a
header written index-first — `for i, value in items`, a hybrid neither Python
nor JavaScript has — cannot be rejected. It draws advisory `A2` when the first
name reads as an index and the second reads as a value or as the collection's
own singular; both halves must read that way, because one name alone proves
nothing. The swap is offered as an editor fix and withheld from `velar fix`:
which name binds which value is a judgement, and a loop deliberately written
this way would be silently reversed.

A class joins these loops by declaring `@iterate:` (section 10), which answers
with a List, Set, Map, or Record. Iterating the class then means iterating that
collection, word for word — the same slots, the same order, the same element
types. So does every other consumer of an iterable: `value in bag`, the list
spread `[...bag]`, the call spread `f(...bag)`, and `Set(bag)` / `Map(bag)` all
read the one contract, and a class either participates in all of them or in
none.

`@iterate:` has a second form, and the shape of its answer is what tells the two
apart. A block answering a List, Set, Map, or Record is the synchronous form the
consumers above read. A block answering `T?` is the asynchronous pull form: one
element per pull, `null` for exhaustion, and that block may `await`. `async for`
drives the asynchronous form and only it, and every synchronous consumer reads
the synchronous form and only it. Each refusal names the other form, so a class
and the loop over it are always one message apart. A class declares one form or
the other, never both, and an override keeps the form and the answer its base
promised.

`async for value in source` therefore reads one of two declarations. A
VelarScript class declares the asynchronous `@iterate:`. Every other source
declares the structural pull contract — a data-valued `next` of the checked type
`() -> Promise<T?>`, the shape a capability handle, an extern class, or a
declared record carries. A `next` method written on a VelarScript class is not
that contract: it is an ordinary member of the author's own namespace, and the
refusal says so and names the `@iterate:` block its body belongs in. The source
and its `next` are captured once; the capture reads a plain function — through
the prototype for a handle whose contract declares `next` as a method, and off
the value itself for an extern class, whose contract must declare it as a
function-valued field, because section 12 trusts a checked declaration's member
kinds and only a field promises a function standing on the value — and never
invokes an accessor. Each pull must return an actual Promise; a
resolved `null` ends the loop, a resolved `T` enters the body, and rejection
leaves the loop unchanged. The optional second slot is a
zero-based pull index. It advances before the body, so `continue` cannot repeat
an index. `break` performs no further pull.

The loop does not invent resource ownership. It never calls `close`, `return`,
or another cleanup hook when it exhausts, breaks, throws, or is cancelled.
Sources that own files, sockets, processes, or request cancellation expose and
document an explicit operation; the caller remains responsible for it, and the
spelling for that responsibility is `using` (section 9, *Owned resources*):
`using source = await openSource()` above the loop releases it on every exit,
including the loop's `break`. `async for` is a small checked pull protocol, not the
JavaScript `Symbol.asyncIterator` protocol and not an implicit generator model.
The JavaScript spelling `for await` is rejected with guidance to put the async
marker before the Velar loop.

`range(end)`, `range(start, end)`, and `range(start, end, step)` are prelude
names that need no import; they produce a stop-exclusive bounded `List<number>`
for loops and ordinary List use. Negative steps count down and zero steps fail. Named
forms are `range(end=...)`, `range(start=..., end=...)`, and the same with
`step=...`. A direct loop head `for item in range(...):` evaluates every
argument once, performs the same complete range validation, and then lowers to
a native counter without materializing the List. Saving the range in a value,
passing it through another expression, or using the loop's two-slot
`for value, index in ...` form keeps the ordinary List path.

A `while` body receives the successful condition's facts on every
iteration; assigning a narrowed optional back to `null` invalidates that fact
for the remainder of the current iteration. A guard arm ending in `break` or
`continue` terminates like a `return` for the current iteration: the statement
after the `if` keeps the negated condition facts, so a pull loop reads
naturally:

```velar fragment
while true:
    const chunk = chunks.get(cursor)
    if chunk == null:
        break
    assembled += chunk
    cursor += 1
```

Draining a List needs no optional at all — `pop` is strict, so the shorter and
more direct spelling is a size guard: `while chunks.size > 0:` with
`assembled += chunks.pop(0)` in the body. The `while true` shape above is for
a pull source whose exhaustion is genuinely reported as `null`.

The two exits differ after the loop. An arm's writes still escape it — `break`
carries them directly to the code after the loop, and `continue` carries them
back through the condition — so the after-loop merge sees them either way, and
a loop that can `break` may exit while its condition still holds, so the
condition's negated facts do not persist past it. A loop with no reachable
`break` of its own is left only by its condition failing, so there those
negated facts do persist whatever the body does — the fact carried out is what
the entry test and the back-edge test both prove, because the loop is left
through whichever of the two failed. Conversely, a literal `while true` has no
failing condition, so its breaks are its only exits, and the facts every one of
them proves hold after the loop; one break that proves less carries nothing
out. Writes after an unconditional
`return`, `throw`, `break`, or `continue` do not affect reachable flow facts. If
a loop body can only return or throw, its writes cannot escape to the skipped
path after the loop. A literal `while true` with no reachable `break` owned by
that loop cannot fall through, so it satisfies an explicit non-null function
result even when some iterations continue forever. A `break` in a nested loop
does not make the outer loop fall through; a reachable break owned by the outer
loop does.

### Owned resources

`using name = expression` says that this scope owns the value and is
responsible for releasing it. The binding is immutable, and every exit from the
enclosing scope — falling off the end, `return`, `break`, `continue`, or a
throw — releases it. Several owned resources release in reverse declaration
order.

<!-- velar-preamble
class LogFile:
    @dispose:
        pass

    @iterate:
        const line: string? = null
        return line

async def openLog(path: string) -> LogFile:
    return LogFile()
-->
```velar fragment
async def collect(path: string) -> number:
    using source = await openLog(path)
    let lines = 0
    async for line in source:
        lines += 1
    return lines
```

Three ideas stay separate. `using` is ownership. `@dispose:` is the release
contract. `close()` and `stop()` are ordinary public verbs that mean what they
say. A type never has to be renamed to participate.

A class declares its own contract as a compiler-owned `@dispose:` block, which
usually delegates to the verb the class already publishes:

```velar fragment
class Terminal:
    def close():
        releaseHandle()

    @dispose:
        self.close()
```

`@dispose` cannot be called from source — it is the ownership contract, not a
second spelling of `close()` — and it may coexist with an ordinary method
named `dispose`. It must be safe to run twice, so releasing after an explicit
`close()` is harmless and no early-exit syntax is needed. The compiler supplies
the contract for the standard capability handles, delegating to the verb each
one already has, so `using` works on them with no declaration at all.

The `@dispose:` body may `await`. When it does, releasing awaits too, and the
`using` must sit in an async scope; acquiring is ordinary async work written as
`using name = await open(...)`. A record cannot be owned: a record is data, and
releasing is behavior. Neither can an `any` or an `unknown`: a JavaScript value
carries no release contract, and an extern class declares the foreign shape
rather than a VelarScript contract. The spelling that works for a foreign
handle is composition — hold it in a field of a class whose `@dispose:` block
releases it, and own that class.

A release failure never hides a real error. When an error is already in flight
the original error is what propagates and the release failure is reported
through the host error channel; with no error in flight, a failing release
throws normally, exactly as a `finally` would.

Ownership needs a scope that ends, so `using` is rejected where none does: the
module top level lives until the process ends, and a component body builds the
component rather than finishing. Function bodies, methods, actions, lifecycle
cleanup hooks, `watch` bodies, and loop bodies — which release on every
iteration — are all ordinary owning scopes.

An owned value may not leave the scope that releases it. `return handle`,
storing it in a binding or member that outlives the scope, and capture by a
closure that itself escapes are all rejected: the reference that left is
already known to be dead, so letting it out would be handing on a released
handle. This is what `using` means, not a restriction added on top of it. Two
exits are always available — move the `using` up to the scope that really owns
the resource, or return the data you read from it. Passing the handle to a
function stays legal: a callee borrows, and a borrow is not ownership.

<!-- velar-preamble
class LogFile:
    @dispose:
        pass

    @iterate:
        const line: string? = null
        return line

async def openLog(path: string) -> LogFile:
    return LogFile()
-->
```velar fragment
async def lineCount(path: string) -> number:
    using source = await openLog(path)
    let lines = 0
    async for line in source:
        lines += 1
    return lines
```

A derived class's `@dispose:` adds to its base's rather than replacing it. The
compiler chains them, derived first and base after — the reverse of
construction order, the same intuition reverse-order release already has — so
an author's block is only responsible for what that class declared. A base
release that fails does not undo the derived part that already ran, and when
both fail the release-failure priority above decides which error propagates.
Because a `using` reads the release contract from the value's *static* type, a
subclass may not begin awaiting where its ancestors release without awaiting:
that would leave a base-typed owner releasing without an await.

## 10. Classes

Classes use typed body fields and one explicit constructor.

```velar
class Session:
    let active: bool = true

    constructor(const id: string):
        pass

    get label() -> string:
        return self.active ? self.id : f"{self.id} (closed)"

    def close():
        self.active = false
```

- Fields are `const` or `let` and require a type.
- A `const` field's protection is compile-time. Runtime validation provides no
  extra guard for it — and needs none, because a class instance never
  satisfies a record contract (section 12), so no validated record view can
  alias an instance and write through its fields.
- A field initializer is optional.
- A constructor parameter prefixed with `const` or `let` declares a public
  instance field and initializes it from that argument. Prefix the parameter
  property with `private` for native private storage. Parameter properties
  require an explicit type and cannot be rest parameters.
- An ordinary constructor parameter remains local to the constructor. Required
  body fields are initialized through one direct `self.field = value` assignment.
  *Direct* means one plain `=` at the top level of the constructor body with
  `self` written literally: an assignment inside an `if`, a loop, or a `try`, a
  compound assignment, an assignment through an alias of `self`, and an
  assignment made by a method the constructor calls all leave the field
  uninitialized as far as the checker is concerned. Definite assignment is what
  the rule buys; a field whose value depends on a branch takes an initializer
  and is overwritten, or the branch chooses a value that one assignment stores.
- In a derived class, parameter properties initialize after the leading
  `super(...)` call and before body field initializers and the remaining
  constructor statements.
- There is no class-header constructor shorthand.
- Instances are called directly: `Session("session-1")`.
- `self` is explicit in method bodies.
- Getters read as ordinary properties.
- `@dispose:` and `@iterate:` are the compiler-owned class roles. `@dispose:`
  declares the release contract `using` runs (section 9, *Owned resources*).
  `@iterate:` declares what iterating the class means (section 9, *Loops*).
  Neither is callable from source, a class may declare at most one of each, and
  `@` qualifies them into the contextual compiler namespace, so an ordinary
  member the author declares can never collide with one.

`@iterate:` returns the collection the class iterates as:

```velar
class Bag:
    let items: List<string> = []

    @iterate:
        return self.items
```

The block runs with `self` in scope, and its answer says which of the two forms
the class declares (section 9). Answering a `List`, `Set`, `Map`, or `Record` —
the shapes the language already knows how to iterate — is the synchronous form:
`for item in bag` means what `for item in bag.items` means, including the
element type, the two-slot meaning, and the `readonly` projection of a read-only
answer. Every consumer reads that answer whole and synchronously, so a
synchronous block may not `await`; await the work before construction and hold
the finished collection. Answering `T?` is the asynchronous pull form `async for`
drives — one element per pull, `null` for exhaustion — and that block may
`await`. Any other answer is refused, and the message names both forms. That is
the whole class hook in either form: it does not expose an iterator object or
generator and does not turn an author's ordinary `next()` method into the
hook. The block is not callable as `bag.iterate()`. The compiler-owned
`Map.iterator()` cursor is a separate built-in collection operation and does
not change this class contract.

A derived class inherits the block. Overriding it *replaces* the answer rather
than composing a chain, because there is only one answer to give; the
replacement must still be the same form and the same type the base promised —
the same collection for the synchronous form, the same element for the
asynchronous one — by the same invariance rule every other override follows. A
base-typed binding would otherwise walk a different element type, or stream
where it was promised a collection.

Inheritance is explicit:

```velar
abstract class Entity:
    constructor(const id: string):
        pass

    abstract def describe() -> string

class Player extends Entity:
    constructor(id: string, let score: number = 0):
        super(id)

    override def describe() -> string:
        return f"{self.id}: {self.score}"
```

A derived constructor calls `super(...)` before using `self`. `abstract` and
`override` are checked for instance and static methods and getters. An override
signature is strictly invariant: parameter types, arity, and the result type
must match the base declaration exactly, while parameter names are the
override's own. `-> number` does not
override `-> number?`, even though the narrower result would be harmless,
because one rule the reader can hold beats a correct variance table nobody
remembers; result covariance is a deliberate exclusion that a real site can
reopen. `static`
declares class-owned fields and methods; inherited static fields cannot be
redeclared because that would create two independent storage locations.
`private` lowers to native JavaScript private storage and is accessible only
inside the declaring class. The Velar spelling remains `private let field` and
`self.field`; direct JavaScript private-identifier syntax such as `#field` or
`self.#field` is rejected with a safe fix that removes only the `#` marker.

`super.member` reaches base methods and getters — the members whose derived
definition would otherwise shadow the base one. A base *field* is one storage
location shared by the whole instance, so it is read and written through
`self.field`; `super.field` names nothing. Position follows JavaScript's
lexical rule: `super` is available directly in a derived constructor, method,
getter, or field initializer and remains available inside a nested arrow. A
nested `def` creates a new function boundary and does not inherit `super`; name
the base class explicitly when that is the intended call.

`self` is a keyword only where an instance exists — a constructor, method, or
getter body. It does not exist in a field initializer, which runs before the
instance is complete, nor in a static member, which has no instance; both
positions report the rule rather than an unknown name. `self` is not, however,
a reserved member name: a class may declare a field or method called `self`,
and `self.self` reads it. The receiver keyword and the member namespace are
separate, so no vocabulary is taken away from data that legitimately names a
self-reference.

A class name is not a value. It is used directly: called to construct
(`Session("session-1")`), read for static members, extended, named in type
positions, matched with `is` and `case`, and carried by export declarations.
Aliasing a class name, passing it as an argument, storing it in a collection,
returning it, or printing it is a compile-time error whose diagnostic teaches
the factory spelling — wrap the construction in an arrow:

```velar fragment
const openSession = () => Session("session-1")
```

Factories, registries, and injected constructors are arrows with ordinary
function types, so the class surface stays nominal while behavior passes
through values the type system already owns. Abstract and extern classes
follow the same rule. A `match` over a class hierarchy must be provably
exhaustive (section 9).

VelarScript preserves JavaScript prototype and reference semantics at runtime,
but source cannot read or mutate `prototype` or `__proto__` as object-model
entry points. It does not copy Python's multiple inheritance, metaclasses,
descriptors, or operator overloading.

## 11. Errors and assertions

Only `Error` values can be thrown from checked VelarScript. That is a rule
about `throw`, and it does not claim that every failure originates in source:
the compiler injects guards of its own, and they raise. A checked class-field
read raises a host `TypeError` when the field holds `undefined`, and a stale
flow fact raises `NarrowingError` at the read that relied on it (section 18 and
section 5 own the two mechanisms). Both arrive at a `catch` binding as `Error`
values under the normalization below, so a catch binding still never sees a
non-`Error` — but a reader tracing a failure back to a `throw` will not find
one, and should look at the read.

```velar fragment
try:
    await save()
catch error:
    print(error.message)
finally:
    close()
```

JavaScript boundary failures are normalized to `Error` before entering a catch
binding. Primitive thrown values retain a readable message. Objects and
functions receive a stable generic message and remain available as the
JavaScript `cause`; normalization never calls their conversion hooks — and
`error.cause` is a readable `unknown` member on every checked `Error`, so the
original value stays reachable (validate it before use; an absent cause reads
as `null`). The generated module captures native Error identity/construction
and primitive String conversion when it initializes; replacing those ambient
operations later cannot change which value reaches the checked catch binding.

The three compiler-raised error types are nameable: `ValidationError` (a
failed `parse`), `NarrowingError` (a stale flow fact caught by a runtime
recheck), and `IndexError` (an out-of-range or non-integer List position).
Each extends `Error`, so `catch` receives it as an `Error` and `is` narrows
it — `if error is ValidationError:` — and each may be constructed and thrown
directly. `ValidationError` carries the failure detail its parse sites
report: `path` (for a record, `TypeName.field`), `field`, and `reason`, each
`string?`. The three names are reserved Core bindings and cannot be extended;
extend `Error` for custom hierarchies. An `Error` subclass reports under its
declared name: the class lowering sets `.name` to the class name, so reports
and `print(error.name)` say `TimeoutError`, not `Error`.

### Discrimination is the class; `code` is its string form

An error has exactly one classification: **its class.** VelarScript publishes
no parallel table of error-code constants, because a second classification only
makes a reader — and a writer — hesitate between two spellings of the same
question. Inside the language you ask the class:

```velar fragment
try:
    await readText(path)
catch error:
    if error is FileNotFoundError:
        await createText(path, "")
    else if error is PermissionError:
        print(f"Cannot read {path}: {error.message}")
    else:
        throw error
```

Class identity cannot cross a JSON or log boundary, so every checked `Error`
also carries a readonly `code: string` beside `message` and `cause`. Its value
is the instance's declared class name — `"FileNotFoundError"` above. `is` is
the only discrimination authority, and `code` is that same identity in string
form: a value reports a `code` only when the class it was constructed from
declares that name, so `code` and `is` always agree. A value no VelarScript
class declared — a host `TypeError` that reached a catch binding, or a
JavaScript error a caller relabelled by writing `e.name = "..."` — reports the
contract it does satisfy: `"Error"`. `.name` still shows whatever the value
carries, which is why the discriminating question is `is`, never `name`.

`name`, `code`, `message`, `stack`, and `cause` are the Error contract's own
members. An `Error` subclass cannot redeclare any of them in any form: a
redeclared `name` would forge `code`, and a redeclared `message` would
silently discard the one passed to `super(...)`.

The capabilities raise these classes, each for a failure a caller recovers from
differently:

| Class | Raised by | The recovery it enables |
| --- | --- | --- |
| `FileNotFoundError` | `velar/fs` | Create the entry, or fall back to a default. |
| `PermissionError` | `velar/fs`, `velar/serve` | Stop and tell the operator; retrying cannot help. |
| `NotADirectoryError` | `velar/fs` | The path names a file — take the file branch instead. |
| `FileExistsError` | `velar/fs` | Choose another name, or replace deliberately. |
| `AddressInUseError` | `velar/serve` | Bind another port, or port `0` for any free one. |

Each carries the resource that failed where one exists: the four filesystem
classes expose `path: string?`. Like the three compiler-raised types they are
reserved Core bindings, need no import, and cannot be extended. Every other
capability failure stays an ordinary `Error`, because a caller writes the same
recovery for all of them: none. `velar/http` keeps its own imported
`HttpResponseError`, `HttpAbortError`, and `HttpTransportError`, whose fields
(`status`, `reason`, `phase`) a caller branches on directly.
`HttpResponseError` represents a non-successful outbound HTTP client response;
server routes use the separate `HttpProblem` semantic failure contract.

The `try` body and `catch` body are separate execution paths. A mutation in a
catch that returns cannot erase a fact used only by the normal try continuation,
while mutations that can precede a caught failure are visible inside the catch.
Facts established by every continuing path merge after the statement.
`finally` is analyzed after those paths and its effects apply to all of them.

`finally` is cleanup, not a hidden control-flow override. It cannot `return` or
use `break`/`continue` to leave the block, because those operations can silently
replace a pending return or exception. A loop wholly inside `finally` may still
use its own `break` and `continue`. Finish cleanup normally or `throw` an
explicit cleanup error, then return after the `try` statement.

### Expected failure as an optional

A failure the caller already expects is an optional, not a control-flow block.
`try expression` evaluates the expression and produces `null` if anything in it
throws:

```velar fragment
const parsed = try User.parse(untrusted)
const port = try readPort() ?? 8080
const body = try await load(url)
```

`try` reaches exactly as far as `await` does — the whole postfix chain — so a
failure anywhere in `try a().b().c()` produces one `null`. The result type is
`T?`; an already-optional result stays itself, because failure and an absent
value merge. `try try` is rejected, and so is a `try` whose expression produces
`null` on success, since that result could not tell the two apart. A `try` over
an un-awaited Promise is rejected for the same reason: it would catch only the
failure of *producing* the Promise, never the rejection the caller means, so
the guidance is to write `try await ...` and catch the real one.

The result must be consumed: a bare `try` statement is rejected, because a
swallowed failure with no visible consumer is exactly what this spelling must
not enable. `try` is an explicit, locally visible swallow with the same
standing as `?? fallback`; when the failure's details matter, the answer is
still `try`/`catch`.

Three failures are never converted to `null`: `AssertionError`,
`NarrowingError`, and `IndexError`. Those are the language saying the program
has a bug — a broken assertion, a stale flow fact, an out-of-range position —
and turning one into `null` would let a bug wear the costume of "not found".
They pass straight through `try`, and through any combinator that turns a
failure into a value or retries past it, such as `Promise.retry`. A `catch`
block still receives all three, because a `catch` is explicit: the author wrote
code to handle it, and `is` names which one it was.

Assertions remain active in production:

```velar fragment
assert 0 < width <= 4096 else "Width is outside the supported range"
```

A successful assertion narrows checked optional and type facts in the current
scope. An assertion message belongs only to the failing path: it is checked
with the condition's rejected facts, evaluated only on failure, and cannot
invalidate facts on the successful continuation.

## 12. Modules and JavaScript boundaries

VelarScript modules use explicit imports and exports:

```velar
import * as url from "velar/url"

export const version = "1"
export def encode(value: unknown) -> string:
    return Json.stringify(value)
```

The whole module-boundary family — `import`, every `export` form, re-exports,
`import js`, `extern module`, and the inline foreign-source blocks below — is
module-top-level only, like `type`, `class`, and `enum` declarations; writing
one inside a block or function body
is a compile error, never partially-working shadow state. A module cannot
import from or re-export from itself: the self edge has no valid evaluation
order, so the answer is to use (or declare) the binding directly. Each module
file is one instance, so two import spellings that name the same file (a
casing variant on a case-insensitive filesystem, a path through a link) are
rejected rather than silently instantiating the module twice.

Initialization outside `@main` follows the ES modules the program compiles to,
and the rules
are worth stating because one of them surprises Python readers. Every module
initializes at most once per program, however many modules import it: a diamond
does not run its shared dependency twice, and a module reached both statically
and dynamically is still one instance. A module's dependencies are fully
initialized before its own first statement runs, in the textual order of its
import declarations. Import declarations are hoisted above every other
statement in the file, so a statement written *above* an import still runs
*after* that dependency has initialized — if `./dependency.vel` prints
`"first"`, this module prints `"second"` and `"third"` after it:

```velar fragment
print("second")
import {name} from "./dependency.vel"

print(f"third: {name}")
```

The formatter keeps imports where they are written, so a mid-file import is
legal and its position never changes what initializes first. Write imports at
the top of the file so the reading order matches the initialization order. A
module that owns program startup places its directly awaited work in `@main`;
that region runs only for the selected entry after its imported dependencies
have initialized.

Relative `.vel` modules and package exports are supported. Project modules are
checked as one dependency graph. A function or value may carry the shape of an
unexported or unimported record across that graph, so its fields remain checked,
but the record's source name is not silently declared in the consumer. Import a
type explicitly when naming it in an annotation:

```velar fragment
import {User as Account, loadUser} from "./users.vel"

const user: Account = loadUser()
```

JSON files enter that graph through an explicit resource import:

```velar fragment
import json rawCatalog from "catalog-package/block-catalog"

type Catalog:
    readonly version: number
    readonly blocks: List<string>

const catalog = Catalog.parse(rawCatalog)
```

The imported value is `unknown`, never an inferred record and never `any`.
Application code must validate it with a Runtime Type before reading fields.
A project may import a relative `.json` file contained by its source root. A
published VelarScript package must declare every importable resource as an
exact `velar.resources` subpath and expose the same file through npm
`exports`; wildcards, traversal, symbolic-link escapes, non-JSON resources,
invalid UTF-8 or JSON, and files larger than 4 MiB are refused. The checked resource
graph is shared by `check`, `run`, `test`, `dev`, and `build`: development
watches it, browser builds bundle it, and unbundled/test output copies the
exact checked bytes plus the generated ESM wrapper used by emitted imports.
The package declaration and output layouts are specified in
[package distribution](package-distribution.md#package-resources).

There is no separate type import. `import type {User} from "./x.vel"` and
`export type {User} from "./x.vel"` are recognized — the TypeScript habit is
frequent enough to be worth teaching — and refused with the reason: VelarScript
does not erase types. A named type carries its runtime validator, an enum is a
runtime value, and a class is a runtime value, so a type import is an ordinary
import and the marker has nothing left to mean. Dropping the word is the whole
rewrite, so `velar fix` applies it. TypeScript needs the form because TypeScript
erases: there, a type import can carry no module edge. Here every import of
every name carries one, which is also why a module imported only for its
initialization side effects behaves exactly as written.

VelarScript modules have no default export in either direction: every export
carries a name, `export default` is rejected with that answer, and a default
import from a `.vel` module is answered the same way (`import js Name from
"pkg"` remains the JavaScript-bridge spelling for a package's `default`
export).

An unused import is not an error and produces no warning. The language has no
warning level, so an error on a name the author is about to use would shout in
the middle of an edit. `velar fix` does not remove one either: it applies only
the rewrites a diagnostic registered, and there is no diagnostic here to
register one. Importing a name still initializes the module it comes from,
whether or not the name is ever read.

An import that binds *nothing* is a different matter, and both of its spellings
are refused: `import "./register-formats.vel"` and
`import {} from "./register-formats.vel"`. A side-effect import is invisible
action — the reader sees the line and has to go open the module to learn what it
did. No mechanism in VelarScript may hide behavior from the owner of the code,
which is the same rule that keeps user-defined decorators out (section 19). Both
parent languages spell this, and that has never been sufficient on its own: the
language has already removed truthiness, coercive equality, and `switch`, which
both parents also have. Export a function and call it, so the effect appears
where it happens:

```velar fragment
import {installFormats} from "./register-formats.vel"

installFormats()
```

One resource boundary is deliberately exempt, because it has no callable
equivalent: `import css unsafe "./theme.css" before look` (section 17) names a
stylesheet rather than an action.

An imported name is read-only in the receiving module, but an `export let`
remains a live ES-module value: the exporting module can reassign it between
reads. The module contract records that distinction, and modules with live
exports must be imported by name rather than through `* as`; namespace fields
are always read-only.

A checked JavaScript import binds the live ES binding too. `import js {name}`
emits a real named import and runs its presence probe beside it as a separate
statement, so `import js {name}`, `import js * as`, and `unsafe js` all observe
the same value: a `let` the JavaScript module reassigns is read at its current
value through every spelling. A contract changes what the compiler proves about
a boundary, never what the program observes across it. The presence probe is
that boundary's backstop rather than its primary check — a host that link-checks
named imports refuses a declared-but-absent export before any statement runs, in
the host's own voice, and where the name links to `undefined` instead, as
bundled CommonJS interop does, the probe is what reports. One spelling stands
apart: an inline block that captures VelarScript values receives them as
parameters to a factory function, so that block's own bindings are function-local
rather than module-level, and a name read directly holds the value it had when
the block finished initializing. A function the block exports still closes over
the live variable and answers with the current one.

A module can re-export another module's named exports without creating local
bindings, which is how a package entry exposes symbols from its internal
modules (a barrel). Re-exported names join the module's interface under their
aliases with the full origin contract, including live-export mutability, and
lower to native ES-module re-exports. Namespace re-export (`export * from`)
is deliberately absent; name every symbol so the module interface stays
explicit:

```velar fragment
export {renderMarkdown, highlightFence as highlight} from "./markdown.vel"
```

Different modules may use the same record display name; their field metadata is
kept separate until ordinary structural assignability is checked.

### Dynamic import

`import(path)` loads a module on demand and answers a Promise of that module's
namespace:

```velar fragment
const reports = await import("./reports.vel")

print(reports.title)
```

The path is a literal relative `.vel` path — never a package name, a `velar/*`
module, or a computed string — because the module graph must stay decidable at
compile time. A path that does not resolve is a compile error with the nearby
name suggested, not a runtime surprise. The result is the module's checked interface rather than a dynamic
object: `reports.title` has the exported binding's type, and reading a name the
module does not export is a compile error.

Failure is ordinary and catchable. A dynamically imported module that throws
while initializing rejects the Promise with that error, so a `try`/`catch`
around the `await` owns it:

```velar fragment
try:
    const plugin = await import("./plugin.vel")
    plugin.install()
catch error:
    print(f"plugin unavailable: {error.message}")
```

Caching is the module graph's, and it is deterministic: the first load
initializes the module, every later `import(...)` of the same path answers the
same already-initialized namespace, and a module reached statically elsewhere is
not initialized a second time by a dynamic import. An initialization failure is
remembered the same way: a module whose body threw answers every later import of
that path with the same error instead of running its body again, so re-importing
is not a way to retry the module itself.

Enum singleton identities follow the declaring enum through named imports,
renamed imports, re-exports, and aliases. Renaming `EventKind` to `Kind` changes
the local display spelling to `Kind.text`; it does not turn the member into a
different state or an ordinary string. An explicit external string mapping is
owned by the declaration and crosses the runtime module boundary with that
member; consumers still refer to the nominal member name.

Every runtime `Type.is(value)` and `Type.parse(value)` record check requires its
non-optional fields to be present own enumerable data properties. Optional
fields may be absent; when present they must follow the same owned-data rule.
A record also accepts only plain data objects: the value's prototype must be
`null` or a prototype that itself has none (some realm's `Object.prototype`,
checked structurally so plain values from other realms validate). Class
instances, `Error` values, and host objects never satisfy a record contract —
at the top level and in every nested field position — so a validated record
view can never alias a live instance; project the fields into a record
(`{x: instance.x}`) to convert deliberately.
Inherited fields and accessors do not satisfy a record contract, and validation
never invokes a getter. This is the same owned-record invariant used by
structural `match`.
Records remain structurally open: additional own data fields are permitted, so
decoders can accept forward-compatible protocol metadata, but every declared
singleton field must equal its exact enum member.

Openness is about what a decoder may *accept*, not about what an author may
*write*. A record literal written at a position that carries a type annotation
is closed: every one of its keys is in front of the compiler there, so a key the
type does not name is a misspelling rather than a value that happens to be
wider, and it is reported with the nearest declared field name. A value that is
not a literal keeps the structural openness above, because the compiler cannot
tell a wider value from a mistake. A spread's surplus fields are untouched for
the same reason — only the keys written out in the literal are read.

Validation proves the shape a value has at that operation; it does not
constrain what an unchecked Proxy may do on later reads. Nor does it inherit
anything from where the value was found: a value validated out of an `unknown`
is a fresh, independent assertion over that data. It is also a fresh value —
`parse` returns a copy — so a value reached through a `readonly` view does not
widen by passing through `parse`, a later write through the source cannot
falsify a field of what the caller was handed, and a frozen source parses into
an ordinary writable record rather than one whose first write dies with a host
`TypeError`. The copy carries the declared shape: fields the type names are
rebuilt, nested records and collections included, while a class instance, a
promise, a function, a `Duration`, an enum member, and an `unknown` field pass
through by reference, because rebuilding an opaque value structurally would
change what `parse` returns. A shared or cyclic subgraph is copied once per
declared type, so the copy preserves the sharing the source had wherever the
source's sharing was sharing of the same shape. One object reached at two
positions that declare two different types is two different proofs, so it yields
two copies — projecting it once and reusing that copy would hand the second
position a value missing the fields its own type names. Keys the type does not name are not
carried across: records stay open to what a decoder may accept, but what `parse`
returns is the shape it proved. Validate at the boundary, before the data is
stored anywhere a read-only promise is made about it.

Native JavaScript is explicit:

```velar
import js unsafe {legacyValue} from "legacy-package"
```

Larger boundaries should use checked `extern module` declarations. Unsafe
imports do not silently gain trustworthy VelarScript types. See
[javascript-bridge.md](javascript-bridge.md).
Checked declarations are trusted static ABI contracts, not a JavaScript sandbox
or an implicit runtime schema validator. That trust includes member kinds: a
member declared as a field is a stable narrowing location, exactly like a local
class field. Values that are not already guaranteed by their package should
enter as `unknown` and be validated explicitly with the application's runtime
`Type`.

### Inline foreign source

`extern module` declares what a *package* exports and `import js` names it, so
JavaScript that has **no package to come from** — a global, a shim, a few lines
that exist only for this module — has no import spelling. It gets a block:

```velar
const tokenBytes = 16

extern js(tokenBytes: number)`
    export function sessionToken() {
        const buffer = new Uint8Array(tokenBytes)
        globalThis.crypto.getRandomValues(buffer)
        return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("")
    }
`:
    export def sessionToken() -> string
```

The backtick body is the module source; the indented block after the colon is
its contract, in exactly the `extern module` grammar. The parenthesized list is
a **capture**: each name binds the Vel binding of that name and is passed to
the emitted factory as a checked argument of the declared type, not substituted
as text. Captures are handed to a synchronous factory, so a block that takes
them cannot use top-level `await` — await on the Vel side and capture the
result.

`unsafe js` is the same block without a contract, for source whose shape cannot
honestly be declared. Its exports arrive as `unknown`, under the rules in
*Entering the type world* below:

```velar
unsafe js`
export const engine = () => ({arch: globalThis.process.arch});
`
```

A block ends at the first line holding nothing but its declaration's indentation
and a backtick — for the checked form, that backtick and a `:`. The rule is
structural, so it does not know what the JavaScript around it means: a template
literal or a block comment whose own backtick lands alone on such a line is cut
there, along with everything after it. There is no escape character; write that
backtick indented past the declaration, or at the end of a content line, and the
block reads as intended. The compiler names this rule whenever the truncated
source fails to parse, and cannot name it when the remnant happens to be a legal
module on its own.

An inline block is **more checked than the `import js unsafe` it replaces**,
not less: an unsafe import leaves a whole module unvalidated from a distance,
while a block puts the contract three lines under the source it governs. The
`data:text/javascript,` import that used to be the only way to write a module
inline is now rejected with a mechanical rewrite to the block form, which is
source-mapped where the data URL was not.

Both forms belong to Core, because JavaScript is the runtime Core already emits
into. The CSS counterpart, `unsafe css`, belongs to the Web extension and is
specified in section 13 — Core does not know what a stylesheet is.

### Entering the type world

A value that crosses in from JavaScript without a declaration — a binding from
`import js unsafe`, an export of an `unsafe js` block — arrives as `unknown`.
`unknown` is not a weaker checked type; it is the absence of a claim, and the
compiler holds the value there until the program makes one. The operational
model is three sentences, and every one of them matters:

1. **No operation passes through it.** A member read, an index, and a call are
   each refused, and each refusal names the step that answers it: declare a
   type naming the fields relied on, parse the value into it, read the result —
   with the call refusal naming instead the `extern module` or contracted
   `extern js` declaration that would have given the callee a signature.
   `await` is refused, because an unchecked thenable runs foreign hooks and can
   resolve to raw `undefined`. A condition is refused, because JavaScript
   truthiness would send `0` and `""` down the `else` branch while section 9
   judges `bool`. An f-string and `str()` are refused, because JavaScript
   coercion would invent text by running foreign hooks; `print` is how such a
   value is inspected and `Json.stringify` is how it is rendered as data text.
   The null test is the exception, and it is normalized like every other, so a
   foreign `undefined` answers `true` to `== null` rather than reading as
   present.
2. **It is assignable to no checked type.** `const label: string = raw` is a
   compile error, and so is `const value: string? = raw`. There is no position
   where an unchecked value is laundered into a checked type by being written
   down next to one, so the implicit conversion section 5 exists to reject
   cannot come back through this door.
3. **Therefore the entry site is where the program says what it has.** Narrow
   the value — `raw is string` — or declare the shape and parse it:
   `const config = Config.parse(legacyValue)`. What comes out is a checked value
   of that type, and everything inward of it is ordinary VelarScript. A value
   that travels further in unvalidated does not carry weakened guarantees; it
   carries none, and until it is validated nothing may read through it, index
   it, call it, await it, judge it as a condition, or render it as text.

This is the rule every other unvalidated input already follows, and that is the
point: an undeclared foreign value is not a special kind of value with special
permissions, it is data nobody has checked yet. The export position needs no
rule of its own. `any` cannot appear there because no annotation may spell it
anywhere, and a boundary value forwarded out of the module leaves as `unknown`,
which describes it honestly and binds the importing module to these same three
rules — which matters, because a consuming module never writes `unsafe` and has
nothing else on the page to warn it. Validate into a declared type in the module
that owns the boundary, and export that.

### Tests

A `*.test.vel` module declares its tests as named blocks:

```velar
import {expect} from "velar/test"

def scale(maximum: number) -> number:
    assert maximum <= 1000000 else "The chart maximum is beyond the supported range"
    return maximum

test "an oversized chart maximum is rejected":
    expect(() => scale(1000001)).toThrow()
```

The name is a string literal, and it is the test's identity: the reporter
quotes it verbatim, so it reads as a sentence about the code rather than a
machine-shaped function name. Names are unique within their module. A test body
is its own async frame and may `await` directly, and a test needs no `export` —
the runner discovers it.

`test` is a contextual keyword. It declares a test only at the top level of a
`*.test.vel` module, followed by a string literal and a block; everywhere else
`test` is an ordinary name. There is one spelling: a top-level `def test_*` in a
test module is rejected with the block to write instead.

## 13. Web extension boundary

Core does not contain JSX, components, reactivity, lifecycle, or styling.
Projects enable those features with `@velarscript/web` in `velar.json`.
Component JSX follows JavaScript evaluation order for props: they evaluate from
left to right, in the order the invocation writes them, once, before the
component function begins. Children are the exception, and deliberately so: a
`children` slot is rendered content owned by the position that shows it, so it
is built when that position renders and rebuilt whenever it renders again — a
slot hidden behind a condition costs nothing until the condition admits it.
Native JSX remains an owned DOM construction rather than a hidden Core-language
operation.

The source package then exposes the following language extension. This list is
the complete addition — twelve contextual keywords, two lifecycle hooks, two
reserved global functions, and the unit literals; nothing else in a Web module
is new syntax. Every *contextual keyword* here declares only in its own shape
and remains available as an ordinary name (section 3), `computed` included: it
declares a derived value in `computed name = expression` and is an ordinary
name everywhere else. The two reserved
globals are the exception: `mount` and `tick` are real runtime entry points, so
a Web module refuses them as binding names, as it does the media subjects
`viewport`, `scheme`, and `motion` (section 17). Those five words are the whole
difference between what a Core module and a Web module accept:

- `component`, with `exposes` on its declaration and `expose` in its body
- JSX expressions, including fragments and the `host` marker
- `state`
- `resource`
- `action`
- `watch`
- `@mounted`
- `@cleanup`
- `look`
- `keyframes`
- `import css unsafe "./file.css" before|after look`
- `computed name = expression`
- the reserved globals `mount(node, target)` and `tick()`
- unit literals such as `12px`, `1rem`, and `200ms`

This keeps the compiler independently usable for Core libraries while making
the official Web stack feel like one language.

Official Web modules own the browser operations they expose. They capture the
relevant host objects, constructors, prototype operations, timers, observers,
URL machinery, navigation functions, and storage/database operations when the
module initializes. Later
replacement of ambient globals or instance methods cannot silently change an
official API's semantics. Native platform values are read through their
captured branded getters; explicit data-only host doubles remain available to
the test boundary. Every value is still checked before it becomes typed
VelarScript data, and a genuine native operation error is preserved rather
than retried through a replaceable fallback.

## 14. Components and JSX

```velar
export component Greeting(name: string, emphasized: bool = false):
    return <p class={emphasized ? "emphasized" : null}>Hello, {name}</p>
```

Component names are PascalCase. Native elements use lowercase HTML/SVG names.
Props are checked from the component declaration. Boolean attributes may be
valueless. A literal attribute value is delimited by double quotes, backticks,
or the HTML single quote — the language's two string delimiters hold here as
everywhere else, so an attribute that contains a quotation mark is written with
backticks instead of escaped. JSX expressions use ordinary VelarScript
expressions, and the interpolation braces are a bracket context: the expression
inside `{...}` continues across physical lines without parentheses, exactly as
it would inside a call's parentheses. An attribute is a typed position: a
literal there is inferred against the declared prop type, so `items={[]}` needs
no annotation.

A prop uses exactly the type written on the component declaration. Record and
collection data is mutable by default, so a child may assign a field or call a
mutating collection method through that live input. An author who wants a
read-only component contract writes it explicitly: `component Guarded(task:
readonly Task)`. That existing Core view remains transitive and rejects writes;
the refusal is the component author's choice, not a projection imposed on all
props. The prop binding itself is still a live input slot rather than a
child-owned state cell, so `task = other` is not a way to replace the parent's
prop value.

`velar format` owns the layout of an element that opens and closes on one
line. Such an element is written on that line while it fits within 120
columns, and takes the block shape when it does not: the open tag, one child
per line indented one level, and the closing tag at the element's own
indentation. Attributes follow the same rule one level down — they stay on the
open tag until the open tag alone overflows, and then take one line each.

```velar fragment
component Toolbar(count: number):
    return <div class="toolbar">
        <span class="count">{count}</span>
        <button type="button">Refresh</button>
    </div>
```

Two things are never reflowed, because in markup they are content rather than
layout. Text between children is program text — markup drops a line break with
its indentation but keeps a written space — so an element whose children
include text keeps them on one line unless no text child carries a leading or
trailing space, and text itself is never re-wrapped. And an element the author
spread across lines keeps that structure, exactly like every other construct
in the language: the formatter canonicalizes spelling, not the author's line
breaks. A `{...}` hole is code, and code keeps its line.

Components are first-class constructor values, but they are not ordinary
functions and they are not rendered `WebNode` values. The Web extension owns a
structural `Component` type for passing those constructors through props,
locals, imports, and exports:

```velar fragment
type Row:
    title: string

type RowView = Component<(row: Row, compact?: bool) -> WebNode>

component DetailedRow(row: Row, compact: bool = false, tracking: string = ""):
    return <article>{row.title}{tracking}</article>

component Table(View: RowView, row: Row):
    return <View row={row} compact />
```

`Component` is the zero-application-prop contract. A typed contract uses one
named function-shaped signature whose result must be `WebNode`; the signature
describes JSX props rather than a callable function. `compact?: bool` means the
prop may be omitted, while `compact: bool?` remains required and accepts
`null`. Rest props and unnamed signature parameters are rejected. `class` and
`look` are implicit optional host props on every component contract, just as
they are on declarations.

Component compatibility is checked by prop name. A constructor assigned to a
contract must accept every prop that the contract permits its caller to pass,
with a compatible input type, and it cannot add a required prop that the
contract does not require. It may accept additional optional props. A
component value renders only as a PascalCase identifier tag such as `<View
row={row} />`; calling `View(...)` is rejected because that would bypass JSX
ownership, prop cells, and lifecycle.

A component may append `exposes HandleType` to its declaration and provide
exactly one `expose expression` in its body. `HandleType` must be a concrete
record type, and the expression must satisfy it. This is the only component
instance surface visible through JSX `ref`; internal state cells, lifecycle
scope, and the runtime component object are never exposed implicitly.
`expose` is top-level and position-independent relative to the component's
single top-level `return`; the conventional order places `expose` immediately
before a final `return`. The root is constructed before the Handle expression
is evaluated in either spelling.

```velar fragment
type DialogHandle:
    open: () -> null
    close: () -> null

type DialogView = Component<(title: string) -> WebNode, DialogHandle>

component Dialog(title: string) exposes DialogHandle:
    def open():
        print("open:" + title)

    def close():
        print("close:" + title)

    expose {open, close}
    return <dialog>{title}</dialog>

component Page:
    let dialog: DialogHandle? = null

    @mounted:
        if dialog != null:
            dialog.open()

    return <Dialog ref={dialog} title="Confirm" />
```

The optional second `Component<Props, Handle>` argument is covariant and is
preserved by module interfaces. A constructor may expose more than the required
Handle contract, but a constructor without a compatible Handle cannot satisfy
it. Bare `Component` and the one-argument `Component<Props>` contract do not
authorize a component ref.

A component element owns one stable instance for as long as its position is
mounted. Props are live inputs, not construction-time values: when a reactive
value passed as a prop changes, the existing instance sees the new value
through every prop read — render positions, watches, computed accessors, and
event handlers — and its local state, refs, and lifecycle are untouched. The
component body still runs exactly once per instance, so a `state` initializer
captures the construction-time prop value, and a body-level `const` derived
from a prop does not follow later updates — derive with `computed name = ...` when
it should. At a JSX position backed by a `Component` value, retaining the same
constructor identity retains the instance and its live prop cells; changing
the constructor identity destroys the old instance, runs its cleanup, and
mounts a fresh instance. An instance is otherwise destroyed and recreated only
when its position unmounts: a conditional branch switches, a keyed list entry's
key or value disappears, or the enclosing region re-renders away. The runtime-implemented components
`Head`, `Router`, `Link` and `NavLink` follow the ordinary rules like any other:
their props are read on every update, so `<Head title={f"Inbox ({unread})"} />`
tracks `unread` and `<Link to={path}>` follows `path`. One rule covers all four —
a reader should not have to remember which of them is the exception.

```velar fragment
export component TicketBadge(count: number):
    computed label = count == 1 ? "1 open ticket" : f"{count} open tickets"

    return <span class="badge">{label}</span>
```

JSX children render strings, finite numbers, booleans, enums, `WebNode` values,
or Lists containing those values. `null` and booleans render no text. Native
attributes accept strings, finite numbers, booleans, enums, or `null`.
These are the language's section 5 text-conversion contract — the same one
f-strings and `str()` enforce — plus the render-only `WebNode` and List
shapes and a finite-only runtime constraint that UI keeps for numbers.
VelarScript never calls an object's conversion hooks to invent text or an
attribute value: format an object explicitly before rendering it. Raw HTML is
an explicit string-only boundary, written as `unsafe:html={trustedMarkup}`; it
cannot be combined with children.

Every native attribute uses one visible boundary rule. `false` and `null`
remove it, `true` writes it with an empty value, and a string writes that exact
text. This keeps presence separate from text: `aria-busy={false}` is absent,
while `aria-busy={str(false)}` is the literal token `"false"`. Use `str(value)`
when a bool or number is intended as attribute text. Advisory `A14` recognizes
the exact expanded spelling `flag ? "true" : "false"` on a text-valued native
attribute. It offers the equivalent `str(flag)` edit when the discarded part
contains no comment; comments inside `flag` survive because that source is
copied verbatim. HTML bool-presence attributes and component props are outside
that rewrite.

Use ordinary conditional expressions or functions for conditional children:

```velar fragment
component Panel:
    return <section>
        {loading ? <p aria-busy="true">Loading…</p> : <Results items={items} />}
    </section>
```

Magic JSX `if`, `else-if`, and `else` attributes are not part of the language.

Important native directives include:

- `on:click={handler}` and other typed events; a handler returns `null`
- `class:name={condition}` to add or remove one class name as a `bool` changes
- `bind:value={state}` for supported form controls, and `bind:checked={flag}`
  for a single checkbox
- `bind:group={choice}` on `<input type="radio">`, where the state holds the
  selected input's `value`, and `bind:group={choices}` on
  `<input type="checkbox">`, where `List<string>` state holds the checked values
  and checking or unchecking is a membership change
- `ref={element}` on a native element for an optional element binding
- `ref={handle}` on a component that explicitly declares `exposes`
- `look={visual}`
- `class={nameOrList}`
- stable `key` values for dynamic children

A `bind:` target is a writable reactive location: a state name, or a field or
index path rooted in one, such as `bind:value={form.name}` or
`bind:value={items[0]}`. A computed value, a `const`, and a function result are
rejected — nothing would receive the write.

Refs require mutable optional `let` bindings and are restored to `null` during
cleanup. A component Handle is shallow-frozen, remains stable for its component
instance, and revokes callable fields when that instance is destroyed. A stale
saved alias therefore fails rather than operating on destroyed state or DOM.
Use `class`, `look`, and `look:*` for host styling; use explicit Look props for
internal parts rather than exposing DOM for style mutation.

A `key` drives identity-preserving reuse only in the keyed-children shape: an
interpolation that is `items.map(item => <Row key={item.id} />)`, or a `?:`
branch of one — so an empty-state ternary around a keyed list keeps the keyed
path. A list rendered with `.map(...)` in that position requires a key on its
root element, and a `key` anywhere else — inside an interpolation or on an
element in a fixed position — is a diagnostic rather than a silently ignored
attribute.

Reuse asks two questions, not one: the key must match, and the item the key
names must still be the same value. Replacing an item with a freshly built
record of the same shape — the `items.map(item => ({...item, done: true}))`
habit — replaces the value, so the row is destroyed and built again, and a
focused input inside it loses focus and an open composition ends. Update the
item in place instead, `items[index].done = true`; the key still names the same
value and the row survives. The habit is reported rather than left silent:
advisory `A4` names the rows a keyed position renders when something rebuilds
them, and gives the alternative that keeps them. It reads the rebuild whether it
is assigned back to the list or derived — a `computed` that builds a fresh
record per source element rebuilds every row on every recompute, and reaches the
keyed position the same way; a derived value owns no row it could write, so
there the alternative is to render the source rows and change the field on
those. It is also the advisory most often right to suppress — a `readonly` list,
or a whole table replaced by one API response, leaves building the rows as the
only spelling — and a `// velar-allow A4: <reason>` on that line is the answer
there.

An event directive may carry modifiers, appended with dots:
`on:click.prevent.stop={submit}`. There are exactly five, and no others are
accepted: `prevent` calls `preventDefault`, `stop` calls `stopPropagation`,
`self` ignores the event unless this element is its target, `capture` listens
during the capture phase, and `once` removes the listener after one dispatch.
They apply in that order — `self` filters first, then `prevent`, then `stop`,
then the handler runs — and a modifier cannot be repeated. `self` is how a
handler asks the question the missing `event.target` would have answered.

A component may return a fragment, `<>...</>`, when its markup has several
roots and no wrapper element belongs in the DOM. A fragment has no attributes
of its own, so a multi-root component must mark exactly one native element with
the valueless `host` directive:

```velar fragment
component Field(label: string, value: string):
    return <>
        <label>{label}</label>
        <input host value={value} />
    </>
```

`host` names the element that receives what an invocation attaches to the
component: `class`, `class:*`, `look`, `look:*`, and `style:*`. A component
whose root is a single native element or another component needs no marker —
that root is the host, and a component root forwards to its own host in turn.
Two `host` markers in one component, a `host` with a value, and a multi-root
component with no marker are each a compile error.

JSX text is normalized the way a reader expects markup to behave: every run of
whitespace inside a text child becomes one space, and whitespace that only
exists because the source wrapped across lines disappears — a text run that
begins at a line break loses its leading whitespace, and one that ends at a
line break loses its trailing whitespace. A space that shares a line with
content survives as one space, so `<b>bold</b> <i>italic</i>` keeps the space
between the words while indented markup adds none. A text child that
normalizes to nothing creates no text node.

`<` begins JSX only where a value can begin. The decision is made from the
preceding token, and the positions are: the start of a module, after a newline,
an indent, or a dedent, after `=`, after `return`, after `=>`, after `(`, `[`,
or `{`, after `,`, `:`, or `?`, and after `??`, `and`, or `or`. Everywhere else
`<` is the less-than operator. The three line boundaries are one position stated
three ways — a statement begins a value, and which of the three precedes its
first token is decided by the indentation of the line rather than by the
program. `and` and `or` are in the list so that the React habit
`{ready and <Panel />}` parses and is answered with the conditional-rendering
spelling — `{ready ? <Panel /> : null}` — rather than a parse cascade; those two
operators still combine bool values only. Outside these positions, wrap the
element in parentheses.

The same positions govern the `look:` and `keyframes:` block openers of section
17, whose words are otherwise ordinary identifiers. One table decides both
constructs, so an author learns the rule once: a block opens only where a value
may begin, and only where the word is followed directly by `:` and an indented
body. Everywhere else the word is read as written. `case Mode.look:` is a match
on an enum member and `if m == Mode.keyframes:` is a comparison because a member
step precedes the word there, and no value begins after one. `record.keyframes`
and `{look: value}` are the member and the key they name by the other half of
the rule: a member read is followed by no `:` at all, and a bracketed value
produces no line boundaries, so a `:` written inside a record literal is never
followed by the indent an opener requires — a record literal spread over several
lines names the same key the one-line form does.

### Children

A JSX tag body reaches a component only through an explicitly declared prop
named `children`, typed `WebNode`. A component written
`component Card(title: string, children: WebNode):` accepts
`<Card title="Hi"><p>inner</p></Card>`; a component that does not declare the
prop reports a diagnostic naming the declaration to add.
`children: WebNode? = null` is the omittable form. A prop becomes omittable
through its default value, never through a `?` alone: `children: WebNode?`
without a default is still required, and the `?` is there so that `null` is a
value the declared type admits. The prop and the tag body are two spellings of
one thing, so supplying both is an error rather than a silent choice between
them.

```velar fragment
component Card(title: string, children: WebNode? = null):
    return <section>
        <h2>{title}</h2>
        {children}
    </section>

component Page:
    return <Card title="Notes"><p>Body</p></Card>
```

`children` needs no mental model of its own. It is ordinary rendered content and
follows the ordinary rules: it re-renders when the reactive state it reads
changes, exactly as any other rendered value does, and `false` means not
rendered — a slot that goes false and then true renders again rather than coming
back empty. Hiding a subtree while preserving its state is not a framework
behavior; write it with `style:display` or a Look.

### Script boundaries in JSX

`<iframe srcdoc={…}>` builds a document out of a string, and that document
inherits the page's origin, so it is a script boundary in the same family as
`unsafe:html`. An `<iframe>` carrying `srcdoc` therefore requires a `sandbox`
attribute; write `sandbox=""` when the framed document needs no capability at
all. `sandbox="allow-scripts allow-same-origin"` lets the framed document remove
its own sandbox, so that pair is refused on a `srcdoc` frame.

The attributes a browser resolves as a URL — `href`, `src`, `action`,
`formaction`, `poster`, `data`, `xlink:href`, `ping`, and `cite` — do not carry
script. A `javascript:` or `vbscript:` value is refused, and a `data:` value is
accepted only for a media type that cannot carry script. `image/svg+xml` is
excluded, because an SVG document runs script. Relative URLs and fragments are
unaffected. The scheme is read the way the user agent reads it, so leading
whitespace and embedded control characters do not hide one. Behavior belongs in
an `on:click` handler, never in a URL.

A value written down in the source is refused while the module compiles; a value
that arrives at run time is refused by the attribute writer. The two do not
refuse the same set, and the attribute writer is the stricter of them. The
compile refuses by name — the two script schemes, and a `data:` URL outside the
inert media types, which are the raster image types, the audio and video types,
the font types, `text/plain`, and `text/css` — so any other scheme is written
down without complaint. The attribute writer admits by name instead: a relative
URL, `http`, `https`, `mailto`, `tel`, and `blob`, and its inert media types
stop at the raster image, audio, and video types, `font/woff`, `font/woff2`, and
`text/plain`. So `href="ftp://example.com/f"` and `href="data:text/css,body{}"`
compile, and the same two strings are refused at the writer when they arrive
through a computed value.

A native element also reserves every attribute name that begins with `on`, other
than the `on:` directive itself. The handler spellings among them — `onclick`,
`onerror`, `onload` — are content attributes the browser compiles as script, so
any string routed there is executable code in the application's origin, which
this language reserves for `unsafe:html`. An HTML attribute name is matched
ASCII-case-insensitively, so `onClick` and `ONCLICK` are that same attribute.
The prefix is closed by name rather than by a roster of event names: the next
handler attribute the platform adds is closed in advance, and so are the React
reflex `onClick=`, which is merely inert, and an ordinary word such as `onward`
that happens to begin with the two letters. Events are written with the `on:`
directive, `on:click={handler}`.

## 15. State, computed values, resources, and actions

```velar fragment
export component Profile(userId: string):
    state expanded = false
    computed label = expanded ? "Hide" : "Show"
    resource profile: User = loadUser(userId)

    action save() -> User:
        return await saveUser(profile.value)

    def toggleExpanded():
        expanded = not expanded

    return <section>
        <button type="button" on:click={toggleExpanded}>{label}</button>
        <button type="button" disabled={save.pending} on:click={save}>Save</button>
    </section>
```

`state` is a writable, lexically scoped reactive cell. It may be declared at
module, component, or ordinary block/function scope. Each function execution
creates a distinct cell and closures capture that cell normally. Assigning the
binding, mutating a `List`, `Set`, or `Map`, and assigning a field anywhere
inside a nested record all publish the
affected reactive reads. State references may be aliased, returned, and passed
through ordinary functions; helpers can mutate the owned value directly.

```velar fragment
tasks.append(task)
tasks[0].done = true

def retitle(task: Task, title: string):
    task.title = title

retitle(tasks[0], "Ready")
```

An initializer is evaluated once. It does not create a formula:

```velar fragment
const currentTask = tasks[0]      // one ordinary reference snapshot
state selectedTask = tasks[0]     // an independent writable cell
computed liveFirstTask = tasks[0] // a live positional query
```

The first two bindings initially refer to the same task object, so deep
mutation of that object remains visible through either reference; neither one
follows a later List insertion at index `0`. Reassigning `selectedTask` changes
only that state cell. `liveFirstTask` is the spelling that follows the current
first position.

State does not copy, freeze, or claim linear ownership of a mutable value.
Hydrated data, rebuilt indexes, and other ordinary values may initialize or be
assigned into state directly:

<!-- velar-preamble
type Model:
    id: string

type Snapshot:
    model: Model

def loadSnapshot() -> Snapshot:
    return {model: {id: "model-1"}}
-->
```velar fragment
const restored = loadSnapshot()
state model = restored.model

def replaceModel(next: Model):
    model = next
```

Assigning the cell publishes the new root immediately. Continue later deep
mutation through the state binding, a reference read from it, or the official
collection operations; an old raw alias mutated outside those paths is not an
observable write. VelarScript intentionally does not pretend to have an
ownership system by rejecting only some aliases or forcing product-layer
copies.

`computed name = expression` is the one spelling that declares a derived value.
It parses where `state` parses, in all three scopes, and it is the read-only
half of the same row: the name is read bare, and assigning it is an error that
names the state to change instead. The expression tracks dynamic reactive
dependencies; its result is evaluated on first access and cached while observed.

There is no second spelling. `computed(...)` and `cached(...)` are both removed
function forms with no compatibility alias, and a Web module that writes either
is answered with the declaration that replaces it (section 19). Where a
*callable* is what a receiver wants, write an ordinary `def` over the derived
value: the call is then visible at the reading site, and the cache is still the
`computed`'s.

An invalidated observed result refreshes during the reactive flush; a synchronous access
before that flush refreshes it immediately and still publishes a changed result
to the other downstream observers. Downstream observers are notified only when
the result changes by identity/value equality. Failure and recovery are also
result-state transitions: a synchronous failure reaches the managed consumer,
and recovery wakes downstream caches even when it produces the same value as
the last successful evaluation. When its last consumer is disposed it detaches
from upstream dependencies. Asynchronous component data belongs in a
`resource`. Record properties and collection keys are tracked
independently, so
changing `task.done` invalidates consumers of that property without
invalidating unrelated `task.title` reads, and changing one `Map` entry does not
invalidate consumers of other keys. There is no separate `memo` API and no
manual batching API; `computed` is the one derived-cache abstraction, while
property-level tracking and synchronous assignment coalescing are framework
contracts owned by the Web API document.

Reactive imports keep the same split as ordinary imports: assigning an imported
binding is forbidden, while mutating the value inside an imported state binding
is legal and publishes to every consumer. Component record and collection props
use their declared type unchanged. By default, assigning through a prop or
calling one of its mutating collection methods follows the same property-,
index-, or key-granular publication path as writing through the source state;
a helper that requires the mutable type can receive that prop directly.

`readonly` on a prop is the component author's explicit owner-seam contract,
not a Web-only projection. It uses the same transitive Core view as ordinary
functions and module interfaces: a helper that receives it must accept the
readonly type, deep writes and mutating collection methods are rejected, and no
copy, proxy, or freeze is introduced. The Core pure-data boundary is unchanged,
so classes and other behavioral values remain outside explicit `readonly`,
whether they appear at the root or are buried inside its data. Keeping product
store writes behind callbacks or store actions is an idiom that makes business
rules easy to audit; the type system enforces that direction only where the
component author opts in with `readonly`.

A resource exposes `value`, `loading`, `ready`, `error`, and `reload`. It owns
stale-result and component-destruction handling. Its Promise and Object host
operations are captured when the generated Web module initializes, so later
ambient replacement cannot redirect a load or make its managed start escape
synchronously.

A resource loads exactly when its component mounts, and it is not a formula
over its inputs. The initializer is a load, not a dependency: when a prop or
state the initializer reads changes, **the resource does not reload**. The
existing value stays on screen and `loading` never turns back on. Reloading is
an explicit call — `reload()` re-evaluates the initializer against the inputs it
reads *now* and answers a Promise of `null` — so "refetch when the input
changes" is spelled by saying so:

```velar fragment
export component Profile(userId: string):
    resource profile: User = loadUser(userId)

    watch userId:
        detach profile.reload()

    return <p>{profile.value?.name ?? "Loading…"}</p>
```

A watch body is synchronous, so the reload is started with a `detach`
statement rather than awaited; its failure still reports through the resource's
own `error` field and the Web error chain.

Each load supersedes the one before it: a result that arrives after a newer
reload started is discarded, and so is one that arrives after the component is
destroyed. A failed load keeps the last successful `value` — a reload that fails
does not blank the screen — and publishes the failure in `error` while `ready`
becomes `true` and `loading` becomes `false`. The same failure is reported
through the Web error chain under phase `resource` with the resource's declared
name as its detail. A successful reload clears `error` at the moment it starts.

An action is an async UI operation with reactive `pending` and `error` fields.
It reports the failure through the Web error chain and still rejects its call;
errors are never silently converted into successful `null` results. Use
`try`/`catch` when the caller owns recovery. Like module `state`, an
`action` may also be declared at module scope, so a shared store owns an
operation together with its `pending`/`error` surface; a module action lives
for the life of the module and is never disposed. A `resource` remains
component-owned because its stale-result handling is tied to component
destruction. Component actions use the same initialization-owned async host;
after destruction, a call rejects with an owned `Error` instead of starting
application work.

Actions do not serialize their calls. A second click starts a second run while
the first is still in flight — there is no implicit queue, drop, or debounce —
so `pending` means *some* call is active and turns `false` only when the last
one settles. `error` belongs to the newest call: it clears when a call starts
and is written only by that generation, while an older failure that a newer call
superseded is still reported through the error chain exactly once. When
overlapping runs are wrong for the operation, guard it in the application —
`if not save.pending:` — or disable the control with `disabled={save.pending}`.

`computed` accepts a synchronous function, but "synchronous" is the only
requirement: a `computed` callback may write state, and the write publishes
normally. The compiler does not enforce purity, and a derived value that also
mutates is legal — which is why the self-invalidation budget exists. A `computed`
that invalidates itself is stopped and reported after 100 rounds rather than
freezing the page. Keep derivations pure anyway; a `computed` that writes is a
side effect hiding in a cache, and `watch` is the spelling that says so.

Reading a reactive source into an ordinary `const` freezes the value that was
read. That is what `const` means, and a snapshot — the locale the reader opened
the page in, the timestamp a session began — is a legitimate thing to want. It
is also the quietest way to put stale text on a page, because the frozen and the
following spellings read identically until the source first changes. A
development build carries a runtime detector for exactly that: reactive sources
read during component setup outside any observer are recorded, and a report is
made **when one of them later changes** — never when it is read. A snapshot that
never diverges is never reported, because nothing was ever wrong with it. The
report names the value it froze at, the value the source now holds, the `.vel`
line it was read on, and `computed name = expression` as the spelling that
follows. A production build contains none of this.

`watch subject:` runs an explicit side effect when the tracked value changes,
and `watch subject as current, previous:` names the new and old values. Both
names are required when `as` is present, so a body that needs only the new value
writes `as current, _`. The subject is evaluated immediately to establish the
dependency and the baseline value; the body does **not** run for that first
value, only for later changes. A watch body is synchronous. Async component work
belongs in an `action`; lifecycle setup that must wait belongs in `@mounted`.
For a deep mutation, `current` and `previous` are the same reference; a watch
does not manufacture an unbounded deep snapshot. Inspect the fields needed by
the side effect, or store an explicit snapshot when the application requires
one. A component watch is disposed with its component. A module-scope watch is
never disposed — it lives for the life of the page, like a module `action` — so
a module watch is for application-wide facts, not for anything a component
owns.

A watch may write state, and it needs no declaration to do so. Within one
flush, watches run in the order they were written: two watches in one module
run in source order, two live instances of one component run in mount order,
and watches in two modules run in module initialization order. Two watches
that write one `state` are not an error — both take effect, in that order.

This is the intuition every ordinary language already gives you: whoever is
defined first runs first. A watch that assigns where an earlier one
accumulated overwrites it, and that is the author's own mistake to see and
fix, not something the compiler guesses at on their behalf. There is no
priority spelling and no contention diagnostic. What a watch's position in the
source decides is when it runs, and it decides that completely.

Derived values are unaffected by any of this. A `computed` settles to a fixed
point before a single DOM node is written and never depends on the order
watches run in — which is why a value that must be correct before anything
reads it belongs in a `computed`, not in a watch that writes state.

Watches settle before that same DOM commit, and this is the one consequence of
it worth stating outright: **a watch body reads the layout the page had before
its own change.** That is what makes the commit glitch-free — a corrective watch
cannot push an invalid value through the DOM first — and it means a geometry
read inside a watch answers the previous frame. Nothing reports it, because
nothing is wrong; the numbers are simply the ones the browser has laid out. A
watch body is synchronous, so a read that must see the new layout belongs in a
detached `detach` statement that awaits `frame()` first. `tick()` answers once
the flush has settled and the DOM is written; `frame()` answers after the paint,
which is when geometry exists to be read. There is no `flush: "post"` option:
the two waits already name the two moments, and a third spelling would only
make it possible to ask for the wrong one.

## 16. Lifecycle

Lifecycle is component-owned and deliberately small:

```velar fragment
export component CanvasPanel:
    let canvas: CanvasElement? = null

    @mounted:
        if canvas != null:
            startCanvas(canvas)

    @cleanup:
        stopCanvas()

    return <canvas ref={canvas}></canvas>
```

`@mounted` and `@cleanup` are sibling blocks. Cleanup is not nested inside
`@mounted` and is not returned from an effect callback. The Web runtime owns their
ordering and disposes watches, resources, actions, events, refs, and DOM work
with the component.

There is no public React-style `effect` API.

Two entry points belong to the application rather than to a component, and both
are reserved Web names that a local binding cannot shadow:

`mount(node, target)` attaches one root to the document and returns `null`. The
target is a CSS selector string or an element. The root is constructed
synchronously so the runtime can own its failure as one transaction — a direct
`await` inside the argument is rejected, so module-level preload work is awaited
into a binding first. Failure never leaves a blank page: a setup throw, a
dynamic region that throws while it is first built, a missing target, and a root
written into a module binding — `const root = <App />` — whose construction
throws all report through `velar/app` and render an accessible fatal state
instead. A module-level root that fails to construct does not stop module
evaluation, so `@main` still runs and the failure surfaces at the mount that
takes that root. One component instance mounts exactly once; a repeated mount
fails explicitly rather than moving DOM silently.

`tick()` answers `Promise<null>` that resolves after the pending reactive flush
has settled, which is how a test observes the DOM that a state write produces.
It drains the queue to quiescence rather than skipping one microtask: it runs the
pending flush and yields, and repeats that until no derived value, watch, or DOM
update is left to run, so work an observer queued asynchronously is picked up
too. It is also the point where an unowned failure surfaces: if the flush
reported a failure that no handler claimed, `tick()` rejects with it, so awaiting
`tick()` cannot step over a broken update.

## 17. Look: controlled visual language

Look is VelarScript's checked visual language. It uses real DOM-style CSS
property names, VelarScript expressions, typed unit values, composition, conditions,
element states, and explicit pseudo-element targets.

A `look:` or `keyframes:` block is a value, so it is written where a value is
written: after `=`, after `return`, or inside a call, a collection, or a record.
Section 14 lists those positions in full, and they are the same ones that decide
whether `<` opens an element — one table, two constructs. Everywhere else `look`
and `keyframes` are ordinary names, so `case Mode.look:` matches an enum member
and `record.keyframes` reads a field.

```velar
import {alpha, border, rgb, spacing} from "velar/look"

const colors = {
    text: rgb(24, 31, 46),
    surface: rgb(248, 250, 255),
    active: rgb(228, 235, 255),
}

export const cardLook = look:
    display = "grid"
    gap = 12px
    padding = spacing(16px, 20px)
    border = border(1px, alpha(colors.text, 0.12))
    borderRadius = 14px
    color = colors.text
    background = colors.surface

    if @hover:
        background = colors.active

    if viewport.width <= 720px:
        padding = 14px

    @before:
        content = ""
        display = "block"
```

### Property names

Properties use the real DOM camelCase spelling: `backgroundColor`,
`borderRadius`, `gridTemplateColumns`, `boxShadow`, `textTransform`, and so on.
Aliases such as `radius`, `columns`, `shadow`, and `textCase` are not accepted.

CSS keyword values are strings because bare identifiers are real VelarScript
variables:

```velar fragment
display = "grid"
marginInline = "auto"
justifyContent = "space-between"
cursor = "pointer"
```

This makes variable resolution unambiguous and lets the compiler report an
undefined color or spacing token instead of guessing that it was a CSS word.

A property that takes CSS keywords carries its own closed set, and a property
that takes lengths carries both — `backgroundSize` accepts a unit value and
`"cover"` and `"contain"`, and the position properties accept a unit value and
the placement words. The two transition longhands take the vocabularies the
matching builders take: `transitionProperty` names an animatable Look property
in its CSS spelling (or `all`, or `none`), and `transitionTimingFunction` takes
one of the same seven easings `animate(...)` accepts. `transition(property, …)`
reads exactly the set `transitionProperty` reads, so a camelCase spelling is
refused there with the CSS spelling it meant. A published property whose
only writable value is its own default would be a name no author can reach,
which section 17's appendix treats as worse than not publishing it.

### Builders

Look builders are named imports from `velar/look`, and they are not magic names
that appear only inside a `look:` block. A builder may be aliased
(`const make = rgb`), passed to another function, returned, and called outside
Look like any other VelarScript value. The same module exports the visual Type
objects, such as `Length` and `Color`.

The module provides a small checked builder set:

- design tokens: `token`
- colors: `color`, `rgb`, `rgba`, `hsl`, `alpha`, `lighten`, `darken`
- visuals: `border`, `shadow`, `linearGradient`, `asset`
- layout: `minmax`, `repeat`, `tracks`, `spacing`, `min`, `max`, `clamp`
- motion: `transition`, `animate`

Named arguments work normally:

```velar
import {rgba, shadow} from "velar/look"

const raised = shadow(0px, 12px, 32px, rgba(0, 0, 0, 0.16), spread=0px, inset=false)
```

Builder inputs are checked visual values, not JavaScript coercion points.
Layout builders accept bounded strings, typed lengths, percentages, track
fractions, and their declared track values. A bare number is accepted only
where CSS itself has no unit: a repeat count, and the unitless properties
listed under *Unit values and calculations*. In a length position `0` is the
one unitless value; every other bare number is rejected with the unit it needs,
because `padding: 16` is a declaration the browser discards. Functions,
records, classes, non-finite numbers, and objects with conversion hooks never
become CSS text. A dynamic property value of `null` removes that controlled
value instead of emitting the text `"null"`.

Numeric domains are checked where the argument is written. A positional argument
outside a builder's range — a colour channel above 255, an opacity above 1, a
division by zero — is a compile error rather than a first-paint failure whenever
its value is known while the module compiles: a literal, a `const` design token,
a field of a const token record, and arithmetic over any of those are all read
to their value first. An argument that is genuinely unknown until run time keeps
the same check at run time. That distinction matters most inside a `keyframes:`
stop and anywhere else a Look value becomes stylesheet text rather than a
runtime value, because there the call is lowered away and no runtime guard
survives to run — so an argument that cannot be resolved at compile time cannot
appear there at all.

The range table is read by position, and `animate` is the only builder that
resolves its options by name, so a named argument carries no position for the
table to read: `rgba(0, 0, 0, 2)` is a compile error, and the same out-of-range
opacity written `alpha=2` is proved at run time instead, like a genuinely
unknown one. A `keyframes:` stop is unaffected, because a named argument does
not resolve to static CSS and the stop refuses it on that ground first. Write a
builder argument positionally where its range is what the value has to satisfy.

### Design token references

A design system's contract is a set of CSS custom properties, and `token()` is
the checked spelling that reads one. It is legal in **every** Look property —
metrics, colours, shadows, transitions, fonts, and the free-text properties
alike — and in a `keyframes:` stop, because a design token is a value, not a
value kind:

```velar
import {token} from "velar/look"

export const shellChrome = look:
    width = token("--shell-sidebar-expanded-width")
    borderRadius = token("--ui-radius-panel")
    boxShadow = token("--shell-sidebar-shadow")
    transition = token("--ui-transition-fast")
    color = token("--ui-color-foreground")
    fontFamily = token("--ui-font-family")
```

The argument is a literal string holding a CSS custom property identifier: `--`
followed by letters, digits, hyphens, or underscores. A computed name, an
interpolation, a binding, or a name without its leading `--` is refused where it
is written. The call lowers to `var(--name)` while the module compiles, so no
call survives into the emitted module.

What is checked is the **reference** — its spelling and its position. The value
behind the name belongs to the design system: no token stylesheet is an input to
this compile, and a theme that swaps values under the same names is the whole
point of the contract. A token that is missing is a defect where the token is
defined. That is also why there is no fallback argument: a fallback would be a
per-site decision standing in for a system-level defect, and the one part of the
reference nothing could check.

The one property `token()` does not reach is `animation`, whose value names a
`@keyframes` rule rather than describing one. Look generates those names from
the `keyframes:` value that defines the motion, so a shorthand arriving from
outside the compile names a rule the compile never emitted; write the motion
with `keyframes:` and `animate(...)`, or take a design system's own animation
through `import css unsafe`.

There is exactly one spelling. A literal `var(--name)` string is refused
wherever the value is checked — including `color("var(--name)")`, which used to
pass it through as text nothing read — and `velar fix` rewrites that form
mechanically, carrying the `token` import when the module has none. The
free-text properties still accept free text, because a `var()` inside a larger
value is real CSS with no single token to stand for it: `fontFamily =
"var(--ui-font-family), system-ui, sans-serif"` is a font stack, not a token
reference. A free-text value that is *nothing but* one reference receives
advisory `A12` and its rewrite.

### Unit values and calculations

Unit suffixes belong to the language and need no import. `px`, `rem`, `em`,
`vw`, `vh`, `vmin`, and `vmax` produce `Length`; `%` produces `Percentage`;
`fr` produces `TrackFraction`; `ms` and `s` produce `Duration`; `deg` and
`turn` produce `Angle`. They are ordinary reusable values outside Look:

```velar
const gutter: Length = 16px
const content: Percentage = 75%
const fluid: LengthPercentage = content - gutter * 2
const wide: Length = 25vw + 2rem
const settle: Duration = 1s + 200ms
const rotation: Angle = 0.5turn + 90deg
```

Addition and subtraction require the same visual dimension; mixing Length and
Percentage yields `LengthPercentage`. A visual value may be multiplied or
divided by a finite number, and a number may multiply a visual value. Compatible
same-unit expressions fold to one value; mixed length units and
length-percentage expressions lower to CSS `calc(...)`. Unit-by-unit
multiplication, division by a unit value, division by zero, color arithmetic,
and arithmetic on composite values such as `Spacing` are rejected.

A Look property that names a CSS length requires a unit. The properties whose
CSS grammar is unitless keep plain numbers: `lineHeight`, `opacity`, `zIndex`,
`fontWeight`, `flex`, `flexGrow`, `flexShrink`, `order`, `scale`, and
`aspectRatio`.

`viewport`, `scheme`, and `motion` name the Look media subjects and are reserved
bindings in a Web module, so a local binding can never shadow a media condition.

### JSX Look directives

Simple one-off base properties may be written as JSX directives. They use the
same camelCase property names and property types as a full Look:

```velar
import {rgb, spacing} from "velar/look"

const paper = rgb(251, 250, 247)
const primary = rgb(45, 79, 190)

const controlLook = look:
    display = "inline-flex"
    color = paper

export component Example:
    return <div>
        <div
            look:display="grid"
            look:gap={12px}
            look:padding={spacing(16px, 20px)}
            look:borderRadius={14px}
        >Content</div>
        <button
            look={controlLook}
            look:color={paper}
            look:background={primary}
        >Save</button>
    </div>
```

`look={value}` composes an existing Look. All `look:property` directives on the
same element form one anonymous base Look applied after that composed value, so
the directives override it regardless of attribute order. Duplicate directives
are errors and `null` removes the corresponding property. Conditions, `@` state
hooks, media queries, pseudo-elements, spreads, and other structural Look
features remain in an extracted `look:` value; directive names never encode a
second copy of that language.

### Inline Style compatibility

VelarScript also accepts checked property-level inline Style when an existing
Web integration requires native inline priority:

```velar
import {rgb} from "velar/look"

const text = rgb(35, 39, 47)
const cardLook = look:
    borderRadius = 12px

export component StyleCompatibility:
    return <div
        look={cardLook}
        style:color={text}
        style:padding={12px}
        style:display="grid"
    >Content</div>
```

`style:property` uses the same camelCase property table, visual value types,
builders, finite-number checks, and reactive reads as Look, but lowers to the
element's native inline style declaration rather than to a Look selector and
CSS variable. It is therefore a compatibility override, not a second reusable
visual language. Raw `style="..."`, Style objects, `style:hover:color`, media
conditions, pseudo-elements, spreads, and Style values are not supported.
Prefer `look:property` or a reusable Look unless native inline priority is the
explicit requirement.

All `style:property` directives on a component invocation attach to its host
element after the component's own inline Style. Duplicate directives are
errors. A `null` value removes the inline declaration, allowing Look and
stylesheet rules to participate in the cascade again. A non-null inline Style
declaration overrides normal Look rules and normal class stylesheet rules for
the same CSS property, including Look state rules; an external `!important`
declaration can still override a non-important inline declaration.

Look and class alone have no universal winner. An unconditional Look selector is
one attribute selector, so it and a simple class selector both have specificity
`(0,1,0)` and source order decides: CSS imported `before look` loses an
equal-specificity conflict to Look, while CSS imported `after look` wins it. A
conditional Look selector repeats `[data-velar-look]`, so it is more specific
than one simple class. Compound selectors, IDs, pseudo-elements, and
`!important` can change that result through the ordinary CSS cascade.

### Which Look rule wins

Two Look rules that set the same property on the same surface are separated by
the conditions they name; the order the modules happened to be concatenated in
decides only where the conditions cannot. A rule's rank is the kind of condition
it carries — no condition, then a media condition, then an element state, then
both — and within one rank a rule that names more conditions outranks one that
names fewer. The
generated selector encodes that rank by repeating `[data-velar-look]` once per
rank step, so the ordering is ordinary CSS specificity and an external
stylesheet can still reason about it. The span within a rank is bounded, so a
pathological condition count cannot cross a rank boundary: past three conditions
the encoding saturates, and rules that saturate it — like rules that share a
rank and a condition count — are emitted in the order they were declared. Where
declaration order is what is left to decide, it is the order the project's
stylesheet concatenates, so two such rules in different modules are ordered by
their modules' paths under *Stable output and external overrides* below. Nothing
in this ordering depends on the build machine's collation.

### Composition

Look values are ordinary exportable values and may be composed once at their
outer level:

```velar
import {rgb, spacing} from "velar/look"

export const controlLook = look:
    padding = spacing(10px, 14px)
    borderRadius = 10px

export const primaryControlLook = look:
    ...controlLook
    color = rgb(255, 255, 255)
    background = rgb(45, 79, 190)
```

Later declarations in the composed result follow normal CSS cascade order.
Duplicate properties in the same Look scope are reported instead of hidden, and
the scope is decided by the condition a rule lowers to rather than by the way it
is written. `if scheme.dark:` and `if not scheme.light:` are one scope, because
the two schemes are complementary; so are `if motion.reduced:`'s else branch and
`if not motion.reduced:`, and so are a viewport comparison and the negation of
its opposite — `viewport.width <= 720px` and `not (viewport.width > 720px)`
lower to one condition, one media query, and one rule.

Composition decides one property at a time, and the condition a declaration is
written under is part of the declaration. A later unconditional declaration
replaces the property outright: every earlier declaration of it disappears,
whatever condition it was written under, so a caller that writes
`padding = 40px` reaches a padding the component set behind its own private
breakpoint. A later conditional declaration refines rather than replaces — it
wins the property under its own condition and leaves every other condition
standing, the earlier unconditional value included — so a caller that writes
only `if @hover: color` changes the hovered colour and keeps the resting colour
it never mentioned. A property is owned per surface: `@before: content` and a
bare `content` are two surfaces, and neither overrides the other.

`...spread` inside a look block, a `look:property` directive on an element, and
a `look` written on a component invocation are each a later source, and each
owns the properties it names by that rule. Declarations written inside one look
block are one source, so that block's own conditional declarations coexist and
the cascade decides between them.

Composition crosses a component boundary in one direction. A `look` written on
a component invocation composes *after* the look the component applies to its
own host. That is what makes a component's visual defaults overridable without
the component declaring a prop for each one; a component that must not be
restyled that way keeps the look on an inner element instead of its host.

Two independent looks placed side by side on one element —
`look={[themeLook, badgeLook]}` — state no order between them, so a property
both of them set has no answer the source gives. That shape is a compile error
naming both looks and the property. Write one Look that starts with
`...themeLook` and overrides the property from there, then pass that one. A look
that already composes the other is ordered against it and stays legal.

A Look value is an ordinary value with reference identity, so `==` on two Looks
asks whether they are the same value, never whether they describe the same
declarations. Two separately written `look:` literals with identical bodies are
not equal — they do compile to one shared generated rule, but that is output
deduplication, not value equality. Compare the inputs that produced a Look, or
choose between named Looks, rather than comparing Look values.

### Conditions, hooks, and targets

Ordinary conditions use `if`, `else if`, `else`, `and`, `or`, and `not`.
Element-owned states are prefixed with `@`:

`@hover`, `@focus`, `@focusVisible`, `@active`, `@current`, `@disabled`,
`@checked`, `@invalid`, and `@open`.

Media condition subjects lower to CSS media queries instead of runtime checks:
`viewport.width` and `viewport.height` compare against compile-time `px`, `rem`,
or `em` values. The threshold may be a local or imported `const` unit token,
including a field of a const token record. Dynamic function results are rejected
because media rules must be extracted before the program runs. The
color-scheme subjects `scheme.dark` and `scheme.light` lower to
`prefers-color-scheme`. The two schemes are complementary, so `not scheme.dark`
is the same condition as `scheme.light`. The accessibility subject
`motion.reduced` lowers to `prefers-reduced-motion`, and its negation is the
`no-preference` side of the same query. That set — `viewport.width`,
`viewport.height`, `scheme.dark`, `scheme.light`, `motion.reduced` — is the
whole media vocabulary; container queries, print, and orientation have no Look
spelling. Media subjects compose with element states and each other:

```velar
import {rgb} from "velar/look"

const compact = 720px

const panelLook = look:
    background = rgb(255, 255, 255)

    if scheme.dark:
        background = rgb(29, 32, 41)

    if scheme.dark and viewport.width <= compact:
        padding = 12px
```

Pseudo-element targets also use `@` but own a block:

`@before`, `@after`, `@backdrop`, `@placeholder`, `@selection`, `@marker`, and
`@fileSelectorButton`.

Targets cannot be nested. Conditions may appear inside a target, and a target
may appear inside a condition — both directions are legal and mean what they
read as — but a target cannot appear inside another target.

```velar fragment
const badgeLook = look:
    @before:
        content = "•"

        if @hover:
            content = "▸"

    if viewport.width <= 720px:
        @after:
            content = ""
```

`content` is text, and Look writes it as text: a string value is emitted as a
CSS string, so `content = "•"` produces `content: "•"` and needs no quoting of
its own. The two bare keywords `none` and `normal` pass through unquoted. Every
other CSS `content` form — `attr(...)`, `counter(...)`, `url(...)`,
`open-quote` — is therefore outside checked Look: written as a string it becomes
literal text, and generated-content counters have no Look spelling at all.
Reach those through a module-level `import css unsafe`.

A CSS string is not a JSON string. The two agree on `"` and `\` and on nothing
else: CSS reads a backslash followed by a non-hex digit as that literal
character, so a JSON `\n` would render the letter `n` and lose the line break.
Every code point below `U+0020`, and `U+007F`, is written as a backslash, its
hexadecimal digits, and one terminating space — the space belongs to the escape,
or a following hex digit would join it. Every other code point, `•` and an emoji
alike, is literal text in the UTF-8 stylesheet, so a newline inside a `content`
value survives as a newline and a path given to `asset` keeps every character
the author wrote.

A `look:` literal is built once, where it is written: its conditions become CSS
selectors and media queries, and its values are read at construction. A
condition or value inside a literal therefore cannot read reactive state — the
read would be a snapshot that never updates, so it is rejected. Reactive visuals
live on the element, where the whole attribute is re-read on change:
`look={active ? activeLook : baseLook}` chooses a Look, and
`look:color={active ? hot : cold}` sets one property. Element states, media
subjects, and their combinations remain live in a literal because they are CSS
conditions rather than program values.

Motion has two checked spellings and no third. `transition` describes a state
change. Keyframe motion is a module-level `keyframes:` value passed to
`animate(...)`, which the `animation` property accepts; the CSS `@keyframes`
at-rule and the animation longhands are not Look spellings, and a raw CSS
animation string is rejected. The appendix to this section defines both.

### Stable output and external overrides

Look does not generate random CSS Module class names. It emits readable tokens
such as `base:background` and `hover:background` on `data-velar-look`, with a
readable `--velar-look-*` custom property behind each token. The custom property
carries the value whether or not the value is constant, so an element that
applies a Look with eight properties carries eight inline custom properties; the
generated stylesheet holds the selector and the `var()` indirection, not the
value. Developers can also provide their own stable `class` and `data-*`
attributes as public hooks.

Native CSS is an explicit unsafe boundary:

```velar fragment
import css unsafe "./legacy.css" before look
import css unsafe "./overrides.css" after look
```

`before look` and `after look` specify source order only. They do not assign
semantic priority. Specificity and `!important` remain the external stylesheet
author's responsibility. Global native CSS cannot be declared inside a local
component scope.

Across modules, the project's stylesheet concatenates each module's segments in
module order, and module order is the UTF-16 code-unit order of each module's
project-relative path written with `/` separators — the order a comparator-free
sort gives, so the toolchain that writes a build and the verifier that checks it
agree on every name. It is deliberately not the host's collation: the same
sources must produce the same stylesheet bytes, the same content hash, and the
same `buildId` on every machine, whatever `LANG` or `LC_ALL` that machine has.
Source order inside a module is what `before look` and `after look` name.
Between two Look rules it decides only where the rank encoding leaves them
tied — two rules of one rank naming the same number of conditions, and rules
that saturate the rank span — and across modules that tie is broken by module
order. Every other pair is separated by the conditions the two rules carry.

## 18. Generated JavaScript semantics

VelarScript preserves the JavaScript runtime where it matters:

- Objects and class instances are references.
- Primitive strings, numbers, booleans, and `null` behave as JavaScript values.
- Classes lower to JavaScript classes and prototypes. Instance methods live on
  the prototype: one method object serves every instance, and inspecting an
  instance shows data fields only. Reading a method as a value
  (`const close = session.close`) evaluates the receiver once and binds it at
  the reference site — the same rule collection method values follow
  (section 8).
- `private` lowers to native private members; private methods are native
  private methods.
- Reading a class instance field is a compiler-injected guarded read, not a
  bare property access. A field declared `T` promises a `T`, and JavaScript's
  `undefined` is not one, so the guard raises a host `TypeError` naming the
  field when the read finds `undefined` — a field read before its
  initialization ran, or one an unchecked boundary filled with `undefined` —
  rather than letting `undefined` travel under the declared type and fail
  somewhere unrelated. Private and static field reads carry the same guard;
  `Error.cause` is exempt because a host error legitimately has none. This is
  the one class-member read that is a call, which is also why a field read in a
  hot loop is worth binding to a `const` once.
- Async functions and actions use Promises and the host event loop.
- Map and Set use JavaScript key/value identity.
- Garbage collection belongs to the host JavaScript engine.

The compiler adds checked boundaries, bounded collection helpers, runtime data
validators, optional-chain normalization, readable DOM output, and source maps.
It does not pretend those additions create a different memory model.
An argument handed to JavaScript crosses as its raw identity, so an extern
parameter is read-only by contract: a foreign write into it performs no
VelarScript assignment, and nothing — reactive invalidation, a flow fact, a
`readonly` promise — observes it until the next VelarScript-triggered
invalidation happens for some other reason. A package that produces data
returns it and the VelarScript side assigns the result
([javascript-bridge.md](javascript-bridge.md)).
Compiler-created lexical temporaries use the reserved `__velar...` namespace;
the analyzer and editor refactors reject source bindings in that namespace, so
optional lowering, component setup, and JSX callbacks cannot capture a user's
binding. The explicit `js unsafe` import boundary remains host JavaScript, not
a second form of Velar binding declaration.
Calls and awaited operations whose checked result is `null` normalize their
observable result to `null` after evaluation. Every expression typed as
optional, `null`, or `unknown` translates JavaScript `undefined` to `null` by
its checked type alone. The same rule applies through assignment,
destructuring, objects, collections, members, functions, classes, aliases,
cycles, namespace imports, and dynamic imports. Repeated normalization is
idempotent. Errors and rejection behavior are unchanged; every checked Promise
uses one cross-module normalization identity cache and accepts only actual
Promises at checked JavaScript boundaries, never magic thenables. An `unsafe`
JavaScript import is inside the normalization rule, because it arrives as
`unknown`; what it stays outside of is the Promise guarantee, since awaiting an
unvalidated value is refused rather than normalized (section 12). A
discarded expression result is not wrapped.

## Standard library membership boundary

`velar/*` is a closed vocabulary owned by the language. A module belongs to
that namespace only when it provides universal computation that any program
may need, or a minimal orthogonal capability primitive for interacting with
the outside world. Joining the Standard library therefore carries the same
design burden as adding a language feature: every member expands the public
compatibility surface and the vocabulary that tools and coding agents must
learn.

Domain functionality for one application category — including editor, game,
chart, or similar tooling — never joins the Standard library. It publishes as
an ordinary installable package with a `velar.entry` source entry and is
imported by package name after npm installation. A library's implementation in
portable VelarScript does not grant it a `velar/*` identity.

Membership also means jurisdiction. Every `velar/*` module surface is under
this reference's rules with full force — rules 2 and 3 (section 1) bind an
exported field or function exactly as they bind a keyword — and each surface's
contract is normative in the target reference that owns it:
[web-api.md](web-api.md) for the Web modules,
[standard-library.md](standard-library.md) for the rest. That force has
already retired two members: `velar/realtime.socket`, a second WebSocket
client standing beside `velar/websocket.connect`, and `HttpResponse.ok`, a
field that could only ever be true, because `response()` throws
`HttpResponseError` for any non-2xx status before the value exists.

A capability module states the host's real semantics rather than a comfortable
approximation of them. **A watcher reports only the changes that happen after
it is armed.** If you need to observe a change you are about to make, write
first and then start watching, or query the state on both sides of the write.
Arming is asynchronous on every host the language targets, so a watcher that
promised to catch a change racing its own creation would be promising
something no filesystem delivers.

**A capability fails where it is called, never where it is imported.** A module
that imports `velar/desktop`, `velar/fs`, or `velar/storage` loads in a host
that cannot provide them; the error arrives from the call that needed the host.
Failing at import would punish code that never called the capability, and
putting pure logic in the same module as the capability it supports is ordinary
practice — so a `velar test` that has no host still runs the pure functions in
such a module, and the language never makes testability a reason to split a
file. The host binding is still captured while the module initializes, so
nothing installed afterwards can substitute one; only the report of its absence
waits for the call.

## 19. Deliberately absent source features

The following are not part of VelarScript:

- `var`, `undefined`, `none`, or `None`
- coercive equality
- single-quoted or triple-quoted strings; the delimiters are `"` and `` ` ``
- `${...}` interpolation, and `Infinity` or `NaN` as literals
- equality chains (`a == b == c`) and mixed-direction comparison chains
- expression statements that only compute a value
- `switch`
- `new`
- `this` in VelarScript class methods
- JavaScript `delete`, `typeof`, `instanceof`, `eval`, regular-expression
  literals, or increment/decrement operators
- direct JavaScript private identifiers such as `#field`; use the `private`
  class modifier and ordinary `self.field` access
- source-level `prototype` or `__proto__` manipulation
- class-header constructor fields
- `init:` constructor blocks
- class setters. A `get` property reads; there is no `set` counterpart, because
  a setter makes an assignment run code that the assignment does not show.
  Assign the field, or call a method (`def setSize(value: number)`) that names
  the work it does
- extending an `extern` class. Construction would have to chain across the
  JavaScript bridge, and the base class is a contract the compiler cannot see
  the body of. Hold the instance in a field and expose the behavior you need —
  composition. `extends Error` is unaffected; `Error` is a builtin, not an
  extern declaration
- optional-field syntax. `let name?: T` marks the *field* optional in
  TypeScript; VelarScript puts the question in the type, where the readers of
  every other declaration already look: `let name: T? = null`. A named
  parameter *inside a function type* does take `name?: T` (section 5), because
  there the question is arity rather than nullability — a declaration answers
  that one with a default value instead
- TypeScript-style interfaces, assertions, overloads, or type programming
- inference that runs backwards. A declaration takes its type from its own
  position — annotation, contextual type, or initializer — and never from a
  statement below it. `const tags = Set()` is therefore an error rather than an
  element type a later `tags.add("web")` fills in (section 8): a reader would
  have to scan forward to learn what the line declares, and a use before that
  mutation would see `unknown`
- generators, `yield`, or the JavaScript `Symbol.asyncIterator` protocol;
  incremental sources use checked `async for` pull contracts or producer
  callbacks, and JavaScript `for await` is guided to `async for`. A class that
  declares `@iterate:` (section 10) does not reopen this in either of its forms:
  the synchronous form names a collection the language already iterates, and the
  asynchronous form is a block the loop calls for one element at a time. Neither
  is an object a consumer may hold, resume, or hand on, so no iteration protocol
  enters the language
- JavaScript `splice`, `push`, `shift`, `unshift`, mutating `sort`, or mutating
  `reverse`
- user-defined decorators or user-defined annotations. Context markers do
  not reopen them: they are the closed compiler-owned vocabulary defined in
  section 3, never library functions, runtime wrappers, or author-defined
  metadata. Declaration modifiers
  remain the closed keywords `export`, `abstract`, `override`, `static`,
  `private`, `readonly`, and `async`. A library that could change what a
  declaration means would put the reader back to reading the library before
  reading the code; the same reason forbids user-defined type-parameter bounds.
  A new compiler-owned role uses a context marker; a new declaration
  attribute uses a modifier keyword. Neither is a user extension point
- magical JSX control-flow attributes
- a second spelling of a derived value. `cached(() => value)` and
  `computed(() => value)` are removed; `computed name = expression` is the
  declaration, and it already caches its result while observed (section 15), so
  the function form carried no capability of its own — only a second way to read
  the same cache. It also cost the compiler its sight: a reader typed `() -> T`
  is indistinguishable from any other zero-argument function, so nothing marked
  the value as derived, and a `watch` over one watched a function identity that
  never moved. Where a callable really has to be handed on, declare the value
  and write an ordinary `def` that reads it
- a public `effect` primitive
- implicit global CSS
- random class or variable names
- automatic compatibility aliases for removed spellings

The source grammar is an allowlist: a syntax addition to JavaScript never
becomes VelarScript syntax without an explicit language decision, AST node,
analysis rule, lowering, and proof test. JavaScript reserved words cannot be
used as binding names because generated modules must remain valid JavaScript;
`enum` is reserved for exactly that reason, and so is `case`, which JavaScript
reserves and section 3 therefore keeps out of the three positions that bind;
`type`, `match`, `from`, `as`, and `json` — which JavaScript does not reserve —
are contextual keywords and stay available as names (section 3). Spellings such
as `delete`, `default`, and `arguments` remain valid as ordinary record keys and
class member names, so external data and Web APIs do not need renamed fields.
Execution-capability and
object-model spellings such as `eval`, `prototype`, and `__proto__` stay
unavailable through direct member syntax; controlled records may still carry
those strings as data keys.

When a removed spelling is common enough to be a likely mistake, the compiler
reports the direct current spelling. It does not keep the old behavior alive.

## Appendix to section 17: published Web visual vocabulary

This appendix is the current checked Web contract. Look admits a CSS property
only when it is standard, not obsolete, and its value model can be described
honestly by a Look type family. The compiler owns the table below: every one of
the 225 names has an explicit value kind; there is no fallback to an unchecked
string type.

| Family | Look properties |
| --- | --- |
| Layout and containment | `display`, `position`, `boxSizing`, `isolation`, `contain`, `visibility`, `zIndex`, `overflow`, `overflowX`, `overflowY`, `resize`, `clip`, `clipPath`, `objectFit`, `objectPosition`, `aspectRatio` |
| Grid | `gridTemplateColumns`, `gridTemplateRows`, `gridTemplateAreas`, `gridAutoColumns`, `gridAutoRows`, `gridAutoFlow`, `gridColumn`, `gridColumnStart`, `gridColumnEnd`, `gridRow`, `gridRowStart`, `gridRowEnd`, `gridArea` |
| Flex and alignment | `flex`, `flexDirection`, `flexGrow`, `flexShrink`, `flexBasis`, `flexWrap`, `order`, `gap`, `rowGap`, `columnGap`, `alignItems`, `justifyItems`, `justifyContent`, `alignContent`, `alignSelf`, `justifySelf`, `placeItems`, `placeContent`, `placeSelf` |
| Size and inset | `width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `inlineSize`, `blockSize`, `minInlineSize`, `maxInlineSize`, `minBlockSize`, `maxBlockSize`, `inset`, `top`, `right`, `bottom`, `left`, `insetInline`, `insetBlock`, `insetInlineStart`, `insetInlineEnd`, `insetBlockStart`, `insetBlockEnd` |
| Spacing | `padding`, `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`, `paddingInline`, `paddingBlock`, `paddingInlineStart`, `paddingInlineEnd`, `paddingBlockStart`, `paddingBlockEnd`, `margin`, `marginTop`, `marginRight`, `marginBottom`, `marginLeft`, `marginInline`, `marginBlock`, `marginInlineStart`, `marginInlineEnd`, `marginBlockStart`, `marginBlockEnd` |
| Background | `background`, `backgroundColor`, `backgroundImage`, `backgroundPosition`, `backgroundSize`, `backgroundRepeat`, `backgroundAttachment`, `backgroundClip`, `backgroundOrigin`, `backgroundBlendMode` |
| Border and outline | `border`, `borderWidth`, `borderStyle`, `borderColor`, `borderTop`, `borderRight`, `borderBottom`, `borderLeft`, `borderTopWidth`, `borderRightWidth`, `borderBottomWidth`, `borderLeftWidth`, `borderTopStyle`, `borderRightStyle`, `borderBottomStyle`, `borderLeftStyle`, `borderTopColor`, `borderRightColor`, `borderBottomColor`, `borderLeftColor`, `borderRadius`, `borderTopLeftRadius`, `borderTopRightRadius`, `borderBottomRightRadius`, `borderBottomLeftRadius`, `outline`, `outlineWidth`, `outlineStyle`, `outlineColor`, `outlineOffset` |
| Effects | `boxShadow`, `textShadow`, `opacity`, `filter`, `backdropFilter`, `content` |
| Typography and international text | `color`, `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `fontStretch`, `fontVariant`, `fontKerning`, `fontOpticalSizing`, `fontFeatureSettings`, `fontVariationSettings`, `lineHeight`, `verticalAlign`, `letterSpacing`, `wordSpacing`, `textAlign`, `textIndent`, `textDecoration`, `textDecorationColor`, `textDecorationLine`, `textDecorationStyle`, `textDecorationThickness`, `textUnderlineOffset`, `textUnderlinePosition`, `textTransform`, `textRendering`, `whiteSpace`, `textOverflow`, `textWrap`, `overflowWrap`, `wordBreak`, `hyphens`, `tabSize`, `writingMode`, `textOrientation`, `direction`, `unicodeBidi` |
| Lists | `listStyle`, `listStyleType`, `listStylePosition`, `listStyleImage` |
| SVG paint | `fill`, `stroke`, `strokeWidth`, `strokeLinecap`, `strokeLinejoin`, `strokeDasharray`, `strokeDashoffset` |
| Transform and transition | `translate`, `scale`, `rotate`, `transform`, `transformOrigin`, `transition`, `transitionProperty`, `transitionDuration`, `transitionDelay`, `transitionTimingFunction`, `animation` |
| Interaction and form theme | `cursor`, `pointerEvents`, `userSelect`, `touchAction`, `appearance`, `accentColor`, `caretColor`, `colorScheme` |
| Scroll | `scrollBehavior`, `scrollMargin`, `scrollMarginTop`, `scrollMarginRight`, `scrollMarginBottom`, `scrollMarginLeft`, `scrollPadding`, `scrollPaddingTop`, `scrollPaddingRight`, `scrollPaddingBottom`, `scrollPaddingLeft`, `scrollSnapAlign`, `scrollSnapStop`, `scrollSnapType`, `overscrollBehavior`, `overscrollBehaviorX`, `overscrollBehaviorY`, `scrollbarColor`, `scrollbarWidth` |

Keyword-valued properties accept a closed set of CSS keywords. Metrics use unit
literals and typed builders, colours use `Color`, images use `Image`, tracks
use `Track` or `TrackList`, and motion uses `Transition` or `Animation`.
Consequently, spellings such as `display = "flexx"`, `padding = "big"`,
`padding = "12px"`, `color = "reddish"`, a raw grid-template string, and a
raw gradient string fail while the module compiles. Use `12px`,
`tracks(minmax(...))`, and `linearGradient(...)` respectively. A design system's
CSS custom property is read in every one of these families by `token("--name")`,
which is checked as a reference rather than as a value of the family it appears
in; a raw `var(--name)` string is refused with that spelling named.

A Look entry lowers to its own single-declaration CSS rule, and those rules are
ordered by where each property first appears in the module rather than by the
block that wrote them. So a scope that sets both a shorthand and a longhand the
shorthand writes — `padding` beside `paddingTop`, `border` beside `borderColor`
— has no winner it chose: an unrelated Look elsewhere in the module decides
which of the two survives. That pair is refused, with the shorthand's longhands
named, for the same reason a property written twice in one scope is refused.
The rule holds between the entries of one Look block, between the `look:`
directives of one element, and inside a condition or target, which is the whole
of what one compile can see; a shorthand composed in through a spread is beyond
it, which is the other half of why the `font` shorthand is excluded outright.

The following 37 real CSS properties are deliberately outside checked Look.
Their diagnostics name this boundary and point to module-level
`import css unsafe` as the escape hatch.

| Excluded family | Properties | Reason |
| --- | --- | --- |
| Font shorthand | `font` | Its longhands own it: `fontStyle`, `fontVariant`, `fontWeight`, `fontStretch`, `fontSize`, `lineHeight`, `fontFamily`. A shorthand's value is free text no compile can check, and one that is not a legal shorthand fails at computed-value time and resets all seven — including the ones written beside it. |
| Float layout | `float`, `clear` | Legacy float layout is outside the Grid and Flex model. |
| Table formatting | `tableLayout`, `borderCollapse`, `borderSpacing`, `captionSide`, `emptyCells` | A typed table-layout contract needs evidence before admission. |
| Multi-column layout | `columns`, `columnCount`, `columnWidth`, `columnFill`, `columnRule`, `columnRuleColor`, `columnRuleStyle`, `columnRuleWidth`, `columnSpan` | Its value and fragmentation model is not yet typed. |
| Animation longhands | `animationName`, `animationDuration`, `animationTimingFunction`, `animationDelay`, `animationIterationCount`, `animationDirection`, `animationFillMode`, `animationPlayState`, `animationTimeline`, `animationRangeStart`, `animationRangeEnd` | `keyframes:` plus `animate(...)` owns the checked animation contract. |
| Generated content | `counterIncrement`, `counterReset`, `counterSet`, `quotes` | Counters and quoting are not modeled as checked Look values. |
| Paged fragmentation | `breakAfter`, `breakBefore`, `breakInside`, `orphans`, `widows` | Paged and fragmented media are outside the Web application target. |

### Checked keyframes and animation

A module-level `keyframes:` expression is an ordinary exportable `Keyframes`
value. A stop is `from:`, `to:`, or an integer percentage from `1%` through
`99%`; comma-separated stops share a body. Stops may not repeat and declaration
groups must progress in ascending order. A body contains direct, statically
lowerable Look properties only. It reuses the Look property and value checker —
the same literals, unit values, arithmetic, builder calls with positional or
named arguments, `token("--name")` design system references, and `const` design
tokens declared locally or imported through a checked interface — rejects
non-interpolating properties, and cannot read reactive state. A stop's value is additionally checked as one CSS declaration
value, because a stop becomes real stylesheet text rather than a value the
runtime sets on a custom property: `{`, `}`, `;`, and `@` never appear outside a
string, and parentheses, strings, and comments all close. This is the one place
where the value vocabulary's deliberate acceptance of arbitrary text for the
text, filter, transform, and animation kinds does not carry over — on a Look
property that text reaches the DOM through a custom property and cannot escape,
while a stop is concatenated into a compiler-owned rule. Native CSS remains an
explicit unsafe boundary reached only through `import css unsafe`.

Equal keyframe structures receive one stable generated CSS name and one emitted
rule, including when used through another module's checked interface. The name
is derived from an injective encoding of the structure — its stops, their
offsets, their property names, and their lowered values — so no value can spell
another structure's encoding, and the digest taken over that encoding is wide
enough that two unrelated animations in one application do not collide by
accident. It
is `velar-kf-` followed by lowercase hexadecimal digits; the exact width is
compiler-owned and not a stable interface.

```velar
import {animate} from "velar/look"

export const spin = keyframes:
    from:
        rotate = 0deg
    50%:
        rotate = 0.5turn
    to:
        rotate = 1turn

export const spinningLook = look:
    if not motion.reduced:
        animation = animate(spin, 1s, easing="linear", loop=true)
```

`animate(frames, duration, easing?, delay?, count?, loop?, direction?, fill?)`
returns `Animation`. Duration must be positive, delay cannot be negative,
`count` is a positive integer no greater than 1,000,000, and `count` and `loop`
are mutually exclusive whatever `loop` carries: `loop=true` would replace the
count, and `loop=false` only repeats the default, so writing both states the
number of runs twice. Easing is one of `linear`, `ease`, `ease-in`, `ease-out`,
`ease-in-out`, `step-start`, and `step-end`; direction is `normal`, `reverse`,
`alternate`, or `alternate-reverse`; fill is `none`, `forwards`, `backwards`,
or `both`. Literal options are checked during compilation. Look `animation`
accepts `Animation`, `List<Animation>`, or `null`, never a CSS animation string.
An element binding such as
`look:animation={active ? animate(spin, 1s) : null}` adds and removes the native
animation as reactive state changes.

### Native elements and extension text forms

Web JSX accepts the standard non-obsolete HTML, SVG, and MathML element tables.
An unknown native spelling is a compile error with a nearby suggestion, so
`<dvi>` teaches `<div>`. A custom element is intentionally open only under the
platform convention: its name is lowercase, begins with a letter, and contains
at least one hyphen, as in `<user-card>`. PascalCase names remain component
invocations. The retired hyphenated names reserved by the
[HTML Standard](https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name)
remain rejected.

Compiler extensions may declare that an extension value has a total text form.
The Web extension does so for `Length`, `Percentage`, `TrackFraction`,
`Duration`, and `Angle`, preserving the source unit in both f-strings and
`str(...)`:

```velar
const gap = 16px
const duration = 250ms

print(f"gap: {gap}")
print(str(duration))
```

An extension value without a declared text form remains outside `str` and
f-string interpolation. `print(value)` is the inspection exit; structured data
text uses `Json.stringify`.

## Core permanent namespaces and durations

Two rules decide this whole surface. **Purity decides whether a module *may*
be permanent; universality decides whether it *should* be.** Anything that
reaches outside the program must be imported, and a module that computes but
that only some programs reach for keeps its import line, because every
permanent name is a name every reader is assumed to know without being told.
An `import` line is therefore both an audit of what a module touches and a
statement that this program chose a particular toolbox.

A third rule decides the prefix itself: **a permanent namespace must mirror a
namespace-shaped global the host language already has.** `JSON`, `Promise`, and
`Math` are spellings every JavaScript author already knows, and a prefix that
carries that recognition earns its four characters. A prefix we invented does
not, however tidy it looks — which is why `Look.` was withdrawn and its
builders went back to being named imports from `velar/look`.

Four permanent namespaces carry the pure computation nearly every program
needs, and a program reaches every one of them without writing an import:

| Namespace | Mirrors | Members |
| --- | --- | --- |
| `Json.` | `JSON` | `parse`, `tryParse`, `stringify`, `stableStringify`, `clone`, `isSerializable` |
| `Promise.` | `Promise` | `all`, `race`, `sleep`, `timeout`, `retry`, `map`, `series` |
| `Math.` | `Math` | `pi`, `e`, `tau`, `infinity`, `min`, `max`, `clamp`, `sign`, `trunc`, `sqrt`, `cbrt`, `pow`, `exp`, `log`, `log2`, `log10`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `degrees`, `radians`, `hypot`, `random`, `randomInt`, `gcd`, `lcm` |
| `Text.` | `String` members beyond the core | `trimStart`, `trimEnd`, `capitalize`, `title`, `lines`, `lineStarts`, `chunks`, `words`, `slug`, `normalize`, `truncate`, `indent`, `dedent`, `normalizeWhitespace`, `utf8Size`, `escapeHtml`, `codePoint`, `fromCodePoint`, `matches`, `findMatch`, `findMatches`, `replaceMatches`, `splitPattern` |

The roster is closed. Every namespace-shaped JavaScript global was checked
against it: `Object` is answered by record fields and `Record<T>`, `Array` by
List methods, `Number` by number methods and the prelude `number(text)`,
`String` by string methods and `Text.`, `console` by `print`, and `Date` is
deliberately an import because reading the clock reaches outside the program.
A new permanent namespace has to prove it mirrors a host global first.

The prelude adds `print`, `str`, `number`, `equals`, and `range` as bare names.

A permanent namespace is vocabulary, not a value. `Json`, `Promise`, `Math`,
and `Text` are legal in exactly one position — the head of a member access,
`Json.parse(text)` — and rejected everywhere else: passed as an argument,
stored in a binding, spread, destructured, or exported. Allowing any of those
would invent a second and third spelling for the same functions, which rule 3
exists to prevent, and there is no program that needs one. The members
themselves are ordinary values: `const encode = Json.stringify` is fine.

`velar/url`, `velar/test`, and Web's `velar/look` are pure
too, and they stay behind an import on purpose: they are toolboxes a program
deliberately reaches for rather than vocabulary every program already speaks.
No standard module carries a collection operation, because a computation that
is already a collection operation belongs on the collection: those operations
are `List` members (section 8).
The import list at the top of a file is also worth something on its own — it
tells a reader which visual and textual vocabulary this file uses, which a
zero-import namespace cannot.
`velar/time`, `velar/id`, and `velar/log` reach the clock, entropy, and the
outside world, so they are not even eligible.

String methods and `Text.*` divide the way a hand divides from a toolbox:
**a string method is a core operation** — the everyday members of section 5 —
**and `Text.*` is the extension toolbox** every program can open and most never
need. Nothing moves between them, so the member list a reader must hold in mind
never grows.

`Text.codePoint(character)` answers the code point of exactly one character and
`null` for anything else — empty text, several characters, or a lone surrogate
half. `Text.fromCodePoint(value)` is its inverse and refuses a surrogate half,
so no call can build text that is not a sequence of characters.

A lexical declaration may not shadow a permanent namespace, and imports remain
the contract for capability-bearing modules. Both spellings that reach these
permanent members are retired — the named import and the namespace import —
and each receives a diagnostic that teaches the namespace spelling.

`Duration` is a Core value type written with `ms` or `s`. Core async timing and
Web `after`/`every` accept `Duration`, never a bare number. Duration addition,
subtraction, and numeric scaling preserve the unit-bearing value rather than
exposing JavaScript milliseconds as an untyped number.

`Kind.is(value)` and record `Type.is(value)` are first-class validators: a true
branch narrows `value` to the validated type. An exported derived value is
declared `export computed name = expression` and read bare by every importing
module; there is no second exported form, because there is no second spelling
for a derived value. Numeric finiteness and integer tests use
`value.isFinite()` and `value.isInteger()`. Numeric sign and truncation likewise
use `value.sign()` and `value.trunc()`; duplicate `Math.` spellings are not part
of the namespace.
