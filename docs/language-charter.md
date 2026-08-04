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
5. Keep Web features in the explicit `@velarscript/web` extension rather than
   hiding them in Core.

VelarScript compiles to modern JavaScript. Look compiles to readable selectors,
CSS variables, and DOM bindings owned by the Web package. There is no VelarScript VM.

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

## 3. Bindings and literals

Bindings deliberately retain the familiar JavaScript words `const` and `let`.

```velar
const applicationName = "Atlas"
let attempts = 0
attempts += 1
```

- `const` cannot be reassigned.
- `let` can be reassigned.
- Both are lexically scoped.
- A binding cannot be declared twice in the same scope.
- Module reactive bindings cannot be shadowed inside a local scope.
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
const values = [1, 2, 3]
const user = {id: "user-1", title}
```

`null` is the only ordinary empty value. `undefined`, `none`, and `None` are
not VelarScript values.

Object fields support JavaScript-style shorthand. Spreads are supported in
records and lists:

```velar fragment
const nextUser = {...user, title: "Owner"}
const nextValues = [...values, 4]
```

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

Power uses `**`. Membership uses `in`. Runtime type checks use `is`:

```velar fragment
if "admin" in roles:
    print("Allowed")

if input is User:
    print(input.name)
```

## 5. Core types

The built-in Core types are:

- `string`
- `number`
- `bool`
- `null`
- `List<T>`
- `Set<T>`
- `Map<K, V>`
- `Promise<T>`
- `T?`
- small unions such as `string | number`
- function types such as `(string, number) -> bool`
- `unknown` for unvalidated dynamic input

`any` is reserved for explicit unsafe JavaScript declarations. Ordinary
VelarScript code uses `unknown` and validates it.

VelarScript does not provide TypeScript conditional types, mapped types,
overload sets, declaration merging, user-defined generics, or type assertions.

### Optional values

`T?` means `T | null`.

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
branch. A terminating guard therefore reads naturally:

```velar fragment
if user == null:
    return "Missing"
return user.name
```

Ordinary calls are boundaries for mutable bindings and object-field facts
because VelarScript keeps JavaScript reference and closure semantics. Save a
checked value in a local `const` when it must remain stable across calls:

```velar fragment
if form:
    const currentForm = form
    setError(currentForm, "email", "Required")
    focusFirstError(currentForm)
```

Getters and fields supplied by safe JavaScript imports use the same boundary:
their implementation may run code or expose an accessor. Read once into a local
`const`, then check and reuse that value. Plain VelarScript record and class
fields remain stable until an assignment or effect boundary can change them. A
member write invalidates facts reached through every alias of that object;
writes to safe-JavaScript fields additionally account for a possible setter.
An `is` check against a safe-JavaScript class also accounts for its possible
`Symbol.hasInstance` hook; local VelarScript class checks are inert.
`await` is also an effect boundary because other event-loop work can run during
the suspension. Declaring a nested function does not itself invalidate facts;
invoking it does.

An f-string converts each embedded value at its source position. Primitive and
enum conversion is inert. Converting an object may invoke its `toString`, so
object interpolation is an ordinary effect boundary; save any checked value
that must survive it in a local `const`.

Optional access is explicit at each optional continuation:

```velar fragment
const city = account?.profile?.address?.city
const first = values?.[0]
const result = callback?.()
```

Skipped indexes and call arguments are not evaluated. Optional chains cannot
be assignment targets.

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

There is no parallel `schema`, `interface`, or `typedef` family.

Record types have a runtime validator:

```velar fragment
const user = User.parse(untrusted)

if untrusted is User:
    print(untrusted.name)
```

`parse` returns a validated value or throws `ValidationError`. Runtime
validation accepts only the declared data shape and observes bounded data rules.

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

## 7. Functions and calls

Functions use `def`. Parameters and public results can be annotated directly.

```velar fragment
def formatUser(user: User, prefix: string = "@") -> string:
    return f"{prefix}{user.name}"
