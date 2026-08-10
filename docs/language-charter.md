# VelarScript language reference

This document defines the current VelarScript source language. It is a clean
reference, not a migration guide. Removed spellings and earlier experiments are
not part of the language.

## 1. Design contract

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
   cycle-free semantic graph backed by ordinary npm dependencies.

VelarScript compiles to modern JavaScript. Look compiles to readable selectors,
CSS variables, and DOM bindings owned by the Web package. There is no VelarScript VM.

Desktop does not define a second source language. A Desktop application uses
one VelarScript module graph with the same components, JSX, Look, state,
computed values, and actions as Web. Files, paths, processes, HTTP, environment,
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

/// Documentation attached to the following declaration.
export def greet(name: string) -> string:
    return f"Hello, {name}"
```

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
- A binding cannot be declared twice in the same scope.
- Shadowing follows ordinary lexical lookup everywhere, including module
  reactive bindings: a parameter or local binding may reuse a `state` or
  `computed` name, and inside that scope the name is that ordinary binding.
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
  runtime code cannot be shadowed. Extension conveniences follow ordinary
  lexical lookup, so a local or imported `color` or `clamp` naturally wins.
  An extension may reserve an actual runtime entry point such as Web `mount` or
  `tick` when shadowing would make emitted behavior ambiguous.
- Binding names beginning with `__velar` are reserved for hygienic generated
  helpers. Object fields and JavaScript property names are unaffected.

Literals are intentionally small:

```velar
const title = "VelarScript"
const count = 42
const ratio = 0.75
const enabled = true
const missing = null
const message = f"{title}: {count}"
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

Single and double quotes are equivalent string delimiters. An inline string
must close before its physical line ends; otherwise the lexer diagnoses that
line and resumes at the next one. A quote followed immediately by a newline
instead opens a layout string. Its first nonblank content line establishes a
structural indentation margin, and a quote back at the opening line's
indentation closes the value:

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
so following code remains independently lexable. Ordinary inline and layout
strings keep the familiar `\\`, `\"`, `\n`, `\r`, and `\t` escapes.

The only string prefixes are `f`, `r`, and `rf`. `f` enables `{expression}`
interpolation, `r` makes backslashes literal, and canonical `rf` combines both.
`fr` receives a direct “use `rf`” diagnostic rather than becoming a second
spelling. In a raw inline string, backslash never escapes the closing delimiter,
so `r"C:\path\"` includes the final backslash; a delimiter inside raw inline
text is doubled: `r"He said ""hello"""`. Layout-string quotes are ordinary
content unless they appear as the dedented closing delimiter. Literal
interpolation braces in an `f` or `rf` string remain `{{` and `}}`. JavaScript
`${...}` is not a second interpolation syntax. Backtick and triple-quoted
strings are not part of the language; their old spellings receive guidance to
quoted layout strings.

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

Logical operators are `and`, `or`, and `not`. They require checked boolean or
optional conditions; they are not general value-selection operators. `and` and
`or` short-circuit in source order. The right side receives facts established
by the path that reaches it, so `user and user.active` and
`user == null or not user.active` need no optional-access workaround.

Equality uses `==` and `!=` in source and compiles to strict JavaScript
identity/value equality. There is no coercive equality spelling.

Ordered comparisons accept numbers with numbers or strings with strings.
Python-style comparison chains evaluate each operand once:

```velar fragment
assert 0 < percentage <= 100
```

Each later operand is checked only under the facts established by every earlier
successful link. When the complete chain is true, those facts are available in
the controlled body.

Power uses `**`. Membership uses `in`. Runtime type checks use `is`:

```velar fragment
if "admin" in roles:
    print("Allowed")

if input is User:
    print(input.name)
```

Membership evaluates the candidate first and the collection second, exactly
once each in source order. The controlled helper uses that same source-shaped
argument order.

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
- `Promise<T>`
- `T?`
- small unions such as `string | number`
- enum singleton types such as `Status.pending`
- function types such as `(string, number) -> bool`
- read-only data views such as `readonly User` and `readonly List<User>`
- `unknown` for unvalidated dynamic input

