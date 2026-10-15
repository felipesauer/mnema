/**
 * THE SECOND READER SAYS ONCE WHAT A REFUSED FOUNDING LEAVES UNJUDGED, AND NOTHING ELSE CHANGES.
 *
 * A line the second reader cannot read is refused where it stands, and the record with it. The
 * folds of section 6.2 (and 6.4, 6.7) then read every line the reader COULD read, so what the
 * refused line held is missing from them, and a cause they name may be that line's consequence.
 * For one line the consequence is certain, and that line alone is treated otherwise:
 *
 *   - THE FOUNDING. A tail's first line refused before any entry of it was read (a byte-order mark
 *     an editor put in front of the file), the tail's key (section 3: a tail id begins with its
 *     fingerprint) founded by no line the reader did read: that line is the one place the
 *     `identity.founded` enrolling the identity's FIRST key can stand. Every event that key signed
 *     for its own anchor was read as "not a key enrolled" - one cause per event, none of them in
 *     the record. They are now said ONCE, as not judged, with how many and why; no `ok`, no note
 *     the reading before did not give, and a cause any other key's event earns stands as it did.
 *
 *   - ANY OTHER REFUSED LINE: as before. The causes are the fold's over the lines it read, the
 *     refused line's consequences among them; a forged event above the line, or one a citation
 *     across tails places before an enrolment, is still named.
 *
 * THE PRODUCT DOES OTHERWISE, and that is said rather than mended here: its reader leaves the
 * whole tail out of the folds once one line of it does not read, so the list of causes the two
 * readers give for such a record can differ. The verdict cannot: both refuse it.
 *
 * THE PROPERTY holds both halves over drawn records - every `mutate.py` record, and records of
 * two tails, a person's and an agent's, with citations across them - with a line that is not an
 * entry put at, or put in place of, any line of any tail. Its oracle is the same record WITHOUT
 * that line and without the damaged tail's checkpoints (so the fold reads the same entries under
 * the same coverage) and with no refused line at all, so no handling of a refused line can bend
 * it: the folds of the damaged record give exactly the oracle's findings, but for the causes of a
 * refused founding, which leave and come back as the one line that counts them.
 *
 * It needs `python3` and fails rather than skips without it, as its siblings do.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import {
  agentEnrolled,
  agentEnrollmentMessage,
  identityFounded,
  taskCreated,
} from '../events/build.js';
import { canonicalStringify } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import { serializeCheckpoint, signCheckpoint } from './checkpoint.js';
import { entryHash, writtenAsBuilt } from './hash.js';
import { deriveAnchor, generateKeyPair, type KeyPair, publicKeyToPem, sign } from './keys.js';
import { checkpointsPath, publicKeyPath, segmentPath, tailDir, tailProofPath } from './layout.js';
import { serializeTailProof, signTailProof } from './tailproof.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const VERIFIER_DIR = fileURLToPath(new URL('../../verifier/', import.meta.url));
const MUTATE = fileURLToPath(new URL('../../verifier/mutate.py', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./__fixtures__/witnessed-record', import.meta.url));
const SEED = Number(process.env.FC_SEED ?? 20_261_007);
const CASE_TIMEOUT = 120_000;

/** What a line that is not an entry reads as, and what both readers refuse it with. */
const JUNK = 'this line is not an entry';
const JUNK_REFUSED = 'not JSON: Expecting value: line 1 column 1 (char 0)';
const BOM = '﻿';
const BOM_REFUSED =
  'not JSON: Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)';

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

function fresh(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mnema-refused-founding-'));
  scratch.push(dir);
  return dir;
}

interface Finding {
  readonly level: string;
  readonly section: string;
  readonly what: string;
  readonly where: string;
}

const said = (finding: Finding) => `${finding.section} ${finding.where}: ${finding.what}`;

/** The second reader's verdict, its causes, what it did not judge, and what it said in favour. */
function secondReading(record: string) {
  const run = python([VERIFIER, '--json', 'record', record]);
  if (run.stdout === '') throw new Error(`the second reader said nothing: ${run.stderr}`);
  const { verdict, findings } = JSON.parse(run.stdout) as {
    verdict: string;
    findings: Finding[];
  };
  return {
    verdict,
    fails: findings.filter((f) => f.level === 'FAIL').map(said),
    notJudged: findings
      .filter((f) => f.level === 'UNCHECKED' && f.section.startsWith('6.'))
      .map(said),
    // What the fold of section 6.2 says in a record's favour, or of a citation it did not hold.
    inFavour: findings
      .filter(
        (f) =>
          f.section === '6.2' &&
          (f.level === 'ok' || (f.level === 'note' && /attested by|does not hold/.test(f.what))),
      )
      .map(said),
  };
}

