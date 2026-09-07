import { readFile as readRawFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY,
  VELAR_RUNTIME_REGISTRY_KEY,
  VELAR_RUNTIME_SCHEMA_VERSION,
  VELAR_TYPE_REGISTRY_KEY,
} from "../packages/compiler/src/runtime-abi.ts";
import {
  VELAR_CLASS_FIELD_MODULE_SOURCE,
  VELAR_COLLECTION_HOST_MODULE_SOURCE,
  VELAR_COLLECTION_LOWERING_MODULE_SOURCE,
  VELAR_COLLECTION_LOWERING_RUNTIME,
  VELAR_ERROR_NORMALIZATION_MODULE_SOURCE,
  VELAR_INDEX_ERROR_RUNTIME,
  VELAR_NARROWING_MODULE_SOURCE,
  VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE,
  VELAR_PRIMITIVE_METHOD_MODULE_SOURCE,
  VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE,
  VELAR_RANGE_MODULE_SOURCE,
  VELAR_RANGE_RUNTIME,
  VELAR_TEXT_METHOD_RUNTIME,
  VELAR_TYPE_VALIDATION_MODULE_SOURCE,
} from "../packages/compiler/src/runtime-sources.generated.ts";
import {
  VELAR_CLASS_FIELD_MODULE,
  VELAR_COLLECTION_HOST_EXPORTS,
  VELAR_COLLECTION_HOST_MODULE,
  VELAR_COLLECTION_LOWERING_DEPENDENCIES,
  VELAR_COLLECTION_LOWERING_EXPORTS,
  VELAR_COLLECTION_LOWERING_MODULE,
  VELAR_ERROR_NORMALIZATION_MODULE,
  VELAR_NARROWING_MODULE,
  VELAR_PRIMITIVE_METHOD_MODULE,
  VELAR_PROMISE_NORMALIZATION_MODULE,
  VELAR_RANGE_MODULE,
  VELAR_REACTIVE_BRIDGE_MODULE,
  VELAR_TYPE_VALIDATION_MODULE,
} from "../packages/compiler/src/runtime-modules.ts";
import { VELAR_REACTIVE_BRIDGE_MODULE_SOURCE } from "../packages/web/src/runtime-sources.generated.ts";
import { VELAR_WORKER_MANIFEST_MODULE, standardModuleInterfaces, standardModuleSources } from "../packages/core/src/index.ts";
import { esModuleExports } from "./es-module-exports.mjs";
import { RUNTIME_PACKAGES } from "./generate-runtime-sources.mjs";
import { velarCompilerExtension as velarWebCompilerExtension } from "../packages/web/src/compiler.ts";
import { VELAR_NODE_HOST_MODULE, velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { velarCompilerExtension as velarServerCompilerExtension } from "../packages/server/src/compiler.ts";
import { velarCompilerExtension as velarDesktopCompilerExtension } from "../packages/desktop/src/compiler.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const forbiddenApplicationLayers = ["libraries", "adapters", "integrations"];
const rootDirectories = new Set((await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name));
for (const layer of forbiddenApplicationLayers) {
  if (rootDirectories.has(layer)) failures.push(`${layer}/: application package layers do not belong to the language repository`);
}
const workspacePackages = [];
for (const entry of await readdir(join(root, "packages"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = join(root, "packages", entry.name);
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  workspacePackages.push({ directory, manifest });
}

const corePackage = workspacePackages.find((package_) => package_.manifest.name === "@velarscript/core");
if (!corePackage) failures.push("packages/core/package.json: Core package is missing");
else if (Object.hasOwn(corePackage.manifest.dependencies ?? {}, "@velarscript/node")) {
  failures.push("packages/core/package.json: Core must not select or depend on the Node target");
}
// Package direction is an execution boundary, not just repository tidiness.
// If Core/Compiler select a target, merely importing their public entry point
// initializes target code before a program has chosen that capability. Keep
// the exact dependency roster closed so Web, Node, Server, and Desktop can add
// behavior only through explicit composition, while CLI remains the one tool
// that is intentionally allowed to assemble every official target.
const packageDependencyPolicy = new Map([
  ["@velarscript/compiler", new Set(["acorn"])],
  ["@velarscript/core", new Set(["@velarscript/compiler"])],
  ["@velarscript/web", new Set(["@velarscript/compiler"])],
  ["@velarscript/node", new Set(["@velarscript/compiler", "ws"])],
  ["@velarscript/server", new Set(["@velarscript/compiler", "@velarscript/node", "yaml"])],
  ["@velarscript/desktop", new Set(["@velarscript/compiler", "@velarscript/node", "@velarscript/web"])],
  ["create-velar", new Set()],
  ["@velarscript/cli", new Set([
    "@velarscript/compiler", "@velarscript/core", "@velarscript/desktop", "@velarscript/node",
    "@velarscript/server", "@velarscript/web", "create-velar", "esbuild", "playwright",
  ])],
]);
for (const package_ of workspacePackages) {
  const allowed = packageDependencyPolicy.get(package_.manifest.name);
  if (!allowed) {
    failures.push(`${display(join(package_.directory, "package.json"))}: package has no dependency-boundary policy`);
    continue;
  }
  const actual = new Set(Object.keys({
    ...package_.manifest.dependencies,
    ...package_.manifest.optionalDependencies,
    ...package_.manifest.peerDependencies,
  }));
  for (const dependency of actual) {
    if (!allowed.has(dependency)) failures.push(`${display(join(package_.directory, "package.json"))}: dependency '${dependency}' crosses its package boundary`);
  }
  for (const dependency of allowed) {
    if (!actual.has(dependency)) failures.push(`${display(join(package_.directory, "package.json"))}: dependency-boundary policy has stale entry '${dependency}'`);
  }
}
const cliStandardModulesSource = await readFile(join(root, "packages", "cli", "src", "standard-modules.ts"), "utf8");
for (const phrase of ['from "@velarscript/core"', "extensions.length === 0 ? [velarNodeCompilerExtension] : extensions"]) {
  if (!cliStandardModulesSource.includes(phrase)) failures.push(`packages/cli/src/standard-modules.ts: composition facade is missing '${phrase}'`);
}
if (cliStandardModulesSource.length > 10_000) failures.push("packages/cli/src/standard-modules.ts: CLI has reabsorbed the Core Standard API implementation");

for (const package_ of workspacePackages) {
  for (const file of await sourceFiles(join(package_.directory, "src"))) {
    const source = await readFile(file, "utf8");
    if (/netlify/iu.test(source)) failures.push(`${display(file)}: provider-specific Netlify behavior crossed into the language toolchain`);
  }
}
const ledgerPath = join(root, "docs", "contributing", "runtime-boundary.md");
const ledger = await readFile(ledgerPath, "utf8");
const ids = new Set();
const classes = new Set();
const allowedClasses = new Set(["H", "E", "L", "R", "C", "U"]);
const row = /^\| (B-[A-Z0-9-]+) \| ([A-Z+]+) \|/gmu;

for (const match of ledger.matchAll(row)) {
  const id = match[1];
  if (ids.has(id)) failures.push(`docs/contributing/runtime-boundary.md: duplicate boundary id '${id}'`);
  ids.add(id);
  for (const value of match[2].split("+")) {
    if (!allowedClasses.has(value)) failures.push(`docs/contributing/runtime-boundary.md: boundary '${id}' uses unknown class '${value}'`);
    classes.add(value);
  }
}

if (ids.size < 20) failures.push(`docs/contributing/runtime-boundary.md: expected at least 20 classified boundary operations, found ${ids.size}`);
for (const value of allowedClasses) {
  if (!classes.has(value)) failures.push(`docs/contributing/runtime-boundary.md: boundary class '${value}' has no ledger row`);
}
for (const phrase of [
  "remains the authority for source-level",
  "VELAR_RUNTIME_REGISTRY_KEY",
  "VELAR_RUNTIME_SCHEMA_VERSION",
  "Required feature decision record",
  "Verification gate",
]) {
  if (!ledger.includes(phrase)) failures.push(`docs/contributing/runtime-boundary.md: missing required contract phrase '${phrase}'`);
}

const charter = await readFile(join(root, "docs", "language-charter.md"), "utf8");
const architecture = await readFile(join(root, "docs", "contributing", "compiler-architecture.md"), "utf8");
// Resolve the link rather than substring-matching the filename: a bare
// `includes("runtime-boundary.md")` stayed green after the ledger moved into
// docs/contributing/, so the gate reported a link it could no longer follow.
for (const [source, document, role] of [
  ["docs/language-charter.md", charter, "authority"],
  ["docs/contributing/compiler-architecture.md", architecture, "ownership"],
]) {
  const links = [...document.matchAll(/\]\(([^)]*runtime-boundary\.md)\)/gu)].map((match) => match[1]);
  if (links.length === 0) {
    failures.push(`${source}: missing runtime boundary ${role} link`);
    continue;
  }
  for (const link of links) {
    const target = resolve(root, dirname(source), link);
    if (!await readFile(target, "utf8").then(() => true, () => false)) {
      failures.push(`${source}: runtime boundary ${role} link '${link}' does not resolve`);
    }
  }
}

const ownedLiteral = JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY);
const ownedVersion = JSON.stringify(VELAR_RUNTIME_SCHEMA_VERSION);
const ownedTypeLiteral = JSON.stringify(VELAR_TYPE_REGISTRY_KEY);
const ownedPromiseLiteral = JSON.stringify(VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY);
const sourceRoots = workspacePackages.map((package_) => join(package_.directory, "src"));
for (const directory of sourceRoots) {
  for (const file of await sourceFiles(directory)) {
    if (file === join(root, "packages", "compiler", "src", "runtime-abi.ts")) continue;
    // D114 R2: `runtime-sources.generated.ts` carries the resolved ABI keys
    // because the runtime `.js` files it is generated from do — a runtime body
    // cannot import a TypeScript constant. That is not a second copy escaping
    // review: `scripts/generate-runtime-sources.mjs` re-renders every one of
    // those keys from `runtime-abi.ts` and refuses to generate when they
    // disagree, which is a stronger tie to the owner than this scan is.
    if (file === join(root, "packages", "compiler", "src", "runtime-sources.generated.ts")) continue;
    const source = await readFile(file, "utf8");
    if (source.includes(ownedLiteral) || source.includes(`'${VELAR_RUNTIME_REGISTRY_KEY}'`)) {
      failures.push(`${display(file)}: repeats VELAR_RUNTIME_REGISTRY_KEY instead of importing its owner`);
    }
    if (source.includes(ownedTypeLiteral) || source.includes(`'${VELAR_TYPE_REGISTRY_KEY}'`)) {
      failures.push(`${display(file)}: repeats VELAR_TYPE_REGISTRY_KEY instead of importing its owner`);
    }
    if (source.includes(ownedPromiseLiteral) || source.includes(`'${VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY}'`)) {
      failures.push(`${display(file)}: repeats VELAR_PROMISE_NORMALIZATION_REGISTRY_KEY instead of importing its owner`);
    }
    const repeatsVersion = new RegExp(`(?:runtime\\.version\\s*(?:===|!==)|version\\s*:)\\s*["']${escapeRegex(VELAR_RUNTIME_SCHEMA_VERSION)}["']`, "u");
    if (repeatsVersion.test(source)) {
      failures.push(`${display(file)}: repeats VELAR_RUNTIME_SCHEMA_VERSION instead of importing its owner`);
    }
  }
}

const retiredConcreteStandardModules = [
  "velar/compression",
  "velar/database",
  "velar/javascript",
  "velar/msgpack",
  "velar/noise",
  "velar/sqlite",
  "velar/text-buffer",
];
for (const directory of sourceRoots) {
  for (const file of await sourceFiles(directory)) {
    const source = await readFile(file, "utf8");
    for (const specifier of retiredConcreteStandardModules) {
      const importPattern = new RegExp(`\\bfrom\\s+["']${escapeRegex(specifier)}["']`, "u");
      if (importPattern.test(source)) {
        failures.push(`${display(file)}: retired application module '${specifier}' crossed back into the language toolchain`);
      }
    }
  }
}
const nonStandardPackages = new Set([
  "@velarscript/compression",
  "@velarscript/database",
  "@velarscript/editor-kit",
  "@velarscript/msgpack",
  "@velarscript/netlify",
  "@velarscript/noise",
  "@velarscript/script-analysis",
  "@velarscript/sqlite",
  "@velarscript/text-buffer",
  "@velarscript/yaml",
]);
for (const package_ of workspacePackages) {
  const manifestPath = join(package_.directory, "package.json");
  const dependencies = {...package_.manifest.dependencies, ...package_.manifest.optionalDependencies};
  for (const dependency of Object.keys(dependencies)) {
    if (dependency.startsWith("@velarscript-labs/") || nonStandardPackages.has(dependency)) {
      failures.push(`${display(manifestPath)}: non-standard dependency '${dependency}' crosses the toolchain boundary`);
    }
  }
}

// D115 §一.4 / D114 R2 and R2b: the emitted JavaScript of the compiler, Core and
// Desktop is real source under each package's `runtime/`, and this gate reads it
// there. A runtime family is every file that package's `runtime/manifest.json`
// gives that family, joined and read as one text, so a fragment split out later
// stays covered without editing a list here — the same judgment the analysis and
// emission layers above are read by.
const runtimeManifests = new Map();
const runtimeFileText = new Map();
for (const package_ of RUNTIME_PACKAGES) {
  const directory = join(root, "packages", package_, "runtime");
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  runtimeManifests.set(package_, manifest);
  for (const entry of manifest.files) {
    runtimeFileText.set(`${package_}/${entry.file}`, await readFile(join(directory, entry.file), "utf8"));
  }
}
function packageFamilySource(package_, family) {
  const files = runtimeManifests.get(package_).files.filter((entry) => entry.family === family);
  if (files.length === 0) failures.push(`packages/${package_}/runtime/manifest.json: no runtime family '${family}'`);
  return files.map((entry) => runtimeFileText.get(`${package_}/${entry.file}`)).join("\n");
}
const runtimeFamilySource = (family) => packageFamilySource("compiler", family);
const coreFamilySource = (family) => packageFamilySource("core", family);
const desktopFamilySource = (family) => packageFamilySource("desktop", family);
const nodeFamilySource = (family) => packageFamilySource("node", family);
const webFamilySource = (family) => packageFamilySource("web", family);
/**
 * The runs one constant writes itself, in module order — its `file` parts, not
 * the runtimes it borrows. A rule about what a module's *own* text may touch
 * reads this; a rule about the whole emitted module reads the family.
 */
function constantFileSource(package_, name) {
  const entry = runtimeManifests.get(package_).constants.find((constant) => constant.name === name);
  if (entry === undefined) {
    failures.push(`packages/${package_}/runtime/manifest.json: no constant '${name}'`);
    return "";
  }
  return entry.parts.flatMap((part) => part.file === undefined ? [] : [runtimeFileText.get(`${package_}/${part.file}`)]).join("\n");
}
/** One Web runtime source by name, so a rule about one module reads that module. */
function webRuntimeFile(...files) {
  return files.map((file) => {
    const source = runtimeFileText.get(`web/${file}`);
    if (source === undefined) failures.push(`packages/web/runtime/manifest.json: no entry for ${file}`);
    return source ?? "";
  }).join("");
}
/** Every line of JavaScript the Web framework ships, as one text. */
const webRuntimeSourceText = [...runtimeFileText]
  .filter(([file]) => file.startsWith("web/"))
  .map(([, source]) => source).join("\n");
/**
 * The same text minus the three runtimes whose subject *is* a host event
 * source: `velar/worker` and `velar/websocket` read `event.data` off the
 * message the host handed them, and the realtime client layered on the latter
 * reads the same fields. Everywhere else a host event is reached through the
 * captured native getter or a data-descriptor read, which is what the event
 * rule below keeps true.
 */
const webAdapterRuntimeSource = [...runtimeFileText]
  .filter(([file]) => file.startsWith("web/") && !["web/worker.js", "web/websocket.js", "web/realtime-client.js"].includes(file))
  .map(([, source]) => source).join("\n");
const webReactiveBridgeRuntimeSource = webFamilySource("reactive-bridge");
const webLocalBridgeRuntimeSource = webFamilySource("local-bridge");
/** Every Desktop runtime file as one text: the JavaScript this target ships. */
const desktopRuntimeSourceText = [...runtimeFileText]
  .filter(([file]) => file.startsWith("desktop/"))
  .map(([, source]) => source).join("\n");

// D115 P3 moved Core's and Desktop's module bodies out of these `.ts` files and
// into their `runtime/*.js`, so the scan follows them: the rule is about the
// JavaScript that ships, and reading only the TypeScript would now read nothing.
const strictJsonConsumers = [
  join(root, "packages", "core", "src", "index.ts"),
  join(root, "packages", "web", "src", "runtime.ts"),
  join(root, "packages", "node", "src", "compiler.ts"),
  join(root, "packages", "desktop", "src", "compiler.ts"),
];
const strictJsonConsumerSources = [];
for (const file of strictJsonConsumers) strictJsonConsumerSources.push([display(file), await readFile(file, "utf8")]);
for (const [file, source] of runtimeFileText) {
  if (/^(?:core|desktop|node|server)\//u.test(file)) {
    strictJsonConsumerSources.push([`packages/${file.replace("/", "/runtime/")}`, source]);
  }
}
for (const [file, source] of strictJsonConsumerSources) {
  if (/\bJSON\.parse\s*\(/u.test(source)) {
    failures.push(`${file}: parses official-module JSON outside the compiler-owned strict runtime`);
  }
}

const webRuntimeSource = await readFile(join(root, "packages", "web", "src", "runtime.ts"), "utf8");
// D115 P4: every rule below reads a *family* — the entry module plus every
// `.ts` under the sibling directories that hold what P4 splits out of it — so
// a phrase that moves into `modules/` or `emit/` is still found and a refusal
// still refuses it wherever in the family it is written. See `sourceFamily`.
const webCompilerSource = await sourceFamily("packages/web/src/compiler.ts", "packages/web/src/modules");
const webEmitterSource = await sourceFamily("packages/web/src/emitter.ts", "packages/web/src/emit");
const nodeCompilerSource = await sourceFamily("packages/node/src/compiler.ts", "packages/node/src/modules");
// D114 R2d: every rule below used to read one of eleven `*-runtime.ts` files and
// scan the `String.raw` template inside it. Those bodies are `packages/node/runtime/*.js`
// now, so each rule reads the family — every file the manifest gives that family
// — and a run split out later stays covered without editing a list here.
const nodeHttpRuntimeSource = nodeFamilySource("http");
const nodeEnvironmentRuntimeSource = nodeFamilySource("env");
const nodeFilesystemRuntimeSource = nodeFamilySource("filesystem");
const nodeHostRuntimeSource = nodeFamilySource("host");
const sharedNodeHostRuntimeSource = nodeFamilySource("node-host");
const sharedNodeHostWorkerRuntimeSource = nodeFamilySource("node-host-worker");
// The captured host-intrinsic ABI is one file and the rule below is about that
// file: the rest of the `process` family is the module built on top of it.
const nodeProcessHostRuntimeSource = runtimeFileText.get("node/process-host.js");
const nodeProcessWorkerRuntimeSource = nodeFamilySource("process-worker");
const nodeServeRuntimeSource = `${constantFileSource("node", "VELAR_NODE_SERVE_PREFIX")}\n${constantFileSource("node", "VELAR_NODE_SERVE_BODY")}`;
const nodeTerminalRuntimeSource = nodeFamilySource("terminal");
const nodeTerminalWorkerRuntimeSource = nodeFamilySource("terminal-worker");
const compilerAnalyzerSource = await readFile(join(root, "packages", "compiler", "src", "analyzer.ts"), "utf8");
// D114 R1a/R1b: the analysis layer is `analyzer.ts` plus the collaborators it
// owns under `analysis/`. A phrase this gate pins is pinned to the layer, not
// to whichever file of it currently holds the code.
const compilerAnalysisSources = new Map([["packages/compiler/src/analyzer.ts", compilerAnalyzerSource]]);
for (const file of await sourceFiles(join(root, "packages", "compiler", "src", "analysis"))) {
  compilerAnalysisSources.set(display(file), await readFile(file, "utf8"));
}
const compilerAnalysisIncludes = (phrase) => [...compilerAnalysisSources.values()].some((source) => source.includes(phrase));
const COMPILER_ANALYSIS_LAYER = "packages/compiler/src/analyzer.ts and analysis/*.ts";
// D114 R1c: the emission layer is `emitter.ts` plus every collaborator it owns
// under `emit/`, read as one text at run time so a module added later is
// covered without editing anything here. Every assertion below is about what
// the layer emits, not about which of its files says it.
const compilerEmitterSource = (await Promise.all([
  readFile(join(root, "packages", "compiler", "src", "emitter.ts"), "utf8"),
  ...(await sourceFiles(join(root, "packages", "compiler", "src", "emit"))).map((file) => readFile(file, "utf8")),
])).join("\n");
// Three of the checks below are slices anchored on where a family's emission
// begins and ends, so they name the module that holds it rather than the joined
// layer: `emit/validators.ts` and `emit/type-checks.ts` for the runtime `Type`
// declaration, `emit/matching.ts` for the structural match.
const compilerEmitValidatorSource = await readFile(join(root, "packages", "compiler", "src", "emit", "validators.ts"), "utf8");
const compilerEmitTypeCheckSource = await readFile(join(root, "packages", "compiler", "src", "emit", "type-checks.ts"), "utf8");
const compilerEmitMatchingSource = await readFile(join(root, "packages", "compiler", "src", "emit", "matching.ts"), "utf8");
const compilerExtensionSource = await readFile(join(root, "packages", "compiler", "src", "extension.ts"), "utf8");
const compilerContractsSource = await readFile(join(root, "packages", "compiler", "src", "contracts.ts"), "utf8");
// D114 R1c: `CompilerAnalysisExtension` and the intrinsic context it hands an
// extension are declared in `contracts.ts` now; the protocol is both files.
const compilerExtensionProtocolIncludes = (phrase) => compilerExtensionSource.includes(phrase) || compilerContractsSource.includes(phrase);
const compilerIndexSource = await readFile(join(root, "packages", "compiler", "src", "index.ts"), "utf8");
const compilerClassRuntimeSource = runtimeFamilySource("class");
const compilerCollectionRuntimeSource = runtimeFamilySource("collection-host");
const compilerCollectionLoweringRuntimeSource = runtimeFamilySource("collection-lowering");
const compilerErrorRuntimeSource = runtimeFamilySource("error");
const compilerNarrowingRuntimeSource = runtimeFamilySource("narrowing");
const compilerJsonRuntimeSource = runtimeFamilySource("json");
const compilerNumberRuntimeSource = runtimeFamilySource("number");
const compilerPrimitiveRuntimeSource = runtimeFamilySource("primitive");
const compilerPromiseRuntimeSource = runtimeFamilySource("promise");
const compilerTextRuntimeSource = runtimeFamilySource("text");
const compilerTypeRegistryRuntimeSource = runtimeFamilySource("type-registry");
const compilerTypeValidationRuntimeSource = runtimeFamilySource("type-validation");
// The generated module is where a runtime *composition* is now written down:
// which fragments a shared project module is made of, and in which order.
function runtimeComposition(name, package_ = "compiler") {
  const entry = runtimeManifests.get(package_).constants.find((constant) => constant.name === name);
  if (entry === undefined) {
    failures.push(`packages/${package_}/runtime/manifest.json: no constant '${name}'`);
    return [];
  }
  // A `json` part borrows a constant too — it is that constant, encoded as the
  // string literal the module launching a Worker carries its source in.
  return entry.parts.flatMap((part) => {
    const borrowed = part.constant ?? part.json;
    return borrowed === undefined ? [] : [borrowed];
  });
}
const compilerGeneratedRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "runtime-sources.generated.ts"), "utf8");
const compilerRuntimeModulesSource = await readFile(join(root, "packages", "compiler", "src", "runtime-modules.ts"), "utf8");
// Core owns a static bridge and no reactive provider; the provider ownership
// check reads both halves of where that could now be written.
const compilerReactiveBridgeRuntimeSource = `${runtimeFamilySource("reactive-bridge")}\n${compilerRuntimeModulesSource}`;
// D114 R1c: the type model is `types.ts` plus every module it re-exports from
// `types/`, and the analysis half of the extension protocol moved from
// `extension.ts` to `contracts.ts`. Both are read as the layer they now are,
// at run time, so a module added later is covered without editing a list here.
const compilerTypesSources = new Map([["packages/compiler/src/types.ts", await readFile(join(root, "packages", "compiler", "src", "types.ts"), "utf8")]]);
for (const file of await sourceFiles(join(root, "packages", "compiler", "src", "types"))) {
  compilerTypesSources.set(display(file), await readFile(file, "utf8"));
}
const compilerTypesIncludes = (phrase) => [...compilerTypesSources.values()].some((source) => source.includes(phrase));
const COMPILER_TYPES_LAYER = "packages/compiler/src/types.ts and types/*.ts";
const desktopCompilerSource = await readFile(join(root, "packages", "desktop", "src", "compiler.ts"), "utf8");
const webTypesSource = await readFile(join(root, "packages", "web", "src", "types.ts"), "utf8");

const coreWebSocket = standardModuleInterfaces().get("velar/websocket");
const webWebSocket = standardModuleInterfaces([velarWebCompilerExtension]).get("velar/websocket");
const nodeWebSocket = standardModuleInterfaces([velarNodeCompilerExtension]).get("velar/websocket");
const serverApplication = standardModuleInterfaces([velarServerCompilerExtension]).get("velar/server");
if (coreWebSocket) failures.push("packages/core/src/index.ts: Core must not own the target-specific velar/websocket surface");
if (!webWebSocket || webWebSocket.exports.has("listen") || webWebSocket.exports.has("WebSocketServer")) {
  failures.push("packages/web/src/compiler.ts: Web velar/websocket must remain client-only");
}
if (!nodeWebSocket?.exports.has("listen") || !nodeWebSocket.exports.has("WebSocketServer")) {
  failures.push("packages/node/src/compiler.ts: Node must own the WebSocket server surface");
}
if (!serverApplication?.exports.has("application") || !serverApplication.exports.has("authenticate") || !serverApplication.exports.has("configuration") || !serverApplication.exports.has("database")) {
  failures.push("packages/server/src/compiler.ts: Server must own application configuration, authentication, and connection lifecycle composition");
}
if (standardModuleInterfaces([velarNodeCompilerExtension]).has("velar/server")) {
  failures.push("packages/node/src/compiler.ts: the Node capability must not own the convention-based velar/server application module");
}

