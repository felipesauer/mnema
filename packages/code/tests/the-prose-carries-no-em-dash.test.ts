// @reads-the-tree
/**
 * THE PROSE CARRIES NO EM DASH. Nothing this repository holds as text writes U+2014: not a page,
 * not a comment, not the name of a case, not a string the product prints, not a manifest.
 * A comma, a colon, a full stop or a pair of parentheses says what the dash was standing in for.
 *
 * WHERE THIS COMES FROM. It was counted once: eighteen thousand five hundred and thirty-eight of
 * them across one thousand and ninety-two files, nine in ten of them in comments. A mark that
 * often marks nothing, and each session copied it from the file it was editing.
 *
 * THE BAN IS WHOLE. No file is excused: the first dash in any text the workspace holds is accused
 * at its line and column, except in the directory of copied vectors named below.
 *
 * WHERE THE CHARACTER IS DATA, it is written as an escape (a backslash, the letter u, then the
 * four digits of the code point), and only in the files {@link WHERE_THE_DASH_IS_DATA} names,
 * each with how many it holds and why. An escape anywhere else is accused too: written in a
 * comment it is the same dash, only harder to read, and that is how the escapes found here were
 * born (a tool parameter turns the escape into the character unless its backslash is doubled).
 *
 * WHAT IT DOES NOT COVER: commit messages and pull request descriptions, which no file holds;
 * the en dash (U+2013), which this rule leaves alone; and whether the sentence left where a dash
 * was still says what it said. That last one is a question about prose, answered by review.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The workspace root: this file is `packages/code/tests/…`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** This file, which the scan reaches and must not accuse. */
const HERE = 'packages/code/tests/the-prose-carries-no-em-dash.test.ts';

/**
 * The character and its escapes, spelled by CODE POINT. Written out, either would sit in this
 * file's own source and the scan would find itself.
 */
const EM_DASH = String.fromCodePoint(0x2014);
const BACKSLASH = String.fromCodePoint(0x5c);

/**
 * Every spelling of the escape this corpus could carry, lower-cased (the text is lower-cased
 * before it is counted, so an upper-case digit or name is the same as a lower-case one): the
 * JavaScript, JSON and Python escape, the braced JavaScript one, Python's named one, and the
 * three HTML entities.
 */
const ESCAPES: readonly string[] = [
  `${BACKSLASH}u2014`,
  `${BACKSLASH}u{2014}`,
  `${BACKSLASH}n{em dash}`,
  ...['mdash', '#8212', '#x2014'].map((entity) => `&${entity};`),
];

/**
 * WHERE THE CHARACTER IS DATA: how many escapes each file holds, exactly, and why. A count that
 * drops leaves the entry overstating, and that is red too, so the list cannot keep a file that
 * no longer needs it.
 */
const WHERE_THE_DASH_IS_DATA: Readonly<Record<string, { times: number; why: string }>> = {
  'packages/code/tests/support/signed-hello-stack/stack.sigstore.json': {
    times: 1,
    why:
      'the Rekor checkpoint in this bundle is a C2SP signed note, whose signature line starts with ' +
      'U+2014 and a space; the bundle is JSON, so the character is written as its JSON escape, ' +
      'and `src/commands/stack-signature.test.ts` still verifies the checkpoint with it',
  },
  'packages/code/src/presentation/width.test.ts': {
    times: 1,
    why:
      'the em dash is a character of Ambiguous width, and the case asks for it by its code point ' +
      'to show the surface counts it as one column and not two',
  },
  'packages/code/src/user-corrections.ts': {
    times: 1,
    why:
      'the pattern that reads the opening of a person\'s message accepts an em dash after "no", ' +
      'as it did before; it is a character the reader matches, never one the program prints or records',
  },
  'packages/core/src/adr/read.ts': {
    times: 1,
    why:
      'the importer of decision files written by others still accepts an em dash between the ' +
      'number of a title and its words, so the pattern names it by its code point',
  },
  'packages/core/src/adr/read.test.ts': {
    times: 3,
    why:
      'the cases hand the importer titles written the old way, with an em dash after the ADR ' +
      'number, to show it still strips the number',
  },
};

