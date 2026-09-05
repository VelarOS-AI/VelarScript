/**
 * The collection half of inference: what a List, Map, Set or Record publishes
 * as its members, what one call of a member means, and the migration off the
 * `velar/collections` module those members replaced.
 *
 * D114 R1b: this was `inferCollectionCall` (721 lines), the four member
 * resolvers, the operation rosters and the retirement machinery, spread through
 * `Analyzer`. They are one cohesive thing — the compiler-owned collection
 * vocabulary and its checking — so they live in one collaborator the analyzer
 * owns as `this.collections`. What the collaborator needs back from the
 * analyzer is declared as `CollectionInferenceHost` (`./call.ts`): that
 * interface is the exact record of this cluster's dependency on the analyzer,
 * and nothing widens it silently.
 *
 * `inferCollectionCall` is a prologue and four per-kind dispatchers, and the
 * List dispatcher is five operation families. The order the original evaluated
 * its cases in is the order they are tried in, and each family answers `null`
 * for a property it does not own, so a call reaches exactly the case it reached
 * before. Everything the families share — the resolved arguments, the read-only
 * views of the receiver's element/key/value, and the argument helpers — is one
 * per-call `CollectionCall` object built once by the prologue.
 *
 * D115 §三: this file is the facade of the directory. The families themselves
 * live in `./list.ts`, `./map.ts`, `./set.ts` and `./record.ts`, the member
 * resolvers in `./members.ts`, the rosters in `./operations.ts`, and the
 * retirement in `./retired.ts`; each declares the narrow host it needs. The
 * four member resolvers keep their place in this class's surface because the
 * analyzer, member access and the surface-version gate all call them by name.
 */
import { type ArrowFunctionExpression, type Expression } from "../../ast.ts";
import { type Span } from "../../source.ts";
import {
  describeType,
  invalidType,
  nonOptional,
  numberType,
  unknownType,
  type ValueType,
} from "../../types.ts";
import {
  CollectionCall,
  type AnsweredCollectionCall,
  type CallableValueType,
  type CollectionInferenceHost,
  type CollectionReceiverType,
  type CollectionReceiverViews,
  type ResolvedCollectionArguments,
} from "./call.ts";
import { ListCalls } from "./list.ts";
import { MapCalls } from "./map.ts";
import { CollectionMembers } from "./members.ts";
import {
  CORE_LIST_METHOD_NAMES,
  CORE_MAP_METHOD_NAMES,
  CORE_RECORD_METHOD_NAMES,
  CORE_SET_METHOD_NAMES,
  mutatingCollectionMethods,
} from "./operations.ts";
import { RecordCalls } from "./record.ts";
import { RetiredCollectionMigration } from "./retired.ts";
import { SetCalls } from "./set.ts";

export class CollectionInference {

  private readonly host: CollectionInferenceHost;

  /** The migration off `velar/collections`, whose members this cluster owns. */
  readonly retired: RetiredCollectionMigration;

  /** The five files this facade dispatches to, each holding the same host. */
  private readonly members: CollectionMembers;
  private readonly listCalls: ListCalls;
  private readonly mapCalls: MapCalls;
  private readonly setCalls: SetCalls;
  private readonly recordCalls: RecordCalls;

  constructor(host: CollectionInferenceHost) {
    this.host = host;
    this.retired = new RetiredCollectionMigration(host);
    this.members = new CollectionMembers(host);
    this.listCalls = new ListCalls(host);
    this.mapCalls = new MapCalls(host);
    this.setCalls = new SetCalls(host);
    this.recordCalls = new RecordCalls(host);
  }


