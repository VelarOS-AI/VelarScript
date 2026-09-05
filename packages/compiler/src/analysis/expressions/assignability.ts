/**
 * `requireAssignable`: whether a value may stand where a contract is expected,
 * and the first-class generic bound check that runs with it.
 *
 * D115 §三: this was `requireAssignable` and the four methods that instantiate
 * a generic callable for it. The judgement itself is `isAssignable` in
 * `../../types.ts`; what lives here is the *reporting* — which of the guidance
 * sentences a refusal is finished with, and the bound violation reported once
 * per call site rather than once per read.
 */
import { type Diagnostic, type DiagnosticFix, diagnostic } from "../../diagnostic.ts";
import { type Span, spanIdentity } from "../../source.ts";
import {
  type GenericBoundViolation,
  type ValueType,
  describeType,
  isInvalidType,
} from "../../types.ts";
import { boundVocabularyGuidance } from "../calls/generic-calls.ts";
import { type MutableCellTarget } from "../scopes.ts";

// The human-readable origin of a nominal contract, recovered from its
// identity: extern classes name their JavaScript source and Velar nominals
// name their declaring module. Structural types have no origin.
function contractOrigin(type: ValueType): string | null {
  const identity = type.kind === "class" || type.kind === "classConstructor" || type.kind === "named" || type.kind === "enum" || type.kind === "enumMember" || type.kind === "enumObject"
    ? type.identity
    : undefined;
  if (!identity) return null;
  const separator = identity.lastIndexOf("#");
  if (separator < 0) return null;
  if (identity.startsWith("js:")) return `the extern class from "${identity.slice(3, separator)}"`;
  if (identity.startsWith("velar:")) return `declared in ${identity.slice(6, separator)}`;
  return null;
}

/** What assignability asks of the analyzer that hosts it, and nothing more. */
export interface AssignabilityHost {
  asyncResultSpellingGuidance(actual: ValueType, expectedCore: ValueType): string | null;
  boundMethodRecordGuidance(actual: ValueType, expected: ValueType, valueSpan: Span): string | null;
  collectionBridgeGuidance(actual: ValueType, expectedCore: ValueType): string | null;
  contextuallyAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): boolean;
  readonly diagnostics: Diagnostic[];
  enumSingletonCellGuidance(actual: ValueType, expected: ValueType, target: MutableCellTarget | null): string | null;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  instantiateGenericCallableHere(actual: Extract<ValueType, { readonly kind: "function" | "action" | "intrinsic" }>, expected: Extract<ValueType, { readonly kind: "function" | "action" | "intrinsic" }>, violations?: GenericBoundViolation[]): Extract<ValueType, { readonly kind: "function" | "action" | "intrinsic" }>;
  noteGenericApplications(type: ValueType, seen?: Set<string>): void;
  readonlyProjectionGuidance(actual: ValueType, expected: ValueType, expandedExpected: ValueType, expectedCore: ValueType): string | null;
  readonly reportedBoundViolations: Set<string>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

export class Assignability {
  private readonly host: AssignabilityHost;

