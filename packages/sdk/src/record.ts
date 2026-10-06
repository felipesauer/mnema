/**
 * The record, opened from a program.
 *
 * Every method is one call to the function the command line calls for the same verb, with what
 * the verb's own wiring passes it: no rule lives here. A refusal comes back as data with the code
 * the command line prints, and nothing is thrown for one. What it writes, it signs with the key of
 * the machine that runs it (`HOME`), exactly as `mnema` does, and attributes to `agent`.
 */

import type { LevelRequirement } from '@mnema/chain';
import {
  briefDocument,
  DEFAULT_REQUIREMENT,
  discoveryEnv,
  labelAsAddress,
  runBrief,
  runDecision,
  runDecisionTransition,
  runMemory,
  runRecall,
  runRules,
  runVerify,
} from '@mnema/code/library';
import type { DiscoveryEnv, Scope } from '@mnema/core';

/** Where the record is read from and who writes to it. */
export interface RecordOptions {
  /** The directory the project is found from — the working directory a `mnema` command would run in. */
  readonly cwd: string;
  /**
   * The name every write is attributed to: the agent this program is. A write names it the way
   * `--which` does on the command line, and `agent-accepts` can be switched off for it.
   */
  readonly agent: string;
  /** `$HOME` and `$MNEMA_HOME`, as the command line reads them. Defaults to this process's. */
  readonly env?: DiscoveryEnv;
}

/** The one door a program has to the record. */
export interface MnemaRecord {
  /** `mnema decision record`: a proposed decision, with the `ADR-<n>` label it is cited by. */
  recordDecision(input: {
    title: string;
    rationale: string;
    alternatives?: string;
    scope?: Scope;
  }): ReturnType<typeof runDecision>;
  /** `mnema decision accept`. The note says why; the gate refuses an accept without one. */
  acceptDecision(input: { id: string; note: string }): DecisionMoved;
  /** `mnema decision reject`. The note says why; the gate refuses a reject without one. */
  rejectDecision(input: { id: string; note: string }): DecisionMoved;
  /** `mnema memory`: a note about the work. */
  addNote(input: { content: string; scope?: Scope }): ReturnType<typeof runMemory>;
  /** `mnema brief`: the document of what governs the work here, as the command prints it. */
  brief(): BriefRead;
  /** `mnema recall`: the notes this session would be handed, the near ones first. */
  recall(): ReturnType<typeof runRecall>;
  /** `mnema rules <path>`: which recorded rules govern the path. Reads; charges nothing. */
  rulesFor(path: string): ReturnType<typeof runRules>;
  /** `mnema verify`: the verdict over the record, against the least the caller accepts. */
  verify(input?: { require?: LevelRequirement; global?: boolean }): ReturnType<typeof runVerify>;
}

/**
 * What a move answered. Handed the `ADR-<n>` label a write printed instead of an id, the refusal
 * (`UNKNOWN_DECISION`) carries a `message` naming the id that label stands for: the sentence the
 * command line and the MCP server say.
 */
export type DecisionMoved =
  | Exclude<ReturnType<typeof runDecisionTransition>, { readonly reason: 'UNKNOWN_DECISION' }>
  | { readonly ok: false; readonly reason: 'UNKNOWN_DECISION'; readonly message?: string };

/** The document, or the command's own refusal. */
export type BriefRead =
  | { readonly ok: true; readonly document: string }
  | Exclude<ReturnType<typeof runBrief>, { readonly ok: true }>;

/** Opens the record of the project `options.cwd` is in. Nothing is read or written until a method is called. */
export function openRecord(options: RecordOptions): MnemaRecord {
  const here = { cwd: options.cwd, env: options.env ?? discoveryEnv() };
  const which = options.agent;
  return {
    recordDecision: (input) => runDecision(here, { ...input, which }),
    acceptDecision: ({ id, note }) =>
      namingTheLabel(
        here,
        id,
        runDecisionTransition(here, { id, action: 'accept', proof: { note }, which }),
      ),
    rejectDecision: ({ id, note }) =>
      namingTheLabel(
        here,
        id,
        runDecisionTransition(here, { id, action: 'reject', proof: { note }, which }),
      ),
    addNote: (input) => runMemory(here, { ...input, which }),
    brief: () => {
      const result = runBrief(here);
      return result.ok ? { ok: true, document: briefDocument(result.brief).join('\n') } : result;
    },
    recall: () => runRecall(here),
    rulesFor: (path) => runRules(here, { path }),
    verify: (input = {}) =>
      runVerify({
        ...here,
        requirement: input.require ?? DEFAULT_REQUIREMENT,
        global: input.global === true,
      }),
  };
}

/** A refusal to find `id` that was an `ADR-<n>` label gains the sentence naming the id behind it. */
function namingTheLabel(
  here: Parameters<typeof labelAsAddress>[0],
  id: string,
  result: ReturnType<typeof runDecisionTransition>,
): DecisionMoved {
  if (result.ok || result.reason !== 'UNKNOWN_DECISION') return result;
  const message = labelAsAddress(here, id);
  return message === undefined ? result : { ...result, message };
}
