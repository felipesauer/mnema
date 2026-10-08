/**
 * A rule in force says WHO accepted it, and an agent may accept freely — with the trail, a
 * notice, and a switch for whoever wants it off.
 *
 * THE DEFECT, MEASURED ON THE SHIPPED BINARY. A second clone — a key of its own, an identity of
 * its own, `verify --require signed` green — recorded a decision whose title was an instruction
 * to a model and ACCEPTED it itself. After the pull it opened the victim's `brief` under
 * *Decisions in force*, with no author, and it was the only rule in force there, because the
 * victim's own decisions were still proposed.
 *
 * WHAT WAS DECIDED, and what this holds:
 *   - each rule in force names the identity that accepted it, and whether the act had an agent
 *     on it (`a person` is an act with none, not a claim about the human);
 *   - an identity that accepted without any other identity ever ruling with it is MARKED, and the
 *     mark leaves the day another identity accepts one of its decisions or has one of its own
 *     accepted — it is the record's shape, never a verdict on the rule;
 *   - an agent may accept: through the MCP server and through `--which`, with the trail on the
 *     envelope (nothing new is written), said in the reply, said by `show`, said by the next
 *     opening;
 *   - and `mnema switch off agent-accepts` is the setting: with it off an agent's accept is
 *     refused, in words that say how to turn it back on, and a person's still lands.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMcpServer } from '../src/mcp/server.js';
import { GIT_WITHOUT_MAINTENANCE } from './support/git-without-maintenance.js';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-who-ruled-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function home(name: string): string {
  const dir = join(sandbox, `home ${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function mnema(dir: string, homeDir: string, ...argv: string[]) {
  const ran = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: dir,
    encoding: 'utf-8',
    env: { PATH: process.env.PATH ?? '', HOME: homeDir },
  });
  return {
    status: ran.status,
    stdout: ran.stdout,
    stderr: ran.stderr,
    out: ran.stdout + ran.stderr,
  };
}

function git(dir: string, ...args: string[]): string {
  const ran = spawnSync(
    'git',
    [
      '-c',
      'user.name=mnema test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      '-c',
      'pull.rebase=false',
      ...args,
    ],
    {
      cwd: dir,
      encoding: 'utf-8',
      env: {
        PATH: process.env.PATH ?? '',
        HOME: join(sandbox, 'git'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: GIT_WITHOUT_MAINTENANCE,
      },
    },
  );
  if (ran.status !== 0) throw new Error(`setup: git ${args.join(' ')} in ${dir}: ${ran.stderr}`);
  return ran.stdout;
}

function checkout(remote: string, name: string): string {
  const to = join(sandbox, 'checkouts', name);
  mkdirSync(join(sandbox, 'checkouts'), { recursive: true });
  git(sandbox, 'clone', '-q', remote, to);
  return to;
}

function pull(dir: string): void {
  git(dir, 'pull', '-q', '--no-edit', 'origin', 'main');
}

function share(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'the record');
  if (git(dir, 'ls-remote', '--heads', 'origin', 'main').trim() !== '') pull(dir);
  git(dir, 'push', '-q', 'origin', 'HEAD:main');
}

function idOf(printed: string): string {
  const id = /[0-9a-f]{8}-[0-9a-f-]{27}/.exec(printed)?.[0];
  expect(id, printed).toBeDefined();
  return id as string;
}

/** The identity `homeDir` writes as, in the short form the readings print. */
function shortIdentity(dir: string, homeDir: string): string {
  const listed = mnema(dir, homeDir, 'audit', 'accountability');
  const all = [...listed.out.matchAll(/mnid:[0-9a-f]{8}/g)].map((one) => one[0]);
  expect(all.length, listed.out).toBeGreaterThan(0);
  return all[0] as string;
}

/**
 * Two machines on one repository, the way a team is: A founds and shares; B clones and has an
 * identity of its own the moment it writes. Returns each one's checkout.
 */
function aTeamOfTwo() {
  const [a, b] = [home('a'), home('b')];
  const remote = join(sandbox, 'origin.git');
  git(sandbox, 'init', '-q', '--bare', remote);
  const atA = checkout(remote, 'a');
  expect(mnema(atA, a, 'init').status).toBe(0);
  share(atA);
  const atB = checkout(remote, 'b');
  return { a, b, atA, atB, remote };
}

const BRIEF_RULE = (title: string) => new RegExp(`^- \\*\\*ADR-\\d+ — ${title}\\*\\*.*$`, 'm');

