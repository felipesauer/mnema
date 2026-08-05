import { describe, expect, it } from 'vitest';
import {
  decisionRecorded,
  decisionTransitioned,
  handoffRecorded,
  identityFounded,
  keyEnrolled,
  keyRevoked,
  knowledgeLinked,
  memoryCaptured,
  observationRecorded,
  runEnded,
  runStarted,
  skillConsulted,
  skillCreated,
  skillTransitioned,
  taskCreated,
  taskTransitioned,
} from './build.js';
import { canonicalStringify } from './canonical.js';
import type { CatalogEvent } from './catalog.js';
import { EventParseError, parseEvent, toCanonical, unreadableReason } from './parse.js';
import { UpcasterRegistry } from './upcaster.js';

const reg = new UpcasterRegistry();

const envelope = {
  at: '2026-07-21T00:00:00.000Z',
  who: 'mnid:aa',
  signerFp: 'fp-1',
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

  it('parses the birth transition (from: null) and preserves the null', () => {
    const event = taskTransitioned(
      { ...envelope, subject: 't-1' },
      { from: null, to: 'draft', action: 'create' },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    if (parsed.kind === 'task.transitioned') {
      expect(parsed.payload.from).toBeNull();
    }
  });

  it('parses memory.captured (a single point-in-time fact)', () => {
    const event = memoryCaptured(
      { ...envelope, subject: 'm-1', which: 'claude', run: 'r-1' },
      { content: 'the build breaks without a fresh dist' },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    if (parsed.kind === 'memory.captured') {
      expect(parsed.payload.content).toBe('the build breaks without a fresh dist');
    }
  });
});

describe('parseEvent — memory.captured (closed shape)', () => {
  it('rejects an unknown payload field (a forger cannot smuggle state into a fact)', () => {
    const good = memoryCaptured({ ...envelope, subject: 'm-1' }, { content: 'hi' });
    const forged = line(good).replace('"content":"hi"', '"content":"hi","state":"stale"');
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload field "state"/);
  });

  it('rejects an empty content (a memory with no content records nothing)', () => {
    const good = memoryCaptured({ ...envelope, subject: 'm-1' }, { content: 'hi' });
    const forged = line(good).replace('"content":"hi"', '"content":""');
    expect(() => parseEvent(forged, reg)).toThrow(EventParseError);
  });

  it('rebuilds so a duplicate content key cannot pick a value into the bytes', () => {
    const good = memoryCaptured({ ...envelope, subject: 'm-1' }, { content: 'real' });
    // A hand-forged line with a duplicate key: JSON.parse keeps the last, but the
    // rebuild re-canonicalizes, so the bytes differ from the stored line.
    const forged = line(good).replace('"content":"real"', '"content":"evil","content":"real"');
    const parsed = parseEvent(forged, reg);
    expect(line(parsed)).toBe(line(good));
  });
});

describe('parseEvent — the three knowledge facts (closed shapes)', () => {
  it('parses observation.recorded', () => {
    const event = observationRecorded(
      { ...envelope, subject: 'o-1' },
      { about: 't-1', topic: 'flaky', text: 'retries on CI' },
    );
    expect(parseEvent(line(event), reg)).toEqual(event);
  });

  it('rejects an unknown payload field on an observation (no smuggling)', () => {
    const good = observationRecorded(
      { ...envelope, subject: 'o-1' },
      { about: 't-1', topic: 'x', text: 'y' },
    );
    const forged = line(good).replace('"topic":"x"', '"topic":"x","state":"stale"');
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload field "state"/);
  });

  it('parses handoff.recorded, including a same-agent restart', () => {
    const event = handoffRecorded(
      { ...envelope, subject: 't-1' },
      { fromAgent: 'claude', toAgent: 'claude' },
    );
    expect(parseEvent(line(event), reg)).toEqual(event);
  });

  it('rejects a handoff missing toAgent', () => {
    const good = handoffRecorded({ ...envelope, subject: 't-1' }, { fromAgent: 'a', toAgent: 'b' });
    const forged = line(good).replace(',"toAgent":"b"', '');
    expect(() => parseEvent(forged, reg)).toThrow(EventParseError);
  });

  it('parses knowledge.linked and accepts ANY non-empty rel (open literal, not an enum)', () => {
    const known = knowledgeLinked(
      { ...envelope, subject: 'm-1' },
      { target: 't-1', rel: 'relates-to' },
    );
    expect(parseEvent(line(known), reg)).toEqual(known);
    // A label outside the recommended set is valid: the parser does not enforce a
    // closed set, the same as a transition `action`.
    const novel = knowledgeLinked(
      { ...envelope, subject: 'm-1' },
      { target: 't-1', rel: 'inspired-by' },
    );
    expect(parseEvent(line(novel), reg)).toEqual(novel);
  });

  it('rejects an empty rel (a relation with no label is not a fact)', () => {
    const good = knowledgeLinked(
      { ...envelope, subject: 'm-1' },
      { target: 't-1', rel: 'relates-to' },
    );
    const forged = line(good).replace('"rel":"relates-to"', '"rel":""');
    expect(() => parseEvent(forged, reg)).toThrow(EventParseError);
  });

  it('rejects an unknown payload field on a link (no targetKind smuggling)', () => {
    const good = knowledgeLinked(
      { ...envelope, subject: 'm-1' },
      { target: 't-1', rel: 'relates-to' },
    );
    const forged = line(good).replace(
      '"rel":"relates-to"',
      '"rel":"relates-to","targetKind":"task"',
    );
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload field "targetKind"/);
  });
});

