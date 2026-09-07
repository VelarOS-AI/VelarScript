/**
 * The explicit native-CSS boundary: the inline `unsafe css` block, and the
 * `before look` / `after look` placement both it and `import css unsafe` must
 * state in source.
 */
import type { Diagnostic } from "@velarscript/compiler";
import { type Statement, type Token, type TokenKind } from "@velarscript/compiler/extension";
import { type WebUnsafeCssDeclaration as UnsafeCssDeclaration } from "../../ast.ts";
import { WEB_UNSAFE_CSS_TOKEN, type WebUnsafeCssBlockSyntax } from "../../lexer.ts";
import { diagnostic, span } from "../spans.ts";

export interface UnsafeCssParserHost {
  advance(): Token;
  checkWord(value: string): boolean;
  current(): Token;
  readonly diagnostics: Diagnostic[];
  expect(kind: TokenKind, message: string): Token;
  matchExtensionKeyword(value: string): boolean;
  peekKind(distance: number): TokenKind;
  peekValue(distance: number): string;
  previous(): Token;
}

export function parseUnsafeCssStatement(host: UnsafeCssParserHost, start: number): Statement | null | undefined {
  if (!host.checkWord("css") || host.peekKind(1) !== "extensionToken"
    || host.peekValue(1) !== WEB_UNSAFE_CSS_TOKEN) return undefined;
  host.advance();
  const token = host.advance();
  const payload = token.payload as WebUnsafeCssBlockSyntax | undefined;
  if (!payload || payload.kind !== "WebUnsafeCssBlockSyntax") {
    host.diagnostics.push(diagnostic("VEL5037", "The inline unsafe CSS token is missing its raw source", token.span));
    return { kind: "PassStatement", span: token.span };
  }
  const placement = parseUnsafeCssPlacement(host);
  const declaration: UnsafeCssDeclaration = {
    kind: "ExtensionStatement:web:unsafe-css",
    source: { kind: "inline", css: payload.css, span: payload.contentSpan },
    placement,
    span: span(start, host.previous().span.end),
  };
  return declaration;
}

export function parseUnsafeCssPlacement(host: UnsafeCssParserHost): "before" | "after" {
  let placement: "before" | "after" = "before";
  if (host.current().kind === "identifier" && host.current().value === "before") {
    host.expect("identifier", "Expected 'before'");
    placement = "before";
  } else if (host.current().kind === "identifier" && host.current().value === "after") {
    host.expect("identifier", "Expected 'after'");
    placement = "after";
  } else host.diagnostics.push(diagnostic("VEL5037", "Unsafe CSS must explicitly declare 'before look' or 'after look'", host.current().span));
  if (!host.matchExtensionKeyword("look")) {
    host.diagnostics.push(diagnostic("VEL5037", "Unsafe CSS order must end with 'look'", host.current().span));
  }
  return placement;
}