`any` is reserved for explicit unsafe JavaScript declarations. Ordinary
VelarScript code uses `unknown` and validates it.

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
contained values are data. Classes, functions, methods, getters, promises,
host/capability objects, primitives, and unconstrained type parameters are
deliberately outside the boundary. Those values have behavior or authority that
a data qualifier cannot describe honestly.

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

if user:
    print(user.name)

if user == null:
    print("Missing")
else:
    print(user.name)
```

Presence checks distinguish `null` from valid `0`, `""`, and `false` values.
Facts narrow local names and stable record fields within the owned branch. A
plain `=` still checks against the location's declared type, then invalidates
the old fact for that location and its child fields. Reassigning an optional
value to `null` is therefore valid, and later reads must prove presence again.
Compound assignment uses the current fact because the operation itself requires
and preserves the checked non-null value.

Mutually exclusive branches are analyzed independently. A write in one branch
does not contaminate a sibling that cannot execute it, while any write that can
reach the following statement invalidates the merged fact. Facts established
with the same type on every continuing branch remain available after the
branch. A guard whose arm ends in `return`, `throw`, or — inside a loop —
`break` or `continue` never reaches the following statement, so the negated
facts persist on the fall-through path. A terminating guard therefore reads
naturally:

```velar fragment
if user == null:
    return "Missing"
return user.name
```

Narrowing is flow-based and deliberately practical. A fact established by a
check persists across calls, getters, callbacks, `await`, and string
interpolation. A known assignment to that location (including destructuring or
a compound target), or a reachable branch merge containing such a write,
invalidates it statically. A member write also invalidates facts reached through
known aliases of the object; unrelated roots keep their facts.

```velar fragment
if form:
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

Two boundaries remain because they are visible in source:

- Narrowing does not flow into a nested function body. A callback may run at
  any later time, so it re-checks what it needs or receives checked values as
  parameters.
- A getter is a computed value, not a stable location. Read it into a `const`
  to narrow the result.

