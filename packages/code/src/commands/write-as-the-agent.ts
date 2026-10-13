/**
 * WHO A WRITE OF THE COMMAND LINE IS SIGNED AS, WHERE `MNEMA_AGENT_KEY` ASKS FOR AN AGENT.
 *
 * The server reads the variable and signs as the agent the record enrols; the verbs that write a
 * fact such an agent's key may sign read it the same way, through the functions here. A verb that
 * writes a fact of the person's (an enrolment, a retirement, the founding, a checker's result)
 * does not come here, and `every-write-of-the-command-line-says-whose-it-is` holds the line
 * between the two.
 *
 * What the key does is the core's, and it is the server's: where the agent's key is enrolled by
 * the tree written, it signs; where it is not, the person's signs when it opens, and where it
 * does not, the write is refused and NOTHING IS MADE (no key of the person's, no identity). What
 * is added here is the `which`:
 *   - where the agent signs, the name the RECORD gives it, whatever `--which` said, because
 *     `verify` refuses a fact its key signs under another name and no gate of the core does;
 *   - elsewhere, what `--which` said, or else the name the variable asked for, declared.
 * And the origin of the fact, which decides the tree of a memory or an observation, is that same
 * name: the author is an agent, and what an agent notes goes to the private tree.
 */

import {
  agentNameRefusal,
  agentSignsIn,
  type DiscoveryEnv,
  type Origin,
  type ResolvedTrees,
  resolveTrees,
  type Scope,
  withAgentKey,
} from '@mnema/core';

/** What a verb that writes is handed: where it runs, the agent it was asked for, where it speaks. */
export interface AgentWrites {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
  /** The agent `MNEMA_AGENT_KEY` named, not yet checked to be a name this product enrols. */
  readonly agentKey?: string;
  /** The second stream, one line at a time; absent where nobody listens. */
  readonly say?: (line: string) => void;
}

/** The trees a write goes to, and the agent they were built for, if any. */
export interface Writing {
  readonly trees: ResolvedTrees;
  /** The agent asked for, once its name has passed; absent for none, and for a name that did not. */
  readonly agentKey?: string;
  readonly say?: (line: string) => void;
}

/**
 * The trees to write in. With an agent asked for, they sign as it where the record enrols it; a
 * name this product does not enrol is no agent, the line that says so is the one the hook says,
 * and the person's key signs as it always did.
 */
export function treesToWrite(ctx: AgentWrites): Writing {
  const resolved = resolveTrees(ctx.cwd, ctx.env);
  const said = ctx.say === undefined ? {} : { say: ctx.say };
  if (ctx.agentKey === undefined) return { trees: resolved, ...said };
  const unnamed = agentNameRefusal(ctx.agentKey);
  if (unnamed !== undefined) {
    ctx.say?.(`The agent key was ignored: ${unnamed}`);
    return { trees: resolved, ...said };
  }
  return {
    trees: withAgentKey(resolved, ctx.env, ctx.agentKey),
    agentKey: ctx.agentKey,
    ...said,
  };
}

/** The origin of a fact, for the choice of a tree: the agent that executed it, declared or asked for. */
export function originOfTheWrite(writing: Writing, declared: string | undefined): Origin {
  const which = declared ?? writing.agentKey;
  return which === undefined ? {} : { which };
}

/**
 * The `which` the fact is written with in `scope`'s tree: the name the record gives the agent
 * where its key signs there; else the declared one; else the agent the variable asked for.
 * A `--which` that names another than the record's name is not written, and the second stream
 * says so — unless the name is the product's own (`typed` false), which nobody wrote on a line.
 */
export function whichOfTheWrite(
  writing: Writing,
  scope: Scope,
  declared: string | undefined,
  typed = true,
): string | undefined {
  const signing = agentSignsIn(writing.trees, scope);
  if (signing === undefined) return declared ?? writing.agentKey;
  if (typed && declared !== undefined && declared !== signing.name) {
    writing.say?.(
      `--which "${declared}" was ignored: this is signed by the agent "${signing.name}", and the fact names it as the record does.`,
    );
  }
  return signing.name;
}
