import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX } from "@velarscript/web/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { exampleExtensions } from "./documentation-fence-language.mjs";
import { fencedCodeBlocks, unreadableVelarFences, velarPreambles, VELAR_FENCE_LANGUAGE } from "./markdown-fences.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `--partial` names every fence the coverage summary counts. The summary alone
// says how large the gap is; closing it needs the addresses, and a number
// nobody can act on is halfway back to a silent gap.
const detail = process.argv.includes("--partial");
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
const requested = process.argv.slice(2).filter((argument) => argument !== "--partial");
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
// The narrow half of the gap, counted on its own. Clauses (1) and (2) of the
// fragment rule drop a diagnostic *about the missing declaration itself*, which
// is the omission a fragment is entitled to. Clause (3) is different: it drops a
// complaint about code the fence does spell out, on the grounds that an
// `unknown` type reached it from elsewhere — so it is the only clause that can
// hide a real refusal, and F3 is the case where it did.
let cascadeFragments = 0;
let cascadeDiagnostics = 0;
const cascadeFences = [];

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
    const source = `${preamble ?? ""}${block.source}`;
    const suppress = fragment && preamble === undefined;

    // Every example — fragment or complete — is compiled as a whole module by
    // the project driver, so both get the same analysis, the same emitter, and
    // the same project-level checks a real source file gets.
    // D39 item 53: `test "name":` is declared in a test module, so an example
    // that declares one is compiled as the module kind it describes. D57 rule
    // 138 carries that one step further: an example that reaches for the
    // page-driving module describes a browser test, which is the only module
    // kind allowed to import it.
    const entry = join(root, moduleFileName(source));
    const result = await compileProject(entry, new Map([[entry, source]]), {
      sourceRoot: root,
      projectRoot: root,
      extensions: exampleExtensions(source, file),
      // Documentation examples illustrate packages that are deliberately not
      // installed here; the specifier-existence probe is a project check.
      resolveJavaScriptSpecifiers: false,
    });
    let suppressed = 0;
    for (const failure of result.failures) {
      if (suppress && inherentProjectFailure(failure.message)) {
        suppressed += 1;
        continue;
      }
      failures.push(`${display(file)}:${line}: ${failure.message}`);
    }
    let cascaded = 0;
    const cascadeMessages = [];
    for (const module of result.modules) {
      const { kept, cascades, preambleRequired } = suppress
        ? significantFragmentDiagnostics(module.result)
        : { kept: module.result.diagnostics, cascades: [], preambleRequired: [] };
      suppressed += module.result.diagnostics.length - kept.length - preambleRequired.length;
      cascaded += cascades.length;
      for (const diagnostic of cascades) cascadeMessages.push(`${diagnostic.code} ${diagnostic.message}`);
      for (const diagnostic of kept) {
        failures.push(`${display(file)}:${line}: ${diagnostic.code} ${diagnostic.message}`);
      }
      // An `unknown`-type cascade in a fragment that borrows only names is a
      // refusal about code this fence does spell out, and a preamble resolves
      // the name that caused it. Naming the repair is the whole difference
      // between a gate that closes this gap and one that only measures it.
      for (const diagnostic of preambleRequired) {
        failures.push(`${display(file)}:${line}: ${diagnostic.code} ${diagnostic.message}`
          + "\n    This fragment borrows a name it never declares, and the `unknown` that name types flowed into the refusal above."
          + " Declare the borrowed names in a `<!-- velar-preamble ... -->` comment before this fence and it is checked in full.");
      }
    }
    if (cascaded > 0) {
      cascadeFragments += 1;
      cascadeDiagnostics += cascaded;
      // Each one is printed in full, not counted. A cascade is only ever
      // *presumed* to be a consequence of the missing declaration; reading the
      // text is the only way to tell that presumption from a real refusal, and
      // F3 is what a mis-presumed one costs.
      cascadeFences.push(`  ${display(file)}:${line} — ${cascaded} \`unknown\`-type cascade${cascaded === 1 ? "" : "s"}`,
        ...cascadeMessages.map((message) => `      ${message}`));
    }
    if (suppressed === 0) continue;
    partialFragments += 1;
    suppressedDiagnostics += suppressed;
    partialFiles.set(display(file), (partialFiles.get(display(file)) ?? 0) + 1);
    partialFences.push(`  ${display(file)}:${line} — ${suppressed} suppressed${cascaded > 0 ? `, ${cascaded} of them \`unknown\`-type cascades` : ""}`);
  }
}

if (examples === 0) failures.push("No ```velar documentation examples were found");
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
    ...cascadeReport(),
    ...(detail
      ? partialFences
      : [
        `  Concentrated in: ${worst.map(([file, count]) => `${file} (${count})`).join(", ")}`,
        "  Run `npm run check:docs -- --partial` to list every one of them by line.",
      ]),
  ];
}

