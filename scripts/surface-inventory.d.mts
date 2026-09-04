import type { CompilerExtension, ModuleInterface } from "@velarscript/compiler";
import type { VelarProjectConfig } from "../packages/cli/src/config.ts";

/** One name a package's table declares, and the table that declared it. */
export interface SurfaceInventoryEntry {
  /** The vocabulary family: `hard-keyword`, `module-export`, `look-property`, … */
  readonly category: string;
  /** Identity within the category. Module categories key by (module, name). */
  readonly key: string;
  /** How the name is written where a reader would meet it. */
  readonly spelling: string;
  /** The compiler-owned table this was read from, for a failure to name. */
  readonly table: string;
  /** Canonical public contract attached to the name, empty for bare vocabulary. */
  readonly shape: string;
  /**
   * The repository path of that table, which decides the surface. Null when the
   * entry came from a merged per-target view, where no single package owns it.
   */
  readonly owner: string | null;
}

export interface SurfaceInventoryName {
  readonly spelling: string;
  readonly tables: ReadonlySet<string>;
  /** Canonical public contract included in the surface digest. */
  readonly shape: string;
}

export interface SurfaceInventoryResult {
  /** The names each surface owns, after the surfaces beneath it are subtracted. */
  readonly names: ReadonlyMap<string, SurfaceInventoryName>;
  /** The surfaces this one is built on, transitively, in name order. */
  readonly beneath: readonly string[];
  /** How many names the surface publishes in all, before that subtraction. */
  readonly published: number;
}

export interface SurfaceVersionSite {
  readonly file: string;
  readonly constant: string;
  readonly manifest: string | null;
}

export interface SurfaceWorkspacePackage {
  readonly name: string;
  readonly directory: string;
}

export interface TargetVocabularyOptions {
  /** How the target is named in a table string, usually its manifest directory. */
  readonly target?: string;
  readonly webTestSpelling?: (controller: string, member: string) => string;
}

export interface ModuleVocabularyOptions {
  readonly interfaces: ReadonlyMap<string, ModuleInterface>;
  readonly table: (source: string) => string;
  readonly webTestTable?: (controller: string) => string;
  readonly owner: string | null;
  readonly admits?: (source: string) => boolean;
  readonly webTestSpelling?: (controller: string, member: string) => string;
}

export const SURFACE_NAMES: readonly string[];
export const SURFACE_VERSIONS: Readonly<Record<string, string>>;
export const SURFACE_VERSION_SITES: Readonly<Record<string, SurfaceVersionSite>>;

export function surfaceOfPath(path: string): string | null;
export function surfacePartitionFailures(packages: readonly SurfaceWorkspacePackage[]): string[];

export function moduleExportKey(source: string, name: string): string;
export function moduleExportSource(key: string): string;
export function webTestMemberKey(source: string, controller: string, member: string): string;
export function surfaceDigest(names: ReadonlyMap<string, { readonly shape: string }>): string;

export function coreVocabularyEntries(): SurfaceInventoryEntry[];
export function extensionVocabularyEntries(extension: CompilerExtension, owner: string | null): {
  readonly entries: SurfaceInventoryEntry[];
  readonly failures: string[];
};
export function lookVocabularyEntries(): SurfaceInventoryEntry[];
export function moduleVocabularyEntries(options: ModuleVocabularyOptions): SurfaceInventoryEntry[];
export function targetVocabularyEntries(config: VelarProjectConfig, options?: TargetVocabularyOptions): {
  readonly entries: SurfaceInventoryEntry[];
  readonly failures: string[];
};

export function surfaceInventory(): {
  readonly surfaces: ReadonlyMap<string, SurfaceInventoryResult>;
  readonly failures: string[];
};
