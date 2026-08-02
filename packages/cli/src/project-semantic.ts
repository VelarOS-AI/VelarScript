import { dirname, extname, resolve } from "node:path";
import {
  semanticImportAt,
  semanticModuleReferenceAt,
  semanticSymbolAt,
  semanticVisibleSymbolsAt,
  type SemanticExpression,
  type SemanticImport,
  type SemanticIndex,
  type SemanticMemberReference,
  type SemanticSymbol,
  type Span,
} from "@velarscript/compiler";
import type { ProjectModule, ProjectResult } from "./project.ts";
import { projectImportKey } from "./project.ts";

export interface ProjectLocation {
  readonly path: string;
  readonly span: Span;
}

export interface ProjectTextEdit extends ProjectLocation {
  readonly replacement?: string;
}

export interface ProjectDocumentSymbol extends ProjectLocation {
  readonly name: string;
  readonly kind: SemanticSymbol["kind"];
  readonly selectionSpan: Span;
  readonly type: string | null;
}

export interface ProjectSignature {
  readonly label: string;
  readonly activeParameter: number;
}

export interface ProjectCompletion {
  readonly label: string;
  readonly detail: string;
  readonly kind: SemanticSymbol["kind"];
  readonly documentation?: string;
}

export type ProjectSemanticTokenType = "type" | "class" | "enum" | "enumMember" | "function" | "method" | "property" | "variable" | "parameter";
export type ProjectSemanticTokenModifier = "declaration" | "readonly" | "static";

export interface ProjectSemanticToken {
  readonly span: Span;
  readonly type: ProjectSemanticTokenType;
  readonly modifiers: readonly ProjectSemanticTokenModifier[];
}

export type ProjectCompletionContext = "ordinary" | "member" | "jsx-tag" | "component-attribute" | "native-attribute" | "object-field";

const nativeJsxTags = [
  "a", "article", "aside", "button", "canvas", "dialog", "div", "footer", "form", "h1", "h2", "h3",
  "header", "img", "input", "label", "li", "main", "nav", "option", "p", "section", "select", "span",
  "strong", "textarea", "ul",
] as const;

const nativeSvgTags = [
  "svg", "g", "defs", "symbol", "use", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "title", "desc", "clipPath", "mask", "pattern", "linearGradient", "radialGradient", "stop",
  "filter", "foreignObject",
] as const;

const svgElementNames = new Set<string>(nativeSvgTags);

const jsxControlCompletions: readonly ProjectCompletion[] = [
  { label: "key", detail: "stable JSX list key", kind: "field" },
  { label: "if", detail: "conditional JSX branch", kind: "field" },
  { label: "else-if", detail: "conditional JSX branch", kind: "field" },
  { label: "else", detail: "conditional JSX fallback", kind: "field" },
];

const nativeJsxCompletions: readonly ProjectCompletion[] = [
  ...jsxControlCompletions,
  ...["id", "class", "title", "role", "aria-label", "aria-labelledby", "ref"].map((label) => ({ label, detail: "native Web attribute", kind: "field" as const })),
  ...["on:click", "on:input", "on:change", "on:keydown", "on:submit.prevent"].map((label) => ({ label, detail: "typed native Web event", kind: "field" as const })),
  { label: "bind:value", detail: "two-way string/number form binding", kind: "field" },
  { label: "bind:checked", detail: "two-way boolean form binding", kind: "field" },
  { label: "class:", detail: "reactive class directive", kind: "field" },
  { label: "style:", detail: "reactive style directive", kind: "field" },
  { label: "unsafe:html", detail: "explicit unsafe HTML boundary", kind: "field" },
];

const nativeSvgCompletions: readonly ProjectCompletion[] = [
  ...["viewBox", "preserveAspectRatio", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
    "width", "height", "points", "transform", "fill", "stroke", "stroke-width", "text-anchor", "href"]
    .map((label) => ({ label, detail: "native SVG attribute", kind: "field" as const })),
  { label: "aria-hidden", detail: "explicit decorative SVG", kind: "field" },
];

export interface ProjectRename {
  readonly edits: readonly ProjectTextEdit[];
  readonly placeholder: string;
}

export type ProjectRenameFailure =
  | "No renameable Velar symbol at this position"
  | "The new name is not a valid Velar identifier"
  | "The new name is reserved by Velar"
  | "The new name collides with another declaration"
  | "The JSX children prop cannot be renamed";

interface LocalTarget {
  readonly kind: "local";
  readonly module: ProjectModule;
  readonly symbol: SemanticSymbol;
}

interface ExportTarget {
  readonly kind: "export";
  readonly module: ProjectModule;
  readonly symbol: SemanticSymbol;
}

type ProjectTarget = LocalTarget | ExportTarget;

interface MemberTarget {
  readonly module: ProjectModule;
  readonly symbol: SemanticSymbol;
}

const reservedNames = new Set([
  "abstract", "and", "as", "async", "await", "break", "catch", "class", "cleanup", "component", "computed", "const", "continue",
  "def", "else", "export", "extends", "false", "finally", "for", "from", "if", "import", "in", "is", "js", "let", "mounted",
  "match", "case", "enum", "none", "not", "or", "override", "pass", "private", "resource", "action", "return", "state", "static", "style", "super", "throw", "assert", "true", "try", "type", "unsafe", "watch", "while",
]);

export function projectDefinitionAt(project: ProjectResult, path: string, offset: number): ProjectLocation | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  const enumMember = enumMemberAt(project, module, offset);
  if (enumMember) return locationOf(enumMember);
  const member = accessibleMemberTargetAt(project, module, offset);
  if (member) return locationOf(member.symbol);
  const moduleReference = semanticModuleReferenceAt(module.result.semanticIndex, offset);
  if (moduleReference) {
    const targetPath = moduleReference.source.startsWith(".") && extname(moduleReference.source) === ".vel"
      ? resolve(dirname(module.inputPath), moduleReference.source)
      : project.velarImports.get(projectImportKey(module.inputPath, moduleReference.source));
    const target = targetPath ? moduleAt(project, targetPath) : null;
    if (target) return { path: target.inputPath, span: { start: 0, end: 0 } };
  }
  const target = targetAt(project, module, offset, "definition");
  if (!target) return null;
  if (target.kind === "local" && target.symbol.kind === "import") {
    const imported = importForSymbol(module.result.semanticIndex, target.symbol.id);
    const exported = imported ? exportedTarget(project, module, imported) : null;
    if (exported) return locationOf(exported.symbol);
  }
  return locationOf(target.symbol);
}

