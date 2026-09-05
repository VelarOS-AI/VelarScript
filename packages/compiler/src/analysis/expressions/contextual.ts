/**
 * The type a position expects, and the report a position that expected nothing
 * earns: the contextual type of a collection literal, of a record literal, of
 * an awaited operand and of a `??` subject, and D85 rule 207's rule that an
 * empty collection which never learns what it holds is reported where the hole
 * was made.
 *
 * D115 §三: these were the contextual-type family and the unsettled-collection
 * family, seventeen private and protected methods of `Analyzer`. They belong
 * together because they are the two halves of one question: what does this
 * position say the value holds, and what happens when nothing does.
 */
import { type BindingPattern, type Expression } from "../../ast.ts";
import { type Diagnostic, diagnostic } from "../../diagnostic.ts";
import { type Span, span, spanIdentity } from "../../source.ts";
import { type ValueType, isAssignable, isInvalidType, optionalOf, unknownType } from "../../types.ts";
import { type Binding } from "../scopes.ts";

/**
 * D85 rule 207: does this type still carry an unsettled collection — a List or
 * Set element, or a Map's key and value together, that stayed `unknown`?
 *
 * This is the gate on the walk below, and it is what makes rule 208's boundary
 * fall out of the semantics instead of out of a syntax list. `Set().size` is a
 * number: nothing the empty `Set()` failed to say reaches the name, so the walk
 * never descends to it. `[["a"], []]` is a `List<List<string>>`: the sibling
 * element already said what the empty one holds, so there is nothing left to
 * report. Only a hole that survives all the way out to the binding is a hole
 * the author has to close.
 */
function carriesUnsettledCollection(type: ValueType, seen: Set<ValueType> = new Set()): boolean {
  if (seen.has(type)) return false;
  seen.add(type);
  switch (type.kind) {
    case "list":
    case "set":
      return type.element.kind === "unknown" || carriesUnsettledCollection(type.element, seen);
    case "map":
      // A Map settles when either half does: `Map<string, unknown>` says its
      // keys are strings, and only `Map()` with nothing at all is unsettled.
      return (type.key.kind === "unknown" && type.value.kind === "unknown")
        || carriesUnsettledCollection(type.key, seen)
        || carriesUnsettledCollection(type.value, seen);
    case "optional":
      return carriesUnsettledCollection(type.inner, seen);
    case "record":
    case "promise":
      return carriesUnsettledCollection(type.value, seen);
    case "object":
      return [...type.fields.values()].some((field) => carriesUnsettledCollection(field, seen));
    case "union":
      return type.members.some((member) => carriesUnsettledCollection(member, seen));
    default:
      return false;
  }
}

/**
 * D85 rule 207: the sub-expressions whose value becomes part of this
 * expression's value, so each of them is a position that has to say what an
 * empty collection written there holds.
 *
 * A receiver and an argument are here, but the caller only asks for them once
 * `carriesUnsettledCollection` has said the enclosing value still has the hole
 * in it — so `const a = [].copy()` and `const a = id([])` report at the `[]`
 * that made the hole, while `print(Set().size)` and `const n = Set().size`
 * never reach the receiver at all. That is rule 208 stated as a property of the
 * value rather than as a list of node kinds.
 */
function settlingValuePositions(expression: Expression): readonly Expression[] {
  switch (expression.kind) {
    case "ConditionalExpression":
      return [expression.thenValue, expression.elseValue];
    case "ListExpression":
      return expression.elements.map((element) => element.kind === "SpreadExpression" ? element.value : element);
    case "ObjectExpression":
      return expression.properties.map((entry) => entry.value);
    case "BinaryExpression":
      return expression.operator === "??" ? [expression.left, expression.right] : [];
    case "CallExpression":
      return [
        ...(expression.callee.kind === "MemberExpression" ? [expression.callee.object] : []),
        ...expression.arguments.map((argument) => argument.kind === "SpreadExpression" ? argument.value : argument),
      ];
    case "MemberExpression":
      return [expression.object];
    case "IndexExpression":
      return [expression.object];
    default:
      return [];
  }
}

/** What contextual typing and the unsettled-collection rule asks of the analyzer that hosts it, and nothing more. */
export interface ContextualTypingHost {
  annotationFreeHeads: number;
  readonly bindingHoleCauses: Map<Binding, ReadonlySet<string>>;
  readonly contextualAssignments: Map<string, ValueType>;
  readonly deferredConvergenceReports: { readonly report: Diagnostic; readonly resultKey: string; readonly causes: ReadonlySet<string>; }[];
  readonly diagnostics: Diagnostic[];
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  readonly functionResultKeys: Map<Binding, string>;
  readonly importBindings: ReadonlyMap<string, ValueType>;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  readonly inferredExpressionTypes: Map<string, ValueType>;
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  lookup(name: string): Binding | null;
  readonly primitiveNames: Set<string>;
  readonly reportedCollectionHoles: Set<Binding>;
  readonly reportedResultHoles: Set<string>;
  readonly scopes: Map<string, Binding>[];
}

