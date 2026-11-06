/**
 * THE FRAMES OF `mnema init`, as the lines the renderer turns into bytes, at the two widths a terminal is
 * likely to be (`init/screens.ts`, `init/layout.ts`, `init/summary.ts`).
 *
 * A FRAME HAS NO TERMINAL IN IT: it is a function from facts to `Line`s, so the golden beside this file
 * (`the-init-draws-its-frames.golden.txt`) is every frame of the trail drawn with the product's own folding
 * renderer at eighty columns and at sixty, in monochrome, over one folder that holds a little of everything. A
 * person who changes a word of a screen updates it (`pnpm vitest run -u <this file>`) and the reviewer reads the
 * delta in the diff; what the golden cannot say is held below as properties.
 *
 * WHAT IS HELD BESIDE THE GOLDEN:
 *   - NO ROW IS WIDER THAN THE WIDTH IT IS DRAWN AT, except a row whose one unbreakable word is wider than the
 *     room: the whole identity, a command to be typed back, a path. The width is learned from the renderer
 *     (`theWidthOf`), so a frame drawn for sixty is not drawn for eighty.
 *   - NO SENTENCE DEPENDS ON THE COLOUR: the styled rows, with the sequences taken out, are the plain rows; the
 *     plain ones hold no sequence; and no frame is red, because nothing in them is a refusal.
 *   - THE ANCHOR IS WHOLE, on a row of its own, at both widths.
 *   - THE BACKUP KEY IS SAID BEFORE THE OTHER NEXT STEPS, and only on the run that made it.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { detectAround } from '../src/init/detect.js';
import { defaultMarks } from '../src/init/flow.js';
import { ownFilesOf, yoursOf } from '../src/init/hosts.js';
import { noted, paragraph, theWidthOf, wrap } from '../src/init/layout.js';
import { instructionRows, planOf } from '../src/init/plan.js';
import {
  acceptsAnswered,
  acceptsPage,
  agreedLines,
  confirmPage,
  hostsAnswered,
  hostsPage,
  leftLine,
  planPage,
  stateOfAFile,
  theFirstScreen,
  trail,
} from '../src/init/screens.js';
import { foundingPage, summaryPage } from '../src/init/summary.js';
import { foldedAt } from '../src/presentation/folded.js';
import type { Line } from '../src/presentation/line.js';
import { renderPlain } from '../src/presentation/plain.js';
import { renderStyled } from '../src/presentation/styled.js';
import { widthOfText, withoutSequences } from '../src/presentation/width.js';

let sandbox: string;
let home: string;
let repo: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-init-frames-'));
  home = join(sandbox, 'home');
  repo = join(sandbox, 'shop');
  mkdirSync(home);
  mkdirSync(repo);
  mkdirSync(join(repo, '.git'));
  writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(repo, 'AGENTS.md'), '# Mine\n');
  writeFileSync(join(repo, 'CLAUDE.md'), '# Claude, mine\n');
  mkdirSync(join(repo, '.cursor'));
  mkdirSync(join(repo, 'docs', 'decisions'), { recursive: true });
  writeFileSync(
    join(repo, 'docs', 'decisions', '0001-a-choice.md'),
    '# 1. A choice\n\n## Status\nAccepted\n',
  );
  writeFileSync(join(repo, 'package.json'), '{"devDependencies":{"prettier":"^3"}}\n');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  facts = undefined;
});

const MACHINE = { newIdentity: true, where: '~/.mnema/identity/' };

/** What the frames are made from, read once for a case: the folder, and then the founding of it. */
interface Facts {
  readonly around: ReturnType<typeof detectAround>;
  readonly marks: ReturnType<typeof defaultMarks>;
  readonly plans: {
    readonly yes: ReturnType<typeof planOf>;
    readonly no: ReturnType<typeof planOf>;
    readonly known: ReturnType<typeof planOf>;
  };
  readonly done: Parameters<typeof foundingPage>[0];
}