export function projectReferencesAt(
  project: ProjectResult,
  path: string,
  offset: number,
  includeDeclaration = false,
): readonly ProjectLocation[] {
  const module = moduleAt(project, path);
  if (!module) return [];
  const enumMember = enumMemberTargetAt(project, module, offset);
  if (enumMember) return enumMemberLocations(project, enumMember, includeDeclaration);
  const member = accessibleMemberTargetAt(project, module, offset);
  if (member) return memberLocations(project, member, includeDeclaration);
  const target = targetAt(project, module, offset, "references");
  if (!target) return [];
  const locations = target.kind === "export"
    ? exportedLocations(project, target, includeDeclaration)
    : localLocations(target, includeDeclaration);
  return uniqueLocations(locations);
}

export function projectPrepareRenameAt(project: ProjectResult, path: string, offset: number): ProjectRename | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  const enumMember = enumMemberTargetAt(project, module, offset);
  if (enumMember) {
    const selection = wordSpanAt(module.result.source.text, offset) ?? enumMember.selectionSpan;
    return { edits: [{ path: module.inputPath, span: selection }], placeholder: enumMember.name };
  }
  const member = accessibleMemberTargetAt(project, module, offset);
  if (member) {
    if (!renameableMember(member)) return null;
    const selection = wordSpanAt(module.result.source.text, offset) ?? member.symbol.selectionSpan;
    return { edits: [{ path: module.inputPath, span: selection }], placeholder: member.symbol.name };
  }
  const target = targetAt(project, module, offset, "rename");
  if (!target || !renameable(target.symbol)) return null;
  const selection = renameSelectionAt(module.result.semanticIndex, offset, target.symbol);
  return { edits: [{ path: module.inputPath, span: selection }], placeholder: target.symbol.name };
}

export function projectRenameAt(
  project: ProjectResult,
  path: string,
  offset: number,
  newName: string,
): ProjectRename | ProjectRenameFailure {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(newName)) return "The new name is not a valid Velar identifier";
  if (reservedNames.has(newName)) return "The new name is reserved by Velar";
  const module = moduleAt(project, path);
  if (!module) return "No renameable Velar symbol at this position";
  const enumMember = enumMemberTargetAt(project, module, offset);
  if (enumMember) {
    if (enumMember.name === newName) return { edits: [], placeholder: enumMember.name };
    if (enumMemberRenameCollides(project, enumMember, newName)) return "The new name collides with another declaration";
    return { edits: enumMemberLocations(project, enumMember, true), placeholder: enumMember.name };
  }
  const member = accessibleMemberTargetAt(project, module, offset);
  if (member) {
    if (protectedComponentProp(member)) return "The JSX children prop cannot be renamed";
    if (!renameableMember(member)) return "No renameable Velar symbol at this position";
    if (member.symbol.name === newName) return { edits: [], placeholder: member.symbol.name };
    if (memberRenameCollides(project, member, newName)) return "The new name collides with another declaration";
    return { edits: memberRenameEdits(project, member, newName), placeholder: member.symbol.name };
  }
  const target = targetAt(project, module, offset, "rename");
  if (!target || !renameable(target.symbol)) return "No renameable Velar symbol at this position";
  if (target.symbol.name === newName) return { edits: [], placeholder: target.symbol.name };
  if (renameCollides(project, target, newName)) return "The new name collides with another declaration";
  const locations = target.kind === "export"
    ? exportedLocations(project, target, true)
    : localLocations(target, true);
  return { edits: uniqueLocations(locations), placeholder: target.symbol.name };
}

export function projectDocumentSymbols(project: ProjectResult, path: string): readonly ProjectDocumentSymbol[] {
  const module = moduleAt(project, path);
  if (!module) return [];
  return module.result.semanticIndex.symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    path: symbol.path,
    span: symbol.span,
    selectionSpan: symbol.selectionSpan,
    type: symbol.type,
  }));
}

export function projectSemanticTokens(project: ProjectResult, path: string): readonly ProjectSemanticToken[] {
  const module = moduleAt(project, path);
  if (!module) return [];
  const tokens = new Map<string, { readonly token: ProjectSemanticToken; readonly priority: number }>();
  const add = (span: Span, symbol: SemanticSymbol | null, fallback: ProjectSemanticTokenType, declaration: boolean, priority: number): void => {
    if (span.end <= span.start) return;
    const token = {
      span,
      type: symbol ? semanticTokenType(symbol) : fallback,
      modifiers: symbol ? semanticTokenModifiers(symbol, declaration) : declaration ? ["declaration" as const] : [],
    } satisfies ProjectSemanticToken;
    const key = `${span.start}:${span.end}`;
    if ((tokens.get(key)?.priority ?? -1) < priority) tokens.set(key, { token, priority });
  };

  for (const symbol of module.result.semanticIndex.symbols) {
    const resolved = projectSymbolAt(project, path, Math.min(symbol.selectionSpan.end, symbol.selectionSpan.start + 1)) ?? symbol;
    add(symbol.selectionSpan, resolved, "variable", true, 3);
  }
  for (const reference of module.result.semanticIndex.references) {
    const resolved = projectSymbolAt(project, path, Math.min(reference.span.end, reference.span.start + 1));
    add(reference.span, resolved, "variable", false, 1);
  }
  for (const reference of module.result.semanticIndex.memberReferences) {
    const resolved = projectMemberSymbolAt(project, path, Math.min(reference.span.end, reference.span.start + 1));
    const expression = module.result.semanticIndex.expressions.find((item) => item.selectionSpan
      && item.selectionSpan.start === reference.span.start && item.selectionSpan.end === reference.span.end);
    add(reference.span, resolved, expression?.type.startsWith("(") ? "method" : "property", false, 2);
  }

  return [...tokens.values()].map((item) => item.token).sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end);
}

