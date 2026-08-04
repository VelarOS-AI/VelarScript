import type { TypeReference, TypeSyntax } from "./ast.ts";

export interface EnumInfo {
  readonly identity: string;
  readonly members: ReadonlySet<string>;
}

export interface StorageOriginEffect {
  readonly targetParameter?: number;
  readonly targetRest?: true;
  readonly targetReceiver?: true;
  readonly sourceParameters?: readonly number[];
  readonly sourceExternalDefaults?: readonly number[];
  readonly sourceRest?: true;
  readonly sourceReceiver?: true;
  readonly external?: true;
}

export type ValueType =
  | { readonly kind: "unknown"; readonly restricted?: boolean }
  | { readonly kind: "any" }
  | { readonly kind: "null" }
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "bool" }
  | { readonly kind: "optional"; readonly inner: ValueType }
  | { readonly kind: "list"; readonly element: ValueType; readonly external?: true }
  | { readonly kind: "set"; readonly element: ValueType; readonly external?: true }
  | { readonly kind: "map"; readonly key: ValueType; readonly value: ValueType; readonly external?: true }
  | { readonly kind: "promise"; readonly value: ValueType }
  | {
      readonly kind: "object";
      readonly fields: ReadonlyMap<string, ValueType>;
      readonly readonlyFields?: ReadonlySet<string>;
      readonly optionalFields?: ReadonlySet<string>;
      readonly external?: true;
      readonly containsExternal?: true;
    }
  | { readonly kind: "named"; readonly name: string; readonly identity?: string; readonly external?: true; readonly containsExternal?: true }
  | { readonly kind: "class"; readonly name: string; readonly identity?: string; readonly external?: true; readonly containsExternal?: true }
  | { readonly kind: "enum"; readonly name: string; readonly identity: string }
  | { readonly kind: "enumObject"; readonly name: string; readonly identity: string; readonly members: ReadonlySet<string> }
  | { readonly kind: "typeObject"; readonly name: string }
  | { readonly kind: "classConstructor"; readonly name: string; readonly identity?: string }
  | { readonly kind: "node" }
  | { readonly kind: "componentConstructor"; readonly name: string; readonly props: ReadonlyMap<string, ValueType>; readonly requiredProps: ReadonlySet<string>; readonly intrinsic?: string }
  | { readonly kind: "function"; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType; readonly resultOriginParameters?: readonly number[]; readonly resultOriginRest?: true; readonly resultOriginReceiver?: true; readonly resultOriginExternalDefaults?: readonly number[]; readonly storageOriginEffects?: readonly StorageOriginEffect[] }
  | { readonly kind: "action"; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType; readonly resultOriginParameters?: readonly number[]; readonly resultOriginRest?: true; readonly resultOriginReceiver?: true; readonly resultOriginExternalDefaults?: readonly number[]; readonly storageOriginEffects?: readonly StorageOriginEffect[] }
  | { readonly kind: "intrinsic"; readonly name: string; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType; readonly resultOriginParameters?: readonly number[]; readonly resultOriginRest?: true; readonly resultOriginReceiver?: true; readonly resultOriginExternalDefaults?: readonly number[]; readonly storageOriginEffects?: readonly StorageOriginEffect[] }
  | { readonly kind: "union"; readonly members: readonly ValueType[] };

export const unknownType: ValueType = { kind: "unknown" };
export const invalidType: ValueType = Object.freeze({ kind: "unknown" });
export const anyType: ValueType = { kind: "any" };
export const nullType: ValueType = { kind: "null" };
export const stringType: ValueType = { kind: "string" };
export const numberType: ValueType = { kind: "number" };
export const boolType: ValueType = { kind: "bool" };

export interface TypeEnvironment {
  fieldsOf(identity: string): ReadonlyMap<string, ValueType> | null;
  isSubclassOf(actual: string, expected: string): boolean;
  isPrimitiveType(name: string): boolean;
  isPrimitiveSubtype(actual: string, expected: string): boolean;
}

export function resolveTypeReference(reference: TypeReference): ValueType {
  return typeFromSyntax(reference.syntax);
}

