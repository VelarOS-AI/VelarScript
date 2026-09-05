/**
 * What one inline token is, and the spacing rule between two of them. Every
 * question here is answered from the token stream alone — no line, no layout,
 * no source text beyond the token's own.
 *
 * D115 §三 / D114 R1f: the token half of `formatter.ts`.
 */
import { CORE_STATEMENT_HEAD_KEYWORDS } from "../core-vocabulary.ts";
import { keywordKinds } from "../token.ts";
import { type MarkupElement } from "./markup.ts";

export type InlineKind = "word" | "literal" | "string" | "operator" | "open" | "close" | "comma" | "colon" | "dot" | "at" | "embedded" | "markup" | "comment";

export interface InlineToken {
  readonly kind: InlineKind;
  readonly text: string;
  readonly generic?: boolean;
  /** The parsed element behind a "markup" token; the printer owns its layout. */
  readonly element?: MarkupElement;
}

export const multiCharacterOperators = [">>>=", "<<=", ">>=", ">>>", "<<", ">>", "...", "?.", "??", "->", "=>", "==", "!=", "<=", ">=", "**", "+=", "-=", "*=", "/=", "%=", "|=", "&=", "^="] as const;

export const binaryWords = new Set(["and", "or", "in", "is"]);

export const prefixWords = new Set(["not", "await"]);

// D30 item 16: `match` and `case` are contextual keywords, so `match(value)` is
// a call and must not gain a keyword's space. They keep it only where a
// keyword can stand — the head of a statement line. D62 rule 157: which words
// those are is Core's roster to answer, not this file's — the copy that stood
// here knew two of the ten and could not have learned about an eleventh.
export const statementHeadKeywordWords = new Set<string>(CORE_STATEMENT_HEAD_KEYWORDS);

/**
 * The reserved words that stand in expression position: `super` and `import`
 * name one directly — `super(id)`, `import("./page.vel")` — and the formatter
 * has already read `true`, `false` and `null` as literals by the time this set
 * is consulted. Every other reserved word is a keyword in the structural sense
 * `endsExpression` uses: it cannot end an expression, so what follows it opens
 * a new one.
 */
export const expressionKeywordWords = new Set(["true", "false", "null", "super", "import"]);

export const nonExpressionKeywordWords = new Set(Object.keys(keywordKinds).filter((word) => !expressionKeywordWords.has(word)));

export function blockCommentEnd(source: string, start: number): number {
  let index = start + 2;
  let depth = 1;
  while (index < source.length && depth > 0) {
    if (source.startsWith("/*", index)) {
      depth += 1;
      index += 2;
    } else if (source.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
    } else {
      index += 1;
    }
  }
  return index;
}

export function lastLineWidth(output: string): number {
  const start = output.lastIndexOf("\n");
  return start === -1 ? output.length : output.length - start - 1;
}

/**
 * D57 rule 134, restated for this file: the spacing questions below are all one
 * question — does the token in front end an expression? What follows something
 * that ends one is applied to it (`values[0]` indexes, `f(x)` calls, `a - b`
 * subtracts, `a < b` compares); what follows anything else begins a fresh
 * expression (`const [head, ...tail]` destructures, `async (id) =>` takes
 * parameters, `return -1` negates, `?? <em>x</em>` is markup).
 *
 * The tokens that can end an expression are a closed structural set: a name, a
 * literal, a string, a closing bracket, an element. The words that cannot are
 * the language's own reserved vocabulary, read from the lexer's table rather
 * than kept here. The hand-kept list this replaced was blind to `const` and
 * `let` (D59 143.1), to `async` (143.2), and to `return` in front of an
 * operator (143.3), and a word the language gains tomorrow would have gone
 * missing from it the same way.
 */
export function endsExpression(token: InlineToken | undefined, statementHead = false): boolean {
  if (!token) return false;
  // D86 rule 212: a postfix `!` ends the value it unwraps, so `tags!(...)` and
  // `rows!` keep the tight spelling the rest of a postfix chain uses. The
  // prefix reading is a VEL1005 diagnostic rather than canonical source, and
  // the tight `!(...)` it formats to is the JavaScript spelling anyway.
  if (token.kind === "operator" && token.text === "!") return true;
  switch (token.kind) {
    case "word":
      // `match` and `case` are keywords only at the head of a statement line
      // (D30 item 16); anywhere else the same spelling is an ordinary name.
      if (statementHead && statementHeadKeywordWords.has(token.text)) return false;
      return !nonExpressionKeywordWords.has(token.text);
    case "literal":
    case "string":
    case "close":
    case "markup":
    case "embedded":
      return true;
    default:
      return false;
  }
}

