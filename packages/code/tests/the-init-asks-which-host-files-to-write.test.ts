/**
 * `mnema init` asks, at a terminal, which agent hosts read the mnema instructions, and what files that means
 * (`init/flow.ts`, `init/run.ts`), and everything else about it stays as it was.
 *
 * THE QUESTION IS ON THE SCREEN THE BARE NAME USES: arrows, space, `a`, Enter and Esc, with the hosts found in
 * the folder checked, the files each host gets under it, and the person's own `CLAUDE.md` and `GEMINI.md` as
 * marks that can be left off. Then who may accept (`the-init-records-who-may-accept.test.ts`), and the whole plan
 * once, before anything is written.
 *
 * WHAT IS HELD HERE, each of them by the files on disk and the bytes of the folder and the home, never by
 * what a function says it did:
 *   - NOTHING IS WRITTEN BEFORE THE CONFIRMATION, and the person leaving at any step (Esc, Ctrl-C, Ctrl-D, or
 *     `Leave` at the plan) leaves the folder and the home as they were, byte for byte.
 *   - THE MARKS ARE THE FILES: a host unchecked gets no file, a `CLAUDE.md` unchecked is not touched, and a host
 *     found in the folder is the one that opens checked.
 *   - WITHOUT A TERMINAL NOTHING IS ASKED, and the four files are written as they always were.
 *
 * The cases run the program in process over a fake terminal that really draws (`support/console.ts`), and the
 * ones that need a real device run the built binary under a pseudo-terminal (`support/pty.ts`).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDoctor } from '../src/commands/doctor.js';
import { CHOOSABLE_INSTRUCTIONS, INSTRUCTIONS_TARGETS } from '../src/instructions-block.js';
import { widthOfText, withoutSequences } from '../src/presentation/width.js';
import { type CliIo, run } from '../src/program.js';
import { fakeTerminal, hooksNothing, until } from './support/console.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { arrivedSince, inPty } from './support/pty.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const REFERENCE = fileURLToPath(new URL('../../../docs/cli-reference.md', import.meta.url));

const PATHS = CHOOSABLE_INSTRUCTIONS.map((target) => target.path);
const [AGENTS, CLAUDE_RULE, COPILOT_RULE, CURSOR_RULE] = PATHS as [string, string, string, string];

/** The keys a person has, spelled by their code points like every control byte here. */
const ENTER = '\r';
const ESC = '\u001b';
const DOWN = '\u001b[B';
const RIGHT = '\u001b[C';
const SPACE = ' ';
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';

/** What each screen says of itself, which is how a case knows it is the one on the page. */
const HOSTS = 'Which agent hosts should read the mnema instructions?';
const ACCEPTS = 'May an agent accept the decisions you choose?';
const CONFIRM = 'Found the project with this plan?';

let sandbox: string;
let home: string;
let repo: string;
const kept = { cwd: process.cwd(), home: process.env.HOME };

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-init-asks-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'repo');
  mkdirSync(home);
  mkdirSync(repo);
  process.env.HOME = home;
  process.chdir(repo);
});

afterEach(() => {
  process.chdir(kept.cwd);
  if (kept.home === undefined) delete process.env.HOME;
  else process.env.HOME = kept.home;
  rmSync(sandbox, { recursive: true, force: true });
});

/** Every file under `directory`, with a digest of its bytes: what "nothing was written" is observed as. */
function digestOf(directory: string): Record<string, string> {
  const digests: Record<string, string> = {};
  const walk = (at: string, prefix: string): void => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(at, entry.name), relative);
      else {
        digests[relative] = createHash('sha256')
          .update(readFileSync(join(at, entry.name)))
          .digest('hex');
      }
    }
  };
  walk(directory, '');
  return digests;
}

/** Which of the offered files exist in the project. */
const written = (): string[] => PATHS.filter((path) => existsSync(join(repo, path)));

interface Heard {
  readonly out: string;
  readonly err: string;
  readonly failed: boolean;
}