export function typeFromSyntax(syntax: TypeSyntax): ValueType {
  switch (syntax.kind) {
    case "NamedTypeSyntax":
      switch (syntax.name) {
        case "string": return stringType;
        case "number": return numberType;
        case "bool": return boolType;
        case "null": return nullType;
        case "unknown": return unknownType;
        case "any": return anyType;
        case "WebNode": return { kind: "node" };
        default: return { kind: "named", name: syntax.name };
      }
    case "GenericTypeSyntax": {
      const arguments_ = syntax.arguments.map(typeFromSyntax);
      if (syntax.name === "List") return { kind: "list", element: arguments_[0] ?? unknownType };
      if (syntax.name === "Set") return { kind: "set", element: arguments_[0] ?? unknownType };
      if (syntax.name === "Map") return { kind: "map", key: arguments_[0] ?? unknownType, value: arguments_[1] ?? unknownType };
      if (syntax.name === "Promise") return { kind: "promise", value: arguments_[0] ?? unknownType };
      return { kind: "named", name: formatTypeSyntax(syntax) };
    }
    case "OptionalTypeSyntax":
      return optionalOf(typeFromSyntax(syntax.inner));
    case "UnionTypeSyntax":
      return unionOf(syntax.members.map(typeFromSyntax));
    case "FunctionTypeSyntax": {
      const fixed = syntax.parameters.filter((parameter) => !parameter.rest);
      const rest = syntax.parameters.find((parameter) => parameter.rest);
      return {
        kind: "function",
        parameters: fixed.map((parameter) => typeFromSyntax(parameter.type)),
        ...(fixed.some((parameter) => parameter.name) ? { parameterNames: fixed.map((parameter) => parameter.name ?? "") } : {}),
        requiredParameters: fixed.length,
        ...(rest ? { rest: typeFromSyntax(rest.type) } : {}),
        result: typeFromSyntax(syntax.result),
      };
    }
  }
}

export function formatTypeReference(reference: TypeReference): string {
  return formatTypeSyntax(reference.syntax);
}

