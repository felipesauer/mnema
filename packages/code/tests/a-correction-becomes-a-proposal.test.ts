/**
 * A correction becomes a proposal: with `user-corrections` switched on, the places where a person
 * corrected the agent are recorded, at `Stop`, as `proposed` decisions in the private tree — once
 * each, citing the line they came from.
 *
 * WHAT IS HELD HERE. The product's half: that nothing is read or recorded while the channel is off
 * (it starts off), that each opening the reader knows matches its probe and the ones that look like
 * it and are not do not, that a correction is recorded once however many times the transcript is
 * read, that what is recorded is a proposal in the tree that stays on this machine and the reply
 * carries none of the person's words, and that the plugin's command reaches the verb.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { MOST_PER_STOP, runCorrections } from '../src/commands/corrections.js';
import { renderPlain } from '../src/presentation/plain.js';
import { CORRECTION_SHAPES, correctionsIn } from '../src/user-corrections.js';
import { registerCorrections } from '../src/wiring/corrections.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const PLUGIN = join(REPO, 'plugin');

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

/** Runs `mnema <argv>` in process and refuses to continue if it failed — setup, not assertion. */
async function did(...argv: string[]): Promise<void> {
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: () => {},
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  expect(failed, `${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
}

/** What a person typed, on the `n`th line of a transcript. */
function typed(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    sessionId: 's-1',
    uuid: `u-${text.length}`,
    timestamp: '2026-10-01T10:00:00.000Z',
    origin: { kind: 'human' },
    message: { role: 'user', content: text },
    ...extra,
  });
}

/** An assistant line, so the transcript has something between the prompts. */
function assistant(): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: 's-1',
    message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
  });
}

/** Writes a transcript and answers its path. */
function transcript(lines: readonly string[]): string {
  const path = join(sandbox, 'session.jsonl');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

/** The payload a host hands a hook, naming a transcript. */
function payload(event: string, file: string): string {
  return JSON.stringify({ hook_event_name: event, transcript_path: file, cwd: repo });
}

/** What the verb answers, as the host parses it. */
function answer(input: string): { reply: Record<string, unknown>; notes: readonly string[] } {
  const done = runCorrections({ cwd: repo, env }, { payload: input });
  return {
    reply: JSON.parse(JSON.stringify(done.reply)) as Record<string, unknown>,
    notes: done.notes,
  };
}

/** The decisions recorded in one tree of the project. */
function decisionsIn(
  tree: 'projectPublic' | 'projectPrivate',
): Extract<CatalogEvent, { kind: 'decision.recorded' }>[] {
  const root = resolveTrees(repo, env)[tree];
  if (root === undefined) return [];
  return orderedEvents({ root }, catalogUpcasters()).filter(
    (event): event is Extract<CatalogEvent, { kind: 'decision.recorded' }> =>
      event.kind === 'decision.recorded',
  );
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-corrections-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the openings that correct', () => {
  /** One prompt per shape, in each language where the shape has one — the probe of every row. */
  const PROBES: Readonly<Record<string, readonly string[]>> = {
    'no, …': ['No, use pnpm here.', 'Não, o teste deve rodar antes.'],
    'stop …': ['Stop doing that in the controller.', 'Pare de mexer no lockfile.'],
    'do not …': ["Don't mock the database in these tests.", 'Nunca use var neste repositório.'],
    'that is wrong': [
      'That is wrong, the ledger is in UTC.',
      'Isso está errado, o prazo é em dias úteis.',
    ],
    'use … instead': [
      'Use the shared client instead of a new one.',
      'Use o cliente em vez de criar outro.',
    ],
  };

  it('has a probe for every shape it knows, and each matches its own shape', () => {
    expect(Object.keys(PROBES).sort()).toEqual(CORRECTION_SHAPES.map((one) => one.name).sort());
    for (const [shape, prompts] of Object.entries(PROBES)) {
      for (const prompt of prompts) {
        const found = correctionsIn([
          { line: 1, uuid: undefined, session: undefined, text: prompt },
        ]);
        expect(
          found.map((one) => one.shape),
          prompt,
        ).toEqual([shape]);
      }
    }
  });

  it('does not take for a correction what only looks like one', () => {
    for (const prompt of [
      'No problem, go ahead.',
      'Now add the tests.',
      'Thanks. And why was the build red?',
      'Podemos seguir? Não sei se está certo.',
      'Please write a note that says the old way was wrong.',
    ]) {
      expect(
        correctionsIn([{ line: 1, uuid: undefined, session: undefined, text: prompt }]),
        prompt,
      ).toEqual([]);
    }
  });

  it('reads the first sentence only, collapsed to one line', () => {
    const [found] = correctionsIn([
      {
        line: 4,
        uuid: 'u',
        session: 's',
        text: 'No,\n  use pnpm.   Then run the suite and report.',
      },
    ]);
    expect(found).toMatchObject({ line: 4, sentence: 'No, use pnpm.' });
  });
});

describe('mnema corrections', () => {
  const CORRECTED = [
    typed('Fix the build'),
    assistant(),
    typed('No, use pnpm instead of npm.'),
    assistant(),
  ];

  it('does nothing while the channel is off, which is how it starts', async () => {
    const file = transcript(CORRECTED);
    expect(answer(payload('Stop', file))).toEqual({ reply: {}, notes: [] });
    expect(decisionsIn('projectPrivate')).toHaveLength(0);
    expect(decisionsIn('projectPublic')).toHaveLength(0);
  });

  it('records each correction as a proposal in the private tree, once, citing its line', async () => {
    await did('switch', 'on', 'user-corrections');
    const file = transcript(CORRECTED);
    const first = answer(payload('Stop', file));
    expect(first.reply).toEqual({
      systemMessage:
        '1 correction the person made in this session was recorded as a proposed decision in this machine’s private tree: ADR-1.',
    });
    const [recorded] = decisionsIn('projectPrivate');
    expect(recorded?.payload.title).toBe('Correction: No, use pnpm instead of npm.');
    expect(recorded?.payload.rationale).toContain('“No, use pnpm instead of npm.”');
    expect(recorded?.payload.rationale).toContain('[host transcript, session s-1, line 3]');
    // The words stay on this machine: nothing reaches the tree a clone gets, and none of them is in
    // what is handed back to the host.
    expect(decisionsIn('projectPublic')).toHaveLength(0);
    expect(JSON.stringify(first.reply)).not.toContain('pnpm');
    // Read again, it is the same correction, and the same proposal.
    expect(answer(payload('Stop', file))).toEqual({ reply: {}, notes: [] });
    expect(decisionsIn('projectPrivate')).toHaveLength(1);
  });

  it('does not take line 1 for a line it has already recorded as line 12', async () => {
    await did('switch', 'on', 'user-corrections');
    const filler = Array.from({ length: 10 }, () => assistant());
    answer(
      payload(
        'Stop',
        transcript([typed('Fix it'), ...filler, typed('No, use pnpm instead of npm.')]),
      ),
    );
    expect(decisionsIn('projectPrivate')).toHaveLength(1);
    // Same session, a correction on line 1 of another transcript: a different line, so a new proposal.
    answer(payload('Stop', transcript([typed('No, keep the lockfile.'), assistant()])));
    expect(decisionsIn('projectPrivate')).toHaveLength(2);
  });

  it('records at most five at a Stop and goes on from there at the next', async () => {
    await did('switch', 'on', 'user-corrections');
    const seven = Array.from({ length: 7 }, (_, n) => typed(`No, change thing number ${n}.`));
    const file = transcript(seven.flatMap((line) => [line, assistant()]));
    expect(MOST_PER_STOP).toBe(5);
    expect(answer(payload('Stop', file)).reply).toHaveProperty('systemMessage');
    expect(decisionsIn('projectPrivate')).toHaveLength(5);
    answer(payload('Stop', file));
    expect(decisionsIn('projectPrivate')).toHaveLength(7);
  });

  it('ignores a line the host injected, a notification and a tool result', async () => {
    await did('switch', 'on', 'user-corrections');
    const file = transcript([
      typed('No, this was injected.', { isMeta: true }),
      typed('No, this is a notification.', { origin: { kind: 'task-notification' } }),
      JSON.stringify({
        type: 'user',
        sessionId: 's-1',
        message: { role: 'user', content: [{ type: 'tool_result', content: 'No, an error.' }] },
      }),
    ]);
    expect(answer(payload('Stop', file))).toEqual({ reply: {}, notes: [] });
    expect(decisionsIn('projectPrivate')).toHaveLength(0);
  });

  it('answers only a Stop, and says what it could not read on the second stream', async () => {
    await did('switch', 'on', 'user-corrections');
    const file = transcript(CORRECTED);
    expect(answer(payload('PreCompact', file))).toEqual({ reply: {}, notes: [] });
    expect(answer('not json').notes).toEqual([
      'The hook input was not JSON, so no correction was read.',
    ]);
    expect(answer(JSON.stringify({ hook_event_name: 'Stop' })).notes).toEqual([
      'The Stop input named no transcript, so no correction was read.',
    ]);
    expect(decisionsIn('projectPrivate')).toHaveLength(0);
  });

  it('stops the moment it is switched off again, and says nothing outside a project', async () => {
    await did('switch', 'on', 'user-corrections');
    await did('switch', 'off', 'user-corrections');
    expect(answer(payload('Stop', transcript(CORRECTED)))).toEqual({ reply: {}, notes: [] });
    const elsewhere = join(sandbox, 'elsewhere');
    mkdirSync(elsewhere);
    expect(
      runCorrections({ cwd: elsewhere, env }, { payload: payload('Stop', transcript(CORRECTED)) }),
    ).toEqual({ ok: true, reply: {}, notes: [] });
  });
});

describe('the verb as the command line routes it', () => {
  /** Runs `mnema corrections` with `input` on the standard input, and answers what it wrote where. */
  async function typedInto(input: string): Promise<{ out: string[]; err: string[] }> {
    const seen = { out: [] as string[], err: [] as string[] };
    const io = {
      out: (line: string) => seen.out.push(line),
      err: (line: string) => seen.err.push(line),
      fail: () => {},
      input: async () => input,
    };
    const program = new Command('mnema').exitOverride();
    registerCorrections(program, { io, render: renderPlain } as unknown as Parameters<
      typeof registerCorrections
    >[1]);
    await program.parseAsync(['corrections'], { from: 'user' });
    return seen;
  }

  it('is a write, takes no option, and prints the reply as one JSON line', async () => {
    const declared = registerCorrections(new Command('mnema'), {
      io: {},
      render: renderPlain,
    } as unknown as Parameters<typeof registerCorrections>[1]);
    expect(declared.effect).toBe('mutates');
    expect(declared.act.options).toEqual([]);
    await did('switch', 'on', 'user-corrections');
    const spoke = await typedInto(
      payload('Stop', transcript([typed('No, use pnpm instead of npm.')])),
    );
    expect(spoke.out.map((line) => JSON.parse(line))).toEqual([
      {
        systemMessage:
          '1 correction the person made in this session was recorded as a proposed decision in this machine’s private tree: ADR-1.',
      },
    ]);
    const quiet = await typedInto('not json');
    expect(quiet.out).toEqual(['{}']);
    expect(quiet.err.join('\n')).toContain(
      'The hook input was not JSON, so no correction was read.',
    );
  });
});

describe('the plugin command a host runs at Stop', () => {
  it('hands the payload to the verb, and records only where the channel was switched on', async () => {
    const bin = join(sandbox, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'mnema'),
      ['#!/bin/sh', `exec "${process.execPath}" "${CLI}" "$@"`, ''].join('\n'),
    );
    chmodSync(join(bin, 'mnema'), 0o755);
    const host = (input: string) =>
      spawnSync(process.execPath, [join(PLUGIN, 'hooks', 'session-corrections.mjs')], {
        cwd: repo,
        input,
        encoding: 'utf-8',
        env: {
          HOME: join(sandbox, 'home'),
          PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
          CLAUDE_PROJECT_DIR: repo,
        },
      });
    const file = transcript([typed('No, use pnpm instead of npm.')]);
    const off = host(payload('Stop', file));
    expect(off.status).toBe(0);
    expect(off.stdout).toBe('');
    expect(decisionsIn('projectPrivate')).toHaveLength(0);
    await did('switch', 'on', 'user-corrections');
    const on = host(payload('Stop', file));
    expect(on.status).toBe(0);
    expect(JSON.parse(on.stdout)).toEqual({
      systemMessage:
        '1 correction the person made in this session was recorded as a proposed decision in this machine’s private tree: ADR-1.',
    });
    expect(decisionsIn('projectPrivate')).toHaveLength(1);
  });
});
