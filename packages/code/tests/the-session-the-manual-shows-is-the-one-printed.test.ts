/**
 * THE SESSION THE MANUAL SHOWS IS THE ONE THE BINARY PRINTS — every command of the block under
 * "From the terminal", every line it prints, a cut only where the page marks one.
 *
 * WHAT WAS UNCHECKED. `the-first-record-a-page-shows-is-the-one-printed.test.ts` holds the root
 * page's first block to a run, and when the same cuts without a mark were found in this manual's
 * block they were corrected by hand and left unguarded: the block sets shell variables from what
 * a command printed (`ME=`, `TASK=`) and audits two projects the reader is imagined to have, so
 * the reading that runs the root page's four commands could not run it.
 *
 * WHAT IS CHECKED. The block's commands run in order, through the built binary, in a sandbox of
 * their own — its own `HOME`, its own repository — and each command's output is held to the `#>`
 * lines under it by the same comparison and the same reading of what is minted
 * (`support/a-page-held-to-a-run.ts`) the root page's case uses. Three things the root page's
 * block does not do are read here:
 *   - A VARIABLE IS BOUND TO WHAT THE BINARY PRINTED. `TASK=<an id>` names an id the page shows
 *     in an earlier command's output; the value bound is the one this run printed in its place,
 *     found by shape, and it has to be exactly one. The page's value has to be a shape of it, cut
 *     only with the page's mark.
 *   - `~` IS THE SANDBOX'S HOME, as a shell would expand it, and the home is printed back as
 *     `/home/you`, which is what the page writes for somebody's home.
 *   - THE WORLD THE PAGE IMAGINES IS BUILT, and declared ({@link WORLD}): each project it names
 *     under `~`, founded with one decision in it, and edited by hand where the page shows it
 *     `FAILED` — the crude edit the paragraph under the block says a verify catches. It is built
 *     just before the command that names it, because the block's own `init` is the machine's
 *     first and prints what only a first one prints.
 * A command whose output the page shows `FAILED` must exit non-zero, and every other must exit 0
 * and print nothing on the error stream, which the page does not show; the failing one names its
 * issues there, and that stream is not read.
 *
 * WHAT IT DOES NOT CHECK:
 *   - the prose around the block; and the values the page prints as examples, beyond their
 *     shape — except the one pair the page states a relation between, an alias and the id it
 *     says the alias is derived from, which has a case of its own;
 *   - a world other than the one declared: two projects, one intact and one broken, is what the
 *     page's output describes, and a different world could print different lines.
 */

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveAlias } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  accountsFor,
  asMinted,
  blockUnder,
  CUT,
  type Step,
} from './support/a-page-held-to-a-run.js';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The page, and the heading the block lives under. */
const PAGE = 'packages/code/README.md';
const SECTION = '### From the terminal';

/**
 * The projects the block names under `~`, and the state the page's own output shows each in.
 * Held against the block by a case below, so a page that names another project is a failure
 * rather than a world that no longer matches the page.
 */
const WORLD: Readonly<Record<string, 'intact' | 'broken'>> = {
  '~/work/api': 'intact',
  '~/work/web': 'broken',
};

let sandbox: string;
let repo: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-manual-session-'));
  repo = join(sandbox, 'repo');
  home = join(sandbox, 'home');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: repo });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** One run of the built binary, from `cwd`, with this sandbox's home and nothing else. */
