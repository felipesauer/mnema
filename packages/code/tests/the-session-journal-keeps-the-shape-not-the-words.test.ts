/**
 * The session journal keeps what a session did with the record, in ids and counts, and never what
 * was said in it; it lets the next reading of the transcript start where the last one stopped; and
 * it is a file of this machine that a switch turns off and a pruning bounds.
 *
 * The files under test are `src/session-journal.ts` (the journal), `src/what-the-session-did.ts`
 * (the incremental reading) and `src/transcripts.ts` (the byte cursor). The transcripts are built
 * here in the shape the host writes them, and carry sentences that must never reach the journal.
 */

import {
  appendFileSync,
  existsSync,
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
import { join } from 'node:path';
import type { DiscoveryEnv } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSessionTally } from '../src/commands/tally.js';
import { type CliIo, run } from '../src/program.js';
import {
  type Journal,
  outcomeOf,
  PRUNE_AFTER_MS,
  PRUNE_KEEP,
  readJournal,
  sessionIdOf,
  writeJournal,
} from '../src/session-journal.js';
import { forEachLineFrom } from '../src/transcripts.js';
import { emptyReading, readTheNewPart, whatTheSessionDid } from '../src/what-the-session-did.js';

let sandbox: string;
let repo: string;
let env: DiscoveryEnv;
let originalCwd: string;
let originalHome: string | undefined;
let originalXdg: string | undefined;

const SESSION = '0f7c2d1e-aaaa-4bbb-8ccc-123456789abc';
const LONG_AGO = '2020-01-01T00:00:00.000Z';

/** Words that must never be found in a journal: each stands for a kind of thing a session holds. */
const SECRETS = {
  prompt: 'PROMPTSENTINEL rename the ledger to utc',
  output: 'OUTPUTSENTINEL line printed by a tool',
  content: 'CONTENTSENTINEL const x = 1;',
  answer: 'ANSWERSENTINEL the option the person chose',
  question: 'QUESTIONSENTINEL which library should it be',
};

/** Runs `mnema <argv>` in process, answering what it printed; refuses to go on if it failed. */
async function doing(...argv: string[]): Promise<string[]> {
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
  expect(failed, `${argv.join(' ')}: ${err.join(' / ')}`).toBe(false);
  return out;
}

function at(n: number): string {
  return `2020-01-01T00:00:${String(n).padStart(2, '0')}.000Z`;
}

function prompt(when: string, text: string): string {
  return JSON.stringify({
    type: 'user',
    timestamp: when,
    cwd: repo,
    origin: { kind: 'human' },
    message: { role: 'user', content: text },
  });
}

function write(when: string, id: string, file: string, content = SECRETS.content): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: when,
    cwd: repo,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Write', input: { file_path: file, content } }],
    },
  });
}

function result(when: string, id: string, error = false): string {
  return JSON.stringify({
    type: 'user',
    timestamp: when,
    cwd: repo,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: SECRETS.output,
          ...(error ? { is_error: true } : {}),
        },
      ],
    },
  });
}

/** The line the host writes when the person answered its question tool. */
function answered(when: string): string {
  return JSON.stringify({
    type: 'user',
    timestamp: when,
    cwd: repo,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q', content: 'x' }] },
    toolUseResult: { answers: { [SECRETS.question]: SECRETS.answer } },
  });
}

function transcriptAt(name: string, lines: readonly string[]): string {
  const path = join(sandbox, name);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function payload(event: string, file: string, session: string | null = SESSION): string {
  return JSON.stringify({
    hook_event_name: event,
    transcript_path: file,
    cwd: repo,
    ...(session === null ? {} : { session_id: session }),
  });
}

function tally(input: string): { reply: Record<string, unknown>; notes: readonly string[] } {
  const done = runSessionTally({ cwd: repo, env }, { payload: input });
  return {
    reply: JSON.parse(JSON.stringify(done.reply)) as Record<string, unknown>,
    notes: done.notes,
  };
}

/** Every file below `dir` named `<id>.json` under a `sessions` directory. */
function journalsUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, name.name);
      if (name.isDirectory()) walk(path);
      else if (path.includes(`${join('sessions', '')}`) && name.name.endsWith('.json'))
        found.push(path);
    }
  };
  walk(dir);
  return found;
}

