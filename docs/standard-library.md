# VelarScript Core Standard Library

Status: active clean-break design
Compiler: current VelarScript compiler
Runtime: existing JavaScript engine; no separate VM

## Contract

The Core library combines the most useful everyday parts of Python and modern
JavaScript behind a small explicit VelarScript surface. It is not a copy of either
standard library.

`velar/*` is a closed vocabulary owned by the language. A module belongs here
only when it provides universal computation that any program may need, or a
minimal orthogonal capability primitive for interacting with the outside world.
Domain functionality such as editor, game, or chart tooling is always an
installable library, even when it is implemented entirely in VelarScript.

- **Purity decides whether a module *may* be permanent; universality decides
  whether it *should* be.** Anything that reaches outside the program must be
  imported. A module that only computes but that only some programs reach for
  keeps its import line too, because every permanent name is a name every
  reader is assumed to know unprompted. An `import` line is therefore both an
  audit of what a module touches and a statement of which toolbox this program
  chose.
- Everyday value operations live on checked string, number, and collection
  members. Nothing patches JavaScript prototypes or creates new global names.
- Implementation language does not determine membership. Reusable domain
  modules written in VelarScript publish an ordinary npm package with one
  `velar.entry` source entry and are imported by package name after installation.
- Collection transforms return new lists and maps unless their name explicitly
  describes another result. JavaScript reference identity and `number`
  semantics remain unchanged.
- Missing collection and parsing results use `null`, never JavaScript
  `undefined`.
- The compiler preserves element, callback-result, map, optional, runtime data,
  and Promise result types through built-ins. This inference is internal; VelarScript
  does not expose user-defined generic syntax.
- Runtime validation is explicit. Argument mistakes that can be proven
  statically are diagnostics; dynamic misuse throws `TypeError` or
  `RangeError`.
- Fixed official signatures expose the same `name=value` calls as user-defined
  functions. Their documented parameter names are part of the checked API and
  editor signature help; source expressions still evaluate left to right.
- A positional overload or pure rest call has no invented keyword surface.
  `randomInt`, numeric `min`/`max`, and URL `join` therefore stay
  positional, matching the familiar operation they represent.
- Every API that requires `List<T>` enforces the same dense, field-free,
  mutable data-element List boundary used by the language runtime. Sparse or
  frozen JavaScript arrays, arrays carrying hidden/extra fields, and
  accessor-backed elements do not become valid Lists through a library call;
  validation never invokes an element getter.
- Map and Set boundaries use native internal-slot checks and prototype
  operations. Cross-realm native collections are accepted, while subclass
  overrides cannot replace size, iteration, membership, or lookup semantics.
  Collection brands and runtime `Type` traversal capture their Array/Map/Set,
  reflection, size, iterator-factory, and iterator-step operations when the
  generated module initializes, so later global or prototype replacement
  cannot change a checked `is List/Set/Map/Record` result.
  Direct List construction, indexing, iteration, snapshots, transforms,
  ordering, and mutation likewise use an initialization-captured List host ABI.
  Dense reflection and numeric bounds use explicit wrappers; value traversal is
  indexed and native join/sort/reverse operations are captured once. Set/Map/
  Record operation hosts are separate runtime layers rather than aliases of
  this List contract.
  Set and Map construction and receiver operations also have their own captured
  host layer: native size, membership, lookup, mutation, keys/values/entries,
  iterator steps, copy, and clear are fixed when the generated module starts.
  Subclass overrides and later prototype or iterator replacement therefore
  cannot redirect ordinary Set/Map behavior. Record operations remain a
  separate data-object boundary.
  Record validation and receiver operations capture their own field discovery,
  descriptors, definition, deletion, identity, freezing, Reflect, and errors.
  Bracket access, one-slot/pair iteration, copy, mutation, and field snapshots
  use explicit indexed loops, independently of Array iterator or `.map`
  behavior. Record literal/spread and Record/List binding remain compiler
  lowering rather than receiver-method shortcuts, but reuse the same captured
  reflection, definition, allocation, and Error operations. Their generated
  part, field, and rest traversal is explicitly indexed, so later ambient
  replacement cannot redirect construction or destructuring.
- Compiler-known runtime `Type` values use two adjacent owned runtimes. One
  immutable registry proves that a `Type<T>` value was compiler-created; the
  other captures WeakMap/Set recursion state, descriptor reads, Array/Promise/class
  identity, freezing, Reflect, and ValidationError behavior. `Type.is` and
  `Type.parse` therefore remain cycle-bounded, getter-free, and stable after
  ambient constructor/prototype or class `Symbol.hasInstance` replacement without conflating validation
  execution with registry identity.
- Core conversion is deliberately asymmetric and small: `str(value)` performs
  explicit display conversion, while `number(text) -> number?` parses one
  complete finite decimal after trimming surrounding whitespace and answers
  `null` for everything else — a partial parse, a radix form, a digit separator,
  `"Infinity"`, or an overflow. The charter's section 7 states the exact
  grammar. JavaScript `Boolean`, `Number`, and `String` globals are not source
  bindings, so truthiness, empty-string-to-zero, partial parsing, and `NaN` do
  not re-enter through ambient coercion.
- Core Node builds copy only imported official modules beside the generated
  output. Portable modules also bundle and tree-shake in Web builds. Local
  platform modules (`velar/serve`, `velar/fs`, `velar/env`, `velar/host`,
  `velar/terminal`, `velar/path`, `velar/process`) are
  compile-time rejected for Web targets with platform-specific guidance.
- Resource-producing APIs are bounded contracts, not best-effort host calls.
  A List contains at most 1,000,000 items; text and encoded JSON are limited to
  16 MiB; JSON data contains at most 1,000,000 values and 128 nested
  collections. List spread, `Set`/`Map` construction, and collection mutation
  preserve the 1,000,000-item invariant; an update to an existing Set value or
  Map key remains valid at the ceiling, while growth fails with `RangeError`.
  Dynamic misuse fails before a native capability is invoked.

## Three groups, and how to tell which one a module is in

Every module in this library is in exactly one of three groups. Two questions,
asked in order, decide which — so you can predict where a new module lands
before anyone tells you.

**1. Does it compute, or does it reach outside the program?** Reading a clock,
a disk, a network, or an entropy source is reaching outside. Anything that
reaches outside is a capability and is always imported.

**2. If it only computes: does its name mirror a namespace-shaped JavaScript
global?** If it does, it is permanent and needs no import. If it does not, it
is imported by name.

### Group 1 — permanent namespaces (no import)

`Json.`, `Promise.`, `Math.`, and `Text.`, alongside the prelude names `print`,
`str`, `number`, `equals`, and `range`.

The second question is what makes this list short and closed. A prefix costs
every reader four characters at every call, so it has to give something back,
and what it gives back is recognition: `JSON.stringify`, `Promise.all`, and
`Math.max` are spellings a JavaScript author already knows, and `Json.parse`
tells you the format where a bare `parse` would not. A prefix we invented gives
nothing back — which is why `Look.` was withdrawn after one release and its
builders returned to `velar/look` as named imports. "It looks uniform" is not a
reason.

Every namespace-shaped JavaScript global has been checked against this list:
`Object` is answered by record fields and `Record<T>`, `Array` by List methods,
`Number` by number methods and `number(text)`, `String` by string methods and
`Text.`, and `console` by `print`. `Date` is the one that computes-looking name
that is not here on purpose — reading the clock reaches outside, so `velar/time`
is a capability. A future addition must clear question 2 first.

Both spellings that reach a permanent member are retired — the named import and
the namespace import — and each earns a diagnostic that teaches the namespace
spelling and a `velar fix` rewrite that performs it.

### Group 2 — pure modules imported by name

`velar/collections`, `velar/binary`, `velar/random`, `velar/task`,
`velar/msgpack`, `velar/compression`, `velar/noise`, `velar/url`, `velar/test`,
and, on Web, `velar/look`.

These compute and touch nothing, so question 1 clears them; they are imported
because question 2 does not — there is no `Collections`, `Url`, or `Look` in
JavaScript to mirror. That is not a demotion. An import line is information: it
says this program chose this toolbox, and for `velar/look` in particular the
import list at the top of a file tells a reader exactly which visual vocabulary
that file speaks.

`velar/time`, `velar/id`, and `velar/log` sit here in spelling but fail
question 1 — they read the clock, read entropy, and write to the outside world
— so they could never move to group 1 whatever they were called.

### Group 3 — capabilities

`velar/fs`, `velar/path`, `velar/process`, `velar/env`, `velar/host`,
`velar/serve`, `velar/terminal`, `velar/http`, `velar/worker`,
`velar/websocket`, Node `velar/sqlite`, and the Web modules documented in
`web-api.md`.

For a capability the import line is the audit signal — it is how a reader sees
what a module touches — so no capability becomes permanent for convenience,
however often it is used.

## `velar/collections`

Python-style iteration helpers and explicit functional collection operations.
Core Lists use the same direct vocabulary: `append(value)` adds one item,
`extend(values)` adds a typed List atomically, and `slice(...)` returns a copy.
The JavaScript-specific variadic `push` surface is not part of VelarScript source.
Language-level callback methods read a checked shallow snapshot, so callback
mutation cannot silently extend, truncate, or replace the values participating
in the current operation.
`List<number>.sum()` and ordered `List<T>.min()`/`.max()` are the direct
aggregation surface. `List.sorted(by=selector)` computes one number/string key
per snapshot value and is mutually exclusive with the comparator form.
The imported collection helpers use the same snapshot boundary, including for
Array subclasses with overridden methods or iterators. Values returned from
host callbacks and async combinators normalize JavaScript `undefined` to
VelarScript `null` before becoming observable.