/** A person at a fake terminal that really draws: the keys go in, and what was drawn comes out. */
interface Person {
  /** Waits for a screen to say `text`, among what was drawn since the last key. */
  readonly sees: (text: string) => Promise<void>;
  /** Presses keys. */
  readonly types: (keys: string) => void;
  /** Everything the program printed once it has finished. */
  readonly finished: () => Promise<Heard>;
  /** Everything drawn so far, as the device received it. */
  readonly drawn: () => string;
}

/**
 * One invocation at a terminal. The program runs at once, and the case drives it: waits for a screen, presses
 * what a person would, and at the end reads what the program said and whether it failed.
 */
function atATerminal(argv: readonly string[]): Person {
  const device = fakeTerminal({ columns: 100, rows: 60 });
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
    aPersonIsHere: true,
    terminal: { input: device.stdin, output: device.stdout, leaving: hooksNothing },
  };
  const running = run(argv, io);
  let mark = 0;
  return {
    sees: async (text) => {
      await until(() => device.bytes().slice(mark).includes(text), `drew "${text}"`, 800);
    },
    types: (keys) => {
      mark = device.bytes().length;
      device.type(keys);
    },
    finished: async () => {
      await running;
      return { out: out.join('\n'), err: err.join('\n'), failed };
    },
    drawn: () => device.bytes(),
  };
}

/** One invocation with nobody to ask: a script, a pipe, a host's shell. */
async function alone(argv: readonly string[]): Promise<Heard> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  await run(argv, {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  });
  return { out: out.join('\n'), err: err.join('\n'), failed };
}

/** Walks the three questions of a founding, answering each with Enter unless told otherwise. */
async function through(
  person: Person,
  answers: { hosts?: string; accepts?: string; plan?: string },
) {
  await person.sees(HOSTS);
  person.types(answers.hosts ?? ENTER);
  await person.sees(ACCEPTS);
  person.types(answers.accepts ?? ENTER);
  await person.sees(CONFIRM);
  person.types(answers.plan ?? ENTER);
}

function doctorSays(): string[] {
  return runDoctor({
    cwd: repo,
    env: { home },
    processEnv: { PATH: '' },
    running: { file: join(sandbox, 'mnema'), version: '9.9.9' },
  })
    .findings.filter((one) => one.topic === 'instructions')
    .map((one) => one.line);
}

describe('the hosts the question offers', () => {
  it('are the files init offers, in the words the reference uses for the hosts that read each', () => {
    const reference = readFileSync(REFERENCE, 'utf-8').replaceAll('`', '');
    for (const target of CHOOSABLE_INSTRUCTIONS) {
      expect(target.readers, target.path).toBeDefined();
      expect(reference, `${target.path} in the reference table`).toContain(`| ${target.path}`);
      expect(reference, `the hosts of ${target.path} in the reference table`).toContain(
        target.readers as string,
      );
    }
  });

  it('are exactly the files written whether or not the project had them', () => {
    expect(PATHS).toEqual(
      INSTRUCTIONS_TARGETS.filter((target) => target.when === 'always').map(
        (target) => target.path,
      ),
    );
    expect(PATHS).toHaveLength(4);
  });
});

