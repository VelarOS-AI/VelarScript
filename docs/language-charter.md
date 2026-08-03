# VelarScript 0.9 Language Charter

Status: current design authority
Compiler: Velar Compiler
CLI: `velar`
Source extension: `.vel`

## 1. Mission

VelarScript is a compiled language designed for modern Web applications.

It compiles to modern JavaScript, CSS, and Web assets and runs on existing browsers and JavaScript runtimes. JavaScript is the runtime ABI and ecosystem boundary; it is not the source-compatibility authority for VelarScript.

VelarScript combines:

- JavaScript's expression model, objects, arrays, modules, and asynchronous model.
- Python's readable blocks, named functions, explicit `self`, and approachable control flow.
- A small type layer for assistance and boundary validation rather than type-level programming.
- An official `@velarscript/web` extension for JSX, components, state, DOM
  updates, lifecycle, and scoped CSS.

The Core language and Web framework are separate contracts. Core provides the
neutral compiler-extension host and framework-host ABI but does not activate or document JSX,
components, reactivity, lifecycle, DOM types, or CSS as Core syntax. A format-2
project opts into those features with `"extensions": ["@velarscript/web"]`.
The Web package's separate host entry owns browser-document, CSP, reload,
deployment, and browser-test policy; the CLI supplies generic host mechanics.

## 2. Non-goals

VelarScript does not attempt to:

- Accept arbitrary JavaScript or TypeScript source.
- Build a new VM, garbage collector, event loop, or browser runtime.
- Reproduce the complete TypeScript type system.
- Add type-level metaprogramming, conditional types, or type gymnastics.
- Provide a virtual DOM.
- Provide SSR or hydration.
- Build a package manager.
- Build a game framework.
- Provide React, Vue, or Svelte compatibility modes.
- Self-host the compiler.

## 3. Runtime contract

VelarScript preserves the real JavaScript runtime facts:

- JavaScript garbage collection.
- IEEE 754 JavaScript Number semantics.
- Value and reference behavior.
- Functions and closures.
- Promise and event-loop behavior.
- JavaScript object and prototype implementation.
- Browser Web APIs.

These facts do not require VelarScript to expose JavaScript's historical surface problems.

Ordinary VelarScript does not expose:

- `var`
- `undefined`
- dynamic `this`
- `new`
- `.prototype`
- `__proto__`
- `eval`
- `with`
- `arguments`
- implicit globals
- implicit number/string coercion
- ambient JavaScript `Boolean`, `Number`, or `String` coercion functions
- automatic semicolon insertion

## 4. Syntax division

JavaScript contributes:

- `const` and `let`
- arrays and object literals
- destructuring and spread
- arrow functions
- `import` and `export`
- `async` and `await`
- `?.` and `??`
- inline conditionals with `? :`
- collection operations such as `map`, `filter`, and `reduce`
- JSX, when contributed by `@velarscript/web`

Python contributes:

- colon and indentation-based blocks
- named functions with `def`
- explicit `self`
- block `if`, `else`, `for`, and `while`
- structured `try`, `catch`, and `finally`
- `and`, `or`, and `not`
- interpolated strings with `f"..."`

VelarScript does not include Python inline conditionals or collection comprehensions.

## 5. Bindings

```velar
const name = "Velar"
let score = 0

score += 1
```

- `const` cannot be rebound.
- `let` can be rebound.
- Both are block scoped.
- Both must be initialized.
- `const` does not freeze referenced objects.
- Assignment is a statement, not an expression.
- Destructuring is supported in declarations and `for` bindings.
- List, object, and call expansion use `...`.

## 6. Values and references

Core value types:

```velar
string
number
bool
none
```

Reference values include objects, lists, sets, maps, functions, class instances, and component instances.

Passing an object to a function does not copy it. VelarScript keeps JavaScript's shared-reference behavior.

`number` is JavaScript Number. VelarScript does not claim Python-style
arbitrary-precision integer semantics.

## 7. Empty values and conditions

VelarScript source uses only:

```velar
none
```

Ordinary source does not use `null` or `undefined`.

```velar
const avatar = user?.profile.avatar ?? "/default.png"
const firstGroup = findMatch(value, "([0-9]+)")?.groups[0]
```

One explicit `?.` starts a continuous optional postfix chain. If an owned value
in that chain is `none`, later field reads, checked list indexes, function or
method calls, and compiler-owned collection operations short-circuit to `none`.
Skipped index and call argument expressions are not evaluated, and a present
list still retains normal `IndexError` bounds behavior. A plain access that has
not entered an optional chain remains a diagnostic, optional function values
need either a presence proof or an explicit chain, and optional chains cannot
be assignment targets.

`if` and `while` accept only `bool` or an optional `T?` value.

```velar
if user:
    showProfile(user)

if score:       // compile error
if score != 0:  // valid
    showScore(score)
```

Numbers, strings, and collections do not participate in implicit truthiness.

Optional values are represented as `none` at the language boundary. Generated
JavaScript normalizes `undefined` from optional property access and optional
calls to `null` before the value returns to VelarScript semantics.

Presence and `is` checks narrow stable dotted record fields as well as local
names:

```velar
if draft.estimate:
    save(draft.estimate)

if user != none:
    showProfile(user)

if user == none:
    showMissingUser()
else:
    showProfile(user)
```

The fact applies to the same lexical root binding in the owned block, inline
branch, or JSX conditional branch. A shadowing declaration receives no old
fact. Calls, computed indexes, and optional-access chains are not treated as
stable storage locations.

Explicit `== none` and `!= none` checks are symmetric when `none` appears on
either side. They narrow both the present and absent branch as appropriate and
compose through block `if`, inline `? :`, successful `assert`, and adjacent JSX
`if` / `else-if` / `else` sequences. Later JSX conditions are checked under the
facts rejected by every earlier sibling, so the final `else` owns the complete
remaining case rather than restarting from the original optional type.

## 8. Functions and control flow

```velar
def greet(name: string) -> string:
    return f"Hello, {name}"
```

A function, method, or component `action` with no result annotation means
`-> none`; it is not an untyped or inferred result. It ends naturally at the
end of its body, and generated JavaScript returns the single Velar empty value
`null`. Source writes `return none` only for an early exit. A function that
returns a value declares `-> T` and must return that value on every path.

```velar
async def loadUser(id: string) -> User:
    const user = await http.get(f"/api/users/{id}").parse(User)
    return user
```

For every asynchronous declaration, including an `async def`, an async method,
and a component `action`, `-> T` names the resolved value rather than a
`Promise<T>` wrapper. Its callable type is `(...) -> Promise<T>`. Returning
either `T` or `Promise<T>` is valid: the generated JavaScript async function
uses native Promise adoption and never exposes `Promise<Promise<T>>`. Writing
`-> Promise<T>` on an asynchronous declaration is rejected so the language has
one unambiguous spelling for this contract.

Parameter defaults execute in the generated JavaScript parameter list, before
an async function body exists, so a default value cannot contain a direct
`await`, even on an asynchronous declaration. A nested async callback is a
separate boundary and remains valid, for example
`def schedule(work: () -> Promise<Job> = async () => await nextJob()): ...`.

Arrow functions are reserved for short expression callbacks:

```velar
const names = users.map(user => user.name)
const load: (string) -> Promise<User> = async id => await loadUser(id)
const wrap = value => {value, squared: value ** 2}
```

