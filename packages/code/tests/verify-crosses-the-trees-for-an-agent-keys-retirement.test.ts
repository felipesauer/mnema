/**
 * `mnema verify` CROSSES THE TREES OF A PROJECT FOR AN AGENT KEY'S RETIREMENT.
 *
 * A retirement is a fact of the record that holds it (FORMAT.md section 6.2): each tree of a
 * project is a record of its own, and a private tree that has not received the retirement accepts
 * what the retired key signs there afterwards, and counts it as attested. Measured on the binary:
 * a second machine wrote as the agent into its private tree before it pulled the retirement, and
 * after the pull `verify` refused the committed tree's copy of that write and verified the private
 * one, with "1 event(s) attested" beside it.
 *
 * The command reads the trees together, so it says what it knows: an event signed by an agent key
 * that ANOTHER tree it verifies retired, with an `at` later than that retirement's, is a break of
 * the tree that holds it, named with the tree that retired the key, and is not counted as attested.
 * The second reader and the page read one tree at a time and do not make this cross, which
 * FORMAT.md says.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runVerify, type TreeVerdict } from '../src/commands/verify.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let home: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

async function mnema(agent: string | undefined, ...argv: string[]) {
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
  if (agent === undefined) delete process.env.MNEMA_AGENT_KEY;
  else process.env.MNEMA_AGENT_KEY = agent;
  try {
    await run(argv, io);
  } finally {
    delete process.env.MNEMA_AGENT_KEY;
  }
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

async function did(agent: string | undefined, ...argv: string[]): Promise<string> {
  const said = await mnema(agent, ...argv);
  expect(said.failed, `${argv.join(' ')}: ${said.err}`).toBe(false);
  return said.out;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-verify-crosses-the-trees-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  delete process.env.MNEMA_KEY_PASSPHRASE;
  process.chdir(repo);
  env = { home };
  await did(undefined, 'init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

/** The agent `bot`, made and enrolled in the three trees; its fingerprint. */
async function anEnrolledAgent(): Promise<string> {
  const trees = resolveTrees(repo, env);
  const founded = [
    ...orderedEvents({ root: trees.projectPublic as string }, catalogUpcasters()),
  ].find((event) => event.kind === 'identity.founded');
  const requested = await did(
    undefined,
    'key',
    'request',
    '--agent',
    'bot',
    '--anchor',
    founded?.subject as string,
  );
  await did(undefined, 'key', 'enroll', '--agent', 'bot');
  return requested.match(/\b[0-9a-f]{64}\b/)?.[0] as string;
}

/** The three trees as they are now, copied aside; a function that puts them back. */
function snapshot(name: string): () => void {
  const trees = resolveTrees(repo, env);
  const roots = [trees.projectPublic, trees.projectPrivate, trees.global] as string[];
  const kept = roots.map((root, i) => {
    const copy = join(sandbox, 'kept', name, String(i));
    cpSync(root, copy, { recursive: true });
    return copy;
  });
  return () => {
    roots.forEach((root, i) => {
      rmSync(root, { recursive: true, force: true });
      cpSync(kept[i] as string, root, { recursive: true });
    });
  };
}

function treeOf(scope: string): TreeVerdict {
  const verdict = runVerify({ cwd: repo, env, requirement: 'chained', global: false });
  if (!verdict.ok) throw new Error('no project');
  const tree = verdict.trees.find((one) => one.scope === scope);
  if (tree?.kind !== 'verdict') throw new Error(`no verdict over ${scope}`);
  return tree;
}

const attested = (tree: TreeVerdict): readonly string[] =>
  tree.result.census.flatMap((note) =>
    note.kind === 'attested-which' ? [`${note.name} ${note.events}`] : [],
  );

describe('mnema verify, over a project whose trees disagree about a retirement', () => {
  it('refuses, in the private tree, what the agent signed there after the committed tree retired it', async () => {
    const fingerprint = await anEnrolledAgent();
    await did('bot', 'memory', 'written while the key was in force', '--scope', 'private');
    // This machine before it pulled: every tree as it stands before the retirement.
    const beforeThePull = snapshot('before');
    await did(undefined, 'key', 'revoke', '--agent', fingerprint, '--reason', 'leaked');
    snapshot('after');
    beforeThePull();
    // The agent writes into the private tree, which has not heard of the retirement.
    await did('bot', 'memory', 'written after the retirement', '--scope', 'private');
    // The pull brings the committed tree that holds the retirement; the private tree stays as this
    // machine has it (in a project that is no repository, it is a folder inside the committed one).
    const trees = resolveTrees(repo, env);
    const aside = join(sandbox, 'private-as-it-is');
    cpSync(trees.projectPrivate as string, aside, { recursive: true });
    rmSync(trees.projectPublic as string, { recursive: true, force: true });
    cpSync(join(sandbox, 'kept', 'after', '0'), trees.projectPublic as string, {
      recursive: true,
    });
    rmSync(trees.projectPrivate as string, { recursive: true, force: true });
    cpSync(aside, trees.projectPrivate as string, { recursive: true });

    const priv = treeOf('private');

    expect(priv.result.ok).toBe(false);
    expect(priv.result.issues.map((issue) => issue.detail)).toEqual([
      expect.stringMatching(
        new RegExp(
          `^memory\\.captured is signed by ${fingerprint}, an agent key this project's committed tree retired at \\S+, which signs nothing after it$`,
        ),
      ),
    ]);
    // The fact signed while the key was in force is still attested; the one after is not.
    expect(attested(priv)).toEqual(['bot 1']);
    expect(treeOf('public').result.ok).toBe(true);
  });

  it('says nothing new of a project whose trees all hold the retirement', async () => {
    const fingerprint = await anEnrolledAgent();
    await did('bot', 'memory', 'written while the key was in force', '--scope', 'private');
    await did(undefined, 'key', 'revoke', '--agent', fingerprint, '--reason', 'leaked');

    const refused = await mnema('bot', 'memory', 'after', '--scope', 'private');

    expect(refused.failed).toBe(true);
    expect(treeOf('private').result.ok).toBe(true);
    expect(attested(treeOf('private'))).toEqual(['bot 1']);
    expect(treeOf('public').result.ok).toBe(true);
  });
});