/** The frozen record, copied, with one `mutate.py` mutation applied to the copy. */
function mutated(mutation: string): string {
  const record = join(fresh(), 'record');
  cpSync(FIXTURE, record, { recursive: true });
  if (mutation !== '') {
    const run = python([MUTATE, mutation, record]);
    const out = JSON.parse(run.stdout) as { applied: boolean };
    expect(out.applied, `${mutation} did not apply: ${run.stdout}`).toBe(true);
  }
  return record;
}

/** The tails of a record that hold a segment, and the first segment of one. */
function tailsWithSegments(record: string): string[] {
  return readdirSync(join(record, 'tails'))
    .sort()
    .filter((t) => readdirSync(join(record, 'tails', t)).some((n) => /^\d{6}\.jsonl$/.test(n)));
}

function firstSegment(record: string, tail: string): string {
  const name = readdirSync(join(record, 'tails', tail))
    .filter((n) => /^\d{6}\.jsonl$/.test(n))
    .sort()[0];
  if (name === undefined) throw new Error(`the tail ${tail} has no segment`);
  return join(record, 'tails', tail, name);
}

function linesOf(segment: string): string[] {
  const lines = readFileSync(segment, 'utf-8').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Put the line that is not an entry so that it is line `line` (1-based) of the segment. */
function putJunk(segment: string, line: number): void {
  const lines = linesOf(segment);
  lines.splice(line - 1, 0, JUNK);
  writeFileSync(segment, `${lines.join('\n')}\n`);
}

const TAIL =
  '7e5a72fd0ea237237651690087e4a87133dab8b78847efadde778f633214cca4-05e27e636158e547a09e594545603717';
const TAIL_SHORT = '7e5a72fd0ea237237651...';

/** The one line a refused founding gives, as the reader words it. */
const NOT_JUDGED = (count: number, key: string) =>
  `${count} event(s) signed by ${key.slice(0, 12)}... for its own anchor were not judged`;

describe('a refused founding: what its key signed for its own anchor is said once, as not judged', () => {
  it('gives the byte-order mark one cause, and one line for the three events it leaves unjudged', () => {
    // The reading before named four: the line, and the three events after it, each "signed by a
    // key not valid" - causes the record does not contain.
    const reading = secondReading(mutated('byte-order-mark-before-the-first-line'));
    expect(reading.verdict).toBe('REFUSED');
    expect(reading.fails).toEqual([`1 000001.jsonl:1: ${BOM_REFUSED}`]);
    expect(reading.notJudged).toEqual([
      `6.2 ${TAIL}: ${NOT_JUDGED(3, TAIL)}: the first line of its tail, 000001.jsonl:1, was ` +
        'refused above, and no line this reader read founds that anchor, so the refused line is ' +
        'where the founding stands and whether the key was valid for its anchor rests on it',
    ]);
    // Nothing in the record's favour the reading before did not say: no "every event is signed
    // by a key valid for its anchor", no event attested by an agent key.
    expect(reading.inFavour).toEqual([]);
  });
});

describe('a person and the agent they enrolled', () => {
  const at = (n: number): string =>
    new Date(Date.UTC(2026, 6, 21) + Math.round(n * 1000)).toISOString();

  function commitPublicKey(root: string, kp: KeyPair): void {
    mkdirSync(join(root, 'keys'), { recursive: true });
    writeFileSync(publicKeyPath({ root }, kp.fingerprint), publicKeyToPem(kp.publicKey));
  }

  /** The hash each event of a tail gets, in order. */
  function hashesOf(tailId: string, events: readonly CatalogEvent[]): string[] {
    const hashes: string[] = [];
    let prev: string | null = null;
    for (let seq = 0; seq < events.length; seq += 1) {
      const event = events[seq] as CatalogEvent;
      prev = entryHash({ event: writtenAsBuilt(event), tail: tailId, seq, prev });
      hashes.push(prev);
    }
    return hashes;
  }

  /** One tail, chained, with its birth proof and a checkpoint over every event. */
  function writeTail(
    root: string,
    tailId: string,
    events: readonly CatalogEvent[],
    signer: KeyPair,
  ) {
    mkdirSync(tailDir({ root }, tailId), { recursive: true });
    const hashes = hashesOf(tailId, events);
    const lines = events.map((event, seq) => {
      const prev: string | null = seq === 0 ? null : (hashes[seq - 1] as string);
      const hash = hashes[seq] as string;
      return canonicalStringify({ event: event as never, link: { tail: tailId, seq, prev, hash } });
    });
    writeFileSync(segmentPath({ root }, tailId, 1), `${lines.join('\n')}\n`);
    writeFileSync(
      tailProofPath({ root }, tailId),
      `${serializeTailProof(signTailProof(tailId, signer))}\n`,
    );
    const cp = signCheckpoint({
      tail: tailId,
      fromSeq: 0,
      events: events.map(writtenAsBuilt),
      prev: null,
      keyPair: signer,
    });
    appendFileSync(checkpointsPath({ root }, tailId), `${serializeCheckpoint(cp)}\n`);
  }

  /**
   * What a drawn record is made of. The person's tail: the founding at second 1, then one task per
   * entry of `person` at the second it gives, the `agent.enrolled` in place of the task at
   * `enrolAt` (if any) and citing the agent's entry `cites` (if any). The agent's tail: one task
   * per second of `agent`, signed by the agent for the person. `foreign`: one task the person's
   * key signs for the AGENT's anchor, which no founding ever makes valid.
   */
  interface Shape {
    readonly person: readonly number[];
    readonly enrolAt: number | null;
    readonly cites: number | null;
    readonly agent: readonly number[];
    readonly foreign: boolean;
  }

  function personAndAgent(shape: Shape) {
    const root = join(fresh(), 'record');
    const a = generateKeyPair();
    const g = generateKeyPair();
    commitPublicKey(root, a);
    commitPublicKey(root, g);
    const anchor = deriveAnchor(a.fingerprint);
    const personTail = `${a.fingerprint}-i1`;
    const agentTail = `${g.fingerprint}-i2`;
    const agent = shape.agent.map((n, i) =>
      taskCreated(
        { at: at(n), who: anchor, signerFp: g.fingerprint, subject: `g-${i}`, which: 'claude' },
        { title: `g-${i}` },
      ),
    );
    const agentHashes = hashesOf(agentTail, agent);
    const consent = Buffer.from(
      sign(agentEnrollmentMessage(anchor, g.fingerprint, 'claude'), g.privateKey),
    ).toString('hex');
    const person: CatalogEvent[] = [
      identityFounded(
        { at: at(1), who: anchor, signerFp: a.fingerprint, subject: anchor },
        { foundingFp: a.fingerprint },
      ),
    ];
    shape.person.forEach((n, i) => {
      const base = { at: at(n), who: anchor, signerFp: a.fingerprint, subject: anchor };
      const cited = shape.cites === null ? undefined : agentHashes[shape.cites];
      person.push(
        i === shape.enrolAt
          ? agentEnrolled(cited === undefined ? base : { ...base, after: [cited] }, {
              agentFp: g.fingerprint,
              name: 'claude',
              reverseSig: consent,
            })
          : taskCreated({ ...base, subject: `p-${i}` }, { title: `p-${i}` }),
      );
    });
    if (shape.foreign) {
      person.push(
        taskCreated(
          {
            at: at(shape.person.length + 2),
            who: deriveAnchor(g.fingerprint),
            signerFp: a.fingerprint,
            subject: 'for-another-anchor',
          },
          { title: 'for another anchor' },
        ),
      );
    }
    writeTail(root, personTail, person, a);
    writeTail(root, agentTail, agent, g);
    return { root, personTail, agentTail, a, g };
  }

  it('leaves the agent unenrolled and its events named, and a foreign anchor named, when the person’s founding is refused', () => {
    // The founding key signed the enrolment, three tasks and one event for an anchor it would
    // not have founded. The first four are not judged; the fifth is a cause no founding of this
    // identity removes, and so is each of the agent's: its enrolment was not judged, so the agent
    // is enrolled by nothing this reader read - as the reading before said.
    const { root, personTail, a, g } = personAndAgent({
      person: [2, 3, 4, 5],
      enrolAt: 1,
      cites: null,
      agent: [20, 21],
      foreign: true,
    });
    const segment = segmentPath({ root }, personTail, 1);
    writeFileSync(segment, BOM + readFileSync(segment, 'utf-8'));

    const reading = secondReading(root);
    expect(reading.verdict).toBe('REFUSED');
    const agentShort = `${g.fingerprint.slice(0, 20)}...`;
    const notEnrolled = (fp: string, anchor: string) =>
      `the signer ${fp.slice(0, 12)}... is not a key enrolled for ${anchor.slice(0, 20)}... at this point`;
    // In the merged order: the foreign event (second 6) before the agent's (20, 21).
    expect(reading.fails).toEqual([
      `1 000001.jsonl:1: ${BOM_REFUSED}`,
      `6.2 ${a.fingerprint.slice(0, 20)}... seq 5: ${notEnrolled(a.fingerprint, deriveAnchor(g.fingerprint))}`,
      `6.2 ${agentShort} seq 0: ${notEnrolled(g.fingerprint, deriveAnchor(a.fingerprint))}`,
      `6.2 ${agentShort} seq 1: ${notEnrolled(g.fingerprint, deriveAnchor(a.fingerprint))}`,
    ]);
    expect(reading.notJudged).toHaveLength(1);
    expect(reading.notJudged[0]).toContain(`6.2 ${personTail}: ${NOT_JUDGED(4, a.fingerprint)}`);
    expect(reading.inFavour).toEqual([]);
  });

  it('still names the agent’s events a citation places before their enrolment, above a refused line', () => {
    // The enrolment (the person's tail) cites the agent's third entry, which stands after the
    // refused line of the agent's tail. Read with every line, the citation places the agent's
    // first two events, and the cited one, before the enrolment: three causes, named as the
    // reading before named them, with nothing said in the record's favour.
    const { root, agentTail, g } = personAndAgent({
      person: [6],
      enrolAt: 0,
      cites: 2,
      agent: [10, 11, 5, 12],
      foreign: false,
    });
    putJunk(segmentPath({ root }, agentTail, 1), 3);

    const reading = secondReading(root);
    expect(reading.verdict).toBe('REFUSED');
    const agentShort = `${g.fingerprint.slice(0, 20)}...`;
    expect(reading.fails.map((f) => f.slice(0, f.indexOf(':')))).toEqual([
      '1 000001.jsonl',
      `6.2 ${agentShort} seq 0`,
      `6.2 ${agentShort} seq 1`,
      `6.2 ${agentShort} seq 2`,
    ]);
    expect(reading.fails[0]).toBe(`1 000001.jsonl:3: ${JUNK_REFUSED}`);
    expect(reading.notJudged).toEqual([]);
    expect(reading.inFavour.filter((s) => !s.includes('attested'))).toEqual([]);
  });

  it('keeps the agent enrolled whether its enrolment is above or below a refused line in the person’s tail', () => {
    for (const junkAt of [8, 4]) {
      const { root, personTail } = personAndAgent({
        person: [2, 3, 4, 5, 6, 7, 8, 9],
        enrolAt: 4,
        cites: null,
        agent: [20, 21, 22, 23],
        foreign: false,
      });
      putJunk(segmentPath({ root }, personTail, 1), junkAt);
      const reading = secondReading(root);
      expect(reading.verdict).toBe('REFUSED');
      expect(reading.fails).toEqual([`1 000001.jsonl:${junkAt}: ${JUNK_REFUSED}`]);
      expect(reading.notJudged).toEqual([]);
    }
  });

  /**
   * The reading the property holds the second reader to: the damaged record and its oracle, the
   * same record without the damaging line and without the damaged tail's checkpoints, read in one
   * process. Each finding of the folds (sections 6.2, 6.4, 6.7), and the verdict.
   */
  const BOTH = `
import json, sys
sys.path.insert(0, ${JSON.stringify(VERIFIER_DIR)})
from mnemaverify import record
from mnemaverify.verdict import Report

def read(root):
    report = Report()
    record.verify_record(root, report)
    folds = sorted(f"{f.level.value} {f.section} {f.where}: {f.what}" for f in report.findings if f.section in ("6.2", "6.4", "6.7"))
    refused = any(f.level.value == "FAIL" and f.section == "1" for f in report.findings)
    return {"verdict": report.verdict, "folds": folds, "refused": refused}

print(json.dumps({"damaged": read(sys.argv[1]), "oracle": read(sys.argv[2])}))
`;

  /** Every event a record's segments hold, by the place a 6.2 finding names it. */
  function eventsByPlace(root: string): Map<string, Record<string, unknown>> {
    const byPlace = new Map<string, Record<string, unknown>>();
    for (const tail of tailsWithSegments(root)) {
      for (const name of readdirSync(join(root, 'tails', tail)).filter((n) =>
        /^\d{6}\.jsonl$/.test(n),
      )) {
        for (const line of linesOf(join(root, 'tails', tail, name))) {
          try {
            const { event, link } = JSON.parse(line) as {
              event: Record<string, unknown>;
              link: { seq: number };
            };
            byPlace.set(`${tail.slice(0, 20)}... seq ${link.seq}`, event);
          } catch {
            // A line that is not an entry names no event.
          }
        }
      }
    }
    return byPlace;
  }

  /** A record to damage: one `mutate.py` builds, or a person and their agent. */
  const aRecord = fc.oneof(
    fc
      .constantFrom(...(JSON.parse(python([MUTATE, 'list']).stdout) as string[]))
      .map((mutation) => ({ mutation })),
    fc
      .record({
        person: fc.array(fc.integer({ min: 2, max: 30 }), { minLength: 1, maxLength: 6 }),
        enrolAt: fc.option(fc.nat({ max: 5 })),
        cites: fc.option(fc.nat({ max: 3 })),
        agent: fc.array(fc.integer({ min: 1, max: 30 }), { minLength: 1, maxLength: 4 }),
        foreign: fc.boolean(),
      })
      .map((shape) => ({ shape })),
  );

  it(
    'the property: a line put at or in place of any line of any tail moves only what a refused founding accounts for',
    () => {
      let foundings = 0;
      let keptWithARefusedLine = 0;
      let citedTailDamaged = 0;
      fc.assert(
        fc.property(
          aRecord,
          fc.nat(),
          fc.oneof(fc.constant(0), fc.nat()),
          fc.boolean(),
          (drawn, whichTail, whichLine, inPlace) => {
            const root =
              'mutation' in drawn
                ? mutated(drawn.mutation)
                : personAndAgent({
                    ...drawn.shape,
                    enrolAt:
                      drawn.shape.enrolAt === null
                        ? null
                        : drawn.shape.enrolAt % drawn.shape.person.length,
                    cites:
                      drawn.shape.cites === null
                        ? null
                        : drawn.shape.cites % drawn.shape.agent.length,
                  }).root;
            const tails = tailsWithSegments(root);
            if (tails.length === 0) return;
            const tail = tails[whichTail % tails.length] as string;

            // The oracle: the same record without the line, and without the damaged tail's
            // checkpoints, so its fold reads the same entries under the same coverage.
            const oracle = join(fresh(), 'oracle');
            cpSync(root, oracle, { recursive: true });
            const segment = firstSegment(root, tail);
            const lines = linesOf(segment);
            const line = 1 + (whichLine % (inPlace ? lines.length : lines.length + 1));
            if (inPlace) {
              const kept = linesOf(firstSegment(oracle, tail));
              kept.splice(line - 1, 1);
              writeFileSync(
                firstSegment(oracle, tail),
                kept.length === 0 ? '' : `${kept.join('\n')}\n`,
              );
              lines.splice(line - 1, 1, JUNK);
              writeFileSync(segment, `${lines.join('\n')}\n`);
            } else {
              putJunk(segment, line);
            }
            const checkpoints = join(oracle, 'tails', tail, 'checkpoints.jsonl');
            if (existsSync(checkpoints)) rmSync(checkpoints);

            const run = python(['-c', BOTH, root, oracle]);
            if (run.status !== 0) throw new Error(`${JSON.stringify(drawn)}: ${run.stderr}`);
            const { damaged, oracle: expected } = JSON.parse(run.stdout) as Record<
              'damaged' | 'oracle',
              { verdict: string; folds: string[]; refused: boolean }
            >;
            // An oracle that holds a refused line of its own is not one: the mutation refused a
            // line already, and the two readings differ by more than the line put here.
            if (expected.refused) return;
            expect(damaged.refused).toBe(true);
            expect(damaged.verdict).toBe('REFUSED');

            // What a refused founding accounts for, from the record and the format alone: the line
            // put in place of the tail's FIRST line, the tail's key (section 3) founded by no line
            // that reads, and, of the oracle's causes, those of an event that key signed for its
            // own anchor refused because the key is not valid there.
            const events = eventsByPlace(oracle);
            const key = tail.split('-')[0] as string;
            const anchor = deriveAnchor(key);
            const founded = [...events.values()].some(
              (e) =>
                e.kind === 'identity.founded' &&
                (e.subject === anchor ||
                  (e.payload as { foundingFp?: unknown }).foundingFp === key),
            );
            const accounted =
              inPlace && line === 1 && !founded
                ? expected.folds.filter((finding) => {
                    const place = /^FAIL 6\.2 (\S+\.\.\. seq \d+): (.*)$/.exec(finding);
                    if (place === null) return false;
                    const event = events.get(place[1] as string);
                    return (
                      event !== undefined &&
                      event.signerFp === key &&
                      event.who === anchor &&
                      /signed by a key not valid for|is not a key enrolled for/.test(
                        place[2] as string,
                      )
                    );
                  })
                : [];

            const notJudged = damaged.folds.filter((f) =>
              f.includes('for its own anchor were not judged'),
            );
            expect(notJudged, JSON.stringify(drawn)).toEqual(
              accounted.length === 0
                ? []
                : [
                    expect.stringContaining(
                      `UNCHECKED 6.2 ${tail}: ${NOT_JUDGED(accounted.length, key)}`,
                    ),
                  ],
            );
            // Every other finding of the folds is the oracle's, one for one: no cause dropped or
            // invented, no `ok`, note or "not checked" it did not give.
            expect(
              damaged.folds.filter((f) => !notJudged.includes(f)),
              JSON.stringify(drawn),
            ).toEqual(expected.folds.filter((f) => !accounted.includes(f)));

            if (accounted.length > 0) foundings += 1;
            else if (expected.folds.some((f) => f.startsWith('FAIL 6.2')))
              keptWithARefusedLine += 1;
            if (
              'shape' in drawn &&
              drawn.shape.enrolAt !== null &&
              drawn.shape.cites !== null &&
              tail.endsWith('-i2')
            ) {
              citedTailDamaged += 1;
            }
          },
        ),
        { seed: SEED, numRuns: 120 },
      );
      // The draw reached both halves - a refused founding, and a refused line whose causes stand -
      // and a damaged tail another tail's enrolment cites. A property that met none holds over
      // nothing.
      expect(foundings).toBeGreaterThan(0);
      expect(keptWithARefusedLine).toBeGreaterThan(0);
      expect(citedTailDamaged).toBeGreaterThan(0);
    },
    CASE_TIMEOUT,
  );
});

describe('records with no refused founding read as they did', () => {
  it('names the unenrolled signer of the last event when the line after it is refused', () => {
    const record = mutated('appended-event-by-an-unenrolled-key');
    const segment = firstSegment(record, TAIL);
    const count = linesOf(segment).length;
    putJunk(segment, count + 1);

    const reading = secondReading(record);
    expect(reading.verdict).toBe('REFUSED');
    expect(reading.fails).toEqual([
      `1 000001.jsonl:${count + 1}: ${JUNK_REFUSED}`,
      `6.2 ${TAIL_SHORT} seq 4: the signer 06e3fd8fda29... is not a key enrolled for mnid:e55891571921e7b... at this point`,
    ]);
    expect(reading.notJudged).toEqual([]);
  });

  it('names an edited event as it did, with nothing said of the folds', () => {
    const reading = secondReading(mutated('edited-event'));
    expect(reading.fails).toEqual([
      '3 000001.jsonl:3: the entry hash is 301aaca13c42f7e2..., and the line stores c9b5d6610efcc729...',
      '5 checkpoints.jsonl:2 cp[2..2]: the content root does not match under either reading of the ' +
        'accumulator. The root folds over the event CONTENT, so this is what an edited event looks ' +
        'like even after every hash in the chain has been repaired',
    ]);
    expect(reading.notJudged).toEqual([]);
  });

  it('names a checkpoint signed by another key as it did, with nothing said of the folds', () => {
    const reading = secondReading(mutated('checkpoint-other-key'));
    expect(reading.fails).toEqual([
      '6 checkpoints.jsonl:1 cp[0..1]: the Ed25519 signature does not verify under the key whose ' +
        'material hashes to 6bc98177967e...',
      '6 checkpoints.jsonl:2 cp[2..2]: prev is 797d1de8cd3eb8c8944a7b308f75ef04567de73702bd49742769e749c9770709, ' +
        "and the previous checkpoint's signed message hashes to " +
        '37b345b5d2b4720ddd001f317a6532fb029e9789778f80ecb533454132e5028d. Dropping an earlier ' +
        'checkpoint while keeping a later one breaks this link, which is what it is for',
    ]);
    expect(reading.notJudged).toEqual([]);
  });
});
