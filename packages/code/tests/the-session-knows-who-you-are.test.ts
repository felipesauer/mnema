/**
 * THE SESSION KNOWS WHO YOU ARE — a console that asks for what it has just printed, and
 * the four things that had to stay true while it stopped.
 *
 * It came out of use: `status` typed at the prompt was answered with *needs `--actor`
 * <id>*, two rows under a box naming `mnid:…`. The value the verb wanted was on the
 * screen, put there by the session itself, resolved from local material with no writer
 * opened (`repl/standing.ts`) — so the surface was asking a question it had already
 * answered.
 *
 * WHAT THE CASES ARE SHAPED AROUND is that a default is only honest if three other things
 * hold, and each of them is a different kind of measurement:
 *
 *   - IT ANSWERS, ON A DEVICE. The whole path — the panel's identity, the session's value,
 *     the line the parser receives — only exists inside a terminal, so the first case is
 *     the built binary in a real pseudo-terminal, and what it asserts is that the answer
 *     is the identity THE PAGE IS SHOWING.
 *   - WHAT THE CALLER TYPED WINS. Asking about another identity is a legitimate thing to
 *     do at an audit prompt, so the case types one — a second identity this record really
 *     knows, written by a second installation — and the answer follows it.
 *   - A SESSION THAT KNOWS NOBODY ASKS. Outside a project, or on a machine whose key root
 *     names no single key, there is nothing to fill and the verb has to ask exactly as it
 *     did. Asserted BYTE FOR BYTE against the same verb at a shell, because "the same
 *     message" is the kind of promise that decays into "a similar message".
 *   - AND THE COMMAND LINE IS UNTOUCHED. `mnema status` in the very directory where a
 *     session would have filled the flag in still refuses. The argument for the flag is
 *     about an INVOCATION having no session, and it is untouched by a session having one.
 *
 * THE FIFTH IS THE RULE'S OWN REACH (A1). Which verbs require an identity is read off the
 * registered program rather than listed here — by the tail every anchor-taking flag's help
 * carries, which is a discriminant the filling code does not share — and the two
 * enumerations are asserted EQUAL: everything that requires one is served, and nothing
 * else is touched. A fifth verb declared tomorrow is covered the day it exists, and a
 * flag renamed out from under the filler turns this red.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from '../src/cli.js';
import { renderPlain } from '../src/presentation/plain.js';
import { asTheSession } from '../src/repl/asking.js';
import { THE_FLOOR } from '../src/repl/floor.js';
import { typedLine } from '../src/repl/session.js';

import { ACTOR_HELP } from '../src/wiring/options.js';
import { REPL_VERB } from '../src/wiring/repl.js';
import { everyCommandOf } from '../src/wiring/usage.js';
import type { Declared } from '../src/wiring/verb.js';
import {
  inPty as drive,
  type Fixture,
  leavesTheSession,
  opensAConsole,
  type Ran,
  type Step,
} from './support/pty.js';

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

/** What the caller types in front of, as the layout writes it: trimmed at the end. */
const PROMPT = 'mnema>';

/**
 * How tall the terminal every case here drives is: THE FLOOR'S OWN HEIGHT.
 *
 * IT WAS FORTY, which had room to spare while the shortest window this console drew a page on
 * was twenty-four rows. The floor is forty-two now — the height the name is drawn whole at,
 * worked out from the drawing rather than written down (`src/repl/floor.ts`) — so forty is under
 * it, and a case that opened there would be driving
 * the screen that says the window is too small. Read off the product rather than retyped, so
 * the day the floor moves again these cases move with it.
 */
const PTY_ROWS = THE_FLOOR.rows;
const PTY_COLUMNS = 200;

/** The headline `status` answers with, after the identity it is answering for. */
const WHERE_THINGS_STAND = 'where things stand';

/** The half of the parser's refusal that names the flag. */
const ASKS_FOR_ONE = 'needs --actor';

// ---------------------------------------------------------------------------
// The fixture
// ---------------------------------------------------------------------------

