declare module "velar/javascript" {
  import type { ScriptDocumentOwner, ScriptLanguage as ScriptLanguageName } from "./script-language-service.ts";

  export const ScriptLanguage: Readonly<Record<ScriptLanguageName, ScriptLanguageName>>;

  export class ScriptDocument implements ScriptDocumentOwner {
    constructor(language: ScriptLanguageName, text: string);
    readonly language: ScriptLanguageName;
    readonly revision: number;
    readonly text: string;
    analysis(): ReturnType<ScriptDocumentOwner["analysis"]>;
    activity(): ReturnType<ScriptDocumentOwner["activity"]>;
    update(text: string): ReturnType<ScriptDocumentOwner["update"]>;
    apply(edits: Parameters<ScriptDocumentOwner["apply"]>[0]): ReturnType<ScriptDocumentOwner["apply"]>;
    tokenAt(offset: number): ReturnType<ScriptDocumentOwner["tokenAt"]>;
    symbolAt(offset: number): ReturnType<ScriptDocumentOwner["symbolAt"]>;
    definitionAt(offset: number): ReturnType<ScriptDocumentOwner["definitionAt"]>;
    referencesAt(offset: number, includeDeclaration?: boolean): ReturnType<ScriptDocumentOwner["referencesAt"]>;
    hoverAt(offset: number): ReturnType<ScriptDocumentOwner["hoverAt"]>;
    completionsAt(offset: number): ReturnType<ScriptDocumentOwner["completionsAt"]>;
    renameAt(offset: number, replacement: string): ReturnType<ScriptDocumentOwner["renameAt"]>;
  }
}
