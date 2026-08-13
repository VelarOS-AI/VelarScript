import { ScriptDocument, ScriptLanguage } from "@velarscript/script-analysis";
import { registerScriptLanguageService } from "./script-language-service.ts";

export function installOfficialScriptLanguageService(): void {
  registerScriptLanguageService({
    create(language, text) {
      return new ScriptDocument(language === "typescript" ? ScriptLanguage.typescript : ScriptLanguage.javascript, text);
    },
  });
}
