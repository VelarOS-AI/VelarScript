/**
 * The A roster: the advisory proofs that report a Python/JavaScript reflex or a
 * longer spelling of a compiler-owned canonical form. AGENTS.md's table names
 * each one; the proof for each lives in `advisories/`.
 *
 * D114 R1a: these were 20 private methods on `Analyzer`, interleaved with the
 * inference they run beside. They are one cohesive thing — the roster reports
 * and never decides — so they live in one collaborator the analyzer owns as
 * `this.advisoryRoster`. What each proof needs back from the analyzer is
 * declared in `advisories/roster.ts` as `AdvisoryHost`: that interface is the
 * exact record of this roster's dependency on the analyzer, and nothing widens
 * it silently.
 *
 * D114 R1f: A8 arrived from `analyzer.ts` and this module passed the 800-line
 * budget, so each family of proofs became its own file — the reflex traps
 * (A2/A3), the collection canonicalizations (A7/A13), the record projections
 * (A9/A10/A15), the tuple-shaped List literal (A17) and the List queries (A8) —
 * and this module is the facade that composes them. Every name it published
 * before is still published here, so an existing
 * `from "./analysis/advisories.ts"` import is unchanged.
 *
 * The sink stays with the analyzer. `advise` deduplicates by code and span
 * (loop back-edge re-analysis runs a body twice), `advisedIdentities` is its
 * cursor, and `advisories` is the array `analyzedAdvisories()` publishes — all
 * three are the analyzer's, and this roster reaches them only through
 * `AdvisoryHost.advise`.
 */
import { type Expression, type ForStatement, type Statement } from "../ast.ts";
import { type Span } from "../source.ts";
import { type ValueType } from "../types.ts";
import { CollectionAdvisories } from "./advisories/collections.ts";
import { QueryAdvisories } from "./advisories/queries.ts";
import { RecordAdvisories } from "./advisories/records.ts";
import { type AdvisoryHost } from "./advisories/roster.ts";
import { AdvisoryTraps } from "./advisories/traps.ts";
import { TupleAdvisories } from "./advisories/tuples.ts";

export {
  canonicalCollectionMemberReadIsStable,
  singularIterableName,
  type AdvisoryBinding,
  type AdvisoryHost,
  type AdvisoryLoweringFacts,
  type AdvisoryRecordShape,
  type CanonicalCollectionProjectionExtension,
} from "./advisories/roster.ts";

/**
 * The roster as the analyzer sees it: one object with one method per advisory,
 * each forwarding to the family that owns the proof.
 */
export class Advisories {
  private readonly collections: CollectionAdvisories;
  private readonly queries: QueryAdvisories;
  private readonly records: RecordAdvisories;
  private readonly traps: AdvisoryTraps;
  private readonly tuples: TupleAdvisories;

  constructor(host: AdvisoryHost) {
    this.collections = new CollectionAdvisories(host);
    this.queries = new QueryAdvisories(host);
    this.records = new RecordAdvisories(host);
    this.traps = new AdvisoryTraps(host);
    this.tuples = new TupleAdvisories(host);
  }

  adviseSwappedLoopSlots(statement: ForStatement, iterable: ValueType): void {
    this.traps.adviseSwappedLoopSlots(statement, iterable);
  }

  adviseNegativeLiteralModulo(leftExpression: Expression, rightExpression: Expression, operationSpan: Span): void {
    this.traps.adviseNegativeLiteralModulo(leftExpression, rightExpression, operationSpan);
  }

  adviseManualCollectionConversion(previous: Statement | null, statement: Statement): void {
    this.collections.adviseManualCollectionConversion(previous, statement);
  }

  adviseManualListPipeline(previous: Statement | null, statement: Statement): void {
    this.collections.adviseManualListPipeline(previous, statement);
  }

  adviseManualListQuery(previous: Statement | null, statement: Statement): void {
    this.queries.adviseManualListQuery(previous, statement);
  }

  adviseManualRecordProjection(
    expression: Extract<Expression, { kind: "ObjectExpression" }>,
    target: ValueType | null,
    writtenTarget: ValueType,
  ): void {
    this.records.adviseManualRecordProjection(expression, target, writtenTarget);
  }

  adviseManualMappedRecordProjection(
    expression: Extract<Expression, { kind: "ObjectExpression" }>,
    target: ValueType | null,
    writtenTarget: ValueType,
  ): void {
    this.records.adviseManualMappedRecordProjection(expression, target, writtenTarget);
  }

  adviseRedundantObjectProperty(
    property: Extract<Expression, { kind: "ObjectExpression" }>["properties"][number] & { kind: "ObjectProperty" },
  ): void {
    this.records.adviseRedundantObjectProperty(property);
  }

  adviseTupleShapedListLiteral(
    expression: Extract<Expression, { kind: "ListExpression" }>,
    contextualType: ValueType,
    writtenElementTypes: readonly ValueType[],
    element: ValueType,
  ): void {
    this.tuples.adviseTupleShapedListLiteral(expression, contextualType, writtenElementTypes, element);
  }
}