function theJournal(): Journal {
  const [only] = journalsUnder(sandbox);
  if (only === undefined) throw new Error('no journal was written');
  const read = readJournal(only);
  if (read === undefined) throw new Error('the journal is not one');
  return read;
}

beforeEach(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-journal-'));
  repo = join(sandbox, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  originalCwd = process.cwd();
  originalHome = process.env.HOME;
  originalXdg = process.env.XDG_DATA_HOME;
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  env = { home: join(sandbox, 'home') };
  process.chdir(repo);
  await doing('init');
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdg;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the byte cursor', () => {
  it('hands over only what follows the offset, and leaves a half-written last line for later', () => {
    const file = join(sandbox, 'cursor.jsonl');
    writeFileSync(file, '{"a":1}\n{"b":2}\n{"c":');
    const seen: string[] = [];
    const first = forEachLineFrom(file, 0, (line) => seen.push(line));
    expect(seen).toEqual(['{"a":1}', '{"b":2}']);
    expect(first.end).toBe('{"a":1}\n{"b":2}\n'.length);
    appendFileSync(file, '3}\n');
    const more: string[] = [];
    const second = forEachLineFrom(file, first.end, (line) => more.push(line));
    expect(more).toEqual(['{"c":3}']);
    expect(second.end).toBe(statSync(file).size);
  });

  it('counts bytes and not characters, so a multi-byte character is never split', () => {
    const file = join(sandbox, 'bytes.jsonl');
    writeFileSync(file, '{"t":"ação"}\n{"t":"y"}\n');
    const seen: string[] = [];
    const { end } = forEachLineFrom(file, Buffer.byteLength('{"t":"ação"}\n'), (line) =>
      seen.push(line),
    );
    expect(seen).toEqual(['{"t":"y"}']);
    expect(end).toBe(statSync(file).size);
  });
});

describe('reading a transcript in parts', () => {
  const linesOf = (): string[] => [
    prompt(LONG_AGO, 'go'),
    write(at(1), 'a', join(repo, 'src', 'a.ts')),
    result(at(2), 'a'),
    write(at(3), 'b', join(repo, 'src', 'b.ts')),
    result(at(4), 'b', true),
    write(at(5), 'c', join(repo, 'src', 'a.ts')),
  ];

  it('lands on what one whole reading says, wherever the cut falls (a failure may arrive in the second part)', () => {
    const lines = linesOf();
    const file = join(sandbox, 'whole.jsonl');
    writeFileSync(file, `${lines.join('\n')}\n`);
    const whole = emptyReading();
    readTheNewPart(file, whole, { cwd: repo });
    expect(Object.keys(whole.files)).toHaveLength(1);
    expect(whole.writesInResponse).toBe(2);
    for (let cut = 1; cut < lines.length; cut += 1) {
      const part = join(sandbox, `part-${cut}.jsonl`);
      writeFileSync(part, `${lines.slice(0, cut).join('\n')}\n`);
      const reading = emptyReading();
      readTheNewPart(part, reading, { cwd: repo });
      appendFileSync(part, `${lines.slice(cut).join('\n')}\n`);
      readTheNewPart(part, reading, { cwd: repo });
      expect(reading, `cut after line ${cut}`).toEqual(whole);
    }
  });

  it('starts over when the file is shorter than where the reading stood', () => {
    const lines = linesOf();
    const file = join(sandbox, 'short.jsonl');
    writeFileSync(file, `${lines.join('\n')}\n`);
    const reading = emptyReading();
    readTheNewPart(file, reading, { cwd: repo });
    writeFileSync(file, `${lines.slice(0, 2).join('\n')}\n`);
    readTheNewPart(file, reading, { cwd: repo });
    expect(Object.keys(reading.files)).toHaveLength(1);
    expect(reading.bytes).toBe(statSync(file).size);
  });

  it('still answers a whole read as before: the paths, and whether the last response edited', () => {
    const lines = linesOf();
    const file = join(sandbox, 'did.jsonl');
    writeFileSync(file, `${lines.join('\n')}\n`);
    const did = whatTheSessionDid(file, repo);
    expect(did?.editedFiles).toEqual([join(repo, 'src', 'a.ts')]);
    expect(did?.lastResponseEdited).toBe(true);
  });
});

