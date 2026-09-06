import { dirname, isAbsolute, resolve } from "node:path";
import type { OnResolveArgs, OnResolveResult, PluginBuild } from "esbuild";
import type { VelarLibraryArtifactJavaScriptSnapshot } from "./library-artifact.ts";

function resolvedArtifactSnapshot(
  resolution: OnResolveResult,
  verifiedSnapshots: ReadonlyMap<string, VelarLibraryArtifactJavaScriptSnapshot>,
  artifactNamespace?: string,
): VelarLibraryArtifactJavaScriptSnapshot | undefined {
  const path = resolution.path;
  return !resolution.external
    && (resolution.namespace === "file" || resolution.namespace === artifactNamespace)
    && path !== undefined
    && isAbsolute(path)
    ? verifiedSnapshots.get(resolve(path))
    : undefined;
}

function artifactResolution(
  resolution: OnResolveResult,
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
  artifactNamespace: string,
): OnResolveResult {
  const { pluginData: _pluginData, ...forwarded } = resolution;
  return {
    ...forwarded,
    path: snapshot.path,
    namespace: artifactNamespace,
  };
}

/**
 * Keeps a file-owned npm module from reopening an authenticated artifact as an
 * ordinary file. The recursive resolve asks esbuild for the canonical target;
 * the marker prevents this hook from resolving its own question again.
 */
export function registerFrozenArtifactFileReentry(
  context: PluginBuild,
  verifiedSnapshots: ReadonlyMap<string, VelarLibraryArtifactJavaScriptSnapshot>,
  artifactNamespace: string,
): void {
  const resolvingFileImport = Symbol("velar-frozen-artifact-file-reentry");
  context.onResolve({ filter: /.*/, namespace: "file" }, async (arguments_) => {
    if (arguments_.pluginData === resolvingFileImport) return null;
    const resolution = await context.resolve(arguments_.path, {
      importer: arguments_.importer,
      resolveDir: arguments_.resolveDir,
      namespace: arguments_.namespace,
      kind: arguments_.kind,
      pluginData: resolvingFileImport,
      with: arguments_.with,
    });
    if (resolution.errors.length > 0) return resolution;
    const snapshot = resolvedArtifactSnapshot(resolution, verifiedSnapshots);
    if (snapshot) return artifactResolution(resolution, snapshot, artifactNamespace);
    if (resolution.pluginData !== resolvingFileImport) return resolution;
    const { pluginData: _pluginData, ...forwarded } = resolution;
    return forwarded;
  });
}

/**
 * Resolves one authenticated artifact's npm edge from the artifact's physical
 * package owner. This is Node's package-resolution boundary: resolving from the
 * consuming application would flatten nested versions and silently change the
 * dependency the library was checked against.
 */
export async function resolveFrozenArtifactNodeImport(
  context: PluginBuild,
  arguments_: OnResolveArgs,
  importer: VelarLibraryArtifactJavaScriptSnapshot,
  verifiedSnapshots: ReadonlyMap<string, VelarLibraryArtifactJavaScriptSnapshot>,
  artifactNamespace: string,
): Promise<OnResolveResult> {
  const resolved = await context.resolve(arguments_.path, {
    importer: importer.path,
    resolveDir: dirname(importer.path),
    namespace: "file",
    kind: arguments_.kind,
    with: arguments_.with,
  });
  if (resolved.errors.length > 0) return resolved;
  const snapshot = resolvedArtifactSnapshot(resolved, verifiedSnapshots, artifactNamespace);
  if (snapshot) return artifactResolution(resolved, snapshot, artifactNamespace);
  if (resolved.external || resolved.namespace !== "file" || !isAbsolute(resolved.path)) {
    return {
      errors: [{
        text: `Frozen artifact npm dependency '${arguments_.path}' did not resolve to a bundled Node module from '${importer.path}'`,
      }],
      warnings: resolved.warnings,
    };
  }
  return resolved;
}
