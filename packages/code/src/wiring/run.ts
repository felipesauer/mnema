/**
 * The `mnema run` wiring: what it declares, and what it prints.
 *
 * `run` is a group, and the only one whose subject is a SESSION rather than a
 * piece of the record: `start` opens the session an agent works inside, `end`
 * seals it. A run is the unit of AUTHORIZATION — it records that a human opened
 * a session for an agent, and every fact written inside it inherits that chain.
 * The MCP server opens one per connection; these two verbs are how an agent
 * working through the CLI (a script, a CI step, an agent with no MCP) gets one.
 *
 * Neither verb takes `--scope`: a run is born in this machine's PRIVATE tree,
 * where runs live and where `focus`/`resume` read them. A work session is local
 * by nature, and letting one land in the team's tree would fill it with
 * sessions. Neither stamps a `run` on its own envelope either — a run's birth
 * and its close ARE the run (its subject), so they belong to no parent session.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { declaredAgent } from './options.js';
import { reportRefusal, reportReplacement, reportUsage } from './report.js';
import { RUN_ENV } from './run-pin.js';
import type { Wiring } from './verb.js';

/** Registers `mnema run` on the program. */
export function registerRun(program: Command, wiring: Wiring): void {
  const { io, render } = wiring;
  const runGroup = program
    .command('run')
    .description('open and close the session an agent works inside')
    .addHelpText('after', RECORD_CONTRACT_HELP);

  // `mnema run start --which <agent> [--goal <text>]`. The agent is REQUIRED, and
  // that is the model rather than strictness: a run with no agent proves no
  // delegation — it degrades into a correlation id, which is what makes a run
  // worth writing in the first place.
  //
  // Declared on each SUBCOMMAND rather than on the group, though both now take it:
  // the two flags mean different things (the agent a session is FOR, the agent
  // CLOSING one) and so carry different help, and a group's declaration SHADOWS a
  // subcommand's — one declaration up there would give both verbs one wording and
  // leave the second one to be discovered as wrong.
  runGroup
    .command('start')
    .description('open a session for an agent (facts written in it are pinned to it)')
    .requiredOption(
      '--which <agent>',
      'the agent this session is for — required: a run with no agent authorizes nothing',
      declaredAgent,
    )
    .option('--goal <text>', 'what this session sets out to do')
    .action(async (opts: { which: string; goal?: string }) => {
      const { runRunStart } = await import('../commands/run-start.js');
      const result = runRunStart(here(), {
        agent: opts.which,
        ...(opts.goal !== undefined ? { goal: opts.goal } : {}),
      });
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      io.out(`Started run ${result.id}`);
      // Both halves AS RECORDED, never as typed: echoing `opts.goal` would print a
      // credential on the line directly above the one reporting it was replaced.
      io.out(
        render(fact(`for ${result.agent}${result.goal !== undefined ? ` — ${result.goal}` : ''}`)),
      );
      reportReplacement(result, io);
      // The export line alone, so it can be selected, pasted or eval'd. A process
      // cannot set a variable in the shell that started it, so printing the line
      // is the whole of what this command can honestly do about it.
      io.out('');
      io.out(`export ${RUN_ENV}=${result.id}`);
      io.out('');
      io.out(render(fact('Run that in this shell: every fact written after it is pinned to this')));
      io.out(render(fact('session. `mnema run end` closes it.')));
    });

  // `mnema run end [<id>] --which <agent> [--outcome <text>]`. The id is OPTIONAL
  // and falls back to the open session in the environment — closing the session you
  // are in is the common case, and making it retype an id would be ceremony. With
  // neither, it says how to close one instead of guessing which.
  //
  // The agent is REQUIRED, as it is on `start`: this pair is how an agent driving
  // the command line gets a session, and a close that could omit its executor would
  // record the session an agent worked in as sealed by the person — which it did,
  // and which no read could tell apart from a person who really did close it.
  runGroup
    .command('end')
    .description('close a session (by default the one MNEMA_RUN names)')
    .argument('[id]', `the run to close; omitted, the one ${RUN_ENV} names`)
    .requiredOption(
      '--which <agent>',
      'the agent closing this session — required: a close with no agent is credited to you',
      declaredAgent,
    )
    .option('--outcome <text>', 'a short note on how the session went')
    .action(async (id: string | undefined, opts: { which: string; outcome?: string }) => {
      const { runRunEnd } = await import('../commands/run-end.js');
      const fromEnv = process.env[RUN_ENV]?.trim();
      const target = id ?? fromEnv;
      if (target === undefined || target.length === 0) {
        reportUsage(
          wiring,
          '`mnema run end` needs a run: pass its id, or set ' +
            `${RUN_ENV} to the one \`mnema run start\` printed.`,
        );
        return;
      }
      const result = runRunEnd(here(), {
        run: target,
        which: opts.which,
        ...(opts.outcome !== undefined ? { outcome: opts.outcome } : {}),
      });
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      io.out(`Ended run ${result.id}`);
      // The agent AS RECORDED, on its own line, the way the birth names the one the
      // session is for: `by` and not `for`, because this half says who did the
      // closing and the other says who the session was opened for — the same two
      // questions the envelope and the payload keep apart.
      if (result.agent !== undefined) io.out(render(fact(`by ${result.agent}`)));
      reportReplacement(result, io);
      // A shell still pinned to the run just closed would have every write
      // refused (the run is no longer open), so say how to let go of it — but
      // only when the variable really names THIS run.
      if (fromEnv === target) {
        io.out('');
        io.out(`unset ${RUN_ENV}`);
        io.out('');
        io.out(render(fact('Run that too: a shell pinned to a closed session cannot write.')));
      }
    });
}