let facts: Facts | undefined;

/** Reads the folder, plans, and founds it, in that order and once: a second reading would be of a founded folder. */
function factsOfTheFolder(): Facts {
  if (facts !== undefined) return facts;
  const around = detectAround(repo);
  const marks = defaultMarks(around);
  const plans = {
    yes: planOf(repo, around, { marks, accepts: 'yes' }, MACHINE),
    no: planOf(repo, around, { marks, accepts: 'no' }, MACHINE),
    known: planOf(repo, around, { marks }, { ...MACHINE, newIdentity: false }),
  };
  const founded = runInit({
    cwd: repo,
    env: { home },
    instructionFiles: ownFilesOf(marks),
    yoursFiles: yoursOf(marks),
  });
  if ('refused' in founded || !founded.created)
    throw new Error('the case could not found the folder');
  facts = {
    around,
    marks,
    plans,
    done: {
      cwd: repo,
      result: founded,
      answers: { marks, accepts: 'yes' as const },
      recorded: { ok: true as const, adr: 'ADR-1', as: 'accepted' as const, switchedOff: false },
      shown: (path: string) => (path.startsWith(home) ? `~${path.slice(home.length)}` : path),
    },
  };
  return facts;
}

/** Every frame of the trail for this folder, in the order a person meets them, as named lines. */
function frames(
  width: number,
): readonly { readonly name: string; readonly lines: readonly Line[] }[] {
  const { around, marks, plans, done } = factsOfTheFolder();
  const asked = { marks, picked: 'host:claude' };
  const onYours = { marks, picked: 'yours:CLAUDE.md' };
  return [
    { name: 'the first screen', lines: theFirstScreen(around, 'mnema init', '0.0.0', width) },
    { name: 'the hosts, the pick on the first row', lines: hostsPage(around, asked, width) },
    { name: 'the hosts, the pick on a file of yours', lines: hostsPage(around, onYours, width) },
    {
      name: 'the hosts, answered',
      lines: hostsAnswered(marks, instructionRows(around, marks), width),
    },
    { name: 'who may accept', lines: acceptsPage('yes', width) },
    { name: 'who may accept, the second answer picked', lines: acceptsPage('no', width) },
    { name: 'who may accept, answered yes', lines: acceptsAnswered('yes', width) },
    { name: 'who may accept, answered no', lines: acceptsAnswered('no', width) },
    { name: 'the plan', lines: planPage(plans.yes, width) },
    {
      name: 'the plan, with the second answer to who may accept',
      lines: planPage(plans.no, width),
    },
    { name: 'the plan, a machine that has an identity', lines: planPage(plans.known, width) },
    { name: 'the confirmation', lines: confirmPage('found', width) },
    { name: 'the confirmation, Leave picked', lines: confirmPage('leave', width) },
    { name: 'the plan, agreed', lines: agreedLines },
    { name: 'left', lines: [leftLine()] },
    { name: 'the founding', lines: foundingPage(done, width) },
    { name: 'the summary', lines: summaryPage(done, width) },
  ];
}

/** A line of the frames with what changes from one machine to the next made into what does not. */
function steady(text: string): string {
  return text
    .replaceAll(/mnid:[0-9a-f]{64}/g, `mnid:${'x'.repeat(64)}`)
    .replaceAll(/mnid:[0-9a-f]{8}/g, 'mnid:xxxxxxxx')
    .replaceAll(/\b[0-9a-f]{64}\.key/g, `${'f'.repeat(64)}.key`)
    .replaceAll(/(backup key {2})[0-9a-f]{8}/g, '$1xxxxxxxx');
}

/** A line with what changes from one machine to the next made into what does not, part by part: the same width. */
function steadied(line: Line): Line {
  return { ...line, parts: line.parts.map((part) => ({ ...part, text: steady(part.text) })) };
}

