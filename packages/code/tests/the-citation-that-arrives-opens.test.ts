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
 * address and a uuid, with `read_record` the only way to reach the argument. Four
 * measurements of this bench say that tool is not called.
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

/** Imports the ADR directory for real, accepts the one decision, and returns its id. */
async function importedAndAccepted(): Promise<string> {
  const imported = await mnema('decision', 'import', 'docs/adr', '--write');
  expect(imported.failed, imported.err.join(' / ')).toBe(false);
  const id = idIn(imported);
  // A decision an import proposes is born `proposed` — structurally, because a repository
  // that already decided is not this product's to accept on its behalf — so it has to be
  // accepted before any of these channels carries it at all.
  const accepted = await mnema('decision', 'move', 'accept', id, '--note', 'still holds');
  expect(accepted.failed, accepted.err.join(' / ')).toBe(false);
  return id;
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
  it('opens from the committed document', async () => {
    const rule = await importedAndAccepted();
    const text = await briefText();

    // THE DIVERGENCE, asserted rather than assumed: the file says 008 and the document
    // cites ADR-1. This is the record for which the whole item exists.
    expect(text).toContain('**ADR-1 — The gateway is idempotent**');
    expect(text).not.toContain('ADR-008 —');
    // ONE LINE still holds: the rule, its id and its provenance are one bullet.
    const bullet = text.split('\n').filter((line) => line.startsWith('- **'));
    expect(bullet).toEqual([
      `- **ADR-1 — The gateway is idempotent** · \`${rule}\` · ${DERIVED_FROM} \`docs/adr/${GATEWAY}\``,
    ]);
    // AND IT OPENS. Not "a path is printed" — the bytes behind it are read back.
    expect(opened(provenancesIn(text)[0] as string)).toContain(GATEWAY_BODY);
  });

  it('opens from the rules pushed before an edit', async () => {
    const rule = await importedAndAccepted();
    await addressAt(rule, 'src/collate', 'governs');
    const { context } = pushed('src/collate/fold.ts');

    const line = (context ?? '').split('\n')[2];
    expect(line).toBe(
      `“The gateway is idempotent” — governs src/collate · ${rule} · ${DERIVED_FROM} docs/adr/${GATEWAY}`,
    );
    // THIS CHANNEL PRINTS NO LABEL AT ALL, so before this the uuid was the whole of what a
    // reader could follow, through the one tool the measurements say is not called. The
    // only `ADR-` on the line is inside the FILE NAME, and it is the source's own number —
    // 008, not the 1 the record froze. A case asserting the absence of the string would
    // now be asserting the absence of the fix.
    expect(context).not.toContain('ADR-1 ');
    expect(context).toContain('ADR-008');
    expect(opened(provenancesIn(context ?? '')[0] as string)).toContain(GATEWAY_BODY);
  });

  it('opens from the charge that stops a write', async () => {
    // THE SITE THE ITEM DID NOT NAME, and the sharpest of the three: this text comes back
    // as the result of a REFUSED call, to a reader whose work has stopped and who is most
    // likely to want the argument before arguing with it.
    const rule = await importedAndAccepted();
    await addressAt(rule, 'src/collate', 'asks-for-a-person');
    const { ask } = pushed('src/collate/fold.ts');

    const line = (ask ?? '').split('\n')[2];
    expect(line).toBe(
      `“The gateway is idempotent” — asks for a person at src/collate · ${rule} · ${DERIVED_FROM} docs/adr/${GATEWAY}`,
    );
    expect(opened(provenancesIn(ask ?? '')[0] as string)).toContain(GATEWAY_BODY);
  });
});

describe('what the channels say when the record asserts no provenance', () => {
  it('gives a rule decided here no provenance at all, on all three', async () => {
    // THE CONTRAST. Without it, a product that stamped the field on everything would pass
    // every case above. Absent, and the line is whole without it.
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
    const rule = await importedAndAccepted();
    // A second source, linked by hand — the shape a document that MOVED leaves behind.
    // Its target sorts BEFORE the imported one, so a channel taking "the first row" and
    // one taking "all of them" cannot agree by accident.
    writeFileSync(join(repo, 'docs', 'adr', '0001-gateway-notes.md'), 'The notes.\n');
    await addressAt(rule, 'docs/adr/0001-gateway-notes.md', 'derived-from');
    await addressAt(rule, 'src/collate', 'governs');

    const expected = ['docs/adr/0001-gateway-notes.md', `docs/adr/${GATEWAY}`];
    const text = await briefText();
    expect(provenancesIn(text)).toEqual(expected);
    // ONE LINE PER RULE SURVIVES N SOURCES, which is the invariant the shape was chosen
    // for: two provenances are two FIELDS, never two bullets.
    expect(text.split('\n').filter((line) => line.startsWith('- **'))).toHaveLength(1);
    const { context } = pushed('src/collate/fold.ts');
    expect(provenancesIn(context ?? '')).toEqual(expected);
    expect((context ?? '').split('\n')).toHaveLength(3);
    for (const path of expected) expect(opened(path).length).toBeGreaterThan(0);
  });
});

describe('a provenance asserted privately about a public rule', () => {
  it('reaches none of the three, and `mnema refs` serves it', async () => {
    const rule = await importedAndAccepted();
    await addressAt(rule, 'src/collate', 'governs');
    await addressAt(rule, 'src/collate', 'asks-for-a-person');
    const hidden = await mnema(
      'link',
      rule,
      'notes/why-i-really-did-it.md',
      '--rel',
      'derived-from',
      '--scope',
      'private',
    );
    expect(hidden.failed, hidden.err.join(' / ')).toBe(false);

    // A path of ONE machine, in a document that is committed and in a text pushed at
    // everybody's edit, would be a citation that resolves for exactly one reader.
    const text = await briefText();
    const { context, ask } = pushed('src/collate/fold.ts');
    for (const served of [text, context ?? '', ask ?? '']) {
      expect(provenancesIn(served)).toEqual([`docs/adr/${GATEWAY}`]);
    }
    // NOT LOST, and this half is what makes the sentence above honest rather than a
    // silent drop: the read built to cross trees serves it.
    const refs = await mnema('refs', rule);
    expect(refs.failed, refs.err.join(' / ')).toBe(false);
    expect(refs.out.join('\n')).toContain('notes/why-i-really-did-it.md');
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
    const rule = await importedAndAccepted();
    await addressAt(rule, 'src/collate', 'governs');
    await addressAt(rule, 'src/collate', 'asks-for-a-person');
    const shown = await mnema('show', rule);
    expect(shown.failed, shown.err.join(' / ')).toBe(false);
    const { context, ask } = pushed('src/collate/fold.ts');
    for (const served of [await briefText(), context ?? '', ask ?? '', shown.out.join('\n')]) {
      expect(provenancesIn(served)).toEqual([`docs/adr/${GATEWAY}`]);
    }
  });
});

/** The source with comments blanked, so a word explained in prose is not a word printed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