An async arrow has the same expression-only shape and resolved-result
annotation rule as an ordinary arrow. It creates a real JavaScript Promise,
permits `await` only inside its own async boundary, and adopts a Promise returned
by its expression instead of exposing `Promise<Promise<T>>`. A synchronous arrow
cannot inherit module-level or outer function permission to use `await`.
Promise values, including Lists produced by async JSX mapping, must be awaited
before they can become JSX children.
An arrow body is always one expression. In particular, `{...}` after `=>` is a
Velar object expression, never JavaScript's ambiguous block body; the compiler
groups it when emitting JavaScript so `value => {value}` returns an object.
Use a named `def` when a callback needs statements or multiple returns.
Explicit grouping is preserved when an awaited or arrow result becomes the
receiver of a field access or call, such as `(await load()).items`.

Function values use the same compact signature everywhere they are annotated:

```velar
const choose: (string) -> none = value => print(value)

component Choice(label: string, onChoose: (string) -> none):
    return <button type="button" on:click={() => onChoose(label)}>{label}</button>
```

- Parameter types appear inside parentheses and the result follows `->`.
- Parameter names are omitted because they do not change assignability.
- Compiler and LSP display labels append `= default` to a positional parameter
  that the caller may omit. This is deliberately distinct from `T?`, which
  means the caller may pass `none`; a defaultable `string` parameter does not
  become nullable merely because it can be omitted. A parameter that is both
  nullable and omittable displays both facts, for example `string? = default`.
- A single final rest element uses `...`, for example
  `(string, ...number) -> bool`.
- Callback parameters and results are checked for named functions, contextual
  arrows, object fields, component props, runtime type validation, and module
  interfaces.
- Async callbacks spell their result explicitly, such as
  `(string) -> Promise<User>`.
- Parentheses group a complete type when precedence matters. An optional
  callback is `((string) -> string)?`, while `(string) -> string?` means a
  present callback whose result is optional. Optional unions use
  `(string | number)?`.
- Function types do not introduce overloads, named optional parameters,
  user-defined generics, conditional types, or TypeScript-style type-level code.
- Imports, parameter lists, function-type parameters, type arguments,
  constructor/base arguments, Lists, objects, and calls accept a final comma.
  This keeps multiline source editable without making line layout semantic.

Functions and methods may end with one typed rest parameter:

```velar
def total(first: number, ...values: number) -> number:
    let result = first
    for value in values:
        result += value
    return result

const tail = [2, 3]
const sum = total(1, ...tail)
```

The annotation is the element type, so `values` is an immutable
`List<number>` binding inside the function. Rest parameters must be final,
must have an element type, and cannot have a default value. They are supported
by named functions, methods, expression arrows, and explicit `extern module`
functions. Components continue to use named JSX props, and class constructors
remain fixed-arity; neither accepts a rest parameter.

Public and local declarations may carry lightweight documentation comments:

```velar
/// Loads one profile from the checked API boundary.
///
/// Returns `none` when the profile does not exist.
export async def loadProfile(id: string) -> Profile?:
    // ...
```

Contiguous `///` lines at the declaration's indentation attach to the next
declaration. One optional space after `///` is removed, blank `///` lines create
Markdown paragraphs, and an ordinary blank source line or `//` comment breaks
the attachment. Documentation is compiler metadata only: it emits no JavaScript
and introduces no runtime docstring or reflection API. It follows exported
functions, types, classes, components, aliases, fields, methods, and props
through the project semantic graph into standard LSP hover and completion.
Documentation is capped at 16 KiB per symbol. JSDoc type tags are not parsed;
Velar annotations remain the sole type authority.

Block control flow uses indentation:

```velar
if user:
    showProfile(user)
else if session:
    restoreSession(session)
else:
    showLogin()

for user in users:
    user.update()

while game.running:
    game.update()
```

Block condition chains spell the middle branch `else if`, combining
JavaScript's familiar wording with Velar's colon-and-indentation blocks. Each
later condition is checked under the facts rejected by all earlier branches;
the final `else` owns the complete remainder. A chain whose every branch
returns or throws satisfies complete-return analysis and emits a flat
JavaScript `if` / `else if` / `else` chain. Velar does not add the separate
Python `elif` spelling.

Finite value branches use a non-fallthrough match block. String-backed enums
are the preferred form for application workflow states:

```velar
match request.status:
    case RequestStatus.queued, RequestStatus.running:
        showProgress()
    case "failed":
        showFailure()
    else:
        showResult()
```

`case` accepts one or more string, number, boolean, or `none` literals, or
qualified enum members. Values
use the same strict equality semantics as `==`, the matched expression is
evaluated once, every branch owns its lexical scope, and execution never falls
through. Duplicate literals and literals incompatible with the matched value's
type are errors. `else` is optional. A match over an enum must cover every
member when `else` is absent; a complete enum match participates in return
analysis without a redundant fallback. Destructuring patterns,
guards, expression-valued match, and wildcard binding are deliberately absent;
ordinary `if`, runtime `type` validation, and block-local destructuring remain
the explicit tools for those cases.

Application failures use explicit `Error` values:

```velar
class SaveError(const message: string) extends Error(message):
    pass

try:
    await save(document)
catch error:
    if error is SaveError:
        showSaveFailure(error.message)
finally:
    releaseLock()
```

`throw` accepts only an `Error` instance or subclass. A caught JavaScript value
that is not already an `Error` is wrapped as an `Error`, with the original value
preserved as its JavaScript `cause`; therefore the immutable catch binding
always has reliable `name`, `message`, and optional `stack` fields. `try` must
have `catch`, `finally`, or both. A `throw` terminates its control-flow path and
participates in explicit return-completeness analysis.

Validated program invariants use a Python-style assertion:

```velar
assert draft.estimate, "Estimate is required after form validation"
save(draft.estimate)
```

- `assert` accepts the same strict `bool` or optional condition as `if`.
- An optional condition proves presence, so `0`, `""`, and `false` remain
  present values rather than assertion failures.
- A successful assertion narrows a local name, stable dotted field, or `is`
  check for following statements in the current lexical block. The proof does
  not escape an inner block or cross a shadowed root.
- A current execution-point proof is not captured by a later function,
  component render, computed value, watcher, lifecycle block, or other deferred
  callback. Copy the narrowed value into a new `const` when deferred work needs
  to retain it.
- The optional message must be a string and is evaluated only when the
  assertion fails.
- Assertions remain active in production builds. Failure throws an `Error`
  whose name is `AssertionError`; the application error chain handles it like
  any other explicit failure.

Inline conditions use JavaScript ordering:

```velar
const label = online ? "Online" : "Offline"
```

Each branch owns the same proven narrowing as its block equivalent. For
example, `user ? user.name : "Guest"` treats `user` as present only in the
true branch, while `not user ? "Guest" : user.name` narrows the false branch.

Function parameters, including a rest list binding, are immutable inside the
function. Closures capture bindings, and captured `let` bindings remain shared
and mutable.

A function that reaches its end returns `none`. Omitting `-> T` is the concise
spelling of `-> none`, not a request for whole-body return inference. A function
with a non-`none` result must declare it and return along every reachable branch.

## 9. Equality and coercion

VelarScript provides `==` and `!=` with no implicit type conversion. It does not provide `===` because `==` already has strict semantics.

Primitive values compare by value. Objects, lists, functions, and class
instances compare by reference identity. Structural application-data equality
is explicit through `deepEqual` from `velar/json`. It recursively compares
records and Lists, compares Map values under native key identity, and compares
Sets under native membership. Class instances, functions, and other non-data
objects stay reference values. Separate cyclic graphs compare false rather than
overflowing; comparing one value with itself still follows identity.
`velar/test`'s `toEqual` matcher is defined by this same `deepEqual` contract;
tests do not receive a second, looser equality system.
`toBe` follows `==`, boolean assertions require actual booleans, and
subject-specific matchers are available only for compatible values. A wrong
subject type or synchronous throw cannot produce a false-positive assertion.

