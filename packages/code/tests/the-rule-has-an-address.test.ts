/**
 * A rule of the record with an ADDRESS, end to end: written by `mnema link --rel
 * governs <path>`, read back by `mnema rules <path>` and by the tool an agent calls.
 *
 * THE WRITE HALF ALREADY EXISTED, and proving that is half of what this file is for.
 * `rel` is an open literal the parser never closes and `target` is the CALLER'S by the
 * content door's classification, so a path travels through the existing verb with no
 * field, no version and no upcaster behind it. The cases below hold that as a property
 * rather than as a claim: a path without a credential comes back byte for byte, and a
 * path with one is REFUSED.
 *
 * That second half is a rewrite. It read "a path with a credential inside it comes
 * back with the door's placeholder in it, exactly as any other prose does", which was
 * true of a door that treated every field alike. `target` is a NAME — the reading is a
 * lookup by exact string — so `src/<SECRET:aws-access-key>/deploy.ts` would be an
 * address of no file, recorded permanently. The door refuses it instead.
 *
 * NOTHING HERE CHARGES. The reading refuses nothing, blocks nothing and grades
 * nothing, and that is asserted rather than said: every invocation exits clean, and
 * the whole sandbox is digested around the read so "it wrote nothing" is bytes.
 *
 * BOTH SURFACES ANSWER THE SAME, which is the property that stops the count of stale
 * addresses from depending on which one asked. They are compared field by field on a
 * record that has a matching rule, a stale one and a rule of a kind with no name.
 */

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { openSession, type Session } from '../src/mcp/session.js';
import { runGoverningRulesTool } from '../src/mcp/tools.js';

/**
 * The gate's three numbers, which every case in this file must read as zero.
 *
 * Named rather than spelled at each assertion, and it is a claim rather than boilerplate:
 * this file is about the relation that INFORMS, so the relation that STOPS somebody has
 * nothing addressed in any of its fixtures — and it reading anything else would mean the two
 * walks had started sharing a list. The gate's own cases are with the charge
 * (`the-record-asks-for-a-person.test.ts`).
 */
const NO_GATE = { matching: 0, addressed: 0, stale: 0 };

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** What one invocation wrote, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** Runs `mnema <argv>` the way the binary does, and reads both channels. */
async function mnema(...argv: string[]): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out, err, failed };
}

/** One rule as the reading reports it. */
interface ReportedRule {
  readonly rule: string;
  readonly recorded: string;
  readonly address?: string;
  readonly segments?: number;
  readonly onDisk: boolean;
  readonly kind?: string;
  readonly name?: string;
  readonly state?: string;
  readonly assertedIn: string;
}

/** The whole reading, as `--json` and the tool both shape it. */
interface Reported {
  readonly path: string;
  readonly relative?: string;
  readonly rules: ReportedRule[];
  readonly stale: ReportedRule[];
  readonly counts: { matching: number; governing: number; stale: number };
}

/** `mnema rules <path> --json`, parsed. */
async function reported(path: string): Promise<Reported> {
  const said = await mnema('rules', path, '--json');
  expect(said.failed, said.err.join(' / ')).toBe(false);
  return JSON.parse(said.out.join('\n')) as Reported;
}

/** The page a person gets. */
async function page(path: string): Promise<string> {
  const said = await mnema('rules', path);
  expect(said.failed, said.err.join(' / ')).toBe(false);
  return said.out.join('\n');
}

