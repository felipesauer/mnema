// The fixtures, read from disk — and the one place that decides what a decision
// is made of.
//
// The harness never edits a fixture. It reads `ticket.txt`, `decision.md` and
// `verify.<ext>`, and everything downstream (the four arms that hold it as text) is derived
// from those bytes. That is what makes the parity check in `canonicalKnowledge`
// meaningful: if the three arms are built from one source, "does every arm carry
// the same knowledge?" is a question the harness can answer without a model.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** How each discriminant is executed, keyed by the extension of `verify.<ext>`. */
const RUNNERS = { php: 'php', py: 'python3', js: 'node', rb: 'ruby' }

/** The two axes, decided by the first letter of the fixture id. */
const AXES = { a: 'A', b: 'B' }

/**
 * Whether a cell of this axis carries a decision at all — the ONE reading of what the
 * two axes mean.
 *
 * IT EXISTS BECAUSE THE RULE HAD FIVE READINGS AND A SIXTH PLACE THAT NEEDED IT AND DID
 * NOT HAVE IT. `axis A carries a decision the code does not reveal; axis B carries none`
 * was written in the fixture check below, in `expectedSeedState` as a local
 * `carriesDecision`, in `editPushProblems`, in `injectionProblems`, and in the preflight's
 * MCP probe — and NOT AT ALL in `surfaceProblem`, which therefore read the correct axis-B
 * outcome of the per-edit channel as an undelivered arm. That cost the round of
 * 2026-08-20 all eight axis-B cells of the only arm it existed to measure, and with them
 * the contamination detector for that arm
 * (`measurements/p1/results/2026-08-20-full/report.md`). Five readings drift; five
 * readings and a hole are worse, because the hole is silent.
 *
 * IT LIVES HERE AND NOT IN `seed.mjs`, where it was first written, for two reasons: this
 * file is where the axis is DECIDED (`AXES` above), and `seed.mjs` imports from here, so a
 * predicate there would have made this file's own check import back — a cycle around the
 * definition of the thing.
 *
 * IT IS THE AXIS AND NEVER THE TASK. A list of axis-B task ids would be correct until the
 * next axis-B task is frozen and then wrong without saying so; the axis is in the fixture
 * and in every result line, which is where the reading rule already finds it.
 *
 * AND IT THROWS ON ANYTHING ELSE rather than falling through to "no decision". A third
 * axis read as a negative control nobody declared is the failure this refuses. MEASURED,
 * because it is not where it was expected to matter: `seedArm` reads this through
 * `expectedSeedState` before the agent is spawned, and `assertSeed` reads it again after,
 * so a cell whose axis is neither is refused at the SEED and never spends a cent. `8e` of
 * `tests/the-fifth-arm.test.mjs` asserts that order — the line comes back
 * `seeding: unknown axis: C` with `cost_usd` null — and the structural test beside it
 * asserts that these two lines are the only place in the bench that compares an axis to a
 * letter. Mutation `z4` is what makes the second one red.
 */
export function carriesDecision(axis) {
  if (axis === 'A') return true
  if (axis === 'B') return false
  throw new Error(`unknown axis: ${axis}`)
}

/**
 * Every fixture under `fixturesDir`, in id order.
 *
 * Axis A fixtures carry a decision the code does not reveal; axis B fixtures
 * carry none and exist so every arm has something it must TIE on. A
 * fixture whose id starts with neither letter is refused here rather than
 * silently scored on the wrong axis.
 */
