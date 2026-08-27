import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CORE_CONTEXTUAL_KEYWORD_WORDS,
  CORE_NUMERIC_SUFFIXES,
  CORE_PRELUDE_NAMES,
  PERMANENT_NAMESPACE_NAMES,
  permanentNamespaceCoveringModule,
} from "@velarscript/compiler";
import { Parser } from "@velarscript/compiler/extension";
import { isNodeOnlyModule } from "@velarscript/node/compiler";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleInterfaces } from "../packages/cli/src/standard-modules.ts";
import { CORE_STATEMENT_CONSTRUCTS, coreStatementConstructKey } from "../packages/compiler/src/ast.ts";
import { Lexer } from "../packages/compiler/src/lexer.ts";
import { forbiddenSourceIdentifiers } from "../packages/compiler/src/source-names.ts";
import { keywordKinds } from "../packages/compiler/src/token.ts";
import { TYPE_PARAMETER_DECLARATION_FORMS } from "../packages/compiler/src/core-vocabulary.ts";
import { typeParameterBoundNames } from "../packages/compiler/src/types.ts";
import { BROWSER_TEST_MODULE } from "../packages/web/src/browser-test.ts";
import { LOOK_ABSENT_MEDIA_SUBJECTS, LOOK_EXCLUDED_PROPERTIES, LOOK_HOOKS, LOOK_MEDIA_SUBJECTS, LOOK_PROPERTIES, LOOK_TARGETS } from "../packages/web/src/look.ts";

const CORE_STATEMENT_KINDS = new Set(Object.keys(CORE_STATEMENT_CONSTRUCTS).map((key) => key.split(":", 1)[0]));

/**
 * D56 rule 129 — "the tour shows every usage" is a sentence anyone can write.
 * This gate makes it checkable: it *reverse-queries the compiler's own closed
 * vocabulary tables* and asserts, name by name, that each one is exercised in
 * `examples/tour/`. A missing name is named in the failure.
 *
 * Seventeen of the eighteen categories below ask about a **name**. The
 * eighteenth asks about a **construct**, and it exists because names turned out
 * not to be enough: D53 rule 117 added `extern js(…)` and `unsafe js` out of
 * `extern`, `js`, and `unsafe` — three keywords chapter 13 already exercised
 * through `extern module` and `import js unsafe` — so two new declaration forms
 * reached a release with no `.vel` file anywhere using them while this gate
 * stayed green. A construct assembled from covered spellings is invisible to a
 * spelling-by-spelling check. `statement-construct` reads the AST unions
 * themselves (`CORE_STATEMENT_CONSTRUCTS`, and each extension's own roster
 * through the protocol's `syntax` slot) so a form the parser can return has to
 * appear in the tour.
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
// D68 rule 176 names this chapter as the complete controller showcase. Keeping
// coverage scoped to it prevents a small Desktop smoke test from accidentally
// satisfying a member chapter 13 stopped teaching.
const WEB_TEST_TOUR_CHAPTER = join("web", "13-browser.browser.test.vel");

// ── Vacuity floors ──────────────────────────────────────────────────────────
// The worst failure of a coverage gate is not a red build, it is a green one
// that checked nothing: a table read empty, a tour directory that moved, a
// parse that quietly produced no AST. These are minimums, not the truth — the
// truth is whatever the tables say today. Growing the language raises the real
// counts and leaves these alone; shrinking a table below its floor is a
// deliberate act that must be acknowledged here.
const FLOORS = Object.freeze({
  projects: 4,
  modules: 43,
  "hard-keyword": 40,
  // Ten from the Web extension's `lexical.contextualKeywords` and ten from
  // Core's own roster (D62 rule 157). Before that roster existed the floor was
  // 10, and a Core-only checkout required none of Core's own words.
  "contextual-keyword": 21,
  // Five, not six: D90 R15(b) deleted `cached`, so the Web extension no longer
  // reserves it. A floor that shrinks is a deliberate act, which is why it is
  // acknowledged here rather than silently lowered.
  "reserved-binding": 5,
  "numeric-suffix": 13,
  // Two, not three, for the same reason — `cached` was one of the three.
  "extension-global": 2,
  "permanent-namespace": 4,
  "prelude-name": 5,
  "namespace-member": 66,
  "module-export": 236,
  // D68 rule 176: all four velar/web-test controllers are tour-owned. Read the
  // object fields out of the compiler interface so a newly published control
  // cannot land without chapter 13 demonstrating it.
  "web-test-member": 33,
  "type-parameter-bound": 3,
  // D55 rule 120: `def` and `type`. A form removed from the roster without a
  // ruling drops this below its floor rather than quietly checking less.
  "generic-declaration": 2,
  // The 26 members of `CoreStatement`, the Web extension's 16 refined
  // constructs, and Node's server declaration. `unsafe css` counts twice
  // because its `source` is a tagged union whose spellings are separately
  // required. Removing a
  // statement form from the language is what may lower this; an extension that
  // stops publishing `syntax` fails on its own terms above.
  "statement-construct": 38,
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
    reason: "not source-language spelling; the tour's four manifests are corpus, but this gate does not read them",
    withheldFrom: [],
    names: () => new Set(),
  },
  {
    label: "velar/javascript and velar/text-buffer",
    reason: "removed from the language; products own editor buffers and JavaScript/TypeScript tooling",
    withheldFrom: ["module-export", "namespace-member"],
    names: () => new Set(["velar/javascript", "velar/text-buffer"]),
    // Module categories are keyed '<source> <name>', so a whole module is
    // withheld by its source.
    // module-export keys carry their module; namespace-member keys do not, so
    // a whole module is withheld from the first by source and the second is
    // matched by its `Namespace.member` spelling.
    matches: (names, key) => names.has(moduleExportSource(key)),
  },
  {
    label: "`import js` naming a real third-party npm package",
    reason: "applications declare their own checked third-party boundaries; `node:crypto` remains the deliberate raw js/unsafe/extern/module example",
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
//
// D62 rules 157/158 closed the contextual-keyword and numeric-suffix holes;
// D79 closes the remaining four Core statement-form pairs through the
// compiler-owned `coreStatementConstructKey` projection. An empty list is the
// claim that today there is no vocabulary this gate cannot reach, and the next
// real hole belongs here.
const unreachableTables = [];

const failures = [];
const categories = new Map();
// Names a module imports and never references, keyed exactly as the required
// inventory keys them. An unused import is not coverage (see observeModule),
// but it is the most likely *reason* a name is missing, so the failure says
// where the dead import stands instead of leaving the reader to grep.
const unusedImports = new Map();

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

/**
 * Module categories are keyed by (module, name) rather than by name alone:
 * `velar/http` publishes `secretHeader` on Node and `formBody` on the Web, and
 * one target's table would otherwise overwrite the other's. The separator is a
 * character no module source and no identifier can contain. It is built here
 * rather than spelled at each site because the four places that write or read
 * these keys have to agree, and a copy of a key format drifts as silently as a
 * copy of a name list does.
 */