export class ContextualTyping {
  private readonly host: ContextualTypingHost;

  constructor(host: ContextualTypingHost) {
    this.host = host;
  }

  contextualCollectionType(type: ValueType): Extract<ValueType, { kind: "list" | "map" | "set" }> | null {
    const expanded = this.host.expandAliases(type);
    if (expanded.kind === "list" || expanded.kind === "map" || expanded.kind === "set") return expanded;
    if (expanded.kind === "optional") return this.contextualCollectionType(expanded.inner);
    return null;
  }

  /**
   * D114 item ①: what an `await` says to the expression it awaits. A position
   * that expects `T` is awaiting something that produces `Promise<T>`, and a
   * position that expects nothing keeps expecting nothing — silence has to stay
   * silence, because section 8's empty-collection rule reads this same channel
   * and `await []` must go on saying exactly what it said.
   */
  awaitedOperandContext(contextualType: ValueType): ValueType {
    const expanded = this.host.expandAliases(contextualType);
    if (expanded.kind === "unknown" || expanded.kind === "any" || isInvalidType(expanded)) return unknownType;
    return { kind: "promise", value: contextualType };
  }

  /**
   * D114 0.28.0 A-I1: the *subject* of `??` stands in the position the
   * annotation names, exactly as its fallback does. `const xs: List<string> =
   * empty() ?? []` settled the empty literal on the right and left the generic
   * call on the left at `List<unknown>` — one `??` under one annotation
   * answering two ways, while both arms of a ternary already receive it. The
   * subject may be null, so what it is offered is the optional spelling of the
   * expected type; every reader of a contextual type looks through `optional`
   * already (section 8's empty-collection rule and the type-argument seed
   * both do). Every other operator's operands stay context-free: `??` is the
   * one whose subject the position's own type reaches.
   */
  coalescingSubjectContext(operator: string, contextualType: ValueType): ValueType {
    if (operator !== "??") return unknownType;
    const expanded = this.host.expandAliases(contextualType);
    if (expanded.kind === "unknown" || expanded.kind === "any" || isInvalidType(expanded)) return unknownType;
    return expanded.kind === "optional" ? contextualType : optionalOf(contextualType);
  }

  coalescingFallbackContext(left: ValueType, contextualType: ValueType): ValueType {
    const expandedContext = this.host.expandAliases(contextualType);
    if (expandedContext.kind !== "unknown" && !isInvalidType(expandedContext)) return contextualType;
    return left.kind === "optional" ? left.inner : unknownType;
  }

  contextualObjectType(
    type: ValueType,
    expression?: Extract<Expression, { kind: "ObjectExpression" }>,
  ): Extract<ValueType, { kind: "named" | "object" | "record" }> | null {
    const expanded = this.host.expandAliases(type);
    if (expanded.kind === "named") return this.host.primitiveNames.has(expanded.name) ? null : expanded;
    if (expanded.kind === "object") return expanded;
    if (expanded.kind === "record") return expanded;
    if (expanded.kind === "optional") return this.contextualObjectType(expanded.inner, expression);
    if (expanded.kind === "union") {
      const candidates = expanded.members
        .map((member) => this.contextualObjectType(member, expression))
        .filter((member): member is Extract<ValueType, { kind: "named" | "object" | "record" }> => member !== null);
      if (candidates.length === 1) return candidates[0]!;
      if (expression) {
        const matching = candidates.filter((candidate) => this.contextualObjectDiscriminantsMatch(candidate, expression));
        if (matching.length === 1) return matching[0]!;
      }
    }
    return null;
  }

  private contextualObjectDiscriminantsMatch(
    candidate: Extract<ValueType, { kind: "named" | "object" | "record" }>,
    expression: Extract<Expression, { kind: "ObjectExpression" }>,
  ): boolean {
    if (candidate.kind === "record") return true;
    const fields = candidate.kind === "object"
      ? candidate.fields
      : this.host.fieldsOf(candidate.identity ?? candidate.name);
    if (!fields) return false;
    for (const property of expression.properties) {
      if (property.kind !== "ObjectProperty") continue;
      const expected = fields.get(property.name);
      if (expected?.kind !== "enumMember") continue;
      const actual = this.knownEnumSingleton(property.value);
      if (actual && (actual.identity !== expected.identity || actual.member !== expected.member)) return false;
    }
    return true;
  }

  contextuallyAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): boolean {
    if (this.host.isAssignableHere(actual, expected)) return true;
    const expandedActual = this.host.expandAliases(actual);
    const expandedExpected = this.host.expandAliases(expected);
    if ((expandedActual !== actual || expandedExpected !== expected)
      && this.host.isAssignableHere(expandedActual, expandedExpected)) return true;
    const contextual = this.host.contextualAssignments.get(spanIdentity(valueSpan));
    return Boolean(contextual && this.host.isAssignableHere(this.host.expandAliases(contextual), expandedExpected));
  }

  private knownEnumSingleton(expression: Expression): Extract<ValueType, { kind: "enumMember" }> | null {
    const inferred = this.host.inferredExpressionTypes.get(spanIdentity(expression.span));
    if (inferred?.kind === "enumMember") return inferred;
    if (expression.kind === "IdentifierExpression") {
      const type = this.host.expandAliases(this.host.lookup(expression.name)?.type ?? unknownType);
      return type.kind === "enumMember" ? type : null;
    }
    if (expression.kind !== "MemberExpression" || expression.object.kind !== "IdentifierExpression") return null;
    const owner = this.host.lookup(expression.object.name)?.type ?? this.host.importBindings.get(expression.object.name);
    return owner?.kind === "enumObject" && owner.members.has(expression.property)
      ? { kind: "enumMember", name: owner.name, identity: owner.identity, member: expression.property }
      : null;
  }

  widenAggregateSingleton(type: ValueType): ValueType {
    return type.kind === "enumMember"
      ? { kind: "enum", name: type.name, identity: type.identity }
      : type;
  }

  inferAnnotationFreeHead(expression: Expression): ValueType {
    this.host.annotationFreeHeads += 1;
    try {
      return this.host.inferExpression(expression);
    } finally {
      this.host.annotationFreeHeads -= 1;
    }
  }

  inAnnotationFreeHead(): boolean {
    return this.host.annotationFreeHeads > 0;
  }

  /**
   * D85 rule 207: an empty collection's element type must be settled where the
   * collection is written — by an annotation, a contextual type, or the
   * constructor's own arguments. Nothing infers it from a later mutation, so a
   * binding left with no source is reported at the construction rather than
   * kept as `unknown` for a following line to fill in.
   *
   * The value written at this position is not always the construction itself.
   * A ternary arm, a list element or its spread, a record-literal field, a
   * `??` fallback, a receiver and an argument all become part of the value the
   * name holds, so each is its own settling position and each reports at its
   * own `[]`. What stops the walk is the value, not the syntax: it descends
   * only while `carriesUnsettledCollection` still sees the hole in the type
   * arriving here, so `print(Set().size)` and `const n = Set().size` stay
   * legal per rule 208 — neither of those names holds a collection — while a
   * spread whose `unknown` the merge absorbs (`["x", ...[]]`) leaves nothing
   * to report. A sibling settles nothing for its neighbour: `[["a"], []]`
   * merges through `unionOf`, so the union still carries the hole and the
   * empty `[]` reports on its own.
   *
   * Returns whether it reported, so the caller can hand the name `invalidType`
   * instead of the hole. Rule 209 requires one mistake to be reported once,
   * and `List<unknown>` reaching a later line is what produces the second,
   * contradicting report the ruling exists to delete.
   */
  requireSettledCollectionElement(initializer: Expression, declared: ValueType, annotated: boolean): boolean {
    if (annotated) return false;
    return this.reportUnsettledCollection(initializer, this.host.expandAliases(declared));
  }

  private reportUnsettledCollection(expression: Expression, type: ValueType | null): boolean {
    if (type !== null) {
      if (this.isFreshUnresolvedCollection(expression, type)) {
        const [spelling, holds, example] = type.kind === "list"
          ? ["[]", "what the List holds", "let items: List<string> = []"]
          : type.kind === "set"
            ? ["Set()", "what the Set holds", "const tags: Set<string> = Set()"]
            : ["Map()", "what the Map holds", "const users: Map<string, User> = Map()"];
        this.host.diagnostics.push(diagnostic(
          "VEL4039",
          `Empty '${spelling}' requires an explicit type; nothing at this position says ${holds} — write '${example}'`,
          expression.span,
        ));
        return true;
      }
      if (!carriesUnsettledCollection(type)) return false;
    }
    let reported = false;
    for (const part of settlingValuePositions(expression)) {
      // A part analyzed under a contextual type that settled it never reaches
      // here as `unknown`; one that was analyzed at all has its answer on
      // record. A part with no answer on record was never inferred as a whole
      // — `Map([[key, value]])` reads the entry's two leaves and never the
      // entry list itself — so the walk carries on through the gap rather
      // than stopping at one it did not make.
      const partType = this.host.inferredExpressionTypes.get(spanIdentity(part.span));
      if (this.reportUnsettledCollection(part, partType ? this.host.expandAliases(partType) : null)) reported = true;
    }
    return reported;
  }

  private isFreshUnresolvedCollection(expression: Expression, type: ValueType): boolean {
    const unresolved = type.kind === "list" ? type.element.kind === "unknown"
      : type.kind === "set" ? type.element.kind === "unknown"
        : type.kind === "map" ? type.key.kind === "unknown" && type.value.kind === "unknown"
          : false;
    if (!unresolved) return false;
    // Only a genuinely empty construction is unsettled. A populated one whose
    // items happen to be `unknown` (`[value]` over an unchecked boundary
    // value) says what it holds; the element type is simply that.
    if (expression.kind === "ListExpression") return expression.elements.length === 0;
    return expression.kind === "CallExpression"
      && expression.arguments.length === 0
      // `Set<string>()` already told the author where the element type goes
      // (VEL2031); reporting the missing one here would name the same mistake
      // twice and contradict the fix the first report offers.
      && expression.typeArgumentsRemoved !== true
      && expression.callee.kind === "IdentifierExpression"
      && (expression.callee.name === "Map" || expression.callee.name === "Set");
  }

  /**
   * D85 rule 209: where the value at this position came from, when it came
   * from a hole VEL4039 already reported. The answer is two-part because a
   * callee can be declared after its caller: `true` is a hole already on
   * record, and `causes` are the local results that make this position a hole
   * too if theirs turn out to be one.
   *
   * Only a name and a call to a local name are modelled — the two shapes an
   * author writes between an empty collection and the `return` that publishes
   * it. Anything else contributes nothing, so an unmodelled position keeps the
   * report it has today rather than losing one.
   */
  collectResultHoleSources(expression: Expression, causes: Set<string>): boolean {
    if (expression.kind === "IdentifierExpression") {
      const binding = this.host.lookup(expression.name);
      if (!binding) return false;
      for (const cause of this.host.bindingHoleCauses.get(binding) ?? []) causes.add(cause);
      return this.host.reportedCollectionHoles.has(binding);
    }
    if (expression.kind === "CallExpression" && expression.callee.kind === "IdentifierExpression") {
      const binding = this.host.lookup(expression.callee.name);
      const resultKey = binding ? this.host.functionResultKeys.get(binding) : undefined;
      // An imported, dynamically dispatched, or method call resolves to no
      // local result. Its hole — if it has one — was reported in the module
      // that owns it, and nothing here can say so, so the call is not a cause.
      if (resultKey === undefined) return false;
      if (this.host.reportedResultHoles.has(resultKey)) return true;
      causes.add(resultKey);
      return false;
    }
    return false;
  }

  /**
   * D85 rule 209: a name bound to a reported hole carries it, so `const a = []`
   * followed by `return a` is the same one mistake `return []` is. Only an
   * unannotated `const`/`let` of a single name carries anything: an annotation
   * settles the construction, and a destructuring pattern takes the hole apart
   * rather than passing it on.
   */
  recordBindingHoleSource(pattern: BindingPattern, initializer: Expression, reported: boolean): void {
    if (pattern.kind !== "NameBindingPattern") return;
    const binding = this.host.scopes.at(-1)?.get(pattern.name);
    if (!binding) return;
    const causes = new Set<string>();
    if (reported || this.collectResultHoleSources(initializer, causes)) {
      this.host.reportedCollectionHoles.add(binding);
      return;
    }
    if (causes.size > 0) this.host.bindingHoleCauses.set(binding, causes);
  }

  /**
   * D85 rule 209: delete the convergence report of every function whose result
   * is invalid only because a hole VEL4039 already explained reached it through
   * a local call. The set grows until it stops growing, because a chain of
   * forwarding functions is still one mistake however long it is — and a cycle
   * with no empty collection anywhere in it never enters the set, so a genuine
   * convergence failure still reports on both of its halves.
   */
  resolveDeferredConvergenceReports(): void {
    if (this.host.deferredConvergenceReports.length === 0) return;
    const suppressed = new Set<Diagnostic>();
    for (let growing = true; growing;) {
      growing = false;
      for (const entry of this.host.deferredConvergenceReports) {
        if (suppressed.has(entry.report)) continue;
        if (![...entry.causes].some((cause) => this.host.reportedResultHoles.has(cause))) continue;
        suppressed.add(entry.report);
        this.host.reportedResultHoles.add(entry.resultKey);
        growing = true;
      }
    }
    for (let index = this.host.diagnostics.length - 1; index >= 0; index -= 1) {
      const report = this.host.diagnostics[index];
      if (report && suppressed.has(report)) this.host.diagnostics.splice(index, 1);
    }
  }
}
