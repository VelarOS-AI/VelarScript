import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * D115 §一.1 and §二 — a file an agent can read in one `Read`, a function it can
 * read in one screen.
 *
 * The maintainer of this repository is a model, and a model does not complain
 * about a 17,485-line file: it works around it. It reads a window, edits what
 * it can see, and never learns what the other 17,000 lines already decided.
 * Every defect family AGENTS.md names — one concept with two definitions, a
 * promise wider than the code, the example fixed and the class left open — is
 * cheaper to commit in a file nobody read to the end. So the budgets are not a
 * style preference; they are the precondition for the review that catches those
 * three shapes at all.
 *
 *   - a source file under `packages/<package>/src` or a test file under `tests/`
 *     is at most **800 lines**;
 *   - a function, method, constructor, accessor, or arrow assigned to a
 *     declaration is at most **120 lines**, counted from the line of its first
 *     token to the line of its closing brace, inclusive.
 *
 * 800 and 120 are the *edges*, not the targets — D115 puts the design landing
 * point at 500 and 60. A file that sits at 799 lines has passed this gate and
 * failed the ruling.
 *
 * Three things about how it measures, because a budget gate that measures
 * something other than what a reader reads is worse than none:
 *
 *  1. **Physical lines of the file as committed.** Not statements, not tokens,
 *     not "logical" lines. What costs the reader is the text, so the text is
 *     what is counted, and `wc -l` agrees with this gate to the line.
 *  2. **The AST decides what a function is**, via the repository's own
 *     `typescript` (7.x, parsed through `typescript/unstable/sync`) — never a
 *     regular expression over braces. A brace-counting budget is defeated by a
 *     template string, which is exactly the thing this repository has 14,000
 *     lines of.
 *  3. **An inline callback is not a function.** `items.map((item) => …)` is
 *     part of the budget of whatever function contains it, because that is how
 *     it is read: you do not navigate to a callback, you meet it. A lambda
 *     earns its own budget when it is given a name — the initializer of a
 *     variable declaration, a class field, or an object-literal property — and
 *     is therefore something a reader can be sent to.
 *
 * `*.generated.ts` is exempt from the file cap and not from the function cap:
 * D115 P3 turns the embedded runtime JavaScript into real `runtime/*.js`
 * sources compiled into generated string constants, and what a reader reads
 * then is the generator's input, not its output. Nothing generated exists yet;
 * the exemption is here so that P3 does not arrive needing to argue with a
 * gate. The embedded runtime that is *still* in template strings today
 * (`*_MODULE_SOURCE = String.raw`…``) is measured as what it is — part of the
 * TypeScript file it sits in.
 *
 * ── The allowlist ──────────────────────────────────────────────────────────
 *
 * `file-budget-allowlist.json` freezes what is over budget today, in the shape
 * `check-tour-coverage.mjs`'s `FLOORS` and `surface-lock.json` already use in
 * this repository, and for the reason both of them state: a limit that can be
 * lowered quietly is not a limit. Each entry is a **ceiling** for one item, and
 * the list may only shrink. Three ways to be red:
 *
 *   (a) an item that is not in the list exceeds its limit — a new violation;
 *   (b) an allowlisted item grows past its recorded ceiling — the thing this
 *       gate exists to stop;
 *   (c) an allowlisted item is now within its limit, or no longer exists — the
 *       entry has to go, and the failure says which line to delete.
 *
 * (c) is the half that makes the list a measure of progress rather than a
 * drawer. Its length is the remaining work, and D115's stated target for it is
 * empty.
 *
 * Usage:
 *
 *   node scripts/check-file-budget.mjs
 *   node scripts/check-file-budget.mjs --write [--accept-growth]
 *   node scripts/check-file-budget.mjs --root <dir> [--allowlist <path>]
 *
 * `--write` regenerates the list from the current tree. It refuses — printing
 * every one of them — to *add* an entry or *raise* a ceiling without
 * `--accept-growth`, because "just re-run --write" is precisely how a ratchet
 * becomes a rubber stamp. `--root` exists for the same reason the coverage gate
 * takes a tour root and the surface gate takes a lock path: a gate that checks
 * nothing fails silently, so `tests/file-budget-gate.test.ts` points this one at
 * fixture trees and watches it go red.
 */

