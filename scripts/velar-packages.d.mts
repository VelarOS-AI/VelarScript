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
  readonly velar?: { readonly entry?: string; readonly extension?: unknown };
}

/** One workspace package as its own `package.json` declares it. */
export interface VelarWorkspacePackage {
  readonly name: string;
  readonly version: string;
  readonly directory: string;
  readonly private: boolean;
  readonly manifest: VelarPackageManifest;
}

/** Every workspace package under `packages`, in name order. */
export function velarPackages(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every publishable workspace package, in name order. */
export function velarPublishedPackages(root?: string): Promise<VelarWorkspacePackage[]>;

/** The publishable package names a complete offline install needs. */
export function velarPackageNames(root?: string): Promise<string[]>;

/** The publishable packages that declare a build, dependencies first. */
export function velarBuildOrder(root?: string): Promise<VelarWorkspacePackage[]>;
