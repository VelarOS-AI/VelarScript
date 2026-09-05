/**
 * Member access: what `value.property` means. The receiver's kind selects the
 * rule — a class instance, a record, a collection, a string or number, an enum,
 * a namespace, a Promise — and the checked value methods a primitive publishes
 * are typed here beside the accesses that reach them.
 *
 * D114 R1b: this was `inferMember` (376 lines), `inferPrimitiveCall` and the
 * string/number member tables, spread through `Analyzer`. They are one cohesive
 * thing — the answer to "what does this receiver publish under this name" — so
 * they live in one collaborator the analyzer owns as `this.members`. What the
 * collaborator needs back from the analyzer is declared as `MemberAccessHost`:
 * that interface is the exact record of this cluster's dependency on the
 * analyzer, and nothing widens it silently.
 *
 * The analyzer's live walk state a member access reads — the class under
 * analysis, the `super` context, the static-initialization frame, the function
 * and constructor depths — arrives through getters, so the reads stay live
 * rather than freezing at construction.
 *
 * The retired-namespace migration (`retiredNamespaces`, `retiredNamespaceUses`)
 * is not here: its other half reads a *bare identifier*, in
 * `inferExpressionType`, so the rule is not member-only and both halves stay
 * where the one migration is assembled.
 */
import { type Expression } from "../ast.ts";
import {
  type ClassField,
  type ClassInfo,
  type CollectionOperation,
  type CompilerAnalysisExtension,
  type CollectionRuntimeKind,
  type PrimitiveOperation,
  type RuntimeNarrowingGuard,
} from "../contracts.ts";
import { mechanicalFix, type DiagnosticFix } from "../diagnostic.ts";
import { collectionMemberGuidance, stringMemberGuidance, type CollectionKind } from "../language-guidance.ts";
import { span, spanIdentity, type Span } from "../source.ts";
import {
  anyType,
  binaryStorageKind,
  boolType,
  describeType,
  invalidType,
  isInvalidType,
  isReadonlyView,
  nonOptional,
  numberType,
  optionalOf,
  sameType,
  stringType,
  unionOf,
  unknownType,
  type BinaryStorageKind,
  type ValueType,
} from "../types.ts";
import {
  listCollectionOperations,
  mapCollectionOperations,
  recordCollectionOperations,
  setCollectionOperations,
} from "./collections/operations.ts";
import { type CollectionInference } from "./collections/inference.ts";


export const stringPrimitiveOperations = new Map<string, PrimitiveOperation>([
  ["trim", "stringTrim"], ["upper", "stringUpper"], ["lower", "stringLower"], ["slice", "stringSlice"],
  ["char", "stringChar"], ["has", "stringHas"], ["index", "stringIndex"], ["count", "stringCount"], ["startsWith", "stringStartsWith"], ["endsWith", "stringEndsWith"],
  ["split", "stringSplit"], ["replace", "stringReplace"], ["replaceAll", "stringReplaceAll"],
  ["padStart", "stringPadStart"], ["padEnd", "stringPadEnd"], ["repeat", "stringRepeat"], ["isBlank", "stringIsBlank"],
]);
export const numberPrimitiveOperations = new Map<string, PrimitiveOperation>([
  ["abs", "numberAbs"], ["round", "numberRound"], ["floor", "numberFloor"], ["ceil", "numberCeil"], ["sign", "numberSign"], ["trunc", "numberTrunc"], ["toFixed", "numberToFixed"],
  ["isInteger", "numberIsInteger"], ["isNaN", "numberIsNaN"], ["isFinite", "numberIsFinite"],
]);

// D29 item 14, the primitive half: the string and number methods that answer a
// fresh value without touching their receiver. See
// `discardedPureCollectionOperations` in `./collections/operations.ts` for the
// rule both rosters serve.
export const discardedPurePrimitiveOperations = new Set<PrimitiveOperation>([
  "stringTrim", "stringUpper", "stringLower", "stringSlice", "stringChar",
  "stringStartsWith", "stringEndsWith", "stringReplace", "stringReplaceAll",
  "stringPadStart", "stringPadEnd", "stringRepeat", "stringSplit", "stringIsBlank",
  "numberAbs", "numberRound", "numberFloor", "numberCeil", "numberSign", "numberTrunc", "numberToFixed",
  "numberIsInteger", "numberIsNaN", "numberIsFinite",
]);

/**
 * The lowering side tables one member access writes. `LoweringRecorder`
 * satisfies this; naming only what is written keeps its other tables out of
 * this cluster's dependency face.
 */
