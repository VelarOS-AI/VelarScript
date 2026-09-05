/**
 * `match`: what one arm's pattern proves, what it covers, and whether the arms
 * together cover the subject's whole domain.
 *
 * D114 R1d: `match` is the language's largest single construct — the statement
 * handler, the per-arm pass, the pattern walk, the coverage ledger, and the
 * exhaustiveness report came to roughly seven hundred lines inside `analyzer.ts`.
 * They answer one question and live in one collaborator the analyzer owns as
 * `this.matching`. The block-exit predicates (`blockAlwaysReturns` and its two
 * siblings) travel with them: their only readers are the arms, which need to
 * know whether an arm's facts reach the code after the match.
 */
import { type Expression, type MatchPattern, type Statement, type TypeReference } from "../ast.ts";
import { type ClassInfo } from "../contracts.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../diagnostic.ts";
import { spanIdentity, type Span } from "../source.ts";
import {
  anyType,
  describeType,
  invalidType,
  isInvalidType,
  isReadonlyView,
  mutableViewOf,
  nullType,
  sameType,
  typeContainsParameter,
  unionOf,
  unknownType,
  type EnumInfo,
  type ValueType,
} from "../types.ts";
import { type FlowFacts, type FlowFactInvalidations, type FlowFactsSnapshot } from "./flow/facts.ts";
import { type FlowMerge } from "./flow/merge.ts";
import { type Narrowing } from "./flow/narrowing.ts";
import { type LoweringRecorder } from "./lowering-recorder.ts";
import { type MatchCoverageRules } from "./match-coverage.ts";
import { type Binding, type BuiltinTypeNamePosition } from "./scopes.ts";

/** What a `match` has proved covered so far, carried from one branch to the next. */
export interface MatchCoverage {
  readonly continuingInvalidations: FlowFactInvalidations[];
  readonly continuingFacts: ReadonlyMap<string, ValueType>[];
  readonly fallthroughInvalidations: FlowFactInvalidations[];
  readonly coveredValues: Set<string>;
  readonly coveredEnumMembers: Set<string>;
  readonly guardedEnumMembers: Set<string>;
  readonly coveredTypes: ValueType[];
  readonly coveredListLengths: Set<number>;
  coveredListMinimum: number | null;
  universalCovered: boolean;
  fallthroughType: ValueType;
  fallthroughNarrowings: ReadonlyMap<string, ValueType>;
}

/** Everything the match cluster asks of the analyzer that hosts it. */
export interface MatchAnalysisHost {
  readonly coverage: MatchCoverageRules;
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  allowBareGenericClassName(reference: TypeReference): void;
  analyzeStatements(statements: readonly Statement[]): void;
  applyNarrowings(narrowed: ReadonlyMap<string, ValueType>, narrowingSpan: Span): void;
  readonly classes: Map<string, ClassInfo>;
  declareBinding(name: string, mutable: boolean, type: ValueType, declarationSpan: Span, internal?: boolean, declaredType?: ValueType, importSource?: string, typeNamePosition?: BuiltinTypeNamePosition): void;
  readonly diagnostics: Diagnostic[];
  enterScope(): void;
  readonly enums: Map<string, EnumInfo>;
  equalityMayCompareNaN(type: ValueType): boolean;
  equalityOperandMayBeNaN(expression: Expression, type: ValueType): boolean;
  erasedClassCheckType(source: ValueType, checked: ValueType): ValueType;
  exitScope(): void;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  readonly flowFacts: FlowFacts;
  readonly flowMerge: FlowMerge;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  readonly inferredExpressionTypes: Map<string, ValueType>;
  lookup(name: string): Binding | null;
  readonly lowering: LoweringRecorder;
  readonly namedTypes: Map<string, ReadonlyMap<string, ValueType>>;
  readonly narrowing: Narrowing;
  readonly primitiveNames: Set<string>;
  readonlyDataViewOf(type: ValueType): ValueType;
  rejectErasedRuntimeCheck(checked: ValueType, errorSpan: Span): boolean;
  resolveAnnotation(reference: TypeReference | null): ValueType;
  readonly semanticBindingEntryOwners: Map<string, ValueType>;
  readonly typeAliases: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  validateTypeReference(reference: TypeReference, resolve?: (reference: TypeReference) => ValueType): boolean;
}

