/**
 * THE TWO READERS LEAVE THE SAME FACTS UNAPPLIED, AND NAME THEM ALIKE.
 *
 * Two rules of the format decide what a reader applies rather than what verifies, and a fact one
 * of them does not apply is named, informational, and is not a break. A move of a workflow is
 * judged at its point in the merged order against the table `event-schema.json` publishes
 * (FORMAT.md §6.7); a note or a link is taken back only by the identity that wrote it (§6.4). The
 * product names each in its census (`illegal-move` with its rule, `foreign-retraction`,
 * `foreign-link-retraction`); the second reader names each as a note, with the same rule, at the
 * same tail and seq. This file holds the two to the same list:
 *
 *   - one record per rule of §6.7, each written with the product's writer and its own keys, where
 *     the rule the move breaks comes from the section, and the second reader has to name what the
 *     product names, no more and no fewer;
 *   - two machines on one record, with and without the citations that say what each had read;
 *   - records drawn under the seed the other property files use: two tails, moves legal and not,
 *     births and runs, clocks that disagree and citations that come and go. Neither reader's
 *     answer is computed here; one is compared with the other, and the draw is held to reach every
 *     rule of the section and the legal moves too, so the agreement is not over one kind of case;
 *   - and the retractions of §6.4, by the identity that wrote the note or the link and by another.
 *
 * Every record here is honest in its bytes, so both readers verify it whatever it holds: a fact
 * a reader does not apply is not a break, in either.
 *
 * It needs `python3` and fails rather than skips without it, as its siblings do.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decisionTransitioned,
  identityFounded,
  knowledgeLinked,
  linkRetracted,
  memoryCaptured,
  noteRetracted,
  runEnded,
  runStarted,
  skillTransitioned,
  taskTransitioned,
} from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import { catalogUpcasters } from '../events/registry.js';
import { WORKFLOWS } from '../events/workflow.js';
import { openChainForWriting, verify } from './chain.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const SEED = Number(process.env.FC_SEED ?? 20_261_007);
const CASE_TIMEOUT = 120_000;

function python(args: readonly string[]) {
  const run = spawnSync('python3', args, { encoding: 'utf-8' });
  if (run.error !== undefined) {
    throw new Error(
      `python3 could not be run, and this suite requires it: ${run.error.message}. The second ` +
        'reader is standard library only; there is nothing to install.',
    );
  }
  return run;
}

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fresh(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** One fact not applied, as both readers say where it is and which rule it broke. */
interface Named {
  readonly tail: string;
  readonly seq: number;
  readonly rule: string;
}

function byPlace(a: Named, b: Named): number {
  if (a.tail !== b.tail) return a.tail < b.tail ? -1 : 1;
  return a.seq - b.seq;
}

/** What each reader says of `record`: its verdict, and the facts it does not apply. */
function bothReaders(record: string) {
  const here = verify(record, catalogUpcasters());
  const product = here.census
    .flatMap((note): Named[] => {
      if (note.kind === 'illegal-move')
        return [{ tail: note.tail, seq: note.seq, rule: note.rule }];
      if (note.kind === 'foreign-retraction' || note.kind === 'foreign-link-retraction') {
        return [{ tail: note.tail, seq: note.seq, rule: note.kind }];
      }
      return [];
    })
    .sort(byPlace);
  const run = python([VERIFIER, '--json', 'record', record]);
  const there = JSON.parse(run.stdout) as {
    verdict: string;
    findings: { level: string; section: string; what: string; where: string }[];
  };
  const second = there.findings
    .filter(
      (finding) =>
        (finding.section === '6.7' || finding.section === '6.4') && finding.level === 'note',
    )
    .map((finding) => {
      const rule = /\(rule ([a-z-]+)\)$/.exec(finding.what)?.[1];
      const place = /^(\S+) seq (\d+)$/.exec(finding.where);
      if (rule === undefined || place === null) {
        throw new Error(`a note with no rule or no place: ${JSON.stringify(finding)}`);
      }
      return { tail: place[1] as string, seq: Number(place[2]), rule };
    })
    .sort(byPlace);
  return {
    product,
    second,
    productOk: here.ok,
    secondVerdict: there.verdict,
    secondFails: there.findings.filter((finding) => finding.level === 'FAIL'),
  };
}