const FILE_LIMIT = 800;
const FUNCTION_LIMIT = 120;
const ALLOWLIST_NAME = "file-budget-allowlist.json";
const GATE = "scripts/check-file-budget.mjs";
const DECISION = "D115";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── Arguments ───────────────────────────────────────────────────────────────

const options = parseArguments(process.argv.slice(2));
const root = options.root === null ? repositoryRoot : resolve(options.root);
const allowlistPath = options.allowlist === null ? join(root, ALLOWLIST_NAME) : resolve(options.allowlist);

function parseArguments(argv) {
  const parsed = { write: false, acceptGrowth: false, root: null, allowlist: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") parsed.write = true;
    else if (argument === "--accept-growth") parsed.acceptGrowth = true;
    else if (argument === "--root" || argument === "--allowlist") {
      const value = argv[index + 1];
      if (value === undefined) usage(`${argument} needs a path`);
      parsed[argument === "--root" ? "root" : "allowlist"] = value;
      index += 1;
    } else usage(`unknown argument '${argument}'`);
  }
  return parsed;
}

function usage(problem) {
  process.stderr.write(`${problem}\n\nUsage: node ${GATE} [--write [--accept-growth]] [--root <dir>] [--allowlist <path>]\n`);
  process.exit(2);
}

// ── The tree this gate reads ────────────────────────────────────────────────
// `packages/*/src/**` and `tests/**`, which is the same set `tsconfig.json`
// type-checks minus the built `dist` declarations. Enumerated here rather than
// asked of the compiler's file list so that the answer does not change when a
// file stops being imported: an orphaned 900-line module is exactly the one a
// budget gate must still see. (`check-source-coverage.test.ts` pins the same
// judgment for `velar check`.)

async function measuredFiles(directory) {
  const found = [];
  const packages = await readdir(join(directory, "packages"), { withFileTypes: true }).catch(() => []);
  for (const entry of packages) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    await collectTypeScript(join(directory, "packages", entry.name, "src"), found);
  }
  await collectTypeScript(join(directory, "tests"), found);
  return found.sort(byCodeUnit);
}

async function collectTypeScript(directory, found) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".velar") continue;
      await collectTypeScript(path, found);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(path);
    }
  }
}

// ── Measuring ───────────────────────────────────────────────────────────────

const started = Date.now();
const files = await measuredFiles(root);
if (files.length === 0) {
  process.stderr.write(`${display(root)} has no TypeScript under packages/*/src or tests/; this gate would pass by reading nothing.\n`);
  process.exit(1);
}

const { API } = await import("typescript/unstable/sync");
const ts = await import("typescript/unstable/ast");
const Kind = ts.SyntaxKind;

/** The five forms that carry their own name, and therefore their own budget. */
const NAMED_FUNCTIONS = new Set([
  Kind.FunctionDeclaration,
  Kind.MethodDeclaration,
  Kind.Constructor,
  Kind.GetAccessor,
  Kind.SetAccessor,
]);
/** …and the two that borrow the name of the declaration they are assigned to. */
const ASSIGNED_FUNCTIONS = new Set([Kind.ArrowFunction, Kind.FunctionExpression]);
const NAMING_DECLARATIONS = new Set([Kind.VariableDeclaration, Kind.PropertyAssignment, Kind.PropertyDeclaration]);
const CLASSES = new Set([Kind.ClassDeclaration, Kind.ClassExpression]);

const api = new API({ cwd: root });
const measurements = { files: new Map(), functions: new Map() };
/** `path#name` → where to open it, so a failure is navigable rather than true. */
const declarations = new Map();
const unreadable = [];
try {
  const snapshot = api.updateSnapshot({ openFiles: files });
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const path = display(file);
    measurements.files.set(path, physicalLines(text));
    const project = snapshot.getDefaultProjectForFile(file);
    const sourceFile = project?.program.getSourceFile(file);
    if (sourceFile === undefined) {
      unreadable.push(path);
      continue;
    }
    for (const found of functionLines(sourceFile)) {
      const key = `${path}#${found.name}`;
      measurements.functions.set(key, found.lines);
      declarations.set(key, { path, name: found.name, line: found.line });
    }
  }
} finally {
  api.close();
}
const elapsed = Date.now() - started;

