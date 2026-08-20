import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import {
  compile,
  CORE_CONTEXTUAL_KEYWORD_WORDS,
  CORE_PRELUDE_NAMES,
  formatSource,
  isSourceIdentifierPart,
  keywordKinds,
  PERMANENT_NAMESPACE_NAMES,
  permanentNamespaceCoveringModule,
  type CorePreludeName,
  type Diagnostic,
  type PermanentNamespaceName,
  type SourceText,
  type Span,
} from "@velarscript/compiler";
import { standardModuleInterfaces } from "./standard-modules.ts";
import type { ProjectModule, ProjectResult } from "./project.ts";
import { VelarProjectSessions } from "./project-session.ts";
import { VELAR_VERSION } from "./version.ts";
import { hostErrorMessage } from "./host-error.ts";
import { canonicalizePotentialPath, canonicalPathWithinCanonicalRoot } from "./canonical-path.ts";
import { buildOwnershipGraph, ownershipGraphRevision } from "./ownership-graph.ts";
import {
  type ProjectSemanticToken,
  projectDefinitionAt,
  projectCompletionsAt,
  projectCompletionContextAt,
  projectDocumentSymbols,
  projectExpressionAt,
  projectMemberSymbolAt,
  projectPrepareRenameAt,
  projectReferencesAt,
  projectRenameAt,
  projectSemanticTokens,
  projectSignatureAt,
  projectSymbolAt,
  projectWorkspaceSymbols,
} from "./project-semantic.ts";
import {
  MAX_WORKSPACE_SEARCH_RESULTS,
  MAX_WORKSPACE_TEXT_FILES,
  MAX_WORKSPACE_CHANGE_PATHS,
  MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS,
  MAX_WORKSPACE_CHANGE_TEXT_CODE_UNITS,
  WORKSPACE_TEXT_EXTENSIONS,
  WorkspaceIndexCancelledError,
  WorkspaceTextIndex,
  type WorkspaceIndexActivity,
  type WorkspaceIndexPosition,
} from "./workspace-index.ts";

interface RpcMessage {
  readonly jsonrpc: "2.0";
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
}

interface TextDocument {
  readonly uri: string;
  readonly languageId: string;
  readonly version: number;
  readonly text: string;
}

interface Position {
  readonly line: number;
  readonly character: number;
}

interface Range {
  readonly start: Position;
  readonly end: Position;
}

interface ContentChange {
  readonly range?: Range;
  readonly text: string;
}

export const VELAR_LANGUAGE_SERVER_PROTOCOL_VERSION = 5;
type PositionEncoding = "utf-16" | "utf-32";
let activePositionEncoding: PositionEncoding = "utf-16";
let confinedWorkspaceRoot: string | null = null;
let confinedCanonicalRoot: string | null = null;
const MAX_LSP_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_LSP_RESULT_ITEMS = 10_000;
const MAX_LSP_TEXT_CHARS = 64 * 1024;
const MAX_EMITTED_JAVASCRIPT_CHARS = 4 * 1024 * 1024;
const MAX_OWNERSHIP_GRAPH_NODES = 20_000;
const MAX_OWNERSHIP_GRAPH_EDGES = 40_000;
const semanticTokenTypes = [
  "type", "class", "enum", "enumMember", "function", "method", "property", "variable", "parameter",
  "interface", "comment", "string", "keyword", "number", "regexp", "operator",
] as const;
const semanticTokenModifiers = ["declaration", "readonly", "static"] as const;
const nonVelarDocumentResults = new Map<string, unknown>([
  ["textDocument/completion", { isIncomplete: false, items: [] }],
  ["textDocument/hover", null],
  ["textDocument/definition", null],
  ["textDocument/references", []],
  ["textDocument/documentHighlight", []],
  ["textDocument/prepareRename", null],
  ["textDocument/rename", null],
  ["textDocument/documentSymbol", []],
  ["textDocument/signatureHelp", null],
  ["textDocument/inlayHint", []],
  ["textDocument/semanticTokens/full", { data: [] }],
  ["textDocument/codeAction", []],
  ["textDocument/formatting", []],
]);

const keywordDocumentation = new Map<string, string>([
  ["assert", "Requires a boolean or optional invariant and narrows stable values in following statements."],
  ["not", "Negates a checked condition; use `not in` for negative membership and `is not` for a negative runtime type test."],
  ["in", "Tests List, Set, Map, Record, or string membership; `not in` is its direct negative form."],
  ["is", "Tests a value against a runtime type and narrows stable locations; `is not` is its direct negative form."],
  ["constructor", "Initializes class fields and calls super(...) first when the class extends another class."],
  ["type", "Declares one data shape used for static checking and runtime validation."],
  ["enum", "Declares a finite set of string-backed values for application states."],
  ["abstract", "Marks a class, instance method, or getter as an incomplete behavior contract."],
  ["extends", "Declares one base class or one concrete record base; classes call super(...) while record types inherit fields and validation."],
  ["override", "Explicitly replaces a compatible inherited instance method or getter."],
  ["private", "Keeps one class field, getter, or method inside its declaring class."],
  ["static", "Declares a field, getter, or method on the class rather than an instance."],
  ["get", "Declares a typed read-only property computed when it is read."],
  ["super", "Calls the base constructor or reads and calls inherited behavior."],
  ["def", "Declares a named function with an indentation-based body."],
  ["match", "Selects literal, enum, type, object, or List patterns with bindings and guards, without fallthrough."],
  ["case", "Declares a match pattern; object and List patterns may destructure values with ...rest and as bindings."],
  ["const", "Declares an initialized binding that cannot be rebound."],
  ["let", "Declares an initialized binding that can be rebound."],
  ["readonly", "Creates a transitive compile-time view over data records and collections without changing runtime identity."],
  ["null", "The only empty value in ordinary VelarScript source; undefined is not exposed."],
]);

const builtinTypeDocumentation = new Map<string, string>([
  ["string", "A JavaScript string with VelarScript text operations."],
  ["number", "A JavaScript number type; number(text) strictly parses complete finite decimal text and returns number?."],
  ["bool", "The `true` or `false` boolean type."],
  ["unknown", "An unchecked boundary value that must be validated before ordinary use."],
  ["List", "An ordered collection with one checked element type."],
  ["Map", "An insertion-ordered JavaScript Map with checked key and value types."],
  ["Record", "A JSON-safe plain record with dynamic string keys and one checked value type."],
  ["Set", "An insertion-ordered JavaScript Set with one checked element type."],
  ["Promise", "A JavaScript Promise with one checked resolved-value type."],
  ["Duration", "A Core duration value written with an ms or s suffix."],
]);

// D57 rules 134/136: both halves of this list are derived. The prelude and
// namespace entries are keyed by the Core vocabulary roster, so a name added
// there cannot be missing here — the hand-kept version had already lost `Math`
// and `number`. The module entries are filtered by the migration state, so a
// completion cannot offer an import VEL3008 refuses on the next keystroke.
const corePreludeCompletionDetail: Record<CorePreludeName, string> = {
  number: "number(text) -> number? — text to number, null when the text is not numeric",
  str: "str(value) -> string",
  print: "print(value) -> null",
  equals: "equals(a, b) -> bool — deep structural comparison over data",
  range: "range(stop) or range(start, stop, step) -> List<number>",
};

const permanentNamespaceCompletionDetail: Record<PermanentNamespaceName, string> = {
  Json: "Permanent namespace for parse, tryParse, stringify, stableStringify, clone, and isSerializable",
  Promise: "Permanent namespace for all, race, sleep, timeout, retry, map, and series",
  Text: "Permanent namespace for Unicode-aware text normalization, formatting, code points, and patterns",
  Math: "Permanent namespace for numeric constants, transforms, transcendentals, and random helpers",
};

