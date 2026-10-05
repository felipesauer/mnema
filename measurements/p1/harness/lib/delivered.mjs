// What REACHED the model — read off the first request the real host sends.
//
// THE PARITY THIS BENCH CHECKED WAS THE PARITY OF WHAT IS SEEDED, and that is a different
// thing from what a session is handed. `assertKnowledgeParity` compares the decision as each
// arm's seed WRITES it; it cannot see that the host loads one file and not another, that a
// hook hands over a title where a file hands over the whole paragraph, or that a memory
// index carries a prefix of a sentence. Measured on the real host with no model behind it
// (`runAgainstStandIn`), the first request of a task that carries a decision holds:
//
//   host        the title in full and the first words of the statement  (the MEMORY.md index)
//   mnema-doc,
//   mnema+      the title in full and NOTHING else of the decision      (the opening document)
//   claude-md   the title, the statement, the reasoning, the alternative — all in full
//   base, prosa,
//   mnema       nothing — the agent has to open a file or ask the server
//
// So the arms of this protocol do NOT receive the same text, and they are not meant to: the
// difference in delivery is the mechanism under test. What this file adds is that the
// difference is DECLARED ahead of the run and CHECKED against what arrived, in both
// directions — a part that was declared and did not arrive fails, and so does a part that
// arrived where nobody declared it. The second direction is the one that catches a host
// update that starts loading a file it used to ignore, or a hook that starts handing over
// more than it did, either of which silently moves an arm toward another.
//
// WHAT THIS PROVES AND WHAT IT DOES NOT. It proves what the HOST puts in the request. It does
// not prove the model read it, believed it or obeyed it; the stand-in answers nothing.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addressCovers, canonicalKnowledge, carriesDecision, readDecision, readDecisionSet, touchedPaths } from './fixtures.mjs'
import { runAgainstStandIn } from './host-session.mjs'
import { isSessionTurn } from './fake-api.mjs'
import { DOC_ARM, GATE_ARM, INSTRUCTIONS_ARM, SURFACE_ARM, servesUnasked } from './seed.mjs'

/**
 * The host did not reach the stand-in at all. Systemic and not a finding about an arm: every cell
 * after it would say the same, so the preflight stops asking and reports this once.
 */
export class StandInNotReached extends Error {}

/** The four parts of a decision, in the order a reader meets them. */
export const DECISION_PARTS = ['title', 'statement', 'why', 'alternatives']

/** How much of a part is in the request: all of it, only its first words, or none. */
export const LEVELS = ['full', 'lead', 'none']

/** The first words that count as a "lead": enough to be this sentence and no other. */
const LEAD_CHARS = 40

const all = (level) => Object.fromEntries(DECISION_PARTS.map((part) => [part, level]))

/**
 * What the first request carries of an AXIS-A task's decision, per arm — declared, measured
 * on host 2.1.281 on 2026-10-01, and re-checked by every `--selftest`.
 *
 * On axis B there is no decision, so there is nothing to look for and every arm declares
 * `none`: that side of the check is the seed's, and it is already asserted there.
 */
export const DELIVERED_AT_OPEN = {
  base: all('none'),
  prosa: all('none'),
  host: { title: 'full', statement: 'lead', why: 'none', alternatives: 'none' },
  mnema: all('none'),
  'mnema-doc': { title: 'full', statement: 'none', why: 'none', alternatives: 'none' },
  'mnema+': { title: 'full', statement: 'none', why: 'none', alternatives: 'none' },
  [INSTRUCTIONS_ARM]: all('full'),
  // The eighth arm opens exactly as `mnema+` does: the hold acts at a write, never at the opening.
  [GATE_ARM]: { title: 'full', statement: 'none', why: 'none', alternatives: 'none' },
}

/**
 * What the first request carries of each decision of a task that HOLDS A HISTORY, per arm and per
 * state — the declaration the round of such tasks is read against, and the reason it is two rows
 * and not one: the opening document of the record names the decisions IN FORCE and leaves out the
 * replaced ones (`"Each was accepted, and none of them superseded"`), while the instructions file
 * carries both, in full, and the memory index carries a line for each. That difference is the
 * mechanism the round's primary comparison is about, so it is declared, and checked both ways,
 * before a cell is spent on it.
 */
export const DELIVERED_AT_OPEN_HISTORY = {
  base: { current: all('none'), superseded: all('none') },
  prosa: { current: all('none'), superseded: all('none') },
  host: {
    current: { title: 'full', statement: 'lead', why: 'none', alternatives: 'none' },
    superseded: { title: 'full', statement: 'lead', why: 'none', alternatives: 'none' },
  },
  mnema: { current: all('none'), superseded: all('none') },
  [DOC_ARM]: { current: { title: 'full', statement: 'none', why: 'none', alternatives: 'none' }, superseded: all('none') },
  [SURFACE_ARM]: { current: { title: 'full', statement: 'none', why: 'none', alternatives: 'none' }, superseded: all('none') },
  [GATE_ARM]: { current: { title: 'full', statement: 'none', why: 'none', alternatives: 'none' }, superseded: all('none') },
  [INSTRUCTIONS_ARM]: { current: all('full'), superseded: all('full') },
}

