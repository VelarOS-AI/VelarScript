/**
 * D89 A4: a 'map' callback that rebuilds its rows instead of carrying them
 * over, which is what a keyed list stops recognising — what one rebuild records,
 * and the module reading that decides whether a helper builds fresh records at
 * all.
 *
 * D115 P4 R3a: the advisory is raised from the analyzer's JSX pass, but every
 * reading it rests on is a reading of the program, so they read as a module.
 *
 * D115 P4 R3c: the four rules that record a rebuild and raise the advisory join
 * them, over a `KeyedRebuildHost`.
 */
import { type DiagnosticFix, type Span } from "@velarscript/compiler";
import { spanIdentity, type Expression, type Program, type Statement, type ValueType } from "@velarscript/compiler/extension";
import { isWebStatement, type WebComputedDeclaration as ComputedDeclaration } from "../ast.ts";
import { rowFieldPassthrough } from "./jsx-detection.ts";

/**
 * D89 A4: what a `map` callback rebuilds, when it returns a newly built record
 * instead of the row it was handed. Null is the non-trigger answer the ruling
 * names — a callback that returns its parameter, or anything else that is not a
 * record literal, builds nothing and moves no identity. A record is reported
 * even when no field can be named, because it is the rebuilt row's own identity
 * that the keyed list stops recognising, not any one field it carries.
 *
 * A conditional is read through because the React spelling nearly always
 * carries one, `t.id == id ? {...t, done: true} : t`, and its `else` branch is
 * the returns-the-original case rather than a second shape. A branch that names
 * a field is preferred, since a suggestion that names one is the whole product.
 */
export function keyedRebuiltRecord(body: Expression, row: string): { readonly field: string | null } | null {
  if (body.kind === "ObjectExpression") {
    // `{ id: item.id, done: true }` copies the key across and rewrites `done`.
    // Naming `id` would send the author to write the one field whose value the
    // keyed list reads, so a field that only carries the row's own value over
    // is not the field the message is about.
    for (const property of body.properties) {
      if (property.kind !== "ObjectProperty") continue;
      if (rowFieldPassthrough(property.value, row, property.name)) continue;
      return { field: property.name };
    }
    // A pure `{...item}` rewrites no field at all; the copy itself is what
    // moves the row's identity, so there is no field name for the message.
    return body.properties.length > 0 ? { field: null } : null;
  }
  if (body.kind === "ConditionalExpression") {
    const thenSide = keyedRebuiltRecord(body.thenValue, row);
    const elseSide = keyedRebuiltRecord(body.elseValue, row);
    if (thenSide?.field) return thenSide;
    if (elseSide?.field) return elseSide;
    return thenSide ?? elseSide;
  }
  return null;
}

export type FunctionDeclarationStatement = Extract<Statement, { readonly kind: "FunctionDeclaration" }>;

/**
 * D89 A4, the wider proven shape: every `def` of the module by name, so a
 * `computed` whose initializer calls one can be read through to what that call
 * builds. A name declared twice maps to null — two bodies under one name make
 * the question unanswerable, and an advisory that cannot prove which body runs
 * stays silent rather than guessing.
 */
export function collectModuleFunctions(program: Program): ReadonlyMap<string, FunctionDeclarationStatement | null> {
  const functions = new Map<string, FunctionDeclarationStatement | null>();
  const record = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === "FunctionDeclaration") {
        functions.set(statement.name, functions.has(statement.name) ? null : statement);
        record(statement.body);
        continue;
      }
      if (isWebStatement(statement) && statement.kind === "ExtensionStatement:web:component") {
        record(statement.body as readonly Statement[]);
      }
    }
  };
  record(program.body);
  return functions;
}

type LoopBindingPattern = Extract<Statement, { readonly kind: "ForStatement" }>["pattern"];

/** Every name a binding pattern introduces, added to `names`. */
function collectPatternNames(pattern: LoopBindingPattern, names: Set<string>): void {
  if (pattern.kind === "NameBindingPattern") {
    names.add(pattern.name);
    return;
  }
  if (pattern.kind === "ListBindingPattern") {
    for (const element of pattern.elements) if (element) collectPatternNames(element, names);
  } else {
    for (const entry of pattern.entries) collectPatternNames(entry.pattern, names);
  }
  if (pattern.rest) names.add(pattern.rest.name);
}

/** True when the expression reads one of `names` anywhere inside it. */
function readsAnyName(value: unknown, names: ReadonlySet<string>): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => readsAnyName(item, names));
  const record = value as Record<string, unknown>;
  if (record.kind === "IdentifierExpression" && typeof record.name === "string" && names.has(record.name)) return true;
  return Object.values(record).some((child) => readsAnyName(child, names));
}

