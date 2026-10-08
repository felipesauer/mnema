/**
 * `mnema decision record`: the rationale typed on the line, read from standard input
 * (`--stdin`) or read from a file (`--body-file`) — one of the three, and a line that gives it
 * from two places is refused with the places it named, writing nothing.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/program.js';
import { bodyFrom } from '../src/wiring/body-source.js';
import { REFUSED } from '../src/wiring/from-the-group.js';
import type { Wiring } from '../src/wiring/verb.js';

let sandbox: string;
let originalCwd: string;
let originalHome: string | undefined;

interface Ran {
  readonly out: string;
  readonly err: string;
  readonly failed: boolean;
}

async function mnema(argv: readonly string[], stdin?: string): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    fail: () => {
      failed = true;
    },
    ...(stdin !== undefined ? { input: async () => stdin } : {}),
  };
  await run([...argv], io);
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

/** The page `show` prints for the decision a `record` line just made. */
async function shown(recorded: Ran): Promise<string> {
  const id = recorded.out.match(/\(([0-9a-f-]{20,})\)/)?.[1] as string;
  return (await mnema(['show', id])).out;
}

/** The page `show` prints for the id a line that prints no parentheses reported. */
async function shownById(recorded: Ran): Promise<string> {
  const id = recorded.out.match(/[0-9a-f]{8}-[0-9a-f-]{20,}/)?.[0] as string;
  return (await mnema(['show', id])).out;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-body-'));
  mkdirSync(join(sandbox, 'home'));
  mkdirSync(join(sandbox, 'repo'));
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  process.env.HOME = join(sandbox, 'home');
  process.chdir(join(sandbox, 'repo'));
  await mnema(['init']);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the rationale of a decision', () => {
  it('still takes the rationale as an argument', async () => {
    const recorded = await mnema(['decision', 'record', 'Use X', 'typed reason']);
    expect(recorded.failed).toBe(false);
    expect(await shown(recorded)).toContain('typed reason');
  });

  it('reads it from standard input with --stdin', async () => {
    const recorded = await mnema(
      ['decision', 'record', 'Use X', '--stdin'],
      'from a pipe\nsecond line\n',
    );
    expect(recorded.failed).toBe(false);
    const page = await shown(recorded);
    expect(page).toContain('from a pipe');
    expect(page).toContain('second line');
  });

  it('reads it from a file with --body-file', async () => {
    const file = join(sandbox, 'why.md');
    writeFileSync(file, 'from a file\n');
    const recorded = await mnema(['decision', 'record', 'Use X', '--body-file', file]);
    expect(recorded.failed).toBe(false);
    expect(await shown(recorded)).toContain('from a file');
  });

  it('refuses a rationale from two places, naming both, and records nothing', async () => {
    const file = join(sandbox, 'why.md');
    writeFileSync(file, 'from a file\n');
    const both = await mnema(['decision', 'record', 'Use X', 'typed', '--body-file', file]);
    expect(both.failed).toBe(true);
    expect(both.err).toContain('the rationale came from the argument and --body-file');
    const piped = await mnema(['decision', 'record', 'Use X', '--stdin', '--body-file', file], 'x');
    expect(piped.failed).toBe(true);
    expect(piped.err).toContain('the rationale came from --stdin and --body-file');
    expect((await mnema(['timeline'])).out).not.toContain('Use X');
  });

  it('refuses a line with no rationale from anywhere, and a file it cannot read', async () => {
    const none = await mnema(['decision', 'record', 'Use X']);
    expect(none.failed).toBe(true);
    expect(none.err).toContain('the rationale is missing');
    const gone = await mnema([
      'decision',
      'record',
      'Use X',
      '--body-file',
      join(sandbox, 'no.md'),
    ]);
    expect(gone.failed).toBe(true);
    expect(gone.err).toContain('could not read');
    expect(gone.err).toContain('ENOENT');
  });

  it('refuses the new flags on the moves of the group, which read no text', async () => {
    const moved = await mnema(['decision', 'move', 'accept', 'x', '--stdin']);
    expect(moved.failed).toBe(true);
    expect(moved.err).toContain('takes no --stdin');
  });
});

