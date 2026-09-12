/**
 * What a receiver publishes: the type under one name, and every name it has.
 *
 * D114 F4: there were two answers to this question. The type checker resolved
 * one name at a time in `MemberAccess.receiverMember`, and the semantic index
 * built the editor's roster in `createSemanticMembersOf` — a second walk with
 * its own hard-coded member lists, its own class-chain walk, and its own enum
 * and `Type<T>` member construction. They disagreed: the editor's List roster
 * predated the D114 S3 pipeline members, a private field read through an
 * applied receiver kept its declaration's `T` instead of the argument, and a
 * `type` alias of an enum published `is`/`parse` where the checker published
 * the enum's members. One concept, one definition: this module answers both
 * questions from one set of resolvers, so a member the checker accepts is the
 * member the editor shows, and a member the editor offers is one the checker
 * will accept.
 *
 * Nothing here reports a diagnostic or records a lowering fact. A refusal is
 * the checker's to make and stays in `members.ts`, which asks this module what
 * the receiver publishes and then decides what to say when the answer is
 * nothing.
 */
import { type AdvisoryRecordShape } from "./advisories.ts";
import {
  type ClassField,
  type ClassInfo,
  type CompilerAnalysisExtension,
} from "../contracts.ts";
import {
  boolType,
  invalidType,
  nonOptional,
  numberType,
  optionalOf,
  stringType,
  unionOf,
  unknownType,
  type ValueType,
} from "../types.ts";
import {
  CORE_LIST_MEMBER_NAMES,
  CORE_MAP_MEMBER_NAMES,
  CORE_RECORD_MEMBER_NAMES,
  CORE_SET_MEMBER_NAMES,
} from "./collections/operations.ts";

