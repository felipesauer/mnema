/**
 * One source for a vocabulary: the closed sets of domain words the CLI's declarations
 * take, and the two things that read them.
 *
 * Twenty-two declarations used to write a domain vocabulary out by hand — the ten
 * workflow actions in `task move` and again in `guard`, the three scopes in seven
 * births, the three levels `--require` accepts, and, at nine more, WHICH actions each
 * proof flag is required by. Nothing compared any of those sentences to the machine, so
 * an action added to a workflow would leave every one of them a version behind with the
 * whole suite green. A help that omits a word the gate accepts is worse than one that
 * says nothing: the reader concludes the word does not exist.
 *
 * Three things are asserted here, and they are different:
 *   - THE PROSE IS THE MACHINE'S. Every declaration that names a set lists exactly that
 *     set's members, and the sets themselves are the domain's own constants — compared
 *     against `@mnema/core` and `@mnema/chain`, never against a string typed in this
 *     file, which would just move the copy from `src` to `tests`.
 *   - NOTHING VALIDATES. Not one of those declarations carries a `.choices()`, because
 *     commander's version installs a parser that throws before an action runs — and the
 *     refusal a caller must get is the GATE's, by its own code. Asserted twice: on the
 *     declarations, and on the real binary, which is the only place that can show
 *     `UNKNOWN_ACTION` is still reachable.
 *   - NOBODY TYPES A LIST AGAIN. A source scan over BOTH surfaces, so a site that goes
 *     back to spelling out a vocabulary in a string is red — the regression this slice
 *     exists to prevent, and the one review does not catch, because a hand-typed list
 *     that is CORRECT today looks like nothing at all.
 *
 * WHERE THE SCAN USED TO STOP, AND WHAT MOVED IT. It covered `wiring/` and said so out
 * loud: the MCP's tool descriptions typed the same vocabularies by hand, and the reason
 * given for leaving them was that this slice built help and completion, and completion
 * does not exist for MCP. WHAT FALSIFIED IT: the MCP was not only re-typing prose. It
 * validated `scope` with `z.enum(['public', 'private', 'global'])` at eight sites and
 * `direction` with `z.enum(['both', 'out', 'in'])` at a ninth — arrays, not sentences —
 * and a tool's input schema is what the tool ACCEPTS. So a fourth tree added to the domain
 * would have reached this surface's help, its Tab and its refusal, and left the other door
 * refusing a word the same product takes. Two doors telling a reader different stories is
 * a documentation defect; two doors accepting different words is not.
 *
 * The scan covers `wiring/` and `mcp/` now, and it looks for three shapes rather than one:
 * a pair of members inside one literal, a set re-tupled into an array of literals, and a
 * list with each member's gloss wedged between them. The second and third were invisible
 * to the first — which is why `mcp/server.ts` measured at NINE hits and held
 * TWENTY-SEVEN sites. What a pass here still does not cover is `commands/`, which speaks
 * about the domain in prose and holds one module-private tuple of scopes, and a list of
 * ONE member anywhere (see the blind spot named below).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVEL_REQUIREMENTS } from '@mnema/chain';
import {
  DECISION_ACTIONS,
  DECISION_TRANSITIONS,
  type ProofField,
  SEARCH_KINDS,
  SKILL_ACTIONS,
  SKILL_TRANSITIONS,
  TASK_ACTIONS,
  TRANSITIONS,
} from '@mnema/core';
import { Command, type Option } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from '../src/cli.js';
import { completionScript } from '../src/completion/script.js';
import { SWITCHABLE_CHANNELS } from '../src/record-framing.js';
import { REFERENCE_DIRECTIONS } from '../src/reference-directions.js';
import { SCOPES as OPENED_IN_ORDER } from '../src/tree-sources.js';
import { SHELLS } from '../src/wiring/completion.js';
import * as vocabulary from '../src/wiring/enumerated.js';
import { enumeratedArgument, SCOPES, valuesDeclaredOn } from '../src/wiring/enumerated.js';
import { everyCommandOf } from '../src/wiring/misuse.js';

/** A silent port: everything that reads declarations writes nothing. */
const silent: CliIo = { out: () => {}, err: () => {}, fail: () => {} };

