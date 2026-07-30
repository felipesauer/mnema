#!/usr/bin/env node
/**
 * The `mnema` CLI: a thin transport over the command adapters.
 *
 * commander does the parsing, the subcommand dispatch, `--help`, and the error
 * shapes; each action reads the working directory and environment, calls ONE
 * command adapter (`runInit` / `runTask` / `runDecision` / `runSkill` /
 * `runMemory` / `runObserve` / `runHandoff` / `runLink` / …), and formats the
 * result.
 * There is no domain logic here and none in the adapters — the logic is the gate
 * and the projections in the core. This file only wires and prints.
 *
 * Output is injected ({@link CliIo}) so the whole program can be driven in a test
 * without spawning a process or writing to the real streams.
 */

import {
  type Exposure,
  type PatternProvenance,
  REFERENCE_DEFAULT_DEPTH,
  REFERENCE_MAX_DEPTH,
  type RecordBody,
  type RecordSearch,
  type ReferenceGraph,
} from '@mnema/copilot';
import {
  canonicalIdentity,
  IdentityUnavailableError,
  type Scope,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_KINDS,
  SEARCH_MAX_LIMIT,
  type SearchKind,
} from '@mnema/core';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { runAccountability } from './commands/accountability.js';
import { runAntipatterns } from './commands/antipatterns.js';
import { runDecision } from './commands/decision.js';
import { runDecisionTransition } from './commands/decision-transition.js';
import { runExposure } from './commands/exposure.js';
import { runFocus } from './commands/focus.js';
import { runGuard } from './commands/guard.js';
import { runHandoff } from './commands/handoff.js';
import { type InitResult, runInit } from './commands/init.js';
import { runKeyEnroll } from './commands/key-enroll.js';
import { runKeyRequest } from './commands/key-request.js';
import { runKeyRestore } from './commands/key-restore.js';
import { runKeyRevoke } from './commands/key-revoke.js';
import { runLink } from './commands/link.js';
import { runMemory } from './commands/memory.js';
import { runNextActions } from './commands/next-actions.js';
import { runObserve } from './commands/observe.js';
import { REFERENCE_DIRECTIONS, runReferences } from './commands/references.js';
import { runResume } from './commands/resume.js';
import { runRunEnd } from './commands/run-end.js';
import { runRunStart } from './commands/run-start.js';
import { runSearch } from './commands/search.js';
import { runShow } from './commands/show.js';
import { runSkill } from './commands/skill.js';
import { runSkillTransition } from './commands/skill-transition.js';
import { runSkills } from './commands/skills.js';
import { runTask } from './commands/task.js';
import { runTaskTransition } from './commands/task-transition.js';
import { runTimeline } from './commands/timeline.js';
import { runVerify } from './commands/verify.js';
import { discoveryEnv } from './env.js';
import { resolvePinnedRun } from './pinned-run.js';
import { RECORD_CONTRACT_HELP, type Replacement, replacementNotice } from './recorded-content.js';
import { A_PERSON, oneLine } from './served-patterns.js';

/** Where the CLI writes, and how it signals failure — injected for testing. */
export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Records a non-zero exit intent without killing the process under test. */
  readonly fail: () => void;
}

const processIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  fail: () => {
    process.exitCode = 1;
  },
};

/**
 * Leaves quietly when the reader goes away.
 *
 * `mnema … | head` closes the pipe while we are still writing, and node reports
 * that as an asynchronous `EPIPE` on the stream — which, unhandled, crashes with
 * a stack trace that reads like mnema failed. It did not: the reader stopped
 * listening, which is the normal end of a pipeline, and every Unix tool treats it
 * as one. The output that matters is already through, so exit clean rather than
 * complain into a pipe nobody is reading.
 *
 * Registered on the real streams only, at the entry — the injected io a test
 * drives never touches these.
 */
function exitQuietlyOnClosedPipe(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') process.exit(0);
      throw error;
    });
  }
}

/**
 * The help for `--which`, one wording on every writing verb.
 *
 * `which` is the agent that EXECUTED, and it is DECLARED, not detected — there is
 * nothing on a command line to detect it from. Omitting it says a person acted
 * directly, which is what the record then asserts, so an agent driving the CLI (a
 * script, a CI step, an agent with no MCP server) has to name itself or the record
 * credits its work to the person. The MCP surface has the same field filled from
 * the connecting client's name; this is the CLI's way to say the same thing.
 *
 * It also decides the default tree for a BIRTH: an agent's capture is high-volume
 * and lands private, a person's deliberate capture lands public. `--scope` still
 * overrides that.
 */
const WHICH_HELP =
  'the agent that executed this, when an agent (a script, a CI step) is driving ' +
  'mnema — omit it when you are acting directly. Declared, never assumed; a ' +
  "birth an agent makes defaults to this machine's private tree. A value that " +
  'names no agent (an unset variable) is refused, never credited to you.';

/**
 * What a `--which` that names nobody is told.
 *
 * It gives both ways out, because both are legitimate: name the agent, or drop the
 * flag. Dropping it is not a workaround — it is the truthful declaration when a
 * person is the one acting. And it names the accident that actually produces this,
 * because nobody types three spaces: a variable that expanded to nothing.
 */
const BLANK_WHICH_MESSAGE =
  'it names no agent. Name the agent that executed this, or omit --which — omitted, ' +
  'the record says a person acted directly. (A `--which "$AGENT"` with the variable ' +
  "empty would otherwise credit you for an agent's work.)";

/**
 * Validates a DECLARED `--which` where the value ENTERS the program.
 *
 * A `--which` that names no agent is not a missing declaration — it is an invalid
 * one: the caller said an agent executed this and then named none. Left alone the
 * record credits the PERSON, in two places at once. The value drops out of the
 * envelope (so every event asserts a human acted directly), and `resolveScope`
 * reads "no agent" and sends a birth to the team's COMMITTED tree instead of this
 * machine's private one. The way in is not malice: it is `--which "$AGENT_NAME"` in
 * a CI step with the variable unset.
 *
 * The rule is NOT the absent flag's. On this surface an omitted `--which` means "a
 * person acted directly" — legitimate, common, and what most people who type
 * `mnema` are. Defaulting it to some agent name would invent an agent where there
 * was a person: the same fiction, inverted, and worse. (The MCP surface DOES
 * default, for the opposite reason — a stdio connection is a program talking to a
 * program, so there "a person acted" cannot be true.)
 *
 * "Names an agent" is decided by {@link canonicalIdentity} and never by a trim of
 * our own: that is the rule which decides what the chain records, so a value it
 * reads as no identity is exactly a value that would vanish from the event. A
 * second reading of "blank" could disagree with the first, and a `which` that
 * passes in one place and disappears in another is the defect, not the detail.
 *
 * It runs as commander's own argument parser, which is what makes it ONE place for
 * the thirteen verbs that read the flag rather than thirteen copies: the check
 * happens at parse time, before any action, so no tree is resolved and nothing is
 * written. It also covers `task move` and its siblings for free — they read the
 * flag off the parent group where it is declared, and the parser belongs to the
 * declaration, not to the reading.
 *
 * It returns the value UNTOUCHED. Canonicalizing here would put a second cleaner
 * in front of the content door, which screens the value as GIVEN and then
 * canonicalizes, in that order and for a reason (see `resolveExecutingAgent`).
 */
function declaredAgent(value: string): string {
  if (canonicalIdentity(value) === undefined) throw new InvalidArgumentError(BLANK_WHICH_MESSAGE);
  return value;
}

/**
 * The `--which` reminder for a group's SUBCOMMAND (`task move`, `decision move`,
 * `decision supersede`, `skill move`).
 *
 * The flag is declared ONCE, on the group, and commander gives a group's option to
 * the group wherever it appears on the line — so `mnema task move submit <id>
 * --which <agent>` works, but the subcommand's own `--help` does not list a flag it
 * does not own. Declaring it on the subcommand too would not fix that: the group's
 * declaration SHADOWS it, the subcommand would read undefined, and the agent's
 * declaration would be silently dropped — the exact fiction `--which` exists to
 * close. So the reminder is help text, not a second declaration.
 *
 * It is worded for a MOVE, not copied from {@link WHICH_HELP}: the birth clause
 * there ("defaults to the private tree") is about where a new entity lands, and a
 * move lands wherever the entity already lives. Repeating it here would state a
 * rule that does not apply.
 */
const WHICH_ON_SUBCOMMAND_HELP = [
  '',
  'Also accepted here (declared on the parent group):',
  '  --which <agent>  the agent that executed this move, when an agent (a script,',
  '                   a CI step) is driving mnema — omit it when you are acting',
  '                   directly. It names the executor only: a move always follows',
  '                   the entity to the tree it was born in.',
].join('\n');

/**
 * The environment variable a shell carries an open session in, between the
 * `mnema run start` that opened it and the `mnema run end` that closes it.
 *
 * It is a variable and not a file because a session belongs to a SHELL: two
 * terminals may work in the same project inside different sessions, and a file
 * would make them fight over one. `run start` prints the export line for the
 * person to evaluate — a process cannot set a variable in the shell that spawned
 * it, and pretending otherwise would leave them wondering why nothing was pinned.
 */
const RUN_ENV = 'MNEMA_RUN';

/** Returned by {@link pinnedRunResolver} when the pinned run cannot be proven. */
const PIN_REFUSED = Symbol('pin-refused');

/**
 * Resolves — ONCE per command — the run this process's writes are pinned to.
 *
 * The value enters from outside (the {@link RUN_ENV} variable), which is exactly
 * why it is checked: a fact stamped with a run that does not exist is a broken
 * chain of authorization on an append-only log. It is checked HERE, at the
 * transport, rather than inside each write operation: per-operation validation
 * would replay the run projection on every append, including on the MCP path
 * where the run came from the server's own session and there is nothing to learn.
 *
 * The resolver is memoized so "once per command" is a property of the code and
 * not of how many verbs happen to ask. With the variable unset it returns before
 * any tree is resolved, so a person who never opened a session pays nothing — and
 * a refusal is reported once, here, in the same `Refused (CODE)` shape every
 * other refusal takes.
 */
