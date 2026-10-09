/**
 * A rule that refuses a write: in every host, the write does not happen and the reason cites the
 * rule — and where a rule refuses and another asks for a person at the same path, the refusal wins.
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. That each host honours `deny` — the file is not written and
 * the model reads the reason — is the host's, measured against the real binaries
 * (read on 2 Oct 2026; for Claude Code and VS Code it is held by the cases in `host-contract/`, which start the
 * real host, and for Cursor by nothing in this tree). What this file holds is this product's half, at each of the three
 * doors: the MCP tool Claude Code's hook calls, `mnema before-a-write --host vscode` and `--host
 * cursor`. Each answers `deny` and cites the rule; each appends one `channel.refused` per rule
 * BEFORE it answers, and no `channel.served` (the refusal is the fact); each falls to the asking
 * when the refusing channel is switched off; and a record that cannot take the fact refuses nobody.
 *
 * CURSOR IS THE ONE THAT DOES NOT ASK, and the case that holds it is a write that only asks: the
 * answer is silence and nothing is recorded, because a `channel.asked` would say a person was asked
 * of a write that went through.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { asksAPerson, pathsOfAWrite } from '../src/host-hook.js';
import { HOOK_HOSTS, type HookHost } from '../src/host-names.js';
import { hookReply } from '../src/mcp/hook-reply.js';
import { openSession } from '../src/mcp/session.js';
import { runGoverningRulesTool, runRulesBeforeAnEditTool } from '../src/mcp/tools.js';
import { acceptedBy } from '../src/presentation/accepted-by.js';
import { type CliIo, run } from '../src/program.js';
import { A_CHARGE_WAITS_MS } from '../src/what-a-write-meets.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages', 'code', 'dist', 'cli.js');
const PLUGIN = join(REPO, 'plugin');

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;
let refusing: string;
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

/** A decision in force, linked to a path under a relation. */
async function ruleAt(title: string, path: string, rel: string): Promise<string> {
  const id = idIn(await did('decision', 'record', title, `why ${title}`));
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  await did('link', id, path, '--rel', rel);
  return id;
}

/** Every event of the public tree, in order. */
function publicEvents(): CatalogEvent[] {
  return orderedEvents(
    { root: resolveTrees(repo, env).projectPublic as string },
    catalogUpcasters(),
  );
}

/** The refusals the public tree holds, as `rule @ path by which`. */
function refusals(): string[] {
  return publicEvents().flatMap((event) =>
    event.kind === 'channel.refused'
      ? [`${event.payload.rule} @ ${event.payload.path} by ${event.which ?? '-'}`]
      : [],
  );
}

/** How many facts of each kind the public tree holds, for the three kinds a door writes. */
function counts(): Record<string, number> {
  const kinds = ['channel.refused', 'channel.asked', 'channel.served'];
  return Object.fromEntries(
    kinds.map((kind) => [kind, publicEvents().filter((event) => event.kind === kind).length]),
  );
}

/**
 * A patch as Codex's `apply_patch` takes it, adding `relative` — the path as the model writes it,
 * relative to the session's directory.
 */
function aPatchAdding(relative: string): string {
  return [
    '*** Begin Patch',
    `*** Add File: ${relative}`,
    '+export const probe = 1;',
    '*** End Patch',
  ].join('\n');
}

