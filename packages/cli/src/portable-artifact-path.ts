const WINDOWS_FORBIDDEN_SEGMENT_CHARACTERS = /[<>:"|?*\u0000-\u001f]/u;
const WINDOWS_RESERVED_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

/**
 * Rejects path segments that cannot name the same ordinary file on supported
 * package and application output filesystems.
 */
export function assertPortableArtifactPath(path: string, label: string): void {
  for (const segment of path.replaceAll("\\", "/").split("/")) {
    if (segment === "") continue;
    if (WINDOWS_FORBIDDEN_SEGMENT_CHARACTERS.test(segment)) {
      throw new Error(`${label} contains Windows-reserved characters in path segment '${segment}'`);
    }
    if (/[ .]$/u.test(segment)) {
      throw new Error(`${label} contains path segment '${segment}' with a trailing dot or space`);
    }
    const basename = segment.split(".", 1)[0]!;
    if (WINDOWS_RESERVED_BASENAME.test(basename)) {
      throw new Error(`${label} contains Windows-reserved path segment '${segment}'`);
    }
  }
}

/** Canonical collision key for paths emitted into portable package trees. */
export function portableArtifactPathKey(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => segment.normalize("NFC").replace(/[ .]+$/u, "").toLowerCase())
    .join("/");
}
