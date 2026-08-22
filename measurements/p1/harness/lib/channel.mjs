// The per-edit channel — the rules that arrive at the writing, the fact that says they
// did, and the SWITCH POSITION that decides whether they may.
//
// IT SAID "the fifth arm's SECOND channel" UNTIL 2026-08-20, and round 3 falsified the
// singular. Two arms carry this channel now and they differ in nothing else: `mnema+`
// has it on and `mnema-doc` has it off, through the product's own `mnema switch`. So
// every rule in this file that used to ask "is this the surface arm?" asks two questions
// instead — does this arm carry the channel, and is it switched on — and the second one
// has a single reading, {@link editPushSpeaks}.
//
// WHY THIS FILE IS SEPARATE FROM `lib/hook.mjs`. That one holds host wiring: two
// declarations and a shim, all of them things the bench arranges. This one holds the
// only mechanism of the arm whose evidence the bench does not write — `channel.served`
// is appended by the PRODUCT, into the cell's own record, and read back out of it with
// the product's own reader. That difference is the whole reason the file exists: for the
// document channel the bench can only say "the handler produced it", and for this one
// the record itself says "the channel was live in this run".
//
// G5 OF `measurements/p1/round-2/arms.md` IS WHAT THIS ANSWERS, and the tie is worth
// quoting because it was paid for once already: "a mute handler and a handler that never
// fired produce the same cell, and they are opposite conclusions about the product".
// `hook_ran` exists because of it. For the per-edit channel the equivalent is not a log
// this bench keeps but a FACT: one `channel.served` per run and per channel, appended by
// the tool the host calls. So a cell of this arm reads its own record afterwards, and a
// cell whose record holds no service for a channel that was called is not a zero — it is
// an INVALID cell, and it says so in its status rather than in a footnote.
//
// AND THE THREE SILENCES, the same idiom as `mcp_asked` and `hook_ran`:
//   - an arm with no surface is `null` — there was no channel to serve;
//   - a cell with no record to read is `null` WITH THE REASON — the column cannot
//     answer, and `false` there would slander a cell that was never instrumented;
//   - a record that reads and holds no service is an ANSWER: the empty list.
//
// NOTHING HERE SCORES. It qualifies, exactly as the other three mechanism columns do,
// and the verdict stays the fixture's own discriminant.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { declaredServer, mcpConversation } from './mcpcheck.mjs'
import { EDIT_EVENT, pushedTools } from './hook.mjs'
import { exists } from './sandbox.mjs'
import { carriesDecision } from './fixtures.mjs'
import {
  EDIT_PUSH_CHANNEL,
  channelNames,
  channelPositions,
  mnema,
  mnemaRecords,
  servesUnasked,
  switchedOffChannels,
} from './seed.mjs'

/** The event kind the product appends when a channel spoke. Its subject is the channel. */
export const SERVED_KIND = 'channel.served'

export const CHANNEL_NO_SURFACE =
  'this arm serves nothing unasked: there was no channel to serve, and the column is null'
export const CHANNEL_NO_RECORD =
  'the cell left no mnema record to read: the column cannot answer and is null, never empty'

/**
 * How many times each channel served in this cell's record, read with `mnema timeline`.
 *
 * The subject of a `channel.served` is the CHANNEL, so the channel's own timeline is
 * where it lives — the product's reader, not a walk of the chain files. A channel with
 * no service is absent from the list rather than present with a zero: the list is what
 * SPOKE, and a zero would be a third thing to interpret beside `null` and absence.
 */
export function servedChannels(sandbox, mnemaBin, channels) {
  const served = []
  for (const channel of channels) {
    const out = mnema(sandbox, mnemaBin, ['timeline', channel, '--json'])
    if (out.status !== 0) return { served: null, detail: `mnema timeline ${channel} exited ${out.status}` }
    let entries
    try {
      entries = JSON.parse(out.stdout)
    } catch {
      return { served: null, detail: `mnema timeline ${channel} did not answer with JSON` }
    }
    const times = entries.filter((entry) => entry.kind === SERVED_KIND).length
    if (times > 0) served.push(`${channel}:${times}`)
  }
  return { served: served.sort(), detail: null }
}

