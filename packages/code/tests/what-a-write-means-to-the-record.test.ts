/**
 * What a write means to the record: after a `Write` or an `Edit` in Claude Code, `mnema after-a-write`
 * copies a note of the host's own memory into the private tree (only where `host-memory-mirror` was
 * switched on), and beside a file that holds decisions the record cites nowhere, names once the
 * command that reads it.
 *
 * WHAT IS HELD HERE. The directory is the host's (`$CLAUDE_CONFIG_DIR`, the `autoMemoryDirectory`
 * setting in the files the host reads it from, and not the checked-in one); the index and a note
 * about the person are never copied; a note is copied once per content and into the private tree
 * only; nothing is copied while the channel is off, which is how it starts. A decision file is
 * named by its path or by what was written in it, never written for, never named once the record
 * cites it, and once per session. The count at `Stop` counts the copies. And the shell the hooks
 * file puts in front starts nothing for a common write, and starts the verb for a note.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_MEMORY_READER, runAfterAWrite } from '../src/commands/after-a-write.js';
import { runSessionTally } from '../src/commands/tally.js';
import { decisionFileAt } from '../src/decision-files.js';
import { hostMemoryMarker } from '../src/host-memory.js';
import { renderPlain } from '../src/presentation/plain.js';
import { type CliIo, run } from '../src/program.js';
import { STARTS_OFF } from '../src/record-framing.js';
import { registerAfterAWrite } from '../src/wiring/after-a-write.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const HOOKS = join(REPO, 'plugin', 'hooks', 'hooks.json');

let sandbox: string;
let repo: string;
let home: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;

/** Runs `mnema <argv>` in process and refuses to continue if it failed: setup, not assertion. */
async function did(...argv: string[]): Promise<void> {
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: () => {},
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  expect(failed, `${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
}

/** Writes `text` at `path`, making its directory. */
function wrote(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** A note as Claude Code writes one. */
function note(name: string, body: string, type = 'feedback'): string {
  return `---\nname: ${name}\ndescription: one line\ntype: ${type}\n---\n${body}\n`;
}

/** The payload Claude Code hands a `PostToolUse` hook on a write. */
function payload(file: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: file, content: readFileSafe(file) },
    tool_response: { filePath: file, type: 'create' },
    ...extra,
  });
}

function readFileSafe(file: string): string {
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

/** What the verb answers, as the host parses it. */
function answer(input: string, hostConfigDir?: string): Record<string, unknown> {
  const done = runAfterAWrite({ cwd: repo, env, hostConfigDir }, { payload: input });
  return JSON.parse(JSON.stringify(done.reply)) as Record<string, unknown>;
}

/** The memories recorded in one tree of the project. */
function memoriesIn(
  tree: 'projectPublic' | 'projectPrivate',
): Extract<CatalogEvent, { kind: 'memory.captured' }>[] {
  const root = resolveTrees(repo, env)[tree];
  if (root === undefined) return [];
  return orderedEvents({ root }, catalogUpcasters()).filter(
    (event): event is Extract<CatalogEvent, { kind: 'memory.captured' }> =>
      event.kind === 'memory.captured',
  );
}

/** Every event of both trees of the project: what "nothing was written" is measured against. */
function everyEvent(): number {
  const trees = resolveTrees(repo, env);
  return [trees.projectPublic, trees.projectPrivate]
    .filter((root): root is string => root !== undefined)
    .reduce((n, root) => n + orderedEvents({ root }, catalogUpcasters()).length, 0);
}

/**
 * The name the host gives a project's directory under `projects/`, written out here from what the
 * host's bundle and this machine's own `~/.claude/projects/` show: every character of the root that
 * is not an ASCII letter or digit becomes `-` (`/home/u/.p/x` is `-home-u--p-x`).
 */
const hostName = (root: string): string => root.replace(/[^a-zA-Z0-9]/g, '-');

/** The default directory of the host's memory for `root` (this project's, unless named), under `config`. */
const memoryDir = (config: string, root = repo): string =>
  join(config, 'projects', hostName(root), 'memory');

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-after-a-write-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  process.env.HOME = home;
  delete process.env.MNEMA_RUN;
  env = { home };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a note of the host’s memory', () => {
  it('is not copied while the channel is off, which is how it starts', () => {
    expect(STARTS_OFF).toContain('host-memory-mirror');
    const file = wrote(
      join(memoryDir(join(home, '.claude')), 'feedback_x.md'),
      note('X', 'Use pnpm.'),
    );
    expect(answer(payload(file))).toEqual({});
    expect(memoriesIn('projectPrivate')).toHaveLength(0);
  });

  it('is copied into the private tree, never the public one, once per content, and again when it changes', async () => {
    await did('switch', 'on', 'host-memory-mirror');
    const file = wrote(
      join(memoryDir(join(home, '.claude')), 'feedback_x.md'),
      note('Builds use pnpm', 'The build runs with pnpm, never npm.'),
    );
    const first = answer(payload(file));
    const [copied] = memoriesIn('projectPrivate');
    // The hash is of the whole file, frontmatter included, worked out once outside this code.
    expect(hostMemoryMarker(file, readFileSync(file, 'utf-8'))).toBe(
      '[host memory feedback_x.md sha256:df26d0c2d56f]',
    );
    expect(copied?.payload.content).toBe(
      'Builds use pnpm\n\nThe build runs with pnpm, never npm.\n\n[host memory feedback_x.md sha256:df26d0c2d56f]',
    );
    expect(copied?.which).toBe(HOST_MEMORY_READER);
    expect(memoriesIn('projectPublic')).toHaveLength(0);
    expect(first).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `This note of the host’s memory, feedback_x.md, was copied into this machine’s private tree of the project’s record as memory ${copied?.subject}.`,
      },
      systemMessage: `mnema copied the host memory note feedback_x.md into this machine’s private tree: ${copied?.subject}.`,
    });

    // The same content again (an Edit that changed nothing, a second hook): no second copy.
    expect(answer(payload(file, { tool_name: 'Edit' }))).toEqual({});
    expect(memoriesIn('projectPrivate')).toHaveLength(1);

    wrote(file, note('Builds use pnpm', 'The build runs with pnpm 10, never npm.'));
    answer(payload(file, { tool_name: 'Edit' }));
    expect(memoriesIn('projectPrivate')).toHaveLength(2);
    expect(memoriesIn('projectPublic')).toHaveLength(0);
  });

  it('leaves out the index and a note about the person, wherever its type is written', async () => {
    await did('switch', 'on', 'host-memory-mirror');
    const dir = memoryDir(join(home, '.claude'));
    const index = wrote(join(dir, 'MEMORY.md'), note('Index', '- [X](feedback_x.md)'));
    const person = wrote(join(dir, 'user_role.md'), note('Role', 'A data scientist.', 'user'));
    const nested = wrote(
      join(dir, 'user_tz.md'),
      '---\nname: Timezone\nmetadata:\n  node_type: memory\n  type: user\n---\nLives in UTC-4.\n',
    );
    // The host's own word is lower case; a note that spells it otherwise is the person's all the same.
    const shouted = wrote(join(dir, 'user_name.md'), note('Name', 'Called Ana.', 'User'));
    for (const file of [index, person, nested, shouted]) {
      expect(answer(payload(file)), file).toEqual({});
    }
    expect(memoriesIn('projectPrivate')).toHaveLength(0);
  });

  it('is read where $CLAUDE_CONFIG_DIR puts it, and not under ~/.claude then', async () => {
    await did('switch', 'on', 'host-memory-mirror');
    const config = join(sandbox, 'config');
    const moved = wrote(join(memoryDir(config), 'project_a.md'), note('A', 'Fact A.'));
    const old = wrote(join(memoryDir(join(home, '.claude')), 'project_b.md'), note('B', 'Fact B.'));
    expect(answer(payload(old), config)).toEqual({});
    expect(answer(payload(moved), config)).not.toEqual({});
    expect(memoriesIn('projectPrivate').map((one) => one.payload.content.split('\n')[0])).toEqual([
      'A',
    ]);
  });

  it('is read where autoMemoryDirectory puts it, from the person’s settings or the local ones, never the checked-in ones', async () => {
    await did('switch', 'on', 'host-memory-mirror');
    const custom = join(sandbox, 'notes');
    const there = wrote(join(custom, 'project_c.md'), note('C', 'Fact C.'));
    const default_ = wrote(
      join(memoryDir(join(home, '.claude')), 'project_d.md'),
      note('D', 'Fact D.'),
    );

    // Checked in: the host ignores it, and so does this.
    wrote(join(repo, '.claude', 'settings.json'), JSON.stringify({ autoMemoryDirectory: custom }));
    expect(answer(payload(there))).toEqual({});

    wrote(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ autoMemoryDirectory: '~/../notes' }),
    );
    expect(answer(payload(there))).not.toEqual({});
    expect(answer(payload(default_))).toEqual({});

    rmSync(join(home, '.claude', 'settings.json'));
    const local = join(sandbox, 'local');
    const inLocal = wrote(join(local, 'project_e.md'), note('E', 'Fact E.'));
    wrote(
      join(repo, '.claude', 'settings.local.json'),
      JSON.stringify({ autoMemoryDirectory: local }),
    );
    expect(answer(payload(inLocal))).not.toEqual({});
    expect(memoriesIn('projectPrivate').map((one) => one.payload.content.split('\n')[0])).toEqual([
      'C',
      'E',
    ]);
  });

  it('is only a direct child of the directory: a file beside it or under it is not one', async () => {
    await did('switch', 'on', 'host-memory-mirror');
    const config = join(home, '.claude');
    const under = wrote(join(memoryDir(config), 'old', 'project_f.md'), note('F', 'Fact F.'));
    const beside = wrote(join(home, 'memory', 'project_g.md'), note('G', 'Fact G.'));
    const otherTool = wrote(join(config, 'memory', 'project_h.md'), note('H', 'Fact H.'));
    for (const file of [under, beside, otherTool]) expect(answer(payload(file)), file).toEqual({});
    expect(memoriesIn('projectPrivate')).toHaveLength(0);
  });

  it('is this project’s alone: a note in another project’s directory is not copied', async () => {
    expect(hostName('/home/u/.projects/my repo')).toBe('-home-u--projects-my-repo');
    await did('switch', 'on', 'host-memory-mirror');
    const config = join(home, '.claude');
    const other = wrote(
      join(memoryDir(config, join(sandbox, 'other')), 'project_k.md'),
      note('K', 'Fact K, of another project.'),
    );
    const forged = wrote(
      join(config, 'projects', '-work-repo', 'memory', 'project_l.md'),
      note('L', 'Fact L.'),
    );
    for (const file of [other, forged]) expect(answer(payload(file)), file).toEqual({});
    expect(memoriesIn('projectPrivate')).toHaveLength(0);
    const mine = wrote(join(memoryDir(config), 'project_m.md'), note('M', 'Fact M.'));
    expect(answer(payload(mine))).not.toEqual({});
    expect(memoriesIn('projectPrivate')).toHaveLength(1);
  });

  it('in a linked worktree is the main working tree’s, as the host names it', async () => {
    const git = (cwd: string, ...args: string[]) => {
      const ran = spawnSync(
        'git',
        ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args],
        {
          cwd,
          encoding: 'utf-8',
          env: {
            ...process.env,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
          },
        },
      );
      expect(ran.status, `git ${args.join(' ')}: ${ran.stderr}`).toBe(0);
    };
    const main = join(sandbox, 'main');
    const linked = join(sandbox, 'linked');
    mkdirSync(main);
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'first');
    git(main, 'worktree', 'add', '-q', linked);
    process.chdir(linked);
    await did('init');
    await did('switch', 'on', 'host-memory-mirror');
    const config = join(home, '.claude');
    const asked = (file: string) =>
      runAfterAWrite({ cwd: linked, env }, { payload: payload(file) }).reply;
    const underItsOwnName = wrote(
      join(memoryDir(config, linked), 'project_n.md'),
      note('N', 'Fact N.'),
    );
    expect(asked(underItsOwnName)).toEqual({});
    const underTheMain = wrote(join(memoryDir(config, main), 'project_o.md'), note('O', 'Fact O.'));
    expect(asked(underTheMain)).toHaveProperty('systemMessage');
  });

  it('is only a note really inside the directory: a link in it that leads out is not copied', async () => {
    await did('switch', 'on', 'host-memory-mirror');
    const outside = wrote(join(sandbox, 'elsewhere', 'secret.md'), note('Secret', 'Not a note.'));
    const dir = memoryDir(join(home, '.claude'));
    mkdirSync(dir, { recursive: true });
    const link = join(dir, 'project_link.md');
    symlinkSync(outside, link);
    expect(answer(payload(link))).toEqual({});
    expect(memoriesIn('projectPrivate')).toHaveLength(0);
    // A link that stays inside it is a note there.
    const real = wrote(join(dir, 'project_real.md'), note('Real', 'A real note.'));
    symlinkSync(real, join(dir, 'project_alias.md'));
    expect(answer(payload(join(dir, 'project_alias.md')))).not.toEqual({});
  });

  it('is counted by the line at Stop', async () => {
    await did('switch', 'on', 'host-memory-mirror');
    const file = wrote(
      join(memoryDir(join(home, '.claude')), 'project_i.md'),
      note('I', 'Fact I.'),
    );
    const transcript = wrote(
      join(sandbox, 'session.jsonl'),
      `${[
        JSON.stringify({
          type: 'user',
          timestamp: '2020-01-01T00:00:00.000Z',
          message: { role: 'user', content: 'go' },
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2020-01-01T00:00:01.000Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 't1',
                name: 'Write',
                input: { file_path: join(repo, 'a.ts'), content: 'x' },
              },
            ],
          },
        }),
      ].join('\n')}\n`,
    );
    answer(payload(file));
    const tally = runSessionTally(
      { cwd: repo, env },
      { payload: JSON.stringify({ hook_event_name: 'Stop', transcript_path: transcript }) },
    );
    expect(JSON.stringify(tally.reply)).toContain(
      'and 1 note of this host’s memory was copied into this machine’s private tree.',
    );
  });
});

describe('a file that holds decisions', () => {
  it('is told by its path, or by what was written in it, and never the product’s own', () => {
    const CALL = 'Ruling: the cache stays in memory.';
    const NEVER = '- Never commit the generated files.';
    const PLAIN = 'Some prose about the build.';
    const TABLE: readonly (readonly [string, string, string | undefined])[] = [
      ['docs/adr/0001-use-sqlite.md', PLAIN, 'adr-directory:docs/adr'],
      ['docs/decisions/sub/0002-x.md', PLAIN, 'adr-directory:docs/decisions/sub'],
      ['services/api/adr/0003-y.md', PLAIN, 'adr-directory:services/api/adr'],
      ['docs/adr/diagram.png', PLAIN, undefined],
      ['CLAUDE.md', NEVER, 'record-decision'],
      ['packages/x/AGENTS.md', 'Decision: one store per package.', 'record-decision'],
      ['GEMINI.md', PLAIN, undefined],
      ['.claude/rules/testing.md', 'Use the real database instead of a mock.', 'record-decision'],
      ['.cursor/rules/style.mdc', NEVER, 'record-decision'],
      ['.github/copilot-instructions.md', NEVER, 'record-decision'],
      ['notes/release-plan.md', CALL, 'rulings'],
      ['handoff-auth.md', NEVER, 'record-decision'],
      ['ledger.md', PLAIN, undefined],
      ['README.md', NEVER, undefined],
      ['src/plan.ts', CALL, undefined],
      ['.mnema/README.md', CALL, undefined],
      ['MNEMA.md', CALL, undefined],
      ['.claude/rules/mnema.md', NEVER, undefined],
      ['.cursor/rules/mnema.mdc', NEVER, undefined],
    ];
    for (const [path, written, expected] of TABLE) {
      const found = decisionFileAt(path, written);
      const said =
        found === undefined
          ? undefined
          : found.door === 'adr-directory'
            ? `adr-directory:${found.directory}`
            : found.door;
      expect(said, path).toBe(expected);
    }
  });

  it('is named once per session with the command that reads it, and nothing is written for it', async () => {
    const file = wrote(join(repo, 'docs', 'adr', '0001-use-sqlite.md'), '# Use SQLite\n');
    const before = everyEvent();
    const reply = answer(payload(file, { transcript_path: join(sandbox, 'none.jsonl') }));
    const line =
      '`docs/adr/0001-use-sqlite.md` was written in a directory of decision files, and this project’s record cites it nowhere: `mnema decision import docs/adr` lists the decisions it would propose from there, and records them with `--write`.';
    expect(reply).toEqual({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: line },
    });
    expect(everyEvent()).toBe(before);

    // The host wrote that line into the transcript beside the result: a second write is told nothing.
    const transcript = wrote(
      join(sandbox, 'session.jsonl'),
      `${JSON.stringify({
        type: 'attachment',
        attachment: {
          type: 'hook_additional_context',
          content: [line],
          hookName: 'PostToolUse:Write',
          hookEvent: 'PostToolUse',
        },
      })}\n`,
    );
    expect(answer(payload(file, { transcript_path: transcript }))).toEqual({});
    // Another file, in the same session, is told.
    const other = wrote(join(repo, 'docs', 'adr', '0002-x.md'), '# X\n');
    expect(answer(payload(other, { transcript_path: transcript }))).not.toEqual({});
    expect(everyEvent()).toBe(before);
  });

  it('is not named once the record cites it, nor where the channel is off', async () => {
    const file = wrote(
      join(repo, 'docs', 'adr', '0001-use-sqlite.md'),
      '# Use SQLite\n\n## Context\n\nOne file.\n\n## Decision\n\nWe use SQLite.\n',
    );
    expect(answer(payload(file))).not.toEqual({});
    await did('decision', 'import', 'docs/adr', '--write');
    expect(answer(payload(file))).toEqual({});

    const plan = wrote(join(repo, 'plan.md'), 'Ruling: ship on Fridays.\n');
    expect(answer(payload(plan))).not.toEqual({});
    await did('switch', 'off', 'decision-file-written');
    expect(answer(payload(plan))).toEqual({});
  });
});

describe('the command the hooks file runs after a write', () => {
  /** A `mnema` on the PATH that writes down each start and then runs the built binary. */
  function shim(): { bin: string; starts: string } {
    const bin = join(sandbox, 'bin');
    const starts = join(sandbox, 'starts');
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, 'mnema'),
      [
        '#!/bin/sh',
        `echo "$*" >> "${starts}"`,
        `exec "${process.execPath}" "${CLI}" "$@"`,
        '',
      ].join('\n'),
    );
    chmodSync(join(bin, 'mnema'), 0o755);
    return { bin, starts };
  }

  const declared = (): string => {
    const hooks = JSON.parse(readFileSync(HOOKS, 'utf-8')) as {
      hooks: { PostToolUse: { matcher: string; hooks: { command: string }[] }[] };
    };
    const group = hooks.hooks.PostToolUse.find((one) =>
      one.hooks.some((hook) => hook.command.includes('after-a-write.mjs')),
    );
    expect(group?.matcher).toBe('Write|Edit');
    return group?.hooks[0]?.command ?? '';
  };

  it('starts nothing for a common write, and copies a note where the channel is on', async () => {
    const { bin, starts } = shim();
    const host = (input: string, extra: Record<string, string> = {}) =>
      spawnSync('sh', ['-c', declared()], {
        cwd: repo,
        input,
        encoding: 'utf-8',
        env: {
          HOME: home,
          PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
          CLAUDE_PROJECT_DIR: repo,
          CLAUDE_PLUGIN_ROOT: join(REPO, 'plugin'),
          ...extra,
        },
      });
    const common = wrote(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    const ran = host(payload(common));
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe('');
    expect(readFileSafe(starts)).toBe('');

    await did('switch', 'on', 'host-memory-mirror');
    const file = wrote(
      join(memoryDir(join(home, '.claude')), 'project_j.md'),
      note('J', 'Fact J.'),
    );
    // Cursor reads this file too, and says it is the host: turned away before anything starts.
    expect(host(payload(file), { CURSOR_VERSION: '1.0' }).stdout).toBe('');
    expect(readFileSafe(starts)).toBe('');
    const copied = host(payload(file));
    expect(copied.status).toBe(0);
    expect(JSON.parse(copied.stdout)).toMatchObject({
      systemMessage: expect.stringContaining('project_j.md'),
    });
    expect(memoriesIn('projectPrivate')).toHaveLength(1);
  });
});

describe('the verb as the command line routes it', () => {
  it('is a write, takes no option, and prints the reply as one JSON line', async () => {
    const seen = { out: [] as string[], err: [] as string[] };
    const file = join(repo, 'docs', 'adr', '0001-x.md');
    wrote(file, '# X\n');
    const io = {
      out: (line: string) => seen.out.push(line),
      err: (line: string) => seen.err.push(line),
      fail: () => {},
      input: async () => payload(file),
    };
    const program = new Command('mnema').exitOverride();
    const declared = registerAfterAWrite(program, {
      io,
      render: renderPlain,
    } as unknown as Parameters<typeof registerAfterAWrite>[1]);
    expect(declared.effect).toBe('mutates');
    expect(declared.act.options).toEqual([]);
    await program.parseAsync(['after-a-write'], { from: 'user' });
    expect(seen.out.map((line) => Object.keys(JSON.parse(line) as object))).toEqual([
      ['hookSpecificOutput'],
    ]);
    expect(seen.err).toEqual([]);
  });
});
