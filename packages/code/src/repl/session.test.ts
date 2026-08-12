/**
 * What the session does with a line, and what it offers before one is typed.
 *
 * The mechanism, on input this file owns. The guard over the REAL surface is
 * `tests/a-terminal-of-its-own.test.ts`, which enumerates every verb from the
 * declaration and drives the session over a record; with the surface honest, that one
 * can only say "nothing was let through", which exercises neither the deny side nor its
 * limit. So the cases here hand the gate declarations of their own — including the write
 * somebody adds tomorrow, and the command that carries no declaration at all — and check
 * that it can tell the four kinds apart.
 */

import { Command, Option } from 'commander';
import { describe, expect, it } from 'vitest';
import { completionTree } from '../completion/tree.js';
import { CLEAR, PREFIX, SESSION_WORDS } from '../session-words.js';
import type { Declared } from '../wiring/verb.js';
import { completerFor } from './complete.js';
import { argvOf, dispositionOf, verbsOffered } from './gate.js';
import { whatTheSessionShowed } from './seen.js';
import { theSessionsOwnWords } from './session.js';

/** One declaration of this file's own, with the description a menu would print. */
function declares(name: string, effect: Declared['effect']): Declared {
  return { command: new Command(name).description(`what ${name} does`), effect };
}

/**
 * A surface of four verbs: two reads, a write, and the session itself.
 *
 * `smuggle` is deliberately absent from it and present in the cases below — a command
 * hung on the program by a path that returns no declaration is the shape the entry's own
 * guard was once blind to, and here it is the whole point of default-deny.
 */
const VERBS: readonly Declared[] = [
  declares('look', 'reads'),
  declares('read', 'reads'),
  declares('write', 'mutates'),
  declares('session', 'reads'),
];

/** What the session under test calls itself. */
const SELF = 'session';

/** What the session does with `line`, over the declarations above. */
const on = (line: string) => dispositionOf(line, VERBS, SELF);

describe('a line becomes the words a parser receives', () => {
  it('separates on whitespace and groups with either quote', () => {
    expect(argvOf('search runbook')).toEqual(['search', 'runbook']);
    expect(argvOf('   search    runbook   ')).toEqual(['search', 'runbook']);
    expect(argvOf('guard complete id --note "it is done"')).toEqual([
      'guard',
      'complete',
      'id',
      '--note',
      'it is done',
    ]);
    expect(argvOf("memory 'a note with spaces'")).toEqual(['memory', 'a note with spaces']);
    // A quote inside the other kind is a character, which is what makes an apostrophe
    // typable at all.
    expect(argvOf(`search "an actor's run"`)).toEqual(['search', "an actor's run"]);
    expect(argvOf('search a\\ b')).toEqual(['search', 'a b']);
    // An empty argument is a value the surface takes seriously — it is the one the
    // content door refuses — so a pair of quotes has to survive as one empty word.
    expect(argvOf('task ""')).toEqual(['task', '']);
    expect(argvOf('')).toEqual([]);
  });

  it('answers with nothing at all when a quote is never closed', () => {
    // Not a best guess. Closing it silently runs a command with an argument the caller
    // did not finish typing; dropping it runs one with a different argument. Both are
    // wrong in a way the caller cannot see, and a session that reads a record is the
    // wrong place to be inventive about what somebody meant.
    expect(argvOf('search "unfinished')).toBeUndefined();
    expect(argvOf("show 'x")).toBeUndefined();
    expect(argvOf('search "closed" and "not')).toBeUndefined();
  });

  it('expands nothing, because it is not a shell', () => {
    // A `|` is a word, a `$HOME` is a word, a `*` is a word. Each reaches the verb as
    // typed and earns whatever the verb says about an argument it does not take.
    expect(argvOf('search $HOME')).toEqual(['search', '$HOME']);
    expect(argvOf('search foo | head')).toEqual(['search', 'foo', '|', 'head']);
    expect(argvOf('search *.md')).toEqual(['search', '*.md']);
  });
});

