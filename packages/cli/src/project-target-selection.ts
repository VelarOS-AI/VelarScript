import type { CompilerExtension } from "@velarscript/compiler";
import type { ResolvedFrameworkHost } from "./config.ts";
import type { JavaScriptPackageTarget } from "./package-imports.ts";
import type { VelarPackageTarget } from "./source-package-manifest.ts";

export interface ProjectTargetSelection {
  readonly capabilities: ReadonlySet<string>;
  readonly packageCapabilities: ReadonlySet<string>;
  readonly packageTarget: VelarPackageTarget;
  readonly javascriptPackageTarget: JavaScriptPackageTarget;
}

export function selectProjectTargets(
  explicitTarget: VelarPackageTarget | undefined,
  compilerExtensions: readonly CompilerExtension[],
  framework: ResolvedFrameworkHost | null,
): ProjectTargetSelection {
  const capabilities = new Set(compilerExtensions.flatMap((extension) => extension.capabilities ?? []));
  const packageCapabilities = new Set(capabilities);
  if (explicitTarget !== undefined && explicitTarget !== "core") packageCapabilities.add(explicitTarget);
  else if (explicitTarget === undefined && packageCapabilities.size === 0 && framework === null) packageCapabilities.add("node");
  const packageTarget: VelarPackageTarget = explicitTarget ?? (packageCapabilities.has("desktop")
    ? "desktop"
    : packageCapabilities.has("web")
      ? "web"
      : packageCapabilities.has("node")
        ? "node"
        : "core");
  const javascriptPackageTarget: JavaScriptPackageTarget = packageTarget === "web" || framework?.host.target === "browser"
    ? "browser"
    : "node";
  return { capabilities, packageCapabilities, packageTarget, javascriptPackageTarget };
}
