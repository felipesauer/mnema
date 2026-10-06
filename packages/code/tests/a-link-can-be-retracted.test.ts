/**
 * A link can be retracted, on both surfaces: `mnema unlink` and the `retract_link` tool.
 *
 * Driven the way the binary and an agent drive them, over a real project in a sandbox. Held:
 *   - a rule linked to a path refuses a write there, and once its only link is taken back the
 *     hook that runs before a write answers `{}` — the rule stopped acting;
 *   - the edge is named as the link took it, an `ADR-<n>` label included, and the link's own
 *     event stays in the record beside the retraction;
 *   - an edge nobody linked, and one already taken back, are refused and append nothing.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { runUnlink } from '../src/commands/unlink.js';
import { openSession } from '../src/mcp/session.js';
import { runRetractLink } from '../src/mcp/tools.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;

interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

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

async function did(...argv: string[]): Promise<Said> {
  const said = await mnema(...argv);
  expect(said.failed, `mnema ${argv.join(' ')}: ${said.err.join(' / ')}`).toBe(false);
  return said;
}

function idIn(said: Said): string {
  const id = said.out
    .join('\n')
    .match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said.out.join(' / ')}`);
  return id;
}

function publicEvents(): CatalogEvent[] {
  const root = resolveTrees(repo, env).projectPublic as string;
  return orderedEvents({ root }, catalogUpcasters());
}

const kinds = (kind: string): number => publicEvents().filter((e) => e.kind === kind).length;

/** What the hook answers before Cursor writes `relative`, as the host parses it. */
function beforeAWrite(relative: string): unknown {
  const payload = JSON.stringify({
    hook_event_name: 'preToolUse',
    cursor_version: '2026.09.18',
    tool_name: 'Write',
    tool_input: { file_path: join(repo, relative), content: 'export const probe = 1;\n' },
    workspace_roots: [repo],
  });
  const done = runBeforeAWrite({ cwd: repo, env }, { host: 'cursor', payload });
  return JSON.parse(JSON.stringify(done.reply));
}

/** An accepted rule, linked to `path` under `rel`. */
async function ruleAt(path: string, rel: string): Promise<string> {
  const id = idIn(await did('decision', 'record', 'Billing is frozen', 'Until the audit closes'));
  await did('decision', 'move', 'accept', id, '--note', 'agreed');
  await did('link', id, path, '--rel', rel);
  return id;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-unlink-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  process.env.HOME = join(sandbox, 'home');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await did('init');
});

afterEach(() => {
  delete process.env.MNEMA_RUN;
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

const WHY = 'The freeze is on the ledger, not on billing';

describe('mnema unlink', () => {
  it('takes the only link of a rule back, and the hook before a write answers {}', async () => {
    const rule = await ruleAt('src/billing', 'refuses-a-write');
    expect(beforeAWrite('src/billing/total.ts')).not.toEqual({});

    const said = await did(
      'unlink',
      rule,
      'src/billing',
      '--rel',
      'refuses-a-write',
      '--reason',
      WHY,
    );
    expect(said.out.join('\n')).toContain(`Retracted link ${rule} —refuses-a-write→ src/billing`);
    expect(beforeAWrite('src/billing/total.ts')).toEqual({});
    // Nothing was erased: the link is still on the record, beside the fact that took it back.
    expect(kinds('knowledge.linked')).toBe(1);
    expect(kinds('link.retracted')).toBe(1);

    const again = await mnema(
      'unlink',
      rule,
      'src/billing',
      '--rel',
      'refuses-a-write',
      '--reason',
      WHY,
    );
    expect(again.failed).toBe(true);
    expect(again.err.join('\n')).toContain('ALREADY_RETRACTED');
    expect(kinds('link.retracted')).toBe(1);
  });

  it('refuses an edge nobody linked, saying so, and appends nothing', async () => {
    const rule = await ruleAt('src/billing', 'refuses-a-write');
    const before = publicEvents().length;
    const said = await mnema(
      'unlink',
      rule,
      'src/ledger',
      '--rel',
      'refuses-a-write',
      '--reason',
      WHY,
    );
    expect(said.failed).toBe(true);
    expect(said.err.join('\n')).toContain('No link');
    // And the function the verb calls, asked the same, says the same as data.
    const edge = { subject: rule, target: 'src/ledger', rel: 'refuses-a-write', reason: WHY };
    expect(runUnlink({ cwd: repo, env }, edge)).toEqual({ ok: false, reason: 'UNKNOWN_LINK' });
    expect(publicEvents()).toHaveLength(before);
  });
});

describe('the retract_link tool', () => {
  it('takes a link back by the label it was linked by, and the rule stops acting', async () => {
    await ruleAt('src/billing', 'refuses-a-write');
    const session = openSession({
      clientName: 'agent-alpha',
      roots: [pathToFileURL(repo).href],
      env,
    });
    const result = runRetractLink(session, {
      subject: 'ADR-1',
      target: 'src/billing',
      rel: 'refuses-a-write',
      reason: WHY,
    });
    expect(result).toMatchObject({ ok: true, target: 'src/billing', rel: 'refuses-a-write' });
    expect(beforeAWrite('src/billing/total.ts')).toEqual({});

    const unknown = runRetractLink(session, {
      subject: 'ADR-1',
      target: 'src/billing',
      rel: 'governs',
      reason: WHY,
    });
    expect(unknown).toMatchObject({ ok: false, code: 'UNKNOWN_LINK' });
  });
});
