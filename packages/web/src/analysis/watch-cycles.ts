/**
 * D114 W: the reactive places a watch is about — the subject it watches, the
 * places a body statement writes, and the one-hop `action`/`async def` writers
 * of this module. Everything here is a question about *paths and statements*;
 * nothing needs a type, which is why it reads as free functions and why, under
 * D115 §三's `web/analysis/`, it is its own module rather than 280 lines in the
 * middle of the Web analyzer.
 *
 * What a path *means* — whether the type at a depth is a collection, which of
 * its calls mutate — stays with the analyzer and arrives as `ReactiveSubjectWrite`.
 *
 * D115 P4 R3c: the three refusals themselves — the frozen subject, the shape
 * that computes rather than names, and the ring a body closes — join them over a
 * `WatchCycleHost`, so the path readings and the rules that rest on them are one
 * module. The type questions the rules ask now arrive through that host rather
 * than as a callback.
 */
import { type Span } from "@velarscript/compiler";
import {
  mutatingCollectionMethods,
  nonOptional,
  unknownType,
  type Expression,
  type Program,
  type Statement,
  type ValueType,
} from "@velarscript/compiler/extension";
import { isWebStatement } from "../ast.ts";
import { watchedResourceSurfaceRefusal } from "./component-guidance.ts";
import { isResourceBinding } from "./reactivity/bindings.ts";
import { type ReactiveNamesHost } from "./reactivity/host.ts";
import { renderWatchSubject, watchSubjectPath } from "./watch-subject.ts";
import { diagnostic } from "./web-types.ts";

/**
 * D114 W: one step a reactive path takes below its root — a named field, or an
 * element under a key that names the same element on two evaluations. The steps
 * are kept beside the rendered text because two questions are asked of a path:
 * "is this the same place" answers on the text, and "is this place inside that
 * one" has to walk, both to compare step by step and to descend the subject's
 * type to the value the write lands on.
 */
export type ReactivePathStep =
  | { readonly kind: "field"; readonly name: string }
  | { readonly kind: "index"; readonly key: string };

export interface ReactivePath {
  readonly root: string;
  readonly steps: readonly ReactivePathStep[];
  /** The place as one comparable key, e.g. `items[0].done`. */
  readonly text: string;
}

/**
 * D114 W: a reactive place written as one comparable key, so "the write and the
 * subject name the same place" is one string equality.
 *
 * It is deliberately narrower than `renderWatchSubject`, which reconstructs any
 * expression for a message. A key has to *decide*, so only the parts that name
 * the same place on two evaluations are allowed into one: names, fields, and an
 * index that is either a literal or another such path. `items[next()]` renders
 * perfectly well and answers a different element every call, so it has no key
 * and the shapes below stay silent on it — which is the right answer for a
 * refusal that has to be right every time.
 */
export function reactivePathOf(expression: Expression): ReactivePath | null {
  switch (expression.kind) {
    case "IdentifierExpression":
      return { root: expression.name, steps: [], text: expression.name };
    case "MemberExpression": {
      if (expression.optional) return null;
      const object = reactivePathOf(expression.object);
      if (object === null) return null;
      return {
        root: object.root,
        steps: [...object.steps, { kind: "field", name: expression.property }],
        text: `${object.text}.${expression.property}`,
      };
    }
    case "IndexExpression": {
      if (expression.optional) return null;
      const object = reactivePathOf(expression.object);
      if (object === null) return null;
      const index = expression.index.kind === "LiteralExpression"
        ? (typeof expression.index.value === "string" ? JSON.stringify(expression.index.value) : expression.index.raw)
        : reactiveWritePath(expression.index);
      if (index === null) return null;
      return {
        root: object.root,
        steps: [...object.steps, { kind: "index", key: index }],
        text: `${object.text}[${index}]`,
      };
    }
    default:
      return null;
  }
}

function reactiveWritePath(expression: Expression): string | null {
  return reactivePathOf(expression)?.text ?? null;
}

