/**
 * THE SHELL A PAGE PUBLISHES IS THE SHELL THAT RUNS — every verb, every flag.
 *
 * WHAT WAS UNCHECKED, AND WHAT IT COST. Three guards stand over published examples, and all
 * three read TYPESCRIPT: `the-example-is-read-from-the-page.test.ts` holds each page's ```ts
 * block against the case that runs it, `the-example-is-type-checked.test.ts` compiles those
 * blocks against the built declarations, and `readme-example.test.ts` in three packages is
 * the body they compare against. A shell block passes all of them as if it were not there.
 * The manual for the command line is 995 lines with ZERO ```ts blocks, so the page a person
 * actually types from was the one page nothing read. `NO_RUNNABLE_EXAMPLE` in
 * `support/published-examples.ts` says so in as many words, and excuses it.
 *
 * IT HAS ALREADY BEEN PAID FOR ONCE. `the-recipe-says-what-it-overwrites.test.ts` exists
 * because the first example on `mnema brief --help` was `mnema brief > AGENTS.md`, and on
 * the repository it was measured against that file held 126 lines of somebody's method.
 * Nothing caught it; a person did. That guard rules on ONE clause of ONE recipe — this one
 * rules on whether the words themselves name anything the binary has.
 *
 * WHAT IS CHECKED, AND WHY IT IS CHECKABLE WITHOUT RUNNING ANYTHING. Two things, and they
 * are the two a reader discovers by typing:
 *   - THE VERB EXISTS. Every `mnema <words>` published resolves through the real command
 *     tree — `buildProgram`, the same program the binary builds — and a word that reaches a
 *     command declaring no positional argument of its own is a verb this product has not
 *     got. `mnema verifyZZZ` is accused; nothing is executed to find out.
 *   - THE FLAG EXISTS. Every `--flag` is looked up on the command it was typed at and on
 *     that command's ancestors, so `mnema --color=never verify` is read the way commander
 *     reads it and `mnema verify --requireZZZ` is accused.
 * Both answers come off the program's own declarations, so a verb renamed in `src` and left
 * standing on a page goes red here on the next run rather than on somebody's terminal.
 *
 * THE DISCRIMINANT IS THE LINE, NOT THE FENCE LABEL. A guard keyed on ```sh would let a
 * page out by labelling its block `console`, `shell`, `bash` or nothing at all — and the
 * measurement says the risk is not hypothetical: of the 24 fenced blocks on
 * `packages/code/README.md`, 21 are ```sh, one is ```bash, one is ```json and one carries no
 * language. So every fenced block on every tracked page is swept, whatever it is called, and
 * a block is read for command lines rather than classified first. A block that carries none
 * — a JSON sample, a directory diagram — contributes nothing and needs no exemption.
 *
 * AND THE PAGES ARE SWEPT, NOT LISTED. `git ls-files '*.md'` is the reach; a page published
 * tomorrow is read by CARRYING a command, not by being named here, which is the shape
 * `the-recipe-says-what-it-overwrites` settled on for the same reason. `PAGES` below is a
 * reconciliation and never a filter: it is compared with what the sweep found in BOTH
 * directions, so a page that grows a command is accused, and so is one whose commands
 * disappear — which is how a sweep that quietly stopped sweeping is told apart from a
 * workspace that quietly stopped publishing.
 *
 * WHAT IT DOES NOT CHECK IS WRITTEN DOWN, in {@link NOT_CHECKED}, one entry per class with
 * the reason on it. An exemption with no reason is a hole; with a reason it is a limit.
 *
 * WHAT IT FOUND WHEN IT LANDED: nothing, and that was the prediction. 45 invocations across
 * two pages, every verb and every flag real. The value it has today is the next rename; the
 * value it is PROVED to have is the three mutations in this delivery's report, each of which
 * reddens it.
 *
 * ONE THING THIS READING SEES AND DOES NOT RULE ON, named because a number is better than a
 * shrug. Measured on 16/09/2026 against `36457c1b`: 147 inline code spans in tracked Markdown
 * open with `mnema`, outside any fence. Read as commands, five would be accused, and four of
 * those are prose a fence would never have held — `mnema ≈ base`, `mnema answers over MCP`.
 * The fifth is real: `measurements/p1/round-3/arms.md:136` publishes
 * `mnema switch --off edit-rules-push`, and the program has no `--off`; the act is
 * `mnema switch off`. That page is a frozen round's protocol, not product documentation, and
 * fixing published content is not this delivery — it is declared here and in the report.
 */