if (unreadable.length > 0) {
  process.stderr.write(
    `The TypeScript parser returned nothing for ${unreadable.length} file(s), so their functions went unmeasured:\n`
    + `${unreadable.map((path) => `  ${path}`).join("\n")}\n`,
  );
  process.exit(1);
}

// ── Vacuity floors ──────────────────────────────────────────────────────────
// The worst failure of a budget gate is not a red build, it is a green one that
// measured nothing: a walk that stops early sees no functions, finds no
// violations, and agrees with an allowlist that is entirely (c)-failures — or,
// if the allowlist were regenerated in that state, with an empty one, forever.
// That is not hypothetical. `forEachChild` returns the visitor's first truthy
// result and *stops*, so writing `forEachChild((child) => stack.push(child))`
// — push returns the new length — walks exactly one child per node and reports
// a repository with four functions in it. These are minimums, not the truth;
// the truth is in the report below, and it prints on every green run.
const FLOORS = Object.freeze({ files: 300, functions: 2000 });

if (options.root === null) {
  const short = [];
  if (files.length < FLOORS.files) short.push(`read ${files.length} files; expected at least ${FLOORS.files}`);
  if (measurements.functions.size < FLOORS.functions) {
    short.push(`measured ${measurements.functions.size} functions; expected at least ${FLOORS.functions}`);
  }
  if (short.length > 0) {
    process.stderr.write(
      `This gate ${short.join(" and ")}. Something stopped the walk, and a budget over nothing passes forever.\n`
      + `Fix the traversal, or lower FLOORS in ${GATE} deliberately if the repository really did shrink that far.\n`,
    );
    process.exit(1);
  }
}

/**
 * Physical lines, `wc -l`-compatible: a file that ends in a newline does not
 * gain an empty last line, and a file that does not end in one does not lose
 * its last.
 */
function physicalLines(text) {
  if (text === "") return 0;
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n").length;
}

/**
 * Every measurable function in one file, as `{name, line, lines}`, walked with
 * an explicit stack — a chain of a few thousand binary operators is an AST a
 * few thousand deep, and the parser survives it precisely so that this gate
 * should too.
 */
function functionLines(sourceFile) {
  const found = [];
  const seen = new Map();
  const stack = [{ node: sourceFile, container: "", assigned: false }];
  while (stack.length > 0) {
    const { node, container, assigned } = stack.pop();
    const named = NAMED_FUNCTIONS.has(node.kind);
    const borrowed = ASSIGNED_FUNCTIONS.has(node.kind) && assigned;
    let childContainer = container;
    if ((named || borrowed) && node.body !== undefined) {
      const name = unique(named ? qualify(container, memberName(node, sourceFile)) : container, seen);
      const first = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      const last = sourceFile.getLineAndCharacterOfPosition(Math.max(node.getEnd() - 1, 0)).line;
      found.push({ name, line: first + 1, lines: last - first + 1 });
      childContainer = name;
    } else if (named || borrowed) {
      // An overload signature or an ambient declaration: a header, not a body.
      childContainer = qualify(container, named ? memberName(node, sourceFile) : "");
    } else if (CLASSES.has(node.kind)) {
      childContainer = node.name === undefined ? container : qualify(container, memberName(node, sourceFile));
    } else if (NAMING_DECLARATIONS.has(node.kind)) {
      childContainer = qualify(container, memberName(node, sourceFile));
    }
    const initializer = NAMING_DECLARATIONS.has(node.kind) ? node.initializer : undefined;
    // The braces are load-bearing: `forEachChild` returns the visitor's first
    // truthy result and stops there, and `stack.push` returns a length.
    node.forEachChild((child) => {
      stack.push({ node: child, container: childContainer, assigned: child === initializer });
    });
  }
  return found;
}

function memberName(node, sourceFile) {
  if (node.kind === Kind.Constructor) return "constructor";
  const name = node.name;
  if (name === undefined) return "(anonymous)";
  return name.kind === Kind.Identifier || name.kind === Kind.PrivateIdentifier
    ? name.text
    : name.getText(sourceFile);
}

