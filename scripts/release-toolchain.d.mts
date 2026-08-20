export interface ReleaseSourceIdentity {
  readonly tag?: string | null;
  readonly tags?: readonly string[];
}

export function sourceHasExpectedTag(source: ReleaseSourceIdentity | null | undefined, expectedTag: string): boolean;