interface MemberLoweringFacts {
  readonly primitiveCalls: Map<number, PrimitiveOperation>;
  readonly collectionCalls: Map<number, CollectionOperation>;
  readonly collectionSizes: Map<number, CollectionRuntimeKind>;
  readonly binaryCalls: Map<number, "bufferCopy" | "bufferSlice" | "bufferToBytes" | "bufferValues">;
  readonly binarySizes: Map<number, BinaryStorageKind>;
  readonly stringSizes: Set<number>;
  readonly optionalMembers: Set<string>;
  readonly privateMembers: Set<string>;
  readonly runtimeTypeObjectNames: Set<string>;
  readonly classMethodReferences: Set<string>;
  readonly errorCodeReads: Set<string>;
  readonly instanceFieldReads: Set<string>;
  readonly privateInstanceFieldReads: Set<string>;
  readonly staticFieldReads: Map<string, number>;
  readonly runtimeNarrowings: Map<string, RuntimeNarrowingGuard>;
}

/**
 * Everything the member cluster asks of the analyzer that hosts it, and nothing
 * more.
 */
export interface MemberAccessHost {
  aliasedEnumTarget(name: string): { readonly name: string; readonly identity: string; readonly members: ReadonlySet<string> } | null;
  readonly analysisExtensions: readonly CompilerAnalysisExtension[];
  readonly asynchronousFunctions: boolean[];
  boundaryValidationGuidance(expression: Expression | null, property: string | null): string;
  readonly callExpressionCallees: Set<string>;
  checkArguments(arguments_: readonly Expression[], parameters: readonly ValueType[], callSpan: Span, requiredParameters?: number, rest?: ValueType, argumentNames?: readonly (string | null)[], parameterNames?: readonly string[]): void;
  classInfo(key: string): ClassInfo | undefined;
  readonly classes: Map<string, ClassInfo>;
  readonly collections: CollectionInference;
  conditionSubjectText(condition: Expression): string | null;
  readonly constructorDepth: number;
  readonly currentClass: string | null;
  declaresPrivateMember(className: string, name: string, staticMember: boolean): boolean;
  discriminatedDataField(original: ValueType, property: string): ValueType | null;
  displayExternalClasses(type: ValueType): ValueType;
  enumRuntimeMember(name: string, identity: string, members: ReadonlySet<string>, property: string): ValueType | null;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  findField(className: string, name: string): ClassField | null;
  findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findStaticField(className: string, name: string): ClassField | null;
  findStaticFieldOwner(className: string, name: string): { readonly field: ClassField; readonly depth: number } | null;
  findStaticGetter(className: string, name: string): ValueType | null;
  findStaticMethod(className: string, name: string): ValueType | null;
  readonly functionDepth: number;
  getterAccessProperty(expression: Expression): string | null;
  inferredOrAnalyze(expression: Expression): ValueType;
  readonly invalidDeclaredTypes: Set<string>;
  isSubclassOf(actual: string, expected: string): boolean;
  /** The binding a name resolves to; a member access reads only the type it holds. */
  lookup(name: string): { readonly type: ValueType } | null;
  lookupMemberNarrowing(path: string): ValueType | null;
  readonly lowering: MemberLoweringFacts;
  readonly memberAccessReceivers: Set<string>;
  privateFieldForAccess(className: string, name: string, staticMember: boolean): ClassField | null;
  readonly privateGetters: Map<string, Set<string>>;
  privateMethodForAccess(className: string, name: string, staticMember: boolean): ValueType | null;
  readonly privateStaticFields: Map<string, Map<string, ClassField>>;
  readonly promiseInitializerBindings: WeakSet<object>;
  readonlyDataViewOf(type: ValueType): ValueType;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  recordSemanticExpression(expression: Expression, type: ValueType): void;
  recoveredTypeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  runtimeTypeObjectValue(type: Extract<ValueType, { kind: "typeObject" }>): ValueType;
  readonly semanticExpressionOwners: Map<string, ValueType>;
  semanticMembersOf(original: ValueType): ReadonlyMap<string, ValueType>;
  stableMemberAccessPath(expression: Expression): string | null;
  readonly staticFieldInitialization: { readonly className: string; readonly initialized: ReadonlySet<string> } | null;
  readonly superMemberContext: "instance" | "static" | null;
  readonly testExpectOperands: Map<string, ValueType>;
  typeError(message: string, errorSpan: Span, fix?: DiagnosticFix): void;
  /**
   * The one visible name close enough to be offered as a correction, or null.
   * The roster and the distance threshold are one decision the analyzer owns,
   * so a member report and a field report can never disagree about them.
   */
  uniqueNearestName(requested: string, candidates: Iterable<string>): string | null;
}

export class MemberAccess {
  private readonly host: MemberAccessHost;

