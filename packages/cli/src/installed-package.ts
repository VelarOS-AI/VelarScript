import { access, realpath } from "node:fs/promises";
import { join } from "node:path";

/**
 * Finds an installed package without resolving one of its runtime exports.
 *
 * `require.resolve(specifier)` is intentionally not used here: it selects the
 * CommonJS `require` condition and therefore cannot discover a valid ESM-only
 * package whose exports expose only `types` and `import` targets.
 */
export async function resolveInstalledPackageRoot(
  name: string,
  specifier: string,
  require: NodeJS.Require,
): Promise<string> {
  for (const directory of require.resolve.paths(specifier) ?? []) {
    const root = join(directory, name);
    try {
      await access(join(root, "package.json"));
      return await realpath(root);
    } catch {
      // Keep walking the node_modules chain.
    }
  }
  throw new Error(`package '${name}' is not installed in node_modules`);
}
