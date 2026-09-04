import type {
  AnyNode,
  Identifier,
  Node,
  Pattern,
  PrivateIdentifier,
  Program,
} from "acorn";
import { span, type Span } from "./source.ts";

export type EmbeddedJavaScriptEditorTokenType =
  | "class"
  | "function"
  | "method"
  | "property"
  | "variable"
  | "parameter";

export type EmbeddedJavaScriptEditorTokenModifier = "declaration" | "readonly" | "static";

/**
 * One editor-only JavaScript identifier classification. These tokens never
 * enter the VelarScript symbol/reference index: they describe a foreign AST
 * solely so an LSP client can color the source that Acorn already parsed.
 */
export interface EmbeddedJavaScriptEditorToken {
  readonly span: Span;
  readonly type: EmbeddedJavaScriptEditorTokenType;
  readonly modifiers: readonly EmbeddedJavaScriptEditorTokenModifier[];
}

type NameNode = Identifier | PrivateIdentifier;

interface JavaScriptBinding {
  readonly type: "class" | "function" | "variable" | "parameter" | null;
  readonly readonly: boolean;
}

interface JavaScriptScope {
  readonly parent: JavaScriptScope | null;
  readonly functionScope: JavaScriptScope;
  readonly bindings: Map<string, JavaScriptBinding>;
}

interface WalkFrame {
  readonly node: AnyNode;
  readonly parent: AnyNode | null;
  readonly key: string;
  readonly scope: JavaScriptScope;
  /** Whether `this` is provably the constructor or an instance at this point. */
  readonly staticThis: boolean | null;
  /** Defined only for the function value owned by a class method. */
  readonly methodStaticThis: boolean | null | undefined;
}

interface VisitedNode extends WalkFrame {}

/**
 * Derives only roles established by ECMAScript syntax and lexical binding.
 * In particular, an unresolved ordinary global does not become a guessed
 * variable/function token. A name in `new X()` or `class Y extends X` is a
 * constructor position, so that use can safely receive the editor's `class`
 * role without claiming a JavaScript type for X.
 */
