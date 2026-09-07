/**
 * What JSX becomes: a component instance, a native element and its attributes,
 * and the children each of them owns.
 *
 * D115 P4 R3d: the family owns every lowering that builds DOM, plus the two
 * recognizers the analyzer shares with it — `jsxKeyedList` and
 * `dynamicChildLeaves` — so the fast path emission takes and the fast path
 * analysis diagnoses are one definition.
 */
import type { Expression, LoweringHints, Span, Statement } from "@velarscript/compiler/extension";
import { spanIdentity } from "@velarscript/compiler/extension";
import {
  type WebJsxAttribute as JSXAttribute,
  type WebJsxElementExpression as JSXElementExpression,
} from "../ast.ts";
import { cssPropertyName } from "../look.ts";
import { lookToken } from "./look-css.ts";

/**
 * What JSX emission reads and writes on the emitter. The three scope fields are
 * live: a nested element is emitted while they name the scope it builds into,
 * and every path restores what it found.
 */
export interface JsxEmitHost {
  currentJsxNamespace: string;
  currentScope: string | null;
  readonly hints: LoweringHints;
  jsxId: number;
  readonly moduleEvaluation: boolean;
  emitMappedExpression(expression: Expression): string;
  emitMappedJavaScript(sourceSpan: Span, render: () => string): string;
  emitObjectKey(name: string): string;
  emitStatement(statement: Statement, depth: number): string;
}

export function emitJsx(host: JsxEmitHost, expression: JSXElementExpression, scope: string, asChild: boolean, namespace: string, mapped = true): string {
  const render = (): string => emitJsxCode(host, expression, scope, asChild, namespace);
  return mapped ? host.emitMappedJavaScript(expression.span, render) : render();
}

/**
 * A capitalized tag is a component instance; everything else is an element the
 * emitter builds itself.
 */
function emitJsxCode(host: JsxEmitHost, expression: JSXElementExpression, scope: string, asChild: boolean, namespace: string): string {
  return /^[A-Z]/u.test(expression.tag)
    ? emitComponentElement(host, expression, scope, asChild, namespace)
    : emitNativeElement(host, expression, scope, namespace);
}

/**
 * `<App … />`: the props, Look and Style slots, children thunk and `ref` setter
 * one component instantiation is handed, and which of the four instantiation
 * forms the position calls for.
 */
