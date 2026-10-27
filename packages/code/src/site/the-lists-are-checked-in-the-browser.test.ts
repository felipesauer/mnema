/**
 * THE LISTS A PAGE SHOWS ARE CHECKED, IN THE READER'S BROWSER, AGAINST THE EVENTS THE PAGE VERIFIED.
 *
 * `mnema site` writes the decisions, notes and timeline into the page; the script (`browser/check.ts`,
 * over the trees `view.ts` makes) derives them again from the files it verified and names each
 * difference. The page's own script is run here the way a browser runs it (`runInAVm`: the HTML the
 * writer produced, parsed into a small DOM, in a context with no `Buffer`, no `require` and no
 * filesystem), and:
 *
 *   - an honest page says `match`, over a rich record, a record with a retired agent key, and the
 *     frozen witnessed record;
 *   - a SERVER THAT LIES (the HTML is altered after `mnema site` wrote it, one lie at a time) says
 *     `differ` and names the item, in each of the ways a page can lie about a list;
 *   - a record that does not verify is `unchecked`, never `match`;
 *   - what the script derives in the vm is, value for value, what `pageModel` gives in Node over the
 *     same tree (the order `orderedEvents` reads a mounted tree in is the one it reads a disk in);
 *   - the bundle names no `node:` module and no `require(`, and a name the `@mnema/core` shim does not
 *     export stops the BUILD, not a reader's browser.
 */

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
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PageRun, runInAVm } from '../../tests/support/a-page-in-a-vm.js';
import { anAgentThatSignedAndWasRetired } from '../../tests/support/a-tail-from-another-machine.js';
import { runDecision } from '../commands/decision.js';
import { runDecisionTransition } from '../commands/decision-transition.js';
import { runInit } from '../commands/init.js';
import { runLink } from '../commands/link.js';
import { runMemory } from '../commands/memory.js';
import { runObserve } from '../commands/observe.js';
import { runRetract } from '../commands/retract.js';
import { runSite } from '../commands/site.js';
import { tailsOfFiles } from './browser/tails.js';
import { pageModel } from './model.js';
import { renderPage } from './page.js';
import { theSiteVerifier } from './verifier-bundle.js';

