/**
 * The contracts a component declares and the ones it inherits: whether a prop's
 * type carries a readonly view, whether a `exposes` Handle is a concrete record,
 * how a component type read out of an annotation is normalized, and the one
 * `host` element a multi-root render has to mark.
 *
 * D115 P4 R3c. `normalizeComponentContracts` takes no host at all: it is a
 * structural rewrite of a type, and it runs from the `resolveAnnotation` seam,
 * which the base analyzer may reach before the host object exists.
 */
import { type Span } from "@velarscript/compiler";
import { describeType, isReadonlyView, optionalOf, type ValueType } from "@velarscript/compiler/extension";
import { type WebComponentDeclaration as ComponentDeclaration, type WebJsxAttribute as JSXAttribute, type WebJsxElementExpression as JSXElementExpression } from "../../ast.ts";
import { isWebComponentType, normalizeWebComponentType } from "../../types.ts";
import { diagnostic } from "../web-types.ts";
import { type ComponentAnalysisHost } from "./host.ts";

export function containsReadonlyView(host: ComponentAnalysisHost, type: ValueType): boolean {
  const resolved = host.expandAliases(type);
  if (resolved.kind === "optional") return containsReadonlyView(host, resolved.inner);
  if (resolved.kind === "union") return resolved.members.some((member) => containsReadonlyView(host, member));
  return isReadonlyView(resolved);
}

export function validateComponentHandleType(host: ComponentAnalysisHost, type: ValueType, sourceSpan: Span): void {
  const expanded = host.expandAliases(type);
  const fields = expanded.kind === "object"
    ? expanded.fields
    : expanded.kind === "named" ? host.fieldsOf(expanded.identity ?? expanded.name) : null;
  if (!fields) host.diagnostics.push(diagnostic("VEL5056", `A component Handle must be a concrete record type, received ${describeType(type)}`, sourceSpan));
}

export function normalizeComponentContracts(type: ValueType): ValueType {
  if (type.kind === "optional") return optionalOf(normalizeComponentContracts(type.inner));
  if (type.kind === "list" || type.kind === "set") return { ...type, element: normalizeComponentContracts(type.element) };
  if (type.kind === "map") return { ...type, key: normalizeComponentContracts(type.key), value: normalizeComponentContracts(type.value) };
  if (type.kind === "record") return { ...type, value: normalizeComponentContracts(type.value) };
  if (type.kind === "promise" || type.kind === "runtimeType") return { ...type, value: normalizeComponentContracts(type.value) };
  if (type.kind === "object") return { ...type, fields: new Map([...type.fields].map(([name, value]) => [name, normalizeComponentContracts(value)])) };
  if (type.kind === "function" || type.kind === "action" || type.kind === "intrinsic") return {
    ...type,
    parameters: type.parameters.map((parameter) => normalizeComponentContracts(parameter)),
    ...(type.rest ? { rest: normalizeComponentContracts(type.rest) } : {}),
    result: normalizeComponentContracts(type.result),
  };
  if (type.kind === "union") return { kind: "union", members: type.members.map((member) => normalizeComponentContracts(member)) };
  if (!isWebComponentType(type)) return type;
  return normalizeWebComponentType(
    type,
    (value) => normalizeComponentContracts(value),
    (value) => normalizeComponentContracts(value),
  );
}

export function validateComponentHost(host: ComponentAnalysisHost, render: JSXElementExpression, component: ComponentDeclaration): void {
  const hosts: JSXAttribute[] = [];
  const visit = (element: JSXElementExpression): void => {
    if (!/^[A-Z]/u.test(element.tag)) {
      for (const attribute of element.attributes) if (attribute.name === "host") hosts.push(attribute);
    }
    for (const child of element.children) if (child.kind === "ExtensionExpression:web:jsx") visit(child);
  };
  visit(render);
  if (hosts.length > 1) host.diagnostics.push(diagnostic("VEL5043", `Component '${component.name}' declares more than one host element`, hosts[1]!.span));
  for (const marker of hosts) if (marker.value !== null) host.diagnostics.push(diagnostic("VEL5043", "The host directive is a valueless marker", marker.span));
  const directNativeRoot = render.tag !== "" && !/^[A-Z]/u.test(render.tag);
  const delegatedComponentRoot = /^[A-Z]/u.test(render.tag);
  if (!directNativeRoot && !delegatedComponentRoot && hosts.length === 0) {
    host.diagnostics.push(diagnostic("VEL5043", `Component '${component.name}' has multiple roots and must mark exactly one native element with 'host'`, render.span));
  }
}
