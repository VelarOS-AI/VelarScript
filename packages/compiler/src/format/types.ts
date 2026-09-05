/**
 * Reading `<` and `>` positionally. The formatter has no parse tree, so it
 * decides from the tokens around a bracket whether it opens a type argument
 * list or is a comparison — the one question that makes `a < b` and
 * `List<string>` different.
 *
 * D115 §三 / D114 R1f: the type-syntax half of `formatter.ts`.
 */
import { isSourceIdentifierPart, isSourceIdentifierStart, isTypeEvidenceName } from "../source-names.ts";
import { binaryWords, prefixWords, type InlineToken } from "./tokens.ts";

// Structural generic-bracket detection: '<' after the name of a def/type/class
// declaration or after a type-only operator opens a bracket; every other
// expression-position '<' stays a comparison.
export const typeBracketDeclarationWords = new Set(["def", "type", "class"]);

export const typeBracketOperators = new Set(["->", "|", "is", "case", "extends"]);

export function beginsTypeBracket(tokens: readonly InlineToken[]): boolean {
  const before = tokens.at(-2);
  if (!before) return false;
  if (before.kind === "word" && typeBracketDeclarationWords.has(before.text)) return true;
  if (before.text === "not" && tokens.at(-3)?.text === "is") return true;
  return typeBracketOperators.has(before.text);
}

/**
 * D55 rule 127.2 / D57 rule 134: which '<' opens a type argument list is a
 * question about position, never about the name in front of it. A whitelist of
 * generic names — the shape this used to have — is blind to `Record<T>` today
 * and to every generic a program declares for itself tomorrow, so the two
 * remaining type positions are read structurally instead.
 *
 * The first is the annotation a ':' introduces (`x: Record<string>` as a
 * parameter, a field, or a `const`), reached by walking back over the words and
 * dots the type itself owns so modifiers such as `readonly` do not hide it.
 * The second is the target of a type alias, where everything right of '=' on a
 * `type` line is type syntax.
 */
export function opensAnnotatedType(tokens: readonly InlineToken[]): boolean {
  let index = tokens.length - 2;
  while (index >= 0) {
    const token = tokens[index]!;
    if (token.kind !== "word" && token.kind !== "dot") break;
    if (typeBracketOperators.has(token.text)) break;
    index -= 1;
  }
  const introducer = tokens[index];
  if (!introducer) return false;
  if (introducer.kind === "colon") return true;
  if (typeBracketOperators.has(introducer.text)) return true;
  return introducer.text === "=" && isTypeAliasLine(tokens);
}

export function isTypeAliasLine(tokens: readonly InlineToken[]): boolean {
  const head = tokens[0]?.text;
  return head === "type" || (head === "export" && tokens[1]?.text === "type");
}

/**
 * The annotation position is the one type position a comparison also occupies,
 * so the bracket has to prove itself: a type argument list closes on this line
 * with nothing between the brackets but type syntax. `{visible: count < limit}`
 * never closes, and `{ok: a < b and c > d}` carries a word no type argument
 * list can hold.
 *
 * A function type carries its parameter names, so the `:` of `List<(x: number)
 * -> string>` is type syntax too — but only inside the parameter list it names
 * a parameter in. At the top of the argument list a `:` is the one in
 * `{visible: count < limit, other: x > y}`, which is a record and two
 * comparisons, so the paren depth is what separates them.
 */
export function closesAsTypeArguments(source: string, start: number): boolean {
  return scanTypeArguments(source, start) !== null;
}

/**
 * D90 (compiler-front-15): the type argument list a TypeScript habit puts on a
 * call — `Map<string, number>()`, `id<string>("a")`. VelarScript infers type
 * arguments, so the spelling is always an error and the parser reads it without
 * regard to spacing. The formatter has to read it too: respacing it into
 * `Map < string, number > ()` rewrites the author's line into a spelling that
 * appears nowhere in their source, in exactly the file `velar format` is
 * pointed at while the teaching diagnostic is on screen.
 *
 * The evidence is the parser's (`explicitTypeArgumentsEnd`) minus the same-file
 * generic roster a line-based formatter cannot see: the brackets close on this
 * line with `(` directly behind them, and every `,`-separated argument carries
 * type evidence of its own — so `two(a < Limit, g > (c))`, two comparisons and
 * a working program, keeps its operator spacing. Being narrower than the parser
 * can only cost a respace on a line that is an error either way; it can never
 * change which reading the compiler gives a line, because the parser does not
 * consult the spacing.
 */
export function opensCallTypeArguments(source: string, start: number): boolean {
  const scanned = scanTypeArguments(source, start);
  return scanned !== null && scanned.typed && source[scanned.end] === "(";
}

export interface TypeArgumentScan {
  /** The offset just past the closing '>'. */
  readonly end: number;
  /** Every ','-separated argument carried evidence of being a type, and there was one. */
  readonly typed: boolean;
}

export function scanTypeArguments(source: string, start: number): TypeArgumentScan | null {
  let depth = 0;
  let parenthesized = 0;
  let index = start;
  let everyArgumentIsTyped = true;
  let argumentIsTyped = false;
  while (index < source.length) {
    const character = source[index]!;
    if (character === "<") {
      depth += 1;
      index += 1;
      if (depth >= 2) argumentIsTyped = true;
      continue;
    }
    if (character === ">") {
      // The close is the close whatever follows it: an author may write
      // `const values: List<number>=[1, 2, 3]` and expect canonical spacing.
      depth -= 1;
      index += 1;
      if (depth === 0) return { end: index, typed: everyArgumentIsTyped && argumentIsTyped };
      continue;
    }
    if (source.startsWith("->", index)) {
      index += 2;
      argumentIsTyped = true;
      continue;
    }
    if (isSourceIdentifierStart(character)) {
      const wordStart = index;
      index += 1;
      while (index < source.length && isSourceIdentifierPart(source[index]!)) index += 1;
      const word = source.slice(wordStart, index);
      if (binaryWords.has(word) || prefixWords.has(word)) return null;
      if (isTypeEvidenceName(word)) argumentIsTyped = true;
      continue;
    }
    if (character === "(") {
      parenthesized += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      parenthesized -= 1;
      if (parenthesized < 0) return null;
      index += 1;
      continue;
    }
    if (character === ":" && parenthesized > 0) {
      index += 1;
      continue;
    }
    if (character === "," && depth === 1) {
      everyArgumentIsTyped &&= argumentIsTyped;
      argumentIsTyped = false;
      index += 1;
      continue;
    }
    if (character === "?" || character === "|") {
      argumentIsTyped = true;
      index += 1;
      continue;
    }
    if (" \t,.".includes(character)) {
      index += 1;
      continue;
    }
    return null;
  }
  return null;
}
