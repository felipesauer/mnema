/**
 * `mnema export` over a REAL record, driven through the real entry.
 *
 * The copilot's own suite proves the mapping carries no body over a fixture of every
 * kind. This is the other half, and it is the half that answers for the PRODUCT: the
 * record is written by the actual write verbs, through the actual content door, and the
 * feed is read off the actual command line. A mapping that is clean over a fixture and a
 * verb that prints something else are two different facts, and only this one is about
 * what a person's machine would emit.
 *
 * It also binds the two readings of one declared window. `--from`/`--to`/`--who`/
 * `--which` are stated once (`AuthorshipFilter`) and READ twice — `accountability` counts
 * them in SQL over the reference index, this feed selects them in memory over the event
 * stream — because neither reading can be expressed as the other. Two readings of one rule
 * is the shape that produces silent divergence, so the rule is not that there is one
 * reading; the rule is that the two are held to the same answer over the same record, which
 * is what the matrix below does.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/**
 * The text every prose field of this record is poisoned with.
 *
 * It is shaped like nothing a scrubber recognizes, DELIBERATELY: a value the content door
 * would replace could never reach the chain, so a feed that dropped it would prove
 * nothing. What has to be proven is that a body the record legitimately HOLDS still does
 * not leave, and that is only testable with text the door lets through.
 */
const BODY = 'BODY-MARKER-must-never-leave-the-machine';

function capture(): { io: CliIo; out: string[]; err: string[]; failed: () => boolean } {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  return {
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      fail: () => {
        failed = true;
      },
    },
    out,
    err,
    failed: () => failed,
  };
}

/** Runs a verb and returns its stdout lines, failing loudly if the verb refused. */
async function mnema(...argv: string[]): Promise<string[]> {
  const c = capture();
  await run(argv, c.io);
  if (c.failed()) throw new Error(`mnema ${argv.join(' ')} failed: ${c.err.join(' / ')}`);
  return c.out;
}

/** Every string anywhere in every payload of a tree — the record's own bodies. */
function recordedText(root: string | undefined): string[] {
  if (root === undefined || !existsSync(root)) return [];
  const found: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      found.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) collect(item);
    }
  };
  for (const event of orderedEvents({ root }, catalogUpcasters())) collect(event.payload);
  return found;
}

