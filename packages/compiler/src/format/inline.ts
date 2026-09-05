/**
 * One logical line printed: the tokens it splits into, the spaces between
 * them, and the markup an element token renders back to.
 *
 * D115 §三 / D114 R1f: these nine are one module because they are mutually
 * recursive — a line holds a string, an interpolated part of that string is a
 * line, a line holds an element, and an element's attribute holds a line. That
 * recursion is the code's, not the split's, so keeping it inside one module is
 * what leaves the directory's import graph acyclic.
 */
import type { CompilerExtension } from "../extension.ts";
import { findInterpolatedExpressionEnd, scanStringEscape, scanStringLiteral, type StringLiteralScan } from "../interpolated-string.ts";
import { isSourceIdentifierPart, isSourceIdentifierStart } from "../source-names.ts";
import { heldLayoutFor, heldMarkupLayout, isBreakableMarkup, markupLayout, scanMarkupElement, type MarkupAttribute, type MarkupElement, type MarkupLayout } from "./markup.ts";
import { FORMAT_PRINT_WIDTH } from "./options.ts";
import { canonicalizeInlineString } from "./strings.ts";
import {
  beginsEmbeddedAngleSyntax,
  blockCommentEnd,
  isAttachedOpaqueSourcePlaceholder,
  lastLineWidth,
  multiCharacterOperators,
  needsSpace,
  type InlineKind,
  type InlineToken,
} from "./tokens.ts";
import { beginsTypeBracket, closesAsTypeArguments, opensAnnotatedType, opensCallTypeArguments } from "./types.ts";

export function formatInline(
  source: string,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
  layout: MarkupLayout = heldLayoutFor(embedding),
): string {
  return formatInlineLine(source, embedding, layout).text;
}

/**
 * The end of a numeric literal read from `index`: a radix form, or a decimal
 * with its optional fraction, exponent and unit suffix.
 *
 * D115 §一.1: split out of `tokenizeInline` unchanged so both fit in one
 * screen. It reads only the source and returns only the new cursor.
 */
function numberLiteralEnd(source: string, from: number): number {
  const character = source[from]!;
  let index = from + 1;
  if (character === "0" && /[xXbBoO]/u.test(source[index] ?? "")) {
    index += 1;
    while (index < source.length && /[A-Za-z0-9_]/u.test(source[index]!)) index += 1;
    return index;
  }
  while (index < source.length && /[0-9_]/u.test(source[index]!)) index += 1;
  if (source[index] === "." && /[0-9_]/u.test(source[index + 1] ?? "")) {
    index += 1;
    while (index < source.length && /[0-9_]/u.test(source[index]!)) index += 1;
  }
  if ((source[index] === "e" || source[index] === "E") && /[+\-0-9_]/u.test(source[index + 1] ?? "")) {
    index += 1;
    if (source[index] === "+" || source[index] === "-") index += 1;
    while (index < source.length && /[0-9_]/u.test(source[index]!)) index += 1;
  }
  while (index < source.length && /[A-Za-z%]/u.test(source[index]!)) index += 1;
  return index;
}

/**
 * The token kind a single punctuation character stands for, or null where it
 * is an operator this table has nothing to say about.
 *
 * D115 §一.1: split out of `tokenizeInline` unchanged — six one-character
 * branches that pushed the same shape and only differed in the kind.
 */
function inlinePunctuationKind(character: string): InlineKind | null {
  if (character === "@") return "at";
  if (character === ".") return "dot";
  if (character === ",") return "comma";
  if (character === ":") return "colon";
  if (character === "(" || character === "[" || character === "{") return "open";
  if (character === ")" || character === "]" || character === "}") return "close";
  return null;
}

/**
 * D59 rule 143, fourth item: the formatter reads one physical line at a time,
 * so a line that opens with `+` or `-` used to have no token in front of it at
 * all and was read as a negation — `basePrice` on one line and `+ shipping` on
 * the next came back as `+shipping`, against the charter's own example. Inside
 * brackets a newline is not a statement boundary (charter §2), so the token in
 * front is simply on the previous line: the caller carries it across, and the
 * unary question is answered from the same position every other one is. It also
 * answers the case with the opposite result, where a list literal's `-1` on its
 * own line follows the `[` that opened it and stays a negation.
 */
