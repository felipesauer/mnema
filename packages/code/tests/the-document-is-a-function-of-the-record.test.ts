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
 * SO THE GUARD IS THE IMPORT, and it is total rather than clever. `@mnema/copilot` is the
 * package that derives every answer this product serves, and it reaches the world through
 * caches its caller opened: it has never imported a module of the runtime, and the surfaces
 * that DO reach one are in `@mnema/code` (`commands/status.ts` resolves a path,
 * `outside-the-record.ts` lists a directory). A test that asked "is this value
 * volatile" would be a judgement about strings; asking whether the layer can reach a clock
 * or a filesystem at all is a fact about the source, and a new module that decided to is
 * red here on the day it is written rather than on the day two clones disagree.
 *
 * THE PRINTER IS IN IT TOO, for the same reason at the other end: `presentation/brief.ts`
 * composes the bytes, and a printer that read an environment variable would move them just
 * as far. The adapter between them is deliberately NOT in this net — it is where the disk
 * is supposed to be touched, and a guard that accused it would be a guard somebody has to
 * write an exception into within a week.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sourceFiles } from './support/reading-source.js';

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

/** Every file under `root` whose source reaches the machine, by repo-relative path. */
function reachTheMachine(root: string): string[] {
  return sourceFiles(root)
    .filter((path) => REACHES_THE_MACHINE.test(readFileSync(path, 'utf-8')))
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
    // THE LIMIT, AND IT IS A REAL ONE. This guards the DIRECT reach — an import of the
    // runtime — which is the shape the mutation took and the shape a person writes. A layer
    // could still reach a disk INDIRECTLY, by importing a function of `@mnema/core` that
    // does: `resolveTrees` walks the filesystem and `systemClock` reads a clock, and both
    // are on that package's surface. Nothing here would see it.
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
