/**
 * UTF-16 code-unit order — what `<` and `>` compare, and what
 * `Array.prototype.sort` gives with no comparator. It differs from true code
 * point order only for astral characters, and it is deliberately this order
 * rather than that one, so a producer agrees with any consumer that reorders
 * the same names with a bare `.sort()`.
 *
 * D90 R3(a) rules the locale dependence out at the root: `localeCompare`
 * follows the collation the process environment selects, so any list ordered
 * with it reorders when the machine's `LC_ALL` changes. Web orders a Look
 * static value's properties this way, and that order is stringified into the
 * identity two Look values are deduplicated by, so it cannot move with the
 * environment.
 */
export function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
