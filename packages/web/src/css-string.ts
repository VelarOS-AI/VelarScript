/**
 * CSS string serialization.
 *
 * A Look string value reaches CSS as a CSS string, and JSON is not that
 * serialization. The two agree on `"` and `\` and on nothing else: JSON writes
 * a newline as `\n` and a tab as `\t`, while CSS reads `\` followed by a
 * non-hex-digit as that literal character, so `\n` renders the letter `n` and
 * the line break is silently lost. CSS spells a code point as `\` plus its hex
 * digits, terminated by one space. D51 rule 112.3 already recorded that the
 * JSON string rule was insufficient and that explicit target-aware escaping is
 * the fix; this is that escaping for the CSS target.
 *
 * Both the compile-time lowering and the emitted runtime need the same
 * serialization, so this module publishes one implementation and one copy of
 * its source: `cssString` for the compiler, `CSS_STRING_RUNTIME` for the
 * runtime body the emitter ships.
 */

/**
 * `value` as a complete double-quoted CSS string, quotes included, so this is
 * a drop-in replacement for `JSON.stringify` wherever a CSS string was meant.
 * Only `"`, `\`, the C0 controls, and U+007F need escaping; every other code
 * point, `•` and an emoji alike, is literal text in a UTF-8 stylesheet.
 */
export function cssString(value: string): string {
  let text = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (character === "\"" || character === "\\") {
      text += `\\${character}`;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      // The terminating space is part of the escape: without it `\A` followed
      // by a hex digit would read as one longer code point.
      text += `\\${code.toString(16).toUpperCase()} `;
      continue;
    }
    text += character;
  }
  return `"${text}"`;
}

/**
 * `cssString` written as emitted-runtime JavaScript. The runtime spelling and
 * the compile-time spelling must produce the same text for the same input —
 * a Look string folded at compile time and the same string pushed through the
 * runtime are the same declaration — so they are published together.
 */
export const CSS_STRING_RUNTIME = String.raw`
function __velarCssString(value) {
  let text = "";
  for (const character of value) {
    const code = character.codePointAt(0);
    if (character === "\"" || character === "\\") {
      text += "\\" + character;
      continue;
    }
    if (code < 0x20 || code === 0x7f) {
      text += "\\" + code.toString(16).toUpperCase() + " ";
      continue;
    }
    text += character;
  }
  return "\"" + text + "\"";
}
`;
