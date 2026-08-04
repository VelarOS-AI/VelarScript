import type { TypeReference, TypeSyntax } from "./ast.ts";

export interface EnumInfo {
  readonly identity: string;
  readonly members: ReadonlySet<string>;
}

export type ValueType =
  | { readonly kind: "unknown" }
  | { readonly kind: "any" }
  | { readonly kind: "null" }
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "bool" }
  | { readonly kind: "optional"; readonly inner: ValueType }
  | { readonly kind: "list"; readonly element: ValueType }
  | { readonly kind: "set"; readonly element: ValueType }
  | { readonly kind: "map"; readonly key: ValueType; readonly value: ValueType }
  | { readonly kind: "promise"; readonly value: ValueType }
  | { readonly kind: "object"; readonly fields: ReadonlyMap<string, ValueType> }
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "class"; readonly name: string; readonly identity?: string }
  | { readonly kind: "enum"; readonly name: string; readonly identity: string }
  | { readonly kind: "enumObject"; readonly name: string; readonly identity: string; readonly members: ReadonlySet<string> }
  | { readonly kind: "typeObject"; readonly name: string }
  | { readonly kind: "classConstructor"; readonly name: string; readonly identity?: string }
  | { readonly kind: "node" }
  | { readonly kind: "componentConstructor"; readonly name: string; readonly props: ReadonlyMap<string, ValueType>; readonly requiredProps: ReadonlySet<string>; readonly intrinsic?: string }
  | { readonly kind: "function"; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType }
  | { readonly kind: "action"; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType }
  | { readonly kind: "intrinsic"; readonly name: string; readonly parameters: readonly ValueType[]; readonly parameterNames?: readonly string[]; readonly requiredParameters: number; readonly rest?: ValueType; readonly result: ValueType }
  | { readonly kind: "union"; readonly members: readonly ValueType[] };

export const unknownType: ValueType = { kind: "unknown" };
export const anyType: ValueType = { kind: "any" };
export const nullType: ValueType = { kind: "null" };
export const stringType: ValueType = { kind: "string" };
export const numberType: ValueType = { kind: "number" };
export const boolType: ValueType = { kind: "bool" };

export interface TypeEnvironment {
  fieldsOf(name: string): ReadonlyMap<string, ValueType> | null;
  isSubclassOf(actual: string, expected: string): boolean;
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
  if (type.kind === "optional") {
    return type;
  }
  if (type.kind === "null") {
    return { kind: "optional", inner: unknownType };
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
      if (!members.some((existing) => sameType(existing, candidate))) {
        members.push(candidate);
      }
    }
  }
  return members.length === 0 ? unknownType : members.length === 1 ? members[0]! : { kind: "union", members };
}

export function mergeTypes(left: ValueType, right: ValueType): ValueType {
  if (left.kind === "unknown") {
    return right;
  }
  if (right.kind === "unknown") {
    return left;
  }
  if (sameType(left, right)) {
    return left;
  }
  if (left.kind === "optional" && sameType(left.inner, right)) {
    return left;
  }
  if (right.kind === "optional" && sameType(right.inner, left)) {
    return right;
  }
  if (left.kind === "null") {
    return optionalOf(right);
  }
  if (right.kind === "null") {
    return optionalOf(left);
  }
  return unionOf([left, right]);
}

export function resolvedAsyncType(type: ValueType): ValueType {
  if (type.kind === "promise") return resolvedAsyncType(type.value);
  if (type.kind === "optional") return optionalOf(resolvedAsyncType(type.inner));
  if (type.kind === "union") return unionOf(type.members.map(resolvedAsyncType));
  return type;
}

export function sameType(left: ValueType, right: ValueType): boolean {
  return typeIdentityKey(left) === typeIdentityKey(right);
}