`and` and `or` accept and return booleans. `not` accepts a boolean or optional
value; for an optional it tests `none` presence rather than JavaScript
truthiness. They do not return arbitrary operands. Optional conditions likewise
treat `0`, `""`, and `false` as present values rather than as `none`.

Comparisons may use Python-style chains without Python's runtime or coercion:

```velar
const visible = 0 <= index < items.length
const ordered = start <= await currentPosition() < end
const unchanged = previous == current == saved
```

Every operand is evaluated from left to right at most once, and evaluation
stops as soon as one adjacent comparison is false. `==` and `!=` retain Velar's
strict value/identity semantics. Ordered operators `<`, `<=`, `>`, and `>=`
accept only two numbers or two strings at each link; booleans, objects, mixed
types, and JavaScript coercion are rejected. String order follows the native
JavaScript code-unit comparison used by the generated program. A direct
`await` remains part of the surrounding async expression and does not turn the
chain itself into a Promise.

`value in collection` is a typed membership test. Lists and strings use ordered
containment; native Set and Map use membership by value or key. Velar does not
expose JavaScript's prototype-chain form of object `in`. Write
`not (value in collection)` for the negative form.

`**` performs JavaScript Number exponentiation and is right-associative, so
`2 ** 3 ** 2` is `512`. Power binds before a leading unary sign:
`-2 ** 2` is `-4`, while `(-2) ** 2` is `4`; a signed exponent is valid, so
`2 ** -2` is `0.25`. An awaited value is the exponent base, therefore
`await loadNumber() ** 2` means `(await loadNumber()) ** 2`. These forms always
lower to syntactically valid JavaScript rather than inheriting its exponent and
unary parse restriction accidentally.

`%` and `%=` use JavaScript remainder semantics, including the sign of the left
operand and `NaN` for division by zero. Velar does not silently substitute
Python modulo semantics.

```velar
"Score: " + 10       // compile error
f"Score: {10}"       // valid
"Score: " + str(10)  // valid
```

`print(value)` is the small Core output function. `str(value)` performs explicit
string conversion. `number(text)` is the inverse only for complete finite
decimal text and returns `number?`; empty text, partial numbers such as
`"12px"`, hexadecimal syntax, `NaN`, and infinity return `none` instead of
coercing or leaking a JavaScript sentinel. Both conversion functions and
`print` are compiler-owned bindings and cannot be shadowed.

## 10. Objects, List, Set, and Map

Fixed-shape object:

```velar
const user = {
    name: "Ada",
    age: 24,
}

const name = "Grace"
const active = true
const draft = {name, active}
```

Once an object's shape is known, unknown fields cannot be added silently. Dynamic keys use `Map`.
An identifier may stand for a same-named field, so `{name, active}` is the
concise form of `{name: name, active: active}`. Quoted field names always
require `: value`, and writing the same explicit field twice is a compiler
error. Spread remains ordered and may be followed by explicit fields for an
intentional immutable override:

```velar
const completed = {...task, status: TaskStatus.done}
```

Application operations with several related values should normally accept one
record `type` rather than a fragile positional parameter list. This keeps call
sites named and readable without adding Python keyword-argument metadata:

```velar
type TaskDraft:
    title: string
    description: string
    priority: TaskPriority

def createTask(draft: TaskDraft) -> Task:
    const {title, description, priority} = draft
    // ...

createTask({title, description, priority})
```

List:

```velar
const users = [ada, linus]
```

- List type syntax is `List<User>`.
- `users[index]` throws `IndexError` when out of bounds.
- `users.get(index)` returns an optional value.
- `users.append(value)` mutates the List by adding one value and returns `none`.
- `users.extend(values)` mutates the List by adding every value from another
  typed List and returns `none`. Growth is checked before mutation, so overflow
  never leaves a partially extended List.
- An unannotated empty List takes its element type from its first direct
  `append` or `extend`, matching the existing first-write inference for empty
  Map and Set values. Later incompatible mutations fail checking.
- `users.slice()`, `users.slice(start)`, and `users.slice(start, end)` return a
  typed shallow copy without mutating the source. Positions are stop-exclusive
  integers; negative values count from the end and out-of-range positions are
  clamped. A fractional, infinite, or `NaN` position throws `TypeError` instead
  of being coerced by JavaScript.
- Velar intentionally does not expose JavaScript's variadic `push`: `append`
  and `extend` keep single-value and List growth distinct while lowering to
  native arrays internally.

Map:

```velar
const users = Map()

users.set(user.id, user)
const result = users.get(user.id)
```

Map types are inferred where possible. Explicit annotations use:

```velar
const users: Map<string, User> = Map()
```

Iterating a `Map` yields keys. `Map.get` normalizes a missing JavaScript value to
`none`; `set` and `clear` return `none`. `keys()`, `values()`, and `entries()`
return ordered List snapshots. An entry is `{key, value}`; native iterator
objects never leak into Velar source. `Map(existing)` creates a typed shallow
copy, while other constructor arguments are rejected.

Set:

```velar
const tags = Set(["velar", "web", "velar"])
tags.add("game")

if tags.has("web"):
    print(tags.size)

for tag in tags:
    print(tag)
```

`Set()` creates an empty set and infers its element type from the first
`add`. `Set(list)` constructs from a typed `List`; duplicate values collapse
using JavaScript's SameValueZero membership semantics and iteration preserves
JavaScript insertion order. `add` and `clear` return `none`, while `has` and
`remove` return `bool`. `values()` returns an insertion-ordered List snapshot.
Explicit annotations use `Set<User>`. The constructor
never takes a type argument: write `const users: Set<User> = Set()`, not a
generic call spelling.

## 11. Types and runtime validation

```velar
type User:
    id: string
    name: string
    avatar: string?

type TreeNode:
    label: string
    children: List<TreeNode>
```

A named `type` is the single source of truth for static assistance and optional runtime validation.

The same declaration also gives a readable name to an existing type:

```velar
type Identifier = string
type TaskIdHandler = (Identifier) -> none
type Users = List<User>
```

The colon form declares a structural record. The equals form declares a
transparent alias: it does not create a new nominal identity, and checking uses
its expanded target. Aliases may be exported, renamed, and used through
transitive module boundaries. They do not accept type parameters and cannot be
recursive.

Record declarations may refer to themselves or each other when a finite value
can terminate through an optional, collection, or union branch. A required
cycle such as `type Loop: next: Loop`, including cycles hidden behind an alias
or a union with no terminating member, is rejected. Runtime validation accepts
finite trees and shared acyclic subtrees, but rejects cyclic object graphs and
excessive nesting without exposing JavaScript stack overflows.

```velar
const user = User.parse(raw)

if raw is User:
    showUser(raw)
```

- `User.parse` or `Users.parse` validates and returns the expanded type or throws `ValidationError`; List validation requires dense arrays with ordinary data elements and no hidden extra fields at unsafe JavaScript boundaries. Accessor elements are rejected without invoking their getters.
- `raw is User` and `raw is Users` check and narrow.
- A type used only statically can be erased completely.
- Runtime validation code is emitted only when runtime type operations are used.
- Every emitted record Type, runtime alias, and enum is frozen and registered
  under one module-independent runtime identity. Standard-library Type
  parameters accept only that identity; matching `is`/`parse` field names do
  not constitute a Type and accessor-backed forgeries are never read.
- There is no separate `schema`, `interface`, or alias declaration keyword.

