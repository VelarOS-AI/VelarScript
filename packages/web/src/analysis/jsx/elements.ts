/**
 * The JSX element itself: the native tag roster and the per-element document
 * rules, the component element's props, and the `ref` a component exposes.
 *
 * D115 P4 R3b. `inferJsx` is the walk — it keeps the children loop, because the
 * recursion into a nested element is what that loop is, and the attribute,
 * key, and security rules it calls out to are the other files in this
 * directory.
 */
import { boolType, describeType, isInvalidType, nonOptional, spanIdentity, stringType, unknownType, type ValueType } from "@velarscript/compiler/extension";
import { type WebJsxAttribute as JSXAttribute, type WebJsxElementExpression as JSXElementExpression } from "../../ast.ts";
import { isWebCustomElementName, WEB_NATIVE_ELEMENTS } from "../../elements.ts";
import { JSX_SCALAR_TEXT_HINT } from "../../emitter.ts";
import { nearestLookName } from "../../look.ts";
import { isWebComponentConstructor, isWebComponentType, webComponentHandle, webComponentIntrinsic, type WebComponentType, webNodeType } from "../../types.ts";
import { componentRefHandleRefusal } from "../component-guidance.ts";
import { reportLookDirectiveOverlap } from "../look/entries.ts";
import { containsPromise, hasAccessibleJsxContent, hasAccessibleSvgName } from "../routes.ts";
import { diagnostic, removedJsxControlAttributes } from "../web-types.ts";
import { analyzeInlineVisualAttribute, analyzeJsxLookAttribute, analyzeNativeJsxAttribute } from "./attributes.ts";
import { type JsxAnalysisHost } from "./host.ts";
import { checkKeyedInterpolation } from "./keys.ts";
import { reportIframeSrcdocSandbox } from "./security.ts";

export function inferJsx(host: JsxAnalysisHost, expression: JSXElementExpression): ValueType {
  host.jsxDepth += 1;
  const attributes = new Map(expression.attributes.map((attribute) => [attribute.name, attribute]));
  const component = /^[A-Z]/u.test(expression.tag);
  if (expression.tag && !component && !WEB_NATIVE_ELEMENTS.has(expression.tag) && !isWebCustomElementName(expression.tag)) {
    const nearest = nearestLookName(expression.tag, WEB_NATIVE_ELEMENTS);
    host.diagnostics.push(diagnostic(
      "VEL5061",
      nearest
        ? `Unknown native element '<${expression.tag}>'; did you mean '<${nearest}>'?`
        : `Unknown native element '<${expression.tag}>'; use a standard HTML, SVG, or MathML element, or a lowercase hyphenated custom element such as '<user-card>'`,
      expression.tagSpan,
    ));
  }
  if (attributes.size !== expression.attributes.length) host.diagnostics.push(diagnostic("VEL5014", `JSX element '${expression.tag}' has duplicate attributes`, expression.span));
  reportLookDirectiveOverlap(host, expression);
  for (const attribute of expression.attributes) {
    if (removedJsxControlAttributes.has(attribute.name)) {
      host.diagnostics.push(diagnostic("VEL5029", `JSX '${attribute.name}' was removed; branch with an ordinary expression such as {condition ? <A /> : <B />}`, attribute.span));
    }
  }
  if (expression.tag && !component) {
    for (const attribute of expression.attributes) if (!removedJsxControlAttributes.has(attribute.name)) analyzeNativeJsxAttribute(host, expression, attribute);
    if (attributes.has("unsafe:html") && expression.children.length > 0) host.diagnostics.push(diagnostic("VEL5015", "unsafe:html cannot be combined with JSX children", expression.span));
    if (expression.tag === "img" && !attributes.has("alt")) host.diagnostics.push(diagnostic("VEL5016", "An img element requires an alt attribute", expression.span));
    if (expression.tag === "button" && !attributes.has("aria-label") && !attributes.has("aria-labelledby") && !hasAccessibleJsxContent(expression)) host.diagnostics.push(diagnostic("VEL5026", "A button requires text content, aria-label, or aria-labelledby", expression.span));
    if (expression.tag === "svg" && !hasAccessibleSvgName(expression)) host.diagnostics.push(diagnostic("VEL5030", "An svg element requires a non-empty title, aria-label, aria-labelledby, or aria-hidden='true'", expression.span));
    if (expression.tag === "a" && !attributes.has("href")) host.diagnostics.push(diagnostic("VEL5027", "A native anchor requires href; use a button for actions", expression.span));
    const target = attributes.get("target")?.value;
    const relation = attributes.get("rel")?.value;
    if (expression.tag === "a" && target === "_blank" && (typeof relation !== "string" || !relation.split(/\s+/u).includes("noopener"))) {
      host.diagnostics.push(diagnostic("VEL5028", "An anchor with target='_blank' requires rel='noopener'", expression.span));
    }
    if (expression.tag === "iframe" && attributes.has("srcdoc")) reportIframeSrcdocSandbox(host, expression, attributes);
  }
  if (component) analyzeComponentElement(host, expression);
  const key = expression.attributes.find((attribute) => attribute.name === "key");
  if (key) host.staticJsxKeys.push({ element: expression, attribute: key });
  for (const child of expression.children) {
    if (child.kind === "JSXExpressionChild") {
      // The keyed recognizer is purely syntactic, so the honored roots of this
      // interpolation are known before its expression is inferred; a nested
      // element then knows whether its own key is honored (WEB-C1).
      checkKeyedInterpolation(host, child.expression);
      const childType = host.inferExpression(child.expression);
      if (containsPromise(host.expandAliases(childType))) host.diagnostics.push(diagnostic("VEL5031", "JSX cannot render a Promise; await it before rendering", child.expression.span));
      else if (!isInvalidType(childType) && !(child.expression.kind === "ListExpression" && child.expression.elements.length === 0)
        && !host.isJsxRenderable(childType)) {
        host.diagnostics.push(diagnostic("VEL5047", `JSX can render only text, finite numbers, bool, enums, WebNode values, and Lists of those values; received ${describeType(childType)}`, child.expression.span));
      } else if (host.isScalarTextType(childType)) {
        // F1: the checked type is the only place this is knowable. A span
        // already claimed by another extension hint keeps it — the fast path
        // is an optimisation and yields, where a look's arithmetic lowering
        // would not.
        const identity = spanIdentity(child.expression.span);
        if (!host.extensionCalls.has(identity)) host.extensionCalls.set(identity, JSX_SCALAR_TEXT_HINT);
      }
    } else if (child.kind === "ExtensionExpression:web:jsx") {
      inferJsx(host, child);
    }
  }
  host.jsxDepth -= 1;
  return webNodeType;
}

