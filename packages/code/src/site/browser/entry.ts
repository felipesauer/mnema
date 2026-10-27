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
 *
 * AFTER A VERDICT THAT IS `verified`, in a turn of its own, the script derives the page's lists again
 * from the files it verified and names each difference from what the page shows (`check.ts`). Over a
 * record that did not verify it derives nothing and says the lists were not checked.
 */

import { catalogUpcasters, verifyChain } from '@mnema/chain';
import { deriveLists, showListsCheck } from './check.js';
import { type Doc, wireFilters } from './filters.js';
import { mountRecord, RECORD_ROOT } from './fs.js';
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
  mountRecord(files);
  const result = verifyChain({ root: RECORD_ROOT }, catalogUpcasters());
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

/**
 * Runs the verification a page asks for and writes the verdict where the page keeps it. It hands the
 * verdict back, or nothing when there was none to hand (no files, or the verification threw): what
 * the check of the lists asks first is whether this record verified.
 */
export function showVerdict(
  page: Page,
  files: Readonly<Record<string, string>>,
): RecordVerdict | undefined {
  const status = page.getElementById('verdict-status');
  const summary = page.getElementById('verdict-summary');
  const issues = page.getElementById('verdict-issues');
  if (status === null || summary === null || issues === null) return;
  if (Object.keys(files).length === 0) {
    status.setAttribute('data-state', 'unverified');
    status.textContent = 'not verified';
    summary.textContent = 'This page carries no record files, so nothing was verified.';
    return undefined;
  }
  let verdict: RecordVerdict;
  try {
    verdict = verifyRecord(files);
  } catch (error) {
    status.setAttribute('data-state', 'unverified');
    status.textContent = 'not verified';
    summary.textContent = `The page could not run the verification: ${error instanceof Error ? error.message : String(error)}`;
    return undefined;
  }
  status.setAttribute('data-state', verdict.ok ? 'verified' : 'broken');
  status.textContent = verdict.ok ? `verified (${verdict.level})` : `broken (${verdict.level})`;
  summary.textContent = verdict.summary;
  for (const line of [...verdict.issues, ...verdict.census.map((note) => `note: ${note}`)]) {
    const item = page.createElement('li');
    item.textContent = line;
    issues.appendChild(item);
  }
  return verdict;
}

/** What the script reads off the place it runs in: a page, and the two ways to wait. */
export interface Host {
  document?: Page | undefined;
  requestAnimationFrame?: ((callback: () => void) => unknown) | undefined;
  setTimeout?: ((callback: () => void, ms: number) => unknown) | undefined;
  location?: { hash: string } | undefined;
  addEventListener?: ((type: string, listener: () => void) => void) | undefined;
}

/** Whether the page can select elements too, which the filters and the tails need and the verdict does not. */
function canBeWired(page: Page): page is Page & Doc {
  return typeof (page as Partial<Doc>).querySelectorAll === 'function';
}

/**
 * Runs `work` once the browser has drawn the page: a timer set from inside a frame callback fires
 * after that frame is painted. Where there is no frame callback, the timer alone.
 */
function afterTheFirstPaint(host: Host, work: () => void): void {
  const later = (): unknown => host.setTimeout?.(work, 0);
  if (host.requestAnimationFrame !== undefined) host.requestAnimationFrame(later);
  else later();
}

/**
 * What the script does in a page: wires the filters and the tails, then verifies after the first
 * paint and checks the lists after the verdict. A place with no document (Node, where this module is imported by a test) gets nothing.
 */
export function start(host: Host): void {
  const page = host.document;
  if (page === undefined) return;
  const carried = page.getElementById('record-files');
  if (carried?.textContent) {
    const files = JSON.parse(carried.textContent) as Record<string, string>;
    if (canBeWired(page)) {
      wireFilters(page, host);
      wireTails(page, files);
    }
    afterTheFirstPaint(host, () => {
      const verdict = showVerdict(page, files);
      // The lists are derived after the verdict is on the page, in a turn of their own, so a reader sees
      // the verdict while the derivation runs. Only a page the script can select in is checked.
      if (canBeWired(page)) {
        const check = (): void => showListsCheck(page, files, verdict?.ok === true);
        if (host.setTimeout === undefined) check();
        else host.setTimeout(check, 0);
      }
    });
  }
}

const here = globalThis as Host & {
  mnemaSite?: { verifyRecord: typeof verifyRecord; deriveLists: typeof deriveLists };
};
here.mnemaSite = { verifyRecord, deriveLists };
start(here);
