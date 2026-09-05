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
