import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * D115 §二 and the "R6 模块地图门禁" line of its P4 schedule — the map of what
 * lives where, and the gate that keeps the map true.
 *
 * D115 §一.2 is 「路径即概念」: a file's place in the tree says what it manages,
 * so a model that has to change one concept knows which directory to open
 * before it reads anything. A map that says so is a document. A map that says
 * so *and cannot go stale* is this gate. Five things go stale, and each is one
 * of the rules below.
 *
 *   (a) **A directory nobody declared.** A new `analysis/inference-v2/` costs
 *       nothing to create and tells the next reader nothing; the map has to
 *       gain a line saying what it owns, or the directory has to not exist.
 *       Files that sit at the root of `packages/<package>/src` are *not*
 *       enumerated — there are 153 of them in `cli` alone, most of them one
 *       small concept each, and a gate that made every leaf file a roster entry
 *       would be a second copy of `ls` that goes red on every rename. The root
 *       of a package is itself one declared place, with one line saying what
 *       still lives there; directories are what must be declared.
 *
 *   (b) **A file over the 800-line cap with no stated reason.** D115's revision
 *       of 2026-09-06 exempts one shape and one only: a **composition root** —
 *       a host class that holds its state fields, its `protected` seams, its
 *       host constructors and its dispatchers, and *no* analysis, parsing or
 *       emission logic. (`analyzer.ts` is the case that earned the exemption:
 *       its host constructors read `private` state, so moving them out of the
 *       class is TS2341, and the only way out is a wider public face.)
 *       Everything else over the cap is unfinished work with a phase number.
 *       This gate does not re-derive the file budget — that is
 *       `check-file-budget.mjs` — it also asserts the two rosters name the same
 *       files, so the exemption and the reason for it cannot drift apart.
 *
 *   (c) **A cycle.** D114's 「P4 R4b 落地」 wrote the rule down after finding
 *       `project/diagnostics.ts` and `project/incremental.ts` importing each
 *       other and breaking them apart with `project/scc.ts`:
 *       「协作者模块之间不得成环」. Two modules that import each other are one
 *       module with two file names — a reader who opens either one has not
 *       bounded what they must read, which is the whole point of splitting a
 *       5,000-line file up. The rule is enforced over a whole package rather
 *       than a single directory, because the pair R4b left for R6 —
 *       `desktop/config.ts` and `desktop/manifest-migration.ts` — sat at a
 *       package root, and because a cycle that crosses `analysis/` and `emit/`
 *       is the worse one, not the excused one. It was the only cycle in the
 *       repository; `desktop/window-kind.ts` is R6 breaking it the way R4b did.
 *
 *   (d) **A composition root that grew logic back.** The exemption in (b) is
 *       from the *file* cap, never from the 120-line function cap: state,
 *       seams, constructors and dispatchers are short by construction. "Is this
 *       a host constructor or a dispatcher?" is not a question a script can ask
 *       an AST — both are ordinary methods — so the roster answers it instead:
 *       a function over the cap inside a root is red unless `module-map.json`
 *       names it, with its role and its ceiling. Today every root's list is
 *       empty and the check reads "no logic came back".
 *
 *   (e) **The prose half.** D115 §二 asks this gate for 「缺行、多行、路径不存在
 *       都红」, so `docs/contributing/module-map.md` — the document a reader
 *       actually opens — has to name every directory and every over-budget file
 *       the roster declares. A `document` field pointing at a file the gate
 *       never opens would be a gate that checks nothing.
 *
 * What is *not* mechanized, and why: D115 §四's facade rule (「门面不变」) and
 * the import-direction rule are both stated in
 * `docs/contributing/module-map.md`, and only their last clause is decidable
 * here. That a moved name is still re-exported from its old path is the export
 * roster each wave diffs against `dist`; that `analysis/` sits below `emit/` is
 * a judgment about what a layer means, which
 * `docs/contributing/compiler-architecture.md` owns and
 * `check-runtime-boundary.mjs` enforces between packages. The half of the
 * direction rule that is a fact about a graph — no two modules reach each
 * other — is rule (c), and it is checked exactly.
 *
 * Usage:
 *
 *   node scripts/check-module-map.mjs
 *   node scripts/check-module-map.mjs --root <dir> [--map <path>] [--allowlist <path>]
 *
 * `--root` exists for the same reason `check-file-budget.mjs` takes one: a gate
 * that checks nothing fails silently, so `tests/repo/check-module-map.test.ts`
 * points this one at temporary trees with one planted violation each and
 * watches every rule go red.
 */

