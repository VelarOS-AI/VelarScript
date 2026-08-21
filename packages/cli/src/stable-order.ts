/**
 * UTF-16 code-unit order — what `<` and `>` compare, and what
 * `Array.prototype.sort` gives with no comparator. It differs from true code
 * point order only for astral characters, and it is deliberately this order
 * rather than that one: the production verifier checks the manifest inventory
 * with a bare `.sort()`, so a producer ordering by code point would disagree
 * with its own verifier on any name outside the BMP.
 *
 * D90 R3(a) rules the locale dependence out at the root: `localeCompare`
 * follows the collation the process environment selects, so any list ordered
 * with it reorders when the machine's `LC_ALL` changes. That decided module
 * order — and with it the project stylesheet's bytes, its content hash,
 * `buildId`, and which of two equal-specificity rules won — and it decides
 * every other list this toolchain promises to produce the same way twice.
 */
export function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