/**
 * D114 0.28.0 H-D1: the steps a written place takes *below* the watch subject,
 * `[]` when the write is the subject itself, and null when it is neither. §15
 * says a watch fires on a deep change of its subject, so a write of a part of
 * the subject is the same ring as a write of the subject — and a sibling
 * (`watch form.name:` writing `form.email`) or a different root is not.
 */
export function reactiveStepsBelow(subject: ReactivePath, written: ReactivePath): readonly ReactivePathStep[] | null {
  if (written.root !== subject.root || written.steps.length < subject.steps.length) return null;
  for (const [index, step] of subject.steps.entries()) {
    const other = written.steps[index]!;
    if (step.kind !== other.kind) return null;
    if (step.kind === "field" ? step.name !== (other as { readonly name: string }).name
      : step.key !== (other as { readonly key: string }).key) return null;
  }
  return written.steps.slice(subject.steps.length);
}

/**
 * D114 W: the calls that mutate the value at one place, or null where the place
 * holds no collection. One reading of the compiler's own roster, asked of the
 * subject and of any place below it alike, so a deep mutating call and a direct
 * one can never disagree about which methods write.
 */
export function collectionMutators(place: ValueType): ReadonlySet<string> | null {
  return place.kind === "list" || place.kind === "map" || place.kind === "set" || place.kind === "record"
    ? mutatingCollectionMethods(place.kind)
    : null;
}

/** The root name a reactive path starts from, which is the binding it resolves through. */
export function reactivePathRoot(expression: Expression): string | null {
  switch (expression.kind) {
    case "IdentifierExpression":
      return expression.name;
    case "MemberExpression":
    case "IndexExpression":
      return reactivePathRoot(expression.object);
    default:
      return null;
  }
}

type WatchBindingPattern = Extract<Statement, { readonly kind: "VariableDeclaration" }>["pattern"];

function bindingPatternBinds(pattern: WatchBindingPattern, name: string): boolean {
  switch (pattern.kind) {
    case "NameBindingPattern":
      return pattern.name === name;
    case "ObjectBindingPattern":
      return pattern.rest?.name === name || pattern.entries.some((entry) => bindingPatternBinds(entry.pattern, name));
    case "ListBindingPattern":
      return pattern.rest?.name === name
        || pattern.elements.some((element) => element !== null && bindingPatternBinds(element, name));
    default:
      return false;
  }
}

/**
 * D114 W: whether a body statement introduces its own binding of `name`. From
 * that statement on, the spelling names something else, and a write through it
 * is not a write of the watched place. The scan stops there rather than
 * guessing which of the two a later line meant.
 */
export function statementBindsName(statement: Statement, name: string): boolean {
  switch (statement.kind) {
    case "VariableDeclaration":
      return bindingPatternBinds(statement.pattern, name);
    case "UsingDeclaration":
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return statement.name === name;
    default:
      return false;
  }
}

/**
 * D114 W: the call a body statement makes when the statement is nothing but
 * that call. `detach` is included because it is how a synchronous watch body
 * starts asynchronous work — the tour and four charter fences spell the reload
 * that way — so a refusal that only saw the bare call would miss the shape it
 * exists for. Everything else (a call inside an `if`, an argument, an assigned
 * result) is not a plain top-level call and is not offered here.
 */
export function topLevelCall(statement: Statement): Extract<Expression, { readonly kind: "CallExpression" }> | null {
  const expression = statement.kind === "ExpressionStatement" ? statement.expression
    : statement.kind === "DetachStatement" ? statement.expression
      : null;
  return expression !== null && expression.kind === "CallExpression" ? expression : null;
}

/**
 * D114 W: the reactive place one plain body statement writes, and how. An
 * assignment or a compound assignment names its target and no method; a call
 * names its receiver and the method called on it, and the caller decides
 * whether that method mutates — the roster depends on the kind of value at the
 * receiver, which only the caller holds a type for.
 */