export class MatchAnalysis {
  private readonly host: MatchAnalysisHost;

  constructor(host: MatchAnalysisHost) {
    this.host = host;
  }

  analyzeMatchStatement(statement: Extract<Statement, { kind: "MatchStatement" }>): void {
    const matched = this.host.inferExpression(statement.value);
    if (matched.kind === "unknown" && !isInvalidType(matched)) {
      this.host.typeError("Validate an unknown value before matching it", statement.value.span);
    }
    const flowBaseline = this.host.flowFacts.snapshotFlowFacts();
    const visibleAtMatch = this.host.flowMerge.visibleBindings();
    const coverage: MatchCoverage = {
      continuingInvalidations: [], continuingFacts: [], fallthroughInvalidations: [],
      coveredValues: new Set(), coveredEnumMembers: new Set(), guardedEnumMembers: new Set(),
      coveredTypes: [], coveredListLengths: new Set(), coveredListMinimum: null,
      universalCovered: false, fallthroughType: matched,
      fallthroughNarrowings: this.matchLocationNarrowing(statement.value, matched),
    };
    for (const branch of statement.cases) this.analyzeMatchBranch(statement, branch, matched, flowBaseline, visibleAtMatch, coverage);
    this.reportMatchCoverage(statement, matched, flowBaseline, visibleAtMatch, coverage);
  }

  /** One `case` arm: what its pattern proves, what its guard adds, and what its body leaves. */
  analyzeMatchBranch(
    statement: Extract<Statement, { kind: "MatchStatement" }>,
    branch: Extract<Statement, { kind: "MatchStatement" }>["cases"][number],
    matched: ValueType,
    flowBaseline: FlowFactsSnapshot,
    visibleAtMatch: number,
    coverage: MatchCoverage,
  ): void {
    const { branchReachable, bindings, patternNarrowings, patternSurviving, rootPattern } =
      this.creditMatchPatternCoverage(statement, branch, matched, flowBaseline, coverage);
    let guardNarrowings: ReadonlyMap<string, ValueType> = new Map();
    let guardFallthroughNarrowings: ReadonlyMap<string, ValueType> = patternSurviving;
    if (branch.guard) {
      const patternAlwaysMatches = this.host.coverage.matchPatternCoversWholeType(rootPattern, coverage.fallthroughType);
      const guardBaseline = this.host.flowFacts.flowSnapshotAfterInvalidations(flowBaseline, coverage.fallthroughInvalidations);
      const guardInvalidations = this.host.flowFacts.analyzeIsolatedFlow(guardBaseline, () => {
        this.host.enterScope();
        try {
          for (const [name, binding] of bindings) {
            this.host.declareBinding(name, false, binding.type, binding.span);
          }
          const guard = this.host.narrowing.inferConditionWithNarrowings(branch.guard!, patternNarrowings);
          guardNarrowings = this.host.narrowing.combineNarrowings(guard.surviving, guard.truthy);
          const surviving = this.retargetNarrowings(guard.surviving, coverage.fallthroughType);
          guardFallthroughNarrowings = patternAlwaysMatches
            ? this.host.narrowing.combineNarrowings(surviving, guard.falsy)
            : surviving;
        } finally {
          this.host.exitScope();
        }
      });
      if (branchReachable) coverage.fallthroughInvalidations.push(guardInvalidations);
    }

    const bodyBaseline = this.host.flowFacts.flowSnapshotAfterInvalidations(flowBaseline, coverage.fallthroughInvalidations);
    let branchFacts: ReadonlyMap<string, ValueType> = new Map();
    const branchInvalidations = this.host.flowFacts.analyzeIsolatedFlow(bodyBaseline, () => {
      this.host.enterScope();
      try {
        for (const [name, binding] of bindings) {
          this.host.declareBinding(name, false, binding.type, binding.span);
        }
        this.host.applyNarrowings(branch.guard ? guardNarrowings : patternNarrowings, branch.body[0]?.span ?? branch.span);
        this.host.analyzeStatements(branch.body);
        branchFacts = this.host.flowMerge.narrowingsForVisibleBindings(visibleAtMatch);
      } finally {
        this.host.exitScope();
      }
    });
    if (branchReachable && !this.host.coverage.blockAlwaysExits(branch.body)) {
      coverage.continuingInvalidations.push(...coverage.fallthroughInvalidations, branchInvalidations);
      coverage.continuingFacts.push(branchFacts);
    }
    if (branchReachable) {
      if (branch.guard) {
        coverage.fallthroughNarrowings = guardFallthroughNarrowings;
      } else {
        coverage.fallthroughType = this.matchFallthroughType(coverage.fallthroughType, rootPattern);
        coverage.fallthroughNarrowings = this.host.narrowing.combineNarrowings(
          patternSurviving,
          this.matchLocationNarrowing(statement.value, coverage.fallthroughType),
        );
      }
    }
  }