/**
 * One directory is not ours to write: the test vectors other people wrote, copied byte for byte
 * and held to their SHA-256 by `packages/chain/src/chain/outside-vectors.test.ts`. Some of them
 * are invalid UTF-8 on purpose. Nothing else is left out.
 */
const COPIED_BYTE_FOR_BYTE = 'packages/chain/conformance/vectors/';

/**
 * EVERYTHING THE WORKSPACE HOLDS, ASKED OF GIT: what is tracked and what is present and not
 * ignored, so a file written this minute is read before anybody stages it. A file listed but
 * deleted from the working tree is not there to read.
 */
const listed = (): readonly string[] =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\n')
    .filter(
      (where) =>
        where !== '' && !where.startsWith(COPIED_BYTE_FOR_BYTE) && existsSync(join(ROOT, where)),
    );

interface Read {
  readonly where: string;
  readonly text: string;
}

/**
 * TEXT IS WHAT IS NOT BINARY, whatever its extension: a NUL in the first 8 KB says binary (the
 * GIFs, the OpenTimestamps proofs), and everything else must decode as UTF-8 or it is reported,
 * never skipped.
 */
function readAll(files: readonly string[]): {
  read: Read[];
  binary: string[];
  unreadable: string[];
} {
  const read: Read[] = [];
  const binary: string[] = [];
  const unreadable: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const where of files) {
    const bytes = readFileSync(join(ROOT, where));
    if (bytes.subarray(0, 8192).includes(0)) {
      binary.push(where);
      continue;
    }
    try {
      read.push({ where, text: decoder.decode(bytes) });
    } catch {
      unreadable.push(where);
    }
  }
  return { read, binary, unreadable };
}

const CORPUS = readAll(listed());

/** Where `index` stands in `text`, as `line:column`, both counted from one. */
function position(text: string, index: number): string {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return `${line}:${index - before.lastIndexOf('\n')}`;
}

/** Every index at which `needle` starts in `text`. */
function indexesOf(text: string, needle: string): number[] {
  const at: number[] = [];
  for (let index = text.indexOf(needle); index !== -1; index = text.indexOf(needle, index + 1)) {
    at.push(index);
  }
  return at;
}

/** Every escape in `text`, by index, in order. */
function escapesIn(text: string): number[] {
  const lower = text.toLowerCase();
  return ESCAPES.flatMap((spelling) => indexesOf(lower, spelling)).sort((a, b) => a - b);
}

/** The files that hold the character, each at its first one. */
function withTheDash(read: readonly Read[]): string[] {
  return read
    .filter((file) => file.text.includes(EM_DASH))
    .map((file) => `${file.where}:${position(file.text, file.text.indexOf(EM_DASH))}`)
    .sort();
}

/** The escapes outside the list, each at its first one; and the listed counts that drifted. */
function escapesOutOfPlace(
  read: readonly Read[],
  allowed: Readonly<Record<string, number>>,
): { accused: string[]; drifted: string[] } {
  const accused: string[] = [];
  const drifted: string[] = [];
  const seen = new Map<string, number>();
  for (const file of read) {
    const at = escapesIn(file.text);
    if (at.length === 0) continue;
    seen.set(file.where, at.length);
    if (!(file.where in allowed)) {
      accused.push(`${file.where}:${position(file.text, at[0] as number)}`);
    }
  }
  for (const [where, times] of Object.entries(allowed)) {
    const found = seen.get(where) ?? 0;
    if (found !== times) drifted.push(`${where}: holds ${found}, listed ${times}`);
  }
  return { accused: accused.sort(), drifted: drifted.sort() };
}

const ALLOWED_ESCAPES: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(WHERE_THE_DASH_IS_DATA).map(([where, { times }]) => [where, times]),
);

