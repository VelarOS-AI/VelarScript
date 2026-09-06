import type { AnyNode, Program } from "acorn";

export type JavaScriptLoaderOrigin =
  | "global-object"
  | "node-process"
  | "commonjs-module"
  | "commonjs-require"
  | "node-module-namespace"
  | "create-require"
  | "get-builtin-module";

export type JavaScriptLoaderOrigins = number;

const JAVASCRIPT_LOADER_ORIGIN: Readonly<Record<JavaScriptLoaderOrigin, JavaScriptLoaderOrigins>> = {
  "global-object": 1 << 0,
  "node-process": 1 << 1,
  "commonjs-module": 1 << 2,
  "commonjs-require": 1 << 3,
  "node-module-namespace": 1 << 4,
  "create-require": 1 << 5,
  "get-builtin-module": 1 << 6,
};

export interface JavaScriptBinding {
  origins: JavaScriptLoaderOrigins;
}

export interface JavaScriptScope {
  readonly parent: JavaScriptScope | null;
  readonly functionScope: boolean;
  readonly bindings: Map<string, JavaScriptBinding>;
}

export interface JavaScriptVariableAlias {
  readonly pattern: AnyNode;
  readonly initializer: AnyNode;
}

export interface JavaScriptAliasEscape {
  readonly target: AnyNode;
  readonly initializer: AnyNode;
}

export interface JavaScriptOpaqueLoaderBindings {
  readonly scopeByNode: WeakMap<object, JavaScriptScope>;
  readonly originsByNode: WeakMap<object, JavaScriptLoaderOrigins>;
}

export interface JavaScriptLoaderStructure {
  readonly aliasEscapes: readonly JavaScriptAliasEscape[];
  readonly aliases: readonly JavaScriptVariableAlias[];
  readonly bindings: JavaScriptOpaqueLoaderBindings;
  readonly calls: readonly AnyNode[];
  readonly syntaxNodes: number;
}

interface JavaScriptPendingNode {
  readonly node: AnyNode;
  readonly inheritedScope: JavaScriptScope;
  readonly root: boolean;
}

export function inspectJavaScriptLoaderStructure(program: Program, maximum: number): JavaScriptLoaderStructure {
  const root: JavaScriptScope = { parent: null, functionScope: true, bindings: new Map() };
  const scopeByNode = new WeakMap<object, JavaScriptScope>();
  const aliases: JavaScriptVariableAlias[] = [];
  const aliasEscapes: JavaScriptAliasEscape[] = [];
  const calls: AnyNode[] = [];
  const pending: JavaScriptPendingNode[] = [{ node: program, inheritedScope: root, root: true }];
  const visited = new WeakSet<object>();
  let syntaxNodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current.node)) continue;
    visited.add(current.node);
    syntaxNodes += 1;
    if (syntaxNodes > maximum) {
      throw new RangeError(`JavaScript module syntax tree exceeds ${maximum} nodes`);
    }
    const scope = javascriptNodeScope(current.node, current.inheritedScope, current.root);
    scopeByNode.set(current.node, scope);
    collectJavaScriptDeclarations(current.node, scope, aliases, aliasEscapes);
    if (current.node.type === "CallExpression" || current.node.type === "NewExpression") calls.push(current.node);
    forEachChildNode(current.node, (child) => {
      pending.push({ node: child, inheritedScope: scope, root: false });
    }, true);
  }
  return {
    aliases,
    aliasEscapes,
    bindings: { scopeByNode, originsByNode: new WeakMap() },
    calls,
    syntaxNodes,
  };
}

export function loaderOrigin(origin: JavaScriptLoaderOrigin): JavaScriptLoaderOrigins {
  return JAVASCRIPT_LOADER_ORIGIN[origin];
}

export function hasLoaderOrigin(origins: JavaScriptLoaderOrigins, origin: JavaScriptLoaderOrigin): boolean {
  return (origins & loaderOrigin(origin)) !== 0;
}

export function resolveJavaScriptBinding(scope: JavaScriptScope, name: string): JavaScriptBinding | null {
  for (let current: JavaScriptScope | null = scope; current !== null; current = current.parent) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
  return null;
}

