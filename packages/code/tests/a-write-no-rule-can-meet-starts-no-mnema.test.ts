/**
 * A write no rule can meet starts no `mnema`, in a host whose hooks are processes: the gate's
 * handler reads the stored lines of every tree itself (`plugin/hooks/an-address-can-be-met.mjs`)
 * and starts the verb only where one of them can hold a link with an address, or where it cannot
 * vouch for a line.
 *
 * THE ONE THING IT MUST NEVER DO IS NOT START IT WHERE A RULE IS. Each case below puts a rule (or a
 * line the reader refuses) where the handler could miss it, and runs the command `hooks.json`
 * declares for Cursor and for VS Code, with a `mnema` on the PATH that writes down every time it is
 * started and then runs the built binary: the rule in each of the three trees, a rule that arrived
 * by `git pull` with nothing written on this machine, a rule taken back, a tree that cannot be read,
 * and each line the reader refuses. And the other way: in a project with a record and no rule with
 * an address, nothing starts, and the host reads the same silence the verb would have answered.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADDRESS_RELATIONS,
  generateKeyPair,
  LATEST_VERSION,
  serializeCheckpoint,
  signCheckpoint,
} from '@mnema/chain';
import { resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/program.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const PLUGIN = join(REPO, 'plugin');
const HOOKS = join(PLUGIN, 'hooks', 'hooks.json');

let sandbox: string;
let repo: string;
let home: string;
let calls: string;
let bin: string;
let originalCwd: string;
let originalHome: string | undefined;
let originalMnemaHome: string | undefined;

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
  expect(failed, `${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
  return out.join('\n');
}

function idIn(said: string): string {
  const id = said.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said}`);
  return id;
}

/** An accepted decision, so the record holds a rule that is addressed nowhere yet. */
async function aRule(title: string, scope = 'public'): Promise<string> {
  const id = idIn(
    await did('decision', 'record', title, 'Because it was agreed', '--scope', scope),
  );
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  return id;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE, GIT_CONFIG_NOSYSTEM: '1' },
  });
}

/** The command `hooks.json` declares for a host's gate. */
function declared(handler: string, host?: string): string {
  const config = JSON.parse(readFileSync(HOOKS, 'utf-8')) as {
    hooks: Record<string, { hooks: { type: string; command?: string }[] }[]>;
  };
  const found = (config.hooks['PreToolUse'] ?? [])
    .flatMap((group) => group.hooks)
    .filter(
      (hook) =>
        hook.type === 'command' &&
        (hook.command ?? '').includes(handler) &&
        (host === undefined || (hook.command ?? '').includes(` --host ${host} `)),
    );
  expect(found.length).toBe(1);
  return found[0]?.command as string;
}

const HOSTS = {
  cursor: {
    command: () => declared('edit-refuses-a-write.mjs', 'cursor'),
    payload: (path: string) =>
      JSON.stringify({
        hook_event_name: 'preToolUse',
        tool_name: 'Write',
        tool_input: { file_path: path, content: 'x\n' },
      }),
    env: { CURSOR_VERSION: '2026.09.18' },
  },
  qwen: {
    command: () => declared('edit-refuses-a-write.mjs', 'qwen'),
    payload: (path: string) =>
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'write_file',
        tool_input: { file_path: path, content: 'x\n' },
      }),
    env: { QWEN_PROJECT_DIR: '/tmp/a-qwen-project' },
  },
  vscode: {
    command: () => declared('edit-asks-a-person.mjs'),
    payload: (path: string) =>
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'create_file',
        tool_input: { filePath: path, content: 'x\n' },
      }),
    env: {},
  },
} as const;

/**
 * What the host reads when it runs its gate on a write at `relative`, and how many times a
 * `mnema` was started for it.
 */