function pinnedRunResolver(io: CliIo): () => string | undefined | typeof PIN_REFUSED {
  let settled = false;
  let pinned: string | undefined | typeof PIN_REFUSED;
  return () => {
    if (!settled) {
      settled = true;
      const resolved = resolvePinnedRun(
        { cwd: process.cwd(), env: discoveryEnv() },
        process.env[RUN_ENV],
      );
      if (resolved.ok) {
        pinned = resolved.run;
      } else {
        io.err(`Refused (${resolved.code}): ${resolved.message}`);
        pinned = PIN_REFUSED;
      }
    }
    return pinned;
  };
}

/** The scopes `--scope` accepts — the surface's view of the core's three trees. */
const SCOPES = ['public', 'private', 'global'] as const;

/**
 * Says what the content door replaced, after the line that says the write landed.
 *
 * Called by every writing verb, on the SUCCESS path, because a scrub is not a
 * refusal — the fact was recorded, with a placeholder in it. Printing nothing when
 * nothing was replaced is what keeps the ordinary write quiet: the notice appears
 * exactly when there is something to act on (see {@link replacementNotice}).
 */
function reportReplacement(result: Replacement, io: CliIo): void {
  for (const line of replacementNotice(result.replaced)) io.out(line);
}

/**
 * What `focus` and `resume` add when an actor has no run to report.
 *
 * The empty answer is the TRUTH for most people who use the CLI: a run is an
 * agent's session, and work a person does themselves has none — nor needs one,
 * since the `who` on each fact already carries the authority a run exists to
 * delegate. Left bare, though, the answer reads as something missing (and
 * "no runs YET" reads as a state about to change, which for that person it is
 * not). So the reads say what a run is and where one comes from, and stop
 * there — no invented state, no suggestion that anything is wrong.
 */
const NO_RUNS_HINT = [
  "  A run is an agent's working session. An MCP client opens one per connection;",
  '  on the command line, `mnema run start --which <agent>` opens one.',
  '  Work you do yourself is recorded without one.',
];

/** Returned by {@link parseScope} when the value is not a valid scope. */
const INVALID = Symbol('invalid-scope');

/**
 * Validates the `--scope` value on the surface. The set of scopes is closed and
 * known here (it is the core's `Scope`), so a bad value is a usage error the CLI
 * reports itself — not something to forward to the core. An absent flag returns
 * undefined (let the command apply its default); a bad one prints and returns the
 * {@link INVALID} sentinel so the action fails without a task being born.
 */
function parseScope(value: string | undefined, io: CliIo): Scope | undefined | typeof INVALID {
  if (value === undefined) return undefined;
  if ((SCOPES as readonly string[]).includes(value)) return value as Scope;
  io.err(`Invalid --scope "${value}". Use one of: ${SCOPES.join(', ')}.`);
  return INVALID;
}

/** Returned by {@link parseLimit} when the value is not a positive whole number. */
const INVALID_LIMIT = Symbol('invalid-limit');

/**
 * Validates `--limit` on the surface. commander hands every option through as a
 * string, and a silent `NaN` would turn "show me 10" into the default without
 * saying so. An absent flag returns undefined (the read applies its own default
 * and cap).
 */
function parseLimit(
  value: string | undefined,
  io: CliIo,
): number | undefined | typeof INVALID_LIMIT {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    io.err(`Invalid --limit "${value}". Use a whole number of 1 or more.`);
    return INVALID_LIMIT;
  }
  return limit;
}

/**
 * Prints a search as a person reads it: a header saying how much matched and how
 * much is shown, then the hits GROUPED BY KIND.
 *
 * The grouping is presentation and only presentation — the read returns one
 * ordered list, and `--json` emits exactly that. Grouping here is the CLI's
 * judgement that a person scanning a terminal finds a decision faster among
 * decisions; an agent, which consumes the JSON, is better served by the single
 * ranked list. The groups follow the record's own kind order, and within a group
 * the served order is untouched, so the output is stable for the same query.
 *
 * ONE LINE PER HIT, and here the count is printed right above it: a title is text
 * an actor wrote, and one holding a newline would put a second line under a group
 * whose header says how many there are — an id, a tree and a state for a record
 * nothing ever wrote, with the count beside it saying otherwise. `--json` carries
 * each title as written (see {@link oneLine}).
 */
function printSearch(result: RecordSearch, term: string | undefined, io: CliIo): void {
  const forTerm = term !== undefined && term.trim() !== '' ? ` matching "${term}"` : '';
  if (result.hits.length === 0) {
    io.out(term !== undefined ? `Nothing recorded${forTerm}.` : 'Nothing recorded here yet.');
    return;
  }
  // "5 of 137" is the honest header when the limit cut the answer: a capped list
  // that does not say it was capped reads as everything there is.
  const shown =
    result.total > result.hits.length
      ? `${result.hits.length} of ${result.total}`
      : `${result.total}`;
  io.out(`${shown} record(s)${forTerm}:`);
  for (const kind of SEARCH_KINDS) {
    const group = result.hits.filter((hit) => hit.kind === kind);
    if (group.length === 0) continue;
    io.out('');
    io.out(`${kind} (${group.length})`);
    for (const hit of group) {
      const state = hit.state !== undefined ? ` (${hit.state})` : '';
      io.out(`  ${hit.id}  ${hit.scope}  ${hit.at.slice(0, 10)}  ${oneLine(hit.title)}${state}`);
    }
  }
}

/**
 * Prints one whole record: a header line naming what it is and where it lives,
 * then the fields that kind actually has. A memory is its content, a decision is
 * its rationale, an observation is what it is about — printing one shape for all
 * five would hide exactly the field the reader opened the record for.
 */
function printRecord(body: RecordBody, io: CliIo): void {
  io.out(`${body.kind} ${body.id}  ·  ${body.scope}`);
  switch (body.kind) {
    case 'memory':
      io.out(`  captured ${body.record.capturedAt} by ${body.record.who}`);
      io.out('');
      io.out(body.record.content);
      break;
    case 'observation':
      io.out(`  about ${body.record.about} · recorded ${body.record.recordedAt}`);
      io.out(`  topic: ${body.record.topic}`);
      io.out('');
      io.out(body.record.text);
      break;
    case 'decision':
      io.out(`  ${body.record.adr} — ${body.record.title} (${body.record.state})`);
      if (body.record.supersedes !== undefined) io.out(`  supersedes ${body.record.supersedes}`);
      if (body.record.supersededBy !== undefined) {
        io.out(`  superseded by ${body.record.supersededBy}`);
      }
      io.out('');
      io.out(body.record.rationale);
      break;
    case 'task':
      io.out(`  ${body.record.title} (${body.record.state})`);
      io.out(`  created ${body.record.createdAt} · updated ${body.record.updatedAt}`);
      break;
    case 'skill':
      io.out(`  ${body.record.name} (${body.record.state})`);
      io.out('');
      io.out(body.record.body);
      break;
  }
}

/**
 * Prints the reference graph as an entity and the edges around it: what points
 * INTO it (`←`) and what it points AT (`→`), each with the relation as written
 * and the tree the assertion lives in.
 *
 * The entity's OWN edges come first, whatever their instant, and the edges further
 * out follow. `--json` emits the read's single instant-ordered list; this grouping
 * is the terminal's judgement that a reader looking at one thing wants that
 * thing's own connections at the top. Beyond one hop the nodes are then listed by
 * distance, because at that point the edge list stops reading as a shape and the
 * distances are what the reader came for.
 *
 * An unresolved far end is marked, never dropped: the reference is a fact even
 * when the thing it names is not visible from here. And when the depth cut the
 * answer the last line says so — a bounded answer that does not say it was
 * bounded reads as everything there is.
 */
function printReferences(graph: ReferenceGraph, io: CliIo): void {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const origin = nodes.get(graph.id);
  const known = origin?.resolved === true ? (origin.kind ?? 'entity') : 'unresolved';
  io.out(`${graph.id}  ·  ${known}`);
  if (graph.links.length === 0) {
    io.out('  nothing references it, and it references nothing.');
    return;
  }
  const label = (id: string) => {
    const node = nodes.get(id);
    if (node === undefined) return id;
    if (!node.resolved) return `${id} (unresolved)`;
    return node.kind !== undefined ? `${id} (${node.kind})` : id;
  };
  const touchesOrigin = (link: ReferenceGraph['links'][number]) =>
    link.from === graph.id || link.to === graph.id;
  for (const link of [
    ...graph.links.filter(touchesOrigin),
    ...graph.links.filter((l) => !touchesOrigin(l)),
  ]) {
    const rel = link.rel !== undefined ? `${link.role}:${link.rel}` : link.role;
    if (link.from === graph.id) io.out(`  → ${rel}  ${label(link.to)}  [${link.scope}]`);
    else if (link.to === graph.id) io.out(`  ← ${rel}  ${label(link.from)}  [${link.scope}]`);
    else io.out(`    ${label(link.from)} → ${rel} → ${label(link.to)}  [${link.scope}]`);
  }
  if (graph.depth > 1) {
    io.out('');
    for (const node of graph.nodes) {
      if (node.depth === 0) continue;
      io.out(`  ${node.depth} hop(s)  ${label(node.id)}`);
    }
  }
  if (graph.truncated) {
    io.out('');
    io.out(`  cut at ${graph.depth} hop(s) — more lies beyond. Raise --depth to see it.`);
  }
}

