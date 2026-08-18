/**
 * A REFUSAL IS ONE LINE, AND THE ID ON IT CAME FROM OUTSIDE.
 *
 * Eight verbs of this surface refuse an id they cannot find, and every one of them used
 * to put that id straight into the sentence. An id is whatever was typed after the
 * verb — nothing upstream removes a newline from one — so an argument holding a break
 * printed a SECOND line with the entire shape of a refusal, about a record nobody
 * named. The rule is `one-line.ts`'s and it was already closed for a project's
 * DIRECTORY (`verify --workspace`, four sites in one function); this file is the same
 * rule over the family of refusals that name a record.
 *
 * THE SITES ARE READ OFF THE SOURCE, NEVER LISTED HERE. That is the whole technique,
 * and the reason for it is in this delivery's own history: the debt was declared with a
 * hand-written list of SIX addresses, and re-running the discriminant found EIGHT — the
 * list held one refusal per file and `skill.ts` has two, and it did not have
 * `decision.ts` at all. So {@link sitesInSource} walks the source on every run and
 * {@link PROBES} is reconciled against it in both directions: a ninth site with no
 * probe fails here, and a probe for a site that went away fails here too.
 *
 * Three things are asserted, and they fail in different directions:
 *
 *   - THE FORGERY. An id carrying a newline leaves the refusal one line, at every site.
 *     This is the defect itself.
 *   - THE WORDING. For an ordinary id, each verb prints the bytes it printed before —
 *     written out as literals here, because the only thing a comparison against
 *     `noSuchRecord` could fail for is not being itself.
 *   - THE SHAPE. No source file of this surface builds that sentence by interpolation
 *     or concatenation. This is what a NINTH refusal, written next year, runs into.
 *
 * The third one reconciles across the packages too, and it is not decoration: the
 * domain has a refusal of the same family (`core`'s `authorizeTailPrune`), it is in a
 * package `oneLine` does not reach, and naming it here means the day it is closed this
 * guard goes red and the exception is deleted rather than outliving its reason.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { sourceFiles } from './support/reading-source.js';

/** `packages/code/src` — the surface that owns this sentence. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));
/** The repository's `packages`, for the reconciliation across the other ones. */
const PACKAGES = fileURLToPath(new URL('../..', import.meta.url));

/** A newline, built rather than typed, so no literal in this file spans two lines. */
const LF = String.fromCharCode(10);

// ---------------------------------------------------------------------------
// The sites, read off the source
// ---------------------------------------------------------------------------

/** One call of the wording function: which file, which kind, and which of that file's. */
interface Site {
  /** The file, relative to `src`. */
  readonly file: string;
  /** The kind named at the call. */
  readonly kind: string;
  /** `<file> <kind> #<n>` — what a probe claims to cover. */
  readonly key: string;
}

/** The module that WORDS the refusal, which is the one file that does not call it. */
const WORDING = 'wiring/no-such-record.ts';

/**
 * Every call of `noSuchRecord` in the source, with the kind it names.
 *
 * Read line by line so a mention inside a doc-comment is not counted as a call: a
 * phantom site would fail the reconciliation for a reason that has nothing to do with
 * the product. What it does NOT tolerate is a call whose kind is a variable — that one
 * would be invisible to this walk, so the count of calls is asserted against the count
 * of calls WITH A LITERAL, and they have to agree.
 */
