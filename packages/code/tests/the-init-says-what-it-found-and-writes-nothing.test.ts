/**
 * WHAT `mnema init` FINDS AROUND THE FOLDER, AND WHAT ITS PLAN PROMISES, are read before anything is written, and
 * the writing then keeps the plan (`init/detect.ts`, `init/plan.ts`, `init/run.ts`).
 *
 * WHAT IS HELD:
 *   - FINDING WRITES NOTHING. The folder and the home are digested before and after the reading, for a folder that
 *     holds every kind of thing it looks for.
 *   - EACH FACT IS READ OFF THE DISK: the branch off `.git/HEAD`, a host from the file or the folder that says it
 *     is in use, a person's file by what it holds of the block (the function a write is decided by), the decision
 *     bases, the formatter. A detected host is the only thing that is checked when the question opens, and where
 *     nothing is detected every host is.
 *   - THE PLAN IS WHAT THE WRITING DOES. For every combination of hosts, over a folder with files of the person's
 *     in it, the files the plan names with `create` and `add to` are exactly the files that exist or changed
 *     afterwards, and a file the plan says it `leave`s is byte for byte what it was.
 *   - A FILE THE WRITE WOULD REFUSE IS SAID TO BE LEFT, not created: a block somebody edited.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectAround } from '../src/init/detect.js';
import { defaultMarks, marksForHosts } from '../src/init/flow.js';
import { HOST_NAMES_OFFERED, hostMark, readHostsFlag, yoursMark } from '../src/init/hosts.js';
import { planOf } from '../src/init/plan.js';
import { shownFrom } from '../src/init/run.js';
import { INSTRUCTIONS_BLOCK } from '../src/instructions-block.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let home: string;
let repo: string;
const kept = { cwd: process.cwd(), home: process.env.HOME };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-init-found-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'shop');
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

function digestOf(directory: string): Record<string, string> {
  const digests: Record<string, string> = {};
  const walk = (at: string, prefix: string): void => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(at, entry.name), relative);
      else {
        digests[relative] = createHash('sha256')
          .update(readFileSync(join(at, entry.name)))
          .digest('hex');
      }
    }
  };
  walk(directory, '');
  return digests;
}

async function alone(argv: readonly string[]): Promise<{ out: string; failed: boolean }> {
  const out: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out: out.join('\n'), failed };
}

/** The folder the first screen is drawn for in the study of this screen: a repository with a little of everything. */
function aShop(): void {
  mkdirSync(join(repo, '.git'));
  writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(repo, 'AGENTS.md'), '# Mine\n');
  writeFileSync(join(repo, 'CLAUDE.md'), '# Claude, mine\n');
  mkdirSync(join(repo, '.cursor'));
  mkdirSync(join(repo, 'docs', 'decisions'), { recursive: true });
  writeFileSync(
    join(repo, 'docs', 'decisions', '0001-a-choice.md'),
    '# 1. A choice\n\n## Status\nAccepted\n',
  );
  writeFileSync(join(repo, 'package.json'), '{"devDependencies":{"prettier":"^3"}}\n');
}

