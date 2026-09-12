import { createHash } from "node:crypto";
import type { ModuleInterface, ValueType } from "@velarscript/compiler";

/** Internal ESM names are separate from names Velar source may import. */
export function ownRuntimeTypeExports(interface_: ModuleInterface): Map<string, string> {
  const exports = new Map<string, string>();
  for (const [name, identity] of interface_.namedTypeIdentities) {
    if (name !== identity) exports.set(identity, `__velarRuntimeType_${name}`);
  }
  for (const [name, info] of interface_.enums) {
    if (name !== info.identity) exports.set(info.identity, `__velarRuntimeType_${name}`);
  }
  for (const [name, info] of interface_.classes) {
    // Extern classes have JavaScript owners, not a declaration in this module.
    if (info.identity?.startsWith("velar:") && name !== info.identity) exports.set(info.identity, `__velarRuntimeType_${name}`);
  }
  return exports;
}

/** A bounded stable name at each existing import edge, independent of physical identity paths. */
export function forwardedRuntimeTypeExport(source: string, imported: string): string {
  return `__velarRuntimeTypeForward_${createHash("sha256").update(JSON.stringify([source, imported])).digest("hex")}`;
}

/** Old artifacts and standard modules can still route their publicly exported Type values. */
export function publishedRuntimeTypeExports(interface_: ModuleInterface): ReadonlyMap<string, string> {
  if (interface_.runtimeTypeExports !== undefined) return interface_.runtimeTypeExports;
  const exports = new Map<string, string>();
  for (const [name, type] of interface_.exports) {
    if (type.kind === "typeObject") {
      const identity = interface_.namedTypeIdentities.get(name)
        ?? interface_.genericTypes?.get(name)?.identity
        ?? ((type.value?.kind === "named" || type.value?.kind === "enum") ? type.value.identity : undefined);
      if (identity) exports.set(identity, name);
    } else if (type.kind === "classConstructor" || type.kind === "enumObject") {
      if (type.identity) exports.set(type.identity, name);
    }
  }
  return exports;
}

/** The nominal identities mentioned by a type; shared with standard-module metadata reachability. */
export function collectTypeIdentities(type: ValueType, into: Set<string>, available?: ReadonlySet<string>): void {
  switch (type.kind) {
    case "named":
      if (type.identity && (!available || !type.application || available.has(type.identity))) into.add(type.identity);
      if (type.application) {
        if (!available?.has(type.identity ?? "")) into.add(type.application.declaration);
        for (const argument of type.application.arguments) collectTypeIdentities(argument, into, available);
      }
      return;
    case "class":
      if (type.application) {
        into.add(type.application.declaration);
        for (const argument of type.application.arguments) collectTypeIdentities(argument, into, available);
      }
      if (type.identity) into.add(type.identity);
      return;
    case "classConstructor":
    case "enum":
    case "enumMember":
    case "enumObject":
      if (type.identity) into.add(type.identity);
      return;
    case "typeObject":
      if (type.value) collectTypeIdentities(type.value, into, available);
      return;
    case "optional":
      collectTypeIdentities(type.inner, into, available);
      return;
    case "list":
    case "set":
      collectTypeIdentities(type.element, into, available);
      return;
    case "map":
      collectTypeIdentities(type.key, into, available);
      collectTypeIdentities(type.value, into, available);
      return;
    case "record":
    case "promise":
    case "runtimeType":
      collectTypeIdentities(type.value, into, available);
      return;
    case "object":
      for (const field of type.fields.values()) collectTypeIdentities(field, into, available);
      return;
    case "function":
    case "action":
    case "intrinsic":
      for (const parameter of type.parameters) collectTypeIdentities(parameter, into, available);
      if (type.rest) collectTypeIdentities(type.rest, into, available);
      collectTypeIdentities(type.result, into, available);
      return;
    case "extension":
      for (const property of type.properties.values()) collectTypeIdentities(property, into, available);
      for (const argument of type.arguments) collectTypeIdentities(argument, into, available);
      return;
    case "union":
      for (const member of type.members) collectTypeIdentities(member, into, available);
      return;
    default:
  }
}

/** Keep only imported validators reachable through this module's public signatures. */
export function reachableRuntimeTypeIdentities(interface_: ModuleInterface, available?: ReadonlySet<string>): ReadonlySet<string> {
  const reached = new Set<string>();
  for (const type of interface_.exports.values()) collectTypeIdentities(type, reached, available);
  const fields = new Map(interface_.namedTypes);
  const bases = new Map(interface_.namedTypeBases);
  for (const [name, identity] of interface_.namedTypeIdentities) {
    const own = interface_.namedTypes.get(name);
    if (own) fields.set(identity, own);
    const base = interface_.namedTypeBases?.get(name);
    if (base) bases.set(identity, base);
  }
  const generics = new Map([...(interface_.genericTypes?.values() ?? [])].map((info) => [info.identity, info]));
  const classes = new Map([...interface_.classes.values()].flatMap((info) => info.identity ? [[info.identity, info] as const] : []));
  for (const identity of reached) {
    for (const type of fields.get(identity)?.values() ?? []) collectTypeIdentities(type, reached, available);
    const base = bases.get(identity);
    if (base) collectTypeIdentities(base, reached, available);
    for (const type of generics.get(identity)?.fields.values() ?? []) collectTypeIdentities(type, reached, available);
    const class_ = classes.get(identity);
    if (class_) {
      for (const field of class_.fields.values()) collectTypeIdentities(field.type, reached, available);
      for (const method of class_.methods.values()) collectTypeIdentities(method, reached, available);
    }
  }
  return reached;
}


/** Frozen artifacts must publish validators for their checkable public contracts. */
export function missingArtifactRuntimeTypes(interface_: ModuleInterface, externalOwners: ReadonlySet<string>): readonly string[] {
  const available = new Set([...publishedRuntimeTypeExports(interface_).keys(), ...externalOwners]);
  const checkable = new Set([...interface_.namedTypes.keys(), ...interface_.namedTypeIdentities.values()]);
  for (const info of interface_.genericTypes?.values() ?? []) checkable.add(info.identity);
  for (const info of interface_.enums.values()) checkable.add(info.identity);
  for (const info of interface_.classes.values()) {
    if (info.identity?.startsWith("velar:")) checkable.add(info.identity);
  }
  return [...reachableRuntimeTypeIdentities(interface_, available)].filter((identity) => checkable.has(identity) && !available.has(identity));
}
