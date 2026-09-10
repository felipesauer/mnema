/**
 * What a move SAID reaches the person and the index, not only a flag.
 *
 * A transition carries `fields` — `note`, `reason`, `feedback`, and the locators beside
 * them — and they are the words somebody wrote to justify the move. They enter the
 * signed chain. MEASURED on the built binary, before any of this existed, over a task
 * completed with `--note "ZEBRAMARKER …"`:
 *
 *     mnema timeline <id> --json   -> payload.fields.note, verbatim
 *     mnema timeline <id>          -> four event lines, no note
 *     mnema show <id>              -> title, state, two instants, no note
 *     mnema search ZEBRAMARKER     -> "Nothing recorded matching …"
 *
 * A fact in the chain that only a flag can reach is a fact written for a flag — and for
 * a TASK it is worse than that: the prose of its moves is the only body a task will ever
 * have, so the index held a record with nothing in it to find.
 *
 * WHAT EACH CASE IS FOR:
 *   - the three surfaces, over one marker nothing else in the record contains, so a hit
 *     cannot come from the title.
 *   - THE CONTRAST, in the same shapes: a move that said nothing adds no line, no
 *     heading and no blank section — the absence has to survive, or "it prints the
 *     proof" would be indistinguishable from "it prints a heading over nothing".
 *   - EVERY MOVE AND NOT THE LAST. A task completed, reopened with a reason and
 *     completed again holds three pieces of prose and the record holds all three. A
 *     projection carrying only the newest would leave the earlier two findable by
 *     nothing, which is a partial answer that reads as a whole one.
 *   - ALL THREE STATE MACHINES. The rule is one function called from three folds; a
 *     case per machine is what fails if one of them is missed.
 *
 * WHAT IS NOT HERE: the reading of `fields` itself — every field of the catalog, the
 * order, and the three ways of saying nothing — is asserted beside the function that
 * does it, in `chain/src/events/proof.test.ts`. This file is about the three SURFACES.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transitionProse } from '@mnema/chain';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from '../src/commands/decision.js';
import { runDecisionTransition } from '../src/commands/decision-transition.js';
import { runInit } from '../src/commands/init.js';
import { runSearch } from '../src/commands/search.js';
import { runShow } from '../src/commands/show.js';
import { runSkill } from '../src/commands/skill.js';
import { runSkillTransition } from '../src/commands/skill-transition.js';
import { runTask } from '../src/commands/task.js';
import { runTaskTransition } from '../src/commands/task-transition.js';
import { runTimeline } from '../src/commands/timeline.js';
import { renderPlain } from '../src/presentation/plain.js';
import { recordReport } from '../src/presentation/record.js';

/** A word no title, body or rationale in this fixture contains. */
const MARKER = 'ZEBRAMARKER';

let sandbox: string;
let env: DiscoveryEnv;
let repo: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-moves-'));
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'xdg') };
  mkdirSync(env.home, { recursive: true });
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  runInit({ cwd: repo, env });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** The context every runner here takes. */
const ctx = (): { cwd: string; env: DiscoveryEnv } => ({ cwd: repo, env });

/** A task, born. */
function task(title: string): string {
  const made = runTask(ctx(), { title });
  if (!made.ok) throw new Error(`task refused: ${made.reason}`);
  return made.id;
}

/** One move of a task, with whatever proof it carries. */
function move(id: string, action: string, proof?: Record<string, string>): void {
  const done = runTaskTransition(ctx(), { id, action, ...(proof !== undefined ? { proof } : {}) });
  if (!done.ok) throw new Error(`${action} refused: ${done.reason}`);
}

/** The lines `mnema show` prints for a record. */
function shown(id: string): string[] {
  const result = runShow(ctx(), { id });
  if (!result.ok) throw new Error(`show refused: ${result.reason}`);
  return recordReport(renderPlain, result.record, {
    anchors: result.anchors,
    ...(result.consultations !== undefined ? { consultations: result.consultations } : {}),
  });
}

/** The prose the human timeline would print, one entry at a time. */
function timelineProse(id: string): string[] {
  const result = runTimeline(ctx(), { id });
  if (!result.ok) throw new Error(`timeline refused: ${result.reason}`);
  return result.entries
    .map((entry) => transitionProse(proofOfEntry(entry)))
    .filter((said) => said !== '');
}

