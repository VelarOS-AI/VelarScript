/**
 * The type model: the `ValueType` union every other stage names, the singleton
 * types, the structural identity a type is compared by, and the constructors
 * that build a type from other types (`optionalOf`, `unionOf`, `mapNestedTypes`).
 *
 * D114 R1c: this module is the floor of `types/`. It imports nothing from its
 * siblings, so the directory is a tree rather than a ring — every other module
 * here reads `ValueType` from this one and nothing reads back. Two consequences
 * a reader should expect: the closed bound vocabulary (`typeParameterBoundNames`
 * and `TypeParameterBound`) sits here because the `ValueType` union itself
 * declares `typeParameterBounds`, while the grant table and every rule that
 * reads it are in `bounds.ts`; and the text a type is written as
 * (`describeType`) is in `display.ts`, which is why the application
 * constructors that must agree with that text live there too.
 */
import { byCodeUnit } from "../stable-order.ts";

export interface EnumInfo {
  readonly identity: string;
  /** Source member names used by type checking and member access. */
  readonly members: ReadonlySet<string>;
  /**
   * Runtime wire value for each source member name. D102 ruling 1: a string,
   * or a safe integer where the protocol pins a numeric version. The kinds are
   * distinct values — `"2"` and `2` are two wire values, not one.
   */
  readonly wireValues: ReadonlyMap<string, string | number>;
}

/**
 * D55 rule 120: a generic record declaration, in the form every later stage
 * needs it — the identity its instantiations are keyed under, the parameter
 * names and their bounds, and the field table with the `parameter` types still
 * standing in it. This is the shape that crosses a module interface, so a
 * dependent can write `Box<its own record>` without the declaring module ever
 * having anticipated that argument.
 */
export interface GenericTypeInfo {
  readonly identity: string;
  readonly name: string;
  readonly parameterNames: readonly string[];
  readonly parameterBounds: readonly (TypeParameterBound | null)[];
  readonly fields: ReadonlyMap<string, ValueType>;
  readonly readonlyFields?: ReadonlySet<string>;
}

export type ExtensionTypeDisplay =
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "constructor"; readonly prefix: string; readonly name: string }
  | {
      readonly kind: "properties";
      readonly name: string;
      readonly result: string;
      readonly hiddenOptionalProperties?: ReadonlyMap<string, string>;
    };

/**
 * A target-owned type family. Core traverses its nested types and owns stable
 * identity, while the active language extension owns semantic compatibility
 * between roles in the family (for example a framework constructor satisfying
 * a framework contract).
 */
export interface ExtensionValueType {
  readonly kind: "extension";
  readonly extensionId: string;
  readonly family: string;
  readonly role: string;
  readonly nominal?: string;
  readonly properties: ReadonlyMap<string, ValueType>;
  readonly requiredProperties: ReadonlySet<string>;
  readonly arguments: readonly ValueType[];
  readonly metadata?: Readonly<Record<string, string>>;
  readonly display: ExtensionTypeDisplay;
}

/**
 * D55 rule 121: a generic record applied to arguments — `Box<string>`. The
 * arguments ride on the application rather than inside the `parameter` kind,
 * which keeps that kind's De Bruijn contract literal; this is D41 item 61's own
 * precedent for bounds, applied to the other piece of discriminating
 * information. The canonical instantiation identity is a pure function of
 * `declaration` and `arguments` (`genericApplicationIdentity`), so every stage
 * that rebuilds an application — the analyzer, a module interface, generic
 * `def` substitution — computes the same string without agreeing on anything
 * else. `fieldsOf` is untouched: the identity keys an already-substituted field
 * table, so no call site of it ever substitutes.
 */
export interface GenericApplication {
  /** The declaration's identity once nominals are resolved; its source name before that. */
  readonly declaration: string;
  /** The declaration's display name (`Box`), so substitution can rebuild the display text. */
  readonly name: string;
  readonly arguments: readonly ValueType[];
}

