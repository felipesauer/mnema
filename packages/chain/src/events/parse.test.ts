import { describe, expect, it } from 'vitest';
import { runEnded, runStarted, taskCreated, taskTransitioned } from './build.js';
import { canonicalStringify } from './canonical.js';
import type { CatalogEvent } from './catalog.js';
import { EventParseError, parseEvent, toCanonical } from './parse.js';
import { UpcasterRegistry } from './upcaster.js';

const reg = new UpcasterRegistry();

const envelope = {
  at: '2026-07-21T00:00:00.000Z',
  who: 'felipe',
  subject: 's-1',
};

function line(event: CatalogEvent): string {
  return canonicalStringify(toCanonical(event));
}

describe('parseEvent — happy path across the catalog', () => {
  it('parses run.started', () => {
    const event = runStarted({ ...envelope, subject: 'r-1' }, { agent: 'claude', goal: 'ship' });
    expect(parseEvent(line(event), reg)).toEqual(event);
  });

  it('parses run.ended (empty payload)', () => {
    const event = runEnded({ ...envelope, subject: 'r-1' });
    expect(parseEvent(line(event), reg)).toEqual(event);
  });

  it('parses task.created', () => {
    const event = taskCreated({ ...envelope, subject: 't-1' }, { title: 'do the thing' });
    expect(parseEvent(line(event), reg)).toEqual(event);
  });

  it('parses task.transitioned with literal-string states', () => {
    const event = taskTransitioned(
      { ...envelope, subject: 't-1', which: 'claude', run: 'r-1' },
      { from: 'ready', to: 'in-progress', action: 'start' },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    if (parsed.kind === 'task.transitioned') {
      expect(parsed.payload.from).toBe('ready');
    }
  });
});

describe('parseEvent — round-trip is byte-stable', () => {
  it('re-canonicalizes a parsed event to identical bytes', () => {
    const event = taskTransitioned(
      { ...envelope, subject: 't-1' },
      { from: 'a', to: 'b', action: 'go' },
    );
    const once = line(event);
    const twice = canonicalStringify(toCanonical(parseEvent(once, reg)));
    expect(twice).toBe(once);
  });
});

describe('parseEvent — rejects malformed input', () => {
  it('rejects non-JSON', () => {
    expect(() => parseEvent('{not json', reg)).toThrow(EventParseError);
  });

  it('rejects a JSON array', () => {
    expect(() => parseEvent('[]', reg)).toThrow(/must be a JSON object/);
  });

  it('rejects a missing kind', () => {
    expect(() => parseEvent('{"v":1}', reg)).toThrow(/missing a string "kind"/);
  });

  it('rejects a non-integer or sub-1 version', () => {
    expect(() => parseEvent('{"kind":"run.ended","v":0}', reg)).toThrow(/invalid version/);
    expect(() => parseEvent('{"kind":"run.ended","v":1.5}', reg)).toThrow(/invalid version/);
  });

  it('rejects a known kind with a broken payload', () => {
    const bad = '{"kind":"task.created","v":1,"at":"t","who":"h","subject":"s","payload":{}}';
    expect(() => parseEvent(bad, reg)).toThrow(/payload\.title/);
  });

  it('rejects a missing envelope field', () => {
    const bad = '{"kind":"run.ended","v":1,"who":"h","subject":"s","payload":{}}';
    expect(() => parseEvent(bad, reg)).toThrow(/at/);
  });

  it('rejects an empty-string required field', () => {
    const bad =
      '{"kind":"task.created","v":1,"at":"t","who":"","subject":"s","payload":{"title":"x"}}';
    expect(() => parseEvent(bad, reg)).toThrow(/who/);
  });

  it('rejects an unknown kind (not in the catalog)', () => {
    expect(() => parseEvent('{"kind":"task.deleted","v":1}', reg)).toThrow(/unknown event kind/);
  });
});

describe('parseEvent — closed shape (no field smuggling)', () => {
  it('rejects an unknown top-level field (a forger cannot ride extra data along)', () => {
    const forged =
      '{"kind":"run.ended","v":1,"at":"t","who":"h","subject":"s","payload":{},"evil":"x"}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown event field "evil"/);
  });

  it('rejects an unknown payload field', () => {
    const forged =
      '{"kind":"task.created","v":1,"at":"t","who":"h","subject":"s","payload":{"title":"x","extra":"y"}}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload field "extra"/);
  });

  it('rejects a non-object payload (array, scalar) rather than reading fields off it', () => {
    for (const pl of ['"nope"', '42', 'true', '[]']) {
      const forged = `{"kind":"run.ended","v":1,"at":"t","who":"h","subject":"s","payload":${pl}}`;
      expect(() => parseEvent(forged, reg)).toThrow(/object payload/);
    }
  });

  it('rejects a missing or null payload as an EventParseError, never a raw TypeError', () => {
    // A caller verifying a chain catches EventParseError to mark a line bad; a
    // leaked TypeError would bypass that handler and crash the verifier.
    for (const line of [
      '{"kind":"task.created","v":1,"at":"t","who":"h","subject":"s"}',
      '{"kind":"task.created","v":1,"at":"t","who":"h","subject":"s","payload":null}',
    ]) {
      expect(() => parseEvent(line, reg)).toThrow(EventParseError);
    }
  });

  it('rejects a __proto__ key (an unknown field, not prototype pollution)', () => {
    const forged =
      '{"kind":"task.created","v":1,"at":"t","who":"h","subject":"s","payload":{"title":"x"},"__proto__":{"x":1}}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown event field/);
  });

  it('returns a REBUILT event, so a duplicate key cannot silently pick a value into the bytes', () => {
    // JSON.parse keeps the last of a duplicated key; the rebuilt event's bytes
    // reflect only the declared shape, so the recomputed canonical form differs
    // from the raw (duplicate-bearing) line — which the chain rejects rather
    // than verifies. Here we assert the rebuild is total: the returned object
    // has exactly the declared keys, whatever the raw line's structure was.
    const dup =
      '{"kind":"run.ended","v":1,"at":"t","who":"h","subject":"s","payload":{},"who":"IMPOSTER"}';
    const parsed = parseEvent(dup, reg);
    expect(Object.keys(parsed).sort()).toEqual(['at', 'kind', 'payload', 'subject', 'v', 'who']);
    // The rebuilt value is a fresh object, never the raw parsed reference.
    expect(canonicalStringify(toCanonical(parsed))).toBe(
      '{"at":"t","kind":"run.ended","payload":{},"subject":"s","v":1,"who":"IMPOSTER"}',
    );
  });

  it('drops absent optionals from the rebuilt event (bytes stay minimal + signable)', () => {
    const event = runStarted({ ...envelope, subject: 'r-1' }, { agent: 'a' });
    const parsed = parseEvent(line(event), reg);
    expect(Object.keys(parsed)).not.toContain('which');
    expect(Object.keys(parsed)).not.toContain('run');
    expect(Object.keys(parsed.payload)).not.toContain('goal');
  });
});
