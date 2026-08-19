import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CatalogEvent,
  catalogUpcasters,
  type EventKind,
  LATEST_VERSION,
  openChainForWriting,
  type TransitionFields,
} from '@mnema/chain';
import { describe, expect, it } from 'vitest';
import {
  captureMemory,
  linkKnowledge,
  recordHandoff,
  recordObservation,
} from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import { switchChannel } from '../workflow/channel-operations.js';
import { recordDecision, supersedeDecision } from '../workflow/decision-operations.js';
import { enrollKey, foundIdentity, revokeKey } from '../workflow/identity-operations.js';
import { createTask, transitionTask, type WriteContext } from '../workflow/operations.js';
import { authorizeTailPrune } from '../workflow/prune-operations.js';
import { endRun, startRun } from '../workflow/session-operations.js';
import { createSkill, recordConsultation, reviewSkill } from '../workflow/skill-operations.js';
import {
  ENVELOPE_TEXT,
  type FieldNature,
  fieldNature,
  PAYLOAD_TEXT,
  proseFieldsOf,
  SUBJECT_TEXT,
} from './fields.js';
import { FIELD_BYTE_LIMIT } from './screen.js';
import { detectSecrets } from './secrets.js';

/**
 * The content door is total over the FIELDS, not only over the write points —
 * and the driving that proves it is DERIVED from the field classification
 * rather than typed out.
 *
 * WHAT THIS CLOSES, AND WHY THE FILE NEXT DOOR COULD NOT. `every-door.test.ts`
 * drives every write point and then reads the whole chain back with a sweep that
 * knows no field names. Only the READ half of that is generic: the drive half is a
 * list of calls with hand-written arguments, so a field no call passes is a field no
 * assertion can see. That was measured, not suspected — `alternatives` was added to
 * `decision.recorded` with the screen deliberately bypassed and the entire suite
 * stayed green, that file included, ten of ten. The sweep proved the door ran on the
 * text it was GIVEN and could not prove the text reached it.
 *
 * SO THE DRIVING IS DERIVED. Each kind has ONE driver here, and a driver never
 * writes a literal into a text field: it asks for every value by the field's own
 * path, and the harness answers with a value carrying a marker unique to that
 * (kind, path). Which paths exist is read from the classification, which is read
 * from the catalog's declarations — so a text field added to any payload is:
 *   1. required in `fields.ts` (the build fails until it is classified), and
 *   2. required to arrive here carrying its marker (this file fails until a driver
 *      passes it), and
 *   3. required to arrive clean (this file fails until the operation screens it).
 * A field cannot become invisible by nobody remembering it, which is the whole of
 * what the old shape could not promise.
 *
 * THE OTHER HALF IS THE IDENTIFIERS, and it is not a smaller version of the same
 * check. A fingerprint is compared, a reverse-signature is verified byte for byte,
 * an id is a lookup key: putting any of them through a scrubber would break the
 * record rather than defend it. So every identifier leaf is asserted UNTOUCHED —
 * no marker (nothing poisoned it) and no placeholder (nothing cleaned it). That is
 * what keeps a total guard from becoming total damage.
 *
 * WHAT IS STILL A LIST HERE, said plainly. The DRIVERS are hand-written: one
 * function per kind, each knowing which operation writes it and what a legal setup for
 * it looks like. That cannot be derived — it is the surface itself — so what is
 * derived instead is the OBLIGATION on each: the totality over kinds is checked
 * against `LATEST_VERSION` at runtime, and the totality over each kind's fields is
 * checked against the classification. The compiler is not the guard for this one
 * axis, because test files are excluded from `tsc -b`; the runtime check below is,
 * and it is why it is written as an assertion rather than as a type.
 */

const upcasters = catalogUpcasters();

/** Every kind the catalog can hold — the enumeration both axes are measured against. */
const CATALOG = Object.keys(LATEST_VERSION) as EventKind[];

/** The value every prose field is asked to carry. It must never be found. */
const SECRET = 'AKIAIOSFODNN7EXAMPLE';

/** A second class in the same value, so one pass covers two shapes of credential. */
const PASSWORD_URL = 'postgres://svc:Tr0ub4dor3@db.internal/app';
const PASSWORD = 'Tr0ub4dor3';

/**
 * What a driver is handed to fill a text field with: it asks by PATH and is given
 * a value. It never writes a literal, which is what makes a new field's absence
 * visible instead of silent.
 */
type Poison = (path: string) => string;