export type ValueType =
  /**
   * `restricted` is the recursion placeholder and `boundary` is the `unknown`
   * a program wrote down — the type of data nobody has checked yet. Neither
   * may be absorbed by a merge; see `mergeTypes`.
   */
  | { readonly kind: "unknown"; readonly restricted?: boolean; readonly boundary?: true }
  /**
   * `textConvertible` marks the compiler-owned text-conversion domain (charter
   * section 14). It is not spellable in source: only the built-in `str`
   * declares it, so a bare `str` stays a first-class value while assignability
   * still admits exactly the conversion whitelist at every call site.
   */
  | { readonly kind: "any"; readonly textConvertible?: true }
  | { readonly kind: "null" }
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "bool" }
  | { readonly kind: "optional"; readonly inner: ValueType }
  | { readonly kind: "list"; readonly element: ValueType; readonly readonlyView?: true }
  | { readonly kind: "set"; readonly element: ValueType; readonly readonlyView?: true }
  | { readonly kind: "map"; readonly key: ValueType; readonly value: ValueType; readonly readonlyView?: true }
  | { readonly kind: "record"; readonly value: ValueType; readonly readonlyView?: true }
  | { readonly kind: "promise"; readonly value: ValueType }
  | {
      readonly kind: "object";
      readonly fields: ReadonlyMap<string, ValueType>;
      readonly readonlyFields?: ReadonlySet<string>;
      readonly optionalFields?: ReadonlySet<string>;
      readonly readonlyView?: true;
      /**
       * D51 (audit 12): a standard capability handle a target declares
       * structurally rather than as a named type — a socket, an event stream, a
       * terminal. `using` supplies the contract for capability handles (charter
       * section 16), and only a compiler extension can set this flag, so a user
       * record with a `close()` is still never auto-detected as ownable.
       */
      readonly capabilityHandle?: true;
    }
  | { readonly kind: "parameter"; readonly name: string; readonly index: number }
  | { readonly kind: "named"; readonly name: string; readonly identity?: string; readonly readonlyView?: true; readonly application?: GenericApplication }
  /**
   * D55 rule 120 layer two: a class instantiation carries its arguments on the
   * same `application` a generic record does, and its `identity` is the same
   * pure function of declaration and arguments. `Stack<number>` and
   * `Stack<string>` are therefore two identities that no subclass chain joins,
   * which is the whole of the invariance ruling (D77 rule 194 item 1).
   */
  | { readonly kind: "class"; readonly name: string; readonly identity?: string; readonly application?: GenericApplication }
  | { readonly kind: "enum"; readonly name: string; readonly identity: string }
  | { readonly kind: "enumMember"; readonly name: string; readonly identity: string; readonly member: string }
  | { readonly kind: "enumObject"; readonly name: string; readonly identity: string; readonly members: ReadonlySet<string> }
  | { readonly kind: "typeObject"; readonly name: string; readonly value?: ValueType }
  | { readonly kind: "runtimeType"; readonly value: ValueType }
  | { readonly kind: "classConstructor"; readonly name: string; readonly identity?: string }
  | ExtensionValueType
  | { readonly kind: "function"; readonly typeParameterNames?: readonly string[]; readonly typeParameterBounds?: readonly (TypeParameterBound | null)[]; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType }
  | { readonly kind: "action"; readonly typeParameterNames?: readonly string[]; readonly typeParameterBounds?: readonly (TypeParameterBound | null)[]; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType }
  | { readonly kind: "intrinsic"; readonly name: string; readonly typeParameterNames?: readonly string[]; readonly typeParameterBounds?: readonly (TypeParameterBound | null)[]; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType }
  | { readonly kind: "union"; readonly members: readonly ValueType[] };

/** Canonical identities for Core's cross-runtime binary storage types. */
export const VELAR_BYTES_TYPE_IDENTITY = "velar/binary#type:Bytes";
export const VELAR_UINT8_BUFFER_TYPE_IDENTITY = "velar/binary#type:UInt8Buffer";
export const VELAR_UINT16_BUFFER_TYPE_IDENTITY = "velar/binary#type:UInt16Buffer";
export const VELAR_UINT32_BUFFER_TYPE_IDENTITY = "velar/binary#type:UInt32Buffer";
export const VELAR_FLOAT32_BUFFER_TYPE_IDENTITY = "velar/binary#type:Float32Buffer";

export type BinaryStorageKind = "bytes" | "uint8" | "uint16" | "uint32" | "float32";

/**
 * Binary storage stays nominal even though its JavaScript representation is a
 * typed array. This keeps Buffer's accidental surface out of source while
 * giving the analyzer and emitter one exact fast-path discriminator.
 */
