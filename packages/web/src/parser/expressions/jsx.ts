/**
 * The JSX token's structured payload becoming an expression, and the reading of
 * each `{...}` interpolation inside it.
 *
 * The two habits JSX brings from elsewhere — a block comment written in an
 * interpolation, and a `{for item in items:}` block — get one directed message
 * each rather than an expression-parse cascade, and recover as an inert null so
 * the rest of the module still analyzes.
 */
import type { Diagnostic } from "@velarscript/compiler";
import { type Expression, type Token } from "@velarscript/compiler/extension";
import type { WebExpressionSource, WebJsxElementSyntax } from "../../lexer.ts";
import { diagnostic, jsxExpression, recoveredDiagnostic, shiftJsxSyntax } from "../spans.ts";

export interface JsxParserHost {
  readonly diagnostics: Diagnostic[];
  parseNestedExpression(fragment: string, offset: number, bracketFragment?: boolean, sourceOffsets?: readonly number[]): Expression;
}

export function parseJsxExpression(host: JsxParserHost, token: Token): Expression {
  const payload = token.payload as WebJsxElementSyntax | undefined;
  if (!payload || payload.kind !== "WebJsxElementSyntax") {
    host.diagnostics.push(diagnostic("VEL5001", "The Web JSX token is missing its structured syntax", token.span));
    return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
  }
  const syntax = shiftJsxSyntax(payload, token.span.start - payload.span.start);
  return jsxExpression(syntax, (source) => parseJsxEmbedded(host, source), (item) => host.diagnostics.push(item));
}

// A '{for item in items: ...}' block inside JSX gets targeted guidance to
// '.map(...)' instead of an expression-parse cascade; there is no magic JSX
// control flow. The child recovers as an inert null literal so the rest of the
// module still analyzes and reports its own guidance in the same compile.
function parseJsxEmbedded(host: JsxParserHost, source: WebExpressionSource): Expression {
  // WEB-U13: '{/* ... */}' is the JSX comment habit. VelarScript has no block
  // comment at all, so the interpolation gets one message naming '//' instead
  // of two 'Expected an expression' failures.
  if (/^\s*\/[*/]/u.test(source.source)) {
    host.diagnostics.push(recoveredDiagnostic(
      "VEL5002",
      "JSX has no comment form; write a '//' comment on its own line outside the markup",
      source.span,
    ));
    return { kind: "LiteralExpression", value: null, raw: "null", span: source.span };
  }
  if (/^\s*for\b/u.test(source.source)) {
    const detail = /^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^:{\n]+):/u.exec(source.source);
    const binding = detail?.[1] ?? "item";
    const iterable = detail?.[2]?.trim() || "items";
    host.diagnostics.push({
      code: "VEL5049",
      message: `Use '{${iterable}.map((${binding}) => ...)}'; JSX has no 'for' blocks, so lists render with '.map(...)'`,
      span: source.span,
      recovered: true,
    });
    return { kind: "LiteralExpression", value: null, raw: "null", span: source.span };
  }
  // JSX interpolation braces are a bracket context: the expression inside
  // '{...}' continues across physical lines exactly as inside parentheses.
  const layoutAtStart = /^[ \t]*(?:rf|fr|f|r)?["'](?:\r\n|\r|\n)/u.test(source.source);
  return layoutAtStart
    ? host.parseNestedExpression(
      source.openingIndent + source.source,
      source.span.start - source.openingIndent.length,
      true,
    )
    : host.parseNestedExpression(source.source, source.span.start, true);
}
