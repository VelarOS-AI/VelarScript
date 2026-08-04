import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectionMemberGuidance, compile, formatSource, sourceTypeNameGuidance, type CollectionKind, type Diagnostic, type SourceText, type Span } from "@velarscript/compiler";
import { compileProjectEntries, type ProjectResult } from "./project.ts";
import { VelarProjectSessions } from "./project-session.ts";
import { VELAR_VERSION } from "./version.ts";
import { hostErrorMessage } from "./host-error.ts";
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
} from "./project-semantic.ts";

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

export const VELAR_LANGUAGE_SERVER_PROTOCOL_VERSION = 1;
const MAX_LSP_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_LSP_RESULT_ITEMS = 10_000;
const MAX_LSP_TEXT_CHARS = 64 * 1024;
const semanticTokenTypes = ["type", "class", "enum", "enumMember", "function", "method", "property", "variable", "parameter"] as const;
const semanticTokenModifiers = ["declaration", "readonly", "static"] as const;

const keywordDocumentation = new Map<string, string>([
  ["assert", "Requires a boolean or optional invariant and narrows stable values in following statements."],
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
  ["null", "The only empty value in ordinary VelarScript source; undefined is not exposed."],
]);

const builtinTypeDocumentation = new Map<string, string>([
  ["string", "A JavaScript string with VelarScript text operations."],
  ["number", "A JavaScript number type; number(text) strictly parses complete finite decimal text and returns number?."],
  ["bool", "The `true` or `false` boolean type."],
  ["unknown", "An unchecked boundary value that must be validated before ordinary use."],
  ["List", "An ordered collection with one checked element type."],
  ["Map", "An insertion-ordered JavaScript Map with checked key and value types."],
  ["Set", "An insertion-ordered JavaScript Set with one checked element type."],
  ["Promise", "A JavaScript Promise with one checked resolved-value type."],
]);

