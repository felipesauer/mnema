/**
 * THE SECOND READER FOLDS A TAIL UP TO ITS FIRST REFUSED LINE, AND NO FURTHER.
 *
 * A line the second reader cannot read is refused where it stands, and the record with it. What
 * the folds of sections 6.2, 6.4 and 6.7 then read is the question here, because a fold is
 * where one missing line turns into causes the record does not contain:
 *
 *   - read PAST the refused line, the fold judges every later event by what that line would have
 *     said: a founding line that does not parse leaves each event after it "signed by a key not
 *     valid for its anchor", one false cause per event;
 *   - read NONE of the tail, the fold loses what the tail said BEFORE the refused line: a forged
 *     event above it is no longer named, and an agent enrolled above it is no longer enrolled, so
 *     every event that agent signed in its own tail is refused as signed by a key nobody enrolled.
 *
 * So the folds read each tail up to its first refused line, the reader says once per tail that
 * the rest was not folded, and a cause of section 6.2 is named only when the fold finds it read
 * past the refused line too: one it finds only without the lines after it rests on what it did
 * not read, and is said as not checked. None of this moves a verdict - the refused line has
 * already refused the record - and all of it moves the list of causes, which is what a reader of
 * a refused record reads next.
 *
 * THE PRODUCT DOES OTHERWISE, and that is said rather than mended here: its reader leaves the
 * whole tail out of the folds once one line of it does not read, so the list of causes the two
 * readers give for such a record can differ. The verdict cannot: both refuse it.
 *
 * THE PROPERTY is the one that holds for all of it: for any record `mutate.py` builds, with a
 * line that is not an entry put anywhere in any tail, this reader names no cause the reading
 * that folds every readable line does not name, and drops none that reading names before the
 * first refused line. That reading is this reader with the cut taken out, run in the same
 * process; it is what the reader did before the cut existed.
 *
 * It needs `python3` and fails rather than skips without it, as its siblings do.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
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
  const dir = mkdtempSync(join(tmpdir(), 'mnema-fold-refused-'));
  scratch.push(dir);
  return dir;
}

interface Finding {
  readonly level: string;
  readonly section: string;
  readonly what: string;
  readonly where: string;
}

/** The second reader's verdict, its causes, and what it said the folds did not read. */
function secondReading(record: string) {
  const run = python([VERIFIER, '--json', 'record', record]);
  if (run.stdout === '') throw new Error(`the second reader said nothing: ${run.stderr}`);
  const { verdict, findings } = JSON.parse(run.stdout) as {
    verdict: string;
    findings: Finding[];
  };
  const said = (finding: Finding) => `${finding.section} ${finding.where}: ${finding.what}`;
  return {
    verdict,
    fails: findings.filter((f) => f.level === 'FAIL').map(said),
    notFolded: findings
      .filter((f) => f.level === 'UNCHECKED' && f.section.startsWith('6.'))
      .map(said),
  };
}

/** The frozen record, copied, with one `mutate.py` mutation applied to the copy. */
function mutated(mutation: string): string {
  const record = join(fresh(), 'record');
  cpSync(FIXTURE, record, { recursive: true });
  if (mutation !== '') {
    const run = python([MUTATE, mutation, record]);
    const said = JSON.parse(run.stdout) as { applied: boolean };
    expect(said.applied, `${mutation} did not apply: ${run.stdout}`).toBe(true);
  }
  return record;
}

/** The tails of a record, and the first segment of one. */
function tailsOf(record: string): string[] {
  return readdirSync(join(record, 'tails')).sort();
}

function firstSegment(record: string, tail: string): string {
  const name = readdirSync(join(record, 'tails', tail))
    .filter((n) => /^\d{6}\.jsonl$/.test(n))
    .sort()[0];
  if (name === undefined) throw new Error(`the tail ${tail} has no segment`);
  return join(record, 'tails', tail, name);
}

/** Put the line that is not an entry so that it is line `line` (1-based) of the segment. */
function putJunk(segment: string, line: number): void {
  const lines = readFileSync(segment, 'utf-8').split('\n');
  const terminated = lines[lines.length - 1] === '';
  if (terminated) lines.pop();
  lines.splice(line - 1, 0, JUNK);
  writeFileSync(segment, `${lines.join('\n')}\n`);
}

