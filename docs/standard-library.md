# VelarScript Core Standard Library

Status: active clean-break design
Compiler: current VelarScript compiler
Runtime: existing JavaScript engine; no separate VM

## Contract

The Core library combines the most useful everyday parts of Python and modern
JavaScript behind a small explicit VelarScript surface. It is not a copy of either
standard library.

- Every capability is imported from an official `velar/*` module. Nothing
  patches JavaScript prototypes or creates new global names.
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
  `range`, `randomInt`, numeric `min`/`max`, and URL `join` therefore stay
  positional, matching the familiar operation they represent.
- Every API that requires `List<T>` enforces the same dense, field-free,
  mutable data-element List boundary used by the language runtime. Sparse or
  frozen JavaScript arrays, arrays carrying hidden/extra fields, and
  accessor-backed elements do not become valid Lists through a library call;
  validation never invokes an element getter.
- Map and Set boundaries use native internal-slot checks and prototype
  operations. Cross-realm native collections are accepted, while subclass
  overrides cannot replace size, iteration, membership, or lookup semantics.
- Core conversion is deliberately asymmetric and small: `str(value)` performs
  explicit display conversion, while `number(text) -> number?` strictly parses
  one complete finite decimal. JavaScript `Boolean`, `Number`, and `String`
  globals are not source bindings, so truthiness, empty-string-to-zero, partial
  parsing, and `NaN` do not re-enter through ambient coercion.
- Core Node builds copy only imported official modules beside the generated
  output. Web builds bundle and tree-shake the same module implementations.
- Resource-producing APIs are bounded contracts, not best-effort host calls.
  A List contains at most 1,000,000 items; text and encoded JSON are limited to
  16 MiB; JSON data contains at most 1,000,000 values and 128 nested
  collections. List spread, `Set`/`Map` construction, and collection mutation
  preserve the 1,000,000-item invariant; an update to an existing Set value or
  Map key remains valid at the ceiling, while growth fails with `RangeError`.
  Dynamic misuse fails before a native capability is invoked.

## `velar/collections`

Python-style iteration helpers and explicit functional collection operations.
Core Lists use the same direct vocabulary: `append(value)` adds one item,
`extend(values)` adds a typed List atomically, and `slice(...)` returns a copy.
The JavaScript-specific variadic `push` surface is not part of VelarScript source.
Language-level callback methods read a checked shallow snapshot, so callback
mutation cannot silently extend, truncate, or replace the values participating
in the current operation.
The imported collection helpers use the same snapshot boundary, including for
Array subclasses with overridden methods or iterators. Values returned from
host callbacks and async combinators normalize JavaScript `undefined` to
VelarScript `null` before becoming observable.

| Export | Behavior |
| --- | --- |
| `range` | Stop-exclusive numeric range with optional start and step; step cannot be zero or too small to advance at the current magnitude. |
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
import {enumerate, groupBy, range} from "velar/collections"