VelarScript supports primitives, optionals, lists, maps, function signatures,
object shapes, simple unions, productive recursive records, and local
inference. It does not support conditional types, mapped types, declaration
merging, recursive transparent aliases, or complex generic constraints.

Simple unions narrow through runtime `is` checks:

```velar
type DisplayValue = string | number | bool

def display(value: DisplayValue) -> string:
    if value is string:
        return value
    else if value is number:
        return str(value + 1)
    else:
        return value ? "yes" : "no"
```

The positive branch receives the checked type. A rejected check removes only
members that are fully covered by that runtime type, so later `else if` and
`else` branches receive the remaining finite union. The same rule applies to a
local or stable dotted field through `not`, inline branches, successful
assertions, and adjacent JSX conditions. Facts remain lexical and do not escape
the owned branch. This is bounded flow assistance, not user-programmable type
subtraction or conditional-type evaluation.

Object data types are structural. Classes are nominal runtime identities.

Finite string-backed values use one declaration rather than open strings:

```velar
enum TaskStatus:
    todo
    doing
    done

const status: TaskStatus = TaskStatus.todo
```

Members serialize as their string names and are assignable to `string` at Web
and storage boundaries. A plain string is not assignable back to the enum;
dynamic data uses `TaskStatus.parse(value)`. Distinct enum declarations remain
distinct even when their members or imported display names match. Enum member
completion, hover, definition, references, and safe project-wide rename are
compiler/LSP-owned.

## 12. Classes

```velar
abstract class Entity(const id: string):
    abstract def describe() -> string

class Player(const id: string, let score: number = 0) extends Entity(id):
    static const kind: string = "player"
    private const achievements: List<string> = []
    let sessions: number = 0

    init:
        assert id.length > 0, "Player id cannot be empty"

    get label() -> string:
        return f"{self.id}: {self.score}"

    override def describe() -> string:
        return f"{self.id}: {self.score}"

    private def achievementCount() -> number:
        return self.achievements.length

    static def guest() -> Player:
        return Player("guest")
```

```velar
const player = Player("Nova")
```

- Construction does not use `new`.
- Constructor parameters describe caller input. A parameter prefixed with
  `const` or `let` also declares a public instance field, preserving the compact
  form for values supplied by the caller.
- `private const` and `private let` constructor parameters keep the same caller
  input while making the resulting field visible only inside its declaring
  class.
- Body-owned instance state is declared directly in the class body with
  `const name: Type = value` or `let name: Type = value`. It is initialized once
  per instance after base construction and constructor-parameter fields, and it
  does not appear in the constructor signature.
- Class-body fields require an explicit type so their module, inheritance, and
  editor contracts never depend on declaration order. Their initializer may use
  constructor parameters and module bindings, but not `self`, `super`, or
  `await`; methods use `self` after construction is complete. Invalid field
  structure reports the stable parser diagnostic `VEL2021`.
- A class may contain one `init:` block for synchronous construction logic that
  needs the initialized instance. Construction runs in one fixed order: native
  base construction, constructor-parameter fields, instance field
  initializers, instance method binding, then `init:`. If `init:` throws, the
  object never escapes to the caller.
- `init` is contextual rather than globally reserved. Ordinary bindings, record
  fields, object fields, and methods may still use that name; only the direct
  class-body form `init:` opens the construction block.
- `init:` may use constructor parameters, `self`, inherited members, locals,
  assertions, loops, and ordinary synchronous calls. It is not a method, is not
  inherited or callable, and is absent from class/module member interfaces.
  Direct `return` and direct `await` are invalid; a nested function or async
  arrow owns its own later execution boundary and remains valid. `init:` cannot
  be modified with `async`, `static`, `private`, `override`, or `abstract`.
- `static const` and `static let` declare class-owned fields initialized once.
  They are accessed through the class, remain separate from instance members,
  and preserve the same assignment rules as ordinary `const`/`let` fields.
- A `const` field cannot be rebound, but a referenced List, Map, Set, or object
  retains normal JavaScript reference and mutation behavior.
- `get name() -> Type:` declares a read-only property whose body runs on each
  read. It takes no parameters, requires an explicit result type, and lowers to
  a native JavaScript getter rather than a cached field or hidden method call.
  Writable state remains an explicit `let` field; Velar does not add setters.
  Instance getters use `self`, static getters use the class name, and getter
  reads use `value.name` without parentheses.
  `get` is contextual rather than globally reserved: ordinary bindings, checked
  data fields, and public class fields/methods may still use that name.
- Class fields, getters, and methods are public by default. `private` may modify a
  constructor-backed field, body field, getter, or concrete instance/static method.
  Source still uses `self.name` or `ClassName.name` inside the declaring class;
  lowering uses native JavaScript `#name` storage and class-external access is a
  compile error. A declaring-class method may read the private slot of another
  instance of that class, matching native JavaScript identity semantics.
- Private members are absent from exported module interfaces and outside
  completion/navigation/refactoring. They are not inherited, cannot be
  `abstract` or `override`, and cannot collide with an inherited public member.
  Velar deliberately has no redundant `public` spelling and no `protected`
  hierarchy. `private` is a reserved source word because JavaScript modules
  also reserve it in strict mode; accepting it as a binding would emit invalid
  JavaScript. Property positions remain distinct from bindings, so a checked
  record/object field, enum member, public class field, or method may still be
  named `private` when an external Web data/API contract requires that key.
- Methods use explicit `self`.
- A method retains its instance when passed as a callback.
- Classes use single inheritance through `extends Base(arguments)`; empty
  constructor parameter lists and empty base argument lists may be omitted.
- Base construction is explicit and lowers to native JavaScript `super(...)`.
- Replacing an inherited instance method or getter requires `override` and an
  identical signature/result contract. Accidental overrides and invalid
  overrides are errors.
- `super.method()` calls an inherited method and `super.name` reads an inherited
  getter from an instance override.
- Abstract classes cannot be instantiated. Every concrete subclass must
  implement its inherited abstract methods and getters.
- `static def` declares a class method and `static get` a class property; neither
  exposes `self`. Static field, getter, and method names cannot collide.
- A derived instance is assignable to its base class and satisfies
  `value is Base` through native JavaScript identity.
- `Error` is the built-in base for nominal application errors.
- `pass` is available for intentionally empty class or function bodies.
- Prototype manipulation is not exposed.
- Setters, multiple inheritance, mixins, decorators, overloads, operator overloading,
  metaclasses, and a parallel interface system are outside the current
  language contract.

## 13. Modules and JavaScript boundaries

VelarScript module:

```velar
import {Button} from "./Button.vel"
```

Official Core capabilities use explicit, tree-shakeable modules rather than
global names or prototype extensions:

```velar
import {groupBy, range, sum} from "velar/collections"
import {title} from "velar/text"
import {parse as parseJson} from "velar/json"
import {iso, now} from "velar/time"
import {logger} from "velar/log"
```

The Web browser module keeps imperative accessibility operations explicit:
typed JSX refs may be passed to `focus(element, preventScroll=false)` and
`blur(element)` without exposing `document.activeElement` or arbitrary DOM
method access.

Standard API 0.4 contains `velar/collections`, `velar/text`, `velar/math`,
`velar/json`, `velar/async`, `velar/url`, `velar/time`, `velar/id`, and `velar/log`. The compiler owns lightweight
polymorphic signatures for these built-ins, so `find(users, ...)` is `User?`
and `groupBy(users, ...)` retains `List<User>` values without exposing a generic
type language. The modules preserve JavaScript runtime semantics, use `none`
for missing results at the Velar boundary, and do not mutate built-in
prototypes. The complete contract is [standard-library.md](standard-library.md).

