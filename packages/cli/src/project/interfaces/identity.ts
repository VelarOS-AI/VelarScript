import {
  analysisTypeIdentity,
  type CompilerExtension,
  type ModuleInspection,
  type ValueType,
} from "@velarscript/compiler";
import { byCodeUnit } from "../../stable-order.ts";

/**
 * The identity encoding: a length-prefixed node, so that no segment's text can
 * be read as another segment's structure. The four builders below are shared by
 * every segment of the digest, which is why they are module-level rather than
 * closures over one call.
 */
const node = (kind: string, parts: readonly string[] = []): string => (
  `${kind.length}:${kind}${parts.map((part) => `${part.length}:${part}`).join("")}`
);
const typeMap = (values: ReadonlyMap<string, ValueType>): string => node("type-map", [...values]
  .sort(([left], [right]) => byCodeUnit(left, right))
  .map(([name, type]) => node("type-entry", [name, analysisTypeIdentity(type)])));
const names = (values: ReadonlySet<string>): string => node("names", [...values].sort());
const types = (values: readonly ValueType[]): string => node("types", values.map(analysisTypeIdentity));

function namedTypesSegment(interface_: ModuleInspection["moduleInterface"]): string {
  return node("named-types", [...interface_.namedTypes]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, fields]) => node("named-type", [name, typeMap(fields)])));
}

function namedTypeReadonlyFieldsSegment(interface_: ModuleInspection["moduleInterface"]): string {
  return node("named-type-readonly-fields", [...(interface_.namedTypeReadonlyFields ?? new Map())]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, fields]) => node("named-type-readonly", [name, names(fields)])));
}

function namedTypeIdentitiesSegment(interface_: ModuleInspection["moduleInterface"]): string {
  return node("named-type-identities", [...interface_.namedTypeIdentities]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, identity]) => node("named-type-identity", [name, identity])));
}

function namedTypeBasesSegment(interface_: ModuleInspection["moduleInterface"]): string {
  return node("named-type-bases", [...(interface_.namedTypeBases ?? new Map())]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, base]) => node("named-type-base", [name, analysisTypeIdentity(base)])));
}

// D55 rule 120, and batch M's lesson one layer out: a dependent compiled
// against the parameter list, the bounds, *and* the template's field types.
// A change to any of the three has to invalidate that dependent's cache — a
// bound that does not enter this hash is a constraint that silently
// disappears from every module already built against it.
function genericTypesSegment(interface_: ModuleInspection["moduleInterface"]): string {
  return node("generic-types", [...(interface_.genericTypes ?? new Map())]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, info]) => node("generic-type", [
      name,
      info.identity,
      node("parameter-names", info.parameterNames),
      node("parameter-bounds", info.parameterBounds.map((bound: string | null) => bound ?? "")),
      typeMap(info.fields),
      names(info.readonlyFields ?? new Set()),
    ])));
}

function enumsSegment(interface_: ModuleInspection["moduleInterface"]): string {
  return node("enums", [...interface_.enums]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, info]) => node("enum", [
      name,
      info.identity,
      names(info.members),
      // D102 ruling 1: a wire value is a string or a safe integer, and the two
      // kinds are different values. The hash carries the JSON spelling so a
      // member moving from `"2"` to `2` invalidates every dependent built
      // against the old one — the digest is what decides that, and a bare
      // `String(value)` would make the change invisible to it.
      node("wire-values", [...info.wireValues]
        .sort(([left], [right]) => byCodeUnit(left, right))
        .map(([member, value]) => node("wire-value", [member, JSON.stringify(value)]))),
    ])));
}

