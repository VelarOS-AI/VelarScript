# D109 — A4 covers the derived rebuild, and a module-level root failure is not a blank page

Status: accepted — 2026-08-28

Two findings from the P2b reconciliation wave, ruled together because both are
one contract already written down failing to reach a second spelling of the
same thing.

## A4 covers the rebuild in whichever spelling it is written

**Fact.** D89's `A4` fires on `items = items.map(item => {…})` and is silent
when the identical churn is spelled as a `computed` that builds fresh records —
`computed rows = build(source)` over a `def` that fills a list with record
literals, or `computed rows = source.map(item => {…})`. The wave compiled both
against the same keyed list and confirmed the two rebuild the rows identically:
the keyed position recognises nothing, destroys every child, and takes the
focused input with it. The silent spelling is the one the consumer wrote, and
it is arguably the more idiomatic of the two.

**Decision: the same advisory, a wider proof — not a new code.** `A4` names one
defect, the rows a keyed position renders being replaced wholesale, and a second
code for the second way to write it would make the author learn two names for
one mistake. D89's admission bar is met by both spellings on the same three
grounds, and the roster stays as short as the defects it names.

The proof for the derived spelling, following D89's proof-first discipline —
silent wherever any part is unproven:

1. the binding is a `computed`, so it really is recomputed. A `const` in a
   component body is constructed once and stays silent, because its records
   never move;
2. its initializer builds one fresh record per source element — a `map` whose
   callback answers a record literal, or a call to a `def` this module declares
   whose whole answer is a list it filled with record literals;
3. for the builder `def`, every value appended is a record literal, and at least
   one of those records reads a parameter of the `def` or the binding of the
   `for` that appends it. One `append` of a source record is the
   identity-preserving spelling this advisory teaches; a builder whose records
   are constant answers the same content on every call, so nothing it derives
   from can move;
4. a keyed interpolation renders that binding.

**The remedy differs because the author's options differ.** The assigned
spelling owns the list it rewrote, so the message names the field write next to
it. A derived value owns no row it could write, so the message names the two
alternatives that exist: render the source rows and change the field on those,
or carry the source records through rather than constructing new ones. The rest
of the message — the defect, the consequence, and the focus that is lost — is
word for word the same, because so is the defect.

No mechanical fix is registered. Neither remedy is a rewrite the compiler can
perform without judgement: which rows to render instead, and whether the source
records may be carried through, are the author's decisions. `velar-allow A4`
answers both spellings, and it stays the right answer where a `readonly` list or
one whole API response leaves building the rows as the only spelling.

## A module-level root failure surfaces the fatal state

**Fact.** `mount(<Boom />, "#app")` whose construction throws shows the
compiler-owned fatal state. The same application written at D90 R4-b's designed
site — `const root = <Boom />`, then `mount(root, "#app")` — showed a blank
page: module-evaluation construction sits outside the mount transaction, so the
throw escaped module evaluation and nothing rendered at all.

**Decision: the no-blank-page promise wins.** `web-api.md` promises a fatal
state instead of a blank page for *every* initial-render path, and one of them
was not covered. The R4-b site stays legal and stays eager — props are still
forced once, in written order, at construction — and only its failure mode
changes.

- A component element constructed while the module evaluates catches its
  construction failure instead of throwing out of module evaluation. Module
  evaluation continues, which is what makes the rest of the promise reachable:
  the `@main` region still runs, so its `onError` handlers are installed and its
  `mount` is called. Reporting ahead of both would report to nobody.
- The mount that takes that root surfaces the failure: reported once through
  `velar/app` under the `mount` phase — the same phase the inline spelling
  reports, because the two are one root written two ways — and the fatal state
  renders into that mount's target, falling back to the document body when the
  target is missing too.
- A failed root nothing ever mounts surfaces at the first microtask instead,
  into the document body. It renders no fatal state if another root has already
  mounted: the promise is about a page with nothing on it, and a page that has
  an application on it is not one the fatal state may replace.
- Everything that runs under an owner of its own is untouched: a `def`, a class,
  a `test`, a `try` the author wrote, an arrow, a derived or watched expression,
  and the root argument of `mount`, whose failure the mount transaction already
  owns.

## Consequences

- One advisory code covers both spellings of the keyed-row rebuild, and the
  suppression an author already knows answers either.
- The three engines agree that a module-level root failure now shows the fatal
  state, and that a healthy module-level root is unchanged.
- D90 R2 is untouched: `__velarKeyed` still compares identity, and the framework
  still does not accommodate the idiom. The advisory channel is the compiler
  telling the author, not the framework taking responsibility.
- D90 R4-b is untouched as a design: module-level instantiation remains legal,
  eager, and ordered.
