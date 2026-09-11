/**
 * THE SENTENCE REACHES EVERY DOOR — and eight-of-nine is what this file exists to redden.
 *
 * The promise this product makes lived in NINE places at once and nothing held them
 * together: the npm manifest of the published package, the `--help` of the binary, the
 * golden that pins that help, a second manifest, the opening of four READMEs, and a
 * doc-comment. Measured before this guard existed, the golden covered TWO of them and
 * nothing at all looked at a `package.json`. So the claim on the npm page and the claim in
 * the README could drift apart in silence — and had: the manifest sold *"a tamper-evident,
 * local-first audit chain… that records every action behind workflow gates in a
 * cryptographically verifiable log"* while, forty lines into the same package's README,
 * the product refuted every clause of it in a table.
 *
 * THE GUARD HAS TWO HALVES, because one of them alone is vacuous.
 *
 *   1. THE DOORS SAY IT. Each door below is read off the disk and must carry
 *      {@link PRODUCT_PROMISE} word for word. This is the half that catches a sentence
 *      changed in eight places and left in the ninth, which is the failure that has
 *      actually happened here.
 *   2. NOTHING SAYS THE OLD ONE. Every tracked text file is swept for the clauses the
 *      study falsified, each with the measurement that killed it written beside it. This
 *      is the half that catches the sentence surviving somewhere nobody thought to look —
 *      and prose is where it survives, not code, so the sweep reads AFFIRMATIONS and not
 *      identifiers.
 *
 * WHY IT IS NOT VACUOUS, stated rather than assumed, because a sweep that finds nothing is
 * indistinguishable from a sweep that cannot find anything. The retired clauses are, by
 * design, absent from the repository the day this lands — so the scanner is fed a corpus
 * that DOES contain each one and must name every file it is in. A sweep whose instrument
 * is never shown to fire is a sweep that reports zero when it is broken.
 *
 * TWO THINGS IT DOES NOT DO, and both are the reason the allowlist exists rather than an
 * exemption from it. A clause can appear for a legitimate reason — quoted in order to be
 * refuted, or named as the thing a hook must not claim — and each such place is an entry
 * below carrying WHY. The list is reconciled in both directions: an entry whose file no
 * longer holds its clause is accused just as loudly as a file that holds one and is not
 * listed, so it cannot silently become a blanket. And this file is excluded from its own
 * sweep, because it necessarily spells out every phrase it bans; an instrument that
 * accuses itself teaches its reader to ignore it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli.js';
import { PRODUCT_PROMISE, PRODUCT_PROMISE_CAVEAT } from '../src/promise.js';

/**
 * The workspace root, found by its MARKER and never by counting `..` upwards. A count is
 * a fact about where this file sits today; one `mv` turns it into a path that resolves to
 * a directory with no manifests in it, and every case below then passes over nothing.
 */
const ROOT = ((): string => {
  let at = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(at, 'pnpm-workspace.yaml'))) return at;
    const up = dirname(at);
    if (up === at) throw new Error('no pnpm-workspace.yaml above this file');
    at = up;
  }
})();

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * Whitespace collapsed to single spaces. A sentence wrapped for an 80-column README is
 * the same sentence; comparing raw bytes would make this guard a formatter and nobody
 * would keep it.
 */
const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The golden's transcript prefixes (`| ` for stdout, `! ` for stderr) are not the CLI's bytes. */
const unprefixed = (transcript: string): string =>
  transcript
    .split('\n')
    .map((line) => line.replace(/^[|!] ?/, ''))
    .join('\n');

/** Everything above the first `##`: the part of a README a person reads before deciding. */
const opening = (markdown: string): string => markdown.split('\n## ')[0] as string;