function classesSegment(interface_: ModuleInspection["moduleInterface"]): string {
  return node("classes", [...interface_.classes]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, info]) => node("class", [
      name,
      info.identity ?? "",
      info.base ?? "",
      info.abstract ? "abstract" : "",
      // A dependent's `using` analysis consumes both the presence of the
      // release contract and whether it must await. Neither is represented by
      // the ordinary class members below, so both states belong here.
      info.dispose ?? "",
      // D55 rule 120 layer two, and batch M's lesson one layer out again: a
      // dependent compiled against the parameter list, the bounds, and the
      // arguments this class applies to its base. A bound that does not enter
      // this hash is a constraint that silently disappears from every module
      // already built against it.
      node("type-parameter-names", info.typeParameterNames ?? []),
      node("type-parameter-bounds", (info.typeParameterBounds ?? []).map((bound) => bound ?? "")),
      node("base-application", info.baseApplication
        ? [info.baseApplication.declaration, info.baseApplication.name, types(info.baseApplication.arguments)]
        : []),
      node("parameter-names", info.parameterNames ?? []),
      String(info.requiredParameters),
      types(info.parameters),
      info.constructorRest ? analysisTypeIdentity(info.constructorRest) : "",
      // D68 rule 177: the iteration contract is part of what a dependent
      // compiled against, so changing it has to invalidate the dependent.
      info.iterate ? analysisTypeIdentity(info.iterate) : "",
      names(info.getters),
      names(info.abstractGetters),
      names(info.abstractMethods),
      names(info.staticGetters),
      typeMap(new Map([
        ...[...info.fields].map(([field, value]) => [`field:${field}:${value.mutable ? "let" : "const"}`, value.type] as const),
        ...[...info.methods].map(([method, type]) => [`method:${method}`, type] as const),
        ...[...info.staticFields].map(([field, value]) => [`static-field:${field}:${value.mutable ? "let" : "const"}`, value.type] as const),
        ...[...info.staticMethods].map(([method, type]) => [`static-method:${method}`, type] as const),
      ])),
    ])));
}

function extensionExportsSegment(
  interface_: ModuleInspection["moduleInterface"],
  extensions: readonly CompilerExtension[],
): string {
  const extensionOwners = new Map(extensions.map((extension) => [extension.id, extension]));
  let extensionIdentitySize = 0;
  const extensionSegment = (value: string): string => {
    extensionIdentitySize += value.length;
    if (extensionIdentitySize > 1024 * 1024) {
      throw new Error("Compiler extension interface identities cannot exceed 1 MiB per module");
    }
    return `${value.length}:${value}`;
  };
  return node("extension-exports", [...interface_.extensionExports]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([extensionId, values]) => {
      const identify = extensionOwners.get(extensionId)?.inspection?.interfaceExportIdentity;
      if (!identify) {
        throw new Error(`Compiler extension '${extensionId}' exports cross-module interface data without an interfaceExportIdentity contract`);
      }
      const entries = [...values]
        .sort(([left], [right]) => byCodeUnit(left, right))
        .map(([name, value]) => {
          const identity = identify(name, value);
          if (typeof identity !== "string" || identity.length > 1024 * 1024) {
            throw new Error(`Compiler extension '${extensionId}' returned an invalid interface identity for '${name}'`);
          }
          return node("extension-export", [extensionSegment(name), extensionSegment(identity)]);
      });
      return node("extension", [extensionSegment(extensionId), ...entries]);
    }));
}

export function moduleInterfaceIdentity(
  interface_: ModuleInspection["moduleInterface"],
  extensions: readonly CompilerExtension[] = [],
): string {
  const namedTypes = namedTypesSegment(interface_);
  const namedTypeReadonlyFields = namedTypeReadonlyFieldsSegment(interface_);
  const namedTypeIdentities = namedTypeIdentitiesSegment(interface_);
  const namedTypeBases = namedTypeBasesSegment(interface_);
  const genericTypes = genericTypesSegment(interface_);
  const enums = enumsSegment(interface_);
  const classes = classesSegment(interface_);
  const extensionExports = extensionExportsSegment(interface_, extensions);
  return node("module-interface", [
    typeMap(interface_.exports),
    names(interface_.mutableExports),
    namedTypes,
    namedTypeReadonlyFields,
    namedTypeIdentities,
    node("runtime-type-exports", [...(interface_.runtimeTypeExports ?? new Map<string, string>())]
      .sort(([left], [right]) => byCodeUnit(left, right))
      .map(([identity, exported]) => node("runtime-type-export", [identity, exported]))),
    namedTypeBases,
    genericTypes,
    typeMap(interface_.typeAliases),
    enums,
    classes,
    node("reactive", [...interface_.reactiveExports]
      .sort(([left], [right]) => byCodeUnit(left, right))
      .map(([name, kind]) => node("reactive-entry", [name, kind]))),
    node("re-exports", [...interface_.reExports]
      .sort(([left], [right]) => byCodeUnit(left, right))
      .map(([name, target]) => node("re-export", [name, target.source, target.imported]))),
    node("tests", interface_.tests.map((item) => `${item.name}\u0000${item.title}`).sort()),
    extensionExports,
  ]);
}