function emitComponentElement(host: JsxEmitHost, expression: JSXElementExpression, scope: string, asChild: boolean, namespace: string): string {
  const reactiveComponent = host.hints.reactiveReferences.has(spanIdentity(expression.tagSpan));
  const componentScope = reactiveComponent ? "__velarDynamicScope" : scope;
  const previousScope = host.currentScope;
  if (reactiveComponent) host.currentScope = componentScope;
  try {
    // Static component identity keeps the existing stable child fast path.
    // A reactive Component value owns a dynamic region that remounts only
    // when the constructor identity itself changes; ordinary prop updates
    // continue through the child's live prop cells.
    const properties = expression.attributes
      .filter((attribute) => attribute.name !== "key" && attribute.name !== "ref" && attribute.name !== "look" && !attribute.name.startsWith("look:")
        && attribute.name !== "style" && !attribute.name.startsWith("style:"))
      .map((attribute) => host.emitMappedJavaScript(
        attribute.span,
        () => `${host.emitObjectKey(attribute.name)}: () => (${emitJsxAttributeValue(host, attribute)})`,
      ));
    const lookValue = emitJsxLookValue(host, expression);
    const lookAttribute = expression.attributes.find((attribute) => attribute.name === "look" || attribute.name.startsWith("look:"));
    if (lookValue && lookAttribute) {
      properties.push(host.emitMappedJavaScript(lookAttribute.span, () => `look: () => (${lookValue})`));
    }
    const styleValue = emitJsxStyleValue(host, expression);
    const styleAttribute = expression.attributes.find((attribute) => attribute.name.startsWith("style:"));
    if (styleValue && styleAttribute) {
      properties.push(host.emitMappedJavaScript(styleAttribute.span, () => `__velarStyle: () => (${styleValue})`));
    }
    // Children stay a thunk so the charter's evaluation order holds at
    // the runtime boundary: props left to right, then children, then the
    // component function. The thunk takes the scope to build into, so the
    // position that shows the slot owns what it built and destroys it when
    // it stops showing it.
    const children = hasMeaningfulChildren(expression.children)
      ? `(__velarChildrenScope = ${componentScope}) => (${emitJsxChildrenCode(host, expression.children, namespace)})`
      : "undefined";
    const ref = expression.attributes.find((attribute) => attribute.name === "ref")?.value;
    const refSetter = ref && typeof ref !== "string" && ref.kind === "IdentifierExpression"
      ? `(next, previous) => { if (previous === undefined || ${ref.name} === previous) ${ref.name} = next; }`
      : null;
    const component = reactiveComponent ? `${expression.tag}.get()` : expression.tag;
    const arguments_ = `${component}, { ${properties.join(", ")} }, ${children}, ${componentScope}, ${namespace}${refSetter ? `, ${refSetter}` : ""}`;
    if (reactiveComponent) {
      return `__velarDynamicComponent((__velarDynamicScope) => __velarChild(${arguments_}), ${scope})`;
    }
    if (asChild) return `__velarChild(${arguments_})`;
    // D90 R4-b's designed site: `const root = <App />` builds its instance
    // while the module evaluates, which is outside every transaction the
    // runtime owns. The site stays legal and eager; only its failure moves,
    // from an uncaught module-evaluation throw to the same no-blank-page
    // machinery `mount` has always run.
    return `${host.moduleEvaluation ? "__velarModuleInstantiate" : "__velarInstantiate"}(${arguments_})`;
  } finally {
    host.currentScope = previousScope;
  }
}

/**
 * `<div … />`: the element, the attributes bound to it, and the children
 * appended to it, all inside the immediately-invoked builder the position
 * evaluates.
 */
function emitNativeElement(host: JsxEmitHost, expression: JSXElementExpression, scope: string, namespace: string): string {
  const id = ++host.jsxId;
  const element = `__velarElement${id}`;
  const elementNamespace = expression.tag === "svg" ? '"svg"' : namespace;
  const childNamespace = expression.tag === "foreignObject" ? '"html"' : elementNamespace;
  const lines = [expression.tag
    ? `const ${element} = __velarCreateElement(${JSON.stringify(expression.tag)}, ${elementNamespace});`
    : `const ${element} = __velarDomCreateFragment();`];
  let emittedLook = false;
  let emittedStyle = false;
  for (const attribute of expression.attributes) {
    if (attribute.name === "key") continue;
    if (attribute.name === "look" || attribute.name.startsWith("look:")) {
      if (!emittedLook) {
        emittedLook = true;
        const lookValue = emitJsxLookValue(host, expression);
        if (lookValue) lines.push(host.emitMappedJavaScript(attribute.span, () => `__velarLookBind(${element}, () => ${lookValue}, ${scope});`));
      }
      continue;
    }
    if (attribute.name.startsWith("style:")) {
      if (!emittedStyle) {
        emittedStyle = true;
        const styleValue = emitJsxStyleValue(host, expression);
        if (styleValue) lines.push(host.emitMappedJavaScript(attribute.span, () => `__velarStyleBind(${element}, () => (${styleValue}), ${scope});`));
      }
      continue;
    }
    if (attribute.name === "style") continue;
    lines.push(host.emitMappedJavaScript(attribute.span, () => emitNativeAttribute(host, expression, attribute, element, scope)));
  }
  for (const child of expression.children) {
    const line = emitNativeChild(host, child, element, scope, childNamespace);
    if (line !== null) lines.push(line);
  }
  lines.push(`return ${element};`);
  return `(() => { ${lines.join(" ")} })()`;
}