const GATE = "scripts/check-module-map.mjs";
const DECISION = "D115";
const MAP_NAME = "module-map.json";
const ALLOWLIST_NAME = "file-budget-allowlist.json";
const DOCUMENT = "docs/contributing/module-map.md";
const BUDGET_GATE = "scripts/check-file-budget.mjs";
/** The two shapes D115's revision lets a composition root keep over the function cap. */
const SEGMENT_ROLES = ["host-constructor", "dispatcher"];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── Arguments ───────────────────────────────────────────────────────────────

const options = parseArguments(process.argv.slice(2));
const root = options.root === null ? repositoryRoot : resolve(options.root);
const mapPath = options.map === null ? join(root, MAP_NAME) : resolve(options.map);
const allowlistPath = options.allowlist === null ? join(root, ALLOWLIST_NAME) : resolve(options.allowlist);

function parseArguments(argv) {
  const parsed = { root: null, map: null, allowlist: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" || argument === "--map" || argument === "--allowlist") {
      const value = argv[index + 1];
      if (value === undefined) usage(`${argument} needs a path`);
      parsed[argument.slice(2)] = value;
      index += 1;
    } else usage(`unknown argument '${argument}'`);
  }
  return parsed;
}

function usage(problem) {
  process.stderr.write(`${problem}\n\nUsage: node ${GATE} [--root <dir>] [--map <path>] [--allowlist <path>]\n`);
  process.exit(2);
}

// ── The tree this gate reads ────────────────────────────────────────────────
// `packages/*/src/**/*.ts`, enumerated from the filesystem rather than from the
// compiler's file list, for the reason `check-file-budget.mjs` states: an
// orphaned module is exactly the one a map gate must still see.

const started = Date.now();
const packages = await readPackages();

