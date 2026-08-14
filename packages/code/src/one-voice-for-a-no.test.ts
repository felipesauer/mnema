/**
 * ONE VOICE FOR A NO — the parser's refusals, and the four ways they could go wrong.
 *
 *   - THE SECOND VOICE COMES BACK. A verb added tomorrow, a code nobody thought of, a
 *     subcommand the walk does not reach: each of them answers `error: …` again, and
 *     nothing fails, because a usage error was already a correct exit code carrying an
 *     ugly line. So the sweep drives EVERY command the program declares — not a list
 *     written here — and reads what came out.
 *   - THE MESSAGE STOPS MATCHING THE DECLARATION. The whole argument for building the
 *     sentence out of `--help`'s own text is that there is one text. A case that
 *     re-typed the description would pass while the two drifted apart, so every case
 *     below reads the description OFF THE PROGRAM and asserts the line quotes it.
 *   - `--help` GETS CAUGHT IN IT. It arrives at the same catch, as the same class of
 *     throw, and rewriting or painting it would turn the answer a caller asked for
 *     into bad news. It is the dangerous inversion of this file's subject, so it has
 *     its own cases: exit zero, nothing on the error stream, not one escape byte.
 *   - THE FALLBACK GOES RAW. commander's codes are strings, not a union, so nothing in
 *     the compiler says the table is total. The case for that invents a code and
 *     asserts what comes out is still the product's shape.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo, run } from './cli.js';
import { renderPlain } from './presentation/plain.js';
import { renderStyled } from './presentation/styled.js';
import { everyCommandOf, misuseReport, speakUsageErrors, WORDED } from './wiring/misuse.js';
import { BLANK_WHICH_MESSAGE } from './wiring/options.js';

/** The escape byte, and red — what a no is painted with. */
const ESC = '\u001b';
const RED = `${ESC}[31m`;

/**
 * The escapes this surface writes, as a pattern — BUILT rather than written as a
 * literal, and that is not a preference: a regular expression literal holding a
 * control byte is a lint error, and the formatter folds the escape back into one if
 * the pattern is a plain template. (A control byte typed into the SOURCE is worse
 * still: it survives every review, being invisible.)
 */
const SGR = new RegExp(`${ESC}\\[(?:1|2|22|31|32|39)m`, 'g');

/** A silent port, for the cases that only want the declarations. */
const silent: CliIo = { out: () => {}, err: () => {}, fail: () => {} };

/** Everything one invocation wrote, split by stream, plus whether it failed. */
async function invoke(...argv: string[]): Promise<{
  out: string[];
  err: string[];
  failed: boolean;
}> {
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
  return { out, err, failed };
}

/** The code commander raised for an invocation — read from the throw, not the text. */
async function codeOf(argv: readonly string[]): Promise<string> {
  const { program } = buildProgram(silent, argv);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 'nothing was refused';
  } catch (error) {
    return error instanceof CommanderError ? error.code : 'not a commander error';
  }
}

/** The program's declarations, to read a description off rather than re-type it. */
const declared = (): Command => buildProgram(silent).program;

/** One command of the program, by the path a caller types. */
function commandNamed(...path: readonly string[]): Command {
  let at = declared();
  for (const name of path) {
    const found = at.commands.find((command) => command.name() === name);
    if (found === undefined) throw new Error(`no command \`${path.join(' ')}\``);
    at = found;
  }
  return at;
}

