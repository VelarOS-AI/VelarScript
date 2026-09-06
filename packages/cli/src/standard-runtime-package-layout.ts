import { join } from "node:path";
import { assertVelarPackageSubpath } from "./package-entry.ts";
import { npmPackageNameFromSpecifier } from "./package-name.ts";
import { assertPortableArtifactPath, portableArtifactPathKey } from "./portable-artifact-path.ts";
import { byCodeUnit } from "./stable-order.ts";

export interface StandardRuntimeModuleOutput {
  readonly source: string;
  readonly exportName: "." | `./${string}`;
  readonly file: string;
}

export interface StandardRuntimePackageOutput {
  readonly name: string;
  readonly modules: readonly StandardRuntimeModuleOutput[];
}

/** Maps compiler-owned bare specifiers to portable npm package files. */
export function standardRuntimePackageLayout(sources: Iterable<string>): readonly StandardRuntimePackageOutput[] {
  const packages = new Map<string, StandardRuntimeModuleOutput[]>();
  for (const source of [...sources].sort(byCodeUnit)) {
    const name = source.startsWith("velar/")
      ? "velar"
      : npmPackageNameFromSpecifier(source, `Standard runtime module '${source}'`);
    assertPortableArtifactPath(name, `Standard runtime package '${name}'`);
    const suffix = source === name ? null : source.slice(name.length + 1);
    if (name !== "velar" && source !== name && !source.startsWith(`${name}/`)) {
      throw new Error(`Standard runtime module '${source}' is outside package '${name}'`);
    }
    const exportName = suffix === null ? "." : `./${suffix}` as const;
    if (exportName !== ".") assertVelarPackageSubpath(exportName, `Standard runtime module '${source}'`);
    // Root exports use a file name no `${subpath}.js` mapping can produce, so
    // a legal package that declares both `example` and `example/index` never
    // discovers a build-only path collision.
    const file = suffix === null ? ".velar-runtime-root.mjs" : `${suffix}.js`;
    assertPortableArtifactPath(file, `Standard runtime module '${source}' output`);
    const modules = packages.get(name) ?? [];
    if (modules.some((module) => module.exportName === exportName
      || portableArtifactPathKey(module.file) === portableArtifactPathKey(file))) {
      throw new Error(`Standard runtime package '${name}' has a portable output collision at module '${source}'`);
    }
    modules.push({source, exportName, file});
    packages.set(name, modules);
  }
  return [...packages]
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([name, modules]) => ({name, modules}));
}

export function standardRuntimePackageRoot(nodeModulesRoot: string, packageName: string): string {
  return join(nodeModulesRoot, ...packageName.split("/"));
}
