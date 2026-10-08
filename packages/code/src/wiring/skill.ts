/**
 * The `mnema skill` wiring: what it declares, and what it prints.
 *
 * `skill` is a group, shaped like `task` and `decision`: one subcommand proposes a
 * skill (`mnema skill create "<name>" --body "<text>"`), one moves an
 * existing one, and one WRITES AN ADOPTED ONE OUT as the file an agent host reads
 * (`skill export`, whose own reasons are in `commands/skill-export.ts`), and one READS WHERE
 * EACH CAME FROM (`skill provenance`, below). A skill needs
 * BOTH a name and a body; the name is a short positional, the body a flag (`--body`) —
 * content that big never goes in a positional (the `git commit -m` / `gh --body`
 * convention).
 * The body is required (from `--body`, `--stdin` or `--body-file`), but NOT declared as commander's `requiredOption`: the
 * group declares it too, so a `--body` written after `create` lands on the GROUP
 * and the subcommand's own required option would never see it. So it is a plain
 * option the create action checks itself — a missing `--body` on a propose is a usage error the
 * CLI reports (nothing is born), while `move` is unaffected. Propose takes an
 * optional `--scope` (the per-action birth override, defaulting to public); the
 * move takes none (it follows the entity). A skill has no alias — propose prints
 * its `name` and its `id` (the key).
 *
 * THE GROUP IS STILL DECLARED A WRITE, and `export` and `provenance` do not change that: a
 * group is classified by its most powerful member (`verb.ts`), and what those two can do to
 * the RECORD is nothing at all — it writes a file, under a directory the caller named, and
 * appends no event. The two questions are not the same one, which is the distinction
 * `RecordEffect` exists to make.
 *
 * IT IS ON THIS SURFACE AND NOT ON THE AGENT'S. Exporting is an act of whoever
 * administers the repository — deciding that a pattern of this project should be a
 * skill in some host's directory — and there is no MCP tool for it. That is the same
 * division `skill provenance` and `tail prune` already draw: the agent's surface records and
 * reads the record, the command line is the auditor's.
 */

import type { Command } from 'commander';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { addBodySourceOptions } from './body-source.js';
import { here } from './context.js';
import {
  actionsRequiring,
  enumeratedArgument,
  listed,
  SKILL_ACTIONS,
  scopeOption,
} from './enumerated.js';
import { fromTheGroup, REFUSED, takesFromItsGroup } from './from-the-group.js';
import { writeLines } from './io.js';
import { createsBy } from './misuse.js';
import { noSuchRecord } from './no-such-record.js';
import { onOneLine } from './on-one-line.js';
import {
  declaredAgent,
  INVALID,
  parseScope,
  WHICH_HELP,
  WHICH_ON_SUBCOMMAND_HELP,
} from './options.js';
import { reportRecorded, reportRefusal, reportReplacement } from './report.js';
import { PIN_REFUSED } from './run-pin.js';
import { type Declared, groupOf, mutatesTheRecord, readsTheRecord, type Wiring } from './verb.js';

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
  '  model is asked for one anywhere. A derived one with no "when", "whenever" or "quando"',
  '  in it is exported all the same, with a warning on the second stream.',
  '  `name` must already BE a specification name (1–64 of a-z, 0-9 and -, no hyphen at',
  '  either end, none doubled) because it has to equal the directory name. A recorded',
  '  name that is not one is refused, never rewritten into one.',
  '  Only an ADOPTED pattern is exported. A proposal put in a host’s skills directory is',
  '  read as how the work is done here; a deprecated one is a retired way of working',
  '  wearing the same face. There is no --force: adopt it, then export it.',
  '  It records nothing — no event, no consultation — and it writes nowhere but --out.',
].join('\n');

/** What `--body` is, said once for the group and for `create`, which both declare it. */
const BODY_HELP = 'the reusable pattern itself (or give it with --stdin or --body-file)';

