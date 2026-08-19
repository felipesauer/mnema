/**
 * `mnema brief` — what governs the work here, as the file an agent reads anyway.
 *
 * Every other read answers someone who asked. This one exists because the measured
 * weakness of the product is that adoption depends on the agent ASKING: three rounds
 * of use showed an agent that does go looking, but through a door that was not the
 * one designed for it — and over an empty record it concludes there is nothing
 * there. A markdown file at the root of the repository has no such problem. It
 * arrives without being asked: `AGENTS.md` is an open convention read natively by
 * several hosts, `CLAUDE.md` is read when a session opens, and the cost of being
 * read is zero.
 *
 * What those files lack is provenance — hand-kept instruction with no author, no
 * state and no supersession, rotting in silence. So this does not replace the
 * record with a file; it PROJECTS one out of it. The record stays the thing with the
 * proof, and the file is a cache that can be thrown away and made again, which is
 * the product's own doctrine about every projection it keeps.
 *
 * IT WRITES NOTHING, and that is deliberate to the point of being the design. The
 * output goes to stdout and `mnema brief > AGENTS.md` is the operator's choice, not
 * this verb's: mnema has never written outside its own tree, and writing into a file
 * the user owns opens the whole question of who owns it — what happens to a hand
 * edit, when it is regenerated, whether a `git status` goes dirty in the middle of
 * an agent's session. A redirection answers all three by never being ours.
 *
 * THERE IS NO `--check` EITHER, for the same reason and one more: `mnema brief |
 * diff - AGENTS.md` already answers "is the copy stale", exactly, with a tool every
 * operator has. A flag that read the user's file would be new surface for what a
 * pipe does — and it would have to guess where that file is.
 *
 * And no `--actor`. Measured: only the two reads that answer ABOUT AN ACTOR (`focus`,
 * `resume`) need one, and every read that answers about the project takes none. What
 * governs here is a property of the record, not of who is asking.
 *
 * IT REFUSES OUTSIDE A PROJECT, unlike `search` and `skills`, and the difference is
 * what the answer is FOR. Those two audit whatever record the caller can see, and
 * outside a project that is a person's own global tree — a legitimate thing to
 * search. This composes a document that says "recorded for this project" and is
 * meant to be redirected into that project's repository. With no project there is no
 * repository to put it in, and printing a person's global conventions under that
 * heading would be the answer that is wrong while looking right. The refusal reads as
 * one rule with the document's scope: what the file carries is the project's
 * COMMITTED record, and with no public tree there is nothing for it to be made of.
 *
 * IT REFUSES WHEN ITS OWN CHANNEL IS SWITCHED OFF, which is the second refusal it has and
 * the one a reader will not expect from a read. This verb is not only a report — it is the
 * producer of a channel, the file a session opens with, and every channel this product
 * pushes can be switched off with the switching recorded. Off, there is no document: the
 * refusal goes to stderr with a non-zero exit, so the plugin's handler is silent by the
 * rule it already has, and the person who typed the verb is told which switch is holding it
 * and where to look ({@link BriefSwitchedOff}).
 *
 * Read-only in the strict sense: a cache per visible tree, rebuilt in memory, and
 * the copilot's pure `brief`. No writer, no key, no event, no consultation recorded
 * (serving a pattern's BODY records one; serving its name is not serving it, and
 * this never touches a body). Switching a channel is a WRITE and lives in its own verb —
 * this one only reads where the switch stands.
 */

import { type Brief, brief, channelIsOn, channelStates } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { ASKS_A_PERSON_CHANNEL, DOCUMENT_CHANNEL, EDIT_PUSH_CHANNEL } from '../record-framing.js';
import { withScopedCaches } from '../tree-sources.js';

