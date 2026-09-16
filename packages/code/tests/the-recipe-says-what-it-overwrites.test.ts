/**
 * WHEREVER THIS PRODUCT PUBLISHES THE RECIPE, IT SAYS WHAT THE REDIRECTION DOES.
 *
 * THE DEFECT THIS WAS WRITTEN FOR, measured on a real repository. The first example on
 * `mnema brief --help` was `mnema brief > AGENTS.md`, and on the project it was measured
 * against that file held 126 lines of the repository's own method — its skills, its
 * plugins, its local prohibitions — and not one mention of mnema. Running the line the
 * product taught would have replaced all of it. `AGENTS.md` is an open convention with
 * tens of thousands of repositories behind it, so a file with content in it is the
 * ORDINARY case and not the exceptional one, and the recipe was published as though the
 * destination were free.
 *
 * WHY IT IS A TEXT GUARD AND NOT A REFUSAL, which is the whole shape of the fix. This
 * verb writes nothing: the `>` is the shell's, not the product's, and `brief` never
 * learns the name of the file or that there was one. So there is no moment at which
 * anything could check, refuse, back up or merge — the only place the truncation can be
 * named is the text that teaches the redirection, BEFORE somebody types it. Making the
 * verb write would answer this differently and is a different product.
 *
 * ONE SENTENCE, READ IN N PLACES. The recipe is published twice — the help page a person
 * reads before typing, and {@link HOW_TO_REGENERATE} inside the generated document, read
 * by whoever finds a stale copy — and the two used to be able to drift because nothing
 * compared them. {@link SAYS_WHAT_IT_DOES} is the one reading: both publishers carry the
 * same clause, so a wording changed in one of them and not the other is red here rather
 * than a divergence nobody sees.
 *
 * AND THE PUBLISHERS COME OFF THE PROGRAM. The pages are walked with `everyCommandOf`,
 * the same walk the parser's refusals and the completion tree use, so a page that copies
 * the recipe tomorrow — a `brief` subcommand, a verb that suggests the redirection in its
 * own help — is caught by carrying the recipe, not by being on a list in this file. That
 * is the N+1 this guard exists for; a list here would be the defect it was written to
 * catch.
 */

import type { Brief } from '@mnema/copilot';
import { describe, expect, it } from 'vitest';
import { buildProgram, type CliIo } from '../src/cli.js';
import { briefDocument } from '../src/presentation/brief.js';
import { everyCommandOf, pathOf } from '../src/wiring/misuse.js';

/** A silent port: nothing here runs a verb, it only reads what they declare. */
const silent: CliIo = { out: () => {}, err: () => {}, fail: () => {} };

/**
 * What makes a text a PUBLICATION of the recipe: it shows the redirection being typed.
 *
 * The destination is deliberately not in the pattern. What the guard is about is the
 * `>`, and a recipe that redirected somewhere else entirely would carry exactly the same
 * hazard — so matching a file name here would let the next publication out by renaming
 * its example.
 */
const PUBLISHES_THE_RECIPE = /mnema brief >/;

/**
 * The clause that has to be beside it. It is a fragment rather than the whole sentence
 * so the two publishers can word the rest for their own reader, and it carries BOTH
 * facts: that the file is replaced, and that it is replaced whole — "replaces the file"
 * alone reads, to somebody with a file they care about, as an update of it.
 */
const SAYS_WHAT_IT_DOES = /replaces the whole of the file it names/i;

/** A record with nothing in it — the document prints its recipe in every state. */
const EMPTY_BRIEF: Brief = {
  decisions: [],
  skills: [],
  collisions: [],
  addressed: 0,
  asking: 0,
  decisionsAwaiting: 0,
  skillsAwaiting: 0,
  editPush: { channel: 'edit-rules-push', on: true },
  asksAPerson: { channel: 'edit-asks-a-person', on: true },
};