export interface ReactiveWriteCandidate {
  readonly place: ReactivePath;
  /** The method called on `place`, or null when the statement is an assignment. */
  readonly method: string | null;
}

export function reactiveWriteCandidate(statement: Statement): ReactiveWriteCandidate | null {
  if (statement.kind === "AssignmentStatement") {
    const place = reactivePathOf(statement.target);
    return place === null ? null : { place, method: null };
  }
  const call = statement.kind === "ExpressionStatement" && statement.expression.kind === "CallExpression"
    ? statement.expression
    : null;
  if (call === null || call.callee.kind !== "MemberExpression" || call.callee.optional) return null;
  const place = reactivePathOf(call.callee.object);
  return place === null ? null : { place, method: call.callee.property };
}

/**
 * D114 W: whether one plain body statement writes the watched place — the
 * subject itself, or any place below it. An assignment or a compound
 * assignment to it is one; so is a call of a mutating collection method on it,
 * because a watch on a collection fires on its deep mutation and `mutators`
 * answers the compiler's own roster of the calls that mutate whatever sits at
 * that depth.
 *
 * D114 0.28.0 H-D1's other half: `watch form: rename()` where `rename` writes
 * `form.name` is the same ring as `watch form: form.name = …`, which F1 already
 * refuses. The subject and the writer question read one comparison —
 * `reactiveStepsBelow` — so a deep write cannot be a cycle at one of them and
 * not at the other.
 */
export function reactiveWriteOf(statement: Statement, subject: ReactivePath, writes: ReactiveSubjectWrite): ReactivePath | null {
  const write = reactiveWriteCandidate(statement);
  if (write === null) return null;
  const steps = reactiveStepsBelow(subject, write.place);
  if (steps === null) return null;
  return writes(steps, write.method) ? write.place : null;
}

/**
 * Whether a write `steps` below the watched subject, made the given way, is a
 * write of the subject. Only the analyzer can answer it — the roster of
 * mutating calls depends on the type at that depth — so both the body scan and
 * the one-hop writer scan are handed the same closure rather than each deciding
 * what counts as a write.
 */
export type ReactiveSubjectWrite = (steps: readonly ReactivePathStep[], method: string | null) => boolean;

/**
 * D114 W A2(b): whether an `action` or `async def` writes `path` at its own top
 * level, unconditionally. One hop: what the callee itself calls is not
 * followed. A parameter of the callee's own that is spelled like the path's
 * root, or a binding it declares before the write, means the write is not of
 * the watched place and the answer is no.
 */
export function writerWritesPath(writer: ReactiveWriterDeclaration, subject: ReactivePath, writes: ReactiveSubjectWrite): ReactivePath | null {
  if (writer.parameters.includes(subject.root)) return null;
  for (const statement of writer.body) {
    if (statementBindsName(statement, subject.root)) return null;
    const written = reactiveWriteOf(statement, subject, writes);
    if (written !== null) return written;
  }
  return null;
}

/**
 * D114 W A2(b): the `action` and `async def` declarations of one module, by
 * name. A name declared twice — or once as an ordinary `def` — answers `null`,
 * because the refusal must know exactly which body a call reaches and two
 * candidates mean it does not.
 *
 * The walk is `collectModuleFunctions`'s: module body, component bodies, and
 * the bodies of the functions themselves, so a nested declaration of a name
 * makes that name ambiguous here rather than silently resolving to the outer
 * one.
 */
export interface ReactiveWriterDeclaration {
  readonly spelling: "action" | "async def";
  readonly parameters: readonly string[];
  readonly body: readonly Statement[];
}