export function binaryStorageKind(type: ValueType): BinaryStorageKind | null {
  if (type.kind !== "named") return null;
  if (type.identity === VELAR_BYTES_TYPE_IDENTITY) return "bytes";
  if (type.identity === VELAR_UINT8_BUFFER_TYPE_IDENTITY) return "uint8";
  if (type.identity === VELAR_UINT16_BUFFER_TYPE_IDENTITY) return "uint16";
  if (type.identity === VELAR_UINT32_BUFFER_TYPE_IDENTITY) return "uint32";
  if (type.identity === VELAR_FLOAT32_BUFFER_TYPE_IDENTITY) return "float32";
  return null;
}

export const unknownType: ValueType = { kind: "unknown" };
/**
 * The `unknown` a program wrote in an annotation, and the type every boundary
 * that hands back unchecked data should carry. It differs from the inference
 * seed above in exactly one rule — a merge may not absorb it — so `unknown`
 * arriving from outside stays unassignable until the value is validated,
 * instead of being retyped as whatever the other branch produced.
 */
export const boundaryUnknownType: ValueType = { kind: "unknown", boundary: true };
export const invalidType: ValueType = Object.freeze({ kind: "unknown" });
export const anyType: ValueType = { kind: "any" };
/** The declared parameter domain of the built-in `str`; see `isTextConvertibleType`. */
export const textConvertibleType: ValueType = Object.freeze({ kind: "any", textConvertible: true });
export const nullType: ValueType = { kind: "null" };
export const stringType: ValueType = { kind: "string" };
export const numberType: ValueType = { kind: "number" };
export const boolType: ValueType = { kind: "bool" };

/**
 * D41 item 61: the complete, closed bound vocabulary. A bound is a name the
 * compiler owns; users cannot define one, and there is no syntax for combining
 * two — D51 rule 110: not because the three form a containment chain (they do
 * not: a Web text-shaped value satisfies Text and is refused by Data), but
 * because no real function demands two at once. The grant table in
 * `types/bounds.ts` is the whole definition; nothing computes a relation
 * between two bounds.
 */
export const typeParameterBoundNames = Object.freeze(["Comparable", "Text", "Data"] as const);

export type TypeParameterBound = (typeof typeParameterBoundNames)[number];

export interface TypeEnvironment {
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  readonlyFieldsOf?(identity: string): ReadonlySet<string> | null;
  isSubclassOf(actual: string, expected: string): boolean;
  isPrimitiveType(name: string): boolean;
  isPrimitiveSubtype(actual: string, expected: string): boolean;
  isExtensionTypeAssignable?(
    actual: ExtensionValueType,
    expected: ExtensionValueType,
    assign: (actual: ValueType, expected: ValueType) => boolean,
  ): boolean | undefined;
  /** Target-owned total text forms used by f-strings and the built-in `str`. */
  extensionTextForm?(type: ValueType): boolean | undefined;
  /** Expands declared type aliases; the text-conversion domain checks the expanded shape. */
  expandTypeAliases?(type: ValueType): ValueType;
  /**
   * D102 ruling 1: the declared wire value of each member of an enum, looked up
   * by identity first and local name second, the way every other enum question
   * reaches `this.enums`. Assignability needs it because the enum -> `string`
   * exit (D42 item 65) is a claim about the runtime representation, and a
   * member pinned to an integer does not have one.
   */
  enumWireValuesOf?(identity: string, name: string): ReadonlyMap<string, string | number> | null;
  /**
   * D41 item 61 risk 2: the declared bound of a type parameter in scope. The
   * bound deliberately lives outside the `parameter` type kind (whose identity
   * encodes only its De Bruijn index), so the environment answers it from the
   * declaration frame the annotation was resolved in.
   */
  boundOf?(type: Extract<ValueType, { kind: "parameter" }>): TypeParameterBound | null;
  /** Decides whether a solved type argument satisfies a declared bound. */
  satisfiesBound?(type: ValueType, bound: TypeParameterBound): boolean;
}