/**
 * What the session is handed AT ITS FIRST WRITE to the file the ticket names, of each decision in
 * force addressed there — in the arms that carry the product's surface, the only ones in which a
 * write is an occasion to hand anything over. Measured with a scripted write against the stand-in.
 *
 *   mnema-doc   nothing: the per-edit push is the switch this arm turned off
 *   mnema+      the title, beside the result of the write (the push)
 *   mnema-gate  the title, as the reason the write did NOT happen (the hold) — and the same write
 *               repeated goes through
 *
 * A decision that is replaced, or addressed somewhere else, is declared `none` in every arm.
 */
export const DELIVERED_AT_FIRST_WRITE = {
  [DOC_ARM]: all('none'),
  [SURFACE_ARM]: { title: 'full', statement: 'none', why: 'none', alternatives: 'none' },
  [GATE_ARM]: { title: 'full', statement: 'none', why: 'none', alternatives: 'none' },
}

/** The arm whose first write to a governed file is refused once, and whose second goes through. */
export function holdsFirstWrite(arm) {
  return arm === GATE_ARM
}

/** The keys of a request that describe its shape and are not text a model reads. */
const SHAPE_KEYS = new Set(['type', 'role', 'cache_control'])

/** Every string a model would read anywhere in a JSON value, in document order. */
function leaves(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) leaves(item, out)
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) if (!SHAPE_KEYS.has(key)) leaves(item, out)
  }
  return out
}

/** Whitespace-insensitive, which is all the packaging the host changes about a paragraph. */
const squash = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * The first request of the session's own turn — the one that carries the ticket.
 *
 * Found by what it carries and not by its position: the host sends housekeeping calls first,
 * and the request this bench cares about is the one that offers tools and holds the ticket.
 */
export function firstSessionRequest(requests, ticket) {
  const probe = squash(ticket).slice(0, 60)
  return (
    requests.find(
      (r) =>
        String(r.url).includes('/v1/messages') &&
        isSessionTurn(r.body) &&
        squash(leaves(r.body.messages).join(' ')).includes(probe),
    ) ?? null
  )
}

/** All the text of a request the model would read: the system prompt and every message. */
export function requestText(request) {
  return squash(leaves({ system: request.body.system, messages: request.body.messages }).join('\n'))
}

/**
 * How much of each part of `decision` is in `text`.
 *
 * `full` is the whole part, whitespace aside. `lead` is its first words and not the whole —
 * the shape of an index line, which carries a prefix of the statement and ends in an ellipsis.
 */
export function deliveredParts(text, decision) {
  const found = {}
  for (const part of DECISION_PARTS) {
    const wanted = canonicalKnowledge(decision[part])
    found[part] = text.includes(wanted)
      ? 'full'
      : text.includes(wanted.slice(0, LEAD_CHARS))
        ? 'lead'
        : 'none'
  }
  return found
}

/** The declaration for one (arm, axis) — all `none` where the axis carries no decision. */
export function declaredAtOpen(arm, axis) {
  const declared = DELIVERED_AT_OPEN[arm]
  if (!declared) throw new Error(`no delivery is declared for the arm ${arm}`)
  return carriesDecision(axis) ? declared : all('none')
}

/**
 * Every difference between what an arm declares and what reached the request, as sentences.
 * Empty means the declaration holds in both directions.
 */
export function deliveredProblems({ arm, axis, delivered }) {
  const declared = declaredAtOpen(arm, axis)
  const problems = []
  for (const part of DECISION_PARTS) {
    if (delivered[part] === declared[part]) continue
    // LEVELS runs from the most to the least, so a lower index is more text.
    const more = LEVELS.indexOf(delivered[part]) < LEVELS.indexOf(declared[part])
    problems.push(
      `the ${part} reaches the first request as "${delivered[part]}" and the ${arm} arm declares ` +
        `"${declared[part]}" — ${more ? 'more arrived than was declared' : 'less arrived than was declared'}`,
    )
  }
  return problems
}

/** Every difference between what a history's arm declares at the opening and what arrived. */
export function historyDeliveredProblems({ arm, set, delivered }) {
  const declared = DELIVERED_AT_OPEN_HISTORY[arm]
  if (!declared) throw new Error(`no delivery is declared for the arm ${arm}`)
  const problems = []
  for (const entry of set) {
    const want = declared[entry.current ? 'current' : 'superseded']
    for (const part of DECISION_PARTS) {
      const got = delivered[entry.key]?.[part] ?? 'none'
      if (got === want[part]) continue
      const more = LEVELS.indexOf(got) < LEVELS.indexOf(want[part])
      problems.push(
        `the ${part} of ${entry.key} (${entry.current ? 'in force' : 'replaced'}) reaches the first request as ` +
          `"${got}" and the ${arm} arm declares "${want[part]}" — ` +
          `${more ? 'more arrived than was declared' : 'less arrived than was declared'}`,
      )
    }
  }
  return problems
}

/**
 * Seed nothing, run the real host once against the stand-in and report what arrived.
 *
 * The sandbox is the caller's and is already seeded and asserted: this is the step after
 * `assertSeed`, which says what was planted, and it says what was delivered.
 */