/**
 * D60 rule 147: whether a `<` opens embedded markup is the same question. An
 * element stands where an expression can begin — after `??`, after `and`, after
 * a comma, at the head of a line — and a comparison stands after something that
 * ends an expression. Reading a list of the positions instead is what wrote
 * `{text ?? <em>x</em>}` out as `{text ?? < em > x < / em >}`, which no longer
 * compiles.
 */
export function beginsEmbeddedAngleSyntax(tokens: readonly InlineToken[], source: string, index: number): boolean {
  if (!/[A-Za-z>]/u.test(source[index + 1] ?? "")) return false;
  return !endsExpression(tokens.at(-1), tokens.length === 1);
}

/**
 * D59 rule 142 — `name=value` is one argument, and the charter and every
 * documentation table spell it tight. Which `=` separates a named argument is a
 * question about position: the name has to open an argument (it follows the
 * call's `(`, or a `,` inside it) and the parentheses have to be a call's. The
 * other `=` that stands inside parentheses is a default value, and a default
 * value's parentheses belong to a declaration or a lambda, never to a call.
 */
export function isNamedArgumentEquals(tokens: readonly InlineToken[], index: number): boolean {
  const equals = tokens[index];
  if (!equals || equals.kind !== "operator" || equals.text !== "=") return false;
  if (tokens[index - 1]?.kind !== "word") return false;
  const opener = tokens[index - 2];
  if (!opener || (opener.kind !== "comma" && !(opener.kind === "open" && opener.text === "("))) return false;
  const open = enclosingParenIndex(tokens, index - 2);
  if (open < 0) return false;
  return !isDeclarationParameterList(tokens, open) && endsExpression(tokens[open - 1], open === 1);
}

