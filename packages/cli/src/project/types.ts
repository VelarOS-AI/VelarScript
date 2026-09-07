import {
  classApplicationType,
  genericApplicationIdentity,
  genericApplicationType,
  optionalOf,
  readonlyViewOf,
  type ClassInfo,
  type EnumInfo,
  type GenericTypeInfo,
  type ValueType,
} from "@velarscript/compiler";

export function renameClass(info: ClassInfo, aliases: ReadonlyMap<string, string>): ClassInfo {
  return mapClassInfo(
    info,
    (type) => renameType(type, aliases),
    (base) => aliases.get(base) ?? base,
  );
}

/**
 * Rebuilds the type-bearing parts of a class interface while preserving every
 * other contract field by construction. ClassInfo has gained independent
 * fields such as `dispose` and `iterate`; spelling the whole object at each
 * import/re-export seam made every addition an easy silent omission.
 */
export function mapClassInfo(
  info: ClassInfo,
  mapType: (type: ValueType) => ValueType,
  mapBase: (base: string) => string,
): ClassInfo {
  // D55 rule 120 layer two: a generic base crosses as its parts. The key is
  // recomputed from the mapped declaration and arguments rather than mapped as
  // a string, because `Stack<number>` is not a name any table is keyed by — it
  // is a function of two things that each cross on their own.
  const baseApplication = info.baseApplication
    ? {
      ...info.baseApplication,
      declaration: mapBase(info.baseApplication.declaration),
      arguments: info.baseApplication.arguments.map(mapType),
    }
    : undefined;
  return {
    ...info,
    // D68 rule 177: the iteration contract is part of the class, so its answer
    // is transformed with every other type-bearing member.
    ...(info.iterate ? { iterate: mapType(info.iterate) } : {}),
    ...(baseApplication ? { baseApplication } : {}),
    parameters: info.parameters.map(mapType),
    ...(info.constructorRest ? { constructorRest: mapType(info.constructorRest) } : {}),
    base: baseApplication
      ? genericApplicationIdentity(baseApplication.declaration, baseApplication.arguments)
      : info.base ? mapBase(info.base) : null,
    fields: new Map([...info.fields].map(([name, field]) => [name, { ...field, type: mapType(field.type) }])),
    methods: new Map([...info.methods].map(([name, type]) => [name, mapType(type)])),
    staticFields: new Map([...info.staticFields].map(([name, field]) => [name, { ...field, type: mapType(field.type) }])),
    staticMethods: new Map([...info.staticMethods].map(([name, type]) => [name, mapType(type)])),
  };
}

export function renameType(type: ValueType, aliases: ReadonlyMap<string, string>): ValueType {
  switch (type.kind) {
    // D55 rule 121: an application renames through the declaration it applies,
    // not through its display text — `Box<string>` is not a name an import can
    // alias, but `Box` is, and its arguments rename like any other type.
    case "named":
      if (type.application) {
        const renamed = aliases.get(type.application.name) ?? type.application.name;
        return genericApplicationType(
          type.application.declaration,
          renamed,
          type.application.arguments.map((argument) => renameType(argument, aliases)),
          type.readonlyView === true,
        );
      }
      return { ...type, name: aliases.get(type.name) ?? type.name };
    case "class":
      // D55 rule 120 layer two: an instantiation renames through the class it
      // applies, never through its display text — `Stack<number>` is not a
      // name an import can alias, but `Stack` is.
      if (type.application) {
        return classApplicationType(
          type.application.declaration,
          aliases.get(type.application.name) ?? type.application.name,
          type.application.arguments.map((argument) => renameType(argument, aliases)),
        );
      }
      return { ...type, name: aliases.get(type.name) ?? type.name };
    case "enum":
    case "enumMember":
    case "classConstructor":
      return { ...type, name: aliases.get(type.name) ?? type.name };
    case "typeObject":
      return {
        ...type,
        name: aliases.get(type.name) ?? type.name,
        ...(type.value ? { value: renameType(type.value, aliases) } : {}),
      };
    case "enumObject":
      return { ...type, name: aliases.get(type.name) ?? type.name };
    case "optional":
      return optionalOf(renameType(type.inner, aliases));
    case "list":
      return { ...type, element: renameType(type.element, aliases) };
    case "set":
      return { ...type, element: renameType(type.element, aliases) };
    case "map":
      return { ...type, key: renameType(type.key, aliases), value: renameType(type.value, aliases) };
    case "record":
      return { ...type, value: renameType(type.value, aliases) };
    case "promise":
      return { kind: "promise", value: renameType(type.value, aliases) };
    case "runtimeType":
      return { kind: "runtimeType", value: renameType(type.value, aliases) };
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, renameType(value, aliases)])) };
    case "function":
    case "action":
      return {
        ...type,
        parameters: type.parameters.map((parameter) => renameType(parameter, aliases)),
        ...(type.rest ? { rest: renameType(type.rest, aliases) } : {}),
        result: renameType(type.result, aliases),
      };
    case "intrinsic":
      return {
        ...type,
        parameters: type.parameters.map((parameter) => renameType(parameter, aliases)),
        ...(type.rest ? { rest: renameType(type.rest, aliases) } : {}),
        result: renameType(type.result, aliases),
      };
    case "extension":
      return {
        ...type,
        ...(type.nominal ? { nominal: aliases.get(type.nominal) ?? type.nominal } : {}),
        properties: new Map([...type.properties].map(([name, value]) => [name, renameType(value, aliases)])),
        arguments: type.arguments.map((argument) => renameType(argument, aliases)),
      };
    case "union":
      return { kind: "union", members: type.members.map((member) => renameType(member, aliases)) };
    default:
      return type;
  }
}

