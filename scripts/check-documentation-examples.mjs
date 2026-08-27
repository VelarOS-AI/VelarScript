import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectModule } from "@velarscript/compiler";
import { isNodeOnlyModule, velarNodeCompilerExtension } from "@velarscript/node/compiler";
import { velarCompilerExtension as velarDesktopCompilerExtension } from "@velarscript/desktop/compiler";
import {velarCompilerExtension as velarServerCompilerExtension} from "@velarscript/server/compiler";
import { BROWSER_TEST_MODULE, BROWSER_TEST_SOURCE_SUFFIX, velarCompilerExtension } from "@velarscript/web/compiler";
import { compileProject } from "../packages/cli/src/project.ts";

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
// The fence *language* this gate owns. Everything about where a fence starts
// and ends is asked of the CommonMark scanner below rather than of a regex.
const VELAR_FENCE_LANGUAGE = "velar";
// One Markdown line that may open or close a fence: up to three columns of
// indentation, then three or more backticks or tildes, then the info string.
const FENCE_LINE = /^(?<indent>[ \t]*)(?<fence>`{3,}|~{3,})(?<info>.*)$/u;
// A line that *means* to open a VelarScript fence, whatever container it sits
// in. `>` is admitted so a block-quoted fence is recognised as a fence and
// reported by `unreadableVelarFences` rather than passing as ordinary prose.
const VELAR_FENCE_LINE = /^[ \t>]*(?:`{3,}|~{3,})[ \t]*velar(?:[ \t]|$)/u;
// A fragment may declare the names it borrows in a Markdown comment standing
// immediately before its fence — invisible to a reader, compiled by this gate.
// D64 rule 167: the context a fragment needs in order to be checked in full is
// context the reader does not need to see, so it goes here rather than being
// spelled into the prose example.
// It may be indented with its fence, up to the three columns CommonMark allows
// a fence — the comment has to stand immediately before the fence, so a rule
// that admits an indented fence and refuses an indented preamble would leave
// the comment unrecognised and therefore silently ignored, which is the same
// failure this gate is being repaired for.
const preambleComment = /^(?<indent>[ \t]{0,3})<!--[ \t]*velar-preamble[ \t]*\r?\n(?<source>[\s\S]*?)^[ \t]{0,3}-->[ \t]*\r?$/gmu;
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
      const { kept, cascades } = suppress
        ? significantFragmentDiagnostics(module.result)
        : { kept: module.result.diagnostics, cascades: [] };
      suppressed += module.result.diagnostics.length - kept.length;
      cascaded += cascades.length;
      for (const diagnostic of cascades) cascadeMessages.push(`${diagnostic.code} ${diagnostic.message}`);
      for (const diagnostic of kept) {
        failures.push(`${display(file)}:${line}: ${diagnostic.code} ${diagnostic.message}`);
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
      + ` (${cascadeDiagnostics} diagnostic${cascadeDiagnostics === 1 ? "" : "s"}), the one clause that can hide a refusal about code the fence does declare.`,
    ...(detail ? cascadeFences : []),
  ];
}

/**
 * The preamble declared for each fence, keyed by the fence's offset. A preamble
 * belongs to the fence it stands immediately before — nothing but whitespace
 * may separate them — so a comment that drifted away from its fence, or that
 * was never followed by one, is reported rather than silently ignored.
 */
