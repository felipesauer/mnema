/**
 * The map of the surface: which verbs there are, in which families, in the order a
 * person meets them in `mnema --help`.
 *
 * THE ORDER IS THE OUTPUT. commander lists commands in registration order, so this
 * array is what a reader sees when they ask what mnema does — the writes first, from
 * founding a project to the four knowledge facts, then the session, then every read,
 * then the machine's keys, then verification. Reordering the list reorders the help,
 * which is why it lives in one place and not in the sequence of twenty-four calls
 * inside one function.
 *
 * The FAMILIES are the shape of the surface, and each one exists for a reason worth
 * keeping next to the list rather than inside one of its members:
 *
 * `task`, `decision` and `skill` are GROUPS — a create and a `move` under one name —
 * because each is a workflow entity with a state the gate moves it through. The
 * create takes a birth `--scope`; the move takes none, because a move follows the
 * entity to the tree it was born in.
 *
 * The four KNOWLEDGE verbs — `memory`, `observe`, `handoff`, `link`. Unlike
 * task/decision/skill they are not groups: each is a single top-level verb (the
 * `git commit` / `init` / `verify` shape), because a knowledge fact is one
 * atomic append with no CRUD family and no `move` — there is no state to
 * transition and so no subcommand. They are FACTS: one append, no gate, no
 * state. Each takes the birth `--scope` override (they are all births), and
 * NONE validates the ids it references — the core resolves a dangling reference
 * on read (an honest cross-tree assertion), and the surface only forwards.
 *
 * The three CONTEXT reads — `focus`, `resume`, `next-actions`. Like init/verify
 * they are top-level verbs (heterogeneous shapes, not an interchangeable
 * resource family), and unlike every write above they are strictly READ-ONLY:
 * each opens the projection cache, rebuilds, and calls a PURE copilot
 * derivation — no writer, no event, no key minted. `--json` emits the faithful
 * object (the agent's stable contract); without it, a lean human summary (one
 * line per item).
 *
 * focus/resume are always SOMEONE's context, and the record has no "current
 * actor" — a `who` is only stamped on past events. The CLI has no session to
 * read a `who` from, and deriving one would touch key material (minting a key
 * on a fresh machine) that the surface must not own. So the actor is a REQUIRED
 * `--actor` flag: the derivation takes it as a parameter, and passing it keeps
 * the read truly read-only. (next-actions needs no actor — its answer is a
 * property of the task's state, not of who asks.)
 *
 * The two RECORD reads — `search` and `show`. Together they are one idea in two
 * halves: find by an INDEX (a line per record, never the bodies), then read the
 * one that was worth reading. Both cross every visible tree and say which one
 * each answer came from — a note of the team's and a note of your own are
 * different things, and a reader who cannot tell them apart will cite one as the
 * other. Neither takes `--actor`: what matches is a property of the record.
 * Neither refuses outside a project either — the global tree is a record too.
 *
 * The INTELLIGENCE reads — `timeline`, `accountability`, `antipatterns`, `exposure`,
 * `refs`, `skills`. Top-level verbs like the context reads, but the AUDITOR's view:
 * each folds the UNION of the present trees (public/private/global) into one view of
 * the whole record, not one tree's slice — a story crosses trees, and authorship
 * and recurrence are properties of everything. Strictly READ-ONLY: each reads
 * the present trees' tails and folds them with a PURE copilot derivation — no
 * cache rebuilt to disk, no writer, no key. So none takes `--actor` (the answer
 * is a property of the record, not of who asks); accountability's `--who`/
 * `--which` are aggregation FILTERS, not the asker's identity. `--json` emits
 * the faithful object. RELATES, never JUDGES — no output editorializes.
 */

import type { Command } from 'commander';
import { registerAccountability } from './accountability.js';
import { registerAntipatterns } from './antipatterns.js';
import { registerDecision } from './decision.js';
import { registerExposure } from './exposure.js';
import { registerFocus } from './focus.js';
import { registerGuard } from './guard.js';
import { registerHandoff } from './handoff.js';
import { registerInit } from './init.js';
import { registerKey } from './key.js';
import { registerLink } from './link.js';
import { registerMcp } from './mcp.js';
import { registerMemory } from './memory.js';
import { registerNextActions } from './next-actions.js';
import { registerObserve } from './observe.js';
import { registerReferences } from './refs.js';
import { registerResume } from './resume.js';
import { registerRun } from './run.js';
import { registerSearch } from './search.js';
import { registerShow } from './show.js';
import { registerSkill } from './skill.js';
import { registerSkills } from './skills.js';
import { registerTask } from './task.js';
import { registerTimeline } from './timeline.js';
import type { Verb, Wiring } from './verb.js';
import { registerVerify } from './verify.js';

/** Every verb, in the order `mnema --help` lists them. */
export const VERBS: readonly Verb[] = [
  registerInit,
  registerTask,
  registerDecision,
  registerSkill,
  registerMemory,
  registerObserve,
  registerHandoff,
  registerLink,
  registerRun,
  registerFocus,
  registerResume,
  registerNextActions,
  registerGuard,
  registerSearch,
  registerShow,
  registerTimeline,
  registerAccountability,
  registerAntipatterns,
  registerExposure,
  registerReferences,
  registerSkills,
  registerKey,
  registerVerify,
  registerMcp,
];

/** Hangs every verb on the program, in order. */
export function registerVerbs(program: Command, wiring: Wiring): void {
  for (const verb of VERBS) verb(program, wiring);
}
