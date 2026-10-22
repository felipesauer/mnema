/**
 * THE BARE NAME SAYS WHERE THIS PROJECT STANDS AND WHAT IS OFF, and the rest points to `--help`.
 *
 * `mnema` with nothing after it printed the catalogue on stderr and failed. Now, with no terminal
 * (a terminal is asked a question instead, `the-bare-name-asks.test.ts`), it prints a short summary
 * on stdout and succeeds: what the product does in the promise's own sentence, whether a project
 * is founded here and how many decisions await a judgement, which channels are off on this
 * machine and the command that turns one on, three verbs to go on with, and where the catalogue is.
 *
 * Also held here, because it is the same table read twice: `mnema switch` says on each off line
 * how to turn it on, and `mnema init` names the channels that begin off before its "Next" line.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { summaryHere } from '../src/commands/summary.js';
import { summaryLines } from '../src/presentation/summary.js';
import { type CliIo, run } from '../src/program.js';
import { STARTS_OFF } from '../src/record-framing.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

async function mnema(...argv: string[]): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out, err, failed };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-bare-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the bare name, with no terminal', () => {
  it('outside a project: the summary on stdout, no state, the first verb founds one, exit zero', async () => {
    const said = await mnema();
    expect(said.failed).toBe(false);
    expect(said.err).toEqual([]);
    const text = said.out.join('\n');
    expect(text).not.toContain('is founded here');
    expect(text).toContain('`mnema init`');
    expect(text).toContain('`mnema --help` lists every command.');
    expect(said.out.length).toBeLessThanOrEqual(12);
  });

  it('names what is off and the command that turns it on', async () => {
    const text = (await mnema()).out.join('\n');
    expect(text).toContain(`Off on this machine: ${STARTS_OFF.join(', ')}.`);
    expect(text).toContain('`mnema switch on <name>`');
  });

  it('in a project: says it is founded and counts what awaits a judgement', async () => {
    await mnema('init');
    expect((await mnema()).out.join('\n')).toContain('A mnema project is founded here.');
    expect((await mnema()).out.join('\n')).not.toContain('await a judgement');
    await mnema('decision', 'record', 'Use sqlite', 'It needs no server');
    const text = (await mnema()).out.join('\n');
    expect(text).toContain('1 decision(s) await a judgement: `mnema decision review`');
    expect(text).toContain('`mnema status`');
  });

  it('a channel a person switched on leaves the list, and none off leaves no line', async () => {
    await mnema('init');
    for (const channel of STARTS_OFF) await mnema('switch', 'on', channel);
    const text = (await mnema()).out.join('\n');
    expect(text).not.toContain('Off on this machine');
    await mnema('switch', 'off', 'session-tally');
    expect((await mnema()).out.join('\n')).toContain('Off on this machine: session-tally.');
  });

  it('keeps the whole catalogue for --help', async () => {
    const said = await mnema('--help');
    expect(said.out.join('\n')).toContain('Usage: mnema [options] [command]');
  });

  it('reads the summary off the project here, and off none outside', async () => {
    expect(summaryHere({ cwd: repo, env: { home: join(sandbox, 'home') } })).toEqual({
      founded: false,
      off: [...STARTS_OFF],
    });
    await mnema('init');
    expect(summaryHere({ cwd: repo, env: { home: join(sandbox, 'home') } })).toEqual({
      founded: true,
      waiting: 0,
      off: [...STARTS_OFF],
    });
  });

  it('lines the summary carries are only the ones its facts earn', () => {
    expect(summaryLines({ founded: false, off: [] }).join('\n')).not.toContain('Off on');
    expect(summaryLines({ founded: true, waiting: 0, off: [] }).join('\n')).not.toContain('await');
  });
});

describe('the switch listing and init say how to turn an off channel on', () => {
  it('prints the command on a channel that begins off, and on one a person turned off', async () => {
    await mnema('init');
    const first = (await mnema('switch')).out.join('\n');
    for (const channel of STARTS_OFF) {
      expect(first).toContain(`off until switched on: \`mnema switch on ${channel}\``);
    }
    await mnema('switch', 'off', 'session-tally', '--reason', 'noise');
    const line = (await mnema('switch')).out.find((one) => one.includes('session-tally')) ?? '';
    expect(line).toContain('switched off by');
    expect(line).toContain('`mnema switch on session-tally` turns it on');
  });

  it('init names the channels that begin off, before its Next line', async () => {
    const lines = (await mnema('init')).out;
    const at = lines.findIndex((one) => one.includes('Off until switched on:'));
    expect(at).toBeGreaterThan(-1);
    expect(lines[at]).toContain(STARTS_OFF.join(', '));
    expect(lines[at + 1]).toContain('`mnema switch on <name>`');
    expect(lines[at + 2]).toContain('Next:');
  });
});