function preamblesIn(markdown, file, blocks) {
  const byFence = new Map();
  // A preamble inside a code block is a preamble being *shown*, not declared —
  // this rule is written out in D64 itself, inside a fence, and documentation
  // about a mechanism must not trip the mechanism.
  const quoted = blocks.map((block) => [block.blockStart, block.blockEnd]);
  // Keyed by the offset of the fence's first backtick or tilde, which is where
  // skipping whitespace after the comment lands whether or not the fence is
  // indented.
  const velarFences = new Map(blocks
    .filter((block) => block.language === VELAR_FENCE_LANGUAGE)
    .map((block) => [block.openOffset, block]));
  for (const match of markdown.matchAll(preambleComment)) {
    if (quoted.some(([start, end]) => (match.index ?? 0) >= start && (match.index ?? 0) < end)) continue;
    const after = (match.index ?? 0) + match[0].length;
    const fenceStart = after + (markdown.slice(after).match(/^\s*/u)?.[0].length ?? 0);
    if (!velarFences.has(fenceStart)) {
      failures.push(`${display(file)}:${lineAt(markdown, match.index ?? 0)}: a velar-preamble comment must stand immediately before a \`\`\`velar fence`);
      continue;
    }
    // Dedented by the comment's own indentation, the same way its fence's
    // content is: the preamble is compiled ahead of the example, and
    // VelarScript reads indentation as structure.
    const source = dedent(match.groups?.source ?? "", (match.groups?.indent ?? "").length);
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
 * three official targets, and the Web extension replaces shared standard-module
 * interfaces with their browser contracts — `velar/http` exports `secretHeader`
 * on Node but not on the Web, where a process environment does not exist. An
 * example the Web target cannot satisfy — it imports a Node-only module, or a
 * name the browser contract does not export — is therefore a Core/CLI
 * illustration and is checked as a Core project. An import from `velar/server`
 * selects the Server application extension; an import from a Desktop-owned
 * module selects the Desktop application extension, without which every name
 * `velar/window` publishes is an unresolved reference that suppresses its own
 * diagnostic and stops the analyzer downstream — a Desktop example nothing
 * checks. Otherwise a parsed Node `server` symbol selects the low-level Node
 * extension that owns it. Everything else is checked with the Web extension
 * loaded, which owns JSX, components, and Node-module rejection.
 */
function exampleExtensions(source, file) {
  if (['"velar/desktop"', '"velar/desktop-test"', '"velar/window"', '"velar/service"', '"velar/notification"', '"velar/secure-storage"']
    .some((module) => source.includes(module))) {
    return [velarDesktopCompilerExtension];
  }
  const serverOwned = source.includes('"velar/server"');
  const nodeExtension = serverOwned ? velarServerCompilerExtension : velarNodeCompilerExtension;
  if (serverOwned) return [nodeExtension];
  const nodeInspection = inspectModule(source, { path: file, extensions: [nodeExtension] });
  if (nodeInspection.semanticIndex.symbols.some((symbol) => symbol.kind === "extension:variable:node-server")) {
    return [nodeExtension];
  }
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
  if (unresolved.length === 0) return { kept: diagnostics, cascades: [] };
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
  const kept = [];
  const cascades = [];
  for (const diagnostic of diagnostics) {
    if (isUnresolvedReference(diagnostic)) continue;
    if (spans.some((span) => span.start >= diagnostic.span.start && span.end <= diagnostic.span.end)) continue;
    if (mentionsUnknownType(diagnostic.message)) {
      cascades.push(diagnostic);
      continue;
    }
    kept.push(diagnostic);
  }
  return { kept, cascades };
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

// ─── Reading Markdown fences as CommonMark defines them ──────────────────────
//
// What this replaces was a regex:
//
//   /^(?<ticks>`{3,})velar…^\k<ticks>[ \t]*$/gmu
//
// and it asserted three things CommonMark does not. That the opening backticks
// sit at column 0 — CommonMark allows up to three columns of indentation, which
// is how a fence inside a list item is written. That the closing fence has
// *exactly* the opening fence's length — CommonMark requires only that it be at
// least as long. And that a fence is made of backticks — tildes open one too.
// All three errors run the same way: a legal example the gate never saw, never
// compiled, and never counted, under a headline that said every block was
// checked (A-022). It is the shape A-002 found in the CSS asset regex, where a
// regex stood in for a syntax and was wrong in both directions at once.
//
// The scanner below is not a Markdown parser. It reads §4.5 (fenced code
// blocks) and nothing else, and it is deliberate about where that stops:
//
//  - Block *containers* — block quotes, and list items nested deeply enough to
//    push their content four or more columns in — are not parsed. Inside one, a
//    fence's indentation is measured from the container, not from column 0, and
//    this scanner cannot see the container. Such a fence is not silently
//    skipped: `unreadableVelarFences` names it and the gate goes red. A gap
//    nobody prints is a gap nobody closes (D56 rule 129), and the whole defect
//    here was a gate that skipped examples quietly.
//  - Tabs count as four columns for the *indentation* test, but the content
//    stripping removes spaces only. A tab in the stripped prefix of a fence
//    inside a list item is out of scope, and CommonMark itself calls partial
//    tab expansion an edge case.
//  - Link reference definitions, HTML blocks and setext underlines cannot open
//    or close a fence, so ignoring them changes no verdict here.

/** Indentation in columns, with tabs advancing to the next multiple of four. */
function indentColumns(indent) {
  let columns = 0;
  for (const character of indent) columns = character === "\t" ? columns + 4 - (columns % 4) : columns + 1;
  return columns;
}

/** Up to `columns` leading spaces removed, which is what CommonMark strips. */
function dedentLine(line, columns) {
  let stripped = 0;
  while (stripped < columns && line[stripped] === " ") stripped += 1;
  return line.slice(stripped);
}

/** `dedentLine` over every line of a block of text. */
function dedent(text, columns) {
  return columns === 0 ? text : text.split("\n").map((line) => dedentLine(line, columns)).join("\n");
}

/**
 * Every fenced code block in a Markdown document, in source order.
 *
 * Each block reports `language` (the info string's first word), `metadata`
 * (the rest of it), `source` (the content with the opening fence's indentation
 * removed), `openOffset` (the fence character itself, which is what a preamble
 * comment's whitespace skip lands on), `blockStart`/`blockEnd` (the whole
 * block including both fence lines) and `line`.
 */
function fencedCodeBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split("\n");
  let offset = 0;
  let open = null;
  let content = [];
  for (const raw of lines) {
    const start = offset;
    offset += raw.length + 1;
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const match = FENCE_LINE.exec(text);
    const indented = match ? indentColumns(match.groups.indent) : 0;
    if (open === null) {
      if (!match || indented > 3) continue;
      const info = match.groups.info.trim();
      // "Info strings for backtick code blocks cannot contain backticks."
      if (match.groups.fence.startsWith("`") && info.includes("`")) continue;
      const [language = "", ...rest] = info.split(/[ \t]+/u);
      open = {
        character: match.groups.fence[0],
        length: match.groups.fence.length,
        indent: match.groups.indent.length,
        language,
        metadata: rest.join(" "),
        openOffset: start + match.groups.indent.length,
        blockStart: start,
        line: lineAt(markdown, start),
      };
      content = [];
      continue;
    }
    const closes = match
      && indented <= 3
      && match.groups.fence[0] === open.character
      && match.groups.fence.length >= open.length
      && match.groups.info.trim() === "";
    if (closes) {
      blocks.push({ ...open, source: content.map((line) => `${line}\n`).join(""), blockEnd: start + raw.length + 1 });
      open = null;
      continue;
    }
    // CommonMark removes up to as many leading spaces as the opening fence had.
    // Not cosmetic: VelarScript is indentation-sensitive, so an indented fence
    // yields a compilable module only if that prefix comes back off every line.
    content.push(dedentLine(text, open.indent));
  }
  // "If the end of the containing block is reached and no closing code fence
  // has been found, the code block contains all of the lines after the opening
  // code fence until the end of the containing block."
  if (open !== null) {
    blocks.push({ ...open, source: content.map((line) => `${line}\n`).join(""), blockEnd: markdown.length });
  }
  return blocks;
}

/**
 * Lines that open a VelarScript fence the scanner above did not take as one.
 * Everything inside an extracted block is excluded, so a fence *shown* as the
 * content of another block — this repository's own documentation of the
 * mechanism does exactly that — is not reported.
 */
function unreadableVelarFences(markdown, blocks) {
  // A block's range covers both of its fence lines, so a fence the scanner did
  // take is excluded by the same test that excludes a fence being quoted.
  const covered = blocks.map((block) => [block.blockStart, block.blockEnd]);
  const unreadable = [];
  let offset = 0;
  for (const raw of markdown.split("\n")) {
    const start = offset;
    offset += raw.length + 1;
    if (covered.some(([from, to]) => start >= from && start < to)) continue;
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (VELAR_FENCE_LINE.test(text)) unreadable.push({ line: lineAt(markdown, start) });
  }
  return unreadable;
}

function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function display(file) {
  const path = relative(root, file);
  return path.startsWith("..") ? file : path;
}
