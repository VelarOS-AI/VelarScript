import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * D115 §一.4 and §三 — the JavaScript the packages emit is real source.
 *
 * Until this ran, every runtime a package embeds lived inside a `String.raw`
 * template in a `.ts` file: thousands of lines of JavaScript that no JavaScript
 * parser ever saw, that no editor highlighted, and that could only be tested by
 * concatenating the whole module and running it. A typo inside one of those
 * templates was a compile error in *emitted* programs, found by whichever
 * acceptance test happened to exercise that helper.
 *
 * Now `packages/<name>/runtime/*.js` holds those bodies as files that
 * `node --check` parses, and this script turns them back into the string
 * constants the emitter and the standard-module tables need. The generated file
 * is committed, because tests and every workspace package import the constants
 * from `src/`, and it is rewritten by `npm run build:packages` so a runtime edit
 * cannot ship stale.
 *
 * ## The manifest
 *
 * `runtime/manifest.json` says, for each file, which constant it feeds and
 * which `__velar…` helpers it defines and expects from a sibling; and for each
 * constant, the parts it is made of, left to right. A constant is either one
 * file, or a composition: fragments (named by constant) joined by the exact
 * separator the old template held, ending in the module's `export` block. The
 * composition is what keeps a runtime body in exactly one place — a shared
 * project module and the standalone inlined form are the same bytes, because
 * they are the same file. A part may name a constant another package owns;
 * `imports` says which module publishes it, and the generated module imports it
 * from there rather than restating a second copy.
 *
 * ## What is asserted
 *
 * Many sites across the compiler, Core, Web and Node interpolated a value at
 * module-evaluation time. Every one of those values is a constant known here —
 * an ABI key, a schema version, a module specifier, an export roster, the host
 * error names, the Look property tables — so the `.js` file holds the resolved
 * text and this script re-renders the value and refuses to generate if the two
 * have drifted. That is a stronger check than the template was: a template could
 * not disagree with its own interpolation, and these files can, so the
 * disagreement is now reportable instead of impossible.
 *
 * ## Per-compilation values
 *
 * A Desktop capability module closes over what the project's manifest granted:
 * the link schemes, the declared window kinds, the served services; the Web
 * runtime an emitted program carries closes over the Look keyword sets that
 * module styles; `velar/server` closes over the configuration file that project
 * selected, and the artifact-relative path a relocated build resolves it
 * through. Those are not generation-time constants and cannot be resolved into a
 * file, so the `.js` files are cut at whole lines above and below them and the
 * lines that carry them stay in a thin TypeScript assembly. `assemblies` records
 * each such module with a sample for every hole, so the assembled module is
 * still a parse unit and every fragment is still covered by one.
 *
 * `velar/serve` is assembled for a third reason: the route-shape rule it closes
 * over is the *compiled source* of `route-shape.ts`'s own function, so that the
 * analyzer and the emitted runtime cannot disagree about it (D90 R19(c)). Its
 * text therefore depends on how that module was loaded — type-stripped from
 * `src`, or compiled into `dist` — and resolving either form into a file would
 * change what the other emits.
 */

/**
 * The package roots whose runtime JavaScript is real source. Adding a root is
 * this list plus that package's `runtime/manifest.json`; the build, the two
 * gates, and the tests all iterate this and need no edit of their own.
 */
export const RUNTIME_PACKAGES = ["compiler", "core", "desktop", "web", "node", "server", "cli"];

/**
 * Where a constant a manifest imports is read from, to compute its value here.
 * The generated module imports it by the specifier on the left; this script
 * reads it out of the file on the right, which must be reachable **without a
 * built `dist`** — generation runs before the build, and in the isolated
 * toolchain build there is no `dist` to resolve a workspace package against.
 * So the entry names the module that declares the constant, not the package
 * entry point that re-exports it.
 *
 * An entry may instead map each borrowed name to the `runtime/*.js` file whose
 * text *is* that constant. For a constant the publishing package now generates
 * that is the only available form: `packages/node/src/runtime-sources.generated.ts`
 * imports `@velarscript/compiler/extension`, which resolves to a `dist` that
 * generation runs before, so importing it here would make a fresh checkout
 * unbuildable. Reading the file is also always current — an edit to it reaches
 * the borrowing package in the same run rather than in the next one.
 */
