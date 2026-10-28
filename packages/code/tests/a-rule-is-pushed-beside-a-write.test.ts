/**
 * The rules of the record, handed to the model beside a write that goes through, in the hosts whose
 * hook is a process: `mnema before-a-write --host codex|qwen|opencode`.
 *
 * WHAT IS HELD HERE is this product's half. That the command answers, in the same reply that would
 * carry a refusal, the text the MCP tool composes for Claude Code (one reading, one composition);
 * that it records `channel.served` ONCE PER SESSION of the host and not once per write, also with
 * several processes asking at once; that it hands over nothing without the session id that fact is
 * remembered by, nothing where the switch is off or nothing is addressed, and nothing beside a
 * refusal. What the HOST does with the text is the host contract
 * (`host-contract/the-rule-arrives.{codex,qwen,opencode}.test.ts`).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import type { RulesAtPath } from '@mnema/context';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { editRulesNotice, editRulesToldAcross, pathsLeftOut } from '../src/edit-rules-push.js';
import { does, HOOK_HOSTS, type HookHost } from '../src/host-names.js';
import { hookCeilingOf } from '../src/presentation/within-a-hook.js';
import { type CliIo, run } from '../src/program.js';
import { tellsWhatToDo } from '../src/record-framing.js';
import { journalsDir, takeTheFirstServing } from '../src/session-journal.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;
let governing: string;
let refusing: string;

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

/** The payload each pushing host hands a hook before a write to `relative`, in that host's own shape. */
function aWrite(host: HookHost, relative: string, session?: string): string {
  const at = join(repo, relative);
  const id = session === undefined ? {} : { session_id: session };
  switch (host) {
    case 'codex':
      return JSON.stringify({
        ...id,
        hook_event_name: 'PreToolUse',
        tool_name: 'apply_patch',
        tool_input: { command: `*** Begin Patch\n*** Add File: ${at}\n+x\n*** End Patch` },
      });
    case 'qwen':
      return JSON.stringify({
        ...id,
        hook_event_name: 'PreToolUse',
        tool_name: 'write_file',
        tool_input: { file_path: at, content: 'x' },
      });
    case 'opencode':
      return JSON.stringify({
        ...id,
        tool_name: 'write',
        tool_input: { filePath: at, content: 'x' },
      });
    default:
      throw new Error(`setup: ${host} is not a host that takes the push`);
  }
}

const PUSHING = ['codex', 'qwen', 'opencode'] as const;

function publicEvents(): CatalogEvent[] {
  return orderedEvents(
    { root: resolveTrees(repo, env).projectPublic as string },
    catalogUpcasters(),
  );
}

/** The service facts of the push the public tree holds, with who each says served. */
function services(): string[] {
  return publicEvents().flatMap((event) =>
    event.kind === 'channel.served' ? [`${event.subject} by ${event.which ?? '-'}`] : [],
  );
}

function refusals(): number {
  return publicEvents().filter((event) => event.kind === 'channel.refused').length;
}

function answer(host: HookHost, payload: string) {
  const done = runBeforeAWrite({ cwd: repo, env }, { host, payload });
  const reply = JSON.parse(JSON.stringify(done.reply)) as {
    hookSpecificOutput?: {
      hookEventName?: string;
      additionalContext?: string;
      permissionDecision?: string;
      permissionDecisionReason?: string;
    };
  };
  return { reply: reply.hookSpecificOutput, notes: done.notes };
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-push-beside-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'other'), { recursive: true });
  mkdirSync(join(repo, 'src', 'more'), { recursive: true });
  mkdirSync(join(repo, 'vendor'), { recursive: true });
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
  governing = idIn(await did('decision', 'record', 'Bill in UTC', 'The ledger is UTC'));
  await did('decision', 'move', 'accept', governing, '--note', 'agreed');
  await did('link', governing, 'src/other', '--rel', 'governs');
  await did('link', governing, 'src/more', '--rel', 'governs');
  // The path a rule refuses is governed too: what a refusal must not carry beside it is something.
  await did('link', governing, 'vendor', '--rel', 'governs');
  refusing = idIn(await did('decision', 'record', 'No vendoring', 'Vendored code is read-only'));
  await did('decision', 'move', 'accept', refusing, '--note', 'agreed');
  await did('link', refusing, 'vendor', '--rel', 'refuses-a-write');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the hosts that take the push are the ones the table says', () => {
  it('is every command host whose pushes cell says yes, and no other', () => {
    expect(HOOK_HOSTS.filter((host) => does(host, 'pushes')).sort()).toEqual([...PUSHING].sort());
  });
});

