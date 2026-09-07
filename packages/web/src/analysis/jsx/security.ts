/**
 * The two JSX attribute rules that are about the origin rather than the type:
 * `srcdoc`, which builds a whole document inside this page's origin (WEB-S3),
 * and the URL attributes whose written value can name a script scheme (WEB-S2).
 *
 * D115 P4 R3b. Both are asked of a written value only; a value that arrives at
 * run time is the runtime attribute check's question, so nothing here reads an
 * inferred type.
 */
import { type WebJsxAttribute as JSXAttribute, type WebJsxElementExpression as JSXElementExpression } from "../../ast.ts";
import { literalStringValues } from "../look-vocabulary-guidance.ts";
import { urlSchemeRefusal, WEB_URL_ATTRIBUTES } from "../url-attributes.ts";
import { diagnostic } from "../web-types.ts";
import { type JsxAnalysisHost } from "./host.ts";

/**
 * WEB-S3: `srcdoc` builds a whole document out of a string, and that document
 * inherits this page's origin — so it is a second raw-HTML boundary next to
 * the one the charter names (`unsafe:html`), reachable with no marker at all.
 * The marker this one gets is `sandbox`, because sandbox is what actually
 * takes the origin away; requiring it makes the boundary visible where it is
 * crossed. `allow-scripts allow-same-origin` together hands the origin back,
 * so the pair is refused by name rather than accepted as a sandbox.
 */
export function reportIframeSrcdocSandbox(host: JsxAnalysisHost, expression: JSXElementExpression, attributes: ReadonlyMap<string, JSXAttribute>): void {
  const sandbox = attributes.get("sandbox");
  if (!sandbox) {
    host.diagnostics.push(diagnostic(
      "VEL5066",
      "An iframe with srcdoc builds a document from a string, and that document runs script in this page's origin; add a sandbox attribute such as sandbox=\"allow-forms\" — write sandbox=\"\" when the frame needs no capability at all",
      expression.span,
    ));
    return;
  }
  const tokens = typeof sandbox.value === "string" ? sandbox.value
    : sandbox.value && sandbox.value.kind === "LiteralExpression" && typeof sandbox.value.value === "string" ? sandbox.value.value
      : null;
  if (tokens === null) return;
  const granted = new Set(tokens.split(/\s+/u).filter(Boolean));
  if (granted.has("allow-scripts") && granted.has("allow-same-origin")) {
    host.diagnostics.push(diagnostic(
      "VEL5066",
      "sandbox='allow-scripts allow-same-origin' lets the framed document remove its own sandbox, so a srcdoc frame with both is not sandboxed at all; drop one of the two",
      sandbox.span,
    ));
  }
}

/**
 * WEB-S2: the analyzer already refuses an anchor that opens a window without
 * 'noopener', so a URL attribute whose value is a script scheme cannot be the
 * one URL question it declines to ask. A written-down URL is answered here; a
 * value that arrives at run time is answered by the runtime attribute check.
 */
export function reportUrlAttributeScheme(host: JsxAnalysisHost, attribute: JSXAttribute): void {
  if (!WEB_URL_ATTRIBUTES.has(attribute.name)) return;
  const value = attribute.value;
  const written = typeof value === "string" ? [value] : value ? literalStringValues(value) : null;
  if (written === null) return;
  for (const text of written) {
    const refusal = urlSchemeRefusal(text);
    if (!refusal) continue;
    host.diagnostics.push(diagnostic("VEL5067", `JSX '${attribute.name}' takes a URL, and ${refusal}`, attribute.span));
    return;
  }
}
