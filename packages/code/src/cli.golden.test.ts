/**
 * The golden: every line the CLI writes for a person, pinned byte for byte.
 *
 * The human format is the CLI's alone — the MCP surface answers in JSON and
 * never calls a printer — and until this file existed nothing pinned it. That is
 * why it could drift into five ad-hoc printers and a hundred inline `io.out`
 * calls: a shape nobody asserts is a shape nobody can change by accident, which
 * sounds safe and means the opposite. Each read invented its own summary because
 * there was no record of what the others had settled on.
 *
 * So this drives the WHOLE program the way a person does — one fixture, then every
 * verb over it, human output and `--json` alike — and compares the transcript to a
 * committed file. It asserts nothing about whether a line is good; it asserts only
 * that the line is the one that was there before. That makes it the acceptance test
 * for a pure move (nothing changed) and, afterwards, the diff that shows a
 * deliberate change line by line.
 *
 * WHAT IS NORMALIZED, AND WHY IT STILL PINS. A record's ids, instants, key
 * fingerprints and paths are minted fresh on every run, so they cannot be compared
 * literally. Each is replaced by a placeholder that NAMES it — `<task-runbook>`,
 * not `<id>` — and the name comes from the fixture that created it. Two columns
 * swapped would put a different name in each place, so the substitution cannot hide
 * a reordering, and {@link assertNothingVolatile} refuses a transcript that still
 * holds a raw id, so nothing volatile can slip in unnamed.
 *
 * THE TRANSCRIPT IS ENCODED, one output line per golden line: `| ` for a line on
 * stdout, `! ` for one on stderr, `[exit 1]` for a non-zero exit. Interleaving is
 * preserved as emitted, so the golden pins the ORDER of the two streams as well as
 * their content, and a verb that starts or stops failing shows up as a changed line.
 *
 * AND IT IS PLAIN BECAUSE THE RULE SAYS SO. The surface has a renderer that paints
 * (`presentation/styled.ts`), chosen at the entry from the flag, the environment and
 * whether output is going to a terminal. Nothing here asks for plain: `io` is injected
 * and no flag is passed, so the resolution falls to its last rung — no terminal, no
 * style — which is what makes this file the proof that weight is optional. The two
 * conventional variables are cleared in the fixture for the same reason the ids are
 * normalized: a transcript whose bytes depended on the developer's shell could not be
 * compared to a committed one. `presentation/styled.test.ts` is where the other half
 * lives: strip the escapes and the styled surface is this transcript, line for line.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryCaptured } from '@mnema/chain';
import { resolveTrees } from '@mnema/core';
import { openTreeForWriting } from '@mnema/core/write';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CliIo, run } from './cli.js';

/** Where the fixture lives for the length of this file. */
let sandbox: string;
/** The project the commands run in — `process.cwd()` for every invocation. */
let repo: string;
const cwdBefore = process.cwd();
const envBefore = { ...process.env };

/**
 * The volatile values the fixture created, each under the name it is known by.
 *
 * Keyed by the raw value so a lookup is exact, and the placeholder is a NAME
 * (`<task-runbook>`) rather than a class (`<id>`): a class would let two ids swap
 * places without the transcript changing, which is the one thing this file exists
 * to catch.
 */
const named = new Map<string, string>();

/** Records `value` under `as`, and returns it so a caller can capture inline. */
function name(value: string, as: string): string {
  named.set(value, `<${as}>`);
  return value;
}

/** The three transcripts, filled in fixture order and asserted one file each. */
const transcript = { writes: [] as string[], reads: [] as string[], help: [] as string[] };

/** A labelled break in a transcript, so a reader can find their way in it. */
function section(into: keyof typeof transcript, label: string): void {
  if (transcript[into].length > 0) transcript[into].push('');
  transcript[into].push(`### ${label}`);
}

/**
 * Runs `mnema <argv>` in the fixture and appends the encoded transcript to `into`.
 *
 * The invocation goes through {@link run}, the same entry the binary uses, with the
 * output injected — so what is captured is what the streams would have received,
 * in the order they would have received it. Returns the stdout lines, which is how
 * the fixture learns the ids it then gives names to.
 */
