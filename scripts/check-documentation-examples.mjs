import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX } from "@velarscript/web/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { exampleExtensions } from "./documentation-fence-language.mjs";
import { withDocumentationFiles } from "./documentation-example-files.mjs";
import { fencedCodeBlocks, unreadableVelarFences, velarPreambles, VELAR_FENCE_LANGUAGE } from "./markdown-fences.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `--partial` names every fence the coverage summary counts. The summary alone
// says how large the gap is; closing it needs the addresses, and a number
// nobody can act on is halfway back to a silent gap.
const detail = process.argv.includes("--partial");
const requireFull = process.argv.includes("--require-full");
// Declared before the file walk below, which reports into it: `rootReadmes`
// pushes a failure when a checkout carries no README, and reaching that clause
// with `failures` still in its temporal dead zone crashed the gate with a
// ReferenceError instead of printing the failure it had just found.
const failures = [];
// docs/decisions/archive holds process artifacts: audit ledgers, wave briefs,
// and executable specs for surface that is *not built yet* (D101's L-series).
// Those fences describe a future or past language, so compiling them against
// the current compiler asserts something the archive never claims. The
// numbered decision records outside archive/ stay compiled.
const uncompiledDirectories = new Set([join("docs", "decisions", "archive")]);
const requested = process.argv.slice(2).filter((argument) => argument !== "--partial" && argument !== "--require-full");
const files = requested.length > 0
  ? requested.map((file) => resolve(file))
  : [...await rootReadmes(root), ...await markdownFiles(join(root, "docs")), ...await packageReadmes(join(root, "packages"))];
// The fence grammar, the preamble comment, and the CommonMark scanner that
// reads both live in ./markdown-fences.mjs, which `check-fence-format.mjs`
// reads too: one definition of where a fence starts and what belongs to it.
// The diagnostic families the fragment rule reasons about; that rule, and why
// each family is inherent to a fragment, is written out above
// significantFragmentDiagnostics below.
const UNRESOLVED_NAME_DIAGNOSTIC = "VEL3001";
const UNRESOLVED_TYPE_DIAGNOSTIC = "VEL4001";
const MODULE_RESOLUTION_PREFIX = "VEL6";
let examples = 0;
let fragments = 0;
let declared = 0;
// D64 rule 167 — what this gate could *not* check. A suppressed diagnostic is
// only half of the gap: an unresolved reference is typed `unknown` and the
// analyzer stops checking downstream of it, so a defect standing after one
// produces no diagnostic at all and reaches no suppression clause. Both halves
// are counted here and both are printed, because a coverage gap nobody prints
// is a coverage gap nobody closes (D56 rule 129).
let partialFragments = 0;
let suppressedDiagnostics = 0;
const partialFiles = new Map();
const partialFences = [];
// Clauses (1) and (2) of the fragment rule drop a diagnostic *about the missing
// declaration itself*, which is the omission a fragment is entitled to. There
// was a clause (3) that dropped a complaint about code the fence does spell
// out, on the grounds that an `unknown` type reached it from elsewhere; it was
// the only clause that could hide a real refusal, F3 is the case where it did,
// and D114 F6b(f) retired it.

