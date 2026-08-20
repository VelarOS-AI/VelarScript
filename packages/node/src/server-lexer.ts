import type { Diagnostic, Span } from "@velarscript/compiler";
import { scanStringLiteral } from "@velarscript/compiler/extension";
import type {
  CompilerFormattingOpaqueSourceScan,
  CompilerLexicalScanContext,
  CompilerLexicalScanResult,
  Token,
} from "@velarscript/compiler/extension";

export const NODE_PATH_PATTERN_TOKEN = "@velarscript/node:path-pattern";

export interface NodePathPatternSyntax {
  readonly kind: "NodePathPatternSyntax";
  readonly value: string;
  readonly contentSpan: Span;
  readonly span: Span;
}

export function scanNodeToken(context: CompilerLexicalScanContext): CompilerLexicalScanResult | null {
  const syntax = scanNodePathPattern(context.source, context.offset);
  if (!syntax) return null;
  const diagnostics: Diagnostic[] = [];
  if (!syntax.closed) {
    diagnostics.push(diagnostic("VEL6005", "Unterminated path pattern; close p\"...\" before the end of the line", syntax.span));
  }
  if (syntax.value.includes("\\")) {
    diagnostics.push(diagnostic(
      "VEL6005",
      "A path pattern is written literally and does not use string escapes",
      syntax.contentSpan,
    ));
  }
  const payload: NodePathPatternSyntax = {
    kind: "NodePathPatternSyntax",
    value: syntax.value,
    contentSpan: syntax.contentSpan,
    span: syntax.span,
  };
  return {
    token: extensionToken(NODE_PATH_PATTERN_TOKEN, syntax.span, payload),
    nextOffset: syntax.span.end,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

export function scanNodePathPatternForFormatting(source: string, start: number): CompilerFormattingOpaqueSourceScan | null {
  const syntax = scanNodePathPattern(source, start);
  return syntax ? { end: syntax.span.end, attachedToPrevious: false } : null;
}

export function isNodePathPatternSyntax(value: unknown): value is NodePathPatternSyntax {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NodePathPatternSyntax>;
  return candidate.kind === "NodePathPatternSyntax"
    && typeof candidate.value === "string"
    && isSpan(candidate.contentSpan)
    && isSpan(candidate.span);
}

function scanNodePathPattern(source: string, start: number): (NodePathPatternSyntax & { readonly closed: boolean }) | null {
  if (source[start] !== "p" || source[start + 1] !== "\"") return null;
  const scanned = scanStringLiteral(source, start + 1);
  if (!scanned || scanned.prefix !== "" || scanned.quote !== "\"" || scanned.layout || scanned.interpolated) return null;
  return {
    kind: "NodePathPatternSyntax",
    value: scanned.content,
    contentSpan: { start: scanned.contentStart, end: scanned.contentEnd },
    span: { start, end: scanned.end },
    closed: scanned.closed,
  };
}

function extensionToken(value: string, tokenSpan: Span, payload: unknown): Token {
  return { kind: "extensionToken", value, span: tokenSpan, payload };
}

function isSpan(value: unknown): value is Span {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Span>;
  return Number.isSafeInteger(candidate.start) && Number.isSafeInteger(candidate.end);
}

function diagnostic(code: string, message: string, sourceSpan: Span): Diagnostic {
  return { code, message, span: sourceSpan };
}
