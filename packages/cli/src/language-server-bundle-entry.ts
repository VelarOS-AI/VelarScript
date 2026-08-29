import { installOfficialLanguageServerExtensions } from "./official-language-server-extensions.ts";
import { runLanguageServer } from "./language-server.ts";

await installOfficialLanguageServerExtensions();
await runLanguageServer();