| Export | Behavior |
| --- | --- |
| `range` (prelude, no import) | Stop-exclusive bounded `List<number>` via `range(end)`, `range(start, end)`, or `range(start, end, step)`; negative steps count down and zero/tiny non-advancing steps fail. Importing it is an error that teaches the bare name. |
| `enumerate` | Returns `{index, value}` entries, with an optional integer start. |
| `zip` | Pairs two lists as `{first, second}` up to the shorter length. |
| `unique` | Keeps the first value for each JavaScript `Set` identity. |
| `chunk` | Splits a list into positive-sized list chunks. |
| `flatten` | Flattens exactly one list level. |
| `compact` | Removes `null` and narrows the result element type. |
| `reversed` | Returns a reversed copy. |
| `take`, `drop` | Select or skip a non-negative number of values; direct positional windows normally use the typed `List.slice` method. |
| `first`, `last` | Return the boundary value or `null`. |
| `find`, `index` | Find a value by predicate or the position of an exact value; a missing result is `null`. |
| `has`, `count` | Test or count collection membership using the same identity rule as Set and Map keys. |
| `some`, `every` | Evaluate an explicit boolean predicate for List values; dynamic callbacks cannot reintroduce truthiness. |
| `partition` | Returns `{matches, rest}` without changing source order. |
| `groupBy` | Groups values in a `Map` keyed by the callback result. |
| `keyBy` | Builds a `Map` whose last value wins for a repeated key. |
| `countBy` | Counts callback keys in a `Map`. |
| `sortBy` | Returns a stable key-sorted copy in either direction; keys are all strings or all non-NaN numbers. |
| `minBy`, `maxBy` | Return the value with the smallest/largest uniform string/number callback key, or `null`. |
| `sum` | Adds a `List<number>` from zero. |
| `join` | Joins one checked `List<string>` snapshot with an optional separator; the result cannot exceed 16 MiB. |
| `repeat` | Returns a list containing a value a non-negative number of times. |

```velar fragment
import {enumerate, groupBy} from "velar/collections"

const pages = enumerate(range(1, 4), 10)
const descending = range(start=5, end=0, step=-2)
const byRole = groupBy(users, user => user.role)
const labeled = enumerate(start=10, values=users)
```

Core prelude `range` returns the same checked, at-most-1,000,000-item List when
it is used as a value. The compiler recognizes only the direct one-slot loop
head `for value in range(...):`: it evaluates the arguments once, performs the
same complete range validation, and emits a native counter loop without
materializing the List. Aliased, saved, nested, or two-slot iteration keeps the
ordinary List contract, so there is no second public iterable type.

Ordering never uses JavaScript's mixed-type relational coercion. The compiler
rejects known boolean/record/optional/mixed key results and enum keys — an enum
carries no runtime order, so the diagnostic teaches `sorted(by=rank)` or a
string-backed enum whose values encode the order. A type parameter bounded by
`Comparable` is accepted. Dynamic keys are
checked before comparison, and equal-key input order is retained even for
descending sorts. `find`, `partition`, `some`, and `every` require an
actual `bool` result at dynamic boundaries.

The Array/Map/Set constructors and required operations, numeric predicates and
bounds, identity/freeze operations, Reflect invocation, and error constructors
are captured when `velar/collections` initializes. Replacing globals or
prototypes afterward cannot redirect traversal, grouping, sorting, joining, or
allocation. Imported helpers use explicit index loops over the one checked List
copy; stable sort remains the host's standards-defined stable Array sort through
the captured operation.

## Binary data, deterministic computation, and work ownership

`velar/binary` is the common Node/Web binary boundary. `Bytes` is an immutable
snapshot with `size` and read-only integer indexing. `UInt8Buffer`,
`UInt16Buffer`, `UInt32Buffer`, and `Float32Buffer` are fixed-size mutable
working memory for compact state and numeric datasets. They provide checked
indexing, independent `copy()`/`slice(start=0, end=size)` values, and `toBytes`;
multi-byte buffers require an explicit `ByteOrder`. Matching `*FromBytes`
functions restore them. Every value, size, slice bound, and index is checked, so
the API never inherits typed-array truncation, non-finite floats, or
out-of-bounds no-ops. Constructors and every runtime `Type.is`/`Type.parse`
boundary enforce one 64 MiB byte ceiling before scanning or copying a typed
array. The compiler emits direct specialized index operations rather than
routing these types through reactive Lists or ordinary methods.

`UInt32Builder` and `Float32Builder` grow only up to their required
`maxElements`; `push(value)` rejects overflow and `finish()` returns one exact
fixed buffer and seals the builder. Safe JavaScript declarations map
`Uint8Array` and Node `Buffer` results to read-only `Bytes`, `Uint16Array` to
`UInt16Buffer`, `Uint32Array` to `UInt32Buffer`, and `Float32Array` to
`Float32Buffer`. A JavaScript `Uint8Array` parameter accepts either `Bytes` or
`UInt8Buffer`; no `Buffer`-specific API enters source.

```velar fragment
import {ByteOrder, Bytes, uint16Buffer, uint16FromBytes} from "velar/binary"

const values = uint16Buffer(4096)
values[0] = 7
const snapshot: Bytes = values.toBytes(ByteOrder.little)
const restored = uint16FromBytes(snapshot, ByteOrder.little)
assert restored[0] == 7
```

`velar/random` creates a deterministic `Random` from a string or safe-integer
seed. Its `number()`, `int(start, end?)`, `bool(probability=0.5)`, `pick(values)`,
`shuffle(values)`, and `fork(label)` operations have identical Node/browser
results. A fork derives an independent stream from the original seed and label;
it does not consume or couple itself to the parent's current position.

`velar/task` owns structured asynchronous work. `task(work, parent?)` passes a
`Cancellation` into `work`, propagates a parent cancellation, and returns an
owned `Task<T>`. `cancel(reason?)` requests cancellation and waits for the work
to finish; CPU-heavy work cooperates with `await cancellation.checkpoint()`.
`withTimeout(task, duration)` cancels the underlying task before it rejects with
`TaskTimeoutError`. A `using` Task cancels and joins automatically on every exit.

## Workers and pull-based WebSockets