async function mnema(into: keyof typeof transcript, ...argv: string[]): Promise<string[]> {
  const out: string[] = [];
  const encoded: string[] = [];
  let failed = false;
  // A single `io.out` call may carry several lines (a record body, commander's
  // whole help text). Splitting them here keeps the golden one output line per
  // golden line while the bytes stay exactly what the stream would have got.
  const push = (prefix: string, text: string, keep?: string[]) => {
    for (const line of text.split('\n')) {
      encoded.push(line === '' ? prefix.trimEnd() : `${prefix}${line}`);
      keep?.push(line);
    }
  };
  const io: CliIo = {
    out: (line) => push('| ', line, out),
    err: (line) => push('! ', line),
    fail: () => {
      failed = true;
    },
  };
  transcript[into].push(`$ mnema ${argv.map(quoted).join(' ')}`);
  tick();
  await run(argv, io);
  transcript[into].push(...encoded);
  if (failed) transcript[into].push('[exit 1]');
  return out;
}

/**
 * Waits until the millisecond changes, before every invocation.
 *
 * The instants in the transcript are ranked in chronological order, which needs
 * every clock read to be its own instant: two commands landing in the same
 * millisecond would merge two ranks in one run and not in the next, and the
 * golden would differ from itself. Two milliseconds of a hundred invocations is
 * the whole cost of a transcript that does not reshuffle.
 */
function tick(): void {
  const from = Date.now();
  while (Date.now() - from < 2) {
    // Busy, deliberately: a timer would make every caller async for two ms.
  }
}

/**
 * One argument as it would be typed, quoted when it holds anything a shell would
 * eat. It keeps the invocation line readable, and it keeps an argument that is
 * only whitespace from reaching the golden as trailing space nobody can see.
 */
function quoted(argument: string): string {
  return /^[\w./:@=-]+$/.test(argument) ? argument : `'${argument}'`;
}

/** The value inside the first `(…)` on the line that starts with `head`. */
function inParens(lines: readonly string[], head: string): string {
  const line = lines.find((l) => l.startsWith(head));
  const found = line?.match(/\(([^)]+)\)/);
  if (found?.[1] === undefined)
    throw new Error(`fixture: no id in "${head}" of ${lines.join(' / ')}`);
  return found[1];
}

/** The rest of the line that starts with `head` — the value it reports. */
function after(lines: readonly string[], head: string): string {
  const line = lines.find((l) => l.startsWith(head));
  if (line === undefined) throw new Error(`fixture: no "${head}" in ${lines.join(' / ')}`);
  return line.slice(head.length).trim();
}

/**
 * Replaces every volatile value in a whole transcript.
 *
 * Named values go first, longest first: an id can appear inside a longer string
 * (a path, a request line), and replacing the short one first would leave the
 * longer one half-substituted. What is left volatile is an INSTANT, and those are
 * ranked in chronological order rather than order of appearance — a rank is a
 * property of the value, so two events printed in the wrong order come out with
 * their ranks crossed instead of quietly renumbered.
 */
function scrub(lines: readonly string[]): string {
  let text = lines.join('\n');
  for (const [value, placeholder] of [...named].sort((a, b) => b[0].length - a[0].length)) {
    text = text.split(value).join(placeholder);
  }
  text = text.split(sandbox).join('<sandbox>');
  const rank = (pattern: RegExp, label: string) => {
    const distinct = [...new Set(text.match(pattern) ?? [])].sort();
    for (const [index, value] of distinct.entries()) {
      const at = String(index + 1).padStart(2, '0');
      text = text.split(value).join(`<${label}:${at}>`);
    }
  };
  rank(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, 'at');
  // What survives the instants is a date the reports cut to ten characters.
  rank(/\d{4}-\d{2}-\d{2}/g, 'date');
  // The key this machine signs with, which `--json` carries on every event. One
  // machine, one key: a second distinct fingerprint would have to be NAMED by the
  // fixture, because a rank over two random values is not stable between runs.
  const fingerprints = [...new Set(text.match(/\b[0-9a-f]{64}\b/g) ?? [])];
  if (fingerprints.length > 1) {
    throw new Error(`fixture: ${fingerprints.length} fingerprints, none of them named`);
  }
  rank(/\b[0-9a-f]{64}\b/g, 'fingerprint');
  // How long a run has been open, which moves with the clock, not with the record.
  text = text.replace(/\b\d+[dhms](?: \d+[dhms])?\b/g, '<duration>');
  return `${text}\n`;
}

