/**
 * THE SHELL KNOWS THE VERBS — and the four ways a completion script goes wrong.
 *
 *   - IT FALLS A VERSION BEHIND. A verb added tomorrow, a subcommand, an option: each is
 *     a word the script does not offer, and nothing fails, because a completion that
 *     omits a word looks exactly like a shell that has not been told about it. So the
 *     coverage below is enumerated from the PROGRAM — every command `everyCommandOf`
 *     reaches, every option name derived from `.options` and the parent chain — and never
 *     from a list written in this file. The verb nobody has written yet has its own case,
 *     over a program built here so the twenty-six that exist cannot satisfy it.
 *   - IT DOES NOT PARSE, AND SAYS NOTHING. A shell that cannot read a completion script
 *     does not complain: it completes nothing, which is the defect being fixed. So the
 *     bash script is fed to `bash -n` AND DRIVEN — its function is called in a real bash
 *     with `COMP_WORDS` set, and what this file reads for bash is what bash actually
 *     replied. The other two are checked by their own parser when it is on the machine,
 *     and NAMED when it is not: an unrun check is a note here, never a silence.
 *   - IT EXECUTES WHAT IT WAS ONLY MEANT TO OFFER. Every word in the script comes from a
 *     declaration, and a declaration is English: five descriptions of this program hold an
 *     apostrophe, which ends a quote. Worse, `compgen -W` EXPANDS its wordlist, so a
 *     declaration holding `$(…)` would run on a keystroke. Both have a case, and the
 *     second is proved by driving a real bash over a declaration that holds `$(touch …)`
 *     and asserting the file was not created.
 *   - IT STARTS ANSWERING WHAT IT CANNOT KNOW. Completing an id or a transition means
 *     running mnema on every Tab, which costs more than the command. The boundary is
 *     asserted as a RULE — nothing is offered that is not a declared name or a value the
 *     declaration enumerates — and then as its consequence: none of the ten transitions
 *     is in any script, and the ten are read out of the sentence that names them rather
 *     than typed here.
 *
 * WHAT IS PINNED AND WHAT IS DERIVED. The three goldens hold the scripts byte for byte,
 * so a change of FORM is visible in review; the cases above hold the COVERAGE, so a
 * change of surface cannot pass by regenerating a golden.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Argument, Command, Option } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from '../src/cli.js';
import { completionScript } from '../src/completion/script.js';
import { SHELLS, type Shell } from '../src/wiring/completion.js';
import { everyCommandOf } from '../src/wiring/usage.js';

/** A silent port: everything here reads declarations and writes nothing. */
const silent: CliIo = { out: () => {}, err: () => {}, fail: () => {} };

/** The program as the binary builds it. */
const declared = buildProgram(silent).program;

/** The three scripts, generated once from that program. */
const SCRIPT: Readonly<Record<Shell, string>> = {
  bash: completionScript(declared, 'bash'),
  zsh: completionScript(declared, 'zsh'),
  fish: completionScript(declared, 'fish'),
};

/** Where the driven bash writes, if it ever writes anything. */
const sandbox = mkdtempSync(join(tmpdir(), 'mnema-completion-'));

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// What the program declares
// ---------------------------------------------------------------------------

/** The words that reach a command, without the program's own name. */
function pathOf(command: Command): readonly string[] {
  const names: string[] = [];
  for (let at: Command | null = command; at.parent !== null; at = at.parent) {
    names.unshift(at.name());
  }
  return names;
}

/** Every command of the program, by the path a caller types. Root first, as `''`. */
const PATHS: readonly string[] = everyCommandOf(declared).map((command) =>
  pathOf(command).join(' '),
);

/**
 * Every flag spelling the parser accepts at a command, derived independently.
 *
 * From `.options` and the parent chain — NOT from the generator's own reading of the
 * help's `visibleOptions` — plus `-h`/`--help`, which every command answers to and no
 * command declares. A test that asked the production code what it should have produced
 * would assert nothing at all.
 */
function accepted(command: Command): readonly string[] {
  const names = new Set<string>(['-h', '--help']);
  for (let at: Command | null = command; at !== null; at = at.parent) {
    for (const option of at.options) {
      if (option.short !== undefined) names.add(option.short);
      if (option.long !== undefined) names.add(option.long);
    }
  }
  return [...names];
}