  /** The pattern half of one arm: its bindings, its narrowings, and what it adds to the coverage. */
  creditMatchPatternCoverage(
    statement: Extract<Statement, { kind: "MatchStatement" }>,
    branch: Extract<Statement, { kind: "MatchStatement" }>["cases"][number],
    matched: ValueType,
    flowBaseline: FlowFactsSnapshot,
    coverage: MatchCoverage,
  ): {
    readonly branchReachable: boolean;
    readonly bindings: ReadonlyMap<string, { readonly type: ValueType; readonly span: Span }>;
    readonly patternNarrowings: ReadonlyMap<string, ValueType>;
    readonly patternSurviving: ReadonlyMap<string, ValueType>;
    readonly rootPattern: MatchPattern;
  } {
    const branchReachable = !coverage.universalCovered;
    if (!branchReachable) {
      this.host.diagnostics.push(diagnostic("VEL4014", "This match branch is already covered", branch.pattern.span));
    }
    const bindings = new Map<string, { readonly type: ValueType; readonly span: Span }>();
    let patternNarrowings: ReadonlyMap<string, ValueType> = new Map();
    let patternSurviving: ReadonlyMap<string, ValueType> = new Map();
    // `invalidType` is the one answer a refused pattern gives back; the
    // refusal itself is already reported where it was decided.
    let patternRefused = false;
    const patternBaseline = this.host.flowFacts.flowSnapshotAfterInvalidations(flowBaseline, coverage.fallthroughInvalidations);
    const patternInvalidations = this.host.flowFacts.analyzeIsolatedFlow(patternBaseline, () => {
      this.host.enterScope();
      try {
        this.host.applyNarrowings(coverage.fallthroughNarrowings, branch.pattern.span);
        const narrowedMatch = this.analyzeMatchPattern(branch.pattern, coverage.fallthroughType, bindings);
        patternRefused = narrowedMatch === invalidType;
        patternSurviving = this.host.flowMerge.survivingNarrowings(coverage.fallthroughNarrowings);
        patternNarrowings = this.host.narrowing.combineNarrowings(
          patternSurviving,
          this.matchLocationNarrowing(statement.value, narrowedMatch),
        );
      } finally {
        this.host.exitScope();
      }
    });
    if (branchReachable) coverage.fallthroughInvalidations.push(patternInvalidations);
    const rootPattern = this.unwrapMatchAs(branch.pattern);
    // D114: a refused pattern counts for nothing. `case Shape<number>:` earns
    // VEL4022 because type arguments are erased, and crediting it as coverage
    // anyway made the following `case _:` look redundant — one mistake, two
    // reports. It does not satisfy the subject either, so a match that has no
    // other fallback still asks for the bare `case Shape:` the refusal names.
    if (patternRefused) return { branchReachable, bindings, patternNarrowings, patternSurviving, rootPattern };
    if (rootPattern.kind === "MatchValuePattern") {
      for (const value of rootPattern.values) {
        const key = this.host.coverage.matchValueKey(value);
        if (!branch.guard && coverage.coveredValues.has(key)) {
          this.host.diagnostics.push(diagnostic("VEL4013", `Match value '${this.host.coverage.matchValueDisplay(value)}' is declared more than once`, value.span));
        }
        if (!branch.guard) coverage.coveredValues.add(key);
        const valueType = this.host.inferredExpressionTypes.get(spanIdentity(value.span));
        if (!branch.guard && valueType?.kind === "enumMember") {
          coverage.coveredEnumMembers.add(this.host.coverage.enumMemberCoverageKey(valueType.identity, valueType.member));
        }
        if (branch.guard && valueType?.kind === "enumMember") {
          coverage.guardedEnumMembers.add(this.host.coverage.enumMemberCoverageKey(valueType.identity, valueType.member));
        }
      }
    } else if (rootPattern.kind === "MatchTypePattern") {
      const checked = this.host.resolveAnnotation(rootPattern.type);
      if (!branch.guard && !typeContainsParameter(checked) && !this.host.coverage.runtimeTypeCheckMayExecute(coverage.fallthroughType, checked)) {
        if (coverage.coveredTypes.some((covered) => this.host.isAssignableHere(checked, covered))) {
          this.host.diagnostics.push(diagnostic("VEL4014", `Type pattern ${describeType(checked)} is already covered`, rootPattern.span));
        }
        coverage.coveredTypes.push(checked);
        // ENM-I5: a parenthesized singleton pattern `case (S.a):` is a
        // type pattern of enumMember kind; it matches exactly that
        // member, so it counts toward member coverage.
        this.host.coverage.creditEnumMemberCoverage(checked, coverage.coveredEnumMembers);
        if (this.host.coverage.matchPatternCoversWholeType(rootPattern, matched)) coverage.universalCovered = true;
      }
    } else if (rootPattern.kind === "MatchWildcardPattern" && !branch.guard) {
      coverage.universalCovered = true;
    } else if (rootPattern.kind === "MatchListPattern" && !branch.guard
      && rootPattern.elements.every((element) => this.host.coverage.matchPatternIsIrrefutable(element))
      && !this.host.narrowing.matchPatternReflectionMayExecute(rootPattern, coverage.fallthroughType)) {
      if (rootPattern.rest) {
        coverage.coveredListMinimum = coverage.coveredListMinimum === null
          ? rootPattern.elements.length
          : Math.min(coverage.coveredListMinimum, rootPattern.elements.length);
      } else {
        coverage.coveredListLengths.add(rootPattern.elements.length);
      }
    } else if (rootPattern.kind === "MatchObjectPattern" && !branch.guard) {
      for (const candidate of this.host.coverage.matchObjectCandidates(matched)) {
        if (candidate.kind !== "any" && this.host.coverage.matchPatternCoversType(rootPattern, candidate)
          && !coverage.coveredTypes.some((covered) => sameType(covered, candidate))) {
          coverage.coveredTypes.push(candidate);
        }
      }
    }
    if (!branch.guard && !coverage.universalCovered && this.host.coverage.matchTypeFullyCovered(
      matched,
      coverage.coveredTypes,
      coverage.coveredValues,
      coverage.coveredEnumMembers,
      coverage.coveredListLengths,
      coverage.coveredListMinimum,
    )) {
      coverage.universalCovered = true;
    }
    return { branchReachable, bindings, patternNarrowings, patternSurviving, rootPattern };
  }

