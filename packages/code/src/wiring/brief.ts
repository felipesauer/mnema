/**
 * The `mnema brief` wiring: what it declares, and what it prints.
 *
 * `mnema brief` — the decisions in force and the adopted patterns of the COMMITTED
 * record, as the markdown document a session opens with. It takes NO options at
 * all, which makes it the only read here with none, and every one it does not take was
 * decided rather than skipped: no `--actor` (the answer is the project's, not an
 * asker's), no `--check` (a pipe into `diff` answers that, and does not have to guess
 * where the operator's file is), no `--json` — the document IS the contract, and a
 * second serialization of the same answer would be a second thing to keep byte-stable
 * for no consumer, since what reads this file reads markdown.
 *
 * AND NO `--scope`, which is the one absence a reader of this list will look for now
 * that the document has a scope. It has ONE, and it is the point rather than a default
 * to override: the file is written to be committed, so what it carries is what a clone
 * gets. A flag would offer to put a private rule into a tracked file — the defect this
 * verb was corrected for — and the reader who wants the whole of what governs their
 * own work has the agent's opening context, which spans every tree.
 *
 * The whole output goes to stdout and nothing else. The redirection is the operator's
 * choice; the help says so, because a verb whose point is a file is a verb a reader will
 * expect to write one.
 *
 * AND THE HELP NOW SAYS WHAT THE REDIRECTION DOES, which is a premise this module used to
 * publish and had wrong. The first example on this page was `mnema brief > AGENTS.md`,
 * offered as the destination an agent host reads on its own — true, and beside the point
 * on any project that already has that file. Measured on one: 126 lines of the
 * repository's own method, and the line this page taught replaces every one of them.
 * `AGENTS.md` is a convention with tens of thousands of repositories behind it, so a
 * destination with content in it is the ordinary case. The example now names a file
 * nothing else claims, the page says the `>` replaces the whole of what it names, and it
 * says what to do where the host's own file already belongs to somebody — which is a line
 * in THEIR file, because this verb cannot merge, cannot check and cannot refuse: it never
 * learns there was a file. `the-recipe-says-what-it-overwrites.test.ts` holds both halves,
 * over this page and over the copy of the recipe inside the generated document.
 *
 * THAT LINE WAS A SENTENCE, AND THE PAGE SAID IT "REACHES THE SAME READER". For the host
 * this product ships a plugin for, a sentence naming a file reaches the reader only if the
 * agent decides to open that file; what brings the file in is an import, `@MNEMA.md`
 * (code.claude.com/docs/en/memory — a `CLAUDE.md` "that tells Claude in words" to read
 * another file is seen "only if it decides to open the file"). And the page said that
 * `AGENTS.md` and `CLAUDE.md` are both read by a host on its own, when that host reads an
 * `AGENTS.md` only from 2.1.277 and only where no `CLAUDE.md` exists — 0 of 299 sessions
 * on this machine, in two projects that keep both. Both sentences now say which host and
 * under what condition, and the page names the one route that needs no file: the plugin.
 *
 * IT CAN BE SWITCHED OFF, which is the one thing about this verb that is not a property of
 * the record. What it prints is a CHANNEL — the file a session opens with — and every
 * channel this product pushes unasked is switchable with the switching recorded. Off, this
 * verb refuses: nothing on stdout, a sentence on stderr naming the switch, a non-zero exit,
 * which is what makes the plugin's handler silent by the rule it already had. The verb is
 * still declared a READ, because switching is a different verb and this one appends nothing.
 *
 * The DOCUMENT names the agent's doors (`read_record`, `skills`, `governing_rules`,
 * `bootstrap` and `record_decision`) and this HELP names the command line's
 * (`mnema show <id>`, `mnema status`), which is not an inconsistency but the division the
 * product already draws: the file is read by an agent, and the help by the person who
 * typed the verb. Each is told the door it can actually open.
 *
 * THAT LIST SAID THREE AND THE DOCUMENT NAMED FOUR, which is worth leaving in view rather
 * than silently correcting: `governing_rules` had been in the file since the address
 * paragraph was written and never reached this sentence, because a list of names in a
 * comment is not read by anything. `record_decision` is the fifth and the only WRITE — a
 * decision of the reader's own enters the record through it — and it is the one addition
 * that changes what the division means: the file now names a door its reader can open to
 * PUT something in, not only to read more.
 *
 * THAT DIVISION IS NOT WHAT THE DOCUMENT DOES IN EVERY STATE, and saying so here is the
 * honest form of it. When a channel is switched OFF the document names `mnema switch` —
 * a command line — because the fact it is reporting is one only a person can undo, and
 * there is no agent door onto a switch. So the rule is about the ORDINARY output and
 * about who can act: the reader is told the door onto what it was just told about.
 */

