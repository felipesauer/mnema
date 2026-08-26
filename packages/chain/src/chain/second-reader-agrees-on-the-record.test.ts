/**
 * TWO READERS, AND THEY HAVE TO AGREE — the case this delivery exists for.
 *
 * `FORMAT.md` says, in "What this document does not promise": *There is no second
 * implementation. Every digest here was produced by the one codebase this document
 * describes, and checked by tests that live in it.* This file is what makes that sentence
 * out of date. `packages/chain/verifier/` is a verifier in Python, written from the
 * document and from the published vectors, importing nothing of this product —
 * `second-reader-is-independent.test.ts` is the guard on that — and this file runs it
 * beside the product's own `verify` over the same bytes and requires the two to say the
 * same thing.
 *
 * WHY IT IS WORTH A SUITE AT ALL. The interoperability literature is blunt about it: a
 * self-compatible implementation proves very little. The CCSDS requires TWO independent
 * implementations completing end-to-end tests as a PRECONDITION for publishing a
 * standard. Certificate Transparency runs on several implementations checking each other.
 * What that buys is not redundancy — it is that assumptions which work inside one product
 * and are false outside it become visible. Twenty-five of them did; `python3
 * verifier/mnema_verify.py gaps` lists them, and one of them is a place where the two readers,
 * both faithful to the document, DATE THE SAME RECORD DIFFERENTLY.
 *
 * DISAGREEMENT IS RED, AND NAMES WHICH AXIS. Two readers that never compare are not two
 * readers, so every case here asserts a named axis of the verdict rather than a boolean:
 * the level, the witness status, the block, the instant, the remainder. A verdict that
 * moved on one axis fails on that axis's name.
 *
 * THE ASYMMETRY IS GONE, AND WHAT IT TOOK IS WORTH SAYING. This file used to declare two
 * places where the second reader ACCEPTED what the product refuses, both found by
 * constructing the input rather than by concluding from the silence of nine mutations that
 * both readers refused:
 *
 *   - ENROLMENT (gap G21). Section 6 asks that a signature verify under `signerFp`, and that
 *     was all this checked. The product also requires the signer to have been a key valid
 *     for its anchor at that point in the chain — a different claim, and the one that
 *     matters — which the document described nowhere. Section 6.2 is that rule, written.
 *   - A FORGED FIELD INSIDE A PAYLOAD, on an event appended above the last checkpoint (gap
 *     G08) — the one a party with NO KEY can walk through. The per-kind declarations were
 *     published nowhere, so the refusal section 4 promises could not be implemented from the
 *     document. Section 4.1 and `event-schema.json` publish them.
 *
 * AND THERE WAS A THIRD, IN THE OTHER DIRECTION, which nobody had gone looking for because
 * refusing too much LOOKS LIKE RIGOUR (gap G25). With no declarations published, the only
 * derivation of the envelope available to a stranger was the intersection of the vectors'
 * top-level keys — which section 7 stated as a fact — so the second reader REFUSED an honest
 * event carrying `which`, a field sixteen of the twenty-three published vectors carry. It is
 * the quieter failure of the two: an acceptance is found by building an attack, and an
 * over-refusal is found only by building an honest input, which is not where anybody looks.
 *
 * So every input `mutate.py` builds is now refused by BOTH readers, and the case that says
 * so is the count in `leaves exactly ONE row out of the refusal loop`.
 *
 * IT NEEDS `python3`, AND IT FAILS RATHER THAN SKIPS WITHOUT IT. A second reader nobody
 * runs is prose again, and a skipped case is a case nobody reads. Python 3 is on the runner
 * image this repository pins (`ubuntu-24.04` ships 3.12) and the verifier is standard library
 * only, on purpose: no wheel to install, and nothing that has to still resolve in ten years.
 *
 * SO `ci.yml` NEEDS NO STEP FOR IT, and deliberately has none. The dependency is declared
 * HERE, in the case below that runs `python3 --version` before anything else and fails with a
 * named reason if it is absent — which is a better place for it than a workflow step, because
 * it holds for `pnpm test` on a workstation too, and because a workflow step that installed a
 * second toolchain would be a second toolchain to keep current for no gain.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogUpcasters } from '../events/registry.js';
import { verify } from './chain.js';

/** The second reader, and the tool that builds the inputs it has to refuse. */
const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const MUTATE = fileURLToPath(new URL('../../verifier/mutate.py', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));

interface Finding {
  readonly level: string;
  readonly section: string;
  readonly what: string;
  readonly where: string;
  readonly gap: string;
}

interface SecondReading {
  readonly verdict: string;
  readonly findings: readonly Finding[];
  readonly notCovered: readonly { readonly section: string; readonly what: string }[];
  readonly gapsLeanedOn: readonly string[];
  readonly exit: number;
}

function python(args: readonly string[], stdin?: string) {
  const run = spawnSync('python3', args, { encoding: 'utf-8', input: stdin });
  if (run.error !== undefined) {
    throw new Error(
      `python3 could not be run, and this suite requires it: ${run.error.message}. The second ` +
        'reader is standard library only; there is nothing to install.',
    );
  }
  return run;
}

