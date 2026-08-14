/**
 * The map of the surface: which verbs there are, in which families, in the order a
 * person meets them in `mnema --help`.
 *
 * THE ORDER IS THE OUTPUT. commander lists commands in registration order, so this
 * array is what a reader sees when they ask what mnema does — the writes first, from
 * founding a project to the four knowledge facts, then the session, then every read,
 * then the machine's keys, then the record's own tails, then verification.
 * Reordering the list reorders the help, which is why it lives in one place and not
 * in the sequence of thirty calls inside one function.
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
 * The four CONTEXT reads — `status`, `focus`, `resume`, `next-actions`. Like
 * init/verify they are top-level verbs (heterogeneous shapes, not an
 * interchangeable resource family), and unlike every write above they are strictly
 * READ-ONLY: each opens the projection cache, rebuilds, and calls a PURE copilot
 * derivation — no writer, no event, no key minted. `--json` emits the faithful
 * object (the agent's stable contract); without it, a lean human summary (one
 * line per item).
 *
 * `status` LEADS THEM because it is the OPENING read: it answers where things
 * stand — where the actor left off, what work is live, which patterns are adopted,
 * which decisions govern, and what is waiting on somebody to rule on it — and the
 * other three narrow one part of that. It is the same derivation the agent surface
 * opens on (`bootstrap`, over MCP), which until it was declared here was reachable
 * from that surface alone: an agent could ask where things stood and the person
 * whose record it is could not.
 *
 * status/focus/resume are always SOMEONE's context, and the record has no "current
 * actor" — a `who` is only stamped on past events. An invocation has no session to
 * read a `who` from, and deriving one would touch key material (minting a key
 * on a fresh machine) that the surface must not own. So the actor is a REQUIRED
 * `--actor` flag: the derivation takes it as a parameter, and passing it keeps
 * the read truly read-only. (next-actions needs no actor — its answer is a
 * property of the task's state, not of who asks.) THIS SAID *THE CLI* HAS NO
 * SESSION, and `mnema repl` is one: it resolves that identity from local material
 * with no writer opened and fills the flag in at its own prompt
 * (`repl/asking.ts`). Every declaration here is unchanged, and so is the reason
 * for it — a verb typed at a shell asks for the actor as it always has.
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
 *
 * And `usage`, WHICH IS THE ONE READ THAT LEAVES THE RECORD. Every verb above answers
 * out of the chain, so anyone holding a clone can ask the same question and get the same
 * answer; this one crosses the record's runs with the transcripts Claude Code wrote on
 * THIS machine, and neither half of that is in a clone. It is here because the number is
 * real and somebody has to account for it, and it is declared a READ for the strict
 * reason the others are — it appends nothing, and the record deliberately has no field
 * for a cost (`RECONSTRUCTION.md`, *Custo/tokens*: the host's transcripts expire, so a
 * recorded cost would be a signed claim whose only witness deletes itself). Tokens and a
 * model id, never dollars; one host session in a run's window is attributed and NAMED,
 * more than one is named and refused, none is a WORD and never a zero. It ends by saying
 * all of that out loud, because a cost table printed by an audit tool with nothing
 * qualifying it reads as part of the proof.
 *
 * `key` and `tail` sit together at the end of the writes, and they are the two whose
 * subject is not the work but the record's own material: `key` operates this
 * machine's signing keys, and `tail` authorizes the cut of a whole tail — and says
 * which tails there are to cut, since `tail prune` takes an id and `tail list` is
 * the only reading in the product that prints one. `tail prune`
 * is the only verb in the product whose consequence is DESTRUCTIVE, and it is
 * deliberately the only write with no counterpart on the MCP surface: a run there
 * opens by itself on the first write, with the `who` read off the key and nobody
 * authorizing that session out loud. A cut is authorized by a person at a shell, or
 * not at all. It removes nothing either way — it records the authorization while the
 * tail is still there, which is what makes the claim checkable, and says where the
 * files are.
 *
 * `verify` covers a THIRD set of trees, and the difference is that it answers with a
 * VERDICT. It verifies the project's two trees — the committed one and this machine's
 * private one — reporting one per tree and exiting on the WEAKEST of them, and it
 * reaches the machine-global tree only when `--global` asks. The union reads above
 * take that tree by default because a fact is a fact wherever it lives; a verdict is
 * not: the global tree belongs to no project and is present in every one, so folding
 * it in would let one weakness lower the verdict of every project on this disk,
 * forever. It covered the committed tree ALONE until the private tree's signed facts
 * were found to be outside every verdict the product gave.
 *
 * And `brief`, which is a family of one and reads unlike all of them: every verb
 * above answers whoever ran it, and this one composes a FILE for a reader that never
 * asked. `mnema brief > AGENTS.md` puts the decisions in force and the adopted
 * patterns where an agent host reads them on its own, so the record reaches an agent
 * that did not think to look for it. It is also the read that deliberately does NOT
 * fold the union: the file is written to be committed, so it carries the public
 * tree alone — what a clone gets — and the document says so, because a governance
 * document that quietly omits a rule is read as the whole of what governs. It is the
 * only read with no options at all — no `--json` (the markdown IS the contract), no
 * `--check` (a pipe into `diff` answers it), no `--actor`, no `--scope` (it has one
 * scope and that is the point) — the only read whose coverage is ONE tree (it was the
 * only one that did not fold the union while the verdict covered a single tree, which
 * is no longer the distinction) — and the only one whose output is guaranteed BYTE-
 * STABLE for an unchanged record, which is what lets that `diff` mean "the copy is
 * stale" and nothing else. It writes nothing, like every read here; the redirection
 * belongs to whoever operates it.
 *
 * And the LAST THREE read no record at all, because they are not about one: they are the
 * three DOORS onto everything above them. `mcp` serves this surface to an agent host;
 * `repl` opens an interactive session for a person, which is the same surface with the
 * hundred-millisecond floor paid once instead of once per command; and `completion`
 * writes the script a shell needs to finish a verb somebody is typing. They come last
 * for that reason — a reader looking for what mnema records has found it before reaching
 * them — and `completion` comes last of all because it is generated FROM this list: it
 * is the one verb whose answer changes when any line above it does.
 *
 * The three do not agree about the record, and the disagreement is the classification
 * doing its job. `mcp` is a WRITE, because it serves every write tool there is to whoever
 * connects to it — every tool, which is not every write: `tail prune` is the one the server
 * deliberately has none for. `repl` is a READ, because it will only dispatch to a verb
 * that declared itself one — it reads the declarations of this very list and refuses
 * everything else (`repl/gate.ts`), which is what makes it the first PRODUCTION reader
 * of the effect each verb declares. Both answers come from the same question: what can
 * an invocation of this verb reach?
 *
 * EVERY SENTENCE ABOVE THAT SAYS "READ" OR "WRITE" IS NOW A DECLARATION IN THE CODE. The
 * order of this list is the help; it is NOT the classification, and reading it as one is
 * how a reader ends up believing the eight writes at the top are all of them. Each verb
 * answers for itself (`verb.ts`), the type makes the answer compulsory, and
 * `every-verb-says-if-it-writes.test.ts` exercises the ones that claim to read and counts
 * what reached the chain.
 */

