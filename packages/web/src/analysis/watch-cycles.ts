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
 */
import {
  mutatingCollectionMethods,
  type Expression,
  type Program,
  type Statement,
  type ValueType,
} from "@velarscript/compiler/extension";
import { isWebStatement } from "../ast.ts";

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
