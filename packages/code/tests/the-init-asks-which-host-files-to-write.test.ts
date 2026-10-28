/**
 * `mnema init` asks, at a terminal, which of the files an agent host reads the mnema instructions are
 * written into (`wiring/which-host-files.ts`), and everything else about it stays as it was.
 *
 * Two readers of the same fact are held to each other: the question prints the hosts that
 * `INSTRUCTIONS_TARGETS` names for each file, and `docs/cli-reference.md` prints them in its table.
 *
 * WHAT THE FILES ON DISK SAY IS THE CHOICE (`chosenOnDisk`): a file the person did not choose is not
 * expected afterwards, so `mnema doctor` and `mnema instructions --check` look at the ones that hold the
 * instructions and say something about the others only when none does. That inverted an observable: a
 * file of ours deleted by hand used to be reported missing while the others stood, and is not any more.
 *
 * The cases run the program in process with a person who types what the case says (`ask`), and the ones
 * that need a real device run the built binary under a pseudo-terminal (`support/pty.ts`).
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
import { type CliIo, run } from '../src/program.js';
import {
  HOST_FILES_NOT_UNDERSTOOD,
  hostFilesQuestion,
  readHostFilesAnswer,
} from '../src/wiring/which-host-files.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';
import { arrivedSince, inPty } from './support/pty.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const REFERENCE = fileURLToPath(new URL('../../../docs/cli-reference.md', import.meta.url));

const PATHS = CHOOSABLE_INSTRUCTIONS.map((target) => target.path);
const [AGENTS, CLAUDE_RULE, COPILOT_RULE, CURSOR_RULE] = PATHS as [string, string, string, string];

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

interface Heard {
  readonly out: string;
  readonly err: string;
  readonly failed: boolean;
  /** The questions put to the person, in order. */
  readonly asked: readonly string[];
}

/**
 * One invocation. With `person`, a terminal is there and each question is answered by the next of
 * `person.types`; an entry that is an `Error` is the person leaving (what `readline` rejects with on
 * Ctrl-C and Ctrl-D). Without it there is nobody, as in a script or a host's shell.
 */
async function mnema(
  argv: readonly string[],
  person?: { readonly types: readonly (string | Error)[] },
): Promise<Heard> {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  let failed = false;
  const typed = [...(person?.types ?? [])];
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
    ...(person === undefined
      ? {}
      : {
          aPersonIsHere: true,
          ask: async (question: string) => {
            asked.push(question);
            const next = typed.shift();
            if (next === undefined) throw new Error('the case typed no answer for a question');
            if (next instanceof Error) throw next;
            return next;
          },
        }),
  };
  await run(argv, io);
  return { out: out.join('\n'), err: err.join('\n'), failed, asked };
}

const leaves = (): Error =>
  Object.assign(new Error('Aborted with Ctrl+C'), { code: 'ABORT_ERR' as const });

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

describe('the question', () => {
  it('lists every file init offers with the hosts that read it, in the words the reference uses', () => {
    const lines = hostFilesQuestion().join('\n');
    const reference = readFileSync(REFERENCE, 'utf-8').replaceAll('`', '');
    for (const target of CHOOSABLE_INSTRUCTIONS) {
      expect(target.readers, target.path).toBeDefined();
      expect(lines).toContain(`${target.path}: ${target.readers}`);
      expect(reference, `${target.path} in the reference table`).toContain(`| ${target.path}`);
      expect(reference, `the hosts of ${target.path} in the reference table`).toContain(
        target.readers as string,
      );
    }
  });

  it('offers exactly the files written whether or not the project had them', () => {
    expect(PATHS).toEqual(
      INSTRUCTIONS_TARGETS.filter((target) => target.when === 'always').map(
        (target) => target.path,
      ),
    );
    expect(PATHS).toHaveLength(4);
  });

  it('reads an empty line and "all" as every file, numbers as those files, and anything else as no answer', () => {
    expect(readHostFilesAnswer('')).toEqual(PATHS);
    expect(readHostFilesAnswer('  ')).toEqual(PATHS);
    expect(readHostFilesAnswer('ALL')).toEqual(PATHS);
    expect(readHostFilesAnswer('4 1')).toEqual([AGENTS, CURSOR_RULE]);
    expect(readHostFilesAnswer('2,3')).toEqual([CLAUDE_RULE, COPILOT_RULE]);
    expect(readHostFilesAnswer('2 2')).toEqual([CLAUDE_RULE]);
    for (const bad of ['0', '5', 'x', '1 x', '1.5', '-1', 'none']) {
      expect(readHostFilesAnswer(bad), bad).toBeUndefined();
    }
  });
});

