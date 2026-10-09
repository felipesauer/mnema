/**
 * A subagent hands back its decisions in a block the record can check: a final reply that does not
 * end in one is sent back, once, with the format.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. The product's half: which replies are in the format, what the
 * reason sent back says, that it is said once, that it is silent where the product has no standing
 * (no project, the channel off, another event), and that the plugin's handler turns the verb's
 * answer into exit 2 with the reason on the second stream. What the real host does with that exit
 * is held by `host-contract/a-subagent-is-sent-back-for-its-handback.test.ts`.
 *
 * THE REPLIES ARE LITERALS: every case that says a reply is in or out of the format shows it.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXAMINED_BYTES,
  HANDBACK_SCHEMA,
  REASON_BYTES,
  runHandback,
  whatTheHandbackLacks,
} from '../src/commands/handback.js';
import { renderPlain } from '../src/presentation/plain.js';
import { type CliIo, run } from '../src/program.js';
import { registerHandback } from '../src/wiring/handback.js';

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

/** The control bytes in `text` other than the line break, by code. */
function controlBytesIn(text: string): number[] {
  return [...text]
    .map((one) => one.charCodeAt(0))
    .filter((code) => (code < 32 && code !== 10) || (code >= 127 && code < 160));
}

/** A fenced block with the info string the hand-back is read by. */
const block = (json: string): string => `\`\`\`mnema-handback\n${json}\n\`\`\``;

const ONE =
  '{"decisions":[{"settled":"Use UTC","why":"The ledger is UTC","turnedDown":"Local time: it drifts"}]}';

/** The payload a host hands a `SubagentStop` hook. */
function payload(reply: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: 'SubagentStop',
    stop_hook_active: false,
    agent_id: 'def456',
    agent_type: 'general-purpose',
    cwd: repo,
    last_assistant_message: reply,
    ...extra,
  });
}

