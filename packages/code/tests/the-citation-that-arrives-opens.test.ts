/**
 * THE CITATION THAT ARRIVES OPENS: the three channels that push a rule at a reader who
 * never asked for one carry the file the rule came from.
 *
 * WHAT WAS WRONG, MEASURED ON A REAL PROJECT OF 247 IMPORTED DECISIONS. `mnema decision
 * import` freezes its own `ADR-<n>` into each decision, so a file named `ADR-008` becomes
 * `ADR-2` in the record. That is deliberate and stays — two projects can each hold an
 * ADR-1, and a label re-derived on read would silently cite a different decision — but it
 * means the label does not name the file: 241 of the 247 diverged, and five of the six
 * rules the committed document printed pointed at a document that is not theirs.
 *
 * The record already held the answer, as a `derived-from` edge the import wrote, and
 * `the-origin-travels-beside-the-label.test.ts` put it on the three reads somebody ASKS
 * for. This is the N+1 site of that rule, and it is the side that matters more: those
 * three are doors a reader chose to open. These channels arrive unasked — the committed
 * document a session opens with, the rules pushed as a file is about to be written, and
 * the charge that STOPS a write — and until now each of them handed its reader a name, an
 * address and a uuid, with this product the only way to reach the argument. This paragraph
 * used to end "Four measurements of this bench say that tool is not called", about
 * `read_record`, and they do not: the cells that opened with a uuid called it 62 times.
 * What the measurement does support is the door — on a real project the reader followed
 * the opening document's citation with `cat` and made none of its calls to this product
 * (`packages/code/src/record-framing.ts` records both).
 *
 * WHAT IS ASSERTED, AND WHY EACH:
 *   - THE PATH OPENS. Every case below reads the printed path off the channel's own bytes
 *     and OPENS it from disk, so what is proved is not that a field is present but that a
 *     reader holding `cat` can follow it. The three reads deliberately do not probe a
 *     disk, so nothing in the product can make this claim — only a case can.
 *   - THE DIVERGENCE IS ASSERTED BESIDE IT. The record's label is `ADR-1` and the file is
 *     `ADR-008`. A case that only checked for a path would pass over the one record for
 *     which this whole item is invisible: the one whose label happens to agree.
 *   - THE CONTRAST. A rule decided HERE, by hand, carries no provenance at all, and the
 *     line is whole without it. Without this case, a product that stamped a field on
 *     everything would pass the ones above.
 *   - N SOURCES. A rule may assert several, and the shape says what it does with them.
 *   - THE PRIVATE ASSERTION. A link is legitimately cross-tree, so the private tree can
 *     assert a provenance about a public rule. None of these channels serves it: the
 *     document is committed and compared with `diff`, and a path of one machine pushed at
 *     everybody's edit is a citation that resolves for one reader. `mnema refs` is the
 *     read that crosses trees, and both halves are asserted, because "does not serve it"
 *     is only honest if something does.
 *   - THE WORD HAS ONE SOURCE. Four printers say `derived from`; a fifth spelling it by
 *     hand is the drift this file's last case is for.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { openSession, type Session } from '../src/mcp/session.js';
import { runRulesBeforeAnEditTool } from '../src/mcp/tools.js';
import { DERIVED_FROM } from '../src/provenance.js';
import { sourceFiles } from './support/reading-source.js';

/** The file whose own number is not the number the record will freeze. */
const GATEWAY = 'ADR-008-the-gateway-is-idempotent.md';
/** What that file says, so a case can prove it opened THAT one and not another. */
const GATEWAY_BODY = 'Retries were duplicating charges, so every write carries a key.';
/**
 * A SECOND source, in the same directory, so a channel can be asked which rule a path
 * belongs to rather than whether it printed one.
 *
 * MEASURED: without a second imported decision, a derivation that dropped the subject
 * from its query — serving every provenance the tree holds to every rule — left this file
 * entirely green. That mutation is the defect this delivery exists to fix, arriving from
 * the other side, and one fixture cannot see it.
 */
const LEDGER = 'ADR-011-the-ledger-is-append-only.md';
/** What the second file says. */
const LEDGER_BODY = 'Nothing is edited in place, so an auditor can replay the whole of it.';

/** `packages/code/src` — the tree the last case walks. */
const SOURCE = fileURLToPath(new URL('../src', import.meta.url));

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;