/** Registers `mnema skill` on the program. */
export function registerSkill(program: Command, wiring: Wiring): Declared {
  const { io, pinnedRun, render } = wiring;
  const skill = program
    .command('skill')
    .description('propose, move or export a reusable skill, or show where each came from')
    .option('--body <text>', BODY_HELP)
    .addOption(
      scopeOption(
        'skill',
        'Omitted, a skill lands in the public tree (a declaration about the project).',
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  addBodySourceOptions(skill, 'pattern');

  // `skill create <name> --body <text>` — the verb the agent's surface calls `create_skill`.
  // The group used to propose with the name typed right after its name, and a group that takes
  // a free word cannot refuse a mistyped subcommand: `mnema skill exportZZZ --body abc` proposed
  // a skill called `exportZZZ`. Its flags are its own, so its `--help` lists them; written after
  // `create` they still land on the group, which declares the same three, and are read from
  // there — which is also why `--body` is checked here rather than declared required: commander
  // would ask the subcommand for a value the group took.
  const create = skill
    .command('create')
    .description('propose a reusable skill in the current project')
    .argument('<name>', 'a short title for the pattern')
    .option('--body <text>', BODY_HELP)
    .addOption(
      scopeOption(
        'skill',
        'Omitted, a skill lands in the public tree (a declaration about the project).',
      ),
    )
    .option('--which <agent>', WHICH_HELP, declaredAgent)
    .addHelpText('after', RECORD_CONTRACT_HELP);
  addBodySourceOptions(create, 'pattern');
  createsBy(create);
  create.action(async (name: string) => {
    const given = await fromTheGroup<{
      body?: string;
      scope?: string;
      which?: string;
      stdin?: boolean;
      bodyFile?: string;
    }>(create, wiring);
    if (given === REFUSED) return;
    const { runSkill } = await import('../commands/skill.js');
    const { bodyFrom } = await import('./body-source.js');
    const body = await bodyFrom(wiring, 'reusable pattern', 'with --body', {
      typed: given.body,
      stdin: given.stdin,
      bodyFile: given.bodyFile,
    });
    if (body === REFUSED) return;
    const scope = parseScope(given.scope, wiring);
    if (scope === INVALID) return;
    const run = pinnedRun();
    if (run === PIN_REFUSED) {
      io.fail();
      return;
    }
    const result = runSkill(here(), {
      name,
      body,
      ...(scope !== undefined ? { scope } : {}),
      ...(given.which !== undefined ? { which: given.which } : {}),
      ...(run !== undefined ? { run } : {}),
    });
    if (result.ok) {
      // Print both the name (orients the human) and the id (the key a move
      // takes) — a skill has no alias.
      //
      // The name is the positional, in quotes, and it is text somebody wrote: the
      // same value `moved-record.ts` already collapses when a skill MOVES, closed
      // here for the line that reports its birth (see {@link onOneLine}).
      io.out(onOneLine`Proposed skill "${result.name}" (${result.id})`);
      reportRecorded(result, io);
      return;
    }
    reportRefusal(wiring, result);
  });

  // `skill move <action> <id>` — the generic move, the sibling of `task move`.
  // The action is an argument; the surface knows no transition table. It takes
  // the group's `--which` and NO `--scope` (a move follows the entity), and refuses
  // every flag of the group it does not read (`from-the-group.ts`) — routing a move
  // elsewhere would split the skill's history across the public/private boundary.
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
  takesFromItsGroup(skillMove, {
    takes: ['--which'],
    refuses: {
      '--scope': 'a move follows the skill to the tree it was born in.',
      '--body':
        'a skill’s body is recorded when it is proposed, and a move changes only its state.',
    },
  });
  skillMove.action(async (action: string, id: string, opts: { note?: string; reason?: string }) => {
    const given = await fromTheGroup<{ which?: string }>(skillMove, wiring);
    if (given === REFUSED) return;
    const { runSkillTransition } = await import('../commands/skill-transition.js');
    const { movedLine } = await import('../moved-record.js');
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
      ...(given.which !== undefined ? { which: given.which } : {}),
      ...(run !== undefined ? { run } : {}),
    });
    if (result.ok) {
      io.out(movedLine('skill', result.name, result.id, result.to));
      reportReplacement(result, io);
      return;
    }
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
  // The group's three options mean nothing on an export — nothing is born, nothing
  // moves, and nothing is recorded for an agent to be credited with — so one that
  // reaches here is refused rather than accepted and ignored. A `--which` taken in
  // silence would let a caller believe the export was attributed to their agent.
  const nothingIsRecorded =
    'it writes out a pattern the record already holds — nothing is born, nothing moves and ' +
    'nothing is recorded.';
  takesFromItsGroup(skillExport, {
    refuses: {
      '--body': nothingIsRecorded,
      '--scope': nothingIsRecorded,
      '--which': nothingIsRecorded,
    },
  });
  skillExport.action(async (id: string, opts: { out: string; description?: string }) => {
    if ((await fromTheGroup(skillExport, wiring)) === REFUSED) return;
    const { linkBreakNotice } = await import('./integrity.js');
    const { runSkillExport } = await import('../commands/skill-export.js');
    const { exportReport, exportWarning } = await import('../presentation/exported.js');
    const result = runSkillExport(here(), {
      id,
      out: opts.out,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
    });
    if (!result.ok) {
      reportRefusal(wiring, result, { UNKNOWN_SKILL: noSuchRecord('skill', id) });
      return;
    }
    // The file is already written by now, and that is exactly why this is said: what
    // left the record and went into somebody else's directory came off a record whose
    // proof failed, and the person who ran the export is the one who can still decide
    // what to do about the file.
    for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
    writeLines(io, exportReport(render, result));
    for (const line of exportWarning(result)) io.err(render(line));
  });
  // `skill provenance` — where each pattern came from: its state, the tree it lives in, who
  // proposed it and who adopted it. The agent's `skills` TOOL does something else — it serves a
  // pattern's body to an agent about to work by it, and this audits the provenance for a person
  // deciding whether it should be — and the help says so, because a reader has every reason to
  // assume one verb per tool. It takes none of its group's flags: nothing is born, nothing moves
  // and nothing is recorded.
  const provenance = skill
    .command('provenance')
    .description('show where each pattern came from (who proposed it, who adopted it)')
    .option('--json', 'emit the faithful provenance as JSON')
    .addHelpText(
      'after',
      [
        '',
        'This is the AUDIT of the patterns, not the patterns themselves:',
        '  The `skills` tool on the MCP surface serves a pattern’s body to an agent.',
        '  This verb reads who put each one there. `mnema show <id>` reads a body.',
        '  Only an adopted pattern is served to an agent; the other states are not.',
        '  An act with no agent behind it was a person acting directly.',
        '  A consultation is one run served the body — not that the work followed it,',
        '  and counted in this project’s trees and the machine-global one, no other.',
        '  It records nothing — no event, no consultation.',
      ].join('\n'),
    );
  takesFromItsGroup(provenance, {
    refuses: {
      '--body': nothingIsRecorded,
      '--scope': nothingIsRecorded,
      '--which': nothingIsRecorded,
    },
  });
  provenance.action(async (opts: { json?: boolean }) => {
    if ((await fromTheGroup(provenance, wiring)) === REFUSED) return;
    const { linkBreakNotice } = await import('./integrity.js');
    const { runSkills } = await import('../commands/skills.js');
    const { provenanceReport } = await import('../presentation/provenance.js');
    const result = runSkills(here());
    // BEFORE the answer, and on the other stream — so it survives a pipe, and so
    // `--json` stays the machine-readable thing it promises to be.
    for (const line of linkBreakNotice(result.linkBreaks)) io.err(render(line));
    if (opts.json === true) {
      io.out(JSON.stringify(result.patterns, null, 2));
      return;
    }
    writeLines(io, provenanceReport(render, result.patterns, result.consultations));
  });
  // `export` writes a file and nothing of the record, and is still a write to the console: a session
  // advertised as read-only does not put files on a disk. `provenance` records nothing at all.
  return groupOf(skill, [
    mutatesTheRecord(create),
    mutatesTheRecord(skillMove),
    mutatesTheRecord(skillExport),
    readsTheRecord(provenance),
  ]);
}