  /** The property each member access asks for, keyed by the receiver's span. */
  readonly memberAccessProperties = new Map<string, { readonly property: string; readonly end: number }>();

  constructor(host: MemberAccessHost) {
    this.host = host;
  }


  inferPrimitiveCall(
    member: Extract<Expression, { kind: "MemberExpression" }>,
    arguments_: readonly Expression[],
    argumentNames: readonly (string | null)[] | undefined,
    callSpan: Span,
  ): ValueType | null {
    const object = this.host.inferredOrAnalyze(member.object);
    if (object.kind !== "string" && object.kind !== "number") return null;
    const memberType = object.kind === "string" ? this.stringMember(member.property) : this.numberMember(member.property);
    if (!memberType || memberType.kind !== "function") return null;
    this.host.semanticExpressionOwners.set(`${member.span.start}:${member.span.end}`, object);
    this.host.recordSemanticExpression(member, memberType);
    const operation = object.kind === "string"
      ? stringPrimitiveOperations.get(member.property)
      : numberPrimitiveOperations.get(member.property);
    if (operation) this.host.lowering.primitiveCalls.set(member.span.end, operation);
    this.host.checkArguments(
      arguments_,
      memberType.parameters,
      callSpan,
      memberType.requiredParameters,
      memberType.rest,
      argumentNames,
      memberType.parameterNames,
    );
    return memberType.result;
  }


  inferMember(
    objectExpression: Expression,
    property: string,
    optional: boolean,
    memberSpan: Span,
    useNarrowing = true,
    readValue = true,
  ): ValueType {
    if (objectExpression.kind === "SuperExpression") return this.inferSuperMember(objectExpression, property, optional, memberSpan, readValue);
    // A member access is a sanctioned class-name position (D45 rule 75).
    this.host.memberAccessReceivers.add(spanIdentity(objectExpression.span));
    this.memberAccessProperties.set(spanIdentity(objectExpression.span), { property, end: memberSpan.end });
    const original = this.host.inferredOrAnalyze(objectExpression);
    this.host.semanticExpressionOwners.set(`${memberSpan.start}:${memberSpan.end}`, nonOptional(original));
    const resolvedOriginal = this.host.expandAliases(original);
    const object = nonOptional(resolvedOriginal);
    const binaryKind = binaryStorageKind(object);
    if (binaryKind && property === "size") this.host.lowering.binarySizes.set(memberSpan.end, binaryKind);
    if (binaryKind && binaryKind !== "bytes") {
      if (property === "copy") this.host.lowering.binaryCalls.set(memberSpan.end, "bufferCopy");
      if (property === "slice") this.host.lowering.binaryCalls.set(memberSpan.end, "bufferSlice");
      if (property === "toBytes") this.host.lowering.binaryCalls.set(memberSpan.end, "bufferToBytes");
      if (property === "values") this.host.lowering.binaryCalls.set(memberSpan.end, "bufferValues");
    }
    const guardedCollectionOperation = object.kind === "list"
      ? listCollectionOperations.get(property) ?? null
      : object.kind === "map"
        ? mapCollectionOperations.get(property) ?? null
      : object.kind === "set"
          ? setCollectionOperations.get(property) ?? null
          : object.kind === "record"
            ? recordCollectionOperations.get(property) ?? null
          : null;
    if (guardedCollectionOperation) {
      this.host.lowering.collectionCalls.set(memberSpan.end, guardedCollectionOperation);
    }
    const guardedPrimitiveOperation = object.kind === "string"
      ? stringPrimitiveOperations.get(property) ?? null
      : object.kind === "number"
        ? numberPrimitiveOperations.get(property) ?? null
        : null;
    if (guardedPrimitiveOperation) this.host.lowering.primitiveCalls.set(memberSpan.end, guardedPrimitiveOperation);
    const basePath = this.host.stableMemberAccessPath(objectExpression);
    const narrowedMember = basePath ? this.host.lookupMemberNarrowing(`${basePath}.${property}`) : null;
    let result = this.receiverMember(objectExpression, object, property, memberSpan, readValue);

    if (isReadonlyView(object) && result.kind !== "unknown" && result.kind !== "any") {
      result = this.host.readonlyDataViewOf(result);
    }
    result = this.host.displayExternalClasses(result);
    if (useNarrowing && narrowedMember) {
      result = narrowedMember;
      this.host.lowering.runtimeNarrowings.set(spanIdentity(memberSpan), {
        expected: narrowedMember,
        description: `.${property}`,
      });
    }

    if (optional) {
      const finalType = resolvedOriginal.kind === "optional" || resolvedOriginal.kind === "null" ? optionalOf(result) : result;
      if (finalType.kind === "optional") this.host.lowering.optionalMembers.add(spanIdentity(memberSpan));
      return finalType;
    }
    if (resolvedOriginal.kind === "optional") {
      // FLW-S2: '?.' on a getter would compute it a second time, so the
      // receiver decides which of the two fixes is the honest one.
      const getter = this.host.getterAccessProperty(objectExpression);
      const text = getter ? this.host.conditionSubjectText(objectExpression) : null;
      this.host.typeError(getter
        ? `'${getter}' is a getter, so '?.' would compute it a second time`
          + `; bind it once with 'const ${getter} = ${text ?? `...${getter}`}' and read that name instead`
        : `Use optional access '?.' for ${describeType(original)}`, memberSpan);
    }
    if (result.kind === "optional") this.host.lowering.optionalMembers.add(spanIdentity(memberSpan));
    return result;
  }