const IMPORT_SOURCES = new Map([
  ["@velarscript/compiler/extension", ["packages", "compiler", "src", "extension.ts"]],
  ["@velarscript/node/compiler", { VELAR_PROCESS_HOST_RUNTIME: ["packages", "node", "runtime", "process-host.js"] }],
]);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The generated module for one package root, and everything a caller needs to check it. */
export async function generateRuntimeSources(directory = root, package_ = "compiler") {
  const base = join(directory, "packages", package_, "runtime");
  const manifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8"));
  const text = new Map();
  for (const entry of manifest.files) text.set(entry.file, await readFile(join(base, entry.file), "utf8"));

  const problems = [...unresolvedInterpolations(package_, text)];
  const imported = await importedValues(directory, manifest, problems);
  problems.push(...await driftedInterpolations(directory, package_, text));
  const order = generationOrder(manifest, imported, problems);
  const value = new Map(imported);
  const lines = [
    "// Generated by scripts/generate-runtime-sources.mjs from",
    `// packages/${package_}/runtime/manifest.json and the .js files it names.`,
    "// Do not edit: edit the runtime source, then run `npm run build:packages`.",
    "//",
    "// D115 §一.4 — the JavaScript this package emits is real source that the",
    "// JavaScript parser checks; these constants are how it is read back in.",
    "",
  ];
  for (const [specifier, names] of Object.entries(manifest.imports ?? {})) {
    lines.push(`import { ${[...names].join(", ")} } from ${JSON.stringify(specifier)};`);
  }
  if (lines.at(-1) !== "") lines.push("");
  for (const entry of order) {
    value.set(entry.name, compose(entry.parts, value, text));
    if (entry.documentation !== undefined) lines.push(...entry.documentation);
    lines.push(`export const ${entry.name} = ${expression(entry.parts, text)};`, "");
  }
  const assemblies = new Map();
  for (const entry of manifest.assemblies ?? []) assemblies.set(entry.name, compose(entry.parts, value, text));
  return {
    package: package_,
    manifest,
    base,
    generated: join(directory, ...manifest.generated.split("/")),
    files: text,
    values: value,
    assemblies,
    problems,
    text: `${lines.join("\n").trimEnd()}\n`,
  };
}

/** Every package root's generated module, in `RUNTIME_PACKAGES` order. */
export async function generateAllRuntimeSources(directory = root) {
  const all = new Map();
  for (const package_ of RUNTIME_PACKAGES) all.set(package_, await generateRuntimeSources(directory, package_));
  publishedRuntimeFiles(all);
  return all;
}

/**
 * A constant borrowed as a `runtime/*.js` file must still be exactly that file
 * in the package that publishes it. Without this, a publisher that grew its
 * constant a second run would keep generating correctly while every borrower
 * silently took the first run alone — the drift the resolved-interpolation
 * assertions exist to make impossible, arriving through the other door.
 */
function publishedRuntimeFiles(all) {
  for (const [specifier, source] of IMPORT_SOURCES) {
    if (Array.isArray(source)) continue;
    for (const [name, path] of Object.entries(source)) {
      const owner = all.get(path.at(1));
      if (owner === undefined || path.at(2) !== "runtime") continue;
      const published = owner.values.get(name);
      if (published === undefined) {
        owner.problems.push(`${name} is borrowed through ${specifier} and this package declares no such constant`);
      } else if (published !== owner.files.get(path.at(-1))) {
        owner.problems.push(`${name} is borrowed through ${specifier} as ${path.join("/")}, which is no longer the whole of it`);
      }
    }
  }
}

/**
 * What a part list assembles to: an earlier constant, that constant JSON-encoded,
 * a file, a separator, or a sampled hole. A `json` part is how a module that
 * launches a Worker carries the Worker's own source — the emitted module holds
 * it as a string literal, and the Worker's source stays one file rather than
 * being written a second time, escaped, inside its launcher.
 */
function compose(parts, value, text) {
  return parts.map((part) => part.json !== undefined
    ? JSON.stringify(value.get(part.json))
    : part.constant !== undefined
      ? value.get(part.constant)
      : part.sample ?? part.separator ?? text.get(part.file)).join("");
}

/**
 * A composition is emitted as a concatenation of the constants it reuses, not
 * as one flattened literal: a flattened literal would be the same runtime body
 * written twice, which is the duplication D115 §一.4 exists to remove.
 */
function expression(parts, text) {
  return parts
    .map((part) => part.json !== undefined
      ? `JSON.stringify(${part.json})`
      : part.constant ?? JSON.stringify(part.separator ?? text.get(part.file)))
    .join(" + ");
}

