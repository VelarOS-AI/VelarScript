export interface ReleaseOutputClaim {
  readonly token: string;
  readonly outputDirectory: string;
  readonly stagingDirectory: string;
  readonly backupDirectory: string;
  readonly transactionMarkerPath: string;
  readonly transactionAnchorPath: string;
  release(): Promise<void>;
}

export interface ReleaseOutputClaimOptions {
  readonly token?: string;
}

export interface ReleaseOutputTransactionOperations {
  renamePath?: (source: string, destination: string) => Promise<void>;
  removePath?: (path: string, options: { recursive: true; force: true }) => Promise<void>;
  afterFirstRename?: () => Promise<void>;
  afterSecondRename?: () => Promise<void>;
}

export interface ReleaseOutputRecoveryOperations {
  renamePath?: (source: string, destination: string) => Promise<void>;
  removePath?: (path: string, options: { recursive: true; force: true }) => Promise<void>;
  afterTransactionClaim?: () => Promise<void>;
}

export function acquireReleaseOutputClaim(
  outputDirectory: string,
  options?: ReleaseOutputClaimOptions,
): Promise<ReleaseOutputClaim>;

export function replaceReleaseDirectory(
  claim: ReleaseOutputClaim,
  validateReplaceable: (path: string) => Promise<void>,
  operations?: ReleaseOutputTransactionOperations,
): Promise<void>;

export function recoverReleaseOutputTransactions(
  claim: ReleaseOutputClaim,
  validateReplaceable: (path: string) => Promise<void>,
  operations?: ReleaseOutputRecoveryOperations,
): Promise<void>;