function semanticTokenType(symbol: SemanticSymbol): ProjectSemanticTokenType {
  switch (symbol.kind) {
    case "type": return "type";
    case "class": return "class";
    case "enum": return "enum";
    case "enum-member": return "enumMember";
    case "function":
    case "component":
    case "action": return "function";
    case "method": return "method";
    case "field": return "property";
    case "parameter":
    case "watch-value": return "parameter";
    default: return "variable";
  }
}

function semanticTokenModifiers(symbol: SemanticSymbol, declaration: boolean): readonly ProjectSemanticTokenModifier[] {
  const modifiers: ProjectSemanticTokenModifier[] = [];
  if (declaration) modifiers.push("declaration");
  if (symbol.kind === "variable" && !symbol.mutable) modifiers.push("readonly");
  if (symbol.static) modifiers.push("static");
  return modifiers;
}

export function projectSymbolAt(project: ProjectResult, path: string, offset: number): SemanticSymbol | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  const enumMember = enumMemberAt(project, module, offset);
  if (enumMember) return enumMember;
  const symbol = semanticSymbolAt(module.result.semanticIndex, offset);
  if (!symbol) return null;
  if (symbol.kind !== "import") return symbol;
  const imported = importForSymbol(module.result.semanticIndex, symbol.id);
  return imported ? exportedTarget(project, module, imported)?.symbol ?? symbol : symbol;
}

export function projectExpressionAt(project: ProjectResult, path: string, offset: number): SemanticExpression | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  return module.result.semanticIndex.expressions
    .filter((expression) => expression.selectionSpan && contains(expression.selectionSpan, offset))
    .sort((left, right) => (left.selectionSpan!.end - left.selectionSpan!.start)
      - (right.selectionSpan!.end - right.selectionSpan!.start))[0] ?? null;
}

export function projectMemberSymbolAt(project: ProjectResult, path: string, offset: number): SemanticSymbol | null {
  const module = moduleAt(project, path);
  return module ? accessibleMemberTargetAt(project, module, offset)?.symbol ?? null : null;
}

export function projectCompletionsAt(project: ProjectResult, path: string, offset: number): readonly ProjectCompletion[] {
  const module = moduleAt(project, path);
  if (!module) return [];
  const jsxTag = jsxTagContextAt(module.result.source.text, offset);
  if (jsxTag) {
    const components = semanticVisibleSymbolsAt(module.result.semanticIndex, offset).filter((symbol) => symbol.kind === "component"
      || (symbol.kind === "import" && symbol.type?.startsWith("component "))).map((symbol) => {
      const resolved = projectSymbolAt(project, module.inputPath, symbol.selectionSpan.start) ?? symbol;
      return {
        label: symbol.name,
        detail: symbol.type ?? "component",
        kind: symbol.kind,
        ...(resolved.documentation ? { documentation: resolved.documentation } : {}),
      };
    });
    return [
      ...components,
      ...nativeJsxTags.map((label) => ({ label, detail: "native Web element", kind: "component" as const })),
      ...nativeSvgTags.map((label) => ({ label, detail: "native SVG element", kind: "component" as const })),
    ]
      .filter((item, index, items) => item.label.startsWith(jsxTag.prefix)
        && items.findIndex((candidate) => candidate.label === item.label) === index);
  }
  const memberAccess = memberAccessAt(module.result.source.text, offset);
  if (memberAccess) {
    const owner = memberAccess.ownerOffset === null ? null : projectSymbolAt(project, module.inputPath, memberAccess.ownerOffset);
    const ownerExpression = module.result.semanticIndex.expressions
      .filter((expression) => expression.span.end === memberAccess.ownerEnd)
      .sort((left, right) => right.span.start - left.span.start)[0];
    const members = ownerExpression?.members ?? owner?.members ?? [];
    const documentationOwner = completionOwnerTarget(project, module, memberAccess.ownerOffset, ownerExpression?.type ?? owner?.type ?? null);
    return members.map((member) => {
      const declared = documentationOwner
        ? findDeclaredMember(project, documentationOwner.target, member.name, documentationOwner.staticMember, new Set())
        : null;
      return {
        label: member.name,
        detail: member.type,
        kind: member.kind,
        ...(declared?.symbol.documentation ? { documentation: declared.symbol.documentation } : {}),
      };
    });
  }
  const jsx = jsxAttributeContextAt(module.result.source.text, offset);
  if (jsx) {
    const common = jsx.component
      ? jsxControlCompletions
      : svgElementNames.has(jsx.tag)
        ? [...nativeJsxCompletions, ...nativeSvgCompletions]
        : nativeJsxCompletions;
    const componentTarget = jsx.component ? targetAt(project, module, jsx.tagOffset, "definition") : null;
    const component = componentTarget?.symbol.members.map((member) => {
      const declared = findDeclaredMember(project, componentTarget, member.name, false, new Set());
      return {
        label: member.name,
        detail: member.type,
        kind: member.kind,
        ...(declared?.symbol.documentation ? { documentation: declared.symbol.documentation } : {}),
      };
    }) ?? [];
    return [...component, ...common].filter((item, index, items) => !jsx.used.has(item.label)
      && items.findIndex((candidate) => candidate.label === item.label) === index);
  }
  const object = objectFieldContextAt(module.result.semanticIndex, module.result.source.text, offset);
  if (object) {
    const contextOwner = object.expression.contextType
      ? ownerTarget(project, module, object.expression.contextType, "named")
      : null;
    return (object.expression.contextMembers ?? []).filter((member) => !object.used.has(member.name)).map((member) => {
      const declared = contextOwner ? findDeclaredMember(project, contextOwner, member.name, false, new Set()) : null;
      return {
        label: member.name,
        detail: member.type,
        kind: member.kind,
        ...(declared?.symbol.documentation ? { documentation: declared.symbol.documentation } : {}),
      };
    });
  }
  return semanticVisibleSymbolsAt(module.result.semanticIndex, offset).map((symbol) => {
    const resolved = projectSymbolAt(project, module.inputPath, symbol.selectionSpan.start) ?? symbol;
    return {
      label: symbol.name,
      detail: symbol.type ?? symbol.kind,
      kind: symbol.kind,
      ...(resolved.documentation ? { documentation: resolved.documentation } : {}),
    };
  });
}

