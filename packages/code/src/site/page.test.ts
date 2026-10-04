/**
 * The page as text: what is escaped, what the policy names, and what a filter hides.
 *
 * The page is built from a record's words, so the guards are about those words never being
 * markup. `commands/site.test.ts` pins the same through a real record; these pin the writer.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { escapeHtml, renderPage, type SiteDecision, type SiteModel } from './page.js';

const decision = (over: Partial<SiteDecision>): SiteDecision => ({
  id: 'd-1',
  adr: 'ADR-1',
  title: 'Keep money in cents',
  rationale: 'floats lose a cent',
  state: 'accepted',
  inForce: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  moves: [],
  ...over,
});

const model = (decisions: SiteDecision[], files: Record<string, string> = {}): SiteModel => ({
  decisions,
  tails: [{ id: 'abc-1', events: 2, text: '{"a":1}\n{"b":"</script>"}' }],
  files,
});

describe('the page', () => {
  it('escapes the five characters that can open markup or an attribute', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('writes every field of a decision as text, history included', () => {
    const page = renderPage(
      model([
        decision({
          title: '<b>t</b>',
          rationale: '<i>r</i>',
          alternatives: '<u>a</u>',
          adr: '<ADR>',
          id: '"><x>',
          state: '<s>',
          supersedes: '<pp>',
          supersededBy: '<q>',
          recordedBy: { who: '<who>', which: '<which>' },
          acceptedBy: { who: '<acc>' },
          moves: [
            { at: '<at>', action: '<act>', from: null, to: '<to>', who: '<mw>', said: '<said>' },
          ],
        }),
      ]),
      '/*v*/',
    );
    expect(page).not.toMatch(/<(b|i|u|x|pp|q|s|who|which|acc|at|mw)>/);
    for (const text of ['&lt;b&gt;t', '&lt;i&gt;r', '&lt;u&gt;a', '&lt;said&gt;', '&lt;acc&gt;']) {
      expect(page, text).toContain(text);
    }
  });

  it('writes the stored lines as text and the record files so that nothing in them can close the script', () => {
    const page = renderPage(model([], { 'tails/x/000001.jsonl': 'PHNjcmlwdD4=' }), '/*v*/');
    expect(page).toContain('{&quot;b&quot;:&quot;&lt;/script&gt;&quot;}');
    expect(page).toContain(
      '<script type="application/json" id="record-files">{"tails/x/000001.jsonl":"PHNjcmlwdD4="}</script>',
    );
    const hostile = renderPage(model([], { 'tails/</script><script>x()/a': 'QQ==' }), '/*v*/');
    expect(hostile.match(/<script/g)).toHaveLength(2);
    expect(hostile).toContain('\\u003c/script>');
  });

  it('names its one script and its one style by hash, and allows nothing else', () => {
    const verifier = 'globalThis.x = 1;';
    const page = renderPage(model([decision({})]), verifier);
    const policy = /Content-Security-Policy" content="([^"]*)"/
      .exec(page)?.[1]
      ?.replaceAll('&#39;', "'");
    const hashOf = (text: string): string =>
      `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
    const style = /<style>(.*?)<\/style>/s.exec(page)?.[1] as string;
    expect(policy).toBe(
      `default-src 'none'; script-src ${hashOf(verifier)}; style-src ${hashOf(style)}`,
    );
    expect(page).toContain(`<script>${verifier}</script>`);
  });

  it('counts the decisions in force and leaves the rest to the control', () => {
    const page = renderPage(
      model([
        decision({}),
        decision({ id: 'd-2', adr: 'ADR-2', state: 'rejected', inForce: false }),
        decision({ id: 'd-3', adr: 'ADR-3', state: 'proposed', inForce: false }),
      ]),
      '/*v*/',
    );
    expect(page).toContain('<p>1 in force, 2 not in force.</p>');
    expect(page.match(/class="decision not-in-force"/g)).toHaveLength(2);
    expect(page).toContain('#all:not(:checked) ~ #decisions .not-in-force { display: none; }');
  });

  it('tells a reader without JavaScript that nothing was verified', () => {
    expect(renderPage(model([]), '/*v*/')).toContain(
      '<noscript><p>This page verifies the record with JavaScript. Without it, nothing here has been verified.</p></noscript>',
    );
  });
});
