export type NodeTestMode = "quick" | "full";

export function nodeTestFiles(directory: string, mode: NodeTestMode): Promise<string[]>;

/** How far a run had got, read back from a `VELAR_TEST_PROGRESS` record. */
export interface NodeTestProgress {
  /** Tests that reported a result before the record ended. */
  readonly completed: number;
  /** Absolute path of the test file the run had reached, or `null`. */
  readonly file: string | null;
}

export function nodeTestProgress(path: string): Promise<NodeTestProgress>;

/** The one line a run killed by a signal prints before exiting 1. */
export function signalTerminationReport(signal: string, progress: NodeTestProgress, from?: string): string;

/** The temporary area this checkout's suite owns, derived from the checkout path. */
export function checkoutTemporaryRoot(checkout?: string): string;
