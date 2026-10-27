/**
 * THE RAW LINES ARE DRAWN FROM THE FILES THE PAGE CARRIES, AND ARE WHAT THE FILES SAY.
 *
 * The page used to write each tail's stored lines a second time, as escaped text (435 KB of 1.3 MB
 * for this repository's record). It now writes an empty `<pre>` and the script fills it, when a
 * reader opens the tail, from the base64 files the verifier already reads. What it draws is held
 * here against the other reading of the same bytes, the one a disk gives (`readFileSync` as UTF-8,
 * the segments joined, the line breaks at the end taken off): the same text, value for value, over a
 * real record, over a file with a byte that is not UTF-8, over segments the object lists out of
 * order, and over a byte order mark.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type PageRun, runInAVm } from '../../tests/support/a-page-in-a-vm.js';
import { runDecision } from '../commands/decision.js';
import { runDecisionTransition } from '../commands/decision-transition.js';
import { runInit } from '../commands/init.js';
import { runSite } from '../commands/site.js';
import { rawLinesOf } from './browser/tails.js';
import { renderPage } from './page.js';
import { theSiteVerifier } from './verifier-bundle.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-raw-lines-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  env = { home: join(sandbox, 'home') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const b64 = (bytes: Uint8Array | string): string => Buffer.from(bytes).toString('base64');

/** What a disk gives for a tail: the segments read as UTF-8, joined, the line breaks at the end off. */
function theDiskSays(dir: string): string {
  const names = readdirSync(dir)
    .filter((name) => /^\d+\.jsonl$/.test(name))
    .sort();
  return names
    .map((name) => readFileSync(join(dir, name), 'utf-8'))
    .join('')
    .replace(/\n+$/, '');
}

/** The page for `files`, its script run, and the first paint over. */
function aPage(files: Record<string, string>, tails: { id: string; events: number }[]): PageRun {
  const html = renderPage(
    {
      decisions: [],
      otherNotes: [],
      timeline: [],
      counts: { decisions: 0, inForce: 0, notes: 0, timeline: 0 },
      tails,
      files,
    },
    theSiteVerifier(),
  );
  const run = runInAVm(html, theSiteVerifier());
  run.timers.drain();
  return run;
}

function open(run: PageRun, tail: string): string {
  const details = run.page
    .querySelectorAll('.tail')
    .find((d) => d.getAttribute('data-tail') === tail);
  if (details === undefined) throw new Error(`no tail ${tail} on the page`);
  details.open = true;
  details.dispatch('toggle');
  const [pre] = details.querySelectorAll('pre');
  return pre?.textContent ?? '';
}

describe('the raw lines of a tail', () => {
  it('are what a disk says of a real record, tail by tail, once the tail is opened and not before', () => {
    runInit({ cwd: repo, env });
    const here = { cwd: repo, env };
    for (const title of ['Keep money in integer cents', 'Store dates in UTC']) {
      const recorded = runDecision(here, { title, rationale: `why: ${title}` });
      if (!recorded.ok) throw new Error('setup: decision refused');
      runDecisionTransition(here, { id: recorded.id, action: 'accept', proof: { note: 'ok' } });
    }
    const out = join(sandbox, 'out');
    expect(runSite(here, { out }).ok).toBe(true);
    const page = readFileSync(join(out, 'index.html'), 'utf-8');
    const script = /<script>(.*)<\/script>/s.exec(page)?.[1] as string;
    const run = runInAVm(page, script);
    run.timers.drain();
    const tails = readdirSync(join(repo, '.mnema', 'tails'));
    expect(tails.length).toBeGreaterThan(0);
    for (const tail of tails) {
      const details = run.page
        .querySelectorAll('.tail')
        .find((d) => d.getAttribute('data-tail') === tail);
      expect(
        details?.querySelectorAll('pre')[0]?.textContent,
        'nothing is drawn before it is opened',
      ).toBe('');
      const drawn = open(run, tail);
      const says = theDiskSays(join(repo, '.mnema', 'tails', tail));
      expect(says.split('\n').length).toBeGreaterThan(3);
      expect(drawn).toBe(says);
    }
  });

  it('are the segments joined in the order of their names, whatever order the page lists the files in', () => {
    const files = {
      'tails/t-1/000002.jsonl': b64('three\nfour\n'),
      'tails/t-1/000001.jsonl': b64('one\ntwo\n'),
      'tails/t-2/000001.jsonl': b64('other\n'),
      'keys/aa.pub': b64('not a segment'),
    };
    expect(rawLinesOf(files, 't-1')).toBe('one\ntwo\nthree\nfour');
    expect(rawLinesOf(files, 't-2')).toBe('other');
    expect(rawLinesOf(files, 't-3')).toBe('');
    const run = aPage(files, [
      { id: 't-1', events: 4 },
      { id: 't-2', events: 1 },
    ]);
    expect(open(run, 't-1')).toBe('one\ntwo\nthree\nfour');
  });

  it('turn a byte that is not UTF-8 into U+FFFD, as a disk reading does, and never throw', () => {
    const bytes = Uint8Array.from([0x61, 0xff, 0x62, 0xc3, 0x28, 0x0a]);
    const dir = join(sandbox, 'bad');
    mkdirSync(dir);
    writeFileSync(join(dir, '000001.jsonl'), bytes);
    const says = theDiskSays(dir);
    expect(says).toContain('�');
    const run = aPage({ 'tails/t-1/000001.jsonl': b64(bytes) }, [{ id: 't-1', events: 1 }]);
    expect(open(run, 't-1')).toBe(says);
  });

  it('keep a byte order mark where a disk reading keeps it', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x61, 0x0a]);
    const dir = join(sandbox, 'bom');
    mkdirSync(dir);
    writeFileSync(join(dir, '000001.jsonl'), bytes);
    expect(theDiskSays(dir)).toBe('﻿a');
    expect(rawLinesOf({ 'tails/t-1/000001.jsonl': b64(bytes) }, 't-1')).toBe('﻿a');
  });

  it('are put in the page as text: a line that is markup is not markup there', () => {
    const run = aPage({ 'tails/t-1/000001.jsonl': b64('<img src=x onerror=alert(1)>\n') }, [
      { id: 't-1', events: 1 },
    ]);
    expect(open(run, 't-1')).toBe('<img src=x onerror=alert(1)>');
    expect(run.page.querySelectorAll('img')).toHaveLength(0);
  });
});