function moduleExportKey(source, name) {
  return `${source}\u0000${name}`;
}

/** The module half of a `moduleExportKey`. */
function moduleExportSource(key) {
  const separator = key.indexOf("\u0000");
  return separator < 0 ? key : key.slice(0, separator);
}

function recordUnusedImport(imported, path) {
  const key = moduleExportKey(imported.source, imported.imported);
  const where = unusedImports.get(key) ?? new Set();
  unusedImports.set(key, where);
  where.add(display(path));
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
  // than off the import statement's text. Extra roots are compiled separately
  // for the same reason `velar check` does it: no import reaches them. The
  // roster is the same one `check` uses — test modules, then whatever the
  // walk above found that nothing imported — so this gate reads exactly the
  // modules the compiler reads, and cannot report a chapter as uncovered on
  // the strength of a reachability rule the toolchain no longer has.
  const indexes = new Map();
  const compiles = [config.entryPath, ...sources.filter((path) => path.endsWith(".test.vel"))];
  const queued = new Set(compiles);
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
    // Once the declared roots are spent, whatever the walk found that none of
    // them reached becomes a root too — one at a time, because each compile may
    // itself cover several of the remainder. `for...of` over an array reads by
    // index, so an entry appended here is still visited.
    if (compiles.at(-1) !== entry) continue;
    const next = sources.find((path) => !indexes.has(path) && !queued.has(path));
    if (next !== undefined) {
      queued.add(next);
      compiles.push(next);
    }
  }

  const lexicalExtensions = extensions.flatMap((extension) => extension.lexical ? [extension.lexical] : []);
  // D62 rule 157: Core's roster joins the extensions' own, so the parser's
  // verdict is read for `type`, `match`, `case`, `from`, `as`, `test`,
  // `using`, `get`, `readonly` and `constructor` the same way it already was
  // for `component` and `look`.
  const contextualKeywords = new Set([
    ...CORE_CONTEXTUAL_KEYWORD_WORDS,
    ...lexicalExtensions.flatMap((extension) => [...extension.contextualKeywords ?? []]),
  ]);
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
      // Unreachable now means unreadable, not unchecked: `velar check` compiles
      // an unimported source as a root of its own, and the roster above does
      // the same, so every chapter should have arrived with an index. Reaching
      // here means this gate could not compile the module at all, which is a
      // gate defect rather than the D56 rule 128 reachability gap it used to be.
      failures.push(`${display(path)}: the coverage gate compiled no module for this source, so its spellings were never observed — this is a gate defect, not a missing import`);
      continue;
    }
    observeModule({
      path,
      text,
      tokens: lexed.tokens,
      program: parsed.program,
      index,
      contextualKeywords,
      syntaxExtensions: extensions.flatMap((extension) => extension.syntax ? [extension.syntax] : []),
    });
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
  const missing = [...entry.required].filter(([key]) => !entry.covered.has(key));
  checked += entry.required.size;
  const floor = FLOORS[category];
  if (floor === undefined) {
    failures.push(`Category '${category}' has no vacuity floor; add one to FLOORS so an empty table cannot pass.`);
  } else if (entry.required.size < floor) {
    failures.push(`Category '${category}' required only ${entry.required.size} names; expected at least ${floor}. A vocabulary table read short or empty.`);
  }
  summary.push(`  ${category.padEnd(22)} ${String(entry.required.size - missing.length).padStart(4)}/${String(entry.required.size).padEnd(4)} from ${entry.required.size === 0 ? "-" : tablesOf(entry)}`);
  // D90 R3(a): code-unit order, so this gate's report reads the same on two
  // machines that differ only in `LC_ALL`.
  for (const [key, item] of missing.sort((left, right) => left[1].spelling < right[1].spelling ? -1 : left[1].spelling > right[1].spelling ? 1 : 0)) {
    const imported = unusedImports.get(key);
    failures.push(`${category}: ${item.spelling} — declared by ${[...item.tables].sort().join(", ")}, and no module in ${display(tourRoot)} uses it`
      + (imported ? ` (${[...imported].sort().join(", ")} import${imported.size === 1 ? "s" : ""} the name and never reference${imported.size === 1 ? "s" : ""} it — an import is not a usage)` : ""));
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
  ...unreachableTables.length === 0
    ? ["  none — every vocabulary this gate names is read from a compiler-owned table"]
    : unreachableTables.flatMap((table) => [`  ${table.label}`, `      ${table.reason}`]),
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
  // D55 rule 120: which declaration forms take `<T>` is a compiler-owned
  // roster — the same one every refusal aimed at a form that does not take one
  // is worded from. A form added there without a tour example goes red here.
  for (const form of TYPE_PARAMETER_DECLARATION_FORMS) {
    require_("generic-declaration", form, `${form} Name<T>`, "TYPE_PARAMETER_DECLARATION_FORMS in packages/compiler/src/core-vocabulary.ts");
  }
  for (const name of PERMANENT_NAMESPACE_NAMES) {
    require_("permanent-namespace", name, name, "PERMANENT_NAMESPACE_NAMES in packages/compiler/src/core-vocabulary.ts");
  }
  for (const name of CORE_PRELUDE_NAMES) {
    require_("prelude-name", name, name, "CORE_PRELUDE_NAMES in packages/compiler/src/core-vocabulary.ts");
  }
  // D62 rules 157/158: Core's own contextual keywords and numeric suffixes.
  // Both were holes this gate could only print — one had no enumerable table
  // at all, and the other was reachable only because the Web extension
  // republishes `ms` and `s` through LOOK_UNIT_TYPES, so a Core-only checkout
  // checked neither. They are required from Core's roster now, on every target.
  for (const word of CORE_CONTEXTUAL_KEYWORD_WORDS) {
    require_("contextual-keyword", word, word, "CORE_CONTEXTUAL_KEYWORDS in packages/compiler/src/core-vocabulary.ts");
  }
  for (const suffix of CORE_NUMERIC_SUFFIXES) {
    require_("numeric-suffix", suffix, `1${suffix}`, "CORE_NUMERIC_SUFFIXES in packages/compiler/src/core-vocabulary.ts");
  }
  // D53 rule 117's blind spot: the only category here that names a construct
  // instead of a name. The roster is a mapped type over the `CoreStatement`
  // union, so a declaration form the parser can return cannot be absent from
  // it, and a form nothing in the tour writes is named below.
  for (const [kind, spelling] of Object.entries(CORE_STATEMENT_CONSTRUCTS)) {
    require_("statement-construct", kind, spelling, "CORE_STATEMENT_CONSTRUCTS in packages/compiler/src/ast.ts");
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
    // An extension's statements never join `CoreStatement`, so its own roster
    // is the only table that can name them. Owning a parser and publishing no
    // roster is the silent version of the hole this category closes, so it is
    // a failure rather than an empty contribution.
    if (extension.parser !== undefined && extension.syntax === undefined) {
      failures.push(`Extension '${extension.id}' registers a parser but publishes no 'syntax.statementConstructs', so the statement forms it adds cannot be required of the tour`);
    }
    for (const [key, spelling] of Object.entries(extension.syntax?.statementConstructs ?? {})) {
      require_("statement-construct", key, spelling, `${extension.id} syntax.statementConstructs`);
    }
  }
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
      else require_("module-export", moduleExportKey(source, name), `import {${name}} from "${source}"`, `${source} (${target})`);
    }
    if (source === BROWSER_TEST_MODULE) {
      for (const [controller, type] of interface_.exports) {
        if (type.kind !== "object") continue;
        for (const member of type.fields.keys()) {
          require_("web-test-member", `${source}\u0000${controller}\u0000${member}`, `${controller}.${member} in ${WEB_TEST_TOUR_CHAPTER}`, `${source} ${controller} object fields (${target})`);
        }
      }
    }
  }
}

