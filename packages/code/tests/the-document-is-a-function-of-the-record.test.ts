/**
 * THE DOCUMENT IS A PURE FUNCTION OF THE RECORD — the property `mnema brief` is sold on,
 * guarded at the PATH and not only at the value.
 *
 * WHAT IS PUBLISHED. `mnema brief --help` says *"The output holds no clock, no session and
 * no path, so the same record always prints the same bytes and a difference is a difference
 * in the record"*, and the file the verb prints says the same thing in its own words:
 * `mnema brief | diff - AGENTS.md` is the ONLY thing that can tell a stale copy from a live
 * one, and it means that only if the bytes move when the record moves and at no other time.
 * Three doc-comments state it — `presentation/brief.ts`, `copilot/src/context/brief.ts`, and
 * the wiring's help above.
 *
 * AND NOTHING GUARDED IT. Measured by mutation, in the delivery that added this file: the
 * composition was made to call `existsSync` on a path of this machine, and the whole suite
 * came back GREEN — 4692 of 4692. The same mutation with the read's value reaching the
 * ANSWER went red in eight places. So the value was guarded and the path was not, and the
 * gap between those two is exactly where the defect lives: a read whose result is the same
 * on every machine the fixtures run on — `existsSync('AGENTS.md')`, a `cwd`, an env var —
 * passes every case there is and moves the bytes on somebody else's checkout. The failure
 * would not be a red test; it would be `diff` reporting a difference that is not the
 * record's, which is the one signal this whole document rests on.
 *
 * THE FIRST GUARD WAS THE IMPORT, AND THE IMPORT IS NOT THE ONLY DOOR. That is the premise
 * this file was written on — *"a layer reaches the world through a module of the runtime, so
 * match the specifier and the door is shut"* — and it is FALSE, measured the same way it was
 * arrived at: with `process.cwd()` and `Date.now()` planted in `copilot/src/context/brief.ts`,
 * the suite came back 4698 of 4698 GREEN and `pnpm lint` green with it. `process`, `Date`,
 * `Math.random` and `globalThis` are already in scope; a clock needs no `import` at all, and
 * the very doc-comment above names *"a `cwd`"* as a failure this net catches. It did not.
 *
 * SO THE NET IS TWO NETS, one per door, and the property is the promise rather than either
 * spelling of it. The import net matches the SPECIFIER on the raw source; the global net
 * matches the identifier on the source with comments, strings and patterns blanked, because
 * a global is an identifier in code and `codeOnly` is what tells one from a mention of one.
 * Neither is clever: what is banned is the whole global, with the two members of `Date` that
 * read no clock named as what they are. That list is a fact of the LANGUAGE — `Date.parse`
 * and `Date.UTC` are string-and-number functions — rather than a list of what this
 * repository happens to call today, which is the kind of list that rots.
 *
 * THE PRINTER IS IN IT TOO, for the same reason at the other end: `presentation/brief.ts`
 * composes the bytes, and a printer that read an environment variable would move them just
 * as far. The adapter between them is deliberately NOT in this net — it is where the disk
 * is supposed to be touched, and a guard that accused it would be a guard somebody has to
 * write an exception into within a week.
 *
 * ITS SIBLING IS `presentation/parts.test.ts`, AND THEY ASK DIFFERENT QUESTIONS. That one
 * bans `process.env`, `process.stdout`, `isTTY`, `NO_COLOR` and a colour library in
 * `code/src/presentation/` — a ban on asking WHERE THE OUTPUT IS GOING, over the raw source,
 * one directory deep. This one bans reaching the machine at all, over `codeOnly`, across a
 * whole package and recursively. They overlap on `process` in one directory and neither
 * subsumes the other, and the reason they are two is that they would be reconciled by
 * deleting a question: a renderer may not paint, and a derivation may not read a clock, and
 * the second says nothing about colour.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOnly, sourceFiles } from './support/reading-source.js';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The layers that may hold NOTHING of this machine: the derivation package whole, and the
 * module that turns its answer into the document's bytes.
 *
 * The `code` side is one FILE and the `copilot` side is a package, and the asymmetry is the
 * point rather than an oversight. Everything in `copilot` answers over caches a caller
 * opened, so the rule is the package's; in `code` the disk is what the package is FOR, and
 * only the printer of this one document owes the property.
 */
