/**
 * The map of the surface: which verbs there are, in which families, in the order a
 * person meets them in `mnema --help`.
 *
 * THE GROUPS AND THEIR ORDER ARE THE OUTPUT. commander lists commands under a heading in
 * registration order, and the headings in the order they first appear, so {@link GROUPS} is
 * what a reader sees when they ask what mnema does: what is recorded, what is handed over,
 * what is verified, what is read, the git log, this machine, and last what a host calls.
 * A verb is registered INSIDE a group and nowhere else — there is no list of verbs beside
 * the groups, so none can arrive without a heading — and reordering a group reorders the
 * help, which is why it lives in one place and not in the sequence of thirty calls inside
 * one function.
 *
 * The FAMILIES are the shape of the surface, and each one exists for a reason worth
 * keeping next to the list rather than inside one of its members:
 *
 * `task`, `decision` and `skill` are GROUPS — a create and a `move` under one name —
 * because each is a workflow entity with a state the gate moves it through. The
 * create takes a birth `--scope`; the move takes none, because a move follows the
 * entity to the tree it was born in. What is ABOUT the entity is under its name too: a
 * handoff is recorded on a task and the workflow's own questions are asked of one
 * (`task handoff`, `task next`, `task guard`), and where each skill came from is read
 * under `skill` (`skill provenance`). A group is classified by its most powerful member
 * (`verb.ts`), so those readings are not offered by the read-only console.
 *
 * The three KNOWLEDGE verbs — `memory`, `observe`, `link`. Unlike
 * task/decision/skill they are not groups: each is a single top-level verb (the
 * `git commit` / `init` / `verify` shape), because a knowledge fact is one
 * atomic append with no CRUD family and no `move` — there is no state to
 * transition and so no subcommand. They are FACTS: one append, no gate, no
 * state. Each takes the birth `--scope` override (they are all births), and
 * NONE validates the ids it references — the core resolves a dangling reference
 * on read (an honest cross-tree assertion), and the surface only forwards.
 *
 * The two CONTEXT reads — `status` and `resume`. Like
 * init/verify they are top-level verbs (heterogeneous shapes, not an
 * interchangeable resource family), and unlike every write above they are strictly
 * READ-ONLY: each opens the projection cache, rebuilds, and calls a PURE context
 * derivation — no writer, no event, no key minted. `--json` emits the faithful
 * object (the agent's stable contract); without it, a lean human summary (one
 * line per item).
 *
 * `status` LEADS THEM because it is the OPENING read: it answers where things
 * stand — where the actor left off, what work is live, which patterns are adopted,
 * which decisions govern, and what is waiting on somebody to rule on it — and the
 * other narrows one part of that, and lists the runs the actor still has open. It is the same derivation the agent surface
 * opens on (`bootstrap`, over MCP), which until it was declared here was reachable
 * from that surface alone: an agent could ask where things stood and the person
 * whose record it is could not.
 *
 * status/resume are always SOMEONE's context, and the record has no "current
 * actor" — a `who` is only stamped on past events. An invocation has no session to
 * read a `who` from, and deriving one would touch key material (minting a key
 * on a fresh machine) that the surface must not own. So the actor is a REQUIRED
 * `--actor` flag: the derivation takes it as a parameter, and passing it keeps
 * the read truly read-only. (`task next` needs no actor — its answer is a
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
 * The INTELLIGENCE reads — `timeline`, `refs`, `audit accountability`, `audit antipatterns`,
 * `audit exposure` and `export`. Reads like the context ones (three of them under `audit`), but the AUDITOR's
 * view: each covers EVERY present tree (public/private/global) rather than one tree's
 * slice — a story crosses trees, and authorship and recurrence are properties of
 * everything. HOW they take those trees differs, and the difference is the answer's:
 * most fold the union, while `audit exposure` and `export` keep the trees APART and label what
 * they report, because a fact that is committed and clones to every machine and a fact
 * that is on one disk are the same finding in two situations. Strictly READ-ONLY: each
 * reads the present trees' tails and folds them with a PURE context derivation — no
 * cache rebuilt to disk, no writer, no key. So none takes `--actor` (the answer
 * is a property of the record, not of who asks); `audit accountability`'s and `export`'s
 * `--who`/`--which` are FILTERS over who already acted, not the asker's identity.
 * `--json` emits the faithful object, on every one of them but `export`, whose whole
 * output is already the machine's and which therefore has no second shape to ask for.
 * RELATES, never JUDGES — no output editorializes.
 *
 * `export` IS THE ONE WHOSE ANSWER IS MEANT TO LEAVE THE MACHINE, which is what decides
 * everything about it: it emits the ENVELOPE of each fact and no payload of any kind,
 * because `audit exposure` refuses to print a value that looks like a credential even to the
 * person holding the record, and a feed carrying bodies would push exactly that into
 * somebody's search index. It sends nothing anywhere — the feed goes to standard output
 * and whoever forwards it decides the rest.
 *
 * And `usage`, WHICH IS THE ONE READ THAT LEAVES THE RECORD. Every verb above answers
 * out of the chain, so anyone holding a clone can ask the same question and get the same
 * answer; this one crosses the record's runs with the transcripts Claude Code wrote on
 * THIS machine, and neither half of that is in a clone. It is here because the number is
 * real and somebody has to account for it, and it is declared a READ for the strict
 * reason the others are — it appends nothing, and the record deliberately has no field
 * for a cost (`commands/usage.ts` states it: the host's transcripts expire, so a
 * recorded cost would be a signed claim whose only witness deletes itself). Tokens and a
 * model id, never dollars; one host session in a run's window is attributed and NAMED,
 * more than one is named and refused, none is a WORD and never a zero. It ends by saying
 * all of that out loud, because a cost table printed by an audit tool with nothing
 * qualifying it reads as part of the proof.
 *
 * `key`, `tail`, `witness` and `switch` sit together at the end of the writes, and they are
 * the four whose subject is not the work: the first three are the record's own material and
 * the last is this product's own behaviour (see below): `key` operates this
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
 * `witness` is the T3 layer, and it is the ONE VERB OF THIS SURFACE THAT SPEAKS TO
 * SOMEBODY ELSE. Every other verb answers out of the record or out of this machine's own
 * files; its two acts send the digest of a checkpoint's signed message to a public
 * timestamp calendar and, on the return visit, ask a block source for an 80-byte header.
 * That is why it is a group of three in `tail`'s shape with the BARE group as the reading
 * — a person who cannot see where the witness stands cannot decide whether to ask for one
 * — and why it takes `--global` with `verify`'s own meaning: a witness exists to raise the
 * level of a VERDICT, and the verdict over a project leaves the machine-global tree out
 * unless it is asked for. It appends no EVENT, deliberately: the event would seal a new
 * checkpoint, which would make the checkpoint just stamped no longer the last one. It is
 * still a write — see `verb.ts`, whose wording had to widen for exactly this — because
 * what it leaves behind changes what `verify` rules on.
 *
 * `switch` is the last of the writes and the only verb of this surface whose subject is
 * not the work but MNEMA. It turns off, or back on, one of the places this product puts the
 * record in front of a model WITHOUT being asked — the document a session opens with, and
 * the rules handed over as a file is written — and the switching is a fact of the chain like
 * every other: attributed, dated, signed, scoped. That is the whole reason it is not a
 * configuration file: switching off is legitimate, switching off in SILENCE is not, and
 * nothing attributes or dates a setting. Its group is `tail`'s shape rather than `task`'s —
 * no birth, no state a gate moves, no `move` — with one difference nothing else here has:
 * the BARE group is the reading. `mnema switch` prints where every switch stands, because a
 * channel name is an identifier this product invented and appears in no other reading, so a
 * person who cannot see the list cannot use the verb at all (the same argument `tail list`
 * was added for). Its birth `--scope` defaults to PUBLIC, so the ordinary switch travels and
 * the team reads it; a private switch governs one machine and no committed file can report
 * it, which is why the listing is where such a switch is ever spelled. It is the CLI's
 * alone, like `tail prune`, and here the reason is sharper: an agent that could switch off
 * what governs its own work through the door built for agents would be an agent that opts
 * out of the record.
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
 * AND IT IS THE ONE VERB OF THIS SURFACE THAT COVERS MORE THAN ONE PROJECT, which the
 * paragraph above described as a fixed property of every verb here: `--workspace
 * <path...>` gives one verdict over the projects the caller NAMES, folded by the same
 * rule and exiting on the weakest of them. It is not a fourth set of trees found by a
 * different rule — each named path resolves exactly as a `cwd` does — and it is named
 * rather than discovered, because a CLI has no host to announce a workspace and a verb
 * that walked the disk would be guessing which projects the auditor meant.
 *
 * And `brief`, which reads unlike all of them: every verb above answers whoever ran it,
 * and this one composes a document for a reader that never asked — the session that
 * opens, through the plugin, or through a file the host reads. This sentence used to say
 * that `mnema brief > AGENTS.md` put the record "where an agent host reads it on its
 * own", and the host the plugin is for reads an `AGENTS.md` only from 2.1.277 and only
 * where no `CLAUDE.md` exists; which file reaches a session is the host's to decide, and
 * the verb's help now says so. It is also the read that deliberately does NOT
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
 * `recall` IS THE SECOND OF THAT KIND, and it is the mirror of `brief` in the one respect
 * that makes both necessary. It composes the NOTES a session opens with — the latest
 * memories and observations — and it reads EVERY tree, because an agent's note lands in the
 * tree that does not travel, which is exactly the tree `brief` may not carry. So one of the
 * two is a committed document and never machine-local, and the other is machine-local and
 * never a file; neither can be a flag of the other without breaking the half it is for.
 *
 * And three more read no record at all, because they are not about one: they are the
 * three DOORS onto everything else. `mcp` serves this surface to an agent host; `repl`
 * opens an interactive session for a person, which is the same surface with the
 * hundred-millisecond floor paid once instead of once per command; and `completion`
 * writes the script a shell needs to finish a verb somebody is typing. `completion` is
 * generated FROM the groups: it is the one verb whose answer changes when any line of them
 * does.
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
 * how a reader ends up believing the writes under "Record" are all of them. Each verb
 * answers for itself (`verb.ts`), the type makes the answer compulsory, and
 * `every-verb-says-if-it-writes.test.ts` exercises the ones that claim to read and counts
 * what reached the chain.
 */

