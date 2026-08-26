/**
 * THE PUBLISHED DECLARATIONS AND THE READER ARE ONE THING — the guard this
 * delivery exists for.
 *
 * `FORMAT.md` section 4 has always promised that a reader rebuilds an event from
 * the fields its kind declares and rejects any other. Until `event-schema.json`
 * existed, those declarations were published nowhere, and the measured
 * consequence was that an independent verifier — faithful to the document —
 * accepted an event appended above the last checkpoint carrying a field no kind
 * declares, which the product refuses. A party with **no key** can walk through
 * that door: the entry hash takes no key, so whoever can write the repository
 * computes it, and above the last checkpoint no signature covers it.
 *
 * THE HARD PART IS NOT PUBLISHING THEM. It is that a published schema beside a
 * hand-written reader is TWO places the fields live, and two places drift — in
 * silence, because the day they disagree is the day a second reader quietly goes
 * back to accepting what this one refuses, with nothing red anywhere. So the
 * declarations are not a description of `parse.ts`: they ARE `parse.ts`'s table
 * (`schema.ts`), and this file holds the two ends of that claim:
 *
 *   - the FILE is the table, byte for byte. A table edited without the file, or a
 *     file edited without the table, is red.
 *   - the READER obeys the file, field by field, over every published vector. A
 *     rule the file declares and the reader does not apply is red, and so is a
 *     field the reader requires and the file calls optional.
 *
 * The second is what makes the first worth having. Byte equality alone would be
 * satisfied by a table nothing reads; the case-by-case agreement is the one that
 * fails when the meaning drifts rather than the spelling.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { type CatalogEvent, type EventKind, LATEST_VERSION } from './catalog.js';
import { parseEvent, unreadableReason } from './parse.js';
import { catalogUpcasters } from './registry.js';
import {
  type FieldRule,
  type PublishedSchema,
  publishedSchemaText,
  SCHEMA_FILE,
} from './schema.js';
import { canonicalVectors } from './vectors.js';

const RAW = readFileSync(SCHEMA_FILE, 'utf-8');
const artifact = JSON.parse(RAW) as PublishedSchema;
const reg = catalogUpcasters();

/** The rules under which a field MUST be present. Every other rule tolerates absence. */
const REQUIRED_RULES: readonly FieldRule[] = ['string', 'string|null', 'boolean', 'count'];

/** One contract, looked up the way a stranger looks it up: by the `(kind, v)` pair. */
function contractFor(kind: string, v: number) {
  return artifact.contracts.find((row) => row.kind === kind && row.v === v);
}

/** An event with one payload field removed — what a stranger tests a declaration with. */
function withoutPayloadField(event: CatalogEvent, field: string): CatalogEvent {
  const payload = { ...(event.payload as Record<string, unknown>) };
  delete payload[field];
  return { ...event, payload } as unknown as CatalogEvent;
}

describe('the published file is the reader’s table, byte for byte', () => {
  it('holds exactly what the table serializes', () => {
    // THE ANTI-DRIFT GUARD. The file is committed data, and the table in `schema.ts`
    // is what the reader walks; this is the only thing standing between them. It is
    // deliberately a byte comparison and not a structural one: a comparison that
    // normalized formatting would let the artifact a stranger downloads differ from
    // the artifact this repository believes it published.
    expect(
      RAW,
      'event-schema.json is stale: it is the serialization of PAYLOAD_SCHEMA, ENVELOPE_SCHEMA ' +
        'and TRANSITION_FIELDS_SCHEMA in schema.ts, and one of the two was edited alone',
    ).toBe(publishedSchemaText(LATEST_VERSION));
  });

  it('declares a contract for every kind the catalog has, at the version it is at', () => {
    // Totality is held by the compiler in `schema.ts` (a kind with no row does not
    // build). This says the same thing about the FILE, which the compiler cannot see.
    const kinds = Object.keys(LATEST_VERSION) as EventKind[];
    expect(kinds.length).toBeGreaterThanOrEqual(20);
    for (const kind of kinds) {
      const contract = contractFor(kind, LATEST_VERSION[kind]);
      expect(contract, `no published contract for ${kind}`).toBeDefined();
    }
    expect(artifact.contracts).toHaveLength(kinds.length);
  });

  it('spells every rule it uses in the glossary it carries', () => {
    // The artifact is read by somebody who has only the artifact and the document, so
    // a rule name it uses and does not define is a rule they have to guess at — which
    // is precisely the failure this whole delivery is about.
    const used = new Set<string>([
      ...Object.values(artifact.envelope),
      ...Object.values(artifact.transitionFields),
      ...artifact.contracts.flatMap((row) => Object.values(row.payload)),
    ]);
    expect(used.size).toBeGreaterThan(4);
    for (const rule of used) expect(Object.keys(artifact.rules)).toContain(rule);
  });
});

