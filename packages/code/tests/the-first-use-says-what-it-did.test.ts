/**
 * THE FIRST USE SAYS WHAT IT DID AND WHAT COMES NEXT — one case per friction a first walkthrough
 * from a clone measured, each against the built command line.
 *
 * Every case below was a sentence a person was left to find: `status` refused for want of a flag
 * the person had no way to know, `init` left them to discover that `.mnema/` is committed and what
 * to type next, `ADR-1` — the name every write prints — was refused as an address with the same
 * words as an id that exists nowhere, a supersede by a proposal answered like a clean
 * replacement while the project was left with no rule in force, and `timeline` listed four events
 * all called `decision.transitioned`.
 *
 * The cases run the command line in-process on a sandbox `HOME` (so the machine's key is the
 * sandbox's) and read what it prints. `.git` is an empty directory where a case needs a
 * repository: the product only asks whether one is there, never runs git.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDecisionTransition } from '../src/commands/decision-transition.js';
import { resolveAddress } from '../src/label-as-address.js';
import { successorOnlyForASupersede, supersedeLeavesNothingInForce } from '../src/moved-record.js';
import { occurrenceLine } from '../src/presentation/occurrence.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let home: string;
const before = {
  cwd: process.cwd(),
  home: process.env.HOME,
  mnemaHome: process.env.MNEMA_HOME,
  run: process.env.MNEMA_RUN,
};

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-first-use-'));
  home = join(sandbox, 'home');
  mkdirSync(home);
  process.env.HOME = home;
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
});

afterEach(() => {
  process.chdir(before.cwd);
  if (before.home === undefined) delete process.env.HOME;
  else process.env.HOME = before.home;
  if (before.mnemaHome !== undefined) process.env.MNEMA_HOME = before.mnemaHome;
  if (before.run !== undefined) process.env.MNEMA_RUN = before.run;
  rmSync(sandbox, { recursive: true, force: true });
});

/** Runs one command line and says what it printed, on both streams, and whether it failed. */
async function mnema(...argv: string[]): Promise<{ out: string; err: string; failed: boolean }> {
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
  await run(['--color=never', ...argv], io);
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

/** A directory inside the sandbox, made, with the process standing in it. */
function repo(name = 'repo', { git = true }: { git?: boolean } = {}): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  if (git) mkdirSync(join(dir, '.git'));
  process.chdir(dir);
  return dir;
}

/** The id inside `Recorded decision ADR-1 (<id>)`. */
function idOf(said: string): string {
  const id = /\(([0-9a-f-]{36})\)/.exec(said)?.[1];
  expect(id, said).toBeDefined();
  return id as string;
}