/** The constant a part borrows, whether it borrows it as text or JSON-encoded. */
const borrowed = (part) => part.constant ?? part.json;

/** The value of every constant a manifest imports from another package. */
async function importedValues(directory, manifest, problems) {
  const values = new Map();
  for (const [specifier, names] of Object.entries(manifest.imports ?? {})) {
    const source = IMPORT_SOURCES.get(specifier);
    if (source === undefined) {
      problems.push(`manifest.json: imports from ${specifier}, which scripts/generate-runtime-sources.mjs has no source path for`);
      continue;
    }
    if (!Array.isArray(source)) {
      for (const name of names) {
        const path = source[name];
        if (path === undefined) {
          problems.push(`manifest.json: ${specifier} publishes no runtime file for '${name}'`);
          continue;
        }
        const found = await readFile(join(directory, ...path), "utf8")
          .catch((error) => { problems.push(`manifest.json: ${join(...path)} could not be read for ${name}: ${error instanceof Error ? error.message : String(error)}`); return null; });
        if (found !== null) values.set(name, found);
      }
      continue;
    }
    const module = await import(join(directory, ...source)).catch((error) => {
      problems.push(`manifest.json: ${join(...source)} could not be read for ${specifier}: ${error instanceof Error ? error.message : String(error)}`);
      return {};
    });
    for (const name of names) {
      if (typeof module[name] !== "string") {
        problems.push(`manifest.json: ${specifier} does not export a string constant '${name}'`);
        continue;
      }
      values.set(name, module[name]);
    }
  }
  return values;
}

/** Declaration order: a constant follows every constant it is composed from. */
function generationOrder(manifest, imported, problems) {
  const byName = new Map(manifest.constants.map((entry) => [entry.name, entry]));
  const ordered = [];
  const state = new Map();
  const visit = (entry, trail) => {
    const seen = state.get(entry.name);
    if (seen === "done") return;
    if (seen === "open") {
      problems.push(`manifest.json: ${[...trail, entry.name].join(" → ")} is a cycle; a constant cannot be composed from itself`);
      return;
    }
    state.set(entry.name, "open");
    for (const part of entry.parts) {
      const name = borrowed(part);
      if (name === undefined || imported.has(name)) continue;
      const dependency = byName.get(name);
      if (dependency === undefined) {
        problems.push(`manifest.json: ${entry.name} is composed from '${name}', which no entry declares and no import names`);
        continue;
      }
      visit(dependency, [...trail, entry.name]);
    }
    state.set(entry.name, "done");
    ordered.push(entry);
  };
  for (const entry of manifest.constants) visit(entry, []);
  for (const entry of manifest.assemblies ?? []) {
    for (const part of entry.parts) {
      const name = borrowed(part);
      if (name === undefined || imported.has(name) || byName.has(name)) continue;
      problems.push(`manifest.json: assembly '${entry.name}' is composed from '${name}', which no entry declares and no import names`);
    }
  }
  return ordered;
}

/**
 * A runtime file may not interpolate: `${` in one of these files would be a
 * template that never gets evaluated, emitted verbatim into a user's program.
 */
function* unresolvedInterpolations(package_, text) {
  for (const [file, source] of text) {
    const at = source.indexOf("${");
    if (at === -1) continue;
    const line = source.slice(0, at).split("\n").length;
    yield `packages/${package_}/runtime/${file}:${line}: a runtime source may not interpolate ('\${'); it is emitted verbatim`;
  }
}

/**
 * Every interpolation that was resolved into a runtime file, re-rendered from
 * the constant that used to produce it. Each names the file and the owner, so a
 * drift reads as "this file and that constant disagree" rather than as a diff.
 */
async function driftedInterpolations(directory, package_, text) {
  const assertions = RESOLVED_INTERPOLATIONS.get(package_);
  if (assertions === undefined) return [];
  const problems = [];
  const requireText = (file, expected, owner) => {
    const found = text.get(file);
    if (found === undefined) problems.push(`manifest.json: no entry for ${file}, which ${owner} is asserted against`);
    else if (!found.includes(expected)) {
      problems.push(`packages/${package_}/runtime/${file}: does not contain the text ${owner} renders — expected ${JSON.stringify(abbreviate(expected))}`);
    }
  };
  const requireExact = (file, expected, owner) => {
    const found = text.get(file);
    if (found !== expected) problems.push(`packages/${package_}/runtime/${file}: is not what ${owner} renders; regenerate it from the constant or fix the constant`);
  };
  await assertions(directory, { requireText, requireExact });
  return problems;
}