`velar/worker` uses entries declared in `velar.json`:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "workers": {"processor": "src/data-worker.vel"}
}
```

`worker(name, RequestType, ResponseType, capacity=64)` starts one worker;
`workerPool(name, RequestType, ResponseType, size, capacity=64)` starts a bounded
pool. Both expose `call(request, cancellation?, timeout?)` and `close()`. A
worker entry calls `serveWorker(RequestType, ResponseType, handler,
capacity=64)`. Runtime Types validate both directions. Full-storage `Bytes` and
fixed numeric buffers are found inside bounded, cycle-safe List/Map/record
graphs. `call` first isolates any caller-owned transferable storage, then
transfers the snapshot's deduplicated backing buffers; the caller's values are
never detached implicitly. Queue capacity supplies backpressure, and a crash
rejects every pending call with one stable worker error identity. The
implementation selects browser Worker or Node `worker_threads`; source never
handles native URLs or ports.

`velar/websocket` exposes `connect(url, options?)` on Node and Web, plus Node
`listen(options)`. A `WebSocketConnection` sends `string | Bytes`, and its
`next() -> Promise<(string | Bytes)?>` is consumed directly or with `async for`.
`send` resolves only after the bounded pending-byte budget drains. Connection,
message, send, accept, unread-message count, and aggregate unread-byte limits
fail explicitly. `maxQueuedBytes` defaults to 16 MiB on Node and Web. `listen` may
receive the same typed HTTP handler as `velar/serve`, so HTTP and upgrade traffic
share one port. A normal close leaves accepted messages available to `next()`
until the queue drains to EOF; receive-limit and protocol failures clear it
immediately. Connections and servers are owned resources for `using`.

## Binary codecs and noise adapters

The official adapters deliberately expose small stable Velar surfaces over
mature packages: `velar/msgpack` uses `msgpackr`, `velar/compression` uses
`fflate`, and `velar/noise` uses `simplex-noise`.

- MessagePack provides `encode(value) -> Bytes`, `decode(bytes) -> unknown`, and
  `parse(bytes, Type) -> T`.
- Compression provides bounded `deflate`/`inflate` and `gzip`/`gunzip` Bytes
  operations. Decompression feeds `fflate` dynamically sized compressed-input
  slices and aborts on the first output callback that would cross `maxBytes`.
  Small default-limit payloads do not reserve 64 MiB, and rejected streams do
  not consume or compute their remaining compressed tail.
- Noise provides seeded `simplex2`, `simplex3`, and `simplex4` functions whose
  results are deterministic across supported targets.

These modules are the supported contract. Their npm packages and complex
TypeScript generics are implementation details, not a second public API.

## `Text.` (permanent, no import)

Common string operations are checked members: `size`, `trim`, `upper`, `lower`,
`slice`, `char`, `has`, `index`, `count`, `startsWith`, `endsWith`, `isBlank`,
`split`, `replace`,
`replaceAll`, `repeat`, `padStart`, and `padEnd`. The compiler lowers them to
bounded helpers rather than trusting JavaScript prototype methods. They support
named arguments and first-class binding exactly like collection methods.

`size`, `char(index)`, `slice(start=0, end=size)`, and the positions returned by
`index(text, start=0)` use Unicode code points,
matching string iteration rather than JavaScript UTF-16 units. Negative
positions count from the end, out-of-range `char` returns `null` while a
non-integer index throws, and slice
positions clamp. `index` also clamps its start and returns `null` when no match
exists. `text.has(part)` and `part in text` are the method and operator forms of
the same substring test. Direct string indexing stays absent.

The `Text.` namespace is the extension toolbox beside those core methods: it
needs no import, and nothing moves between the two, so the member list a reader
must hold in mind never grows. It carries the transformations that are not
simple receiver operations: `Text.trimStart`, `Text.trimEnd`, `Text.capitalize`,
`Text.title`, `Text.lines`, `Text.lineStarts`, `Text.chunks`, `Text.words`,
`Text.slug`, `Text.normalize`, `Text.truncate`, `Text.indent`, `Text.dedent`,
`Text.normalizeWhitespace`, `Text.utf8Size`, `Text.escapeHtml`,
`Text.codePoint`, and `Text.fromCodePoint`. Blank text is tested with the
`text.isBlank()` member — `true` for empty or whitespace-only text.
`Text.utf8Size(text)` returns the exact byte count used
by official UTF-8 transport, JSON, and filesystem budgets, including stable
three-byte treatment of an unpaired surrogate. `Text.lineStarts(text)` performs one
bounded scan and returns `[0, ...]` Unicode code-point offsets immediately after
each line-feed character, including the final text size when the text ends in a
line feed. This keeps large-file line indexes out of repeated `.char(index)`
lookups without exposing JavaScript UTF-16 units. `Text.chunks(text, size)` performs
the same single bounded code-point scan and returns non-empty pieces of at most
`size` code points; it never splits a surrogate pair, and an empty input returns
an empty List. Stateless pattern operations are `Text.matches`, `Text.findMatch`,
`Text.findMatches`, `Text.replaceMatches`, and `Text.splitPattern`.

`Text.title` treats separators as word boundaries. `Text.truncate` reserves room
for its suffix. `Text.slug` lowercases Unicode text, removes punctuation, and
joins word runs with `-`; it does not transliterate non-Latin text.
`Text.normalize(text, form="NFC")` applies one of the four Unicode
normalization forms — `"NFC"`, `"NFD"`, `"NFKC"`, or `"NFKD"`; any other form
throws `RangeError`. Text equality is code-point-sequence identity, so
canonically equivalent text is not equal: a precomposed accented character and
the letter plus its combining accent render identically but compare unequal,
report different `size`, and miss each other as Map and Set keys. Normalize
where such text enters the program — macOS filenames arrive decomposed while
typed text is usually composed.
`Text.escapeHtml` escapes text for HTML content and attribute contexts but does
not mark it as trusted HTML. `Text.codePoint(character)` answers the code point
of exactly one character and `null` for anything else — empty text, several
characters, or a lone surrogate half; `Text.fromCodePoint(value)` is its inverse
and throws `RangeError` for a value outside `0`–`1114111` or inside the
surrogate range, so no call can build text that is not a sequence of characters.

Pattern expressions use JavaScript pattern syntax in Unicode mode through a
captured intrinsic implementation, not a replaceable ambient `RegExp` global.
Each operation creates a fresh pattern; source code never receives `RegExp` or
its mutable `lastIndex`. Options are copied from one typed data record containing only optional
`ignoreCase`, `multiline`, and `dotAll` booleans. `findMatch` returns
`{value, index, groups}` or `null`; `index` is a Unicode code-point position, so
it can be passed directly to `char` or `slice` without leaking JavaScript UTF-16
offsets. `Text.findMatches` returns all such records and
normalizes an unmatched capture to `null`. `Text.replaceMatches` replaces every
match with one literal string, and `Text.splitPattern` omits capture groups from
the result. Invalid patterns throw `TypeError` at the VelarScript boundary.

Pattern source is limited to 4,096 code units, pattern input/output and returned
match text to 16 MiB, and list-producing pattern operations to 1,000,000 results.
Matches are copied from checked data fields, empty Unicode matches always make
code-point progress, and replacement size is checked before the final string is
allocated. Patterns
are application code, not a sandbox for executing arbitrary user-supplied
regular expressions; applications that accept search text should use the
literal `.has()`/`.startsWith()`/`.endsWith()` operations unless they deliberately
own a pattern grammar.

Text counts used by `.repeat`, `.padStart`, `.padEnd`, and `Text.truncate` are
non-negative safe integers; native string-to-number coercion is not exposed.
Dynamic pattern options must be plain enumerable data fields, so getters,
symbols, and class instances are rejected without hidden evaluation. Text
composition such as `.replace`, `.replaceAll`, `Text.escapeHtml`, and
`Text.indent` check
its complete output budget before allocating the final string.

The compiler-owned String runtime and the `Text.` runtime capture their string, array,
numeric, reflection, RegExp, iterator-independent Unicode, and Error operations
when the module initializes. Pattern replacement and splitting are driven by the
captured native `exec` operation instead of mutable RegExp symbol hooks. Later
changes to JavaScript globals, prototypes, or string/array iterators therefore
cannot redirect a checked text operation.

```velar
const valid = Text.matches("VelarScript 42", "^velar [0-9]+$", {ignoreCase: true})
const ticket = Text.findMatch("ticket-42", "[0-9]+")
const fields = Text.splitPattern("one, two; three", " *[,;] *")
const initial = "Ada".char(0)
const short = "VelarScript".slice(0, 5)
print(f"{initial ?? "?"}:{short.size}")
```

## `Math.` (permanent, no import)

The namespace exposes JavaScript Number mathematics without claiming Python
integer or decimal behavior. Every operation nevertheless requires an actual
`number` at runtime; the JavaScript `Math` global's coercion cannot turn `"2"`,
`[]`, or another dynamic JavaScript value into a VelarScript number.

What belongs on a number is a number method, so what is left here is exactly
what cannot be one: the constants, the multi-argument functions, and the
transcendentals.

| Group | Members |
| --- | --- |
| Constants | `pi`, `e`, `tau`, `infinity` |
| Bounds | `min`, `max`, `clamp`, `sign`, `trunc` |
| Powers and logarithms | `sqrt`, `cbrt`, `pow`, `exp`, `log`, `log2`, `log10` |
| Trigonometry | `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `degrees`, `radians` |
| Numeric helpers | `hypot`, `random`, `randomInt`, `gcd`, `lcm` |

The receiver-shaped operations are number members: `.abs()`, `.round()`,
`.floor()`, `.ceil()`, `.toFixed(digits)`, and the predicates `.isInteger()`,
`.isNaN()`, and `.isFinite()`. `round` returns a number at the
nearest integer; `toFixed` returns decimal text with 0 through 100 digits;
`isInteger` follows `Number.isInteger`, so `Infinity` and `NaN` are not
integers.
These members use a compiler-owned Number runtime that captures their Math,
Number, reflection, and Error operations when the generated module initializes;
later replacement of JavaScript globals or prototypes cannot redirect them.
`randomInt` uses an inclusive lower and exclusive upper safe-integer
bound; with one argument its lower bound is zero. `gcd` and `lcm` likewise own
safe integers, and `lcm` rejects an inexact result. Randomness is the host
JavaScript runtime's `Math.random` and is not cryptographically secure. Its
result is checked as a finite number in the native `[0, 1)` range before either
random API returns a value. The numeric constants, mathematical operations,
random source, numeric predicates, Reflect invocation, and error constructors
are captured when `velar/math` initializes. Replacing `Math`, `Number`, their
methods, or the ambient error constructors afterward cannot redirect an
already initialized module; a host that supplies a missing/accessor-backed
operation or an invalid random result fails explicitly.

## `Json.` (permanent, no import)

| Export | Behavior |
| --- | --- |
| `parse` | Parses JSON; an optional VelarScript `type` validates and types the result. |
| `tryParse` | Returns a validated value, an explicit fallback, or `null`. |
| `stringify` | Strictly serializes JSON data with an optional compact/indent setting. |
| `stableStringify` | Strictly serializes while recursively ordering record keys. |
| `clone` | Strictly JSON-clones a value and optionally validates the result with a VelarScript `type`. |
| `isSerializable` | Reports whether a value is losslessly representable as JSON data. |

Content comparison is one concept with one spelling: the prelude `equals(a, b)`
(charter section 4). It needs no import, requires its operands to intersect
statically, rejects class instances, functions, Promises, and unvalidated
`unknown`/`any` at compile time, compares Set members and Map keys structurally
rather than by reference, agrees with `==` on `NaN`, and throws on a cycle
rather than answering a quiet `false`.

Strict JSON is a compiler-owned runtime shared by Core and platform consumers.
It captures parsing/serialization, Array/Set traversal, reflection and data
descriptors, numeric/text/path operations, allocation, Reflect invocation, and
error constructors when the generated module initializes. `stableStringify`
uses that same captured sort operation. Replacing ambient globals or prototypes afterward
cannot redirect validation, snapshots, cloning, ordering, or equality. The
versioned reactive registry remains the one explicit dynamic seam used to
unwrap tracked values before JSON inspection.