/** Every file under a directory, relative to it. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('status without --actor', () => {
  it('reports as the identity this machine writes as here, and says so', async () => {
    repo();
    const init = await mnema('init');
    const anchor = /identity: (mnid:[0-9a-f]+)/.exec(init.out)?.[1] as string;
    const asked = await mnema('status', '--actor', anchor);
    const unasked = await mnema('status');
    expect(unasked.failed).toBe(false);
    expect(unasked.out).toContain('The identity this machine writes as in this project.');
    // The same report, line for line, with that one line added and nothing else changed.
    expect(
      unasked.out
        .split('\n')
        .filter((line) => !line.includes('The identity this machine writes as in this project')),
    ).toEqual(asked.out.split('\n'));
    expect(asked.out).not.toContain('The identity this machine writes as');
  });

  it('shows the decision bases it has never read, without a flag', async () => {
    const dir = repo();
    mkdirSync(join(dir, 'docs', 'adr'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'adr', '0001-a.md'), '# A\n\n## Context\n\nwhy\n');
    await mnema('init');
    const said = await mnema('status');
    expect(said.out).toContain('Never imported:');
    expect(said.out).toContain('docs/adr (1) — mnema decision import docs/adr');
  });

  it('names a machine with no key as having no identity, and writes nothing to it', async () => {
    repo();
    await mnema('init');
    // Another machine reading the same checkout: a home of its own, with no key in it.
    const other = join(sandbox, 'other-home');
    mkdirSync(other);
    process.env.HOME = other;
    const said = await mnema('status');
    expect(said.failed).toBe(true);
    expect(said.err).toContain('Refused (NO_IDENTITY)');
    expect(said.err).toContain('--actor <id>');
    // A read founds nobody: not one file appeared under the home that was asked.
    expect(filesUnder(other)).toEqual([]);
  });

  it('still takes --actor, and still refuses one it cannot resolve', async () => {
    repo();
    await mnema('init');
    const said = await mnema('status', '--actor', 'mnid:nobody');
    expect(said.failed).toBe(true);
  });
});

describe('init says what comes next', () => {
  it('tells a person to commit .mnema/, what to type, and the bases it has never read', async () => {
    const dir = repo();
    mkdirSync(join(dir, 'docs', 'adr'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'adr', '0001-a.md'), '# A\n\n## Context\n\nwhy\n');
    writeFileSync(join(dir, 'docs', 'adr', '0002-b.md'), '# B\n\n## Context\n\nwhy\n');
    const said = await mnema('init');
    expect(said.out).toContain('Commit `.mnema/` with the repository');
    expect(said.out).toContain('Next: `mnema decision record <title> <rationale>`');
    expect(said.out).toContain(
      'docs/adr holds 2 decision document(s) this record has never read: `mnema decision import docs/adr`',
    );
    expect(said.out).not.toContain('not the root of the git repository');
  });

  it('says nothing about a base that is not there, and nothing about git where there is none', async () => {
    repo('plain', { git: false });
    const said = await mnema('init');
    expect(said.out).toContain('Next: `mnema decision record <title> <rationale>`');
    expect(said.out).not.toContain('Commit `.mnema/`');
    expect(said.out).not.toContain('never read');
  });

  it('warns when the directory is not the root of the git repository', async () => {
    const dir = repo();
    mkdirSync(join(dir, 'src'));
    process.chdir(join(dir, 'src'));
    const said = await mnema('init');
    expect(said.out).toContain(`This is not the root of the git repository (${dir})`);
    expect(said.out).toContain('run `mnema init` there instead');
  });

  it('says nothing more the second time: a project already here is not founded again', async () => {
    repo();
    await mnema('init');
    const again = await mnema('init');
    expect(again.out).toContain('Already a mnema project');
    expect(again.out).not.toContain('Commit `.mnema/`');
    expect(again.out).not.toContain('Next:');
  });
});

describe('ADR-<n> as an address', () => {
  it('moves the decision it names, on the verbs that take an id', async () => {
    repo();
    await mnema('init');
    const id = idOf((await mnema('decision', 'record', 'Use UTC', 'three zones')).out);
    const shown = await mnema('show', 'ADR-1');
    expect(shown.failed).toBe(false);
    expect(shown.out).toContain(id);
    const moved = await mnema('decision', 'move', 'accept', 'ADR-1', '--note', 'agreed');
    expect(moved.failed).toBe(false);
    expect(moved.out).toContain(id);
  });

  it('lists every id when two trees number the same label', async () => {
    repo();
    await mnema('init');
    const publicId = idOf((await mnema('decision', 'record', 'Use UTC', 'three zones')).out);
    const privateId = idOf(
      (await mnema('decision', 'record', 'Use ISO', 'one format', '--scope', 'private')).out,
    );
    for (const argv of [
      ['show', 'ADR-1'],
      ['decision', 'move', 'accept', 'ADR-1', '--note', 'agreed'],
    ]) {
      const said = await mnema(...argv);
      expect(said.failed, argv.join(' ')).toBe(true);
      expect(said.err, argv.join(' ')).toContain('ADR-1 names 2 decisions here');
      expect(said.err, argv.join(' ')).toContain(publicId);
      expect(said.err, argv.join(' ')).toContain(privateId);
    }
  });

  it('is taken for the successor of a supersede too', async () => {
    repo();
    await mnema('init');
    const old = idOf((await mnema('decision', 'record', 'Use UTC', 'three zones')).out);
    const next = idOf((await mnema('decision', 'record', 'Use ISO instants', 'one format')).out);
    const said = await mnema('decision', 'supersede', old, 'ADR-2', '--reason', 'newer');
    expect(said.failed).toBe(false);
    expect(said.out).toContain(old);
    const shown = await mnema('show', next);
    expect(shown.out).toContain(old);
  });

  it('is decided in one place, from the record, whoever asks', async () => {
    const dir = repo();
    await mnema('init');
    const id = idOf((await mnema('decision', 'record', 'Use UTC', 'three zones')).out);
    const here = { cwd: dir, env: { home } };
    expect(resolveAddress(here, 'ADR-1')).toEqual({ ok: true, id });
    // Case does not matter to a person typing it, and a surrounding space is not part of it.
    expect(resolveAddress(here, ' adr-1 ')).toEqual({ ok: true, id });
    // A label no decision carries, and anything that is not shaped like one, stand as typed.
    expect(resolveAddress(here, 'ADR-2')).toEqual({ ok: true, id: 'ADR-2' });
    expect(resolveAddress(here, 'ADR-1x')).toEqual({ ok: true, id: 'ADR-1x' });
    expect(resolveAddress(here, id)).toEqual({ ok: true, id });
  });

  it('adds nothing to an id that is simply not there, and nothing to a label no decision has', async () => {
    repo();
    await mnema('init');
    await mnema('decision', 'record', 'Use UTC', 'three zones');
    for (const typed of ['0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44', 'ADR-9', 'adr-x']) {
      const said = await mnema('show', typed);
      expect(said.failed, typed).toBe(true);
      expect(said.err, typed).not.toContain('names');
    }
  });
});

describe('a supersede by a proposal', () => {
  it('says that nothing is in force until a person accepts the successor', async () => {
    repo();
    await mnema('init');
    const old = idOf((await mnema('decision', 'record', 'Use UTC', 'three zones')).out);
    await mnema('decision', 'move', 'accept', old, '--note', 'agreed');
    const next = idOf((await mnema('decision', 'record', 'Use ISO instants', 'one format')).out);
    const said = await mnema('decision', 'supersede', old, next, '--reason', 'newer');
    expect(said.failed).toBe(false);
    expect(said.out).toContain('→ superseded');
    expect(said.out).toContain(
      `ADR-2 (${next}) is still proposed, so nothing is in force on this subject until a person accepts it`,
    );
  });

  it('is quiet when the successor is already in force', async () => {
    repo();
    await mnema('init');
    const old = idOf((await mnema('decision', 'record', 'Use UTC', 'three zones')).out);
    const next = idOf((await mnema('decision', 'record', 'Use ISO instants', 'one format')).out);
    await mnema('decision', 'move', 'accept', next, '--note', 'agreed');
    const said = await mnema('decision', 'supersede', old, next, '--reason', 'newer');
    expect(said.out).toContain('→ superseded');
    expect(said.out).not.toContain('still proposed');
  });

  it('is one function for both surfaces, and it reads the successor’s state off the record', async () => {
    const dir = repo();
    await mnema('init');
    const old = idOf((await mnema('decision', 'record', 'Use UTC', 'three zones')).out);
    const next = idOf((await mnema('decision', 'record', 'Use ISO instants', 'one format')).out);
    const root = join(dir, '.mnema');
    expect(supersedeLeavesNothingInForce(root, next, catalogUpcasters())).toContain(
      'still proposed',
    );
    await mnema('decision', 'move', 'accept', next, '--note', 'agreed');
    expect(supersedeLeavesNothingInForce(root, next, catalogUpcasters())).toBeUndefined();
    expect(supersedeLeavesNothingInForce(root, old, catalogUpcasters())).toContain(
      'still proposed',
    );
    expect(
      supersedeLeavesNothingInForce(root, 'no-such-decision', catalogUpcasters()),
    ).toBeUndefined();
  });
});

describe('a verdict on several decisions at once', () => {
  it('moves each id on its own account, one signed fact each, from one command', async () => {
    repo();
    await mnema('init');
    const ids: string[] = [];
    for (const title of ['Use UTC', 'Use ISO instants', 'Keep money as integer cents']) {
      ids.push(idOf((await mnema('decision', 'record', title, 'a reason')).out));
    }
    const said = await mnema('decision', 'move', 'accept', ...ids, '--note', 'agreed in review');
    expect(said.failed).toBe(false);
    expect(said.out.split('\n')).toEqual([
      `Decision ADR-1 (${ids[0]}) → accepted`,
      `Decision ADR-2 (${ids[1]}) → accepted`,
      `Decision ADR-3 (${ids[2]}) → accepted`,
    ]);
    // ONE FACT PER ID: each decision's own history carries its own acceptance, with the note.
    for (const id of ids) {
      const history = await mnema('timeline', id);
      expect(history.out.match(/decision\.transitioned\s+→ accepted/g)).toHaveLength(1);
      expect(history.out).toContain('note: agreed in review');
    }
  });

  it('refuses the ones it cannot move, moves the others, and says how many', async () => {
    repo();
    await mnema('init');
    const a = idOf((await mnema('decision', 'record', 'Use UTC', 'a reason')).out);
    const b = idOf((await mnema('decision', 'record', 'Use ISO instants', 'a reason')).out);
    const missing = '0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44';
    const said = await mnema('decision', 'move', 'accept', a, missing, b, '--note', 'agreed');
    expect(said.failed).toBe(true);
    expect(said.out.split('\n')).toEqual([
      `Decision ADR-1 (${a}) → accepted`,
      `Decision ADR-2 (${b}) → accepted`,
    ]);
    expect(said.err).toContain(`No decision ${missing} here.`);
    expect(said.err).toContain(
      'Moved 2 of 3; the rest were refused above and nothing was written for them.',
    );
  });

  it('is the same line as before for one id', async () => {
    repo();
    await mnema('init');
    const id = idOf((await mnema('decision', 'record', 'Use UTC', 'a reason')).out);
    const said = await mnema('decision', 'move', 'accept', id, '--note', 'agreed');
    expect(said.out).toBe(`Decision ADR-1 (${id}) → accepted`);
    expect(said.err).toBe('');
  });
});

describe('timeline', () => {
  it('names the move on every transition line', async () => {
    repo();
    await mnema('init');
    const old = idOf((await mnema('decision', 'record', 'Use UTC', 'three zones')).out);
    const next = idOf((await mnema('decision', 'record', 'Use ISO instants', 'one format')).out);
    await mnema('decision', 'move', 'accept', old, '--note', 'agreed');
    await mnema('decision', 'supersede', old, next, '--reason', 'newer');
    const said = await mnema('timeline', old);
    const kinds = said.out
      .split('\n')
      .map((line) => /decision\.\w+(?:\s+→ \w+)?/.exec(line)?.[0]?.replace(/\s+/g, ' '))
      .filter((kind) => kind !== undefined);
    expect(kinds).toEqual([
      'decision.recorded',
      'decision.transitioned → proposed',
      'decision.transitioned → accepted',
      'decision.transitioned → superseded',
    ]);
  });
});

describe('the agent’s surface says what the command line says', () => {
  const read = (path: string): string =>
    readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf-8');

  it('asks the supersede question of the one function, from both surfaces that move a decision', () => {
    for (const path of ['commands/decision-transition.ts', 'mcp/tools.ts']) {
      expect(read(path), path).toContain('supersedeLeavesNothingInForce(');
      // The sentence itself lives in `moved-record.ts` only: a second spelling is a second rule.
      expect(read(path), path).not.toContain('still proposed');
    }
    expect(read('moved-record.ts')).toContain('is still proposed, so nothing is in force');
  });

  it('asks the successor question of one function too: only a supersede reads `by`', async () => {
    for (const path of ['commands/decision-transition.ts', 'mcp/tools.ts']) {
      expect(read(path), path).toContain('successorOnlyForASupersede(');
    }
    expect(successorOnlyForASupersede('supersede', 'd')).toBeUndefined();
    expect(successorOnlyForASupersede('accept', undefined)).toBeUndefined();
    expect(successorOnlyForASupersede('accept', 'd')).toContain('was not recorded');
    expect(successorOnlyForASupersede('reject', 'd')).toContain('"reject" takes none');
    // And the command line's own function refuses it the same way, with nothing appended.
    const dir = repo();
    await mnema('init');
    const id = idOf((await mnema('decision', 'record', 'Use UTC', 'three zones')).out);
    const refused = runDecisionTransition(
      { cwd: dir, env: { home } },
      { id, action: 'accept', by: id, proof: { note: 'agreed' } },
    );
    expect(refused).toMatchObject({ ok: false, code: 'UNREAD_FIELD' });
    const history = await mnema('timeline', id);
    expect(history.out).not.toContain('→ accepted');
  });

  it('hands the notice to the reply on the agent’s side and to the lines on the command line', () => {
    expect(read('mcp/server.ts')).toContain('result.notice');
    expect(read('wiring/decision.ts')).toContain('result.notice');
  });

  it('writes the move on the line of an occurrence arriving, the same way the history does', () => {
    const arriving = occurrenceLine({
      v: 1,
      kind: 'decision.transitioned',
      at: '2026-10-01T10:00:00.000Z',
      subject: 'd1',
      who: 'a-person',
      payload: { from: 'proposed', to: 'accepted', action: 'accept' },
    } as unknown as CatalogEvent);
    expect(JSON.stringify(arriving)).toMatch(/decision\.transitioned[\s\S]*→ accepted/);
  });
});