  /**
   * `super.member`: the base declaration a derived member reads through, with
   * `super` bound at the reference site rather than through a receiver
   * temporary (D44 rule 74).
   */
  private inferSuperMember(objectExpression: Expression, property: string, optional: boolean, memberSpan: Span, readValue: boolean): ValueType {
    if (optional) this.host.typeError("Optional access is not valid on 'super'", memberSpan);
    const base = this.host.currentClass ? this.host.classInfo(this.host.currentClass)?.base ?? null : null;
    if (!base || !this.host.superMemberContext) {
      this.host.typeError("'super' member access is only available directly inside a derived constructor, method, getter, field initializer, or nested arrow", objectExpression.span);
      return unknownType;
    }
    const staticMember = this.host.superMemberContext === "static";
    const method = staticMember ? this.host.findStaticMethod(base, property) : this.host.findMethod(base, property);
    const methodType = staticMember ? method as ValueType | null : (method as { readonly type: ValueType } | null)?.type ?? null;
    const getter = staticMember ? this.host.findStaticGetter(base, property) : this.host.findGetter(base, property);
    const getterType = staticMember ? getter as ValueType | null : (getter as { readonly type: ValueType } | null)?.type ?? null;
    const field = staticMember ? this.host.findStaticField(base, property) : null;
    if (!method && !getter && !field) {
      this.host.typeError(`Base class '${base}' has no ${staticMember ? "static " : ""}method${staticMember ? ", getter, or field" : " or getter"} '${property}'`, memberSpan);
      return unknownType;
    }
    this.host.semanticExpressionOwners.set(
      `${memberSpan.start}:${memberSpan.end}`,
      staticMember ? { kind: "classConstructor", name: base } : { kind: "class", name: base },
    );
    // D44 rule 74: reading a base method as a value binds at the reference
    // site. `super` cannot be captured by a receiver temporary, so the
    // emitter binds it to `this` directly.
    if (method && !getter && !field && readValue
      && !this.host.callExpressionCallees.has(spanIdentity(memberSpan))) {
      this.host.lowering.classMethodReferences.add(spanIdentity(memberSpan));
    }
    return methodType ?? getterType ?? field!.type;
  }

  /**
   * What the receiver publishes under `property`, by the receiver's kind. The
   * families own disjoint kinds and are reached by the discriminant the one
   * `else if` chain tested in this order, so a receiver reaches the branch it
   * reached before.
   */
  private receiverMember(
    objectExpression: Expression,
    object: ValueType,
    property: string,
    memberSpan: Span,
    readValue: boolean,
  ): ValueType {
    switch (object.kind) {
      case "any": case "unknown": case "string": case "number":
      case "list": case "set": case "map": case "record":
        return this.primitiveMember(objectExpression, object, property, memberSpan, readValue);
      case "promise": case "action": case "union": case "object": case "extension": case "named":
        return this.structuralMember(objectExpression, object, property, memberSpan, readValue);
      case "class": case "classConstructor":
        return this.classMember(objectExpression, object, property, memberSpan, readValue);
      default:
        return this.declaredValueMember(objectExpression, object, property, memberSpan, readValue);
    }
  }