/** The payload a host hands its hook before a write of `relative`. */
function payloadFor(host: HookHost, relative: string): string {
  if (host === 'codex') {
    // As Codex 0.161.0 serializes it (`codex-rs/hooks/src/events/pre_tool_use.rs`): the patch is
    // the `command` of the input, and the tool keeps its own name whatever the matcher said.
    return JSON.stringify({
      session_id: '0199c0de-0000-7000-8000-000000000000',
      turn_id: 'turn-1',
      transcript_path: null,
      cwd: repo,
      hook_event_name: 'PreToolUse',
      model: 'stand-in',
      permission_mode: 'default',
      tool_name: 'apply_patch',
      tool_input: { command: aPatchAdding(relative) },
      tool_use_id: 'call-1',
    });
  }
  if (host === 'copilot') {
    // As Copilot CLI 1.0.94 hands a hook configured under the PascalCase event name: Claude's
    // tool names (its `create` is `Write`), snake_case fields, and the path under `path`.
    return JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 'a0e3c1f2-0000-4000-8000-000000000000',
      timestamp: '2026-10-09T12:00:00.000Z',
      cwd: repo,
      tool_name: 'Write',
      tool_input: { path: join(repo, relative), file_text: 'export const probe = 1;\n' },
    });
  }
  return host === 'cursor'
    ? JSON.stringify({
        hook_event_name: 'preToolUse',
        cursor_version: '2026.09.18',
        tool_name: 'Write',
        tool_input: { file_path: join(repo, relative), content: 'export const probe = 1;\n' },
        workspace_roots: [repo],
      })
    : JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'create_file',
        tool_input: { filePath: join(repo, relative), content: 'export const probe = 1;\n' },
        cwd: repo,
      });
}

/** What the verb answers for a host, as the host parses it. */
function verb(
  host: HookHost,
  relative: string,
): { reply: Record<string, unknown>; notes: readonly string[] } {
  const done = runBeforeAWrite({ cwd: repo, env }, { host, payload: payloadFor(host, relative) });
  return {
    reply: JSON.parse(JSON.stringify(done.reply)) as Record<string, unknown>,
    notes: done.notes,
  };
}

/**
 * Holds this machine's tail of the public tree as a live process would — this one, whose pid
 * answers, so no waiter may break it — and returns the lock file to remove.
 */
function holdTheTail(): string {
  const root = resolveTrees(repo, env).projectPublic as string;
  const tails = readdirSync(join(root, 'tails'));
  expect(tails).toHaveLength(1);
  const lock = join(root, 'locks', `${tails[0]}.lock`);
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, `${process.pid} ${Date.now()}\n`, { flag: 'wx' });
  return lock;
}

/** The permission decision of a reply. */
function decided(reply: Record<string, unknown>): { value?: string; reason?: string } {
  const specific = reply['hookSpecificOutput'] as
    | { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string }
    | undefined;
  return {
    ...(specific?.permissionDecision !== undefined ? { value: specific.permissionDecision } : {}),
    ...(specific?.permissionDecisionReason !== undefined
      ? { reason: specific.permissionDecisionReason }
      : {}),
  };
}