function completionOwnerTarget(
  project: ProjectResult,
  module: ProjectModule,
  ownerOffset: number | null,
  displayedType: string | null,
): { readonly target: MemberTarget; readonly staticMember: boolean } | null {
  if (ownerOffset !== null) {
    const direct = targetAt(project, module, ownerOffset, "definition");
    if (direct?.symbol.kind === "class") return { target: direct, staticMember: true };
    if (direct?.symbol.kind === "component") return { target: direct, staticMember: false };
  }
  if (!displayedType) return null;
  const classTarget = ownerTarget(project, module, displayedType, "class");
  if (classTarget) return { target: classTarget, staticMember: false };
  const recordTarget = ownerTarget(project, module, displayedType, "named");
  return recordTarget ? { target: recordTarget, staticMember: false } : null;
}

export function projectCompletionContextAt(project: ProjectResult, path: string, offset: number): ProjectCompletionContext {
  const module = moduleAt(project, path);
  if (!module) return "ordinary";
  const source = module.result.source.text;
  if (jsxTagContextAt(source, offset)) return "jsx-tag";
  if (memberAccessAt(source, offset)) return "member";
  const jsx = jsxAttributeContextAt(source, offset);
  if (jsx) return jsx.component ? "component-attribute" : "native-attribute";
  if (objectFieldContextAt(module.result.semanticIndex, source, offset)) return "object-field";
  return "ordinary";
}

function jsxTagContextAt(source: string, offset: number): { readonly prefix: string } | null {
  const end = Math.min(Math.max(0, offset), source.length);
  const before = source.slice(0, end);
  const opening = before.lastIndexOf("<");
  if (opening < 0 || before.lastIndexOf(">") > opening) return null;
  const match = /^<\/?([A-Za-z0-9_]*)$/u.exec(source.slice(opening, end));
  return match ? { prefix: match[1]! } : null;
}

function objectFieldContextAt(index: SemanticIndex, source: string, offset: number): {
  readonly expression: SemanticExpression;
  readonly used: ReadonlySet<string>;
} | null {
  const expression = index.expressions
    .filter((item) => item.contextMembers && offset > item.span.start && offset <= item.span.end)
    .sort((left, right) => right.span.start - left.span.start)[0];
  if (!expression) return null;
  const fragment = source.slice(expression.span.start + 1, Math.min(offset, expression.span.end));
  let quote: string | null = null;
  let escaped = false;
  let depth = 0;
  let visible = "";
  for (const character of fragment) {
    if (quote) {
      visible += " ";
      if (!escaped && character === quote) quote = null;
      escaped = !escaped && character === "\\";
      if (character !== "\\") escaped = false;
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; visible += " "; continue; }
    if (character === "{" || character === "[" || character === "(") { depth += 1; visible += " "; continue; }
    if (character === "}" || character === "]" || character === ")") { depth = Math.max(0, depth - 1); visible += " "; continue; }
    visible += depth === 0 ? character : " ";
  }
  if (quote || depth > 0) return null;
  const segments = visible.split(",");
  const current = segments.at(-1) ?? "";
  if (current.includes(":")) return null;
  const used = new Set<string>();
  for (const segment of segments) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)/u.exec(segment);
    if (match) used.add(match[1]!);
  }
  return { expression, used };
}

function jsxAttributeContextAt(source: string, offset: number): {
  readonly component: boolean;
  readonly tag: string;
  readonly tagOffset: number;
  readonly used: ReadonlySet<string>;
} | null {
  const end = Math.min(Math.max(0, offset), source.length);
  const before = source.slice(0, end);
  const opening = before.lastIndexOf("<");
  if (opening < 0 || before.lastIndexOf(">") > opening || source[opening + 1] === "/") return null;
  const fragment = source.slice(opening, end);
  const tag = /^<([A-Za-z][A-Za-z0-9_]*)\b/u.exec(fragment);
  if (!tag) return null;
  const attributesStart = tag[0].length;
  let quote: string | null = null;
  let depth = 0;
  let escaped = false;
  let visible = "";
  for (const character of fragment.slice(attributesStart)) {
    if (quote) {
      visible += " ";
      if (!escaped && character === quote) quote = null;
      escaped = !escaped && character === "\\";
      if (character !== "\\") escaped = false;
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; visible += " "; continue; }
    if (character === "{") { depth += 1; visible += " "; continue; }
    if (character === "}") { depth = Math.max(0, depth - 1); visible += " "; continue; }
    visible += depth === 0 ? character : " ";
  }
  if (quote || depth > 0) return null;
  const used = new Set<string>();
  for (const match of visible.matchAll(/([A-Za-z_][A-Za-z0-9_.:-]*)\s*(?==|\s|$)/gu)) used.add(match[1]!);
  return {
    component: /^[A-Z]/u.test(tag[1]!),
    tag: tag[1]!,
    tagOffset: opening + 1,
    used,
  };
}

function memberAccessAt(source: string, offset: number): { readonly ownerOffset: number | null; readonly ownerEnd: number } | null {
  let cursor = Math.min(Math.max(0, offset), source.length);
  while (cursor > 0 && /[A-Za-z0-9_]/u.test(source[cursor - 1]!)) cursor -= 1;
  let dot = cursor - 1;
  while (dot >= 0 && /\s/u.test(source[dot]!)) dot -= 1;
  if (source[dot] !== ".") return null;
  let ownerEnd = dot;
  if (source[ownerEnd - 1] === "?") ownerEnd -= 1;
  while (ownerEnd > 0 && /\s/u.test(source[ownerEnd - 1]!)) ownerEnd -= 1;
  let ownerStart = ownerEnd;
  while (ownerStart > 0 && /[A-Za-z0-9_]/u.test(source[ownerStart - 1]!)) ownerStart -= 1;
  const ownerOffset = ownerStart < ownerEnd && /[A-Za-z_]/u.test(source[ownerStart]!) ? ownerStart : null;
  return { ownerOffset, ownerEnd };
}