export function analyzeComponentElement(host: JsxAnalysisHost, expression: JSXElementExpression): void {
  const component = host.inferExpression({ kind: "IdentifierExpression", name: expression.tag, span: expression.tagSpan });
  if (!isWebComponentType(component)) {
    host.diagnostics.push(diagnostic("VEL5011", `Unknown component '${expression.tag}'`, expression.span));
    return;
  }
  const provided = new Set(expression.attributes.filter((attribute) => attribute.name !== "key" && attribute.name !== "ref" && !removedJsxControlAttributes.has(attribute.name)).map((attribute) => attribute.name));
  const hasChildren = expression.children.some((child) => child.kind !== "JSXText" || child.value.trim().length > 0);
  if (hasChildren && provided.has("children")) host.diagnostics.push(diagnostic("VEL5014", `Component '${expression.tag}' receives children both as a prop and as JSX content`, expression.span));
  // D31 item 26: the message used to state the deficiency and stop. `children`
  // is an ordinary named prop, so the remedy is one declaration and the
  // diagnostic is the only place the charter's reader meets its spelling.
  else if (hasChildren && !component.properties.has("children")) host.diagnostics.push(diagnostic("VEL5018", `Component '${expression.tag}' does not declare JSX children; declare a 'children: WebNode' prop to accept them`, expression.span));
  else if (hasChildren) {
    provided.add("children");
    host.requireAssignable(webNodeType, component.properties.get("children")!, expression.span);
  }
  for (const required of component.requiredProperties) {
    if (provided.has(required)) continue;
    // D31-26 promised that `children: WebNode?` is the omittable form; the
    // implementation makes a prop omittable through its default value, so the
    // diagnostic teaches the spelling that actually omits (WEB-N4).
    const declared = component.properties.get(required);
    const optionalDeclaration = declared !== undefined && host.expandAliases(declared).kind === "optional";
    host.diagnostics.push(diagnostic("VEL5012", optionalDeclaration
      ? `Component '${expression.tag}' requires prop '${required}'; a prop becomes omittable through its default value — declare '${required}: ${describeType(declared)} = null' on the component`
      : `Component '${expression.tag}' requires prop '${required}'`, expression.span));
  }
  for (const attribute of expression.attributes) {
    if (removedJsxControlAttributes.has(attribute.name)) continue;
    if (attribute.name === "key") {
      const key = typeof attribute.value === "string" ? stringType : attribute.value ? host.inferExpression(attribute.value) : boolType;
      if (!isInvalidType(key) && key.kind !== "string" && key.kind !== "number" && key.kind !== "enum" && key.kind !== "enumMember" && key.kind !== "any") host.diagnostics.push(diagnostic("VEL5022", "A JSX key must be a string, string-backed enum, or number", attribute.span));
      continue;
    }
    if (attribute.name === "ref") {
      analyzeComponentRef(host, expression, attribute, component);
      continue;
    }
    const expected = component.properties.get(attribute.name);
    if (attribute.name === "look") {
      analyzeJsxLookAttribute(host, attribute);
      continue;
    }
    if (attribute.name.startsWith("look:")) {
      const actual = typeof attribute.value === "string" ? stringType : attribute.value ? host.inferExpression(attribute.value) : boolType;
      analyzeInlineVisualAttribute(host, attribute, actual, "look");
      continue;
    }
    if (attribute.name === "style") {
      if (attribute.value && typeof attribute.value !== "string") host.inferExpression(attribute.value);
      host.diagnostics.push(diagnostic("VEL5041", "Raw JSX style is not supported; use style:property for a checked high-priority inline override, or prefer Look for ordinary visuals", attribute.span));
      continue;
    }
    if (attribute.name.startsWith("style:")) {
      const actual = typeof attribute.value === "string" ? stringType : attribute.value ? host.inferExpression(attribute.value) : boolType;
      analyzeInlineVisualAttribute(host, attribute, actual, "style");
      continue;
    }
    if (attribute.name === "class") {
      const actual = typeof attribute.value === "string" ? stringType : attribute.value ? host.inferExpression(attribute.value) : boolType;
      if (!host.isClassInput(actual)) host.diagnostics.push(diagnostic("VEL5040", `JSX class requires string, string?, or a list of strings; received ${describeType(actual)}`, attribute.span));
      continue;
    }
    if (!expected) {
      host.diagnostics.push(diagnostic("VEL5013", `Component '${expression.tag}' has no prop '${attribute.name}'`, attribute.span));
      continue;
    }
    host.semanticJsxAttributeOwners.set(`${attribute.span.start}:${attribute.name}`, component);
    // D51 rule 108: a JSX attribute is a typed position, exactly like an
    // argument position, so the declared prop type is the literal's context.
    // Without it `items={[]}` inferred List<unknown> and forced the author to
    // annotate an empty list on a separate line.
    const actual = typeof attribute.value === "string" ? stringType : attribute.value ? host.inferExpression(attribute.value, expected) : boolType;
    if (isWebComponentConstructor(component) && webComponentIntrinsic(component) === "web.router" && attribute.name === "fallback" && actual.kind !== "null" && actual.kind !== "any") {
      host.checkWebRouteComponent(actual, attribute.span, "A Router fallback");
    }
    if (isWebComponentConstructor(component) && webComponentIntrinsic(component) === "web.router" && attribute.name === "routes"
      && attribute.value !== null && typeof attribute.value !== "string") {
      host.checkWebRouteRecords(attribute.value);
    }
    host.requireAssignable(actual, expected, attribute.span);
  }
}

