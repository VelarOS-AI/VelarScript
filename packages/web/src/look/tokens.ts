/**
 * Checked design-token references (D103): what a token name is, what it lowers
 * to, and how a written `var(--name)` is read back.
 */
// ── D103: checked design-token references ─────────────────────────────────────
// A design system's contract is a set of CSS custom properties, and the checked
// Look value vocabulary had no spelling that could read one: the colour kinds
// passed an arbitrary string through, the free-text kinds passed anything
// through, and every metric, shadow and transition property refused. `token()`
// is the one spelling, legal wherever a Look value is written.
//
// What is checked is the *reference* — its spelling and its position. The value
// behind the name belongs to the design system, which the compiler cannot see:
// no `@velaros-ai/ui` stylesheet is an input to this compile. That boundary is
// declared rather than papered over, and it is exactly why the name must be a
// literal: a computed name would leave nothing checkable at all.

/**
 * A CSS custom property identifier, as a Look token name. `--` and at least one
 * more character, from the ASCII ident set a design system's tokens are written
 * with. CSS itself also admits non-ASCII ident code points and backslash
 * escapes; both are outside this set on purpose, because the text goes straight
 * into a compiler-owned stylesheet where an escape is a way out of the
 * declaration (the same reasoning LOK-U9 applies to `keyframes:` values).
 */
export const LOOK_TOKEN_NAME_PATTERN = /^--[A-Za-z0-9_-]+$/u;

/** The whole rule, in the terms a diagnostic teaches it. */
export const LOOK_TOKEN_NAME_RULE = "a design token name is a literal string holding a CSS custom property identifier: '--' followed by one or more letters, digits, hyphens, or underscores";

/**
 * D103 rule 5 — why there is no second parameter. A design token is the design
 * system's closed contract; a token that is missing is a defect in that system,
 * to be fixed once where it is defined, rather than a decision each of hundreds
 * of use sites re-makes for itself. A per-site fallback would also be the one
 * part of the reference the compiler could neither see nor check.
 */
export const LOOK_TOKEN_NO_FALLBACK_GUIDANCE = "token(name) takes the token name and nothing else: a design token is the design system's closed contract, so a token that is missing is a defect to fix where the token is defined rather than a fallback decided again at every use site";

export function isLookTokenName(name: string): boolean {
  return LOOK_TOKEN_NAME_PATTERN.test(name);
}

/** The CSS text a checked token reference lowers to. */
export function lookTokenReference(name: string): string {
  return `var(${name})`;
}

/**
 * The token name a whole `var(--name)` string names, or null. Only the complete
 * value is read: `var()` inside a larger value — the tail of a font stack, one
 * layer of a filter — is a legitimate free-text spelling with no single token
 * to rewrite it to, so it is not this function's business. A `var(--x, red)`
 * fallback form answers null here and is diagnosed by its own message, because
 * the closed contract above has no fallback to migrate it to.
 */
export function lookVarReferenceName(text: string): string | null {
  const match = /^\s*var\(\s*(--[A-Za-z0-9_-]+)\s*\)\s*$/u.exec(text);
  return match ? match[1]! : null;
}

/** Whether a whole string is a `var(...)` reference of any shape, fallback included. */
export function isLookVarReference(text: string): boolean {
  return /^\s*var\(\s*--/u.test(text) && /\)\s*$/u.test(text);
}