/** Records a decision through the real verb and returns its id. */
async function decide(title: string): Promise<string> {
  const said = await mnema('decision', title, `why ${title}`);
  expect(said.failed, said.err.join(' / ')).toBe(false);
  // The id is in the PARENTHESES: the line leads with the citable `ADR-<n>` label,
  // which is display and not identity, and a fixture that took the first word would
  // link a rule to a label no projection answers to.
  const id = said.out.join('\n').match(/Recorded decision \S+ \(([^)]+)\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said.out.join(' / ')}`);
  return id;
}

/** Gives a rule an address through the real verb. */
async function addressAt(rule: string, path: string): Promise<Said> {
  return mnema('link', rule, path, '--rel', 'governs');
}

/** An agent connection over this project. */
function connect(): Session {
  return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
}

/** A content digest of every file under `dir`. */
function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${relative(dir, full)}\n`);
        walk(full);
      } else {
        hash.update(`F:${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-address-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'data') };
  process.chdir(repo);
  const initiated = await mnema('init');
  expect(initiated.failed, initiated.err.join(' / ')).toBe(false);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a path survives the write half the product already had', () => {
  it('records a path as a target and reads it back byte for byte', async () => {
    // Every shape a path can take that is still a path: a dot, a dash, an underscore,
    // a space, a digit, a non-ASCII letter. None of them is an id, and the catalog
    // takes all of them, because `target` was always a caller's string.
    const address = 'src/aç-ão_2/the file.spec.ts';
    mkdirSync(join(repo, 'src', 'aç-ão_2'), { recursive: true });
    const rule = await decide('how the odd module works');
    const linked = await addressAt(rule, address);
    expect(linked.failed, linked.err.join(' / ')).toBe(false);
    // The echo says what landed, and nothing was replaced.
    expect(linked.out.join('\n')).toContain(address);

    const reading = await reported('src/aç-ão_2/the file.spec.ts');
    expect(reading.rules.map((one) => one.recorded)).toEqual([address]);
    expect(reading.rules[0]?.rule).toBe(rule);
  });

  it('refuses a path that reads as a credential, and records nothing', async () => {
    // WHAT THIS CASE USED TO ASSERT, and what falsified it. It said the door "screens a
    // path exactly as it screens any other prose": `target` was classified PROSE, so a
    // credential inside a path was REPLACED and the reply said `replaced`. The premise
    // under that was that screening a field leaves the field. It does not, for an
    // address: `src/<SECRET:aws-access-key>/deploy.ts` is an address of no file, this
    // relation is read back by exact string, and the record cannot be edited. So
    // `target` is classified a NAME now and the whole write is refused — which is what
    // this proves, together with the half that matters more: the chain is untouched.
    const rule = await decide('how the deploy works');
    const secret = 'src/AKIAIOSFODNN7EXAMPLE/deploy.ts';
    const linked = await addressAt(rule, secret);
    expect(linked.failed).toBe(true);
    // It says the class and the field, and it quotes neither the value nor a piece of it.
    const said = linked.err.join('\n');
    expect(said).toContain('NAME_HOLDS_A_SECRET');
    expect(said).toContain('aws-access-key');
    expect(said).toContain('target');
    expect(said).not.toContain('AKIAIOSFODNN7EXAMPLE');

    // And nothing landed — not the value, and not a redacted stand-in for it either.
    const reading = await reported('src');
    expect(reading.stale.concat(reading.rules)).toEqual([]);
  });

  it('refuses nothing about the address: a path naming nothing is recorded', async () => {
    const rule = await decide('how a thing that does not exist yet works');
    const linked = await addressAt(rule, 'src/not-written-yet');
    expect(linked.failed, linked.err.join(' / ')).toBe(false);
    const reading = await reported('docs/anything.md');
    expect(reading.counts).toEqual({
      matching: 0,
      governing: 1,
      stale: 1,
      asks: NO_GATE,
    });
  });
});

describe('the reading answers, and charges nothing', () => {
  it('names the rule, its address and the tree, most specific first', async () => {
    mkdirSync(join(repo, 'src', 'collate'), { recursive: true });
    const wide = await decide('how the source tree is laid out');
    const narrow = await decide('how collation works');
    await addressAt(wide, 'src');
    await addressAt(narrow, 'src/collate');

    const reading = await reported('src/collate/fold.ts');
    expect(reading.rules.map((one) => one.address)).toEqual(['src/collate', 'src']);
    expect(reading.rules.map((one) => one.rule)).toEqual([narrow, wide]);
    expect(reading.rules.every((one) => one.assertedIn === 'public')).toBe(true);
    // G1's requirement of a charge: the id of the rule that caused it. It is here.
    const shown = await page('src/collate/fold.ts');
    expect(shown).toContain(narrow);
    expect(shown).toContain('how collation works');
  });

  it('does not govern a sibling that merely starts the same', async () => {
    mkdirSync(join(repo, 'src', 'collate'), { recursive: true });
    const rule = await decide('how collation works');
    await addressAt(rule, 'src/collate');

    const reading = await reported('src/collate_test.rb');
    expect(reading.rules).toEqual([]);
    expect(reading.counts.governing).toBe(1);
  });

  it('prints three numbers even when all three are zero', async () => {
    const shown = await page('src/anything.ts');
    expect(shown).toContain('0 govern this path · 0 address this project · 0 address nothing here');
    const reading = await reported('src/anything.ts');
    expect(reading.counts).toEqual({
      matching: 0,
      governing: 0,
      stale: 0,
      asks: NO_GATE,
    });
  });

  it('reports a path outside the project without pretending nothing governs it', async () => {
    const rule = await decide('how the source tree is laid out');
    await addressAt(rule, 'src');

    const reading = await reported(join(sandbox, 'elsewhere', 'src', 'app.ts'));
    expect(reading.relative).toBeUndefined();
    expect(reading.rules).toEqual([]);
    expect(reading.counts.governing).toBe(1);
    expect(await page(join(sandbox, 'elsewhere', 'src', 'app.ts'))).toContain(
      'outside this project',
    );
  });

  it('resolves a relative path against the working directory a person typed it in', async () => {
    mkdirSync(join(repo, 'packages', 'code', 'src'), { recursive: true });
    const rule = await decide('how this package works');
    await addressAt(rule, 'packages/code/src');

    process.chdir(join(repo, 'packages', 'code'));
    const reading = await reported('src/cli.ts');
    expect(reading.relative).toBe('packages/code/src/cli.ts');
    expect(reading.rules.map((one) => one.rule)).toEqual([rule]);
  });

  it('does not resolve a symlink, and the consequence is stated rather than hidden', async () => {
    // WHAT IT NORMALIZES IS TEXT: `.`, `..`, a trailing slash, a repeated separator,
    // and an absolute path under the root. A SYMLINK is not text, and resolving one
    // would mean touching the disk per segment — so two names for one file are two
    // addresses here, and a rule addressed at the real one is not found through the
    // link. This bench has been bitten by a textual resolution passing for a real one
    // (a symlink once made one project look like two), so the behaviour is FIXED by a
    // case rather than left to be discovered.
    mkdirSync(join(repo, 'src', 'collate'), { recursive: true });
    symlinkSync(join(repo, 'src', 'collate'), join(repo, 'linked'));
    const rule = await decide('how collation works');
    await addressAt(rule, 'src/collate');

    // Through the real name: found.
    expect((await reported('src/collate/fold.ts')).rules.map((one) => one.rule)).toEqual([rule]);
    // Through the link: NOT found — and the two counts beside it are what say the
    // mechanism is not empty, so the answer is "no rule addresses this name" rather
    // than "there are no rules".
    const through = await reported('linked/fold.ts');
    expect(through.rules).toEqual([]);
    expect(through.counts).toEqual({
      matching: 0,
      governing: 1,
      stale: 0,
      asks: NO_GATE,
    });
  });

  it('asks the working tree through the link, so a live symlink is not stale', async () => {
    // The other half: the disk PROBE follows a symlink, because it is `existsSync` and
    // that is what exists means. So an address at a live link is held and one at a
    // dangling link is stale — which is the same rule the third count always applies.
    mkdirSync(join(repo, 'src', 'real'), { recursive: true });
    symlinkSync(join(repo, 'src', 'real'), join(repo, 'live'));
    symlinkSync(join(repo, 'src', 'never-was'), join(repo, 'dangling'));
    const rule = await decide('how the linked area works');
    await addressAt(rule, 'live');
    await addressAt(rule, 'dangling');

    const reading = await reported('live/file.ts');
    expect(reading.counts).toEqual({
      matching: 1,
      governing: 2,
      stale: 1,
      asks: NO_GATE,
    });
    expect(reading.stale.map((one) => one.address)).toEqual(['dangling']);
  });

  it('writes nothing: the sandbox is byte for byte what it was', async () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    const rule = await decide('how the source tree is laid out');
    await addressAt(rule, 'src');
    await addressAt(rule, 'src/long-gone');
    // A record with something to report, so the guard cannot pass by finding nothing.
    const before = digest(sandbox);
    const reading = await reported('src/file.ts');
    expect(reading.counts).toEqual({
      matching: 1,
      governing: 2,
      stale: 1,
      asks: NO_GATE,
    });
    await page('src/file.ts');
    expect(digest(sandbox)).toBe(before);
  });

  it('exits clean on every shape of question, and refuses no move', async () => {
    mkdirSync(join(repo, 'src'), { recursive: true });
    const rule = await decide('how the source tree is laid out');
    await addressAt(rule, 'src');
    for (const path of ['src', 'src/deep/file.ts', '.', '/elsewhere/x', '../up']) {
      const said = await mnema('rules', path);
      expect(said.failed, `${path}: ${said.err.join(' / ')}`).toBe(false);
      expect(said.err, path).toEqual([]);
    }
  });

  it('refuses outside a project, because an address is relative to a root', async () => {
    process.chdir(sandbox);
    const said = await mnema('rules', 'src/file.ts');
    expect(said.failed).toBe(true);
    expect(said.err.join('\n')).toContain('project');
  });
});

describe('both surfaces answer out of the same derivation', () => {
  it('gives the agent and the person the same reading, field for field', async () => {
    mkdirSync(join(repo, 'src', 'collate'), { recursive: true });
    const wide = await decide('how the source tree is laid out');
    const narrow = await decide('how collation works');
    await addressAt(wide, 'src');
    await addressAt(narrow, 'src/collate');
    await addressAt(narrow, 'src/long-gone');

    const fromCli = await reported('src/collate/fold.ts');
    const session = connect();
    const fromTool = runGoverningRulesTool(session, { path: 'src/collate/fold.ts' });
    expect(fromTool.ok).toBe(true);
    if (!fromTool.ok) return;
    // The paths differ only in how each surface resolved a relative one — the command
    // line against a working directory, the server against the project root — and
    // everything the reading DERIVED is identical.
    expect(fromTool.value.relative).toBe(fromCli.relative);
    expect(fromTool.value.rules).toEqual(fromCli.rules);
    expect(fromTool.value.stale).toEqual(fromCli.stale);
    expect(fromTool.value.counts).toEqual(fromCli.counts);
    expect(fromCli.counts).toEqual({
      matching: 2,
      governing: 3,
      stale: 1,
      asks: NO_GATE,
    });
  });

  it('refuses the tool outside a project, as the verb does', () => {
    const outside = openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(sandbox).href],
      env,
    });
    const refused = runGoverningRulesTool(outside, { path: 'src/file.ts' });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.code).toBe('NO_PROJECT');
  });
});

describe('one place assembles a governs read', () => {
  /**
   * The derivations take their disk probe — or, for the reach, their WALK — as a
   * parameter, so each surface could bring its own. Two probes is two ideas of what
   * "the address exists" means, and two walks is two ideas of what a file of the
   * project IS; either would make a number depend on which surface asked. So
   * `governed-tree.ts` assembles them and every caller goes through that.
   *
   * THE LIST IS READ OFF THE COPILOT'S SOURCE, and that is the repair rather than a
   * detail. It used to be a literal pair — `governingRules` and `rulesInForceAt` —
   * with a comment saying a third derivation "is a gap somebody has to notice". A
   * third one shipped (`asksForAPersonAt`, the gate), nobody noticed, and this case
   * stayed GREEN while covering two of three: a guard whose scope is a hand-written
   * list is a guard that stops covering the rule the moment the rule grows. So the
   * derivations are now enumerated from the one file that defines them, by the shape
   * that makes one dangerous — taking an injected question — and a fourth
   * (`addressReach`) is in scope by existing.
   *
   * It looks for a CALL and not a mention: a doc-comment naming a derivation is how the
   * next reader learns which one a module means, and a guard that counted prose would
   * push the explanations out of the files that owe them.
   */
  const governance = fileURLToPath(
    new URL('../../copilot/src/intelligence/governance.ts', import.meta.url),
  );

  /** Every exported derivation of that module that takes an injected question. */
  function assembledDerivations(): string[] {
    const source = readFileSync(governance, 'utf-8');
    return [
      ...source.matchAll(/export function (\w+)\(([^)]*(?:GovernanceQuery|ReachQuery)[^)]*)\)/gs),
    ].map((match) => match[1] as string);
  }

  it('names every address derivation in exactly one module of this package', () => {
    const derivations = assembledDerivations();
    // The rule grew twice already; assert it is not reading an empty list, which is the
    // one way this whole case could pass by finding nothing.
    expect(derivations).toEqual(
      expect.arrayContaining([
        'governingRules',
        'rulesInForceAt',
        'asksForAPersonAt',
        'addressReach',
      ]),
    );
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const calls = new RegExp(`\\b(${derivations.join('|')})\\s*\\(`);
    const naming: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && calls.test(readFileSync(full, 'utf-8')))
          naming.push(relative(src, full));
      }
    };
    walk(src);
    expect(naming.sort()).toEqual(['governed-tree.ts']);
    // And every one of them IS exported from the copilot's barrel, so the walk cannot
    // be green over a name no surface could have reached in the first place.
    const copilot = readFileSync(
      fileURLToPath(new URL('../../copilot/src/index.ts', import.meta.url)),
      'utf-8',
    );
    for (const derivation of derivations) {
      expect(copilot, derivation).toContain(`  ${derivation},`);
    }
    // Every derivation is called there, and each exactly once: a second call site
    // inside the assembly is a second question being built.
    expect(
      readFileSync(join(src, 'governed-tree.ts'), 'utf-8').match(
        new RegExp(`\\b(${derivations.join('|')})\\s*\\(`, 'g'),
      ),
    ).toHaveLength(derivations.length);
  });
});
