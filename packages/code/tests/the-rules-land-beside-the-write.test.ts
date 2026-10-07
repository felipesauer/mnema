/**
 * THE RULES LAND BESIDE THE WRITE, and every place that says when they arrive says so.
 *
 * WHAT WAS WRONG. The product said, in the document a session opens with, in the switch
 * listing, and on the plugin's manifest and page, that the rules addressed at a file arrive
 * BEFORE the file is written: "when a file is about to be changed", "just before writing that
 * file", "the rules before each edit". The host says otherwise, measured against the real
 * binary on 2.1.228 and again on 2.1.281: the hook fires
 * before the write, and the text it hands over reaches the conversation after the result of
 * that write — in time for every edit after it and for a correction of that one, and not for
 * the bytes of the edit that fired it. Only the pause a rule asks for holds a write. Nothing
 * was red: no case read the manifest or the pages, and the two cases that read the document
 * asserted the false sentence.
 *
 * WHAT IS HELD, from both sides:
 *   - every text that tells a reader what the per-edit push hands over says WHEN, in the words
 *     of the front page — "beside the result of that write". The product's texts are read where
 *     the product composes them (the document, the switch listing, the tool the host calls);
 *     the manifest and the pages are read as files. A new sentence that says "before" in other
 *     words fails here, because it does not say this;
 *   - none of the texts a reader is handed, and no page this repository publishes, carries one
 *     of the sentences that said "before". That side is a named list and not a judgement about
 *     English: it catches a sentence coming back, and the paraphrase is the first side's.
 *
 * WHAT IT CANNOT HOLD is the host. Where the text lands is a fact about one binary, measured
 * rather than tested: .
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import type { Brief, ChannelState } from '@mnema/context';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../src/mcp/instructions.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { briefDocument } from '../src/presentation/brief.js';
import { WHAT_STOPS } from '../src/record-framing.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The front page's words for when the rules arrive — the one phrasing, not a third. */
const WHEN = 'beside the result of that write';

/**
 * The sentences that said the rules arrive before the write, as they were printed, one per
 * place that said it. Matched with whitespace collapsed and case ignored, so a page that
 * re-wraps one does not hide it.
 */
const SAID_BEFORE = [
  'When a file is about to be changed, the rules addressed at it arrive',
  'handed over at the moment that file is about to be written',
  'handed over at the moment …',
  'when a file is about to be written, the rules of the record',
  'what a session is handed just before writing that file',
  'The rules before each edit',
  'Before a file is written, hands over the rules',
] as const;

let sandbox: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-rules-land-'));
  env = { home: sandbox };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A file of this repository, as text. */
function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

/** Whitespace collapsed, so a sentence wrapped across lines reads as one line. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * The passage of a page that holds `anchor`: the paragraph, list item or table row it sits
 * in. An anchor the page no longer holds is a red that names it — never a passage of
 * nothing that trivially passes.
 */
function passageAt(page: string, anchor: string): string {
  const lines = read(page).split('\n');
  const at = lines.findIndex((line) => line.includes(anchor));
  if (at === -1) throw new Error(`${page} no longer holds "${anchor}"`);
  const blank = (line: string | undefined) => line === undefined || line.trim() === '';
  const item = (line: string | undefined) => line !== undefined && /^\s*- /.test(line);
  const row = (line: string | undefined) => line?.startsWith('|') === true;
  if (row(lines[at])) return lines[at] ?? '';
  // Up to the line that opens the item or the paragraph, down to the line before the next.
  let first = at;
  while (first > 0 && !item(lines[first]) && !blank(lines[first - 1]) && !row(lines[first - 1])) {
    first -= 1;
  }
  let last = at;
  while (!blank(lines[last + 1]) && !item(lines[last + 1]) && !row(lines[last + 1])) last += 1;
  return flat(lines.slice(first, last + 1).join('\n'));
}

/** A channel that is on, the way the composition receives it. */
const ON = (channel: string): ChannelState => ({ channel, on: true });

/** A channel switched off in the committed record, by somebody, at some time. */
const OFF = (channel: string): ChannelState => ({
  channel,
  on: false,
  by: '0198f3c1-7a2e-7b41-9c05-3d8e6f2a9f01',
  at: '2026-08-19T11:04:07.512Z',
  travels: true,
});