/**
 * D89 A4, the wider proven shape: whether a `def` answers a list it filled with
 * freshly constructed records — the `for`/`append` builder that spells the same
 * churn `list = list.map(item => {…})` spells with `map`, and the spelling the
 * P2b consumer actually wrote.
 *
 * Four things are proven, and any one of them missing leaves the advisory
 * silent, because the whole product is naming a rebuild that really happens:
 *
 * 1. the body's last statement returns a name it declared here, initialized to
 *    an empty list literal — so the list is the `def`'s own, not one handed in;
 * 2. every value appended to that list is a record literal, so every element is
 *    a new value on every call. One `append(row)` of a source record is the
 *    identity-preserving spelling this advisory teaches, and one member call
 *    the proof cannot read leaves the whole answer unproven;
 * 3. at least one such record reads a parameter of the `def` or the binding of
 *    the `for` that appends it. A builder whose records are constant answers
 *    the same content every call, so nothing it is derived from can move and
 *    the `computed` over it never recomputes;
 * 4. nothing else touches the list — it is built and answered, nothing more.
 */
export function buildsFreshRecords(declaration: FunctionDeclarationStatement): boolean {
  const returned = declaration.body.at(-1);
  if (!returned || returned.kind !== "ReturnStatement" || returned.value?.kind !== "IdentifierExpression") return false;
  const built = returned.value.name;
  const local = declaration.body.find((statement) => statement.kind === "VariableDeclaration"
    && statement.pattern.kind === "NameBindingPattern" && statement.pattern.name === built);
  if (!local || local.kind !== "VariableDeclaration") return false;
  if (local.initializer.kind !== "ListExpression" || local.initializer.elements.length > 0) return false;

  const parameters = new Set(declaration.parameters.map((parameter) => parameter.name));
  let records = 0;
  let varying = false;
  let unproven = false;
  const walk = (statements: readonly Statement[], visible: ReadonlySet<string>): void => {
    for (const statement of statements) {
      if (statement.kind === "ForStatement") {
        const inner = new Set(visible);
        collectPatternNames(statement.pattern, inner);
        if (statement.secondPattern) collectPatternNames(statement.secondPattern, inner);
        walk(statement.body, inner);
        continue;
      }
      if (statement.kind === "IfStatement") {
        walk(statement.thenBody, visible);
        walk(statement.elseBody ?? [], visible);
        continue;
      }
      if (statement.kind === "WhileStatement") {
        walk(statement.body, visible);
        continue;
      }
      if (statement.kind !== "ExpressionStatement") continue;
      const call = statement.expression;
      if (call.kind !== "CallExpression" || call.callee.kind !== "MemberExpression") continue;
      if (call.callee.object.kind !== "IdentifierExpression" || call.callee.object.name !== built) continue;
      const [appended] = call.arguments;
      if (call.callee.property !== "append" || !appended || appended.kind !== "ObjectExpression") {
        unproven = true;
        continue;
      }
      records += 1;
      if (readsAnyName(appended, visible)) varying = true;
    }
  };
  walk(declaration.body, parameters);
  return !unproven && records > 0 && varying;
}

/**
 * D89 A4: one rebuild of a list's rows, held until the module's JSX is analyzed
 * so the advisory is raised only where that same list is what a keyed list
 * renders.
 *
 * `kind` names which spelling wrote it, and the two differ only in the remedy
 * the message ends with. An `assignment` — `list = list.map(item => {…})` — owns
 * the list it rewrote, so the preserving alternative is the field write next to
 * it. A `derived` rebuild is a `computed` that builds its rows, and a derived
 * value owns nothing it could write, so the alternative names the source rows
 * instead.
 */
export interface KeyedListRebuild {
  readonly kind: "assignment" | "derived";
  readonly source: string;
  readonly name: string;
  /** The rewritten field, or null when the rebuild names none. */
  readonly field: string | null;
  readonly span: Span;
}

/**
 * What the rebuild rules ask of the analyzer that hosts them: the two module
 * tables the walk fills, the module's `def` bodies, and the two analyzer
 * operations a rebuild is recorded and advised through.
 *
 * D115 P4 R3c. `moduleFunctions` is replaced once per program, so it arrives
 * through a getter and a collaborator reading it mid-walk reads the live one.
 */
export interface KeyedRebuildHost {
  /** D89 A4: every row rebuild of this module — assigned or derived — in source order. */
  readonly keyedListRebuilds: KeyedListRebuild[];
  /** D89 A4: the binding identity of every list a keyed `.map(...)` interpolation renders. */
  readonly keyedListSources: ReadonlySet<string>;
  /** D89 A4: this module's `def` bodies by name, so a `computed` that calls one can be read through. Replaced per program. */
  readonly moduleFunctions: ReadonlyMap<string, FunctionDeclarationStatement | null>;

  advise(code: string, message: string, adviceSpan: Span, fix?: DiagnosticFix): void;
  lookup(name: string): { readonly span: Span; readonly type: ValueType } | null;
}

/**
 * D89 A4: records `list = list.map(item => {…})`, React's immutable update,
 * where the callback builds a new record rather than changing a field.
 *
 * D90 R2 stands — `__velarKeyed` compares identity and that does not move,
 * and the framework does not accommodate the idiom. This channel is not the
 * framework taking responsibility; it is the compiler telling the author that
 * the row he is typing into is about to be destroyed. Nothing is reported
 * yet: the advisory is owed only if the rewritten list is what a keyed list
 * renders, and the render usually sits below the update.
 */