export function collectReactiveWriters(program: Program): ReadonlyMap<string, ReactiveWriterDeclaration | null> {
  const writers = new Map<string, ReactiveWriterDeclaration | null>();
  const claim = (name: string, declaration: ReactiveWriterDeclaration | null): void => {
    writers.set(name, writers.has(name) ? null : declaration);
  };
  const record = (statements: readonly Statement[]): void => {
    for (const statement of statements) {
      if (statement.kind === "FunctionDeclaration") {
        claim(statement.name, statement.asynchronous
          ? { spelling: "async def", parameters: statement.parameters.map((parameter) => parameter.name), body: statement.body }
          : null);
        record(statement.body);
        continue;
      }
      if (!isWebStatement(statement)) continue;
      if (statement.kind === "ExtensionStatement:web:action") {
        claim(statement.name, {
          spelling: "action",
          parameters: statement.parameters.map((parameter) => parameter.name),
          body: statement.body as readonly Statement[],
        });
        record(statement.body as readonly Statement[]);
        continue;
      }
      if (statement.kind === "ExtensionStatement:web:component") record(statement.body as readonly Statement[]);
    }
  };
  record(program.body);
  return writers;
}

/**
 * D114 0.28.0 H-D1: the VEL5077 message one plain body statement earns, or null
 * when it earns none.
 *
 * §15 says a watch fires on a *deep* change of its subject, so `watch form:
 * form.name = …` and `watch items: items[0].done = …` are the same ring
 * `items.append(…)` already is — decided at the top of the body, with no
 * condition to end it — and were silent until the runtime's 100-round cap
 * stopped them. The rule is therefore stated on the path rather than on the
 * spelling: a write whose place is the subject, or any place below it, in an
 * assignment, a compound assignment, or a mutating call.
 *
 * Every existing exclusion stands, because each is answered somewhere else: a
 * conditional or nested write is not a plain body statement, a rebinding stops
 * the scan in `rejectWatchCycle`, and a sibling path (`watch form.name:` writing
 * `form.email`) or a different root fails the step comparison here.
 */
export function watchSelfWrite(
  subject: Expression,
  place: ReactivePath,
  statement: Statement,
  writes: ReactiveSubjectWrite,
  position = "at the top of its body",
): string | null {
  const write = reactiveWriteCandidate(statement);
  if (write === null) return null;
  const steps = reactiveStepsBelow(place, write.place);
  if (steps === null || !writes(steps, write.method)) return null;
  // A derived value is offered only where it could be declared. A field or an
  // element has no `computed` spelling of its own, so naming one would hand the
  // author a line that does not compile.
  const derived = subject.kind === "IdentifierExpression"
    ? `declare 'computed ${place.text} = ...' instead`
    : "write this value where it is produced instead";
  const head = steps.length === 0
    ? `This watch writes its own subject '${place.text}'`
    : `This watch writes '${write.place.text}', a part of its subject '${place.text}',`;
  return `${head} ${position}, so every run re-triggers it and the runtime stops the loop after 100`
    + ` rounds; write the condition that ends it, or watch the input this value follows and ${derived}`;
}

/**
 * D114 0.29.0 ST-D2: `finally` is the one nested block a body cannot get out of.
 * §15 refuses a body whose top level *unconditionally* writes its own subject,
 * and "nested" had been standing in for "conditional" — but a `for` body may run
 * zero times, a `try` body may be cut short by a throw and a `match` arm is
 * chosen by data, while every path through a `try` at the body's top level
 * passes through its `finally`. So the write there is proved the same way a
 * top-level write is, and only there: a `try` inside an `if` is a conditional
 * again and stays the runtime cap's (ST-U1).
 */
export function finallySelfWrite(
  subject: Expression,
  place: ReactivePath,
  statement: Statement,
  writes: ReactiveSubjectWrite,
  root: string,
): { readonly message: string; readonly span: Span } | null {
  if (statement.kind !== "TryStatement" || statement.finallyBody === null) return null;
  for (const inner of statement.finallyBody) {
    if (statementBindsName(inner, root)) return null;
    const message = watchSelfWrite(subject, place, inner, writes,
      "in the 'finally' of a 'try' at the top of its body, which every path through the body runs");
    if (message !== null) return { message, span: inner.span };
  }
  return null;
}