export function listFixtures(fixturesDir) {
  return readdirSync(fixturesDir)
    .filter((name) => statSync(join(fixturesDir, name)).isDirectory())
    .sort()
    .map((id) => {
      const dir = join(fixturesDir, id)
      const axis = AXES[id[0]]
      if (!axis) throw new Error(`fixture ${id}: id must start with "a" (axis A) or "b" (axis B)`)

      const verifyName = readdirSync(dir).find((n) => n.startsWith('verify.'))
      if (!verifyName) throw new Error(`fixture ${id}: no verify.* file`)
      const ext = verifyName.slice('verify.'.length)
      const runner = RUNNERS[ext]
      if (!runner) throw new Error(`fixture ${id}: no runner for verify.${ext}`)

      const ticketPath = join(dir, 'ticket.txt')
      if (!existsSync(ticketPath)) throw new Error(`fixture ${id}: no ticket.txt`)

      // TWO SHAPES OF TASK. The first rounds hold ONE decision in `decision.md` and score it with
      // three words. A task that holds a HISTORY — decisions in an order, one replacing another,
      // dozens of them, each addressed at the path it governs — keeps it in `decisions/`, with
      // `decisions/index.json` saying the order, the replacements and the addresses, and is scored
      // with four words, because "followed the decision that was replaced" is a finding of its own
      // and not a kind of violation. The shape is read off the disk and never declared twice.
      const decisionPath = join(dir, 'decision.md')
      const decisionsDir = join(dir, DECISIONS_DIR)
      const isSet = existsSync(decisionsDir)
      if (isSet && existsSync(decisionPath)) {
        throw new Error(`fixture ${id}: holds both decision.md and ${DECISIONS_DIR}/ — one shape or the other`)
      }
      const hasDecision = isSet || existsSync(decisionPath)
      if (carriesDecision(axis) && !hasDecision) {
        throw new Error(`fixture ${id}: axis ${axis} needs a decision.md`)
      }
      if (!carriesDecision(axis) && hasDecision) {
        throw new Error(`fixture ${id}: axis ${axis} is the negative control and must have no decision.md`)
      }

      let quality = null
      if (isSet) {
        const qualityName = readdirSync(dir).find((n) => n.startsWith('quality.'))
        if (!qualityName) throw new Error(`fixture ${id}: a task with ${DECISIONS_DIR}/ needs a quality.* file`)
        const qext = qualityName.slice('quality.'.length)
        if (RUNNERS[qext] !== runner) {
          throw new Error(`fixture ${id}: quality.${qext} and verify.${ext} must run on the same runtime`)
        }
        quality = join(dir, qualityName)
      }

      return {
        id,
        dir,
        axis,
        runner,
        verify: join(dir, verifyName),
        repo: join(dir, 'repo'),
        ticketPath,
        decisionPath: hasDecision && !isSet ? decisionPath : null,
        decisionsDir: isSet ? decisionsDir : null,
        shape: isSet ? 'set' : 'single',
        verdicts: isSet ? 'four' : 'three',
        quality,
        hasDecision,
      }
    })
}

/** Where a task that holds a history keeps it. */
export const DECISIONS_DIR = 'decisions'

/** The file in it that says the order, the replacements and the addresses. */
export const DECISIONS_INDEX = 'index.json'

/** How many leading characters of a statement have to tell it apart from every other one. */
export const DISTINCT_LEAD = 40

/**
 * The decisions a task holds, in the order they were made — ONE reading for both shapes.
 *
 * Each entry: `{ key, title, statement, why, alternatives, raw, governs, supersedes,
 * supersededBy, current }`. A `decision.md` task is a set of one, current, with no address of
 * its own (`governs: null`; the arms that address it use their single root address). A
 * `decisions/` task is read from `decisions/index.json`:
 *
 *   { "decisions": [ { "file": "01-….md", "governs": "<path>", "supersedes": "<earlier file>" }, … ],
 *     "touches": ["<path the ticket writes>", …] }
 *
 * and refused, not repaired, when the history it states cannot be one: a replacement of a
 * decision that comes later or does not exist, a decision replaced twice, two titles one of which
 * contains the other (the delivered-text check finds a title by inclusion, so it could not tell
 * which of the two arrived), or two statements that open with the same words (same reason, for
 * the lead of a memory index line).
 */
export function readDecisionSet(fixture) {
  if (!fixture.hasDecision) return []
  if (fixture.shape !== 'set') {
    return [{ key: 'decision', ...readDecision(fixture), governs: null, supersedes: null, supersededBy: null, current: true }]
  }
  const where = `${fixture.id}/${DECISIONS_DIR}/${DECISIONS_INDEX}`
  const index = readIndex(fixture)
  if (!Array.isArray(index.decisions) || index.decisions.length === 0) {
    throw new Error(`${where}: "decisions" names no decision`)
  }
  const entries = []
  const keys = new Set()
  for (const declared of index.decisions) {
    const { file, governs, supersedes = null } = declared ?? {}
    if (typeof file !== 'string' || !file.endsWith('.md')) throw new Error(`${where}: an entry has no .md "file"`)
    if (keys.has(file)) throw new Error(`${where}: ${file} is listed twice`)
    if (typeof governs !== 'string' || governs === '') throw new Error(`${where}: ${file} has no "governs" address`)
    if (supersedes !== null && !keys.has(supersedes)) {
      throw new Error(`${where}: ${file} supersedes ${supersedes}, which is not an EARLIER decision of this task`)
    }
    const text = readFileSync(join(fixture.decisionsDir, file), 'utf8')
    entries.push({ key: file, ...parseDecision(text, `${fixture.id}/${DECISIONS_DIR}/${file}`), governs, supersedes })
    keys.add(file)
  }
  for (const entry of entries) {
    const by = entries.filter((other) => other.supersedes === entry.key)
    if (by.length > 1) throw new Error(`${where}: ${entry.key} is superseded twice`)
    entry.supersededBy = by[0]?.key ?? null
    entry.current = entry.supersededBy === null
  }
  for (const a of entries) {
    for (const b of entries) {
      if (a === b) continue
      if (b.title.includes(a.title)) {
        throw new Error(`${where}: the title of ${a.key} is inside the title of ${b.key}, so no reading can tell which arrived`)
      }
      if (canonicalKnowledge(a.statement).slice(0, DISTINCT_LEAD) === canonicalKnowledge(b.statement).slice(0, DISTINCT_LEAD)) {
        throw new Error(`${where}: ${a.key} and ${b.key} open their statements with the same ${DISTINCT_LEAD} characters`)
      }
    }
  }
  return entries
}

