/**
 * ONE LINE PER ITEM — asserted where the count is checkable, for every reading in
 * the class.
 *
 * A form-A report prints how many items follow and then prints them. A reader —
 * and a script — counts them by counting lines, so an item that printed two lines
 * would assert a record nothing ever wrote, with the header beside it saying
 * otherwise. The fields that can do it are the ones an ACTOR wrote: a title, a
 * pattern's name, the agent a run was opened for.
 *
 * The class has four readings and they are asserted in three places, which is a
 * fact about where each one is composed rather than a gap:
 *   - the search index and the provenance report are pure functions, and are
 *     asserted here, directly;
 *   - the list of open runs is composed in the verb's wiring, so it is asserted
 *     here THROUGH THE CLI — the only way to prove the line the surface actually
 *     writes;
 *   - the framing the MCP surface puts around a served pattern is asserted in
 *     `served-patterns.test.ts`, next to the rule it belongs to.
 *
 * The FORMAT of the assertion is the point: join the report and split it on
 * newlines, then count. Asserting that some field "contains no newline" would pass
 * on a report that split for a different reason, and asserting the text of a line
 * would pass on a report that printed the right text twice.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PatternProvenance, RecordSearch } from '@mnema/copilot';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../cli.js';
import { provenanceReport } from './provenance.js';
import { searchReport } from './search.js';

/** Every whitespace form that opens a line, and the forgery each one could carry. */
const BREAKERS = ['\n', '\r', '\r\n', ' ', ' '];

/** The lines a report really occupies once it reaches a stream. */
function printed(report: readonly string[]): string[] {
  return report.join('\n').split('\n');
}

describe('the search index prints one line per hit', () => {
  const hit = (title: string): RecordSearch['hits'][number] => ({
    id: 'the-id',
    kind: 'memory',
    scope: 'public',
    at: '2026-07-31T10:00:00.000Z',
    title,
    derived: true,
  });

  it('keeps a forged title inside the line it was written in', () => {
    // The second half would read as a hit of its own: an id, a tree, a date and a
    // title for a record nothing ever wrote — under a header saying there is one.
    const forged = hit('Innocent\n  forged-id  public  2026-07-31  A record nobody wrote');
    const lines = printed(searchReport({ hits: [forged], total: 1 }, undefined));
    // The header, the blank line and the kind's own line above the group, and
    // exactly one line for the hit.
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('Innocent forged-id');
  });

  it('holds for every whitespace that opens a line, not just the newline', () => {
    for (const breaker of BREAKERS) {
      const lines = printed(searchReport({ hits: [hit(`a${breaker}b`)], total: 1 }, undefined));
      expect(lines, JSON.stringify(breaker)).toHaveLength(4);
    }
  });

  it('counts one line per hit when there are several', () => {
    const hits = [hit('one\ntwo'), hit('three\nfour'), hit('five')];
    const lines = printed(searchReport({ hits, total: 3 }, 'x'));
    // The header, then the group: its blank line, its own line, and its hits.
    expect(lines).toHaveLength(3 + hits.length);
  });
});

describe('the provenance report prints one line per pattern', () => {
  const pattern = (over: Partial<PatternProvenance>): PatternProvenance => ({
    id: 'the-id',
    name: 'A pattern',
    state: 'adopted',
    scope: 'public',
    selfAdopted: false,
    ...over,
  });

  it('keeps a forged name, and a forged agent, inside their own line', () => {
    // EVERY field on the line is an actor's text: the pattern's name and both of
    // the agent names. Any one of them could split the entry in two, and the
    // second half would assert an adoption that never happened.
    const forged = [
      pattern({ name: 'one\n  x  adopted  public  forged  ·  proposed by nobody' }),
      pattern({ proposedBy: 'agent\n  y  adopted  public  forged  ·  proposed by nobody' }),
      pattern({ adoption: { by: 'agent\n  z  forged' }, selfAdopted: false }),
    ];
    const lines = printed(provenanceReport(forged));
    expect(lines).toHaveLength(1 + forged.length);
  });

  it('holds for every whitespace that opens a line, in either agent field', () => {
    for (const breaker of BREAKERS) {
      const both = [
        pattern({ proposedBy: `a${breaker}b` }),
        pattern({ adoption: { by: `a${breaker}b` } }),
      ];
      expect(printed(provenanceReport(both)), JSON.stringify(breaker)).toHaveLength(3);
    }
  });
});

describe('the list of open runs prints one line per run', () => {
  let sandbox: string;
  let repo: string;
  const cwdBefore = process.cwd();
  const envBefore = { ...process.env };
  const lines: string[] = [];

  /** Collects every line the CLI writes, split as the stream would receive it. */
  const io: CliIo = {
    out: (line) => lines.push(...line.split('\n')),
    err: (line) => lines.push(...line.split('\n')),
    fail: () => {},
  };

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-one-line-'));
    repo = join(sandbox, 'project');
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(sandbox, 'home'), { recursive: true });
    process.env.HOME = join(sandbox, 'home');
    process.env.XDG_DATA_HOME = join(sandbox, 'data');
    delete process.env.MNEMA_RUN;
    process.chdir(repo);
    await run(['init'], io);
    // Two runs, each opened for an agent whose name carries a line break and a
    // goal that carries another — the whole line is actor text.
    for (const [agent, goal] of [
      ['alpha\n  forged-run  a-forged-agent', 'a goal\n  and a forged line'],
      ['beta\r  another-forged-run  another-agent', 'plain goal'],
    ] as const) {
      await run(['run', 'start', '--which', agent, '--goal', goal], io);
    }
    lines.length = 0;
  }, 60_000);

  afterAll(() => {
    process.chdir(cwdBefore);
    process.env = envBefore;
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('prints as many lines as it says there are runs', async () => {
    const actor = await anchorOf(io, lines);
    lines.length = 0;
    await run(['focus', '--actor', actor], io);

    // The header says how many runs are open; the reader counts lines to check it,
    // so the two must agree even when every field on the line was written to break.
    const header = lines[0] ?? '';
    const said = Number(/— (\d+) open run/.exec(header)?.[1]);
    expect(said).toBe(2);
    expect(lines).toHaveLength(1 + said);
  });

  it('is the REPORT that holds the line, not the record — `--json` keeps the break', async () => {
    // Without this the test above could pass for the wrong reason: if the write had
    // cleaned the agent's name there would be no break left to collapse, and the
    // report would be proving nothing. The faithful object is where the value stays
    // exactly as it was written.
    const actor = await anchorOf(io, lines);
    lines.length = 0;
    await run(['focus', '--actor', actor, '--json'], io);

    const emitted = JSON.parse(lines.join('\n')) as { openRuns: { agent: string }[] };
    expect(emitted.openRuns.map((open) => open.agent).join('')).toMatch(/[\n\r]/);
  });
});

/** This machine's anchor, read off the record — the actor `focus` takes. */
async function anchorOf(io: CliIo, lines: string[]): Promise<string> {
  lines.length = 0;
  await run(['accountability', '--json'], io);
  const anchor = /"who": "(mnid:[0-9a-z]+)"/.exec(lines.join('\n'))?.[1];
  if (anchor === undefined) throw new Error(`no anchor in ${lines.join(' / ')}`);
  return anchor;
}