/** A write's result as this harness judges it: it landed, or it was refused with a code. */
type WriteResult = { readonly ok: true } | { readonly ok: false; readonly code: string };

/** One kind driven onto the chain: whatever setup it needs, then the write under test. */
type Driver = (ctx: WriteContext, text: Poison) => WriteResult;

/**
 * The marker a (kind, path) pair is poisoned with — what proves the driver actually
 * reached the field, since the credential beside it is gone by the time the value is
 * read back. Only letters, digits, dots and dashes, so nothing in it can be mistaken
 * for a credential or be altered by canonicalization.
 */
function marker(kind: EventKind, path: string): string {
  return `probe--${kind}--${path}`;
}

/** Every field poisoned: the marker for its path, plus two classes of credential. */
function poisoning(kind: EventKind): Poison {
  return (path) => `${marker(kind, path)} ${SECRET} ${PASSWORD_URL}`;
}

/** One field over the ceiling and every other field clean, so a refusal has one cause. */
function oversizeAt(kind: EventKind, target: string): Poison {
  return (path) => (path === target ? 'x'.repeat(FIELD_BYTE_LIMIT + 1) : marker(kind, path));
}

/**
 * The transition proof, built from the classification rather than typed: every
 * prose leaf under `fields` is poisoned, so a sixth proof field added to the catalog
 * is carried here the day it is classified.
 *
 * `links` is the one leaf that is a LIST rather than a field, and the classification
 * records a field's nature, not its arity. A future list-valued leaf passed here as a
 * plain string does not slip by: the append door asks the reader's own validator,
 * which refuses a non-array, so the driver fails loudly.
 */
function proofFor(kind: EventKind, text: Poison): TransitionFields {
  const fields: Record<string, string | string[]> = {};
  for (const path of proseFieldsOf(kind)) {
    if (!path.startsWith('payload.fields.')) continue;
    const key = path.slice('payload.fields.'.length);
    fields[key] = key === 'links' ? [text(path)] : text(path);
  }
  return fields as TransitionFields;
}

/** A setup write that must have landed for the write under test to mean anything. */
function landed<T extends { readonly ok: boolean }>(result: T): Extract<T, { ok: true }> {
  expect(result.ok, `setup write failed: ${JSON.stringify(result)}`).toBe(true);
  return result as Extract<T, { ok: true }>;
}

/**
 * How each kind reaches the chain. One entry per kind, and the entry asks for every
 * text value by path — including the two the envelope carries (`which`, `run`) for
 * every operation that accepts them. The kinds that accept neither pass neither, and
 * the harness reads that from the events rather than from a list here.
 */