describe('mnema init, with a person at the terminal', { timeout: 30_000 }, () => {
  it('asks before founding, and writes all four files on an empty answer', async () => {
    const heard = await mnema(['init'], { types: [''] });
    expect(heard.failed).toBe(false);
    expect(heard.asked).toHaveLength(1);
    expect(heard.err).toContain(`1. ${AGENTS}: Codex`);
    expect(written()).toEqual(PATHS);
  });

  it('writes only the files the person numbered, and says only those', async () => {
    const heard = await mnema(['init'], { types: ['1 4'] });
    expect(heard.failed).toBe(false);
    expect(written()).toEqual([AGENTS, CURSOR_RULE]);
    expect(heard.out).toContain(`Created ${AGENTS}, with the mnema instructions.`);
    expect(heard.out).toContain(`Created ${CURSOR_RULE}, with the mnema instructions.`);
    expect(heard.out).not.toContain(CLAUDE_RULE);
    expect(heard.out).not.toContain(COPILOT_RULE);
    expect(existsSync(join(repo, '.mnema'))).toBe(true);
  });

  it('still writes a CLAUDE.md or GEMINI.md that exists, whichever files were chosen', async () => {
    writeFileSync(join(repo, 'CLAUDE.md'), '# Mine\n');
    writeFileSync(join(repo, 'GEMINI.md'), '# Also mine\n');
    await mnema(['init'], { types: ['4'] });
    expect(written()).toEqual([CURSOR_RULE]);
    expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf-8')).toContain('mnema:begin');
    expect(readFileSync(join(repo, 'GEMINI.md'), 'utf-8')).toContain('mnema:begin');
  });

  it('leaves the project and the home as they were when the person leaves (Ctrl-C or Ctrl-D)', async () => {
    const before = { project: digestOf(repo), home: digestOf(home) };
    const heard = await mnema(['init'], { types: [leaves()] });
    expect(heard.failed).toBe(false);
    expect(heard.err).toContain('Nothing was founded and nothing was written.');
    expect(digestOf(repo)).toEqual(before.project);
    expect(digestOf(home)).toEqual(before.home);
    expect(existsSync(join(repo, '.mnema'))).toBe(false);
  });

  it('asks once more when the answer is not on the list, and writes the second', async () => {
    const heard = await mnema(['init'], { types: ['gemini', '2'] });
    expect(heard.failed).toBe(false);
    expect(heard.asked).toHaveLength(2);
    expect(heard.err).toContain('"gemini" is not on the list');
    expect(written()).toEqual([CLAUDE_RULE]);
  });

  it('refuses with a code and writes nothing when the second answer is not on the list either', async () => {
    const before = { project: digestOf(repo), home: digestOf(home) };
    const heard = await mnema(['init'], { types: ['gemini', '9'] });
    expect(heard.failed).toBe(true);
    expect(heard.err).toContain(HOST_FILES_NOT_UNDERSTOOD);
    expect(heard.err).toContain('Nothing was founded and nothing was written');
    expect(digestOf(repo)).toEqual(before.project);
    expect(digestOf(home)).toEqual(before.home);
  });

  it('does not ask a second init, which writes no instructions', async () => {
    await mnema(['init'], { types: ['3'] });
    const again = await mnema(['init'], { types: [] });
    expect(again.asked).toEqual([]);
    expect(again.out).toContain('Already a mnema project');
    expect(written()).toEqual([COPILOT_RULE]);
  });

  it('does not ask where no project can be founded (the home directory)', async () => {
    process.chdir(home);
    const heard = await mnema(['init'], { types: [] });
    expect(heard.asked).toEqual([]);
    expect(heard.failed).toBe(true);
    expect(heard.err).toContain('NOT_A_PROJECT_ROOT');
  });

  it('does not ask with --all-hosts, and writes every file (the option reaches the founding)', async () => {
    const heard = await mnema(['init', '--all-hosts'], { types: [] });
    expect(heard.asked).toEqual([]);
    expect(heard.failed).toBe(false);
    expect(written()).toEqual(PATHS);
  });
});

describe('mnema init, with nobody to ask', { timeout: 30_000 }, () => {
  it('writes the four files and asks nothing, with or without --all-hosts, and says the same lines', async () => {
    const plain = await mnema(['init']);
    const first = written();
    rmSync(join(repo, '.mnema'), { recursive: true });
    for (const path of PATHS) rmSync(join(repo, path), { recursive: true, force: true });
    const all = await mnema(['init', '--all-hosts']);
    expect(first).toEqual(PATHS);
    expect(written()).toEqual(PATHS);
    const lines = (text: string) => text.split('\n').filter((line) => line.includes('Created '));
    expect(lines(all.out)).toEqual(lines(plain.out));
    expect(plain.asked).toEqual([]);
  });
});