let sandbox: string;
const cwdBefore = process.cwd();
const envBefore = { ...process.env };

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-one-voice-'));
  const repo = join(sandbox, 'project');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(repo);
  await invoke('init');
}, 60_000);

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('every command of the program answers a misuse in the product’s voice', () => {
  it('leaves no path saying `error:` — asked of the tree, not of a list', async () => {
    // The adversarial question, answered by walking. An undeclared flag is the one
    // misuse EVERY command can be handed, whatever it declares, and it is refused
    // during the parse — so no action runs, nothing is written, and the server verb
    // does not open a connection.
    const commands = everyCommandOf(declared());
    expect(commands.length).toBeGreaterThan(30);
    for (const command of commands.slice(1)) {
      const path: string[] = [];
      for (let at: Command | null = command; at.parent !== null; at = at.parent) {
        path.unshift(at.name());
      }
      const said = await invoke(...path, '--not-a-flag-anybody-declared');
      const lines = said.err.join(String.fromCharCode(10));
      expect(said.failed, path.join(' ')).toBe(true);
      // WHICH no it earns is the parser's business — a command with a required flag
      // asks for that first — so what is asserted is the voice: the product names
      // itself, says the command, and commander's own sentence is nowhere on it.
      expect(lines, path.join(' ')).toContain(`mnema ${path.join(' ')}`);
      expect(lines, path.join(' ')).not.toContain('error:');
      expect(said.out, path.join(' ')).toEqual([]);
    }
  }, 60_000);

  it('says it for a subcommand two levels down, which only the walk reaches', async () => {
    // The depth case, kept separate from the sweep: a walk that stopped at the
    // program's own children would still pass every case about `mnema task`.
    const said = await invoke('task', 'move', 'submit');
    expect(said.err.join(String.fromCharCode(10))).toContain('mnema task move needs <id>');
  });

  it('covers a command nobody has written yet, by construction', async () => {
    // A verb added tomorrow is covered because the walk runs over what is registered,
    // not over a table. Built here as its own program so the case cannot be satisfied
    // by any verb that already exists.
    const said: string[] = [];
    const program = new Command().name('later').exitOverride();
    program
      .command('parent')
      .command('child')
      .argument('<needed>', 'the thing it needs')
      .action(() => {});
    const reached = speakUsageErrors(
      program,
      {
        io: { out: () => {}, err: (line) => said.push(line), fail: () => {} },
        render: renderPlain,
      },
      ['parent', 'child'],
    );
    expect(reached.map((command) => command.name())).toEqual(['later', 'parent', 'child']);
    await expect(program.parseAsync(['parent', 'child'], { from: 'user' })).rejects.toThrow();
    expect(said).toEqual([
      'later parent child needs <needed>: the thing it needs',
      '  later parent child [options] <needed>',
    ]);
  });
});