interface Envelope {
  at: string;
  who: string;
  signerFp: string;
  subject: string;
  after?: readonly string[];
}

/** A machine writing into `record`: its own key, its own tail, its identity founded first. */
function machine(record: string) {
  const writer = openChainForWriting(record, {
    keyRoot: fresh('mnema-moves-key-'),
    maxUnsignedEvents: 10_000,
  });
  let tick = 0;
  const env = (subject: string, after?: readonly string[], at?: number): Envelope => ({
    at: new Date(Date.UTC(2026, 9, 1) + (at ?? tick++) * 1000).toISOString(),
    who: writer.anchor,
    signerFp: writer.signerFingerprint,
    subject,
    ...(after === undefined ? {} : { after }),
  });
  writer.append(
    identityFounded(env(writer.anchor, undefined, -1), { foundingFp: writer.signerFingerprint }),
  );
  return { writer, env };
}

describe('one record per rule of §6.7: both readers name the same move, by the same rule', () => {
  type Step =
    | { kind: 'decision' | 'task'; payload: Parameters<typeof decisionTransitioned>[1] }
    | { kind: 'run.started' | 'run.ended' };
  const decision = (from: string | null, to: string, action: string, extra = {}): Step => ({
    kind: 'decision',
    payload: { from, to, action, ...extra },
  });
  const note = { fields: { note: 'n' } };
  const reason = { fields: { reason: 'r' } };
  const born = decision(null, 'proposed', 'create');

  const cases: readonly { name: string; steps: readonly Step[]; rules: readonly string[] }[] = [
    {
      name: 'a record that followed the workflow',
      steps: [born, decision('proposed', 'accepted', 'accept', note)],
      rules: [],
    },
    {
      name: 'rejected → accepted, which is no row',
      steps: [
        born,
        decision('proposed', 'rejected', 'reject', note),
        decision('rejected', 'accepted', 'accept', note),
      ],
      rules: ['not-in-the-table'],
    },
    {
      name: 'a state that is not one of the table',
      steps: [born, decision('proposed', 'banana', 'teleport', note)],
      rules: ['not-in-the-table'],
    },
    {
      name: 'an accept without the note it requires',
      steps: [born, decision('proposed', 'accepted', 'accept')],
      rules: ['proof-missing'],
    },
    {
      name: 'a supersede naming a decision the record holds no birth of',
      steps: [born, decision('proposed', 'superseded', 'supersede', { by: 'ghost', ...reason })],
      rules: ['successor'],
    },
    {
      name: 'a supersede naming its own subject',
      steps: [born, decision('proposed', 'superseded', 'supersede', { by: 'd-1', ...reason })],
      rules: ['successor'],
    },
    {
      name: 'an accept that names a successor',
      steps: [born, decision('proposed', 'accepted', 'accept', { by: 'd-1', ...note })],
      rules: ['successor'],
    },
    {
      name: 'a move out of a state its own tail had already left',
      steps: [
        born,
        decision('proposed', 'accepted', 'accept', note),
        decision('proposed', 'rejected', 'reject', note),
      ],
      rules: ['not-the-state-seen'],
    },
    { name: 'a second birth', steps: [born, born], rules: ['born-twice'] },
    {
      name: 'a birth into a state that is not the birth',
      steps: [decision(null, 'accepted', 'create')],
      rules: ['not-in-the-table'],
    },
    {
      name: 'a move of a task with no birth',
      steps: [{ kind: 'task', payload: { from: 'DRAFT', to: 'READY', action: 'submit' } }],
      rules: ['not-born'],
    },
    {
      name: 'a run ended twice',
      steps: [{ kind: 'run.started' }, { kind: 'run.ended' }, { kind: 'run.ended' }],
      rules: ['ended-twice'],
    },
    { name: 'a run ended with no start', steps: [{ kind: 'run.ended' }], rules: ['not-born'] },
  ];

  it.each(cases)(
    '$name',
    ({ steps, rules }) => {
      const record = fresh('mnema-moves-record-');
      const { writer, env } = machine(record);
      for (const step of steps) {
        if (step.kind === 'decision') writer.append(decisionTransitioned(env('d-1'), step.payload));
        else if (step.kind === 'task') writer.append(taskTransitioned(env('t-1'), step.payload));
        else if (step.kind === 'run.started') writer.append(runStarted(env('r-1'), { agent: 'a' }));
        else writer.append(runEnded(env('r-1')));
      }
      writer.checkpoint();
      const said = bothReaders(record);
      expect(
        said.product.map((one) => one.rule),
        'the product, against §6.7',
      ).toEqual(rules);
      expect(said.second, 'the second reader, against the product').toEqual(said.product);
      expect(said.productOk).toBe(true);
      expect(said.secondFails).toEqual([]);
      expect(said.secondVerdict).toBe('VERIFIED');
    },
    CASE_TIMEOUT,
  );
});