function sitesInSource(): { sites: Site[]; calls: number; files: number } {
  const sites: Site[] = [];
  let calls = 0;
  const files = sourceFiles(SRC).filter((file) => relative(SRC, file) !== WORDING);
  for (const file of files) {
    const seen = new Map<string, number>();
    for (const line of readFileSync(file, 'utf-8').split(LF)) {
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//')) continue;
      for (const _ of line.matchAll(/noSuchRecord\(/g)) calls += 1;
      for (const call of line.matchAll(/noSuchRecord\(\s*'([a-z]+)'/g)) {
        const kind = call[1] as string;
        const nth = (seen.get(kind) ?? 0) + 1;
        seen.set(kind, nth);
        const relativePath = relative(SRC, file);
        sites.push({ file: relativePath, kind, key: `${relativePath} ${kind} #${nth}` });
      }
    }
  }
  return { sites, calls, files: files.length };
}

const FOUND = sitesInSource();

// ---------------------------------------------------------------------------
// How each site is reached
// ---------------------------------------------------------------------------

/** One way to reach a site: the argv, and where the name goes in it. */
interface Probe {
  /** The site this covers, as {@link sitesInSource} keys it. */
  readonly key: string;
  /** What a caller types, with the name written as `NAME`. */
  readonly argv: readonly string[];
  /** The sentence the site prints, with the name written as `NAME`. */
  readonly says: string;
}

/** Where the name goes in a probe's argv and in its expected sentence. */
const NAME = '<name>';
/**
 * Where this machine's identity goes in a probe's argv.
 *
 * `guard --actor` is proven against the record BEFORE the task is looked up, so a probe
 * that invented an actor met `UNKNOWN_ANCHOR` and never reached the site it claimed to
 * cover — one line, from the wrong refusal, passing for the right reason. It is read
 * off the record in {@link beforeAll}, and the case that caught it is the byte-for-byte
 * one below.
 */
const ACTOR = '<actor>';

/**
 * How each of the eight sites is reached from the command line.
 *
 * The KEYS are reconciled against the source; the ARGV cannot be — no walk derives
 * "this refusal is behind `skill export`" from a call inside an action. So the table
 * carries what only a reader knows and nothing else, and the part that rots (which
 * sites exist) is the part that is derived.
 *
 * `decision.ts` has ONE site and two verbs reach it: `decision move` and
 * `decision supersede` both relay through the same reporter. The move is the probe; the
 * supersede has a case of its own below, so the second door is exercised without the
 * reconciliation having to invent a second site for it.
 */
const PROBES: readonly Probe[] = [
  {
    key: 'wiring/guard.ts task #1',
    argv: ['guard', 'start', NAME, '--actor', ACTOR],
    says: `No task ${NAME} here.`,
  },
  {
    key: 'wiring/next-actions.ts task #1',
    argv: ['next-actions', NAME],
    says: `No task ${NAME} here.`,
  },
  { key: 'wiring/show.ts record #1', argv: ['show', NAME], says: `No record ${NAME} here.` },
  {
    key: 'wiring/skill.ts skill #1',
    argv: ['skill', 'move', 'review', NAME],
    says: `No skill ${NAME} here.`,
  },
  {
    key: 'wiring/skill.ts skill #2',
    argv: ['skill', 'export', NAME],
    says: `No skill ${NAME} here.`,
  },
  {
    key: 'wiring/task.ts task #1',
    argv: ['task', 'move', 'start', NAME],
    says: `No task ${NAME} here.`,
  },
  {
    key: 'wiring/tail.ts tail #1',
    argv: ['tail', 'prune', NAME, '--reason', 'a reason for the cut'],
    says: `No tail ${NAME} holds events in any tree here.`,
  },
  {
    key: 'wiring/decision.ts decision #1',
    argv: ['decision', 'move', 'accept', NAME],
    says: `No decision ${NAME} here.`,
  },
];

// ---------------------------------------------------------------------------
// Driving the surface
// ---------------------------------------------------------------------------

/** Everything one invocation wrote, by stream, plus whether it failed. */
async function invoke(...argv: string[]): Promise<{
  out: string[];
  err: string[];
  failed: boolean;
}> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  // `--color=never` beats every environment variable and the terminal detection, so
  // the bytes asserted below are the sentence and nothing wrapped around it.
  await run(['--color=never', ...argv], {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  });
  return { out, err, failed };
}

/** This machine's identity, as the record writes it — read from the record, not typed. */
let who = '';

/** A probe's argv with a name in it, and with this machine's identity where one is asked. */
const asked = (probe: Probe, name: string): string[] =>
  probe.argv.map((word) => (word === NAME ? name : word === ACTOR ? who : word));

/** The opening of a probe's sentence, up to the name — `No task `. */
const opens = (probe: Probe): string => probe.says.slice(0, probe.says.indexOf(NAME));

/** An id no record holds — well formed, so nothing refuses it for its shape. */
const ORDINARY = '0198c2f1-4b7e-7a2d-8f31-6cd0a91e4b55';

/**
 * The name that forges a line: a plausible id, a break, and a complete refusal about
 * an id nobody asked about.
 *
 * The second half is a REFUSAL and not any old text, because that is the sentence the
 * product itself would print — a reader who met it on a second line has no way to tell
 * it apart from one the product decided.
 */
const FORGED = `0198c2f1-4b7e-7a2d-8f31-6cd0a91e4b55${LF}No task deadbeef here.`;

let sandbox: string;
const cwdBefore = process.cwd();
const envBefore = { ...process.env };

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-one-line-'));
  const project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  process.chdir(project);
  await invoke('init');
  const account = await invoke('accountability', '--json');
  const found = /"who": "(mnid:[0-9a-z]+)"/.exec(account.out.join(LF))?.[1];
  if (found === undefined) throw new Error(`fixture: no identity in ${account.out.join(LF)}`);
  who = found;
}, 60_000);

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

