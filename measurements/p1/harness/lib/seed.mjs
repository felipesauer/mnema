// The six arms — where the whole experiment is won or lost.
//
// An arm is ONE variable: where the decision lives, whether it is HANDED OVER
// without being asked for, and — for the sixth — WHICH HALF of that handing over is
// switched on. Everything else is held equal by `isolation.mjs`. So the rules here
// are narrow and the checker below is the same table read backwards:
//
//   base       nothing. The floor.
//   prosa      the same decision, verbatim, in a committed DECISIONS.md.
//   host       the same decision in the host's own auto-memory format.
//   mnema      the same decision in a mnema record, served over MCP.
//   mnema-doc  the mnema+ arm exactly, with the PER-EDIT PUSH SWITCHED OFF through
//              the product's own door. The document channel and nothing else.
//   mnema+     the mnema arm exactly, plus the whole surface the product ships to
//              hand that record over UNASKED and charge for it.
//
// IT SAID "THE FIVE ARMS" UNTIL 2026-08-20, and what falsified that is round 3.
// Round 2 measured `mnema+` carrying two channels at once and no arm of it separated
// them; round 3's frozen `arms.md` asks which of the two the number belongs to, and
// the answer is a subtraction between two arms that differ in ONE SWITCH POSITION.
// `mnema-doc` is that arm. It is NOT built by withholding the address from the seed —
// that route is measured, it works, and it is rejected in the frozen file because an
// arm with no address holds a DIFFERENT RECORD, so the pair would differ in the
// record's content and in the channel at once and the subtraction would no longer be
// the push. The switch route keeps the two records identical and puts the whole
// difference in one recorded switch position.
//
// THE FIFTH ARM CAME AFTER THE FIRST ROUND, and it is not a fifth guess. Over the
// two tasks that discriminate the round measured `host` 8/8 · `base` 0/8 ·
// `mnema` 0/8 with `mcp_asked` false in 20 of 20: the arm holding the decision
// scored what the arm holding nothing scored, because the agent never asked. The
// `host` arm's mechanism is one the client loads UNASKED, and the surface named in
// `measurements/p1/round-2/arms.md` is this product's answer to it.
//
// UNTIL 2026-08-19 THIS ARM WAS CALLED `plugin` AND ITS WHOLE MECHANISM WAS THE
// `SessionStart` HOOK, and that premise is falsified rather than deleted. The
// product shipped two more channels afterwards — the rules addressed at a file,
// handed over as that file is about to be written, and the pause where a rule asks
// for a person — and the round's own pre-registration names the arm `mnema+` and
// defines it as the record "served unasked and charged for". A hook that hands over
// a document is only the first third of that, so the arm is renamed and the other
// two channels are seeded and measured. The rename is not cosmetic: every place that
// read the old name is red until it is visited, which is the point.
//
// WHAT THE ARM ADDS TO `mnema`, ITEM BY ITEM, because an undeclared difference
// between arms is the defect this bench exists to prevent:
//
//   1. the product's own hook declarations, both of them (`lib/hook.mjs`);
//   2. a `mnema` of the cell's own in front of PATH, which the document handler
//      resolves by name (`lib/hook.mjs`);
//   3. an ADDRESS on the seeded decision — `mnema link <id> . --rel governs` — which
//      is what makes the per-edit channel able to speak at all. MEASURED, not
//      assumed: with no address `rules_before_an_edit` answers `{}`, no
//      `channel.served` is ever appended, and the arm collapses into the document
//      channel alone, which is the mechanism the eight cells of 2026-08-18 already
//      measured. An address is packaging and not knowledge — it says WHERE a rule
//      applies, never what it says — so `assertKnowledgeParity` still holds and
//      still runs.
//
// WHAT IT DELIBERATELY DOES NOT ADD is `--rel asks-for-a-person`. The gate's effect
// is that the write does not happen until a person decides, and a `-p` cell has
// nobody to ask (`measurements/asks-a-person/`): every cell of this arm would come
// back with the edit refused. That is a limit of a headless cell rather than a
// choice about the product, and it is declared in `ISOLATION_CHECKLIST` and in the
// report instead of being argued away.
//
// TWO THINGS THAT LOOK LIKE DETAILS AND ARE NOT.
//
// The MECHANISM stays on in every arm and only the CONTENT differs: every cell
// gets a fresh `autoMemoryDirectory`, and the arms that install the tool found a
// record on axis B too — empty. If the mechanism were off in the others, "the
// record changed the work" and "the tool was installed" would be the same
// variable.
//
// The decision is ACCEPTED in the mnema arm. A DECISIONS.md in the repository
// root and a memory file both read as settled; a mnema decision left in
// `proposed` reads as not yet binding, and the arm would be handed weaker
// authority than the other two while claiming to hold the same knowledge.