async function readPackages() {
  const found = [];
  const entries = await readdir(join(root, "packages"), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const source = join(root, "packages", entry.name, "src");
    const files = [];
    await collectTypeScript(source, files);
    if (files.length === 0) continue;
    files.sort(byCodeUnit);
    found.push({ name: entry.name, source, files });
  }
  return found.sort((left, right) => byCodeUnit(left.name, right.name));
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

if (packages.length === 0) {
  process.stderr.write(`${display(root)} has no TypeScript under packages/*/src; this gate would pass by reading nothing.\n`);
  process.exit(1);
}

// ── The roster, and the budget roster it must agree with ────────────────────

const map = await readMap();
const budget = await readAllowlist();
const FILE_LIMIT = budget.limits.file;
const FUNCTION_LIMIT = budget.limits.function;

async function readMap() {
  const value = await readJson(
    mapPath,
    `${display(mapPath)} is missing. It is the declared shape of this repository — ${DOCUMENT} is its prose half — and`
    + " without it this gate has nothing to compare the tree against.",
  );
  const problems = [];
  if (value?.gate !== GATE || value?.decision !== DECISION) {
    problems.push(`${display(mapPath)} must name its gate ("${GATE}") and its ruling ("${DECISION}"); those two fields are how a reader of a file full of paths finds out what wrote it`);
  }
  if (value?.document !== DOCUMENT) {
    problems.push(`${display(mapPath)}: "document" must be ${JSON.stringify(DOCUMENT)} — the roster is the machine half of one map, and its prose half is where a reader is sent`);
  }
  if (value?.packages === undefined || typeof value.packages !== "object" || Array.isArray(value.packages)) {
    problems.push(`${display(mapPath)}: "packages" must be an object mapping each package name to {"root": <one line>, "directories": {<path>: <one line>}}`);
  } else {
    for (const [name, entry] of Object.entries(value.packages)) {
      if (typeof entry?.root !== "string" || entry.root.trim() === "") {
        problems.push(`${display(mapPath)}: packages.${name}.root must be one line saying what still lives directly under packages/${name}/src`);
      }
      if (entry?.directories === undefined || typeof entry.directories !== "object" || Array.isArray(entry.directories)) {
        problems.push(`${display(mapPath)}: packages.${name}.directories must be an object mapping each directory under src/ to one line saying what it owns`);
        continue;
      }
      for (const [directory, owns] of Object.entries(entry.directories)) {
        if (typeof owns !== "string" || owns.trim() === "") {
          problems.push(`${display(mapPath)}: packages.${name}.directories[${JSON.stringify(directory)}] must be one line saying what that directory owns`);
        }
      }
    }
  }
  for (const section of ["compositionRoots", "remainders"]) {
    const entries = value?.[section];
    if (entries === undefined || typeof entries !== "object" || Array.isArray(entries)) {
      problems.push(`${display(mapPath)}: "${section}" must be an object mapping each over-budget source file to its reason`);
      continue;
    }
    for (const [path, entry] of Object.entries(entries)) {
      if (typeof entry?.reason !== "string" || entry.reason.trim() === "") {
        problems.push(`${display(mapPath)}: ${section}[${JSON.stringify(path)}] needs a "reason" — an exemption with no stated reason is an exemption nobody can retire`);
      }
      if (section !== "compositionRoots") continue;
      const declared = entry?.segments;
      if (declared === undefined || typeof declared !== "object" || Array.isArray(declared)) {
        problems.push(`${display(mapPath)}: compositionRoots[${JSON.stringify(path)}].segments must be an object; it is {} for a root that has kept no oversized function`);
        continue;
      }
      for (const [name, segment] of Object.entries(declared)) {
        if (!SEGMENT_ROLES.includes(segment?.role)) {
          problems.push(`${display(mapPath)}: compositionRoots[${JSON.stringify(path)}].segments[${JSON.stringify(name)}].role must be ${SEGMENT_ROLES.map((role) => JSON.stringify(role)).join(" or ")} — D115's revision exempts those two shapes and no others`);
        }
        if (!Number.isInteger(segment?.ceiling) || segment.ceiling <= 0) {
          problems.push(`${display(mapPath)}: compositionRoots[${JSON.stringify(path)}].segments[${JSON.stringify(name)}].ceiling is ${JSON.stringify(segment?.ceiling)}; a ceiling is a positive whole number of lines`);
        }
      }
    }
  }
  if (!Array.isArray(value?.allowedCycles)) {
    problems.push(`${display(mapPath)}: "allowedCycles" must be an array; it is [] when no two modules in the repository import each other, which is the state R6 left it in`);
  } else {
    for (const [index, edge] of value.allowedCycles.entries()) {
      if (typeof edge?.from !== "string" || typeof edge?.to !== "string" || typeof edge?.reason !== "string" || edge.reason.trim() === "") {
        problems.push(`${display(mapPath)}: allowedCycles[${index}] must be {"from": <path>, "to": <path>, "reason": <one line>}`);
      }
    }
  }
  if (problems.length > 0) fail(problems);
  return value;
}

async function readAllowlist() {
  const value = await readJson(
    allowlistPath,
    `${display(allowlistPath)} is missing. This gate reads it to check that the over-budget files it exempts are the same`
    + ` ones ${display(mapPath)} gives a reason for; create it with:  node ${BUDGET_GATE} --write`,
  );
  if (!Number.isInteger(value?.limits?.file) || !Number.isInteger(value?.limits?.function)) {
    fail([`${display(allowlistPath)}: "limits" must be {"file": <lines>, "function": <lines>} — this gate takes the caps from there so that the two gates cannot disagree about what "over budget" means`]);
  }
  if (value?.files === undefined || typeof value.files !== "object" || Array.isArray(value.files)) {
    fail([`${display(allowlistPath)}: "files" must be an object mapping each exempt file to its ceiling; ${BUDGET_GATE} owns that shape`]);
  }
  return value;
}

async function readJson(path, missingMessage) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    fail([missingMessage]);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail([`${display(path)}: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

// ── Reading the tree ────────────────────────────────────────────────────────
// Physical lines for rule (b), the top-level functions of each composition root
// for rule (d), and every relative value import for rule (c). The imports are
// read through the repository's own `typescript` (7.x) rather than by scanning
// text, for the reason `check-file-budget.mjs` gives about braces: this
// repository holds thousands of lines of JavaScript inside template literals,
// and `import { x } from "./y.js"` inside one of them is a string, not an edge.

const { API } = await import("typescript/unstable/sync");
const ts = await import("typescript/unstable/ast");
const Kind = ts.SyntaxKind;
const MEMBER_FUNCTIONS = new Set([Kind.MethodDeclaration, Kind.Constructor, Kind.GetAccessor, Kind.SetAccessor]);
const ASSIGNED_FUNCTIONS = new Set([Kind.ArrowFunction, Kind.FunctionExpression]);

const allFiles = packages.flatMap((package_) => package_.files);
const lines = new Map();
for (const file of allFiles) lines.set(file, physicalLines(await readFile(file, "utf8")));

const rootPaths = new Set(Object.keys(map.compositionRoots).map((path) => join(root, path)));
const imports = new Map();
const segments = new Map();
const unreadable = [];
const api = new API({ cwd: root });
try {
  const snapshot = api.updateSnapshot({ openFiles: allFiles });
  for (const file of allFiles) {
    const sourceFile = snapshot.getDefaultProjectForFile(file)?.program.getSourceFile(file);
    if (sourceFile === undefined) {
      unreadable.push(display(file));
      continue;
    }
    imports.set(file, valueImports(sourceFile, file));
    if (rootPaths.has(file)) segments.set(file, topLevelFunctions(sourceFile));
  }
} finally {
  api.close();
}

if (unreadable.length > 0) {
  process.stderr.write(
    `The TypeScript parser returned nothing for ${unreadable.length} file(s), so their imports went unread:\n`
    + `${unreadable.map((path) => `  ${path}`).join("\n")}\n`,
  );
  process.exit(1);
}

/** `wc -l`-compatible physical lines, the same measure `check-file-budget.mjs` reports. */
function physicalLines(text) {
  if (text === "") return 0;
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n").length;
}

/**
 * Every relative **value** import of one file, resolved to a path.
 *
 * `import type { T } from "./x.ts"` and `export type { T } from "./x.ts"` are
 * erased before anything runs, so they cannot make one module wait for another
 * and they are not edges here. An inline `{ type T }` inside an otherwise
 * ordinary import *is* an edge: `verbatimModuleSyntax` is on in this
 * repository's `tsconfig.json`, so that declaration still emits an import of
 * the module, which is exactly what a cycle is made of.
 */
function valueImports(sourceFile, file) {
  const found = [];
  for (const statement of sourceFile.statements) {
    let specifier;
    let typeOnly = false;
    if (statement.kind === Kind.ImportDeclaration) {
      specifier = statement.moduleSpecifier?.text;
      typeOnly = statement.importClause?.isTypeOnly === true;
    } else if (statement.kind === Kind.ExportDeclaration) {
      specifier = statement.moduleSpecifier?.text;
      typeOnly = statement.isTypeOnly === true;
    } else continue;
    if (typeOnly || typeof specifier !== "string") continue;
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;
    found.push(resolve(dirname(file), specifier));
  }
  return found;
}

/**
 * The functions of one file a reader meets at its top level: a function
 * declaration, a member of a top-level class, or a lambda a top-level
 * declaration gives a name to. Named the way `check-file-budget.mjs` names them
 * (`Analyzer.analyzeStatement`), so one exemption reads the same in both
 * rosters, and measured the same way — the line of the first token to the line
 * of the closing brace, inclusive. What is nested inside one of these is the
 * file budget's business, not the map's.
 */
function topLevelFunctions(sourceFile) {
  const found = [];
  const add = (node, name) => {
    if (node.body === undefined) return;
    const first = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
    const last = sourceFile.getLineAndCharacterOfPosition(Math.max(node.getEnd() - 1, 0)).line;
    found.push({ name, line: first + 1, lines: last - first + 1 });
  };
  for (const statement of sourceFile.statements) {
    if (statement.kind === Kind.FunctionDeclaration) add(statement, memberName(statement, sourceFile));
    else if (statement.kind === Kind.ClassDeclaration) {
      const owner = memberName(statement, sourceFile);
      for (const member of statement.members ?? []) {
        if (MEMBER_FUNCTIONS.has(member.kind)) add(member, `${owner}.${memberName(member, sourceFile)}`);
        else if (member.kind === Kind.PropertyDeclaration && ASSIGNED_FUNCTIONS.has(member.initializer?.kind)) {
          add(member.initializer, `${owner}.${memberName(member, sourceFile)}`);
        }
      }
    } else if (statement.kind === Kind.VariableStatement) {
      for (const declaration of statement.declarationList?.declarations ?? []) {
        if (ASSIGNED_FUNCTIONS.has(declaration.initializer?.kind)) add(declaration.initializer, memberName(declaration, sourceFile));
      }
    }
  }
  return found;
}

function memberName(node, sourceFile) {
  if (node.kind === Kind.Constructor) return "constructor";
  const name = node.name;
  if (name === undefined) return "(anonymous)";
  return name.kind === Kind.Identifier || name.kind === Kind.PrivateIdentifier ? name.text : name.getText(sourceFile);
}

// ── The rules ───────────────────────────────────────────────────────────────

const failures = [];
const declaredDirectories = countDeclaredDirectories();
checkDirectories();
const overBudget = checkOverBudget();
await checkDocument(overBudget);
const edges = checkCycles();
checkCompositionRootSegments();

// ── Vacuity floors ──────────────────────────────────────────────────────────
// A map gate that read no directories agrees with any map at all, and a cycle
// gate that resolved no imports reports a forest. These are minimums, not the
// truth; the truth is in the report below, and it prints on every green run.

const FLOORS = Object.freeze({ packages: 8, files: 400, directories: 40, edges: 800 });

if (options.root === null) {
  const short = [];
  if (packages.length < FLOORS.packages) short.push(`found ${packages.length} packages; expected at least ${FLOORS.packages}`);
  if (allFiles.length < FLOORS.files) short.push(`read ${allFiles.length} source files; expected at least ${FLOORS.files}`);
  if (declaredDirectories < FLOORS.directories) short.push(`compared ${declaredDirectories} declared directories; expected at least ${FLOORS.directories}`);
  if (edges < FLOORS.edges) short.push(`resolved ${edges} relative value imports; expected at least ${FLOORS.edges}`);
  if (short.length > 0) {
    process.stderr.write(
      `This gate ${short.join(" and ")}. Something stopped the walk, and a map checked against nothing agrees forever.\n`
      + `Fix the traversal, or lower FLOORS in ${GATE} deliberately if the repository really did shrink that far.\n`,
    );
    process.exit(1);
  }
}

if (failures.length > 0) fail(failures);
process.stdout.write(`${report()}\n`);

function countDeclaredDirectories() {
  let total = 0;
  for (const entry of Object.values(map.packages)) total += Object.keys(entry.directories).length;
  return total;
}

/**
 * Rule (a): every directory that holds source is declared, and every declared
 * directory holds source. Both directions, because a roster that may only gain
 * lines is a roster that stops describing anything.
 */
function checkDirectories() {
  for (const name of Object.keys(map.packages).sort(byCodeUnit)) {
    if (packages.some((package_) => package_.name === name)) continue;
    failures.push([
      `${MAP_NAME} declares package ${JSON.stringify(name)}, and this gate reads no source under packages/${name}/src.`,
      "",
      `  It was renamed or removed. Delete packages.${name} from ${MAP_NAME}, and its section from ${DOCUMENT}.`,
    ].join("\n"));
  }
  for (const package_ of packages) {
    const declared = map.packages[package_.name];
    if (declared === undefined) {
      failures.push([
        `packages/${package_.name}/src holds ${package_.files.length} source file(s) and ${MAP_NAME} does not declare the package.`,
        "",
        "  Add it, with one line for what sits at its root and one line per directory under it:",
        "",
        `      ${MAP_NAME} → "packages": { ${JSON.stringify(package_.name)}: { "root": "…", "directories": { … } } }`,
        "",
        `  and the matching section in ${DOCUMENT}. A package the map does not mention is a package nobody was told to read.`,
      ].join("\n"));
      continue;
    }
    const present = new Set();
    for (const file of package_.files) {
      const directory = relative(package_.source, dirname(file)).split(sep).join("/");
      if (directory !== "") present.add(directory);
    }
    for (const directory of [...present].sort(byCodeUnit)) {
      if (Object.hasOwn(declared.directories, directory)) continue;
      failures.push([
        `packages/${package_.name}/src/${directory}/ holds source and ${MAP_NAME} does not declare it (D115 §一.2 — the path is the concept).`,
        "",
        "  Say in one line what it owns:",
        "",
        `      ${MAP_NAME} → "packages": { ${JSON.stringify(package_.name)}: { "directories": { ${JSON.stringify(directory)}: "…" } } }`,
        "",
        `  and add the same line to ${DOCUMENT}. If the concept already has a home, move the files there instead; a`,
        "  directory earns a line only when it names something the other directories do not.",
      ].join("\n"));
    }
    for (const directory of Object.keys(declared.directories).sort(byCodeUnit)) {
      if (present.has(directory)) continue;
      failures.push([
        `${MAP_NAME} declares packages/${package_.name}/src/${directory}/, and no source file sits directly in it.`,
        "",
        "  It was renamed, emptied, or never created. Delete this line:",
        "",
        `      "packages": { ${JSON.stringify(package_.name)}: { "directories": { ${JSON.stringify(directory)}: … } } }`,
        "",
        `  and the same line from ${DOCUMENT}. A map that describes a directory that is not there is worse than no map.`,
      ].join("\n"));
    }
  }
}

/**
 * Rule (b): every source file over the file cap is either a composition root or
 * a named remainder, and that same set is what `file-budget-allowlist.json`
 * exempts. The budget gate owns the number; this one owns the reason, and the
 * two-way comparison is what stops them drifting apart.
 */
function checkOverBudget() {
  const declared = new Map();
  for (const [path, entry] of Object.entries(map.compositionRoots)) declared.set(path, { section: "compositionRoots", entry });
  for (const [path, entry] of Object.entries(map.remainders)) {
    if (declared.has(path)) {
      failures.push([
        `${MAP_NAME} lists ${path} as both a composition root and a remainder.`,
        "",
        "  It is one or the other: a root holds only state, seams, host constructors and dispatchers and is exempt for",
        "  good (D115's revision of 2026-09-06); a remainder is unfinished work with a phase number. Delete the wrong one.",
      ].join("\n"));
      continue;
    }
    declared.set(path, { section: "remainders", entry });
  }

  const measured = new Map();
  for (const file of allFiles) {
    const path = display(file);
    // A generated file carries no file cap — what a reader reads is its
    // generator — which is the judgment `check-file-budget.mjs` already makes.
    if (path.endsWith(".generated.ts")) continue;
    if (lines.get(file) > FILE_LIMIT) measured.set(path, lines.get(file));
  }

  for (const [path, size] of [...measured].sort(([left], [right]) => byCodeUnit(left, right))) {
    if (declared.has(path)) continue;
    failures.push([
      `${path} is ${size} lines, over the ${FILE_LIMIT}-line cap, and ${MAP_NAME} says nothing about why.`,
      "",
      "  Split it — D115 §三 lays out the layout for its package. If it is a composition root (only state fields, the",
      "  `protected` seams, host constructors and dispatchers; no analysis, parsing or emission logic), say so:",
      "",
      `      ${MAP_NAME} → "compositionRoots": { ${JSON.stringify(path)}: { "reason": "…", "segments": {} } }`,
      "",
      "  and if it is not split yet but will be, say which phase owns it:",
      "",
      `      ${MAP_NAME} → "remainders": { ${JSON.stringify(path)}: { "reason": "…" } }`,
    ].join("\n"));
  }
  for (const [path, { section }] of [...declared].sort(([left], [right]) => byCodeUnit(left, right))) {
    if (measured.has(path)) continue;
    const size = lines.get(join(root, path));
    failures.push([
      size === undefined
        ? `${MAP_NAME} lists ${path} under "${section}", and this gate reads no such file.`
        : `${MAP_NAME} lists ${path} under "${section}", and it is ${size} line${size === 1 ? "" : "s"} — within the ${FILE_LIMIT}-line cap.`,
      "",
      `  ${size === undefined ? "It was renamed, moved, or deleted." : "It has been earned back."} Delete this line from "${section}":`,
      "",
      `      ${JSON.stringify(path)}: …`,
      "",
      `  and say so in ${DOCUMENT}. The roster's length is how much of D115 §三 is still owed.`,
    ].join("\n"));
  }

  const exempt = Object.keys(budget.files).filter((path) => path.startsWith("packages/") && path.includes("/src/"));
  for (const path of exempt.sort(byCodeUnit)) {
    if (declared.has(path)) continue;
    failures.push([
      `${ALLOWLIST_NAME} exempts ${path} from the ${FILE_LIMIT}-line cap and ${MAP_NAME} gives no reason for it.`,
      "",
      "  The two rosters name the same files on purpose: the budget records the number, the map records why anyone agreed",
      `  to it. Add the file to "compositionRoots" or "remainders" in ${MAP_NAME}, or shrink it and delete both lines.`,
    ].join("\n"));
  }
  for (const path of [...declared.keys()].sort(byCodeUnit)) {
    if (Object.hasOwn(budget.files, path)) continue;
    failures.push([
      `${MAP_NAME} gives a reason for ${path} and ${ALLOWLIST_NAME} does not exempt it.`,
      "",
      "  Either the file is within the cap now — delete both lines — or the budget's exemption was dropped by mistake.",
      `  Regenerate the budget with:  node ${BUDGET_GATE} --write`,
    ].join("\n"));
  }
  return declared;
}

