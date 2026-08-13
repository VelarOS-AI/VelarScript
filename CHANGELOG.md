# Changelog

This file records user-visible language, framework, and tooling changes. It is
not a milestone checklist; the repository test suites and CI are the source of
truth for acceptance status.

## Unreleased

- The Desktop worker test suite can no longer freeze the gate. The hang
  that cost several runs was a macOS FSEvents arming race — a recursive
  watch started just before a write never receives that notification at
  all — sitting under a chain with no deadline anywhere: the worker's
  next-change pull is unbounded by design, the test harness had no
  per-call bound, and `node --test` defaulted to no timeout. Every wait
  now has a bound whose message names the operation, the worker, and the
  likely cause; the lost-notification case re-triggers instead of parking;
  three genuinely unbounded waits inside the Desktop host (the terminal
  ownership handshake and two child stdin frame writes) gained deadlines;
  and a failed terminal spawn no longer escalates a losing rejection into
  a host exit. A reclaim hook clears what a killed run leaves behind, with
  age floors that keep a concurrent suite safe.
- The documentation catches up with twenty waves of behavior. Newly
  written down where only the compiler knew: module initialization order
  (including that statements above an import still run after the
  dependency), dynamic import, the twelve-row operator precedence table,
  iteration order and mutation-during-iteration per collection family,
  the resource contract (props do not refetch; `watch` plus
  `async reload()` is the idiom), action concurrency, the `host` marker,
  fragments, `class:` toggles, event modifiers, cross-component Look
  precedence, what `any` actually means operationally, and the adapter
  module pattern for JavaScript packages. The skill brief gains a project
  setup section — the gap that cost the first blind test fourteen rework
  rounds. A cross-document sweep found and fixed ten prose
  contradictions, including one illegal example that the documentation
  gate had been accepting.
- Animation enters the language checked: `keyframes:` blocks with
  `from`/`to`/percent stops reuse the whole Look property machinery, the
  `animate(...)` builder is compile-checked with `loop=true` standing in
  for infinite, `animation` accepts only checked Animation values — the
  string form that browsers accepted and never ran is rejected toward the
  new form — and the browser regressions assert real rotation via
  getAnimations in all three engines.
- The Look property table is published with its inclusion principle: 225
  explicitly typed properties across fourteen families (up from 123, no
  stringType fallback anywhere), 36 documented exclusions with reasons,
  three-tier absence diagnostics with nearest-name suggestions, and the
  keyword-value tightening queued since D37 — `display = "flexx"`,
  `padding = "big"`, raw grid-template and gradient strings all reject
  toward their checked spellings.
- Unknown element names are compile errors with suggestions against a
  199-element HTML/SVG/MathML table; custom elements follow the WHATWG
  valid-name rule, and PascalCase stays component dispatch. Extension
  types gain text forms: `f"gap: {16px}"` and `str(16px)` render with
  units, closing the broken escape the unit audit recorded.
- Strings gain the backtick delimiter: `` `...` `` is the same string as
  `"..."` with inner double quotes unescaped, so the JSON fixture every
  test writes stops being an escape thicket. Prefixes compose across both
  delimiters, `${...}` stays literal text (generating JavaScript is a real
  use), and `velar format` normalizes the delimiter deterministically —
  double quotes unless the content argues otherwise. Single-quoted strings
  are no longer accepted; the diagnostic names both legal delimiters.
- Source hygiene: `\u{...}` writes any code point visibly (lone
  surrogates rejected), bidirectional control characters are banned raw
  everywhere in a source file — comments included — with the escape as the
  only entry, and raw C0/DEL controls inside literals teach their escapes.
  Emoji joiners and variation selectors are explicitly unaffected.
- Numeric literals: `1_000` separators land; leading zeros, `0x`/`0b`/`0o`
  radix forms, `.5`/`5.`, and bare `Infinity`/`NaN` each teach their one
  VelarScript spelling instead of cascading.
- A statement must have an effect: a bare comparison, literal, identifier,
  or other value-only expression line is rejected with its directed
  answer — `x == 5` alone on a line was silently doing nothing.
- Comparison chains point one way: `a < b <= c` stays legal, `==`/`!=`
  never chain (`a == b == c` silently meant Python's reading where
  JavaScript's differs — the highest-risk ambiguity the grammar audit
  found), and `in`/`is` inside a chain need parentheses or `and`.
- `/* */` block comments land with nesting and a whole-line discipline for
  multi-line forms. The retired `invert x` statement now steers to
  `x = not x`, and the enum-wire equality guidance states the deciding
  fact: `parse` throws on unknown values, so open wire protocols compare
  with `str(...)` deliberately.
- Look stops lying. A `look:` literal that reads component state is
  rejected at the read — it froze at declaration while looking exactly
  like the live forms — with `look={cond ? a : b}` and directive values
  taught as the two forms that update. Bare non-zero numbers no longer
  produce dead CSS (`width = 100` computed as `auto`; literal `0` stays
  legal), builder calls with literal arguments are range-checked at
  compile time, a component-scoped CSS import is rejected instead of
  silently discarded, `viewport`/`scheme`/`motion` are reserved names,
  `motion.reduced` joins the media vocabulary, and `animation` teaches
  the keyframes escape until the checked form lands.
- Forms bind deeper: `bind:value={form.name}` and `{items[0]}` accept
  writable reactive member paths, and `bind:group` lands for radio groups
  and checkbox Lists. JSX accepts `{name ?? <Fallback/>}`, teaches the
  ternary for `and`-rendering and the two comment attempts, diagnoses a
  static `key`, and keyword prop names collapse eleven-error cascades
  into one taught message.