/**
 * D114 P6 item 6 (ST-U2): the VEL5077 message a plain body statement earns for
 * writing the state that the watched `computed` is computed from, or null.
 *
 * The charter's exclusion -- "a write of a different state leaves the watch
 * untouched" -- read this shape as untouched, and it is not: `doubled` is
 * `count`, one hop away, so a write of `count` at the top of the body
 * invalidates `doubled` and re-triggers the watch. The runtime saw it only as a
 * task that ran out of observer budget after 50,000 rounds, with no line to
 * point at.
 *
 * Every limit the ruling names is a condition here rather than a caveat in a
 * comment: the subject is a plain name this module declares as `computed`
 * exactly once (a cross-module source is not in `derivations`), the write's root
 * is a name this module declares as `state` exactly once, and that state is one
 * the computed reads on every evaluation and directly -- a second `computed` in
 * between contributes its own name, not the state under it, so a two-hop chain
 * is not this refusal's.
 *
 * Shadowing is closed from both sides, because a name is not a binding. The
 * module-wide roster answers "declared once", so a component that declares its
 * own `state` of the same name makes the question unanswerable and nothing is
 * reported; `writesState` answers "the write here really is a write of reactive
 * state", resolved lexically, so an ordinary `let` of that spelling in front of
 * the watch is not one. Only a write that passes both is the one the computed
 * read.
 */
export function watchDerivedSourceWrite(
  subject: Expression,
  statement: Statement,
  derivations: ReadonlyMap<string, ReadonlySet<string> | null>,
  states: ReadonlyMap<string, boolean>,
  writesState: (name: string) => boolean,
): string | null {
  if (subject.kind !== "IdentifierExpression") return null;
  const sources = derivations.get(subject.name);
  if (sources === undefined || sources === null) return null;
  const write = reactiveWriteCandidate(statement);
  // A mutating call writes *through* the value the state holds; the write this
  // refusal is about is the one that replaces what the computed read.
  if (write === null || write.method !== null || write.place.steps.length > 0) return null;
  const written = write.place.root;
  if (written === subject.name || !sources.has(written) || states.get(written) !== true) return null;
  if (!writesState(written)) return null;
  return `This watch writes '${written}' at the top of its body, and '${subject.name}' is computed from '${written}',`
    + ` so writing '${written}' re-triggers this watch and the runtime stops the task when it runs out of observer budget;`
    + ` write the condition that ends it, or watch '${written}' and derive what this body needs from it`;
}

/**
 * What the watch refusals ask of the analyzer that hosts them: the three module
 * tables the reactive graph is read out of, and the type questions a path walk
 * asks. It extends `ReactiveNamesHost` because a subject is first a *name*, and
 * whether that name is a resource or a derived value decides which of the three
 * refusals answers.
 *
 * D115 P4 R3c. The three tables are replaced once per program, so they arrive
 * through getters and a rule reading one mid-walk reads the live table.
 */
export interface WatchCycleHost extends ReactiveNamesHost {
  /** D114 P6 item 6 (ST-U2): each same-module `computed` and the names it reads on every evaluation. Replaced per program. */
  readonly reactiveDerivations: ReadonlyMap<string, ReadonlySet<string> | null>;
  /** Each `state` this module declares, false where the name is declared twice. Replaced per program. */
  readonly reactiveStateNames: ReadonlyMap<string, boolean>;
  /** D114 W A2(b): this module's `action` and `async def` bodies by name. Replaced per program. */
  readonly reactiveWriters: ReadonlyMap<string, ReactiveWriterDeclaration | null>;

  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
}

