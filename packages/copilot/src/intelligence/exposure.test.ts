import { describe, expect, it } from 'vitest';
import type { CatalogEvent } from './events.js';
import { exposure, type ScopedEvents } from './exposure.js';

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

  it('does NOT scan the envelope — anchors, fingerprints and ids are not typed text', () => {
    // An over-eager rule reading the envelope would flag the record's own identity
    // on every single event, which is the failure the whole design avoids.
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