Every member above is a permanent Core namespace member: JSON handling is pure
computation, so no `Json.*` call needs an import and named imports from
`velar/json` are retired with a diagnostic that teaches the namespace spelling.

```velar fragment
type User:
    id: string
    name: string

const user = Json.parse(source, User)
const unchanged = equals(user, previousUser)
```

The second argument is the existing runtime form of a record `type`, a runtime
transparent alias, or an `enum`; there is no parallel schema declaration. The
compiler registers those frozen Type values under one shared runtime identity,
including when they cross module boundaries. `parse`, `tryParse`, and `clone`
check that identity before parsing or cloning and never inspect an arbitrary
object's `is` or `parse` fields as permission to skip validation.

JSON data is deliberately narrower than arbitrary JavaScript values: it
contains finite numbers, strings, booleans, `null`, dense Lists, fixed records,
and `Record<T>` dynamic string-key records recursively. Map, Set, class
instances, functions, sparse Lists,
accessor/symbol fields, non-finite numbers, and cyclic graphs are rejected
instead of inheriting `JSON.stringify`'s silent field omission or `{}` / `null`
substitution. Known unsupported VelarScript types fail checking; `unknown` and unsafe
JavaScript values are validated at runtime. Repeated references are allowed
when the graph is acyclic. Indentation is `false`, `true` (two spaces), or an
integer from 0 through 10.

Parsing and encoded output are limited to 16 MiB. Validation stops beyond
1,000,000 values or 128 nested collections, checks array data descriptors
without invoking getters, and estimates pretty-print expansion before calling
the host serializer. Serialization and cloning operate on the data-descriptor
snapshot created during that same validation pass, so a Proxy or List subclass
cannot present one value for validation and a different value to the serializer.
Parsed host results are copied through the same boundary, and the serializer's
return value must be actual text.

## `Promise.` (permanent, no import)

| Member | Behavior |
| --- | --- |
| `sleep` | Resolves after a non-negative `Duration` (`250ms`, `1s`). |
| `all` | Awaits a `List` of Promises to a `List` of results, or a **record** of Promises to a record of the same shape. A List whose elements resolve to different types is rejected in favour of the record form, so every result keeps a name. |
| `race` | Settles with the first Promise in a List to settle. A runtime-empty `race` List throws `RangeError("race requires at least one Promise")` — an empty race would never settle. |
| `timeout` | Rejects if a Promise does not settle before a `Duration`; accepts an optional message. |
| `retry` | Runs a zero-argument sync/async task again after failure, up to the retry count, waiting an optional `Duration` between attempts. |
| `map` | Maps a list with a sync/async worker and optional positive concurrency limit while preserving result order. |
| `series` | Runs a list of zero-argument sync/async tasks sequentially. |

`Promise.` is always in scope. Both spellings that reach these members through
`velar/async` — the named import and the namespace import — are retired and
receive a diagnostic that teaches the namespace spelling.

These helpers use the host Promise queue. They do not create threads, cancel a
Promise, or replace the JavaScript event loop. Their List arguments use the
same dense List validation as collection helpers; concurrency counts are
positive safe integers. `all`, `race`, and `timeout` require actual Promises at
runtime, including across JavaScript realms; arbitrary thenables are rejected
without probing a `then` accessor. The module snapshots the Promise, timer,
numeric-validation, reflection, and dense-List operations it needs when the
module initializes. Later ambient replacement and List subclass overrides
cannot redirect its work. Retry attempts are positive safe integers and timeout
messages remain real strings at dynamic boundaries. `all` and `race` may start
at most 10,000 operations at once, `map` concurrency is at most 1,024, retry is
at most 10,000 attempts, and timer durations stay within the signed 32-bit host
timer range.

Short asynchronous workers use the language's expression arrow directly, for
example `await Promise.map(urls, async url => await load(url))`. Its inferred result is
`Promise<T>`; ordinary synchronous callbacks and named `async def` workflows
remain available for expression and block bodies respectively. All async forms
share native Promise adoption: a named async worker declared `-> T` may return
either `T` or another `Promise<T>` without adding `return await` merely to
satisfy the checker. JavaScript reserves a resolved value's top-level `then`
member, so `retry` cannot return a record/class with callable `then` or a class
with a `then` getter; the compiler rejects known cases and the runtime fails
closed at a dynamic callback. `map` and `series` may still collect those values
as ordinary List elements because their Promise resolves to the containing
List, not to an individual element, and their sync callback path never probes
the element's `then` member.

## `velar/url`

| Export | Behavior |
| --- | --- |
| `parse` | Returns `href`, protocol/host fields, path, query `Map`, hash, and origin; accepts an optional base. |
| `join` | Joins one or more string URL/path segments without duplicate separators while preserving a leading `scheme://`. |
| `query`, `parseQuery` | Convert an object/Map to a query string or a query string to `Map<string, string>`. |
| `withQuery`, `withHash` | Return a URL/path with a replaced query or hash. |
| `isExternal` | Compares a URL with an optional base/current location origin. |
| `encode`, `decode` | Encode or decode one URL component. |
| `normalize` | Resolve and normalize a URL/path with an optional base. |

Query names are strings. Values are explicit string/number/bool scalars,
`null`, or dense Lists of those scalars; records/classes/functions are rejected
instead of becoming `"[object Object]"`. `null` values are omitted, List values
produce repeated keys, and duplicate parsed keys keep their last value in the
returned `Map`. Query numbers must be finite. URL text operations validate
actual strings at dynamic boundaries rather than inheriting JavaScript
`String(...)` coercion; this includes the browser's current base URL and every
field copied from a native `URL` result. URL text and encoded query output are
limited to 2 MiB; component encoding and multi-part joining check the resulting
length before allocation. Normalization and query/hash replacement likewise
budget every native URL fragment before concatenating the returned relative or
protocol-relative text. Parsed names/values share the same text budget, and
query maps contain at most 100,000 fields.

The URL and URLSearchParams constructors and prototype operations, Map
brand/iterator operations, component codecs, numeric/text/reflection helpers,
error constructors, and browser location object plus its href reader are
captured when `velar/url` initializes. Replacing globals or prototypes afterward
cannot redirect an initialized module. A real captured browser Location still
reports later navigation changes; the contract fixes the capability source, not
the page URL value. Hostile URL text and query iterator results continue to fail
closed without invoking conversion hooks.

## `velar/time`

Time values are Unix epoch milliseconds, matching the host JavaScript runtime
without exposing mutable `Date` objects.

| Export | Behavior |
| --- | --- |
| `now` | Current Unix epoch milliseconds. |
| `monotonic` | Monotonic milliseconds for elapsed-time measurement. |
| `parse` | Parse deterministic ISO `YYYY-MM-DD` or a `T` datetime with `Z`/numeric offset to epoch milliseconds; return `null` for invalid text. |
| `iso` | Format epoch milliseconds as an ISO 8601 UTC string; defaults to `now()`. |
| `format` | Locale-format a time with optional locale and time-zone strings. |
| `date` | Construct local epoch milliseconds from strict year, month, day, and optional time fields. |
| `utc` | Construct UTC epoch milliseconds from the same strict fields. |
| `parts` | Return numeric year through millisecond parts in local time or an explicit time zone. |

`date` and `utc` reject out-of-range or nonexistent calendar values instead of
using JavaScript `Date` rollover (`2024-02-31` never becomes March). Years are
0 through 9999 and do not receive JavaScript's special 1900 offset for 0–99.
`parse` accepts date-only ISO as UTC midnight; a datetime must include `Z` or a
numeric offset, which keeps results identical across JavaScript engines and
host time zones. Non-ISO/native locale text is deliberately unsupported.
Locale and named-time-zone arguments must be actual strings.
Returned timestamps are checked as finite values inside JavaScript's supported
date range. Host clock and internationalization results are validated before
they cross back into VelarScript: invalid clocks, non-string formatting output,
missing/duplicate time-zone parts, accessors, and impossible calendar fields
fail explicitly rather than leaking `NaN` or guessed values through the typed
API. A time-zone parts List has one bounded length snapshot, so a changing host
collection cannot extend validation midway. Formatted output is limited to
65,536 characters.

The wall and monotonic clocks, Date constructor and prototype operations,
internationalization constructor and formatting operations, numeric/text
helpers, result freezing, Reflect invocation, and error constructors are
captured when `velar/time` initializes. Replacing those globals or prototypes
afterward cannot redirect an initialized module. Invalid host clock and Intl
results are still checked at the operation boundary; locale and time-zone data
continue to come from the host rather than being snapshotted or reimplemented.

```velar
import {iso, now, parts, utc} from "velar/time"

const launched = utc(2026, 8, 1)
print(iso(launched))
print(parts(now(), "UTC").year)
```

Months are one-based. ISO parsing is owned and deterministic; locale formatting
and named-time-zone projection still use the host internationalization data.
VelarScript does not invent a second timezone database or datetime object model.
ISO input longer than 64 characters is invalid without entering the matching
engine. Locale and time-zone names are limited to 1,024 characters before the
host internationalization API is called. Explicit time-zone projection also
keeps astronomical year numbering (`1 BC` is year `0`), matching JavaScript
`Date` and the local `parts` result.

## `velar/id`