describe('the sites are the source’s, not this file’s', () => {
  it('covers every call of the wording function, and no site that went away', () => {
    // Both directions at once. A ninth refusal with no probe is the case this exists
    // for; a probe whose site was deleted is the way an allowlist becomes a fossil.
    const inSource = FOUND.sites.map((site) => site.key).sort();
    const probed = [...new Set(PROBES.map((probe) => probe.key))].sort();
    expect(probed).toEqual(inSource);
  });

  it('finds calls at all, and none whose kind it could not read', () => {
    // The vacuous form of the case above is a walk that found nothing: two empty lists
    // are equal. So the walk states its own scale, and it states that every call it
    // counted is a call it could READ — a `noSuchRecord(kind, id)` with a variable
    // would be counted and not keyed, and the reconciliation would pass while the site
    // it belongs to went unprobed.
    expect(FOUND.files).toBeGreaterThan(40);
    expect(FOUND.sites.length).toBe(8);
    expect(FOUND.calls).toBe(FOUND.sites.length);
  });
});

describe('an id cannot forge a second line', () => {
  for (const probe of PROBES) {
    it(`keeps the refusal to one line — ${probe.key}`, async () => {
      const said = await invoke(...asked(probe, FORGED));
      expect(said.failed, probe.key).toBe(true);
      expect(said.out, probe.key).toEqual([]);
      // THAT IT IS THIS SITE'S REFUSAL AND NOT SOME OTHER NO. Every refusal of this
      // surface is one line, so "one line" alone passes for a probe that never reached
      // the site — which is what `guard --actor` did when the actor was invented.
      expect(said.err.join(LF), probe.key).toContain(opens(probe));
      // What the defect produced: TWO lines, the second a well-formed refusal. The
      // count is the assertion — the whole stream, however the surface split it into
      // writes, is one line.
      expect(said.err.join(LF).split(LF), probe.key).toHaveLength(1);
    });
  }
});

describe('the wording is the one the surface already printed', () => {
  for (const probe of PROBES) {
    it(`says it byte for byte — ${probe.key}`, async () => {
      const said = await invoke(...asked(probe, ORDINARY));
      expect(said.failed, probe.key).toBe(true);
      expect(said.err.join(LF), probe.key).toBe(probe.says.replace(NAME, ORDINARY));
    });
  }

  it('reaches the decision’s site through supersede as well', async () => {
    // The second door onto the one site `decision.ts` has. It refuses the OLD id, so
    // the successor is an id the record does not hold either, and the sentence names
    // the one the caller asked to move.
    const said = await invoke('decision', 'supersede', ORDINARY, ORDINARY);
    expect(said.failed).toBe(true);
    expect(said.err.join(LF)).toBe(`No decision ${ORDINARY} here.`);
    const forged = await invoke('decision', 'supersede', FORGED, ORDINARY);
    expect(forged.err.join(LF).split(LF)).toHaveLength(1);
  });
});

