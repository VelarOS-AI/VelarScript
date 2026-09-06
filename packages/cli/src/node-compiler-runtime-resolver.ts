import { registerHooks, type ModuleHooks } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LoadedVelarLibraryArtifact } from "./library-artifact.ts";
import {
  artifactSnapshotContents,
  type VelarLibraryArtifactJavaScriptSnapshot,
} from "./library-artifact-snapshot.ts";
import {
  standardRuntimePackageLayout,
  standardRuntimePackageRoot,
} from "./standard-runtime-package-layout.ts";

/** Exact resolver table for compiler-owned modules materialized in a sandbox. */
function compilerRuntimeRoutes(root: string, modules: ReadonlySet<string>): ReadonlyMap<string, string> {
  const nodeModulesRoot = join(root, "node_modules");
  const routes = new Map<string, string>();
  for (const package_ of standardRuntimePackageLayout(modules)) {
    const packageRoot = standardRuntimePackageRoot(nodeModulesRoot, package_.name);
    for (const module of package_.modules) {
      routes.set(module.source, pathToFileURL(join(packageRoot, module.file)).href);
    }
  }
  return routes;
}

/** Exact URL-to-bytes table for receipt-authenticated frozen artifact modules. */
function artifactSnapshotRoutes(
  artifacts: Iterable<LoadedVelarLibraryArtifact>,
): ReadonlyMap<string, string> {
  const routes = new Map<string, string>();
  for (const artifact of artifacts) {
    for (const snapshot of artifact.entrySnapshots) addArtifactSnapshotRoute(routes, snapshot);
    for (const snapshot of artifact.chunkSnapshots) addArtifactSnapshotRoute(routes, snapshot);
  }
  return routes;
}

function addArtifactSnapshotRoute(
  routes: Map<string, string>,
  snapshot: VelarLibraryArtifactJavaScriptSnapshot,
): void {
  const url = pathToFileURL(snapshot.path).href;
  const source = artifactSnapshotContents(snapshot, true);
  const existing = routes.get(url);
  if (existing !== undefined && existing !== source) {
    throw new Error(`Frozen artifact URL '${url}' names different authenticated snapshots`);
  }
  routes.set(url, source);
}

/**
 * Installs an exact, removable resolver for in-process sandbox execution.
 * Original frozen artifact files can therefore resolve compiler-owned bare
 * imports without gaining access to arbitrary sandbox or host packages.
 */
export function registerNodeCompilerRuntimeResolver(
  root: string,
  modules: ReadonlySet<string>,
  artifacts: Iterable<LoadedVelarLibraryArtifact> = [],
): ModuleHooks {
  const routes = compilerRuntimeRoutes(root, modules);
  const artifactSources = artifactSnapshotRoutes(artifacts);
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = routes.get(specifier);
      if (url !== undefined) return { shortCircuit: true, url };
      if (artifactSources.has(specifier)) return { shortCircuit: true, url: specifier };
      if (context.parentURL !== undefined && artifactSources.has(context.parentURL)
        && (specifier.startsWith("./") || specifier.startsWith("../"))) {
        const target = new URL(specifier, context.parentURL).href;
        if (!artifactSources.has(target)) throw new Error(`Frozen artifact relative module '${specifier}' is absent from its authenticated snapshot`);
        return { shortCircuit: true, url: target };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      const source = artifactSources.get(url);
      return source === undefined
        ? nextLoad(url, context)
        : { format: "module", shortCircuit: true, source };
    },
  });
}

/** Writes a preloaded resolver for child processes and worker threads. */
export async function writeNodeCompilerRuntimeResolverBootstrap(
  root: string,
  modules: ReadonlySet<string>,
  artifacts: Iterable<LoadedVelarLibraryArtifact> = [],
): Promise<string> {
  const directory = await mkdtemp(join(root, ".velar-runtime-resolver-"));
  const output = join(directory, "bootstrap.mjs");
  const routes = [...compilerRuntimeRoutes(root, modules)];
  const artifactSources = [...artifactSnapshotRoutes(artifacts)];
  const source = [
    'import { registerHooks } from "node:module";',
    `const routes = new Map(${JSON.stringify(routes)});`,
    `const artifactSources = new Map(${JSON.stringify(artifactSources)});`,
    "registerHooks({",
    "  resolve(specifier, context, nextResolve) {",
    "    const url = routes.get(specifier);",
    "    if (url !== undefined) return { shortCircuit: true, url };",
    "    if (artifactSources.has(specifier)) return { shortCircuit: true, url: specifier };",
    '    if (context.parentURL !== undefined && artifactSources.has(context.parentURL) && (specifier.startsWith("./") || specifier.startsWith("../"))) {',
    "      const target = new URL(specifier, context.parentURL).href;",
    '      if (!artifactSources.has(target)) throw new Error(`Frozen artifact relative module \'${specifier}\' is absent from its authenticated snapshot`);',
    "      return { shortCircuit: true, url: target };",
    "    }",
    "    return nextResolve(specifier, context);",
    "  },",
    "  load(url, context, nextLoad) {",
    "    const source = artifactSources.get(url);",
    '    return source === undefined ? nextLoad(url, context) : { format: "module", shortCircuit: true, source };',
    "  },",
    "});",
    "",
  ].join("\n");
  await writeFile(output, source, { encoding: "utf8", flag: "wx" });
  return output;
}