  /** The primitives and the collections: every receiver with a compiler-owned member roster. */
  private primitiveMember(
    objectExpression: Expression,
    object: ValueType,
    property: string,
    memberSpan: Span,
    readValue: boolean,
  ): ValueType {
    let result: ValueType = unknownType;
    if (object.kind === "any") {
      result = anyType;
    } else if (object.kind === "unknown") {
      if (isInvalidType(object)) result = invalidType;
      else this.host.typeError(`Cannot access '${property}' on unknown without validation${this.host.boundaryValidationGuidance(objectExpression, property)}`, memberSpan);
    } else if (object.kind === "string") {
      result = this.stringMember(property) ?? unknownType;
      if (property === "size") this.host.lowering.stringSizes.add(memberSpan.end);
      if (result.kind === "unknown") this.host.typeError(stringMemberGuidance(property) ?? `${describeType(object)} has no member '${property}'`, memberSpan);
    } else if (object.kind === "number") {
      result = this.numberMember(property) ?? unknownType;
      if (result.kind === "unknown") {
        this.host.typeError(property === "toString"
          ? "Use 'str(value)' or an f-string; VelarScript has one explicit text conversion spelling"
          : `${describeType(object)} has no member '${property}'`, memberSpan);
      }
    } else if (object.kind === "list") {
      result = this.host.collections.listMember(object, property) ?? unknownType;
      if (property === "size") this.host.lowering.collectionSizes.set(memberSpan.end, "list");
      if (result.kind === "unknown") {
        const guidance = collectionMemberGuidance("List", property);
        const recovered = guidance?.replacement ? this.host.collections.listMember(object, guidance.replacement) : null;
        const nearest = guidance ? null : this.host.uniqueNearestName(property, this.host.semanticMembersOf(object).keys());
        const message = `${this.collectionMemberError("List", property)}${nearest ? `; did you mean '${nearest}'?` : ""}`;
        if (recovered) {
          this.host.recoveredTypeError(message, memberSpan, this.collectionMemberFix("List", property, memberSpan));
          result = recovered;
        } else this.host.typeError(message, memberSpan, this.collectionMemberFix("List", property, memberSpan));
      }
    } else if (object.kind === "set") {
      result = this.host.collections.setMember(object, property) ?? unknownType;
      if (property === "size") this.host.lowering.collectionSizes.set(memberSpan.end, "set");
      if (result.kind === "unknown") {
        const nearest = collectionMemberGuidance("Set", property) ? null : this.host.uniqueNearestName(property, this.host.semanticMembersOf(object).keys());
        this.host.typeError(`${this.collectionMemberError("Set", property)}${nearest ? `; did you mean '${nearest}'?` : ""}`, memberSpan, this.collectionMemberFix("Set", property, memberSpan));
      }
    } else if (object.kind === "map") {
      result = this.host.collections.mapMember(object, property) ?? unknownType;
      if (property === "size") this.host.lowering.collectionSizes.set(memberSpan.end, "map");
      if (result.kind === "unknown") {
        const nearest = collectionMemberGuidance("Map", property) ? null : this.host.uniqueNearestName(property, this.host.semanticMembersOf(object).keys());
        this.host.typeError(`${this.collectionMemberError("Map", property)}${nearest ? `; did you mean '${nearest}'?` : ""}`, memberSpan, this.collectionMemberFix("Map", property, memberSpan));
      }
    } else if (object.kind === "record") {
      result = this.host.collections.recordMember(object, property) ?? unknownType;
      if (property === "size") this.host.lowering.collectionSizes.set(memberSpan.end, "record");
      if (result.kind === "unknown") this.host.typeError(`Record fields are dynamic; use ${describeType(object)}[${JSON.stringify(property)}]`, memberSpan);
    }
    return result;
  }

