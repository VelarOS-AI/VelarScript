import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectModule } from "@velarscript/compiler";
import { isNodeOnlyModule } from "@velarscript/node/compiler";
import { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX, velarCompilerExtension } from "@velarscript/web/compiler";
import { compileProject } from "../packages/cli/src/project.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// `--partial` names every fence the coverage summary counts. The summary alone
// says how large the gap is; closing it needs the addresses, and a number
// nobody can act on is halfway back to a silent gap.
const detail = process.argv.includes("--partial");
const requested = process.argv.slice(2).filter((argument) => argument !== "--partial");
const files = requested.length > 0
  ? requested.map((file) => resolve(file))
  : [...await rootReadmes(root), ...await markdownFiles(join(root, "docs")), ...await packageReadmes(join(root, "packages"))];
// Match the opening fence's exact backtick count so VelarScript layout-string
// examples may contain shorter Markdown fences as literal text.
const fence = /^(?<ticks>`{3,})velar(?:[ \t]+(?<metadata>[^\n]+))?[ \t]*\r?\n(?<source>[\s\S]*?)^\k<ticks>[ \t]*$/gmu;
// A fragment may declare the names it borrows in a Markdown comment standing
// immediately before its fence — invisible to a reader, compiled by this gate.
// D64 rule 167: the context a fragment needs in order to be checked in full is
// context the reader does not need to see, so it goes here rather than being
// spelled into the prose example.
const preambleComment = /^<!--[ \t]*velar-preamble[ \t]*\r?\n(?<source>[\s\S]*?)^-->[ \t]*\r?$/gmu;
// The diagnostic families the fragment rule reasons about; that rule, and why
// each family is inherent to a fragment, is written out above
// significantFragmentDiagnostics below.
const UNRESOLVED_NAME_DIAGNOSTIC = "VEL3001";
const UNRESOLVED_TYPE_DIAGNOSTIC = "VEL4001";
const MODULE_RESOLUTION_PREFIX = "VEL6";
const failures = [];
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

for (const file of files) {
  const markdown = await readFile(file, "utf8");
  const preambles = preamblesIn(markdown, file);
  for (const match of markdown.matchAll(fence)) {
    examples += 1;
    const metadata = (match.groups?.metadata ?? "").trim();
    const line = lineAt(markdown, match.index ?? 0);
    if (metadata !== "" && metadata !== "fragment") {
      failures.push(`${display(file)}:${line}: unknown VelarScript fence annotation '${metadata}'`);
      continue;
    }
    const fragment = metadata === "fragment";
    if (fragment) fragments += 1;
    const preamble = preambles.get(match.index ?? 0);
    if (preamble !== undefined && !fragment) {
      failures.push(`${display(file)}:${line}: a velar-preamble comment stands before a complete example, which is already checked in full — delete the comment or mark the fence 'fragment'`);
      continue;
    }
    if (preamble !== undefined) declared += 1;
    // A declared preamble is compiled ahead of the fence's own text, so the
    // fragment resolves every name it borrows and is checked exactly as a
    // complete example is: no suppression, nothing typed `unknown` by default.
    const source = `${preamble ?? ""}${match.groups?.source ?? ""}`;
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
    for (const module of result.modules) {
      const diagnostics = suppress ? significantFragmentDiagnostics(module.result) : module.result.diagnostics;
      suppressed += module.result.diagnostics.length - diagnostics.length;
      for (const diagnostic of diagnostics) {
        failures.push(`${display(file)}:${line}: ${diagnostic.code} ${diagnostic.message}`);
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
  const worst = [...partialFiles].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
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
 * The preamble declared for each fence, keyed by the fence's offset. A preamble
 * belongs to the fence it stands immediately before — nothing but whitespace
 * may separate them — so a comment that drifted away from its fence, or that
 * was never followed by one, is reported rather than silently ignored.
 */
function preamblesIn(markdown, file) {
  const byFence = new Map();
  // A preamble inside a code block is a preamble being *shown*, not declared —
  // this rule is written out in D64 itself, inside a fence, and documentation
  // about a mechanism must not trip the mechanism.
  const quoted = codeBlockRanges(markdown);
  for (const match of markdown.matchAll(preambleComment)) {
    if (quoted.some(([start, end]) => (match.index ?? 0) >= start && (match.index ?? 0) < end)) continue;
    const after = (match.index ?? 0) + match[0].length;
    const fenceStart = after + (markdown.slice(after).match(/^\s*/u)?.[0].length ?? 0);
    const opensFence = (fenceStart === 0 || markdown[fenceStart - 1] === "\n")
      && /^`{3,}velar(?:[ \t]|\r?\n)/u.test(markdown.slice(fenceStart));
    if (!opensFence) {
      failures.push(`${display(file)}:${lineAt(markdown, match.index ?? 0)}: a velar-preamble comment must stand immediately before a \`\`\`velar fence`);
      continue;
    }
    const source = match.groups?.source ?? "";
    byFence.set(fenceStart, source.endsWith("\n") ? source : `${source}\n`);
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

/**
 * The compiler extensions an example is written against. Documentation covers
 * two official targets, and the Web extension replaces shared standard-module
 * interfaces with their browser contracts — `velar/http` exports `secretHeader`
 * on Node but not on the Web, where a process environment does not exist. An
 * example the Web target cannot satisfy — it imports a Node-only module, or a
 * name the browser contract does not export — is therefore a Core/CLI
 * illustration and is checked as a Core project; everything else is checked
 * with the Web extension loaded, which is the stricter of the two (it owns JSX,
 * components, and the Node-module rejection).
 */
function exampleExtensions(source, file) {
  const inspection = inspectModule(source, { path: file, extensions: [velarCompilerExtension] });
  const webInterfaces = velarCompilerExtension.modules?.interfaces ?? new Map();
  for (const dependency of inspection.dependencies) {
    if (dependency.javascript) continue;
    if (isNodeOnlyModule(dependency.source)) return [];
  }
  for (const imported of inspection.semanticIndex.imports) {
    if (imported.namespace) continue;
    const interface_ = webInterfaces.get(imported.source);
    if (interface_ === undefined) continue;
    if (!webTargetProvides(interface_, imported.imported)) return [];
  }
  return [velarCompilerExtension];
}

function webTargetProvides(interface_, name) {
  return interface_.exports.has(name)
    || interface_.namedTypes.has(name)
    || interface_.typeAliases.has(name)
    || interface_.enums.has(name)
    || interface_.classes.has(name);
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
//  3. Only in a fragment that carries at least one unresolved reference: a
//     diagnostic about the `unknown` *type*. The analyzer types an unresolved
//     reference `unknown`, and that type flows outward through locals,
//     destructuring patterns, and f-strings, where the resulting complaint no
//     longer encloses the reference that caused it. A fragment with no
//     unresolved reference keeps full strictness over `unknown`, which is a
//     real type at the JSON and JavaScript boundaries.
//
// (3) reads the rendered type, not the word: diagnostics quote *names* in
// single quotes and render *types* bare, so `use 'unknown' in VelarScript` —
// the rejection of an `any` annotation — is not an `unknown`-type cascade and
// still fails the gate.
function significantFragmentDiagnostics(result) {
  const diagnostics = result.diagnostics;
  const unresolved = diagnostics.filter(isUnresolvedReference);
  if (unresolved.length === 0) return diagnostics;
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
  return diagnostics.filter((diagnostic) => !isUnresolvedReference(diagnostic)
    && !spans.some((span) => span.start >= diagnostic.span.start && span.end <= diagnostic.span.end)
    && !mentionsUnknownType(diagnostic.message));
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
  return /^Cannot load .* resource '[^']*': ENOENT\b/u.test(message);
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
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

/** Every fenced code block in a Markdown file, as `[start, end)` offsets. */
function codeBlockRanges(markdown) {
  const block = /^(?<ticks>`{3,}|~{3,})[^\n]*\r?\n[\s\S]*?^\k<ticks>[ \t]*$/gmu;
  return [...markdown.matchAll(block)].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
}

function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function display(file) {
  const path = relative(root, file);
  return path.startsWith("..") ? file : path;
}