const TAIL =
  '7e5a72fd0ea237237651690087e4a87133dab8b78847efadde778f633214cca4-05e27e636158e547a09e594545603717';
const TAIL_SHORT = '7e5a72fd0ea237237651...';

describe('a forged event above a refused line is still named', () => {
  it('names the unenrolled signer of the last event when the line after it is refused', () => {
    // What the reading before the cut existed names, measured on the same bytes: the refused line
    // and the forged event. A fold that left the whole tail out lost the second.
    const record = mutated('appended-event-by-an-unenrolled-key');
    const segment = firstSegment(record, TAIL);
    const lines = readFileSync(segment, 'utf-8').split('\n').length - 1;
    putJunk(segment, lines + 1);

    const reading = secondReading(record);
    expect(reading.verdict).toBe('REFUSED');
    expect(reading.fails).toEqual([
      `1 000001.jsonl:${lines + 1}: ${JUNK_REFUSED}`,
      `6.2 ${TAIL_SHORT} seq 4: the signer 06e3fd8fda29... is not a key enrolled for mnid:e55891571921e7b... at this point`,
    ]);
    // Nothing came after the refused line, so nothing went unfolded and nothing is said of it.
    expect(reading.notFolded).toEqual([]);
  });
});

describe('a refused line at the head of a tail, and records with no refused line', () => {
  it('gives the byte-order mark one cause, and says once that the rest of the tail was not folded', () => {
    const reading = secondReading(mutated('byte-order-mark-before-the-first-line'));
    expect(reading.verdict).toBe('REFUSED');
    expect(reading.fails).toEqual([
      '1 000001.jsonl:1: not JSON: Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)',
    ]);
    expect(reading.notFolded).toEqual([
      `6.2 ${TAIL}: the folds of sections 6.2, 6.4 and 6.7 read this tail up to 000001.jsonl:1, ` +
        'which was refused above, and not the 3 entries after it: a fold read past a line this ' +
        'reader could not read would judge each of them by what that line would have said',
    ]);
  });

  it('names an edited event as it did, with nothing said of the folds', () => {
    const reading = secondReading(mutated('edited-event'));
    expect(reading.fails).toEqual([
      '3 000001.jsonl:3: the entry hash is 301aaca13c42f7e2..., and the line stores c9b5d6610efcc729...',
      '5 checkpoints.jsonl:2 cp[2..2]: the content root does not match under either reading of the ' +
        'accumulator. The root folds over the event CONTENT, so this is what an edited event looks ' +
        'like even after every hash in the chain has been repaired',
    ]);
    expect(reading.notFolded).toEqual([]);
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
    expect(reading.notFolded).toEqual([]);
  });
});