/** The ten transitions, read out of the sentence in `task move`'s help that lists them. */
function transitionsNamedInTheHelp(): readonly string[] {
  const move = everyCommandOf(declared).find(
    (command) => pathOf(command).join(' ') === 'task move',
  );
  const action = move?.registeredArguments.find((argument) => argument.name() === 'action');
  const inParens = /\(([^)]*)\)/.exec(action?.description ?? '');
  return (inParens?.[1] ?? '').split(',').map((name) => name.trim());
}

// ---------------------------------------------------------------------------
// What a script offers, read the way its shell reads it
// ---------------------------------------------------------------------------

/** One `case` row of a bash or zsh table: `'<key>') echo '<words>' ;;`. */
const POSIX_ROW = /^ {4}'([^']*)'\) echo '([^']*)' ;;$/;

/** What a POSIX-table script offers at one level, from the rows keyed by it. */
function posixOffered(script: string, path: string): readonly string[] {
  const offered: string[] = [];
  for (const line of script.split('\n')) {
    const row = POSIX_ROW.exec(line);
    if (row === null) continue;
    const key = row[1] as string;
    // The level's own rows, and the values of a positional argument (`<path>:`).
    if (key === path || key === `${path}:`) offered.push(...(row[2] as string).split(' '));
  }
  return offered;
}

/** What the fish script offers at one level, from the `complete` lines guarded by it. */
function fishOffered(script: string, path: string, command = 'mnema'): readonly string[] {
  const offered: string[] = [];
  const guard = `-n '__${command}_at "${path}"'`;
  for (const line of script.split('\n')) {
    if (!line.startsWith('complete ') || !line.includes(guard)) continue;
    const words = /-a '([^']*)'/.exec(line);
    if (words !== null) offered.push(...(words[1] as string).split(' '));
    const short = / -s (\S+)/.exec(line);
    if (short !== null) offered.push(`-${short[1] as string}`);
    const long = / -l (\S+)/.exec(line);
    if (long !== null) offered.push(`--${long[1] as string}`);
  }
  return offered;
}

// ---------------------------------------------------------------------------
// A real shell
// ---------------------------------------------------------------------------

/** Whether a shell is on this machine at all. */
function present(shell: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${shell}`], { encoding: 'utf-8' }).status === 0;
}

/** What a shell's own parser says about a script: nothing, when it accepts it. */
function complaintOf(shell: string, script: string, name: string): string {
  const file = join(sandbox, name);
  writeFileSync(file, `${script}\n`);
  const done = spawnSync(shell, ['-n', file], { encoding: 'utf-8', cwd: sandbox });
  return done.status === 0 ? '' : `${done.stderr}${done.stdout}`.trim();
}

/**
 * What a real bash replies for a line, for every line asked at once.
 *
 * One process for all of them: it sources the script, then calls the completion
 * function with `COMP_WORDS` and `COMP_CWORD` set exactly as bash sets them, which is
 * the only way to learn what bash would have offered rather than what this file thinks
 * the script says.
 */
function drivenBash(script: string, lines: readonly (readonly string[])[]): Map<string, string[]> {
  const file = join(sandbox, 'driven.bash');
  writeFileSync(file, `${script}\n`);
  const asked = lines.map((words) => words.join(' '));
  const program = [
    `source ${single(file)}`,
    'drive() {',
    '  COMP_WORDS=("$@")',
    '  COMP_CWORD=$(( $# - 1 ))',
    '  COMPREPLY=()',
    '  _mnema',
    `  printf "%s\\n" "\${COMPREPLY[@]}"`,
    '}',
    ...lines.map((words, index) => {
      const typed = ['mnema', ...words].map(single).join(' ');
      return `echo "### ${index}"\ndrive ${typed}`;
    }),
  ].join('\n');
  const done = spawnSync('bash', ['-c', program], { encoding: 'utf-8', cwd: sandbox });
  if (done.status !== 0) throw new Error(`driving bash failed: ${done.stderr}`);
  const replies = new Map<string, string[]>();
  let at: string | undefined;
  for (const line of done.stdout.split('\n')) {
    const header = /^### (\d+)$/.exec(line);
    if (header !== null) {
      at = asked[Number(header[1])] as string;
      replies.set(at, []);
      continue;
    }
    if (at !== undefined && line !== '') (replies.get(at) as string[]).push(line);
  }
  return replies;
}

/** One argument for a shell command line, quoted whole. */
function single(value: string): string {
  return `'${value.split("'").join(String.raw`'\''`)}'`;
}

// ---------------------------------------------------------------------------
// The coverage — asked of the program, never of a list here
// ---------------------------------------------------------------------------