/** The program as the binary builds it. */
const declared = buildProgram(silent).program;

/** `packages/code/src`, where the scan starts and stays. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** The built CLI — the same file the `mnema` bin points at. */
const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

/** The words that reach a command, without the program's own name. */
function pathOf(command: Command): string {
  const names: string[] = [];
  for (let at: Command | null = command; at.parent !== null; at = at.parent) {
    names.unshift(at.name());
  }
  return names.join(' ');
}

/** One declaration that names a set: where it is, what it says, and what it takes. */
interface Declared {
  /** `task move <action>`, `search --kind` — how a reader would name it. */
  readonly where: string;
  /** The help commander would print for it. */
  readonly description: string;
  /** The set it says its value comes from. */
  readonly values: readonly string[];
  /** commander's own enumeration, which also VALIDATES. Absent on every domain set. */
  readonly argChoices: readonly string[] | undefined;
}

/** Every declaration of the program that names a closed set, arguments and options. */
function everyDeclaredSet(): readonly Declared[] {
  const found: Declared[] = [];
  for (const command of everyCommandOf(declared)) {
    const path = pathOf(command);
    const at = (name: string): string => (path === '' ? name : `${path} ${name}`);
    for (const argument of command.registeredArguments) {
      const values = valuesDeclaredOn(argument);
      if (values.length === 0) continue;
      found.push({
        where: at(`<${argument.name()}>`),
        description: argument.description,
        values,
        argChoices: argument.argChoices,
      });
    }
    for (const option of command.options) {
      const values = valuesDeclaredOn(option);
      if (values.length === 0) continue;
      found.push({
        where: at(option.long ?? option.flags),
        description: option.description,
        values,
        argChoices: option.argChoices,
      });
    }
  }
  return found;
}

const DECLARED_SETS = everyDeclaredSet();

/** The declaration at `where`, or a failure that names it. */
function setAt(where: string): Declared {
  const found = DECLARED_SETS.find((declaration) => declaration.where === where);
  expect(found, `no declaration names a set at \`${where}\``).toBeDefined();
  return found as Declared;
}

/** One command of the program, by the path a caller types. */
function commandAt(path: string): Command {
  const command = everyCommandOf(declared).find((each) => pathOf(each) === path);
  expect(command, path).toBeDefined();
  return command as Command;
}

/**
 * The help of one flag, as DECLARED.
 *
 * Not out of `helpInformation()`: commander wraps a description to the terminal's
 * width, so a list long enough to be worth generating is split across lines there and
 * no assertion about a sentence could hold. What is asserted is what was declared; that
 * the help prints a declaration is `cli.help.golden.txt`'s job.
 */
function optionHelp(path: string, long: string): string {
  const option = commandAt(path).options.find((each) => each.long === long);
  expect(option, `${path} ${long}`).toBeDefined();
  return (option as Option).description;
}

