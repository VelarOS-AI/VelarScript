/**
 * Where a `look:` or `keyframes:` block is written, read from the token stream.
 *
 * D115 §三: the rule lives beside the parser rather than inside it, because it
 * is one decision — which of four shapes an opener is in — and the parser's two
 * block expressions ask it the same way.
 */

/**
 * The shape a `look:`/`keyframes:` opener is written in.
 *
 * D114 0.29.0 LK-I1: charter §17 says the block is a value, written wherever a
 * value is written — after `=`, after `return`, and inside a call, a collection
 * or a record — and names that as the same table that decides whether `<` opens
 * an element. A bracket suspends newlines and indentation (charter §2), so in
 * an argument, a collection element or a record value the block token stands
 * directly after the ':' with no layout tokens at all, while a statement-level
 * one is introduced by them.
 *
 * `none` covers both "no block here at all" and a `look:` written where a value
 * may not begin — an `if` condition, say. The lexer opens the block only in a
 * value position, so an indented body with no block token behind it is that
 * mistake, and reading on as though the block were there turned one mistake
 * into four diagnostics; the opener's own message names the whole spelling.
 */
export type VisualBlockLayout = "bracketed" | "indented" | "empty" | "none";

/** `kindAt(0)` is the token after the opener's word — the ':' when there is one. */
export function visualBlockLayout(kindAt: (distance: number) => string): VisualBlockLayout {
  if (kindAt(0) !== "colon") return "none";
  if (kindAt(1) === "extensionToken") return "bracketed";
  if (kindAt(1) !== "newline") return "none";
  let ahead = 1;
  while (kindAt(ahead) === "newline") ahead += 1;
  if (kindAt(ahead) !== "indent") return "empty";
  return kindAt(ahead + 1) === "extensionToken" ? "indented" : "none";
}