function aWrite(
  host: keyof typeof HOSTS,
  relative: string,
  at = repo,
  projectDir?: string,
): { decision: string | undefined; reason: string; started: number } {
  rmSync(calls, { force: true });
  const ran = spawnSync('sh', ['-c', HOSTS[host].command()], {
    cwd: at,
    input: HOSTS[host].payload(join(at, relative)),
    encoding: 'utf-8',
    env: {
      HOME: home,
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      MNEMA_CALLS: calls,
      CLAUDE_PLUGIN_ROOT: PLUGIN,
      ...(projectDir === undefined ? {} : { CLAUDE_PROJECT_DIR: projectDir }),
      ...HOSTS[host].env,
    },
  });
  expect(ran.status, ran.stderr).toBe(0);
  const started = existsSync(calls) ? readFileSync(calls, 'utf-8').trim().split('\n').length : 0;
  if (ran.stdout === '') return { decision: undefined, reason: '', started };
  const said = (JSON.parse(ran.stdout) as { hookSpecificOutput?: Record<string, string> })
    .hookSpecificOutput;
  return {
    decision: said?.['permissionDecision'],
    reason: said?.['permissionDecisionReason'] ?? '',
    started,
  };
}

/** The first segment of the tree at `root`. */
function theSegment(root: string): string {
  const tails = join(root, 'tails');
  const tail = readdirSync(tails)[0] as string;
  const segment = readdirSync(join(tails, tail)).find((file) => /^\d{6}\.jsonl$/.test(file));
  return join(tails, tail, segment as string);
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-no-rule-starts-nothing-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  calls = join(sandbox, 'calls.txt');
  bin = join(sandbox, 'bin');
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'mnema'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$MNEMA_CALLS"',
      `exec "${process.execPath}" "${CLI}" "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'mnema'), 0o755);
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalMnemaHome = process.env.MNEMA_HOME;
  process.env.HOME = home;
  delete process.env.MNEMA_HOME;
  delete process.env.MNEMA_RUN;
  // A repository, so the private tree lives in its git directory, out of the public one's reach.
  git(sandbox, 'init', '-q', repo);
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalMnemaHome === undefined) delete process.env.MNEMA_HOME;
  else process.env.MNEMA_HOME = originalMnemaHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the gate of a host whose hooks are processes', () => {
  it('starts no mnema where the record holds no rule with an address, and the host reads silence', async () => {
    await aRule('Bill in UTC');
    await did('memory', 'a note kept private', '--scope', 'private');
    await did('memory', 'a note kept global', '--scope', 'global');
    for (const host of ['cursor', 'vscode', 'qwen'] as const) {
      expect(aWrite(host, 'src/billing/invoice.ts'), host).toEqual({
        decision: undefined,
        reason: '',
        started: 0,
      });
    }
  });

  for (const scope of ['public', 'private'] as const) {
    it(`starts it, and the write is refused, where a rule of the ${scope} tree refuses it`, async () => {
      const rule = await aRule(`Nobody writes billing (${scope})`, scope);
      await did('link', rule, 'src/billing', '--rel', 'refuses-a-write', '--scope', scope);
      for (const host of ['cursor', 'vscode', 'qwen'] as const) {
        const met = aWrite(host, 'src/billing/invoice.ts');
        expect(met.started, `${scope}, ${host}`).toBe(1);
        expect(met.decision, `${scope}, ${host}`).toBe('deny');
        expect(met.reason).toContain(rule);
      }
    });
  }

  it('starts it where the global tree holds a link with an address, which addresses no project', async () => {
    // The verb reads no address out of the machine-global tree, so it answers nothing here; the
    // handler starts it all the same: it reads more than the verb, never less.
    const rule = await aRule('Nobody writes billing (global)', 'global');
    await did('link', rule, 'src/billing', '--rel', 'refuses-a-write', '--scope', 'global');
    expect(aWrite('cursor', 'src/billing/invoice.ts').started).toBe(1);
  });

  it('starts it where a line of the global tree cannot be read, and the write is refused', async () => {
    await aRule('Bill in UTC');
    await did('memory', 'a note kept global', '--scope', 'global');
    const segment = theSegment(resolveTrees(repo, { home }).global);
    const last = readFileSync(segment, 'utf-8').trimEnd().split('\n').at(-1) as string;
    appendFileSync(segment, `${last.replace(/"kind":"[a-z.]+"/, '"kind":"bogus.kind"')}\n`);
    for (const host of ['cursor', 'vscode', 'qwen'] as const) {
      const met = aWrite(host, 'src/billing/invoice.ts');
      expect(met.started, host).toBe(1);
      expect(met.decision, host).toBe('deny');
      expect(met.reason).toContain('This closes every project on this machine');
    }
  });

  it('starts it where a rule asks for a person, and VS Code asks', async () => {
    const rule = await aRule('Refunds need finance');
    await did('link', rule, 'src/billing', '--rel', 'asks-for-a-person');
    const met = aWrite('vscode', 'src/billing/invoice.ts');
    expect(met.started).toBe(1);
    expect(met.decision).toBe('ask');
  });

  it('starts it where a rule only governs a path, though the verb answers nothing there', async () => {
    const rule = await aRule('The ledger is UTC');
    await did('link', rule, 'src/billing', '--rel', 'governs');
    expect(aWrite('cursor', 'src/billing/invoice.ts')).toEqual({
      decision: undefined,
      reason: '',
      started: 1,
    });
  });

  it('starts it where a rule arrived by git pull, with nothing written on this machine', async () => {
    // A clone in which mnema never wrote: the rule is recorded in the other one and pulled.
    const rule = await aRule('Nobody writes billing');
    git(repo, 'add', '.mnema');
    git(repo, 'commit', '-q', '-m', 'the record');
    const clone = join(sandbox, 'clone');
    git(sandbox, 'clone', '-q', repo, clone);
    mkdirSync(join(clone, 'src', 'billing'), { recursive: true });
    expect(aWrite('cursor', 'src/billing/invoice.ts', clone).started).toBe(0);

    await did('link', rule, 'src/billing', '--rel', 'refuses-a-write');
    git(repo, 'add', '.mnema');
    git(repo, 'commit', '-q', '-m', 'the refusal');
    git(clone, 'pull', '-q', '--ff-only');

    for (const host of ['cursor', 'vscode', 'qwen'] as const) {
      const met = aWrite(host, 'src/billing/invoice.ts', clone);
      expect(met.started, host).toBe(1);
      expect(met.decision, host).toBe('deny');
    }
  });

  it('starts it where the rule was taken back, whatever the verb then answers', async () => {
    const rule = await aRule('Nobody writes billing');
    await did('link', rule, 'src/billing', '--rel', 'refuses-a-write');
    await did('unlink', rule, 'src/billing', '--rel', 'refuses-a-write', '--reason', 'no longer');
    const met = aWrite('cursor', 'src/billing/invoice.ts');
    expect(met.started).toBe(1);
    expect(met.decision).toBeUndefined();
  });

  it.skipIf(process.getuid?.() === 0)('starts it where a tree cannot be listed', async () => {
    await aRule('Bill in UTC');
    const tails = join(resolveTrees(repo, { home }).projectPublic as string, 'tails');
    chmodSync(tails, 0o000);
    try {
      expect(aWrite('cursor', 'src/billing/invoice.ts').started).toBe(1);
    } finally {
      chmodSync(tails, 0o755);
    }
  });

  it('starts it over every line the reader refuses, and the verb refuses the write', async () => {
    await aRule('Bill in UTC');
    const segment = theSegment(resolveTrees(repo, { home }).projectPublic as string);
    const sound = readFileSync(segment, 'utf-8');
    const last = sound.trimEnd().split('\n').at(-1) as string;
    expect(last).toMatch(/"payload":\{"/);
    const refused: Record<string, string> = {
      'not JSON': 'not json at all',
      'a kind it does not know': last.replace(/"kind":"[a-z.]+"/, '"kind":"bogus.kind"'),
      'a version it does not know': last.replace(/"v":1\b/, '"v":2'),
      'a field it does not know': last.replace('"payload":{"', '"payload":{"aaa_unknown":1,"'),
      'a field of the wrong shape': last.replace(/"at":"[^"]+"/, '"at":"yesterday"'),
      'bytes that are not canonical': `{ ${last.slice(1)}`,
      'a line ended by CRLF': `${last}\r`,
    };
    for (const [what, line] of Object.entries(refused)) {
      writeFileSync(segment, sound);
      appendFileSync(segment, `${line}\n`);
      const met = aWrite('cursor', 'src/billing/invoice.ts');
      expect(met.started, what).toBe(1);
      expect(met.decision, what).toBe('deny');
    }
  });
});

describe('where the session is named through a link', () => {
  // THE VERB RUNS WITH THE SESSION'S DIRECTORY AS ITS OWN, so the kernel resolves every link in it
  // and the verb climbs the REAL path. A handler that climbed the path as written would miss the
  // project from a link into it, or from `<link>/..`, and from a worktree whose `.git` names its
  // git directory relatively, and let the write through. Each case has a rule that refuses (met in
  // Cursor) and one that asks for a person (met in VS Code).
  async function twoRules(scope = 'public'): Promise<void> {
    const refusing = await aRule('Nobody writes billing', scope);
    await did('link', refusing, 'src/billing', '--rel', 'refuses-a-write', '--scope', scope);
    const asking = await aRule('Refunds need finance', scope);
    await did('link', asking, 'src/refunds', '--rel', 'asks-for-a-person', '--scope', scope);
  }

  function bothMet(root: string, projectDir: string): void {
    const refused = aWrite('cursor', 'src/billing/invoice.ts', root, projectDir);
    expect(refused.started, projectDir).toBe(1);
    expect(refused.decision, projectDir).toBe('deny');
    const asked = aWrite('vscode', 'src/refunds/r.ts', root, projectDir);
    expect(asked.started, projectDir).toBe(1);
    expect(asked.decision, projectDir).toBe('ask');
  }

  it('meets them from a link into the project', async () => {
    await twoRules();
    const link = join(sandbox, 'ws');
    symlinkSync(join(repo, 'src'), link);
    bothMet(repo, link);
  });

  it('meets them from `..` after a link, which climbs where the link leads', async () => {
    await twoRules();
    const link = join(sandbox, 'ws');
    symlinkSync(join(repo, 'src'), link);
    bothMet(repo, `${link}/..`);
  });

  it('meets them where the project directory is itself a link', async () => {
    await twoRules('private');
    const alias = join(sandbox, 'alias');
    symlinkSync(repo, alias);
    bothMet(repo, alias);
  });

  it('meets them in a worktree whose .git names its git directory relatively, through a link', async () => {
    git(repo, 'add', '.mnema');
    git(repo, 'commit', '-q', '-m', 'the record');
    const tree = join(sandbox, 'wt');
    git(repo, 'worktree', 'add', '-q', tree);
    writeFileSync(join(tree, '.git'), 'gitdir: ../repo/.git/worktrees/wt\n');
    mkdirSync(join(tree, 'src', 'billing'), { recursive: true });
    mkdirSync(join(tree, 'src', 'refunds'), { recursive: true });
    process.chdir(tree);
    await twoRules('private');
    const links = join(sandbox, 'links');
    mkdirSync(links);
    symlinkSync(tree, join(links, 'wt'));
    bothMet(tree, join(links, 'wt'));
  });
});

describe('what the handler holds of the format', () => {
  /** The handler's module, imported where it is asked: plain ESM the plugin ships unbuilt. */
  const theHandlers = () => import('../../../plugin/hooks/an-address-can-be-met.mjs');

  it('names every relation with an address the catalog names, and no other', async () => {
    const { ADDRESS_RELATIONS: THE_HANDLERS } = await theHandlers();
    expect([...THE_HANDLERS].sort()).toEqual([...ADDRESS_RELATIONS].sort());
  });

  it('reads only kinds the catalog declares, each with the very declaration the reader holds', () => {
    const copy = JSON.parse(
      readFileSync(join(PLUGIN, 'hooks', 'event-schema.json'), 'utf-8'),
    ) as SchemaFile;
    const published = JSON.parse(
      readFileSync(join(REPO, 'packages', 'chain', 'event-schema.json'), 'utf-8'),
    ) as SchemaFile;
    expect(copy.envelope).toEqual(published.envelope);
    expect(copy.transitionFields).toEqual(published.transitionFields);
    for (const contract of copy.contracts) {
      expect(LATEST_VERSION[contract.kind as keyof typeof LATEST_VERSION], contract.kind).toBe(
        contract.v,
      );
      expect(
        published.contracts.find((one) => one.kind === contract.kind && one.v === contract.v),
      ).toEqual(contract);
    }
  });

  it('reads a checkpoint line of each scheme the writer signs, by the very keys it stores', async () => {
    const { CHECKPOINT_KEYS } = await theHandlers();
    const keyPair = generateKeyPair();
    const tail = `${keyPair.fingerprint}-${'0a'.repeat(16)}`;
    const signed = (record?: string) =>
      JSON.parse(
        serializeCheckpoint(
          signCheckpoint({
            tail,
            fromSeq: 0,
            events: [],
            prev: null,
            keyPair,
            ...(record === undefined ? {} : { record }),
          }),
        ),
      ) as { scheme: string };
    const lines = [signed(), signed('ab'.repeat(32))];
    expect(Object.fromEntries(lines.map((line) => [line.scheme, Object.keys(line)]))).toEqual(
      CHECKPOINT_KEYS,
    );
  });

  it('doubts a checkpoint line the reader refuses, of a scheme it does not read or with a key more', async () => {
    const { anAddressCanBeMet } = await theHandlers();
    await aRule('Bill in UTC');
    expect(anAddressCanBeMet(repo, { HOME: home })).toBe(false);
    const segment = theSegment(resolveTrees(repo, { home }).projectPublic as string);
    const checkpoints = join(dirname(segment), 'checkpoints.jsonl');
    const sound = readFileSync(checkpoints, 'utf-8');
    const last = sound.trimEnd().split('\n').at(-1) as string;
    expect(last).toContain('"scheme":"mnema-checkpoint/2"');
    const refused: Record<string, string> = {
      'a third scheme': last.replace('mnema-checkpoint/2', 'mnema-checkpoint/3'),
      'a second scheme without its record': last.replace(/"record":"[0-9a-f]+",/, ''),
      'a first scheme with a record': last.replace('mnema-checkpoint/2', 'mnema-checkpoint/1'),
      'a record that is not text': last.replace(/"record":"[0-9a-f]+"/, '"record":7'),
      'a second scheme with a key more': last.replace('"prev":', '"extra":"x","prev":'),
    };
    for (const [what, line] of Object.entries(refused)) {
      expect(line, what).not.toBe(last);
      writeFileSync(checkpoints, `${sound}${line}\n`);
      expect(anAddressCanBeMet(repo, { HOME: home }), what).toBe(true);
    }
    writeFileSync(checkpoints, sound);
    expect(anAddressCanBeMet(repo, { HOME: home })).toBe(false);
  });

  it('answers that an address can be met where MNEMA_HOME is relative, which mnema refuses', async () => {
    const { anAddressCanBeMet } = await theHandlers();
    expect(anAddressCanBeMet(repo, { HOME: home })).toBe(false);
    expect(anAddressCanBeMet(repo, { HOME: home, MNEMA_HOME: 'relative' })).toBe(true);
  });

  it('answers that none can be met outside a project, where the verb answers nothing', async () => {
    const { anAddressCanBeMet } = await theHandlers();
    const outside = join(sandbox, 'outside');
    mkdirSync(outside);
    expect(anAddressCanBeMet(outside, { HOME: home })).toBe(false);
  });
});

interface SchemaFile {
  readonly envelope: Record<string, string>;
  readonly transitionFields: Record<string, string>;
  readonly contracts: readonly { kind: string; v: number; payload: Record<string, string> }[];
}