const desktopSources = [];
for (const directory of [join(root, "packages", "desktop", "src"), join(root, "packages", "desktop", "native")]) {
  for (const file of await sourceFiles(directory)) desktopSources.push([display(file), await readFile(file, "utf8")]);
}
// The Desktop runtime moved out of `src/compiler.ts` into `runtime/*.js`
// (D115 P3), and it is still Desktop framework source, so it is still scanned.
for (const [file, source] of runtimeFileText) {
  if (file.startsWith("desktop/")) desktopSources.push([`packages/${file.replace("/", "/runtime/")}`, source]);
}
for (const [file, source] of desktopSources) {
  for (const retired of [
    "LanguageServer", "ProjectTask", "ProjectChanges", "TerminalSession", "openTerminal", "languageServer",
    "startProjectTask", "projectChanges", "project-transactions", "terminal-owned", "language-server", "project-task", "@velaros",
  ]) {
    if (source.includes(retired)) failures.push(`${file}: product tooling '${retired}' crossed into the Desktop language framework`);
  }
}

const applicationPackageAbi = await readFile(join(root, "packages", "compiler", "src", "application-package-host.ts"), "utf8");
if (applicationPackageAbi.includes("buildTool") || !applicationPackageAbi.includes("PROTOCOL_VERSION = 3")) {
  failures.push("packages/compiler/src/application-package-host.ts: application packaging must expose only the checked framework build to its target container");
}
const cliSources = [];
for (const file of await sourceFiles(join(root, "packages", "cli", "src"))) cliSources.push([file, await readFile(file, "utf8")]);
for (const [file, source] of cliSources) {
  for (const retired of ["VELAR_PROJECT_TASK_TOOL_ID", "VELAR_BUILD_ENGINE_TOOL_ID", "copyPackagedOfficialTool", "buildTool:"]) {
    if (source.includes(retired)) failures.push(`${display(file)}: product-packaging hook '${retired}' crossed into the CLI`);
  }
}