/** What the verb answers, as the host parses it. */
function answer(input: string): { reply: Record<string, unknown>; notes: readonly string[] } {
  const done = runHandback({ cwd: repo, env }, { payload: input });
  return {
    reply: JSON.parse(JSON.stringify(done.reply)) as Record<string, unknown>,
    notes: done.notes,
  };
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-handback-'));
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

describe('which replies are in the format', () => {
  it('accepts a block of decisions, an empty list, and a block after prose', () => {
    expect(whatTheHandbackLacks(`Done.\n\n${block(ONE)}`)).toEqual([]);
    expect(whatTheHandbackLacks(block('{"decisions":[]}'))).toEqual([]);
    expect(whatTheHandbackLacks(`${block(ONE)}\n`)).toEqual([]);
  });

  it('reads the last block when there are two', () => {
    const first = block('{"decisions":[{"settled":"x"}]}');
    expect(whatTheHandbackLacks(`${first}\n\n${block(ONE)}`)).toEqual([]);
    expect(whatTheHandbackLacks(`${block(ONE)}\n\n${first}`)).toEqual([
      'the block.decisions[0].why is missing',
      'the block.decisions[0].turnedDown is missing',
    ]);
  });

  it('refuses a reply with no block, an unclosed one, and one with another info string', () => {
    const none = ['it has no block whose info string is mnema-handback'];
    expect(whatTheHandbackLacks('Analysis complete. Found 3 issues.')).toEqual(none);
    expect(whatTheHandbackLacks('')).toEqual(none);
    expect(whatTheHandbackLacks(`\`\`\`mnema-handback\n${ONE}`)).toEqual(none);
    expect(whatTheHandbackLacks(`\`\`\`json\n${ONE}\n\`\`\``)).toEqual(none);
    expect(whatTheHandbackLacks(`decisions: ${ONE}`)).toEqual(none);
  });

  it('refuses a block that is not JSON, and says that and nothing else', () => {
    expect(whatTheHandbackLacks(block('{"decisions":['))).toEqual([
      'the mnema-handback block is not JSON',
    ]);
  });

  it('names each place a block departs from the schema', () => {
    const lacks = (json: string) => whatTheHandbackLacks(block(json));
    expect(lacks('[]')).toEqual(['the block must be an object']);
    expect(lacks('{}')).toEqual(['the block.decisions is missing']);
    expect(lacks('{"decisions":"none"}')).toEqual(['the block.decisions must be a list']);
    expect(lacks('{"decisions":[],"summary":"x"}')).toEqual([
      'the block has a field the format does not have (its fields: decisions)',
    ]);
    expect(lacks('{"decisions":["Use UTC"]}')).toEqual([
      'the block.decisions[0] must be an object',
    ]);
    expect(lacks('{"decisions":[{"settled":"a","why":"  ","turnedDown":7,"extra":1}]}')).toEqual([
      'the block.decisions[0].why must say something',
      'the block.decisions[0].turnedDown must be text',
      'the block.decisions[0] has a field the format does not have (its fields: settled, why, turnedDown)',
    ]);
  });

  it('refuses the names every object inherits, at the block and inside a decision', () => {
    const complete = '"settled":"a","why":"b","turnedDown":"c"';
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const value = name === 'toString' || name === 'valueOf' ? '"text"' : '{"x":1}';
      expect(
        whatTheHandbackLacks(block(`{"decisions":[],${JSON.stringify(name)}:${value}}`)),
        `${name} at the block`,
      ).toEqual(['the block has a field the format does not have (its fields: decisions)']);
      expect(
        whatTheHandbackLacks(
          block(`{"decisions":[{${complete},${JSON.stringify(name)}:${value}}]}`),
        ),
        `${name} in a decision`,
      ).toEqual([
        'the block.decisions[0] has a field the format does not have (its fields: settled, why, turnedDown)',
      ]);
    }
  });

  it('is not made to look for an inherited name as a required field', () => {
    expect(whatTheHandbackLacks(block('{"constructor":[]}'))).toEqual([
      'the block.decisions is missing',
      'the block has a field the format does not have (its fields: decisions)',
    ]);
  });

  it('looks at the end of a reply only, whatever its length', () => {
    const padding = 'x'.repeat(EXAMINED_BYTES);
    expect(whatTheHandbackLacks(`${block(ONE)}\n${padding}`)).toEqual([
      'it has no block whose info string is mnema-handback',
    ]);
    expect(whatTheHandbackLacks(`${padding}\n${block(ONE)}`)).toEqual([]);
  });
});