export function nodeName(node: AnyNode): string | null {
  const name = (node as AnyNode & { readonly name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

function javascriptNodeScope(
  node: AnyNode,
  inheritedScope: JavaScriptScope,
  root = false,
): JavaScriptScope {
  if (root) return inheritedScope;
  if (isFunctionNode(node)) {
    if (node.type === "FunctionDeclaration") declareNamedNode(inheritedScope, node);
    const scope = childJavaScriptScope(inheritedScope, true);
    if (node.type === "FunctionExpression") declareNamedNode(scope, node);
    for (const parameter of functionParameters(node)) declarePattern(scope, parameter);
    return scope;
  }
  if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    if (node.type === "ClassDeclaration") declareNamedNode(inheritedScope, node);
    const scope = childJavaScriptScope(inheritedScope, false);
    declareNamedNode(scope, node);
    return scope;
  }
  if (introducesLexicalScope(node)) {
    const scope = childJavaScriptScope(inheritedScope, false);
    if (node.type === "CatchClause") {
      const parameter = (node as AnyNode & { readonly param?: AnyNode | null }).param;
      if (parameter) declarePattern(scope, parameter);
    }
    return scope;
  }
  return inheritedScope;
}

function collectJavaScriptDeclarations(
  node: AnyNode,
  scope: JavaScriptScope,
  aliases: JavaScriptVariableAlias[],
  aliasEscapes: JavaScriptAliasEscape[],
): void {
  if (node.type === "ImportDeclaration") declareImportBindings(node, scope);
  if (node.type === "VariableDeclaration") {
    const declaration = node as AnyNode & {
      readonly declarations?: readonly AnyNode[];
      readonly kind?: string;
    };
    const targetScope = declaration.kind === "var" ? nearestFunctionScope(scope) : scope;
    for (const declarator of declaration.declarations ?? []) {
      const candidate = declarator as AnyNode & { readonly id?: AnyNode; readonly init?: AnyNode | null };
      if (candidate.id === undefined) continue;
      declarePattern(targetScope, candidate.id);
      if (candidate.init) aliases.push({ pattern: candidate.id, initializer: candidate.init });
    }
  }
  if (node.type === "AssignmentExpression") collectAssignment(node, aliases, aliasEscapes);
  if (node.type === "AssignmentPattern") {
    const pattern = node as AnyNode & { readonly left?: AnyNode; readonly right?: AnyNode };
    if (pattern.left && pattern.right && isAliasPattern(pattern.left)) {
      // A default is a second possible initializer. Join it with the ordinary
      // declaration/parameter origin instead of erasing a branch-only loader.
      aliases.push({ pattern: pattern.left, initializer: pattern.right });
    }
  }
  if (node.type === "CallExpression" || node.type === "NewExpression") {
    const call = node as AnyNode & { readonly arguments?: readonly AnyNode[] };
    for (const argument of call.arguments ?? []) collectEscape(argument, aliasEscapes);
  }
  if (node.type === "ArrayExpression") {
    for (const element of (node as AnyNode & { readonly elements?: readonly (AnyNode | null)[] }).elements ?? []) {
      if (element) collectEscape(element, aliasEscapes);
    }
  }
  if (node.type === "ObjectExpression") collectObjectEscapes(node, aliasEscapes);
}

function collectAssignment(
  node: AnyNode,
  aliases: JavaScriptVariableAlias[],
  aliasEscapes: JavaScriptAliasEscape[],
): void {
  const assignment = node as AnyNode & {
    readonly left?: AnyNode;
    readonly operator?: string;
    readonly right?: AnyNode;
  };
  if (assignment.operator !== "=" || !assignment.left || !assignment.right) return;
  if (isAliasPattern(assignment.left)) aliases.push({ pattern: assignment.left, initializer: assignment.right });
  else if (assignment.left.type === "MemberExpression") {
    aliasEscapes.push({ target: assignment.left, initializer: assignment.right });
  }
}

function collectEscape(node: AnyNode, escapes: JavaScriptAliasEscape[]): void {
  escapes.push({
    target: node,
    initializer: node.type === "SpreadElement"
      ? (node as AnyNode & { readonly argument: AnyNode }).argument
      : node,
  });
}

function collectObjectEscapes(node: AnyNode, escapes: JavaScriptAliasEscape[]): void {
  for (const property of (node as AnyNode & { readonly properties?: readonly AnyNode[] }).properties ?? []) {
    if (property.type === "SpreadElement") {
      const argument = (property as AnyNode & { readonly argument?: AnyNode }).argument;
      if (argument) escapes.push({ target: property, initializer: argument });
      continue;
    }
    if (property.type !== "Property") continue;
    const value = (property as AnyNode & { readonly value?: AnyNode }).value;
    if (value) escapes.push({ target: value, initializer: value });
  }
}

function childJavaScriptScope(parent: JavaScriptScope, functionScope: boolean): JavaScriptScope {
  return { parent, functionScope, bindings: new Map() };
}

function introducesLexicalScope(node: AnyNode): boolean {
  return node.type === "BlockStatement"
    || node.type === "StaticBlock"
    || node.type === "CatchClause"
    || node.type === "ForStatement"
    || node.type === "ForInStatement"
    || node.type === "ForOfStatement"
    || node.type === "SwitchStatement";
}

function isFunctionNode(node: AnyNode): boolean {
  return node.type === "FunctionDeclaration"
    || node.type === "FunctionExpression"
    || node.type === "ArrowFunctionExpression";
}

function functionParameters(node: AnyNode): readonly AnyNode[] {
  return (node as AnyNode & { readonly params?: readonly AnyNode[] }).params ?? [];
}

function declareNamedNode(scope: JavaScriptScope, node: AnyNode): void {
  const identifier = (node as AnyNode & { readonly id?: AnyNode | null }).id;
  if (identifier?.type === "Identifier") declareJavaScriptBinding(scope, nodeName(identifier), 0);
}

function declareImportBindings(node: AnyNode, scope: JavaScriptScope): void {
  const declaration = node as AnyNode & {
    readonly source: { readonly value?: unknown };
    readonly specifiers?: readonly AnyNode[];
  };
  const source = declaration.source.value;
  const nodeModule = source === "node:module" || source === "module";
  const nodeProcess = source === "node:process" || source === "process";
  for (const specifier of declaration.specifiers ?? []) {
    const local = (specifier as AnyNode & { readonly local?: AnyNode }).local;
    const localName = local?.type === "Identifier" ? nodeName(local) : null;
    if (localName === null) continue;
    let origins = 0;
    if ((nodeModule || nodeProcess) && specifier.type === "ImportSpecifier") {
      const imported = (specifier as AnyNode & { readonly imported?: AnyNode }).imported;
      const importedName = imported === undefined ? null : imported.type === "Literal"
        ? String((imported as AnyNode & { readonly value?: unknown }).value)
        : nodeName(imported);
      if (nodeModule && importedName === "createRequire") origins = loaderOrigin("create-require");
      if (nodeModule && importedName === "default") origins = loaderOrigin("node-module-namespace");
      if (nodeProcess && importedName === "getBuiltinModule") origins = loaderOrigin("get-builtin-module");
      if (nodeProcess && importedName === "default") origins = loaderOrigin("node-process");
    } else if (nodeModule) {
      origins = loaderOrigin("node-module-namespace");
    } else if (nodeProcess) {
      origins = loaderOrigin("node-process");
    }
    declareJavaScriptBinding(scope, localName, origins);
  }
}

function declarePattern(scope: JavaScriptScope, pattern: AnyNode): void {
  if (pattern.type === "Identifier") {
    declareJavaScriptBinding(scope, nodeName(pattern), 0);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    const left = (pattern as AnyNode & { readonly left?: AnyNode }).left;
    if (left) declarePattern(scope, left);
    return;
  }
  if (pattern.type === "RestElement") {
    const argument = (pattern as AnyNode & { readonly argument?: AnyNode }).argument;
    if (argument) declarePattern(scope, argument);
    return;
  }
  if (pattern.type === "ArrayPattern") {
    for (const element of (pattern as AnyNode & { readonly elements?: readonly (AnyNode | null)[] }).elements ?? []) {
      if (element) declarePattern(scope, element);
    }
    return;
  }
  if (pattern.type !== "ObjectPattern") return;
  for (const property of (pattern as AnyNode & { readonly properties?: readonly AnyNode[] }).properties ?? []) {
    if (property.type === "RestElement") declarePattern(scope, property);
    else {
      const value = (property as AnyNode & { readonly value?: AnyNode }).value;
      if (value) declarePattern(scope, value);
    }
  }
}

function isAliasPattern(node: AnyNode): boolean {
  return node.type === "Identifier" || node.type === "ObjectPattern" || node.type === "ArrayPattern";
}

function declareJavaScriptBinding(
  scope: JavaScriptScope,
  name: string | null,
  origins: JavaScriptLoaderOrigins,
): JavaScriptBinding | null {
  if (name === null) return null;
  const existing = scope.bindings.get(name);
  if (existing) {
    existing.origins |= origins;
    return existing;
  }
  const binding = { origins };
  scope.bindings.set(name, binding);
  return binding;
}

function nearestFunctionScope(scope: JavaScriptScope): JavaScriptScope {
  let current = scope;
  while (!current.functionScope && current.parent !== null) current = current.parent;
  return current;
}

function forEachChildNode(node: AnyNode, visit: (child: AnyNode) => void, reverse: boolean): void {
  const fields = Object.entries(node);
  for (let step = 0; step < fields.length; step += 1) {
    const fieldIndex = reverse ? fields.length - step - 1 : step;
    const [key, value] = fields[fieldIndex]!;
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (Array.isArray(value)) {
      for (let childStep = 0; childStep < value.length; childStep += 1) {
        const childIndex = reverse ? value.length - childStep - 1 : childStep;
        if (isNode(value[childIndex])) visit(value[childIndex]);
      }
    } else if (isNode(value)) {
      visit(value);
    }
  }
}

function isNode(value: unknown): value is AnyNode {
  return typeof value === "object" && value !== null && typeof (value as { readonly type?: unknown }).type === "string";
}