/** The frames as text, at one width, in monochrome: what a golden holds. */
function drawn(width: number): string {
  const render = foldedAt(width, renderPlain);
  return frames(width)
    .map(
      ({ name, lines }) =>
        `--- ${name} (${width} columns)\n${lines.map((line) => render(steadied(line))).join('\n')}`,
    )
    .join('\n\n');
}

describe('the frames', () => {
  it('are what the golden pins, at eighty columns and at sixty, in monochrome', async () => {
    await expect(`${drawn(80)}\n\n${drawn(60)}\n`).toMatchFileSnapshot(
      './the-init-draws-its-frames.golden.txt',
    );
  });

  for (const width of [80, 60]) {
    it(`have no row wider than ${width} columns but those with one word that cannot be broken`, () => {
      const render = foldedAt(width, renderPlain);
      for (const { name, lines } of frames(width)) {
        for (const line of lines) {
          for (const row of render(line).split('\n')) {
            if (widthOfText(row) <= width) continue;
            const widest = Math.max(...row.split(' ').map((word) => widthOfText(word)));
            expect(widest, `${name}: ${row}`).toBeGreaterThan(width - 8);
          }
        }
      }
    });

    it(`say no sentence by colour alone at ${width}: the styled rows are the plain rows, and none is red`, () => {
      const plain = foldedAt(width, renderPlain);
      const styled = foldedAt(width, renderStyled);
      let sequences = 0;
      for (const { name, lines } of frames(width)) {
        for (const line of lines) {
          const painted = styled(line);
          expect(withoutSequences(painted), name).toBe(plain(line));
          sequences += painted.length - withoutSequences(painted).length;
          expect(painted, name).not.toContain('\u001b[31m');
        }
      }
      expect(sequences, 'the frames paint nothing at all').toBeGreaterThan(0);
      expect(withoutSequences(plain(trail())), 'a plain row').toBe(plain(trail()));
    });

    it(`say the backup key before every other next step at ${width}`, () => {
      const summary = frames(width).find((frame) => frame.name === 'the summary')?.lines ?? [];
      const text = summary.map((line) => renderPlain(line)).join('\n');
      expect(text.indexOf('Move the backup key off this machine')).toBeGreaterThan(-1);
      expect(text.indexOf('Move the backup key off this machine')).toBeLessThan(
        text.indexOf('Then'),
      );
    });
  }

  it('keep the whole identity on a row of its own, where the width has room for its sixty-nine columns', () => {
    const summary = frames(80).find((frame) => frame.name === 'the summary')?.lines ?? [];
    const rows = summary.flatMap((line) => foldedAt(80, renderPlain)(line).split('\n'));
    expect(rows.filter((row) => /mnid:[0-9a-f]{64}/.test(row))).toHaveLength(1);
  });

  it('draw the confirmation along one row at eighty and one under another at sixty', () => {
    const at = (width: number) =>
      confirmPage('found', width).map((line) => foldedAt(width, renderPlain)(line));
    expect(at(80).filter((row) => row.includes('Change the answers'))).toHaveLength(1);
    expect(at(80).some((row) => row.includes('Found the project') && row.includes('Leave'))).toBe(
      true,
    );
    expect(at(60).some((row) => row.includes('Found the project') && row.includes('Leave'))).toBe(
      false,
    );
  });
});

describe('the founding list', () => {
  it('says each thing a write can have done to a file, in the words of the row', () => {
    const { done } = { done: factsOfTheFolder().done };
    const files = (['replaced', 'unchanged', 'refused', 'failed'] as const).map((did) => ({
      path: `${did}.md`,
      found: { state: 'missing' as const, exists: true },
      did,
      ...(did === 'failed' ? { error: 'permission denied' } : {}),
    }));
    const result = {
      ...done.result,
      around: {
        ...(done.result.around as object),
        instructions: files,
        foundedBelowTheRoot: true,
      },
    } as unknown as typeof done.result;
    const text = foundingPage({ ...done, result }, 80)
      .map((line) => renderPlain(line))
      .join('\n');
    expect(text).toContain('done   replaced.md');
    expect(text).toContain('block replaced');
    expect(text).toContain('kept   unchanged.md');
    expect(text).toContain('left   ');
    expect(text).toContain('permission denied');
    const steps = summaryPage({ ...done, result }, 80)
      .map((line) => renderPlain(line))
      .join('\n');
    expect(steps).toContain('This is not the root of the');
  });
});

