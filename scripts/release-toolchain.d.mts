export interface ReleaseSourceIdentity {
  readonly tag?: string | null;
  readonly tags?: readonly string[];
}

export function sourceHasExpectedTag(source: ReleaseSourceIdentity | null | undefined, expectedTag: string): boolean;

/** One hand-edited version literal and the published package whose generation it must equal. */
export interface DeclaredVersion {
  readonly file: string;
  readonly name: string;
  readonly package: string;
}

export const DECLARED_VERSIONS: readonly DeclaredVersion[];

export function declaredVersionFailure(
  directory: string,
  file: string,
  name: string,
  manifest: { readonly name: string; readonly version: string },
): Promise<string | null>;

/** One hand-edited version literal and the third-party dependency range of ours it must pin. */
export interface PinnedDependencyVersion {
  readonly file: string;
  readonly name: string;
  readonly package: string;
  readonly dependency: string;
}

export const PINNED_DEPENDENCY_VERSIONS: readonly PinnedDependencyVersion[];

export function pinnedDependencyFailure(
  directory: string,
  file: string,
  name: string,
  dependency: string,
  manifest: { readonly name: string; readonly dependencies?: Readonly<Record<string, string>> },
): Promise<string | null>;