const standardModuleCompletionDetail = new Map([
  ["velar/collections", "Typed collection transforms and Python-style iteration helpers"],
  ["velar/math", "Numeric constants, transforms, and random helpers"],
  ["velar/async", "Promise composition, timeout, retry, and concurrency helpers"],
  ["velar/url", "URL parsing, joining, encoding, and query helpers"],
  ["velar/time", "Timestamps, ISO values, formatting, and date-part helpers"],
  ["velar/id", "Secure host UUID generation and validation"],
  ["velar/log", "Structured leveled logging with scoped loggers and replaceable sinks"],
  ["velar/test", "Typed deep, collection, error, and Promise assertions"],
]);

function importableStandardModules(): readonly { readonly label: string; readonly kind: number; readonly detail: string }[] {
  const interfaces = standardModuleInterfaces();
  return [...standardModuleCompletionDetail]
    .filter(([source]) => permanentNamespaceCoveringModule(source, interfaces.get(source)?.exports.keys() ?? []) === null)
    .map(([label, detail]) => ({ label, kind: 9, detail }));
}

/**
 * D62 rule 157: the editor's keyword list is the lexer's hard-keyword table
 * plus Core's contextual roster, read rather than retyped. The hand-kept copy
 * this replaced held thirty-nine labels and was a partial copy of both: it had
 * never learned `js`, `unsafe`, `extern`, `module`, `break`, `continue` or
 * `is`, and it knew six of the ten contextual words. Neither omission could
 * have been noticed by anything but a reader counting two lists by hand.
 */
const coreCompletionItems = [
  ...[...Object.keys(keywordKinds), ...CORE_CONTEXTUAL_KEYWORD_WORDS].map((label) => ({ label, kind: 14 })),
  ...[...builtinTypeDocumentation].map(([label, detail]) => ({ label, kind: 7, detail })),
  ...CORE_PRELUDE_NAMES.map((label) => ({ label, kind: 3, detail: corePreludeCompletionDetail[label] })),
  ...PERMANENT_NAMESPACE_NAMES.map((label) => ({ label, kind: 6, detail: permanentNamespaceCompletionDetail[label] })),
  ...importableStandardModules(),
];

export function completionItemsFor(project: ProjectResult | null): readonly { readonly label: string; readonly kind: number; readonly detail?: string }[] {
  if (!project) return coreCompletionItems;
  return [
    ...coreCompletionItems,
    ...project.compilerExtensions.flatMap((extension) => [
      ...(extension.editor?.completions ?? []),
      ...Object.entries(extension.editor?.typeDocumentation ?? {}).map(([label, detail]) => ({ label, kind: 7, detail })),
    ]),
  ];
}

function extensionDocumentation(
  project: ProjectResult | null,
  kind: "keywordDocumentation" | "typeDocumentation",
  word: string,
): string | undefined {
  for (const extension of project?.compilerExtensions ?? []) {
    const documentation = extension.editor?.[kind]?.[word];
    if (documentation) return documentation;
  }
  return undefined;
}