/** What one invocation wrote, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** Runs `mnema <argv>` the way the binary does. */
async function mnema(...argv: string[]): Promise<Said> {
  const out: string[] = [];
  const err: string[] = [];
  let failed = false;
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    fail: () => {
      failed = true;
    },
  };
  await run(argv, io);
  return { out, err, failed };
}

/** The id in the parentheses of an echo — never the leading `ADR-<n>`, which is display. */
function idIn(said: Said): string {
  const id = said.out.join('\n').match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said.out.join(' / ')}`);
  return id;
}

/**
 * Imports the ADR directory for real, accepts every decision it proposed, and returns
 * them keyed by the file each came out of.
 *
 * A decision an import proposes is born `proposed` — structurally, because a repository
 * that already decided is not this product's to accept on its behalf — so each has to be
 * accepted before any of these channels carries it at all.
 */
async function importedAndAccepted(): Promise<Map<string, string>> {
  const imported = await mnema('decision', 'import', 'docs/adr', '--write');
  expect(imported.failed, imported.err.join(' / ')).toBe(false);
  // The echo names each proposal on one line and the file it came out of on the NEXT, so
  // the id is carried forward rather than looked for twice — the pairing is the echo's own
  // and a case that matched both on one line would silently find neither.
  const byFile = new Map<string, string>();
  let last: string | undefined;
  for (const line of imported.out) {
    last = line.match(/\(([0-9a-f-]{20,})\)/)?.[1] ?? last;
    const file = line.match(/ from docs\/adr\/(\S+\.md)$/)?.[1];
    if (file === undefined || last === undefined) continue;
    byFile.set(file, last);
    const accepted = await mnema('decision', 'move', 'accept', last, '--note', 'still holds');
    expect(accepted.failed, accepted.err.join(' / ')).toBe(false);
  }
  expect([...byFile.keys()].sort()).toEqual([GATEWAY, LEDGER]);
  return byFile;
}

/** The one decision this case is about, out of the import that recorded both. */
async function gatewayRule(): Promise<string> {
  return (await importedAndAccepted()).get(GATEWAY) as string;
}

/** Gives a rule an address under one relation. */
async function addressAt(rule: string, path: string, rel: string): Promise<void> {
  const linked = await mnema('link', rule, path, '--rel', rel);
  expect(linked.failed, linked.err.join(' / ')).toBe(false);
}

/** An agent connection over this project. */
function connect(): Session {
  return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
}

/** The two texts the hook reply carries for a path: the informing one, and the charge. */
function pushed(path: string): { context?: string; ask?: string } {
  const session = connect();
  const result = runRulesBeforeAnEditTool(session, { path });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error('unreachable');
  // Through JSON and back, because the host reads the SERIALIZED form.
  const reply = JSON.parse(JSON.stringify(result.value)) as Record<string, unknown>;
  const specific = reply['hookSpecificOutput'] as {
    hookEventName?: string;
    additionalContext?: string;
    permissionDecisionReason?: string;
  };
  expect(specific.hookEventName).toBe('PreToolUse');
  return {
    ...(specific.additionalContext !== undefined ? { context: specific.additionalContext } : {}),
    ...(specific.permissionDecisionReason !== undefined
      ? { ask: specific.permissionDecisionReason }
      : {}),
  };
}

/** The committed document, as bytes. */
async function briefText(): Promise<string> {
  const said = await mnema('brief');
  expect(said.failed, said.err.join(' / ')).toBe(false);
  return said.out.join('\n');
}

/**
 * Every provenance a text printed, taken out of its own bytes.
 *
 * It reads what was WRITTEN rather than asking the product a second time, which is the
 * whole point: a case that consulted the derivation again would prove the derivation
 * agrees with itself. The backticks of the document's code spans are stripped, because a
 * markdown delimiter is the document's and never part of a path.
 */
function provenancesIn(text: string): string[] {
  return [...text.matchAll(new RegExp(`${DERIVED_FROM} \`?([^\`\n]+?)\`?(?= ·|$)`, 'gm'))].map(
    (found) => found[1] as string,
  );
}

/** The rule bullets of the committed document, and nothing else it prints. */
function bullets(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('- **'));
}