/**
 * Rule (e): the prose half still names everything the roster declares.
 *
 * D115 §二 asks this gate for 「缺行、多行、路径不存在都红」, and a `document`
 * field pointing at a file the gate never opens would be a gate that checks
 * nothing: the roster would stay true and the document a reader actually reads
 * would quietly stop being about this repository. The check is presence, not
 * prose — every declared directory and every over-budget file is named there,
 * by its full path, and what is said about it is a writer's job.
 */
async function checkDocument(overBudget) {
  const path = join(root, map.document);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    failures.push([
      `${map.document} is missing, and ${MAP_NAME} names it as the prose half of this map.`,
      "",
      "  A roster of paths with no document beside it is a list nobody reads. Write it, or point \"document\" at the",
      "  file that replaced it.",
    ].join("\n"));
    return;
  }
  const expected = [];
  for (const [name, entry] of Object.entries(map.packages)) {
    for (const directory of Object.keys(entry.directories)) expected.push(`packages/${name}/src/${directory}/`);
  }
  expected.push(...overBudget.keys());
  for (const needle of expected.sort(byCodeUnit)) {
    if (text.includes(needle)) continue;
    failures.push([
      `${map.document} does not name ${needle}, and ${MAP_NAME} declares it.`,
      "",
      "  The two halves describe one map: the roster says a directory exists, the document says what a reader will find",
      "  in it. Add the row — or delete the declaration, if the concept turned out not to need one.",
    ].join("\n"));
  }
}