function treesOf() {
  return resolveTrees(repo, { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') });
}

/**
 * A record with a body in every write this surface offers, and a session around it.
 *
 * Every free-text argument carries {@link BODY}, so whichever field a mapping could copy,
 * it copies the marker. Returns the identity the record was founded with.
 */
async function aRecordFullOfBodies(): Promise<{ anchor: string; task: string }> {
  const founded = await mnema('init');
  const anchor = (founded.find((line) => line.trim().startsWith('identity:')) ?? '')
    .trim()
    .slice('identity:'.length)
    .trim();

  const started = await mnema('run', 'start', '--which', 'agent-alpha', '--goal', BODY);
  process.env.MNEMA_RUN = after(started, 'Started run ');

  const task = after(await mnema('task', `a task about ${BODY}`), 'Created task ');
  await mnema('task', 'move', 'submit', task, '--note', BODY);
  const decision = after(await mnema('decision', `a decision about ${BODY}`, BODY), 'Recorded ');
  await mnema('decision', 'move', 'accept', decision, '--note', BODY);
  // A skill is BORN proposed, so its report says so — the workflow's own word, not a
  // generic "created".
  const skill = after(
    await mnema('skill', `a pattern about ${BODY}`, '--body', BODY),
    'Proposed skill ',
  );
  await mnema('skill', 'move', 'review', skill, '--note', BODY);
  await mnema('memory', BODY);
  await mnema('observe', task, '--topic', BODY, '--text', BODY);
  await mnema('handoff', task, `from-${BODY}`, `to-${BODY}`);
  await mnema('link', task, decision, '--rel', 'relates-to');
  await mnema('switch', 'off', 'edit-rules-push', '--reason', BODY);
  await mnema('run', 'end', '--which', 'agent-alpha', '--outcome', BODY);
  delete process.env.MNEMA_RUN;
  return { anchor, task };
}

/**
 * The id a write's report names, after the phrase that introduces it.
 *
 * READ FROM THE PARENTHESES when there are any. A birth prints its display ALIAS first
 * and the id beside it (`Created task t-4f2a (0198f3c1-…)`), and the alias is a label
 * rather than a second key — a verb handed one answers "No task t-4f2a here." So the
 * bracketed value is the id whenever the line carries one, and the bare word only where a
 * kind mints no alias (a run).
 */
function after(lines: readonly string[], lead: string): string {
  for (const line of lines) {
    const at = line.indexOf(lead);
    if (at === -1) continue;
    const rest = line.slice(at + lead.length).trim();
    return rest.match(/\(([^)]+)\)/)?.[1] ?? rest.split(/\s/)[0] ?? '';
  }
  throw new Error(`setup: no line carried "${lead}" — got ${lines.join(' / ')}`);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-feed-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  process.chdir(repo);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('mnema export — the feed leaves the bodies behind', () => {
  it('emits not one byte of any body, over a record that is full of them', async () => {
    await aRecordFullOfBodies();

    // NON-VACUITY FIRST, and it is not a formality: the assertion below is an ABSENCE, so
    // it is worth exactly what the proof that the marker is really in the record is worth.
    // A setup that silently stopped writing bodies would leave the absence trivially true.
    const trees = treesOf();
    const bodies = [
      ...recordedText(trees.projectPublic),
      ...recordedText(trees.projectPrivate),
      ...recordedText(trees.global),
    ].filter((text) => text.includes(BODY));
    expect(bodies.length).toBeGreaterThanOrEqual(12);

    // …and now the feed, byte for byte.
    const feed = await mnema('export');
    expect(feed.length).toBeGreaterThan(0);
    expect(feed.join('\n')).not.toContain(BODY);
    // The marker minus its shape, in case a mapping copied a substring of a body rather
    // than a whole field.
    expect(feed.join('\n')).not.toContain('must-never-leave');
  });

  it('is NDJSON: one complete object per line, and nothing around them', async () => {
    await aRecordFullOfBodies();
    const feed = await mnema('export');
    for (const line of feed) {
      expect(line).not.toContain('\n');
      const parsed = JSON.parse(line) as { class_uid: number; category_uid: number };
      expect(parsed.class_uid).toBe(3004);
      expect(parsed.category_uid).toBe(3);
    }
    // No array wrapper, no header, no trailing separator: the first and last lines are
    // records like every other.
    expect(feed[0]?.startsWith('{')).toBe(true);
    expect(feed[feed.length - 1]?.endsWith('}')).toBe(true);
  });

  it('carries what it takes to find the fact back in the record', async () => {
    const { task } = await aRecordFullOfBodies();
    const feed = (await mnema('export')).map(
      (line) =>
        JSON.parse(line) as { entity: { uid: string }; metadata: { original_time: string } },
    );
    const born = feed.find((line) => line.entity.uid === task);
    expect(born).toBeDefined();
    // The subject is the id the reads take, so the line's own value walks straight back
    // into the record it came from. Nothing was invented to make that true.
    const story = await mnema('timeline', born?.entity.uid ?? 'no-such-id');
    expect(story.join('\n')).toContain(task);
    expect(born?.metadata.original_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('answers ONE window with two readings that agree — the feed and the count', async () => {
    // A3, held rather than declared. `accountability` counts the window in SQL over the
    // reference index; the feed selects it in memory over the event stream. A condition
    // added to one and not the other is red HERE, on the record both read.
    const { anchor } = await aRecordFullOfBodies();
    const short = anchor.slice('mnid:'.length, 'mnid:'.length + 8);
    const windows: string[][] = [
      [],
      ['--who', anchor],
      // The same identity by the SHORT form every read prints, which is the form a person
      // pastes — and which both verbs have to resolve the same way or the counts part.
      ['--who', short],
      ['--which', 'agent-alpha'],
      ['--which', 'nobody-by-that-name'],
      ['--from', '2000-01-01T00:00:00.000Z'],
      ['--to', '2000-01-01T00:00:00.000Z'],
      ['--from', '2000-01-01T00:00:00.000Z', '--to', '2099-01-01T00:00:00.000Z'],
      ['--who', anchor, '--which', 'agent-alpha'],
    ];
    for (const window of windows) {
      const counted = JSON.parse(
        (await mnema('accountability', '--json', ...window)).join('\n'),
      ) as {
        total: number;
      };
      const lines = await mnema('export', ...window);
      expect({ window, lines: lines.length }).toEqual({ window, lines: counted.total });
    }

    // The matrix's own teeth: at least one window has to EXCLUDE something, or every row
    // above is the same trivially-equal pair.
    const all = (await mnema('export')).length;
    const none = (await mnema('export', '--which', 'nobody-by-that-name')).length;
    expect(all).toBeGreaterThan(0);
    expect(none).toBe(0);
    const byAgent = (await mnema('export', '--which', 'agent-alpha')).length;
    expect(byAgent).toBeGreaterThan(0);
    expect(byAgent).toBeLessThan(all);
  });

  it('refuses a --who that names nobody instead of answering an empty feed', async () => {
    await aRecordFullOfBodies();
    const c = capture();
    await run(['export', '--who', 'nobody'], c.io);
    expect(c.failed()).toBe(true);
    expect(c.out).toEqual([]);
    // The one answer that looks like an answer and is not: a prefix left unresolved would
    // filter on a `who` that matches nothing and come back as an empty feed.
    expect(c.err.join('\n')).toContain('UNKNOWN_ANCHOR');
  });

  it('refuses outside a project, like every other intelligence read', async () => {
    const c = capture();
    await run(['export'], c.io);
    expect(c.failed()).toBe(true);
    expect(c.out).toEqual([]);
  });
});
