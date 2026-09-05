/**
 * The generic solver: three-phase call-site unification for a generic `def`,
 * the same solver run for a generic construction, and the bound check both
 * report through.
 *
 * D115 §三: this was four private methods of `CallInference` plus the solver
 * record their phases thread. They are one subject — what a call does with type
 * parameters — and nothing else in this directory reads their internals, so
 * only `inferGenericCall` and `inferGenericConstruction` leave the file.
 *
 * `boundVocabularyGuidance` lives here because this is the site that prints it
 * at a call and at a construction; the type-position site
 * (`../declarations/generics.ts`) reads the same table rather than restating
 * the sentence, which is the whole point of there being one table.
 */
import { type ArrowFunctionExpression, type Expression } from "../../ast.ts";
import { type ClassInfo } from "../../contracts.ts";
import { diagnostic, type Diagnostic, type DiagnosticFix } from "../../diagnostic.ts";
import { type Span } from "../../source.ts";
import {
  classApplicationType,
  collectGenericBoundViolations,
  describeType,
  isInvalidType,
  substituteTypeParameters,
  typeContainsParameter,
  unifyTypeParameters,
  unknownType,
  type TypeParameterBound,
  type ValueType,
} from "../../types.ts";
import { argumentNoun, type NamedArguments } from "./named-arguments.ts";
import { seedTypeParametersFromPosition } from "./seeding.ts";

/**
 * D41 item 61: the one sentence each type-parameter bound is explained with,
 * wherever it is refused — at a call, at a construction, or at a generic
 * application in a type position.
 */
export const boundVocabularyGuidance: Readonly<Record<TypeParameterBound, string>> = {
  Text: "a Text parameter accepts the types with a hook-free text form — strings, numbers, bools, enums, and null",
  Comparable: "a Comparable parameter accepts the types with a runtime order — numbers and strings",
  Data: "a Data parameter accepts JSON-shaped data — strings, numbers, bools, null, enums, and the Lists, records, and Records built from them",
};

/** One argument of a generic call, with the parameter it was planned onto. */
export interface PlannedArgument {
  readonly value: Expression;
  readonly declared: ValueType | null;
  readonly errorSpan: Span;
  readonly spreadList: boolean;
}

/**
 * The solver one generic call threads through its three phases: the bindings
 * being filled in, the parameters an `unknown` argument reached, and the four
 * closures the phases share. It is the locals of the one method, named.
 */
interface GenericCallSolver {
  readonly bindings: (ValueType | null)[];
  readonly unknownParameters: Set<number>;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  expandAliases(type: ValueType): ValueType;
  substitute(declared: ValueType): ValueType;
  solvedContext(declared: ValueType): ValueType;
}

/**
 * The type a deferred arrow is inferred against. Its parameters come from the
 * substitution phase 1 produced — that is what gives `value =>` its element
 * type — but its *result* is claimed only where the call has actually solved
 * it. `values.flatMap` publishes `(T, number) -> List<R>`, and an unsolved `R`
 * substitutes to `List<unknown>`, which is a position that settles a list
 * literal (section 8): `v => [str(v)]` then answered `List<unknown>` and solved
 * `R` as `unknown` from a body that knew better. `solvedContext` is the same
 * "claim nothing that is not solved yet" rule the ordinary argument positions
 * already read.
 */
function deferredArrowContext(declared: ValueType, solver: GenericCallSolver): ValueType {
  const substituted = solver.substitute(declared);
  if (declared.kind !== "function" && declared.kind !== "action") return substituted;
  if (substituted.kind !== "function" && substituted.kind !== "action") return substituted;
  return { ...substituted, result: solver.solvedContext(declared.result) };
}

/** What the generic solver asks of the analyzer that hosts it, and nothing more. */
export interface GenericCallsHost {
  readonly classes: Map<string, ClassInfo>;
  readonly diagnostics: Diagnostic[];
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  /**
   * D114 0.28.0 B-I2: whether the call sits in a statement head that has no
   * annotation slot — a `using` binding (VEL2036 refuses `using r: T = ...`)
   * or a `for … in` head. A remedy that says "annotate the position" is not
   * one an author at either head can carry out.
   */
  inAnnotationFreeHead(): boolean;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  iterationGuidance(type: ValueType): string;
  iterationSource(expression: Expression, type: ValueType): ValueType;
  noteGenericApplications(type: ValueType, seen?: Set<string>): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void;
  satisfiesBound(type: ValueType, bound: TypeParameterBound): boolean;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
}

export class GenericCalls {
  private readonly host: GenericCallsHost;
  private readonly namedArguments: NamedArguments;

