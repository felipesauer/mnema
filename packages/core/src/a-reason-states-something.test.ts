import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, LATEST_VERSION, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isMarker,
  MARKER,
  REASONS,
  reasonRefusal,
  statesSomething,
  unstatedReason,
} from './a-reason-states-something.js';
import { requestEnrollment } from './identity/handshake.js';
import { enrollFromRequest, revokeMember } from './identity/roster.js';
import { orderedEvents } from './projections/order.js';
import { switchChannel } from './workflow/channel-operations.js';
import { decisionGate } from './workflow/decision-gate.js';
import {
  acceptDecision,
  recordDecision,
  supersedeDecision,
} from './workflow/decision-operations.js';
import { gate } from './workflow/gate.js';
import { ensureFounded } from './workflow/identity-operations.js';
import { createTask, transitionTask, type WriteContext } from './workflow/operations.js';
import { authorizeTailPrune } from './workflow/prune-operations.js';
import { skillGate } from './workflow/skill-gate.js';
import { createSkill, reviewSkill } from './workflow/skill-operations.js';

/**
 * A REASON THAT SAYS NOTHING IS REFUSED ON THE WAY IN, by the rule the reader of decision files
 * already applied on the way out.
 *
 * What was wrong: `mnema decision "Use UTC" "***"` recorded `***` as a decision's why, for good,
 * while the reader refused `---` from a file; and `--reason "<why>"`, pasted from a recipe the
 * product prints without the marker filled in, recorded `<why>` as a revocation's reason. The
 * empty string was already refused (the chain's own rule); what says nothing but is not empty was
 * not.
 */

/** What says nothing: punctuation alone, whitespace alone, and the markers recipes print. */
const SAYS_NOTHING = ['***', '---', ' . ', '|', '<why>', ' <why> ', '<the line>'] as const;

describe('the rule, asked of one value', () => {
  it('passes a reason in words, in any script, however short', () => {
    for (const said of ['n/a', 'UTC', '42', 'porque sim', '理由', 'use <b> for bold']) {
      expect(reasonRefusal('reason', said), said).toBeUndefined();
    }
  });

  it('refuses punctuation alone and names what it lacks', () => {
    expect(reasonRefusal('rationale', '***')?.message).toBe(
      'the rationale "***" has no letter and no digit in it, so it says nothing: write the why in words',
    );
  });

  it('refuses a marker and says it is one', () => {
    expect(reasonRefusal('reason', '<why>')?.message).toBe(
      'the reason "<why>" is the marker a recipe prints where the words go, not the words: write the why in its place',
    );
  });

  it('leaves the empty string and a non-string to the chain’s own rule', () => {
    // Absent and empty already have a door (UNREADABLE_EVENT, or the gate's MISSING_PROOF);
    // answering them here too would be a second reading of the same question.
    expect(reasonRefusal('reason', '')).toBeUndefined();
    expect(reasonRefusal('reason', undefined)).toBeUndefined();
  });

  it('is a marker only when the WHOLE value is one', () => {
    expect(isMarker('<why>')).toBe(true);
    expect(isMarker('<path...>')).toBe(true);
    expect(isMarker('because <why>')).toBe(false);
    expect(isMarker('<b>bold</b>')).toBe(false);
    expect(statesSomething('---')).toBe(false);
  });
});

describe('the marker is the pattern the product fills its own recipes by', () => {
  it('is the one the guard over every command handed over fills markers by', () => {
    // That guard fills every marker a page or a sentence prints before it parses the line, so a
    // marker a new recipe prints is one this door already refuses — as long as both read one
    // pattern. The guard lives in another package's tests, where a value of this package cannot
    // be imported without being exported to every caller (`every-public-value-has-a-caller`), so
    // the two are reconciled here, by their source.
    const guard = readFileSync(
      new URL('../../code/tests/the-command-handed-over-runs-as-handed.test.ts', import.meta.url),
      'utf8',
    );
    const declared = /const MARKER = \/(.+)\/g;/.exec(guard);
    expect(declared, 'the guard no longer declares its marker pattern').not.toBeNull();
    expect(declared?.[1]).toBe(MARKER.source);
    expect(MARKER.flags).toBe('');
  });
});

