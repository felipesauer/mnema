/**
 * THE CONSOLE SAYS THAT SOMETHING RECURS AND NEVER WHERE. After a line that names projects, a
 * session says in one sentence that N patterns or decisions recur across them, and gives the verb
 * that lists them. The sentence carries no path and no id of another project: the console is read
 * by a person and may be recorded, and where the other projects of a machine are is not its to show.
 *
 * It looks only in the folders the person typed (`repl/promotable.ts`): a line that names none says
 * nothing, and so does a set with nothing in common.
 */

import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPlain } from '../src/presentation/plain.js';
import { type CliIo, run } from '../src/program.js';
import { projectsNamedBy } from '../src/repl/promotable.js';
import { typedLine } from '../src/repl/session.js';
import { REPL_VERB } from '../src/wiring/repl.js';

const before = { cwd: process.cwd(), env: { ...process.env } };
const BODY = 'Run the whole suite before every push.';

let sandbox: string;
let a: string;
let b: string;
let c: string;
const ids: string[] = [];

async function said(work: (io: CliIo) => Promise<void>): Promise<string[]> {
  const out: string[] = [];
  await work({
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    fail: () => undefined,
  });
  return out;
}

async function mnema(...argv: string[]): Promise<string[]> {
  return said((io) => run(argv, io));
}

const prompt = (line: string): Promise<string[]> =>
  said(async (io) => {
    await typedLine(line, { io, render: renderPlain, self: REPL_VERB, identity: undefined });
  });

async function adopted(dir: string, name: string, body: string): Promise<void> {
  process.chdir(dir);
  const made = (await mnema('skill', 'create', name, '--body', body)).join('\n');
  const id = /\(([0-9a-f-]{36})\)/.exec(made)?.[1] as string;
  ids.push(id);
  await mnema('skill', 'move', 'review', id, '--note', 'read');
  await mnema('skill', 'move', 'adopt', id, '--note', 'good');
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-console-recurs-'));
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  for (const name of ['alpha', 'beta', 'gamma'])
    mkdirSync(join(sandbox, name), { recursive: true });
  a = join(sandbox, 'alpha');
  b = join(sandbox, 'beta');
  c = join(sandbox, 'gamma');
  for (const dir of [a, b, c]) {
    process.chdir(dir);
    await mnema('init');
  }
  await adopted(a, 'Run the suite', BODY);
  await adopted(b, 'Run the suite', BODY);
  await adopted(c, 'Something only here', 'A practice nobody else wrote down.');
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the folders a typed line names', () => {
  it('are the words after --workspace up to the next flag, and nothing else', () => {
    expect(projectsNamedBy(['verify', '--workspace', 'a', 'b', '--global'])).toEqual(['a', 'b']);
    expect(projectsNamedBy(['verify', '--workspace=a'])).toEqual(['a']);
    expect(projectsNamedBy(['verify', '--global'])).toEqual([]);
    expect(projectsNamedBy(['search', 'workspace'])).toEqual([]);
  });
});

describe('the sentence after a line that names projects', () => {
  it('says that something recurs and which verb lists it, and names no project and no id', async () => {
    process.chdir(a);
    const lines = await prompt(`verify --workspace ${a} ${b}`);
    const last = lines[lines.length - 1] as string;
    expect(last).toContain('1 pattern or decision recurs');
    expect(last).toContain('mnema promote --workspace');
    // The verb's own report may name the projects the person typed; this sentence may not.
    for (const hidden of [sandbox, a, b, 'alpha', 'beta', 'Run the suite', ...ids]) {
      expect(last).not.toContain(hidden);
    }
  }, 60_000);

  it('is not said when what was named has nothing in common, or when nothing was named', async () => {
    process.chdir(a);
    const apart = (await prompt(`verify --workspace ${a} ${c}`)).join('\n');
    expect(apart).not.toContain('mnema promote');
    const alone = (await prompt('verify')).join('\n');
    expect(alone).not.toContain('mnema promote');
  }, 60_000);
});

describe('a named project whose chain is damaged', () => {
  it('ends the turn without rejecting, and the sentence is simply not said', async () => {
    const d = join(sandbox, 'delta');
    mkdirSync(d, { recursive: true });
    process.chdir(d);
    await mnema('init');
    await adopted(d, 'Run the suite', BODY);
    const tails = join(d, '.mnema', 'tails');
    const tail = readdirSync(tails)[0] as string;
    appendFileSync(join(tails, tail, '000001.jsonl'), 'this is not a stored line\n', 'utf-8');
    process.chdir(a);
    const lines = (await prompt(`verify --workspace ${a} ${d}`)).join('\n');
    expect(lines).not.toContain('mnema promote');
  }, 60_000);
});
