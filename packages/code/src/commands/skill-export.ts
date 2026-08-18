/**
 * `mnema skill export <id> --out <dir>` — an adopted pattern written as the
 * `<name>/SKILL.md` an agent host reads on its own.
 *
 * IT IS AN OUTPUT AND NOTHING ELSE: no event, no field on the catalogue, no key, no
 * consultation. That is the whole condition under which this slice costs nothing in
 * proof — the record stays the record, and a file is produced from it. The one thing
 * the specification needs and the record does not hold is the `description`, and it is
 * DERIVED at the moment of export (`agent-skill.ts`) rather than stored: a field on
 * `skill.created` would be a new kind of thing the product promises to prove, and this
 * one exists for the host's router, a role the record does not have.
 *
 * THERE IS NO IMPORT, in any form, and that is the decision this verb is one half of.
 * A third party's `SKILL.md` read into the record would enter as a body signed by us,
 * asserting a provenance we do not have. So the direction is out, there is no flag that
 * reverses it, and `agent-skill.ts` holds no parser to reverse it with.
 *
 * ONLY A PATTERN IN FORCE LEAVES, and the two states this refuses are refused for two
 * different reasons that both land here:
 *   - a pattern AWAITING A JUDGEMENT, dropped into a host's skills directory, is used
 *     by an agent as though it were the team's standard — skipping exactly the review
 *     this product exists to record. It is not "not ready to read": the `skills` tool
 *     serves such a body to a caller that names it, so it can be RULED on. Serving a
 *     candidate to whoever asked to judge it and publishing a candidate as a standard
 *     are two different acts, which is why {@link EXPORTED} is a second table beside
 *     the copilot's `BODY_SERVED` rather than a reading of it.
 *   - a CLOSED one was ruled on, and exporting it re-introduces a retired way of
 *     working wearing the same face as a live one. `deprecated` is the sharp half:
 *     it WAS adopted, so every other trace of it looks like an adoption.
 * There is no `--force`. The way to export a proposal is to adopt it, and that is the
 * sentence the refusal says.
 *
 * THE RULE IS OVER THE DISPOSITION AND NOT OVER THE FIVE STATES, so a sixth state
 * cannot slip through: `SKILL_DISPOSITION` in `@mnema/copilot` is total over the
 * machine, so a state added tomorrow does not compile until it is classified, and
 * {@link EXPORTED} is total over the three dispositions, so a fourth disposition does
 * not compile until it has an answer here. The classification is ASKED
 * (`skillDisposition`), never restated — the surface deciding for itself what `adopted`
 * means is the shape `no-classification-table-reaches-the-surface.test.ts` names.
 *
 * WHAT GOES IN `metadata`, AND WHY IT IS THE ONE THING NOBODY ELSE CAN WRITE. The id
 * of the record and the ANCHOR that put the pattern in force. A third party holding the
 * repository can check both — `mnema show <id>` reads the pattern back, `mnema verify`
 * rules on the chain the two facts live in, `mnema timeline <id>` names the identity —
 * and no competitor in the ecosystem study can produce that line: a lockfile hashes a
 * file that changes, and `metadata.author` is a free string. The anchor is written
 * WHOLE and never in the short form the reads print, because a short form only means
 * something against the record it was shortened in, and this file is leaving.
 *
 * The anchor comes from the LAST transition, which is the act that put the pattern in
 * the state it is being exported in — by construction, not by matching a word: the
 * projection reads state off the last transition's `to`, so the last transition IS the
 * adoption of an adopted pattern. It is read through the copilot's `timeline`, the
 * reading that already answers "what happened to this entity", rather than through a
 * second walk of the same index.
 *
 * It does NOT refuse outside a project, for `skills`' reason and not for a new one: a
 * pattern is a CAPABILITY, and the machine-global tree holds a person's own
 * conventions, which are a legitimate thing to export from anywhere.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Disposition,
  readRecord,
  type ScopedCache,
  skillDisposition,
  timeline,
} from '@mnema/copilot';
import { type DiscoveryEnv, isSkillState, resolveTrees } from '@mnema/core';
import {
  agentSkillFile,
  derivedDescription,
  SKILL_FILE,
  specDescription,
  specName,
} from '../agent-skill.js';
import { oneLine } from '../one-line.js';
import { withScopedCaches } from '../tree-sources.js';

/**
 * Whether a pattern in each disposition leaves the record as a file — the ONE place
 * that decision is written.
 *
 * A table and not a predicate for the reason the copilot's `BODY_SERVED` is one: a
 * fourth disposition does not compile until it has an answer here, where a condition
 * naming the one it exports would silently refuse a disposition it had never heard of.
 * The two tables differ in exactly one row (`awaiting-judgement`), which is the whole
 * difference between serving a body to whoever must judge it and publishing it as how
 * the work is done.
 */
