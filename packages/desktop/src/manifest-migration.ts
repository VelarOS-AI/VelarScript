import { DESKTOP_MAIN_WINDOW_KIND } from "./config.ts";

/**
 * The `desktop.window` → `desktop.windows.main` rewrite `velar fix` applies.
 *
 * A manifest is the author's file, not generated output, so the migration is a
 * surgical text edit rather than a reparse-and-reserialize: everything outside
 * the one member keeps its bytes, including comments-free formatting choices
 * this repository does not own, key order, and indentation width. The member is
 * located by walking the JSON itself — never by searching for the text
 * `"window"`, which also appears in product names, titles and network origins.
 *
 * Returns the migrated text, or null when this manifest needs no migration.
 */
export function migrateDesktopManifestText(text: string): string | null {
  let manifest: unknown;
  try { manifest = JSON.parse(text); }
  catch { return null; }
  if (!isJsonObject(manifest)) return null;
  const desktop = manifest.desktop;
  // A manifest that already carries `windows` is migrated; one that carries
  // both is a hand-edit this rewrite must not silently pick a winner for, so
  // it is left for `desktop.window`'s own check-time error to report.
  if (!isJsonObject(desktop) || desktop.window === undefined || desktop.windows !== undefined) return null;
  const desktopSpan = memberSpan(text, skipWhitespace(text, 0), "desktop");
  if (!desktopSpan) return null;
  const windowSpan = memberSpan(text, desktopSpan.valueStart, "window");
  if (!windowSpan) return null;

  const value = text.slice(windowSpan.valueStart, windowSpan.valueEnd);
  const memberIndent = lineIndent(text, windowSpan.keyStart);
  const step = indentStep(text, windowSpan.valueStart, memberIndent);
  const wrapped = step === null
    // A single-line manifest keeps its one line.
    ? `{${JSON.stringify(DESKTOP_MAIN_WINDOW_KIND)}: ${value}}`
    : `{\n${memberIndent}${step}${JSON.stringify(DESKTOP_MAIN_WINDOW_KIND)}: ${indentBlock(value, step)}\n${memberIndent}}`;
  return text.slice(0, windowSpan.keyStart)
    + JSON.stringify("windows")
    + text.slice(windowSpan.keyEnd, windowSpan.valueStart)
    + wrapped
    + text.slice(windowSpan.valueEnd);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface MemberSpan {
  readonly keyStart: number;
  readonly keyEnd: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

/** The span of one member of the JSON object that starts at `start`. */
function memberSpan(text: string, start: number, name: string): MemberSpan | null {
  if (text[start] !== "{") return null;
  let index = skipWhitespace(text, start + 1);
  while (index < text.length && text[index] !== "}") {
    const key = valueSpan(text, index);
    if (text[key.start] !== "\"") return null;
    const separator = skipWhitespace(text, key.end);
    if (text[separator] !== ":") return null;
    const value = valueSpan(text, skipWhitespace(text, separator + 1));
    if (JSON.parse(text.slice(key.start, key.end)) === name) {
      return { keyStart: key.start, keyEnd: key.end, valueStart: value.start, valueEnd: value.end };
    }
    index = skipWhitespace(text, value.end);
    if (text[index] === ",") index = skipWhitespace(text, index + 1);
  }
  return null;
}

/** The half-open span of the JSON value that starts at `start`. */
function valueSpan(text: string, start: number): { readonly start: number; readonly end: number } {
  const character = text[start];
  if (character === "\"") {
    let index = start + 1;
    while (index < text.length) {
      if (text[index] === "\\") index += 2;
      else if (text[index] === "\"") return { start, end: index + 1 };
      else index += 1;
    }
    return { start, end: text.length };
  }
  if (character === "{" || character === "[") {
    let depth = 0;
    let index = start;
    while (index < text.length) {
      const current = text[index];
      if (current === "\"") {
        index = valueSpan(text, index).end;
        continue;
      }
      if (current === "{" || current === "[") depth += 1;
      else if (current === "}" || current === "]") {
        depth -= 1;
        if (depth === 0) return { start, end: index + 1 };
      }
      index += 1;
    }
    return { start, end: text.length };
  }
  let index = start;
  while (index < text.length && !",}] \t\r\n".includes(text[index]!)) index += 1;
  return { start, end: index };
}

function skipWhitespace(text: string, index: number): number {
  while (index < text.length && " \t\r\n".includes(text[index]!)) index += 1;
  return index;
}

/** The whitespace that opens the line `index` sits on. */
function lineIndent(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const line = text.slice(start, index);
  return /^[ \t]*$/u.test(line) ? line : "";
}

/**
 * The manifest's own indentation step, read from the first member of the
 * object being wrapped, or null when that object is written on one line.
 */
function indentStep(text: string, objectStart: number, memberIndent: string): string | null {
  const inner = text.slice(objectStart + 1);
  const match = /^[^\S\n]*\n([ \t]*)\S/u.exec(inner);
  if (!match) return null;
  const indent = match[1]!;
  return indent.startsWith(memberIndent) && indent.length > memberIndent.length ? indent.slice(memberIndent.length) : "  ";
}

/** Re-indents an already-formatted JSON value one step deeper. */
function indentBlock(value: string, step: string): string {
  return value.split("\n").map((line, index) => index === 0 || line.length === 0 ? line : `${step}${line}`).join("\n");
}
