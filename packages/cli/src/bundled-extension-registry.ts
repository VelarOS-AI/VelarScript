import type { CompilerExtension } from "@velarscript/compiler";
import type { FrameworkHostExtension } from "@velarscript/compiler/framework-host";

export interface BundledProjectExtension {
  readonly id: string;
  readonly manifestKey: string;
  readonly parse: (value: unknown, manifestPath: string) => unknown;
}

export interface BundledExtensionDefinition {
  readonly name: string;
  readonly version: string;
  readonly kind: "application" | "capability" | "language";
  readonly apiVersion: string;
  readonly manifestKey: string | null;
  readonly extends: Readonly<Record<string, string>>;
  readonly composes: Readonly<Record<string, string>>;
  readonly compiler: CompilerExtension;
  readonly project: BundledProjectExtension | null;
  readonly host: FrameworkHostExtension | null;
}

const definitions = new Map<string, BundledExtensionDefinition>();

export function registerBundledExtension(definition: BundledExtensionDefinition): void {
  if (definitions.has(definition.name)) throw new Error(`Bundled extension '${definition.name}' is already registered`);
  definitions.set(definition.name, Object.freeze(definition));
}

export function bundledExtension(name: string): BundledExtensionDefinition | null {
  return definitions.get(name) ?? null;
}
