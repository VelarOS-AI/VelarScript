import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_PRELUDE_NAMES, PERMANENT_NAMESPACE_NAMES, permanentNamespaceCoveringModule } from "@velarscript/compiler";
import { Parser } from "@velarscript/compiler/extension";
import { isNodeOnlyModule } from "@velarscript/node/compiler";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleInterfaces } from "../packages/cli/src/standard-modules.ts";
import { Lexer } from "../packages/compiler/src/lexer.ts";
import { forbiddenSourceIdentifiers } from "../packages/compiler/src/source-names.ts";
import { keywordKinds } from "../packages/compiler/src/token.ts";
import { typeParameterBoundNames } from "../packages/compiler/src/types.ts";
import { LOOK_ABSENT_MEDIA_SUBJECTS, LOOK_EXCLUDED_PROPERTIES, LOOK_HOOKS, LOOK_MEDIA_SUBJECTS, LOOK_PROPERTIES, LOOK_TARGETS } from "../packages/web/src/look.ts";

/**
 * D56 rule 129 — "the tour shows every usage" is a sentence anyone can write.
 * This gate makes it checkable: it *reverse-queries the compiler's own closed
 * vocabulary tables* and asserts, name by name, that each one is exercised in
 * `examples/tour/`. A missing name is named in the failure.
 *
 * Two disciplines hold the whole thing up, and both are easy to lose:
 *
 *  1. **No hand-kept list.** Every required name below is read out of a
 *     compiler-owned table at run time — `keywordKinds`, the extensions' own
 *     `contextualKeywords` / `reservedBindings` / `numericSuffixes` / `globals`,
 *     `standardModuleInterfaces(extensions)`, `core-vocabulary.ts`,
 *     `typeParameterBoundNames`, and the Look tables. A hand-kept copy drifts,
 *     and drift is silent — D57 rule 134 named that failure family, and this
 *     repository has already repaired five instances of it. If you find
 *     yourself typing a name into this file, you are writing the next one.
 *
 *  2. **Judgment is by parsed and resolved evidence, never by text search.**
 *     A hard keyword counts when the *lexer* emits its token; a contextual
 *     keyword counts when the *parser* claims it as syntax rather than as a
 *     name; a standard-module export counts when the *project driver* resolved
 *     an import of it; `Text.slug` counts when the parsed member access sits on
 *     an identifier that resolved to no binding, i.e. the resident namespace.
 *     Grepping for `Text.slug` would let a file that declares a local record
 *     named `Text` forge coverage. (D57 rule 135 made that particular forgery
 *     impossible, but the judgment still has to be the right one.)
 *
 * The two traps the inventory (D56-TOUR-INVENTORY) warns about are structural
 * here rather than remembered:
 *
 *  - `velar/math`, `velar/json`, `velar/text` and `velar/async` publish nothing
 *    importable — every member reads as `Math.` / `Json.` / `Text.` /
 *    `Promise.`, and an `import` of them is VEL3008. The split is not spelled
 *    out below; it is asked of `permanentNamespaceCoveringModule`, the same
 *    roster the compiler rejects those imports with.
 *  - `velar/http` exports `secretHeader` on Node and `formBody` on the Web, so
 *    the required inventory is keyed by **(module, target)** and unioned. Key
 *    it by module name and one target's table silently overwrites the other's
 *    — the exact shape of the miscount that made a recent extension audit
 *    report 30 surfaces where there were 36.
 *
 * Exemptions are D56 rule 133's, copied with their reasons, and they live here
 * rather than in the tour so that "what we do not cover" is legible in one
 * place. They are applied as *subtractions with a report*: if a future change
 * puts an exempt family back into a required table, the exemption fires
 * visibly instead of hiding the name.
 *
 * Usage: `node scripts/check-tour-coverage.mjs [tour-root]`. The optional root
 * exists so the gate can be pointed at a mutated copy of the tour and shown to
 * go red — a coverage gate that checks nothing fails silently, so proving it
 * fails is part of owning it.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tourRoot = process.argv[2] ? resolve(process.argv[2]) : join(root, "examples", "tour");

// ── Vacuity floors ──────────────────────────────────────────────────────────
// The worst failure of a coverage gate is not a red build, it is a green one
// that checked nothing: a table read empty, a tour directory that moved, a
// parse that quietly produced no AST. These are minimums, not the truth — the
// truth is whatever the tables say today. Growing the language raises the real
// counts and leaves these alone; shrinking a table below its floor is a
// deliberate act that must be acknowledged here.
const FLOORS = Object.freeze({
  projects: 3,
  modules: 41,
  "hard-keyword": 40,
  "contextual-keyword": 10,
  "reserved-binding": 6,
  "numeric-suffix": 13,
  "extension-global": 3,
  "permanent-namespace": 4,
  "prelude-name": 5,
  "namespace-member": 66,
  "module-export": 236,
  "type-parameter-bound": 3,
  "look-property": 225,
  "look-hook": 9,
  "look-target": 7,
  "look-media-feature": 5,
});

// ── D56 rule 133: the exemption table, with its decided reasons ─────────────
// Every entry names something a *compiling* tour cannot contain. Nothing here
// is an excuse for a spelling that could have been shown.
//
// Each exemption withholds names from *named categories only*. That scoping is
// load-bearing rather than tidy: `is` and `pass` are reserved enum member names
// and also two of the forty hard keywords, and `display` is both a Look
// property and a media feature Look omits. An exemption that matched on the
// bare spelling everywhere would quietly stop requiring all three.
const REVERSE_CORPUS = "reverse corpus — observable only in a rejection, so a tour that compiles cannot contain it; it belongs in tests/corpus/";
const exemptions = [
  {
    label: "charter §19 'deliberately absent' table, forbiddenSourceIdentifiers, web forbiddenIdentifiers",
    reason: REVERSE_CORPUS,
    // Read from the compiler and from each extension rather than restated, so
    // the exemption tracks the tables it exempts. It withholds nothing: this
    // gate reverse-queries the *positive* vocabulary, and a refused spelling is
    // by construction absent from it. Naming the family here is the point —
    // "what the tour does not cover" is legible in one place.
    withheldFrom: [],
    names: (context) => new Set([
      ...forbiddenSourceIdentifiers.keys(),
      ...context.extensions.flatMap((extension) => Object.keys(extension.lexical?.forbiddenIdentifiers ?? {})),
    ]),
  },
  {
    label: "the 4x3 grant table's unbounded row",
    reason: "boundGrants(null, …) is constantly false; it shows up only in the rejection of `def f<T>(v: T) -> string: return f\"{v}\"`. The three bound names themselves are required.",
    withheldFrom: [],
    names: () => new Set(),
  },
  {
    label: "Look's excluded properties",
    reason: REVERSE_CORPUS,
    withheldFrom: ["look-property"],
    names: () => new Set(LOOK_EXCLUDED_PROPERTIES.keys()),
  },
  {
    label: "Look's excluded media subjects",
    reason: REVERSE_CORPUS,
    withheldFrom: ["look-media-feature"],
    names: () => new Set(LOOK_ABSENT_MEDIA_SUBJECTS),
  },
  {
    label: "enum and class reserved member names",
    reason: REVERSE_CORPUS,
    // memberNameRestriction() owns these; they are member spellings a
    // declaration may not use, never names the tour is asked to write.
    withheldFrom: [],
    names: () => new Set(["is", "parse", "values", "pass", "constructor"]),
  },
  {
    label: "velar.json configuration vocabulary",
    reason: "not source-language spelling; the tour's three manifests are corpus, but this gate does not read them",
    withheldFrom: [],
    names: () => new Set(),
  },
  {
    label: "velar/javascript and velar/text-buffer",
    reason: "migrated out of velar/*; ordinary npm packages now, so not standard-library vocabulary",
    withheldFrom: ["module-export", "namespace-member"],
    names: () => new Set(["velar/javascript", "velar/text-buffer"]),
    // Module categories are keyed '<source> <name>', so a whole module is
    // withheld by its source.
    matches: (names, key) => names.has(key.slice(0, key.indexOf(" "))),
  },
  {
    label: "`import js` naming a real third-party npm package",
    reason: "the repository carries no third-party runtime dependency; `node:crypto` already exercises js/unsafe/extern/module",
    withheldFrom: [],
    names: () => new Set(),
  },
];

// D56 rule 133's second family is deliberately *not* an exemption here:
// `velar/host.exit`, `serve`, `process.start`, `terminal.close`,
// `browser.open` and `files.download` are exempt from being *executed*, not
// from being *written*. The tour writes them inside `def`s nobody calls, and
// this gate reads spellings, so it still requires every one of them.

// ── Vocabulary this gate cannot reverse-query, and why ─────────────────────
// Not an exemption — nobody decided these are out of scope. They are holes,
// printed on every run so they stay visible instead of being mistaken for
// coverage. Closing one means giving the compiler a readable table, which is a
// change to `packages/**` and therefore somebody's decision to make.
const unreachableTables = [
  {
    label: "Core's own contextual keywords (`type`, `match`, `case`, `from`, `as`, `test`, `using`, …)",
    reason: "no enumerable table exists: `parser.ts` keeps `statementStarterWords` (one word, `match`) module-private and recognizes the rest as inline literals at each shape. D56 rule 129 lists this as a source; the code does not provide one. Extension contextual keywords ARE checked — they come from `lexical.contextualKeywords`.",
  },
  {
    label: "Core's built-in numeric suffixes `ms` and `s`",
    reason: "`Lexer` holds them in a private field. They are required here only because the Web extension republishes both through LOOK_UNIT_TYPES; a Core-only checkout would check neither.",
  },
];

const failures = [];
const categories = new Map();

function require_(category, key, spelling, table) {
  const entry = categories.get(category) ?? { required: new Map(), covered: new Set() };
  categories.set(category, entry);
  const item = entry.required.get(key) ?? { spelling, tables: new Set() };
  // Every target that declares a name is recorded, so the failure for
  // `secretHeader` says Core and the failure for `formBody` says Web and
  // Desktop — the (module, target) keying stays visible in the message.
  item.tables.add(table);
  entry.required.set(key, item);
}

function observe(category, key) {
  const entry = categories.get(category) ?? { required: new Map(), covered: new Set() };
  categories.set(category, entry);
  entry.covered.add(key);
}

// ── 1. Read the tour exactly as the compiler reads it ───────────────────────

const projectRoots = (await tourProjectRoots(tourRoot)).sort();
if (projectRoots.length < FLOORS.projects) {
  console.error(`Found ${projectRoots.length} tour project(s) under ${display(tourRoot)}; expected at least ${FLOORS.projects}. This gate cannot pass vacuously.`);
  process.exit(1);
}

/** Every extension any tour target loads — the exemption tables read this. */
const allExtensions = [];
let moduleCount = 0;

