import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, LATEST_VERSION, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isMarker,
  MARKER,
  REASONS,
  REFERENCES,
  reasonRefusal,
  referenceRefusal,
  statesSomething,
  TITLES,
  titleRefusal,
  unfilledReference,
  unfilledTitle,
  unstatedReason,
} from './a-reason-states-something.js';
import { requestEnrollment } from './identity/handshake.js';
import { enrollFromRequest, revokeMember } from './identity/roster.js';
import {
  captureMemory,
  linkKnowledge,
  recordHandoff,
  recordObservation,
  retractNote,
} from './knowledge/operations.js';
import { orderedEvents } from './projections/order.js';
import { switchChannel } from './workflow/channel-operations.js';
import { decisionGate } from './workflow/decision-gate.js';
import {
  acceptDecision,
  recordDecision,
  supersedeDecision,
} from './workflow/decision-operations.js';
import { gate } from './workflow/gate.js';
import { ensureFounded, linkAccount } from './workflow/identity-operations.js';
import { createTask, transitionTask, type WriteContext } from './workflow/operations.js';
import { authorizeTailPrune } from './workflow/prune-operations.js';
import { startRun } from './workflow/session-operations.js';
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
    let note = '';
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
      {
        kind: 'note.retracted',
        site: 'reason',
        prepare: () => {
          const made = captureMemory(ctx, { content: 'a note to take back' });
          if (!made.ok) throw new Error('no memory');
          note = made.id;
        },
        drive: (said) => retractNote(ctx, { id: note, reason: said }),
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

/**
 * A TITLE THAT IS A MARKER IS REFUSED ON THE WAY IN, by the function that refuses one as a reason.
 *
 * What was wrong: `mnema decision record "<title>" "<rationale>"`, pasted from a recipe, recorded
 * a decision named `<title>` — the rule asked the marker question of the why alone.
 */
describe('the title, asked of one value', () => {
  it('refuses a marker and names the field and what goes in its place', () => {
    expect(titleRefusal('name', '<name>')?.message).toBe(
      'the name "<name>" is the marker a recipe prints where the words go, not the words: write the name in its place',
    );
    expect(titleRefusal('title', ' <title> ')).toBeDefined();
  });

  it('refuses a title of punctuation alone, as the reader of decision files refuses its heading', () => {
    // THIS CASE USED TO PASS `***`, on the premise that the reader refused it on its own
    // (`NO_TITLE`) and the door need not. The premise was the defect: `decision record '***'`
    // recorded a decision named `***`. The same function the reader asks now refuses it here.
    for (const said of ['***', '---', ' . ', '|', '* * *']) {
      expect(titleRefusal('title', said)?.message, said).toBe(
        `the title "${said.trim()}" has no letter and no digit in it, so it names nothing: write the title in words`,
      );
    }
  });

  it('passes a title in words, in any script, with a tag in it, or a single character', () => {
    for (const said of ['Use UTC', 'use <b> for bold', '理由', 'x', '42', '']) {
      expect(titleRefusal('title', said), said).toBeUndefined();
    }
  });
});

describe('every kind says where its title is, and the door asks it there', () => {
  let root: string;
  let ctx: WriteContext;
  const upcasters = catalogUpcasters();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnema-title-'));
    ctx = { writer: openChainForWriting(root, { keyRoot: root }), layout: { root }, upcasters };
    ensureFounded(ctx);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const count = (): number => orderedEvents(ctx.layout, upcasters).length;

  /** One row per (kind, site) {@link TITLES} lists, with the value put where the title goes. */
  const rows: readonly {
    readonly kind: string;
    readonly site: string;
    readonly drive: (said: string) => { readonly ok: boolean; readonly code?: string };
  }[] = [
    { kind: 'task.created', site: 'title', drive: (said) => createTask(ctx, { title: said }) },
    {
      kind: 'decision.recorded',
      site: 'title',
      drive: (said) => recordDecision(ctx, { title: said, rationale: 'one clock' }),
    },
    {
      kind: 'skill.created',
      site: 'name',
      drive: (said) => createSkill(ctx, { name: said, body: 'do it so' }),
    },
    {
      kind: 'observation.recorded',
      site: 'topic',
      drive: (said) =>
        recordObservation(ctx, {
          about: '0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44',
          topic: said,
          text: 'it was slow',
        }),
    },
  ];

  it('is total over the catalog, and every site listed has a row here', () => {
    expect(Object.keys(TITLES).sort()).toEqual(Object.keys(LATEST_VERSION).sort());
    const listed = Object.entries(TITLES).flatMap(([kind, sites]) =>
      (sites as readonly string[]).map((site) => `${kind} ${site}`),
    );
    expect(rows.map((row) => `${row.kind} ${row.site}`).sort()).toEqual(listed.sort());
  });

  for (const said of ['<title>', ' <name> ', '<t>', '<short title>']) {
    it(`refuses ${JSON.stringify(said)} at every site, and appends nothing`, () => {
      for (const row of rows) {
        const before = count();
        expect(row.drive(said), `${row.kind} ${row.site}`).toMatchObject({
          ok: false,
          code: 'NOT_A_TITLE',
        });
        expect(count(), `${row.kind} ${row.site}`).toBe(before);
      }
    });
  }

  for (const said of ['***', '---', ' | ']) {
    it(`refuses ${JSON.stringify(said)} (no word in it) at every site, and appends nothing`, () => {
      for (const row of rows) {
        const before = count();
        expect(row.drive(said), `${row.kind} ${row.site}`).toMatchObject({
          ok: false,
          code: 'NOT_A_TITLE',
        });
        expect(count(), `${row.kind} ${row.site}`).toBe(before);
      }
    });
  }

  it('and records the same row with a title in words, so the refusal is about the marker', () => {
    for (const row of rows) {
      expect(row.drive('clocks in UTC'), `${row.kind} ${row.site}`).toMatchObject({ ok: true });
    }
  });

  it('asks the title before the why, so a fact with both unfilled names the title first', () => {
    const refused = recordDecision(ctx, { title: '<title>', rationale: '<why>' });
    expect(refused).toMatchObject({ ok: false, code: 'NOT_A_TITLE' });
    expect(
      unfilledTitle({
        kind: 'decision.recorded',
        payload: { title: '<title>', rationale: 'r', adr: 'ADR-1' },
      } as never),
    ).toContain('the title "<title>"');
  });
});

/**
 * A MARKER IS NO REFERENCE EITHER: the strings a later reading looks a fact up by.
 *
 * What was wrong: `mnema link <id> <path> --rel governs`, pasted without filling the markers in,
 * recorded an edge from the entity `<id>`; `--rel '<rel>'` recorded a relation nothing can ask
 * for. The same paste, in the fields neither a title nor a why.
 */
describe('a reference, asked of one value', () => {
  it('refuses a marker and names the field and what goes in its place', () => {
    expect(referenceRefusal('target', '<path>')?.message).toBe(
      'the target "<path>" is the marker a recipe prints where the value goes, not the value: write the target in its place',
    );
    expect(referenceRefusal('rel', ' <rel> ')).toBeDefined();
  });

  it('asks only the marker: a path, a glob, a name with a tag in it, or punctuation passes', () => {
    // A reference is a string its owner chose (`src/**`, `a/<b>/c`, `***` as a glob): what it
    // holds is not a judgment this door makes. Only the blank a recipe leaves is refused.
    for (const said of ['src/**', 'a/<b>/c', 'use <b> for bold', '***', '', 'governs']) {
      expect(referenceRefusal('target', said), said).toBeUndefined();
    }
  });
});

describe('every kind says where its references are, and the door asks it there', () => {
  let root: string;
  let ctx: WriteContext;
  const upcasters = catalogUpcasters();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnema-reference-'));
    ctx = { writer: openChainForWriting(root, { keyRoot: root }), layout: { root }, upcasters };
    ensureFounded(ctx);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const count = (): number => orderedEvents(ctx.layout, upcasters).length;
  const ID = '0198f3c1-7a2e-7b41-9c05-3d8e6f2a1b44';

  /**
   * One row per (kind, site) {@link REFERENCES} lists that a write operation of this package
   * reaches, with the value put where the reference goes and every other field in words.
   */
  const rows: readonly {
    readonly kind: string;
    readonly site: string;
    readonly drive: (said: string) => { readonly ok: boolean; readonly code?: string };
  }[] = [
    { kind: 'run.started', site: 'agent', drive: (said) => startRun(ctx, { agent: said }) },
    {
      kind: 'observation.recorded',
      site: 'about',
      drive: (said) => recordObservation(ctx, { about: said, topic: 'clocks', text: 'slow' }),
    },
    {
      kind: 'handoff.recorded',
      site: 'subject',
      drive: (said) => recordHandoff(ctx, { task: said, fromAgent: 'a', toAgent: 'b' }),
    },
    {
      kind: 'handoff.recorded',
      site: 'fromAgent',
      drive: (said) => recordHandoff(ctx, { task: ID, fromAgent: said, toAgent: 'b' }),
    },
    {
      kind: 'handoff.recorded',
      site: 'toAgent',
      drive: (said) => recordHandoff(ctx, { task: ID, fromAgent: 'a', toAgent: said }),
    },
    {
      kind: 'knowledge.linked',
      site: 'subject',
      drive: (said) => linkKnowledge(ctx, { subject: said, target: 'src/a.ts', rel: 'governs' }),
    },
    {
      kind: 'knowledge.linked',
      site: 'target',
      drive: (said) => linkKnowledge(ctx, { subject: ID, target: said, rel: 'governs' }),
    },
    {
      kind: 'knowledge.linked',
      site: 'rel',
      drive: (said) => linkKnowledge(ctx, { subject: ID, target: 'src/a.ts', rel: said }),
    },
    {
      kind: 'channel.switched',
      site: 'subject',
      drive: (said) => switchChannel(ctx, { channel: said, on: true }),
    },
    {
      kind: 'account.linked',
      site: 'account',
      drive: (said) => linkAccount(ctx, { account: said }),
    },
  ];

  /** The sites with no write operation in this package to drive: the door's function is asked directly. */
  const SERVED_BY_THE_SURFACE = [
    'skill.consulted subject',
    'channel.served subject',
    'channel.asked subject',
    'channel.refused subject',
  ];

  it('is total over the catalog, and every site listed has a row here or is served by the surface', () => {
    expect(Object.keys(REFERENCES).sort()).toEqual(Object.keys(LATEST_VERSION).sort());
    const listed = Object.entries(REFERENCES).flatMap(([kind, sites]) =>
      (sites as readonly string[]).map((site) => `${kind} ${site}`),
    );
    expect(
      [...rows.map((row) => `${row.kind} ${row.site}`), ...SERVED_BY_THE_SURFACE].sort(),
    ).toEqual(listed.sort());
  });

  for (const said of ['<id>', ' <path> ', '<rel>', '<agent>']) {
    it(`refuses ${JSON.stringify(said)} at every site, and appends nothing`, () => {
      for (const row of rows) {
        const before = count();
        expect(row.drive(said), `${row.kind} ${row.site}`).toMatchObject({
          ok: false,
          code: 'NOT_A_REFERENCE',
        });
        expect(count(), `${row.kind} ${row.site}`).toBe(before);
      }
    });
  }

  it('asks the sites no operation here reaches, on the event itself', () => {
    for (const kind of [
      'skill.consulted',
      'channel.served',
      'channel.asked',
      'channel.refused',
    ] as const) {
      expect(
        unfilledReference({ kind, subject: '<channel>', payload: {} } as never),
        kind,
      ).toContain('the subject "<channel>" is the marker');
      expect(
        unfilledReference({ kind, subject: 'coach', payload: {} } as never),
        kind,
      ).toBeUndefined();
    }
  });

  it('records the same rows with a value in place, so the refusal is about the marker', () => {
    expect(
      linkKnowledge(ctx, { subject: ID, target: 'src/<id>/x.ts', rel: 'governs' }),
    ).toMatchObject({
      ok: true,
    });
    expect(recordObservation(ctx, { about: ID, topic: 'clocks', text: 'slow' })).toMatchObject({
      ok: true,
    });
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
    const refusal = gate({ from: 'READY', action: 'start', fields: { note: '***' }, who: 'w' });
    if (refusal.ok) throw new Error('the door accepted a note that states nothing');
    expect(
      unstatedReason({
        v: 1,
        kind: 'task.transitioned',
        subject: 't',
        who: 'w',
        signerFp: 'f'.repeat(64),
        at: '2026-01-01T00:00:00.000Z',
        payload: { from: 'READY', to: 'IN_PROGRESS', action: 'start', fields: { note: '***' } },
      }),
    ).toBe(refusal.message);
  });
});
