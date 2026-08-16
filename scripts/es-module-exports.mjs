/**
 * The names an ES module publishes, read from the module's own export syntax.
 *
 * `scripts/check-runtime-boundary.mjs` used to answer this question with two
 * regular expressions — `^export (async )?(function|const|let|class) NAME` and
 * `^export {...}` — under a comment claiming that nothing else enforced D57
 * rule 140 and that this did. What those two patterns could not see was not a
 * short list: `export var`, `export function*` (the spelling this repository's
 * own `packages/compiler/src/ast.ts` uses), `export const {a, b} = ...`,
 * `export default`, `export * as ns from ...`, and any export that was not
 * flush against column zero. Every one of them would have published a name the
 * gate reported as absent, which is the A-002/A-022 shape again: a regular
 * expression standing in for a grammar, passing green on the forms it happens
 * not to meet.
 *
 * This reads the export forms instead. It is deliberately not a JavaScript
 * parser — it tokenizes far enough to know where a string, comment, template,
 * or regular expression is and how deeply nested a token sits, and then reads
 * the export grammar off the token stream.
 *
 * The boundary, and it is loud rather than silent everywhere it is reached:
 *
 *  - Every form it cannot read is reported through `unreadable` and the caller
 *    fails on it. Nothing is skipped quietly.
 *  - `export * from "..."` cannot be enumerated without resolving the target
 *    module, so it is reported rather than assumed empty.
 *  - An exported variable declaration must end in `;`. Automatic semicolon
 *    insertion would need expression-level parsing to locate the end of an
 *    initializer, and guessing wrong would silently drop the second declarator
 *    of `export const a = f(), b = g()`. Reaching the end of the module without
 *    the terminator is reported.
 *  - A `/` that begins a regular expression is told apart from division by the
 *    preceding token, the usual heuristic. If the tokenizer is nevertheless
 *    misled, nesting no longer balances at the end of the module, and that is
 *    reported too — a module whose structure could not be read never passes as
 *    a module with no exports.
 */

/** @typedef {{ kind: string, value: string, depth: number, start: number }} Token */
/** @typedef {{ reason: string, text: string }} Problem */

// A `/` after one of these keywords starts a regular expression; after any
// other name it is division, because that name is a value.
const KEYWORDS_BEFORE_REGEX = new Set([
  "await", "case", "delete", "do", "else", "in", "instanceof", "new", "of",
  "return", "throw", "typeof", "void", "yield",
]);

/**
 * The names `source` exports, plus every export form this scanner could not
 * read. A caller that ignores `unreadable` has re-created the defect.
 *
 * @param {string} source
 * @returns {{ names: string[], unreadable: Problem[] }}
 */
export function esModuleExports(source) {
  /** @type {Problem[]} */
  const unreadable = [];
  const tokens = tokenize(source, unreadable);
  /** @type {string[]} */
  const names = [];
  const snippet = (index) => {
    const token = tokens[index];
    if (token === undefined) return "";
    return source.slice(token.start, token.start + 72).split("\n")[0] ?? "";
  };
  const report = (reason, index) => unreadable.push({ reason, text: snippet(index) });
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "name" || token.value !== "export" || token.depth !== 0) continue;
    // `object.export` and `object?.export` are member reads, not declarations.
    const previous = tokens[index - 1];
    if (previous !== undefined && previous.kind === "punct" && previous.value === ".") continue;
    readExportClause(tokens, index + 1, names, report);
  }
  return { names, unreadable };
}

/**
 * @param {Token[]} tokens
 * @param {number} at index of the token after `export`
 * @param {string[]} names
 * @param {(reason: string, index: number) => void} report
 */