  constructor(host: AssignabilityHost) {
    this.host = host;
  }

  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span, mutableCell: MutableCellTarget | null = null): void {
    if (this.host.contextuallyAssignable(actual, expected, valueSpan)) return;
    const expandedActual = this.host.expandAliases(actual);
    const expandedExpected = this.host.expandAliases(expected);
    const expectedCore = expandedExpected.kind === "optional" ? this.host.expandAliases(expandedExpected.inner) : expandedExpected;
    // COL-I5: a named record type is open — a User value may carry fields
    // beyond its declaration (validation admits extras), so it cannot flow
    // into Record<T> wholesale; the spread spelling is rejected for the same
    // reason (COL-D2).
    if (expandedActual.kind === "named" && expectedCore.kind === "record"
      && this.host.fieldsOf(expandedActual.identity ?? expandedActual.name)) {
      const fields = [...this.host.fieldsOf(expandedActual.identity ?? expandedActual.name)!.keys()];
      const example = fields.slice(0, 2).map((field) => `${field}: value.${field}`).join(", ") + (fields.length > 2 ? ", ..." : "");
      this.host.typeError(
        `Cannot assign ${describeType(actual)} to ${describeType(expected)}: a named record is open, so a ${describeType(actual)} value may carry fields beyond its declaration; copy the declared fields explicitly — {${example}}`,
        valueSpan,
      );
      return;
    }
    if (expandedActual.kind === "object" && expectedCore.kind === "map") {
      this.host.typeError(expandedActual.fields.size === 0
        ? "Use 'Map()' to create an empty Map; a record literal '{}' builds a record, not a Map"
        : "Use 'Map({...})' to convert record fields into string-keyed entries; a record literal '{...}' builds a record, not a Map", valueSpan);
      return;
    }
    // D41 item 61: a bounded generic used as a first-class value fails
    // assignability for one specific reason worth naming.
    if (this.reportFirstClassBoundViolation(expandedActual, expectedCore, valueSpan)) return;
    const actualDescription = describeType(actual);
    const expectedDescription = describeType(expected);
    if (actualDescription !== expectedDescription) {
      // The mutable cell that inferred a member singleton: the fix is on a
      // different line from the report, so the report carries it.
      const singletonCell = this.host.enumSingletonCellGuidance(
        expandedActual.kind === "optional" ? this.host.expandAliases(expandedActual.inner) : expandedActual,
        expectedCore,
        mutableCell,
      );
      if (singletonCell !== null) {
        this.host.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}; ${singletonCell}`, valueSpan);
        return;
      }
      // A readonly projection is refused for one reason and has one fix, and
      // the fix is a signature the author has to write somewhere else. Naming
      // the mismatch without naming that signature is what made component
      // props cost two rounds of rework in a blind test.
      const projection = this.host.readonlyProjectionGuidance(expandedActual, expected, expandedExpected, expectedCore);
      if (projection !== null) {
        this.host.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}; ${projection}`, valueSpan);
        return;
      }
      // D64 rule 163: the one mismatch an author reaches by obeying VEL4018.
      const asyncResult = this.host.asyncResultSpellingGuidance(expandedActual, expectedCore);
      if (asyncResult !== null) {
        this.host.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}; ${asyncResult}`, valueSpan);
        return;
      }
      // D90 R17: an undeclared foreign value is unknown until validated, so
      // the mismatch teaches the entry ritual instead of restating the kinds.
      if (expandedActual.kind === "unknown" && !isInvalidType(expandedActual)) {
        const named = expectedCore.kind === "named" || expectedCore.kind === "enum"
          ? `'const checked = ${describeType(expectedCore)}.parse(value)'`
          : expectedCore.kind === "string" || expectedCore.kind === "number" || expectedCore.kind === "bool"
            ? `narrow it with 'value is ${describeType(expectedCore)}', or parse a declared shape`
            : "declare a type naming the shape you rely on and call 'Type.parse' on the value";
        this.host.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}; a boundary value stays unknown until validated at the edge — ${named}`, valueSpan);
        return;
      }
      // D114 S7: section 12 rules that a class instance never satisfies a
      // record contract, and section 10 rules that behavior passes as function
      // values. The idiom the two imply — a record of bound methods — was
      // written nowhere, so the refusal an author actually meets is where it
      // is taught.
      const boundMethods = this.host.boundMethodRecordGuidance(expandedActual, expectedCore, valueSpan);
      if (boundMethods !== null) {
        this.host.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}; ${boundMethods}`, valueSpan);
        return;
      }
      // COL-U10: a value of one collection family in another family's
      // position gets the bridge spelling, not a bare mismatch.
      const bridge = this.host.collectionBridgeGuidance(expandedActual, expectedCore);
      this.host.typeError(`Cannot assign ${actualDescription} to ${expectedDescription}${bridge ? `; ${bridge}` : ""}`, valueSpan);
      return;
    }
    // Same-named contracts read identically, so name the declaring sources
    // when the identities show where each contract actually comes from.
    const actualCore = expandedActual.kind === "optional" ? this.host.expandAliases(expandedActual.inner) : expandedActual;
    const actualOrigin = contractOrigin(actualCore);
    const expectedOrigin = contractOrigin(expectedCore);
    const origins = actualOrigin !== expectedOrigin && (actualOrigin !== null || expectedOrigin !== null)
      ? ` (the value is ${actualOrigin ?? "a structural type"} and the target is ${expectedOrigin ?? "a structural type"})`
      : "";
    this.host.typeError(`Cannot assign ${actualDescription} to a different ${expectedDescription} contract${origins}`, valueSpan);
  }

  /**
   * D41 item 61 check site 2: a generic callable used as a value is solved and
   * erased silently, so the wrapper re-asks the bound question and turns the
   * rejection into a directed message at the value's own span.
   */
  private instantiateCallable<T extends Extract<ValueType, { kind: "function" | "action" | "intrinsic" }>>(actual: T, expected: T, violations?: GenericBoundViolation[]): T {
    const instantiated = this.host.instantiateGenericCallableHere(actual, expected, violations) as T;
    this.host.noteGenericApplications(instantiated);
    return instantiated;
  }

  private genericBoundViolation(actual: ValueType, expected: ValueType): GenericBoundViolation | null {
    if (actual.kind !== "function" && actual.kind !== "action" && actual.kind !== "intrinsic") return null;
    if (!actual.typeParameterBounds?.some((bound) => bound !== null)) return null;
    if (expected.kind !== "function" && expected.kind !== "action" && expected.kind !== "intrinsic") return null;
    if (expected.typeParameterNames?.length) return null;
    const violations: GenericBoundViolation[] = [];
    this.instantiateCallable(actual, expected, violations);
    return violations[0] ?? null;
  }

  // A generic callable used where a concrete callback is expected must not
  // leak its parameter kinds into surrounding inference; instantiate it
  // against the expected shape before reading its result.
  concreteCallableFor(actual: ValueType, expected: ValueType, errorSpan?: Span): ValueType {
    if (actual.kind !== "function" && actual.kind !== "action" && actual.kind !== "intrinsic") return actual;
    if (!actual.typeParameterNames?.length) return actual;
    if (expected.kind !== "function" && expected.kind !== "action" && expected.kind !== "intrinsic") return actual;
    // The erasure happens here, so this is the last place a rejected bound is
    // still visible; without the report the callback would silently compile.
    if (errorSpan) this.reportFirstClassBoundViolation(actual, expected, errorSpan);
    return this.instantiateCallable(actual, expected);
  }

  /** One diagnostic per site, whichever of the two value paths reaches it first. */
  private reportFirstClassBoundViolation(actual: ValueType, expected: ValueType, errorSpan: Span): boolean {
    const violation = this.genericBoundViolation(actual, expected);
    if (!violation) return false;
    const site = spanIdentity(errorSpan);
    if (this.host.reportedBoundViolations.has(site)) return true;
    this.host.reportedBoundViolations.add(site);
    this.host.diagnostics.push(diagnostic(
      "VEL4031",
      `Type parameter '${violation.name}' is bound by ${violation.bound}, but this ${describeType(expected)} contract solves it to ${describeType(violation.solved)}; ${boundVocabularyGuidance[violation.bound]}`,
      errorSpan,
    ));
    return true;
  }
}
