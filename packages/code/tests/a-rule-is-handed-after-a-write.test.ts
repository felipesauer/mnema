/**
 * The rules of the record, handed to the model beside the result of a write that was done, in the
 * hosts whose hook before a write has no field for text: `mnema beside-a-write --host copilot|gemini`.
 *
 * WHAT IS HELD HERE is this product's half. That the verb hands over the text the other doors
 * compose (one reading, one composition), in the shape each host reads; that it records
 * `channel.served` ONCE PER SESSION of the host and not once per write, also with several
 * processes asking at once; that it hands over nothing without the session id that fact is
 * remembered by, nothing where the switch is off or nothing is addressed; and that it CHARGES
 * NOTHING: no `channel.refused`, no `channel.asked`, however the path is addressed. The hooks that
 * call the verb are held to name it with the right host, and a `mnema` too old to know it leaves the
 * write and the session as they were. What the HOST does with the text is the host contract
 * (`host-contract/the-rule-arrives.{copilot,gemini}.test.ts`).
 */

import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { runBesideAWrite } from '../src/commands/beside-a-write.js';
import {
  BESIDE_HOSTS,
  type BesideHost,
  does,
  HOOK_HOSTS,
  pushesWithTheGate,
} from '../src/host-names.js';
import { type CliIo, run } from '../src/program.js';
import { decodedWhole } from './support/arriving.js';
import { copilotHooksJson, geminiHookScript, geminiHooksJson } from './support/the-host-files.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const HANDLER = fileURLToPath(
  new URL('../../../plugin/hooks/edit-rules-beside.mjs', import.meta.url),
);

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;
let governing: string;
let refusing: string;
let asking: string;

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

/** The payload each host hands the hook that runs after a write to `relative`, in that host's own shape. */
function afterAWrite(host: BesideHost, relative: string, session?: string): string {
  const at = join(repo, relative);
  const id = session === undefined ? {} : { session_id: session };
  switch (host) {
    case 'copilot':
      return JSON.stringify({
        ...id,
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { path: at, file_text: 'x' },
        tool_result: { result_type: 'success', text_result_for_llm: 'Created file' },
      });
    case 'gemini':
      return JSON.stringify({
        ...id,
        hook_event_name: 'AfterTool',
        tool_name: 'write_file',
        tool_input: { file_path: at, content: 'x' },
        tool_response: { llmContent: 'Successfully created file' },
      });
  }
}

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

/** The facts that charge a write: a refusal or an asking. */
function charges(): number {
  return publicEvents().filter(
    (event) => event.kind === 'channel.refused' || event.kind === 'channel.asked',
  ).length;
}

function answer(host: BesideHost, payload: string) {
  const done = runBesideAWrite({ cwd: repo, env }, { host, payload });
  return {
    reply: JSON.parse(JSON.stringify(done.reply)) as Record<string, unknown>,
    notes: done.notes,
  };
}

/** The text a reply hands the model, wherever the host reads it. */
function contextOf(host: BesideHost, reply: Record<string, unknown>): string | undefined {
  const nested = reply['hookSpecificOutput'] as { additionalContext?: string } | undefined;
  const value = host === 'copilot' ? reply['additionalContext'] : nested?.additionalContext;
  return typeof value === 'string' ? value : undefined;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-after-a-write-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src', 'other'), { recursive: true });
  mkdirSync(join(repo, 'src', 'ask'), { recursive: true });
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
  refusing = idIn(await did('decision', 'record', 'No vendoring', 'Vendored code is read-only'));
  await did('decision', 'move', 'accept', refusing, '--note', 'agreed');
  await did('link', refusing, 'vendor', '--rel', 'refuses-a-write');
  asking = idIn(await did('decision', 'record', 'Ask before asking', 'A person looks first'));
  await did('decision', 'move', 'accept', asking, '--note', 'agreed');
  await did('link', asking, 'src/ask', '--rel', 'asks-for-a-person');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the hosts that take the push after the write are the ones the table says', () => {
  it('is every command host whose pushes cell says yes and whose gate does not carry it', () => {
    expect([...BESIDE_HOSTS].sort()).toEqual(['copilot', 'gemini']);
    expect(
      HOOK_HOSTS.filter((host) => does(host, 'pushes') && !pushesWithTheGate(host)).sort(),
    ).toEqual([...BESIDE_HOSTS].sort());
  });

  it.each(BESIDE_HOSTS)('leaves the gate of %s without a context beside it', (host) => {
    const done = runBeforeAWrite(
      { cwd: repo, env },
      {
        host,
        payload: JSON.stringify({
          session_id: 's1',
          tool_name: host === 'copilot' ? 'Write' : 'write_file',
          tool_input:
            host === 'copilot'
              ? { path: join(repo, 'src/other/a.ts') }
              : { file_path: join(repo, 'src/other/a.ts') },
        }),
      },
    );
    expect(done.reply).toEqual({});
    expect(services()).toEqual([]);
  });
});