export async function runLanguageServer(): Promise<void> {
  activePositionEncoding = "utf-16";
  confinedWorkspaceRoot = configuredWorkspaceRoot();
  const configuredCanonical = configuredCanonicalRoot() ?? confinedWorkspaceRoot;
  confinedCanonicalRoot = configuredCanonical ? await canonicalizePotentialPath(configuredCanonical) : null;
  const documents = new Map<string, TextDocument>();
  const sessions = new VelarProjectSessions();
  const workspaceIndex = new WorkspaceTextIndex();
  const pendingRequests = new Set<string>();
  const cancelledRequests = new Set<string>();
  const diagnosticUris = new Set<string>();
  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();
  let diagnosticTask: Promise<void> | null = null;
  let workspaceIndexTask: Promise<void> = Promise.resolve();
  let workspaceIndexFailure: string | null = null;
  let shuttingDown = false;
  let finish: () => void = () => {};
  const exitRequested = new Promise<void>((resolve) => { finish = resolve; });

  const send = (message: unknown): void => {
    const json = JSON.stringify(message);
    if (Buffer.byteLength(json, "utf8") <= MAX_LSP_MESSAGE_BYTES) {
      process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
      return;
    }
    const value = message as Record<string, unknown>;
    const fallback = value.id !== undefined
      ? { jsonrpc: "2.0", id: value.id ?? null, error: { code: -32603, message: "VelarScript LSP response exceeds the 16 MiB transport limit" } }
      : value.method === "textDocument/publishDiagnostics"
        ? oversizedDiagnosticsFallback(value.params)
        : null;
    if (!fallback) return;
    const fallbackJson = JSON.stringify(fallback);
    process.stdout.write(`Content-Length: ${Buffer.byteLength(fallbackJson, "utf8")}\r\n\r\n${fallbackJson}`);
  };

  const overrides = (): Map<string, string> => new Map([...documents.values()].flatMap((item) => {
    if (!isVelarDocument(item)) return [];
    const itemPath = pathOf(item.uri);
    return itemPath ? [[itemPath, item.text] as const] : [];
  }));
  const projectFor = async (document: TextDocument): Promise<ProjectResult | null> => {
    if (!isVelarDocument(document)) return null;
    const path = pathOf(document.uri);
    if (!path) return null;
    return (await sessions.update(path, new Set(), overrides())).project;
  };
  const queueWorkspaceIndex = (operation: () => Promise<WorkspaceIndexActivity>): Promise<WorkspaceIndexActivity> => {
    const result = workspaceIndexTask.then(operation);
    workspaceIndexTask = result.then(
      () => { workspaceIndexFailure = null; },
      (error) => { workspaceIndexFailure = hostErrorMessage(error); },
    );
    return result;
  };
  const waitForWorkspaceIndex = async (id: RpcMessage["id"]): Promise<void> => {
    while (true) {
      if (id !== undefined && cancelledRequests.has(requestKey(id))) throw new WorkspaceIndexCancelledError();
      const task = workspaceIndexTask;
      let settled = false;
      await Promise.race([
        task.then(() => { settled = true; }),
        new Promise<void>((resolveWait) => setImmediate(resolveWait)),
      ]);
      if (settled && task === workspaceIndexTask) break;
    }
    if (workspaceIndexFailure) throw new Error(`Workspace index unavailable: ${workspaceIndexFailure}`);
  };

  const publish = async (document: TextDocument): Promise<void> => {
    const current = documents.get(document.uri);
    if (!current || current.version !== document.version) return;
    if (!isVelarDocument(document)) {
      send({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri: document.uri, version: document.version, diagnostics: [] },
      });
      return;
    }
    let diagnostics: readonly Diagnostic[] = [];
    let notices: readonly string[] = [];
    let source: SourceText;
    try {
      const path = pathOf(document.uri);
      if (path) {
        const project = await projectFor(document);
        const module = project?.modules.find((item) => item.inputPath === path);
        if (module) {
          diagnostics = [
            ...module.result.diagnostics,
            ...(project?.failures ?? [])
              .filter((failure) => failure.path === path)
              .map((failure) => ({ code: "VEL9001", message: failure.message, span: { start: 0, end: 1 } })),
          ];
          notices = (project?.notices ?? []).filter((notice) => notice.path === path).map((notice) => notice.message);
          source = module.result.source;
        } else {
          const result = compile(document.text, { path });
          diagnostics = result.diagnostics;
          source = result.source;
        }
      } else {
        const result = compile(document.text, { path: document.uri });
        diagnostics = result.diagnostics;
        source = result.source;
      }
    } catch (error) {
      const result = compile(document.text, { path: document.uri });
      diagnostics = [{ code: "VEL9001", message: hostErrorMessage(error), span: { start: 0, end: 1 } }];
      source = result.source;
    }
    if (documents.get(document.uri)?.version !== document.version) return;
    send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: document.uri,
        version: document.version,
        diagnostics: boundedDiagnostics(source, diagnostics, notices),
      },
    });
  };

  const schedulePublish = (uri: string): void => {
    diagnosticUris.add(uri);
    if (diagnosticTask) return;
    diagnosticTask = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        while (diagnosticUris.size > 0) {
          const uris = [...diagnosticUris];
          diagnosticUris.clear();
          for (const pendingUri of uris) {
            const document = documents.get(pendingUri);
            if (document) await publish(document);
          }
        }
      })
      .finally(() => {
        diagnosticTask = null;
        if (diagnosticUris.size > 0) schedulePublish([...diagnosticUris][0]!);
      });
  };

  const refreshWorkspaceProjects = async (changedPaths: ReadonlySet<string> | null): Promise<void> => {
    const currentOverrides = overrides();
    const roots = new Map<string, string>();
    for (const document of documents.values()) {
      if (!isVelarDocument(document)) continue;
      const documentPath = pathOf(document.uri);
      if (!documentPath) continue;
      roots.set(sessions.rootFor(documentPath) ?? documentPath, documentPath);
    }
    for (const documentPath of roots.values()) {
      if (changedPaths) await sessions.update(documentPath, changedPaths, currentOverrides);
      else await sessions.snapshot(documentPath, currentOverrides);
    }
    for (const document of documents.values()) schedulePublish(document.uri);
  };

  const finishRequest = (id: RpcMessage["id"]): boolean => {
    if (id === undefined) return false;
    const key = requestKey(id);
    pendingRequests.delete(key);
    return cancelledRequests.delete(key);
  };
  const respond = (id: RpcMessage["id"], result: unknown): void => {
    if (finishRequest(id)) {
      send({ jsonrpc: "2.0", id: id ?? null, error: { code: -32800, message: "Request cancelled" } });
      return;
    }
    send({ jsonrpc: "2.0", id: id ?? null, result });
  };
  const respondError = (id: RpcMessage["id"], message: string, code = -32803): void => {
    if (finishRequest(id)) {
      send({ jsonrpc: "2.0", id: id ?? null, error: { code: -32800, message: "Request cancelled" } });
      return;
    }
    send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  };
  const handle = async (message: RpcMessage): Promise<void> => {
    if (message.id !== undefined && cancelledRequests.has(requestKey(message.id))) {
      respondError(message.id, "Request cancelled", -32800);
      return;
    }
    if (shuttingDown && message.method !== "exit") {
      if (message.id !== undefined) respondError(message.id, "VelarScript Language Server is shutting down", -32600);
      return;
    }
    const params = message.params as Record<string, unknown> | undefined;
    if (message.id !== undefined && message.method && nonVelarDocumentResults.has(message.method)) {
      const descriptor = params?.textDocument as Pick<TextDocument, "uri"> | undefined;
      const document = descriptor?.uri ? documents.get(descriptor.uri) : undefined;
      if (document && !isVelarDocument(document)) {
        respond(message.id, nonVelarDocumentResults.get(message.method));
        return;
      }
    }
    switch (message.method) {
      case "initialize":
        activePositionEncoding = requestedPositionEncoding(params);
        try {
          workspaceIndex.configure(requestedWorkspaceRoots(params));
        } catch (error) {
          respondError(message.id, hostErrorMessage(error), -32602);
          break;
        }
        respond(message.id, {
          capabilities: {
            positionEncoding: activePositionEncoding,
            textDocumentSync: { openClose: true, change: 2, save: { includeText: true } },
            completionProvider: { triggerCharacters: [".", "<", " ", "{", ",", ":"] },
            hoverProvider: true,
            documentFormattingProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            documentHighlightProvider: true,
            renameProvider: { prepareProvider: true },
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            signatureHelpProvider: { triggerCharacters: ["(", ","] },
            inlayHintProvider: true,
            semanticTokensProvider: {
              legend: { tokenTypes: semanticTokenTypes, tokenModifiers: semanticTokenModifiers },
              full: true,
            },
            codeActionProvider: { codeActionKinds: ["quickfix"] },
            experimental: {
              velar: {
                protocolVersion: VELAR_LANGUAGE_SERVER_PROTOCOL_VERSION,
                incrementalSessions: true,
                watchedFiles: true,
                workspaceRescan: true,
                cancellation: true,
                workspaceSearch: true,
                workspaceTextExtensions: WORKSPACE_TEXT_EXTENSIONS,
                workspaceTextFileLimit: MAX_WORKSPACE_TEXT_FILES,
                workspaceSearchResultLimit: MAX_WORKSPACE_SEARCH_RESULTS,
                workspaceWatchPathLimit: MAX_WORKSPACE_CHANGE_PATHS,
                workspaceWatchPathCodeUnitLimit: MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS,
                workspaceWatchTextCodeUnitLimit: MAX_WORKSPACE_CHANGE_TEXT_CODE_UNITS,
                ownershipGraph: true,
                ownershipGraphNodeLimit: MAX_OWNERSHIP_GRAPH_NODES,
                ownershipGraphEdgeLimit: MAX_OWNERSHIP_GRAPH_EDGES,
                emittedJavaScript: true,
                emittedJavaScriptCodeUnitLimit: MAX_EMITTED_JAVASCRIPT_CHARS,
              },
            },
          },
          serverInfo: { name: "VelarScript Language Server", version: VELAR_VERSION },
        });
        break;
      case "initialized":
        void queueWorkspaceIndex(() => workspaceIndex.rescan()).catch(() => {
          // The next explicit search reports the retained indexing failure through its request response.
        });
        break;
      case "shutdown":
        shuttingDown = true;
        respond(message.id, null);
        break;
      case "exit":
        process.exitCode = shuttingDown ? 0 : 1;
        process.stdin.pause();
        finish();
        break;
      case "$/cancelRequest":
        break;
      case "textDocument/didOpen": {
        const value = params?.textDocument as TextDocument;
        const path = await authorizedPathOf(value.uri);
        if ((confinedWorkspaceRoot || confinedCanonicalRoot) && !path) {
          send({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 2, message: "Ignored a document outside the Desktop project grant" } });
          break;
        }
        documents.set(value.uri, value);
        if (path) workspaceIndex.openDocument(path, value.text);
        if (path && isVelarDocument(value)) {
          try { await sessions.snapshot(path, overrides()); }
          catch { /* publish converts project/config failures into document diagnostics. */ }
        }
        await publish(value);
        break;
      }
      case "textDocument/didChange": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri" | "version">;
        const current = documents.get(descriptor.uri);
        if (!current || !Number.isSafeInteger(descriptor.version) || descriptor.version <= current.version) break;
        const changes = params?.contentChanges as readonly ContentChange[];
        if (!Array.isArray(changes)) break;
        const next = { ...current, version: descriptor.version, text: applyContentChanges(current.text, changes) };
        documents.set(next.uri, next);
        const nextPath = pathOf(next.uri);
        if (nextPath) workspaceIndex.changeDocument(nextPath, next.text);
        schedulePublish(next.uri);
        break;
      }
      case "textDocument/didSave": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const current = documents.get(descriptor.uri);
        if (current) schedulePublish(current.uri);
        break;
      }
      case "textDocument/didClose": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const current = documents.get(descriptor.uri);
        documents.delete(descriptor.uri);
        diagnosticUris.delete(descriptor.uri);
        const path = pathOf(descriptor.uri);
        if (path) await queueWorkspaceIndex(() => workspaceIndex.closeDocument(path));
        if (path && current && isVelarDocument(current)) await sessions.update(path, new Set([path]), overrides());
        send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: descriptor.uri, diagnostics: [] } });
        break;
      }
      case "workspace/didChangeWatchedFiles": {
        const changes = params?.changes as readonly { readonly uri?: unknown }[] | undefined;
        if (!Array.isArray(changes)) break;
        let fidelityLost = changes.length > MAX_WORKSPACE_CHANGE_PATHS;
        let pathUnits = 0;
        const urisByPath = new Map<string, string>();
        if (!fidelityLost) {
          for (const change of changes) {
            const uri = change?.uri;
            if (typeof uri !== "string" || uri.length > MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS * 3 + 32) {
              fidelityLost = true;
              break;
            }
            const rawPath = rawPathOf(uri);
            if (!rawPath || rawPath.length > MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS) {
              fidelityLost = true;
              break;
            }
            if (!urisByPath.has(rawPath)) {
              pathUnits += rawPath.length;
              if (pathUnits > MAX_WORKSPACE_CHANGE_TEXT_CODE_UNITS) {
                fidelityLost = true;
                break;
              }
              urisByPath.set(rawPath, uri);
            }
          }
        }
        if (fidelityLost) {
          send({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 2, message: "Watcher batch exceeded the official bounds; rebuilt the initialized workspace index" } });
          await queueWorkspaceIndex(() => workspaceIndex.rescan());
          await refreshWorkspaceProjects(null);
          break;
        }
        const changedPaths = new Set<string>();
        const uris = [...urisByPath.values()];
        const authorizedPaths = await mapBounded(uris, 16, authorizedPathOf);
        for (let index = 0; index < uris.length; index += 1) {
          const path = authorizedPaths[index];
          if (path) changedPaths.add(path);
          else if (confinedWorkspaceRoot || confinedCanonicalRoot) {
            send({ jsonrpc: "2.0", method: "window/logMessage", params: { type: 2, message: "Ignored a watcher path outside the Desktop project grant" } });
          }
        }
        if (changedPaths.size === 0) break;
        await queueWorkspaceIndex(() => workspaceIndex.update(changedPaths));
        await refreshWorkspaceProjects(changedPaths);
        break;
      }
      case "velar/workspaceRescan": {
        const activity = await queueWorkspaceIndex(() => workspaceIndex.rescan(
          () => message.id !== undefined && cancelledRequests.has(requestKey(message.id)),
        ));
        await refreshWorkspaceProjects(null);
        if (message.id !== undefined) respond(message.id, activity);
        break;
      }
      case "velar/workspaceSearch": {
        const query = params?.query;
        const caseSensitive = params?.caseSensitive;
        const maximumResults = params?.maximumResults;
        if (typeof query !== "string"
          || (caseSensitive !== undefined && typeof caseSensitive !== "boolean")
          || (maximumResults !== undefined && typeof maximumResults !== "number")) {
          respondError(message.id, "velar/workspaceSearch requires a string query and optional boolean caseSensitive and numeric maximumResults", -32602);
          break;
        }
        if (query.length === 0 || query.length > 1_024
          || (maximumResults !== undefined && (!Number.isSafeInteger(maximumResults)
            || maximumResults < 1 || maximumResults > MAX_WORKSPACE_SEARCH_RESULTS))) {
          respondError(message.id, `velar/workspaceSearch query must contain 1 through 1024 UTF-16 code units and maximumResults must be an integer from 1 through ${MAX_WORKSPACE_SEARCH_RESULTS}`, -32602);
          break;
        }
        await waitForWorkspaceIndex(message.id);
        const result = await workspaceIndex.search(query, {
          ...(caseSensitive === undefined ? {} : { caseSensitive }),
          ...(maximumResults === undefined ? {} : { maximumResults }),
          cancelled: () => message.id !== undefined && cancelledRequests.has(requestKey(message.id)),
        });
        respond(message.id, {
          items: result.matches.map((match) => ({
            uri: pathToFileURL(match.path).href,
            range: {
              start: workspacePosition(match.start),
              end: workspacePosition(match.end),
            },
            preview: match.preview,
          })),
          limitReached: result.limitReached,
          filesSearched: result.filesSearched,
          indexedFiles: result.indexedFiles,
          indexedBytes: result.indexedBytes,
          revision: result.revision,
          durationMs: result.durationMs,
          coverageComplete: result.coverageComplete,
        });
        break;
      }
      case "velar/ownershipGraph": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri"> | undefined;
        const requestedVersionValue = params?.version;
        const maximumNodesValue = params?.maximumNodes;
        const maximumEdgesValue = params?.maximumEdges;
        if (!descriptor || typeof descriptor.uri !== "string"
          || (requestedVersionValue !== undefined && (typeof requestedVersionValue !== "number" || !Number.isSafeInteger(requestedVersionValue)))
          || (maximumNodesValue !== undefined && (typeof maximumNodesValue !== "number" || !Number.isSafeInteger(maximumNodesValue)))
          || (maximumEdgesValue !== undefined && (typeof maximumEdgesValue !== "number" || !Number.isSafeInteger(maximumEdgesValue)))) {
          respondError(message.id, "velar/ownershipGraph requires textDocument.uri and optional integer version, maximumNodes, and maximumEdges", -32602);
          break;
        }
        const requestedVersion = requestedVersionValue as number | undefined;
        const maximumNodes = maximumNodesValue as number | undefined;
        const maximumEdges = maximumEdgesValue as number | undefined;
        if ((maximumNodes !== undefined && (maximumNodes < 1 || maximumNodes > MAX_OWNERSHIP_GRAPH_NODES))
          || (maximumEdges !== undefined && (maximumEdges < 1 || maximumEdges > MAX_OWNERSHIP_GRAPH_EDGES))) {
          respondError(message.id, `velar/ownershipGraph bounds are 1..${MAX_OWNERSHIP_GRAPH_NODES} nodes and 1..${MAX_OWNERSHIP_GRAPH_EDGES} edges`, -32602);
          break;
        }
        const document = documents.get(descriptor.uri);
        if (!document || !isVelarDocument(document)) {
          respondError(message.id, "velar/ownershipGraph requires an open VelarScript document", -32602);
          break;
        }
        if (requestedVersion !== undefined && requestedVersion !== document.version) {
          respondError(message.id, `Document version ${requestedVersion} is no longer current`, -32801);
          break;
        }
        const project = await projectFor(document);
        if (!project) {
          respondError(message.id, "VelarScript project is unavailable for this document");
          break;
        }
        const graph = await buildOwnershipGraph(project, {
          ...(maximumNodes === undefined ? {} : { maximumNodes }),
          ...(maximumEdges === undefined ? {} : { maximumEdges }),
          cancelled: () => message.id !== undefined && cancelledRequests.has(requestKey(message.id)),
        });
        respond(message.id, {
          protocolVersion: 1,
          rootUri: pathToFileURL(project.projectRoot).href,
          document: { uri: descriptor.uri, version: document.version },
          compilerVersion: VELAR_VERSION,
          revision: graph.revision,
          nodes: graph.nodes.map((node) => ({
            id: node.id,
            kind: node.kind,
            name: clipLspText(node.name),
            ...(node.type ? { type: clipLspText(node.type) } : {}),
            ...(node.exported === undefined ? {} : { exported: node.exported }),
            ...(node.mutable === undefined ? {} : { mutable: node.mutable }),
            ...(node.path && node.span ? { uri: pathToFileURL(node.path).href, range: lspRange(sourceFor(project, node.path), node.span) } : {}),
            ...(node.path && node.selectionSpan ? { selectionRange: lspRange(sourceFor(project, node.path), node.selectionSpan) } : {}),
          })),
          edges: graph.edges.map((edge) => ({
            id: edge.id,
            kind: edge.kind,
            from: edge.from,
            to: edge.to,
            ...(edge.path && edge.span ? { uri: pathToFileURL(edge.path).href, range: lspRange(sourceFor(project, edge.path), edge.span) } : {}),
          })),
          coverage: graph.coverage,
          limitReached: graph.limitReached,
          durationMs: graph.durationMs,
        });
        break;
      }
      case "velar/emittedJavaScript": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri"> | undefined;
        const requestedVersionValue = params?.version;
        const maximumCharsValue = params?.maximumChars;
        if (!descriptor || typeof descriptor.uri !== "string"
          || (requestedVersionValue !== undefined && (typeof requestedVersionValue !== "number" || !Number.isSafeInteger(requestedVersionValue)))
          || (maximumCharsValue !== undefined && (typeof maximumCharsValue !== "number" || !Number.isSafeInteger(maximumCharsValue)))) {
          respondError(message.id, "velar/emittedJavaScript requires textDocument.uri and optional integer version and maximumChars", -32602);
          break;
        }
        const requestedVersion = requestedVersionValue as number | undefined;
        const maximumChars = maximumCharsValue as number | undefined;
        if (maximumChars !== undefined && (maximumChars < 1 || maximumChars > MAX_EMITTED_JAVASCRIPT_CHARS)) {
          respondError(message.id, `velar/emittedJavaScript maximumChars must be 1 through ${MAX_EMITTED_JAVASCRIPT_CHARS}`, -32602);
          break;
        }
        const document = documents.get(descriptor.uri);
        if (!document || !isVelarDocument(document)) {
          respondError(message.id, "velar/emittedJavaScript requires an open VelarScript document", -32602);
          break;
        }
        if (requestedVersion !== undefined && requestedVersion !== document.version) {
          respondError(message.id, `Document version ${requestedVersion} is no longer current`, -32801);
          break;
        }
        const path = pathOf(descriptor.uri);
        const project = path ? await projectFor(document) : null;
        const module = path && project ? project.modules.find((item) => item.inputPath === path) : null;
        if (!project || !module) {
          respondError(message.id, "VelarScript project module is unavailable for this document");
          break;
        }
        const limit = maximumChars ?? MAX_EMITTED_JAVASCRIPT_CHARS;
        const code = module.result.code;
        const sourceMap = module.result.sourceMap;
        respond(message.id, {
          protocolVersion: 1,
          uri: descriptor.uri,
          version: document.version,
          compilerVersion: VELAR_VERSION,
          revision: ownershipGraphRevision(project),
          javascript: code === null ? null : code.slice(0, limit),
          sourceMap: sourceMap === null ? null : sourceMap.slice(0, limit),
          generatedChars: code?.length ?? 0,
          sourceMapChars: sourceMap?.length ?? 0,
          limitReached: (code?.length ?? 0) > limit || (sourceMap?.length ?? 0) > limit,
          diagnostics: boundedDiagnostics(module.result.source, module.result.diagnostics, []),
        });
        break;
      }
      case "workspace/symbol": {
        const query = params?.query;
        if (typeof query !== "string") {
          respondError(message.id, "workspace/symbol requires a string query", -32602);
          break;
        }
        if (query.length > 1_024) {
          respondError(message.id, "workspace/symbol query cannot exceed 1024 UTF-16 code units", -32602);
          break;
        }
        await waitForWorkspaceIndex(message.id);
        const projects = new Map<string, ProjectResult>();
        for (const document of documents.values()) {
          if (!isVelarDocument(document)) continue;
          const path = pathOf(document.uri);
          if (!path) continue;
          try {
            const snapshot = await sessions.update(path, new Set(), overrides());
            projects.set(snapshot.config.root, snapshot.project);
          } catch {
            // Invalid projects already own document diagnostics and cannot poison symbols from healthy workspace roots.
          }
        }
        let indexedVelarPaths = 0;
        for (const path of workspaceIndex.paths(".vel")) {
          if (message.id !== undefined && cancelledRequests.has(requestKey(message.id))) throw new WorkspaceIndexCancelledError();
          indexedVelarPaths += 1;
          if (indexedVelarPaths % 128 === 0) await new Promise<void>((resolveYield) => setImmediate(resolveYield));
          try {
            const snapshot = await sessions.update(path, new Set(), overrides());
            projects.set(snapshot.config.root, snapshot.project);
            if (projects.size > 64) throw new RangeError("workspace/symbol cannot span more than 64 VelarScript project roots");
          } catch (error) {
            if (error instanceof RangeError && /more than 64 VelarScript project roots/u.test(error.message)) throw error;
            // Broken project roots retain their document diagnostics and do not suppress symbols from healthy roots.
          }
        }
        const symbols: unknown[] = [];
        for (const project of projects.values()) {
          const remaining = MAX_LSP_RESULT_ITEMS - symbols.length;
          if (remaining === 0) break;
          symbols.push(...projectWorkspaceSymbols(project, query, remaining).map((symbol) => ({
              name: clipLspText(symbol.name),
              kind: lspSymbolKind(symbol.presentationKind ?? symbol.kind),
              location: lspLocation(project, symbol.path, symbol.selectionSpan),
              ...(symbol.containerName ? { containerName: clipLspText(symbol.containerName) } : {}),
            })));
        }
        respond(message.id, symbols);
        break;
      }
      case "textDocument/completion": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const position = params?.position as Position;
        const document = documents.get(descriptor.uri);
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        const offset = document ? offsetAt(document.text, position) : 0;
        const semantic = document && path && project ? projectCompletionsAt(project, path, offset) : [];
        const semanticItems = semantic.slice(0, MAX_LSP_RESULT_ITEMS).map((item) => ({
          label: clipLspText(item.label),
          kind: lspCompletionKind(item.presentationKind ?? item.kind),
          detail: clipLspText(item.detail),
          ...(item.documentation ? { documentation: { kind: "markdown", value: clipLspText(item.documentation) } } : {}),
        }));
        const completionContext = document && path && project ? projectCompletionContextAt(project, path, offset) : "ordinary";
        const semanticLabels = new Set(semanticItems.map((item) => item.label));
        const items = completionContext !== "ordinary"
          ? semanticItems
          : [...semanticItems, ...completionItemsFor(project).filter((item) => !semanticLabels.has(item.label))].slice(0, MAX_LSP_RESULT_ITEMS);
        respond(message.id, { isIncomplete: false, items });
        break;
      }
      case "textDocument/hover": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const position = params?.position as Position;
        const document = documents.get(descriptor.uri);
        respond(message.id, document ? await hover(document, position, await projectFor(document)) : null);
        break;
      }
      case "textDocument/definition": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const position = params?.position as Position;
        const document = documents.get(descriptor.uri);
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        const location = document && path && project ? projectDefinitionAt(project, path, offsetAt(document.text, position)) : null;
        respond(message.id, location && project ? lspLocation(project, location.path, location.span) : null);
        break;
      }
      case "textDocument/references": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const position = params?.position as Position;
        const context = params?.context as { readonly includeDeclaration?: boolean } | undefined;
        const document = documents.get(descriptor.uri);
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        const locations = document && path && project
          ? projectReferencesAt(project, path, offsetAt(document.text, position), context?.includeDeclaration ?? false)
              .slice(0, MAX_LSP_RESULT_ITEMS)
          : [];
        respond(message.id, project ? locations.map((location) => lspLocation(project, location.path, location.span)) : []);
        break;
      }
      case "textDocument/documentHighlight": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const position = params?.position as Position;
        const document = documents.get(descriptor.uri);
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        const locations = document && path && project
          ? projectReferencesAt(project, path, offsetAt(document.text, position), true)
              .filter((location) => location.path === path)
              .slice(0, MAX_LSP_RESULT_ITEMS)
          : [];
        respond(message.id, project && path ? locations.map((location) => ({
          range: lspRange(sourceFor(project, path), location.span),
          kind: 1,
        })) : []);
        break;
      }
      case "textDocument/prepareRename": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const position = params?.position as Position;
        const document = documents.get(descriptor.uri);
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        const prepared = document && path && project ? projectPrepareRenameAt(project, path, offsetAt(document.text, position)) : null;
        const selection = prepared?.edits[0];
        respond(message.id, selection && project ? { range: lspRange(sourceFor(project, selection.path), selection.span), placeholder: prepared.placeholder } : null);
        break;
      }
      case "textDocument/rename": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const position = params?.position as Position;
        const newName = params?.newName as string;
        const document = documents.get(descriptor.uri);
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        const renamed = document && path && project ? projectRenameAt(project, path, offsetAt(document.text, position), newName) : "No renameable VelarScript symbol at this position";
        if (typeof renamed === "string") respondError(message.id, renamed);
        else if (renamed.edits.length > MAX_LSP_RESULT_ITEMS) respondError(message.id, `Rename affects more than ${MAX_LSP_RESULT_ITEMS} locations`);
        else respond(message.id, project ? workspaceEdit(project, renamed.edits, newName) : null);
        break;
      }
      case "textDocument/documentSymbol": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const document = documents.get(descriptor.uri);
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        respond(message.id, path && project ? projectDocumentSymbols(project, path).slice(0, MAX_LSP_RESULT_ITEMS).map((symbol) => ({
          name: clipLspText(symbol.name),
          ...(symbol.type ? { detail: clipLspText(symbol.type) } : {}),
          kind: lspSymbolKind(symbol.presentationKind ?? symbol.kind),
          range: lspRange(sourceFor(project, symbol.path), symbol.span),
          selectionRange: lspRange(sourceFor(project, symbol.path), symbol.selectionSpan),
        })) : []);
        break;
      }
      case "textDocument/signatureHelp": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const position = params?.position as Position;
        const document = documents.get(descriptor.uri);
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        const signature = document && path && project ? projectSignatureAt(project, path, offsetAt(document.text, position)) : null;
        respond(message.id, signature ? {
          signatures: [{ label: clipLspText(signature.label) }],
          activeSignature: 0,
          activeParameter: signature.activeParameter,
        } : null);
        break;
      }
      case "textDocument/inlayHint": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const range = params?.range as Range | undefined;
        const document = documents.get(descriptor.uri);
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        respond(message.id, document && path && project ? projectInlayHints(project, path, document.text, range) : []);
        break;
      }
      case "textDocument/semanticTokens/full": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const document = documents.get(descriptor.uri);
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        const tokens = path && project ? projectSemanticTokens(project, path).slice(0, MAX_LSP_RESULT_ITEMS) : [];
        respond(message.id, { data: project && path ? semanticTokenData(sourceFor(project, path), tokens) : [] });
        break;
      }
      case "textDocument/codeAction": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const context = params?.context as { readonly diagnostics?: readonly unknown[]; readonly only?: readonly string[] } | undefined;
        const document = documents.get(descriptor.uri);
        const acceptsQuickFix = !context?.only || context.only.some((kind) => kind === "quickfix" || kind.startsWith("quickfix."));
        const fixPath = pathOf(descriptor.uri);
        const fixProject = document && acceptsQuickFix ? await projectFor(document) : null;
        respond(message.id, document && acceptsQuickFix
          ? quickFixes(document, fixProject && fixPath ? fixProject.modules.find((item) => item.inputPath === fixPath) ?? null : null, context?.diagnostics ?? [])
          : []);
        break;
      }
      case "textDocument/formatting": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const document = documents.get(descriptor.uri);
        if (!document) {
          respond(message.id, []);
          break;
        }
        const project = await projectFor(document);
        const formatted = formatSource(document.text, { extensions: project?.compilerExtensions ?? [] });
        respond(message.id, formatted === document.text ? [] : [{ range: fullRange(document.text), newText: formatted }]);
        break;
      }
      default:
        if (message.id !== undefined) respondError(message.id, `Method not found: ${message.method ?? ""}`, -32601);
    }
  };

  process.stdin.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const boundary = buffer.indexOf("\r\n\r\n");
      if (boundary === -1) break;
      const header = buffer.subarray(0, boundary).toString("ascii");
      const length = /(?:^|\r\n)Content-Length:\s*(\d+)/iu.exec(header);
      if (!length) {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "LSP message is missing a valid Content-Length header" } });
        process.exitCode = 1;
        process.stdin.pause();
        finish();
        break;
      }
      const size = Number(length[1]);
      if (!Number.isSafeInteger(size) || size > MAX_LSP_MESSAGE_BYTES) {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "LSP message exceeds the 16 MiB transport limit" } });
        process.exitCode = 1;
        process.stdin.pause();
        finish();
        break;
      }
      const end = boundary + 4 + size;
      if (buffer.length < end) break;
      const body = buffer.subarray(boundary + 4, end).toString("utf8");
      buffer = buffer.subarray(end);
      let parsed: unknown;
      try { parsed = JSON.parse(body); }
      catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON in LSP message" } });
        continue;
      }
      if (!isRpcMessage(parsed)) {
        send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid LSP request" } });
        continue;
      }
      const message = parsed;
      if (message.method === "$/cancelRequest") {
        const cancelId = (message.params as { readonly id?: unknown } | undefined)?.id;
        if (cancelId === null || typeof cancelId === "string" || (typeof cancelId === "number" && Number.isFinite(cancelId))) {
          const key = requestKey(cancelId);
          if (pendingRequests.has(key)) cancelledRequests.add(key);
        }
      } else if (message.id !== undefined) {
        pendingRequests.add(requestKey(message.id));
      }
      queue = queue.then(() => handle(message)).catch((error) => {
        if (message.id !== undefined) respondError(message.id, hostErrorMessage(error), -32603);
      });
    }
  });
  await Promise.race([new Promise<void>((resolve) => process.stdin.once("end", resolve)), exitRequested]);
  await queue;
  if (diagnosticTask) await diagnosticTask;
}

