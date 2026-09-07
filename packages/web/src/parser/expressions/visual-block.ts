/**
 * Consuming the block a `look:` or `keyframes:` value is written in.
 *
 * Both expressions are read the same way — the ':' , the layout around the
 * block, and the block token itself — so the consumption is a shared module
 * rather than a copy in each of the two readers.
 */
import { type Token, type TokenKind } from "@velarscript/compiler/extension";
import type { VisualBlockLayout } from "../../visual-blocks.ts";

export interface VisualBlockParserHost {
  advance(): Token;
  consumeNewlines(): void;
  expect(kind: TokenKind, message: string): Token;
}

/** Consumes the ':' , the layout around the block, and the block itself. */
export function consumeVisualBlock(
  host: VisualBlockParserHost,
  layout: Exclude<VisualBlockLayout, "empty" | "none">,
  entries: string,
  end: string,
): Token {
  host.advance();
  if (layout === "bracketed") return host.expect("extensionToken", entries);
  host.consumeNewlines();
  host.advance();
  const block = host.expect("extensionToken", entries);
  host.consumeNewlines();
  host.expect("dedent", end);
  return block;
}