for (const projectRoot of projectRoots) {
  const config = await resolveVelarProject(projectRoot);
  const extensions = config.compilerExtensions;
  for (const extension of extensions) if (!allExtensions.includes(extension)) allExtensions.push(extension);

  // ── The required inventory for this target ──
  requireTargetVocabulary(config);

  // ── What the target's sources actually contain ──
  const sources = await velarSources(config);
  moduleCount += sources.length;

  // The project driver is the authority on which imports resolved to what, so
  // coverage of a standard-module export is read off its semantic index rather
  // than off the import statement's text. Test roots are compiled separately
  // for the same reason `velar check` does: no import reaches them.
  const indexes = new Map();
  const compiles = [config.entryPath, ...sources.filter((path) => path.endsWith(".test.vel"))];
  for (const entry of compiles) {
    const compiled = await compileProject(entry, new Map(), {
      sourceRoot: config.root,
      projectRoot: config.root,
      publicRoot: config.publicDir,
      extensions,
      extensionConfig: config.extensionConfig,
      framework: config.framework,
      exportTestFunctions: true,
    });
    for (const failure of compiled.failures) failures.push(`${display(failure.path)}: ${failure.message}`);
    for (const module of compiled.modules) {
      for (const item of module.result.diagnostics) failures.push(`${display(module.inputPath)}: ${item.code} ${item.message}`);
      if (!indexes.has(module.inputPath)) indexes.set(module.inputPath, module.result.semanticIndex);
    }
  }

  const lexicalExtensions = extensions.flatMap((extension) => extension.lexical ? [extension.lexical] : []);
  const contextualKeywords = new Set(lexicalExtensions.flatMap((extension) => [...extension.contextualKeywords ?? []]));
  const parserExtension = extensions.find((extension) => extension.parser);

  for (const path of sources) {
    const text = await readFile(path, "utf8");
    const lexed = new Lexer(text, lexicalExtensions).lex();
    const parser = parserExtension?.parser?.create(lexed.tokens, lexicalExtensions) ?? new Parser(lexed.tokens, lexicalExtensions);
    const parsed = parser.parse();
    if (lexed.diagnostics.length > 0 || parsed.diagnostics.length > 0) {
      failures.push(`${display(path)}: the coverage gate could not re-read this module (${[...lexed.diagnostics, ...parsed.diagnostics].map((item) => item.code).join(", ")})`);
      continue;
    }
    const index = indexes.get(path);
    if (index === undefined) {
      // D56 rule 128: `velar check` never looks at a module the entry cannot
      // reach, so a chapter nobody imports silently loses its coverage. Say so
      // rather than reading it anyway.
      failures.push(`${display(path)}: no import reaches this module and it is not a '*.test.vel' root, so the compiler never checks it — import it from the tour entry`);
      continue;
    }
    observeModule({ path, text, tokens: lexed.tokens, program: parsed.program, index, contextualKeywords });
  }
}

