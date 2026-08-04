import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requestEnrollment } from '../identity/handshake.js';
import { enrollFromRequest, revokeMember } from '../identity/roster.js';
import {
  captureMemory,
  linkKnowledge,
  recordHandoff,
  recordObservation,
} from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import * as writeSurface from '../write.js';
import { recordDecision } from './decision-operations.js';
import { enrollKey, ensureFounded, revokeKey } from './identity-operations.js';
import { createTask, type WriteContext } from './operations.js';
import { endRun, startRun } from './session-operations.js';
import { createSkill, recordConsultation } from './skill-operations.js';

/**
 * The invariant this file exists for: EVERY append asks whether a READ would
 * accept the event, and no write path can skip the asking.
 *
 * The defect it closes was the widest one this codebase has had. The catalog's
 * shape rules lived only in the parser, which runs on the way OUT, so a write that
 * built an event the parser forbids — a task with an empty title, a link with an
 * empty relation, a session with an empty goal — was appended, SIGNED, and reported
 * as a success. Every later read of that project then failed: not the one record,
 * the WHOLE tree, because a replay refuses the tail rather than the line. Eighteen
 * commands of the shipped CLI could do it with one empty argument, and the record is
 * append-only, so nothing takes the line back out.
 *
 * So the tests come in two halves, and neither is sufficient alone:
 *
 *   1. THE SOURCE GUARD. No module of the core may reach `writer.append` on its
 *      own — the door is the only way through. This is the half that catches a
 *      write path added TOMORROW, which no behavioural test can, because a test
 *      cannot drive an operation nobody has written yet.
 *   2. THE BEHAVIOURAL SWEEP. Every operation that CAN be handed an empty value is
 *      handed one, in every field that reaches a required event field, and must come
 *      back with a typed refusal — never a throw — having appended nothing. And the
 *      set of operations swept is checked against the writing surface's own exports,
 *      so a new export must be classified or the test fails.
 *
 * The assertion is always the same pair: a REFUSAL WITH A CODE, and the chain still
 * reads. Not "it did not crash": the point of the door is that the caller is told
 * what to fix, and that the record it did not enter is still openable.
 */

const upcasters = catalogUpcasters();
const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = join(HERE, '..');

describe('the door is the only way onto a tail', () => {
  /** Every non-test TypeScript file under the core's source. */
  function sourceFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        found.push(...sourceFiles(path));
        continue;
      }
      if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
    }
    return found;
  }

  /**
   * Where the core reaches a writer's own append, as `<file>:<count>`.
   *
   * A structural guard, and structural guards go vacuous — a renamed method, a
   * moved directory, and it happily reports an empty set forever. So the assertion
   * below is not "the set is small": it is the EXACT set, counts included, which
   * fails just as loudly when the pattern stops matching anything as when a new
   * call site appears.
   */
  function directAppends(): Record<string, number> {
    const sites: Record<string, number> = {};
    for (const file of sourceFiles(CORE_SRC)) {
      const matches = readFileSync(file, 'utf-8').match(/\.append(All)?\(/g);
      if (matches !== null) sites[relative(CORE_SRC, file)] = matches.length;
    }
    return sites;
  }

  it('has exactly two places that touch a writer, and both are accounted for', () => {
    // `workflow/append.ts` IS the door — its two calls are the door's own.
    // `identity-operations.ts` has ONE, the founding, and it is the single
    // deliberate exception: every field of a founding is derived from the local key,
    // no caller supplies anything, and the function returns the anchor rather than a
    // result union, so there is nobody to hand a refusal to. The writer's own check
    // still stands under it, so a founding that ever came out unreadable fails loudly
    // instead of entering the record.
    //
    // A THIRD entry here means a write path that can put an unreadable entry on a
    // tail and report success. Route it through `appendEvent`/`appendEvents`.
    expect(directAppends()).toEqual({
      'workflow/append.ts': 2,
      'workflow/identity-operations.ts': 1,
    });
  });
});