// ── What the tour actually contains, judged after lexing and parsing ───────

function observeModule({ path, tokens, program, index, contextualKeywords, syntaxExtensions }) {
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
  //
  //     And not off the import line *at all*. An import proves a name
  //     resolves; it shows no signature and no usage, while this gate's
  //     contract — and its own failure text — is that every name is
  //     *exercised*. The named branch counted the specifier itself, so
  //     deleting the only call to `watchVisibility` and leaving its import
  //     standing left this category reporting 237/237 (A-023). A named import
  //     now waits for a resolved reference to its local binding.
  //
  //     Both branches are keyed by the import's *symbol*, never by its local
  //     spelling. The namespace branch did wait for a real member read, but it
  //     matched the read by name, so a local record named `urls` declared in
  //     any inner scope forged `velar/url`'s exports from a read of itself —
  //     the same forgery the header of this file says a text search would
  //     allow and a resolved judgment would not.
  const referencedSymbols = new Set(index.references.flatMap((reference) => reference.symbolId === null ? [] : [reference.symbolId]));
  // Every identifier the analyzer resolved, by the offset it was written at. A
  // member access records its object as a reference, so this is what tells
  // `collections.groupBy(...)` from a shadowing local's member of the same name.
  const symbolAt = new Map(index.references.map((reference) => [reference.span.start, reference.symbolId]));
  const namespaceSources = new Map();
  const webTestControllers = new Map();
  for (const imported of index.imports) {
    if (imported.namespace) namespaceSources.set(imported.localSymbolId, imported.source);
    else {
      if (!referencedSymbols.has(imported.localSymbolId)) recordUnusedImport(imported, path);
      else observe("module-export", moduleExportKey(imported.source, imported.imported));
      if (imported.source === BROWSER_TEST_MODULE) webTestControllers.set(imported.localSymbolId, imported.imported);
    }
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
      // Which binding this member sits on, by the analyzer's verdict rather
      // than by its spelling: a namespace import's own symbol, or nothing.
      const object = symbolAt.get(node.object.span.start);
      const source = namespaceSources.get(object);
      if (source !== undefined) observe("module-export", moduleExportKey(source, node.property));
      const controller = webTestControllers.get(object);
      if (controller !== undefined && path.endsWith(WEB_TEST_TOUR_CHAPTER)) {
        observe("web-test-member", `${BROWSER_TEST_MODULE}\u0000${controller}\u0000${node.property}`);
      }
    }
    if (node.kind === "IdentifierExpression" && unbound.has(node.span.start)) {
      observe("permanent-namespace", node.name);
      observe("prelude-name", node.name);
      observe("extension-global", node.name);
      observe("reserved-binding", node.name);
    }
    // A construct counts when the *parser* built its node, which is the same
    // standard the rest of this file holds names to: `unsafe js` written in a
    // comment or a string never becomes a node. Core forms are keyed by node
    // Core's projection refines the four same-kind form pairs and inline JS;
    // an extension refines its own key, so an inline `unsafe css` block and the
    // `import css unsafe` that shares its node kind stay two entries.
    if (typeof node.kind === "string") {
      observe("statement-construct", CORE_STATEMENT_KINDS.has(node.kind) ? coreStatementConstructKey(node) : node.kind);
      for (const syntax of syntaxExtensions) {
        const key = syntax.statementConstructKey(node);
        if (key !== null) observe("statement-construct", key);
      }
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
    // D55 rule 120: a declaration that actually carries a parameter list, by
    // the parser's verdict — the AST node kind names the form, and a prose
    // mention of `type Box<T>` in a comment never becomes one.
    if (Array.isArray(node.typeParameters) && node.typeParameters.length > 0) {
      if (node.kind === "FunctionDeclaration") observe("generic-declaration", "def");
      if (node.kind === "TypeDeclaration") observe("generic-declaration", "type");
    }
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
