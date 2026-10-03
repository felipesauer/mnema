/**
 * A note can be retracted, on both surfaces: `mnema retract` and the `retract_note` tool.
 *
 * Driven the way the binary and an agent drive them, over a real project in a sandbox. Held:
 *   - a retracted memory leaves the opening read (`recall`) and the search, and `show` still
 *     prints it whole, saying when, by whom and why it was retracted;
 *   - the retraction follows the note to the tree it was written in — an agent's private note
 *     is retracted in the private tree;
 *   - a decision, an unknown id and a note already retracted are refused, with the sentence
 *     that says what to do, and append nothing.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { openSession, type Session } from '../src/mcp/session.js';
import {
  runCaptureMemory,
  runReadRecordTool,
  runRetractNote,
  runSearchTool,
} from '../src/mcp/tools.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** Runs `mnema <argv>` the way the binary does. */
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

async function did(...argv: string[]): Promise<Said> {
  const said = await mnema(...argv);
  expect(said.failed, `mnema ${argv.join(' ')}: ${said.err.join(' / ')}`).toBe(false);
  return said;
}

/** The id a write echoed. */
function idIn(said: Said): string {
  const id = said.out
    .join('\n')
    .match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said.out.join(' / ')}`);
  return id;
}

function eventsIn(scope: 'public' | 'private'): CatalogEvent[] {
  const trees = resolveTrees(repo, env);
  const root = scope === 'public' ? trees.projectPublic : trees.projectPrivate;
  return orderedEvents({ root: root as string }, catalogUpcasters());
}

const retractions = (scope: 'public' | 'private'): CatalogEvent[] =>
  eventsIn(scope).filter((event) => event.kind === 'note.retracted');

function connect(): Session {
  return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-retract-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

const WRONG = 'The staging database resets every night at two';
const WHY = 'It resets on deploy, not at night';

describe('mnema retract', () => {
  it('takes a memory out of recall and search, and show still prints it with the retraction', async () => {
    const kept = idIn(await did('memory', 'The queue drains every hour'));
    const taken = idIn(await did('memory', WRONG));
    expect((await did('recall')).out.join('\n')).toContain('staging database');
    expect((await did('search', 'staging')).out.join('\n')).toContain(taken);

    const said = await did('retract', taken, '--reason', WHY);
    expect(said.out.join('\n')).toContain(`Retracted memory ${taken}`);
    expect(retractions('public')).toHaveLength(1);

    expect((await did('recall')).out.join('\n')).not.toContain('staging database');
    expect((await did('search', 'staging')).out.join('\n')).not.toContain(taken);
    expect((await did('search')).out.join('\n')).toContain(kept);

    const shown = (await did('show', taken)).out.join('\n');
    expect(shown).toContain(WRONG);
    expect(shown).toMatch(/retracted \d{4}-\d\d-\d\dT\S+ by mnid:\S+ \(a person\)/);
    expect(shown).toContain(`why: ${WHY}`);
    expect((await did('show', kept)).out.join('\n')).not.toContain('retracted');
  });

  it('refuses a decision with what to do instead, and appends nothing', async () => {
    const decision = idIn(await did('decision', 'record', 'SQLite for the cache', 'Relational'));
    const before = eventsIn('public').length;
    const said = await mnema('retract', decision, '--reason', WHY);
    expect(said.failed).toBe(true);
    expect(said.err.join('\n')).toContain('NOT_A_NOTE');
    expect(said.err.join('\n')).toContain('supersede');
    expect(eventsIn('public')).toHaveLength(before);
  });

  it('refuses an unknown id and a note already retracted', async () => {
    const unknown = await mnema('retract', '019f81f8-e400-7001-8000-0000000000ff', '--reason', WHY);
    expect(unknown.failed).toBe(true);
    expect(unknown.err.join('\n')).toContain(
      'No record 019f81f8-e400-7001-8000-0000000000ff here.',
    );

    const taken = idIn(await did('memory', WRONG));
    await did('retract', taken, '--reason', WHY);
    const again = await mnema('retract', taken, '--reason', 'again');
    expect(again.failed).toBe(true);
    expect(again.err.join('\n')).toContain('ALREADY_RETRACTED');
    expect(retractions('public')).toHaveLength(1);
  });
});

describe('the retract_note tool', () => {
  it('retracts an agent’s note in the tree it was written in, attributed to the agent', () => {
    const session = connect();
    const captured = runCaptureMemory(session, { content: WRONG });
    if (!captured.ok) throw new Error(captured.message);
    // An agent's capture lands private, and the retraction follows it there.
    expect(captured.scope).toBe('private');

    const retracted = runRetractNote(session, { id: captured.id, reason: WHY });
    expect(retracted).toMatchObject({ ok: true, note: 'memory', scope: 'private' });
    const [fact] = retractions('private');
    expect(fact?.subject).toBe(captured.id);
    expect(fact?.which).toBe('agent-alpha');
    expect(fact?.payload).toEqual({ reason: WHY });
    expect(retractions('public')).toEqual([]);

    const searched = runSearchTool(session, { term: 'staging' });
    expect(JSON.stringify(searched)).not.toContain(captured.id);
    const read = JSON.stringify(runReadRecordTool(session, { id: captured.id }));
    expect(read).toContain(WHY);
    expect(read).toContain('retracted');

    const again = runRetractNote(session, { id: captured.id, reason: WHY });
    expect(again).toMatchObject({ ok: false, code: 'ALREADY_RETRACTED' });
    const nowhere = runRetractNote(session, {
      id: '019f81f8-e400-7001-8000-0000000000ff',
      reason: WHY,
    });
    expect(nowhere).toMatchObject({ ok: false, code: 'UNKNOWN_NOTE' });
  });
});