  /**
   * One call of a compiler-owned collection member. The prologue resolves the
   * receiver, refuses a mutation through a read-only view, publishes the
   * member's contract and settles the arguments; the receiver's kind then
   * selects the family that types the operation. Every step runs in the order
   * it ran when this was one method, because each one writes diagnostics or
   * lowering the next may read.
   */
  inferCollectionCall(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | null {
    const object = this.host.expandAliases(this.host.inferredOrAnalyze(member.object));
    if (object.kind !== "list" && object.kind !== "map" && object.kind !== "set" && object.kind !== "record") return null;
    const mutating = mutatingCollectionMethods(object.kind);
    if (object.readonlyView && mutating.has(member.property)) {
      for (const argument of sourceArguments) this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument);
      this.host.typeError(`Cannot call mutating method '${member.property}' through ${describeType(object)}; it is a read-only view`, member.span);
      return invalidType;
    }
    const views = this.receiverViews(object);
    this.host.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, nonOptional(object));
    const memberType = object.kind === "list" ? this.listMember(object, member.property)
      : object.kind === "map" ? this.mapMember(object, member.property)
        : object.kind === "set" ? this.setMember(object, member.property)
          : object.kind === "record" ? this.recordMember(object, member.property)
          : unknownType;
    this.host.recordSemanticExpression(member, memberType ?? unknownType);
    const resolved = this.resolveArguments(member, object, sourceArguments, argumentNames, callSpan, memberType, views.readonlyElement);
    if ("answer" in resolved) return resolved.answer;
    const call = new CollectionCall(this.host, member, sourceArguments, argumentNames, callSpan, views, resolved);
    const lowered = object.kind === "list"
      ? (CORE_LIST_METHOD_NAMES as readonly string[]).includes(member.property)
      : object.kind === "map" ? (CORE_MAP_METHOD_NAMES as readonly string[]).includes(member.property)
        : object.kind === "set" ? (CORE_SET_METHOD_NAMES as readonly string[]).includes(member.property)
          : object.kind === "record" ? (CORE_RECORD_METHOD_NAMES as readonly string[]).includes(member.property) : false;
    if (lowered && call.arguments_.some((argument) => argument.kind === "SpreadExpression")) {
      this.host.typeError(`Spread arguments are not supported by ${describeType(object)}.${member.property}`, callSpan);
    }
    if (object.kind === "list") return this.listCalls.inferListCall(call, object);
    if (object.kind === "map") return this.mapCalls.inferMapCall(call, object);
    if (object.kind === "record") return this.recordCalls.inferRecordCall(call, object);
    return this.setCalls.inferSetCall(call, object);
  }

  /** The read-only and comparison views of the receiver's element, key and value. */
  private receiverViews(object: CollectionReceiverType): CollectionReceiverViews {
    return {
      readonlyElement: (object.kind === "list" || object.kind === "set") && object.readonlyView
        ? this.host.readonlyDataViewOf(object.element)
        : object.kind === "list" || object.kind === "set" ? object.element : null,
      comparisonElement: object.kind === "list" || object.kind === "set" ? this.host.readonlyDataViewOf(object.element) : null,
      readonlyKey: object.kind === "map" && object.readonlyView ? this.host.readonlyDataViewOf(object.key) : object.kind === "map" ? object.key : null,
      comparisonKey: object.kind === "map" ? this.host.readonlyDataViewOf(object.key) : null,
      readonlyValue: (object.kind === "map" || object.kind === "record") && object.readonlyView
        ? this.host.readonlyDataViewOf(object.value)
        : object.kind === "map" || object.kind === "record" ? object.value : null,
    };
  }

  /**
   * The arguments the operation families see. A named-argument call is planned
   * against the member's published parameter names and every argument is
   * inferred here, before any family runs; a positional call is passed through
   * untouched. A plan that did not resolve answers the whole call.
   */
  private resolveArguments(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    object: CollectionReceiverType,
    sourceArguments: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
    memberType: ValueType | null,
    readonlyElement: ValueType | null,
  ): ResolvedCollectionArguments | AnsweredCollectionCall {
    const callableMember: CallableValueType | null = memberType
      && (memberType.kind === "function" || memberType.kind === "action" || memberType.kind === "intrinsic")
      ? memberType
      : null;
    const named = callableMember
      ? this.host.planNamedArguments(
        sourceArguments,
        argumentNames,
        callableMember.parameters,
        callableMember.parameterNames,
        callableMember.requiredParameters,
        callSpan,
        callableMember.rest,
      )
      : null;
    if (!named) return { arguments_: sourceArguments, namedPreanalyzed: false };
    const inferSource = (contextForTarget: (target: number) => ValueType): void => {
      for (const [source, target] of named.targets.entries()) {
        const argument = sourceArguments[source]!;
        this.host.inferExpression(argument.kind === "SpreadExpression" ? argument.value : argument, target === null ? unknownType : contextForTarget(target));
      }
    };
    if (!named.valid) {
      // A plan that did not resolve cannot solve a published type parameter
      // either — `reduce`'s accumulator is the only one — so the arguments
      // are inferred without a contextual type and the call answers
      // `unknown` rather than leaking the parameter into the program.
      const open = (callableMember!.typeParameterNames?.length ?? 0) > 0;
      inferSource((target) => open ? unknownType : callableMember!.parameters[target] ?? unknownType);
      return { answer: open ? unknownType : callableMember!.result };
    }
    if (object.kind === "list" && member.property === "reduce") {
      let initial = unknownType;
      let deferred: ArrowFunctionExpression | null = null;
      for (const [source, target] of named.targets.entries()) {
        const argument = sourceArguments[source]!;
        if (target === 0 && argument.kind === "ArrowFunctionExpression") deferred = argument;
        else if (target === 1) initial = this.host.inferExpression(argument);
        else this.host.inferExpression(argument);
      }
      if (deferred) {
        this.host.inferExpression(deferred, {
          kind: "function",
          parameters: [initial, readonlyElement!, numberType],
          requiredParameters: 3,
          result: initial,
        });
      }
    } else {
      inferSource((target) => callableMember!.parameters[target] ?? unknownType);
    }
    return { arguments_: named.ordered, namedPreanalyzed: true };
  }

  /**
   * What a List publishes under `property`, or null when it publishes nothing
   * under that name — and the same question for a Map, a Set and a Record.
   * They stay on this class's surface because member access, completion and
   * the surface-version gate reach them through `analyzer.collections`.
   */
  listMember(list: Extract<ValueType, { kind: "list" }>, property: string): ValueType | null {
    return this.members.listMember(list, property);
  }

  mapMember(map: Extract<ValueType, { kind: "map" }>, property: string): ValueType | null {
    return this.members.mapMember(map, property);
  }

  recordMember(record: Extract<ValueType, { kind: "record" }>, property: string): ValueType | null {
    return this.members.recordMember(record, property);
  }

  setMember(set: Extract<ValueType, { kind: "set" }>, property: string): ValueType | null {
    return this.members.setMember(set, property);
  }
}
