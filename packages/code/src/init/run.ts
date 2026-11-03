/**
 * THE `mnema init` VERB, from the flags to the last line: what it reads, what it asks, what it writes, and what
 * it says.
 *
 * IT IS THE ONE PLACE THE PIECES MEET and it holds no rule of its own. What is found is `detect.ts`, what is asked
 * is `flow.ts`, what will be done is `plan.ts` (one function, read by the screen, by `--dry-run` and by the
 * summary), what is written is `runInit` (`commands/init.ts`) and what is recorded about agents accepting is
 * `accepts.ts`. The wiring (`wiring/init.ts`) declares the verb and loads this on the action, so a program that
 * only declares verbs never reads a directory it was not asked to.
 *
 * WHETHER THE ANSWERS COME FROM A SCREEN IS DECIDED BY THE TERMINAL AND NOTHING ELSE, and every answer is a flag as
 * well: `--hosts`, `--all-hosts`, `--accepts`, `--yes`. At a terminal (a person is here AND the keys and the page
 * are a terminal: `io.terminal`) the questions are put on the screen and the summary is the trail; without one
 * nothing is asked, and the lines are the ones this verb has always printed, so a script that read them reads them
 * still (`cli.writes.golden.txt` holds them byte for byte). `--yes` answers nothing about agents accepting, and
 * says so: that question is a decision about the person's own authority over an agent, and a flag that stood for
 * their answer would put words in their mouth.
 *
 * NOTHING IS WRITTEN BEFORE THE CONFIRMATION, and `--dry-run` never writes: it prints the plan of the same function
 * and stops, in a project already founded as in one that is not (`the-init-says-what-it-found-and-writes-nothing.test.ts`).
 */

import { join, sep } from 'node:path';
import { listPrivateKeyFingerprints } from '@mnema/chain';
import { PROJECT_DIR, resolveTrees } from '@mnema/core';
import { type InitContext, type InitResult, readInit, runInit } from '../commands/init.js';
import { fact } from '../presentation/detail.js';
import type { Render } from '../presentation/render.js';
import { VERSION } from '../version.js';
import { here } from '../wiring/context.js';
import {
  HOSTS_NOT_UNDERSTOOD,
  HOSTS_OFFERED,
  HOSTS_WORDS,
  type InitOptions,
  NOT_A_PROJECT_ROOT,
  REACHES_AN_AGENT,
  REACHES_AN_AGENT_AFTER_A_WRITE,
  reportIdentity,
  reportIgnore,
  reportInstructions,
  reportWhoWritesHere,
  THE_LINE_IN_THEIRS,
  whatComesNext,
} from '../wiring/init.js';
import type { CliIo } from '../wiring/io.js';
import { onOneLine } from '../wiring/on-one-line.js';
import { reportRefusal, reportUsage } from '../wiring/report.js';
import type { Wiring } from '../wiring/verb.js';
import { recordWhoMayAccept, type WhoMayAcceptRecorded } from './accepts.js';
import { type Around, detectAround } from './detect.js';
import { askInit, defaultMarks, marksForHosts, printed } from './flow.js';
import { HOST_ROWS, ownFilesOf, readHostsFlag, yoursOf } from './hosts.js';
import { columnsOf } from './layout.js';
import { type Answers, type Machine, planOf } from './plan.js';
import { planPage } from './screens.js';
import { foundingPage, summaryPage } from './summary.js';