/** Opens a project-relative path from disk, or throws naming it. */
function opened(relative: string): string {
  const full = join(repo, relative);
  if (!existsSync(full))
    throw new Error(`the channel printed a path that does not open: ${relative}`);
  return readFileSync(full, 'utf8');
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-citation-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'docs', 'adr'), { recursive: true });
  mkdirSync(join(repo, 'src', 'collate'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  writeFileSync(
    join(repo, 'docs', 'adr', GATEWAY),
    ['# ADR-008 — The gateway is idempotent', '', '## Context', '', GATEWAY_BODY, ''].join('\n'),
  );
  writeFileSync(
    join(repo, 'docs', 'adr', LEDGER),
    ['# ADR-011 — The ledger is append-only', '', '## Context', '', LEDGER_BODY, ''].join('\n'),
  );
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home'), xdgDataHome: join(sandbox, 'data') };
  process.chdir(repo);
  const initiated = await mnema('init');
  expect(initiated.failed, initiated.err.join(' / ')).toBe(false);
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('a rule that arrives unasked carries a path that opens', () => {
  it('opens from the committed document, each rule with its own source', async () => {
    const rules = await importedAndAccepted();
    const text = await briefText();

    // THE DIVERGENCE, asserted rather than assumed: the files say 008 and 011 and the
    // document cites ADR-1 and ADR-2. These are the records for which the item exists.
    // AND THE PAIRING IS ASSERTED, which is the half a field alone does not buy: each
    // bullet carries the source THAT rule came out of, so a derivation serving every
    // provenance the tree holds to every rule cannot pass here.
    // Sorted, because the ORDER of the two bullets is the document's own — most recently
    // settled first — and this case is about the PAIRING on each line, not about that.
    expect(bullets(text).sort()).toEqual(
      [
        `- **ADR-1 — The gateway is idempotent** · \`${rules.get(GATEWAY) ?? ''}\` · ${DERIVED_FROM} \`docs/adr/${GATEWAY}\``,
        `- **ADR-2 — The ledger is append-only** · \`${rules.get(LEDGER) ?? ''}\` · ${DERIVED_FROM} \`docs/adr/${LEDGER}\``,
      ].sort(),
    );
    // AND THEY OPEN. Not "a path is printed" — the bytes behind each are read back, and
    // they are the bytes of the document that rule was made from.
    expect(opened(`docs/adr/${GATEWAY}`)).toContain(GATEWAY_BODY);
    expect(opened(`docs/adr/${LEDGER}`)).toContain(LEDGER_BODY);
    expect(provenancesIn(text).sort()).toEqual([`docs/adr/${GATEWAY}`, `docs/adr/${LEDGER}`]);
  });

  it('opens from the rules pushed before an edit, per path', async () => {
    const rules = await importedAndAccepted();
    await addressAt(rules.get(GATEWAY) as string, 'src/collate', 'governs');
    await addressAt(rules.get(LEDGER) as string, 'src/ledger', 'governs');

    const collate = pushed('src/collate/fold.ts').context ?? '';
    expect(collate.split('\n')[2]).toBe(
      `“The gateway is idempotent” — governs src/collate · ${rules.get(GATEWAY) ?? ''} · ${DERIVED_FROM} docs/adr/${GATEWAY}`,
    );
    // THIS CHANNEL PRINTS NO LABEL AT ALL, so before this the uuid was the whole of what a
    // reader could follow, and it opens through this product alone — the door the reader
    // in the field does not take. The only `ADR-` on the line is inside the FILE NAME, and
    // it is the source's own number — 008, not the 1 the record froze. A case asserting the
    // absence of the string would now be asserting the absence of the fix.
    expect(collate).not.toContain('ADR-1 ');
    expect(collate).toContain('ADR-008');
    expect(opened(provenancesIn(collate)[0] as string)).toContain(GATEWAY_BODY);

    // The OTHER path gets the other rule's source, and neither leaks into the other.
    const ledger = pushed('src/ledger/append.ts').context ?? '';
    expect(provenancesIn(ledger)).toEqual([`docs/adr/${LEDGER}`]);
    expect(opened(provenancesIn(ledger)[0] as string)).toContain(LEDGER_BODY);
  });

  it('opens from the charge that stops a write, per path', async () => {
    // THE SITE THE ITEM DID NOT NAME, and the sharpest of the three: this text comes back
    // as the result of a REFUSED call, to a reader whose work has stopped and who is most
    // likely to want the argument before arguing with it.
    const rules = await importedAndAccepted();
    await addressAt(rules.get(GATEWAY) as string, 'src/collate', 'asks-for-a-person');
    await addressAt(rules.get(LEDGER) as string, 'src/ledger', 'asks-for-a-person');

    const collate = pushed('src/collate/fold.ts').ask ?? '';
    expect(collate.split('\n')[2]).toBe(
      `“The gateway is idempotent” — asks for a person at src/collate · ${rules.get(GATEWAY) ?? ''} · ${DERIVED_FROM} docs/adr/${GATEWAY}`,
    );
    expect(opened(provenancesIn(collate)[0] as string)).toContain(GATEWAY_BODY);
    expect(provenancesIn(pushed('src/ledger/append.ts').ask ?? '')).toEqual([`docs/adr/${LEDGER}`]);
  });
});

describe('what the channels say when the record asserts no provenance', () => {
  it('gives a rule decided here no provenance at all, on all three', async () => {
    // THE CONTRAST. Without it, a product that stamped the field on everything would pass
    // every case above. Absent, and the line is whole without it. Nothing is imported in
    // this case, so the ADRs on disk are a directory the record never read.
    const recorded = await mnema('decision', 'Queues are at-least-once', 'The broker says so.');
    expect(recorded.failed, recorded.err.join(' / ')).toBe(false);
    const rule = idIn(recorded);
    const accepted = await mnema('decision', 'move', 'accept', rule, '--note', 'agreed');
    expect(accepted.failed, accepted.err.join(' / ')).toBe(false);
    await addressAt(rule, 'src/collate', 'governs');
    await addressAt(rule, 'src/collate', 'asks-for-a-person');

    const text = await briefText();
    expect(text).toContain(`- **ADR-1 — Queues are at-least-once** · \`${rule}\``);
    expect(text).not.toContain(DERIVED_FROM);
    const { context, ask } = pushed('src/collate/fold.ts');
    expect((context ?? '').split('\n')[2]).toBe(
      `“Queues are at-least-once” — governs src/collate · ${rule}`,
    );
    expect((ask ?? '').split('\n')[2]).toBe(
      `“Queues are at-least-once” — asks for a person at src/collate · ${rule}`,
    );
  });
});

describe('a rule the record derives from more than one source', () => {
  it('carries every one of them, in the record’s own order, on one line', async () => {
    const rules = await importedAndAccepted();
    const gateway = rules.get(GATEWAY) as string;
    // A second source for ONE of the two rules, linked by hand — the shape a document that
    // MOVED leaves behind. Its target sorts BEFORE the imported one, so a channel taking
    // "the first row" and one taking "all of them" cannot agree by accident, and the rule
    // that did NOT get it says whether the extra source stayed where it was put.
    writeFileSync(join(repo, 'docs', 'adr', '0001-gateway-notes.md'), 'The notes.\n');
    await addressAt(gateway, 'docs/adr/0001-gateway-notes.md', 'derived-from');
    await addressAt(gateway, 'src/collate', 'governs');

    const both = ['docs/adr/0001-gateway-notes.md', `docs/adr/${GATEWAY}`];
    const text = await briefText();
    // The rule that got the second source carries both, in the record's own order — and
    // the rule that did not carries exactly one, which is what says the extra source
    // stayed where it was put.
    expect(bullets(text).map(provenancesIn).sort()).toEqual([both, [`docs/adr/${LEDGER}`]]);
    // ONE LINE PER RULE SURVIVES N SOURCES, which is the invariant the shape was chosen
    // for: two provenances are two FIELDS, never two bullets.
    expect(bullets(text)).toHaveLength(2);
    const { context } = pushed('src/collate/fold.ts');
    expect(provenancesIn(context ?? '')).toEqual(both);
    expect((context ?? '').split('\n')).toHaveLength(3);
    for (const path of both) expect(opened(path).length).toBeGreaterThan(0);
  });
});

describe('a provenance asserted privately about a public rule', () => {
  it('reaches none of the three, and `mnema refs` serves it', async () => {
    const rules = await importedAndAccepted();
    const gateway = rules.get(GATEWAY) as string;
    await addressAt(gateway, 'src/collate', 'governs');
    await addressAt(gateway, 'src/collate', 'asks-for-a-person');
    const hidden = await mnema(
      'link',
      gateway,
      'notes/why-i-really-did-it.md',
      '--rel',
      'derived-from',
      '--scope',
      'private',
    );
    expect(hidden.failed, hidden.err.join(' / ')).toBe(false);

    // A path of ONE machine, in a document that is committed and in a text pushed at
    // everybody's edit, would be a citation that resolves for exactly one reader.
    const { context, ask } = pushed('src/collate/fold.ts');
    expect(provenancesIn(await briefText()).sort()).toEqual([
      `docs/adr/${GATEWAY}`,
      `docs/adr/${LEDGER}`,
    ]);
    for (const served of [context ?? '', ask ?? '']) {
      expect(provenancesIn(served)).toEqual([`docs/adr/${GATEWAY}`]);
    }
    // NOT LOST, and this half is what makes the sentence above honest rather than a
    // silent drop: the read built to cross trees serves it.
    const refs = await mnema('refs', gateway);
    expect(refs.failed, refs.err.join(' / ')).toBe(false);
    expect(refs.out.join('\n')).toContain('notes/why-i-really-did-it.md');
  });
});

describe('the line of a pushed provenance is one line', () => {
  it('cannot be split in two by the target, on either channel', async () => {
    // THE N+1 SITE OF THE LINE RULE, and the two channels where it costs most. A
    // `derived-from` target reaches the chain without being checked to exist, so it is a
    // caller's string on exactly the terms the rule's name is — and on these channels a
    // second line would read as a rule this project never made, in a text that arrives
    // while code is being written or that explains why somebody's work stopped. The
    // committed document's half of this is in `presentation/one-line-per-item.test.ts`;
    // nothing there reaches a pushed text.
    const rule = await gatewayRule();
    await addressAt(rule, 'src/collate', 'governs');
    await addressAt(rule, 'src/collate', 'asks-for-a-person');
    // A target that would close its own field and open a whole forged rule under it.
    const forged = `docs/a.md${String.fromCharCode(10)}“forged” — governs src · forged-id`;
    await addressAt(rule, forged, 'derived-from');

    const { context, ask } = pushed('src/collate/fold.ts');
    for (const served of [context ?? '', ask ?? '']) {
      // Framing, the addressed line, one rule: three, whatever the record holds.
      expect(served.split(String.fromCharCode(10))).toHaveLength(3);
      expect(served).toContain('docs/a.md “forged” — governs src · forged-id');
    }
  });
});

describe('the word a provenance is introduced with has one source', () => {
  it('is read by no module of this surface that does not import it', () => {
    // THE DISCRIMINANT IS THE FIELD, NEVER THE PHRASE, and the first draft of this case
    // got it the other way round: it banned the words `derived from` from every string of
    // the surface and accused `commands/skill-export.ts` and `wiring/skill.ts`, where they
    // are plain English about a description taken from a body. A guard that fires on a
    // sentence is a guard about a language. What this one asks is the question that has an
    // answer: a module that READS a record's provenance must say the word out of the one
    // place the word lives, so a fifth channel cannot introduce the same fact in words of
    // its own.
    const reads = sourceFiles(SOURCE).filter((file) =>
      /\borigin\b\s*(?:\?\?|\)|,)/.test(withoutComments(readFileSync(file, 'utf8'))),
    );
    const without = reads.filter(
      (file) => !/from '(?:\.\.?\/)+provenance\.js'/.test(readFileSync(file, 'utf8')),
    );
    expect(without.map((file) => file.slice(SOURCE.length + 1))).toEqual([]);
    // NOT VACUOUS, in the two ways it could be: the sweep finds the four printers there
    // are, and it is the four this delivery names.
    expect(reads.map((file) => file.slice(SOURCE.length + 1)).sort()).toEqual([
      'edit-asks-a-person.ts',
      'edit-rules-push.ts',
      'presentation/brief.ts',
      'presentation/record.ts',
    ]);
  });

  it('is what every one of the four actually prints', async () => {
    // The other half, and without it the case above passes on four modules that import a
    // constant and print something else. Asserted on the BYTES of all four channels — the
    // three that push and the read that serves one record whole.
    const rule = await gatewayRule();
    await addressAt(rule, 'src/collate', 'governs');
    await addressAt(rule, 'src/collate', 'asks-for-a-person');
    const shown = await mnema('show', rule);
    const expected = [`docs/adr/${GATEWAY}`];
    expect(shown.failed, shown.err.join(' / ')).toBe(false);
    const { context, ask } = pushed('src/collate/fold.ts');
    // The document carries both rules; the two pushed texts and `show` carry the one this
    // case addressed and asked about.
    expect(provenancesIn(await briefText()).sort()).toEqual([...expected, `docs/adr/${LEDGER}`]);
    for (const served of [context ?? '', ask ?? '', shown.out.join('\n')]) {
      expect(provenancesIn(served)).toEqual(expected);
    }
  });
});

/** The source with comments blanked, so a word explained in prose is not a word printed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
