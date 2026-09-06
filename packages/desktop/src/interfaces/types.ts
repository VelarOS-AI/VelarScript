/**
 * The type vocabulary every Desktop `velar/*` interface table is written in,
 * and the two screen-geometry records `velar/window` and `velar/desktop` share.
 *
 * D115 §三: one file per module interface, and this is what they have in common.
 */
import { optionalOf, type EnumInfo, type ModuleInterface, type ValueType } from "@velarscript/compiler";

export const stringType: ValueType = { kind: "string" };
export const boolType: ValueType = { kind: "bool" };
export const numberType: ValueType = { kind: "number" };
export const nullType: ValueType = { kind: "null" };
export const optionalStringType = optionalOf(stringType);

export function functionType(parameters: readonly ValueType[], result: ValueType, requiredParameters = parameters.length): ValueType {
  return { kind: "function", parameters, requiredParameters, result };
}

export function promiseOf(value: ValueType): ValueType {
  return { kind: "promise", value };
}

export function listOf(element: ValueType): ValueType {
  return { kind: "list", element };
}

export function objectType(fields: Readonly<Record<string, ValueType>>, optionalFields: readonly string[] = []): ValueType {
  return {
    kind: "object",
    fields: new Map(Object.entries(fields)),
    ...(optionalFields.length > 0 ? { optionalFields: new Set(optionalFields) } : {}),
  };
}

export function moduleInterface(
  exports: ReadonlyMap<string, ValueType>,
  namedTypes: ReadonlyMap<string, ReadonlyMap<string, ValueType>> = new Map(),
  namedTypeIdentities: ReadonlyMap<string, string> = new Map(),
  enums: ReadonlyMap<string, EnumInfo> = new Map(),
  typeAliases: ReadonlyMap<string, ValueType> = new Map(),
): ModuleInterface {
  return {
    exports,
    mutableExports: new Set(),
    reactiveExports: new Map(),
    reExports: new Map(),
    namedTypes,
    namedTypeIdentities,
    typeAliases,
    enums,
    classes: new Map(),
    tests: [],
    extensionExports: new Map(),
    extensionData: new Map(),
  };
}

// The two screen-geometry records `velar/window` and `velar/desktop` share.
// `WindowBounds` is published by the first and `Display` by the second, and
// both are type aliases, which are structural: `Window.display()` and
// `displays()` therefore answer one record rather than two that look alike.
// This is the single definition; each generated module validates it again on
// its own side of the bridge, which is the boundary discipline, not a copy of
// the shape.
export const windowBoundsType = objectType({ x: numberType, y: numberType, width: numberType, height: numberType });
export const displayType = objectType({
  id: stringType,
  bounds: windowBoundsType,
  workArea: windowBoundsType,
  scale: numberType,
  primary: boolType,
});

export function enumEntry(module: string, name: string, members: readonly string[]): {
  readonly identity: string;
  readonly members: Set<string>;
  readonly object: ValueType;
  readonly value: ValueType;
  readonly info: EnumInfo;
} {
  const identity = `${module}#enum:${name}`;
  const set = new Set(members);
  return {
    identity,
    members: set,
    object: { kind: "enumObject", name, identity, members: set },
    value: { kind: "enum", name, identity },
    // Every module-provided enum in this target maps a member to itself on the
    // wire; the D60 rule 149 gate reads the runtime binding and requires
    // `Enum.member === "member"`, so the two cannot drift apart.
    info: { identity, members: set, wireValues: new Map(members.map((member) => [member, member])) },
  };
}