function mnema(argv: readonly string[], cwd: string) {
  return spawnSync(process.execPath, [CLI, ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
}

/**
 * A line as a SHAPE: what belongs to the machine replaced by what it is, the repository written
 * the way the page writes one and the home the way it writes somebody's. Both sides go through
 * this one function.
 */
function asShape(line: string): string {
  let shaped = line;
  for (const [path, as] of [
    [realpathSync(repo), '/path/to/repo'],
    [repo, '/path/to/repo'],
    [realpathSync(home), '/home/you'],
    [home, '/home/you'],
  ] as const) {
    shaped = shaped.split(path).join(as);
  }
  return asMinted(shaped);
}

/** A page's value as a pattern over a printed one: literal, except where it marks a cut. */
function accounts(pageValue: string, printed: string): boolean {
  return accountsFor([asShape(pageValue)], [asShape(printed)]);
}

/** Everything a run minted and printed that a reader could copy into a variable. */
const COPYABLE =
  /mnid:[0-9a-f]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8,}/g;

/**
 * The value a reader's `NAME=value` holds in THIS run: the one thing an earlier command printed
 * whose shape the page's value accounts for. None, or more than one, and the binding is refused.
 */
function bound(step: Step & { kind: 'assignment' }, printedSoFar: string): string {
  const candidates = new Set(
    (printedSoFar.match(COPYABLE) ?? []).filter((one) => accounts(step.value, one)),
  );
  if (candidates.size !== 1) {
    throw new Error(
      `${PAGE}:${step.at} sets ${step.name}=${step.value}, and ${candidates.size} value(s) printed before it have that shape: ${[...candidates].join(', ')}`,
    );
  }
  return [...candidates][0] as string;
}

/** A word as a shell hands it over: `~` at its start is the home, `$NAME` its bound value. */
function expanded(word: string, variables: ReadonlyMap<string, string>, at: number): string {
  const tilde = word.startsWith('~/') ? `${home}${word.slice(1)}` : word;
  return tilde.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (_, name: string) => {
    const value = variables.get(name);
    if (value === undefined)
      throw new Error(`${PAGE}:${at} uses $${name}, which the block never sets`);
    return value;
  });
}

/** Founds each project of {@link WORLD} with one decision, and breaks the ones the page shows broken. */
function buildTheWorld(): void {
  for (const [where, state] of Object.entries(WORLD)) {
    const project = join(home, where.slice(2));
    mkdirSync(project, { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: project });
    for (const argv of [
      ['init'],
      ['decision', 'record', 'Use UTC', 'three services send three zones'],
    ]) {
      const ran = mnema(argv, project);
      if (ran.status !== 0)
        throw new Error(`setup: mnema ${argv.join(' ')} in ${where}: ${ran.stderr}`);
    }
    if (state === 'broken') editByHand(join(project, '.mnema', 'tails'));
  }
}

/**
 * The crude edit: one word of a recorded fact changed in place, with no hash recomputed — what
 * the paragraph under the block says a verify catches and exits 1 on.
 */
function editByHand(tails: string): void {
  for (const tail of readdirSync(tails)) {
    for (const file of readdirSync(join(tails, tail))) {
      if (!file.endsWith('.jsonl') || file === 'checkpoints.jsonl') continue;
      const path = join(tails, tail, file);
      const text = readFileSync(path, 'utf-8');
      if (!text.includes('"Use UTC"')) continue;
      writeFileSync(path, text.replace('"Use UTC"', '"Use UTX"'));
      return;
    }
  }
  throw new Error(`setup: no recorded fact to edit under ${tails}`);
}

