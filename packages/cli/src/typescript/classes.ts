/**
 * Class declarations: finding each one's header and body in the file, then
 * reading one class's public members into the `ClassInfo` the analyzer uses.
 * Any member this reader cannot represent exactly refuses the whole class —
 * `rejectClassMember` and `duplicateClassMember` are how that is recorded.
 */
import { optionalOf, semanticTypeIdentity, type ClassInfo, type ValueType } from "@velarscript/compiler";
import { unsupportedType, type DeclarationDirection } from "./bridge.ts";
import { parseClassConstructorParameters, parseParameters } from "./parameters.ts";
import { matchingDelimiter, splitFields } from "./scanning.ts";
import { readAccessorSignature, readMethodSignature } from "./signatures.ts";

export interface TypeScriptClassDeclaration {
  readonly name: string;
  readonly directExportName: string | null;
  readonly baseName: string | null;
  readonly body: string;
  readonly unsupportedHeader: string | null;
}

export function readClassDeclarations(source: string, warnings: string[]): readonly TypeScriptClassDeclaration[] {
  const declarations: TypeScriptClassDeclaration[] = [];
  const pattern = /(export\s+)?(?:declare\s+)?(?:(default)\s+)?(?:(abstract)\s+)?class\s+([A-Za-z_$][\w$]*)/gu;
  for (const match of source.matchAll(pattern)) {
    const open = source.indexOf("{", match.index + match[0].length);
    if (open < 0) {
      warnings.push(`Class declaration '${match[4]}' has no readable body and was kept as unknown`);
      continue;
    }
    const close = matchingDelimiter(source, open, "{", "}");
    if (close < 0) {
      warnings.push(`Class declaration '${match[4]}' has an unclosed body and was kept as unknown`);
      continue;
    }
    const header = source.slice(match.index + match[0].length, open).trim();
    const base = /^extends\s+([A-Za-z_$][\w$]*)$/u.exec(header);
    declarations.push({
      name: match[4]!,
      directExportName: match[1] ? (match[2] ? "default" : match[4]!) : null,
      baseName: base?.[1] ?? null,
      body: source.slice(open + 1, close),
      unsupportedHeader: match[3] || (header && !base) ? [match[3] ? "abstract" : "", header].filter(Boolean).join(" ") : null,
    });
  }
  return declarations;
}

/**
 * The public members one class declaration has yielded so far. `invalid` is the
 * verdict every refusal below writes to: a class the bridge cannot represent
 * exactly is kept as unknown rather than represented approximately.
 */
interface ClassMembers {
  readonly declaration: TypeScriptClassDeclaration;
  readonly parse: (value: string, direction?: DeclarationDirection) => ValueType;
  readonly warnings: string[];
  readonly fields: Map<string, { readonly mutable: boolean; readonly type: ValueType }>;
  readonly methods: Map<string, ValueType>;
  readonly staticFields: Map<string, { readonly mutable: boolean; readonly type: ValueType }>;
  readonly staticMethods: Map<string, ValueType>;
  readonly getterNames: Set<string>;
  readonly staticGetterNames: Set<string>;
  readonly accessors: Map<string, { getter?: ValueType; setter?: ValueType }>;
  readonly staticAccessors: Map<string, { getter?: ValueType; setter?: ValueType }>;
  invalid: boolean;
}