describe('two machines on one record: what each had read decides', () => {
  /** A decision born on A, accepted on B, and rejected on A — citing what each read, or not. */
  function twoMachines(cite: boolean) {
    const record = fresh('mnema-moves-record-');
    const a = machine(record);
    const b = machine(record);
    const birth = a.writer.append(
      decisionTransitioned(a.env('d-1', undefined, 10), {
        from: null,
        to: 'proposed',
        action: 'create',
      }),
    );
    const accept = b.writer.append(
      decisionTransitioned(b.env('d-1', cite ? [birth.link.hash] : undefined, 20), {
        from: 'proposed',
        to: 'accepted',
        action: 'accept',
        fields: { note: 'n' },
      }),
    );
    a.writer.append(
      decisionTransitioned(a.env('d-1', cite ? [accept.link.hash] : undefined, 30), {
        from: 'proposed',
        to: 'rejected',
        action: 'reject',
        fields: { note: 'n' },
      }),
    );
    a.writer.checkpoint();
    b.writer.checkpoint();
    return { record, a: a.writer.tail };
  }

  it(
    'without citations, the reject on A is a divergence, named by neither',
    () => {
      const said = bothReaders(twoMachines(false).record);
      expect(said.product).toEqual([]);
      expect(said.second).toEqual(said.product);
      expect(said.secondVerdict).toBe('VERIFIED');
    },
    CASE_TIMEOUT,
  );

  it(
    'with them, A had read the accept, and both name its reject',
    () => {
      const { record, a } = twoMachines(true);
      const said = bothReaders(record);
      expect(said.product).toEqual([{ tail: a, seq: 2, rule: 'not-the-state-seen' }]);
      expect(said.second).toEqual(said.product);
      expect(said.secondVerdict).toBe('VERIFIED');
    },
    CASE_TIMEOUT,
  );
});

// ---------------------------------------------------------------------------------------------
// Drawn records
// ---------------------------------------------------------------------------------------------

type Machine = 'a' | 'b';
type Workflow = 'decision' | 'task' | 'skill';

const TABLES = {
  decision: WORKFLOWS['decision.transitioned'],
  task: WORKFLOWS['task.transitioned'],
  skill: WORKFLOWS['skill.transitioned'],
} as const;

/**
 * One drawn step. A move is drawn as a row of its table out of the state its writer last wrote
 * or read of the subject, most of the time — so most moves are legal and two machines diverge —
 * and is bent the rest: out of a row picked blind, into a state the table does not hold, without
 * its proof, naming a successor it should not.
 */
type Drawn =
  | {
      readonly step: 'move';
      readonly on: Machine;
      readonly cite: boolean;
      readonly at: number;
      readonly what: Workflow;
      readonly subject: number;
      readonly row: number;
      readonly bend: number;
      readonly by: number;
    }
  | {
      readonly step: 'birth' | 'run.started' | 'run.ended';
      readonly on: Machine;
      readonly cite: boolean;
      readonly at: number;
      readonly what: Workflow;
      readonly subject: number;
    };