describe('a sentence carries no em dash, anywhere the workspace holds text', () => {
  it('reads every text file it is given, and the whole workspace', () => {
    expect(CORPUS.unreadable, 'a text file that is not UTF-8 cannot be read').toEqual([]);
    const reached = CORPUS.read.map((file) => file.where);
    expect(reached.length, 'the workspace came back with almost nothing').toBeGreaterThan(1000);
    for (const pkg of ['action', 'chain', 'code', 'context', 'core', 'sdk', 'stacks', 'vscode']) {
      expect(
        reached.filter((where) => where.startsWith(`packages/${pkg}/`)).length,
        `@mnema/${pkg} was not read`,
      ).toBeGreaterThan(0);
    }
    expect(
      reached.filter((where) => where.endsWith('.test.ts')).length,
      'the cases were not read',
    ).toBeGreaterThan(100);
    // Witnesses of every kind of text the emphasis guard's extension list leaves out, and of
    // what the product publishes, prints and writes.
    for (const witness of [
      'README.md',
      'packages/code/package.json',
      'packages/code/src/cli.help.golden.txt',
      '.mnema/.gitignore',
      '.github/workflows/ci.yml',
      'docs/assets/banner-dark.svg',
      'recordings/first-record.sh',
      'recordings/first-record.cast',
      'packages/chain/verifier/mnemaverify/record.py',
      'plugin/hooks/hooks.json',
      HERE,
    ]) {
      expect(reached, `${witness} was not read`).toContain(witness);
    }
    // The binaries are recognised as such, not read as text and not lost either.
    expect(CORPUS.binary, 'the recordings were not recognised as binary').toContain(
      'recordings/first-record.gif',
    );
  });

  it('is held by no file', () => {
    expect(withTheDash(CORPUS.read), 'an em dash was written').toEqual([]);
  });

  it('is written as an escape only where it is data, and as many times as the list says', () => {
    const { accused, drifted } = escapesOutOfPlace(CORPUS.read, ALLOWED_ESCAPES);
    expect(accused, 'an escaped em dash is written outside the files that list it').toEqual([]);
    expect(drifted, 'a listed file no longer holds what the list says').toEqual([]);
    for (const { why } of Object.values(WHERE_THE_DASH_IS_DATA)) {
      expect(why.length, 'an entry is listed without its reason').toBeGreaterThan(20);
    }
  });

  it('and its own source names neither the character nor an escape of it', () => {
    const own = readFileSync(join(ROOT, HERE), 'utf-8');
    expect(own.includes(EM_DASH), 'the scan finds itself').toBe(false);
    expect(escapesIn(own), 'the scan finds an escape in itself').toEqual([]);
  });

  it('would find the dash in any kind of text, at its line and column, and not its neighbours', () => {
    const sample = (where: string, text: string): Read => ({ where, text });
    // One sample per kind of text the corpus holds, each built from the code point.
    expect(
      withTheDash([
        sample('a.md', `# Title\n\nA page ${EM_DASH} a clause.`),
        sample('b.ts', `  // a comment ${EM_DASH} and its tail`),
        sample('c.ts', `const said = 'printed ${EM_DASH} text';`),
        sample('d.yml', `name: a job ${EM_DASH} named`),
        sample('e.json', `{ "description": "a manifest ${EM_DASH} line" }`),
        sample('f.svg', `<svg><text>a heading ${EM_DASH} drawn</text></svg>`),
        sample('docs/g.md', `listed ${EM_DASH} area`),
      ]),
    ).toEqual([
      'a.md:3:8',
      'b.ts:1:16',
      'c.ts:1:23',
      'd.yml:1:13',
      'docs/g.md:1:8',
      'e.json:1:30',
      'f.svg:1:22',
    ]);
    // The hyphen, the en dash and two hyphens are not it; neither is the escape, which is
    // accused by its own case and not by this one.
    const neighbours = [
      'a - b',
      `a ${String.fromCodePoint(0x2013)} b`,
      'a -- b',
      `a ${ESCAPES[0]} b`,
    ];
    expect(withTheDash(neighbours.map((text) => sample('h.md', text)))).toEqual([]);
    // And every spelling of the escape is found, in any case.
    for (const spelling of ESCAPES) {
      expect(escapesIn(`x ${spelling.toUpperCase()} y`), spelling).toEqual([2]);
    }
  });
});
