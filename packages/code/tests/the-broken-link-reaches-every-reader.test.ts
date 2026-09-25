/**
 * EVERY DOOR THAT SERVES THE RECORD SAYS WHEN THE RECORD DOES NOT CHAIN.
 *
 * ## What it was
 *
 * Two reads said it — `search` and `status` on the command line. Fifteen others did
 * not, and the MCP did not at all: `grep -rn "linkBreak" packages/code/src/mcp/` came
 * back with nothing, so not one of the twenty-five tools told an agent that what it was
 * being handed came off a record whose proof had failed. By this product's own axis the
 * agent is the principal reader, and it was the only one never told.
 *
 * ## Why this file is a SHAPE and not a behaviour
 *
 * The behaviour is next door, in `the-read-says-the-record-does-not-chain.test.ts`,
 * which plants a real break in a real tail and reads what the real binary prints. What
 * that cannot do is catch the read added next year. A rule that lives at seventeen call
 * sites has a seventeen-plus-first, and the only thing that finds it is a walk of the
 * source keyed on the DISCRIMINANT rather than on a list somebody maintains.
 *
 * So the discriminant here is how this package reaches a record at all, and every file
 * that does must ask a reading that carries the fact or be in `SERVES_NO_RECORD_CONTENT`
 * with a written reason. THREE of the sites the first delivery covered were found that way
 * and by no other means: `show`, `guard` and `next-actions` open their caches directly, so
 * the handoff's own `grep` for `withScopedCaches` did not name them, and `show` is the verb
 * that serves a record's BODY.
 *
 * ## The discriminant carried the blind spot, and that is the second half of this file
 *
 * It was the PROJECTION CACHE and nothing else — four ways of opening one — and the whole
 * of the console fell outside it. `packages/code/src/repl/` serves the record by every
 * ordinary meaning of the word: the opening panel prints a verdict, the corner holds the
 * proven level on every frame of the session, and the feed shows what another process
 * appended while the page was up. It opens no cache to do any of it. It reaches the chain
 * directly — `runVerify` in `session.ts`, `chainExtent` and `readTailTip` in
 * `following.ts` — so `grep -rn "linkBreak" packages/code/src/repl/` came back with
 * nothing, and this file was green over it.
 *
 * What that cost is measured: with a duplicate of the tail's last entry appended during a
 * session, the body of the page printed `seq gap: expected 8, found 7` and the corner said
 * `fully-signed` in the SAME FRAME
 * (`the-corner-says-what-its-level-covers.test.ts`). A rule applied at N sites has an
 * N-plus-first, and here the N-plus-first was a whole surface — reached by a door the
 * sweep did not know was a door. So there is a second list ({@link READS_THE_CHAIN}), and
 * a second reading that answers for it ({@link CARRIES_THE_FACT}): the console cannot ask
 * for a cache's breaks, because it holds no cache, and what it asks instead is whether the
 * record has moved past what was ruled on.
 *
 * ## What it covers now, and what it covered before
 *
 * It was written for the READS and the MCP's writes were outside it — `recorded` and
 * `moved` composed their own envelope, and this file's own assertion was keyed on the
 * read's call site (`linkBreakBlock(sessionLinkBreaks(session))`), which is a guard
 * green over the hole it existed to find. That is the shape this bench names: a rule
 * applied at half its sites, with the guard keyed on the half that has it.
 *
 * So the MCP half is keyed on two things that cannot be half-true: the reading is asked
 * in exactly ONE place and every composer reaches it, and every tool the server
 * REGISTERS (read off `mutatesTheRecord`/`readsTheRecord`, which is what every
 * registration is wrapped in) answers through a composer or is excused with a reason.
 *
 * ## What it does not answer
 *
 * That the notice is CORRECT, or that it reaches the stream it should. Both belong to
 * the behavioural half — `the-read-says-the-record-does-not-chain.test.ts` and
 * `the-agent-is-told-the-record-does-not-chain.test.ts` for the reads,
 * `the-write-says-what-it-landed-on.test.ts` for the writes. This says the obligation
 * was not skipped.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  linkBreakBlock,
  linkBreakBlockOnWrite,
  linkBreakSentences,
  SERVES_NO_RECORD_CONTENT,
  TOOLS_SERVING_NO_RECORD_CONTENT,
} from '../src/record-integrity.js';

const SRC = join(import.meta.dirname, '..', 'src');

/**
 * The ways anything in this package opens a record to read it.
 *
 * IT GREW BY TWO AND THE REASON IS WORTH THE LINE. `withCache` and `withOpenedCaches`
 * arrived when the open and the close were paired into one call
 * (`the-record-is-opened-and-closed-together.test.ts`), and three of the doors this sweep
 * covers — `commands/guard.ts`, `commands/next-actions.ts`, `pinned-run.ts` — stopped
 * writing `ProjectionCache.open(` on the same day. Left unamended this list would have
 * gone on passing while those three dropped out of the sweep entirely: a door is only a
 * door here if one of these strings is in it, and a guard that quietly stops asking is
 * worse than one that never asked.
 */
