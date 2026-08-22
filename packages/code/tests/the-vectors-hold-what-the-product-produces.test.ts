/**
 * The frozen vectors hold values THIS PRODUCT can produce.
 *
 * WHY IT IS HERE AND NOT BESIDE THEM. `canonical-vectors.json` freezes the bytes
 * of one event per catalog kind, and freezing is forever: a vector carrying a
 * state no workflow allows, or a channel this product does not have, would leave
 * the suite green over a world that cannot exist, and the digest would still be
 * "right". The reader in `@mnema/chain` answers the half it can — the shape, the
 * required fields, a count of at least one — and it CANNOT answer the rest,
 * because the proof engine deliberately knows nothing about workflows, channels
 * or minted ids. Those vocabularies live in `@mnema/core` and in this package, so
 * the guard that reads them lives here, at the one point that can see all three.
 *
 * IT READS THE PUBLISHED FILE, not the module that builds it — the same artifact a
 * stranger downloads. A vector that changed only in the file is caught next door
 * (`packages/chain/src/events/canonical-vectors.test.ts`); what is caught here is a
 * vector whose values no operation of this product could ever have written, on
 * whichever side it was introduced.
 *
 * TWO EXCEPTIONS, BOTH FROZEN, BOTH NAMED RATHER THAN SKIPPED. The oldest vectors
 * predate this product's own vocabulary twice over:
 *   - their subjects are `t-1`, `t-2`, `d-1`, `r-1`, where every operation mints a
 *     uuid v7;
 *   - two `task.transitioned` rows move a task `todo --finish--> done`, and the
 *     task workflow has no such state and no such action (its states are upper
 *     case, `DRAFT` through `CANCELED`). The catalog permits it — a transition's
 *     `from`/`to`/`action` are open literal strings so a fact outlives a workflow
 *     change — so the bytes are valid bytes; they are simply not an example of a
 *     fact anything here could write.
 * Their digests are frozen, so correcting them would move the format under a
 * signature nobody decided to move. Both exceptions are enumerated below, closed,
 * and a NEW vector taking the same liberty reddens.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RECOMMENDED_LINK_RELATIONS } from '@mnema/chain';
import {
  DECISION_TRANSITIONS,
  isDecisionState,
  isSkillState,
  isTaskState,
  mintedIdsIn,
  SKILL_TRANSITIONS,
  TRANSITIONS,
} from '@mnema/core';
import { describe, expect, it } from 'vitest';
import { SWITCHABLE_CHANNELS } from '../src/record-framing.js';

const ARTIFACT = new URL('../../chain/canonical-vectors.json', import.meta.url);

interface Row {
  readonly name: string;
  readonly kind: string;
  readonly event: {
    readonly subject: string;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}

const rows = (
  JSON.parse(readFileSync(fileURLToPath(ARTIFACT), 'utf-8')) as { vectors: readonly Row[] }
).vectors;

/**
 * The subjects the vectors predating id minting carry. Named one by one, so a new
 * vector inventing a fourth placeholder is a failure and not a precedent.
 */
const SUBJECTS_NO_OPERATION_MINTS = new Set(['t-1', 't-2', 'd-1', 'r-1']);

/**
 * The frozen vectors whose transition no workflow of this product allows. Named
 * one by one for the same reason: `task.transitioned (a move the task workflow
 * allows)` is the row that carries a real move, so nothing needs a third
 * exception, and adding one has to be a deliberate edit here.
 */
const MOVES_NO_WORKFLOW_ALLOWS = new Set([
  'task.transitioned (birth, from: null)',
  'task.transitioned (with proof fields)',
]);

/** Every string value in an event, as `path → value`, one level into the payload. */
function stringsOf(row: Row): ReadonlyArray<readonly [string, string]> {
  const out: Array<readonly [string, string]> = [['subject', row.event.subject]];
  for (const [key, value] of Object.entries(row.event.payload)) {
    if (typeof value === 'string') out.push([`payload.${key}`, value]);
  }
  return out;
}