describe('parseEvent — skill events (a workflow entity, no `by`)', () => {
  it('parses skill.created and round-trips it', () => {
    const event = skillCreated(
      { ...envelope, subject: 'sk-1' },
      { name: 'Small PRs', body: 'One slice per PR; merge before the next.' },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    expect(canonicalStringify(toCanonical(parsed))).toBe(line(event));
  });

  it('requires a non-empty name and body', () => {
    for (const p of ['"name":""', '"body":""']) {
      const forged =
        `{"kind":"skill.created","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"sk-1","payload":{"name":"n","body":"b"}}`.replace(
          p.startsWith('"name"') ? '"name":"n"' : '"body":"b"',
          p,
        );
      expect(() => parseEvent(forged, reg)).toThrow(EventParseError);
    }
  });

  it('rejects an unknown payload field on a skill.created (no smuggling)', () => {
    const good = skillCreated({ ...envelope, subject: 'sk-1' }, { name: 'n', body: 'b' });
    const forged = line(good).replace('"body":"b"', '"body":"b","adr":"ADR-1"');
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload field "adr"/);
  });

  it('parses a skill.transitioned carrying proof and round-trips it', () => {
    const event = skillTransitioned(
      { ...envelope, subject: 'sk-1', which: 'claude', run: 'r-1' },
      { from: 'proposed', to: 'reviewed', action: 'review', fields: { note: 'looks solid' } },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    expect(canonicalStringify(toCanonical(parsed))).toBe(line(event));
  });

  it('re-canonicalizes a birth transition (from: null) to identical bytes', () => {
    const event = skillTransitioned(
      { ...envelope, subject: 'sk-1' },
      { from: null, to: 'proposed', action: 'create' },
    );
    const once = line(event);
    expect(canonicalStringify(toCanonical(parseEvent(once, reg)))).toBe(once);
  });

  it('parses a skill.consulted (an empty payload is the whole shape) and round-trips it', () => {
    const event = skillConsulted({ ...envelope, subject: 'sk-1', which: 'claude', run: 'r-1' });
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    expect(canonicalStringify(toCanonical(parsed))).toBe(line(event));
  });

  it('rejects ANY payload field on a skill.consulted (the empty shape is closed)', () => {
    // A consultation is entirely envelope, so there is no key a forger may add —
    // not even one borrowed from another skill event.
    const good = skillConsulted({ ...envelope, subject: 'sk-1' });
    for (const smuggled of ['"name":"Small PRs"', '"body":"the pattern"', '"guided":true']) {
      const forged = line(good).replace('"payload":{}', `"payload":{${smuggled}}`);
      expect(() => parseEvent(forged, reg)).toThrow(/unknown payload field/);
    }
  });

  it('rejects a `by` on a skill transition (a skill is not relational)', () => {
    // `by` is a decision's field, never a skill's; the closed shape rejects it.
    const forged =
      '{"kind":"skill.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"sk-1","payload":{"from":"proposed","to":"reviewed","action":"review","by":"sk-2"}}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload field "by"/);
  });
});

describe('parseEvent — transition proof fields', () => {
  it('parses a transition carrying proof fields and round-trips it', () => {
    const event = taskTransitioned(
      { ...envelope, subject: 't-1', which: 'claude', run: 'r-1' },
      {
        from: 'in-progress',
        to: 'done',
        action: 'complete',
        fields: { note: 'shipped', pr_url: 'https://x/1', links: ['https://y'] },
      },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    const twice = canonicalStringify(toCanonical(parsed));
    expect(twice).toBe(line(event));
  });

  it('rejects an unknown key inside fields (closed shape, no smuggling)', () => {
    const forged =
      '{"kind":"task.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{"from":"a","to":"b","action":"go","fields":{"note":"n","evil":"x"}}}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload\.fields field "evil"/);
  });

  it('rejects a non-object fields (array, scalar)', () => {
    for (const f of ['"nope"', '42', '[]', 'true']) {
      const forged = `{"kind":"task.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{"from":"a","to":"b","action":"go","fields":${f}}}`;
      expect(() => parseEvent(forged, reg)).toThrow(/object at payload\.fields/);
    }
  });

  it('rejects an empty fields object (must be omitted, not spelled as {})', () => {
    const forged =
      '{"kind":"task.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{"from":"a","to":"b","action":"go","fields":{}}}';
    expect(() => parseEvent(forged, reg)).toThrow(/empty payload\.fields/);
  });

  it('rejects a non-string proof field', () => {
    const forged =
      '{"kind":"task.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{"from":"a","to":"b","action":"go","fields":{"reason":42}}}';
    expect(() => parseEvent(forged, reg)).toThrow(/payload\.fields\.reason/);
  });

  it('rejects an empty links array and a non-string link item', () => {
    const emptyArr =
      '{"kind":"task.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{"from":"a","to":"b","action":"go","fields":{"links":[]}}}';
    expect(() => parseEvent(emptyArr, reg)).toThrow(/non-empty array at payload\.fields\.links/);
    const badItem =
      '{"kind":"task.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{"from":"a","to":"b","action":"go","fields":{"links":["ok",""]}}}';
    expect(() => parseEvent(badItem, reg)).toThrow(/payload\.fields\.links\[1\]/);
  });

  it('a builder event with an empty optional field round-trips (never a write-only line)', () => {
    // The builder must not produce a line the chain can write but not read. An
    // empty pr_url is dropped at build time, so the built event parses cleanly.
    const event = taskTransitioned(
      { ...envelope, subject: 't-1' },
      { from: 'in-progress', to: 'done', action: 'complete', fields: { note: 'done', pr_url: '' } },
    );
    expect(() => parseEvent(line(event), reg)).not.toThrow();
    expect(parseEvent(line(event), reg)).toEqual(event);
  });

  it('rebuilds fields so a duplicate inner key cannot pick a value into the bytes', () => {
    // JSON.parse keeps the last duplicate; the rebuilt fields reflect only the
    // declared shape. The recomputed canonical form is deterministic regardless.
    const dup =
      '{"kind":"task.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{"from":"a","to":"b","action":"go","fields":{"note":"first","note":"second"}}}';
    const parsed = parseEvent(dup, reg);
    if (parsed.kind === 'task.transitioned') {
      expect(parsed.payload.fields).toEqual({ note: 'second' });
    }
  });
});

describe('parseEvent — decision events', () => {
  it('parses decision.recorded and round-trips it', () => {
    const event = decisionRecorded(
      { ...envelope, subject: 'd-1' },
      { title: 'Fix the workflow', rationale: 'The why is the value.', adr: 'ADR-42' },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    expect(canonicalStringify(toCanonical(parsed))).toBe(line(event));
  });

  it('parses a decision.recorded carrying alternatives and round-trips it', () => {
    const event = decisionRecorded(
      { ...envelope, subject: 'd-1' },
      {
        title: 'Fix the workflow',
        rationale: 'The why is the value.',
        adr: 'ADR-42',
        alternatives: 'A state machine per kind: three tables to keep in step.',
      },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    expect(canonicalStringify(toCanonical(parsed))).toBe(line(event));
  });

  it('reads a decision recorded before `alternatives` existed', () => {
    // The version question, settled as data. A decision written under the payload
    // as it was — title, rationale, adr and nothing else — parses unchanged and
    // canonicalizes to the SAME bytes it was signed as, which is why adding an
    // optional field is not a version bump: nothing already written moves.
    //
    // In CANONICAL form, which is the only form a writer ever stored: keys sorted,
    // envelope and payload both. A hand-ordered line would compare unequal for a
    // reason that has nothing to do with the field being tested.
    const asWritten =
      '{"at":"2026-07-21T00:00:00.000Z","kind":"decision.recorded","payload":{"adr":"ADR-1","rationale":"y","title":"x"},"signerFp":"fp","subject":"d-1","v":1,"who":"h"}';
    const parsed = parseEvent(asWritten, reg);
    expect(canonicalStringify(toCanonical(parsed))).toBe(asWritten);
    // Absent, not empty: the reader invents no key for a field the record lacks.
    expect(parsed.kind).toBe('decision.recorded');
    if (parsed.kind !== 'decision.recorded') return;
    expect('alternatives' in parsed.payload).toBe(false);
  });

  it('refuses an empty alternatives (a named absence is absent, never blank)', () => {
    const forged =
      '{"at":"2026-07-21T00:00:00.000Z","kind":"decision.recorded","payload":{"adr":"ADR-1","alternatives":"","rationale":"y","title":"x"},"signerFp":"fp","subject":"d-1","v":1,"who":"h"}';
    expect(() => parseEvent(forged, reg)).toThrow(/payload\.alternatives/);
  });

  it('requires a non-empty rationale (an ADR with no why records nothing)', () => {
    const forged =
      '{"kind":"decision.recorded","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"d-1","payload":{"title":"x","rationale":"","adr":"ADR-1"}}';
    expect(() => parseEvent(forged, reg)).toThrow(/payload\.rationale/);
  });

  it('requires the adr label', () => {
    const forged =
      '{"kind":"decision.recorded","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"d-1","payload":{"title":"x","rationale":"y"}}';
    expect(() => parseEvent(forged, reg)).toThrow(/payload\.adr/);
  });

  it('parses a decision.transitioned supersede carrying `by` and round-trips it', () => {
    const event = decisionTransitioned(
      { ...envelope, subject: 'd-1', which: 'claude', run: 'r-1' },
      {
        from: 'accepted',
        to: 'superseded',
        action: 'supersede',
        by: 'd-2',
        fields: { reason: 'r' },
      },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    if (parsed.kind === 'decision.transitioned') expect(parsed.payload.by).toBe('d-2');
    expect(canonicalStringify(toCanonical(parsed))).toBe(line(event));
  });

  it('parses a non-supersede decision transition with no `by`', () => {
    const event = decisionTransitioned(
      { ...envelope, subject: 'd-1' },
      { from: 'proposed', to: 'accepted', action: 'accept', fields: { note: 'agreed' } },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    if (parsed.kind === 'decision.transitioned') expect(parsed.payload.by).toBeUndefined();
  });

  it('rejects an empty `by` (write-only line)', () => {
    const forged =
      '{"kind":"decision.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"d-1","payload":{"from":"a","to":"b","action":"supersede","by":""}}';
    expect(() => parseEvent(forged, reg)).toThrow(/payload\.by/);
  });

  it('rejects a non-string `by`', () => {
    const forged =
      '{"kind":"decision.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"d-1","payload":{"from":"a","to":"b","action":"supersede","by":42}}';
    expect(() => parseEvent(forged, reg)).toThrow(/payload\.by/);
  });

  it('rejects an unknown payload field on a decision (closed shape)', () => {
    const forged =
      '{"kind":"decision.recorded","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"d-1","payload":{"title":"x","rationale":"y","adr":"ADR-1","evil":"z"}}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload field "evil"/);
  });

  it('keeps `by` out of fields — a relational id is not textual proof', () => {
    // `by` lives at payload level, never inside fields; a forged `by` smuggled
    // into fields is an unknown fields key and is rejected.
    const forged =
      '{"kind":"decision.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"d-1","payload":{"from":"a","to":"b","action":"supersede","fields":{"by":"d-2"}}}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload\.fields field "by"/);
  });

  it('rebuilds a decision transition so a duplicate `by` cannot pick a value into the bytes', () => {
    // JSON.parse keeps the last duplicate; the rebuilt payload reflects only the
    // declared shape, so the recomputed canonical bytes match a clean build.
    const dup =
      '{"kind":"decision.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"d-1","payload":{"from":"a","to":"b","action":"supersede","by":"d-2","by":"d-3"}}';
    const parsed = parseEvent(dup, reg);
    if (parsed.kind === 'decision.transitioned') expect(parsed.payload.by).toBe('d-3');
    const clean = decisionTransitioned(
      { at: '2026-07-21T00:00:00.000Z', who: 'h', signerFp: 'fp', subject: 'd-1' },
      { from: 'a', to: 'b', action: 'supersede', by: 'd-3' },
    );
    expect(canonicalStringify(toCanonical(parsed))).toBe(canonicalStringify(toCanonical(clean)));
  });
});

describe('parseEvent — enrollment events', () => {
  const anchor = 'mnid:1111111111111111111111111111111111111111111111111111111111111111';

  it('parses identity.founded and round-trips it', () => {
    const event = identityFounded({ ...envelope, subject: anchor }, { foundingFp: 'fp-founder' });
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    if (parsed.kind === 'identity.founded') expect(parsed.payload.foundingFp).toBe('fp-founder');
  });

  it('parses key.enrolled and round-trips it', () => {
    const event = keyEnrolled(
      { ...envelope, subject: anchor },
      { newFp: 'fp-new', reverseSig: 'ab'.repeat(32) },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    if (parsed.kind === 'key.enrolled') {
      expect(parsed.payload.newFp).toBe('fp-new');
      expect(parsed.payload.reverseSig).toBe('ab'.repeat(32));
    }
  });

  it('parses key.revoked and round-trips it', () => {
    const event = keyRevoked(
      { ...envelope, subject: anchor },
      { revokedFp: 'fp-old', reason: 'rotated' },
    );
    const parsed = parseEvent(line(event), reg);
    expect(parsed).toEqual(event);
    if (parsed.kind === 'key.revoked') {
      expect(parsed.payload.revokedFp).toBe('fp-old');
      expect(parsed.payload.reason).toBe('rotated');
    }
  });

  it('rejects an identity.founded missing foundingFp', () => {
    const forged =
      '{"kind":"identity.founded","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"mnid:a","payload":{}}';
    expect(() => parseEvent(forged, reg)).toThrow(/payload\.foundingFp/);
  });

  it('rejects a key.enrolled missing reverseSig', () => {
    const forged =
      '{"kind":"key.enrolled","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"mnid:a","payload":{"newFp":"fp-new"}}';
    expect(() => parseEvent(forged, reg)).toThrow(/payload\.reverseSig/);
  });

  it('rejects a key.revoked missing reason', () => {
    const forged =
      '{"kind":"key.revoked","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"mnid:a","payload":{"revokedFp":"fp-old"}}';
    expect(() => parseEvent(forged, reg)).toThrow(/payload\.reason/);
  });

  it('rejects an unknown payload field on an enrollment event (closed shape)', () => {
    const forged =
      '{"kind":"key.enrolled","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"mnid:a","payload":{"newFp":"fp-new","reverseSig":"ab","evil":"z"}}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload field "evil"/);
  });

  it('rebuilds an enrollment so a duplicate payload key cannot pick a value into the bytes', () => {
    // JSON.parse keeps the last duplicate; the rebuilt payload reflects only the
    // declared shape, so the recomputed canonical bytes match a clean build.
    const dup =
      '{"kind":"key.revoked","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"mnid:a","payload":{"revokedFp":"fp-old","reason":"one","reason":"two"}}';
    const parsed = parseEvent(dup, reg);
    if (parsed.kind === 'key.revoked') expect(parsed.payload.reason).toBe('two');
    const clean = keyRevoked(
      { at: '2026-07-21T00:00:00.000Z', who: 'h', signerFp: 'fp', subject: 'mnid:a' },
      { revokedFp: 'fp-old', reason: 'two' },
    );
    expect(canonicalStringify(toCanonical(parsed))).toBe(canonicalStringify(toCanonical(clean)));
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

  it('re-canonicalizes a birth transition (from: null) to identical bytes', () => {
    // The rebuild must preserve `from: null`, not drop it or coerce it — a
    // birth transition that re-canonicalized differently would read as tampered.
    const event = taskTransitioned(
      { ...envelope, subject: 't-1' },
      { from: null, to: 'draft', action: 'create' },
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
    const bad =
      '{"kind":"task.created","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{}}';
    expect(() => parseEvent(bad, reg)).toThrow(/payload\.title/);
  });

  it('rejects a missing envelope field', () => {
    const bad = '{"kind":"run.ended","v":1,"who":"h","signerFp":"fp","subject":"s","payload":{}}';
    expect(() => parseEvent(bad, reg)).toThrow(/at/);
  });

  it('rejects an empty-string required field', () => {
    const bad =
      '{"kind":"task.created","v":1,"at":"2026-07-21T00:00:00.000Z","who":"","signerFp":"fp","subject":"s","payload":{"title":"x"}}';
    expect(() => parseEvent(bad, reg)).toThrow(/who/);
  });

  it('rejects a line with no signerFp (the signing key is part of the fact)', () => {
    const bad =
      '{"kind":"task.created","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","subject":"s","payload":{"title":"x"}}';
    expect(() => parseEvent(bad, reg)).toThrow(/signerFp/);
  });

  it('accepts the canonical toISOString form of `at`', () => {
    const event = taskCreated(
      { ...envelope, at: '2026-07-21T13:45:07.123Z', subject: 't-1' },
      { title: 'x' },
    );
    expect(parseEvent(line(event), reg)).toEqual(event);
  });

  it('rejects an `at` that is not the canonical toISOString form', () => {
    // Every producer stamps `at` via toISOString; a divergent spelling is not a
    // fact this catalog wrote. The ordering invariant depends on one format.
    const bad = (at: string) =>
      `{"kind":"task.created","v":1,"at":${JSON.stringify(at)},"who":"h","signerFp":"fp","subject":"s","payload":{"title":"x"}}`;
    // A bare placeholder, a timezone OFFSET (not Z), missing sub-second digits,
    // a date-only value, and a real-looking but impossible instant (month 13).
    for (const at of [
      't',
      '2026-07-21T00:00:00+00:00',
      '2026-07-21T00:00:00Z',
      '2026-07-21',
      '2026-13-01T00:00:00.000Z',
    ]) {
      expect(() => parseEvent(bad(at), reg), at).toThrow(/ISO-8601/);
    }
  });

  it('rejects an unknown kind (not in the catalog)', () => {
    expect(() => parseEvent('{"kind":"task.deleted","v":1}', reg)).toThrow(/unknown event kind/);
  });

  it('rejects an empty-string `from` (only null, never "", is the valued absence)', () => {
    // null means "born, no prior state"; "" is neither a state nor null — a
    // forged or corrupt line. Accepting it would create a second way to spell
    // birth and blur the single projection rule.
    const bad =
      '{"kind":"task.transitioned","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{"from":"","to":"draft","action":"create"}}';
    expect(() => parseEvent(bad, reg)).toThrow(/payload\.from/);
  });
});

describe('parseEvent — closed shape (no field smuggling)', () => {
  it('rejects an unknown top-level field (a forger cannot ride extra data along)', () => {
    const forged =
      '{"kind":"run.ended","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{},"evil":"x"}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown event field "evil"/);
  });

  it('rejects an unknown payload field', () => {
    const forged =
      '{"kind":"task.created","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{"title":"x","extra":"y"}}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown payload field "extra"/);
  });

  it('rejects a non-object payload (array, scalar) rather than reading fields off it', () => {
    for (const pl of ['"nope"', '42', 'true', '[]']) {
      const forged = `{"kind":"run.ended","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":${pl}}`;
      expect(() => parseEvent(forged, reg)).toThrow(/object payload/);
    }
  });

  it('rejects a missing or null payload as an EventParseError, never a raw TypeError', () => {
    // A caller verifying a chain catches EventParseError to mark a line bad; a
    // leaked TypeError would bypass that handler and crash the verifier.
    for (const line of [
      '{"kind":"task.created","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s"}',
      '{"kind":"task.created","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":null}',
    ]) {
      expect(() => parseEvent(line, reg)).toThrow(EventParseError);
    }
  });

  it('rejects a __proto__ key (an unknown field, not prototype pollution)', () => {
    const forged =
      '{"kind":"task.created","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{"title":"x"},"__proto__":{"x":1}}';
    expect(() => parseEvent(forged, reg)).toThrow(/unknown event field/);
  });

  it('returns a REBUILT event, so a duplicate key cannot silently pick a value into the bytes', () => {
    // JSON.parse keeps the last of a duplicated key; the rebuilt event's bytes
    // reflect only the declared shape, so the recomputed canonical form differs
    // from the raw (duplicate-bearing) line — which the chain rejects rather
    // than verifies. Here we assert the rebuild is total: the returned object
    // has exactly the declared keys, whatever the raw line's structure was.
    const dup =
      '{"kind":"run.ended","v":1,"at":"2026-07-21T00:00:00.000Z","who":"h","signerFp":"fp","subject":"s","payload":{},"who":"IMPOSTER"}';
    const parsed = parseEvent(dup, reg);
    expect(Object.keys(parsed).sort()).toEqual([
      'at',
      'kind',
      'payload',
      'signerFp',
      'subject',
      'v',
      'who',
    ]);
    // The rebuilt value is a fresh object, never the raw parsed reference.
    expect(canonicalStringify(toCanonical(parsed))).toBe(
      '{"at":"2026-07-21T00:00:00.000Z","kind":"run.ended","payload":{},"signerFp":"fp","subject":"s","v":1,"who":"IMPOSTER"}',
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

/**
 * The same rule, asked by the WRITING side.
 *
 * `unreadableReason` is not a second validator: it runs the one `parseEvent` runs,
 * which is what makes "the writer refuses exactly what the reader refuses" true by
 * construction rather than by two lists agreeing. The pairing below is the proof of
 * that identity — for each event, the answer here and the answer from a round trip
 * through `parseEvent` are the SAME verdict and the same words.
 *
 * It exists because the asymmetry it closes was not theoretical: an empty title
 * reached the tail, signed, and every later read of that project failed forever.
 */
describe("unreadableReason — the reader's verdict, before anything is sealed", () => {
  /** What `parseEvent` says about the same event, so the two can be compared. */
  function readerVerdict(event: CatalogEvent): string | undefined {
    try {
      parseEvent(line(event), reg);
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  }

  it('accepts every kind a builder produces', () => {
    const events: CatalogEvent[] = [
      runStarted({ ...envelope, subject: 'r-1' }, { agent: 'a', goal: 'g' }),
      runEnded({ ...envelope, subject: 'r-1' }, { outcome: 'done' }),
      taskCreated(envelope, { title: 't' }),
      taskTransitioned(envelope, { from: null, to: 'DRAFT', action: 'create' }),
      decisionRecorded(envelope, { title: 't', rationale: 'why', adr: 'ADR-1' }),
      decisionTransitioned(envelope, { from: 'PROPOSED', to: 'ACCEPTED', action: 'accept' }),
      identityFounded(envelope, { foundingFp: 'fp-1' }),
      keyEnrolled(envelope, { newFp: 'fp-2', reverseSig: 'sig' }),
      keyRevoked(envelope, { revokedFp: 'fp-2', reason: 'retired' }),
      memoryCaptured(envelope, { content: 'c' }),
      observationRecorded(envelope, { about: 'x', topic: 'k', text: 't' }),
      handoffRecorded(envelope, { fromAgent: 'a', toAgent: 'b' }),
      knowledgeLinked(envelope, { target: 'y', rel: 'relates-to' }),
      skillCreated(envelope, { name: 'n', body: 'b' }),
      skillTransitioned(envelope, { from: null, to: 'PROPOSED', action: 'create' }),
      skillConsulted(envelope),
    ];
    // Non-vacuity: every kind the catalog declares is exercised, so an added kind
    // with no arm here fails the count rather than passing unseen.
    expect(new Set(events.map((event) => event.kind)).size).toBe(16);
    for (const event of events) {
      expect(unreadableReason(event)).toBeUndefined();
      expect(readerVerdict(event)).toBeUndefined();
    }
  });

  it("gives the READER's own words for every field a caller could empty", () => {
    // One case per field a write path can carry an empty value into — the fields
    // the corruption actually travelled through. Each asserts the same thing twice:
    // the writing side refuses it, and the reading side refuses it with the SAME
    // message. A field where the two differed would be the defect back.
    const cases: readonly [CatalogEvent, string][] = [
      [taskCreated(envelope, { title: '' }), 'payload.title'],
      [decisionRecorded(envelope, { title: '', rationale: 'w', adr: 'ADR-1' }), 'payload.title'],
      [
        decisionRecorded(envelope, { title: 't', rationale: '', adr: 'ADR-1' }),
        'payload.rationale',
      ],
      [skillCreated(envelope, { name: '', body: 'b' }), 'payload.name'],
      [skillCreated(envelope, { name: 'n', body: '' }), 'payload.body'],
      [memoryCaptured(envelope, { content: '' }), 'payload.content'],
      [observationRecorded(envelope, { about: '', topic: 'k', text: 't' }), 'payload.about'],
      [observationRecorded(envelope, { about: 'x', topic: '', text: 't' }), 'payload.topic'],
      [observationRecorded(envelope, { about: 'x', topic: 'k', text: '' }), 'payload.text'],
      [handoffRecorded(envelope, { fromAgent: '', toAgent: 'b' }), 'payload.fromAgent'],
      [handoffRecorded(envelope, { fromAgent: 'a', toAgent: '' }), 'payload.toAgent'],
      [knowledgeLinked(envelope, { target: '', rel: 'r' }), 'payload.target'],
      [knowledgeLinked(envelope, { target: 'y', rel: '' }), 'payload.rel'],
      [runStarted({ ...envelope, subject: 'r' }, { agent: '' }), 'payload.agent'],
      [runStarted({ ...envelope, subject: 'r' }, { agent: 'a', goal: '' }), 'payload.goal'],
      [runEnded({ ...envelope, subject: 'r' }, { outcome: '' }), 'payload.outcome'],
      [keyRevoked(envelope, { revokedFp: 'fp', reason: '' }), 'payload.reason'],
      [keyEnrolled(envelope, { newFp: '', reverseSig: 's' }), 'payload.newFp'],
      [keyEnrolled(envelope, { newFp: 'fp', reverseSig: '' }), 'payload.reverseSig'],
      [identityFounded(envelope, { foundingFp: '' }), 'payload.foundingFp'],
      // The ENVELOPE too: `subject` is the field the handoff and the link carried an
      // empty value into, and it is not part of any payload.
      [taskCreated({ ...envelope, subject: '' }, { title: 't' }), 'at subject'],
      [memoryCaptured({ ...envelope, subject: '' }, { content: 'c' }), 'at subject'],
      [skillConsulted({ ...envelope, subject: '' }), 'at subject'],
      // And the optional envelope fields, which are non-empty-if-present.
      [memoryCaptured({ ...envelope, run: '' }, { content: 'c' }), 'at run'],
      [memoryCaptured({ ...envelope, which: '' }, { content: 'c' }), 'at which'],
    ];
    for (const [event, field] of cases) {
      const reason = unreadableReason(event);
      expect(reason, `${event.kind} / ${field}`).toContain(field);
      expect(reason).toContain('non-empty string');
      // THE point of the pairing: one rule, so one verdict and one wording.
      expect(readerVerdict(event)).toBe(reason);
    }
  });

  it('answers for what the reader refuses beyond an empty string', () => {
    // The rule is the reader's WHOLE rule, not an emptiness check bolted onto the
    // writing side — so the other things a read refuses come back too.
    const badClock = { ...taskCreated(envelope, { title: 't' }), at: '2026-07-21T00:00:00Z' };
    expect(unreadableReason(badClock as CatalogEvent)).toContain('ISO-8601');

    const forged = { ...memoryCaptured(envelope, { content: 'c' }), extra: 'x' };
    expect(unreadableReason(forged as unknown as CatalogEvent)).toContain('unknown event field');

    const emptyLinks = taskTransitioned(envelope, {
      from: 'DRAFT',
      to: 'READY',
      action: 'submit',
      fields: { links: [''] },
    });
    expect(unreadableReason(emptyLinks)).toContain('payload.fields.links[0]');
  });

  it("does not swallow an error that is not the reader's refusal", () => {
    // A guard on the catch: only EventParseError becomes an answer. Anything else
    // is a bug somewhere else and must keep travelling, not be reported as "this
    // event is fine" or as a field name.
    const hostile = {
      ...memoryCaptured(envelope, { content: 'c' }),
      get payload(): never {
        throw new RangeError('not the reader speaking');
      },
    };
    expect(() => unreadableReason(hostile as unknown as CatalogEvent)).toThrow(RangeError);
  });
});