/**
 * One attribute of a native element, after the `key`, `look:` and `style:`
 * slots the element itself answers. Each arm is the whole lowering of one
 * attribute family, and the last two are the plain attribute: a literal written
 * once, an expression bound to the scope.
 */
function emitNativeAttribute(host: JsxEmitHost, expression: JSXElementExpression, attribute: JSXAttribute, element: string, scope: string): string {
  const value = attribute.value;
  if (attribute.name === "ref" && value && typeof value !== "string" && value.kind === "IdentifierExpression") {
    return `${value.name} = ${element}; __velarAppendOwned(${scope}.cleanups, () => { if (${value.name} === ${element}) ${value.name} = null; });`;
  }
  if (attribute.name.startsWith("on:") && value && typeof value !== "string") {
    const [event, ...modifiers] = attribute.name.slice(3).split(".");
    return `__velarOn(${element}, ${JSON.stringify(event)}, () => (${host.emitMappedExpression(value)}), ${scope}, ${JSON.stringify(modifiers)});`;
  }
  if (attribute.name === "bind:value" && value && typeof value !== "string") {
    const numeric = expression.tag === "input" && expression.attributes.some((item) => item.name === "type" && item.value === "number");
    const enumName = host.hints.enumValueBindings.get(attribute.span.start);
    return `__velarBindValue(${element}, ${emitBindTarget(host, value)}, ${scope}, ${numeric}${enumName ? `, ${enumName}.parse` : ""});`;
  }
  if (attribute.name === "bind:checked" && value && typeof value !== "string") {
    return `__velarBindChecked(${element}, ${emitBindTarget(host, value)}, ${scope});`;
  }
  if (attribute.name === "bind:group" && value && typeof value !== "string") {
    const multiple = expression.attributes.some((item) => item.name === "type" && item.value === "checkbox");
    const enumName = host.hints.enumValueBindings.get(attribute.span.start);
    return `__velarBindGroup(${element}, ${emitBindTarget(host, value)}, ${scope}, ${multiple}${enumName ? `, ${enumName}.parse` : ""});`;
  }
  if (attribute.name.startsWith("class:") && value && typeof value !== "string") {
    return `__velarClass(${element}, ${JSON.stringify(attribute.name.slice(6))}, () => ${host.emitMappedExpression(value)}, ${scope});`;
  }
  if (attribute.name === "host") return `${element}.__velarHost = true;`;
  if (attribute.name === "class" && value && typeof value !== "string") {
    return `__velarClassBind(${element}, () => ${host.emitMappedExpression(value)}, ${scope});`;
  }
  if (attribute.name === "unsafe:html") {
    const html = typeof value === "string" ? JSON.stringify(value) : value === null ? '""' : host.emitMappedExpression(value);
    return `__velarHtml(${element}, () => ${html}, ${scope});`;
  }
  if (typeof value === "string" || value === null) {
    return `__velarStaticAttr(${element}, ${JSON.stringify(attribute.name)}, ${value === null ? "true" : JSON.stringify(value)});`;
  }
  return `__velarAttr(${element}, ${JSON.stringify(attribute.name)}, () => ${host.emitMappedExpression(value)}, ${scope});`;
}

/**
 * One child of a native element: static text, a nested element, or an
 * interpolation that owns a region of its own. Whitespace-only text answers
 * `null` — it appends nothing, and must not record a source-map span either.
 */
function emitNativeChild(
  host: JsxEmitHost,
  child: JSXElementExpression["children"][number],
  element: string,
  scope: string,
  childNamespace: string,
): string | null {
  if (child.kind === "JSXText") {
    const text = normalizeJsxText(child.value);
    return text ? host.emitMappedJavaScript(child.span, () => `__velarDomAppend(${element}, __velarDomCreateTextNode(${JSON.stringify(text)}));`) : null;
  }
  if (child.kind === "ExtensionExpression:web:jsx") {
    return host.emitMappedJavaScript(child.span, () => `__velarAppend(${element}, ${emitJsx(host, child, scope, true, childNamespace)});`);
  }
  return host.emitMappedJavaScript(child.expression.span, () => emitDynamicChild(host, element, child.expression, scope, childNamespace));
}

