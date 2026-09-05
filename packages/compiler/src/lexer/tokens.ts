/**
 * The pure token tables `lexer.ts` and its collaborators read. A table with
 * three readers has one home; D115 §三 gives the parser directory the same
 * `tokens.ts` for the same reason.
 *
 * D114 R1f.
 */
import { type TokenKind } from "../token.ts";

// The tokens that end one logical line's token run, and the words a class
// header may carry ahead of `class`. Both are read when a block opens, to
// decide whether the block being entered is a class body.
export const lineBoundaryKinds = new Set<TokenKind>(["newline", "indent", "dedent"]);
