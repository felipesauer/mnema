/**
 * THE LINE THIS SURFACE PRINTS ABOUT AN ADDRESS IT DECLINED TO CONTACT — driven on the
 * real program, with the real argv.
 *
 * IT EXISTS BECAUSE A MUTATION FOUND NOTHING. `mnema witness upgrade` reads the calendar
 * address off the proof file, and a proof is a file a project can receive; the act now
 * refuses one that names no public timestamp operator, and says so in a phrase of its own
 * — `was not asked by this machine` — because "the calendar is down, ask again later" and
 * "your proof names somewhere I will not go" call for opposite responses. Collapsing that
 * phrase back onto `did not answer` left **the whole suite green**: the check itself is
 * witnessed six ways in `chain`, the SHAPE of the line is pinned by
 * `a-line-of-success-is-one-line.test.ts`, and not one case anywhere read the words. So
 * the half of the design a person actually reads was the half nothing held.
 *
 * IT HAS TO BE THE SURFACE AND NOT THE TABLE. A case over `witnessRefusalWord` would go
 * red for the same mutation while saying nothing about whether the verb prints it — and
 * the phrase is only worth having if it reaches a person.
 *
 * THE PROOF IS PLANTED AS BYTES, and that is not laziness. Reaching this line from a
 * command line needs a pending attestation already on disk naming the address, and the
 * only verb that writes one is `stamp`, which needs a calendar to answer. `@mnema/chain`
 * exports no serializer past its own surface on purpose — exporting one so a test could
 * call it would be a public function with no caller in production, which is the shape
 * four defects of this series took. So the wire form is written out here, with the digest
 * of the sandbox's own checkpoint spliced into it.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointToWitness } from '@mnema/chain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';

/** An address a proof can name, and that names no timestamp calendar operator. */
const NOT_AN_OPERATOR = 'https://calendar.attacker.test';

/**
 * An `.ots` over `digest` whose only attestation is a promise from `uri`, IN BYTES.
 *
 *   004f70656e…e89294   the OpenTimestamps file magic
 *   01                  major version 1
 *   08                  the digest that follows is a sha256
 *   <32 bytes>          the digest the proof commits to
 *   00                  this member of the timestamp is an attestation
 *   83dfe30d2ef90c8e    the tag of a calendar's "I am working on it"
 *   <len> <len> <uri>   the payload, holding a length-prefixed URI
 */
function proofNaming(digest: Buffer, uri: string): Buffer {
  const address = Buffer.from(uri, 'utf-8');
  const payload = Buffer.concat([Buffer.from([address.length]), address]);
  return Buffer.concat([
    Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex'),
    Buffer.from([1]),
    Buffer.from([0x08]),
    digest,
    Buffer.from([0x00]),
    Buffer.from('83dfe30d2ef90c8e', 'hex'),
    Buffer.from([payload.length]),
    payload,
  ]);
}

let sandbox: string;
let said: string;
const cwdBefore = process.cwd();
const envBefore = { ...process.env };

/** One invocation, with both streams captured. */
async function invoke(...argv: string[]): Promise<string> {
  const lines: string[] = [];
  await run(['--color=never', ...argv], {
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    fail: () => {},
  });
  return lines.join('\n');
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-address-named-'));
  const project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(project);
  await invoke('init');
  await invoke('memory', 'a fact worth keeping');

  const root = join(project, '.mnema');
  const tail = readdirSync(join(root, 'tails'))[0] as string;
  const at = checkpointToWitness({ root }, tail) as string;
  const witness = join(root, 'tails', tail, 'witness');
  mkdirSync(witness, { recursive: true });
  writeFileSync(join(witness, `${at}.ots`), proofNaming(Buffer.from(at, 'hex'), NOT_AN_OPERATOR));

  // The plant is asserted before it is relied on: a proof the reader cannot parse would
  // make every case below pass over a record with nothing open.
  const standing = await invoke('witness');
  expect(standing).toContain('PENDING');
  expect(standing).toContain(NOT_AN_OPERATOR);

  said = await invoke('witness', 'upgrade');
}, 60_000);

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the address a proof names, on the surface a person reads', () => {
  it('is named, with the phrase this machine uses for its OWN refusal', () => {
    expect(said).toContain(`${NOT_AN_OPERATOR} was not asked by this machine`);
  });

  it('is NOT worded as somebody else not answering', () => {
    // The half a `toContain` on the new phrase cannot see: both lines could be printed,
    // or the new phrase could arrive while the old one still words this fact somewhere.
    expect(said).not.toContain('did not answer');
  });

  it('says WHY, in the words the check refused it with', () => {
    expect(said).toContain('is not a timestamp calendar operator');
  });

  it('does not tell its owner to come back and ask again', () => {
    // `ask again later` is advice, and repeating this act over an address the product
    // will not contact resolves nothing — the eternal PENDING D18 rejected the
    // four-host floor for, arriving one branch further in.
    expect(said).not.toContain('ask again later');
    expect(said).toContain('names could be asked — see below');
  });

  it('leaves the proof it refused to work on exactly as it found it', () => {
    // A refusal to ASK is not a refusal to HOLD: the request stays on the disk under the
    // digest it was filed under, byte for byte, and the reading goes on reporting it.
    const root = join(process.cwd(), '.mnema');
    const tail = readdirSync(join(root, 'tails'))[0] as string;
    const at = checkpointToWitness({ root }, tail) as string;
    const path = join(root, 'tails', tail, 'witness', `${at}.ots`);
    expect(readdirSync(join(root, 'tails', tail, 'witness'))).toEqual([`${at}.ots`]);
    expect(readFileSync(path)).toEqual(proofNaming(Buffer.from(at, 'hex'), NOT_AN_OPERATOR));
  });
});
