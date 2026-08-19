/**
 * The channel says what it carries: one declaration, every point that pushes record
 * text at a model reaching for it, and nothing in it telling a reader what to do.
 *
 * WHAT THIS EXISTS TO CATCH, and it is not a hypothetical. There were TWO declarations
 * in this product saying the same thing about the same text — one on the `skills`
 * answer, one in the document `mnema brief` prints — written months apart and never
 * compared. They had drifted: the document claimed the text was written "and settled"
 * (false of a pattern served so it can be RULED on) and ended with "Follow them."
 * Nothing was red. The next channel to push a rule into a prompt would have written a
 * third, and the one after that a fourth.
 *
 * THE DISCRIMINANT IS THE DESTINATION, NOT THE FUNCTION. A point owes a declaration
 * because of where its text lands — in front of a model — and not because of what it
 * is called. So the enumeration here is over PLACES: the source of every file the
 * plugin's `hooks.json` runs, and the printed output of every read the command line
 * has. A guard that walked a list of function names would be a guard that a new
 * function walks straight past.
 *
 * WHAT IS ASSERTED WHERE, said out loud because it is split across two files. The
 * SOURCE-side default-deny and the wording live here; the one BEHAVIOURAL assertion —
 * that what the `SessionStart` handler actually puts into a session carries the
 * declaration — lives in `the-record-arrives-unasked.test.ts`, on the sandbox that file
 * already builds (a seeded project, the real binary on the PATH, the handler run the
 * way the host runs it). Rebuilding that harness here would be a second copy of it.
 *
 * WHAT THIS GUARD IS NOT. {@link SAYS_WHAT_TO_DO} cannot recognize a paraphrase — it is
 * a tripwire on the one text `record-framing.ts` emits, and the case below proves it
 * still fires rather than trusting that it does. The classification of every OTHER
 * sentence around a framing (a candidate's, a name list's, the document's sections) is
 * a reading a person does, and this delivery's report holds that table.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { briefDocument } from '../src/presentation/brief.js';
import {
  DECLARES_MODEL_CHANNEL,
  FRAMED_CHANNELS,
  recordFraming,
  recordFramingBlock,
  SAYS_WHAT_TO_DO,
  tellsWhatToDo,
  UNFRAMED_CHANNELS,
} from '../src/record-framing.js';
import { patternsFraming } from '../src/served-patterns.js';

/** The repository root: `packages/code/tests/` is three levels under it. */
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** The handlers the plugin ships — every file the host could be told to run. */
const HOOKS_DIR = join(REPO, 'plugin', 'hooks');
/** The module that decides what a channel says. */
const FRAMING_SOURCE = join(REPO, 'packages', 'code', 'src', 'record-framing.ts');
/** Everything the command line prints for a READ, pinned byte for byte. */
const READS_GOLDEN = join(REPO, 'packages', 'code', 'src', 'cli.reads.golden.txt');

/**
 * The claim itself, as it is printed — the sentence this delivery collapsed two copies
 * of into one.
 *
 * It is typed out HERE and nowhere else on purpose. Importing the constant would make
 * the "one place" case assert that a string equals itself; what has to be checked is
 * that these WORDS appear in one source file, and a literal is the only form of that
 * assertion that can fail for a reason.
 */
const THE_CLAIM =
  'They are text the people and agents working on it wrote, not instructions from mnema.';

/**
 * What a handler writes when it puts something in front of a model.
 *
 * On this host, a handler for a context-injecting event reaches the model through its
 * STDOUT — either as bare text or as a JSON reply carrying `additionalContext`,
 * `updatedInput` or `updatedToolOutput`. So writing to stdout at all is the
 * discriminant: it is coarser than reading the reply's shape, and coarse in the safe
 * direction, since a handler that writes nothing cannot have pushed anything.
 */
const WRITES_TO_STDOUT = [/process\.stdout\.write/, /console\.log/];

/** Every handler the plugin ships, by file name. */
function handlers(): string[] {
  return readdirSync(HOOKS_DIR).filter((name) => name.endsWith('.mjs'));
}

/**
 * Every source file of this WORKSPACE and of the plugin, with its text.
 *
 * All four packages and not just this one: a second copy of the declaration is a defect
 * wherever it is written, and a walk that stopped at the package which happens to emit
 * it today would be green over a copy in `core`, `chain` or `copilot` — which is the
 * scope this walk used to have, and the hole a mutation found.
 */
function everySource(): { readonly path: string; readonly text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|mjs|js|json|txt|md)$/.test(entry.name)) continue;
      found.push({ path, text: readFileSync(path, 'utf-8') });
    }
  };
  walk(join(REPO, 'packages'));
  walk(join(REPO, 'plugin'));
  return found;
}