const pages = enumerate(range(1, 4), 10)
const byRole = groupBy(users, user => user.role)
const labeled = enumerate(start=10, values=users)
```

Ordering never uses JavaScript's mixed-type relational coercion. The compiler
rejects known boolean/record/optional/mixed key results, dynamic keys are
checked before comparison, and equal-key input order is retained even for
descending sorts. `find`, `partition`, `some`, and `every` require an
actual `bool` result at dynamic boundaries.

## `velar/text`

String operations are functions so their coercion and naming rules stay
explicit: `trim`, `trimStart`, `trimEnd`, `lower`, `upper`, `capitalize`,
`title`, `startsWith`, `endsWith`, `includes`, `split`, `replace`,
`replaceAll`, `repeat`, `padStart`, `padEnd`, `lines`, `words`, `slug`,
`truncate`, `indent`, `dedent`, `normalizeWhitespace`, `isBlank`, and
`escapeHtml`. Stateless pattern operations are `matches`, `findMatch`,
`findMatches`, `replaceMatches`, and `splitPattern`.

`title` treats separators as word boundaries. `truncate` reserves room for its
suffix. `slug` lowercases Unicode text, removes punctuation, and joins word
runs with `-`; it does not transliterate non-Latin text. `escapeHtml` escapes
text for HTML content and attribute contexts but does not mark it as trusted
HTML.

Pattern expressions use JavaScript pattern syntax in Unicode mode through a
captured intrinsic implementation, not a replaceable ambient `RegExp` global.
Each operation creates a fresh pattern; source code never receives `RegExp` or
its mutable `lastIndex`. Options are copied from one typed data record containing only optional
`ignoreCase`, `multiline`, and `dotAll` booleans. `findMatch` returns
`{value, index, groups}` or `null`; `findMatches` returns all such records and
normalizes an unmatched capture to `null`. `replaceMatches` replaces every
match with one literal string, and `splitPattern` omits capture groups from the
result. Invalid patterns throw `TypeError` at the VelarScript boundary.

Pattern source is limited to 4,096 code units, pattern input/output and returned
match text to 16 MiB, and list-producing pattern operations to 1,000,000 results.
Matches are copied from checked data fields, empty Unicode matches always make
code-point progress, and replacement size is checked before the final string is
allocated. Patterns
are application code, not a sandbox for executing arbitrary user-supplied
regular expressions; applications that accept search text should use the
literal `includes`/`startsWith`/`endsWith` operations unless they deliberately
own a pattern grammar.

Text counts used by `repeat`, `padStart`, `padEnd`, and `truncate` are
non-negative safe integers; native string-to-number coercion is not exposed.
Dynamic pattern options must be plain enumerable data fields, so getters,
symbols, and class instances are rejected without hidden evaluation. Text
composition such as `indent` checks its complete output budget before joining
the final string.

```velar
import {findMatch, matches, splitPattern} from "velar/text"

const valid = matches("VelarScript 42", "^velar [0-9]+$", {ignoreCase: true})
const ticket = findMatch("ticket-42", "[0-9]+")
const fields = splitPattern("one, two; three", " *[,;] *")
```

## `velar/math`

The module exposes JavaScript Number mathematics without claiming Python
integer or decimal behavior. Every public operation nevertheless requires an
actual `number` at runtime; native `Math.*` coercion cannot turn `"2"`, `[]`,
or another dynamic JavaScript value into a VelarScript number.

| Group | Exports |
| --- | --- |
| Constants | `pi`, `e`, `tau`, `infinity` |
| Bounds and rounding | `abs`, `min`, `max`, `clamp`, `sign`, `round`, `floor`, `ceil`, `trunc` |
| Powers and logarithms | `sqrt`, `cbrt`, `pow`, `exp`, `log`, `log2`, `log10` |
| Trigonometry | `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `degrees`, `radians` |
| Numeric helpers | `hypot`, `random`, `randomInt`, `isFinite`, `isInteger`, `gcd`, `lcm` |

`round(value, digits)` supports an optional decimal-place count from -308
through 308 without the former multiply-and-divide overflow for large finite
values. `randomInt` uses an inclusive lower and exclusive upper safe-integer
bound; with one argument its lower bound is zero. `gcd` and `lcm` likewise own
safe integers, and `lcm` rejects an inexact result. Randomness is the host
JavaScript runtime's `Math.random` and is not cryptographically secure. Its
result is checked as a finite number in the native `[0, 1)` range before either
random API returns a value.

## `velar/json`

| Export | Behavior |
| --- | --- |
| `parse` | Parses JSON; an optional VelarScript `type` validates and types the result. |
| `tryParse` | Returns a validated value, an explicit fallback, or `null`. |
| `stringify` | Strictly serializes JSON data with an optional compact/indent setting. |
| `stableStringify` | Strictly serializes while recursively ordering record keys. |
| `clone` | Strictly JSON-clones a value and optionally validates the result with a VelarScript `type`. |
| `isSerializable` | Reports whether a value is losslessly representable as JSON data. |
| `deepEqual` | Recursively compares VelarScript records and Lists, Map values with native key identity, and Sets with native membership; non-data objects keep reference identity and distinct cycles safely compare false. |

```velar fragment
import {deepEqual, parse as parseJson} from "velar/json"

type User:
    id: string
    name: string

const user = parseJson(source, User)
const unchanged = deepEqual(user, previousUser)
```

The second argument is the existing runtime form of a record `type`, a runtime
transparent alias, or an `enum`; there is no parallel schema declaration. The
compiler registers those frozen Type values under one shared runtime identity,
including when they cross module boundaries. `parse`, `tryParse`, and `clone`
check that identity before parsing or cloning and never inspect an arbitrary
object's `is` or `parse` fields as permission to skip validation.