/** What the MCP tool answers for a path, parsed as the host parses it. */
function tool(path: string): Record<string, unknown> {
  const session = openSession({
    clientName: 'agent-alpha',
    roots: [pathToFileURL(repo).href],
    env,
  });
  const result = runRulesBeforeAnEditTool(session, { path });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  return JSON.parse(JSON.stringify(result.value)) as Record<string, unknown>;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-refuses-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'billing'), { recursive: true });
  mkdirSync(join(repo, 'src', 'ledger'), { recursive: true });
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
  // src/billing: one rule refuses. src/ledger: the same file is refused AND asked about.
  // src/other: a rule that only asks.
  refusing = await ruleAt('Billing is frozen', 'src/billing', 'refuses-a-write');
  asking = await ruleAt('Ledger changes need finance', 'src/ledger', 'asks-for-a-person');
  await did('link', refusing, 'src/ledger', '--rel', 'refuses-a-write');
  governing = await ruleAt('Bill in UTC', 'src/billing', 'governs');
  await ruleAt('Refunds need finance', 'src/other', 'asks-for-a-person');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the verb a command host runs', () => {
  for (const host of HOOK_HOSTS) {
    it(`${host}: denies where a rule refuses, citing it, and records the refusal first`, () => {
      const { reply, notes } = verb(host, 'src/billing/invoice.ts');
      const said = decided(reply);
      expect(said.value).toBe('deny');
      expect(said.reason).toContain('refuses a write at src/billing/invoice.ts');
      expect(said.reason).toContain(refusing);
      expect(notes).toEqual([]);
      // One fact per rule that refuses, attributed to the host; no service, and no asking.
      expect(refusals()).toEqual([`${refusing} @ src/billing/invoice.ts by ${host}`]);
      expect(counts()).toEqual({ 'channel.refused': 1, 'channel.asked': 0, 'channel.served': 0 });
      // The rule that only governs the path does not ride beside a write that does not happen.
      expect(said.reason).not.toContain(governing);
    });

    it(`${host}: the refusal wins over an asking at the same path, and nobody is asked`, () => {
      const said = decided(verb(host, 'src/ledger/entry.ts').reply);
      expect(said.value).toBe('deny');
      expect(said.reason).toContain(refusing);
      expect(said.reason).not.toContain(asking);
      expect(counts()).toEqual({ 'channel.refused': 1, 'channel.asked': 0, 'channel.served': 0 });
    });

    it(`${host}: answers nothing where nothing refuses, and writes nothing`, () => {
      const before = publicEvents().length;
      expect(verb(host, 'README.md')).toEqual({ reply: {}, notes: [] });
      expect(publicEvents().length).toBe(before);
    });

    it(`${host}: falls to the asking when the refusing channel is off, and says nothing when both are`, async () => {
      await did('switch', 'off', 'edit-refuses-a-write');
      // The refused path asks nothing of its own (only the ledger path has an asking rule), so it
      // is silent; the ledger path, refused AND asked, falls to the asking where the host asks.
      expect(verb(host, 'src/billing/invoice.ts').reply).toEqual({});
      const ledger = decided(verb(host, 'src/ledger/entry.ts').reply);
      if (asksAPerson(host)) {
        expect(ledger.value).toBe('ask');
        expect(ledger.reason).toContain(asking);
      } else {
        expect(ledger).toEqual({});
      }
      expect(counts()['channel.refused']).toBe(0);
      await did('switch', 'off', 'edit-asks-a-person');
      expect(verb(host, 'src/ledger/entry.ts')).toEqual({ reply: {}, notes: [] });
    });
  }

  it('cursor: a write that only asks is let through in silence, with nothing recorded', () => {
    // THE HOST THAT DOES NOT ASK. The file would be written, so no person is asked and no
    // `channel.asked` may say one was; VS Code, which holds the write, asks and records.
    const before = publicEvents().length;
    expect(verb('cursor', 'src/other/refund.ts')).toEqual({ reply: {}, notes: [] });
    expect(publicEvents().length).toBe(before);
    expect(decided(verb('vscode', 'src/other/refund.ts').reply).value).toBe('ask');
    expect(counts()['channel.asked']).toBe(1);
  });

  it('refuses even when the refusal cannot be recorded, and says so in the reason and on the second stream', () => {
    // A path over the field limit is refused by the content door when the fact is written. The
    // refusal is decided by reading, so it stands; what is missing is the fact, and it is said.
    const tooLong = `src/billing/${'a'.repeat(70_000)}.ts`;
    const before = publicEvents().length;
    const { reply, notes } = verb('cursor', tooLong);
    const { value, reason } = decided(reply);
    expect(value).toBe('deny');
    expect(reason).toContain(refusing);
    expect(reason).toContain('This refusal could not be recorded in the project');
    expect(notes.join('\n')).toContain('This refusal could not be recorded in the project');
    expect(publicEvents().length).toBe(before);
  });

  it('refuses while a live process holds the record, within the hook\u2019s time, and says the fact is missing', {
    timeout: 30_000,
  }, () => {
    const before = publicEvents().length;
    const lock = holdTheTail();
    const started = Date.now();
    const { reply, notes } = verb('cursor', 'src/billing/invoice.ts');
    const waited = Date.now() - started;
    rmSync(lock);
    const { value, reason } = decided(reply);
    expect(value).toBe('deny');
    expect(reason).toContain(refusing);
    expect(reason).toContain(`process ${process.pid} was writing the record`);
    expect(notes).toHaveLength(1);
    expect(publicEvents().length).toBe(before);
    // Three of the lock's 2 s waits, inside the charge's budget and well under the hook's 15 s.
    expect(waited).toBeGreaterThanOrEqual(6_000);
    expect(waited).toBeLessThan(A_CHARGE_WAITS_MS + 500);
  });

  it('asks while a live process holds the record, and says the fact is missing', {
    timeout: 30_000,
  }, () => {
    const lock = holdTheTail();
    const { reply } = verb('vscode', 'src/other/refund.ts');
    rmSync(lock);
    const { value, reason } = decided(reply);
    expect(value).toBe('ask');
    expect(reason).toContain('This request for a person could not be recorded');
    expect(counts()['channel.asked']).toBe(0);
  });

  it('reads the path of Cursor’s write, and of no other tool it was not measured on', () => {
    expect(
      pathsOfAWrite('cursor', { tool_name: 'Write', tool_input: { file_path: '/w/a.ts' } }),
    ).toEqual(['/w/a.ts']);
    expect(
      pathsOfAWrite('cursor', { tool_name: 'Read', tool_input: { file_path: '/w/a.ts' } }),
    ).toBeUndefined();
    expect(asksAPerson('cursor')).toBe(false);
    expect(asksAPerson('vscode')).toBe(true);
  });

  it('reads the paths of Codex’s patch off its `command`, and not off the field VS Code names', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-old',
      '+new',
      '*** Move to: src/b.ts',
      '*** Delete File: src/c.ts',
      '*** End Patch',
    ].join('\n');
    expect(
      pathsOfAWrite('codex', { tool_name: 'apply_patch', tool_input: { command: patch } }),
    ).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(
      pathsOfAWrite('codex', { tool_name: 'apply_patch', tool_input: { input: patch } }),
    ).toEqual([]);
    // `Write` and `Edit` are names Codex MATCHES apply_patch by, never names it hands a hook.
    expect(
      pathsOfAWrite('codex', { tool_name: 'Write', tool_input: { file_path: '/w/a.ts' } }),
    ).toBeUndefined();
    expect(asksAPerson('codex')).toBe(false);
  });

  it('reads the paths of Copilot CLI’s writes: `Write` and `Edit` under `path`, and a patch it hands whole', () => {
    expect(
      pathsOfAWrite('copilot', {
        tool_name: 'Write',
        tool_input: { path: '/w/a.ts', file_text: '' },
      }),
    ).toEqual(['/w/a.ts']);
    expect(
      pathsOfAWrite('copilot', {
        tool_name: 'Edit',
        tool_input: { path: '/w/b.ts', old_str: 'a', new_str: 'b' },
      }),
    ).toEqual(['/w/b.ts']);
    // Its `apply_patch` is also named `Edit`, and its input is the patch text itself, not an object.
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '*** Delete File: src/c.ts',
      '*** End Patch',
    ].join('\n');
    expect(pathsOfAWrite('copilot', { tool_name: 'Edit', tool_input: patch })).toEqual([
      'src/a.ts',
      'src/c.ts',
    ]);
    // Neither VS Code’s field names nor its tool names are read here, and a read is no write.
    expect(
      pathsOfAWrite('copilot', { tool_name: 'create_file', tool_input: { filePath: '/w/a.ts' } }),
    ).toBeUndefined();
    expect(
      pathsOfAWrite('copilot', { tool_name: 'Write', tool_input: { filePath: '/w/a.ts' } }),
    ).toEqual([]);
    expect(
      pathsOfAWrite('copilot', { tool_name: 'Read', tool_input: { path: '/w/a.ts' } }),
    ).toBeUndefined();
    expect(asksAPerson('copilot')).toBe(true);
  });

  it('codex: a write that only asks is let through in silence, with nothing recorded', () => {
    const before = publicEvents().length;
    expect(verb('codex', 'src/other/refund.ts')).toEqual({ reply: {}, notes: [] });
    expect(publicEvents().length).toBe(before);
  });
});

