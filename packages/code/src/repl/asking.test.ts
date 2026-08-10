/**
 * WHAT THE SESSION TYPES FOR THE CALLER — the mechanism, on declarations this file owns.
 *
 * The guard over the REAL surface is `tests/the-session-knows-who-you-are.test.ts`: it
 * enumerates, off the registered program, every command that REQUIRES the asker's
 * identity and holds each one to this function, so a fifth arrives covered without an
 * edit anywhere. What that file cannot exercise is the shapes the surface does not have
 * yet — a group whose subcommand asks, a sibling that does not, an optional flag by the
 * same name — and those are where a rule about "which declarations" goes wrong. So the
 * cases here hand it declarations of their own.
 */

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import type { Declared } from '../wiring/verb.js';
import { asTheSession } from './asking.js';

/** What this session knows itself as — shaped like the value the panel is drawn with. */
const ME = 'mnid:7d30343b';

/** A read of this file's own, hung with whatever a case needs to declare. */
function declares(name: string, hang: (command: Command) => Command = (one) => one): Declared {
  return { command: hang(new Command(name).description(`what ${name} does`)), effect: 'reads' };
}

/** The verbs a case is about: one that requires the asker's identity, and one that does not. */
const VERBS: readonly Declared[] = [
  declares('asks', (one) => one.requiredOption('--actor <id>', 'the identity asking')),
  declares('quiet'),
];

/**
 * What the session runs for `line`, knowing {@link ME}.
 *
 * A session that knows NOBODY is asked for by name below, through the function itself: a
 * default parameter here would swallow the very value that case is about — `undefined`
 * passed to one is a parameter nobody passed.
 */
const on = (line: readonly string[]): readonly string[] => asTheSession(line, VERBS, ME);

describe('a verb that requires the asker gets the session’s own identity', () => {
  it('types the flag and the value, at the end of the line', () => {
    expect(on(['asks'])).toEqual(['asks', '--actor', ME]);
    // Whatever else was on the line is untouched, and in the order it was typed.
    expect(on(['asks', '--json'])).toEqual(['asks', '--json', '--actor', ME]);
  });

  it('hands the value over verbatim — it is the one the page shows', () => {
    // Not shortened, not lengthened, not prefixed. What goes onto the line is the string
    // the session was opened with, so the line is the one a caller would have written by
    // copying what was in front of them.
    const whole = `mnid:${'a1b2c3d4'.repeat(8)}`;
    expect(asTheSession(['asks'], VERBS, whole)).toEqual(['asks', '--actor', whole]);
  });

  it('leaves a verb that does not ask for one alone', () => {
    expect(on(['quiet'])).toEqual(['quiet']);
    expect(on(['quiet', 'something'])).toEqual(['quiet', 'something']);
  });

  it('leaves a word no verb answers to alone', () => {
    // The gate refuses such a line before it is ever run; nothing here decides that, and
    // a function that filled a flag into an unknown word would be inventing a command.
    expect(on(['nosuchverb'])).toEqual(['nosuchverb']);
    expect(on([])).toEqual([]);
  });
});

describe('what the caller typed wins, always', () => {
  it('leaves the line alone when it names the flag, in either spelling', () => {
    expect(on(['asks', '--actor', 'somebody-else'])).toEqual(['asks', '--actor', 'somebody-else']);
    expect(on(['asks', '--actor=somebody-else'])).toEqual(['asks', '--actor=somebody-else']);
  });

  it('leaves it alone when the flag was typed with nothing after it', () => {
    // The caller began naming an identity. Filling one in would answer a question they
    // were in the middle of asking; the parser's own "a value after --actor" is the
    // honest reply, and it is only reachable if this keeps its hands off.
    expect(on(['asks', '--actor'])).toEqual(['asks', '--actor']);
  });

  it('fills nothing at all when the session knows nobody', () => {
    // O-c: outside a project, or on a machine whose key root names no single key, there
    // is no identity to speak as and the verb asks the way it always has.
    expect(asTheSession(['asks'], VERBS, undefined)).toEqual(['asks']);
    // And the case is not passing because the verb never asks: knowing somebody, the
    // same line is filled.
    expect(asTheSession(['asks'], VERBS, ME)).toEqual(['asks', '--actor', ME]);
  });
});

describe('the end of the flags is where the parser stops reading them', () => {
  it('types it before `--`, never after', () => {
    // After `--` a word is an operand. Appending there would hand the verb two arguments
    // it does not take, and its refusal would name a flag the caller never typed.
    expect(on(['asks', '--'])).toEqual(['asks', '--actor', ME, '--']);
    expect(on(['asks', '--', 'a word'])).toEqual(['asks', '--actor', ME, '--', 'a word']);
  });

  it('does not read an `--actor` after it as the caller naming one', () => {
    // It is not a flag there — the parser will read it as a word — so the line still
    // needs the identity, and it still goes where the parser is reading flags.
    expect(on(['asks', '--', '--actor', 'x'])).toEqual([
      'asks',
      '--actor',
      ME,
      '--',
      '--actor',
      'x',
    ]);
  });
});

describe('which declarations it answers to, and which it must not', () => {
  it('fills a MANDATORY flag by that name and no other mandatory flag', () => {
    // The rule is about the one value a session HAS. A required flag asking for anything
    // else is a question only the caller can answer, and a surface that filled one in
    // would be inventing an argument.
    const verbs = [declares('links', (one) => one.requiredOption('--rel <label>', 'the relation'))];
    expect(asTheSession(['links'], verbs, ME)).toEqual(['links']);
  });

  it('leaves an OPTIONAL flag by that name alone, however much it looks the same', () => {
    // The shape `accountability --who` has: an identity, and a DEFAULT that is everybody.
    // Filling it would turn "who authorized these facts" into "which of them are mine",
    // in the caller's name, and nothing on the screen would say so.
    const verbs = [declares('counts', (one) => one.option('--actor <id>', 'count only these'))];
    expect(asTheSession(['counts'], verbs, ME)).toEqual(['counts']);
  });

  it('fills for the SUBCOMMAND that asks, and not for the sibling that does not', () => {
    const verbs = [
      declares('group', (one) => {
        one.command('asks').requiredOption('--actor <id>', 'the identity asking');
        one.command('quiet');
        return one;
      }),
    ];
    expect(asTheSession(['group', 'asks'], verbs, ME)).toEqual(['group', 'asks', '--actor', ME]);
    // The sibling declares no such flag, and a line that carried one would be refused by
    // the parser as a flag that command does not take.
    expect(asTheSession(['group', 'quiet'], verbs, ME)).toEqual(['group', 'quiet']);
    // And the group on its own reaches no declaration that asks.
    expect(asTheSession(['group'], verbs, ME)).toEqual(['group']);
  });

  it('fills where the GROUP declares it, whichever subcommand the line names', () => {
    // commander gives a group's option to the group wherever it appears on the line, so
    // a flag declared once, above, is required of every line that goes through it.
    const verbs = [
      declares('group', (one) => {
        one.requiredOption('--actor <id>', 'the identity asking');
        one.command('sub');
        return one;
      }),
    ];
    expect(asTheSession(['group', 'sub'], verbs, ME)).toEqual(['group', 'sub', '--actor', ME]);
  });

  it('walks past a flag to find the subcommand a line names', () => {
    const verbs = [
      declares('group', (one) => {
        one.command('asks').requiredOption('--actor <id>', 'the identity asking');
        return one;
      }),
    ];
    expect(asTheSession(['group', '--json', 'asks'], verbs, ME)).toEqual([
      'group',
      '--json',
      'asks',
      '--actor',
      ME,
    ]);
  });
});
