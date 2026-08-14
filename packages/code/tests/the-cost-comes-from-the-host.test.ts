/**
 * `mnema usage` at the surface: tokens and never dollars, no line of the conversation
 * on the screen, the limit said out loud, and nothing on disk moved.
 *
 * THE FOUR THINGS HERE ARE THE FOUR A READER OF THE OUTPUT CANNOT CHECK.
 *
 * NEVER DOLLARS is the rule three products of the ecosystem study broke, each with a
 * hardcoded price table that ages in silence — one had priced every non-Claude model
 * wrong through a default. So the case refuses `$`, `usd` and `USD` on the page AND
 * asserts the counts that ARE there: half of it alone would pass over an empty answer,
 * which is the shape a currency check is most likely to decay into.
 *
 * NO CONTENT LEAVES THE TRANSCRIPT. A transcript is the whole conversation — whatever
 * anybody pasted into it — and this verb reads it for four numbers. The fixture puts a
 * sentence inside `message.content` and the case asserts it is nowhere in the output,
 * which is the only form of that assertion that can fail for a reason.
 *
 * THE LIMIT IS ON THE PAGE (A4). The report claims the counts are not the record's, are
 * not covered by `verify`, and were produced without writing anything. A doc-comment
 * asserting that is a comment; this is the half that holds it to being true — the last
 * claim by the digest below, the first two by being read off the output a person gets.
 *
 * AND IT IS A READ, PROVED BY BYTES, over a sandbox that includes THE HOST'S OWN STORE.
 * That is the one difference from every other read-only case in this suite: this verb
 * opens files somebody else's product owns, and the digest is what would catch a
 * reading that touched one of them. Nothing here reads the real `~/.claude` — `HOME` is
 * the sandbox for the length of the file.
 */

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CliIo, run } from '../src/cli.js';

let sandbox: string;
let repo: string;
let originalCwd: string;
let originalXdg: string | undefined;
let originalHome: string | undefined;
let originalConfigDir: string | undefined;

/** The sentence the fixture hides inside a message, which must not come back out. */
const SENTINEL = 'the-private-thing-somebody-pasted-into-the-conversation';

/** What one invocation wrote, and whether it asked for a non-zero exit. */
interface Said {
  readonly out: string[];
  readonly err: string[];
  readonly failed: boolean;
}

/** Runs `mnema <argv>` the way the binary does, and reads both channels. */
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

/**
 * A content digest of every file under `dir` — the shape `guard.test.ts` established,
 * and here it covers the host's store as well as the record.
 */