describe('a person and the agent they enrolled, with a refused line in the person’s tail', () => {
  const at = (n: number): string => `2026-07-21T00:00:${String(n).padStart(2, '0')}.000Z`;

  function commitPublicKey(root: string, kp: KeyPair): void {
    mkdirSync(join(root, 'keys'), { recursive: true });
    writeFileSync(publicKeyPath({ root }, kp.fingerprint), publicKeyToPem(kp.publicKey));
  }

  /** One tail, chained, with its birth proof and a checkpoint over every event. */
  function writeTail(
    root: string,
    tailId: string,
    events: readonly CatalogEvent[],
    signer: KeyPair,
  ) {
    mkdirSync(tailDir({ root }, tailId), { recursive: true });
    const lines: string[] = [];
    let prev: string | null = null;
    for (let seq = 0; seq < events.length; seq += 1) {
      const event = events[seq] as CatalogEvent;
      const hash = entryHash({ event: writtenAsBuilt(event), tail: tailId, seq, prev });
      lines.push(
        canonicalStringify({ event: event as never, link: { tail: tailId, seq, prev, hash } }),
      );
      prev = hash;
    }
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
   * The person's tail: the founding, then eight events, the `agent.enrolled` at line `enrolAt`;
   * the agent's tail: four tasks it signed for the person. A line that is not an entry is then
   * put at line `junkAt` of the person's tail.
   */
  function personAndAgent(enrolAt: number, junkAt: number) {
    const root = join(fresh(), 'record');
    const a = generateKeyPair();
    const g = generateKeyPair();
    commitPublicKey(root, a);
    commitPublicKey(root, g);
    const anchor = deriveAnchor(a.fingerprint);
    const consent = Buffer.from(
      sign(agentEnrollmentMessage(anchor, g.fingerprint, 'claude'), g.privateKey),
    ).toString('hex');
    const person: CatalogEvent[] = [
      identityFounded(
        { at: at(1), who: anchor, signerFp: a.fingerprint, subject: anchor },
        { foundingFp: a.fingerprint },
      ),
    ];
    for (let line = 2; line <= 9; line += 1) {
      const base = { at: at(line), who: anchor, signerFp: a.fingerprint, subject: anchor };
      person.push(
        line === enrolAt
          ? agentEnrolled(base, { agentFp: g.fingerprint, name: 'claude', reverseSig: consent })
          : taskCreated({ ...base, subject: `p-${line}` }, { title: `p-${line}` }),
      );
    }
    const agent = [20, 21, 22, 23].map((n) =>
      taskCreated(
        { at: at(n), who: anchor, signerFp: g.fingerprint, subject: `g-${n}`, which: 'claude' },
        { title: `g-${n}` },
      ),
    );
    const personTail = `${a.fingerprint}-i1`;
    writeTail(root, personTail, person, a);
    writeTail(root, `${g.fingerprint}-i2`, agent, g);
    if (junkAt > 0) putJunk(segmentPath({ root }, personTail, 1), junkAt);
    return { root, personTail };
  }

  it('is verified without the refused line, so what follows is the refused line alone', () => {
    const { root } = personAndAgent(6, 0);
    const reading = secondReading(root);
    expect(reading.verdict).toBe('VERIFIED');
    expect(reading.fails).toEqual([]);
  });

  it('keeps the agent enrolled when the enrolment is above the refused line', () => {
    // The enrolment is line 6 and the refused line is line 8: the agent's four events were
    // refused as signed by a key nobody enrolled when the fold left the person's tail out.
    const { root, personTail } = personAndAgent(6, 8);
    const reading = secondReading(root);
    expect(reading.verdict).toBe('REFUSED');
    expect(reading.fails).toEqual([`1 000001.jsonl:8: ${JUNK_REFUSED}`]);
    expect(reading.notFolded).toEqual([
      `6.2 ${personTail}: the folds of sections 6.2, 6.4 and 6.7 read this tail up to ` +
        '000001.jsonl:8, which was refused above, and not the 2 entries after it: a fold read ' +
        'past a line this reader could not read would judge each of them by what that line ' +
        'would have said',
    ]);
  });

  it('names no cause the record does not contain when the enrolment is below the refused line', () => {
    // The refused line is line 4 and the enrolment is line 7. Up to the refused line, the agent
    // was never enrolled and its four events read as signed by a key nobody enrolled; read past
    // it, the fold finds the enrolment. Which one is so rests on a line the fold did not read,
    // so the four are said as not checked rather than named as causes.
    const { root, personTail } = personAndAgent(6, 4);
    const reading = secondReading(root);
    expect(reading.verdict).toBe('REFUSED');
    expect(reading.fails).toEqual([`1 000001.jsonl:4: ${JUNK_REFUSED}`]);
    expect(reading.notFolded).toEqual([
      `6.2 ${personTail}: the folds of sections 6.2, 6.4 and 6.7 read this tail up to ` +
        '000001.jsonl:4, which was refused above, and not the 6 entries after it: a fold read ' +
        'past a line this reader could not read would judge each of them by what that line ' +
        'would have said',
      '6.2 : 4 event(s) the fold of section 6.2 refuses reading each tail only up to its first ' +
        'refused line are not refused: read past that line, the fold does not find the same ' +
        'cause, so what decides each is in an entry it did not fold',
    ]);
  });
});

/**
 * The reading this file holds the second reader to, run in one process beside the reader itself:
 * the same record read as the reader reads it, and read with the folds given every line it could
 * read - the reader before the cut. With the place of the tail's first refused line, so a cause
 * can be said to stand before it.
 */
const BOTH_READINGS = `
import json, os, sys
sys.path.insert(0, ${JSON.stringify(VERIFIER_DIR)})
from mnemaverify import record
from mnemaverify.entry import read_line
from mnemaverify.verdict import Refusal, Report

root, tail = sys.argv[1], sys.argv[2]

def fails(report):
    return sorted(f"{f.section} {f.where}: {f.what}" for f in report.findings if f.level.value == "FAIL")

head = Report()
record.verify_record(root, head)
if not hasattr(record, "_fold_up_to_refused"):
    raise SystemExit("the cut this reading takes out is not where it was")
record._fold_up_to_refused = lambda report, entries_by_tail, refused_by_tail: entries_by_tail
past = Report()
record.verify_record(root, past)

tail_dir = os.path.join(root, "tails", tail)
before = []
for name in sorted(n for n in os.listdir(tail_dir) if record.SEGMENT_NAME.match(n)):
    stopped = False
    for number, raw in record._lines(os.path.join(tail_dir, name)):
        try:
            before.append(read_line(raw, f"{name}:{number}").seq)
        except Refusal:
            stopped = True
            break
    if stopped:
        break
print(json.dumps({"head": fails(head), "past": fails(past), "before": before}))
`;

describe('the property: a refused line anywhere in any tail of any mutated record', () => {
  it(
    'names no cause the fold of every readable line does not, and keeps every one above the line',
    () => {
      const offered = JSON.parse(python([MUTATE, 'list']).stdout) as string[];
      const placeOf = /^(\S+)\.\.\. seq (\d+)$/;
      let keptAbove = 0;
      let droppedBelow = 0;
      fc.assert(
        fc.property(
          fc.constantFrom(...offered),
          fc.nat(),
          fc.nat(),
          (mutation, whichTail, whichLine) => {
            const record = mutated(mutation);
            const tails = tailsOf(record).filter((t) => {
              const names = readdirSync(join(record, 'tails', t));
              return names.some((n) => /^\d{6}\.jsonl$/.test(n));
            });
            if (tails.length === 0) return;
            const tail = tails[whichTail % tails.length] as string;
            const segment = firstSegment(record, tail);
            const lines = readFileSync(segment, 'utf-8').split('\n').length;
            putJunk(segment, 1 + (whichLine % lines));
            const run = python(['-c', BOTH_READINGS, record, tail]);
            if (run.status !== 0) throw new Error(`${mutation}: ${run.stderr}`);
            const { head, past, before } = JSON.parse(run.stdout) as {
              head: string[];
              past: string[];
              before: number[];
            };
            // No cause the reading past the refused line does not name.
            expect(
              head.filter((cause) => !past.includes(cause)),
              mutation,
            ).toEqual([]);
            // Every cause that reading names above the tail's first refused line, still named, and
            // every cause no fold names (a line, a checkpoint), untouched. A fold's cause in
            // ANOTHER tail may rest on what that tail's refused line hid, so only the first rule
            // holds it.
            for (const cause of past) {
              const where = cause.slice(cause.indexOf(' ') + 1, cause.indexOf(': '));
              const place = placeOf.exec(where);
              const above =
                place === null ||
                (tail.startsWith(place[1] as string) && before.includes(Number(place[2])));
              if (above) {
                expect(head, `${mutation}: ${cause}`).toContain(cause);
                if (place !== null) keptAbove += 1;
              } else if (!head.includes(cause)) {
                droppedBelow += 1;
              }
            }
          },
        ),
        { seed: SEED, numRuns: 60 },
      );
      // The draw reached both sides: a cause of the fold above the refused line, kept, and one
      // below it, left unfolded. A property that met neither would hold over nothing.
      expect(keptAbove).toBeGreaterThan(0);
      expect(droppedBelow).toBeGreaterThan(0);
    },
    CASE_TIMEOUT,
  );
});