function requestKey(id: number | string | null): string {
  return `${typeof id}:${String(id)}`;
}

function isRpcMessage(value: unknown): value is RpcMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") return false;
  return message.id === undefined || message.id === null || typeof message.id === "string"
    || (typeof message.id === "number" && Number.isFinite(message.id));
}

function clipLspText(value: string): string {
  return value.length <= MAX_LSP_TEXT_CHARS ? value : `${value.slice(0, MAX_LSP_TEXT_CHARS - 1)}…`;
}

function boundedDiagnostics(
  source: SourceText,
  diagnostics: readonly Diagnostic[],
  notices: readonly string[],
): unknown[] {
  const output: unknown[] = [];
  for (const diagnostic of diagnostics) {
    if (output.length >= MAX_LSP_RESULT_ITEMS) break;
    output.push(lspDiagnostic(source, diagnostic));
  }
  for (const notice of notices) {
    if (output.length >= MAX_LSP_RESULT_ITEMS) break;
    output.push(lspNotice(source, notice));
  }
  if (diagnostics.length + notices.length > MAX_LSP_RESULT_ITEMS) {
    if (output.length >= MAX_LSP_RESULT_ITEMS) output.pop();
    output.push(lspNotice(source, `Diagnostics were truncated to ${MAX_LSP_RESULT_ITEMS} items`));
  }
  return output;
}

