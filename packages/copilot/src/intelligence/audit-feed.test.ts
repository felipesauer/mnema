import { describe, expect, it } from 'vitest';
import {
  AUDIT_BY_KIND,
  auditEvent,
  auditFeed,
  OCSF_CATEGORY_UID,
  OCSF_CLASS_UID,
  OCSF_SCHEMA_VERSION,
} from './audit-feed.js';
import type { CatalogEvent, EventKind } from './events.js';
import type { ScopedEvents } from './exposure.js';

/**
 * The marker every fixture payload is poisoned with.
 *
 * A fixed, recognizable string rather than anything random: what is being asserted is
 * ABSENCE, and an absence assertion is worth exactly what its non-vacuity check is worth,
 * so the marker has to be something the test can also prove it PUT somewhere.
 */
const BODY = 'BODY-MARKER-MUST-NEVER-LEAVE-THE-MACHINE';

const PRODUCER = { product: 'mnema', vendor: 'mnema', version: '9.9.9' };

/** Every kind the catalog holds, read off the map that must be total over them. */
const EVERY_KIND = Object.keys(AUDIT_BY_KIND) as readonly EventKind[];

/**
 * An event of `kind` whose payload is nothing but the marker, in several shapes.
 *
 * The payload is deliberately NOT the kind's real payload: this fixture exists to be
 * leaked, and a shape that covers a string, a nested string, a list and a boolean is what
 * makes "the mapping copied something" visible however it copied it.
 */
function poisoned(kind: EventKind, n: number): CatalogEvent {
  return {
    v: 1,
    kind,
    at: `2026-08-0${(n % 9) + 1}T12:00:00.000Z`,
    who: 'mnid:8f14e45fceea167a5a36dedd4bea2543',
    signerFp: 'a'.repeat(64),
    which: 'agent-alpha',
    run: '019fa572-32c2-7780-b1a7-0fe895a1c7ef',
    subject: `subject-${n}`,
    payload: {
      content: BODY,
      nested: { reason: BODY },
      list: [BODY],
      flag: true,
    },
  } as unknown as CatalogEvent;
}

/** Every dotted key path present in a value, leaves included. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  const paths: string[] = [];
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    paths.push(...keyPaths(inner, prefix === '' ? key : `${prefix}.${key}`));
  }
  return paths;
}

/**
 * EVERY key an audit line may carry — the allowlist the structural guard reconciles
 * against, both ways.
 *
 * It is a closed list and not a prefix rule, because the failure this catches is a field
 * ARRIVING: a mapping that grew a `entity.data` or an `unmapped` would carry a body under
 * a name no marker sweep of one fixture is guaranteed to reach. Reconciled in both
 * directions, so a field that goes away has to be deleted here rather than passing as a
 * subset.
 */
const ALLOWED_PATHS: readonly string[] = [
  'activity_id',
  'activity_name',
  'category_uid',
  'class_uid',
  'type_uid',
  'severity_id',
  'status_id',
  'time',
  'metadata.version',
  'metadata.product.name',
  'metadata.product.vendor_name',
  'metadata.product.version',
  'metadata.event_code',
  'metadata.log_version',
  'metadata.log_name',
  'metadata.original_time',
  'metadata.correlation_uid',
  'entity.uid',
  'entity.type',
  'entity.type_id',
  'actor.user.uid',
  'actor.user.credential_uid',
  'actor.app_name',
];