function emitJsxChildren(host: JsxEmitHost, children: JSXElementExpression["children"], scope: string, namespace: string): string {
  const fragmentSpan = children[0]?.span ?? { start: 0, end: 0 };
  const fragment: JSXElementExpression = { kind: "ExtensionExpression:web:jsx", tag: "", tagSpan: { start: fragmentSpan.start, end: fragmentSpan.start }, attributes: [], children, span: fragmentSpan };
  return emitJsx(host, fragment, scope, true, namespace);
}

// The slot body builds into whichever scope the consuming position hands it,
// so every observer, ref and cleanup it registers dies with that position
// rather than accumulating on the caller for the component's whole lifetime.
function emitJsxChildrenCode(host: JsxEmitHost, children: JSXElementExpression["children"], namespace: string): string {
  const previousScope = host.currentScope;
  host.currentScope = "__velarChildrenScope";
  try {
    return emitJsxChildren(host, children, "__velarChildrenScope", namespace);
  } finally {
    host.currentScope = previousScope;
  }
}

function emitDynamicChild(host: JsxEmitHost, parent: string, expression: Expression, scope: string, namespace: string): string {
  const leaves = dynamicChildLeaves(expression);
  const previousScope = host.currentScope;
  const previousJsxNamespace = host.currentJsxNamespace;
  host.currentScope = "__velarChildScope";
  host.currentJsxNamespace = namespace;
  // A conditional splits into one region per branch leaf only when a keyed
  // list is somewhere among them; each region gates itself on the shared
  // branch conditions, so at most one region renders content at a time and
  // the keyed list keeps identity-preserving children across the branch flip.
  // Without a keyed leaf the interpolation stays one dynamic region -- unless
  // its checked type can only ever be one text node, which is the whole tree
  // of a conversation surface and is answered by one text node instead (F1).
  const keyed = leaves.some((leaf) => leaf.list?.key);
  const scalarText = !keyed && isScalarTextChild(host, expression);
  // A scalar region owns no child scope, so nothing inside it may address
  // one; the guard above proves nothing does.
  if (scalarText) host.currentScope = scope;
  const statements = keyed
    ? leaves.map((leaf) => emitDynamicChildLeaf(host, parent, leaf, scope, namespace))
    : scalarText
      ? [`__velarText(${parent}, () => ${host.emitMappedExpression(expression)}, ${scope});`]
      : [`__velarDynamic(${parent}, (__velarChildScope) => ${host.emitMappedExpression(expression)}, ${scope});`];
  host.currentScope = previousScope;
  host.currentJsxNamespace = previousJsxNamespace;
  return statements.join(" ");
}

/**
 * The two conditions for the scalar-text fast path, both of which must hold:
 * the analyzer proved the checked type renders as exactly one text node, and
 * the expression builds no JSX of its own. Everything else keeps the full
 * dynamic region, so a widening of the type rule can only ever be a
 * deliberate edit to `VelarWebAnalyzer.isScalarTextType`.
 */
function isScalarTextChild(host: JsxEmitHost, expression: Expression): boolean {
  return host.hints.extensionCalls.get(spanIdentity(expression.span)) === JSX_SCALAR_TEXT_HINT
    && !containsJsxExpression(expression);
}