export function formatInlineLine(
  source: string,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
  layout: MarkupLayout = heldLayoutFor(embedding),
  preceding: InlineToken | undefined = undefined,
): { readonly text: string; readonly trailing: InlineToken | undefined } {
  const tokens = tokenizeInline(source, embedding, layout);
  if (
    tokens[0]?.text === "extern"
    && tokens[1]?.text === "js"
    && tokens[2]?.text === "("
    && tokens[3]?.text === ")"
    && tokens[4]
    && isAttachedOpaqueSourcePlaceholder(tokens[4])
  ) {
    tokens.splice(2, 2);
  }
  if (tokens.length === 0) return { text: "", trailing: undefined };
  let output = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (previous && needsSpace(previous, token, next, tokens, index, preceding)) output += " ";
    output += token.element
      ? renderMarkupElement(token.element, layout, layout.column + lastLineWidth(output))
      : token.text;
  }
  // A comment is not part of the expression it sits next to, so it never
  // becomes the context the next line reads.
  return { text: output, trailing: tokens.findLast((token) => token.kind !== "comment") };
}

export function tokenizeInline(
  source: string,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
  layout: MarkupLayout = heldLayoutFor(embedding),
): InlineToken[] {
  const tokens: InlineToken[] = [];
  const genericStack: boolean[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (character === " " || character === "\t") {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      tokens.push({ kind: "comment", text: source.slice(index).trimEnd() });
      break;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = blockCommentEnd(source, index);
      tokens.push({ kind: "comment", text: source.slice(index, end) });
      index = end;
      continue;
    }
    const scannedString = scanStringLiteral(source, index);
    if (scannedString) {
      const start = index;
      index = scannedString.end;
      const formattedString = scannedString.interpolated
        ? formatInterpolatedString(source, start, scannedString, embedding)
        : source.slice(start, index);
      tokens.push({
        kind: "string",
        text: canonicalizeInlineString(formattedString),
      });
      continue;
    }
    if (embedding && character === "<" && beginsEmbeddedAngleSyntax(tokens, source, index)) {
      // D39 §54: an element that both opens and closes on this line is the
      // formatter's to shape. Anything else — an element whose children live on
      // later lines — stays exactly as the author laid it out.
      const scanned = scanMarkupElement(source, index, embedding, layout);
      if (scanned) {
        tokens.push({ kind: "markup", text: source.slice(index, scanned.end), element: scanned.element });
        index = scanned.end;
        continue;
      }
      tokens.push({ kind: "embedded", text: source.slice(index).trimEnd() });
      break;
    }
    if (isSourceIdentifierStart(character)) {
      const start = index++;
      while (index < source.length && isSourceIdentifierPart(source[index]!)) index += 1;
      const value = source.slice(start, index);
      tokens.push({ kind: value === "true" || value === "false" || value === "null" ? "literal" : "word", text: value });
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = index;
      index = numberLiteralEnd(source, index);
      tokens.push({ kind: "literal", text: source.slice(start, index) });
      continue;
    }
    if (character === ">" && genericStack.at(-1) === true) {
      genericStack.pop();
      tokens.push({ kind: "close", text: character, generic: true });
      index += 1;
      continue;
    }
    const operator = multiCharacterOperators.find((candidate) => source.startsWith(candidate, index));
    if (operator) {
      tokens.push({ kind: operator === "?." ? "dot" : "operator", text: operator });
      index += operator.length;
      continue;
    }
    const punctuation = inlinePunctuationKind(character);
    if (punctuation) {
      tokens.push({ kind: punctuation, text: character });
      index += 1;
      continue;
    }
    if (character === "<") {
      const previous = tokens.at(-1);
      const generic = previous?.kind === "word"
        && (genericStack.at(-1) === true
          || beginsTypeBracket(tokens)
          || (opensAnnotatedType(tokens) && closesAsTypeArguments(source, index))
          || opensCallTypeArguments(source, index));
      if (generic) genericStack.push(true);
      tokens.push({ kind: generic ? "open" : "operator", text: character, generic });
      index += 1;
      continue;
    }
    if (character === ">") {
      tokens.push({ kind: "operator", text: character });
      index += 1;
      continue;
    }
    if ("=+-*/%?|".includes(character)) {
      tokens.push({ kind: "operator", text: character });
      index += 1;
      continue;
    }
    tokens.push({ kind: "operator", text: character });
    index += 1;
  }
  return tokens;
}