/**
 * Per package: the sites whose interpolated value was resolved into file text.
 * Desktop and Server have none — every hole they had is either a fragment
 * composition or a per-compilation grant, and neither resolves into a file.
 * Web's one per-compilation hole is the same shape (its Look keyword table), so
 * only its generation-time values are listed here.
 */
const RESOLVED_INTERPOLATIONS = new Map([
  ["compiler", async (directory, { requireText, requireExact }) => {
    const source = join(directory, "packages", "compiler", "src");
    const abi = await import(join(source, "runtime-abi.ts"));
    const modules = await import(join(source, "runtime-modules.ts"));

    requireText("json.js", `[${JSON.stringify(abi.VELAR_RUNTIME_REGISTRY_KEY)}], "Symbol.for"`, "VELAR_RUNTIME_REGISTRY_KEY");
    requireText("json.js", `runtime.version !== ${JSON.stringify(abi.VELAR_RUNTIME_SCHEMA_VERSION)}`, "VELAR_RUNTIME_SCHEMA_VERSION");
    requireText("json.js", `this module's schema ${abi.VELAR_RUNTIME_SCHEMA_VERSION};`, "VELAR_RUNTIME_SCHEMA_VERSION");
    requireText("promise.js", `[${JSON.stringify(abi.VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY)}]`, "VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY");
    requireText("type-registry.js", `[${JSON.stringify(abi.VELAR_TYPE_REGISTRY_KEY)}]`, "VELAR_TYPE_REGISTRY_KEY");

    requireExact("error-host.js", hostErrorRuntime(modules), "VELAR_HOST_ERROR_NAMES");
    for (const name of modules.VELAR_HOST_ERROR_NAMES) {
      requireText("error-exports.js", `  __Velar${name} as ${name},`, "VELAR_HOST_ERROR_NAMES");
    }
    requireExact("collection-host-exports.js", exportBlock(modules.VELAR_COLLECTION_HOST_EXPORTS), "VELAR_COLLECTION_HOST_EXPORTS");
    requireExact("collection-lowering-exports.js", exportBlock(modules.VELAR_COLLECTION_LOWERING_EXPORTS), "VELAR_COLLECTION_LOWERING_EXPORTS");
    requireText("collection-lowering-imports.js", `${nameBlock("import", modules.VELAR_COLLECTION_HOST_EXPORTS)} from ${JSON.stringify(modules.VELAR_COLLECTION_HOST_MODULE)};\n`, "VELAR_COLLECTION_HOST_EXPORTS");
    requireText("collection-lowering-imports.js", `} from ${JSON.stringify(modules.VELAR_REACTIVE_BRIDGE_MODULE)};\n`, "VELAR_REACTIVE_BRIDGE_MODULE");
  }],
  ["core", async (directory, { requireText, requireExact }) => {
    const source = join(directory, "packages", "compiler", "src");
    const abi = await import(join(source, "runtime-abi.ts"));
    const modules = await import(join(source, "runtime-modules.ts"));

    // The List guard and `velar/async` each read the reactive runtime out of the
    // same registry key, and the guard refuses a schema generation it was not
    // built against — once as the compared string, once inside the message that
    // tells an author which install is mixed.
    requireText("list.js", `__velarListSymbolFor(${JSON.stringify(abi.VELAR_RUNTIME_REGISTRY_KEY)})`, "VELAR_RUNTIME_REGISTRY_KEY");
    requireText("list.js", `runtime.version !== ${JSON.stringify(abi.VELAR_RUNTIME_SCHEMA_VERSION)}`, "VELAR_RUNTIME_SCHEMA_VERSION");
    requireText("list.js", `this module's schema ${abi.VELAR_RUNTIME_SCHEMA_VERSION};`, "VELAR_RUNTIME_SCHEMA_VERSION");
    requireText("async.js", `__velarAsyncDetachedRegistryKey = Symbol.for(${JSON.stringify(abi.VELAR_RUNTIME_REGISTRY_KEY)})`, "VELAR_RUNTIME_REGISTRY_KEY");

    // Three Core modules open by importing a compiler-owned runtime module by
    // specifier. The import block is the whole file, so the assertion is too.
    requireExact("binary-imports.js", `import { __VelarIndexError } from ${JSON.stringify(modules.VELAR_COLLECTION_LOWERING_MODULE)};\n`, "VELAR_COLLECTION_LOWERING_MODULE");
    requireExact(
      "validation-imports.js",
      `import {ValidationError, validationIsInstance, validationPath, validationPathAppend, ValidationPathKind, registerRuntimeType} from "${modules.VELAR_TYPE_VALIDATION_MODULE}";\n`
      + `import {__velarCopyList} from "${modules.VELAR_COLLECTION_LOWERING_MODULE}";\n`
      + `export {ValidationPathKind};\n`,
      "VELAR_TYPE_VALIDATION_MODULE and VELAR_COLLECTION_LOWERING_MODULE",
    );
    // D50 rule 97.2 / D59 rule 141: `toEqual` is the language's own `equals` and
    // `toBe` is its own `==`, so `velar/test` reaches for both rather than
    // restating a comparison here that could disagree with either.
    requireExact("test-imports.js", `import { __velarEquals, __velarSameValueZero } from "${modules.VELAR_COLLECTION_LOWERING_MODULE}";\n`, "VELAR_COLLECTION_LOWERING_MODULE");
  }],
  ["web", async (directory, { requireText }) => {
    const abi = await import(join(directory, "packages", "compiler", "src", "runtime-abi.ts"));
    const look = await import(join(directory, "packages", "web", "src", "look.ts"));
    const key = JSON.stringify(abi.VELAR_RUNTIME_REGISTRY_KEY);
    const version = JSON.stringify(abi.VELAR_RUNTIME_SCHEMA_VERSION);

    // Seven runtimes reach the one reactive registry, and three of them refuse a
    // schema generation they were not built against — once as the compared
    // string, once inside the sentence that tells an author which install is
    // mixed. Every one of those spellings is this constant, re-rendered here.
    requireText("foundation.js", `Symbol.for(${key})`, "VELAR_RUNTIME_REGISTRY_KEY");
    requireText("owned-callback.js", `globalThis[Symbol.for(${key})]`, "VELAR_RUNTIME_REGISTRY_KEY");
    requireText("web-host.js", `globalThis[Symbol.for(${key})]`, "VELAR_RUNTIME_REGISTRY_KEY");
    requireText("web-routing.js", `globalThis[Symbol.for(${key})]`, "VELAR_RUNTIME_REGISTRY_KEY");
    requireText("browser.js", `const timerRuntimeKey = Symbol.for(${key});`, "VELAR_RUNTIME_REGISTRY_KEY");
    requireText("list-guard.js", `__velarListNativeSymbol, [${key}]`, "VELAR_RUNTIME_REGISTRY_KEY");
    requireText("reactive-bridge.js", `__velarReactiveBridgeSymbolFor(${key})`, "VELAR_RUNTIME_REGISTRY_KEY");

    requireText("graph.js", `__velarVersion !== ${version}`, "VELAR_RUNTIME_SCHEMA_VERSION");
    requireText("graph.js", `this module's schema ${abi.VELAR_RUNTIME_SCHEMA_VERSION};`, "VELAR_RUNTIME_SCHEMA_VERSION");
    requireText("list-guard.js", `runtime.version !== ${version}`, "VELAR_RUNTIME_SCHEMA_VERSION");
    requireText("list-guard.js", `this module's schema ${abi.VELAR_RUNTIME_SCHEMA_VERSION};`, "VELAR_RUNTIME_SCHEMA_VERSION");
    requireText("reactive-bridge.js", `version !== ${version}`, "VELAR_RUNTIME_SCHEMA_VERSION");
    requireText("reactive-bridge.js", `this module's schema ${abi.VELAR_RUNTIME_SCHEMA_VERSION};`, "VELAR_RUNTIME_SCHEMA_VERSION");

    // The Look tables are the analyzer's, derived from the property table rather
    // than restated in the runtime: the two transition longhands take the same
    // vocabulary the matching builders take, the inline `style:*` roster is
    // every Look property under its CSS spelling, and its own length is the cap.
    requireText("look.js", `const transitionProperties = ${JSON.stringify([...look.LOOK_TRANSITION_PROPERTY_KEYWORDS])};`, "LOOK_TRANSITION_PROPERTY_KEYWORDS");
    requireText("look.js", `const lookTokenNamePattern = ${look.LOOK_TOKEN_NAME_PATTERN.toString()};`, "LOOK_TOKEN_NAME_PATTERN");
    requireText(
      "emitted-look.js",
      `__velarGraphCreateSet(${JSON.stringify([...look.LOOK_PROPERTIES].map(look.cssPropertyName))})`,
      "LOOK_PROPERTIES",
    );
    requireText("emitted-look.js", `if (names.length > ${look.LOOK_PROPERTIES.size})`, "LOOK_PROPERTIES.size");
  }],
  ["node", async (directory, { requireText }) => {
    const modules = await import(join(directory, "packages", "compiler", "src", "runtime-modules.ts"));

    // D50 rule 89: the shared privileged host rebuilds the compiler-owned
    // capability error classes rather than inventing a second set, so its first
    // line is the whole roster imported from the compiler's own module — and the
    // subset that carries a path is registered class by class further down.
    requireText(
      "node-host.js",
      `import { ${modules.VELAR_HOST_ERROR_NAMES.map((name) => `${name} as __Velar${name}`).join(", ")} }`
      + ` from ${JSON.stringify(modules.VELAR_ERROR_NORMALIZATION_MODULE)};\n`,
      "VELAR_HOST_ERROR_NAMES and VELAR_ERROR_NORMALIZATION_MODULE",
    );
    for (const name of modules.VELAR_HOST_ERROR_PATH_NAMES) {
      requireText("node-host.js", `__velarNodeHostPathErrorClasses[${JSON.stringify(name)}] = __Velar${name};`, "VELAR_HOST_ERROR_PATH_NAMES");
    }
  }],
  ["cli", async (directory, { requireText }) => {
    // The browser-test performance runtime publishes itself on one registry key
    // and every page-side call in `browser-test-runner.ts` reads it back from
    // the same one. The runtime holds the key resolved, so the two can now
    // disagree — which is why this re-renders it from the declaration. The key
    // lives in a module of its own because generation runs before any package
    // is built and `browser-test-runner.ts` imports `@velarscript/compiler`.
    const abi = await import(join(directory, "packages", "cli", "src", "browser-performance-abi.ts"));
    requireText("browser-performance.js", `Symbol.for(${JSON.stringify(abi.browserPerformanceRuntimeKey)})`, "browserPerformanceRuntimeKey");
  }],
]);