  /** The structural receivers: a Promise, an action, a union, a record shape, an extension host type, a named record. */
  private structuralMember(
    objectExpression: Expression,
    object: ValueType,
    property: string,
    memberSpan: Span,
    readValue: boolean,
  ): ValueType {
    let result: ValueType = unknownType;
    if (object.kind === "promise") {
      const awaited = this.host.expandAliases(object.value);
      const memberAfterAwait = this.host.semanticMembersOf(awaited).get(property);
      const receiverName = objectExpression.kind === "IdentifierExpression" ? objectExpression.name : null;
      const binding = receiverName ? this.host.lookup(receiverName) : null;
      const canAwait = this.host.functionDepth === 0 || this.host.asynchronousFunctions.at(-1) === true;
      if (memberAfterAwait && receiverName && binding && this.host.promiseInitializerBindings.has(binding) && canAwait) {
        this.host.typeError(
          `${describeType(object)} has no member '${property}'; add 'await' at the initializer — 'const ${receiverName} = await ...' — then read '${receiverName}.${property}'`,
          memberSpan,
        );
      } else {
        this.host.typeError(`${describeType(object)} has no member '${property}'`, memberSpan);
      }
      result = invalidType;
    } else if (object.kind === "action") {
      if (property === "pending") result = boolType;
      else if (property === "error") result = optionalOf({ kind: "class", name: "Error" });
      else this.host.typeError(`Action has no member '${property}'`, memberSpan);
    } else if (object.kind === "union") {
      const candidates = object.members.map((member) => this.host.discriminatedDataField(member, property));
      if (candidates.every((candidate): candidate is ValueType => candidate !== null)) {
        if (!readValue && !candidates.every((candidate) => sameType(candidate, candidates[0]!))) {
          this.host.typeError(
            `Cannot assign field '${property}' through ${describeType(object)} because its variants require different field types; narrow the owner first`,
            memberSpan,
          );
          result = invalidType;
        } else {
          result = readValue ? unionOf(candidates) : candidates[0]!;
        }
      } else {
        this.host.typeError(`${describeType(object)} has no common field '${property}'`, memberSpan);
      }
    } else if (object.kind === "object") {
      result = object.fields.get(property) ?? unknownType;
      if (object.optionalFields?.has(property) && result.kind !== "unknown") result = optionalOf(result);
      if (object.readonlyFields?.has(property) && result.kind !== "unknown") result = this.host.readonlyDataViewOf(result);
      if (!object.fields.has(property)) {
        const expectOperand = objectExpression.kind === "CallExpression"
          ? this.host.testExpectOperands.get(spanIdentity(objectExpression.span))
          : undefined;
        if (property === "toHaveLength" && expectOperand?.kind === "set") {
          this.host.typeError("Set has no length matcher; write 'expect(set.size).toBe(expected)'", memberSpan);
        } else {
          const nearest = this.host.uniqueNearestName(property, object.fields.keys());
          this.host.typeError(`Object has no field '${property}'${nearest ? `; did you mean '${nearest}'?` : ""}`, memberSpan);
        }
      }
    } else if (object.kind === "extension") {
      let owned = false;
      for (const extension of this.host.analysisExtensions) {
        const member = extension.memberType?.(object, property);
        if (member === undefined) continue;
        owned = true;
        if (member) result = member;
        else this.host.typeError(`${describeType(object)} has no member '${property}'`, memberSpan);
        break;
      }
      if (!owned) this.host.typeError(`${describeType(object)} has no member '${property}'`, memberSpan);
    } else if (object.kind === "named") {
      const fields = this.host.fieldsOf(object.identity ?? object.name);
      result = fields?.get(property) ?? unknownType;
      if (this.host.readonlyFieldsOf(object.identity ?? object.name)?.has(property) && result.kind !== "unknown") result = this.host.readonlyDataViewOf(result);
      if (!fields?.has(property)) {
        this.host.typeError(`Type '${object.name}' has no field '${property}'`, memberSpan);
      }
    }
    return result;
  }

