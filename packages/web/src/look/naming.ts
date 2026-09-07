/** How a Look name is spelled in CSS, and which published name a misspelling meant. */
export function cssPropertyName(name: string): string {
  return name.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

function nameDistance(left: string, right: string): number {
  if (left.length === right.length) {
    const mismatches: number[] = [];
    for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) mismatches.push(index);
    if (mismatches.length === 2 && mismatches[1] === mismatches[0]! + 1
      && left[mismatches[0]!] === right[mismatches[1]!] && left[mismatches[1]!] === right[mismatches[0]!]) return 1;
  }
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]!;
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const candidate = Math.min(
        previous[column]! + 1,
        previous[column - 1]! + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = previous[column]!;
      previous[column] = candidate;
    }
  }
  return previous[right.length]!;
}

/**
 * The closest vocabulary entry to a misspelling, or null when nothing is close
 * enough to name. Case differences and one or two edits count as near misses;
 * anything further apart is a different word and gets the full vocabulary.
 */
export function nearestLookName(name: string, vocabulary: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const limit = 2;
  for (const candidate of vocabulary) {
    const distance = nameDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== null && bestDistance <= limit ? best : null;
}
