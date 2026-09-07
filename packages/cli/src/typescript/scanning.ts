/**
 * Reading a declaration file as text: stripping what is not a declaration, and
 * splitting what is. Every reader in `typescript/` sits on these — they know
 * quoting, nesting and the terminators a `.d.ts` actually uses, and nothing
 * about types.
 */

/**
 * Finds the closing quote of the string literal that opens at `start`, or the
 * last character it can belong to when the literal is never closed.
 */
function closingQuote(source: string, start: number): number {
  const quote = source[start]!;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === quote) return index;
    if (quote !== "`" && character === "\n") return index - 1;
  }
  return source.length - 1;
}

/**
 * Removes comments from a declaration file without disturbing string literal
 * types. A `.d.ts` routinely writes `/*`, `*` + `/` or `//` inside a string
 * literal type — URL literals, glob literals, template literal types — and a
 * regex stripper eats every real declaration between two of them with no word
 * to the author. Comment bytes become spaces so that every offset recorded
 * against the result still addresses the same character of `source`.
 */
export function stripDeclarationComments(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (character === "\"" || character === "'" || character === "`") {
      const end = closingQuote(source, index);
      output += source.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      const end = close < 0 ? source.length : close + 2;
      output += " ".repeat(end - index);
      index = end;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      let end = index;
      while (end < source.length && source[end] !== "\n") end += 1;
      output += " ".repeat(end - index);
      index = end;
      continue;
    }
    output += character;
    index += 1;
  }
  return output;
}

const ambientBlockPattern =
  /(?:^|[;{}\r\n])[\t ]*((?:export\s+)?declare\s+(?:global|namespace\s+[A-Za-z_$][\w$.]*|module\s+(?:"[^"\r\n]*"|'[^'\r\n]*'|[A-Za-z_$][\w$.]*))|(?:export\s+)?(?:namespace|module)\s+[A-Za-z_$][\w$.]*)\s*\{/gu;

/**
 * Blanks `declare global`, `declare namespace X` and `declare module "x"`
 * bodies. The declaration sweeps have no concept of a nested declaration
 * scope, so without this an `export` inside one of these blocks is read as a
 * module export the package does not have — a clean `velar check` that links
 * to a host `SyntaxError` at run time. The span becomes spaces rather than
 * disappearing so recorded offsets stay valid, and each excised block is
 * reported.
 *
 * `ownModules` names the specifiers this file is the declaration for. A
 * `declare module "self"` block is that package's own contract in the legacy
 * ambient spelling, so only its head and braces are blanked and its members
 * stay module members.
 */
export function excludeAmbientBlocks(source: string, warnings: string[], ownModules: ReadonlySet<string> = new Set()): string {
  let text = source;
  let blankedUntil = 0;
  for (const match of source.matchAll(ambientBlockPattern)) {
    const head = match[1]!;
    const start = match.index + match[0].indexOf(head);
    if (start < blankedUntil) continue;
    const open = match.index + match[0].length - 1;
    const close = matchingDelimiter(source, open, "{", "}");
    const end = close < 0 ? source.length : close + 1;
    const label = head.replace(/\s+/gu, " ");
    const declaredModule = /^(?:export\s+)?declare\s+module\s+["'](.+)["']$/u.exec(label);
    if (declaredModule && ownModules.has(declaredModule[1]!) && close >= 0) {
      // The kept body is swept again rather than left to this loop, because a
      // block nested on the same line as this one has no statement start in
      // front of it once the outer match has consumed the opening brace.
      text = `${text.slice(0, start)}${" ".repeat(open + 1 - start)}${excludeAmbientBlocks(text.slice(open + 1, close), warnings, ownModules)} ${text.slice(close + 1)}`;
      blankedUntil = close + 1;
      continue;
    }
    warnings.push(close < 0
      ? `Ambient '${label}' block has an unclosed body, so it and the rest of the declaration file were ignored`
      : `Ambient '${label}' block is outside the VelarScript declaration bridge and its declarations were ignored`);
    text = text.slice(0, start) + " ".repeat(end - start) + text.slice(end);
    blankedUntil = end;
  }
  return text;
}

export function matchingDelimiter(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close && --depth === 0) return index;
  }
  return -1;
}

export function topLevelTerminator(source: string, start: number, terminator: string): number {
  let round = 0;
  let square = 0;
  let brace = 0;
  let angle = 0;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") quote = character;
    else if (character === "(") round += 1;
    else if (character === ")") round = Math.max(0, round - 1);
    else if (character === "[") square += 1;
    else if (character === "]") square = Math.max(0, square - 1);
    else if (character === "{") brace += 1;
    else if (character === "}") brace = Math.max(0, brace - 1);
    else if (character === "<") angle += 1;
    else if (character === ">") angle = Math.max(0, angle - 1);
    else if (character === terminator && round === 0 && square === 0 && brace === 0 && angle === 0) return index;
  }
  return -1;
}