function readExportClause(tokens, at, names, report) {
  const token = tokens[at];
  if (token === undefined) {
    report("the module ends immediately after 'export'", at - 1);
    return;
  }
  if (token.kind === "punct" && token.value === "*") {
    const next = tokens[at + 1];
    const alias = tokens[at + 2];
    if (next?.kind === "name" && next.value === "as" && (alias?.kind === "name" || alias?.kind === "string")) {
      names.push(alias.kind === "string" ? stringValue(alias.value) : alias.value);
      return;
    }
    report("a star re-export publishes names that cannot be enumerated without resolving the module it names", at - 1);
    return;
  }
  if (token.kind === "punct" && token.value === "{") {
    readNamedExports(tokens, at, names, report);
    return;
  }
  if (token.kind !== "name") {
    report("unreadable export form", at - 1);
    return;
  }
  switch (token.value) {
    case "default":
      names.push("default");
      return;
    case "async": {
      const next = tokens[at + 1];
      if (next?.kind === "name" && next.value === "function") {
        readExportedFunction(tokens, at + 1, names, report);
        return;
      }
      report("unreadable export form after 'export async'", at - 1);
      return;
    }
    case "function":
      readExportedFunction(tokens, at, names, report);
      return;
    case "class": {
      const named = tokens[at + 1];
      if (named?.kind === "name") {
        names.push(named.value);
        return;
      }
      report("an exported class other than 'export default' must be named", at - 1);
      return;
    }
    case "const":
    case "let":
    case "var":
      readDeclarationBindings(tokens, at + 1, token.depth, names, report);
      return;
    default:
      report(`unreadable export form 'export ${token.value}'`, at - 1);
  }
}

/** `export function f`, `export function* g`, `export async function* h`. */
function readExportedFunction(tokens, at, names, report) {
  let cursor = at + 1;
  if (tokens[cursor]?.kind === "punct" && tokens[cursor]?.value === "*") cursor += 1;
  const named = tokens[cursor];
  if (named?.kind === "name") {
    names.push(named.value);
    return;
  }
  report("an exported function other than 'export default' must be named", at - 1);
}

/** `export {a, b as c}` and `export {a} from "..."` — both publish the right-hand names. */
function readNamedExports(tokens, at, names, report) {
  const depth = tokens[at].depth;
  /** @type {Token[]} */
  let entry = [];
  const flush = () => {
    if (entry.length === 0) return;
    const asIndex = entry.findIndex((token) => token.kind === "name" && token.value === "as");
    const exported = asIndex >= 0 ? entry[asIndex + 1] : entry[0];
    if (exported === undefined) return;
    if (exported.kind === "string") names.push(stringValue(exported.value));
    else if (exported.kind === "name") names.push(exported.value);
    entry = [];
  };
  for (let index = at + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.depth === depth && token.kind === "punct" && token.value === "}") {
      flush();
      return;
    }
    if (token.depth === depth + 1 && token.kind === "punct" && token.value === ",") {
      flush();
      continue;
    }
    entry.push(token);
  }
  report("an export list is never closed", at - 1);
}

/**
 * The declarators of `export const|let|var ...`, up to the `;` that ends the
 * declaration. Each declarator's binding may be a name or a destructuring
 * pattern; the initializer between two declarators is skipped by nesting depth.
 */
function readDeclarationBindings(tokens, at, depth, names, report) {
  let index = at;
  for (;;) {
    index = readBindingTarget(tokens, index, names, report);
    if (index < 0) return;
    let separator = null;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token.depth === depth && token.kind === "punct" && (token.value === "," || token.value === ";")) {
        separator = token.value;
        index += 1;
        break;
      }
      index += 1;
    }
    if (separator === null) {
      report("an exported variable declaration must end with ';' for this gate to read its declarators", at - 2);
      return;
    }
    if (separator === ";") return;
  }
}

/** One binding target: a name, an object pattern, or an array pattern. */
function readBindingTarget(tokens, at, names, report) {
  const token = tokens[at];
  if (token === undefined) {
    report("the module ends inside an exported declaration", at - 1);
    return -1;
  }
  if (token.kind === "name") {
    names.push(token.value);
    return at + 1;
  }
  if (token.kind === "punct" && token.value === "{") return readObjectPattern(tokens, at, names, report);
  if (token.kind === "punct" && token.value === "[") return readArrayPattern(tokens, at, names, report);
  report("unreadable binding in an exported declaration", at);
  return -1;
}

