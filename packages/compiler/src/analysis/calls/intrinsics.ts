/**
 * The standard-module intrinsics: per-module argument checking for
 * `velar/json`, `velar/async`, the remaining module vocabularies, `range`, and
 * `equals`, plus the one in-flight object all of them share.
 *
 * D114 R1b recorded why this is call checking rather than module vocabulary:
 * two thirds of it is the named-argument plan and the argument helpers, it
 * reads none of the vocabulary tables (`jsonNamespaceType`,
 * `mathNamespaceMembers`, …), and it is reached from nowhere but `inferCall`.
 *
 * D115 §三 gives it its own file. `inferIntrinsicCall` is the whole of what
 * leaves it: the per-module rules are tried in the order the one 303-line
 * method tried them, and each answers `null` for an intrinsic it does not own.
 */
import { type ArrowFunctionExpression, type Expression } from "../../ast.ts";
import { type CompilerAnalysisExtension, type FormReadField } from "../../contracts.ts";
import { type DiagnosticFix } from "../../diagnostic.ts";
import { spanIdentity, type Span } from "../../source.ts";
import {
  anyType,
  boolType,
  describeType,
  nullType,
  numberType,
  optionalOf,
  stringType,
  unionOf,
  unknownType,
  type ExtensionValueType,
  type ValueType,
} from "../../types.ts";
import { argumentNoun, trimTrailingOmittedArguments, type NamedArguments } from "./named-arguments.ts";
import { durationType } from "../vocabulary.ts";

/**
 * The lowering side tables an intrinsic call writes. `LoweringRecorder`
 * satisfies this; naming only what is written keeps its other tables out of
 * this file's dependency face.
 */
interface IntrinsicLoweringFacts {
  readonly equalsCalls: Set<string>;
  readonly formReads: Map<string, readonly FormReadField[]>;
  readonly namedArgumentOrders: Map<string, readonly number[]>;
}

/** What the intrinsic rules ask of the analyzer that hosts them, and nothing more. */
export interface IntrinsicCallsHost {
  readonly analysisExtensions: readonly CompilerAnalysisExtension[];
  checkArguments(arguments_: readonly Expression[], parameters: readonly ValueType[], callSpan: Span, requiredParameters?: number, rest?: ValueType, argumentNames?: readonly (string | null)[], parameterNames?: readonly string[]): void;
  concreteCallableFor(actual: ValueType, expected: ValueType, errorSpan?: Span): ValueType;
  enumMeetDomain(left: ValueType, right: ValueType): "string" | "number";
  equalityGuidance(leftSource: ValueType, rightSource: ValueType): string;
  equalityTypesIntersect(leftSource: ValueType, rightSource: ValueType): boolean;
  equalsDomainViolation(source: ValueType, seen?: Set<string>): string | null;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  formReadField(name: string, source: ValueType, fieldSpan: Span): FormReadField | null;
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  inferredExpressionType(expression: Expression): ValueType;
  /**
   * `isAssignable` judged against the analyzer as the type environment, which
   * is all the intrinsic extension hook asks of it.
   */
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  isHttpFormBody(source: ValueType): boolean;
  jsonSerializable(source: ValueType, seen?: ReadonlySet<string>): boolean | null;
  readonly lowering: IntrinsicLoweringFacts;
  readonly namedTypes: Map<string, ReadonlyMap<string, ValueType>>;
  reportPromiseResolutionHazard(type: ValueType, errorSpan: Span): void;
  requireAssignable(actual: ValueType, expected: ValueType, valueSpan: Span): void;
  runtimeTypeObjectValue(type: Extract<ValueType, { kind: "typeObject" }>): ValueType;
  readonly testExpectOperands: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  typesIntersect(leftSource: ValueType, rightSource: ValueType, enumStringVeto: boolean): boolean;
}

/** The arguments of one intrinsic call, after its named-argument plan resolved them. */
interface ResolvedIntrinsicArguments {
  readonly arguments_: readonly Expression[];
  readonly namedPreanalyzed: boolean;
  readonly deferredNamedArrows: Set<Expression>;
}

