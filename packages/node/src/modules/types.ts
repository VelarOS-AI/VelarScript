/**
 * The type vocabulary every `velar/*` table in `modules/` is written in.
 *
 * D115 §三, the shape `packages/core/src/interfaces/types.ts` already has: the
 * primitive `ValueType` singletons, the constructors a Node export is built
 * with, and the `ModuleInterface` constructor that fills in the fields a Node
 * module never uses. What one surface alone owns lives in that surface's file.
 */
import type { ClassInfo, EnumInfo, ModuleInterface, ValueType } from "@velarscript/compiler";

export const unknownType: ValueType = { kind: "unknown" };
export const nullType: ValueType = { kind: "null" };
export const stringType: ValueType = { kind: "string" };
export const numberType: ValueType = { kind: "number" };
export const boolType: ValueType = { kind: "bool" };
export const bytesType: ValueType = { kind: "named", name: "Bytes", identity: "velar/binary#type:Bytes" };
export const cancellationType: ValueType = { kind: "named", name: "Cancellation", identity: "velar/task#type:Cancellation" };
export const listStringType: ValueType = { kind: "list", element: stringType };
export const stringMapType: ValueType = { kind: "map", key: stringType, value: stringType };

export function promise(value: ValueType): ValueType {
  return { kind: "promise", value };
}

export function functionType(
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType {
  return { kind: "function", parameterNames, parameters, requiredParameters, result };
}

export function namedIntrinsic(
  name: string,
  parameterNames: readonly string[],
  parameters: readonly ValueType[],
  result: ValueType,
  requiredParameters = parameters.length,
): ValueType {
  return { kind: "intrinsic", name, parameterNames, parameters, requiredParameters, result };
}

/** A structurally declared standard capability handle; see ValueType.capabilityHandle. */
export function capabilityHandle(fields: Readonly<Record<string, ValueType>>): ValueType {
  return { kind: "object", fields: new Map(Object.entries(fields)), capabilityHandle: true };
}

export function object(fields: Readonly<Record<string, ValueType>>, optionalFields: readonly string[] = [], readonlyFields: readonly string[] = []): ValueType {
  return {
    kind: "object",
    fields: new Map(Object.entries(fields)),
    ...(optionalFields.length > 0 ? { optionalFields: new Set(optionalFields) } : {}),
    ...(readonlyFields.length > 0 ? { readonlyFields: new Set(readonlyFields) } : {}),
  };
}

export function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  typeAliases: ReadonlyMap<string, ValueType> = new Map(),
  classes: ReadonlyMap<string, ClassInfo> = new Map(),
  enums: ReadonlyMap<string, EnumInfo> = new Map(),
  namedTypeReadonlyFields: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): ModuleInterface {
  return {
    exports,
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes,
    namedTypeReadonlyFields,
    namedTypeIdentities,
    typeAliases,
    enums,
    classes,
    tests: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

