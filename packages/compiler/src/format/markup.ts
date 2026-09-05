/**
 * The angle-bracket element form a target may activate: what one element is,
 * how deep a nest may go, and whether it may be broken across lines. Core owns
 * the shape and the layout; the target owns the vocabulary of tag names, which
 * never reaches this module.
 *
 * D115 §三 / D114 R1f: the markup half of `formatter.ts`. It is spelled
 * `markup` and not after any target's name, because Core must not embed a
 * target-owned word (`check:boundaries`).
 */
import type { CompilerExtension } from "../extension.ts";
import { findInterpolatedExpressionEnd } from "../interpolated-string.ts";

/**
 * D39 §54 — the canonical shape of embedded angle-bracket markup.
 *
 * The formatter reflows one thing and only one thing: an element that both
 * opens and closes on a single physical line. Such an element is written on one
 * line while it fits inside the print width, and takes the block shape — open
 * tag, one child per line indented one level, closing tag at the element's own
 * indentation — as soon as it does not. Attributes follow the same rule one
 * level down: they stay on the open tag until the open tag alone overflows,
 * and then take one line each.
 *
 * Two rules keep this a layout change and never a rendering change:
 *
 *  - Whitespace between children is program text. Markup drops a line break
 *    with its surrounding indentation but keeps a written space, so an element
 *    whose children carry meaningful spaces is never broken, and text is never
 *    re-wrapped or re-spaced.
 *  - Markup the author already spread across lines keeps its line structure,
 *    exactly like every other construct in the language: the formatter
 *    canonicalizes spelling, not the author's line breaks.
 */
export const MAX_MARKUP_DEPTH = 48;

export type MarkupEmbedding = NonNullable<CompilerExtension["formatting"]>["angleBracketEmbedding"] | null;

export interface MarkupLayout {
  readonly indentWidth: number;
  /** The canonical indentation column of the line the markup starts on. */
  readonly column: number;
  /** False inside a string interpolation, where a line break would change the string. */
  readonly breakable: boolean;
  readonly embedding: MarkupEmbedding;
}

/**
 * The layout of markup that cannot take a line of its own — inside a string
 * interpolation, or inside a `{...}` hole. It still carries the embedding, so
 * markup nested further in is recognized as markup rather than re-spaced as
 * comparison operators.
 */
export function heldLayoutFor(embedding: MarkupEmbedding): MarkupLayout {
  return { indentWidth: 4, column: 0, breakable: false, embedding };
}

export function markupLayout(indentWidth: number, column: number, embedding: MarkupEmbedding): MarkupLayout {
  return { indentWidth, column, breakable: true, embedding };
}

export function heldMarkupLayout(layout: MarkupLayout): MarkupLayout {
  return { ...layout, breakable: false };
}

export interface MarkupAttribute {
  /** The attribute name, or "" for a `{...spread}` attribute. */
  readonly name: string;
  /** The written value including its quotes or braces, or null for a bare attribute. */
  readonly value: string | null;
}

export type MarkupChild =
  | { readonly kind: "element"; readonly element: MarkupElement }
  | { readonly kind: "expression"; readonly text: string }
  | { readonly kind: "text"; readonly text: string };

export interface MarkupElement {
  readonly tag: string;
  readonly attributes: readonly MarkupAttribute[];
  readonly children: readonly MarkupChild[];
  readonly selfClosing: boolean;
}

/**
 * Reads one balanced element starting at `<`. It returns null the moment the
 * element is not complete and unambiguous within `source` — an unclosed
 * element, a mismatched closing tag, an HTML comment, an unterminated string or
 * expression — and the caller then leaves the text exactly as written.
 */