const EXPORTED: Readonly<Record<Disposition, boolean>> = {
  'in-force': true,
  'awaiting-judgement': false,
  closed: false,
};

/** The `metadata` key carrying the id the record knows this pattern by. */
const ID_KEY = 'mnema-id';

/** The `metadata` key carrying the identity that put the pattern in force. */
const ADOPTED_BY_KEY = 'mnema-adopted-by';

/** Which of the two rules produced the `description` in the file. */
export type DescriptionSource =
  /** The caller's own `--description`. */
  | 'the caller'
  /** The mechanical cut of the body (`derivedDescription`). */
  | 'the body';

/** What the export needs — injected so it is testable. */
export interface SkillExportContext {
  /** The working directory to resolve the trees from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** What the caller asked for: which pattern, where it goes, and what it says. */
export interface SkillExportInput {
  /** The skill id — the value shown when it was proposed. */
  readonly id: string;
  /**
   * The directory the `<name>/` directory is created in — REQUIRED here, with no
   * default of its own.
   *
   * The default belongs to the surface and is declared there (`wiring/skill.ts`), where
   * commander prints it in the `--help` a caller reads. An adapter carrying a second one
   * would be a second answer to "where does a skill go", and the one that ran would
   * depend on which caller forgot to pass it.
   */
  readonly out: string;
  /** The caller's own description; absent, it is derived from the body. */
  readonly description?: string;
}

/** The file that was written, and everything the caller cannot see inside it. */
export interface SkillExportDone {
  readonly ok: true;
  /** The file, absolute or relative exactly as the caller's `--out` was. */
  readonly path: string;
  /** The `name` in the frontmatter, which is also the directory's name. */
  readonly name: string;
  /** The `description` written — one line, within the specification's ceiling. */
  readonly description: string;
  /** Which rule produced it, so the surface can say so. */
  readonly descriptionFrom: DescriptionSource;
  /** The id in `metadata`, which is the id of this skill. */
  readonly id: string;
  /** The identity in `metadata`, WHOLE — the anchor that put the pattern in force. */
  readonly adoptedBy: string;
}

/** Nothing was written: the pattern, the name or the description did not qualify. */
export type SkillExportRefused =
  /** No visible tree holds a skill with this id (the surface words this one). */
  | { readonly ok: false; readonly reason: 'UNKNOWN_SKILL' }
  /** Its state does not export, and the message names the state. */
  | { readonly ok: false; readonly reason: 'NOT_EXPORTED'; readonly message: string }
  /** Its recorded name is not a name of the specification, and the message says why. */
  | { readonly ok: false; readonly reason: 'NOT_A_SPEC_NAME'; readonly message: string }
  /** Neither rule produced a description, so there is no field to route on. */
  | { readonly ok: false; readonly reason: 'NO_DESCRIPTION'; readonly message: string }
  /**
   * The record projects this pattern but this machine cannot read the act that put it
   * in force, so the provenance line cannot be written.
   *
   * It is NOT REACHABLE over a cache that projected the skill at all — the projection
   * needs a transition, and the reference index the history is read from holds the same
   * events — and it exists because the two are two indexes. A code path that assumed
   * they agree would be that assumption written as a non-null assertion, and this bench
   * has paid for one of those.
   */
  | { readonly ok: false; readonly reason: 'NO_ADOPTION_ACT'; readonly message: string };

/**
 * Writes the pattern `id` holds as `<out>/<name>/SKILL.md`, or refuses and writes
 * nothing.
 *
 * NOTHING REACHES THE DISK UNTIL EVERY CHECK HAS PASSED. The document is composed
 * whole first and the directory is created after it, so a refusal never leaves a
 * directory, an empty file or half a file behind — asserted from the outside in
 * `the-pattern-leaves-in-the-hosts-shape.test.ts`, which counts the files under `--out`
 * after each refusal.
 *
 * It writes in exactly one place, under exactly the directory the caller named. There
 * is no second destination, no host directory it knows about and no fallback: where a
 * skill goes is the operator's decision, and a verb that wrote somewhere else on their
 * behalf would be a verb that put an instruction into an agent's prompt without being
 * asked.
 */
export function runSkillExport(
  ctx: SkillExportContext,
  input: SkillExportInput,
): SkillExportDone | SkillExportRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const composed = withScopedCaches(trees, (sources) => {
    const held = readRecord(sources, input.id);
    if (held === null || held.kind !== 'skill') {
      return { ok: false, reason: 'UNKNOWN_SKILL' } as const;
    }
    const skill = held.record;

    const leaves = isSkillState(skill.state) && EXPORTED[skillDisposition(skill.state)];
    if (!leaves) return notExported(skill.state);

    const name = specName(skill.name);
    if (!name.ok) {
      return {
        ok: false,
        reason: 'NOT_A_SPEC_NAME',
        message:
          `the recorded name "${oneLine(skill.name)}" is not a name the skills ` +
          `specification takes, because ${name.why}. A name may hold only a-z, 0-9 and ` +
          'hyphens, may not begin or end with one and may not hold two in a row — and it ' +
          'has to be the name of the directory the file goes in, or the host ignores the ' +
          'file without saying why. Nothing here rewrites it into one: the name is the ' +
          'key, and a key nobody recorded is not this pattern',
      } as const;
    }

    const given = input.description;
    const description =
      given === undefined ? derivedDescription(skill.body) : specDescription(given);
    if (description === undefined) return noDescription(given !== undefined);

    // The act that put the pattern where it is — the last transition, which is the one
    // the projection read its state from.
    const put = putInForce(sources, input.id);
    if (put === undefined) {
      return {
        ok: false,
        reason: 'NO_ADOPTION_ACT',
        message:
          `the record projects ${input.id} as a pattern in force, and this machine cannot ` +
          'read the act that put it there — so the file cannot say who adopted it. Run ' +
          '`mnema verify` on this project: a history that disagrees with a projection is a ' +
          'finding about the record, not about this export',
      } as const;
    }

    return {
      ok: true,
      name: skill.name,
      description,
      descriptionFrom: given === undefined ? ('the body' as const) : ('the caller' as const),
      id: skill.id,
      adoptedBy: put,
      document: agentSkillFile(
        {
          name: skill.name,
          description,
          metadata: [
            [ID_KEY, skill.id],
            [ADOPTED_BY_KEY, put],
          ],
        },
        skill.body,
      ),
    } as const;
  });
  if (!composed.ok) return composed;