function qualify(container, name) {
  if (name === "") return container;
  return container === "" ? name : `${container}.${name}`;
}

/**
 * Two `inner`s in two branches of one `outer` are two functions with one name.
 * The reader is told apart by the line number the failure prints; the allowlist
 * key is told apart here, in source order, so that the same tree always
 * produces the same file.
 */
function unique(name, seen) {
  const count = (seen.get(name) ?? 0) + 1;
  seen.set(name, count);
  return count === 1 ? name : `${name}#${count}`;
}

// ── The allowlist ───────────────────────────────────────────────────────────

const violations = {
  files: sortedEntries(measurements.files, (path, lines) => lines > FILE_LIMIT && !path.endsWith(".generated.ts")),
  functions: sortedEntries(measurements.functions, (_key, lines) => lines > FUNCTION_LIMIT),
};

function sortedEntries(measured, over) {
  const kept = [...measured].filter(([key, lines]) => over(key, lines));
  kept.sort(([left], [right]) => byCodeUnit(left, right));
  return new Map(kept);
}

const existing = await readAllowlist();

async function readAllowlist() {
  let text;
  try {
    text = await readFile(allowlistPath, "utf8");
  } catch {
    return null;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    fail([`${display(allowlistPath)}: ${error instanceof Error ? error.message : String(error)}`]);
  }
  const problems = [];
  if (value?.gate !== GATE || value?.decision !== DECISION) {
    problems.push(`${display(allowlistPath)} must name its gate ("${GATE}") and its ruling ("${DECISION}"); those two fields are how a reader of a file full of numbers finds out what wrote it`);
  }
  if (value?.limits?.file !== FILE_LIMIT || value?.limits?.function !== FUNCTION_LIMIT) {
    problems.push(`${display(allowlistPath)}: "limits" says ${JSON.stringify(value?.limits)}, but this gate enforces {"file":${FILE_LIMIT},"function":${FUNCTION_LIMIT}}. The limits are D115's; changing them is a decision that belongs in a D record, not in this file.`);
  }
  for (const section of ["files", "functions"]) {
    const entries = value?.[section];
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      problems.push(`${display(allowlistPath)}: "${section}" must be an object mapping each exempt item to the line count that is its ceiling`);
      continue;
    }
    for (const [key, lines] of Object.entries(entries)) {
      if (!Number.isInteger(lines) || lines <= 0) {
        problems.push(`${display(allowlistPath)}: "${section}" entry ${JSON.stringify(key)} is ${JSON.stringify(lines)}; a ceiling is a positive whole number of lines`);
      }
    }
  }
  if (problems.length > 0) fail(problems);
  return { files: value.files, functions: value.functions };
}

