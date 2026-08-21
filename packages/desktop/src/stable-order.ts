/**
 * UTF-16 code-unit order — what `<` and `>` compare, and what
 * `Array.prototype.sort` gives with no comparator. It differs from true code
 * point order only for astral characters, and it is deliberately this order
 * rather than that one, so a producer agrees with any consumer that reorders
 * the same names with a bare `.sort()`.
 *
 * D90 R3(a) rules the locale dependence out at the root: `localeCompare`
 * follows the collation the process environment selects, so any list ordered
 * with it reorders when the machine's `LC_ALL` changes. Desktop walks a build
 * tree in this order to hash it, so the build receipt a packaged application
 * carries is the same on two machines that differ only in `LC_ALL`.
 */
export function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
