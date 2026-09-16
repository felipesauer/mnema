/**
 * EVERY DOOR THAT SERVES THE RECORD SAYS WHEN THE RECORD DOES NOT CHAIN.
 *
 * ## What it was
 *
 * Two reads said it — `search` and `status` on the command line. Fifteen others did
 * not, and the MCP did not at all: `grep -rn "linkBreak" packages/code/src/mcp/` came
 * back with nothing, so not one of the twenty-five tools told an agent that what it was
 * being handed came off a record whose proof had failed. By this product's own axis the
 * agent is the principal reader, and it was the only one never told.
 *
 * ## Why this file is a SHAPE and not a behaviour
 *
 * The behaviour is next door, in `the-read-says-the-record-does-not-chain.test.ts`,
 * which plants a real break in a real tail and reads what the real binary prints. What
 * that cannot do is catch the read added next year. A rule that lives at seventeen call
 * sites has a seventeen-plus-first, and the only thing that finds it is a walk of the
 * source keyed on the DISCRIMINANT rather than on a list somebody maintains.
 *
 * So the discriminant here is how this package opens a record at all — `withScopedCaches`
 * and a bare `ProjectionCache.open` — and every file that does either must ask
 * `linkBreaksOf` or be in `SERVES_NO_RECORD_CONTENT` with a written reason. THREE of the
 * sites this delivery covered were found that way and by no other means: `show`, `guard`
 * and `next-actions` open their caches directly, so the handoff's own `grep` for
 * `withScopedCaches` did not name them, and `show` is the verb that serves a record's
 * BODY.
 *
 * ## What it does not answer
 *
 * That the notice is CORRECT, or that it reaches the stream it should. Both belong to
 * the behavioural half. This says the obligation was not skipped.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  linkBreakBlock,
  linkBreakSentences,
  SERVES_NO_RECORD_CONTENT,
  TOOLS_SERVING_NO_RECORD_CONTENT,
} from '../src/record-integrity.js';

const SRC = join(import.meta.dirname, '..', 'src');

/** The two ways anything in this package opens a record to read it. */
const OPENS_A_RECORD = ['withScopedCaches(', 'ProjectionCache.open('];

/** The reading every door that serves the record has to ask for. */
const ASKS_THE_READING = 'linkBreaksOf';

/** Every `.ts` under `src`, as a path relative to it — tests excluded. */
function sources(dir = SRC, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...sources(join(dir, entry.name), at));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.includes('.test.')) continue;
    found.push(at);
  }
  return found;
}

const text = (relative: string): string => readFileSync(join(SRC, relative), 'utf-8');

describe('every read that opens the record either asks for the breaks or says why not', () => {
  // The module that DEFINES the reading is not a door, and it is excluded by reading
  // the source rather than by name: a file holding `export function linkBreaksOf` is
  // where the rule lives, and asking it to call itself would be asking for noise.
  const defines = (path: string): boolean =>
    text(path).includes(`export function ${ASKS_THE_READING}`);
  const opens = sources().filter(
    (path) => !defines(path) && OPENS_A_RECORD.some((how) => text(path).includes(how)),
  );

  // THE NON-VACUITY GUARD, and it runs first. A sweep whose pattern has stopped matching
  // finds nothing and reports success — this repository has been bitten by exactly that
  // — so the count is pinned above the number of doors the delivery covered.
  it('finds the doors at all', () => {
    expect(opens.length).toBeGreaterThanOrEqual(18);
  });

  it.each(opens)('%s', (path) => {
    const asks = text(path).includes(ASKS_THE_READING);
    const excused = SERVES_NO_RECORD_CONTENT[path];
    // Asserted as the PAIR rather than as two conditions, so a red says which of the two
    // it is: a file that does both is as wrong as one that does neither — an excuse
    // beside a call is an excuse nobody reads.
    expect({ path, asks, excused: excused !== undefined }).toStrictEqual({
      path,
      asks: excused === undefined,
      excused: excused !== undefined,
    });
  });

  it('excuses nothing that does not open a record', () => {
    // An entry left behind when its file stopped opening a record is an excuse for a
    // door that no longer exists, and the next reader takes it for a classification.
    expect(Object.keys(SERVES_NO_RECORD_CONTENT).filter((p) => !opens.includes(p))).toStrictEqual(
      [],
    );
  });

  it('gives a reason and not a marker', () => {
    for (const [path, why] of Object.entries(SERVES_NO_RECORD_CONTENT)) {
      expect(why.length, path).toBeGreaterThan(40);
    }
  });
});

