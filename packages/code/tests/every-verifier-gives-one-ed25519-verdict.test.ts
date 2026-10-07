/**
 * EVERY VERIFIER GIVES ONE ED25519 VERDICT, and it is the one other people published.
 *
 * WHERE THIS COMES FROM. A record's signatures are checked by three implementations: the
 * product's (`node:crypto`, behind `verify` in `packages/chain/src/chain/keys.ts`), the second
 * reader's (`packages/chain/verifier/mnemaverify/ed25519.py`) and the page's
 * (`packages/code/src/site/browser/crypto.ts`). Run over the 1,077 Ed25519 vectors of
 * Wycheproof, CCTV and ed25519-speccheck, they followed three different rules, and one of them
 * was not even one rule: Node 22 and Node 24 up to 24.18 accepted 301 vectors, Node 24.19 and
 * later accepted 132 (nodejs/node#64026 began refusing small-order points), and the Python and
 * the page agreed with each other on a third set. The same forged record — a public key of
 * small order, whose signatures anybody can produce one time in eight — verified under one
 * Node and failed under the other.
 *
 * SO THE RULE IS NOW WRITTEN, IN `FORMAT.md` SECTION 6, AND IT IS THE STRICT ONE: A and R decode
 * canonically to points that are not of small order, `S < L`, and the equation is the one
 * without the cofactor. It is the only rule all three can share without the product carrying
 * its own curve arithmetic; the product checks the encodings itself before `node:crypto`, so its
 * verdict no longer depends on which Node runs it.
 *
 * WHAT THE EXPECTATION IS, AND WHOSE IT IS. Not a verdict of ours:
 *   - Wycheproof: each test's own `result`;
 *   - CCTV: its flags, read the way its README describes `verify_strict` — refused when the
 *     vector has a small-order or non-canonical A or R, or a residue only a cofactored equation
 *     would cancel; accepted otherwise, a point with a small-order COMPONENT included;
 *   - ed25519-speccheck: the "Dalek strict" row of its README's results table;
 *   - RFC 8032 section 7.1: every vector verifies.
 *
 * It runs on every Node the CI matrix runs, which is the point: a vector whose verdict moved
 * with the Node version would be red on one of them.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publicKeyFromPem, verifySignature } from '@mnema/chain';
import { describe, expect, it } from 'vitest';

import { ed25519Verify } from '../src/site/browser/crypto.js';

const VECTORS = fileURLToPath(new URL('../../chain/conformance/vectors/', import.meta.url));
const VERIFIER = fileURLToPath(new URL('../../chain/verifier/', import.meta.url));

interface Vector {
  readonly id: string;
  readonly key: string;
  readonly sig: string;
  readonly msg: string;
  /** The verdict the vector's publisher gives under the strict rule. */
  readonly accept: boolean;
}

const read = (path: string): string => readFileSync(`${VECTORS}${path}`, 'utf-8');

/** Wycheproof: the test's own `result`. */
function wycheproof(): Vector[] {
  const file = JSON.parse(read('wycheproof/ed25519_test.json')) as {
    testGroups: {
      publicKey: { pk: string };
      tests: { tcId: number; msg: string; sig: string; result: string }[];
    }[];
  };
  return file.testGroups.flatMap((group) =>
    group.tests.map((test) => ({
      id: `wycheproof:${test.tcId}`,
      key: group.publicKey.pk,
      sig: test.sig,
      msg: test.msg,
      accept: test.result === 'valid',
    })),
  );
}

/** The CCTV flags that the strict rule refuses (CCTV `ed25519/README.md`). */
const REFUSED_FLAGS = new Set([
  'low_order_A',
  'low_order_R',
  'non_canonical_A',
  'non_canonical_R',
  'low_order_residue',
]);

function cctv(): Vector[] {
  const file = JSON.parse(read('cctv/ed25519vectors.json')) as {
    number: number;
    key: string;
    sig: string;
    msg: string;
    flags: string[] | null;
  }[];
  return file.map((vector) => ({
    id: `cctv:${vector.number}`,
    key: vector.key,
    sig: vector.sig,
    // CCTV's messages are text, not hex.
    msg: Buffer.from(vector.msg, 'utf-8').toString('hex'),
    accept: !(vector.flags ?? []).some((flag) => REFUSED_FLAGS.has(flag)),
  }));
}

/** ed25519-speccheck's README, the "Dalek strict" row: only case 3 verifies. */
const DALEK_STRICT = 'XXXVXXXXXXXX';

function speccheck(): Vector[] {
  const file = JSON.parse(read('speccheck/cases.json')) as {
    message: string;
    pub_key: string;
    signature: string;
  }[];
  return file.map((vector, at) => ({
    id: `speccheck:${at}`,
    key: vector.pub_key,
    sig: vector.signature,
    msg: vector.message,
    accept: DALEK_STRICT[at] === 'V',
  }));
}

/**
 * RFC 8032 section 7.1, read out of the RFC's own text. Page headers and footers fall inside
 * the long message, so they are dropped before a field's hex lines are joined.
 */