const OPENS_A_RECORD = [
  'withScopedCaches(',
  'withOpenedCaches(',
  'withCache(',
  'ProjectionCache.open(',
];

/**
 * The reading every door that serves the record has to ask for — as a CALL, with its
 * open parenthesis, and that is not pedantry. Read as a bare identifier this matches the
 * IMPORT too, so a command that keeps `import { linkBreaksOf, type ScopedLinkBreak }` and
 * answers `linkBreaks: []` stays green. Measured: that mutation left this file silent and
 * the lint silent (the type in the same import is still used, so nothing is orphaned) and
 * was caught by the behavioural half alone. With the parenthesis it is caught here too.
 */
const ASKS_THE_READING = 'linkBreaksOf(';

/**
 * The ways anything in this package reads the CHAIN with no projection cache in between.
 *
 * It is a second list and not four more entries in {@link OPENS_A_RECORD} because the
 * question each answers is different, and the two have different obligations: a door that
 * holds a cache can be asked for that cache's breaks, and a door that holds none cannot.
 * Keeping them apart is what lets the excuse for one be an honest sentence about the other.
 *
 * WHAT PUT IT HERE is that the first list was the whole universe and the console was
 * outside it — see the note at the top of this file. The names are the chain package's own
 * entry points, read as CALLS for the reason {@link ASKS_THE_READING} is: a bare identifier
 * matches the import, so a file that keeps the import and calls nothing stays green.
 */
const READS_THE_CHAIN = [
  'runVerify(',
  'verifyChain(',
  'chainExtent(',
  'readTail(',
  'readTailEntries(',
  'readTailTip(',
  'readTailSince(',
];

/**
 * The readings that CARRY the fact — either of which discharges the obligation.
 *
 * There are two because the two kinds of door can answer different questions honestly, and
 * neither is a weaker form of the other. `linkBreaksOf` says which tails do not chain, off
 * a replay a read already paid for. `watchingTheProof` says that the record has moved past
 * what a verdict was formed over, off one `readdir` per tail — narrower, and the only thing
 * a surface that holds no cache can say without re-running a verifier that costs 54 ms to
 * 1.7 s — measured while it still walked the tail once per checkpoint, and a pass over
 * every event since it stopped (`repl/proving.ts` has both).
 *
 * A THIRD ONE IS A CLAIM AND NOT A CONVENIENCE: it would be a third answer about the same
 * bytes, and this file's last describe is what says two wordings is the ceiling.
 */
const CARRIES_THE_FACT = [ASKS_THE_READING, 'watchingTheProof('];

/** Every `.ts` under `src`, as a path relative to it — tests excluded. */
function sources(dir = SRC, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const at = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...sources(join(dir, entry.name), at));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.includes('.test.')) continue;
    found.push(at);
  }
  return found;
}

