/**
 * What an address covers, said at the moment somebody records one — on BOTH surfaces
 * that record one, over a real working tree.
 *
 * THE HOLE THIS CLOSES was measured and not guessed: an address one segment shallower
 * can multiply what it covers tenfold, and until now nothing in the product said so
 * until after a person had recorded the address. `mnema rules` reported which rules
 * cover a file; nothing reported which files an address covers.
 *
 * IT IS A FACT AND NOT A WARNING, which is asserted rather than said: the invocation
 * exits clean whatever the reach, and the wording carries no threshold, no advice and
 * no glyph. The cases below hold both halves — the number, and the absence of an
 * opinion about it.
 *
 * THE BASE IS A JUDGEMENT AND IT SAYS SO. What counts as "a file of the project" has
 * no definition in this product, so `NOT_HAND_WRITTEN` takes one in the open and the
 * line NAMES what it left out. A fraction whose denominator was decided out of sight
 * cannot be argued with, which is why the skipped names are asserted here beside the
 * counts they explain.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ADDRESS_RELATIONS } from '@mnema/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';
import { NOT_HAND_WRITTEN, reachOfAddress, WALK_CEILING } from '../src/governed-tree.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { openSession, type Session } from '../src/mcp/session.js';
import { runLinkKnowledge } from '../src/mcp/tools.js';

let sandbox: string;
let repo: string;
let env: { home: string; xdgDataHome: string };
let originalCwd: string;
let originalXdg: string | undefined;
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

/** Writes a file and every directory above it. */
function file(relative: string, body = 'x'): void {
  const full = join(repo, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** `mnema link <rule> <path> --rel <rel>` through the real verb. */
async function address(path: string, rel = 'governs'): Promise<Said> {
  const said = await mnema('link', 'ADR-1', path, '--rel', rel);
  expect(said.failed, said.err.join(' / ')).toBe(false);
  return said;
}

/** The reach line of an invocation, or undefined when it printed none. */
function reachLine(said: Said): string | undefined {
  return said.out.find(
    (line) => line.includes(' covers ') || line.includes('outside this project'),
  );
}

function connect(): Session {
  return openSession({ clientName: 'agent-alpha', roots: [pathToFileURL(repo).href], env });
}

/** A connected client over the real transport — what the agent actually talks to. */
async function connectClient(): Promise<Client> {
  const { server } = buildMcpServer({ env, log: () => {} });
  const client = new Client(
    { name: 'claude-code', version: '1.0.0' },
    { capabilities: { roots: {} } },
  );
  client.setRequestHandler(ListRootsRequestSchema, () => ({
    roots: [{ uri: pathToFileURL(repo).href, name: repo }],
  }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-reach-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
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
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  process.chdir(originalCwd);
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the command line says what an address covers', () => {
  it('states the fraction, and never an opinion about it', async () => {
    file('src/collate/fold.ts');
    file('src/collate/deep/leaf.ts');
    file('src/billing/charge.ts');
    file('README.md');
    const said = await address('src/collate');
    // Four files, and `.mnema` — the record this product writes — is out of the base
    // and named on the line, which is the whole of what "the base is a judgement" means.
    expect(reachLine(said)).toBe(
      '  src/collate covers 2 of 4 file(s) counted in the working tree; not counted: .mnema.',
    );
    expect(said.out).toContain(
      '  Files on disk, not edits — a directory nobody touches counts the same as a busy one.',
    );
    // No threshold, no advice, no severity: the whole reply, on the widest address
    // there is, holds none of these words.
    const wide = await address('.');
    expect(wide.failed).toBe(false);
    for (const word of ['warning', 'too', 'consider', 'careful', 'narrow', 'should']) {
      expect(wide.out.join('\n').toLowerCase(), word).not.toContain(word);
    }
  });

  it('is the SAME number for the gate as for the text', async () => {
    file('src/collate/fold.ts');
    file('src/billing/charge.ts');
    // The two relations are one address with two powers, so a product that counted
    // only for the gate would be deciding which relation deserves care.
    const governs = reachLine(await address('src/collate', 'governs'));
    const asks = reachLine(await address('src/collate', 'asks-for-a-person'));
    expect(asks).toBe(governs);
    expect(governs).toContain('covers 1 of 2 file(s)');
  });

  it('says nothing at all when the relation carries no address', async () => {
    file('src/collate/fold.ts');
    for (const rel of ['relates-to', 'supersedes', 'derived-from', 'contradicts']) {
      const said = await mnema('link', 'ADR-1', 'ADR-2', '--rel', rel);
      expect(said.failed).toBe(false);
      expect(reachLine(said), rel).toBeUndefined();
    }
  });

  it('shows the cliff a segment of depth makes', async () => {
    for (let i = 0; i < 20; i += 1) file(`src/deep/a${i}.ts`);
    for (let i = 0; i < 2; i += 1) file(`src/shallow/b${i}.ts`);
    file('elsewhere.ts');
    expect(reachLine(await address('src'))).toContain('covers 22 of 23 file(s)');
    expect(reachLine(await address('src/shallow'))).toContain('covers 2 of 23 file(s)');
  });

  it('answers "outside this project" rather than a fraction of nothing', async () => {
    file('src/a.ts');
    const said = await address('/etc');
    expect(reachLine(said)).toBe(
      '  That address lies outside this project, so it covers nothing here.',
    );
  });
});

describe('the base of the fraction', () => {
  it('leaves out what nobody hand-writes, and NAMES what it left out', async () => {
    file('src/a.ts');
    for (const skipped of NOT_HAND_WRITTEN) {
      // `.mnema` and `.git` already exist or are the record's own; write into each
      // name regardless, so every entry of the list is exercised by this case.
      file(join(skipped, 'inside.txt'));
    }
    const said = await address('.');
    const line = reachLine(said);
    // One file: `src/a.ts`. Everything under a skipped name is out of the base
    // entirely — six directories of content, none of it counted.
    expect(line).toContain('covers 1 of 1 file(s)');
    for (const skipped of NOT_HAND_WRITTEN) {
      expect(line, skipped).toContain(skipped);
    }
    expect(line).toContain('not counted:');
  });

  it('counts a hand-written dotted directory — the rule is not "starts with a dot"', async () => {
    file('.github/workflows/ci.yml');
    file('src/a.ts');
    // `.github/workflows/ci.yml` and `src/a.ts` — the dotted one counts.
    expect(reachLine(await address('.'))).toContain('covers 2 of 2 file(s)');
    expect(reachLine(await address('.github'))).toContain('covers 1 of 2 file(s)');
  });

  it('neither counts nor follows a symlink', async () => {
    file('src/a.ts');
    mkdirSync(join(sandbox, 'elsewhere'), { recursive: true });
    writeFileSync(join(sandbox, 'elsewhere', 'b.ts'), 'x');
    symlinkSync(join(sandbox, 'elsewhere'), join(repo, 'linked'));
    symlinkSync(join(repo, 'src', 'a.ts'), join(repo, 'alias.ts'));
    // One: `src/a.ts`. The directory link is not descended into (a walk that followed
    // one can loop), and the file link is not counted (it would count the same bytes
    // twice, under two addresses).
    expect(reachLine(await address('.'))).toContain('covers 1 of 1 file(s)');
  });

  it('stops at the ceiling and says the counts are floors', async () => {
    for (let i = 0; i < 12; i += 1) file(`src/d${i}/f.ts`);
    // The ceiling is squeezed rather than the tree grown: a case that wrote fifty
    // thousand files is a case nobody runs, and what has to be proved is that the walk
    // STOPS and SAYS SO — not the size of the real number.
    const cut = reachOfAddress('governs', '.', repo, 5);
    expect(cut?.truncated).toBe(true);
    expect(cut?.counted).toBe(5);
    // And the surfaces print the floor rather than passing it off as the whole tree.
    const { reachNotice } = await import('../src/recorded-content.js');
    expect(reachNotice(cut).join('\n')).toContain('so both are floors');

    // The real ceiling is not reached here, and it is what both production callers use.
    const whole = reachOfAddress('governs', '.', repo);
    expect(whole?.truncated).toBe(false);
    expect(whole?.counted).toBe(12);
    expect(WALK_CEILING).toBe(50_000);
  });
});

describe('the agent is told the same thing', () => {
  it('carries the reach on the tool result, worded once for both surfaces', async () => {
    file('src/collate/fold.ts');
    file('src/billing/charge.ts');
    const session = connect();
    const linked = runLinkKnowledge(session, {
      subject: 'ADR-1',
      target: 'src/collate',
      rel: 'governs',
    });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.reach).toBeDefined();
    expect(linked.reach?.address).toBe('src/collate');
    expect(linked.reach?.under).toBe(1);
    // The CLI, over the same tree, reports the same base — one derivation, one walk,
    // one judgement about what a file of the project is.
    expect(reachLine(await address('src/collate'))).toContain(
      `covers 1 of ${linked.reach?.counted} file(s)`,
    );
  });

  it('puts the line in the TEXT the agent reads, over the real transport', async () => {
    // The field on the tool result is not what an agent sees; the text block is. A case
    // that stopped at the field left the server free to compute the reach and print
    // none of it — measured: that mutation turned 123 existing MCP cases green.
    file('src/collate/fold.ts');
    file('src/billing/charge.ts');
    const client = await connectClient();
    const reply = await client.callTool({
      name: 'link_knowledge',
      arguments: { subject: 'ADR-1', target: 'src/collate', rel: 'governs' },
    });
    const text = (reply.content as { text: string }[])[0]?.text ?? '';
    expect(text).toContain('src/collate covers 1 of 2 file(s)');
    expect(text).toContain('Files on disk, not edits');
    // And the ORDER: the reach is about what was just recorded, the tree notice about
    // where it went, and a reader's question after typing a wide address is the first.
    expect(text.indexOf('covers 1 of 2')).toBeLessThan(text.indexOf('Landed in the'));
    await client.close();
  });

  it('says nothing in that text when the relation carries no address', async () => {
    const client = await connectClient();
    const reply = await client.callTool({
      name: 'link_knowledge',
      arguments: { subject: 'ADR-1', target: 'ADR-2', rel: 'relates-to' },
    });
    const text = (reply.content as { text: string }[])[0]?.text ?? '';
    expect(text).not.toContain('covers');
    expect(text).toContain('Linked ADR-1');
    await client.close();
  });

  it('carries none when the relation carries no address', () => {
    const session = connect();
    const linked = runLinkKnowledge(session, {
      subject: 'ADR-1',
      target: 'ADR-2',
      rel: 'relates-to',
    });
    expect(linked.ok).toBe(true);
    if (!linked.ok) return;
    expect(linked.reach).toBeUndefined();
  });
});

describe('one place decides which relations carry an address', () => {
  /**
   * `ADDRESS_RELATIONS` is the whole of the labels that carry an ADDRESS, and this
   * asserts it against the derivation that reads them rather than against a list
   * written twice. It said "whose target is a path" and the decision import falsified
   * that: `derived-from` records the file a proposal was read out of, which is a path
   * and covers no region — so the list is about coverage, never about the shape of the
   * string. Read on: `governance.ts` walks exactly these relations, so a third one added
   * to the constant and not to the walk — or the reverse — is red here.
   *
   * Read off the SOURCE because the walk takes the relation as an argument, so no
   * type can hold this: the domain is an open string by design (a relation is never a
   * closed enum in this product), which is exactly why the guard is structural.
   */
  it('walks in the copilot exactly the relations the constant names', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      fileURLToPath(new URL('../../copilot/src/intelligence/governance.ts', import.meta.url)),
      'utf-8',
    );
    const walked = [...source.matchAll(/addressesUnder\([^)]*?,\s*([A-Z_]+),/gs)].map((m) => m[1]);
    expect(new Set(walked)).toEqual(new Set(['GOVERNS_RELATION', 'ASKS_FOR_A_PERSON_RELATION']));
    expect([...ADDRESS_RELATIONS]).toEqual(['governs', 'asks-for-a-person']);
    // And the reach agrees with the constant, member for member — the third place the
    // pair could have drifted.
    for (const rel of ADDRESS_RELATIONS) {
      expect(reachOfAddress(rel, '.', repo), rel).toBeDefined();
    }
    expect(reachOfAddress('relates-to', '.', repo)).toBeUndefined();
  });
});

describe('the walk is nowhere near the hot path', () => {
  /**
   * A `readdir` of the whole project is fine once, in a verb a person just ran; it is
   * not fine on the channel the HOST calls before every file write. So the reach is
   * reached from the two verbs that RECORD an address and from nothing else, and that
   * is checked by walking the package's own source for the call — by the symbol, so a
   * third caller written next year is red here rather than slow in production.
   */
  it('is called from the two write verbs and from nowhere else', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { relative } = await import('node:path');
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const calling: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name.endsWith('.ts') &&
          /\breachOfAddress\s*\(/.test(readFileSync(full, 'utf-8'))
        )
          calling.push(relative(src, full).split('\\').join('/'));
      }
    };
    walk(src);
    expect(calling.sort()).toEqual(['commands/link.ts', 'governed-tree.ts', 'mcp/tools.ts']);
  });
});