import { readFileSync, writeFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { canonicalKnowledge, carriesDecision, readDecision } from './fixtures.mjs'
import { assertCleanTree, commitAll, exists, sandboxEnv } from './sandbox.mjs'

export const ARMS = ['base', 'prosa', 'host', 'mnema', 'mnema-doc', 'mnema+']

/**
 * The arm that gets the product's whole unasked surface on top of the mnema arm.
 *
 * The name is the pre-registration's (`measurements/p1/round-2/split.json`), and it
 * is compared against that file rather than agreed with it: `refuseUnrunnableRound`
 * ends a round that declares an arm this list does not hold.
 *
 * THAT COMPARISON USED TO BE ELEMENT BY ELEMENT, and round 3 falsified the premise
 * under it — see `refuseUnrunnableRound` in `lib/split.mjs`, which is where the
 * sentence that was wrong is rewritten rather than deleted. In short: a round may
 * declare a SUBSET of the arms this harness can seed, and round 3 does.
 */
export const SURFACE_ARM = 'mnema+'

/**
 * The arm that carries the same surface with the per-edit push SWITCHED OFF.
 *
 * The half of `mnema+` that round 2 measured without knowing it. Round 2's own
 * committed `cells.jsonl` says `mcp_pushed` is 1 in all 24 headline cells of `mnema+`
 * and the capture in `measurements/mcp-tool-channel/` says the pushed text lands
 * AFTER the tool result of the edit that triggered it — so in every headline cell of
 * that round the per-edit text could not have changed a byte of the code, and what
 * the arm measured was the opening document. This arm is the one that can say so.
 *
 * The name is round 3's pre-registration's, exactly as `SURFACE_ARM` is round 2's.
 */
export const DOC_ARM = 'mnema-doc'

/**
 * The channel the per-edit push speaks on, as the product names it.
 *
 * A LITERAL, and this file is where it lives BECAUSE THE ARM IS A SWITCH POSITION.
 * It used to live in `lib/channel.mjs`, whose doc-comment said the vocabulary of
 * channels belongs to the product and that this was a second reading of one of its
 * names. That is still true and it is not why it moved: `expectedSeedState` is the
 * single table both halves of the seed read, `mnema-doc` differs from `mnema+` in
 * exactly one entry of it, and that entry is this name. A channel name the seeder
 * could not see would be a dimension written by one half and unchecked by the other.
 *
 * What keeps it from drifting in silence is unchanged and lives one call away: every
 * reading of it goes through `channelService`, which requires the name to be among
 * the ones `mnema switch` actually printed — so a channel the product renamed makes
 * the column say it cannot answer, instead of quietly reporting an empty timeline for
 * a channel that no longer exists. And `assertSeed` refuses the cell outright, before
 * anything is spent, because a name the switch table does not hold cannot be switched.
 */
export const EDIT_PUSH_CHANNEL = 'edit-rules-push'

/**
 * Which arms hold a mnema record and serve it over MCP.
 *
 * One predicate, one site, because the answer is read in five places — the seed
 * table, the cell's `mcp.json`, the record count, the channel column and the
 * preflight — and five readings of one rule is the shape that drifts in silence.
 * It drifted here on purpose once: every one of those places said
 * `arm === 'mnema'`, and the fifth arm would have been seeded with a record it
 * could not serve, measured with a `null` channel column, and scored as if the
 * record had not been there.
 */
export function servesRecord(arm) {
  return arm === 'mnema' || arm === DOC_ARM || arm === SURFACE_ARM
}

/**
 * Which arms serve the record UNASKED. The mechanism of the fifth arm, and of no other.
 *
 * It was called `carriesHook` while the arm's whole mechanism was one hook. It is not
 * one hook any more — two hook declarations, a shim on PATH and an address on the
 * seeded decision — so the predicate is named after what the arm DOES rather than
 * after the first thing it had.
 */
export function servesUnasked(arm) {
  return arm === DOC_ARM || arm === SURFACE_ARM
}

/**
 * The channels an arm switches OFF at seed time, through the product's own door.
 *
 * THE SIXTH ARM IS THIS FUNCTION, and nothing else. `mnema-doc` and `mnema+` are the
 * same seed, the same record, the same address, the same two hook declarations and the
 * same shim; the whole difference between them is one `mnema switch off`, recorded as a
 * fact in the cell's own record by the CLI the product ships.
 *
 * THREE THINGS THAT BUYS, and they are why the arm is built this way rather than by a
 * configuration of the bench's own:
 *
 *   1. the arm is self-evident in the line. `channels_on` reports
 *      `edit-rules-push:off` beside `brief-document:on`, so the CELL proves what the
 *      arm is instead of this bench asserting it;
 *   2. the mechanism is the embedded one, so the arm cannot drift away from a product
 *      that changed under it;
 *   3. and if the switch does NOT silence the channel, that is a defect of the product
 *      the round would otherwise have measured as noise. `assertSeed` and
 *      `editPushProblems` both refuse the cell in that case, before anything is spent.
 *
 * The switch is PUBLIC, which is the default and is deliberate: the fact is committed
 * with the seed, so the cell's tree is clean before the agent runs and a reader of the
 * record afterwards can tell the seed's switch from anything the session did.
 */
export function switchedOffChannels(arm) {
  if (!ARMS.includes(arm)) throw new Error(`unknown arm: ${arm}`)
  return arm === DOC_ARM ? [EDIT_PUSH_CHANNEL] : []
}


/**
 * The address the fifth arm records on the decision it seeds: the repository root.
 *
 * The root and not the file the ticket is about, and the difference is what the bench
 * is allowed to know. A rule addressed at exactly the file each discriminant reads
 * would be the bench tuning the arm task by task; the root is one string for all ten
 * tasks, it needs nothing of what any ticket says, and it covers every file the agent
 * can touch. Measured on the product's own reading: `.` reports "covers 2 of 2 files",
 * and `rules_before_an_edit` answers for a path at the root and for one in a
 * subdirectory.
 */
export const GOVERNS_ADDRESS = '.'

/**
 * The scope the sixth arm's switch is born in — PRIVATE, and this is the one choice of
 * this arm that was decided by measurement rather than by preference.
 *
 * `public` is the product's default and was tried first, because a public switch travels
 * with the repository and is the position a team would read. IT MOVES THE OPENING
 * DOCUMENT, by the product's own design and correctly: `brief` reads the COMMITTED
 * record, and a public switch makes it replace the two lines that say the rules arrive at
 * an edit with three that say nothing will, naming the channel, who switched it and when
 * (`packages/code/src/presentation/brief.ts`, `switchedOffAtAnEdit`). The product refuses
 * to let a silence read as "no rule names this file" when somebody turned the channel
 * off, which is the right call for a person and the wrong one for this pair.
 *
 * WHY IT IS THE WRONG ONE HERE, in the frozen file's own words. `round-3/arms.md` says
 * the two arms "differ in exactly one bit — a switch position in the cell's own record",
 * and that the difference between them "is the push, and only the push". With a public
 * switch they differ in a switch AND in three lines of text handed to the model — text
 * about the BENCH'S arrangement, not about the code — and those three lines point the
 * model at `mnema switch` and at a channel it did not know existed. A `mnema-doc` cell
 * that scored well because the document told it to go looking would be read as the
 * document channel earning the number, which is the exact claim this round is measuring.
 *
 * A private switch is invisible to `brief` — the product says so where it is decided, in
 * the same doc-comment — so the opening document is BYTE-IDENTICAL in the two arms, and
 * the position is still a recorded, attributed fact that `mnema switch` reports, because
 * that reading spans every tree. G4 of `arms.md` is paid by the line, unchanged.
 *
 * AND THE COST IS STATED, because it is real and it is the other half of what the product
 * decided. In this arm the document TELLS THE MODEL the addressed rules "arrive on their
 * own" and nothing arrives. That is a false sentence in the context of every `mnema-doc`
 * cell, and it is accepted for the reason `arms.md` accepts the third channel being on in
 * both arms: it is the SAME false sentence `mnema+` reads, in the same position, so it is
 * common to both sides of the subtraction and contributes nothing to it. What it does
 * cost is that this round cannot tell "the push adds nothing" from "the push adds nothing
 * WHEN THE DOCUMENT PROMISED IT" — and that is a question about the document, which is
 * the channel this round holds fixed.
 */
export const SWITCH_SCOPE = 'private'

/** The name the harness records itself under when it drives the mnema CLI. */
export const SEEDING_AGENT = 'mnema-bench-harness'

/** Constant, and deliberately free of domain knowledge — the arms must not differ by a note. */
export const ACCEPT_NOTE = 'Seeded as settled for the measurement.'

export const DECISIONS_FILE = 'DECISIONS.md'
export const MEMORY_INDEX = 'MEMORY.md'

/**
 * What a seeded sandbox must look like, per arm and axis.
 *
 * This is the single source for both halves: `seedArm` writes it and
 * `assertSeed` reads it. A rule with two readings is the shape that produces
 * silent divergence, and here the divergence would be "the floor arm quietly
 * had the answer".
 */
export function expectedSeedState(arm, axis) {
  if (!ARMS.includes(arm)) throw new Error(`unknown arm: ${arm}`)
  const carries = carriesDecision(axis)
  return {
    decisionsFile: arm === 'prosa' && carries,
    hostMemory: arm === 'host' && carries,
    // The mechanism, not the content: the tree exists on both axes.
    mnemaTree: servesRecord(arm),
    mnemaRecords: servesRecord(arm) && carries ? 1 : 0,
    // The fifth dimension, and the fifth arm's alone: an ADDRESS on the decision it
    // holds. Declared here rather than inside `seedArm` for the reason the other four
    // are — this table is the single source both halves read, and an address written
    // by one half and unchecked by the other is the shape that quietly stops being
    // true. Zero on axis B because there is no decision to address.
    mnemaAddresses: servesUnasked(arm) && carries ? 1 : 0,
    // The SIXTH dimension, and the sixth arm's alone: a switch position, recorded in
    // the cell's own record. It does not depend on the axis — the arm is the switch,
    // and an arm that were itself only on one axis would be two arms. Written by
    // `seedArm` and read back by `assertSeed` through the product's own `mnema switch`,
    // for both arms that carry the surface: `mnema+` is checked for the ABSENCE of the
    // switch for the same reason `base` is checked for three absences, and here the
    // absence is load-bearing twice over — a switch that leaked into `mnema+` would give
    // the pair two differences instead of one, and the subtraction the round exists to
    // make would stop being the push.
    switchedOff: switchedOffChannels(arm),
  }
}

/** kebab-case slug for a memory file name, derived from the decision title. */
export function slugFor(title) {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  if (!slug) throw new Error(`the decision title produces an empty slug: ${title}`)
  return slug
}

/** The hook in the MEMORY.md index line. A prefix of the statement — it adds no knowledge. */
export function indexHook(statement) {
  const oneLine = statement.replace(/\s+/g, ' ').trim()
  return oneLine.length <= 90 ? oneLine : `${oneLine.slice(0, 90).trimEnd()}…`
}

/**
 * The body of the host memory — the decision, minus its H1, in the same shape
 * `prosa` gets. Kept separate from the frontmatter so the parity check can
 * compare knowledge against packaging that only one arm has.
 */
export function hostMemoryBody(decision) {
  return [
    decision.statement,
    '',
    `**Why.** ${decision.why}`,
    '',
    `**Alternative we turned down.** ${decision.alternatives}`,
    '',
  ].join('\n')
}

/** The host's auto-memory format: frontmatter, then the decision body. */
export function hostMemoryFile(decision) {
  return [
    '---',
    `name: ${slugFor(decision.title)}`,
    `description: ${decision.title}`,
    'metadata:',
    '  type: project',
    '---',
    '',
    hostMemoryBody(decision),
  ].join('\n')
}

export function hostIndexFile(decision) {
  return `- [${decision.title}](${slugFor(decision.title)}.md) — ${indexHook(decision.statement)}\n`
}

/** The three fields the mnema CLI takes, carved out of the one decision.md. */
export function mnemaFields(decision) {
  return {
    title: decision.title,
    rationale: `${decision.statement}\n\n${decision.why}`,
    alternatives: decision.alternatives,
  }
}

export function mnema(sandbox, mnemaBin, args) {
  return spawnSync(process.execPath, [mnemaBin, ...args], {
    cwd: sandbox.repo,
    encoding: 'utf8',
    env: sandboxEnv(sandbox),
    maxBuffer: 32 * 1024 * 1024,
  })
}

function must(result, what) {
  if (result.error) throw new Error(`${what} could not run: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`${what} exited ${result.status}: ${result.stderr || result.stdout}`)
  }
  return result
}

/**
 * Seed one arm into an already-planted sandbox, then commit and prove the tree is clean.
 *
 * Throws on any failure. A seed that half-succeeded is not a cell that runs
 * badly — it is a cell that must not run at all, and the caller records it as a
 * harness error rather than as anything the agent did.
 */
export function seedArm({ arm, fixture, sandbox, mnemaBin }) {
  if (!ARMS.includes(arm)) throw new Error(`unknown arm: ${arm}`)
  const decision = readDecision(fixture)
  const want = expectedSeedState(arm, fixture.axis)

  if (want.decisionsFile) {
    writeFileSync(join(sandbox.repo, DECISIONS_FILE), readFileSync(fixture.decisionPath, 'utf8'))
  }

  if (want.hostMemory) {
    writeFileSync(join(sandbox.memory, `${slugFor(decision.title)}.md`), hostMemoryFile(decision))
    writeFileSync(join(sandbox.memory, MEMORY_INDEX), hostIndexFile(decision))
  }

  if (want.mnemaTree) {
    must(mnema(sandbox, mnemaBin, ['init']), 'mnema init')
    if (want.mnemaRecords > 0) {
      const fields = mnemaFields(decision)
      const recorded = must(
        mnema(sandbox, mnemaBin, [
          'decision',
          fields.title,
          fields.rationale,
          '--alternatives',
          fields.alternatives,
          '--which',
          SEEDING_AGENT,
        ]),
        'mnema decision',
      )
      const id = /\(([0-9a-f]{8}-[0-9a-f-]{27})\)/.exec(recorded.stdout)?.[1]
      if (!id) throw new Error(`mnema decision printed no id:\n${recorded.stdout}`)
      must(
        mnema(sandbox, mnemaBin, [
          'decision',
          'move',
          'accept',
          id,
          '--note',
          ACCEPT_NOTE,
          '--which',
          SEEDING_AGENT,
        ]),
        'mnema decision move accept',
      )
      if (want.mnemaAddresses > 0) {
        // THE ADDRESS, and it is the fifth arm's second mechanism. Without it the
        // product's per-edit channel answers `{}` on every call and appends no
        // `channel.served`, so the arm would be the document channel alone — the
        // mechanism the eight cells of 2026-08-18 already measured — while claiming
        // to be the surface `arms.md` declares. `--which` is the harness, like every
        // other write it makes, so a reader of the cell's record can tell the seed's
        // facts from the session's.
        must(
          mnema(sandbox, mnemaBin, [
            'link',
            id,
            GOVERNS_ADDRESS,
            '--rel',
            'governs',
            '--which',
            SEEDING_AGENT,
          ]),
          'mnema link governs',
        )
      }
    }
    // THE SWITCH, and it is the sixth arm's whole mechanism. Through the product's own
    // verb rather than a configuration of this bench's: the position is then a FACT in
    // the cell's record, signed and attributed, and the line reports it out of
    // `mnema switch` instead of out of a promise made here. It is outside the
    // `mnemaRecords > 0` branch on purpose — the arm is the switch on both axes, and an
    // axis-B cell of this arm whose channel was left on would be the wrong control.
    for (const channel of want.switchedOff) {
      must(
        mnema(sandbox, mnemaBin, ['switch', 'off', channel, '--scope', SWITCH_SCOPE, '--which', SEEDING_AGENT]),
        `mnema switch off ${channel}`,
      )
    }
  }

  commitAll(sandbox, `seed: ${arm}`)
  assertCleanTree(sandbox)
  return { arm, axis: fixture.axis, want }
}

/** The records the mnema arm holds, read back through the product's own index. */
export function mnemaRecords(sandbox, mnemaBin) {
  const out = must(mnema(sandbox, mnemaBin, ['search', '--json']), 'mnema search --json')
  return JSON.parse(out.stdout)
}

/**
 * What governs a path in a seeded sandbox, read through the product's own reading.
 *
 * `mnema rules <path> --json` and not a walk of the chain: the question "is this
 * decision addressed at this path" is answered by one function in the product, and a
 * second answer here would be a second reading of the rule the arm depends on. It is
 * also the reading the per-edit channel itself stands on, so a change that stops the
 * address matching turns this red instead of turning the channel silent.
 */
export function mnemaRules(sandbox, mnemaBin, path = GOVERNS_ADDRESS) {
  const out = must(mnema(sandbox, mnemaBin, ['rules', path, '--json']), `mnema rules ${path} --json`)
  return JSON.parse(out.stdout)
}

/**
 * WHY THE TWO FUNCTIONS BELOW LIVE HERE and not in `lib/channel.mjs`, where they were
 * written and where their subject still is.
 *
 * `assertSeed` has to read a switch POSITION, because `mnema-doc` is a switch position
 * and `expectedSeedState` is the one table both halves of the seed read. Reading it with
 * a second `mnema switch` of this module's own would be two readings of one rule, which
 * is the shape that drifts in silence — and the drift would be an arm that thinks it
 * switched a channel off while the cell it seeds has it on. So the ONE reading moved
 * next to `mnemaRecords` and `mnemaRules`, which are this module's other two readings of
 * the product, and `lib/channel.mjs` imports it from here.
 */

/**
 * Where every channel of this product stands in a cell, read through `mnema switch`.
 *
 * G4 of the round's `arms.md` asks that the arm DECLARE the surface on rather than
 * presume it. Nothing is born switched off, so today the declaration is redundant — and
 * the day a default moves is the day a cell would go quiet with nothing in the line to
 * say why, which is the difference between "it is on" and "we checked that it is on".
 *
 * IT PARSES THE PRODUCT'S OWN LINE and does not re-derive the position from the events.
 * Reading the last `channel.switched` here would be a second implementation of a rule
 * that already has one (`projectChannelSwitches`), and two readings of one rule is the
 * shape that drifts. The cost of that choice is that this parse depends on a layout, so
 * it is STRICT: a table it cannot read whole is reported as unreadable rather than
 * summarised, because a channel silently missing from this list is the one thing the
 * column must not do.
 */
export function channelPositions(sandbox, mnemaBin) {
  const out = mnema(sandbox, mnemaBin, ['switch'])
  if (out.status !== 0) {
    return { channels: null, probe: `mnema switch exited ${out.status}: ${(out.stderr || out.stdout).trim().slice(0, 200)}` }
  }
  const head = /^(\d+) channel\(s\)/m.exec(out.stdout)
  const rows = [...out.stdout.matchAll(/^ {2}(\S+) {2,}(on|off)\b/gm)]
  if (!head || rows.length !== Number(head[1])) {
    return {
      channels: null,
      probe:
        `mnema switch printed ${rows.length} readable row(s) for ${head?.[1] ?? '?'} channel(s): the ` +
        'table could not be read whole, so the column says so instead of summarising it',
    }
  }
  return {
    channels: rows.map(([, name, position]) => `${name}:${position}`).sort(),
    probe: `mnema switch reported ${rows.length} channels, each with its position`,
  }
}


/** Every channel this product has, in a cell — the names `mnema switch` printed. */
export function channelNames(positions) {
  return (positions.channels ?? []).map((entry) => entry.slice(0, entry.lastIndexOf(':')))
}

/**
 * Prove a seeded sandbox is in the state its arm claims — all SIX dimensions, for
 * every arm.
 *
 * It said "all four" until 2026-08-19, when the address became the fifth, and "all
 * four" again in the same breath until 2026-08-20, when the switch position became the
 * sixth. The count is written out rather than left as "every dimension" because it is
 * the line a seventh has to come and move.
 *
 * Checking only what an arm ADDS would leave the floor unguarded: `base` is
 * defined by three absences, and an absence nobody asserts is the one that
 * quietly stops being true. The sixth dimension is the sharpest case of that rule this
 * bench has: `mnema+` is checked for the ABSENCE of a switch, and a switch that leaked
 * into it would make the two surface arms differ in nothing.
 */
export function assertSeed({ arm, fixture, sandbox, mnemaBin }) {
  const want = expectedSeedState(arm, fixture.axis)
  const problems = []
  const where = `${fixture.id}/${arm}`

  const hasDecisionsFile = exists(join(sandbox.repo, DECISIONS_FILE))
  if (hasDecisionsFile !== want.decisionsFile) {
    problems.push(`${DECISIONS_FILE} ${hasDecisionsFile ? 'is present' : 'is missing'}, expected the opposite`)
  }
  if (want.decisionsFile) {
    const onDisk = readFileSync(join(sandbox.repo, DECISIONS_FILE), 'utf8')
    if (onDisk !== readFileSync(fixture.decisionPath, 'utf8')) {
      problems.push(`${DECISIONS_FILE} is not the decision verbatim`)
    }
    const tracked = spawnSync('git', ['ls-files', DECISIONS_FILE], {
      cwd: sandbox.repo,
      encoding: 'utf8',
      env: sandboxEnv(sandbox),
    })
    if (!tracked.stdout.trim()) problems.push(`${DECISIONS_FILE} is not committed`)
  }

  const memoryFiles = readdirSync(sandbox.memory)
  if (want.hostMemory) {
    const expectFiles = [MEMORY_INDEX, `${slugFor(readDecision(fixture).title)}.md`].sort()
    if (memoryFiles.slice().sort().join(',') !== expectFiles.join(',')) {
      problems.push(`the host memory holds [${memoryFiles}], expected [${expectFiles}]`)
    }
  } else if (memoryFiles.length > 0) {
    problems.push(`the host memory directory is not empty: [${memoryFiles}]`)
  }

  const hasTree = exists(join(sandbox.repo, '.mnema'))
  if (hasTree !== want.mnemaTree) {
    problems.push(`.mnema ${hasTree ? 'is present' : 'is missing'}, expected the opposite`)
  }
  if (want.mnemaTree) {
    const index = mnemaRecords(sandbox, mnemaBin)
    if (index.total !== want.mnemaRecords) {
      problems.push(`the record holds ${index.total} entries, expected ${want.mnemaRecords}`)
    }
    if (want.mnemaRecords > 0) {
      const hit = index.hits[0]
      const decision = readDecision(fixture)
      if (hit?.title !== decision.title) {
        problems.push(`the record holds "${hit?.title}", expected "${decision.title}"`)
      }
      if (hit?.state !== 'accepted') {
        problems.push(`the decision is "${hit?.state}", expected "accepted"`)
      }
    }
    // THE ADDRESS, checked in both directions, because it is the dimension that
    // decides whether the fifth arm's per-edit channel can speak. Both arms that hold
    // a record come through here, so the `mnema` arm is checked for the address's
    // ABSENCE — the same reason `base` is checked for three absences: an absence
    // nobody asserts is the one that quietly stops being true, and an address that
    // leaked into `mnema` would give the two arms two differences instead of one.
    const rules = mnemaRules(sandbox, mnemaBin)
    if (rules.counts?.governing !== want.mnemaAddresses) {
      problems.push(
        `${rules.counts?.governing} rule(s) govern the repository root, expected ${want.mnemaAddresses}`,
      )
    }
    if (want.mnemaAddresses > 0) {
      const addressed = rules.rules?.[0]
      if (addressed?.address !== GOVERNS_ADDRESS) {
        problems.push(`the address is "${addressed?.address}", expected "${GOVERNS_ADDRESS}"`)
      }
      if (addressed?.state !== 'accepted') {
        problems.push(`the addressed rule is "${addressed?.state}", expected "accepted"`)
      }
      if (addressed?.rule !== index.hits[0]?.id) {
        problems.push(`the address is on ${addressed?.rule}, not on the seeded decision`)
      }
    }
    // And the absence that IS the fifth arm's declared limit: no rule asks for a
    // person. The gate's effect is that the write does not happen until somebody
    // decides, and a headless cell has nobody — so an ask address here would refuse
    // every edit of every cell of this arm. It is asserted rather than trusted.
    if (rules.counts?.asks?.matching !== 0) {
      problems.push(`${rules.counts?.asks?.matching} rule(s) ask for a person, expected none`)
    }

    // THE SWITCH POSITIONS, in both directions and for every arm that has a record —
    // which is what makes `mnema+` a checked ABSENCE here rather than an assumption.
    // `mnema-doc` is nothing but a switch position, so an arm whose switch did not take
    // is the `mnema+` arm with a different name, and it would be measured as one: the
    // subtraction the round exists to make would be between two identical arms and the
    // answer would be zero for the wrong reason. Read through the product's own
    // `mnema switch`, never from a promise made by `seedArm`.
    const positions = channelPositions(sandbox, mnemaBin)
    if (positions.channels === null) {
      problems.push(`the switch table could not be read: ${positions.probe}`)
    } else {
      // A name this bench asks to switch and the product does not print cannot BE
      // switched, and the switch above would have failed loudly — this says which of the
      // two happened instead of leaving a green cell with an on channel in it.
      const names = channelNames(positions)
      for (const channel of want.switchedOff) {
        if (!names.includes(channel)) {
          problems.push(`this arm switches "${channel}" off and the product prints [${names}]`)
        }
      }
      const off = positions.channels.filter((entry) => entry.endsWith(':off')).map((entry) => entry.slice(0, entry.lastIndexOf(':'))).sort()
      const wantOff = [...want.switchedOff].sort()
      if (off.join(',') !== wantOff.join(',')) {
        problems.push(`the channels switched off are [${off}], expected [${wantOff}]`)
      }
    }
  }

  if (problems.length) throw new Error(`${where}: ${problems.join('; ')}`)
  return true
}

/**
 * The three seeded arms must carry the SAME knowledge — asserted, not assumed.
 *
 * This is the fairness invariant of the whole run. If `prosa` carries a
 * paragraph that `mnema` does not, a difference in the result is a difference in
 * what the arms were told, and no amount of repetition would separate the two.
 */
export function assertKnowledgeParity(fixture) {
  if (!fixture.hasDecision) return true
  const decision = readDecision(fixture)
  const fields = mnemaFields(decision)

  // Each arm as the agent would meet it, with the title back in front of the
  // two shapes that carry it outside the body.
  const shapes = {
    prosa: readFileSync(fixture.decisionPath, 'utf8'),
    host: `${decision.title}\n\n${hostMemoryBody(decision)}`,
    mnema: `${fields.title}\n\n${fields.rationale}\n\n${fields.alternatives}`,
  }
  const canonical = Object.entries(shapes).map(([arm, text]) => [arm, canonicalKnowledge(text)])
  const [[refArm, refText], ...rest] = canonical
  for (const [arm, text] of rest) {
    if (text !== refText) {
      throw new Error(
        `${fixture.id}: the ${arm} arm and the ${refArm} arm do not carry the same knowledge\n` +
          `  ${refArm}: ${refText}\n  ${arm}: ${text}`,
      )
    }
  }

  // The index line is a pointer, not content: its hook must be a prefix of the
  // statement, or the host arm is handed a sentence the others never see.
  const hook = indexHook(decision.statement).replace(/…$/, '')
  if (!decision.statement.replace(/\s+/g, ' ').startsWith(hook)) {
    throw new Error(`${fixture.id}: the MEMORY.md hook is not a prefix of the statement`)
  }
  return true
}