describe.each(PUSHING)('mnema before-a-write --host %s', (host) => {
  it('hands the rules of the path over in the context of the reply, and no decision', () => {
    const { reply, notes } = answer(host, aWrite(host, 'src/other/ledger.ts', 's1'));
    expect(reply?.hookEventName).toBe('PreToolUse');
    expect(reply?.permissionDecision).toBeUndefined();
    expect(reply?.additionalContext).toContain('Addressed at src/other/ledger.ts:');
    expect(reply?.additionalContext).toContain('“Bill in UTC”: governs src/other');
    expect(reply?.additionalContext).toContain(governing);
    expect(notes).toEqual([]);
  });

  it('composes the text the MCP tool composes: the same notice, byte for byte', () => {
    const { reply } = answer(host, aWrite(host, 'src/other/ledger.ts', 's1'));
    const at: RulesAtPath = {
      path: 'src/other/ledger.ts',
      relative: 'src/other/ledger.ts',
      rules: [
        {
          id: governing,
          name: 'Bill in UTC',
          address: 'src/other',
          travels: true,
        },
      ],
    };
    // The lines that do not depend on who accepted it are the notice's own.
    const expected = editRulesNotice(at) ?? '';
    for (const line of expected.split('\n').filter((one) => !one.startsWith('“'))) {
      expect(reply?.additionalContext).toContain(line);
    }
  });

  it('records the service ONCE per session however many writes it makes, and once more per session', () => {
    for (const n of [1, 2, 3, 4]) {
      const said = answer(host, aWrite(host, `src/other/f${n}.ts`, 'session-one'));
      expect(said.reply?.additionalContext, `write ${n} is pushed`).toContain('Bill in UTC');
    }
    expect(services()).toEqual([`edit-rules-push by ${host}`]);
    answer(host, aWrite(host, 'src/other/g.ts', 'session-two'));
    answer(host, aWrite(host, 'src/other/h.ts', 'session-two'));
    expect(services()).toEqual([`edit-rules-push by ${host}`, `edit-rules-push by ${host}`]);
  });

  it('hands nothing over without a session id, and says so on the second stream', () => {
    const before = publicEvents().length;
    const said = answer(host, aWrite(host, 'src/other/ledger.ts'));
    expect(said.reply).toBeUndefined();
    expect(said.notes).toEqual([
      'The hook input carried no session id, so the rules addressed at this path were not handed over beside the write.',
    ]);
    expect(answer(host, aWrite(host, 'src/other/ledger.ts', 'has a space')).reply).toBeUndefined();
    expect(publicEvents().length).toBe(before);
  });

  it('hands nothing over where the push is switched off, and the gate still answers', async () => {
    await did('switch', 'off', 'edit-rules-push');
    const before = publicEvents().length;
    expect(answer(host, aWrite(host, 'src/other/ledger.ts', 's1'))).toEqual({
      reply: undefined,
      notes: [],
    });
    expect(publicEvents().length).toBe(before);
    expect(answer(host, aWrite(host, 'vendor/x.ts', 's1')).reply?.permissionDecision).toBe('deny');
  });

  it('hands nothing over where no rule is addressed, and writes nothing', () => {
    const before = publicEvents().length;
    expect(answer(host, aWrite(host, 'README.md', 's1'))).toEqual({
      reply: undefined,
      notes: [],
    });
    expect(publicEvents().length).toBe(before);
  });

  it('refuses a write a rule refuses with no context beside it and no service recorded', () => {
    const { reply } = answer(host, aWrite(host, 'vendor/x.ts', 's1'));
    expect(reply?.permissionDecision).toBe('deny');
    expect(reply?.permissionDecisionReason).toContain(refusing);
    expect(reply?.additionalContext).toBeUndefined();
    expect(refusals()).toBe(1);
    expect(services()).toEqual([]);
  });
});

