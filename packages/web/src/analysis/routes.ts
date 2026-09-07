/**
 * What a route accepts: the component a 'route(path, Component)' may name, the
 * path spellings a router can match, and the two accessibility readings a route
 * component's markup is asked for.
 *
 * D115 P4 R3a: 'web.route' asks these of an intrinsic context and the analyzer
 * asks them of a record of routes, so they read as a module both can call.
 *
 * D115 P4 R3c: the analyzer's own two — the `<Router routes={...}>` list and the
 * component slot inside it — join them here, so the two callers differ only in
 * the environment they arrive with.
 */
import { type Diagnostic, type Span } from "@velarscript/compiler";
import {
  describeType,
  isInvalidType,
  type CompilerIntrinsicAnalysisContext,
  type Expression,
  type ValueType,
} from "@velarscript/compiler/extension";
import { type WebJsxElementExpression as JSXElementExpression } from "../ast.ts";
import { isWebComponentType } from "../types.ts";
import { routeContextIdentity } from "./web-types.ts";

/**
 * What the analyzer's two route readings ask of the analyzer that hosts them.
 * The intrinsic twins take a `CompilerIntrinsicAnalysisContext` instead: they
 * are called from inside an intrinsic, where that context is what the caller
 * already holds.
 */
export interface WebRouteHost {
  readonly diagnostics: Diagnostic[];
  inferExpression(expression: Expression, contextualType?: ValueType): ValueType;
  /**
   * Assignability judged against the analyzer as the type environment. Asking
   * for the answer rather than for the environment keeps `TypeEnvironment` out
   * of this face.
   */
  isAssignableHere(actual: ValueType, expected: ValueType): boolean;
  typeError(message: string, errorSpan: Span): void;
}

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

/**
 * The elements of a `<Router routes={...}>` list literal, one at a time.
 *
 * A route written as `route("/a", Panel)` is checked at that call; the record
 * that call returns — `{path: "/a", component: Panel}` — is a legal spelling
 * of the same value, reaches the same runtime position, and until now was
 * checked by nothing: `{path: "no-leading-slash", component: 5}` compiled
 * clean and handed `5` to the Router as a component. Closing the sink rather
 * than the spelling means asking the same questions wherever a route arrives,
 * so this reports exactly what `route(...)` reports, word for word.
 *
 * The runtime is already the second referee (D90 R19): `routerTable`
 * validates every path and refuses a component that is not callable. Nothing
 * here changes which programs run — it moves a refusal the author would have
 * met at mount to the place the source shows the mistake.
 *
 * The `any` component slot is skipped here rather than inside
 * `checkWebRouteComponent`, which is why that function carries no `any` arm:
 * this loop and the Router `fallback` attribute are its only two callers, and
 * both filter first. An `any` reaches this slot for real — `web.lazy` answers
 * `anyType` from each of its error paths — and it arrives with the author's
 * real message already reported, so a second "received any" would be a
 * cascade. The `route(...)` twin skips it for the same reason.
 */
export function checkWebRouteRecords(host: WebRouteHost, expression: Expression): void {
  if (expression.kind !== "ListExpression") return;
  for (const element of expression.elements) {
    if (element.kind !== "ObjectExpression") continue;
    for (const entry of element.properties) {
      if (entry.kind !== "ObjectProperty") continue;
      if (entry.name === "path") {
        const path = entry.value;
        if (path.kind === "LiteralExpression" && typeof path.value === "string") {
          checkRoutePath(path.value, path.span, (message, span) => host.typeError(message, span));
        }
        continue;
      }
      if (entry.name !== "component") continue;
      // The attribute has already been inferred as a whole, so every
      // sub-expression here has been reported once. This second pass exists
      // only to read the component slot's type back; anything it says is a
      // repeat of what the author already has, and is dropped. Advisories
      // need no such cursor — `advise` is deduplicated by code and span
      // precisely so a re-analysis cannot raise one twice.
      const reported = host.diagnostics.length;
      const type = host.inferExpression(entry.value);
      host.diagnostics.splice(reported);
      if (type.kind === "any") continue;
      checkWebRouteComponent(host, type, entry.value.span, "A route");
    }
  }
}

export function checkWebRouteComponent(host: WebRouteHost, type: ValueType, sourceSpan: Span, subject: string): void {
  if (isInvalidType(type)) return;
  if (!isWebComponentType(type)) {
    // No `any` arm, unlike the `route(...)` twin above: both callers — the
    // Router `fallback` attribute and `checkWebRouteRecords` — already filter
    // `any` out before they call here, so a branch for it could never run.
    host.typeError(`${subject} requires a component, received ${describeType(type)}`, sourceSpan);
    return;
  }
  const unsupported = [...type.requiredProperties].filter((name) => name !== "route");
  if (unsupported.length > 0) host.typeError(`${subject} component cannot require props other than route: ${unsupported.join(", ")}`, sourceSpan);
  const routeProp = type.properties.get("route");
  if (routeProp && !host.isAssignableHere({ kind: "named", name: "RouteContext", identity: routeContextIdentity }, routeProp)) host.typeError(`${subject} component's route prop must accept RouteContext, received ${describeType(routeProp)}`, sourceSpan);
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
