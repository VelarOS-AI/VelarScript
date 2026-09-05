import type { VelarProjectConfig } from "./config.ts";
import type { VelarPackageTarget } from "./source-package-manifest.ts";

/** The package compatibility target shared by every config-backed compiler entry. */
export function projectPackageTarget(config: VelarProjectConfig): VelarPackageTarget {
  const capabilities = new Set(config.compilerExtensions.flatMap((extension) => extension.capabilities ?? []));
  if (capabilities.has("desktop")) return "desktop";
  if (capabilities.has("web")) return "web";
  if (capabilities.has("node")) return "node";
  if (config.framework?.host.target === "browser") return "web";
  return config.kind === "library" ? "core" : "node";
}
