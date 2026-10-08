/**
 * The gate, in a host whose hooks are processes: VS Code's agent runs the plugin's command before
 * a write, and where a rule of the record asks for a person at the path, the write waits for one.
 *
 * WHAT IS MEASURED AND WHAT IS HELD HERE. That VS Code 1.137 with Copilot Chat 0.65 runs a plugin's
 * `PreToolUse` command before `create_file`, ignores the hook's matcher, hands the path as
 * `tool_input.filePath`, and holds the write when the reply carries `permissionDecision: "ask"` —
 * that is the host, and it was measured against the real window, with the real plugin and the
 * built binary. What a suite can hold is this product's half: that
 * `mnema before-a-write --host vscode` asks exactly where the MCP tool would, records the same
 * facts first, and says nothing everywhere else; that the plugin's command reaches it for a write
 * and not for a read; and that the tools the plugin names are the tools the verb reads.
 *
 * THE PAYLOADS ARE THE HOST'S OWN SHAPE. `create_file` is the one measured byte for byte (the
 * fields a hook received, minus the session's ids); the other five follow the input schemas the
 * host publishes for its tools, which is what `host-hook.ts` reads.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { pathsOfAWrite, writeToolsOf } from '../src/host-hook.js';
import { HOOK_HOSTS } from '../src/host-names.js';
import { type CliIo, run } from '../src/program.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const PLUGIN = join(REPO, 'plugin');
const HOOKS = join(PLUGIN, 'hooks', 'hooks.json');

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;
let asking: string;
let governing: string;

/** Runs `mnema <argv>` in process and refuses to continue if it failed — setup, not assertion. */
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