export function parseClassDeclaration(
  declaration: TypeScriptClassDeclaration,
  parse: (value: string, direction?: DeclarationDirection) => ValueType,
  warnings: string[],
  moduleSource: string,
  classTypes: ReadonlyMap<string, ValueType>,
): ClassInfo | null {
  if (declaration.unsupportedHeader) {
    warnings.push(`Class declaration '${declaration.name}' uses unsupported '${declaration.unsupportedHeader}' syntax and was kept as unknown`);
    return null;
  }
  const warningCount = warnings.length;
  let constructor: ReturnType<typeof parseClassConstructorParameters> | null = null;
  const members: ClassMembers = {
    declaration,
    parse,
    warnings,
    fields: new Map(),
    methods: new Map(),
    staticFields: new Map(),
    staticMethods: new Map(),
    getterNames: new Set(),
    staticGetterNames: new Set(),
    accessors: new Map(),
    staticAccessors: new Map(),
    invalid: false,
  };

  for (const raw of splitFields(declaration.body)) {
    const member = raw.trim();
    if (!member) continue;
    if (/^(?:private|protected)\s+/u.test(member)) {
      if (/^(?:private|protected)\s+constructor\b/u.test(member)) rejectClassMember(members, member);
      continue;
    }
    const constructorPrefix = /^constructor\s*/u.exec(member);
    if (constructorPrefix) {
      constructor = readClassConstructorMember(members, member, constructorPrefix, constructor);
      continue;
    }
    if (readClassAccessorMember(members, member)) continue;
    if (readClassPropertyMember(members, member)) continue;
    if (readClassMethodMember(members, member)) continue;
    rejectClassMember(members, member);
  }

  materializeClassAccessors(members, members.accessors, members.fields, members.getterNames);
  materializeClassAccessors(members, members.staticAccessors, members.staticFields, members.staticGetterNames);

  if (warnings.length > warningCount) members.invalid = true;
  if (members.invalid) return null;
  const identity = `js:${moduleSource}#${declaration.name}`;
  const base = declaration.baseName ? classTypes.get(declaration.baseName) : null;
  if (declaration.baseName && base?.kind !== "class") {
    warnings.push(`Class base '${declaration.baseName}' cannot be expanded and '${declaration.name}' was kept as unknown`);
    return null;
  }
  return {
    identity,
    parameters: constructor?.types ?? [],
    requiredParameters: constructor?.required ?? 0,
    ...(constructor?.rest ? { constructorRest: constructor.rest } : {}),
    base: base?.kind === "class" ? base.identity ?? base.name : null,
    abstract: false,
    fields: members.fields,
    getters: members.getterNames,
    abstractGetters: new Set(),
    methods: members.methods,
    abstractMethods: new Set(),
    staticFields: members.staticFields,
    staticGetters: members.staticGetterNames,
    staticMethods: members.staticMethods,
  };
}

function rejectClassMember(members: ClassMembers, member: string): void {
  members.warnings.push(`Unsupported public class member '${member}' in '${members.declaration.name}' caused the class to be kept as unknown`);
  members.invalid = true;
}

function duplicateClassMember(members: ClassMembers, name: string): void {
  members.warnings.push(`Overloaded or duplicate class member '${name}' in '${members.declaration.name}' caused the class to be kept as unknown`);
  members.invalid = true;
}

function reservedClassMember(members: ClassMembers, name: string, member: string): boolean {
  if (name !== "constructor" && name !== "prototype" && name !== "__proto__") return false;
  rejectClassMember(members, member);
  return true;
}

/** The constructor member, whose parameter properties are fields as well. */
function readClassConstructorMember(
  members: ClassMembers,
  member: string,
  constructorPrefix: RegExpExecArray,
  current: ReturnType<typeof parseClassConstructorParameters> | null,
): ReturnType<typeof parseClassConstructorParameters> | null {
  const open = constructorPrefix[0].length;
  if (member[open] !== "(") {
    rejectClassMember(members, member);
    return current;
  }
  const close = matchingDelimiter(member, open, "(", ")");
  if (close < 0 || member.slice(close + 1).trim()) {
    rejectClassMember(members, member);
    return current;
  }
  if (current) {
    duplicateClassMember(members, "constructor");
    return current;
  }
  const constructor = parseClassConstructorParameters(member.slice(open + 1, close), members.parse, members.warnings);
  for (const [name, field] of constructor.fields) {
    if (members.fields.has(name) || members.methods.has(name) || members.accessors.has(name)) duplicateClassMember(members, name);
    else members.fields.set(name, field);
  }
  return constructor;
}

/** A `get` or `set` member, held until `materializeClassAccessors` pairs them. */
function readClassAccessorMember(members: ClassMembers, member: string): boolean {
  const accessor = readAccessorSignature(member);
  if (!accessor) return false;
  if (reservedClassMember(members, accessor.name, member)) return true;
  const modifiers = new Set(accessor.modifiers);
  const target = modifiers.has("static") ? members.staticAccessors : members.accessors;
  const fieldsTarget = modifiers.has("static") ? members.staticFields : members.fields;
  const methodsTarget = modifiers.has("static") ? members.staticMethods : members.methods;
  if (fieldsTarget.has(accessor.name) || methodsTarget.has(accessor.name)) {
    duplicateClassMember(members, accessor.name);
    return true;
  }
  const contract = target.get(accessor.name) ?? {};
  if ((accessor.kind === "get" && contract.getter) || (accessor.kind === "set" && contract.setter)) {
    duplicateClassMember(members, accessor.name);
    return true;
  }
  if (accessor.kind === "get") contract.getter = members.parse(accessor.type, "from-js");
  else contract.setter = members.parse(accessor.type, "to-js");
  target.set(accessor.name, contract);
  return true;
}