/**
 * Refuses a transcript that still holds something minted at run time.
 *
 * Without this the normalization would be free to be incomplete: an id nobody
 * named would sit in the golden as a literal, the file would differ on the next
 * run, and the fix would look like a flaky test rather than a fixture that failed
 * to account for what it created.
 */
function assertNothingVolatile(text: string): void {
  const volatile = [
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    /mnid:[0-9a-z]+/g,
    /\/tmp\/[^\s"]+/g,
    // Anything key-shaped: a base64url run that long is a public half or a
    // signature, and neither is the same twice.
    /[A-Za-z0-9_-]{44,}/g,
  ];
  for (const pattern of volatile) {
    expect(text.match(pattern) ?? [], `unnamed volatile value: ${pattern}`).toEqual([]);
  }
}

/**
 * Appends a memory the content door never saw — one credential-shaped value in a
 * record, written straight to the tree.
 *
 * It is the only fixture step that does not go through the CLI, and it has to be:
 * every field the surface writes is screened, so a finding is UNREACHABLE from
 * here. That is not a gap in the fixture, it is what `exposure` is for — the read
 * exists for the record's past, when there was no door, and this is the only way
 * to reproduce that past in a fixture built today.
 */
function appendUnscreenedMemory(anchor: string): string {
  const trees = resolveTrees(repo, {
    home: join(sandbox, 'home'),
    xdgDataHome: join(sandbox, 'data'),
  });
  const writer = openTreeForWriting(trees, 'public');
  // A fixed v7-shaped id: the subject is text, and one that does not change is
  // one less value to give a name to.
  const id = '01980000-0000-7000-8000-000000000001';
  writer.append(
    memoryCaptured(
      {
        at: new Date().toISOString(),
        who: anchor,
        signerFp: writer.signerFingerprint,
        subject: id,
      },
      { content: 'the token the door never saw: ghp_0123456789abcdefghijklmnopqrstuvwxyzA' },
    ),
  );
  writer.checkpoint();
  return id;
}

/**
 * Every read over whatever the fixture holds when it runs — human and JSON alike,
 * for the ones that have both. `brief` has one form only: its markdown IS the
 * contract, so there is no second serialization of it to pin.
 */
async function readEverything(label: string, ids: Record<string, string>): Promise<void> {
  section('reads', label);
  await mnema('reads', 'search');
  await mnema('reads', 'search', 'runbook');
  // A word that appears ONLY in what a decision turned down. The answer is the
  // whole point of recording it, so the transcript pins that it is findable.
  await mnema('reads', 'search', 'spreadsheet');
  await mnema('reads', 'search', 'runbook', '--json');
  await mnema('reads', 'search', '--kind', 'task', '--scope', 'public');
  await mnema('reads', 'show', ids.task ?? 'no-such-id');
  await mnema('reads', 'show', ids.task ?? 'no-such-id', '--json');
  await mnema('reads', 'refs', ids.decision ?? 'no-such-id');
  await mnema('reads', 'refs', ids.decision ?? 'no-such-id', '--json');
  await mnema('reads', 'refs', ids.task ?? 'no-such-id', '--depth', '2');
  await mnema('reads', 'refs', ids.task ?? 'no-such-id', '--direction', 'out', '--depth', '1');
  await mnema('reads', 'exposure');
  await mnema('reads', 'exposure', '--json');
  await mnema('reads', 'timeline', ids.task ?? 'no-such-id');
  await mnema('reads', 'timeline', ids.task ?? 'no-such-id', '--json');
  await mnema('reads', 'accountability');
  await mnema('reads', 'accountability', '--json');
  // The other half of the promise: the value the line above PRINTS, typed back into
  // the flag that filters by it. A short form the reads emit and the flags refuse
  // would be the defect this shortening exists not to create.
  await mnema('reads', 'accountability', '--who', ids.short as string);
  await mnema('reads', 'antipatterns');
  await mnema('reads', 'antipatterns', '--json');
  await mnema('reads', 'focus', '--actor', ids.short as string);
  await mnema('reads', 'focus', '--actor', ids.anchor as string);
  await mnema('reads', 'focus', '--actor', ids.anchor as string, '--json');
  await mnema('reads', 'resume', '--actor', ids.anchor as string);
  await mnema('reads', 'resume', '--actor', ids.anchor as string, '--json');
  await mnema('reads', 'next-actions', ids.task ?? 'no-such-id');
  await mnema('reads', 'next-actions', ids.task ?? 'no-such-id', '--json');
  await mnema('reads', 'guard', 'start', ids.task ?? 'no-such-id', '--actor', ids.anchor as string);
  await mnema(
    'reads',
    'guard',
    'complete',
    ids.task ?? 'no-such-id',
    '--actor',
    ids.anchor as string,
  );
  // The verdict that ALLOWS, which only the proof the action requires reaches.
  await mnema(
    'reads',
    'guard',
    'complete',
    ids.task ?? 'no-such-id',
    '--actor',
    ids.anchor as string,
    '--note',
    'it is done',
  );
  await mnema(
    'reads',
    'guard',
    'complete',
    ids.task ?? 'no-such-id',
    '--actor',
    ids.anchor as string,
    '--note',
    'it is done',
    '--json',
  );
  await mnema('reads', 'skills');
  await mnema('reads', 'skills', '--json');
  // The one read whose whole output is meant to become a file, so the golden is where
  // its bytes are pinned for a person to read as a document — over an empty record and
  // over a full one, which are the two things it has to say honestly.
  await mnema('reads', 'brief');
  await mnema('reads', 'verify');
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-golden-'));
  repo = join(sandbox, 'project');
  mkdirSync(repo, { recursive: true });
  mkdirSync(join(sandbox, 'home'), { recursive: true });
  process.env.HOME = join(sandbox, 'home');
  process.env.XDG_DATA_HOME = join(sandbox, 'data');
  delete process.env.MNEMA_RUN;
  // What the transcript may not depend on: a shell that turns style on or off. Cleared
  // rather than set, so what is recorded is the rule's own answer for output that is
  // not a terminal — a fixture that set NO_COLOR would pin plain even if the rule had
  // stopped falling back to it (see `wiring/color.ts`).
  delete process.env.NO_COLOR;
  delete process.env.FORCE_COLOR;
  process.chdir(repo);

  // ── The reads with nothing recorded anywhere: no project, no trees.
  section('reads', 'outside a project');
  await mnema('reads', 'search');
  await mnema('reads', 'exposure');
  await mnema('reads', 'brief');
  await mnema('reads', 'verify');

  // ── Founding the project, twice: the run that creates the identity, and the
  //    run that finds it already there.
  section('writes', 'init');
  const initiated = await mnema('writes', 'init');
  const anchor = name(after(initiated, '  identity:'), 'anchor');
  // The form the READS print, named by computing it here rather than by reading it
  // out of the output — which makes the name a CHECK. The short form is defined as
  // the anchor's own leading hex, so if a read ever printed something that is not a
  // prefix of the value (a hashed label, say) this substitution would miss it and
  // `assertNothingVolatile` would refuse the transcript rather than pin the lie.
  const short = name(anchor.slice(0, 'mnid:'.length + 8), 'anchor-short');
  name(
    after(initiated, '  backup key: created and enrolled — private half at '),
    'backup-key-path',
  );
  await mnema('writes', 'init');

  // ── Every read again, now over a project that holds nothing.
  await readEverything('an empty project', { anchor, short });

  // ── The session an agent works inside, and the writes pinned to it.
  section('writes', 'run start');
  const started = await mnema(
    'writes',
    'run',
    'start',
    '--which',
    'agent-alpha',
    '--goal',
    'set the record up',
  );
  const run1 = name(after(started, 'Started run '), 'run-first');
  process.env.MNEMA_RUN = run1;

  section('writes', 'the births');
  const task = await mnema('writes', 'task', 'Write the deploy runbook');
  const taskId = name(inParens(task, 'Created task '), 'task-runbook');
  name(after(task, 'Created task ').split(' ')[0] as string, 'task-runbook-alias');
  const chore = await mnema(
    'writes',
    'task',
    'Rotate the local credentials',
    '--scope',
    'private',
    '--which',
    'agent-alpha',
  );
  const choreId = name(inParens(chore, 'Created task '), 'task-chore');
  name(after(chore, 'Created task ').split(' ')[0] as string, 'task-chore-alias');
  const errand = await mnema('writes', 'task', 'Read the release notes', '--scope', 'global');
  name(inParens(errand, 'Created task '), 'task-errand');
  name(after(errand, 'Created task ').split(' ')[0] as string, 'task-errand-alias');

  // One of the two decisions records what it turned down and the other does not,
  // so the transcript pins BOTH halves of the form: the section when there is one,
  // and no section at all when there is none.
  const decision = await mnema(
    'writes',
    'decision',
    'Keep the runbook in the record',
    'a wiki page nobody owns goes stale',
    '--alternatives',
    'a shared spreadsheet: it has no history and nobody reviews it',
  );
  const decisionId = name(inParens(decision, 'Recorded decision '), 'decision-runbook');
  const older = await mnema(
    'writes',
    'decision',
    'Keep the runbook in the wiki',
    'it is where we look',
  );
  const olderId = name(inParens(older, 'Recorded decision '), 'decision-wiki');

  const skill = await mnema(
    'writes',
    'skill',
    'One slice per PR',
    '--body',
    'A slice is one reviewable change with its tests.',
  );
  const skillId = name(inParens(skill, 'Proposed skill '), 'skill-slices');
  const stale = await mnema(
    'writes',
    'skill',
    'Ship on Fridays',
    '--body',
    'Cut the release at the end of the week.',
    '--scope',
    'private',
  );
  const staleId = name(inParens(stale, 'Proposed skill '), 'skill-fridays');

  const memory = await mnema('writes', 'memory', 'the deploy runbook lives in the record now');
  const memoryId = name(after(memory, 'Captured memory '), 'memory-runbook');
  const personal = await mnema(
    'writes',
    'memory',
    'my own note about the runbook',
    '--scope',
    'global',
  );
  name(after(personal, 'Captured memory '), 'memory-personal');

  const observed = await mnema(
    'writes',
    'observe',
    taskId,
    '--topic',
    'review',
    '--text',
    'the runbook needs a rollback section',
  );
  const observationId = name(
    after(observed, 'Recorded observation ').split(' ')[0] as string,
    'observation-rollback',
  );

  await mnema('writes', 'handoff', taskId, 'agent-alpha', 'agent-beta');
  await mnema('writes', 'link', decisionId, taskId, '--rel', 'relates-to');
  await mnema('writes', 'link', taskId, choreId, '--rel', 'derived-from');

  // ── The moves: a task through the whole workflow and back twice (which is what
  //    makes it a recurring shape), a decision accepted and one superseded, a
  //    skill adopted and one deprecated.
  section('writes', 'the moves');
  await mnema('writes', 'task', 'move', 'submit', taskId);
  await mnema('writes', 'task', 'move', 'start', taskId);
  await mnema('writes', 'task', 'move', 'complete', taskId, '--note', 'the first draft is in');
  await mnema('writes', 'task', 'move', 'reopen', taskId, '--reason', 'it has no rollback section');
  await mnema('writes', 'task', 'move', 'submit_review', taskId);
  await mnema(
    'writes',
    'task',
    'move',
    'approve',
    taskId,
    '--note',
    'the rollback section reads well',
  );
  await mnema('writes', 'task', 'move', 'reopen', taskId, '--reason', 'the rollback step is wrong');
  await mnema('writes', 'decision', 'move', 'accept', decisionId, '--note', 'we agreed in review');
  await mnema(
    'writes',
    'decision',
    'supersede',
    olderId,
    decisionId,
    '--reason',
    'the record replaces it',
  );
  await mnema('writes', 'skill', 'move', 'review', skillId, '--note', 'it reads well');
  await mnema('writes', 'skill', 'move', 'adopt', skillId, '--note', 'we work this way already');
  await mnema('writes', 'skill', 'move', 'review', staleId, '--note', 'worth a look');
  await mnema('writes', 'skill', 'move', 'adopt', staleId, '--note', 'we tried it');
  await mnema(
    'writes',
    'skill',
    'move',
    'deprecate',
    staleId,
    '--reason',
    'nobody ships on a Friday',
  );

  // ── What the record held before the content door existed.
  section('writes', 'a record written before the content door');
  name(appendUnscreenedMemory(anchor), 'memory-unscreened');
  const scrubbed = await mnema(
    'writes',
    'memory',
    // Shaped exactly like a GitHub token (`ghp_` and 36 more characters), so the
    // content door replaces it and the write reports what it took out.
    'a note with a token in it: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  );
  name(after(scrubbed, 'Captured memory '), 'memory-scrubbed');

  // ── Closing the session, and opening a second one that stays open.
  section('writes', 'run end');
  await mnema(
    'writes',
    'run',
    'end',
    '--which',
    'agent-alpha',
    '--outcome',
    'the record is set up',
  );
  delete process.env.MNEMA_RUN;
  const second = await mnema(
    'writes',
    'run',
    'start',
    '--which',
    'agent-beta',
    '--goal',
    'read the record back',
  );
  const run2 = name(after(second, 'Started run '), 'run-second');

  // ── Every read again, over the populated record.
  await readEverything('a populated project', {
    anchor,
    short,
    task: taskId,
    decision: decisionId,
  });

  // ── The refusals: what a wrong invocation says, and that it exits non-zero.
  section('writes', 'refusals');
  await mnema('writes', 'task', 'A task with a bad scope', '--scope', 'elsewhere');
  await mnema('writes', 'task', 'A task an unnamed agent asked for', '--which', '   ');
  await mnema('writes', 'task', 'move', 'submit', taskId, '--scope', 'public');
  await mnema('writes', 'task', 'move', 'approve', taskId, '--note', 'not from here');
  await mnema('writes', 'task', 'move', 'submit', 'no-such-id');
  await mnema('writes', 'decision', 'move', 'accept', 'no-such-id', '--note', 'nothing to accept');
  await mnema('writes', 'skill', 'move', 'adopt', 'no-such-id', '--note', 'nothing to adopt');
  await mnema('writes', 'skill', 'A skill with no body');
  // Two ways `run end` refuses: with an agent but no run to close, and with a run but
  // no agent to credit the close to. The second is commander's own, and it is the one
  // that keeps the pair reading like the pair — `run start` refuses the same way.
  await mnema('writes', 'run', 'end', '--which', 'agent-beta');
  await mnema('writes', 'run', 'end', 'no-such-run');
  await mnema('writes', 'search', '--limit', '0');
  await mnema('writes', 'search', '--kind', 'memories');
  await mnema('writes', 'search', '--scope', 'elsewhere');
  await mnema('writes', 'refs', taskId, '--depth', 'deep');
  await mnema('writes', 'refs', taskId, '--direction', 'sideways');
  await mnema('writes', 'show', 'no-such-id');
  await mnema('writes', 'timeline', 'no-such-id');
  await mnema('writes', 'next-actions', 'no-such-id');
  await mnema('writes', 'key', 'enroll', 'not-a-request');
  // What a value naming no identity earns, on a read and on a write: the refusal
  // names the identities there are, in the form that can be pasted straight back.
  await mnema('writes', 'focus', '--actor', 'whoever');
  await mnema('writes', 'key', 'request', '--anchor', 'whoever');

  // ── The PARSER's refusals — one invocation per code the surface words, because
  //    they are the lines a person meets on their FIRST command and nothing pinned
  //    them. Each is the product speaking: what is missing and what it means (from
  //    the declaration the help prints), then the line to type (the same `usage()`).
  //    `--help` and `--version` are not here and must not be: they arrive by the same
  //    door and they are the caller getting exactly what they asked for.
  section('writes', 'refusals — what the parser turns down');
  await mnema('writes', 'decision', 'A decision with no rationale');
  await mnema('writes', 'task', 'A task', 'and one word too many');
  await mnema('writes', 'task', 'A task', '--bogus');
  await mnema('writes', 'task', 'A task', '--which');
  await mnema('writes', 'tsk', 'a verb nobody declared');
  await mnema('writes', 'run', 'nothing');

  // ── What a read could not have accepted: an empty argument in a field the catalog
  //    requires. Each of these WROTE a signed event before this door existed, and
  //    from then on every read of the project failed — so the refusal is the whole
  //    point, and the message names the field so the caller knows what to fix. One
  //    per kind the CLI can reach, plus both halves of an event (a payload field and
  //    the ENVELOPE's subject) and both classes (required, and optional-if-present).
  section('writes', 'refusals — what no read could accept');
  await mnema('writes', 'task', '');
  await mnema('writes', 'decision', '', 'a rationale with no title');
  await mnema('writes', 'skill', '', '--body', 'a body with no name');
  await mnema('writes', 'memory', '');
  await mnema('writes', 'observe', taskId, '--topic', '', '--text', 'a note with no topic');
  await mnema('writes', 'handoff', '', 'agent-alpha', 'agent-beta');
  await mnema('writes', 'link', taskId, decisionId, '--rel', '');
  await mnema('writes', 'run', 'start', '--which', 'agent-gamma', '--goal', '');
  await mnema('writes', 'run', 'end', run2, '--which', 'agent-beta', '--outcome', '');

  // ── The authorizing identity offered as the executing agent, in the SHORT form the
  //    reads print. The long form was always refused; the short one is a second
  //    spelling of the same identity and only became typeable when the reads began
  //    printing it.
  await mnema('writes', 'task', 'A task the anchor claims to have executed', '--which', short);

  // ── Every whole record `show` serves, one per kind it knows.
  // A record of every kind `show` knows, and both ends of a supersession: the
  // successor names what it replaced, the replaced one names what replaced it.
  section('reads', 'one whole record of each kind');
  for (const id of [taskId, decisionId, olderId, skillId, memoryId, observationId]) {
    await mnema('reads', 'show', id);
  }

  // ── The two verbs that speak for the machine's key rather than the record: the
  //    request a joining machine produces, and the refusal a malformed one earns.
  section('writes', 'the key roster');
  const requested = await mnema('writes', 'key', 'request', '--anchor', anchor);
  // Found by its own prefix, not by its position in the report: a line located by
  // counting would go unnamed the day a line is added above it, and an unnamed
  // request is a base64 blob that differs on every run.
  name(
    requested.find((line) => line.startsWith('mnema-key-request:')) as string,
    'enrollment-request',
  );

  // ── A second project on this machine, which is the run that finds the identity
  //    and the backup key already there rather than creating them.
  section('writes', 'a second project on this machine');
  const other = join(sandbox, 'other-project');
  mkdirSync(other, { recursive: true });
  process.chdir(other);
  await mnema('writes', 'init');
  process.chdir(repo);

  // ── The help of the program and of every verb, which is the other half of the
  //    surface: an option that quietly disappeared is a verb that lost a
  //    capability without a single output line changing.
  section('help', 'the program');
  await mnema('help', '--help');
  await mnema('help', '--version');
  for (const verb of [
    'init',
    'task',
    'decision',
    'skill',
    'memory',
    'observe',
    'handoff',
    'link',
    'run',
    'focus',
    'resume',
    'next-actions',
    'guard',
    'search',
    'show',
    'timeline',
    'accountability',
    'antipatterns',
    'exposure',
    'refs',
    'skills',
    'brief',
    'key',
    'verify',
    'mcp',
    'repl',
    'completion',
  ]) {
    section('help', `mnema ${verb} --help`);
    await mnema('help', verb, '--help');
  }
  for (const pair of [
    ['task', 'move'],
    ['decision', 'move'],
    ['decision', 'supersede'],
    ['skill', 'move'],
    ['run', 'start'],
    ['run', 'end'],
    ['key', 'restore'],
    ['key', 'request'],
    ['key', 'enroll'],
    ['key', 'revoke'],
  ]) {
    section('help', `mnema ${pair.join(' ')} --help`);
    await mnema('help', ...pair, '--help');
  }
}, 240_000);

afterAll(() => {
  process.chdir(cwdBefore);
  process.env = envBefore;
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the lines the CLI writes for a person', () => {
  it('reports every write exactly as it did', async () => {
    const text = scrub(transcript.writes);
    assertNothingVolatile(text);
    await expect(text).toMatchFileSnapshot('./cli.writes.golden.txt');
  });

  it('answers every read exactly as it did — human and JSON alike', async () => {
    const text = scrub(transcript.reads);
    assertNothingVolatile(text);
    await expect(text).toMatchFileSnapshot('./cli.reads.golden.txt');
  });

  it('offers every verb the same options, with the same help', async () => {
    const text = scrub(transcript.help);
    assertNothingVolatile(text);
    await expect(text).toMatchFileSnapshot('./cli.help.golden.txt');
  });
});