/**
 * D69 rule 178: a `watch` body that can never run is a block of statements
 * the compile silently drops — the same defect a bare `5` is already rejected
 * for (VEL4030), reached from a position the rule could not see.
 *
 * D90 R15(a) adds the third refusal and fixes the order the three are asked
 * in. A frozen subject is answered before the shape rule so that one shape
 * never draws two messages: a subject built only from frozen parts has no
 * reactive source at all, and telling its author to declare a `computed`
 * would only buy him a dead one. What survives both is either a path — the
 * name of a reactive binding, or a member/index read out of one — or a
 * computation, and a computation has a spelling of its own.
 *
 * The three refusals are separate because their causes are: a reader that was
 * not called names a value that never moves, a frozen value has no reactive
 * source behind it at all, and a computed subject has one but hides which.
 */
export function rejectFrozenWatchSubject(
  host: WatchCycleHost,
  expression: Expression,
  watched: ValueType,
  currentName: string | null,
  previousName: string | null,
): boolean {
  const name = expression.kind === "IdentifierExpression" ? expression.name : null;
  if (name !== null && host.reactiveBindingKind(name) === null && zeroArgumentReader(host, watched)) {
    host.diagnostics.push(diagnostic(
      "VEL5064",
      `'${name}' is the reader itself, so watching it watches a value that never changes; declare the derived value — 'computed name = ${name}()' — then 'watch name:'`,
      expression.span,
    ));
    return false;
  }
  // ST-D1: the resource surface is answered ahead of the frozen rule, because it is a reactive value whose *own* handle never moves.
  if (name !== null && isResourceBinding(host, name)) {
    host.diagnostics.push(diagnostic("VEL5064", watchedResourceSurfaceRefusal(name), expression.span));
    return false;
  }
  if (frozenWatchSubject(host, expression)) {
    host.diagnostics.push(diagnostic(
      "VEL5064",
      `This watch subject never changes, so its body can never run${name === null ? "" : ` — '${name}' is not a reactive source`}; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run`,
      expression.span,
    ));
    return false;
  }
  if (watchSubjectPath(expression)) return true;
  // D69's own shape, `watch total()`, is a called `computed`, and VEL5063 has
  // already named it with the one-character edit that makes this subject
  // legal. Stacking the shape rule on top would report one mistake twice and
  // would hand the author 'computed value = total()' — a line that reports
  // VEL5063 in its turn. The same reason the frozen rule is asked first.
  if (host.diagnostics.some((item) => item.code === "VEL5063"
    && item.span.start === expression.span.start && item.span.end === expression.span.end)) return false;
  const derived = currentName ?? "value";
  const watchLine = currentName === null
    ? `watch ${derived}:`
    : `watch ${derived} as current${previousName === null ? "" : `, ${previousName}`}:`;
  const rendered = renderWatchSubject(expression);
  host.diagnostics.push(diagnostic(
    "VEL5071",
    rendered === null
      ? `A watch subject names what to watch, not what to compute. Declare the value — 'computed ${derived} = ...' — then '${watchLine}'`
      : `A watch subject names what to watch, not what to compute: '${rendered}' computes a value. Declare it — 'computed ${derived} = ${rendered}' — then '${watchLine}'`,
    expression.span,
  ));
  return false;
}

/**
 * D114 W: the three watch shapes a compile can prove re-trigger the watch
 * itself. D90 R21 removed the analysis of *who writes what* across calls, and
 * nothing here brings it back: two watches writing one state are still an
 * ordinary program, a write reached through an ordinary helper is still
 * silent, and a write under `if`, `match`, a loop, `try`, a nested `def` or an
 * arrow is still the author's converging correction to make.
 *
 * What is refused is only what is decided at the top of the body, with no
 * condition to end it:
 *
 *  - **B** the body writes the watched place itself (`watch count: count =
 *    count + 1`), assignment, compound assignment, or a mutating collection
 *    call on the watched collection;
 *  - **A2(a)** the subject is a `resource` field and the body reloads that
 *    same resource — a reload writes exactly those fields, so every completed
 *    load re-triggers the watch;
 *  - **A2(b)** the body starts an `action` or an `async def` of this module
 *    whose own top level writes the watched place. One hop, one module, no
 *    condition on either end; anything further is the runtime budget's.
 *
 * One diagnostic per watch, at the first statement that earns it. A watch with
 * two of these has two mistakes, and the second is read after the first is
 * fixed, exactly as two errors on one line are.
 */
