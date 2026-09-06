import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertPortableArtifactPath, portableArtifactPathKey } from "./portable-artifact-path.ts";

export interface GeneratedOutputClaim {
  readonly path: string;
  readonly kind: "file" | "tree";
  readonly owner: string;
}

interface NormalizedGeneratedOutputClaim {
  readonly claim: GeneratedOutputClaim;
  readonly display: string;
  readonly index: number;
  readonly key: string;
  readonly segments: readonly string[];
}

/** Refuses a non-portable or overlapping generated namespace before its first write. */
export function assertGeneratedOutputClaims(root: string, claims: readonly GeneratedOutputClaim[]): void {
  const outputRoot = resolve(root);
  const normalized: NormalizedGeneratedOutputClaim[] = [];
  for (const [index, claim] of claims.entries()) {
    const path = resolve(claim.path);
    const fromRoot = relative(outputRoot, path);
    if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`${claim.owner} escapes the generated output directory`);
    }
    const display = fromRoot.replaceAll("\\", "/");
    assertPortableArtifactPath(display, claim.owner);
    const key = portableArtifactPathKey(display);
    normalized.push({ claim, display, index, key, segments: key.split("/") });
  }
  normalized.sort(compareNormalizedClaims);
  for (let index = 1; index < normalized.length; index += 1) {
    const left = normalized[index - 1]!;
    const right = normalized[index]!;
    if (left.key !== right.key && !right.key.startsWith(`${left.key}/`)) continue;
    const existing = left.index < right.index ? left : right;
    const conflicting = existing === left ? right : left;
    throw new Error(`${conflicting.claim.owner} conflicts with ${existing.claim.owner} at generated path '${conflicting.display}'`);
  }
}

function compareNormalizedClaims(left: NormalizedGeneratedOutputClaim, right: NormalizedGeneratedOutputClaim): number {
  const common = Math.min(left.segments.length, right.segments.length);
  for (let index = 0; index < common; index += 1) {
    const leftSegment = left.segments[index]!;
    const rightSegment = right.segments[index]!;
    if (leftSegment !== rightSegment) return leftSegment < rightSegment ? -1 : 1;
  }
  return left.segments.length - right.segments.length || left.index - right.index;
}
