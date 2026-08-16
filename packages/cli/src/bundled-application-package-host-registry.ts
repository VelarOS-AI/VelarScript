import type { ApplicationPackageHost } from "@velarscript/compiler/application-package-host";

const hosts = new Map<string, ApplicationPackageHost>();

/**
 * Official self-contained tools cannot resolve an application target through
 * the caller's node_modules. They register the package host they actually
 * bundled, while the normal CLI continues to resolve third-party targets from
 * the project's extension graph.
 */
export function registerBundledApplicationPackageHost(host: ApplicationPackageHost): void {
  if (hosts.has(host.id)) throw new Error(`Bundled application package host '${host.id}' is already registered`);
  hosts.set(host.id, host);
}

export function bundledApplicationPackageHost(name: string): ApplicationPackageHost | null {
  return hosts.get(name) ?? null;
}