const DRIVERS: { readonly [K in EventKind]: Driver } = {
  'run.started': (ctx, text) =>
    // A run's agent IS its envelope `which`, so this kind fills that slot through
    // the payload; there is no separate `which` to pass and no parent run to pin to.
    startRun(ctx, { agent: text('payload.agent'), goal: text('payload.goal') }),

  'run.ended': (ctx, text) => {
    const run = landed(startRun(ctx, { agent: 'the opener' }));
    return endRun(ctx, {
      run: run.id,
      which: text('which'),
      outcome: text('payload.outcome'),
    });
  },

  'task.created': (ctx, text) =>
    createTask(ctx, { title: text('payload.title'), which: text('which'), run: text('run') }),

  'task.transitioned': (ctx, text) => {
    const task = landed(createTask(ctx, { title: 'a task to move' }));
    return transitionTask(ctx, {
      id: task.id,
      action: 'cancel',
      fields: proofFor('task.transitioned', text),
      which: text('which'),
      run: text('run'),
    });
  },

  'decision.recorded': (ctx, text) =>
    recordDecision(ctx, {
      title: text('payload.title'),
      rationale: text('payload.rationale'),
      alternatives: text('payload.alternatives'),
      which: text('which'),
      run: text('run'),
    }),

  'decision.transitioned': (ctx, text) => {
    const subject = landed(recordDecision(ctx, { title: 'the old one', rationale: 'why' }));
    const successor = landed(recordDecision(ctx, { title: 'the new one', rationale: 'why' }));
    return supersedeDecision(ctx, {
      id: subject.id,
      by: successor.id,
      fields: proofFor('decision.transitioned', text),
      which: text('which'),
      run: text('run'),
    });
  },

  // Every field of a founding is derived — the anchor from a key, the fingerprint
  // from that same key, `at` from the clock — so there is nothing for a caller to
  // fill and nothing here to poison.
  'identity.founded': (ctx) => foundIdentity(ctx),

  'key.enrolled': (ctx) =>
    // A fingerprint and a hex signature, in the shapes the handshake produces. Both
    // are identifiers, so neither is poisoned: this driver exists to put the kind on
    // the chain and let the sweep confirm nothing touched them.
    enrollKey(ctx, { newFp: 'a'.repeat(64), reverseSig: 'b'.repeat(128) }),

  'key.revoked': (ctx, text) =>
    revokeKey(ctx, { revokedFp: 'f'.repeat(64), reason: text('payload.reason') }),

  'memory.captured': (ctx, text) =>
    captureMemory(ctx, {
      content: text('payload.content'),
      which: text('which'),
      run: text('run'),
    }),

  'observation.recorded': (ctx, text) =>
    recordObservation(ctx, {
      about: text('payload.about'),
      topic: text('payload.topic'),
      text: text('payload.text'),
      which: text('which'),
      run: text('run'),
    }),

  'handoff.recorded': (ctx, text) =>
    // The task it is about becomes the event's SUBJECT, so this kind's subject is
    // asked for by that path and not by the input's name for it.
    recordHandoff(ctx, {
      task: text('subject'),
      fromAgent: text('payload.fromAgent'),
      toAgent: text('payload.toAgent'),
      which: text('which'),
      run: text('run'),
    }),

  'knowledge.linked': (ctx, text) =>
    linkKnowledge(ctx, {
      subject: text('subject'),
      target: text('payload.target'),
      rel: text('payload.rel'),
      which: text('which'),
      run: text('run'),
    }),

  'skill.created': (ctx, text) =>
    createSkill(ctx, {
      name: text('payload.name'),
      body: text('payload.body'),
      which: text('which'),
      run: text('run'),
    }),

  'skill.transitioned': (ctx, text) => {
    const skill = landed(createSkill(ctx, { name: 'a pattern', body: 'the body' }));
    return reviewSkill(ctx, {
      id: skill.id,
      fields: proofFor('skill.transitioned', text),
      which: text('which'),
      run: text('run'),
    });
  },

  'skill.consulted': (ctx, text) =>
    recordConsultation(ctx, { skill: text('subject'), which: text('which'), run: text('run') }),

  'tail.pruned': (ctx, text) =>
    // The only kind whose setup is another MACHINE: a waiver may not name the tail it
    // is written to, so this puts a second tail in the tree first. Its `tail`,
    // `throughHash` and subject are all read off that tail by the operation, so the
    // only value this drives is the reason — and the sweep's other half is what
    // checks the three it did not touch came through untouched.
    authorizeTailPrune(ctx, {
      tail: aSecondTailIn(ctx.layout.root),
      reason: text('payload.reason'),
      which: text('which'),
      run: text('run'),
    }),

  'channel.switched': (ctx, text) =>
    // The CHANNEL is the subject and it is a caller's string, so it goes through the
    // door like a consultation's skill — nothing in this package knows which channels
    // this product pushes. `on` is a boolean and there is nothing textual in it to
    // drive, which is why the pair here is subject and reason.
    switchChannel(ctx, {
      channel: text('subject'),
      on: false,
      reason: text('payload.reason'),
      which: text('which'),
      run: text('run'),
    }),
};

/**
 * Puts a second machine's tail into a chain root, the way an offline merge does:
 * write it in a root of its own, then copy the tail directory and the public key
 * that owns it across. Returns that tail's id.
 *
 * It exists because this is the one kind whose write is ABOUT another tail, and the
 * refusal it would otherwise meet (`TAIL_IS_OWN`) is a rule of the product rather
 * than an accident of the fixture.
 */
function aSecondTailIn(root: string): string {
  const other = mkdtempSync(join(tmpdir(), 'mnema-field-other-'));
  try {
    const ctx: WriteContext = {
      writer: openChainForWriting(other, { keyRoot: other }),
      layout: { root: other },
      upcasters,
    };
    landed(createTask(ctx, { title: 'work the other machine did' }));
    const tail = ctx.writer.tail;
    cpSync(join(other, 'tails', tail), join(root, 'tails', tail), { recursive: true });
    const pub = `${ctx.writer.signerFingerprint}.pub`;
    cpSync(join(other, 'keys', pub), join(root, 'keys', pub));
    return tail;
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
}

/** One text leaf of an event, addressed the way the classification is keyed. */
interface Leaf {
  readonly path: string;
  readonly value: string;
}

/**
 * Every string anywhere in an event, with the path it sits at — the envelope's
 * fields at their bare names, the payload's under `payload.`, a nested proof field
 * at `payload.fields.<name>`, and each item of a list at the list's own path.
 *
 * It walks the WHOLE event, envelope included. A sweep that knows which half of an
 * event to look at is a list, and a payload-only one is exactly how the agent name
 * reached the chain unscreened while a green suite said otherwise.
 */
function textLeaves(event: CatalogEvent): readonly Leaf[] {
  const found: Leaf[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === 'string') {
      found.push({ path, value });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, path);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        walk(item, path === '' ? key : `${path}.${key}`);
      }
    }
  };
  walk(event, '');
  return found;
}