export function embeddedJavaScriptEditorTokens(
  program: Program,
  sourceStart: number,
  rootParameters: readonly string[] = [],
): readonly EmbeddedJavaScriptEditorToken[] {
  const rootScope = rootJavaScriptScope();
  for (const name of rootParameters) rootScope.bindings.set(name, { type: "parameter", readonly: false });
  const declarations = new WeakSet<object>();
  const handledNames = new WeakSet<object>();
  const visited = new WeakSet<object>();
  const nodes: VisitedNode[] = [];
  const parents = new WeakMap<object, { readonly parent: AnyNode; readonly key: string }>();
  const tokenBySpan = new Map<string, { readonly token: EmbeddedJavaScriptEditorToken; readonly priority: number }>();

  const addToken = (
    node: NameNode,
    type: EmbeddedJavaScriptEditorTokenType,
    modifiers: readonly EmbeddedJavaScriptEditorTokenModifier[],
    priority: number,
  ): void => {
    if (node.end <= node.start) return;
    const tokenSpan = span(sourceStart + node.start, sourceStart + node.end);
    const key = `${tokenSpan.start}:${tokenSpan.end}`;
    const token = { span: tokenSpan, type, modifiers: orderedModifiers(modifiers) } satisfies EmbeddedJavaScriptEditorToken;
    if ((tokenBySpan.get(key)?.priority ?? -1) < priority) tokenBySpan.set(key, { token, priority });
  };

  const bind = (scope: JavaScriptScope, name: string, binding: JavaScriptBinding): void => {
    const existing = scope.bindings.get(name);
    if (!existing) {
      scope.bindings.set(name, binding);
      return;
    }
    // Legal `var`/function redeclarations share one binding. If their source
    // forms disagree about the editor role, retain no guessed role for uses.
    if (existing.type !== binding.type) {
      scope.bindings.set(name, { type: null, readonly: existing.readonly && binding.readonly });
    }
  };

  const declareName = (
    node: NameNode,
    scope: JavaScriptScope,
    binding: JavaScriptBinding,
  ): JavaScriptBinding => {
    declarations.add(node);
    bind(scope, node.name, binding);
    if (binding.type) {
      addToken(node, binding.type, ["declaration", ...(binding.readonly ? ["readonly" as const] : [])], 6);
    }
    return binding;
  };

  const declarePattern = (
    pattern: Pattern,
    scope: JavaScriptScope,
    binding: JavaScriptBinding,
  ): void => {
    switch (pattern.type) {
      case "Identifier":
        declareName(pattern, scope, binding);
        break;
      case "ObjectPattern":
        for (const property of pattern.properties) {
          if (property.type === "RestElement") {
            declarePattern(property.argument, scope, binding);
            continue;
          }
          if (!property.computed && isNameNode(property.key)
            && !(property.shorthand && sameSourceSpan(property.key, property.value))) {
            handledNames.add(property.key);
            addToken(property.key, "property", [], 4);
          }
          declarePattern(property.value, scope, binding);
        }
        break;
      case "ArrayPattern":
        for (const element of pattern.elements) if (element) declarePattern(element, scope, binding);
        break;
      case "RestElement":
        declarePattern(pattern.argument, scope, binding);
        break;
      case "AssignmentPattern":
        declarePattern(pattern.left, scope, binding);
        break;
      case "MemberExpression":
        break;
    }
  };

  const pending: WalkFrame[] = [{
    node: program,
    parent: null,
    key: "",
    scope: rootScope,
    staticThis: null,
    methodStaticThis: undefined,
  }];

  const push = (
    node: unknown,
    parent: AnyNode,
    key: string,
    scope: JavaScriptScope,
    staticThis: boolean | null,
    methodStaticThis: boolean | null | undefined = undefined,
  ): void => {
    if (!isNode(node)) return;
    pending.push({ node, parent, key, scope, staticThis, methodStaticThis });
  };

  const pushChildren = (
    node: AnyNode,
    scope: JavaScriptScope,
    staticThis: boolean | null,
  ): void => {
    const entries = Object.entries(node);
    for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
      const [key, value] = entries[entryIndex]!;
      if (structuralNodeKey(key)) continue;
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          push(value[index], node, key, scope, staticThis);
        }
      } else {
        push(value, node, key, scope, staticThis);
      }
    }
  };

  while (pending.length > 0) {
    const frame = pending.pop()!;
    if (visited.has(frame.node)) continue;
    visited.add(frame.node);
    nodes.push(frame);
    if (frame.parent) parents.set(frame.node, { parent: frame.parent, key: frame.key });

    switch (frame.node.type) {
      case "BlockStatement": {
        const blockScope = childJavaScriptScope(frame.scope);
        pushChildren(frame.node, blockScope, frame.staticThis);
        break;
      }
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const lexicalScope = childJavaScriptScope(frame.scope);
        pushChildren(frame.node, lexicalScope, frame.staticThis);
        break;
      }
      case "SwitchStatement": {
        // The case block owns one shared lexical scope, but the discriminant is
        // evaluated before entering it.
        const caseScope = childJavaScriptScope(frame.scope);
        for (let index = frame.node.cases.length - 1; index >= 0; index -= 1) {
          push(frame.node.cases[index], frame.node, "cases", caseScope, frame.staticThis);
        }
        push(frame.node.discriminant, frame.node, "discriminant", frame.scope, frame.staticThis);
        break;
      }
      case "CatchClause": {
        const catchScope = childJavaScriptScope(frame.scope);
        if (frame.node.param) declarePattern(frame.node.param, catchScope, { type: "variable", readonly: false });
        pushChildren(frame.node, catchScope, frame.staticThis);
        break;
      }
      case "StaticBlock": {
        // A class static block owns its own `var` scope; it must not hoist a
        // declaration into the surrounding module or enclosing function.
        const staticScope = functionJavaScriptScope(frame.scope);
        pushChildren(frame.node, staticScope, true);
        break;
      }
      case "FunctionDeclaration": {
        const functionScope = functionJavaScriptScope(frame.scope);
        if (frame.node.id) {
          const binding = declareName(frame.node.id, frame.scope, { type: "function", readonly: false });
          bind(functionScope, frame.node.id.name, binding);
        }
        for (const parameter of frame.node.params) {
          declarePattern(parameter, functionScope, { type: "parameter", readonly: false });
        }
        const bodyScope = patternsHaveDefaults(frame.node.params) ? functionJavaScriptScope(functionScope) : functionScope;
        push(frame.node.body, frame.node, "body", bodyScope, null);
        for (let index = frame.node.params.length - 1; index >= 0; index -= 1) {
          push(frame.node.params[index], frame.node, "params", functionScope, null);
        }
        push(frame.node.id, frame.node, "id", functionScope, null);
        break;
      }
      case "FunctionExpression": {
        const staticThis = frame.methodStaticThis ?? null;
        const functionScope = functionJavaScriptScope(frame.scope);
        if (frame.node.id) declareName(frame.node.id, functionScope, { type: "function", readonly: false });
        for (const parameter of frame.node.params) {
          declarePattern(parameter, functionScope, { type: "parameter", readonly: false });
        }
        const bodyScope = patternsHaveDefaults(frame.node.params) ? functionJavaScriptScope(functionScope) : functionScope;
        push(frame.node.body, frame.node, "body", bodyScope, staticThis);
        for (let index = frame.node.params.length - 1; index >= 0; index -= 1) {
          push(frame.node.params[index], frame.node, "params", functionScope, staticThis);
        }
        push(frame.node.id, frame.node, "id", functionScope, staticThis);
        break;
      }
      case "ArrowFunctionExpression": {
        const functionScope = functionJavaScriptScope(frame.scope);
        for (const parameter of frame.node.params) {
          declarePattern(parameter, functionScope, { type: "parameter", readonly: false });
        }
        const bodyScope = patternsHaveDefaults(frame.node.params) ? functionJavaScriptScope(functionScope) : functionScope;
        push(frame.node.body, frame.node, "body", bodyScope, frame.staticThis);
        for (let index = frame.node.params.length - 1; index >= 0; index -= 1) {
          push(frame.node.params[index], frame.node, "params", functionScope, frame.staticThis);
        }
        break;
      }
      case "ClassDeclaration": {
        const classScope = childJavaScriptScope(frame.scope);
        if (frame.node.id) {
          const binding = declareName(frame.node.id, frame.scope, { type: "class", readonly: false });
          bind(classScope, frame.node.id.name, binding);
        }
        push(frame.node.body, frame.node, "body", classScope, frame.staticThis);
        push(frame.node.superClass, frame.node, "superClass", frame.scope, frame.staticThis);
        break;
      }
      case "ClassExpression": {
        const classScope = childJavaScriptScope(frame.scope);
        if (frame.node.id) declareName(frame.node.id, classScope, { type: "class", readonly: false });
        push(frame.node.body, frame.node, "body", classScope, frame.staticThis);
        push(frame.node.superClass, frame.node, "superClass", classScope, frame.staticThis);
        break;
      }
      case "VariableDeclaration": {
        const bindingScope = frame.node.kind === "var" ? frame.scope.functionScope : frame.scope;
        const readonly = frame.node.kind === "const" || frame.node.kind === "using" || frame.node.kind === "await using";
        for (const declaration of frame.node.declarations) {
          declarePattern(declaration.id, bindingScope, { type: "variable", readonly });
        }
        pushChildren(frame.node, frame.scope, frame.staticThis);
        break;
      }
      case "ImportDeclaration":
        // Acorn proves that imported locals are immutable, but not whether the
        // remote declaration is a class, function, or value. Record the lexical
        // binding for shadowing while emitting no misleading role token.
        for (const specifier of frame.node.specifiers) {
          declareName(specifier.local, frame.scope, { type: null, readonly: true });
        }
        pushChildren(frame.node, frame.scope, frame.staticThis);
        break;
      case "MethodDefinition": {
        if (!frame.node.computed && isNameNode(frame.node.key)) {
          handledNames.add(frame.node.key);
          addToken(
            frame.node.key,
            frame.node.kind === "get" || frame.node.kind === "set" ? "property" : "method",
            ["declaration", ...(frame.node.static ? ["static" as const] : [])],
            5,
          );
        }
        push(frame.node.value, frame.node, "value", frame.scope, frame.staticThis, frame.node.static);
        if (frame.node.computed) push(frame.node.key, frame.node, "key", frame.scope, frame.staticThis);
        break;
      }
      case "PropertyDefinition": {
        if (!frame.node.computed && isNameNode(frame.node.key)) {
          handledNames.add(frame.node.key);
          addToken(
            frame.node.key,
            "property",
            ["declaration", ...(frame.node.static ? ["static" as const] : [])],
            5,
          );
        }
        push(frame.node.value, frame.node, "value", frame.scope, frame.node.static);
        if (frame.node.computed) push(frame.node.key, frame.node, "key", frame.scope, frame.staticThis);
        break;
      }
      case "Property": {
        const patternProperty = frame.parent?.type === "ObjectPattern";
        if (!frame.node.computed && isNameNode(frame.node.key)
          && !(frame.node.shorthand && sameSourceSpan(frame.node.key, frame.node.value))) {
          handledNames.add(frame.node.key);
          addToken(
            frame.node.key,
            !patternProperty && frame.node.method ? "method" : "property",
            patternProperty ? [] : ["declaration"],
            4,
          );
        }
        pushChildren(frame.node, frame.scope, frame.staticThis);
        break;
      }
      default:
        pushChildren(frame.node, frame.scope, frame.staticThis);
        break;
    }
  }

  for (const frame of nodes) {
    const node = frame.node;
    if (!isNameNode(node) || declarations.has(node) || handledNames.has(node)) continue;
    const parent = frame.parent;
    if (!parent || isNonValueIdentifier(node, parent, frame.key)) continue;

    if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) {
      const type = memberExpressionIsConstructor(parent, parents)
        ? "class"
        : memberExpressionIsCalled(parent, parents) ? "method" : "property";
      const isStatic = memberExpressionIsStatic(parent, frame.scope, frame.staticThis);
      addToken(node, type, isStatic ? ["static"] : [], 3);
      continue;
    }

    if (parent.type === "Property" && parent.shorthand && sameSourceSpan(parent.key, node)) {
      // Shorthand keys keep the JavaScript parser's property role. Declaration
      // patterns were already marked above and never reach this pass; the
      // remaining ObjectPattern form is a destructuring assignment target.
      addToken(node, "property", [], 3);
      continue;
    }

    const binding = resolveBinding(frame.scope, node.name);
    if (binding?.type) {
      addToken(node, binding.type, binding.readonly ? ["readonly"] : [], 2);
      continue;
    }
    if (identifierIsConstructor(node, parent, frame.key)) addToken(node, "class", [], 2);
    else if (node.type === "PrivateIdentifier") addToken(node, "property", [], 2);
  }

  return [...tokenBySpan.values()]
    .map((entry) => entry.token)
    .sort((left, right) => left.span.start - right.span.start || left.span.end - right.span.end);
}