An f-string converts each embedded value at its source position. Primitive and
enum conversion is inert.

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
```

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
| `slice(start=0, end=size)` | Code-point slice. |
| `char(index)` | Code point or `null`; negative indexes count from the end. |
| `has(text)`, `startsWith(text)`, `endsWith(text)` | Membership or boundary check. |
| `index(text, start=0)` | First code-point position at or after `start`, or `null`; negative starts count from the end and out-of-range starts clamp. |
| `count(text)` | Non-overlapping occurrence count; an empty search has `size + 1` positions. |
| `split(separator)` | `List<string>`. |
| `replace(from, to)`, `replaceAll(from, to)` | Replaced string. |
| `padStart(size, fill=" ")`, `padEnd(size, fill=" ")` | Padded string. |
| `repeat(count)` | Repeated string. |

`"ad" in title` is the operator form of substring membership and follows the
same left-then-right evaluation order as collection membership. Direct string
indexing is intentionally absent; use `text.char(index)` when absence is an
expected result.

Number members are `abs()`, `round()`, `floor()`, `ceil()`, and
`toFixed(digits) -> string`. Conversion still has one spelling: use
`str(value)` or an f-string, never `.toString()`.

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
`class`, and `component` declarations, bounds, and variance are deliberately
out of scope.

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
| `get(index)` | Value or `null`; negative indexes count from the end. |
| `has(value)` | Whether the exact value is present. |
| `append(value)` | Add one value; returns `null`. |
| `extend(values)` | Add a List atomically; returns `null`. |
| `insert(index, value)` | Insert at a bounded position; returns `null`. |
| `remove(value)` | Remove the first exact value; returns `bool`. |
| `pop(index=-1)` | Remove and return a value, or `null`. |
| `clear()` | Remove every value; returns `null`. |
| `copy()` | Shallow copy. |
| `slice(start=0, end=size)` | Shallow range copy. |
| `count(value)` | Exact-value count. |
| `index(value)` | Exact-value position or `null`. |
| `find(test)` | First matching value or `null`. |
| `some(test)` | Whether at least one predicate result is true. |
| `every(test)` | Whether every predicate result is true. |
| `map(transform)` | Transformed List. |
| `filter(test)` | Filtered List. |
| `reduce(combine, initial)` | Folded result. |
| `sum()` | Sum of a `List<number>` from zero. |
| `min()`, `max()` | Smallest/largest number or string, or `null` when empty. |
| `sorted(compare?)`, `sorted(by=selector)` | Sorted copy by a comparator or ordered key. |
| `reversed()` | Reversed copy. |
| `join(separator="")` | Joined string for `List<string>`. |

Direct indexing is strict and throws `IndexError` outside the List. Use `get`
for an optional read. `sorted` and `reversed` do not mutate the source. Callback
operations (`find`, `some`, `every`, `map`, `filter`, `reduce`, keyed `sorted`,
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

Set members are `size`, `add`, `update`, `remove`, `has`, `clear`, `copy`, and
`values`.

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
    else:
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
only wildcard and never creates a binding. Reusing a binding name inside one
pattern is an error.

The matched expression evaluates once. Guards run only after their pattern
matches, and a successful guard narrows its case body by the same rules as
`if`. A successful pattern also narrows the original matched identifier or
stable data field in its guard and body, so `case User:` makes the matched value
a `User` without requiring an `as` alias. Pattern failure also carries facts to
later cases and `else`, so the path after `case null` treats an optional matched
location as present. A failed guard continues to the next case after
retaining any effects it already performed. Cases are mutually exclusive: a
write in one case cannot erase a fact used only by a sibling, but facts
invalidated by a case that reaches the code after `match` stay invalidated.
Facts established by every continuing
case remain available after an exhaustive match. Guarded cases do not count as
exhaustive because the guard may be false. Complete enum matches, an unguarded
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
its own data-valued `next` method are captured once. Each pull must return an
actual Promise; a resolved `null` ends the loop, a resolved `T` enters the body,
and rejection leaves the loop unchanged. The optional second slot is a
zero-based pull index. It advances before the body, so `continue` cannot repeat
an index. `break` performs no further pull.

The loop does not invent resource ownership. It never calls `close`, `return`,
or another cleanup hook when it exhausts, breaks, throws, or is cancelled.
Sources that own files, sockets, processes, or request cancellation expose and
document an explicit operation; the caller remains responsible for it, normally
with `try`/`finally`. `async for` is a small checked pull protocol, not the
JavaScript `Symbol.asyncIterator` protocol and not an implicit generator model.
The JavaScript spelling `for await` is rejected with guidance to put the async
marker before the Velar loop.

`range(end)`, `range(start, end)`, and `range(start, end, step)` from
`velar/collections` produce a stop-exclusive bounded `List<number>` for loops
and ordinary List use. Negative steps count down and zero steps fail. Named
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
    const chunk = chunks.pop(0)
    if chunk == null:
        break
    assembled += chunk
```

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

## 10. Classes

Classes use typed body fields and one explicit constructor.

```velar
class Session:
    const id: string
    let active: bool

    constructor(id: string):
        self.id = id
        self.active = true

    get label() -> string:
        return self.active ? self.id : f"{self.id} (closed)"

    def close() -> null:
        self.active = false
```

- Fields are `const` or `let` and require a type.
- A field initializer is optional.
- The constructor initializes required fields through `self.field = value`.
- There is no class-header constructor shorthand.
- Instances are called directly: `Session("session-1")`.
- `self` is explicit in method bodies.
- Getters read as ordinary properties.

Inheritance is explicit:

```velar
abstract class Entity:
    const id: string

    constructor(id: string):
        self.id = id

    abstract def describe() -> string

class Player extends Entity:
    let score: number

    constructor(id: string, score: number = 0):
        super(id)
        self.score = score

    override def describe() -> string:
        return f"{self.id}: {self.score}"
```

A derived constructor calls `super(...)` before using `self`. `abstract` and
`override` are checked for instance and static methods and getters. `static`
declares class-owned fields and methods; inherited static fields cannot be
redeclared because that would create two independent storage locations.
`private` lowers to native JavaScript private storage and is accessible only
inside the declaring class.

