// @reads-the-tree
/**
 * THE SCRIPT OF THE PAGE WRITES NO MARKUP.
 *
 * A record is text strangers wrote, and the page's script puts parts of it back into the page (an
 * identity in an option, a tail's lines in a `<pre>`). The only ways it may put anything there are
 * the ones that cannot make an element out of a string: `textContent`, `setAttribute` for an
 * attribute that is not `style` and not an event handler, `value`, `hidden`, `createElement`
 * and `appendChild`. Two things hold that:
 *
 *   - A STATIC GUARD over every file of `site/browser/` (the script is bundled from all of them, so
 *     the verifier and the shims are in it): no `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
 *     `document.write`, `.style`, `setAttribute('style'` or `setAttribute('on...'`, `eval(` or
 *     `new Function`. It reads the code with the comments and strings blanked, and the attributes by
 *     their literals, so a sentence that names one of these is not an accusation.
 *   - A RUN of the real script in a context whose DOM REFUSES those ways (`tests/support/a-page-in-a-vm.ts`
 *     throws at the line that used one) over a page whose every text is `<img src=x onerror=alert(1)>`:
 *     no element of that name exists afterwards, and the hostile text reached the DOM through
 *     `textContent` and nothing else.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runInAVm } from '../../tests/support/a-page-in-a-vm.js';
import { codeOnly, sourceFiles } from '../../tests/support/reading-source.js';
import { renderPage } from './page.js';
import { theSiteVerifier } from './verifier-bundle.js';

const BROWSER = join(dirname(fileURLToPath(import.meta.url)), 'browser');

/** What no file of the script may say, in code, with the reason it is here. */
const SINKS: readonly { readonly name: string; readonly found: RegExp }[] = [
  { name: 'innerHTML', found: /\binnerHTML\b/ },
  { name: 'outerHTML', found: /\bouterHTML\b/ },
  { name: 'insertAdjacentHTML', found: /\binsertAdjacentHTML\b/ },
  { name: 'document.write', found: /\bdocument\s*\.\s*write(?:ln)?\b/ },
  { name: '.style', found: /\.\s*style\b/ },
  { name: 'eval(', found: /\beval\s*\(/ },
  { name: 'new Function', found: /\bnew\s+Function\b/ },
];

/** `setAttribute` named `style` or an event handler, by its literal. */
const FORBIDDEN_ATTRIBUTE = /setAttribute\(\s*['"`](?:style|on[a-z]*)['"`]/i;

describe('the script of the page', () => {
  const files = sourceFiles(BROWSER);

  it('is read whole: every file of the browser directory, the verifier and its shims among them', () => {
    const names = files.map((file) => relative(BROWSER, file)).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        'buffer.ts',
        'crypto.ts',
        'entry.ts',
        'filters.ts',
        'fs.ts',
        'tails.ts',
      ]),
    );
  });

  it('puts nothing in the page by a way that takes markup', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      const code = codeOnly(source);
      for (const sink of SINKS) {
        expect(code, `${relative(BROWSER, file)} says ${sink.name}`).not.toMatch(sink.found);
      }
      expect(
        source,
        `${relative(BROWSER, file)} sets an attribute that runs or styles`,
      ).not.toMatch(FORBIDDEN_ATTRIBUTE);
    }
  });

  it('is a scan that sees what it is looking for: each sink is found in a file that has it', () => {
    const bad = [
      'el.innerHTML = x;',
      'el.outerHTML = x;',
      'el.insertAdjacentHTML("beforeend", x);',
      'document.write(x);',
      'el.style.color = "red";',
      'eval(x);',
      'new Function("return 1");',
    ];
    for (const [i, line] of bad.entries()) {
      expect(
        SINKS.some((sink) => sink.found.test(codeOnly(line))),
        `the scan misses ${line}`,
      ).toBe(true);
      expect(SINKS[i]?.found.test(codeOnly(line)), `sink ${i} misses ${line}`).toBe(true);
    }
    expect(FORBIDDEN_ATTRIBUTE.test(`el.setAttribute('style', x)`)).toBe(true);
    expect(FORBIDDEN_ATTRIBUTE.test(`el.setAttribute("onclick", x)`)).toBe(true);
    expect(FORBIDDEN_ATTRIBUTE.test(`el.setAttribute('value', x)`)).toBe(false);
    // A sentence that names one is not an accusation: the comment is blanked.
    expect(codeOnly('// never innerHTML\nconst a = 1;')).not.toMatch(SINKS[0]?.found as RegExp);
  });

  it('puts a hostile identity, agent, title, note and line in the DOM as text, and makes no element out of them', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const html = renderPage(
      {
        decisions: [
          {
            id: 'd-1',
            adr: 'ADR-1',
            adrIsUnique: true,
            title: hostile,
            rationale: hostile,
            state: hostile,
            inForce: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            recordedBy: { who: hostile, which: hostile },
            moves: [],
            notes: [
              {
                id: 'n-1',
                kind: 'memory',
                text: hostile,
                at: '2026-01-02T00:00:00.000Z',
                who: hostile,
                which: hostile,
              },
            ],
            addresses: [{ rel: hostile, target: hostile }],
            linkedTo: [],
          },
        ],
        otherNotes: [],
        timeline: [],
        counts: { decisions: 1, inForce: 1, notes: 1, timeline: 0 },
        tails: [{ id: 't-1', events: 1 }],
        files: { 'tails/t-1/000001.jsonl': Buffer.from(`${hostile}\n`).toString('base64') },
      },
      theSiteVerifier(),
    );
    const { page, timers } = runInAVm(html, theSiteVerifier());
    timers.drain();
    const tail = page.querySelectorAll('.tail')[0];
    if (tail === undefined) throw new Error('the page has no tail');
    tail.open = true;
    tail.dispatch('toggle');
    // The text is there, as text, in the options the script made and in the tail it drew.
    const labels = page
      .querySelectorAll('option')
      .map((option) => option.textContent)
      .filter((label) => label.includes(hostile));
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(tail.querySelectorAll('pre')[0]?.textContent).toBe(hostile);
    // No element was made out of it, anywhere on the page.
    expect(page.querySelectorAll('img')).toHaveLength(0);
    // And every write the script did went through an API that takes text or a value.
    const via = new Set(page.writes.map((write) => write.via));
    expect([...via].sort()).toEqual(['createElement', 'hidden', 'setAttribute', 'textContent']);
    expect(
      page.writes
        .filter((write) => write.via === 'createElement')
        .every((w) => ['option', 'li'].includes(w.value)),
    ).toBe(true);
  });
});
