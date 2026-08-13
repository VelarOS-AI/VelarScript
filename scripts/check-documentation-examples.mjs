import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectModule } from "@velarscript/compiler";
import { isNodeOnlyModule } from "@velarscript/node/compiler";
import { velarCompilerExtension } from "@velarscript/web/compiler";
import { compileProject } from "../packages/cli/src/project.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requested = process.argv.slice(2);
const files = requested.length > 0
  ? requested.map((file) => resolve(file))
  : [join(root, "README.md"), ...await markdownFiles(join(root, "docs")), ...await packageReadmes(join(root, "packages"))];
// Match the opening fence's exact backtick count so VelarScript layout-string
// examples may contain shorter Markdown fences as literal text.
const fence = /^(?<ticks>`{3,})velar(?:[ \t]+(?<metadata>[^\n]+))?[ \t]*\r?\n(?<source>[\s\S]*?)^\k<ticks>[ \t]*$/gmu;
// The diagnostic families the fragment rule reasons about; that rule, and why
// each family is inherent to a fragment, is written out above
// significantFragmentDiagnostics below.
const UNRESOLVED_NAME_DIAGNOSTIC = "VEL3001";
const UNRESOLVED_TYPE_DIAGNOSTIC = "VEL4001";
const MODULE_RESOLUTION_PREFIX = "VEL6";
const failures = [];
let examples = 0;
let fragments = 0;

for (const file of files) {
  const markdown = await readFile(file, "utf8");
  for (const match of markdown.matchAll(fence)) {
    examples += 1;
    const metadata = (match.groups?.metadata ?? "").trim();
    const source = match.groups?.source ?? "";
    const line = lineAt(markdown, match.index ?? 0);
    if (metadata !== "" && metadata !== "fragment") {
      failures.push(`${display(file)}:${line}: unknown VelarScript fence annotation '${metadata}'`);
      continue;
    }
    const fragment = metadata === "fragment";
    if (fragment) fragments += 1;

    // Every example — fragment or complete — is compiled as a whole module by
    // the project driver, so both get the same analysis, the same emitter, and
    // the same project-level checks a real source file gets.
    const entry = join(root, ".velar-documentation-example.vel");
    const result = await compileProject(entry, new Map([[entry, source]]), {
      sourceRoot: root,
      projectRoot: root,
      extensions: exampleExtensions(source, file),
      // Documentation examples illustrate packages that are deliberately not
      // installed here; the specifier-existence probe is a project check.
      resolveJavaScriptSpecifiers: false,
    });
    for (const failure of result.failures) {
      if (fragment && inherentProjectFailure(failure.message)) continue;
      failures.push(`${display(file)}:${line}: ${failure.message}`);
    }
    for (const module of result.modules) {
      const diagnostics = fragment ? significantFragmentDiagnostics(module.result) : module.result.diagnostics;
      for (const diagnostic of diagnostics) {
        failures.push(`${display(file)}:${line}: ${diagnostic.code} ${diagnostic.message}`);
      }
    }
  }
}

if (examples === 0) failures.push("No ```velar documentation examples were found");
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${examples} VelarScript documentation examples (${examples - fragments} complete, ${fragments} fragments), all under full project analysis`);
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

function lineAt(text, offset) {
  return text.slice(0, offset).split("\n").length;
}

function display(file) {
  const path = relative(root, file);
  return path.startsWith("..") ? file : path;
}