`uuid()` returns a cryptographically secure host UUID. It delegates to the
existing JavaScript host's `crypto.randomUUID()` and fails explicitly when that
capability is unavailable or returns a non-canonical result; it never falls
back to timestamps or `Math.random`. The capability must be a data method rather
than an accessor, and non-`Error` host failures are wrapped without invoking
conversion hooks. The crypto object, data method, matching operation, and error
identity are captured when `velar/id` initializes; replacing globals or
prototypes afterward cannot redirect generation or validation. `isUuid(value)`
checks canonical UUID text without changing it and rejects non-36-character
input before pattern matching.

```velar
import {isUuid, uuid} from "velar/id"

const taskId = uuid()
print(isUuid(taskId))
```

## `velar/log`

Structured logging replaces direct source-level access to `console` while
remaining on the existing JavaScript runtime.

```velar fragment
import {LogRecord, logger, setLevel, useSink} from "velar/log"

def sendRecord(record: LogRecord):
    postToCollector(record.scope, record.level, record.message)

component BuildStatus:
    const buildLog = logger("build")
    const stopCapture = useSink(sendRecord)

    @mounted:
        setLevel("debug")
        buildLog.info("Compilation ready")

    @cleanup:
        stopCapture()

    return <p>Ready</p>
```

- `log` is the unscoped logger; `logger(scope, fields=Map())` creates a scoped
  logger with optional base fields. Scope/message/field names remain actual
  strings at dynamic boundaries; logging never calls ambient `String(...)` on
  invalid input.
- Loggers provide `debug`, `info`, `warn`, and `error`. Fields are
  `Map<string, unknown>` values; `error` optionally receives an `Error` and
  additional fields.
- `setLevel` accepts `debug`, `info`, `warn`, `error`, or `silent`; `level`
  returns the current threshold.
- `useSink(sink)` redirects records while at least one custom sink exists and
  returns an explicit cleanup function. The record it hands a sink is
  `LogRecord`, a published type name: `timestamp`, `level`, `scope`, `message`,
  `fields`, and an optional `error`. A sink is therefore either a named `def`
  with an annotated parameter, as above, or an arrow that `useSink` types
  contextually — the same choice `velar/serve` gives a handler through
  `ServeRequest`.
- `LogRecord` is a runtime value as well as a type name, so `LogRecord.is(value)`
  answers whether a value is a record and `LogRecord.parse(value)` validates one
  at a dynamic boundary. That is the surface `velar/fs` publishes for
  `FileWatchBatch`.
- Each sink receives its own fields snapshot, so mutation inside one callback
  cannot rewrite what another sink observes. The optional error is either an
  actual `Error` or `null`. Rejections from an actual Promise returned by a sink
  are reported internally; arbitrary objects are not treated as thenables and
  their `then` accessors are never probed.
- One logger accepts at most 1,000 merged fields, field names are limited to
  1,024 characters, messages to 64 KiB, scopes to 1,024 characters, and an
  application may install at most 1,000 sinks. These limits are checked before
  dispatch; native Map iteration is used without invoking subclass overrides.
- Record timestamps are accepted only when the host clock returns a finite
  value inside JavaScript's date range. The fallback console must expose data
  methods; logging will not execute accessor properties to discover a writer.
- Without a custom sink, the runtime writes through the host console internally.
  VelarScript source still receives no `console` global. Sink failures fall back to
  the internal host logger and cannot recursively invoke the failing sink.
- The clock, collection operations, Promise rejection observer, string
  normalization, error identity, and fallback console writers are captured when
  `velar/log` initializes. Ambient replacement afterward cannot redirect log
  delivery; `setLevel` and `useSink` are the explicit customization points.
- VelarScript never uploads logs or telemetry automatically.

## Local platform modules

Standard API 0.5 adds a small first-party surface for local applications and
servers. Node is the current internal engine, but Node classes, callbacks,
events, buffers, and overloads are not part of the VelarScript contract. These
modules work under `velar run`, Core tests, and Core builds. A Web project that
imports a Node-only module fails during project compilation; `velar/serve`
points Web code to the application dev server and the browser target of
`velar/http`. Their contracts and implementations are owned by the
independently reusable `@velarscript/node` package; the CLI only composes that
extension for local programs.

**Errors these modules raise.** Only `velar/fs`, `velar/serve`, and
`velar/http` name their own error classes, because only their failures have
more than one recovery. Every failure of `velar/path`, `velar/process`,
`velar/env`, `velar/host`, and `velar/terminal` — a wrong argument, an exceeded
budget, an unusable host — has exactly one recovery, which is to change the
code, so each arrives as an ordinary `Error`. A class exists only where a
caller would write different recovery for it.

### `velar/serve`

`serve(handler, port, host="127.0.0.1")` binds an HTTP server and resolves to a
`Server` record containing the actual `port` and an idempotent async `stop()`.
The handler receives a `ServeRequest` with method, decoded URL path, first-value
query and normalized header Maps, plus cached async
`text(maxBytes=16777216)` and `json(maxBytes=16777216)` body readers. The first
read enforces its byte budget while the request arrives, before accumulating a
larger body; a later read may impose a smaller budget on the cached body.
`parse(Type, maxBytes=16777216)` applies `json()` and then validates the result
with a compiler-known VelarScript runtime Type, returning `Promise<T>` with the
same inference and callable-`then` rejection as `velar/http`. The Type identity
is checked before any body read, so an invalid or forged Type cannot consume the
request stream.
**Errors it raises.** `serve` reports a port already bound as
`AddressInUseError` (bind another port, or `0` for any free one) and a port the
host refuses as `PermissionError`; both are nameable Core classes that need no
import. Budgets are positive integers up to the 16 MiB hard ceiling. Exceeding the
application budget throws `RequestBodyTooLargeError`, whose read-only
`maxBytes` field lets a handler return 413 without matching error text. Request
text must be valid UTF-8. `json()` then applies the same finite, bounded,
accessor-free JSON contract as `velar/json` and every `velar/http` target;
native `JSON.parse` values such as an overflowed `1e400` never enter Vel as
`Infinity`.

```velar fragment
import {RequestBodyTooLargeError, ServeRequest, ServeResponse, fileResponse, serve} from "velar/serve"

type MessageInput:
    text: string

async def handle(request: ServeRequest) -> ServeResponse:
    if request.path == "/api/health":
        return {status: 200, json: {ok: true}}
    if request.path == "/api/message":
        try:
            const input = await request.parse(MessageInput, maxBytes=65536)
            return {status: 200, text: input.text}
        catch error:
            if error is RequestBodyTooLargeError:
                return {status: 413, json: {error: "Request body is too large"}}
            throw error
    return fileResponse(root="dist", path=request.path, fallback="index.html")

const server = await serve(handle, port=8787)
```

A response is one checked plain record body:

- `{status, json, headers?}` serializes bounded, finite, acyclic JSON data
  without invoking getters or `toJSON` hooks;
- `{status, text, contentType?, headers?}` sends at most 16 MiB of UTF-8 text;
- `{status, stream, headers?}` runs an async producer whose awaited `write`
  accepts at most 1 MiB per chunk and 64 MiB in total. `write` follows transport
  backpressure and rejects if the client connection closes, so a producer can
  release its upstream request in `finally` instead of remaining suspended.

The exported `ServeRequest`, `ServeResponse`, and `Server` runtime types inspect
only enumerable own data fields. Type checks and response dispatch never invoke
getters, symbol hooks, `toJSON`, overridden collection methods, or sparse List
entries. Server JSON responses reuse the compiler-owned strict JSON snapshot
instead of maintaining a weaker serializer beside it.

The application-facing module never owns a Node HTTP server or request stream.
It exchanges bounded request/response commands with the same private isolated
Node host used by `velar/fs`; only that Worker imports `node:http`,
`node:fs/promises`, and Node stream machinery. Its port is unreferenced while
idle and referenced while an operation is pending or a server is active. Live
server and request identities are bounded and collision-free across handle
wraparound. Per-value limits do not multiply without bound under concurrency:
the Worker has one 128 MiB aggregate budget for cached request bodies, static
files, buffered text/JSON responses, and in-flight stream chunks. Completion
and disconnect return stable request ownership only after concurrent host
operations settle; a stream write owns a separate temporary reservation until
its flush or failure. This private compiler dependency is materialized
transitively and cannot be imported as a Standard API module.

Transport-owned headers cannot be overridden. Handler failures are reported to
stderr and return an opaque `500 Internal server error`; no development stack
is disclosed. `fileResponse(root, path, fallback=null)` resolves the real root
and target, rejects decoded traversal/backslashes/symlink escape, reads only
regular files up to 64 MiB, and owns the static content-type table. The optional
fallback goes through the identical containment and size checks.

### `velar/fs`