const PURE: readonly { readonly what: string; readonly root: string }[] = [
  { what: '@mnema/copilot', root: join(PACKAGES, 'copilot', 'src') },
  { what: 'the document’s printer', root: join(PACKAGES, 'code', 'src', 'presentation') },
];

/**
 * A module of the runtime, named in an import — what a layer reaches the machine THROUGH.
 *
 * It matches the SPECIFIER rather than a function, because the specifier is the door: a
 * scanner looking for `existsSync` would be a list of names that grows, and the one after
 * the list is the one that gets through. Both spellings are matched — `node:fs` is the form
 * this repository writes and bare `fs` is the form somebody pasting from elsewhere writes.
 *
 * IT READS THE RAW SOURCE, AND THAT IS THE ONE PLACE THIS FILE DIFFERS FROM ITS SIBLINGS.
 * Every other structural guard here scans `codeOnly`, which blanks comments AND STRING
 * LITERALS — and a specifier IS a string literal, so the collapsed form of every import in
 * this repository is `import { x } from ''`. The first version of this scanner did that and
 * its own probe caught it: a net over `codeOnly` cannot see an import at all. So the match
 * is anchored to the executable form instead — `import` at the START of a line, which is
 * where this repository writes every one of them and where a `*`-prefixed doc-comment line
 * can never be. It is the same anchoring `DECLARES_MODEL_CHANNEL` uses, for the same reason.
 */
