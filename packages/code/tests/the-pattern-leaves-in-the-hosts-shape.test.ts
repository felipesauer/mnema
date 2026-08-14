/**
 * `mnema skill export` at the surface: the file an agent host reads, written from the
 * record and changing nothing in it.
 *
 * FIVE THINGS HERE ARE THE FIVE A READER OF THE OUTPUT CANNOT CHECK.
 *
 * THE TWO OPTIONS REACH THE WORK (A2). `--out` is asserted by the file being under the
 * directory it named and nowhere else, and `--description` by its text being the field
 * in the file — which is what "the flag reaches" means for a verb whose whole product is
 * a file (the mould is `mcp-flag-reaches-the-server.test.ts`). Four defects of this
 * series were an option plumbed to the end with nothing feeding it.
 *
 * THE BODY IS VERBATIM. A sentinel is put inside the recorded body and read back out of
 * the file byte for byte, and the file is asserted to END with the body: the promise is
 * that everything after the frontmatter is what was signed, and a trailing newline
 * "tidied" in would break it.
 *
 * THE NAME IN THE FILE IS THE NAME OF THE DIRECTORY. That is the specification's own
 * rule and the one whose failure is silent — a host with a mismatched pair ignores the
 * skill and says nothing — so it is read off the file and compared to the path, never
 * to a constant written here.
 *
 * NOTHING REACHES THE RECORD. The whole project sandbox is hashed around the
 * invocation, which is available to this verb and not to most reads: the destination is
 * a second sandbox of its own, so the digest covers the chain, the caches AND the keys
 * with no writing of the export inside it. `--out` outside the record is not a
 * convenience of the fixture — it is the assertion.
 *
 * AND THE PROVENANCE IN THE FILE POINTS BACK AT THE RECORD. The id in `metadata` is fed
 * to `mnema show`, which is the check a third party holding the repository makes, and
 * the identity beside it is compared to what `mnema timeline` prints for the adoption.
 * A metadata line nobody can resolve is the one part of this file that would look like
 * proof and be decoration.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

let sandbox: string;
let repo: string;
/** The destination, in a sandbox of its OWN so the record's digest excludes it. */
let out: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** A line inside the recorded body that has to come out of the file unchanged. */
const SENTINEL = 'the-exact-line-somebody-signed';

/** The body every exported pattern here carries — one sentence, then the sentinel. */
const BODY = `Keep one slice per PR. ${SENTINEL}\n\n  and an indented tail`;

/** What one invocation wrote, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** Runs `mnema <argv>` the way the binary does, and reads both channels. */
async function mnema(...argv: string[]): Promise<Said> {
  const lines: string[] = [];
  const errors: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => lines.push(line),
    err: (line) => errors.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out: lines, err: errors, failed };
}