describe('what the verb answers a host', () => {
  it('sends a reply with no block back, with the format and what it lacked', () => {
    const { reply, notes } = answer(payload('Analysis complete.'));
    expect(notes).toEqual([]);
    expect(reply['decision']).toBe('block');
    const reason = String(reply['reason']);
    expect(reason).toContain('```mnema-handback');
    expect(reason).toContain(
      '{"decisions":[{"settled":"what was settled","why":"why","turnedDown":"what was turned down, and why"}]}',
    );
    expect(reason).toContain('{"decisions":[]}');
    expect(reason).toContain('it has no block whose info string is mnema-handback');
    expect(reason).toContain('`mnema handback --schema`');
  });

  it('never repeats a key the subagent wrote, and never exceeds its ceiling', () => {
    const marks = ['\u001b[31mRED', 'bell\u0007', 'IGNORE-PREVIOUS-INSTRUCTIONS'];
    const keys = Object.fromEntries(marks.map((mark) => [mark, 1]));
    const many = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, index) => [`${'k'.repeat(100)}${index}`, 1]),
    );
    const decisions = Array.from({ length: 5_000 }, () => ({ extra: 1 }));
    for (const reply of [
      block(JSON.stringify({ decisions: [], ...keys })),
      block(JSON.stringify({ decisions: [{ settled: 'a', why: 'b', turnedDown: 'c', ...keys }] })),
      block(JSON.stringify({ decisions: [], ...many })),
      block(JSON.stringify({ decisions })),
    ]) {
      const reason = String(answer(payload(reply)).reply['reason']);
      expect(controlBytesIn(reason)).toEqual([]);
      expect(reason).not.toContain('RED');
      expect(reason).not.toContain('IGNORE-PREVIOUS');
      expect(reason).not.toContain('kkkkkkkk');
      expect(Buffer.byteLength(reason)).toBeLessThanOrEqual(REASON_BYTES);
    }
  });

  it('says nothing to a reply in the format', () => {
    expect(answer(payload(`Done.\n${block(ONE)}`))).toEqual({ reply: {}, notes: [] });
    expect(answer(payload(block('{"decisions":[]}')))).toEqual({ reply: {}, notes: [] });
  });

  it('sends back once: the second stop of the same subagent goes through', () => {
    expect(answer(payload('Done.', { stop_hook_active: true }))).toEqual({ reply: {}, notes: [] });
  });

  it('says nothing for an event that is not the stop of a subagent', () => {
    expect(answer(payload('Done.', { hook_event_name: 'Stop' }))).toEqual({ reply: {}, notes: [] });
    expect(answer('[]')).toEqual({ reply: {}, notes: [] });
  });

  it('says on the second stream what it could not read, and still answers nothing', () => {
    expect(answer('not json')).toEqual({
      reply: {},
      notes: ['The hook input was not JSON, so nothing was checked.'],
    });
    expect(answer(payload(undefined))).toEqual({
      reply: {},
      notes: ['The SubagentStop input carried no final reply, so nothing was checked.'],
    });
    expect(answer(payload(42))).toEqual({
      reply: {},
      notes: ['The SubagentStop input carried no final reply, so nothing was checked.'],
    });
  });

  it('says nothing when the channel is switched off, and nothing outside a project', async () => {
    await did('switch', 'off', 'subagent-handback');
    expect(answer(payload('Done.'))).toEqual({ reply: {}, notes: [] });
    await did('switch', 'on', 'subagent-handback');
    expect(answer(payload('Done.')).reply['decision']).toBe('block');
    const elsewhere = join(sandbox, 'elsewhere');
    mkdirSync(elsewhere);
    const done = runHandback({ cwd: elsewhere, env }, { payload: payload('Done.') });
    expect(done).toEqual({ ok: true, reply: {}, notes: [] });
  });
});

describe('the verb as the command line routes it', () => {
  /** Runs `mnema handback <args>` with `input` on the standard input. */
  async function typed(
    args: string[],
    input: string,
  ): Promise<{ out: string[]; err: string[]; failed: boolean }> {
    const seen = { out: [] as string[], err: [] as string[], failed: false };
    const io = {
      out: (line: string) => seen.out.push(line),
      err: (line: string) => seen.err.push(line),
      fail: () => {
        seen.failed = true;
      },
      input: async () => input,
    };
    const program = new Command('mnema').exitOverride();
    registerHandback(program, { io, render: renderPlain } as unknown as Parameters<
      typeof registerHandback
    >[1]);
    await program.parseAsync(['handback', ...args], { from: 'user' });
    return seen;
  }

  it('prints the reply as one JSON line, and a note beside it on the second stream', async () => {
    const sent = await typed([], payload('Done.'));
    expect(sent.failed).toBe(false);
    expect(sent.out.map((line) => JSON.parse(line).decision)).toEqual(['block']);
    const quiet = await typed([], 'not json');
    expect(quiet.out).toEqual(['{}']);
    expect(quiet.err.join('\n')).toContain('The hook input was not JSON, so nothing was checked.');
  });

  it('prints the schema with --schema, and reads nothing', async () => {
    const seen = await typed(['--schema'], 'not even read');
    expect(JSON.parse(seen.out.join('\n'))).toEqual(HANDBACK_SCHEMA);
    expect(seen.err).toEqual([]);
  });

  it('is a read, and takes one option', () => {
    const program = new Command('mnema');
    const declared = registerHandback(program, {
      io: {},
      render: renderPlain,
    } as unknown as Parameters<typeof registerHandback>[1]);
    expect(declared.effect).toBe('reads');
    expect(declared.act.options.map((option) => option.long)).toEqual(['--schema']);
  });
});