/** The escape a member of a set needs before it goes into a pattern. */
function quoted(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The pattern that holds `phrase` as WORDS, not inside longer ones. */
function asWords(phrase: string): RegExp {
  return new RegExp(`(^|[^\\w-])${quoted(phrase)}($|[^\\w-])`);
}

/** Whether `text` holds `phrase` as WORDS, not inside longer ones. */
function names(text: string, phrase: string): boolean {
  return asWords(phrase).test(text);
}

// ---------------------------------------------------------------------------
// The prose is the machine's
// ---------------------------------------------------------------------------

describe('a declaration lists the set it takes', () => {
  it('names every member of its own set, at every declaration that has one', () => {
    // The link between the two halves of a declaration: a description built from
    // another set, or a member dropped from the set after being typed into the
    // sentence, is red here — at whichever of the sites it happens at, without this
    // file knowing they exist.
    for (const declaration of DECLARED_SETS) {
      for (const value of declaration.values) {
        expect(
          names(declaration.description, value),
          `${declaration.where} does not name ${value}: ${declaration.description}`,
        ).toBe(true);
      }
    }
    // And it is asked of every declaration there is, so a set that stopped being
    // declared cannot make this vacuous by leaving the list empty.
    // Twenty since `decision import` declared its own `--scope`: it is a birth, and a
    // birth takes the per-action override.
    expect(DECLARED_SETS.length).toBe(20);
  });

  it('takes the set from the DOMAIN, at each of the levels that take one', () => {
    // Against the machine's own constants, never against a list typed here: a test that
    // wrote the ten actions out again would only move the copy from `src` to `tests`.
    expect(setAt('task move <action>').values).toBe(TASK_ACTIONS);
    expect(setAt('guard <action>').values).toBe(TASK_ACTIONS);
    expect(setAt('skill move <action>').values).toBe(SKILL_ACTIONS);
    expect(setAt('search --kind').values).toBe(SEARCH_KINDS);
    expect(setAt('verify --require').values).toBe(LEVEL_REQUIREMENTS);
    expect(setAt('refs --direction').values).toBe(REFERENCE_DIRECTIONS);
    // The one set here the DOMAIN does not own: a channel is a place this product pushes
    // the record unasked, and the core knows of none. It is still read from ONE place —
    // the module that decides what a channel is — rather than typed into the declaration.
    expect(setAt('switch off <channel>').values).toBe(SWITCHABLE_CHANNELS);
    expect(setAt('switch on <channel>').values).toBe(SWITCHABLE_CHANNELS);
    // `decision move` offers the decision vocabulary MINUS what has a verb of its own:
    // `supersede` needs a successor id the generic `move <action> <id>` cannot take, so
    // it is `mnema decision supersede <old> <new>`. Derived by exclusion, so a fourth
    // decision action arrives in the help by itself — and the exclusion is asserted as
    // an exclusion, not as the pair of words that are left.
    expect(setAt('decision move <action>').values).toEqual(
      DECISION_ACTIONS.filter((action) => action !== 'supersede'),
    );
    expect(DECISION_ACTIONS).toContain('supersede');
    // The seven births take one set, and the same one the filter on `search` takes.
    for (const verb of ['task', 'decision', 'skill', 'memory', 'observe', 'handoff', 'link']) {
      expect(setAt(`${verb} --scope`).values, verb).toBe(SCOPES);
    }
    expect(setAt('search --scope').values).toBe(SCOPES);
    expect([...SCOPES]).toEqual(['public', 'private', 'global']);
  });

  it('offers `task move` and `guard` the very same array — not two equal ones', () => {
    // The two sites the inventory called out as one vocabulary typed twice, with two
    // different openings ("the transition" and "the transition to test"). Identity and
    // not equality: two arrays that happen to match today are exactly the defect.
    expect(setAt('guard <action>').values).toBe(setAt('task move <action>').values);
    expect(setAt('task move <action>').description).toBe(
      `the transition (${TASK_ACTIONS.join(', ')})`,
    );
    expect(setAt('guard <action>').description).toBe(
      `the transition to test (${TASK_ACTIONS.join(', ')})`,
    );
  });

  it('names, in each proof flag, exactly the actions the table requires it for', () => {
    // The other half of the vocabulary in these declarations, and the half the inventory
    // did not count: not "which words go here" but "which of those words cannot move
    // without this flag". Derived here from the TABLE, independently of the production
    // helper, so the assertion is about the rows the gate enforces.
    const requiring = (
      table: readonly { readonly action: string; readonly requires: readonly ProofField[] }[],
      actions: readonly string[],
      field: ProofField,
    ): string =>
      actions
        .filter((action) =>
          table.some((row) => row.action === action && row.requires.includes(field)),
        )
        .join(', ');

    expect(optionHelp('task move', '--reason')).toBe(
      `why (required by ${requiring(TRANSITIONS, TASK_ACTIONS, 'reason')})`,
    );
    expect(optionHelp('task move', '--note')).toBe(
      `what was done (required by ${requiring(TRANSITIONS, TASK_ACTIONS, 'note')})`,
    );
    expect(optionHelp('task move', '--feedback')).toBe(
      `what must change (required by ${requiring(TRANSITIONS, TASK_ACTIONS, 'feedback')})`,
    );
    expect(optionHelp('guard', '--reason')).toBe(
      `simulate the reason (${requiring(TRANSITIONS, TASK_ACTIONS, 'reason')})`,
    );
    expect(optionHelp('guard', '--note')).toBe(
      `simulate the note (${requiring(TRANSITIONS, TASK_ACTIONS, 'note')})`,
    );
    expect(optionHelp('guard', '--feedback')).toBe(
      `simulate the feedback (${requiring(TRANSITIONS, TASK_ACTIONS, 'feedback')})`,
    );
    expect(optionHelp('decision move', '--note')).toBe(
      `why this verdict (required by ${requiring(DECISION_TRANSITIONS, DECISION_ACTIONS, 'note')})`,
    );
    expect(optionHelp('skill move', '--note')).toBe(
      `why this verdict (required by ${requiring(SKILL_TRANSITIONS, SKILL_ACTIONS, 'note')})`,
    );
    expect(optionHelp('skill move', '--reason')).toBe(
      `why it fell out of use (required by ${requiring(SKILL_TRANSITIONS, SKILL_ACTIONS, 'reason')})`,
    );
    // Each list has to have something in it, or the six assertions above would pass on
    // empty strings — which is what a table read the wrong way round would produce.
    expect(requiring(TRANSITIONS, TASK_ACTIONS, 'reason').length).toBeGreaterThan(0);
    expect(requiring(SKILL_TRANSITIONS, SKILL_ACTIONS, 'reason').length).toBeGreaterThan(0);
  });

  it('can say "required by" at all, because a table never disagrees with itself', () => {
    // The assumption the sentence rests on: an action legal from several states requires
    // the same proof from all of them. A workflow where `cancel` needed a reason from one
    // state and not another could not be described by "required by cancel" in any order
    // of words — the flag's help would have to name a state, and there is no such
    // sentence on this surface.
    for (const table of [TRANSITIONS, DECISION_TRANSITIONS, SKILL_TRANSITIONS]) {
      const seen = new Map<string, string>();
      for (const row of table) {
        const fields = [...row.requires].sort().join(' ');
        const before = seen.get(row.action);
        if (before === undefined) seen.set(row.action, fields);
        else expect(fields, `${row.action} requires two different things`).toBe(before);
      }
      expect(seen.size).toBeGreaterThan(0);
    }
  });

  it('has a declaration for every set it publishes — none plumbed to nowhere', () => {
    // A2, over this module's own exports. A vocabulary declared, glossed and exported
    // with no declaration taking it is the shape four defects of this series had: the
    // code under the gap is right, nothing feeds it, and every test passes because
    // ABSENCE is what there is to see. `every-public-value-has-a-caller.test.ts` walks
    // the packages' ENTRY POINTS and cannot see an export of a module inside one, which
    // is what this is.
    const taken = DECLARED_SETS.map((declaration) => declaration.values);
    const published = Object.entries(vocabulary).filter(
      (entry): entry is [string, readonly string[]] =>
        Array.isArray(entry[1]) && entry[1].every((value) => typeof value === 'string'),
    );
    for (const [name, set] of published) {
      expect(taken, `${name} is exported and no declaration takes it`).toContain(set);
    }
    expect(published.length).toBeGreaterThanOrEqual(6);
  });

  it('reads one tuple of scopes, wherever the surface counts the trees', () => {
    // Two constants, two rules: what `--scope` accepts, and the order a composed read
    // opens the trees in. They are the same three words and a fourth tree would have to
    // be in both, so a divergence is a defect in whichever is behind. (A third copy is
    // module-private in `commands/show.ts` — the order that read looks in — and is
    // declared as debt rather than reached into from here.)
    expect([...OPENED_IN_ORDER].sort()).toEqual([...SCOPES].sort());
  });
});

// ---------------------------------------------------------------------------
// Nothing validates
// ---------------------------------------------------------------------------

describe('naming a set does not make the parser own it', () => {
  it('carries no `.choices()` on any domain set', () => {
    // The structural half of the rule. `.choices()` would enumerate AND validate, and
    // the validation runs before any action — so the gate's own refusal, with its own
    // code, would never be reached for a bad action.
    for (const declaration of DECLARED_SETS) {
      expect(declaration.argChoices, `${declaration.where} carries .choices()`).toBeUndefined();
    }
    // And the two places a `.choices()` IS right are still there, so this is a
    // statement about domain sets and not about the mechanism being unused: the whens of
    // `--color` and the shells of `completion` are the SURFACE's own vocabulary, with no
    // gate behind them to own it.
    const whens = declared.options.find((option) => option.long === '--color')?.argChoices;
    const shells = everyCommandOf(declared)
      .find((command) => command.name() === 'completion')
      ?.registeredArguments.find((argument) => argument.name() === 'shell')?.argChoices;
    expect(whens).toHaveLength(3);
    expect(shells).toEqual([...SHELLS]);
  });

  it('and a declaration that named a set can still be given one, which is the danger', () => {
    // This file's own non-vacuity: the assertion above is about ABSENCE, and an
    // `argChoices` this mechanism could never carry would make it say nothing. It can —
    // the two are independent — which is exactly why it is asserted.
    const argument = enumeratedArgument('<action>', 'the transition', ['one', 'two']);
    expect(argument.argChoices).toBeUndefined();
    expect(valuesDeclaredOn(argument)).toEqual(['one', 'two']);
    expect(argument.choices(['one', 'two']).argChoices).toEqual(['one', 'two']);
  });
});

// ---------------------------------------------------------------------------
// Nobody types a list again
// ---------------------------------------------------------------------------

/** Every source file of a directory of `src`, tests excluded. */
function sourcesUnder(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(SRC, directory), { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...sourcesUnder(join(directory, entry.name)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      found.push(join(directory, entry.name));
    }
  }
  return found;
}

/** A string literal — single-quoted, double-quoted or a template. */
const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;

/** The source with every comment blanked, so prose about a vocabulary is not one. */
function codeOf(source: string): string {
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
  return source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/g, blank);
}