describe('every kind says where its why is, and the door asks it there', () => {
  let root: string;
  let keyRoot: string;
  let ctx: WriteContext;
  const upcasters = catalogUpcasters();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnema-reason-'));
    keyRoot = mkdtempSync(join(tmpdir(), 'mnema-reason-key-'));
    ctx = { writer: openChainForWriting(root, { keyRoot: root }), layout: { root }, upcasters };
    ensureFounded(ctx);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(keyRoot, { recursive: true, force: true });
  });

  const count = (): number => orderedEvents(ctx.layout, upcasters).length;

  /**
   * One row per (kind, site) the table lists: how to reach it from an operation, with the value
   * put where the why goes. `prepare` writes what the site can only be reached over, outside the
   * count.
   */
  interface Row {
    readonly kind: string;
    readonly site: string;
    readonly prepare?: () => void;
    readonly drive: (said: string) => { readonly ok: boolean; readonly code?: string };
  }

  function rows(): readonly Row[] {
    let task = '';
    let decision = '';
    let successor = '';
    let skill = '';
    let secondKey = '';
    let foreignTail = '';
    return [
      {
        kind: 'decision.recorded',
        site: 'rationale',
        drive: (said) => recordDecision(ctx, { title: 'Use UTC', rationale: said }),
      },
      {
        kind: 'decision.recorded',
        site: 'alternatives',
        drive: (said) =>
          recordDecision(ctx, { title: 'Use UTC', rationale: 'one clock', alternatives: said }),
      },
      ...(['reason', 'note', 'feedback'] as const).map((field) => ({
        kind: 'task.transitioned',
        site: `fields.${field}`,
        prepare: () => {
          const made = createTask(ctx, { title: 'a task' });
          if (!made.ok) throw new Error('no task');
          task = made.id;
        },
        // `submit` requires nothing, so the field is refused for saying nothing and not for
        // being required: an optional reason given is still a reason.
        drive: (said: string) =>
          transitionTask(ctx, { id: task, action: 'submit', fields: { [field]: said } }),
      })),
      {
        kind: 'decision.transitioned',
        site: 'fields.note',
        prepare: () => {
          const made = recordDecision(ctx, { title: 'd', rationale: 'r' });
          if (!made.ok) throw new Error('no decision');
          decision = made.id;
        },
        drive: (said) => acceptDecision(ctx, { id: decision, fields: { note: said } }),
      },
      {
        kind: 'decision.transitioned',
        site: 'fields.reason',
        prepare: () => {
          const old = recordDecision(ctx, { title: 'old', rationale: 'r' });
          const next = recordDecision(ctx, { title: 'new', rationale: 'r' });
          if (!old.ok || !next.ok) throw new Error('no decisions');
          decision = old.id;
          successor = next.id;
        },
        drive: (said) =>
          supersedeDecision(ctx, { id: decision, by: successor, fields: { reason: said } }),
      },
      {
        kind: 'skill.transitioned',
        site: 'fields.note',
        prepare: () => {
          const made = createSkill(ctx, { name: 'a pattern', body: 'do it so' });
          if (!made.ok) throw new Error('no skill');
          skill = made.id;
        },
        drive: (said) => reviewSkill(ctx, { id: skill, fields: { note: said } }),
      },
      {
        kind: 'key.revoked',
        site: 'reason',
        prepare: () => {
          const anchor = ensureFounded(ctx);
          const request = requestEnrollment({ anchor, keyRoot });
          if (!request.ok) throw new Error('the joining request could not be made');
          const joined = enrollFromRequest(ctx, { request: request.request });
          if (!joined.ok) throw new Error(`the second key did not join: ${joined.code}`);
          secondKey = joined.fingerprint;
        },
        drive: (said) => revokeMember(ctx, { fingerprint: secondKey, reason: said }),
      },
      {
        kind: 'tail.pruned',
        site: 'reason',
        prepare: () => {
          const machine = mkdtempSync(join(tmpdir(), 'mnema-reason-other-'));
          const other = openChainForWriting(machine, { keyRoot: machine });
          const did = createTask(
            { writer: other, layout: { root: machine }, upcasters },
            { title: 'work another machine did' },
          );
          if (!did.ok) throw new Error('the other machine wrote nothing to cut');
          other.checkpoint();
          for (const tail of readdirSync(join(machine, 'tails'))) {
            cpSync(join(machine, 'tails', tail), join(root, 'tails', tail), { recursive: true });
          }
          for (const key of readdirSync(join(machine, 'keys'))) {
            if (key.endsWith('.pub')) cpSync(join(machine, 'keys', key), join(root, 'keys', key));
          }
          rmSync(machine, { recursive: true, force: true });
          foreignTail = other.tail;
        },
        drive: (said) => authorizeTailPrune(ctx, { tail: foreignTail, reason: said }),
      },
      {
        kind: 'channel.switched',
        site: 'reason',
        drive: (said) =>
          switchChannel(ctx, { channel: 'edit-rules-push', on: false, reason: said }),
      },
    ];
  }

  it('is total over the catalog, and every site listed has a row here', () => {
    // The table is total by TYPE in src (a kind with no row does not compile); this is the other
    // direction — that every site it lists is one this sweep reaches, so a row nobody drives
    // cannot sit in the table as a claim.
    expect(Object.keys(REASONS).sort()).toEqual(Object.keys(LATEST_VERSION).sort());
    const listed = Object.entries(REASONS).flatMap(([kind, sites]) =>
      (sites as readonly string[]).flatMap((site) =>
        site === 'fields' ? [`${kind} fields`] : [`${kind} ${site}`],
      ),
    );
    const driven = [
      ...new Set(
        rows().map((row) => `${row.kind} ${row.site.startsWith('fields.') ? 'fields' : row.site}`),
      ),
    ];
    expect(driven.sort()).toEqual([...new Set(listed)].sort());
  });

  for (const said of SAYS_NOTHING) {
    it(`refuses ${JSON.stringify(said)} at every site, and appends nothing`, () => {
      for (const row of rows()) {
        row.prepare?.();
        const before = count();
        const result = row.drive(said);
        expect(result, `${row.kind} ${row.site}`).toMatchObject({
          ok: false,
          code: 'NOT_A_REASON',
        });
        expect(count(), `${row.kind} ${row.site}`).toBe(before);
      }
    });
  }

  it('and records the same row with a reason in words, so the refusal is about the words', () => {
    for (const row of rows()) {
      row.prepare?.();
      expect(row.drive('because the clocks disagree'), `${row.kind} ${row.site}`).toMatchObject({
        ok: true,
      });
    }
  });
});

describe('a dry run and the move it previews give one verdict', () => {
  it('is refused by each of the three gates, with the door’s code', () => {
    const who = 'a-person';
    expect(gate({ from: 'READY', action: 'start', fields: { note: '***' }, who })).toMatchObject({
      ok: false,
      code: 'NOT_A_REASON',
    });
    expect(
      decisionGate({
        from: 'proposed',
        action: 'accept',
        fields: { note: '<why>' },
        subject: 'd',
        who,
      }),
    ).toMatchObject({ ok: false, code: 'NOT_A_REASON' });
    expect(
      skillGate({ from: 'proposed', action: 'review', fields: { note: '---' }, who }),
    ).toMatchObject({ ok: false, code: 'NOT_A_REASON' });
  });

  it('asks the event the door asks, so neither can drift from the other', () => {
    expect(
      unstatedReason({
        v: 1,
        kind: 'task.transitioned',
        subject: 't',
        who: 'w',
        at: '2026-01-01T00:00:00.000Z',
        payload: { from: 'READY', to: 'IN_PROGRESS', action: 'start', fields: { note: '***' } },
      } as never),
    ).toBe(gate({ from: 'READY', action: 'start', fields: { note: '***' }, who: 'w' }).message);
  });
});
