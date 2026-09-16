/**
 * A read over a record that does not chain SAYS SO.
 *
 * ## What it was
 *
 * Over a tree `mnema verify` exits 1 on — `seq gap: expected 6, found 5`, which is
 * what two sessions appending to one tail at once used to leave — `mnema search
 * --kind decision` exited 0 with no word, and `mnema status` did the same. Every fact
 * was served and the one thing wrong with the record was never mentioned. A product
 * whose subject is proof may not hand somebody a broken proof in silence.
 *
 * ## Why this half is not the other half's test
 *
 * The writing side of the same delivery stopped two writers from producing this. It is
 * NOT what makes these cases pass, and that separation is deliberate: a tail can stop
 * chaining for reasons no write lock knows about — a botched merge, a hand-edited
 * file, a restore from half a copy — so the corruption here is planted by hand rather
 * than raced for. Every case below would still be the right case if nothing had ever
 * raced.
 *
 * The plant is the last entry of the tail, appended again: the same `seq`, the same
 * `prev`, byte for byte what the race used to leave.
 *
 * ## What the cases are asked to hold
 *
 * That the notice APPEARS over a broken record, that it appears in EVERY read that
 * serves the record rather than in the two that first said it, that it carries the tail
 * and the position rather than a vague unease, that it does NOT appear over an intact
 * one — the vacuity guard, and the case that would catch a notice printed
 * unconditionally — and that it goes to the stream that keeps `--json`
 * machine-readable and keeps the `brief`'s document a function of the record alone.
 *
 * ## The reads, and why they are driven by a table
 *
 * It used to be two of them, named in prose. The table below is the same list the
 * command line actually has, and it is a table so that a read added to the surface is a
 * read somebody has to put here — the structural half of that obligation is
 * `the-broken-link-reaches-every-reader.test.ts`, which walks the SOURCE for the doors;
 * this half proves that what the source promises is what the binary prints.
 */

import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
// STATIC, not `await import()`: the ledger that asks whether any assertion observes a
// file follows import BINDINGS, and a subject fetched dynamically inside a case is a
// subject it cannot trace back. The verb wirings load lazily because the CLI's floor
// depends on it; a test has no floor to protect.
import { linkBreakNotice } from '../src/wiring/integrity.js';

const LF = '\n';

/** Everything one invocation wrote, by stream, plus whether it failed. */
async function invoke(...argv: string[]): Promise<{
  out: string[];
  err: string[];
  failed: boolean;
}> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  await run(['--color=never', ...argv], {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  });
  return { out, err, failed };
}

let sandbox: string;
let project: string;
let who = '';
let task = '';
let skill = '';
/** The document the `brief` prints over the INTACT fixture — the byte-for-byte base. */
let intactBrief = '';
const cwdBefore = process.cwd();
const envBefore = { ...process.env };

/** The one segment file of this machine's tail in the committed tree. */
function segment(): string {
  const tails = join(project, '.mnema', 'tails');
  const tail = readdirSync(tails)[0] as string;
  return join(tails, tail, '000001.jsonl');
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-does-not-chain-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(project);
  await invoke('init');
  await invoke('decision', 'The first', 'because');
  // A task and an adopted pattern, because three of the reads take one: `next-actions`
  // and `guard` are about a task, and `show` is about a record with a body. Every value
  // here is one the PRODUCT produced — the ids are read back out of what it printed, so
  // no case runs over a state no write can reach.
  const made = await invoke('task', 'The work');
  task = /\(([^)]+)\)/.exec(made.out.join(LF))?.[1] ?? '';
  if (task === '') throw new Error(`fixture: no task in ${made.out.join(LF)}`);
  const skilled = await invoke('skill', 'the-way', '--body', 'do it like this');
  skill = /\(([^)]+)\)/.exec(skilled.out.join(LF))?.[1] ?? '';
  if (skill === '') throw new Error(`fixture: no skill in ${skilled.out.join(LF)}`);
  // Carried to ADOPTED through the product's own transitions, because `skill export`
  // only writes a pattern in force — a fixture that wrote the state directly would be a
  // fixture about a record no write can produce.
  await invoke('skill', 'move', 'review', skill, '--note', 'read it');
  await invoke('skill', 'move', 'adopt', skill, '--note', 'this is how');
  const account = await invoke('accountability', '--json');
  const found = /"who": "(mnid:[0-9a-z]+)"/.exec(account.out.join(LF))?.[1];
  if (found === undefined) throw new Error(`fixture: no identity in ${account.out.join(LF)}`);
  who = found;
  intactBrief = (await invoke('brief')).out.join(LF);
}, 60_000);

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