/**
 * The per-edit channel's columns for the result line — what the record itself says.
 *
 * Read AFTER the agent has run, out of the cell's own record, which is what makes it
 * evidence about the cell that spent money rather than about a preflight sandbox.
 */
export function channelService({ sandbox, arm, mnemaBin }) {
  const silent = { channels: null, served: null, servedAny: null }
  if (!servesUnasked(arm)) return { ...silent, probe: CHANNEL_NO_SURFACE }
  if (!exists(join(sandbox.repo, '.mnema'))) return { ...silent, probe: CHANNEL_NO_RECORD }

  const positions = channelPositions(sandbox, mnemaBin)
  if (positions.channels === null) return { ...silent, probe: positions.probe }

  const names = channelNames(positions)
  // The one guard that keeps this file's literal honest: if the product renamed the
  // per-edit channel, its timeline would simply be empty and every cell of the arm would
  // read as "nothing served" — a wrong finding with a wrong fix behind it. So a name
  // this bench asks about and the product does not print is a broken column, by name.
  if (!names.includes(EDIT_PUSH_CHANNEL)) {
    return {
      ...silent,
      channels: positions.channels,
      probe:
        `this product prints [${names}] and no channel called "${EDIT_PUSH_CHANNEL}": the name this ` +
        'bench asks about is not one of its own any more, so the column cannot answer',
    }
  }

  const { served, detail } = servedChannels(sandbox, mnemaBin, names)
  if (served === null) return { ...silent, channels: positions.channels, probe: detail }
  return {
    channels: positions.channels,
    served,
    servedAny: served.length > 0,
    probe:
      served.length === 0
        ? 'the record read and holds no channel.served: no channel of this product spoke in this ' +
          'cell. That is an ANSWER and not a gap — the push says nothing for a file no rule ' +
          'addresses, and it appends nothing when it says nothing'
        : `the record holds one channel.served per run and per channel: [${served}]. It says the ` +
          'channel was LIVE in this cell, never that the model read what arrived or obeyed it',
  }
}

/**
 * Does the per-edit channel SPEAK in a cell of this arm, on this axis? One reading,
 * three call sites.
 *
 * A3, and it is the rule this delivery adds. It has two terms and each one is a whole
 * conclusion about the product if it is read wrong:
 *
 *   - the AXIS. On axis B nothing is recorded and no rule addresses the file, so the
 *     channel correctly says nothing and correctly appends nothing. Reading that as a
 *     broken cell cost the round of 2026-08-20 all eight axis-B cells of the only arm
 *     it existed to measure;
 *   - the SWITCH. `mnema-doc` holds the same record, the same address and the same two
 *     hook declarations as `mnema+`, and has this channel switched OFF. Reading its
 *     silence as a broken cell would throw away every cell of the arm round 3 exists
 *     to measure; reading a cell where it SPOKE anyway as fine would let a switch that
 *     does not silence anything pass as an arm.
 *
 * Both directions are asserted by both callers, which is what keeps this from being a
 * loosening: `editPushProblems` requires the reply to be empty and the record to stay
 * empty wherever this is false, and `surfaceProblem` calls a cell invalid when the
 * channel spoke there.
 *
 * `carriesDecision` is the ONE reading of what an axis means, so an axis this bench
 * does not know throws here rather than being quietly treated as a control.
 */
export function editPushSpeaks(arm, axis) {
  const carries = carriesDecision(axis)
  return carries && !switchedOffChannels(arm).includes(EDIT_PUSH_CHANNEL)
}