/** The fields of one timeline entry's event, read the way the surface reads them. */
function proofOfEntry(entry: { event: unknown }): undefined | Record<string, unknown> {
  const payload = (entry.event as { payload?: { fields?: Record<string, unknown> } }).payload;
  return payload?.fields;
}

/** The ids `mnema search <term>` returns. */
function found(term: string): string[] {
  const result = runSearch(ctx(), { term });
  if (!result.ok) throw new Error(`search refused: ${result.reason}`);
  return result.result.hits.map((hit) => hit.id);
}

describe('what a move said reaches the person and the index', () => {
  it('is served by show, by timeline and by search', () => {
    const id = task('Wire the retry budget');
    move(id, 'submit');
    move(id, 'start');
    move(id, 'complete', { note: `${MARKER} the retry budget is capped at four attempts` });

    // 1 · `show`, as a headed body under the facts.
    const lines = shown(id);
    expect(lines).toContain('What each move said:');
    expect(lines.join('\n')).toContain(`note: ${MARKER} the retry budget is capped at four`);
    // 2 · `timeline`, as an annotation on the move that said it.
    expect(timelineProse(id)).toEqual([
      `note: ${MARKER} the retry budget is capped at four attempts`,
    ]);
    // 3 · `search`, by the words themselves — the read that had nothing at all.
    expect(found(MARKER)).toEqual([id]);
  });

  it('says nothing at all when no move said anything', () => {
    // THE CONTRAST. A heading over an empty section, or a blank line with nothing
    // under it, would pass every assertion above.
    const id = task('Wire the retry budget');
    move(id, 'submit');
    move(id, 'start');

    const lines = shown(id);
    expect(lines).not.toContain('What each move said:');
    expect(lines).not.toContain('');
    expect(timelineProse(id)).toEqual([]);
    expect(found(MARKER)).toEqual([]);
  });

  it('carries every move that said something, not the newest one', () => {
    const id = task('Wire the retry budget');
    move(id, 'submit');
    move(id, 'start');
    move(id, 'complete', { note: `${MARKER}-one capped at four` });
    move(id, 'reopen', { reason: `${MARKER}-two the cap was wrong` });
    move(id, 'complete', { note: `${MARKER}-three capped at eight` });

    const whole = shown(id).join('\n');
    expect(whole).toContain(`${MARKER}-one`);
    expect(whole).toContain(`${MARKER}-two`);
    expect(whole).toContain(`${MARKER}-three`);
    // In the chain's own order, and each named by the move that said it.
    expect(shown(id).filter((line) => line.startsWith('complete ·')).length).toBe(2);
    expect(shown(id).filter((line) => line.startsWith('reopen ·')).length).toBe(1);
    // And all three are findable — the half a "latest only" projection would lose.
    expect(found(`${MARKER}-one`)).toEqual([id]);
    expect(found(`${MARKER}-two`)).toEqual([id]);
    expect(found(`${MARKER}-three`)).toEqual([id]);
  });

  it('holds for a decision’s moves', () => {
    const made = runDecision(ctx(), {
      title: 'Cap the retries',
      rationale: 'Because the broker is at-least-once.',
    });
    if (!made.ok) throw new Error(`decision refused: ${made.reason}`);
    const done = runDecisionTransition(ctx(), {
      id: made.id,
      action: 'accept',
      proof: { note: `${MARKER} accepted after the incident review` },
    });
    if (!done.ok) throw new Error(`accept refused: ${done.reason}`);

    expect(shown(made.id).join('\n')).toContain(`note: ${MARKER} accepted after the incident`);
    expect(found(MARKER)).toEqual([made.id]);
  });

  it('holds for a pattern’s moves', () => {
    const made = runSkill(ctx(), { name: 'Retry with a budget', body: 'Cap it. Log it.' });
    if (!made.ok) throw new Error(`skill refused: ${made.reason}`);
    const done = runSkillTransition(ctx(), {
      id: made.id,
      action: 'review',
      // The gate requires `note` on this move, and the test carries what the gate
      // asks for rather than a field of its own choosing: a fixture that wrote a
      // value the product refuses would pass over a world that cannot exist.
      proof: { note: `${MARKER} needs a number for the cap` },
    });
    if (!done.ok) throw new Error(`review refused: ${done.reason}`);

    expect(shown(made.id).join('\n')).toContain(`note: ${MARKER} needs a number for the cap`);
    expect(found(MARKER)).toEqual([made.id]);
  });
});