/** The line a read owes about a tail that stops chaining. */
const notices = (err: readonly string[]): string[] =>
  err.filter((line) => line.startsWith('issue [T1]'));

/**
 * EVERY read of the command line that serves the record, and the argv that reaches it.
 *
 * The argv is a THUNK and not a value, and that is not style: `it.each` evaluates its
 * table while the suite is being COLLECTED, before any `beforeAll` has run, so a table
 * holding the ids directly holds empty strings — seven of these cases were green over
 * `mnema show ""` before the thunk went in. It takes ids because three of them are
 * about a task and one about a body, and an id nobody minted is a case about a record
 * that cannot exist.
 * `decision import` is here and it WRITES: it is the one read whose answer decides what
 * gets appended — the set of files already derived is what stops a duplicate — so a
 * broken proof under it is the worst moment on this surface to be silent about. It is
 * driven as a PLAN (no `--write`), which reads everything and appends nothing.
 */
const READS: readonly (readonly [name: string, argv: () => readonly string[]])[] = [
  ['search', () => ['search', '--kind', 'decision']],
  ['status', () => ['status', '--actor', who]],
  ['show', () => ['show', skill]],
  ['timeline', () => ['timeline', task]],
  ['refs', () => ['refs', task]],
  ['rules', () => ['rules', 'src/index.ts']],
  ['skills', () => ['skills']],
  ['accountability', () => ['accountability']],
  ['focus', () => ['focus', '--actor', who]],
  ['resume', () => ['resume', '--actor', who]],
  ['usage', () => ['usage']],
  ['switch', () => ['switch']],
  ['brief', () => ['brief']],
  ['next-actions', () => ['next-actions', task]],
  ['guard', () => ['guard', '--actor', who, 'start', task]],
  ['decision import', () => ['decision', 'import', '.']],
  ['skill export', () => ['skill', 'export', skill, '--out', '.']],
];

describe('over a record that chains, a read says nothing about the chain', () => {
  // THE VACUITY GUARD, and it runs FIRST, over the fixture before it is broken: every
  // case below would pass over a notice printed unconditionally, and this is what
  // makes them mean what they say.
  it('search says nothing', async () => {
    const found = await invoke('search', '--kind', 'decision');
    expect(notices(found.err)).toStrictEqual([]);
    expect(found.err).toStrictEqual([]);
    // And the read really did answer, so the silence is not the silence of an empty
    // record.
    expect(found.out.join(LF)).toContain('The first');
  });

  it('status says nothing', async () => {
    const stood = await invoke('status', '--actor', who);
    expect(notices(stood.err)).toStrictEqual([]);
  });

  it('and `verify` agrees the record is sound', async () => {
    const ruled = await invoke('verify');
    expect(ruled.failed).toBe(false);
  });

  // THE VACUITY GUARD FOR THE WHOLE SURFACE. Every case in the next block would pass
  // over a notice printed unconditionally; this is what makes them mean what they say,
  // and it is asserted per read so a red names which one started talking.
  it.each(READS)('%s says nothing', async (_name, argv) => {
    const ran = await invoke(...argv());
    expect(notices(ran.err)).toStrictEqual([]);
  });
});