async function writeAllowlist() {
  const additions = [];
  if (existing !== null) {
    for (const section of ["files", "functions"]) {
      for (const [key, lines] of violations[section]) {
        const recorded = existing[section][key];
        if (recorded === undefined) additions.push(`  + ${section === "files" ? "file" : "function"} ${key} — ${lines} lines, new exemption`);
        else if (lines > recorded) additions.push(`  ↑ ${section === "files" ? "file" : "function"} ${key} — ${recorded} → ${lines} lines, ceiling raised`);
      }
    }
  }
  if (additions.length > 0 && !options.acceptGrowth) {
    process.stderr.write([
      `--write would grow ${display(allowlistPath)} by ${additions.length} entr${additions.length === 1 ? "y" : "ies"}:`,
      "",
      ...additions,
      "",
      "  Growth is the one thing this list exists to refuse, and regenerating it is not a way to agree",
      "  to growth. Shrink what is named above, or re-run with --accept-growth and say in the commit",
      "  message why each entry earned an exemption. A regenerated list with no reason attached is a",
      "  ratchet that has been turned into a rubber stamp.",
      "",
    ].join("\n"));
    process.exit(1);
  }
  const content = {
    gate: GATE,
    decision: DECISION,
    limits: { file: FILE_LIMIT, function: FUNCTION_LIMIT },
    files: Object.fromEntries(violations.files),
    functions: Object.fromEntries(violations.functions),
  };
  await writeFile(allowlistPath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${report()}\nWrote ${display(allowlistPath)}: ${violations.files.size} files and ${violations.functions.size} functions exempted`
    + `${existing === null ? " (first freeze)" : additions.length > 0 ? `, ${additions.length} of them added or raised` : ""}.\n`,
  );
}

function checkAgainstAllowlist() {
  if (existing === null) {
    fail([
      `${display(allowlistPath)} is missing. It is the record of what was already over budget when this gate went in, it is checked in, and without it every pre-existing file would fail at once.`,
      "  Create it with:  node scripts/check-file-budget.mjs --write",
    ]);
  }
  const failures = [
    ...sectionFailures("files", FILE_LIMIT, fileMessages),
    ...sectionFailures("functions", FUNCTION_LIMIT, functionMessages),
  ];
  if (failures.length > 0) fail(failures);
  process.stdout.write(`${report()}\n`);
}

/**
 * The three ways to be red, asked once per section. (a) and (b) are read off
 * the violations; (c) is read off the allowlist, which is the direction that
 * makes the list shrink.
 */
function sectionFailures(section, limit, messages) {
  const failures = [];
  const recorded = existing[section];
  for (const [key, lines] of violations[section]) {
    const ceiling = recorded[key];
    if (ceiling === undefined) failures.push(messages.added(key, lines, limit));
    else if (lines > ceiling) failures.push(messages.grew(key, lines, ceiling));
  }
  for (const [key, ceiling] of Object.entries(recorded)) {
    if (violations[section].has(key)) continue;
    const lines = measurements[section].get(key);
    failures.push(lines === undefined ? messages.gone(key, ceiling) : messages.fixed(key, lines, ceiling, limit));
  }
  return failures;
}

const fileMessages = {
  added: (path, lines, limit) => [
    `${path} is ${lines} lines; the limit is ${limit} (D115 §一.1 — a source file an agent reads in one \`Read\`).`,
    "",
    "  Split it along the concept boundaries D115 §三 lays out for its package, so that the path says",
    "  what each part is. If this file genuinely has to exceed the cap for now, the exemption is:",
    "",
    `      ${ALLOWLIST_NAME} → "files": { ${JSON.stringify(path)}: ${lines} }`,
    "",
    "  Adding an exemption is a decision; name it in the commit.",
  ].join("\n"),
  grew: (path, lines, ceiling) => [
    `${path} is ${lines} lines, and ${ALLOWLIST_NAME} caps it at ${ceiling} — it grew by ${lines - ceiling}.`,
    "",
    "  An exempt file may shrink and may not grow; that is the whole content of the exemption. Put the",
    `  ${lines - ceiling} new line${lines - ceiling === 1 ? "" : "s"} in a module of its own, under the layout D115 §三 gives this package.`,
  ].join("\n"),
  fixed: (path, lines, ceiling, limit) => [
    path.endsWith(".generated.ts")
      ? `${path} is generated, and a generated file carries no file cap — what a reader reads is its generator — but ${ALLOWLIST_NAME} still exempts it at ${ceiling} lines.`
      : `${path} is ${lines} line${lines === 1 ? "" : "s"}, within the ${limit}-line limit, but ${ALLOWLIST_NAME} still exempts it at ${ceiling}.`,
    "",
    "  Delete this line from \"files\":",
    "",
    `      ${JSON.stringify(path)}: ${ceiling},`,
    "",
    "  The list only shrinks. Its length is how much of D115 is left, so an entry that has been earned",
    "  back is removed in the commit that earned it.",
  ].join("\n"),
  gone: (path, ceiling) => [
    `${ALLOWLIST_NAME} exempts ${JSON.stringify(path)} at ${ceiling} lines, and this gate reads no such file.`,
    "",
    "  It was renamed, moved, or deleted. Delete this line from \"files\":",
    "",
    `      ${JSON.stringify(path)}: ${ceiling},`,
    "",
    "  and, if it moved, add the new path only if the file is still over budget there.",
  ].join("\n"),
};

const functionMessages = {
  added: (key, lines, limit) => [
    `${location(key)} is ${lines} lines; the limit is ${limit} (D115 §一.1 — a function an agent reads in one screen).`,
    "",
    "  Extract the clusters inside it into named functions or a collaborator, per D115 §四: composition,",
    "  a narrow declared interface, and the `protected` seam left alone. If it genuinely has to exceed",
    "  the cap for now, the exemption is:",
    "",
    `      ${ALLOWLIST_NAME} → "functions": { ${JSON.stringify(key)}: ${lines} }`,
    "",
    "  Adding an exemption is a decision; name it in the commit.",
  ].join("\n"),
  grew: (key, lines, ceiling) => [
    `${location(key)} is ${lines} lines, and ${ALLOWLIST_NAME} caps it at ${ceiling} — it grew by ${lines - ceiling}.`,
    "",
    "  An exempt function may shrink and may not grow. A new case belongs in a new function that this",
    `  one calls, which is also how the next reader finds that case without reading the other ${ceiling} lines.`,
  ].join("\n"),
  fixed: (key, lines, ceiling, limit) => [
    `${location(key)} is ${lines} lines, within the ${limit}-line limit, but ${ALLOWLIST_NAME} still exempts it at ${ceiling}.`,
    "",
    "  Delete this line from \"functions\":",
    "",
    `      ${JSON.stringify(key)}: ${ceiling},`,
    "",
    "  The list only shrinks. Its length is how much of D115 is left, so an entry that has been earned",
    "  back is removed in the commit that earned it.",
  ].join("\n"),
  gone: (key, ceiling) => [
    `${ALLOWLIST_NAME} exempts ${JSON.stringify(key)} at ${ceiling} lines, and this gate finds no such function.`,
    "",
    "  It was renamed, moved, or removed. Delete this line from \"functions\":",
    "",
    `      ${JSON.stringify(key)}: ${ceiling},`,
    "",
    "  and, if it moved, add its new qualified name only if it is still over budget there.",
  ].join("\n"),
};

/**
 * `packages/compiler/src/analyzer.ts:4115 Analyzer.analyzeStatement` — the path
 * and line a reader opens, then the name they search for once they are there.
 */
function location(key) {
  const declaration = declarations.get(key);
  if (declaration === undefined) return key;
  return `${declaration.path}:${declaration.line} ${declaration.name}`;
}

// ── Report ──────────────────────────────────────────────────────────────────

function report() {
  const sources = files.filter((file) => !display(file).startsWith("tests/")).length;
  const biggestFile = [...violations.files].sort(([, left], [, right]) => right - left)[0];
  const biggestFunction = [...violations.functions].sort(([, left], [, right]) => right - left)[0];
  return [
    `File and function budgets (${DECISION} §一.1): ${files.length} files read in ${(elapsed / 1000).toFixed(1)}s`
    + ` — ${sources} under packages/*/src, ${files.length - sources} under tests/`,
    `  files     ≤ ${FILE_LIMIT} lines: ${violations.files.size} of ${measurements.files.size} above the limit`
    + (biggestFile === undefined ? "" : `, largest ${biggestFile[0]} at ${biggestFile[1]}`),
    `  functions ≤ ${FUNCTION_LIMIT} lines: ${violations.functions.size} of ${measurements.functions.size} above the limit`
    + (biggestFunction === undefined ? "" : `, largest ${location(biggestFunction[0])} at ${biggestFunction[1]}`),
    `file-budget: ${violations.files.size} files and ${violations.functions.size} functions still above the limit;`
    + " the allowlist only shrinks",
  ].join("\n");
}

function fail(failures) {
  process.stderr.write(`The file and function budgets are not met (${DECISION} §二):\n\n${failures.join("\n\n")}\n`);
  process.exit(1);
}

function display(path) {
  const value = relative(root, path);
  return value && !value.startsWith("..") ? value.split(sep).join("/") : path;
}

/** D90 R3(a): code-unit order, so two machines that differ in `LC_ALL` agree. */
function byCodeUnit(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ── Run ─────────────────────────────────────────────────────────────────────
// Last, so that the message tables above are initialized before either branch
// can reach for one.

if (options.write) await writeAllowlist();
else checkAgainstAllowlist();
