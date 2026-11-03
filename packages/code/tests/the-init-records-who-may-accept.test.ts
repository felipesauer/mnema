/**
 * THE ANSWER `mnema init` TAKES ABOUT AGENTS ACCEPTING is a decision in the record's public tree, and whose
 * it is depends on who gave it (`init/accepts.ts`).
 *
 * WHAT IS HELD, each read back off the record with the verbs a person reads it with and never off what the
 * function that wrote it returned:
 *   - A PERSON'S ANSWER, on the screen or as `--accepts`, is recorded and accepted, by the person (no agent on
 *     the act), in the PUBLIC tree, so the team reads it.
 *   - AN AGENT'S ANSWER (`--accepts` with `--which`) is its own PROPOSAL: recorded as the agent's, still
 *     proposed, waiting for the person. A decision signed as the person's, by the agent whose authority it
 *     is about, would put its answer in the person's mouth.
 *   - `no` IS A DECISION AND THE SWITCH THAT KEEPS IT: an agent's `accept` is refused afterwards. An agent's
 *     `no` records the proposal and no switch: an agent does not close its own permission for the person.
 *   - `--yes` NEVER ANSWERS IT, and without a terminal and without `--accepts` nothing is asked or recorded.
 *
 * The cases run the program in process; the screen is a fake terminal that really draws.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordWhoMayAccept } from '../src/init/accepts.js';
import { type CliIo, run } from '../src/program.js';
import { fakeTerminal, hooksNothing, until } from './support/console.js';

const ENTER = '\r';
const DOWN = '\u001b[B';
const ACCEPTS = 'May an agent accept the decisions you choose?';

let sandbox: string;
let home: string;
let repo: string;
const kept = { cwd: process.cwd(), home: process.env.HOME };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-init-accepts-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home);
  mkdirSync(repo);
  process.env.HOME = home;
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(kept.cwd);
  if (kept.home === undefined) delete process.env.HOME;
  else process.env.HOME = kept.home;
  rmSync(sandbox, { recursive: true, force: true });
});

interface Heard {
  readonly out: string;
  readonly err: string;
  readonly failed: boolean;
}

/** One invocation with nobody to ask. */
async function alone(argv: readonly string[]): Promise<Heard> {
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
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

/** One invocation at a fake terminal: the keys a person presses on each screen, in order. */
async function atATerminal(argv: readonly string[], keys: readonly string[]): Promise<Heard> {
  const device = fakeTerminal({ columns: 100, rows: 60 });
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
    aPersonIsHere: true,
    terminal: { input: device.stdin, output: device.stdout, leaving: hooksNothing },
  };
  const running = run(argv, io);
  const screens = ['Which agent hosts', ACCEPTS, 'Found the project with this plan?'];
  let mark = 0;
  for (const [at, key] of keys.entries()) {
    await until(
      () =>
        device
          .bytes()
          .slice(mark)
          .includes(screens[at] as string),
      `drew ${screens[at]}`,
      800,
    );
    mark = device.bytes().length;
    device.type(key);
  }
  await running;
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

const showed = async (): Promise<string> => (await alone(['show', 'ADR-1'])).out;

describe('the answer of a person', { timeout: 60_000 }, () => {
  it('on the screen is recorded accepted by the person, in the public tree, and the note quotes the answer', async () => {
    const heard = await atATerminal(['init'], [ENTER, ENTER, ENTER]);
    expect(heard.failed).toBe(false);
    const decision = await showed();
    expect(decision).toContain('Agents may accept the decisions the person chooses (accepted)');
    expect(decision).toMatch(/recorded by mnid:[0-9a-f]{8} \(a person\)/);
    expect(decision).toMatch(/accepted by mnid:[0-9a-f]{8} \(a person\)/);
    expect(decision).toContain('·  public');
    expect(decision).toContain('The person answered "Yes, accept at once what I choose"');
    expect((await alone(['verify'])).failed).toBe(false);
  });

  it('as `--accepts no` is a decision and the switch that keeps it: an agent’s accept is refused afterwards', async () => {
    const heard = await alone(['init', '--hosts', 'none', '--accepts', 'no']);
    expect(heard.failed).toBe(false);
    expect(await showed()).toContain('Every decision waits for a person to accept it (accepted)');
    const switches = await alone(['switch']);
    expect(switches.out).toMatch(/agent-accepts\s+off/);

    const proposed = await alone(['decision', 'record', 'Use a thing', 'Because it is so.']);
    const id = /Recorded decision ADR-\d+ \(([0-9a-f-]+)\)/.exec(proposed.out)?.[1] as string;
    const refused = await alone([
      'decision',
      'move',
      'accept',
      id,
      '--note',
      'an agent says so',
      '--which',
      'claude-code',
    ]);
    expect(refused.failed).toBe(true);
    expect(refused.err).toContain('AGENT_ACCEPTS_IS_OFF');
  });

  it('on the screen as the second option is the same decision, and the switch is off', async () => {
    const heard = await atATerminal(['init'], [ENTER, DOWN + ENTER, ENTER]);
    expect(heard.failed).toBe(false);
    expect(await showed()).toContain('(accepted)');
    expect((await alone(['switch'])).out).toMatch(/agent-accepts\s+off/);
  });

  it('as `--accepts yes` leaves the switch on, which is the product’s default', async () => {
    await alone(['init', '--hosts', 'none', '--accepts', 'yes']);
    expect(await showed()).toContain('(accepted)');
    expect((await alone(['switch'])).out).toMatch(/agent-accepts\s+on/);
  });
});

describe('the answer of an agent', { timeout: 60_000 }, () => {
  it('(`--accepts yes` with `--which`) is its proposal: recorded as the agent’s and still proposed', async () => {
    const heard = await alone([
      'init',
      '--hosts',
      'none',
      '--accepts',
      'yes',
      '--which',
      'claude-code',
    ]);
    expect(heard.failed).toBe(false);
    const decision = await showed();
    expect(decision).toContain('(proposed)');
    expect(decision).toMatch(/recorded by mnid:[0-9a-f]{8} \(agent claude-code\)/);
    expect(decision).not.toContain('accepted by');
    expect(heard.out).toContain('the agent’s proposal');
  });

  it('(`--accepts no`) records the proposal and turns no switch off', async () => {
    await alone(['init', '--hosts', 'none', '--accepts', 'no', '--which', 'claude-code']);
    expect(await showed()).toContain('(proposed)');
    expect((await alone(['switch'])).out).toMatch(/agent-accepts\s+on/);
  });

  it('signed through the function, with an agent named, never accepts: the proposal waits', async () => {
    await alone(['init', '--hosts', 'none']);
    const recorded = recordWhoMayAccept({ cwd: repo, env: { home } }, 'yes', {
      agent: 'claude-code',
      given: 'flag',
    });
    expect(recorded.ok).toBe(true);
    if (recorded.ok) expect(recorded.as).toBe('proposed');
  });
});

describe('nothing is asked or recorded', { timeout: 60_000 }, () => {
  it('without a terminal and without `--accepts`', async () => {
    const heard = await alone(['init']);
    expect(heard.failed).toBe(false);
    expect((await alone(['show', 'ADR-1'])).failed).toBe(true);
  });

  it('with `--yes` at a terminal, which answers no question about agents: it is said not to have been asked', async () => {
    const device = fakeTerminal({ columns: 100, rows: 60 });
    const out: string[] = [];
    await run(['init', '--yes'], {
      out: (line) => out.push(line),
      err: () => undefined,
      fail: () => undefined,
      aPersonIsHere: true,
      terminal: { input: device.stdin, output: device.stdout, leaving: hooksNothing },
    });
    expect(device.bytes()).not.toContain(ACCEPTS);
    expect(out.join('\n')).toContain('was not asked');
    expect((await alone(['show', 'ADR-1'])).failed).toBe(true);
    expect(existsSync(join(repo, '.mnema'))).toBe(true);
  });
});