/** Every level driven in a real bash: the path, and what bash offered after it. */
const BASH_REPLIES = drivenBash(
  SCRIPT.bash,
  PATHS.map((path) => (path === '' ? [''] : [...path.split(' '), ''])),
);

/** What a shell offers at a level — bash by DRIVING it, the other two by reading. */
function offered(shell: Shell, path: string): readonly string[] {
  if (shell === 'bash') return BASH_REPLIES.get(path === '' ? '' : `${path} `) ?? [];
  return shell === 'zsh' ? posixOffered(SCRIPT.zsh, path) : fishOffered(SCRIPT.fish, path);
}

describe('the script knows every verb the program declares', () => {
  it('offers every subcommand under the command that has it, in all three shells', () => {
    const commands = everyCommandOf(declared);
    expect(commands.length).toBeGreaterThan(30);
    for (const shell of SHELLS) {
      for (const command of commands.slice(1)) {
        const path = pathOf(command);
        const parent = path.slice(0, -1).join(' ');
        expect(offered(shell, parent), `${shell}: mnema ${path.join(' ')}`).toContain(path.at(-1));
      }
    }
  });

  it('offers every option name the parser accepts there, in all three shells', () => {
    // Including an option a PARENT group declares: `mnema task move --which` is accepted
    // (task.ts says so in prose, because `move`'s own help does not list it), so a
    // completion that offered only the level's own options would be narrower than the
    // parser.
    let checked = 0;
    for (const shell of SHELLS) {
      for (const command of everyCommandOf(declared)) {
        const path = pathOf(command).join(' ');
        for (const name of accepted(command)) {
          expect(offered(shell, path), `${shell}: mnema ${path} ${name}`).toContain(name);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
    expect(offered('bash', 'task move')).toContain('--which');
  });

  it('offers the implicit `help` command, which lives in neither .commands nor .options', () => {
    // It is not in the walk — commander creates it on demand — and it IS in the help's
    // own list, which is what the generator reads. A reader who sees `help` in
    // `mnema --help` and not in a Tab would conclude the tool has two answers.
    for (const shell of SHELLS) expect(offered(shell, ''), shell).toContain('help');
    expect(everyCommandOf(declared).map((command) => command.name())).not.toContain('help');
  });

  it('offers a value only where the declaration enumerates one', () => {
    // Read off the declarations, so a case cannot pass while the two drift apart.
    const whens = declared.options.find((option) => option.long === '--color')?.argChoices ?? [];
    const shells = everyCommandOf(declared)
      .find((command) => command.name() === 'completion')
      ?.registeredArguments.find((argument) => argument.name() === 'shell')?.argChoices;
    expect(whens.length).toBe(3);
    expect(shells).toEqual([...SHELLS]);
    for (const script of [SCRIPT.bash, SCRIPT.zsh]) {
      expect(script).toContain(`':--color') echo '${whens.join(' ')}' ;;`);
      expect(script).toContain(`'completion:') echo '${SHELLS.join(' ')}' ;;`);
    }
    expect(SCRIPT.fish).toContain(`-l color -x -a '${whens.join(' ')}'`);
    expect(SCRIPT.fish).toContain(`-n '__mnema_at "completion"' -a '${SHELLS.join(' ')}'`);
    // And a real bash answers with them, after either spelling of the flag.
    const asked = drivenBash(SCRIPT.bash, [
      ['--color', ''],
      ['--color', '=', ''],
      ['completion', ''],
    ]);
    expect(asked.get('--color ')).toEqual([...whens]);
    expect(asked.get('--color = ')).toEqual([...whens]);
    expect(asked.get('completion ')).toContain('fish');
  });

  it('offers nothing that is not a declared name or a value a declaration enumerates', () => {
    const allowed = new Set<string>(['help']);
    for (const command of everyCommandOf(declared)) {
      allowed.add(command.name());
      for (const name of accepted(command)) allowed.add(name);
      for (const argument of command.registeredArguments) {
        for (const value of argument.argChoices ?? []) allowed.add(value);
      }
      for (const option of command.options) {
        for (const value of option.argChoices ?? []) allowed.add(value);
      }
    }
    let seen = 0;
    for (const shell of SHELLS) {
      for (const path of PATHS) {
        for (const word of offered(shell, path)) {
          expect([...allowed], `${shell}: mnema ${path} → ${word}`).toContain(word);
          seen += 1;
        }
      }
    }
    expect(seen).toBeGreaterThan(400);
  });

  it('and so no transition reaches any script — the one class that would cost a run', () => {
    const transitions = transitionsNamedInTheHelp();
    expect(transitions.length).toBeGreaterThanOrEqual(10);
    expect(transitions).toContain('submit_review');
    // `start` is BOTH a transition and a declared subcommand (`mnema run start`), so the
    // rule is about the word's provenance and not about the word: a transition may appear
    // only where something else declares it.
    const declaredNames = everyCommandOf(declared).map((command) => command.name());
    expect(declaredNames).toContain('start');
    for (const shell of SHELLS) {
      const words = new Set(PATHS.flatMap((path) => offered(shell, path)));
      for (const transition of transitions) {
        if (declaredNames.includes(transition)) continue;
        expect([...words], `${shell}: ${transition}`).not.toContain(transition);
      }
    }
  });
});

describe('a verb nobody has written yet is completed by construction', () => {
  /** A program of its own, so the twenty-six that exist cannot satisfy the case. */
  function later(): Command {
    const program = new Command().name('later');
    const parent = program.command('parent').description('a group added tomorrow');
    parent
      .command('child')
      .description('a subcommand two levels down')
      .option('--deep <value>', 'an option nothing else declares')
      .addArgument(new Argument('<pick>', 'a value the declaration enumerates').choices(['one']));
    return program;
  }

  it('carries the new verb, its subcommand, its option and its enumerated value', () => {
    // Asserted through the readers rather than as raw text, because each shell SPELLS a
    // flag its own way (`--deep` is `-l deep` to fish) — and because what matters is the
    // LEVEL a word is offered at, not that the file mentions it somewhere.
    for (const shell of SHELLS) {
      const script = completionScript(later(), shell);
      const at = (path: string): readonly string[] =>
        shell === 'fish' ? fishOffered(script, path, 'later') : posixOffered(script, path);
      expect(at(''), shell).toContain('parent');
      expect(at('parent'), shell).toContain('child');
      expect(at('parent child'), shell).toContain('--deep');
      expect(at('parent child'), shell).toContain('one');
    }
  });

  it('and bash accepts the script written for a program it has never seen', () => {
    expect(complaintOf('bash', completionScript(later(), 'bash'), 'later.bash')).toBe('');
  });
});

describe('the generated script is a file its shell can read', () => {
  it('is accepted by every shell on this machine, and names the ones that are not here', () => {
    const absent: string[] = [];
    for (const shell of SHELLS) {
      if (!present(shell)) {
        absent.push(shell);
        continue;
      }
      expect(complaintOf(shell, SCRIPT[shell], `mnema.${shell}`), `${shell} -n`).toBe('');
    }
    // Not one shell checked would make this case say nothing at all.
    expect(absent.length, 'no shell on this machine could check anything').toBeLessThan(
      SHELLS.length,
    );
    if (absent.length > 0) {
      console.info(
        `the-shell-knows-the-verbs: NOT syntax-checked here, binary absent: ${absent.join(', ')}`,
      );
    }
  });

  it("is accepted by bash's parser even when it is the zsh script", () => {
    // A weak check and stated as one: bash and zsh share the grammar of everything
    // generated except two parameter expansions, so this catches an unbalanced quote or a
    // broken `case` — which is the failure a description's apostrophe would cause — and
    // says nothing about `${(f)…}`. It is what there is when zsh is not installed.
    expect(complaintOf('bash', SCRIPT.zsh, 'as-bash.zsh')).toBe('');
  });

  it('is driven by a real bash, which is what the coverage above reads for bash', () => {
    expect(present('bash'), 'bash is not on this machine: the driven half cannot run').toBe(true);
    // Every level answered something — a reply map with an empty entry would make every
    // `toContain` above fail loudly, but an entry that was never asked would not.
    expect(BASH_REPLIES.size).toBe(PATHS.length);
    for (const path of PATHS) {
      expect(offered('bash', path), `mnema ${path}`).not.toEqual([]);
    }
    // And it filters by what has been typed, which is the whole point of a Tab.
    const asked = drivenBash(SCRIPT.bash, [['ta'], ['task', 'mo'], ['task', 'move', '--n']]);
    expect(asked.get('ta')).toEqual(['task']);
    expect(asked.get('task mo')).toEqual(['move']);
    expect(asked.get('task move --n')).toEqual(['--note']);
  });
});

describe('a declaration is English, and it goes into the script as text', () => {
  /** A program whose declarations hold everything a shell would act on. */
  function odd(): Command {
    const program = new Command().name('odd');
    program
      .command('quoted')
      .description('an actor\'s note: $HOME `id` \\ "quoted" and a\nsecond line');
    program.addOption(
      new Option('--pick <value>', 'a value nobody should run').choices([
        '$(touch INJECTED)',
        "it's",
      ]),
    );
    return program;
  }

  it('reaches the two scripts that can show one, on ONE line whatever it holds', () => {
    for (const shell of ['zsh', 'fish'] as const) {
      const script = completionScript(odd(), shell);
      const carrying = script.split('\n').filter((line) => line.includes('second line'));
      expect(carrying.length, shell).toBe(1);
      // The newline was COLLAPSED and not dropped: both halves are on the one line, and
      // what a shell would otherwise expand is on it as text. (The apostrophe is escaped
      // by then, in each dialect's own way — that is the case below.)
      expect(carrying[0], shell).toContain('and a second line');
      expect(carrying[0], shell).toContain('$HOME');
      // And it is the description OF that command: the word is on the same line, however
      // the dialect joins the two (`word:description` for zsh, `-d` for fish).
      expect(carrying[0], shell).toContain('quoted');
    }
  });

  it('and the bash script carries no description at all, which is the decision', () => {
    // bash's completion has nowhere to show one, so the tree's descriptions do not travel
    // into it — and an option's description travels into NONE of the three, because
    // `--which`'s is 340 characters against 76 for the longest command's.
    const script = completionScript(odd(), 'bash');
    expect(script).not.toContain("actor's note");
    expect(script).not.toContain('second line');
    expect(completionScript(odd(), 'zsh')).not.toContain('a value nobody should run');
    expect(completionScript(odd(), 'fish')).not.toContain('a value nobody should run');
  });

  it('is escaped in the dialect of the shell it is written for', () => {
    // POSIX has one escape for a quote inside quotes and fish has another; each script
    // must use its own, or it says something other than what was declared.
    expect(completionScript(odd(), 'zsh')).toContain(String.raw`an actor'\''s note`);
    expect(completionScript(odd(), 'fish')).toContain(String.raw`an actor\'s note`);
  });

  it('leaves every quote in the fish script closed', () => {
    const script = completionScript(odd(), 'fish');
    let lines = 0;
    for (const line of script.split('\n')) {
      if (!line.startsWith('complete ')) continue;
      // fish honours `\\` and `\'` inside single quotes and nothing else, so remove those
      // two and every remaining quote must pair with another.
      const bare = line.split('\\\\').join('').split(String.raw`\'`).join('');
      expect([...bare].filter((byte) => byte === "'").length % 2, line).toBe(0);
      lines += 1;
    }
    expect(lines).toBeGreaterThan(3);
  });

  it('and a real bash offers `$(…)` without running it', () => {
    // `compgen -W` would have run it, which is why the generated function filters with a
    // `case` instead. The marker is a file: if anything expanded the word, it exists.
    const marker = join(sandbox, 'INJECTED');
    rmSync(marker, { force: true });
    const script = completionScript(odd(), 'bash');
    expect(complaintOf('bash', script, 'odd.bash')).toBe('');
    writeFileSync(join(sandbox, 'odd.bash'), `${script}\n`);
    const driver = [
      `source ${single(join(sandbox, 'odd.bash'))}`,
      'COMP_WORDS=(odd --pick "")',
      'COMP_CWORD=2',
      'COMPREPLY=()',
      '_odd',
      `printf "%s\\n" "\${COMPREPLY[@]}"`,
    ].join('\n');
    const done = spawnSync('bash', ['-c', driver], { encoding: 'utf-8', cwd: sandbox });
    expect(done.status, done.stderr).toBe(0);
    expect(done.stdout).toContain('$(touch');
    expect(existsSync(marker), 'a declaration was EXPANDED by pressing Tab').toBe(false);
  });
});

describe('the script, byte for byte', () => {
  // The form is pinned so a change to it is visible in review; the coverage above is
  // what keeps a regenerated golden from hiding a surface that shrank.
  it('writes the bash script exactly as it did', async () => {
    await expect(`${SCRIPT.bash}\n`).toMatchFileSnapshot('./completion.bash.golden.txt');
  });

  it('writes the zsh script exactly as it did', async () => {
    await expect(`${SCRIPT.zsh}\n`).toMatchFileSnapshot('./completion.zsh.golden.txt');
  });

  it('writes the fish script exactly as it did', async () => {
    await expect(`${SCRIPT.fish}\n`).toMatchFileSnapshot('./completion.fish.golden.txt');
  });
});