export function scanMarkupElement(
  source: string,
  start: number,
  embedding: MarkupEmbedding,
  layout: MarkupLayout,
  depth = 0,
): { readonly element: MarkupElement; readonly end: number } | null {
  if (depth > MAX_MARKUP_DEPTH || source[start] !== "<") return null;
  let index = start + 1;
  const nameStart = index;
  while (index < source.length && /[A-Za-z0-9_.:-]/u.test(source[index]!)) index += 1;
  const tag = source.slice(nameStart, index);
  if (!tag && source[index] !== ">") return null;

  const attributes: MarkupAttribute[] = [];
  let selfClosing = false;
  let closed = false;
  while (index < source.length) {
    while (index < source.length && /\s/u.test(source[index]!)) index += 1;
    if (source.startsWith("/>", index)) {
      index += 2;
      selfClosing = true;
      closed = true;
      break;
    }
    if (source[index] === ">") {
      index += 1;
      closed = true;
      break;
    }
    if (source[index] === "{") {
      const end = findInterpolatedExpressionEnd(source, index + 1);
      if (end < 0) return null;
      attributes.push({ name: "", value: source.slice(index, end + 1) });
      index = end + 1;
      continue;
    }
    const attributeStart = index;
    while (index < source.length && /[A-Za-z0-9_.:-]/u.test(source[index]!)) index += 1;
    const name = source.slice(attributeStart, index);
    if (!name) return null;
    let cursor = index;
    while (cursor < source.length && /[ \t]/u.test(source[cursor]!)) cursor += 1;
    if (source[cursor] !== "=") {
      attributes.push({ name, value: null });
      continue;
    }
    cursor += 1;
    while (cursor < source.length && /[ \t]/u.test(source[cursor]!)) cursor += 1;
    if (source[cursor] === '"' || source[cursor] === "'") {
      const quote = source[cursor]!;
      const close = source.indexOf(quote, cursor + 1);
      if (close < 0) return null;
      attributes.push({ name, value: source.slice(cursor, close + 1) });
      index = close + 1;
      continue;
    }
    if (source[cursor] === "{") {
      const end = findInterpolatedExpressionEnd(source, cursor + 1);
      if (end < 0) return null;
      attributes.push({ name, value: source.slice(cursor, end + 1) });
      index = end + 1;
      continue;
    }
    return null;
  }
  if (!closed) return null;
  if (selfClosing || (tag !== "" && tag === tag.toLowerCase() && embedding?.voidElements?.has(tag) === true)) {
    return { element: { tag, attributes, children: [], selfClosing: true }, end: index };
  }

  const children: MarkupChild[] = [];
  while (index < source.length && !source.startsWith("</", index)) {
    if (source.startsWith("<!--", index)) return null;
    if (source[index] === "<") {
      const child = scanMarkupElement(source, index, embedding, layout, depth + 1);
      if (!child) return null;
      children.push({ kind: "element", element: child.element });
      index = child.end;
      continue;
    }
    if (source[index] === "{") {
      const end = findInterpolatedExpressionEnd(source, index + 1);
      if (end < 0) return null;
      children.push({ kind: "expression", text: source.slice(index, end + 1) });
      index = end + 1;
      continue;
    }
    const textStart = index;
    while (index < source.length && source[index] !== "<" && source[index] !== "{") index += 1;
    children.push({ kind: "text", text: source.slice(textStart, index) });
  }
  if (!source.startsWith("</", index)) return null;
  index += 2;
  const closingStart = index;
  while (index < source.length && /[A-Za-z0-9_.:-]/u.test(source[index]!)) index += 1;
  if (source.slice(closingStart, index) !== tag) return null;
  while (index < source.length && /\s/u.test(source[index]!)) index += 1;
  if (source[index] !== ">") return null;
  return { element: { tag, attributes, children, selfClosing: false }, end: index + 1 };
}

/**
 * An element breaks between children only when it has no text child at all —
 * when it is a container of elements and holes rather than a piece of written
 * content.
 *
 * That is one line drawn for two reasons at once. It is the safe line: markup
 * renders a written space between children but not a line break with its
 * indentation, so any text child (even a bare "/" separator) could change what
 * the page shows if the boundaries around it moved. It is also the readable
 * line: a sentence belongs on its line, not spread one word and one hole at a
 * time.
 */
export function isBreakableMarkup(element: MarkupElement): boolean {
  if (element.selfClosing || element.children.length === 0) return false;
  return element.children.every((child) => child.kind !== "text" || child.text.trim() === child.text);
}