export function analyzeComponentRef(
  host: JsxAnalysisHost,
  expression: JSXElementExpression,
  attribute: JSXAttribute,
  component: WebComponentType,
): void {
  const value = attribute.value;
  if (!value || typeof value === "string" || value.kind !== "IdentifierExpression"
    || !host.lookup(value.name)?.mutable || host.writableStateName(value.name)) {
    host.diagnostics.push(diagnostic("VEL5057", "A component ref requires a mutable let binding", attribute.span));
    return;
  }
  const handle = webComponentHandle(component);
  if (!handle) {
    const stored = nonOptional(host.expandAliases(host.lookup(value.name)?.declaredType ?? unknownType));
    host.diagnostics.push(diagnostic("VEL5057", componentRefHandleRefusal(expression.tag, component, stored), attribute.span));
    return;
  }
  const bindingType = host.lookup(value.name)!.type;
  if (bindingType.kind !== "any" && bindingType.kind !== "optional") {
    host.diagnostics.push(diagnostic("VEL5057", `A component ref requires ${describeType(handle)}? so cleanup can restore null`, attribute.span));
    return;
  }
  const target = nonOptional(bindingType);
  if (target.kind !== "any" && !host.isAssignableHere(handle, target)) {
    host.diagnostics.push(diagnostic("VEL5057", `Component '${expression.tag}' exposes ${describeType(handle)}, but this ref stores ${describeType(target)}?`, attribute.span));
  }
}