| Export | Behavior |
| --- | --- |
| `readText(path, maxBytes=16777216)` | Reads one valid UTF-8 regular file under an explicit byte budget. |
| `createText(path, text)` | Atomically creates one new UTF-8 file and refuses every existing entry, including symbolic links. |
| `replaceTextIfMatches(path, expected, replacement)` | Replaces a matching UTF-8 file as one complete directory-entry commit and reports a detected conflict as `false`. |
| `writeText(path, text)` | Writes at most 16 MiB of UTF-8 text. |
| `appendText(path, text)` | Appends at most 16 MiB of UTF-8 text. |
| `exists(path)` | Resolves to `false` only for a missing path; permission and host failures remain errors. |
| `list(path, maxItems=100000)` | Returns a sorted, caller-bounded List with at most 2 MiB of name text. |
| `info(path)` | Returns bounded `{name, kind, size, modifiedAt}` metadata, or `null` when absent. |
| `canonical(path)` | Resolves the host real path for containment and identity checks. |
| `makeDirectory(path)` | Creates the requested directory and missing parents. |
| `copyFile(source, target, replace=false)` | Copies one regular file; replacement is explicit. |
| `move(source, target, replace=false)` | Moves one path; replacement is explicit. |
| `removeFile(path)` | Removes one file and never recursively removes a directory. |
| `watchFiles(path, recursive=false)` | Creates a bounded, resource-owned invalidation watcher for one existing file or directory. |
| `FileWatcher.next()` | Pulls one sorted/deduplicated `FileWatchBatch`, permits only one active pull, and returns `null` after release. |
| `FileWatcher.close()` | Idempotently releases the watcher and settles a pending pull with `null`. |

**Errors it raises.** A failure a caller recovers from differently arrives as
its own class (charter section 11): `FileNotFoundError` when the path is
absent, `PermissionError` when the host denies access, `NotADirectoryError`
when a path component or a `list` target is a file, and `FileExistsError` when
`createText`, `copyFile`, or `move` would overwrite without `replace`. Each
carries the failing `path: string?`. Every other failure — a wrong argument
type, an exceeded budget, an unusable host — stays an ordinary `Error`.

Paths are non-empty, NUL-free strings of at most 4,096 code units. The module
has no synchronous forms, recursive deletion, byte inspection, callback event
surface, or public filesystem streams. `FileWatchBatch` contains an ordinary
`List<string>` named `paths` and a `rescan` flag. It is deliberately an
invalidation stream rather than a lossless mutation log: paths are bounded,
absolute, sorted, and deduplicated; an unknown native filename or exhaustion of
the 4,096-path/2 MiB queue becomes `{paths: [], rescan: true}`. Each host owns
at most 128 watchers. Native failure is terminal, and callers explicitly close
the watcher when its consumer stops.

**A watcher reports only the changes that happen after it is armed.**
`watchFiles` resolves when the request is accepted, not when the host has
finished arming its native stream, and the stream begins at the moment arming
completes. A change written between those two points can therefore never
arrive — measured on macOS FSEvents under load, 4 of 40 notifications were
lost, one with a 25-second window. This is the real semantics of every
filesystem watcher, so the module states it rather than pretending to erase it.
If you need to observe a change you are about to make, **write first and then
start watching**, or query the state on both sides of the write. A watcher is
for changes another actor makes; it is not a delivery receipt for your own.
`createText` is the no-clobber primitive for generated files, approvals, and
other check-then-create workflows. Its exclusive-create decision and file
creation are one host operation; callers must not emulate it with
`exists`/`info` followed by `writeText`, because another actor can occupy the
entry between those calls.
`replaceTextIfMatches` is the optimistic edit primitive. File mutations that
address the same canonical target through one runtime host participate in one
coordination queue. After an exact byte match, a same-directory temporary file
is renamed over the target so readers observe the old or new complete contents,
never a partial replacement. A mismatch returns `false` without writing. This
contract does not pretend to be a portable operating-system CAS: an unrelated
process that bypasses this API can still write between comparison and rename,
and applications that coordinate such processes need their own shared lock or
repository transaction.
Node initializes the module's path, number, UTF-8 encoder/decoder, typed-byte,
Promise, reflection, and immutable-result operations once. It validates and
assembles only Velar values in the application Realm, then delegates filesystem
effects to the private isolated Node host shared with `velar/serve`. Only that
Worker imports `node:fs/promises` and callback `node:fs` watcher machinery;
later replacement of application-Realm
filesystem modules, `Promise.prototype.then`, typed-array sizing, or captured
validation operations cannot redirect the public API.

Desktop applies two distinct symlink rules. Content operations such as read,
write, append, copy, list, and canonicalization follow the target only after
its real path remains inside a granted root. Entry operations such as `info`,
`move`, and `removeFile` operate on the final directory entry itself, so
removing or moving an in-root symlink never mutates its target. A dangling
symlink cannot be reclassified as an absent write target. Recursive
`makeDirectory` authorizes the nearest existing ancestor, permits only
in-root intermediate links, and refuses a final symlink target.

### `velar/path`

`resolve(parts=[])`, `join(parts=[])`, `normalize`, `relative`, `dirname`,
`basename`, `extension`, and `isAbsolute` expose checked host-path operations;
multi-part operations take a dense `List<string>` of enumerable data values.
Every input path and every public path result is limited to 4,096 code units;
many individually valid parts cannot manufacture an oversized result.
On the current macOS Desktop target these operations use the same POSIX lexical
semantics as the Node target on macOS. In particular, `dirname`, `basename`, and
`extension` inspect the supplied path rather than normalizing `.` or `..` away
first, while `normalize`, `join`, `resolve`, and `relative` perform their named
normalization steps. The two targets are kept aligned by a differential corpus
covering duplicate separators, dot segments, hidden names, trailing separators,
absolute paths, and relative pairs.
`contains(root, target)` performs a
lexical containment check suitable for the first gate of a workspace policy;
code that crosses symbolic-link authority also checks `velar/fs.canonical`
before granting access.
`toFileUrl(path) -> string` resolves a path and returns its encoded local `file:`
URL. `fromFileUrl(url) -> string` performs the inverse operation for a local file
URL and rejects other schemes; Desktop additionally rejects credentials, ports,
queries, fragments, non-local hosts, and encoded path separators. These functions
are the public boundary between filesystem paths and LSP/document identifiers, so
applications do not reproduce percent encoding or platform URL rules.

### `velar/process`

`start(command, args=[], options={}) -> Promise<Process>` and
`run(command, args=[], options={}) -> Promise<ProcessResult>` execute one
program directly, without a shell. Options may set `cwd`, an explicit `env`,
UTF-8 `stdin`, `timeout`, and `maxOutputBytes`. A child receives only the
runtime's small safe environment baseline plus the explicit map; the parent
environment is not copied wholesale, so unrelated API keys cannot leak by
default. `Process` exposes read-only `pid`, pull-based `next()`, terminally
idempotent `wait()`, and `stop()`. Each successful pull returns
`{channel: ProcessOutputChannel, text: string}`; the official enum has
`stdout` and `stderr` members. A process therefore uses the language's normal
asynchronous iteration protocol rather than a callback or JavaScript iterator:

```vel
import {ProcessOutputChannel, start} from "velar/process"

const child = await start("git", ["status", "--short"])
async for output in child:
    if output.channel == ProcessOutputChannel.stdout:
        print(output.text)
const result = await child.wait()
```

