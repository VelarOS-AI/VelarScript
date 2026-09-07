/**
 * What a type may stand for in a JSX position: the six questions asked of a
 * `ValueType` and of nothing else — whether it is a Look, a class list, a
 * renderable child, exactly one text node, an attribute value, or an optional
 * string.
 *
 * D115 P4 R3c. These are pure readings of a type, so the only thing they ask of
 * the analyzer is alias expansion, which arrives as a one-member host rather
 * than as a whole face. The two that answer over the written type — `isLookInput`
 * and `isClassInput` — read no aliases at all and take no host.
 */
import { type ValueType } from "@velarscript/compiler/extension";
import { isWebNodeType } from "../types.ts";
import { textualWebPrimitiveNames } from "./web-types.ts";

/** The whole of what the four alias-reading predicates ask of the analyzer. */
export interface RenderableHost {
  expandAliases(type: ValueType): ValueType;
}

export function isLookInput(type: ValueType): boolean {
  if (type.kind === "any" || type.kind === "null") return true;
  if (type.kind === "named") return type.name === "Look";
  if (type.kind === "optional") return isLookInput(type.inner);
  if (type.kind === "list") return isLookInput(type.element);
  if (type.kind === "union") return type.members.every((member) => isLookInput(member));
  return false;
}

export function isClassInput(type: ValueType): boolean {
  if (type.kind === "any" || type.kind === "null" || type.kind === "string") return true;
  if (type.kind === "optional") return isClassInput(type.inner);
  if (type.kind === "list") return isClassInput(type.element);
  if (type.kind === "union") return type.members.every((member) => isClassInput(member));
  return false;
}

export function isJsxRenderable(host: RenderableHost, type: ValueType): boolean {
  const expanded = host.expandAliases(type);
  if (expanded.kind === "any" || expanded.kind === "null" || expanded.kind === "string" || expanded.kind === "number"
    || expanded.kind === "bool" || expanded.kind === "enum" || expanded.kind === "enumMember" || isWebNodeType(expanded)) return true;
  if (expanded.kind === "named") return textualWebPrimitiveNames.has(expanded.name);
  if (expanded.kind === "optional") return isJsxRenderable(host, expanded.inner);
  if (expanded.kind === "list") return isJsxRenderable(host, expanded.element);
  if (expanded.kind === "union") return expanded.members.every((member) => isJsxRenderable(host, member));
  return false;
}

/**
 * F1's qualifying rule, and the whole of it: the types whose rendering is
 * *exactly* one text node.
 *
 * `string` and `number` are the two. `__velarAppend` answers a string with one
 * text node carrying it — the empty string included, which is why `""` is not
 * a special case — and a number with one text node carrying `String(value)`,
 * or refuses a non-finite number. An enum member is text at runtime and is
 * assignable to `string`, so it rides the same branch it always did.
 *
 * Everything else stays on the full dynamic region, and the reason is always
 * the same one: it does not render as *one* node.
 * - `bool` renders **zero** nodes (`__velarAppend` returns on `true`/`false`),
 *   so a text node would be an added child where an element previously had
 *   none — observable to `:empty`, to `childNodes`, and to anything that
 *   walks them.
 * - An optional of either renders zero nodes when null and one when present,
 *   so it needs an anchor to come back to.
 * - `WebNode`, lists, unions, `any` and every named type can hold markup or
 *   several nodes, which is what the comment pair exists to bracket.
 *
 * Widening this set is a semantic ruling, not an optimisation: it would
 * change the node count of a rendered document.
 */
export function isScalarTextType(host: RenderableHost, type: ValueType): boolean {
  const expanded = host.expandAliases(type);
  return expanded.kind === "string" || expanded.kind === "number";
}

export function isJsxAttributeValue(host: RenderableHost, type: ValueType): boolean {
  const expanded = host.expandAliases(type);
  if (expanded.kind === "any" || expanded.kind === "null" || expanded.kind === "string" || expanded.kind === "number"
    || expanded.kind === "bool" || expanded.kind === "enum" || expanded.kind === "enumMember") return true;
  if (expanded.kind === "named") return textualWebPrimitiveNames.has(expanded.name);
  if (expanded.kind === "optional") return isJsxAttributeValue(host, expanded.inner);
  if (expanded.kind === "union") return expanded.members.every((member) => isJsxAttributeValue(host, member));
  return false;
}

export function isOptionalString(host: RenderableHost, type: ValueType): boolean {
  const expanded = host.expandAliases(type);
  if (expanded.kind === "string" || expanded.kind === "null") return true;
  if (expanded.kind === "optional") return isOptionalString(host, expanded.inner);
  if (expanded.kind === "union") return expanded.members.every((member) => isOptionalString(host, member));
  return false;
}