/** The vocabularies a hand-typed list would be a list OF. */
const VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  'task action': TASK_ACTIONS,
  'decision action': DECISION_ACTIONS,
  'skill action': SKILL_ACTIONS,
  scope: SCOPES,
  level: LEVEL_REQUIREMENTS,
  'kind of record': SEARCH_KINDS,
  direction: REFERENCE_DIRECTIONS,
};

/** How two members of one set are joined when somebody writes them out. */
const JOINS = [', ', ', or ', ' or ', ', and ', ' and ', '/'];

/** An array of string literals, which is how a set gets RE-TUPLED rather than described. */
const LITERAL_ARRAY =
  /\[\s*(?:'[^'\\\n]*'|"[^"\\\n]*")(?:\s*,\s*(?:'[^'\\\n]*'|"[^"\\\n]*"))*\s*,?\s*\]/g;

/** The members of an array-of-literals, as written. */
function membersOf(array: string): readonly string[] {
  return [...array.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)].map(
    (member) => (member[1] ?? member[2]) as string,
  );
}

/** One shape a hand-typed list takes, and how a hit on it reads. */
interface Shape {
  /** The hit without the literal — `[scope] public, private`. */
  readonly says: string;
  /** What it is recognised by. */
  readonly pattern: RegExp;
}