/**
 * One intrinsic call in flight. The prologue of `inferIntrinsicCall` used to
 * declare these as closures over its own locals; they are the same code, held
 * here so the per-module rules can be separate methods, and so the analysis
 * extension hook is handed the same helpers it was handed before.
 */
class IntrinsicCall {
  private readonly host: IntrinsicCallsHost;
  private readonly intrinsic: Extract<ValueType, { kind: "intrinsic" }>;
  private readonly callSpan: Span;
  readonly arguments_: readonly Expression[];
  readonly namedPreanalyzed: boolean;
  readonly deferredNamedArrows: Set<Expression>;
  readonly suppliedCount: number;

  constructor(
    host: IntrinsicCallsHost,
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    callSpan: Span,
    resolved: ResolvedIntrinsicArguments,
  ) {
    this.host = host;
    this.intrinsic = intrinsic;
    this.callSpan = callSpan;
    this.arguments_ = resolved.arguments_;
    this.namedPreanalyzed = resolved.namedPreanalyzed;
    this.deferredNamedArrows = resolved.deferredNamedArrows;
    this.suppliedCount = this.arguments_.reduce((count, argument) => count + (this.omitted(argument) ? 0 : 1), 0);
  }

  private omitted(argument: Expression | undefined): boolean {
    return argument?.kind === "IdentifierExpression" && argument.name === "\u0000omitted-named-argument";
  }

  argumentAt(index: number): Expression | null {
    const argument = this.arguments_[index];
    return !argument || this.omitted(argument) ? null : argument;
  }

  arity(minimum = this.intrinsic.requiredParameters, maximum = this.intrinsic.parameters.length): void {
    if (this.suppliedCount < minimum || this.suppliedCount > maximum) {
      const expected = maximum === Number.POSITIVE_INFINITY
        ? `at least ${minimum}`
        : minimum === maximum ? String(minimum) : `${minimum}-${maximum}`;
      this.host.typeError(`Expected ${expected} ${argumentNoun(expected)} but received ${this.suppliedCount}`, this.callSpan);
    }
  }

  inferAt(index: number, expected: ValueType = unknownType): ValueType {
    const argument = this.argumentAt(index);
    if (!argument) return unknownType;
    const deferred = this.deferredNamedArrows.has(argument);
    const actual = this.namedPreanalyzed && !deferred
      ? this.host.inferredExpressionType(argument)
      : this.host.inferExpression(argument, expected);
    if (deferred) this.deferredNamedArrows.delete(argument);
    if (expected.kind !== "unknown") this.host.requireAssignable(actual, expected, argument.span);
    return actual;
  }

  arrayAt(index: number): { readonly type: ValueType; readonly element: ValueType } {
    const type = this.inferAt(index);
    if (type.kind === "list") return { type, element: type.element };
    if (type.kind === "any") return { type, element: anyType };
    const argument = this.argumentAt(index);
    if (argument) this.host.typeError(`Expected a List, received ${describeType(type)}`, argument.span);
    return { type, element: unknownType };
  }

  callbackAt(index: number, parameters: readonly ValueType[], result: ValueType): ValueType {
    const expected: ValueType = { kind: "function", parameters, requiredParameters: parameters.length, result };
    return this.host.concreteCallableFor(this.inferAt(index, expected), expected, this.argumentAt(index)?.span);
  }

  callbackResult(type: ValueType): ValueType {
    return type.kind === "function" || type.kind === "action" || type.kind === "intrinsic" ? type.result : type.kind === "any" ? anyType : unknownType;
  }

  promiseValue(type: ValueType, index: number): ValueType {
    if (type.kind === "promise") return type.value;
    if (type.kind === "any") return anyType;
    const argument = this.argumentAt(index);
    if (argument) this.host.typeError(`Expected a Promise, received ${describeType(type)}`, argument.span);
    return unknownType;
  }