function oversizedDiagnosticsFallback(params: unknown): unknown {
  const input = params && typeof params === "object" && !Array.isArray(params)
    ? params as Record<string, unknown>
    : {};
  return {
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri: typeof input.uri === "string" ? input.uri : "",
      ...(Number.isSafeInteger(input.version) ? { version: input.version } : {}),
      diagnostics: [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "VEL9003",
        source: "velar",
        message: "VelarScript diagnostics exceeded the 16 MiB LSP transport limit",
      }],
    },
  };
}

function lspDiagnostic(source: SourceText, item: Diagnostic): unknown {
  const start = lspSourcePosition(source, item.span.start);
  const end = lspSourcePosition(source, Math.max(item.span.start + 1, item.span.end));
  return {
    range: {
      start,
      end,
    },
    severity: 1,
    code: item.code,
    source: "velar",
    message: clipLspText(item.message),
  };
}

function lspNotice(source: SourceText, message: string): unknown {
  const start = lspSourcePosition(source, 0);
  const end = lspSourcePosition(source, Math.min(1, source.text.length));
  return {
    range: {
      start,
      end,
    },
    severity: 3,
    code: "VEL9002",
    source: "velar",
    message: clipLspText(message),
  };
}

async function hover(document: TextDocument, position: Position, project: ProjectResult | null): Promise<unknown> {
  const offset = offsetAt(document.text, position);
  const word = wordAt(document.text, offset);
  if (!word) return null;
  const path = pathOf(document.uri);
  const symbol = path && project ? projectSymbolAt(project, path, offset) : null;
  if (symbol) {
    const declaration = symbol.kind === "variable" ? (symbol.mutable ? "let" : "const") : symbol.kind;
    const type = symbol.type ? `: ${symbol.type}` : "";
    const documentation = symbol.documentation ? `\n\n${symbol.documentation}` : "";
    return { contents: { kind: "markdown", value: clipLspText(`\`\`${declaration} ${symbol.name}${type}\`\`${documentation}`) } };
  }
  const keyword = keywordDocumentation.get(word) ?? extensionDocumentation(project, "keywordDocumentation", word);
  if (keyword) return { contents: { kind: "markdown", value: `\`\`${word}\`\`\n\n${keyword}` } };
  const expression = path && project ? projectExpressionAt(project, path, offset) : null;
  if (expression?.memberName) {
    const declaration = expression.callable ? "method" : "field";
    const member = path && project ? projectMemberSymbolAt(project, path, offset) : null;
    const documentation = member?.documentation ? `\n\n${member.documentation}` : "";
    return { contents: { kind: "markdown", value: clipLspText(`\`\`${declaration} ${expression.memberName}: ${expression.type}\`\`${documentation}`) } };
  }
  const member = path && project ? projectMemberSymbolAt(project, path, offset) : null;
  if (member) {
    const type = member.type ? `: ${member.type}` : "";
    const documentation = member.documentation ? `\n\n${member.documentation}` : "";
    return { contents: { kind: "markdown", value: clipLspText(`\`\`${member.kind} ${member.name}${type}\`\`${documentation}`) } };
  }
  const builtinType = builtinTypeDocumentation.get(word) ?? extensionDocumentation(project, "typeDocumentation", word);
  if (builtinType) return { contents: { kind: "markdown", value: `\`\`${word}\`\`\n\n${builtinType}` } };
  return null;
}

