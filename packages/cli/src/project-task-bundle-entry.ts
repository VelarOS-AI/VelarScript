import { isAbsolute } from "node:path";
import { installOfficialLanguageServerExtensions } from "./official-language-server-extensions.ts";

const [command, projectRoot, separator, ...programArguments] = process.argv.slice(2);
const supported = new Set(["check", "test", "build", "run"]);
const validRunArguments = command === "run"
  ? separator === undefined || separator === "--"
  : separator === undefined && programArguments.length === 0;
if (!supported.has(command ?? "") || typeof projectRoot !== "string" || !isAbsolute(projectRoot)
  || projectRoot.length > 4096 || projectRoot.includes("\0") || !validRunArguments) {
  process.stderr.write("velar project task: invalid package-owned task invocation\n");
  process.exitCode = 2;
} else {
  installOfficialLanguageServerExtensions();
  await import("./cli.ts");
}
