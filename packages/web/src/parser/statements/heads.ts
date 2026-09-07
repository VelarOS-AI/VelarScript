/**
 * Whether a contextual Web word standing at the start of a line is a
 * declaration head at all, and the token shapes each head is claimed by.
 *
 * D30 item 16 is one rule with three readings — a name and a shape token, a
 * header line ending in ':', a word followed by a fresh value — and both the
 * module-level dispatcher in `parser.ts` and `parseComponent` ask all three, so
 * the lookaheads are a shared module rather than a copy on each side.
 */
import type { TokenKind } from "@velarscript/compiler/extension";

export interface StatementHeadParserHost {
  checkWord(value: string): boolean;
  peekKind(distance: number): TokenKind;
}

// The tokens that may follow the declared name in each Web declaration head.
export const componentHeaderShapes = new Set(["leftParen", "colon", "less", "identifier"]);
export const reactiveBindingShapes = new Set(["assign", "colon"]);
export const actionHeaderShapes = new Set(["leftParen"]);
// Tokens that open a fresh value rather than continuing the expression before
// them; only these make `expose` the component's expose item.
const exposeValueStartKinds = new Set([
  "identifier", "string", "fstring", "number", "unitNumber", "true", "false", "null", "super", "leftBrace", "extensionToken",
]);

/**
 * D30 item 16: a Web declaration head is claimed only in its own declaration
 * shape — the word, a name, and one of the tokens that can follow it there.
 * `state = 1`, `state(x)`, and `state.field` all keep the identifier reading.
 */
export function namedDeclarationAhead(host: StatementHeadParserHost, word: string, shapes: ReadonlySet<string>): boolean {
  return host.checkWord(word) && host.peekKind(1) === "identifier" && shapes.has(host.peekKind(2));
}

/**
 * `watch` opens a block: its header line ends in ':' and an indented body
 * follows. No expression statement can end in ':', so the lookahead is exact
 * and `watch = 1` / `watch(value)` stay ordinary code.
 */
export function blockHeaderAhead(host: StatementHeadParserHost, word: string): boolean {
  if (!host.checkWord(word)) return false;
  let depth = 0;
  let offset = 1;
  for (; ; offset += 1) {
    const kind = host.peekKind(offset);
    if (kind === "leftParen" || kind === "leftBracket" || kind === "leftBrace") depth += 1;
    else if (kind === "rightParen" || kind === "rightBracket" || kind === "rightBrace") depth -= 1;
    else if (kind === "eof") return false;
    else if (depth === 0 && (kind === "newline" || kind === "dedent")) break;
  }
  if (offset < 3 || host.peekKind(offset - 1) !== "colon") return false;
  while (host.peekKind(offset) === "newline") offset += 1;
  return host.peekKind(offset) === "indent";
}

/**
 * `expose value` is the one Web statement head followed by a bare expression
 * rather than by a name and a shape token. It is claimed only when the next
 * token opens a fresh value, so `expose(handle)` reads as a call and
 * `expose = handle` as an assignment — the identifier reading wins wherever
 * the two could compete.
 */
export function exposeItemAhead(host: StatementHeadParserHost): boolean {
  return host.checkWord("expose") && exposeValueStartKinds.has(host.peekKind(1));
}
