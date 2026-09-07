/**
 * What a route accepts: the component a 'route(path, Component)' may name, the
 * path spellings a router can match, and the two accessibility readings a route
 * component's markup is asked for.
 *
 * D115 P4 R3a: 'web.route' asks these of an intrinsic context and the analyzer
 * asks them of a record of routes, so they read as a module both can call.
 */
import { type Span } from "@velarscript/compiler";
import {
  describeType,
  isInvalidType,
  type CompilerIntrinsicAnalysisContext,
  type ValueType,
} from "@velarscript/compiler/extension";
import { type WebJsxElementExpression as JSXElementExpression } from "../ast.ts";
import { isWebComponentType } from "../types.ts";
import { routeContextIdentity } from "./web-types.ts";

export function checkRouteComponent(type: ValueType, sourceSpan: Span, subject: string, context: CompilerIntrinsicAnalysisContext): void {
  if (isInvalidType(type)) return;
  if (!isWebComponentType(type)) {
    if (type.kind !== "any") context.typeError(`${subject} requires a component, received ${describeType(type)}`, sourceSpan);
    return;
  }
  const unsupported = [...type.requiredProperties].filter((name) => name !== "route");
  if (unsupported.length > 0) context.typeError(`${subject} component cannot require props other than route: ${unsupported.join(", ")}`, sourceSpan);
  const routeProp = type.properties.get("route");
  if (routeProp && !context.isAssignable({ kind: "named", name: "RouteContext", identity: routeContextIdentity }, routeProp)) context.typeError(`${subject} component's route prop must accept RouteContext, received ${describeType(routeProp)}`, sourceSpan);
}

export function checkRoutePath(path: string, sourceSpan: Span, report: (message: string, span: Span) => void): void {
  if (!path.startsWith("/")) report("A route path must start with '/'", sourceSpan);
  if (path.includes("?") || path.includes("#")) report("A route path describes only a pathname; read query and hash from RouteContext", sourceSpan);
  if (path.includes("\\")) report("A route path cannot contain a backslash", sourceSpan);
  if (path.length > 1 && path.endsWith("/")) report("A route path cannot end with '/'; matching already accepts one trailing slash", sourceSpan);
  const segments = path.split("/").slice(1);
  const parameters = new Set<string>();
  for (const [index, segment] of segments.entries()) {
    if (segment.length === 0 && path !== "/") report("A route path cannot contain an empty segment", sourceSpan);
    if (segment === "*") {
      if (index !== segments.length - 1) report("A route wildcard must be the final segment", sourceSpan);
      if (parameters.has("wildcard")) report("A route parameter named 'wildcard' conflicts with the '*' capture", sourceSpan);
      parameters.add("wildcard");
      continue;
    }
    if (segment.includes("*")) report("A route wildcard must occupy its whole final segment", sourceSpan);
    if (!segment.startsWith(":")) continue;
    const name = segment.slice(1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) report("A route parameter requires a valid name", sourceSpan);
    else if (parameters.has(name)) report(`Route parameter '${name}' is repeated`, sourceSpan);
    parameters.add(name);
  }
}

export function containsPromise(type: ValueType): boolean {
  if (type.kind === "promise") return true;
  if (type.kind === "optional") return containsPromise(type.inner);
  if (type.kind === "list" || type.kind === "set") return containsPromise(type.element);
  if (type.kind === "map") return containsPromise(type.key) || containsPromise(type.value);
  if (type.kind === "record") return containsPromise(type.value);
  if (type.kind === "union") return type.members.some(containsPromise);
  return false;
}


export function hasAccessibleJsxContent(expression: JSXElementExpression): boolean {
  return expression.children.some((child) => {
    if (child.kind === "JSXText") return child.value.trim().length > 0;
    if (child.kind === "JSXExpressionChild") return true;
    return hasAccessibleJsxContent(child) || child.tag.length > 0;
  });
}

export function hasAccessibleSvgName(expression: JSXElementExpression): boolean {
  const named = expression.attributes.some((attribute) => {
    if (attribute.name !== "aria-label" && attribute.name !== "aria-labelledby") return false;
    if (attribute.value === null) return false;
    return typeof attribute.value !== "string" || attribute.value.trim().length > 0;
  });
  if (named) return true;
  const hidden = expression.attributes.find((attribute) => attribute.name === "aria-hidden");
  if (hidden?.value === "true" || (hidden?.value && typeof hidden.value !== "string"
    && hidden.value.kind === "LiteralExpression" && hidden.value.value === true)) return true;
  return expression.children.some((child) => child.kind === "ExtensionExpression:web:jsx"
    && child.tag === "title" && hasAccessibleJsxContent(child));
}