/** The document for a record with one decision in force that has an address. */
function documentWith(editPush: ChannelState, asksAPerson: ChannelState): string {
  const brief: Brief = {
    decisions: [
      {
        id: '0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b01',
        adr: 'ADR-1',
        title: 'Round money at the boundary',
      },
    ],
    skills: [],
    collisions: [],
    divergent: [],
    addressed: 1,
    asking: 0,
    refusing: 0,
    decisionsAwaiting: 0,
    skillsAwaiting: 0,
    editPush,
    asksAPerson,
    refusesAWrite: { channel: 'edit-refuses-a-write', on: true },
  };
  return briefDocument(brief).join('\n');
}

/** Every tool the protocol advertises, with the description a client is handed. */
async function described(): Promise<{ name: string; description: string }[]> {
  const project = join(sandbox, 'proj');
  mkdirSync(project, { recursive: true });
  ensureTree({ root: join(project, PROJECT_DIR) });
  const { server } = buildMcpServer({ cwd: sandbox, env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => ({ name: tool.name, description: tool.description ?? '' }));
}

/** The description the plugin's manifest of hooks carries. */
function hooksDescription(): string {
  return (JSON.parse(read('plugin/hooks/hooks.json')) as { description: string }).description;
}

/** Which of the retired sentences `text` still carries. */
function saysBefore(text: string): readonly string[] {
  const seen = flat(text).toLowerCase();
  return SAID_BEFORE.filter((sentence) => seen.includes(flat(sentence).toLowerCase()));
}

describe('every text that says what the per-edit push hands over says when', () => {
  it('in the document a session opens with, while the push is on', () => {
    // The sentence the count explains. With the push off the document says nothing arrives,
    // which needs no "when" — so that half is not asked for it.
    expect(flat(documentWith(ON('edit-rules-push'), ON('edit-asks-a-person')))).toContain(WHEN);
    expect(flat(documentWith(OFF('edit-rules-push'), ON('edit-asks-a-person')))).not.toContain(
      WHEN,
    );
  });

  it('in the switch listing', () => {
    expect(WHAT_STOPS['edit-rules-push']).toContain(WHEN);
  });

  it('in the description of the tool the host calls', async () => {
    const tool = (await described()).find((one) => one.name === 'rules_before_an_edit');
    expect(tool?.description).toContain(WHEN);
  });

  it("in the plugin's manifest of hooks", () => {
    expect(hooksDescription()).toContain(WHEN);
  });

  it.each([
    ['plugin/README.md', 'One installation, both surfaces.'],
    ['plugin/README.md', '**A `PreToolUse` hook** on'],
    ['plugin/README.md', '| **It is a snapshot** |'],
    ['plugin/README.md', 'The rules it reports as governing that path'],
    ['plugin/README.md', '| **The rules at each edit** |'],
    ['packages/code/README.md', 'A `PreToolUse` hook on'],
  ])('on %s, where it says "%s"', (page, anchor) => {
    expect(passageAt(page, anchor)).toContain(WHEN);
  });
});

describe('no text a reader is handed says the rules arrive before the write', () => {
  it('in any document, whichever channel is switched off', () => {
    for (const push of [ON('edit-rules-push'), OFF('edit-rules-push')]) {
      for (const gate of [ON('edit-asks-a-person'), OFF('edit-asks-a-person')]) {
        expect(saysBefore(documentWith(push, gate))).toEqual([]);
      }
    }
  });

  it('in the switch listing, the tools, the instructions and the manifest', async () => {
    const texts = [
      ...Object.values(WHAT_STOPS),
      ...(await described()).map((tool) => tool.description),
      SERVER_INSTRUCTIONS,
      hooksDescription(),
      read('plugin/.claude-plugin/plugin.json'),
      read('.claude-plugin/marketplace.json'),
    ];
    expect(texts.flatMap(saysBefore)).toEqual([]);
  });

  it.each([
    'README.md',
    'plugin/README.md',
    'packages/code/README.md',
    'packages/context/README.md',
    'packages/core/README.md',
    'packages/chain/README.md',
  ])('on %s', (page) => {
    expect(saysBefore(read(page))).toEqual([]);
  });

  it('and the list reads what it names — a page carrying one is found', () => {
    // The instrument's own case: a list that matched nothing it names would pass every page.
    // Each sentence, wrapped as a page would wrap it and with its case changed, is found.
    for (const sentence of SAID_BEFORE) {
      const wrapped = `Some prose.\n${sentence.replace(' ', '\n').toUpperCase()}, and more.`;
      expect(saysBefore(wrapped)).toEqual([sentence]);
    }
    expect(saysBefore(`A rule lands ${WHEN}, in time for every edit after it.`)).toEqual([]);
  });
});
