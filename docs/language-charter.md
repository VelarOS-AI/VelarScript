# VelarScript language reference

This document defines the current VelarScript source language. It is a clean
reference, not a migration guide. Removed spellings and earlier experiments are
not part of the language.

## 1. Design contract

VelarScript exists so that AI can write and maintain code that the product's
human owner can read and safely change: the human supplies intent, the model
writes the VelarScript, and the compiler guards each change. Every rule in
this contract serves that mission — uniform model output, diagnostics that
teach, and a readable JavaScript exit — as recorded in
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

This reference owns all user-observable semantics. The
[runtime and JavaScript boundary ledger](runtime-boundary.md) maps those
semantics to boundary classes, implementation owners, runtime ABI, failure
phase, and proof tests. The ledger and implementation may not add behavior that
is absent from or contradicts this reference.

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

Semicolons and braces are not statement syntax.

A statement normally ends at its newline. One continuation form exists: a line
whose first token is `.` or `?.` continues the previous logical line, so
method chains can span physical lines in the familiar formatted style. The
canonical indentation is one level past the statement being continued;
trailing-dot continuation is not supported.

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
detached `async` statement. A statement whose whole content is a value —
a comparison, a literal, a name, arithmetic, a `??` fallback, a conditional, an
index, a collection, a unary value, or a bare string — is rejected, because the
result is computed and thrown away. Each shape is answered with the thing the
author meant: a bare comparison teaches `=` or using the result, `++i` and
`--i` teach `+= 1` and `-= 1`, and a bare string teaches `//`, since a string
on its own line is a docstring habit rather than a comment.

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
- Most declaration words are **contextual**, not reserved. `type`, `match`,
  `from`, `as`, `using`, `test`, and every word the Web extension adds —
  `component`, `state`, `resource`, `action`, `watch`, `look`, `keyframes`,
  `css`, `expose`, `exposes` — are ordinary names anywhere a name can stand: a
  binding, a parameter, a loop binding, a named argument, a record field, a
  member name, and a record shorthand. Each becomes a declaration only in the
  shape that declaration has, and nothing else can take that shape. Where the
  two readings could compete, the name wins: `match(value)` calls a function,
  `state = 1` assigns a binding, and `look.brand` reads a field. `case` is
  softened the same way everywhere a name is not being *bound* — a record
  field, a member name, a `match` branch — but it cannot be a binding, because
  JavaScript reserves it and the emitted module would not parse.
- The words that stay reserved are the ones JavaScript reserves — including
  `enum` and `case` — the operator words `in`, `is`, `and`, `or`, `not`, and the
  structural words `def`, `class`, `if`, `else`, `while`, `for`, `return`,
  `import`, `export`, `const`, `let`, `try`, `catch`, `finally`, `throw`,
  `async`, `await`, `assert`, `abstract`, `override`, `static`, `private`,
  `extern`, `unsafe`, `pass`, `break`, `continue`, `extends`, `super`, `self`,
  `constructor`, and `get`. Using one as a name is reported by name.
- `@name` is the language's own namespace for members that stand where your
  names stand: a component's `@mounted:` and `@cleanup:` blocks, a class's
  `@dispose:` block, and a Look block's `@hover`. `@` is not an identifier
  character, so a component can declare `def mounted()` and an `@mounted:` hook
  without any collision.

```velar
const event = {type: "ping", from: "worker"}
const {type, from} = event          // ordinary names
const state = "ready"               // an ordinary binding, in a Web module too

type Payload:                       // a name and ':' — the declaration
    type: string

match type:                         // a header ending in ':' above a block
    case "ping":
        print(state + from)
    case _:
        pass
```

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
real use of these literals. Triple-quoted strings are not part of the language;
that spelling receives guidance to a quoted layout string.

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

Source hygiene is part of the lexer, not a linter. Bidirectional formatting
controls (`U+202A`–`U+202E`, `U+2066`–`U+2069`) cannot appear literally
anywhere in a source file — not in a string, not in a comment — because that is
exactly how source is made to read differently than it runs. The only way one
enters a program is `\u{202E}` inside a string, which stays visible to a
reviewer. Other control characters — `U+0000`–`U+001F` other than the line
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
Every other numeric spelling a JavaScript or Python author might reach for is
rejected with the decimal spelling it should have been: a leading zero (`007`),
the radix forms `0xFF`, `0b101`, and `0o17`, a point with no digit on one side
(`.5`, `5.`), and bare `Infinity` or `NaN`, which are produced by arithmetic
(`1 / 0`, `0 / 0`) and detected with `value.isNaN()` rather than written.

A bare `return` returns `null`, including at JavaScript and asynchronous
boundaries. Falling through a function without another result has the same
meaning.

Object fields support JavaScript-style shorthand. Spreads are supported in
records and lists:

```velar fragment
const nextUser = {...user, title: "Owner"}
const nextValues = [...values, 4]
```

Record construction is controlled even though its surface stays familiar.
Fields evaluate once from left to right, later fields replace earlier fields,
and names such as `__proto__` are ordinary own data fields rather than object
literal magic. Object spread copies only own enumerable string data fields. It
never invokes an accessor, ignores the source prototype, rejects symbol fields,
and converts an unsafe JavaScript `undefined` field to `null`. Direct `await` is
valid anywhere in an async record expression without adopting Promise-valued
fields that were not explicitly awaited.

Declarations and `for` loops share one controlled binding-pattern contract:

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

Logical operators are `and`, `or`, and `not`. Their operands are `bool` or
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

