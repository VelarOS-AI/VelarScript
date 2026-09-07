/** D115 P4 R4c — `textDocument/hover`: the first documented thing under the cursor. */
import { CORE_PRELUDE_NAMES, type CorePreludeName } from "@velarscript/compiler";
import {
  projectExpressionAt,
  projectMemberDocumentationAt,
  projectMemberSymbolAt,
  projectSymbolAt,
  projectSyntaxDocumentationAt,
  projectUnresolvedValueReferenceAt,
} from "../project-semantic.ts";
import type { ProjectResult } from "../project.ts";
import { standardNamespaceDocumentation } from "../standard-api-documentation.ts";
import { clipLspText } from "./diagnostics.ts";
import {
  builtinTypeDocumentation,
  corePreludeDocumentation,
  extensionDocumentation,
  keywordDocumentation,
} from "./documentation.ts";
import { pathOf } from "./paths.ts";
import { offsetAt, wordAt } from "./positions.ts";
import type { Position, RequestParams, TextDocument } from "./protocol.ts";
import type { DocumentRequestSession } from "./session.ts";
import type { RpcMessage } from "./transport.ts";

async function hover(session: DocumentRequestSession, document: TextDocument, position: Position, project: ProjectResult | null): Promise<unknown> {
  const offset = offsetAt(session, document.text, position);
  const path = pathOf(session, document.uri);
  const symbol = path && project ? projectSymbolAt(project, path, offset) : null;
  if (symbol) {
    const declaration = symbol.kind === "variable" ? (symbol.mutable ? "let" : "const") : symbol.kind;
    const type = symbol.type ? `: ${symbol.type}` : "";
    const documentation = symbol.documentation ? `\n\n${symbol.documentation}` : "";
    return { contents: { kind: "markdown", value: clipLspText(`\`\`${declaration} ${symbol.name}${type}\`\`${documentation}`) } };
  }
  const syntax = path && project ? projectSyntaxDocumentationAt(project, path, offset) : null;
  if (syntax) {
    const documentation = keywordDocumentation.get(syntax.key)
      ?? extensionDocumentation(project, "keywordDocumentation", syntax.key);
    if (documentation) {
      const label = document.text.slice(syntax.span.start, syntax.span.end);
      return { contents: { kind: "markdown", value: clipLspText(`\`\`${label}\`\`\n\n${documentation}`) } };
    }
  }
  const word = wordAt(document.text, offset);
  if (!word) return null;
  const unresolvedValueReference = path && project ? projectUnresolvedValueReferenceAt(project, path, offset) : false;
  const keyword = keywordDocumentation.get(word) ?? extensionDocumentation(project, "keywordDocumentation", word);
  if (keyword) return { contents: { kind: "markdown", value: `\`\`${word}\`\`\n\n${keyword}` } };
  const expression = path && project ? projectExpressionAt(project, path, offset) : null;
  if (expression?.memberName) {
    const declaration = expression.callable ? "method" : "field";
    const member = path && project ? projectMemberSymbolAt(project, path, offset) : null;
    const standardDocumentation = path && project ? projectMemberDocumentationAt(project, path, offset) : null;
    const documentation = member?.documentation ?? standardDocumentation;
    return { contents: { kind: "markdown", value: clipLspText(`\`\`${declaration} ${expression.memberName}: ${expression.type}\`\`${documentation ? `\n\n${documentation}` : ""}`) } };
  }
  const member = path && project ? projectMemberSymbolAt(project, path, offset) : null;
  if (member) {
    const type = member.type ? `: ${member.type}` : "";
    const standardDocumentation = path && project ? projectMemberDocumentationAt(project, path, offset) : null;
    const documentation = member.documentation ?? standardDocumentation;
    return { contents: { kind: "markdown", value: clipLspText(`\`\`${member.kind} ${member.name}${type}\`\`${documentation ? `\n\n${documentation}` : ""}`) } };
  }
  if (unresolvedValueReference && (CORE_PRELUDE_NAMES as readonly string[]).includes(word)) {
    return { contents: { kind: "markdown", value: clipLspText(`\`\`${word}\`\`\n\n${corePreludeDocumentation(word as CorePreludeName)}`) } };
  }
  const namespace = unresolvedValueReference
    ? standardNamespaceDocumentation(word, project?.compilerExtensions ?? [])
    : null;
  if (namespace) return { contents: { kind: "markdown", value: clipLspText(`\`\`${word}\`\`\n\n${namespace}`) } };
  const builtinType = builtinTypeDocumentation.get(word) ?? extensionDocumentation(project, "typeDocumentation", word);
  if (builtinType) return { contents: { kind: "markdown", value: `\`\`${word}\`\`\n\n${builtinType}` } };
  return null;
}

export async function hoverAt(session: DocumentRequestSession, message: RpcMessage, params: RequestParams): Promise<void> {
  const descriptor = params?.textDocument as Pick<TextDocument, "uri">;
  const position = params?.position as Position;
  const document = session.documents.get(descriptor.uri);
  session.respond(message.id, document ? await hover(session, document, position, await session.projectFor(document)) : null);
}