for (const file of files) {
  const markdown = await readFile(file, "utf8");
  const blocks = fencedCodeBlocks(markdown);
  // A fence this scanner cannot reach is named, never skipped. The scanner's
  // boundary is documented on fencedCodeBlocks; the whole point of A-022 is
  // that an example nobody compiles must not also be an example nobody counts.
  for (const unreadable of unreadableVelarFences(markdown, blocks)) {
    failures.push(`${display(file)}:${unreadable.line}: this line opens a VelarScript fence inside a Markdown container this gate does not parse`
      + " (a block quote, or a list item nested deeply enough to indent the fence four columns or more), so the example is never compiled."
      + " Move it out of the container, or indent it at most three columns.");
  }
  const preambles = preamblesIn(markdown, file, blocks);
  for (const block of blocks) {
    if (block.language !== VELAR_FENCE_LANGUAGE) continue;
    examples += 1;
    const metadata = block.metadata;
    const line = block.line;
    if (metadata !== "" && metadata !== "fragment") {
      failures.push(`${display(file)}:${line}: unknown VelarScript fence annotation '${metadata}'`);
      continue;
    }
    const fragment = metadata === "fragment";
    if (fragment) fragments += 1;
    const preamble = preambles.get(block.openOffset);
    if (preamble !== undefined && !fragment) {
      failures.push(`${display(file)}:${line}: a velar-preamble comment stands before a complete example, which is already checked in full — delete the comment or mark the fence 'fragment'`);
      continue;
    }
    if (preamble !== undefined) declared += 1;
    // A declared preamble is compiled ahead of the fence's own text, so the
    // fragment resolves every name it borrows and is checked exactly as a
    // complete example is: no suppression, nothing typed `unknown` by default.
    const { shared, siblings } = splitPreamble(preamble ?? "");
    const source = `${shared}${block.source}`;
    const suppress = fragment && preamble === undefined;

    // Every example — fragment or complete — is compiled as a whole module by
    // the project driver, so both get the same analysis, the same emitter, and
    // the same project-level checks a real source file gets.
    // D39 item 53: `test "name":` is declared in a test module, so an example
    // that declares one is compiled as the module kind it describes. D57 rule
    // 138 carries that one step further: an example that reaches for the
    // page-driving module describes a browser test, which is the only module
    // kind allowed to import it.
    let result;
    try {
      result = await withDocumentationFiles(root, preamble ?? "", [moduleFileName(source), ...siblings.keys()], async (directory) => {
        const entry = join(directory, moduleFileName(source));
        const modules = new Map([[entry, source]]);
        for (const [path, sibling] of siblings) modules.set(join(directory, path), sibling);
        return compileProject(entry, modules, {
          sourceRoot: directory,
          projectRoot: directory,
          extensions: exampleExtensions([source, ...siblings.values()].join("\n"), file),
          // Checked JavaScript declarations may describe packages not installed here.
          resolveJavaScriptSpecifiers: false,
        });
      });
    } catch (error) {
      failures.push(`${display(file)}:${line}: ${error.message}`);
      continue;
    }
    let suppressed = 0;
    for (const failure of result.failures) {
      if (suppress && inherentProjectFailure(failure.message)) {
        suppressed += 1;
        continue;
      }
      failures.push(`${display(file)}:${line}: ${failure.message}`);
    }
    for (const module of result.modules) {
      const { kept, preambleRequired } = suppress
        ? significantFragmentDiagnostics(module.result)
        : { kept: module.result.diagnostics, preambleRequired: [] };
      suppressed += module.result.diagnostics.length - kept.length - preambleRequired.length;
      for (const diagnostic of kept) {
        failures.push(`${display(file)}:${line}: ${diagnostic.code} ${diagnostic.message}`);
      }
      // D114 F6b(f): every `unknown`-type cascade is a failure. The clause
      // that tolerated them in a fragment borrowing a module was already nearly
      // dead after AS-I7 stopped the analyzer producing a second diagnostic
      // from an error's own `unknown`, and it was the one clause that could
      // hide a refusal about code the fence does spell out. A preamble is the
      // repair wherever one can be written, and the message names it.
      for (const diagnostic of preambleRequired) {
        failures.push(`${display(file)}:${line}: ${diagnostic.code} ${diagnostic.message}`
          + "\n    This fragment borrows a name it never declares, and the `unknown` that name types flowed into the refusal above."
          + " Declare the borrowed names in a `<!-- velar-preamble ... -->` comment before this fence and it is checked in full.");
      }
    }
    if (suppressed === 0) continue;
    partialFragments += 1;
    suppressedDiagnostics += suppressed;
    partialFiles.set(display(file), (partialFiles.get(display(file)) ?? 0) + 1);
    partialFences.push(`  ${display(file)}:${line} — ${suppressed} suppressed`);
  }
}

if (examples === 0) failures.push("No ```velar documentation examples were found");
if (requireFull && partialFragments > 0) {
  failures.push(`Full documentation coverage required: ${partialFragments} fragment(s) need a declared preamble or resource fixture`);
}
const checked = `Checked ${examples} VelarScript documentation examples (${examples - fragments} complete, ${fragments} fragments`
  + `${declared > 0 ? `, ${declared} of them with a declared preamble` : ""}), all under full project analysis`;
for (const line of coverageReport()) console.log(line);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(checked);
}

/**
 * What the gate could not check, printed on every run — green or red. D64 rule
 * 167 measured this gap at 73% of fragments while the gate's only number was
 * "Checked N examples", and D56 rule 129 is the standing discipline: a coverage
 * gap is reported as a number before anyone argues about reducing it.
 */