Chunks preserve the order in which stdout and stderr data is observed by the
host. Each channel has its own incremental UTF-8 decoder, so a code point split
across native chunks is never exposed as replacement fragments. Only one
`next()` pull may be active. Incremental output must be drained before
`wait()` starts; calling `wait()` directly remains the explicit aggregate-only
path. After `stop()`, callers obtain the terminal capture through `wait()`
rather than starting a new output read.
`stop()` is idempotent after confirmation and retryable after rejection. A stop
request permanently closes incremental output for that handle, but a transport
failure or an unconfirmed termination does not discard the handle or cache one
rejected stop Promise. The Node host sends SIGTERM, escalates to SIGKILL after
two seconds, and rejects after a five-second confirmation deadline if inherited
pipes or an escaped descendant still prevent `close`; a later `stop()` retries
forced termination against the same owned handle. Desktop applies the same
retry contract across its bounded capability bridge.
`wait()` follows the same ownership distinction. A confirmed result or process
failure is terminal, releases the host handle, and is cached for later calls.
A bridge failure or a five-second failure to confirm termination leaves the
handle owned, clears only that in-flight `wait()` Promise, and permits a later
`wait()` or `stop()` to retry. A later wait after a retained outcome reissues
forced termination before starting a new confirmation window. Concurrent waits still coalesce into one host
request. The host uses a private `{result,error,retained}` envelope to preserve
that distinction; it is not a VelarScript value. `run()` cannot return its
temporary `Process` owner to application code, so a non-terminal wait failure
transfers that owner to a runtime cleanup task which keeps retrying `stop()`
until the host confirms release. A convenience call therefore cannot orphan a
child merely because its bounded error was already reported to the caller.
If `wait()` and `stop()` race, a confirmed Stop outcome replaces the stale
in-flight wait cache. The original wait caller still observes its own Promise,
while every later wait receives the confirmed terminal result instead of an
unknown-handle transport artifact.
If the root process exits without an explicit `stop()` but inherited output
pipes remain open, the host owns a separate bounded drain phase. It terminates
the original process group, escalates after two seconds, and allows five
seconds for stdout/stderr to close. A pipe still held by an escaped descendant
is then closed at the host read end and becomes one terminal process error;
`next()`, `wait()`, and the `run()` convenience therefore cannot hang forever
after the root has already exited. An explicit `stop()` cancels that automatic
pipe-abandonment path and retains the stronger retryable-owner contract above.
Node and Desktop preserve the same terminal process error through `stop()` and
the following `wait()` instead of treating a failed process as successful.
Process acquisition is asynchronous on every target so the same source
contract works for an in-process Node host and a capability-isolated Desktop
host.
Process option records are snapshotted only from enumerable own data fields;
accessors, symbols, inherited state, and unknown fields are rejected before a
child can start. Arguments and explicit environment data each have a 1 MiB
aggregate text ceiling in addition to their item-count limits.
The Node and Desktop targets initialize one shared process host ABI before
accepting application or bridge values. It captures the validation, reflection,
Map iteration, Promise, timer, and immutable-result operations used by this
contract, while both targets compose the compiler-owned captured UTF-8 sizing
runtime. Replacing those JavaScript globals or prototypes after module
initialization therefore cannot change process validation or result assembly.
Node child-process events and the Desktop worker transport remain target-owned
implementation boundaries rather than public VelarScript values.
The Node target initializes a dedicated process Worker before the official
module becomes available. That Worker loads only compiler-owned source and
Node built-ins, so application dependencies never share the Realm in which
`child_process`, streams, decoders, or Buffers execute. Its captured
MessagePort proxy is referenced only while a request is pending or a child is
running: importing `velar/process` alone does not keep a CLI alive, while an
unobserved active child still owns its lifecycle until it settles. At most 128
unreleased process handles may exist; callers release a settled handle through
`wait()` or `stop()`.
The Worker transfers each successful child handle and PID to its captured
application-side proxy before resolving `start()`. If the Worker hits an
uncaught internal failure, it stops accepting requests, force-drains every
owned child through the still-live `ChildProcess` handles, and exits only after
they settle or the fatal-drain deadline expires. The proxy records the first
host failure permanently, rejects both pending and later calls with that same
failure, and performs a bounded process-group kill fallback for already
transferred owners. It never posts a retry to a dead MessagePort.
The private filesystem/serve/HTTP Worker and terminal Worker use the same
permanent fail-closed rule. A clean or non-zero unexpected Worker exit is a host
failure; terminal failure is not disguised as ordinary end-of-input. These
Workers are not restarted inside the current application process: old process,
server, request, and terminal handles have no safe identity in a fresh Worker
generation. Restarting the application is the explicit authority and identity
reset.
Desktop navigation is a narrower boundary than application restart. Every
main-document bridge instance generates an unguessable private generation and
combines it with its page-local request number. The native shell translates
that pair to a host-global Worker request identity, so a response from a
destroyed document cannot settle a request whose counter restarted after
reload. Navigation retirement discards old responses and transfers no Process
or HTTP handles: the capability Worker stops the old document's processes,
aborts its HTTP bodies, and rejects cross-generation handle use. A filesystem
operation already committed by the operating system is not rolled back, but
its obsolete result is never delivered into the new document. The completion
hooks exposed for native response injection also require the private
generation, preventing application code from completing an arbitrary pending
bridge Promise by calling the hook directly.
The page bridge and native request ledger each enforce a 128 MiB aggregate
budget across pending serialized requests; response chunk assembly has the same
aggregate ceiling in addition to its per-response bound. A finite bridge
timeout sends a private cancellation for the exact generation/request pair
before rejecting the page Promise. Native code retains the Worker identity
until its terminal response, so a late response is discarded without becoming
an unknown-protocol failure. The Worker tracks active dispatches: cancellation
aborts an in-flight HTTP request and stops a hidden process owned by `run()` or
an as-yet-unpublished `start()`. Filesystem syscalls are not falsely described
as cancellable; their eventual result only releases the retained capacity and
is discarded. Closing the host input applies the same cancellation path before
any request that was awaiting process launch can publish a new child.
Standard output and error share a bounded capture budget, and no command-string
parsing or shell expansion is performed. Timeouts and output-bound failures
request termination and independently bound confirmation at five seconds even
if the operating system never emits `exit` or `close`; an unconfirmed handle is
retained rather than misreported as released. A started process controls its
ordinary descendant process group by default. A deliberately detached process
can escape that group, so an executable grant is not an OS sandbox; retained
ownership and bounded host-pipe closure make that limitation explicit instead
of silently losing the lifecycle.

### Node `velar/http`

Local programs use the same `http.request/get/post/put/patch/delete/head`
vocabulary as Web code. Requests expose `response`, `json`, `text`,
`streamText(consume)`, `parse(Type)`, and `cancel`; responses expose checked
metadata and the same body readers including `parse(Type)`. Typed parsing uses
the compiler-known runtime Type registry and returns `Promise<T>` without a
second schema system. A result Type with a callable top-level `then` is rejected
statically because native Promise resolution would assimilate it. Options
include headers, body, timeout, and `maxBytes`.
`secretHeaders` accepts up to 16 descriptors created by
`secretHeader(name, environment, prefix="")`. The descriptor contains only the
environment-variable name; the official Node runtime or Desktop capability host
resolves the value when the request starts and never returns it to application
code. The Node value is sent only across the private host transport. Creating
the lazy request validates and snapshots descriptors but does not read their
environment variables. A rotation made before the first response/body reader is
therefore observed, while a missing value rejects that first effect before any
network operation begins.
The Web module captures its in-process HTTP host operations when it initializes.
Node does not treat a captured Fetch or Headers wrapper as isolation, because
Node's transport can consult public application-Realm prototypes internally.
Its application-facing module captures validation, collection, URL, timer, and
result operations, while the private `velar/node-host-v1` dependency owns
`node:http`, `node:https`, redirects, sockets, response streams, fatal
incremental UTF-8 decoding, and cancellation in an isolated Worker. Desktop
performs the corresponding privileged effects in its capability worker.

Buffered response readers have one cross-target lifecycle: concurrent
`text()`, `json()`, and `parse(Type)` calls share the same pending body read and
successful text is cached for later readers. Web `blob()` shares its byte cache
with those readers. `streamText()` remains deliberately exclusive while it is
active, because replaying or duplicating an incremental stream would hide
buffering and backpressure. Before the first buffered or streaming body read,
all targets reject and cancel a present body whose valid `Content-Length`
already exceeds `maxBytes`; the running byte bound still protects absent or
incorrect declarations. A HEAD or other bodyless response does not fail merely
because its representation metadata carries a larger length. Decimal length
parsing uses compiler-captured transport intrinsics rather than mutable
application regex, number, or string methods; Node inbound request preflight
uses the same parser before `ServeRequest` starts accumulating a body.

```velar fragment
import {http, secretHeader} from "velar/http"

const request = http.post("https://api.example.com/v1/run", {
    headers: Map([["content-type", "application/json"]]),
    secretHeaders: [secretHeader("authorization", "PROVIDER_API_KEY", prefix="Bearer ")],
    body: {input: "hello"},
})
```

Secret header names cannot claim transport-controlled or ambient credential
headers, cannot conflict with ordinary headers, and their combined header
budget remains 64 KiB. Node and Desktop both follow at most 20 redirects and
remove every secret-derived header when a redirect crosses origins.
Only HTTP(S) URLs without embedded credentials are accepted. Header, request,
and response sizes are bounded, JSON stays on the lossless VelarScript data
boundary, and cancellation or timeout remains active until a streamed body has
finished rather than ending when response headers arrive. Desktop additionally
rechecks the manifest's exact-origin grant before every hop, so a redirect
cannot escape the declared network capability. Node and Desktop validate and
normalize the method and absolute URL when the request object is created; the
Desktop worker independently repeats that validation before any network effect.
Every target defaults HTTP timeout to 120,000 milliseconds, accepts only integer
values from 0 through 600,000, and reserves `0` as the explicit no-timeout mode.
Cancellation clears the owned deadline immediately, while every success or
failure path finalizes it before propagating a result; an aborted request cannot
leave a process alive through a forgotten default timer.

HTTP failures have three stable categories on every target. A non-2xx response
throws `HttpError`; explicit cancellation or deadline expiry throws
`HttpAbortError`; DNS, connection, socket, or native body-stream failure throws
`HttpTransportError`. Its `phase` is the typed
`HttpTransportPhase.request` or `HttpTransportPhase.response` value. A response
phase failure may occur after `streamText` has already delivered text, so a
caller must not blindly replay it. Protocol validation, malformed UTF-8, body
bounds, and consumer callback failures keep their own errors and are never
misclassified as network transport. Retry count, delay, status classification,
idempotency, and whether already-visible output may be replayed remain
application/provider policy rather than hidden behavior in `velar/http`.

Node and Desktop also share the exact strict JSON validator used by Web.
Request option records are snapshotted from enumerable data descriptors before
any network effect; accessors and unknown fields are rejected without being
invoked. Non-text bodies are validated and serialized before dispatch, so Map,
Set, class values, sparse Lists, cycles, non-finite numbers, and oversized data
cannot be silently converted by host `JSON.stringify`. Response `json()` reads
reject the same lossy values, including a JSON exponent that JavaScript would
otherwise parse as `Infinity`. Desktop sends the already validated body text
across its bridge, and the isolated worker refuses structural bodies or unknown
wire options instead of becoming a second permissive serializer.

Across Web, Node, and Desktop, the 16 MiB request-body ceiling measures encoded
UTF-8 transport bytes rather than JavaScript code units. The compiler owns one
platform-neutral byte counter, so multibyte text, surrogate pairs, and unpaired
surrogates cannot receive different budgets from `TextEncoder` and `Buffer`.
JSON bodies are serialized and snapshotted when the lazy request is created;
later mutation cannot change what is dispatched. An automatically generated
`content-type: application/json` header is counted inside the same combined
100-field/64-KiB header ceiling, never appended after validation.

