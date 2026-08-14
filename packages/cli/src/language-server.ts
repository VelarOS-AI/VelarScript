import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import { collectionMemberGuidance, compile, formatSource, isSourceIdentifierPart, sourceTypeNameGuidance, type CollectionKind, type Diagnostic, type SourceText, type Span } from "@velarscript/compiler";
import type { ProjectResult } from "./project.ts";
import { VelarProjectSessions } from "./project-session.ts";
import { VELAR_VERSION } from "./version.ts";
import { hostErrorMessage } from "./host-error.ts";
import { canonicalizePotentialPath, canonicalPathWithinCanonicalRoot } from "./canonical-path.ts";
import {
  createScriptLanguageDocument,
  scriptLanguageFor,
  type ScriptAnalysis,
  type ScriptDocumentOwner,
  type ScriptEdit,
  type ScriptSpan,
  type ScriptSymbolKind,
} from "./script-language-service.ts";
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

export const VELAR_LANGUAGE_SERVER_PROTOCOL_VERSION = 3;
type PositionEncoding = "utf-16" | "utf-32";
let activePositionEncoding: PositionEncoding = "utf-16";
let confinedWorkspaceRoot: string | null = null;
let confinedCanonicalRoot: string | null = null;
const MAX_LSP_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_LSP_RESULT_ITEMS = 10_000;
const MAX_LSP_TEXT_CHARS = 64 * 1024;
const semanticTokenTypes = [
  "type", "class", "enum", "enumMember", "function", "method", "property", "variable", "parameter",
  "interface", "comment", "string", "keyword", "number", "regexp", "operator",
] as const;
const semanticTokenModifiers = ["declaration", "readonly", "static"] as const;