```

Omitting a result annotation means `-> null`, not whole-body type inference.
A function with a non-null result must declare it and return on every reachable
path.

Calls support positional and named arguments:

```velar fragment
const first = formatUser(user)
const second = formatUser(user, prefix="#")
```

Named arguments use `name=value`, the same assignment-shaped spelling Python
users expect and JavaScript users can read immediately.

- Positional arguments come first.
- Names are checked against the declaration.
- A name cannot appear twice.
- Arguments evaluate from left to right.
- The callee, including its receiver and any getter, evaluates before arguments.
- An optional call that short-circuits does not evaluate its arguments.
- Lowered JavaScript receives arguments in declaration order.
- No runtime keyword-argument record is created.

Arrows are concise expression functions:

```velar fragment
const doubled = values.map(value => value * 2)
const load = async id => await fetchUser(id)
```

Rest parameters use `...values`. A rest parameter is always final.

### Async functions

An async declaration annotates the resolved value:

```velar fragment
async def loadUser(id: string) -> User:
    return await api.user(id)
```

Its call type is `Promise<User>`. Do not write `-> Promise<User>` on an async
function. JavaScript Promise adoption and the JavaScript event loop remain the
runtime behavior.

## 8. Collections

The public collection names are `List`, `Set`, and `Map`.

### List

```velar
let names: List<string> = ["Ada", "Lin"]
names.append("Grace")
names.extend(["Edsger", "Margaret"])
names.insert(1, "Barbara")
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
| `sorted(compare?)` | Sorted copy. |
| `reversed()` | Reversed copy. |
| `join(separator="")` | Joined string for `List<string>`. |

Direct indexing is strict and throws `IndexError` outside the List. Use `get`
for an optional read. `sorted` and `reversed` do not mutate the source. Callback
operations (`find`, `some`, `every`, `map`, `filter`, and `reduce`) read one
checked shallow snapshot, so a callback may mutate the original List without
changing which values belong to the current operation.

VelarScript does not expose `splice`, variadic `push`, `shift`, `unshift`, or
mutating `sort`/`reverse`.

### Set

```velar
const tags: Set<string> = Set()
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
```

Map members are `size`, `get`, `set`, `update`, `remove`, `has`, `clear`,
`copy`, `keys`, `values`, and `entries`.

All collection growth is bounded. Every language collection operation validates
its JavaScript boundary and calls compiler-owned helpers rather than an
instance's overridable collection methods. A `for` loop visits string
characters, List and Set values, or Map keys in order. String iteration follows
JavaScript Unicode code points, so a surrogate pair is one character. Native Map and Set brands are checked
through their internal slots, so legitimate values from another browser realm
work without trusting an overridable `instanceof`, `size`, iterator, or method.
Empty mutable collections can infer
their element/key/value types from their first checked mutation, but exported
APIs should annotate them.

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

`[first, second]` matches a List of exactly two items. `[first, ...rest]`
matches one or more items and creates a new List for `rest`; `[]` matches only
an empty List. Object patterns require each named field to be a present own data
field, permit additional fields, and never invoke accessors while checking or
capturing. Nested object and List patterns follow the same rules. `_` is the
only wildcard and never creates a binding. Reusing a binding name inside one
pattern is an error.

The matched expression evaluates once. Guards run only after their pattern
matches, and a successful guard narrows its case body by the same rules as
`if`. A failed guard continues to the next case after retaining any effects it
already performed. Cases are mutually exclusive: a write in one case cannot
erase a fact used only by a sibling, but facts invalidated by a case that reaches
the code after `match` stay invalidated. Facts established by every continuing
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

while attempts < 3:
    attempts += 1
```

`break` and `continue` are available only inside loops. Iterating a Map yields
its keys. A `while` body receives the successful condition's facts on every
iteration; assigning a narrowed optional back to `null` invalidates that fact
for the remainder of the current iteration. Writes after an unconditional
`return`, `throw`, `break`, or `continue` do not affect reachable flow facts. If
a loop body can only return or throw, its writes cannot escape to the skipped
path after the loop.

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

    def close():
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
`override` are checked. `static` declares class-owned fields and methods.
`private` lowers to native JavaScript private storage and is accessible only
inside the declaring class.

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
assert 0 < width <= 4096, "Width is outside the supported range"
```