describe('the MCP tool Claude Code’s hook calls', () => {
  it('denies where a rule refuses, citing it, with the refusal recorded and nothing pushed', () => {
    const reply = tool('src/billing/invoice.ts');
    const specific = reply['hookSpecificOutput'] as Record<string, string>;
    expect(specific['permissionDecision']).toBe('deny');
    expect(specific['permissionDecisionReason']).toContain(refusing);
    expect(Object.keys(specific).sort()).toEqual([
      'hookEventName',
      'permissionDecision',
      'permissionDecisionReason',
    ]);
    expect(specific['hookEventName']).toBe('PreToolUse');
    expect(refusals()).toEqual([`${refusing} @ src/billing/invoice.ts by agent-alpha`]);
    expect(counts()).toEqual({ 'channel.refused': 1, 'channel.asked': 0, 'channel.served': 0 });
  });

  it('puts the refusal over the asking at one path, and records no asking', () => {
    const specific = tool('src/ledger/entry.ts')['hookSpecificOutput'] as Record<string, string>;
    expect(specific['permissionDecision']).toBe('deny');
    expect(specific['permissionDecisionReason']).not.toContain(asking);
    expect(counts()).toEqual({ 'channel.refused': 1, 'channel.asked': 0, 'channel.served': 0 });
  });

  it('puts the refusal over the hold on a first write: denied each time, never held, one fact per refusal', async () => {
    await did('switch', 'on', 'edit-first-write-gate');
    const session = openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(repo).href],
      env,
    });
    const write = () => {
      const result = runRulesBeforeAnEditTool(session, { path: 'src/billing/invoice.ts' });
      if (!result.ok) throw new Error('unreachable');
      return (JSON.parse(JSON.stringify(result.value)) as Record<string, unknown>)[
        'hookSpecificOutput'
      ] as Record<string, string>;
    };
    const first = write();
    expect(first['permissionDecision']).toBe('deny');
    expect(first['permissionDecisionReason']).toContain(refusing);
    expect(counts()).toEqual({ 'channel.refused': 1, 'channel.asked': 0, 'channel.served': 0 });
    // The hold lets a repeated write through; the refusal does not.
    const second = write();
    expect(second['permissionDecision']).toBe('deny');
    expect(second['permissionDecisionReason']).toContain(refusing);
    expect(counts()).toEqual({ 'channel.refused': 2, 'channel.asked': 0, 'channel.served': 0 });
  });

  it('falls to the rules it pushes when the refusing channel is off, and to nothing when all are', async () => {
    await did('switch', 'off', 'edit-refuses-a-write');
    const specific = tool('src/billing/invoice.ts')['hookSpecificOutput'] as Record<string, string>;
    expect(specific['permissionDecision']).toBeUndefined();
    expect(specific['additionalContext']).toContain(governing);
    expect(counts()['channel.refused']).toBe(0);
    await did('switch', 'off', 'edit-asks-a-person');
    await did('switch', 'off', 'edit-rules-push');
    expect(tool('src/billing/invoice.ts')).toEqual({});
  });

  it('refuses even when the refusal cannot be recorded, and the reason says so', () => {
    const tooLong = `src/billing/${'a'.repeat(70_000)}.ts`;
    const specific = tool(tooLong)['hookSpecificOutput'] as Record<string, string> | undefined;
    expect(specific?.['permissionDecision']).toBe('deny');
    expect(specific?.['permissionDecisionReason']).toContain(
      'This refusal could not be recorded in the project',
    );
    expect(refusals()).toEqual([]);
  });

  it('refuses while a live process holds the record, as a reply and never as an error', {
    timeout: 30_000,
  }, () => {
    const before = publicEvents().length;
    const lock = holdTheTail();
    const started = Date.now();
    const specific = tool('src/billing/invoice.ts')['hookSpecificOutput'] as Record<string, string>;
    const waited = Date.now() - started;
    rmSync(lock);
    expect(specific['permissionDecision']).toBe('deny');
    expect(specific['permissionDecisionReason']).toContain(refusing);
    expect(specific['permissionDecisionReason']).toContain(
      `process ${process.pid} was writing the record`,
    );
    expect(publicEvents().length).toBe(before);
    expect(waited).toBeLessThan(A_CHARGE_WAITS_MS + 500);
  });

  it('asks while a live process holds the record, inside the charge\u2019s budget, pushing no service fact', async () => {
    // A rule that informs at the same path, so the push has a service fact to record: tried after
    // a charge the tail kept out, it was one more lock wait (8.1 s for the whole answer).
    await did('link', governing, 'src/other', '--rel', 'governs');
    const before = publicEvents().length;
    const lock = holdTheTail();
    const started = Date.now();
    const specific = tool('src/other/refund.ts')['hookSpecificOutput'] as Record<string, string>;
    const waited = Date.now() - started;
    rmSync(lock);
    expect(specific['permissionDecision']).toBe('ask');
    expect(specific['permissionDecisionReason']).toContain(
      'This request for a person could not be recorded',
    );
    expect(publicEvents().length).toBe(before);
    expect(waited).toBeLessThan(A_CHARGE_WAITS_MS + 500);
  }, 30_000);
});

