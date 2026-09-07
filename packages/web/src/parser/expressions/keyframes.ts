/**
 * `keyframes:` as a block-valued expression, read the same way a `look:` block
 * is: the layout up front, then the block's own indented source.
 */
import type { Diagnostic } from "@velarscript/compiler";
import { type Expression, type Token, type TokenKind } from "@velarscript/compiler/extension";
import { WEB_KEYFRAMES_TOKEN, type WebKeyframesBlockSyntax } from "../../lexer.ts";
import { visualBlockLayout } from "../../visual-blocks.ts";
import { KeyframesSourceParser } from "../keyframes-source.ts";
import { diagnostic, shiftKeyframesSyntax, span } from "../spans.ts";
import { consumeVisualBlock, type VisualBlockParserHost } from "./visual-block.ts";

export interface KeyframesExpressionParserHost extends VisualBlockParserHost {
  readonly diagnostics: Diagnostic[];
  parseNestedExpression(fragment: string, offset: number, bracketFragment?: boolean, sourceOffsets?: readonly number[]): Expression;
  peekKind(distance: number): TokenKind;
  skipMistypedDeclaration(): void;
}

export function parseKeyframesExpression(host: KeyframesExpressionParserHost, token: Token): Expression {
  const layout = visualBlockLayout((distance) => host.peekKind(distance));
  if (layout === "none") {
    host.diagnostics.push(diagnostic("VEL5060", "A keyframes value is written as 'keyframes:' followed by indented 'from:', 'to:', or 'N%:' stops", token.span));
    host.skipMistypedDeclaration();
    return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
  }
  if (layout === "empty") {
    host.diagnostics.push(diagnostic("VEL5060", "A keyframes block requires at least one indented stop", token.span));
    host.advance();
    return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
  }
  const block = consumeVisualBlock(host, layout, "Expected keyframe stops", "Expected the end of the keyframes block");
  const payload = block.value === WEB_KEYFRAMES_TOKEN ? block.payload as WebKeyframesBlockSyntax | undefined : undefined;
  if (!payload || payload.kind !== "WebKeyframesBlockSyntax") {
    host.diagnostics.push(diagnostic("VEL5060", "The keyframes block is missing its structured syntax", block.span));
  }
  const syntax = payload?.kind === "WebKeyframesBlockSyntax"
    ? shiftKeyframesSyntax(payload, block.span.start - payload.span.start)
    : undefined;
  const stops = new KeyframesSourceParser(
    syntax ?? { kind: "WebKeyframesBlockSyntax", lines: [], span: block.span },
    (text, offset, openingIndent) => openingIndent
      ? host.parseNestedExpression(openingIndent + text, offset - openingIndent.length, true)
      : host.parseNestedExpression(text, offset),
    (item) => host.diagnostics.push(item),
  ).parse();
  const expression = { kind: "ExtensionExpression:web:keyframes", stops, span: span(token.span.start, block.span.end) } as const;
  return expression;
}