/**
 * Every text this product puts in front of a reader, by the name of the surface.
 *
 * THE PAGE IS CAPTURED AND NOT ASKED FOR, and the difference is the whole guard.
 * `helpInformation()` returns the usage, the description and the options — and NOT the
 * block a verb registers with `addHelpText`, which is exactly where every recipe in this
 * program lives. A first version of this file read that method, and its scan came back
 * with the page missing the only lines it was written to rule on. So the text is what
 * `outputHelp` writes, which is what a person at the terminal gets.
 *
 * The output is redirected per COMMAND rather than on the program, because commander
 * copies the configuration into a subcommand when it is created; setting it on the parent
 * afterwards would leave every child writing to the real stdout.
 */
function everyPublishedText(): ReadonlyMap<string, string> {
  const texts = new Map<string, string>();
  for (const command of everyCommandOf(buildProgram(silent).program)) {
    const page = pathOf(command).join(' ');
    let captured = '';
    command.configureOutput({
      writeOut: (chunk: string) => {
        captured += chunk;
      },
      writeErr: (chunk: string) => {
        captured += chunk;
      },
    });
    command.outputHelp();
    texts.set(`mnema ${page} --help`, captured);
  }
  texts.set('the generated document', briefDocument(EMPTY_BRIEF).join('\n'));
  return texts;
}

describe('every place that publishes the recipe says what the redirection does', () => {
  it('finds the publications at all, and there is more than one', () => {
    // Non-vacuity, and it is the failure this guard is likeliest to have: a walk that
    // returned nothing, or a pattern that stopped matching, would leave the case below
    // green over a product that had dropped the sentence entirely.
    const publishers = [...everyPublishedText()]
      .filter(([, text]) => PUBLISHES_THE_RECIPE.test(text))
      .map(([where]) => where);
    expect(publishers).toContain('mnema brief --help');
    expect(publishers).toContain('the generated document');
    expect(publishers.length).toBeGreaterThanOrEqual(2);
  });

  it('names the truncation in each of them', () => {
    for (const [where, text] of everyPublishedText()) {
      if (!PUBLISHES_THE_RECIPE.test(text)) continue;
      const missing = `${where} publishes the recipe and does not say the file is replaced`;
      expect(SAYS_WHAT_IT_DOES.test(text), missing).toBe(true);
    }
  });

  it('has a probe of its own for both patterns', () => {
    // The instrument's own case. A guard whose reading is two regexes is a guard that can
    // go quiet by having one of them stop matching, and this bench has paid for a scanner
    // that reported zero because it was broken rather than because the rule held.
    expect(PUBLISHES_THE_RECIPE.test('  mnema brief > MNEMA.md   the record')).toBe(true);
    expect(PUBLISHES_THE_RECIPE.test('mnema brief | diff - MNEMA.md')).toBe(false);
    expect(SAYS_WHAT_IT_DOES.test('REPLACES the whole of the file it names:')).toBe(true);
    // And what it must NOT accept: the weaker sentence the fix was chosen over.
    expect(SAYS_WHAT_IT_DOES.test('The `>` replaces the file it names.')).toBe(false);
  });

  it('offers a destination that is not already somebody else’s file', () => {
    // The other half of the fix, and it is what the truncation warning is FOR. Saying
    // that `>` replaces a file leaves a reader who has an `AGENTS.md` with nowhere to
    // go; the help answers that in the same place, with a name that collides with no
    // convention, and says what it costs — an agent host reads `AGENTS.md` on its own
    // and does not read this one.
    const help = everyPublishedText().get('mnema brief --help') ?? '';
    expect(help).toContain('mnema brief > MNEMA.md');
    expect(help).toContain('AGENTS.md');
    expect(help).toContain('somebody’s');
    // And the generated document names NO file: it cannot know where it was put, and a
    // name printed there is read as the name that was used.
    const document = everyPublishedText().get('the generated document') ?? '';
    expect(document).toContain('<this file>');
    expect(document).not.toContain('AGENTS.md');
  });
});
