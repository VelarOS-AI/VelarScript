/**
 * What a function body holds, read from its statements: the first reactive
 * declaration a 'def' answering WebNode may not carry, whether the body returns
 * JSX, and the markup roots it returns.
 *
 * D115 P4 R3a: these are readings of an AST subtree, not of the analyzer, so
 * they read as a module.
 */
import { type Span } from "@velarscript/compiler";
import { type Expression, type Statement, type ValueType } from "@velarscript/compiler/extension";
import { type WebJsxElementExpression as JSXElementExpression } from "../ast.ts";
import { isWebNodeType } from "../types.ts";

/**
 * The reactive declarations a `def` body may not hold when the `def` answers
 * `WebNode`. `watch`, `resource` and `action` are already refused outside a
 * module or component scope (VEL3010/VEL3012/VEL3013); they stay listed because
 * the defect is the declaration, not which of them the author reached for.
 */
const WEB_REACTIVE_DECLARATION_LABELS: ReadonlyMap<string, string> = new Map([
  ["ExtensionStatement:web:state", "'state'"],
  ["ExtensionStatement:web:computed", "'computed'"],
  ["ExtensionStatement:web:resource", "'resource'"],
  ["ExtensionStatement:web:watch", "'watch'"],
  ["ExtensionStatement:web:mounted", "'@mounted'"],
  ["ExtensionStatement:web:cleanup", "'@cleanup'"],
]);

/**
 * The first reactive declaration a body holds, in source order. A nested `def`
 * or `component` owns its own declarations, so the walk stops at one.
 */
export function firstReactiveDeclaration(body: readonly Statement[]): { readonly label: string; readonly span: Span } | null {
  let found: { readonly label: string; readonly span: Span } | null = null;
  const pending: unknown[] = [...body];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const entry of value) pending.push(entry);
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    const kind = typeof node.kind === "string" ? node.kind : null;
    if (kind === "FunctionDeclaration" || kind === "ExtensionStatement:web:component") continue;
    const label = kind === null ? undefined : WEB_REACTIVE_DECLARATION_LABELS.get(kind);
    if (label !== undefined) {
      const span = node.span as Span;
      if (found === null || span.start < found.span.start) found = { label, span };
      continue;
    }
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return found;
}

/**
 * Whether a type answers markup. `WebNode` is the value, and `WebNode?` and
 * `List<WebNode>` are the two shapes markup legitimately travels in — a helper
 * that answers "this row, or nothing" and one that answers a row per item.
 * Reading only the bare annotation closed the spelling instead of the sink:
 * the identical body under `-> WebNode?` reached the same defect unreported.
 */
export function carriesWebNode(type: ValueType): boolean {
  if (isWebNodeType(type)) return true;
  if (type.kind === "optional") return carriesWebNode(type.inner);
  if (type.kind === "list") return carriesWebNode(type.element);
  return false;
}

/**
 * Whether a body's own `return`s carry JSX. A return type is optional on a
 * `def`, and an omitted one left the same defective helper unreported, so the
 * markup the body returns answers for the annotation that was never written.
 * A nested `def` or `component` owns its own returns, exactly as it owns its
 * own declarations.
 */
export function bodyReturnsJsx(body: readonly Statement[]): boolean {
  const pending: unknown[] = [...body];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const entry of value) pending.push(entry);
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    const kind = typeof node.kind === "string" ? node.kind : null;
    if (kind === "FunctionDeclaration" || kind === "ExtensionStatement:web:component") continue;
    if (kind === "ReturnStatement") {
      if (subtreeHoldsJsx(node.value)) return true;
      continue;
    }
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return false;
}

/**
 * A returned expression that builds markup anywhere inside it — bare, inside a
 * List, behind a condition, or built by the callback of a `.map(...)` that
 * answers a row per item. The arrow is walked rather than skipped for the same
 * reason the optional and List annotations are unwrapped: `rows()` returning
 * `items.map(item => <li>…</li>)` is a markup helper by every measure except
 * the one spelling that was being read.
 */
function subtreeHoldsJsx(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (Array.isArray(entry)) {
      for (const item of entry) pending.push(item);
      continue;
    }
    if (entry === null || typeof entry !== "object") continue;
    const node = entry as Record<string, unknown>;
    if (node.kind === "ExtensionExpression:web:jsx") return true;
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return false;
}

/**
 * VEL5075: the JSX elements a body's own `return`s *start* with — the roots of
 * the returned markup, which is where the emitter decides between an instance
 * and a child. The walk descends through ordinary expression nodes, `.map(...)`
 * callbacks included, and stops at the first JSX element on every path: inside
 * one, every JSX position is a child position and needs no verdict. A nested
 * `def` or `component` owns its own returns, exactly as it does elsewhere here.
 */
export function returnedMarkupRoots(body: readonly Statement[]): readonly JSXElementExpression[] {
  const roots: JSXElementExpression[] = [];
  const collect = (value: unknown): void => {
    const pending: unknown[] = [value];
    while (pending.length > 0) {
      const entry = pending.pop();
      if (Array.isArray(entry)) {
        for (const item of entry) pending.push(item);
        continue;
      }
      if (entry === null || typeof entry !== "object") continue;
      const node = entry as Record<string, unknown>;
      if (node.kind === "ExtensionExpression:web:jsx") {
        roots.push(node as unknown as JSXElementExpression);
        continue;
      }
      for (const key of Object.keys(node)) pending.push(node[key]);
    }
  };
  const pending: unknown[] = [...body];
  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const entry of value) pending.push(entry);
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const node = value as Record<string, unknown>;
    const kind = typeof node.kind === "string" ? node.kind : null;
    if (kind === "FunctionDeclaration" || kind === "ExtensionStatement:web:component") continue;
    if (kind === "ReturnStatement") {
      collect(node.value);
      continue;
    }
    for (const key of Object.keys(node)) pending.push(node[key]);
  }
  return roots;
}

/** The component spelling of a helper's name: components render as a PascalCase tag. */
export function componentSpelling(name: string): string {
  return name.length === 0 ? name : `${name[0]!.toUpperCase()}${name.slice(1)}`;
}

/** `{ id: item.id }` in a callback over `item`: the field carries its own value over unchanged. */
export function rowFieldPassthrough(value: Expression, row: string, name: string): boolean {
  return value.kind === "MemberExpression" && value.property === name
    && value.object.kind === "IdentifierExpression" && value.object.name === row;
}
