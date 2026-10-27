/**
 * What a generated page runs: the chain's own verifier, over the record's files the page
 * carries, with no network and no key.
 *
 * `verifyRecord` is `verifyChain`, the function `mnema verify` calls, handed a chain root
 * whose files are the page's. Nothing in the verdict is worded here: the level, the summary,
 * the clauses and every issue are the chain's. The page prints them and adds nothing.
 *
 * It is built into ONE script (`dist/site-verifier.js`) that has no import and reaches for
 * nothing outside itself, and the same script is what the verdict test runs in a context
 * with no `Buffer`, no `require` and no filesystem.
 *
 * The same script wires what the page lets a reader do: the filters of the decision list
 * (`filters.ts`) and the drawing of a tail's raw lines when it is opened (`tails.ts`). It does
 * both BEFORE it verifies, and it verifies after the first paint: the verification takes a
 * while (780 ms over this repository's own record, 5 s at two thousand events), and a page that
 * answered a keypress only once it was done would feel broken. Until the verdict is there the
 * page says it is verifying, and says so as a status a reader's software announces.
 */

import { catalogUpcasters, verifyChain } from '@mnema/chain';
import { fromBase64 } from './buffer.js';
import type { Doc } from './dom.js';
import { wireFilters } from './filters.js';
import { mount } from './fs.js';
import { wireTails } from './tails.js';

/** The verdict as the page shows it: the chain's words, unchanged. */
export interface RecordVerdict {
  readonly ok: boolean;
  readonly fullySigned: boolean;
  readonly level: string;
  readonly summary: string;
  readonly clauses: readonly string[];
  readonly issues: readonly string[];
  readonly census: readonly string[];
}

/** Where the files are mounted: the chain root `verifyChain` is pointed at. */
const ROOT = '/record';

/**
 * Where an issue is: a tail and its event, a tail alone when the line has no seq (it could not be
 * read), or `the record` when it is about no tail (a record in which no tail holds anything).
 */
function placeOf(tail: string | undefined, seq: number | undefined): string {
  if (tail === undefined) return 'the record';
  return seq === undefined ? tail : `${tail} #${seq}`;
}

/**
 * Verifies the record the files make up. `files` maps a path under the chain root
 * (`tails/<tail>/000001.jsonl`, `keys/<fingerprint>.pub`, …) to its bytes in base64.
 */
export function verifyRecord(files: Readonly<Record<string, string>>): RecordVerdict {
  const mounted = new Map<string, Uint8Array>();
  for (const [path, base64] of Object.entries(files)) {
    mounted.set(`${ROOT}/${path}`, fromBase64(base64));
  }
  mount(mounted);
  const result = verifyChain({ root: ROOT }, catalogUpcasters());
  return {
    ok: result.ok,
    fullySigned: result.fullySigned,
    level: result.level,
    summary: result.summary,
    clauses: result.clauses.map((clause) => clause.text),
    issues: result.issues.map(
      (issue) => `${placeOf(issue.tail, issue.seq)} [${issue.layer}] ${issue.detail}`,
    ),
    census: result.census.map((note) => note.detail),
  };
}

interface Element {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: Element): void;
}

interface Page {
  getElementById(id: string): Element | null;
  createElement(tag: string): Element;
}

/** Runs the verification a page asks for and writes the verdict where the page keeps it. */
export function showVerdict(page: Page, files: Readonly<Record<string, string>>): void {
  const status = page.getElementById('verdict-status');
  const summary = page.getElementById('verdict-summary');
  const issues = page.getElementById('verdict-issues');
  if (status === null || summary === null || issues === null) return;
  if (Object.keys(files).length === 0) {
    status.setAttribute('data-state', 'unverified');
    status.textContent = 'not verified';
    summary.textContent = 'This page carries no record files, so nothing was verified.';
    return;
  }
  let verdict: RecordVerdict;
  try {
    verdict = verifyRecord(files);
  } catch (error) {
    status.setAttribute('data-state', 'unverified');
    status.textContent = 'not verified';
    summary.textContent = `The page could not run the verification: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  status.setAttribute('data-state', verdict.ok ? 'verified' : 'broken');
  status.textContent = verdict.ok ? `verified (${verdict.level})` : `broken (${verdict.level})`;
  summary.textContent = verdict.summary;
  for (const line of [...verdict.issues, ...verdict.census.map((note) => `note: ${note}`)]) {
    const item = page.createElement('li');
    item.textContent = line;
    issues.appendChild(item);
  }
}

const here = globalThis as {
  document?: Page & Partial<Doc>;
  requestAnimationFrame?: (callback: () => void) => unknown;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  mnemaSite?: { verifyRecord: typeof verifyRecord };
};
here.mnemaSite = { verifyRecord };

/**
 * Runs `work` once the browser has drawn the page: a timer set from inside a frame callback fires
 * after that frame is painted. Where there is no frame callback, the timer alone.
 */
function afterTheFirstPaint(work: () => void): void {
  const later = (): unknown => here.setTimeout?.(work, 0);
  if (here.requestAnimationFrame !== undefined) here.requestAnimationFrame(later);
  else later();
}

if (here.document !== undefined) {
  const page = here.document;
  const carried = page.getElementById('record-files');
  if (carried?.textContent) {
    const files = JSON.parse(carried.textContent) as Record<string, string>;
    if (typeof page.querySelectorAll === 'function') {
      wireFilters(page as Doc);
      wireTails(page as Doc, files);
    }
    afterTheFirstPaint(() => showVerdict(page, files));
  }
}
