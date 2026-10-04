/**
 * The lines `mnema site` prints: what it wrote, and — when the record it wrote from does not
 * verify — the one sentence that tells the person who ran it.
 *
 * The path is the caller's own `--out` and the summary is the chain's sentence over names a disk
 * chose, so both go through `oneLine`: a value holding a line break must not become two lines of
 * a report a person reads as one.
 */

import type { SiteDone } from '../commands/site.js';
import { oneLine } from '../one-line.js';
import { fact } from './detail.js';
import type { Line } from './line.js';
import type { Render } from './render.js';

/** The lines on standard output after a page was written. */
export function siteReport(render: Render, done: SiteDone): string[] {
  return [
    `Wrote ${oneLine(done.path)}`,
    render(
      fact(
        `${done.decisions} decision(s), ${done.inForce} in force; ${done.events} event(s); ` +
          `${done.files} file(s) carried for the verification in the page`,
      ),
    ),
    render(fact('only the committed public tree is in the page')),
  ];
}

/** The line on standard error for a record that does not verify; none for one that does. */
export function siteNotice(done: SiteDone): Line[] {
  if (done.verdict.ok) return [];
  return [
    fact(
      `this record does not verify: ${oneLine(done.verdict.summary)} — the page says so to ` +
        'its readers, and `mnema verify` says more',
      0,
    ),
  ];
}