The compiler-owned JSON runtime captures the host parser and serializer when a
standard module initializes. `velar/json`, Web/Node/Desktop HTTP, Node serve,
browser storage, and IndexedDB all call those same captured intrinsics and the
same strict snapshot. Later JavaScript mutation of ambient `JSON.parse` or
`JSON.stringify` therefore cannot silently change official-module semantics.
Browser storage and IndexedDB additionally accept a caller-selected positive
UTF-8 byte budget up to 16 MiB. Oversized reads return the typed fallback before
JSON parsing, while oversized writes fail before the host mutation or database
transaction; applications can therefore enforce a smaller durable-state budget
without reimplementing serialization or encoding rules.

Response metadata is also snapshotted once at the host boundary. Node accepts
only native `Response`, `Headers`, byte-stream, and byte-chunk values; Desktop
validates the worker's exact response and chunk records again in the renderer.
Every target requires an integer status from 100 through 599 and requires `ok`
to equal the 200-through-299 classification. Status zero and contradictory
metadata are rejected at the host boundary before `HttpError` construction or
body processing. Headers are limited to 100 fields and 64 KiB, status text to
64 KiB, and the response URL to 2 MiB. Every target uses that final response
URL for a non-2xx `HttpError`, so diagnostics identify
the endpoint that actually failed after redirects. Only a synthetic host
response with an empty URL falls back to the initial request URL. In addition
to `maxBytes`, all targets
stop after at most 1,000,000 source chunks, so an infinite stream of empty
chunks cannot keep a request alive without consuming its byte budget. A
response with no body releases its Node or Desktop request lifecycle as soon
as metadata arrives.
All text and JSON readers, including Web `text()` after a buffered `bytes()`
read, require valid UTF-8; malformed bytes are never repaired with replacement
characters. Metadata rejection, malformed chunks, byte/chunk overflow, decoder
failure, transport failure, cancellation, and timeout all release or cancel the owned response
stream. Request header names must be HTTP tokens and values must be single-line
text on every target, with validation occurring before browser or host fetch.

### `velar/env`

`get(name) -> string?` reads one explicit environment variable. `require(name)
-> string` throws a VelarScript error naming an absent variable. Names use the
portable `[A-Za-z_][A-Za-z0-9_]*` shape and at most 256 characters; there is no
process-wide environment dump.
On Node, the official module captures the original `process.env` object and its
name-validation/descriptor operations when the module initializes. Replacing
the global environment object or RegExp/Object/Reflect operations afterwards
cannot redirect a read, and accessor-backed environment values are rejected
without execution.

In Desktop, the manifest must grant readable values as individual uppercase
`environment` names. Host-only `secrets` are a separate permission list and
cannot overlap the readable list. A secret may be consumed only through a
`velar/http.secretHeader` descriptor; `velar/env` and the WebView bridge never
receive its value.
The native host captures only those values once at application startup, with
at most 64 variables, 64 KiB per value, and 1 MiB across names plus values.
The renderer independently snapshots only enumerable own string data fields
without invoking getters. Desktop home, app-data, and project APIs accept only
host-returned absolute paths of at most 4,096 code units. Desktop filesystem
calls are confined to declared app-data or
project roots, process launches to exact executable names, and HTTP to exact
HTTPS or loopback origins. A process-only application does not need to grant
`velar/fs`: its omitted `cwd` is the application launch directory. An explicit
Desktop process `cwd` must be an existing directory inside a granted file root,
and Desktop does not allow an option map to replace `PATH`.

An executable grant is authority to run that native program and its descendant
tree as the current operating-system user. It prevents shell parsing and
accidental command substitution; it is not an operating-system sandbox for the
program's own filesystem or network effects. Approval policy, argument policy,
and stronger sandboxing for untrusted tools belong to the consuming product,
not to `@velarscript/desktop` or the language standard library.

Desktop HTTP bodies are pulled across the bridge in bounded
chunks rather than buffered into one transport message. The versioned native
bridge also chunks and reassembles large requests and results under explicit
aggregate bounds, so the documented 16 MiB filesystem, process-input, and HTTP
request contracts do not silently collapse to a smaller transport limit.

### `velar/host`

`exit(code=0)` accepts integer exit codes from 0 through 255.
`onShutdown(cleanup)` registers an async `() -> Promise<null>` cleanup for
SIGINT/SIGTERM, with at most 1,024 registered callbacks. Cleanups run in
registration order under one 30-second graceful-shutdown deadline. Successful
shutdown exits with conventional status 130 or 143; a rejection, invalid
result, or expired deadline is reported and selects exit 1 instead of leaving
the process alive forever. A second signal force-quits immediately.
Signal registration, exit, clocks, timers, Promise observation, cleanup-list
mutation, and synchronous diagnostics are captured during module
initialization. Async cleanup results are observed through the captured native
Promise operation rather than assimilated through a later replacement of
`Promise.prototype.then`.

### `velar/terminal`

```velar fragment
import {terminal} from "velar/terminal"

await terminal.write(terminal.args().join(" ") + "\n")
const answer = await terminal.readLine("Continue? [y/N] ")
await terminal.writeError(answer == "y" ? "continuing\n" : "stopped\n")
terminal.close()
```

`terminal.args()` returns a fresh `List<string>` containing only program
arguments after `velar run ... --`. `isInteractive()` reports whether both
input and output are attached to a terminal. `readLine(prompt="")` resolves to
one line without its newline, or `null` at EOF. `write` and `writeError` await
stdout/stderr backpressure instead of silently accumulating streamed output.
Each argument list, line, prompt, write, and queued-input window has an explicit
bound. Input that arrives between `readLine` calls is paused and delivered
through the next Promise; an oversized line rejects that Promise rather than
escaping from a Node event callback. `close()` is permanent and idempotent even
before the first read, so a later `readLine()` returns `null` instead of opening
stdin again. Node streams, readline events, raw-mode state, and process globals
are not part of the language API.
Node does not implement this contract by constructing `readline` in the
application Realm. An eagerly initialized compiler-owned Worker owns stdin
decoding and fd 1/2 writes in an isolated Realm, while a captured MessagePort proxy
revalidates every line, completion, and error. On POSIX, stdin is read through
an owned duplicate descriptor so a pending read can be cancelled without
closing the process-wide fd 0. Idle imports are unreferenced; pending operations
retain the process, and `close()` waits for the host to release its read before
terminating the Worker. The Worker's stdin stream itself is initialized only by
the first `readLine`; importing `velar/terminal` or writing output does not
leave an open reader that can keep a CLI alive.

## `velar/test`

`velar/test` provides the small assertion surface used by `velar test` without
introducing a second testing language.

```velar fragment
import {expect} from "velar/test"

test "a profile keeps its declared name and tags":
    const profile = {name: "Ada", tags: ["compiler", "web"]}
    expect(profile.name).toBe("Ada")
    expect(profile.tags).toContain("web")
    expect(profile).toEqual({name: "Ada", tags: ["compiler", "web"]})
```

- The two comparison matchers do the language's two comparison jobs, and each
  **is** the operation it names rather than a second implementation of it. An
  assertion that disagreed with the language's own equality would be the worst
  kind of trap, so neither one restates a comparison.
  - `toBe` is value equality: the same SameValueZero comparison `a == b`
    lowers to. `expect(nan).toBe(nan)` passes for exactly the reason
    `nan == nan` is `true`, and `0` and `-0` compare equal.
  - `toEqual` is content equality: the prelude `equals(a, b)`, the same
    implementation and not a matching one. It therefore inherits everything
    `equals` does, including structural Set members and Map keys, `NaN` equal
    to itself, and a refusal — rather than a quiet `false` — for cyclic or
    over-deep data.
- `toBeTruthy` and `toBeFalsy` require actual `true` and `false`, rather than
  JavaScript truthiness. `toContain` accepts text or a dense List, and
  `toHaveLength` accepts text or a dense List.
- `toMatch` accepts a Unicode string pattern of at most 4,096 code units. It
  uses the native regular-expression intrinsic captured by the module and does
  not trust a replaced global `RegExp` constructor.
- `toThrow` requires a synchronous function. `toReject` requires an actual
  Promise or a function returning one; arbitrary thenables are rejected without
  reading a `then` accessor.
- Matchers and failure display capture their collection, text, JSON quoting,
  numeric, RegExp, Promise, reflection, and Error operations when `velar/test`
  initializes. Replacing JavaScript globals or prototypes later cannot change a
  pass/fail result or redirect diagnostic formatting.
- Failure display is deliberately bounded to 1,000 visited nodes, 16 levels,
  50 collection items, and 256 string code units. It reads only accepted dense
  List and data-record fields; assertion diagnostics never become an unbounded
  object inspector.

## Deliberate omissions

Standard API 0.5 deliberately keeps shells, sockets below the checked server
abstraction, filesystem streams, recursive deletion, byte inspection,
reflection, pickle, dynamic import machinery, and JavaScript's legacy prototype
surface out of Core. Process execution and filesystem mutation live in
explicit Node or Desktop target extensions rather than ambient Core globals.
Browser capabilities remain in independently versioned Web modules. Canvas and game development
remain a later `velar/game` package built on the Web platform, not part of the
language runtime.