// Each case verifies a record in a vm, a second or more under load.
vi.setConfig({ testTimeout: 60_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const FROZEN = join(HERE, '..', '..', '..', 'chain', 'src', 'chain', '__fixtures__');

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-lists-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  env = { home: join(sandbox, 'home') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface Checked {
  readonly run: PageRun;
  readonly state: string | null;
  readonly status: string | null;
  readonly summary: string | null;
  readonly issues: readonly (string | null)[];
}

/** Runs the page's script over `html`, to the end of every timer it set, and reads what it said of the lists. */
function checked(html: string): Checked {
  const script = /<script>(.*)<\/script>/s.exec(html)?.[1] as string;
  const run = runInAVm(html, script);
  run.timers.drain();
  const status = run.page.getElementById('lists-status');
  return {
    run,
    state: status?.getAttribute('data-state') ?? null,
    status: status?.textContent ?? null,
    summary: run.page.getElementById('lists-summary')?.textContent ?? null,
    issues: (run.page.getElementById('lists-issues')?.children ?? []).map((li) => li.textContent),
  };
}

/** A record with the things the page lists: agents and people, every state, notes, a retraction, an address. */
function aRichRecord(over: { title?: string; rationale?: string } = {}): string {
  runInit({ cwd: repo, env });
  const here = { cwd: repo, env };
  const decide = (title: string, extra: { which?: string; alternatives?: string } = {}) => {
    const made = runDecision(here, {
      title,
      rationale: over.rationale ?? `why: ${title}`,
      scope: 'public',
      ...extra,
    });
    if (!made.ok) throw new Error(`setup: decision refused (${made.reason})`);
    return made.id;
  };
  const move = (id: string, action: string, which?: string) => {
    const moved = runDecisionTransition(here, {
      id,
      action,
      proof: { note: 'agreed in review' },
      ...(which === undefined ? {} : { which }),
    });
    if (!moved.ok) throw new Error(`setup: ${action} refused (${moved.reason})`);
  };
  const one = decide(over.title ?? 'Keep money in integer cents', {
    which: 'claude-code',
    alternatives: 'floats, or decimals',
  });
  move(one, 'accept');
  const two = decide('Store dates in UTC');
  move(two, 'accept', 'claude-code');
  decide('Use one lockfile');
  const four = decide('Vendor the parser');
  move(four, 'reject');
  const note = (made: { ok: true; id: string } | { ok: false; reason: string }): string => {
    if (!made.ok) throw new Error(`setup: a note was refused (${made.reason})`);
    return made.id;
  };
  note(
    runObserve(here, {
      about: one,
      topic: 'rounding',
      text: 'half to even in the ledger',
      scope: 'public',
      which: 'claude-code',
    }),
  );
  const kept = note(runMemory(here, { content: 'the export rounds twice', scope: 'public' }));
  const gone = note(runMemory(here, { content: 'cents are a unit of the past', scope: 'public' }));
  note(runMemory(here, { content: 'a note about nothing in particular', scope: 'public' }));
  for (const id of [kept, gone]) {
    const linked = runLink(here, { subject: id, target: two, rel: 'relates-to', scope: 'public' });
    if (!linked.ok) throw new Error('setup: a link was refused');
  }
  const governs = runLink(here, {
    subject: one,
    target: 'packages/code',
    rel: 'governs',
    scope: 'public',
  });
  if (!governs.ok) throw new Error('setup: governs refused');
  if (!runRetract(here, { id: gone, reason: 'it was a draft' }).ok) throw new Error('setup');
  const out = join(sandbox, 'out');
  if (!runSite(here, { out }).ok) throw new Error('setup: site refused');
  return readFileSync(join(out, 'index.html'), 'utf-8');
}

/** The first card of `html` that carries `adr` as its label. */
function cardOf(html: string, adr: string): string {
  const card = (html.match(/<article [\s\S]*?<\/article>/g) ?? []).find((c) =>
    c.includes(`<span data-field="adr">${adr}</span>`),
  );
  if (card === undefined) throw new Error(`the page has no card for ${adr}`);
  return card;
}

/** `html` with `from` replaced once by `to`; a lie that changed nothing is not one. */
function swapped(html: string, from: string, to: string): string {
  expect(html, `the lie's anchor ${from.slice(0, 60)}`).toContain(from);
  const lied = html.replace(from, () => to);
  expect(lied).not.toBe(html);
  return lied;
}

/** `html` with one card changed by `edit`. */
function withCard(html: string, adr: string, edit: (card: string) => string): string {
  const card = cardOf(html, adr);
  return swapped(html, card, edit(card));
}

describe('an honest page', () => {
  it('says its lists match the events verified above, over a rich record', () => {
    const html = aRichRecord();
    const said = checked(html);
    expect({ state: said.state, status: said.status, issues: said.issues }).toEqual({
      state: 'match',
      status: 'match',
      issues: [],
    });
    expect(said.summary).toBe('The lists on this page match the events verified above.');
    // The verdict itself is the chain's, and the check waited for it.
    expect(said.run.page.getElementById('verdict-status')?.getAttribute('data-state')).toBe(
      'verified',
    );
  });

  it('matches over a record with a retired agent key and a task from another machine', () => {
    aRichRecord();
    anAgentThatSignedAndWasRetired(repo, env, 2);
    const out = join(sandbox, 'retired');
    expect(runSite({ cwd: repo, env }, { out }).ok).toBe(true);
    const said = checked(readFileSync(join(out, 'index.html'), 'utf-8'));
    expect(said.issues).toEqual([]);
    expect(said.state).toBe('match');
  });

  it('matches over text that is markup, a leading line break and a right-to-left override', () => {
    const html = aRichRecord({
      title: '<img src=x onerror=alert(1)> ‮evil',
      rationale: '\nstarts with a break and has an <b>entity</b> &amp; a bell \u0007',
    });
    expect(html).not.toContain('<img src=x');
    const said = checked(html);
    expect(said.issues).toEqual([]);
    expect(said.state).toBe('match');
  });

  it("matches over a copy of this repository's own record, as many decisions and notes as it has", () => {
    // The committed tree of this checkout, copied into a project of its own: the page is made from the copy.
    cpSync(join(HERE, '..', '..', '..', '..', '.mnema'), join(repo, '.mnema'), { recursive: true });
    const out = join(sandbox, 'own');
    const done = runSite({ cwd: repo, env }, { out });
    expect(done.ok && done.decisions).toBeGreaterThan(50);
    const said = checked(readFileSync(join(out, 'index.html'), 'utf-8'));
    expect(said.issues).toEqual([]);
    expect(said.state).toBe('match');
  });

  it('matches over the frozen witnessed record, which lists nothing', () => {
    const root = join(FROZEN, 'witnessed-record');
    const files: Record<string, string> = {};
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        else
          files[`${prefix}${entry.name}`] = readFileSync(join(dir, entry.name)).toString('base64');
      }
    };
    walk(root, '');
    const model = pageModel(orderedEvents({ root }, catalogUpcasters()));
    const html = renderPage({ ...model, tails: tailsOfFiles(files), files }, theSiteVerifier());
    const said = checked(html);
    expect(said.issues).toEqual([]);
    expect(said.state).toBe('match');
  });
});

describe('a server that lies about a list', () => {
  const LIES: readonly [string, (html: string) => string, RegExp][] = [
    [
      "(a) the word of a card's state",
      (html) =>
        withCard(html, 'ADR-3', (card) =>
          swapped(card, 'data-field="state">proposed<', 'data-field="state">accepted<'),
        ),
      /^ADR-3 \(state\): the page says "accepted"; the events say "proposed"$/,
    ],
    [
      '(b) the data-state of a card, which the filters read',
      (html) =>
        withCard(html, 'ADR-3', (card) =>
          swapped(card, 'data-state="proposed" data-force', 'data-state="accepted" data-force'),
        ),
      /^ADR-3: its attribute data-state says "accepted"; the events say "proposed"$/,
    ],
    [
      '(c) a card taken away',
      (html) => swapped(html, cardOf(html, 'ADR-4'), ''),
      /^ADR-4 is in the events and not on the page \(decisions\)$/,
    ],
    [
      '(d) a card made up',
      (html) => {
        const card = cardOf(html, 'ADR-4');
        const id = /id="([0-9a-f-]{36})"/.exec(card)?.[1] as string;
        return swapped(
          html,
          card,
          `${card}${card.replaceAll(id, 'made-up-id').replaceAll('ADR-4', 'ADR-99')}`,
        );
      },
      /^ADR-99 is on the page and not in the events \(decisions\)$/,
    ],
    [
      '(e) the text of a note',
      (html) => swapped(html, 'half to even in the ledger', 'half up in the ledger'),
      /^ADR-1 \(note-text of note \S+\): the page says "half up in the ledger"; the events say "half to even in the ledger"$/,
    ],
    [
      '(f) the badge of an acceptance, an agent made a person',
      (html) =>
        withCard(html, 'ADR-2', (card) =>
          swapped(
            card,
            'data-field="accepted-by">agent claude-code<',
            'data-field="accepted-by">a person<',
          ),
        ),
      /^ADR-2 \(accepted-by\): the page says "a person"; the events say "agent claude-code"$/,
    ],
    [
      '(g) the line of counts',
      (html) => swapped(html, '<p id="counts">4 decision(s)', '<p id="counts">9 decision(s)'),
      /^the counts line: the page says something the events do not give, outside its fields/,
    ],
    [
      '(h) two entries of the timeline in the other order',
      (html) => {
        const entries = html.match(/<li class="entry"[\s\S]*?<\/li>/g) as string[];
        const [first, second] = [entries[0] as string, entries[1] as string];
        return swapped(swapped(html, first, '@@FIRST@@'), second, first).replace(
          '@@FIRST@@',
          second,
        );
      },
      /^timeline entry 1: its attribute data-kind says "decision-moved"; the events say "decision-recorded"$/,
    ],
    [
      '(i) the last move taken out of a history',
      (html) =>
        withCard(html, 'ADR-1', (card) =>
          swapped(
            card,
            // The last move of the history: what is left lines up with the events, and what is gone is named.
            (card.match(/<li><time data-field="move-at">[\s\S]*?<\/li>/g) as string[]).at(
              -1,
            ) as string,
            '',
          ),
        ),
      /^ADR-1: the field move-at is missing from the page$/,
    ],
    [
      '(j) a sentence added outside every field',
      (html) =>
        withCard(html, 'ADR-3', (card) =>
          swapped(card, '</article>', '<p>Agreed in a hallway, off the record.</p></article>'),
        ),
      /^ADR-3: the page says something the events do not give, outside its fields/,
    ],
    [
      '(k) a data-field taken off a node',
      (html) =>
        withCard(html, 'ADR-3', (card) => swapped(card, '<pre data-field="rationale">', '<pre>')),
      /^ADR-3: the field rationale is missing from the page$/,
    ],
    [
      '(o) a node with a field name the events do not give, holding no text',
      (html) =>
        withCard(html, 'ADR-3', (card) =>
          swapped(card, '</article>', '<span data-field="invented"></span></article>'),
        ),
      /^ADR-3: the page has a field named "invented" that the events do not give$/,
    ],
    [
      '(l) an "open" link pointed at another card',
      (html) =>
        swapped(
          html,
          /<a href="#[^"]+" data-field="entry-link">/.exec(html)?.[0] as string,
          '<a href="#elsewhere" data-field="entry-link">',
        ),
      /^timeline entry 1 \(entry-link\): its attribute href says "#elsewhere"/,
    ],
    [
      '(m) two cards in the other order',
      (html) => {
        const [one, two] = [cardOf(html, 'ADR-1'), cardOf(html, 'ADR-2')];
        return swapped(swapped(html, one, '@@ONE@@'), two, one).replace('@@ONE@@', two);
      },
      /^the decisions are in another order on the page than the events give$/,
    ],
    [
      '(n) a tail said to hold more events than it does',
      (html) =>
        swapped(
          html,
          /<span data-field="tail-events">(\d+)<\/span>/.exec(html)?.[0] as string,
          '<span data-field="tail-events">9999</span>',
        ),
      /^tail \S+ \(tail-events\): the page says "9999"/,
    ],
  ];

  it.each(LIES)('%s: the page says differ and names the item', (_name, lie, naming) => {
    const said = checked(lie(aRichRecord()));
    expect(said.state, JSON.stringify(said.issues)).toBe('differ');
    expect(said.status).toBe('differ');
    expect(
      said.issues.filter((line) => naming.test(line ?? '')),
      `no line names it: ${JSON.stringify(said.issues)}`,
    ).not.toHaveLength(0);
    expect(said.summary).toMatch(/^\d+ difference\(s\) between the lists on this page/);
  });

  it('is not a verdict on the chain: the verdict above still says verified', () => {
    const html = aRichRecord();
    const said = checked(
      withCard(html, 'ADR-3', (card) => swapped(card, '</article>', '<p>x</p></article>')),
    );
    expect(said.state).toBe('differ');
    expect(said.run.page.getElementById('verdict-status')?.getAttribute('data-state')).toBe(
      'verified',
    );
  });

  it('puts what the record said into the difference by text, never as markup', () => {
    const html = aRichRecord({ title: '<img src=x onerror=alert(1)>' });
    const said = checked(
      withCard(html, 'ADR-3', (card) => swapped(card, '</article>', '<p>x</p></article>')),
    );
    expect(said.state).toBe('differ');
    const hostile = said.run.page.writes.filter((write) => write.value.includes('<img'));
    for (const write of hostile) expect(write.via).toBe('textContent');
    expect(
      said.run.page.writes.every(
        (write) =>
          write.via !== 'createElement' || write.value === 'li' || write.value === 'option',
      ),
    ).toBe(true);
  });
});

