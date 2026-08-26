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
  VELAR_PROMISE_NORMALIZATION_MODULE,
  VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE,
} from "../packages/compiler/src/promise-runtime.ts";
import {
  VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE,
  VELAR_REACTIVE_BRIDGE_MODULE,
} from "../packages/compiler/src/reactive-bridge-runtime.ts";
import { VELAR_REACTIVE_BRIDGE_MODULE_SOURCE } from "../packages/web/src/reactive-bridge-runtime.ts";
import {
  VELAR_PRIMITIVE_METHOD_MODULE,
  VELAR_PRIMITIVE_METHOD_MODULE_SOURCE,
} from "../packages/compiler/src/primitive-runtime.ts";
import {
  VELAR_CLASS_FIELD_MODULE,
  VELAR_CLASS_FIELD_MODULE_SOURCE,
} from "../packages/compiler/src/class-runtime.ts";
import {
  VELAR_COLLECTION_HOST_EXPORTS,
  VELAR_COLLECTION_HOST_MODULE,
  VELAR_COLLECTION_HOST_MODULE_SOURCE,
} from "../packages/compiler/src/collection-runtime.ts";
import {
  VELAR_COLLECTION_LOWERING_DEPENDENCIES,
  VELAR_COLLECTION_LOWERING_EXPORTS,
  VELAR_COLLECTION_LOWERING_MODULE,
  VELAR_COLLECTION_LOWERING_MODULE_SOURCE,
  VELAR_COLLECTION_LOWERING_RUNTIME,
} from "../packages/compiler/src/collection-lowering-runtime.ts";
import {
  VELAR_ERROR_NORMALIZATION_MODULE,
  VELAR_ERROR_NORMALIZATION_MODULE_SOURCE,
} from "../packages/compiler/src/error-runtime.ts";
import {
  VELAR_NARROWING_MODULE,
  VELAR_NARROWING_MODULE_SOURCE,
} from "../packages/compiler/src/narrowing-runtime.ts";
import {
  VELAR_TYPE_VALIDATION_MODULE,
  VELAR_TYPE_VALIDATION_MODULE_SOURCE,
} from "../packages/compiler/src/type-validation-runtime.ts";
import { VELAR_WORKER_MANIFEST_MODULE, standardModuleInterfaces, standardModuleSources } from "../packages/core/src/index.ts";
import { esModuleExports } from "./es-module-exports.mjs";
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