/**
 * Prints the exposure report: a header with the count and how much was read, then
 * one line per record — where it is, when it was written, and WHICH CLASS was
 * found.
 *
 * The line carries no value, because the report carries none. It leads with the
 * tree, because that is what decides how far the exposure travelled: a `public`
 * finding is committed and on every machine that cloned the repository, and a
 * `global` one is on this disk. Then the instruction, once, at the bottom: the record
 * is permanent, so rotating is the remedy — nothing here deletes a fact, and
 * pretending otherwise would send someone looking for a command that does not
 * exist. The empty answer says "nothing RECOGNIZABLE", never "nothing": the
 * detector reads formats, and a password in prose has no format.
 *
 * And it says WHERE IT LOOKED, which the count alone does not. A denominator beside an
 * empty list reads as ground covered, and this command covers one project — the one
 * `cwd` resolves to — plus the machine-global tree. Naming that is what keeps "nothing
 * recognizable here" from being read as "nothing anywhere"; the MCP tool, which a
 * client can open on several projects at once, answers with one count per project for
 * the same reason.
 */
function printExposure(report: Exposure, io: CliIo): void {
  if (report.findings.length === 0) {
    io.out(`Nothing recognizable in ${report.scanned} record(s).`);
    io.out('  Read here: this project’s trees and the machine-global tree — no other project.');
    io.out('  That is not the same as nothing: only known credential formats are recognized.');
    return;
  }
  io.out(`${report.findings.length} of ${report.scanned} record(s) hold a credential format:`);
  for (const finding of report.findings) {
    io.out(
      `  ${finding.scope}  ${finding.at.slice(0, 10)}  ${finding.kind}  ${finding.id}  ` +
        finding.classes.join(', '),
    );
  }
  io.out('');
  io.out('  These records are permanent — nothing deletes a fact. Rotate the credentials.');
  io.out('  A public record is committed and on every machine that cloned the repository.');
}

/**
 * Prints the provenance of every pattern: one line each, with the state and the
 * tree first and the two acts after it.
 *
 * The id leads, as it does in `search`, because it is what the next command takes.
 * Then the state and the tree, which together say how far the pattern reaches —
 * only an `adopted` one is served to an agent, and the tree decides whether that
 * is this machine, every project on it, or every machine that clones the
 * repository. Then the two acts, in the order they happened.
 *
 * An act with no agent reads as "a person", never as blank: an absent `which` is a
 * fact (someone acted directly), and a gap there would read as data the record
 * failed to keep. The same-agent case is stated as what it is — one name on both
 * ends — and nothing here calls that good or bad; a reader with the context
 * decides, which is exactly why this report exists on the surface a person uses.
 *
 * ONE LINE PER PATTERN, always — and that holds for EVERY field on the line, not
 * just the name. The name and the two agent names are all text an actor wrote, and
 * any one of them holding a newline would split the entry in two, the second half
 * reading as a provenance line of its own and asserting an adoption that never
 * happened. `--json` carries each value as written; this report carries them on one
 * line (see {@link oneLine}).
 */
function printPatternProvenance(patterns: readonly PatternProvenance[], io: CliIo): void {
  if (patterns.length === 0) {
    io.out('No patterns recorded in the trees visible from here.');
    return;
  }
  io.out(`${patterns.length} pattern(s):`);
  for (const pattern of patterns) {
    const acts = [`proposed by ${oneLine(pattern.proposedBy ?? A_PERSON)}`];
    if (pattern.adoption !== undefined) {
      acts.push(
        `adopted by ${oneLine(pattern.adoption.by ?? A_PERSON)}` +
          (pattern.selfAdopted ? ' (the same agent)' : ''),
      );
    }
    io.out(
      `  ${pattern.id}  ${pattern.state.padEnd(10)}  ${pattern.scope.padEnd(7)}  ` +
        `${oneLine(pattern.name)}  ·  ${acts.join(' · ')}`,
    );
  }
}

/**
 * Reports what establishing the identity did, on the one occasion it matters:
 * the run that created the tree.
 *
 * The line that earns its place is the backup key's — a key the person cannot
 * regenerate and cannot recover, because mnema has no central recovery. When
 * this run created it, the person is told WHERE the private half is and that it
 * has to leave the machine: a backup that stays on this disk is lost with the
 * disk, which is the exact loss it exists to survive. That warning is printed
 * only on the run that creates the key — repeated on every init it would become
 * noise a person learns to scroll past.
 *
 * A registered key this tree refused is always reported, never swallowed: a
 * person who believes they hold a usable backup and does not is worse off than
 * one who knows. For the same reason every OTHER key the tree enrolled is named
 * too — the backup is not the only key a roster can hold, and enrolling one
 * changes WHO may speak for the identity. That is not something to learn by
 * reading the chain later.
 */
function reportIdentity(identity: InitResult['identity'], io: CliIo): void {
  if (identity === undefined) return;
  const backup = identity.backup;
  if (backup?.created === true) {
    io.out(`  backup key: created and enrolled — private half at ${backup.privateKeyPath}`);
    io.out('  Move that file off this machine: a backup left on this disk is lost with it.');
  } else if (backup !== null && identity.enrolled.includes(backup.fingerprint)) {
    io.out('  backup key: enrolled in this project');
  }
  for (const fingerprint of identity.enrolled) {
    if (fingerprint === backup?.fingerprint) continue;
    io.out(`  key ${fingerprint} enrolled in this project`);
  }
  for (const declined of identity.declined) {
    io.out(`  key ${declined.fingerprint} was NOT enrolled: ${declined.reason}`);
  }
}

