/**
 * WEB-C1 — JSX keys: which interpolations the keyed fast path actually reads,
 * and the keys written where it will never look.
 *
 * D115 P4 R3b. The recognizer is purely syntactic and mirrors the emitter's
 * (`dynamicChildLeaves`), so an interpolation's honored roots are known before
 * its expression is inferred and a nested element knows whether its own key is
 * honored.
 */
import { type Expression, spanIdentity } from "@velarscript/compiler/extension";
import { type WebJsxElementExpression as JSXElementExpression } from "../../ast.ts";
import { dynamicChildLeaves } from "../../emitter.ts";
import { diagnostic } from "../web-types.ts";
import { type JsxAnalysisHost } from "./host.ts";

// Mirrors the emitter's keyed-children recognizer (dynamicChildLeaves): a
// leaf shaped `source.map(item => <… key=… />)` — either the interpolation
// itself or a '?:' branch of it — compiles to the identity-preserving keyed
// path. A map leaf without a key must gain one (VEL5017), and a key that
// sits anywhere else in the interpolation would be silently ignored at
// runtime, so it is diagnosed instead of quietly rebuilding every child.
export function checkKeyedInterpolation(host: JsxAnalysisHost, expression: Expression): void {
  const honoredKeyRoots = new Set<JSXElementExpression>();
  for (const leaf of dynamicChildLeaves(expression)) {
    if (!leaf.list) continue;
    if (leaf.list.key) {
      honoredKeyRoots.add(leaf.list.arrow.body);
      // D89 A4: the list this keyed position renders by identity. A rewrite
      // of that same list is what changes every row's identity at once.
      const source = leaf.list.source.kind === "IdentifierExpression" ? host.lookup(leaf.list.source.name) : null;
      if (source) host.keyedListSources.add(spanIdentity(source.span));
    } else host.diagnostics.push(diagnostic("VEL5017", "A JSX list rendered with .map() requires a key on its root element", leaf.list.arrow.body.span));
  }
  for (const root of honoredKeyRoots) host.honoredJsxKeys.add(root);
  reportIneffectiveJsxKeys(host, expression, honoredKeyRoots);
}

// Walks one interpolation expression looking for `key` attributes that the
// keyed fast path will never read. The walk stops at every JSX element:
// an element's own children and attribute values are separate render sites
// that receive their own checks when analysis recurses into them.
export function reportIneffectiveJsxKeys(host: JsxAnalysisHost, value: unknown, honored: ReadonlySet<JSXElementExpression>): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.kind === "ExtensionExpression:web:jsx") {
    const element = record as unknown as JSXElementExpression;
    if (honored.has(element)) return;
    const key = element.attributes.find((attribute) => attribute.name === "key");
    if (key) {
      host.reportedJsxKeys.add(element);
      host.diagnostics.push(diagnostic(
        "VEL5050",
        "This JSX key has no effect: keys reuse children by identity only when the interpolation is 'items.map(item => <Row key={item.id} />)' or a '?:' branch of one; every other shape rebuilds its children on change — restructure the interpolation into that shape or remove the key",
        key.span,
      ));
    }
    return;
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) child.forEach((item) => reportIneffectiveJsxKeys(host, item, honored));
    else reportIneffectiveJsxKeys(host, child, honored);
  }
}
