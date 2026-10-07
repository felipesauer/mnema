/**
 * `mnema promote`, end to end on the real binary and a home of its own: what the listing
 * shows is what the write accepts, and what it leaves out the write refuses by name with
 * the global tree untouched. The copy is read back by the verbs a clone has (`show`,
 * `verify`) with no kind the reader does not already know.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const BODY = 'Run the whole suite before every push, on the committed tree.';

let sandbox: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-promote-'));
  home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface Ran {
  readonly status: number | null;
  readonly out: string;
  readonly err: string;
}

function run(cwd: string, ...argv: string[]): Ran {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  return { status: ran.status, out: ran.stdout, err: ran.stderr };
}

function ok(cwd: string, ...argv: string[]): string {
  const ran = run(cwd, ...argv);
  expect(ran.status, ran.err).toBe(0);
  return ran.out;
}

function project(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir);
  ok(dir, 'init');
  return dir;
}

const idIn = (out: string): string => /\(([0-9a-f-]{36})\)/.exec(out)?.[1] as string;

/** A skill adopted in `dir`, in the tree `scope` names (public by default). Returns its id. */
function adoptedSkill(dir: string, name: string, body: string, scope = 'public'): string {
  const id = idIn(ok(dir, 'skill', 'create', name, '--body', body, '--scope', scope));
  ok(dir, 'skill', 'move', 'review', id, '--note', 'read');
  ok(dir, 'skill', 'move', 'adopt', id, '--note', 'good');
  return id;
}

/** Every file under the machine-global tree, with its size: equal before and after = untouched. */
function globalTree(): string {
  const root = join(home, '.mnema', 'global');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : [`${join(dir, entry.name)} ${statSync(join(dir, entry.name)).size}`],
    );
  try {
    return walk(root).sort().join('\n');
  } catch {
    return '';
  }
}

describe('mnema promote', () => {
  it('lists what recurs, and writes nothing', () => {
    const a = project('a');
    const b = project('b');
    const idA = adoptedSkill(a, 'Run the suite', BODY);
    const idB = adoptedSkill(b, 'Run the suite', BODY);
    const before = globalTree();

    const listed = ok(b, 'promote', '--workspace', a, b);
    expect(listed).toContain('skill "Run the suite"');
    expect(listed).toContain(idA);
    expect(listed).toContain(idB);
    expect(listed).toContain(a);
    expect(globalTree()).toBe(before);
  }, 60_000);

  it('copies what it listed, born proposed, citing every id, and offers it no more', () => {
    const a = project('a');
    const b = project('b');
    const idA = adoptedSkill(a, 'Run the suite', BODY);
    const idB = adoptedSkill(b, 'Run the suite', BODY);
    expect(ok(b, 'promote', '--workspace', a, b)).toContain(idA);

    const done = ok(b, 'promote', idB, '--evidence', `${a}:${idA}`);
    expect(done).toContain('Promoted skill "Run the suite"');
    const copy = idIn(done);
    expect(copy).not.toBe(idA);
    expect(copy).not.toBe(idB);

    const shown = ok(b, 'show', copy);
    expect(shown).toContain(BODY);
    expect(shown).toContain('proposed');
    expect(shown).toContain(idA);
    expect(shown).toContain(idB);
    expect(shown).not.toContain('governs');
    // The global tree the copy is in verifies with the reader as it stands: no kind of its own.
    expect(run(b, 'verify', '--global').status).toBe(0);
    // And it is not offered again.
    expect(ok(b, 'promote', '--workspace', a, b)).toContain('Nothing recurs');
    // The originals are where they were.
    expect(ok(a, 'show', idA)).toContain('adopted');
  }, 90_000);

  it('refuses, by name and with the global tree untouched, what the listing does not show', () => {
    const a = project('a');
    const b = project('b');
    const c = project('c');
    const idA = adoptedSkill(a, 'Run the suite', BODY);
    const idB = adoptedSkill(b, 'Run the suite', BODY);
    const other = adoptedSkill(c, 'Run the suite', 'Never run anything; ship.');
    const proposedOnly = idIn(ok(c, 'skill', 'create', 'Run the suite', '--body', BODY));
    const before = globalTree();

    const refuse = (cwd: string, id: string, ...evidence: string[]): string => {
      const ran = run(cwd, 'promote', id, ...evidence.flatMap((e) => ['--evidence', e]));
      expect(ran.status, ran.out).not.toBe(0);
      return ran.err;
    };
    expect(refuse(b, idB, `${c}:${other}`)).toContain('NOT_THE_SAME');
    expect(refuse(b, idB, `${c}:${proposedOnly}`)).toContain('UNKNOWN_INSTANCE');
    expect(refuse(b, idB, `${b}:${idB}`)).toContain('ONE_PROJECT');
    expect(refuse(b, idB, `${a}:no-such-id`)).toContain('UNKNOWN_INSTANCE');
    expect(refuse(b, idB, 'no-colon')).toContain('BAD_EVIDENCE');
    expect(refuse(b, idB)).toContain('NO_EVIDENCE');
    expect(globalTree()).toBe(before);
    expect(idA).not.toBe(idB);
  }, 120_000);

  it('promotes a decision with its rationale, and carries what it turned down', () => {
    const a = project('a');
    const b = project('b');
    const decide = (dir: string): string => {
      const id = idIn(
        ok(dir, 'decision', 'record', 'Use pnpm', 'One lockfile.', '--alternatives', 'npm'),
      );
      ok(dir, 'decision', 'move', 'accept', id, '--note', 'ok');
      return id;
    };
    const idA = decide(a);
    const idB = decide(b);
    const done = ok(b, 'promote', idB, '--evidence', `${a}:${idA}`);
    expect(done).toContain('Promoted decision "Use pnpm"');
    const shown = ok(b, 'show', idIn(done));
    expect(shown).toContain('One lockfile.');
    expect(shown).toContain('npm');
  }, 90_000);
});