if (moduleCount < FLOORS.modules) {
  failures.push(`The tour holds ${moduleCount} modules; expected at least ${FLOORS.modules}. This gate cannot pass vacuously.`);
}

// ── 2. Exemptions, applied as visible subtractions ──────────────────────────

const firedExemptions = [];
for (const exemption of exemptions) {
  const names = exemption.names({ extensions: allExtensions });
  const matches = exemption.matches ?? ((set, key) => set.has(key));
  const removed = [];
  for (const category of exemption.withheldFrom) {
    const entry = categories.get(category);
    if (entry === undefined) {
      failures.push(`Exemption '${exemption.label}' withholds from category '${category}', which no table produced. One of the two moved.`);
      continue;
    }
    for (const [key, item] of entry.required) {
      if (!matches(names, key)) continue;
      entry.required.delete(key);
      removed.push(item.spelling);
    }
  }
  firedExemptions.push({ ...exemption, removed });
}

// ── 3. The verdict ─────────────────────────────────────────────────────────

let checked = 0;
const summary = [];
for (const [category, entry] of [...categories].sort()) {
  const missing = [...entry.required]
    .filter(([key]) => !entry.covered.has(key))
    .map(([, item]) => item);
  checked += entry.required.size;
  const floor = FLOORS[category];
  if (floor === undefined) {
    failures.push(`Category '${category}' has no vacuity floor; add one to FLOORS so an empty table cannot pass.`);
  } else if (entry.required.size < floor) {
    failures.push(`Category '${category}' required only ${entry.required.size} names; expected at least ${floor}. A vocabulary table read short or empty.`);
  }
  summary.push(`  ${category.padEnd(22)} ${String(entry.required.size - missing.length).padStart(4)}/${String(entry.required.size).padEnd(4)} from ${entry.required.size === 0 ? "-" : tablesOf(entry)}`);
  for (const item of missing.sort((left, right) => left.spelling.localeCompare(right.spelling))) {
    failures.push(`${category}: ${item.spelling} — declared by ${[...item.tables].sort().join(", ")}, and no module in ${display(tourRoot)} uses it`);
  }
}