`super.member` follows JavaScript's lexical rule. It is available directly in a
derived constructor, method, getter, or field initializer and remains available
inside a nested arrow. A nested `def` creates a new function boundary and does
not inherit `super`; name the base class explicitly when that is the intended
call.

VelarScript preserves JavaScript prototype and reference semantics. It does not
copy Python's multiple inheritance, metaclasses, descriptors, or operator
overloading.

## 11. Errors and assertions

Only `Error` values can be thrown from checked VelarScript.

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
JavaScript `cause`; normalization never calls their conversion hooks.
The generated module captures native Error identity/construction and primitive
String conversion when it initializes; replacing those ambient operations
later cannot change which value reaches the checked catch binding.

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
import {parse as parseJson, stringify} from "velar/json"
import * as math from "velar/math"

export const version = "1"
export def encode(value: unknown) -> string:
    return stringify(value)
```

Relative `.vel` modules and package exports are supported. Project modules are
checked as one dependency graph. A function or value may carry the shape of an
unexported or unimported record across that graph, so its fields remain checked,
but the record's source name is not silently declared in the consumer. Import a
type explicitly when naming it in an annotation:

```velar fragment
import {User as Account, loadUser} from "./users.vel"

const user: Account = loadUser()
```

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

Enum singleton identities follow the declaring enum through named imports,
renamed imports, re-exports, and aliases. Renaming `EventKind` to `Kind` changes
the local display spelling to `Kind.text`; it does not turn the member into a
different state or an ordinary string. An explicit external string mapping is
owned by the declaration and crosses the runtime module boundary with that
member; consumers still refer to the nominal member name.

Every runtime `Type.is(value)` and `Type.parse(value)` record check requires its
non-optional fields to be present own enumerable data properties. Optional
fields may be absent; when present they must follow the same owned-data rule.
Inherited fields and accessors do not satisfy a record contract, and validation
never invokes a getter. This is the same owned-record invariant used by
structural `match`.
Records remain structurally open: additional own data fields are permitted, so
decoders can accept forward-compatible protocol metadata, but every declared
singleton field must equal its exact enum member.

Validation proves the shape a value has at that operation; it does not
constrain what an unchecked Proxy may do on later reads.

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

## 13. Web extension boundary

Core does not contain JSX, components, reactivity, lifecycle, or styling.
Projects enable those features with `@velarscript/web` in `velar.json`.
Component JSX follows JavaScript evaluation order: props evaluate from left to
right, then JSX children, then the component function. Native JSX remains an
owned DOM construction rather than a hidden Core-language operation.

The source package then exposes the following language extension:

- `component`
- JSX expressions
- `state`
- `computed`
- `resource`
- `action`
- `watch`
- `mounted`
- `cleanup`
- `look`
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

A component element owns one stable instance for as long as its position is
mounted. Props are live inputs, not construction-time values: when a reactive
value passed as a prop changes, the existing instance sees the new value
through every prop read — render positions, watches, computed values, and
event handlers — and its local state, refs, and lifecycle are untouched. The
component body still runs exactly once per instance, so a `state` initializer
captures the construction-time prop value, and a body-level `const` derived
from a prop does not follow later updates — derive with `computed` when it
should. An instance is destroyed and recreated only when its position
unmounts: a conditional branch switches, a keyed list entry's key or value
disappears, or the enclosing region re-renders away. Runtime-implemented
components (`Head`, `Router`, `Link`, `NavLink`) snapshot their props once at
construction.

```velar fragment
export component TicketBadge(count: number):
    computed label = count == 1 ? "1 open ticket" : f"{count} open tickets"

    return <span class="badge">{label}</span>
```

JSX children render strings, finite numbers, booleans, enums, `WebNode` values,
or Lists containing those values. `null` and booleans render no text. Native
attributes accept strings, finite numbers, booleans, enums, or `null`.
VelarScript never calls an object's conversion hooks to invent text or an
attribute value: format an object explicitly before rendering it. Raw HTML is
an explicit string-only boundary, written as `unsafe:html={trustedMarkup}`; it
cannot be combined with children.

Use ordinary conditional expressions or functions for conditional children:

```velar fragment
return <section>
    {loading ? <p aria-busy="true">Loading…</p> : <Results items={items} />}