const coreCompletionItems = [
  ...["const", "let", "def", "async", "await", "type", "enum", "abstract", "class", "constructor", "extends", "override", "private", "static", "get", "super", "pass", "return", "throw", "assert", "if", "else", "match", "case", "for", "in", "while", "try", "catch", "finally", "import", "export", "null", "true", "false", "and", "or", "not"].map((label) => ({ label, kind: 14 })),
  ...[...builtinTypeDocumentation].map(([label, detail]) => ({ label, kind: 7, detail })),
  { label: "str", kind: 3, detail: "str(value) -> string" },
  { label: "print", kind: 3, detail: "print(value) -> null" },
  { label: "velar/collections", kind: 9, detail: "Typed collection transforms and Python-style iteration helpers" },
  { label: "velar/text", kind: 9, detail: "Unicode-aware text normalization and formatting helpers" },
  { label: "velar/math", kind: 9, detail: "Numeric constants, transforms, and random helpers" },
  { label: "velar/json", kind: 9, detail: "JSON parsing, validation, cloning, and stable serialization" },
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
  const documents = new Map<string, TextDocument>();
  const sessions = new VelarProjectSessions();
  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();
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
    const itemPath = pathOf(item.uri);
    return itemPath ? [[itemPath, item.text] as const] : [];
  }));
  const projectFor = async (document: TextDocument): Promise<ProjectResult | null> => {
    const path = pathOf(document.uri);
    if (!path) return null;
    try {
      return (await sessions.snapshot(path, overrides())).project;
    } catch {
      return compileProjectEntries([path], path, overrides(), {
        sourceRoot: dirname(path),
        projectRoot: dirname(path),
      });
    }
  };

  const publish = async (document: TextDocument): Promise<void> => {
    const current = documents.get(document.uri);
    if (!current || current.version !== document.version) return;
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

  const respond = (id: RpcMessage["id"], result: unknown): void => send({ jsonrpc: "2.0", id: id ?? null, result });
  const respondError = (id: RpcMessage["id"], message: string, code = -32803): void => send({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  const handle = async (message: RpcMessage): Promise<void> => {
    if (shuttingDown && message.method !== "exit") {
      if (message.id !== undefined) respondError(message.id, "VelarScript Language Server is shutting down", -32600);
      return;
    }
    const params = message.params as Record<string, unknown> | undefined;
    switch (message.method) {
      case "initialize":
        respond(message.id, {
          capabilities: {
            textDocumentSync: { openClose: true, change: 2, save: { includeText: true } },
            completionProvider: { triggerCharacters: [".", "<", " ", "{", ",", ":"] },
            hoverProvider: true,
            documentFormattingProvider: true,
            definitionProvider: true,
            referencesProvider: true,
            documentHighlightProvider: true,
            renameProvider: { prepareProvider: true },
            documentSymbolProvider: true,
            signatureHelpProvider: { triggerCharacters: ["(", ","] },
            inlayHintProvider: true,
            semanticTokensProvider: {
              legend: { tokenTypes: semanticTokenTypes, tokenModifiers: semanticTokenModifiers },
              full: true,
            },
            codeActionProvider: { codeActionKinds: ["quickfix"] },
            experimental: {
              velar: { protocolVersion: VELAR_LANGUAGE_SERVER_PROTOCOL_VERSION },
            },
          },
          serverInfo: { name: "VelarScript Language Server", version: VELAR_VERSION },
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
      case "textDocument/didOpen": {
        const value = params?.textDocument as TextDocument;
        documents.set(value.uri, value);
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
        await publish(next);
        break;
      }
      case "textDocument/didSave": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        const current = documents.get(descriptor.uri);
        if (current) await publish(current);
        break;
      }
      case "textDocument/didClose": {
        const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
        documents.delete(descriptor.uri);
        send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: descriptor.uri, diagnostics: [] } });
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
          kind: lspCompletionKind(item.kind),
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
          kind: lspSymbolKind(symbol.kind),
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
        const formatted = formatSource(document.text);
        respond(message.id, formatted === document.text ? [] : [{ range: fullRange(document.text), newText: formatted }]);
        break;
      }
      default:
        if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method ?? ""}` } });
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
      queue = queue.then(() => handle(message)).catch((error) => {
        if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: hostErrorMessage(error) } });
      });
    }
  });
  await Promise.race([new Promise<void>((resolve) => process.stdin.once("end", resolve)), exitRequested]);
  await queue;
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
  const start = source.location(item.span.start);
  const end = source.location(Math.max(item.span.start + 1, item.span.end));
  return {
    range: {
      start: { line: start.line - 1, character: start.column - 1 },
      end: { line: end.line - 1, character: end.column - 1 },
    },
    severity: 1,
    code: item.code,
    source: "velar",
    message: clipLspText(item.message),
  };
}

function lspNotice(source: SourceText, message: string): unknown {
  const start = source.location(0);
  const end = source.location(Math.min(1, source.text.length));
  return {
    range: {
      start: { line: start.line - 1, character: start.column - 1 },
      end: { line: end.line - 1, character: end.column - 1 },
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
    const declaration = expression.type.startsWith("(") ? "method" : "field";
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
  const start = source.location(span.start);
  const end = source.location(span.end);
  return {
    start: { line: start.line - 1, character: start.column - 1 },
    end: { line: end.line - 1, character: end.column - 1 },
  };
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
    const start = source.location(token.span.start);
    const end = source.location(token.span.end);
    if (start.line !== end.line || end.column <= start.column) continue;
    const line = start.line - 1;
    const character = start.column - 1;
    const deltaLine = line - previousLine;
    const deltaCharacter = deltaLine === 0 ? character - previousCharacter : character;
    const tokenType = semanticTokenTypes.indexOf(token.type);
    if (tokenType < 0 || deltaLine < 0 || deltaCharacter < 0) continue;
    const modifiers = token.modifiers.reduce((bits, modifier) => {
      const index = semanticTokenModifiers.indexOf(modifier);
      return index < 0 ? bits : bits | (1 << index);
    }, 0);
    data.push(deltaLine, deltaCharacter, end.column - start.column, tokenType, modifiers);
    previousLine = line;
    previousCharacter = character;
  }
  return data;
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
      const member = /\.([A-Za-z][A-Za-z0-9_]*)$/u.exec(original);
      const owner = /^(List|Set|Map) has no member/u.exec(diagnostic.message)?.[1] as CollectionKind | undefined;
      const guidance = member && owner ? collectionMemberGuidance(owner, member[1]!) : null;
      if (member && guidance?.replacement && guidance.title) {
        editRange = { start: positionAt(document.text, end - member[1]!.length), end: positionAt(document.text, end) };
        replacement = guidance.replacement;
        title = guidance.title;
      }
    }
    if (!replacement || !title) continue;
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
  // Resource symbols expose the runtime handle shape, while a source-level
  // resource annotation describes its resolved value. Showing the handle as
  // `: { value, loading, ... }` would look like a valid source annotation but
  // mean something different, so keep resource types in hover until the
  // semantic index carries the source-facing resolved type separately.
  const kinds = new Set(["variable", "state", "computed"]);
  const hints: unknown[] = [];
  for (const symbol of module.result.semanticIndex.symbols) {
    if (hints.length >= MAX_LSP_RESULT_ITEMS) break;
    if (!kinds.has(symbol.kind) || !symbol.type || symbol.type.length > 1024) continue;
    if (symbol.selectionSpan.end < start || symbol.selectionSpan.end > end) continue;
    const declarationEnd = lineEndAt(text, symbol.selectionSpan.end);
    const assignment = text.indexOf("=", symbol.selectionSpan.end);
    if (assignment !== -1 && assignment < declarationEnd && text.slice(symbol.selectionSpan.end, assignment).includes(":")) continue;
    const location = module.result.source.location(symbol.selectionSpan.end);
    hints.push({
      position: { line: location.line - 1, character: location.column - 1 },
      label: `: ${symbol.type}`,
      kind: 1,
      paddingRight: true,
    });
  }
  return hints;
}

function lspSymbolKind(kind: string): number {
  switch (kind) {
    case "class": return 5;
    case "method": return 6;
    case "field": return 8;
    case "enum": return 10;
    case "type": return 11;
    case "enum-member": return 22;
    case "component": return 5;
    case "function":
    case "style":
    case "action": return 12;
    case "computed": return 14;
    case "state":
    case "variable":
    case "parameter":
    case "import":
    case "watch-value":
    case "catch": return 13;
    default: return 13;
  }
}

function lspCompletionKind(kind: string): number {
  switch (kind) {
    case "method": return 2;
    case "function":
    case "style":
    case "action": return 3;
    case "field": return 5;
    case "variable":
    case "parameter":
    case "state":
    case "computed":
    case "resource":
    case "watch-value":
    case "catch":
    case "import": return 6;
    case "class":
    case "component": return 7;
    case "type": return 8;
    case "enum": return 13;
    case "enum-member": return 20;
    default: return 1;
  }
}

function pathOf(uri: string): string | null {
  try { return uri.startsWith("file:") ? fileURLToPath(uri) : null; } catch { return null; }
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
  return Math.min(lineEndAt(text, offset), offset + requestedCharacter);
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
  return { line, character: offset - lineStart };
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
  while (start > 0 && /[A-Za-z0-9_]/u.test(text[start - 1]!)) start -= 1;
  while (end < text.length && /[A-Za-z0-9_]/u.test(text[end]!)) end += 1;
  return text.slice(start, end);
}

function fullRange(text: string): Range {
  return { start: { line: 0, character: 0 }, end: positionAt(text, text.length) };
}