function rootJavaScriptScope(): JavaScriptScope {
  const root = { parent: null, bindings: new Map<string, JavaScriptBinding>() } as JavaScriptScope;
  Object.defineProperty(root, "functionScope", { value: root, enumerable: true });
  return root;
}

function childJavaScriptScope(parent: JavaScriptScope): JavaScriptScope {
  return { parent, functionScope: parent.functionScope, bindings: new Map() };
}

function functionJavaScriptScope(parent: JavaScriptScope): JavaScriptScope {
  const scope = { parent, bindings: new Map<string, JavaScriptBinding>() } as JavaScriptScope;
  Object.defineProperty(scope, "functionScope", { value: scope, enumerable: true });
  return scope;
}

function resolveBinding(scope: JavaScriptScope, name: string): JavaScriptBinding | null {
  for (let current: JavaScriptScope | null = scope; current; current = current.parent) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
  return null;
}

function memberExpressionIsCalled(
  expression: Extract<AnyNode, { readonly type: "MemberExpression" }>,
  parents: WeakMap<object, { readonly parent: AnyNode; readonly key: string }>,
): boolean {
  const owner = semanticOwner(expression, parents);
  if (!owner) return false;
  return (owner.parent.type === "CallExpression" && owner.key === "callee")
    || (owner.parent.type === "TaggedTemplateExpression" && owner.key === "tag");
}