describe('the document names who accepted each rule', () => {
  it('shows the stranger’s rule with the stranger’s identity, marked, beside the team’s own', () => {
    const { a, b, atA, atB } = aTeamOfTwo();
    const own = mnema(atA, a, 'decision', 'record', 'Our own call', 'because we decided it');
    expect(
      mnema(atA, a, 'decision', 'move', 'accept', idOf(own.out), '--note', 'agreed').status,
    ).toBe(0);
    share(atA);

    pull(atB);
    const planted = mnema(atB, b, 'decision', 'record', 'Release process', 'a stranger’s call');
    expect(
      mnema(atB, b, 'decision', 'move', 'accept', idOf(planted.out), '--note', 'mine').status,
    ).toBe(0);
    share(atB);

    pull(atA);
    const brief = mnema(atA, a, 'brief').stdout;
    const theirs = BRIEF_RULE('Release process').exec(brief)?.[0] ?? '';
    const ours = BRIEF_RULE('Our own call').exec(brief)?.[0] ?? '';
    expect(theirs, brief).toContain('accepted by mnid:');
    expect(theirs).toContain('(a person; unconfirmed)');
    expect(ours).toContain('accepted by mnid:');
    // The two are different identities, which is the whole of what the stranger's line owed.
    const idOfLine = (line: string) => /accepted by (mnid:[0-9a-f]+)/.exec(line)?.[1];
    expect(idOfLine(theirs)).not.toBe(idOfLine(ours));
    expect(brief).toContain('marked unconfirmed');
  }, 120_000);

  it('drops the mark from both once one identity accepts the other’s decision', () => {
    const { a, b, atA, atB } = aTeamOfTwo();
    const own = mnema(atA, a, 'decision', 'record', 'Our own call', 'because we decided it');
    mnema(atA, a, 'decision', 'move', 'accept', idOf(own.out), '--note', 'agreed');
    share(atA);
    pull(atB);
    const theirs = mnema(atB, b, 'decision', 'record', 'Release process', 'their call');
    mnema(atB, b, 'decision', 'move', 'accept', idOf(theirs.out), '--note', 'mine');
    share(atB);

    pull(atA);
    const second = mnema(atB, b, 'decision', 'record', 'A second call', 'recorded by B');
    share(atB);
    pull(atA);
    expect(
      mnema(atA, a, 'decision', 'move', 'accept', idOf(second.out), '--note', 'A rules on B’s call')
        .status,
    ).toBe(0);

    const brief = mnema(atA, a, 'brief').stdout;
    expect(brief).not.toContain('unconfirmed');
    expect(BRIEF_RULE('A second call').exec(brief)?.[0]).toContain('accepted by mnid:');
  }, 120_000);
});

describe('an agent may accept, and the trail says it', () => {
  it('through --which: recorded as an agent’s, said by the verb, by show and by the next brief', () => {
    const { a, atA } = aTeamOfTwo();
    const proposed = mnema(atA, a, 'decision', 'record', 'A call', 'because');
    const id = idOf(proposed.out);
    const accepted = mnema(
      atA,
      a,
      'decision',
      'move',
      'accept',
      id,
      '--note',
      'ok',
      '--which',
      'claude-code',
    );
    expect(accepted.status, accepted.out).toBe(0);
    expect(accepted.out).toContain('recorded as made by an agent (claude-code)');

    const shown = mnema(atA, a, 'show', id).out;
    expect(shown).toMatch(/recorded by mnid:[0-9a-f]+ \(a person\)/);
    expect(shown).toMatch(/accepted by mnid:[0-9a-f]+ \(agent claude-code\)/);

    const brief = mnema(atA, a, 'brief').stdout;
    // The brief of a record with one identity does not mark the rule: nobody to confirm with.
    expect(BRIEF_RULE('A call').exec(brief)?.[0]).toMatch(/\(agent claude-code\)/);
    expect(brief).not.toContain('unconfirmed');
    expect(brief).toContain('1 of them was accepted by an agent');
  }, 120_000);

  it('through the server: the reply says so, and the next brief marks the rule', async () => {
    const { a, atA } = aTeamOfTwo();
    const id = idOf(mnema(atA, a, 'decision', 'record', 'A call', 'because').out);
    const replies = await throughTheServer(atA, a, [
      {
        name: 'decision_transition',
        arguments: { id, action: 'accept', note: 'the agent agrees' },
      },
    ]);
    const text = replies[0]?.content.map((block) => block.text).join('\n') ?? '';
    expect(replies[0]?.isError, text).not.toBe(true);
    expect(text).toContain('recorded as made by an agent (claude-code)');
    expect(text).toContain('mnema switch off agent-accepts');
    expect(mnema(atA, a, 'show', id).out).toMatch(
      /accepted by mnid:[0-9a-f]+ \(agent claude-code\)/,
    );
    expect(BRIEF_RULE('A call').exec(mnema(atA, a, 'brief').stdout)?.[0]).toContain(
      'agent claude-code',
    );
  }, 120_000);

  it('adds nothing to the record: the envelope already said which agent', () => {
    const { a, atA } = aTeamOfTwo();
    const id = idOf(mnema(atA, a, 'decision', 'record', 'A call', 'because').out);
    mnema(atA, a, 'decision', 'move', 'accept', id, '--note', 'ok', '--which', 'claude-code');
    const json = JSON.parse(mnema(atA, a, 'show', id, '--json').stdout) as {
      record: { acceptedBy: { who: string; which?: string }; recordedBy: { which?: string } };
    };
    expect(json.record.acceptedBy.which).toBe('claude-code');
    expect(json.record.recordedBy.which).toBeUndefined();
  }, 120_000);
});

