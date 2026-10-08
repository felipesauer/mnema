/**
 * `mnema rules <path>` and `mnema why <path>` are reads, and a read of a path that is a link is a
 * read of the bytes it leads to: the write gates already match a path where it really lands inside
 * the project (`realPathInside`), and a reader that said "nothing governs this" for the link while
 * the gate refused the write through it would disagree with what happened to the person.
 *
 * The path as written is read first and wins when a rule covers it; only a path no rule covers is
 * read again at the place the link leads to.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRules } from '../src/commands/rules.js';
import { runWhy } from '../src/commands/why.js';
import { type CliIo, run } from '../src/program.js';
import { withScopedCaches } from '../src/tree-sources.js';
import { whatAWriteMeets } from '../src/what-a-write-meets.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;

async function did(...argv: string[]): Promise<string> {
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
  expect(failed, `mnema ${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
  return out.join('\n');
}

/** A decision in force, linked to `path` under `governs`. */
async function ruleAt(title: string, path: string, rel = 'governs'): Promise<string> {
  const id = (await did('decision', 'record', title, `why ${title}`)).match(
    /\(([0-9a-f-]{20,})\)/,
  )?.[1] as string;
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  await did('link', id, path, '--rel', rel);
  return id;
}

const ruleIdsOf = (path: string): string[] => {
  const read = runRules({ cwd: repo, env }, { path });
  if (!read.ok) throw new Error('setup: no project');
  return read.governed.rules.map((rule) => rule.rule);
};

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-reads-link-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'ledger'), { recursive: true });
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mnema rules <path>', () => {
  it('names the rules of the file a link leads to, under the path as it was written', async () => {
    const rule = await ruleAt('The ledger is posted by the batch', 'src/ledger');
    writeFileSync(join(repo, 'src', 'ledger', 'posting.ts'), 'x');
    symlinkSync(
      join(repo, 'src', 'ledger', 'posting.ts'),
      join(repo, 'src', 'billing', 'alias.ts'),
    );

    const read = runRules({ cwd: repo, env }, { path: 'src/billing/alias.ts' });
    if (!read.ok) throw new Error('no project');
    expect(read.governed.rules.map((one) => one.rule)).toEqual([rule]);
    expect(read.governed.path).toBe(join(repo, 'src', 'billing', 'alias.ts'));
    expect(read.governed.relative).toBe('src/billing/alias.ts');
  });

  it('places a path under a directory that is a link, and one through a relative link in it', async () => {
    const rule = await ruleAt('The ledger is posted by the batch', 'src/ledger');
    mkdirSync(join(repo, 'src', 'deep', 'inner'), { recursive: true });
    symlinkSync(join(repo, 'src', 'ledger'), join(repo, 'src', 'billing', 'books'));
    symlinkSync(join(repo, 'src', 'deep', 'inner'), join(repo, 'src', 'rooms'));
    symlinkSync('../../ledger/later.ts', join(repo, 'src', 'deep', 'inner', 'rel.ts'));

    expect(ruleIdsOf('src/billing/books/new/deep.ts')).toEqual([rule]);
    expect(ruleIdsOf('src/rooms/rel.ts')).toEqual([rule]);
  });

  it('answers as written for a path no link moves, and for a link that leaves the project', async () => {
    await ruleAt('The ledger is posted by the batch', 'src/ledger');
    mkdirSync(join(sandbox, 'outside', 'ledger'), { recursive: true });
    symlinkSync(join(sandbox, 'outside', 'ledger'), join(repo, 'src', 'billing', 'away'));

    expect(ruleIdsOf('src/billing/invoice.ts')).toEqual([]);
    expect(ruleIdsOf('src/billing/away/posting.ts')).toEqual([]);
  });

  it('adds the rules of the place to those of the path as written, each once', async () => {
    const own = await ruleAt('Billing has its own reviewer', 'src/billing');
    const ledger = await ruleAt('The ledger is posted by the batch', 'src/ledger');
    symlinkSync(join(repo, 'src', 'ledger'), join(repo, 'src', 'billing', 'books'));

    // Most specific first: the ledger is as deep as billing, so the address orders them.
    expect(ruleIdsOf('src/billing/books/posting.ts').sort()).toEqual([own, ledger].sort());
    const read = runRules({ cwd: repo, env }, { path: 'src/billing/books/posting.ts' });
    if (!read.ok) throw new Error('no project');
    expect(read.governed.counts.matching).toBe(2);
  });

  it('lists the refusal the write gate applies, even when a rule over the whole project covers the path', async () => {
    await ruleAt('Everything here is reviewed', '.');
    const refusal = await ruleAt(
      'Nobody writes the ledger by hand',
      'src/ledger',
      'refuses-a-write',
    );
    symlinkSync(join(repo, 'src', 'ledger'), join(repo, 'src', 'billing', 'books'));
    const governs = await ruleAt('The ledger is posted by the batch', 'src/ledger');
    const path = 'src/billing/books/posting.ts';

    const read = runRules({ cwd: repo, env }, { path });
    if (!read.ok) throw new Error('no project');
    const gate = withScopedCaches(resolveTrees(repo, env), (sources) =>
      whatAWriteMeets(sources, { paths: [path], root: repo, from: repo }),
    );
    // The two surfaces agree: the gate refuses, and `rules` names the rule it refuses by.
    expect(gate?.grade).toBe('refuse');
    expect(read.governed.refuses.map((one) => one.rule)).toEqual([refusal]);
    expect(read.governed.counts.refuses.matching).toBe(1);
    const why = runWhy({ cwd: repo, env }, { target: path });
    if (!why.ok || why.about !== 'file') throw new Error('expected a file answer');
    // `why` cites the rules that govern: the ledger's, which the whole-project rule would hide.
    expect(why.rules.map((one) => one.id)).toContain(governs);
  });
});

describe('mnema why <path>', () => {
  it('names the rules of the file a link leads to', async () => {
    const rule = await ruleAt('The ledger is posted by the batch', 'src/ledger');
    writeFileSync(join(repo, 'src', 'ledger', 'posting.ts'), 'x');
    symlinkSync(
      join(repo, 'src', 'ledger', 'posting.ts'),
      join(repo, 'src', 'billing', 'alias.ts'),
    );

    const answer = runWhy({ cwd: repo, env }, { target: 'src/billing/alias.ts' });
    if (!answer.ok || answer.about !== 'file') throw new Error('expected a file answer');
    expect(answer.rules.map((one) => one.id)).toEqual([rule]);
    expect(answer.exists).toBe(true);
  });
});
