/** D115 P4 R4c — `velar/emittedJavaScript`: the JavaScript one module compiled to, bounded. */
import { ownershipGraphRevision } from "../ownership-graph.ts";
import { VELAR_VERSION } from "../version.ts";
import { boundedDiagnostics } from "./diagnostics.ts";
import { isVelarDocument, pathOf } from "./paths.ts";
import { MAX_EMITTED_JAVASCRIPT_CHARS, type RequestParams, type TextDocument } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

export async function emittedJavaScript(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri"> | undefined;
  const requestedVersionValue = params?.version;
  const maximumCharsValue = params?.maximumChars;
  if (!descriptor || typeof descriptor.uri !== "string"
    || (requestedVersionValue !== undefined && (typeof requestedVersionValue !== "number" || !Number.isSafeInteger(requestedVersionValue)))
    || (maximumCharsValue !== undefined && (typeof maximumCharsValue !== "number" || !Number.isSafeInteger(maximumCharsValue)))) {
    session.respondError(message.id, "velar/emittedJavaScript requires textDocument.uri and optional integer version and maximumChars", -32602);
    return;
  }
  const requestedVersion = requestedVersionValue as number | undefined;
  const maximumChars = maximumCharsValue as number | undefined;
  if (maximumChars !== undefined && (maximumChars < 1 || maximumChars > MAX_EMITTED_JAVASCRIPT_CHARS)) {
    session.respondError(message.id, `velar/emittedJavaScript maximumChars must be 1 through ${MAX_EMITTED_JAVASCRIPT_CHARS}`, -32602);
    return;
  }
  const document = session.documents.get(descriptor.uri);
  if (!document || !isVelarDocument(document)) {
    session.respondError(message.id, "velar/emittedJavaScript requires an open VelarScript document", -32602);
    return;
  }
  if (requestedVersion !== undefined && requestedVersion !== document.version) {
    session.respondError(message.id, `Document version ${requestedVersion} is no longer current`, -32801);
    return;
  }
  const path = pathOf(session, descriptor.uri);
  const project = path ? await session.projectFor(document) : null;
  const module = path && project ? project.modules.find((item) => item.inputPath === path) : null;
  if (!project || !module) {
    session.respondError(message.id, "VelarScript project module is unavailable for this document");
    return;
  }
  const limit = maximumChars ?? MAX_EMITTED_JAVASCRIPT_CHARS;
  const code = module.result.code;
  const sourceMap = module.result.sourceMap;
  session.respond(message.id, {
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
    diagnostics: boundedDiagnostics(session, module.result.source, module.result.diagnostics, [], module.result.advisories),
  });
}