describe('the text that comes from one place', () => {
  const wiring = {
    render: () => '',
    io: { out: () => undefined, err: () => undefined, fail: () => undefined },
  } as unknown as Wiring;

  it('drops one line break at the end of what was read, and none of what was typed', async () => {
    expect(await bodyFrom(wiring, 'rationale', 'as an argument', { stdin: true })).toBe('');
    expect(await bodyFrom(wiring, 'rationale', 'as an argument', { typed: 'a\n' })).toBe('a\n');
    const file = join(sandbox, 'two.md');
    writeFileSync(file, 'a\r\n\r\n');
    expect(await bodyFrom(wiring, 'rationale', 'as an argument', { bodyFile: file })).toBe('a\r\n');
  });

  it('answers REFUSED for two places', async () => {
    expect(await bodyFrom(wiring, 'rationale', 'as an argument', { typed: 'a', stdin: true })).toBe(
      REFUSED,
    );
  });
});

describe('the same three doors on the other writes with a long text', () => {
  const file = (text: string): string => {
    const path = join(sandbox, 'text.md');
    writeFileSync(path, text);
    return path;
  };

  it('skill create takes the pattern from --body, --stdin or --body-file', async () => {
    const typed = await mnema(['skill', 'create', 'S1', '--body', 'typed pattern']);
    expect(typed.failed).toBe(false);
    const piped = await mnema(['skill', 'create', 'S2', '--stdin'], 'piped pattern\n');
    expect(piped.failed).toBe(false);
    const filed = await mnema(['skill', 'create', 'S3', '--body-file', file('filed pattern\n')]);
    expect(filed.failed).toBe(false);
    expect(await shown(typed)).toContain('typed pattern');
    expect(await shown(piped)).toContain('piped pattern');
    expect(await shown(filed)).toContain('filed pattern');
  });

  it('skill create refuses two places and none, writing nothing', async () => {
    const two = await mnema(['skill', 'create', 'S4', '--body', 'x', '--stdin'], 'y');
    expect(two.failed).toBe(true);
    expect(two.err).toContain('the reusable pattern came from the argument and --stdin');
    const none = await mnema(['skill', 'create', 'S5']);
    expect(none.failed).toBe(true);
    expect(none.err).toContain('the reusable pattern is missing');
    expect((await mnema(['timeline'])).out).not.toMatch(/S4|S5/);
  });

  it('memory takes the content as an argument, from --stdin or from --body-file', async () => {
    const typed = await mnema(['memory', 'typed memory']);
    const piped = await mnema(['memory', '--stdin'], 'piped memory\n');
    const filed = await mnema(['memory', '--body-file', file('filed memory\n')]);
    for (const ran of [typed, piped, filed]) expect(ran.failed).toBe(false);
    expect(await shownById(typed)).toContain('typed memory');
    expect(await shownById(piped)).toContain('piped memory');
    expect(await shownById(filed)).toContain('filed memory');
    const none = await mnema(['memory']);
    expect(none.failed).toBe(true);
    expect(none.err).toContain('the memory is missing');
  });

  it('observe takes --text, --stdin or --body-file, and refuses two', async () => {
    const base = ['observe', 'T-1', '--topic', 'why'];
    const typed = await mnema([...base, '--text', 'typed note']);
    const piped = await mnema([...base, '--stdin'], 'piped note\n');
    const filed = await mnema([...base, '--body-file', file('filed note\n')]);
    for (const ran of [typed, piped, filed]) expect(ran.failed).toBe(false);
    expect(await shownById(typed)).toContain('typed note');
    expect(await shownById(piped)).toContain('piped note');
    expect(await shownById(filed)).toContain('filed note');
    const two = await mnema([...base, '--text', 'x', '--stdin'], 'y');
    expect(two.failed).toBe(true);
    expect(two.err).toContain('the observation came from the argument and --stdin');
  });
});
