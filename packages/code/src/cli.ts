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

import { IdentityUnavailableError, type Scope } from '@mnema/core';
import { Command, CommanderError } from 'commander';
import { runAccountability } from './commands/accountability.js';
import { runAntipatterns } from './commands/antipatterns.js';
import { runDecision } from './commands/decision.js';
import { runDecisionTransition } from './commands/decision-transition.js';
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
import { runResume } from './commands/resume.js';
import { runSkill } from './commands/skill.js';
import { runSkillTransition } from './commands/skill-transition.js';
import { runTask } from './commands/task.js';
import { runTaskTransition } from './commands/task-transition.js';
import { runTimeline } from './commands/timeline.js';
import { runVerify } from './commands/verify.js';
import { discoveryEnv } from './env.js';
import { buildMcpServer } from './mcp/server.js';

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

/** The scopes `--scope` accepts — the surface's view of the core's three trees. */
const SCOPES = ['public', 'private', 'global'] as const;

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
  const task = program
    .command('task')
    .description('create a task in the current project')
    .argument('<title>', 'the task title')
    .option(
      '--scope <scope>',
      'where the task is born: public (team-visible), private (this machine), ' +
        'or global (personal, cross-project). Defaults to public.',
    )
    .action((title: string, opts: { scope?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const result = runTask(
        { cwd: process.cwd(), env: discoveryEnv() },
        { title, ...(scope !== undefined ? { scope } : {}) },
      );
      if (result.ok) {
        io.out(`Created task ${result.alias} (${result.id})`);
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
    .option('--feedback <text>', 'what must change (required by request_changes)');
  move.action(
    (action: string, id: string, opts: { reason?: string; note?: string; feedback?: string }) => {
      // A `--scope` on a move is parsed into `task`'s options (the parent);
      // its presence means the caller tried to scope a move, which the model
      // forbids — the move follows the entity's home tree, not a chosen scope.
      const parentOpts = (move.parent?.opts() ?? {}) as { scope?: string };
      if (parentOpts.scope !== undefined) {
        io.err('`task move` takes no --scope: a move follows the task to the tree it was born in.');
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
        },
      );
      if (result.ok) {
        io.out(`Task ${result.alias} → ${result.to}`);
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
    .action((title: string, rationale: string, opts: { scope?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const result = runDecision(
        { cwd: process.cwd(), env: discoveryEnv() },
        { title, rationale, ...(scope !== undefined ? { scope } : {}) },
      );
      if (result.ok) {
        io.out(`Recorded decision ${result.adr} (${result.id})`);
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
    .option('--note <text>', 'why this verdict (required by accept and reject)');
  decisionMove.action((action: string, id: string, opts: { note?: string }) => {
    const parentOpts = (decisionMove.parent?.opts() ?? {}) as { scope?: string };
    if (parentOpts.scope !== undefined) {
      io.err(
        '`decision move` takes no --scope: a move follows the decision to the tree it was born in.',
      );
      io.fail();
      return;
    }
    const result = runDecisionTransition(
      { cwd: process.cwd(), env: discoveryEnv() },
      { id, action, proof: { ...(opts.note !== undefined ? { note: opts.note } : {}) } },
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
    .option('--reason <text>', 'why it is being replaced (required)');
  supersede.action((oldId: string, newId: string, opts: { reason?: string }) => {
    const parentOpts = (supersede.parent?.opts() ?? {}) as { scope?: string };
    if (parentOpts.scope !== undefined) {
      io.err(
        '`decision supersede` takes no --scope: a move follows the decision to the tree it was born in.',
      );
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
    .action((name: string, opts: { body?: string; scope?: string }) => {
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
      const result = runSkill(
        { cwd: process.cwd(), env: discoveryEnv() },
        { name, body: opts.body, ...(scope !== undefined ? { scope } : {}) },
      );
      if (result.ok) {
        // Print both the name (orients the human) and the id (the key a move
        // takes) — a skill has no alias.
        io.out(`Proposed skill "${result.name}" (${result.id})`);
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
    .option('--reason <text>', 'why it fell out of use (required by deprecate)');
  skillMove.action((action: string, id: string, opts: { note?: string; reason?: string }) => {
    const parentOpts = (skillMove.parent?.opts() ?? {}) as { scope?: string };
    if (parentOpts.scope !== undefined) {
      io.err('`skill move` takes no --scope: a move follows the skill to the tree it was born in.');
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
      },
    );
    if (result.ok) {
      io.out(`Skill "${result.name}" → ${result.to}`);
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
    .action((content: string, opts: { scope?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const result = runMemory(
        { cwd: process.cwd(), env: discoveryEnv() },
        { content, ...(scope !== undefined ? { scope } : {}) },
      );
      if (result.ok) {
        io.out(`Captured memory ${result.id}`);
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
    .action((about: string, opts: { topic: string; text: string; scope?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const result = runObserve(
        { cwd: process.cwd(), env: discoveryEnv() },
        { about, topic: opts.topic, text: opts.text, ...(scope !== undefined ? { scope } : {}) },
      );
      if (result.ok) {
        io.out(`Recorded observation ${result.id} about ${about}`);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema init` first.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
    });

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
    .action((task: string, from: string, to: string, opts: { scope?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const result = runHandoff(
        { cwd: process.cwd(), env: discoveryEnv() },
        { task, fromAgent: from, toAgent: to, ...(scope !== undefined ? { scope } : {}) },
      );
      if (result.ok) {
        // No id to report — a handoff has no standalone identity. Echo the fact.
        io.out(`Recorded handoff on ${result.task}: ${result.fromAgent} → ${result.toAgent}`);
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
    .action((subject: string, target: string, opts: { rel: string; scope?: string }) => {
      const scope = parseScope(opts.scope, io);
      if (scope === INVALID) {
        io.fail();
        return;
      }
      const result = runLink(
        { cwd: process.cwd(), env: discoveryEnv() },
        { subject, target, rel: opts.rel, ...(scope !== undefined ? { scope } : {}) },
      );
      if (result.ok) {
        // No id to report — a link is an edge, not an entity. Echo the fact.
        io.out(`Linked ${result.subject} —${result.rel}→ ${result.target}`);
        return;
      }
      if (result.reason === 'NO_PROJECT') {
        io.err('No mnema project here. Run `mnema init` first.');
      } else {
        io.err(`Refused (${result.code}): ${result.message}`);
      }
      io.fail();
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
      // Human summary — one line per open run. An actor with nothing open is
      // stated plainly, not left as silent empty output.
      const { openRuns } = result.focus;
      if (openRuns.length === 0) {
        io.out(`${result.focus.actor} has no open runs.`);
        return;
      }
      io.out(`${result.focus.actor} — ${openRuns.length} open run(s):`);
      for (const run of openRuns) {
        io.out(`  ${run.id}  ${run.agent}${run.goal !== undefined ? ` — ${run.goal}` : ''}`);
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
        io.out(`${result.resume.actor} has no runs yet.`);
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
    .option('--which <id>', 'simulate an executing agent (must differ from --actor)')
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
    .action((fingerprint: string, opts: { reason: string }) => {
      const result = runKeyRevoke(
        { cwd: process.cwd(), env: discoveryEnv() },
        { fingerprint, reason: opts.reason },
      );
      if (result.ok) {
        io.out(`Revoked key ${result.fingerprint}`);
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
  void run(process.argv.slice(2));
}