/** The id in the parentheses of an echo. */
function idIn(said: string): string {
  const id = said.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said}`);
  return id;
}

/** The payload VS Code hands a hook before `create_file`, for a path under the repository. */
function createFile(relative: string): string {
  return JSON.stringify({
    timestamp: '2026-09-30T18:34:18.438Z',
    hook_event_name: 'PreToolUse',
    tool_name: 'create_file',
    tool_input: { filePath: join(repo, relative), content: 'export const written = 1;\n' },
    tool_use_id: 'call_probe_0001__vscode-1',
    cwd: repo,
  });
}

/** Every event of the public tree, in order. */
function publicEvents(): CatalogEvent[] {
  return orderedEvents(
    { root: resolveTrees(repo, env).projectPublic as string },
    catalogUpcasters(),
  );
}

/** The askings the public tree holds, as `rule @ path by which`. */
function askings(): string[] {
  return publicEvents().flatMap((event) =>
    event.kind === 'channel.asked'
      ? [`${event.payload.rule} @ ${event.payload.path} by ${event.which ?? '-'}`]
      : [],
  );
}

/** The service facts the public tree holds, by the channel each names. */
function services(): string[] {
  return publicEvents().flatMap((event) =>
    event.kind === 'channel.served' ? [event.subject] : [],
  );
}

/** What the verb answers, as the host parses it, and what it said beside it. */
function answer(payload: string): { reply: Record<string, unknown>; notes: readonly string[] } {
  const done = runBeforeAWrite({ cwd: repo, env }, { host: 'vscode', payload });
  return {
    reply: JSON.parse(JSON.stringify(done.reply)) as Record<string, unknown>,
    notes: done.notes,
  };
}

/** The permission decision in a reply, or nothing. */
function decided(reply: Record<string, unknown>): {
  value?: string;
  reason?: string;
  event?: string;
} {
  const specific = reply['hookSpecificOutput'] as
    | { hookEventName?: string; permissionDecision?: string; permissionDecisionReason?: string }
    | undefined;
  return {
    ...(specific?.permissionDecision !== undefined ? { value: specific.permissionDecision } : {}),
    ...(specific?.permissionDecisionReason !== undefined
      ? { reason: specific.permissionDecisionReason }
      : {}),
    ...(specific?.hookEventName !== undefined ? { event: specific.hookEventName } : {}),
  };
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-host-gate-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  mkdirSync(join(repo, 'src', 'other'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did('init');
  asking = idIn(
    await did('decision', 'record', 'Refunds need finance', 'Money leaves the company'),
  );
  await did('decision', 'move', 'accept', asking, '--note', 'agreed');
  await did('link', asking, 'src/billing', '--rel', 'asks-for-a-person');
  governing = idIn(await did('decision', 'record', 'Bill in UTC', 'The ledger is UTC'));
  await did('decision', 'move', 'accept', governing, '--note', 'agreed');
  await did('link', governing, 'src/other', '--rel', 'governs');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mnema before-a-write --host vscode', () => {
  it('asks where a rule asks, citing it, and records the asking before it answers', () => {
    const { reply, notes } = answer(createFile('src/billing/invoice.ts'));
    const said = decided(reply);
    expect(said.event).toBe('PreToolUse');
    expect(said.value).toBe('ask');
    expect(said.reason).toContain(
      'asks that a person look at src/billing/invoice.ts before it is written',
    );
    expect(said.reason).toContain(asking);
    expect(notes).toEqual([]);
    // The same facts the MCP tool appends: one asking per rule, citing it and the path, and the
    // service of the gate — attributed to the host that ran the hook.
    expect(askings()).toEqual([`${asking} @ src/billing/invoice.ts by vscode`]);
    expect(services()).toEqual(['edit-asks-a-person']);
  });

  it('answers nothing for a tool that does not write, and writes nothing', () => {
    const before = publicEvents().length;
    const read = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'read_file',
      tool_input: { filePath: join(repo, 'src/billing/invoice.ts'), startLine: 1, endLine: 2 },
    });
    expect(answer(read)).toEqual({ reply: {}, notes: [] });
    expect(publicEvents().length).toBe(before);
  });

  it('answers nothing where no rule asks — a rule that only governs included', () => {
    const before = publicEvents().length;
    // `src/other` is GOVERNED, and the text that informs is not this door's to carry: it would
    // record a service fact on every edit, which the fact's own declaration refuses.
    expect(answer(createFile('src/other/ledger.ts'))).toEqual({ reply: {}, notes: [] });
    expect(answer(createFile('README.md'))).toEqual({ reply: {}, notes: [] });
    expect(publicEvents().length).toBe(before);
  });

  it('answers nothing when the gate is switched off', async () => {
    await did('switch', 'off', 'edit-asks-a-person');
    const before = publicEvents().length;
    expect(answer(createFile('src/billing/invoice.ts'))).toEqual({ reply: {}, notes: [] });
    expect(publicEvents().length).toBe(before);
  });

  it('answers nothing outside a project', () => {
    const elsewhere = join(sandbox, 'elsewhere');
    mkdirSync(elsewhere);
    const done = runBeforeAWrite(
      { cwd: elsewhere, env },
      { host: 'vscode', payload: createFile('src/billing/invoice.ts').replaceAll(repo, elsewhere) },
    );
    expect(done).toEqual({ ok: true, reply: {}, notes: [] });
  });

  it('asks about every path a write touches, and names only the ones a rule asks about', () => {
    const multi = JSON.stringify({
      tool_name: 'multi_replace_string_in_file',
      tool_input: {
        explanation: 'two files',
        replacements: [
          { filePath: join(repo, 'src/other/ledger.ts'), oldString: 'a', newString: 'b' },
          { filePath: join(repo, 'src/billing/refund.ts'), oldString: 'a', newString: 'b' },
        ],
      },
    });
    const said = decided(answer(multi).reply);
    expect(said.value).toBe('ask');
    expect(said.reason).toContain('look at src/billing/refund.ts');
    expect(said.reason).not.toContain('src/other/ledger.ts');
    expect(askings()).toEqual([`${asking} @ src/billing/refund.ts by vscode`]);
  });

  it('says on the second stream when a write names no path it can read, and asks nothing', () => {
    const blind = JSON.stringify({ tool_name: 'create_file', tool_input: { content: 'x' } });
    const { reply, notes } = answer(blind);
    expect(reply).toEqual({});
    expect(notes).toEqual([
      'The create_file input named no path this command can read, so nothing was asked.',
    ]);
    expect(answer('not json')).toEqual({
      reply: {},
      notes: ['The hook input was not JSON, so no write was read.'],
    });
  });
});

describe('what a VS Code write names', () => {
  const at = '/w';
  it('reads the path of every tool that writes, in the field each one carries it', () => {
    const one = (tool: string, input: Record<string, unknown>) =>
      pathsOfAWrite('vscode', { tool_name: tool, tool_input: input });
    expect(one('create_file', { filePath: `${at}/a.ts`, content: '' })).toEqual([`${at}/a.ts`]);
    expect(
      one('replace_string_in_file', { filePath: `${at}/a.ts`, oldString: 'x', newString: 'y' }),
    ).toEqual([`${at}/a.ts`]);
    expect(
      one('insert_edit_into_file', { filePath: `${at}/a.ts`, code: 'x', explanation: 'e' }),
    ).toEqual([`${at}/a.ts`]);
    expect(
      one('edit_notebook_file', { filePath: `${at}/n.ipynb`, cellId: 'TOP', editType: 'insert' }),
    ).toEqual([`${at}/n.ipynb`]);
    expect(
      one('multi_replace_string_in_file', {
        replacements: [
          { filePath: `${at}/a.ts` },
          { filePath: `${at}/b.ts` },
          { filePath: `${at}/a.ts` },
        ],
      }),
    ).toEqual([`${at}/a.ts`, `${at}/b.ts`]);
    // A patch names its files on the lines that open them — added, updated, deleted, moved to.
    const patch = [
      '*** Begin Patch',
      `*** Update File: ${at}/u.ts`,
      '@@',
      '-a',
      '+*** Add File: not-a-header-inside-a-hunk.ts',
      `*** Move to: ${at}/moved.ts`,
      `*** Add File: ${at}/new.ts`,
      '+x',
      `*** Delete File: ${at}/gone.ts`,
      '*** End Patch',
    ].join('\n');
    expect(one('apply_patch', { input: patch, explanation: 'e' })).toEqual([
      `${at}/u.ts`,
      `${at}/moved.ts`,
      `${at}/new.ts`,
      `${at}/gone.ts`,
    ]);
  });

  it('tells a tool that does not write from a write that named no path', () => {
    expect(
      pathsOfAWrite('vscode', { tool_name: 'read_file', tool_input: { filePath: '/w/a.ts' } }),
    ).toBeUndefined();
    expect(
      pathsOfAWrite('vscode', {
        tool_name: 'run_in_terminal',
        tool_input: { command: 'echo create_file' },
      }),
    ).toBeUndefined();
    expect(pathsOfAWrite('vscode', { tool_name: 'create_file' })).toEqual([]);
    expect(pathsOfAWrite('vscode', 'create_file')).toBeUndefined();
  });
});

describe('the plugin command VS Code runs', () => {
  /** The declared command whose handler is the gate's, read off `hooks.json`. */
  function declared(): { readonly matcher: string; readonly command: string } {
    const config = JSON.parse(readFileSync(HOOKS, 'utf-8')) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string; command?: string }[] }[]>;
    };
    const found = (config.hooks['PreToolUse'] ?? []).flatMap((group) =>
      group.hooks
        .filter(
          (hook) =>
            hook.type === 'command' && (hook.command ?? '').includes('edit-asks-a-person.mjs'),
        )
        .map((hook) => ({ matcher: group.matcher ?? '', command: hook.command ?? '' })),
    );
    expect(found.length).toBe(1);
    return found[0] as { matcher: string; command: string };
  }

  it('names, in its matcher and in its filter, exactly the tools the verb reads — both ways', () => {
    // THREE PLACES HOLD ONE LIST — the verb's table, the matcher Claude Code and Cursor apply and
    // never match, and the tools the handler lets through, since VS Code ignores the matcher and
    // runs the command on every tool — so the three are reconciled here in both directions. A
    // tool missing from the filter is a write that is never asked about, in silence.
    const tools = [...writeToolsOf('vscode')].sort();
    const { matcher, command } = declared();
    expect(/^\^\((.*)\)\$$/.exec(matcher)?.[1]?.split('|').sort()).toEqual(tools);
    const filtered = (/ --tools ([a-z_,]+)/.exec(command)?.[1] ?? '').split(',').sort();
    expect(filtered).toEqual(tools);
    // And the host the command declares is one the verb takes.
    expect(HOOK_HOSTS.filter((host) => command.includes(` --host ${host} `))).toEqual(['vscode']);
  });

  it('reaches the verb on a write and asks; on a read it starts no process at all', () => {
    const bin = join(sandbox, 'bin');
    mkdirSync(bin);
    const calls = join(sandbox, 'calls.txt');
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
    const host = (payload: string) =>
      spawnSync('sh', ['-c', declared().command], {
        cwd: repo,
        input: payload,
        encoding: 'utf-8',
        // As VS Code runs it: the plugin root in the environment, no CLAUDE_PROJECT_DIR.
        env: {
          HOME: join(sandbox, 'home'),
          // The plugin's command calls `node` by name, as a host's shell would find it: the
          // directory of the node running this suite, which on a CI runner is not /usr/bin.
          PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
          MNEMA_CALLS: calls,
          CLAUDE_PLUGIN_ROOT: PLUGIN,
        },
      });
    const read = host(
      JSON.stringify({
        tool_name: 'read_file',
        tool_input: { filePath: join(repo, 'src/billing/invoice.ts') },
      }),
    );
    expect(read.status).toBe(0);
    expect(read.stdout).toBe('');
    expect(existsSync(calls)).toBe(false);

    const quiet = host(createFile('src/other/ledger.ts'));
    expect(quiet.status).toBe(0);
    expect(quiet.stdout).toBe('');

    const write = host(createFile('src/billing/invoice.ts'));
    expect(write.status).toBe(0);
    expect(decided(JSON.parse(write.stdout) as Record<string, unknown>).value).toBe('ask');
    expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual([
      'before-a-write --host vscode',
      'before-a-write --host vscode',
    ]);
  });

  it('refuses a host it does not know, rather than reading a payload in the wrong shape', () => {
    const refused = spawnSync(process.execPath, [CLI, 'before-a-write', '--host', 'zed'], {
      cwd: repo,
      input: createFile('src/billing/invoice.ts'),
      encoding: 'utf-8',
      env: { HOME: join(sandbox, 'home'), PATH: '/usr/bin:/bin' },
    });
    expect(refused.status).not.toBe(0);
    expect(refused.stdout).toBe('');
    expect(refused.stderr).toContain('--host takes one of vscode, cursor, not "zed".');
    const missing = spawnSync(process.execPath, [CLI, 'before-a-write'], {
      cwd: repo,
      input: '{}',
      encoding: 'utf-8',
      env: { HOME: join(sandbox, 'home'), PATH: '/usr/bin:/bin' },
    });
    expect(missing.status).not.toBe(0);
    expect(askings()).toEqual([]);
  });
});
