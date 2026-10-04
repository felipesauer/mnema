/**
 * What a generated page runs: the chain's own verifier, over the record's files the page
 * carries, with no network and no key.
 *
 * `verifyRecord` is `verifyChain` — the function `mnema verify` calls — handed a chain root
 * whose files are the page's. Nothing in the verdict is worded here: the level, the summary,
 * the clauses and every issue are the chain's. The page prints them and adds nothing.
 *
 * It is built into ONE script (`dist/site-verifier.js`) that has no import and reaches for
 * nothing outside itself, and the same script is what the verdict test runs in a context
 * with no `Buffer`, no `require` and no filesystem.
 */

import { catalogUpcasters, verifyChain } from '@mnema/chain';
import { Buffer } from './buffer.js';
import { mount } from './fs.js';

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
 * Verifies the record the files make up. `files` maps a path under the chain root
 * (`tails/<tail>/000001.jsonl`, `keys/<fingerprint>.pub`, …) to its bytes in base64.
 */
export function verifyRecord(files: Readonly<Record<string, string>>): RecordVerdict {
  const mounted = new Map<string, Uint8Array>();
  for (const [path, base64] of Object.entries(files)) {
    mounted.set(`${ROOT}/${path}`, Buffer.from(base64, 'base64'));
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
      (issue) => `${issue.tail} #${issue.seq} [${issue.layer}] ${issue.detail}`,
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
  document?: Page;
  mnemaSite?: { verifyRecord: typeof verifyRecord };
};
here.mnemaSite = { verifyRecord };

if (here.document !== undefined) {
  const page = here.document;
  const carried = page.getElementById('record-files');
  if (carried?.textContent) {
    showVerdict(page, JSON.parse(carried.textContent) as Record<string, string>);
  }
}