export function projectSignatureAt(project: ProjectResult, path: string, offset: number): ProjectSignature | null {
  const module = moduleAt(project, path);
  if (!module) return null;
  const source = module.result.source.text;
  const call = callAt(source, offset);
  if (!call) return null;
  const symbol = projectSymbolAt(project, path, call.calleeOffset);
  if (symbol?.type?.startsWith("(")) return { label: `${symbol.name}${symbol.type}`, activeParameter: call.activeParameter };
  const expression = module.result.semanticIndex.expressions.find((item) => item.selectionSpan && contains(item.selectionSpan, call.calleeOffset));
  if (expression?.memberName && expression.type.startsWith("(")) {
    return { label: `${expression.memberName}${expression.type}`, activeParameter: call.activeParameter };
  }
  const member = memberCallAt(project, module, source, call.calleeOffset);
  return member?.type.startsWith("(")
    ? { label: `${member.name}${member.type}`, activeParameter: call.activeParameter }
    : null;
}

function memberCallAt(
  project: ProjectResult,
  module: ProjectModule,
  source: string,
  calleeOffset: number,
): SemanticSymbol["members"][number] | null {
  const callee = wordSpanAt(source, calleeOffset);
  if (!callee) return null;
  let dot = callee.start - 1;
  while (dot >= 0 && /\s/u.test(source[dot]!)) dot -= 1;
  if (source[dot] !== ".") return null;
  let ownerEnd = dot;
  if (source[ownerEnd - 1] === "?") ownerEnd -= 1;
  while (ownerEnd > 0 && /\s/u.test(source[ownerEnd - 1]!)) ownerEnd -= 1;
  let ownerStart = ownerEnd;
  while (ownerStart > 0 && /[A-Za-z0-9_]/u.test(source[ownerStart - 1]!)) ownerStart -= 1;
  if (ownerStart === ownerEnd || !/[A-Za-z_]/u.test(source[ownerStart]!)) return null;
  const owner = projectSymbolAt(project, module.inputPath, ownerStart);
  const memberName = source.slice(callee.start, callee.end);
  return owner?.members.find((member) => member.name === memberName) ?? null;
}

function targetAt(
  project: ProjectResult,
  module: ProjectModule,
  offset: number,
  purpose: "definition" | "references" | "rename",
): ProjectTarget | null {
  const index = module.result.semanticIndex;
  const imported = semanticImportAt(index, offset);
  if (imported && !imported.namespace) {
    const onImported = contains(imported.importedSpan, offset);
    const aliased = imported.local !== imported.imported;
    if (onImported && (!aliased || !contains(imported.localSpan, offset))) {
      return exportedTarget(project, module, imported);
    }
    const local = index.symbols.find((symbol) => symbol.id === imported.localSymbolId);
    if (local) {
      if (!aliased) return exportedTarget(project, module, imported) ?? { kind: "local", module, symbol: local };
      return { kind: "local", module, symbol: local };
    }
  }
  const symbol = semanticSymbolAt(index, offset);
  if (!symbol) return null;
  if (symbol.kind === "import") {
    const specifier = importForSymbol(index, symbol.id);
    if (specifier && specifier.local === specifier.imported) {
      return exportedTarget(project, module, specifier) ?? { kind: "local", module, symbol };
    }
  }
  return symbol.exported ? { kind: "export", module, symbol } : { kind: "local", module, symbol };
}

function memberTargetAt(project: ProjectResult, module: ProjectModule, offset: number): MemberTarget | null {
  const reference = module.result.semanticIndex.memberReferences.find((item) => contains(item.span, offset));
  if (reference) return memberTargetForReference(project, module, reference);
  const declared = semanticSymbolAt(module.result.semanticIndex, offset);
  if (declared && (declared.kind === "field" || declared.kind === "method" || declared.kind === "parameter") && declared.container) {
    return { module, symbol: declared };
  }
  const expression = module.result.semanticIndex.expressions.find((item) => item.selectionSpan && contains(item.selectionSpan, offset));
  return expression ? memberTargetForExpression(project, module, expression) : null;
}

function accessibleMemberTargetAt(project: ProjectResult, module: ProjectModule, offset: number): MemberTarget | null {
  const target = memberTargetAt(project, module, offset);
  if (!target?.symbol.private) return target;
  if (target.module.inputPath !== module.inputPath || !target.symbol.container) return null;
  const owner = module.result.semanticIndex.symbols.find((symbol) => symbol.kind === "class"
    && symbol.name === target.symbol.container);
  return owner && contains(owner.span, offset) ? target : null;
}

function memberTargetForExpression(project: ProjectResult, module: ProjectModule, expression: SemanticExpression): MemberTarget | null {
  if (!expression.memberName || !expression.ownerType || !expression.ownerKind) return null;
  return memberTargetForOwner(project, module, expression.memberName, expression.ownerType, expression.ownerKind);
}

function memberTargetForReference(project: ProjectResult, module: ProjectModule, reference: SemanticMemberReference): MemberTarget | null {
  return memberTargetForOwner(project, module, reference.name, reference.ownerType, reference.ownerKind);
}

function memberTargetForOwner(
  project: ProjectResult,
  module: ProjectModule,
  memberName: string,
  ownerType: string,
  ownerKind: SemanticExpression["ownerKind"],
): MemberTarget | null {
  if (ownerKind !== "named" && ownerKind !== "class" && ownerKind !== "typeObject"
    && ownerKind !== "classConstructor" && ownerKind !== "componentConstructor") return null;
  const owner = ownerTarget(project, module, ownerType, ownerKind);
  return owner ? findDeclaredMember(project, owner, memberName, ownerKind === "classConstructor", new Set()) : null;
}

function ownerTarget(
  project: ProjectResult,
  module: ProjectModule,
  name: string,
  ownerKind: SemanticExpression["ownerKind"],
): MemberTarget | null {
  const expected = ownerKind === "class" || ownerKind === "classConstructor" ? "class"
    : ownerKind === "componentConstructor" ? "component" : "type";
  if (expected === "class") {
    const identified = classOwnerByIdentity(project, name);
    if (identified) return identified;
  }
  const symbol = module.result.semanticIndex.symbols.find((item) => item.name === name
    && (item.kind === expected || item.kind === "import"));
  if (!symbol) return null;
  if (symbol.kind === "import") {
    const imported = importForSymbol(module.result.semanticIndex, symbol.id);
    const exported = imported ? exportedTarget(project, module, imported) : null;
    return exported && exported.symbol.kind === expected ? { module: exported.module, symbol: exported.symbol } : null;
  }
  if (symbol.kind === "type" && symbol.type && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(symbol.type) && symbol.type !== symbol.name) {
    return ownerTarget(project, module, symbol.type, "named") ?? { module, symbol };
  }
  return { module, symbol };
}

