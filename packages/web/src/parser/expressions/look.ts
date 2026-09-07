/**
 * `look:` as a block-valued expression: the whole shape is read up front, once,
 * so an unfinished Look value says one thing rather than unravelling into six
 * diagnostics as each expectation fails in turn (LOK-I3).
 */
import type { Diagnostic } from "@velarscript/compiler";
import { type Expression, type Token, type TokenKind } from "@velarscript/compiler/extension";
import { WEB_LOOK_TOKEN, type WebLookBlockSyntax } from "../../lexer.ts";
import { visualBlockLayout } from "../../visual-blocks.ts";
import { LookSourceParser } from "../look-source.ts";
import { diagnostic, shiftLookSyntax, span } from "../spans.ts";
import { consumeVisualBlock, type VisualBlockParserHost } from "./visual-block.ts";

export interface LookExpressionParserHost extends VisualBlockParserHost {
  readonly diagnostics: Diagnostic[];
  parseNestedExpression(fragment: string, offset: number, bracketFragment?: boolean, sourceOffsets?: readonly number[]): Expression;
  peekKind(distance: number): TokenKind;
  skipMistypedDeclaration(): void;
}

export function parseLookExpression(host: LookExpressionParserHost, token: Token): Expression {
  // LOK-I3: an unfinished Look value used to unravel into six diagnostics as each
  // expectation failed in turn; the whole shape is read up front, once, instead.
  const layout = visualBlockLayout((distance) => host.peekKind(distance));
  if (layout === "none") {
    host.diagnostics.push(diagnostic("VEL5038", "A Look value is written as 'look:' followed by an indented block of 'property = value' entries", token.span));
    host.skipMistypedDeclaration();
    return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
  }
  if (layout === "empty") {
    // The colon stays unconsumed so the surrounding statement still ends at
    // its own newline; only this one message describes the missing block.
    host.diagnostics.push(diagnostic("VEL5038", "A Look block requires at least one indented 'property = value' entry", token.span));
    host.advance();
    return { kind: "LiteralExpression", value: null, raw: "null", span: token.span };
  }
  const block = consumeVisualBlock(host, layout, "Expected Look entries", "Expected the end of the Look block");
  const payload = block.value === WEB_LOOK_TOKEN ? block.payload as WebLookBlockSyntax | undefined : undefined;
  if (!payload || payload.kind !== "WebLookBlockSyntax") {
    host.diagnostics.push(diagnostic("VEL5038", "The Look block is missing its structured syntax", block.span));
  }
  const syntax = payload?.kind === "WebLookBlockSyntax"
    ? shiftLookSyntax(payload, block.span.start - payload.span.start)
    : undefined;
  const entries = new LookSourceParser(
    syntax ?? { kind: "WebLookBlockSyntax", lines: [], span: block.span },
    (text, offset, openingIndent) => openingIndent
      ? host.parseNestedExpression(openingIndent + text, offset - openingIndent.length, true)
      : host.parseNestedExpression(text, offset),
    (item) => host.diagnostics.push(item),
  ).parse();
  const expression = { kind: "ExtensionExpression:web:look", entries, span: span(token.span.start, block.span.end) } as const;
  return expression;
}