/**
 * Rule (c): no two modules of one package reach each other. Tarjan over the
 * relative value-import graph, per package, with any edge `allowedCycles` names
 * removed first — and a listed edge that is not in the tree reported, because
 * an exemption for something that is not there is a licence nobody read.
 */
function checkCycles() {
  const allowed = new Set();
  for (const edge of map.allowedCycles) {
    const from = join(root, edge.from);
    const to = join(root, edge.to);
    if (!(imports.get(from) ?? []).includes(to)) {
      failures.push([
        `${MAP_NAME} allows the import ${edge.from} → ${edge.to}, and ${edge.from} does not import ${edge.to}.`,
        "",
        '  The edge is gone, so the exemption goes with it. Delete it from "allowedCycles".',
      ].join("\n"));
      continue;
    }
    allowed.add(`${from} ${to}`);
  }

  let total = 0;
  for (const package_ of packages) {
    const members = new Set(package_.files);
    const graph = new Map();
    for (const file of package_.files) {
      const targets = (imports.get(file) ?? []).filter((target) => members.has(target) && !allowed.has(`${file} ${target}`));
      total += targets.length;
      graph.set(file, targets);
    }
    for (const cycle of stronglyConnected(package_.files, graph)) {
      const paths = cycle.map(display).sort(byCodeUnit);
      const directories = new Set(paths.map((path) => path.slice(0, path.lastIndexOf("/"))));
      failures.push([
        directories.size === 1
          ? `${[...directories][0]}/ has an import cycle: ${paths.map((path) => path.slice(path.lastIndexOf("/") + 1)).join(" ↔ ")}.`
          : `packages/${package_.name}/src has an import cycle across ${directories.size} directories: ${paths.join(" ↔ ")}.`,
        "",
        "  Two modules that import each other are one module with two names — a reader who opens either has not bounded",
        "  what they must read, which is the whole reason the file was split (D114 P4 R4b: 协作者模块之间不得成环).",
        "",
        "  Break it the way R4b and R6 did: move the name both sides read down into a module both sides import",
        "  (`project/scc.ts`, `desktop/window-kind.ts`), or pass it in as a parameter so that one side stops importing the",
        "  other. Re-export it from the old path if anything outside imported it there.",
      ].join("\n"));
    }
  }
  return total;
}