</section>
```

Magic JSX `if`, `else-if`, and `else` attributes are not part of the language.

Important native directives include:

- `on:click={handler}` and other typed events
- `bind:value={state}` for supported form controls
- `ref={element}` for an optional element binding
- `look={visual}`
- `class={nameOrList}`
- stable `key` values for dynamic children

Refs are restored to `null` during cleanup.

A `key` drives identity-preserving reuse only in the keyed-children shape: an
interpolation that is `items.map(item => <Row key={item.id} />)`, or a `?:`
branch of one — so an empty-state ternary around a keyed list keeps the keyed
path. A list rendered with `.map(...)` in that position requires a key on its
root element, and a `key` anywhere else in an interpolation is a diagnostic
rather than a silently ignored attribute.

## 15. State, computed values, resources, and actions

```velar fragment
export component Profile(userId: string):
    state expanded = false
    computed label = expanded ? "Hide" : "Show"
    resource profile: User = loadUser(userId)

    action save() -> User:
        return await saveUser(profile.value)

    def toggleExpanded() -> null:
        expanded = not expanded

    return <section>
        <button type="button" on:click={toggleExpanded}>{label}</button>
        <button type="button" disabled={save.pending} on:click={save}>Save</button>
    </section>
```

`state` is deeply reactive. Assigning the binding, mutating a `List`, `Set`, or
`Map`, and assigning a field anywhere inside a nested record all publish the
affected reactive reads. State references may be aliased, returned, and passed
through ordinary functions; helpers can mutate the owned value directly.

```velar fragment
tasks.append(task)
tasks[0].done = true

def retitle(task: Task, title: string) -> null:
    task.title = title

retitle(tasks[0], "Ready")
```

`computed` is read-only and tracks its reactive dependencies. Computed
expressions are synchronous; asynchronous component data belongs in a
`resource`. Record properties and collection keys are tracked independently,
so changing `task.done` invalidates consumers of that property without
invalidating unrelated `task.title` reads, and changing one `Map` entry does not
invalidate consumers of other keys. The language exposes no memoization or
batching API; property-level tracking and synchronous assignment coalescing are
framework contracts owned by the Web API document.

Reactive imports keep the same split as ordinary imports: assigning an imported
binding is forbidden, while mutating the value inside an imported state binding
is legal and publishes to every consumer. Component record and collection props
enter the child through the same transitive Core `readonly` views used by
ordinary functions and module interfaces. A helper that only reads a prop must
declare a `readonly` parameter; a helper that requires a mutable parameter
cannot receive the prop. A child may call a callback supplied by its parent to
request a mutation, but it may not assign through the prop or invoke a mutating
collection method on it.

A resource exposes `value`, `loading`, `ready`, `error`, and `reload`. It owns
stale-result and component-destruction handling.

An action is an async UI operation with reactive `pending` and `error` fields.
It reports the failure through the Web error chain and still rejects its call;
errors are never silently converted into successful `null` results. Use
`try`/`catch` when the caller owns recovery. Like `state` and `computed`, an
`action` may also be declared at module scope, so a shared store owns an
operation together with its `pending`/`error` surface; a module action lives
for the life of the module and is never disposed. A `resource` remains
component-owned because its stale-result handling is tied to component
destruction.

`watch expression as current, previous:` runs an explicit side effect when the
tracked value changes. A watch body is synchronous. Async component work belongs
in an `action`; lifecycle setup that must wait belongs in `mounted`.
For a deep mutation, `current` and `previous` are the same reference; a watch
does not manufacture an unbounded deep snapshot. Inspect the fields needed by
the side effect, or store an explicit snapshot when the application requires
one.

## 16. Lifecycle

Lifecycle is component-owned and deliberately small:

```velar fragment
export component CanvasPanel:
    let canvas: CanvasElement? = null

    mounted:
        if canvas:
            startCanvas(canvas)

    cleanup:
        stopCanvas()

    return <canvas ref={canvas}></canvas>