const placeArb = {
  on: fc.constantFrom<Machine>('a', 'b'),
  cite: fc.boolean(),
  at: fc.nat(60),
  what: fc.constantFrom<Workflow>('decision', 'task', 'skill'),
  subject: fc.nat(1),
};

const drawnArb: fc.Arbitrary<Drawn> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.record({
      step: fc.constant('move' as const),
      ...placeArb,
      row: fc.nat(11),
      bend: fc.nat(19),
      by: fc.nat(3),
    }),
  },
  { weight: 1, arbitrary: fc.record({ step: fc.constant('birth' as const), ...placeArb }) },
  {
    weight: 2,
    arbitrary: fc.record({
      step: fc.constantFrom('run.started' as const, 'run.ended' as const),
      ...placeArb,
    }),
  },
);

/** The draw, written: every subject born first on a machine drawn, then the steps. */
function writeDrawn(births: readonly Machine[], steps: readonly Drawn[]): string {
  const record = fresh('mnema-moves-drawn-');
  const machines = { a: machine(record), b: machine(record) };
  const heads: Partial<Record<Machine, string>> = {};
  // What each machine last wrote or read of a subject: only to draw a move it would make.
  const views: Record<Machine, Map<string, string>> = { a: new Map(), b: new Map() };
  const write = (
    on: Machine,
    cite: boolean,
    at: number | undefined,
    event: (e: Envelope) => CatalogEvent,
    subject: string,
    to?: string,
  ) => {
    const other: Machine = on === 'a' ? 'b' : 'a';
    const cited = cite ? heads[other] : undefined;
    if (cited !== undefined) for (const [s, state] of views[other]) views[on].set(s, state);
    const envelope = machines[on].env(subject, cited === undefined ? undefined : [cited], at);
    heads[on] = machines[on].writer.append(event(envelope)).link.hash;
    if (to !== undefined) views[on].set(subject, to);
  };
  const subjects = (['decision', 'task', 'skill'] as const).flatMap((what) =>
    [0, 1].map((n) => ({ what, n })),
  );
  subjects.forEach(({ what, n }, index) => {
    const on = births[index] ?? 'a';
    const table = TABLES[what];
    write(
      on,
      false,
      undefined,
      (e) => moveEvent(what, e, { from: null, to: table.birth.to, action: table.birth.action }),
      `${what}-${n}`,
      table.birth.to,
    );
  });
  for (const step of steps) {
    const subject = step.step.startsWith('run') ? 'run-0' : `${step.what}-${step.subject}`;
    if (step.step === 'run.started') {
      write(step.on, step.cite, step.at, (e) => runStarted(e, { agent: 'a' }), subject);
    } else if (step.step === 'run.ended') {
      write(step.on, step.cite, step.at, (e) => runEnded(e), subject);
    } else if (step.step === 'birth') {
      const table = TABLES[step.what];
      write(
        step.on,
        step.cite,
        step.at,
        (e) =>
          moveEvent(step.what, e, { from: null, to: table.birth.to, action: table.birth.action }),
        subject,
        table.birth.to,
      );
    } else if (step.step === 'move') {
      const table = TABLES[step.what];
      const state = views[step.on].get(subject);
      const fromHere = table.moves.filter((row) => row.from === state);
      const blind = step.bend === 0 || fromHere.length === 0;
      const row = (blind ? table.moves : fromHere)[
        step.row % (blind ? table.moves : fromHere).length
      ] as (typeof table.moves)[number];
      const to = step.bend === 1 ? 'banana' : row.to;
      const fields = step.bend === 2 ? undefined : { note: 'n', reason: 'r', feedback: 'f' };
      const by =
        'by' in row
          ? [
              `decision-${step.subject === 0 ? 1 : 0}`,
              `decision-${step.subject}`,
              'ghost',
              `decision-${step.subject === 0 ? 1 : 0}`,
            ][step.by]
          : step.bend === 3
            ? 'decision-0'
            : undefined;
      write(
        step.on,
        step.cite,
        step.at,
        (e) =>
          moveEvent(step.what, e, {
            from: row.from,
            to,
            action: row.action,
            ...(fields === undefined ? {} : { fields }),
            ...(by === undefined ? {} : { by }),
          }),
        subject,
        to,
      );
    }
  }
  machines.a.writer.checkpoint();
  machines.b.writer.checkpoint();
  return record;
}