- The module boundary hardens: imports, every export form, re-exports and
  extern modules are module-top-level-only statements instead of emitting
  invalid JavaScript from blocks; two path spellings of one file (case
  variants, links) are rejected instead of silently double-instantiating
  the module's state; a module can no longer import from itself past the
  cycle checker; and `velar check` prints module diagnostics alongside
  resolution failures, with the parser no longer fabricating the empty
  `invalid package name ''` dependency that used to hide them. Resolution
  failures gain diagnostic codes and import-statement spans, near-match
  suggestions, and unknown `velar/*` imports list the standard modules.
- `velar test` takes one stance on trust: any unowned error during a test
  — a detached failure, a module whose initialization touches the DOM in
  a headless run, an unhandled rejection — fails that test, and the
  runner continues. Previously the report printed while the suite stayed
  green. Configuration errors now teach a complete minimal web manifest
  including the `@velarscript/web` extension identity — the gap that cost
  the first blind test most of its rework.
- Ordered string comparison is code-point order everywhere — `<`,
  `sorted()`, `min`/`max`, and the `by=`/`sortBy` family agree with the
  language's code-point contract instead of leaking UTF-16 unit order on
  surrogate-bearing strings. Lists gain `flatMap`, Sets gain `union`,
  `intersection` and `difference`, `filter(x => x != null)` narrows the
  element type, and List position errors are uniformly `IndexError`.
  Spelling guidance now covers the Python column — `len(`, `strip`,
  `startswith`, `find` and friends teach their VelarScript spellings, and
  a format-spec `:` inside an f-string teaches `toFixed`/`padStart`
  instead of cascading.
- The bridge closes its edges: extern blocks own their import names (a
  typo is a check-time error, not a silent unknown), bare `import js`
  package specifiers resolve at check time in both directions, a broken
  `types` path fires the degradation notice, generic extern classes get a
  polite rejection, and a top-level sync throw of a non-Error value is
  normalized instead of reaching the host raw.
- The bare-string identity door closes on its last surfaces: Map and Set
  key types reject unions mixing different enums or enum with string, the
  membership vocabulary (`in`, `has`, `index`, `count`, `remove`,
  `Map.get`) requires the probe to intersect the element type, enum and
  string domains never meet in `==` even through union arms, and `is`
  between disjoint enum types is a compile error. A freshly constructed
  collection literal as an equality operand is rejected — it is never
  identical to anything — and the new prelude `equals(a, b)` provides deep
  structural comparison with SameValueZero leaves for the content
  question.
- Enums round out: `Status.values()` returns the members in declaration
  order, member access follows type aliases, keyword member names can be
  matched (`case S.null:`), a bare `pass` in an enum body is the
  placeholder rather than a member named pass, optional enum subjects get
  the same match exhaustiveness as bare ones, parenthesized member
  patterns keep their coverage credit, and match value patterns agree
  with `==` on NaN. `ValidationError`, `NarrowingError`, and `IndexError`
  are nameable and catchable, and validation failures name the first
  failing field and reason.
- Nested `is` emits correctly parenthesized checks (previously
  `(x is number) is bool` was wrong even with source parentheses, now a
  constant-test compile error), `await` on `any` and `any` in conditions
  are rejected toward validation, checked `Error` gains `cause`, error
  subclasses carry their declared `.name`, and `++i`/`i--`, stray
  semicolons, `|`/`&`/`^`, `function(){}`, and `:=` each teach their one
  VelarScript spelling.
- The standard library sheds its two editor-domain modules:
  `velar/javascript` and `velar/text-buffer` move out as installable
  packages (`@velarscript/script-analysis`, `@velarscript/text-buffer`),
  since `velar/*` is closed vocabulary limited to universal computation
  and capability primitives. The old imports get a directed migration
  diagnostic naming the package, the CLI's own language service consumes
  the package internally, and the install-import-run path for packages is
  now part of the gates. The publish set grows to eight packages.
- Importing `velar/app` no longer breaks reactivity. The runtime registry
  now owns its scheduler, so an application whose module graph stamps the
  registry from the generated `velar/app` module keeps every observed
  `computed` updating — previously one import line froze the DOM on the
  first state write, in development and production builds alike. The first
  velar/app browser regression pins it.
- A recursive `computed` detaches its dependency edges after the owned
  recursion error instead of storming the whole-flush budget, computed
  observers share the documented 100 self-invalidation cap, and an
  unhandled reactive failure during `velar test` fails that one test
  instead of killing the process. The no-blank-page promise now holds on
  all three paths — a dynamic-region failure during the initial render and
  a missing mount target both show the accessible fatal state instead of
  an empty page. A detached action failure reports exactly once, and a
  superseded action failure carries its detail.
- `readonly` accepts only pure data, at every depth. A class type anywhere
  inside a readonly-annotated shape rejects the declaration itself with
  the two ways out, so a readonly view can no longer hand back a freely
  mutable class instance — the promise never exceeds the enforcement.
  Component props follow the same rule: a bare class prop stays legal as a
  visibly behavioral value, while a class buried inside a data-shaped
  record prop is rejected. All twelve existing readonly sites were already
  pure data.
- Class methods live on the prototype, matching the documented lowering:
  instances no longer carry one bound closure per method, `print` shows
  data fields only, and reading a method as a value (`const f = a.read`)
  binds the receiver at the reference site exactly like collection
  methods. Private methods lower to native `#name()` methods.
- A class name is not a value. Calling it, reading statics, extending,
  type positions, `is`/`case` patterns, and re-exports stay legal;
  aliasing or passing the name itself is rejected with the arrow-factory
  spelling (`() => P()`) taught — aligning every class with the rules
  abstract classes already had.