/**
 * Why a cell of the surface arm is INVALID rather than a zero — or `null` when it is not.
 *
 * THIS IS THE TEETH OF G5, and the reason it is one function with one call site. Eight
 * cells of this arm coming back at the pace of the `mnema` arm read as "the surface did
 * not help". Three different arrangements produce exactly that, and all three are
 * statements about the BENCH:
 *
 *   - the document handler never ran (`hook_ran` not true);
 *   - the channel's switch is not in the position the arm seeds it in;
 *   - the host never called the pushed tool although the agent wrote files;
 *   - the pushed tool WAS called and the channel said the wrong thing for the arm and
 *     the axis it is on — nothing where it should have spoken, or something where it
 *     should have kept quiet.
 *
 * IT WAS THREE UNTIL 2026-08-20 and the second one is what round 3 added, because until
 * round 3 no arm seeded a switch: the check existed, it read `off` as always wrong, and
 * its sentence said "nothing about the arm seeds it off". That sentence is now true of
 * one arm and false of the other, so the check compares against the arm instead of
 * against a constant, and the false half of the old sentence is rewritten rather than
 * deleted.
 *
 * None of them is the agent choosing anything, so none of them may be scored. They
 * become `harness_error`, which the round's own reading rule already handles — such a
 * cell is re-run once, both attempts are kept, and a pair that still has no result is
 * excluded and named (`measurements/p1/round-2/reading.md`). What must never happen is
 * the fourth outcome: any of the three counted as a violation.
 *
 * THE SECOND ONE IS CONDITIONAL ON A WRITE, deliberately. A cell where the agent edited
 * nothing has no edit for the hook to fire before, and calling that an instrument
 * failure would turn "the agent did nothing" into "the bench broke" — two different
 * findings, and the discriminant is already the one that judges the first.
 *
 * AND THE THIRD ONE ASKS WHICH AXIS, WHICH IT DID NOT UNTIL NOW. This is the premise
 * this function held and the round of 2026-08-20 falsified: that "the tool was called
 * and no `channel.served` came back" is an undelivered arm wherever it happens. On axis
 * B nothing is recorded and no rule addresses the file, so the channel CORRECTLY says
 * nothing and CORRECTLY appends nothing — the product's own sentence, the one
 * `editPushProblems` asserts in the preflight — and calling it a broken cell is the
 * instrument accusing what it itself requires. It cost all eight axis-B cells of the
 * only arm that round existed to measure, and with them the contamination detector for
 * that arm (`measurements/p1/results/2026-08-20-full/report.md`, §"the contamination
 * detector, and the gap in it").
 *
 * THE CONDITION IS THE AXIS AND IT CUTS BOTH WAYS, which is the half a loosening alone
 * would have thrown away. On axis A a call with no service is still an undelivered arm,
 * unchanged. On axis B a call WITH a service is the fact reading backwards — a channel
 * that speaks where nothing governs is a channel nobody can switch off, which is the
 * shape axis B exists to catch — and that cell is invalid too. An instrument that
 * accuses nothing there would be worse than one that accuses everything, because it
 * looks green.
 *
 * The axis is read through {@link carriesDecision}, the one reading of what the axes
 * mean, so a third axis throws here instead of being quietly treated as a control.
 */
