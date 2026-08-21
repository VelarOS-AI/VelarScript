import type { Span } from "./source.ts";

export type TokenKind =
  | "identifier"
  | "number"
  | "string"
  | "fstring"
  | "extensionToken"
  | "unitNumber"
  | "const"
  | "let"
  | "def"
  | "async"
  | "await"
  | "export"
  | "import"
  | "js"
  | "unsafe"
  | "extern"
  | "module"
  | "enum"
  | "abstract"
  | "class"
  | "extends"
  | "override"
  | "private"
  | "static"
  | "super"
  | "return"
  | "throw"
  | "assert"
  | "if"
  | "else"
  | "for"
  | "in"
  | "while"
  | "break"
  | "continue"
  | "try"
  | "catch"
  | "finally"
  | "pass"
  | "is"
  | "true"
  | "false"
  | "null"
  | "and"
  | "or"
  | "not"
  | "newline"
  | "indent"
  | "dedent"
  | "leftParen"
  | "rightParen"
  | "leftBracket"
  | "rightBracket"
  | "leftBrace"
  | "rightBrace"
  | "colon"
  | "comma"
  /** `@` qualifies the next name into the compiler-owned namespace of the current syntax context. */  | "at"
  | "dot"
  | "ellipsis"
  | "question"
  /**
   * A bare `!`. The character alone does not say which operator it is: after
   * an operand it is the required-value unwrap (`tags!`), and before one it is
   * the JavaScript negation VelarScript guides to `not`. Position decides, so
   * the lexer hands both readings to the parser under one kind.
   */
  | "bang"
  | "optionalDot"
  | "nullish"
  | "arrow"
  | "fatArrow"
  | "pipe"
  | "amp"
  | "caret"
  | "tilde"
  | "leftShift"
  | "rightShift"
  | "unsignedRightShift"
  | "assign"
  | "plusAssign"
  | "minusAssign"
  | "starAssign"
  | "slashAssign"
  | "percentAssign"
  | "bitOrAssign"
  | "bitAndAssign"
  | "bitXorAssign"
  | "leftShiftAssign"
  | "rightShiftAssign"
  | "unsignedRightShiftAssign"
  | "equal"
  | "notEqual"
  | "less"
  | "lessEqual"
  | "greater"
  | "greaterEqual"
  | "plus"
  | "minus"
  | "star"
  | "starStar"
  | "slash"
  | "percent"
  | "eof";

export interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly span: Span;
  readonly payload?: unknown;
}

/**
 * A number token's payload, carried only when the author's own spelling differs
 * from the value the token holds — digit separators (`1_000_000_1`) and an
 * uppercase radix prefix (`0X20`) are the two differences the lexer makes.
 * D90 R6's representability report quotes the literal back at the author, and
 * quoting the normalized spelling would show them text that appears nowhere in
 * their source.
 */
export interface NumberTokenPayload {
  readonly written: string;
}

/**
 * Hard reserved words: spellings the lexer always turns into a keyword token,
 * so they can never name a binding. D30 item 16 softened the statement-head
 * words that JavaScript does not reserve — including `type`, `match`, `from`,
 * `as`, and `json` — into contextual keywords, which the lexer emits as ordinary
 * identifiers and the parser recognizes by declaration shape. `enum` stays
 * here because JavaScript reserves it, and generated JavaScript must be legal.
 */
export const keywordKinds: Readonly<Record<string, TokenKind>> = {
  const: "const",
  let: "let",
  def: "def",
  async: "async",
  await: "await",
  export: "export",
  import: "import",
  js: "js",
  unsafe: "unsafe",
  extern: "extern",
  module: "module",
  enum: "enum",
  abstract: "abstract",
  class: "class",
  extends: "extends",
  override: "override",
  private: "private",
  static: "static",
  super: "super",
  return: "return",
  throw: "throw",
  assert: "assert",
  if: "if",
  else: "else",
  for: "for",
  in: "in",
  while: "while",
  break: "break",
  continue: "continue",
  try: "try",
  catch: "catch",
  finally: "finally",
  pass: "pass",
  is: "is",
  true: "true",
  false: "false",
  null: "null",
  and: "and",
  or: "or",
  not: "not",
};