/** One published contract: its named parameters, their types, its result. */
const callable = (
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType => ({ kind: "function", parameterNames, parameters, requiredParameters, result });

/**
 * The checked value methods a string carries with it, as one table. It is a
 * table rather than a `switch` because the roster and the resolver are the same
 * fact: the names the editor offers are the keys, and the contract each one
 * resolves to is the value.
 */
export const STRING_MEMBER_CONTRACTS: ReadonlyMap<string, ValueType> = new Map<string, ValueType>([
  ["size", numberType],
  ["trim", callable([], [], stringType)],
  ["upper", callable([], [], stringType)],
  ["lower", callable([], [], stringType)],
  ["slice", callable(["start", "end"], [numberType, numberType], stringType, 0)],
  ["char", callable(["index"], [numberType], optionalOf(stringType))],
  ["has", callable(["text"], [stringType], boolType)],
  ["index", callable(["text", "start"], [stringType, numberType], optionalOf(numberType), 1)],
  ["count", callable(["text"], [stringType], numberType)],
  ["startsWith", callable(["text"], [stringType], boolType)],
  ["endsWith", callable(["text"], [stringType], boolType)],
  ["split", callable(["separator"], [stringType], { kind: "list", element: stringType })],
  ["replace", callable(["from", "to"], [stringType, stringType], stringType)],
  ["replaceAll", callable(["from", "to"], [stringType, stringType], stringType)],
  ["padStart", callable(["size", "fill"], [numberType, stringType], stringType, 1)],
  ["padEnd", callable(["size", "fill"], [numberType, stringType], stringType, 1)],
  ["repeat", callable(["count"], [numberType], stringType)],
  ["isBlank", callable([], [], boolType)],
]);

/** The same, for a number. */
export const NUMBER_MEMBER_CONTRACTS: ReadonlyMap<string, ValueType> = new Map<string, ValueType>([
  ["abs", callable([], [], numberType)],
  ["round", callable([], [], numberType)],
  ["floor", callable([], [], numberType)],
  ["ceil", callable([], [], numberType)],
  ["sign", callable([], [], numberType)],
  ["trunc", callable([], [], numberType)],
  ["toFixed", callable(["digits"], [numberType], stringType)],
  ["isInteger", callable([], [], boolType)],
  ["isSafeInteger", callable([], [], boolType)],
  ["isNaN", callable([], [], boolType)],
  ["isFinite", callable([], [], boolType)],
]);

/** The three members an action publishes, and the two a runtime `Type` does. */
const ACTION_MEMBER_NAMES = Object.freeze(["pending", "error"] as const);
const RUNTIME_TYPE_MEMBER_NAMES = Object.freeze(["is", "parse"] as const);
const ENUM_OBJECT_MEMBER_NAMES = Object.freeze(["is", "parse", "values"] as const);

/**
 * The five things a class receiver can publish under one name, in the order a
 * read prefers them. The checker needs the parts — a private member lowers
 * differently from a public one, a method read as a value binds at its
 * reference site, a field read runs the initialization guard — and the editor
 * needs only `type`. Both read the same lookup, so neither can drift.
 */
export interface ClassMemberParts {
  readonly privateField: ClassField | null;
  readonly privateMethod: ValueType | null;
  readonly field: ClassField | null;
  readonly getter: { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  readonly method: { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  readonly type: ValueType | null;
}

/** The same for a class constructor, where a static field also carries its depth. */
export interface StaticMemberParts {
  readonly privateField: ClassField | null;
  readonly privateMethod: ValueType | null;
  readonly fieldOwner: { readonly field: ClassField; readonly depth: number } | null;
  readonly field: ClassField | null;
  readonly getter: ValueType | null;
  readonly method: ValueType | null;
  readonly type: ValueType | null;
}

/** What the published-member resolver asks of the analyzer that hosts it, and nothing more. */
export interface PublishedMembersHost {
  aliasedEnumTarget(name: string): { readonly name: string; readonly identity: string; readonly members: ReadonlySet<string> } | null;
  readonly analysisExtensions: readonly CompilerAnalysisExtension[];
  classInfo(key: string): ClassInfo | undefined;
  currentClass: string | null;
  discriminatedDataField(original: ValueType, property: string): ValueType | null;
  displayExternalClasses(type: ValueType): ValueType;
  enumRuntimeMember(name: string, identity: string, members: ReadonlySet<string>, property: string): ValueType | null;
  expandAliases(type: ValueType, seen?: ReadonlySet<string>): ValueType;
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  findField(className: string, name: string): ClassField | null;
  findGetter(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findMethod(className: string, name: string): { readonly owner: string; readonly type: ValueType; readonly abstract: boolean } | null;
  findStaticFieldOwner(className: string, name: string): { readonly field: ClassField; readonly depth: number } | null;
  findStaticGetter(className: string, name: string): ValueType | null;
  findStaticMethod(className: string, name: string): ValueType | null;
  readonly invalidDeclaredTypes: Set<string>;
  isSubclassOf(actual: string, expected: string): boolean;
  listMember(list: Extract<ValueType, { kind: "list" }>, property: string): ValueType | null;
  mapMember(map: Extract<ValueType, { kind: "map" }>, property: string): ValueType | null;
  privateFieldForAccess(className: string, name: string, staticMember: boolean): ClassField | null;
  privateMethodForAccess(className: string, name: string, staticMember: boolean): ValueType | null;
  readonly privateFields: Map<string, Map<string, ClassField>>;
  readonly privateMethods: Map<string, Map<string, ValueType>>;
  readonly privateStaticFields: Map<string, Map<string, ClassField>>;
  readonly privateStaticMethods: Map<string, Map<string, ValueType>>;
  readonlyDataViewOf(type: ValueType): ValueType;
  readonlyFieldsOf(identity: string): ReadonlySet<string> | null;
  recordMember(record: Extract<ValueType, { kind: "record" }>, property: string): ValueType | null;
  recordProjectionShape(type: ValueType): AdvisoryRecordShape | null;
  runtimeTypeObjectValue(type: Extract<ValueType, { kind: "typeObject" }>): ValueType;
  setMember(set: Extract<ValueType, { kind: "set" }>, property: string): ValueType | null;
}

export class PublishedMembers {
  private readonly host: PublishedMembersHost;

  constructor(host: PublishedMembersHost) {
    this.host = host;
  }

  stringMember(property: string): ValueType | null {
    return STRING_MEMBER_CONTRACTS.get(property) ?? null;
  }

  numberMember(property: string): ValueType | null {
    return NUMBER_MEMBER_CONTRACTS.get(property) ?? null;
  }

  /**
   * What `receiver` publishes under `property` when it is read, or `null` when
   * it publishes nothing under that name. The receiver arrives already expanded
   * and non-optional — the same shape `inferMember` hands to `receiverMember`.
   */
  member(receiver: ValueType, property: string): ValueType | null {
    switch (receiver.kind) {
      case "string": return this.stringMember(property);
      case "number": return this.numberMember(property);
      case "list": return this.host.listMember(receiver, property);
      case "map": return this.host.mapMember(receiver, property);
      case "set": return this.host.setMember(receiver, property);
      case "record": return this.host.recordMember(receiver, property);
      case "action": return this.actionMember(property);
      case "object": return this.objectMember(receiver, property);
      case "named": return this.namedMember(receiver, property);
      case "extension": return this.extensionMember(receiver, property);
      case "union": return this.unionMember(receiver, property);
      case "class": return this.classMemberParts(receiver, property).type;
      case "classConstructor": return this.staticMemberParts(receiver, property).type;
      case "enumObject": return this.host.enumRuntimeMember(receiver.name, receiver.identity, receiver.members, property);
      case "typeObject": return this.typeObjectMember(receiver, property);
      case "runtimeType": return this.runtimeTypeMember(receiver.value, property);
      default: return null;
    }
  }

  /**
   * Every name `receiver` publishes, with the type each one publishes. The
   * names come from the compiler-owned rosters or from the receiver's own
   * declaration; the type of each comes from `member`, so the roster cannot
   * offer a name the checker would refuse or describe one differently.
   */
  roster(receiver: ValueType): ReadonlyMap<string, ValueType> {
    const type = nonOptional(this.host.expandAliases(receiver));
    if (type.kind === "union") return this.unionRoster(type);
    // An extension type carries its own property table, which is what a target
    // offers after `<Component ` — a JSX attribute position, not a member read.
    // `memberType` answers the member read and does not answer these, so the
    // two questions stay two questions here, and the table is the answer to
    // the one the editor is asking.
    if (type.kind === "extension") return type.properties;
    const published = new Map<string, ValueType>();
    for (const name of this.publishedNames(type)) {
      const member = this.member(type, name);
      if (member !== null) published.set(name, this.asRead(type, member));
    }
    return published;
  }

  /** Display extern classes under their published names; reads retain the member type. */
  private asRead(_receiver: ValueType, member: ValueType): ValueType {
    return this.host.displayExternalClasses(member);
  }

  /** The names one receiver publishes: a compiler-owned roster, or its own declaration's. */
  private publishedNames(type: ValueType): readonly string[] {
    switch (type.kind) {
      case "string": return [...STRING_MEMBER_CONTRACTS.keys()];
      case "number": return [...NUMBER_MEMBER_CONTRACTS.keys()];
      case "list": return CORE_LIST_MEMBER_NAMES;
      case "map": return CORE_MAP_MEMBER_NAMES;
      case "set": return CORE_SET_MEMBER_NAMES;
      case "record": return CORE_RECORD_MEMBER_NAMES;
      case "action": return ACTION_MEMBER_NAMES;
      case "runtimeType": return RUNTIME_TYPE_MEMBER_NAMES;
      case "object": return [...type.fields.keys()];
      case "named": return [...(this.host.fieldsOf(type.identity ?? type.name)?.keys() ?? [])];
      case "class": return this.classChainNames(type.identity ?? type.name, false);
      case "classConstructor": return this.classChainNames(type.identity ?? type.name, true);
      case "enumObject": return [...type.members, ...ENUM_OBJECT_MEMBER_NAMES];
      case "typeObject": return this.typeObjectNames(type);
      default: return [];
    }
  }

  /**
   * The names a class chain publishes, first declaration winning, plus the
   * private members visible from the class under analysis — the same two tables
   * `findMethod` and `privateMethodForAccess` read, walked in the same order.
   */
  private classChainNames(receiverKey: string, staticMembers: boolean): readonly string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    let current: string | null = receiverKey;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const info: ClassInfo | undefined = this.host.classInfo(current);
      for (const name of (staticMembers ? info?.staticFields : info?.fields)?.keys() ?? []) {
        if (!seen.has(name)) { seen.add(name); names.push(name); }
      }
      for (const name of (staticMembers ? info?.staticMethods : info?.methods)?.keys() ?? []) {
        if (!seen.has(name)) { seen.add(name); names.push(name); }
      }
      current = info?.base ?? null;
    }
    const owner = this.privateMemberOwner(receiverKey, staticMembers);
    if (owner === null) return names;
    for (const name of (staticMembers ? this.host.privateStaticFields : this.host.privateFields).get(owner)?.keys() ?? []) {
      if (!seen.has(name)) { seen.add(name); names.push(name); }
    }
    for (const name of (staticMembers ? this.host.privateStaticMethods : this.host.privateMethods).get(owner)?.keys() ?? []) {
      if (!seen.has(name)) { seen.add(name); names.push(name); }
    }
    return names;
  }

  /**
   * The class whose private tables this receiver may be read through: the same
   * accessibility test `privateFieldForAccess` applies before it looks a name
   * up, so the roster lists exactly the private members a read would resolve.
   */
  private privateMemberOwner(receiverKey: string, staticMembers: boolean): string | null {
    const owner = this.host.currentClass;
    if (!owner) return null;
    const accessible = staticMembers ? receiverKey === owner : this.host.isSubclassOf(receiverKey, owner);
    return accessible ? owner : null;
  }

  /** The five class lookups a read prefers in order, and the type they settle on. */
  classMemberParts(object: Extract<ValueType, { kind: "class" }>, property: string): ClassMemberParts {
    const classKey = object.identity ?? object.name;
    const privateField = this.host.privateFieldForAccess(classKey, property, false);
    const privateMethod = this.host.privateMethodForAccess(classKey, property, false);
    const field = this.host.findField(classKey, property);
    const getter = this.host.findGetter(classKey, property);
    const method = this.host.findMethod(classKey, property);
    const type = privateField?.type ?? privateMethod ?? field?.type ?? getter?.type ?? method?.type ?? null;
    return { privateField, privateMethod, field, getter, method, type };
  }

  /** The same for the static side of a class. */
  staticMemberParts(object: Extract<ValueType, { kind: "classConstructor" }>, property: string): StaticMemberParts {
    const key = object.identity ?? object.name;
    const privateField = this.host.privateFieldForAccess(key, property, true);
    const privateMethod = this.host.privateMethodForAccess(key, property, true);
    const fieldOwner = this.host.findStaticFieldOwner(key, property);
    const field = fieldOwner?.field ?? null;
    const getter = this.host.findStaticGetter(key, property);
    const method = this.host.findStaticMethod(key, property);
    const type = privateField?.type ?? privateMethod ?? field?.type ?? getter ?? method ?? null;
    return { privateField, privateMethod, fieldOwner, field, getter, method, type };
  }

  private actionMember(property: string): ValueType | null {
    if (property === "pending") return boolType;
    if (property === "error") return optionalOf({ kind: "class", name: "Error" });
    return null;
  }

  private objectMember(object: Extract<ValueType, { kind: "object" }>, property: string): ValueType | null {
    const field = object.fields.get(property);
    if (field === undefined) return null;
    const optional = object.optionalFields?.has(property) ? optionalOf(field) : field;
    return optional;
  }

  private namedMember(object: Extract<ValueType, { kind: "named" }>, property: string): ValueType | null {
    const identity = object.identity ?? object.name;
    const field = this.host.fieldsOf(identity)?.get(property);
    if (field === undefined) return null;
    return field;
  }

  private extensionMember(object: Extract<ValueType, { kind: "extension" }>, property: string): ValueType | null {
    for (const extension of this.host.analysisExtensions) {
      const member = extension.memberType?.(object, property);
      if (member === undefined) continue;
      return member ?? null;
    }
    return null;
  }

  /**
   * A union publishes a field only when every variant carries it: the field as
   * each variant declares it, or `null` when one of them does not have it at
   * all. A read answers their union; an assignment through the union needs the
   * variants themselves, which is why the parts are published as well.
   */
  unionCandidates(object: Extract<ValueType, { kind: "union" }>, property: string): readonly ValueType[] | null {
    if (object.members.length === 0) return null;
    const candidates = object.members.map((member) => this.host.discriminatedDataField(member, property));
    return candidates.every((candidate): candidate is ValueType => candidate !== null) ? candidates : null;
  }

  private unionMember(object: Extract<ValueType, { kind: "union" }>, property: string): ValueType | null {
    const candidates = this.unionCandidates(object, property);
    return candidates ? unionOf(candidates) : null;
  }

  /**
   * A union's roster is the names every variant publishes — asked of the
   * variants themselves, so a union of two records offers their common fields
   * — with the type each name publishes settled by `unionMember`, which is what
   * a read of it resolves to.
   */
  private unionRoster(object: Extract<ValueType, { kind: "union" }>): ReadonlyMap<string, ValueType> {
    if (object.members.length === 0) return new Map();
    const rosters = object.members.map((member) => this.roster(member));
    const common = new Map<string, ValueType>();
    for (const [name] of rosters[0]!) {
      if (!rosters.every((roster) => roster.has(name))) continue;
      const published = this.unionMember(object, name)
        ?? unionOf(rosters.map((roster) => roster.get(name)!));
      common.set(name, published);
    }
    return common;
  }

  /**
   * ENM-I4: identities follow aliases, so a `type` name whose target is an enum
   * publishes the enum's members. Everything else publishes `is` and `parse`,
   * plus the exact projection `from` when the value it stands for has one.
   */
  private typeObjectMember(object: Extract<ValueType, { kind: "typeObject" }>, property: string): ValueType | null {
    const aliasedEnum = this.host.aliasedEnumTarget(object.name);
    if (aliasedEnum) {
      return this.host.enumRuntimeMember(aliasedEnum.name, aliasedEnum.identity, aliasedEnum.members, property);
    }
    const value = this.typeObjectValue(object);
    if (property === "from") {
      // D95: `Target.from(source, overrides)` is a call the projection rule
      // owns and rewrites; the name is published, and a *bare read* of it is
      // refused by `members.ts` where every other refusal is decided.
      return this.host.recordProjectionShape(value)
        ? { kind: "function", parameterNames: ["source", "overrides"], parameters: [unknownType, unknownType], requiredParameters: 1, result: value }
        : null;
    }
    return this.runtimeTypeMember(value, property);
  }

  /** A declaration whose own type was refused parses to nothing usable (D90). */
  private typeObjectValue(object: Extract<ValueType, { kind: "typeObject" }>): ValueType {
    return this.host.invalidDeclaredTypes.has(object.name) ? invalidType : this.host.runtimeTypeObjectValue(object);
  }

  private typeObjectNames(object: Extract<ValueType, { kind: "typeObject" }>): readonly string[] {
    const aliasedEnum = this.host.aliasedEnumTarget(object.name);
    if (aliasedEnum) return [...aliasedEnum.members, ...ENUM_OBJECT_MEMBER_NAMES];
    return this.host.recordProjectionShape(this.typeObjectValue(object))
      ? [...RUNTIME_TYPE_MEMBER_NAMES, "from"]
      : RUNTIME_TYPE_MEMBER_NAMES;
  }

  private runtimeTypeMember(value: ValueType, property: string): ValueType | null {
    if (property === "is") {
      return { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: boolType };
    }
    if (property === "parse") {
      return { kind: "function", parameterNames: ["value"], parameters: [unknownType], requiredParameters: 1, result: value };
    }
    return null;
  }
}
