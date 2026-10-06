/**
 * `mnema site` as the adapter sees it: what reaches the page, and what never can.
 *
 * The page is published, so the guards here are about leaving things OUT — a note kept
 * private, a title that is markup — and about what the page carries for its own verification.
 * That the verdict a browser computes is the one `mnema verify` gives is pinned in
 * `site/the-verdict-in-the-browser.test.ts`.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { theSiteVerifier } from '../site/verifier-bundle.js';
import { runDecision } from './decision.js';
import { runDecisionTransition } from './decision-transition.js';
import { runInit } from './init.js';
import { runMemory } from './memory.js';
import { runSite } from './site.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-site-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  env = { home: join(sandbox, 'home') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function decide(
  title: string,
  scope: 'public' | 'private',
  action?: 'accept' | 'reject',
): { readonly id: string } {
  const here = { cwd: repo, env };
  const recorded = runDecision(here, { title, rationale: `why: ${title}`, scope });
  if (!recorded.ok) throw new Error(`setup: decision refused (${recorded.reason})`);
  if (action !== undefined) {
    const moved = runDecisionTransition(here, {
      id: recorded.id,
      action,
      proof: { note: 'agreed in review' },
    });
    if (!moved.ok) throw new Error(`setup: ${action} refused (${moved.reason})`);
  }
  return recorded;
}

function pageOf(out: string): string {
  return readFileSync(join(out, 'index.html'), 'utf-8');
}

describe('mnema site', () => {
  it('refuses outside a project, and over a public tree with no record', () => {
    const outside = runSite({ cwd: sandbox, env }, { out: join(sandbox, 'out') });
    expect(outside).toEqual({ ok: false, reason: 'NO_PROJECT' });

    mkdirSync(join(repo, '.mnema'));
    const empty = runSite({ cwd: repo, env }, { out: join(sandbox, 'out') });
    expect(empty.ok ? '' : empty.reason).toBe('NO_RECORD');
    expect(readdirSync(sandbox)).not.toContain('out');
  });

  it('writes a page for a record with no decision, and says so', () => {
    runInit({ cwd: repo, env });
    const out = join(sandbox, 'out');
    const done = runSite({ cwd: repo, env }, { out });
    expect(done.ok && done.decisions).toBe(0);
    expect(pageOf(out)).toContain('No decision is recorded in the public tree.');
  });

  it('refuses an --out that is a file, and writes nothing there', () => {
    runInit({ cwd: repo, env });
    decide('Keep money in integer cents', 'public', 'accept');
    const file = join(sandbox, 'taken');
    writeFileSync(file, 'not a directory');
    const refused = runSite({ cwd: repo, env }, { out: file });
    expect(refused.ok ? '' : refused.reason).toBe('OUT_IS_A_FILE');
    expect(readFileSync(file, 'utf-8')).toBe('not a directory');
  });

  it('writes one index.html with the decisions in force first and the rest behind a control', () => {
    runInit({ cwd: repo, env });
    decide('Keep money in integer cents', 'public', 'accept');
    decide('Store dates as local time', 'public', 'reject');
    const out = join(sandbox, 'out');
    const done = runSite({ cwd: repo, env }, { out });
    expect(done.ok && { decisions: done.decisions, inForce: done.inForce }).toEqual({
      decisions: 2,
      inForce: 1,
    });
    expect(readdirSync(out)).toEqual(['index.html']);
    const page = pageOf(out);
    expect(page).toContain('Keep money in integer cents');
    expect(page).toMatch(/class="decision in-force"[^>]*><h3>ADR-1 · Keep money in integer cents/);
    expect(page).toMatch(
      /class="decision not-in-force"[^>]*><h3>ADR-2 · Store dates as local time/,
    );
    expect(page).toContain('<input type="checkbox" id="all">');
    expect(page).toContain('agreed in review');
  });

  it('never reads the private tree: a private note and a private rule are in no byte of the page', () => {
    runInit({ cwd: repo, env });
    decide('A call the team made', 'public', 'accept');
    decide('PRIVATE-RULE-7f3a settled on this machine', 'private', 'accept');
    const note = runMemory(
      { cwd: repo, env },
      { content: 'PRIVATE-NOTE-91bc kept to myself', scope: 'private' },
    );
    expect(note.ok).toBe(true);
    const out = join(sandbox, 'out');
    const done = runSite({ cwd: repo, env }, { out });
    expect(done.ok).toBe(true);
    const bytes = readFileSync(join(out, 'index.html'));
    for (const secret of ['PRIVATE-RULE-7f3a', 'PRIVATE-NOTE-91bc']) {
      expect(bytes.includes(secret), `the page holds ${secret}`).toBe(false);
      // The record's files travel base64-encoded, so the plain search above cannot see inside
      // them: look through the encoding, which is the way a stranger would.
      expect(
        bytes.includes(Buffer.from(secret).toString('base64').slice(0, 12)),
        `an encoded ${secret} is in the page`,
      ).toBe(false);
    }
    const files = JSON.parse(
      /id="record-files">(.*?)<\/script>/s.exec(bytes.toString('utf-8'))?.[1] as string,
    ) as Record<string, string>;
    for (const path of Object.keys(files)) {
      expect(path, 'a file from outside tails/ and keys/*.pub').toMatch(
        /^(tails\/.+|keys\/[0-9a-f]+\.pub)$/,
      );
      expect(Buffer.from(files[path] as string, 'base64').toString('utf-8')).not.toContain(
        'PRIVATE-',
      );
    }
  });

  it('writes a title that is markup as text, and the one script the page runs is the verifier', () => {
    runInit({ cwd: repo, env });
    decide('<script>alert(1)</script><img src=x onerror=alert(2)>', 'public', 'accept');
    const out = join(sandbox, 'out');
    expect(runSite({ cwd: repo, env }, { out }).ok).toBe(true);
    const page = pageOf(out);
    expect(page).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(2)&gt;',
    );
    expect(page).not.toContain('<script>alert(1)');
    expect(page).not.toContain('<img');
    // Two script elements, and only these: the record's data, which a browser never runs, and
    // the verifier. A third would be markup the record got into the page.
    expect(page.match(/<script/g)).toHaveLength(2);
  });

  it('tells the person who ran it when the record does not verify, and still writes the page', () => {
    runInit({ cwd: repo, env });
    decide('Keep money in integer cents', 'public', 'accept');
    const honest = runSite({ cwd: repo, env }, { out: join(sandbox, 'honest') });
    expect(honest.ok && honest.verdict.ok).toBe(true);

    const tails = join(repo, '.mnema', 'tails');
    const segment = join(tails, readdirSync(tails)[0] as string, '000001.jsonl');
    writeFileSync(
      segment,
      readFileSync(segment, 'utf-8').replace('Keep money in integer cents', 'Keep money in floats'),
    );
    const broken = runSite({ cwd: repo, env }, { out: join(sandbox, 'broken') });
    expect(broken.ok && broken.verdict.ok).toBe(false);
    expect(broken.ok && broken.verdict.summary).toContain('local integrity FAILED');
    expect(pageOf(join(sandbox, 'broken'))).toContain('Keep money in floats');
  });

  it('is the same bytes when asked twice of the same record', () => {
    runInit({ cwd: repo, env });
    decide('Keep money in integer cents', 'public', 'accept');
    runSite({ cwd: repo, env }, { out: join(sandbox, 'one') });
    runSite({ cwd: repo, env }, { out: join(sandbox, 'two') });
    expect(pageOf(join(sandbox, 'one'))).toBe(pageOf(join(sandbox, 'two')));
  });

  it('says the page needs no network: one policy, no external reference', () => {
    runInit({ cwd: repo, env });
    decide('Keep money in integer cents', 'public', 'accept');
    const out = join(sandbox, 'out');
    runSite({ cwd: repo, env }, { out });
    const page = pageOf(out);
    expect(page).toMatch(
      /Content-Security-Policy" content="default-src &#39;none&#39;; script-src/,
    );
    expect(page).not.toMatch(/(?:src|href)=["']?(?:https?:)?\/\//);
    expect(page).toContain(theSiteVerifier());
  });

  it('carries no absolute path of the machine it was written on, in the page or in the files inside it', () => {
    runInit({ cwd: repo, env });
    decide('Keep money in integer cents', 'public', 'accept');
    const note = runMemory({ cwd: repo, env }, { content: 'a note', scope: 'public' });
    expect(note.ok).toBe(true);
    const out = join(sandbox, 'out');
    expect(runSite({ cwd: repo, env }, { out }).ok).toBe(true);
    const page = pageOf(out);
    const files = JSON.parse(
      /id="record-files">(.*?)<\/script>/s.exec(page)?.[1] as string,
    ) as Record<string, string>;
    // Non-vacuity: there is a record inside the page for the search below to look through.
    expect(Object.keys(files).length).toBeGreaterThan(0);
    const inside = Object.values(files).map((file) =>
      Buffer.from(file, 'base64').toString('utf-8'),
    );
    // The sandbox is the root of every path this run touched: the project, the home, the
    // output, the temporary directory itself. Nothing under it may be named by the page.
    for (const path of [sandbox, repo, env.home as string, out, tmpdir()]) {
      expect(page.includes(path), `the page names ${path}`).toBe(false);
      expect(
        inside.some((file) => file.includes(path)),
        `a file inside the page names ${path}`,
      ).toBe(false);
    }
    expect(page).not.toMatch(/(?:^|[^\w/.:-])\/(?:home|Users|tmp|var|root)\/[\w.-]+/);
  });
});
