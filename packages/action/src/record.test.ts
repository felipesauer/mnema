import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalStringify,
  decisionBirth,
  decisionRecorded,
  decisionTransitioned,
  entryHash,
  identityFounded,
  openChainForWriting,
  writtenAsStored,
} from '@mnema/chain';
import { afterEach, describe, expect, it } from 'vitest';
import { decisionLabels, eventsAdded, readEvents, whatItDoes } from './record.js';

/** One line of a tail, the shape the chain writes: the event and the link that chains it. */
const line = (
  hash: string,
  kind: string,
  subject: string,
  payload: Record<string, unknown> = {},
): string => JSON.stringify({ event: { kind, subject, payload }, link: { hash, seq: 0 } });

describe('readEvents', () => {
  it('reads events and leaves out what is not one', () => {
    const text = [
      line('h1', 'decision.recorded', 'd1', { title: 'T' }),
      '',
      'not json',
      JSON.stringify({ seq: 3, through: 'h1' }),
      JSON.stringify({ event: { kind: 'x', subject: 's' }, link: {} }),
      line('h2', 'knowledge.linked', 'ADR-1'),
    ].join('\n');
    expect(readEvents(text).map((e) => [e.hash, e.kind])).toEqual([
      ['h1', 'decision.recorded'],
      ['h2', 'knowledge.linked'],
    ]);
  });
});

describe('eventsAdded', () => {
  it('is what the head holds and the base did not', () => {
    const base = readEvents([line('a', 'k', 's'), line('b', 'k', 's')].join('\n'));
    const head = readEvents(
      [line('a', 'k', 's'), line('b', 'k', 's'), line('c', 'k', 's')].join('\n'),
    );
    expect(eventsAdded(base, head).map((e) => e.hash)).toEqual(['c']);
    expect(eventsAdded(head, head)).toEqual([]);
  });
});

describe('whatItDoes', () => {
  const thisPrText = [
    line('3', 'decision.transitioned', 'd1', {
      from: 'proposed',
      to: 'accepted',
      action: 'accept',
    }),
    line('4', 'decision.recorded', 'd2', { adr: 'ADR-2', title: 'Second' }),
    line('5', 'decision.transitioned', 'd2', { from: null, to: 'proposed', action: 'create' }),
    line('6', 'knowledge.linked', 'd1', { rel: 'governs', target: 'src' }),
  ].join('\n');
  const thisPr = readEvents(thisPrText);
  // What the head's record calls each decision: `decisionLabels` reads it, below.
  const labels = new Map([
    ['d1', { adr: 'ADR-1', title: 'Keep money as integer cents' }],
    ['d2', { adr: 'ADR-2', title: 'Second' }],
  ]);
  const report = whatItDoes(thisPr, labels);

  it('counts the new events per kind, most numerous first', () => {
    expect(report.total).toBe(4);
    expect(report.byKind).toEqual([
      ['decision.transitioned', 2],
      ['decision.recorded', 1],
      ['knowledge.linked', 1],
    ]);
  });

  it('names a decision moved here by the title and ADR label of its earlier birth', () => {
    expect(report.decisions).toEqual([
      { id: 'd1', adr: 'ADR-1', title: 'Keep money as integer cents', to: ['accepted'] },
      { id: 'd2', adr: 'ADR-2', title: 'Second', to: ['proposed'] },
    ]);
  });

  it('says nothing about a pull request that adds nothing', () => {
    expect(whatItDoes([], labels)).toEqual({
      total: 0,
      byKind: [],
      decisions: [],
    });
  });
});