/** Builds the configured `mnema` program. `io` defaults to the real streams. */
export function buildProgram(io: CliIo = processIo): Command {
  const program = new Command();
  program
    .name('mnema')
    .description('A tamper-evident, local-first audit chain for AI-agent work.')
    .version('0.0.0')
    // Throw instead of calling process.exit, so the whole program can be driven
    // in a test — {@link run} turns the thrown CommanderError into an exit code.
    .exitOverride()
    // Route commander's own output (help, usage errors) through the injected io.
    .configureOutput({
      writeOut: (str) => io.out(str.replace(/\n$/, '')),
      writeErr: (str) => io.err(str.replace(/\n$/, '')),
    });

  // The open session's run, resolved lazily and at most once (see
  // {@link pinnedRunResolver}). Every WRITING verb asks it and forwards what it
  // returns; the reads, `init`, `verify`, `key` and `run` itself never do —
  // none of them stamps a `run`, so none of them has a reason to prove one.
  const pinnedRun = pinnedRunResolver(io);

  program
    .command('init')
    .description('establish a mnema project in the current directory')
    .action(() => {
      const result = runInit({ cwd: process.cwd(), env: discoveryEnv() });
      if (result.created) {
        io.out(`Initialized mnema project at ${result.root}`);
        io.out(`  identity: ${result.anchor}`);
        reportIdentity(result.identity, io);
        io.out('  registered in the project index');
      } else {
        io.out(`Already a mnema project at ${result.root} — nothing to found.`);
        io.out(`  identity: ${result.anchor}`);
        io.out('  index entry re-asserted');
      }
    });

  // `task` is a group: its default action creates (`mnema task "<title>"`),
  // and its one subcommand moves an existing task through the workflow
  // (`mnema task move <action> <id>`). Create takes an optional `--scope` — the
  // per-action override for where the task is born; omitted, it defaults to
  // public (the provisional default). `move` takes NO scope: a move follows the
  // entity to the tree it was born in, never a scope the caller picks.
  //
  // `--which` is declared HERE, on the group, and serves both the create and the
  // move: commander hands a group's option to the group wherever it appears on the
  // line, so the move reads it off the parent (see {@link
  // WHICH_ON_SUBCOMMAND_HELP}). Unlike `--scope`, which the move rejects, `--which`
  // is honored on a move — the agent that executed a transition is exactly what the
  // record should name.
  const task = program
    .command('task')
    .description('create a task in the current project')
    .argument('<title>', 'the task title')
    .option(
      '--scope <scope>',
      'where the task is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action((title: string, opts: { scope?: string; which?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runTask(
        { cwd: process.cwd(), env: discoveryEnv() },
        {
          title,
          ...(scope !== undefined ? { scope } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        },
      );
      if (result.ok) {
        io.out(`Created task ${result.alias} (${result.id})`);
        reportReplacement(result, io);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema init` first.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

  // One generic move: the action is an argument the gate validates, not a
  // hardcoded per-action command. The surface knows nothing of the transition
  // table — it forwards the action string and whichever proof flag was given,
  // and prints the gate's own verdict (the new state, or a typed refusal).
  //
  // A move takes NO `--scope`: a transition follows the entity to the tree it
  // was born in, never a scope the caller picks — routing it elsewhere would
  // split the task's history across the public/private boundary. Because `move`
  // sits under `task`, commander lets `task`'s `--scope` be parsed here too, so
  // the move REJECTS it explicitly (read off the parent's opts) rather than
  // silently ignoring it.
  const move = task
    .command('move')
    .description('move a task through the workflow (follows the task; takes no --scope)')
    .argument(
      '<action>',
      'the transition (submit, start, block, unblock, submit_review, ' +
        'request_changes, approve, complete, cancel, reopen)',
    )
    .argument('<id>', 'the task id (the value shown when it was created)')
    .option('--reason <text>', 'why (required by cancel, block, reopen)')
    .option('--note <text>', 'what was done (required by complete, approve)')
    .option('--feedback <text>', 'what must change (required by request_changes)')
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  move.action(
    (action: string, id: string, opts: { reason?: string; note?: string; feedback?: string }) => {
      // Both `--scope` and `--which` on a move are parsed into `task`'s options
      // (the parent), because that is where they are declared. Their verdicts
      // differ: a `--scope` means the caller tried to scope a move, which the model
      // forbids — the move follows the entity's home tree, not a chosen scope — so
      // it is rejected; a `--which` is the agent that executed the move, which the
      // record should name, so it is forwarded.
      const parentOpts = (move.parent?.opts() ?? {}) as { scope?: string; which?: string };
      if (parentOpts.scope !== undefined) {
        io.err('`task move` takes no --scope: a move follows the task to the tree it was born in.');
        io.fail();
        return;
      }
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runTaskTransition(
        { cwd: process.cwd(), env: discoveryEnv() },
        {
          id,
          action,
          proof: {
            ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
            ...(opts.note !== undefined ? { note: opts.note } : {}),
            ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
          },
          ...(parentOpts.which !== undefined ? { which: parentOpts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        },
      );
      if (result.ok) {
        io.out(`Task ${result.alias} → ${result.to}`);
        reportReplacement(result, io);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema init` first.');
      } else if (result.reason === 'UNKNOWN_TASK') {
        io.err(`No task ${id} here.`);
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    },
  );

  // `decision` is a group, shaped like `task`: its default action records a
  // decision (`mnema decision "<title>" "<rationale>"`), and its subcommands move
  // an existing one. A decision needs BOTH a title and a rationale, so both are
  // required positionals — a missing one is the parser's clear error, not a late
  // gate refusal. Record takes an optional `--scope` (the per-action birth
  // override, defaulting to public); the moves take none (they follow the
  // entity). A decision has no alias — record prints its frozen `ADR-<n>` label.
  const decision = program
    .command('decision')
    .description('record a decision in the current project')
    .argument('<title>', 'the decision title')
    .argument('<rationale>', 'why the decision was made')
    .option(
      '--scope <scope>',
      'where the decision is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action((title: string, rationale: string, opts: { scope?: string; which?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runDecision(
        { cwd: process.cwd(), env: discoveryEnv() },
        {
          title,
          rationale,
          ...(scope !== undefined ? { scope } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        },
      );
      if (result.ok) {
        io.out(`Recorded decision ${result.adr} (${result.id})`);
        reportReplacement(result, io);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema init` first.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

  // `decision move <accept|reject> <id>` — the generic move, the sibling of
  // `task move`. The action is an argument the gate validates; the surface knows
  // no transition table. It takes NO `--scope` (a move follows the entity), and
  // rejects one that leaks in from the `decision` group's option. Supersede is
  // deliberately NOT routed here — it needs a successor `by` this generic form
  // has nowhere to take; it is its own verb below.
  const decisionMove = decision
    .command('move')
    .description('accept or reject a decision (follows the decision; takes no --scope)')
    .argument('<action>', 'the transition: accept or reject')
    .argument('<id>', 'the decision id (the value shown when it was recorded)')
    .option('--note <text>', 'why this verdict (required by accept and reject)')
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  decisionMove.action((action: string, id: string, opts: { note?: string }) => {
    const parentOpts = (decisionMove.parent?.opts() ?? {}) as { scope?: string; which?: string };
    if (parentOpts.scope !== undefined) {
      io.err(
        '`decision move` takes no --scope: a move follows the decision to the tree it was born in.',
      );
      io.fail();
      return;
    }
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runDecisionTransition(
      { cwd: process.cwd(), env: discoveryEnv() },
      {
        id,
        action,
        proof: { ...(opts.note !== undefined ? { note: opts.note } : {}) },
        ...(parentOpts.which !== undefined ? { which: parentOpts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      },
    );
    reportDecisionMove(result, id, io);
  });

  // `decision supersede <old-id> <new-id> --reason` — supersede as its own verb.
  // A supersede replaces one decision with a later one, so it needs the successor
  // id (`by`), taken as a required positional so the parser demands the pair on
  // input rather than the gate refusing it late. Like every move it follows the
  // entity and takes no `--scope`.
  const supersede = decision
    .command('supersede')
    .description('supersede a decision with a later one (follows the decision; takes no --scope)')
    .argument('<old-id>', 'the decision being superseded')
    .argument('<new-id>', 'the successor decision that replaces it')
    .option('--reason <text>', 'why it is being replaced (required)')
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  supersede.action((oldId: string, newId: string, opts: { reason?: string }) => {
    const parentOpts = (supersede.parent?.opts() ?? {}) as { scope?: string; which?: string };
    if (parentOpts.scope !== undefined) {
      io.err(
        '`decision supersede` takes no --scope: a move follows the decision to the tree it was born in.',
      );
      io.fail();
      return;
    }
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runDecisionTransition(
      { cwd: process.cwd(), env: discoveryEnv() },
      {
        id: oldId,
        action: 'supersede',
        by: newId,
        proof: { ...(opts.reason !== undefined ? { reason: opts.reason } : {}) },
        ...(parentOpts.which !== undefined ? { which: parentOpts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      },
    );
    reportDecisionMove(result, oldId, io);
  });

  // `skill` is a group, shaped like `task` and `decision`: its default action
  // proposes a skill (`mnema skill "<name>" --body "<text>"`), and its one
  // subcommand moves an existing one. A skill needs BOTH a name and a body; the
  // name is a short positional, the body a flag (`--body`) — content that big
  // never goes in a positional (the `git commit -m` / `gh --body` convention).
  // The body is required, but NOT declared as commander's `requiredOption`: an
  // option on the GROUP is inherited by the `move` subcommand, and a required one
  // there would force `--body` on a move too. So it is a plain option the create
  // action checks itself — a missing `--body` on a propose is a usage error the
  // CLI reports (nothing is born), while `move` is unaffected. Propose takes an
  // optional `--scope` (the per-action birth override, defaulting to public); the
  // move takes none (it follows the entity). A skill has no alias — propose prints
  // its `name` and its `id` (the key).
  const skill = program
    .command('skill')
    .description('propose a reusable skill in the current project')
    .argument('<name>', 'a short title for the pattern')
    .option('--body <text>', 'the reusable pattern itself (required)')
    .option(
      '--scope <scope>',
      'where the skill is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action((name: string, opts: { body?: string; scope?: string; which?: string }) => {
      // The body is required for a propose, but declared as a plain option (so it
      // is not inherited as mandatory by `move`); enforce it here.
      if (opts.body === undefined) {
        io.err('`mnema skill` requires --body: the reusable pattern itself.');
        io.fail();
        return;
      }
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runSkill(
        { cwd: process.cwd(), env: discoveryEnv() },
        {
          name,
          body: opts.body,
          ...(scope !== undefined ? { scope } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        },
      );
      if (result.ok) {
        // Print both the name (orients the human) and the id (the key a move
        // takes) — a skill has no alias.
        io.out(`Proposed skill "${result.name}" (${result.id})`);
        reportReplacement(result, io);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema init` first.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

  // `skill move <action> <id>` — the generic move, the sibling of `task move`.
  // The action is an argument; the surface knows no transition table. It takes
  // NO `--scope` (a move follows the entity), and rejects one that leaks in from
  // the `skill` group's option — routing a move elsewhere would split the skill's
  // history across the public/private boundary.
  const skillMove = skill
    .command('move')
    .description('move a skill through the workflow (follows the skill; takes no --scope)')
    .argument('<action>', 'the transition: review, adopt, reject, or deprecate')
    .argument('<id>', 'the skill id (the value shown when it was proposed)')
    .option('--note <text>', 'why this verdict (required by review, adopt, reject)')
    .option('--reason <text>', 'why it fell out of use (required by deprecate)')
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  skillMove.action((action: string, id: string, opts: { note?: string; reason?: string }) => {
    const parentOpts = (skillMove.parent?.opts() ?? {}) as { scope?: string; which?: string };
    if (parentOpts.scope !== undefined) {
      io.err('`skill move` takes no --scope: a move follows the skill to the tree it was born in.');
      io.fail();
      return;
    }
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runSkillTransition(
      { cwd: process.cwd(), env: discoveryEnv() },
      {
        id,
        action,
        proof: {
          ...(opts.note !== undefined ? { note: opts.note } : {}),
          ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
        },
        ...(parentOpts.which !== undefined ? { which: parentOpts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      },
    );
    if (result.ok) {
      io.out(`Skill "${result.name}" → ${result.to}`);
      reportReplacement(result, io);
      return;
    }
    if (result.reason === 'NO_PROJECT') {
      io.err('No mnema project here. Run `mnema init` first.');
    } else if (result.reason === 'UNKNOWN_SKILL') {
      io.err(`No skill ${id} here.`);
    } else {
      io.err(`Refused (${result.code}): ${result.message}`);
    }
    io.fail();
  });

  // The four KNOWLEDGE verbs — `memory`, `observe`, `handoff`, `link`. Unlike
  // task/decision/skill they are not groups: each is a single top-level verb (the
  // `git commit` / `init` / `verify` shape), because a knowledge fact is one
  // atomic append with no CRUD family and no `move` — there is no state to
  // transition and so no subcommand. They are FACTS: one append, no gate, no
  // state. Each takes the birth `--scope` override (they are all births), and
  // NONE validates the ids it references — the core resolves a dangling reference
  // on read (an honest cross-tree assertion), and the surface only forwards.

  // `mnema memory "<content>"` — capture a memory. The content is a positional:
  // this is quick capture (jrnl/todo.txt), where the content IS the command and
  // competes with no label, so it needs no flag.
  program
    .command('memory')
    .description('capture a memory in the current project')
    .argument('<content>', 'the memory to record')
    .option(
      '--scope <scope>',
      'where the memory is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action((content: string, opts: { scope?: string; which?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runMemory(
        { cwd: process.cwd(), env: discoveryEnv() },
        {
          content,
          ...(scope !== undefined ? { scope } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        },
      );
      if (result.ok) {
        io.out(`Captured memory ${result.id}`);
        reportReplacement(result, io);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema init` first.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

  // `mnema observe <about> --topic "<t>" --text "<obs>"` — record an observation
  // about an entity. `about` is a positional (a short id); the topic and the text
  // are flags — the text would compete with about/topic for the tail of the line,
  // so it is named (the `gh issue comment --body` convention). `about` is NOT
  // validated — a dangling reference is honest cross-tree.
  program
    .command('observe')
    .description('record an observation about an entity in the current project')
    .argument('<about>', 'the id of the entity being observed (a task, decision, …)')
    .requiredOption('--topic <label>', 'a short topic label')
    .requiredOption('--text <text>', 'the observation itself')
    .option(
      '--scope <scope>',
      'where the observation is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(
      (about: string, opts: { topic: string; text: string; scope?: string; which?: string }) => {
        const scope = parseScope(opts.scope, io);
        if (scope === INVALID) {
          io.fail();
          return;
        }
        const run = pinnedRun();
        if (run === PIN_REFUSED) {
          io.fail();
          return;
        }
        const result = runObserve(
          { cwd: process.cwd(), env: discoveryEnv() },
          {
            about,
            topic: opts.topic,
            text: opts.text,
            ...(scope !== undefined ? { scope } : {}),
            ...(opts.which !== undefined ? { which: opts.which } : {}),
            ...(run !== undefined ? { run } : {}),
          },
        );
        if (result.ok) {
          io.out(`Recorded observation ${result.id} about ${about}`);
          reportReplacement(result, io);
          return;
        }
        if (result.reason === 'NO_PROJECT') {
          io.err('No mnema project here. Run `mnema init` first.');
        } else {
          io.err(`Refused (${result.code}): ${result.message}`);
        }
        io.fail();
      },
    );

  // `mnema handoff <task> <from> <to>` — record a handoff on a task. Three
  // positionals: all short ids/labels, none a body of text. It mints no id (the
  // subject IS the task), so the report echoes the fact. `from == to` is
  // legitimate (a chat restart) and the `task` reference is not validated.
  program
    .command('handoff')
    .description('record a handoff on a task in the current project')
    .argument('<task>', 'the task the handoff is about')
    .argument('<from>', 'the agent handing off')
    .argument('<to>', 'the agent taking over (may equal <from>: a chat restart)')
    .option(
      '--scope <scope>',
      'where the handoff is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    // The agent RECORDING the handoff, which is not necessarily either of the two
    // agents it is about — `<from>`/`<to>` are the subject, `--which` is the author.
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action((task: string, from: string, to: string, opts: { scope?: string; which?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runHandoff(
        { cwd: process.cwd(), env: discoveryEnv() },
        {
          task,
          fromAgent: from,
          toAgent: to,
          ...(scope !== undefined ? { scope } : {}),
          ...(opts.which !== undefined ? { which: opts.which } : {}),
          ...(run !== undefined ? { run } : {}),
        },
      );
      if (result.ok) {
        // No id to report — a handoff has no standalone identity. Echo the fact.
        io.out(`Recorded handoff on ${result.task}: ${result.fromAgent} → ${result.toAgent}`);
        reportReplacement(result, io);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema init` first.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

  // `mnema link <subject> <target> --rel <label>` — link one entity to another.
  // subject and target are positionals (short ids); the relation is a flag. The
  // relation is an OPEN string — the recommended set (supersedes, relates-to,
  // derived-from, contradicts) is documentation, not enforcement, so no enum. It
  // mints no id (a link is an edge), so the report echoes the fact. Neither
  // reference is validated — a link is legitimately cross-tree.
  program
    .command('link')
    .description('link one piece of knowledge to another in the current project')
    .argument('<subject>', 'the entity that originates the link')
    .argument('<target>', 'the entity linked to')
    .requiredOption(
      '--rel <label>',
      'the relation (recommended: supersedes, relates-to, derived-from, contradicts; ' +
        'any label is accepted)',
    )
    .option(
      '--scope <scope>',
      'where the link is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(
      (subject: string, target: string, opts: { rel: string; scope?: string; which?: string }) => {
        const scope = parseScope(opts.scope, io);
        if (scope === INVALID) {
          io.fail();
          return;
        }
        const run = pinnedRun();
        if (run === PIN_REFUSED) {
          io.fail();
          return;
        }
        const result = runLink(
          { cwd: process.cwd(), env: discoveryEnv() },
          {
            subject,
            target,
            rel: opts.rel,
            ...(scope !== undefined ? { scope } : {}),
            ...(opts.which !== undefined ? { which: opts.which } : {}),
            ...(run !== undefined ? { run } : {}),
          },
        );
        if (result.ok) {
          // No id to report — a link is an edge, not an entity. Echo the fact.
          io.out(`Linked ${result.subject} —${result.rel}→ ${result.target}`);
          reportReplacement(result, io);
          return;
        }
        if (result.reason === 'NO_PROJECT') {
          io.err('No mnema project here. Run `mnema init` first.');
        } else {
          io.err(`Refused (${result.code}): ${result.message}`);
        }
        io.fail();
      },
    );

  // `run` is a group, and the only one whose subject is a SESSION rather than a
  // piece of the record: `start` opens the session an agent works inside, `end`
  // seals it. A run is the unit of AUTHORIZATION — it records that a human opened
  // a session for an agent, and every fact written inside it inherits that chain.
  // The MCP server opens one per connection; these two verbs are how an agent
  // working through the CLI (a script, a CI step, an agent with no MCP) gets one.
  //
  // Neither verb takes `--scope`: a run is born in this machine's PRIVATE tree,
  // where runs live and where `focus`/`resume` read them. A work session is local
  // by nature, and letting one land in the team's tree would fill it with
  // sessions. Neither stamps a `run` on its own envelope either — a run's birth
  // and its close ARE the run (its subject), so they belong to no parent session.
  const runGroup = program
    .command('run')
    .description('open and close the session an agent works inside')
    .addHelpText('after', RECORD_CONTRACT_HELP);

  // `mnema run start --which <agent> [--goal <text>]`. The agent is REQUIRED, and
  // that is the model rather than strictness: a run with no agent proves no
  // delegation — it degrades into a correlation id, which is what makes a run
  // worth writing in the first place. Declaring it on this SUBCOMMAND (not on the
  // group) keeps it off `run end`, which needs no agent.
  runGroup
    .command('start')
    .description('open a session for an agent (facts written in it are pinned to it)')
    .requiredOption(
      '--which <agent>',
      'the agent this session is for — required: a run with no agent authorizes nothing',
      declaredAgent,
    )
    .option('--goal <text>', 'what this session sets out to do')
    .action((opts: { which: string; goal?: string }) => {
      const result = runRunStart(
        { cwd: process.cwd(), env: discoveryEnv() },
        { agent: opts.which, ...(opts.goal !== undefined ? { goal: opts.goal } : {}) },
      );
      if (!result.ok) {
        if (result.reason === 'NO_PROJECT') {
          io.err('No mnema project here. Run `mnema init` first.');
        } else {
          io.err(`Refused (${result.code}): ${result.message}`);
        }
        io.fail();
        return;
      }
      io.out(`Started run ${result.id}`);
      // Both halves AS RECORDED, never as typed: echoing `opts.goal` would print a
      // credential on the line directly above the one reporting it was replaced.
      io.out(`  for ${result.agent}${result.goal !== undefined ? ` — ${result.goal}` : ''}`);
      reportReplacement(result, io);
      // The export line alone, so it can be selected, pasted or eval'd. A process
      // cannot set a variable in the shell that started it, so printing the line
      // is the whole of what this command can honestly do about it.
      io.out('');
      io.out(`export ${RUN_ENV}=${result.id}`);
      io.out('');
      io.out('  Run that in this shell: every fact written after it is pinned to this');
      io.out('  session. `mnema run end` closes it.');
    });

  // `mnema run end [<id>] [--outcome <text>]`. The id is OPTIONAL and falls back
  // to the open session in the environment — closing the session you are in is
  // the common case, and making it retype an id would be ceremony. With neither,
  // it says how to close one instead of guessing which.
  runGroup
    .command('end')
    .description('close a session (by default the one MNEMA_RUN names)')
    .argument('[id]', `the run to close; omitted, the one ${RUN_ENV} names`)
    .option('--outcome <text>', 'a short note on how the session went')
    .action((id: string | undefined, opts: { outcome?: string }) => {
      const fromEnv = process.env[RUN_ENV]?.trim();
      const target = id ?? fromEnv;
      if (target === undefined || target.length === 0) {
        io.err(
          '`mnema run end` needs a run: pass its id, or set ' +
            `${RUN_ENV} to the one \`mnema run start\` printed.`,
        );
        io.fail();
        return;
      }
      const result = runRunEnd(
        { cwd: process.cwd(), env: discoveryEnv() },
        { run: target, ...(opts.outcome !== undefined ? { outcome: opts.outcome } : {}) },
      );
      if (!result.ok) {
        if (result.reason === 'NO_PROJECT') {
          io.err('No mnema project here. Run `mnema init` first.');
        } else {
          io.err(`Refused (${result.code}): ${result.message}`);
        }
        io.fail();
        return;
      }
      io.out(`Ended run ${result.id}`);
      reportReplacement(result, io);
      // A shell still pinned to the run just closed would have every write
      // refused (the run is no longer open), so say how to let go of it — but
      // only when the variable really names THIS run.
      if (fromEnv === target) {
        io.out('');
        io.out(`unset ${RUN_ENV}`);
        io.out('');
        io.out('  Run that too: a shell pinned to a closed session cannot write.');
      }
    });

  // The three CONTEXT reads — `focus`, `resume`, `next-actions`. Like init/verify
  // they are top-level verbs (heterogeneous shapes, not an interchangeable
  // resource family), and unlike every write above they are strictly READ-ONLY:
  // each opens the projection cache, rebuilds, and calls a PURE copilot
  // derivation — no writer, no event, no key minted. `--json` emits the faithful
  // object (the agent's stable contract); without it, a lean human summary (one
  // line per item). The rich, nested human formatter is a later concern.
  //
  // focus/resume are always SOMEONE's context, and the record has no "current
  // actor" — a `who` is only stamped on past events. The CLI has no session to
  // read a `who` from, and deriving one would touch key material (minting a key
  // on a fresh machine) that the surface must not own. So the actor is a REQUIRED
  // `--actor` flag: the derivation takes it as a parameter, and passing it keeps
  // the read truly read-only. (next-actions needs no actor — its answer is a
  // property of the task's state, not of who asks.)

  // `mnema focus --actor <id> [--json]` — the actor's open runs (what they are
  // touching now). Reports ONLY that actor's runs — never another's.
  program
    .command('focus')
    .description("show an actor's open runs (what they are touching now)")
    .requiredOption('--actor <id>', 'the anchor id whose focus to show (from `mnema verify`)')
    .option('--json', 'emit the faithful focus object as JSON')
    .action((opts: { actor: string; json?: boolean }) => {
      const result = runFocus({ cwd: process.cwd(), env: discoveryEnv() }, { actor: opts.actor });
      if (!result.ok) {
        io.err('No mnema project here. Run `mnema init` first.');
        io.fail();
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.focus, null, 2));
        return;
      }
      // Human summary — one line per open run, and one line per run is what the
      // reader counts by: the agent and the goal are both text an actor wrote, so
      // either one holding a newline would print a run this record never opened
      // (see {@link oneLine}). `--json` carries both as written.
      //
      // An actor with nothing open is stated plainly, not left as silent empty
      // output, and told what a run IS: most people working the CLI directly will
      // never have one, and an unexplained empty answer reads as something missing
      // rather than as the truth (see {@link NO_RUNS_HINT}).
      const { openRuns } = result.focus;
      if (openRuns.length === 0) {
        io.out(`${result.focus.actor} has no open runs.`);
        for (const line of NO_RUNS_HINT) io.out(line);
        return;
      }
      io.out(`${result.focus.actor} — ${openRuns.length} open run(s):`);
      for (const run of openRuns) {
        io.out(
          `  ${run.id}  ${oneLine(run.agent)}` +
            `${run.goal !== undefined ? ` — ${oneLine(run.goal)}` : ''}`,
        );
      }
    });

  // `mnema resume --actor <id> [--json]` — where the actor left off: their latest
  // run (open OR ended), plus their current focus.
  program
    .command('resume')
    .description('show where an actor left off (their latest run, open or ended)')
    .requiredOption('--actor <id>', 'the anchor id whose last run to show (from `mnema verify`)')
    .option('--json', 'emit the faithful resume object as JSON')
    .action((opts: { actor: string; json?: boolean }) => {
      const result = runResume({ cwd: process.cwd(), env: discoveryEnv() }, { actor: opts.actor });
      if (!result.ok) {
        io.err('No mnema project here. Run `mnema init` first.');
        io.fail();
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.resume, null, 2));
        return;
      }
      const { lastRun, focus } = result.resume;
      if (lastRun === null) {
        // Not "no runs YET": for a person working the CLI directly that reads as
        // a state about to change, and it never will — nor should it.
        io.out(`${result.resume.actor} has no runs.`);
        for (const line of NO_RUNS_HINT) io.out(line);
        return;
      }
      const state = lastRun.open ? 'open' : 'ended';
      io.out(
        `${result.resume.actor} last run ${lastRun.id} (${state})` +
          `${lastRun.goal !== undefined ? ` — ${lastRun.goal}` : ''}`,
      );
      io.out(`  ${focus.openRuns.length} run(s) still open`);
    });

  // `mnema next-actions <task-id> [--json]` — the moves the workflow allows the
  // task next. No actor: the answer is a property of the task's state. An unknown
  // id is refused honestly; a terminal task reports "no legal moves".
  program
    .command('next-actions')
    .description('show the moves the workflow allows a task next')
    .argument('<task-id>', 'the task id (the value shown when it was created)')
    .option('--json', 'emit the faithful list of next actions as JSON')
    .action((id: string, opts: { json?: boolean }) => {
      const result = runNextActions({ cwd: process.cwd(), env: discoveryEnv() }, { id });
      if (!result.ok) {
        if (result.reason === 'NO_PROJECT') {
          io.err('No mnema project here. Run `mnema init` first.');
        } else {
          io.err(`No task ${id} here.`);
        }
        io.fail();
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.actions, null, 2));
        return;
      }
      if (result.actions.length === 0) {
        io.out(`Task ${id} is terminal — no legal moves.`);
        return;
      }
      io.out(`Task ${id} — ${result.actions.length} legal move(s):`);
      for (const action of result.actions) {
        const needs = action.requires.length > 0 ? ` (needs ${action.requires.join(', ')})` : '';
        io.out(`  ${action.action} → ${action.to}${needs}`);
      }
    });

  // `mnema guard <action> <id> --actor <who> [--note/--reason/--feedback/--which]
  // [--json]` — a DRY-RUN of the gate: "would this move be allowed on this task,
  // and if not, why?" It MIRRORS `task move` (the same action and id) but writes
  // nothing: it reads the task's current state, simulates the gate, and prints
  // the verdict. ALLOWED names the state the move would reach; REFUSED carries
  // the gate's own code and message — the same answer the real move would give.
  //
  // The actor is a REQUIRED `--actor` for the reason focus/resume are: the CLI
  // has no session, and deriving the machine's `who` would mint a key (a write).
  // The proof flags (`--note`/`--reason`/`--feedback`) and `--which` are optional
  // and simulate the move faithfully — with the required proof it is ALLOWED,
  // without it REFUSED (MISSING_PROOF), the useful "you are only missing the
  // note" answer. `--which` simulates an agent asking on a human's behalf, so a
  // `--which` equal to `--actor` reproduces the WHO_IS_WHICH refusal.
  program
    .command('guard')
    .description('dry-run the gate: would a move be allowed on a task, and if not, why?')
    .argument(
      '<action>',
      'the transition to test (submit, start, block, unblock, submit_review, ' +
        'request_changes, approve, complete, cancel, reopen)',
    )
    .argument('<id>', 'the task id (the value shown when it was created)')
    .requiredOption('--actor <id>', 'the anchor id asking (the `who`; from `mnema verify`)')
    .option('--reason <text>', 'simulate the reason (cancel, block, reopen)')
    .option('--note <text>', 'simulate the note (complete, approve)')
    .option('--feedback <text>', 'simulate the feedback (request_changes)')
    // Validated exactly as the real move's `--which` is: a dry-run that accepted a
    // declaration the move refuses would answer for a move nobody can make.
    .option('--which <id>', 'simulate an executing agent (must differ from --actor)', declaredAgent)
    .option('--json', 'emit the faithful gate verdict as JSON')
    .action(
      (
        action: string,
        id: string,
        opts: {
          actor: string;
          reason?: string;
          note?: string;
          feedback?: string;
          which?: string;
          json?: boolean;
        },
      ) => {
        const result = runGuard(
          { cwd: process.cwd(), env: discoveryEnv() },
          {
            id,
            action,
            actor: opts.actor,
            proof: {
              ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
              ...(opts.note !== undefined ? { note: opts.note } : {}),
              ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
            },
            ...(opts.which !== undefined ? { which: opts.which } : {}),
          },
        );
        if (!result.ok) {
          if (result.reason === 'NO_PROJECT') {
            io.err('No mnema project here. Run `mnema init` first.');
          } else {
            io.err(`No task ${id} here.`);
          }
          io.fail();
          return;
        }
        if (opts.json === true) {
          io.out(JSON.stringify(result.verdict, null, 2));
          return;
        }
        // Human summary — the gate's verdict, one line. ALLOWED names the state
        // the move would reach; REFUSED echoes the gate's own code and reason, so
        // the dry-run reads exactly as the real move's refusal would.
        if (result.verdict.ok) {
          io.out(`ALLOWED: ${action} ${id} → ${result.verdict.to}`);
        } else {
          io.out(`REFUSED (${result.verdict.code}): ${result.verdict.message}`);
        }
      },
    );

  // The two RECORD reads — `search` and `show`. Together they are one idea in two
  // halves: find by an INDEX (a line per record, never the bodies), then read the
  // one that was worth reading. Both cross every visible tree and say which one
  // each answer came from — a note of the team's and a note of your own are
  // different things, and a reader who cannot tell them apart will cite one as the
  // other. Neither takes `--actor`: what matches is a property of the record.
  // Neither refuses outside a project either — the global tree is a record too.

  // `mnema search [term] [--kind --scope --state --from --to --limit] [--json]`.
  // The term is OPTIONAL: with one it is a search, without one the most recent
  // records. `--json` emits the faithful object (one flat list, as the agent's
  // surface serves it); the human summary GROUPS by kind, which is presentation
  // and nothing else — the read returns one ordered list either way.
  program
    .command('search')
    .description('find what has been recorded, or list the most recent (no term)')
    .argument('[term]', 'words to look for; omit to list the most recent records')
    .option('--kind <kind>', `only this kind of record: ${SEARCH_KINDS.join(', ')}`)
    .option('--scope <scope>', `only this tree: ${SCOPES.join(', ')}`)
    .option('--state <state>', 'only records in this state (excludes kinds that have none)')
    .option('--from <iso>', 'only records at or after this ISO-8601 instant')
    .option('--to <iso>', 'only records at or before this ISO-8601 instant')
    .option(
      '--limit <n>',
      `how many to return (default ${SEARCH_DEFAULT_LIMIT}, max ${SEARCH_MAX_LIMIT})`,
    )
    .option('--json', 'emit the faithful index as JSON (one ordered list)')
    .action(
      (
        term: string | undefined,
        opts: {
          kind?: string;
          scope?: string;
          state?: string;
          from?: string;
          to?: string;
          limit?: string;
          json?: boolean;
        },
      ) => {
        const scope = parseScope(opts.scope, io);
        if (scope === INVALID) {
          io.fail();
          return;
        }
        const limit = parseLimit(opts.limit, io);
        if (limit === INVALID_LIMIT) {
          io.fail();
          return;
        }
        const result = runSearch(
          { cwd: process.cwd(), env: discoveryEnv() },
          {
            ...(term !== undefined ? { term } : {}),
            ...(opts.kind !== undefined ? { kind: opts.kind as SearchKind } : {}),
            ...(scope !== undefined ? { scope } : {}),
            ...(opts.state !== undefined ? { state: opts.state } : {}),
            ...(opts.from !== undefined ? { from: opts.from } : {}),
            ...(opts.to !== undefined ? { to: opts.to } : {}),
            ...(limit !== undefined ? { limit } : {}),
          },
        );
        if (!result.ok) {
          if (result.reason === 'UNKNOWN_KIND') {
            io.err(`Invalid --kind "${result.kind}". Use one of: ${SEARCH_KINDS.join(', ')}.`);
          } else {
            io.err(`No ${result.scope} tree here. Run \`mnema init\` in a project first.`);
          }
          io.fail();
          return;
        }
        if (opts.json === true) {
          io.out(JSON.stringify(result.result, null, 2));
          return;
        }
        printSearch(result.result, term, io);
      },
    );

  // `mnema show <id> [--json]` — the whole record behind an id from `search`.
  // Serves a skill's body too: on this surface the reader is CURATING patterns,
  // and refusing them the text of the thing they are reviewing would make the
  // curation impossible (the agent's surface makes the opposite call, for the
  // opposite reason — see `runShow`).
  program
    .command('show')
    .description('show one whole record by id (the body a search only pointed at)')
    .argument('<id>', 'the record id (from `mnema search`)')
    .option('--json', 'emit the faithful record as JSON')
    .action((id: string, opts: { json?: boolean }) => {
      const result = runShow({ cwd: process.cwd(), env: discoveryEnv() }, { id });
      if (!result.ok) {
        io.err(`No record ${id} here.`);
        io.fail();
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.record, null, 2));
        return;
      }
      printRecord(result.record, io);
    });

  // The three INTELLIGENCE reads — `timeline`, `accountability`, `antipatterns`.
  // Top-level verbs like the context reads, but the AUDITOR's view: each folds
  // the UNION of the present trees (public/private/global) into one view of the
  // whole record, not one tree's slice — a story crosses trees, and authorship
  // and recurrence are properties of everything. Strictly READ-ONLY: each reads
  // the present trees' tails and folds them with a PURE copilot derivation — no
  // cache rebuilt to disk, no writer, no key. So none takes `--actor` (the answer
  // is a property of the record, not of who asks); accountability's `--who`/
  // `--which` are aggregation FILTERS, not the asker's identity. `--json` emits
  // the faithful object; without it a one-level human summary (the rich nested
  // formatter is a later concern). RELATES, never JUDGES — no output editorializes.

  // `mnema timeline <id> [--json]` — the entity's whole story across the trees:
  // every event where it is the subject, plus those that refer to it (an
  // observation `about` it, a link whose `target` is it). An id no event touches
  // yields an empty history — a valid answer, not a refusal.
  program
    .command('timeline')
    .description("show an entity's history across the trees (subject, about, target)")
    .argument('<id>', 'the entity id (a task, decision, skill, memory, …)')
    .option('--json', 'emit the faithful timeline entries as JSON')
    .action((id: string, opts: { json?: boolean }) => {
      const result = runTimeline({ cwd: process.cwd(), env: discoveryEnv() }, { id });
      if (!result.ok) {
        io.err('No mnema project here. Run `mnema init` first.');
        io.fail();
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.entries, null, 2));
        return;
      }
      // Human summary — one line per event: when, what kind, the role by which the
      // entity appears, and who authorized it. The typed payload is in --json.
      if (result.entries.length === 0) {
        io.out(`No history recorded for ${id}.`);
        return;
      }
      io.out(`${id} — ${result.entries.length} event(s):`);
      for (const entry of result.entries) {
        io.out(`  ${entry.at}  ${entry.kind}  [${entry.role}]  ${entry.who}`);
      }
    });

  // `mnema accountability [--from --to --who --which] [--json]` — who authorized
  // what over the whole record. No filter = everything (git shortlog -sn); the
  // flags only narrow. The human summary is one level (total, and one line per
  // who with their count); the nested byKind/byWhich is in --json.
  program
    .command('accountability')
    .description('show who authorized what across the record (optionally windowed/filtered)')
    .option('--from <iso>', 'include only facts at or after this ISO-8601 instant')
    .option('--to <iso>', 'include only facts at or before this ISO-8601 instant')
    .option('--who <id>', 'count only facts authorized by this anchor id')
    // The one `--which` that is NOT a declaration of who acted but a FILTER over
    // who already did, so it carries no {@link declaredAgent}: nothing is being
    // attributed here, and a value that matches no recorded agent is an empty
    // answer, which is what every other filter with no match gives too.
    .option('--which <agent>', 'count only facts executed by this agent')
    .option('--json', 'emit the faithful account object as JSON')
    .action(
      (opts: { from?: string; to?: string; who?: string; which?: string; json?: boolean }) => {
        const result = runAccountability(
          { cwd: process.cwd(), env: discoveryEnv() },
          {
            ...(opts.from !== undefined ? { from: opts.from } : {}),
            ...(opts.to !== undefined ? { to: opts.to } : {}),
            ...(opts.who !== undefined ? { who: opts.who } : {}),
            ...(opts.which !== undefined ? { which: opts.which } : {}),
          },
        );
        if (!result.ok) {
          io.err('No mnema project here. Run `mnema init` first.');
          io.fail();
          return;
        }
        if (opts.json === true) {
          io.out(JSON.stringify(result.account, null, 2));
          return;
        }
        // Human summary — one level. The total and one line per author with their
        // count; the per-kind and per-agent breakdown stays in --json.
        const { total, byWho } = result.account;
        io.out(`${total} fact(s) · ${byWho.length} author(s)`);
        for (const account of byWho) {
          io.out(`  ${account.who}  ${account.total}`);
        }
      },
    );

  // `mnema antipatterns [--json]` — recurring shapes with their evidence. The
  // human summary is a count per category plus the candidate ids pointed at; the
  // full evidence per finding is in --json. It POINTS, never CONCLUDES.
  program
    .command('antipatterns')
    .description('show recurring shapes in the record (reopens, supersessions, deprecations)')
    .option('--json', 'emit the faithful shapes with their evidence as JSON')
    .action((opts: { json?: boolean }) => {
      const result = runAntipatterns({ cwd: process.cwd(), env: discoveryEnv() });
      if (!result.ok) {
        io.err('No mnema project here. Run `mnema init` first.');
        io.fail();
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.patterns, null, 2));
        return;
      }
      // Human summary — one level: a count per category, then the skill candidates
      // as pointed-at ids. Nothing calls a count good or bad; the evidence per
      // finding is in --json.
      const { reopenedTasks, supersededDecisions, deprecatedSkills, skillCandidates } =
        result.patterns;
      io.out(`reopened tasks: ${reopenedTasks.length}`);
      io.out(`superseded decisions: ${supersededDecisions.length}`);
      io.out(`deprecated skills: ${deprecatedSkills.length}`);
      if (skillCandidates.length > 0) {
        io.out(
          `skill candidates (reopened >1×): ${skillCandidates.map((f) => f.entityId).join(', ')}`,
        );
      }
    });

  // `mnema exposure [--json]` — which records hold something shaped like a
  // credential. The fourth intelligence read, and the only one about the record's
  // PAST: everything written before the content door existed was written with no
  // defense, and in a committed tree that past is what decides the damage.
  //
  // It prints WHERE and never WHAT — id, kind, tree, instant, class — in the human
  // summary and in `--json` alike. Printing the value would move the credential
  // into a CI log or a scrollback, which is to say it would make the report the
  // second disclosure. The read cannot do it: what it returns holds no value.
  program
    .command('exposure')
    .description('show which records hold something shaped like a credential (never the value)')
    .option('--json', 'emit the faithful report as JSON (still without any value)')
    .action((opts: { json?: boolean }) => {
      const result = runExposure({ cwd: process.cwd(), env: discoveryEnv() });
      if (!result.ok) {
        io.err('No mnema project here. Run `mnema init` first.');
        io.fail();
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.report, null, 2));
        return;
      }
      printExposure(result.report, io);
    });

  // `mnema refs <id> [--direction --depth] [--json]` — the graph reading of the
  // same index `timeline` reads: not the events that touch an entity but the
  // ENTITIES it connects to. One verb, two shapes: the default is the
  // neighbourhood (one hop, either way), and a direction with more depth is a
  // lineage. It says when the depth cut the answer, and reports a far end no tree
  // ever authored as unresolved rather than dropping it.
  program
    .command('refs')
    .description('show what an entity is connected to across the trees')
    .argument('<id>', 'the entity id (a task, decision, memory, skill, …)')
    .option(
      '--direction <way>',
      `which way to follow edges: ${REFERENCE_DIRECTIONS.join(', ')}`,
      'both',
    )
    .option(
      '--depth <n>',
      `how many hops (max ${REFERENCE_MAX_DEPTH})`,
      String(REFERENCE_DEFAULT_DEPTH),
    )
    .option('--json', 'emit the faithful graph as JSON')
    .action((id: string, opts: { direction?: string; depth?: string; json?: boolean }) => {
      const depth = Number.parseInt(opts.depth ?? '', 10);
      if (Number.isNaN(depth)) {
        io.err(`Not a number of hops: ${opts.depth}`);
        io.fail();
        return;
      }
      const result = runReferences(
        { cwd: process.cwd(), env: discoveryEnv() },
        { id, depth, ...(opts.direction !== undefined ? { direction: opts.direction } : {}) },
      );
      if (!result.ok) {
        if (result.reason === 'NO_PROJECT') {
          io.err('No mnema project here. Run `mnema init` first.');
        } else {
          io.err(
            `Not a direction: ${result.direction}. One of: ${REFERENCE_DIRECTIONS.join(', ')}.`,
          );
        }
        io.fail();
        return;
      }
      if (opts.json === true) {
        io.out(JSON.stringify(result.graph, null, 2));
        return;
      }
      printReferences(result.graph, io);
    });

  // `mnema skills [--json]` — where each pattern came from: its state, the tree it
  // lives in, who proposed it and who adopted it.
  //
  // A top-level READ, like every other reading in this product, and plural so it is
  // not mistaken for the `skill` group, which writes. It shares its name with an MCP
  // tool that does something else — the tool serves a pattern to an agent about to
  // work by it, this audits the provenance for a person deciding whether it should
  // be — and the help says so, because a reader has every reason to assume one verb
  // per tool.
  program
    .command('skills')
    .description('show where each pattern came from (who proposed it, who adopted it)')
    .option('--json', 'emit the faithful provenance as JSON')
    .addHelpText(
      'after',
      [
        '',
        'This is the AUDIT of the patterns, not the patterns themselves:',
        '  The `skills` tool on the MCP surface serves a pattern’s body to an agent.',
        '  This verb reads who put each one there. `mnema show <id>` reads a body.',
        '  Only an adopted pattern is served to an agent; the other states are not.',
        '  An act with no agent behind it was a person acting directly.',
      ].join('\n'),
    )
    .action((opts: { json?: boolean }) => {
      const result = runSkills({ cwd: process.cwd(), env: discoveryEnv() });
      if (opts.json === true) {
        io.out(JSON.stringify(result.patterns, null, 2));
        return;
      }
      printPatternProvenance(result.patterns, io);
    });

  // `key` is a group, and the only one whose subject is not the record but the
  // machine's key material: `restore` brings a key back onto a machine, and
  // `request`/`enroll`/`revoke` operate the identity's roster — the three steps of
  // putting a second machine on one identity, and taking a key back out.
  //
  // The split across machines is not cosmetic: `request` runs where the key wants
  // IN and needs no project, while `enroll` and `revoke` run on a machine that is
  // already a member and write to the committed tree. Membership is granted by a
  // member's signature, so no machine can admit itself.
  const key = program.command('key').description("manage this machine's signing keys");

  // `mnema key restore <file>` — install a key from a copy of its private half and
  // adopt, in this project, the identity the record proves it belongs to. The file
  // is a POSITIONAL: it is the whole subject of the command and competes with
  // nothing. It is READ, never moved or consumed — the output says so, because this
  // is the moment a person would think the copy has done its job and delete it.
  key
    .command('restore')
    .description("restore this machine's identity from a copy of a key's private half")
    .argument('<file>', 'the PEM file holding the private half (your backup copy)')
    .action((file: string) => {
      const result = runKeyRestore(
        { cwd: process.cwd(), env: discoveryEnv() },
        {
          privateKeyPath: file,
        },
      );
      if (result.ok) {
        io.out(`Restored key ${result.fingerprint}`);
        io.out(
          `  identity: ${result.anchor}` +
            `${result.membership === 'founded' ? ' (this project was founded by this key)' : ' (this project enrolled this key)'}`,
        );
        io.out(`  private half installed at ${result.installedAt}`);
        io.out(`  Your copy at ${file} was read, not moved — keep it where it is.`);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema key restore` inside the project to recover.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

  // `mnema key request --anchor <id> [--key <file>]` — on the machine that wants
  // in. The anchor is a REQUIRED flag, not a positional: it is not the subject of
  // the command (the subject is this machine's key), and it is a value the person
  // pastes from elsewhere, so naming it keeps a mis-paste from reading as a path.
  // `--key` points at a private key to speak for INSTEAD of this machine's own —
  // the way out of a machine that already minted the wrong key.
  key
    .command('request')
    .description('ask to bring this machine into an identity (run this on the joining machine)')
    .requiredOption('--anchor <id>', 'the identity to join (the `mnid:…` its machine prints)')
    .option('--key <file>', "a private key to speak for instead of this machine's own")
    .action((opts: { anchor: string; key?: string }) => {
      const result = runKeyRequest(
        { cwd: process.cwd(), env: discoveryEnv() },
        { anchor: opts.anchor, ...(opts.key !== undefined ? { privateKeyPath: opts.key } : {}) },
      );
      if (!result.ok) {
        io.err(`Refused (${result.code}): ${result.message}`);
        io.fail();
        return;
      }
      if (result.minted) {
        io.out(`Created this machine's key ${result.fingerprint}`);
      } else {
        io.out(
          `Requesting for key ${result.fingerprint}` +
            `${result.source === 'file' ? ' (read from the file you named, not installed)' : ''}`,
        );
      }
      io.out(`  to join ${result.anchor}`);
      // The request itself, alone on its line so it can be selected and pasted.
      io.out('');
      io.out(result.request);
      io.out('');
      io.out('  Hand that line to a machine already in that identity, which runs:');
      io.out('    mnema key enroll <the line>');
      io.out('  It proves consent to join that ONE identity and is not a secret.');
    });

  // `mnema key enroll <request>` — on a machine that is already a member. The
  // request is a POSITIONAL: it is the whole subject of the command. It is long,
  // which is exactly why it is not typed but pasted.
  key
    .command('enroll')
    .description('vouch for a requesting key so it joins this identity (run this on a member)')
    .argument('<request>', 'the line `mnema key request` printed on the joining machine')
    .action((request: string) => {
      const result = runKeyEnroll({ cwd: process.cwd(), env: discoveryEnv() }, { request });
      if (result.ok) {
        if (result.alreadyMember) {
          io.out(`Key ${result.fingerprint} is already in ${result.anchor} — nothing recorded.`);
          return;
        }
        io.out(`Enrolled key ${result.fingerprint}`);
        io.out(`  into ${result.anchor}`);
        io.out(`  recorded in ${result.root}`);
        io.out('  Commit and share the record: the other machine joins by reading it.');
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema key enroll` inside the project to record it.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

  // `mnema key revoke <fingerprint> --reason <text>` — retire a key. The
  // fingerprint is a positional (the subject); the reason is a required flag, as
  // every other verb that demands its evidence does. It is the full fingerprint,
  // not a prefix: there is no id-prefix resolution anywhere yet, and guessing
  // which key a short value means is not a guess to make about key material.
  key
    .command('revoke')
    .description('retire a key from this identity, from this point forward')
    .argument('<fingerprint>', 'the full fingerprint of the key to retire')
    .requiredOption('--reason <text>', 'why it is being retired (recorded in the fact)')
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action((fingerprint: string, opts: { reason: string }) => {
      const result = runKeyRevoke(
        { cwd: process.cwd(), env: discoveryEnv() },
        { fingerprint, reason: opts.reason },
      );
      if (result.ok) {
        io.out(`Revoked key ${result.fingerprint}`);
        reportReplacement(result, io);
        io.out(`  from ${result.anchor} — ${result.remaining} key(s) left`);
        if (result.self) {
          // The person just retired the key this machine signs with. Nothing stops
          // it from writing again, and anything it writes now fails verification —
          // so say it plainly, at the only moment it can still be acted on.
          io.out("  That is THIS machine's key: it must not write to this project again.");
          io.out('  Bring another key in first if this machine is to keep working here.');
        }
        io.out('  Commit and share the record: a retirement others cannot read retires nothing.');
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema key revoke` inside the project to record it.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

  program
    .command('verify')
    .description("verify the current project's chain")
    .action(() => {
      const result = runVerify({ cwd: process.cwd(), env: discoveryEnv() });
      if (!result.ok) {
        io.err('No mnema project here. Run `mnema init` first.');
        io.fail();
        return;
      }
      // Print the verdict's own honest summary verbatim — the CLI never upgrades
      // the guarantee. A broken chain is a non-zero exit.
      io.out(result.result.summary);
      if (!result.result.ok) {
        for (const issue of result.result.issues) {
          io.err(`  issue [${issue.layer}] ${issue.tail}#${issue.seq}: ${issue.detail}`);
        }
        io.fail();
      }
    });

  program
    .command('mcp')
    .description('run the mnema MCP server over stdio (for an agent host)')
    .action(async () => {
      // Loaded HERE, not at module scope: the MCP SDK is the heaviest import in
      // the product and only this one verb uses it, so importing it at the top
      // made every other command pay for a server it never starts.
      const { buildMcpServer } = await import('./mcp/server.js');
      // stdout carries the JSON-RPC protocol, so the server writes every
      // diagnostic to stderr. This action does not return until the transport
      // closes — the process serves for the life of the connection.
      const { connect } = buildMcpServer({ env: discoveryEnv(), log: (line) => io.err(line) });
      await connect();
    });

  return program;
}

/**
 * Prints the verdict of a decision move (accept/reject/supersede) — both verbs
 * share it. On success the frozen `ADR-<n>` label and the new state; on refusal
 * the surface's own message for a missing project or an unknown decision, else
 * the gate's own code and message. A decision has no alias, so its human name in
 * the output is the ADR.
 */
function reportDecisionMove(
  result: ReturnType<typeof runDecisionTransition>,
  id: string,
  io: CliIo,
): void {
  if (result.ok) {
    io.out(`Decision ${result.adr} → ${result.to}`);
    reportReplacement(result, io);
    return;
  }
  if (result.reason === 'NO_PROJECT') {
    io.err('No mnema project here. Run `mnema init` first.');
  } else if (result.reason === 'UNKNOWN_DECISION') {
    io.err(`No decision ${id} here.`);
  } else {
    io.err(`Refused (${result.code}): ${result.message}`);
  }
  io.fail();
}

/**
 * Runs the CLI. A thrown error (e.g. a chain so corrupt it cannot be parsed)
 * becomes an honest failure — a message and a non-zero exit — never an uncaught
 * stack trace that could read as "nothing to report".
 */
export async function run(argv: readonly string[], io: CliIo = processIo): Promise<void> {
  try {
    await buildProgram(io).parseAsync(argv, { from: 'user' });
  } catch (error) {
    // commander throws for --help/--version (a clean, zero exit — it already
    // printed) and for a usage error (a non-zero exit it already reported).
    // Honor its exit code; do not re-print.
    if (error instanceof CommanderError) {
      if (error.exitCode !== 0) io.fail();
      return;
    }
    // The record does not name ONE identity for this machine's key, so the write
    // refused rather than guessing whose record this is. It is thrown, not
    // returned, because the decision sits below every write — every verb would
    // otherwise carry the same branch — so it is reported HERE, in the one place
    // that already turns a throw into an honest failure, and it reads exactly like
    // any other refusal.
    if (error instanceof IdentityUnavailableError) {
      io.err(`Refused (${error.code}): ${error.message}`);
      io.fail();
      return;
    }
    // Any other throw — e.g. a chain too corrupt to parse — is an honest
    // failure, not an uncaught stack trace that could read as "nothing wrong".
    io.err(error instanceof Error ? error.message : String(error));
    io.fail();
  }
}

// Auto-run when invoked as the binary (not when imported by a test).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  exitQuietlyOnClosedPipe();
  void run(process.argv.slice(2));
}