  /** A class instance and a class constructor: fields, getters, methods and their visibility. */
  private classMember(
    objectExpression: Expression,
    object: ValueType,
    property: string,
    memberSpan: Span,
    readValue: boolean,
  ): ValueType {
    let result: ValueType = unknownType;
    if (object.kind === "class") {
      const classKey = object.identity ?? object.name;
      const privateField = this.host.privateFieldForAccess(classKey, property, false);
      const privateMethod = this.host.privateMethodForAccess(classKey, property, false);
      const field = this.host.findField(classKey, property);
      const getter = this.host.findGetter(classKey, property);
      const method = this.host.findMethod(classKey, property);
      result = privateField?.type ?? privateMethod ?? field?.type ?? getter?.type ?? method?.type ?? unknownType;
      const privateGetter = Boolean(privateField && (this.host.privateGetters.get(this.host.currentClass ?? "")?.has(property) ?? false));
      if (privateField || privateMethod) {
        this.host.lowering.privateMembers.add(spanIdentity(memberSpan));
      } else if (!field && !getter && !method && this.host.declaresPrivateMember(classKey, property, false)) {
        this.host.typeError(`Member '${property}' is private to class '${object.name}'`, memberSpan);
      } else if (!field && !getter && !method) {
        this.host.typeError(`Class '${object.name}' has no member '${property}'`, memberSpan);
      }
      // D50 rule 89: `code` is not stored anywhere. The read recovers the
      // declared class name the lowering wrote into `.name`, so the string and
      // the class identity cannot drift apart, and a host error no Velar class
      // declared answers the contract it does satisfy: "Error".
      // An extern class declares its own JavaScript members, so a 'code' it
      // publishes is that host property and stays an ordinary read.
      const errorCodeRead = property === "code" && !classKey.startsWith("js:") && this.host.isSubclassOf(classKey, "Error");
      if (readValue && errorCodeRead) this.host.lowering.errorCodeReads.add(spanIdentity(memberSpan));
      if (readValue && field && !classKey.startsWith("js:") && !errorCodeRead
        && !(property === "cause" && this.host.isSubclassOf(classKey, "Error"))) {
        // Error's `cause` is host-managed and legitimately absent (ASY-U3);
        // the read normalizes undefined to null instead of tripping the
        // initialization guard.
        this.host.lowering.instanceFieldReads.add(spanIdentity(memberSpan));
      }
      if (readValue && privateField
        && !(this.host.privateGetters.get(this.host.currentClass ?? "")?.has(property) ?? false)) {
        this.host.lowering.privateInstanceFieldReads.add(spanIdentity(memberSpan));
      }
      // D44 rule 74: methods live on the prototype, so reading one as a value
      // (`const read = a.read`) evaluates the receiver once and binds at the
      // reference site — the collection-method rule of charter section 8.
      if (readValue && (method || privateMethod) && !field && !getter && !privateField
        && !this.host.callExpressionCallees.has(spanIdentity(memberSpan))) {
        this.host.lowering.classMethodReferences.add(spanIdentity(memberSpan));
      }
      // CLS-D9: while a constructor runs, derived state does not exist yet,
      // so a constructor body may only observe members its own class fully
      // owns. An abstract member always resolves to a derived implementation,
      // and a member some visible subclass overrides may — either observes
      // fields that are not initialized until the derived constructor runs.
      if (this.host.constructorDepth > 0
        && objectExpression.kind === "IdentifierExpression" && objectExpression.name === "self"
        && this.host.currentClass && classKey === this.host.currentClass) {
        const abstractMember = (getter?.abstract ?? false) || (method?.abstract ?? false);
        const overrider = !abstractMember && (getter || method)
          ? [...this.host.classes.keys()].find((candidate) => candidate !== classKey
            && this.host.isSubclassOf(candidate, classKey)
            && (this.host.classInfo(candidate)?.methods.has(property) || this.host.classInfo(candidate)?.getters.has(property)))
          : undefined;
        if (abstractMember) {
          this.host.typeError(
            `Constructor of '${object.name}' cannot use abstract member '${property}': the derived implementation would run before the derived constructor initializes its state. Move this use into the derived constructor`,
            memberSpan,
          );
        } else if (overrider !== undefined) {
          this.host.typeError(
            `Constructor of '${object.name}' cannot use '${property}': '${overrider}' overrides it, so the override would run before '${overrider}' initializes its state. Move this use into the derived constructor`,
            memberSpan,
          );
        }
      }
    } else if (object.kind === "classConstructor") {
      const key = object.identity ?? object.name;
      const privateField = this.host.privateFieldForAccess(key, property, true);
      const privateMethod = this.host.privateMethodForAccess(key, property, true);
      const fieldOwner = this.host.findStaticFieldOwner(key, property);
      const field = fieldOwner?.field ?? null;
      const getter = this.host.findStaticGetter(key, property);
      const method = this.host.findStaticMethod(key, property);
      result = privateField?.type ?? privateMethod ?? field?.type ?? getter ?? method ?? unknownType;
      if (privateField || privateMethod) {
        this.host.lowering.privateMembers.add(spanIdentity(memberSpan));
      } else if (!field && !getter && !method && this.host.declaresPrivateMember(key, property, true)) {
        this.host.typeError(`Static member '${property}' is private to class '${object.name}'`, memberSpan);
      } else if (!field && !getter && !method) {
        this.host.typeError(`Class '${object.name}' has no static member '${property}'`, memberSpan);
      }
      if (readValue && (field || privateField)) {
        const initialization = this.host.staticFieldInitialization;
        const ownField = initialization?.className === key
          && (this.host.classInfo(key)?.staticFields.has(property)
            || this.host.privateStaticFields.get(key)?.has(property));
        if (ownField && !initialization.initialized.has(property)) {
          this.host.typeError(
            `Static field '${property}' is read before it is initialized; declare it earlier or defer the read`,
            memberSpan,
          );
        }
        if (field && fieldOwner && !key.startsWith("js:")) {
          this.host.lowering.staticFieldReads.set(spanIdentity(memberSpan), fieldOwner.depth);
        }
      }
      // D44 rule 74: a static method read as a value binds its class at the
      // reference site, the same rule instance method references follow.
      if (readValue && (method || privateMethod) && !field && !getter && !privateField
        && !this.host.callExpressionCallees.has(spanIdentity(memberSpan))) {
        this.host.lowering.classMethodReferences.add(spanIdentity(memberSpan));
      }
    }
    return result;
  }

