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

import { canonicalKnowledge, carriesDecision, readDecision } from './fixtures.mjs'
import { runAgainstStandIn } from './host-session.mjs'
import { isSessionTurn } from './fake-api.mjs'
import { INSTRUCTIONS_ARM } from './seed.mjs'

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

/**
 * Seed nothing, run the real host once against the stand-in and report what arrived.
 *
 * The sandbox is the caller's and is already seeded and asserted: this is the step after
 * `assertSeed`, which says what was planted, and it says what was delivered.
 */
export async function deliveredAtOpen({ sandbox, arm, fixture, mnemaBin, pluginDir, claudeBin }) {
  const session = await runAgainstStandIn({ sandbox, arm, fixture, mnemaBin, pluginDir, claudeBin })
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
  const decision = readDecision(fixture)
  return {
    text: requestText(first),
    parts: decision ? deliveredParts(requestText(first), decision) : all('none'),
  }
}