- A match over a class hierarchy must be provably exhaustive, like an enum
  match: end with the subject's type, a base of it, or `case _:` — an open
  hierarchy can never be enumerated, so a silently skipped subject is now
  a compile error instead of nothing happening at runtime.
- The runtime narrowing guard for an imported record type is now the real
  validator instead of a presence check, so a fact staled across a module
  boundary throws `NarrowingError` at the read instead of silently
  delivering wrong-typed data or leaking a bare `TypeError`. The first
  multi-module narrowing regressions pin this — the entire previous suite
  was single-module, which is why the hole survived.
- Record validation accepts only plain data objects: a class instance, an
  `Error`, or any prototyped host object no longer satisfies `Type.is` or
  `Type.parse` (cross-realm plain objects still pass), so a validated
  record view can no longer alias a live class instance and write through
  its `const` fields. The failure hint teaches projecting the fields into
  a record.
- Assignment now establishes a narrowing fact: after
  `const x: string? = "a"` or `x = "a"`, the value is usable as a string
  without a redundant check, including when every branch of an
  `if`/`match`/`try` assigns one. Assigned facts refine reads but never
  make a later test constant, so `value == null` after a literal
  assignment stays legal. A member write invalidates only facts whose
  roots could alias the written path — writing an unrelated variable of a
  disjoint type no longer destroys narrowing.
- Classes close eight compile-to-crash holes: a `class` or `type` in a
  block is rejected at module scope (previously analyzed against the wrong
  shape — a `-> number` function could return a string with zero
  diagnostics, and a block `export class` emitted invalid JavaScript);
  constructor rest parameters are rejected (one spelling was uncallable,
  the other silently wrong); a `super(...)` call anywhere but the first
  statement is rejected; `new` through a narrowed callee parenthesizes
  correctly; a self-instantiating field initializer, a class name used
  before its declaration, and a base constructor observing an abstract or
  overridden member are all compile errors instead of runtime crashes.
- Equality requires the operand types to intersect. `1 == "1"`, a record
  against a string, and two members of different enums no longer compile —
  each was permanently false, which is a silent logical bug rather than the
  coercion bug strict equality was meant to remove. `value == null` on an
  optional is unaffected; enum against raw string is rejected too, so
  compare with `Kind.parse(raw) == Kind.textDelta` or drop to strings
  explicitly with `str(...)`.
- Enums are not ordered. `sorted()` on a List of enums returned members in
  alphabetical order of their runtime values — silently wrong for the common
  `low`/`normal`/`high` shape — so the sort paths now agree with direct
  comparison and reject enums and mixed-category unions. State the order
  explicitly with `sorted(by=rank)`, or use a string-backed enum whose
  values encode it. The four mechanisms that gave three different answers to
  "is this ordered" are now one.
- `pop(index=-1)` throws on an empty List or an out-of-range index, matching
  `[]` and Python, and `removeLast()` is removed as its duplicate. Drain a
  List with `while items.size > 0:` instead of testing the result for null.
- Reactive state no longer retains what it replaces. Replacing a state root
  releases its descendants transitively, so the idiomatic
  `settings = {...settings, field: next}` no longer keeps every previous
  version alive, and deep mutation cost stops growing with the number of
  replacements (3200 generations: 269µs per mutation to 1.15µs). Record
  field writes no longer probe collection identity by throwing, cutting
  them from 4.9µs to 0.4µs. Two watches that invalidate each other are now
  bounded and reported through the error channel instead of freezing the
  page silently, and a keyed re-render with identical keys leaves already
  positioned rows attached, so a focused input keeps focus and IME
  composition survives.
- The runtime boundary gate now covers the whole emitted Web runtime rather
  than three slices of it, with the old slices asserted to stay inside the
  covered span so coverage cannot silently shrink. Closing it surfaced and
  fixed a large set of replaceable-host-member uses across keyed
  reconciliation, look/class/style, events, form binding, and raw HTML.
- The text-conversion whitelist now covers `str` used as a value, not only
  as a direct call: `const convert = str` stays legal, while
  `convert(record)` and `map(str)` over a non-text List are type errors, so
  a record can no longer reach JavaScript string coercion and execute a
  `toString` hook. `Set.update()` publishes each added member, and `Set()`
  and `Map()` construction unwrap reactive values, so membership and key
  lookup agree with the documented contract instead of splitting on
  identity. A detached task whose failure report itself fails, and an
  `async` statement handed a foreign thenable, are both reported through the
  owned channel instead of ending the process.
- Module cycle diagnostics are corrected and entry-independent: a top-level
  call of an imported `def` is legal (functions are hoisted at link time), a
  cycle hidden behind a re-export barrel or a dynamic import is now caught,
  the language server and `velar check` give the same verdict on the same
  sources, and a module that leaves a cycle recovers its emitted output
  under incremental reuse instead of silently serving an empty module.
- Large speedups in emitted code, all covered by the new runtime gate: index
  reads on a list the compiler produced are now O(1) after one validation
  instead of O(n) per read (200,000 reads of a `range(0, 2000)` result:
  39.8s to 42ms), `Set` membership no longer pays a thrown-and-caught
  exception per call (190ms to 12ms per 200,000), `string.slice` takes the
  ASCII fast path its length counterpart already had (300 slices over a
  222,000 code-point corpus: 154ms to under 1ms), and `map`/`filter`/
  `sorted` drop roughly 40% of their per-element overhead.