import { execFileSync } from 'node:child_process';
import type { Command, Option } from 'commander';
import { describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from '../src/cli.js';
import { ROOT, read } from './support/published-examples.js';
import { invocationsIn } from './support/reading-a-shell-line.js';

/** A silent port: nothing here runs a verb, it only reads what they declare. */
const silent: CliIo = { out: () => {}, err: () => {}, fail: () => {} };

// ---------------------------------------------------------------------------
// Sweeping the pages — the part that decides WHERE it was published
// ---------------------------------------------------------------------------

/** A command line a page publishes, with where it was found. */
export interface PublishedCommand {
  /** The page, relative to the workspace root. */
  readonly page: string;
  /** The line number on that page, one-based, so a failure is clickable. */
  readonly at: number;
  /** The fence language the block declared, or `<none>`. Carried to be REPORTED, never to filter. */
  readonly fence: string;
  /** The words after `mnema`. */
  readonly words: readonly string[];
  /** The published line itself, for the message a failure prints. */
  readonly source: string;
}

/**
 * Every `mnema …` line inside a fenced block of a tracked Markdown page.
 *
 * The fence is opened by a line starting with three backticks and closed by a line that is
 * three backticks and nothing else, which is CommonMark's rule for the closer and is what
 * keeps an info string on the opener from being read as a close.
 */
export function commandsOn(page: string, markdown: string): readonly PublishedCommand[] {
  const found: PublishedCommand[] = [];
  let fence: string | null = null;
  let at = 0;
  for (const source of markdown.split('\n')) {
    at += 1;
    if (fence === null) {
      if (source.startsWith('```')) fence = source.slice(3).trim() || '<none>';
      continue;
    }
    if (source.trimEnd() === '```') {
      fence = null;
      continue;
    }
    for (const words of invocationsIn(source)) found.push({ page, at, fence, words, source });
  }
  return found;
}

/** The same reading over the pages on disk. One function, so the corpus below cannot drift. */
export function publishedCommands(pages: readonly string[]): readonly PublishedCommand[] {
  return pages.flatMap((page) => commandsOn(page, read(page)));
}

/** Every Markdown page this repository publishes — the reach, and never a list. */
function trackedPages(): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', '*.md'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();
}

// ---------------------------------------------------------------------------
// Resolving an invocation against the program the binary builds
// ---------------------------------------------------------------------------

/** What resolving an invocation against the real command tree said about it. */
export interface Resolution {
  /** The words that named a command, in order: `['task', 'move']`. */
  readonly path: readonly string[];
  /** Every flag typed, where it was typed, and whether anything on that path declares it. */
  readonly options: readonly { readonly flag: string; readonly known: boolean }[];
  /** Words that named nothing: a command declaring no argument of its own was handed one. */
  readonly strays: readonly string[];
}

/** The commands from `command` up to the program — the scope a flag is looked up in. */
function chainTo(command: Command): readonly Command[] {
  const chain: Command[] = [];
  for (let at: Command | null = command; at !== null; at = at.parent) chain.push(at);
  return chain;
}