describe('the same rule, said again in one session', () => {
  /** The reason the hook tool hands back for `path`, on `session`, or the empty string. */
  function reasonOn(session: ReturnType<typeof openSession>, path: string): string {
    const result = runRulesBeforeAnEditTool(session, { path });
    if (!result.ok) throw new Error('unreachable');
    const reply = JSON.parse(JSON.stringify(result.value)) as Record<string, unknown>;
    return decided(reply).reason ?? '';
  }

  function sessionHere() {
    return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
  }

  it.each([
    ['refuses', 'src/billing/invoice.ts'],
    ['asks', 'src/other/refund.ts'],
  ])('a rule that %s says the whole of it three times, then one numbered line', (_grade, path) => {
    const session = sessionHere();
    const said = [1, 2, 3, 4, 5].map(() => reasonOn(session, path));
    expect(said[0]).not.toBe('');
    // The first three are the full notice, word for word.
    expect(said[1]).toBe(said[0]);
    expect(said[2]).toBe(said[0]);
    // After that: one line, numbered, naming the path, and no two of them equal.
    for (const [index, line] of [
      [3, said[3] as string],
      [4, said[4] as string],
    ] as const) {
      expect(line).toContain(`#${index + 1}`);
      expect(line).toContain(path);
      expect(line.includes('\n')).toBe(false);
      expect(line.length).toBeLessThan((said[0] as string).length / 2);
    }
    expect(said[3]).not.toBe(said[4]);
  });

  it('counts per rule and per session: a rule met for the first time, or a new connection, is whole', () => {
    const session = sessionHere();
    const first = reasonOn(session, 'src/billing/invoice.ts');
    for (let n = 0; n < 4; n += 1) reasonOn(session, 'src/billing/invoice.ts');
    // A rule this session has not heard from is said whole.
    expect(reasonOn(session, 'src/other/refund.ts')).toContain('Refunds need finance');
    // And a session of its own starts from the first: the whole notice, and then the one thing
    // that is new to it, that the run before it was charged at the same path.
    expect(reasonOn(sessionHere(), 'src/billing/invoice.ts')).toBe(
      `${first}\n\nAnother run (agent-alpha) consulted this path less than a minute ago.`,
    );
  });
});