function classOwnerByIdentity(project: ProjectResult, identity: string): MemberTarget | null {
  for (const candidate of project.modules) {
    for (const [name, info] of candidate.result.moduleInterface.classes) {
      if (info.identity !== identity) continue;
      const symbol = candidate.result.semanticIndex.symbols.find((item) => item.kind === "class" && item.name === name);
      if (symbol) return { module: candidate, symbol };
    }
  }
  return null;
}

function findDeclaredMember(
  project: ProjectResult,
  owner: MemberTarget,
  name: string,
  staticMember: boolean,
  visited: Set<string>,
  allowPrivate = true,
): MemberTarget | null {
  const key = `${owner.symbol.id}:${name}:${staticMember}`;
  if (visited.has(key)) return null;
  visited.add(key);
  const direct = owner.module.result.semanticIndex.symbols.find((symbol) => symbol.container === owner.symbol.name
    && symbol.name === name
    && (allowPrivate || !symbol.private)
    && (owner.symbol.kind === "component"
      ? symbol.kind === "parameter"
      : (symbol.kind === "field" || symbol.kind === "method") && Boolean(symbol.static) === staticMember));
  if (direct) return { module: owner.module, symbol: direct };
  if (owner.symbol.kind !== "class") return null;
  const base = owner.module.result.moduleInterface.classes.get(owner.symbol.name)?.base;
  if (!base) return null;
  const baseOwner = ownerTarget(project, owner.module, base, "class");
  return baseOwner ? findDeclaredMember(project, baseOwner, name, staticMember, visited, false) : null;
}

function memberLocations(project: ProjectResult, target: MemberTarget, includeDeclaration: boolean): readonly ProjectLocation[] {
  const targets = memberContractTargets(project, target);
  const targetIds = new Set(targets.map((item) => item.symbol.id));
  const locations: ProjectLocation[] = includeDeclaration ? targets.map((item) => locationOf(item.symbol)) : [];
  for (const item of targets) locations.push(...referencesFor(item.module, item.symbol));
  for (const module of project.modules) {
    for (const reference of module.result.semanticIndex.memberReferences) {
      if (reference.name !== target.symbol.name) continue;
      const resolved = memberTargetForReference(project, module, reference);
      if (resolved && targetIds.has(resolved.symbol.id)) {
        locations.push({ path: module.inputPath, span: reference.span });
      }
    }
  }
  return uniqueLocations(locations);
}

function renameableMember(target: MemberTarget): boolean {
  if (!target.symbol.container) return false;
  if (target.symbol.kind === "method") return true;
  if (target.symbol.kind === "parameter") {
    return !protectedComponentProp(target)
      && target.module.result.semanticIndex.symbols.some((symbol) => symbol.kind === "component" && symbol.name === target.symbol.container);
  }
  if (target.symbol.kind !== "field") return false;
  return target.module.result.semanticIndex.symbols.some((symbol) => (symbol.kind === "type" || symbol.kind === "class")
    && symbol.name === target.symbol.container);
}

function protectedComponentProp(target: MemberTarget): boolean {
  return target.symbol.kind === "parameter" && target.symbol.container !== undefined && target.symbol.name === "children"
    && target.module.result.semanticIndex.symbols.some((symbol) => symbol.kind === "component" && symbol.name === target.symbol.container);
}

function memberRenameCollides(project: ProjectResult, target: MemberTarget, newName: string): boolean {
  const targets = memberContractTargets(project, target);
  const targetIds = new Set(targets.map((item) => item.symbol.id));
  const contractRoot = (target.symbol.kind === "method" || target.symbol.kind === "field") && !target.symbol.static && !target.symbol.private
    ? memberContractRootOwner(project, target) : null;
  const owners = contractRoot ? classHierarchyOwners(project, contractRoot)
    : targets.flatMap((item) => classOwnerForMember(item) ? [classOwnerForMember(item)!] : []);
  if (owners.length === 0) {
    return target.module.result.semanticIndex.symbols.some((symbol) => !targetIds.has(symbol.id)
      && symbol.container === target.symbol.container
      && (symbol.kind === "field" || symbol.kind === "method" || symbol.kind === "parameter")
      && symbol.name === newName);
  }
  const hierarchyCollision = owners.some((owner) => owner.module.result.semanticIndex.symbols.some((symbol) => !targetIds.has(symbol.id)
    && symbol.container === owner.symbol.name
    && (symbol.kind === "parameter" || ((symbol.kind === "field" || symbol.kind === "method")
      && Boolean(symbol.static) === Boolean(target.symbol.static)))
    && symbol.name === newName));
  if (hierarchyCollision || !contractRoot) return hierarchyCollision;
  for (let ancestor = baseClassOwner(project, contractRoot); ancestor; ancestor = baseClassOwner(project, ancestor)) {
    if (directClassMember(ancestor, newName, false)) return true;
  }
  return false;
}

function memberRenameEdits(project: ProjectResult, target: MemberTarget, newName: string): readonly ProjectTextEdit[] {
  const targets = memberContractTargets(project, target);
  const targetIds = new Set(targets.map((item) => item.symbol.id));
  const edits: ProjectTextEdit[] = targets.map((item) => ({ ...locationOf(item.symbol), replacement: newName }));
  for (const item of targets) {
    edits.push(...referencesFor(item.module, item.symbol).map((location) => ({ ...location, replacement: newName })));
  }
  for (const module of project.modules) {
    for (const reference of module.result.semanticIndex.memberReferences) {
      if (reference.name !== target.symbol.name) continue;
      const resolved = memberTargetForReference(project, module, reference);
      if (!resolved || !targetIds.has(resolved.symbol.id)) continue;
      edits.push({
        path: module.inputPath,
        span: reference.span,
        replacement: reference.shorthand ? `${newName}: ${reference.name}` : newName,
      });
    }
  }
  return uniqueTextEdits(edits);
}