- Equality is SameValueZero. `NaN == NaN` is now `true` and `x == x` always
  holds, so equality agrees with `Set`, `Map`, and `List` membership instead
  of contradicting them; `-0 == 0` stays true. Operands whose static types
  exclude numbers still lower to plain `===`. Numbers gain `isNaN()`,
  `isFinite()`, and `isInteger()`, and `sum`/`min`/`max`/`sorted` now throw
  on a NaN element rather than returning a poisoned or randomly ordered
  result.
- `case _:` is the only `match` fallback; `else:` inside `match` receives
  guidance. `invert x` is retired — write the ordinary `x = not x`, which is
  now legal and publishes reactive updates. Strings gain `isBlank()`, and
  `split("")` is documented as the per-code-point character split.
- Non-integer indexes are rejected by `List.get`, `List.pop`, and
  `string.char`, matching the strict siblings that already threw;
  out-of-range integer indexes still return `null` and negatives still count
  from the end. `Map` keys are unaffected.
- Discarding the result of a compiler-owned pure value or collection method
  is an error (`VEL4029`): `values.sorted()` as a statement did nothing and
  said nothing. Mutating members that return a value — `pop` and `remove` —
  remain valid statements.
- The toolchain now ships the AI skill brief. `velar skill` prints the
  agent-agnostic language brief to stdout; every generated project scaffolds
  an `AGENTS.md` pointing agents at it, the project gates, and the escape
  hatches; and permanent tests keep the packaged copy byte-identical to
  `docs/ai-skill.md`, under its size budget, and free of drift — every code
  fence in the brief compiles against the current compiler.
- The anti-lock-in exit is now gate-tested: the package acceptance copies a
  built application's emitted output into a bare directory and runs it with
  plain Node — no `@velarscript/*` packages present — proving the readable
  JavaScript exit works. `docs/escape-hatches.md` documents the full escape
  ladder, and `docs/why-velarscript.md` plus the README carry the mission
  and compatibility policy.
- Module initialization cycles are rejected at compile time (`VEL3019`). An
  initializer-position read of an import whose module has not evaluated yet
  under the project's module order — previously a clean compile followed by a
  raw `ReferenceError` at runtime — now diagnoses on the reading line with
  guidance to defer the read into a function or extract a third module.
  Function-body reads across module cycles and mutually recursive record
  types remain legal.
- F-strings and `str()` accept only text-convertible values: strings,
  numbers, bools, enums, and `null`, plus optionals and unions of those
  (`VEL4026`). Records, collections, functions, class instances, `unknown`,
  and `any` are rejected with guidance — `print(value)` to inspect,
  `stringify(value)` for data text. Previously a record interpolated as
  `[object Object]` and an own callable `toString` field was silently
  invoked, violating the conversion-hook ban that the rest of the runtime
  already enforces.
- A Promise-typed expression statement is now an error (`VEL4027`): `await`
  it, or run it detached with the new `async` statement. `async task()`
  requires a `Promise<null>` expression (`VEL4028` otherwise), executes
  detached, and owns its failure — the rejection is normalized and reported
  through the host error channel (stderr on Node without crashing the
  process; the `velar/app` error chain with a `detached` phase in the
  browser). Previously a forgotten `await` compiled silently and a rejection
  crashed the process as a raw unhandled rejection.
- Mixing `??` with `and`/`or` in one unparenthesized chain is now a parse
  error (`VEL2034`), matching JavaScript's rule for `??` with `||`/`&&`:
  the two groupings read differently, so the parentheses are required.
- A statement now must end at its newline. Trailing tokens after a complete
  statement — a missing operator (`price quantity`), a doubled literal
  (`5 7`), or a second statement on the same line — are diagnosed with
  `VEL2032` and recovery continues on the next line. In Web projects the
  percent form gets a targeted message: `10%3` reads as the percentage
  literal `10%`, so the diagnostic teaches `10 % 3` for the remainder
  operator. Previously these shapes compiled silently and discarded the
  trailing tokens.
- Conditions judge truth, not presence. `bool` and `bool?` conditions enter
  the branch only when the value is `true`; `false` and `null` both take the
  else path, and a `bool?` condition lowers to an explicit `=== true` test.
  Any other optional in bare condition position is rejected with guidance to
  write `value != null`. Previously a bare optional condition was a
  presence check, so `if flag:` with `flag == false` entered the true branch.
  Comparison-based narrowing (`!= null`, `== null`) is unchanged; the true
  branch of a `bool?` condition narrows to `bool`.
- The null test has one spelling family: `!= null` and `== null`. `is` tests
  runtime types, equality tests values, and `null` is a value, so `x is null`
  and `x is not null` are removed spellings with parse-level guidance to the
  equality forms. `x is not Error` (type test) and `x not in list`
  (membership) are unaffected.

## 0.10.0 — 2026-08-09

VelarScript 0.10.0 is the first public toolchain release: a checked, Web-first
language for people who already think in JavaScript and Python, shipped as the
version-locked compiler, Web framework, project creator, and CLI package set.

### Release highlights

- Familiar values now carry their operations directly. Strings and numbers use
  checked method chains; Lists add aggregation and key-based sorting; Set and
  Map retain one controlled collection vocabulary without leaking JavaScript
  prototype behavior.
- Iteration and construction cover the application shapes proven by
  VelarOS-Lite: two-slot `for` loops expose value/index or key/value pairs,
  `range` has one bounded materialized contract, and Set/Map constructors accept
  checked Lists and records.
- One quote family covers inline, raw, interpolated, and indentation-bounded
  layout strings. Markdown fences and HTML remain literal content without a
  backtick delimiter family; assertion messages read as
  `assert condition else message`.
- Web state is deeply reactive by default. Direct nested record assignment and
  compiler-owned List/Map/Set mutation publish at the property or collection-key
  granularity, including through aliases and shared module state. There is no
  public memoization or batching API.
