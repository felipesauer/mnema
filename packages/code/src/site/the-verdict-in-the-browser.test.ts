/**
 * THE PAGE'S VERDICT IS `mnema verify`'S.
 *
 * A page that verified a record and said something other than the CLI says would be worse
 * than a page that did not verify: a stranger would trust the one they could run without
 * installing anything. So the script a generated page carries is run here the way a browser
 * runs it — in a context with no `Buffer`, no `require`, no filesystem and no
 * `SharedArrayBuffer` (a page without cross-origin isolation has none), reading the files the
 * page embeds — and what it writes is held against the CLI's own verdict over the same
 * record: honest, tampered at the hash chain, tampered at a signature, and the frozen
 * witnessed record.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { verify } from '@mnema/chain';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundleTheSiteVerifier } from '../../build/the-site-verifier.mjs';
import { runDecision } from '../commands/decision.js';
import { runDecisionTransition } from '../commands/decision-transition.js';
import { runInit } from '../commands/init.js';
import { runSite } from '../commands/site.js';
import { theSiteVerifier } from './verifier-bundle.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', '..', 'dist', 'cli.js');
const FROZEN = join(HERE, '..', '..', '..', 'chain', 'src', 'chain', '__fixtures__');

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-verdict-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  env = { home: join(sandbox, 'home') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A fake of the part of a page the script touches: elements by id, with text and children. */
interface FakeElement {
  textContent: string | null;
  attributes: Record<string, string>;
  children: FakeElement[];
  setAttribute(name: string, value: string): void;
  appendChild(child: FakeElement): void;
}

function element(text: string | null = null): FakeElement {
  const made: FakeElement = {
    textContent: text,
    attributes: {},
    children: [],
    setAttribute(name, value) {
      made.attributes[name] = value;
    },
    appendChild(child) {
      made.children.push(child);
    },
  };
  return made;
}

/** What the page shows once its script has run. */
interface Shown {
  readonly state: string | undefined;
  readonly status: string | null;
  readonly summary: string | null;
  readonly lines: readonly (string | null)[];
}

/** Runs `script` in a context shaped like a plain page, over the files `page` embeds. */
function runInAPage(page: string, script: string): Shown {
  const files = /id="record-files">(.*?)<\/script>/s.exec(page)?.[1] as string;
  const elements: Record<string, FakeElement> = {
    'record-files': element(files),
    'verdict-status': element(),
    'verdict-summary': element(),
    'verdict-issues': element(),
  };
  const document = {
    getElementById: (id: string) => elements[id] ?? null,
    createElement: () => element(),
  };
  const context = vm.createContext({ TextEncoder, TextDecoder, atob, btoa, URL, document });
  vm.runInContext('delete globalThis.SharedArrayBuffer', context);
  vm.runInContext(script, context);
  const status = elements['verdict-status'] as FakeElement;
  const issues = elements['verdict-issues'] as FakeElement;
  return {
    state: status.attributes['data-state'],
    status: status.textContent,
    summary: (elements['verdict-summary'] as FakeElement).textContent,
    lines: issues.children.map((child) => child.textContent),
  };
}

function scriptOf(page: string): string {
  return /<script>(.*)<\/script>/s.exec(page)?.[1] as string;
}

function honestRecord(): string {
  runInit({ cwd: repo, env });
  const here = { cwd: repo, env };
  for (const title of ['Keep money in integer cents', 'Store dates in UTC']) {
    const recorded = runDecision(here, { title, rationale: `why: ${title}` });
    if (!recorded.ok) throw new Error('setup: decision refused');
    runDecisionTransition(here, { id: recorded.id, action: 'accept', proof: { note: 'ok' } });
  }
  const out = join(sandbox, 'out');
  expect(runSite(here, { out }).ok).toBe(true);
  return out;
}

/**
 * What `mnema verify` says of the public tree to someone who has only the repository — no
 * key root of their own, which is who the page's reader is.
 *
 * It is not what the author's machine says, and the difference is one clause: a machine that
 * holds a registered backup key words the census with it ("1 backup key(s), which sign
 * nothing until restored"), and a clone cannot know that. The verdict — level, issues, the
 * rest of the sentence — is the same on both.
 */
function theCliSays(): { ok: boolean; level: string; summary: string; notes: number } {
  const result = verify(join(repo, '.mnema'));
  return {
    ok: result.ok,
    level: result.level,
    summary: result.summary,
    notes: result.issues.length + result.census.length,
  };
}

/** The first tail's first segment, where a record's events are. */
function segmentOf(root: string): string {
  const tails = join(root, '.mnema', 'tails');
  const tail = readdirSync(tails)[0] as string;
  return join(tails, tail, '000001.jsonl');
}