The one place assignability does not decide is enum against `string`. An enum
member converts to `string` as a one-way wire exit (section 6), and equality
is symmetric, so honoring that direction here would open a read path around
`Enum.parse`. `raw == Kind.textDelta` is therefore rejected and teaches both
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
never meet in `==`. The same intersection requirement (including the
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
value is a bare string, so ordering enum members sorts them by member name,
which is never the order the author means. One rule answers "is this ordered"
for `<`, `<=`, `>`, `>=`, `min()`, `max()`, default `sorted()`,
`sorted(by=selector)`, and the `sortBy`/`minBy`/`maxBy` keys, so no two of
them can disagree. A business order is stated explicitly —
`sorted(by=row => row.rank)`, an explicit comparator, or a string-backed enum
whose values encode the order (`low = "1-low"`).

`<`, `<=`, `>`, and `>=` keep IEEE behavior on `NaN`: every ordered
comparison against `NaN` is `false`. The ordered aggregations (`sum`, `min`,
`max`, default-ordered and `by=`-keyed `sorted`) refuse `NaN` elements with a
targeted error instead. Python-style comparison chains evaluate each operand
once:

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

if input is User:
    print(input.name)

if input is not Error:
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

### Precedence and associativity

This is the complete table, loosest binding first. Nothing else participates:
assignment is a statement rather than an expression, and there are no bitwise
or comma operators to place.

| Level | Operators | Associativity and notes |
| --- | --- | --- |
| 1 | `=>` | The arrow body extends as far as it can; a multi-statement body needs a named `def`. |
| 2 | `?:` | Right-nesting, so `a ? b : c ? d : e` groups as `a ? b : (c ? d : e)`. As an operand of any binary operator it must be parenthesized. |
| 3 | `??` | Left to right. Never shares a bare chain with `and`/`or`. |
| 4 | `or` | Left to right, short-circuit. |
| 5 | `and` | Left to right, short-circuit. |
| 6 | `== != < <= > >=`, `is`, `in` | The comparison layer. `<`/`<=` chain with each other and `>`/`>=` chain with each other; `==`/`!=` never chain, and a mixed-direction chain is rejected. `is` and `in` are not chain links: inside another comparison they must be parenthesized. |
| 7 | `+ -` (binary) | Left to right. |
| 8 | `* / %` | Left to right. `%` keeps JavaScript's sign, so `-3 % 2` is `-1`. |
| 9 | `not`, unary `+ -` | Binds *looser* than `**`. |
| 10 | `**` | Right to left, so `2 ** 3 ** 2` is `512`. |
| 11 | `await`, `try` | Prefix, tighter than every operator above. `try` reaches exactly as far as `await` does — over the whole postfix chain that follows it, and no further. |
| 12 | `()`, `.`, `?.`, `[]` | Postfix, left to right; the tightest level. |

Two rows have consequences worth stating outright.

Unary minus is looser than `**`, so `-2 ** 2` is `-4` — Python's grouping,
`-(2 ** 2)`. Write `(-2) ** 2` for `4`.

Member access is tighter than unary minus, so `-2.abs()` is `-2`: the method
runs on `2` and the sign applies to the result. Write `(-2).abs()` for `2`.
Member access on a number literal needs no ceremony either — `1.abs()`,
`1 .abs()`, and `(1).abs()` are all legal and all mean the same thing, because
`1.` is not a number literal in this language (section 3) and therefore cannot
swallow the dot.

`//` is always a comment, in every position. There is no floor-division
operator, and `7 // 2` is not a mistake the compiler can see: the comment
starts at `//`, the statement before it is already complete, and the value is
`7`. Floor division is `(a / b).floor()`.

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

`any` is reserved for explicit unsafe JavaScript declarations. Ordinary
VelarScript code uses `unknown` and validates it.

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

VelarScript does not provide TypeScript conditional types, mapped types,
overload sets, declaration merging, or type assertions. Type parameters exist
only on `def` functions; generic `type`, `class`, and `component` declarations
are not part of the language.

### Read-only data views

`readonly T` is a compile-time view over typed data, not a second runtime
collection family and not an implicit `Object.freeze`. The emitted JavaScript
keeps the same object identity. Mutable data may flow into a read-only
parameter or binding; a read-only view cannot flow back into a mutable
contract because that would let the recipient mutate through the alias.

```velar fragment
type Profile:
    readonly id: string
    details: Details
    tags: List<Tag>

def display(profile: readonly Profile) -> string:
    return profile.id + profile.details.label

const owned: Profile = loadProfile()
let selected: readonly Profile = owned
selected = loadProfile()
print(display(owned))
```

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
assertion** about the data: validation asserts a shape, it does not copy, and
the assertion carries no memory of the view the `unknown` was reached through.
So a mutable value parsed out of an `unknown` field of a `readonly` record
aliases the same structure the read-only view was protecting, and writing
through it writes through that view — with no diagnostic, because there is
nothing left to check. Validate at the boundary where data enters, and do not
park `unknown` inside data you intend to hand out as `readonly`.

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

def update(profile: Profile) -> null:
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
the available runtime evidence. Records and collections use deep validators,
classes use nominal identity, primitives use their runtime kind, and erased
generics or opaque capabilities can promise only presence. If an opaque call,
getter, callback, host boundary, or suspended task made that evidence stale,
the read throws `NarrowingError` with the source offset and expected type. This
keeps ordinary source concise without silently leaking a JavaScript `TypeError`.
Runtime narrowing guards are separate from `readonly`: the former validates a
fact at a use site; the latter removes mutation capability from a data type at
compile time.

The recheck runs at **every read that relies on the fact**, not once per check,
and for a record or collection it is a validating walk over the data. One check
followed by ten reads is ten rechecks. That is the right default — it is what
makes a fact survive a call at all — but in a hot loop it is worth avoiding:
bind the narrowed value to a `const` once, outside the loop or immediately
after the check, and read the `const`. A `const` holds the checked type
outright, so it carries no fact and needs no recheck.

Three boundaries remain because they are visible in source:

- Narrowing does not flow into a nested function body. A callback may run at
  any later time, so it re-checks what it needs or receives checked values as
  parameters.
- A getter is a computed value, not a stable location. Read it into a `const`
  to narrow the result.
- An index or a `Map.get` is a read, not a location either. `values[0]` and
  `lookup.get(key)` compute a result each time they are written, so testing one
  narrows nothing for the next — the collection may hold something else by
  then. Read the value into a `const` and test that; the two reads become one.

An f-string converts each embedded value at its source position under the
language's one text-conversion contract: conversion accepts `string`,
`number`, `bool`, enums, and `null` — plus optionals and unions of those —
and is inert. A `bool` renders `true` or `false`, `null` renders `null`,
enums render their runtime string value, and non-finite numbers print
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

type Event = TextEvent | ToolEvent

def describe(event: Event) -> string:
    if event.kind == EventKind.text:
        return event.text
    return event.toolId
```

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
infers `-> null`, while a partial `T` return infers `-> T?`. An explicit `-> T`
remains a checked contract and a non-null contract must return on every
reachable path. An async declaration infers or annotates its resolved value,
while its call type remains `Promise<T>`. Recursive result dependencies are
solved to a fixed point; a recursive group whose result cannot converge must add
an explicit annotation. Extern functions and abstract methods have no body to
infer and therefore always declare their result. Components retain their
dedicated render result, class constructors retain their non-returning
construction contract, getters retain their explicit property result, and
contextually typed arrows may infer their result from the surrounding function
type.

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
argument is a compile error, or a `TypeError` when it arrives as `any`. The
accepted grammar is deliberately wider than the source literal grammar in one
place — `"4."` and `".5"` parse even though `4.` and `.5` are rejected as
literals — because the input is data from outside the program, not source a
person wrote.

Every string and number method above returns a new value and never modifies
its receiver. An expression statement that calls one and discards the result
is a compile error — there is nothing the call could have accomplished.

Rest parameters use `...values`. A rest parameter is always final and may
follow defaulted fixed parameters.
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
function. JavaScript Promise adoption and the JavaScript event loop remain the
runtime behavior. Because the JavaScript Promise representation reserves a
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
nothing owns its failure. The two current spellings state the intent
explicitly — `await` waits, and the `async` statement runs detached:

```velar fragment
await save()
async save()
```

`async <expression>` is statement-position only and requires a checked
`Promise<null>`. A non-null resolved value would be lost silently, so a
result is awaited, or discarded explicitly inside an async def, before the
task detaches. A detached task never floats: the compiler hands its Promise
to a compiler-owned observer that normalizes rejection to `Error` and reports
it through the host error channel without ending the program — the console
error channel on Node output, and the `velar/app` error chain with the
distinct `detached` phase on web output. Inside components, UI-owned async
work still belongs to `action`, which carries reactive pending/error state
and the component lifecycle; the `async` statement serves process- and
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
position require a concrete type instead. Only `def` declarations — top-level,
exported, extern, and class methods — take type parameters; generic `type`,
`class`, and `component` declarations and variance are deliberately out of
scope.

#### Bounds

A type parameter may name one bound, written `<T: Bound>`. A bound does two
things and nothing else: the call site checks the type the parameter solved
to, and the body may use the capability the bound promises. There are no
conditional types, mapped types, operations between bounds, inferred bounds,
or default bounds — the type-level programming rule 4 excludes stays excluded.

The bound vocabulary is closed and the compiler owns it. There are exactly
three, and they form one containment chain — every `Comparable` type is also a
`Text` type, and every `Text` type is also a `Data` type — so one word is
always enough and there is no syntax for combining two:

| Bound | Promise | What the body may do |
| --- | --- | --- |
| `Comparable` | the type has a runtime order | `<` `<=` `>` `>=`, `sorted()`, `min()`, `max()`, `sorted(by=)`, and `sortBy`/`minBy`/`maxBy` keys, plus everything `Text` allows |
| `Text` | the type has a hook-free text form | f-string interpolation, `str(value)`, passing `str` itself, plus everything `Data` allows |
| `Data` | the type is JSON-shaped | `Json.stringify`, `Json.stableStringify`, `Json.clone`, request bodies, stored values |

```velar fragment
def label<T: Text>(value: T) -> string:
    return f"{value}"

def ranked<T: Comparable>(values: List<T>) -> List<T>:
    return values.sorted()

print(label(5))
print(ranked(["b", "a"]).size)
```

A user type is never a bound: `<T: User>` is rejected, and so is any name
outside the three. The vocabulary is closed for the same reason user-defined
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
| `sorted(compare?)`, `sorted(by=selector)` | Sorted copy by a comparator or ordered key. |
| `reversed()` | Reversed copy. |
| `join(separator="")` | Joined string for `List<string>`. |

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
element type or Map key type may not mix members of different enums, or an
enum with `string`: enum members are bare strings at runtime, so such keys
would silently collapse into one slot. The ordered aggregations and `sorted` accept
ordered elements and keys only — `number`, `string`, or a single-category
union of them — so an enum element or key is rejected with guidance to
`sorted(by=rank)` or a string-backed enum (section 4). `sum`, `min`, `max`,
and `sorted` (default order and numeric `by=` keys) throw a targeted error on
a `NaN` element — `NaN` has no ordering and poisons totals; the message
points to `filter(x => not x.isNaN())`. Collection methods that return a new
value without mutating their receiver (`copy`, `slice`, the callback family,
the aggregations, `get`, `has`, `keys`, `values`, `entries`) are compile
errors as bare expression statements: the result is discarded. Discarding
`pop()` or `remove(value)` stays legal — they mutate and also report.
Callback operations (`find`, `some`, `every`, `map`, `flatMap`, `filter`, `reduce`, keyed `sorted`,
`sum`, `min`, and `max`) read one
checked shallow snapshot, so a callback may mutate the original List without
changing which values belong to the current operation.
The `by` selector is called exactly once per snapshot value. Comparator and
`by` forms are mutually exclusive.

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

```velar fragment
const users: Map<string, User> = Map()
users.set(user.id, user)
const selected = users.get("user-1")
const scores = Map([["Ada", 9], ["Lin", 7]])
const flags = Map({preview: true, compact: false})
```

Map members are `size`, `get`, `set`, `update`, `remove`, `has`, `clear`,
`copy`, `keys`, `values`, and `entries`.

`Set(values)` copies one checked dense List (or another Set). `Map(entries)`
accepts a checked dense List whose every item is exactly `[key, value]`;
`Map(record)` converts own enumerable string data fields into entries. Both
forms reject accessors, sparse or malformed Lists, symbol fields, and
overridable collection iterators at their runtime boundary. Empty `Set()` and
`Map()` keep their existing contextual and first-mutation inference.

### Dynamic Record

`Record<T>` is the JSON-shaped counterpart to `Map<K, V>`: it is a plain data
record with arbitrary string keys whose values all satisfy `T`. It is intended
for JSON objects, schema property tables, headers encoded as data, and other
wire formats where object keys are not known in advance.

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
Empty mutable collections can infer
their element/key/value types from their first checked mutation, but exported
APIs should annotate them. An optional collection annotation still contextually
types a present collection value, so empty `[]`, `Set()`, and `Map()` values do
not lose their element or key/value contracts.

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
such keys carries meaning, hold them in a `Map` instead — `Map(record)` and
`Map(entries)` both keep true insertion order for keys of any spelling:

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
- **Set and Map** — the loop holds a live native iterator. A member or key
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
per step. Replacing an element with a hole or an accessor is the one foreign
change that fails instead: the per-element check refuses it rather than reading
an invented value.

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

A condition judges truth, not presence. `if`, `else if`, `while`, `assert`, the
`?:` test, and the operands of `and`/`or`/`not` accept `bool` and `bool?`, where
an absent `bool?` is `false`. Every other type is rejected, including optionals:
JavaScript truthiness would make `0`, `""`, and an empty collection take the
`else` branch, so a presence test is written `value != null` and an emptiness
test is written `values.size == 0`. The diagnostic names the explicit form for
the value's type.

Inline conditions use the JavaScript-shaped `condition ? then : else` form.
Python's sentence-like inline `x if condition else y` form is not used.

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

`switch` is not VelarScript syntax.

### Loops

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
loop; three slots are rejected.

`async for value in source` consumes one explicit Velar pull contract:
`source.next()` must have the checked type `() -> Promise<T?>`. The source and
its data-valued `next` method are captured once; the capture reads a plain
function — through the prototype for class sources — and never invokes an
accessor. Each pull must return an
actual Promise; a resolved `null` ends the loop, a resolved `T` enters the body,
and rejection leaves the loop unchanged. The optional second slot is a
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
`step=...`.

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
condition's negated facts do not persist past it. Writes after an unconditional
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

A class declares its own contract as a compiler-known `@dispose:` block, which
usually delegates to the verb the class already publishes:

```velar fragment
class Terminal:
    def close() -> null:
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
releasing is behavior.

A release failure never hides a real error. When an error is already in flight
the original error is what propagates and the release failure is reported
through the host error channel; with no error in flight, a failing release
throws normally, exactly as a `finally` would.

Ownership needs a scope that ends, so `using` is rejected where none does: the
module top level lives until the process ends, and a component body builds the
component rather than finishing. Function bodies, methods, actions, and loop
bodies — which release on every iteration — are all ordinary owning scopes.

## 10. Classes

Classes use typed body fields and one explicit constructor.

```velar
class Session:
    let active: bool = true

    constructor(const id: string):
        pass

    get label() -> string:
        return self.active ? self.id : f"{self.id} (closed)"

    def close() -> null:
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
- In a derived class, parameter properties initialize after the leading
  `super(...)` call and before body field initializers and the remaining
  constructor statements.
- There is no class-header constructor shorthand.
- Instances are called directly: `Session("session-1")`.
- `self` is explicit in method bodies.
- Getters read as ordinary properties.
- `@dispose:` is the one compiler-known class member. It declares the release
  contract `using` runs (section 9, *Owned resources*), it is not callable from
  source, and a class may declare at most one. `@` marks names the language
  owns, so a member the author declares can never collide with one.

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
is the instance's declared class name — `"FileNotFoundError"` above — and it
comes from the same place `.name` does, so the two can never disagree. A value
no VelarScript class declared, such as a host `TypeError` that reached a catch
binding, reports the contract it does satisfy: `"Error"`.

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
`HttpError`, `HttpAbortError`, and `HttpTransportError`, whose fields (`status`,
`reason`, `phase`) a caller branches on directly.

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
import * as math from "velar/math"

export const version = "1"
export def encode(value: unknown) -> string:
    return Json.stringify(value)
```

The whole module-boundary family — `import`, every `export` form, re-exports,
`import js`, and `extern module` — is module-top-level only, like `type`,
`class`, and `enum` declarations; writing one inside a block or function body
is a compile error, never partially-working shadow state. A module cannot
import from or re-export from itself: the self edge has no valid evaluation
order, so the answer is to use (or declare) the binding directly. Each module
file is one instance, so two import spellings that name the same file (a
casing variant on a case-insensitive filesystem, a path through a link) are
rejected rather than silently instantiating the module twice.

Initialization follows the ES modules the program compiles to, and the rules
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
legal and its position never changes what runs first. Write imports at the top
of the file so the reading order matches the running order. A top-level `await`
suspends only its own module's completion: the modules that import it wait for
it, and unrelated modules continue to initialize.

Relative `.vel` modules and package exports are supported. Project modules are
checked as one dependency graph. A function or value may carry the shape of an
unexported or unimported record across that graph, so its fields remain checked,
but the record's source name is not silently declared in the consumer. Import a
type explicitly when naming it in an annotation:

```velar fragment
import {User as Account, loadUser} from "./users.vel"

const user: Account = loadUser()
```

VelarScript modules have no default export in either direction: every export
carries a name, `export default` is rejected with that answer, and a default
import from a `.vel` module is answered the same way (`import js Name from
"pkg"` remains the JavaScript-bridge spelling for a package's `default`
export).

An unused import is not an error and produces no warning. The language has no
warning level, so an error on a name the author is about to use would shout in
the middle of an edit. `velar fix` does not remove one either: it applies only
the rewrites a diagnostic registered, and there is no diagnostic here to
register one. The import still runs the module, so a module imported only for
its initialization side effects behaves exactly as written.

A module imported *only* for its effects says so by naming nothing:

```velar fragment
import "./register-formats.vel"
```

That is the spelling both parents already use — Python's `import x`,
JavaScript's `import "./x"` — and it is the one to write when there is no name
to bind. `import {} from "./register-formats.vel"` runs the same module through
empty braces; it is rejected with that rewrite, because a form that binds
nothing should not be spelled as a binding list.

An imported name is read-only in the receiving module, but an `export let`
remains a live ES-module value: the exporting module can reassign it between
reads. The module contract records that distinction, and modules with live
exports must be imported by name rather than through `* as`; namespace fields
are always read-only.

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

Validation proves the shape a value has at that operation; it does not
constrain what an unchecked Proxy may do on later reads. Nor does it inherit
anything from where the value was found: a value validated out of an `unknown`
is a fresh, independent assertion over the same object, so if that `unknown`
was reached through a `readonly` view, the validated result is a mutable alias
of the data that view was protecting (section 5). Validate at the boundary,
before the data is stored anywhere a read-only promise is made about it.

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

### What `any` means

A value imported with `import js unsafe` has the type `any`, and `any` is the
one place in the language where the compiler makes no promise. Its operational
model is three sentences, and every one of them matters:

1. **Operations on `any` are raw JavaScript.** Member reads and writes, calls,
   arithmetic, indexing, `match`, and `is` all pass through to the host with
   JavaScript's own semantics and no adaptation. In particular the
   `undefined`-to-`null` normalization every checked type receives does not
   happen, and that breaks the language's one null test: an `any` holding
   `undefined` answers `false` to `== null` and `true` to `!= null`, so a
   missing value reads as present. Assigning it into a checked optional
   normalizes it — after `const value: string? = raw`, `value == null` is
   `true` — which is one more reason the annotation belongs at the boundary.
   Four operations are refused outright rather than passed through. An f-string
   and `str()` reject `any`, because JavaScript coercion would invent text by
   running foreign hooks. A condition rejects it, because JavaScript truthiness
   would send `0` and `""` down the `else` branch while section 9 judges `bool`.
   And `await` rejects it, because an unchecked thenable runs foreign hooks and
   can resolve to raw `undefined`.
2. **`any` is assignable to every type, with no runtime check.** `const label:
   string = someAny` compiles and does nothing at run time. Nothing verifies the
   value; the annotation is simply believed. Validation happens only at the
   operations that already validate — `Type.parse`, `Type.is`, a checked
   collection operation, a `match` pattern — so a leaked `any` is laundered into
   a type that then behaves like a lie. That is how a compile error the language
   otherwise guarantees comes back: after that assignment, `label + "!"` produces
   `"[object Object]!"`, the exact implicit conversion section 5 exists to
   reject.
3. **Therefore the import site is the only correctness boundary.** Validate at
   the edge — `Config.parse(legacyValue)` — and let only checked values inward.
   An `any` that travels further into the program takes the compiler's
   guarantees with it wherever it stops.

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
Component JSX follows JavaScript evaluation order: props evaluate from left to
right, then JSX children, then the component function. Native JSX remains an
owned DOM construction rather than a hidden Core-language operation.

The source package then exposes the following language extension. This list is
the complete addition — ten contextual keywords, two lifecycle hooks, three
reserved global functions, and the unit literals; nothing else in a Web module
is new syntax. Every *contextual keyword* here declares only in its own shape
and remains available as an ordinary name (section 3). The three reserved
globals are the exception: `computed`, `mount`, and `tick` are real runtime
entry points, so a Web module refuses them as binding names, as it does the
media subjects `viewport`, `scheme`, and `motion` (section 17). Those six words
are the whole difference between what a Core module and a Web module accept:

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
- the reserved globals `computed(() => value)`, `mount(node, target)`, and
  `tick()`
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
valueless. JSX expressions use ordinary VelarScript expressions, and the
interpolation braces are a bracket context: the expression inside `{...}`
continues across physical lines without parentheses, exactly as it would
inside a call's parentheses.

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
    def open() -> null:
        print("open:" + title)

    def close() -> null:
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
from a prop does not follow later updates — derive with `computed(() => ...)` when it
should. At a JSX position backed by a `Component` value, retaining the same
constructor identity retains the instance and its live prop cells; changing
the constructor identity destroys the old instance, runs its cleanup, and
mounts a fresh instance. An instance is otherwise destroyed and recreated only
when its position unmounts: a conditional branch switches, a keyed list entry's
key or value disappears, or the enclosing region re-renders away. Runtime-implemented
components (`Head`, `Router`, `Link`, `NavLink`) snapshot their props once at
construction.

```velar fragment
export component TicketBadge(count: number):
    const label = computed(() => count == 1 ? "1 open ticket" : f"{count} open tickets")

    return <span class="badge">{label()}</span>
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
preceding token, and the positions are: the start of a module, after a newline
or an indent, after `=`, after `return`, after `=>`, after `(`, `[`, or `{`,
after `,`, `:`, or `?`, and after `??`, `and`, or `or`. Everywhere else `<` is
the less-than operator. `and` and `or` are in the list so that the React habit
`{ready and <Panel />}` parses and is answered with the conditional-rendering
spelling — `{ready ? <Panel /> : null}` — rather than a parse cascade; those two
operators still combine bool values only. Outside these positions, wrap the
element in parentheses.

## 15. State, computed values, resources, and actions

```velar fragment
export component Profile(userId: string):
    state expanded = false
    const label = computed(() => expanded ? "Hide" : "Show")
    resource profile: User = loadUser(userId)

    action save() -> User:
        return await saveUser(profile.value)

    def toggleExpanded() -> null:
        expanded = not expanded

    return <section>
        <button type="button" on:click={toggleExpanded}>{label()}</button>
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

def retitle(task: Task, title: string) -> null:
    task.title = title

retitle(tasks[0], "Ready")
```

An initializer is evaluated once. It does not create a formula:

```velar fragment
const currentTask = tasks[0]                   // one ordinary reference snapshot
state selectedTask = tasks[0]                  // an independent writable cell
const liveFirstTask = computed(() => tasks[0]) // a live positional query
```

The first two bindings initially refer to the same task object, so deep
mutation of that object remains visible through either reference; neither one
follows a later List insertion at index `0`. Reassigning `selectedTask` changes
only that state cell. `liveFirstTask()` is the spelling that follows the current
first position.

State does not copy, freeze, or claim linear ownership of a mutable value.
Hydrated data, rebuilt indexes, and other ordinary values may initialize or be
assigned into state directly:

```velar fragment
const restored = loadSnapshot()
state model = restored.model

def replaceModel(next: Model) -> null:
    model = next
```

Assigning the cell publishes the new root immediately. Continue later deep
mutation through the state binding, a reference read from it, or the official
collection operations; an old raw alias mutated outside those paths is not an
observable write. VelarScript intentionally does not pretend to have an
ownership system by rejecting only some aliases or forcing product-layer
copies.

`computed` is a function, not a declaration keyword. The removed
`computed name = expression` declaration has no compatibility alias; write
`const name = computed(() => expression)`. The function accepts one
synchronous zero-argument function and returns a read-only accessor
`() -> T`. Calling that accessor tracks dynamic reactive dependencies. Its
result is evaluated on first access and cached while observed. An invalidated
observed result refreshes during the reactive flush; a synchronous access
before that flush refreshes it immediately and still publishes a changed result
to the other downstream observers. Downstream observers are notified only when
the result changes by identity/value equality. Failure and recovery are also
result-state transitions: a synchronous failure reaches the managed consumer,
and recovery wakes downstream caches even when it produces the same value as
the last successful evaluation. When its last consumer is disposed it detaches
from upstream dependencies. Asynchronous component data belongs in a
`resource`. Record properties and collection keys are tracked
independently,
so changing `task.done` invalidates consumers of that property without
invalidating unrelated `task.title` reads, and changing one `Map` entry does not
invalidate consumers of other keys. There is no separate `memo` API and no
manual batching API; `computed` is the one derived-cache abstraction, while
property-level tracking and synchronous assignment coalescing are framework
contracts owned by the Web API document.

Reactive imports keep the same split as ordinary imports: assigning an imported
binding is forbidden, while mutating the value inside an imported state binding
is legal and publishes to every consumer. Component record and collection props
enter the child through the same transitive Core `readonly` views used by
ordinary functions and module interfaces. A helper that only reads a prop must
declare a `readonly` parameter; a helper that requires a mutable parameter
cannot receive the prop. A child may call a callback supplied by its parent to
request a mutation, but it may not assign through the prop or invoke a mutating
collection method on it. The readonly promise of props covers data props. A
bare class prop is a behavioral value: it is visibly a class at the prop
declaration, passes to the child as-is, and receives no readonly protection. A
class buried inside a record or collection prop is rejected at the prop
declaration exactly like explicit `readonly` (section 5) — lift the class into
its own prop, or model it as a data record.

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
        async profile.reload()

    return <p>{profile.value?.name ?? "Loading…"}</p>
```

A watch body is synchronous, so the reload is started with the detached `async`
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

`watch expression:` runs an explicit side effect when the tracked value changes,
and `watch expression as current, previous:` names the new and old values. Both
names are required when `as` is present, so a body that needs only the new value
writes `as current, _`. The expression is evaluated immediately to establish the
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
dynamic region that throws while it is first built, and a missing target all
report through `velar/app` and render an accessible fatal state instead. One
component instance mounts exactly once; a repeated mount fails explicitly rather
than moving DOM silently.

`tick()` answers `Promise<null>` that resolves after the pending reactive flush
has settled, which is how a test observes the DOM that a state write produces.
It is also the point where an unowned failure surfaces: if the flush reported a
failure that no handler claimed, `tick()` rejects with it, so awaiting `tick()`
cannot step over a broken update.

## 17. Look: controlled visual language

Look is VelarScript's checked visual language. It uses real DOM-style CSS
property names, VelarScript expressions, typed unit values, composition, conditions,
element states, and explicit pseudo-element targets.

```velar
const colors = {
    text: Look.rgb(24, 31, 46),
    surface: Look.rgb(248, 250, 255),
    active: Look.rgb(228, 235, 255),
}

export const cardLook = look:
    display = "grid"
    gap = 12px
    padding = Look.spacing(16px, 20px)
    border = Look.border(1px, Look.alpha(colors.text, 0.12))
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

### Builders

Look builders live on the permanent `Look.` namespace and need no import, and
they are not magic names that appear only inside a `look:` block. A builder may
be aliased (`const make = Look.rgb`), passed to another function, returned, and
called outside Look like any other VelarScript value. `velar/look` remains an
importable module only for its visual Type objects, such as `Length` and
`Color`.

The namespace provides a small checked builder set:

- colors: `color`, `rgb`, `rgba`, `hsl`, `alpha`, `lighten`, `darken`
- visuals: `border`, `shadow`, `linearGradient`, `asset`
- layout: `minmax`, `repeat`, `tracks`, `spacing`, `min`, `max`, `clamp`
- motion: `transition`, `animate`

Named arguments work normally:

```velar
const raised = Look.shadow(0px, 12px, 32px, Look.rgba(0, 0, 0, 0.16), spread=0px, inset=false)
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

Numeric domains are checked where the argument is written. A literal argument
outside a builder's range — a colour channel above 255, an opacity above 1, a
division by zero — is a compile error rather than a first-paint failure; a
computed argument keeps the same check at run time.

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
const paper = Look.rgb(251, 250, 247)
const primary = Look.rgb(45, 79, 190)

const controlLook = look:
    display = "inline-flex"
    color = paper

export component Example:
    return <div>
        <div
            look:display="grid"
            look:gap={12px}
            look:padding={Look.spacing(16px, 20px)}
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
const text = Look.rgb(35, 39, 47)
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

Look and class alone have no universal winner. A base Look selector and a
simple class selector both normally have specificity `(0,1,0)`, so source order
decides: CSS imported `before look` loses an equal-specificity conflict to Look,
while CSS imported `after look` wins it. Stateful Look selectors usually add a
second attribute selector and are therefore more specific than one simple
class. Compound selectors, IDs, pseudo-elements, and `!important` can change
that result through the ordinary CSS cascade.

### Composition

Look values are ordinary exportable values and may be composed once at their
outer level:

```velar
export const controlLook = look:
    padding = Look.spacing(10px, 14px)
    borderRadius = 10px

export const primaryControlLook = look:
    ...controlLook
    color = Look.rgb(255, 255, 255)
    background = Look.rgb(45, 79, 190)
```

Later declarations in the composed result follow normal CSS cascade order.
Duplicate properties in the same Look scope are reported instead of hidden.

Composition crosses a component boundary in one direction. A `look` written on
a component invocation composes *after* the look the component applies to its
own host, so the caller wins every property both of them set, and every property
only one of them sets survives. That is what makes a component's visual defaults
overridable without the component declaring a prop for each one; a component
that must not be restyled that way keeps the look on an inner element instead of
its host.

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
const compact = 720px

const panelLook = look:
    background = Look.rgb(255, 255, 255)

    if scheme.dark:
        background = Look.rgb(29, 32, 41)

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
such as `base:background` and `hover:background` on `data-velar-look`, with
readable `--velar-look-*` variables for dynamic values. Developers can also
provide their own stable `class` and `data-*` attributes as public hooks.

Native CSS is an explicit unsafe boundary:

```velar fragment
import css unsafe "./legacy.css" before look
import css unsafe "./overrides.css" after look
```

`before look` and `after look` specify source order only. They do not assign
semantic priority. Specificity and `!important` remain the external stylesheet
author's responsibility. Global native CSS cannot be declared inside a local
component scope.

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
Promises at checked JavaScript boundaries, never magic thenables. Unsafe
JavaScript `any` imports deliberately remain outside this guarantee. A
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

A capability module states the host's real semantics rather than a comfortable
approximation of them. **A watcher reports only the changes that happen after
it is armed.** If you need to observe a change you are about to make, write
first and then start watching, or query the state on both sides of the write.
Arming is asynchronous on every host the language targets, so a watcher that
promised to catch a change racing its own creation would be promising
something no filesystem delivers.

## 19. Deliberately absent source features

The following are not part of VelarScript:

- `var`, `undefined`, `none`, or `None`
- coercive equality
- single-quoted or triple-quoted strings; the delimiters are `"` and `` ` ``
- `${...}` interpolation, hexadecimal, binary, or octal number literals, and
  `Infinity` or `NaN` as literals
- equality chains (`a == b == c`) and mixed-direction comparison chains
- expression statements that only compute a value
- `switch`
- `new`
- `this` in VelarScript class methods
- JavaScript `delete`, `typeof`, `instanceof`, `eval`, regular-expression
  literals, increment/decrement operators, or bitwise operators
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
  every other declaration already look: `let name: T? = null`
- TypeScript-style interfaces, assertions, overloads, or type programming
- generators, `yield`, or the JavaScript `Symbol.asyncIterator` protocol;
  incremental sources use checked `async for` pull contracts or producer
  callbacks, and JavaScript `for await` is guided to `async for`
- JavaScript `splice`, `push`, `shift`, `unshift`, mutating `sort`, or mutating
  `reverse`
- user-defined decorators or declaration annotations. VelarScript's decorators
  are its modifier keywords — `export`, `abstract`, `override`, `static`,
  `private`, `readonly`, `async` — and they come from a closed vocabulary the
  compiler owns. A library that could change what a declaration means would put
  the reader back to reading the library before reading the code; the same
  reason forbids user-defined type-parameter bounds. New declaration markings
  arrive as new modifier keywords, not as an extension point
- magical JSX control-flow attributes
- a public `effect` primitive
- implicit global CSS
- random class or variable names
- automatic compatibility aliases for removed spellings

The source grammar is an allowlist: a syntax addition to JavaScript never
becomes VelarScript syntax without an explicit language decision, AST node,
analysis rule, lowering, and proof test. JavaScript reserved words cannot be
used as binding names because generated modules must remain valid JavaScript;
`enum` is reserved for exactly that reason, while `type`, `match`, `case`,
`from`, and `as` — which JavaScript does not reserve — are contextual keywords
and stay available as names (section 3). Spellings such as `delete`, `default`,
and `arguments` remain valid as ordinary record keys and class member names, so
external data and Web APIs do not need renamed fields. Execution-capability and
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
| Typography and international text | `color`, `font`, `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `fontStretch`, `fontVariant`, `fontKerning`, `fontOpticalSizing`, `fontFeatureSettings`, `fontVariationSettings`, `lineHeight`, `letterSpacing`, `wordSpacing`, `textAlign`, `textIndent`, `textDecoration`, `textDecorationColor`, `textDecorationLine`, `textDecorationStyle`, `textDecorationThickness`, `textUnderlineOffset`, `textUnderlinePosition`, `textTransform`, `textRendering`, `whiteSpace`, `textOverflow`, `textWrap`, `overflowWrap`, `wordBreak`, `hyphens`, `tabSize`, `writingMode`, `textOrientation`, `direction`, `unicodeBidi` |
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
`tracks(minmax(...))`, and `linearGradient(...)` respectively.

The following 36 real CSS properties are deliberately outside checked Look.
Their diagnostics name this boundary and point to module-level
`import css unsafe` as the escape hatch.

| Excluded family | Properties | Reason |
| --- | --- | --- |
| Float layout | `float`, `clear` | Legacy float layout is outside the Grid and Flex model. |
| Table formatting | `tableLayout`, `borderCollapse`, `borderSpacing`, `captionSide`, `emptyCells` | A typed table-layout contract needs evidence before admission. |
| Multi-column layout | `columns`, `columnCount`, `columnWidth`, `columnFill`, `columnRule`, `columnRuleColor`, `columnRuleStyle`, `columnRuleWidth`, `columnSpan` | Its value and fragmentation model is not yet typed. |
| Animation longhands | `animationName`, `animationDuration`, `animationTimingFunction`, `animationDelay`, `animationIterationCount`, `animationDirection`, `animationFillMode`, `animationPlayState`, `animationTimeline`, `animationRangeStart`, `animationRangeEnd` | `keyframes:` plus `Look.animate(...)` owns the checked animation contract. |
| Generated content | `counterIncrement`, `counterReset`, `counterSet`, `quotes` | Counters and quoting are not modeled as checked Look values. |
| Paged fragmentation | `breakAfter`, `breakBefore`, `breakInside`, `orphans`, `widows` | Paged and fragmented media are outside the Web application target. |

### Checked keyframes and animation

A module-level `keyframes:` expression is an ordinary exportable `Keyframes`
value. A stop is `from:`, `to:`, or an integer percentage from `1%` through
`99%`; comma-separated stops share a body. Stops may not repeat and declaration
groups must progress in ascending order. A body contains direct, statically
lowerable Look properties only. It reuses the Look property and value checker,
rejects non-interpolating properties, and cannot read reactive state. Equal
keyframe structures receive one stable generated CSS name and one emitted rule,
including when used through another module's checked interface.

```velar
export const spin = keyframes:
    from:
        rotate = 0deg
    50%:
        rotate = 0.5turn
    to:
        rotate = 1turn

export const spinningLook = look:
    if not motion.reduced:
        animation = Look.animate(spin, 1s, easing="linear", loop=true)
```

`Look.animate(frames, duration, easing?, delay?, count?, loop?, direction?, fill?)`
returns `Animation`. Duration must be positive, delay cannot be negative,
`count` is a positive integer, and `count` and `loop=true` are mutually
exclusive. Easing is one of `linear`, `ease`, `ease-in`, `ease-out`,
`ease-in-out`, `step-start`, and `step-end`; direction is `normal`, `reverse`,
`alternate`, or `alternate-reverse`; fill is `none`, `forwards`, `backwards`,
or `both`. Literal options are checked during compilation. Look `animation`
accepts `Animation`, `List<Animation>`, or `null`, never a CSS animation string.
An element binding such as
`look:animation={active ? Look.animate(spin, 1s) : null}` adds and removes the native
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

Four permanent namespaces carry the pure computation nearly every program
needs, and a program reaches every one of them without writing an import:

| Namespace | Members |
| --- | --- |
| `Json.` | `parse`, `tryParse`, `stringify`, `stableStringify`, `clone`, `isSerializable` |
| `Promise.` | `all`, `race`, `sleep`, `timeout`, `retry`, `map`, `series` |
| `Text.` | `trimStart`, `trimEnd`, `capitalize`, `title`, `lines`, `lineStarts`, `chunks`, `words`, `slug`, `truncate`, `indent`, `dedent`, `normalizeWhitespace`, `utf8Size`, `escapeHtml`, `codePoint`, `fromCodePoint`, `matches`, `findMatch`, `findMatches`, `replaceMatches`, `splitPattern` |
| `Look.` | the Web builder roster (`rgb`, `spacing`, `border`, and the rest of section 17) |

The prelude adds `print`, `str`, `number`, `equals`, and `range` as bare names.

`velar/collections`, `velar/math`, `velar/url`, and `velar/test` are pure too,
and they stay behind an import on purpose: they are toolboxes a program
deliberately reaches for rather than vocabulary every program already speaks.
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

A lexical declaration may shadow any permanent namespace, and imports remain
the contract for capability-bearing modules. Both spellings that reach these
permanent members are retired — the named import and the namespace import —
and each receives a diagnostic that teaches the namespace spelling.

`Duration` is a Core value type written with `ms` or `s`. Core async timing and
Web `after`/`every` accept `Duration`, never a bare number. Duration addition,
subtraction, and numeric scaling preserve the unit-bearing value rather than
exposing JavaScript milliseconds as an untyped number.

`Kind.is(value)` and record `Type.is(value)` are first-class validators: a true
branch narrows `value` to the validated type. An exported `computed` value must
declare its public accessor result at the export site, for example
`export const name: () -> T = computed(...)`. Numeric finiteness and integer
tests use `value.isFinite()` and `value.isInteger()`; the duplicate
`velar/math` functions are not part of the module surface.
