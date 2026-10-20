/**
 * THE CHANNELS BELOW HAVE A BUDGET, in bytes and in tokens, and a text that grows one shows in
 * the diff of the golden beside this file.
 *
 * WHAT IS HELD: each channel, what a session opens with (the brief a hook hands over,
 * and the notes), the edge of an edit (what is pushed, what asks for a person, what refuses),
 * the server's `instructions`, what each tool answers and what each tool's definition weighs,
 * is captured from the real program over one fixture record, and its size is written to
 * `the-channels-have-a-budget.golden.txt` as UTF-8 bytes and as `o200k_base` tokens. A person
 * who adds a sentence to a channel updates the golden (`pnpm vitest run -u <this file>`), and
 * the reviewer reads the delta in the diff.
 *
 * NOT MEASURED: of the thirteen `ModelChannel`s, `exported-skill`, `host-rules-file`,
 * `agent-accepts`, `session-tally`, `subagent-handback`, `edit-first-write-gate` and
 * `user-corrections`; the answer of ten of the twelve tools that write (`record_decision` and
 * `capture_memory` are here) and of `guard`. Their definitions are all counted.
 *
 * WHAT IT IS NOT: the tokenizer is OpenAI's, open and offline, a RELATIVE measure to compare a
 * channel before and after, not the count a Claude model is billed. The figure for Claude is the
 * `usage` of a session's transcript (`mnema usage`).
 *
 * WHAT THE FIXTURE FIXES: ids, instants, the checkout path, the key's fingerprint and the
 * identity's short name are replaced before counting by values of the same shape and length, so
 * a number does not move with the machine or the minute. What is left there that moves is a
 * golden that differs from itself, which the case below refuses.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { encode } from 'gpt-tokenizer/encoding/o200k_base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { type CliIo, run } from '../src/program.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let client: Client;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

/** Runs `mnema <argv>` in process; refuses to continue on a failure (setup, not assertion). */
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

/** What is minted at run time, with the shape each one has. */
const VOLATILE: readonly { readonly pattern: RegExp; readonly alphabet: 'hex' }[] = [
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, alphabet: 'hex' },
  { pattern: /\b[0-9a-f]{64}\b/g, alphabet: 'hex' },
  { pattern: /(?<=mnid:)[0-9a-f]{8}\b/g, alphabet: 'hex' },
];
const INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const minted = new Map<string, string>();

/**
 * A value that is stable and has the shape of `real`: hex of the same length, by the order the
 * value was first met. Hex and not zeros, because a token count of `0000…` would flatter the
 * channel: an id costs what a random one costs.
 */
function stand(real: string): string {
  const seen = minted.get(real);
  if (seen !== undefined) return seen;
  const hex = createHash('sha256').update(`budget:${minted.size}`).digest('hex').repeat(2);
  let at = 0;
  const made = real.replace(/[0-9a-f]/g, () => hex[at++] as string);
  minted.set(real, made);
  return made;
}

/** The text with what is minted at run time replaced by what is stable and of the same shape. */
function scrub(text: string): string {
  let out = text.split(repo).join('/work/project');
  for (const { pattern } of VOLATILE) out = out.replace(pattern, stand);
  return out.replace(INSTANT, '2026-01-01T00:00:00.000Z');
}

interface Channel {
  readonly label: string;
  readonly text: string;
}

const channels: Channel[] = [];
const others: Client[] = [];