describe('every wiring that prints such a read prints the notice', () => {
  /** The command modules that answer with the breaks — read off their source. */
  const answering = sources()
    .filter((path) => path.startsWith('commands/') && text(path).includes('readonly linkBreaks:'))
    .map((path) => path.slice('commands/'.length, -'.ts'.length));

  it('finds the commands at all', () => {
    expect(answering.length).toBeGreaterThanOrEqual(15);
  });

  /** The wirings, each with the command modules it loads. */
  const wirings = sources()
    .filter((path) => path.startsWith('wiring/'))
    .map((path) => ({
      path,
      body: text(path),
    }))
    .map((file) => ({
      ...file,
      loads: answering.filter((command) => file.body.includes(`'../commands/${command}.js'`)),
    }))
    .filter((file) => file.loads.length > 0);

  it('finds the wirings at all', () => {
    expect(wirings.length).toBeGreaterThanOrEqual(13);
  });

  it.each(wirings.map((file) => [file.path, file] as const))('%s', (_path, file) => {
    // The command answering with the breaks is only half of it: what the person reads is
    // what the WIRING writes, and a field nobody prints is a field that says nothing.
    expect({ wiring: file.path, prints: file.body.includes('linkBreakNotice(') }).toStrictEqual({
      wiring: file.path,
      prints: true,
    });
  });
});

describe('the MCP composes no payload of its own', () => {
  const server = text('mcp/server.ts');

  it('every tool answers through the one door', () => {
    // The composer is what carries the fact, so a payload built beside it is a tool that
    // does not. It is read as TEXT rather than by counting calls to `served`, because a
    // tool that never reached the composer would leave the count right and the reply
    // wrong.
    const handRolled = server
      .split('\n')
      .map((line, at) => ({ line: line.trim(), at: at + 1 }))
      .filter((row) => row.line.startsWith('return { content: [{'))
      .filter((row) => !row.line.includes('Refused ('));
    // ONE, and it is `rules_before_an_edit` — the hook reply, excused with its reason.
    expect(handRolled.map((row) => row.at)).toHaveLength(
      Object.keys(TOOLS_SERVING_NO_RECORD_CONTENT).length,
    );
    // And each excused tool is a tool this server actually registers — an excuse for a
    // name nothing registers is an excuse for nothing.
    for (const tool of Object.keys(TOOLS_SERVING_NO_RECORD_CONTENT)) {
      expect(/(reads|mutates)TheRecord\('([a-z_]+)'\)/g.test(server), tool).toBe(true);
      expect(server, tool).toContain(`TheRecord('${tool}')`);
    }
  });

  it('the composer asks the reading', () => {
    expect(server).toContain('linkBreakBlock(sessionLinkBreaks(session))');
  });
});

describe('the words have one home', () => {
  it('no other module writes the sentence', () => {
    const wrote = sources().filter(
      (path) => path !== 'record-integrity.ts' && text(path).includes('issue [T1]'),
    );
    expect(wrote).toStrictEqual([]);
  });

  it('and the two forms are the same words', () => {
    const breaks = [
      { scope: 'public' as const, tail: 'aa-01', seq: 4, detail: 'seq gap: expected 5, found 4' },
    ];
    const sentences = linkBreakSentences(breaks);
    const block = linkBreakBlock(breaks)[0] as string;
    // Every issue line of the one form is in the other, byte for byte: the difference
    // between the two is the frame around them and the door each names, never the fact.
    expect(block).toContain(sentences[0] as string);
    expect(sentences[0]).toContain('issue [T1] public aa-01#4:');
  });

  it('and both are empty over a record that chains', () => {
    // The vacuity guard for the words themselves: a form that spoke on an empty list
    // would make every case above pass over a notice printed unconditionally.
    expect(linkBreakSentences([])).toStrictEqual([]);
    expect(linkBreakBlock([])).toStrictEqual([]);
  });
});
