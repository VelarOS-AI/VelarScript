import {
  describeType,
  permanentNamespaceCoveringModule,
  type CompilerExtension,
  type SemanticImport,
  type SemanticMember,
  type ValueType,
} from "@velarscript/compiler";
import { standardModuleInterface, standardModuleInterfaces } from "./standard-modules.ts";

type CallableType = Extract<ValueType, { readonly kind: "function" | "intrinsic" | "action" }>;

export type StandardContainerKind = "list" | "map" | "record" | "set" | "string" | "number";

interface StandardIdentityOwner {
  readonly source: string;
  readonly name: string;
  readonly importable: boolean;
}

function callable(type: ValueType): type is CallableType {
  return type.kind === "function" || type.kind === "intrinsic" || type.kind === "action";
}

function callableArguments(type: CallableType): readonly string[] {
  const names = type.parameterNames ?? type.parameters.map((_, index) => `value${index + 1}`);
  return [
    ...type.parameters.map((_, index) => names[index] ?? `value${index + 1}`),
    ...(type.rest ? [`...${names[type.parameters.length] ?? "values"}`] : []),
  ];
}

function callableUsage(target: string, type: CallableType): string {
  const invocation = `${target}(${callableArguments(type).join(", ")})`;
  if (type.result.kind === "null") return invocation;
  if (type.result.kind === "promise") return `const result = await ${invocation}`;
  return `const result = ${invocation}`;
}

function importUsage(local: string, type: ValueType): string | null {
  if (callable(type)) return callableUsage(local, type);
  if (type.kind === "classConstructor") return `const value = ${local}()`;
  if (type.kind === "typeObject" || type.kind === "enumObject" || type.kind === "runtimeType") return null;
  return `const value = ${local}`;
}

function importStatement(imported: string, local: string, source: string): string {
  const binding = imported === local ? imported : `${imported} as ${local}`;
  return `import {${binding}} from "${source}"`;
}

function fencedUsage(lines: readonly string[]): string {
  return ["```velar", ...lines, "```"].join("\n");
}

function standardContractDocumentation(
  title: string,
  source: string,
  type: string,
  usage: readonly string[],
): string {
  return [
    `${title} is declared by the \`${source}\` standard contract.`,
    "",
    fencedUsage(usage),
    "",
    `Checked contract: \`${type}\`.`,
  ].join("\n");
}

/**
 * Builds editor help from the exact standard-module interface used by project
 * compilation. No editor-owned API roster is involved, so aliases and target
 * extensions see the same contract as the analyzer.
 */
export function standardImportDocumentation(
  imported: SemanticImport,
  extensions: readonly CompilerExtension[],
): string | null {
  if (imported.namespace) return standardModuleDocumentation(imported.source, extensions);
  const type = standardModuleInterface(imported.source, extensions)?.exports.get(imported.imported);
  if (!type) return null;
  const usage = importUsage(imported.local, type);
  return standardContractDocumentation(
    `\`${imported.local}\``,
    imported.source,
    describeType(type),
    [importStatement(imported.imported, imported.local, imported.source), ...(usage ? ["", usage] : [])],
  );
}

export function standardModuleDocumentation(
  source: string,
  extensions: readonly CompilerExtension[],
): string | null {
  const interface_ = standardModuleInterface(source, extensions);
  if (!interface_) return null;
  const exports = [...interface_.exports.keys()];
  const shown = exports.slice(0, 12).map((name) => `\`${name}\``).join(", ");
  const remaining = Math.max(0, exports.length - 12);
  return [
    `\`${source}\` is a compiler-checked VelarScript standard module.`,
    "",
    exports.length === 0
      ? "It currently exposes no public values."
      : `Available exports: ${shown}${remaining > 0 ? `, and ${remaining} more` : ""}.`,
  ].join("\n");
}

function namespaceContract(
  namespace: string,
  extensions: readonly CompilerExtension[],
): { readonly source: string; readonly exports: ReadonlyMap<string, ValueType> } | null {
  for (const [source, interface_] of standardModuleInterfaces(extensions)) {
    if (permanentNamespaceCoveringModule(source, interface_.exports.keys()) === namespace) {
      return { source, exports: interface_.exports };
    }
  }
  return null;
}

export function standardNamespaceDocumentation(
  namespace: string,
  extensions: readonly CompilerExtension[],
): string | null {
  const contract = namespaceContract(namespace, extensions);
  if (!contract) return null;
  const members = [...contract.exports.keys()].map((name) => `\`${name}\``).join(", ");
  return [
    `\`${namespace}\` is VelarScript's permanent namespace for the \`${contract.source}\` standard contract.`,
    "",
    `Use its APIs without an import, as \`${namespace}.member(...)\`.`,
    "",
    `Available members: ${members}.`,
  ].join("\n");
}

export function standardNamespaceMemberDocumentation(
  namespace: string,
  member: string,
  extensions: readonly CompilerExtension[],
): string | null {
  const contract = namespaceContract(namespace, extensions);
  const type = contract?.exports.get(member);
  if (!contract || !type) return null;
  const target = `${namespace}.${member}`;
  const usage = callable(type) ? callableUsage(target, type) : `const value = ${target}`;
  return standardContractDocumentation(`\`${target}\``, contract.source, describeType(type), [usage]);
}

