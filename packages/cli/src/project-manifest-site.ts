import type { Span } from "@velarscript/compiler";
import type { VelarProjectConfig } from "./config.ts";

/**
 * GA-D2 / GA-I4: where in `velar.json` a project-level rule is about.
 *
 * A rule about how the project is *arranged* has a site the same way a rule
 * about a module does — it is a line the author wrote, and until it had one,
 * a missing entry file reported a bare Node `ENOENT` string with no code, no
 * position and the path printed twice. The manifest is JSON rather than
 * VelarScript, so the position has to be read out of its bytes; the compiler's
 * `SourceText` turns the span into `line:column` and prints the code frame from
 * there, exactly as it does for a `.vel` module.
 *
 * The manifest this reads has already been parsed by `loadManifest`, so this is
 * a locator and not a validator: anything it cannot make sense of is answered
 * with `null`, and the caller reports without a position rather than guessing
 * one. It never consumes a character without advancing, so no input loops.
 */
export interface ProjectManifestSite {
  /** The key's text, quotes excluded. */
  readonly key: Span;
  /** The value the key names — text values exclude their quotes. */
  readonly value: Span;
}

/** The bytes a project-level report positions itself in, or null for a bare `.vel` file. */
export interface ProjectManifestBytes {
  readonly path: string;
  readonly text: string;
}

/**
 * The manifest a compile of this project can report an arrangement rule
 * against. A bare `.vel` file has none, and every such rule is about something
 * a manifest declares, so nothing is reported for one.
 */
export function projectManifestBytes(config: VelarProjectConfig): ProjectManifestBytes | null {
  return config.manifestPath !== null && config.manifestSource !== null
    ? { path: config.manifestPath, text: config.manifestSource }
    : null;
}

interface Cursor {
  index: number;
}

/**
 * The site of one key path — `["entry"]`, `["server", "configuration"]` — in a
 * manifest's exact bytes, or null when the manifest does not spell it that way.
 * The last occurrence wins, like `JSON.parse`; escaped property names are
 * compared after decoding, while reported spans retain the author's bytes.
 */
export function projectManifestSite(text: string, path: readonly string[]): ProjectManifestSite | null {
  if (path.length === 0 || text.length === 0) return null;
  const cursor: Cursor = { index: 0 };
  skipSpace(text, cursor);
  return locateInValue(text, cursor, path);
}

/** Finds `path` inside the value at the cursor, leaving the cursor past that value. */
function locateInValue(text: string, cursor: Cursor, path: readonly string[]): ProjectManifestSite | null {
  if (text[cursor.index] !== "{") {
    skipValue(text, cursor);
    return null;
  }
  cursor.index += 1;
  let found: ProjectManifestSite | null = null;
  while (cursor.index < text.length) {
    skipSpace(text, cursor);
    const character = text[cursor.index];
    if (character === undefined || character === "}") {
      cursor.index += 1;
      return found;
    }
    if (character === ",") {
      cursor.index += 1;
      continue;
    }
    const key = scanString(text, cursor);
    if (key === null) return found;
    skipSpace(text, cursor);
    if (text[cursor.index] !== ":") return found;
    cursor.index += 1;
    skipSpace(text, cursor);
    const start = cursor.index;
    const name = JSON.parse(text.slice(key.start - 1, key.end + 1)) as string;
    if (name !== path[0]) {
      skipValue(text, cursor);
      continue;
    }
    if (path.length === 1) {
      skipValue(text, cursor);
      found = { key, value: valueSpan(text, start, cursor.index) };
      continue;
    }
    const nested = locateInValue(text, cursor, path.slice(1));
    found = nested;
  }
  return found;
}

/** A text value is marked without its quotes; every other value is marked whole. */
function valueSpan(text: string, start: number, end: number): Span {
  const bounded = { start, end: Math.max(start, end) };
  if (text[bounded.start] !== "\"" || bounded.end - bounded.start < 2) return bounded;
  return { start: bounded.start + 1, end: bounded.end - 1 };
}

function skipSpace(text: string, cursor: Cursor): void {
  while (cursor.index < text.length && /\s/u.test(text[cursor.index]!)) cursor.index += 1;
}

/** The span of a quoted string's contents; the cursor ends past the closing quote. */
function scanString(text: string, cursor: Cursor): Span | null {
  if (text[cursor.index] !== "\"") return null;
  const start = cursor.index + 1;
  let index = start;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "\"") {
      cursor.index = index + 1;
      return { start, end: index };
    }
    index += 1;
  }
  return null;
}

function skipValue(text: string, cursor: Cursor): void {
  const character = text[cursor.index];
  if (character === "\"") {
    if (scanString(text, cursor) === null) cursor.index = text.length;
    return;
  }
  if (character === "{" || character === "[") {
    skipBracketed(text, cursor);
    return;
  }
  while (cursor.index < text.length && !",}]".includes(text[cursor.index]!) && !/\s/u.test(text[cursor.index]!)) {
    cursor.index += 1;
  }
}

/** Skips a whole object or array, stepping over any string that contains a brace. */
function skipBracketed(text: string, cursor: Cursor): void {
  let depth = 0;
  while (cursor.index < text.length) {
    const character = text[cursor.index];
    if (character === "\"") {
      if (scanString(text, cursor) === null) cursor.index = text.length;
      continue;
    }
    if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") depth -= 1;
    cursor.index += 1;
    if (depth === 0) return;
  }
}
