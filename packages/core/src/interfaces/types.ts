/**
 * The type vocabulary every `velar/*` interface table is written in.
 *
 * D115 §三: one file per standard module, and this is what they share — the
 * primitive `ValueType` constants, the four function shapes a Core export can
 * have, and the `ModuleInterface` constructor that fills in the fields a Core
 * module never uses. Anything a single module owns lives in that module's file.
 */
import type { ClassInfo, ModuleInterface, ValueType } from "@velarscript/compiler";

export const nullType: ValueType = { kind: "null" };
export const stringType: ValueType = { kind: "string" };
export const numberType: ValueType = { kind: "number" };
export const boolType: ValueType = { kind: "bool" };
export const durationType: ValueType = { kind: "named", name: "Duration" };

export function functionType(parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameters, requiredParameters, result };
}

export function apiFunction(parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameterNames, parameters, requiredParameters, result };
}

export function intrinsic(name: string, parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "intrinsic", name, parameters, requiredParameters, result };
}

export function apiIntrinsic(name: string, parameterNames: readonly string[], parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "intrinsic", name, parameterNames, parameters, requiredParameters, result };
}

export function promise(value: ValueType): ValueType {
  return { kind: "promise", value };
}

export function object(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)) };
}

export const unknownType: ValueType = { kind: "unknown" };
// D90 R17: accept-anything positions are `unknown`, the top type for
// assignment targets; the analyzer's intrinsic handlers compute the real
// per-call types, so nothing here ever hands back an unchecked `any`.
export const listUnknown: ValueType = { kind: "list", element: unknownType };
export const listNumber: ValueType = { kind: "list", element: numberType };
export const listString: ValueType = { kind: "list", element: stringType };
export const mapString = (value: ValueType): ValueType => ({ kind: "map", key: stringType, value });

export function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  typeAliases: ReadonlyMap<string, ValueType> = new Map(),
  namedTypeReadonlyFields: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  enums: ModuleInterface["enums"] = new Map(),
  genericTypes: NonNullable<ModuleInterface["genericTypes"]> = new Map(),
): ModuleInterface {
  return { exports, mutableExports: new Set(), reactiveExports: new Map(), reExports: new Map(), namedTypes, namedTypeReadonlyFields, namedTypeIdentities, genericTypes, typeAliases, enums, classes, tests: [], extensionExports: new Map(), extensionData: new Map() };
}

