/**
 * The token shapes the parser's families read: operator precedence and the
 * comparison chain, the kinds that may open a statement or sit at the top level
 * of a record literal, the kinds a type-argument list may contain, and the two
 * one-line questions asked of a token (may it name a declaration, and what did
 * the author actually write for a number).
 *
 * D114 R1c: these were module-level constants in `parser.ts`. They are pure
 * tables over `TokenKind`, and both `parser.ts` and its collaborators read
 * them, so they live where neither has to import the other.
 */
import type { ComparisonChainExpression } from "../ast.ts";
import { CORE_STATEMENT_HEAD_KEYWORDS } from "../core-vocabulary.ts";
import { keywordKinds, type NumberTokenPayload, type Token, type TokenKind } from "../token.ts";

export const memberNameKinds = new Set<TokenKind>(["identifier", ...Object.values(keywordKinds)]);

export // Token kinds that begin a statement but can never begin a record field or
// appear inside a record literal's field list. A keyword followed by ':' is a
// keyword-named field, so it never counts as statement evidence.
const statementStarterKinds = new Set<TokenKind>([
  "const", "let", "def", "return", "throw", "assert", "if", "for", "while", "break", "continue", "try", "pass",
]);

export // D30 item 16: `match` and `case` are contextual keywords, so statement
// evidence for them is carried by the word rather than by a token kind. D62
// rule 157: the pair is derived from Core's roster — the words whose statement
// shape takes a subject — rather than kept as a second one-word copy of it.
const statementStarterWords = new Set<string>(CORE_STATEMENT_HEAD_KEYWORDS);

export // Token kinds that legally appear at the top level of a record literal's
// field list: field names, shorthand entries, and their separators.
const recordFieldLevelKinds = new Set<TokenKind>(["identifier", "string", "comma", ...Object.values(keywordKinds)]);

export // The token kinds a type argument list can contain: names and the punctuation
// of optional, union, function, qualified and nested types. Anything else
// between `<` and `>` leaves the comparison reading as the only one.
const typeArgumentTokenKinds = new Set<TokenKind>([
  "identifier", "null", "comma", "dot", "question", "pipe", "arrow", "fatArrow",
  "leftParen", "rightParen", "leftBracket", "rightBracket", "colon", "ellipsis",
]);

export const binaryPrecedence: Partial<Record<TokenKind, number>> = {
  nullish: 1,
  or: 2,
  and: 3,
  pipe: 4,
  caret: 5,
  amp: 6,
  equal: 7,
  notEqual: 7,
  is: 7,
  in: 7,
  less: 7,
  lessEqual: 7,
  greater: 7,
  greaterEqual: 7,
  leftShift: 8,
  rightShift: 8,
  unsignedRightShift: 8,
  plus: 9,
  minus: 9,
  star: 10,
  slash: 10,
  percent: 10,
};

export const comparisonOperators: Partial<Record<TokenKind, ComparisonChainExpression["operators"][number]>> = {
  equal: "==",
  notEqual: "!=",
  less: "<",
  lessEqual: "<=",
  greater: ">",
  greaterEqual: ">=",
};

export /**
 * Whether a token stands in a declaration's name slot. `type` is a contextual
 * word, so the shape decides: an ordinary name, or a reserved word the name
 * slot refuses by name rather than let the line be read as an expression.
 */
function declarationNameAhead(kind: TokenKind, value: string): boolean {
  return kind === "identifier" || Object.hasOwn(keywordKinds, value);
}

export // D90 R6: the spelling a numeric token was written with. The lexer keeps it
// only where it differs from the value the token carries — digit separators and
// an uppercase radix prefix — so a representability report quotes the author's
// own line rather than the normalized digits it was read from.
function writtenNumber(token: Token): string {
  return (token.payload as NumberTokenPayload | undefined)?.written ?? token.value;
}