const text = (relative: string): string => readFileSync(join(SRC, relative), 'utf-8');

const LF = '\n';

/**
 * The body of a top-level function declaration, read by matching braces.
 *
 * It is read from the source rather than reasoned about from the module's exports
 * because what is being asserted is where a CALL sits — and a call is a fact about the
 * text. Braces inside strings and comments are not discounted, which is sound here for
 * the reason it would not be in a parser: these four functions hold none.
 *
 * THE BODY OPENS AT THE FIRST BRACE THAT ENDS A LINE, and that is the whole care this
 * needs: every one of these signatures declares an object RETURN TYPE, so the first
 * brace after the parameter list opens `{ readonly content: … }` and not the body. The
 * first version took it and every case passed on the type — which is a guard reading the
 * wrong text and reporting on it, the shape this bench calls an instrument that lies.
 */
function bodyOf(source: string, name: string): string {
  const at = source.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`no function ${name} in the source`);
  const open = source.indexOf('{\n', at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`function ${name} does not close`);
}

/**
 * The module that DEFINES a reading is not a door, and it is excluded by reading the
 * source rather than by name: a file holding `export function linkBreaksOf` is where the
 * rule lives, and asking it to call itself would be asking for noise. The same is true of
 * the module that defines the other one.
 */
const defines = (path: string): boolean =>
  CARRIES_THE_FACT.some((reading) => text(path).includes(`export function ${reading}`));

/** Every file that opens a projection cache — the first kind of door. */
const opens = sources().filter(
  (path) => !defines(path) && OPENS_A_RECORD.some((how) => text(path).includes(how)),
);

/**
 * Every file that reads the chain with no cache in between — the second kind, and the one
 * the console is in.
 *
 * A file already counted as a cache door is left out: it is one door, and listing it twice
 * would make a single excuse read as two.
 */
const reads = sources().filter(
  (path) =>
    !defines(path) &&
    !opens.includes(path) &&
    READS_THE_CHAIN.some((how) => text(path).includes(how)),
);

/** Both kinds together — what an excuse may be written for, and nothing else. */
const doors = [...opens, ...reads];

describe('every read that opens the record either asks for the breaks or says why not', () => {
  // THE NON-VACUITY GUARD, and it runs first. A sweep whose pattern has stopped matching
  // finds nothing and reports success — this repository has been bitten by exactly that
  // — so the count is pinned above the number of doors the delivery covered.
  it('finds the doors at all', () => {
    expect(opens.length).toBeGreaterThanOrEqual(18);
  });

  it.each(opens)('%s', (path) => {
    const asks = text(path).includes(ASKS_THE_READING);
    const excused = SERVES_NO_RECORD_CONTENT[path];
    // Asserted as the PAIR rather than as two conditions, so a red says which of the two
    // it is: a file that does both is as wrong as one that does neither — an excuse
    // beside a call is an excuse nobody reads.
    expect({ path, asks, excused: excused !== undefined }).toStrictEqual({
      path,
      asks: excused === undefined,
      excused: excused !== undefined,
    });
  });

  it('excuses nothing that does not reach a record', () => {
    // An entry left behind when its file stopped reaching a record is an excuse for a
    // door that no longer exists, and the next reader takes it for a classification.
    //
    // IT IS ASKED OVER BOTH KINDS OF DOOR, which is what the second discriminant forced:
    // asked over the cache doors alone it would call every excuse written for a chain door
    // an excuse for nothing.
    expect(Object.keys(SERVES_NO_RECORD_CONTENT).filter((p) => !doors.includes(p))).toStrictEqual(
      [],
    );
  });

  it('gives a reason and not a marker', () => {
    for (const [path, why] of Object.entries(SERVES_NO_RECORD_CONTENT)) {
      expect(why.length, path).toBeGreaterThan(40);
    }
  });
});