describe('the sentence reaches every door', () => {
  it('the published manifest carries it — the npm page is the first door', () => {
    const manifest = JSON.parse(read('packages/code/package.json')) as { description: string };
    expect(manifest.description).toBe(PRODUCT_PROMISE);
  });

  it('the program carries it — what `mnema --help` prints to everyone', () => {
    const { program } = buildProgram();
    expect(program.description()).toBe(PRODUCT_PROMISE);
  });

  it('the BUILT binary carries it, read off the program and not off the golden', () => {
    const binary = join(ROOT, 'packages/code/dist/cli.js');
    expect(
      existsSync(binary),
      'packages/code/dist is missing — this case reads the built binary, so run `pnpm build` first',
    ).toBe(true);
    const help = execFileSync(process.execPath, [binary, '--help'], { encoding: 'utf8' });
    expect(flat(help)).toContain(flat(PRODUCT_PROMISE));
  });

  it('the golden that pins the help carries it, in both places it prints', () => {
    const golden = flat(unprefixed(read('packages/code/src/cli.help.golden.txt')));
    const occurrences = golden.split(flat(PRODUCT_PROMISE)).length - 1;
    expect(occurrences).toBe(2);
  });

  it("the published package's README carries BOTH lines, above anything else", () => {
    const head = flat(opening(read('packages/code/README.md')));
    expect(head).toContain(flat(PRODUCT_PROMISE));
    expect(head).toContain(flat(PRODUCT_PROMISE_CAVEAT));
  });

  it('the caveat is quoted from the README that already said it, not invented here', () => {
    // It was true in `packages/code/README.md` while every manifest said otherwise; the
    // promise promotes it rather than replacing it, so the two must stay the same words.
    expect(flat(read('packages/code/README.md'))).toContain(
      'The record is **tamper-evident, not tamper-proof**',
    );
  });
});

/**
 * The clauses the study falsified, each with what killed it. These are AFFIRMATIONS, not
 * identifiers: the sentence survives in prose — a README, a manifest, a doc-comment — and
 * not one of those places mentions a function a symbol search would find.
 */
const RETIRED_CLAIMS: readonly { phrase: string; why: string }[] = [
  {
    phrase: 'tamper-evident, local-first audit chain',
    why: 'the headline it opened is retired whole; the record is signed and append-only, and the limit travels with the claim',
  },
  {
    phrase: 'record every action',
    why: 'measured false: an agent left to itself did not ask — `mcp_asked` false in 20 of 20 instrumented cells',
  },
  {
    phrase: 'behind workflow gates',
    why: "gates protect a change's SHAPE, not its contents; the product's own README says they are not access control",
  },
  {
    phrase: 'cryptographically verifiable',
    why: 'true and empty: what verifies is integrity, never who wrote it or when — a record forged whole verifies clean',
  },
  {
    phrase: 'nothing can be silently altered',
    why: 'false for removal: a tail deleted together with its key reads as a record that never held anything',
  },
];

/**
 * Where a retired clause appears for a reason, and what the reason is. Reconciled in BOTH
 * directions — an entry whose file no longer holds its phrase fails as loudly as an
 * unlisted file that does.
 */
const QUOTED_ON_PURPOSE: readonly { file: string; phrase: string; why: string }[] = [
  {
    file: 'plugin/hooks/session-start.mjs',
    phrase: 'behind workflow gates',
    why: 'quoted inside the paragraph that records a premise as FALSE and says what falsified it; deleting the quote would delete the correction',
  },
];

/** This file spells out every phrase it bans; an instrument that accuses itself is ignored. */
const THE_INSTRUMENT = 'packages/code/tests/the-sentence-reaches-every-door.test.ts';

/** Every tracked file that decodes as text. Binary payloads (proofs, keys) are skipped. */
function trackedText(): { file: string; text: string }[] {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const found: { file: string; text: string }[] = [];
  for (const file of listed) {
    if (file === THE_INSTRUMENT) continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;
    found.push({ file, text });
  }
  return found;
}

/** Every (file, clause) pair a corpus holds, lowercased so a capitalised headline cannot hide. */
function sweep(corpus: readonly { file: string; text: string }[]): string[] {
  const hits: string[] = [];
  for (const { file, text } of corpus) {
    const lower = text.toLowerCase();
    for (const { phrase } of RETIRED_CLAIMS) {
      if (lower.includes(phrase.toLowerCase())) hits.push(`${file} :: ${phrase}`);
    }
  }
  return hits.sort();
}