/**
 * An invocation walked against the program, left to right, the way commander walks it.
 *
 * A word is a SUBCOMMAND while one matches; the first that does not is a positional argument,
 * and after a positional nothing descends again — `mnema task move submit` reaches
 * `task move` and hands it `submit`, which is that command's declared `<action>`.
 *
 * A word handed to a command that declares NO argument is the accusation this guard exists
 * for. The program itself declares none, so `mnema verifyZZZ` has nowhere to go; a case below
 * asserts that emptiness, because a positional argument on the program would make every
 * unknown verb legal and this whole reading vacuous in silence.
 *
 * A FLAG'S VALUE IS NOT A WORD OF THE COMMAND. `--which release-bot` is one option and its
 * argument, so the value is stepped over — otherwise every published flag with a value would
 * be reported as an unknown verb, which is exactly what the first run of this reading did:
 * three false accusations, all of them option values.
 */
export function resolve(program: Command, words: readonly string[]): Resolution {
  let command = program;
  const path: string[] = [];
  const options: { flag: string; known: boolean }[] = [];
  const strays: string[] = [];
  let positional = false;
  const declaredFor = (flag: string): Option | undefined => {
    for (const at of chainTo(command)) {
      const found = at.options.find((one) => one.long === flag || one.short === flag);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (let at = 0; at < words.length; at += 1) {
    const word = words[at] as string;
    if (word.startsWith('-') && word !== '-' && word !== '--') {
      const flag = word.split('=')[0] as string;
      const declared = declaredFor(flag);
      // `--help` and `-h` are commander's own, on every command, and are declared nowhere.
      options.push({ flag, known: declared !== undefined || flag === '--help' || flag === '-h' });
      if (
        declared !== undefined &&
        !word.includes('=') &&
        (declared.required || declared.optional)
      ) {
        do at += 1;
        while (
          declared.variadic &&
          at + 1 < words.length &&
          !(words[at + 1] as string).startsWith('-')
        );
      }
      continue;
    }
    if (!positional) {
      const child = command.commands.find(
        (one) => one.name() === word || one.aliases().includes(word),
      );
      if (child !== undefined) {
        command = child;
        path.push(word);
        continue;
      }
    }
    positional = true;
    if (command.registeredArguments.length === 0) strays.push(word);
  }
  return { path, options, strays };
}

// ---------------------------------------------------------------------------
// The limits, written down
// ---------------------------------------------------------------------------

/**
 * What a published shell line carries that this guard does NOT rule on, and why each one.
 *
 * Read by a case below, so an entry cannot be added without a reason. The classes are
 * written as they were found in the corpus rather than imagined: every non-`mnema` head, every
 * value, and every effect of actually running the line.
 */
export const NOT_CHECKED: Readonly<Record<string, string>> = {
  ANOTHER_PROGRAM:
    'A command whose head is not `mnema`. The pages publish `npm i -g @mnema/code` and `pnpm add -g @mnema/code` — both, because the install a reader reaches for depends on the client they already have — plus `npm view @mnema/code version` \u2014 which the install sections publish because whether the package resolves is a fact about the registry and not one a page can state \u2014 plus `claude plugin install mnema@mnema`, `cd`, `export`, `unset`, `source`, `diff` and `less`. Whether those verbs and flags exist is a fact about somebody else’s program, and the only way to ask is to run it.',
  A_VALUE_IS_NOT_A_NAME:
    'The value of a positional argument or of a flag — `"$TASK"`, `mnid:c0fc3c71…`, `./skills`, `~/work/api`, a record body. They are ids that do not exist until somebody writes them, paths on somebody else’s disk, and prose. Nothing declarative can know them; a guard that tried would be asserting its own fixtures.',
  A_GATE_DECIDES_THE_MOVE:
    '`submit` in `mnema task move submit` is that command’s declared `<action>`, not a subcommand, so a misspelling of it is not visible here. Which moves exist is the gate’s answer over one record’s state, not the program’s declaration — asking it means founding a record, which is a different piece of work with a sandbox of its own.',
  A_TITLE_SWALLOWS_A_MISSPELLING:
    'A subcommand misspelt under a parent that ALSO declares a positional argument. `mnema task moveZZZ` is a legal invocation \u2014 it creates a task titled "moveZZZ" \u2014 so no reading of the declarations can call it wrong. Measured on 16/09/2026: of the eight commands with subcommands, three are in this state (`task <title>`, `decision <title> [rationale]`, `skill <name>`); the other five (`run`, `key`, `tail`, `witness`, `switch`) and the program itself declare no argument, and under those a misspelt verb IS accused.',
  THE_SHELL_IS_NOT_OURS:
    'Redirections, pipes and substitutions. The `>` in `mnema brief > MNEMA.md` belongs to the shell; the verb never learns there was a file. That hazard is ruled on by `the-recipe-says-what-it-overwrites.test.ts`, which requires every publisher of that recipe to say the file is replaced whole.',
  RUNNING_IS_NOT_READING:
    'Whether a line would SUCCEED. `mnema init` founds a tree, `mnema brief > MNEMA.md` truncates a file, `pnpm add -g` reaches the network. Execution would need a sandbox with its own `HOME` and `XDG_DATA_HOME`, because the global tree lives under `$XDG_DATA_HOME/mnema/global` and `mktemp -d` alone does not isolate it. Nothing here runs anything.',
  THE_OUTPUT_IS_A_SECOND_RULE:
    'The `#>` lines that show what a command prints. They are comments to the shell and they are dropped here. Whether the product really says those words is a different rule, and `cli.golden.test.ts` holds the bytes of every `--help` page against a committed transcript.',
  PROSE_IS_NOT_A_BLOCK:
    'Inline code spans outside any fence. Measured on 16/09/2026 against `36457c1b`: 147 of them open with `mnema`, and read as commands five would be accused — four of which are prose (`mnema ≈ base`, `mnema answers over MCP`). A reader copies a block; a span is a reference inside a sentence, and the reading that tells the two apart is the fence.',
};

/**
 * The pages that publish a command today, and how many each publishes.
 *
 * NOT A FILTER. The sweep reaches every tracked Markdown page; this is compared with what it
 * found, in both directions, and the comparison is the only thing it does. A page that starts
 * publishing commands is accused here until somebody looks at it, and a page whose commands
 * vanish is accused too — which is what tells a sweep that broke apart from a workspace that
 * changed. The counts are exact rather than a floor, because a floor is a number anyone can
 * lower to swallow a block that stopped being read.
 */
export const PAGES: Readonly<Record<string, number>> = {
  'README.md': 4,
  'packages/code/README.md': 44,
  'plugin/README.md': 5,
};

// ---------------------------------------------------------------------------

const program = buildProgram(silent).program;
const published = publishedCommands(trackedPages());

/** How a failure names one line, so the message is the address and the text. */
const where = (one: PublishedCommand): string => `${one.page}:${one.at}  ${one.source.trim()}`;

describe('the shell a page publishes is the shell that runs', () => {
  it('every verb a page publishes is a verb this program has', () => {
    const invented = published
      .filter((one) => resolve(program, one.words).strays.length > 0)
      .map((one) => `${where(one)}  — not a verb: ${resolve(program, one.words).strays.join(' ')}`);
    expect(invented).toEqual([]);
  });

  it('every flag a page publishes is a flag the command it is typed at has', () => {
    const invented: string[] = [];
    for (const one of published) {
      for (const option of resolve(program, one.words).options) {
        if (!option.known) invented.push(`${where(one)}  — no such flag: ${option.flag}`);
      }
    }
    expect(invented).toEqual([]);
  });
});

describe('the sweep knows what it swept', () => {
  it('the pages publishing commands are the pages the roster names', () => {
    const found: Record<string, number> = {};
    for (const one of published) found[one.page] = (found[one.page] ?? 0) + 1;
    // Both directions in one comparison: a page that grew commands appears on the left and
    // not the right, and a page the sweep stopped reaching appears on the right and not the
    // left. A sweep pointed at nothing empties the left side entirely.
    expect(found).toEqual(PAGES);
  });

  it('reads blocks by what they carry and not by what they are labelled', () => {
    // The fence languages actually swept, so narrowing the reading to one of them is a
    // change somebody has to make on purpose rather than a filter that quietly appears.
    const fences = [...new Set(published.map((one) => one.fence))].sort();
    expect(fences).toEqual(['bash', 'sh']);
  });

  it('the program it resolves against is the one with the verbs on it', () => {
    // A tree with one node would leave every published verb a stray and this guard screaming;
    // the dangerous direction is the other one, below.
    expect(program.commands.length).toBeGreaterThan(10);
  });

  it('the program takes no argument of its own, so an unknown verb has nowhere to go', () => {
    // THIS IS THE VACUITY. Give the program a positional argument and `mnema verifyZZZ`
    // becomes a legal invocation with one argument, every case above goes green forever, and
    // nothing says why.
    expect(program.registeredArguments).toEqual([]);
  });
});

describe('what it does not check is written down', () => {
  it('every exemption carries a reason', () => {
    const mute = Object.entries(NOT_CHECKED)
      .filter(([, why]) => why.length < 80)
      .map(([what]) => what);
    expect(mute).toEqual([]);
  });

  it('the exemptions are about classes the corpus really has', () => {
    // An exemption for something nothing publishes is decoration. Each of these is a line
    // that exists on a page today; if one stops existing, this case says which.
    const everyLine = Object.keys(PAGES).flatMap((page) => read(page).split('\n'));
    const carries = (needle: string): boolean => everyLine.some((line) => line.includes(needle));
    expect({
      ANOTHER_PROGRAM: carries('pnpm add -g @mnema/code'),
      A_VALUE_IS_NOT_A_NAME: carries('--which release-bot'),
      A_GATE_DECIDES_THE_MOVE: carries('mnema task move submit'),
      A_TITLE_SWALLOWS_A_MISSPELLING: carries('mnema task "Ship the parser"'),
      THE_SHELL_IS_NOT_OURS: carries('mnema brief > MNEMA.md'),
      THE_OUTPUT_IS_A_SECOND_RULE: carries('#> '),
    }).toEqual({
      ANOTHER_PROGRAM: true,
      A_VALUE_IS_NOT_A_NAME: true,
      A_GATE_DECIDES_THE_MOVE: true,
      A_TITLE_SWALLOWS_A_MISSPELLING: true,
      THE_SHELL_IS_NOT_OURS: true,
      THE_OUTPUT_IS_A_SECOND_RULE: true,
    });
  });
});

describe('the reading FIRES', () => {
  // Every reading above is shown working on a corpus written here, so a case that finds
  // nothing is distinguishable from one that cannot find anything.
  const said = (line: string): string[][] => invocationsIn(line).map((words) => [...words]);

  it('a quoted run is one word, and a trailing comment is not a word at all', () => {
    expect(said('mnema task "Ship the parser"   # the identity printed above')).toEqual([
      ['task', '"Ship the parser"'],
    ]);
  });

  it('a `#` inside quotes survives, because a record body may hold one', () => {
    expect(said('mnema memory "a # in the body"')).toEqual([['memory', '"a # in the body"']]);
  });

  it('a sample output line yields nothing — it is a comment to the shell too', () => {
    expect(said('#> Initialized mnema project at /path/to/repo/.mnema')).toEqual([]);
  });

  it('a head is found after a pipe, a substitution and a separator', () => {
    expect(said('source <(mnema completion bash)')).toEqual([['completion', 'bash']]);
    expect(said('mnema brief | diff - MNEMA.md')).toEqual([['brief']]);
    expect(said('cd repo; mnema verify')).toEqual([['verify']]);
    expect(said('mnema init && mnema verify')).toEqual([['init'], ['verify']]);
  });

  it('the word after a redirection is a file and never a command', () => {
    // Without this, the destination of `mnema completion bash > …/mnema` is read as a second
    // invocation with no words, and the count this guard reconciles is wrong by one per line.
    expect(said('mnema completion bash > /etc/bash_completion.d/mnema')).toEqual([
      ['completion', 'bash'],
    ]);
  });

  it('an environment prefix does not hide the command behind it', () => {
    expect(said('NO_COLOR=1 mnema verify')).toEqual([['verify']]);
    expect(said('ME=mnid:c0fc3c71')).toEqual([]);
  });

  it('`mnema` as an argument is not `mnema` as a command', () => {
    expect(said('which mnema')).toEqual([]);
    expect(said('rm -f /usr/local/bin/mnema')).toEqual([]);
  });

  it('a backtick is prose here, so a diagram that mentions a verb is not an invocation', () => {
    // The line is `plugin/README.md`'s, verbatim: reading `` ` `` as substitution made this a
    // 46th invocation, found inside a drawing of a directory tree.
    expect(said('│   └── session-start.mjs    runs `mnema brief`; silent')).toEqual([]);
  });

  it('an unknown verb is accused, and a real one is not', () => {
    expect(resolve(program, ['verifyZZZ']).strays).toEqual(['verifyZZZ']);
    expect(resolve(program, ['verify']).strays).toEqual([]);
    expect(resolve(program, ['key', 'revokeZZZ']).strays).toEqual(['revokeZZZ']);
    // And the argument of a command that declares one is not a stray: `task move` takes it.
    expect(resolve(program, ['task', 'move', 'submit', '"$TASK"']).strays).toEqual([]);
    // The limit, held as a case rather than as a sentence: `task` declares a `<title>`, so
    // a misspelt subcommand under it becomes that title and nothing here can see it. This
    // is the measurement behind NOT_CHECKED.A_TITLE_SWALLOWS_A_MISSPELLING, and it goes red
    // if `task` ever stops taking one — at which point the exemption should go too.
    expect(resolve(program, ['task', 'moveZZZ']).strays).toEqual([]);
  });

  it('an unknown flag is accused, and a real one is not, wherever it was typed', () => {
    const flags = (words: readonly string[]): Record<string, boolean> =>
      Object.fromEntries(resolve(program, words).options.map((one) => [one.flag, one.known]));
    expect(flags(['verify', '--requireZZZ=witnessed'])).toEqual({ '--requireZZZ': false });
    expect(flags(['verify', '--require=witnessed'])).toEqual({ '--require': true });
    // Typed at the program, before the verb, the way the page publishes it.
    expect(flags(['--color=never', 'verify'])).toEqual({ '--color': true });
    // And a flag that belongs to another verb is not borrowed by this one.
    expect(flags(['verify', '--anchor', 'mnid:c0fc3c71'])).toEqual({ '--anchor': false });
    expect(flags(['--help'])).toEqual({ '--help': true });
  });

  it("a flag's value is not read as a verb — including a variadic one", () => {
    expect(resolve(program, ['run', 'start', '--which', 'release-bot']).strays).toEqual([]);
    expect(resolve(program, ['verify', '--workspace', '~/work/api', '~/work/web']).strays).toEqual(
      [],
    );
    // But the value is consumed by the FLAG, not skipped blindly: what follows a flag that
    // takes nothing is still read.
    expect(resolve(program, ['verify', '--json', 'verifyZZZ']).strays).toEqual(['verifyZZZ']);
  });

  it('a block is read whatever its fence says, and prose blocks contribute nothing', () => {
    const page = (fence: string): string => `text\n\`\`\`${fence}\nmnema verify\n\`\`\`\n`;
    for (const fence of ['sh', 'bash', 'shell', 'console', 'zsh', '']) {
      expect(commandsOn('<written here>', page(fence)).map((one) => one.words)).toEqual([
        ['verify'],
      ]);
    }
    // And a line outside every fence is not swept, however it reads.
    expect(commandsOn('<written here>', 'mnema verify\n')).toEqual([]);
    // A fence that never closes runs to the end of the page rather than swallowing it.
    expect(commandsOn('<written here>', '```sh\nmnema verify\n').map((one) => one.words)).toEqual([
      ['verify'],
    ]);
  });
});
