/** The normalized npm package-name grammar accepted by package-owned paths. */
export const NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;

/** Extracts and validates the package identity from one bare package specifier. */
export function npmPackageNameFromSpecifier(specifier: string, label: string): string {
  if (specifier === "" || /[\\\u0000-\u001f\u007f]/u.test(specifier)) {
    throw new Error(`${label} contains an invalid npm package name`);
  }
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? "";
  if (!NPM_PACKAGE_NAME.test(name)) throw new Error(`${label} contains invalid npm package name '${name}'`);
  return name;
}

/** Whether one bare specifier resolves through the current package's exports map. */
export function isNpmPackageSelfSpecifier(specifier: string, packageName: string): boolean {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}