/**
 * Text that starts a fresh interface, object type, or class member. A body may
 * terminate its members with semicolons, with newlines, or with a mix of the
 * two, so a newline ends a member only when what follows opens a new one
 * rather than continuing the type that is being written.
 */
const memberHeadPattern =
  /^(?:(?:readonly|public|private|protected|static|override|abstract|declare)\s+)*(?:new\s*\(|constructor\s*\(|(?:get|set)\s+[A-Za-z_$][\w$]*\s*\(|\[|\(|<|[A-Za-z_$][\w$]*\s*\??\s*[:(<]|["'][^"'\r\n]*["']\s*\??\s*[:(])/u;

/**
 * Reports whether a member that reads as `pending` is plainly unfinished, so a
 * newline inside it is a wrap rather than a terminator.
 */
function memberContinues(pending: string): boolean {
  const trimmed = pending.trimEnd();
  if (!trimmed) return true;
  if (trimmed.endsWith("=>")) return true;
  if (/\b(?:extends|keyof|typeof|infer|in|is|new|readonly)$/u.test(trimmed)) return true;
  return /[:,|&=<([{?+\-.]$/u.test(trimmed);
}

/**
 * Splits a declaration body into members on its real terminators: a top-level
 * `;` or `,`, or a top-level newline that separates a finished member from the
 * head of the next one. Choosing one separator for the whole body glues the
 * member after a semicolon-less method onto it, which deletes that member from
 * the package's contract without a word.
 */
export function splitFields(source: string): string[] {
  const output: string[] = [];
  let start = 0;
  let angle = 0;
  let round = 0;
  let square = 0;
  let brace = 0;
  let quote = "";
  const take = (end: number): void => {
    const member = source.slice(start, end).trim();
    if (member) output.push(member);
    start = end + 1;
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") quote = character;
    else if (character === "<") angle += 1;
    else if (character === ">") angle = Math.max(0, angle - 1);
    else if (character === "(") round += 1;
    else if (character === ")") round = Math.max(0, round - 1);
    else if (character === "[") square += 1;
    else if (character === "]") square = Math.max(0, square - 1);
    else if (character === "{") brace += 1;
    else if (character === "}") brace = Math.max(0, brace - 1);
    else if (angle === 0 && round === 0 && square === 0 && brace === 0) {
      if (character === ";" || character === ",") take(index);
      else if (character === "\n"
        && !memberContinues(source.slice(start, index))
        && memberHeadPattern.test(source.slice(index + 1).trimStart())) {
        take(index);
      }
    }
  }
  const last = source.slice(start).trim();
  if (last) output.push(last);
  return output;
}

export function splitTopLevel(source: string, separator: string): string[] {
  const output: string[] = [];
  let start = 0;
  let angle = 0;
  let round = 0;
  let square = 0;
  let brace = 0;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") quote = character;
    else if (character === "<") angle += 1;
    else if (character === ">") angle = Math.max(0, angle - 1);
    else if (character === "(") round += 1;
    else if (character === ")") round = Math.max(0, round - 1);
    else if (character === "[") square += 1;
    else if (character === "]") square = Math.max(0, square - 1);
    else if (character === "{") brace += 1;
    else if (character === "}") brace = Math.max(0, brace - 1);
    else if (character === separator && angle === 0 && round === 0 && square === 0 && brace === 0) {
      output.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  output.push(source.slice(start).trim());
  return output.filter(Boolean);
}

export function balanced(value: string): boolean {
  let depth = 0;
  for (const character of value) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}