import type { Command } from 'commander';
import { registerAging } from './aging.js';
import { registerAudit } from './audit.js';
import { registerBeforeAWrite } from './before-a-write.js';
import { registerBrief } from './brief.js';
import { registerCheck } from './check.js';
import { registerCommitHook } from './commit-hook.js';
import { registerCommits } from './commits.js';
import { registerCompletion } from './completion.js';
import { registerCorrections } from './corrections.js';
import { registerDecision } from './decision.js';
import { registerDiagram } from './diagram.js';
import { registerDoctor } from './doctor.js';
import { registerExport } from './export.js';
import { registerInherit } from './inherit.js';
import { registerInit } from './init.js';
import { registerKey } from './key.js';
import { registerLink } from './link.js';
import { registerMcp } from './mcp.js';
import { registerMemory } from './memory.js';
import { registerObserve } from './observe.js';
import { registerPromote } from './promote.js';
import { registerRecall } from './recall.js';
import { registerReferences } from './refs.js';
import { registerRepl } from './repl.js';
import { registerResume } from './resume.js';
import { registerRetract } from './retract.js';
import { registerRules } from './rules.js';
import { registerRulesFile } from './rules-file.js';
import { registerRun } from './run.js';
import { registerSearch } from './search.js';
import { registerShow } from './show.js';
import { registerSite } from './site.js';
import { registerSkill } from './skill.js';
import { registerStack } from './stack.js';
import { registerStatus } from './status.js';
import { registerSwitch } from './switch.js';
import { registerTail } from './tail.js';
import { registerTally } from './tally.js';
import { registerTask } from './task.js';
import { registerTimeline } from './timeline.js';
import { registerTrailer } from './trailer.js';
import { registerUnlink } from './unlink.js';
import { registerUsage } from './usage.js';
import type { Declared, Verb, Wiring } from './verb.js';
import { registerVerify } from './verify.js';
import { registerWhy } from './why.js';
import { registerWitness } from './witness.js';