function coverageReport() {
  if (fragments === 0) return [];
  if (partialFragments === 0) return [`Coverage: all ${fragments} fragments were checked in full`];
  // D90 R3(a): code-unit order breaks the count tie, so this gate's report reads
  // the same on two machines that differ only in `LC_ALL`.
  const worst = [...partialFiles].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, 5);
  return [
    `Coverage: ${partialFragments} of ${fragments} fragments were NOT checked in full — ${suppressedDiagnostics} diagnostic${suppressedDiagnostics === 1 ? " was" : "s were"} suppressed as inherent to a fragment,`,
    "  and every unresolved reference also types itself `unknown` and stops the analyzer downstream, so defects after one are never reported at all.",
    "  Declare the names a fragment borrows in a `<!-- velar-preamble ... -->` comment before its fence and that fragment is checked in full.",
    ...(detail
      ? partialFences
      : [
        `  Concentrated in: ${worst.map(([file, count]) => `${file} (${count})`).join(", ")}`,
        "  Run `npm run check:docs -- --partial` to list every one of them by line.",
      ]),
  ];
}

/**
 * The preamble declared for each fence, keyed by the fence's offset, with a
 * comment that never reached a fence reported as a failure of this gate. The
 * discovery rule itself belongs to the fence grammar.
 */
/**
 * A preamble's own source and the sibling modules it declares.
 *
 * D114 F6b(f): a fragment that writes `await import("./reports.vel")` describes
 * a two-module program, and until now the second module was simply missing —
 * the dynamic import failed to resolve, its binding typed `unknown`, and the
 * member read on the next line was swallowed by the tolerance this ruling
 * retires. A preamble already carries the context a reader does not need to
 * see; a `// velar-module <path>` line inside one starts the sibling that
 * context needs, and everything after it up to the next marker is that
 * module's source. The marker is an ordinary VelarScript comment, so a
 * preamble is still a compilable module for every other gate that reads one.
 */
function splitPreamble(preamble) {
  const marker = /^\/\/ velar-module (\S+\.vel)[ \t]*$/u;
  const lines = preamble.split("\n");
  const shared = [];
  const siblings = new Map();
  let current = null;
  for (const line of lines) {
    const match = marker.exec(line);
    if (match) {
      current = match[1];
      siblings.set(current, "");
      continue;
    }
    if (current === null) shared.push(line);
    else siblings.set(current, `${siblings.get(current)}${line}\n`);
  }
  return { shared: shared.join("\n"), siblings };
}

function preamblesIn(markdown, file, blocks) {
  const { byFence, problems } = velarPreambles(markdown, blocks);
  for (const problem of problems) {
    failures.push(`${display(file)}:${problem.line}: a velar-preamble comment must stand immediately before a \`\`\`velar fence`);
  }
  return byFence;
}

/**
 * The module file name an example is compiled under. A documentation example
 * is checked as the module kind it describes, and two kinds announce
 * themselves in the source: `test "name":` is a test module, and an import of
 * the page-driving module is a browser test module — the only place D57 rule
 * 138 admits that import. Both names are read from their owners rather than
 * spelled again here.
 */
function moduleFileName(source) {
  const base = ".velar-documentation-example";
  if (source.includes(JSON.stringify(BROWSER_TEST_MODULE))) return `${base}${BROWSER_TEST_SOURCE_SUFFIX}`;
  return /^test\s+"/mu.test(source) ? `${base}.test.vel` : `${base}.vel`;
}