let sandbox: string;
let project: string;
let environment: NodeJS.ProcessEnv;
/** The identity this installation founded the project with, whole. */
let mine: string;
/** A second identity the record knows, whole — written by a second installation. */
let other: string;
const before = { cwd: process.cwd(), env: { ...process.env } };

/** Everything one invocation wrote, on either stream. */
interface Said {
  readonly out: string[];
  readonly err: string[];
}

/** Captures what `work` writes through an injected port. */
async function captured(work: (io: CliIo) => Promise<void>): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  await work({
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => undefined,
  });
  return { out, err };
}

/** `mnema <argv>` at the shell, in this process, with output injected. */
const shell = (...argv: string[]): Promise<Said> => captured((io) => run(argv, io));

/**
 * One line typed at a session's prompt, by a session that knows `identity`.
 *
 * `undefined` is the session that knows nobody, and it is passed rather than defaulted:
 * a default parameter would swallow the value the case about it is made of.
 */
const prompt = (line: string, identity: string | undefined): Promise<Said> =>
  captured(async (io) => {
    await typedLine(line, { io, render: renderPlain, self: REPL_VERB, identity });
  });

/**
 * `mnema <argv>` run by a SECOND INSTALLATION on this machine: its own home, its own key
 * root, and therefore its own identity — in the same project.
 *
 * It is how the record comes to know two identities, which is what the case about a typed
 * `--actor` needs: a value that is not this session's and that the record can resolve. The
 * second identity is the PRODUCT'S, derived by the same code that derives the first —
 * nothing here writes an anchor into a fixture.
 */
async function asAnotherMachine(...argv: string[]): Promise<Said> {
  const was = { home: process.env.HOME, data: process.env.XDG_DATA_HOME };
  process.env.HOME = join(sandbox, 'other-home');
  process.env.XDG_DATA_HOME = join(sandbox, 'other-data');
  try {
    return await shell(...argv);
  } finally {
    process.env.HOME = was.home;
    process.env.XDG_DATA_HOME = was.data;
  }
}