  constructor(host: GenericCallsHost, namedArguments: NamedArguments) {
    this.host = host;
    this.namedArguments = namedArguments;
  }

  /**
   * D114 定案: a class type parameter still unsolved at the construction is an
   * error at the construction — the same stance section 8 takes for an empty
   * collection, and reported with the same code, because it is the same
   * sentence: nothing at this position says what the value holds. The report
   * names both ways out, an annotation on the position and an argument that
   * fixes the parameter, because those are the only two there are.
   */
  inferGenericConstruction(
    callee: Extract<ValueType, { kind: "classConstructor" }>,
    info: ClassInfo,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    contextualType: ValueType,
    suppressUnsolvedReport = false,
  ): ValueType {
    const names = info.typeParameterNames ?? [];
    const declaration = info.identity ?? callee.identity ?? callee.name;
    const pattern = classApplicationType(
      declaration,
      callee.name,
      names.map((name, index): ValueType => ({ kind: "parameter", name, index })),
    );
    const constructor: Extract<ValueType, { kind: "function" }> = {
      kind: "function",
      typeParameterNames: names,
      ...(info.typeParameterBounds ? { typeParameterBounds: info.typeParameterBounds } : {}),
      parameters: info.parameters,
      ...(info.parameterNames ? { parameterNames: info.parameterNames } : {}),
      requiredParameters: info.requiredParameters,
      ...(info.constructorRest ? { rest: info.constructorRest } : {}),
      result: pattern,
    };
    const unsolved = new Set<number>();
    const reportsBefore = this.host.diagnostics.length;
    const result = this.inferGenericCall(constructor, arguments_, argumentNames, callSpan, contextualType, unsolved);
    // A construction the inference already reported on — a wrong argument
    // count, most of all — has one mistake on record, and the unsolved
    // parameter is downstream of it. One mistake, one report.
    if (this.host.diagnostics.length > reportsBefore) return result;
    // A position whose own annotation was already refused has said what it had
    // to say; the construction reads as unsolved only because of that report.
    const positionAlreadyReported = isInvalidType(this.host.expandAliases(contextualType));
    if (unsolved.size > 0 && !suppressUnsolvedReport && !positionAlreadyReported) {
      const listed = [...unsolved].map((index) => `'${names[index]}'`).join(", ");
      const example = `const value: ${callee.name}<${names.map((name, index) => unsolved.has(index) ? "string" : name).join(", ")}> = ${callee.name}(...)`;
      const solves = `pass an argument that solves ${unsolved.size === 1 ? "it" : "them"}`;
      const remedy = this.host.inAnnotationFreeHead()
        ? `${solves}, or acquire it into an annotated 'const' first ('${example}')`
        : `annotate the binding ('${example}'), or ${solves}`;
      this.host.diagnostics.push(diagnostic(
        "VEL4039",
        `Constructing '${callee.name}' leaves type parameter${unsolved.size === 1 ? "" : "s"} ${listed} unsolved; nothing at this position says what ${unsolved.size === 1 ? "it stands" : "they stand"} for — ${remedy}`,
        callSpan,
      ));
    }
    return result;
  }