import type { Command } from 'commander';
import { registerAccountability } from './accountability.js';
import { registerAntipatterns } from './antipatterns.js';
import { registerBrief } from './brief.js';
import { registerCompletion } from './completion.js';
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
import { registerRepl } from './repl.js';
import { registerResume } from './resume.js';
import { registerRun } from './run.js';
import { registerSearch } from './search.js';
import { registerShow } from './show.js';
import { registerSkill } from './skill.js';
import { registerSkills } from './skills.js';
import { registerStatus } from './status.js';
import { registerTail } from './tail.js';
import { registerTask } from './task.js';
import { registerTimeline } from './timeline.js';
import { registerUsage } from './usage.js';
import type { Declared, Verb, Wiring } from './verb.js';
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
  registerStatus,
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
  registerUsage,
  registerBrief,
  registerKey,
  registerTail,
  registerVerify,
  registerMcp,
  registerRepl,
  registerCompletion,
];

/**
 * Hangs every verb on the program, in order, and answers with what each one may do to
 * the record.
 *
 * The answers travel back rather than being discarded, because the classification is
 * only worth declaring if it can be ASKED: a caller that decides what it is willing to
 * run — this list is what a read-only session is allowed to offer — has to read it off
 * the same registration the parser routes with, never off a list of names kept beside
 * it. The entry ignores the answer, having nothing to decide (see `cli.ts`).
 */
export function registerVerbs(program: Command, wiring: Wiring): readonly Declared[] {
  return VERBS.map((verb) => verb(program, wiring));
}
