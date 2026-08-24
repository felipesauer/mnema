import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIELD_BYTE_LIMIT } from '../content/screen.js';
import { scanAdrDirectory } from './scan.js';

let sandbox: string;
let base: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-adr-scan-'));
  base = join(sandbox, 'docs', 'adr');
  mkdirSync(base, { recursive: true });
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Writes a document into the scanned directory. */
function file(name: string, text: string): void {
  writeFileSync(join(base, name), text, 'utf8');
}

/** A well-formed document, so a case can vary one thing at a time. */
function decision(title: string, extra = ''): string {
  return `# ${title}\n\n## Context\n\nwhy this was decided\n${extra}`;
}

describe('reading a directory of decision documents', () => {
  it('reads every markdown file, in file-name order', () => {
    // The order is the file name so two runs report the same list in the same order
    // — and an ADR file name carries the sequence its author intended.
    file('0002-second.md', decision('Second'));
    file('0001-first.md', decision('First'));
    file('0003-third.markdown', decision('Third'));

    const scan = scanAdrDirectory(base);
    expect(scan.read.map((d) => d.title)).toEqual(['First', 'Second', 'Third']);
    expect(scan.read.map((d) => d.path)).toEqual([
      `${base}/0001-first.md`,
      `${base}/0002-second.md`,
      `${base}/0003-third.markdown`,
    ]);
  });

  it('leaves everything that is not markdown alone', () => {
    file('0001-a.md', decision('A'));
    file('notes.txt', decision('Not markdown'));
    file('data.json', '{}');

    expect(scanAdrDirectory(base).read.map((d) => d.title)).toEqual(['A']);
  });

  it('does not descend into subdirectories', () => {
    // A recursive walk pointed at a repository root would read every markdown file
    // in it — a README, a changelog, an issue template — and propose whatever had
    // a heading and a paragraph. The caller names the directory; nothing guesses.
    mkdirSync(join(base, 'archive'));
    writeFileSync(join(base, 'archive', '0009-buried.md'), decision('Buried'), 'utf8');
    file('0001-a.md', decision('A'));

    const scan = scanAdrDirectory(base);
    expect(scan.read.map((d) => d.title)).toEqual(['A']);
    expect(scan.refused).toEqual([]);
  });

  it('leaves a decision base’s own furniture out, by name', () => {
    // A template parses: it has a title and a `## Context` full of instructions.
    // Reading one would propose "Short title of solved problem" as a decision of
    // the project, which is exactly the wrong proposal this excludes.
    file('README.md', decision('Index of decisions'));
    file('template.md', decision('Short title of solved problem and solution'));
    file('FORMATO.md', decision('Como escrever um ADR'));
    file('0001-a.md', decision('A'));

    const scan = scanAdrDirectory(base);
    expect(scan.read.map((d) => d.title)).toEqual(['A']);
    // Furniture is not a REFUSAL either — it was never a candidate.
    expect(scan.refused).toEqual([]);
  });

  it('names the shape it could not read, rather than guessing at it', () => {
    file('0001-no-title.md', 'a paragraph with no heading\n');
    file('0002-no-why.md', '# Use UTC\n\n## Consequences\n\nclocks agree\n');

    const scan = scanAdrDirectory(base);
    expect(scan.read).toEqual([]);
    expect(scan.refused.map((r) => r.code)).toEqual(['NO_TITLE', 'NO_RATIONALE']);
    expect(scan.refused[0]?.path).toBe(`${base}/0001-no-title.md`);
  });

  it('skips a document whose own status says it is no longer in force', () => {
    file('0001-live.md', decision('Live'));
    file('0002-gone.md', `# Gone\n\n- **Status:** Superseded by ADR-3\n\nwhy\n`);

    const scan = scanAdrDirectory(base);
    expect(scan.read.map((d) => d.title)).toEqual(['Live']);
    expect(scan.refused).toEqual([{ path: `${base}/0002-gone.md`, code: 'RETIRED' }]);
  });

  it('refuses the whole file when a field holds something shaped like a credential', () => {
    // Text from somebody else's file is exactly the untrusted input the content door
    // exists for, and the door SCRUBS and reports — right for a person typing one
    // fact, wrong for a bulk read: a placeholder recorded on a person's behalf, in a
    // document they did not write, is a permanent entry nobody chose. So the FILE is
    // refused, by name, with the class named — and the value never travels.
    file('0001-clean.md', decision('Clean'));
    file(
      '0002-leaky.md',
      decision(
        'Leaky',
        '\n## Considered Options\n\nwe tried sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefgh\n',
      ),
    );

    const scan = scanAdrDirectory(base);
    expect(scan.read.map((d) => d.title)).toEqual(['Clean']);
    const refusal = scan.refused[0];
    expect(refusal?.code).toBe('HOLDS_A_SECRET');
    expect(refusal?.path).toBe(`${base}/0002-leaky.md`);
    expect(refusal?.classes?.length).toBeGreaterThan(0);
    // The class travels and the value never does — the record's own posture.
    expect(JSON.stringify(scan)).not.toContain('sk-ant-api03-ABCDEFGHIJ');
  });

  it('refuses a field the record would refuse anyway, before anything is written', () => {
    // The door would refuse this append. Refusing here means the caller learns it
    // while nothing has been written, instead of halfway through a directory.
    file('0001-huge.md', decision('Huge', `\n${'x'.repeat(FIELD_BYTE_LIMIT + 1)}\n`));

    const scan = scanAdrDirectory(base);
    expect(scan.read).toEqual([]);
    expect(scan.refused.map((r) => r.code)).toEqual(['FIELD_TOO_LARGE']);
  });

  it('weighs a field in BYTES and not in characters', () => {
    // The chain stores UTF-8, so the limit is measured in what it actually costs.
    // A field of accented text under the limit in characters can be over it in
    // bytes, and a character count would let it through to be refused by the door.
    const twoByte = 'é'.repeat(FIELD_BYTE_LIMIT - 100);
    expect(twoByte.length).toBeLessThan(FIELD_BYTE_LIMIT);
    file('0001-heavy.md', decision('Heavy', `\n${twoByte}\n`));

    expect(scanAdrDirectory(base).refused.map((r) => r.code)).toEqual(['FIELD_TOO_LARGE']);
  });

  it('comes back empty for a directory that is not there', () => {
    // Throwing would make a typo in a path look like a failure of the product.
    expect(scanAdrDirectory(join(sandbox, 'nowhere'))).toEqual({ read: [], refused: [] });
  });
});
