export interface NpmPackReceipt {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly files: Array<{
    readonly path: string;
    readonly [key: string]: unknown;
  }>;
  readonly [key: string]: unknown;
}

/** Accepts the single-receipt JSON envelopes emitted by npm 11 and npm 12. */
export function parseNpmPackResult(stdout: string, label?: string): NpmPackReceipt;