describe('mnema init, at a terminal', { timeout: 60_000 }, () => {
  it('opens with every host checked where the folder shows none, and writes all four on three Enters', async () => {
    const person = atATerminal(['init']);
    await through(person, {});
    const heard = await person.finished();
    expect(heard.failed).toBe(false);
    expect(written()).toEqual(PATHS);
    expect(existsSync(join(repo, '.mnema'))).toBe(true);
    expect(person.drawn()).toContain('[x]');
    expect(heard.out).toContain('Founded');
  });

  it('writes only the hosts left checked: space unchecks the host the pick is on', async () => {
    const person = atATerminal(['init']);
    // The first row is Claude Code. Space unchecks it; Enter, and the rest as they came.
    await through(person, { hosts: `${SPACE}${ENTER}` });
    await person.finished();
    expect(written()).toEqual([AGENTS, COPILOT_RULE, CURSOR_RULE]);
  });

  it('moves with the arrows and holds at the ends: Down walks to a row and Space unchecks that one', async () => {
    const person = atATerminal(['init']);
    // Rows: Claude Code, Cursor, VS Code and Copilot CLI, Codex and others. Down, Down moves to VS Code.
    await through(person, { hosts: `${DOWN}${DOWN}${SPACE}${ENTER}` });
    await person.finished();
    expect(written()).toEqual([AGENTS, CLAUDE_RULE, CURSOR_RULE]);
  });

  it('toggles every host with `a`: all checked becomes none, and none writes no file of the instructions', async () => {
    const person = atATerminal(['init']);
    await through(person, { hosts: `a${ENTER}` });
    const heard = await person.finished();
    expect(heard.failed).toBe(false);
    expect(written()).toEqual([]);
    expect(existsSync(join(repo, '.mnema'))).toBe(true);
  });

  it('opens with the hosts the folder shows checked, and writes only those', async () => {
    mkdirSync(join(repo, '.cursor'));
    const person = atATerminal(['init']);
    await person.sees('detected: .cursor/');
    person.types(ENTER);
    await person.sees(ACCEPTS);
    person.types(ENTER);
    await person.sees(CONFIRM);
    person.types(ENTER);
    await person.finished();
    expect(written()).toEqual([CURSOR_RULE]);
  });

  it('offers a CLAUDE.md that is there as a mark of its own, and does not touch it when it is left off', async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Mine\n');
    writeFileSync(join(repo, 'GEMINI.md'), '# Also mine\n');
    const person = atATerminal(['init']);
    // Claude Code is found (its CLAUDE.md), so it opens checked, and so do the person's two files. The row
    // after Claude Code is its CLAUDE.md: Down, then Space leaves it off.
    await through(person, { hosts: `${DOWN}${SPACE}${ENTER}` });
    await person.finished();
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf-8')).toBe('# Mine\n');
    expect(readFileSync(join(repo, 'GEMINI.md'), 'utf-8')).toContain('mnema:begin');
    expect(existsSync(join(repo, CLAUDE_RULE))).toBe(true);
  });

  it('adds the block to a CLAUDE.md that is left checked, after what it holds', async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Mine\n');
    const person = atATerminal(['init']);
    await through(person, {});
    await person.finished();
    const text = readFileSync(join(repo, 'CLAUDE.md'), 'utf-8');
    expect(text.startsWith('# Mine\n')).toBe(true);
    expect(text).toContain('mnema:begin');
  });

  it('writes nothing until the confirmation: with the plan on the screen the folder and the home are untouched', async () => {
    const before = { project: digestOf(repo), home: digestOf(home) };
    const person = atATerminal(['init']);
    await person.sees(HOSTS);
    person.types(ENTER);
    await person.sees(ACCEPTS);
    person.types(ENTER);
    await person.sees(CONFIRM);
    expect(digestOf(repo)).toEqual(before.project);
    expect(digestOf(home)).toEqual(before.home);
    person.types(ESC);
    await person.finished();
  });

  for (const [where, keys] of [
    ['the hosts', [ESC]],
    ['the question about agents accepting', [ENTER, ESC]],
    ['the plan', [ENTER, ENTER, ESC]],
    ['the plan, on Leave', [ENTER, ENTER, `${RIGHT}${RIGHT}${ENTER}`]],
  ] as const) {
    it(`leaves the folder and the home as they were when the person leaves at ${where}, and exits 0`, async () => {
      const before = { project: digestOf(repo), home: digestOf(home) };
      const person = atATerminal(['init']);
      const screens = [HOSTS, ACCEPTS, CONFIRM];
      for (const [at, key] of keys.entries()) {
        await person.sees(screens[at] as string);
        person.types(key);
      }
      const heard = await person.finished();
      expect(heard.failed).toBe(false);
      expect(person.drawn()).toContain('Left. Nothing was founded and nothing was written.');
      expect(digestOf(repo)).toEqual(before.project);
      expect(digestOf(home)).toEqual(before.home);
      expect(existsSync(join(repo, '.mnema'))).toBe(false);
    });
  }

  for (const [name, key] of [
    ['Ctrl-C', CTRL_C],
    ['Ctrl-D', CTRL_D],
  ] as const) {
    it(`leaves at once on ${name}, with the folder and the home as they were`, async () => {
      const before = { project: digestOf(repo), home: digestOf(home) };
      const person = atATerminal(['init']);
      await person.sees(HOSTS);
      person.types(key);
      const heard = await person.finished();
      expect(heard.failed).toBe(false);
      expect(digestOf(repo)).toEqual(before.project);
      expect(digestOf(home)).toEqual(before.home);
    });
  }

  it('goes back to the questions on "Change the answers", opening on what was answered, and writes the new answer', async () => {
    const person = atATerminal(['init']);
    await through(person, { hosts: `${SPACE}${ENTER}`, plan: `${RIGHT}${ENTER}` });
    // Back at the hosts, with Claude Code still unchecked: Space checks it again, and the plan is agreed.
    await person.sees(HOSTS);
    person.types(`${SPACE}${ENTER}`);
    await person.sees(ACCEPTS);
    person.types(ENTER);
    await person.sees(CONFIRM);
    person.types(ENTER);
    await person.finished();
    expect(written()).toEqual(PATHS);
  });

  it('does not ask a second init, which writes no instructions, and does not ask where no project can be founded', async () => {
    await alone(['init']);
    const again = await alone(['init']);
    expect(again.out).toContain('Already a mnema project');
    process.chdir(home);
    const refused = await alone(['init']);
    expect(refused.failed).toBe(true);
    expect(refused.err).toContain('NOT_A_PROJECT_ROOT');
  });
});

