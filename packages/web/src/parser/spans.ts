/**
 * Spans, the diagnostics written about them, and the two rewrites that move a
 * structured payload from where the lexer scanned it to where the parser found
 * its token.
 *
 * D115 P4 R3e: every `parser/` collaborator writes diagnostics and builds spans,
 * so the three constructors live here with the shifting they serve rather than
 * being spelled again in each file.
 */
import type { Diagnostic, Span } from "@velarscript/compiler";
import type { Expression } from "@velarscript/compiler/extension";
import { type WebJsxElementExpression as JSXElementExpression } from "../ast.ts";
import type {
  WebExpressionSource,
  WebJsxElementSyntax,
  WebKeyframesBlockSyntax,
  WebLookBlockSyntax,
} from "../lexer.ts";

export const span = (start: number, end: number): Span => ({ start, end });
export const diagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan });
export const recoveredDiagnostic = (code: string, message: string, sourceSpan: Span): Diagnostic => ({ code, message, span: sourceSpan, recovered: true });

export function shiftSourceSpan(sourceSpan: Span, offset: number): Span {
  return offset === 0 ? sourceSpan : span(sourceSpan.start + offset, sourceSpan.end + offset);
}

export function shiftExpressionSource(source: WebExpressionSource, offset: number): WebExpressionSource {
  return offset === 0 ? source : { ...source, span: shiftSourceSpan(source.span, offset) };
}

export function shiftJsxSyntax(syntax: WebJsxElementSyntax, offset: number): WebJsxElementSyntax {
  if (offset === 0) return syntax;
  return {
    ...syntax,
    span: shiftSourceSpan(syntax.span, offset),
    tagSpan: shiftSourceSpan(syntax.tagSpan, offset),
    attributes: syntax.attributes.map((attribute) => ({
      ...attribute,
      span: shiftSourceSpan(attribute.span, offset),
      value: typeof attribute.value === "object" && attribute.value !== null
        ? shiftExpressionSource(attribute.value, offset)
        : attribute.value,
    })),
    children: syntax.children.map((child) => {
      if (child.kind === "WebJsxElementSyntax") return shiftJsxSyntax(child, offset);
      if (child.kind === "WebJsxExpressionSyntax") {
        return {
          ...child,
          span: shiftSourceSpan(child.span, offset),
          expression: shiftExpressionSource(child.expression, offset),
        };
      }
      return { ...child, span: shiftSourceSpan(child.span, offset) };
    }),
  };
}

export function shiftLookSyntax(syntax: WebLookBlockSyntax, offset: number): WebLookBlockSyntax {
  if (offset === 0) return syntax;
  return {
    ...syntax,
    span: shiftSourceSpan(syntax.span, offset),
    lines: syntax.lines.map((line) => ({
      ...line,
      start: line.start + offset,
      end: line.end + offset,
    })),
  };
}

export function shiftKeyframesSyntax(syntax: WebKeyframesBlockSyntax, offset: number): WebKeyframesBlockSyntax {
  if (offset === 0) return syntax;
  return {
    ...syntax,
    span: shiftSourceSpan(syntax.span, offset),
    lines: syntax.lines.map((line) => ({ ...line, start: line.start + offset, end: line.end + offset })),
  };
}

export function jsxExpression(
  syntax: WebJsxElementSyntax,
  parseExpression: (source: WebExpressionSource) => Expression,
  report: (item: Diagnostic) => void,
): JSXElementExpression {
  return {
    kind: "ExtensionExpression:web:jsx",
    tag: syntax.tag,
    tagSpan: syntax.tagSpan,
    attributes: syntax.attributes.map((attribute) => ({
      name: attribute.name,
      value: typeof attribute.value === "object" && attribute.value !== null
        ? parseExpression(attribute.value)
        : attribute.value,
      span: attribute.span,
    })),
    children: syntax.children.map((child) => {
      if (child.kind === "WebJsxElementSyntax") return jsxExpression(child, parseExpression, report);
      if (child.kind === "WebJsxExpressionSyntax") {
        return { kind: "JSXExpressionChild", expression: parseExpression(child.expression), span: child.span };
      }
      // A bare (unbraced) 'for name in expr:' line written directly as JSX
      // content receives the same .map() guidance as its braced spelling;
      // there is no magic JSX control flow.
      const bareFor = /(?:^|\n)[ \t]*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^:{<\n]+):/u.exec(child.value);
      if (bareFor) {
        const offset = child.span.start + (bareFor.index + bareFor[0].indexOf("for"));
        report(recoveredDiagnostic(
          "VEL5049",
          `Use '{${bareFor[2]!.trim()}.map((${bareFor[1]}) => ...)}'; JSX has no 'for' blocks, so lists render with '.map(...)'`,
          span(offset, offset + (bareFor[0].length - bareFor[0].indexOf("for"))),
        ));
      }
      return { kind: "JSXText", value: child.value, span: child.span };
    }),
    span: syntax.span,
  };
}


export function replaceLookHooks(expression: Expression, hooks: ReadonlyMap<number, string>): Expression {
  if (expression.kind === "IdentifierExpression" && hooks.has(expression.span.start)) {
    const hook = { kind: "ExtensionExpression:web:look-hook", name: hooks.get(expression.span.start)!, span: expression.span } as const;
    return hook;
  }
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    if (record.kind === "IdentifierExpression" && typeof record.span === "object" && record.span) {
      const sourceSpan = record.span as Span;
      const name = hooks.get(sourceSpan.start);
      if (name) return { kind: "ExtensionExpression:web:look-hook", name, span: sourceSpan };
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, key === "span" ? child : visit(child)]));
  };
  return visit(expression) as Expression;
}
