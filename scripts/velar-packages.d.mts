/** A workspace `package.json`, as far as the toolchain gates read it. */
export interface VelarPackageManifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly type?: string;
  readonly license?: string;
  readonly main?: string;
  readonly types?: string;
  readonly bin?: string | Record<string, string>;
  readonly exports?: unknown;
  readonly files?: readonly string[];
  readonly scripts?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly velar?: {
    readonly entry?: string;
    readonly extension?: unknown;
    readonly targets?: readonly ("core" | "node" | "web" | "desktop")[];
    readonly requires?: { readonly capabilities?: readonly string[] };
    readonly resources?: Readonly<Record<string, {
      readonly path: string;
      readonly type: "json";
    }>>;
  };
}

/** One workspace package as its own `package.json` declares it. */
export interface VelarWorkspacePackage {
  readonly name: string;
  readonly version: string;
  readonly directory: string;
  readonly private: boolean;
  readonly manifest: VelarPackageManifest;
}

/** Every toolchain implementation package under `packages`, in name order. */
export function velarToolchainPackages(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every VelarScript source library under `libraries`, in name order. */
export function velarLibraries(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every independently versioned ecosystem adapter under `adapters`. */
export function velarAdapters(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every independently versioned host integration under `integrations`. */
export function velarIntegrations(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every publishable toolchain package, in name order. */
export function velarPublishedToolchainPackages(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every publishable source library, in name order. */
export function velarPublishedLibraries(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every publishable external adapter, in name order. */
export function velarPublishedAdapters(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every publishable host integration, in name order. */
export function velarPublishedIntegrations(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every publishable package outside the version-locked toolchain. */
export function velarPublishedEcosystemPackages(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every publishable package across all workspace ownership layers. */
export function velarPublishedWorkspacePackages(root?: string): Promise<VelarWorkspacePackage[]>;

/** The toolchain release names. */
export function velarToolchainPackageNames(root?: string): Promise<string[]>;

/** Every local package name needed by complete workspace consumer gates. */
export function velarWorkspacePackageNames(root?: string): Promise<string[]>;

/** Publishable toolchain packages that declare a build, dependencies first. */
export function velarToolchainBuildOrder(root?: string): Promise<VelarWorkspacePackage[]>;

/** All compiled workspace packages, dependencies first. */
export function velarWorkspaceBuildOrder(root?: string): Promise<VelarWorkspacePackage[]>;