  // Three-phase call-site unification for generic callables: phase 1 infers
  // non-arrow arguments and collects bindings; phase 2 gives arrows contextual
  // types with the phase-1 substitution applied, then unifies their results;
  // phase 3 (D114 item ①) matches the declared result against the type the
  // position expects and seeds whatever the arguments left open. Type
  // parameters no phase solved substitute unknown.
  inferGenericCall(
    callee: Extract<ValueType, { kind: "function" | "action" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    contextualType: ValueType = unknownType,
    unsolved?: Set<number>,
  ): ValueType {
    const parameterCount = callee.typeParameterNames?.length ?? 0;
    const bindings: (ValueType | null)[] = Array.from({ length: parameterCount }, () => null);
    // D55 rule 120 layer two: a method of a generic class carries the class's
    // parameters above its own, at indexes the published list does not reach.
    // Those are fixed by the receiver, never solved by the call, so they are
    // bound to themselves before unification and restored after it — otherwise
    // `self.mapTo(f)` would let an argument redefine the class's own `T`.
    const rigid = new Map<number, ValueType>();
    const noteRigid = (type: ValueType): void => {
      typeContainsParameter(type, (parameter) => {
        if (parameter.index >= parameterCount) rigid.set(parameter.index, parameter);
        return false;
      });
    };
    for (const parameter of callee.parameters) noteRigid(parameter);
    if (callee.rest) noteRigid(callee.rest);
    noteRigid(callee.result);
    for (const [index, type] of rigid) bindings[index] = type;
    // NEW-D3: parameters an `unknown` argument reached are solved-to-unknown,
    // which no bound admits; they are tracked apart from `bindings` so that
    // `unknown` still never poisons a merge with a concrete argument.
    const unknownParameters = new Set<number>();
    const fieldsOf = (identity: string): ReadonlyMap<string, ValueType> | null => this.host.fieldsOf(identity);
    // A solved type argument is canonicalized the same way an annotation's is;
    // see the `parameter` branch of `unifyInto` for why the `Type<T>` path is
    // the one that would otherwise carry an unexpanded alias into `Channel<T>`.
    const expandAliases = (type: ValueType): ValueType => this.host.expandAliases(type);
    // D55 rule 121: substituting into `Box<T>` produces an instantiation this
    // module may never have written down, and it still has to have a field
    // table — otherwise `def unwrap<T>(box: Box<T>)` would solve T correctly
    // and then fail to accept the very record that solved it.
    const substitute = (declared: ValueType): ValueType => {
      const substituted = substituteTypeParameters(declared, bindings);
      this.host.noteGenericApplications(substituted);
      return substituted;
    };
    const solvedContext = (declared: ValueType): ValueType =>
      typeContainsParameter(declared, (parameter) => bindings[parameter.index] == null) ? unknownType : substitute(declared);

    const solver: GenericCallSolver = { bindings, unknownParameters, fieldsOf, expandAliases, substitute, solvedContext };
    const planned = this.planGenericArguments(callee, arguments_, argumentNames, callSpan, solver);
    if ("answer" in planned) return planned.answer;
    const actuals = this.unifyPlannedArguments(planned, solver);
    for (const [index, type] of rigid) bindings[index] = type;
    const seeded = seedTypeParametersFromPosition(callee.result, bindings, unknownParameters, contextualType, fieldsOf, expandAliases, this.host.classes);
    for (let index = 0; index < parameterCount; index += 1) {
      if (bindings[index] == null && !unknownParameters.has(index)) unsolved?.add(index);
    }
    this.reportGenericBoundViolations(callee, bindings, planned, callSpan, unknownParameters, seeded);
    for (const item of planned) {
      const actual = actuals.get(item) ?? unknownType;
      if (!item.declared) continue;
      if (item.spreadList) {
        const expanded = this.host.expandAliases(actual);
        if (expanded.kind === "list") this.host.requireAssignable(expanded.element, substitute(item.declared), item.errorSpan);
        else if (expanded.kind !== "any") this.host.typeError(`Call spread requires a List, received ${describeType(actual)}${this.host.iterationGuidance(actual)}`, item.errorSpan);
        continue;
      }
      this.host.requireAssignable(actual, substitute(item.declared), item.errorSpan);
    }
    return substitute(callee.result);
  }

  /**
   * The arguments of a generic call, paired with the parameter each one was
   * planned onto. A named plan that did not resolve answers the whole call,
   * because there is no position left to solve a type parameter from.
   */
  private planGenericArguments(
    callee: Extract<ValueType, { kind: "function" | "action" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    solver: GenericCallSolver,
  ): PlannedArgument[] | { readonly answer: ValueType } {
    const planned: PlannedArgument[] = [];
    const plan = this.namedArguments.planNamedArguments(arguments_, argumentNames, callee.parameters, callee.parameterNames, callee.requiredParameters, callSpan, callee.rest);
    if (plan) {
      for (const [source, target] of plan.targets.entries()) {
        const argument = arguments_[source]!;
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        planned.push({ value, declared: target === null ? null : callee.parameters[target] ?? callee.rest ?? null, errorSpan: argument.span, spreadList: false });
      }
      if (!plan.valid) {
        for (const item of planned) this.host.inferExpression(item.value, item.declared ? solver.solvedContext(item.declared) : unknownType);
        return { answer: solver.substitute(callee.result) };
      }
    } else {
      const hasSpread = arguments_.some((argument) => argument.kind === "SpreadExpression");
      if (!hasSpread && (arguments_.length < callee.requiredParameters || (!callee.rest && arguments_.length > callee.parameters.length))) {
        const expected = callee.rest
          ? `at least ${callee.requiredParameters}`
          : callee.requiredParameters === callee.parameters.length ? String(callee.parameters.length) : `${callee.requiredParameters}-${callee.parameters.length}`;
        this.host.typeError(`Expected ${expected} ${argumentNoun(expected)} but received ${arguments_.length}`, callSpan);
      }
      let fixedIndex = 0;
      let sawSpread = false;
      for (const argument of arguments_) {
        if (argument.kind === "SpreadExpression") {
          sawSpread = true;
          if (!callee.rest) this.host.typeError("Call spread requires a callable with a rest parameter", argument.span);
          else if (fixedIndex < callee.parameters.length) {
            this.host.typeError(`Provide all ${callee.parameters.length} fixed argument${callee.parameters.length === 1 ? "" : "s"} before a call spread`, argument.span);
          }
          planned.push({ value: argument.value, declared: callee.rest ?? null, errorSpan: argument.span, spreadList: true });
          fixedIndex = callee.parameters.length;
          continue;
        }
        const declared = sawSpread ? callee.rest ?? null : callee.parameters[fixedIndex] ?? callee.rest ?? null;
        planned.push({ value: argument, declared, errorSpan: argument.span, spreadList: false });
        if (!sawSpread && fixedIndex < callee.parameters.length) fixedIndex += 1;
      }
    }
    return planned;
  }

  /**
   * Phases 1 and 2: every non-arrow argument is inferred and unified into the
   * bindings, then each arrow is inferred against the substitution the first
   * phase produced and unified in turn.
   */
  private unifyPlannedArguments(planned: readonly PlannedArgument[], solver: GenericCallSolver): Map<PlannedArgument, ValueType> {
    const actuals = new Map<PlannedArgument, ValueType>();
    const deferredArrows: PlannedArgument[] = [];
    for (const item of planned) {
      if (item.value.kind === "ArrowFunctionExpression") {
        deferredArrows.push(item);
        continue;
      }
      const context = item.declared
        ? solver.solvedContext(item.spreadList ? { kind: "list", element: item.declared } : item.declared)
        : unknownType;
      // D68 rule 177: a call spread consumes an iterable, so it reads the
      // `@iterate:` answer — `f(...bag)` is `f(...bag.items)`, refusal included.
      const actual = item.spreadList
        ? this.host.iterationSource(item.value, this.host.inferExpression(item.value, context))
        : this.host.inferExpression(item.value, context);
      actuals.set(item, actual);
      if (!item.declared) continue;
      if (item.spreadList) {
        const expanded = this.host.expandAliases(actual);
        if (expanded.kind === "list") unifyTypeParameters(item.declared, expanded.element, solver.bindings, solver.fieldsOf, solver.unknownParameters, solver.expandAliases);
      } else {
        unifyTypeParameters(item.declared, actual, solver.bindings, solver.fieldsOf, solver.unknownParameters, solver.expandAliases);
      }
    }
    for (const item of deferredArrows) {
      const context = item.declared ? deferredArrowContext(item.declared, solver) : unknownType;
      const actual = this.host.inferExpression(item.value, context);
      actuals.set(item, actual);
      if (item.declared) unifyTypeParameters(item.declared, actual, solver.bindings, solver.fieldsOf, solver.unknownParameters, solver.expandAliases);
    }
    return actuals;
  }

  /**
   * D41 item 61 check site 1: once the two-phase inference has solved the
   * bindings, every bound is verified before the ordinary assignability loop
   * runs, so a rejected type argument is reported once, at its cause.
   */
  private reportGenericBoundViolations(
    callee: Extract<ValueType, { kind: "function" | "action" | "intrinsic" }>,
    bindings: readonly (ValueType | null)[],
    planned: readonly { readonly declared: ValueType | null; readonly errorSpan: Span }[],
    callSpan: Span,
    unknownParameters?: ReadonlySet<number>,
    seeded?: ReadonlySet<number>,
  ): void {
    const violations = collectGenericBoundViolations(callee, bindings, (type, bound) => this.host.satisfiesBound(type, bound), unknownParameters);
    for (const violation of violations) {
      // "Report at the cause" (D31 item 27). The one shape it cannot serve is
      // a parameter several arguments merged into: there is no single cause,
      // so the call itself reports and names the type that was solved.
      // A seeded parameter (D114 item ①) has no argument cause at all — the
      // position solved it — so it reports at the call and names the solver
      // it actually had. Same sentence, true subject.
      const causes = seeded?.has(violation.index)
        ? []
        : planned.filter((item) => item.declared !== null
          && typeContainsParameter(item.declared, (parameter) => parameter.index === violation.index));
      const solver = seeded?.has(violation.index) ? "the expected type solves" : "the arguments solve";
      const guidance = boundVocabularyGuidance[violation.bound];
      this.host.diagnostics.push(causes.length === 1
        ? diagnostic(
          "VEL4031",
          `Type parameter '${violation.name}' is bound by ${violation.bound}, so this argument cannot be ${describeType(violation.solved)}; ${guidance}`,
          causes[0]!.errorSpan,
        )
        : diagnostic(
          "VEL4031",
          `Type parameter '${violation.name}' is bound by ${violation.bound} but ${solver} it to ${describeType(violation.solved)}; ${guidance}`,
          callSpan,
        ));
    }
  }
}
