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
 * A PLAIN `git pull` IS A QUESTION TOO (ADR-181): in a repository with a remote, a person is asked whether this
 * clone's own git configuration is set so that it carries the record (the driver, merge.autoStash and
 * rebase.autoStash, always together: `commands/doctor-merge-driver.ts`, the one function that writes them, which
 * `mnema doctor --fix merge-driver` calls too). The default is yes, `--yes` takes it, and `--git-pull yes|no`
 * answers it. `--all-hosts` and a founding with nobody to ask write nothing to git's configuration unless
 * `--git-pull yes` says so: they never took a question's default before, and this one changes how every file of
 * the clone is pulled.
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

import { basename, sep } from 'node:path';
import { listPrivateKeyFingerprints } from '@mnema/chain';
import { PROJECT_DIR, resolveTrees } from '@mnema/core';
import { fixMergeDriver, type MergeDriverFixed } from '../commands/doctor-merge-driver.js';
import { type InitContext, readInit, runInit } from '../commands/init.js';
import { driverCommand } from '../commands/record-pull.js';
import { fact } from '../presentation/detail.js';
import { VERSION } from '../version.js';
import { here } from '../wiring/context.js';
import {
  HOSTS_NOT_UNDERSTOOD,
  HOSTS_OFFERED,
  HOSTS_WORDS,
  type InitOptions,
  refuseTheRoot,
  sayAlready,
  sayClassic,
} from '../wiring/init.js';
import { onOneLine } from '../wiring/on-one-line.js';
import { reportRefusal, reportUsage } from '../wiring/report.js';
import type { Wiring } from '../wiring/verb.js';
import { recordWhoMayAccept, type WhoMayAcceptRecorded } from './accepts.js';
import { type Around, detectAround } from './detect.js';
import { askInit, defaultMarks, marksForHosts, printed } from './flow.js';
import { HOST_ROWS, ownFilesOf, readHostsFlag, yoursOf } from './hosts.js';
import { theWidthOf } from './layout.js';
import { type Answers, type Machine, planOf } from './plan.js';
import { planPage } from './screens.js';
import { foundingPage, summaryPage } from './summary.js';

/** A path as a person is told it: the home directory as `~`. */
export function shownFrom(home: string): (path: string) => string {
  return (path) => {
    if (home === '') return path;
    if (path === home) return '~';
    return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
  };
}

/** What this machine will do about the identity: make one, or use the one it has. */
function machineOf(ctx: InitContext, shown: (path: string) => string): Machine {
  const { keyRoot } = resolveTrees(ctx.cwd, ctx.env);
  return {
    newIdentity: listPrivateKeyFingerprints({ root: keyRoot }).length === 0,
    where: `${shown(keyRoot)}/`,
  };
}

/** All four of the product's rows, and every file of the person's that is there: what a founding with nobody to ask does. */
function everyMark(around: Pick<Around, 'detected' | 'files'>): ReadonlySet<string> {
  return marksForHosts(
    around,
    HOST_ROWS.map((row) => row.id),
    false,
  );
}

/**
 * The answer about a plain `git pull` a flag gives, before anybody is asked: `--git-pull`, or `no` for
 * `--all-hosts` (which asks nothing and is not `--yes`: a default is not taken for it).
 */
function pullFlag(opts: InitOptions): 'yes' | 'no' | undefined {
  if (opts.gitPull !== undefined) return opts.gitPull;
  return opts.allHosts === true && opts.yes !== true ? 'no' : undefined;
}

/** The answer as the field of the answers it is, or nothing. */
function pullAnswer(answer: 'yes' | 'no' | undefined): { readonly pull?: 'yes' | 'no' } {
  return answer === undefined ? {} : { pull: answer };
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

  // `--all-hosts` WAS THE FLAG THAT ASKED NOTHING, and an agent whose shell is a pseudo-terminal passes it so it
  // does not wait at a question: it keeps that promise, and is `--yes` with every host.
  const asksNothing = opts.yes === true || opts.allHosts === true;

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
  // What the question about a plain `git pull` opens on: yes where there is a remote to pull from, and no
  // question at all where there is none (a `--git-pull` flag still answers).
  const pullDefault = around.git?.remote === true ? ('yes' as const) : undefined;
  const pullGiven = around.git === undefined ? undefined : pullFlag(opts);
  // Without a terminal and without `--yes` nobody answers, and nothing is written for the pull.
  const pullUnasked = terminal === undefined && opts.yes !== true ? pullGiven : undefined;

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
      ...pullAnswer(terminal !== undefined || opts.yes === true ? (pullGiven ?? pullDefault) : pullUnasked),
    };
    io.out(onOneLine`Would found ${basename(ctx.cwd)}/${PROJECT_DIR}. Nothing was written.`);
    printed(
      { io, render },
      planPage(
        planOf(ctx.cwd, around, answers, machine),
        theWidthOf(render),
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
        ...(opts.accepts !== undefined ? { acceptsGiven: opts.accepts } : {}),
        ...(opts.accepts !== undefined && agent !== undefined ? { agent } : {}),
        ...(pullGiven !== undefined ? { pullGiven } : {}),
        ...(pullDefault !== undefined ? { pullDefault } : {}),
        yes: asksNothing,
      },
    );
    if (outcome.kind === 'left') return;
    answers = outcome.answers;
  } else {
    answers = {
      marks: hostsGiven ?? everyMark(around),
      ...(opts.accepts !== undefined ? { accepts: opts.accepts } : {}),
      ...(opts.accepts !== undefined && agent !== undefined ? { agent } : {}),
      ...pullAnswer(opts.yes === true ? (pullGiven ?? pullDefault) : pullUnasked),
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

  // The settings of a plain `git pull`, written by the function `mnema doctor --fix merge-driver` calls, after
  // the record they name exists. A clone that already holds a setting of the same name otherwise (a person's
  // `merge.autoStash=false`) is left as it is, nothing is written, and the founding says so.
  const pulled: MergeDriverFixed | undefined =
    answers.pull === 'yes'
      ? fixMergeDriver(
          { cwd: ctx.cwd, env: ctx.env, processEnv: process.env },
          { dryRun: false, driver: driverCommand(process.execPath, process.argv[1] ?? '') },
        )
      : undefined;

  if (terminal === undefined) {
    await sayClassic(io, render, result, recorded, pulled);
  } else {
    const founded = {
      cwd: ctx.cwd,
      result,
      answers,
      ...(recorded !== undefined ? { recorded } : {}),
      ...(pulled !== undefined ? { pulled } : {}),
      shown,
    };
    const width = theWidthOf(render);
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