/** A content digest of every file under `dir` — the shape `guard.test.ts` established. */
function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${relative(dir, full)}\n`);
        walk(full);
      } else {
        hash.update(`F:${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/** Every file under the destination, so "wrote nothing" is a count and not a hope. */
function written(): string[] {
  if (!statSync(out, { throwIfNoEntry: false })?.isDirectory()) return [];
  return readdirSync(out, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(out, join(entry.parentPath, entry.name)));
}

/** The id `mnema skill` printed for a proposal. */
function idOf(said: Said): string {
  const found = /\(([0-9a-f-]{36})\)/.exec(said.out.join('\n'));
  if (found === null) throw new Error(`no id in: ${said.out.join('\n')}`);
  return found[1] as string;
}

/** Proposes a pattern under `name` and walks it to adopted, answering with its id. */
async function anAdoptedPattern(name: string, body = BODY): Promise<string> {
  const proposed = await mnema('skill', name, '--body', body);
  expect(proposed.failed, proposed.err.join(' / ')).toBe(false);
  const id = idOf(proposed);
  for (const [action, field, why] of [
    ['review', '--note', 'read it'],
    ['adopt', '--note', 'we work this way'],
  ] as const) {
    const moved = await mnema('skill', 'move', action, id, field, why);
    expect(moved.failed, moved.err.join(' / ')).toBe(false);
  }
  return id;
}

/** The value of one frontmatter field, read out of the file as a host's parser would. */
function field(file: string, key: string): string {
  const found = new RegExp(`^ *"${key}": "(.*)"$`, 'm').exec(file);
  if (found === null) throw new Error(`no ${key} in the frontmatter of: ${file}`);
  return found[1] as string;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-export-surface-'));
  out = mkdtempSync(join(tmpdir(), 'mnema-export-out-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
  const initiated = await mnema('init');
  expect(initiated.failed, initiated.err.join(' / ')).toBe(false);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
});

describe('mnema skill export', () => {
  it('writes <out>/<name>/SKILL.md, whose name IS the directory and whose description fits', async () => {
    const id = await anAdoptedPattern('stacked-prs');
    const said = await mnema('skill', 'export', id, '--out', out);
    expect(said.failed, said.err.join(' / ')).toBe(false);

    // The path the specification requires, and nothing else was created.
    expect(written()).toEqual([join('stacked-prs', 'SKILL.md')]);
    const file = readFileSync(join(out, 'stacked-prs', 'SKILL.md'), 'utf-8');

    // The rule whose failure is SILENT on a host: the frontmatter name and the name of
    // the directory holding the file are compared to each other, off the path that was
    // actually written, never to a literal in this file.
    const [directory] = written()[0]?.split('/') ?? [];
    expect(field(file, 'name')).toBe(directory);
    const description = field(file, 'description');
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    // The line a caller reads names the file it wrote.
    expect(said.out[0]).toContain(join(out, 'stacked-prs', 'SKILL.md'));
  });

  it('carries the recorded body verbatim, and the file ends where the body ends', async () => {
    const id = await anAdoptedPattern('stacked-prs');
    await mnema('skill', 'export', id, '--out', out);
    const file = readFileSync(join(out, 'stacked-prs', 'SKILL.md'), 'utf-8');
    expect(file).toContain(SENTINEL);
    // Not "contains the body" alone: everything after the closing `---` IS the body, so
    // a summary, a reflow or a newline added at the end would fail here.
    expect(file.endsWith(BODY)).toBe(true);
  });

  it('refuses a name that is not a specification name, and writes NOTHING', async () => {
    const id = await anAdoptedPattern('One slice per PR');
    const said = await mnema('skill', 'export', id, '--out', out);
    expect(said.failed).toBe(true);
    expect(said.err.join('\n')).toContain('Refused (NOT_A_SPEC_NAME)');
    expect(said.err.join('\n')).toContain('One slice per PR');
    // The second half, and it is the one that matters: a verb that refused and wrote
    // anyway would pass the first assertion.
    expect(written()).toEqual([]);
  });

  it('takes the caller’s --description, and derives one without it', async () => {
    const id = await anAdoptedPattern('stacked-prs');
    const file = join(out, 'stacked-prs', 'SKILL.md');

    const derived = await mnema('skill', 'export', id, '--out', out);
    expect(derived.failed, derived.err.join(' / ')).toBe(false);
    expect(field(readFileSync(file, 'utf-8'), 'description')).toBe('Keep one slice per PR.');
    // The rule is SAID, not only applied: a caller who cannot see how the field was
    // produced cannot judge whether the host will choose the right pattern.
    expect(derived.out.join('\n')).toContain('derived here from the body');

    const given = await mnema(
      'skill',
      'export',
      id,
      '--out',
      out,
      '--description',
      'Use when a PR grows past one slice.',
    );
    expect(given.failed, given.err.join(' / ')).toBe(false);
    expect(field(readFileSync(file, 'utf-8'), 'description')).toBe(
      'Use when a PR grows past one slice.',
    );
    expect(given.out.join('\n')).toContain('as you gave it with --description');
  });

  it('writes nothing to the record: the project sandbox is byte-identical after it', async () => {
    const id = await anAdoptedPattern('stacked-prs');
    // Export once first, so anything a first read builds (the projection cache) is
    // already there and the digest is measuring THIS invocation.
    await mnema('skill', 'export', id, '--out', out);

    const before = digest(sandbox);
    const said = await mnema('skill', 'export', id, '--out', out);
    expect(said.failed, said.err.join(' / ')).toBe(false);
    expect(written()).toEqual([join('stacked-prs', 'SKILL.md')]);
    // The record, the caches and the key material — the destination is a sandbox of its
    // own, so what is hashed here is everything the export must not have touched.
    expect(digest(sandbox)).toBe(before);
  });

  it('puts a provenance in the file that resolves back to this record', async () => {
    const id = await anAdoptedPattern('stacked-prs');
    await mnema('skill', 'export', id, '--out', out);
    const file = readFileSync(join(out, 'stacked-prs', 'SKILL.md'), 'utf-8');

    // The id in the file is the id of the pattern, and `mnema show` — the check a third
    // party with the repository makes — reads the pattern back with it.
    expect(field(file, 'mnema-id')).toBe(id);
    const shown = await mnema('show', field(file, 'mnema-id'));
    expect(shown.failed, shown.err.join(' / ')).toBe(false);
    expect(shown.out.join('\n')).toContain(SENTINEL);

    // And the identity beside it is the one the history names for the adoption — WHOLE
    // in the file, and the short form the read prints is a prefix of it. Asserted as
    // that relation rather than against a slice of a fixed width, because how far an
    // anchor is shortened is a property of the identities the record holds.
    const anchor = field(file, 'mnema-adopted-by');
    expect(anchor).toMatch(/^mnid:[0-9a-f]{64}$/);
    const history = await mnema('timeline', id);
    const printed = /mnid:[0-9a-f]+/.exec(history.out.join('\n'));
    expect(printed, 'the history printed no identity').not.toBeNull();
    expect(anchor.startsWith(printed?.[0] ?? 'nothing')).toBe(true);
  });

  it('refuses the group’s own options rather than accepting one it cannot honour', async () => {
    const id = await anAdoptedPattern('stacked-prs');
    for (const leaked of [
      ['--which', 'agent-alpha'],
      ['--scope', 'private'],
      ['--body', 'a body'],
    ] as const) {
      const said = await mnema('skill', 'export', id, '--out', out, ...leaked);
      expect(said.failed, `${leaked[0]} was accepted`).toBe(true);
      expect(said.err.join('\n')).toContain(`takes no ${leaked[0]}`);
      expect(written()).toEqual([]);
    }
  });
});
