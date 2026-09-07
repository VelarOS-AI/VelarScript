import { type CompilerExtension, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import {
  VELAR_ERROR_NORMALIZATION_MODULE,
  VELAR_COLLECTION_LOWERING_MODULE,
  type AnalysisContext,
  type CompilerAnalysisExtension,
  type CompilerEmitterOptions,
  type CompilerLexicalExtension,
  type ExtensionValueType,
  type LoweringHints,
  type Token,
} from "@velarscript/compiler/extension";
import { nodeModuleEntries } from "./module-policy.ts";
import { velarNodeServeSource } from "./modules/serve.ts";
import {
  VELAR_NODE_ENV_RUNTIME,
  VELAR_NODE_FS_MODULE_SOURCE,
  VELAR_NODE_HOST_RUNTIME,
  VELAR_NODE_HTTP_RUNTIME,
  VELAR_NODE_PATH_MODULE_SOURCE,
  VELAR_NODE_PROCESS_MODULE_SOURCE,
  VELAR_NODE_SERVER_TEST_MODULE_SOURCE,
  VELAR_NODE_TERMINAL_MODULE_SOURCE,
  VELAR_NODE_WEBSOCKET_RUNTIME,
  VELAR_NODE_WORKER_RUNTIME,
  VELAR_SHARED_NODE_HOST_RUNTIME,
} from "./runtime-sources.generated.ts";
import { NODE_STATEMENT_CONSTRUCTS, nodeServerStatementContainsDirectAwait, nodeStatementConstructKey } from "./server-ast.ts";
import { inferNodeIntrinsic, VelarNodeAnalyzer } from "./server-analyzer.ts";
import { NodeJavaScriptEmitter } from "./server-emitter.ts";
import { velarNodeInspectionExtension } from "./server-inspection.ts";
import { scanNodePathPatternForFormatting, scanNodeToken } from "./server-lexer.ts";
import { VelarNodeParser } from "./server-parser.ts";
import { nodeKeywordDocumentation } from "./server-documentation.ts";
import { velarNodeSemanticExtension } from "./server-semantic.ts";
import { VELAR_ROUTE_PATTERN_IDENTITY } from "./server-types.ts";

// The Desktop target of `velar/process` inlines this same host-intrinsic
// boundary, and reaches it here rather than restating a second copy of it.
export { VELAR_PROCESS_HOST_RUNTIME } from "./runtime-sources.generated.ts";

export const VELAR_NODE_API_VERSION = "0.17";
export const VELAR_NODE_HOST_MODULE = "velar/node-host-v1";

/**
 * The `velar/*` surfaces this capability publishes. One `modules/<surface>.ts`
 * file owns each entry's tables; `module-policy.ts` owns the roster they are
 * assembled in, because every rule about a Node module reads that same list.
 */
export const nodeModuleInterfaces: ReadonlyMap<string, ModuleInterface> = new Map(nodeModuleEntries);

export const nodeModuleSources: ReadonlyMap<string, string> = new Map([
  ["velar/server-test", VELAR_NODE_SERVER_TEST_MODULE_SOURCE],
  ["velar/websocket", VELAR_NODE_WEBSOCKET_RUNTIME],
  ["velar/worker", VELAR_NODE_WORKER_RUNTIME],
  [VELAR_NODE_HOST_MODULE, VELAR_SHARED_NODE_HOST_RUNTIME],
  ["velar/fs", VELAR_NODE_FS_MODULE_SOURCE],
  ["velar/path", VELAR_NODE_PATH_MODULE_SOURCE],
  ["velar/process", VELAR_NODE_PROCESS_MODULE_SOURCE],
  ["velar/http", VELAR_NODE_HTTP_RUNTIME],
  ["velar/env", VELAR_NODE_ENV_RUNTIME],
  ["velar/host", VELAR_NODE_HOST_RUNTIME],
  ["velar/terminal", VELAR_NODE_TERMINAL_MODULE_SOURCE],
  // D90 R19(c): `velar/serve` closes over the one route-shape definition, read off
  // the compiled function the analyzer calls, so it is assembled, not generated.
  ["velar/serve", velarNodeServeSource()],
]);

export const nodeModuleDependencies: ReadonlyMap<string, readonly string[]> = new Map([
  ["velar/server-test", ["velar/serve"]],
  ["velar/worker", ["velar/worker-manifest", "velar/task", "velar/binary"]],
  ["velar/websocket", ["velar/serve", "velar/host"]],
  ["velar/http", [VELAR_NODE_HOST_MODULE, "velar/binary"]],
  ["velar/fs", [VELAR_NODE_HOST_MODULE, "velar/binary"]],
  ["velar/serve", [VELAR_NODE_HOST_MODULE, VELAR_ERROR_NORMALIZATION_MODULE, VELAR_COLLECTION_LOWERING_MODULE, "velar/binary", "velar/fs", "velar/hash", "velar/host", "velar/task"]],
  // D50 rule 89: the host proxy rebuilds the compiler-owned capability error
  // classes, so its module carries that dependency edge.
  [VELAR_NODE_HOST_MODULE, [VELAR_ERROR_NORMALIZATION_MODULE]],
]);

export { isNodeModule, isNodeOnlyModule, nodeModuleDiagnostic } from "./module-policy.ts";

export const velarNodeCompilerExtension: CompilerExtension = Object.freeze({
  id: "@velarscript/node",
  contract: Object.freeze({ protocolVersion: 1, apiVersion: VELAR_NODE_API_VERSION, kind: "capability", extends: Object.freeze({}) }),
  capabilities: Object.freeze(["node"]),
  formatting: Object.freeze({
    scanOpaqueSource: scanNodePathPatternForFormatting,
  }),
  lexical: Object.freeze({
    contextualKeywords: new Set(["server"]),
    scan: scanNodeToken,
  }),
  parser: Object.freeze({
    create(tokens: readonly Token[], lexicalExtensions: readonly CompilerLexicalExtension[]) {
      return new VelarNodeParser(tokens, lexicalExtensions);
    },
  }),
  syntax: Object.freeze({
    statementConstructs: NODE_STATEMENT_CONSTRUCTS,
    statementConstructKey: nodeStatementConstructKey,
  }),
  analyzer: Object.freeze({
    create(context: AnalysisContext, extensions: readonly CompilerAnalysisExtension[]) {
      return new VelarNodeAnalyzer(context, extensions);
    },
  }),
  semantic: velarNodeSemanticExtension,
  inspection: velarNodeInspectionExtension,
  analysis: Object.freeze({
    directAwaitStatement: nodeServerStatementContainsDirectAwait,
    inferIntrinsic: inferNodeIntrinsic,
    memberType(type: ExtensionValueType, property: string) {
      if (type.extensionId === "@velarscript/node" && type.family === "serve-route-path") {
        return type.properties.get(property) ?? null;
      }
      return undefined;
    },
    textForm(type: ValueType) {
      if (type.kind === "named" && type.identity === VELAR_ROUTE_PATTERN_IDENTITY) return true;
      return type.kind === "extension" && type.extensionId === "@velarscript/node" && type.family === "serve-route-path" ? true : undefined;
    },
    // The Node guide already rules that the ambient Node globals are not the
    // door — "use velar/fs, velar/path, velar/process, velar/env,
    // velar/terminal, velar/http, velar/worker, and velar/websocket instead of
    // ambient Node globals" — but the rule had no enforcement arm, so every
    // one of those names fell through to a bare `Unknown name`. The Web
    // surface answers the same class of mistake with the module that replaced
    // it; this is the Node half of that answer.
    //
    // Only the names a Node reflex reaches for live here. The target-neutral
    // globals (setTimeout, structuredClone, URL, RegExp, TextEncoder,
    // AbortController, Symbol) are answered once in Core's own roster, and
    // localStorage/sessionStorage belong to Web — one mistake keeps one
    // answer, in one file.
    //
    // `module` is not listed: it is a VelarScript keyword, so it never reaches
    // name resolution and already reports that it cannot be a name.
    globalGuidance: new Map([
      // The three uses a Node author spells `process` for are three different
      // modules, so the message names all three rather than guessing. There is
      // no argv or cwd successor in the registry, so it names none.
      ["process", `Use "velar/env" 'get'/'require' for environment variables, "velar/process" 'run'/'start' to run a child process, and "velar/host" 'exit' to stop this one; VelarScript has no ambient process global`],
      ["Buffer", `Import from "velar/binary" — 'Bytes' and the typed buffers — instead of the Buffer global`],
      ["require", `VelarScript modules use 'import {name} from "..."'; there is no require`],
      ["exports", `VelarScript modules use 'export' on the declaration itself; there is no exports object`],
      ["global", "VelarScript has no ambient global object; import the capability you need"],
      ["__dirname", `Use "velar/path" — 'resolve', 'join', 'dirname', 'basename' — to build a path; a module's own address is not an ambient global`],
      ["__filename", `Use "velar/path" — 'resolve', 'join', 'dirname', 'basename' — to build a path; a module's own address is not an ambient global`],
      // Word for word the Web extension's sentence: one mistake, one answer,
      // on both surfaces.
      ["fetch", "Use velar/http instead of the raw fetch global"],
      // The sentence quoted above names velar/websocket too, and Node 22 does
      // carry an ambient `WebSocket`, so the reflex reaches this surface the
      // same way `fetch` does. The successor is extension-owned rather than
      // Core's, which is why it is answered here: a browser can only
      // `connect`, while this surface can `listen` as well.
      ["WebSocket", `Use "velar/websocket" — 'connect' opens a connection and 'listen' accepts them — instead of the WebSocket global`],
      // The `const path = require("path")` reflex reaches this surface as a
      // bare *module specifier* rather than as a global, and it is the one
      // shape in this file that answered wrongly rather than emptily: `path`
      // earned `did you mean 'Math'?`, a confident guess at an unrelated
      // namespace, which is the worst way a rejection can miss.
      //
      // These names are Node's own — a Core author never writes
      // `worker_threads` — so the Node extension answers them even where the
      // successor module belongs to Core. Core's roster holds none of them, so
      // no mistake gains a second answer; the test asserts that boundary.
      ["path", `Import what you need — 'import {join, resolve, dirname, basename} from "velar/path"' — VelarScript has no bare module names`],
      ["fs", `Import what you need — 'import {readText, writeText, exists, list} from "velar/fs"' — VelarScript has no bare module names`],
      ["http", `Import the client — 'import {http} from "velar/http"' — then call 'http.get(url)'; VelarScript has no bare module names`],
      ["url", `Import what you need — 'import {parse, join, withQuery, encode} from "velar/url"' — VelarScript has no bare module names`],
      ["child_process", `Import from "velar/process" — 'run' waits for a command and 'start' keeps a child running — VelarScript has no bare module names`],
      ["worker_threads", `Import from "velar/worker" — 'worker' starts one typed worker and 'workerPool' runs several — VelarScript has no bare module names`],
      // 每种密码学相关用途都保留独立、明确的契约：标识符、可复现随机流和有界
      // 文本摘要不是同一种能力。通用加密接口需要先明确密钥、nonce、字节数据和
      // 生命周期规则，因此在出现具体需求之前不加入标准 API。
      ["crypto", `Use 'import {uuid} from "velar/id"' for an identifier, "velar/random" 'random(seed)' for a reproducible stream, or 'import {sha256Text} from "velar/hash"' for a bounded UTF-8 SHA-256 digest; VelarScript has no general cipher module`],
      // Core answers `setTimeout`/`setInterval` because both hosts carry them.
      // `setImmediate` is Node's alone, so its answer is here rather than a
      // second copy there.
      ["setImmediate", "Use 'await Promise.sleep(0ms)' to yield before the work, or velar/task's 'task(work)' to run it alongside; VelarScript has no callback scheduler"],
      ["clearImmediate", "There is no callback scheduler to clear; 'await Promise.sleep(0ms)' yields inline, and velar/task's 'task(work)' is the schedule a Cancellation can stop"],
    ]),
  }),
  modules: Object.freeze({
    apiVersion: VELAR_NODE_API_VERSION,
    interfaces: nodeModuleInterfaces,
    sources: nodeModuleSources,
    dependencies: nodeModuleDependencies,
    // D114 F7-node-b item 2: `velar/serve` is the one module a build parameterizes; modules/serve.ts says with what.
    source: (specifier: string, config: unknown) => specifier === "velar/serve" ? velarNodeServeSource(config) : null,
  }),
  editor: Object.freeze({
    keywordDocumentation: nodeKeywordDocumentation,
  }),
  createEmitter(
    hints: LoweringHints,
    forcedFunctionExports: ReadonlySet<string>,
    _resourceContents: ReadonlyMap<string, string>,
    _extensionImports: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
    options: CompilerEmitterOptions,
  ) {
    return new NodeJavaScriptEmitter(hints, forcedFunctionExports, options);
  },
});

/** Conventional package entry used by the project extension loader. */
export const velarCompilerExtension = velarNodeCompilerExtension;

export { MAX_PROJECT_NAME_LENGTH, nodeProjectIdentity, velarNodeServeProjectConfig, velarProjectExtension, type VelarNodeConfig } from "./project-config.ts";
export {isNodeRouteInputType, nodeProviderType, nodeRouteInputValue} from "./server-types.ts";