describe('a record that did not verify', () => {
  it('is not checked, never matched: an edited event leaves the lists unchecked, saying why', () => {
    aRichRecord();
    const tails = join(repo, '.mnema', 'tails');
    const segment = join(tails, readdirSync(tails)[0] as string, '000001.jsonl');
    writeFileSync(
      segment,
      readFileSync(segment, 'utf-8').replace('Keep money in integer cents', 'Keep money in floats'),
    );
    const out = join(sandbox, 'tampered');
    expect(runSite({ cwd: repo, env }, { out }).ok).toBe(true);
    const said = checked(readFileSync(join(out, 'index.html'), 'utf-8'));
    expect(said.run.page.getElementById('verdict-status')?.getAttribute('data-state')).toBe(
      'broken',
    );
    expect({ state: said.state, status: said.status }).toEqual({
      state: 'unchecked',
      status: 'not checked',
    });
    expect(said.summary).toBe(
      'The record did not verify, so the lists on this page were not checked against it.',
    );
    expect(said.issues).toEqual([]);
  });

  it('is not checked when the page carries no files', () => {
    const html = renderPage({ ...pageModel([]), tails: [], files: {} }, theSiteVerifier());
    const said = checked(html);
    expect(said.state).toBe('unchecked');
    expect(said.summary).toContain('did not verify');
  });

  it('says unchecked before the script has run, which is what a reader without it is told', () => {
    const html = aRichRecord();
    const run = runInAVm(html, '');
    expect(run.page.getElementById('lists-status')?.getAttribute('data-state')).toBe('unchecked');
    expect(run.page.getElementById('lists-summary')?.textContent).toContain(
      'needs JavaScript, so they have not been checked',
    );
  });
});