const strictJsonConsumers = [
  join(root, "packages", "core", "src", "index.ts"),
  join(root, "packages", "web", "src", "runtime.ts"),
  join(root, "packages", "node", "src", "compiler.ts"),
  join(root, "packages", "desktop", "src", "compiler.ts"),
];
for (const file of strictJsonConsumers) {
  const source = await readFile(file, "utf8");
  if (/\bJSON\.parse\s*\(/u.test(source)) {
    failures.push(`${display(file)}: parses official-module JSON outside the compiler-owned strict runtime`);
  }
}

const webRuntimeSource = await readFile(join(root, "packages", "web", "src", "runtime.ts"), "utf8");
const webCompilerSource = await readFile(join(root, "packages", "web", "src", "compiler.ts"), "utf8");
const webEmitterSource = await readFile(join(root, "packages", "web", "src", "emitter.ts"), "utf8");
const nodeCompilerSource = await readFile(join(root, "packages", "node", "src", "compiler.ts"), "utf8");
const nodeHttpRuntimeSource = await readFile(join(root, "packages", "node", "src", "http-runtime.ts"), "utf8");
const nodeEnvironmentRuntimeSource = await readFile(join(root, "packages", "node", "src", "environment-runtime.ts"), "utf8");
const nodeFilesystemRuntimeSource = await readFile(join(root, "packages", "node", "src", "filesystem-runtime.ts"), "utf8");
const nodeHostRuntimeSource = await readFile(join(root, "packages", "node", "src", "host-runtime.ts"), "utf8");
const sharedNodeHostRuntimeSource = await readFile(join(root, "packages", "node", "src", "node-host-runtime.ts"), "utf8");
const sharedNodeHostWorkerRuntimeSource = await readFile(join(root, "packages", "node", "src", "node-host-worker-runtime.ts"), "utf8");
const nodeProcessHostRuntimeSource = await readFile(join(root, "packages", "node", "src", "process-runtime.ts"), "utf8");
const nodeProcessWorkerRuntimeSource = await readFile(join(root, "packages", "node", "src", "process-worker-runtime.ts"), "utf8");
const nodeServeRuntimeSource = await readFile(join(root, "packages", "node", "src", "serve-runtime.ts"), "utf8");
const nodeTerminalRuntimeSource = await readFile(join(root, "packages", "node", "src", "terminal-runtime.ts"), "utf8");
const nodeTerminalWorkerRuntimeSource = await readFile(join(root, "packages", "node", "src", "terminal-worker-runtime.ts"), "utf8");
const compilerAnalyzerSource = await readFile(join(root, "packages", "compiler", "src", "analyzer.ts"), "utf8");
const compilerEmitterSource = await readFile(join(root, "packages", "compiler", "src", "emitter.ts"), "utf8");
const compilerExtensionSource = await readFile(join(root, "packages", "compiler", "src", "extension.ts"), "utf8");
const compilerIndexSource = await readFile(join(root, "packages", "compiler", "src", "index.ts"), "utf8");
const compilerClassRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "class-runtime.ts"), "utf8");
const compilerCollectionRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "collection-runtime.ts"), "utf8");
const compilerCollectionLoweringRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "collection-lowering-runtime.ts"), "utf8");
const compilerErrorRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "error-runtime.ts"), "utf8");
const compilerNarrowingRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "narrowing-runtime.ts"), "utf8");
const compilerJsonRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "json-runtime.ts"), "utf8");
const compilerNumberRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "number-runtime.ts"), "utf8");
const compilerPrimitiveRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "primitive-runtime.ts"), "utf8");
const compilerPromiseRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "promise-runtime.ts"), "utf8");
const compilerReactiveBridgeRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "reactive-bridge-runtime.ts"), "utf8");
const webReactiveBridgeRuntimeSource = await readFile(join(root, "packages", "web", "src", "reactive-bridge-runtime.ts"), "utf8");
const compilerTextRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "text-runtime.ts"), "utf8");
const compilerTypeRegistryRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "type-registry-runtime.ts"), "utf8");
const compilerTypeValidationRuntimeSource = await readFile(join(root, "packages", "compiler", "src", "type-validation-runtime.ts"), "utf8");
const compilerTypesSource = await readFile(join(root, "packages", "compiler", "src", "types.ts"), "utf8");
const compilerAstSource = await readFile(join(root, "packages", "compiler", "src", "ast.ts"), "utf8");
const compilerParserSource = await readFile(join(root, "packages", "compiler", "src", "parser.ts"), "utf8");
const compilerFormatterSource = await readFile(join(root, "packages", "compiler", "src", "formatter.ts"), "utf8");
const compilerSemanticSource = await readFile(join(root, "packages", "compiler", "src", "semantic.ts"), "utf8");
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
  for (const file of await sourceFiles(directory)) desktopSources.push([file, await readFile(file, "utf8")]);
}
for (const [file, source] of desktopSources) {
  for (const retired of [
    "LanguageServer", "ProjectTask", "ProjectChanges", "TerminalSession", "openTerminal", "languageServer",
    "startProjectTask", "projectChanges", "project-transactions", "terminal-owned", "language-server", "project-task", "@velaros",
  ]) {
    if (source.includes(retired)) failures.push(`${display(file)}: product tooling '${retired}' crossed into the Desktop language framework`);
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

const coreTargetBoundarySources = new Map([
  ["packages/compiler/src/ast.ts", compilerAstSource],
  ["packages/compiler/src/types.ts", compilerTypesSource],
  ["packages/compiler/src/analyzer.ts", compilerAnalyzerSource],
  ["packages/compiler/src/parser.ts", compilerParserSource],
  ["packages/compiler/src/formatter.ts", compilerFormatterSource],
  ["packages/compiler/src/semantic.ts", compilerSemanticSource],
]);
for (const [path, source] of coreTargetBoundarySources) {
  for (const targetName of ["WebNode", "ComponentDeclaration", "JSX", "LookExpression", "MountedBlock", "UnsafeCssImportDeclaration"]) {
    if (source.includes(targetName)) failures.push(`${path}: Core embeds target-owned '${targetName}' instead of using the compiler extension contract`);
  }
}
for (const phrase of ["ExtensionValueType", "resolveTypeSyntax", "isTypeAssignable", "memberType"]) {
  const source = phrase === "ExtensionValueType" ? compilerTypesSource : compilerExtensionSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: target type extension contract is missing '${phrase}'`);
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
  failures.push("packages/compiler/src/class-runtime.ts: checked class field reads bypass their captured Object, Reflect, or Error ABI");
}
if (!compilerEmitterSource.includes("helpers.push(VELAR_CLASS_FIELD_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: checked class field reads bypass the compiler-owned class runtime");
}
for (const name of ["readInstanceField", "readPrivateField", "readStaticField"]) {
  if (!VELAR_CLASS_FIELD_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/src/class-runtime.ts: shared class-field runtime does not export '${name}'`);
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
  const source = phrase === "VELAR_CLASS_FIELD_MODULE_SOURCE" ? compilerClassRuntimeSource : compilerEmitterSource;
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
  if (!webReactiveBridgeRuntimeSource.includes(phrase)) failures.push(`packages/web/src/reactive-bridge-runtime.ts: reactive bridge runtime is missing captured or late-binding operation '${phrase}'`);
}
if (/\b(?:Object\.(?:getOwnPropertyDescriptor|getPrototypeOf|isExtensible|getOwnPropertySymbols)|Symbol\.for)\s*\(|\bnew TypeError\b|\.call\s*\(|\bruntime\.(?:toRaw|reactive|track|collectionRead|collectionTrigger|collectionUnlink)\s*\(/u.test(webReactiveBridgeRuntimeSource)) {
  failures.push("packages/web/src/reactive-bridge-runtime.ts: JavaScript or collection bridging bypasses its captured registry, Object, Symbol, or Error ABI");
}
for (const phrase of ["VELAR_RUNTIME_REGISTRY_KEY", "VELAR_RUNTIME_SCHEMA_VERSION", "__velarResolveReactiveBridge", "VELAR_REACTIVE_BRIDGE_MODULE_SOURCE"]) {
  if (compilerReactiveBridgeRuntimeSource.includes(phrase)) {
    failures.push(`packages/compiler/src/reactive-bridge-runtime.ts: Web reactive provider ownership crossed into Core/compiler through '${phrase}'`);
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
    failures.push(`packages/web/src/reactive-bridge-runtime.ts: shared Web runtime does not export '${name}'`);
  }
  if (!VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/src/reactive-bridge-runtime.ts: Core's static bridge does not export '${name}'`);
  }
}
for (const phrase of [
  "private readonly requiredRuntimeModules = new Set<string>()",
  "runtimeModules(): readonly string[]",
  "this.requiredRuntimeModules.add(VELAR_REACTIVE_BRIDGE_MODULE)",
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
  "const WEB_LOCAL_REACTIVE_BRIDGE_RUNTIME",
  "const WEB_LOCAL_REACTIVE_COLLECTION_BRIDGE_RUNTIME",
  "const __velarReactiveRaw = __velarToRaw",
  "const __velarReactiveCollectionReadOperation = __velarRuntime.collectionRead",
  "const __velarReactiveCollectionTriggerOperation = __velarRuntime.collectionTrigger",
  "function __velarReactiveCollectionTrigger(value, key, iterate = true, structure = false, indexFrom = null, allKeys = false)",
  "const __velarReactiveCollectionUnlinkOperation = __velarRuntime.collectionUnlink",
  "const __velarReactiveOperation = __velarRuntime.reactive",
  "const __velarReactiveTrackOperation = __velarRuntime.track",
  "if (!this.webOutput) return super.reactiveBridgeHelpers",
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
const projectCompilerSource = await readFile(join(root, "packages", "cli", "src", "project.ts"), "utf8");
const standardModulesSource = await readFile(join(root, "packages", "core", "src", "index.ts"), "utf8");
const cliSource = await readFile(join(root, "packages", "cli", "src", "cli.ts"), "utf8");
const browserTestRunnerSource = await readFile(join(root, "packages", "cli", "src", "browser-test-runner.ts"), "utf8");
const browserProcessOwnerSource = await readFile(join(root, "packages", "cli", "src", "browser-process-owner.ts"), "utf8");
const browserAcceptanceSource = await readFile(join(root, "tests", "browser.acceptance.ts"), "utf8");
if (!projectCompilerSource.includes("sharedRuntimeModules: true")) {
  failures.push("packages/cli/src/project.ts: project compilation does not request shared compiler runtime modules");
}
if (!standardModulesSource.includes("[VELAR_REACTIVE_BRIDGE_MODULE, VELAR_NON_REACTIVE_BRIDGE_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: Core's static compiler bridge is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_PRIMITIVE_METHOD_MODULE, VELAR_PRIMITIVE_METHOD_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared primitive runtime source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_PROMISE_NORMALIZATION_MODULE, VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared Promise runtime source is not available to project execution paths");
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
if (!standardModulesSource.includes("[VELAR_ERROR_NORMALIZATION_MODULE, VELAR_ERROR_NORMALIZATION_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared error runtime source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_NARROWING_MODULE, VELAR_NARROWING_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared narrowing runtime source is not available to project execution paths");
}
if (!standardModulesSource.includes("[VELAR_TYPE_VALIDATION_MODULE, VELAR_TYPE_VALIDATION_MODULE_SOURCE]")) {
  failures.push("packages/core/src/index.ts: shared runtime-Type source is not available to project execution paths");
}
const coreInterfaceSection = standardModulesSource.slice(
  standardModulesSource.indexOf("const coreModuleInterfaces"),
  standardModulesSource.indexOf("export function standardModuleInterfaces"),
);
for (const internalModule of ["VELAR_REACTIVE_BRIDGE_MODULE", "VELAR_PRIMITIVE_METHOD_MODULE", "VELAR_PROMISE_NORMALIZATION_MODULE", "VELAR_CLASS_FIELD_MODULE", "VELAR_COLLECTION_HOST_MODULE", "VELAR_COLLECTION_LOWERING_MODULE", "VELAR_ERROR_NORMALIZATION_MODULE", "VELAR_NARROWING_MODULE", "VELAR_TYPE_VALIDATION_MODULE"]) {
  if (coreInterfaceSection.includes(internalModule)) {
    failures.push(`packages/core/src/index.ts: internal compiler runtime '${internalModule}' leaked into the public standard-module API`);
  }
}
for (const phrase of [
  "for (const source of module.result.runtimeModules)",
  "if (sources.has(source)) roots.add(source)",
  "standardModuleClosure(roots, project.extensionConfig, project.compilerExtensions)",
]) {
  if (!cliSource.includes(phrase)) failures.push(`packages/cli/src/cli.ts: Node build does not materialize compiler runtime requirements '${phrase}'`);
}
for (const phrase of [
  "const staging = await prepareBuildStaging(outputDirectory, replacement)",
  "import { BUILD_STAGING_MARKER } from \"./build-staging.ts\"",
  "await recoverInterruptedBuilds(normalizedOutput)",
  "!processIsAlive(installed.ownerPid)",
  "await rm(staging, { recursive: true, force: true })",
  "await writeNodeStandardModules(staging, project, false, buildMode)",
  "await replaceOutputDirectory(staging, outputDirectory)",
  "await rename(outputDirectory, previous)",
  "await rename(previous, outputDirectory)",
]) {
  if (!cliSource.includes(phrase)) failures.push(`packages/cli/src/cli.ts: unbundled output replacement is missing '${phrase}'`);
}
for (const phrase of [
  "await assertNodeStandardModuleOutputAvailable(dirname(outputPath), project)",
  "velarGeneratedRuntime: VELAR_GENERATED_RUNTIME_PACKAGE_VERSION",
  "generatedRuntimePackageOwnership(packageRoot)",
  "Refusing to replace non-generated package",
  "result.css ? writeFile(cssPath, result.css, \"utf8\") : rm(cssPath, { force: true })",
]) {
  if (!cliSource.includes(phrase)) failures.push(`packages/cli/src/cli.ts: single-file output synchronization is missing '${phrase}'`);
}
for (const phrase of [
  "const defaultBrowserTestTimeoutMs = 120_000",
  "const defaultBrowserRunTimeoutMs = 20 * 60_000",
  "const defaultBrowserCleanupTimeoutMs = 10_000",
  "return superviseBrowserWorker({",
  "await exitBrowserWorker(code)",
  ".launchServer({ headless: true, timeout: 30_000 })",
  "await boundedBrowserOperation(context.close(), limits.cleanupTimeoutMs, \"Browser context cleanup\")",
]) {
  if (!browserTestRunnerSource.includes(phrase)) failures.push(`packages/cli/src/browser-test-runner.ts: browser-test lifecycle contract is missing '${phrase}'`);
}
for (const phrase of [
  "detached: ownsProcessGroup",
  "process.kill(-child.pid, signal)",
  "process.once(\"disconnect\", parentDisconnected)",
  "signalOwnedWorker(child, \"SIGKILL\", ownsProcessGroup, true)",
  "await boundedBrowserOperation(server.close(), timeoutMs, \"Browser graceful cleanup\")",
  "await boundedBrowserOperation(server.kill(), timeoutMs, \"Browser forced cleanup\")",
]) {
  if (!browserProcessOwnerSource.includes(phrase)) failures.push(`packages/cli/src/browser-process-owner.ts: supervised browser owner is missing '${phrase}'`);
}
for (const phrase of [
  "await superviseBrowserWorker({",
  "deadlineMs: 20 * 60_000",
  "await exitBrowserWorker(code)",
  "terminateBrowserServer(owner.browser, owner.server, 10_000)",
  ".launchServer({ headless: true, timeout: 30_000 })",
]) {
  if (!browserAcceptanceSource.includes(phrase)) failures.push(`tests/browser.acceptance.ts: direct browser acceptance owner is missing '${phrase}'`);
}
if (/\b(?:chromium|firefox|webkit|browserType)\.launch\s*\(/u.test(browserTestRunnerSource + "\n" + browserAcceptanceSource)) {
  failures.push("Browser gates use an opaque Playwright launch instead of an explicit BrowserServer owner");
}
const coreTestDisplayRuntimeSource = constantSource(standardModulesSource, "testDisplayRuntime", "\n\nconst listRuntime");
const webFoundationSource = await readFile(join(root, "packages", "web", "src", "runtime-foundation.ts"), "utf8");
const desktopNativeHostSource = await readFile(join(root, "packages", "desktop", "native", "macos", "VelarDesktopHost.swift"), "utf8");
const desktopWorkerSource = await readFile(join(root, "packages", "desktop", "native", "node", "worker.js"), "utf8");
const webPlatformModuleSource = generatedModuleSource(webRuntimeSource, "velar/web", "velar/forms");
const formsPlatformModuleSource = generatedModuleSource(webRuntimeSource, "velar/forms", "velar/http");
const storagePlatformModuleSource = generatedModuleSource(webRuntimeSource, "velar/storage", "velar/browser");
const browserPlatformModuleSource = generatedModuleSource(webRuntimeSource, "velar/browser", "velar/files");
const webHttpModuleSource = generatedModuleSource(webRuntimeSource, "velar/http", "velar/storage");
const webAppModuleSource = generatedModuleSource(webRuntimeSource, "velar/app", "velar/config");
const webOwnedCallbackRuntimeSource = constantSource(webRuntimeSource, "ownedCallbackRuntime", "\n\nconst fileRegistryRuntime");
const webDomHostRuntimeSource = constantSource(webFoundationSource, "WEB_DOM_HOST_RUNTIME", "\n\nexport const WEB_REACTIVITY_HOST_RUNTIME");
const webReactivityHostRuntimeSource = constantSource(webFoundationSource, "WEB_REACTIVITY_HOST_RUNTIME", "\n\nexport const WEB_ERROR_HOST_RUNTIME_BODY");
const webErrorHostRuntimeSource = constantSource(webFoundationSource, "WEB_ERROR_HOST_RUNTIME_BODY", "\n\nexport const WEB_ERROR_HOST_RUNTIME =");
const emittedWebRuntimeSource = webEmitterSource.slice(
  webEmitterSource.indexOf("const WEB_RUNTIME_BODY = String.raw`"),
  webEmitterSource.indexOf("`.trim();\n\nfunction webRuntime("),
);
// D90 R16 / rw-3: the emitted prelude no longer defines a flush drain or a
// scheduler of its own -- runtime-foundation.ts holds the single definition and
// the prelude, inlined into the same module scope, calls it. So the reactivity
// slice starts at the first observer helper the prelude still owns, and the one
// drain's use of the captured graph ABI is asserted against the foundation.
const emittedReactivityRuntimeSource = webEmitterSource.slice(webEmitterSource.indexOf("function __velarTrack(subscribers)"), webEmitterSource.indexOf("function __velarResource"));
const emittedManagedAsyncRuntimeSource = webEmitterSource.slice(webEmitterSource.indexOf("const __velarManagedAsyncNativePromise"), webEmitterSource.indexOf("function __velarScope"));
const emittedDomRuntimeSource = webEmitterSource.slice(webEmitterSource.indexOf("function __velarComponent"), webEmitterSource.indexOf("function __velarLook(parts)"));
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
const webListGuardRuntimeSource = constantSource(webRuntimeSource, "listRuntime", "\nconst optionsRuntime");
const webOptionsGuardRuntimeSource = constantSource(webRuntimeSource, "optionsRuntime", "\nconst webHostAbiRuntime");
const nodeHttpModuleSource = nodeHttpRuntimeSource;
const nodeServeModuleSource = generatedModuleSource(nodeCompilerSource, "velar/serve");
const nodeProcessModuleSource = generatedModuleSource(nodeCompilerSource, "velar/process", "velar/http");
const coreCollectionsModuleSource = generatedModuleSource(standardModulesSource, "velar/collections", "velar/text");
const coreTextModuleSource = generatedModuleSource(standardModulesSource, "velar/text", "velar/math");
const coreMathModuleSource = generatedModuleSource(standardModulesSource, "velar/math", "velar/binary");
const coreJsonModuleSource = generatedModuleSource(standardModulesSource, "velar/json", "velar/async");
const coreUrlModuleSource = generatedModuleSource(standardModulesSource, "velar/url", "velar/time");
const coreTimeModuleSource = generatedModuleSource(standardModulesSource, "velar/time", "velar/id");
const coreIdModuleSource = generatedModuleSource(standardModulesSource, "velar/id", "velar/log");
const coreLogModuleSource = generatedModuleSource(standardModulesSource, "velar/log", "velar/test");
const coreTestModuleSource = generatedModuleSource(standardModulesSource, "velar/test");
const desktopHttpModuleSource = constantSource(desktopCompilerSource, "DESKTOP_HTTP_SOURCE", "desktopModuleSources.set(\"velar/http\"");
const desktopProcessModuleSource = constantSource(desktopCompilerSource, "DESKTOP_PROCESS_SOURCE", "\n\nconst DESKTOP_ENV_SOURCE");
const utf8RuntimeSource = await readFile(join(root, "packages", "compiler", "src", "utf8-runtime.ts"), "utf8");
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
    failures.push(`packages/node/src/process-runtime.ts: shared process host ABI is missing captured operation '${phrase}'`);
  }
}
if (!nodeCompilerSource.includes('import { VELAR_PROCESS_HOST_RUNTIME } from "./process-runtime.ts"')
  || !nodeCompilerSource.includes('export { VELAR_PROCESS_HOST_RUNTIME } from "./process-runtime.ts"')) {
  failures.push("packages/node/src/compiler.ts: Node process target must import and export the canonical process host ABI");
}
if (!desktopCompilerSource.includes('from "@velarscript/node/compiler"')
  || !desktopCompilerSource.includes("VELAR_PROCESS_HOST_RUNTIME")
  || desktopCompilerSource.includes("const VELAR_PROCESS_HOST_RUNTIME = String.raw")) {
  failures.push("packages/desktop/src/compiler.ts: Desktop process target must reuse, not duplicate, the Node-owned process host ABI");
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
    failures.push(`packages/node/src/process-worker-runtime.ts: isolated process host is missing '${phrase}'`);
  }
}
if (/\b(?:import\s*\(|require\s*\(|eval\s*\(|Function\s*\()/u.test(nodeProcessWorkerRuntimeSource)) {
  failures.push("packages/node/src/process-worker-runtime.ts: isolated process host may load only its static node: builtins and compiler-owned source");
}
for (const phrase of [
  "const __velarEnvEnvironment = globalThis.process.env",
  "const __velarEnvRegExpTest =",
  "const __velarEnvOwnDescriptor =",
  "function __velarEnvValue(name)",
]) {
  if (!nodeEnvironmentRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/src/environment-runtime.ts: captured environment ABI is missing '${phrase}'`);
  }
}
if (/\bprocess\.env\s*\[/u.test(nodeEnvironmentRuntimeSource) || /\.test\s*\(/u.test(nodeEnvironmentRuntimeSource)) {
  failures.push("packages/node/src/environment-runtime.ts: environment reads must not rediscover process.env or RegExp.prototype after initialization");
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
    failures.push(`packages/node/src/host-runtime.ts: captured lifecycle ABI is missing '${phrase}'`);
  }
}
if (/\bPromise\.(?:race|resolve)\s*\(/u.test(nodeHostRuntimeSource)
  || /\bprocess\.(?:on|exit)\s*\(/u.test(nodeHostRuntimeSource)
  || /\bconsole\.error\s*\(/u.test(nodeHostRuntimeSource)) {
  failures.push("packages/node/src/host-runtime.ts: lifecycle work must use captured Promise, process, and synchronous diagnostic operations");
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
    failures.push(`packages/node/src/terminal-runtime.ts: terminal proxy is missing '${phrase}'`);
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
    failures.push(`packages/node/src/terminal-worker-runtime.ts: isolated terminal host is missing '${phrase}'`);
  }
}
if (/\b(?:import\s*\(|require\s*\(|eval\s*\(|Function\s*\()/u.test(nodeTerminalWorkerRuntimeSource)) {
  failures.push("packages/node/src/terminal-worker-runtime.ts: isolated terminal host may load only static node: built-ins");
}
for (const match of nodeTerminalWorkerRuntimeSource.matchAll(/^\s*import\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/gmu)) {
  if (!match[1].startsWith("node:")) failures.push(`packages/node/src/terminal-worker-runtime.ts: isolated terminal host imports non-builtin '${match[1]}'`);
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
    failures.push(`packages/node/src/filesystem-runtime.ts: captured filesystem ABI is missing '${phrase}'`);
  }
}
if (/from\s+["']node:(?:fs|path)/u.test(nodeFilesystemRuntimeSource)
  || /\bBuffer\.byteLength\s*\(/u.test(nodeFilesystemRuntimeSource)
  || /\bPromise\.(?:reject|resolve|race)\s*\(/u.test(nodeFilesystemRuntimeSource)
  || /\.catch\s*\(/u.test(nodeFilesystemRuntimeSource)) {
  failures.push("packages/node/src/filesystem-runtime.ts: filesystem effects must stay behind the shared isolated Node host and captured validation/UTF-8 operations");
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
    failures.push(`packages/node/src/node-host-runtime.ts: shared Node host proxy is missing '${phrase}'`);
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
    failures.push(`packages/node/src/node-host-worker-runtime.ts: shared isolated Node host is missing '${phrase}'`);
  }
}
if ((sharedNodeHostWorkerRuntimeSource.match(/requests\.delete\s*\(/gu) ?? []).length !== 1) {
  failures.push("packages/node/src/node-host-worker-runtime.ts: request completion and disconnect must release aggregate ownership through one lifecycle gate");
}
if (/\b(?:import\s*\(|require\s*\(|eval\s*\(|Function\s*\()/u.test(sharedNodeHostWorkerRuntimeSource)) {
  failures.push("packages/node/src/node-host-worker-runtime.ts: shared isolated Node host may load only static node: built-ins");
}
for (const phrase of [
  'import { __velarNodeHostInvoke, __velarNodeHostOn } from "velar/node-host-v1"',
  '__velarNodeHostOn("serve.request"',
  'await __velarNodeHostInvoke("serve.start"',
  '__velarNodeHostInvoke("serve.streamWrite"',
  "export class RequestBodyTooLargeError",
]) {
  if (!nodeServeRuntimeSource.includes(phrase)) {
    failures.push(`packages/node/src/serve-runtime.ts: captured serve boundary is missing '${phrase}'`);
  }
}
if (/from\s+["']node:/u.test(nodeServeRuntimeSource)) {
  failures.push("packages/node/src/serve-runtime.ts: application-facing serve runtime must not import Node transport built-ins");
}
for (const phrase of [
  'import { VELAR_NODE_ENV_RUNTIME } from "./environment-runtime.ts"',
  'import { VELAR_NODE_FILESYSTEM_RUNTIME } from "./filesystem-runtime.ts"',
  'import { VELAR_NODE_HTTP_RUNTIME } from "./http-runtime.ts"',
  'import { VELAR_NODE_HOST_RUNTIME } from "./host-runtime.ts"',
  'import { VELAR_NODE_HOST_RUNTIME as VELAR_SHARED_NODE_HOST_RUNTIME } from "./node-host-runtime.ts"',
  'import { VELAR_NODE_HOST_WORKER_SOURCE } from "./node-host-worker-runtime.ts"',
  'import { VELAR_NODE_SERVE_RUNTIME } from "./serve-runtime.ts"',
  'import { VELAR_NODE_TERMINAL_RUNTIME } from "./terminal-runtime.ts"',
  'import { VELAR_NODE_TERMINAL_WORKER_SOURCE } from "./terminal-worker-runtime.ts"',
  'export const VELAR_NODE_HOST_MODULE = "velar/node-host-v1"',
  'VELAR_SHARED_NODE_HOST_RUNTIME.replace("WORKER_SOURCE", JSON.stringify(VELAR_NODE_HOST_WORKER_SOURCE))',
  '["velar/fs", String.raw`',
  "${VELAR_NODE_FILESYSTEM_RUNTIME}",
  '["velar/http", VELAR_NODE_HTTP_RUNTIME]',
  '["velar/env", VELAR_NODE_ENV_RUNTIME]',
  '["velar/host", VELAR_NODE_HOST_RUNTIME]',
  'VELAR_NODE_TERMINAL_RUNTIME.replace("WORKER_SOURCE", JSON.stringify(VELAR_NODE_TERMINAL_WORKER_SOURCE))',
  '["velar/fs", [VELAR_NODE_HOST_MODULE, "velar/binary"]]',
  '["velar/http", [VELAR_NODE_HOST_MODULE, "velar/binary"]]',
  '["velar/serve", [VELAR_NODE_HOST_MODULE, VELAR_ERROR_NORMALIZATION_MODULE, VELAR_COLLECTION_LOWERING_MODULE, "velar/binary", "velar/fs", "velar/task"]]',
  "dependencies: nodeModuleDependencies",
]) {
  if (!nodeCompilerSource.includes(phrase)) failures.push(`packages/node/src/compiler.ts: Node host runtime composition is missing '${phrase}'`);
}
for (const match of nodeProcessWorkerRuntimeSource.matchAll(/^\s*import\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/gmu)) {
  if (!match[1].startsWith("node:")) failures.push(`packages/node/src/process-worker-runtime.ts: isolated process host imports non-builtin '${match[1]}'`);
}
for (const phrase of [
  "Object.getOwnPropertyDescriptor(String.prototype, \"charCodeAt\")",
  "Object.getOwnPropertyDescriptor(Reflect, \"apply\")",
  "__velarUtf8ReflectApply(__velarUtf8CharCodeAt",
  "function __velarDeclaredLength(value)",
]) {
  if (!utf8RuntimeSource.includes(phrase)) failures.push(`packages/compiler/src/utf8-runtime.ts: missing captured transport operation '${phrase}'`);
}
for (const [owner, source] of [
  ["Web", webHttpModuleSource],
  ["Node", nodeHttpModuleSource],
  ["Desktop", desktopHttpModuleSource],
]) {
  if (!source.includes("${VELAR_UTF8_RUNTIME}") || !source.includes("__velarUtf8ByteLength(body)")) {
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
  || !nodeServeModuleSource.includes("${VELAR_UTF8_RUNTIME}")
  || !sharedNodeHostWorkerRuntimeSource.includes('const declaredText = task.request.headers["content-length"]')
  || !sharedNodeHostWorkerRuntimeSource.includes('/^[0-9]+$/u.test(declaredText)')
  || !desktopWorkerSource.includes("transportDeclaredLength(response.headers.get(\"content-length\"))")) {
  failures.push("Web/Node/Desktop: declared transport lengths must use captured decimal parsing before body reads");
}
for (const [owner, source] of [["Node", nodeProcessModuleSource], ["Desktop", desktopProcessModuleSource]]) {
  if (!source.includes("${VELAR_PROCESS_HOST_RUNTIME}") || !source.includes("${VELAR_UTF8_RUNTIME}")) {
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
  "${JSON.stringify(VELAR_NODE_PROCESS_WORKER_SOURCE)}",
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
  if (!nodeHttpModuleSource.includes(phrase)) failures.push(`packages/node/src/http-runtime.ts: HTTP boundary is missing '${phrase}'`);
}
for (const phrase of [
  'import { createServer, request as createHttpRequest } from "node:http"',
  'import { request as createHttpsRequest } from "node:https"',
  '"http.request", "http.read", "http.readBytes", "http.cancel", "http.close"',
  "const httpRequests = new Map()",
  'decoder: new TextDecoder("utf-8", {fatal: true})',
  "if (httpRequests.size >= maxHttpRequests)",
  "class HttpTransportFailure extends Error",
  'return {name: "HttpTransportError", message: error.message, phase: error.phase}',
  'throw new Error("HTTP redirect limit of 20 was exceeded")',
  'delete headers["content-length"]',
]) {
  if (!sharedNodeHostWorkerRuntimeSource.includes(phrase)) failures.push(`packages/node/src/node-host-worker-runtime.ts: isolated HTTP host is missing '${phrase}'`);
}
for (const phrase of [
  "let __velarNodeHostActiveHttpRequests = 0",
  "const __velarNodeHostActiveHttpHandles =",
  "export class __velarNodeHostHttpTransportError",
  "__velarNodeHostActiveHttpRequests > 0",
  'pending.operation === "http.request"',
  'pending.operation === "http.close" || pending.operation === "http.cancel"',
]) {
  if (!sharedNodeHostRuntimeSource.includes(phrase)) failures.push(`packages/node/src/node-host-runtime.ts: HTTP lifecycle ownership is missing '${phrase}'`);
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
  failures.push("packages/node/src/http-runtime.ts: application-facing HTTP validation or transport bypasses its captured ABI or isolated host");
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
if (/__velarOptions\([^\n]*new Set\s*\(/u.test(webRuntimeSource)
  || /handler\(handlers,\s*new Set\s*\(/u.test(webRuntimeSource)) {
  failures.push("packages/web: options consumers must build allowed fields through the captured guard ABI");
}
if ((webCompilerSource.match(/namedIntrinsic\("runtime\.parseAsync"/gu)?.length ?? 0) !== 2
  || (nodeCompilerSource.match(/namedIntrinsic\("runtime\.parseAsync"/gu)?.length ?? 0) !== 4
  || !compilerAnalyzerSource.includes('case "runtime.parseAsync"')
  || !compilerAnalyzerSource.includes("arity();")
  || !compilerAnalyzerSource.includes("this.reportPromiseResolutionHazard(parsed")) {
  failures.push("compiler/Web/Node: HTTP and serve async runtime-Type parsing must share one Promise-safe Core intrinsic");
}
for (const phrase of [
  'readonly kind: "runtimeType"',
  'if (expected.kind === "runtimeType")',
  'if (pattern.kind === "runtimeType")',
  'export function typeContainsRuntimeTypeCheck',
]) {
  if (!compilerTypesSource.includes(phrase)) failures.push(`packages/compiler/src/types.ts: missing first-class Type<T> contract '${phrase}'`);
}
for (const phrase of [
  'readonly kind: "record"',
  'if (syntax.name === "Record")',
  'return `${type.readonlyView ? "readonly " : ""}Record<${describeType(type.value)}>`',
]) {
  if (!compilerTypesSource.includes(phrase)) failures.push(`packages/compiler/src/types.ts: missing Record<T> contract '${phrase}'`);
}
for (const phrase of [
  'if (type.kind === "record") return this.jsonSerializable(type.value, seen)',
  'object.kind === "record"',
  'Record keys may be absent',
]) {
  if (!compilerAnalyzerSource.includes(phrase)) failures.push(`packages/compiler/src/analyzer.ts: missing Record<T> analysis contract '${phrase}'`);
}
if (!compilerTypeValidationRuntimeSource.includes("function __velarRecordTypeIs(value, check)")) {
  failures.push("packages/compiler/src/type-validation-runtime.ts: missing controlled Record<T> validation operation");
}
for (const phrase of [
  "function __velarRecordFields(value, name)",
  "function __velarRecordSet(value, key, item)",
  "function __velarRecordCopy(value)",
  '!descriptor.configurable || !descriptor.writable',
]) {
  if (!VELAR_COLLECTION_LOWERING_RUNTIME.includes(phrase)) failures.push(`packages/compiler/src/collection-lowering-runtime.ts: missing controlled Record<T> operation '${phrase}'`);
}
if (!VELAR_COLLECTION_LOWERING_RUNTIME.includes('__velarRecordFields(value, "Record index")')) {
  failures.push("packages/compiler/src/collection-lowering-runtime.ts: missing controlled Record<T> index operation");
}
for (const phrase of [
  'if (object.kind === "runtimeType")',
  'Type<T> is a static runtime-Type carrier and cannot itself be checked at runtime',
  'Type<T> is a static runtime-Type carrier and cannot be embedded',
]) {
  if (!compilerAnalyzerSource.includes(phrase)) failures.push(`packages/compiler/src/analyzer.ts: missing Type<T> ownership or diagnostic '${phrase}'`);
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
    failures.push(`packages/compiler/src/promise-runtime.ts: missing captured Promise operation '${phrase}'`);
  }
}
if (/\b(?:Object\.(?:getOwnPropertyDescriptor|getPrototypeOf|defineProperty)|Reflect\.apply|Symbol\.for)\s*\(|\b(?:WeakMap|Promise)\.prototype\b|\bnew (?:WeakMap|TypeError)\b|\.(?:get|set|has|then)\s*\(/u.test(compilerPromiseRuntimeSource)) {
  failures.push("packages/compiler/src/promise-runtime.ts: Promise normalization bypasses its captured Object, Reflect, Symbol, WeakMap, Promise, or Error ABI");
}
for (const name of ["normalizePromiseValue", "asyncResolvedValue"]) {
  if (!VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/src/promise-runtime.ts: shared Promise runtime does not export '${name}'`);
  }
}
for (const phrase of [
  "VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_PROMISE_NORMALIZATION_MODULE)",
  "normalizePromiseValue as __velarNormalizePromiseValue",
  "asyncResolvedValue as __velarAsyncResolvedValue",
  "from ${JSON.stringify(VELAR_PROMISE_NORMALIZATION_MODULE)}",
]) {
  const source = phrase === "VELAR_PROMISE_NORMALIZATION_MODULE_SOURCE" ? compilerPromiseRuntimeSource : compilerEmitterSource;
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
  if (!compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: missing captured detached-task operation '${phrase}' (B-DETACHED-ASYNC)`);
}
for (const phrase of [
  "const __velarDetachedRegistryKey = Symbol.for(${JSON.stringify(VELAR_RUNTIME_REGISTRY_KEY)})",
  "const __velarDetachedPromiseThen = globalThis.Promise.prototype.then",
  'phase: \\"detached\\", detail: \\"\\", unhandled: true',
  "function __velarDetachedTask(task)",
]) {
  if (!webEmitterSource.includes(phrase)) failures.push(`packages/web/src/emitter.ts: missing Web detached-task report contract '${phrase}' (B-DETACHED-ASYNC)`);
}
if (/\bevent\.(?:data|lastEventId|code|reason|matches|defaultPrevented|button|metaKey|ctrlKey|shiftKey|altKey|preventDefault|stopPropagation)\b/u.test(webRuntimeSource)) {
  failures.push("packages/web/src/runtime.ts: reads framework-owned host event fields outside captured native/data-descriptor adapters");
}
if (/\bvalue\.(?:target|preventDefault|stopPropagation)\b/u.test(webEmitterSource)) {
  failures.push("packages/web/src/emitter.ts: applies event modifiers through replaceable event fields or methods");
}
if (/\bvalue\.(?:send|close|addEventListener|readyState|url)\b/u.test(webRuntimeSource)) {
  failures.push("packages/web/src/runtime.ts: invokes realtime instance fields instead of the captured host ABI");
}
if (/\b(?:navigator|document|location)\.(?:href|origin|pathname|search|hash|language|languages|onLine|maxTouchPoints|clipboard|visibilityState)\b/u.test(browserPlatformModuleSource)
  || /\b(?:matchMedia|setTimeout|clearTimeout|requestAnimationFrame|addEventListener|removeEventListener)\s*\(/u.test(browserPlatformModuleSource)
  || /\b(?:Element|HTMLElement|HTMLDialogElement)\.prototype\.(?:scrollIntoView|getBoundingClientRect|focus|blur|showModal|close)\b/u.test(browserPlatformModuleSource)
  || /\b(?:matcher|dialog|value)\.(?:addEventListener|removeEventListener|isConnected|open|returnValue)\b/u.test(browserPlatformModuleSource)) {
  failures.push("packages/web/src/runtime.ts: velar/browser bypasses the captured browser host ABI");
}
if (/\b(?:history|location)\.(?:pushState|replaceState|back|forward|reload|href|origin|pathname|search|hash)\b/u.test(webPlatformModuleSource)
  || /\b(?:dispatchEvent|requestAnimationFrame|addEventListener|removeEventListener)\s*\(/u.test(webPlatformModuleSource)
  || /\bnode\.(?:addEventListener|removeEventListener)\s*\(/u.test(webPlatformModuleSource)
  || /\bnew\s+(?:URL|URLSearchParams)\s*\(/u.test(webPlatformModuleSource)) {
  failures.push("packages/web/src/runtime.ts: velar/web navigation bypasses the captured browser host ABI");
}
if (/\bqueueMicrotask\s*\(/u.test(webRuntimeSource)
  || /\bqueueMicrotask\s*\(/u.test(webEmitterSource)
  || /\bqueueMicrotask\s*\(/u.test(webFoundationSource)
  || /\bglobalThis\.Date\.now\s*\(/u.test(webFoundationSource)) {
  failures.push("packages/web: Web scheduling or timestamps bypass the captured browser host ABI");
}
if (/\b(?:globalThis\.)?(?:localStorage|sessionStorage|indexedDB)\b/u.test(storagePlatformModuleSource)
  || /\.(?:getItem|setItem|removeItem|key|open|transaction|objectStore|createObjectStore|contains|getKey|getAllKeys|put|close)\s*\(/u.test(storagePlatformModuleSource)
  || /\.(?:result|error|objectStoreNames|onupgradeneeded|onsuccess|onerror|onblocked|onversionchange|onclose|onabort|oncomplete)\b/u.test(storagePlatformModuleSource)
  || /\b(?:dispatchEvent|addEventListener|removeEventListener)\s*\(/u.test(storagePlatformModuleSource)
  || /\bNumber\.isSafeInteger\s*\(/u.test(storagePlatformModuleSource)) {
  failures.push("packages/web/src/runtime.ts: velar/storage bypasses the captured Storage or IndexedDB host ABI");
}
for (const phrase of [
  "${VELAR_UTF8_RUNTIME}",
  "function storageSafeInteger(value)",
  "function storageByteBudget(value)",
  "__velarUtf8ByteLength(next) > maxBytes",
  'typeof encoded !== "string" || __velarUtf8ByteLength(encoded) > maxBytes',
  'objectOperation(store, "put", [encoded, name])',
]) {
  if (!storagePlatformModuleSource.includes(phrase)) failures.push(`packages/web/src/runtime.ts: velar/storage budget boundary is missing '${phrase}'`);
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
  failures.push("packages/web/src/runtime.ts: velar/forms data extraction bypasses its captured WebIDL or parsing ABI");
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
  failures.push("packages/web/src/runtime.ts: velar/forms DOM lifecycle bypasses its captured node, control, collection, or mutation ABI");
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
if (!webFoundationSource.includes("${WEB_DOM_HOST_RUNTIME}")
  || !webRuntimeSource.includes("${WEB_DOM_HOST_RUNTIME}")) {
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
if (!webFoundationSource.includes("${WEB_REACTIVITY_HOST_RUNTIME}")
  || !emittedReactivityRuntimeSource.includes("__velarGraphCreateSet()")
  || !webFoundationSource.includes("__velarGraphSetItems(__velarRuntime.domQueue)")
  || !webEmitterSource.includes("!__velarGraphSame(next, current)")) {
  failures.push("packages/web: emitted reactivity does not consume the canonical captured graph ABI");
}
if (/\bnew (?:Set|Map|WeakSet|WeakMap)\s*\(|\b(?:Set|Map|WeakSet|WeakMap)\.prototype|\bObject\.is\s*\(|\bArray\.isArray\s*\(|\bReflect\.(?:get|set|has|deleteProperty)\s*\(/u.test(emittedReactivityRuntimeSource)) {
  failures.push("packages/web/src/emitter.ts: reactive observers, cells, or queues bypass the captured graph ABI");
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
    failures.push(`packages/web/src/emitter.ts: the ${name} slice escaped the emitted Web runtime template that the ABI gate covers`);
  }
}
if (!emittedWebRuntimeSource.includes("function __velarTick()")
  || !emittedWebRuntimeSource.includes("function __velarReport(value, phase")) {
  failures.push("packages/web/src/emitter.ts: the emitted Web runtime template boundary no longer spans the whole runtime body");
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
    failures.push(`packages/web/src/emitter.ts: the emitted Web runtime ${message} -- '${match[0]}' (runtime-use line ${line})`);
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
  || !webEmitterSource.includes("return __velarManagedAsyncCreate((resolve) => __velarEnqueue(resolve))")) {
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
  failures.push("packages/compiler/src/error-runtime.ts: error normalization bypasses its captured Object/Reflect/Error/String/TypeError ABI");
}
for (const name of ["errorApply", "isError", "normalizeError"]) {
  if (!VELAR_ERROR_NORMALIZATION_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/src/error-runtime.ts: shared error runtime does not export '${name}'`);
  }
}
for (const phrase of [
  "VELAR_ERROR_NORMALIZATION_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE)",
  "normalizeError as __velarNormalizeError",
  "from ${JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE)}",
]) {
  const source = phrase === "VELAR_ERROR_NORMALIZATION_MODULE_SOURCE" ? compilerErrorRuntimeSource : compilerEmitterSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: project error-normalization contract is missing '${phrase}'`);
}
for (const phrase of [
  "const __velarNarrowingNativeTypeError = globalThis.TypeError",
  "class __VelarNarrowingError extends __velarNarrowingNativeTypeError",
  "function __velarNarrow(value, valid, expected, description, offset)",
  "this.name = \"NarrowingError\"",
  "at source offset \" + offset",
]) {
  if (!compilerNarrowingRuntimeSource.includes(phrase)) failures.push(`packages/compiler/src/narrowing-runtime.ts: narrowing runtime is missing '${phrase}'`);
}
for (const phrase of ["__VelarNarrowingError as NarrowingError", "__velarNarrow as narrow"]) {
  if (!VELAR_NARROWING_MODULE_SOURCE.includes(phrase)) failures.push(`packages/compiler/src/narrowing-runtime.ts: shared narrowing runtime does not export '${phrase}'`);
}
for (const phrase of [
  "VELAR_NARROWING_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_NARROWING_MODULE)",
  "narrow as __velarNarrow",
  "from ${JSON.stringify(VELAR_NARROWING_MODULE)}",
  "helpers.push(VELAR_NARROWING_RUNTIME)",
]) {
  const source = phrase === "VELAR_NARROWING_MODULE_SOURCE" ? compilerNarrowingRuntimeSource : compilerEmitterSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: project narrowing-runtime contract is missing '${phrase}'`);
}
if (compilerEmitterSource.includes('"class __VelarNarrowingError extends TypeError')) {
  failures.push("packages/compiler/src/emitter.ts: retains a second inline narrowing runtime");
}
for (const phrase of [
  "WEB_RUNTIME_FOUNDATION_SHARED_ERROR",
  "this.requireRuntimeModule(VELAR_ERROR_NORMALIZATION_MODULE)",
  "errorApply as __velarErrorApply, errorCode as __velarErrorCode, isError as __velarIsError, normalizeError as __velarNormalizeError",
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
  failures.push("packages/compiler/src/json-runtime.ts: strict JSON bypasses its captured validation, snapshot, reflection, text, or Error ABI");
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
  failures.push("packages/compiler/src/text-runtime.ts: String methods bypass the captured Array, text, numeric, Reflect, iterator, or Error ABI");
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
  failures.push("packages/compiler/src/number-runtime.ts: Number methods bypass the captured Math, Number, Reflect, or Error ABI");
}
if (!compilerEmitterSource.includes("helpers.push(VELAR_NUMBER_METHOD_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: Number receiver methods bypass the compiler-owned Number runtime");
}
const primitiveMethodExports = [
  "stringSize", "stringTrim", "stringUpper", "stringLower", "stringSlice", "stringChar", "stringHas", "stringIndex",
  "stringCount", "stringStartsWith", "stringEndsWith", "stringSplit", "stringReplace", "stringReplaceAll",
  "stringPadStart", "stringPadEnd", "stringRepeat", "numberAbs", "numberRound", "numberFloor", "numberCeil", "numberToFixed",
];
for (const name of primitiveMethodExports) {
  if (!VELAR_PRIMITIVE_METHOD_MODULE_SOURCE.includes(` as ${name},`)) {
    failures.push(`packages/compiler/src/primitive-runtime.ts: shared primitive runtime does not export '${name}'`);
  }
}
for (const phrase of [
  "VELAR_TEXT_METHOD_RUNTIME",
  "VELAR_NUMBER_METHOD_RUNTIME",
  "VELAR_PRIMITIVE_METHOD_MODULE_SOURCE",
]) {
  if (!compilerPrimitiveRuntimeSource.includes(phrase)) failures.push(`packages/compiler/src/primitive-runtime.ts: shared primitive runtime is missing '${phrase}'`);
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
  failures.push("packages/compiler/src/collection-runtime.ts: collection identity or runtime-Type traversal bypasses its captured Array, Map, Set, Object, Reflect, iterator, or Error ABI");
}
const runtimeCollectionTypeSource = compilerTypeValidationRuntimeSource;
if (!compilerEmitterSource.includes("helpers.push(VELAR_COLLECTION_IDENTITY_RUNTIME)")) {
  failures.push("packages/compiler/src/emitter.ts: collection identities bypass the compiler-owned runtime");
}
for (const name of VELAR_COLLECTION_HOST_EXPORTS) {
  if (!VELAR_COLLECTION_HOST_MODULE_SOURCE.includes(`  ${name},`)) {
    failures.push(`packages/compiler/src/collection-runtime.ts: shared collection host does not export '${name}'`);
  }
}
for (const phrase of [
  "VELAR_COLLECTION_HOST_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_COLLECTION_HOST_MODULE)",
  "VELAR_COLLECTION_HOST_EXPORTS.filter((name) => directUses.has(name))",
  "if (imports.length > 0)",
  "from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)}",
]) {
  const source = phrase === "VELAR_COLLECTION_HOST_MODULE_SOURCE" ? compilerCollectionRuntimeSource : compilerEmitterSource;
  if (!source.includes(phrase)) failures.push(`packages/compiler: project collection-host contract is missing '${phrase}'`);
}
if (!compilerCollectionRuntimeSource.includes("${VELAR_COLLECTION_IDENTITY_RUNTIME}")
  || !compilerCollectionRuntimeSource.includes("${VELAR_COLLECTION_LIST_RUNTIME}")
  || !compilerCollectionRuntimeSource.includes("${VELAR_COLLECTION_SET_MAP_RUNTIME}")
  || !compilerCollectionRuntimeSource.includes("${VELAR_COLLECTION_RECORD_RUNTIME}")) {
  failures.push("packages/compiler/src/collection-runtime.ts: shared collection host does not compose every canonical host fragment");
}
for (const name of VELAR_COLLECTION_LOWERING_EXPORTS) {
  if (!VELAR_COLLECTION_LOWERING_MODULE_SOURCE.includes(`  ${name},`)) {
    failures.push(`packages/compiler/src/collection-lowering-runtime.ts: shared collection lowering runtime does not export '${name}'`);
  }
}
if (VELAR_COLLECTION_LOWERING_DEPENDENCIES.length !== 2
  || !VELAR_COLLECTION_LOWERING_DEPENDENCIES.includes(VELAR_COLLECTION_HOST_MODULE)
  || !VELAR_COLLECTION_LOWERING_DEPENDENCIES.includes(VELAR_REACTIVE_BRIDGE_MODULE)) {
  failures.push("packages/compiler/src/collection-lowering-runtime.ts: collection lowering dependency closure is incomplete");
}
if (!VELAR_COLLECTION_LOWERING_RUNTIME.includes("__velarReactiveCollectionTrigger(value, __velarReactiveIterateKey, true, true, null, true)")) {
  failures.push("packages/compiler/src/collection-lowering-runtime.ts: keyed collection clear must invalidate every tracked key");
}
for (const phrase of [
  "VELAR_COLLECTION_LOWERING_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_COLLECTION_LOWERING_MODULE)",
  "VELAR_COLLECTION_LOWERING_EXPORTS.filter",
  "...imports.map",
  "from ${JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE)}",
  "helpers.push(VELAR_COLLECTION_LOWERING_RUNTIME)",
]) {
  const source = phrase === "VELAR_COLLECTION_LOWERING_MODULE_SOURCE" ? compilerCollectionLoweringRuntimeSource : compilerEmitterSource;
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
  '() => (${this.emitMappedExpression(value)})',
  '() => (${this.emitMappedExpression(property.value)})',
]) {
  if (!compilerEmitterSource.includes(phrase)) failures.push(`packages/compiler/src/emitter.ts: controlled collection thunk does not parenthesize '${phrase}'`);
}
if (!compilerCollectionLoweringRuntimeSource.includes("from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)}")
  || !compilerCollectionLoweringRuntimeSource.includes("from ${JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE)}")) {
  failures.push("packages/compiler/src/collection-lowering-runtime.ts: shared collection algorithms bypass their host or reactive runtime dependencies");
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
    failures.push(`packages/compiler/src/type-validation-runtime.ts: shared runtime-Type module does not export '${name}'`);
  }
}
for (const phrase of [
  "VELAR_TYPE_VALIDATION_MODULE_SOURCE",
  "this.requireRuntimeModule(VELAR_TYPE_VALIDATION_MODULE)",
  '["registerRuntimeType", "__velarRegisterRuntimeType"]',
  '["recordTypeIs", "__velarRecordTypeIs"]',
  "from ${JSON.stringify(VELAR_TYPE_VALIDATION_MODULE)}",
]) {
  const source = phrase === "VELAR_TYPE_VALIDATION_MODULE_SOURCE" ? compilerTypeValidationRuntimeSource : compilerEmitterSource;
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
  failures.push("packages/compiler/src/type-validation-runtime.ts: runtime Type graph traversal bypasses its captured WeakMap, Set, Promise, reflection, freeze, or Error ABI");
}
const emittedRuntimeTypeDeclarationSource = compilerEmitterSource.slice(compilerEmitterSource.indexOf("  private emitTypeDeclaration"), compilerEmitterSource.indexOf("  private emitClass"));
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
  "class __VelarIndexError extends __velarCollectionListNativeRangeError",
  "function __velarIndex(value, index)",
  "function __velarOptionalIndex(value, index)",
  "function __velarSetIndex(value, index, next)",
]) {
  if (!VELAR_COLLECTION_LOWERING_RUNTIME.includes(phrase)) failures.push(`packages/compiler/src/collection-lowering-runtime.ts: canonical index runtime is missing '${phrase}'`);
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
const emittedRecordLoweringSource = compilerEmitterSource.slice(recordLoweringStart, compilerEmitterSource.indexOf("    if (this.needsObjectBindingHelpers)", recordLoweringStart));
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
const structuralMatchEnd = compilerEmitterSource.indexOf("  protected emitBindingPatternStatements");
const emittedStructuralMatchSource = compilerEmitterSource.slice(compilerEmitterSource.lastIndexOf('case "MatchListPattern"', structuralMatchEnd), structuralMatchEnd);
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
  "${VELAR_UTF8_RUNTIME}",
  "export function utf8Size(value)",
  "return __velarTextCall(__velarTextObjectFreeze",
  "value = __velarTextCall(nativeStringReplaceAll, value",
]) {
  if (!coreTextModuleSource.includes(phrase)) failures.push(`packages/cli: velar/text is missing captured host operation '${phrase}'`);
}
if (/\b(?:Array|String|Number|Math|Object|Reflect)\.(?:isArray|isSafeInteger|isInteger|floor|max|min|getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf|create|freeze)\s*\(|\b(?:String|RegExp)\.prototype\b|\bnew (?:Array|Set|TypeError|RangeError)\b|\.(?:call|push|map|join|slice|replace|replaceAll|split|normalize|toLowerCase|toUpperCase|match)\s*\(|for \(const /u.test(coreTextModuleSource)) {
  failures.push("packages/core/src/index.ts: velar/text bypasses its captured Array, text, RegExp, reflection, numeric, iterator, or Error ABI");
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
  failures.push("packages/compiler/src/type-registry-runtime.ts: runtime Type identity bypasses its captured WeakSet, registry, Reflect, or Error ABI");
}
for (const phrase of [
  "const __velarDeepNativeWeakSet = globalThis.WeakSet",
  "const __velarDeepMapIteratorNext =",
  "const __velarDeepSetIteratorNext =",
  "const __velarDeepWeakSetDelete =",
  "function __velarDeepCall(operation, receiver, arguments_)",
]) {
  if (!coreTestDisplayRuntimeSource.includes(phrase)) failures.push(`packages/cli: test display runtime is missing captured graph operation '${phrase}'`);
}
if (!coreJsonModuleSource.includes("__velarJsonApply(__velarJsonArraySort, keys")) failures.push("packages/cli: velar/json stableStringify must consume the compiler-owned captured JSON sort ABI");
if (/\b(?:Array|Map|Set|WeakSet|Object|Reflect|Symbol)\.(?:isArray|entries|values|has|get|sort|getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf|for)\s*\(|\bnew (?:WeakSet|TypeError|RangeError)\b|\.(?:has|add|delete|entries|values|sort|every|call)\s*\(/u.test(coreTestDisplayRuntimeSource + "\n" + coreJsonModuleSource)) {
  failures.push("packages/core/src/index.ts: velar/json or the test display runtime bypasses its captured graph, order, reflection, Type, or Error ABI");
}
for (const phrase of [
  "const __velarCollectionsNativeArray = globalThis.Array",
  "const __velarCollectionsNativeMap = globalThis.Map",
  "const __velarCollectionsNativeSet = globalThis.Set",
  "const __velarCollectionsArraySort = __velarCollectionsHostOperation",
  "const __velarCollectionsMapGet = __velarCollectionsHostOperation",
  "const __velarCollectionsSetAdd = __velarCollectionsHostOperation",
  "const __velarCollectionsObjectIs = __velarCollectionsHostOperation",
  "const __velarCollectionsNumberIsSafeInteger = __velarCollectionsHostOperation",
  "function __velarCollectionsCall(operation, receiver, arguments_)",
]) {
  if (!coreCollectionsModuleSource.includes(phrase)) failures.push(`packages/cli: velar/collections is missing captured host operation '${phrase}'`);
}
if (/\b(?:Array|Map|Set|Number|Math|Object|Reflect)\.(?:from|isArray|isFinite|isNaN|isSafeInteger|max|min|floor|freeze|is|get|set|has|add)\s*\(|\bnew (?:Array|Map|Set|TypeError|RangeError)\b|\.(?:map|filter|slice|reverse|find|findIndex|some|every|reduce|sort|join|push|get|set|has|add|call)\s*\(/u.test(coreCollectionsModuleSource)) {
  failures.push("packages/core/src/index.ts: velar/collections bypasses its captured Array, Map/Set, numeric, Reflect, or Error ABI");
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
  if (!coreMathModuleSource.includes(phrase)) failures.push(`packages/cli: velar/math is missing captured host operation '${phrase}'`);
}
if (/\b(?:Math|Number)\.(?:abs|acos|asin|atan|atan2|cbrt|cos|exp|floor|hypot|isFinite|isInteger|isSafeInteger|log|log10|log2|max|min|pow|random|sign|sin|sqrt|tan|trunc)\s*\(|\bnew (?:TypeError|RangeError)\s*\(/u.test(coreMathModuleSource)) {
  failures.push("packages/core/src/index.ts: velar/math bypasses its captured numeric, random, Reflect, or Error ABI");
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
  if (!coreUrlModuleSource.includes(phrase)) failures.push(`packages/cli: velar/url is missing captured host operation '${phrase}'`);
}
if (/\b(?:URL|URLSearchParams|Map|Number|String|Object|Array|Reflect)\.(?:append|entries|freeze|getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf|isArray|isFinite|set|toString)\s*\(|\bnew (?:URL|URLSearchParams|Map|TypeError|RangeError|URIError)\b|\.(?:append|charCodeAt|endsWith|entries|set|slice|startsWith|test|toString)\s*\(/u.test(coreUrlModuleSource)) {
  failures.push("packages/core/src/index.ts: velar/url bypasses its captured URL, query, location, collection, text, Reflect, or Error ABI");
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
  if (!coreTimeModuleSource.includes(phrase)) failures.push(`packages/cli: velar/time is missing captured host operation '${phrase}'`);
}
if (/\b(?:Date|Number|Math|Object|Array|String)\.(?:abs|freeze|getOwnPropertyDescriptor|isArray|isFinite|isInteger|isSafeInteger|now|padEnd|slice)\s*\(|\bnew (?:Date|Intl\.DateTimeFormat|Map|Set)\s*\(|\.(?:format|formatToParts|getDate|getDay|getFullYear|getHours|getMilliseconds|getMinutes|getMonth|getSeconds|getTime|getUTCDate|getUTCFullYear|getUTCHours|getUTCMilliseconds|getUTCMinutes|getUTCMonth|getUTCSeconds|setFullYear|setHours|setUTCFullYear|setUTCHours|toISOString)\s*\(/u.test(coreTimeModuleSource)) {
  failures.push("packages/core/src/index.ts: velar/time bypasses its captured clock, date, internationalization, text, collection, or Error ABI");
}
for (const phrase of [
  "const __velarIdCrypto = globalThis.crypto",
  "let __velarIdRandomUuid = null",
  "const __velarIdRegExpTest = __velarIdGetOwnPropertyDescriptor",
  "__velarErrorApply(__velarIdRandomUuid, __velarIdCrypto",
  "__velarErrorApply(__velarIdRegExpTest, uuidPattern",
  "if (__velarIsError(failure)) throw failure",
]) {
  if (!coreIdModuleSource.includes(phrase)) failures.push(`packages/cli: velar/id is missing captured host operation '${phrase}'`);
}
if ((coreIdModuleSource.match(/globalThis\.crypto/gu)?.length ?? 0) !== 1
  || /\b(?:Error\.isError|uuidPattern\.test)\s*\(|\.call\s*\(|\bnew (?:Error|TypeError)\s*\(/u.test(coreIdModuleSource)) {
  failures.push("packages/core/src/index.ts: velar/id bypasses its captured crypto, RegExp, or Error ABI");
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
  if (!coreLogModuleSource.includes(phrase)) failures.push(`packages/cli: velar/log is missing captured host operation '${phrase}'`);
}
if (/\b(?:Date\.now|Number\.isFinite|Math\.abs|Object\.fromEntries)\s*\(|\bPromise\.prototype\.then\b|\bError\.isError\s*\(|\b(?:uuidPattern|String\.prototype)\.(?:test|trim|toLowerCase)\s*\(|\b(?:ranks|sinks)\.(?:get|has|set|add|delete|size|values)\b/u.test(coreLogModuleSource)) {
  failures.push("packages/core/src/index.ts: velar/log bypasses its captured clock, collection, Promise, text, console, or Error ABI");
}
// D50 rule 97.2 and D59 rule 141: the assertion asks the language for both of
// its comparisons -- content equality through `equals` and value equality
// through `==` -- instead of carrying a second implementation of either that
// could disagree with it. `toBe` was native `!==` until rule 141, which made it
// the one comparison in the language that answered differently from the
// language, and NaN was where that showed.
if (!standardModulesSource.includes('const collectionLoweringImport = `import { __velarEquals, __velarSameValueZero } from "${VELAR_COLLECTION_LOWERING_MODULE}";`;')) {
  failures.push("packages/core/src/index.ts: velar/test must import the Core __velarEquals and __velarSameValueZero rather than restate a comparison");
}
for (const phrase of [
  "${collectionLoweringImport}",
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
  if (!coreTestModuleSource.includes(phrase)) failures.push(`packages/cli: velar/test is missing captured host operation '${phrase}'`);
}
if (/\b(?:Array\.isArray|Number\.isSafeInteger|JSON\.stringify|Math\.min|Object\.(?:freeze|getOwnPropertyDescriptor|getOwnPropertyNames|getOwnPropertySymbols|getPrototypeOf)|Reflect\.apply)\s*\(|\b(?:Map|Set|WeakSet|String|Promise|RegExp)\.prototype\b|\bnew (?:WeakSet|Error|TypeError|RangeError)\b|\.(?:call|push|join|slice|map|includes)\s*\(/u.test(coreTestModuleSource)) {
  failures.push("packages/core/src/index.ts: velar/test bypasses its captured display, collection, text, Promise, RegExp, reflection, or Error ABI");
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
if (!webFoundationSource.includes("webRuntimeFoundation(WEB_ERROR_HOST_RUNTIME)")
  || !webFoundationSource.includes("webRuntimeFoundation(WEB_ERROR_HOST_RUNTIME_BODY)")
  || !webFoundationSource.includes("${errorHostRuntime}")
  || !webOwnedCallbackRuntimeSource.includes("${WEB_ERROR_HOST_RUNTIME}")
  || !webOwnedCallbackRuntimeSource.includes("__velarObservePromise(result")
  || !webAppModuleSource.includes("__velarGraphSetInsert(__velarRuntime.errorHandlers, handler)")
  || !webAppModuleSource.includes("if (!__velarIsError(error))")) {
  failures.push("packages/web: report, velar/app, or owned callbacks do not share the captured error host ABI");
}
if (/\bPromise\.prototype\.then|\bError\.isError\s*\(|\berrorHandlers\.(?:has|add|delete)\s*\(/u.test(webOwnedCallbackRuntimeSource + "\n" + webAppModuleSource)) {
  failures.push("packages/web/src/runtime.ts: Web error callbacks or velar/app bypass the captured error/handler ABI");
}
const desktopHostRuntimeUses = desktopCompilerSource.match(/\$\{DESKTOP_HOST_ABI_RUNTIME\}/gu)?.length ?? 0;
if (desktopHostRuntimeUses !== 6
  || /Object\.getOwnPropertyDescriptor\(globalThis, bridgeKey\)|\bbridge\.invoke\s*\(|globalThis\[runtimeKey\]/u.test(desktopCompilerSource)) {
  failures.push("packages/desktop/src/compiler.ts: a Desktop target module bypasses the captured host bridge ABI");
}
for (const phrase of [
  "const hostJsonStringify = JSON.stringify",
  "const hostMapGet = Map.prototype.get",
  "const hostPostMessage = hostMessageHandler.postMessage",
  "const hostTextEncode = TextEncoder.prototype.encode",
  "process.terminationHandler =",
  'case "process-owned":',
  "for pid in owner.pids { _ = Darwin.kill(-pid, SIGKILL) }",
]) {
  if (!desktopNativeHostSource.includes(phrase)) {
    failures.push(`packages/desktop/native/macos/VelarDesktopHost.swift: missing captured bridge operation '${phrase}'`);
  }
}
for (const phrase of [
  'export async function selectProjectDirectory() { return optionalPath("selectProjectDirectory", 0); }',
  // Read per resolution rather than once at module load: D60 rule 153 moved
  // capability failure to the call, and the grant a project selection changes
  // is exactly the value that must not be frozen at import time.
  'const provider = __velarDesktopHostField("projectDirectoryValue")',
]) {
  if (!desktopCompilerSource.includes(phrase)) {
    failures.push(`packages/desktop/src/compiler.ts: missing dynamic project grant operation '${phrase}'`);
  }
}
for (const phrase of [
  'const generationBytes = new hostUint8Array(16)',
  'const complete = (owner, message) =>',
  'private var pending: [Int: PendingRequest] = [:]',
  'forwarded["owner"] = request.generation',
  'func webView(_ webView: WKWebView, didCommit navigation:',
  'worker.retire(generation: generation)',
  'request.owner !== activeOwner',
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

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && /\.(?:ts|js|mjs|swift)$/u.test(path)) files.push(path);
  }
  return files.sort();
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

function constantSource(source, name, endMarker) {
  const startMarker = `const ${name} = String.raw\``;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    failures.push(`cannot locate generated runtime constant '${name}'`);
    return "";
  }
  return source.slice(start, end);
}

function display(file) {
  return relative(root, file);
}