/** Every identity the record knows, whole — read back through the verb that lists them. */
async function identitiesOfTheRecord(): Promise<string[]> {
  const said = await shell('accountability', '--json');
  const account = JSON.parse(said.out.join('\n')) as { byWho: { who: string }[] };
  return account.byWho.map((one) => one.who);
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-asking-'));
  project = join(sandbox, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(sandbox, 'other-home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // The bytes a session prints may not depend on the developer's shell.
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(project);

  const founded = await shell('init');
  const identity = founded.out.find((line) => line.trim().startsWith('identity:'));
  if (identity === undefined) throw new Error(`fixture: init printed no identity: ${founded.out}`);
  mine = identity.trim().slice('identity:'.length).trim();
  await shell('task', 'the task the console is asked about');

  // The second installation, writing into the same project: after this the record knows
  // two identities, and either one can be named at the prompt.
  await asAnotherMachine('memory', 'a fact the other machine recorded');
  const known = await identitiesOfTheRecord();
  const second = known.find((who) => who !== mine);
  if (second === undefined) throw new Error(`fixture: the record knows only ${known.join(', ')}`);
  other = second;

  environment = {
    ...process.env,
    HOME: join(sandbox, 'home'),
    XDG_DATA_HOME: join(sandbox, 'data'),
    TERM: 'xterm-256color',
  };
  delete environment.MNEMA_RUN;
}, 180_000);

afterAll(() => {
  process.chdir(before.cwd);
  process.env = before.env;
  rmSync(sandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A real pty: it answers, and it answers as the identity on the page
// ---------------------------------------------------------------------------

/** Runs `mnema repl` on a pseudo-terminal over the fixture. */
async function inPty(steps: readonly Step[]): Promise<Ran> {
  const fixture: Fixture = {
    cli: CLI,
    verb: REPL_VERB,
    project,
    scratch: sandbox,
    environment,
  };
  return drive(fixture, { columns: PTY_COLUMNS, rows: PTY_ROWS, steps });
}

/** The step every session begins with, and the one it ends with. */
const opens: Step = opensAConsole(PROMPT);
const leaves: Step = leavesTheSession;

/** The identity the PANEL is showing: the first one written after the project's path. */
function onThePanel(bytes: string): string {
  const at = bytes.indexOf(project);
  expect(at, 'the page never said which project it was opened over').toBeGreaterThan(-1);
  const shown = /mnid:[0-9a-f]+/.exec(bytes.slice(at))?.[0];
  expect(shown, 'the page named no identity at all').toBeDefined();
  return shown as string;
}

/** Whatever was written on the line that carries `what`. */
function theLineWith(bytes: string, what: string): string {
  const at = bytes.indexOf(what);
  expect(at, `nothing on the page said ${what}`).toBeGreaterThan(-1);
  return bytes.slice(bytes.lastIndexOf('\n', at) + 1, at);
}

describe('a verb that asks for an identity is answered by the session that has one', () => {
  it('answers `status` with no flag typed, as the identity its own panel names', async () => {
    const ran = await inPty([
      opens,
      {
        types: 'status\r',
        until: (bytes) => bytes.includes(WHERE_THINGS_STAND) || bytes.includes(ASKS_FOR_ONE),
        what: 'answered where things stand',
      },
      leaves,
    ]);
    // THE DEFECT, NAMED: this is the sentence the caller got instead of an answer.
    expect(ran.bytes, 'the console asked for what it had printed').not.toContain(ASKS_FOR_ONE);
    // THE ANSWER IS THE SESSION'S OWN IDENTITY, and the two halves are read off the same
    // page: what the panel shows, and who the report is for.
    const panel = onThePanel(ran.bytes);
    expect(theLineWith(ran.bytes, WHERE_THINGS_STAND)).toContain(panel);
    // NOT VACUOUS: the panel's short form is a PREFIX of the identity this installation
    // really founded, so what was filled in is this machine's own and not a string that
    // happens to appear twice.
    expect(mine.startsWith(panel)).toBe(true);
    expect(panel.length).toBeLessThan(mine.length);
    // And it really ran the read: the task the fixture created is in the answer.
    expect(ran.bytes).toContain('the task the console is asked about');
  }, 180_000);

  it('shows the caller what the caller typed, and nothing it typed for them', async () => {
    const ran = await inPty([
      opens,
      {
        types: 'status\r',
        until: (bytes) => bytes.includes(WHERE_THINGS_STAND),
        what: 'answered where things stand',
      },
      leaves,
    ]);
    // THE ECHO IS THE CALLER'S LINE. A session that echoed the line it assembled would be
    // showing somebody a line they did not write, on the row they are reading back.
    //
    // WITH THE ESCAPES OFF, because the echo is a composed line now: the prompt carries the
    // accent and what was typed carries a weight (`presentation/echo.ts`), so the two are not
    // contiguous bytes on the wire and a search of the raw stream finds neither. What is asked
    // is what a READER sees, which is what this case was always about.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the escape IS what is taken out.
    const said = ran.bytes.replace(/\u001b\[[0-9;]*m/g, '');
    expect(said).toContain(`${PROMPT} status`);
    // And the flag is nowhere on the page at all — not in the echo, not in a refusal.
    expect(ran.bytes).not.toContain('--actor');
  }, 180_000);
});

// ---------------------------------------------------------------------------
// What the caller typed wins
// ---------------------------------------------------------------------------

describe('the identity the caller names is the one that is answered for', () => {
  it('reports the typed identity, not the session’s own', async () => {
    // The value is another identity THIS RECORD KNOWS, written by a second installation,
    // so the prefix resolves the way any prefix a reader copies off a report does.
    const short = other.slice(0, 'mnid:'.length + 8);
    const said = await prompt(`status --actor ${short}`, mine);
    expect(said.err).toEqual([]);
    const headline = said.out[0] as string;
    expect(headline).toContain(WHERE_THINGS_STAND);
    expect(other.startsWith(headline.split(' ')[0] as string)).toBe(true);
    // AND IT IS NOT THE SESSION'S, which is the half that fails if the fill overrode the
    // caller: the two identities are different, and the answer names only one of them.
    expect(mine).not.toBe(other);
    expect(headline.startsWith(mine.slice(0, 'mnid:'.length + 8))).toBe(false);
    // The same session, asked with nothing typed, answers for ITSELF — so the case above
    // is about the flag winning rather than about a session that fills nothing.
    const own = await prompt('status', mine);
    expect((own.out[0] as string).startsWith(mine.slice(0, 'mnid:'.length + 8))).toBe(true);
  }, 120_000);

  it('leaves a half-typed flag to the parser, which says what is missing', async () => {
    // The caller began naming an identity. Filling one in would answer a question they
    // were in the middle of asking.
    const said = await prompt('status --actor', mine);
    expect(said.out).toEqual([]);
    expect(said.err.join('\n')).toContain('--actor');
    expect(said.err.join('\n')).not.toContain(WHERE_THINGS_STAND);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// A session that knows nobody asks the way it always has
// ---------------------------------------------------------------------------

describe('with no identity to speak as, the verb asks exactly as it did', () => {
  it('says what the same verb says at a shell, byte for byte', async () => {
    const atThePrompt = await prompt('status', undefined);
    const atTheShell = await shell('status');
    // THE WHOLE REFUSAL, both streams: the same sentence, the same detail, the same order.
    expect(atThePrompt.err).toEqual(atTheShell.err);
    expect(atThePrompt.out).toEqual(atTheShell.out);
    // NOT VACUOUS: it really is the refusal, and it still names where an identity comes
    // from — the promise that sentence makes to a reader who has none.
    expect(atThePrompt.err.join('\n')).toContain(ASKS_FOR_ONE);
    expect(atThePrompt.err.join('\n')).toContain('mnema accountability');
  }, 120_000);
});

// ---------------------------------------------------------------------------
// And the command line is untouched
// ---------------------------------------------------------------------------

describe('the command line still asks, in the very project where a session would not', () => {
  it('refuses `mnema status` here, and answers it when the actor is written out', async () => {
    // O-d. The argument for the required flag is about an INVOCATION having no session,
    // and this is the same directory, the same record and the same identity the console
    // fills in one word away.
    const refused = await shell('status');
    expect(refused.out).toEqual([]);
    expect(refused.err.join('\n')).toContain(ASKS_FOR_ONE);
    // And it is a refusal about the FLAG rather than about the project: written out, the
    // same verb in the same directory answers.
    const answered = await shell('status', '--actor', mine);
    expect(answered.out.join('\n')).toContain(WHERE_THINGS_STAND);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Every verb that requires an identity, and no other
// ---------------------------------------------------------------------------

/** The program, and what its verbs declared — one registration, read twice. */
function registered(): { program: Command; verbs: readonly Declared[] } {
  const quiet: CliIo = { out: () => undefined, err: () => undefined, fail: () => undefined };
  const built = buildProgram(quiet);
  return { program: built.program, verbs: built.verbs };
}

/** The words a line names to reach `command`: its own, and its parents', outermost first. */
function pathOf(command: Command): string[] {
  const names: string[] = [];
  for (let at: Command | null = command; at?.parent != null; at = at.parent) {
    names.unshift(at.name());
  }
  return names;
}

/**
 * A line that really reaches `command`: the words that name it, and something in the
 * position of every argument it requires.
 *
 * DERIVED RATHER THAN LISTED, because a table of invocations here would carry the same
 * blind spot the list of verbs would: a fifth verb, or a fourth argument on one of these,
 * and the case would be typing a line the parser refuses for a reason that has nothing to
 * do with an identity. An argument that enumerates its values gets one of its own
 * (`guard`'s action does); anything else gets a value that names nothing, which is enough
 * to get past the parser and into the verb.
 */
function invocationOf(command: Command): string[] {
  return [
    ...pathOf(command),
    ...command.registeredArguments
      .filter((argument) => argument.required)
      .map((argument) => argument.argChoices?.[0] ?? 'nothing-of-that-name'),
  ];
}

/** A value shaped like the one a panel is drawn with, for asking what a line becomes. */
const ME = 'mnid:7d30343b';

describe('every command that requires an identity is served, and nothing else is', () => {
  it('the two enumerations are the same set, read off the program two different ways', () => {
    const { program, verbs } = registered();
    const commands = everyCommandOf(program);

    // WHAT REQUIRES ONE, by a discriminant the filling code does not share: a MANDATORY
    // option whose help carries the tail every flag that takes an anchor carries
    // (`wiring/options.ts`). A flag renamed out from under the filler is still found here.
    const requires = commands
      .filter((command) =>
        command.options.some(
          (option) => option.mandatory && option.description.includes(ACTOR_HELP),
        ),
      )
      .map((command) => pathOf(command).join(' '))
      .sort();

    // WHAT IS SERVED, asked of the function itself over every command there is.
    const served = commands
      .map(pathOf)
      .filter((path) => path.length > 0 && asTheSession(path, verbs, ME).length > path.length)
      .map((path) => path.join(' '))
      .sort();

    expect(served).toEqual(requires);
    // NOT VACUOUS, in three ways: the walk really saw the surface, the set is not empty,
    // and it holds the four this was written for. A fifth arrives covered rather than
    // listed, which is why the assertion above is an equality and not this list.
    expect(commands.length).toBeGreaterThan(20);
    expect(requires.length).toBeGreaterThanOrEqual(4);
    for (const verb of ['focus', 'guard', 'resume', 'status']) expect(requires).toContain(verb);
    // And each one really gets the value, in the shape a parser reads.
    for (const path of requires) {
      expect(asTheSession(path.split(' '), verbs, ME), path).toEqual([
        ...path.split(' '),
        '--actor',
        ME,
      ]);
    }
  });

  it('none of them asks a session that knows itself, and every one asks one that does not', async () => {
    // THE RULE IN N POINTS, TYPED AT N POINTS — the enumeration above is about the words a
    // parser receives, and this is about what a caller gets back. Each command that
    // requires an identity is really run at a prompt, with the arguments it declares, and
    // whatever it then says, it does not ask for the identity.
    const { program } = registered();
    const requires = everyCommandOf(program).filter((command) =>
      command.options.some((option) => option.mandatory && option.description.includes(ACTOR_HELP)),
    );
    expect(requires.length).toBeGreaterThanOrEqual(4);
    for (const command of requires) {
      const line = invocationOf(command).join(' ');
      const knowing = await prompt(line, mine);
      expect([...knowing.out, ...knowing.err].join('\n'), line).not.toContain(ASKS_FOR_ONE);
      // NOT VACUOUS, PER COMMAND: the same line at a session that knows nobody asks for
      // one. Without this half, a verb refusing for some other reason reads as served.
      const knowingNobody = await prompt(line, undefined);
      expect(knowingNobody.err.join('\n'), line).toContain(ASKS_FOR_ONE);
    }
  }, 180_000);

  it('leaves the two shapes that look like it and are not', () => {
    const { verbs } = registered();
    // A MANDATORY option that is not an identity — a question only the caller can answer.
    // `link --rel <label>` is one, and a surface that filled it would invent an argument.
    expect(asTheSession(['link', 'a', 'b'], verbs, ME)).toEqual(['link', 'a', 'b']);
    // AND AN IDENTITY THAT IS NOT REQUIRED. `accountability --who` takes an anchor and its
    // default is EVERYBODY, so filling it would quietly turn "who authorized these facts"
    // into "which of them are mine" — in the caller's name, with nothing on screen saying
    // so. It is the shape closest to the rule and the one it must not touch.
    //
    // IT IS HELD HERE BY BOTH HALVES AT ONCE — the flag is spelled `--who` AND it is
    // optional — so this case cannot say which half is doing the work, and measured on a
    // mutation that dropped the requirement it stayed green. The half about a flag that
    // asks for the ASKER and is merely optional is exercised where such a declaration can
    // exist at all: `repl/asking.test.ts`, on a verb of its own.
    expect(asTheSession(['accountability'], verbs, ME)).toEqual(['accountability']);
    // Both are really there to be got wrong: each declares a flag of the kind above.
    const { program } = registered();
    const declares = (name: string, flag: string): boolean =>
      everyCommandOf(program)
        .find((command) => command.name() === name)
        ?.options.some((option) => option.long === flag) === true;
    expect(declares('link', '--rel')).toBe(true);
    expect(declares('accountability', '--who')).toBe(true);
  });
});