describe('the journal a Stop keeps', () => {
  it('holds the ids and counts of what the session did with the record, from the record and the transcript', async () => {
    const out = await doing('decision', 'record', 'Use UTC', 'The ledger is UTC');
    const decision = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(
      out.join('\n'),
    )?.[0];
    expect(decision).toBeDefined();
    const taskOut = await doing('task', 'create', 'Move the ledger to UTC');
    const task = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(
      taskOut.join('\n'),
    )?.[0];
    await doing('task', 'move', 'submit', task ?? '');
    await doing('task', 'move', 'start', task ?? '');
    const file = transcriptAt('session.jsonl', [
      prompt(LONG_AGO, SECRETS.prompt),
      write(at(1), 'a', join(repo, 'src', 'a.ts')),
      result(at(2), 'a'),
      answered(at(3)),
      write(at(4), 'b', join(repo, 'src', 'b.ts')),
      result(at(5), 'b'),
    ]);
    tally(payload('Stop', file));
    const journal = theJournal();
    expect(journal.session).toBe(SESSION);
    expect(journal.decisions).toEqual([{ id: decision, state: 'proposed' }]);
    expect(journal.filesEdited).toBe(2);
    expect(journal.tasksInProgress).toEqual([task]);
    expect(journal.goal).toBe('Move the ledger to UTC');
    expect(journal.questionsWithoutDecision).toBe(0);
    expect(journal.outcome).toBe(outcomeOf(journal));
    expect(journal.outcome).toBe('1 decision recorded; 2 files edited.');
  });

  it('counts a question answered after the last decision as one with no decision after it', () => {
    const file = transcriptAt('asked.jsonl', [
      prompt(LONG_AGO, 'go'),
      answered(at(3)),
      write(at(4), 'a', join(repo, 'src', 'a.ts')),
      result(at(5), 'a'),
    ]);
    tally(payload('Stop', file));
    expect(theJournal().questionsWithoutDecision).toBe(1);
  });

  it('counts a file of decisions the record cites nowhere', () => {
    const file = transcriptAt('adr.jsonl', [
      prompt(LONG_AGO, 'go'),
      write(
        at(1),
        'a',
        join(repo, 'docs', 'adr', '0001-use-utc.md'),
        '# Use UTC\n\nStatus: accepted\n',
      ),
      result(at(2), 'a'),
    ]);
    tally(payload('Stop', file));
    expect(theJournal().decisionFilesUncited).toBe(1);
  });

  it('never holds a word of the session: no prompt, output, content, answer, question, and no key that names one', () => {
    const file = transcriptAt('words.jsonl', [
      prompt(LONG_AGO, SECRETS.prompt),
      write(at(1), 'a', join(repo, 'src', 'a.ts')),
      result(at(2), 'a'),
      answered(at(3)),
    ]);
    tally(payload('Stop', file));
    const [path] = journalsUnder(sandbox);
    const text = readFileSync(path ?? '', 'utf-8');
    for (const [kind, word] of Object.entries(SECRETS)) {
      expect(text.includes(word.split(' ')[0] ?? word), `the ${kind} reached the journal`).toBe(
        false,
      );
    }
    const keys = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) for (const one of value) collect(one);
      else if (typeof value === 'object' && value !== null) {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          if (key !== 'pending' && key !== 'files') collect(inner);
        }
      }
    };
    collect(JSON.parse(text));
    for (const forbidden of [
      'prompt',
      'text',
      'content',
      'diff',
      'env',
      'answer',
      'secret',
      'message',
      'output',
    ]) {
      expect(
        [...keys].filter((key) => key.toLowerCase().includes(forbidden)),
        forbidden,
      ).toEqual([]);
    }
    expect(text).not.toContain(repo);
  });

  it('reads only the new part of the transcript at the next Stop', () => {
    const lines = [
      prompt(LONG_AGO, 'go'),
      write(at(1), 'a', join(repo, 'src', 'a.ts')),
      result(at(2), 'a'),
    ];
    const file = transcriptAt('grows.jsonl', lines);
    tally(payload('Stop', file));
    expect(theJournal().filesEdited).toBe(1);
    // The part already read is overwritten with the same number of bytes of nothing: a reader
    // that went back over it would find no write and count none.
    const size = statSync(file).size;
    const blank = `${'x'.repeat(size - 1)}\n`;
    writeFileSync(file, blank);
    appendFileSync(
      file,
      `${[write(at(7), 'b', join(repo, 'src', 'b.ts')), result(at(8), 'b')].join('\n')}\n`,
    );
    tally(payload('Stop', file));
    expect(theJournal().filesEdited).toBe(2);
  });

  it('keeps no file when its channel is off, and the line is still said', async () => {
    await doing('switch', 'off', 'session-journal');
    const file = transcriptAt('off.jsonl', [
      prompt(LONG_AGO, 'go'),
      write(at(1), 'a', join(repo, 'src', 'a.ts')),
      result(at(2), 'a'),
    ]);
    const { reply } = tally(payload('Stop', file));
    expect(reply).toHaveProperty('systemMessage');
    expect(journalsUnder(sandbox)).toEqual([]);
  });

  it('keeps no file for a payload that names no session, and still counts', () => {
    const file = transcriptAt('anon.jsonl', [
      prompt(LONG_AGO, 'go'),
      write(at(1), 'a', join(repo, 'src', 'a.ts')),
      result(at(2), 'a'),
    ]);
    expect(tally(payload('Stop', file, null)).reply).toHaveProperty('systemMessage');
    expect(journalsUnder(sandbox)).toEqual([]);
  });

  it('does not make a file name of an id that is not one', () => {
    expect(sessionIdOf('../../etc/passwd')).toBeUndefined();
    expect(sessionIdOf('')).toBeUndefined();
    expect(sessionIdOf(SESSION)).toBe(SESSION);
  });

  it('reads a journal that is not one as none', () => {
    const file = join(sandbox, 'bad.json');
    writeFileSync(file, '{"version":2}');
    expect(readJournal(file)).toBeUndefined();
    writeFileSync(file, 'not json');
    expect(readJournal(file)).toBeUndefined();
    expect(readJournal(join(sandbox, 'absent.json'))).toBeUndefined();
  });
});

