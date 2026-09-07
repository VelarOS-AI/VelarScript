/**
 * One declaration file, read into a bridge. `parseTypeScriptDeclarations` runs
 * the phases in order — the file's type vocabulary, its classes, its values,
 * then the exports that name them — and each phase below owns one of them.
 */
import { semanticTypeIdentity, type ClassInfo, type ValueType } from "@velarscript/compiler";
import { MAX_TYPESCRIPT_DECLARATION_BYTES } from "../typescript-declaration-source.ts";
import {
  unique,
  unknownType,
  unsupportedType,
  type DeclarationDirection,
  type TypeScriptDeclarationBridge,
} from "./bridge.ts";
import { parseClassDeclaration, readClassDeclarations, type TypeScriptClassDeclaration } from "./classes.ts";
import { parseParameters } from "./parameters.ts";
import { excludeAmbientBlocks, splitTopLevel, stripDeclarationComments } from "./scanning.ts";
import { readFunctionSignature } from "./signatures.ts";
import { parseTsType } from "./types.ts";

/** The named types the file declares, and which of them it exports directly. */
interface DeclarationTypeIndex {
  readonly aliases: Map<string, string>;
  readonly interfaces: Map<string, { readonly bases: readonly string[]; readonly body: string }>;
  readonly invalidInterfaces: Set<string>;
  readonly directlyExportedTypes: Set<string>;
}

/** What the file declares locally, before any export statement names it. */
interface DeclarationLocals {
  readonly values: Map<string, ValueType>;
  readonly types: Map<string, ValueType>;
  readonly classes: Map<string, ClassInfo>;
  readonly runtimeExports: { readonly local: string; readonly exported: string }[];
}