Official collection/async/List-taking helpers enforce real dense Lists at
dynamic boundaries. Collection predicates return actual booleans, collection
membership/counting follows Velar `==`, and ordering accepts one uniform
string or non-NaN number key type without JavaScript mixed-type coercion.
Stable sorting retains equal-key order in both directions.

Official math functions also validate actual numbers instead of exposing
native `Math.*` argument coercion. Integer-only helpers use the exact safe
integer range, and an inexact `lcm` fails rather than returning a rounded value.
URL helpers likewise require real strings; query construction converts only
documented scalar/List values and never serializes arbitrary objects as
`"[object Object]"`.
Structured logging validates real text, string field keys, and `Error` values;
each sink receives an isolated fields snapshot rather than shared mutable
delivery state.
Text length/count operations require explicit safe integers, and dynamic
pattern option records are data-only; validation never invokes accessors.

JSON is an explicit lossless data boundary, not a pass-through to ambient
`JSON.stringify`. Finite primitives, `none`, dense Lists, and record data are
supported recursively. Known Map, Set, class, function, Promise, Web-node, and
other non-data values fail checking; unknown/unsafe values, cycles, sparse
Lists, accessors, symbols, and non-finite numbers fail runtime validation.
Storage, HTTP JSON bodies, and realtime `sendJson` reuse the same rule so
persistence and network writes cannot silently omit fields or replace values
with `{}` / `null`.

Time remains epoch milliseconds internally, but Velar does not expose native
`Date` rollover or engine-dependent parsing. Calendar constructors reject
nonexistent fields and years 0–99 keep their literal year; parsing accepts only
the documented deterministic ISO date or offset-bearing datetime grammar.
JSON/storage validators are always a compiler-registered Velar record Type,
runtime alias, or enum. Arbitrary objects cannot bypass validation, including
through `tryParse` or an otherwise empty storage read. Type/key/value arguments
are validated before storage is touched, so an invalid call cannot acquire a
browser capability merely to discover that its contract was malformed.

Text patterns are ordinary `velar/text` functions, not new literal grammar and
not source-level `RegExp` objects. `matches`, `findMatch`, `findMatches`,
`replaceMatches`, and `splitPattern` create a fresh Unicode pattern for each
call. The only source options are typed `ignoreCase`, `multiline`, and `dotAll`
booleans; global iteration is selected by the operation. This preserves the
host JavaScript matching engine without exposing mutable `lastIndex`, arbitrary
flag strings, or replacement-string interpolation semantics.

### Bounded execution inputs

Velar keeps JavaScript's runtime and memory model, but it does not expose
unbounded convenience APIs as if allocation could never fail. One source
module is limited to 4 MiB, 250,000 tokens, and 512 delimiter/indent levels; a
project contains at most 4,096 Velar modules. Runtime Lists, Sets, and Maps
contain at most 1,000,000 items. List spread, collection construction, and
`append`/`extend`/`add`/`set` preserve that invariant; replacing an existing Set value or
Map key remains valid at the ceiling. Strict JSON and ordinary text are limited
to 16 MiB, JSON graphs to 1,000,000 values/128 nested collections, and URLs to
2 MiB.

Fan-out, browser forms/routes/storage, file reads, realtime messages, HTTP
responses, and production asset inventories have documented ceilings in their
own API contracts. Limits are checked before copying a collection, consuming a
browser body, starting a native side effect, or replacing a verified build.
They are part of Velar's failure semantics (`RangeError`/diagnostic), not a new
VM, allocator, or execution environment.

Reusable Velar libraries are ordinary npm packages that publish `.vel` source:

```json
{
  "name": "my-velar-library",
  "version": "1.0.0",
  "velar": { "entry": "src/index.vel" },
  "files": ["src"]
}
```

```velar
import {Button} from "my-velar-library"
```

The compiler resolves the declared entry, analyzes it in the application
project graph, and bundles it for the browser. A package entry must be a
relative `.vel` path inside the package root; relative imports from package
source cannot escape that root. Velar uses npm resolution and does not define a
second package manager or declaration language.

Application code may load a local Velar module on demand:

```velar
const reports = await import("./pages/reports.vel")
const summary = reports.createSummary()
```

Dynamic module loading is deliberately narrower than JavaScript `import()`:

- The path is a string literal beginning with `./` or `../` and ending in
  `.vel`; runtime-computed paths and bare package names are rejected.
- The result is a `Promise` of the checked module export object, so missing
  members and wrong calls remain compiler errors.
- The dependency participates in root confinement, incremental invalidation,
  source navigation, production manifests, and deterministic code splitting.
- A dynamically loaded module cannot export top-level `state` or `computed`;
  it exposes behavior through functions, classes, types, or components.
- JavaScript remains available only through the existing explicit static
  `import js` boundary; Velar does not add unchecked dynamic JavaScript imports.

JavaScript module:

```velar
import js {marked} from "marked"
```

JavaScript values without an understood declaration enter as `unknown`, not `any`.

`any` is not an ordinary VelarScript annotation. It exists only behind an
explicit `import js unsafe` boundary.

The compiler consumes a deliberately limited subset of common TypeScript
declaration files for npm packages. Exported functions/constants, simple
constructable classes, local declaration export tables, primitives,
simple unions, arrays, promises, records, object fields/methods, directly
expandable non-generic interface bases, aliases, and non-generic callback
parameters map to Velar types. A class is accepted only when one constructor,
its public fields/accessors, instance methods, and static fields/accessors/methods
form one complete non-generic contract; getter-only properties are read-only,
while a same-typed getter/setter pair is mutable. Simple local or relatively imported bases retain inherited
contracts, and identity is the declaration file plus original local class name.
Abstract/generic or unresolved class hierarchies, overloads,
recursive and type-level constructs degrade to `unknown` with a non-blocking
`VEL9002` notice. Unknown values still cannot be called or accessed through a
safe import.

Package declaration entrypoints may re-export runtime declarations through
relative named or star exports. The compiler follows only real declaration
files confined to that package root, with fixed file/depth/aggregate-byte
limits. Original declaration identity survives aliases and re-exports;
cycles, missing exports, and ambiguous stars never pick a contract silently.
Relative named type imports may feed signatures and class bases without becoming
runtime imports. `export type` and type-only local export specifiers remain absent
from the JavaScript value surface.
Package export maps may select root, exact subpath, or one-wildcard subpath
declarations through a `types` condition. `.d.ts`, `.d.mts`, and `.d.cts`
entries share the same bounded graph rules, and one physical declaration keeps
one nominal identity even when the package root and a subpath both expose it.

A manual declaration uses VelarScript syntax:

```velar
extern module "marked":
    export const version: string
    export def marked(source: string) -> string

    export class Parser(const source: string, let position: number = 0):
        static const version: string
        def parse() -> string
        static def from(source: string) -> Parser
```

An extern `const` describes a read-only runtime export and has no initializer;
an extern `def` describes a callable export. Both reuse ordinary Velar types.
An extern class keeps construction, mutable/read-only fields, instance methods,
static fields/methods, aliases, and nominal module/export identity together; it
is neither flattened into a structural object nor treated as a callable value.

VelarScript does not embed arbitrary JavaScript in `.vel` files. Complex
compatibility code belongs in a separate `.js` adapter imported through
`import js`.

## 14. `@velarscript/web`: JSX

JSX is a native expression contributed by `@velarscript/web`; it is not React
JSX and is rejected by a Core-only project.