/** Tarjan, iterative: a chain of imports is as deep as the package is wide. */
function stronglyConnected(nodes, graph) {
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let counter = 0;
  for (const start of nodes) {
    if (index.has(start)) continue;
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);
    const work = [{ node: start, next: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const targets = graph.get(frame.node) ?? [];
      if (frame.next < targets.length) {
        const target = targets[frame.next];
        frame.next += 1;
        if (!index.has(target)) {
          index.set(target, counter);
          low.set(target, counter);
          counter += 1;
          stack.push(target);
          onStack.add(target);
          work.push({ node: target, next: 0 });
        } else if (onStack.has(target)) low.set(frame.node, Math.min(low.get(frame.node), index.get(target)));
        continue;
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component = [];
        for (;;) {
          const member = stack.pop();
          onStack.delete(member);
          component.push(member);
          if (member === frame.node) break;
        }
        // A module that imports itself is a cycle of one; every other component
        // worth reporting has more than one member in it.
        if (component.length > 1 || (graph.get(frame.node) ?? []).includes(frame.node)) components.push(component);
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1];
        low.set(parent.node, Math.min(low.get(parent.node), low.get(frame.node)));
      }
    }
  }
  return components;
}

/**
 * Rule (d): a composition root is exempt from the file cap and from nothing
 * else. A function inside one that is over the function cap has to be named,
 * with the role — host constructor or dispatcher — that D115's revision says is
 * the reason a root is allowed to be long at all.
 */