describe('the ceiling of the host at the door', () => {
  it('cuts at the bytes Codex counts and keeps whole what a host that counts units keeps', async () => {
    // Rules whose names are three bytes to a character: together they measure less than 10,000
    // UTF-16 code units and more than 10,000 bytes, so only the host that counts bytes cuts.
    const name = (n: number) => `Rule ${String(n).padStart(2, '0')} ${'€'.repeat(130)}`;
    for (let n = 0; n < 25; n += 1) {
      const id = idIn(await did('decision', 'record', name(n), 'because'));
      await did('decision', 'move', 'accept', id, '--note', 'agreed');
      await did('link', id, 'src/many', '--rel', 'governs');
    }
    const codex = answer('codex', aWrite('codex', 'src/many/a.ts', 's1')).reply?.additionalContext;
    const qwen = answer('qwen', aWrite('qwen', 'src/many/a.ts', 's1')).reply?.additionalContext;
    expect(Buffer.byteLength(codex ?? '', 'utf8')).toBeLessThanOrEqual(10_000);
    expect(codex).toContain('Left out of this text:');
    expect(codex).toContain('2,500 tokens of 4 bytes');
    expect(qwen?.length).toBeLessThanOrEqual(10_000);
    expect(Buffer.byteLength(qwen ?? '', 'utf8')).toBeGreaterThan(10_000);
    expect(qwen).not.toContain('Left out of this text:');
    expect(qwen?.match(/“Rule \d\d /g)).toHaveLength(25);
  }, 120_000);
});

describe('a write that touches several paths', () => {
  it('is handed the rules of each governed path, and not of the one nothing addresses', () => {
    const patch = JSON.stringify({
      session_id: 's1',
      tool_name: 'apply_patch',
      tool_input: {
        command: [
          '*** Begin Patch',
          `*** Add File: ${join(repo, 'src/other/a.ts')}`,
          '+x',
          `*** Add File: ${join(repo, 'src/more/b.ts')}`,
          '+x',
          `*** Add File: ${join(repo, 'README.md')}`,
          '+x',
          '*** End Patch',
        ].join('\n'),
      },
    });
    const text = answer('codex', patch).reply?.additionalContext ?? '';
    expect(text).toContain('Addressed at src/other/a.ts:');
    expect(text).toContain('Addressed at src/more/b.ts:');
    expect(text).not.toContain('README.md');
    expect(services()).toEqual(['edit-rules-push by codex']);
  });
});