  runtimeTypeAt(index: number): ValueType {
    const type = this.inferAt(index);
    if (type.kind === "typeObject") return this.host.runtimeTypeObjectValue(type);
    if (type.kind === "enumObject") return { kind: "enum", name: type.name, identity: type.identity };
    if (type.kind === "runtimeType") return type.value;
    if (type.kind === "any") return anyType;
    const argument = this.argumentAt(index);
    if (argument) {
      this.host.typeError(
        "Runtime parsing requires a VelarScript runtime type: pass a declared type, enum, or alias name — 'type Saved = List<Item>' makes 'Saved' one. A primitive spelling ('string') and a generic spelling ('List<Item>') are types, not values",
        argument.span,
      );
    }
    return unknownType;
  }
}

export class IntrinsicCalls {
  private readonly host: IntrinsicCallsHost;
  private readonly namedArguments: NamedArguments;

  constructor(host: IntrinsicCallsHost, namedArguments: NamedArguments) {
    this.host = host;
    this.namedArguments = namedArguments;
  }

  inferIntrinsicCall(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType {
    if (intrinsic.name === "collections.range") {
      return this.inferRangeCall(intrinsic, sourceArguments, argumentNames, callSpan);
    }
    if (intrinsic.name === "core.equals") {
      return this.inferEqualsCall(intrinsic, sourceArguments, argumentNames, callSpan);
    }
    const resolved = this.resolveIntrinsicArguments(intrinsic, sourceArguments, argumentNames, callSpan);
    if ("answer" in resolved) return resolved.answer;
    const call = new IntrinsicCall(this.host, intrinsic, callSpan, resolved);
    const extended = this.inferExtensionIntrinsic(call, intrinsic, callSpan);
    if (extended) return extended;
    return this.inferJsonIntrinsic(call, intrinsic, callSpan)
      ?? this.inferAsyncIntrinsic(call, intrinsic, callSpan)
      ?? this.inferOtherIntrinsic(call, intrinsic, callSpan);
  }

  /**
   * The arguments the per-intrinsic rules see. A named call is planned against
   * the intrinsic's published parameter names and inferred here, before any
   * rule runs; arrow arguments are held back so the rule that knows their
   * contract infers them. A plan that did not resolve answers the whole call.
   */
  private resolveIntrinsicArguments(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ResolvedIntrinsicArguments | { readonly answer: ValueType } {
    let arguments_ = sourceArguments;
    let namedPreanalyzed = false;
    const deferredNamedArrows = new Set<Expression>();
    const named = this.namedArguments.planNamedArguments(
      sourceArguments,
      argumentNames,
      intrinsic.parameters,
      intrinsic.parameterNames,
      intrinsic.requiredParameters,
      callSpan,
      intrinsic.rest,
    );
    if (named) {
      for (const [source, target] of named.targets.entries()) {
        const argument = sourceArguments[source]!;
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (value.kind === "ArrowFunctionExpression") deferredNamedArrows.add(value);
        else {
          const declared = target === null ? unknownType : intrinsic.parameters[target] ?? intrinsic.rest ?? unknownType;
          // D90 R17: an accept-anything parameter is spelled `List<unknown>`
          // in the vocabulary tables, and that spelling carries no element
          // information — preanalyzing a literal against it would launder
          // `[1, 2]` into a list the handler can read no numbers from, so the
          // literal keeps its own inferred element and the handler's own
          // expected type does the checking.
          const context = declared.kind === "list" && declared.element.kind === "unknown" ? unknownType : declared;
          this.host.inferExpression(value, context);
        }
      }
      if (!named.valid) {
        for (const argument of deferredNamedArrows) this.host.inferExpression(argument);
        return { answer: intrinsic.result };
      }
      arguments_ = named.ordered;
      namedPreanalyzed = true;
    }
    return { arguments_, namedPreanalyzed, deferredNamedArrows };
  }

  /** A target extension may own an intrinsic of its own vocabulary; it is asked first. */
  private inferExtensionIntrinsic(
    call: IntrinsicCall,
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    callSpan: Span,
  ): ValueType | null {
    for (const extension of this.host.analysisExtensions) {
      const result = extension.inferIntrinsic?.({
        intrinsic,
        argumentAt: (index) => call.argumentAt(index),
        callSpan,
        arity: (minimum, maximum) => { call.arity(minimum, maximum); },
        inferAt: (index, expected) => call.inferAt(index, expected),
        callbackAt: (index, parameters, result) => call.callbackAt(index, parameters, result),
        runtimeTypeAt: (index) => call.runtimeTypeAt(index),
        typeError: (message, errorSpan) => this.host.typeError(message, errorSpan),
        isAssignable: (actual, expected) => this.host.isAssignableHere(actual, expected),
        expandAliases: (type) => this.host.expandAliases(type),
        jsonSerializable: (type) => this.host.jsonSerializable(type),
        isHttpFormBody: (type) => this.host.isHttpFormBody(type),
        declaredFieldsOf: (name) => this.host.namedTypes.get(name) ?? null,
        formReadField: (name, type, fieldSpan) => this.host.formReadField(name, type, fieldSpan),
        recordFormRead: (sourceSpan, fields) => this.host.lowering.formReads.set(spanIdentity(sourceSpan), fields),
      });
      if (result) return result;
    }
    return null;
  }

  /** The `velar/json` intrinsics and the runtime-Type parse they share. */
  private inferJsonIntrinsic(call: IntrinsicCall, intrinsic: Extract<ValueType, { kind: "intrinsic" }>, callSpan: Span): ValueType | null {
    switch (intrinsic.name) {
      case "json.parse": {
        call.arity(1, 2);
        call.inferAt(0, stringType);
        return call.argumentAt(1) ? call.runtimeTypeAt(1) : unknownType;
      }
      case "json.tryParse": {
        call.arity(1, 3);
        call.inferAt(0, stringType);
        const parsed = call.argumentAt(1) ? call.runtimeTypeAt(1) : unknownType;
        if (call.argumentAt(2)) {
          call.inferAt(2, parsed);
          return parsed;
        }
        return optionalOf(parsed);
      }
      case "json.stringify":
      case "json.stableStringify": {
        call.arity(1, 2);
        // D114 0.28.0 G-I1: the value position is judged against the type the
        // intrinsic declares for it, which is the `unknown` that accepts any
        // value. Reading it from the declaration is what keeps the position's
        // published contract and the position's own expectation one thing.
        const value = call.inferAt(0, intrinsic.parameters[0] ?? unknownType);
        const serializable = this.host.jsonSerializable(value);
        const argument = call.argumentAt(0);
        if (serializable === false && argument) {
          this.host.typeError(`JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(value)}`, argument.span);
        }
        call.inferAt(1, { kind: "union", members: [boolType, numberType] });
        return stringType;
      }
      case "json.clone": {
        call.arity(1, 2);
        const original = call.inferAt(0, intrinsic.parameters[0] ?? unknownType);
        const argument = call.argumentAt(0);
        if (this.host.jsonSerializable(original) === false && argument) {
          this.host.typeError(`JSON accepts only records, Lists, enums, primitives, and optionals; received ${describeType(original)}`, argument.span);
        }
        return call.argumentAt(1) ? call.runtimeTypeAt(1) : original;
      }
      case "runtime.parseAsync": {
        call.arity();
        const parsed = call.runtimeTypeAt(0);
        for (let index = 1; index < intrinsic.parameters.length; index += 1) {
          call.inferAt(index, intrinsic.parameters[index]);
        }
        this.host.reportPromiseResolutionHazard(parsed, call.argumentAt(0)?.span ?? callSpan);
        return { kind: "promise", value: parsed };
      }
      default:
        return null;
    }
  }

  /** The `velar/async` intrinsics: the combinators over Promises. */
  private inferAsyncIntrinsic(call: IntrinsicCall, intrinsic: Extract<ValueType, { kind: "intrinsic" }>, callSpan: Span): ValueType | null {
    switch (intrinsic.name) {
      case "async.all":
      case "async.race": {
        call.arity(1, 1);
        const argument = call.argumentAt(0);
        const input = call.inferAt(0);
        const unwrap = (source: ValueType): ValueType | null => {
          const expanded = this.host.expandAliases(source);
          if (expanded.kind === "promise") return expanded.value;
          if (expanded.kind === "any") return anyType;
          if (expanded.kind === "union") {
            const members = expanded.members.map(unwrap);
            return members.every((member): member is ValueType => member !== null) ? unionOf(members) : null;
          }
          return null;
        };
        if (intrinsic.name === "async.all" && (input.kind === "object" || input.kind === "record"
          || input.kind === "named" && this.host.fieldsOf(input.identity ?? input.name) !== null)) {
          if (input.kind === "record") {
            const resolved = unwrap(input.value);
            if (!resolved) this.host.typeError(`Promise.all requires every record field to be a Promise, received ${describeType(input)}`, argument?.span ?? callSpan);
            return { kind: "promise", value: { kind: "record", value: resolved ?? unknownType } };
          }
          const fields = input.kind === "object" ? input.fields : this.host.fieldsOf(input.identity ?? input.name) ?? new Map();
          const output = new Map<string, ValueType>();
          for (const [name, field] of fields) {
            const resolved = unwrap(field);
            if (!resolved) this.host.typeError(`Promise.all record field '${name}' must be a Promise, received ${describeType(field)}`, argument?.span ?? callSpan);
            output.set(name, resolved ?? unknownType);
          }
          return { kind: "promise", value: { kind: "object", fields: output } };
        }
        if (input.kind !== "list" && input.kind !== "any") {
          this.host.typeError(`Expected a List of Promises${intrinsic.name === "async.all" ? " or a record of Promises" : ""}, received ${describeType(input)}`, argument?.span ?? callSpan);
          return { kind: "promise", value: intrinsic.name === "async.all" ? { kind: "list", element: unknownType } : unknownType };
        }
        const value = input.kind === "list" ? input.element : anyType;
        const resolved = unwrap(value);
        if (!resolved) this.host.typeError(`Expected a List of Promises, received List<${describeType(value)}>`, argument?.span ?? callSpan);
        if (intrinsic.name === "async.all" && this.host.expandAliases(value).kind === "union") {
          this.host.typeError("Mixed result types need named fields; use Promise.all({name: loadName(), count: loadCount()})", argument?.span ?? callSpan);
        }
        const result = resolved ?? unknownType;
        if (intrinsic.name === "async.race") this.host.reportPromiseResolutionHazard(result, argument?.span ?? callSpan);
        return { kind: "promise", value: intrinsic.name === "async.all" ? { kind: "list", element: result } : result };
      }
      case "async.timeout": {
        call.arity(2, 3);
        const value = call.promiseValue(call.inferAt(0), 0);
        this.host.reportPromiseResolutionHazard(value, call.argumentAt(0)?.span ?? callSpan);
        call.inferAt(1, durationType);
        call.inferAt(2, stringType);
        return { kind: "promise", value };
      }
      case "async.retry": {
        call.arity(1, 3);
        const task = call.callbackAt(0, [], unknownType);
        call.inferAt(1, numberType);
        call.inferAt(2, durationType);
        const result = call.callbackResult(task);
        const resolved = result.kind === "promise" ? result.value : result;
        this.host.reportPromiseResolutionHazard(resolved, call.argumentAt(0)?.span ?? callSpan);
        return { kind: "promise", value: resolved };
      }
      case "async.map": {
        call.arity(2, 3);
        const element = call.arrayAt(0).element;
        const worker = call.callbackAt(1, [element], unknownType);
        call.inferAt(2, numberType);
        const result = call.callbackResult(worker);
        return { kind: "promise", value: { kind: "list", element: result.kind === "promise" ? result.value : result } };
      }
      case "async.series": {
        call.arity(1, 1);
        const task = call.arrayAt(0).element;
        if (task.kind !== "function" && task.kind !== "intrinsic" && task.kind !== "any") {
          this.host.typeError(`series expects a List of functions, received List<${describeType(task)}>`, call.argumentAt(0)?.span ?? callSpan);
        }
        const result = call.callbackResult(task);
        return { kind: "promise", value: { kind: "list", element: result.kind === "promise" ? result.value : result } };
      }
      default:
        return null;
    }
  }

  /** The remaining standard-module intrinsics, and the declared-signature default. */
  private inferOtherIntrinsic(call: IntrinsicCall, intrinsic: Extract<ValueType, { kind: "intrinsic" }>, callSpan: Span): ValueType {
    switch (intrinsic.name) {
      case "url.join": {
        call.arity(1, Number.POSITIVE_INFINITY);
        for (let index = 0; index < call.arguments_.length; index += 1) call.inferAt(index, stringType);
        return stringType;
      }
      case "math.min":
      case "math.max": {
        call.arity(1, Number.POSITIVE_INFINITY);
        for (let index = 0; index < call.arguments_.length; index += 1) call.inferAt(index, numberType);
        return numberType;
      }
      case "test.expect": {
        call.arity(1, 1);
        const actual = call.inferAt(0);
        const matched = this.host.expandAliases(actual);
        this.host.testExpectOperands.set(spanIdentity(callSpan), matched);
        const dynamic = matched.kind === "any" || matched.kind === "unknown";
        const fields = new Map<string, ValueType>([
          ["toBe", { kind: "function", parameterNames: ["expected"], parameters: [actual], requiredParameters: 1, result: nullType }],
          ["toEqual", { kind: "function", parameterNames: ["expected"], parameters: [actual], requiredParameters: 1, result: nullType }],
        ]);
        if (matched.kind === "bool" || dynamic) {
          fields.set("toBeTruthy", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
          fields.set("toBeFalsy", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
        }
        if (matched.kind === "list" || matched.kind === "string" || dynamic) {
          // D90 R17: an accept-anything parameter position is `unknown`, the
          // top type for assignment targets; `any` stays a value kind only.
          const contained = matched.kind === "list" ? matched.element : matched.kind === "string" ? stringType : unknownType;
          fields.set("toContain", { kind: "function", parameterNames: ["expected"], parameters: [contained], requiredParameters: 1, result: nullType });
          fields.set("toHaveLength", { kind: "function", parameterNames: ["length"], parameters: [numberType], requiredParameters: 1, result: nullType });
        }
        if (matched.kind === "string" || dynamic) {
          fields.set("toMatch", { kind: "function", parameterNames: ["expression"], parameters: [stringType], requiredParameters: 1, result: nullType });
        }
        const callable = matched.kind === "function" || matched.kind === "intrinsic" || matched.kind === "action";
        if (callable || dynamic) fields.set("toThrow", { kind: "function", parameters: [], requiredParameters: 0, result: nullType });
        if (matched.kind === "promise" || dynamic || (callable && matched.result.kind === "promise")) {
          fields.set("toReject", { kind: "function", parameters: [], requiredParameters: 0, result: { kind: "promise", value: nullType } });
        }
        return { kind: "object", fields };
      }
      default:
        this.host.checkArguments(call.arguments_, intrinsic.parameters, callSpan, intrinsic.requiredParameters, intrinsic.rest);
        return intrinsic.result;
    }
  }

  private inferRangeCall(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType {
    const hasNamed = argumentNames?.some((name) => name !== null) ?? false;
    if (!hasNamed) {
      if (arguments_.length < 1 || arguments_.length > 3) {
        this.host.typeError(`Expected 1-3 arguments but received ${arguments_.length}`, callSpan);
      }
      for (const argument of arguments_) {
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (argument.kind === "SpreadExpression") this.host.typeError("range does not accept a call spread", argument.span);
        this.host.requireAssignable(this.host.inferExpression(value, numberType), numberType, value.span);
      }
      return intrinsic.result;
    }

    const plan = this.namedArguments.planNamedArguments(
      arguments_,
      argumentNames,
      intrinsic.parameters,
      intrinsic.parameterNames,
      0,
      callSpan,
    );
    if (!plan) return intrinsic.result;
    for (const [source, target] of plan.targets.entries()) {
      const argument = arguments_[source]!;
      const value = argument.kind === "SpreadExpression" ? argument.value : argument;
      const expected = target === null ? unknownType : numberType;
      const actual = this.host.inferExpression(value, expected);
      if (target !== null) this.host.requireAssignable(actual, numberType, value.span);
    }
    if (!plan.valid) return intrinsic.result;

    const sources = Array<number>(3).fill(-1);
    for (const [source, target] of plan.targets.entries()) if (target !== null) sources[target] = source;
    const hasStart = sources[0] !== -1;
    const hasEnd = sources[1] !== -1;
    const hasStep = sources[2] !== -1;
    if (!hasEnd || (!hasStart && hasStep)) {
      this.host.typeError(
        "Named range calls use range(end = ...), range(start = ..., end = ...), or range(start = ..., end = ..., step = ...)",
        callSpan,
      );
      return intrinsic.result;
    }
    this.host.lowering.namedArgumentOrders.set(
      spanIdentity(callSpan),
      trimTrailingOmittedArguments(hasStart ? [sources[0]!, sources[1]!, sources[2]!] : [sources[1]!]),
    );
    return intrinsic.result;
  }

  // D47 rule 81: equals(a, b) is deep structural comparison over data, so the
  // call site enforces the data domain — class instances compare by identity
  // ('=='), functions and Promises have no structural content, unknown/any
  // must be validated first — and the two operands must intersect, D42's own
  // constant-comparison principle.
  private inferEqualsCall(
    intrinsic: Extract<ValueType, { kind: "intrinsic" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType {
    const plan = this.namedArguments.planNamedArguments(
      sourceArguments,
      argumentNames,
      intrinsic.parameters,
      intrinsic.parameterNames,
      intrinsic.requiredParameters,
      callSpan,
    );
    const operands: { type: ValueType; span: Span }[] = [];
    if (plan) {
      for (const [source, target] of plan.targets.entries()) {
        const argument = sourceArguments[source]!;
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (argument.kind === "SpreadExpression") this.host.typeError("equals does not accept a call spread", argument.span);
        const type = this.host.inferExpression(value, intrinsic.parameters[target ?? 0] ?? unknownType);
        if (target === 0 || target === 1) operands[target] = { type, span: value.span };
      }
      if (!plan.valid) return intrinsic.result;
      this.host.lowering.namedArgumentOrders.set(spanIdentity(callSpan), trimTrailingOmittedArguments(
        [0, 1].map((target) => {
          for (const [source, mapped] of plan.targets.entries()) if (mapped === target) return source;
          return -1;
        }),
      ));
    } else {
      if (sourceArguments.length !== 2) {
        this.host.typeError(`Expected 2 arguments but received ${sourceArguments.length}`, callSpan);
      }
      for (const argument of sourceArguments) {
        const value = argument.kind === "SpreadExpression" ? argument.value : argument;
        if (argument.kind === "SpreadExpression") this.host.typeError("equals does not accept a call spread", argument.span);
        const type = this.host.inferExpression(value, intrinsic.parameters[0] ?? unknownType);
        if (operands.length < 2) operands.push({ type, span: value.span });
      }
      if (sourceArguments.length !== 2) return intrinsic.result;
    }
    let violated = false;
    for (const operand of operands) {
      if (!operand) continue;
      const violation = this.host.equalsDomainViolation(operand.type);
      if (violation) {
        this.host.typeError(`equals compares data structurally, and ${violation}`, operand.span);
        violated = true;
      }
    }
    if (!violated && operands[0] && operands[1] && !this.host.equalityTypesIntersect(operands[0].type, operands[1].type)) {
      this.host.typeError(
        this.host.typesIntersect(operands[0].type, operands[1].type, false)
          ? `${describeType(operands[0].type)} and ${describeType(operands[1].type)} can meet only where an enum member matches a raw ${this.host.enumMeetDomain(operands[0].type, operands[1].type)},`
            + ` and the enum and ${this.host.enumMeetDomain(operands[0].type, operands[1].type)} domains never meet in equals${this.host.equalityGuidance(operands[0].type, operands[1].type)}`
          : `${describeType(operands[0].type)} and ${describeType(operands[1].type)} have no values in common, so equals(a, b) is always false${this.host.equalityGuidance(operands[0].type, operands[1].type)}`,
        callSpan,
      );
    }
    this.host.lowering.equalsCalls.add(spanIdentity(callSpan));
    return intrinsic.result;
  }
}