export function resolveKnownNominals(
  type: ValueType,
  classes: ReadonlyMap<string, ClassInfo>,
  enums: ReadonlyMap<string, EnumInfo>,
  namedTypeIdentities: ReadonlyMap<string, string>,
  genericTypes: ReadonlyMap<string, GenericTypeInfo> = new Map(),
): ValueType {
  const resolveNested = (nested: ValueType): ValueType => resolveKnownNominals(
    nested,
    classes,
    enums,
    namedTypeIdentities,
    genericTypes,
  );
  // D55 rule 121: the importing side of the same crossing `resolveNominals`
  // makes on the exporting side. Both call one constructor, so the identity
  // computed here and the identity published there are the same string.
  if (type.kind === "named" && type.application) {
    const arguments_ = type.application.arguments.map(resolveNested);
    const declaration = genericTypes.get(type.application.name)?.identity
      ?? namedTypeIdentities.get(type.application.name)
      ?? type.application.declaration;
    return genericApplicationType(declaration, type.application.name, arguments_, type.readonlyView === true);
  }
  // D55 rule 120 layer two: the same crossing for a class application — the
  // declaration becomes the identity the exporting module published, so both
  // sides compute one instantiation identity for `Stack<number>`.
  if (type.kind === "class" && type.application) {
    const arguments_ = type.application.arguments.map(resolveNested);
    const declaration = classes.get(type.application.name)?.identity ?? type.application.declaration;
    return classApplicationType(declaration, type.application.name, arguments_);
  }
  if (type.kind === "named" && classes.has(type.name)) {
    const identity = classes.get(type.name)?.identity;
    return {
      kind: "class",
      name: type.name,
      ...(identity ? { identity } : {}),
    };
  }
  if (type.kind === "named" && enums.has(type.name)) return { kind: "enum", name: type.name, identity: enums.get(type.name)!.identity };
  if (type.kind === "enumMember" && enums.has(type.name)
    && type.identity === type.name) return { ...type, identity: enums.get(type.name)!.identity };
  if (type.kind === "named" && !type.identity && namedTypeIdentities.has(type.name)) {
    return { ...type, identity: namedTypeIdentities.get(type.name)! };
  }
  switch (type.kind) {
    case "optional":
      return optionalOf(resolveNested(type.inner));
    case "list":
      return { ...type, element: resolveNested(type.element) };
    case "set":
      return { ...type, element: resolveNested(type.element) };
    case "map":
      return { ...type, key: resolveNested(type.key), value: resolveNested(type.value) };
    case "record":
      return { ...type, value: resolveNested(type.value) };
    case "promise":
      return { kind: "promise", value: resolveNested(type.value) };
    case "runtimeType":
      return { kind: "runtimeType", value: resolveNested(type.value) };
    case "typeObject":
      return type.value
        ? { ...type, value: resolveNested(type.value) }
        : type;
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, resolveNested(value)])) };
    case "function":
    case "action":
    case "intrinsic":
      return {
        ...type,
        parameters: type.parameters.map(resolveNested),
        ...(type.rest ? { rest: resolveNested(type.rest) } : {}),
        result: resolveNested(type.result),
      };
    case "extension":
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, resolveNested(value)])),
        arguments: type.arguments.map(resolveNested),
      };
    case "union":
      return { kind: "union", members: type.members.map(resolveNested) };
    default:
      return type;
  }
}

export function expandKnownAliases(type: ValueType, aliases: ReadonlyMap<string, ValueType>, seen: ReadonlySet<string> = new Set()): ValueType {
  if (type.kind === "named" && aliases.has(type.name)) {
    if (seen.has(type.name)) return { kind: "unknown" };
    const expanded = expandKnownAliases(aliases.get(type.name)!, aliases, new Set([...seen, type.name]));
    return type.readonlyView ? readonlyViewOf(expanded) : expanded;
  }
  switch (type.kind) {
    // D55 rule 121: aliases stay transparent inside a type argument, on this
    // side of the boundary as on the other.
    case "named":
      return type.application
        ? { ...type, application: { ...type.application, arguments: type.application.arguments.map((argument) => expandKnownAliases(argument, aliases, seen)) } }
        : type;
    case "optional":
      return optionalOf(expandKnownAliases(type.inner, aliases, seen));
    case "list":
      return { ...type, element: expandKnownAliases(type.element, aliases, seen) };
    case "set":
      return { ...type, element: expandKnownAliases(type.element, aliases, seen) };
    case "map":
      return { ...type, key: expandKnownAliases(type.key, aliases, seen), value: expandKnownAliases(type.value, aliases, seen) };
    case "record":
      return { ...type, value: expandKnownAliases(type.value, aliases, seen) };
    case "promise":
      return { kind: "promise", value: expandKnownAliases(type.value, aliases, seen) };
    case "runtimeType":
      return { kind: "runtimeType", value: expandKnownAliases(type.value, aliases, seen) };
    case "typeObject":
      return type.value ? { ...type, value: expandKnownAliases(type.value, aliases, seen) } : type;
    case "object":
      return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, expandKnownAliases(value, aliases, seen)])) };
    case "function":
    case "action":
    case "intrinsic":
      return {
        ...type,
        parameters: type.parameters.map((parameter) => expandKnownAliases(parameter, aliases, seen)),
        ...(type.rest ? { rest: expandKnownAliases(type.rest, aliases, seen) } : {}),
        result: expandKnownAliases(type.result, aliases, seen),
      };
    case "extension":
      return {
        ...type,
        properties: new Map([...type.properties].map(([name, value]) => [name, expandKnownAliases(value, aliases, seen)])),
        arguments: type.arguments.map((argument) => expandKnownAliases(argument, aliases, seen)),
      };
    case "union":
      return { kind: "union", members: type.members.map((member) => expandKnownAliases(member, aliases, seen)) };
    default:
      return type;
  }
}