describe('what the script derives in the browser', () => {
  it('is, value for value, what pageModel gives in Node over the same tree', () => {
    aRichRecord();
    const own = join(HERE, '..', '..', '..', '..', '.mnema');
    for (const root of [join(repo, '.mnema'), join(FROZEN, 'witnessed-record'), own]) {
      const files: Record<string, string> = {};
      const walk = (dir: string, prefix: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const name = `${prefix}${entry.name}`;
          if (entry.isDirectory()) {
            if (prefix === '' && entry.name !== 'tails' && entry.name !== 'keys') continue;
            walk(join(dir, entry.name), `${name}/`);
          } else if (name.startsWith('tails/') || name.endsWith('.pub')) {
            files[name] = readFileSync(join(dir, entry.name)).toString('base64');
          }
        }
      };
      walk(root, '');
      const html = renderPage(
        {
          ...pageModel(orderedEvents({ root }, catalogUpcasters())),
          tails: tailsOfFiles(files),
          files,
        },
        theSiteVerifier(),
      );
      const run = runInAVm(html, theSiteVerifier());
      (run.context as { files: unknown }).files = files;
      const inTheVm = JSON.parse(
        vm.runInContext('JSON.stringify(mnemaSite.deriveLists(files))', run.context) as string,
      );
      const inNode = JSON.parse(
        JSON.stringify({
          model: pageModel(orderedEvents({ root }, catalogUpcasters())),
          tails: tailsOfFiles(files),
        }),
      );
      expect(inTheVm).toEqual(inNode);
    }
  });
});