/**
 * EVERY SHAPE A HAND-TYPED LIST TAKES, BUILT ONCE.
 *
 * None of them depends on the literal being read — only on the vocabulary — so they are made
 * here rather than inside the walk. They used to be made inside it, per literal: 1550
 * literals against 1022 shapes is 1,584,100 `RegExp` objects for 1022 distinct patterns, and
 * compiling them was 82% of what the scan cost — 1029 ms against 181 ms for the same walk
 * over the same sources, returning the same hits.
 *
 * Reusing one pattern across literals is safe because none of them is global: `test` on a
 * non-global pattern keeps no position between calls, so a literal cannot be searched from
 * where the previous one left off.
 */
const HAND_TYPED: readonly Shape[] = Object.entries(VOCABULARIES).flatMap(([vocabulary, values]) =>
  values.flatMap((first) =>
    values.flatMap((second) => {
      if (first === second) return [];
      return [
        // As WORDS: `stdout and installs` holds `out and in` and is a sentence
        // about a stream, and `submit_review` holds `submit` — a scan without
        // boundaries accuses the wrong lines and gets switched off.
        ...JOINS.map((join) => ({
          says: `[${vocabulary}] ${first}${join}${second}`,
          pattern: asWords(`${first}${join}${second}`),
        })),
        // The same list with each member's gloss wedged in after it. The gloss may
        // hold commas of its own ("this machine, this project"), so what separates
        // the two members is a parenthesis and then a join — and the parenthesis
        // must not itself contain one, or the shape would jump over a whole clause.
        {
          says: `[${vocabulary}] ${first} (…), ${second}`,
          pattern: new RegExp(
            `(^|[^\\w-])${quoted(first)} \\([^()]*\\)(?:,| or | and |, or |, and ) ?${quoted(second)}($|[^\\w-])`,
          ),
        },
      ];
    }),
  ),
);

