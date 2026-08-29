import { chmod, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

/**
 * D111 rule 3: Web, Server and Desktop are optional peers of the CLI, so the
 * language server bundles the ones this project resolves and leaves out the
 * ones it does not have. A resolvable target is inlined exactly as before; an
 * absent one stays a bare runtime import, which fails where
 * `installOfficialLanguageServerExtensions` catches it and skips the target.
 *
 * Resolvability is asked of esbuild's own resolver rather than answered from a
 * second copy of Node's algorithm, so the verdict is the one the bundle would
 * actually get. The marker keeps the re-entrant `build.resolve` from asking us
 * again about the same specifier.
 */
const optionalOfficialTargets: Plugin = {
  name: "velar-optional-official-targets",
  setup(build) {
    const resolving = Symbol("velar-optional-official-target");
    // esbuild filters are Go regular expressions, so this one carries no `u`
    // flag and escapes nothing: both would reach the bundler as syntax it
    // rejects.
    build.onResolve({ filter: new RegExp("^@velarscript/(?:web|server|desktop)(?:/|$)") }, async (argument) => {
      if (argument.pluginData === resolving) return null;
      const resolved = await build.resolve(argument.path, {
        kind: argument.kind,
        importer: argument.importer,
        resolveDir: argument.resolveDir,
        namespace: argument.namespace,
        pluginData: resolving,
      });
      return resolved.errors.length > 0 ? { path: argument.path, external: true } : resolved;
    });
  },
};

export async function buildLanguageServerTool(outputFile: string): Promise<void> {
  outputFile = resolve(outputFile);
  const sourceExtension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  await mkdir(dirname(outputFile), { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL(`./language-server-bundle-entry.${sourceExtension}`, import.meta.url))],
    outfile: outputFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    minify: true,
    treeShaking: true,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    plugins: [optionalOfficialTargets],
  });
  await chmod(outputFile, 0o644);
}