/** The index of the `(` whose argument list `index` sits directly inside. */
export function enclosingParenIndex(tokens: readonly InlineToken[], index: number): number {
  let depth = 0;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const token = tokens[cursor]!;
    if (token.kind === "close") depth += 1;
    else if (token.kind === "open") {
      if (depth === 0) return token.text === "(" ? cursor : -1;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * A declaration's parentheses hold parameters, and a parameter's `= value` is a
 * default. Three positions say the list is a declaration's, and none of them
 * needs to know which words introduce a declaration:
 *
 *  - `def name(...)`, with or without a type argument list of its own.
 *  - Two names in a row in front of it. Nothing applies one name to another in
 *    an expression, so `component Row(...)` and `action submit(...)` are
 *    declaration headers while `check(...)` and `if check(...)` are calls —
 *    including the declaration forms an extension owns, which this file cannot
 *    otherwise see.
 *  - A single name at the head of a line whose `)` opens a block, which is
 *    `constructor(...):` and nothing a call can be.
 */
export function isDeclarationParameterList(tokens: readonly InlineToken[], open: number): boolean {
  let name = open - 1;
  const typeArguments = tokens[name];
  if (typeArguments?.kind === "close" && typeArguments.generic === true) {
    name = matchingGenericOpenIndex(tokens, name) - 1;
  }
  if (name < 0 || tokens[name]?.kind !== "word") return false;
  const introducer = tokens[name - 1];
  if (introducer?.text === "def") return true;
  if (introducer?.kind === "word" && endsExpression(introducer, name === 1)) return true;
  const close = matchingCloseIndex(tokens, open);
  return name === 0 && close >= 0 && tokens[close + 1]?.kind === "colon";
}

export function matchingGenericOpenIndex(tokens: readonly InlineToken[], close: number): number {
  let depth = 0;
  for (let cursor = close; cursor >= 0; cursor -= 1) {
    const token = tokens[cursor]!;
    if (token.kind === "close" && token.generic === true) depth += 1;
    else if (token.kind === "open" && token.generic === true) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

export function matchingCloseIndex(tokens: readonly InlineToken[], open: number): number {
  let depth = 0;
  for (let cursor = open; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor]!;
    if (token.kind === "open") depth += 1;
    else if (token.kind === "close") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

export function isAttachedOpaqueSourcePlaceholder(token: InlineToken): boolean {
  // The marker carries a settled serial, so the placeholder is recognised by
  // the fixed middle `protectMultilineStrings` gives it rather than by the
  // marker spelled out — which would stop matching the moment a module made
  // the marker settle on anything but its first spelling.
  return token.kind === "string"
    && token.text.includes("__velar_formatter_")
    && token.text.includes("attached_opaque_source_");
}

export function isUnaryOperator(token: InlineToken, previous: InlineToken | undefined, statementHead = false): boolean {
  if (prefixWords.has(token.text)) return true;
  if (token.text === "~") return true;
  if (token.text !== "+" && token.text !== "-") return false;
  return !endsExpression(previous, statementHead);
}

export function isOptionalQuestion(token: InlineToken, next: InlineToken | undefined, after: InlineToken | undefined): boolean {
  if (token.text !== "?") return false;
  return !next || next.kind === "comma" || next.kind === "close" || next.kind === "colon"
    || next.text === "=" || next.text === "|" || after?.text === "=>";
}

export function isTernaryColon(tokens: readonly InlineToken[], colonIndex: number): boolean {
  let depth = 0;
  for (let index = colonIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index]!;
    if (token.kind === "close") depth += 1;
    else if (token.kind === "open") depth -= 1;
    else if (depth === 0 && token.text === "?" && !isOptionalQuestion(token, tokens[index + 1], tokens[index + 2])) return true;
    else if (depth === 0 && (token.kind === "colon" || token.kind === "comma")) return false;
  }
  return false;
}

export function needsSpace(
  previous: InlineToken,
  current: InlineToken,
  next: InlineToken | undefined,
  tokens: readonly InlineToken[],
  index: number,
  preceding: InlineToken | undefined,
): boolean {
  if (isAttachedOpaqueSourcePlaceholder(current)) return false;
  if (current.kind === "comment") return true;
  if (previous.kind === "comment") return !previous.text.startsWith("//");
  if (current.kind === "embedded" || current.kind === "markup") {
    // D60 rule 147: markup is an argument like any other after a `,` or a `:`,
    // so it keeps the separator's space; only an opening bracket sits tight
    // against it. A named argument's value is the one exception, because
    // `name=value` is written as one thing.
    if (previous.text === "=" && isNamedArgumentEquals(tokens, index - 1)) return false;
    return previous.kind !== "open";
  }
  if (current.kind === "comma" || current.kind === "close" || current.kind === "dot" || current.kind === "colon") {
    if (current.kind === "colon" && isTernaryColon(tokens, index)) return true;
    return false;
  }
  if (previous.kind === "dot" || previous.kind === "at") return false;
  if (current.kind === "at") return previous.kind !== "open" && previous.kind !== "operator";
  if (previous.kind === "comma" || previous.kind === "colon") return true;
  if (previous.kind === "open") return false;
  if (current.kind === "open") {
    if (current.text === "(" && previous.text === "js" && tokens[0]?.text === "extern") return false;
    // A named argument's value is written against its name whatever the value
    // is — `initial=0`, `combine=(total, value) => …`, `value={type: "bool"}`.
    if (previous.text === "=" && isNamedArgumentEquals(tokens, index - 1)) return false;
    if (current.text === "{") return true;
    if (current.generic) return false;
    // A member name is a name even when it is spelled like a keyword —
    // `values.in(other)`, `values.case[0]` — so the dot decides, not the word.
    if (tokens[index - 2]?.kind === "dot") return false;
    // D51 item NEW-D9, now derived: `[` and `(` after something that ends an
    // expression apply to it — `values[0]`, `format(value)`. After a keyword
    // they open a fresh one — `const [head, ...tail]`, `for i in [1, 2]`,
    // `async (id: string) =>`. The whitelist this replaced had `in` but never
    // `const`, and `--check` then enforced the shape it wrote.
    return !endsExpression(previous, index === 1);
  }
  if (previous.kind === "close" && previous.generic) return current.text !== "?";
  if (previous.kind === "operator" || current.kind === "operator") {
    if (current.text === "=" && isNamedArgumentEquals(tokens, index)) return false;
    if (previous.text === "=" && isNamedArgumentEquals(tokens, index - 1)) return false;
    if (previous.text === "..." || current.text === "...") return false;
    if (current.text === "?" && isOptionalQuestion(current, next, tokens[index + 2])) return false;
    if (previous.text === "?" && isOptionalQuestion(previous, current, next)) return true;
    // D86 rule 212: `!` after a value is the required-value unwrap and sits
    // against it, like `?.` and `[`. Before a value it is the negation the
    // compiler guides to `not`, and it keeps that reading's spacing.
    if (current.text === "!" && endsExpression(previous, index === 1)) return false;
    if (isUnaryOperator(previous, index >= 2 ? tokens[index - 2] : preceding, index === 2)) {
      return previous.text === "not" || previous.text === "await";
    }
    if (isUnaryOperator(current, previous, index === 1)) return true;
    return true;
  }
  if ((previous.kind === "word" && (binaryWords.has(previous.text) || prefixWords.has(previous.text)))
    || (current.kind === "word" && binaryWords.has(current.text))) return true;
  return true;
}