describe('the session the manual shows from the terminal', () => {
  it('is what the binary prints, command by command, cut only where the page says so', () => {
    const variables = new Map<string, string>();
    const wrong: string[] = [];
    let built = false;
    let printedSoFar = '';
    for (const step of blockUnder(PAGE, SECTION)) {
      if (step.kind === 'assignment') {
        variables.set(step.name, bound(step, printedSoFar));
        continue;
      }
      // The world is built just before the first command that names it, and not before the
      // block: the block's `init` is this machine's first, which is the one that makes a backup
      // key, and a world founded earlier would have made it.
      if (!built && step.argv.some((word) => word.startsWith('~/'))) {
        buildTheWorld();
        built = true;
      }
      const argv = step.argv.slice(1).map((word) => expanded(word, variables, step.at));
      const ran = mnema(argv, repo);
      const where = `${PAGE}:${step.at} ${step.argv.join(' ')}`;
      const failed = step.shown.some((line) => line.includes('FAILED'));
      if (failed && ran.status === 0) wrong.push(`${where} shows FAILED and exited 0`);
      if (!failed && ran.status !== 0) wrong.push(`${where} exited ${ran.status}: ${ran.stderr}`);
      // A verdict that fails names its issues on the error stream, which the page does not show;
      // every other command has nothing to say there.
      if (!failed && ran.stderr !== '') {
        wrong.push(`${where} printed on the stream the page does not show: ${ran.stderr}`);
      }
      printedSoFar += ran.stdout;
      const printed = ran.stdout.replace(/\n$/, '').split('\n').map(asShape);
      const shown = step.shown.map(asShape);
      if (!accountsFor(shown, printed)) {
        wrong.push(
          `${where}\n--- the page shows:\n${shown.join('\n')}\n--- the binary printed:\n${printed.join('\n')}`,
        );
      }
    }
    // Every command is run and every difference is reported, rather than the first: a page
    // is corrected in one sitting, and a case that stops at the first line hides the rest.
    expect(wrong).toEqual([]);
  }, 30_000); // Sixteen processes of the built binary: four to build the world, twelve for the block.

  it('shows an alias that is derived from the id beside it, as the page says it is', () => {
    // THE ONE RELATION THE PAGE STATES between two of its example values: "`t-4f2a` is a
    // display alias derived from that id". Every other example value is held by shape; this
    // pair can be held by the product's own derivation.
    const created = blockUnder(PAGE, SECTION).find(
      (step) => step.kind === 'command' && step.argv[1] === 'task' && step.argv[2] === 'create',
    );
    const line = created?.kind === 'command' ? (created.shown[0] ?? '') : '';
    const pair = /\b(t-[0-9a-f]{4}) \(([0-9a-f-]{36})\)/.exec(line);
    expect(pair, `${PAGE} no longer shows a task created with its alias and id`).not.toBeNull();
    expect(deriveAlias('task', pair?.[2] as string)).toBe(pair?.[1]);
  });

  it('reads every command and every variable of the block, and the world it names', () => {
    // NON-VACUITY. A block the reader stopped finding, or a variable it stopped reading, would
    // make the first case hold over less than the page publishes.
    const steps = blockUnder(PAGE, SECTION);
    const commands = steps.flatMap((step) => (step.kind === 'command' ? [step] : []));
    expect(commands.map((step) => step.argv.slice(1, 3).join(' '))).toEqual([
      'init',
      'task create',
      'task move',
      'task move',
      'task move',
      'next-actions $TASK',
      'guard reopen',
      'verify',
      'verify --workspace',
    ]);
    expect(commands.every((step) => step.shown.length > 0)).toBe(true);
    expect(steps.flatMap((step) => (step.kind === 'assignment' ? [step.name] : []))).toEqual([
      'ME',
      'TASK',
    ]);
    // And the world is the one the block names, no more and no less.
    const named = commands.flatMap((step) => step.argv.filter((word) => word.startsWith('~/')));
    expect(named.sort()).toEqual(Object.keys(WORLD).sort());
  });

  it('binds a variable only to the one printed value its shape accounts for', () => {
    // THE BINDING'S OWN CASE: one candidate binds, none or two refuse, and a cut counts only
    // where the page marks it.
    const step = { kind: 'assignment', at: 1, name: 'ME', value: `mnid:c0fc3c71${CUT}` } as const;
    expect(
      bound(step, 'identity: mnid:9e775771126a5fe6\n  backup key: …/c85f1e2e50585eb1.key'),
    ).toBe('mnid:9e775771126a5fe6');
    expect(() => bound(step, 'nothing minted here')).toThrow(/0 value/);
    expect(() => bound(step, 'mnid:9e775771126a5fe6 and mnid:0123456789abcdef')).toThrow(/2 value/);
    const whole = { kind: 'assignment', at: 1, name: 'ME', value: 'mnid:c0fc3c71' } as const;
    expect(() => bound(whole, 'mnid:9e775771126a5fe6')).not.toThrow();
    expect(() => bound(whole, 'nothing')).toThrow();
  });
});