describe('every write refuses what no read could accept', () => {
  let root: string;
  let keyRoot: string;
  let ctx: WriteContext;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnema-append-'));
    keyRoot = mkdtempSync(join(tmpdir(), 'mnema-append-key-'));
    ctx = { writer: openChainForWriting(root, { keyRoot: root }), layout: { root }, upcasters };
    // Founded up front, as `mnema init` leaves every project it creates. It matters
    // for the count below: an operation founds this installation's anchor on its way
    // in, so on a tree nobody had ever written to the FIRST refused write would
    // still leave that founding behind (see `refuse` in append.ts, and the virgin
    // tree case at the end of this file, which pins that behaviour rather than
    // hiding it). Founding here isolates what the sweep is about.
    ensureFounded(ctx);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(keyRoot, { recursive: true, force: true });
  });

  /**
   * How many events the chain holds — which is also the proof the chain still
   * READS: `orderedEvents` parses every line, so it throws on exactly the entry
   * this door exists to keep out.
   */
  function eventCount(): number {
    return orderedEvents(ctx.layout, upcasters).length;
  }

  /** One refused write: what was driven, and the field the reader named. */
  interface Case {
    /** The operation's exported name — checked against the surface's exports. */
    readonly op: string;
    /** The input field the empty value was put in. */
    readonly field: string;
    /** The field the reader's message must name. */
    readonly names: string;
    /**
     * What the field can only be REACHED through, when anything is: the run a close
     * needs open, the second key a revocation needs in the roster. It is separate
     * from `drive` so the count around the refusal is EXACT rather than allowed a
     * slack of "one or two events the setup happened to write" — a slack is where a
     * real append hides.
     */
    readonly prepare?: () => void;
    readonly drive: () => {
      readonly ok: boolean;
      readonly code?: string;
      readonly message?: string;
    };
  }

  /**
   * Every (operation, field) pair an empty value can travel through into a field
   * the catalog requires. Written out one by one rather than generated, because the
   * pairing is the claim: this field of this operation reaches that field of that
   * event, and the eighteen CLI commands that could corrupt a project are these
   * rows seen from the other end.
   */
  function cases(): readonly Case[] {
    // Written by `prepare`, read by `drive` — the two halves of the cases that
    // cannot reach their field from an empty record.
    let openRun = '';
    let secondKey = '';
    return [
      {
        op: 'createTask',
        field: 'title',
        names: 'payload.title',
        drive: () => createTask(ctx, { title: '' }),
      },
      {
        op: 'recordDecision',
        field: 'title',
        names: 'payload.title',
        drive: () => recordDecision(ctx, { title: '', rationale: 'why' }),
      },
      {
        op: 'recordDecision',
        field: 'rationale',
        names: 'payload.rationale',
        drive: () => recordDecision(ctx, { title: 't', rationale: '' }),
      },
      {
        op: 'createSkill',
        field: 'name',
        names: 'payload.name',
        drive: () => createSkill(ctx, { name: '', body: 'b' }),
      },
      {
        op: 'createSkill',
        field: 'body',
        names: 'payload.body',
        drive: () => createSkill(ctx, { name: 'n', body: '' }),
      },
      {
        op: 'captureMemory',
        field: 'content',
        names: 'payload.content',
        drive: () => captureMemory(ctx, { content: '' }),
      },
      {
        op: 'recordObservation',
        field: 'about',
        names: 'payload.about',
        drive: () => recordObservation(ctx, { about: '', topic: 'k', text: 't' }),
      },
      {
        op: 'recordObservation',
        field: 'topic',
        names: 'payload.topic',
        drive: () => recordObservation(ctx, { about: 'x', topic: '', text: 't' }),
      },
      {
        op: 'recordObservation',
        field: 'text',
        names: 'payload.text',
        drive: () => recordObservation(ctx, { about: 'x', topic: 'k', text: '' }),
      },
      {
        // The handoff's task becomes the event's SUBJECT — the envelope, not a
        // payload, which is why a sweep over payload fields would have missed it.
        op: 'recordHandoff',
        field: 'task',
        names: 'at subject',
        drive: () => recordHandoff(ctx, { task: '', fromAgent: 'a', toAgent: 'b' }),
      },
      {
        op: 'recordHandoff',
        field: 'fromAgent',
        names: 'payload.fromAgent',
        drive: () => recordHandoff(ctx, { task: 't', fromAgent: '', toAgent: 'b' }),
      },
      {
        op: 'recordHandoff',
        field: 'toAgent',
        names: 'payload.toAgent',
        drive: () => recordHandoff(ctx, { task: 't', fromAgent: 'a', toAgent: '' }),
      },
      {
        op: 'linkKnowledge',
        field: 'subject',
        names: 'at subject',
        drive: () => linkKnowledge(ctx, { subject: '', target: 'y', rel: 'r' }),
      },
      {
        op: 'linkKnowledge',
        field: 'target',
        names: 'payload.target',
        drive: () => linkKnowledge(ctx, { subject: 'x', target: '', rel: 'r' }),
      },
      {
        op: 'linkKnowledge',
        field: 'rel',
        names: 'payload.rel',
        drive: () => linkKnowledge(ctx, { subject: 'x', target: 'y', rel: '' }),
      },
      {
        // The session's agent is the one field that lands in a payload AND on the
        // envelope. Empty, it names no identity, so the envelope's `which` drops out
        // — and the payload's `agent` kept the empty string, which is the asymmetry.
        op: 'startRun',
        field: 'agent',
        names: 'payload.agent',
        drive: () => startRun(ctx, { agent: '' }),
      },
      {
        op: 'startRun',
        field: 'goal',
        names: 'payload.goal',
        drive: () => startRun(ctx, { agent: 'a', goal: '' }),
      },
      {
        op: 'endRun',
        field: 'outcome',
        names: 'payload.outcome',
        prepare: () => {
          const run = startRun(ctx, { agent: 'opener' });
          if (!run.ok) throw new Error('the run to close could not be opened');
          openRun = run.id;
        },
        drive: () => endRun(ctx, { run: openRun, which: 'closer', outcome: '' }),
      },
      {
        op: 'recordConsultation',
        field: 'skill',
        names: 'at subject',
        drive: () => recordConsultation(ctx, { skill: '' }),
      },
      {
        op: 'revokeKey',
        field: 'reason',
        names: 'payload.reason',
        drive: () => revokeKey(ctx, { revokedFp: 'f'.repeat(64), reason: '' }),
      },
      {
        op: 'enrollKey',
        field: 'newFp',
        names: 'payload.newFp',
        drive: () => enrollKey(ctx, { newFp: '', reverseSig: 'sig' }),
      },
      {
        op: 'enrollKey',
        field: 'reverseSig',
        names: 'payload.reverseSig',
        drive: () => enrollKey(ctx, { newFp: 'f'.repeat(64), reverseSig: '' }),
      },
      {
        // The roster's revoke reaches the same fact through its own checks, so it
        // needs a real second member first — which is the only way its `reason` is
        // ever reached, and therefore the only honest way to drive it.
        op: 'revokeMember',
        field: 'reason',
        names: 'payload.reason',
        prepare: () => {
          const anchor = ensureFounded(ctx);
          const request = requestEnrollment({ anchor, keyRoot });
          if (!request.ok) throw new Error('the joining request could not be made');
          const joined = enrollFromRequest(ctx, { request: request.request });
          if (!joined.ok) throw new Error(`the second key did not join: ${joined.code}`);
          secondKey = joined.fingerprint;
        },
        drive: () => revokeMember(ctx, { fingerprint: secondKey, reason: '' }),
      },
    ];
  }

  it('refuses every one of them with a code, naming the field', () => {
    for (const probe of cases()) {
      const where = `${probe.op}(${probe.field})`;
      probe.prepare?.();
      const result = probe.drive();
      expect(result.ok, where).toBe(false);
      if (result.ok) continue;
      // A CODE, not a throw: this is an ordinary bad argument, and an agent has to
      // be able to read it and retry. A throw from inside the engine reaches an
      // agent as an SDK error, which the series already recorded as worse.
      expect(result.code, where).toBe('UNREADABLE_EVENT');
      // The reader's own words, so the caller knows WHICH argument to fix.
      expect(result.message, where).toContain(probe.names);
      expect(result.message, where).toContain('The fact was NOT recorded');
    }
  });

  it('appends nothing on any of them, and the record stays readable throughout', () => {
    // Driven in ONE chain, in order, checking after each that the count did not
    // move. The count comes from a full replay, so it is two assertions in one: the
    // refusal was free, AND every line already there still parses. A single
    // unreadable entry would make this throw rather than report a number.
    expect(eventCount()).toBeGreaterThan(0); // the founding, so the replay is not empty
    for (const probe of cases()) {
      probe.prepare?.();
      // Measured AFTER the setup and BEFORE the refusable call, so the number this
      // compares is the refusal's own cost and nothing else.
      const before = eventCount();
      const result = probe.drive();
      expect(result.ok, `${probe.op}(${probe.field})`).toBe(false);
      expect(eventCount(), `${probe.op}(${probe.field}) appended something`).toBe(before);
    }
  });

  it('leaves a virgin tree founded and otherwise empty, and says so', () => {
    // The one thing this door does NOT match about the size limit, pinned rather
    // than left to be rediscovered. A write founds this installation's anchor before
    // it builds its fact, so on a tree nobody had ever written to a refusal leaves
    // exactly one event: the founding. It is readable, it verifies, and the next
    // successful write would have needed it anyway — which is why the refusal says
    // THE FACT was not recorded and not "nothing was".
    const virgin = mkdtempSync(join(tmpdir(), 'mnema-virgin-'));
    try {
      const fresh: WriteContext = {
        writer: openChainForWriting(virgin, { keyRoot: virgin }),
        layout: { root: virgin },
        upcasters,
      };
      expect(orderedEvents(fresh.layout, upcasters).length).toBe(0);

      const refused = createTask(fresh, { title: '' });
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.message).toContain('The fact was NOT recorded');

      const events = orderedEvents(fresh.layout, upcasters);
      expect(events.map((event) => event.kind)).toEqual(['identity.founded']);
    } finally {
      rmSync(virgin, { recursive: true, force: true });
    }
  });

  /**
   * The half that cannot be driven: every function the writing surface exports is
   * either swept above, or declared here with the reason it is not.
   *
   * Without this the sweep is a list, and a list is what nobody remembers to extend
   * — the exact failure mode the content door's own history records. With it, a new
   * export that appends and takes text has to be classified, and classifying it
   * wrongly is a lie somebody has to write down.
   */
  const APPENDS_NOTHING: Readonly<Record<string, string>> = {
    authorizingAnchor: 'reads which anchor this installation serves; appends nothing',
    decideAnchor: 'settles the same question without writing',
    decodeKeyRequest: 'parses a request line',
    encodeKeyRequest: 'serializes one',
    openTreeForWriting: 'opens a writer; the write is the caller’s',
    requestEnrollment: 'produces a request and may mint a key, but appends no event',
    restoreKey: 'installs key material and records an anchor; appends no event',
  };

  const NO_EMPTY_REACHES_A_FIELD: Readonly<Record<string, string>> = {
    // Every transition: `to` and `action` come from the gate's closed table, `from`
    // from the projection, and an empty proof field is dropped by the builder as
    // absence — the same reading the parser gives it — so none can arrive empty.
    transitionTask: 'gate-supplied states; empty proof fields are dropped as absence',
    acceptDecision: 'gate-supplied states; empty proof fields are dropped as absence',
    rejectDecision: 'gate-supplied states; empty proof fields are dropped as absence',
    supersedeDecision: 'gate-supplied states; empty proof fields are dropped as absence',
    reviewSkill: 'gate-supplied states; empty proof fields are dropped as absence',
    adoptSkill: 'gate-supplied states; empty proof fields are dropped as absence',
    rejectSkill: 'gate-supplied states; empty proof fields are dropped as absence',
    deprecateSkill: 'gate-supplied states; empty proof fields are dropped as absence',
    // The identity family: every field is derived from a key or from a decoded
    // request, and there is no argument a caller could empty.
    ensureFounded: 'the founding is derived entirely from the local key',
    establishIdentity: 'enrolls what the key root registered; a refusal is reported as declined',
    enrollFromRequest: 'the fingerprint is computed and the signature is rejected as absent first',
  };

  it('classifies every function the writing surface exports', () => {
    const exported = Object.entries(writeSurface)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    const swept = new Set(cases().map((probe) => probe.op));
    const classified = new Set([
      ...swept,
      ...Object.keys(APPENDS_NOTHING),
      ...Object.keys(NO_EMPTY_REACHES_A_FIELD),
    ]);

    // Non-vacuity in both directions: nothing exported is unclassified, and nothing
    // classified has stopped being exported (a stale entry would quietly shrink the
    // sweep's reach without failing anything).
    expect([...classified].sort()).toEqual(exported);
    expect(swept.size).toBeGreaterThan(0);
    for (const name of swept) {
      expect(APPENDS_NOTHING[name], `${name} is both swept and declared unwritten`).toBeUndefined();
      expect(
        NO_EMPTY_REACHES_A_FIELD[name],
        `${name} is both swept and declared safe`,
      ).toBeUndefined();
    }
  });
});