export function parseTypeScriptDeclarations(
  source: string,
  path = "<types>",
  moduleSource = path,
  reexportsHandled = false,
  importedTypes: ReadonlyMap<string, ValueType> = new Map(),
  importedClassRegistry: ReadonlyMap<string, ClassInfo> = new Map(),
  ownModules: ReadonlySet<string> = new Set(),
): TypeScriptDeclarationBridge {
  if (Buffer.byteLength(source, "utf8") > MAX_TYPESCRIPT_DECLARATION_BYTES) {
    throw new RangeError(`${path} exceeds the 2 MiB TypeScript declaration bridge limit`);
  }
  const warnings: string[] = [];
  const text = excludeAmbientBlocks(stripDeclarationComments(source), warnings, ownModules);
  const index = collectDeclarationTypes(text, warnings);
  resolveDeclarationInterfaces(index, warnings);

  const exports = new Map<string, ValueType>();
  const typeExports = new Map<string, ValueType>();
  const classes = new Map<string, ClassInfo>();
  const classRegistry = new Map<string, ClassInfo>();
  const locals: DeclarationLocals = { values: new Map(), types: new Map(), classes: new Map(), runtimeExports: [] };
  const classDeclarations = readClassDeclarations(text, warnings);
  const knownTypes = classDeclarationTypes(classDeclarations, moduleSource, importedTypes);
  const parse = (value: string, direction: DeclarationDirection = "from-js"): ValueType => parseTsType(value, index.aliases, warnings, new Set(), knownTypes, direction);
  const classCounts = new Map<string, number>();
  for (const declaration of classDeclarations) classCounts.set(declaration.name, (classCounts.get(declaration.name) ?? 0) + 1);
  readDeclarationClasses(classDeclarations, classCounts, index, locals, knownTypes, parse, warnings, moduleSource);
  pruneUnsupportedClassBases(locals.classes, importedClassRegistry, knownTypes, warnings);
  rejectCyclicClassInheritance(locals.classes, importedClassRegistry, knownTypes, warnings);
  rejectIncompatibleInheritedMembers(locals.classes, importedClassRegistry, knownTypes, warnings);
  // Dropping a class for a cyclic or an incompatible contract can leave its own
  // subclass without an accepted base, so the base sweep runs again behind them.
  pruneUnsupportedClassBases(locals.classes, importedClassRegistry, knownTypes, warnings);

  materializeDeclarationLocals(classDeclarations, classCounts, index, locals, classRegistry, parse);
  collectDeclarationValues(text, locals, parse, warnings);
  appendDeclarationExports(text, index, locals, exports, typeExports, classes, warnings);
  if (/export\s*=/u.test(text)) warnings.push("TypeScript export assignment is outside the VelarScript declaration bridge");
  if (!reexportsHandled && (/export\s+\*/u.test(text) || /export\s+(?:type\s+)?\{[^}]+\}\s+from\s*["']/u.test(text))) {
    warnings.push("TypeScript re-export requires the package declaration graph loader");
  }
  return { path, dependencies: [path], exports, typeExports, classes, classRegistry, warnings: unique(warnings) };
}

/** The interfaces and aliases the file declares, in one sweep each. */
function collectDeclarationTypes(text: string, warnings: string[]): DeclarationTypeIndex {
  const aliases = new Map<string, string>();
  const interfaces = new Map<string, { readonly bases: readonly string[]; readonly body: string }>();
  const invalidInterfaces = new Set<string>();
  const directlyExportedTypes = new Set<string>();
  const interfacePattern = /(export\s+)?interface\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([^\{]+))?\s*\{([^{}]*)\}/gu;
  for (const match of text.matchAll(interfacePattern)) {
    const name = match[2]!;
    if (match[1]) directlyExportedTypes.add(name);
    if (interfaces.has(name)) {
      warnings.push(`Merged interface '${name}' is outside the VelarScript declaration bridge and was kept as unknown`);
      invalidInterfaces.add(name);
    }
    interfaces.set(name, {
      bases: (match[3] ?? "").split(",").map((base) => base.trim()).filter(Boolean),
      body: match[4] ?? "",
    });
  }
  const aliasPattern = /(export\s+)?type\s+([A-Za-z_$][\w$]*)(?:\s*<[^=]+>)?\s*=\s*([^;]+);/gu;
  for (const match of text.matchAll(aliasPattern)) {
    const name = match[2]!;
    if (match[1]) directlyExportedTypes.add(name);
    if (aliases.has(name) || interfaces.has(name)) {
      warnings.push(`Merged declaration '${name}' is outside the VelarScript declaration bridge and was kept as unknown`);
      aliases.set(name, "unknown");
      invalidInterfaces.add(name);
    } else aliases.set(name, match[3] ?? "unknown");
  }
  return { aliases, interfaces, invalidInterfaces, directlyExportedTypes };
}

/**
 * Expands every interface into the object-type text its members describe, so
 * that the rest of the file can read an interface name as an alias.
 */
function resolveDeclarationInterfaces(index: DeclarationTypeIndex, warnings: string[]): void {
  const { aliases, interfaces, invalidInterfaces } = index;
  const resolvingInterfaces = new Set<string>();
  const resolveInterface = (name: string): string => {
    if (invalidInterfaces.has(name)) return "unknown";
    const cached = aliases.get(name);
    if (cached) return cached;
    const declaration = interfaces.get(name);
    if (!declaration) return "unknown";
    if (resolvingInterfaces.has(name)) {
      warnings.push(`Recursive interface '${name}' is outside the VelarScript declaration bridge and was kept as unknown`);
      invalidInterfaces.add(name);
      return "unknown";
    }
    resolvingInterfaces.add(name);
    const bodies: string[] = [];
    for (const baseName of declaration.bases) {
      if (!/^[A-Za-z_$][\w$]*$/u.test(baseName)) {
        warnings.push(`Generic or complex interface base '${baseName}' is outside the VelarScript declaration bridge and '${name}' was kept as unknown`);
        invalidInterfaces.add(name);
        resolvingInterfaces.delete(name);
        return "unknown";
      }
      const base = interfaces.has(baseName) ? resolveInterface(baseName) : aliases.get(baseName);
      if (!base?.startsWith("{") || !base.endsWith("}")) {
        warnings.push(`Interface base '${baseName}' cannot be expanded and '${name}' was kept as unknown`);
        invalidInterfaces.add(name);
        resolvingInterfaces.delete(name);
        return "unknown";
      }
      bodies.push(base.slice(1, -1));
    }
    bodies.push(declaration.body);
    resolvingInterfaces.delete(name);
    const resolved = `{${bodies.filter(Boolean).join(";")}}`;
    aliases.set(name, resolved);
    return resolved;
  };
  for (const name of interfaces.keys()) resolveInterface(name);
}

/**
 * Names every class in the file before any of them is read, so that a member
 * typed by a class declared later in the file still resolves.
 */
function classDeclarationTypes(
  classDeclarations: readonly TypeScriptClassDeclaration[],
  moduleSource: string,
  importedTypes: ReadonlyMap<string, ValueType>,
): Map<string, ValueType> {
  const knownTypes = new Map(importedTypes);
  for (const declaration of classDeclarations) {
    const identity = `js:${moduleSource}#${declaration.name}`;
    const type: ValueType = { kind: "class", name: declaration.name, identity };
    knownTypes.set(declaration.name, type);
  }
  return knownTypes;
}

/** Reads each class declaration's members, or keeps that class as unknown. */
function readDeclarationClasses(
  classDeclarations: readonly TypeScriptClassDeclaration[],
  classCounts: ReadonlyMap<string, number>,
  index: DeclarationTypeIndex,
  locals: DeclarationLocals,
  knownTypes: Map<string, ValueType>,
  parse: (value: string, direction?: DeclarationDirection) => ValueType,
  warnings: string[],
  moduleSource: string,
): void {
  const { aliases, interfaces } = index;
  const { classes: localClasses, runtimeExports: directRuntimeExports, types: localTypes, values: localValues } = locals;
  for (const declaration of classDeclarations) {
    if (declaration.directExportName) directRuntimeExports.push({ local: declaration.name, exported: declaration.directExportName });
    if ((classCounts.get(declaration.name) ?? 0) > 1) {
      if (!localTypes.has(declaration.name)) warnings.push(`Duplicate class declaration '${declaration.name}' is outside the VelarScript declaration bridge and was kept as unknown`);
      localTypes.set(declaration.name, unknownType);
      localValues.set(declaration.name, unknownType);
      knownTypes.set(declaration.name, unknownType);
      continue;
    }
    if (interfaces.has(declaration.name) || aliases.has(declaration.name)) {
      warnings.push(`Merged class declaration '${declaration.name}' is outside the VelarScript declaration bridge and was kept as unknown`);
      localTypes.set(declaration.name, unknownType);
      localValues.set(declaration.name, unknownType);
      knownTypes.set(declaration.name, unknownType);
      continue;
    }
    const selfType = knownTypes.get(declaration.name);
    if (selfType) knownTypes.set("this", selfType);
    const parsed = parseClassDeclaration(declaration, parse, warnings, moduleSource, knownTypes);
    knownTypes.delete("this");
    if (!parsed) {
      localTypes.set(declaration.name, unknownType);
      localValues.set(declaration.name, unknownType);
      knownTypes.set(declaration.name, unknownType);
      continue;
    }
    localClasses.set(declaration.name, parsed);
  }
}

/**
 * Drops every class whose base is not itself an accepted class, repeatedly:
 * dropping one class can leave its own subclass without a base.
 */
function pruneUnsupportedClassBases(
  localClasses: Map<string, ClassInfo>,
  importedClassRegistry: ReadonlyMap<string, ClassInfo>,
  knownTypes: Map<string, ValueType>,
  warnings: string[],
): void {
  let removedBase = true;
  while (removedBase) {
    removedBase = false;
    const accepted = new Set([
      ...[...localClasses.values()].map((info) => info.identity).filter((identity): identity is string => Boolean(identity)),
      ...importedClassRegistry.keys(),
    ]);
    for (const [name, info] of localClasses) {
      if (!info.base || info.base === "Error" || accepted.has(info.base)) continue;
      warnings.push(`Class declaration '${name}' has an unsupported base contract and was kept as unknown`);
      localClasses.delete(name);
      knownTypes.set(name, unknownType);
      removedBase = true;
    }
  }
}

/** Drops every class that inherits, directly or through its bases, from itself. */
function rejectCyclicClassInheritance(
  localClasses: Map<string, ClassInfo>,
  importedClassRegistry: ReadonlyMap<string, ClassInfo>,
  knownTypes: Map<string, ValueType>,
  warnings: string[],
): void {
  const byIdentity = new Map<string, { readonly name: string; readonly info: ClassInfo }>([
    ...[...importedClassRegistry].map(([identity, info]) => [identity, { name: identity, info }] as const),
    ...[...localClasses].flatMap(([name, info]) => info.identity ? [[info.identity, { name, info }] as const] : []),
  ]);
  for (const [name, info] of [...localClasses]) {
    const visited = new Set<string>();
    let current: ClassInfo | undefined = info;
    while (current?.identity) {
      if (visited.has(current.identity)) {
        warnings.push(`Class declaration '${name}' has cyclic inheritance and was kept as unknown`);
        localClasses.delete(name);
        knownTypes.set(name, unknownType);
        break;
      }
      visited.add(current.identity);
      current = current.base ? byIdentity.get(current.base)?.info : undefined;
    }
  }
}

/**
 * Drops every class that redeclares an inherited member with a different
 * contract — a field that changed mutability or type, a method that changed
 * signature, or a member whose kind changed between the two.
 */
function rejectIncompatibleInheritedMembers(
  localClasses: Map<string, ClassInfo>,
  importedClassRegistry: ReadonlyMap<string, ClassInfo>,
  knownTypes: Map<string, ValueType>,
  warnings: string[],
): void {
  const acceptedByIdentity = new Map<string, { readonly name: string; readonly info: ClassInfo }>([
    ...[...importedClassRegistry].map(([identity, info]) => [identity, { name: identity, info }] as const),
    ...[...localClasses].flatMap(([name, info]) => info.identity ? [[info.identity, { name, info }] as const] : []),
  ]);
  const inheritedMember = (
    info: ClassInfo,
    name: string,
  ): { readonly kind: "field"; readonly mutable: boolean; readonly type: ValueType } | { readonly kind: "method"; readonly type: ValueType } | null => {
    const visited = new Set<string>();
    let base = info.base;
    while (base && !visited.has(base)) {
      visited.add(base);
      const parent = acceptedByIdentity.get(base)?.info;
      if (!parent) return null;
      const field = parent.fields.get(name);
      if (field) return { kind: "field", mutable: field.mutable, type: field.type };
      const method = parent.methods.get(name);
      if (method) return { kind: "method", type: method };
      base = parent.base;
    }
    return null;
  };
  for (const [name, info] of [...localClasses]) {
    let incompatible = false;
    for (const [memberName, field] of info.fields) {
      const inherited = inheritedMember(info, memberName);
      if (inherited && (inherited.kind !== "field" || inherited.mutable !== field.mutable || semanticTypeIdentity(inherited.type) !== semanticTypeIdentity(field.type))) incompatible = true;
    }
    for (const [memberName, method] of info.methods) {
      const inherited = inheritedMember(info, memberName);
      if (inherited && (inherited.kind !== "method" || semanticTypeIdentity(inherited.type) !== semanticTypeIdentity(method))) incompatible = true;
    }
    if (incompatible) {
      warnings.push(`Class declaration '${name}' has an incompatible inherited member contract and was kept as unknown`);
      localClasses.delete(name);
      knownTypes.set(name, unknownType);
    }
  }
}

/** Gives every accepted type and class its local value and type entries. */
function materializeDeclarationLocals(
  classDeclarations: readonly TypeScriptClassDeclaration[],
  classCounts: ReadonlyMap<string, number>,
  index: DeclarationTypeIndex,
  locals: DeclarationLocals,
  classRegistry: Map<string, ClassInfo>,
  parse: (value: string, direction?: DeclarationDirection) => ValueType,
): void {
  const { aliases, interfaces } = index;
  const { classes: localClasses, types: localTypes, values: localValues } = locals;
  for (const name of new Set([...interfaces.keys(), ...aliases.keys()])) localTypes.set(name, parse(name));
  for (const declaration of classDeclarations) {
    if ((classCounts.get(declaration.name) ?? 0) > 1 || interfaces.has(declaration.name) || aliases.has(declaration.name)) continue;
    const info = localClasses.get(declaration.name);
    if (!info?.identity) {
      localTypes.set(declaration.name, unknownType);
      localValues.set(declaration.name, unknownType);
      continue;
    }
    const instance: ValueType = { kind: "class", name: declaration.name, identity: info.identity };
    localTypes.set(declaration.name, instance);
    localValues.set(declaration.name, { kind: "classConstructor", name: declaration.name, identity: info.identity });
    classRegistry.set(info.identity, info);
  }
}

/** The file's function and const declarations, as local values. */
function collectDeclarationValues(
  text: string,
  locals: DeclarationLocals,
  parse: (value: string, direction?: DeclarationDirection) => ValueType,
  warnings: string[],
): void {
  const { runtimeExports: directRuntimeExports, values: localValues } = locals;
  const setLocalValue = (name: string, type: ValueType, label: string): void => {
    if (localValues.has(name)) {
      warnings.push(`Overloaded export '${name}' or merged local ${label} declaration is outside the VelarScript declaration bridge and was kept as unknown`);
      localValues.set(name, unknownType);
    } else localValues.set(name, type);
  };
  const functions = /(export\s+)?(?:declare\s+)?(default\s+)?function\s+([A-Za-z_$][\w$]*)/gu;
  for (const match of text.matchAll(functions)) {
    const local = match[3]!;
    const exported = match[2] ? "default" : local;
    if (match[1]) directRuntimeExports.push({ local, exported });
    const signature = readFunctionSignature(text, match.index + match[0].length);
    let type: ValueType = unknownType;
    if (!signature) warnings.push(`Function declaration '${local}' has an unsupported declaration and was kept as unknown`);
    else if (signature.generic) warnings.push(`Generic function '${local}' is outside the VelarScript declaration bridge and was kept as unknown`);
    else {
      const parameters = parseParameters(signature.parameters, (value) => parse(value, "to-js"), warnings);
      type = parameters.invalid ? unsupportedType : {
        kind: "function",
        parameters: parameters.types,
        requiredParameters: parameters.required,
        ...(parameters.rest ? { rest: parameters.rest } : {}),
        result: parse(signature.result, "from-js"),
      };
    }
    setLocalValue(local, type, "function");
  }

  for (const declaration of constantDeclarations(text)) {
    if (declaration.exported) directRuntimeExports.push({ local: declaration.name, exported: declaration.name });
    setLocalValue(declaration.name, parse(declaration.type), "const");
  }
}

/**
 * The export statements, read against what the file declared: the `export`
 * keyword on a declaration, and the `export { … }` lists that name locals.
 */
function appendDeclarationExports(
  text: string,
  index: DeclarationTypeIndex,
  locals: DeclarationLocals,
  exports: Map<string, ValueType>,
  typeExports: Map<string, ValueType>,
  classes: Map<string, ClassInfo>,
  warnings: string[],
): void {
  const { directlyExportedTypes } = index;
  const { classes: localClasses, runtimeExports: directRuntimeExports, types: localTypes, values: localValues } = locals;
  const setTypeExport = (exported: string, type: ValueType): void => {
    if (typeExports.has(exported)) {
      warnings.push(`Duplicate explicit declaration type export '${exported}' was kept as unknown`);
      typeExports.set(exported, unknownType);
    } else typeExports.set(exported, renameDeclarationType(type, exported));
  };
  const setRuntimeExport = (local: string, exported: string, type: ValueType): void => {
    if (exports.has(exported)) {
      warnings.push(`Duplicate explicit declaration export '${exported}' was kept as unknown`);
      exports.set(exported, unknownType);
      classes.delete(exported);
      return;
    }
    exports.set(exported, renameDeclarationExport(type, exported));
    const info = localClasses.get(local);
    if (type.kind === "classConstructor" && info) classes.set(exported, info);
  };

  for (const name of directlyExportedTypes) setTypeExport(name, localTypes.get(name) ?? unknownType);
  for (const item of directRuntimeExports) {
    const value = localValues.get(item.local) ?? unknownType;
    setRuntimeExport(item.local, item.exported, value);
    const type = localTypes.get(item.local);
    if (type) setTypeExport(item.exported, type);
  }
  for (const item of localDeclarationExports(text)) {
    const value = localValues.get(item.local);
    const type = localTypes.get(item.local);
    if (item.typeOnly) {
      if (type) setTypeExport(item.exported, type);
      else {
        warnings.push(`Local declaration type export '${item.local}' was not found and was kept as unknown`);
        setTypeExport(item.exported, unknownType);
      }
      continue;
    }
    if (value) setRuntimeExport(item.local, item.exported, value);
    if (type) setTypeExport(item.exported, type);
    if (!value && !type) {
      warnings.push(`Local declaration export '${item.local}' was not found and was kept as unknown`);
      setRuntimeExport(item.local, item.exported, unknownType);
      setTypeExport(item.exported, unknownType);
    }
  }
}

interface LocalDeclarationExport {
  readonly local: string;
  readonly exported: string;
  readonly typeOnly: boolean;
}

function localDeclarationExports(source: string): readonly LocalDeclarationExport[] {
  const output: LocalDeclarationExport[] = [];
  const pattern = /export\s+(type\s+)?\{([\s\S]*?)\}\s*(?!from\b)(?:;|$)/gmu;
  for (const match of source.matchAll(pattern)) {
    const allTypeOnly = Boolean(match[1]);
    for (const part of splitTopLevel(match[2] ?? "", ",")) {
      const specifier = /^(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*|default))?$/u.exec(part.trim());
      if (!specifier) continue;
      output.push({
        local: specifier[2]!,
        exported: specifier[3] ?? specifier[2]!,
        typeOnly: allTypeOnly || Boolean(specifier[1]),
      });
    }
  }
  const defaultPattern = /export\s+default\s+([A-Za-z_$][\w$]*)\s*;/gu;
  for (const match of source.matchAll(defaultPattern)) {
    output.push({ local: match[1]!, exported: "default", typeOnly: false });
  }
  return output;
}