describe('the setting', () => {
  it('lists agent-accepts among the switches, on until somebody records it off', () => {
    const { a, atA } = aTeamOfTwo();
    const listed = mnema(atA, a, 'switch').out;
    expect(listed).toMatch(/agent-accepts\s+on\s/);
  }, 60_000);

  it('turns an agent’s accept away when it is off, and a person’s still lands', async () => {
    const { a, atA } = aTeamOfTwo();
    const [one, two, three] = ['One', 'Two', 'Three'].map((title) =>
      idOf(mnema(atA, a, 'decision', 'record', title, 'because').out),
    ) as [string, string, string];
    const off = mnema(
      atA,
      a,
      'switch',
      'off',
      'agent-accepts',
      '--reason',
      'agents propose, people rule',
    );
    expect(off.status, off.out).toBe(0);
    expect(mnema(atA, a, 'switch').out).toMatch(/agent-accepts\s+off\s/);
    // The words of THIS switch: it hands nothing to a model, so the sentences the other channels
    // use for being off would be false of it.
    expect(off.out).toContain("agent-accepts is now OFF: an agent's accept is refused.");
    expect(off.out).toContain('a person at the command line still accepts a decision');
    expect(off.out).not.toContain('reaches a model');
    expect(off.out).not.toContain('in front of a model');

    // The agent, through the server.
    const [served] = await throughTheServer(atA, a, [
      {
        name: 'decision_transition',
        arguments: { id: one, action: 'accept', note: 'agent says yes' },
      },
    ]);
    const told = served?.content.map((block) => block.text).join('\n') ?? '';
    expect(served?.isError, told).toBe(true);
    expect(told.startsWith('Refused (AGENT_ACCEPTS_IS_OFF): '), told).toBe(true);
    expect(told).toContain('mnema switch on agent-accepts');
    expect(told).toContain('mnema decision move accept');

    // The agent, declared on the command line.
    const declared = mnema(
      atA,
      a,
      'decision',
      'move',
      'accept',
      two,
      '--note',
      'ok',
      '--which',
      'a-script',
    );
    expect(declared.status).toBe(1);
    expect(declared.out).toContain('AGENT_ACCEPTS_IS_OFF');

    // Neither moved. A person, with no agent on the act, is not asked.
    expect(mnema(atA, a, 'show', one).out).toContain('(proposed)');
    expect(mnema(atA, a, 'show', two).out).toContain('(proposed)');
    const person = mnema(atA, a, 'decision', 'move', 'accept', three, '--note', 'a person rules');
    expect(person.status, person.out).toBe(0);

    // And a reject by an agent is not what the switch is about.
    const rejected = mnema(
      atA,
      a,
      'decision',
      'move',
      'reject',
      two,
      '--note',
      'no',
      '--which',
      'a-script',
    );
    expect(rejected.status, rejected.out).toBe(0);

    // Back on, the agent accepts again.
    const on = mnema(atA, a, 'switch', 'on', 'agent-accepts');
    expect(on.status).toBe(0);
    expect(on.out).toContain('agent-accepts is now ON: an agent may accept a decision');
    const [again] = await throughTheServer(atA, a, [
      { name: 'decision_transition', arguments: { id: one, action: 'accept', note: 'now it may' } },
    ]);
    expect(again?.isError).not.toBe(true);
  }, 180_000);
});

describe('what is true of the other tools', () => {
  it('the tool that records a decision says nothing of acceptance, and the brief of a project with none stays silent', () => {
    const { a, atA } = aTeamOfTwo();
    mnema(atA, a, 'decision', 'record', 'Only proposed', 'because');
    const brief = mnema(atA, a, 'brief').stdout;
    expect(brief).not.toContain('Each says who accepted it');
    expect(brief).not.toContain('unconfirmed');
    expect(shortIdentity(atA, a)).toMatch(/^mnid:/);
    expect(readdirSync(join(atA, '.mnema')).length).toBeGreaterThan(0);
  }, 60_000);
});

type Reply = { isError?: boolean; content: { text: string }[] };

async function throughTheServer(
  project: string,
  homeDir: string,
  calls: readonly { name: string; arguments: Record<string, unknown> }[],
): Promise<Reply[]> {
  const { server } = buildMcpServer({ cwd: sandbox, env: { home: homeDir }, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(project).href }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const replies: Reply[] = [];
  for (const call of calls) replies.push((await client.callTool(call)) as Reply);
  await client.close();
  return replies;
}