describe('the pruning', () => {
  function aJournal(id: string): Journal {
    return {
      version: 1,
      session: id,
      updatedAt: LONG_AGO,
      openedAt: null,
      decisions: [],
      notes: [],
      questionsWithoutDecision: 0,
      decisionFilesUncited: 0,
      filesEdited: 0,
      tasksInProgress: [],
      runsOpen: [],
      goal: null,
      outcome: null,
      reading: emptyReading(),
    };
  }

  it('lets go of the journals older than the age, and of all but the newest ones', () => {
    const dir = join(sandbox, 'sessions', 'p');
    mkdirSync(dir, { recursive: true });
    const now = new Date();
    for (let n = 0; n < PRUNE_KEEP + 5; n += 1) {
      const path = join(dir, `s-${n}.json`);
      writeJournal(path, aJournal(`s-${n}`), now);
      const when = new Date(now.getTime() - (PRUNE_KEEP + 5 - n) * 1000);
      utimesSync(path, when, when);
    }
    const old = join(dir, 'old.json');
    writeJournal(old, aJournal('old'), now);
    const ancient = new Date(now.getTime() - PRUNE_AFTER_MS - 60_000);
    utimesSync(old, ancient, ancient);
    writeJournal(join(dir, 'last.json'), aJournal('last'), now);
    const left = readdirSync(dir);
    expect(left).toHaveLength(PRUNE_KEEP);
    expect(existsSync(old)).toBe(false);
    expect(left).toContain('last.json');
    expect(left).not.toContain('s-0.json');
  });
});
