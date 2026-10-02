import { describe, expect, it } from 'vitest';
import type { CatalogEvent } from './events.js';
import { exposure, type ScopedEvents, workspaceExposure } from './exposure.js';

const SECRET = 'AKIAIOSFODNN7EXAMPLE';

/** A cataloged event with the given kind and payload, envelope filled in. */
function event(kind: string, subject: string, at: string, payload: unknown): CatalogEvent {
  return {
    v: 1,
    kind,
    at,
    who: 'mnid:8f14e45fceea167a5a36dedd4bea2543',
    signerFp: 'a'.repeat(64),
    subject,
    payload,
  } as unknown as CatalogEvent;
}

function source(scope: ScopedEvents['scope'], events: readonly CatalogEvent[]): ScopedEvents {
  return { scope, events };
}

describe('exposure — what it finds', () => {
  it('names the record, the tree, the instant and the CLASS', () => {
    const report = exposure([
      source('public', [
        event('memory.captured', 'm-1', '2026-07-01T00:00:00.000Z', { content: `use ${SECRET}` }),
      ]),
    ]);

    expect(report.scanned).toBe(1);
    expect(report.findings).toEqual([
      {
        id: 'm-1',
        kind: 'memory.captured',
        scope: 'public',
        at: '2026-07-01T00:00:00.000Z',
        classes: ['aws-access-key'],
      },
    ]);
  });

  it('reaches the ENVELOPE, where the executing agent lives', () => {
    // The hole this closes, and the worst kind there is: with a payload-only sweep
    // this record answered "nothing recognizable" while the credential sat on disk
    // in `which`. Not a record written unprotected — the AUDIT declaring it clean,
    // which ends the investigation. `which` is one of the two envelope fields a
    // caller supplies, and it is stamped on every event of a session, so one value
    // is many records.
    const report = exposure([
      source('public', [
        {
          ...event('memory.captured', 'm-1', '2026-07-01T12:00:00.000Z', { content: 'clean' }),
          which: `agent-${SECRET}`,
        } as unknown as CatalogEvent,
      ]),
    ]);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.classes).toEqual(['aws-access-key']);
  });

  it('reaches a proof field NESTED inside a transition payload', () => {
    // No projection exposes a transition's `fields` whole, so a per-kind reader
    // would miss exactly the notes and reasons a person types fastest. The generic
    // walk is what reaches them.
    const report = exposure([
      source('public', [
        event('task.transitioned', 't-1', '2026-07-02T00:00:00.000Z', {
          from: 'DRAFT',
          to: 'CANCELED',
          action: 'cancel',
          fields: { reason: `dropping ${SECRET}` },
        }),
      ]),
    ]);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.classes).toEqual(['aws-access-key']);
  });

  it('reaches a value inside a LIST of links', () => {
    const report = exposure([
      source('private', [
        event('task.transitioned', 't-2', '2026-07-03T00:00:00.000Z', {
          from: 'DRAFT',
          to: 'READY',
          action: 'submit',
          fields: { links: ['https://ok.example', 'postgres://u:s3cretpass@h/d'] },
        }),
      ]),
    ]);

    expect(report.findings[0]?.classes).toEqual(['url-password']);
  });

  it('reports every DISTINCT class of one record once, sorted', () => {
    const report = exposure([
      source('public', [
        event('decision.recorded', 'd-1', '2026-07-04T00:00:00.000Z', {
          title: `use ${SECRET} and ${SECRET}`,
          rationale: 'because postgres://u:s3cretpass@h/d',
          adr: 'ADR-1',
        }),
      ]),
    ]);

    expect(report.findings[0]?.classes).toEqual(['aws-access-key', 'url-password']);
  });

  it('carries the tree each finding came from, because the tree is the situation', () => {
    // The same value in `public` is committed and on every machine that cloned the
    // repository; in `global` it is on one disk. Merging the trees is exactly what
    // would lose that difference.
    const report = exposure([
      source('public', [
        event('memory.captured', 'm-1', '2026-07-05T00:00:00.000Z', { content: SECRET }),
      ]),
      source('global', [
        event('memory.captured', 'm-2', '2026-07-06T00:00:00.000Z', { content: SECRET }),
      ]),
    ]);

    expect(report.findings.map((f) => f.scope)).toEqual(['public', 'global']);
  });

  it('answers oldest first — the oldest exposure has had longest to travel', () => {
    const report = exposure([
      source('public', [
        event('memory.captured', 'later', '2026-07-09T00:00:00.000Z', { content: SECRET }),
        event('memory.captured', 'earlier', '2026-07-07T00:00:00.000Z', { content: SECRET }),
      ]),
    ]);

    expect(report.findings.map((f) => f.id)).toEqual(['earlier', 'later']);
  });
});

describe('exposure — never the value', () => {
  it('has no field anywhere that carries the value, in the object OR its JSON', () => {
    // The structural guarantee: a report that listed credentials would turn the
    // remedy into a second disclosure (a CI log, a scrollback, a screenshot). The
    // detector behind this returns classes only, so there is nothing to print even
    // by accident — asserted over the serialized form, which is what `--json` and
    // an MCP reply emit.
    const password = 'Tr0ub4dor3';
    const report = exposure([
      source('public', [
        event('memory.captured', 'm-1', '2026-07-10T00:00:00.000Z', {
          content: `${SECRET} and postgres://u:${password}@h/d`,
        }),
      ]),
    ]);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain(password);
    // Not even partly: no prefix of the value survives as a "masked" hint.
    expect(serialized).not.toContain('AKIA');
    expect(serialized).not.toContain('Tr0ub');
  });
});