/**
 * The canonical identity of one instantiation. D55 rule 121 puts the arguments
 * in the identity string rather than adding a field `typeIdentity` would have
 * to learn, so `Box<string>` and `Box<number>` are two identities and
 * `typeIdentity`'s `named` branch is unchanged. Arguments are keyed by their
 * own identities, which is what makes `Box<Id>` and `Box<string>` one type when
 * `Id` is an alias of `string`.
 */
export function genericApplicationIdentity(declaration: string, arguments_: readonly ValueType[]): string {
  return `${declaration}<${arguments_.map((argument) => semanticTypeIdentity(argument)).join(",")}>`;
}

/**
 * Rebuilds a type with `map` applied to each type it directly contains. The
 * nested positions are exactly the ones `substituteTypeParameters` walks, kept
 * in one place so a traversal added by a caller cannot miss one of them.
 */
export function mapNestedTypes(type: ValueType, map: (nested: ValueType) => ValueType): ValueType {
  switch (type.kind) {
    case "optional":
      return optionalOf(map(type.inner));
    case "list":
    case "set":
      return { ...type, element: map(type.element) };
    case "map":
      return { ...type, key: map(type.key), value: map(type.value) };
    case "record":
      return { ...type, value: map(type.value) };
    case "promise":
      return { kind: "promise", value: map(type.value) };
    case "runtimeType":
      return { kind: "runtimeType", value: map(type.value) };
    case "typeObject":
      return type.value ? { ...type, value: map(type.value) } : type;
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, map(value)])) };
    case "named":
    case "class":
      return type.application
        ? { ...type, application: { ...type.application, arguments: type.application.arguments.map(map) } }
        : type;
    case "extension":
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, map(value)])),
        arguments: type.arguments.map(map),
      };
    case "function":
    case "action":
    case "intrinsic":
      return {
        ...type,
        parameters: type.parameters.map(map),
        ...(type.rest ? { rest: map(type.rest) } : {}),
        result: map(type.result),
      };
    case "union":
      return unionOf(type.members.map(map));
    default:
      return type;
  }
}

export function optionalOf(type: ValueType): ValueType {
  if (isInvalidType(type)) {
    return invalidType;
  }
  if (type.kind === "optional") {
    return type;
  }
  if (type.kind === "null") {
    return nullType;
  }
  return { kind: "optional", inner: type };
}

export function nonOptional(type: ValueType): ValueType {
  return type.kind === "optional" ? type.inner : type;
}

export function unionOf(types: readonly ValueType[]): ValueType {
  const members: ValueType[] = [];
  let nullable = false;
  const add = (type: ValueType): boolean => {
    if (isInvalidType(type)) return false;
    if (type.kind === "union") return type.members.every(add);
    if (type.kind === "optional") {
      nullable = true;
      return add(type.inner);
    }
    if (type.kind === "null") {
      nullable = true;
      return true;
    }
    if (!members.some((member) => sameType(member, type))) members.push(type);
    return true;
  };
  if (!types.every(add)) return invalidType;
  const value = members.length === 0 ? unknownType : members.length === 1 ? members[0]! : { kind: "union", members } satisfies ValueType;
  return nullable ? members.length === 0 ? nullType : optionalOf(value) : value;
}

export function resolvedAsyncType(type: ValueType): ValueType {
  if (type.kind === "promise") return resolvedAsyncType(type.value);
  if (type.kind === "optional") return optionalOf(resolvedAsyncType(type.inner));
  if (type.kind === "union") return unionOf(type.members.map(resolvedAsyncType));
  return type;
}

export function sameType(left: ValueType, right: ValueType): boolean {
  if (left === right) return true;
  return semanticTypeIdentity(left) === semanticTypeIdentity(right);
}

// Parameter labels are editor/call-site metadata, not part of the runtime
// callable domain. Override implementations may keep local names while every
// declaration still exposes its own checked named-argument surface.
export function sameTypeIgnoringCallableParameterNames(left: ValueType, right: ValueType): boolean {
  return typeIdentity(left, false) === typeIdentity(right, false);
}

export function runtimeTypeValue(type: ValueType): ValueType | null {
  if (type.kind === "runtimeType") return type.value;
  if (type.kind === "typeObject") return type.value ?? { kind: "named", name: type.name };
  if (type.kind === "enumObject") return { kind: "enum", name: type.name, identity: type.identity };
  return null;
}

export function semanticTypeIdentity(type: ValueType): string {
  return typeIdentity(type);
}

