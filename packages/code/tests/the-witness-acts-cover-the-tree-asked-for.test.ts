/**
 * THE WITNESS ACTS COVER THE TREE THEY WERE ASKED FOR — `--global` on `stamp` and `upgrade`, on the
 * binary.
 *
 * WHAT WAS WRONG. `witness` declares `--global` for its reading, and each act declared its own. The
 * group received every `--global` on the line, wherever it was written, and each act read its own
 * copy, which was never filled — so neither act ever covered the machine-global tree. Measured
 * outside a project, with a tail in that tree: `mnema witness --global` listed it, `mnema witness
 * stamp --global` answered that there was no tail here to witness, and `mnema witness upgrade
 * --global` said no tail held events in any tree — "looked in ." Inside a project, `upgrade
 * --global` went back for the public tail alone.
 *
 * WHAT IS ASSERTED. Written after the act, the flag reaches it: the stamp goes out for the global
 * tail — to ONE calendar that cannot resolve, named back in the refusal, which is how it is known
 * that a calendar was asked and that nothing else was — and the return visit reports the global
 * tail beside the public one. Written before the act, it is refused and pointed after it, the rule
 * `decision import` had first, and nothing is asked of anybody. And the reading's `--json` is not
 * an act's: refused, with the reading named.
 *
 * NO REAL CALENDAR IS EVER CONTACTED. `stamp` is only run against a host under `.invalid` (RFC
 * 2606), one per case — two of them once took more than five seconds to fail on a CI runner.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The built binary — what a person runs. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;
let project: string;
let outside: string;
let home: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-the-witness-acts-cover-'));
  project = join(sandbox, 'project');
  outside = join(sandbox, 'outside');
  home = join(sandbox, 'home');
  for (const directory of [project, outside, home]) mkdirSync(directory, { recursive: true });
  for (const argv of [
    ['init'],
    ['memory', 'a fact worth keeping'],
    ['memory', 'a personal note', '--scope', 'global'],
  ]) {
    const done = mnema(project, ...argv);
    expect(done.status, done.stderr).toBe(0);
  }
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** `mnema <argv>` in a directory, with the sandbox's HOME and nothing else of this machine's. */
function mnema(cwd: string, ...argv: string[]): { status: number | null; said: string } {
  const ran = spawnSync(process.execPath, [CLI, '--color=never', ...argv], {
    cwd,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: home },
  });
  return { status: ran.status, said: `${ran.stdout}${ran.stderr}` };
}

/** Every file under the sandbox, with its digest — what a refused line must leave as it was. */
function everything(): string {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(`${path} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
    }
  };
  walk(sandbox);
  return found.join('\n');
}

describe('outside a project, where only the machine-global tree resolves', () => {
  it('`witness --global` lists the one tail there — the reading this was measured against', () => {
    const { status, said } = mnema(outside, 'witness', '--global');
    expect(status).toBe(0);
    expect(said).toContain('1 tail(s)');
    expect(said).toContain('global');
  });

  it('`witness stamp --global` goes out for that tail', () => {
    const { status, said } = mnema(
      outside,
      'witness',
      'stamp',
      '--global',
      '--calendar',
      'https://outside-after.invalid',
    );
    // The calendar it was handed is the one that did not answer: the act found a tail to stamp.
    expect(said).toContain('outside-after.invalid');
    expect(said).not.toContain('there is no tail here to witness');
    expect(status).toBe(1);
  });

  it('`witness upgrade --global` goes back for that tail', () => {
    const { status, said } = mnema(outside, 'witness', 'upgrade', '--global');
    expect(status).toBe(0);
    expect(said).toContain('(global)');
    expect(said).not.toContain('No tail holds events in any tree here');
  });
});

describe('inside a project, with a public tail and a global one', () => {
  it('`witness upgrade` goes back for the public tail alone', () => {
    const { status, said } = mnema(project, 'witness', 'upgrade');
    expect(status).toBe(0);
    expect(said).toContain('(public)');
    expect(said).not.toContain('(global)');
  });

  it('`witness upgrade --global` goes back for both', () => {
    const { status, said } = mnema(project, 'witness', 'upgrade', '--global');
    expect(status).toBe(0);
    expect(said).toContain('(public)');
    expect(said).toContain('(global)');
  });
});

describe('what an act refuses, before it asks anybody anything', () => {
  it('its own --global written before it, pointed after it', () => {
    const was = everything();
    for (const [act, extra] of [
      ['stamp', ['--calendar', 'https://before-the-act.invalid']],
      ['upgrade', []],
    ] as const) {
      const { status, said } = mnema(outside, 'witness', '--global', act, ...extra);
      expect(status).toBe(1);
      expect(said).toContain(
        `\`witness ${act}\` takes its own --global: put it after \`${act}\`, not before.`,
      );
      expect(said).not.toContain('before-the-act.invalid');
    }
    expect(everything()).toBe(was);
  });

  it("the reading's --json, with the reading named", () => {
    const was = everything();
    const stamped = mnema(
      project,
      'witness',
      'stamp',
      '--json',
      '--calendar',
      'https://json.invalid',
    );
    expect(stamped.status).toBe(1);
    expect(stamped.said).toContain(
      '`witness stamp` takes no --json: an act answers in prose, and `mnema witness --json` is ' +
        'where each tail’s proof stands, as JSON.',
    );
    expect(stamped.said).not.toContain('json.invalid');
    const upgraded = mnema(project, 'witness', 'upgrade', '--json');
    expect(upgraded.status).toBe(1);
    expect(upgraded.said).toContain('`witness upgrade` takes no --json');
    expect(everything()).toBe(was);
  });
});