describe.each(BESIDE_HOSTS)('mnema beside-a-write --host %s', (host) => {
  it('hands the rules of the path over, in the shape the host reads, and no decision', () => {
    const { reply, notes } = answer(host, afterAWrite(host, 'src/other/ledger.ts', 's1'));
    const text = contextOf(host, reply);
    expect(text).toContain('Addressed at src/other/ledger.ts:');
    expect(text).toContain('“Bill in UTC”: governs src/other');
    expect(text).toContain(governing);
    expect(JSON.stringify(reply)).not.toContain('permissionDecision');
    expect(JSON.stringify(reply)).not.toContain('"decision"');
    expect(notes).toEqual([]);
    if (host === 'copilot') expect(Object.keys(reply)).toEqual(['additionalContext']);
    else {
      expect(reply['hookSpecificOutput']).toMatchObject({ hookEventName: 'AfterTool' });
      expect(Object.keys(reply)).toEqual(['hookSpecificOutput']);
    }
  });

  it('hands the text before-a-write hands a host that counts as it does, byte for byte', () => {
    const beside = contextOf(
      host,
      answer(host, afterAWrite(host, 'src/other/ledger.ts', 's1')).reply,
    );
    const gate = runBeforeAWrite(
      { cwd: repo, env },
      {
        host: 'qwen',
        payload: JSON.stringify({
          session_id: 's-qwen',
          tool_name: 'write_file',
          tool_input: { file_path: join(repo, 'src/other/ledger.ts') },
        }),
      },
    );
    const said = (gate.reply as { hookSpecificOutput?: { additionalContext?: string } })
      .hookSpecificOutput?.additionalContext;
    expect(beside).toBeDefined();
    expect(beside).toBe(said);
  });

  it('records the service ONCE per session however many writes it makes, and once more per session', () => {
    for (const n of [1, 2, 3, 4]) {
      const said = answer(host, afterAWrite(host, `src/other/f${n}.ts`, 'session-one'));
      expect(contextOf(host, said.reply), `write ${n} is handed the rules`).toContain(
        'Bill in UTC',
      );
    }
    expect(services()).toEqual([`edit-rules-push by ${host}`]);
    answer(host, afterAWrite(host, 'src/other/g.ts', 'session-two'));
    answer(host, afterAWrite(host, 'src/other/h.ts', 'session-two'));
    expect(services()).toEqual([`edit-rules-push by ${host}`, `edit-rules-push by ${host}`]);
  });

  it('charges nothing: no refusal and no asking is recorded, however the path is addressed', () => {
    for (const relative of ['src/ask/a.ts', 'vendor/x.ts', 'src/other/a.ts']) {
      answer(host, afterAWrite(host, relative, 's1'));
    }
    expect(charges()).toBe(0);
    expect(publicEvents().filter((event) => event.kind === 'channel.served')).toHaveLength(1);
  });

  it('hands nothing over without a session id, and says so on the second stream', () => {
    const before = publicEvents().length;
    const said = answer(host, afterAWrite(host, 'src/other/ledger.ts'));
    expect(said.reply).toEqual({});
    expect(said.notes).toEqual([
      'The hook input carried no session id, so the rules addressed at this path were not handed over beside the write.',
    ]);
    expect(answer(host, afterAWrite(host, 'src/other/ledger.ts', 'has a space')).reply).toEqual({});
    expect(publicEvents().length).toBe(before);
  });

  it('hands nothing over where the push is switched off', async () => {
    await did('switch', 'off', 'edit-rules-push');
    const before = publicEvents().length;
    expect(answer(host, afterAWrite(host, 'src/other/ledger.ts', 's1'))).toEqual({
      reply: {},
      notes: [],
    });
    expect(publicEvents().length).toBe(before);
  });

  it('hands nothing over where no rule is addressed, for a tool that is no write, and for no JSON', () => {
    const before = publicEvents().length;
    expect(answer(host, afterAWrite(host, 'README.md', 's1'))).toEqual({ reply: {}, notes: [] });
    const notAWrite = JSON.stringify({
      session_id: 's1',
      tool_name: 'bash',
      tool_input: { command: 'ls' },
    });
    expect(answer(host, notAWrite)).toEqual({ reply: {}, notes: [] });
    expect(answer(host, 'not json').reply).toEqual({});
    expect(publicEvents().length).toBe(before);
  });

  it('records at most one service fact for a forged payload, under the name of the host', () => {
    const forged = afterAWrite(host, 'src/other/../other/x.ts', 'forged-session');
    answer(host, forged);
    answer(host, forged);
    expect(services()).toEqual([`edit-rules-push by ${host}`]);
    expect(charges()).toBe(0);
  });
});