  /** An enum object, a `type` object, a runtime `Type<T>` — and the receiver that publishes nothing. */
  private declaredValueMember(
    objectExpression: Expression,
    object: ValueType,
    property: string,
    memberSpan: Span,
    readValue: boolean,
  ): ValueType {
    let result: ValueType = unknownType;
    if (object.kind === "enumObject") {
      const enumResult = this.host.enumRuntimeMember(object.name, object.identity, object.members, property);
      if (enumResult) {
        result = enumResult;
      } else {
        this.host.typeError(
          `Enum '${object.name}' has no member '${property}'; ${object.name}.values() lists the members in declaration order`,
          memberSpan,
        );
      }
    } else if (object.kind === "typeObject") {
      // ENM-I4: identities follow aliases (charter section 12), so an alias
      // whose target is an enum answers member access, values(), is, and
      // parse exactly as the enum itself does.
      const aliasedEnum = this.host.aliasedEnumTarget(object.name);
      if (aliasedEnum) {
        const enumResult = this.host.enumRuntimeMember(aliasedEnum.name, aliasedEnum.identity, aliasedEnum.members, property);
        if (enumResult) {
          result = enumResult;
        } else {
          this.host.typeError(
            `Enum '${aliasedEnum.name}' has no member '${property}'; ${object.name}.values() lists the members in declaration order`,
            memberSpan,
          );
        }
      } else if (property === "is") {
        result = { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType };
      } else if (property === "parse") {
        result = {
          kind: "function",
          parameterNames: ["value"],
          parameters: [unknownType],
          requiredParameters: 1,
          result: this.host.invalidDeclaredTypes.has(object.name)
            ? invalidType
            : this.host.runtimeTypeObjectValue(object),
        };
      } else {
        this.host.typeError(`Type '${object.name}' has no runtime member '${property}'`, memberSpan);
      }
    } else if (object.kind === "runtimeType") {
      if (property === "is") {
        result = { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType };
      } else if (property === "parse") {
        result = { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: object.value };
      } else {
        this.host.typeError(`${describeType(object)} has no runtime member '${property}'`, memberSpan);
      }
    } else {
      this.host.typeError(`${describeType(object)} has no member '${property}'`, memberSpan);
    }
    return result;
  }


  stringMember(property: string): ValueType | null {
    const callable = (
      parameterNames: readonly string[],
      parameters: readonly ValueType[],
      result: ValueType,
      requiredParameters = parameters.length,
    ): ValueType => ({ kind: "function", parameterNames, parameters, requiredParameters, result });
    switch (property) {
      case "size": return numberType;
      case "trim":
      case "upper":
      case "lower": return callable([], [], stringType);
      case "slice": return callable(["start", "end"], [numberType, numberType], stringType, 0);
      case "char": return callable(["index"], [numberType], optionalOf(stringType));
      case "has": return callable(["text"], [stringType], boolType);
      case "index": return callable(["text", "start"], [stringType, numberType], optionalOf(numberType), 1);
      case "count": return callable(["text"], [stringType], numberType);
      case "startsWith":
      case "endsWith": return callable(["text"], [stringType], boolType);
      case "split": return callable(["separator"], [stringType], { kind: "list", element: stringType });
      case "replace":
      case "replaceAll": return callable(["from", "to"], [stringType, stringType], stringType);
      case "padStart":
      case "padEnd": return callable(["size", "fill"], [numberType, stringType], stringType, 1);
      case "repeat": return callable(["count"], [numberType], stringType);
      case "isBlank": return callable([], [], boolType);
      default: return null;
    }
  }

  numberMember(property: string): ValueType | null {
    const callable = (parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType): ValueType => ({
      kind: "function", parameterNames, parameters, requiredParameters: parameters.length, result,
    });
    switch (property) {
      case "abs":
      case "round":
      case "floor":
      case "ceil":
      case "sign":
      case "trunc": return callable([], [], numberType);
      case "toFixed": return callable(["digits"], [numberType], stringType);
      case "isInteger":
      case "isNaN":
      case "isFinite": return callable([], [], boolType);
      default: return null;
    }
  }

  private collectionMemberError(kind: CollectionKind, property: string): string {
    const guidance = collectionMemberGuidance(kind, property);
    return `${kind} has no member '${property}'${guidance ? `; ${guidance.message}` : ""}`;
  }

  /**
   * D38 §48: a retired collection member whose guidance names one successor
   * member is a mechanical rename of the member name itself.
   */
  private collectionMemberFix(kind: CollectionKind, property: string, memberSpan: Span): DiagnosticFix | undefined {
    const guidance = collectionMemberGuidance(kind, property);
    if (!guidance?.replacement || !guidance.title || memberSpan.end - memberSpan.start < property.length) return undefined;
    return mechanicalFix(span(memberSpan.end - property.length, memberSpan.end), guidance.replacement, guidance.title);
  }


  recordMemberAccessProperty(expression: Extract<Expression, { kind: "MemberExpression" }>): void {
    this.memberAccessProperties.set(spanIdentity(expression.object.span), { property: expression.property, end: expression.span.end });
  }
}