describe('the published vectors carry only values this product can produce', () => {
  it('has rows to check at all', () => {
    // NON-VACUITY, first: every case below walks `rows`, so an artifact that
    // failed to load would pass all of them by iterating nothing.
    expect(rows.length).toBeGreaterThan(0);
  });

  it('moves each workflow entity by a transition its own workflow allows', () => {
    const workflows = {
      'task.transitioned': { legal: TRANSITIONS, isState: isTaskState },
      'decision.transitioned': { legal: DECISION_TRANSITIONS, isState: isDecisionState },
      'skill.transitioned': { legal: SKILL_TRANSITIONS, isState: isSkillState },
    } as const;
    const offenders: string[] = [];
    let checked = 0;
    for (const row of rows) {
      const workflow = workflows[row.kind as keyof typeof workflows];
      if (workflow === undefined) continue;
      if (MOVES_NO_WORKFLOW_ALLOWS.has(row.name)) continue;
      checked += 1;
      const { from, to, action } = row.event.payload as {
        from: string | null;
        to: string;
        action: string;
      };
      // A birth carries `from: null` and is the one move no table row describes:
      // what it has to be is a real state of that workflow, reached by the birth
      // action every entity of this product is born through.
      if (from === null) {
        if (!workflow.isState(to) || action !== 'create') {
          offenders.push(`${row.name}: birth to "${to}" by "${action}"`);
        }
        continue;
      }
      const legal = workflow.legal.some(
        (move) => move.from === from && move.action === action && move.to === to,
      );
      if (!legal) offenders.push(`${row.name}: ${from} --${action}--> ${to}`);
    }
    expect(offenders, 'a vector freezes a move no workflow allows').toEqual([]);
    // One vector per transitioned kind at least, or the walk above proved nothing.
    expect(checked).toBeGreaterThanOrEqual(Object.keys(workflows).length);
  });

  it('names, in every channel fact, a channel this product actually has', () => {
    const channels = rows.filter((row) => row.kind.startsWith('channel.'));
    expect(channels.length).toBeGreaterThan(0);
    const offenders = channels
      .filter((row) => !(SWITCHABLE_CHANNELS as readonly string[]).includes(row.event.subject))
      .map((row) => `${row.name}: "${row.event.subject}"`);
    expect(offenders, 'a vector names a channel that does not exist').toEqual([]);
  });

  it('labels a link with a relation this product recommends', () => {
    // `rel` is an OPEN string and a reader accepts any of them — that is the
    // catalog's design and this case does not narrow it. What it holds is the
    // FIXTURE: a frozen vector is the example an implementer copies, so it uses a
    // label the product itself suggests rather than an invented one.
    const links = rows.filter((row) => row.kind === 'knowledge.linked');
    expect(links.length).toBeGreaterThan(0);
    const offenders = links
      .filter(
        (row) =>
          !(RECOMMENDED_LINK_RELATIONS as readonly string[]).includes(
            row.event.payload.rel as string,
          ),
      )
      .map((row) => `${row.name}: "${String(row.event.payload.rel)}"`);
    expect(offenders).toEqual([]);
  });

  it('writes every id-shaped value the way this product mints one', () => {
    // The recognizer is the product's own, derived from the generator's bit
    // arithmetic rather than parallel to it. A value that LOOKS like a uuid but
    // carries the wrong version or variant nibble would be a fixture nothing could
    // have produced, and it would pass every shape check the reader makes.
    const offenders: string[] = [];
    let recognized = 0;
    for (const row of rows) {
      for (const [path, value] of stringsOf(row)) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) continue;
        const found = mintedIdsIn(value);
        if (found.length === 1 && found[0]?.id === value) recognized += 1;
        else offenders.push(`${row.name} ${path}: "${value}"`);
      }
    }
    expect(offenders, 'a vector holds a uuid this product could not mint').toEqual([]);
    expect(recognized).toBeGreaterThan(0);
  });

  it('invents no new placeholder subject beside the ones minting predates', () => {
    const offenders: string[] = [];
    for (const row of rows) {
      const subject = row.event.subject;
      if (SUBJECTS_NO_OPERATION_MINTS.has(subject)) continue;
      // What is left must be something an operation produces: an anchor id, a
      // minted id, or a channel name. Anything else is a placeholder somebody
      // added after the exceptions were closed.
      const produced =
        subject.startsWith('mnid:') ||
        mintedIdsIn(subject).length === 1 ||
        (SWITCHABLE_CHANNELS as readonly string[]).includes(subject);
      if (!produced) offenders.push(`${row.name}: "${subject}"`);
    }
    expect(offenders, 'a vector carries a subject no operation of this product mints').toEqual([]);
  });
});
