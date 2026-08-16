/** One workspace package as its own `package.json` declares it. */
export interface VelarWorkspacePackage {
  readonly name: string;
  readonly version: string;
  readonly directory: string;
  readonly private: boolean;
}

/** Every workspace package under `packages`, in name order. */
export function velarPackages(root?: string): Promise<VelarWorkspacePackage[]>;

/** The publishable package names a complete offline install needs. */
export function velarPackageNames(root?: string): Promise<string[]>;