describe('no door still says the retired sentence', () => {
  it('the sweep FIRES — every clause is found, in every file that holds it', () => {
    // Without this the whole guard below reports zero when it is broken, and zero is what
    // a healthy repository looks like. The corpus is written here, not read off the disk.
    const corpus = RETIRED_CLAIMS.map(({ phrase }, at) => ({
      file: `control-${at}.md`,
      text: `A heading\n\nSome prose that ${phrase} in the middle of a line.\n`,
    }));
    expect(sweep(corpus)).toEqual(
      RETIRED_CLAIMS.map(({ phrase }, at) => `control-${at}.md :: ${phrase}`).sort(),
    );
  });

  it('the sweep reads the whole tracked tree, not a handful of files', () => {
    const corpus = trackedText();
    expect(corpus.length).toBeGreaterThan(500);
    expect(corpus.map((entry) => entry.file)).toContain('packages/code/package.json');
    expect(corpus.map((entry) => entry.file)).toContain('SECURITY.md');
  });

  it('nothing tracked still affirms a clause the study falsified', () => {
    const allowed = new Set(QUOTED_ON_PURPOSE.map(({ file, phrase }) => `${file} :: ${phrase}`));
    const accused = sweep(trackedText()).filter((hit) => !allowed.has(hit));
    expect(accused).toEqual([]);
  });

  it('every quoted-on-purpose entry still quotes what it says it quotes', () => {
    const stale = QUOTED_ON_PURPOSE.filter(
      ({ file, phrase }) => !read(file).toLowerCase().includes(phrase.toLowerCase()),
    ).map(({ file, phrase }) => `${file} :: ${phrase}`);
    expect(stale).toEqual([]);
  });
});

/**
 * A MANIFEST HAS NO ROOM TO QUALIFY, which is why the gate needs a rule of its own here
 * and the clause sweep above cannot be it.
 *
 * *Workflow gates* is this product's own vocabulary and it is used correctly in fourteen
 * places — a guard that banned the words would ban the product's language and be switched
 * off within a week. What made the words a claim was WHERE they stood: a `description` is
 * one line, read by somebody who will read nothing else, and *workflow gates* alone in one
 * reads as access control. The package's own README spends a table row saying it is not:
 * *"they protect its SHAPE, not its contents… it is not access control."*
 *
 * So the rule is about the sentence with no room, not about the phrase: a manifest that
 * mentions the gate must say in the same breath what the gate is over. Prose that has room
 * to qualify is left alone, and the sweep above is what watches prose.
 *
 * MEASURED: this case did not exist when the rest of this file did, and the mutation that
 * found the hole is the one that put `workflow gates` back into `packages/core/package.json`
 * — it reddened NOTHING. A guard whose reversion is green is a sitio with no guard.
 */
describe('no manifest sells the gate as more than it is', () => {
  /** Every tracked `package.json` and `plugin.json` that carries a description. */
  const described = (): { file: string; description: string }[] =>
    trackedText()
      .filter(({ file }) => file.endsWith('package.json') || file.endsWith('plugin.json'))
      .flatMap(({ file, text }) => {
        let parsed: { description?: unknown };
        try {
          parsed = JSON.parse(text) as { description?: unknown };
        } catch {
          return [];
        }
        return typeof parsed.description === 'string'
          ? [{ file, description: parsed.description }]
          : [];
      });

  it('finds the manifests that describe themselves — six of them', () => {
    // The non-vacuity of the case below, which is otherwise true of an empty list.
    expect(
      described()
        .map(({ file }) => file)
        .sort(),
    ).toEqual([
      'package.json',
      'packages/chain/package.json',
      'packages/code/package.json',
      'packages/copilot/package.json',
      'packages/core/package.json',
      'plugin/.claude-plugin/plugin.json',
    ]);
  });

  it('a manifest that names the gate says what the gate is over', () => {
    const unqualified = described()
      .filter(({ description }) => /\bgates?\b/i.test(description))
      .filter(({ description }) => !/\b(shape|form)\b/i.test(description))
      .map(({ file }) => file);
    expect(unqualified).toEqual([]);
  });
});

/**
 * A KEYWORD IS A PROMISE WITH NO SENTENCE AROUND IT, and it is the same hole the rule
 * above closes, one field over. A marketplace and an npm search match on these words and
 * show nothing else, so each one has to stand on its own — and `provenance` did not. It
 * says the record ties a fact to where it came from; a record forged whole, `.mnema`
 * deleted and refounded under another key with the opposite decision written in it,
 * verifies clean and word for word like an honest one, and the second reader written from
 * `FORMAT.md` cannot tell them apart either. That is a property of the FORMAT, not a bug
 * in `verify`: what would distinguish them is not in the record for any reader to find.
 *
 * So the words are declared, each with the half of the promise that buys it. A word that
 * is not listed is refused, which makes adding one a line in a diff saying WHY it is true
 * — and the list is reconciled the other way too, so a word that leaves every manifest
 * cannot sit here pretending to guard something.
 *
 * MEASURED: putting `provenance` back into the plugin's keywords reddened NOTHING before
 * this case existed.
 */