import type { Command } from 'commander';
import { here } from './context.js';
import { writeLines } from './io.js';
import { reportRefusal } from './report.js';
import { type Declared, readsTheRecord, type Wiring } from './verb.js';

/**
 * What a caller is told when the channel this verb produces is switched OFF.
 *
 * IT NAMES THE SWITCH AND THE WAY BACK, and both halves are load-bearing. A person who
 * asks for a document and is told "switched off" without being told by whom cannot find
 * the fact that is holding it; and a switch is a fact of a TREE, so whether it travels
 * decides whether undoing it is this machine's business or the team's.
 *
 * It goes to stderr with a non-zero exit, which is this verb's existing behaviour outside
 * a project and is exactly what the plugin's `SessionStart` handler treats as silence. So
 * one sentence serves both readers: the session of whoever switched it off opens with
 * nothing added, and the person at the terminal is told why.
 *
 * EXPORTED, because a second verb now produces a channel a session opens with
 * (`mnema recall`) and refuses the same way for the same reason. The sentence names the
 * channel it is handed, so one wording serves both; a second copy would be the second
 * account of one switch.
 */
export function switchedOff(off: {
  channel: string;
  by: string;
  at: string;
  travels: boolean;
}): string {
  return (
    `The ${off.channel} channel is switched off, so there is no document: ` +
    `${off.by} switched it off at ${off.at}` +
    `${off.travels ? '' : ', on this machine only'}. ` +
    'Run `mnema switch` to see where every switch stands, or `mnema switch on ' +
    `${off.channel}\` to have this document again.`
  );
}

/** Registers `mnema brief` on the program. */
export function registerBrief(program: Command, wiring: Wiring): Declared {
  const { io, render } = wiring;
  const brief = program
    .command('brief')
    .description('print what governs the work here as markdown, for an agent to read')
    .addHelpText(
      'after',
      [
        '',
        'It prints to stdout and writes nothing — the redirection is yours, and `>`',
        'REPLACES the whole of the file it names:',
        '  mnema brief > MNEMA.md          the record, in a file this document owns',
        '  mnema brief | diff - MNEMA.md   whether that copy still matches the record',
        '',
        'Any name works: the check is the same pipe, and it reads the name you give it.',
        'Claude Code reads a `CLAUDE.md` at every session, and an `AGENTS.md` only from',
        '2.1.277 and only where no `CLAUDE.md` exists. Where one of those exists it is',
        'somebody’s own method and this document would replace every word of it — the',
        'line `@MNEMA.md` in a `CLAUDE.md` brings the file above in with it, where a',
        'sentence naming the file is read only if the agent chooses to open it.',
        'The mnema plugin hands this document to a Claude Code session with no file at all.',
        '',
        'The output holds no clock, no session and no path, so the same record always',
        'prints the same bytes and a difference is a difference in the record.',
        'It carries this project’s COMMITTED record — what a clone gets. A decision or a',
        'pattern recorded with `--scope private`, or in your global tree, governs your own',
        'work and is not in this file, which is written to be committed.',
        'It carries the RULES and the NAMES: a decision by title and `ADR-<n>` label, a',
        'pattern by name. Neither body is in it — a decision’s argument and a pattern’s',
        'text are both `mnema show <id>` (the file itself names the agent’s doors).',
        'It carries no work list: a queue changes by the hour, and a copy of one in a',
        'file regenerated by hand would be wrong between two runs. It does COUNT what is',
        'recorded here and awaiting a judgement, under each heading — a count over the',
        'record moves only when the record does, where the names in it move by the hour.',
        'Read those names with `mnema status --actor <id>`; the document names the door',
        'its own reader can open.',
        'It can be switched off (`mnema switch off brief-document`), and then this verb',
        'refuses instead of printing an empty file — a session that opens with nothing is',
        'what switching it off asks for, and a truncated AGENTS.md is not.',
      ].join('\n'),
    )
    .action(async () => {
      const { linkBreakNotice } = await import('./integrity.js');
      const { runBrief } = await import('../commands/brief.js');
      const { briefDocument } = await import('../presentation/brief.js');
      const result = runBrief(here());
      if (!result.ok) {
        reportRefusal(
          wiring,
          result,
          result.reason === 'SWITCHED_OFF' ? { SWITCHED_OFF: switchedOff(result) } : {},
        );
        return;
      }
      // ON `err`, AND THEREFORE NOT IN THE DOCUMENT. `mnema brief > AGENTS.md` writes the
      // whole of a file and `mnema brief | diff - AGENTS.md` compares it; a notice on
      // stdout would be committed into that file and would outlive the repair. See
      // `commands/brief.ts` for what that leaves and which door covers it.
      for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
      writeLines(io, briefDocument(result.brief));
    });
  return readsTheRecord(brief);
}