describe('over a record that does not chain, a read says so', () => {
  beforeAll(() => {
    // The plant: the tail's last entry again. Same seq, same prev — what two writers
    // appending at once used to leave.
    const file = segment();
    const lines = readFileSync(file, 'utf-8').trimEnd().split(LF);
    appendFileSync(file, `${lines[lines.length - 1] as string}${LF}`, 'utf-8');
  });

  it('is a record `verify` refuses — so there is something to be silent about', async () => {
    const ruled = await invoke('verify');
    expect(ruled.failed).toBe(true);
  });

  it('search names the tail and the position, on the stream `--json` does not use', async () => {
    const found = await invoke('search', '--kind', 'decision');
    const said = notices(found.err);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^issue \[T1\] public \S+#\d+: seq gap: expected \d+, found \d+$/);
    // The answer still comes, and it comes on stdout: nothing was lost, and a
    // notice that corrupted the machine-readable stream would be its own defect.
    expect(found.out.join(LF)).toContain('The first');
    expect(found.out.join(LF)).not.toContain('issue [T1]');
  });

  it('search says what a break costs, and names the verb that rules', async () => {
    const found = await invoke('search', '--kind', 'decision');
    const explained = found.err.join(LF);
    expect(explained).toContain('still on the tail');
    expect(explained).toContain('mnema verify');
  });

  it('status says it too, before the answer', async () => {
    const stood = await invoke('status', '--actor', who);
    expect(notices(stood.err)).toHaveLength(1);
  });

  it('and `--json` stays exactly the object it promises', async () => {
    const found = await invoke('search', '--kind', 'decision', '--json');
    expect(notices(found.err)).toHaveLength(1);
    expect(() => JSON.parse(found.out.join(LF))).not.toThrow();
  });

  // THE TOTALITY, and it is the whole of this delivery: it used to be two of these.
  it.each(READS)('%s says so', async (_name, argv) => {
    const ran = await invoke(...argv());
    const said = notices(ran.err);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^issue \[T1\] \S+ \S+#\d+: .+$/);
    // And it is on `err`, which is what keeps `--json` parseable and keeps the
    // `brief`'s document a function of the record alone.
    expect(ran.out.join(LF)).not.toContain('issue [T1]');
  });

  it('the brief prints the same document it printed before, byte for byte', async () => {
    // The document is redirected into a committed file and compared with `diff`. A
    // notice inside it would be committed, and would outlive the repair it is about.
    const printed = await invoke('brief');
    expect(notices(printed.err)).toHaveLength(1);
    expect(printed.out.join(LF)).toBe(intactBrief);
  });

  it('does not turn a read into a failure: the facts were served', async () => {
    // The read ANSWERED. Ruling on the record is `verify`'s, and a read that started
    // exiting non-zero over a break would make every script that reads the record
    // fail on a record that still holds every fact it ever held.
    const found = await invoke('search', '--kind', 'decision');
    expect(found.failed).toBe(false);
  });
});

describe('the notice itself', () => {
  it('is nothing at all when nothing broke', () => {
    expect(linkBreakNotice([])).toStrictEqual([]);
  });

  it('names every broken tail, and explains the cost once however many broke', () => {
    const lines = linkBreakNotice([
      { scope: 'public', tail: 'aa-01', seq: 4, detail: 'seq gap: expected 5, found 4' },
      { scope: 'global', tail: 'bb-02', seq: 9, detail: 'prev-hash break: does not chain' },
    ]);
    const text = lines.map((line) => line.parts.map((part) => part.text).join(''));
    expect(text).toHaveLength(3);
    expect(text[0]).toContain('aa-01#4');
    expect(text[1]).toContain('bb-02#9');
    // Said ONCE. A reader who meets a paragraph of explanation under every broken
    // tail reads the first one and skips the rest, including the tails.
    expect(text.filter((line) => line.includes('mnema verify'))).toHaveLength(1);
  });

  it('sits at the left edge, where a line with no heading above it belongs', () => {
    const lines = linkBreakNotice([
      { scope: 'public', tail: 'aa-01', seq: 4, detail: 'seq gap: expected 5, found 4' },
    ]);
    expect(lines.map((line) => line.indent)).toStrictEqual([0, 0]);
  });
});