describe('every read that reaches the CHAIN with no cache says it too, or says why not', () => {
  /**
   * THE NON-VACUITY GUARD, AND IT NAMES THE SITE THAT MOTIVATED THE LIST. A count alone is
   * the shape this bench has been bitten by — a sweep whose pattern stopped matching finds
   * nothing and reports success — and a count alone would also survive the one mutation
   * that matters here: taking the console back out of the universe. `repl/session.ts` is
   * where the badge is composed and where the reading is asked, so it is named.
   */
  it('finds the doors at all, and the console is one of them', () => {
    expect(reads.length).toBeGreaterThanOrEqual(4);
    expect(reads).toContain('repl/session.ts');
    expect(reads).toContain('repl/following.ts');
  });

  it.each(reads)('%s', (path) => {
    const asks = CARRIES_THE_FACT.some((reading) => text(path).includes(reading));
    const excused = SERVES_NO_RECORD_CONTENT[path];
    // Asserted as the PAIR rather than as two conditions, so a red says which of the two
    // it is: a file that does both is as wrong as one that does neither.
    expect({ path, asks, excused: excused !== undefined }).toStrictEqual({
      path,
      asks: excused === undefined,
      excused: excused !== undefined,
    });
  });

  /**
   * AND THE CONSOLE ASKS IT IN ONE PLACE, which is the half a per-file sweep cannot say.
   *
   * The corner is the surface's one statement about what the record proved. A second reading
   * on the same clock — the feed composing an opinion of its own, say — would be one screen
   * holding two answers about the same bytes, which is exactly what the excuse written for
   * `repl/following.ts` promises does not happen.
   */
  it('and the console asks it in exactly one place', () => {
    const asking = sources().filter(
      (path) => !defines(path) && text(path).includes('watchingTheProof('),
    );
    expect(asking).toStrictEqual(['repl/session.ts']);
  });
});

describe('every wiring that prints such a read prints the notice', () => {
  /** The command modules that answer with the breaks — read off their source. */
  const answering = sources()
    .filter((path) => path.startsWith('commands/') && text(path).includes('readonly linkBreaks:'))
    .map((path) => path.slice('commands/'.length, -'.ts'.length));

  it('finds the commands at all', () => {
    expect(answering.length).toBeGreaterThanOrEqual(15);
  });

  /** The wirings, each with the command modules it loads. */
  const wirings = sources()
    .filter((path) => path.startsWith('wiring/'))
    .map((path) => ({
      path,
      body: text(path),
    }))
    .map((file) => ({
      ...file,
      loads: answering.filter((command) => file.body.includes(`'../commands/${command}.js'`)),
    }))
    .filter((file) => file.loads.length > 0);

  it('finds the wirings at all', () => {
    expect(wirings.length).toBeGreaterThanOrEqual(13);
  });

  it.each(wirings.map((file) => [file.path, file] as const))('%s', (_path, file) => {
    // The command answering with the breaks is only half of it: what the person reads is
    // what the WIRING writes, and a field nobody prints is a field that says nothing.
    expect({ wiring: file.path, prints: file.body.includes('linkBreakNotice(') }).toStrictEqual({
      wiring: file.path,
      prints: true,
    });
  });
});