  /** After every arm: whether the match is exhaustive, and what survives it. */
  reportMatchCoverage(
    statement: Extract<Statement, { kind: "MatchStatement" }>,
    matched: ValueType,
    flowBaseline: FlowFactsSnapshot,
    visibleAtMatch: number,
    coverage: MatchCoverage,
  ): void {
    const exhaustive = coverage.universalCovered || this.host.coverage.matchTypeFullyCovered(
      matched,
      coverage.coveredTypes,
      coverage.coveredValues,
      coverage.coveredEnumMembers,
      coverage.coveredListLengths,
      coverage.coveredListMinimum,
    );
    const enumSubject = this.host.coverage.enumMatchSubject(matched);
    if (exhaustive) {
      this.host.lowering.exhaustiveMatches.add(statement.span.start);
    } else if (enumSubject !== null) {
      // ENM-I6: an optional enum subject carries the same exhaustiveness
      // contract as the bare enum — every member plus `case null`.
      const target = enumSubject.target;
      const missing = [...(this.host.enums.get(target.identity)?.members ?? this.host.enums.get(target.name)?.members ?? [])]
        .filter((member) => !coverage.coveredEnumMembers.has(this.host.coverage.enumMemberCoverageKey(target.identity, member)));
      const guarded = missing.filter((member) => coverage.guardedEnumMembers.has(this.host.coverage.enumMemberCoverageKey(target.identity, member)));
      if (enumSubject.optional && !coverage.coveredValues.has("null")) missing.push("null");
      if (missing.length > 0) {
        const note = guarded.length > 0
          ? "; a guarded case matches only when its condition holds, so it does not count — add an unguarded case or 'case _:'"
          : "";
        this.host.diagnostics.push(diagnostic("VEL4015", `Match on ${describeType(matched)} is missing: ${missing.join(", ")}${note}`, statement.span));
      }
    } else if (!isInvalidType(matched)) {
      // D45 rule 77: a match over a class (or a union containing one) must
      // be provably exhaustive, exactly as strict as the enum rule. A
      // subclass instance still satisfies its base pattern, so a base (or
      // wildcard) tail proves it; an extern class check may fail at
      // runtime, so only the wildcard proves an extern subject.
      const expandedSubject = this.host.expandAliases(matched);
      const classArms = this.host.coverage.classArmsOf(expandedSubject);
      if (classArms.length > 0) {
        this.host.diagnostics.push(diagnostic(
          "VEL4015",
          `Match on ${describeType(matched)} is missing a fallback; class hierarchies are open — ${this.host.coverage.classFallbackAdvice(expandedSubject)}`,
          statement.span,
        ));
      }
    }
    if (!exhaustive) {
      const unmatched = this.host.flowFacts.flowSnapshotAfterInvalidations(flowBaseline, coverage.fallthroughInvalidations);
      coverage.continuingInvalidations.push(...coverage.fallthroughInvalidations);
      coverage.continuingFacts.push(this.host.narrowing.combineNarrowings(
        this.host.flowMerge.narrowingsInSnapshot(unmatched, visibleAtMatch, flowBaseline),
        coverage.fallthroughNarrowings,
      ));
    }
    this.host.flowFacts.restoreFlowFacts(flowBaseline);
    this.host.flowMerge.applyFlowInvalidations(coverage.continuingInvalidations);
    if (coverage.continuingFacts.length > 0) {
      this.host.narrowing.persistNarrowings(this.host.flowMerge.commonNarrowings(coverage.continuingFacts));
    }
  }