/** A heading of `mnema --help` and the verbs listed under it, in the order they are listed. */
export interface Group {
  readonly heading: string;
  readonly verbs: readonly Verb[];
}

/**
 * The groups of `mnema --help`, in the order of the work: record, hand over, verify, read,
 * the git log, this machine, and what a host calls.
 *
 * The last group is VISIBLE on purpose. Those verbs are for a host and not for a person, but
 * two of them write (`before-a-write` records the refusal, `corrections` records what was
 * proposed), and a help that hid them would stop showing where the record can change.
 */
export const GROUPS: readonly Group[] = [
  {
    heading: 'Record:',
    verbs: [
      registerInit,
      registerDecision,
      registerLink,
      registerUnlink,
      registerMemory,
      registerObserve,
      registerRetract,
      registerSkill,
      registerStack,
      registerTask,
      registerPromote,
    ],
  },
  {
    heading: 'Hand over:',
    verbs: [
      registerStatus,
      registerBrief,
      registerRecall,
      registerRules,
      registerRulesFile,
      registerSwitch,
      registerInherit,
    ],
  },
  {
    heading: 'Verify:',
    verbs: [registerVerify, registerWitness, registerCheck, registerSite],
  },
  {
    heading: 'Read:',
    verbs: [
      registerSearch,
      registerShow,
      registerTimeline,
      registerReferences,
      registerAudit,
      registerDiagram,
      registerExport,
      registerUsage,
      registerResume,
      registerRepl,
    ],
  },
  {
    heading: 'The git log:',
    verbs: [registerWhy, registerCommits, registerAging, registerTrailer, registerCommitHook],
  },
  {
    heading: 'This machine:',
    verbs: [registerKey, registerTail, registerDoctor, registerCompletion],
  },
  {
    heading: 'Called by a host:',
    verbs: [registerMcp, registerRun, registerBeforeAWrite, registerTally, registerCorrections],
  },
];

/** Every verb, in the order `mnema --help` lists them. */
export const VERBS: readonly Verb[] = GROUPS.flatMap((group) => group.verbs);

/**
 * Hangs every verb on the program, in order, and answers with what each one may do to
 * the record.
 *
 * The answers travel back rather than being discarded, because the classification is
 * only worth declaring if it can be ASKED: a caller that decides what it is willing to
 * run — this list is what a read-only session is allowed to offer — has to read it off
 * the same registration the parser routes with, never off a list of names kept beside
 * it. The entry ignores the answer, having nothing to decide (see `program.ts`).
 */
export function registerVerbs(program: Command, wiring: Wiring): readonly Declared[] {
  const declared = GROUPS.flatMap((group) => {
    // The heading every command added from here on is listed under, until the next one.
    program.commandsGroup(group.heading);
    return group.verbs.map((verb) => verb(program, wiring));
  });
  // And no heading after the last group: a command hung on the program by any other path is
  // listed under commander's bare "Commands:", where the page's own test finds it.
  program.commandsGroup('');
  return declared;
}