export function rejectWatchCycle(host: WatchCycleHost, subject: Expression, watched: ValueType, body: readonly Statement[]): void {
  const root = reactivePathRoot(subject);
  if (root === null) return;
  const place = reactivePathOf(subject);
  const writes = (steps: readonly ReactivePathStep[], method: string | null): boolean =>
    watchSubjectWrite(host, watched, steps, method);
  // A resource publishes `value`, `loading`, `ready` and `error`, and
  // `reload` is the one member of the five that is not one of them. Asking it
  // that way keeps `analyzeResourceDeclaration`'s field map the only roster:
  // a field added there is a field this recognises, with nothing to update.
  const resource = subject.kind === "MemberExpression" && !subject.optional
    && subject.object.kind === "IdentifierExpression" && subject.property !== "reload"
    && isResourceBinding(host, subject.object.name)
    ? subject.object.name
    : null;
  for (const statement of body) {
    if (statementBindsName(statement, root)) return;
    const selfWrite = place === null ? null : watchSelfWrite(subject, place, statement, writes);
    if (selfWrite !== null) {
      host.diagnostics.push(diagnostic("VEL5077", selfWrite, statement.span));
      return;
    }
    const inFinally = place === null ? null : finallySelfWrite(subject, place, statement, writes, root);
    if (inFinally !== null) {
      host.diagnostics.push(diagnostic("VEL5077", inFinally.message, inFinally.span));
      return;
    }
    const hop = watchDerivedSourceWrite(subject, statement, host.reactiveDerivations, host.reactiveStateNames, (name) => host.reactiveBindingKind(name) === "state");
    if (hop !== null) {
      host.diagnostics.push(diagnostic("VEL5077", hop, statement.span));
      return;
    }
    const call = topLevelCall(statement);
    if (call === null) continue;
    if (resource !== null && call.callee.kind === "MemberExpression" && !call.callee.optional
      && call.callee.property === "reload" && call.callee.object.kind === "IdentifierExpression"
      && call.callee.object.name === resource) {
      host.diagnostics.push(diagnostic(
        "VEL5078",
        `This watch reloads '${resource}' — the resource it watches — so every completed load re-triggers it; watch the input the load reads instead, as 'watch userId:' with 'detach ${resource}.reload()' in its body`,
        call.span,
      ));
      return;
    }
    if (place === null || call.callee.kind !== "IdentifierExpression") continue;
    const writer = host.reactiveWriters.get(call.callee.name) ?? null;
    const written = writer === null ? null : writerWritesPath(writer, place, writes);
    if (written === null) continue;
    // D114 0.28.0 H-D1's other half, in the message family F1 gave VEL5077:
    // a writer that reaches a *part* of the subject names the part it wrote
    // and the subject it belongs to, because those are two different places
    // and the author has to find the one the helper touches.
    const reached = written.text === place.text
      ? `'${place.text}' — the reactive value this watch is on`
      : `'${written.text}', a part of its subject '${place.text}'`;
    host.diagnostics.push(diagnostic(
      "VEL5079",
      `This watch starts '${call.callee.name}', which writes ${reached} — so each completed run re-triggers the watch; make the write conditional, or watch the input '${call.callee.name}' reads`,
      call.span,
    ));
    return;
  }
}

/**
 * Whether a write `steps` below the watched subject, made the given way, is a
 * write of the subject — the one definition both the body scan (VEL5077) and
 * the one-hop writer scan (VEL5079) read. An assignment to a place the walk
 * can reach is a write; a call is one only when the type at that depth is a
 * collection and the call is on its own mutating roster.
 */