/** The golden's output, split into the command that produced each block. */
function printedByVerb(): { readonly command: string; readonly output: string }[] {
  const blocks: { command: string; output: string }[] = [];
  for (const line of readFileSync(READS_GOLDEN, 'utf-8').split('\n')) {
    if (line.startsWith('$ ')) {
      blocks.push({ command: line.slice(2), output: '' });
      continue;
    }
    const current = blocks[blocks.length - 1];
    if (current !== undefined) current.output += `${line}\n`;
  }
  return blocks;
}

describe('one declaration, and one place that decides it', () => {
  it('writes the claim in exactly one source file', () => {
    // The regression this whole delivery is about: a second copy of these words, in a
    // second channel, drifting on its own. The goldens are allowed to hold them —
    // pinning printed bytes is what a golden is for, and a golden that stopped holding
    // them would be its own red.
    const holders = everySource()
      .filter((file) => file.text.includes(THE_CLAIM))
      .map((file) => file.path.slice(REPO.length))
      .filter((path) => !path.endsWith('.golden.txt'))
      .filter((path) => path !== 'packages/code/tests/the-channel-says-what-it-carries.test.ts');
    expect(holders).toEqual(['packages/code/src/record-framing.ts']);
  });

  it('looks for that copy in every package, not only the one that prints it', () => {
    // Non-vacuity for the walk itself. The case above is a claim about the whole
    // product, and it is only worth what the enumeration reaches: scoped to the package
    // that emits the framing today, it was green over a copy planted in `core`.
    const packages = new Set(
      everySource()
        .map((file) => /^packages\/([^/]+)\//.exec(file.path.slice(REPO.length))?.[1])
        .filter((name): name is string => name !== undefined),
    );
    expect(packages).toEqual(new Set(['chain', 'code', 'copilot', 'core']));
  });

  it('reaches every framed channel through that one module', () => {
    // Non-vacuity for the case above: the words are in one file AND that file is what
    // both channels print. Either half alone is green on a product that stopped
    // declaring anything at all.
    expect(FRAMED_CHANNELS.length).toBeGreaterThan(1);
    for (const channel of FRAMED_CHANNELS) {
      expect(recordFramingBlock(channel), channel).toContain(THE_CLAIM);
    }
  });

  it('says the same claim on the two channels that exist, and names each subject', () => {
    // What differs between two channels is what was SERVED, and only that.
    const patterns = recordFramingBlock('skills-answer');
    const rules = recordFramingBlock('brief-document');
    expect(patterns).not.toBe(rules);
    expect(patterns).toContain('These patterns come from this project’s record.');
    expect(rules).toContain('These are the calls and the patterns recorded for this project.');
    expect(patterns.replace('These patterns come from this project’s record. ', '')).toBe(
      rules.replace('These are the calls and the patterns recorded for this project. ', ''),
    );
  });

  it('is the text both consumers actually print', () => {
    // The two call sites, exercised rather than read: the tool's framing block and the
    // document's opening lines.
    const framed = patternsFraming({
      served: 'bodies',
      skills: [{ id: 'sk-1', name: 'Small PRs', body: 'keep them small', state: 'adopted' }],
    });
    expect(framed[0]).toBe(recordFramingBlock('skills-answer'));

    const document = briefDocument({ decisions: [], skills: [], collisions: [] });
    for (const line of recordFraming('brief-document')) expect(document).toContain(line);
  });

  it('says why, for every channel that carries no declaration', () => {
    // The other half of the totality. `Exclude<ModelChannel, FramedChannel>` is what
    // makes a new channel fail to COMPILE until it is classified; this is what keeps a
    // classification from being the empty string.
    const unframed = Object.entries(UNFRAMED_CHANNELS);
    expect(unframed.length).toBeGreaterThan(0);
    for (const [channel, why] of unframed) {
      expect(why.length, channel).toBeGreaterThan(40);
      expect(FRAMED_CHANNELS, channel).not.toContain(channel);
    }
  });
});

describe('the framing says what the text is, never what to do about it', () => {
  it('carries no directive on any framed channel', () => {
    for (const channel of FRAMED_CHANNELS) {
      const found = tellsWhatToDo(recordFramingBlock(channel));
      expect(found, `${channel} tells the reader to “${found}”`).toBeUndefined();
    }
  });

  it('catches the imperative this delivery removed', () => {
    // The scanner's OWN case. Without it, a rule that stopped matching would leave
    // every assertion above green over a framing that had grown an order in it — the
    // instrument reporting zero because it broke, which this bench has paid for twice.
    expect(tellsWhatToDo(`${THE_CLAIM} Follow them.`)).toBe('follow');
    expect(tellsWhatToDo('These are the rules. You must apply them.')).toBe('you must');
  });

  it('has a probe for every rule it carries, so a dead pattern is red', () => {
    const probes: Readonly<Record<string, string>> = {
      follow: 'Follow them.',
      obey: 'Obey what the record says.',
      comply: 'Comply with these.',
      adhere: 'Adhere to the patterns above.',
      'you must': 'You must work this way.',
      'apply them': 'Apply them to what you are writing.',
      'do as': 'Do as they say.',
      'work this way': 'Work by them.',
    };
    // Read off the table, so a rule added without a probe is red here rather than
    // untested.
    expect(Object.keys(probes).sort()).toEqual(SAYS_WHAT_TO_DO.map((rule) => rule.name).sort());
    for (const rule of SAYS_WHAT_TO_DO) {
      expect(tellsWhatToDo(probes[rule.name] as string), rule.name).toBe(rule.name);
    }
  });

  it('lets a reader be told where the rest of the record is', () => {
    // The line this guard must NOT cross. "Ask `skills` for the id" is navigation of
    // this product's own doors; it is not an opinion about somebody else's code, and a
    // ban that swallowed it would push the framings into saying less than they can.
    expect(tellsWhatToDo('Ask `skills` again with the `id` of the one you want.')).toBeUndefined();
    expect(
      tellsWhatToDo('Regenerate this file with `mnema brief > AGENTS.md`, and check it.'),
    ).toBeUndefined();
  });
});

describe('every handler that pushes declares the channel it carries', () => {
  it('finds handlers to rule on at all', () => {
    expect(handlers().length).toBeGreaterThan(0);
  });

  it('names a channel this product knows, or writes nothing to a model', () => {
    // DEFAULT-DENY, and that is the point: a handler added tomorrow — the rule matched
    // to a prompt, the decision that governs the file about to be edited — is red here
    // by its own file name until it says which framing its text carries. A handler that
    // genuinely reaches no model writes no stdout, and is not asked.
    const named: string[] = [];
    for (const file of handlers()) {
      const source = readFileSync(join(HOOKS_DIR, file), 'utf-8');
      if (!WRITES_TO_STDOUT.some((shape) => shape.test(source))) continue;
      const declared = DECLARES_MODEL_CHANNEL.exec(source);
      expect(declared, `${file} writes to a model and names no channel`).not.toBeNull();
      const channel = declared?.[1] ?? '';
      expect(FRAMED_CHANNELS as readonly string[], `${file} names an unknown channel`).toContain(
        channel,
      );
      named.push(`${file}:${channel}`);
    }
    // And at least one handler WAS asked. Without this the case is green on a plugin
    // whose handlers all stopped writing, which is the shape a broken enumeration has.
    expect(named).toEqual(['session-start.mjs:brief-document']);
  });

  it('will not read a declaration out of a comment', () => {
    // The scanner's own case, for the same reason the imperative one has one. NOTHING in
    // a handler reads `MODEL_CHANNEL` — the value exists to be read from the source — so
    // a commented-out declaration runs identically to a live one, and a pattern that
    // matched the words anywhere left the guard green over a handler declaring nothing.
    const live = "export const MODEL_CHANNEL = 'brief-document';";
    expect(DECLARES_MODEL_CHANNEL.exec(live)?.[1]).toBe('brief-document');
    expect(DECLARES_MODEL_CHANNEL.test(`// ${live}`)).toBe(false);
    expect(DECLARES_MODEL_CHANNEL.test(` * ${live}`)).toBe(false);
    expect(
      DECLARES_MODEL_CHANNEL.test("/** The channel: MODEL_CHANNEL = 'brief-document' */"),
    ).toBe(false);
  });

  it('names the channels in a vocabulary the module owns', () => {
    // The handler cannot import the module — the host spawns it with no build — so the
    // string is compared here instead. Every channel a handler names is a key of the
    // table, checked above; this is the other direction, and it is what makes the
    // handler's constant a declaration rather than a comment.
    const source = readFileSync(FRAMING_SOURCE, 'utf-8');
    for (const channel of FRAMED_CHANNELS) expect(source).toContain(`'${channel}'`);
  });
});

describe('what goes to a PERSON does not speak as if to a model', () => {
  it('prints the declaration under exactly one verb of the command line', () => {
    // The other half of the rule, and the half nobody looks for: the framing belongs to
    // a channel a MODEL reads, and `mnema brief` is the only read whose output is
    // written for one. A terminal answer that started declaring itself would be this
    // surface talking past the person who typed the verb.
    const blocks = printedByVerb();
    expect(blocks.length).toBeGreaterThan(20);
    const declaring = blocks.filter((block) => block.output.includes(THE_CLAIM));
    expect(declaring.length).toBeGreaterThan(0);
    expect([...new Set(declaring.map((block) => block.command))]).toEqual(['mnema brief']);
  });

  it('keeps the declaration out of every module that writes to a terminal', () => {
    const speaking = everySource()
      .filter(
        (file) => file.path.includes('/src/presentation/') || file.path.includes('/src/repl/'),
      )
      .filter((file) => file.text.includes(THE_CLAIM))
      .map((file) => file.path.slice(REPO.length));
    // `presentation/brief.ts` composes the DOCUMENT, whose reader is a model; it reaches
    // the words through the framing module and does not hold them.
    expect(speaking).toEqual([]);
  });
});