const keywordDocumentation = new Map<string, string>([
  ["assert", "Requires a boolean or optional invariant and narrows stable values in following statements."],
  ["not", "Negates a checked condition; use `not in` for negative membership and `is not` for a negative runtime type test."],
  ["in", "Tests List, Set, Map, Record, or string membership; `not in` is its direct negative form."],
  ["is", "Tests a value against a runtime type and narrows stable locations; `is not` is its direct negative form."],
  ["constructor", "Initializes class fields and calls super(...) first when the class extends another class."],
  ["type", "Declares one data shape used for static checking and runtime validation."],
  ["enum", "Declares a finite set of string-backed values for application states."],
  ["abstract", "Marks a class, instance method, or getter as an incomplete behavior contract."],
  ["extends", "Declares one base class; pass base arguments through super(...) in the constructor."],
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

const coreCompletionItems = [
  ...["const", "let", "readonly", "def", "async", "await", "type", "enum", "abstract", "class", "constructor", "extends", "override", "private", "static", "get", "super", "pass", "return", "throw", "assert", "if", "else", "match", "case", "for", "in", "while", "try", "catch", "finally", "import", "export", "null", "true", "false", "and", "or", "not"].map((label) => ({ label, kind: 14 })),
  ...[...builtinTypeDocumentation].map(([label, detail]) => ({ label, kind: 7, detail })),
  { label: "str", kind: 3, detail: "str(value) -> string" },
  { label: "print", kind: 3, detail: "print(value) -> null" },
  { label: "range", kind: 3, detail: "range(stop) or range(start, stop, step) -> List<number>" },
  { label: "equals", kind: 3, detail: "equals(a, b) -> bool — deep structural comparison over data" },
  { label: "Json", kind: 6, detail: "Permanent namespace for parse, tryParse, stringify, stableStringify, clone, and isSerializable" },
  { label: "Promise", kind: 6, detail: "Permanent namespace for all, race, sleep, timeout, retry, map, and series" },
  { label: "Text", kind: 6, detail: "Permanent namespace for Unicode-aware text normalization, formatting, code points, and patterns" },
  { label: "velar/collections", kind: 9, detail: "Typed collection transforms and Python-style iteration helpers" },
  { label: "velar/math", kind: 9, detail: "Numeric constants, transforms, and random helpers" },
  { label: "velar/async", kind: 9, detail: "Promise composition, timeout, retry, and concurrency helpers" },
  { label: "velar/url", kind: 9, detail: "URL parsing, joining, encoding, and query helpers" },
  { label: "velar/time", kind: 9, detail: "Timestamps, ISO values, formatting, and date-part helpers" },
  { label: "velar/id", kind: 9, detail: "Secure host UUID generation and validation" },
  { label: "velar/log", kind: 9, detail: "Structured leveled logging with scoped loggers and replaceable sinks" },
  { label: "velar/test", kind: 9, detail: "Typed deep, collection, error, and Promise assertions" },
];

function completionItemsFor(project: ProjectResult | null): readonly { readonly label: string; readonly kind: number; readonly detail?: string }[] {
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
  const scriptDocuments = new Map<string, ScriptDocumentOwner>();
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
    if (scriptDocuments.has(item.uri)) return [];
    const itemPath = pathOf(item.uri);
    return itemPath ? [[itemPath, item.text] as const] : [];
  }));
  const projectFor = async (document: TextDocument): Promise<ProjectResult | null> => {
    if (scriptDocuments.has(document.uri)) return null;
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
    const script = scriptDocuments.get(document.uri);
    if (script) {
      send({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: {
          uri: document.uri,
          version: document.version,
          diagnostics: boundedScriptDiagnostics(document.text, script.analysis()),
        },
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
      if (scriptDocuments.has(document.uri)) continue;
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
                scriptLanguages: ["javascript", "typescript"],
                scriptImplementation: "velarscript",
                incrementalScriptLexing: true,
                workspaceSearch: true,
                workspaceTextExtensions: WORKSPACE_TEXT_EXTENSIONS,
                workspaceTextFileLimit: MAX_WORKSPACE_TEXT_FILES,
                workspaceSearchResultLimit: MAX_WORKSPACE_SEARCH_RESULTS,
                workspaceWatchPathLimit: MAX_WORKSPACE_CHANGE_PATHS,
                workspaceWatchPathCodeUnitLimit: MAX_WORKSPACE_CHANGE_PATH_CODE_UNITS,
                workspaceWatchTextCodeUnitLimit: MAX_WORKSPACE_CHANGE_TEXT_CODE_UNITS,
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
        const scriptLanguage = scriptLanguageFor(path ?? value.uri, value.languageId);
        const script = scriptLanguage ? createScriptLanguageDocument(scriptLanguage, value.text) : null;
        if (script) scriptDocuments.set(value.uri, script);
        if (path && !script) {
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
        const script = scriptDocuments.get(next.uri);
        const edit = script ? scriptTextEdit(current.text, next.text) : null;
        if (script && edit) script.apply([edit]);
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
        documents.delete(descriptor.uri);
        const script = scriptDocuments.get(descriptor.uri);
        scriptDocuments.delete(descriptor.uri);
        diagnosticUris.delete(descriptor.uri);
        const path = pathOf(descriptor.uri);
        if (path) await queueWorkspaceIndex(() => workspaceIndex.closeDocument(path));
        if (path && !script) await sessions.update(path, new Set([path]), overrides());
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
          if (scriptDocuments.has(document.uri)) continue;
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
        const script = scriptDocuments.get(descriptor.uri);
        if (document && script) {
          const items = script.completionsAt(scriptOffsetAt(document.text, position)).slice(0, MAX_LSP_RESULT_ITEMS).map((item) => ({
            label: clipLspText(item.label),
            kind: lspCompletionKind(item.kind),
            detail: clipLspText(item.detail),
          }));
          respond(message.id, { isIncomplete: false, items });
          break;
        }
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
        const script = scriptDocuments.get(descriptor.uri);
        if (document && script) {
          const result = script.hoverAt(scriptOffsetAt(document.text, position));
          respond(message.id, result ? {
            contents: { kind: "markdown", value: `\`\`${clipLspText(result.contents)}\`\`` },
            range: scriptRange(document.text, result),
          } : null);
          break;
        }
        respond(message.id, document ? await hover(document, position, await projectFor(document)) : null);
        break;
      }
      case "textDocument/definition": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const position = params?.position as Position;
        const document = documents.get(descriptor.uri);
        const script = scriptDocuments.get(descriptor.uri);
        if (document && script) {
          const location = script.definitionAt(scriptOffsetAt(document.text, position));
          respond(message.id, location ? { uri: descriptor.uri, range: scriptRange(document.text, location) } : null);
          break;
        }
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
        const script = scriptDocuments.get(descriptor.uri);
        if (document && script) {
          const locations = script.referencesAt(scriptOffsetAt(document.text, position), context?.includeDeclaration ?? false)
            .slice(0, MAX_LSP_RESULT_ITEMS)
            .map((span) => ({ uri: descriptor.uri, range: scriptRange(document.text, span) }));
          respond(message.id, locations);
          break;
        }
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
        const script = scriptDocuments.get(descriptor.uri);
        if (document && script) {
          const locations = script.referencesAt(scriptOffsetAt(document.text, position), true)
            .slice(0, MAX_LSP_RESULT_ITEMS)
            .map((span) => ({ range: scriptRange(document.text, span), kind: 1 }));
          respond(message.id, locations);
          break;
        }
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
        const script = scriptDocuments.get(descriptor.uri);
        if (document && script) {
          const symbol = script.symbolAt(scriptOffsetAt(document.text, position));
          respond(message.id, symbol ? { range: scriptRange(document.text, symbol), placeholder: symbol.name } : null);
          break;
        }
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
        const script = scriptDocuments.get(descriptor.uri);
        if (document && script) {
          const renamed = script.renameAt(scriptOffsetAt(document.text, position), newName);
          if (renamed.error) respondError(message.id, renamed.error);
          else if (renamed.edits.length > MAX_LSP_RESULT_ITEMS) respondError(message.id, `Rename affects more than ${MAX_LSP_RESULT_ITEMS} locations`);
          else respond(message.id, {
            changes: { [descriptor.uri]: renamed.edits.map((edit) => ({ range: scriptRange(document.text, edit), newText: edit.replacement })) },
          });
          break;
        }
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
        const script = scriptDocuments.get(descriptor.uri);
        if (document && script) {
          respond(message.id, script.analysis().symbols.slice(0, MAX_LSP_RESULT_ITEMS).map((symbol) => ({
            name: clipLspText(symbol.name),
            detail: clipLspText(symbol.type),
            kind: lspSymbolKind(symbol.kind),
            range: scriptRange(document.text, symbol),
            selectionRange: scriptRange(document.text, symbol),
          })));
          break;
        }
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
        if (scriptDocuments.has(descriptor.uri)) {
          respond(message.id, null);
          break;
        }
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
        if (scriptDocuments.has(descriptor.uri)) {
          respond(message.id, []);
          break;
        }
        const path = pathOf(descriptor.uri);
        const project = document ? await projectFor(document) : null;
        respond(message.id, document && path && project ? projectInlayHints(project, path, document.text, range) : []);
        break;
      }
      case "textDocument/semanticTokens/full": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const document = documents.get(descriptor.uri);
        const script = scriptDocuments.get(descriptor.uri);
        if (document && script) {
          respond(message.id, { data: scriptSemanticTokenData(document.text, script.analysis()) });
          break;
        }
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
        if (scriptDocuments.has(descriptor.uri)) {
          respond(message.id, []);
          break;
        }
        const acceptsQuickFix = !context?.only || context.only.some((kind) => kind === "quickfix" || kind.startsWith("quickfix."));
        respond(message.id, document && acceptsQuickFix ? quickFixes(document, context?.diagnostics ?? []) : []);
        break;
      }
      case "textDocument/formatting": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const document = documents.get(descriptor.uri);
        if (!document) {
          respond(message.id, []);
          break;
        }
        if (scriptDocuments.has(descriptor.uri)) {
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

function boundedScriptDiagnostics(text: string, analysis: ScriptAnalysis): unknown[] {
  const diagnostics = analysis.diagnostics.slice(0, MAX_LSP_RESULT_ITEMS);
  const ends = diagnostics.map((diagnostic) => Math.max(diagnostic.start + 1, diagnostic.end));
  const positions = scriptPositionsAt(text, diagnostics.flatMap((diagnostic, index) => [diagnostic.start, ends[index]!]));
  const output = diagnostics.map((diagnostic, index) => ({
    range: scriptRangeFromPositions(positions, diagnostic.start, ends[index]!),
    severity: diagnostic.severity === "error" ? 1 : 2,
    code: diagnostic.code,
    source: "velar-script",
    message: clipLspText(diagnostic.message),
  }));
  if (analysis.diagnostics.length > MAX_LSP_RESULT_ITEMS) {
    if (output.length >= MAX_LSP_RESULT_ITEMS) output.pop();
    output.push({
      range: scriptRange(text, { start: 0, end: Math.min(1, codePointCount(text, 0, text.length)) }),
      severity: 2,
      code: "SCRIPT9001",
      source: "velar-script",
      message: `Script diagnostics were truncated to ${MAX_LSP_RESULT_ITEMS} items`,
    });
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

function scriptSemanticTokenData(text: string, analysis: ScriptAnalysis): number[] {
  const tokens = analysis.tokens.slice(0, MAX_LSP_RESULT_ITEMS);
  const positions = scriptPositionsAt(text, tokens.flatMap((token) => [token.start, token.end]));
  const declarations = new Map<string, ScriptAnalysis["symbols"][number]>(analysis.symbols.map((symbol) => [`${symbol.start}:${symbol.end}`, symbol]));
  const references = new Map<string, ScriptAnalysis["references"][number]>(analysis.references.map((reference) => [`${reference.start}:${reference.end}`, reference]));
  const symbols = new Map(analysis.symbols.map((symbol) => [symbol.id, symbol] as const));
  const data: number[] = [];
  let previousLine = 0;
  let previousCharacter = 0;
  for (const token of tokens) {
    const key = `${token.start}:${token.end}`;
    const declaration = declarations.get(key);
    const reference = references.get(key);
    const symbol = declaration ?? (reference ? symbols.get(reference.symbolId) : undefined);
    const type = symbol ? scriptSemanticSymbolType(symbol.kind) : scriptLexicalTokenType(token.kind);
    if (!type) continue;
    const range = scriptRangeFromPositions(positions, token.start, token.end);
    if (range.start.line !== range.end.line || range.end.character <= range.start.character) continue;
    const deltaLine = range.start.line - previousLine;
    const deltaCharacter = deltaLine === 0 ? range.start.character - previousCharacter : range.start.character;
    const tokenType = semanticTokenTypes.indexOf(type);
    if (tokenType < 0 || deltaLine < 0 || deltaCharacter < 0) continue;
    const modifiers = (declaration ? 1 << semanticTokenModifiers.indexOf("declaration") : 0)
      | (symbol && (symbol.kind === "constant" || symbol.kind === "import") ? 1 << semanticTokenModifiers.indexOf("readonly") : 0);
    data.push(deltaLine, deltaCharacter, range.end.character - range.start.character, tokenType, modifiers);
    previousLine = range.start.line;
    previousCharacter = range.start.character;
  }
  return data;
}

function scriptSemanticSymbolType(kind: ScriptSymbolKind): typeof semanticTokenTypes[number] {
  switch (kind) {
    case "class": return "class";
    case "interface": return "interface";
    case "type": return "type";
    case "enum": return "enum";
    case "function": return "function";
    case "parameter": return "parameter";
    default: return "variable";
  }
}

function scriptLexicalTokenType(kind: ScriptAnalysis["tokens"][number]["kind"]): typeof semanticTokenTypes[number] | null {
  switch (kind) {
    case "comment": return "comment";
    case "string":
    case "template": return "string";
    case "keyword": return "keyword";
    case "number": return "number";
    case "regexp": return "regexp";
    case "operator": return "operator";
    case "identifier": return "variable";
    default: return null;
  }
}

function quickFixes(document: TextDocument, diagnostics: readonly unknown[]): unknown[] {
  const actions: unknown[] = [];
  for (const value of diagnostics.slice(0, MAX_LSP_RESULT_ITEMS)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const diagnostic = value as { readonly code?: unknown; readonly message?: unknown; readonly range?: unknown };
    if (!diagnostic.range || typeof diagnostic.range !== "object" || Array.isArray(diagnostic.range)) continue;
    const range = diagnostic.range as Range;
    const start = offsetAt(document.text, range.start);
    const end = offsetAt(document.text, range.end);
    const original = document.text.slice(start, end);
    let replacement: string | null = null;
    let title: string | null = null;
    let editRange = range;
    if (diagnostic.code === "VEL1005" && original === "===") {
      replacement = "==";
      title = "Use VelarScript strict equality '=='";
    } else if (diagnostic.code === "VEL1005" && original === "!==") {
      replacement = "!=";
      title = "Use VelarScript strict inequality '!='";
    } else if (diagnostic.code === "VEL1002" && original === "\t") {
      replacement = "    ";
      title = "Replace the indentation tab with four spaces";
    } else if (diagnostic.code === "VEL1005" && original === "#" && typeof diagnostic.message === "string"
      && diagnostic.message.includes("JavaScript private identifiers")) {
      replacement = "";
      title = "Remove the JavaScript private marker";
    } else if (diagnostic.code === "VEL1005") {
      const direct = new Map<string, readonly [string, string]>([
        ["undefined", ["null", "Use VelarScript null"]],
        ["none", ["null", "Use VelarScript null"]],
        ["None", ["null", "Use VelarScript null"]],
        ["True", ["true", "Use lowercase true"]],
        ["False", ["false", "Use lowercase false"]],
        ["elif", ["else if", "Use 'else if'"]],
        ["int", ["number", "Use the VelarScript number type"]],
        ["float", ["number", "Use the VelarScript number type"]],
        ["&&", ["and", "Use readable 'and'"]],
        ["||", ["or", "Use readable 'or'"]],
        ["!", ["not", "Use readable 'not'"]],
      ]).get(original);
      if (direct) [replacement, title] = direct;
    } else if (diagnostic.code === "VEL2012" && typeof diagnostic.message === "string") {
      const typeGuidance = sourceTypeNameGuidance(original);
      if (typeGuidance?.replacement && typeGuidance.title) {
        replacement = typeGuidance.replacement;
        title = typeGuidance.title;
      } else if (diagnostic.message.includes("Generic type arguments use") && original.startsWith("[") && original.endsWith("]")) {
        replacement = `<${original.slice(1, -1)}>`;
        title = "Use angle brackets for generic type arguments";
      }
    } else if (diagnostic.code === "VEL2024") {
      let colon = end;
      while (colon < document.text.length && (document.text[colon] === " " || document.text[colon] === "\t")) colon += 1;
      if (document.text[colon] === ":") {
        editRange = { start: positionAt(document.text, colon), end: positionAt(document.text, colon + 1) };
        replacement = "=";
        title = "Use '=' for the named argument";
      }
    } else if (diagnostic.code === "VEL4001" && typeof diagnostic.message === "string") {
      const member = /\.([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(original);
      const owner = /^(List|Set|Map) has no member/u.exec(diagnostic.message)?.[1] as CollectionKind | undefined;
      const guidance = member && owner ? collectionMemberGuidance(owner, member[1]!) : null;
      if (member && guidance?.replacement && guidance.title) {
        editRange = { start: positionAt(document.text, end - member[1]!.length), end: positionAt(document.text, end) };
        replacement = guidance.replacement;
        title = guidance.title;
      }
    }
    if (replacement === null || !title) continue;
    actions.push({
      title,
      kind: "quickfix",
      isPreferred: true,
      edit: { changes: { [document.uri]: [{ range: editRange, newText: replacement }] } },
    });
  }
  return actions;
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

function scriptTextEdit(previous: string, next: string): ScriptEdit | null {
  if (previous === next) return null;
  const before = Array.from(previous);
  const after = Array.from(next);
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < limit - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix += 1;
  return {
    start: prefix,
    end: before.length - suffix,
    replacement: after.slice(prefix, after.length - suffix).join(""),
  };
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

function scriptOffsetAt(text: string, position: Position): number {
  return codePointCount(text, 0, offsetAt(text, position));
}

function scriptRange(text: string, span: ScriptSpan): Range {
  const positions = scriptPositionsAt(text, [span.start, span.end]);
  return scriptRangeFromPositions(positions, span.start, span.end);
}

function scriptRangeFromPositions(positions: ReadonlyMap<number, Position>, start: number, end: number): Range {
  const startPosition = positions.get(start);
  const endPosition = positions.get(end);
  if (!startPosition || !endPosition) throw new Error("Script coordinate map is incomplete");
  return { start: startPosition, end: endPosition };
}

function scriptPositionsAt(text: string, offsets: readonly number[]): ReadonlyMap<number, Position> {
  const requested = [...new Set(offsets.map((offset) => Math.max(0, offset)))].sort((left, right) => left - right);
  const output = new Map<number, Position>();
  let codeUnit = 0;
  let codePoint = 0;
  let line = 0;
  let lineCodeUnit = 0;
  let lineCodePoint = 0;
  let pendingCarriageReturn = false;
  for (const requestedOffset of requested) {
    while (codePoint < requestedOffset && codeUnit < text.length) {
      const value = text.codePointAt(codeUnit)!;
      const width = value > 0xffff ? 2 : 1;
      const character = text[codeUnit]!;
      codeUnit += width;
      codePoint += 1;
      if (pendingCarriageReturn) {
        pendingCarriageReturn = false;
        if (character === "\n") {
          line += 1;
          lineCodeUnit = codeUnit;
          lineCodePoint = codePoint;
          continue;
        }
      }
      if (character === "\r") {
        if (text[codeUnit] === "\n") pendingCarriageReturn = true;
        else {
          line += 1;
          lineCodeUnit = codeUnit;
          lineCodePoint = codePoint;
        }
      } else if (character === "\n") {
        line += 1;
        lineCodeUnit = codeUnit;
        lineCodePoint = codePoint;
      }
    }
    const boundedOffset = Math.min(requestedOffset, codePoint);
    output.set(requestedOffset, {
      line,
      character: activePositionEncoding === "utf-16" ? codeUnit - lineCodeUnit : boundedOffset - lineCodePoint,
    });
  }
  return output;
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