export function watchSubjectWrite(host: WatchCycleHost, watched: ValueType, steps: readonly ReactivePathStep[], method: string | null): boolean {
  const written = reactivePlaceType(host, watched, steps);
  if (written === null) return false;
  if (method === null) return true;
  const mutating = collectionMutators(nonOptional(host.expandAliases(written)));
  return mutating !== null && mutating.has(method);
}

/**
 * D114 0.28.0 H-D1: the type of the place `steps` below the watched subject,
 * or null when the walk cannot reach one.
 *
 * Only the steps the reactive graph publishes as part of the subject are
 * walked — a record field and a collection element — because those are the
 * writes a watch on the containing value is woken by. A step that leaves them
 * (a class instance, a capability handle, a field the record does not declare)
 * is not provably part of the subject, and a refusal that must be right every
 * time answers no there rather than guessing.
 */
export function reactivePlaceType(host: WatchCycleHost, subject: ValueType, steps: readonly ReactivePathStep[]): ValueType | null {
  let current = subject;
  for (const step of steps) {
    const owner = nonOptional(host.expandAliases(current));
    const next = step.kind === "field"
      ? (owner.kind === "object" ? owner.fields.get(step.name) ?? null
        : owner.kind === "record" ? owner.value
          : owner.kind === "named" ? host.fieldsOf(owner.identity ?? owner.name)?.get(step.name) ?? null
            : null)
      : (owner.kind === "list" || owner.kind === "set" ? owner.element
        : owner.kind === "map" || owner.kind === "record" ? owner.value
          : null);
    if (next === null) return null;
    current = next;
  }
  return current;
}

/** A value that is read by calling it and takes no arguments to do so. */
export function zeroArgumentReader(host: WatchCycleHost, type: ValueType): boolean {
  const expanded = host.expandAliases(type);
  return (expanded.kind === "function" || expanded.kind === "intrinsic") && expanded.requiredParameters === 0;
}

/**
 * True only for subjects built entirely from values the compile can see are
 * frozen: literals, and non-reactive bindings whose type is a primitive, so no
 * deep-reactive object can be hiding behind the name. Every member access,
 * index, and call is excluded on purpose — `alias.done` on a const bound to a
 * reactive element does track, and a call can read anything.
 */
export function frozenWatchSubject(host: WatchCycleHost, expression: Expression): boolean {
  switch (expression.kind) {
    case "LiteralExpression":
      return true;
    case "FStringExpression":
      return expression.parts.every((part) => part.kind === "text" || frozenWatchSubject(host, part.value));
    case "IdentifierExpression":
      return host.reactiveBindingKind(expression.name) === null
        && !host.derivedReactiveNames.has(expression.name)
        && frozenValueType(host, host.lookup(expression.name)?.type ?? unknownType);
    case "UnaryExpression":
      return expression.operator !== "await" && frozenWatchSubject(host, expression.operand);
    case "BinaryExpression":
      return frozenWatchSubject(host, expression.left) && frozenWatchSubject(host, expression.right);
    case "ComparisonChainExpression":
      return expression.operands.every((operand) => frozenWatchSubject(host, operand));
    case "ConditionalExpression":
      return frozenWatchSubject(host, expression.condition) && frozenWatchSubject(host, expression.thenValue)
        && frozenWatchSubject(host, expression.elseValue);
    case "IsExpression":
      return frozenWatchSubject(host, expression.value);
    default:
      return false;
  }
}

/** A primitive holds no reactive identity, so a non-reactive binding of one is a snapshot. */
export function frozenValueType(host: WatchCycleHost, type: ValueType): boolean {
  const expanded = host.expandAliases(type);
  if (expanded.kind === "optional") return frozenValueType(host, expanded.inner);
  if (expanded.kind === "union") return expanded.members.every((member) => frozenValueType(host, member));
  return expanded.kind === "number" || expanded.kind === "string" || expanded.kind === "bool"
    || expanded.kind === "null" || expanded.kind === "enum";
}