JSON data is deliberately narrower than arbitrary JavaScript values: it
contains finite numbers, strings, booleans, `null`, dense Lists, and plain
records recursively. Map, Set, class instances, functions, sparse Lists,
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

## `velar/async`

| Export | Behavior |
| --- | --- |
| `sleep` | Resolves after a non-negative millisecond duration. |
| `all`, `race` | Typed Promise-list equivalents of JavaScript `Promise.all` and `Promise.race`. |
| `timeout` | Rejects if a Promise does not settle before a duration; accepts an optional message. |
| `retry` | Runs a zero-argument sync/async task again after failure, up to the retry count. |
| `map` | Maps a list with a sync/async worker and optional positive concurrency limit while preserving result order. |
| `series` | Runs a list of zero-argument sync/async tasks sequentially. |

These helpers use the host Promise queue. They do not create threads, cancel a
Promise, or replace the JavaScript event loop. Their List arguments use the
same dense List validation as collection helpers; concurrency counts are
positive safe integers. `all`, `race`, and `timeout` require actual Promises at
runtime, including across JavaScript realms; arbitrary thenables are rejected
without probing a `then` accessor. Retry attempts are positive safe integers and timeout
messages remain real strings at dynamic boundaries. `all` and `race` may start
at most 10,000 operations at once, `map` concurrency is at most 1,024, retry is
at most 10,000 attempts, and timer durations stay within the signed 32-bit host
timer range.

Short asynchronous workers use the language's expression arrow directly, for
example `await map(urls, async url => await load(url))`. Its inferred result is
`Promise<T>`; ordinary synchronous callbacks and named `async def` workflows
remain available for expression and block bodies respectively. All async forms
share native Promise adoption: a named async worker declared `-> T` may return
either `T` or another `Promise<T>` without adding `return await` merely to
satisfy the checker.

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
limited to 2 MiB; parsed names/values share the same text budget, and query maps
contain at most 100,000 fields.

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
API. Formatted output is limited to 65,536 characters.

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
conversion hooks. `isUuid(value)` checks canonical UUID text without changing
it and rejects non-36-character input before pattern matching.

```velar
import {isUuid, uuid} from "velar/id"

const taskId = uuid()
print(isUuid(taskId))
```

## `velar/log`

Structured logging replaces direct source-level access to `console` while
remaining on the existing JavaScript runtime.

```velar fragment
import {logger, setLevel, useSink} from "velar/log"

component BuildStatus:
    const buildLog = logger("build")
    const stopCapture = useSink(record => sendRecord(record.message))

    mounted:
        setLevel("debug")
        buildLog.info("Compilation ready")

    cleanup:
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
- `useSink(callback)` redirects records while at least one custom sink exists
  and returns an explicit cleanup function. A record contains timestamp, level,
  scope, message, fields, and optional error.
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
- VelarScript never uploads logs or telemetry automatically.

## `velar/test`

`velar/test` provides the small assertion surface used by `velar test` without
introducing a second testing language.

```velar fragment
import {expect} from "velar/test"

def test_profile_name():
    const profile = {name: "Ada", tags: ["compiler", "web"]}
    expect(profile.name).toBe("Ada")
    expect(profile.tags).toContain("web")
    expect(profile).toEqual({name: "Ada", tags: ["compiler", "web"]})
```

- `toBe` uses exact identity/value equality; `toEqual` uses the same bounded
  VelarScript data comparison as `velar/json.deepEqual`.
- `toBeTruthy` and `toBeFalsy` require actual `true` and `false`, rather than
  JavaScript truthiness. `toContain` accepts text or a dense List, and
  `toHaveLength` accepts text or a dense List.
- `toMatch` accepts a Unicode string pattern of at most 4,096 code units. It
  uses the native regular-expression intrinsic captured by the module and does
  not trust a replaced global `RegExp` constructor.
- `toThrow` requires a synchronous function. `toReject` requires an actual
  Promise or a function returning one; arbitrary thenables are rejected without
  reading a `then` accessor.

## Deliberate omissions

Standard API 0.4 does not copy Node-only filesystem/process APIs, Python's OS,
subprocess, reflection, pickle, or import machinery, or JavaScript's legacy
prototype surface. Browser capabilities remain in independently versioned Web
modules. Canvas and game development remain a later `velar/game` package built
on the Web platform, not part of the language runtime.