export function surfaceProblem({ arm, axis, mechanism, diff, pushed = [], matchers = [] }) {
  if (!servesUnasked(arm)) return null
  if (mechanism?.hook?.ran !== true) {
    return `the document channel did not run in this cell: ${mechanism?.hook?.probe ?? 'no hook column'}`
  }
  // AND THE ONE CASE THAT WOULD BE MISNAMED, which is reachable only in this arm and only
  // because of the difference this arm already declares: the agent can see the CLI on its
  // PATH, so it can run `mnema switch off`. A cell where the channel was silenced before
  // the first edit produces exactly the shape of a channel that never arrived, and the
  // sentence "the host called none of it" would be false about it. The position is in the
  // line either way; what this does is stop the invalid cell from carrying a wrong reason.
  const wantOff = switchedOffChannels(arm).includes(EDIT_PUSH_CHANNEL)
  const off = (mechanism?.channel?.channels ?? []).includes(`${EDIT_PUSH_CHANNEL}:off`)
  if (off !== wantOff) {
    return wantOff
      ? // THE SIXTH ARM'S OWN INVALID CELL, and it is the mirror of the sentence below.
        // This arm IS a switch position: a cell of it whose channel is not off at the end
        // is `mnema+` wearing another name, and the round's whole question is a
        // subtraction between the two. Scored, it would make the two arms differ in
        // nothing and the answer would be zero for a reason nothing in the line records.
        `the ${EDIT_PUSH_CHANNEL} channel is NOT off at the end of this cell, and this arm IS ` +
        `that switch position: [${mechanism?.channel?.channels ?? []}] — ` +
        `${mechanism?.channel?.probe ?? 'no channel column'}`
      : `the ${EDIT_PUSH_CHANNEL} channel was OFF at the end of this cell, and nothing about the arm ` +
        'seeds it off: something in the cell switched it, which the record of the cell says who and when'
  }
  const pushes = mechanism?.mcp?.pushed ?? 0
  const wrote = (diff?.filesChanged ?? 0) > 0
  if (pushes === 0 && wrote) {
    // TWO CAUSES, AND THIS BENCH CANNOT TELL THEM APART, so it names both. The hook may not
    // have fired at all; or the agent may have written the file with a tool the matcher does
    // not cover — the declaration fires on Write, Edit and NotebookEdit, and a `Bash` heredoc
    // is none of them. The cell is invalid either way, which is the conservative side of the
    // asymmetry this protocol already chose: a lost cell understates the product, and a cell
    // scored without its surface publishes a false claim about it. What must not happen is
    // the line carrying a reason that is false about it.
    return (
      `the per-edit channel never reached this cell: ${diff.filesChanged} file(s) changed and the ` +
      `host called none of [${pushed}] on the cell’s server. Either the hook did not fire, or the ` +
      `file was written with a tool its matcher does not cover [${matchers}] — the diff of the cell ` +
      'is what tells those apart, and this bench cannot'
    )
  }
  const served = mechanism?.channel?.served ?? []
  const spoke = served.some((entry) => entry.startsWith(`${EDIT_PUSH_CHANNEL}:`))
  if (editPushSpeaks(arm, axis)) {
    if (pushes > 0 && !spoke) {
      return (
        `the per-edit channel was called ${pushes} time(s) on an axis ${axis} cell and the cell’s ` +
        `record holds no ${SERVED_KIND} for ${EDIT_PUSH_CHANNEL}: ` +
        `${mechanism?.channel?.probe ?? 'no channel column'}`
      )
    }
  } else if (spoke) {
    // TWO REASONS THE CHANNEL MUST NOT HAVE SPOKEN HERE, and the sentence has to name
    // the right one: a reader of an invalid cell acts on the reason. On an arm that
    // switched the channel off, a service is the SWITCH failing to silence anything —
    // which is a defect of the product and the one thing that would make round 3's
    // subtraction meaningless. On an arm that did not, it is the negative control's own
    // failure: a channel that serves where nothing governs is a channel nothing can
    // silence.
    return wantOff
      ? `the per-edit channel is switched OFF in this arm and the cell’s record holds ` +
        `${SERVED_KIND} for ${EDIT_PUSH_CHANNEL} anyway [${served}] after ${pushes} call(s): the ` +
        'switch did not silence the channel, so this cell is not the arm it was seeded as and the ' +
        'difference this round subtracts is not the one it declared'
      : `the per-edit channel was called ${pushes} time(s) on an axis ${axis} cell and the cell’s ` +
        `record holds ${SERVED_KIND} for ${EDIT_PUSH_CHANNEL} anyway [${served}]: nothing is recorded ` +
        'there and no rule addresses the file, so a channel that spoke is a channel nothing can ' +
        'silence and this cell is not the negative control it was seeded as'
  }
  return null
}

/**
 * Everything wrong with the per-edit channel in one seeded cell, as sentences. Empty
 * means the rules reached the writing.
 *
 * IT SPEAKS THROUGH THE CELL'S OWN `mcp.json`, so the wrapper is on the path this
 * clears — the same correction `mcpProbe` carries, for the same reason: a preflight that
 * cleared a route no cell takes has cleared nothing.
 *
 * IT NAMES THE TOOL OUT OF THE CELL'S OWN HOOK DECLARATION, never out of a literal
 * here. That is the elbow the whole channel turns on: the host calls whatever the
 * declaration names, and a check that called a tool of its own choosing would pass while
 * the declaration pointed at nothing.
 *
 * THE ASSERTION THAT MATTERS is the pair at the end, and they are opposite on the two
 * axes. On axis A the reply must carry the seeded decision's ID — a document that
 * arrives without citing what governs is G1 of `arms.md` unpaid — and the record must
 * hold exactly one service for the channel. On axis B there is no decision, nothing is
 * addressed, and the correct behaviour is `{}` with NOTHING appended: a fact saying the
 * channel served on a call where it said nothing would be the fact reading backwards.
 * Checking only the first would clear a channel that serves everybody always, which is
 * the shape a switched-off channel cannot be told apart from.
 */