function checkCompositionRootSegments() {
  for (const [path, entry] of Object.entries(map.compositionRoots).sort(([left], [right]) => byCodeUnit(left, right))) {
    const measured = segments.get(join(root, path));
    if (measured === undefined) continue;
    const declared = entry.segments;
    const over = new Map(measured.filter((found) => found.lines > FUNCTION_LIMIT).map((found) => [found.name, found]));
    for (const [name, found] of [...over].sort(([left], [right]) => byCodeUnit(left, right))) {
      const segment = declared[name];
      if (segment === undefined) {
        failures.push([
          `${path}:${found.line} ${name} is ${found.lines} lines, and ${path} is a composition root.`,
          "",
          `  A root is exempt from the ${FILE_LIMIT}-line file cap because it holds only state, the \`protected\` seams,`,
          `  host constructors and dispatchers — none of which is long. It is not exempt from the ${FUNCTION_LIMIT}-line`,
          "  function cap, and a function this size inside one is logic that came back. Move it to a collaborator under",
          "  D115 §三's layout. If it really is a host constructor or a dispatcher that cannot be shorter, name it:",
          "",
          `      ${MAP_NAME} → "compositionRoots": { ${JSON.stringify(path)}: { "segments": { ${JSON.stringify(name)}: { "role": "dispatcher", "ceiling": ${found.lines} } } } }`,
          "",
          `  \`role\` is ${SEGMENT_ROLES.map((role) => JSON.stringify(role)).join(" or ")}, and naming one is a decision; say so in the commit.`,
        ].join("\n"));
        continue;
      }
      if (found.lines > segment.ceiling) {
        failures.push([
          `${path}:${found.line} ${name} is ${found.lines} lines, and ${MAP_NAME} caps it at ${segment.ceiling} — it grew by ${found.lines - segment.ceiling}.`,
          "",
          "  A named segment of a composition root may shrink and may not grow; that is the whole content of the exemption.",
          "  A new arm belongs in the collaborator it dispatches to, which is also how the next reader finds that arm.",
        ].join("\n"));
      }
    }
    for (const name of Object.keys(declared).sort(byCodeUnit)) {
      if (over.has(name)) continue;
      const found = measured.find((candidate) => candidate.name === name);
      failures.push([
        found === undefined
          ? `${MAP_NAME} names ${JSON.stringify(name)} as a segment of ${path}, and this gate finds no such top-level function there.`
          : `${MAP_NAME} names ${JSON.stringify(name)} as a segment of ${path}, and it is ${found.lines} lines — within the ${FUNCTION_LIMIT}-line cap.`,
        "",
        `  ${found === undefined ? "It was renamed, moved, or removed." : "It has been earned back."} Delete this line from that root's "segments":`,
        "",
        `      ${JSON.stringify(name)}: …`,
        "",
        "  An empty `segments` is what a composition root is supposed to look like.",
      ].join("\n"));
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

function report() {
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const roots = Object.entries(map.compositionRoots).sort(([left], [right]) => byCodeUnit(left, right));
  const remainders = Object.keys(map.remainders).sort(byCodeUnit);
  const named = (path) => `${path.slice(path.lastIndexOf("/") + 1)} ${lines.get(join(root, path)) ?? "?"}`;
  const kept = roots.reduce((total, [, entry]) => total + Object.keys(entry.segments).length, 0);
  return [
    `Module map (${DECISION} §二, R6): ${packages.length} packages, ${declaredDirectories} declared directories,`
    + ` ${allFiles.length} source files read in ${elapsed}s`,
    "  directories : every directory holding source is declared, and every declared directory holds source",
    `  over budget : ${roots.length} composition root${roots.length === 1 ? "" : "s"}`
    + `${roots.length === 0 ? "" : ` (${roots.map(([path]) => named(path)).join(", ")})`}`
    + ` and ${remainders.length} remainder${remainders.length === 1 ? "" : "s"}`
    + `${remainders.length === 0 ? "" : ` (${remainders.map(named).join(", ")})`}, matching ${ALLOWLIST_NAME}`,
    `  segments    : ${kept} function${kept === 1 ? "" : "s"} over ${FUNCTION_LIMIT} lines inside a composition root`,
    `  document    : ${map.document} names every declared directory and every over-budget file`,
    `  cycles      : 0 among ${allFiles.length} modules and ${edges} relative value imports`
    + `${map.allowedCycles.length === 0 ? ", with no allowed edges" : `, with ${map.allowedCycles.length} allowed edge(s)`}`,
    `module-map: the tree matches ${MAP_NAME}; ${DOCUMENT} is the prose half`,
  ].join("\n");
}

function fail(problems) {
  process.stderr.write(`The module map does not describe this repository (${DECISION} §二, R6):\n\n${problems.join("\n\n")}\n`);
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