describe('and what it says comes from what the command already declares', () => {
  /**
   * One case per code the surface words: how to provoke it, and what the line has to
   * quote. The quoted text is READ FROM THE PROGRAM in each case — a case that typed
   * it here would go green while the help and the refusal drifted apart.
   */
  const cases: readonly (readonly [string, readonly string[], () => readonly string[]])[] = [
    [
      'commander.missingArgument',
      ['decision', 'a title'],
      () => {
        const decision = commandNamed('decision');
        const rationale = decision.registeredArguments.find((arg) => arg.name() === 'rationale');
        return ['mnema decision needs <rationale>', rationale?.description ?? ''];
      },
    ],
    [
      'commander.missingMandatoryOptionValue',
      ['run', 'end', 'whatever'],
      () => {
        const end = commandNamed('run', 'end');
        const which = end.options.find((option) => option.long === '--which');
        return [`mnema run end needs ${which?.flags ?? ''}`, which?.description ?? ''];
      },
    ],
    [
      'commander.optionMissingArgument',
      ['task', 'a title', '--which'],
      () => {
        const which = commandNamed('task').options.find((option) => option.long === '--which');
        return [`mnema task needs a value after ${which?.flags ?? ''}`, which?.description ?? ''];
      },
    ],
    ['commander.unknownOption', ['task', 'a title', '--nope'], () => ['does not take "--nope"']],
    ['commander.unknownCommand', ['nope'], () => ['mnema has no command "nope"']],
    ['commander.excessArguments', ['task', 'a title', 'and more'], () => ['"and more"']],
    [
      'commander.invalidArgument',
      ['task', 'a title', '--which', ' '],
      // The one code whose sentence the PRODUCT wrote: the option's own parser threw
      // it, and the line has to keep it rather than replace it with a frame.
      () => ['does not accept " " for --which <agent>', BLANK_WHICH_MESSAGE],
    ],
  ];

  it('has a case for every code the surface words, and no case for one it does not', () => {
    // The link between the table in `usage.ts` and the cases below. A wording added
    // without a case, or a case for a code the file does not word, shows up here.
    expect(cases.map(([code]) => code).sort()).toEqual([...WORDED]);
    expect(WORDED.length).toBeGreaterThanOrEqual(7);
  });

  it('provokes the code each case claims to provoke', async () => {
    // What keeps the table honest: a case whose invocation quietly started raising a
    // different code would still pass the case below (the sentence is generic enough)
    // and would leave its own code untested.
    for (const [code, argv] of cases) {
      expect(await codeOf(argv), argv.join(' ')).toBe(code);
    }
  }, 60_000);

  it('quotes the declaration, and puts the line to type under it', async () => {
    for (const [code, argv, quotes] of cases) {
      const said = await invoke(...argv);
      const lines = said.err;
      expect(said.failed, code).toBe(true);
      // Two lines and no more: the sentence, then the usage the help prints.
      expect(lines.length, code).toBe(2);
      for (const text of quotes()) {
        expect(text.length, code).toBeGreaterThan(3);
        expect(lines[0], code).toContain(text);
      }
      expect(lines[1], code).toMatch(/^ {2}mnema /);
      expect(lines.join(''), code).not.toContain('error:');
    }
  }, 60_000);

  it('and a token the CALLER typed cannot forge a second line, at any of the three', () => {
    // Three of the wordings put a token from the command line into the sentence, and a
    // token comes from a SHELL: a newline in it would end the refusal and start a line
    // of the reader's own — a complete, plausible second refusal about something that
    // never happened — and an escape byte would style everything after it. The line a
    // refusal occupies is the one-item list of the whole reply, which is exactly the
    // shape a forged second half has to imitate.
    //
    // Driven through `misuseReport` rather than through an invocation because the three
    // are three call sites of one rule, and a case per site is what makes it a rule
    // rather than a habit. What each of them refuses is asserted below.
    const forged = `nope${String.fromCharCode(10)}Refused (NOTHING): this never happened`;
    const styled = `nope${ESC}[31m`;
    const program = declared();
    const task = commandNamed('task');
    const shapes: readonly (readonly [string, () => readonly string[]])[] = [
      [
        'a word in the verb position',
        () => {
          program.args = [forged];
          return said(program, 'commander.unknownCommand', []);
        },
      ],
      ['a flag nothing declares', () => said(task, 'commander.unknownOption', [`--${forged}`])],
      [
        'an argument too many',
        () => {
          task.args = ['a title', forged, styled];
          return said(task, 'commander.excessArguments', []);
        },
      ],
    ];
    for (const [what, produce] of shapes) {
      const lines = produce();
      expect(lines.length, what).toBeGreaterThan(0);
      // It is still the value, readable — nothing was swallowed.
      expect(lines[0], what).toContain('nope');
      // But it is ONE line, and it carries nothing a terminal acts on: the break is
      // SHOWN (two characters) rather than taken, so the second half of the forgery
      // stays inside the quotes instead of becoming a refusal of its own.
      expect(lines[0], what).not.toContain(String.fromCharCode(10));
      expect(lines[0], what).not.toContain(ESC);
      expect(lines[0], what).toContain(String.raw`\n`);
    }
  });

  /** What the surface says about a fabricated misuse of `command`, rendered plain. */
  function said(command: Command, code: string, typed: readonly string[]): readonly string[] {
    return misuseReport({
      command,
      error: new CommanderError(1, code, 'the sentence this file does not read'),
      typed,
    }).map((line) => renderPlain(line));
  }

  it('words the SECOND shape of `invalidArgument`: a positional value, not a flag', async () => {
    // One code, two shapes. The table above has the option shape (`--which " "`), and the
    // other one was unreachable until a verb declared an ARGUMENT with `.choices()` — so
    // it fell through to the fallback and came out as commander's own sentence, `error:`
    // and all, on the only refusal `mnema completion` has. What it says now is the
    // declaration's: the term the usage line spells, and the description the help prints
    // WITH the choices after it, which is the text the caller has already read.
    const said = await invoke('completion', 'powershell');
    const completion = commandNamed('completion');
    const help = completion.createHelp();
    const shell = completion.registeredArguments[0] as (typeof completion.registeredArguments)[0];
    expect(said.failed).toBe(true);
    expect(said.err.length).toBe(2);
    expect(said.err[0]).toBe(
      `mnema completion does not accept "powershell" for <${shell.name()}>: ` +
        help.argumentDescription(shell),
    );
    expect(said.err[0]).toContain('choices');
    expect(said.err.join('')).not.toContain('error:');
    // And the code really is the one this case claims — the other shape's case would
    // otherwise be covering it.
    expect(await codeOf(['completion', 'powershell'])).toBe('commander.invalidArgument');
  });

  it('and the line to type is the one `--help` prints, not a second copy of it', async () => {
    // The other half of "one text": the usage line is composed by commander from the
    // same declarations, so it cannot drift from the Usage: line of the help.
    const said = await invoke('decision', 'a title');
    const help = await invoke('decision', '--help');
    const usage = commandNamed('decision');
    expect(said.err[1]).toBe(`  ${usage.createHelp().commandUsage(usage)}`);
    expect(help.out.join(String.fromCharCode(10))).toContain(
      `Usage: ${usage.createHelp().commandUsage(usage)}`,
    );
  });
});