// ─── What a `fragment` fence is allowed to leave out ─────────────────────────
// A fragment is a real module to the compiler (above), so a type error, an
// illegal statement, a missing export, a mutability rejection, or any
// Web-semantic rejection fails the gate in a fragment exactly as in a complete
// example. What a fragment legitimately omits is the *surrounding
// declarations*, and only the diagnostics that omission forces are dropped:
//
//  1. The unresolved reference itself, because the declaration lives in the
//     prose around the fence:
//       - VEL3001 `Unknown name 'x'`   — a value the surrounding module declares.
//       - VEL4001 `Unknown type 'T'`   — a type the surrounding module declares.
//       - VEL6xxx (module resolution)  — a neighbouring .vel file that exists
//         only in the narrative.
//       - `Cannot load <kind> resource '...': ENOENT` — a stylesheet or asset
//         that exists only in the narrative.
//  2. A diagnostic reported on an expression that *contains* one of those
//     unresolved references, or on a *use of a binding imported from* a module
//     in (1). Both are (1) restated one level out — `Named arguments require a
//     statically known callable signature` on a call to a name the fragment
//     never declared, `Unknown component 'App'` on a component imported from a
//     module the fence only mentions.
//  3. Only in a fragment that borrows a *module* it never declares: a
//     diagnostic about the `unknown` *type*. The analyzer types an unresolved
//     reference `unknown`, and that type flows outward through locals,
//     destructuring patterns, and f-strings, where the resulting complaint no
//     longer encloses the reference that caused it.
//
// (3) is retired (D114 F6b(f)). It used to apply to any fragment with any
// unresolved reference, was narrowed to fragments borrowing a module, and after
// AS-I7 — which stopped the analyzer reporting a second diagnostic against an
// error's own `unknown` — it was nearly dead. It was also the only clause that
// could hide a refusal about code the fence *does* spell out, which is what F3
// in the conversation-stream benchmark cost. Every `unknown`-type cascade is a
// failure now, and the failure names the preamble as the repair.
//
// (3) reads the rendered type, not the word: diagnostics quote *names* in
// single quotes and render *types* bare, so `use 'unknown' in VelarScript` —
// the rejection of an `any` annotation — is not an `unknown`-type cascade and
// still fails the gate.
function significantFragmentDiagnostics(result) {
  const diagnostics = result.diagnostics;
  const unresolved = diagnostics.filter(isUnresolvedReference);
  if (unresolved.length === 0) return { kept: diagnostics, preambleRequired: [] };
  const index = result.semanticIndex;
  // (2) The spans an unresolved reference occupies: the reference itself, plus
  // every use of a binding whose module never resolved.
  const spans = unresolved.map((diagnostic) => diagnostic.span);
  const unresolvedSources = new Set(unresolved
    .filter((diagnostic) => diagnostic.code.startsWith(MODULE_RESOLUTION_PREFIX))
    .flatMap((diagnostic) => index.moduleReferences
      .filter((reference) => reference.span.start === diagnostic.span.start)
      .map((reference) => reference.source)));
  const unresolvedSymbols = new Set(index.imports
    .filter((imported) => unresolvedSources.has(imported.source))
    .map((imported) => imported.localSymbolId));
  for (const reference of index.references) {
    if (reference.symbolId !== null && unresolvedSymbols.has(reference.symbolId)) spans.push(reference.span);
  }
  // The two clauses are applied in order. A diagnostic about the `unknown`
  // *type* is neither of them, so it is a failure — reported through
  // `preambleRequired`, which names the repair as well as the refusal.
  const kept = [];
  const preambleRequired = [];
  for (const diagnostic of diagnostics) {
    if (isUnresolvedReference(diagnostic)) continue;
    if (spans.some((span) => span.start >= diagnostic.span.start && span.end <= diagnostic.span.end)) continue;
    if (mentionsUnknownType(diagnostic.message)) {
      preambleRequired.push(diagnostic);
      continue;
    }
    kept.push(diagnostic);
  }
  return { kept, preambleRequired };
}

function isUnresolvedReference(diagnostic) {
  return (diagnostic.code === UNRESOLVED_NAME_DIAGNOSTIC && diagnostic.message.startsWith("Unknown name '"))
    || (diagnostic.code === UNRESOLVED_TYPE_DIAGNOSTIC && diagnostic.message.startsWith("Unknown type '"))
    || diagnostic.code.startsWith(MODULE_RESOLUTION_PREFIX);
}

function mentionsUnknownType(message) {
  return /\bunknown\b/u.test(message.replaceAll(/'[^']*'/gu, ""));
}

function inherentProjectFailure(message) {
  return /^Cannot load .* resource '[^']*': ENOENT\b/u.test(message)
    || /^Cannot load json resource '[^']*': package '[^']*' is not installed\b/u.test(message);
}

async function markdownFiles(directory, parentPath = "docs") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const entryPath = join(parentPath, entry.name);
    if (entry.isDirectory()) {
      if (uncompiledDirectories.has(entryPath)) continue;
      files.push(...await markdownFiles(path, entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
}

// Every root README, not only the English one. A translated README carries the
// same VelarScript fences, and naming just README.md left those uncompiled —
// the shape D56 rule 130 exists to prevent, where a gate looks like it covers
// something it never reads.
async function rootReadmes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const readmes = entries
    .filter((entry) => entry.isFile() && /^README(\.[\w-]+)?\.md$/u.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort();
  if (readmes.length === 0) failures.push("no root README.md was found to check");
  return readmes;
}

async function packageReadmes(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(directory, entry.name, "README.md");
    try {
      await readFile(file, "utf8");
      files.push(file);
    } catch {
      // Packages are not required to have a public README.
    }
  }
  return files.sort();
}

function display(file) {
  const path = relative(root, file);
  return path.startsWith("..") ? file : path;
}
