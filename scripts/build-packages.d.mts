import type { GeneratedRuntimeSources } from "./generate-runtime-sources.mjs";

/** Whether `CI` names a machine's build rather than a person's. */
export function isContinuousIntegration(environment?: Readonly<Record<string, string | undefined>>): boolean;

export interface SynchronizeRuntimeSourcesOptions {
  /** Refuse a stale transcription instead of rewriting it. Defaults to `isContinuousIntegration()`. */
  readonly ci?: boolean;
}

/**
 * Reconciles each package's committed `runtime-sources.generated.ts` with what
 * its `runtime/**` generates: rewritten locally, refused on CI. Returns one
 * notice line per file rewritten.
 */
export function synchronizeRuntimeSources(
  generated: ReadonlyMap<string, GeneratedRuntimeSources>,
  options?: SynchronizeRuntimeSourcesOptions,
): Promise<string[]>;
