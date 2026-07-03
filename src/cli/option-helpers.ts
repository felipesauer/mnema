/**
 * Commander option coercer for a flag that may be passed more than once,
 * accumulating each value into an array. Use as the third argument to
 * `.option()` with an initial `[]`:
 *
 * ```ts
 * .option('--topic <topic>', 'Topic (repeatable)', collectRepeatable, [])
 * ```
 *
 * so `--topic a --topic b` yields `['a', 'b']`.
 *
 * @param value - The value parsed for this occurrence
 * @param previous - Values accumulated from earlier occurrences
 * @returns `previous` with `value` appended
 */
export function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value];
}