export async function editPushProblems({ sandbox, arm, fixture, mnemaBin, settingsPath, mcpPath, timeoutMs = 30_000 }) {
  const problems = []
  let hooks
  try {
    hooks = JSON.parse(readFileSync(settingsPath, 'utf8')).hooks
  } catch (err) {
    return [`${settingsPath} could not be read: ${err.message}`]
  }
  const tools = pushedTools(hooks)
  if (tools.length === 0) return [`${settingsPath} declares no ${EDIT_EVENT} tool to push with`]

  const target = firstFile(sandbox.repo)
  if (target === null) return [`the planted repo has no file to ask about`]

  let server
  try {
    server = declaredServer(mcpPath)
  } catch (err) {
    return [err.message]
  }
  const out = await mcpConversation({
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: sandbox.repo,
    calls: tools.map((name) => ({ name, arguments: { path: join(sandbox.repo, target) } })),
    timeoutMs,
  })
  if (!out.ok) return [`the pushed tool could not be called: ${out.detail}`]

  const contexts = []
  for (const [i, answer] of out.answers.entries()) {
    let reply
    try {
      reply = JSON.parse(answer)
    } catch {
      problems.push(`${tools[i]} answered something that is not a hook reply: ${answer.slice(0, 200)}`)
      continue
    }
    const specific = reply?.hookSpecificOutput
    if (specific === undefined) {
      contexts.push(null)
      continue
    }
    if (specific.hookEventName !== EDIT_EVENT) {
      problems.push(`${tools[i]} answered for "${specific.hookEventName}", not ${EDIT_EVENT}`)
      continue
    }
    contexts.push(specific.additionalContext ?? null)
  }

  const said = contexts.filter((text) => typeof text === 'string' && text !== '')
  const service = servedChannels(sandbox, mnemaBin, [EDIT_PUSH_CHANNEL])
  if (service.served === null) return [...problems, service.detail]
  const served = service.served.length

  if (editPushSpeaks(arm, fixture.axis)) {
    const id = mnemaRecords(sandbox, mnemaBin).hits[0]?.id
    if (!id) {
      problems.push('the cell holds no record to be cited')
    } else if (!said.some((text) => text.includes(id))) {
      problems.push(`nothing the channel pushed cites the seeded decision ${id}: ${said.join(' ').slice(0, 200)}`)
    }
    if (served !== 1) {
      problems.push(`the record holds ${served} ${SERVED_KIND} for ${EDIT_PUSH_CHANNEL} on ${target}, expected 1`)
    }
  } else {
    // WHERE THE SLICE THAT BUILT `mnema-doc` WOULD HAVE STOPPED. Until 2026-08-20 this
    // branch was axis B alone, and its sentence said so. It now also carries every cell
    // of an arm that switched the channel off, on EITHER axis, and the two are one rule
    // because they are one question: does the channel keep quiet when it has nothing to
    // say or has been told not to? A `mnema-doc` seeded on axis A, with a decision
    // recorded and the root addressed, is the only cell in this bench where the channel
    // has everything it needs to speak and must not. If it speaks anyway, the switch
    // does not silence it, and the whole arm is a name for `mnema+`.
    const why = switchedOffChannels(arm).includes(EDIT_PUSH_CHANNEL)
      ? `this arm switched ${EDIT_PUSH_CHANNEL} off`
      : 'no rule is recorded in an axis B cell'
    if (said.length > 0) {
      problems.push(`the channel pushed text where it must say nothing (${why}): ${said.join(' ').slice(0, 200)}`)
    }
    if (served !== 0) {
      problems.push(`the record holds ${served} ${SERVED_KIND} for a cell where the channel must say nothing (${why})`)
    }
  }
  return problems
}

/** The first file of the planted repo, by name — never the record and never git's. */
function firstFile(repo) {
  const found = readdirSync(repo, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
  return found[0] ?? null
}