describe('a session offers the reads and nothing else', () => {
  it('is every verb that declared it reads, minus the session itself', () => {
    expect(verbsOffered(VERBS, SELF)).toEqual(['look', 'read']);
    // And the exclusion is by IDENTITY: rename the session and the OTHER verb is the
    // one that leaves. A literal here would have gone on excluding a name that moved.
    expect(verbsOffered(VERBS, 'look')).toEqual(['read', 'session']);
  });

  it('runs a read, with the words the caller typed', () => {
    expect(on('look')).toEqual({ does: 'run', argv: ['look'] });
    expect(on('read --json two words')).toEqual({
      does: 'run',
      argv: ['read', '--json', 'two', 'words'],
    });
  });

  it('refuses a verb that declared it writes, and says where to run it', () => {
    const said = on('write something');
    expect(said.does).toBe('refuse');
    expect(said).toMatchObject({
      sentence: '`write` can change the record, and this session only reads it',
    });
    // The refusal is actionable or it is noise: it names the line to type outside.
    expect(said.does === 'refuse' && said.detail).toContain('mnema write');
  });

  it('refuses a command that carries NO declaration — which is the whole rule', () => {
    // The write added tomorrow, and the command hung on the program by some other path.
    // Neither is in `VERBS`, and neither has to be: the gate allows what declared
    // itself a read, so everything else is refused without anybody remembering. A gate
    // written the other way round — refuse what declared `mutates` — would let both of
    // these through, and it is the only other way to write this rule.
    expect(on('smuggle').does).toBe('refuse');
    expect(on('smuggle --force').does).toBe('refuse');
    // Including a bare flag, which names no verb at all.
    expect(on('--help').does).toBe('refuse');
    expect(on('-h').does).toBe('refuse');
  });

  it('refuses to open a session inside a session', () => {
    const said = on(SELF);
    expect(said).toMatchObject({ does: 'refuse', sentence: 'A session is already open here' });
  });

  it('starts the page over, and does not when a word is typed after', () => {
    // IT WAS THREE WORDS AND IT IS ONE. `/exit` and `/help` were the other two, and both
    // are gone: the way out is the key that ends the input, and what the session runs is
    // the list a slash and a letter open (`palette.ts`). What survives is the word no key
    // answers — and the rule that a word of the session's own takes nothing after it,
    // which is what the second half of this case has always been about.
    expect(on(CLEAR)).toEqual({ does: 'clear' });
    expect(on(`${CLEAR} now`).does).toBe('refuse');
    // AND THE TWO WORDS THAT WENT ARE REFUSED LIKE ANY OTHER WORD THE SESSION DOES NOT
    // RUN, which is the half a removal has to assert: a word left half-alive would be a
    // gate answering to something no list offers and no help names.
    for (const gone of [`${PREFIX}help`, `${PREFIX}exit`]) {
      expect(on(gone), gone).toMatchObject({
        does: 'refuse',
        sentence: `This session does not run \`${gone}\``,
      });
    }
  });

  it('does nothing with a blank line, and refuses a line it cannot read', () => {
    expect(on('')).toEqual({ does: 'nothing' });
    expect(on('   ')).toEqual({ does: 'nothing' });
    expect(on('look "unfinished')).toMatchObject({
      does: 'refuse',
      sentence: 'This line has a quote that is never closed',
    });
  });

  it('reaches every arm, so no case above is passing by falling through', () => {
    // The union is closed and the function is total over a string; this is the witness
    // that the cases here actually cover it, rather than five of them landing on the
    // same refusal.
    const reached = new Set(['', 'look', 'write', 'smuggle', CLEAR].map((line) => on(line).does));
    expect([...reached].sort()).toEqual(['clear', 'nothing', 'refuse', 'run']);
  });
});