describe('exposure — what it does NOT claim', () => {
  it('finds nothing in a clean record, and says how much it read', () => {
    const report = exposure([
      source('public', [
        event('memory.captured', 'm-1', '2026-07-11T00:00:00.000Z', { content: 'a clean note' }),
        event('task.created', 't-1', '2026-07-11T00:00:01.000Z', { title: 'a clean task' }),
      ]),
    ]);

    expect(report.findings).toEqual([]);
    // The denominator matters: "0 findings" alone could mean it read nothing.
    expect(report.scanned).toBe(2);
  });

  it('finds nothing in the DERIVED envelope fields, which is what makes scanning them safe', () => {
    // The anchor, the fingerprint, the v7 id and the instant are on every event, so
    // a rule that read them as text would flag the record's own identity forever.
    // A known-prefix rule reads none of them — which is exactly why the envelope can
    // be swept whole, and why an entropy rule could never be (it flagged 13,094 of
    // these over a real archive).
    const report = exposure([
      source('public', [
        event(
          'memory.captured',
          '019fa8b7-0410-717b-9af2-cfeb013fc4ac',
          '2026-07-12T00:00:00.000Z',
          {
            content: 'clean',
          },
        ),
      ]),
    ]);

    expect(report.findings).toEqual([]);
  });

  it('misses what the detector misses — an empty report is not a clean bill', () => {
    const report = exposure([
      source('public', [
        event('memory.captured', 'm-1', '2026-07-13T00:00:00.000Z', {
          content: 'the staging password is hunter2',
        }),
      ]),
    ]);

    // A password in prose has no format, so nothing recognizes it. The read cannot
    // claim more than that, and the surfaces say so where a person reads them.
    expect(report.findings).toEqual([]);
  });

  it('reads an empty set of trees without complaint', () => {
    expect(exposure([])).toEqual({ findings: [], scanned: 0 });
  });
});

describe('exposure — one report, or one per record', () => {
  /** A source of one tree of one project (or of the projectless global tree). */
  function owned(
    scope: ScopedEvents['scope'],
    project: string | undefined,
    events: readonly CatalogEvent[],
  ): ScopedEvents {
    return { scope, ...(project !== undefined ? { project } : {}), events };
  }

  const held = (subject: string, at: string): CatalogEvent =>
    event('memory.captured', subject, at, { content: `use ${SECRET}` });

  it('merges the findings and decomposes the denominator, which is the whole split', () => {
    const report = workspaceExposure([
      owned('public', '/w/alpha', [held('a-1', '2026-07-01T00:00:00.000Z')]),
      owned('private', '/w/alpha', [event('task.created', 't-1', '2026-07-01T01:00:00.000Z', {})]),
      owned('public', '/w/beta', [held('b-1', '2026-07-02T00:00:00.000Z')]),
      owned('global', undefined, [held('g-1', '2026-07-03T00:00:00.000Z')]),
    ]);

    // ITEMS merge: one list, oldest first, each saying where to rotate.
    expect(report.findings.map((f) => [f.id, f.project])).toEqual([
      ['a-1', '/w/alpha'],
      ['b-1', '/w/beta'],
      ['g-1', undefined],
    ]);
    // The AGGREGATE decomposes: one count per record, the projectless one last, and no
    // total beside them — a workspace figure under this name is what a reader divides by.
    expect(report.scanned).toEqual([
      { project: '/w/alpha', scanned: 2 },
      { project: '/w/beta', scanned: 1 },
      { scanned: 1 },
    ]);
    expect('total' in report).toBe(false);
  });

  it('lists a record that held nothing at zero rather than leaving it out', () => {
    // An entry missing from the decomposition is indistinguishable from a record the
    // read never opened, and this read exists to be trusted about where it looked.
    const report = workspaceExposure([
      owned('public', '/w/alpha', [held('a-1', '2026-07-01T00:00:00.000Z')]),
      owned('public', '/w/silent', []),
    ]);

    expect(report.scanned).toEqual([
      { project: '/w/alpha', scanned: 1 },
      { project: '/w/silent', scanned: 0 },
    ]);
  });

  it('answers the same whatever order the sources are handed in', () => {
    // The ordering has to be TOTAL, not merely stable, and the tie is real: the `id` of
    // a finding is the event's SUBJECT, so one entity written in two trees in the same
    // instant ties on both keys. Left to a stable sort, the answer would then follow the
    // order the trees happened to be read in — and this text goes into the prefix of an
    // agent's prompt, where a list that reshuffles reads as a record that changed.
    const sources = [
      owned('public', '/w/alpha', [held('same', '2026-07-01T00:00:00.000Z')]),
      owned('private', '/w/alpha', [held('same', '2026-07-01T00:00:00.000Z')]),
      owned('global', undefined, [held('same', '2026-07-01T00:00:00.000Z')]),
    ];

    const forward = workspaceExposure(sources);
    const backward = workspaceExposure([...sources].reverse());

    expect(forward.findings).toEqual(backward.findings);
    expect(forward.findings.map((f) => f.scope)).toEqual(['global', 'private', 'public']);
  });

  it('gives the one-record report and its entry the same count, from one fold', () => {
    // Both reads call the same fold, so a single report and one entry of a decomposition
    // cannot come to disagree about what was read.
    const trees = [
      owned('public', '/w/alpha', [held('a-1', '2026-07-01T00:00:00.000Z')]),
      owned('private', '/w/alpha', [held('a-2', '2026-07-02T00:00:00.000Z')]),
    ];

    const one = exposure(trees);
    const many = workspaceExposure(trees);

    expect(one.scanned).toBe(2);
    expect(many.scanned).toEqual([{ project: '/w/alpha', scanned: 2 }]);
    expect(one.findings).toEqual(many.findings);
  });

  it('reads an empty workspace without complaint', () => {
    expect(workspaceExposure([])).toEqual({ findings: [], scanned: [] });
  });
});