function memberContractTargets(project: ProjectResult, target: MemberTarget): readonly MemberTarget[] {
  if ((target.symbol.kind !== "method" && target.symbol.kind !== "field") || target.symbol.static || target.symbol.private) return [target];
  const rootOwner = memberContractRootOwner(project, target);
  if (!rootOwner) return [target];
  const targets: MemberTarget[] = [];
  for (const candidate of classHierarchyOwners(project, rootOwner)) {
    const declared = directClassMember(candidate, target.symbol.name, false, target.symbol.kind);
    if (declared?.symbol.kind === target.symbol.kind) targets.push(declared);
  }
  return targets.length > 0 ? targets : [target];
}

function memberContractRootOwner(project: ProjectResult, target: MemberTarget): MemberTarget | null {
  if (target.symbol.kind !== "field" && target.symbol.kind !== "method") return null;
  const memberKind = target.symbol.kind;
  const owner = classOwnerForMember(target);
  if (!owner) return null;
  let rootOwner = owner;
  for (let current = baseClassOwner(project, owner); current; current = baseClassOwner(project, current)) {
    const declared = directClassMember(current, target.symbol.name, false, memberKind);
    if (declared?.symbol.kind === memberKind) rootOwner = current;
  }
  return rootOwner;
}

function classHierarchyOwners(project: ProjectResult, rootOwner: MemberTarget): readonly MemberTarget[] {
  const owners: MemberTarget[] = [];
  for (const module of project.modules) {
    for (const symbol of module.result.semanticIndex.symbols) {
      if (symbol.kind !== "class") continue;
      const candidate = { module, symbol } satisfies MemberTarget;
      if (classDescendsFrom(project, candidate, rootOwner)) owners.push(candidate);
    }
  }
  return owners;
}

function classOwnerForMember(target: MemberTarget): MemberTarget | null {
  if (!target.symbol.container) return null;
  const owner = target.module.result.semanticIndex.symbols.find((symbol) => symbol.kind === "class" && symbol.name === target.symbol.container);
  return owner ? { module: target.module, symbol: owner } : null;
}

function baseClassOwner(project: ProjectResult, owner: MemberTarget): MemberTarget | null {
  const base = owner.module.result.moduleInterface.classes.get(owner.symbol.name)?.base;
  return base ? ownerTarget(project, owner.module, base, "class") : null;
}

function directClassMember(
  owner: MemberTarget,
  name: string,
  staticMember: boolean,
  expectedKind?: "field" | "method",
): MemberTarget | null {
  const symbol = owner.module.result.semanticIndex.symbols.find((item) => item.container === owner.symbol.name
    && item.name === name
    && (!expectedKind || item.kind === expectedKind)
    && (item.kind === "field" || item.kind === "method")
    && Boolean(item.static) === staticMember);
  return symbol ? { module: owner.module, symbol } : null;
}

function classDescendsFrom(project: ProjectResult, candidate: MemberTarget, expected: MemberTarget): boolean {
  const visited = new Set<string>();
  for (let current: MemberTarget | null = candidate; current; current = baseClassOwner(project, current)) {
    if (current.symbol.id === expected.symbol.id) return true;
    if (visited.has(current.symbol.id)) return false;
    visited.add(current.symbol.id);
  }
  return false;
}

function exportedTarget(project: ProjectResult, importer: ProjectModule, imported: SemanticImport): ExportTarget | null {
  const targetModule = importedModule(project, importer, imported);
  if (!targetModule) return null;
  const symbol = targetModule.result.semanticIndex.symbols.find((item) => item.exported && item.name === imported.imported);
  return symbol ? { kind: "export", module: targetModule, symbol } : null;
}

function importedModule(project: ProjectResult, importer: ProjectModule, imported: SemanticImport): ProjectModule | null {
  const target = imported.source.startsWith(".") && extname(imported.source) === ".vel"
    ? resolve(dirname(importer.inputPath), imported.source)
    : project.velarImports.get(projectImportKey(importer.inputPath, imported.source));
  return target ? moduleAt(project, target) : null;
}

function enumMemberAt(project: ProjectResult, module: ProjectModule, offset: number): SemanticSymbol | null {
  const source = module.result.source.text;
  const property = wordSpanAt(source, offset);
  if (!property) return null;
  let dot = property.start - 1;
  while (dot >= 0 && /\s/u.test(source[dot]!)) dot -= 1;
  if (source[dot] !== ".") return null;
  let ownerEnd = dot;
  while (ownerEnd > 0 && /\s/u.test(source[ownerEnd - 1]!)) ownerEnd -= 1;
  let ownerStart = ownerEnd;
  while (ownerStart > 0 && /[A-Za-z0-9_]/u.test(source[ownerStart - 1]!)) ownerStart -= 1;
  if (ownerStart === ownerEnd || !/[A-Za-z_]/u.test(source[ownerStart]!)) return null;
  const owner = projectSymbolAt(project, module.inputPath, ownerStart);
  if (owner?.kind !== "enum") return null;
  const target = moduleAt(project, owner.path);
  if (!target) return null;
  const name = source.slice(property.start, property.end);
  return target.result.semanticIndex.symbols.find((symbol) => symbol.kind === "enum-member" && symbol.container === owner.name && symbol.name === name) ?? null;
}

function enumMemberTargetAt(project: ProjectResult, module: ProjectModule, offset: number): SemanticSymbol | null {
  const qualified = enumMemberAt(project, module, offset);
  if (qualified) return qualified;
  const local = semanticSymbolAt(module.result.semanticIndex, offset);
  return local?.kind === "enum-member" ? local : null;
}

function enumMemberLocations(
  project: ProjectResult,
  target: SemanticSymbol,
  includeDeclaration: boolean,
): readonly ProjectLocation[] {
  const locations: ProjectLocation[] = includeDeclaration ? [locationOf(target)] : [];
  const pattern = new RegExp(`\\b${escapeRegExp(target.name)}\\b`, "gu");
  for (const module of project.modules) {
    const source = module.result.source.text;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
      const member = enumMemberAt(project, module, match.index);
      if (member?.id === target.id && member.path === target.path) {
        locations.push({ path: module.inputPath, span: { start: match.index, end: match.index + target.name.length } });
      }
    }
  }
  return uniqueLocations(locations);
}