/** A program of this file's own, so the tree is a tree and not the product's. */
function tree() {
  const program = new Command('tool');
  program.command('look').description('a read').option('--json', 'as an object');
  program
    .command('read')
    .description('another read')
    .addOption(new Option('--scope <s>', 'where').choices(['public', 'here']));
  const write = program.command('write').description('a write');
  write.command('move').description('a move');
  program.command('session').description('this');
  return completionTree(program);
}

describe('tab offers what the session runs', () => {
  /**
   * A session that has named nothing.
   *
   * The cases below are about the DECLARATIONS, and a completer handed a memory with
   * records in it answers with those as well; the cases that are about the records are in
   * the describe under this one, over a memory that has some.
   */
  const named = () => [];

  const complete = completerFor(tree(), verbsOffered(VERBS, SELF), theSessionsOwnWords(), named);

  /** The words of an offer, which is what these cases were written about. */
  const wordsOf = (line: string): readonly string[] => complete(line)[0].map((hit) => hit.word);

  it('offers the reads and the session’s own words, and not one write', () => {
    const hits = wordsOf('');
    expect(hits).toEqual([...SESSION_WORDS, 'look', 'read'].sort());
    // Named rather than implied: the write is what a menu must not carry, because a
    // word offered by Tab and refused by the next line is the surface contradicting
    // itself in two keystrokes. And `help` — commander's own implicit command — is
    // absent for the same reason: this session does not run it.
    expect(hits).not.toContain('write');
    expect(hits).not.toContain('help');
    expect(hits).not.toContain(SELF);
  });

  it('narrows to the prefix, and offers nothing when nothing matches', () => {
    expect(wordsOf('lo')).toEqual(['look']);
    expect(wordsOf('zzz')).toEqual([]);
    expect(complete('lo')[1]).toBe('lo');
  });

  it('reads the slash as a KEY, so what follows it narrows BOTH vocabularies', () => {
    // THE ONE PLACE THE PREFIX IS UNDERSTOOD. A bare slash asks what an empty line asks,
    // and a slash with a letter behind it narrows by that letter — over the session's own
    // words AND over the verbs, which is what makes the list the slash opens the list of
    // everything that can be typed rather than a menu of three words.
    expect(wordsOf(PREFIX)).toEqual([...SESSION_WORDS, 'look', 'read'].sort());
    expect(wordsOf(`${PREFIX}l`)).toEqual(['look']);
    expect(wordsOf(`${PREFIX}c`)).toEqual([CLEAR]);
    // AND THE WORD IT ANSWERS ABOUT IS THE WHOLE OF WHAT WAS TYPED, slash included: that
    // is what a Tab or a Return replaces, so picking a verb off a slash leaves none behind
    // (`editing.ts`, `taking`).
    expect(complete(`${PREFIX}l`)[1]).toBe(`${PREFIX}l`);
  });

  it('offers a verb’s flags, and the values a declaration enumerates', () => {
    expect(wordsOf('look --')).toEqual(['--help', '--json']);
    expect(wordsOf('read --scope ')).toEqual(['here', 'public']);
    expect(wordsOf('read --scope p')).toEqual(['public']);
  });

  it('does not descend into a verb the session refuses', () => {
    // `write move` exists in the tree and is reachable from the shell. Offering it here
    // would be a menu of a level this session cannot get to.
    expect(wordsOf('write ')).toEqual([]);
    expect(wordsOf('write mo')).toEqual([]);
  });

  it('carries what each offer IS, out of the declaration and out of the vocabulary', () => {
    // WHAT THE PALETTE DRAWS ITS SECOND COLUMN FROM, and it is not a table kept here: a
    // verb's half comes from the same `description` commander prints in `--help`, and a
    // session word's from the gloss the vocabulary cannot exist without.
    const offers = complete('')[0];
    const described = new Map(offers.map((offer) => [offer.word, offer.description]));
    expect(described.get('look')).toBe('a read');
    expect(described.get('read')).toBe('another read');
    for (const entry of theSessionsOwnWords()) {
      expect(described.get(entry.word), entry.word).toBe(entry.description);
      // Not vacuous: the gloss is a sentence rather than an empty string.
      expect(entry.description.length).toBeGreaterThan(3);
    }
    // A word the declaration says nothing about arrives undescribed rather than absent,
    // which is what keeps a flag in the menu.
    const flags = new Map(complete('look --')[0].map((offer) => [offer.word, offer.description]));
    expect([...flags.keys()]).toContain('--json');
    expect(flags.get('--json')).toBe('');
  });
});

