import { npmPackageNameFromSpecifier } from "./package-name.ts";

/** Reads the package names that npm will install for ordinary runtime imports. */
export function packageRuntimeDependencyNames(
  dependencies: unknown,
  label: string,
): ReadonlySet<string> {
  if (dependencies === undefined) return new Set();
  if (dependencies === null || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new Error(`${label} must be an object of npm package names and version ranges`);
  }
  const names = new Set<string>();
  for (const [name, range] of Object.entries(dependencies)) {
    const parsed = npmPackageNameFromSpecifier(name, `${label} key '${name}'`);
    if (parsed !== name || typeof range !== "string" || range.trim() === "") {
      throw new Error(`${label} must map exact npm package names to non-empty version ranges`);
    }
    names.add(name);
  }
  return names;
}

/** Ensures every retained bare edge has an npm owner after a clean install. */
export function assertDeclaredRuntimeDependency(
  specifier: string,
  dependencies: ReadonlySet<string>,
  packageName: string,
): void {
  const name = npmPackageNameFromSpecifier(specifier, `Runtime import '${specifier}'`);
  if (!dependencies.has(name)) {
    throw new Error(
      `Package '${packageName}' retains runtime import '${specifier}', but package.json#dependencies does not declare '${name}'`,
    );
  }
}