function lspLocation(project: ProjectResult, path: string, span: Span): unknown {
  return { uri: pathToFileURL(path).href, range: lspRange(sourceFor(project, path), span) };
}

function lspRange(source: SourceText, span: Span): Range {
  return { start: lspSourcePosition(source, span.start), end: lspSourcePosition(source, span.end) };
}

function sourceFor(project: ProjectResult, path: string): SourceText {
  const module = project.modules.find((item) => item.inputPath === path);
  if (!module) throw new Error(`VelarScript project has no source for ${path}`);
  return module.result.source;
}

function workspaceEdit(project: ProjectResult, edits: readonly { readonly path: string; readonly span: Span; readonly replacement?: string }[], newText: string): unknown {
  const changes: Record<string, Array<{ range: Range; newText: string }>> = {};
  for (const edit of edits) {
    const uri = pathToFileURL(edit.path).href;
    (changes[uri] ??= []).push({ range: lspRange(sourceFor(project, edit.path), edit.span), newText: edit.replacement ?? newText });
  }
  return { changes };
}

function semanticTokenData(source: SourceText, tokens: readonly ProjectSemanticToken[]): number[] {
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (const token of tokens) {
    const start = lspSourcePosition(source, token.span.start);
    const end = lspSourcePosition(source, token.span.end);
    if (start.line !== end.line || end.character <= start.character) continue;
    const line = start.line;
    const character = start.character;
    const deltaLine = line - previousLine;
    const deltaCharacter = deltaLine === 0 ? character - previousCharacter : character;
    const tokenType = semanticTokenTypes.indexOf(token.type);
    if (tokenType < 0 || deltaLine < 0 || deltaCharacter < 0) continue;
    const modifiers = token.modifiers.reduce((bits, modifier) => {
      const index = semanticTokenModifiers.indexOf(modifier);
      return index < 0 ? bits : bits | (1 << index);
    }, 0);
    data.push(deltaLine, deltaCharacter, end.character - start.character, tokenType, modifiers);
    previousLine = line;
    previousCharacter = character;
  }
  return data;
}

