/**
 * The index of the last item `matches` accepts, or -1 — `Array.prototype.findLastIndex`, which the
 * compiler's ES2022 library does not declare, though every Node this runs on has it.
 */
export function lastIndexWhere<T>(items: readonly T[], matches: (item: T) => boolean): number {
  for (let at = items.length - 1; at >= 0; at -= 1) {
    if (matches(items[at] as T)) return at;
  }
  return -1;
}