describe('decisionLabels', () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const tmp = (prefix: string): string => {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    scratch.push(dir);
    return dir;
  };
  const at = (second: number) => new Date(Date.UTC(2026, 9, 27, 12, 0, second)).toISOString();

  /**
   * A writes "Use SQLite" and accepts it; B, on a tail of its own A never read, writes the id
   * again as "Use MongoDB" at `forgedAt`: before A's writing, or after the accept. The files'
   * texts, as the Action reads them off git.
   */
  function record(forgedAt: number): string[] {
    const tree = tmp('mnema-action-labels-');
    const a = openChainForWriting(tree, { keyRoot: tmp('mnema-key-a-') });
    const b = openChainForWriting(tree, { keyRoot: tmp('mnema-key-b-') });
    for (const writer of [a, b]) {
      writer.append(
        identityFounded(
          {
            at: at(0),
            who: writer.anchor,
            signerFp: writer.signerFingerprint,
            subject: writer.anchor,
          },
          { foundingFp: writer.signerFingerprint },
        ),
      );
    }
    const env = (second: number) => ({
      at: at(second),
      who: a.anchor,
      signerFp: a.signerFingerprint,
      subject: 'd1',
    });
    for (const event of decisionBirth(env(10), {
      title: 'Use SQLite',
      rationale: 'One file',
      adr: 'ADR-1',
      initial: 'proposed',
    })) {
      a.append(event);
    }
    a.append(
      decisionTransitioned(env(12), {
        from: 'proposed',
        to: 'accepted',
        action: 'accept',
        fields: { note: 'agreed' },
      }),
    );
    b.append(
      decisionRecorded(
        { at: at(forgedAt), who: b.anchor, signerFp: b.signerFingerprint, subject: 'd1' },
        { title: 'Use MongoDB', rationale: 'Schemaless', adr: 'ADR-1' },
      ),
    );
    const tails = join(tree, 'tails');
    return readdirSync(tails).flatMap((tail) =>
      readdirSync(join(tails, tail))
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => readFileSync(join(tails, tail, name), 'utf-8')),
    );
  }

  it('labels an accepted decision by the text its accept saw, not by a writing dated before it on a tail it never read', () => {
    expect(decisionLabels(record(5)).get('d1')).toEqual({ adr: 'ADR-1', title: 'Use SQLite' });
  });

  it('labels a decision by its first writing, not its last, when one id is written again later', () => {
    expect(decisionLabels(record(20)).get('d1')).toEqual({ adr: 'ADR-1', title: 'Use SQLite' });
  });

  it('reads past a line of a kind this mnema does not know, chained after the accept (ADR-113)', () => {
    const texts = record(20);
    // The tail holding the accept, one line longer: a kind no version declares, chained after it.
    const at = texts.findIndex((text) => text.includes('"action":"accept"'));
    const tail = texts[at] as string;
    const last = JSON.parse(tail.trimEnd().split('\n').at(-1) as string) as {
      event: { who: string; signerFp: string };
      link: { tail: string; seq: number; hash: string };
    };
    const event = {
      v: 1,
      kind: 'x.from-the-future',
      at: new Date(Date.UTC(2026, 9, 27, 12, 0, 30)).toISOString(),
      who: last.event.who,
      signerFp: last.event.signerFp,
      subject: 'd1',
      payload: { title: 'Use MongoDB', adr: 'ADR-1' },
    };
    const seq = last.link.seq + 1;
    const hash = entryHash({
      event: writtenAsStored(event),
      tail: last.link.tail,
      seq,
      prev: last.link.hash,
    });
    const link = { tail: last.link.tail, seq, prev: last.link.hash, hash };
    const grown = `${tail}${canonicalStringify({ event, link })}\n`;
    const read = texts.map((text, index) => (index === at ? grown : text));

    expect(decisionLabels(read).get('d1')).toEqual({ adr: 'ADR-1', title: 'Use SQLite' });
    // What the pull request adds is counted by its kind, and moves no decision.
    const added = eventsAdded(texts.flatMap(readEvents), read.flatMap(readEvents));
    expect(whatItDoes(added, decisionLabels(read))).toEqual({
      total: 1,
      byKind: [['x.from-the-future', 1]],
      decisions: [],
    });
  });
});