const report = [
  `Checked ${checked} compiler-declared names against ${moduleCount} modules in ${projectRoots.length} tour projects:`,
  ...summary,
  "Exempt (D56 rule 133):",
  ...firedExemptions.flatMap((exemption) => [
    `  ${exemption.label}${exemption.removed.length > 0 ? ` — withheld ${exemption.removed.length}: ${[...new Set(exemption.removed)].sort().join(", ")}` : ""}`,
    `      ${exemption.reason}`,
  ]),
  "Not reverse-queryable (holes, not exemptions):",
  ...unreachableTables.flatMap((table) => [`  ${table.label}`, `      ${table.reason}`]),
].join("\n");

if (failures.length > 0) {
  // The count report prints on failure too: a gate that only says what is
  // missing leaves the reader unable to see whether it looked at anything.
  console.error(`${report}\n\nThe usage tour does not cover the language surface (D56 rule 129):\n\n${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  console.log(report);
}

// ── The required inventory, read off the compiler ──────────────────────────

/**
 * Everything one target declares. Called once per tour project, so a name that
 * only one target publishes — `secretHeader` on Node, `formBody` on the Web —
 * enters the inventory from the target that has it instead of being overwritten
 * by whichever table was read last.
 */
function requireTargetVocabulary(config) {
  const extensions = config.compilerExtensions;
  const target = display(config.manifestPath ? dirname(config.manifestPath) : config.root);

  for (const spelling of Object.keys(keywordKinds)) {
    require_("hard-keyword", spelling, spelling, "keywordKinds in packages/compiler/src/token.ts");
  }
  for (const name of typeParameterBoundNames) {
    require_("type-parameter-bound", name, `<T: ${name}>`, "typeParameterBoundNames in packages/compiler/src/types.ts");
  }
  for (const name of PERMANENT_NAMESPACE_NAMES) {
    require_("permanent-namespace", name, name, "PERMANENT_NAMESPACE_NAMES in packages/compiler/src/core-vocabulary.ts");
  }
  for (const name of CORE_PRELUDE_NAMES) {
    require_("prelude-name", name, name, "CORE_PRELUDE_NAMES in packages/compiler/src/core-vocabulary.ts");
  }

  for (const extension of extensions) {
    for (const word of extension.lexical?.contextualKeywords ?? []) {
      require_("contextual-keyword", word, word, `${extension.id} lexical.contextualKeywords`);
    }
    for (const suffix of extension.lexical?.numericSuffixes ?? []) {
      require_("numeric-suffix", suffix, `1${suffix}`, `${extension.id} lexical.numericSuffixes`);
    }
    for (const name of extension.analysis?.reservedBindings ?? []) {
      require_("reserved-binding", name, name, `${extension.id} analysis.reservedBindings`);
    }
    for (const name of extension.analysis?.globals?.keys() ?? []) {
      require_("extension-global", name, name, `${extension.id} analysis.globals`);
    }
  }
  // Core owns `ms` and `s` with or without an extension (D39-52). The Lexer
  // keeps that pair private, so it is required through the Duration unit type
  // an extension publishes rather than restated; a Core-only checkout would
  // not see them at all, which is recorded in this gate's report.

  // The standard modules this target admits, and every name each publishes.
  const capabilities = new Set(extensions.flatMap((extension) => extension.capabilities ?? []));
  const web = capabilities.has("web") || config.framework?.host?.target === "browser";
  const interfaces = standardModuleInterfaces(extensions);

  // Look's own tables, required of the targets that publish `velar/look`. The
  // 20 builders and the 17 public type names are not listed here: they are
  // that module's exports, so the module walk below already requires every one
  // of them by the spelling that imports it.
  if (interfaces.has("velar/look")) {
    for (const name of LOOK_PROPERTIES) require_("look-property", name, `${name}:`, "LOOK_PROPERTY_GROUPS in packages/web/src/look.ts");
    for (const name of LOOK_HOOKS) require_("look-hook", name, `@${name}`, "LOOK_HOOKS in packages/web/src/look.ts");
    for (const name of LOOK_TARGETS) require_("look-target", name, `@${name}`, "LOOK_TARGETS in packages/web/src/look.ts");
    for (const [subject, features] of LOOK_MEDIA_SUBJECTS) {
      for (const feature of features) {
        require_("look-media-feature", `${subject}.${feature}`, `${subject}.${feature}`, "LOOK_MEDIA_SUBJECTS in packages/web/src/look.ts");
      }
    }
  }
  for (const [source, interface_] of interfaces) {
    // The project driver's own rule for a module this target cannot import.
    const owned = extensions.some((extension) => extension.id !== "@velarscript/node" && extension.modules?.interfaces.has(source));
    if (isNodeOnlyModule(source) && web && !owned) continue;
    const names = new Set([
      ...interface_.exports.keys(),
      ...interface_.classes.keys(),
      ...interface_.namedTypes.keys(),
      ...interface_.enums.keys(),
      ...interface_.typeAliases.keys(),
    ]);
    // D56-TOUR-INVENTORY trap 3: a module whose every export retired behind a
    // resident namespace is not importable at all, so requiring an import line
    // for it would red-flag four modules that are correctly covered by prefix.
    const namespace = permanentNamespaceCoveringModule(source, interface_.exports.keys());
    for (const name of names) {
      if (namespace) require_("namespace-member", `${namespace}.${name}`, `${namespace}.${name}`, `${source} (${target})`);
      else require_("module-export", `${source} ${name}`, `import {${name}} from "${source}"`, `${source} (${target})`);
    }
  }
}

// ── What the tour actually contains, judged after lexing and parsing ───────

function observeModule({ tokens, program, index, contextualKeywords }) {
  // (a) Hard keywords: the lexer's own verdict. A keyword inside a string or a
  //     comment never becomes a token, so this cannot be forged by prose.
  const keywordSpellings = new Map(Object.entries(keywordKinds).map(([spelling, kind]) => [kind, spelling]));
  for (const token of tokens) {
    const spelling = keywordSpellings.get(token.kind);
    if (spelling !== undefined) observe("hard-keyword", spelling);
  }

  // (b) Contextual keywords: an ordinary identifier until a declaration shape
  //     claims it. The parser's verdict is legible in the semantic index —
  //     a word the parser consumed as syntax is neither a reference nor a
  //     declared name at that offset, while `const state = 1` (the tour's
  //     chapter on exactly this) leaves a symbol there and does not count.
  const named = new Set();
  for (const reference of index.references) named.add(reference.span.start);
  for (const reference of index.memberReferences) named.add(reference.span.start);
  for (const symbol of index.symbols) named.add(symbol.selectionSpan.start);
  for (const token of tokens) {
    if (token.kind !== "identifier" || !contextualKeywords.has(token.value)) continue;
    if (!named.has(token.span.start)) observe("contextual-keyword", token.value);
  }

  // (c) Standard-module exports: what the project driver resolved, not what
  //     the import line says. A namespace import counts for the members it is
  //     actually read through, so `collections.groupBy(...)` covers `groupBy`.
  const namespaceLocals = new Map();
  for (const imported of index.imports) {
    if (imported.namespace) namespaceLocals.set(imported.local, imported.source);
    else observe("module-export", `${imported.source} ${imported.imported}`);
  }

  // (d) Everything the parse tree owns. The walk is generic: it reads the node
  //     shapes the AST publishes, so a new Look entry kind or a new unit
  //     literal is seen without teaching this function about it.
  const unbound = new Set(index.references.filter((reference) => reference.symbolId === null).map((reference) => reference.span.start));
  walk(program, (node) => {
    if (node.kind === "MemberExpression" && node.object?.kind === "IdentifierExpression") {
      const base = node.object.name;
      // A resident namespace resolves to no binding. `Text.slug` written on a
      // locally declared record named `Text` would bind, and would not count.
      if (unbound.has(node.object.span.start)) {
        observe("namespace-member", `${base}.${node.property}`);
        if (LOOK_MEDIA_SUBJECTS.has(base)) {
          observe("look-media-feature", `${base}.${node.property}`);
          // LOK-D4: a media subject is matched by name inside a Look condition
          // ahead of ordinary lexical resolution, which is the whole reason the
          // three subject names are reserved bindings in a Web module.
          observe("reserved-binding", base);
        }
      }
      const source = namespaceLocals.get(base);
      if (source !== undefined) observe("module-export", `${source} ${node.property}`);
    }
    if (node.kind === "IdentifierExpression" && unbound.has(node.span.start)) {
      observe("permanent-namespace", node.name);
      observe("prelude-name", node.name);
      observe("extension-global", node.name);
      observe("reserved-binding", node.name);
    }
    if (node.kind === "LookProperty") observe("look-property", node.name);
    if (node.kind === "LookTarget") observe("look-target", node.name);
    if (typeof node.unit === "string") observe("numeric-suffix", node.unit);
    // `@hover` and the other eight condition hooks are the one Look name the
    // AST spells in a node kind rather than in a shared field.
    if (typeof node.kind === "string" && node.kind.endsWith(":look-hook")) observe("look-hook", node.name);
    // A type parameter's bound. `TypeParameterDeclaration` carries no `kind`,
    // which is why the walk below visits every object rather than only tagged
    // nodes — the three bounds live nowhere else in the tree.
    if (typeof node.bound === "string") observe("type-parameter-bound", node.bound);
  });

}

function walk(node, visit, seen = new Set()) {
  if (node === null || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, seen);
    return;
  }
  visit(node);
  for (const value of Object.values(node)) walk(value, visit, seen);
}

// ── Reading the tour's directories the way the CLI reads a project ─────────

async function tourProjectRoots(directory) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  if (entries.some((entry) => entry.isFile() && entry.name === "velar.json")) found.push(directory);
  for (const entry of entries) {
    if (entry.isDirectory() && !["node_modules", "dist", ".velar"].includes(entry.name)) {
      found.push(...await tourProjectRoots(join(directory, entry.name)));
    }
  }
  return found;
}

/** Every `.vel` file in a project — the same walk `velar check` performs. */
async function velarSources(config) {
  const output = [];
  const excluded = new Set([config.outDir, config.publicDir]);
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if ([".git", "node_modules", ".velar"].includes(entry.name) || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".vel")) {
        output.push(path);
      }
    }
  };
  await visit(config.root);
  return output.sort();
}

function tablesOf(entry) {
  const tables = new Set([...entry.required.values()].flatMap((item) => [...item.tables]));
  return tables.size <= 2 ? [...tables].sort().join(", ") : `${tables.size} tables`;
}

function display(path) {
  const value = relative(root, path);
  return value && !value.startsWith("..") ? value : path;
}