describe('the document a session opens with', () => {
  it('counts the rules that refuse a write, and says so when the refusal is switched off', async () => {
    // One of the four rules in force refuses (it is linked at two addresses, and counts once).
    expect(await did('brief')).toContain('1 of them refuses a WRITE at an address: where one');
    await did('switch', 'off', 'edit-refuses-a-write', '--reason', 'porting');
    const off = await did('brief');
    expect(off).toContain('NONE of them refuses now');
    expect(off).toContain('edit-refuses-a-write was switched off by');
  });
});

// `presentation/accepted-by.ts` is the one place the clause is worded; what it says is held here
// where the lines that carry it are.
describe('who accepted the rule, said where a rule is handed over', () => {
  const BY = /accepted by mnid:[0-9a-f]{8} \(a person\)/;

  it('says it on the line a refusal, an asking and an informing push carry', async () => {
    const refusal = decided(tool('src/billing/invoice.ts')).reason ?? '';
    expect(refusal).toMatch(BY);
    const asked = decided(tool('src/other/refund.ts')).reason ?? '';
    expect(asked).toMatch(BY);
    await did('switch', 'off', 'edit-refuses-a-write');
    const pushed = (tool('src/billing/invoice.ts')['hookSpecificOutput'] as Record<string, string>)[
      'additionalContext'
    ];
    expect(pushed).toContain(governing);
    expect(pushed).toMatch(BY);
  });

  it('words the clause once: a person, an agent, and the mark that needs somebody to ask', () => {
    expect(acceptedBy({ by: 'mnid:ab12cd34', unconfirmed: false })).toBe(
      'accepted by mnid:ab12cd34 (a person)',
    );
    expect(acceptedBy({ by: 'mnid:ab12cd34', agent: 'claude-code', unconfirmed: true })).toBe(
      'accepted by mnid:ab12cd34 (agent claude-code; unconfirmed)',
    );
    // The record's own words are collapsed to one line, so a break cannot start a second rule.
    expect(acceptedBy({ by: 'mnid:a\nb', unconfirmed: false })).not.toContain('\n');
  });

  it('says it in what governing_rules answers, by the same reading', () => {
    const session = openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(repo).href],
      env,
    });
    const answered = JSON.stringify(runGoverningRulesTool(session, { path: 'src/billing/x.ts' }));
    expect(answered).toMatch(/"acceptance":\{"by":"mnid:[0-9a-f]{8}"/);
    expect(answered).toContain('"unconfirmed":false');
  });
});

