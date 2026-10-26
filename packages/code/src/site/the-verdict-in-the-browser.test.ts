/**
 * THE PAGE'S VERDICT IS `mnema verify`'S.
 *
 * A page that verified a record and said something other than the CLI says would be worse
 * than a page that did not verify: a stranger would trust the one they could run without
 * installing anything. So the script a generated page carries is run here the way a browser
 * runs it (in a context with no `Buffer`, no `require`, no filesystem and no
 * `SharedArrayBuffer` , which a page without cross-origin isolation lacks, reading the files the
 * page embeds) and what it writes is held against the CLI's own verdict over the same
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { generateKeyPair, publicKeyToPem, sealEntry, serializeEntry, verify } from '@mnema/chain';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { anAgentThatSignedAndWasRetired } from '../../tests/support/a-tail-from-another-machine.js';
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
 * What `mnema verify` says of the public tree to someone who has only the repository: no
 * key root of their own, which is who the page's reader is.
 *
 * It is not what the author's machine says, and the difference is one clause: a machine that
 * holds a registered backup key words the census with it ("1 backup key(s), which sign
 * nothing until restored"), and a clone cannot know that. The verdict (level, issues, the
 * rest of the sentence) is the same on both.
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

  it('says a retired agent key as a note, with the clause mnema verify gives it', () => {
    honestRecord();
    anAgentThatSignedAndWasRetired(repo, env, 2);
    expect(runSite({ cwd: repo, env }, { out: join(sandbox, 'retired') }).ok).toBe(true);
    const page = readFileSync(join(sandbox, 'retired', 'index.html'), 'utf-8');
    const shown = runInAPage(page, scriptOf(page));
    const cli = theCliSays();
    expect(cli.ok).toBe(true);
    expect(cli.summary).toContain(
      '1 retired agent key(s) whose earlier facts are no longer vouched for',
    );
    expect(shown.summary).toBe(cli.summary);
    expect(shown.state).toBe('verified');
    expect(shown.lines.filter((line) => line?.includes('signed by the agent key'))).toEqual([
      expect.stringMatching(
        /^note: 2 event\(s\) signed by the agent key \S+ before \S+ retired it/,
      ),
    ]);
    expect(shown.lines).toHaveLength(cli.notes);
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

  it('refuses a line holding a byte that is not UTF-8 where mnema verify refuses it', () => {
    // A page has no `Buffer`: a decoder that replaced the byte with U+FFFD, or one that read
    // it as Latin-1, would hand this line on as canonical text. It is one byte in the title,
    // with every hash around it left alone. `mnema site` refuses to publish a tree it cannot
    // read, so the byte is set in the files the honest page embeds, and on disk beside them.
    const out = honestRecord();
    const honest = readFileSync(join(out, 'index.html'), 'utf-8');
    const embedded = /id="record-files">(.*?)<\/script>/s.exec(honest)?.[1] as string;
    const files = JSON.parse(embedded) as Record<string, string>;
    const segment = segmentOf(repo);
    const name = Object.keys(files).find((file) => segment.endsWith(file)) as string;
    const bytes = readFileSync(segment);
    const at = bytes.indexOf('Store dates in UTC');
    expect(at).toBeGreaterThan(0);
    bytes[at] = 0xff;
    writeFileSync(segment, bytes);
    files[name] = bytes.toString('base64');
    const cli = theCliSays();
    expect(cli.level).toBe('unreadable');

    const page = honest.replace(embedded, JSON.stringify(files));
    expect(page).not.toBe(honest);
    const shown = runInAPage(page, scriptOf(page));
    expect({ summary: shown.summary, lines: shown.lines.length }).toEqual({
      summary: cli.summary,
      lines: cli.notes,
    });
    expect(shown.lines.join('\n')).toMatch(/not UTF-8 at byte \d+/);
  });

  it.each([
    [
      'a key no writer puts beside event and link',
      '000001.jsonl',
      (text: string) => text.replace(',"link":', ',"forged":1,"link":'),
      "top-level keys are ['event', 'forged', 'link'], not ['event', 'link']",
    ],
    [
      'a key no writer puts in a link',
      '000001.jsonl',
      (text: string) => text.replace('"link":{"hash"', '"link":{"forged":1,"hash"'),
      "link keys are ['forged', 'hash', 'prev', 'seq', 'tail'], not ['hash', 'prev', 'seq', 'tail']",
    ],
    [
      'a key no writer puts in a checkpoint',
      'checkpoints.jsonl',
      (text: string) => text.replace(',"fromSeq":', ',"forged":1,"fromSeq":'),
      "checkpoint keys: missing [], unexpected ['forged']",
    ],
    [
      'a key no writer puts in the tail proof',
      'tailproof.json',
      (text: string) => text.replace('{"scheme"', '{"forged":1,"scheme"'),
      "tail-proof keys are ['forged', 'scheme', 'sig', 'signerFp', 'tail'], not ['scheme', 'sig', 'signerFp', 'tail']",
    ],
    // A line broken where the order of the checks decides which cause is named first
    // (`FORMAT.md` section 4): the page names the one both readers name.
    [
      'a key in a link beside an event that is no object',
      '000001.jsonl',
      (text: string) => {
        const [first, ...rest] = text.split('\n');
        const { link } = JSON.parse(first as string) as { link: Record<string, unknown> };
        const { hash, prev, seq, tail } = link;
        const line = JSON.stringify({ event: 'x', link: { forged: 1, hash, prev, seq, tail } });
        return [line, ...rest].join('\n');
      },
      'event and link must both be objects',
    ],
    [
      'a link that is a string',
      '000001.jsonl',
      (text: string) => text.replace(/"link":\{[^}]*\}/, '"link":"x"'),
      'event and link must both be objects',
    ],
    [
      'a checkpoint scheme no version names',
      'checkpoints.jsonl',
      (text: string) => text.replace('"mnema-checkpoint/1"', '"mnema-checkpoint/9"'),
      "a checkpoint scheme this reader does not know: 'mnema-checkpoint/9'",
    ],
    [
      'a tail-proof scheme no version names',
      'tailproof.json',
      (text: string) => text.replace('"mnema-tail/1"', '"mnema-tail/9"'),
      "a tail-proof scheme this reader does not know: 'mnema-tail/9'",
    ],
  ])('refuses %s where mnema verify refuses it, in its words', (_, file, add, words) => {
    // The line stays canonical and every hash and signature still closes: only the set of
    // keys tells it from what a writer wrote. `mnema site` refuses to publish a tree it cannot
    // read, so the key is set in the files the honest page embeds, and on disk beside them.
    const out = honestRecord();
    const honest = readFileSync(join(out, 'index.html'), 'utf-8');
    const embedded = /id="record-files">(.*?)<\/script>/s.exec(honest)?.[1] as string;
    const files = JSON.parse(embedded) as Record<string, string>;
    const path = join(dirname(segmentOf(repo)), file);
    const name = Object.keys(files).find((each) => path.endsWith(each)) as string;
    const before = readFileSync(path, 'utf-8');
    const after = add(before);
    expect(after).not.toBe(before);
    writeFileSync(path, after);
    files[name] = Buffer.from(after, 'utf-8').toString('base64');
    const cli = theCliSays();
    expect(cli.ok).toBe(false);

    const page = honest.replace(embedded, JSON.stringify(files));
    const shown = runInAPage(page, scriptOf(page));
    expect({ summary: shown.summary, state: shown.state, lines: shown.lines.length }).toEqual({
      summary: cli.summary,
      state: 'broken',
      lines: cli.notes,
    });
    expect(shown.lines.join('\n')).toContain(words);
  });

  it('breaks where mnema verify breaks when a checkpoint signature is altered', () => {
    honestRecord();
    const checkpoints = join(dirname(segmentOf(repo)), 'checkpoints.jsonl');
    const text = readFileSync(checkpoints, 'utf-8');
    // The signature is R (32 bytes) then S (32 bytes), 128 hex digits. A digit of R usually makes
    // a point that does not exist, which is refused before any arithmetic; a digit of S's low
    // bytes leaves a well-formed signature that only the equation can refuse.
    const parts = /"sig":"([0-9a-f]{64})([0-9a-f]{2})/.exec(text);
    expect(parts, 'the checkpoint carries a signature to alter').not.toBeNull();
    const [, r, low] = parts as unknown as [string, string, string];
    const flipped = low.startsWith('0') ? '1' : '0';
    writeFileSync(
      checkpoints,
      text.replace(`"sig":"${r}${low}`, `"sig":"${r}${flipped}${low.slice(1)}`),
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

  it('breaks where mnema verify breaks when a key nothing uses is filed under another name', () => {
    // FORMAT.md section 6: a key file's name is recomputed from its material. This one is used
    // by no tail and no signature, and the page read it as a committed key with no tail and
    // said verified, as the CLI did, while the second reader refused it.
    honestRecord();
    const key = generateKeyPair();
    const name = 'b'.repeat(64);
    expect(key.fingerprint).not.toBe(name);
    writeFileSync(join(repo, '.mnema', 'keys', `${name}.pub`), publicKeyToPem(key.publicKey));
    expect(runSite({ cwd: repo, env }, { out: join(sandbox, 'misnamed') }).ok).toBe(true);
    const page = readFileSync(join(sandbox, 'misnamed', 'index.html'), 'utf-8');
    const shown = runInAPage(page, scriptOf(page));
    const cli = theCliSays();
    expect(cli.ok).toBe(false);
    expect({ summary: shown.summary, state: shown.state, lines: shown.lines.length }).toEqual({
      summary: cli.summary,
      state: 'broken',
      lines: cli.notes,
    });
    expect(shown.lines.join('\n')).toContain(
      `keys/${name}.pub is named for a fingerprint its own material does not hash to`,
    );
  });

  it('breaks where mnema verify breaks when an event in a tail names another key, by the same name', () => {
    // FORMAT.md section 6: a tail belongs to the key its id begins with, and only that key
    // writes to it. Another committed key, named for its own material, is put as the signer of
    // an event appended to the person's tail, and the chain is closed behind it. The page and
    // the CLI used to read this as a member question only; both now say whose tail it is.
    honestRecord();
    const other = generateKeyPair();
    writeFileSync(
      join(repo, '.mnema', 'keys', `${other.fingerprint}.pub`),
      publicKeyToPem(other.publicKey),
    );
    const segment = segmentOf(repo);
    const lines = readFileSync(segment, 'utf-8').trimEnd().split('\n');
    const last = JSON.parse(lines[lines.length - 1] as string) as {
      event: Record<string, unknown>;
      link: { tail: string; seq: number; hash: string };
    };
    const sealed = sealEntry({
      event: { ...last.event, signerFp: other.fingerprint } as never,
      tail: last.link.tail,
      seq: last.link.seq + 1,
      prev: last.link.hash,
    });
    writeFileSync(segment, `${[...lines, serializeEntry(sealed)].join('\n')}\n`);
    expect(runSite({ cwd: repo, env }, { out: join(sandbox, 'foreign') }).ok).toBe(true);
    const page = readFileSync(join(sandbox, 'foreign', 'index.html'), 'utf-8');
    const shown = runInAPage(page, scriptOf(page));
    const cli = theCliSays();
    expect(cli.ok).toBe(false);
    expect({ summary: shown.summary, state: shown.state, lines: shown.lines.length }).toEqual({
      summary: cli.summary,
      state: 'broken',
      lines: cli.notes,
    });
    expect(shown.lines.join('\n')).toContain(
      `seq ${last.link.seq + 1} names ${other.fingerprint.slice(0, 12)}... as its signer, and a ` +
        'tail is written only by the key its id begins with',
    );
    expect(shown.lines.join('\n')).toContain('(tail-signer-mismatch)');
  });

  it('is what the chain says over the frozen witnessed record, witness included', () => {
    const files: Record<string, string> = {};
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        else
          files[`${prefix}${entry.name}`] = readFileSync(join(dir, entry.name)).toString('base64');
      }
    };
    walk(join(FROZEN, 'witnessed-record'), '');
    const page = `id="record-files">${JSON.stringify(files)}</script>`;
    const shown = runInAPage(page, theSiteVerifier());
    const chain = verify(join(FROZEN, 'witnessed-record'));
    expect(chain.witness).toBe('covered');
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
    // Named by a variable, because it is a build script and not a module of the product.
    const script = join(HERE, '..', '..', 'build', 'the-site-verifier.mjs');
    const { bundleTheSiteVerifier } = (await import(pathToFileURL(script).href)) as {
      bundleTheSiteVerifier: () => Promise<string>;
    };
    expect(theSiteVerifier()).toBe(await bundleTheSiteVerifier());
  });

  it('is what `mnema site` writes through the built binary, which says what it wrote', () => {
    honestRecord();
    const out = join(sandbox, 'by-the-binary');
    const ran = spawnSync('node', [CLI, 'site', '--out', out], {
      cwd: repo,
      env: {
        HOME: env.home as string,
        PATH: process.env.PATH as string,
        GIT_CONFIG_NOSYSTEM: '1',
      },
      encoding: 'utf-8',
    });
    expect(ran.status).toBe(0);
    expect(ran.stdout.split('\n').filter((line) => line !== '')).toEqual([
      `Wrote ${join(out, 'index.html')}`,
      expect.stringMatching(
        /^ {2}2 decision\(s\), 2 in force; \d+ event\(s\); \d+ file\(s\) carried/,
      ),
      '  only the committed public tree is in the page',
    ]);
    expect(readFileSync(join(out, 'index.html'), 'utf-8')).toBe(
      readFileSync(join(sandbox, 'out', 'index.html'), 'utf-8'),
    );
    const outside = spawnSync('node', [CLI, 'site', '--out', out], {
      cwd: sandbox,
      env: { HOME: env.home as string, PATH: process.env.PATH as string },
      encoding: 'utf-8',
    });
    expect(outside.status).not.toBe(0);
    expect(outside.stderr).toContain('No mnema project here');
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