/**
 * D38 §48: an editor quick fix is the same mechanical rewrite `velar fix`
 * applies, read from the diagnostic that named it. The compiler registers the
 * rewrite where it reports the diagnostic, so the editor never re-derives one
 * from message text and the two surfaces can never drift apart.
 */
function quickFixes(document: TextDocument, module: ProjectModule | null, diagnostics: readonly unknown[]): unknown[] {
  if (!module) return [];
  const source = module.result.source;
  const registered = module.result.diagnostics
    .filter((item) => item.fix && item.fix.edits.length > 0)
    .map((item) => ({ code: item.code, range: lspRange(source, boundedDiagnosticSpan(source, item.span)), fix: item.fix! }));
  if (registered.length === 0) return [];
  const actions: unknown[] = [];
  for (const value of diagnostics.slice(0, MAX_LSP_RESULT_ITEMS)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const diagnostic = value as { readonly code?: unknown; readonly range?: unknown };
    if (!diagnostic.range || typeof diagnostic.range !== "object" || Array.isArray(diagnostic.range)) continue;
    const range = diagnostic.range as Range;
    const match = registered.find((item) => item.code === diagnostic.code && sameLspRange(item.range, range));
    if (!match) continue;
    actions.push({
      title: match.fix.title,
      kind: "quickfix",
      isPreferred: true,
      edit: {
        changes: {
          [document.uri]: match.fix.edits.map((edit) => ({ range: lspRange(source, edit.span), newText: edit.text })),
        },
      },
    });
  }
  return actions;
}

function boundedDiagnosticSpan(source: SourceText, span: Span): Span {
  return { start: span.start, end: Math.max(span.start + 1, span.end) > source.text.length ? span.end : Math.max(span.start + 1, span.end) };
}

function sameLspRange(left: Range, right: Range): boolean {
  return left.start.line === right.start?.line && left.start.character === right.start?.character
    && left.end.line === right.end?.line && left.end.character === right.end?.character;
}

function projectInlayHints(project: ProjectResult, path: string, text: string, range?: Range): unknown[] {
  const module = project.modules.find((item) => item.inputPath === path);
  if (!module) return [];
  const start = range ? offsetAt(text, range.start) : 0;
  const end = range ? offsetAt(text, range.end) : text.length;
  const hints: unknown[] = [];
  for (const symbol of module.result.semanticIndex.symbols) {
    if (hints.length >= MAX_LSP_RESULT_ITEMS) break;
    if (!symbol.sourceTypeHint || !symbol.type || symbol.type.length > 1024) continue;
    if (symbol.selectionSpan.end < start || symbol.selectionSpan.end > end) continue;
    const declarationEnd = lineEndAt(text, symbol.selectionSpan.end);
    const assignment = text.indexOf("=", symbol.selectionSpan.end);
    if (assignment !== -1 && assignment < declarationEnd && text.slice(symbol.selectionSpan.end, assignment).includes(":")) continue;
    const location = lspSourcePosition(module.result.source, symbol.selectionSpan.end);
    hints.push({
      position: location,
      label: `: ${symbol.type}`,
      kind: 1,
      paddingRight: true,
    });
  }
  return hints;
}