```

`mounted` and `cleanup` are sibling blocks. Cleanup is not nested inside
mounted and is not returned from an effect callback. The Web runtime owns their
ordering and disposes watches, resources, actions, events, refs, and DOM work
with the component.

There is no public React-style `effect` API.

## 17. Look: controlled visual language

Look is VelarScript's checked visual language. It uses real DOM-style CSS
property names, VelarScript expressions, typed unit values, composition, conditions,
element states, and explicit pseudo-element targets.

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

### Builders

Look builders are ordinary named exports from `velar/look`, not magic names
that appear only inside a `look:` block. Import only the functions a module
uses; the functions may be aliased, passed to another function, returned, and
called outside Look like any other VelarScript value.

The module provides a small checked builder set:

- colors: `color`, `rgb`, `rgba`, `hsl`, `alpha`, `lighten`, `darken`
- visuals: `border`, `shadow`, `linearGradient`, `asset`
- layout: `minmax`, `repeat`, `tracks`, `spacing`, `min`, `max`, `clamp`
- motion: `transition`

Named arguments work normally:

```velar
import {rgba, shadow} from "velar/look"

const raised = shadow(0px, 12px, 32px, rgba(0, 0, 0, 0.16), spread=0px, inset=false)
```

Builder inputs are checked visual values, not JavaScript coercion points.
Colors use finite numeric ranges; layout builders accept finite numbers,
bounded strings, typed lengths/percentages, and their declared track values.
Functions, records, classes, non-finite numbers, and objects with conversion
hooks never become CSS text. A dynamic property value of `null` removes that
controlled value instead of emitting the text `"null"`.

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
const motion: Duration = 1s + 200ms
const rotation: Angle = 0.5turn + 90deg
```

Addition and subtraction require the same visual dimension; mixing Length and
Percentage yields `LengthPercentage`. A visual value may be multiplied or
divided by a finite number, and a number may multiply a visual value. Compatible
same-unit expressions fold to one value; mixed length units and
length-percentage expressions lower to CSS `calc(...)`. Unit-by-unit
multiplication, division by a unit value, color arithmetic, and arithmetic on
composite values such as `Spacing` are rejected.

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
Duplicate properties in the same Look scope are reported instead of hidden.

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
is the same condition as `scheme.light`. Media subjects compose with element
states and each other:

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

Targets cannot be nested. Conditions may appear inside a target, but a target
cannot appear inside another target.

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
- Classes lower to JavaScript classes and prototypes.
- `private` lowers to native private members.
- Async functions and actions use Promises and the host event loop.
- Map and Set use JavaScript key/value identity.
- Garbage collection belongs to the host JavaScript engine.

The compiler adds checked boundaries, bounded collection helpers, runtime data
validators, optional-chain normalization, readable DOM output, and source maps.
It does not pretend those additions create a different memory model.
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

## 19. Deliberately absent source features

The following are not part of VelarScript:

- `var`, `undefined`, `none`, or `None`
- coercive equality
- `switch`
- `new`
- `this` in VelarScript class methods
- class-header constructor fields
- `init:` constructor blocks
- TypeScript-style interfaces, assertions, overloads, or type programming
- generators, `yield`, or the JavaScript `Symbol.asyncIterator` protocol;
  incremental sources use checked `async for` pull contracts or producer
  callbacks, and JavaScript `for await` is guided to `async for`
- JavaScript `splice`, `push`, `shift`, `unshift`, mutating `sort`, or mutating
  `reverse`
- magical JSX control-flow attributes
- a public `effect` primitive
- implicit global CSS
- random class or variable names
- automatic compatibility aliases for removed spellings

JavaScript reserved words that are not already VelarScript keywords cannot be
used as binding names because generated modules must remain valid JavaScript.
They remain valid as ordinary record keys and class member names, so external
data and Web APIs do not need renamed fields.

When a removed spelling is common enough to be a likely mistake, the compiler
reports the direct current spelling. It does not keep the old behavior alive.