function readObjectPattern(tokens, at, names, report) {
  const depth = tokens[at].depth;
  let index = at + 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.depth === depth && token.kind === "punct" && token.value === "}") return index + 1;
    if (token.depth === depth + 1 && token.kind === "punct" && token.value === ",") {
      index += 1;
      continue;
    }
    let cursor = index;
    if (tokens[cursor]?.kind === "punct" && tokens[cursor]?.value === "...") cursor += 1;
    const key = tokens[cursor];
    const after = tokens[cursor + 1];
    const renamed = after?.depth === depth + 1 && after.kind === "punct" && after.value === ":";
    if (key?.kind === "punct" && key.value === "[") {
      // `{[computed]: target}` — the key is an expression, the binding follows.
      const closed = skipToMatching(tokens, cursor);
      if (closed < 0 || tokens[closed]?.value !== ":") {
        report("unreadable computed key in an exported binding pattern", cursor);
        return -1;
      }
      cursor = readBindingTarget(tokens, closed + 1, names, report);
    } else if (renamed) {
      cursor = readBindingTarget(tokens, cursor + 2, names, report);
    } else {
      cursor = readBindingTarget(tokens, cursor, names, report);
    }
    if (cursor < 0) return -1;
    index = skipToEntryEnd(tokens, cursor, depth, "}");
  }
  report("an exported binding pattern is never closed", at);
  return -1;
}

function readArrayPattern(tokens, at, names, report) {
  const depth = tokens[at].depth;
  let index = at + 1;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.depth === depth && token.kind === "punct" && token.value === "]") return index + 1;
    // An elision — `[, second]` — binds nothing.
    if (token.depth === depth + 1 && token.kind === "punct" && token.value === ",") {
      index += 1;
      continue;
    }
    let cursor = index;
    if (tokens[cursor]?.kind === "punct" && tokens[cursor]?.value === "...") cursor += 1;
    cursor = readBindingTarget(tokens, cursor, names, report);
    if (cursor < 0) return -1;
    index = skipToEntryEnd(tokens, cursor, depth, "]");
  }
  report("an exported binding pattern is never closed", at);
  return -1;
}

/** Past a `= default` initializer, to this entry's `,` or the pattern's close. */
function skipToEntryEnd(tokens, at, depth, closer) {
  let index = at;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.depth === depth && token.kind === "punct" && token.value === closer) return index;
    if (token.depth === depth + 1 && token.kind === "punct" && token.value === ",") return index;
    index += 1;
  }
  return index;
}

/** The index after the closer matching the opener at `at`. */
function skipToMatching(tokens, at) {
  const depth = tokens[at].depth;
  for (let index = at + 1; index < tokens.length; index += 1) {
    if (tokens[index].depth === depth && tokens[index].kind === "punct") return index + 1;
  }
  return -1;
}

function stringValue(raw) {
  return raw.slice(1, -1);
}

function isIdentifierStart(code) {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 36 || code === 95 || code > 127;
}

function isIdentifierPart(code) {
  return isIdentifierStart(code) || (code >= 48 && code <= 57);
}

/**
 * Significant tokens, each carrying the `()[]{}` nesting depth it sits at, so a
 * caller can tell a module-level `export` from the word appearing inside a
 * function body, an object literal, a string, or a comment.
 *
 * @param {string} source
 * @param {Problem[]} unreadable
 * @returns {Token[]}
 */
