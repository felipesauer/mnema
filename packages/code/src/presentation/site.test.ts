/**
 * The lines `mnema site` prints, as the person who ran it reads them.
 */

import { describe, expect, it } from 'vitest';
import type { SiteDone } from '../commands/site.js';
import { siteNotice, siteReport } from './site.js';

const render = (line: { parts: readonly { text: string }[] }): string =>
  line.parts.map((part) => part.text).join(' ');

const done = (over: Partial<SiteDone> = {}): SiteDone => ({
  ok: true,
  path: 'dist/record/index.html',
  decisions: 3,
  inForce: 2,
  events: 14,
  files: 5,
  verdict: { ok: true, summary: 'local integrity verified' },
  ...over,
});

describe('what mnema site says', () => {
  it('says what was written, what is in it, and that it is the public tree only', () => {
    expect(siteReport(render, done())).toEqual([
      'Wrote dist/record/index.html',
      '3 decision(s), 2 in force; 14 event(s); 5 file(s) carried for the verification in the page',
      'only the committed public tree is in the page',
    ]);
  });

  it('keeps a path with a line break on one line', () => {
    const [wrote] = siteReport(render, done({ path: 'out\nWrote /etc/passwd' }));
    expect(wrote).not.toContain('\n');
    expect(wrote).toContain('out');
  });

  it('is silent about a record that verifies, and says so for one that does not', () => {
    expect(siteNotice(render, done())).toEqual([]);
    const [notice] = siteNotice(
      render,
      done({ verdict: { ok: false, summary: 'local integrity FAILED\nsee issues' } }),
    );
    expect(notice).toBe(
      'this record does not verify: local integrity FAILED see issues — the page says so to its readers, and `mnema verify` says more',
    );
  });
});