/**
 * Every place in `source` where somebody typed a vocabulary out instead of reading it.
 *
 * THREE SHAPES, and they were found in that order — each by a surface the one before it
 * did not cover:
 *
 *   - PAIRS IN ONE LITERAL: `'(submit, start, block)'`. The CLI's shape, and for a while
 *     the only one looked for.
 *   - AN ARRAY OF LITERALS: `z.enum(['public', 'private', 'global'])`. Invisible to the
 *     first, because the members are in different literals — and the one shape that is
 *     not prose at all: a `z.enum` is what a tool ACCEPTS. Nine of these sat in
 *     `mcp/server.ts` while the pair scan reported the file at fourteen hits.
 *   - A GLOSSED LIST: `'public (team-visible), private (this machine, …), or global (…)'`.
 *     Also invisible to the first, because the gloss sits BETWEEN the members, so no two
 *     of them are ever adjacent. Four more.
 *
 * A literal with an ELLIPSIS is not one, and the exclusion is the rule and not a
 * convenience: `mnema refs <id>` says "a task, decision, memory, skill, …", which names
 * examples of what an id can BE and does not claim to be a set — the words are entity
 * kinds in a sentence, and the `…` is what says so. A declaration that enumerates never
 * ends in one.
 */
function handTypedLists(source: string): readonly string[] {
  const found: string[] = [];
  const code = codeOf(source);
  for (const literal of code.match(LITERAL) ?? []) {
    if (literal.includes('…')) continue;
    for (const shape of HAND_TYPED) {
      if (shape.pattern.test(literal)) found.push(`${shape.says} — ${literal}`);
    }
  }
  for (const array of code.match(LITERAL_ARRAY) ?? []) {
    const members = membersOf(array);
    // Two members, or it is not a list of anything: a one-element array is a value.
    if (members.length < 2) continue;
    for (const [vocabulary, values] of Object.entries(VOCABULARIES)) {
      if (members.every((member) => values.includes(member))) {
        found.push(`[${vocabulary}] re-tupled — ${array.replace(/\s+/g, ' ')}`);
      }
    }
  }
  return found;
}