export async function deliveredAtOpen({ sandbox, arm, fixture, mnemaBin, pluginDir, claudeBin }) {
  const session = await runAgainstStandIn({ sandbox, arm, fixture, mnemaBin, pluginDir, claudeBin })
  const first = firstOf(session)
  if (fixture.shape === 'set') {
    const set = readDecisionSet(fixture)
    const text = requestText(first)
    return {
      text,
      parts: Object.fromEntries(set.map((entry) => [entry.key, deliveredParts(text, entry)])),
      problems: historyDeliveredProblems({
        arm,
        set,
        delivered: Object.fromEntries(set.map((entry) => [entry.key, deliveredParts(text, entry)])),
      }),
    }
  }
  const decision = readDecision(fixture)
  const parts = decision ? deliveredParts(requestText(first), decision) : all('none')
  return {
    text: requestText(first),
    parts,
    problems: deliveredProblems({ arm, axis: fixture.axis, delivered: parts }),
  }
}

/** The session's first request that carries the ticket, or a throw that says why there is none. */
function firstOf(session) {
  if (session.error) throw new Error(`the host could not run: ${session.error.message}`)
  if (!session.requests.some((r) => String(r.url).includes('/v1/messages'))) {
    throw new StandInNotReached(
      `the host sent nothing to the stand-in (exit ${session.status}): ` +
        `${(session.stderr || session.stdout).trim().slice(0, 300)}`,
    )
  }
  const first = firstSessionRequest(session.requests, session.ticket)
  if (!first) {
    throw new Error(
      `the host sent no request that carries the ticket (exit ${session.status}): ` +
        `${(session.stderr || session.stdout).trim().slice(0, 300)}`,
    )
  }
  return first
}

/** What the scripted write puts in the file — a marker no task's code contains. */
export const SCRIPTED_WRITE = '# written by the stand-in session of the preflight\n'

/**
 * The text a session is handed AT ITS FIRST WRITE to the file the ticket names, and what the host
 * did with the write — for a task that holds a history, in an arm that carries the surface.
 *
 * The stand-in answers the session's first turn with a `Write` of that file and its second turn
 * with THE SAME `Write`, then stops. The request after the first write is the one that carries
 * what the write met: the result of the write, and whatever a hook handed over beside it or
 * instead of it. Only the messages that request ADDS are read — the opening is the other check's.
 *
 * Returns the parts of each decision found there, whether the first write came back refused, and
 * whether the file holds the scripted bytes at the end (the repeated write went through).
 */
export async function deliveredAtFirstWrite({ sandbox, arm, fixture, mnemaBin, pluginDir, claudeBin }) {
  const target = touchedPaths(fixture)[0]
  const write = { name: 'Write', input: { file_path: join(sandbox.repo, target), content: SCRIPTED_WRITE } }
  const session = await runAgainstStandIn({ sandbox, arm, fixture, mnemaBin, pluginDir, claudeBin, script: [write, write] })
  firstOf(session)
  const turns = session.requests.filter((r) => String(r.url).includes('/v1/messages') && isSessionTurn(r.body))
  if (turns.length < 2) throw new Error(`the host sent ${turns.length} session turn(s); the scripted write never came back`)
  const added = turns[1].body.messages.slice(turns[0].body.messages.length)
  const text = squash(leaves(added).join('\n'))
  const results = added.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c?.type === 'tool_result')
  const set = readDecisionSet(fixture)
  const file = join(sandbox.repo, target)
  return {
    text,
    parts: Object.fromEntries(set.map((entry) => [entry.key, deliveredParts(text, entry)])),
    refused: results.some((c) => c.is_error === true),
    written: existsSync(file) && readFileSync(file, 'utf8') === SCRIPTED_WRITE,
  }
}

/**
 * Every difference between what an arm declares AT THE FIRST WRITE and what the write met, as
 * sentences — the parts of each decision, and the fate of the write itself.
 */
export function firstWriteProblems({ arm, fixture, seen }) {
  if (!servesUnasked(arm)) return []
  const set = readDecisionSet(fixture)
  const target = touchedPaths(fixture)[0]
  const covering = set.filter((entry) => entry.current && addressCovers(entry.governs, target))
  const problems = []
  for (const entry of set) {
    const want = covering.includes(entry) ? DELIVERED_AT_FIRST_WRITE[arm] : all('none')
    for (const part of DECISION_PARTS) {
      const got = seen.parts[entry.key]?.[part] ?? 'none'
      if (got === want[part]) continue
      problems.push(`at the first write of ${target}, the ${part} of ${entry.key} arrived as "${got}" and the ${arm} arm declares "${want[part]}"`)
    }
  }
  const held = holdsFirstWrite(arm) && covering.length > 0
  if (seen.refused !== held) {
    problems.push(
      held
        ? `the first write of ${target} went through, and this arm holds the first write to a governed file`
        : `the first write of ${target} came back refused, and nothing in this arm refuses it`,
    )
  }
  if (!seen.written) problems.push(`the repeated write of ${target} did not go through: the file does not hold what was written`)
  return problems
}