describe('nothing builds that sentence on its own', () => {
  /** A refusal built by interpolation — `No task ${id} here.` */
  const INTERPOLATED = /\bNo [A-Za-z][A-Za-z-]* \$\{/;
  /** The same, built by concatenation — `'No task ' + id`. */
  const CONCATENATED = /\bNo [A-Za-z][A-Za-z-]* ['"] *\+/;

  /** Every non-test source file of a package, keyed by its path from `packages`. */
  function everyPackageSource(): { path: string; text: string }[] {
    const found: { path: string; text: string }[] = [];
    for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = join(PACKAGES, entry.name, 'src');
      let files: string[];
      try {
        files = sourceFiles(src);
      } catch {
        continue;
      }
      for (const file of files) {
        found.push({ path: relative(PACKAGES, file), text: readFileSync(file, 'utf-8') });
      }
    }
    return found;
  }

  it('words no refusal of this family outside the one function', () => {
    // The discriminant is the PHRASE and not the symbol, because a site written next
    // year will not mention `noSuchRecord` — that is exactly what makes it a site.
    const offenders = sourceFiles(SRC)
      .filter((file) => relative(SRC, file) !== WORDING)
      .filter((file) => {
        const text = readFileSync(file, 'utf-8');
        return INTERPOLATED.test(text) || CONCATENATED.test(text);
      })
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('accuses a line somebody would write', () => {
    // The vacuous form of the case above is a detector that matches nothing, and this
    // family has a shape a scan can miss: `Not a direction: ${…}` opens with the same
    // two letters and is not one of these, so the boundary is asserted too.
    // `${` is BUILT and not typed: a plain string holding one is a lint error, and a
    // sample that had to be written as a template would be a sample the scanner reads
    // differently from the source it scans.
    const OPEN = `${'$'}{`;
    expect(INTERPOLATED.test(`No task ${OPEN}id} here.`)).toBe(true);
    expect(CONCATENATED.test("'No decision ' + id")).toBe(true);
    expect(INTERPOLATED.test(`Not a direction: ${OPEN}direction}.`)).toBe(false);
    expect(INTERPOLATED.test(`No ${OPEN}kind} ${OPEN}oneLine(named)} here.`)).toBe(false);
  });

  it('names the one place outside this package that still words its own', () => {
    // `authorizeTailPrune` words two refusals of this family and interpolates the
    // caller's value into both. It is NOT this defect: by the time either sentence is
    // built, the value has been matched against the record — one against the tail this
    // writer appends to, the other against the tree that was found holding it — so a
    // name carrying a newline is refused before it gets there. What it is, is the same
    // PHRASE in a package `oneLine` does not reach, which makes closing it a slice with
    // its own count. It is RECONCILED here rather than left silent: the day it is
    // closed, this case goes red and the exception is deleted instead of outliving its
    // reason.
    const elsewhere = everyPackageSource()
      .filter(({ path }) => !path.startsWith(join('code', 'src')))
      .filter(({ text }) => INTERPOLATED.test(text) || CONCATENATED.test(text))
      .map(({ path }) => path);
    expect(elsewhere).toEqual([join('core', 'src', 'workflow', 'prune-operations.ts')]);
  });

  it('walks more than one package', () => {
    // The case above is a comparison between two lists, and an empty walk makes it a
    // comparison between two empty lists. What it is walking is stated.
    const walked = everyPackageSource();
    expect(walked.length).toBeGreaterThan(200);
    expect(
      new Set(walked.map(({ path }) => path.slice(0, path.indexOf('/')))).size,
    ).toBeGreaterThan(2);
  });
});