export function recordKeyedListRebuild(host: KeyedRebuildHost, statement: Statement): void {
  if (statement.kind !== "AssignmentStatement" || statement.operator !== "=") return;
  if (statement.target.kind !== "IdentifierExpression") return;
  const value = statement.value;
  if (value.kind !== "CallExpression" || value.callee.kind !== "MemberExpression" || value.callee.property !== "map") return;
  // The map has to be over the list being replaced; `rows = source.map(...)`
  // builds a new list, and a new list has no identity to preserve.
  if (value.callee.object.kind !== "IdentifierExpression" || value.callee.object.name !== statement.target.name) return;
  const callback = value.arguments[0];
  if (!callback || callback.kind !== "ArrowFunctionExpression") return;
  const [row] = callback.parameters;
  if (!row || callback.parameters.length !== 1) return;
  const rebuilt = keyedRebuiltRecord(callback.body, row.name);
  if (!rebuilt) return;
  const binding = host.lookup(statement.target.name);
  if (!binding) return;
  host.keyedListRebuilds.push({
    kind: "assignment",
    source: spanIdentity(binding.span),
    name: statement.target.name,
    field: rebuilt.field,
    span: statement.span,
  });
}

/**
 * D89 A4, the wider proven shape: the same churn written as a derived value.
 * `computed rows = source.map(item => {…})` and `computed rows = build(...)`
 * over a `for`/`append` builder both hand a keyed position a fresh record for
 * every row on every recompute, which is exactly what the assignment shape
 * does — the reconciliation wave compiled both and found only one of them
 * named. It is one advisory with a wider proof, not a second code: the defect,
 * the consequence, and the suppression are the same.
 *
 * A `const` in a component body is deliberately not here. It is constructed
 * once, so its records never move, and advising it would be a guess rather
 * than a proof.
 */
export function recordDerivedKeyedListRebuild(host: KeyedRebuildHost, statement: ComputedDeclaration): void {
  if (!rebuildsRecordsPerElement(host, statement.initializer)) return;
  host.keyedListRebuilds.push({
    kind: "derived",
    source: spanIdentity(statement.span),
    name: statement.name,
    field: null,
    span: statement.span,
  });
}

/**
 * Whether a derived initializer constructs one fresh record per source
 * element. Two spellings are proven and everything else is silent: a `map`
 * whose callback answers a record literal — the same recognizer the
 * assignment shape uses — and a call to a `def` this module declares whose
 * whole answer is a list it filled with record literals.
 */
export function rebuildsRecordsPerElement(host: KeyedRebuildHost, value: Expression): boolean {
  if (value.kind !== "CallExpression") return false;
  if (value.callee.kind === "MemberExpression" && value.callee.property === "map") {
    const callback = value.arguments[0];
    if (!callback || callback.kind !== "ArrowFunctionExpression" || callback.parameters.length !== 1) return false;
    const [row] = callback.parameters;
    return row !== undefined && keyedRebuiltRecord(callback.body, row.name) !== null;
  }
  if (value.callee.kind !== "IdentifierExpression") return false;
  const declaration = host.moduleFunctions.get(value.callee.name);
  return declaration !== undefined && declaration !== null && buildsFreshRecords(declaration);
}

/**
 * D89 A4: raises the advisory for the rebuilds whose list a keyed position
 * really renders. The advisory channel cannot reach `this.diagnostics`, so
 * nothing here fails a build, changes an emitted byte, or moves a semantic
 * rule; `// velar-allow A4: <reason>` suppresses it where building the rows is
 * the only spelling, which a `readonly` list or one API response makes it.
 */
export function adviseKeyedListRebuilds(host: KeyedRebuildHost): void {
  for (const rebuild of host.keyedListRebuilds) {
    if (!host.keyedListSources.has(rebuild.source)) continue;
    // The keys do not move; the rows do. `__velarKeyed` finds the entry under
    // the same key and then drops it because the row it holds is no longer
    // the same value, so a message blaming the key sends an author to check
    // `id`, find it unchanged, and conclude the advisory is wrong.
    // A derived value has no row to write: whatever it hands the keyed
    // position it built itself. The two ways out are to render the rows that
    // do have an identity, or to carry those same records through.
    const remedy = rebuild.kind === "derived"
      ? "A derived value cannot keep rows it builds: render the source rows and change the field on them in place, or carry the source records through instead of constructing new ones."
      : `Change the field in place instead: '${rebuild.name}[index].${rebuild.field ?? "<field>"} = ...'`;
    host.advise(
      "A4",
      `This rebuilds every row of '${rebuild.name}'${rebuild.kind === "derived" ? " on every recompute" : ""}, so every row is a new value and the keyed list that renders '${rebuild.name}' no longer recognises any of them: it destroys and rebuilds all of its children — an input being typed into loses focus. ${remedy}`,
      rebuild.span,
    );
  }
}
