/**
 * The one import form the Web extension adds: `import css unsafe "./file.css"`,
 * with the same stated placement its inline sibling carries.
 */
import { type Statement } from "@velarscript/compiler/extension";
import { type WebUnsafeCssDeclaration as UnsafeCssDeclaration } from "../../ast.ts";
import { diagnostic, span } from "../spans.ts";
import { parseUnsafeCssPlacement, type UnsafeCssParserHost } from "./unsafe-css.ts";

export type ImportParserHost = UnsafeCssParserHost;

export function parseCssImport(host: ImportParserHost, start: number): Statement | null | undefined {
  // `import css unsafe "./file.css"` against `import css from "./module.vel"`:
  // the CSS boundary is claimed only when the word is followed by the
  // boundary marker or by the path itself, so a module named `css` still
  // imports by name.
  if (!host.checkWord("css") || !(host.peekKind(1) === "unsafe" || host.peekKind(1) === "string")) return undefined;
  host.advance();
  host.expect("unsafe", "Native CSS is an unsafe boundary; write 'import css unsafe'");
  const source = host.expect("string", "Expected a relative .css path after 'import css unsafe'");
  const placement = parseUnsafeCssPlacement(host);
  if ((!source.value.startsWith("./") && !source.value.startsWith("../")) || !source.value.endsWith(".css")) {
    host.diagnostics.push(diagnostic("VEL5037", "Unsafe CSS imports require an explicit relative path ending in '.css'", source.span));
  }
  const declaration: UnsafeCssDeclaration = {
    kind: "ExtensionStatement:web:unsafe-css",
    source: { kind: "external", path: source.value, span: source.span },
    placement,
    span: span(start, host.previous().span.end),
  };
  return declaration;
}
