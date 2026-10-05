// Reading a capture back — the ONE place that says what a line of `cells.jsonl` counts as.
//
// `threshold.mjs` read the lines one way, the round-2 probe another, and an analysis a
// third would have been the third reading of one rule: a cell is SCORABLE when its status is
// `ok` and its verdict is `CONFORMS` or `VIOLATES`; a rate is `CONFORMS` over the scorable
// cells and a pair with none has NO rate; an `ok` cell whose verdict is anything else
// (`BROKEN`) leaves both the numerator and the denominator and is counted apart. Every reader
// in this directory goes through `tally`, and `tests/cells.test.mjs` fails if one of them
// stops.
//
// THE LINE'S SCHEMA MOVES AND OLD LINES ARE NOT REWRITTEN. A capture is a record of what ran,
// and a result is not redone to gain a column. So the reader accepts both forms: the keys
// `round`, `scenario` and `arm_code` are absent from every line before schema 9 and are
// read back as `null`, which says "this line is from before" — a missing key and a null key
// are different things in a line, and the reader is where the difference is made harmless.

import { readFileSync } from 'node:fs'

/**
 * The verdicts that count as a result. Anything else on an `ok` cell is `BROKEN`. A task that holds
 * a history speaks four words: `CONFORMS_CURRENT` is its conformance, and `FOLLOWS_OBSOLETE` is a
 * scorable failure beside `VIOLATES` — an agent that followed the replaced decision chose
 * something, which a cell whose code does not run did not.
 */
export const SCORABLE_VERDICTS = ['CONFORMS', 'VIOLATES', 'CONFORMS_CURRENT', 'FOLLOWS_OBSOLETE']

/** The verdicts that count as conforming — one per vocabulary. */
export const CONFORMING_VERDICTS = ['CONFORMS', 'CONFORMS_CURRENT']

/** One line, with the keys a later schema added filled in as `null` when it predates them. */
export function normalizeCell(cell) {
  return {
    ...cell,
    round: cell.round ?? null,
    scenario: cell.scenario ?? null,
    arm_code: cell.arm_code ?? null,
    quality_passed: cell.quality_passed ?? null,
    quality_total: cell.quality_total ?? null,
  }
}

/**
 * Every line of a capture, normalized. A line that is not JSON ends the read: a capture one
 * line of which cannot be read is a capture whose totals are not known, and guessing around
 * it would publish a number about the lines that happened to parse.
 */
export function readCells(path) {
  const cells = []
  const lines = readFileSync(path, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue
    try {
      cells.push(normalizeCell(JSON.parse(lines[i])))
    } catch {
      throw new Error(`${path}:${i + 1}: not JSON — the capture cannot be read whole`)
    }
  }
  return cells
}

/**
 * Count the cells per (arm, task): `{ conforms, scorable, broken, ok }`.
 *
 * Only `status: ok` cells enter — a harness error or a broken ruler is not an agent choosing
 * anything and is not a result. `broken` is the `ok` cells that did not score; `ok` is all of
 * them, which is the denominator of the BROKEN share.
 */
export function tally(cells) {
  const counts = new Map()
  for (const cell of cells) {
    if (cell.status !== 'ok') continue
    const key = `${cell.arm}\u0000${cell.fixture}`
    const at = counts.get(key) ?? { conforms: 0, scorable: 0, broken: 0, ok: 0 }
    at.ok += 1
    if (SCORABLE_VERDICTS.includes(cell.verdict)) {
      at.scorable += 1
      if (CONFORMING_VERDICTS.includes(cell.verdict)) at.conforms += 1
    } else {
      at.broken += 1
    }
    counts.set(key, at)
  }
  const get = (arm, task) => counts.get(`${arm}\u0000${task}`) ?? { conforms: 0, scorable: 0, broken: 0, ok: 0 }
  return {
    get,
    arms: [...new Set([...counts.keys()].map((k) => k.split('\u0000')[0]))].sort(),
    /** CONFORMS over scorable, or `null` when the pair has no scorable cell. */
    rate: (arm, task) => {
      const at = get(arm, task)
      return at.scorable > 0 ? at.conforms / at.scorable : null
    },
  }
}