/**
 * THE AGREEMENT, CASE BY CASE — and the reason this is not a snapshot test.
 *
 * Each published vector is a real event of its kind. For every field the FILE
 * declares, the reader is asked the question the declaration answers: is it
 * required? So a declaration that said `string?` where the reader demands a value
 * fails here, and so does the reverse — the two directions are separate cases
 * because only one of them is caught by a record verifying green.
 */
describe('the reader obeys the published declarations, field by field', () => {
  const vectors = canonicalVectors();

  it('has vectors to run this over, or every case below is vacuous', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(20);
  });

  it.each(vectors.map((vector) => [vector.name, vector] as const))(
    '%s carries only fields its contract declares, and needs the ones it calls required',
    (_name, vector) => {
      const event = vector.event;
      const contract = contractFor(event.kind, event.v);
      expect(contract, `no contract for ${event.kind}@${event.v}`).toBeDefined();
      const declared = contract?.payload ?? {};
      const present = Object.keys(event.payload as Record<string, unknown>);

      // Nothing the vector carries is undeclared: the file covers a real event.
      for (const field of present) expect(Object.keys(declared)).toContain(field);

      for (const [field, rule] of Object.entries(declared)) {
        const required = REQUIRED_RULES.includes(rule);
        if (required) {
          expect(present, `${event.kind} declares ${field} as ${rule}`).toContain(field);
          expect(
            unreadableReason(withoutPayloadField(event, field)),
            `the file declares ${event.kind}.${field} as ${rule}, and the reader read it without`,
          ).toContain(`payload.${field}`);
        } else if (present.includes(field)) {
          expect(
            unreadableReason(withoutPayloadField(event, field)),
            `the file declares ${event.kind}.${field} as ${rule}, and the reader demanded it`,
          ).toBeUndefined();
        }
      }
    },
  );

  it.each(vectors.map((vector) => [vector.name, vector] as const))(
    '%s is refused when a field its contract does not declare rides along',
    (_name, vector) => {
      // The door the delivery closes, asked of every kind rather than of one: a payload
      // key no contract declares is refused, which is what a second reader holding this
      // file can now do and could not before.
      const forged = {
        ...vector.event,
        payload: { ...(vector.event.payload as object), notInAnyContract: 'rides along' },
      };
      expect(unreadableReason(forged as unknown as CatalogEvent)).toContain('notInAnyContract');
    },
  );
});

describe('the envelope the file declares is the envelope the reader takes', () => {
  it('accepts the two optional envelope fields the file calls optional', () => {
    // NON-VACUITY WITH A HISTORY. `which` and `run` were declared NOWHERE, and
    // `FORMAT.md` section 7 said an event has "seven top-level keys" — a sentence
    // taken from the INTERSECTION of the published vectors rather than from any
    // declaration. Sixteen of the twenty-three vectors carry `which`, three carry
    // `run`, and an independent verifier built on that sentence refused an honest
    // event for carrying one. Measured, before this delivery: the second reader
    // answered REFUSED on a record the product read as fine.
    const withWhich = canonicalVectors().find((v) => 'which' in v.event);
    expect(withWhich, 'no vector carries `which`, so this case checks nothing').toBeDefined();
    expect(artifact.envelope.which).toBe('string?');
    expect(artifact.envelope.run).toBe('string?');
    expect(unreadableReason(withWhich?.event as CatalogEvent)).toBeUndefined();
  });

  it('refuses a top-level field the envelope does not declare', () => {
    const forged = JSON.stringify({ ...canonicalVectors()[0]?.event, notDeclared: 'x' });
    expect(() => parseEvent(forged, reg)).toThrow(/unknown event field "notDeclared"/);
  });

  it('requires every envelope field the file does not mark optional', () => {
    const event = canonicalVectors()[0]?.event as CatalogEvent;
    for (const [field, rule] of Object.entries(artifact.envelope)) {
      if (rule.endsWith('?')) continue;
      const stripped = { ...(event as unknown as Record<string, unknown>) };
      delete stripped[field];
      expect(
        unreadableReason(stripped as unknown as CatalogEvent),
        `the file declares the envelope's ${field} as ${rule}, and the reader read it without`,
      ).toBeDefined();
    }
  });
});