/**
 * The `unknown`-type cascade clause's reach, printed separately from the rest of
 * the gap. F3 in the conversation-stream benchmark was a real refusal — a bare
 * optional used as a condition — that this clause swallowed, so the number of
 * fences still standing on it is the number of places the same thing can happen
 * again.
 */
function cascadeReport() {
  if (cascadeFragments === 0) return [];
  return [
    `  Of those, ${cascadeFragments} fragment${cascadeFragments === 1 ? "" : "s"} rest on the \`unknown\`-type cascade clause`
      + ` (${cascadeDiagnostics} diagnostic${cascadeDiagnostics === 1 ? "" : "s"}), the one clause that can hide a refusal about code the fence does declare.`
      + " It now reaches only fragments borrowing a module a preamble cannot declare; every other cascade is a failure.",
    ...(detail ? cascadeFences : []),
  ];
}

/**
 * The preamble declared for each fence, keyed by the fence's offset, with a
 * comment that never reached a fence reported as a failure of this gate. The
 * discovery rule itself belongs to the fence grammar.
 */
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
// (3) used to apply to any fragment with any unresolved reference, and it was
// the only clause that could hide a refusal about code the fence *does* spell
// out. Its scope is now the one case a preamble cannot repair: a preamble
// declares bindings in the fragment's own module, so it can supply a borrowed
// *name* but it cannot conjure the sibling `.vel` file that `import("./x.vel")`
// resolves — the dynamic-import examples in the charter are its whole residual.
// A fragment that borrows only names has no such excuse: every `unknown`-type
// cascade in one is a hard failure that names the preamble as the repair, which
// is what keeps the 12 fences closed here from silently reopening.
//
// (3) reads the rendered type, not the word: diagnostics quote *names* in
// single quotes and render *types* bare, so `use 'unknown' in VelarScript` —
// the rejection of an `any` annotation — is not an `unknown`-type cascade and
// still fails the gate.
function significantFragmentDiagnostics(result) {
  const diagnostics = result.diagnostics;
  const unresolved = diagnostics.filter(isUnresolvedReference);
  if (unresolved.length === 0) return { kept: diagnostics, cascades: [], preambleRequired: [] };
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
  // The three clauses are applied in order and (3) is reported separately: it is
  // the only one that can drop a diagnostic about code the fence *does* declare,
  // so it is the clause whose reach has to stay measurable (D56 rule 129).
  // Its reach is now also bounded: only a fragment borrowing a module it cannot
  // declare may rest on it, because only that fragment is beyond a preamble.
  const borrowsModule = unresolved.some((diagnostic) => diagnostic.code.startsWith(MODULE_RESOLUTION_PREFIX));
  const kept = [];
  const cascades = [];
  const preambleRequired = [];
  for (const diagnostic of diagnostics) {
    if (isUnresolvedReference(diagnostic)) continue;
    if (spans.some((span) => span.start >= diagnostic.span.start && span.end <= diagnostic.span.end)) continue;
    if (mentionsUnknownType(diagnostic.message)) {
      (borrowsModule ? cascades : preambleRequired).push(diagnostic);
      continue;
    }
    kept.push(diagnostic);
  }
  return { kept, cascades, preambleRequired };
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