function rfc8032(): Vector[] {
  const text = read('rfc8032/rfc8032.txt');
  const start = text.indexOf('\n7.1.  Test Vectors for Ed25519');
  const end = text.indexOf('\n7.2.  Test Vectors for Ed25519ctx');
  const lines = text
    .slice(start, end)
    .split('\n')
    .filter((line) => !/^(RFC 8032 |Josefsson & Liusvaara )/.test(line) && line.trim() !== '')
    .map((line) => line.replace(/\f/g, '').trim());
  const vectors: Vector[] = [];
  let name = '';
  let field = '';
  let fields: Record<string, string> = {};
  const close = (): void => {
    if (name === '') return;
    const length = Number(/length (\d+) bytes?/.exec(fields.length ?? '')?.[1]);
    const msg = fields.MESSAGE ?? '';
    expect(msg.length / 2, `${name}: the message is the length the RFC says`).toBe(length);
    vectors.push({
      id: `rfc8032:${name}`,
      key: fields['PUBLIC KEY'] ?? '',
      sig: fields.SIGNATURE ?? '',
      msg,
      accept: true,
    });
  };
  for (const line of lines) {
    const test = /^-----TEST (.+)$/.exec(line);
    if (test !== null) {
      close();
      name = test[1] as string;
      fields = {};
      field = '';
    } else if (/^[A-Z ]+(\(length \d+ bytes?\))?:$/.test(line)) {
      field = line.replace(/ \(.*$|:$/g, '');
      fields[field] = '';
      if (field === 'MESSAGE') fields.length = line;
    } else if (/^[0-9a-f]+$/.test(line) && field !== '') {
      fields[field] = `${fields[field]}${line}`;
    }
  }
  close();
  return vectors;
}

const ALL: readonly Vector[] = [...wycheproof(), ...cctv(), ...speccheck(), ...rfc8032()];

const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));

const SPKI_PREFIX = '302a300506032b6570032100';

/** The product's path: the key as the record commits it (PEM), then `verify`. */
function byTheProduct(vector: Vector): boolean | string {
  const der = Buffer.from(`${SPKI_PREFIX}${vector.key}`, 'hex');
  const pem = `-----BEGIN PUBLIC KEY-----\n${der.toString('base64')}\n-----END PUBLIC KEY-----\n`;
  try {
    return verifySignature(bytes(vector.msg), bytes(vector.sig), publicKeyFromPem(pem));
  } catch (error) {
    // A key Node will not even import is a refusal, but it is named, not folded into false.
    return `threw: ${(error as Error).message}`;
  }
}

function byThePage(vector: Vector): boolean {
  return ed25519Verify(bytes(vector.msg), bytes(vector.sig), bytes(vector.key));
}

/** The second reader, every vector in one process: one line of verdicts back. */
function byTheSecondReader(vectors: readonly Vector[]): readonly boolean[] {
  const program = [
    'import json, sys',
    `sys.path.insert(0, ${JSON.stringify(VERIFIER)})`,
    'from mnemaverify import ed25519',
    'vectors = json.load(sys.stdin)',
    'print(json.dumps([ed25519.verify(bytes.fromhex(v["key"]), bytes.fromhex(v["sig"]), bytes.fromhex(v["msg"])) for v in vectors]))',
  ].join('\n');
  const run = spawnSync('python3', ['-c', program], {
    encoding: 'utf-8',
    input: JSON.stringify(vectors),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error !== undefined) {
    throw new Error(`python3 could not be run, and this suite requires it: ${run.error.message}`);
  }
  if (run.status !== 0) throw new Error(`the second reader failed: ${run.stderr}`);
  return JSON.parse(run.stdout) as boolean[];
}

describe('the outside Ed25519 vectors are the ones counted', () => {
  it('reads 151 Wycheproof, 914 CCTV, 12 speccheck and 5 RFC 8032 vectors', () => {
    // A parser that silently dropped a set would leave every case below green over less.
    const counted = (prefix: string): number => ALL.filter((v) => v.id.startsWith(prefix)).length;
    expect([
      counted('wycheproof:'),
      counted('cctv:'),
      counted('speccheck:'),
      counted('rfc8032:'),
    ]).toEqual([151, 914, 12, 5]);
    // 88 + 43 + 1 + 5: what the strict rule accepts, by the publishers' own expectations.
    expect(ALL.filter((v) => v.accept)).toHaveLength(137);
  });
});

describe('each verifier gives the publisher s verdict on every vector', () => {
  it(`the product, on ${process.version}`, () => {
    const wrong = ALL.filter((v) => byTheProduct(v) !== v.accept).map(
      (v) => `${v.id} expected ${v.accept}, got ${byTheProduct(v)}`,
    );
    expect(wrong).toEqual([]);
  });

  it('the page', () => {
    const wrong = ALL.filter((v) => byThePage(v) !== v.accept).map(
      (v) => `${v.id} expected ${v.accept}`,
    );
    expect(wrong).toEqual([]);
  });

  it('the second reader', () => {
    const verdicts = byTheSecondReader(ALL);
    expect(verdicts).toHaveLength(ALL.length);
    const wrong = ALL.filter((v, at) => verdicts[at] !== v.accept).map(
      (v) => `${v.id} expected ${v.accept}`,
    );
    expect(wrong).toEqual([]);
  });
});