/** Run the second reader over a record and hand back its structured verdict. */
function secondReading(record: string): SecondReading {
  const run = python([VERIFIER, '--json', 'record', record]);
  if (run.stdout === '') {
    throw new Error(`the second reader produced no verdict. stderr: ${run.stderr}`);
  }
  return { ...(JSON.parse(run.stdout) as Omit<SecondReading, 'exit'>), exit: run.status ?? -1 };
}

function refusals(reading: SecondReading): readonly Finding[] {
  return reading.findings.filter((finding) => finding.level === 'FAIL');
}

/** Every note the second reader made, joined — where its section 8 sentence lives. */
function notes(reading: SecondReading): string {
  return reading.findings
    .filter((finding) => finding.level === 'note')
    .map((finding) => finding.what)
    .join('\n');
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-second-reader-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A copy of a frozen record, because neither reader may verify one in place. */
function copyOf(fixture: string): string {
  const record = join(root, fixture);
  cpSync(join(FIXTURES, fixture), record, { recursive: true });
  return record;
}

describe('the second reader can be run at all', () => {
  it('is a program python3 executes, and python3 is here', () => {
    // THE DEPENDENCY IS DECLARED HERE AND NOWHERE ELSE. This is the case that fails, by name,
    // on a machine or a runner without `python3` — rather than a workflow step, which would
    // only cover CI, or a skip, which would cover nothing.
    const version = python(['--version']);
    expect(
      version.status,
      'python3 is required by the second reader in packages/chain/verifier/ — it is standard ' +
        `library only, so there is nothing to install. python3 --version said: ${version.stderr}`,
    ).toBe(0);
    expect(version.stdout + version.stderr).toMatch(/Python 3\./);
  });

  it('checks itself against RFC 8032 and section 1 before it checks anything else', () => {
    const run = python([VERIFIER, '--json', 'self-test']);
    const report = JSON.parse(run.stdout) as SecondReading;
    expect(report.verdict, run.stdout).toBe('VERIFIED');
    expect(run.status).toBe(0);
    // NON-VACUITY. A self-test that ran nothing would also report no failure, so the
    // number of checks is asserted before the verdict is believed.
    expect(report.findings.filter((f) => f.level === 'ok').length).toBeGreaterThan(40);
  });

  it('reproduces the published vectors from the rules of the document', () => {
    const run = python([VERIFIER, '--json', 'vectors']);
    const report = JSON.parse(run.stdout) as SecondReading;
    expect(report.verdict, run.stdout).toBe('VERIFIED');
    expect(refusals(report)).toEqual([]);
    // The 23 rows and the four aggregates, named in the finding so a shrinking vector
    // set cannot pass quietly.
    const said = report.findings.map((f) => f.what).join('\n');
    expect(said).toMatch(/23 of 23 published vectors reproduce/);
    expect(said).toMatch(/the fold over an empty range reproduces/);
    expect(said).toMatch(/the entry hash of a genesis entry reproduces/);
    expect(said).toMatch(/the entry hash of a linked entry reproduces/);
    expect(said).toMatch(/the content root over all 23 vectors reproduces/);
  });
});

/**
 * What the two readers have to agree about, per frozen record, on named axes.
 *
 * `covered` here is the second reader's sentence for section 8, and it carries the block
 * and the instant, so the two readers are compared on the arithmetic and not on the
 * wording: the same block number and the same second, reached from the same 80 bytes.
 */
const RECORDS = [
  {
    fixture: 'witnessed-record',
    level: 'externally-witnessed',
    witness: 'covered',
    // The second reader takes the earliest attested block; the product takes the first one
    // proof traversal reaches. Both are valid attestations of the same checkpoint — see
    // `the two readers date it differently` below, and gap G23.
    block: 963688,
    instant: '2026-08-23T06:03:01',
    product: 963690,
    productInstant: '2026-08-23T06:23:18',
    remainder: 0,
  },
  {
    fixture: 'witnessed-then-written',
    level: 'fully-signed',
    witness: 'not-covered',
    // Here the two rules land on the same block, because the earliest attested block is
    // also the first one traversal reaches. The agreement is a coincidence of this file's
    // fork order, which is precisely why G23 is a gap and not a preference.
    block: 963937,
    instant: '2026-08-25T01:47:34',
    product: 963937,
    productInstant: '2026-08-25T01:47:34',
    remainder: 1,
  },
] as const;

describe.each(RECORDS)('both readers over $fixture', (record) => {
  it('agrees that nothing is broken', () => {
    const here = verify(copyOf(record.fixture), catalogUpcasters());
    const there = secondReading(copyOf(record.fixture));
    expect(here.issues, "the product's own reading").toEqual([]);
    expect(refusals(there), 'the second reader over the same bytes').toEqual([]);
    expect(here.level).toBe(record.level);
    expect(there.verdict).toBe('VERIFIED');
    expect(there.exit).toBe(0);
  });

  it('dates it from a block that really carries it, and to the second', () => {
    const here = verify(copyOf(record.fixture), catalogUpcasters());
    const there = secondReading(copyOf(record.fixture));
    // Each reader's sentence is its own words, so the comparison is on the numbers both
    // derived from an 80-byte header. WHICH of a checkpoint's attestations is reported is
    // where the two diverge (gap G23) — that divergence has its own case below, and the
    // block asserted here is the one THIS reader's rule picks.
    expect(here.summary, "the product's sentence").toContain(`Bitcoin block ${record.product}`);
    expect(notes(there), "the second reader's sentence").toContain(`bitcoin block ${record.block}`);
    expect(here.summary).toContain(record.productInstant);
    expect(notes(there)).toContain(record.instant);
  });

  it('agrees whether the attestation reaches the last event, and by how much it misses', () => {
    const here = verify(copyOf(record.fixture), catalogUpcasters());
    const there = secondReading(copyOf(record.fixture));
    expect(here.witness).toBe(record.witness);
    if (record.witness === 'covered') {
      expect(notes(there)).toMatch(/^covered: /m);
      expect(notes(there)).toContain('which is every event written');
    } else {
      expect(notes(there)).toMatch(/^not covered: /m);
      expect(notes(there)).toContain(`${record.remainder} event(s) were written after it`);
      expect(here.summary).toContain(`${record.remainder} event(s) written after it`);
    }
  });

  it('agrees the hash chain closes over the same number of entries', () => {
    const here = verify(copyOf(record.fixture), catalogUpcasters());
    const there = secondReading(copyOf(record.fixture));
    const events = here.tails.reduce((total, tail) => total + tail.entryCount, 0);
    expect(events).toBeGreaterThan(0);
    expect(
      there.findings.map((f) => f.what).join('\n'),
      'the second reader counted a different number of entries',
    ).toContain(`the hash chain closes over ${events} entries`);
  });
});

/**
 * THE REFUSALS, BY MUTATION — and the second reader's whole worth is here.
 *
 * A reader that says "verified" about everything agrees with the product on every honest
 * record and proves nothing at all, so each row below is an input the format refuses, and
 * BOTH readers have to refuse it. The inputs are built by `mutate.py`, which lives beside
 * the verifier rather than beside this file: a guard and the mutation that lights it are
 * one artifact, and anybody who doubts a refusal can produce the input that earns it.
 *
 * `refusals` is the count of named refusals the second reader raises, asserted so that a
 * mutation which stopped being caught cannot pass as "still refused" on the strength of a
 * different finding.
 *
 * `productIssue` is the layer the product files it under. `edited-event-chain-repaired` is
 * the row that matters most: the chain is repaired, so T1 passes in BOTH readers, and the
 * only thing left to catch it is the content root folded over CONTENT — the invariant
 * section 5 calls load-bearing, checked here for the first time by something that is not
 * this codebase.
 */
const MUTATIONS = [
  {
    name: 'edited-event',
    refusals: 2,
    section: '5',
    says: 'the content root does not match',
    productLayer: 'T1',
    productBreaks: 'ok',
  },
  {
    name: 'edited-event-chain-repaired',
    refusals: 1,
    section: '5',
    says: 'The root folds over the event CONTENT',
    productLayer: 'T2/T4',
    productBreaks: 'ok',
  },
  {
    name: 'forged-extra-field',
    refusals: 3,
    section: '3',
    says: 'the entry hash is',
    productLayer: 'T1',
    productBreaks: 'ok',
  },
  {
    name: 'checkpoint-other-key',
    refusals: 2,
    section: '6',
    says: 'the Ed25519 signature does not verify',
    productLayer: 'T2/T4',
    productBreaks: 'ok',
  },
  {
    name: 'checkpoint-prev-broken',
    refusals: 3,
    section: '6',
    says: 'prev is',
    productLayer: 'T2/T4',
    productBreaks: 'ok',
  },
  {
    name: 'checkpoint-dropped',
    refusals: 1,
    section: '6',
    says: 'prev is',
    productLayer: 'T2/T4',
    productBreaks: 'ok',
  },
  {
    // The work gate answers this one in BOTH readers, and it is the pair to the row
    // below: see gap G24 for why one input cannot reach both of section 8's questions.
    name: 'witness-header-bit',
    refusals: 1,
    section: '8',
    says: 'the path folds to',
    productLayer: undefined,
    productBreaks: 'witness',
  },
  {
    name: 'witness-headers-swapped',
    refusals: 2,
    section: '8',
    says: 'header carries',
    productLayer: undefined,
    productBreaks: 'witness',
  },
  {
    // THE ROW THAT INVERTED. It was `accepted: true` — the door a party with NO KEY could
    // walk through, and the sharper of the two places this reader accepted what the product
    // refuses. Section 4.1 and `event-schema.json` published the declarations, and it is a
    // refusal on both sides now. Both readers even name the same field.
    name: 'forged-payload-field-appended',
    refusals: 1,
    section: '4.1',
    says: 'which its contract does not declare',
    productLayer: 'T1',
    productBreaks: 'ok',
  },
  {
    // THE OTHER HALF OF A DECLARATION, and the half an exemplar can never carry: from one
    // published event, a required field and an optional one that happens to be present look
    // identical. Nothing is added here — a field is left OUT — so byte identity, an envelope
    // check and a hash chain all pass, and only `content: string` refuses it.
    name: 'appended-event-missing-a-declared-field',
    refusals: 1,
    section: '4.1',
    says: 'needs a non-empty string at payload.content',
    productLayer: 'T1',
    productBreaks: 'ok',
  },
  {
    // THE PAIR IS THE SELECTOR, and refusing a pair the table does not declare is the rule
    // that keeps a future event from being read under a present contract. It is also the
    // shape the interoperability world settles this with — in-toto's `predicateType` is a
    // URI carrying the major version, and it changes when the change is incompatible.
    name: 'appended-event-from-a-newer-catalog',
    refusals: 1,
    section: '4.1',
    says: 'no published contract declares',
    productLayer: 'T1',
    productBreaks: 'ok',
  },
  {
    // THE ENVELOPE'S OWN VOCABULARY, on an input a mutation had to be built for: `at` under
    // the rule `instant` is the exact spelling `toISOString` produces, not "some ISO-8601
    // string". The distinction is load-bearing rather than pedantic — the merge across
    // tails compares these strings, so two spellings of one instant are two positions.
    name: 'appended-event-with-a-loose-instant',
    refusals: 1,
    section: '4.1',
    says: 'UTC millisecond instant',
    productLayer: 'T1',
    productBreaks: 'ok',
  },
  {
    // THE ONE BOOLEAN IN THE CATALOG, on a kind the frozen records do not contain at all —
    // so the event is fabricated with the record's own anchor and fingerprint, and only its
    // TYPE is wrong. `"off"`, `0` and a missing key are three ways for two readers to
    // disagree about whether a channel was on.
    name: 'appended-event-with-a-wrong-typed-field',
    refusals: 1,
    section: '4.1',
    says: 'needs true or false at payload.on',
    productLayer: 'T1',
    productBreaks: 'ok',
  },
  {
    // SECTION 6.2, WITH NO KEY AT ALL. An event is not individually signed, so a party who
    // can write the repository names whatever `signerFp` they like above the last
    // checkpoint. The key is committed and its material hashes to its own name; what it is
    // not is a member.
    name: 'appended-event-by-an-unenrolled-key',
    refusals: 1,
    section: '6.2',
    says: 'is not a key enrolled for',
    productLayer: 'T2/T4',
    productBreaks: 'ok',
  },
  {
    // SECTION 6.2's `edited-event-chain-repaired`: the checkpoint is GENUINELY SIGNED, by a
    // key whose secret is RFC 8032's own published test vector. Its root folds, its `prev`
    // chains, its signature verifies under a key whose committed material hashes to exactly
    // the fingerprint it is filed under — every requirement of sections 1 to 6 holds. The
    // only thing wrong is that nothing ever enrolled the signer, which is the difference
    // between "the signature verifies" and "the signer was allowed to".
    name: 'checkpoint-by-an-unenrolled-key',
    refusals: 1,
    section: '6.2',
    says: 'is not a key enrolled for',
    productLayer: 'T2/T4',
    productBreaks: 'ok',
  },
  {
    name: 'keys-removed',
    // NOT a refusal, and that is the case: see the INCOMPLETE describe below. It is in this
    // table so that the enumeration from `mutate.py list` stays total, and its row says
    // `incomplete` rather than a refusal count.
    refusals: 0,
    section: '6',
    says: '',
    productLayer: 'T2/T4',
    productBreaks: 'ok',
    incomplete: true,
  },
  {
    name: 'key-renamed',
    refusals: 1,
    section: '6',
    says: 'is named for a fingerprint its own material does not hash to',
    productLayer: 'T2/T4',
    productBreaks: 'ok',
  },
  {
    name: 'tail-relocated',
    refusals: 1,
    section: '3',
    says: 'which is no key this record carries',
    productLayer: 'T2/T4',
    productBreaks: 'ok',
  },
] as const;

describe('the second reader refuses, and the mutation that earns each refusal ships with it', () => {
  it('has a case for every mutation the tool offers, enumerated from the tool', () => {
    // THE LIST IS NOT MAINTAINED BY HAND. A mutation added to `mutate.py` with no case
    // here would otherwise be a refusal nobody ever asked for.
    const offered = JSON.parse(python([MUTATE, 'list']).stdout) as string[];
    expect([...offered].sort()).toEqual([...MUTATIONS.map((m) => m.name)].sort());
  });

  /**
   * Every row but the one that is not a refusal. `keys-removed` is in the table so the
   * enumeration from `mutate.py list` above stays total, and it belongs to the INCOMPLETE
   * describe below instead: a check that could not run is not a check that refused, and a
   * loop that asserted REFUSED over it would be asserting the wrong thing.
   *
   * THERE USED TO BE A SECOND EXCLUSION, and its removal is the delivery. A row could carry
   * `accepted: true`, meaning this reader read the mutation as VERIFIED while the product
   * refused it — `forged-payload-field-appended` was that row. Section 4.1 closed it, so the
   * filter is `incomplete` alone and the count below is 1. The count is asserted rather than
   * left implicit precisely because a filter with nothing to exclude excludes nothing
   * SILENTLY: a future acceptance smuggled back in as a row-level flag would make this loop
   * skip it and every case here would stay green.
   */
  const REFUSING = MUTATIONS.filter((mutation) => !('incomplete' in mutation));

  it('leaves exactly ONE row out of the refusal loop, and no row is an acceptance', () => {
    expect(MUTATIONS.length - REFUSING.length).toBe(1);
    expect(MUTATIONS.filter((m) => 'incomplete' in m).map((m) => m.name)).toEqual(['keys-removed']);
    // NO ROW MAY BE AN ACCEPTANCE. This is the assertion the delivery is measured by: every
    // input `mutate.py` builds that the product refuses is refused here too.
    expect(MUTATIONS.filter((m) => m.refusals === 0 && !('incomplete' in m))).toEqual([]);
  });

  it.each(REFUSING)('refuses $name, and says so under section $section', (mutation) => {
    const record = copyOf('witnessed-record');

    // THE MUTATION IS PROVEN APPLIED BEFORE ANY VERDICT IS READ. An anchor that missed
    // leaves the record untouched and every guard below looks blind, when nothing was
    // mutated at all.
    const applied = JSON.parse(python([MUTATE, mutation.name, record]).stdout) as {
      applied: boolean;
      detail: string;
    };
    expect(applied.applied, `${mutation.name} did not change the record: ${applied.detail}`).toBe(
      true,
    );

    const there = secondReading(record);
    expect(there.verdict, `the second reader accepted ${mutation.name}`).toBe('REFUSED');
    expect(there.exit).toBe(1);
    const named = refusals(there);
    expect(named).toHaveLength(mutation.refusals);
    expect(
      named.some((f) => f.section === mutation.section && f.what.includes(mutation.says)),
      `no refusal under section ${mutation.section} said ${mutation.says}`,
    ).toBe(true);

    // And the product refuses the same bytes. THERE IS NO LONGER ANYWHERE ELSE FOR A ROW TO
    // GO: this loop used to have an escape hatch for a mutation only one reader catches — the
    // asymmetry, which had two named members (G21, G08) — and both are closed, so every row
    // but `keys-removed` runs here and a future acceptance has to redden rather than be
    // filed.
    //
    // WHICH AXIS THE PRODUCT REFUSES ON IS PART OF THE ROW, and it is not `ok` for the two
    // witness rows: `ok` is documented as "nothing verifiable is broken", and T3 is
    // reported as a LEVEL rather than gating `ok`. So a broken attestation drops the level
    // and the witness status and leaves `ok` true — which is the product's design, and
    // asserting `ok` there would have been asserting the wrong thing.
    const here = verify(record, catalogUpcasters());
    if (mutation.productBreaks === 'ok') {
      expect(here.ok, `the product accepted ${mutation.name}`).toBe(false);
      expect(here.issues.map((issue) => issue.layer)).toContain(mutation.productLayer);
    } else {
      expect(here.witness, `the product still trusts the witness after ${mutation.name}`).toBe(
        'not-covered',
      );
      expect(here.level).toBe('fully-signed');
    }
  });

  it('catches the repaired chain by the root ALONE, which is what section 5 claims', () => {
    // The sharpest case, asserted as the claim rather than as a count: after the whole
    // keyless chain is recomputed, T1 has nothing to say — in EITHER reader — and the
    // record is still refused. If the root folded stored hashes instead of content, both
    // readers would pass this and the signed head would be unchanged.
    const record = copyOf('witnessed-record');
    const applied = JSON.parse(python([MUTATE, 'edited-event-chain-repaired', record]).stdout) as {
      applied: boolean;
    };
    expect(applied.applied).toBe(true);

    const there = secondReading(record);
    const said = there.findings.map((f) => `${f.level} S${f.section} ${f.what}`).join('\n');
    expect(said, 'the hash chain must still close, or this proves nothing').toMatch(
      /ok S3 the hash chain closes over 4 entries/,
    );
    expect(refusals(there).map((f) => f.section)).toEqual(['5']);

    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(false);
    const layers = here.issues.map((issue) => issue.layer);
    expect(layers.length).toBeGreaterThan(0);
    expect(
      layers,
      'the product filed a T1 issue, so the chain was not really repaired',
    ).not.toContain('T1');
    expect([...new Set(layers)]).toEqual(['T2/T4']);
  });
});

/**
 * THE ONE PLACE THE TWO READERS DISAGREE, PINNED RATHER THAN HIDDEN — gap G23.
 *
 * Section 8 says a reader "takes the NEWEST checkpoint it holds a confirmed attestation
 * for" and reports "the instant, the block, and how many events were written after the
 * checkpoint that instant dates". It settles which CHECKPOINT. It says nothing about which
 * ATTESTATION inside it, and the normal case is several: section 8 itself talks about
 * calendars in the plural, and `witnessed-record` carries three.
 *
 * So the two readers, each faithful to the document, date the same record differently:
 *
 *   the product        block 963690 at 06:23:18Z   the first bitcoin attestation proof
 *                                                  traversal reaches that has a header
 *   the second reader  block 963688 at 06:03:01Z   the earliest attested block
 *
 * BOTH ARE VALID ATTESTATIONS OF THE SAME CHECKPOINT: each folds to its own block's merkle
 * root, and both blocks carry real work. The reason this is a finding and not a preference
 * is twofold. An earlier attestation is the STRONGER claim — existing at 06:03 implies
 * existing at 06:23 and not the reverse, so the product understates its own evidence by
 * twenty minutes here. And "proof traversal order" is a serialization detail of a
 * third-party file: reordering the fork branches of an `.ots`, which changes nothing about
 * what it proves, changes the date the product reports.
 *
 * THIS CASE IS THE DISAGREEMENT MADE PERMANENT. It fails if either reader changes its rule,
 * which is what "disagreement is red" is for; leaving the suite red instead would have
 * deleted the finding at the first merge.
 */
describe('the two readers date the same record differently, and the document does not decide', () => {
  it('reports different blocks for one checkpoint, and both blocks really carry it', () => {
    const record = copyOf('witnessed-record');
    const here = verify(record, catalogUpcasters());
    const there = secondReading(copyOf('witnessed-record'));

    expect(here.summary).toContain('Bitcoin block 963690 at 2026-08-23T06:23:18.000Z');
    expect(notes(there)).toContain('bitcoin block 963688 at 2026-08-23T06:03:01+00:00');

    // NON-VACUITY, and the whole point: the block the second reader names is not a block
    // it merely found in a file — the path folds to its merkle root and its own hash meets
    // the target it declares. So does the one the product names. Neither reader is wrong.
    const proven = there.findings
      .filter((finding) => finding.level === 'ok' && finding.section === '8')
      .map((finding) => finding.what)
      .join('\n');
    expect(proven).toContain("the path folds to block 963688's merkle root");
    expect(proven).toContain("the path folds to block 963690's merkle root");
  });

  it('agrees on everything the document DOES settle: covered, and the remainder', () => {
    // The divergence is confined to which instant is quoted. The verdict section 8 asks
    // for — whether the newest attestation reaches the last event — is the same in both.
    const here = verify(copyOf('witnessed-record'), catalogUpcasters());
    const there = secondReading(copyOf('witnessed-record'));
    expect(here.witness).toBe('covered');
    expect(notes(there)).toMatch(/^covered: /m);
    expect(here.uncheckpointedEvents).toBe(0);
    expect(notes(there)).toContain('which is every event written');
  });

  it('names the gap it leaned on to pick a rule at all', () => {
    const run = python([VERIFIER, 'gaps']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('G23');
    expect(run.stdout).toContain('as though a checkpoint had ONE attestation');
  });
});

/**
 * THE THIRD STATE: a check that could not RUN is not a check that refused.
 *
 * The 156-line prototype this verifier grew out of printed `T2/T4 ok` on a line that ran
 * unconditionally, after having already recorded a failure. Four verdict states is the
 * answer to that, and the middle one is the one worth a case of its own: nothing refused,
 * and something that was planned did not happen.
 *
 * THIS CASE EXISTS BECAUSE A MUTATION FOUND NOTHING. Turning the INCOMPLETE branch off in
 * `verdict.py` — so a run with unanswerable checks reported VERIFIED — left ZERO tests red.
 * The state was described in the verifier's docstring and in its README and asserted
 * nowhere, which is a guard with no mutation behind it. A mutation that lights nothing is a
 * finding, not a pass.
 */
describe('a check that could not run is reported as neither pass nor refusal', () => {
  it('answers INCOMPLETE, exit 2, with no refusal at all, when the keys are gone', () => {
    const record = copyOf('witnessed-record');
    const applied = JSON.parse(python([MUTATE, 'keys-removed', record]).stdout) as {
      applied: boolean;
    };
    expect(applied.applied).toBe(true);

    const there = secondReading(record);
    expect(there.verdict).toBe('INCOMPLETE');
    expect(there.exit).toBe(2);
    expect(refusals(there)).toEqual([]);

    // NON-VACUITY: an INCOMPLETE with nothing marked unchecked would be a verdict about
    // nothing, and an INCOMPLETE with nothing checked would be BROKEN instead.
    const unchecked = there.findings.filter((finding) => finding.level === 'UNCHECKED');
    expect(unchecked.length).toBeGreaterThanOrEqual(4);
    expect(unchecked.map((finding) => finding.what).join('\n')).toContain(
      'no signature can be checked',
    );
    expect(there.findings.filter((finding) => finding.level === 'ok').length).toBeGreaterThan(0);
  });

  it('says VERIFIED and exit 0 on the same record with its keys, or the case above is free', () => {
    const there = secondReading(copyOf('witnessed-record'));
    expect(there.verdict).toBe('VERIFIED');
    expect(there.exit).toBe(0);
    expect(there.findings.filter((finding) => finding.level === 'UNCHECKED')).toEqual([]);
  });

  it('is a place the two readers word the verdict differently, and the document says so', () => {
    // The product answers `broken` here: it holds a checkpoint whose signature it cannot
    // verify, and it will not call that fine. The second reader answers INCOMPLETE: it was
    // unable to ask. Both are honest, and neither is a gap in FORMAT.md — the document
    // disclaims this explicitly, in "This document specifies the bytes, not the workflow…
    // what a verifier's verdict means — none of that is here". That disclaimer is doing
    // work, which is worth a test saying so.
    const record = copyOf('witnessed-record');
    JSON.parse(python([MUTATE, 'keys-removed', record]).stdout);
    expect(verify(record, catalogUpcasters()).level).toBe('broken');
    expect(secondReading(record).verdict).toBe('INCOMPLETE');
  });
});

/**
 * THE DOOR A PARTY WITH NO KEY COULD WALK THROUGH, AND WHAT CLOSED IT.
 *
 * Section 4 promises that "a reader rebuilds the event from the fields its kind declares and
 * rejects any other, so a forged extra field cannot ride along into the signed bytes". The
 * per-kind declarations used to be published NOWHERE — `canonical-vectors.json` gives one
 * exemplar per kind, from which a stranger cannot tell a required field from an optional one
 * that happens to be present (gap G08). So a verifier built from the document had only byte
 * identity, and byte identity is enough for a field added to a line that was ALREADY written,
 * because the stored hash stops matching.
 *
 * It is not enough for a newly appended event. The entry hash takes no key, so whoever can
 * write the repository computes it; above the last checkpoint no signature covers the event;
 * and the envelope keys are all present. This reader accepted it, and said so on every run.
 *
 * `event-schema.json` and section 4.1 are that hole closed, and the cases below are the same
 * inputs asserting the opposite of what they used to. Both readers refuse, and — because both
 * are applying one published rule rather than each its own — both name the same field.
 *
 * THE SECOND CASE IS THE ONE AN EXEMPLAR COULD NEVER HAVE ANSWERED: a field left OUT. Nothing
 * rides along, nothing is added, every field present is declared; what refuses it is that
 * `content` is declared `string` and not `string?`, which is a distinction one example of an
 * event does not carry and a schema does.
 */
describe('the second reader refuses a forged payload field, which it used to accept', () => {
  it('is refused by BOTH readers, and both name the field', () => {
    const record = copyOf('witnessed-record');
    const applied = JSON.parse(
      python([MUTATE, 'forged-payload-field-appended', record]).stdout,
    ) as { applied: boolean; detail: string };
    expect(applied.applied, applied.detail).toBe(true);

    const there = secondReading(record);
    expect(there.verdict, 'this used to be VERIFIED, and closing that is the delivery').toBe(
      'REFUSED',
    );
    expect(refusals(there).map((f) => f.section)).toEqual(['4.1']);
    expect(refusals(there)[0]?.what).toContain('forgedInsidePayload');

    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(false);
    expect(here.level).toBe('unreadable');
    // THE SAME FIELD NAMED BY BOTH. Two readers refusing for two unrelated reasons would
    // pass a verdict comparison and prove nothing about the rule being one rule.
    expect(here.issues.map((issue) => issue.detail).join('\n')).toContain('forgedInsidePayload');
  });

  it('refuses a REQUIRED field left out, which byte identity can never catch', () => {
    const record = copyOf('witnessed-record');
    const applied = JSON.parse(
      python([MUTATE, 'appended-event-missing-a-declared-field', record]).stdout,
    ) as { applied: boolean; detail: string };
    expect(applied.applied, applied.detail).toBe(true);

    const there = secondReading(record);
    expect(there.verdict).toBe('REFUSED');
    expect(refusals(there)[0]?.what).toContain('payload.content');

    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(false);
    expect(here.issues.map((issue) => issue.detail).join('\n')).toContain('payload.content');
  });

  it('says out loud that the appended event rests on the hash chain alone', () => {
    // It cannot refuse the event, so the least it owes is to report the window the event is
    // in: above the last checkpoint, no signature covers anything, and that is the door.
    const record = copyOf('witnessed-record');
    JSON.parse(python([MUTATE, 'forged-payload-field-appended', record]).stdout);
    const said = notes(secondReading(record));
    expect(said).toContain('1 event(s) sit above the last checkpoint');
    expect(said).toContain('rest on the hash chain ALONE');
  });

  it('says the opposite, and says it as a PASS, when there is no such window', () => {
    // NON-VACUITY: a reader that emitted the warning unconditionally would satisfy the case
    // above while telling the truth about nothing.
    const there = secondReading(copyOf('witnessed-record'));
    expect(notes(there)).not.toContain('above the last checkpoint');
    expect(
      there.findings
        .filter((f) => f.level === 'ok')
        .map((f) => f.what)
        .join('\n'),
    ).toContain('there is no keyless window');
  });

  it('no longer names the per-kind rebuild among what it does not cover', () => {
    // A5/A10: the observable that this case used to assert is GONE, and asserting its
    // absence is what keeps the removal honest. A `NOT COVERED` entry left standing over a
    // check that now runs is the worst of both — it understates the reader and it trains a
    // future reader of the output to discount the list.
    const there = secondReading(copyOf('witnessed-record'));
    const declared = there.notCovered.map((entry) => `${entry.what} ${entry.section}`).join('\n');
    expect(declared).not.toContain('per-kind field');
    expect(declared).not.toContain('FORGED FIELD INSIDE A PAYLOAD');
  });

  it('reports the per-kind rebuild as a check that RAN, over every contract it read', () => {
    // NON-VACUITY OF THE REMOVAL: an entry taken out of `NOT COVERED` without the check
    // arriving would satisfy the case above while covering strictly less than before.
    const there = secondReading(copyOf('witnessed-record'));
    const passed = there.findings
      .filter((finding) => finding.level === 'ok')
      .map((finding) => `${finding.section} ${finding.what}`)
      .join('\n');
    expect(passed).toContain('published contract(s) read');
    expect(passed).toMatch(/4\.1/);
  });
});

describe('what the second reader does NOT check, said by the second reader', () => {
  it('no longer names enrolment among what it does not check, because it checks it', () => {
    const there = secondReading(copyOf('witnessed-record'));
    const declared = there.notCovered.map((entry) => entry.what).join('\n');
    expect(declared).not.toContain('ENROLLED');
    // And the check that replaced the disclaimer RAN and passed, over every event.
    const passed = there.findings
      .filter((finding) => finding.level === 'ok')
      .map((finding) => `${finding.section} ${finding.what}`)
      .join('\n');
    expect(passed).toContain('VALID FOR ITS ANCHOR');
    expect(passed).toMatch(/6\.2/);
  });

  it('refuses a GENUINELY SIGNED checkpoint whose signer nothing enrolled', () => {
    // SECTION 6.2's `edited-event-chain-repaired`. Every check below the enrolment layer
    // closes — the root folds, `prev` chains, and the Ed25519 signature verifies under a key
    // whose committed material hashes to exactly the fingerprint it is filed under. A reader
    // that stops at "the signature verifies" reads this as fine, which is what that clause
    // is worth on its own.
    const record = copyOf('witnessed-record');
    const applied = JSON.parse(
      python([MUTATE, 'checkpoint-by-an-unenrolled-key', record]).stdout,
    ) as { applied: boolean; detail: string };
    expect(applied.applied, applied.detail).toBe(true);

    const there = secondReading(record);
    expect(there.verdict).toBe('REFUSED');
    expect(refusals(there).map((f) => f.section)).toEqual(['6.2']);
    // THE FORGED CHECKPOINT'S OWN SIGNATURE VERIFIED, and that is the point of the case
    // rather than a detail: had it not, the refusal would be section 6's and section 6.2
    // would be untested. The mutation appends `cp[4..4]`, so that is the line to ask about.
    const forgedCheckpoint = there.findings.filter(
      (finding) => finding.where.includes('cp[4..4]') && finding.level === 'ok',
    );
    expect(
      forgedCheckpoint.map((finding) => finding.what).join('\n'),
      'the forged checkpoint has to pass sections 5 and 6, or 6.2 is not what refused it',
    ).toContain('Ed25519 signature verifies');
    expect(forgedCheckpoint.map((finding) => finding.section).sort()).toEqual(['5', '6']);

    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(false);
    expect(here.issues.map((issue) => issue.detail).join('\n')).toContain('is not a key enrolled');
  });

  it('names every other boundary too, on a verdict that PASSED', () => {
    // A verified record is exactly where an uncovered check looks covered, so the list is
    // printed there as well and asserted there rather than on a failure.
    const there = secondReading(copyOf('witnessed-record'));
    expect(there.verdict).toBe('VERIFIED');
    const declared = there.notCovered.map((entry) => entry.what).join('\n');
    expect(declared).toContain('never recomputed over a lifted reading');
    expect(declared).toContain('authorized cut from tampering');
    expect(declared).toContain("header's place in the Bitcoin chain");
    expect(declared).toContain('explicit undefined property');
    // THE LIST IS SHORTER BY EXACTLY THE TWO THIS DELIVERY CLOSED, and the count is asserted
    // both ways: a list that grew silently is a check somebody stopped running, and a list
    // that shrank without the check arriving is the entry removed rather than the limitation.
    expect(there.notCovered).toHaveLength(4);
  });

  it('says which gaps in FORMAT.md the reading leaned on', () => {
    const there = secondReading(copyOf('witnessed-record'));
    // The layout, the accumulator's encoding, the fingerprint derivation and the
    // undocumented tail proof are all load-bearing for reading a record at all.
    expect(there.gapsLeanedOn).toContain('G01');
    expect(there.gapsLeanedOn).toContain('G02');
    expect(there.gapsLeanedOn).toContain('G03');
    expect(there.gapsLeanedOn).toContain('G10');
  });
});