  const { document, ...done } = composed;
  const directory = join(input.out, done.name);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, SKILL_FILE);
  writeFileSync(path, document);
  return { ...done, path };
}

/** The refusal a state that does not export earns, with the state said out loud. */
function notExported(state: string): SkillExportRefused {
  const said = oneLine(state);
  return {
    ok: false,
    reason: 'NOT_EXPORTED',
    message: isSkillState(state)
      ? `this pattern is ${said}, and only an adopted one is exported. A pattern a host ` +
        'reads is used as how the work is done here: published before the project ruled ' +
        'on it, it skips the review this record exists to hold, and published after the ' +
        'project retired it, it looks exactly like a live one. There is no flag that ' +
        `overrides this — adopt the pattern (\`mnema skill move adopt <id>\`) and export ` +
        'the adoption'
      : `this pattern is recorded in a state this product cannot classify (${said}), so ` +
        'nothing here can say whether it is how the work is done. Run `mnema verify` on ' +
        'this project',
  };
}

/** The refusal an unusable description earns, worded for whichever rule produced it. */
function noDescription(fromTheCaller: boolean): SkillExportRefused {
  return {
    ok: false,
    reason: 'NO_DESCRIPTION',
    message: fromTheCaller
      ? 'the --description you gave holds no text. It is the field the host chooses the ' +
        'skill by, with nobody calling anything, so an empty one is a skill that is never ' +
        'chosen and a file that says less than the record does'
      : 'the description is derived from the first sentence of the body, and this body has ' +
        'no text in it to cut one from. It is the field the host chooses the skill by, so ' +
        'nothing here invents one — pass --description with what this pattern is for and ' +
        'when to use it',
  };
}

/**
 * The identity that put this pattern in the state it is in: the `who` of its LAST
 * transition, or `undefined` when the history holds none.
 *
 * It reads the copilot's `timeline`, whose entries come back in the union's proven
 * order — so the last transition in the list is the last transition there was, and
 * nothing here re-sorts by `at`, which would move a fact whenever a clock stepped back.
 */
function putInForce(sources: readonly ScopedCache[], id: string): string | undefined {
  let anchor: string | undefined;
  for (const entry of timeline(sources, id)) {
    if (entry.kind === 'skill.transitioned' && entry.subject === id) anchor = entry.who;
  }
  return anchor;
}