export function isAssignable(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string> = new Set()): boolean {
  if (actual.kind === "any" || expected.kind === "any") {
    return true;
  }
  if (expected.kind === "unknown") {
    return true;
  }
  if (actual.kind === "unknown") {
    return false;
  }
  if (sameType(actual, expected)) {
    return true;
  }
  const pair = `${typeIdentityKey(actual)}\u0000${typeIdentityKey(expected)}`;
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
    if (opaqueWebTypeNames.has(expected.name)) return false;
    const fields = environment.fieldsOf(expected.name);
    return fields ? fieldsAssignable(actual.fields, fields, environment, seen) : false;
  }
  if (actual.kind === "named" && expected.kind === "object") {
    if (opaqueWebTypeNames.has(actual.name)) return false;
    const fields = environment.fieldsOf(actual.name);
    return fields ? writableFieldsAssignable(fields, expected.fields, environment, seen) : false;
  }
  if (actual.kind === "named" && expected.kind === "named") {
    if (actual.name === expected.name) return true;
    const opaqueCompatibility = opaqueWebTypeAssignable(actual.name, expected.name);
    if (opaqueCompatibility !== null) return opaqueCompatibility;
    const actualFields = environment.fieldsOf(actual.name);
    const expectedFields = environment.fieldsOf(expected.name);
    return actualFields !== null && expectedFields !== null
      ? writableFieldsAssignable(actualFields, expectedFields, environment, seen)
      : false;
  }
  if (actual.kind === "class" && expected.kind === "class") {
    return environment.isSubclassOf(actual.identity ?? actual.name, expected.identity ?? expected.name);
  }
  if (actual.kind === "object" && expected.kind === "object") {
    return fieldsAssignable(actual.fields, expected.fields, environment, seen);
  }
  if ((actual.kind === "function" || actual.kind === "action" || actual.kind === "intrinsic") && (expected.kind === "function" || expected.kind === "action" || expected.kind === "intrinsic")) {
    const restAssignable = actual.rest && expected.rest
      ? isAssignable(expected.rest, actual.rest, environment, new Set(seen))
      : !actual.rest && !expected.rest;
    return actual.parameters.length === expected.parameters.length
      && actual.requiredParameters <= expected.requiredParameters
      && (!expected.parameterNames || expected.parameterNames.every((name, index) => !name || actual.parameterNames?.[index] === name))
      && actual.parameters.every((parameter, index) => isAssignable(expected.parameters[index] ?? unknownType, parameter, environment, new Set(seen)))
      && restAssignable
      && isAssignable(actual.result, expected.result, environment, seen);
  }
  if (actual.kind === "node" && expected.kind === "node") {
    return true;
  }
  return false;
}

function typeIdentityKey(type: ValueType): string {
  switch (type.kind) {
    case "class":
    case "classConstructor":
      return `${type.kind}:${type.identity ?? type.name}`;
    case "enum":
    case "enumObject":
      return `${type.kind}:${type.identity}`;
    case "optional":
      return `optional:${typeIdentityKey(type.inner)}`;
    case "list":
    case "set":
      return `${type.kind}:${typeIdentityKey(type.element)}`;
    case "map":
      return `map:${typeIdentityKey(type.key)}:${typeIdentityKey(type.value)}`;
    case "promise":
      return `promise:${typeIdentityKey(type.value)}`;
    case "object":
      return `object:${[...type.fields].map(([name, value]) => `${name}:${typeIdentityKey(value)}`).join(",")}`;
    case "function":
    case "action":
    case "intrinsic":
      return `${type.kind}:${type.parameterNames?.join(",") ?? ""}:${type.requiredParameters}:${type.parameters.map(typeIdentityKey).join(",")}:${type.rest ? typeIdentityKey(type.rest) : ""}:${typeIdentityKey(type.result)}`;
    case "componentConstructor":
      return `component:${type.name}`;
    case "union":
      return `union:${type.members.map(typeIdentityKey).join("|")}`;
    default:
      return `${type.kind}:${describeType(type)}`;
  }
}

const opaqueWebTypeNames = new Set([
  "Element",
  "InputElement",
  "CanvasElement",
  "DialogElement",
  "Event",
  "KeyboardEvent",
  "PointerEvent",
  "InputEvent",
]);

function opaqueWebTypeAssignable(actual: string, expected: string): boolean | null {
  const actualOpaque = opaqueWebTypeNames.has(actual);
  const expectedOpaque = opaqueWebTypeNames.has(expected);
  if (!actualOpaque && !expectedOpaque) return null;
  if (!actualOpaque || !expectedOpaque) return false;
  if (expected === "Element") return actual === "InputElement" || actual === "CanvasElement" || actual === "DialogElement";
  if (expected === "Event") return actual === "KeyboardEvent" || actual === "PointerEvent" || actual === "InputEvent";
  return false;
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
      return `{ ${[...type.fields].map(([name, value]) => `${name}: ${describeType(value)}`).join(", ")} }`;
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

function fieldsAssignable(actual: ReadonlyMap<string, ValueType>, expected: ReadonlyMap<string, ValueType>, environment: TypeEnvironment, seen: Set<string>): boolean {
  for (const [name, expectedType] of expected) {
    const actualType = actual.get(name);
    if (!actualType) {
      if (expectedType.kind === "optional") {
        continue;
      }
      return false;
    }
    if (!isAssignable(actualType, expectedType, environment, new Set(seen))) {
      return false;
    }
  }
  return true;
}

function invariant(actual: ValueType, expected: ValueType, environment: TypeEnvironment, seen: Set<string>): boolean {
  return isAssignable(actual, expected, environment, new Set(seen))
    && isAssignable(expected, actual, environment, new Set(seen));
}

function writableFieldsAssignable(actual: ReadonlyMap<string, ValueType>, expected: ReadonlyMap<string, ValueType>, environment: TypeEnvironment, seen: Set<string>): boolean {
  for (const [name, expectedType] of expected) {
    const actualType = actual.get(name);
    if (!actualType) {
      if (expectedType.kind === "optional") continue;
      return false;
    }
    if (!invariant(actualType, expectedType, environment, seen)) return false;
  }
  return true;
}