describe('what a row says of a file', () => {
  it('has a few words for every state a file can be in', () => {
    const peek = (found: Parameters<typeof stateOfAFile>[0]['found'], exists = true) => ({
      path: 'x.md',
      exists,
      own: false,
      found,
    });
    expect(stateOfAFile(peek({ state: 'missing', exists: false }, false))).toBe('new');
    expect(stateOfAFile(peek({ state: 'missing', exists: true }))).toBe('yours: block added');
    expect(stateOfAFile(peek({ state: 'current' }))).toBe('already holds the block');
    expect(stateOfAFile(peek({ state: 'outdated' }))).toBe('earlier block replaced');
    expect(stateOfAFile(peek({ state: 'edited', why: 'w' }))).toContain('edited');
    expect(stateOfAFile(peek({ state: 'blocked', why: 'it is a link' }))).toContain('it is a link');
  });
});

describe('the next steps', () => {
  it('say for each host what docs/hosts.md says for it, and for Cursor the server and the plugin, not a bare "installed"', () => {
    const summary = frames(80).find((frame) => frame.name === 'the summary')?.lines ?? [];
    const text = summary
      .map((line) => renderPlain(line))
      .join('\n')
      .replace(/\n\u2502\s+/g, ' ');
    const hosts = readFileSync(new URL('../../../docs/hosts.md', import.meta.url), 'utf-8');
    expect(text).toContain(
      'Cursor: its command-line agent picks up the Claude Code plugin installed on this machine',
    );
    expect(text).toContain('`mnema mcp`');
    expect(text).not.toContain('installed on the same machine');
    expect(hosts).toContain('picks up a plugin installed in Claude Code on the same machine');
    expect(hosts).toContain('mnema mcp');
    expect(text).toContain('claude plugin marketplace add mnema-work/mnema');
    expect(text).toContain('codex plugin marketplace add mnema-work/mnema');
  });

  it('keep the trail continuous: no row of a frame is blank, every one starts with a mark or the guide', () => {
    for (const { name, lines } of frames(80)) {
      for (const line of lines) {
        const row = renderPlain(line);
        expect(row.trim(), name).not.toBe('');
      }
    }
  });
});

describe('the width', () => {
  it('is learned from the renderer: the width it folds to, and the page’s where it folds to none', () => {
    expect(theWidthOf(foldedAt(60, renderPlain))).toBe(60);
    expect(theWidthOf(foldedAt(120, renderPlain))).toBe(120);
    expect(theWidthOf(renderPlain)).toBe(80);
  });

  it('wraps a paragraph at the spaces, never cutting a word, and keeps a word wider than the room whole', () => {
    expect(wrap('one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrap('a verylongwordthatdoesnotfit b', 6)).toEqual([
      'a',
      'verylongwordthatdoesnotfit',
      'b',
    ]);
  });

  it('hangs the second row of a paragraph under the first word, and the note of a row under it where they do not fit', () => {
    const rows = paragraph(trail, 'alpha beta gamma delta', 20, '1  ').map((line) =>
      renderPlain(line),
    );
    expect(rows).toEqual(['│  1  alpha beta', '│     gamma delta']);
    const stacked = noted(
      trail,
      [{ role: 'field', text: 'first' }],
      { role: 'id', text: 'a note that is too long to sit beside it' },
      20,
      2,
    ).map((line) => renderPlain(line));
    expect(stacked[0]).toBe('│  first');
    expect(stacked.length).toBeGreaterThan(2);
    expect(existsSync(repo)).toBe(true);
  });
});