```velar
return <main class="page">
    <Profile if={user} user={user} />
    <Login else />

    <ul>
        {users.map(user =>
            <UserRow key={user.id} user={user} />
        )}
    </ul>
</main>
```

- Native HTML uses `class` and `for`.
- Text is escaped by default.
- Raw HTML requires `unsafe:html`.
- Dynamic lists require stable keys unless the compiler proves the list is static.
- Small value choices use `? :`. Whole conditional views use adjacent JSX
  branches: `if={condition}`, any number of `else-if={condition}` elements, and
  an optional valueless `else` element.
- Branch conditions use the same strict `bool`/optional rules as block `if`.
  Optional identifiers narrow within their element, attributes, descendants,
  and component props.
- Only whitespace may separate a branch sequence. Orphan or reordered branches,
  valued `else`, missing expression braces, and multiple control attributes are
  compile errors. Control attributes are compiler syntax, not DOM attributes or
  component props.
- Branch replacement is reactive and transactional. Each selected branch owns
  its nested components, events, resources, actions, observers, and refs; a ref
  must be an optional element binding and returns to `none` when its owner is
  destroyed.
- Native `<svg>` enters the SVG DOM namespace. That namespace is preserved
  through nested native nodes, keyed/dynamic branches, fragments, ordinary and
  `lazy(...)` component boundaries; `<foreignObject>` returns its child subtree to the HTML
  namespace, and a nested `<svg>` enters SVG again. This is compiler lowering,
  not a runtime tag-name heuristic or an SVG-specific component framework.
- SVG attributes retain their source spelling, including case-sensitive names
  such as `viewBox`. `xlink:*` and `xml:*` attributes use their native attribute
  namespaces; new source should prefer the standard unprefixed `href` where the
  platform supports it.
- A source `<svg>` must have a non-empty `<title>`, `aria-label`, or
  `aria-labelledby`, unless it explicitly declares `aria-hidden="true"`. A tag
  that merely looks like SVG but was created as an HTML unknown element is a
  compiler defect, not acceptable compatibility behavior.

## 15. `@velarscript/web`: components and state

```velar
component Counter(start: number = 0):
    state count = start
    computed doubled = count * 2

    def increment():
        count += 1

    return <button on:click={increment}>
        Count: {count}, Double: {doubled}
    </button>
```

- A component body initializes once.
- State changes do not re-run the complete component.
- The compiler emits precise DOM updates.
- Velar Web does not use a virtual DOM.
- `state` declares reactive data.
- `computed` declares cached pure derived data.
- Runtime effects are internal and are not part of the source language surface.
- State is not implemented as a deep JavaScript Proxy.
- The compiler instruments visible state assignments and direct mutations.
- Component construction is transactional. If setup or initial JSX creation
  throws after acquiring a watcher, timer, connection, or other handle, the
  sibling `cleanup` steps run independently, the compiler-owned scope is
  destroyed, and the original construction error remains the recovery cause.
  A failing cleanup step is reported but cannot replace that original error or
  prevent later cleanup steps.

Component-owned asynchronous data uses `resource`, not a hand-written
`mounted` block plus several state variables:

```velar
component TicketList:
    resource catalog: List<Ticket> = loadTickets()
    computed failure = catalog.error

    return <main>
        {catalog.loading ? <p aria-busy="true">Loading…</p> : none}
        {failure ? <p role="alert">{failure.message}</p> : none}
        {catalog.value ? <TicketTable tickets={catalog.value} /> : none}
        <button type="button" on:click={catalog.reload}>Reload</button>
    </main>
```

- A resource is valid only directly inside a component and cannot be exported.
- Its initializer must return `Promise<T>`; the optional annotation names `T`,
  not `Promise<T>`.
- Its immutable binding exposes `value: T?`, `loading: bool`, `ready: bool`,
  `error: Error?`, and `reload: () -> Promise<none>`.
- It starts once after the component mounts. `reload` is explicit; resources do
  not rerun by implicitly observing arbitrary dependencies.
- Reload clears the prior error while retaining the last valid value. The most
  recent load generation wins, and completions after destruction are ignored.
- Rejections are normalized to `Error` and reported through `velar/app` with
  phase `resource`; the application may render and retry without a blank page.
- Velar does not claim to cancel the underlying JavaScript Promise. It prevents
  obsolete completions from publishing state.
- Runtime effects remain internal and are not a source-language API.

User-triggered asynchronous operations use `action` when the component needs
pending and failure state:

```velar
component ActivityFeed:
    state message = "Not refreshed"

    action refresh():
        const activity = await loadActivity()
        message = activity.message

    computed failure = refresh.error

    return <section>
        <p>{failure ? failure.message : message}</p>
        <button disabled={refresh.pending} on:click={refresh}>Refresh</button>
    </section>
```

- An action is valid only directly inside a component, cannot be exported, and
  is implicitly asynchronous.
- It is called like a function and accepts typed parameters, defaults, rest
  parameters, and a result annotation using the same rules as `def`.
- Its immutable binding additionally exposes `pending: bool` and
  `error: Error?`.
- `pending` remains true while any invocation is active. Starting a new call
  clears the previous error, and only the newest call may publish a failure.
- A successful call resolves with its declared value. A failed non-`none`
  action resolves to `none`, so its call type is `Promise<T?>`; an action that
  returns `none` has call type `Promise<none>`.
- A current failure is normalized and reported once through `velar/app` with
  phase `action`. It does not also become an unhandled event rejection.
- Use ordinary `async def` when rejection and explicit `try`/`catch` are part of
  the workflow contract. `action` is the component UI-operation boundary.
- Completion after component destruction cannot publish action state. Velar
  invalidates stale ownership but does not claim to cancel a JavaScript Promise.

## 16. Watch

```velar
watch online:
    saveStatus(user.id, online)
```

```velar
watch query as current, previous:
    print(f"{previous} -> {current}")
```

- Watch does not run during initial setup by default.
- Multiple synchronous state changes produce one scheduled run.
- Watch runs after the DOM commit by default.
- Watch observes its explicit expression rather than performing implicit deep traversal.

## 17. Lifecycle

```velar
component CanvasHost:
    let canvas: CanvasElement? = none
    let resource = none

    mounted:
        resource = initializeCanvas(canvas)

    cleanup:
        resource?.destroy()

    return <canvas ref={canvas}></canvas>
```

- `mounted` runs once after managed DOM is inserted.
- `cleanup` runs once before component destruction.
- They are sibling component-level blocks.
- Each component has at most one of each.
- Shared resources live in component scope.
- Cleanup is not nested inside `mounted` or `watch`.
- Compiler-owned `resource` declarations are disposed before stale asynchronous
  completions can publish into a destroyed component; applications do not place
  resource cleanup inside `mounted`.
- Component-owned actions follow the same destruction boundary for their
  pending and error state.

## 18. DOM scheduling

State writes are visible immediately. DOM changes are batched until the end of the current synchronous task.

```velar
count += 1
count += 1
count += 1
```

The example produces one DOM commit. Code that needs the committed DOM uses:

```velar
await tick()
```

Component destruction removes managed event listeners and DOM, destroys child components, and executes `cleanup`.

## 19. Forms and styling directives

```velar
<input bind:value={query} />
<input type="number" bind:value={page} />
<input type="checkbox" bind:checked={enabled} />
```

Binding targets must be writable state. `input`, `textarea`, and `select` use
their natural string value; numeric inputs preserve numbers and checked inputs
preserve booleans.

Unbound native forms can be decoded with the same record type used everywhere
else; there is no separate form schema:

```velar
type SignupDraft:
    name: string
    role: AccountRole
    updates: bool
    age: number?

const draft = read(form, SignupDraft)
```