describe('the ceiling of the host, a whole rule at a time', () => {
  const manyRules = (path: string): RulesAtPath => ({
    path,
    relative: path,
    rules: Array.from({ length: 12 }, (_, n) => ({
      id: `adr-${n}`,
      name: `Rule ${n}: ${'every invoice is issued in the currency of the contract, '.repeat(20).trimEnd()}`,
      address: 'src/collate',
      travels: true,
    })),
  });

  it('cuts at the ceiling Codex counts in bytes, and says what it left out', () => {
    const ceiling = hookCeilingOf({ tokens: 2_500, bytesPerToken: 4 });
    const told = editRulesToldAcross([manyRules('src/a.ts')], [], ceiling) ?? '';
    expect(Buffer.byteLength(told, 'utf8')).toBeLessThanOrEqual(10_000);
    expect(told).toContain('Left out of this text:');
    expect(told).toContain('2,500 tokens of 4 bytes');
    // A whole rule or none: every rule line that is there is whole.
    for (const line of told.split('\n').filter((one) => one.startsWith('“Rule'))) {
      expect(line).toMatch(/· adr-\d+$/);
    }
  });

  it('counts the paths a long write could not fit, in one sentence', () => {
    const told =
      editRulesToldAcross(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'].map(manyRules), [
        'beside',
      ]) ?? '';
    expect(told.length).toBeLessThanOrEqual(10_000);
    expect(told.endsWith('\n\nbeside')).toBe(true);
    expect(told).toMatch(/the rules addressed at \d+ more paths? this write touches/);
  });

  it('is the notice of the one path, byte for byte, when the write touches one', () => {
    const at = manyRules('src/a.ts');
    expect(editRulesToldAcross([at], [])).toBe(editRulesNotice(at));
    expect(editRulesToldAcross([{ ...at, rules: [] }], [])).toBeUndefined();
  });

  it('says what the text is and never what to do, in every sentence it adds', () => {
    for (const left of [1, 2, 9]) {
      expect(tellsWhatToDo(pathsLeftOut(left)), pathsLeftOut(left)).toBeUndefined();
    }
  });
});

describe('what a session remembers of having been pushed to', () => {
  it('tells exactly one of two askers that it is the first, and the other that it is not', () => {
    const trees = resolveTrees(repo, env);
    const first = takeTheFirstServing(trees, 'race', 'edit-rules-push');
    const second = takeTheFirstServing(trees, 'race', 'edit-rules-push');
    expect(first).toBeDefined();
    expect(second).toBeUndefined();
    // Given back, the next asker is the first again: a fact that was not recorded is tried again.
    first?.release();
    expect(takeTheFirstServing(trees, 'race', 'edit-rules-push')).toBeDefined();
    // And another channel, or another session, is its own.
    expect(takeTheFirstServing(trees, 'race', 'other-channel')).toBeDefined();
    expect(takeTheFirstServing(trees, 'another', 'edit-rules-push')).toBeDefined();
    const dir = journalsDir(trees) as string;
    expect(readdirSync(dir).every((name) => name.endsWith('.served'))).toBe(true);
  });

  it('leaves one fact when several processes of one session ask at once', async () => {
    const payload = aWrite('codex', 'src/other/ledger.ts', 'parallel');
    const childEnv = {
      HOME: join(sandbox, 'home'),
      XDG_DATA_HOME: join(sandbox, 'data'),
      PATH: process.env.PATH ?? '',
    };
    const runOne = () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, 'before-a-write', '--host', 'codex'], {
          cwd: repo,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'inherit'],
        });
        let out = '';
        child.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', () => resolve(out));
        child.stdin.end(payload);
      });
    const replies = await Promise.all([runOne(), runOne(), runOne(), runOne()]);
    for (const reply of replies) expect(reply).toContain('Bill in UTC');
    expect(services()).toEqual(['edit-rules-push by codex']);
  }, 60_000);
});

describe('one reading of the push, and one composition', () => {
  const read = (path: string) => readFileSync(join(SRC, path), 'utf-8');

  it('is asked of `readThePush` by both doors, and of nothing else', () => {
    for (const door of ['commands/before-a-write.ts', 'mcp/tools.ts']) {
      const source = read(door);
      expect(source, door).toContain('readThePush(');
      expect(source, `${door} reads the rules itself`).not.toContain(
        'readRulesInForceWhereItLands(',
      );
      expect(source, `${door} composes the notice itself`).not.toContain('editRulesNotice(');
    }
    expect(read('commands/before-a-write.ts')).not.toContain('movedApartLine(');
    expect(read('commands/before-a-write.ts')).toContain('editRulesToldAcross(');
    expect(read('mcp/tools.ts')).toContain('editRulesTold(');
  });
});
