import { velarApplicationPackageHost as desktopApplicationPackageHost } from "@velarscript/desktop/package-host";
import { registerBundledApplicationPackageHost } from "./bundled-application-package-host-registry.ts";
import { installOfficialLanguageServerExtensions } from "./official-language-server-extensions.ts";
import {
  projectTaskBrowserWorkerCliArguments,
  projectTaskBrowserWorkerEnvironment,
  projectTaskCliArguments,
} from "./project-task-invocation.ts";

registerBundledApplicationPackageHost(desktopApplicationPackageHost);

const cliArguments = process.env[projectTaskBrowserWorkerEnvironment] === undefined
  ? projectTaskCliArguments(process.argv.slice(2))
  : projectTaskBrowserWorkerCliArguments(
    process.argv.slice(2),
    process.env[projectTaskBrowserWorkerEnvironment],
  );
if (typeof cliArguments === "string") {
  process.stderr.write(`velar project task: ${cliArguments}\n`);
  process.exitCode = 2;
} else {
  process.argv = [...process.argv.slice(0, 2), ...cliArguments];
  installOfficialLanguageServerExtensions();
  await import("./cli.ts");
}