/** A `name: T` field member. */
function readClassPropertyMember(members: ClassMembers, member: string): boolean {
  const property = /^((?:(?:public|static|readonly|declare)\s+)*)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/su.exec(member);
  if (!property) return false;
  const modifiers = new Set((property[1] ?? "").trim().split(/\s+/u).filter(Boolean));
  const target = modifiers.has("static") ? members.staticFields : members.fields;
  const accessorsTarget = modifiers.has("static") ? members.staticAccessors : members.accessors;
  const name = property[2]!;
  if (reservedClassMember(members, name, member)) return true;
  if (target.has(name) || accessorsTarget.has(name) || (modifiers.has("static") ? members.staticMethods : members.methods).has(name)) {
    duplicateClassMember(members, name);
    return true;
  }
  if (property[3] && !modifiers.has("readonly")) {
    members.warnings.push(`Optional mutable class field '${name}' has no exact VelarScript field contract and caused '${members.declaration.name}' to be kept as unknown`);
    members.invalid = true;
    return true;
  }
  const type = members.parse(property[4] ?? "unknown", modifiers.has("readonly") ? "from-js" : "invariant");
  target.set(name, { mutable: !modifiers.has("readonly"), type: property[3] ? optionalOf(type) : type });
  return true;
}

/** A `name(…): T` method member. */
function readClassMethodMember(members: ClassMembers, member: string): boolean {
  const methodPrefix = /^((?:(?:public|static)\s+)*)?/u.exec(member);
  const modifiersText = methodPrefix?.[1] ?? "";
  const method = readMethodSignature(member.slice(methodPrefix?.[0].length ?? 0));
  if (!method) return false;
  if (reservedClassMember(members, method.name, member)) return true;
  const modifiers = new Set(modifiersText.trim().split(/\s+/u).filter(Boolean));
  const target = modifiers.has("static") ? members.staticMethods : members.methods;
  const fieldsTarget = modifiers.has("static") ? members.staticFields : members.fields;
  const accessorsTarget = modifiers.has("static") ? members.staticAccessors : members.accessors;
  if (target.has(method.name) || fieldsTarget.has(method.name) || accessorsTarget.has(method.name)) {
    duplicateClassMember(members, method.name);
    return true;
  }
  const parameters = parseParameters(method.parameters, (value) => members.parse(value, "to-js"), members.warnings);
  const type: ValueType = parameters.invalid ? unsupportedType : {
    kind: "function",
    parameters: parameters.types,
    requiredParameters: parameters.required,
    ...(parameters.rest ? { rest: parameters.rest } : {}),
    result: members.parse(method.result, "from-js"),
  };
  target.set(method.name, method.optional ? optionalOf(type) : type);
  return true;
}

/**
 * Turns the held accessor pairs into fields. A getter alone is a read-only
 * field; a setter alone, or a pair that disagrees about its type, has no exact
 * field contract and refuses the class.
 */
function materializeClassAccessors(
  members: ClassMembers,
  source: ReadonlyMap<string, { readonly getter?: ValueType; readonly setter?: ValueType }>,
  target: Map<string, { readonly mutable: boolean; readonly type: ValueType }>,
  readonlyGetters: Set<string>,
): void {
  for (const [name, contract] of source) {
    if (!contract.getter) {
      members.warnings.push(`Setter-only class accessor '${name}' in '${members.declaration.name}' caused the class to be kept as unknown`);
      members.invalid = true;
      continue;
    }
    if (contract.setter && semanticTypeIdentity(contract.getter) !== semanticTypeIdentity(contract.setter)) {
      members.warnings.push(`Class accessor '${name}' in '${members.declaration.name}' has incompatible getter and setter types`);
      members.invalid = true;
      continue;
    }
    target.set(name, { mutable: Boolean(contract.setter), type: contract.getter });
    if (!contract.setter) readonlyGetters.add(name);
  }
}
