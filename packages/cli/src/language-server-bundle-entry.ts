import { installOfficialLanguageServerExtensions } from "./official-language-server-extensions.ts";
import { installOfficialScriptLanguageService } from "./official-script-language-service.ts";
import { runLanguageServer } from "./language-server.ts";

installOfficialLanguageServerExtensions();
installOfficialScriptLanguageService();
await runLanguageServer();
