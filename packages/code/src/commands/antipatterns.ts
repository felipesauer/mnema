/**
 * `mnema antipatterns` — recurring shapes in the record, with their evidence.
 *
 * The third INTELLIGENCE read: it folds the present trees ({@link recordEvents}) and
 * surfaces the shapes that recur — tasks reopened, decisions superseded, skills
 * deprecated — each with the exact events that make up the count, plus the `ADR-<n>`
 * labels that name more than one rule. It POINTS, it does not CONCLUDE: nothing here
 * calls a count a problem, and the `skillCandidates` it names (tasks reopened more
 * than once) are a POINTER for a human who might distill a pattern, never a skill this
 * read creates. The word "antipattern" names the shape it looks for, not a verdict.
 *
 * The counts are over the UNION and the labels are per CHAIN, which is the source
 * saying what each answer is about: a task's story is the record's, and a label is
 * numbered inside one chain, so a public `ADR-1` beside a private one is two chains
 * doing what they should rather than a clash.
 *
 * ONE PROJECT's record, which is what a command run in a directory is about — `cwd`
 * resolves one project, and nothing here is handed a second one. THE REASON GIVEN USED
 * TO BE WIDER AND IS NOW FALSE: it read *"there is no workspace here to span"*, and
 * `mnema verify --workspace` spans one — the caller NAMES the projects, so a CLI verb
 * can cover several without a host to announce them. What survived is the shape of THIS
 * read: it is asked about the directory it was run in, and it is handed no set. The MCP
 * tool of the same name is opened over several projects at once, so it answers with one
 * set of shapes per record and never adds two together; this answers about the record it
 * was run in, which is the same fold over the same trees.
 *
 * AND IT CARRIES ONE READING THE TOOL DOES NOT, WHICH IS THE POINT OF SAYING SO HERE.
 * `moves` — whether the run that moved a pattern had been served its body — is the
 * command line's alone, and the temptation to unify the two answers is exactly what this
 * paragraph exists against. Handing an agent a tool for checking whether it consulted
 * before it moved inverts the axis: the MCP surface is the agent's and the command line
 * is the auditor's, and an auditor's finding that the audited party can query and clear
 * before anyone reads it is not a finding. It costs nothing to compute — the same fold,
 * already in hand — which is why it lives beside the shapes rather than in a verb of its
 * own opening the tails a second time.
 *
 * Read-only: it reads the present trees' tails and folds them with the copilot's
 * pure `antipatterns`. No cache, no writer, no key, and no actor (the shapes are
 * a property of the record). A shape-free record yields empty lists, not an
 * error. With no project at all it refuses `NO_PROJECT`, the same refusal the
 * other intelligence reads give.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  type Antipatterns,
  antipatterns,
  type PatternMoveWitness,
  patternMoveWitness,
} from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { recordEvents } from '../intelligence-source.js';

/** What the antipatterns command needs — injected so it is testable. */
export interface AntipatternsContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The recurring shapes found in the record, each a pointer to its evidence. */
export interface AntipatternsDone {
  readonly ok: true;
  /**
   * The shapes: reopened tasks, superseded decisions, deprecated skills, candidates,
   * and the `ADR-<n>` labels more than one rule of a chain answers to.
   */
  readonly patterns: Antipatterns;
  /**
   * Whether the run that moved a pattern had been served its body — and, where the
   * record cannot say, the fact that it cannot.
   *
   * It RIDES BESIDE the shapes rather than inside them, the way `runSkills` carries the
   * consultation counts beside the provenance, and for a reason that is not tidiness:
   * `Antipatterns` is what the MCP tool answers with, and this reading is the command
   * line's alone. Folded into that type it would arrive on the agent's surface as a
   * side effect of living in the same file.
   */
  readonly moves: PatternMoveWitness;
}

/** The read was refused — there is no project to inspect. */
export interface AntipatternsRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/**
 * Reports the recurring shapes of the record the present trees make up. Each
 * finding carries the evidence events in stream order. A record with no such
 * shapes yields empty lists. Read-only: it reads the tails and folds them,
 * opening no writer and no cache.
 */
export function runAntipatterns(ctx: AntipatternsContext): AntipatternsDone | AntipatternsRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const record = recordEvents(trees, catalogUpcasters());
  return { ok: true, patterns: antipatterns(record), moves: patternMoveWitness(record.events) };
}