describe('a code nobody worded still comes out through the funnel', () => {
  /** A code that does not exist, which is the point. */
  const invented = 'commander.somethingNobodyWorded';

  it('is not one of the worded ones', () => {
    expect(WORDED).not.toContain(invented);
  });

  it('takes the shape the surface already uses for a refusal it cannot word', () => {
    const lines = misuseReport({
      command: declared(),
      error: new CommanderError(1, invented, 'error: whatever commander decides to say'),
      typed: [],
    });
    expect(lines.length).toBe(1);
    const plain = renderPlain(lines[0] as (typeof lines)[number]);
    expect(plain).toBe(`Refused (${invented}): error: whatever commander decides to say`);
    // It is a NO like every other, so it is painted like every other. The message it
    // could not word is carried rather than dropped — the surface never invents a
    // sentence for a refusal it does not understand, and never lets one out unframed.
    expect(renderStyled(lines[0] as (typeof lines)[number])).toContain(RED);
  });
});

describe('`--help` and `--version` are not touched', () => {
  it('leave by the same door and are still the answer, on every command', async () => {
    // The inversion: they arrive as the same class of throw as a usage error. The
    // discriminant is the CODE, so a rule written on "it threw" would paint the help
    // red and exit non-zero on it.
    for (const command of everyCommandOf(declared())) {
      const path: string[] = [];
      for (let at: Command | null = command; at.parent !== null; at = at.parent) {
        path.unshift(at.name());
      }
      const said = await invoke(...path, '--help');
      const where = `mnema ${path.join(' ')} --help`;
      expect(said.failed, where).toBe(false);
      expect(said.err, where).toEqual([]);
      expect(said.out.join(''), where).toContain(`Usage: mnema${path.length > 0 ? ' ' : ''}`);
      expect(said.out.join(''), where).not.toContain('\u001b');
    }
  }, 60_000);

  it('stay plain even when the invocation asks for colour', async () => {
    // `--color=always` reaches the renderer, and the renderer is never handed the
    // help: commander writes it, this surface does not re-word it.
    const help = await invoke('--color=always', '--help');
    const version = await invoke('--color=always', '--version');
    expect(help.failed).toBe(false);
    expect(help.out.join('')).not.toContain('\u001b');
    expect(version.failed).toBe(false);
    expect(version.out).toEqual(['0.0.0']);
  });

  it('and the help shown INSTEAD of an error is still the help', async () => {
    // `mnema` with no verb prints the whole help and exits non-zero. It is the same
    // code as `--help`, so nothing is added to it — a caller who typed nothing is
    // being answered, not corrected.
    const said = await invoke();
    expect(said.failed).toBe(true);
    expect(said.err.join(String.fromCharCode(10))).toContain('Usage: mnema');
    expect(said.err.join(String.fromCharCode(10))).not.toContain('does not take');
  });
});

describe('the parser’s no is red, and says the same thing with the paint off', () => {
  it('paints the sentence and leaves the line to type alone', async () => {
    const styled = await invoke('--color=always', 'decision', 'a title');
    expect(styled.err[0]).toContain(RED);
    expect(styled.err[1]).not.toContain('\u001b');
  });

  it('loses nothing at all with `--color=never`', async () => {
    const plain = await invoke('--color=never', 'decision', 'a title');
    const styled = await invoke('--color=always', 'decision', 'a title');
    // Every word of the painted answer is in the plain one, and the plain one holds
    // no escape byte: the colour is a second copy of what the words already said.
    expect(styled.err.join('|').replace(SGR, '')).toBe(plain.err.join('|'));
    expect(plain.err.join('')).not.toContain('\u001b');
    expect(plain.err.length).toBe(2);
  });
});