function enumMemberRenameCollides(project: ProjectResult, target: SemanticSymbol, newName: string): boolean {
  const module = moduleAt(project, target.path);
  return module?.result.semanticIndex.symbols.some((symbol) => symbol.kind === "enum-member"
    && symbol.id !== target.id
    && symbol.container === target.container
    && symbol.name === newName) ?? false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function exportedLocations(project: ProjectResult, target: ExportTarget, includeDeclaration: boolean): ProjectLocation[] {
  const locations = includeDeclaration ? [locationOf(target.symbol)] : [];
  locations.push(...referencesFor(target.module, target.symbol));
  for (const module of project.modules) {
    for (const imported of module.result.semanticIndex.imports) {
      const importedTarget = exportedTarget(project, module, imported);
      if (!importedTarget || importedTarget.symbol.id !== target.symbol.id) continue;
      locations.push({ path: module.inputPath, span: imported.importedSpan });
      if (imported.local === imported.imported) {
        const local = module.result.semanticIndex.symbols.find((symbol) => symbol.id === imported.localSymbolId);
        if (local) locations.push(...referencesFor(module, local));
      }
    }
  }
  return locations;
}

function localLocations(target: LocalTarget, includeDeclaration: boolean): ProjectLocation[] {
  return [
    ...(includeDeclaration ? [locationOf(target.symbol)] : []),
    ...referencesFor(target.module, target.symbol),
  ];
}

function referencesFor(module: ProjectModule, symbol: SemanticSymbol): ProjectLocation[] {
  return module.result.semanticIndex.references
    .filter((reference) => reference.symbolId === symbol.id)
    .map((reference) => ({ path: module.inputPath, span: reference.span }));
}

function renameCollides(project: ProjectResult, target: ProjectTarget, newName: string): boolean {
  if (scopeHasName(target.module.result.semanticIndex, target.symbol, newName)) return true;
  if (target.kind !== "export") return false;
  for (const module of project.modules) {
    for (const imported of module.result.semanticIndex.imports) {
      if (imported.local !== imported.imported) continue;
      const importedTarget = exportedTarget(project, module, imported);
      if (!importedTarget || importedTarget.symbol.id !== target.symbol.id) continue;
      const local = module.result.semanticIndex.symbols.find((symbol) => symbol.id === imported.localSymbolId);
      if (local && scopeHasName(module.result.semanticIndex, local, newName)) return true;
    }
  }
  return false;
}

function scopeHasName(index: SemanticIndex, target: SemanticSymbol, newName: string): boolean {
  return index.symbols.some((symbol) => symbol.id !== target.id && symbol.scopeId === target.scopeId && symbol.name === newName);
}

function renameSelectionAt(index: SemanticIndex, offset: number, fallback: SemanticSymbol): Span {
  const imported = semanticImportAt(index, offset);
  if (imported) {
    if (contains(imported.localSpan, offset)) return imported.localSpan;
    if (contains(imported.importedSpan, offset)) return imported.importedSpan;
  }
  const reference = index.references.find((item) => contains(item.span, offset));
  return reference?.span ?? fallback.selectionSpan;
}

function importForSymbol(index: SemanticIndex, symbolId: string): SemanticImport | null {
  return index.imports.find((item) => item.localSymbolId === symbolId) ?? null;
}

function moduleAt(project: ProjectResult, path: string): ProjectModule | null {
  const absolute = resolve(path);
  return project.modules.find((module) => module.inputPath === absolute) ?? null;
}

function locationOf(symbol: SemanticSymbol): ProjectLocation {
  return { path: symbol.path, span: symbol.selectionSpan };
}

function uniqueLocations(locations: readonly ProjectLocation[]): readonly ProjectLocation[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = `${location.path}:${location.span.start}:${location.span.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.path.localeCompare(right.path) || left.span.start - right.span.start);
}

function uniqueTextEdits(edits: readonly ProjectTextEdit[]): readonly ProjectTextEdit[] {
  const seen = new Set<string>();
  return edits.filter((edit) => {
    const key = `${edit.path}:${edit.span.start}:${edit.span.end}:${edit.replacement ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.path.localeCompare(right.path) || left.span.start - right.span.start);
}

function renameable(symbol: SemanticSymbol): boolean {
  return symbol.kind !== "field" && symbol.kind !== "method" && symbol.kind !== "enum-member";
}

function contains(span: Span, offset: number): boolean {
  return offset >= span.start && offset < span.end;
}

function wordSpanAt(source: string, offset: number): Span | null {
  let start = Math.min(Math.max(0, offset), source.length);
  if (start === source.length || !/[A-Za-z0-9_]/u.test(source[start]!)) start -= 1;
  if (start < 0 || !/[A-Za-z0-9_]/u.test(source[start]!)) return null;
  let end = start + 1;
  while (start > 0 && /[A-Za-z0-9_]/u.test(source[start - 1]!)) start -= 1;
  while (end < source.length && /[A-Za-z0-9_]/u.test(source[end]!)) end += 1;
  return { start, end };
}

function callAt(source: string, offset: number): { readonly calleeOffset: number; readonly activeParameter: number } | null {
  let depth = 0;
  let activeParameter = 0;
  let quote: string | null = null;
  for (let index = Math.min(offset, source.length) - 1; index >= 0; index -= 1) {
    const character = source[index]!;
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; continue; }
    if (character === ")" || character === "]" || character === "}") { depth += 1; continue; }
    if (character === "(" || character === "[" || character === "{") {
      if (depth > 0) { depth -= 1; continue; }
      if (character !== "(") return null;
      let end = index;
      while (end > 0 && /\s/u.test(source[end - 1]!)) end -= 1;
      let start = end;
      while (start > 0 && /[A-Za-z0-9_]/u.test(source[start - 1]!)) start -= 1;
      return start === end ? null : { calleeOffset: start, activeParameter };
    }
    if (character === "," && depth === 0) activeParameter += 1;
    if (character === "\n" && depth === 0) return null;
  }
  return null;
}