  analyzeMatchPattern(
    pattern: MatchPattern,
    input: ValueType,
    bindings: Map<string, { readonly type: ValueType; readonly span: Span }>,
  ): ValueType {
    switch (pattern.kind) {
      case "MatchAsPattern": {
        const narrowed = this.analyzeMatchPattern(pattern.pattern, input, bindings);
        this.addMatchBinding(bindings, pattern.binding.name, narrowed, pattern.binding.span);
        return narrowed;
      }
      case "MatchWildcardPattern":
        return input;
      case "MatchCapturePattern":
        this.addMatchBinding(bindings, pattern.binding.name, input, pattern.binding.span);
        return input;
      case "MatchValuePattern": {
        const values: ValueType[] = [];
        for (const value of pattern.values) {
          const literal = this.host.inferExpression(value);
          values.push(literal);
          if (input.kind !== "unknown" && !this.host.coverage.matchLiteralCompatible(this.host.expandAliases(input), literal)) {
            this.host.typeError(`Cannot match ${describeType(input)} against ${describeType(literal)}`, value.span);
          }
          // ENM-D2: when the subject and this candidate can both be NaN, the
          // branch test lowers to SameValueZero so it agrees with `==`
          // (charter section 8). A literal candidate can never be NaN, so
          // ordinary matches keep plain `===`.
          if (this.host.equalityMayCompareNaN(input) && this.host.equalityOperandMayBeNaN(value, literal)) {
            this.host.lowering.sameValueZeroMatchValues.add(spanIdentity(value.span));
          }
        }
        return values.length > 0 ? unionOf(values) : unknownType;
      }
      case "MatchTypePattern":
        return this.analyzeMatchTypePattern(pattern, input, bindings);
      case "MatchListPattern": {
        const candidates = this.host.coverage.matchListCandidates(input);
        if (candidates.length === 0) {
          this.host.typeError(`A List pattern can never match ${describeType(input)}`, pattern.span);
        }
        const elementTypes = candidates.map((candidate) => candidate.kind === "list"
          ? candidate.readonlyView ? this.host.readonlyDataViewOf(candidate.element) : candidate.element
          : anyType);
        const element = elementTypes.length > 0 ? unionOf(elementTypes) : unknownType;
        for (const child of pattern.elements) this.analyzeMatchPattern(child, element, bindings);
        if (pattern.rest) {
          this.addMatchBinding(bindings, pattern.rest.name, { kind: "list", element }, pattern.rest.span);
        }
        return candidates.length > 0 ? unionOf(candidates) : unknownType;
      }
      case "MatchObjectPattern": {
        const candidates = this.host.coverage.matchObjectCandidates(input);
        if (candidates.length === 0) {
          this.host.typeError(`An object pattern can never match ${describeType(input)}`, pattern.span);
        }
        const seen = new Set<string>();
        const eligible = candidates.filter((candidate) => candidate.kind === "any"
          || pattern.entries.every((entry) => {
            const field = this.host.coverage.matchObjectField(candidate, entry.property);
            return field !== null && this.host.coverage.matchPatternMayMatchType(entry.pattern, field);
          }));
        if (candidates.length > 0 && eligible.length === 0) {
          this.host.typeError(`Object pattern fields cannot occur together on ${describeType(input)}`, pattern.span);
        }
        for (const entry of pattern.entries) {
          if (seen.has(entry.property)) {
            this.host.diagnostics.push(diagnostic("VEL4019", `Object pattern field '${entry.property}' is declared more than once`, entry.span));
          }
          seen.add(entry.property);
          const fieldCandidates = eligible
            .map((candidate) => this.host.coverage.matchObjectField(candidate, entry.property))
            .filter((field): field is ValueType => field !== null);
          if (fieldCandidates.length === 0 && candidates.length > 0
            && !candidates.some((candidate) => this.host.coverage.matchObjectField(candidate, entry.property) !== null)) {
            this.host.typeError(`Object pattern field '${entry.property}' does not exist on ${describeType(input)}`, entry.span);
          }
          const owners = eligible.filter((candidate): candidate is Extract<ValueType, { kind: "named" }> => candidate.kind === "named"
            && this.host.coverage.matchObjectField(candidate, entry.property) !== null);
          if (owners.length === 1) {
            this.host.semanticBindingEntryOwners.set(`${entry.span.start}:${entry.property}`, owners[0]!);
          }
          this.analyzeMatchPattern(
            entry.pattern,
            fieldCandidates.length > 0 ? unionOf(fieldCandidates) : unknownType,
            bindings,
          );
        }
        if (pattern.rest) {
          this.addMatchBinding(bindings, pattern.rest.name, this.host.coverage.matchObjectRestType(eligible, seen), pattern.rest.span);
        }
        return eligible.length > 0 ? unionOf(eligible) : unknownType;
      }
    }
  }