/** What a tool answers, as the text the host puts in front of the model. */
async function tool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text?: string }[];
  };
  return result.content.map((c) => c.text ?? '').join('\n');
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-budget-'));
  repo = join(sandbox, 'repo');
  for (const dir of ['billing', 'payments', 'ledger']) {
    mkdirSync(join(repo, 'src', dir), { recursive: true });
  }
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

  const ruled: Record<string, string> = {};
  const record = async (key: string, title: string, why: string, path: string, rel: string) => {
    const id = idIn(
      await did(
        'decision',
        'record',
        title,
        why,
        '--alternatives',
        'doing nothing: it leaves the risk where it is',
      ),
    );
    await did('decision', 'move', 'accept', id, '--note', 'agreed');
    await did('link', id, path, '--rel', rel);
    ruled[key] = id;
  };
  await record(
    'governs',
    'Invoices are immutable once issued',
    'An issued invoice is a legal document',
    'src/billing',
    'governs',
  );
  await record(
    'asks',
    'Refunds need a person from finance',
    'Money leaves the company',
    'src/payments',
    'asks-for-a-person',
  );
  await record(
    'refuses',
    'The ledger is never written by hand',
    'Every entry has to be reproducible',
    'src/ledger',
    'refuses-a-write',
  );
  await did('memory', 'The nightly build is slow on Mondays because the cache is rebuilt');
  const task = idIn(await did('task', 'create', 'Write the deploy runbook'));
  const skill = idIn(
    await did(
      'skill',
      'create',
      'One slice per PR',
      '--body',
      'A slice is one reviewable change with its tests.',
    ),
  );
  await did('skill', 'move', 'review', skill, '--note', 'it reads well');
  await did('skill', 'move', 'adopt', skill, '--note', 'we work this way already');
  // A decision document of this checkout that the record has no decision for: the one thing
  // the opening a hook hands over says that the file a person commits never does.
  mkdirSync(join(repo, 'docs', 'adr'), { recursive: true });
  writeFileSync(
    join(repo, 'docs', 'adr', '0001-keep-the-runbook.md'),
    '# ADR-001 — Keep the runbook where the work is\n\n' +
      '- **Status:** Accepted\n\n' +
      '## Context\n\na wiki page nobody owns goes stale\n\n' +
      '## Decision Outcome\n\nChosen option: "the runbook next to the code".\n',
    'utf-8',
  );

  const { server } = buildMcpServer({ cwd: repo, env, log: () => {} });
  client = new Client({ name: 'claude-code', version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  const add = (label: string, text: string) => channels.push({ label, text });

  // What a session opens with: the two handlers of `SessionStart` print these two verbs.
  add('session start: brief --hook', await did('brief', '--hook'));
  add('session start: recall --hook', await did('recall', '--hook'));
  add('file form: brief (what MNEMA.md carries)', await did('brief'));

  add('instructions', client.getInstructions() ?? '');

  // Another agent of this machine asks at `src/payments` first, so the edge there carries the
  // sentence that says another run consulted the path, the one text of the channel that exists
  // only when two runs share a project.
  const other = new Client({ name: 'codex', version: '1.0.0' }, { capabilities: { roots: {} } });
  other.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href }],
  }));
  const [otherClient, otherServer] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    other.connect(otherClient),
    buildMcpServer({ cwd: repo, env, log: () => {} }).server.connect(otherServer),
  ]);
  others.push(other);
  await other.callTool({
    name: 'rules_before_an_edit',
    arguments: { path: 'src/payments/refund.ts' },
  });

  // The edge of an edit: the three answers the tool gives, as the host reads them.
  add('edit: rules pushed', await tool('rules_before_an_edit', { path: 'src/billing/invoice.ts' }));
  add(
    'edit: asks for a person',
    await tool('rules_before_an_edit', { path: 'src/payments/refund.ts' }),
  );
  add(
    'edit: refuses the write',
    await tool('rules_before_an_edit', { path: 'src/ledger/entry.ts' }),
  );

  // What each tool answers, over the fixture. Reads first, so a write does not move what a
  // read says; the writes last.
  const reads: readonly (readonly [string, Record<string, unknown>])[] = [
    ['bootstrap', {}],
    ['skills', {}],
    ['focus', {}],
    ['resume', {}],
    ['search', {}],
    ['search', { term: 'ledger' }],
    ['read_record', { id: ruled.refuses }],
    ['audit_timeline', { id: ruled.refuses }],
    ['audit_refs', { id: ruled.refuses }],
    ['governing_rules', { path: 'src/billing/invoice.ts' }],
    ['next_actions', { id: task }],
    ['audit_accountability', {}],
    ['audit_exposure', {}],
    ['audit_antipatterns', {}],
  ];
  for (const [name, args] of reads) {
    const why = Object.keys(args).length === 0 ? '' : ` ${JSON.stringify(Object.keys(args))}`;
    add(`tool answer: ${name}${why}`, await tool(name, args));
  }
  add(
    'tool answer: record_decision',
    await tool('record_decision', {
      title: 'Retries use exponential backoff',
      rationale: 'A fixed delay hammers a service that is already down',
      alternatives: 'a fixed delay: it makes a recovering service fall again',
    }),
  );
  add(
    'tool answer: capture_memory',
    await tool('capture_memory', { content: 'The staging database is reset every Sunday' }),
  );

  // What each definition weighs, which the host pays when it does not defer them.
  const listed = await client.listTools();
  for (const definition of listed.tools) {
    add(`tool definition: ${definition.name}`, JSON.stringify(definition));
  }
  add(`tool definitions: all ${listed.tools.length}`, JSON.stringify(listed.tools));
});

afterAll(async () => {
  await client?.close();
  for (const other of others) await other.close();
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

/** The golden: one line per channel, `bytes` then `o200k` tokens, in the order they are read. */
function budget(): string {
  const width = Math.max(...channels.map((c) => c.label.length));
  const rows = channels.map((c) => {
    const text = scrub(c.text);
    const bytes = String(Buffer.byteLength(text, 'utf8')).padStart(7);
    const tokens = String(encode(text).length).padStart(7);
    return `${c.label.padEnd(width)}  ${bytes} B  ${tokens} tok`;
  });
  return `${[
    'The size of every channel the model reads, over one fixture record.',
    'Bytes are UTF-8; tokens are o200k_base, a relative measure and not what a Claude model bills.',
    '',
    ...rows,
  ].join('\n')}\n`;
}

describe('the budget of each channel', () => {
  it('has every channel carry text, so a number of zero is never a pass', () => {
    for (const c of channels) {
      expect(scrub(c.text).trim().length, c.label).toBeGreaterThan(0);
    }
  });

  it('answers the edge of an edit with the three decisions it is a budget for', () => {
    const by = (label: string) => scrub(channels.find((c) => c.label === label)?.text ?? '');
    expect(by('edit: rules pushed')).toContain('"additionalContext"');
    expect(by('edit: asks for a person')).toContain('"permissionDecision":"ask"');
    expect(by('edit: refuses the write')).toContain('"permissionDecision":"deny"');
  });

  it('carries the sentence that names the other run at the path it consulted', () => {
    const asks = channels.find((c) => c.label === 'edit: asks for a person')?.text ?? '';
    expect(scrub(asks)).toContain('Another run (codex) consulted this path');
  });

  it('carries nothing of the machine it was measured on', () => {
    const all = channels.map((c) => scrub(c.text)).join('\n');
    expect(all).not.toContain(sandbox);
    expect(all).not.toContain(env.home ?? '\u0000');
  });

  it('is the budget the golden pins', async () => {
    await expect(budget()).toMatchFileSnapshot('./the-channels-have-a-budget.golden.txt');
  });
});
