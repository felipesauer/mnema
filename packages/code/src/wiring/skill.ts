/**
 * The `mnema skill` wiring: what it declares, and what it prints.
 *
 * `skill` is a group, shaped like `task` and `decision`: its default action
 * proposes a skill (`mnema skill "<name>" --body "<text>"`), one subcommand moves an
 * existing one, and one WRITES AN ADOPTED ONE OUT as the file an agent host reads
 * (`skill export`, whose own reasons are in `commands/skill-export.ts`). A skill needs
 * BOTH a name and a body; the name is a short positional, the body a flag (`--body`) —
 * content that big never goes in a positional (the `git commit -m` / `gh --body`
 * convention).
 * The body is required, but NOT declared as commander's `requiredOption`: an
 * option on the GROUP is inherited by the `move` subcommand, and a required one
 * there would force `--body` on a move too. So it is a plain option the create
 * action checks itself — a missing `--body` on a propose is a usage error the
 * CLI reports (nothing is born), while `move` is unaffected. Propose takes an
 * optional `--scope` (the per-action birth override, defaulting to public); the
 * move takes none (it follows the entity). A skill has no alias — propose prints
 * its `name` and its `id` (the key).
 *
 * THE GROUP IS STILL DECLARED A WRITE, and `export` does not change that: a group is
 * classified by its most powerful member (`verb.ts`), and what `export` can do to the
 * RECORD is nothing at all — it writes a file, under a directory the caller named, and
 * appends no event. The two questions are not the same one, which is the distinction
 * `RecordEffect` exists to make.
 *
 * IT IS ON THIS SURFACE AND NOT ON THE AGENT'S. Exporting is an act of whoever
 * administers the repository — deciding that a pattern of this project should be a
 * skill in some host's directory — and there is no MCP tool for it. That is the same
 * division `skills` and `tail prune` already draw: the agent's surface records and
 * reads the record, the command line is the auditor's.
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import {
  actionsRequiring,
  enumeratedArgument,
  listed,
  SKILL_ACTIONS,
  scopeOption,
} from './enumerated.js';
import { writeLines } from './io.js';
import {
  declaredAgent,
  INVALID,
  parseScope,
  WHICH_HELP,
  WHICH_ON_SUBCOMMAND_HELP,
} from './options.js';
import { reportRecorded, reportRefusal, reportReplacement, reportUsage } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/**
 * Where an exported skill goes when the caller names nowhere — declared HERE, on the
 * surface, so commander prints it in the `--help` and there is one answer to it.
 *
 * `./skills` and not a host's own directory, and that is the decision rather than a
 * placeholder. `<repo>/skills/<name>/SKILL.md` is the layout the specification implies
 * and four of the five collections measured in the ecosystem study use, so the default
 * lands inside the caller's own project. A default of `~/.claude/skills` would have this
 * verb writing into another product's configuration without being asked — and putting a
 * pattern where an agent will read it as instruction is exactly the decision that has to
 * be the operator's.
 */
const DEFAULT_OUT = './skills';

/**
 * What `skill export --help` says beyond its two flags: the shape of the file, the two
 * fields the specification requires, and the three things this verb will not do.
 *
 * The DERIVATION is here because it is the field a caller cannot predict, and the two
 * refusals are here because both are cheaper to read than to hit: a name that is not a
 * specification name cannot be fixed after the fact (a skill is not renamed), and a
 * pattern that is not adopted has one way out and it is not a flag.
 */
const SKILL_EXPORT_HELP = [
  '',
  'What it writes, and what it will not:',
  '  <out>/<name>/SKILL.md — the frontmatter the skills specification defines, then the',
  '  recorded body VERBATIM. Nothing summarizes, reformats or improves the body: it is',
  '  what was signed.',
  '  `description` is REQUIRED by the specification and the record holds none, so it is',
  '  derived at export time — the first sentence of the body (or its first paragraph),',
  '  collapsed to one line and cut to 1024 characters. `--description` overrides it. No',
  '  model is asked for one anywhere.',
  '  `name` must already BE a specification name (1–64 of a-z, 0-9 and -, no hyphen at',
  '  either end, none doubled) because it has to equal the directory name. A recorded',
  '  name that is not one is refused, never rewritten into one.',
  '  Only an ADOPTED pattern is exported. A proposal put in a host’s skills directory is',
  '  read as how the work is done here; a deprecated one is a retired way of working',
  '  wearing the same face. There is no --force: adopt it, then export it.',
  '  It records nothing — no event, no consultation — and it writes nowhere but --out.',
].join('\n');