export function formatInterpolatedString(
  source: string,
  start: number,
  scanned: StringLiteralScan,
  embedding: NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null,
): string {
  if (!scanned.closed) return source.slice(start, scanned.end);
  let output = source.slice(start, scanned.contentStart);
  let index = scanned.contentStart;
  while (index < scanned.contentEnd) {
    const character = source[index]!;
    const next = source[index + 1];
    if (!scanned.raw && character === "\\" && next !== undefined) {
      const escaped = scanStringEscape(source, index, scanned.contentEnd);
      output += source.slice(index, escaped.end);
      index = escaped.end;
      continue;
    }
    if ((character === "{" || character === "}") && next === character) {
      output += `${character}${next}`;
      index += 2;
      continue;
    }
    if (character === "$" && next === "{") {
      const close = source.indexOf("}", index + 2);
      const end = close < 0 || close >= scanned.contentEnd ? Math.min(scanned.contentEnd, index + 2) : close + 1;
      output += source.slice(index, end);
      index = end;
      continue;
    }
    if (character !== "{") {
      output += character;
      index += 1;
      continue;
    }
    const close = findInterpolatedExpressionEnd(source, index + 1, scanned.contentEnd);
    if (close < 0) return source.slice(start, scanned.end);
    output += `{${formatInline(source.slice(index + 1, close).trim(), embedding)}}`;
    index = close + 1;
  }
  return `${output}${source.slice(scanned.contentEnd, scanned.end)}`;
}

export function renderMarkupElement(element: MarkupElement, layout: MarkupLayout, column: number): string {
  const inline = renderInlineMarkup(element, layout);
  if (!layout.breakable || column + inline.length <= FORMAT_PRINT_WIDTH) return inline;
  if (element.selfClosing) return renderMarkupOpenTag(element, layout, column);
  if (!isBreakableMarkup(element)) return inline;
  const indent = " ".repeat(layout.column);
  const childIndent = " ".repeat(layout.column + layout.indentWidth);
  const childLayout = markupLayout(layout.indentWidth, layout.column + layout.indentWidth, layout.embedding);
  const lines = [renderMarkupOpenTag(element, layout, column)];
  for (const child of element.children) {
    if (child.kind === "text") {
      const text = child.text.trim();
      if (text.length > 0) lines.push(`${childIndent}${text}`);
      continue;
    }
    lines.push(`${childIndent}${child.kind === "element"
      ? renderMarkupElement(child.element, childLayout, childLayout.column)
      : renderMarkupExpression(child.text, childLayout)}`);
  }
  lines.push(`${indent}</${element.tag}>`);
  return lines.join("\n");
}

export function renderMarkupOpenTag(element: MarkupElement, layout: MarkupLayout, column: number): string {
  const inline = `<${element.tag}${element.attributes.map((attribute) => ` ${renderMarkupAttribute(attribute, layout)}`).join("")}${element.selfClosing ? " />" : ">"}`;
  if (!layout.breakable || column + inline.length <= FORMAT_PRINT_WIDTH || element.attributes.length === 0) return inline;
  const indent = " ".repeat(layout.column);
  const attributeIndent = " ".repeat(layout.column + layout.indentWidth);
  const attributeLayout = markupLayout(layout.indentWidth, layout.column + layout.indentWidth, layout.embedding);
  return [
    `<${element.tag}`,
    ...element.attributes.map((attribute) => `${attributeIndent}${renderMarkupAttribute(attribute, attributeLayout)}`),
    `${indent}${element.selfClosing ? "/>" : ">"}`,
  ].join("\n");
}

export function renderInlineMarkup(element: MarkupElement, layout: MarkupLayout): string {
  const open = `<${element.tag}${element.attributes.map((attribute) => ` ${renderMarkupAttribute(attribute, layout)}`).join("")}`;
  if (element.selfClosing) return `${open} />`;
  const children = element.children.map((child) => child.kind === "text"
    ? child.text
    : child.kind === "element"
      ? renderInlineMarkup(child.element, layout)
      : renderMarkupExpression(child.text, layout)).join("");
  return `${open}>${children}</${element.tag}>`;
}

export function renderMarkupAttribute(attribute: MarkupAttribute, layout: MarkupLayout): string {
  if (attribute.name === "") return renderMarkupExpression(attribute.value ?? "{}", layout);
  if (attribute.value === null) return attribute.name;
  if (!attribute.value.startsWith("{")) return `${attribute.name}=${attribute.value}`;
  return `${attribute.name}=${renderMarkupExpression(attribute.value, layout)}`;
}

/** Formats the code inside `{...}`; a hole never breaks across lines. */
export function renderMarkupExpression(text: string, layout: MarkupLayout): string {
  return `{${formatInline(text.slice(1, -1).trim(), layout.embedding, heldMarkupLayout(layout))}}`;
}