/** The directories of `src` the scan covers — every surface, and the shared declaration. */
const SCANNED = ['wiring', 'mcp'];

describe('no declaration writes a vocabulary out by hand', () => {
  it('finds none in either surface', () => {
    // IT USED TO STOP AT `wiring/`, and said so out loud rather than passing quietly over
    // the other surface. What falsified that scope: `mcp/server.ts` was not merely
    // re-typing prose there — it was re-typing the ARRAYS its `z.enum`s validate against,
    // so the two doors could accept different words. A guard that names where it stops is
    // honest; it is still a guard that does not cover the case that matters most.
    const typed = SCANNED.flatMap((directory) =>
      sourcesUnder(directory).flatMap((file) =>
        handTypedLists(readFileSync(join(SRC, file), 'utf-8')).map((hit) => `${file}: ${hit}`),
      ),
    );
    expect(typed).toEqual([]);
    // The scan reaches real files, and the whole family of them, in both directories.
    expect(sourcesUnder('wiring').length).toBeGreaterThan(30);
    expect(sourcesUnder('mcp').length).toBeGreaterThan(5);
  });

  it('and would find one, in every shape either surface had', () => {
    // Non-vacuity on input this test owns, in the shapes the two surfaces had: a list in
    // an argument's help, a list of the actions a proof flag is required by, a set
    // re-tupled into a validator, and a list with a gloss between its members. All four
    // are what the files said before, and all four must be red.
    expect(
      handTypedLists("argument('<action>', 'the transition (submit, start, block)')"),
    ).toHaveLength(2);
    expect(
      handTypedLists("option('--reason <text>', 'why (required by cancel, block, reopen)')"),
    ).not.toEqual([]);
    expect(handTypedLists("'the transition: review, adopt, reject, or deprecate'")).not.toEqual([]);
    expect(handTypedLists("'born: public, private, global'")).not.toEqual([]);
    expect(handTypedLists("'the levels: chained, signed, witnessed'")).not.toEqual([]);
    // The MCP's two shapes, on the very text it carried. Each is invisible to a scan for
    // adjacent pairs, which is why the file measured clean at nine hits while holding
    // twenty-seven sites.
    expect(handTypedLists("z.enum(['public', 'private', 'global'])")).not.toEqual([]);
    expect(handTypedLists("z.enum(['both', 'out', 'in'])")).not.toEqual([]);
    expect(
      handTypedLists("'lands in — public (team-visible), private (this machine, this project), '"),
    ).not.toEqual([]);
    // And what it must NOT call a list: a comment, a sentence of examples, two members of
    // a set that are simply words of a sentence, an array of a DIFFERENT vocabulary, and
    // an array holding one member and something else.
    expect(handTypedLists('// the transition (submit, start, block)')).toEqual([]);
    expect(handTypedLists("'the entity id (a task, decision, memory, skill, …)'")).toEqual([]);
    expect(handTypedLists("'it prints to stdout and installs nothing'")).toEqual([]);
    expect(handTypedLists("z.enum(['auto', 'always', 'never'])")).toEqual([]);
    expect(handTypedLists("const SHELLS = ['bash', 'zsh', 'fish']")).toEqual([]);
    expect(handTypedLists("['public', 'a directory name']")).toEqual([]);
    // A KNOWN BLIND SPOT, said out loud: a list of ONE member is invisible to a scan for
    // pairs, so `(required by request_changes)` typed by hand would pass. What covers it
    // is that no site composes such a sentence any more — every one of them interpolates
    // {@link actionsRequiring}, which is what the case above asserts, flag by flag.
    expect(handTypedLists("'what must change (required by request_changes)'")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A set the machine gains tomorrow arrives by itself
// ---------------------------------------------------------------------------

describe('a word the machine gains tomorrow', () => {
  it('reaches the help and every shell without a line of code', () => {
    // The mechanism, over a set this test owns — the real one is proved by mutating
    // `TASK_ACTIONS` in the core, which is in the report. A program of its own, so the
    // twenty-eight verbs that exist cannot satisfy the case.
    const later = new Command().name('later');
    const actions = ['submit', 'reticulate'];
    later
      .command('move')
      .description('a move added tomorrow')
      .addArgument(enumeratedArgument('<action>', 'the transition', actions));
    expect(later.commands[0]?.helpInformation()).toContain('the transition (submit, reticulate)');
    for (const shell of SHELLS) {
      expect(completionScript(later, shell), shell).toContain('reticulate');
    }
  });
});

// ---------------------------------------------------------------------------
// And the gate still refuses, in the real binary
// ---------------------------------------------------------------------------

let sandbox: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-vocabulary-'));
  home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Runs a real `mnema` in its own process, against the sandbox and nothing else. */
function cli(...args: string[]): { status: number | null; out: string } {
  const inherited = { ...process.env };
  delete inherited.MNEMA_RUN;
  const done = spawnSync(process.execPath, [CLI, ...args], {
    cwd: sandbox,
    env: { ...inherited, HOME: home, XDG_DATA_HOME: join(home, 'data') },
    encoding: 'utf-8',
  });
  return { status: done.status, out: `${done.stdout}${done.stderr}` };
}

describe('the gate still owns the vocabulary', () => {
  it('refuses an unknown action with the gate’s own code, not a usage error', () => {
    // THE REASON THIS SLICE DOES NOT USE `.choices()`, asserted where it can be: in the
    // process. A `.choices()` on `<action>` would have commander throw during the parse,
    // and this line would become a usage error about an invalid argument — the refusal
    // below would be unreachable, and a typed code the product answers with would be
    // gone from the surface.
    expect(cli('init').status).toBe(0);
    const created = cli('task', 'a task for the refusal probe');
    const id = /\(([^)]+)\)/.exec(created.out)?.[1] as string;
    expect(id).toBeDefined();
    const refused = cli('task', 'move', 'nonsense', id);
    expect(refused.out).toContain('Refused (UNKNOWN_ACTION): "nonsense" is not a workflow action');
    expect(refused.out).not.toContain('error:');
    expect(refused.status).not.toBe(0);
    // A legal action on the same task still moves it, so the case above is about the
    // WORD and not about a move that stopped working.
    expect(cli('task', 'move', 'submit', id).out).toContain('READY');
    // FOUR PROCESSES OF THE REAL BINARY — the `init`, the task, the refusal and the legal
    // move — and each pays node's start over again: 464 ms on a machine at rest, 1048 ms
    // with the rest of the suite running beside it. The ceiling is here to NAME that, not
    // to tighten it: at the default five seconds a busy machine goes red saying only that
    // something timed out, which is the reading this line exists to prevent.
  }, 60_000);

  it('refuses a value outside a set in the product’s voice, naming the set', () => {
    // The three flags whose set is now declared and whose refusal is unchanged — one per
    // place the check lives: the shared parser, the verb's own, and the adapter's.
    expect(cli('init').status).toBe(0);
    expect(cli('task', 'a task', '--scope', 'nowhere').out).toContain(
      `Invalid --scope "nowhere". Use one of: ${SCOPES.join(', ')}.`,
    );
    expect(cli('verify', '--require', 'nonsense').out).toContain(
      `Invalid --require "nonsense". Use one of: ${LEVEL_REQUIREMENTS.join(', ')}.`,
    );
    expect(cli('search', '--kind', 'nonsense').out).toContain(
      `Invalid --kind "nonsense". Use one of: ${SEARCH_KINDS.join(', ')}.`,
    );
    // FOUR MORE PROCESSES, an `init` and one refusal per place the check lives: 436 ms on a
    // machine at rest, 961 ms with the rest of the suite beside it. What it waits on is node
    // starting four times, which is what the case is FOR — a refusal is only proved where a
    // caller would meet it.
  }, 60_000);
});