const REACHES_THE_MACHINE =
  /^import\s(?:[^;]*?\bfrom\s+)?['"](?:node:)?(?:fs|path|os|process|child_process|crypto|url|tty|dns|net|http|https)(?:\/[a-z]+)?['"]/m;

/**
 * A global of this machine, reached with NO import at all — the other door.
 *
 * It matches a USE rather than a name, which is what keeps a type annotation out of it:
 * `Date` alone is `const at: Date`, while `new Date`, `Date(`, `Date.now` and `Math.round`
 * are the machine being asked something. `process`, `globalThis`, `performance`,
 * `__dirname` and `__filename` are values wherever they appear, so the bare identifier is
 * the whole match; `require(` is matched at the call because a `require` in these packages
 * could only be one.
 *
 * IT MUST RUN OVER `codeOnly`. Every one of these names appears in the prose of this
 * repository — `process` alone is in nine doc-comments of the two roots — and a net over
 * raw source would accuse every one of them. Blanking comments, strings and patterns is
 * what turns "the word appears" into "the code does it".
 */
const A_GLOBAL_OF_THIS_MACHINE =
  /\b(?:new\s+Date\b|Date\s*(?:\.\s*[A-Za-z_$][\w$]*|\()|Math\s*\.\s*[A-Za-z_$][\w$]*|process\b|globalThis\b|performance\b|require\s*\(|__dirname\b|__filename\b)/g;

/**
 * The members of a banned global that read NOTHING — a fact of the language rather than an
 * allowance for a call site.
 *
 * `Date.parse` and `Date.UTC` take a string or numbers and return a number; `Math` is pure
 * whole except for `Math.random`. Everything else on those two objects reads the clock or
 * the entropy pool, and everything on the other globals reads the machine. A member that is
 * not named here goes red on the day it is written — including one nobody has thought of —
 * which is the opposite of a list of exceptions that grows by one each time.
 */
const READ_NOTHING = new Set(['Date.parse', 'Date.UTC']);

/** Whether one matched use is the machine being read. */
function readsThisMachine(use: string): boolean {
  const said = use.replace(/\s+/g, '').replace(/^new/, '');
  if (said.startsWith('Math.')) return said === 'Math.random';
  if (said.startsWith('Date')) return !READ_NOTHING.has(said);
  return true;
}

/** Every use of a machine global in one file's code, prose and literals excluded. */
function globalsOf(source: string): string[] {
  return (codeOnly(source).match(A_GLOBAL_OF_THIS_MACHINE) ?? []).filter(readsThisMachine);
}

/** Every file under `root` whose source reaches the machine, by repo-relative path. */
function reachTheMachine(root: string): string[] {
  return sourceFiles(root)
    .filter((path) => {
      const source = readFileSync(path, 'utf-8');
      return REACHES_THE_MACHINE.test(source) || globalsOf(source).length > 0;
    })
    .map((path) =>
      path
        .slice(PACKAGES.length + 1)
        .split(sep)
        .join('/'),
    )
    .sort();
}

describe('the bytes of the document move when the record moves, and at no other time', () => {
  it('lets no layer of the document reach a clock or a filesystem at all', () => {
    for (const layer of PURE) {
      expect(reachTheMachine(layer.root), `${layer.what} reaches this machine`).toEqual([]);
    }
  });

  it('read enough source to mean something, or the two sweeps above are empty', () => {
    // The scanner's own non-vacuity: a root that stopped resolving would answer `[]` for
    // the best possible reason and the case above would pass over nothing at all.
    const walked = PURE.flatMap((layer) => sourceFiles(layer.root));
    expect(walked.length).toBeGreaterThan(30);
    expect(walked.map((path) => path.split(sep).join('/'))).toContain(
      join(PACKAGES, 'copilot', 'src', 'context', 'brief.ts').split(sep).join('/'),
    );
    expect(walked.map((path) => path.split(sep).join('/'))).toContain(
      join(PACKAGES, 'code', 'src', 'presentation', 'brief.ts').split(sep).join('/'),
    );
  });

  it('accuses a layer that reached the machine — on input of its own', () => {
    // THE MECHANISM'S TEETH. With the tree honest the case above says only "nothing was
    // accused", so it has never shown this net can go red. The probe is the mutation that
    // found the hole: the composition calling `existsSync`, which left 4692 of 4692 green.
    const probe = "import { existsSync } from 'node:fs';\nconst a = existsSync('/etc');";
    expect(REACHES_THE_MACHINE.test(probe)).toBe(true);
    // Both spellings, since somebody pasting from elsewhere writes the bare one, and the
    // side-effect form, which names no binding to grep for.
    expect(REACHES_THE_MACHINE.test("import { join } from 'path';")).toBe(true);
    expect(REACHES_THE_MACHINE.test("import 'node:process';")).toBe(true);
    // AND IT IS NOT A CONSTANT. The imports these layers really do make come through clean,
    // and a MENTION of one in prose is not a reach — which is what the line anchor buys,
    // since a doc-comment's lines begin with a star.
    expect(REACHES_THE_MACHINE.test("import type { Scope } from '@mnema/core';")).toBe(false);
    expect(REACHES_THE_MACHINE.test(" * it must never import from 'node:fs'.")).toBe(false);
    expect(REACHES_THE_MACHINE.test("const said = readFileSync('x');")).toBe(false);
  });

  it('accuses the global that needs no import — the mutation that went green', () => {
    // THE SECOND NET'S TEETH, and the input is the mutation that falsified this file's own
    // premise: both of these, planted in `copilot/src/context/brief.ts`, left the suite at
    // 4698 of 4698 green while the import net was the only one here.
    expect(globalsOf('const root = process.cwd();')).toEqual(['process']);
    expect(globalsOf('const at = Date.now();')).toEqual(['Date.now']);
    // The rest of the door, each on the form somebody would write.
    expect(globalsOf('const at = new Date();')).toEqual(['new Date']);
    expect(globalsOf('const pick = Math.random();')).toEqual(['Math.random']);
    expect(globalsOf('const g = globalThis.crypto;')).toEqual(['globalThis']);
    expect(globalsOf('const t = performance.now();')).toEqual(['performance']);
    expect(globalsOf("const x = require('node:fs');")).toEqual(['require(']);
    expect(globalsOf('const here = __dirname;')).toEqual(['__dirname']);
  });

  it('leaves the pure members and the prose alone, or it is a net nobody can live with', () => {
    // THE OTHER HALF OF THE SECOND NET. A guard that accused arithmetic and doc-comments
    // would be turned off within a week, and these are the exact uses the two roots make
    // today: three `Date.parse` and seven `Math.<something>`, none of which reads anything.
    expect(globalsOf('const at = Date.parse(envelope.at);')).toEqual([]);
    expect(globalsOf('const at = Date.UTC(2026, 0, 1);')).toEqual([]);
    expect(globalsOf('const w = Math.max(a, b) - Math.floor(c);')).toEqual([]);
    // A type annotation is not a use, and neither is a word in prose or in a string.
    expect(globalsOf('function since(at: Date): number { return 1; }')).toEqual([]);
    expect(globalsOf("const said = 'the process reads Date.now()';")).toEqual([]);
    // The prose cases carry the comment's OPENING, and that is the probe's own finding
    // rather than decoration: `codeOnly` blanks a block from `/*`, so a bare ` * …` line
    // handed to it on its own reads as code and both words are accused. Real source always
    // carries the opening; a probe that dropped it would be testing a file that cannot
    // exist, and this one said so by going red.
    expect(
      globalsOf('/**\n * a command-line process opens them, and Date.now is read.\n */'),
    ).toEqual([]);
    expect(globalsOf('// process.cwd() is banned in this layer, and so is Date.now().')).toEqual(
      [],
    );
    // And a name that merely starts with a banned one is a different name.
    expect(globalsOf('const processed = performanceBudget;')).toEqual([]);
  });

  it('leaves the ADAPTER out, and says so by naming what it does', () => {
    // The other half of a total rule: the disk is touched, and it is touched where the
    // product says it is. A net that accused these would be a net somebody writes an
    // exception into, and an exception is where the next hole goes.
    const adapters = reachTheMachine(join(PACKAGES, 'code', 'src'));
    expect(adapters).toContain('code/src/commands/status.ts');
    expect(adapters).toContain('code/src/outside-the-record.ts');
    // And no file of the printer is among them, which is the case above read from the
    // other end — the same sweep, over a root that holds both.
    expect(adapters.filter((path) => path.startsWith('code/src/presentation/'))).toEqual([]);
  });

  it('says what it does NOT cover, so the promise is not wider than the net', () => {
    // THE LIMIT, AND IT IS A REAL ONE — but it is no longer the one this case used to
    // state. It read "this guards the DIRECT reach — an import of the runtime — which is
    // the shape the mutation took and the shape a person writes", and that sentence was
    // what let `process.cwd()` through: a person writes a global just as readily, and
    // `cwd` was named in the doc-comment above as something caught. Both doors are shut
    // now, and what remains open is the INDIRECT one: a layer can still reach a disk by
    // importing a function of `@mnema/core` that does. `resolveTrees` walks the filesystem
    // and `systemClock` reads a clock, and both are on that package's surface.
    //
    // It is declared rather than closed because closing it is a different guard — which
    // exports of `core` touch the world, derived from `core`'s own source rather than from
    // a list that rots — and that is worth its own delivery. What is asserted here is that
    // the hole is real and NAMED: these two are reachable from the layers above, today.
    const core = readFileSync(join(PACKAGES, 'core', 'src', 'index.ts'), 'utf-8');
    for (const reaches of ['resolveTrees', 'systemClock']) {
      expect(core, `${reaches} is no longer on core's surface`).toContain(reaches);
    }
  });
});