function tokenize(source, unreadable) {
  /** @type {Token[]} */
  const tokens = [];
  let index = 0;
  let depth = 0;
  const fail = (reason, start) => unreadable.push({ reason, text: source.slice(start, start + 72).split("\n")[0] ?? "" });
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 0xfeff) {
      index += 1;
      continue;
    }
    if (code === 47 && source.charCodeAt(index + 1) === 47) {
      while (index < source.length && source.charCodeAt(index) !== 10) index += 1;
      continue;
    }
    if (code === 47 && source.charCodeAt(index + 1) === 42) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) {
        fail("a block comment is never closed", index);
        return tokens;
      }
      index = end + 2;
      continue;
    }
    if (code === 34 || code === 39) {
      const end = readString(source, index);
      if (end < 0) {
        fail("a string literal is never closed", index);
        return tokens;
      }
      tokens.push({ kind: "string", value: source.slice(index, end), depth, start: index });
      index = end;
      continue;
    }
    if (code === 96) {
      const end = readTemplate(source, index);
      if (end < 0) {
        fail("a template literal is never closed", index);
        return tokens;
      }
      tokens.push({ kind: "template", value: "", depth, start: index });
      index = end;
      continue;
    }
    if (code === 47 && regexAllowed(tokens[tokens.length - 1])) {
      const end = readRegex(source, index);
      if (end < 0) {
        fail("a regular expression literal is never closed", index);
        return tokens;
      }
      tokens.push({ kind: "regex", value: "", depth, start: index });
      index = end;
      continue;
    }
    if (isIdentifierStart(code)) {
      let end = index + 1;
      while (end < source.length && isIdentifierPart(source.charCodeAt(end))) end += 1;
      tokens.push({ kind: "name", value: source.slice(index, end), depth, start: index });
      index = end;
      continue;
    }
    if ((code >= 48 && code <= 57) || (code === 46 && source.charCodeAt(index + 1) >= 48 && source.charCodeAt(index + 1) <= 57)) {
      let end = index + 1;
      while (end < source.length && (isIdentifierPart(source.charCodeAt(end)) || source.charCodeAt(end) === 46)) end += 1;
      tokens.push({ kind: "number", value: source.slice(index, end), depth, start: index });
      index = end;
      continue;
    }
    if (code === 123 || code === 40 || code === 91) {
      tokens.push({ kind: "punct", value: source[index], depth, start: index });
      depth += 1;
      index += 1;
      continue;
    }
    if (code === 125 || code === 41 || code === 93) {
      depth -= 1;
      if (depth < 0) {
        fail("more closing brackets than opening ones", index);
        return tokens;
      }
      tokens.push({ kind: "punct", value: source[index], depth, start: index });
      index += 1;
      continue;
    }
    if (code === 46 && source.charCodeAt(index + 1) === 46 && source.charCodeAt(index + 2) === 46) {
      tokens.push({ kind: "punct", value: "...", depth, start: index });
      index += 3;
      continue;
    }
    tokens.push({ kind: "punct", value: source[index], depth, start: index });
    index += 1;
  }
  // A module whose nesting does not balance was misread somewhere, and a
  // misread module would otherwise look like a module with no exports.
  if (depth !== 0) fail(`module nesting does not balance (${depth} unclosed)`, Math.max(0, source.length - 72));
  return tokens;
}

function regexAllowed(previous) {
  if (previous === undefined) return true;
  if (previous.kind === "name") return KEYWORDS_BEFORE_REGEX.has(previous.value);
  if (previous.kind === "number" || previous.kind === "string" || previous.kind === "template" || previous.kind === "regex") return false;
  if (previous.kind === "punct") return previous.value !== ")" && previous.value !== "]";
  return true;
}

function readString(source, start) {
  const quote = source.charCodeAt(start);
  let index = start + 1;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 92) {
      index += 2;
      continue;
    }
    if (code === quote) return index + 1;
    if (code === 10) return -1;
    index += 1;
  }
  return -1;
}

function readTemplate(source, start) {
  let index = start + 1;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 92) {
      index += 2;
      continue;
    }
    if (code === 96) return index + 1;
    if (code === 36 && source.charCodeAt(index + 1) === 123) {
      const end = readSubstitution(source, index + 2);
      if (end < 0) return -1;
      index = end;
      continue;
    }
    index += 1;
  }
  return -1;
}

/** The index after the `}` closing a `${...}` substitution. */
function readSubstitution(source, start) {
  let index = start;
  let braces = 0;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 125) {
      if (braces === 0) return index + 1;
      braces -= 1;
      index += 1;
      continue;
    }
    if (code === 123) {
      braces += 1;
      index += 1;
      continue;
    }
    if (code === 96) {
      const end = readTemplate(source, index);
      if (end < 0) return -1;
      index = end;
      continue;
    }
    if (code === 34 || code === 39) {
      const end = readString(source, index);
      if (end < 0) return -1;
      index = end;
      continue;
    }
    if (code === 47 && source.charCodeAt(index + 1) === 47) {
      while (index < source.length && source.charCodeAt(index) !== 10) index += 1;
      continue;
    }
    if (code === 47 && source.charCodeAt(index + 1) === 42) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) return -1;
      index = end + 2;
      continue;
    }
    index += 1;
  }
  return -1;
}

function readRegex(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const code = source.charCodeAt(index);
    if (code === 92) {
      index += 2;
      continue;
    }
    if (code === 10) return -1;
    if (code === 91) inClass = true;
    else if (code === 93) inClass = false;
    else if (code === 47 && !inClass) {
      index += 1;
      while (index < source.length && isIdentifierPart(source.charCodeAt(index))) index += 1;
      return index;
    }
    index += 1;
  }
  return -1;
}
