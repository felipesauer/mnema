/**
 * A RULE THE PROJECT INHERITS REACHES THE PATH IT ADDRESSES: `mnema rules`, `mnema why`, the
 * `governing_rules` tool, and the gate before a write, at each door.
 *
 * The origin is a local git repository built in the sandbox with the product's own commands: an
 * organization's record with a rule that governs `src`, one that refuses a write at `CHANGELOG.md`,
 * one that asks for a person at `package.json`, and an address at a path this project does not
 * hold. The project points at it with `mnema inherit set` and has a rule of its own at `src`.
 *
 * What is asserted is what a reader sees: the inherited rule is listed beside the project's own,
 * each saying where it comes from (the origin and the pinned commit), and neither chosen over the
 * other; a rule of the origin that refuses or asks applies as the project's would, naming its
 * origin; an inherited address that names nothing in this project is not a stale address of the
 * project; and a record that does not verify at the pinned commit governs nothing, and that is said.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type CatalogEvent, catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBeforeAWrite } from '../src/commands/before-a-write.js';
import { runRules } from '../src/commands/rules.js';
import { runWhy } from '../src/commands/why.js';
import { inheritedNotReadLine, readProjectInherited } from '../src/inherited-record.js';
import { openSession } from '../src/mcp/session.js';
import {
  governingRulesInheritedNotRead,
  runGoverningRulesTool,
  runRulesBeforeAnEditTool,
} from '../src/mcp/tools.js';
import { whyReport } from '../src/presentation/git-bridge.js';
import { renderPlain } from '../src/presentation/plain.js';
import { rulesReport } from '../src/presentation/rules.js';
import { type CliIo, run } from '../src/program.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

let sandbox: string;
let org: string;
let repo: string;
let env: DiscoveryEnv;
let pinned: string;
let originalCwd: string;
let originalHome: string | undefined;
let orgGoverns: string;
let orgRefuses: string;
let orgAsks: string;
let ownRule: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    {
      cwd,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(sandbox, 'git-home'),
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
        GIT_CONFIG_NOSYSTEM: '1',
      },
      encoding: 'utf8',
    },
  ).trim();
}

/** Runs `mnema <argv>` in process, in `cwd`, and refuses to continue if it failed: setup. */
async function did(cwd: string, ...argv: string[]): Promise<string> {
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
  process.chdir(cwd);
  await run(argv, io);
  expect(failed, `${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
  return out.join('\n');
}

/** A decision accepted in the record at `cwd`, linked to a path under a relation. */
async function ruleAt(cwd: string, title: string, path: string, rel: string): Promise<string> {
  const said = await did(
    cwd,
    'decision',
    'record',
    title,
    `why ${title}`,
    '--alternatives',
    `not ${title}`,
  );
  const id = said.match(/\(([0-9a-f-]{20,})\)/)?.[1];
  if (id === undefined) throw new Error(`setup: no id in ${said}`);
  await did(cwd, 'decision', 'move', 'accept', id, '--note', 'agreed');
  await did(cwd, 'link', id, path, '--rel', rel);
  return id;
}

/** The refusals and askings the project's public tree holds, as `kind rule @ path`. */
function charges(): string[] {
  const events: CatalogEvent[] = orderedEvents(
    { root: resolveTrees(repo, env).projectPublic as string },
    catalogUpcasters(),
  );
  return events.flatMap((event) =>
    event.kind === 'channel.refused' || event.kind === 'channel.asked'
      ? [`${event.kind} ${event.payload.rule} @ ${event.payload.path}`]
      : [],
  );
}

/** The host's write of `relative`, as VS Code hands the command hook. */
function vscode(relative: string): Record<string, unknown> {
  const done = runBeforeAWrite(
    { cwd: repo, env },
    {
      host: 'vscode',
      payload: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'create_file',
        tool_input: { filePath: join(repo, relative), content: 'x\n' },
        cwd: repo,
      }),
    },
  );
  const specific = (done.reply as Record<string, unknown>)['hookSpecificOutput'] as
    | Record<string, string>
    | undefined;
  return specific ?? {};
}

function session() {
  return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
}

/** What the MCP tool the host's hook calls answers for a path. */
function tool(path: string): Record<string, string> {
  const result = runRulesBeforeAnEditTool(session(), { path });
  if (!result.ok) throw new Error(JSON.stringify(result));
  const reply = JSON.parse(JSON.stringify(result.value)) as Record<string, unknown>;
  return (reply['hookSpecificOutput'] as Record<string, string> | undefined) ?? {};
}

/** How a line names the origin of an inherited rule. */
const fromTheOrg = (): string => `inherited from ${org} at ${pinned.slice(0, 12)}`;

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-inherited-rule-'));
  org = join(sandbox, 'org');
  repo = join(sandbox, 'repo');
  mkdirSync(org, { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'CHANGELOG.md'), '# changes\n');
  writeFileSync(join(repo, 'package.json'), '{}\n');
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  process.env.HOME = join(sandbox, 'home');
  mkdirSync(process.env.HOME, { recursive: true });
  env = { home: process.env.HOME };
  git(org, 'init', '-q', '-b', 'main');
  await did(org, 'init');
  orgGoverns = await ruleAt(org, 'TypeScript runs in strict mode', 'src', 'governs');
  await did(org, 'link', orgGoverns, 'packages/php/src', '--rel', 'governs');
  orgRefuses = await ruleAt(org, 'Release output is not edited', 'CHANGELOG.md', 'refuses-a-write');
  await did(org, 'link', orgRefuses, 'generated', '--rel', 'refuses-a-write');
  orgAsks = await ruleAt(org, 'No production dependency', 'package.json', 'asks-for-a-person');
  git(org, 'add', '.mnema');
  git(org, 'commit', '-q', '-m', 'org rules');
  pinned = git(org, 'rev-parse', 'HEAD');
  await did(repo, 'init');
  ownRule = await ruleAt(repo, 'Bill in UTC', 'src', 'governs');
  await did(repo, 'inherit', 'set', org, '--write');
}, 60_000);

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the inherited reading keeps the decision whole', () => {
  it('carries the rationale, the alternatives, the state, who accepted and the addresses', () => {
    const reading = readProjectInherited(resolveTrees(repo, env));
    expect(reading?.state).toBe('read');
    if (reading?.state !== 'read') return;
    const rule = reading.decisions.find((one) => one.id === orgGoverns);
    expect(rule).toMatchObject({
      title: 'TypeScript runs in strict mode',
      rationale: 'why TypeScript runs in strict mode',
      alternatives: 'not TypeScript runs in strict mode',
      state: 'accepted',
    });
    expect(rule?.acceptance).toBeDefined();
    expect(rule?.addresses).toEqual([
      { rel: 'governs', target: 'packages/php/src' },
      { rel: 'governs', target: 'src' },
    ]);
    const refusing = reading.decisions.find((one) => one.id === orgRefuses);
    expect(refusing?.addresses).toEqual([
      { rel: 'refuses-a-write', target: 'CHANGELOG.md' },
      { rel: 'refuses-a-write', target: 'generated' },
    ]);
  });
});

describe('mnema rules', () => {
  it('lists the inherited rule beside the project rule, each with where it comes from', () => {
    const done = runRules({ cwd: repo, env }, { path: 'src/a.ts' });
    if (!done.ok) throw new Error('refused');
    const rules = done.governed.rules.map((rule) => [rule.rule, rule.inherited]);
    expect(rules).toEqual(
      expect.arrayContaining([
        [ownRule, undefined],
        [orgGoverns, { origin: org, commit: pinned }],
      ]),
    );
    expect(done.governed.counts.matching).toBe(2);
    const page = rulesReport(renderPlain, done.governed).join('\n');
    const orgRow = page.split('\n').find((line) => line.includes(orgGoverns)) ?? '';
    const ownRow = page.split('\n').find((line) => line.includes(ownRule)) ?? '';
    expect(orgRow).toContain(fromTheOrg());
    expect(ownRow).not.toContain('inherited');
  });

  it('does not count an inherited address this project does not hold as stale here', () => {
    const done = runRules({ cwd: repo, env }, { path: 'src/a.ts' });
    if (!done.ok) throw new Error('refused');
    expect(done.governed.stale).toEqual([]);
    expect(done.governed.counts.stale).toBe(0);
    expect(done.governed.inherited).toEqual({
      from: { origin: org, commit: pinned },
      addressed: 5,
      governs: 2,
      asks: 1,
      refuses: 2,
      elsewhere: 2,
    });
    const page = rulesReport(renderPlain, done.governed).join('\n');
    expect(page).toContain(
      `${fromTheOrg()}: 5 addresses (2 govern, 1 asks for a person, 2 refuse a write), ` +
        '2 name nothing in this project',
    );
  });

  it('counts under "in this project" only the addresses of the project record', () => {
    const done = runRules({ cwd: repo, env }, { path: 'CHANGELOG.md' });
    if (!done.ok) throw new Error('refused');
    expect(done.governed.counts.refuses).toEqual({
      matching: 1,
      addressed: 0,
      stale: 0,
      unresolved: 0,
    });
    expect(done.governed.counts.governing).toBe(1);
    const page = rulesReport(renderPlain, done.governed).join('\n');
    expect(page).toContain('1 refuse a write here · 0 refuse in this project');
    expect(page).toContain('1 address this project');
  });

  it('lists the inherited rule that refuses a write and the one that asks for a person', () => {
    const refused = runRules({ cwd: repo, env }, { path: 'CHANGELOG.md' });
    const asked = runRules({ cwd: repo, env }, { path: 'package.json' });
    if (!refused.ok || !asked.ok) throw new Error('refused');
    expect(refused.governed.refuses.map((rule) => rule.rule)).toEqual([orgRefuses]);
    expect(asked.governed.asks.map((rule) => rule.rule)).toEqual([orgAsks]);
  });
});

describe('mnema why and governing_rules', () => {
  it('why lists the inherited rule with its origin', () => {
    const done = runWhy({ cwd: repo, env }, { target: 'src/a.ts' });
    if (!done.ok || done.about !== 'file') throw new Error('refused');
    expect(done.rules.map((rule) => [rule.id, rule.inherited])).toEqual(
      expect.arrayContaining([
        [ownRule, undefined],
        [orgGoverns, { origin: org, commit: pinned }],
      ]),
    );
    const page = whyReport(renderPlain, done).join('\n');
    expect(page.split('\n').find((line) => line.includes(orgGoverns))).toContain(fromTheOrg());
  });

  it('governing_rules lists it with its origin', () => {
    const result = runGoverningRulesTool(session(), { path: 'src/a.ts' });
    if (!result.ok) throw new Error('refused');
    const inherited = result.value.rules.find((rule) => rule.rule === orgGoverns);
    expect(inherited?.inherited).toEqual({ origin: org, commit: pinned });
    expect(result.value.rules.find((rule) => rule.rule === ownRule)?.inherited).toBeUndefined();
  });
});

describe('the gate before a write', () => {
  it('the command hook refuses where an inherited rule refuses, naming its origin, and records it', () => {
    const said = vscode('CHANGELOG.md');
    expect(said['permissionDecision']).toBe('deny');
    expect(said['permissionDecisionReason']).toContain(orgRefuses);
    expect(said['permissionDecisionReason']).toContain(fromTheOrg());
    expect(said['permissionDecisionReason']).toContain(
      'A rule addressed here by the record this project inherits refuses a write at CHANGELOG.md',
    );
    expect(charges()).toEqual([`channel.refused ${orgRefuses} @ CHANGELOG.md`]);
  });

  it('refuses a write that creates a file under an inherited address the project does not hold yet', () => {
    expect(vscode('generated/out.js')['permissionDecision']).toBe('deny');
    expect(charges()).toEqual([`channel.refused ${orgRefuses} @ generated/out.js`]);
  });

  it('the command hook asks where an inherited rule asks for a person', () => {
    const said = vscode('package.json');
    expect(said['permissionDecision']).toBe('ask');
    expect(said['permissionDecisionReason']).toContain(orgAsks);
    expect(said['permissionDecisionReason']).toContain(
      'A rule addressed here by the record this project inherits asks that a person look at package.json',
    );
    expect(said['permissionDecisionReason']).toContain(fromTheOrg());
  });

  it('the MCP tool refuses by the inherited rule, and pushes it beside the project rule', () => {
    const refused = tool('CHANGELOG.md');
    expect(refused['permissionDecision']).toBe('deny');
    expect(refused['permissionDecisionReason']).toContain(orgRefuses);
    const pushed = tool('src/a.ts')['additionalContext'] ?? '';
    expect(pushed).toContain(ownRule);
    expect(pushed).toContain(orgGoverns);
    const line = pushed.split('\n').find((one) => one.includes(orgGoverns)) ?? '';
    expect(line).toContain(fromTheOrg());
  });

  it('reads the project switches and never the origin switches', async () => {
    await did(org, 'switch', 'off', 'edit-refuses-a-write');
    git(org, 'add', '.mnema');
    git(org, 'commit', '-q', '-m', 'the origin switches its refusals off');
    await did(repo, 'inherit', 'update', '--to', 'main', '--write');
    expect(vscode('CHANGELOG.md')['permissionDecision']).toBe('deny');
    expect(tool('CHANGELOG.md')['permissionDecision']).toBe('deny');
    await did(repo, 'switch', 'off', 'edit-refuses-a-write');
    expect(vscode('CHANGELOG.md')['permissionDecision']).toBeUndefined();
  }, 30_000);

  it('says nothing more where no inherited rule addresses the path', () => {
    expect(vscode('src/a.ts')).toEqual({});
  });
});

describe('an address the origin writes for a rule of the project', () => {
  /**
   * The origin links a rule THE PROJECT holds: the rule is the project's, the address is the
   * origin's, so every line it reaches says it was inherited, and the rule still opens here.
   */
  beforeEach(async () => {
    writeFileSync(join(repo, 'README.md'), '# repo\n');
    mkdirSync(join(repo, 'docs'), { recursive: true });
    await did(org, 'link', ownRule, 'README.md', '--rel', 'refuses-a-write');
    await did(org, 'link', ownRule, 'docs', '--rel', 'asks-for-a-person');
    git(org, 'add', '.mnema');
    git(org, 'commit', '-q', '-m', 'the origin addresses a rule of the project');
    pinned = git(org, 'rev-parse', 'HEAD');
    await did(repo, 'inherit', 'update', '--to', 'main', '--write');
  }, 30_000);

  it('the refusal names the origin as where the address comes from', () => {
    const said = vscode('README.md');
    expect(said['permissionDecision']).toBe('deny');
    const reason = said['permissionDecisionReason'] ?? '';
    expect(reason).toContain(
      'A rule addressed here by the record this project inherits refuses a write at README.md',
    );
    expect(reason.split('\n').find((line) => line.includes(ownRule))).toContain(fromTheOrg());
    expect(reason).toContain(`The rule opens with \`mnema show ${ownRule}\``);
    const done = runRules({ cwd: repo, env }, { path: 'README.md' });
    if (!done.ok) throw new Error('refused');
    expect(done.governed.refuses.map((rule) => [rule.rule, rule.inherited])).toEqual([
      [ownRule, { origin: org, commit: pinned }],
    ]);
    const page = rulesReport(renderPlain, done.governed).join('\n');
    expect(page.split('\n').find((line) => line.includes(ownRule))).toContain(fromTheOrg());
  });

  it('the asking names the origin as where the address comes from', () => {
    const said = vscode('docs/guide.md');
    expect(said['permissionDecision']).toBe('ask');
    const reason = said['permissionDecisionReason'] ?? '';
    expect(reason).toContain(
      'A rule addressed here by the record this project inherits asks that a person look at docs/guide.md',
    );
    expect(reason.split('\n').find((line) => line.includes(ownRule))).toContain(fromTheOrg());
  });

  it('the address the project holds for the same rule stays its own', () => {
    const done = runRules({ cwd: repo, env }, { path: 'src/a.ts' });
    if (!done.ok) throw new Error('refused');
    expect(done.governed.rules.find((rule) => rule.rule === ownRule)?.inherited).toBeUndefined();
  });
});