  /** `case Type:` — the erased-check refusals, the narrowed subject, and the capture it may bind. */
  private analyzeMatchTypePattern(
    pattern: Extract<MatchPattern, { kind: "MatchTypePattern" }>,
    input: ValueType,
    bindings: Map<string, { readonly type: ValueType; readonly span: Span }>,
  ): ValueType {
      // ENM-U2's other half: a bare identifier is never a value pattern —
      // dotted paths are values, bare names are types — so a name that
      // resolves to an ordinary binding gets the real teaching instead of
      // "Unknown type".
      const syntax = pattern.type.syntax;
      if (syntax.kind === "NamedTypeSyntax") {
        const binding = this.host.lookup(syntax.name);
        const bindingKind = binding?.type.kind;
        if (binding && bindingKind !== "typeObject" && bindingKind !== "enumObject"
          && bindingKind !== "classConstructor" && bindingKind !== "runtimeType"
          && !this.host.typeAliases.has(syntax.name) && !this.host.namedTypes.has(syntax.name)
          && !this.host.enums.has(syntax.name) && !this.host.classes.has(syntax.name)
          && !this.host.primitiveNames.has(syntax.name)) {
          this.host.typeError(
            `'${syntax.name}' is a binding, and bindings cannot be matched directly; match a dotted path (case owner.${syntax.name}:) or use a guard (case _ if value == ${syntax.name}:)`,
            pattern.span,
          );
          return invalidType;
        }
      }
      this.host.allowBareGenericClassName(pattern.type);
      const checked = this.host.resolveAnnotation(pattern.type);
      const valid = this.host.validateTypeReference(pattern.type);
      if (valid && this.host.rejectErasedRuntimeCheck(checked, pattern.type.span)) return invalidType;
      if (valid && input.kind !== "unknown" && !this.host.coverage.matchTypesOverlap(this.host.expandAliases(input), checked)) {
        this.host.typeError(`Type pattern ${describeType(checked)} can never match ${describeType(input)}`, pattern.span);
      }
      return valid ? this.narrowMatchType(input, checked) : invalidType;
  }