describe('afterwards, the files on disk are the choice', { timeout: 30_000 }, () => {
  it('has doctor and --check say nothing about a file that was not chosen', async () => {
    await mnema(['init'], { types: ['4'] });
    expect(doctorSays()).toEqual([]);
    const check = await mnema(['instructions', '--check']);
    expect(check.failed).toBe(false);
    expect(check.out).toBe(`  ${CURSOR_RULE} holds this version’s mnema instructions.`);
  });

  it('does not count a file of the person’s own with no block as chosen', async () => {
    writeFileSync(join(repo, AGENTS), '# Mine\n');
    await mnema(['init'], { types: ['4'] });
    expect(readFileSync(join(repo, AGENTS), 'utf-8')).toBe('# Mine\n');
    expect(doctorSays()).toEqual([]);
  });

  it('keeps what is there up to date and asks nothing when one of the files is there', async () => {
    await mnema(['init'], { types: ['2'] });
    const again = await mnema(['instructions'], { types: [] });
    expect(again.asked).toEqual([]);
    expect(written()).toEqual([CLAUDE_RULE]);
  });

  it('says all four are missing when none is there, as it did', async () => {
    await mnema(['init'], { types: ['1'] });
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
    await mnema(['init'], { types: ['1'] });
    rmSync(join(repo, AGENTS));
    const scripted = await mnema(['instructions']);
    expect(scripted.asked).toEqual([]);
    expect(written()).toEqual(PATHS);

    for (const path of PATHS) rmSync(join(repo, path));
    const asked = await mnema(['instructions'], { types: ['3'] });
    expect(asked.asked).toHaveLength(1);
    expect(written()).toEqual([COPILOT_RULE]);
  });

  it('writes nothing when the person leaves the question of `mnema instructions`', async () => {
    await mnema(['init'], { types: ['1'] });
    rmSync(join(repo, AGENTS));
    const before = digestOf(repo);
    const heard = await mnema(['instructions'], { types: [leaves()] });
    expect(heard.failed).toBe(false);
    expect(heard.err).toContain('Nothing was written.');
    expect(digestOf(repo)).toEqual(before);
  });

  it('adds the rest with --all-hosts, and refuses it beside --check or --remove', async () => {
    await mnema(['init'], { types: ['4'] });
    const all = await mnema(['instructions', '--all-hosts'], { types: [] });
    expect(all.asked).toEqual([]);
    expect(written()).toEqual(PATHS);
    for (const other of ['--check', '--remove']) {
      const refused = await mnema(['instructions', '--all-hosts', other]);
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

  const atATerminal = (steps: { types: string; what: string }[]) =>
    inPty(
      { cli: CLI, verb: 'init', project: repo, scratch: sandbox, environment: env() },
      {
        columns: 120,
        rows: 40,
        steps: [
          { until: arrivedSince('Enter for all'), what: 'asked which files' },
          ...steps.map((step) => ({
            types: step.types,
            until: () => true,
            what: step.what,
          })),
        ],
      },
    );

  it('writes the chosen files and exits 0', { timeout: 60_000 }, async () => {
    const ran = await atATerminal([{ types: '2 3\r', what: 'answered' }]);
    expect(ran.code).toBe(0);
    expect(written()).toEqual([CLAUDE_RULE, COPILOT_RULE]);
  });

  it('writes all four on Enter', { timeout: 60_000 }, async () => {
    const ran = await atATerminal([{ types: '\r', what: 'answered' }]);
    expect(ran.code).toBe(0);
    expect(written()).toEqual(PATHS);
  });

  for (const [name, key] of [
    ['Ctrl-C', '\u0003'],
    ['Ctrl-D', '\u0004'],
  ] as const) {
    it(`exits 0 at once on ${name}, with the project and the home as they were`, {
      timeout: 60_000,
    }, async () => {
      const before = { project: digestOf(repo), home: digestOf(home) };
      const started = Date.now();
      const ran = await atATerminal([{ types: key, what: 'left' }]);
      expect(ran.code).toBe(0);
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(ran.bytes).toContain('Nothing was founded and nothing was written.');
      expect(digestOf(repo)).toEqual(before.project);
      expect(digestOf(home)).toEqual(before.home);
    });
  }

  it('reaches the question from the bare name’s menu, and reads the answer there', {
    timeout: 60_000,
  }, async () => {
    // The menu gives the terminal back with standard input unreferenced, and the question that
    // came after it was left waiting on nothing: the process ended with exit 0 in the middle of it.
    const ran = await inPty(
      { cli: CLI, verb: '', project: repo, scratch: sandbox, environment: env() },
      {
        columns: 120,
        rows: 40,
        steps: [
          { until: arrivedSince('establish a project here'), what: 'drew the menu' },
          { types: '\r', until: arrivedSince('Enter for all'), what: 'asked which files' },
          { types: '2\r', until: () => true, what: 'answered' },
        ],
      },
    );
    expect(ran.code).toBe(0);
    expect(ran.bytes).toContain('Initialized mnema project at');
    expect(written()).toEqual([CLAUDE_RULE]);
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
    expect(piped.stderr).not.toContain('Which files');
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
    expect(closed.stderr).not.toContain('Which files');
    expect(written()).toEqual(PATHS);
  });
});