describe('the reply a refusal is spelled with', () => {
  it('carries `deny` and the reason, and no field that would let the write through or rewrite it', () => {
    expect(hookReply('PreToolUse', { refuse: 'because' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'because',
      },
    });
    expect(hookReply('PreToolUse', { refuse: 'because', context: 'beside' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: 'beside',
        permissionDecision: 'deny',
        permissionDecisionReason: 'because',
      },
    });
  });

  it('neutralizes a control byte of the reason as it does the asking’s', () => {
    const reply = hookReply('PreToolUse', { refuse: 'one\u001b[31mtwo' }) as {
      hookSpecificOutput: { permissionDecisionReason: string };
    };
    expect(reply.hookSpecificOutput.permissionDecisionReason).not.toContain('\u001b');
  });
});

describe('the command Cursor runs from the plugin', () => {
  /** The declared command whose handler is the refusal's, read off `hooks.json`. */
  function declared(): { readonly matcher: string; readonly command: string } {
    const config = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf-8')) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string; command?: string }[] }[]>;
    };
    const found = (config.hooks['PreToolUse'] ?? []).flatMap((group) =>
      group.hooks
        .filter(
          (hook) =>
            hook.type === 'command' && (hook.command ?? '').includes('edit-refuses-a-write.mjs'),
        )
        .map((hook) => ({ matcher: group.matcher ?? '', command: hook.command ?? '' })),
    );
    expect(found.length).toBe(1);
    return found[0] as { matcher: string; command: string };
  }

  it('is matched where Claude Code matches the call into the server, and runs only for Cursor', () => {
    const config = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf-8')) as {
      hooks: Record<string, { matcher?: string; hooks: { type: string }[] }[]>;
    };
    const tooled = (config.hooks['PreToolUse'] ?? []).find((group) =>
      group.hooks.some((hook) => hook.type === 'mcp_tool'),
    );
    // Cursor applies the matcher and names its write tool as Claude Code does; the shell then
    // keeps the process from starting anywhere that is not Cursor, and the handler checks again.
    expect(declared().matcher).toBe(tooled?.matcher);
    expect(declared().command).toContain('[ -n "$CURSOR_VERSION" ] && node ');
    expect(declared().command).toContain(' --where CURSOR_VERSION');
    expect(HOOK_HOSTS.filter((host) => declared().command.includes(` --host ${host} `))).toEqual([
      'cursor',
    ]);
  });

  it('starts nothing outside Cursor, and refuses a write under a refusing rule inside it', () => {
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
    const host = (extra: Record<string, string>) =>
      spawnSync('sh', ['-c', declared().command], {
        cwd: repo,
        input: payloadFor('cursor', 'src/billing/invoice.ts'),
        encoding: 'utf-8',
        env: {
          HOME: join(sandbox, 'home'),
          PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
          MNEMA_CALLS: calls,
          CLAUDE_PLUGIN_ROOT: PLUGIN,
          CLAUDE_PROJECT_DIR: repo,
          ...extra,
        },
      });

    const elsewhere = host({});
    expect(elsewhere.status).toBe(0);
    expect(elsewhere.stdout).toBe('');
    expect(existsSync(calls)).toBe(false);

    const inCursor = host({ CURSOR_VERSION: '2026.09.18' });
    expect(inCursor.status).toBe(0);
    const said = decided(JSON.parse(inCursor.stdout) as Record<string, unknown>);
    expect(said.value).toBe('deny');
    expect(said.reason).toContain(refusing);
    expect(readFileSync(calls, 'utf-8').trim().split('\n')).toEqual([
      'before-a-write --host cursor',
    ]);
    expect(refusals()).toEqual([`${refusing} @ src/billing/invoice.ts by cursor`]);
  });
});