- Core local applications use the first-party `velar/serve`, `velar/fs`,
  `velar/env`, and `velar/host` modules instead of rebuilding Node extern
  surfaces. Browser targets reject those modules before bundling.
- The fourth no-document usability gate covered these new surfaces with one
  independent writer and two complete programs. Its first compile produced 16
  diagnostics, converged 16 → 2 → 2 in three rounds, and found zero missing
  language capabilities; the remaining misses were discoverability of the
  explicit `range` import and JavaScript-style interpolation text.

The detailed entries below retain the development evidence behind this release.

### First-party local platform modules

Standard library and CLI changes:

- Standard API 0.5 adds `velar/serve`, `velar/fs`, `velar/env`, and
  `velar/host` for Core servers and local applications. HTTP callbacks,
  filesystem buffers, environment access, and process signals remain inside
  bounded first-party runtime implementations instead of user `extern`
  declarations.
- `velar/serve` provides checked request/response records, bounded JSON/text
  bodies and async chunk producers, real-root static containment, MIME types,
  SPA fallback, opaque handler failures, actual bound ports, and idempotent
  shutdown. `velar/fs` exposes async bounded text/list/blob operations;
  `Blob` is opaque and non-constructible.
- Web-capable projects reject local platform imports during dependency
  analysis with targeted diagnostics. The browser production bundler retains
  the same refusal as a fail-closed second boundary.
- `velar/host` owns ordered SIGINT/SIGTERM cleanup and double-signal force
  quit; `velar/env` permits only explicit portable variable names. The
  JavaScript bridge remains the third-party package boundary.

### Unified quoted strings and assertion failure branches

Language and compiler changes:

- Inline single- and double-quoted strings remain line-bounded recovery units.
  A quote followed immediately by a newline opens an indentation-bounded layout
  string; its structural margin is removed while internal lines and extra
  indentation remain exact. A missing close recovers at dedent.
- `r"..."` preserves backslashes literally, `f"..."` interpolates, and the
  canonical combined form is `rf"..."`; the same prefixes apply to layout
  strings. Raw inline strings double their delimiter to include it. Backtick
  strings were removed cleanly, and noncanonical `fr`, legacy backticks, and
  triple quotes receive direct current-spelling guidance.
- Assertion messages now read as an explicit failure branch:
  `assert condition else message`. The old comma separator receives a targeted
  migration diagnostic and no longer emits runnable output.

### Two-slot iteration and collection construction

Language and compiler changes:

- `for first, second in value` is a distinct two-slot loop: List/Set/string
  iteration yields value plus insertion/code-point index, while Map iteration
  yields key plus value. Both slots accept full binding patterns. Single-slot
  loops and `for [a, b] in pairs` destructuring are unchanged; a third slot is
  rejected with direct guidance.
- `range` now exposes its three named signatures in addition to positional
  calls. It remains one bounded materialized `List<number>` contract everywhere
  rather than adding a second lazy iterable type.
- `Map` accepts checked dense `[key, value]` entry Lists and ordinary records;
  `Set(List)` remains the checked content constructor. The runtime copies by
  data descriptor and native collection slots, never by replaceable iterators
  or accessors. Record-to-Map diagnostics now point at `Map({...})`.
- Multiline-string work from this batch was superseded in the same development
  cycle by layout strings: the same ordinary quote enters a multiline block
  only when followed immediately by a newline, while `r`, `f`, and `rf` select
  raw and interpolation semantics without a separate delimiter family.
- This batch deliberately does not add truthy conditions, List `+`, async
  iteration, labeled breaks, for-else, or match expressions; their existing
  single-spelling and evidence decisions remain unchanged.

### Checked value methods and List aggregation

Language and compiler changes:

- Strings now expose the checked members `size`, `trim`, `upper`, `lower`,
  `slice`, `char`, `has`, `startsWith`, `endsWith`, `split`, `replace`,
  `replaceAll`, `padStart`, `padEnd`, and `repeat`; numbers expose `abs`,
  `round`, `floor`, `ceil`, and `toFixed`. These methods support named calls,
  optional access, and first-class receiver binding without patching or
  trusting JavaScript prototypes. `0.abs()` and decimal-literal chains lex as
  member access. String size, character access, and slicing retain Unicode
  code-point semantics and the existing 16 MiB bounds.
- The receiver-shaped `velar/text` and `velar/math` exports moved to those
  methods with no compatibility aliases. Old imports, bare calls, JavaScript
  spellings such as `.toUpperCase()`/`.length`, string indexing, and number
  `.toString()` receive one-current-spelling guidance.
- Lists add `sum()`, `min()`, and `max()`. `sorted(by=selector)` computes one
  number/string key per checked snapshot value and is mutually exclusive with
  its comparator form. Empty `min`/`max` return `null`.
- String right operands are explicitly covered by the controlled `in`
  membership contract. `map.get(key, fallback)` now points directly to
  `get(key) ?? fallback`.

### Deep state reactivity is the only default

Web framework changes:

- `state` now publishes direct nested record assignments and direct
  `List`/`Map`/`Set` mutations. State references may be aliased, passed to
  ordinary functions, returned, and mutated through reactive imports; the
  former VEL5046 copy-and-reassign restrictions are removed.
- Ordinary mutable records are lazily proxied with property-level dependency
  tracking. Native collections keep their identities and publish from
  compiler-owned helpers; nested versions bubble to deep watches. A watch of
  a deeply mutated value receives the same reference as `current` and
  `previous`, without an implicit deep snapshot.