function memberExpressionIsConstructor(
  expression: Extract<AnyNode, { readonly type: "MemberExpression" }>,
  parents: WeakMap<object, { readonly parent: AnyNode; readonly key: string }>,
): boolean {
  const owner = semanticOwner(expression, parents);
  if (!owner) return false;
  return (owner.parent.type === "NewExpression" && owner.key === "callee")
    || ((owner.parent.type === "ClassDeclaration" || owner.parent.type === "ClassExpression") && owner.key === "superClass")
    || (owner.parent.type === "BinaryExpression" && owner.parent.operator === "instanceof" && owner.key === "right");
}

function semanticOwner(
  node: AnyNode,
  parents: WeakMap<object, { readonly parent: AnyNode; readonly key: string }>,
): { readonly parent: AnyNode; readonly key: string } | undefined {
  let owner = parents.get(node);
  while (owner?.parent.type === "ChainExpression" && owner.key === "expression") {
    owner = parents.get(owner.parent);
  }
  return owner;
}

function memberExpressionIsStatic(
  expression: Extract<AnyNode, { readonly type: "MemberExpression" }>,
  scope: JavaScriptScope,
  staticThis: boolean | null,
): boolean {
  if (expression.object.type === "Identifier") return resolveBinding(scope, expression.object.name)?.type === "class";
  return (expression.object.type === "ThisExpression" || expression.object.type === "Super") && staticThis === true;
}