The bounded decoder supports flat strings, finite numbers, checkbox booleans,
enums, repeated `List<string>` fields, and optional scalar values. It does not
infer business validation, messages, trimming, submission, or nested object
construction. Those choices remain explicit application behavior.

Event modifiers are explicit and composable:

```velar
<form on:submit.prevent.stop={save}></form>
```

Supported modifiers are `prevent`, `stop`, `once`, `capture`, and `self`.

Handlers receive the browser's native event directly. They may ignore it or
accept one checked parameter:

```velar
def addOnEnter(event: KeyboardEvent):
    if event.key == "Enter":
        event.preventDefault()
        addItem()

return <input on:keydown={addOnEnter} />
```

- `Event` exposes `type`, `defaultPrevented`, `preventDefault`, and
  `stopPropagation`.
- `KeyboardEvent` adds key, code, repeat, and modifier state.
- `PointerEvent` adds pointer identity/type, pressure, buttons, coordinates,
  movement, and modifier state.
- `InputEvent` adds optional data, input type, and composition state.
- `keydown`/`keyup`, pointer events, and `input`/`beforeinput` select those
  families. Other event names conservatively provide `Event`.
- Zero-parameter handlers remain valid. A handler with one parameter must accept
  the selected event type; rest or additional parameters are compile errors.
- These are structural Web types over the native object, not synthetic events
  and not permission to use raw browser globals.

```velar
<div
    class="card"
    class:active={active}
    style:--progress={progress}
></div>
```

## 20. CSS

CSS remains standard CSS inside a scoped component block:

```velar
component Card:
    style:
        .card {
            display: grid;
            gap: 12px;
        }

        .card:hover {
            transform: translateY(-2px);
        }

    return <article class="card"></article>
```

- Component CSS is scoped by default.
- A scoped selector may style a child component's top-level DOM root. The
  parent's scope marker is attached only to that root (or each top-level root
  in a fragment), so arbitrary DOM inside the child remains private.
- Production builds extract static CSS.
- Global CSS requires `style global:`.
- VelarScript Web does not create a CSS-in-JS object system.

## 21. Velar Compiler

The project builds the Velar Compiler from zero.

- Product name: Velar Compiler.
- Source language compiled: VelarScript.
- User CLI: `velar`.
- An internal binary may use the name `velarc`.
- No old compiler source, architecture, Git history, or language authority is inherited.
- The compiler implementation language is not part of the permanent language contract.

Compiler stages:

```text
Source
-> Lexer
-> Parser
-> AST
-> Scope Resolution
-> Type Analysis
-> Web Reactivity Analysis
-> JSX and CSS Lowering
-> JavaScript AST
-> Code Generation
-> Source Map
```

Core compilation must remain separable from the Velar Web lowering layer.

## 22. Projects and tools

A typical application contains:

```text
my-app/
├── src/
│   ├── main.vel
│   ├── app.vel
│   ├── app.test.vel
│   └── app.browser.test.vel
├── public/
├── velar.json
└── package.json
```

`velar.json` is intentionally small:

```json
{
  "formatVersion": 2,
  "entry": "src/main.vel",
  "outDir": "dist",
  "publicDir": "public",
  "extensions": ["@velarscript/web"],
  "web": {
    "title": "My App",
    "base": "/",
    "build": { "sourceMaps": false },
    "security": { "contentSecurityPolicy": true },
    "deployment": { "spaFallback": true, "adapter": "neutral" }
  }
}
```

Implemented commands:

```text
velar dev
velar build
velar verify
velar preview
velar verify-deployment --url <https-origin>
velar check
velar test
velar test --browser [chromium|firefox|webkit|all]
velar format [file.vel | project-directory] [--check]
velar lsp
velar create
```

`.test.vel` files are discovered recursively. Top-level functions named
`test_*` are tests and do not need to be exported. Assertions come from
`velar/test`. `.browser.test.vel` files are excluded from Core tests and run
only through `--browser`; they import the restricted typed `browser` controller
from `velar/web-test`,
not raw DOM or Playwright APIs. Each browser test receives a fresh context
against a real isolated CSP production build.

`velar create` refuses non-empty target directories and creates a minimal
format-version-2 application with a separate application module, entry point,
Core test, browser test, and project-level formatting scripts. Project-format
mode recursively owns `.vel` source while excluding `node_modules`, `.git`, the
public directory, and build output. Legacy and unknown future project format
versions fail closed; there is no compatibility loader or upgrade command.
Creation is transactional: all files are completed in a
sibling staging directory before an absent or verified-empty target is replaced.
Manifest and nested Web objects reject unknown fields, so misspelled settings do
not silently fall back; `web.base` is one canonical application pathname.

`velar help <command>` and `<command> --help` describe each public command and
its defaults. Unexpected top-level arguments return a usage error, while
unexpected operational failures are normalized without exposing a Node stack as
the command-line contract.

Official Web modules are explicit imports contributed by `@velarscript/web`.
Their stable public API version is 0.7 and is specified in
[web-api.md](web-api.md):

- `velar/app`: compiler-owned application error reporting, classification,
  root-mount fallback, last-valid render retention, and explicit handler cleanup.
- `velar/config`: validated, recursively frozen public build configuration from
  the explicit `velar.json.web.publicConfig` object; it never reads environment
  variables or secrets.

- `velar/web`: `RouteContext`, `route`, `Router`, `Link`, `NavLink`, `Head`, `navigate`, `redirect`,
  `back`, `forward`, `reload`, `currentRoute`, and `announce`; application paths
  remain relative to `web.base`. Mounted navigation constructs its target
  before committing: construction failure reports through `velar/app`, retains
  the active page, and leaves later navigation usable. An initial route failure
  still belongs to the root mount fallback. An unmatched route renders a small
  accessible default 404; a custom fallback is checked by the same route
  component contract and receives typed `RouteContext`. Route patterns are
  pathname-only, reject query/hash/backslash/empty or redundant segments, and
  expose a terminal `*` through the reserved `wildcard` parameter. Undecodable
  parameter text is a 404 non-match rather than a fatal render.
- `velar/forms`: raw and individual typed reads plus compiler-described flat
  record decoding through the existing `type` family, reset, field/error
  ownership, first-error focus, and pending form state with accessible native
  semantics.
- `velar/http`: typed lazy request methods/options/responses, idempotent
  pre-start or active cancellation, stable `HttpAbortError` timeout/cancel
  reasons, non-2xx `HttpError`, `type`-backed response parsing, and strict
  lossless JSON request bodies; options/methods/headers/body kinds are checked
  before Fetch can coerce them.
- `velar/storage`: local/session persistence, namespaces, watches, and
  asynchronous IndexedDB, all with strict JSON values and Velar runtime types;
  database operations resolve at transaction commit and retry failed opens.
- `velar/browser`: typed environment/location snapshots, clipboard, layout,
  scrolling, native `DialogElement` operations, frame, media, online,
  visibility, and explicitly stopped one-shot/repeating timers.
- `velar/files`: cross-browser file selection, text/data-URL reads, and
  downloads without persistent browser file handles.
- `velar/realtime`: explicitly closed WebSocket and server-sent-event wrappers;
  `sendJson` shares the strict lossless JSON data boundary.
- `velar/test`: typed Core assertions.
- `velar/web-test`: the Web extension's restricted project-level browser
  controller for production application tests.