// D114 R1b: every Core compiler module is scanned, not a fixed list of six.
// The list went stale the moment `contracts.ts` and `analysis/*.ts` were split
// out of `analyzer.ts`, and a list that has to be edited whenever a module is
// added is a gate that silently stops covering the new module. The emitted
// runtime sources are excluded because they are JavaScript held in template
// literals, checked by their own rules above.
const coreTargetBoundarySources = new Map();
for (const file of await sourceFiles(join(root, "packages", "compiler", "src"))) {
  if (/-runtime\.ts$/u.test(file)) continue;
  // The rule is that Core must not *embed* a target-owned name. Naming one in
  // prose is how the extension contract explains itself, so the scan reads the
  // code with its comments removed.
  coreTargetBoundarySources.set(display(file), codeWithoutComments(await readFile(file, "utf8")));
}
for (const [path, source] of coreTargetBoundarySources) {
  for (const targetName of ["WebNode", "ComponentDeclaration", "JSX", "LookExpression", "MountedBlock", "UnsafeCssImportDeclaration"]) {
    if (source.includes(targetName)) failures.push(`${path}: Core embeds target-owned '${targetName}' instead of using the compiler extension contract`);
  }
}
// D115 §二: no new multi-line JavaScript template string in the TypeScript of a
// package whose runtime has become real source. The lines that used to live in
// `String.raw` templates are `.js` files now — the compiler's in D114 R2, Core's
// and Desktop's in R2b, Web's in R2c, Node's and Server's in R2d, the CLI's
// browser-test page runtime in D115 P4 R3-0 — and the rule that keeps them
// there is this one: a `String.raw` literal spanning more than one line is how
// every one of them started. Every package root D115 P3 covers is scanned,
// which is all of them. The allowlist is the escape hatch for a genuinely
// non-JavaScript multi-line raw literal, and it is empty on purpose: an entry
// is a decision, named in the commit.
const COMPILER_SOURCE_RAW_TEMPLATE_ALLOWLIST = new Set([]);
const rawTemplateScopes = [
  ["packages/compiler/src", join(root, "packages", "compiler", "src")],
  ["packages/core/src", join(root, "packages", "core", "src")],
  ["packages/desktop/src", join(root, "packages", "desktop", "src")],
  ["packages/web/src", join(root, "packages", "web", "src")],
  ["packages/node/src", join(root, "packages", "node", "src")],
  ["packages/server/src", join(root, "packages", "server", "src")],
  ["packages/cli/src", join(root, "packages", "cli", "src")],
];
for (const [scope, directory] of rawTemplateScopes) {
  for (const file of await sourceFiles(directory)) {
    const code = codeWithoutComments(await readFile(file, "utf8"));
    for (const match of code.matchAll(/String\.raw\s*`/gu)) {
      // Find the literal's own closing backtick rather than the next one: a
      // `\`` escape and a backtick inside `${…}` are both still inside it, and
      // a scan that stopped at either would call a multi-line runtime a
      // one-liner and let it through.
      let cursor = match.index + match[0].length;
      let depth = 0;
      while (cursor < code.length) {
        const character = code[cursor];
        if (character === "\\") { cursor += 2; continue; }
        if (character === "$" && code[cursor + 1] === "{") { depth += 1; cursor += 2; continue; }
        if (depth > 0 && character === "}") { depth -= 1; cursor += 1; continue; }
        if (depth === 0 && character === "`") break;
        cursor += 1;
      }
      const literal = code.slice(match.index, cursor);
      if (!literal.includes("\n")) continue;
      const path = display(file);
      if (COMPILER_SOURCE_RAW_TEMPLATE_ALLOWLIST.has(path)) continue;
      const line = code.slice(0, match.index).split("\n").length;
      failures.push(`${path}:${line}: a multi-line String.raw literal is emitted JavaScript held in TypeScript; put it in ${scope.replace("/src", "/runtime")}/*.js and let scripts/generate-runtime-sources.mjs make the constant (D115 §一.4)`);
    }
  }
}
// …and the runtime sources those templates became may not interpolate: `${` in
// a `.js` file under `runtime/` is a template nothing evaluates, copied verbatim
// into a user's program.
for (const [file, source] of runtimeFileText) {
  if (source.includes("${")) failures.push(`packages/${file.replace("/", "/runtime/")}: a runtime source may not interpolate ('\${'); it is emitted verbatim`);
}

for (const phrase of ["ExtensionValueType", "resolveTypeSyntax", "isTypeAssignable", "memberType"]) {
  const includes = phrase === "ExtensionValueType" ? compilerTypesIncludes : compilerExtensionProtocolIncludes;
  if (!includes(phrase)) failures.push(`packages/compiler: target type extension contract is missing '${phrase}'`);
}
for (const phrase of ["VELAR_WEB_TYPE_EXTENSION_ID", "resolveWebTypeSyntax", "isWebTypeAssignable", "webComponentConstructor"]) {
  if (!webTypesSource.includes(phrase)) failures.push(`packages/web/src/types.ts: Web does not own '${phrase}'`);
}
if (desktopCompilerSource.includes("...webCompilerExtension")) {
  failures.push("packages/desktop/src/compiler.ts: Desktop inherits hidden Web compiler behavior through object spread");
}
for (const phrase of [
  '"@velarscript/web": webCompilerExtension.contract!.apiVersion',
  '"@velarscript/node": VELAR_NODE_API_VERSION',
  "formatting: webCompilerExtension.formatting!",
  "createEmitter: webCompilerExtension.createEmitter!",
]) {
  if (!desktopCompilerSource.includes(phrase)) failures.push(`packages/desktop/src/compiler.ts: explicit application composition is missing '${phrase}'`);
}

for (const phrase of [
  "const __velarClassNativeObject = globalThis.Object",
  "const __velarClassNativeReflect = globalThis.Reflect",
  "const __velarClassNativeTypeError = globalThis.TypeError",
  "const __velarClassReflectApply = __velarClassGetOwnPropertyDescriptor",
  "const __velarClassReflectGet = __velarClassGetOwnPropertyDescriptor",
  "const __velarClassGetPrototypeOf = __velarClassGetOwnPropertyDescriptor",
  "function __velarReadInstanceField(receiver, name)",
  "function __velarReadPrivateField(value, name)",
  "function __velarReadStaticField(receiver, name, ownerDepth)",
]) {
  if (!compilerClassRuntimeSource.includes(phrase)) failures.push(`packages/compiler: class field runtime is missing captured host operation '${phrase}'`);
}
if (/\b(?:Object\.(?:getOwnPropertyDescriptor|getPrototypeOf)|Reflect\.(?:apply|get))\s*\(|\bnew TypeError\b|\.call\s*\(/u.test(compilerClassRuntimeSource)) {
  failures.push("packages/compiler/runtime/class.js: checked class field reads bypass their captured Object, Reflect, or Error ABI");
}
if (!compilerEmitterSource.includes("helpers.push(VELAR_CLASS_FIELD_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: checked class field reads bypass the compiler-owned class runtime");
}
for (const name of ["readInstanceField", "readPrivateField", "readStaticField"]) {
  if (!VELAR_CLASS_FIELD_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/runtime/class-exports.js: shared class-field runtime does not export '${name}'`);
  }
}
for (const phrase of [
  "VELAR_CLASS_FIELD_MODULE_SOURCE",
  "this.requiredRuntimeModules.add(VELAR_CLASS_FIELD_MODULE)",
  '["readInstanceField", "__velarReadInstanceField"]',
  '["readPrivateField", "__velarReadPrivateField"]',
  '["readStaticField", "__velarReadStaticField"]',
  "from ${JSON.stringify(VELAR_CLASS_FIELD_MODULE)}",
]) {
  const source = phrase === "VELAR_CLASS_FIELD_MODULE_SOURCE" ? compilerGeneratedRuntimeSource : compilerEmitterSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: project class-field runtime contract is missing '${phrase}'`);
}
for (const phrase of [
  '"  const value = Reflect.get(receiver, name);"',
  '"  for (let depth = 0; depth < ownerDepth; depth += 1) owner = Object.getPrototypeOf(owner);"',
  '"  const descriptor = owner == null ? null : Object.getOwnPropertyDescriptor(owner, name);"',
]) {
  if (compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: retains ambient class field helper '${phrase}'`);
}
for (const phrase of [
  "const __velarReactiveBridgeGlobal = globalThis",
  "const __velarReactiveBridgeNativeObject = globalThis.Object",
  "const __velarReactiveBridgeNativeSymbol = globalThis.Symbol",
  "const __velarReactiveBridgeNativeTypeError = globalThis.TypeError",
  "const __velarReactiveBridgeGetPrototypeOf = __velarReactiveBridgeGetOwnPropertyDescriptor",
  "const __velarReactiveBridgeIsExtensible = __velarReactiveBridgeGetOwnPropertyDescriptor",
  "const __velarReactiveBridgeOwnSymbols = __velarReactiveBridgeGetOwnPropertyDescriptor",
  "const __velarReactiveBridgeSymbolFor = __velarReactiveBridgeGetOwnPropertyDescriptor",
  "function __velarResolveReactiveBridge()",
  "if (!descriptor) return null",
  "__velarReactiveBridge = { runtime, toRaw }",
  "function __velarResolveReactiveCollectionBridge()",
  "__velarReactiveCollectionBridge = { runtime: bridge.runtime, toRaw: bridge.toRaw",
  "function __velarReactiveCollectionTrigger(value, key, iterate = true, structure = false, indexFrom = null, allKeys = false)",
  "bridge.collectionTrigger(value, key, iterate, structure, indexFrom, allKeys)",
]) {
  if (!webReactiveBridgeRuntimeSource.includes(phrase)) failures.push(`packages/web/runtime: reactive bridge runtime is missing captured or late-binding operation '${phrase}'`);
}
if (/\b(?:Object\.(?:getOwnPropertyDescriptor|getPrototypeOf|isExtensible|getOwnPropertySymbols)|Symbol\.for)\s*\(|\bnew TypeError\b|\.call\s*\(|\bruntime\.(?:toRaw|reactive|track|collectionRead|collectionTrigger|collectionUnlink)\s*\(/u.test(webReactiveBridgeRuntimeSource)) {
  failures.push("packages/web/runtime: JavaScript or collection bridging bypasses its captured registry, Object, Symbol, or Error ABI");
}
for (const phrase of ["VELAR_RUNTIME_REGISTRY_KEY", "VELAR_RUNTIME_SCHEMA_VERSION", "__velarResolveReactiveBridge", "VELAR_REACTIVE_BRIDGE_MODULE_SOURCE"]) {
  if (compilerReactiveBridgeRuntimeSource.includes(phrase)) {
    failures.push(`packages/compiler/runtime/reactive-bridge.js: Web reactive provider ownership crossed into Core/compiler through '${phrase}'`);
  }
}
for (const phrase of [
  "return [VELAR_NON_REACTIVE_BRIDGE_RUNTIME",
  "needsCollections ? [VELAR_NON_REACTIVE_COLLECTION_BRIDGE_RUNTIME]",
  "__velarHostRaw(${emitted})",
]) {
  if (!compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: JavaScript or collection calls bypass the compiler-owned reactive bridge '${phrase}'`);
}
const reactiveBridgeExports = [
  "reactiveIterateKey",
  "reactiveStructureKey",
  "reactiveRaw",
  "hostRaw",
  "reactiveCollectionRead",
  "reactiveCollectionTrack",
  "reactiveCollectionLink",
  "reactiveCollectionTrigger",
  "reactiveCollectionUnlink",
];
for (const name of reactiveBridgeExports) {
  if (!VELAR_REACTIVE_BRIDGE_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/web/runtime: shared Web runtime does not export '${name}'`);
  }
  if (!VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/runtime/reactive-bridge-exports.js: Core's static bridge does not export '${name}'`);
  }
}
for (const phrase of [
  "private readonly requiredRuntimeModules = new Set<string>()",
  "runtimeModules(): readonly string[]",
  "this.host.requiredRuntimeModules.add(VELAR_REACTIVE_BRIDGE_MODULE)",
  "from ${JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE)}",
]) {
  if (!compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: shared compiler runtime contract is missing '${phrase}'`);
}
for (const phrase of [
  "readonly sharedRuntimeModules?: boolean",
  "readonly runtimeModules: readonly string[]",
  "const runtimeModules = code === null ? [] : emitter.runtimeModules?.() ?? []",
]) {
  if (!compilerIndexSource.includes(phrase)) failures.push(`packages/compiler/src/index.ts: compile result does not preserve shared runtime requirement '${phrase}'`);
}
for (const phrase of [
  "runtimeModules?(): readonly string[]",
  "readonly sharedRuntimeModules?: boolean",
]) {
  if (!compilerExtensionSource.includes(phrase)) failures.push(`packages/compiler/src/extension.ts: extension protocol does not preserve shared runtime contract '${phrase}'`);
}
for (const phrase of [
  "const __velarReactiveRaw = __velarToRaw",
  "const __velarReactiveCollectionReadOperation = __velarRuntime.collectionRead",
  "const __velarReactiveCollectionTriggerOperation = __velarRuntime.collectionTrigger",
  "function __velarReactiveCollectionTrigger(value, key, iterate = true, structure = false, indexFrom = null, allKeys = false)",
  "const __velarReactiveCollectionUnlinkOperation = __velarRuntime.collectionUnlink",
  "const __velarReactiveOperation = __velarRuntime.reactive",
  "const __velarReactiveTrackOperation = __velarRuntime.track",
]) {
  if (!webLocalBridgeRuntimeSource.includes(phrase)) failures.push(`packages/web/runtime: Web-local reactive calls bypass the already-validated runtime operation '${phrase}'`);
}
for (const phrase of [
  "WEB_LOCAL_REACTIVE_BRIDGE_RUNTIME",
  "WEB_LOCAL_REACTIVE_COLLECTION_BRIDGE_RUNTIME",
  "if (!host.webOutput) return host.baseReactiveBridgeHelpers",
]) {
  if (!webEmitterSource.includes(phrase)) failures.push(`packages/web/src/emitter.ts: Web-local reactive calls bypass the already-validated runtime operation '${phrase}'`);
}
if (!webRuntimeSource.includes("if (source === VELAR_REACTIVE_BRIDGE_MODULE) return VELAR_REACTIVE_BRIDGE_MODULE_SOURCE")) {
  failures.push("packages/web/src/runtime.ts: shared Web builds do not replace Core's static bridge with the reactive bridge");
}
for (const phrase of [
  "function __velarReactiveRuntime",
  "Object.getOwnPropertyDescriptor(globalThis, Symbol.for",
  "runtime.toRaw(value)",
]) {
  if (compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: retains ambient reactive bridge helper '${phrase}'`);
}
const projectCompilerSource = await sourceFamily("packages/cli/src/project.ts", "packages/cli/src/project");
const sourceLimitsSource = await readFile(join(root, "packages", "cli", "src", "source-limits.ts"), "utf8");
const libraryArtifactBuildSource = await readFile(join(root, "packages", "cli", "src", "library-artifact-build.ts"), "utf8");
const libraryArtifactSource = await readFile(join(root, "packages", "cli", "src", "library-artifact.ts"), "utf8");
const libraryArtifactBundleSource = await readFile(join(root, "packages", "cli", "src", "library-artifact-bundle.ts"), "utf8");
const standardModulesSource = await readFile(join(root, "packages", "core", "src", "index.ts"), "utf8");
const cliSource = await sourceFamily("packages/cli/src/cli.ts", "packages/cli/src/commands", "packages/cli/src/build");
const nodeRuntimeDependenciesSource = await readFile(join(root, "packages", "cli", "src", "node-runtime-dependencies.ts"), "utf8");
const cliCompilerRuntimeModulesSource = await readFile(join(root, "packages", "cli", "src", "compiler-runtime-modules.ts"), "utf8");
const compilerRuntimeTargetSource = await readFile(join(root, "packages", "cli", "src", "compiler-runtime-target.ts"), "utf8");
const nodeCompilerRuntimeResolverSource = await readFile(join(root, "packages", "cli", "src", "node-compiler-runtime-resolver.ts"), "utf8");
const browserNpmSource = await sourceFamily("packages/cli/src/npm.ts", "packages/cli/src/npm");
const nodeStandardModuleOutputSource = await readFile(join(root, "packages", "cli", "src", "node-standard-module-output.ts"), "utf8");
const packageOutputAssemblerSource = await readFile(join(root, "packages", "cli", "src", "package-output-assembler.ts"), "utf8");
const generatedRuntimePackageSource = await readFile(join(root, "packages", "cli", "src", "generated-runtime-package.ts"), "utf8");
const buildOutputClaimSource = await readFile(join(root, "packages", "cli", "src", "build-output-claim.ts"), "utf8");
const portableArtifactPathSource = await readFile(join(root, "packages", "cli", "src", "portable-artifact-path.ts"), "utf8");
const generatedOutputClaimSource = await readFile(join(root, "packages", "cli", "src", "generated-output-claim.ts"), "utf8");
const buildOutputDirectorySource = await readFile(join(root, "packages", "cli", "src", "build-output-directory.ts"), "utf8");
const buildOutputDirectoryRemovalSource = await readFile(join(root, "packages", "cli", "src", "build-output-directory-removal.ts"), "utf8");
const buildOutputReceiptSource = await readFile(join(root, "packages", "cli", "src", "build-output-receipt.ts"), "utf8");
const buildOutputCommitSource = await readFile(join(root, "packages", "cli", "src", "build-output-commit.ts"), "utf8");
const libraryArtifactVerifierSource = await readFile(join(root, "packages", "cli", "src", "library-artifact-verifier.ts"), "utf8");
const buildInputBoundarySource = await readFile(join(root, "packages", "cli", "src", "build-input-boundary.ts"), "utf8");
const configSource = await readFile(join(root, "packages", "cli", "src", "config.ts"), "utf8");
const projectManifestSource = await readFile(join(root, "packages", "cli", "src", "project-manifest-source.ts"), "utf8");
const installedPackageClosureSource = await readFile(join(root, "packages", "cli", "src", "installed-package-closure.ts"), "utf8");
const extensionMetadataSource = await readFile(join(root, "packages", "cli", "src", "extension-metadata.ts"), "utf8");
const extensionRuntimeClosureSource = await readFile(join(root, "packages", "cli", "src", "extension-runtime-closure.ts"), "utf8");
const ordinaryFileSnapshotSource = await readFile(join(root, "packages", "cli", "src", "ordinary-file-snapshot.ts"), "utf8");
const standaloneBuildOutputSource = await readFile(join(root, "packages", "cli", "src", "standalone-build-output.ts"), "utf8");
const standaloneOutputTransactionSource = await readFile(join(root, "packages", "cli", "src", "standalone-output-transaction.ts"), "utf8");
const standaloneOutputRecoverySource = await readFile(join(root, "packages", "cli", "src", "standalone-output-recovery.ts"), "utf8");
const browserTestRunnerSource = await sourceFamily("packages/cli/src/browser-test-runner.ts", "packages/cli/src/browser-test");
const browserProcessOwnerSource = await readFile(join(root, "packages", "cli", "src", "browser-process-owner.ts"), "utf8");
const browserAcceptanceSource = await readFile(join(root, "tests", "acceptance", "browser.acceptance.ts"), "utf8");
const processLifetimeSource = await readFile(join(root, "packages", "cli", "src", "process-lifetime.ts"), "utf8");
const projectGateSource = await readFile(join(root, "scripts", "run-project-gate.mjs"), "utf8");
const installedBrowserAcceptanceSource = await readFile(join(root, "tests", "acceptance", "installed-browser.acceptance.ts"), "utf8");
const devServerSource = await sourceFamily("packages/cli/src/dev-server.ts", "packages/cli/src/dev");
const previewServerSource = await readFile(join(root, "packages", "cli", "src", "preview-server.ts"), "utf8");
if (!projectCompilerSource.includes("sharedRuntimeModules: true")) {
  failures.push("packages/cli/src/project.ts: project compilation does not request shared compiler runtime modules");
}
if (!standardModulesSource.includes("[VELAR_REACTIVE_BRIDGE_MODULE, VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: Core's static compiler bridge is not available to project execution paths");
}
for (const phrase of [
  "snapshotExtensionRuntimeModules(",
  "validateExtensionRuntimeClosure(",
  "new Set(standardModuleSources(extensions).keys())",
]) {
  if (!configSource.includes(phrase)) failures.push(`packages/cli/src/config.ts: third-party runtime closure is missing '${phrase}'`);
}
for (const phrase of [
  "createJavaScriptModuleGraphBudget()",
  "inspectJavaScriptModuleWithinBudget(source, syntaxBudget)",
  "activeRuntimeModules.has(edge.source)",
  "without declaring it in modules.dependencies",
  "has no runtime source implementation",
  "computed dynamic import",
  "MAX_ACTIVE_EXTENSION_RUNTIME_SOURCE_BYTES",
  "MAX_ACTIVE_EXTENSION_RUNTIME_DEPENDENCIES",
]) {
  if (!extensionRuntimeClosureSource.includes(phrase)) {
    failures.push(`packages/cli/src/extension-runtime-closure.ts: closed third-party runtime graph is missing '${phrase}'`);
  }
}
if (!standardModulesSource.includes("[VELAR_PRIMITIVE_METHOD_MODULE, VELAR_PRIMITIVE_METHOD_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared primitive runtime source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_PROMISE_NORMALIZATION_MODULE, VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared Promise runtime source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_RANGE_MODULE, VELAR_RANGE_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared range runtime source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_CLASS_FIELD_MODULE, VELAR_CLASS_FIELD_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared class-field runtime source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_HOST_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared collection host source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_LOWERING_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared collection lowering source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_COLLECTION_LOWERING_MODULE, VELAR_COLLECTION_LOWERING_DEPENDENCIES]")) {
  failures.push("packages/core/src/index.ts: shared collection lowering dependencies are not registered");
}
for (const phrase of [
  "readonly compilerRuntimeModules: readonly string[]",
  "const compilerOwnedModules = new Set(standardModuleSources(options.compilerExtensions).keys())",
  "assertCompilerRuntimeArtifactTarget(",
  "filter((specifier) => compilerOwnedModules.has(specifier))",
  "compilerRuntimeModules,",
]) {
  if (!libraryArtifactSource.includes(phrase)) {
    failures.push(`packages/cli/src/library-artifact.ts: verified frozen runtime roots are missing '${phrase}'`);
  }
}
for (const phrase of [
  "standardModuleClosure([root], projectConfig, extensions)",
  "isNodeOnlyModule(source)",
  "owner.capabilities?.length",
]) {
  if (!compilerRuntimeTargetSource.includes(phrase)) {
    failures.push(`packages/cli/src/compiler-runtime-target.ts: artifact target fence is missing '${phrase}'`);
  }
}
if (!libraryArtifactBundleSource.includes("left.compilerRuntimeModules.every")) {
  failures.push("packages/cli/src/library-artifact-bundle.ts: loaded artifact identity omits compiler runtime roots");
}
if (!standardModulesSource.includes("[VELAR_ERROR_NORMALIZATION_MODULE, VELAR_ERROR_NORMALIZATION_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared error runtime source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_NARROWING_MODULE, VELAR_NARROWING_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared narrowing runtime source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_TYPE_VALIDATION_MODULE, VELAR_TYPE_VALIDATION_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared runtime-Type source is not available to project execution paths");
}
// D115 §三: the interface tables are one file per `velar/*` module now, so the
// rule is read where they live rather than out of a slice of `index.ts` whose
// two markers happened to bracket them.
const coreInterfaceSources = new Map();
for (const file of await sourceFiles(join(root, "packages", "core", "src", "interfaces"))) {
  coreInterfaceSources.set(display(file), await readFile(file, "utf8"));
}
if (coreInterfaceSources.size === 0) failures.push("packages/core/src/interfaces: no `velar/*` interface table was found");
for (const [path, source] of coreInterfaceSources) {
  for (const internalModule of ["VELAR_REACTIVE_BRIDGE_MODULE", "VELAR_PRIMITIVE_METHOD_MODULE", "VELAR_PROMISE_NORMALIZATION_MODULE", "VELAR_RANGE_MODULE", "VELAR_CLASS_FIELD_MODULE", "VELAR_COLLECTION_HOST_MODULE", "VELAR_COLLECTION_LOWERING_MODULE", "VELAR_ERROR_NORMALIZATION_MODULE", "VELAR_NARROWING_MODULE", "VELAR_TYPE_VALIDATION_MODULE"]) {
    if (source.includes(internalModule)) {
      failures.push(`${path}: internal compiler runtime '${internalModule}' leaked into the public standard-module API`);
    }
  }
}
for (const phrase of [
  "for (const dependency of module.result.dependencies)",
  "for (const source of module.result.runtimeModules)",
  "for (const source of artifact.compilerRuntimeModules)",
  "standardModuleClosure(roots, project.extensionConfig, project.compilerExtensions)",
]) {
  if (!cliCompilerRuntimeModulesSource.includes(phrase)) failures.push(`packages/cli/src/compiler-runtime-modules.ts: shared deployment planning does not materialize compiler runtime requirements '${phrase}'`);
}
for (const phrase of [
  "requiredCompilerRuntimeModules(project)",
  "runtimeModules,",
  "nodeRuntimeDependencyOutputClaims(join(staging.directory, \"node_modules\")",
  "await writeNodeStandardModulesIntoAssembly(",
]) {
  if (!cliSource.includes(phrase)) failures.push(`packages/cli/src/cli.ts: Node output does not consume the shared runtime-dependency plan '${phrase}'`);
}
for (const phrase of [
  "selectedRuntimeModules: ReadonlySet<string> = requiredCompilerRuntimeModules(project)",
  "const used = selectedRuntimeModules",
  "await writeNodeRuntimeDependencies(nodeModulesRoot, used)",
]) {
  if (!nodeStandardModuleOutputSource.includes(phrase)) failures.push(`packages/cli/src/node-standard-module-output.ts: standard-module output does not consume the shared runtime-dependency plan '${phrase}'`);
}
for (const phrase of [
  '{ standardModule: "velar/websocket", ownerName: "@velarscript/node", packageName: "ws", version: WEBSOCKET_VERSION }',
  '{ standardModule: "velar/server", ownerName: "@velarscript/server", packageName: "yaml", version: YAML_VERSION }',
  "requiredRuntimeDependencies(used).map",
  "standardRuntimePackageLayout([dependency.standardModule])",
  'join(standardRuntimePackageRoot(nodeModulesRoot, owner.name), "node_modules")',
]) {
  if (!nodeRuntimeDependenciesSource.includes(phrase)) failures.push(`packages/cli/src/node-runtime-dependencies.ts: runtime dependency outputs are missing '${phrase}'`);
}
for (const phrase of [
  "const requiredRuntimeModules = requiredCompilerRuntimeModules(project)",
  'if (!requiredRuntimeModules.has("velar/server"))',
]) {
  if (!standaloneBuildOutputSource.includes(phrase)) {
    failures.push(`packages/cli/src/standalone-build-output.ts: standalone configuration does not use the shared transitive standard-module closure '${phrase}'`);
  }
}
for (const phrase of [
  "standardRuntimePackageLayout(modules)",
  "routes.set(module.source, pathToFileURL(",
  "const artifactSources = artifactSnapshotRoutes(artifacts)",
  "return registerHooks({",
  "if (artifactSources.has(specifier))",
  "load(url, context, nextLoad)",
  "return nextResolve(specifier, context)",
]) {
  if (!nodeCompilerRuntimeResolverSource.includes(phrase)) {
    failures.push(`packages/cli/src/node-compiler-runtime-resolver.ts: sandbox runtime resolver is missing '${phrase}'`);
  }
}
for (const phrase of [
  "const compilerRuntimeModules = requiredCompilerRuntimeModules(project)",
  "standardModuleRoute(specifier)",
  "if (compilerRuntimeModules.has(external)) continue",
]) {
  if (!browserNpmSource.includes(phrase)) {
    failures.push(`packages/cli/src/npm.ts: Web development does not route frozen compiler runtimes through Standard '${phrase}'`);
  }
}
for (const phrase of [
  "const staging = await reserveBuildStaging(normalizedOutput)",
  "await recoverInterruptedBuilds(normalizedOutput, staging.claim, isBuildOutputDirectory)",
  "const authorization = await validateBuildOutputTarget(",
  "return await prepareClaimedBuildStaging(staging, authorization)",
  "await writeNodeStandardModulesIntoAssembly(",
  "await commitBuildOutputDirectory(staging, authorization)",
  "await verifyVelarLibraryBuildForCommit(library, staging.directory)",
]) {
  if (!cliSource.includes(phrase)) failures.push(`packages/cli/src/cli.ts: unbundled output replacement is missing '${phrase}'`);
}
for (const phrase of [
  "await replaceClaimedOutputDirectory(staging, authorization, operations)",
  "await finishBuildOutputClaim(staging.claim, result",
  "const claim = await acquireBuildOutputClaims([",
  "...buildStagingClaimRequests(directory)",
  "await writeExclusiveBuildFile(\n      transactionPath",
  "await link(transactionPath, join(staging, BUILD_STAGING_MARKER))",
  "marker.device !== evidence.device",
  "marker.inode !== evidence.inode",
  "evidenceDevice: evidence.device",
  "sameBuildStagingOwnership(",
  "result.error instanceof BuildOutputRestoreError",
  "if (processIsAlive(installedCandidate.ownerPid))",
  "await claim.extend(buildStagingClaimRequests(installedCandidate.stagingDirectory))",
  "!installed || !sameBuildStagingOwnership(installedCandidate, installed)",
  "await claim.extend(buildStagingClaimRequests(staging))",
  "!ownership || !sameBuildStagingOwnership(candidate, ownership)",
  "await renamePath(output, previous)",
  "await renamePath(stagingPath, output)",
  "await verifyAuthorizedInstalledBuildOutput(ownership, authorization)",
  "await removeOwnedDirectory(",
  "await removeOwnedFile(join(ownership.outputDirectory, BUILD_STAGING_MARKER)",
]) {
  if (!buildOutputDirectorySource.includes(phrase)) failures.push(`packages/cli/src/build-output-directory.ts: output transaction is missing '${phrase}'`);
}
for (const phrase of [
  "const captured = await captureBuildOutputInventory(staging)",
  "value.buildId !== buildOutputInventoryId(inventory)",
  "const expectedComparisonPath = buildOutputComparisonPath(",
  "value.comparisonPath !== expectedComparisonPath",
  "await inspectBuildOutputReceipt(resolve(installedDirectory), expectedComparisonPath)",
  "ignoredRootNames: new Set([BUILD_OUTPUT_RECEIPT, BUILD_STAGING_MARKER])",
  "await assertDirectorySnapshotUnchanged(captured.snapshot, \"Directory build output\")",
]) {
  if (!buildOutputReceiptSource.includes(phrase)) failures.push(`packages/cli/src/build-output-receipt.ts: path-bound output receipt is missing '${phrase}'`);
}
for (const phrase of [
  "const issuedBuildOutputAuthorizations = new WeakMap",
  "snapshot: cloneDirectorySnapshot(snapshot)",
  "await authorized.verifyInstalledDirectory(ownership.outputDirectory)",
  "await assertDirectorySnapshotUnchanged(\n    authorized.snapshot,\n    \"Installed verified directory build output\",\n    ownership.outputDirectory",
  "await renamePath(ownership.outputDirectory, ownership.stagingDirectory)",
  "await renamePath(previous, ownership.outputDirectory)",
]) {
  if (!buildOutputCommitSource.includes(phrase)) failures.push(`packages/cli/src/build-output-commit.ts: authenticated commit handoff is missing '${phrase}'`);
}
for (const phrase of [
  "await loadVelarLibraryArtifactSet({",
  "artifactRoot: root",
  "assertExactArtifactTree(snapshot, expectedFiles)",
  "await assertDirectorySnapshotUnchanged(snapshot, \"Velar library build\")",
]) {
  if (!libraryArtifactVerifierSource.includes(phrase)) failures.push(`packages/cli/src/library-artifact-verifier.ts: frozen-library commit verification is missing '${phrase}'`);
}
for (const phrase of [
  "const isolation = directoryRemovalPath(path)",
  "await renamePath(path, isolation)",
  "!sameIdentity(isolated, expected)",
  "await restoreUnexpectedDirectory(path, isolation, isolated, renamePath)",
  "await removePath(isolation, { recursive: true, force: true })",
]) {
  if (!buildOutputDirectoryRemovalSource.includes(phrase)) failures.push(`packages/cli/src/build-output-directory-removal.ts: identity-bound removal is missing '${phrase}'`);
}
for (const phrase of ["{ path: directoryRemovalPath(staging), kind: \"tree\" }", "{ path: directoryRemovalPath(previous), kind: \"tree\" }"]) {
  if (!buildOutputDirectorySource.includes(phrase)) failures.push(`packages/cli/src/build-output-directory.ts: removal isolation is not claimed with '${phrase}'`);
}
// D115 P4: this compared two `indexOf`s in the whole of `cli.ts`. Read over a
// family, that comparison answers about the order the files were concatenated
// in, not the order the statements run in — the split into `commands/` and
// `build/` would decide it. The claim was always about one function, so the
// rule now names it: both calls are in `prepareBuildStaging`'s own body, and
// recovery precedes authorization there. Naming the function also fixes what
// the old form let through — with both phrases deleted, `-1 > -1` was false.
const buildStagingSource = functionBody(cliSource, "prepareBuildStaging", "packages/cli/src/cli.ts");
const interruptedRecoveryAt = buildStagingSource.indexOf("await recoverInterruptedBuilds(normalizedOutput, staging.claim, isBuildOutputDirectory)");
const replacementAuthorizationAt = buildStagingSource.indexOf("const authorization = await validateBuildOutputTarget");
if (interruptedRecoveryAt < 0 || replacementAuthorizationAt < 0 || interruptedRecoveryAt > replacementAuthorizationAt) {
  failures.push("packages/cli/src/cli.ts: prepareBuildStaging must recover interrupted output before it authorizes replacement, under the claim");
}
if (buildOutputDirectorySource.indexOf("const claim = await acquireBuildOutputClaims([")
  > buildOutputDirectorySource.indexOf("await mkdir(staging, { mode: 0o700 })")) {
  failures.push("packages/cli/src/build-output-directory.ts: final, staging, backup, and evidence paths must be claimed before staging is created");
}
// D115 P4: this was a slice between two function names in one file. The claim
// is about `isBuildOutputDirectory` alone — `writeCompiled` was only the
// nearest landmark after it — and the two are due to land in different files,
// which would have made the slice either empty or the rest of the family. The
// rule now reads that one function's body, wherever in the family it lives.
const buildOutputOwnershipSource = functionBody(cliSource, "isBuildOutputDirectory", "packages/cli/src/cli.ts");
for (const phrase of [
  "await hasBuildOutputReceipt(directory, expectedOutputDirectory)",
  "await verifyProductionBuild(directory, process.cwd(), { allowBuildStagingMarker: true })",
  "await verifyNodeProductionBuild(directory, process.cwd(), { allowBuildStagingMarker: true })",
]) {
  if (!buildOutputOwnershipSource.includes(phrase)) failures.push(`packages/cli/src/cli.ts: directory ownership requires a full path-bound verifier '${phrase}'`);
}
if (buildOutputOwnershipSource.includes("readBuildStagingOwnership")
  || buildOutputOwnershipSource.includes("BUILD_STAGING_MARKER")) {
  failures.push("packages/cli/src/cli.ts: a staging marker alone must not authorize recursive output replacement");
}
for (const phrase of ["await writeBuildOutputReceipt(staging.directory, outputDirectory)", "await hasBuildOutputReceipt(directory, expectedOutputDirectory)"]) {
  if (!cliSource.includes(phrase)) failures.push(`packages/cli/src/cli.ts: generic directory ownership is missing '${phrase}'`);
}
if (!cliSource.includes("const staging = await reserveBuildStaging(normalizedOutput)")) {
  failures.push("packages/cli/src/cli.ts: tree output does not acquire the shared hierarchical build claim");
}
if (!buildInputBoundarySource.includes('{ path: join(config.root, "package.json"), kind: "file", label: "project package manifest" }')
  || !standaloneBuildOutputSource.includes("await directoryBuildInputs(projectConfig, [project])")) {
  failures.push("packages/cli/src: explicit standalone output does not inherit the shared directory-build input closure containing the project package manifest");
}
for (const phrase of ["...options.claimedFiles", "...options.cleanupFiles", "await claim.extend([...previousReceipt]", "await finishBuildOutputClaim(claim, result", "const runtimeClaims = standardRuntimePackageOutputClaims(", "options.runtimeModules", "...runtimeClaims.map(({path, kind}) => ({path, kind}))", '{ path: staging, kind: "tree" }', '{ path: evidencePath, kind: "file" }', 'await writeTransactionEvidence(staging, outputPath, location, transactionToken, "staging", [])', 'await updateTransactionEvidence(staging, outputPath, location, transactionToken, "installing", planned)', 'await updateTransactionEvidence(staging, outputPath, location, transactionToken, "installed", planned)', "operationsSha256: operationDigest(operations)", "journal.phase === evidence.phase", "validTransactionPhase(journal.phase, journal.operations.length)", "if (!validTransactionPhase(phase, operations.length))", "after[0]!.contents !== contents", "sameTransactionEvidence(journal, evidence)", "await link(\n      transactionEvidencePath(staging),\n      join(staging, STANDALONE_TRANSACTION_EVIDENCE_MARKER)", "external.device !== internal.device", "external.inode !== internal.inode", "left.evidenceDevice === right.evidenceDevice", "left.evidenceInode === right.evidenceInode", "let stagingCreated = false", "let evidenceCreated = false", "if (stagingCreated) {", "if (stagingRemoved && evidenceCreated) await rm(evidencePath", "await restoreInterruptedStandaloneOperations(staging, outputPath, claimedJournal.operations)", "await assertInstalledStandaloneOperations(staging, outputPath, claimedJournal.operations)"]) {
  if (!standaloneOutputTransactionSource.includes(phrase)) failures.push(`packages/cli/src/standalone-output-transaction.ts: standalone mutation set is missing '${phrase}'`);
}
for (const phrase of ["device: captured.identity.device.toString()", "inode: captured.identity.inode.toString()", "sha256: captured.sha256", "await inspectBoundedFile(", "await inspectBoundedDirectory(root, \"Standalone output tree\", productionDirectoryPolicy)", "await assertDirectorySnapshotUnchanged(snapshot, \"Standalone output tree\")", "sameStandaloneOutputIdentity(actual, expected)", "const actions = await Promise.all(operations.map", "await validateAppliedOperation(operation)", "backup '${backup}' was preserved"]) {
  if (!standaloneOutputRecoverySource.includes(phrase)) failures.push(`packages/cli/src/standalone-output-recovery.ts: standalone recovery identity boundary is missing '${phrase}'`);
}
if (standaloneOutputRecoverySource.indexOf("const actions = await Promise.all(operations.map")
  > standaloneOutputRecoverySource.indexOf("await rm(action.target")) {
  failures.push("packages/cli/src/standalone-output-recovery.ts: interrupted recovery must validate every operation before mutating any output");
}
if (standaloneOutputTransactionSource.indexOf("const claim = await acquireBuildOutputClaims([")
  > standaloneOutputTransactionSource.indexOf("await mkdir(staging, { mode: 0o700 })")) {
  failures.push("packages/cli/src/standalone-output-transaction.ts: output, sidecar, runtime, staging, and evidence claims must precede the first staging write");
}
for (const phrase of [
  "await link(temporaryPath, gatePath)",
  "claimsOverlap(request.record, candidate.record)",
  "await gate.release()",
  "await link(anchorPath, markerPath)",
  "await assertRegistryIdentity(registry)",
  "await rename(claim.path, quarantine)",
]) {
  if (!buildOutputClaimSource.includes(phrase)) failures.push(`packages/cli/src/build-output-claim.ts: atomic output claim is missing '${phrase}'`);
}
for (const phrase of [
  '.normalize("NFD")',
  '.toLocaleUpperCase("und")',
  '.toLocaleLowerCase("und")',
  '.normalize("NFC")',
  'Buffer.byteLength(segment.normalize("NFD"), "utf8") > MAX_PORTABLE_SEGMENT_BYTES',
]) {
  if (!portableArtifactPathSource.includes(phrase)) failures.push(`packages/cli/src/portable-artifact-path.ts: shared portable path identity is missing '${phrase}'`);
}
for (const [source, owner] of [
  [buildOutputClaimSource, "build-output-claim.ts"],
  [buildOutputDirectorySource, "build-output-directory.ts"],
]) {
  if (!source.includes("readBoundedFileHandle(")) failures.push(`packages/cli/src/${owner}: external ownership evidence is not read through one bounded descriptor`);
}
if (!hasNamedImport(buildOutputReceiptSource, "./bounded-directory-snapshot.ts", "readInspectedJson")
  || !buildOutputReceiptSource.includes("await readInspectedJson(")) {
  failures.push("packages/cli/src/build-output-receipt.ts: external ownership evidence is not read through one bounded descriptor");
}
if (!hasNamedImport(configSource, "./project-manifest-source.ts", "readProjectManifestSource")
  || !configSource.includes("manifestSource = await readProjectManifestSource(manifestPath)")) {
  failures.push("packages/cli/src/config.ts: project manifests do not use the shared bounded identity snapshot");
}
for (const phrase of [
  "const pathBefore = operations.followSymbolicLink",
  "? await stat(path, { bigint: true })",
  ": await lstat(path, { bigint: true })",
  "const before = snapshot(await handle.stat({ bigint: true }))",
  "const bytes = await readBoundedFileHandle(handle, maximumBytes, label)",
  "const after = snapshot(await handle.stat({ bigint: true }))",
  "await operations.validateOpenedSnapshot?.(after)",
  "const pathAfter = operations.followSymbolicLink",
  "!sameSnapshot(after, snapshot(pathAfter))",
]) {
  if (!ordinaryFileSnapshotSource.includes(phrase)) failures.push(`packages/cli/src/ordinary-file-snapshot.ts: bounded ordinary-file snapshot is missing '${phrase}'`);
}
for (const [source, owner] of [
  [projectManifestSource, "project-manifest-source.ts"],
  [installedPackageClosureSource, "installed-package-closure.ts"],
  [extensionMetadataSource, "extension-metadata.ts"],
]) {
  if (!hasNamedImport(source, "./ordinary-file-snapshot.ts", "readOrdinaryFileSnapshot")
    || !source.includes("await readOrdinaryFileSnapshot(")) {
    failures.push(`packages/cli/src/${owner}: manifest bytes do not use the shared bounded ordinary-file snapshot`);
  }
}
for (const phrase of [
  "readOrdinaryFileSnapshot(path, MAX_VELAR_SOURCE_BYTES, path",
  "followSymbolicLink: true",
  "expectedCanonicalPath: canonicalInput",
]) {
  const owner = phrase === "expectedCanonicalPath: canonicalInput" ? projectCompilerSource : sourceLimitsSource;
  if (!owner.includes(phrase)) failures.push(`packages/cli/src: source-module snapshots are missing '${phrase}'`);
}
for (const phrase of [
  "const content = await readProjectJsonResource(",
  "readOrdinaryFileSnapshot(",
  "MAX_JSON_RESOURCE_BYTES",
  "validateOpenedSnapshot: async () =>",
  "canonicalInput !== initialCanonicalInput",
]) {
  if (!projectCompilerSource.includes(phrase)) failures.push(`packages/cli/src/project.ts: JSON resources are not authorized and read through one bounded descriptor '${phrase}'`);
}
for (const phrase of [
  "const source = await readVelarLibraryPackageManifestSource(packagePath)",
  "readOrdinaryFileSnapshot(",
  "MAX_LIBRARY_PACKAGE_MANIFEST_BYTES",
  "followSymbolicLink: true",
]) {
  if (!libraryArtifactBuildSource.includes(phrase)) failures.push(`packages/cli/src/library-artifact-build.ts: library package manifests are not read through one bounded descriptor '${phrase}'`);
}
if (!generatedOutputClaimSource.includes("normalized.sort(compareNormalizedClaims)")
  || !generatedOutputClaimSource.includes("right.key.startsWith(`${left.key}/`)")
  || generatedOutputClaimSource.includes("for (const [existingKey, existing] of claimed)")) {
  failures.push("packages/cli/src/generated-output-claim.ts: generated namespace preflight is not a sorted non-quadratic collision scan");
}
const claimOverlapSource = buildOutputClaimSource.slice(
  buildOutputClaimSource.indexOf("function claimsOverlap"),
  buildOutputClaimSource.indexOf("function claimCovers"),
);
if (claimOverlapSource.includes("outputKind")
  || !claimOverlapSource.includes("contains(left.comparisonPath, right.comparisonPath)")
  || !claimOverlapSource.includes("contains(right.comparisonPath, left.comparisonPath)")) {
  failures.push("packages/cli/src/build-output-claim.ts: file and tree claims do not share one ancestor-overlap rule");
}
if (!hasNamedImport(buildOutputDirectorySource, "./build-staging.ts", "BUILD_STAGING_MARKER")
  || !hasNamedImport(buildOutputReceiptSource, "./build-staging.ts", "BUILD_STAGING_MARKER")) {
  failures.push("packages/cli/src: directory transaction and receipt owners must import BUILD_STAGING_MARKER from build-staging.ts");
}
if (!hasCallWithLeadingArguments(cliSource, "prepareBuildStaging", ["outputDirectory", "replacement", "project"])) {
  failures.push("packages/cli/src/cli.ts: unbundled output replacement does not stage the checked project");
}
if (!/if\s*\(\s*project\s*\)\s*await\s+assertBuildInputsOutsideOutput\s*\(\s*project\s*,\s*normalizedOutput(?:\s*,|\s*\))/u.test(cliSource)) {
  failures.push("packages/cli/src/cli.ts: build staging does not protect checked inputs before replacement");
}
for (const phrase of [
  "assertRuntimeOutput: async (runtimeModules)",
  "dirname(outputPath), project, basename(outputPath), runtimeModules",
  "writeExclusiveBuildFile(cssPath, result.css",
]) {
  if (!cliSource.includes(phrase)) failures.push(`packages/cli/src/cli.ts: single-file output orchestration is missing '${phrase}'`);
}
for (const phrase of [
  "velarGeneratedRuntime: VELAR_GENERATED_RUNTIME_PACKAGE_VERSION",
  "generatedRuntimePackageOwnership(root, package_.name)",
  "Refusing to replace non-generated package",
]) {
  if (![nodeStandardModuleOutputSource, packageOutputAssemblerSource, generatedRuntimePackageSource]
    .some((source) => source.includes(phrase))) {
    failures.push(`packages/cli/src: generated runtime ownership is missing '${phrase}'`);
  }
}
for (const phrase of [
  "const defaultBrowserTestTimeoutMs = 120_000",
  "browserRunDeadlineMs, \"Browser test run timeout\"",
  "browserCleanupTimeoutMs, \"Browser cleanup timeout\"",
  "return superviseBrowserWorker({",
  "await exitBrowserWorker(code)",
  "launchOwnedBrowserServer(browserTypes[engine], { headless: true, timeout: 30_000 })",
  "await boundedBrowserOperation(context.close(), limits.cleanupTimeoutMs, \"Browser context cleanup\")",
]) {
  if (!browserTestRunnerSource.includes(phrase)) failures.push(`packages/cli/src/browser-test-runner.ts: browser-test lifecycle contract is missing '${phrase}'`);
}
for (const phrase of [
  "export const browserRunDeadlineMs = 20 * 60_000",
  "export const browserCleanupTimeoutMs = 10_000",
  // B2: the stop grace is its own constant and the forced kill is scheduled on
  // it. It was `cleanupTimeoutMs + 5s`, paid once per supervisor, which put a
  // three-level browser gate nineteen seconds from a killed launcher to a freed
  // machine — so the pin is both halves: the number, and that the timer reads it
  // rather than deriving one again.
  "export const browserStopGraceMs = 5_000",
  "      }, browserStopGraceMs);",
  "detached: ownsProcessGroup",
  "process.kill(-child.pid, signal)",
  "guardChildOnExit(child)",
  "guardChildOnExit(server.process())",
  "return watchParentDeath({ stop: () => { process.kill(process.pid, \"SIGTERM\"); } })",
  "signalOwnedWorker(child, \"SIGKILL\", ownsProcessGroup, true)",
  "await boundedBrowserOperation(server.close(), timeoutMs, \"Browser graceful cleanup\")",
  "await boundedBrowserOperation(server.kill(), timeoutMs, \"Browser forced cleanup\")",
]) {
  if (!browserProcessOwnerSource.includes(phrase)) failures.push(`packages/cli/src/browser-process-owner.ts: supervised browser owner is missing '${phrase}'`);
}
for (const phrase of [
  "await superviseBrowserWorker({",
  "deadlineMs: browserRunDeadlineMs",
  "await exitBrowserWorker(code)",
  "terminateBrowserServer(owner.browser, owner.server, browserCleanupTimeoutMs)",
  "launchOwnedBrowserServer(browserType, { headless: true, timeout: 30_000 })",
  "detached: process.platform !== \"win32\"",
  "signalOwnedWorker(child, \"SIGTERM\", ownsProcessGroup, false)",
]) {
  if (!browserAcceptanceSource.includes(phrase)) failures.push(`tests/acceptance/browser.acceptance.ts: direct browser acceptance owner is missing '${phrase}'`);
}
if (/\b(?:chromium|firefox|webkit|browserType)\.launch\s*\(/u.test(browserTestRunnerSource + "\n" + browserAcceptanceSource)) {
  failures.push("Browser gates use an opaque Playwright launch instead of an explicit BrowserServer owner");
}
// D116: a long-lived process learns that its launcher is gone three ways, and
// dropping any one of them re-opens a leak the other two are blind to — the IPC
// channel a `spawnSync` launcher never opens, the reparenting a still-living
// grandparent hides, the broken pipe a discarded stdout never reports.
for (const phrase of [
  "process.ppid !== startingParent",
  "error.code !== \"EPIPE\" && error.code !== \"ERR_STREAM_DESTROYED\"",
  "process.on(\"disconnect\", onDisconnect)",
  "process.stdout.on(\"error\", onWriteFailure)",
  "process.stderr.on(\"error\", onWriteFailure)",
  "process.on(\"exit\", killGuardedChildren)",
  "process.kill(-child.pid, \"SIGKILL\")",
]) {
  if (!processLifetimeSource.includes(phrase)) failures.push(`packages/cli/src/process-lifetime.ts: parent-death and exit-net contract is missing '${phrase}'`);
}
// Every launch path owns its children as a process group under the one shared
// ceiling; a gate that spawns without a supervisor owns nothing at all.
for (const [name, source] of [
  ["scripts/run-project-gate.mjs", projectGateSource],
  ["tests/acceptance/installed-browser.acceptance.ts", installedBrowserAcceptanceSource],
]) {
  for (const phrase of ["superviseBrowserWorker({", "deadlineMs: browserRunDeadlineMs", "cleanupTimeoutMs: browserCleanupTimeoutMs"]) {
    if (!source.includes(phrase)) failures.push(`${name}: browser launch ownership is missing '${phrase}'`);
  }
  if (/\bspawnSync\s*\(/u.test(source)) failures.push(`${name}: a synchronous spawn owns no process group and answers to no deadline`);
}
for (const [name, source] of [
  ["packages/cli/src/dev-server.ts", devServerSource],
  ["packages/cli/src/preview-server.ts", previewServerSource],
]) {
  if (!source.includes("watchParentDeath({ stop")) failures.push(`${name}: a server left running by its launcher never learns to stop`);
}
const coreTestDisplayRuntimeSource = coreFamilySource("test-display");
// D115 P3 / D114 R2c: the Web runtimes are `packages/web/runtime/*.js` now, so
// each rule below reads the module or fragment it is about rather than a slice
// of the TypeScript that used to quote it.
const webFoundationSource = webFamilySource("graph");
const desktopNativeHostSource = await readFile(join(root, "packages", "desktop", "native", "macos", "VelarDesktopHost.swift"), "utf8");
const desktopWorkerSource = await readFile(join(root, "packages", "desktop", "native", "node", "worker.js"), "utf8");
const webPlatformModuleSource = webFamilySource("web");
const formsPlatformModuleSource = webRuntimeFile("forms.js");
const storagePlatformModuleSource = webRuntimeFile("storage.js");
const browserPlatformModuleSource = webRuntimeFile("browser.js");
const webHttpModuleSource = webRuntimeFile("http.js");
const webAppModuleSource = webRuntimeFile("app.js");
const webOwnedCallbackRuntimeSource = webRuntimeFile("owned-callback.js");
const webDomHostRuntimeSource = webRuntimeFile("dom-host.js");
const webReactivityHostRuntimeSource = webRuntimeFile("graph-host.js");
const webErrorHostRuntimeSource = webRuntimeFile("error-host.js");
const emittedWebRuntimeSource = webFamilySource("emitted");
// D90 R16 / rw-3: the emitted prelude no longer defines a flush drain or a
// scheduler of its own -- the foundation family holds the single definition and
// the prelude, inlined into the same module scope, calls it. So the reactivity
// slice starts at the first observer helper the prelude still owns, and the one
// drain's use of the captured graph ABI is asserted against the foundation.
const emittedReactivityRuntimeSource = emittedWebRuntimeSource.slice(emittedWebRuntimeSource.indexOf("function __velarTrack(subscribers)"), emittedWebRuntimeSource.indexOf("function __velarResource"));
const emittedManagedAsyncRuntimeSource = emittedWebRuntimeSource.slice(emittedWebRuntimeSource.indexOf("const __velarManagedAsyncNativePromise"), emittedWebRuntimeSource.indexOf("function __velarScope"));
const emittedDomRuntimeSource = emittedWebRuntimeSource.slice(emittedWebRuntimeSource.indexOf("function __velarComponent"), emittedWebRuntimeSource.indexOf("function __velarLook(parts)"));
/**
 * Every ambient host operation the emitted Web runtime is allowed to touch is
 * captured once, at module initialization, into a `const __velar…` binding at
 * the template's top level. Dropping exactly those lines leaves the runtime-use
 * source: everything that executes while an application is running, which is
 * where a replaceable global or prototype would actually be observed.
 */
function emittedRuntimeUseSource(template) {
  return template.split("\n")
    .filter((line) => !(/^const __velar[A-Za-z0-9]+ = /u.test(line) && !/=>|function\s*[(*]|function [A-Za-z_$]/u.test(line)))
    .join("\n");
}
const emittedWebRuntimeUseSource = emittedRuntimeUseSource(emittedWebRuntimeSource);
const webComponentDomRuntimeSource = webPlatformModuleSource.slice(webPlatformModuleSource.indexOf("function component("));
const webListGuardRuntimeSource = webRuntimeFile("list-guard.js");
const webOptionsGuardRuntimeSource = webRuntimeFile("options-guard.js");
const nodeHttpModuleSource = nodeHttpRuntimeSource;
const nodeProcessModuleSource = constantFileSource("node", "VELAR_NODE_PROCESS_MODULE_SOURCE");
const coreTextModuleSource = coreFamilySource("text");
const coreMathModuleSource = coreFamilySource("math");
const coreJsonModuleSource = coreFamilySource("json");
const coreUrlModuleSource = coreFamilySource("url");
const coreTimeModuleSource = coreFamilySource("time");
const coreIdModuleSource = coreFamilySource("id");
const coreLogModuleSource = coreFamilySource("log");
const coreTestModuleSource = coreFamilySource("test");
const desktopHttpModuleSource = desktopFamilySource("http");
const desktopProcessModuleSource = desktopFamilySource("process");
const utf8RuntimeSource = runtimeFamilySource("utf8");
for (const phrase of [
  "const __velarProcessNativeArray = globalThis.Array",
  "const __velarProcessNativeMap = globalThis.Map",
  "const __velarProcessNativePromise = globalThis.Promise",
  "const __velarProcessOwnDescriptor =",
  "const __velarProcessApply =",
  "const __velarProcessMapIteratorNext =",
  "function __velarProcessMapSnapshot(value)",
  "function __velarProcessRecord(value, name, allowed)",
  "function __velarProcessReject(error)",
  "function __velarProcessThen(value, fulfilled, rejected)",
]) {
  if (!nodeProcessHostRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/runtime/process-host.js: shared process host ABI is missing captured operation '${phrase}'`);
  }
}
if (!nodeCompilerSource.includes('export { VELAR_PROCESS_HOST_RUNTIME } from "./runtime-sources.generated.ts"')
  || !runtimeComposition("VELAR_NODE_PROCESS_MODULE_SOURCE", "node").includes("VELAR_PROCESS_HOST_RUNTIME")) {
  failures.push("packages/node/src/compiler.ts: Node process target must inline and publish the canonical process host ABI");
}
if (!desktopCompilerSource.includes('from "@velarscript/node/compiler"')
  || !(runtimeManifests.get("desktop").imports?.["@velarscript/node/compiler"] ?? []).includes("VELAR_PROCESS_HOST_RUNTIME")
  || desktopRuntimeSourceText.includes("const __velarProcessNativeArray = globalThis.Array")) {
  failures.push("packages/desktop/runtime/manifest.json: Desktop process target must reuse, not duplicate, the Node-owned process host ABI");
}
for (const phrase of [
  'import {spawn} from "node:child_process"',
  'import {StringDecoder} from "node:string_decoder"',
  'import {workerData} from "node:worker_threads"',
  "const maxProcessHandles = 128",
  "if (processHandles.size >= maxProcessHandles)",
  'stdoutDecoder: new StringDecoder("utf8")',
  'stderrDecoder: new StringDecoder("utf8")',
  'port.on("message", (value) =>',
  'send({kind: "ready"})',
  'send({kind: "owned", handle, pid: task.pid})',
  'send({kind: "settled", handle})',
  "task.result.catch(() => {})",
  "function signalTree(child, signal)",
  "async function fatalDrain()",
]) {
  if (!nodeProcessWorkerRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/runtime/process-worker.js: isolated process host is missing '${phrase}'`);
  }
}
if (/\b(?:import\s*\(|require\s*\(|eval\s*\(|Function\s*\()/u.test(nodeProcessWorkerRuntimeSource)) {
  failures.push("packages/node/runtime/process-worker.js: isolated process host may load only its static node: builtins and compiler-owned source");
}
for (const phrase of [
  "const __velarEnvEnvironment = globalThis.process.env",
  "const __velarEnvRegExpTest =",
  "const __velarEnvOwnDescriptor =",
  "function __velarEnvValue(name)",
]) {
  if (!nodeEnvironmentRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/runtime/env.js: captured environment ABI is missing '${phrase}'`);
  }
}
if (/\bprocess\.env\s*\[/u.test(nodeEnvironmentRuntimeSource) || /\.test\s*\(/u.test(nodeEnvironmentRuntimeSource)) {
  failures.push("packages/node/runtime/env.js: environment reads must not rediscover process.env or RegExp.prototype after initialization");
}
for (const phrase of [
  'import { writeSync as __velarHostWriteSync } from "node:fs"',
  "const __velarHostProcessOn = __velarHostProcess.on",
  "const __velarHostProcessExit = __velarHostProcess.exit",
  "const __velarHostPromiseThen =",
  "function __velarHostDeadline(cleanup, remaining)",
  "A shutdown cleanup must return a host Promise",
]) {
  if (!nodeHostRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/runtime/host.js: captured lifecycle ABI is missing '${phrase}'`);
  }
}
if (/\bPromise\.(?:race|resolve)\s*\(/u.test(nodeHostRuntimeSource)
  || /\bprocess\.(?:on|exit)\s*\(/u.test(nodeHostRuntimeSource)
  || /\bconsole\.error\s*\(/u.test(nodeHostRuntimeSource)) {
  failures.push("packages/node/runtime/host.js: lifecycle work must use captured Promise, process, and synchronous diagnostic operations");
}
for (const phrase of [
  'import { EventEmitter as __VelarTerminalEventEmitter } from "node:events"',
  'import { MessageChannel as __VelarTerminalMessageChannel, MessagePort as __VelarTerminalMessagePort, Worker as __VelarTerminalWorker } from "node:worker_threads"',
  "const __velarTerminalMaxPending = 256",
  "const __velarTerminalMessagePortPost =",
  "const __velarTerminalWorkerTerminate =",
  "let __velarTerminalFailure = null",
  "Node terminal worker did not become ready",
  "readLine(prompt = \"\")",
]) {
  if (!nodeTerminalRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/runtime/terminal*.js: terminal proxy is missing '${phrase}'`);
  }
}
for (const phrase of [
  'import { spawn } from "node:child_process"',
  'import { write } from "node:fs"',
  'import { StringDecoder } from "node:string_decoder"',
  'import { workerData } from "node:worker_threads"',
  "const inputHostSource =",
  "const maxQueuedLines = 256",
  'spawn(process.execPath, ["--input-type=module", "--eval", inputHostSource]',
  'serialization: "advanced"',
  'host.send({kind: "input-state", active})',
  'process.once("exit", () => { if (inputHost !== null) inputHost.kill("SIGKILL"); })',
  "write(fd, data",
  "port.postMessage({kind: \"ready\", interactive: isatty(0) && isatty(1)})",
]) {
  if (!nodeTerminalWorkerRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/runtime/terminal-worker*.js: isolated terminal host is missing '${phrase}'`);
  }
}
if (/\b(?:import\s*\(|require\s*\(|eval\s*\(|Function\s*\()/u.test(nodeTerminalWorkerRuntimeSource)) {
  failures.push("packages/node/runtime/terminal-worker*.js: isolated terminal host may load only static node: built-ins");
}
for (const match of nodeTerminalWorkerRuntimeSource.matchAll(/^\s*import\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/gmu)) {
  if (!match[1].startsWith("node:")) failures.push(`packages/node/runtime/terminal-worker*.js: isolated terminal host imports non-builtin '${match[1]}'`);
}
if (nodeTerminalRuntimeSource.includes("node:readline") || nodeTerminalWorkerRuntimeSource.includes("node:readline")) {
  failures.push("packages/node: terminal must not reintroduce the application-Realm readline/EventEmitter transport");
}
for (const phrase of [
  'import { __velarNodeHostInvoke } from "velar/node-host-v1"',
  "const __velarFsTextDecoderDecode =",
  "const __velarFsTextEncoderEncode =",
  "const __velarFsTypedArrayByteLength =",
  "function __velarFsBytes(value, operation)",
  'await __velarNodeHostInvoke("fs.readFile"',
  'await __velarNodeHostInvoke("fs.createFile"',
  'await __velarNodeHostInvoke("fs.replaceFileIfMatches"',
  'await __velarNodeHostInvoke("fs.watchNext"',
  'await __velarNodeHostInvoke("fs.watchClose"',
  "const __velarFsMaxWatchPaths = 4096",
  "FileWatcher.next already has an active pull",
]) {
  if (!nodeFilesystemRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/runtime/filesystem.js: captured filesystem ABI is missing '${phrase}'`);
  }
}
if (/from\s+["']node:(?:fs|path)/u.test(nodeFilesystemRuntimeSource)
  || /\bBuffer\.byteLength\s*\(/u.test(nodeFilesystemRuntimeSource)
  || /\bPromise\.(?:reject|resolve|race)\s*\(/u.test(nodeFilesystemRuntimeSource)
  || /\.catch\s*\(/u.test(nodeFilesystemRuntimeSource)) {
  failures.push("packages/node/runtime/filesystem.js: filesystem effects must stay behind the shared isolated Node host and captured validation/UTF-8 operations");
}
for (const phrase of [
  'import { MessageChannel as __VelarNodeHostMessageChannel, MessagePort as __VelarNodeHostMessagePort, Worker as __VelarNodeHostWorker } from "node:worker_threads"',
  "const __velarNodeHostMaxDataPending = 4096",
  "const __velarNodeHostMaxServePending = 4608",
  "function __velarNodeHostRequestId()",
  "export function __velarNodeHostInvoke(operation, args)",
  "export function __velarNodeHostOn(event, handler)",
  "let __velarNodeHostFailure = null",
  "if (__velarNodeHostFailure) return new __velarNodeHostPromise",
  "__velarNodeHostActiveServers > 0",
  "__velarNodeHostActiveWatcherCount > 0",
  "Node host worker did not become ready",
]) {
  if (!sharedNodeHostRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/runtime/node-host*.js: shared Node host proxy is missing '${phrase}'`);
  }
}
for (const phrase of [
  'from "node:fs/promises"',
  'import { createReadStream, watch as watchNode } from "node:fs"',
  'from "node:worker_threads"',
  '"fs.readFile", "fs.createFile", "fs.replaceFileIfMatches", "fs.writeFile", "fs.appendFile"',
  'await writeFile(path, data, {flag: "wx"})',
  "async function fileMutationIdentities(paths)",
  "async function withFileMutations(paths, action)",
  "async function commitTextReplacement(path, data, mode)",
  '"serve.start", "serve.stop", "serve.body", "serve.bodyBytes", "serve.readFile", "serve.respond", "serve.respondFile"',
  '"serve.streamStart", "serve.streamWrite", "serve.streamEnd", "serve.fail"',
  "function allocateHandle(values, next, maximum, name)",
  "candidate >= Number.MAX_SAFE_INTEGER ? 1 : candidate + 1",
  "const maxServeAggregateBytes = 128 * 1024 * 1024",
  "const maxFileWatchers = 128",
  "const maxWatchPaths = 4096",
  "function closeFileWatcher(task)",
  "function reserveServeBytes(task, bytes)",
  "function reserveTransientServeBytes(bytes)",
  "!task.completed && !task.abandoned",
  'throw new Error("Node serve client connection is closed")',
  "async function withRequest(task, action)",
  "async function dispatch(operation, args)",
  'port.postMessage({kind: "ready"})',
]) {
  if (!sharedNodeHostWorkerRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/runtime/node-host-worker*.js: shared isolated Node host is missing '${phrase}'`);
  }
}
if ((sharedNodeHostWorkerRuntimeSource.match(/requests\.delete\s*\(/gu) ?? []).length !== 1) {
  failures.push("packages/node/runtime/node-host-worker*.js: request completion and disconnect must release aggregate ownership through one lifecycle gate");
}
if (/\b(?:import\s*\(|require\s*\(|eval\s*\(|Function\s*\()/u.test(sharedNodeHostWorkerRuntimeSource)) {
  failures.push("packages/node/runtime/node-host-worker*.js: shared isolated Node host may load only static node: built-ins");
}
for (const phrase of [
  'import { __velarNodeHostInvoke, __velarNodeHostOn } from "velar/node-host-v1"',
  'import { onShutdown as __velarServeOnShutdown } from "velar/host"',
  // D114 F10-node, audit NO-D1: the identity a nameless project is known by is
  // a digest of its manifest, so the emitted module re-derives one — through
  // the language's own hash, not a second SHA-256 written into this runtime.
  'import { sha256Text as __velarServeSha256Text } from "velar/hash"',
  '__velarNodeHostOn("serve.request"',
  'await __velarNodeHostInvoke("serve.start"',
  '__velarNodeHostInvoke("serve.streamWrite"',
  "export class RequestBodyTooLargeError",
]) {
  if (!nodeServeRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/runtime/serve*.js: captured serve boundary is missing '${phrase}'`);
  }
}
if (/from\s+["']node:/u.test(nodeServeRuntimeSource)) {
  failures.push("packages/node/runtime/serve*.js: application-facing serve runtime must not import Node transport built-ins");
}
for (const phrase of [
  'import { velarNodeServeSource } from "./modules/serve.ts"',
  '} from "./runtime-sources.generated.ts"',
  'export const VELAR_NODE_HOST_MODULE = "velar/node-host-v1"',
  "[VELAR_NODE_HOST_MODULE, VELAR_SHARED_NODE_HOST_RUNTIME]",
  '["velar/fs", VELAR_NODE_FS_MODULE_SOURCE]',
  '["velar/http", VELAR_NODE_HTTP_RUNTIME]',
  '["velar/env", VELAR_NODE_ENV_RUNTIME]',
  '["velar/host", VELAR_NODE_HOST_RUNTIME]',
  '["velar/terminal", VELAR_NODE_TERMINAL_MODULE_SOURCE]',
  '["velar/serve", velarNodeServeSource()]',
  '["velar/fs", [VELAR_NODE_HOST_MODULE, "velar/binary"]]',
  '["velar/http", [VELAR_NODE_HOST_MODULE, "velar/binary"]]',
  '["velar/serve", [VELAR_NODE_HOST_MODULE, VELAR_ERROR_NORMALIZATION_MODULE, VELAR_COLLECTION_LOWERING_MODULE, "velar/binary", "velar/fs", "velar/hash", "velar/host", "velar/task"]]',
  "dependencies: nodeModuleDependencies",
]) {
  if (!nodeCompilerSource.includes(phrase)) failures.push(`packages/node/src/compiler.ts: Node host runtime composition is missing '${phrase}'`);
}
for (const [constant, composed] of [
  ["VELAR_NODE_FS_MODULE_SOURCE", "VELAR_NODE_FILESYSTEM_RUNTIME"],
  ["VELAR_NODE_TERMINAL_MODULE_SOURCE", "VELAR_NODE_TERMINAL_RUNTIME"],
]) {
  if (!runtimeComposition(constant, "node").includes(composed)) {
    failures.push(`packages/node/runtime/manifest.json: ${constant} must be composed from ${composed}`);
  }
}
// D115 §一.4: a module that launches a Worker carries that Worker's source as a
// string literal. It borrows the constant and encodes it; a second, escaped copy
// of a Worker's source written into its launcher is the duplication this rule
// exists to keep out.
for (const [launcher, worker] of [
  ["VELAR_SHARED_NODE_HOST_RUNTIME", "VELAR_NODE_HOST_WORKER_SOURCE"],
  ["VELAR_NODE_TERMINAL_RUNTIME", "VELAR_NODE_TERMINAL_WORKER_SOURCE"],
  ["VELAR_NODE_TERMINAL_WORKER_SOURCE", "VELAR_NODE_TERMINAL_INPUT_SOURCE"],
  ["VELAR_NODE_PROCESS_MODULE_SOURCE", "VELAR_NODE_PROCESS_WORKER_SOURCE"],
]) {
  const parts = runtimeManifests.get("node").constants.find((entry) => entry.name === launcher)?.parts ?? [];
  if (!parts.some((part) => part.json === worker)) {
    failures.push(`packages/node/runtime/manifest.json: ${launcher} must carry ${worker} as the source text it launches`);
  }
}
for (const match of nodeProcessWorkerRuntimeSource.matchAll(/^\s*import\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/gmu)) {
  if (!match[1].startsWith("node:")) failures.push(`packages/node/runtime/process-worker.js: isolated process host imports non-builtin '${match[1]}'`);
}
for (const phrase of [
  "Object.getOwnPropertyDescriptor(String.prototype, \"charCodeAt\")",
  "Object.getOwnPropertyDescriptor(Reflect, \"apply\")",
  "__velarUtf8ReflectApply(__velarUtf8CharCodeAt",
  "function __velarDeclaredLength(value)",
]) {
  if (!utf8RuntimeSource.includes(phrase)) failures.push(`packages/compiler/runtime/utf8.js: missing captured transport operation '${phrase}'`);
}
// No target holds its module bodies in a template any more, so every one of
// these compositions is a part list in that package's own runtime manifest.
for (const [owner, source, composes] of [
  ["Web", webHttpModuleSource, runtimeComposition("WEB_HTTP_MODULE", "web").includes("VELAR_UTF8_RUNTIME")],
  ["Node", nodeHttpModuleSource, runtimeComposition("VELAR_NODE_HTTP_RUNTIME", "node").includes("VELAR_UTF8_RUNTIME")],
  ["Desktop", desktopHttpModuleSource, runtimeComposition("DESKTOP_HTTP_SOURCE", "desktop").includes("VELAR_UTF8_RUNTIME")],
]) {
  if (!composes || !source.includes("__velarUtf8ByteLength(body)")) {
    failures.push(`packages/${owner.toLowerCase()}: HTTP must consume the compiler-owned UTF-8 transport budget`);
  }
}
if (!webHttpModuleSource.includes("__velarUtf8ByteLength(value)")
  || /\bbody\.length\s*>\s*16\s*\*\s*1024\s*\*\s*1024/u.test(webHttpModuleSource)
  || /Buffer\.byteLength\s*\(/u.test(nodeHttpModuleSource)) {
  failures.push("Web/Node HTTP: target-specific request-body sizing bypasses the shared UTF-8 runtime");
}
for (const [owner, source] of [["Web", webHttpModuleSource], ["Node", nodeHttpModuleSource], ["Desktop", desktopHttpModuleSource]]) {
  if (!source.includes("content-type") || !source.includes("headersOf(headers)") && !source.includes("checkedHeaders(headers)")) {
    failures.push(`packages/${owner.toLowerCase()}: generated JSON headers must be rechecked inside the aggregate header budget`);
  }
  if (!source.includes("timeout ?? 120000") || !source.includes("timeout > 600000")) {
    failures.push(`packages/${owner.toLowerCase()}: HTTP must keep the shared default and maximum timeout contract`);
  }
  if ((source.match(/async parse\(Type\)/gu)?.length ?? 0) !== 2 || !source.includes("runtimeHttpType(Type)")) {
    failures.push(`packages/${owner.toLowerCase()}: HTTP request and response must share compiler-known Type parsing`);
  }
  const timerReleases = owner === "Node" || owner === "Web"
    ? (source.match(/nativeReflectApply\(nativeClearTimeout, globalThis, \[this\.timer\]\); this\.timer = null/gu)?.length ?? 0)
    : (source.match(/clearTimeout\(this\.timer\); this\.timer = null/gu)?.length ?? 0);
  if (timerReleases < 2) {
    failures.push(`packages/${owner.toLowerCase()}: HTTP completion and cancellation must release owned timers immediately`);
  }
  if (!source.includes("if (this.request.abortError) throw this.request.abortError;\n      return null;")) {
    failures.push(`packages/${owner.toLowerCase()}: streaming HTTP must observe cancellation after its final consumer callback`);
  }
  if (!source.includes("export class HttpTransportError") || !source.includes("HttpTransportPhase")) {
    failures.push(`packages/${owner.toLowerCase()}: HTTP must expose stable request/response transport failures`);
  }
}
if (!webHttpModuleSource.includes("HTTP request transport failed") || !webHttpModuleSource.includes("HTTP response transport failed")) {
  failures.push("packages/web: in-process HTTP must classify native request and response transport failures");
}
if ((webHttpModuleSource.match(/__velarDeclaredLength\(this\.declaredLength\)/gu)?.length ?? 0) !== 2
  || !nodeHttpModuleSource.includes("__velarDeclaredLength(this.declaredLength)")
  || !runtimeComposition("VELAR_NODE_SERVE_PREFIX", "node").includes("VELAR_UTF8_RUNTIME")
  || !sharedNodeHostWorkerRuntimeSource.includes('const declaredText = task.request.headers["content-length"]')
  || !sharedNodeHostWorkerRuntimeSource.includes('/^[0-9]+$/u.test(declaredText)')
  || !desktopWorkerSource.includes("transportDeclaredLength(response.headers.get(\"content-length\"))")) {
  failures.push("Web/Node/Desktop: declared transport lengths must use captured decimal parsing before body reads");
}
const nodeProcessComposition = runtimeComposition("VELAR_NODE_PROCESS_MODULE_SOURCE", "node");
const desktopProcessComposition = runtimeComposition("DESKTOP_PROCESS_SOURCE", "desktop");
for (const [owner, source, composes] of [
  ["Node", nodeProcessModuleSource, nodeProcessComposition.includes("VELAR_PROCESS_HOST_RUNTIME") && nodeProcessComposition.includes("VELAR_UTF8_RUNTIME")],
  ["Desktop", desktopProcessModuleSource, desktopProcessComposition.includes("VELAR_PROCESS_HOST_RUNTIME") && desktopProcessComposition.includes("VELAR_UTF8_RUNTIME")],
]) {
  if (!composes) {
    failures.push(`packages/${owner.toLowerCase()}: velar/process must compose the canonical process-host and UTF-8 runtimes`);
  }
  for (const phrase of [
    "export const ProcessOutputChannel",
    "this.next = async () =>",
    "Process.next() allows only one active pull",
    "Process output must be consumed before wait()",
    "Process wait() cannot run while next() is pending",
  ]) {
    if (!source.includes(phrase)) failures.push(`packages/${owner.toLowerCase()}: velar/process is missing pull contract '${phrase}'`);
  }
  if (/\b(?:Array\.isArray|Number\.isSafeInteger|Object\.(?:create|freeze|getOwnPropertyDescriptor|getPrototypeOf|seal)|Promise\.(?:reject|resolve)|Reflect\.ownKeys|clearTimeout|setTimeout)\s*\(|\bnew (?:Error|Promise|RangeError|Set|TextEncoder|TypeError)\b|\.includes\s*\(/u.test(source)) {
    failures.push(`packages/${owner.toLowerCase()}: velar/process validation or result assembly bypasses the canonical captured host ABI`);
  }
}
for (const phrase of [
  'import { MessageChannel, MessagePort, Worker } from "node:worker_threads"',
  'const __velarNodeProcessMessagePortPost = __velarProcessDataOperation(MessagePort.prototype, "postMessage")',
  "const __velarNodeProcessOwners = __velarProcessCreate(null)",
  "function __velarNodeProcessReapOwners()",
  "if (__velarNodeProcessFailure) return __velarProcessReject(__velarNodeProcessFailure)",
  "try { await __velarNodeProcessReadyPromise; }",
  '__velarProcessCall(__velarNodeProcessWorkerUnref, __velarNodeProcessWorker, [])',
]) {
  if (!nodeProcessModuleSource.includes(phrase)) failures.push(`packages/node: velar/process does not preserve isolated worker ownership '${phrase}'`);
}
if (nodeProcessModuleSource.includes('from "node:child_process"') || nodeProcessModuleSource.includes('from "node:string_decoder"')) {
  failures.push("packages/node: application-realm velar/process must not construct Node child or decoder objects outside its initialized worker");
}
if ((nodeProcessWorkerRuntimeSource.match(/new StringDecoder\("utf8"\)/gu)?.length ?? 0) < 2
  || !desktopProcessModuleSource.includes('invoke("read", [this.handle], 0)')
  || !desktopWorkerSource.includes('if (operation === "read") return processRead(args, owner)')
  || (desktopWorkerSource.match(/new StringDecoder\("utf8"\)/gu)?.length ?? 0) < 2
  || !desktopWorkerSource.includes("return task.next()")) {
  failures.push("Node/Desktop: process output must preserve incremental UTF-8 decoding through the pull-based worker bridge");
}
for (const [owner, source, responseName] of [
  ["Web", webHttpModuleSource, "wrapped"],
  ["Node", nodeHttpModuleSource, "wrapped"],
  ["Desktop", desktopHttpModuleSource, "response"],
]) {
  if (!source.includes(`const errorUrl = ${responseName}.url || this.url;`)
    || !source.includes(`" for " + errorUrl, ${responseName}.status, errorUrl`)) {
    failures.push(`packages/${owner.toLowerCase()}: HTTP errors must identify the final response URL with an initial-URL fallback`);
  }
}
for (const phrase of [
  'import { __velarNodeHostHttpTransportError, __velarNodeHostInvoke } from "velar/node-host-v1"',
  "const NativeURL = typeof globalThis.URL",
  "resolvedSecretHeaders(this.options.secretHeaders, this.options.headers)",
  '__velarNodeHostInvoke("http.request"',
  '__velarNodeHostInvoke("http.read"',
  '__velarNodeHostInvoke("http.cancel"',
  '__velarNodeHostInvoke("http.close"',
]) {
  if (!nodeHttpModuleSource.includes(phrase)) failures.push(`packages/node/runtime/http*.js: HTTP boundary is missing '${phrase}'`);
}
for (const phrase of [
  'import { createServer, request as createHttpRequest } from "node:http"',
  'import { request as createHttpsRequest } from "node:https"',
  '"http.request", "http.read", "http.readBytes", "http.cancel", "http.close"',
  "const httpRequests = new Map()",
  // SV-D3: fatal *and* ignoreBOM — the streaming decoder rejects malformed
  // bytes and removes none, so a leading U+FEFF reaches the reader as text.
  'decoder: new TextDecoder("utf-8", {fatal: true, ignoreBOM: true})',
  "if (httpRequests.size >= maxHttpRequests)",
  "class HttpTransportFailure extends Error",
  'return {name: "HttpTransportError", message: error.message, phase: error.phase}',
  'throw new Error("HTTP redirect limit of 20 was exceeded")',
  'delete headers["content-length"]',
]) {
  if (!sharedNodeHostWorkerRuntimeSource.includes(phrase)) failures.push(`packages/node/runtime/node-host-worker*.js: isolated HTTP host is missing '${phrase}'`);
}
for (const phrase of [
  "let __velarNodeHostActiveHttpRequests = 0",
  "const __velarNodeHostActiveHttpHandles =",
  "export class __velarNodeHostHttpTransportError",
  "__velarNodeHostActiveHttpRequests > 0",
  'pending.operation === "http.request"',
  'pending.operation === "http.close" || pending.operation === "http.cancel"',
]) {
  if (!sharedNodeHostRuntimeSource.includes(phrase)) failures.push(`packages/node/runtime/node-host*.js: HTTP lifecycle ownership is missing '${phrase}'`);
}
for (const phrase of [
  "class HttpTransportFailure extends Error",
  'kind: "http-transport"',
  'throw new HttpTransportFailure("request")',
  'throw new HttpTransportFailure("response")',
]) {
  if (!desktopWorkerSource.includes(phrase)) failures.push(`packages/desktop/native/node/worker.js: HTTP transport classification is missing '${phrase}'`);
}
if (!desktopNativeHostSource.includes("VelarDesktopHttpTransportError")
  || !desktopHttpModuleSource.includes("function bridgeTransportError(error, phase)")) {
  failures.push("packages/desktop: structured HTTP transport failures must survive the Worker/WebView bridge and be revalidated in the renderer");
}
if (!nodeCompilerSource.includes('["velar/http", [VELAR_NODE_HOST_MODULE, "velar/binary"]]')) {
  failures.push("packages/node/src/compiler.ts: velar/http must materialize the private Node host dependency");
}
if (/\b(?:globalThis\.(?:fetch|Headers|Response|AbortController|ReadableStream)|new (?:Headers|Response|AbortController|TextDecoder)|await fetch\s*\()/u.test(nodeHttpModuleSource)
  || /\.(?:call|includes|test|toLowerCase|toUpperCase)\s*\(/u.test(nodeHttpModuleSource)
  || /\b(?:Array\.isArray|Number\.(?:isInteger|isSafeInteger)|Object\.(?:create|freeze|fromEntries|keys)|Reflect\.ownKeys)\s*\(/u.test(nodeHttpModuleSource)) {
  failures.push("packages/node/runtime/http*.js: application-facing HTTP validation or transport bypasses its captured ABI or isolated host");
}
for (const phrase of [
  "const nativeFetch = typeof globalThis.fetch",
  "const NativeHeaders = typeof globalThis.Headers",
  "const NativeResponse = typeof globalThis.Response",
  "const NativeAbortController = typeof globalThis.AbortController",
  "const NativeFormData = typeof globalThis.FormData",
  "const NativeBlob = typeof globalThis.Blob",
  "nativeReflectApply(nativeFetch, globalThis",
  "nativeReflectApply(nativeResponseStatus, response",
  "nativeReflectApply(nativeHeadersSet, output",
  "nativeReflectApply(nativeFormAppend, data",
]) {
  if (!webHttpModuleSource.includes(phrase)) failures.push(`packages/web: HTTP transport is missing captured host operation '${phrase}'`);
}
if (/\bawait fetch\s*\(/u.test(webHttpModuleSource)
  || /\bnew Headers\s*\(/u.test(webHttpModuleSource)
  || /\bnew Response\s*\(/u.test(webHttpModuleSource)
  || /\bnew AbortController\s*\(/u.test(webHttpModuleSource)
  || /\bnew FormData\s*\(/u.test(webHttpModuleSource)
  || /\bnew Blob\s*\(/u.test(webHttpModuleSource)
  || /\bnew TextDecoder\s*\(/u.test(webHttpModuleSource)
  || /\bnew Uint8Array\s*\(/u.test(webHttpModuleSource)
  || /\bnew Set\s*\(/u.test(webHttpModuleSource)) {
  failures.push("packages/web: HTTP transport must not rediscover mutable ambient host operations after module initialization");
}
for (const phrase of [
  "const __velarListNativeArray = globalThis.Array",
  "const __velarListReflectApply = Object.getOwnPropertyDescriptor(Reflect, \"apply\")",
  "__velarListReflectApply(__velarListArrayIsArray",
  "__velarListReflectApply(__velarListGetOwnPropertyDescriptor",
  "__velarListReflectApply(__velarListDefineProperty",
]) {
  if (!webListGuardRuntimeSource.includes(phrase)) failures.push(`packages/web: List guard is missing captured intrinsic '${phrase}'`);
}
if (webListGuardRuntimeSource.includes("if (!Array.isArray(value))")
  || webListGuardRuntimeSource.includes("Object.getOwnPropertySymbols(value)")
  || webListGuardRuntimeSource.includes("Object.getOwnPropertyNames(value)")
  || webListGuardRuntimeSource.includes("Object.getOwnPropertyDescriptor(value")) {
  failures.push("packages/web: shared List guards must not rediscover mutable ambient intrinsics after initialization");
}
for (const phrase of [
  "const __velarOptionsNativeArray = globalThis.Array",
  "const __velarOptionsNativeSet = globalThis.Set",
  "const __velarOptionsReflectApply = Object.getOwnPropertyDescriptor(Reflect, \"apply\")",
  "__velarOptionsReflectApply(__velarOptionsArrayIsArray",
  "__velarOptionsReflectApply(__velarOptionsSetHas",
  "function __velarOptionFields(fields)",
  "function __velarFreezeOptionsValue(value)",
]) {
  if (!webOptionsGuardRuntimeSource.includes(phrase)) failures.push(`packages/web: options guard is missing captured intrinsic '${phrase}'`);
}
if (webOptionsGuardRuntimeSource.includes("Array.isArray(value)")
  || webOptionsGuardRuntimeSource.includes("Object.getPrototypeOf(value)")
  || webOptionsGuardRuntimeSource.includes("Object.getOwnPropertySymbols(value)")
  || webOptionsGuardRuntimeSource.includes("Object.getOwnPropertyNames(value)")
  || webOptionsGuardRuntimeSource.includes("allowed.has(key)")) {
  failures.push("packages/web: shared options guards must not rediscover mutable ambient intrinsics after initialization");
}
if (/__velarOptions\([^\n]*new Set\s*\(/u.test(webRuntimeSourceText)
  || /handler\(handlers,\s*new Set\s*\(/u.test(webRuntimeSourceText)) {
  failures.push("packages/web: options consumers must build allowed fields through the captured guard ABI");
}
if ((webCompilerSource.match(/namedIntrinsic\("runtime\.parseAsync"/gu)?.length ?? 0) !== 2
  || (nodeCompilerSource.match(/namedIntrinsic\("runtime\.parseAsync"/gu)?.length ?? 0) !== 4
  || !compilerAnalysisIncludes('case "runtime.parseAsync"')
  || !compilerAnalysisIncludes("arity();")
  || !compilerAnalysisIncludes("this.host.reportPromiseResolutionHazard(parsed")) {
  failures.push("compiler/Web/Node: HTTP and serve async runtime-Type parsing must share one Promise-safe Core intrinsic");
}
for (const phrase of [
  'readonly kind: "runtimeType"',
  'if (expected.kind === "runtimeType")',
  'if (pattern.kind === "runtimeType")',
  'export function typeContainsRuntimeTypeCheck',
]) {
  if (!compilerTypesIncludes(phrase)) failures.push(`${COMPILER_TYPES_LAYER}: missing first-class Type<T> contract '${phrase}'`);
}
for (const phrase of [
  'readonly kind: "record"',
  'if (syntax.name === "Record")',
  'return `${type.readonlyView ? "readonly " : ""}Record<${describeType(type.value)}>`',
]) {
  if (!compilerTypesIncludes(phrase)) failures.push(`${COMPILER_TYPES_LAYER}: missing Record<T> contract '${phrase}'`);
}
for (const phrase of [
  'if (type.kind === "record") return this.jsonSerializable(type.value, seen)',
  'object.kind === "record"',
  'Record keys may be absent',
]) {
  if (!compilerAnalysisIncludes(phrase)) failures.push(`${COMPILER_ANALYSIS_LAYER}: missing Record<T> analysis contract '${phrase}'`);
}
if (!compilerTypeValidationRuntimeSource.includes("function __velarRecordTypeIs(value, check)")) {
  failures.push("packages/compiler/runtime/type-validation.js: missing controlled Record<T> validation operation");
}
for (const phrase of [
  "function __velarRecordFields(value, name)",
  "function __velarRecordSet(value, key, item)",
  "function __velarRecordCopy(value)",
  '!descriptor.configurable || !descriptor.writable',
]) {
  if (!VELAR_COLLECTION_LOWERING_RUNTIME.includes(phrase)) failures.push(`packages/compiler/runtime/collection-lowering.js: missing controlled Record<T> operation '${phrase}'`);
}
if (!VELAR_COLLECTION_LOWERING_RUNTIME.includes('__velarRecordFields(value, "Record index")')) {
  failures.push("packages/compiler/runtime/collection-lowering.js: missing controlled Record<T> index operation");
}
for (const phrase of [
  'if (object.kind === "runtimeType")',
  'Type<T> is a static runtime-Type carrier and cannot itself be checked at runtime',
  'Type<T> is a static runtime-Type carrier and cannot be embedded',
]) {
  if (!compilerAnalysisIncludes(phrase)) failures.push(`${COMPILER_ANALYSIS_LAYER}: missing Type<T> ownership or diagnostic '${phrase}'`);
}
if ((projectCompilerSource.match(/case "runtimeType":/gu)?.length ?? 0) < 3
  || !projectCompilerSource.includes('value: renameType(type.value, aliases)')) {
  failures.push("packages/cli/src/project.ts: Type<T> must survive rename, nominal resolution, and alias expansion");
}
if ((projectCompilerSource.match(/case "record":/gu)?.length ?? 0) < 3
  || (!projectCompilerSource.includes('value: resolveKnownNominals(type.value, classes, enums, namedTypeIdentities)')
    && !projectCompilerSource.includes('value: resolveNested(type.value)'))
  || !projectCompilerSource.includes('value: expandKnownAliases(type.value, aliases, seen)')) {
  failures.push("packages/cli/src/project.ts: Record<T> must preserve nested value types across package boundaries");
}
const serveParseStart = nodeServeRuntimeSource.indexOf("parse: async (Type, maxBytes = __velarServeMaxBodyBytes) => {");
const serveTypeCheck = nodeServeRuntimeSource.indexOf('__velarRequireRuntimeType(Type, "ServeRequest.parse")', serveParseStart);
const serveBodyRead = nodeServeRuntimeSource.indexOf("await json(maxBytes)", serveParseStart);
if (!nodeCompilerSource.includes('["parse", namedIntrinsic("runtime.parseAsync", ["target", "maxBytes"], [unknownType, numberType], promise(unknownType), 1)]')
  || !nodeServeRuntimeSource.includes('__velarServeDataField(value, "parse", "ServeRequest")')
  || serveParseStart < 0 || serveTypeCheck < serveParseStart || serveBodyRead < serveTypeCheck) {
  failures.push("packages/node: ServeRequest.parse must infer through Core and validate Type before reading strict JSON");
}
for (const phrase of [
  "const __velarNormalizeGlobal = globalThis",
  "const __velarNormalizeNativeObject = globalThis.Object",
  "const __velarNormalizeNativeReflect = globalThis.Reflect",
  "const __velarNormalizeNativeWeakMap = globalThis.WeakMap",
  "const __velarNormalizeNativePromise = globalThis.Promise",
  "const __velarNormalizePromiseThen = __velarNormalizeGetOwnPropertyDescriptor",
  "const __velarNormalizeWeakMapGet = __velarNormalizeGetOwnPropertyDescriptor",
  "const __velarNormalizeSymbolFor = __velarNormalizeGetOwnPropertyDescriptor",
  "function __velarNormalizeCall(operation, receiver, arguments_)",
  "function __velarNormalizePromiseValue(value)",
  "function __velarAsyncResolvedValue(value)",
]) {
  if (!compilerPromiseRuntimeSource.includes(phrase)) {
    failures.push(`packages/compiler/runtime/promise.js: missing captured Promise operation '${phrase}'`);
  }
}
if (/\b(?:Object\.(?:getOwnPropertyDescriptor|getPrototypeOf|defineProperty)|Reflect\.apply|Symbol\.for)\s*\(|\b(?:WeakMap|Promise)\.prototype\b|\bnew (?:WeakMap|TypeError)\b|\.(?:get|set|has|then)\s*\(/u.test(compilerPromiseRuntimeSource)) {
  failures.push("packages/compiler/runtime/promise.js: Promise normalization bypasses its captured Object, Reflect, Symbol, WeakMap, Promise, or Error ABI");
}
for (const name of ["normalizePromiseValue", "asyncResolvedValue"]) {
  if (!VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/runtime/promise-exports.js: shared Promise runtime does not export '${name}'`);
  }
}
for (const phrase of [
  "VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_PROMISE_NORMALIZATION_MODULE)",
  "normalizePromiseValue as __velarNormalizePromiseValue",
  "asyncResolvedValue as __velarAsyncResolvedValue",
  "from ${JSON.stringify(VELAR_PROMISE_NORMALIZATION_MODULE)}",
]) {
  const source = phrase === "VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE" ? compilerGeneratedRuntimeSource : compilerEmitterSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: project Promise-normalization contract is missing '${phrase}'`);
}
for (const phrase of [
  "const __velarAsyncPullGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor",
  "const __velarAsyncPullApply = Reflect.apply",
  "async for requires a data-valued next method",
]) {
  if (!compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: missing captured async-pull operation '${phrase}'`);
}
for (const phrase of [
  "const __velarDetachedPromiseThen = globalThis.Promise.prototype.then",
  "const __velarDetachedApply = Reflect.apply",
  "function __velarDetachedReport(failure)",
  "function __velarDetachedTask(task)",
]) {
  if (!compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: missing captured detached-task operation '${phrase}' (B-DETACHED-TASK)`);
}
for (const phrase of [
  "const __velarDetachedRegistryKey = Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)})",
  "const __velarDetachedPromiseThen = globalThis.Promise.prototype.then",
  'phase: \\"detached\\", detail: \\"\\", unhandled: true',
  "function __velarDetachedTask(task)",
]) {
  if (!webEmitterSource.includes(phrase)) failures.push(`packages/web/src/emitter.ts: missing Web detached-task report contract '${phrase}' (B-DETACHED-TASK)`);
}
// D114 CO-I6: there is one host-frame policy and one implementation of it,
// `__velarHostErrorTrace` in packages/compiler/runtime/error.js. Every channel
// that prints a host trace goes through it — including `velar/async`'s own
// detached reporter, which used to hand `failure.stack` to the console and so
// printed frames the policy hides and ignored `velar run --stack`. Nothing
// pinned that last consumer, so deleting the call left every gate green.
if (!compilerErrorRuntimeSource.includes("function __velarHostErrorTrace(error, fallback)")) {
  failures.push("packages/compiler/runtime/error.js: the one host-frame trace policy is missing 'function __velarHostErrorTrace(error, fallback)' (CO-I6)");
}
const coreAsyncModuleSource = coreFamilySource("async");
for (const phrase of [
  'import { TimeoutError, hostErrorTrace, isError as __velarIsError } from "velar/compiler-runtime-errors-v1";',
  'hostErrorTrace(failure, "A detached task failed")',
]) {
  if (!coreAsyncModuleSource.includes(phrase)) {
    failures.push(`packages/core/runtime/async.js: the detached reporter bypasses the one host-frame trace policy — missing '${phrase}' (CO-I6)`);
  }
}
// The prose above the reporter quotes the spelling this rule refuses, so the
// rule reads the code and not the comment that explains why the code is what it is.
const coreAsyncModuleCode = coreAsyncModuleSource.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
if (/\bfailure\.stack\b/u.test(coreAsyncModuleCode)) {
  failures.push("packages/core/runtime/async.js: reads a host stack directly instead of through hostErrorTrace (CO-I6)");
}
// D114 WB-D1: and the Web face, which the 0.32.0 audit found still writing that
// sentence for itself. `packages/web/runtime/foundation.js` is the report
// channel a failure nobody claimed reaches in a host with no document — a
// headless `velar test`, a worker — and it read `error.stack` directly, so the
// frames the policy exists to hide were exactly the frames it printed. The pin
// is the same shape as async.js's: the call has to be there, and the direct
// read must not be.
const webFoundationModuleSource = runtimeFileText.get("web/foundation.js");
if (!webFoundationModuleSource.includes('trace = __velarHostErrorTrace(error, trace)')) {
  failures.push("packages/web/runtime/foundation.js: the unowned-failure report channel bypasses the one host-frame trace policy — missing 'trace = __velarHostErrorTrace(error, trace)' (WB-D1)");
}
const webFoundationModuleCode = webFoundationModuleSource.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
if (/\berror\.stack\b/u.test(webFoundationModuleCode)) {
  failures.push("packages/web/runtime/foundation.js: reads a host stack directly instead of through hostErrorTrace (WB-D1)");
}
// D114 W2: the reactive run-count window carries across flushes only for work
// an observer started, and exactly two compiler-owned lowering points can start
// it -- the `detach` statement's detached task and an action's call path. Losing
// either mark silently restores the pre-W per-flush budget for the cycle it
// covers, with nothing failing to say so.
if (!webFoundationSource.includes("function __velarNoteAsyncWork()")
  || ((webEmitterSource + "\n" + emittedWebRuntimeSource).match(/__velarNoteAsyncWork\(\)/gu) ?? []).length < 2) {
  failures.push("packages/web: the observer-started async-work mark is missing from the foundation or from one of the two lowering points (detach, action call)");
}
if (/\bevent\.(?:data|lastEventId|code|reason|matches|defaultPrevented|button|metaKey|ctrlKey|shiftKey|altKey|preventDefault|stopPropagation)\b/u.test(webAdapterRuntimeSource)) {
  failures.push("packages/web/runtime: reads framework-owned host event fields outside captured native/data-descriptor adapters");
}
if (/\bvalue\.(?:target|preventDefault|stopPropagation)\b/u.test(webEmitterSource)) {
  failures.push("packages/web/src/emitter.ts: applies event modifiers through replaceable event fields or methods");
}
if (/\bvalue\.(?:send|close|addEventListener|readyState|url)\b/u.test(webRuntimeSourceText)) {
  failures.push("packages/web/runtime: invokes realtime instance fields instead of the captured host ABI");
}
if (/\b(?:navigator|document|location)\.(?:href|origin|pathname|search|hash|language|languages|onLine|maxTouchPoints|clipboard|visibilityState)\b/u.test(browserPlatformModuleSource)
  || /\b(?:matchMedia|setTimeout|clearTimeout|requestAnimationFrame|addEventListener|removeEventListener)\s*\(/u.test(browserPlatformModuleSource)
  || /\b(?:Element|HTMLElement|HTMLDialogElement)\.prototype\.(?:scrollIntoView|getBoundingClientRect|focus|blur|showModal|close)\b/u.test(browserPlatformModuleSource)
  || /\b(?:matcher|dialog|value)\.(?:addEventListener|removeEventListener|isConnected|open|returnValue)\b/u.test(browserPlatformModuleSource)) {
  failures.push("packages/web/runtime/browser.js: velar/browser bypasses the captured browser host ABI");
}
if (/\b(?:history|location)\.(?:pushState|replaceState|back|forward|reload|href|origin|pathname|search|hash)\b/u.test(webPlatformModuleSource)
  || /\b(?:dispatchEvent|requestAnimationFrame|addEventListener|removeEventListener)\s*\(/u.test(webPlatformModuleSource)
  || /\bnode\.(?:addEventListener|removeEventListener)\s*\(/u.test(webPlatformModuleSource)
  || /\bnew\s+(?:URL|URLSearchParams)\s*\(/u.test(webPlatformModuleSource)) {
  failures.push("packages/web/runtime: velar/web navigation bypasses the captured browser host ABI");
}
if (/\bqueueMicrotask\s*\(/u.test(webRuntimeSourceText)
  || /\bqueueMicrotask\s*\(/u.test(webEmitterSource)
  // D114 W/A1: the flush budget's task window ends at a macrotask sentinel, so
  // the foundation now reaches a second scheduling operation. It is captured at
  // module initialization and applied through the captured Reflect.apply, like
  // the microtask enqueue beside it -- an ambient call would let a replaced
  // global decide when a runaway cycle stops being counted.
  || /\bsetTimeout\s*\(/u.test(webFoundationSource)
  || !webFoundationSource.includes("const __velarFoundationSetTimeout = globalThis.setTimeout")
  || /\bglobalThis\.Date\.now\s*\(/u.test(webFoundationSource)) {
  failures.push("packages/web: Web scheduling or timestamps bypass the captured browser host ABI");
}
if (/\b(?:globalThis\.)?(?:localStorage|sessionStorage|indexedDB)\b/u.test(storagePlatformModuleSource)
  || /\.(?:getItem|setItem|removeItem|key|open|transaction|objectStore|createObjectStore|contains|getKey|getAllKeys|put|close)\s*\(/u.test(storagePlatformModuleSource)
  || /\.(?:result|error|objectStoreNames|onupgradeneeded|onsuccess|onerror|onblocked|onversionchange|onclose|onabort|oncomplete)\b/u.test(storagePlatformModuleSource)
  || /\b(?:dispatchEvent|addEventListener|removeEventListener)\s*\(/u.test(storagePlatformModuleSource)
  || /\bNumber\.isSafeInteger\s*\(/u.test(storagePlatformModuleSource)) {
  failures.push("packages/web/runtime/storage.js: velar/storage bypasses the captured Storage or IndexedDB host ABI");
}
for (const phrase of [
  "function storageSafeInteger(value)",
  "function storageByteBudget(value)",
  "__velarUtf8ByteLength(next) > maxBytes",
  'typeof encoded !== "string" || __velarUtf8ByteLength(encoded) > maxBytes',
  'objectOperation(store, "put", [encoded, name])',
]) {
  if (!storagePlatformModuleSource.includes(phrase)) failures.push(`packages/web/runtime/storage.js: velar/storage budget boundary is missing '${phrase}'`);
}
if (!runtimeComposition("WEB_STORAGE_MODULE", "web").includes("VELAR_UTF8_RUNTIME")) {
  failures.push("packages/web/runtime/manifest.json: velar/storage does not carry the compiler-owned UTF-8 runtime its byte budget is measured with");
}
for (const phrase of [
  "const NativeFormElement = typeof globalThis.HTMLFormElement",
  "const NativeFormData = typeof globalThis.FormData",
  "const formHasInstance = Object.getOwnPropertyDescriptor(Function.prototype, Symbol.hasInstance)",
  "const formDataGet = typeof NativeFormData",
  "const formDataGetAll = typeof NativeFormData",
  "const formDataHas = typeof NativeFormData",
  "const formDataForEach = typeof NativeFormData",
  "return new NativeFormData(form)",
  "formReflectApply(formHasInstance, NativeFormElement",
]) {
  if (!formsPlatformModuleSource.includes(phrase)) failures.push(`packages/web: forms data host is missing captured operation '${phrase}'`);
}
if (/\bnew FormData\s*\(/u.test(formsPlatformModuleSource)
  || /\binstanceof HTMLFormElement\b/u.test(formsPlatformModuleSource)
  || /\bdata\.(?:get|getAll|has|forEach)\s*\(/u.test(formsPlatformModuleSource)
  || /\bvalue\.trim\s*\(/u.test(formsPlatformModuleSource)
  || /\/(?:\^|\[).*\/u\.test\s*\(/u.test(formsPlatformModuleSource)) {
  failures.push("packages/web/runtime/forms.js: velar/forms data extraction bypasses its captured WebIDL or parsing ABI");
}
for (const phrase of [
  "const NativeFormNode = typeof globalThis.Node",
  "const NativeFormElementBase = typeof globalThis.Element",
  "const NativeFormHtmlElement = typeof globalThis.HTMLElement",
  "const NativeFormDocument = globalThis.document",
  "const NativeFormWeakMap = typeof globalThis.WeakMap",
  "const formElementGetAttribute = typeof formElementOwner",
  "const formElementQuerySelectorAll = typeof formElementOwner",
  "const formHtmlFocus = typeof formHtmlOwner",
  "const formNativeReset = typeof NativeFormElement",
  "function formHostMethod(operation, owner, receiver",
  "function formHostRead(descriptor, owner, receiver",
  "function formHostWrite(descriptor, owner, receiver",
  "function formSnapshotCollection(value, name, maximum)",
  "formCall(formWeakMapSet, pendingFields",
]) {
  if (!formsPlatformModuleSource.includes(phrase)) failures.push(`packages/web: forms DOM lifecycle is missing captured operation '${phrase}'`);
}
if (/\bform\.(?:elements|querySelector|querySelectorAll|setAttribute|removeAttribute|reset)\b/u.test(formsPlatformModuleSource)
  || /\b(?:field|error|item)\.(?:getAttribute|setAttribute|removeAttribute|insertAdjacentElement|remove|focus|disabled|textContent|id)\b/u.test(formsPlatformModuleSource)
  || /\bpendingFields\.(?:get|has|set|delete)\s*\(/u.test(formsPlatformModuleSource)
  || /\bdocument\.createElement\s*\(/u.test(formsPlatformModuleSource)
  || /\bArray\.from\s*\(/u.test(formsPlatformModuleSource)
  || /\bnew Set\s*\(/u.test(formsPlatformModuleSource)) {
  failures.push("packages/web/runtime/forms.js: velar/forms DOM lifecycle bypasses its captured node, control, collection, or mutation ABI");
}
for (const phrase of [
  "const __velarDomDocument = globalThis.document",
  "const __velarDomNativeNode = typeof globalThis.Node",
  "const __velarDomDocumentCreateElement = __velarDomMember",
  "const __velarDomNodeInsertBefore = __velarDomPrototypeMember",
  "function __velarDomNodeOperation(value, name, candidates, arguments_)",
  "function __velarDomCollectionSnapshot(value, name)",
  "function __velarDomListSnapshot(value, name)",
  "function __velarDomCreateSet()",
]) {
  if (!webDomHostRuntimeSource.includes(phrase)) failures.push(`packages/web: shared DOM host is missing captured operation '${phrase}'`);
}
if (!runtimeComposition("WEB_RUNTIME_FOUNDATION", "web").includes("WEB_DOM_HOST_RUNTIME")
  || !runtimeComposition("WEB_WEB_MODULE", "web").includes("WEB_DOM_HOST_RUNTIME")) {
  failures.push("packages/web: emitted JSX and velar/web do not share the canonical DOM host runtime source");
}
if (/\bdocument\.|\bglobalThis\.Node\b|\bparent\.(?:append|insertBefore)\s*\(|\b(?:node|owned|end)\.(?:remove|before)\s*\(/u.test(emittedDomRuntimeSource)
  || /\bdocument\.|\bglobalThis\.Node\b|\bparent\.(?:append|insertBefore)\s*\(|\bnode\.remove\s*\(/u.test(webComponentDomRuntimeSource)) {
  failures.push("packages/web: JSX or velar/web component DOM lifecycle bypasses the shared captured host ABI");
}
for (const phrase of [
  "const __velarGraphNativeSet = globalThis.Set",
  "const __velarGraphNativeWeakMap = globalThis.WeakMap",
  "const __velarGraphObjectIs = Object.getOwnPropertyDescriptor(Object, \"is\")",
  "const __velarGraphObjectFreeze = Object.getOwnPropertyDescriptor(Object, \"freeze\")",
  "const __velarGraphObjectDefineProperty = Object.getOwnPropertyDescriptor(Object, \"defineProperty\")",
  "function __velarGraphSetItems(value)",
  "function __velarGraphWeakMapRead(value, key)",
  "function __velarGraphDefine(value, key, descriptor)",
  "function __velarGraphGet(value, key, receiver)",
]) {
  if (!webReactivityHostRuntimeSource.includes(phrase)) failures.push(`packages/web: shared reactivity host is missing captured operation '${phrase}'`);
}
for (const phrase of [
  "const toRaw = (value) =>",
  "const track = (target, key) =>",
  "const reactive = (value, parent = null) =>",
  "const collectionRead = (value, key, child) =>",
  "const collectionTrigger = (value, key, iterate = true, structure = false, indexFrom = null, allKeys = false) =>",
  "const collectionUnlink = (value, child) =>",
  "const trackSubscribers = (subscribers) =>",
  "const runTracked = (observer, read) =>",
  "const cleanupObserver = (observer) =>",
  "const computed = (read) =>",
]) {
  if (!webFoundationSource.includes(phrase)) failures.push(`packages/web: runtime registry operation must remain receiver-independent '${phrase}'`);
}
if (!runtimeComposition("WEB_RUNTIME_FOUNDATION", "web").includes("WEB_REACTIVITY_HOST_RUNTIME")
  || !emittedReactivityRuntimeSource.includes("__velarGraphCreateSet()")
  || !webFoundationSource.includes("__velarGraphSetItems(__velarRuntime.domQueue)")
  || !emittedWebRuntimeSource.includes("!__velarGraphSame(next, current)")) {
  failures.push("packages/web: emitted reactivity does not consume the canonical captured graph ABI");
}
if (/\bnew (?:Set|Map|WeakSet|WeakMap)\s*\(|\b(?:Set|Map|WeakSet|WeakMap)\.prototype|\bObject\.is\s*\(|\bArray\.isArray\s*\(|\bReflect\.(?:get|set|has|deleteProperty)\s*\(/u.test(emittedReactivityRuntimeSource)) {
  failures.push("packages/web/runtime: reactive observers, cells, or queues bypass the captured graph ABI");
}
// The three slices above are the historical anchors. They stay because they
// assert that specific captured operations are *present*, but they are no
// longer the boundary: WEB_RUNTIME_BODY is checked end to end, so a new
// surface (keyed reconciliation, look/class/style, events, form binding)
// cannot land outside every ABI regex the way it could before.
for (const [name, slice] of [
  ["reactivity", emittedReactivityRuntimeSource],
  ["managed async", emittedManagedAsyncRuntimeSource],
  ["DOM lifecycle", emittedDomRuntimeSource],
]) {
  if (slice.length === 0 || !emittedWebRuntimeSource.includes(slice)) {
    failures.push(`packages/web/runtime: the ${name} slice escaped the emitted Web runtime that the ABI gate covers`);
  }
}
if (!emittedWebRuntimeSource.includes("function __velarTick()")
  || !emittedWebRuntimeSource.includes("function __velarReport(value, phase")) {
  failures.push("packages/web/runtime: the emitted Web runtime boundary no longer spans the whole runtime body");
}
for (const [pattern, message] of [
  [/\bnew (?:Set|Map|WeakSet|WeakMap|Proxy)\s*\(|\b(?:Set|Map|WeakSet|WeakMap|Array|Object|Number|String|Promise)\.prototype\b/u,
    "constructs or reaches a host collection through an ambient constructor or prototype"],
  [/\bObject\.(?:is|freeze|keys|values|entries|assign|create|defineProperty|defineProperties|getOwnPropertyNames|getOwnPropertyDescriptor|getOwnPropertySymbols|getPrototypeOf|preventExtensions|isExtensible)\s*\(/u,
    "reaches an ambient Object static instead of the captured graph ABI"],
  [/\bArray\.(?:isArray|from|of)\s*\(|\bReflect\.[A-Za-z]+\s*\(|\bNumber\.(?:isFinite|isInteger|isSafeInteger)\s*\(|\bJSON\.[A-Za-z]+\s*\(|\bSymbol\.for\s*\(|(?<![A-Za-z0-9_$.])String\s*\(/u,
    "reaches an ambient Array, Reflect, Number, JSON, Symbol, or String operation instead of the captured ABI"],
  [/__velarRuntime\.[A-Za-z]+\.(?:get|set|has|add|delete|clear|values|keys|entries|forEach|size)\b/u,
    "uses a replaceable instance method on a runtime-owned collection"],
  [/(?:element|node|parent|root|host|target|fallback|owned|start|end|child|instance)\.(?:append|insertBefore|replaceChildren|removeChild|appendChild|remove|before|after|setAttribute|removeAttribute|setAttributeNS|removeAttributeNS|childNodes|nodeType|nextSibling|previousSibling|parentNode|firstChild|lastChild|textContent|innerHTML|classList|style|addEventListener|removeEventListener|querySelector|querySelectorAll|valueAsNumber|checked|focus|blur)\b/u,
    "reaches a replaceable DOM member instead of the captured DOM host ABI"],
  [/\bdocument\.|\bglobalThis\.(?:Node|Element|Document|DocumentFragment|CharacterData)\b/u,
    "rediscovers the document or a DOM constructor while the application runs"],
  // Framework state parked on a host object is read through its own descriptor,
  // never through '.': a planted prototype getter would otherwise forge look,
  // class, style, or host-element ownership. Markers on emitter-created plain
  // objects (__velarComponent, __velarSnapshotProps, __velarStyle, __bindRef)
  // stay ordinary reads -- their receivers are never host objects.
  [/\.(?:__velarHost|__velarDynamicRoot|__velarLookTokens|__velarClassState|__velarInlineStyleState|__velarBaseClasses|__velarManagedClasses)\b/u,
    "reads framework ownership off a host object through a replaceable property path"],
  [/for \((?:const|let) [^)]*? of (?!__velarGraphSetItems\(|__velarGraphMapItems\(|__velarGraphMapKeyItems\()/u,
    "iterates with a replaceable iterator instead of an index walk or the captured Set/Map iterator"],
  [/\[\.\.\./u, "copies through the replaceable array iterator"],
  [/[A-Za-z_$][\w$]*\(\.\.\./u, "spreads through the replaceable array iterator instead of the captured apply operation"],
  [/\.(?:flatMap|filter|map|forEach|join|reverse|concat|sort|push|pop|shift|unshift|splice)\s*\(/u,
    "uses a replaceable Array prototype method"],
  // 'indexOf' and 'includes' also live on String.prototype, and the emitted runtime
  // uses String methods freely -- '__velarLookProperty' calls 'token.lastIndexOf(":")'
  // two lines above '__velarLookSurface', and this roster does not ban that. Scoping
  // by receiver keeps the Array coverage instead of dropping the two shared names, and
  // follows the DOM rule above, which enumerates its receivers the same way.
  [/(?<!\btoken)\.(?:indexOf|includes)\s*\(/u,
    "uses a replaceable Array prototype method"],
]) {
  const match = pattern.exec(emittedWebRuntimeUseSource);
  if (match) {
    const line = emittedWebRuntimeUseSource.slice(0, match.index).split("\n").length;
    failures.push(`packages/web/runtime: the emitted Web runtime ${message} -- '${match[0]}' (runtime-use line ${line})`);
  }
}
for (const phrase of [
  "const __velarManagedAsyncNativePromise = globalThis.Promise",
  "const __velarManagedAsyncResolveOperation = __velarGraphOwnDescriptor",
  "const __velarManagedAsyncRejectOperation = __velarGraphOwnDescriptor",
  "const __velarManagedAsyncThenOperation = __velarManagedAsyncPromisePrototype",
  "function __velarManagedAsyncResolve(value)",
  "function __velarManagedAsyncReject(error)",
  "function __velarManagedAsyncThen(value, fulfilled, rejected)",
  "function __velarManagedAsyncCreate(executor)",
  "if (disposed) return __velarManagedAsyncResolve(null)",
  "if (disposed) return __velarManagedAsyncReject(__velarNormalizeError(",
  "return __velarGraphFreeze({",
  "__velarGraphDefine(run, \"pending\"",
  "__velarGraphDefine(run, \"error\"",
]) {
  if (!emittedManagedAsyncRuntimeSource.includes(phrase)) failures.push(`packages/web: managed async runtime is missing captured operation '${phrase}'`);
}
if (/\bPromise\.(?:resolve|reject)\s*\(|\bnew Promise\s*\(|\bObject\.(?:freeze|defineProperty|defineProperties)\s*\(/u.test(emittedManagedAsyncRuntimeSource)
  || !emittedWebRuntimeSource.includes("return __velarManagedAsyncCreate((resolve) => __velarEnqueue(resolve))")) {
  failures.push("packages/web/src/emitter.ts: resource, action, or tick bypasses the captured managed async host ABI");
}
for (const phrase of [
  "const __velarErrorNativeError = globalThis.Error",
  "const __velarErrorNativeString = globalThis.String",
  "const __velarErrorNativeObject = globalThis.Object",
  "const __velarErrorNativeReflect = globalThis.Reflect",
  "const __velarErrorNativeTypeError = globalThis.TypeError",
  "const __velarErrorGetOwnPropertyDescriptor = __velarErrorNativeObject.getOwnPropertyDescriptor",
  "const __velarErrorIsErrorOperation = __velarErrorGetOwnPropertyDescriptor",
  "function __velarIsError(value)",
  "new __velarErrorNativeError(message, { cause: value })",
]) {
  if (!compilerErrorRuntimeSource.includes(phrase)) failures.push(`packages/compiler: error normalization is missing captured operation '${phrase}'`);
}
if (/\b(?:Object\.getOwnPropertyDescriptor|Error\.isError)\s*\(|\bnew (?:Error|TypeError)\b/u.test(compilerErrorRuntimeSource)) {
  failures.push("packages/compiler/runtime/error.js: error normalization bypasses its captured Object/Reflect/Error/String/TypeError ABI");
}
for (const name of ["errorApply", "isError", "normalizeError"]) {
  if (!VELAR_ERROR_NORMALIZATION_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/runtime/error-exports.js: shared error runtime does not export '${name}'`);
  }
}
for (const phrase of [
  "VELAR_ERROR_NORMALIZATION_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE)",
  "normalizeError as __velarNormalizeError",
  "from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)}",
]) {
  const source = phrase === "VELAR_ERROR_NORMALIZATION_MODULE_SOURCE" ? compilerGeneratedRuntimeSource : compilerEmitterSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: project error-normalization contract is missing '${phrase}'`);
}
for (const phrase of [
  "const __velarNarrowingNativeTypeError = globalThis.TypeError",
  "class __VelarNarrowingError extends __velarNarrowingNativeTypeError",
  "function __velarNarrow(value, valid, expected, description, location)",
  "this.name = \"NarrowingError\"",
  // AS-U2: the guard reports file:line:column, the position every other report
  // in a running program uses; the emitter resolves it (`runtimeLocation`).
  "no longer holds: expected \" + expected + \" at \" + location",
]) {
  if (!compilerNarrowingRuntimeSource.includes(phrase)) failures.push(`packages/compiler/runtime/narrowing.js: narrowing runtime is missing '${phrase}'`);
}
for (const phrase of ["__VelarNarrowingError as NarrowingError", "__velarNarrow as narrow"]) {
  if (!VELAR_NARROWING_MODULE_SOURCE.includes(phrase)) failures.push(`packages/compiler/runtime/narrowing-exports.js: shared narrowing runtime does not export '${phrase}'`);
}
for (const phrase of [
  "VELAR_NARROWING_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_NARROWING_MODULE)",
  "narrow as __velarNarrow",
  "from ${JSON.stringify(VELAR_NARROWING_MODULE)}",
  "helpers.push(VELAR_NARROWING_RUNTIME)",
]) {
  const source = phrase === "VELAR_NARROWING_MODULE_SOURCE" ? compilerGeneratedRuntimeSource : compilerEmitterSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: project narrowing-runtime contract is missing '${phrase}'`);
}
if (compilerEmitterSource.includes('"class __VelarNarrowingError extends TypeError')) {
  failures.push("packages/compiler/src/emitter.ts: retains a second inline narrowing runtime");
}
for (const phrase of [
  "WEB_RUNTIME_FOUNDATION_SHARED_ERROR",
  "host.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE)",
  // WB-D1: `hostErrorTrace` is in this list because the foundation's report
  // channel calls it, and a project build imports the error runtime instead of
  // inlining it — without the name the channel a failure nobody claimed reaches
  // would not resolve.
  "errorApply as __velarErrorApply, errorCode as __velarErrorCode, hostErrorTrace as __velarHostErrorTrace, isError as __velarIsError, normalizeError as __velarNormalizeError",
  // No closing paren: the call takes further arguments now (the Look keyword table),
  // and matching the whole call made this gate fail on an added argument rather than
  // on a real boundary break.
  "webRuntime(WEB_RUNTIME_FOUNDATION_SHARED_ERROR",
]) {
  if (!webEmitterSource.includes(phrase)) failures.push(`packages/web/src/emitter.ts: project Web runtime does not share error normalization '${phrase}'`);
}
for (const phrase of [
  "const __velarJsonNativeArray = globalThis.Array",
  "const __velarJsonNativeSet = globalThis.Set",
  "const __velarJsonGetOwnPropertyDescriptor =",
  "const __velarJsonReflectOwnKeys = globalThis.Reflect.ownKeys",
  "const __velarJsonSetDelete =",
  "const __velarJsonRegExpTest =",
  "function __velarJsonApply(operation, receiver, arguments_, label)",
]) {
  if (!compilerJsonRuntimeSource.includes(phrase)) failures.push(`packages/compiler: strict JSON runtime is missing captured host operation '${phrase}'`);
}
if (/\b(?:Array|Set|Object|Number|String|Math|Reflect|Symbol)\.(?:isArray|isFinite|isInteger|max|getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf|create|defineProperty|ownKeys|for)\s*\(|\bnew (?:Array|Set|TypeError|RangeError)\b|\.(?:has|add|delete|charCodeAt|test|sort|call)\s*\(/u.test(compilerJsonRuntimeSource)) {
  failures.push("packages/compiler/runtime/json.js: strict JSON bypasses its captured validation, snapshot, reflection, text, or Error ABI");
}
for (const phrase of [
  "const __velarTextNativeArray = globalThis.Array",
  "const __velarTextNativeString = globalThis.String",
  "const __velarTextReflectApply = __velarTextGetOwnPropertyDescriptor",
  "const __velarTextNumberIsSafeInteger = __velarTextGetOwnPropertyDescriptor",
  "const __velarTextMathFloor = __velarTextGetOwnPropertyDescriptor",
  "function __velarTextCall(operation, receiver, arguments_)",
  "const output = new __velarTextNativeArray(count)",
  "return __velarTextCall(__velarNativeStringRepeat, value, [count])",
]) {
  if (!compilerTextRuntimeSource.includes(phrase)) failures.push(`packages/compiler: text method runtime is missing captured host operation '${phrase}'`);
}
if (/\b(?:Array|String|Number|Math|Object|Reflect)\.(?:from|isArray|isSafeInteger|isInteger|floor|max|min|getOwnPropertyDescriptor)\s*\(|\bnew (?:Array|TypeError|RangeError)\b|\.call\s*\(|for \(const character of/u.test(compilerTextRuntimeSource)) {
  failures.push("packages/compiler/runtime/text.js: String methods bypass the captured Array, text, numeric, Reflect, iterator, or Error ABI");
}
for (const phrase of [
  "const __velarNumberNativeMath = globalThis.Math",
  "const __velarNumberNativeNumber = globalThis.Number",
  "const __velarNumberReflectApply = __velarNumberGetOwnPropertyDescriptor",
  "const __velarNumberMathAbs = __velarNumberGetOwnPropertyDescriptor",
  "const __velarNumberIsSafeInteger = __velarNumberGetOwnPropertyDescriptor",
  "const __velarNativeNumberToFixed = __velarNumberGetOwnPropertyDescriptor",
  "function __velarNumberCall(operation, receiver, arguments_)",
  "throw new __velarNumberNativeRangeError",
]) {
  if (!compilerNumberRuntimeSource.includes(phrase)) failures.push(`packages/compiler: Number method runtime is missing captured host operation '${phrase}'`);
}
if (/\b(?:Math\.(?:abs|round|floor|ceil)|Number\.isSafeInteger|Object\.getOwnPropertyDescriptor|Reflect\.apply)\s*\(|\bNumber\.prototype\b|\bnew (?:TypeError|RangeError)\b|\.call\s*\(/u.test(compilerNumberRuntimeSource)) {
  failures.push("packages/compiler/runtime/number.js: Number methods bypass the captured Math, Number, Reflect, or Error ABI");
}
// D114 CO-U4b merged the two inline pushes into one, so the phrase pins both
// runtimes rather than only the Number half it used to name.
if (!compilerEmitterSource.includes("helpers.push(VELAR_TEXT_METHOD_RUNTIME, VELAR_NUMBER_METHOD_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: String or Number receiver methods bypass the compiler-owned primitive runtimes");
}
const primitiveMethodExports = [
  "stringSize", "stringTrim", "stringUpper", "stringLower", "stringSlice", "stringChar", "stringHas", "stringIndex",
  "stringCount", "stringStartsWith", "stringEndsWith", "stringSplit", "stringReplace", "stringReplaceAll",
  "stringPadStart", "stringPadEnd", "stringRepeat", "numberAbs", "numberRound", "numberFloor", "numberCeil", "numberToFixed",
];
for (const name of primitiveMethodExports) {
  if (!VELAR_PRIMITIVE_METHOD_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/runtime/primitive-exports.js: shared primitive runtime does not export '${name}'`);
  }
}
for (const phrase of ["VELAR_TEXT_METHOD_RUNTIME", "VELAR_NUMBER_METHOD_RUNTIME"]) {
  if (!runtimeComposition("VELAR_PRIMITIVE_METHOD_MODULE_SOURCE").includes(phrase)) {
    failures.push(`packages/compiler/runtime/manifest.json: shared primitive runtime is missing '${phrase}'`);
  }
}
for (const phrase of [
  "this.requiredRuntimeModules.add(VELAR_PRIMITIVE_METHOD_MODULE)",
  '["stringSize", "__velarStringSize"]',
  '["numberToFixed", "__velarNumberToFixed"]',
  "from ${JSON.stringify(VELAR_PRIMITIVE_METHOD_MODULE)}",
]) {
  if (!compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: project primitive methods do not use the shared runtime '${phrase}'`);
}
for (const phrase of [
  "const __velarCollectionNativeArray = globalThis.Array",
  "const __velarCollectionNativeMap = globalThis.Map",
  "const __velarCollectionNativeSet = globalThis.Set",
  "const __velarCollectionReflectApply = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionMapSize = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionSetSize = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionMapIteratorNext = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionSetIteratorNext = __velarCollectionGetOwnPropertyDescriptor",
  "function __velarCollectionHostCall(operation, receiver, arguments_)",
  "const __velarCollectionListNativeNumber = globalThis.Number",
  "const __velarCollectionListNativeMath = globalThis.Math",
  "const __velarCollectionListNativeRangeError = globalThis.RangeError",
  "const __velarCollectionListDefinePropertyOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionListJoinOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionListSortOperation = __velarCollectionGetOwnPropertyDescriptor",
  "function __velarCollectionListHostJoin(value, separator)",
  "function __velarCollectionListHostSort(value, compare)",
  "const __velarCollectionSetMapNativeRangeError = globalThis.RangeError",
  "const __velarCollectionSetAddOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionSetValuesOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionMapGetOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionMapSetOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionMapEntriesOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionSetMapMapIteratorNext = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionSetMapSetIteratorNext = __velarCollectionGetOwnPropertyDescriptor",
  "function __velarCollectionSetMapMapNext(iterator)",
  "function __velarCollectionSetMapSetNext(iterator)",
  "const __velarCollectionRecordNativeRangeError = globalThis.RangeError",
  "const __velarCollectionRecordOwnNamesOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionRecordDefinePropertyOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionRecordDeletePropertyOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarCollectionRecordFreezeOperation = __velarCollectionGetOwnPropertyDescriptor",
  "function __velarCollectionRecordDeleteProperty(value, key)",
  "function __velarCollectionRecordFreeze(value)",
]) {
  if (!compilerCollectionRuntimeSource.includes(phrase)) failures.push(`packages/compiler: collection identity runtime is missing captured host operation '${phrase}'`);
}
if (/\b(?:Array\.isArray|Object\.(?:getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf)|Reflect\.(?:apply|ownKeys))\s*\(|\b(?:Map|Set)\.prototype\b|\bnew (?:Map|Set|TypeError)\b|\.call\s*\(/u.test(compilerCollectionRuntimeSource)) {
  failures.push("packages/compiler/runtime/collection-host-*.js: collection identity or runtime-Type traversal bypasses its captured Array, Map, Set, Object, Reflect, iterator, or Error ABI");
}
const runtimeCollectionTypeSource = compilerTypeValidationRuntimeSource;
if (!compilerEmitterSource.includes("helpers.push(VELAR_COLLECTION_IDENTITY_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: collection identities bypass the compiler-owned runtime");
}
for (const name of VELAR_COLLECTION_HOST_EXPORTS) {
  if (!VELAR_COLLECTION_HOST_MODULE_SOURCE.includes(`  ${name},`)) {
    failures.push(`packages/compiler/runtime/collection-host-exports.js: shared collection host does not export '${name}'`);
  }
}
for (const phrase of [
  "VELAR_COLLECTION_HOST_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_COLLECTION_HOST_MODULE)",
  "VELAR_COLLECTION_HOST_EXPORTS.filter((name) => directUses.has(name))",
  "if (imports.length > 0)",
  "from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)}",
]) {
  const source = phrase === "VELAR_COLLECTION_HOST_MODULE_SOURCE" ? compilerGeneratedRuntimeSource : compilerEmitterSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: project collection-host contract is missing '${phrase}'`);
}
if (!runtimeComposition("VELAR_COLLECTION_HOST_MODULE_SOURCE").includes("VELAR_COLLECTION_IDENTITY_RUNTIME")
  || !runtimeComposition("VELAR_COLLECTION_HOST_MODULE_SOURCE").includes("VELAR_COLLECTION_LIST_RUNTIME")
  || !runtimeComposition("VELAR_COLLECTION_HOST_MODULE_SOURCE").includes("VELAR_COLLECTION_SET_MAP_RUNTIME")
  || !runtimeComposition("VELAR_COLLECTION_HOST_MODULE_SOURCE").includes("VELAR_COLLECTION_RECORD_RUNTIME")) {
  failures.push("packages/compiler/runtime/manifest.json: shared collection host does not compose every canonical host fragment");
}
for (const name of VELAR_COLLECTION_LOWERING_EXPORTS) {
  if (!VELAR_COLLECTION_LOWERING_MODULE_SOURCE.includes(`  ${name},`)) {
    failures.push(`packages/compiler/runtime/collection-lowering-exports.js: shared collection lowering runtime does not export '${name}'`);
  }
}
if (VELAR_COLLECTION_LOWERING_DEPENDENCIES.length !== 2
  || !VELAR_COLLECTION_LOWERING_DEPENDENCIES.includes(VELAR_COLLECTION_HOST_MODULE)
  || !VELAR_COLLECTION_LOWERING_DEPENDENCIES.includes(VELAR_REACTIVE_BRIDGE_MODULE)) {
  failures.push("packages/compiler/src/runtime-modules.ts: collection lowering dependency closure is incomplete");
}
if (!VELAR_COLLECTION_LOWERING_RUNTIME.includes("__velarReactiveCollectionTrigger(value, __velarReactiveIterateKey, true, true, null, true)")) {
  failures.push("packages/compiler/runtime/collection-lowering.js: keyed collection clear must invalidate every tracked key");
}
for (const phrase of [
  "VELAR_COLLECTION_LOWERING_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_COLLECTION_LOWERING_MODULE)",
  "VELAR_COLLECTION_LOWERING_EXPORTS.filter",
  "...imports.map",
  "from ${JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE)}",
  "helpers.push(VELAR_COLLECTION_LOWERING_RUNTIME)",
]) {
  const source = phrase === "VELAR_COLLECTION_LOWERING_MODULE_SOURCE" ? compilerGeneratedRuntimeSource : compilerEmitterSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: project collection-lowering contract is missing '${phrase}'`);
}
for (const phrase of [
  "private needsDirectCollectionInfrastructure = false",
  "const generatedIdentifiers = javaScriptIdentifiers",
  "const usesGeneratedName = (name: string): boolean => generatedIdentifiers.has(name)",
  "function javaScriptIdentifiers(sources: readonly string[]): ReadonlySet<string>",
  ".filter(([, local]) => usesGeneratedName(local!))",
  "VELAR_COLLECTION_LOWERING_EXPORTS.filter((name) => usesGeneratedName(name)",
  "this.sharedRuntimeModules ? needsDirectCollectionInfrastructure : this.needsCollectionHelpers",
  "if (needsDirectCollectionInfrastructure && this.sharedRuntimeModules)",
]) {
  if (!compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: collection dependency ownership is missing '${phrase}'`);
}
for (const phrase of [
  '() => (${this.host.emitMappedExpression(value)})',
  '() => (${this.host.emitMappedExpression(property.value)})',
]) {
  if (!compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: controlled collection thunk does not parenthesize '${phrase}'`);
}
if (!VELAR_COLLECTION_LOWERING_MODULE_SOURCE.includes(`from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)}`)
  || !VELAR_COLLECTION_LOWERING_MODULE_SOURCE.includes(`from ${JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE)}`)) {
  failures.push("packages/compiler/runtime/collection-lowering-imports.js: shared collection algorithms bypass their host or reactive runtime dependencies");
}
if (!compilerEmitterSource.includes("helpers.push(VELAR_COLLECTION_TYPE_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: runtime collection Types bypass the compiler-owned traversal runtime");
}
if (!compilerEmitterSource.includes("helpers.push(VELAR_TYPE_VALIDATION_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: runtime data Types bypass the compiler-owned validation runtime");
}
const runtimeTypeExports = [
  "registerRuntimeType", "validationState", "validationSet", "validationWeakMapGet", "validationWeakMapSet",
  "validationWeakMapDelete", "validationSetHas", "validationSetAdd", "validationSetDelete", "validationSetSize",
  "validationIsArray", "validationOwnDescriptor", "validationIsInstance", "validationIsPromise", "validationFreeze",
  "listTypeIs", "setTypeIs", "mapTypeIs", "recordTypeIs", "ValidationError",
];
for (const name of runtimeTypeExports) {
  if (!VELAR_TYPE_VALIDATION_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/runtime/type-validation-exports.js: shared runtime-Type module does not export '${name}'`);
  }
}
for (const phrase of [
  "VELAR_TYPE_VALIDATION_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_TYPE_VALIDATION_MODULE)",
  '["registerRuntimeType", "__velarRegisterRuntimeType"]',
  '["recordTypeIs", "__velarRecordTypeIs"]',
  "from ${JSON.stringify(VELAR_TYPE_VALIDATION_MODULE)}",
]) {
  const source = phrase === "VELAR_TYPE_VALIDATION_MODULE_SOURCE" ? compilerGeneratedRuntimeSource : compilerEmitterSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: project runtime-Type contract is missing '${phrase}'`);
}
if (!compilerEmitterSource.includes("helpers.push(VELAR_COLLECTION_LIST_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: ordinary List helpers bypass the compiler-owned List host runtime");
}
if (!compilerEmitterSource.includes("helpers.push(VELAR_COLLECTION_SET_MAP_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: ordinary Set/Map helpers bypass the compiler-owned Set/Map host runtime");
}
if (!compilerEmitterSource.includes("helpers.push(VELAR_COLLECTION_RECORD_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: ordinary Record helpers bypass the compiler-owned Record host runtime");
}
if (/\b(?:Array\.isArray|Object\.(?:getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols)|Reflect\.(?:getOwnPropertyDescriptor|ownKeys))\s*\(|\b(?:Map|Set)\.prototype\b|\.call\s*\(|for \(const /u.test(runtimeCollectionTypeSource)) {
  failures.push("packages/compiler/src/emitter.ts: runtime collection Type validation bypasses the captured collection identity and iterator ABI");
}
for (const phrase of [
  "const __velarValidationNativeWeakMap = globalThis.WeakMap",
  "const __velarValidationNativeSet = globalThis.Set",
  "const __velarValidationNativePromise = globalThis.Promise",
  "const __velarValidationWeakMapGetOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarValidationSetSizeOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarValidationFunctionHasInstanceOperation = __velarCollectionGetOwnPropertyDescriptor",
  "const __velarValidationFreezeOperation = __velarCollectionGetOwnPropertyDescriptor",
  "function __velarValidationWeakMapGet(value, key)",
  "function __velarValidationSetSize(value)",
  "function __velarValidationOwnDescriptor(value, key)",
  "function __velarValidationIsInstance(value, constructor)",
  "function __velarValidationIsPromise(value)",
  "function __velarValidationFreeze(value)",
]) {
  if (!compilerTypeValidationRuntimeSource.includes(phrase)) failures.push(`packages/compiler: runtime Type validation is missing captured host operation '${phrase}'`);
}
if (/\b(?:Array\.isArray|Object\.(?:getOwnPropertyDescriptor|freeze)|Reflect\.apply)\s*\(|\b(?:WeakMap|Set)\.prototype\b|\bnew (?:WeakMap|Set|TypeError)\b|instanceof Promise|\.(?:get|set|has|add|delete)\s*\(/u.test(compilerTypeValidationRuntimeSource)) {
  failures.push("packages/compiler/runtime/type-validation.js: runtime Type graph traversal bypasses its captured WeakMap, Set, Promise, reflection, freeze, or Error ABI");
}
const emittedRuntimeTypeDeclarationSource = `${compilerEmitValidatorSource.slice(compilerEmitValidatorSource.indexOf("  emitTypeDeclaration("))}\n${compilerEmitTypeCheckSource}`;
if (/\b(?:Array\.isArray|Object\.(?:getOwnPropertyDescriptor|freeze)|Boolean)\s*\(|\bnew (?:WeakMap|Set|TypeError)\b|\binstanceof\b|__state\.active\.(?:get|set|delete)\s*\(|__active(?:\?|)\.(?:has|add|delete)\s*\(/u.test(emittedRuntimeTypeDeclarationSource)
  || !emittedRuntimeTypeDeclarationSource.includes("__velarValidationState()")
  || !emittedRuntimeTypeDeclarationSource.includes("__velarValidationOwnDescriptor")
  || !emittedRuntimeTypeDeclarationSource.includes("__velarValidationFreeze")) {
  failures.push("packages/compiler/src/emitter.ts: generated type, alias, or enum validation bypasses the captured runtime Type validation ABI");
}
const emittedListValidationSource = VELAR_COLLECTION_LOWERING_RUNTIME.slice(VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function __velarValidateDenseList"), VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function* __velarReactiveListIterator"))
  + VELAR_COLLECTION_LOWERING_RUNTIME.slice(VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function __velarCopyList"), VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function __velarRecordFields"));
const emittedListConstructionSource = VELAR_COLLECTION_LOWERING_RUNTIME.slice(VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function __velarCreateList(parts)"), VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function __velarCreateSet"));
const emittedListReceiverSource = VELAR_COLLECTION_LOWERING_RUNTIME.slice(VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function __velarCollectionSlice"), VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function __velarSetAdd"));
const emittedListSetIndexStart = VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function __velarSetIndex");
const emittedListIndexSource = VELAR_COLLECTION_LOWERING_RUNTIME.slice(VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function __velarIndex"), VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("  if (!__velarIsRecord(value)", VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("function __velarIndex")))
  + VELAR_COLLECTION_LOWERING_RUNTIME.slice(emittedListSetIndexStart, VELAR_COLLECTION_LOWERING_RUNTIME.indexOf("  if (!__velarIsRecord(value)", emittedListSetIndexStart));
const emittedListOperationSource = emittedListValidationSource + emittedListConstructionSource + emittedListReceiverSource;
if (/\b(?:Array\.(?:isArray|prototype)|Object\.(?:getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|defineProperty|is)|Number\.(?:isInteger|isNaN|isFinite)|Math\.(?:max|min))\b|\bnew (?:Array|TypeError|RangeError)\b|\.(?:push|map)\s*\(|for \(const /u.test(emittedListOperationSource)
  || /\b(?:Array\.isArray|Number\.isInteger|Object\.is)\s*\(/u.test(emittedListIndexSource)) {
  failures.push("packages/compiler: List validation, construction, indexing, or receiver methods bypass the captured List host ABI");
}
for (const phrase of [
  "function __velarIndex(value, index)",
  "function __velarOptionalIndex(value, index)",
  "function __velarSetIndex(value, index, next)",
]) {
  if (!VELAR_COLLECTION_LOWERING_RUNTIME.includes(phrase)) failures.push(`packages/compiler/runtime/collection-lowering.js: canonical index runtime is missing '${phrase}'`);
}
// D114 CO-U4b: `IndexError` moved out of the List lowering's own file into a
// chunk of its own, because `String.char` raises it too and a module may inline
// the String receiver methods without inlining a single List operation. The
// class is declared exactly once — there — and every consumer reaches that one
// declaration: the List lowering composes it, the primitives module imports it
// from the module that publishes it, and the inline String path emits it exactly
// when the List lowering that would otherwise carry it is absent.
if (!VELAR_INDEX_ERROR_RUNTIME.includes("class __VelarIndexError extends __velarIndexErrorNativeRangeError")) {
  failures.push("packages/compiler/runtime/index-error.js: canonical index runtime is missing 'class __VelarIndexError'");
}
for (const [name, source] of [
  ["collection-lowering.js", constantFileSource("compiler", "VELAR_COLLECTION_LOWERING_RUNTIME")],
  ["text.js", VELAR_TEXT_METHOD_RUNTIME],
]) {
  if (source.includes("class __VelarIndexError")) {
    failures.push(`packages/compiler/runtime/${name}: a runtime that raises IndexError declares a second copy of the class instead of reaching the one`);
  }
}
if (!runtimeComposition("VELAR_COLLECTION_LOWERING_RUNTIME").includes("VELAR_INDEX_ERROR_RUNTIME")) {
  failures.push("packages/compiler/runtime/manifest.json: the canonical index runtime no longer carries the class every List position raises");
}
if (!VELAR_COLLECTION_LOWERING_MODULE_SOURCE.includes("  __VelarIndexError,")) {
  failures.push("packages/compiler/runtime/collection-lowering-exports.js: the shared collection-lowering module does not publish '__VelarIndexError'");
}
// The String half of the same class: every String *position* guard raises it,
// the project module imports it from the one module that publishes it, and the
// standalone module emits the class beside the runtime that raises it. D114
// CO-U4c: `char`'s non-integer index joined its out-of-range one here, and with
// it the two siblings that fail the same way — `slice`'s positions and
// `index`'s start. A count is not a position, so `repeat`, `padStart` and
// `padEnd` keep the RangeError `List.repeat` raises for the same argument.
for (const guard of [
  'throw new __VelarIndexError("String.char index ',
  'throw new __VelarIndexError("String.slice positions must be integers")',
  'throw new __VelarIndexError("String.index start must be an integer")',
]) {
  if (!VELAR_TEXT_METHOD_RUNTIME.includes(guard)) {
    failures.push(`packages/compiler/runtime/text.js: a String position guard raises something other than the nameable IndexError (${guard})`);
  }
}
if (/__velarTextNativeTypeError\("String\.(?:char|slice|index) /u.test(VELAR_TEXT_METHOD_RUNTIME)) {
  failures.push("packages/compiler/runtime/text.js: a String position guard still raises the host TypeError no `is IndexError` can name");
}
if (!VELAR_PRIMITIVE_METHOD_MODULE_SOURCE.includes(`import { __VelarIndexError } from ${JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE)};`)) {
  failures.push("packages/compiler/runtime/primitive-imports.js: the shared primitive runtime does not import __VelarIndexError from the module that publishes it");
}
// And every other module that embeds that runtime has to supply the class too.
// `velar/text` and `velar/browser` embed the String receiver methods for their
// host primitives and route no `char` call through them, so each carries the
// class rather than importing it; the module a program's `char` actually calls
// imports the published one, because `is IndexError` is an `instanceof`. What
// no module may do is name the class and neither declare nor import it — which
// is what naming it in `text.js` did to those two until this rule existed.
for (const extensions of [[], [velarWebCompilerExtension], [velarNodeCompilerExtension], [velarServerCompilerExtension], [velarDesktopCompilerExtension]]) {
  for (const [name, source] of standardModuleSources(extensions)) {
    if (!source.includes("__VelarIndexError")) continue;
    if (source.includes("class __VelarIndexError") || /import\s*\{[^}]*__VelarIndexError/u.test(source)) continue;
    failures.push(`${name}: names __VelarIndexError without declaring or importing it, so the reference is unbound at run time`);
  }
}
if (!standardModulesSource.includes(`[VELAR_PRIMITIVE_METHOD_MODULE, [VELAR_COLLECTION_LOWERING_MODULE]]`)) {
  failures.push("packages/core/src/index.ts: the primitive runtime module does not declare its dependency on the collection-lowering module");
}
if (!compilerEmitterSource.includes("if (!this.needsCollectionHelpers) helpers.push(VELAR_INDEX_ERROR_RUNTIME);")) {
  failures.push("packages/compiler/src/emitter.ts: the inlined String receiver methods are emitted without the IndexError class they raise");
}
if (compilerEmitterSource.includes('"class __VelarIndexError') || compilerEmitterSource.includes('"function __velarIndex(value, index)')) {
  failures.push("packages/compiler/src/emitter.ts: project consumers retain a second inline index runtime owner");
}
const emittedCollectionHelperSource = VELAR_COLLECTION_LOWERING_RUNTIME;
if (/\b(?:Map|Set)\.prototype\b|\bnew (?:Map|Set)\b|Reflect\.getOwnPropertyDescriptor\s*\(\s*(?:Map|Set)\.prototype|Object\.getPrototypeOf\s*\(|\[\.\.\.(?:Map|Set)\.prototype/u.test(emittedCollectionHelperSource)) {
  failures.push("packages/compiler/src/emitter.ts: Set/Map construction, traversal, snapshots, or receiver methods bypass the captured Set/Map host ABI");
}
if (/Reflect\.deleteProperty\s*\(|Object\.freeze\s*\(|for \(const field|\.values\(\)|\.map\s*\(/u.test(emittedCollectionHelperSource)
  || !VELAR_COLLECTION_LOWERING_RUNTIME.includes("__velarCollectionRecordGetOwnPropertyDescriptor(value, index)")) {
  failures.push("packages/compiler: Record validation, indexing, traversal, snapshots, or receiver methods bypass the captured Record host ABI");
}
const recordLoweringStart = compilerEmitterSource.indexOf('"function __velarSetRecordField');
const objectBindingStart = compilerEmitterSource.indexOf('"function __velarRequireBindingObject');
const listBindingStart = compilerEmitterSource.indexOf('"function __velarRequireBindingList');
const emittedRecordLoweringSource = compilerEmitterSource.slice(recordLoweringStart, compilerEmitterSource.indexOf("      this.selectRecordConstructionHelpers(", recordLoweringStart));
const emittedObjectBindingSource = compilerEmitterSource.slice(objectBindingStart, compilerEmitterSource.indexOf("    if (this.needsListBindingHelpers)", objectBindingStart));
const emittedListBindingSource = compilerEmitterSource.slice(listBindingStart, compilerEmitterSource.indexOf("    if (this.needsNumberHelper)", listBindingStart));
if (/\b(?:Array\.isArray|Object\.(?:prototype|getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|defineProperty)|Reflect\.apply)\b|\.call\s*\(|for \(const|new (?:TypeError|RangeError)/u.test(emittedRecordLoweringSource)
  || !emittedRecordLoweringSource.includes("__velarCollectionRecordDefineProperty")
  || !emittedRecordLoweringSource.includes("__velarCollectionRecordOwnNames")) {
  failures.push("packages/compiler/src/emitter.ts: Record literal or spread lowering bypasses the captured Record/List host ABI");
}
if (/\b(?:Array\.isArray|Object\.(?:getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|defineProperty)|Reflect\.apply)\b|for \(const|new (?:TypeError|RangeError)/u.test(emittedObjectBindingSource)
  || !emittedObjectBindingSource.includes("__velarCollectionRecordDefineProperty")
  || !emittedObjectBindingSource.includes("__velarCollectionRecordOwnNames")) {
  failures.push("packages/compiler/src/emitter.ts: object binding lowering bypasses the captured Record/List host ABI");
}
if (/\b(?:Array\.isArray|Object\.getOwnPropertyDescriptor|Reflect\.apply)\b|\.push\s*\(|for \(const|new (?:TypeError|RangeError)/u.test(emittedListBindingSource)
  || !emittedListBindingSource.includes("new __velarCollectionNativeArray")
  || !emittedListBindingSource.includes("__velarCollectionListGetOwnPropertyDescriptor")) {
  failures.push("packages/compiler/src/emitter.ts: List binding lowering bypasses the captured List host ABI");
}
const emittedStructuralMatchSource = compilerEmitMatchingSource.slice(compilerEmitMatchingSource.lastIndexOf('case "MatchListPattern"'));
if (/\b(?:Array\.isArray|Object\.(?:getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|defineProperty)|Reflect\.apply)\b/u.test(emittedStructuralMatchSource)
  || emittedStructuralMatchSource.includes('lines.push(`${indentation}for (const')
  || !emittedStructuralMatchSource.includes("__velarCollectionListGetOwnPropertyDescriptor")
  || !emittedStructuralMatchSource.includes("__velarCollectionListDefineProperty")
  || !emittedStructuralMatchSource.includes("__velarCollectionRecordGetOwnPropertyDescriptor")
  || !emittedStructuralMatchSource.includes("__velarCollectionRecordDefineProperty")) {
  failures.push("packages/compiler/src/emitter.ts: structural match lowering bypasses the captured Record/List host ABI");
}
for (const phrase of [
  "const __velarTextArrayJoin = __velarTextGetOwnPropertyDescriptor",
  "const __velarTextStringNormalize = __velarTextGetOwnPropertyDescriptor",
  "const nativeRegExpExec = __velarTextGetOwnPropertyDescriptor",
  "function __velarTextRegexReplace(value, pattern, replacement)",
  "function __velarTextRegexSplit(value, pattern, limit)",
  "export function utf8Size(value)",
  "return __velarTextCall(__velarTextObjectFreeze",
  "value = __velarTextCall(nativeStringReplaceAll, value",
]) {
  if (!coreTextModuleSource.includes(phrase)) failures.push(`packages/core/runtime/text.js: velar/text is missing captured host operation '${phrase}'`);
}
if (!runtimeComposition("VELAR_CORE_TEXT_MODULE_SOURCE", "core").includes("VELAR_UTF8_RUNTIME")) {
  failures.push("packages/core/runtime/manifest.json: velar/text must compose the compiler-owned UTF-8 runtime rather than restate it");
}
if (/\b(?:Array|String|Number|Math|Object|Reflect)\.(?:isArray|isSafeInteger|isInteger|floor|max|min|getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf|create|freeze)\s*\(|\b(?:String|RegExp)\.prototype\b|\bnew (?:Array|Set|TypeError|RangeError)\b|\.(?:call|push|map|join|slice|replace|replaceAll|split|normalize|toLowerCase|toUpperCase|match)\s*\(|for \(const /u.test(coreTextModuleSource)) {
  failures.push("packages/core/runtime/text.js: velar/text bypasses its captured Array, text, RegExp, reflection, numeric, iterator, or Error ABI");
}
for (const phrase of [
  "const __velarTypeNativeWeakSet = globalThis.WeakSet",
  "const __velarTypeReflectApply =",
  "const __velarTypeWeakSetHas =",
  "const __velarTypeWeakSetAdd =",
  "function __velarTypeCall(operation, receiver, arguments_)",
]) {
  if (!compilerTypeRegistryRuntimeSource.includes(phrase)) failures.push(`packages/compiler: runtime Type registry is missing captured host operation '${phrase}'`);
}
if (/\b(?:WeakSet|Object|Reflect|Symbol)\.(?:has|add|getOwnPropertyDescriptor|defineProperty|for|apply)\s*\(|\bnew (?:WeakSet|TypeError)\b|\.call\s*\(/u.test(compilerTypeRegistryRuntimeSource)) {
  failures.push("packages/compiler/runtime/type-registry.js: runtime Type identity bypasses its captured WeakSet, registry, Reflect, or Error ABI");
}
for (const phrase of [
  "const __velarDeepNativeWeakSet = globalThis.WeakSet",
  "const __velarDeepMapIteratorNext =",
  "const __velarDeepSetIteratorNext =",
  "const __velarDeepWeakSetDelete =",
  "function __velarDeepCall(operation, receiver, arguments_)",
]) {
  if (!coreTestDisplayRuntimeSource.includes(phrase)) failures.push(`packages/core/runtime/test-display.js: the test display runtime is missing captured graph operation '${phrase}'`);
}
if (!coreJsonModuleSource.includes("__velarJsonApply(__velarJsonArraySort, keys")) failures.push("packages/core/runtime/json.js: velar/json stableStringify must consume the compiler-owned captured JSON sort ABI");
if (/\b(?:Array|Map|Set|WeakSet|Object|Reflect|Symbol)\.(?:isArray|entries|values|has|get|sort|getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf|for)\s*\(|\bnew (?:WeakSet|TypeError|RangeError)\b|\.(?:has|add|delete|entries|values|sort|every|call)\s*\(/u.test(coreTestDisplayRuntimeSource + "\n" + coreJsonModuleSource)) {
  failures.push("packages/core/runtime/json.js and test-display.js: velar/json or the test display runtime bypasses its captured graph, order, reflection, Type, or Error ABI");
}
// D114 S3: `velar/collections` retired into List members; `range` is the one
// name it published that was never a List operation, so it kept its captured
// numeric ABI and moved into a compiler-owned runtime module.
for (const phrase of [
  "const __velarRangeNativeArray = globalThis.Array",
  "const __velarRangeNativeNumber = globalThis.Number",
  "const __velarRangeNativeMath = globalThis.Math",
  "const __velarRangeNumberIsFinite = __velarRangeHostOperation",
  "const __velarRangeNumberIsSafeInteger = __velarRangeHostOperation",
  "const __velarRangeMathFloor = __velarRangeHostOperation",
  "const __velarRangeObjectDefineProperty = __velarRangeHostOperation",
  "function __velarRangeCall(operation, receiver, arguments_)",
]) {
  if (!VELAR_RANGE_RUNTIME.includes(phrase)) failures.push(`packages/compiler/runtime/range.js: range is missing captured host operation '${phrase}'`);
}
if (/\b(?:Array|Number|Math|Object|Reflect)\.(?:from|isArray|isFinite|isNaN|isSafeInteger|max|min|floor|freeze|is|defineProperty|apply)\s*\(|\bnew (?:Array|TypeError|RangeError)\b|\.(?:map|filter|slice|push|call)\s*\(/u.test(VELAR_RANGE_RUNTIME)) {
  failures.push("packages/compiler/runtime/range.js: range bypasses its captured Array, numeric, Reflect, or Error ABI");
}
if (!VELAR_RANGE_MODULE_SOURCE.includes("__velarRange as range")) {
  failures.push("packages/compiler/runtime/range-exports.js: the range runtime module does not publish the prelude entry point");
}
for (const phrase of [
  "const __velarMathNativeMath = globalThis.Math",
  "const __velarMathNativeNumber = globalThis.Number",
  "const __velarMathApply = __velarMathGetOwnPropertyDescriptor",
  "const __velarMathRandom = __velarMathHostOperation",
  "const __velarMathNumberIsSafeInteger = __velarMathHostOperation",
  "function __velarMathCall(operation, arguments_)",
  "__velarMathCall(__velarMathRandom, [])",
]) {
  if (!coreMathModuleSource.includes(phrase)) failures.push(`packages/core/runtime/math.js: velar/math is missing captured host operation '${phrase}'`);
}
if (/\b(?:Math|Number)\.(?:abs|acos|asin|atan|atan2|cbrt|cos|exp|floor|hypot|isFinite|isInteger|isSafeInteger|log|log10|log2|max|min|pow|random|sign|sin|sqrt|tan|trunc)\s*\(|\bnew (?:TypeError|RangeError)\s*\(/u.test(coreMathModuleSource)) {
  failures.push("packages/core/runtime/math.js: velar/math bypasses its captured numeric, random, Reflect, or Error ABI");
}
for (const phrase of [
  "const __velarUrlNativeUrl = globalThis.URL",
  "const __velarUrlNativeSearchParams = globalThis.URLSearchParams",
  "const __velarUrlHref = __velarUrlHostAccessor",
  "const __velarUrlSetSearch = __velarUrlHostAccessor",
  "const __velarUrlSearchIteratorNext = __velarUrlInheritedOperation",
  "const __velarUrlMapIteratorNext = __velarUrlInheritedOperation",
  "const __velarUrlLocation = globalThis.location",
  "const __velarUrlLocationHrefGetter =",
  "function __velarUrlCall(operation, receiver, arguments_)",
]) {
  if (!coreUrlModuleSource.includes(phrase)) failures.push(`packages/core/runtime/url.js: velar/url is missing captured host operation '${phrase}'`);
}
if (/\b(?:URL|URLSearchParams|Map|Number|String|Object|Array|Reflect)\.(?:append|entries|freeze|getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf|isArray|isFinite|set|toString)\s*\(|\bnew (?:URL|URLSearchParams|Map|TypeError|RangeError|URIError)\b|\.(?:append|charCodeAt|endsWith|entries|set|slice|startsWith|test|toString)\s*\(/u.test(coreUrlModuleSource)) {
  failures.push("packages/core/runtime/url.js: velar/url bypasses its captured URL, query, location, collection, text, Reflect, or Error ABI");
}
for (const phrase of [
  "const __velarTimeNativeDate = globalThis.Date",
  "const __velarTimeDateNow = __velarTimeHostOperation",
  "const __velarTimePerformanceNow = __velarTimePerformance === null",
  "const __velarTimeDateTimeFormat = __velarTimeHostOperation",
  "const __velarTimeFormatGetter = __velarTimeHostGetter",
  "const __velarTimeFormatToParts = __velarTimeHostOperation",
  "const __velarTimeRegExpExec = __velarTimeHostOperation",
  "function __velarTimeCall(operation, receiver, arguments_)",
  "new __velarTimeNativeDate",
]) {
  if (!coreTimeModuleSource.includes(phrase)) failures.push(`packages/core/runtime/time.js: velar/time is missing captured host operation '${phrase}'`);
}
if (/\b(?:Date|Number|Math|Object|Array|String)\.(?:abs|freeze|getOwnPropertyDescriptor|isArray|isFinite|isInteger|isSafeInteger|now|padEnd|slice)\s*\(|\bnew (?:Date|Intl\.DateTimeFormat|Map|Set)\s*\(|\.(?:format|formatToParts|getDate|getDay|getFullYear|getHours|getMilliseconds|getMinutes|getMonth|getSeconds|getTime|getUTCDate|getUTCFullYear|getUTCHours|getUTCMilliseconds|getUTCMinutes|getUTCMonth|getUTCSeconds|setFullYear|setHours|setUTCFullYear|setUTCHours|toISOString)\s*\(/u.test(coreTimeModuleSource)) {
  failures.push("packages/core/runtime/time.js: velar/time bypasses its captured clock, date, internationalization, text, collection, or Error ABI");
}
for (const phrase of [
  "const __velarIdCrypto = globalThis.crypto",
  "let __velarIdRandomUuid = null",
  "const __velarIdRegExpTest = __velarIdGetOwnPropertyDescriptor",
  "__velarErrorApply(__velarIdRandomUuid, __velarIdCrypto",
  "__velarErrorApply(__velarIdRegExpTest, uuidPattern",
  "if (__velarIsError(failure)) throw failure",
]) {
  if (!coreIdModuleSource.includes(phrase)) failures.push(`packages/core/runtime/id.js: velar/id is missing captured host operation '${phrase}'`);
}
if ((coreIdModuleSource.match(/globalThis\.crypto/gu)?.length ?? 0) !== 1
  || /\b(?:Error\.isError|uuidPattern\.test)\s*\(|\.call\s*\(|\bnew (?:Error|TypeError)\s*\(/u.test(coreIdModuleSource)) {
  failures.push("packages/core/runtime/id.js: velar/id bypasses its captured crypto, RegExp, or Error ABI");
}
for (const phrase of [
  "const __velarLogDateNow = __velarLogGetOwnPropertyDescriptor",
  "const __velarLogPromiseThen = __velarLogGetOwnPropertyDescriptor",
  "const __velarLogMapIteratorNext = __velarLogGetOwnPropertyDescriptor",
  "const __velarLogSetIteratorNext = __velarLogGetOwnPropertyDescriptor",
  "const __velarLogConsoleTarget = __velarLogConsoleDescriptor",
  "const __velarLogConsoleMethods = __velarLogConsoleTarget",
  "function __velarLogCloneMap(value)",
  "if (error != null && !__velarIsError(error))",
  "__velarLogApply(__velarLogPromiseThen, value",
]) {
  if (!coreLogModuleSource.includes(phrase)) failures.push(`packages/core/runtime/log.js: velar/log is missing captured host operation '${phrase}'`);
}
if (/\b(?:Date\.now|Number\.isFinite|Math\.abs|Object\.fromEntries)\s*\(|\bPromise\.prototype\.then\b|\bError\.isError\s*\(|\b(?:uuidPattern|String\.prototype)\.(?:test|trim|toLowerCase)\s*\(|\b(?:ranks|sinks)\.(?:get|has|set|add|delete|size|values)\b/u.test(coreLogModuleSource)) {
  failures.push("packages/core/runtime/log.js: velar/log bypasses its captured clock, collection, Promise, text, console, or Error ABI");
}
// D50 rule 97.2 and D59 rule 141: the assertion asks the language for both of
// its comparisons -- content equality through `equals` and value equality
// through `==` -- instead of carrying a second implementation of either that
// could disagree with it. `toBe` was native `!==` until rule 141, which made it
// the one comparison in the language that answered differently from the
// language, and NaN was where that showed.
if (!coreTestModuleSource.includes(`import { __velarEquals, __velarSameValueZero } from "${VELAR_COLLECTION_LOWERING_MODULE}";`)) {
  failures.push("packages/core/runtime/test-imports.js: velar/test must import the Core __velarEquals and __velarSameValueZero rather than restate a comparison");
}
for (const phrase of [
  "if (!__velarEquals(actual, expected))",
  "if (!__velarSameValueZero(actual, expected))",
  "const __velarTestStringIncludes = __velarDeepGetOwnPropertyDescriptor",
  "const __velarTestArrayJoin = __velarDeepGetOwnPropertyDescriptor",
  "const __velarTestNumberIsSafeInteger = __velarDeepGetOwnPropertyDescriptor",
  "const __velarTestJsonStringify = __velarDeepGetOwnPropertyDescriptor",
  "const __velarTestPromiseThen = __velarDeepGetOwnPropertyDescriptor",
  "const __velarTestRegExpExec = __velarDeepGetOwnPropertyDescriptor",
  "state ??= { active: new __velarDeepNativeWeakSet()",
  "return __velarDeepCall(__velarTestFreeze",
  "promise = __velarDeepCall(__velarTestPromiseThen, result",
]) {
  if (!coreTestModuleSource.includes(phrase)) failures.push(`packages/core/runtime/test.js: velar/test is missing captured host operation '${phrase}'`);
}
if (/\b(?:Array\.isArray|Number\.isSafeInteger|JSON\.stringify|Math\.min|Object\.(?:freeze|getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf)|Reflect\.apply)\s*\(|\b(?:Map|Set|WeakSet|String|Promise|RegExp)\.prototype\b|\bnew (?:WeakSet|Error|TypeError|RangeError)\b|\.(?:call|push|join|slice|map|includes)\s*\(/u.test(coreTestModuleSource)) {
  failures.push("packages/core/runtime/test.js: velar/test bypasses its captured display, collection, text, Promise, RegExp, reflection, or Error ABI");
}
for (const phrase of [
  "const __velarWebErrorNativePromise = globalThis.Promise",
  "const __velarWebErrorOwnSymbolsOperation = Object.getOwnPropertyDescriptor",
  "const __velarWebErrorFreezeOperation = Object.getOwnPropertyDescriptor",
  "const __velarWebErrorFiniteOperation = Object.getOwnPropertyDescriptor",
  "function __velarObservePromise(value, onRejected)",
]) {
  if (!webErrorHostRuntimeSource.includes(phrase)) failures.push(`packages/web: shared error host is missing captured operation '${phrase}'`);
}
// The inlined foundation carries error normalization and the project one
// imports it, and both are the same body below that one part.
if (!runtimeComposition("WEB_RUNTIME_FOUNDATION", "web").includes("WEB_ERROR_HOST_RUNTIME")
  || !runtimeComposition("WEB_RUNTIME_FOUNDATION_SHARED_ERROR", "web").includes("WEB_ERROR_HOST_RUNTIME_BODY")
  || !runtimeComposition("WEB_RUNTIME_FOUNDATION", "web").includes("WEB_FOUNDATION_BODY")
  || !runtimeComposition("WEB_RUNTIME_FOUNDATION_SHARED_ERROR", "web").includes("WEB_FOUNDATION_BODY")
  || !runtimeComposition("WEB_OWNED_CALLBACK_RUNTIME", "web").includes("WEB_ERROR_HOST_RUNTIME")
  || !webOwnedCallbackRuntimeSource.includes("__velarObservePromise(result")
  || !webAppModuleSource.includes("__velarGraphSetInsert(__velarRuntime.errorHandlers, handler)")
  || !webAppModuleSource.includes("if (!__velarIsError(error))")) {
  failures.push("packages/web: report, velar/app, or owned callbacks do not share the captured error host ABI");
}
if (/\bPromise\.prototype\.then|\bError\.isError\s*\(|\berrorHandlers\.(?:has|add|delete)\s*\(/u.test(webOwnedCallbackRuntimeSource + "\n" + webAppModuleSource)) {
  failures.push("packages/web/runtime: Web error callbacks or velar/app bypass the captured error/handler ABI");
}
// velar/desktop, velar/window, velar/service, velar/notification,
// velar/secure-storage, velar/path, velar/fs, velar/process, velar/env and
// velar/http: every Desktop target module reaches its host through the one
// captured bridge ABI, and a new module raises this count rather than opening a
// second door.
const desktopHostRuntimeUses = runtimeManifests.get("desktop").constants
  .filter((entry) => entry.parts.some((part) => part.constant === "DESKTOP_HOST_ABI_RUNTIME")).length;
if (desktopHostRuntimeUses !== 10
  || /Object\.getOwnPropertyDescriptor\(globalThis, bridgeKey\)|\bbridge\.invoke\s*\(|globalThis\[runtimeKey\]/u.test(desktopRuntimeSourceText)) {
  failures.push("packages/desktop/runtime/manifest.json: a Desktop target module bypasses the captured host bridge ABI");
}
for (const phrase of [
  "const hostJsonStringify = JSON.stringify",
  "const hostMapGet = Map.prototype.get",
  "const hostPostMessage = hostMessageHandler.postMessage",
  "const hostTextEncode = TextEncoder.prototype.encode",
  "process.terminationHandler =",
  'case "process-owned":',
  "for pid in owner.pids { _ = Darwin.kill(-pid, SIGKILL) }",
  // The L1b host surface lives in the shell rather than in the capability
  // worker, because notifications, the keychain, the displays, the sleep/wake
  // pair and a drag gesture's pasteboard are all AppKit or Security work.
  "kSecClass as String: kSecClassGenericPassword",
  "UNUserNotificationCenter.current().delegate = self",
  "services?.registerDroppedFiles(sender.draggingPasteboard)",
  "NSWorkspace.willSleepNotification",
  "CGPreflightScreenCaptureAccess()",
]) {
  if (!desktopNativeHostSource.includes(phrase)) {
    failures.push(`packages/desktop/native/macos/VelarDesktopHost.swift: missing captured bridge operation '${phrase}'`);
  }
}
// Every L1b capability is refused by the manifest field that would grant it, in
// the generated module and again in the host. A message that stopped naming the
// declaration would still fail closed and would stop telling anyone why.
for (const [source, label, phrases] of [
  [desktopRuntimeSourceText, "packages/desktop/runtime", [
    "requires 'notifications: true' under 'desktop.permissions' in this project's velar.json",
    "declare it under 'desktop.permissions.secureStorage' in this project's velar.json",
    "declare the scheme under 'desktop.permissions.links' in this project's velar.json",
    "requires the 'dropped' root in 'desktop.permissions.files' in this project's velar.json",
  ]],
  [desktopNativeHostSource, "packages/desktop/native/macos/VelarDesktopHost.swift", [
    "require 'notifications: true' under 'desktop.permissions'",
    "declare it under 'desktop.permissions.secureStorage'",
    "declare the scheme under 'desktop.permissions.links'",
    "requires the 'dropped' root in 'desktop.permissions.files'",
  ]],
]) {
  for (const phrase of phrases) {
    if (!source.includes(phrase)) failures.push(`${label}: a Desktop capability refusal stopped naming its declaration ('${phrase}')`);
  }
}
// L2: `applyUpdate` replaces the running application with an archive, so its
// identity check is the only thing standing between a product's update flow and
// an arbitrary bundle. The rule is written twice — once in the native host that
// enforces it, once in the browser-test host a Desktop test drives — and the
// four refusals must read the same in both, including the one a development
// install always gets. A copy that drifted would be a matrix passing against a
// check nobody ships.
const desktopTestRuntimeSource = desktopFamilySource("browser-test");
for (const phrase of [
  "Desktop applyUpdate refuses to update an application signed with no Team ID.",
  "Desktop applyUpdate refuses an archive whose bundle identifier is",
  "Desktop applyUpdate refuses an archive signed with no Team ID",
  "Desktop applyUpdate refuses an archive signed by Team ID",
]) {
  for (const [source, label] of [
    [desktopNativeHostSource, "packages/desktop/native/macos/VelarDesktopHost.swift"],
    [desktopTestRuntimeSource, "packages/desktop/runtime/browser-test-*.js"],
  ]) {
    if (!source.includes(phrase)) failures.push(`${label}: the applyUpdate identity check stopped refusing '${phrase}'`);
  }
}
for (const phrase of [
  // Identity is read from the signature and the bundle, never from the archive's
  // own claim about itself, and the candidate's nested code is checked too — the
  // embedded interpreter is a second Mach-O an attacker would rather replace.
  "kSecCodeInfoTeamIdentifier as String",
  "SecStaticCodeCheckValidity(code, flags, nil)",
  "kSecCSCheckNestedCode",
  "FileManager.default.replaceItemAt(installed, withItemAt: replacement",
]) {
  if (!desktopNativeHostSource.includes(phrase)) {
    failures.push(`packages/desktop/native/macos/VelarDesktopHost.swift: the applyUpdate identity check is missing '${phrase}'`);
  }
}
// The runtime is embedded beside the executable and signed with the one
// entitlement V8 needs. Both are load-bearing and neither is visible in a test
// that only reads a manifest: a Mach-O under Contents/Resources is sealed as a
// plain resource and never signed, and a hardened runtime without allow-jit
// passes every static check and dies on the first real JavaScript.
const desktopBuildSource = await readFile(join(root, "packages", "desktop", "src", "build.ts"), "utf8");
const desktopSigningSource = await readFile(join(root, "packages", "desktop", "src", "signing.ts"), "utf8");
const desktopRuntimeSource = await readFile(join(root, "packages", "desktop", "src", "node-runtime.ts"), "utf8");
if (!desktopRuntimeSource.includes('DESKTOP_EMBEDDED_RUNTIME_PATH = "Contents/MacOS/node"')) {
  failures.push("packages/desktop/src/node-runtime.ts: the embedded runtime must live in Contents/MacOS, where codesign signs it as nested code");
}
if (!desktopSigningSource.includes("<key>com.apple.security.cs.allow-jit</key><true/>")) {
  failures.push("packages/desktop/src/signing.ts: the embedded runtime's entitlements must carry com.apple.security.cs.allow-jit");
}
// The runtime is the last nested entry and a service payload's native modules
// come before it, so the order remains leaves first: a `.node` under
// `Resources/services` is deeper in the bundle than the interpreter that loads
// it, and signing it after would seal it under a signature already applied.
if (!desktopBuildSource.includes("...services.flatMap((service) => service.nestedCode.map((path) => ({ path, entitlements: null })))")
  || !desktopBuildSource.includes("{ path: DESKTOP_EMBEDDED_RUNTIME_PATH, entitlements: runtimeEntitlements },")) {
  failures.push("packages/desktop/src/build.ts: service payload code and the embedded runtime must be signed as nested code, before the host and the bundle");
}
// The pinned runtime is the toolchain generation's, so its digest is a constant
// here rather than anything a project or a machine supplies.
if (!/sha256: "[0-9a-f]{64}"/u.test(await readFile(join(root, "packages", "desktop", "src", "config.ts"), "utf8"))) {
  failures.push("packages/desktop/src/config.ts: the embedded Node.js runtime archive must be pinned to an official SHASUMS256 digest");
}
for (const phrase of [
  'export async function selectProjectDirectory() { return optionalPath("selectProjectDirectory", 0); }',
  // Read per resolution rather than once at module load: D60 rule 153 moved
  // capability failure to the call, and the grant a project selection changes
  // is exactly the value that must not be frozen at import time.
  'const provider = __velarDesktopHostField("projectDirectoryValue")',
]) {
  if (!desktopRuntimeSourceText.includes(phrase)) {
    failures.push(`packages/desktop/runtime: missing dynamic project grant operation '${phrase}'`);
  }
}
for (const phrase of [
  'const generationBytes = new hostUint8Array(16)',
  'const complete = (owner, message) =>',
  'private var pending: [Int: PendingRequest] = [:]',
  'forwarded["owner"] = request.generation',
  'func webView(_ webView: WKWebView, didCommit navigation:',
  'worker.retire(generation: generation)',
  // A window is a document generation, and an application holds several open at
  // once, so the live set is a set. The invariant is unchanged: a request is
  // served only for a generation that is still live, and a generation is
  // retired when its document navigates away or its window closes.
  '!activeOwners.has(request.owner)',
  'activeOwners.delete(owner)',
  'registry?.retire(generation: generation)',
  // A host event stream belongs to the document that started it, exactly as a
  // window state stream does.
  'services?.retire(generation: generation)',
  // Each window's responses go back to that window's own web view; a shared one
  // would deliver another window's answer.
  'deliverBridgeResponse(encoded, generation: request.identity.generation, to: target)',
  'if (task.owner !== owner)',
  'if (request.owner !== owner)',
  'finishHttp(handle, request)',
  'pendingRequestBytes + bytes.byteLength > 128 * 1024 * 1024',
  'responseBytes > 128 * 1024 * 1024',
  'private struct BridgeTransportCancel',
  'func cancel(identity: BridgeIdentity)',
  '"hostCommand": "request-cancel"',
  'const activeRequests = new Map()',
  'function cancelActivity(activity)',
  'function setActivityCancellation(activity, cancel)',
  'if (activity.cancelled) cancel()',
  'let hostProjectDirectory = __VELAR_PROJECT_DIRECTORY__',
  'private final class ProjectDirectoryGrant',
  'let panel = NSOpenPanel()',
  'project-directory.bookmark',
  '"hostCommand": "project-root-set"',
  'async function replaceProjectRoot(path)',
  'const MAX_FILE_WATCHERS = 128',
  'const MAX_WATCH_PATHS = 4096',
  'function releaseFileWatcher(task, error = null)',
  'if (operation === "watchNext") return nextFileWatch(args, owner, activity)',
  'rebuildFileRoots()',
]) {
  if (!(desktopNativeHostSource + "\n" + desktopWorkerSource).includes(phrase)) {
    failures.push(`Desktop document generations do not preserve '${phrase}'`);
  }
}

// D57 rule 140: a standard module's runtime may not export a name its
// interface does not declare. `import js unsafe {name} from "velar/fs"` reaches
// the runtime module directly, so an export the interface never published is
// still callable — which is how retiring D57 rule 137's Blob turned out to
// need the runtime function deleted, not only the interface entry. Nothing
// enforced that; this does. The `__velar` prefix carries its own protection
// (VEL3007 refuses it at the import), so those are exempt by rule, not by list.
// Audit one extension at a time. Merging them all into a single map makes a
// later extension's module silently overwrite an earlier one's — Desktop ships
// its own velar/fs alongside Node's, so the merged form checked one of the two
// implementations and reported as though it had checked both.
//
// Three repairs, each of which had let this pass green on something:
//
//  1. What a module publishes is read from its export syntax by
//     `scripts/es-module-exports.mjs`, not matched with two regular
//     expressions. Those patterns could not see `export var`,
//     `export function*` (the spelling `packages/compiler/src/ast.ts` itself
//     uses), `export const {a} = ...`, `export default`, `export * as ns`, or
//     any export not flush against column zero, and every one of them would
//     have published a name this gate reported as absent. An export form the
//     scanner cannot read is a failure here, never a skip.
//  2. A runtime module source with no published `ModuleInterface` used to be
//     skipped in silence — ten of them per extension set, which is a tenth of
//     the module sources this loop walks passing without a word. They are
//     accounted for now instead. Rule 140 compares a runtime against its
//     interface, and these have none because they are outside the checked
//     standard-module namespace: a `import {narrow} from
//     "velar/compiler-runtime-narrowing-v1"` is VEL6003 `Unknown standard
//     module`, exactly as for a name nobody ever defined. What can be checked,
//     and is, is that every one of them is a module identity the compiler
//     declares. An eleventh source with no interface and no declared identity
//     is a module surface nobody accounted for, and it fails here.
//  3. A surface is identified by its whole source. The old key was the module
//     name and the source's byte length, so two same-named modules of equal
//     size counted as one surface: the second went unchecked while the total
//     reported otherwise. That is the merged-map defect above, rebuilt inside
//     its own repair.
const declaredInternalModules = new Set([
  VELAR_CLASS_FIELD_MODULE,
  VELAR_COLLECTION_HOST_MODULE,
  VELAR_COLLECTION_LOWERING_MODULE,
  VELAR_ERROR_NORMALIZATION_MODULE,
  VELAR_NARROWING_MODULE,
  VELAR_NODE_HOST_MODULE,
  VELAR_PRIMITIVE_METHOD_MODULE,
  VELAR_PROMISE_NORMALIZATION_MODULE,
  VELAR_RANGE_MODULE,
  VELAR_REACTIVE_BRIDGE_MODULE,
  VELAR_TYPE_VALIDATION_MODULE,
  VELAR_WORKER_MANIFEST_MODULE,
]);
let publicModuleSurfaces = 0;
let internalModuleSurfaces = 0;
const auditedSurfaces = new Map();
const accountedInternalModules = new Set();
for (const extensions of [[], [velarWebCompilerExtension], [velarNodeCompilerExtension], [velarServerCompilerExtension], [velarDesktopCompilerExtension]]) {
  const interfaces = standardModuleInterfaces(extensions);
  const sources = standardModuleSources(extensions);
  for (const [name, source] of sources) {
    const seenSources = auditedSurfaces.get(name) ?? new Set();
    if (seenSources.has(source)) continue;
    seenSources.add(source);
    auditedSurfaces.set(name, seenSources);
    const contract = interfaces.get(name);
    if (contract) {
      publicModuleSurfaces += 1;
    } else {
      internalModuleSurfaces += 1;
      accountedInternalModules.add(name);
      if (!declaredInternalModules.has(name)) {
        failures.push(`${name}: this module source publishes no interface and is not one of the compiler's declared internal runtime`
          + ` modules, so nothing here knows what it is allowed to export`);
      }
    }
    const declared = new Set();
    if (contract) {
      for (const table of [contract.exports, contract.mutableExports, contract.reactiveExports, contract.reExports,
        contract.namedTypes, contract.typeAliases, contract.enums, contract.classes, contract.extensionExports]) {
        if (table instanceof Map) for (const key of table.keys()) declared.add(key);
        else if (table && typeof table === "object") for (const key of Object.keys(table)) declared.add(key);
      }
    }
    const { names: published, unreadable } = esModuleExports(source);
    for (const problem of unreadable) {
      failures.push(`${name}: this gate cannot read an export form in the runtime module, so the names it publishes are unknown`
        + ` — ${problem.reason}: ${problem.text}`);
    }
    if (!contract) continue;
    for (const exported of published) {
      if (exported.startsWith("__velar") || declared.has(exported)) continue;
      failures.push(`${name}: runtime exports '${exported}', which the module interface does not declare — 'import js unsafe' can reach it`);
    }
  }
}
// The other direction of the same accounting: a declared internal module whose
// source stopped being emitted is a retired runtime this gate would otherwise
// keep reporting as covered.
for (const name of declaredInternalModules) {
  if (!accountedInternalModules.has(name)) {
    failures.push(`${name}: the compiler declares this internal runtime module, but no module source carries it`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  // This line used to open with `Checked ${ids.size} runtime boundary
  // operations`, counting rows of a Markdown table that no check in this file
  // is connected to: appending a row to `docs/contributing/runtime-boundary.md`
  // raised the number with nothing behind it. Binding each row to a check is
  // not available from here — 73 of the 77 rows name their proof in prose that
  // resolves to no artifact, and 50 are cited nowhere outside the ledger — so
  // making that number mean something is a change to the ledger, not to this
  // gate. Until it means something it is not reported: a number nothing
  // supports claims more coverage than no number at all.
  console.log(`Checked ${publicModuleSurfaces} standard module surfaces, ${internalModuleSurfaces} internal runtime module surfaces,`
    + ` the boundary ledger's structure, and the shared registry, strict JSON, Web DOM, host-event, browser-platform, storage-host,`
    + ` and Desktop-host ABIs`);
}

/**
 * A source family: one entry module plus every source file under the sibling
 * directories its collaborators live in, joined and read as one text.
 *
 * This is `nodeFamilySource`'s judgment applied to TypeScript instead of to a
 * runtime manifest — "a fragment split out later stays covered without editing
 * a list here". A pin that reads a file stops covering whatever leaves that
 * file, and says nothing on the day it stops: the phrase is simply somewhere
 * else, and a `doesNotMatch` over the remainder passes louder than ever. A pin
 * that reads the family survives the split, so no wave of D115 P4 has to come
 * back and edit this gate to keep the coverage it already had.
 *
 * Most of the directories named at the call sites are ones P4 has still to
 * create. A directory that does not exist contributes nothing, and the rule
 * then covers the entry alone — exactly what it covered before.
 */
async function sourceFamily(entry, ...directories) {
  const parts = [await readFile(join(root, ...entry.split("/")), "utf8")];
  for (const directory of directories) {
    const files = await sourceFiles(join(root, ...directory.split("/"))).catch(() => []);
    for (const file of files) parts.push(await readFile(file, "utf8"));
  }
  return parts.join("\n");
}

/**
 * One named top-level function's own text, from its declaration through the
 * line that closes it.
 *
 * Two rules over `cli.ts` used to be structural rather than textual — a
 * position comparison between two phrases, and a slice between two function
 * names. Neither survives a family read: positions across concatenated files
 * are file order, and the function that used to follow another one is about to
 * be in a different file. Both claims were about a single function all along,
 * so they read one here. The end anchor is the first `}` in column zero after
 * the declaration, which is where a top-level function closes in this
 * repository; a nested block's closing brace is indented and is skipped.
 */
function functionBody(source, name, owner) {
  const start = source.search(new RegExp(`^(?:export )?(?:async )?function ${escapeRegex(name)}\\b`, "mu"));
  if (start < 0) {
    failures.push(`${owner}: there is no function '${name}' for its rule to judge`);
    return "";
  }
  const end = source.indexOf("\n}", start);
  if (end < 0) {
    failures.push(`${owner}: function '${name}' has no closing line`);
    return "";
  }
  return source.slice(start, end + 2);
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && /\.(?:ts|js|mjs|swift)$/u.test(path)) files.push(path);
  }
  return files.sort();
}

/** Source with its comments blanked out, for scans that judge code and not prose. */
function codeWithoutComments(source) {
  let out = "";
  let index = 0;
  let quote = null;
  while (index < source.length) {
    const character = source[index];
    if (quote) {
      if (character === "\\") { out += source.slice(index, index + 2); index += 2; continue; }
      if (character === quote) quote = null;
      out += character;
      index += 1;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") { quote = character; out += character; index += 1; continue; }
    if (character === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

async function readFile(path, encoding) {
  const source = await readRawFile(path, encoding);
  // This gate inspects source contracts, not a checkout's native line-ending
  // convention. Normalize before matching multiline runtime templates so the
  // same committed source answers identically on Windows, macOS, and Linux.
  return typeof source === "string" ? source.replace(/\r\n?/gu, "\n") : source;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasNamedImport(source, module, name) {
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/gu)) {
    if (match[2] !== module) continue;
    const imported = match[1].split(",").map((item) => item.trim().replace(/^type\s+/u, "").split(/\s+as\s+/u)[0]);
    if (imported.includes(name)) return true;
  }
  return false;
}

function hasCallWithLeadingArguments(source, callee, arguments_) {
  const prefix = arguments_.map(escapeRegex).join("\\s*,\\s*");
  return new RegExp(`\\b${escapeRegex(callee)}\\s*\\(\\s*${prefix}(?:\\s*,|\\s*\\))`, "u").test(source);
}

function generatedModuleSource(source, name, nextName = null) {
  const startMarker = `["${name}", String.raw\``;
  const endMarker = nextName === null ? "\n]);" : `["${nextName}",`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    failures.push(`cannot locate generated module '${name}'`);
    return "";
  }
  return source.slice(start, end);
}

function display(file) {
  return relative(root, file);
}
