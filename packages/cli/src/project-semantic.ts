/**
 * D115 P4 R4c — the project semantic queries an editor asks for, as a facade
 * over `semantic/`.
 *
 * Every name this module exported before the split it still exports, from the
 * same path, so the language server and the twelve tests that reach for one
 * query each did not move. What changed is where the answers live: each
 * capability is now one file a reader can hold, and the target resolution the
 * survey measured at ~400 lines is `targets.ts` (which target a position names)
 * plus `members.ts` (what a member rename touches), `enums.ts`, and the
 * position-and-location arithmetic in `locations.ts` all of them share.
 *
 * The direction is one-way: `types` ← `locations` ← `targets` ← everything
 * else, with `symbol-lookup.ts` holding the one pair that is mutually recursive
 * (`projectSymbolAt` resolves through `enumMemberAt`, which resolves the
 * enum's owner back through `projectSymbolAt`), so no two modules here import
 * each other.
 */
export type {
  ProjectCompletion,
  ProjectCompletionContext,
  ProjectDocumentSymbol,
  ProjectLocation,
  ProjectRename,
  ProjectRenameFailure,
  ProjectSemanticToken,
  ProjectSignature,
  ProjectSyntaxDocumentation,
  ProjectTextEdit,
  ProjectWorkspaceSymbol,
} from "./semantic/types.ts";
export type { ProjectSemanticTokenModifier, ProjectSemanticTokenType } from "./lsp/semantic-token-roles.ts";

export { projectDefinitionAt } from "./semantic/definition.ts";
export { projectReferencesAt } from "./semantic/references.ts";
export { projectPrepareRenameAt, projectRenameAt } from "./semantic/rename.ts";
export { projectDocumentSymbols, projectWorkspaceSymbols } from "./semantic/symbols.ts";
export { projectSemanticTokens } from "./semantic/tokens.ts";
export { projectMemberDocumentationAt, projectSyntaxDocumentationAt } from "./semantic/documentation.ts";
export {
  projectExpressionAt,
  projectMemberSymbolAt,
  projectSymbolAt,
  projectUnresolvedValueReferenceAt,
} from "./semantic/symbol-lookup.ts";
export { projectCompletionContextAt, projectCompletionsAt } from "./semantic/completion.ts";
export { projectSignatureAt } from "./semantic/signature.ts";