A successful assertion narrows checked optional and type facts in the current
scope.

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
remains a live ES-module value. The module contract records that distinction,
so calls, `await`, and other effect boundaries invalidate a narrowed live import
without pretending it can be assigned locally. `export const` remains stable.
Modules with live exports must be imported by name rather than through `* as`;
namespace fields are always read-only.

Different modules may use the same record display name; their field metadata is
kept separate until ordinary structural assignability is checked.

Every runtime `Type.is(value)` and `Type.parse(value)` record check requires its
non-optional fields to be present own enumerable data properties. Optional
fields may be absent; when present they must follow the same owned-data rule.
Inherited fields and accessors do not satisfy a record contract, and validation
never invokes a getter. This is the same owned-record invariant used by
structural `match`.

Native JavaScript is explicit:

```velar
import js unsafe {legacyValue} from "legacy-package"
```

Larger boundaries should use checked `extern module` declarations. Unsafe
imports do not silently gain trustworthy VelarScript types. See
[javascript-bridge.md](javascript-bridge.md).

## 13. Web extension boundary

Core does not contain JSX, components, reactivity, lifecycle, or styling.
Projects enable those features with `@velarscript/web` in `velar.json`.
Component JSX follows JavaScript evaluation order: props evaluate from left to
right, then JSX children, then the component function. Calling the component is
an effect boundary just like an ordinary function call. Native JSX remains an
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

## 14. Components and JSX

```velar
export component Greeting(name: string, emphasized: bool = false):
    return <p class={emphasized ? "emphasized" : null}>Hello, {name}</p>
```

Component names are PascalCase. Native elements use lowercase HTML/SVG names.
Props are checked from the component declaration. Boolean attributes may be
valueless. JSX expressions use ordinary VelarScript expressions.

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

`state` publishes when its binding is assigned. Mutating a List, Set, Map, or
nested record inside state does not publish a reactive update; construct and
assign the next value instead. Mutable state references cannot be aliased,
returned, passed through ordinary calls, or supplied as component props. Use a
derived value or an explicit `copy()` so a helper cannot mutate state behind the
binding that owns its update.

```velar fragment
const next = tasks.copy()
next.append(task)
tasks = next

const visible = filterTasks(tasks.copy(), query)
return tasks.copy()
```

`computed` is read-only and tracks its reactive dependencies.

A resource exposes `value`, `loading`, `ready`, `error`, and `reload`. It owns
stale-result and component-destruction handling.

An action is an async UI operation with reactive `pending` and `error` fields.
It reports the failure through the Web error chain and still rejects its call;
errors are never silently converted into successful `null` results. Use
`try`/`catch` when the caller owns recovery.

`watch expression as current, previous:` runs an explicit side effect when the
tracked value changes.

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

Look provides a small checked builder set:

- colors: `color`, `rgb`, `rgba`, `hsl`, `alpha`, `lighten`, `darken`
- visuals: `border`, `shadow`, `linearGradient`, `asset`
- layout: `minmax`, `repeat`, `tracks`, `spacing`, `min`, `max`, `clamp`
- motion: `transition`

Named arguments work normally:

```velar
const raised = shadow(0px, 12px, 32px, rgba(0, 0, 0, 0.16), spread=0px, inset=false)
```

### Composition

Look values are ordinary exportable values and may be composed once at their
outer level:

```velar
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
idempotent. Errors and Promise behavior are unchanged; Promise normalization
uses one cross-module identity cache. Unsafe JavaScript `any` imports
deliberately remain outside this guarantee. A discarded expression result is
not wrapped.

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
- JavaScript `splice`, `push`, `shift`, `unshift`, mutating `sort`, or mutating
  `reverse`
- magical JSX control-flow attributes
- a public `effect` primitive
- implicit global CSS
- random class or variable names
- automatic compatibility aliases for removed spellings

When a removed spelling is common enough to be a likely mistake, the compiler
reports the direct current spelling. It does not keep the old behavior alive.