function moveEvent(
  what: Workflow,
  envelope: Envelope,
  payload: Parameters<typeof decisionTransitioned>[1],
): CatalogEvent {
  if (what === 'decision') return decisionTransitioned(envelope, payload);
  const { by: _by, ...rest } = payload;
  return what === 'task' ? taskTransitioned(envelope, rest) : skillTransitioned(envelope, rest);
}

describe('drawn records on two machines, in both readers', () => {
  it(
    'name the same moves, by the same rule, at the same place — and the draw reaches every rule',
    () => {
      const reached = new Map<string, number>();
      let unnamed = 0;
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom<Machine>('a', 'b'), { minLength: 6, maxLength: 6 }),
          fc.array(drawnArb, { minLength: 1, maxLength: 30 }),
          (births, steps) => {
            const said = bothReaders(writeDrawn(births, steps));
            expect(said.second).toEqual(said.product);
            expect(said.productOk).toBe(true);
            expect(said.secondFails).toEqual([]);
            expect(said.secondVerdict).toBe('VERIFIED');
            for (const one of said.product) reached.set(one.rule, (reached.get(one.rule) ?? 0) + 1);
            unnamed += 6 + steps.length - said.product.length;
          },
        ),
        { seed: SEED, numRuns: 40 },
      );
      // Not the answer — the reach of the draw: a property that only ever met one rule, or
      // only illegal moves, would agree over a corner of the section.
      expect([...reached.keys()].sort()).toEqual([
        'born-twice',
        'ended-twice',
        'not-born',
        'not-in-the-table',
        'not-the-state-seen',
        'proof-missing',
        'successor',
      ]);
      expect(unnamed).toBeGreaterThan([...reached.values()].reduce((sum, n) => sum + n, 0));
    },
    CASE_TIMEOUT,
  );
});

describe('a note or a link taken back (§6.4): both readers name the same retraction not applied', () => {
  /** A note and a link written on A, each taken back by `by` — A itself, or B. */
  function takenBack(by: 'a' | 'b') {
    const record = fresh('mnema-retraction-record-');
    const machines = { a: machine(record), b: machine(record) };
    const a = machines.a;
    a.writer.append(memoryCaptured(a.env('m-1'), { content: 'the build needs node 24' }));
    a.writer.append(knowledgeLinked(a.env('x-1'), { target: 'x-2', rel: 'relates-to' }));
    const retractor = machines[by];
    retractor.writer.append(noteRetracted(retractor.env('m-1'), { reason: 'wrong' }));
    retractor.writer.append(
      linkRetracted(retractor.env('x-1'), { target: 'x-2', rel: 'relates-to', reason: 'wrong' }),
    );
    // Neither names a note or an edge the record holds: no author to compare with.
    retractor.writer.append(noteRetracted(retractor.env('m-9'), { reason: 'none' }));
    machines.a.writer.checkpoint();
    machines.b.writer.checkpoint();
    return { record, b: machines.b.writer.tail };
  }

  it(
    'by the identity that wrote them, names nothing',
    () => {
      const said = bothReaders(takenBack('a').record);
      expect(said.product).toEqual([]);
      expect(said.second).toEqual(said.product);
      expect(said.secondVerdict).toBe('VERIFIED');
    },
    CASE_TIMEOUT,
  );

  it(
    'by another identity, names both, and the note and the link still stand',
    () => {
      const { record, b } = takenBack('b');
      const said = bothReaders(record);
      expect(said.product).toEqual([
        { tail: b, seq: 1, rule: 'foreign-retraction' },
        { tail: b, seq: 2, rule: 'foreign-link-retraction' },
      ]);
      expect(said.second).toEqual(said.product);
      expect(said.productOk).toBe(true);
      expect(said.secondFails).toEqual([]);
      expect(said.secondVerdict).toBe('VERIFIED');
    },
    CASE_TIMEOUT,
  );
});