describe('mnema init, with the answers given as flags', { timeout: 60_000 }, () => {
  it('writes the hosts --hosts names and no other, and the lines are the ones it always printed', async () => {
    const heard = await alone(['init', '--hosts', 'cursor,vscode']);
    expect(heard.failed).toBe(false);
    expect(written()).toEqual([COPILOT_RULE, CURSOR_RULE]);
    expect(heard.out).toContain(`Created ${CURSOR_RULE}, with the mnema instructions.`);
    expect(heard.out).not.toContain(CLAUDE_RULE);
  });

  it('reads `all`, `none` and `detected` as words, and `none` writes the record and no file of the instructions', async () => {
    mkdirSync(join(repo, '.cursor'));
    const none = await alone(['init', '--hosts', 'none']);
    expect(none.failed).toBe(false);
    expect(written()).toEqual([]);
    rmSync(join(repo, '.mnema'), { recursive: true });
    await alone(['init', '--hosts', 'detected']);
    expect(written()).toEqual([CURSOR_RULE]);
    rmSync(join(repo, '.mnema'), { recursive: true });
    rmSync(join(repo, CURSOR_RULE));
    await alone(['init', '--hosts', 'all']);
    expect(written()).toEqual(PATHS);
  });

  it('refuses a host it does not know, naming the list, and writes nothing', async () => {
    const before = { project: digestOf(repo), home: digestOf(home) };
    const heard = await alone(['init', '--hosts', 'cursor,pi']);
    expect(heard.failed).toBe(true);
    expect(heard.err).toContain('HOSTS_NOT_UNDERSTOOD');
    expect(heard.err).toContain('"pi"');
    expect(heard.err).toContain('claude, cursor, vscode, codex');
    expect(digestOf(repo)).toEqual(before.project);
    expect(digestOf(home)).toEqual(before.home);
  });

  it('refuses --all-hosts beside --hosts, which are the same answer given twice', async () => {
    const heard = await alone(['init', '--all-hosts', '--hosts', 'cursor']);
    expect(heard.failed).toBe(true);
    expect(heard.err).toContain('--all-hosts');
    expect(existsSync(join(repo, '.mnema'))).toBe(false);
  });

  it('adds the block to a CLAUDE.md under a host that is named, and leaves it where the host is not', async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Mine\n');
    await alone(['init', '--hosts', 'cursor']);
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf-8')).toBe('# Mine\n');
    rmSync(join(repo, '.mnema'), { recursive: true });
    await alone(['init', '--hosts', 'claude']);
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf-8')).toContain('mnema:begin');
  });

  it('with --dry-run prints the plan and writes nothing, in a folder that has no project and in one that has', async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Mine\n');
    const before = { project: digestOf(repo), home: digestOf(home) };
    const dry = await alone(['init', '--dry-run']);
    expect(dry.failed).toBe(false);
    expect(dry.out).toContain('Nothing was written.');
    expect(dry.out).toContain('create    .mnema/');
    expect(dry.out).toContain('add to    CLAUDE.md');
    expect(digestOf(repo)).toEqual(before.project);
    expect(digestOf(home)).toEqual(before.home);

    await alone(['init']);
    const founded = { project: digestOf(repo), home: digestOf(home) };
    const again = await alone(['init', '--dry-run']);
    expect(again.out).toContain('Already a mnema project');
    expect(digestOf(repo)).toEqual(founded.project);
    expect(digestOf(home)).toEqual(founded.home);
  });

  it('says in the dry run the same rows the founding then does: every file the plan names exists afterwards', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), '# Mine\n');
    const dry = await alone(['init', '--hosts', 'claude,codex', '--dry-run']);
    const named = [...dry.out.matchAll(/(?:create|add to)\s+(\S+)/g)].map((each) => each[1]);
    await alone(['init', '--hosts', 'claude,codex']);
    for (const path of named) {
      if (path === '~/.mnema/identity/') continue;
      expect(existsSync(join(repo, path as string)), `${path} named by the plan`).toBe(true);
    }
    expect(named).toContain(CLAUDE_RULE);
    expect(named).toContain(AGENTS);
  });

  it('with --all-hosts at a terminal asks nothing at all, as it always did, and writes the four files', async () => {
    const person = atATerminal(['init', '--all-hosts']);
    const heard = await person.finished();
    expect(heard.failed).toBe(false);
    expect(written()).toEqual(PATHS);
    expect(person.drawn()).not.toContain(HOSTS);
    expect(person.drawn()).not.toContain(ACCEPTS);
    expect(person.drawn()).not.toContain(CONFIRM);
  });

  it('with --yes at a terminal asks nothing, writes what the folder shows, and says it did not ask about agents', async () => {
    mkdirSync(join(repo, '.cursor'));
    const person = atATerminal(['init', '--yes']);
    const heard = await person.finished();
    expect(heard.failed).toBe(false);
    expect(written()).toEqual([CURSOR_RULE]);
    expect(person.drawn()).not.toContain(HOSTS);
    expect(heard.out).toContain('was not asked');
  });
});

