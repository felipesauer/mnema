/**
 * THE TWO READERS PUT TWO TAILS IN THE SAME ORDER WHEN THEIR HEADS TIE.
 *
 * FORMAT.md §6.2: among the ready heads the reader takes the smallest `at`, and a tie goes to the
 * head of the tail with the smaller key, "the tail id compared as text (by UTF-16 code unit)". The
 * product compares with JavaScript's `<` and `.sort()`, which are that order. Comparing by code
 * point is a different order, and the two disagree only between a character from U+E000 to U+FFFF
 * and one above U+FFFF: in UTF-16 the one above starts with a surrogate, 0xD800-0xDBFF, so it
 * comes FIRST; by code point it comes last. A tail id is the key's fingerprint, a dash and an
 * installation id the machine chooses (§6.1), so nothing in the format keeps either character out
 * of it.
 *
 * Where the order reaches a verdict, a reader that compared by code point would name another
 * fact. So this file writes one key on two installations whose ids differ by exactly those two
 * characters, and has each tail give birth to the same decision at the same instant: the birth
 * taken second is the one §6.7 names `born-twice`, and both readers have to name the same one.
 * It also holds the second reader's sort key to the three cases by value.
 *
 * It needs `python3` and fails rather than skips without it, as its siblings do.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { decisionTransitioned, identityFounded } from '../events/build.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting, verify } from './chain.js';
import { keyToSignWith } from './keystore.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const VERIFIER_DIR = fileURLToPath(new URL('../../verifier/', import.meta.url));
const CASE_TIMEOUT = 120_000;

/** U+FF21, FULLWIDTH LATIN CAPITAL LETTER A: one UTF-16 unit, 0xFF21. */
const BMP_HIGH = '\uFF21';
/** U+1F600: two UTF-16 units, 0xD83D 0xDE00, so below 0xFF21 by code unit and above it by point. */
const ASTRAL = '\u{1F600}';

function python(args: readonly string[], input?: string) {
  const run = spawnSync('python3', args, { encoding: 'utf-8', input });
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

interface Named {
  readonly tail: string;
  readonly seq: number;
  readonly rule: string;
}

/** What each reader names under §6.7, in the order each reports it, and each one's verdict. */
function bothReaders(record: string) {
  const here = verify(record, catalogUpcasters());
  const product = here.census.flatMap((note): Named[] =>
    note.kind === 'illegal-move' ? [{ tail: note.tail, seq: note.seq, rule: note.rule }] : [],
  );
  const run = python([VERIFIER, '--json', 'record', record]);
  const there = JSON.parse(run.stdout) as {
    verdict: string;
    findings: { level: string; section: string; what: string; where: string }[];
  };
  const second = there.findings
    .filter((finding) => finding.section === '6.7' && finding.level === 'note')
    .map((finding) => {
      const rule = /\(rule ([a-z-]+)\)$/.exec(finding.what)?.[1];
      const place = /^(\S+) seq (\d+)$/u.exec(finding.where);
      if (rule === undefined || place === null) {
        throw new Error(`a note with no rule or no place: ${JSON.stringify(finding)}`);
      }
      return { tail: place[1] as string, seq: Number(place[2]), rule };
    });
  return {
    product,
    second,
    productOk: here.ok,
    secondVerdict: there.verdict,
    secondFails: there.findings.filter((finding) => finding.level === 'FAIL'),
  };
}

/**
 * One key, two installations of it writing to `record`: the installation ids are chosen here, as
 * the format lets a machine choose them, so the two tail ids differ only in their last character.
 */
function oneKeyTwoInstallations(record: string) {
  const keyRoot = fresh('mnema-order-key-');
  const key = keyToSignWith({ root: keyRoot });
  key.keep?.();
  const fingerprint = key.keyPair.fingerprint;
  const installedAs = (id: string) => {
    const root = fresh('mnema-order-installation-');
    mkdirSync(join(root, 'keys'), { recursive: true });
    writeFileSync(join(root, 'keys', `${fingerprint}.inst`), `${id}\n`);
    return openChainForWriting(record, {
      keyRoot,
      installationRoot: root,
      maxUnsignedEvents: 10_000,
    });
  };
  return { high: installedAs(BMP_HIGH), astral: installedAs(ASTRAL) };
}

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1) + seconds * 1000).toISOString();

describe('two heads that tie on `at`: the tail id decides, by UTF-16 code unit', () => {
  it(
    'one decision born on both tails at one instant: both readers name the birth on the BMP tail',
    () => {
      const record = fresh('mnema-order-record-');
      const { high, astral } = oneKeyTwoInstallations(record);
      expect(high.tail.endsWith(`-${BMP_HIGH}`)).toBe(true);
      expect(astral.tail.endsWith(`-${ASTRAL}`)).toBe(true);
      const envelope = (seconds: number) => ({
        at: at(seconds),
        who: high.anchor,
        signerFp: high.signerFingerprint,
        subject: 'd-1',
      });
      high.append(
        identityFounded(
          { ...envelope(-1), subject: high.anchor },
          { foundingFp: high.signerFingerprint },
        ),
      );
      const birth = { from: null, to: 'proposed', action: 'create' };
      high.append(decisionTransitioned(envelope(10), birth));
      astral.append(decisionTransitioned(envelope(10), birth));
      high.checkpoint();
      astral.checkpoint();

      const said = bothReaders(record);
      // The astral tail sorts first by code unit, so its birth is taken first and the BMP tail's
      // birth, at seq 1 after the founding, is the second one. By code point it would be the
      // astral tail's, at seq 0.
      expect(said.product, 'the product, against §6.2').toEqual([
        { tail: high.tail, seq: 1, rule: 'born-twice' },
      ]);
      expect(said.second, 'the second reader, against the product').toEqual(said.product);
      expect(said.productOk).toBe(true);
      expect(said.secondFails).toEqual([]);
      expect(said.secondVerdict).toBe('VERIFIED');
    },
    CASE_TIMEOUT,
  );
});

describe("the second reader's key for a tail id", () => {
  it(
    'puts ASCII, then the character above U+FFFF, then the one from U+E000 to U+FFFF',
    () => {
      const ids = [`f-${BMP_HIGH}`, `f-${ASTRAL}`, 'f-a', 'f-\uE000', 'f-\uFFFF'];
      const run = python(
        [
          '-c',
          [
            `import json, sys; sys.path.insert(0, ${JSON.stringify(VERIFIER_DIR)})`,
            'from mnemaverify.canonical import utf16_order',
            'print(json.dumps(sorted(json.load(sys.stdin), key=utf16_order)))',
          ].join('\n'),
        ],
        JSON.stringify(ids),
      );
      expect(run.stderr).toBe('');
      expect(JSON.parse(run.stdout)).toEqual([
        'f-a',
        `f-${ASTRAL}`,
        'f-\uE000',
        `f-${BMP_HIGH}`,
        'f-\uFFFF',
      ]);
      // The product's own order, which is what the format says: the same list.
      expect([...ids].sort()).toEqual(JSON.parse(run.stdout));
    },
    CASE_TIMEOUT,
  );
});