export const analysisTypeIdentity = semanticTypeIdentity;

/**
 * Identity is a pure function of the type node, and every producer builds a
 * node's collections before it builds the node, so a `ValueType` is never
 * mutated after construction and an identity computed once stays correct for
 * that object's whole life. The two caches match the two
 * `includeCallableParameterNames` modes; a rebuilt node is a new object and
 * therefore a cache miss, so no rebuild is ever served a stale identity.
 */
const semanticIdentityCache = new WeakMap<ValueType, string>();
const callableShapeIdentityCache = new WeakMap<ValueType, string>();

function typeIdentity(type: ValueType, includeCallableParameterNames = true): string {
  const cache = includeCallableParameterNames ? semanticIdentityCache : callableShapeIdentityCache;
  const cached = cache.get(type);
  if (cached !== undefined) return cached;
  const identity = buildTypeIdentity(type, includeCallableParameterNames);
  cache.set(type, identity);
  return identity;
}

function buildTypeIdentity(type: ValueType, includeCallableParameterNames: boolean): string {
  const nested = (value: ValueType): string => typeIdentity(value, includeCallableParameterNames);
  switch (type.kind) {
    case "unknown":
      return identityNode("unknown", [isInvalidType(type) ? "diagnosed" : type.restricted ? "restricted" : ""]);
    case "any":
      // The text-conversion domain is a distinct contract from `any`; sharing
      // an identity would let `sameType` short-circuit the whitelist.
      return identityNode("any", [type.textConvertible ? "text" : ""]);
    case "null":
    case "string":
    case "number":
    case "bool":
      return identityNode(type.kind);
    case "class":
      return identityNode("class", [type.identity ?? type.name]);
    case "classConstructor":
      return identityNode("class-constructor", [type.identity ?? type.name]);
    case "named":
      return identityNode("named", [type.readonlyView ? "readonly" : "", type.identity ?? type.name]);
    case "parameter":
      // De Bruijn-style: the identity encodes only the index so that (T) -> T
      // and (U) -> U from any two declarations are the same type.
      return identityNode("parameter", [String(type.index)]);
    case "enum":
    case "enumMember":
    case "enumObject":
      return identityNode(type.kind, [type.identity, ...(type.kind === "enumMember" ? [type.member] : [])]);
    case "typeObject":
      return identityNode("type-object", [type.name]);
    case "runtimeType":
      return identityNode("runtime-type", [nested(type.value)]);
    case "optional":
      return identityNode("optional", [nested(type.inner)]);
    case "list":
      return identityNode("list", [type.readonlyView ? "readonly" : "", nested(type.element)]);
    case "set":
      return identityNode("set", [type.readonlyView ? "readonly" : "", nested(type.element)]);
    case "map":
      return identityNode("map", [type.readonlyView ? "readonly" : "", nested(type.key), nested(type.value)]);
    case "record":
      return identityNode("record", [type.readonlyView ? "readonly" : "", nested(type.value)]);
    case "promise":
      return identityNode("promise", [nested(type.value)]);
    case "object":
      return identityNode("object", [type.readonlyView ? "readonly" : "", ...[...type.fields]
        .map(([name, value]) => [name, nested(value)] as const)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([name, value]) => identityNode("field", [
          type.readonlyFields?.has(name) ? "readonly" : "",
          type.optionalFields?.has(name) ? "optional" : "",
          name,
          value,
        ]))]);
    case "function":
    case "action":
    case "intrinsic":
      return identityNode(type.kind, [
        type.kind === "intrinsic" ? type.name : "",
        type.typeParameterNames?.length ? String(type.typeParameterNames.length) : "",
        // D41 item 61 risk 1: the bound cannot live in the `parameter` kind's
        // identity without breaking its De Bruijn contract, so the callable
        // carries it — otherwise `<T: Text>(T) -> T` and `<U>(U) -> U` would
        // share one identity and assignment between them would go unchecked.
        type.typeParameterBounds?.some((bound) => bound !== null)
          ? identityNode("bounds", type.typeParameterBounds.map((bound) => bound ?? ""))
          : "",
        identityNode("parameter-names", includeCallableParameterNames ? type.parameterNames ?? [] : []),
        String(type.requiredParameters),
        identityNode("parameters", type.parameters.map(nested)),
        type.rest ? nested(type.rest) : "",
        nested(type.result),
      ]);
    case "extension":
      return identityNode("extension", [type.extensionId, type.family, type.role, type.nominal ?? "", ...[...type.properties]
        .map(([name, value]) => [name, nested(value)] as const)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([name, value]) => identityNode("property", [name, value])),
      identityNode("required-properties", [...type.requiredProperties].sort()),
      identityNode("arguments", type.arguments.map(nested)),
      identityNode("metadata", Object.entries(type.metadata ?? {}).sort(([left], [right]) => byCodeUnit(left, right)).map(([name, value]) => identityNode("entry", [name, value]))),
    ]);
    case "union":
      return identityNode("union", type.members.map(nested).sort());
  }
}