describe('where a refused write is told the rule opens', () => {
  it('names the origin for a rule only the inherited record holds, never a show that finds nothing', () => {
    const reason = vscode('CHANGELOG.md')['permissionDecisionReason'] ?? '';
    expect(reason).not.toContain(`The rule opens with \`mnema show ${orgRefuses}\``);
    expect(reason).toContain(
      `The rule is held by the record this project inherits, not by its own: \`mnema show ${orgRefuses}\` opens it in a clone of ${org} at ${pinned.slice(0, 12)}`,
    );
  });
});

describe('the brief', () => {
  it('counts what the inherited record addresses here, and scopes its own counts to the project', async () => {
    const page = await did(repo, 'brief');
    expect(page).toContain('0 of them refuse a WRITE at an address');
    expect(page).not.toContain('Nothing waits for a file none of them asks about.');
    const flat = page.replace(/\n/g, ' ');
    expect(flat).toContain(
      'The record this project inherits places rules at addresses here too: 1 governs, ' +
        '1 asks for a PERSON and 1 refuses a WRITE.',
    );
    expect(flat).toContain('The counts above are this project’s own rules alone.');
  });
});

describe('an inherited record that does not verify', () => {
  it('governs nothing, and the reading says why', async () => {
    const tails = join(org, '.mnema', 'tails');
    const segment = readdirSync(tails, { recursive: true, encoding: 'utf8' }).find((file) =>
      file.endsWith('000001.jsonl'),
    ) as string;
    const file = join(tails, segment);
    writeFileSync(file, readFileSync(file, 'utf8').replace('strict mode', 'loose mode'));
    git(org, 'add', '.mnema');
    git(org, 'commit', '-q', '-m', 'tampered');
    const tampered = git(org, 'rev-parse', 'HEAD');
    const copies = join(env.home as string, '.mnema', 'inherited');
    const [digest] = readdirSync(copies);
    git(join(copies, digest as string, 'repo.git'), 'fetch', '-q', org, tampered);
    writeFileSync(
      join(repo, '.mnema', 'inherit.json'),
      JSON.stringify({ origin: org, commit: tampered }),
    );
    const done = runRules({ cwd: repo, env }, { path: 'src/a.ts' });
    if (!done.ok) throw new Error('refused');
    expect(done.governed.rules.map((rule) => rule.rule)).toEqual([ownRule]);
    expect(done.inherited?.state).toBe('unverified');
    expect(inheritedNotReadLine(done.inherited)).toContain(
      `No rule of the record this project inherits governs here: ${org} at ${tampered.slice(0, 12)} was not read`,
    );
    expect(governingRulesInheritedNotRead(session())).toEqual([
      inheritedNotReadLine(done.inherited),
    ]);
    expect(vscode('CHANGELOG.md')).toEqual({});
    expect(tool('CHANGELOG.md')['permissionDecision']).toBeUndefined();
  }, 30_000);
});