describe('the verb as a process', () => {
  it('leaves one fact when several processes of one session ask at once', async () => {
    const payload = afterAWrite('copilot', 'src/other/ledger.ts', 'parallel');
    const childEnv = {
      HOME: join(sandbox, 'home'),
      XDG_DATA_HOME: join(sandbox, 'data'),
      PATH: process.env.PATH ?? '',
    };
    const runOne = () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, 'beside-a-write', '--host', 'copilot'], {
          cwd: repo,
          env: childEnv,
          stdio: ['pipe', 'pipe', 'inherit'],
        });
        const out = decodedWhole();
        out.from(child.stdout);
        child.on('error', reject);
        child.on('close', () => resolve(out.text()));
        child.stdin.end(payload);
      });
    const replies = await Promise.all([runOne(), runOne(), runOne(), runOne()]);
    for (const reply of replies) expect(reply).toContain('Bill in UTC');
    expect(services()).toEqual(['edit-rules-push by copilot']);
  }, 60_000);

  it('refuses a host that does not run it after a write, and one that is not a host', () => {
    for (const host of ['codex', 'vscode', 'zed']) {
      const ran = spawnSync(process.execPath, [CLI, 'beside-a-write', '--host', host], {
        cwd: repo,
        env: { HOME: join(sandbox, 'home'), PATH: process.env.PATH ?? '' },
        encoding: 'utf-8',
        input: afterAWrite('copilot', 'src/other/a.ts', 's1'),
      });
      expect(ran.status, host).not.toBe(0);
      expect(ran.stdout, host).toBe('');
    }
    expect(services()).toEqual([]);
  });
});

describe('the hooks that call the verb', () => {
  it('names it with the right host in the generated hooks files and the extension script', () => {
    const copilot = JSON.parse(copilotHooksJson()) as {
      hooks: { PostToolUse: { matcher: string; hooks: { command: string }[] }[] };
    };
    const beside = copilot.hooks.PostToolUse.filter((group) =>
      group.hooks.some((hook) => hook.command.includes('edit-rules-beside.mjs')),
    );
    expect(beside).toHaveLength(1);
    expect(beside[0]?.matcher).toBe('Write|Edit');
    expect(beside[0]?.hooks[0]?.command).toContain(
      'edit-rules-beside.mjs" --host copilot --agent-key copilot; exit 0',
    );
    const gemini = JSON.parse(geminiHooksJson()) as {
      hooks: { AfterTool: { matcher: string; hooks: { command: string }[] }[] };
    };
    const after = gemini.hooks.AfterTool.filter((group) =>
      group.hooks.some((hook) => hook.command.endsWith('mnema.mjs" beside')),
    );
    expect(after).toHaveLength(1);
    expect(after[0]?.matcher).toBe('^(write_file|replace)$');
    expect(geminiHookScript()).toContain("const beside = ['beside-a-write', '--host', 'gemini'];");
  });

  /** Runs the handler with a stub `mnema` on the PATH that answers `--identify` and the verb as told. */
  function handlerWith(verbAnswer: string) {
    const bin = join(sandbox, 'bin');
    mkdirSync(bin, { recursive: true });
    const stub = join(bin, 'mnema');
    writeFileSync(
      stub,
      `#!/bin/sh\nif [ "$1" = "--identify" ]; then echo "@mnema/code stub"; exit 0; fi\n${verbAnswer}\n`,
    );
    chmodSync(stub, 0o755);
    return spawnSync(process.execPath, [HANDLER, '--host', 'copilot', '--agent-key', 'copilot'], {
      cwd: repo,
      env: { HOME: join(sandbox, 'home'), PATH: `${bin}:${process.env.PATH ?? ''}` },
      encoding: 'utf-8',
      input: afterAWrite('copilot', 'src/other/a.ts', 's1'),
    });
  }

  it('hands over what the verb answered, byte for byte (the control of the case below)', () => {
    const ran = handlerWith(`echo '{"additionalContext":"the rules"}'`);
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe('{"additionalContext":"the rules"}\n');
  });

  it('stops waiting for a mnema that does not answer, silent, well inside the host’s own 15 seconds', () => {
    const began = Date.now();
    const ran = handlerWith('exec sleep 30');
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe('');
    expect(Date.now() - began).toBeLessThan(12_000);
  }, 30_000);

  it('is silent, and leaves the session as it was, when the mnema it finds does not know the verb', () => {
    const ran = handlerWith(`echo "error: unknown command '$1'" >&2; exit 1`);
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe('');
  });
});

describe('one reading of the push, one composition, and no charge', () => {
  const read = (path: string) => readFileSync(join(SRC, path), 'utf-8');

  it('is asked of `runBeforeAPath` and of nothing that reads, composes or records on its own', () => {
    const source = read('commands/beside-a-write.ts');
    expect(source).toContain('runBeforeAPath(');
    for (const forbidden of [
      'readThePush(',
      'readRulesInForceWhereItLands(',
      'editRulesNotice(',
      'editRulesToldAcross(',
      'whatAWriteMeets(',
      'recordChannelAsked(',
      'recordChannelRefused(',
      'recordChannelServed(',
      'openTreeForWriting(',
    ]) {
      expect(source, `the verb after the write does ${forbidden} on its own`).not.toContain(
        forbidden,
      );
    }
  });
});