/** The paths the ticket writes, from a `decisions/` task's index — `[]` for the first shape. */
export function touchedPaths(fixture) {
  if (fixture.shape !== 'set') return []
  const touches = readIndex(fixture).touches
  if (!Array.isArray(touches) || touches.length === 0 || touches.some((p) => typeof p !== 'string' || p === '')) {
    throw new Error(`${fixture.id}/${DECISIONS_DIR}/${DECISIONS_INDEX}: "touches" names no path`)
  }
  return touches
}

function readIndex(fixture) {
  const path = join(fixture.decisionsDir, DECISIONS_INDEX)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`${fixture.id}/${DECISIONS_DIR}/${DECISIONS_INDEX}: ${err.message}`)
  }
}

/**
 * Whether an address covers a path, the way the product reads an address: the path itself, or a
 * directory above it, or the root. Used to say which rules the per-edit channel must cite at a
 * path — the product's own reading is what the cell checks (`mnema rules`), and this is the
 * expectation it is checked against.
 */
export function addressCovers(address, path) {
  if (address === '.' || address === path) return true
  return path.startsWith(`${address.replace(/\/+$/, '')}/`)
}

export function readTicket(fixture) {
  return readFileSync(fixture.ticketPath, 'utf8')
}

/**
 * Split a `decision.md` into the fields the arms need.
 *
 * The shape is fixed and the parse is strict: an H1 title, a statement, a
 * paragraph opened by `**Why.**`, and one opened by `**Alternative we turned
 * down.**`. A file that does not match is an error, not a partial parse — the
 * `mnema` arm would otherwise be seeded with a decision missing its reasoning
 * while `prosa` got the whole file, and the arms would differ in two variables
 * instead of one.
 */
const WHY_LABEL = '**Why.**'
const ALT_LABEL = '**Alternative we turned down.**'

export function parseDecision(text, id = 'decision.md') {
  const lines = text.split('\n')
  const titleMatch = /^#\s+(.+?)\s*$/.exec(lines[0] ?? '')
  if (!titleMatch) throw new Error(`${id}: first line must be "# <title>"`)

  const whyIdx = lines.findIndex((l) => l.startsWith(WHY_LABEL))
  const altIdx = lines.findIndex((l) => l.startsWith(ALT_LABEL))
  if (whyIdx < 0) throw new Error(`${id}: no paragraph opened by "${WHY_LABEL}"`)
  if (altIdx < 0) throw new Error(`${id}: no paragraph opened by "${ALT_LABEL}"`)
  if (altIdx < whyIdx) throw new Error(`${id}: "${ALT_LABEL}" comes before "${WHY_LABEL}"`)

  const title = titleMatch[1]
  const statement = lines.slice(1, whyIdx).join('\n').trim()
  const why = lines.slice(whyIdx, altIdx).join('\n').slice(WHY_LABEL.length).trim()
  const alternatives = lines.slice(altIdx).join('\n').slice(ALT_LABEL.length).trim()

  for (const [name, value] of [
    ['statement', statement],
    ['why', why],
    ['alternatives', alternatives],
  ]) {
    if (!value) throw new Error(`${id}: ${name} is empty`)
  }

  return { title, statement, why, alternatives, raw: text }
}

export function readDecision(fixture) {
  if (!fixture.hasDecision) return null
  if (fixture.shape === 'set') {
    throw new Error(`${fixture.id} holds a history in ${DECISIONS_DIR}/, not one decision: read it with readDecisionSet`)
  }
  return parseDecision(readFileSync(fixture.decisionPath, 'utf8'), `${fixture.id}/decision.md`)
}

/**
 * The knowledge a piece of text carries, with its packaging removed.
 *
 * Three arms hold the same decision in three shapes: a markdown file, a host
 * memory with frontmatter, and three fields of a mnema record. Comparing them
 * byte for byte is impossible; comparing them after removing exactly the
 * packaging — frontmatter, the H1 marker, the two bold labels, and whitespace —
 * is exact. Anything else that differs is knowledge one arm has and another does
 * not, and the run would be measuring two variables.
 */
export function canonicalKnowledge(text) {
  return text
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .trimStart()
    .replace(/^#\s+/, '')
    .split(WHY_LABEL)
    .join(' ')
    .split(ALT_LABEL)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
