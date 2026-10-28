/**
 * `promote` of a decision, when another session promoted the same pattern between the moment
 * this one was judged and the moment it wrote. The global tree then holds the decision already:
 * the write answers that it did, and the promotion must not report a new birth nor draw
 * `derived-from` edges from the instances to a decision they did not give rise to.
 *
 * The other session is let in right before this one's write (the stale reading the concurrency
 * produces, as `core/src/workflow/the-second-move-sees-the-first.test.ts` stages it).
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents, projectDecisions, projectLinks, resolveTrees } from '@mnema/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runPromote } from '../src/commands/promote.js';
import { discoveryEnv } from '../src/env.js';
import { renderPlain } from '../src/presentation/plain.js';
import { promotionDone } from '../src/presentation/promoted.js';
import { type CliIo, run } from '../src/program.js';

const race = vi.hoisted(() => ({ other: undefined as (() => void) | undefined }));

vi.mock('../src/commands/decision.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/commands/decision.js')>();
  return {
    ...real,
    runDecision: ((...args: Parameters<typeof real.runDecision>) => {
      const other = race.other;
      race.other = undefined;
      other?.();
      return real.runDecision(...args);
    }) as typeof real.runDecision,
  };
});

const before = { cwd: process.cwd(), env: { ...process.env } };
let sandbox: string;
let a: string;
let b: string;

async function mnema(...argv: string[]): Promise<string> {
  const out: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => out.push(l), fail: () => undefined };
  await run(argv, io);
  return out.join('\n');
}

async function accepted(dir: string): Promise<string> {
  process.chdir(dir);
  const made = await mnema(
    'decision',
    'record',
    'Keep parsers small',
    'Small ones are read whole.',
  );
  const id = /\(([0-9a-f-]{36})\)/.exec(made)?.[1] as string;
  await mnema('decision', 'move', 'accept', id, '--note', 'agreed');
  return id;
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-promote-twin-'));
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  a = join(sandbox, 'a');
  b = join(sandbox, 'b');
  for (const dir of [a, b]) mkdirSync(dir, { recursive: true });
});

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('promoting a decision the global tree came to hold meanwhile', () => {
  it('names the one that is there, writes nothing, and draws no edge to it', async () => {
    for (const dir of [a, b]) {
      process.chdir(dir);
      await mnema('init');
    }
    const idA = await accepted(a);
    const idB = await accepted(b);
    const ctx = { cwd: b, env: discoveryEnv() };
    const input = { id: idB, evidence: [`${a}:${idA}`] };
    const global = () => {
      const root = resolveTrees(b, discoveryEnv()).global;
      const events = [...orderedEvents({ root }, catalogUpcasters())];
      return {
        events: events.length,
        decisions: projectDecisions(events),
        links: projectLinks(events),
      };
    };

    let theOther: ReturnType<typeof runPromote> | undefined;
    let eventsAfterTheOther = 0;
    race.other = () => {
      theOther = runPromote(ctx, input);
      eventsAfterTheOther = global().events;
    };
    const second = runPromote(ctx, input);

    expect(theOther).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true, kind: 'decision', alreadyRecorded: true });
    if (!second.ok || !theOther?.ok) return;
    expect(second.id).toBe(theOther.id);
    const said = promotionDone(renderPlain, second).join('\n');
    expect(said).toContain(`already holds decision "Keep parsers small" (${second.id})`);
    expect(said).not.toContain('Promoted');
    expect(global().decisions.size).toBe(1);
    // The other session's two edges, and none from this one: the projection dedupes a repeated
    // edge, so what is counted is the events.
    expect(global().links).toHaveLength(2);
    expect(global().events).toBe(eventsAfterTheOther);
  });
});
