export interface VelarPackageManifest {
  readonly name: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly main?: string;
  readonly types?: string;
  readonly exports?: unknown;
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly velar?: {
    readonly entry?: string;
    readonly resources?: Readonly<Record<string, {
      readonly path: string;
      readonly type: string;
    }>>;
  };
  readonly [key: string]: unknown;
}

export interface VelarWorkspacePackage {
  readonly name: string;
  readonly version?: string;
  readonly directory: string;
  readonly private: boolean;
  readonly manifest: VelarPackageManifest;
}

/** Every toolchain workspace entry under packages/, in name order. */
export function velarToolchainPackages(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every publishable package in the toolchain release generation. */
export function velarPublishedToolchainPackages(root?: string): Promise<VelarWorkspacePackage[]>;

/** Every publishable package in the complete official workspace. */
export function velarPublishedWorkspacePackages(root?: string): Promise<VelarWorkspacePackage[]>;

/** Package names in a complete toolchain candidate. */
export function velarToolchainPackageNames(root?: string): Promise<string[]>;

/** Package names in a complete official workspace install. */
export function velarWorkspacePackageNames(root?: string): Promise<string[]>;

/** Compiled toolchain packages in dependency-first order. */
export function velarToolchainBuildOrder(root?: string): Promise<VelarWorkspacePackage[]>;

/** Compiled workspace packages in dependency-first order. */
export function velarWorkspaceBuildOrder(root?: string): Promise<VelarWorkspacePackage[]>;