const nameBlock = (keyword, names) => `${keyword} {\n${names.map((name) => `  ${name},`).join("\n")}\n}`;
const exportBlock = (names) => `\n${nameBlock("export", names)};\n`;

/** D51 rule 107: the class a value was constructed from is what `code` reads. */
function hostErrorRuntime(modules) {
  const classes = modules.VELAR_HOST_ERROR_NAMES.map((name) => modules.VELAR_HOST_ERROR_PATH_NAMES.includes(name)
    ? `class __Velar${name} extends __velarHostErrorNativeError {
  constructor(message, path = null) {
    super(message);
    this.name = ${JSON.stringify(name)};
    this.path = path;
  }
}
// D51 rule 107: the class the value was constructed from is what 'code' reads,
// so a compiler-owned class carries the source-level name it reports.
__velarHostErrorDefineProperty(__Velar${name}, "name", { value: ${JSON.stringify(name)}, writable: false, enumerable: false, configurable: true });`
    : `class __Velar${name} extends __velarHostErrorNativeError {
  constructor(message) {
    super(message);
    this.name = ${JSON.stringify(name)};
  }
}
__velarHostErrorDefineProperty(__Velar${name}, "name", { value: ${JSON.stringify(name)}, writable: false, enumerable: false, configurable: true });`);
  return `const __velarHostErrorNativeError = globalThis.Error;
const __velarHostErrorDefineProperty = globalThis.Object.defineProperty;
${classes.join("\n")}
`;
}

const abbreviate = (value) => value.length <= 120 ? value : `${value.slice(0, 117)}…`;

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const failures = [];
  const written = [];
  for (const [package_, generated] of await generateAllRuntimeSources(root)) {
    if (generated.problems.length > 0) {
      failures.push(...generated.problems.map((problem) => `  packages/${package_}: ${problem}`));
      continue;
    }
    const existing = await readFile(generated.generated, "utf8").catch(() => null);
    const state = existing === generated.text
      ? "already current"
      : `rewrote ${generated.manifest.generated}`;
    if (existing !== generated.text) await writeFile(generated.generated, generated.text, "utf8");
    written.push(`runtime sources: ${package_} — ${generated.files.size} files → ${generated.manifest.constants.length} constants, ${state}`);
  }
  if (failures.length > 0) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.stderr.write("\nA runtime manifest and the sources it names disagree with the constants they were resolved from; nothing was written.\n");
    process.exit(1);
  }
  process.stdout.write(`${written.join("\n")}\n`);
}
