/**
 * The verb of a projection insert, in the one place that says when it may replace.
 *
 * A rebuild writes into tables it has just emptied, so every row is a fresh insert and a
 * clash is the signal that the table was not emptied — the stores' tests hold that failure
 * ("is a plain insert, so a second materialize of an id is a hard error"). An advance writes
 * over a table that has rows, where the clash is the point. The two differ by this word and
 * by nothing else.
 */
export function verb(replacing: boolean): string {
  return replacing ? 'INSERT OR REPLACE' : 'INSERT';
}
