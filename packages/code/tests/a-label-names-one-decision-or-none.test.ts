/**
 * AN `ADR-<n>` TYPED WHERE AN ID GOES NAMES ONE DECISION OR IT NAMES NONE — in every verb.
 *
 * `decision move accept ADR-1` refused the label while `link ADR-1 src/gen --rel refuses-a-write`
 * accepted it, exit 0, and recorded the text "ADR-1" as the subject of an edge that pointed at
 * nothing. The rule now lives in one function (`label-as-address.ts`) and a link's target must
 * resolve (`link-target.ts`); these cases drive the verbs themselves and read the record back.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectLinks, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecision } from '../src/commands/decision.js';
import { runDecisionTransition } from '../src/commands/decision-transition.js';
import { runInit } from '../src/commands/init.js';
import { runLink } from '../src/commands/link.js';
import { resolveLabel } from '../src/label-as-address.js';
import { isLabelShaped, linkRefusal } from '../src/link-target.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-label-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src/gen'), { recursive: true });
  env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Records a decision and returns its id. */
function decide(title: string, scope?: 'public' | 'private'): string {
  const recorded = runDecision(
    { cwd: repo, env },
    { title, rationale: 'because', ...(scope !== undefined ? { scope } : {}) },
  );
  if (!recorded.ok) throw new Error('setup: decision refused');
  return recorded.id;
}

/** Every link edge in the project's public tree. */
function edges() {
  const root = resolveTrees(repo, env).projectPublic as string;
  return projectLinks(orderedEvents({ root }, catalogUpcasters()));
}

describe('a label that names exactly one decision', () => {
  it('moves it', () => {
    const id = decide('Use UTC');
    const moved = runDecisionTransition(
      { cwd: repo, env },
      { id: 'ADR-1', action: 'accept', proof: { note: 'agreed' } },
    );
    expect(moved).toMatchObject({ ok: true, id, adr: 'ADR-1', to: 'accepted' });
  });

  it('is recorded in a link as the decision’s id, never as the label', () => {
    const id = decide('Use UTC');
    const linked = runLink(
      { cwd: repo, env },
      { subject: 'ADR-1', target: 'src/gen', rel: 'refuses-a-write' },
    );
    expect(linked).toMatchObject({ ok: true, subject: id, target: 'src/gen' });
    expect(edges()).toEqual([
      expect.objectContaining({ subject: id, target: 'src/gen', rel: 'refuses-a-write' }),
    ]);
  });

  it('is recorded as the id when it is the target too', () => {
    const id = decide('Use UTC');
    const other = decide('Use ISO');
    const linked = runLink(
      { cwd: repo, env },
      { subject: other, target: 'adr-1', rel: 'relates-to' },
    );
    expect(linked).toMatchObject({ ok: true, subject: other, target: id });
    expect(edges().map((edge) => edge.target)).toEqual([id]);
  });
});

describe('a label two trees both carry', () => {
  it('is refused by the move and by the link, with both ids, and nothing is written', () => {
    const publicId = decide('Use UTC');
    const privateId = decide('Use ISO', 'private');
    const ids = [publicId, privateId].sort().join(', ');

    const moved = runDecisionTransition(
      { cwd: repo, env },
      { id: 'ADR-1', action: 'accept', proof: { note: 'agreed' } },
    );
    expect(moved).toMatchObject({ ok: false, reason: 'REFUSED', code: 'AMBIGUOUS_LABEL' });
    if (moved.ok || moved.reason !== 'REFUSED') throw new Error('expected a refusal');
    expect(moved.message).toContain(ids);

    const linked = runLink(
      { cwd: repo, env },
      { subject: 'ADR-1', target: 'src/gen', rel: 'refuses-a-write' },
    );
    expect(linked).toMatchObject({ ok: false, reason: 'REFUSED', code: 'AMBIGUOUS_LABEL' });
    if (linked.ok || linked.reason !== 'REFUSED') throw new Error('expected a refusal');
    expect(linked.message).toContain(ids);
    expect(edges()).toEqual([]);
  });

  it('lists the ids from the one function every door calls', () => {
    const resolved = resolveLabel('ADR-1', [
      { id: 'b', adr: 'ADR-1' },
      { id: 'a', adr: 'ADR-1' },
      { id: 'c', adr: 'ADR-2' },
    ]);
    expect(resolved).toMatchObject({ kind: 'many', ids: ['a', 'b'] });
  });
});

describe('a label no decision carries', () => {
  it('is refused by a link on either end, and nothing is recorded', () => {
    decide('Use UTC');
    for (const [subject, target] of [
      ['ADR-1', 'ADR-9'],
      ['ADR-9', 'src/gen'],
    ] as const) {
      const linked = runLink({ cwd: repo, env }, { subject, target, rel: 'refuses-a-write' });
      expect(linked, `${subject} ${target}`).toMatchObject({
        ok: false,
        reason: 'REFUSED',
        code: 'UNKNOWN_TARGET',
      });
    }
    expect(edges()).toEqual([]);
  });

  it('leaves every other end as it was typed: a link is legitimately cross-tree', () => {
    const id = decide('Use UTC');
    for (const target of ['src/gen', 'src/not-there-yet', 'an-id-this-clone-lacks']) {
      expect(
        runLink({ cwd: repo, env }, { subject: id, target, rel: 'relates-to' }).ok,
        target,
      ).toBe(true);
    }
  });

  it('is told by one function', () => {
    expect(isLabelShaped(' adr-3 ')).toBe(true);
    expect(isLabelShaped('ADR-3x')).toBe(false);
    expect(linkRefusal({ subject: 'x', target: 'ADR-3' })).toContain('"ADR-3" is a label');
    expect(linkRefusal({ subject: 'x', target: 'src/gen' })).toBe(undefined);
  });
});