  matchLocationNarrowing(expression: Expression, type: ValueType): ReadonlyMap<string, ValueType> {
    const narrowed = new Map<string, ValueType>();
    this.host.narrowing.addLocationNarrowing(narrowed, expression, type);
    return narrowed;
  }

  retargetNarrowings(source: ReadonlyMap<string, ValueType>, type: ValueType): ReadonlyMap<string, ValueType> {
    return new Map([...source.keys()].map((key) => [key, type]));
  }

  matchFallthroughType(input: ValueType, pattern: MatchPattern): ValueType {
    const source = this.host.expandAliases(input);
    const members = source.kind === "union" ? source.members
      : source.kind === "optional" ? [source.inner, nullType]
        : null;
    if (!members) return input;
    const remaining = members.filter((member) => !this.host.coverage.matchPatternCoversWholeType(pattern, member));
    return remaining.length > 0 && remaining.length < members.length ? unionOf(remaining) : input;
  }

  unwrapMatchAs(pattern: MatchPattern): MatchPattern {
    return pattern.kind === "MatchAsPattern" ? this.unwrapMatchAs(pattern.pattern) : pattern;
  }

  addMatchBinding(
    bindings: Map<string, { readonly type: ValueType; readonly span: Span }>,
    name: string,
    type: ValueType,
    bindingSpan: Span,
  ): void {
    if (name === "_") return;
    if (bindings.has(name)) {
      this.host.diagnostics.push(diagnostic("VEL4019", `Match binding '${name}' is declared more than once`, bindingSpan));
      return;
    }
    bindings.set(name, { type, span: bindingSpan });
  }

  narrowMatchType(input: ValueType, rawChecked: ValueType): ValueType {
    const source = this.host.expandAliases(input);
    const checked = this.host.erasedClassCheckType(source, rawChecked);
    if (source.kind === "any" || source.kind === "unknown") return checked;
    if (source.kind === "union") {
      const members = source.members
        .filter((member) => this.host.coverage.matchTypesOverlap(member, checked))
        .map((member) => this.narrowMatchType(member, checked));
      return members.length > 0 ? unionOf(members) : checked;
    }
    if (source.kind === "optional") {
      const members = [source.inner, nullType]
        .filter((member) => this.host.coverage.matchTypesOverlap(member, checked))
        .map((member) => this.narrowMatchType(member, checked));
      return members.length > 0 ? unionOf(members) : checked;
    }
    if (this.host.isAssignableHere(source, checked)
      || (isReadonlyView(source) && this.host.isAssignableHere(mutableViewOf(source), mutableViewOf(checked)))) return source;
    return this.host.narrowing.runtimeCheckedType(source, checked);
  }

}