- The raw/proxy cache and dependency graph are shared across application
  bundles under runtime foundation version 0.11. Classes, host objects,
  functions, frozen or non-extensible records, and native collections are
  never wrapped; validation and serialization boundaries share one `toRaw`
  operation, including `Map` keys and `Set` membership.
- Component props remain read-only. Direct nested prop assignment or a
  mutating collection call on a prop is reported as VEL5051.
- Identity-keyed memoization and its purity metadata are removed because a
  stable record identity can now contain changing fields. The language still
  exposes no `memo` or `batch` API; synchronous state bursts remain coalesced
  by the scheduler.

### For-loop bindings own their name from the loop head

Language and compiler changes:

- A for-loop binding now follows the shadowed-name ownership rule (VEL3017):
  an iterable expression that references a name the loop's own pattern
  declares — through a simple name or any list or object destructuring,
  including rests — is a compile-time error when that reference would
  resolve to an outer binding, instead of compiling into JavaScript that
  evaluates the iterable in the loop binding's temporal dead zone and
  throws at runtime. The directive names the fixes: rename the loop
  binding, or read the iterable into a differently named binding first —
  the loop binding owns its name only in the loop head and body, so a
  same-scope read above the loop stays legal. An arrow parameter inside
  the iterable that reuses the name keeps being an ordinary inner binding.

### Shadowed names are owned by their shadow's whole scope

Language and compiler changes:

- A declaration that shadows an outer binding now owns its name for its whole
  scope: a reference that would reach the outer binding from earlier in that
  scope — an earlier statement, the shadow's own initializer, a component
  item above a shadowing `state`, or a prop default — is a compile-time
  error (VEL3017) instead of compiling into JavaScript that reads the
  not-yet-initialized shadow at runtime (or, inside an arrow, silently
  captures the wrong binding). The directive names the fix: rename the
  shadow, or read the outer value in an enclosing scope. A function
  parameter default keeps reading the enclosing scope, exactly as emitted
  JavaScript does.

### Keyed conditionals and dev-server npm prebundling

Language and compiler changes:

- The keyed-children fast path now reaches through conditionals: an
  interpolation whose `?:` branches contain `items.map(item => <Row
  key={item.id} />)` compiles each branch to its own gated region, so the
  idiomatic empty-state ternary keeps identity-preserving keyed children instead
  of silently demoting the whole list to rebuild-all dynamic updates. A
  branch that renders a list with `.map(...)` requires a key exactly like a
  bare keyed interpolation (VEL5017 now applies to branches too).
- A `key` attribute the keyed path will never read — on a lone element, on a
  map nested inside a larger expression, or in any other unrecognized
  position inside an interpolation — is now diagnosed (VEL5050) with the
  recognized shape named, instead of being silently ignored at runtime.

Tooling changes:

- `velar dev` now prebundles bare npm imports per package with the production
  bundler and serves the results as native ES modules, cached in
  `<project>/.velar/dev-deps` keyed by package version and invalidated when
  the watcher sees the installed files change. Dual packages whose
  "import"-condition entry wraps their own CommonJS internals (the pattern
  Node's documentation recommends to dual publishers) now load in
  development exactly as they do in `velar build`; imports of other packages
  stay bare and resolve through the import map. A package that cannot be
  prebundled produces a velar-voiced error naming the package instead of a
  raw browser SyntaxError on a package-internal file; a CommonJS-only
  package keeps its explicit refusal, now detected by the bundler's module
  format instead of a source heuristic.

### Module-scope actions

Language and compiler changes:

- `action` may now be declared at module scope, so a shared store owns an async
  operation together with its reactive `pending`/`error` surface next to the
  module `state` and `computed` it drives. A module action behaves exactly like
  a component action — reactive `pending`/`error` fields, failures reported
  through the Web error chain while the call still rejects — but its lifetime
  is the module: it is never disposed. `export action` is supported; the
  exported value is imported and called like a function and its reactive
  fields read without any reactive-import lowering. An action nested in an
  ordinary function body is still rejected (VEL3013, now phrased "module or
  component scope"). `resource` remains component-only because its stale-result
  handling is tied to component destruction; module-scope `resource` keeps
  VEL3012 with guidance toward a module `action`.

### VelarOS-Lite S2 batch: re-exports, bridged-dependency sandboxes, extern default contract

Language and compiler changes:

- Named re-exports: `export {name, other as alias} from "./module.vel"` (also
  from package sources and standard modules) re-exports without creating local
  bindings. Re-exported names join the module interface under their aliases
  with the origin contract; live-export (`export let`) mutability and reactive
  kinds propagate, and the statement lowers to a native ES-module
  `export ... from`. Go-to-definition follows re-export chains to the origin
  declaration. Namespace re-export (`export * from`) is rejected with VEL2029
  guidance toward the named form, and a re-exported name that collides with
  another export of the same module is rejected with VEL3016.
- The extern default-export contract is documented and pinned by tests:
  `export class default:` and `export const default: T` declare a
  default-export-only package, and the bare `import js Name from "pkg"` form is
  the canonical default import (see javascript-bridge.md).

Tooling changes:

- `velar test` and `velar run` now compile into `<project>/.velar/test-*` and
  `<project>/.velar/run-*` sandboxes instead of the system temporary
  directory, so Node's upward `node_modules` walk keeps resolving the
  project's real npm dependencies for bridged `import js` packages. The
  sandbox is removed after each run and `.velar/` is gitignored by the
  project templates; TMPDIR workarounds are no longer needed.
- When a module declares a manual `extern module "pkg"`, the automatic
  TypeScript-declaration probe no longer runs for that module's imports of
  that source, so it emits no notices that second-guess the manual contract.

### Blind-usability batch 3: chains, string functions, Look tightening

Language and compiler changes:

- Leading-dot continuation: a line whose first token is `.` or `?.` continues
  the previous logical line, so method chains can span physical lines in the
  standard formatted style. Trailing-dot continuation stays unsupported, and a
  leading `.` not followed by a member name (such as `.5`) never joins lines.
  The formatter normalizes continuation lines to one level past the statement
  they continue and never reflows existing single-line chains.
- `velar/text` gains the string measurement and access trio: `length(value)`
  (code-point count), `char(value, index)` (code point at an index, negative
  from the end like `List.get`, `null` out of range), and
  `slice(value, start = 0, end = length)` (code-point slice with `List.slice`
  position semantics). Strings expose no members: `value.length`,
  `value.size`, `value.slice(...)`, `value.substring(...)`, `value.charAt(...)`,
  `value.at(...)`, and `value[index]` now report directive guidance to the
  matching `velar/text` function.
- Look rejects multi-token shorthand strings on properties with a checked
  builder equivalent — the spacing family (`margin*`, `padding*`, `inset`,
  plus `borderRadius`/`borderWidth`), the border family (`border`,
  `borderTop/Right/Bottom/Left`, `outline`), `boxShadow`, and `transition` —
  with guidance that computes the builder call where the string decomposes
  cleanly (`Use 'spacing(8px, 12px)'`, `Use 'border(1px, color("#d9dce1"))'`).
  Single-token keyword strings, hex color strings, and out-of-family strings
  such as `fontFamily` stacks stay accepted. `flex` now accepts numbers.

Diagnostic guidance changes:

- A `#` that begins a line is guided to `//` comments and the commented text
  is skipped without an error cascade; bare hex colors keep their quoted-string
  guidance.
- A bare (unbraced) `for name in expr:` written directly as JSX content
  receives the same `.map(...)` guidance as its braced spelling.
- Assignment written inside an expression (an interpolated fragment or an
  arrow body) reports "Assignment is a statement" guidance and recovers, so
  the rest of the module still co-reports its own diagnostics. When an event
  attribute's arrow assigns a state binding from an event field, the Web
  extension additionally guides to `bind:value={binding}`.
- Kebab-case Look properties and multi-value shorthand now recover as their
  guided spelling, so camelCase guidance, builder guidance, JSX attribute
  guidance (`on:` directives, `bind:value`), and semantic diagnostics surface
  together in one compile instead of gating each other.
- A Look hook written as a target (`@hover:` as a block) is guided to the
  `if @hover:` condition form.

### Minimal generics for def functions

Language and compiler changes:

- `def` functions — top-level, exported, extern, and class methods — can
  declare type parameters: `def first<T>(items: List<T>) -> T?`. Type
  arguments are inferred at each call site; there is no explicit instantiation
  syntax. Callback arrows are checked against the bindings solved from fixed
  arguments, and their results solve the remaining parameters. An unsolved
  parameter becomes `unknown`.
- Type parameters are usable in parameter annotations, result annotations, and
  value annotations inside the function body. A generic function is an
  ordinary value: calls through bindings infer per call site, and assigning
  one to a concrete function contract instantiates it against that contract.
- Type parameters are erased at runtime: `is T`, `case T`, and any type
  containing a parameter in a runtime-checked position are rejected with
  VEL4022. Duplicate or type-shadowing parameters and a nested `def` reusing an
  enclosing function's parameter are rejected with VEL4021.
- Generic `type`, `class`, and `component` declarations, bounds, and variance
  are out of scope for this version and report a targeted diagnostic.

### Remove host-origin tracking and call-effect invalidation

Language and compiler changes:

- Narrowed facts now persist across ordinary calls, `await`, string
  interpolation, getter reads, and spreads. A fact is invalidated only by an
  assignment to its location and by merging branches where such an assignment
  can reach that location.
- Host-origin propagation — result origins, storage-origin effects, constructor
  origins, and contains-external instance marks — is removed from the language
  and from module contracts.
- Live `export let` imports now narrow like ordinary bindings.
- Runtime guards are unchanged: bounded collection helpers, record validators,
  and `undefined`-to-`null` normalization stay active.
- Module contract identities changed, so the first build after this change
  performs a one-time full project re-analysis.

### Clarity Reset

Breaking language changes:

- Named arguments use `name=value`; `null` is the only ordinary empty value.
- Classes use body fields and one explicit `constructor(...)` declaration.
- Optional chaining follows JavaScript one hop at a time.
- `List`, `Set`, and `Map` expose one small, consistent API without legacy
  aliases.
- `match` supports literals, enum members, type patterns, bindings, and guards.
- JSX branching uses ordinary expressions and control flow.
- Look uses CSS property names, explicit string values, named arguments, and
  explicit `before look` / `after look` unsafe CSS ordering.

Compiler and framework changes:

- Types now have a structured syntax tree and stable semantic identity.
- Mutable collections and writable structures are invariant.
- Reactive state is deeply tracked through record properties and
  compiler-owned collection operations. Aliases, ordinary calls, returns, and
  reactive imports preserve updates; component props remain read-only in the
  child.
- Web JSX and Look participate in the Core lexical stream through the Web
  extension instead of being captured as opaque source blocks.
- JavaScript generation uses structured nodes with nested source-map positions.
- Actions retain observable pending/error state while preserving normal Promise
  rejection semantics.
- Assignments check the declared location type, invalidate stale optional facts,
  and lower as true JavaScript assignment targets without read-side null
  normalization.
- Short-circuit conditions and `while` bodies share optional narrowing, while
  complete source spans keep nested lowering hints from colliding.
- Mutually exclusive branches, `match` cases, terminating loops, and
  unreachable tails now merge flow facts by reachable path. Match guards narrow
  their body, and ordinary calls invalidate mutable or aliased facts unless the
  checked value was first saved in a local `const`. Getter and safe-JavaScript
  property reads, plus resumed code after `await`, follow the same effect
  boundary.
- Continuing branches now retain facts established on every path;
  `try`/`catch`/`finally`, match guard fallthrough, aliased member writes,
  JavaScript setters, object f-string coercion, and component JSX evaluation all
  follow emitted execution order instead of sharing or guessing flow state.
- Safe-JavaScript class checks now treat `Symbol.hasInstance` as an effectful
  host hook, while local VelarScript `is` checks remain inert.
- Module interfaces now preserve `export let` liveness separately from local
  assignment permission. Named live imports lose stale facts at effect
  boundaries, while namespace imports with live exports fail explicitly and
  all namespace fields remain read-only.
- Named calls now retain native callee-first evaluation, member receivers, and
  optional-call short-circuiting while still evaluating argument expressions
  once in source order before arranging them in declaration order.
- Membership expressions now evaluate their candidate before their collection,
  using a source-shaped controlled helper signature instead of reversing the
  operands during lowering.
- Plain member assignment no longer invents a getter read before its right-hand
  expression; host setter effects occur afterward, while compound assignment
  still models its required old-value read first.
- Assertion messages are checked only on the failing path with rejected
  condition facts; their effects no longer erase facts on the successful path.
- `List.reduce(callback, initial)` analysis now follows runtime argument order
  without losing contextual typing for an effect-free literal arrow callback.
- Optional indexes and calls now expose successful-chain facts to their deferred
  expressions, optional index calls continue safely, and optional function
  annotations contextually type assigned arrows.
- Comparison chains now carry successful-link facts into later operands and
  into bodies controlled by the complete truthy chain.
- Optional collection annotations now contextually type empty List, Set, and
  Map values, including transparent collection aliases.
- Null-coalescing fallbacks now receive the expected or present-value context,
  retain null-path flow facts, and preserve arrow operands in emitted JavaScript.
- Match success and fallthrough now narrow the original stable identifier or
  data field through guards, later cases, and else; effects invalidate stale
  facts.
- List and call spreads now validate dense Lists without invoking instance
  iterators, async List spreads preserve order, and call spread targets only a
  declared rest parameter.
- Record construction now defines controlled own data fields, makes
  `__proto__` an ordinary name, rejects accessor and symbol spreads, normalizes
  unsafe `undefined`, and preserves explicit async evaluation.
- Safe JavaScript records and Lists now retain host-origin metadata through
  declared results and type composition, so reads, reflection, destructuring,
  iteration, spread, and structural matching invalidate stale flow facts.
- Set and Map now carry the same container-level host provenance as List;
  Proxy-sensitive size reads and iteration are effect boundaries, while copy
  construction creates an owned container and retains element provenance.
- Runtime `Type.parse`, `is`, and type-pattern checks now preserve host origin
  when they validate an unchecked value; safe-JavaScript class instances carry
  the same non-display provenance through constructors and method results.
- Cyclic module fixed points now include non-display host-origin metadata in
  their analysis identity without changing visible type equality.
- Explicit variable annotations and mutable rebinding now preserve the current
  value's host origin instead of silently turning an external reference local.
- Declared assignment contracts, current storage provenance, and flow-narrowed
  read types are now separate binding states. Reachable branches merge storage
  provenance symmetrically, including assignments through a narrowed binding,
  so analysis no longer depends on branch order.
- VelarScript functions, async functions, expression arrows, getters, and class
  methods now preserve host origin through returns. Callable contracts retain
  non-display parameter-to-result relationships, including named and rest
  arguments, so one identity helper remains local for local inputs and external
  only for external inputs. Analyzed class member contracts now cross module
  boundaries instead of being rebuilt from source annotations.
- Contextually typed List literals now retain host origin in their element
  types while the newly allocated List itself remains owned.
- Local class construction now distinguishes a host object from a locally
  allocated instance that contains host-origin references. Constructor field
  initializers, parameter assignments, named calls, default values, `super`
  forwarding, hoisted calls, methods returning `self`, runtime checks, and
  module interfaces preserve that distinction without making unrelated
  primitive fields effectful.
- Post-construction field, index, and collection-mutator writes now retain
  contained host origin for local records, classes, Lists, Sets, and Maps.
  Flow-scoped reference identities propagate that state through direct and
  conditional aliases, narrowed bindings, identity functions, and methods
  returning `self`, while a fresh rebind separates the previous object.
- Functions and methods now publish composable storage-origin effects for
  parameter, rest, receiver, default, and captured-value writes. Forwarding,
  named calls, declaration-before-use, inherited mutating getters, module
  boundaries, and conservative safe-JavaScript argument mutation preserve the
  same provenance contract.
- Callable and constructor default provenance is applied only when that
  parameter is omitted; an explicit owned argument is not contaminated by an
  external default it replaces.

Tooling and documentation changes:

- The formatter is syntax-aware and idempotent across Core, JSX, and Look.
- The language server diagnoses and repairs common JavaScript and Python
  spellings directly.
- README, reference documents, templates, real applications, and the
  VelarScript website use the same 0.10 contract.
- CI extracts and compiles documentation and website examples.

## 0.1 through 0.9 — Pre-release development

These development lines established the compiler, CLI, standard modules, Web
framework, package boundary, browser tests, Workbench integration contract, and
static deployment pipeline. Their experimental syntax is superseded by 0.10
and is intentionally not retained as compatibility surface. Detailed history
remains available in Git.