describe('the command Codex runs from the plugin', () => {
  type Groups = Record<string, { matcher?: string; hooks: { command?: string }[] }[]>;

  /** Codex's hooks file, the one its manifest names. */
  function codexHooks(): Groups {
    const manifest = JSON.parse(
      readFileSync(join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf-8'),
    ) as { hooks: string };
    return (JSON.parse(readFileSync(join(PLUGIN, manifest.hooks), 'utf-8')) as { hooks: Groups })
      .hooks;
  }

  it('is the only gate in the file Codex reads, matched by the one tool it names a patch', () => {
    const groups = codexHooks()['PreToolUse'] ?? [];
    expect(groups.map((group) => group.matcher)).toEqual(['apply_patch']);
    const commands = groups.flatMap((group) => group.hooks.map((hook) => hook.command ?? ''));
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('edit-refuses-a-write.mjs');
    expect(commands[0]).toContain('--host codex');
    // And no hook of the file every other host reads names Codex.
    expect(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf-8')).not.toContain('codex');
  });

  it('refuses a patch under a refusing rule, as the process Codex starts, and records it', () => {
    const bin = join(sandbox, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'mnema'), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
    chmodSync(join(bin, 'mnema'), 0o755);
    const command = codexHooks()['PreToolUse']?.[0]?.hooks[0]?.command ?? '';
    // Codex substitutes `${CLAUDE_PLUGIN_ROOT}` itself and also sets it in the environment
    // (`codex-rs/hooks/src/engine/discovery.rs`, 0.161.0); the shell here does the second.
    const ran = spawnSync('sh', ['-c', command], {
      cwd: repo,
      input: payloadFor('codex', 'src/billing/invoice.ts'),
      encoding: 'utf-8',
      env: {
        HOME: join(sandbox, 'home'),
        PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
        PLUGIN_ROOT: PLUGIN,
        CLAUDE_PLUGIN_ROOT: PLUGIN,
      },
    });
    expect(ran.status).toBe(0);
    const said = decided(JSON.parse(ran.stdout) as Record<string, unknown>);
    expect(said.value).toBe('deny');
    expect(said.reason).toContain(refusing);
    expect(refusals()).toEqual([`${refusing} @ src/billing/invoice.ts by codex`]);
  });
});