describe('the MCP composes no payload of its own', () => {
  const server = text('mcp/server.ts');

  it('every tool answers through the one door', () => {
    // The composer is what carries the fact, so a payload built beside it is a tool that
    // does not. It is read as TEXT rather than by counting calls to `served`, because a
    // tool that never reached the composer would leave the count right and the reply
    // wrong.
    const handRolled = server
      .split('\n')
      .map((line, at) => ({ line: line.trim(), at: at + 1 }))
      .filter((row) => row.line.startsWith('return { content: [{'))
      .filter((row) => !row.line.includes('Refused ('));
    // ONE, and it is `rules_before_an_edit` — the hook reply, excused with its reason.
    expect(handRolled.map((row) => row.at)).toHaveLength(
      Object.keys(TOOLS_SERVING_NO_RECORD_CONTENT).length,
    );
    // THE FORM'S OWN NON-VACUITY, ASKED ONCE AND OUTSIDE THE LOOP. It used to be the
    // first line INSIDE the loop, as a `.test()` on a literal carrying `g`, and two
    // things were wrong with it. It asked nothing about `tool` — the same question, N
    // times — and a pattern with `g` carries `lastIndex` BETWEEN calls, so alternate
    // calls answer `false` over input that never changed. It never moved the verdict:
    // the `toContain` below is what catches a tool nothing registers. An assertion that
    // can pass by accident is one that eventually does, and this one was inherited.
    const declared = server.match(/(reads|mutates)TheRecord\('([a-z_]+)'\)/g) ?? [];
    expect(declared.length).toBeGreaterThanOrEqual(
      Object.keys(TOOLS_SERVING_NO_RECORD_CONTENT).length,
    );
    // And each excused tool is a tool this server actually registers — an excuse for a
    // name nothing registers is an excuse for nothing.
    for (const tool of Object.keys(TOOLS_SERVING_NO_RECORD_CONTENT)) {
      expect(server, tool).toContain(`TheRecord('${tool}')`);
    }
  });

  /**
   * THE READING IS ASKED IN ONE PLACE, and every composer reaches that place.
   *
   * It used to assert the literal `linkBreakBlock(sessionLinkBreaks(session))`, which was
   * true of the reads and said nothing about the writes — and the writes were exactly
   * what was missing. Two composers built their own envelope beside `served` and neither
   * of them asked anything, so a guard keyed on the read's own call site was green over
   * the hole it was supposed to find.
   *
   * So it is keyed on the COUNT now: one call, in one function, that every composer goes
   * through. A composer added next year that asks the reading itself reddens this as
   * surely as one that never asks at all — the second reading is the divergence the rule
   * exists to prevent, and the missing one is the silence.
   *
   * THE PATTERN CARRIES A COMMA NOW, and that is not cosmetic. The reading takes which
   * door is asking, because the two doors read the fact from different moments — the write
   * from the chain as it stands, the read from the replay `CacheRegistry.get` just brought
   * forward. A call site that dropped the argument would not compile; one that passed the
   * wrong arm would compile and go quiet, which is why the two names are asserted below.
   */
  it('the reading is asked in exactly one place', () => {
    expect(server.match(/sessionLinkBreaks\(session,/g) ?? []).toHaveLength(1);
    // And that place is what picks between the module's two openings, so the fact a
    // write carries and the fact a read carries are the same bytes below the clause.
    const envelope = bodyOf(server, 'replied');
    expect(envelope).toContain('linkBreakBlockOnWrite');
    expect(envelope).toContain('linkBreakBlock');
    expect(envelope).toContain('sessionLinkBreaks(session,');
    // AND IT PICKS THE SECOND THING TOO, which arrived with the write door's own answer:
    // the two differ by WHEN the fact is read from, and the one call site is where that is
    // decided. A composer that reached for one arm by hand would be a second decision.
    expect(envelope).toContain('A_WRITE');
    expect(envelope).toContain('A_READ');
  });

  it.each(['served', 'recorded', 'moved'])('%s composes through the envelope', (composer) => {
    // A composer that built its `content` by hand is the defect this closed: it would
    // leave the tool list right and the reply wrong.
    expect(bodyOf(server, composer)).toContain('replied(');
  });

  /**
   * EVERY TOOL THIS SERVER REGISTERS ANSWERS THROUGH A COMPOSER — keyed on the
   * DECLARATION and not on a list, so a tool added next year is classified or it is red.
   *
   * `mutatesTheRecord` and `readsTheRecord` are what every registration is wrapped in
   * (`every-tool-says-if-it-writes.test.ts` holds that), which makes them the
   * discriminant: read them off the source and each one's handler must return through a
   * composer, or the tool must be excused with its reason.
   */
  it('every registered tool answers through a composer', () => {
    const COMPOSERS = ['served', 'withRunState', 'recorded', 'moved'];
    const declared = [...server.matchAll(/(?:reads|mutates)TheRecord\('([a-z_]+)'\)/g)];
    // The non-vacuity guard: a pattern that stopped matching would find no tools and
    // report success.
    expect(declared.length).toBeGreaterThanOrEqual(25);
    for (const [index, match] of declared.entries()) {
      const tool = match[1] as string;
      const from = match.index as number;
      const to = (declared[index + 1]?.index as number | undefined) ?? server.length;
      const handler = server.slice(from, to);
      const answers = COMPOSERS.some((composer) => handler.includes(`return ${composer}(`));
      const excused = TOOLS_SERVING_NO_RECORD_CONTENT[tool] !== undefined;
      // Asserted as the PAIR, so a red says which of the two it is.
      expect({ tool, answers, excused }).toStrictEqual({
        tool,
        answers: !excused,
        excused,
      });
    }
  });
});

describe('the words have two openings and may not have three', () => {
  const words = text('record-integrity.ts');
  /** How every opening of the block ends — the clause before it is what differs. */
  const OPENS = 'does not chain, so its proof is broken:';

  it('two, and both in the module that holds the words', () => {
    // A read's answer came OFF the record and a write's fact went ONTO it; a third
    // wording would be a third opinion about the same bytes, which is what this module
    // exists to prevent.
    expect(words.split(OPENS).length - 1).toBe(2);
  });

  it('and no other module writes one', () => {
    expect(
      sources().filter((path) => path !== 'record-integrity.ts' && text(path).includes(OPENS)),
    ).toStrictEqual([]);
  });

  it('the two differ only in the clause', () => {
    const breaks = [
      { scope: 'public' as const, tail: 'aa-01', seq: 4, detail: 'seq gap: expected 5, found 4' },
    ];
    const read = linkBreakBlock(breaks)[0] as string;
    const write = linkBreakBlockOnWrite(breaks)[0] as string;
    expect(read).not.toBe(write);
    // Everything below the opening line is the same bytes down both roads: the issue
    // lines and the closing sentence are about the record, and the record is the same.
    expect(write.split(LF).slice(1)).toStrictEqual(read.split(LF).slice(1));
    expect(write.split(LF)[0]).toContain('this landed on');
    expect(read.split(LF)[0]).toContain('this answer came off');
  });

  it('and both are empty over a record that chains', () => {
    // The vacuity guard for the write's form, the same one the read's already has.
    expect(linkBreakBlockOnWrite([])).toStrictEqual([]);
  });
});

describe('the words have one home', () => {
  it('no other module writes the sentence', () => {
    const wrote = sources().filter(
      (path) => path !== 'record-integrity.ts' && text(path).includes('issue [T1]'),
    );
    expect(wrote).toStrictEqual([]);
  });

  it('and the two forms are the same words', () => {
    const breaks = [
      { scope: 'public' as const, tail: 'aa-01', seq: 4, detail: 'seq gap: expected 5, found 4' },
    ];
    const sentences = linkBreakSentences(breaks);
    const block = linkBreakBlock(breaks)[0] as string;
    // Every issue line of the one form is in the other, byte for byte: the difference
    // between the two is the frame around them and the door each names, never the fact.
    expect(block).toContain(sentences[0] as string);
    expect(sentences[0]).toContain('issue [T1] public aa-01#4:');
  });

  it('and both are empty over a record that chains', () => {
    // The vacuity guard for the words themselves: a form that spoke on an empty list
    // would make every case above pass over a notice printed unconditionally.
    expect(linkBreakSentences([])).toStrictEqual([]);
    expect(linkBreakBlock([])).toStrictEqual([]);
  });
});