function lspSymbolKind(kind: string): number {
  if (kind.startsWith("extension:class:")) return 5;
  if (kind.startsWith("extension:type:")) return 11;
  if (kind.startsWith("extension:function:")) return 12;
  if (kind.startsWith("extension:variable:") || kind.startsWith("extension:parameter:")) return 13;
  switch (kind) {
    case "class": return 5;
    case "interface": return 11;
    case "method": return 6;
    case "field": return 8;
    case "enum": return 10;
    case "type": return 11;
    case "enum-member": return 22;
    case "function": return 12;
    case "variable":
    case "parameter":
    case "import":
    case "catch": return 13;
    default: return 13;
  }
}

function lspCompletionKind(kind: string): number {
  if (kind.startsWith("extension:function:")) return 3;
  if (kind.startsWith("extension:variable:") || kind.startsWith("extension:parameter:")) return 6;
  if (kind.startsWith("extension:class:")) return 7;
  if (kind.startsWith("extension:type:")) return 8;
  switch (kind) {
    case "method": return 2;
    case "function": return 3;
    case "field": return 5;
    case "variable":
    case "parameter":
    case "catch":
    case "import": return 6;
    case "class": return 7;
    case "interface": return 8;
    case "constant": return 6;
    case "type": return 8;
    case "enum": return 13;
    case "enum-member": return 20;
    default: return 1;
  }
}

function pathOf(uri: string): string | null {
  const path = rawPathOf(uri);
  return path && (!confinedWorkspaceRoot || withinWorkspaceRoot(confinedWorkspaceRoot, path)) ? path : null;
}

function rawPathOf(uri: string): string | null {
  try { return uri.startsWith("file:") ? fileURLToPath(uri) : null; } catch { return null; }
}

function isVelarDocument(document: TextDocument): boolean {
  const language = document.languageId.trim().toLowerCase();
  if (language === "velar" || language === "velarscript") return true;
  const path = rawPathOf(document.uri);
  return path !== null && path.toLowerCase().endsWith(".vel");
}

async function authorizedPathOf(uri: string): Promise<string | null> {
  const path = pathOf(uri);
  if (!path || !confinedCanonicalRoot) return path;
  try {
    return await canonicalPathWithinCanonicalRoot(confinedCanonicalRoot, path) ? path : null;
  } catch {
    return null;
  }
}

function applyContentChanges(text: string, changes: readonly ContentChange[]): string {
  let result = text;
  for (const change of changes) {
    if (!change.range) result = change.text;
    else {
      const start = offsetAt(result, change.range.start);
      const end = offsetAt(result, change.range.end);
      result = result.slice(0, start) + change.text + result.slice(end);
    }
  }
  return result;
}

function offsetAt(text: string, position: Position): number {
  const requestedLine = Number.isSafeInteger(position?.line) && position.line >= 0
    ? position.line
    : 0;
  const requestedCharacter = Number.isSafeInteger(position?.character) && position.character >= 0
    ? position.character
    : 0;
  let offset = 0;
  for (let line = 0; line < requestedLine && offset < text.length; line += 1) {
    const next = nextLineStart(text, offset);
    offset = next === null ? text.length : next;
  }
  const end = lineEndAt(text, offset);
  return activePositionEncoding === "utf-16"
    ? Math.min(end, offset + requestedCharacter)
    : codeUnitOffsetAt(text, offset, end, requestedCharacter);
}

function positionAt(text: string, requestedOffset: number): Position {
  const offset = Math.max(0, Math.min(text.length, requestedOffset));
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    const character = text[index];
    if (character === "\r") {
      const breakEnd = text[index + 1] === "\n" ? index + 2 : index + 1;
      if (breakEnd > offset) break;
      line += 1;
      lineStart = breakEnd;
      index = breakEnd - 1;
    } else if (character === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, character: activePositionEncoding === "utf-16" ? offset - lineStart : codePointCount(text, lineStart, offset) };
}

function requestedPositionEncoding(params: Record<string, unknown> | undefined): PositionEncoding {
  const capabilities = params?.capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return "utf-16";
  const general = (capabilities as Record<string, unknown>).general;
  if (!general || typeof general !== "object" || Array.isArray(general)) return "utf-16";
  const encodings = (general as Record<string, unknown>).positionEncodings;
  return Array.isArray(encodings) && encodings.includes("utf-32") ? "utf-32" : "utf-16";
}

function requestedWorkspaceRoots(params: Record<string, unknown> | undefined): readonly string[] {
  const roots: string[] = [];
  const folders = params?.workspaceFolders;
  if (Array.isArray(folders)) {
    for (const folder of folders) {
      if (!folder || typeof folder !== "object" || Array.isArray(folder)) continue;
      const uri = (folder as Record<string, unknown>).uri;
      if (typeof uri !== "string") continue;
      const path = rawPathOf(uri);
      if (!path) throw new TypeError("LSP workspace folders must use file URLs");
      roots.push(path);
    }
  }
  if (roots.length === 0 && typeof params?.rootUri === "string") {
    const path = rawPathOf(params.rootUri);
    if (!path) throw new TypeError("LSP rootUri must use a file URL");
    roots.push(path);
  }
  if (roots.length === 0 && typeof params?.rootPath === "string" && params.rootPath !== "") roots.push(params.rootPath);
  if (confinedWorkspaceRoot) {
    if (roots.some((root) => !withinWorkspaceRoot(confinedWorkspaceRoot!, resolve(root)))) {
      throw new RangeError("LSP workspace roots must remain inside the Desktop project grant");
    }
    return [confinedWorkspaceRoot];
  }
  return [...new Set(roots)];
}

function configuredWorkspaceRoot(): string | null {
  const value = process.env.VELAR_LANGUAGE_SERVER_WORKSPACE_ROOT;
  return typeof value === "string" && value !== "" ? resolve(value) : null;
}

function configuredCanonicalRoot(): string | null {
  const value = process.env.VELAR_LANGUAGE_SERVER_CANONICAL_ROOT;
  return typeof value === "string" && value !== "" ? resolve(value) : null;
}

function withinWorkspaceRoot(root: string, path: string): boolean {
  const value = relative(root, resolve(path));
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
}

function workspacePosition(position: WorkspaceIndexPosition): Position {
  return {
    line: position.line,
    character: activePositionEncoding === "utf-16" ? position.utf16Character : position.utf32Character,
  };
}

async function mapBounded<T, R>(values: readonly T[], concurrency: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function lspSourcePosition(source: SourceText, offset: number): Position {
  const location = source.location(offset);
  const line = location.line - 1;
  const start = source.lineStarts[line] ?? 0;
  const bounded = Math.max(start, Math.min(offset, source.text.length));
  return {
    line,
    character: activePositionEncoding === "utf-16" ? bounded - start : codePointCount(source.text, start, bounded),
  };
}

function codePointCount(text: string, start: number, end: number): number {
  let count = 0;
  for (let index = start; index < end; count += 1) {
    const point = text.codePointAt(index);
    index += point !== undefined && point > 0xffff ? 2 : 1;
  }
  return count;
}

function codeUnitOffsetAt(text: string, start: number, end: number, requested: number): number {
  let index = start;
  for (let count = 0; count < requested && index < end; count += 1) {
    const point = text.codePointAt(index);
    index += point !== undefined && point > 0xffff ? 2 : 1;
  }
  return index;
}

function nextLineStart(text: string, start: number): number | null {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\r") return index + (text[index + 1] === "\n" ? 2 : 1);
    if (text[index] === "\n") return index + 1;
  }
  return null;
}

function lineEndAt(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\r" || text[index] === "\n") return index;
  }
  return text.length;
}

function wordAt(text: string, offset: number): string {
  let start = offset;
  let end = offset;
  while (start > 0 && isSourceIdentifierPart(text[start - 1]!)) start -= 1;
  while (end < text.length && isSourceIdentifierPart(text[end]!)) end += 1;
  return text.slice(start, end);
}

function fullRange(text: string): Range {
  return { start: { line: 0, character: 0 }, end: positionAt(text, text.length) };
}