const KEYWORDS_THE_PROMISE_BUYS: Readonly<Record<string, string>> = {
  'ai-agents': 'the work the record is of — "the decisions behind AI-agent work"',
  adr: 'what a record holds is decisions with their reasoning, which is what an ADR is',
  'append-only': 'verbatim in the promise, and a property of the format',
  'audit-trail': 'the category a signed, append-only record of who did what belongs to',
  'local-first':
    'no service is asked and no network is needed — the record is in the repository where the work happens, and a stranger checks it without installing this',
  mcp: 'a fact about the shape of the surface, not a claim about the record',
  'model-context-protocol': 'the same fact, spelled the way the protocol is searched for',
  accountability:
    'the record carries who wrote each fact down, which is the third thing the promise names',
  'tamper-evident': 'verbatim in the caveat, and stated there together with what it is NOT',
};

describe('no keyword promises what the sentence does not', () => {
  /** Every keyword any tracked manifest carries, with the manifest it is in. */
  const keywords = (): { file: string; keyword: string }[] =>
    trackedText()
      .filter(({ file }) => file.endsWith('package.json') || file.endsWith('plugin.json'))
      .flatMap(({ file, text }) => {
        let parsed: { keywords?: unknown };
        try {
          parsed = JSON.parse(text) as { keywords?: unknown };
        } catch {
          return [];
        }
        return Array.isArray(parsed.keywords)
          ? parsed.keywords.map((keyword) => ({ file, keyword: String(keyword) }))
          : [];
      });

  it('finds the keywords the manifests actually carry', () => {
    // The non-vacuity of both cases below: an empty reading satisfies each of them.
    expect(keywords().length).toBeGreaterThan(10);
    expect(keywords().map(({ file }) => file)).toContain('plugin/.claude-plugin/plugin.json');
  });

  it('every keyword on a manifest is one the promise buys', () => {
    const unbought = keywords()
      .filter(({ keyword }) => !(keyword in KEYWORDS_THE_PROMISE_BUYS))
      .map(({ file, keyword }) => `${file} :: ${keyword}`)
      .sort();
    expect(unbought).toEqual([]);
  });

  it('every word declared here is on a manifest — the list cannot outlive what it guards', () => {
    const carried = new Set(keywords().map(({ keyword }) => keyword));
    const stale = Object.keys(KEYWORDS_THE_PROMISE_BUYS).filter((word) => !carried.has(word));
    expect(stale).toEqual([]);
  });
});

/**
 * WHERE THIS REPOSITORY SAYS ITS HOME IS. The site three manifests pointed at was switched
 * off on 10 Sep 2026 and answers 404 — and one of the three is the link the npm page shows,
 * so a dead link was the first thing a reader of the published package could click. A dead
 * link is not a claim about the record, so it is asserted apart from the sentence.
 *
 * THE LIST IS READ OFF THE DISK, NEVER TYPED HERE. A list typed here is a list that stays
 * at three while a fourth manifest is added with a home of its own, and the guard would go
 * on passing over the three it knows. So every tracked manifest that names a `homepage` is
 * found, and all of them must name the one destination this repository can prove exists:
 * the repository itself, as `repository.url` gives it.
 */
describe('every manifest points home at the same place', () => {
  /** Every tracked JSON file with a top-level `homepage`, and what it says. */
  const homes = (): { file: string; homepage: string }[] =>
    trackedText()
      .filter(({ file }) => file.endsWith('.json'))
      .flatMap(({ file, text }) => {
        let parsed: { homepage?: unknown };
        try {
          parsed = JSON.parse(text) as { homepage?: unknown };
        } catch {
          return [];
        }
        return typeof parsed.homepage === 'string' ? [{ file, homepage: parsed.homepage }] : [];
      });

  it('finds the manifests that name one, and there are three', () => {
    // The non-vacuity of the case below: a reader that parsed nothing would leave it true.
    expect(
      homes()
        .map(({ file }) => file)
        .sort(),
    ).toEqual(['package.json', 'packages/code/package.json', 'plugin/.claude-plugin/plugin.json']);
  });

  it('all of them name the repository this is, which is a destination that exists', () => {
    const repository = (
      JSON.parse(read('package.json')) as { repository: { url: string } }
    ).repository.url
      .replace(/^git\+/, '')
      .replace(/\.git$/, '');
    expect(repository).toBe('https://github.com/felipesauer/mnema');
    for (const { file, homepage } of homes()) {
      expect(homepage, `${file} points somewhere else`).toBe(repository);
    }
  });
});