/** What the brief needs — injected so it is testable. */
export interface BriefContext {
  /** The working directory to resolve the trees from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** What governs the work here: the decisions in force and the adopted patterns. */
export interface BriefDone {
  readonly ok: true;
  /**
   * Both lists, whole. Empty is a legitimate answer and the document says which kind
   * of empty it is — nobody has decided yet, not "there are no rules".
   */
  readonly brief: Brief;
}

/** The read was refused — there is no project to compose a brief for. */
export interface BriefRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/**
 * The document was not composed because the channel that carries it is switched OFF.
 *
 * IT IS A REFUSAL AND NOT AN EMPTY DOCUMENT, and the two are not close. This verb's output
 * is the whole of a file, so printing nothing would look to `mnema brief > AGENTS.md` like
 * a record with nothing in it and would truncate a governance file the repository holds. A
 * refusal on stderr with a non-zero exit is what the plugin's handler already treats as
 * silence — it is how this verb behaves outside a project — so the session of somebody who
 * switched the document off opens with nothing added, exactly as they asked, while the
 * person who typed the verb is told why and by whom.
 *
 * It names the switch, because a person who cannot find it cannot undo it. Both fields
 * come out of the record; they are absent only in a state this refusal cannot be in, and
 * the caller words the sentence.
 */
export interface BriefSwitchedOff {
  readonly ok: false;
  readonly reason: 'SWITCHED_OFF';
  /** The channel that is off — this verb's own, named so the wording can cite it. */
  readonly channel: string;
  /** The anchor whose switch decides it. */
  readonly by: string;
  /** When that switch was made. */
  readonly at: string;
  /** Whether that switch travels with the repository, or governs this machine alone. */
  readonly travels: boolean;
}

/**
 * Composes what governs the work here out of the trees visible from `ctx.cwd` — every
 * one of them opened, and the document made of the one that travels.
 *
 * The caches go in WITH their scopes, and that is what changed here. They used to be
 * handed over stripped, on the premise that "a decision governs the work here
 * whichever tree holds it — the team's, this machine's, or the personal one — and the
 * document names no tree". The second half is still true and the first half was
 * measured wrong: a title recorded `--scope private` reached a document whose recipe
 * is a redirection into `AGENTS.md` and a commit, and two chains numbering their own
 * `ADR-<n>` put two different rules under one label. So the composition decides which
 * trees a document carries (see `brief` in @mnema/copilot), and this passes what it
 * opened.
 *
 * All three are still opened and rebuilt, rather than opening the public one alone.
 * That costs two rebuilds this answer does not print, and it buys the thing worth more
 * than them: the filter runs on the path a person actually takes, so a test over this
 * verb is a test of the rule and not of an adapter that was careful. A surface that
 * pre-filtered would make the composition's own guard vacuous — it would never be
 * handed a tree to leave out.
 */
export function runBrief(ctx: BriefContext): BriefDone | BriefRefused | BriefSwitchedOff {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  return withScopedCaches(trees, (sources) => {
    // The switch is asked over EVERY tree, unlike the document's own content: a person
    // who switched this off on their machine switched off what reaches their sessions,
    // and answering only out of the committed tree would keep printing the file at them.
    // It is the same asymmetry the composition draws for the other channel and in the
    // same direction — what a channel may do is read from every tree, what a committed
    // file may CARRY is read from one.
    if (!channelIsOn(sources, DOCUMENT_CHANNEL)) {
      const state = channelStates(sources, [DOCUMENT_CHANNEL])[0];
      return {
        ok: false as const,
        reason: 'SWITCHED_OFF' as const,
        channel: DOCUMENT_CHANNEL,
        by: state?.by ?? '',
        at: state?.at ?? '',
        travels: state?.travels ?? false,
      };
    }
    return {
      ok: true as const,
      // BOTH channels the per-edit hook pushes, named here because the vocabulary is this
      // package's. The document explains what a silence at an edit means, and there are now
      // two switches that can produce it — a document naming one of them would explain the
      // silence wrongly half the time, which is worse than not explaining it.
      brief: brief(sources, {
        editPush: EDIT_PUSH_CHANNEL,
        asksAPerson: ASKS_A_PERSON_CHANNEL,
      }),
    };
  });
}