function emitDynamicChildLeaf(host: JsxEmitHost, parent: string, leaf: DynamicChildLeaf, scope: string, namespace: string): string {
  const list = leaf.list;
  if (list?.key) {
    const source = emitGuardedExpression(host, leaf.guards, host.emitMappedExpression(list.source), "[]");
    const parameter = list.arrow.parameters[0]!.name;
    const key = emitJsxAttributeValue(host, list.key);
    const render = emitJsx(host, list.arrow.body, "__velarChildScope", true, namespace);
    return `__velarKeyed(${parent}, () => ${source}, (${parameter}) => ${key}, (${parameter}, __velarChildScope) => ${render}, ${scope});`;
  }
  const value = emitGuardedExpression(host, leaf.guards, host.emitMappedExpression(leaf.expression), "null");
  return `__velarDynamic(${parent}, (__velarChildScope) => ${value}, ${scope});`;
}

// Wraps a leaf's expression in its branch conditions, innermost last, so the
// leaf evaluates only while its branch is active and yields the inactive
// placeholder ('[]' for keyed reads, 'null' for dynamic regions) otherwise.
function emitGuardedExpression(host: JsxEmitHost, guards: readonly DynamicChildGuard[], inner: string, inactive: string): string {
  let output = inner;
  for (let index = guards.length - 1; index >= 0; index -= 1) {
    const guard = guards[index]!;
    const condition = host.emitMappedExpression(guard.condition);
    output = guard.thenBranch
      ? `(${condition}) ? (${output}) : ${inactive}`
      : `(${condition}) ? ${inactive} : (${output})`;
  }
  return output;
}

/**
 * D47 rule 84(A): a bind target is a state cell, or a writable reactive
 * location inside one. A member/index path lowers to the get/set pair the
 * binding helpers already expect, so a field of state reads and writes through
 * exactly the same statements the author would have written by hand.
 */
function emitBindTarget(host: JsxEmitHost, value: Expression): string {
  if (value.kind === "IdentifierExpression") return value.name;
  const next: Expression = { kind: "IdentifierExpression", name: "__velarBindNext", span: value.span };
  const read = host.emitMappedExpression(value);
  const assignment = { kind: "AssignmentStatement", target: value, value: next, operator: "=", span: value.span } as unknown as Statement;
  const write = host.emitStatement(assignment, 0).trim();
  return `{ get: () => (${read}), set: (__velarBindNext) => { ${write} } }`;
}

function emitJsxAttributeValue(host: JsxEmitHost, attribute: JSXAttribute): string {
  if (attribute.value === null) return "true";
  if (typeof attribute.value === "string") return JSON.stringify(attribute.value);
  return host.emitMappedExpression(attribute.value);
}

function emitJsxLookValue(host: JsxEmitHost, expression: JSXElementExpression): string | null {
  const base = expression.attributes.find((attribute) => attribute.name === "look");
  const inline = expression.attributes.filter((attribute) => attribute.name.startsWith("look:"));
  const baseValue = base?.value && typeof base.value !== "string" ? host.emitMappedExpression(base.value) : null;
  if (inline.length === 0) return baseValue;
  const rules = inline.map((attribute) => {
    const property = cssPropertyName(attribute.name.slice("look:".length));
    const token = lookToken([], "", property);
    const value = attribute.value === null ? "null"
      : typeof attribute.value === "string" ? JSON.stringify(attribute.value)
        : host.emitMappedExpression(attribute.value);
    return `${JSON.stringify(token)}: ${value}`;
  });
  const anonymous = `{ rules: { ${rules.join(", ")} } }`;
  return `__velarLook([${[baseValue, anonymous].filter(Boolean).join(", ")}])`;
}

function emitJsxStyleValue(host: JsxEmitHost, expression: JSXElementExpression): string | null {
  const inline = expression.attributes.filter((attribute) => attribute.name.startsWith("style:"));
  if (inline.length === 0) return null;
  const properties = inline.map((attribute) => {
    const property = cssPropertyName(attribute.name.slice("style:".length));
    const value = attribute.value === null ? "null"
      : typeof attribute.value === "string" ? JSON.stringify(attribute.value)
        : host.emitMappedExpression(attribute.value);
    return `${JSON.stringify(property)}: ${value}`;
  });
  return `{ ${properties.join(", ")} }`;
}