function identifierIsConstructor(node: NameNode, parent: AnyNode, key: string): boolean {
  if (node.type !== "Identifier") return false;
  return (parent.type === "NewExpression" && key === "callee")
    || ((parent.type === "ClassDeclaration" || parent.type === "ClassExpression") && key === "superClass")
    || (parent.type === "BinaryExpression" && parent.operator === "instanceof" && key === "right");
}

function isNonValueIdentifier(node: NameNode, parent: AnyNode, key: string): boolean {
  if (parent.type === "LabeledStatement" && key === "label") return true;
  if ((parent.type === "BreakStatement" || parent.type === "ContinueStatement") && key === "label") return true;
  if (parent.type === "MetaProperty") return true;
  if (parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier" || parent.type === "ImportNamespaceSpecifier") return true;
  if (parent.type === "ExportSpecifier" && key === "exported" && !sameSourceSpan(parent.local, parent.exported)) return true;
  return parent.type === "Property" && key === "key" && !parent.computed && !parent.shorthand;
}

function orderedModifiers(
  modifiers: readonly EmbeddedJavaScriptEditorTokenModifier[],
): readonly EmbeddedJavaScriptEditorTokenModifier[] {
  return (["declaration", "readonly", "static"] as const).filter((modifier) => modifiers.includes(modifier));
}

function isNameNode(node: unknown): node is NameNode {
  return isNode(node) && (node.type === "Identifier" || node.type === "PrivateIdentifier");
}

function isNode(value: unknown): value is AnyNode {
  return typeof value === "object" && value !== null
    && typeof (value as Partial<Node>).type === "string"
    && typeof (value as Partial<Node>).start === "number"
    && typeof (value as Partial<Node>).end === "number";
}

function sameSourceSpan(left: Pick<Node, "start" | "end">, right: Pick<Node, "start" | "end">): boolean {
  return left.start === right.start && left.end === right.end;
}

function patternsHaveDefaults(patterns: readonly Pattern[]): boolean {
  const pending: unknown[] = [...patterns];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (!isNode(value) || visited.has(value)) continue;
    visited.add(value);
    if (value.type === "AssignmentPattern") return true;
    for (const [key, child] of Object.entries(value)) {
      if (structuralNodeKey(key)) continue;
      if (Array.isArray(child)) pending.push(...child);
      else pending.push(child);
    }
  }
  return false;
}

function structuralNodeKey(key: string): boolean {
  return key === "type" || key === "start" || key === "end" || key === "range" || key === "loc";
}