export function formatTypeSyntax(syntax: TypeSyntax): string {
  switch (syntax.kind) {
    case "NamedTypeSyntax": return syntax.name;
    case "GenericTypeSyntax": return `${syntax.name}<${syntax.arguments.map(formatTypeSyntax).join(", ")}>`;
    case "OptionalTypeSyntax": return `${syntax.inner.kind === "UnionTypeSyntax" || syntax.inner.kind === "FunctionTypeSyntax" ? `(${formatTypeSyntax(syntax.inner)})` : formatTypeSyntax(syntax.inner)}?`;
    case "UnionTypeSyntax": return syntax.members.map(formatTypeSyntax).join(" | ");
    case "FunctionTypeSyntax": return `(${syntax.parameters.map((parameter) => `${parameter.rest ? "..." : ""}${parameter.name ? `${parameter.name}: ` : ""}${formatTypeSyntax(parameter.type)}`).join(", ")}) -> ${formatTypeSyntax(syntax.result)}`;
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
  for (const type of types) {
    const candidates = type.kind === "union" ? type.members : [type];
    for (const candidate of candidates) {
      if (isInvalidType(candidate)) return invalidType;
      const existing = members.findIndex((member) => sameType(member, candidate));
      if (existing < 0) members.push(candidate);
      else members[existing] = mergeEquivalentMetadata(members[existing]!, candidate);
    }
  }
  return members.length === 0 ? unknownType : members.length === 1 ? members[0]! : { kind: "union", members };
}

export function mergeTypes(left: ValueType, right: ValueType): ValueType {
  if (isInvalidType(left) || isInvalidType(right)) {
    return invalidType;
  }
  if (left.kind === "unknown" && !left.restricted) {
    return right;
  }
  if (right.kind === "unknown" && !right.restricted) {
    return left;
  }
  if (sameType(left, right)) {
    return mergeEquivalentMetadata(left, right);
  }
  if (left.kind === "optional" && sameType(left.inner, right)) {
    return optionalOf(mergeEquivalentMetadata(left.inner, right));
  }
  if (right.kind === "optional" && sameType(right.inner, left)) {
    return optionalOf(mergeEquivalentMetadata(left, right.inner));
  }
  if (left.kind === "null") {
    return optionalOf(right);
  }
  if (right.kind === "null") {
    return optionalOf(left);
  }
  return unionOf([left, right]);
}

function storageOriginEffectIdentity(effect: StorageOriginEffect): string {
  return identityNode("storage-origin", [
    effect.targetReceiver ? "receiver" : effect.targetRest ? "rest" : `parameter:${effect.targetParameter ?? ""}`,
    effect.sourceReceiver ? "receiver" : "",
    effect.sourceRest ? "rest" : "",
    effect.external ? "external" : "",
    [...(effect.sourceExternalDefaults ?? [])].sort((a, b) => a - b).join(","),
    [...(effect.sourceParameters ?? [])].sort((a, b) => a - b).join(","),
  ]);
}

function mergeStorageOriginEffects(
  left: readonly StorageOriginEffect[] | undefined,
  right: readonly StorageOriginEffect[] | undefined,
): readonly StorageOriginEffect[] {
  const effects = new Map<string, StorageOriginEffect>();
  for (const effect of [...(left ?? []), ...(right ?? [])]) {
    const normalized: StorageOriginEffect = {
      ...(effect.targetParameter !== undefined ? { targetParameter: effect.targetParameter } : {}),
      ...(effect.targetRest ? { targetRest: true } : {}),
      ...(effect.targetReceiver ? { targetReceiver: true } : {}),
      ...(effect.sourceParameters?.length
        ? { sourceParameters: [...new Set(effect.sourceParameters)].sort((a, b) => a - b) }
        : {}),
      ...(effect.sourceExternalDefaults?.length
        ? { sourceExternalDefaults: [...new Set(effect.sourceExternalDefaults)].sort((a, b) => a - b) }
        : {}),
      ...(effect.sourceRest ? { sourceRest: true } : {}),
      ...(effect.sourceReceiver ? { sourceReceiver: true } : {}),
      ...(effect.external ? { external: true } : {}),
    };
    effects.set(storageOriginEffectIdentity(normalized), normalized);
  }
  return [...effects.values()].sort((a, b) => storageOriginEffectIdentity(a).localeCompare(storageOriginEffectIdentity(b)));
}

function mergeEquivalentMetadata(left: ValueType, right: ValueType): ValueType {
  if (left.kind === "object" && right.kind === "object") {
    return {
      ...left,
      fields: new Map([...left.fields].map(([name, value]) => [
        name,
        right.fields.has(name) ? mergeEquivalentMetadata(value, right.fields.get(name)!) : value,
      ])),
      ...(left.external || right.external ? { external: true as const } : {}),
      ...(left.containsExternal || right.containsExternal ? { containsExternal: true as const } : {}),
    };
  }
  if (left.kind === "named" && right.kind === "named") {
    return {
      ...left,
      ...(left.external || right.external ? { external: true as const } : {}),
      ...(left.containsExternal || right.containsExternal ? { containsExternal: true as const } : {}),
    };
  }
  if (left.kind === "class" && right.kind === "class") {
    return {
      ...left,
      ...(left.external || right.external ? { external: true as const } : {}),
      ...(left.containsExternal || right.containsExternal ? { containsExternal: true as const } : {}),
    };
  }
  if (left.kind === "optional" && right.kind === "optional") {
    return { kind: "optional", inner: mergeEquivalentMetadata(left.inner, right.inner) };
  }
  if (left.kind === "list" && right.kind === "list") {
    return {
      kind: "list",
      element: mergeEquivalentMetadata(left.element, right.element),
      ...(left.external || right.external ? { external: true } : {}),
    };
  }
  if (left.kind === "set" && right.kind === "set") {
    return {
      kind: "set",
      element: mergeEquivalentMetadata(left.element, right.element),
      ...(left.external || right.external ? { external: true } : {}),
    };
  }
  if (left.kind === "map" && right.kind === "map") {
    return {
      kind: "map",
      key: mergeEquivalentMetadata(left.key, right.key),
      value: mergeEquivalentMetadata(left.value, right.value),
      ...(left.external || right.external ? { external: true } : {}),
    };
  }
  if (left.kind === "promise" && right.kind === "promise") {
    return { kind: "promise", value: mergeEquivalentMetadata(left.value, right.value) };
  }
  if (left.kind === "union" && right.kind === "union") {
    return {
      kind: "union",
      members: left.members.map((member) => {
        const matching = right.members.find((candidate) => sameType(member, candidate));
        return matching ? mergeEquivalentMetadata(member, matching) : member;
      }),
    };
  }
  if ((left.kind === "function" || left.kind === "action" || left.kind === "intrinsic")
    && right.kind === left.kind) {
    const resultOriginParameters = [...new Set([
      ...(left.resultOriginParameters ?? []),
      ...(right.resultOriginParameters ?? []),
    ])].sort((a, b) => a - b);
    const resultOriginExternalDefaults = [...new Set([
      ...(left.resultOriginExternalDefaults ?? []),
      ...(right.resultOriginExternalDefaults ?? []),
    ])].sort((a, b) => a - b);
    const storageOriginEffects = mergeStorageOriginEffects(left.storageOriginEffects, right.storageOriginEffects);
    return {
      ...left,
      parameters: left.parameters.map((parameter, index) => mergeEquivalentMetadata(parameter, right.parameters[index]!)),
      ...(left.rest && right.rest ? { rest: mergeEquivalentMetadata(left.rest, right.rest) } : {}),
      result: mergeEquivalentMetadata(left.result, right.result),
      ...(resultOriginParameters.length > 0 ? { resultOriginParameters } : {}),
      ...(left.resultOriginRest || right.resultOriginRest ? { resultOriginRest: true as const } : {}),
      ...(left.resultOriginReceiver || right.resultOriginReceiver ? { resultOriginReceiver: true as const } : {}),
      ...(resultOriginExternalDefaults.length > 0 ? { resultOriginExternalDefaults } : {}),
      ...(storageOriginEffects.length > 0 ? { storageOriginEffects } : {}),
    };
  }
  return left;
}

export function resolvedAsyncType(type: ValueType): ValueType {
  if (type.kind === "promise") return resolvedAsyncType(type.value);
  if (type.kind === "optional") return optionalOf(resolvedAsyncType(type.inner));
  if (type.kind === "union") return unionOf(type.members.map(resolvedAsyncType));
  return type;
}

export function sameType(left: ValueType, right: ValueType): boolean {
  return semanticTypeIdentity(left) === semanticTypeIdentity(right);
}

export function isAssignable(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string> = new Set()): boolean {
  if (isInvalidType(actual) || isInvalidType(expected)) {
    return true;
  }
  if (actual.kind === "any" || expected.kind === "any") {
    return true;
  }
  if (expected.kind === "unknown") {
    return !expected.restricted;
  }
  if (actual.kind === "unknown") {
    return false;
  }
  if (sameType(actual, expected)) {
    return true;
  }
  const pair = `${semanticTypeIdentity(actual)}\u0000${semanticTypeIdentity(expected)}`;
  if (seen.has(pair)) return true;
  seen.add(pair);
  if (actual.kind === "union") {
    return actual.members.every((member) => isAssignable(member, expected, environment, new Set(seen)));
  }
  if (actual.kind === "optional") {
    return isAssignable(nullType, expected, environment, new Set(seen))
      && isAssignable(actual.inner, expected, environment, new Set(seen));
  }
  if (expected.kind === "optional") {
    return actual.kind === "null" || isAssignable(actual, expected.inner, environment, seen);
  }
  if (expected.kind === "union") {
    return expected.members.some((member) => isAssignable(actual, member, environment, new Set(seen)));
  }
  if (actual.kind === "enum" && expected.kind === "string") {
    return true;
  }
  if (actual.kind === "list" && expected.kind === "list") {
    return invariant(actual.element, expected.element, environment, seen);
  }
  if (actual.kind === "set" && expected.kind === "set") {
    return invariant(actual.element, expected.element, environment, seen);
  }
  if (actual.kind === "map" && expected.kind === "map") {
    return invariant(actual.key, expected.key, environment, seen)
      && invariant(actual.value, expected.value, environment, seen);
  }
  if (actual.kind === "promise" && expected.kind === "promise") {
    return isAssignable(actual.value, expected.value, environment, seen);
  }
  if (actual.kind === "object" && expected.kind === "named") {
    if (environment.isPrimitiveType(expected.name)) return false;
    const fields = environment.fieldsOf(expected.identity ?? expected.name);
    return fields ? objectFieldsAssignable(actual.fields, fields, environment, seen, actual.readonlyFields, undefined, actual.optionalFields) : false;
  }
  if (actual.kind === "named" && expected.kind === "object") {
    if (environment.isPrimitiveType(actual.name)) return false;
    const fields = environment.fieldsOf(actual.identity ?? actual.name);
    return fields ? objectFieldsAssignable(fields, expected.fields, environment, seen, undefined, expected.readonlyFields, undefined, expected.optionalFields) : false;
  }
  if (actual.kind === "named" && expected.kind === "named") {
    const actualPrimitive = environment.isPrimitiveType(actual.name);
    const expectedPrimitive = environment.isPrimitiveType(expected.name);
    if (actualPrimitive || expectedPrimitive) {
      return actualPrimitive && expectedPrimitive && environment.isPrimitiveSubtype(actual.name, expected.name);
    }
    const actualFields = environment.fieldsOf(actual.identity ?? actual.name);
    const expectedFields = environment.fieldsOf(expected.identity ?? expected.name);
    return actualFields !== null && expectedFields !== null
      ? writableFieldsAssignable(actualFields, expectedFields, environment, seen)
      : false;
  }
  if (actual.kind === "class" && expected.kind === "class") {
    return environment.isSubclassOf(actual.identity ?? actual.name, expected.identity ?? expected.name);
  }
  if (actual.kind === "object" && expected.kind === "object") {
    return objectFieldsAssignable(actual.fields, expected.fields, environment, seen, actual.readonlyFields, expected.readonlyFields, actual.optionalFields, expected.optionalFields);
  }
  if ((actual.kind === "function" || actual.kind === "action" || actual.kind === "intrinsic") && (expected.kind === "function" || expected.kind === "action" || expected.kind === "intrinsic")) {
    return callableInputsAssignable(actual, expected, environment, seen)
      && isAssignable(actual.result, expected.result, environment, seen);
  }
  if (actual.kind === "node" && expected.kind === "node") {
    return true;
  }
  return false;
}

export function semanticTypeIdentity(type: ValueType): string {
  return typeIdentity(type, false);
}

export function analysisTypeIdentity(type: ValueType): string {
  return typeIdentity(type, true);
}

function typeIdentity(type: ValueType, includeExternal: boolean): string {
  const external = includeExternal && "external" in type && type.external === true ? "external" : "";
  const containsExternal = includeExternal && "containsExternal" in type && type.containsExternal === true ? "contains-external" : "";
  const nested = (value: ValueType): string => typeIdentity(value, includeExternal);
  switch (type.kind) {
    case "unknown":
      return identityNode("unknown", [isInvalidType(type) ? "diagnosed" : type.restricted ? "restricted" : ""]);
    case "any":
    case "null":
    case "string":
    case "number":
    case "bool":
    case "node":
      return identityNode(type.kind);
    case "class":
      return identityNode("class", [external, containsExternal, type.identity ?? type.name]);
    case "classConstructor":
      return identityNode("class-constructor", [type.identity ?? type.name]);
    case "named":
      return identityNode("named", [external, containsExternal, type.identity ?? type.name]);
    case "enum":
    case "enumObject":
      return identityNode(type.kind, [type.identity]);
    case "typeObject":
      return identityNode("type-object", [type.name]);
    case "optional":
      return identityNode("optional", [nested(type.inner)]);
    case "list":
      return identityNode("list", [external, nested(type.element)]);
    case "set":
      return identityNode("set", [external, nested(type.element)]);
    case "map":
      return identityNode("map", [external, nested(type.key), nested(type.value)]);
    case "promise":
      return identityNode("promise", [nested(type.value)]);
    case "object":
      return identityNode("object", [external, containsExternal, ...[...type.fields]
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
        identityNode("parameter-names", type.parameterNames ?? []),
        String(type.requiredParameters),
        identityNode("parameters", type.parameters.map(nested)),
        type.rest ? nested(type.rest) : "",
        nested(type.result),
        ...(includeExternal ? [
          identityNode("result-origin-parameters", (type.resultOriginParameters ?? []).map(String)),
          type.resultOriginRest ? "rest" : "",
          type.resultOriginReceiver ? "receiver" : "",
          identityNode("result-origin-defaults", (type.resultOriginExternalDefaults ?? []).map(String)),
          identityNode("storage-origin-effects", (type.storageOriginEffects ?? []).map(storageOriginEffectIdentity).sort()),
        ] : []),
      ]);
    case "componentConstructor":
      return identityNode("component", [type.intrinsic ?? "", type.name, ...[...type.props]
        .map(([name, value]) => [name, nested(value)] as const)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([name, value]) => identityNode("prop", [name, value])),
      identityNode("required-props", [...type.requiredProps].sort())]);
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

export function describeType(type: ValueType): string {
  switch (type.kind) {
    case "unknown":
    case "any":
    case "null":
    case "string":
    case "number":
    case "bool":
      return type.kind;
    case "optional":
      return `${["function", "action", "intrinsic", "union"].includes(type.inner.kind) ? `(${describeType(type.inner)})` : describeType(type.inner)}?`;
    case "list":
      return `List<${describeType(type.element)}>`;
    case "set":
      return `Set<${describeType(type.element)}>`;
    case "map":
      return `Map<${describeType(type.key)}, ${describeType(type.value)}>`;
    case "promise":
      return `Promise<${describeType(type.value)}>`;
    case "object":
      return `{ ${[...type.fields].map(([name, value]) => `${type.readonlyFields?.has(name) ? "readonly " : ""}${name}${type.optionalFields?.has(name) ? "?" : ""}: ${describeType(value)}`).join(", ")} }`;
    case "named":
    case "class":
    case "enum":
    case "typeObject":
    case "classConstructor":
      return type.name;
    case "enumObject":
      return `enum ${type.name}`;
    case "node":
      return "WebNode";
    case "componentConstructor":
      return `component ${type.name}`;
    case "function":
    case "action":
    case "intrinsic":
      return `${type.kind === "action" ? "action " : ""}(${[
        ...type.parameters.map((parameter, index) => {
          const described = describeType(parameter);
          const labeled = type.parameterNames?.[index] ? `${type.parameterNames[index]}: ${described}` : described;
          return index >= type.requiredParameters
            ? `${labeled} = default`
            : labeled;
        }),
        ...(type.rest ? [`...${describeType(type.rest)}`] : []),
      ].join(", ")}) -> ${describeType(type.result)}`;
    case "union":
      return type.members.map(describeType).join(" | ");
  }
}

function invariant(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string>): boolean {
  return isAssignable(actual, expected, environment, new Set(seen))
    && isAssignable(expected, actual, environment, new Set(seen));
}

type CallableType = Extract<ValueType, { readonly kind: "function" | "action" | "intrinsic" }>;

function callableInputsAssignable(actual: CallableType, expected: CallableType, environment: TypeEnvironment, seen: Set<string>): boolean {
  if (actual.requiredParameters > expected.requiredParameters) return false;
  if (!actual.rest && (expected.rest || actual.parameters.length < expected.parameters.length)) return false;

  for (let index = 0; index < expected.parameters.length; index += 1) {
    const accepted = actual.parameters[index] ?? actual.rest;
    if (!accepted || !isAssignable(expected.parameters[index]!, accepted, environment, new Set(seen))) return false;
    const expectedName = expected.parameterNames?.[index];
    if (expectedName && index < actual.parameters.length && actual.parameterNames?.[index] !== expectedName) return false;
  }

  if (expected.rest) {
    if (!actual.rest) return false;
    for (let index = expected.parameters.length; index < actual.parameters.length; index += 1) {
      if (!isAssignable(expected.rest, actual.parameters[index]!, environment, new Set(seen))) return false;
    }
    if (!isAssignable(expected.rest, actual.rest, environment, new Set(seen))) return false;
  }
  return true;
}

function objectFieldsAssignable(
  actual: ReadonlyMap<string, ValueType>,
  expected: ReadonlyMap<string, ValueType>,
  environment: TypeEnvironment,
  seen: Set<string>,
  actualReadonly: ReadonlySet<string> | undefined = undefined,
  expectedReadonly: ReadonlySet<string> | undefined = undefined,
  actualOptional: ReadonlySet<string> | undefined = undefined,
  expectedOptional: ReadonlySet<string> | undefined = undefined,
): boolean {
  for (const [name, expectedType] of expected) {
    const actualType = actual.get(name);
    if (!actualType) {
      if (expectedType.kind === "optional" || expectedOptional?.has(name)) continue;
      return false;
    }
    if (actualOptional?.has(name) && expectedType.kind !== "optional" && !expectedOptional?.has(name)) return false;
    if (expectedReadonly?.has(name)) {
      if (!isAssignable(actualType, expectedType, environment, new Set(seen))) return false;
    } else if (actualReadonly?.has(name) || !invariant(actualType, expectedType, environment, seen)) return false;
  }
  return true;
}

function writableFieldsAssignable(actual: ReadonlyMap<string, ValueType>, expected: ReadonlyMap<string, ValueType>, environment: TypeEnvironment, seen: Set<string>): boolean {
  return objectFieldsAssignable(actual, expected, environment, seen);
}
