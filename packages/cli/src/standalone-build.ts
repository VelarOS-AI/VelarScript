import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import type { CompileResult } from "@velarscript/compiler";
import { build, type Plugin } from "esbuild";

export interface StandaloneJavaScriptOutput {
  readonly code: string;
  readonly sourceMap: string;
}

/** True when Node would otherwise have to search outside the emitted tree. */
export function needsStandaloneJavaScriptBundle(result: CompileResult): boolean {
  return result.dependencies.some((dependency) => dependency.javascript
    && !dependency.source.startsWith(".")
    && !dependency.source.startsWith("/")
    && !dependency.source.startsWith("data:")
    && !dependency.source.startsWith("velar/")
    && !isBuiltin(dependency.source));
}

/**
 * A single-file `--out` is a deployable program, not a pointer back into the
 * source project's node_modules. Bundle only its host-package edges; Node
 * builtins and the generated `velar/*` runtime remain owned by the host and by
 * writeNodeStandardModules respectively.
 */
export async function bundleStandaloneJavaScript(
  outputPath: string,
  result: CompileResult,
): Promise<StandaloneJavaScriptOutput> {
  const embeddedByPath = new Map(result.embeddedModules.map((module) => [
    resolve(dirname(result.source.path), module.specifier),
    module,
  ]));
  const embeddedPlugin: Plugin = {
    name: "velar-standalone-embedded-javascript",
    setup(context) {
      context.onResolve({ filter: /^\.\.?\// }, (arguments_) => {
        const path = resolve(arguments_.resolveDir, arguments_.path);
        return embeddedByPath.has(path) ? { path, namespace: "velar-embedded" } : null;
      });
      context.onLoad({ filter: /.*/, namespace: "velar-embedded" }, (arguments_) => {
        const embedded = embeddedByPath.get(resolve(arguments_.path));
        if (!embedded) return { errors: [{ text: `Embedded JavaScript module '${arguments_.path}' was not compiled` }] };
        const sourceMap = embedded.sourceMap
          ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(embedded.sourceMap).toString("base64")}\n`
          : "";
        return {
          contents: `${embedded.code}${sourceMap}`,
          loader: "js",
          resolveDir: dirname(result.source.path),
        };
      });
    },
  };
  const sourceMap = result.sourceMap
    ? `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(result.sourceMap).toString("base64")}\n`
    : "";
  const bundled = await build({
    absWorkingDir: dirname(result.source.path),
    bundle: true,
    external: ["velar/*"],
    format: "esm",
    logLevel: "silent",
    outfile: outputPath,
    packages: "bundle",
    platform: "node",
    plugins: [embeddedPlugin],
    sourcemap: "external",
    sourcesContent: true,
    stdin: {
      contents: `${result.code ?? ""}${sourceMap}`,
      loader: "js",
      resolveDir: dirname(result.source.path),
      sourcefile: result.source.path,
    },
    target: "node24",
    write: false,
  });
  const output = bundled.outputFiles?.find((file) => resolve(file.path) === resolve(outputPath));
  const map = bundled.outputFiles?.find((file) => resolve(file.path) === resolve(`${outputPath}.map`));
  if (!output || !map) throw new Error("The standalone JavaScript bundler did not emit the program and its source map");
  return { code: output.text, sourceMap: map.text };
}