/** A path as a person is told it: the home directory as `~`. */
function shownFrom(home: string): (path: string) => string {
  return (path) =>
    home !== '' && path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

/** What this machine will do about the identity: make one, or use the one it has. */
function machineOf(ctx: InitContext, shown: (path: string) => string): Machine {
  const { keyRoot } = resolveTrees(ctx.cwd, ctx.env);
  return {
    newIdentity: listPrivateKeyFingerprints({ root: keyRoot }).length === 0,
    where: `${shown(keyRoot)}/`,
  };
}

/** The refusal of a directory that can be no project's root, in the words every surface uses. */
async function refuseTheRoot(
  wiring: Wiring,
  refused: Extract<ReturnType<typeof readInit>, { refused: unknown }>,
): Promise<void> {
  const { WHY_NO_PROJECT_ROOT } = await import('../not-a-project.js');
  reportRefusal(wiring, {
    reason: NOT_A_PROJECT_ROOT,
    message: onOneLine`no project can be founded at ${refused.root}: ${WHY_NO_PROJECT_ROOT[refused.refused]}. Run \`mnema init\` in the project’s own directory; a note that belongs to no project already goes to the machine-global tree, which needs none.`,
  });
}

/** What a run that founded nothing says: a project is already here, and what it lacked is added. */
async function sayAlready(io: CliIo, render: Render, result: InitResult): Promise<void> {
  if (result.completed === undefined) {
    io.out(onOneLine`Already a mnema project at ${result.root}: nothing to found.`);
  } else {
    io.out(
      onOneLine`Already a mnema project at ${result.root}: nothing to found, and what it lacked beside the record is added.`,
    );
    if (result.completed.readme) io.out('Added .mnema/README.md.');
    if (result.completed.editorconfig) io.out('Added .mnema/.editorconfig.');
    if (result.completed.gitignore) io.out('Added the lines it lacked to .mnema/.gitignore.');
    reportIgnore(io, result.completed.prettierIgnore);
  }
  reportWhoWritesHere(result, io, render, (await import('../key-file.js')).keyFileLine);
}

/** What the lines of a founding without a screen are: the ones this verb has always printed. */
async function sayClassic(
  io: CliIo,
  render: Render,
  result: InitResult,
  recorded: WhoMayAcceptRecorded | undefined,
): Promise<void> {
  io.out(onOneLine`Initialized mnema project at ${result.root}`);
  io.out(render(fact(`identity: ${result.anchor}`)));
  reportIdentity(result.identity, io, render);
  reportIgnore(io, result.around?.prettierIgnore);
  const wroteInstructions = await reportInstructions(io, render, result.around?.instructions ?? []);
  if (recorded !== undefined) {
    io.out(
      render(
        fact(
          recorded.as === 'accepted'
            ? `Recorded ${recorded.adr}: agents ${recorded.switchedOff ? 'may not' : 'may'} accept what you choose, accepted as yours.`
            : `Recorded ${recorded.adr} as the agent’s proposal: it waits for you (\`mnema decision review\`).`,
        ),
      ),
    );
  }
  io.out('');
  const reaches =
    result.around?.prettierIgnore === undefined && !wroteInstructions
      ? REACHES_AN_AGENT
      : REACHES_AN_AGENT_AFTER_A_WRITE;
  for (const line of reaches) io.out(render(fact(line)));
  io.out(render(fact(THE_LINE_IN_THEIRS, 2)));
  for (const line of whatComesNext(result)) io.out(line === '' ? '' : render(fact(line)));
}

/** All four of the product's rows, and every file of the person's that is there: what a founding with nobody to ask does. */
function everyMark(around: Pick<Around, 'detected' | 'files'>): ReadonlySet<string> {
  return marksForHosts(
    around,
    HOST_ROWS.map((row) => row.id),
    false,
  );
}

/** Runs `mnema init`. */
export async function runTheFounding(wiring: Wiring, opts: InitOptions): Promise<void> {
  const { io, render } = wiring;
  const ctx = here();
  if (opts.allHosts === true && opts.hosts !== undefined) {
    reportUsage(
      wiring,
      '--all-hosts and --hosts cannot be given together: --all-hosts is --hosts all.',
    );
    return;
  }
  const flagged = opts.hosts === undefined ? undefined : readHostsFlag(opts.hosts);
  if (flagged !== undefined && !flagged.ok) {
    reportRefusal(wiring, {
      reason: 'REFUSED',
      code: HOSTS_NOT_UNDERSTOOD,
      message: onOneLine`"${flagged.unknown}" is not a host init writes for. --hosts takes ${HOSTS_OFFERED.join(', ')} (several, separated by commas), or one of ${HOSTS_WORDS.join(', ')}. Nothing was founded and nothing was written.`,
    });
    return;
  }

  const read = readInit(ctx);
  if ('refused' in read) {
    await refuseTheRoot(wiring, read);
    return;
  }
  if (read.kind === 'already') {
    if (opts.dryRun === true) {
      io.out(
        onOneLine`Already a mnema project at ${read.root}: nothing to found. Nothing was written.`,
      );
      return;
    }
    const result = runInit(ctx);
    if ('refused' in result) {
      await refuseTheRoot(wiring, result);
      return;
    }
    await sayAlready(io, render, result);
    return;
  }

  // A FOUNDING. What is around the folder is read first, and nothing is written until the plan is agreed to.
  const around = detectAround(ctx.cwd);
  const shown = shownFrom(ctx.env.home);
  const machine = machineOf(ctx, shown);
  const terminal = io.aPersonIsHere === true ? io.terminal : undefined;
  const agent = opts.which ?? ctx.agentKey;

  // THE HOSTS A FLAG ALREADY ANSWERED: undefined is a question to ask (at a terminal) or the four files (without one).
  let hostsGiven: ReadonlySet<string> | undefined;
  if (opts.allHosts === true) hostsGiven = everyMark(around);
  else if (flagged?.ok === true)
    hostsGiven = marksForHosts(around, flagged.hosts, flagged.detected);
  else if (opts.yes === true) hostsGiven = defaultMarks(around);

  if (opts.dryRun === true) {
    const marks = hostsGiven ?? (terminal === undefined ? everyMark(around) : defaultMarks(around));
    const answers: Answers = {
      marks,
      ...(opts.accepts !== undefined ? { accepts: opts.accepts } : {}),
      ...(opts.accepts !== undefined && agent !== undefined ? { agent } : {}),
    };
    io.out(onOneLine`Would found ${shown(join(ctx.cwd, PROJECT_DIR))}. Nothing was written.`);
    printed(
      { io, render },
      planPage(
        planOf(ctx.cwd, around, answers, machine),
        columnsOf(render),
        'This is everything init would do',
      ),
    );
    io.out(
      render(
        fact(
          'Run it without --dry-run to found the project; --hosts chooses which hosts get the instructions.',
          0,
        ),
      ),
    );
    return;
  }

  let answers: Answers;
  if (terminal !== undefined) {
    const outcome = await askInit(
      { io, render, terminal },
      {
        cwd: ctx.cwd,
        around,
        name: 'mnema init',
        version: VERSION,
        machine,
        ...(hostsGiven !== undefined ? { hostsGiven } : {}),
        asksWhoMayAccept: opts.yes !== true,
        ...(opts.accepts !== undefined ? { acceptsGiven: opts.accepts } : {}),
        ...(opts.accepts !== undefined && agent !== undefined ? { agent } : {}),
        yes: opts.yes === true,
      },
    );
    if (outcome.kind === 'left') return;
    answers = outcome.answers;
  } else {
    answers = {
      marks: hostsGiven ?? everyMark(around),
      ...(opts.accepts !== undefined ? { accepts: opts.accepts } : {}),
      ...(opts.accepts !== undefined && agent !== undefined ? { agent } : {}),
    };
  }

  // WRITING. Without a terminal and with no flag about the hosts this is the call this verb has always made.
  const classic = terminal === undefined && hostsGiven === undefined;
  const everyHost = opts.allHosts === true;
  const founding: InitContext =
    classic || everyHost
      ? ctx
      : { ...ctx, instructionFiles: ownFilesOf(answers.marks), yoursFiles: yoursOf(answers.marks) };
  const result = runInit(founding);
  if ('refused' in result) {
    await refuseTheRoot(wiring, result);
    return;
  }

  let recorded: WhoMayAcceptRecorded | undefined;
  let refusal: { code: string; message: string } | undefined;
  if (answers.accepts !== undefined) {
    // The person's own key, and never the agent's: an answer about what an agent may do is not the agent's to sign.
    const done = recordWhoMayAccept({ cwd: ctx.cwd, env: ctx.env }, answers.accepts, {
      ...(answers.agent !== undefined ? { agent: answers.agent } : {}),
      given: terminal !== undefined && opts.accepts === undefined ? 'screen' : 'flag',
    });
    if (done.ok) recorded = done;
    else refusal = done;
  }

  if (terminal === undefined) {
    await sayClassic(io, render, result, recorded);
  } else {
    const founded = {
      cwd: ctx.cwd,
      result,
      answers,
      ...(recorded !== undefined ? { recorded } : {}),
      shown,
    };
    const width = columnsOf(render);
    printed({ io, render }, foundingPage(founded, width));
    printed({ io, render }, summaryPage(founded, width));
  }
  if (refusal !== undefined) {
    reportRefusal(wiring, {
      reason: 'REFUSED',
      code: refusal.code,
      message: `${refusal.message} The project is founded; the answer about agents accepting was not recorded.`,
    });
  }
}
