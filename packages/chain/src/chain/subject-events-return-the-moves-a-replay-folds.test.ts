/**
 * THE EVENTS ABOUT A SUBJECT ARE THE MOVES A REPLAY FOLDS: the ones the workflow allows, judged
 * as the writer saw them, and a tail that is not in the shape the light read expects is read by
 * parsing, which refuses what is not a line.
 *
 * `subject-events.test.ts` holds the search and the order. These hold the judgment that the
 * search hands its events to: a successor is a birth the record holds even when nobody asked for
 * it, a writer's sight is counted in the positions of its own tail, and a line of the wrong shape
 * in a tail that is merged is refused whatever subject it is about.
 */

import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decisionBirth, decisionTransitioned, memoryCaptured, taskBirth } from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting } from './chain.js';
import { tailDir } from './layout.js';
import { UnreadableLineError } from './lines.js';
import { subjectEvents } from './subject-events.js';

const upcasters = catalogUpcasters();
const D1 = '0a1b2c3d-0000-4000-8000-0000000000d1';
const D2 = '0a1b2c3d-0000-4000-8000-0000000000d2';
const T = (n: number) => `2026-10-01T00:00:0${n}.000Z`;

let root: string;
const keys: string[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-subject-moves-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const dir of keys.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A writer of its own tail and key; `say` stamps the envelope with the instant it is given. */
function machine(options: { citeHeads?: boolean } = {}) {
  const keyRoot = mkdtempSync(join(tmpdir(), 'mnema-subject-moves-key-'));
  keys.push(keyRoot);
  const writer = openChainForWriting(root, { keyRoot, maxUnsignedEvents: 10_000, ...options });
  const env = (subject: string, at: string) => ({
    at,
    who: writer.anchor,
    signerFp: writer.signerFingerprint,
    subject,
  });
  return {
    tail: writer.tail,
    env,
    append: (event: CatalogEvent) => writer.append(event),
    note: (subject: string, at: string) =>
      writer.append(memoryCaptured(env(subject, at), { content: at })),
  };
}

const kinds = (events: readonly CatalogEvent[] | undefined) =>
  events?.map((event) =>
    event.kind === 'decision.transitioned'
      ? `${event.payload.from ?? 'null'}>${event.payload.to}`
      : event.kind,
  );

const birthOf = (m: ReturnType<typeof machine>, subject: string, at: string) => {
  for (const event of decisionBirth(m.env(subject, at), {
    title: 't',
    rationale: 'r',
    adr: 'ADR-1',
    initial: 'proposed',
  })) {
    m.append(event);
  }
};

const move = (
  m: ReturnType<typeof machine>,
  at: string,
  payload: Parameters<typeof decisionTransitioned>[1],
  subject = D1,
) => m.append(decisionTransitioned(m.env(subject, at), payload));

const accept = { from: 'proposed', to: 'accepted', action: 'accept', fields: { note: 'n' } };
const supersede = (by: string) => ({
  from: 'accepted',
  to: 'superseded',
  action: 'supersede',
  by,
  fields: { reason: 'r' },
});

describe('a supersede is kept when the record holds the birth of its successor', () => {
  it('reads the birth of a successor nobody asked about', () => {
    const m = machine();
    birthOf(m, D1, T(1));
    birthOf(m, D2, T(2));
    move(m, T(3), accept);
    move(m, T(4), supersede(D2));

    const found = subjectEvents({ root }, upcasters, [D1]);
    expect(kinds(found.get(D1))).toEqual([
      'decision.recorded',
      'null>proposed',
      'proposed>accepted',
      'accepted>superseded',
    ]);
    expect(found.has(D2)).toBe(false);
  });

  it('drops a supersede whose successor the record never held a birth of', () => {
    const m = machine();
    birthOf(m, D1, T(1));
    move(m, T(3), accept);
    move(m, T(4), supersede(D2));

    expect(kinds(subjectEvents({ root }, upcasters, [D1]).get(D1))).toEqual([
      'decision.recorded',
      'null>proposed',
      'proposed>accepted',
    ]);
  });

  it('does not take for a birth a decision that was only moved, or a task', () => {
    const m = machine();
    birthOf(m, D1, T(1));
    move(m, T(2), accept);
    // D2 is moved without a birth, and D3 is the id of a task: neither is a decision born.
    move(m, T(3), accept, D2);
    for (const event of taskBirth(m.env('0a1b2c3d-0000-4000-8000-0000000000d3', T(4)), {
      title: 't',
      initial: 'DRAFT',
    })) {
      m.append(event);
    }
    move(m, T(5), supersede(D2));
    expect(kinds(subjectEvents({ root }, upcasters, [D1]).get(D1))).toEqual([
      'decision.recorded',
      'null>proposed',
      'proposed>accepted',
    ]);

    const other = machine();
    move(other, T(6), supersede('0a1b2c3d-0000-4000-8000-0000000000d3'));
    expect(kinds(subjectEvents({ root }, upcasters, [D1]).get(D1))).toEqual([
      'decision.recorded',
      'null>proposed',
      'proposed>accepted',
    ]);
  });

  it('counts a successor that is among the subjects asked for', () => {
    const m = machine();
    birthOf(m, D1, T(1));
    birthOf(m, D2, T(2));
    move(m, T(3), accept);
    move(m, T(4), supersede(D2));

    const found = subjectEvents({ root }, upcasters, [D1, D2]);
    expect(kinds(found.get(D1))?.at(-1)).toBe('accepted>superseded');
    expect(kinds(found.get(D2))).toEqual(['decision.recorded', 'null>proposed']);
  });
});

describe('a writer is judged by the positions of its own tail', () => {
  it('keeps a move whose writer read only the birth, however many entries sit before it', () => {
    // Tail a: three notes, the birth, then (later in time) the accept. Tail b read the birth and
    // not the accept, and rejects: two machines that did not see each other, a divergence.
    const a = machine();
    const b = machine({ citeHeads: true });
    a.note('other', T(1));
    a.note('other', T(2));
    a.note('other', T(3));
    birthOf(a, D1, T(4));
    b.note('other', T(5));
    move(b, T(8), { from: 'proposed', to: 'rejected', action: 'reject', fields: { note: 'n' } });
    move(a, T(7), accept);

    expect(kinds(subjectEvents({ root }, upcasters, [D1]).get(D1))).toEqual([
      'decision.recorded',
      'null>proposed',
      'proposed>accepted',
      'proposed>rejected',
    ]);
  });

  it('drops a move whose writer read the move it then contradicts', () => {
    const a = machine();
    const b = machine({ citeHeads: true });
    a.note('other', T(1));
    a.note('other', T(2));
    birthOf(a, D1, T(3));
    move(a, T(4), accept);
    b.note('other', T(5));
    move(b, T(6), { from: 'proposed', to: 'rejected', action: 'reject', fields: { note: 'n' } });

    expect(kinds(subjectEvents({ root }, upcasters, [D1]).get(D1))).toEqual([
      'decision.recorded',
      'null>proposed',
      'proposed>accepted',
    ]);
  });
});

describe('a tail that is merged is read line by line, and a line of the wrong shape is refused', () => {
  const HASH = 'ab'.repeat(32);
  const wrong: Record<string, string> = {
    'no link': '{"event":{"at":"2026-10-01T00:00:01.000Z"}}',
    'an instant that is never closed': '{"event":{"at":"2026-10-01T00:00:01.000Z',
    'a hash that is too short': '{"event":{"at":"x"},"link":{"hash":"abcd"}}',
    'a hash that is not closed': `{"event":{"at":"x"},"link":{"hash":"${HASH}}`,
    'a citation list that is never closed': `{"event":{"after":["${HASH}"`,
    'a citation that is not a hash': `{"event":{"after":["abcd"],"at":"x"},"link":{"hash":"${HASH}"}}`,
    'a citation that is not quoted': `{"event":{"after":[${HASH}],"at":"x"},"link":{"hash":"${HASH}"}}`,
    'a citation list not followed by the instant': `{"event":{"after":["${HASH}"],"zz":"x"},"link":{"hash":"${HASH}"}}`,
    'an instant after the citations that is never closed': `{"event":{"after":["${HASH}"],"at":"x`,
    'a line of another shape': `{"link":{"hash":"${HASH}"},"event":{"at":"x"}}`,
  };

  for (const [name, line] of Object.entries(wrong)) {
    it(`refuses ${name}, in a tail the subject is not on`, () => {
      const a = machine();
      const b = machine();
      a.note(D1, T(1));
      b.note(D1, T(2));
      a.note(D1, T(3));
      // Beside the subject's tails, a third whose line is about someone else.
      const c = machine();
      c.note('someone-else', T(4));
      const dir = tailDir({ root }, c.tail);
      const file = join(dir, readdirSync(dir).find((n) => n.endsWith('.jsonl')) as string);
      appendFileSync(file, `${line}\n`);

      expect(() => subjectEvents({ root }, upcasters, [D1])).toThrow(UnreadableLineError);
    });
  }
});
