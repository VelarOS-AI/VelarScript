import type { SemanticSymbol, Span } from "@velarscript/compiler";
import type { ProjectSemanticTokenModifier, ProjectSemanticTokenType } from "../lsp/semantic-token-roles.ts";
import type { ProjectModule } from "../project.ts";

export interface ProjectLocation {
  readonly path: string;
  readonly span: Span;
}

export interface ProjectTextEdit extends ProjectLocation {
  readonly replacement?: string;
}

export interface ProjectDocumentSymbol extends ProjectLocation {
  readonly name: string;
  readonly kind: SemanticSymbol["kind"];
  readonly selectionSpan: Span;
  readonly type: string | null;
  readonly presentationKind?: SemanticSymbol["presentationKind"];
}

export interface ProjectWorkspaceSymbol extends ProjectLocation {
  readonly name: string;
  readonly kind: SemanticSymbol["kind"];
  readonly selectionSpan: Span;
  readonly type: string | null;
  readonly containerName?: string;
  readonly presentationKind?: SemanticSymbol["presentationKind"];
}

export interface ProjectSignature {
  readonly label: string;
  readonly activeParameter: number;
}

export interface ProjectCompletion {
  readonly label: string;
  readonly detail: string;
  readonly kind: SemanticSymbol["kind"];
  readonly documentation?: string;
  readonly presentationKind?: SemanticSymbol["presentationKind"];
  readonly insertText?: string;
  readonly filterText?: string;
  readonly sortText?: string;
  readonly snippet?: boolean;
}

export type { ProjectSemanticTokenModifier, ProjectSemanticTokenType } from "../lsp/semantic-token-roles.ts";

export interface ProjectSemanticToken {
  readonly span: Span;
  readonly type: ProjectSemanticTokenType;
  readonly modifiers: readonly ProjectSemanticTokenModifier[];
}

export interface ProjectSyntaxDocumentation {
  readonly span: Span;
  readonly key: string;
}

export type ProjectCompletionContext = "ordinary" | "member" | "object-field" | `extension:${string}`;

export interface ProjectRename {
  readonly edits: readonly ProjectTextEdit[];
  readonly placeholder: string;
}

export type ProjectRenameFailure = string;

export interface LocalTarget {
  readonly kind: "local";
  readonly module: ProjectModule;
  readonly symbol: SemanticSymbol;
}

export interface ExportTarget {
  readonly kind: "export";
  readonly module: ProjectModule;
  readonly symbol: SemanticSymbol;
}

export type ProjectTarget = LocalTarget | ExportTarget;

export interface MemberTarget {
  readonly module: ProjectModule;
  readonly symbol: SemanticSymbol;
}
