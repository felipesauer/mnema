/**
 * `mnema recall --after-a-compaction --session <id>`: what a session had recorded with the record
 * before its conversation was compacted, as a sentence for the conversation that continues.
 *
 * WHAT IT IS FOR. A compaction replaces the conversation with a summary, and the summary keeps
 * what the model thought worth keeping: the decisions the session settled and recorded are, in the
 * field, among the first things it drops. The brief and the notes the session opens with come back
 * on their own (a `SessionStart` that fires after a compaction too), and say what the project
 * holds; what is lost is what THIS session had done with the record. The journal `mnema tally`
 * keeps (`session-journal.ts`) holds exactly that, in ids and counts, and this is the sentence
 * made of it.
 *
 * A FACT AND NOT AN ORDER, in the voice of the other hooks: it says what was counted and from
 * where, with the labels of the decisions the record numbered, and no word of anybody's. It
 * names no tool and asks for nothing. A sentence of about sixty to a hundred and twenty tokens.
 *
 * IT SPEAKS ONLY WHEN THERE IS SOMETHING TO SAY: a session with no journal (its channel off, no
 * `Stop` yet, a host that names no session) or one that did nothing with the record is the empty
 * answer, and so is a project that is not here. Where the channel is switched off it refuses, in
 * the shape `mnema brief` refuses in, which the plugin's handler reads as silence.
 *
 * It reads, and writes nothing to the record: the journal and a cache per visible tree.
 */

import { channelIsOn } from '@mnema/context';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { AFTER_A_COMPACTION_CHANNEL, SESSION_JOURNAL_CHANNEL } from '../record-framing.js';
import {
  decisionsRecordedSince,
  type Journal,
  journalFile,
  readJournal,
  sessionIdOf,
} from '../session-journal.js';
import { withScopedCaches } from '../tree-sources.js';
import { type BriefSwitchedOff, switchedOff } from './brief.js';

/** What the reminder needs: injected so it is testable. */
export interface AfterACompactionContext {
  /** Where the host started the hook: the project is resolved from it. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
  /** The host's id for the session whose conversation was compacted. */
  readonly session: string | undefined;
}

/** The reminder, or no text where there is nothing to say. */
export interface AfterACompactionDone {
  readonly ok: true;
  /** The sentence, or `undefined` when there is nothing to say. */
  readonly text: string | undefined;
}

/** The read was refused: there is no project here. */
export interface AfterACompactionRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/** How many of a thing, in the words the sentence uses for it. */
function counted(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The sentence: what the journal holds, each part left out when it is zero. Undefined when every
 * part is.
 */
export function afterACompactionSentence(
  journal: Pick<
    Journal,
    | 'decisions'
    | 'notes'
    | 'filesEdited'
    | 'questionsWithoutDecision'
    | 'decisionFilesUncited'
    | 'tasksInProgress'
  >,
  labels: ReadonlyMap<string, string>,
): string | undefined {
  const parts: string[] = [];
  if (journal.decisions.length > 0) {
    const named = journal.decisions.flatMap((one) => {
      const label = labels.get(one.id);
      return label === undefined ? [] : [`${label}: ${one.state}`];
    });
    parts.push(
      `${counted(journal.decisions.length, 'decision', 'decisions')} recorded in this project’s record` +
        (named.length === 0 ? '' : ` (${named.join('; ')})`),
    );
  }
  if (journal.notes.length > 0) {
    parts.push(
      `${counted(journal.notes.length, 'note', 'notes')} of this host’s memory copied into this machine’s private tree`,
    );
  }
  if (journal.questionsWithoutDecision > 0) {
    parts.push(
      `${counted(journal.questionsWithoutDecision, 'question', 'questions')} answered with no decision recorded after`,
    );
  }
  if (journal.decisionFilesUncited > 0) {
    parts.push(
      `${counted(journal.decisionFilesUncited, 'file', 'files')} of decisions that the record cites nowhere`,
    );
  }
  if (journal.tasksInProgress.length > 0) {
    parts.push(`${counted(journal.tasksInProgress.length, 'task', 'tasks')} in progress`);
  }
  if (journal.filesEdited > 0) {
    parts.push(`its own tool calls wrote ${counted(journal.filesEdited, 'file', 'files')}`);
  }
  if (parts.length === 0) return undefined;
  return `Before this conversation was compacted, this session had: ${parts.join('; ')}.`;
}

/** Answers for the session `ctx.session`: its sentence, nothing, or a refusal. */
export function runAfterACompaction(
  ctx: AfterACompactionContext,
): AfterACompactionDone | AfterACompactionRefused | BriefSwitchedOff {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const session = sessionIdOf(ctx.session);
  return withScopedCaches(trees, (sources) => {
    const off = switchedOff(sources, AFTER_A_COMPACTION_CHANNEL);
    if (off !== undefined) return off;
    if (session === undefined || !channelIsOn(sources, SESSION_JOURNAL_CHANNEL)) {
      return { ok: true as const, text: undefined };
    }
    const file = journalFile(trees, session);
    const journal = file === undefined ? undefined : readJournal(file);
    if (journal === undefined) return { ok: true as const, text: undefined };
    const labels = new Map(
      sources.flatMap((source) =>
        source.cache.listDecisions().map((one) => [one.id, one.adr] as const),
      ),
    );
    // THE DECISIONS ARE THE RECORD'S, since the instant the session opened, in the state they have
    // now: the journal is written at the end of a response, so one recorded after it, or moved
    // since, is not in it. Where the journal knows no instant, what it kept is all there is.
    const decisions = decisionsRecordedSince(sources, journal.openedAt) ?? journal.decisions;
    return { ok: true as const, text: afterACompactionSentence({ ...journal, decisions }, labels) };
  });
}