/** Registers `mnema skill` on the program. */
export function registerSkill(program: Command, wiring: Wiring): Declared {
  const { io, pinnedRun, render } = wiring;
  const skill = program
    .command('skill')
    .description('propose a reusable skill in the current project')
    .argument('<name>', 'a short title for the pattern')
    .option('--body <text>', 'the reusable pattern itself (required)')
    .addOption(
      scopeOption(
        'skill',
        'Omitted, a skill lands in the public tree (a declaration about the project).',
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(async (name: string, opts: { body?: string; scope?: string; which?: string }) => {
      const { runSkill } = await import('../commands/skill.js');
      // The body is required for a propose, but declared as a plain option (so it
      // is not inherited as mandatory by `move`); enforce it here.
      if (opts.body === undefined) {
        reportUsage(wiring, '`mnema skill` requires --body: the reusable pattern itself.');
        return;
      }
      const scope = parseScope(opts.scope, wiring);
      if (scope === INVALID) return;
      const run = pinnedRun();
      if (run === PIN_REFUSED) {
        io.fail();
        return;
      }
      const result = runSkill(here(), {
        name,
        body: opts.body,
        ...(scope !== undefined ? { scope } : {}),
        ...(opts.which !== undefined ? { which: opts.which } : {}),
        ...(run !== undefined ? { run } : {}),
      });
      if (result.ok) {
        // Print both the name (orients the human) and the id (the key a move
        // takes) — a skill has no alias.
        //
        // The name is the positional, in quotes, and it is text somebody wrote: the
        // same value `moved-record.ts` already collapses when a skill MOVES, closed
        // here for the line that reports its birth (see {@link onOneLine}).
        const { onOneLine } = await import('./on-one-line.js');
        io.out(onOneLine`Proposed skill "${result.name}" (${result.id})`);
        reportRecorded(result, io);
        return;
      }
      reportRefusal(wiring, result);
    });

  // `skill move <action> <id>` — the generic move, the sibling of `task move`.
  // The action is an argument; the surface knows no transition table. It takes
  // NO `--scope` (a move follows the entity), and rejects one that leaks in from
  // the `skill` group's option — routing a move elsewhere would split the skill's
  // history across the public/private boundary.
  const skillMove = skill
    .command('move')
    .description('move a skill through the workflow (follows the skill; takes no --scope)')
    .addArgument(enumeratedArgument('<action>', 'the transition', SKILL_ACTIONS))
    .argument('<id>', 'the skill id (the value shown when it was proposed)')
    .option(
      '--note <text>',
      `why this verdict (required by ${listed(actionsRequiring('skill', 'note'))})`,
    )
    .option(
      '--reason <text>',
      `why it fell out of use (required by ${listed(actionsRequiring('skill', 'reason'))})`,
    )
    .addHelpText('after', WHICH_ON_SUBCOMMAND_HELP)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  skillMove.action(async (action: string, id: string, opts: { note?: string; reason?: string }) => {
    const { runSkillTransition } = await import('../commands/skill-transition.js');
    const { movedLine } = await import('../moved-record.js');
    const parentOpts = (skillMove.parent?.opts() ?? {}) as { scope?: string; which?: string };
    if (parentOpts.scope !== undefined) {
      reportUsage(
        wiring,
        '`skill move` takes no --scope: a move follows the skill to the tree it was born in.',
      );
      return;
    }
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runSkillTransition(here(), {
      id,
      action,
      proof: {
        ...(opts.note !== undefined ? { note: opts.note } : {}),
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      },
      ...(parentOpts.which !== undefined ? { which: parentOpts.which } : {}),
      ...(run !== undefined ? { run } : {}),
    });
    if (result.ok) {
      io.out(movedLine('skill', result.name, result.id, result.to));
      reportReplacement(result, io);
      return;
    }
    const { noSuchRecord } = await import('./no-such-record.js');
    reportRefusal(wiring, result, { UNKNOWN_SKILL: noSuchRecord('skill', id) });
  });

  // `skill export <id>` — the pattern as the file an agent host reads. It takes the
  // group's positional shape (an id) and two options of its own, and it is the only
  // verb on this surface that writes a file: WHERE is the caller's decision, so the
  // destination is an option with a declared default and nothing else is ever touched.
  const skillExport = skill
    .command('export')
    .description('write an adopted pattern as the SKILL.md an agent host reads (records nothing)')
    .argument('<id>', 'the skill id (the value shown when it was proposed)')
    .option('--out <dir>', 'the directory the <name>/SKILL.md is written under', DEFAULT_OUT)
    .option(
      '--description <text>',
      'what the host chooses this skill by; omitted, it is derived from the body',
    )
    .addHelpText('after', SKILL_EXPORT_HELP);
  skillExport.action(async (id: string, opts: { out: string; description?: string }) => {
    const { runSkillExport } = await import('../commands/skill-export.js');
    const { exportReport } = await import('../presentation/exported.js');
    // The group's three options mean nothing on an export — nothing is born, nothing
    // moves, and nothing is recorded for an agent to be credited with — so one that
    // reaches here is refused rather than accepted and ignored. A `--which` taken in
    // silence would let a caller believe the export was attributed to their agent.
    const parentOpts = (skillExport.parent?.opts() ?? {}) as {
      body?: string;
      scope?: string;
      which?: string;
    };
    for (const [flag, value] of [
      ['--body', parentOpts.body],
      ['--scope', parentOpts.scope],
      ['--which', parentOpts.which],
    ] as const) {
      if (value === undefined) continue;
      reportUsage(
        wiring,
        `\`skill export\` takes no ${flag}: it writes out a pattern the record already ` +
          'holds — nothing is born, nothing moves and nothing is recorded.',
      );
      return;
    }
    const result = runSkillExport(here(), {
      id,
      out: opts.out,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
    });
    if (!result.ok) {
      const { noSuchRecord } = await import('./no-such-record.js');
      reportRefusal(wiring, result, { UNKNOWN_SKILL: noSuchRecord('skill', id) });
      return;
    }
    writeLines(io, exportReport(render, result));
  });
  return mutatesTheRecord(skill);
}