describe('what is found', () => {
  it('writes nothing: the folder and the home are digested before and after', () => {
    aShop();
    const before = { project: digestOf(repo), home: digestOf(home) };
    detectAround(repo);
    expect(digestOf(repo)).toEqual(before.project);
    expect(digestOf(home)).toEqual(before.home);
  });

  it('reads the branch from the head, and whether the folder is the root of the repository', () => {
    aShop();
    const around = detectAround(repo);
    expect(around.folder).toBe('shop');
    expect(around.git).toEqual({ root: repo, atRoot: true, branch: 'main' });

    mkdirSync(join(repo, 'packages', 'web'), { recursive: true });
    const below = detectAround(join(repo, 'packages', 'web'));
    expect(below.git?.atRoot).toBe(false);
    expect(below.git?.root).toBe(repo);

    writeFileSync(join(repo, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
    expect(detectAround(repo).git?.branch).toBeUndefined();
  });

  it('says no repository where there is none', () => {
    expect(detectAround(repo).git).toBeUndefined();
  });

  it('finds the hosts in use by the file or folder that says so, and the files by what they hold', () => {
    aShop();
    const around = detectAround(repo);
    expect([...around.detected.entries()].sort()).toEqual([
      ['claude', 'CLAUDE.md'],
      ['codex', 'AGENTS.md'],
      ['cursor', '.cursor/'],
    ]);
    const said = Object.fromEntries(around.found.map((found) => [found.path, found.what]));
    expect(said['AGENTS.md']).toBe('yours, no mnema block in it');
    expect(said['CLAUDE.md']).toBe('yours, no mnema block in it');
    expect(said['.cursor/']).toBe('a Cursor folder');
    expect(said['docs/decisions/']).toBe('1 decision file the record has never read');
    expect(said['package.json']).toBe('declares prettier');
    expect(around.formatter).toBe(true);
    expect(around.neverImported).toEqual([{ directory: 'docs/decisions', documents: 1 }]);
    expect(around.prettierIgnore?.did).toBe('created');
  });

  it('says a block it wrote, and a block somebody edited, as what they are', () => {
    writeFileSync(join(repo, 'AGENTS.md'), `# Mine\n\n${INSTRUCTIONS_BLOCK}`);
    writeFileSync(
      join(repo, 'CLAUDE.md'),
      `# Mine\n${INSTRUCTIONS_BLOCK.replace('call `bootstrap`', 'call `bootstrap` (edited)')}`,
    );
    const said = Object.fromEntries(
      detectAround(repo).found.map((found) => [found.path, found.what]),
    );
    expect(said['AGENTS.md']).toBe('already holds the mnema block');
    expect(said['CLAUDE.md']).toBe('holds a mnema block somebody edited: left as it is');
  });

  it('opens with the hosts found checked, every host where none was, and the person’s own files checked', () => {
    expect([...defaultMarks(detectAround(repo))].sort()).toEqual(
      HOST_NAMES_OFFERED.map(hostMark).sort(),
    );
    aShop();
    writeFileSync(join(repo, 'GEMINI.md'), '# Gemini, mine\n');
    expect([...defaultMarks(detectAround(repo))].sort()).toEqual(
      [
        hostMark('claude'),
        hostMark('cursor'),
        hostMark('codex'),
        yoursMark('CLAUDE.md'),
        yoursMark('GEMINI.md'),
      ].sort(),
    );
  });

  it('reads `--hosts` as names, words, or a refusal that names what it could not read', () => {
    expect(readHostsFlag('cursor, claude')).toEqual({
      ok: true,
      hosts: ['claude', 'cursor'],
      detected: false,
    });
    expect(readHostsFlag('all')).toEqual({ ok: true, hosts: HOST_NAMES_OFFERED, detected: false });
    expect(readHostsFlag('none')).toEqual({ ok: true, hosts: [], detected: false });
    expect(readHostsFlag('detected')).toEqual({ ok: true, hosts: [], detected: true });
    expect(readHostsFlag('cursor,pi')).toEqual({ ok: false, unknown: 'pi' });
    expect(readHostsFlag('all,cursor')).toEqual({ ok: false, unknown: 'all' });
    expect(readHostsFlag('')).toEqual({ ok: false, unknown: '' });
  });
});

describe('what the plan says of a path', () => {
  it('tells the home as `~`, and only a path under it: a folder that merely starts the same is not it', () => {
    const shown = shownFrom('/home/someone');
    expect(shown('/home/someone')).toBe('~');
    expect(shown('/home/someone/.mnema/identity')).toBe('~/.mnema/identity');
    expect(shown('/home/someone-else/.mnema')).toBe('/home/someone-else/.mnema');
    expect(shown('/srv/shop')).toBe('/srv/shop');
    expect(shownFrom('')('/srv/shop')).toBe('/srv/shop');
  });
});

describe('the plan', { timeout: 120_000 }, () => {
  const machine = { newIdentity: true, where: '~/.mnema/identity/' };

  /** The repository paths a plan says it will make or add to. */
  const named = (rows: ReturnType<typeof planOf>): string[] =>
    rows
      .filter(
        (row) => row.section === 'repository' && (row.verb === 'create' || row.verb === 'add to'),
      )
      .map((row) => row.what)
      .filter((what) => what !== '.mnema/')
      .sort();

  it('names exactly the files the founding then writes, for every combination of hosts', async () => {
    aShop();
    writeFileSync(join(repo, 'GEMINI.md'), '# Gemini, mine\n');
    const hosts = HOST_NAMES_OFFERED;
    const results: string[] = [];
    for (let bits = 0; bits < 2 ** hosts.length; bits += 1) {
      const picked = hosts.filter((_, at) => (bits >> at) % 2 === 1);
      const flag = picked.length === 0 ? 'none' : picked.join(',');
      const around = detectAround(repo);
      const asked = readHostsFlag(flag);
      if (!asked.ok) throw new Error('the case built a flag that does not read');
      const marks = marksForHosts(around, asked.hosts, false);
      const promised = named(planOf(repo, around, { marks }, machine));
      const before = digestOf(repo);
      await alone(['init', '--hosts', flag]);
      const after = digestOf(repo);
      const changed = Object.keys(after)
        .filter((path) => !path.startsWith('.mnema/') && !path.startsWith('.git/'))
        .filter((path) => before[path] !== after[path])
        .sort();
      results.push(`${flag}: ${changed.join(' ')}`);
      expect(changed, flag).toEqual(promised);
      // Back to the shop for the next combination: the record and every file the founding made or changed.
      rmSync(join(repo, '.mnema'), { recursive: true });
      for (const path of changed) {
        if (path in before) writeFileSync(join(repo, path), readOriginal(path));
        else rmSync(join(repo, path), { recursive: true, force: true });
      }
      rmSync(join(home, '.mnema'), { recursive: true, force: true });
    }
    expect(results).toHaveLength(16);
  });

  /** What the shop's files held before the founding touched them. */
  function readOriginal(path: string): string {
    const originals: Record<string, string> = {
      'AGENTS.md': '# Mine\n',
      'CLAUDE.md': '# Claude, mine\n',
      'GEMINI.md': '# Gemini, mine\n',
    };
    return originals[path] as string;
  }

  it('says `leave` for a file whose block was edited, and the writing leaves it byte for byte', async () => {
    const edited = `# Mine\n${INSTRUCTIONS_BLOCK.replace('call `bootstrap`', 'call `bootstrap` (edited)')}`;
    writeFileSync(join(repo, 'AGENTS.md'), edited);
    const around = detectAround(repo);
    const marks = marksForHosts(around, ['codex'], false);
    const rows = planOf(repo, around, { marks }, machine);
    expect(rows.find((row) => row.what === 'AGENTS.md')?.verb).toBe('leave');
    expect(named(rows)).not.toContain('AGENTS.md');
    await alone(['init', '--hosts', 'codex']);
    expect(readFileSync(join(repo, 'AGENTS.md'), 'utf-8')).toBe(edited);
  });

  it('says `keep` where the block is already there, and `replace` where an earlier version’s is', () => {
    writeFileSync(join(repo, 'AGENTS.md'), `# Mine\n\n${INSTRUCTIONS_BLOCK}`);
    const around = detectAround(repo);
    const rows = planOf(repo, around, { marks: marksForHosts(around, ['codex'], false) }, machine);
    expect(rows.find((row) => row.what === 'AGENTS.md')?.verb).toBe('keep');
  });

  it('puts what is made before what is added to, then the facts recorded, then this machine', () => {
    aShop();
    const around = detectAround(repo);
    const rows = planOf(repo, around, { marks: defaultMarks(around), accepts: 'yes' }, machine);
    expect(rows.map((row) => `${row.verb} ${row.what}`)).toEqual([
      'create .mnema/',
      'create .prettierignore',
      'create .claude/rules/mnema-instructions.md',
      'create .cursor/rules/mnema-instructions.mdc',
      'add to CLAUDE.md',
      'add to AGENTS.md',
      'record 1 decision, yours',
      'create ~/.mnema/identity/',
    ]);
    expect(rows[rows.length - 1]?.section).toBe('machine');
  });

  it('says a machine that has an identity uses it, and one that has none makes one', () => {
    const around = detectAround(repo);
    const last = (newIdentity: boolean) =>
      planOf(repo, around, { marks: new Set() }, { newIdentity, where: '~/.mnema/identity/' }).at(
        -1,
      );
    expect(last(true)?.verb).toBe('create');
    expect(last(false)?.verb).toBe('use');
  });
});