describe('mnema init, with nobody to ask', { timeout: 30_000 }, () => {
  it('writes the four files and asks nothing, with or without --all-hosts, and says the same lines', async () => {
    const plain = await alone(['init']);
    const first = written();
    rmSync(join(repo, '.mnema'), { recursive: true });
    for (const path of PATHS) rmSync(join(repo, path), { recursive: true, force: true });
    const all = await alone(['init', '--all-hosts']);
    expect(first).toEqual(PATHS);
    expect(written()).toEqual(PATHS);
    const lines = (text: string) => text.split('\n').filter((line) => line.includes('Created '));
    expect(lines(all.out)).toEqual(lines(plain.out));
  });
});

describe('afterwards, the files on disk are the choice', { timeout: 60_000 }, () => {
  it('has doctor and --check say nothing about a file that was not chosen', async () => {
    await alone(['init', '--hosts', 'cursor']);
    expect(doctorSays()).toEqual([]);
    const check = await alone(['instructions', '--check']);
    expect(check.failed).toBe(false);
    expect(check.out).toBe(`  ${CURSOR_RULE} holds this version’s mnema instructions.`);
  });

  it('does not count a file of the person’s own with no block as chosen', async () => {
    writeFileSync(join(repo, AGENTS), '# Mine\n');
    await alone(['init', '--hosts', 'cursor']);
    expect(readFileSync(join(repo, AGENTS), 'utf-8')).toBe('# Mine\n');
    expect(doctorSays()).toEqual([]);
  });

  it('keeps what is there up to date and asks nothing when one of the files is there', async () => {
    await alone(['init', '--hosts', 'claude']);
    const again = atATerminal(['instructions']);
    const heard = await again.finished();
    expect(heard.failed).toBe(false);
    expect(again.drawn()).not.toContain(HOSTS);
    expect(written()).toEqual([CLAUDE_RULE]);
  });

  it('says all four are missing when none is there, as it did', async () => {
    await alone(['init', '--hosts', 'codex']);
    rmSync(join(repo, AGENTS));
    expect(doctorSays()).toEqual(
      PATHS.map((path) =>
        path === AGENTS
          ? 'AGENTS.md does not exist: `mnema instructions` creates it with the mnema instructions.'
          : `${path} does not exist: \`mnema instructions\` creates it with the mnema instructions.`,
      ),
    );
  });

  it('writes all four from a script when none is there, and asks the same question at a terminal', async () => {
    await alone(['init', '--hosts', 'codex']);
    rmSync(join(repo, AGENTS));
    const scripted = await alone(['instructions']);
    expect(scripted.failed).toBe(false);
    expect(written()).toEqual(PATHS);

    for (const path of PATHS) rmSync(join(repo, path));
    const person = atATerminal(['instructions']);
    await person.sees('Which agent hosts should the mnema instructions be written for?');
    // The files are gone and their folders are not, so the hosts found are Claude Code, VS Code and Cursor, and
    // not Codex (its AGENTS.md was deleted). Down, Down walks to VS Code, and Space leaves it off.
    person.types(`${DOWN}${DOWN}${SPACE}${ENTER}`);
    const heard = await person.finished();
    expect(heard.failed).toBe(false);
    expect(written()).toEqual([CLAUDE_RULE, CURSOR_RULE]);
  });

  it('leaves the folder as it was when the person leaves the question of `mnema instructions`', async () => {
    await alone(['init', '--hosts', 'codex']);
    rmSync(join(repo, AGENTS));
    const before = digestOf(repo);
    const person = atATerminal(['instructions']);
    await person.sees('Which agent hosts should the mnema instructions be written for?');
    person.types(ESC);
    const heard = await person.finished();
    expect(heard.failed).toBe(false);
    expect(person.drawn()).toContain('Left. Nothing was written.');
    expect(digestOf(repo)).toEqual(before);
  });

  it('offers the person’s own file as a mark in `mnema instructions` too, and leaves it alone when it is off', async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Mine\n');
    await alone(['init', '--hosts', 'none']);
    const person = atATerminal(['instructions']);
    await person.sees('Which agent hosts should the mnema instructions be written for?');
    // Claude Code is found by its CLAUDE.md. Down, Space leaves the person's CLAUDE.md off.
    person.types(`${DOWN}${SPACE}${ENTER}`);
    await person.finished();
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf-8')).toBe('# Mine\n');
    expect(existsSync(join(repo, CLAUDE_RULE))).toBe(true);
  });

  it('adds the rest with --all-hosts, and refuses it beside --check or --remove', async () => {
    await alone(['init', '--hosts', 'cursor']);
    const all = await alone(['instructions', '--all-hosts']);
    expect(all.failed).toBe(false);
    expect(written()).toEqual(PATHS);
    for (const other of ['--check', '--remove']) {
      const refused = await alone(['instructions', '--all-hosts', other]);
      expect(refused.failed, other).toBe(true);
      expect(refused.err).toContain('--all-hosts');
    }
  });
});