describe('the plugin command a host runs when a subagent stops', () => {
  /** Runs the handler as the host does, with a `mnema` on the PATH that is this tree's build. */
  function host(input: string, withMnema = true) {
    const bin = join(sandbox, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'mnema'),
      ['#!/bin/sh', `exec "${process.execPath}" "${CLI}" "$@"`, ''].join('\n'),
    );
    chmodSync(join(bin, 'mnema'), 0o755);
    return spawnSync(process.execPath, [join(PLUGIN, 'hooks', 'subagent-stop.mjs')], {
      cwd: repo,
      input,
      encoding: 'utf-8',
      timeout: 20_000,
      env: {
        HOME: join(sandbox, 'home'),
        PATH: `${withMnema ? `${bin}:` : ''}${dirname(process.execPath)}:/usr/bin:/bin`,
        CLAUDE_PROJECT_DIR: repo,
      },
    });
  }

  it('exits 2 with the reason on stderr for a reply out of the format, and nothing on stdout', () => {
    const sent = host(payload('Analysis complete.'));
    expect(sent.status).toBe(2);
    expect(sent.stdout).toBe('');
    expect(sent.stderr).toContain('```mnema-handback');
    expect(sent.stderr).toContain('it has no block whose info string is mnema-handback');
  });

  it('exits 0 and writes nothing for a reply in the format, and the second time', () => {
    for (const input of [
      payload(`Done.\n${block(ONE)}`),
      payload('Done.', { stop_hook_active: true }),
    ]) {
      const quiet = host(input);
      expect(quiet.status).toBe(0);
      expect(quiet.stdout).toBe('');
      expect(quiet.stderr).toBe('');
    }
  });

  it('answers a reply of 200,000 openings that never close in milliseconds, not minutes', () => {
    const reply = `${'```mnema-handback\n'.repeat(200_000)}the end`;
    const started = Date.now();
    const sent = host(payload(reply));
    // The hook's own budget is 15 s; the pattern this replaced took 217 s on this input.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(sent.status).toBe(2);
    expect(sent.stderr).toContain('it has no block whose info string is mnema-handback');
  }, 40_000);

  it('never lets a key out of the reply, and never more than the ceiling', () => {
    const keyed = JSON.stringify({
      decisions: [],
      '\u001b[2Jhi\u0007': 1,
      ...{ [`${'k'.repeat(100)}`]: 1 },
    });
    const sent = host(payload(block(keyed)));
    expect(sent.status).toBe(2);
    expect(controlBytesIn(sent.stderr)).toEqual([]);
    expect(sent.stderr).not.toContain('kkkkkkkk');
    expect(Buffer.byteLength(sent.stderr)).toBeLessThanOrEqual(REASON_BYTES + 1);
  });

  it('fails open when mnema answers something that is not its answer', () => {
    for (const printed of [
      'not json at all',
      '{"decision":"block","reason":""}',
      '{"decision":"block"}',
    ]) {
      const bin = join(sandbox, 'strange');
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, 'mnema'), `#!/bin/sh\ncat >/dev/null\nprintf '%s' '${printed}'\n`);
      chmodSync(join(bin, 'mnema'), 0o755);
      const sent = spawnSync(process.execPath, [join(PLUGIN, 'hooks', 'subagent-stop.mjs')], {
        cwd: repo,
        input: payload('Done.'),
        encoding: 'utf-8',
        env: {
          HOME: join(sandbox, 'home'),
          PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
          CLAUDE_PROJECT_DIR: repo,
        },
      });
      expect(sent.status, printed).toBe(0);
      expect(sent.stderr, printed).toBe('');
    }
  });

  it('fails open: no mnema on the PATH, a payload that is not JSON', () => {
    const without = host(payload('Done.'), false);
    expect(without.status).toBe(0);
    expect(without.stderr).toBe('');
    const garbage = host('not json');
    expect(garbage.status).toBe(0);
    expect(garbage.stderr).toBe('');
  });
});