/** What one drive produced: the write's verdict, the chain it left, and what it asked for. */
interface Driven {
  readonly result: WriteResult;
  readonly events: readonly CatalogEvent[];
  /**
   * Every path the driver asked a value for — the fields this kind's write actually
   * ACCEPTS, observed rather than listed. It is what the size pass runs over, so a
   * field filled indirectly (a run's agent, which becomes the envelope's `which`) is
   * measured where the caller hands it in and not twice.
   */
  readonly asked: ReadonlySet<string>;
}

/** Drives one kind into a sandbox of its own and reads the whole chain back. */
function drive(kind: EventKind, text: Poison): Driven {
  const root = mkdtempSync(join(tmpdir(), 'mnema-field-'));
  const asked = new Set<string>();
  try {
    const ctx: WriteContext = {
      writer: openChainForWriting(root, { keyRoot: root }),
      layout: { root },
      upcasters,
    };
    const result = DRIVERS[kind](ctx, (path) => {
      asked.add(path);
      return text(path);
    });
    return { result, events: orderedEvents(ctx.layout, upcasters), asked };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('the classification is total over the catalog, in both halves', () => {
  it('classifies every kind, and every text leaf every payload declares', () => {
    // The tables are keyed by the catalog's own declarations, so this asserts
    // agreement at RUNTIME with what the compiler already forces at build time —
    // the half a type cannot state is that nothing else crept in.
    expect(Object.keys(PAYLOAD_TEXT).sort()).toEqual([...CATALOG].sort());
    expect(Object.keys(SUBJECT_TEXT).sort()).toEqual([...CATALOG].sort());
    for (const kind of CATALOG) {
      for (const field of Object.keys(PAYLOAD_TEXT[kind])) {
        expect(fieldNature(kind, `payload.${field}`), `${kind}.${field}`).toBeDefined();
      }
      expect(fieldNature(kind, 'subject'), `${kind} subject`).toBeDefined();
    }
    for (const field of Object.keys(ENVELOPE_TEXT)) {
      expect(fieldNature('task.created', field), field).toBeDefined();
    }
  });

  it('is not vacuous — each half holds fields, on every table', () => {
    // A classification with an empty half would pass every assertion in this file
    // while proving nothing about the half that is missing.
    const natures = (values: readonly FieldNature[]): Record<FieldNature, number> => ({
      prose: values.filter((nature) => nature === 'prose').length,
      identifier: values.filter((nature) => nature === 'identifier').length,
    });

    const envelope = natures(Object.values(ENVELOPE_TEXT));
    expect(envelope.prose).toBeGreaterThan(0);
    expect(envelope.identifier).toBeGreaterThan(0);

    const subject = natures(Object.values(SUBJECT_TEXT));
    expect(subject.prose).toBeGreaterThan(0);
    expect(subject.identifier).toBeGreaterThan(0);

    const payload = natures(CATALOG.flatMap((kind) => Object.values(PAYLOAD_TEXT[kind])));
    expect(payload.prose).toBeGreaterThan(0);
    expect(payload.identifier).toBeGreaterThan(0);

    // And the enumeration itself is not empty, so "every field is classified" is a
    // statement about a real catalog rather than about nothing.
    expect(CATALOG.length).toBeGreaterThan(10);
    expect(Object.keys(ENVELOPE_TEXT).length + payload.prose + payload.identifier).toBeGreaterThan(
      30,
    );
  });

  it('answers nothing for a field the catalog does not declare', () => {
    // The mechanism the guard rests on: an unclassified path comes back undefined,
    // which is what the sweep turns into a failure. Proven with paths no catalog
    // field could ever spell, so this stays a test of the MECHANISM on the day a
    // real field is added rather than a second alarm for it.
    expect(fieldNature('memory.captured', 'payload.no such field')).toBeUndefined();
    expect(fieldNature('task.created', 'no such envelope field')).toBeUndefined();
    expect(fieldNature('skill.consulted', 'payload.anything at all')).toBeUndefined();
  });
});

describe('every kind the catalog can hold is driven onto the chain', () => {
  it('has a driver for each, and no driver for a kind that does not exist', () => {
    // The by-kind axis. A kind added to the catalog fails here until it is driven,
    // and this is an assertion rather than a type because test files are excluded
    // from `tsc -b` — a mapped type here would compile no matter what it omitted.
    expect(Object.keys(DRIVERS).sort()).toEqual([...CATALOG].sort());
  });

  it('actually appends an event of the kind it claims to drive', () => {
    // A driver that wrote nothing, or wrote something else, would make every
    // assertion below vacuous for its kind.
    for (const kind of CATALOG) {
      const driven = drive(kind, poisoning(kind));
      expect(driven.result.ok, `${kind}: ${JSON.stringify(driven.result)}`).toBe(true);
      expect(
        driven.events.some((event) => event.kind === kind),
        `${kind} reached the chain`,
      ).toBe(true);
    }
  });
});

describe('no field slips past the door', () => {
  for (const kind of CATALOG) {
    it(`screens every prose field of ${kind}, and leaves its identifiers alone`, () => {
      const driven = drive(kind, poisoning(kind));
      expect(driven.result.ok, `${kind}: ${JSON.stringify(driven.result)}`).toBe(true);

      const own = driven.events.filter((event) => event.kind === kind);
      expect(own.length).toBeGreaterThan(0);

      const reached = new Set<string>();
      for (const event of own) {
        for (const leaf of textLeaves(event)) {
          const nature = fieldNature(kind, leaf.path);
          // An unclassified text field is the failure this whole file exists for:
          // it is a value on the chain that nobody decided anything about.
          expect(nature, `${kind} has an unclassified text field at "${leaf.path}"`).toBeDefined();

          if (nature === 'prose') {
            // It went through the door: both credentials are gone, and the
            // detector finds nothing left in what was recorded.
            expect(leaf.value, `${kind}.${leaf.path}`).not.toContain(SECRET);
            expect(leaf.value, `${kind}.${leaf.path}`).not.toContain(PASSWORD);
            expect(detectSecrets(leaf.value), `${kind}.${leaf.path}`).toEqual([]);
            // And the driver reached it: a prose value with no marker of this kind
            // is a field something else filled in, not one this pass poisoned.
            expect(leaf.value, `${kind}.${leaf.path} was not driven`).toContain(`probe--${kind}--`);
            if (leaf.value.includes(marker(kind, leaf.path))) reached.add(leaf.path);
            continue;
          }

          // The other half: the door did NOT run here. No marker (nothing poisoned
          // it) and no placeholder (nothing cleaned it), so the value the record
          // proves things with is the value it was given.
          expect(leaf.value, `${kind}.${leaf.path} was poisoned`).not.toContain('probe--');
          expect(leaf.value, `${kind}.${leaf.path} was scrubbed`).not.toContain('<SECRET:');
        }
      }

      // The coverage the old shape could not give: every field the classification
      // calls prose was actually filled by this driver, at its own path. A field
      // added to this kind and forgotten by the driver fails right here, before
      // anyone gets to the question of whether it was screened.
      for (const path of proseFieldsOf(kind)) {
        expect(reached.has(path), `${kind} never drove "${path}"`).toBe(true);
      }
    });
  }
});

describe('the envelope’s own text goes through the door on every kind that carries it', () => {
  // `which` and `run` are the two fields a caller supplies on the ENVELOPE, so they
  // are the same two on every kind rather than a property of any one payload — and
  // they are the worst place for a credential, being stamped on every event of a
  // session. They are driven on their own axis for that reason: per kind they would
  // prove the same thing once per kind and still say nothing about the surface.
  const shared = Object.entries(ENVELOPE_TEXT)
    .filter(([, nature]) => nature === 'prose')
    .map(([path]) => path);

  it('has prose on the envelope to answer for', () => {
    expect(shared.length).toBeGreaterThan(0);
  });

  for (const path of shared) {
    it(`carries "${path}" cleaned, wherever a write puts it on the chain`, () => {
      let carried = 0;
      for (const kind of CATALOG) {
        const driven = drive(kind, poisoning(kind));
        expect(driven.result.ok, `${kind}: ${JSON.stringify(driven.result)}`).toBe(true);
        // The events of the kind under test. A driver's SETUP writes are events of
        // other kinds, and each of those is the kind under test in its own turn.
        for (const event of driven.events.filter((one) => one.kind === kind)) {
          const value = (event as unknown as Record<string, unknown>)[path];
          if (typeof value !== 'string') continue;
          carried += 1;
          expect(value, `${kind}.${path}`).not.toContain(SECRET);
          expect(value, `${kind}.${path}`).not.toContain(PASSWORD);
          expect(detectSecrets(value), `${kind}.${path}`).toEqual([]);
          expect(value, `${kind}.${path} was not driven`).toContain('probe--');
        }
      }
      // Non-vacuity: a pass where no event carried the field at all would assert
      // nothing, and would look identical to a pass where every write dropped it.
      expect(carried, `no event carried "${path}"`).toBeGreaterThan(0);
    });
  }
});

describe('the size ceiling holds on every field the door owes', () => {
  // The door is a limit and THEN a scrub, so a field that reaches it is under both
  // and a field that reaches neither is invisible to the pass above in the same way.
  // What each kind is measured on is what its driver ASKED for — the fields the
  // write accepts, observed in the clean pass — so nothing is listed here and a
  // field filled indirectly is charged to the input the caller actually hands in.
  for (const kind of CATALOG) {
    it(`refuses an oversize value in any field ${kind} takes`, () => {
      const clean = drive(kind, poisoning(kind));
      expect(clean.result.ok).toBe(true);

      for (const path of clean.asked) {
        const driven = drive(kind, oversizeAt(kind, path));
        expect(driven.result.ok, `${kind} accepted an oversize "${path}"`).toBe(false);
        if (driven.result.ok) continue;
        expect(driven.result.code, `${kind}.${path}`).toBe('CONTENT_TOO_LARGE');
      }
    });
  }
});

describe('an identifier is never screened, even when it looks like a credential', () => {
  it('records a fingerprint and a signature verbatim while cleaning the prose beside them', () => {
    // The half that keeps the guard from becoming the damage. `revokedFp`,
    // `newFp` and `reverseSig` are the identifiers a caller supplies, so they are
    // the only ones that can be handed a value in a credential's shape — and the
    // record has to keep them byte for byte, because a fingerprint is compared and
    // a reverse-signature is verified over exactly these bytes.
    //
    // The same write carries prose in the same event, so one assertion pair shows
    // both halves: the reason is cleaned, the fingerprint is not.
    const root = mkdtempSync(join(tmpdir(), 'mnema-ident-'));
    try {
      const ctx: WriteContext = {
        writer: openChainForWriting(root, { keyRoot: root }),
        layout: { root },
        upcasters,
      };

      const revoked = landed(
        revokeKey(ctx, { revokedFp: SECRET, reason: `retired, and ${SECRET}` }),
      );
      expect(revoked.replaced).toEqual(['aws-access-key']);

      landed(enrollKey(ctx, { newFp: SECRET, reverseSig: PASSWORD_URL }));

      const events = orderedEvents(ctx.layout, upcasters);
      const revocation = events.find((event) => event.kind === 'key.revoked');
      expect(revocation).toBeDefined();
      if (revocation?.kind !== 'key.revoked') return;
      // Intact, in the exact shape it was handed.
      expect(revocation.payload.revokedFp).toBe(SECRET);
      // And the prose of the very same event went through the door.
      expect(revocation.payload.reason).toBe('retired, and <SECRET:aws-access-key>');

      const enrollment = events.find((event) => event.kind === 'key.enrolled');
      expect(enrollment).toBeDefined();
      if (enrollment?.kind !== 'key.enrolled') return;
      expect(enrollment.payload.newFp).toBe(SECRET);
      expect(enrollment.payload.reverseSig).toBe(PASSWORD_URL);
      expect(enrollment.payload.reverseSig).toContain(PASSWORD);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a minted id, an anchor and a state out of the door on every kind', () => {
    // The general form of the same rule, over the whole catalog: nothing the record
    // derives ever comes back carrying a placeholder, however dirty the prose beside
    // it was. Without this, a door made total over the fields would be one edit away
    // from replacing the record's own identity with `<SECRET:…>`.
    for (const kind of CATALOG) {
      const driven = drive(kind, poisoning(kind));
      for (const event of driven.events) {
        for (const leaf of textLeaves(event)) {
          if (fieldNature(event.kind, leaf.path) !== 'identifier') continue;
          expect(leaf.value, `${event.kind}.${leaf.path}`).not.toContain('<SECRET:');
        }
      }
    }
  });
});
