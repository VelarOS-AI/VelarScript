/**
 * What every advisory proof shares: the shapes it reads, the narrow face it
 * asks the analyzer for, and the two small rosters and proofs more than one
 * family needs.
 *
 * D115 §三 / D114 R1f: `advisories.ts` split into one file per advisory family
 * when A8 arrived and pushed it past the 800-line budget. This module is the
 * floor of that directory and imports nothing from its siblings.
 */
import { type BindingPattern, type Expression } from "../../ast.ts";
import { type CollectionOperation, type RecordFromHint } from "../../contracts.ts";
import { type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";
import { nonOptional, type ValueType } from "../../types.ts";

/** The part of a resolved binding the proofs read. */
export interface AdvisoryBinding {
  readonly type: ValueType;
  readonly storageType: ValueType;
  readonly span: Span;
}

/** The record shape `Target.from` / `Target.mapFrom` projections are proved against. */
export interface AdvisoryRecordShape {
  readonly fields: ReadonlyMap<string, ValueType>;
  readonly optionalFields: ReadonlySet<string>;
  readonly readonlyFields: ReadonlySet<string>;
  readonly readonlyView: boolean;
}

/**
 * The one analysis-extension hook the roster calls (A13). Declared structurally
 * rather than imported: `CompilerAnalysisExtension` lives in `extension.ts`,
 * which imports the analyzer, and naming it here would put this module back
 * inside the five-module import ring `contracts.ts` was extracted to shrink.
 * `CompilerAnalysisExtension` satisfies this shape.
 */
export interface CanonicalCollectionProjectionExtension {
  readonly canonicalCollectionProjection?: (
    expression: Expression,
    pure: (expression: Expression) => boolean,
  ) => boolean | undefined;
}

/** The lowering facts a proof consults before claiming a call is compiler-owned. */
export interface AdvisoryLoweringFacts {
  readonly collectionCalls: ReadonlyMap<number, CollectionOperation>;
  readonly recordFromCalls: ReadonlyMap<string, RecordFromHint>;
  expressionUsesRuntimeNarrowing(expression: Expression): boolean;
}

/**
 * Everything the roster asks of the analyzer that hosts it, and nothing more.
 */
export interface AdvisoryHost {
  /** The module source: quoted in a message, and read to withhold a comment-erasing fix. */
  readonly sourceText: string;
  /** Asked whether a target extension owns an expression form the pipeline proof met (A13). */
  readonly analysisExtensions: readonly CanonicalCollectionProjectionExtension[];
  /** Searched for the name a projected record type is written as (A9/A10). */
  readonly typeAliases: ReadonlyMap<string, ValueType>;
  /** What the emitter will lower a call to, when a proof needs the call to be compiler-owned. */
  readonly lowering: AdvisoryLoweringFacts;
  advise(code: string, message: string, adviceSpan: Span, fix?: DiagnosticFix): void;
  expandAliases(type: ValueType): ValueType;
  /** The declared fields of a named type, for the member reads a proof rebuilds. */
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  /** How deep in `finally` blocks the walk is, so A8 can refuse to leave one. */
  readonly finallyLoopDepths: number[];
  /** How many function bodies the walk is inside, and how many constructors. */
  readonly functionDepth: number;
  readonly constructorDepth: number;
  inferredExpressionType(expression: Expression): ValueType;
  lookup(name: string): AdvisoryBinding | null;
  collectPatternNames(pattern: BindingPattern, add: (name: string) => void): void;
  commentPreservingMechanicalFix(rewriteSpan: Span, replacement: string, title: string): DiagnosticFix | undefined;
  recordProjectionShape(type: ValueType): AdvisoryRecordShape | null;
  stableDataMember(objectExpression: Expression, property: string): boolean;
}

// D89 A2's two rosters. They are deliberately short: every name here is one a
// Python author reaches for without thinking, and a name that has to be argued
// for is a name the advisory would be guessing about.
export const loopIndexSlotNames = new Set(["i", "idx", "index", "pos", "position"]);
export const loopValueSlotNames = new Set(["v", "value", "item", "el", "element"]);

/**
 * The singular of the iterated collection's own name, so `for i, user in
 * users` reads as the same swap as `for i, v in users`. Only a plain name is
 * read; an arbitrary expression has no name to make singular.
 */
export function singularIterableName(iterable: Expression): string | null {
  const name = iterable.kind === "IdentifierExpression" ? iterable.name
    : iterable.kind === "MemberExpression" ? iterable.property
      : null;
  if (name === null || !name.endsWith("s") || name.endsWith("ss")) return null;
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
  if (/(?:ch|sh|[sxz])es$/u.test(name)) return name.slice(0, -2);
  return name.slice(0, -1);
}

/**
 * Whether a member read a proof is about to rebuild is a plain data read that
 * cannot execute anything: a declared field, a record or enum entry, or the
 * `size` of a collection. A class getter or a method would run code, so no
 * proof may put it in a replacement it offers.
 *
 * D114 R1f: this was a private method of `analyzer.ts` reached only through
 * `AdvisoryHost`. Both readers — A8's predicate spelling and A13's pipeline
 * spelling — are in this directory, so it moved in with them and the host
 * member it needed is gone.
 */
export function canonicalCollectionMemberReadIsStable(
  host: Pick<AdvisoryHost, "expandAliases" | "fieldsOf" | "inferredExpressionType">,
  expression: Extract<Expression, { kind: "MemberExpression" }>,
): boolean {
  const stableOwner = (type: ValueType): boolean => {
    const owner = host.expandAliases(nonOptional(type));
    if (owner.kind === "union") return owner.members.every(stableOwner);
    if (owner.kind === "object") return owner.fields.has(expression.property);
    if (owner.kind === "named") return host.fieldsOf(owner.identity ?? owner.name)?.has(expression.property) === true;
    if (owner.kind === "record") return true;
    if (owner.kind === "enumObject") return true;
    if (owner.kind === "list" || owner.kind === "set" || owner.kind === "map" || owner.kind === "string") {
      return expression.property === "size";
    }
    return false;
  };
  return stableOwner(host.inferredExpressionType(expression.object));
}

/**
 * The A roster: every advisory id the language publishes, with the one line
 * that says what it is about.
 *
 * D114 MD-I4 made this a table rather than a set of `advise("A7", …)` call
 * sites scattered across this directory and two extensions. Two things needed
 * one place to read: `velar-allow` has to be able to say that `A18` is a real
 * id and `VEL6010` is not, and D114 item 11 puts the roster in the Core surface
 * digest so an id cannot be added, retitled or dropped without the `core`
 * counter moving. The titles are one line each on purpose — the rule each
 * advisory guards is written where that rule lives, never restated here.
 *
 * Ids an extension raises (`A4`, `A11`, `A12`, `A14`, `A16`) are listed here
 * too: the roster is the language's, and the number space is one space. What
 * belongs to the extension is the proof, not the id.
 */
export const ADVISORY_ROSTER: ReadonlyMap<string, string> = new Map([
  ["A1", "'//' read as floor division"],
  ["A2", "a two-slot 'for' written index-first"],
  ["A3", "'%' on a negative literal read as Python's modulo"],
  ["A4", "a keyed list rebuilt by 'map'"],
  ["A5", "JavaScript '${...}' in an ordinary string"],
  ["A6", "JavaScript '${...}' under the 'f' prefix"],
  ["A7", "a proven manual collection conversion"],
  ["A8", "a proven manual early-return List query"],
  ["A9", "a proven manual exact record projection"],
  ["A10", "a proven large same-field mapped projection"],
  ["A11", "a redundant same-name query mapping in a route pattern"],
  ["A12", "a design token written as free text in a Look property"],
  ["A13", "a proven manual List projection or filter builder"],
  ["A14", "an exact bool-to-text conditional in a native text attribute"],
  ["A15", "a record entry whose identifier key and value are the same name"],
  ["A16", "a complete supported CSS filter string"],
  ["A17", "a List literal standing for a tuple"],
  ["A18", "a circular module dependency"],
]);

/**
 * D114 MD-I4: the advisories the *project driver* raises over the module graph
 * rather than `compile()` over one module. A module compile can neither produce
 * one nor prove that one did not fire, so a `velar-allow` naming one leaves the
 * compile unresolved instead of being reported stale, and the driver that owns
 * the graph applies it. This is the whole of what makes `A18` different from
 * every other id in the roster above.
 */
export const PROJECT_GRAPH_ADVISORY_CODES: ReadonlySet<string> = new Set(["A18"]);