describe('on the built binary, under a pseudo-terminal', () => {
  const env = () => ({
    PATH: process.env.PATH ?? '',
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
  });

  const atTheDevice = (
    steps: { types?: string; until: (bytes: string, since: number) => boolean; what: string }[],
    extra: Record<string, string> = {},
    columns = 100,
  ) =>
    inPty(
      {
        cli: CLI,
        verb: 'init',
        project: repo,
        scratch: sandbox,
        environment: { ...env(), ...extra },
      },
      { columns, rows: 50, steps },
    );

  it('writes the files of the hosts left checked on three Enters, and exits 0', {
    timeout: 60_000,
  }, async () => {
    const ran = await atTheDevice([
      { until: arrivedSince(HOSTS), what: 'asked which hosts' },
      { types: `${SPACE}${ENTER}`, until: arrivedSince(ACCEPTS), what: 'asked who may accept' },
      { types: ENTER, until: arrivedSince(CONFIRM), what: 'showed the plan' },
      { types: ENTER, until: () => true, what: 'agreed' },
    ]);
    expect(ran.code).toBe(0);
    expect(written()).toEqual([AGENTS, COPILOT_RULE, CURSOR_RULE]);
    expect(ran.bytes).toContain('Founded');
    // The trail is continuous: no blank row between a frame and the line after it.
    expect(withoutSequences(ran.bytes)).not.toMatch(/\r?\n\r?\n/);
  });

  const asked = (screen: string) => ({ until: arrivedSince(screen), what: `showed ${screen}` });
  const leavesAfter = {
    'the hosts': [asked(HOSTS), { types: ESC, until: () => true, what: 'left' }],
    'the question about agents accepting': [
      asked(HOSTS),
      { types: ENTER, ...asked(ACCEPTS) },
      { types: CTRL_C, until: () => true, what: 'left' },
    ],
    'the plan': [
      asked(HOSTS),
      { types: ENTER, ...asked(ACCEPTS) },
      { types: ENTER, ...asked(CONFIRM) },
      { types: CTRL_D, until: () => true, what: 'left' },
    ],
  };
  for (const [at, steps] of Object.entries(leavesAfter)) {
    it(`leaves at ${at} with exit 0, and the folder and the home as they were`, {
      timeout: 60_000,
    }, async () => {
      const before = { project: digestOf(repo), home: digestOf(home) };
      const ran = await atTheDevice(steps);
      expect(ran.code).toBe(0);
      expect(ran.bytes).toContain('Left. Nothing was founded and nothing was written.');
      expect(digestOf(repo)).toEqual(before.project);
      expect(digestOf(home)).toEqual(before.home);
    });
  }

  it('paints no colour with NO_COLOR and with --color=never, and paints with --color=always', {
    timeout: 60_000,
  }, async () => {
    const styles = (text: string) =>
      (text.match(new RegExp(`${ESC}\\[[0-9;]*m`, 'g')) ?? []).length;
    const walk = [
      { until: arrivedSince(HOSTS), what: 'asked which hosts' },
      { types: ESC, until: () => true, what: 'left' },
    ];
    const quiet = await atTheDevice(walk, { NO_COLOR: '1' });
    expect(styles(quiet.bytes)).toBe(0);
    const never = await atTheDevice(walk, { FORCE_COLOR: '1' });
    expect(styles(never.bytes)).toBeGreaterThan(0);
  });

  it('draws every row of the questions inside a terminal sixty columns wide, the notes under what they are about', {
    timeout: 60_000,
  }, async () => {
    // The width is the renderer's, learned and never asked of the device by this flow: on a narrow terminal a
    // note that does not fit beside its row goes under it, a row of the trail of its own that keeps the guide.
    // What the product's fold does to a row that was laid out for more is break it with a hang and no guide,
    // which is the difference this case reads.
    mkdirSync(join(repo, '.cursor'));
    writeFileSync(join(repo, 'CLAUDE.md'), '# Mine\n');
    const ran = await atTheDevice(
      [
        asked(HOSTS),
        { types: ENTER, ...asked(ACCEPTS) },
        { types: ENTER, ...asked(CONFIRM) },
        { types: ESC, until: () => true, what: 'left' },
      ],
      {},
      60,
    );
    expect(ran.code).toBe(0);
    const rows = ran.bytes
      .split(/\r?\n/)
      .map((row) => withoutSequences(row))
      .filter((row) => row.trim() !== '');
    expect(rows.length).toBeGreaterThan(20);
    const wide = rows.filter((row) => widthOfText(row) > 60);
    // What is wider than the terminal is a path that cannot be cut, and nothing else.
    for (const row of wide) {
      expect(Math.max(...row.split(' ').map((word) => widthOfText(word))), row).toBeGreaterThan(52);
    }
    const underItsRow = rows.filter((row) => row.includes('detected: CLAUDE.md'));
    expect(underItsRow).toHaveLength(1);
    expect(underItsRow[0]?.startsWith('\u2502'), underItsRow[0]).toBe(true);
  });

  it('keeps every line of the trail on a line of its own where the layout runs for a screen reader', {
    timeout: 60_000,
  }, async () => {
    // INK_SCREEN_READER ends the frame it leaves without a line break, and the line printed after it was glued
    // to its last row: the guide of one step and the mark of the next on the same row.
    const ran = await atTheDevice(
      [
        asked(HOSTS),
        { types: ENTER, ...asked(ACCEPTS) },
        { types: ENTER, ...asked(CONFIRM) },
        { types: ENTER, until: () => true, what: 'agreed' },
      ],
      { INK_SCREEN_READER: 'true' },
    );
    expect(ran.code).toBe(0);
    expect(ran.bytes).toContain('Founded');
    expect(ran.bytes).not.toContain('\u2502\u25c7');
    expect(ran.bytes).not.toContain('\u2502\u25c6');
  });

  it('reaches the questions from the bare name’s menu, and reads the answers there', {
    timeout: 60_000,
  }, async () => {
    // The menu gives the terminal back with standard input unreferenced, and a question that came after it
    // was left waiting on nothing: the process ended with exit 0 in the middle of it.
    const ran = await inPty(
      { cli: CLI, verb: '', project: repo, scratch: sandbox, environment: env() },
      {
        columns: 100,
        rows: 50,
        steps: [
          { until: arrivedSince('establish a project here'), what: 'drew the menu' },
          { types: ENTER, until: arrivedSince(HOSTS), what: 'asked which hosts' },
          { types: `a${ENTER}`, until: arrivedSince(ACCEPTS), what: 'asked who may accept' },
          { types: ENTER, until: arrivedSince(CONFIRM), what: 'showed the plan' },
          { types: ENTER, until: () => true, what: 'agreed' },
        ],
      },
    );
    expect(ran.code).toBe(0);
    expect(ran.bytes).toContain('Founded');
    expect(written()).toEqual([]);
    expect(existsSync(join(repo, '.mnema'))).toBe(true);
  });

  it('asks nothing of a pipe or a closed input, and writes the four files as it always did', {
    timeout: 60_000,
  }, () => {
    const piped = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: repo,
      encoding: 'utf-8',
      env: env(),
      input: '',
    });
    expect(piped.status).toBe(0);
    expect(piped.stderr).not.toContain(HOSTS);
    expect(written()).toEqual(PATHS);

    rmSync(join(repo, '.mnema'), { recursive: true });
    for (const path of PATHS) rmSync(join(repo, path), { recursive: true, force: true });
    const closed = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: repo,
      encoding: 'utf-8',
      env: env(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(closed.status).toBe(0);
    expect(closed.stdout).not.toContain(HOSTS);
    expect(written()).toEqual(PATHS);
  });
});
