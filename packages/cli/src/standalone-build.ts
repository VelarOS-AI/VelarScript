import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import type { CompileResult } from "@velarscript/compiler";
import { build, type Plugin } from "esbuild";
import {
  artifactSnapshotContents,
  type LoadedVelarLibraryArtifact,
  type VelarLibraryArtifactJavaScriptSnapshot,
} from "./library-artifact.ts";
import { projectImportKey, type ProjectResource } from "./project.ts";
import type { JavaScriptBuildMode } from "./javascript-output.ts";

export interface StandaloneJavaScriptOutput {
  readonly code: string;
  readonly sourceMap: string;
}

/** True when Node would otherwise have to search outside the emitted tree. */
export function needsStandaloneJavaScriptBundle(
  result: CompileResult,
  artifactImports: ReadonlyMap<string, LoadedVelarLibraryArtifact> = new Map(),
): boolean {
  return artifactImports.size > 0 || result.dependencies.some((dependency) => dependency.resource !== undefined
    || dependency.javascript
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
  resources: readonly ProjectResource[] = [],
  mode: JavaScriptBuildMode = "production",
  sourceMaps = false,
  artifactImports: ReadonlyMap<string, LoadedVelarLibraryArtifact> = new Map(),
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
        const sourceMap = sourceMaps && embedded.sourceMap
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
  const resourcesByPath = new Map(resources.map((resource) => [resolve(resource.inputPath), resource]));
  const resourcePlugin: Plugin = {
    name: "velar-standalone-resources",
    setup(context) {
      context.onResolve({ filter: /\.json\.js$/ }, (arguments_) => {
        const path = resolve(arguments_.resolveDir, arguments_.path.slice(0, -3));
        return resourcesByPath.has(path) ? { path, namespace: "velar-resource" } : null;
      });
      context.onLoad({ filter: /.*/, namespace: "velar-resource" }, (arguments_) => {
        const resource = resourcesByPath.get(resolve(arguments_.path));
        return resource ? { contents: resource.content, loader: "json" } : null;
      });
    },
  };
  const sourceMap = sourceMaps && result.sourceMap
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
    minify: mode === "production",
    keepNames: mode === "readable",
    plugins: [standaloneArtifactPlugin(result, artifactImports, sourceMaps), embeddedPlugin, resourcePlugin],
    sourcemap: sourceMaps ? "external" : false,
    sourcesContent: sourceMaps,
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
  if (!output || sourceMaps && !map) {
    throw new Error(`The standalone JavaScript bundler did not emit the program${sourceMaps ? " and its source map" : ""}`);
  }
  return { code: output.text, sourceMap: map?.text ?? "" };
}

interface StandaloneArtifactSnapshot {
  readonly receipt: string;
  readonly snapshot: VelarLibraryArtifactJavaScriptSnapshot;
}

const STANDALONE_ARTIFACT_NAMESPACE = "velar-standalone-artifact";

function standaloneArtifactPlugin(
  result: CompileResult,
  artifactImports: ReadonlyMap<string, LoadedVelarLibraryArtifact>,
  sourceMaps: boolean,
): Plugin {
  const snapshots = standaloneArtifactSnapshots(artifactImports);
  return {
    name: "velar-standalone-frozen-artifact",
    setup(context) {
      context.onResolve({ filter: /^\.\.?(?:\/|$)/, namespace: STANDALONE_ARTIFACT_NAMESPACE }, (arguments_) => {
        const importer = snapshots.get(arguments_.importer);
        if (!importer) return { errors: [{ text: `Frozen artifact importer '${arguments_.importer}' has no verified snapshot` }] };
        const path = resolve(dirname(importer.snapshot.path), arguments_.path);
        const target = snapshots.get(path);
        return target && target.receipt === importer.receipt
          ? { path, namespace: STANDALONE_ARTIFACT_NAMESPACE }
          : { errors: [{ text: `Frozen artifact relative import '${arguments_.path}' is not covered by its verified receipt` }] };
      });
      context.onResolve({ filter: /^[^./]/, namespace: STANDALONE_ARTIFACT_NAMESPACE }, (arguments_) => {
        if (arguments_.path.startsWith("velar/") || isBuiltin(arguments_.path)) {
          return { path: arguments_.path, external: true };
        }
        return { errors: [{
          text: `Frozen artifact imports external npm dependency '${arguments_.path}'; single-file builds require dependency-free frozen artifacts`,
        }] };
      });
      context.onResolve({ filter: /.*/, namespace: STANDALONE_ARTIFACT_NAMESPACE }, (arguments_) => ({
        errors: [{ text: `Frozen artifact import '${arguments_.path}' is not a receipt-covered relative module, Node builtin, or external Velar runtime module` }],
      }));
      context.onLoad({ filter: /.*/, namespace: STANDALONE_ARTIFACT_NAMESPACE }, (arguments_) => {
        const item = snapshots.get(arguments_.path);
        return item
          ? {
              contents: artifactSnapshotContents(item.snapshot, sourceMaps),
              loader: "js",
              resolveDir: dirname(item.snapshot.path),
            }
          : { errors: [{ text: `Frozen artifact module '${arguments_.path}' has no verified snapshot` }] };
      });
      context.onResolve({ filter: /^[^./]/ }, (arguments_) => {
        if (arguments_.namespace === STANDALONE_ARTIFACT_NAMESPACE) return null;
        const importer = arguments_.importer === "" || arguments_.importer === "<stdin>"
          || arguments_.namespace === "velar-embedded"
          || resolve(arguments_.importer) === resolve(result.source.path)
          ? result.source.path
          : null;
        if (!importer) return null;
        const artifact = artifactImports.get(projectImportKey(importer, arguments_.path));
        return artifact
          ? { path: artifact.entrySnapshot.path, namespace: STANDALONE_ARTIFACT_NAMESPACE }
          : null;
      });
    },
  };
}

function standaloneArtifactSnapshots(
  artifacts: ReadonlyMap<string, LoadedVelarLibraryArtifact>,
): ReadonlyMap<string, StandaloneArtifactSnapshot> {
  const snapshots = new Map<string, StandaloneArtifactSnapshot>();
  for (const artifact of artifacts.values()) {
    const receipt = `${resolve(artifact.receiptPath)}\0${artifact.target}`;
    for (const snapshot of [...artifact.entrySnapshots, ...artifact.chunkSnapshots]) {
      const existing = snapshots.get(snapshot.path);
      if (existing && (existing.receipt !== receipt || !sameSnapshot(existing.snapshot, snapshot))) {
        throw new Error(`Frozen artifact snapshot path '${snapshot.path}' is claimed by different verified receipts`);
      }
      if (!existing) snapshots.set(snapshot.path, { receipt, snapshot });
    }
  }
  return snapshots;
}

function sameSnapshot(
  left: VelarLibraryArtifactJavaScriptSnapshot,
  right: VelarLibraryArtifactJavaScriptSnapshot,
): boolean {
  return left.path === right.path
    && left.code === right.code
    && left.sourceMapPath === right.sourceMapPath
    && left.sourceMap === right.sourceMap;
}