describe('the bundle', () => {
  const buildScript = join(HERE, '..', '..', 'build', 'the-site-verifier.mjs');
  type Build = (extra?: { alias?: Record<string, string>; banner?: string }) => Promise<string>;
  const bundle = async (): Promise<Build> =>
    ((await import(pathToFileURL(buildScript).href)) as { bundleTheSiteVerifier: Build })
      .bundleTheSiteVerifier;

  it('names no node: module and no require( call', () => {
    const script = theSiteVerifier();
    expect(script).not.toMatch(/["'`]node:[a-z_/]+["'`]/);
    expect(script).not.toMatch(/\brequire\(/);
  });

  it('is refused by the build when it would carry a node: module or a require( call', async () => {
    const build = await bundle();
    await expect(build({ banner: 'import("node:os");' })).rejects.toThrow(/quoted "node:" module/);
    await expect(build({ banner: 'var r = require("os");' })).rejects.toThrow(/"require\("/);
  });

  it("stops the build, and not a reader's browser, when the @mnema/core shim lacks a name the model uses", async () => {
    const shim = join(sandbox, 'shim.mjs');
    const core = join(HERE, '..', '..', '..', 'core', 'dist', 'projections', 'decision.js');
    writeFileSync(shim, `export { projectDecisions } from ${JSON.stringify(core)};\n`);
    const build = await bundle();
    await expect(build({ alias: { '@mnema/core': shim } })).rejects.toThrow();
  });
});