function normalizeJsxText(value: string): string {
  const normalized = value.replace(/\s+/gu, " ");
  if (!value.includes("\n")) return normalized;
  return (/^\s*\n/u.test(value) ? normalized.trimStart() : normalized).replace(/\n\s*$/u.test(value) ? /\s+$/u : /$^/u, "");
}

function hasMeaningfulChildren(children: JSXElementExpression["children"]): boolean {
  return children.some((child) => child.kind !== "JSXText" || child.value.trim().length > 0);
}

export interface JsxKeyedList {
  readonly source: Expression;
  readonly arrow: Extract<Expression, { kind: "ArrowFunctionExpression" }> & { readonly body: JSXElementExpression };
  readonly key: JSXAttribute | null;
}

export interface DynamicChildGuard {
  readonly condition: Expression;
  readonly thenBranch: boolean;
}

export interface DynamicChildLeaf {
  readonly expression: Expression;
  readonly list: JsxKeyedList | null;
  readonly guards: readonly DynamicChildGuard[];
}

// The keyed-children fast path is syntactic: an interpolation leaf must be
// exactly `source.map(single-parameter arrow returning JSX)`, keyed when the
// arrow's root element carries a `key` attribute. The analyzer mirrors this
// recognizer through dynamicChildLeaves, so anything the emitter demotes to a
// rebuild-all dynamic region is diagnosed rather than silently forfeited.
export function jsxKeyedList(expression: Expression): JsxKeyedList | null {
  if (expression.kind !== "CallExpression" || expression.callee.kind !== "MemberExpression" || expression.callee.property !== "map") return null;
  const callback = expression.arguments[0];
  if (!callback || callback.kind !== "ArrowFunctionExpression" || callback.asynchronous || callback.parameters.length !== 1 || callback.body.kind !== "ExtensionExpression:web:jsx") return null;
  const arrow = callback as typeof callback & { readonly body: JSXElementExpression };
  const key = arrow.body.attributes.find((attribute) => attribute.name === "key") ?? null;
  return { source: expression.callee.object, arrow, key };
}

/**
 * F1: the analyzer's verdict that an interpolation's checked type renders as
 * exactly one text node. The emitter cannot re-derive it — the checked type is
 * gone by lowering time — so the analyzer stamps the child expression's span
 * and the emitter reads it back through the extension-hint channel that
 * `LOOK_ARITHMETIC_HINT` already uses.
 */
export const JSX_SCALAR_TEXT_HINT = "@velarscript/web:jsx-scalar-text";

/**
 * The one thing a scalar interpolation must not contain. `__velarText` owns no
 * child scope, so a nested element inside the expression — legal where a
 * function takes a `WebNode` and answers text — would have nothing to register
 * its observers and cleanups against. The type says one text node; this says
 * nothing was built to make it.
 */
function containsJsxExpression(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "ExtensionExpression:web:jsx") return true;
  return Object.values(record).some((child) => Array.isArray(child) ? child.some(containsJsxExpression) : containsJsxExpression(child));
}

// Flattens an interpolation into render leaves. A conditional contributes its
// branch leaves, each remembering the chain of branch conditions that keeps it
// active, so an empty-state ternary around a keyed list still reaches the
// keyed fast path instead of demoting every child to rebuild-all updates.
export function dynamicChildLeaves(expression: Expression, guards: readonly DynamicChildGuard[] = []): readonly DynamicChildLeaf[] {
  const list = jsxKeyedList(expression);
  if (list) return [{ expression, list, guards }];
  if (expression.kind === "ConditionalExpression") {
    return [
      ...dynamicChildLeaves(expression.thenValue, [...guards, { condition: expression.condition, thenBranch: true }]),
      ...dynamicChildLeaves(expression.elseValue, [...guards, { condition: expression.condition, thenBranch: false }]),
    ];
  }
  return [{ expression, list: null, guards }];
}