describe('tab finishes a record the session has already named', () => {
  /**
   * Two records, on the rows a `search` of this product really writes.
   *
   * The ids are the record's own and they share a long prefix, which is the ordinary
   * case rather than a contrived one: an id begins with the millisecond it was minted.
   * That the FORM of one is what the generator produces is proved where the generator is
   * (`core/src/identity/id.test.ts`); what these cases are about is where an offer goes.
   */
  const FIRST = '019fe236-3c8b-795a-a517-f5e55bae80de';
  const SECOND = '019fe236-3d00-73e3-9776-10dca56a5d17';

  /** A completer over the tree above, for a session that has landed those two rows. */
  function completing() {
    const seen = whatTheSessionShowed();
    seen.saw(`  ${SECOND}  public  2026-08-08  the second task (DRAFT)`);
    seen.saw(`  ${FIRST}  public  2026-08-08  the first task (DRAFT)`);
    return completerFor(tree(), verbsOffered(VERBS, SELF), theSessionsOwnWords(), seen.matching);
  }

  it('offers them where an argument goes, and never where a verb goes', () => {
    const complete = completing();
    const under = complete('look ')[0].map((hit) => hit.word);
    expect(under).toEqual([SECOND, FIRST]);
    // A LINE DOES NOT START WITH A RECORD. The top level is what this session RUNS, and
    // an id is in no declaration and answers to nothing.
    expect(complete('')[0].map((hit) => hit.word)).toEqual(
      [...SESSION_WORDS, 'look', 'read'].sort(),
    );
    expect(complete('019')[0]).toEqual([]);
  });

  it('narrows to the prefix, and carries the rest of the row as what it is', () => {
    const complete = completing();
    const [hits, word] = complete(`look ${SECOND.slice(0, 13)}`);
    expect(hits.map((hit) => hit.word)).toEqual([SECOND]);
    expect(word).toBe(SECOND.slice(0, 13));
    // WHAT THE PALETTE'S SECOND COLUMN COMES FROM, and it is what makes a list of ids
    // that begin alike readable at all.
    expect(hits[0]?.description).toBe('public 2026-08-08 the second task (DRAFT)');
    // The shared prefix leaves both, which is the common case.
    expect(complete('look 019fe236-3')[0].map((hit) => hit.word)).toEqual([SECOND, FIRST]);
  });

  it('puts what the declaration says first, and the records after it', () => {
    // A level with subcommands is still its own menu: a reader looking for `move` does
    // not scroll past the records of the session to find it. `read` enumerates two
    // scopes, which is the same question one level down.
    const complete = completing();
    expect(complete('read --scope ')[0].map((hit) => hit.word)).toEqual(['here', 'public']);
    // And a flag that enumerates NOTHING is a flag whose value may well be a record.
    expect(complete('look --json ')[0].map((hit) => hit.word)).toEqual([SECOND, FIRST]);
  });

  it('offers none at all under a verb the session refuses', () => {
    // The other half of "it does not descend": a level this session cannot reach has no
    // records in it either, or a Tab would be listing the record under a word the next
    // line will not run.
    const complete = completing();
    expect(complete('write ')).toEqual([[], '']);
    expect(complete(`write ${SECOND.slice(0, 8)}`)[0]).toEqual([]);
  });
});