function identityNode(kind: string, parts: readonly string[] = []): string {
  return `${kind.length}:${kind}${parts.map((part) => `${part.length}:${part}`).join("")}`;
}

export function isInvalidType(type: ValueType): boolean {
  return type === invalidType;
}

export type CallableType = Extract<ValueType, { readonly kind: "function" | "action" | "intrinsic" }>;

// Mirrors the recursive positions that emitTypeCheck actually inspects. A
// Type<T> value carries a compiler-known checker, but the checker object itself
// has no runtime identity for T, so accepting it in one of these positions
// would otherwise emit a predicate that can never be sound.
export function typeContainsRuntimeTypeCheck(type: ValueType): boolean {
  switch (type.kind) {
    case "runtimeType":
      return true;
    case "optional":
      return typeContainsRuntimeTypeCheck(type.inner);
    case "list":
    case "set":
      return typeContainsRuntimeTypeCheck(type.element);
    case "map":
      return typeContainsRuntimeTypeCheck(type.key) || typeContainsRuntimeTypeCheck(type.value);
    case "record":
      return typeContainsRuntimeTypeCheck(type.value);
    case "object":
      return [...type.fields.values()].some(typeContainsRuntimeTypeCheck);
    // D55 rule 124: `Box<Type<User>>` puts the carrier in a runtime-validated
    // field just as `type Holder: t: Type<User>` does, and is refused by the
    // same VEL4022 at the position that wrote it — no new mechanism.
    case "named":
      return (type.application?.arguments ?? []).some(typeContainsRuntimeTypeCheck);
    case "union":
      return type.members.some(typeContainsRuntimeTypeCheck);
    default:
      // Promise and callable checks intentionally validate only their runtime
      // carrier, just as they already do for every other erased inner type.
      return false;
  }
}

// D90 R12: `any` may not appear at an export position, written or inferred.
// Like the two predicates above, this one visits exactly the positions its own
// rule reasons about — the ones a consuming module can read a value *out of*.
// A callable's parameters and rest are deliberately absent: the rule exists so
// a consumer never receives something the compiler makes no promise about, and
// an input position accepts a value *from* the consumer instead of handing it
// a guarantee. Measured across this repository's 86 sources, output-position
// `any` in an export appears zero times and input-only `any` appears once —
// `chapterEight` in examples/tour/core/08-collections-and-math.vel re-exports
// the builtin `json.stringify`, whose first parameter is `any` and whose
// result is `string`, and which therefore leaks nothing.
export function typeContainsAnyOutput(type: ValueType): boolean {
  switch (type.kind) {
    case "any":
      return true;
    case "optional":
      return typeContainsAnyOutput(type.inner);
    case "list":
    case "set":
      return typeContainsAnyOutput(type.element);
    case "map":
      return typeContainsAnyOutput(type.key) || typeContainsAnyOutput(type.value);
    case "record":
      return typeContainsAnyOutput(type.value);
    case "promise":
    case "runtimeType":
      return typeContainsAnyOutput(type.value);
    case "object":
      return [...type.fields.values()].some(typeContainsAnyOutput);
    case "named":
      return (type.application?.arguments ?? []).some(typeContainsAnyOutput);
    case "extension":
      return [...type.properties.values(), ...type.arguments].some(typeContainsAnyOutput);
    case "function":
    case "action":
    case "intrinsic":
      return typeContainsAnyOutput(type.result);
    case "union":
      return type.members.some(typeContainsAnyOutput);
    default:
      return false;
  }
}