Ordinary Velar source does not receive untyped `console`, DOM/window,
navigation, Fetch, JSON, Math, or Date globals. The compiler points to `print`,
JSX/refs, the official Core/Web modules, or an explicit JavaScript boundary.
Watchers, timers, and realtime connections return cleanup functions; component
code owns them from the sibling `cleanup` lifecycle block. Repeating timers do
not overlap a still-running asynchronous callback. Managed browser, storage,
WebSocket, and server-sent-event callbacks report throws and rejected promises
through `velar/app`; native event dispatch never becomes a second unowned error
channel. `mounted` may await asynchronous initialization. Cleanup stays
synchronous, reports each failing step through `velar/app`, and continues the
remaining independent steps.

Production builds use an isolated staging directory, bundle and tree-shake
dependencies, minify output, use content-hashed JS/CSS names, retain
code-splitting support, and produce byte-identical output for identical inputs
regardless of staging/output location. Linked source maps containing Velar
sources are opt-in through `web.build.sourceMaps`; generated projects default
to `false`. `velar-build.json` format
2 records deterministic build identity, compiler/API versions,
application/package module composition, deployment files, asset roles, byte
sizes, SHA-256 identities, source-map policy, and separate Velar/JavaScript
dependency summaries.
`velar-deploy.json` defines the base path, SPA fallback, security headers, and
cache policy for static-host adapters. The explicit root-base Netlify adapter
translates that contract to `_headers` and `_redirects`; both files participate
in build identity. Compiler-owned HTML, manifests, and adapter files cannot be
overridden from `publicDir`.

`velar verify` treats `velar-build.json` as an exact inventory: normalized
paths, complete file-set equality, regular files only, sizes, SHA-256 values,
roles, `buildId`, entry/stylesheet/deployment links, compiler/API agreement,
CSP, caching, fallback, and adapter ownership must all agree. `velar preview`
serves only a successfully verified build, applies the deployment headers and
base, returns SPA fallback only for HTML navigation, and never turns a missing
asset into the application shell.

`velar verify-deployment` first invokes that local verifier, then requests the
declared files from an explicit HTTPS origin and compares byte sizes and
SHA-256 identities after transfer decoding. It also verifies MIME types,
declared security/cache headers, the base root, SPA navigation, and a missing
hashed-asset 404. Redirects, authentication interstitials, stale content, host
rewrites, and provider transformations fail closed. Loopback HTTP is accepted
only for deterministic local acceptance; operational CI may supply the origin
through `VELAR_DEPLOYMENT_URL`.

The development server retains the last good application while showing compile
or runtime failures in a browser overlay. Runtime frames map to `.vel` sources.
Every successful rebuild invalidates the complete Velar module graph. Module
state is recreated after HMR; persistence exists only through explicit storage.
The development compiler itself is incremental: only changed modules and their
reverse dependents are recompiled, including npm Velar package sources outside
the application root. `/__velar/status` exposes readiness, failures, compilation
statistics, notices, and package names for development tooling. Declaration
and runtime files from resolved JavaScript packages also participate in
development invalidation.

VelarScript continues to use the npm ecosystem and does not build a package manager.

The first usable language release includes the Velar Compiler, CLI, formatter, language server, source maps, development server, basic module hot replacement, and Web accessibility diagnostics.

## 23. Current acceptance scope

VelarScript 0.9 is validated with:

- A Todo Web application.
- An API dashboard using typed HTTP, async functions, runtime type validation, npm interop, forms, and multiple components.
- A production-style, base-routed Web application using reusable Velar source
  packages, a safely typed JavaScript npm package, Head ownership, accessible
  forms, persistent state, and scoped CSS in Chromium, Firefox, and WebKit.
- A 121-module incremental compilation budget plus packed compiler/Web/creator/CLI
  installation in a clean npm consumer.
- A 15-module Release Studio in development and CSP-enabled production across
  Chromium, Firefox, and WebKit.
- An independent FlowBoard application exercising finite enum state, immutable
  domain transforms, persisted validated data, search/filter membership,
  lazy routes, collection snapshots, secure IDs, and browser-driven CRUD in
  Chromium, Firefox, and WebKit.
- An independent SupportDesk application exercising typed route parameters,
  checked native-form extraction, HTTP-loaded runtime data, filtering, sorting,
  pagination, persisted status changes, deep-link recovery, active navigation,
  and native modal confirmation in Chromium, Firefox, and WebKit.
- A reproducible non-publishing release artifact and a Workbench session using
  its project-local installed toolchain, including compiler-owned inferred-type
  hints and same-document symbol highlights through the generic external-LSP
  host without repeating explicit annotations or performing textual searches.
  Completion must respect lexical visibility/shadowing and read analyzer-owned
  member signatures rather than maintaining a separate editor type model.
  Checked intermediate expressions must preserve those members and call
  signatures through collection, runtime-Type, record, and Web API chains while
  keeping local aliases in editor-visible types. Member hover and definition
  must use the same owner identity; imported and inherited declarations resolve
  to their real source, while members with no source declaration remain without
  a fabricated target.
  Record-field rename must include typed constructor/return keys, destructuring,
  runtime-Type object literals, and member access, expanding shorthand keys so
  local variables keep their names. Class-member rename must treat inherited
  fields and abstract/override/`super` method chains as one contract, keep
  static and instance surfaces separate, and fail atomically on a hierarchy
  collision.
  A user-component parameter and its checked JSX attributes form one
  cross-module symbol even through an import alias. Navigation and rename must
  include parameter-body references and every call-site attribute, but must not
  absorb native HTML attributes or Web directives. `children` is a fixed
  implicit-content contract and cannot be renamed while content syntax has no
  explicit attribute token.
  Completion must follow syntax and checked types instead of mixing every
  visible keyword into every position: JSX tag names offer visible components
  and the supported native Web surface; component/native attribute positions
  offer their own checked contracts; contextually typed object keys offer only
  missing fields. Entering a value expression restores normal lexical symbols.
  Semantic tokens must be derived from the same declaration/reference identity
  used by navigation and rename. Automated diagnostic fixes are allowed only
  when the rewrite preserves the already-defined Velar meaning; uncertain
  application values or accessibility intent must never be invented.
- Standard API 0.4 type/runtime acceptance across collections, text, math,
  JSON, async, URL, time, secure IDs, and structured logging modules, including
  execution from a clean packed CLI consumer.
- Web API 0.8 type/runtime acceptance across routing, metadata, stable DOM IDs, HTTP,
  storage/IndexedDB, forms, browser helpers, files, WebSocket/SSE, and tests in
  all six development/production browser flows, including explicit public
  configuration and mount/render/event/mounted/cleanup error ownership.
- Project-level `.browser.test.vel` acceptance through both source and packed
  CLIs, including three browser engines and repeated route/cleanup failure soak.
- Format-v2 Core and Web project acceptance with explicit compiler extensions,
  legacy/future-version rejection, plus a root-base Netlify adapter artifact
  contract, format-3 framework build identity, and format-2 static-deployment
  identity.

Canvas game development is not part of this milestone.

## 24. Deferred Velar Game package

`velar/game` is a future official package at the same product layer as `velar/web`.

Its intended direction is to provide a clean Canvas game-development API using VelarScript. Its scene model, loop, input, assets, audio, rendering abstractions, and public API are deliberately undefined today.

Velar Game must not influence the initial language grammar, compiler architecture, or Velar Web implementation. Work begins only after VelarScript Core, the Velar Compiler, and Velar Web are usable and stable.

## 25. Priority

When design goals conflict, the priority order is:

1. Clear semantics.
2. Natural authoring.
3. Predictable compilation.
4. Complete Web development experience.
5. Practical JavaScript ecosystem access.
6. JavaScript source similarity.

VelarScript retains the successful parts of JavaScript without restoring its historical surface problems for compatibility.