describe('the audit feed carries the envelope', () => {
  it('maps EVERY kind of the catalog — the map is total, and nothing lands Unknown', () => {
    // The map's type already forces a row per kind; what this adds is that no row was
    // filled in with the schema's "we did not look" value. `0` (Unknown) is the answer a
    // half-done mapping produces, and it is exactly the one a SIEM cannot act on.
    expect(EVERY_KIND).toHaveLength(20);
    for (const kind of EVERY_KIND) {
      expect(AUDIT_BY_KIND[kind].activity.id).not.toBe(0);
      expect(AUDIT_BY_KIND[kind].entityType).not.toBe('');
    }
  });

  it('takes 99 Other for exactly the one kind that has no honest activity', () => {
    // The count the delivery owes an answer to, asserted rather than described. A second
    // kind arriving here is not a failure of this test — it is the signal that the class
    // stopped fitting, and it has to be argued in the map before this line moves.
    const other = EVERY_KIND.filter((kind) => AUDIT_BY_KIND[kind].activity.id === 99);
    expect(other).toEqual(['channel.asked']);
  });

  it('writes activity_name as the schema requires: the caption, or the kind at 99', () => {
    for (const kind of EVERY_KIND) {
      const line = auditEvent(poisoned(kind, 0), 'public', PRODUCER);
      if (line.activity_id === 99) {
        // At 99 the schema requires the SOURCE's label, which is the only place the exact
        // kind could otherwise be lost.
        expect(line.activity_name).toBe(kind);
      } else {
        expect(line.activity_name).toBe(AUDIT_BY_KIND[kind].activity.caption);
      }
      expect(line.type_uid).toBe(OCSF_CLASS_UID * 100 + line.activity_id);
      expect(line.class_uid).toBe(OCSF_CLASS_UID);
      expect(line.category_uid).toBe(OCSF_CATEGORY_UID);
      expect(line.metadata.version).toBe(OCSF_SCHEMA_VERSION);
      // The kind survives normalization verbatim, on every line and not only at 99.
      expect(line.metadata.event_code).toBe(kind);
    }
  });

  it('NEVER carries a body — no payload of any kind reaches a line, for any kind', () => {
    // THE GUARD THIS MODULE EXISTS FOR. Every kind, with a payload that is nothing but the
    // marker in four shapes, serialized exactly as the verb serializes it.
    const lines = EVERY_KIND.map((kind, n) =>
      JSON.stringify(auditEvent(poisoned(kind, n), 'public', PRODUCER)),
    );
    for (const [index, line] of lines.entries()) {
      expect(line).not.toContain(BODY);
      // Named, so a failure says WHICH kind leaked rather than only that one did.
      expect({ kind: EVERY_KIND[index], leaked: line.includes(BODY) }).toEqual({
        kind: EVERY_KIND[index],
        leaked: false,
      });
    }

    // NON-VACUITY, and it is the half that makes the assertion above worth anything: the
    // marker really is in the events that were mapped. Without this, a fixture whose
    // payload was silently empty would pass every line above.
    const fixtures = JSON.stringify(EVERY_KIND.map((kind, n) => poisoned(kind, n)));
    expect(fixtures).toContain(BODY);
    expect(fixtures.split(BODY).length - 1).toBe(EVERY_KIND.length * 3);
  });

  it('carries these keys and no others — so a field that ARRIVES is caught', () => {
    // The structural half. The sweep above catches a payload copied under any name; this
    // catches a field added that a marker sweep of one fixture might not reach — an
    // `unmapped`, an `entity.data`, a `raw_data`.
    const seen = new Set<string>();
    for (const kind of EVERY_KIND) {
      for (const path of keyPaths(auditEvent(poisoned(kind, 0), 'public', PRODUCER))) {
        seen.add(path);
      }
    }
    expect([...seen].sort()).toEqual([...ALLOWED_PATHS].sort());
  });

  it('leaves out what the envelope leaves out, rather than writing an empty value', () => {
    // A fact a person recorded directly carries no agent and belongs to no run. Writing
    // `app_name: ""` or a null correlation would say an agent acted and could not be
    // named, which is a different claim from "nobody but the person acted".
    const bare = {
      v: 1,
      kind: 'memory.captured',
      at: '2026-08-01T00:00:00.000Z',
      who: 'mnid:8f14e45fceea167a5a36dedd4bea2543',
      signerFp: 'b'.repeat(64),
      subject: 'm-1',
      payload: { content: BODY },
    } as unknown as CatalogEvent;
    const line = auditEvent(bare, 'global', PRODUCER);
    expect('app_name' in line.actor).toBe(false);
    expect('correlation_uid' in line.metadata).toBe(false);
    expect(line.metadata.log_name).toBe('global');
  });

  it('says which TREE each fact lives in, and keeps the trees apart', () => {
    // The distinction a merge would lose: committed and cloned to every machine, versus
    // on one disk. Two identical facts in two trees are two lines that differ by this.
    const feed = auditFeed(
      [
        { scope: 'public', events: [poisoned('task.created', 1)] },
        { scope: 'private', events: [poisoned('task.created', 1)] },
      ] satisfies ScopedEvents[],
      PRODUCER,
    );
    expect(feed.map((line) => line.metadata.log_name)).toEqual(['public', 'private']);
  });

  it('normalizes the instant and keeps the original beside it', () => {
    const line = auditEvent(poisoned('task.created', 0), 'public', PRODUCER);
    expect(line.metadata.original_time).toBe('2026-08-01T12:00:00.000Z');
    expect(line.time).toBe(Date.parse('2026-08-01T12:00:00.000Z'));
  });

  it('narrows by the same window accountability narrows by', () => {
    const events = [
      poisoned('task.created', 0),
      { ...poisoned('task.created', 1), who: 'mnid:other' } as CatalogEvent,
    ];
    const source: ScopedEvents[] = [{ scope: 'public', events }];
    expect(auditFeed(source, PRODUCER)).toHaveLength(2);
    expect(auditFeed(source, PRODUCER, { who: 'mnid:other' })).toHaveLength(1);
    expect(auditFeed(source, PRODUCER, { from: '2026-08-02T00:00:00.000Z' })).toHaveLength(1);
    expect(auditFeed(source, PRODUCER, { which: 'nobody' })).toHaveLength(0);
  });
});
