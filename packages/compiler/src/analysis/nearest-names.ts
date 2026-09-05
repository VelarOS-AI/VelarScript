/**
 * "Did you mean …": the bounded edit distance behind every unresolved-name
 * suggestion, and the roster that answers it in constant time.
 *
 * D114 R1d: split out of `./scopes.ts` during the move, which came to 827 lines
 * as one file — over the 800-line budget of D115 §一.1. What lives here is
 * string distance and a bucketed index of the names in scope; what stays there
 * is the scope stack those names live in.
 */

/** The furthest a suggestion may be from what was written. */
export const nearestNameLimit = 2;

/**
 * Edit distance, abandoned as soon as it is known to exceed `nearestNameLimit`.
 * Only cells within that many steps of the diagonal can hold a value inside the
 * limit, so each row is a fixed-width band rather than the whole right operand,
 * and a row whose every cell is already over the limit ends the walk.
 */
export function boundedEditDistance(left: string, right: string): number {
  const over = nearestNameLimit + 1;
  if (Math.abs(left.length - right.length) > nearestNameLimit) return over;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  let current = new Array<number>(right.length + 1).fill(over);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const from = Math.max(1, leftIndex - nearestNameLimit);
    const to = Math.min(right.length, leftIndex + nearestNameLimit);
    current[from - 1] = from === 1 ? leftIndex : over;
    let rowBest = current[from - 1]!;
    for (let rightIndex = from; rightIndex <= to; rightIndex += 1) {
      const cell = Math.min(
        previous[rightIndex]! + 1,
        current[rightIndex - 1]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      current[rightIndex] = cell;
      if (cell < rowBest) rowBest = cell;
    }
    if (to < right.length) current[to + 1] = over;
    if (rowBest > nearestNameLimit) return over;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[right.length]!;
}

/** Returns the sole nearest spelling within two edits, never an ambiguous guess. */
export function uniqueNearestName(requested: string, candidates: Iterable<string>): string | null {
  // A Set argument is already deduplicated; copying it again cost one full
  // rebuild per unresolved name for nothing.
  const unique = candidates instanceof Set ? (candidates as ReadonlySet<string>) : new Set(candidates);
  let best: string | null = null;
  let bestDistance = nearestNameLimit + 1;
  let tied = false;
  for (const candidate of unique) {
    if (candidate === requested || Math.abs(candidate.length - requested.length) > nearestNameLimit) continue;
    const candidateDistance = boundedEditDistance(requested, candidate);
    if (candidateDistance < bestDistance) {
      best = candidate;
      bestDistance = candidateDistance;
      tied = false;
    } else if (candidateDistance === bestDistance) {
      tied = true;
    }
  }
  return bestDistance <= nearestNameLimit && !tied ? best : null;
}

/** `name` with up to `nearestNameLimit` characters deleted, the shared key of any two near spellings. */
export function deletionKeys(name: string): readonly string[] {
  const keys = [name];
  for (let first = 0; first < name.length; first += 1) {
    const once = name.slice(0, first) + name.slice(first + 1);
    keys.push(once);
    for (let second = first; second < once.length; second += 1) {
      keys.push(once.slice(0, second) + once.slice(second + 1));
    }
  }
  return keys;
}

/**
 * The roster a "did you mean" reads. It used to be rebuilt — core vocabulary,
 * extension globals, imports, and every name in every live scope — and then run
 * through a full edit-distance pass, once per unresolved name, which made a
 * module of typos quadratic in its own size. The roster is now maintained as
 * scopes come and go, and each name is filed under the strings left by deleting
 * up to two of its characters: two spellings within two edits always share one
 * of those, so a query reads a few buckets instead of the whole roster.
 */
export class NearestNameRoster {
  private readonly counts = new Map<string, number>();
  /** Filled on the first question asked of the roster; a module with no typo never pays for it. */
  private buckets: Map<string, Set<string>> | null = null;

  add(name: string): void {
    const seen = this.counts.get(name) ?? 0;
    this.counts.set(name, seen + 1);
    if (seen === 0) this.file(name);
  }

  remove(name: string): void {
    const seen = this.counts.get(name) ?? 0;
    if (seen === 0) return;
    if (seen > 1) {
      this.counts.set(name, seen - 1);
      return;
    }
    this.counts.delete(name);
    if (!this.buckets) return;
    for (const key of deletionKeys(name)) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      bucket.delete(name);
      if (bucket.size === 0) this.buckets.delete(key);
    }
  }

  nearest(requested: string): string | null {
    if (!this.buckets) {
      this.buckets = new Map();
      for (const name of this.counts.keys()) this.file(name);
    }
    const candidates = new Set<string>();
    for (const key of deletionKeys(requested)) {
      for (const candidate of this.buckets.get(key) ?? []) candidates.add(candidate);
    }
    return uniqueNearestName(requested, candidates);
  }

  private file(name: string): void {
    if (!this.buckets) return;
    for (const key of deletionKeys(name)) {
      const bucket = this.buckets.get(key);
      if (bucket) bucket.add(name);
      else this.buckets.set(key, new Set([name]));
    }
  }
}