describe('the verdict a page computes', () => {
  it('is the verdict mnema verify gives over an honest record', () => {
    const out = honestRecord();
    const page = readFileSync(join(out, 'index.html'), 'utf-8');
    const shown = runInAPage(page, scriptOf(page));
    const cli = theCliSays();
    expect(cli.ok).toBe(true);
    expect({ summary: shown.summary, state: shown.state, status: shown.status }).toEqual({
      summary: cli.summary,
      state: 'verified',
      status: `verified (${cli.level})`,
    });
    // What is listed under an honest verdict is the census, said as a note and not as a break.
    expect(shown.lines).toHaveLength(cli.notes);
    expect(shown.lines.every((line) => line?.startsWith('note: '))).toBe(true);
  });

  it('breaks where mnema verify breaks when an event is edited, and says the same of it', () => {
    const out = honestRecord();
    const segment = segmentOf(repo);
    writeFileSync(
      segment,
      readFileSync(segment, 'utf-8').replace('Keep money in integer cents', 'Keep money in floats'),
    );
    expect(runSite({ cwd: repo, env }, { out: join(sandbox, 'tampered') }).ok).toBe(true);
    const page = readFileSync(join(sandbox, 'tampered', 'index.html'), 'utf-8');
    const shown = runInAPage(page, scriptOf(page));
    const cli = theCliSays();
    expect(cli.ok).toBe(false);
    expect({ summary: shown.summary, state: shown.state, lines: shown.lines.length }).toEqual({
      summary: cli.summary,
      state: 'broken',
      lines: cli.notes,
    });
    expect(out).not.toBe(join(sandbox, 'tampered'));
  });

  it('breaks where mnema verify breaks when a checkpoint signature is altered', () => {
    honestRecord();
    const checkpoints = join(dirname(segmentOf(repo)), 'checkpoints.jsonl');
    const text = readFileSync(checkpoints, 'utf-8');
    const signature = /"sig":"([0-9a-f]{4})/.exec(text)?.[1] as string;
    expect(signature, 'the checkpoint carries a signature to alter').toBeDefined();
    const flipped = signature.startsWith('0') ? '1' : '0';
    writeFileSync(
      checkpoints,
      text.replace(`"sig":"${signature}`, `"sig":"${flipped}${signature.slice(1)}`),
    );
    expect(runSite({ cwd: repo, env }, { out: join(sandbox, 'tampered') }).ok).toBe(true);
    const page = readFileSync(join(sandbox, 'tampered', 'index.html'), 'utf-8');
    const shown = runInAPage(page, scriptOf(page));
    const cli = theCliSays();
    expect(cli.ok).toBe(false);
    expect({ summary: shown.summary, state: shown.state, lines: shown.lines.length }).toEqual({
      summary: cli.summary,
      state: 'broken',
      lines: cli.notes,
    });
  });

  it('is what the chain says over the frozen witnessed record, witness included', () => {
    const files: Record<string, string> = {};
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        else files[`${prefix}${entry.name}`] = readFileSync(join(dir, entry.name)).toString('base64');
      }
    };
    walk(join(FROZEN, 'witnessed-record'), '');
    const page = `id="record-files">${JSON.stringify(files)}</script>`;
    const shown = runInAPage(page, theSiteVerifier());
    const chain = verify(join(FROZEN, 'witnessed-record'));
    expect(chain.witness.state).not.toBe('none');
    expect({ summary: shown.summary, status: shown.status }).toEqual({
      summary: chain.summary,
      status: `verified (${chain.level})`,
    });
  });

  it('is the verdict the built binary prints in a fresh clone, for an honest record and a broken one', () => {
    honestRecord();
    const clone = join(sandbox, 'clone');
    const run = (): { code: number | null; out: string } => {
      rmSync(clone, { recursive: true, force: true });
      mkdirSync(join(clone, '.mnema'), { recursive: true });
      for (const part of ['tails', 'keys']) {
        cpSync(join(repo, '.mnema', part), join(clone, '.mnema', part), { recursive: true });
      }
      const ran = spawnSync('node', [CLI, 'verify'], {
        cwd: clone,
        env: {
          HOME: join(sandbox, 'clone-home'),
          PATH: process.env.PATH as string,
          GIT_CONFIG_NOSYSTEM: '1',
        },
        encoding: 'utf-8',
      });
      return { code: ran.status, out: ran.stdout };
    };
    const honest = run();
    const page = readFileSync(join(sandbox, 'out', 'index.html'), 'utf-8');
    const shown = runInAPage(page, scriptOf(page));
    expect(honest.code).toBe(0);
    expect(honest.out).toContain(shown.summary as string);

    const segment = segmentOf(repo);
    writeFileSync(
      segment,
      readFileSync(segment, 'utf-8').replace('Store dates in UTC', 'Store dates in CET'),
    );
    runSite({ cwd: repo, env }, { out: join(sandbox, 'tampered') });
    const tampered = readFileSync(join(sandbox, 'tampered', 'index.html'), 'utf-8');
    const shownBroken = runInAPage(tampered, scriptOf(tampered));
    const broken = run();
    expect(broken.code).not.toBe(0);
    expect(broken.out).toContain(shownBroken.summary as string);
    expect(shownBroken.state).toBe('broken');
  });

  it('is computed by the script the build left, not by an older one', async () => {
    expect(theSiteVerifier()).toBe(await bundleTheSiteVerifier());
  });

  it('refuses nothing it cannot do: a page with no files says it verified nothing', () => {
    const shown = runInAPage('id="record-files">{}</script>', theSiteVerifier());
    expect({ state: shown.state, status: shown.status, summary: shown.summary }).toEqual({
      state: 'unverified',
      status: 'not verified',
      summary: 'This page carries no record files, so nothing was verified.',
    });
  });
});
