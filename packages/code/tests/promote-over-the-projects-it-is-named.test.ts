/**
 * `promote`, driven in this process over projects it is NAMED: what the listing returns and
 * says, what a write returns and says, what the verb declares about itself, and the one place
 * a project with no record is spoken of. The binary-level cases (the privacy boundary, the
 * refusals that leave the global tree untouched) are in `promoting-what-recurs.test.ts`.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runPromote, runPromoteList } from '../src/commands/promote.js';
import { discoveryEnv } from '../src/env.js';
import { renderPlain } from '../src/presentation/plain.js';
import { promotionCandidates, promotionDone } from '../src/presentation/promoted.js';
import { registerPromote } from '../src/wiring/promote.js';
import type { Wiring } from '../src/wiring/verb.js';

const before = { cwd: process.cwd(), env: { ...process.env } };
const BODY = 'Run the whole suite before every push.';

let sandbox: string;
let a: string;
let b: string;
let loose: string;
let idA: string;
let idB: string;

async function mnema(...argv: string[]): Promise<string> {
  const out: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => out.push(l), fail: () => undefined };
  await run(argv, io);
  return out.join('\n');
}

async function adopted(dir: string): Promise<string> {
  process.chdir(dir);
  const made = await mnema('skill', 'create', 'Run the suite', '--body', BODY);
  const id = /\(([0-9a-f-]{36})\)/.exec(made)?.[1] as string;
  await mnema('skill', 'move', 'review', id, '--note', 'read');
  await mnema('skill', 'move', 'adopt', id, '--note', 'good');
  return id;
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-promote-in-process-'));
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  a = join(sandbox, 'a');
  b = join(sandbox, 'b');
  loose = join(sandbox, 'loose');
  for (const dir of [a, b, loose]) mkdirSync(dir, { recursive: true });
  for (const dir of [a, b]) {
    process.chdir(dir);
    await mnema('init');
  }
  idA = await adopted(a);
  idB = await adopted(b);
}, 120_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the listing', () => {
  it('names where the pattern is in force, counts the projects, and says what holds no record', () => {
    process.chdir(b);
    const listed = runPromoteList({ cwd: b, env: discoveryEnv() }, { named: [a, b, loose] });
    expect(listed.projects).toBe(2);
    expect(listed.withoutRecord).toEqual([loose]);
    expect(listed.candidates).toHaveLength(1);
    expect(listed.candidates[0]?.instances.map((i) => i.id).sort()).toEqual([idA, idB].sort());

    const said = promotionCandidates(renderPlain, listed).join('\n');
    expect(said).toContain('skill "Run the suite" — in force in 2 projects');
    expect(said).toContain(`${a}  ${idA}`);
    expect(said).toContain(`${loose} holds no record; it was left out.`);
  });

  it('says that nothing recurs when it does not, in the number of projects it read', () => {
    const listed = runPromoteList({ cwd: b, env: discoveryEnv() }, { named: [b] });
    expect(promotionCandidates(renderPlain, listed).join('\n')).toContain(
      'Nothing recurs, with the same words and in force, in the committed record of 1 project.',
    );
  });
});

describe('the write, and what the verb declares', () => {
  it('refuses outside a project, and copies what the listing showed, telling how to adopt it', () => {
    const ctx = { cwd: loose, env: discoveryEnv() };
    expect(runPromote(ctx, { id: idB, evidence: [`${a}:${idA}`] })).toEqual({
      ok: false,
      reason: 'NO_PROJECT',
    });

    const done = runPromote(
      { cwd: b, env: discoveryEnv() },
      { id: idB, evidence: [`${a}:${idA}`] },
    );
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.scope).toBe('global');
    expect(done.derivedFrom.map((from) => from.id)).toEqual([idB, idA]);
    const said = promotionDone(renderPlain, done).join('\n');
    expect(said).toContain(`Promoted skill "Run the suite" (${done.id})`);
    expect(said).toContain(`mnema skill move review ${done.id}`);
  });

  it('is declared a write, because one of its two acts is', () => {
    const wiring: Wiring = {
      io: { out: () => undefined, err: () => undefined, fail: () => undefined },
      render: renderPlain,
      renderingAt: () => renderPlain,
      pinnedRun: () => undefined,
    };
    const declared = registerPromote(new Command(), wiring);
    expect(declared.effect).toBe('mutates');
    expect(declared.act.name()).toBe('promote');
  });
});