function digest(dir: string): string {
  const hash = createHash('sha256');
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        hash.update(`D:${relative(dir, full)}\n`);
        walk(full);
      } else {
        hash.update(`F:${relative(dir, full)}:${statSync(full).size}:`);
        hash.update(readFileSync(full));
        hash.update('\n');
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/**
 * One host session's transcript, in the host's own shape, with a sentence hidden in the
 * content of the message the counts come from.
 *
 * The fields are the measured ones (A13): a fixture carrying an invented name would
 * leave the suite green over a format Claude Code does not write.
 */
function writeTranscript(session: string, at: Date, lastWritten: Date): void {
  const directory = join(sandbox, 'home', '.claude', 'projects', 'a-name-nothing-composes');
  mkdirSync(directory, { recursive: true });
  const line = JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: repo,
    sessionId: session,
    version: '2.1.224',
    type: 'assistant',
    timestamp: at.toISOString(),
    requestId: `req_${session}`,
    message: {
      id: `msg_${session}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text: SENTINEL }],
      usage: {
        input_tokens: 13,
        output_tokens: 17,
        cache_read_input_tokens: 19,
        cache_creation_input_tokens: 23,
        service_tier: 'standard',
      },
    },
  });
  const path = join(directory, `${session}.jsonl`);
  writeFileSync(path, `${line}\n`);
  utimesSync(path, lastWritten, lastWritten);
}

/** The listed rows, without the header that counts them or the closing statement. */
function listedRows(said: Said): string[] {
  return said.out.filter((line) => line.startsWith('  '));
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-usage-surface-'));
  repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  originalCwd = process.cwd();
  originalXdg = process.env.XDG_DATA_HOME;
  originalHome = process.env.HOME;
  originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  process.env.HOME = join(sandbox, 'home');
  // The developer's own machine may have moved its host store. Left set, this suite
  // would read their real transcripts.
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.MNEMA_RUN;
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
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  rmSync(sandbox, { recursive: true, force: true });
});

/** Opens a run and puts one host session inside its window. */
async function aRunWithATranscript(): Promise<void> {
  const opened = await mnema('run', 'start', '--which', 'agent-alpha');
  expect(opened.failed, opened.err.join(' / ')).toBe(false);
  // Inside the window on both sides, and it has to be: the run opened a moment ago and
  // is still open, so the window is `[then, the instant the read happens]` — a fixture
  // dated in the future would sit past the end of it and come back unattributed, which
  // is a real answer for the wrong reason.
  const now = new Date();
  writeTranscript('session-in-the-window', now, now);
}

describe('mnema usage', () => {
  it('reports tokens and a model id, and never a currency', async () => {
    await aRunWithATranscript();
    const said = await mnema('usage');
    expect(said.failed, said.err.join(' / ')).toBe(false);
    const page = said.out.join('\n');

    // The non-vacuity half FIRST, so the currency half below cannot pass over an empty
    // page: the four counts the fixture wrote are on it, in full, with the model.
    expect(page).toContain('in 13 · out 17 · cache-read 19 · cache-write 23 tokens');
    expect(page).toContain('claude-opus-5');
    expect(page).toContain('session session-in-the-window');

    // And no price, in any of the three spellings a table would reach for.
    for (const currency of ['$', 'usd', 'USD']) {
      expect(page, `a currency reached the page: ${currency}`).not.toContain(currency);
    }
  });

  it('reads a transcript for numbers and puts none of the conversation on the page', async () => {
    await aRunWithATranscript();
    const said = await mnema('usage');
    const everything = [...said.out, ...said.err].join('\n');
    // The counts came from the very message the sentence is inside, so this is not a
    // case about a file that was never opened: it was read, and the words were left in
    // it.
    expect(everything).toContain('in 13 · out 17');
    expect(everything, 'a message body reached the page').not.toContain(SENTINEL);
  });

  it('says a run has no transcript rather than saying it cost nothing', async () => {
    const opened = await mnema('run', 'start', '--which', 'agent-alpha');
    expect(opened.failed, opened.err.join(' / ')).toBe(false);
    // A session of this project that begins an hour after the window closes.
    const now = Date.now();
    writeTranscript(
      'session-after-the-window',
      new Date(now + 3_600_000),
      new Date(now + 7_200_000),
    );

    const said = await mnema('usage');
    const rows = listedRows(said);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('no transcript');
    // The discriminant is the WORD, not the count: no line of this report claims a
    // number of tokens, in either direction.
    expect(rows[0]).not.toContain('tokens');
  });

  it('says on the page that the number is not the record’s', async () => {
    // A4: the doc-comments of `usage.ts` and `presentation/usage.ts` claim the report
    // qualifies itself. This is what holds them to it, in the words a reader would
    // recognize rather than by comparing to a constant.
    await aRunWithATranscript();
    const page = (await mnema('usage')).out.join('\n');
    expect(page).toContain('not from the record');
    expect(page).toContain('`mnema verify` does not cover it');
    expect(page).toContain('Nothing was written to produce it');
  });

  it('writes nothing: the sandbox and the host store are byte-identical after it', async () => {
    await aRunWithATranscript();
    // Read once first, so anything a first read builds (a projection cache) is already
    // there and the digest is measuring THIS invocation.
    await mnema('usage');

    const before = digest(sandbox);
    const said = await mnema('usage');
    expect(said.failed, said.err.join(' / ')).toBe(false);
    expect(listedRows(said)).toHaveLength(1);
    // The whole sandbox: the record, the caches, the keys, AND `home/.claude`, which is
    // the half no other read-only case in this suite covers.
    expect(digest(sandbox)).toBe(before);
  });
});