export function renameDeclarationExport(type: ValueType, name: string): ValueType {
  return type.kind === "classConstructor" ? { ...type, name } : type;
}

export function renameDeclarationType(type: ValueType, name: string): ValueType {
  return type.kind === "class" ? { ...type, name } : type;
}

interface ConstantDeclaration {
  readonly name: string;
  readonly type: string;
  readonly exported: boolean;
}

/**
 * Reads a declaration type to its real top-level terminator. A semicolon and
 * an ASI newline are equivalent here; nested object/function/generic syntax
 * may contain either without ending the `const` declaration.
 */
function constantDeclarations(source: string): readonly ConstantDeclaration[] {
  const output: ConstantDeclaration[] = [];
  const heads = /(?:^|[;\r\n])[\t ]*(export\s+)?(?:declare\s+)?const\s+([A-Za-z_$][\w$]*)\s*:\s*/gmu;
  for (const match of source.matchAll(heads)) {
    const start = match.index + match[0].length;
    let round = 0;
    let square = 0;
    let brace = 0;
    let angle = 0;
    let quote = "";
    let end = start;
    for (; end < source.length; end += 1) {
      const character = source[end]!;
      if (quote) {
        if (character === "\\") end += 1;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "\"" || character === "'" || character === "`") quote = character;
      else if (character === "(") round += 1;
      else if (character === ")") round = Math.max(0, round - 1);
      else if (character === "[") square += 1;
      else if (character === "]") square = Math.max(0, square - 1);
      else if (character === "{") brace += 1;
      else if (character === "}") brace = Math.max(0, brace - 1);
      else if (character === "<") angle += 1;
      else if (character === ">") angle = Math.max(0, angle - 1);
      else if ((character === ";" || character === "\n" || character === "\r")
        && round === 0 && square === 0 && brace === 0 && angle === 0) break;
    }
    const type = source.slice(start, end).trim();
    if (type) output.push({ name: match[2]!, type, exported: Boolean(match[1]) });
  }
  return output;
}