export function standardNamespaceMembers(
  namespace: string,
  extensions: readonly CompilerExtension[],
): readonly SemanticMember[] {
  const contract = namespaceContract(namespace, extensions);
  if (!contract) return [];
  return [...contract.exports].map(([name, type]) => ({
    name,
    kind: callable(type) ? "method" as const : "field" as const,
    type: describeType(type),
  }));
}

function standardIdentityOwner(
  identity: string,
  extensions: readonly CompilerExtension[],
): StandardIdentityOwner | null {
  for (const [source, interface_] of standardModuleInterfaces(extensions)) {
    for (const [name, candidate] of interface_.namedTypeIdentities) {
      if (candidate === identity) return { source, name, importable: interface_.exports.has(name) };
    }
    for (const [name, candidate] of interface_.genericTypes ?? []) {
      if (candidate.identity === identity) return { source, name, importable: interface_.exports.has(name) };
    }
    for (const [name, candidate] of interface_.classes) {
      if (candidate.identity === identity) return { source, name, importable: interface_.exports.has(name) };
    }
    for (const [name, candidate] of interface_.enums) {
      if (candidate.identity === identity) return { source, name, importable: interface_.exports.has(name) };
    }
  }
  return null;
}

function callArgumentsFromDescription(type: string): readonly string[] | null {
  const open = type.indexOf("(");
  if (open < 0) return null;
  let depth = 0;
  let segmentStart = open + 1;
  let close = -1;
  const segments: string[] = [];
  for (let index = open + 1; index < type.length; index += 1) {
    const character = type[index]!;
    if (character === "(" || character === "<" || character === "[" || character === "{") depth += 1;
    else if (character === ")") {
      if (depth === 0) {
        segments.push(type.slice(segmentStart, index));
        close = index;
        break;
      }
      depth -= 1;
    } else if (character === ">" || character === "]" || character === "}") {
      if (depth > 0) depth -= 1;
    } else if (character === "," && depth === 0) {
      segments.push(type.slice(segmentStart, index));
      segmentStart = index + 1;
    }
  }
  if (close < 0) return null;
  return segments.map((segment, index) => {
    const trimmed = segment.trim();
    if (!trimmed) return null;
    const colon = trimmed.indexOf(":");
    const candidate = (colon < 0 ? trimmed : trimmed.slice(0, colon)).replace(/^\.\.\./u, "").trim();
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(candidate) ? candidate : `value${index + 1}`;
  }).filter((name): name is string => name !== null);
}

function describedMemberUsage(receiver: string, member: string, type: string): string {
  const parameters = callArgumentsFromDescription(type);
  const target = `${receiver}.${member}`;
  if (!parameters) return `const value = ${target}`;
  const invocation = `${target}(${parameters.join(", ")})`;
  if (/\)\s*->\s*null$/u.test(type)) return invocation;
  if (/\)\s*->\s*Promise</u.test(type)) return `const result = await ${invocation}`;
  return `const result = ${invocation}`;
}

export function standardImportedMemberDocumentation(
  imported: SemanticImport,
  member: string,
  memberType: string,
  extensions: readonly CompilerExtension[],
): string | null {
  const interface_ = standardModuleInterface(imported.source, extensions);
  const owner = imported.namespace ? interface_?.exports.get(member) : interface_?.exports.get(imported.imported);
  if (!owner) return null;
  return standardContractDocumentation(
    `\`${imported.local}.${member}\``,
    imported.source,
    memberType,
    [
      imported.namespace
        ? `import * as ${imported.local} from "${imported.source}"`
        : importStatement(imported.imported, imported.local, imported.source),
      "",
      describedMemberUsage(imported.local, member, memberType),
    ],
  );
}

export function standardIdentityMemberDocumentation(
  identity: string,
  member: string,
  memberType: string,
  extensions: readonly CompilerExtension[],
): string | null {
  const owner = standardIdentityOwner(identity, extensions);
  if (!owner) return null;
  const usage = [
    ...(owner.importable ? [`import {${owner.name}} from "${owner.source}"`, ""] : []),
    `def use(value: ${owner.name}):`,
    `    ${describedMemberUsage("value", member, memberType)}`,
  ];
  return standardContractDocumentation(
    `\`${owner.name}.${member}\``,
    owner.source,
    memberType,
    usage,
  );
}

export function standardContainerKindFromDisplay(type: string | null): StandardContainerKind | null {
  if (!type) return null;
  const normalized = type.startsWith("readonly ") ? type.slice("readonly ".length) : type;
  if (normalized === "string") return "string";
  if (normalized === "number") return "number";
  if (normalized.startsWith("List<")) return "list";
  if (normalized.startsWith("Map<")) return "map";
  if (normalized.startsWith("Record<")) return "record";
  if (normalized.startsWith("Set<")) return "set";
  return null;
}

export function standardContainerMemberDocumentation(
  kind: StandardContainerKind,
  member: string,
  memberType: string,
): string {
  const names: Readonly<Record<StandardContainerKind, { readonly type: string; readonly receiver: string }>> = {
    list: { type: "List", receiver: "values" },
    map: { type: "Map", receiver: "values" },
    record: { type: "Record", receiver: "values" },
    set: { type: "Set", receiver: "values" },
    string: { type: "string", receiver: "text" },
    number: { type: "number", receiver: "value" },
  };
  const owner = names[kind];
  return [
    `\`${owner.type}.${member}\` is a compiler-checked ${owner.type} member.`,
    "",
    fencedUsage([describedMemberUsage(owner.receiver, member, memberType)]),
    "",
    `Checked contract: \`${memberType}\`.`,
  ].join("\n");
}
