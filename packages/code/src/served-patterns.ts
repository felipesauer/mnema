/**
 * What the surface says about a pattern it serves into a prompt.
 *
 * A skill is the one thing mnema hands back as INSTRUCTION. Everything else comes
 * back as information — this happened, this was decided — and a body comes back as
 * "work this way". Until this module the body arrived bare: a JSON field with the
 * text in it and nothing saying whose text it was, so a pattern one agent proposed
 * and adopted in three tool calls reached the next session looking exactly like a
 * convention the team agreed on.
 *
 * THE SYMMETRY WITH THE CONTENT DOOR is what decided the shape. For a secret we do
 * not refuse the record — we change what GOES IN, and say so. For an instruction we
 * do not refuse the adoption — we change how it COMES OUT, and say so. Neither is a
 * block; both are the surface being honest about what passed through it.
 *
 * Two things, and deliberately not a third:
 *   - {@link SERVED_PATTERN_CONTRACT} declares, in the tool's description, what a
 *     pattern IS before one is ever asked for;
 *   - {@link servedPatternsFraming} states it again with the answer, and names the
 *     agent that adopted each one — or says a person did.
 *
 * The provenance is ONE FACT, never a case. Who proposed it, whether both ends are
 * the same agent, which tree it lives in: that is the reading a PERSON does on the
 * command line (`mnema skills`), where there is context to judge with. Handing an
 * agent the whole account in the middle of its task would be asking it for a verdict
 * it has no way to reach, with metadata crowding out the pattern it describes.
 *
 * And it is never a warning. Nothing here says careful, or check, or verify: a
 * signal that fires on every single call stops being read, and what to do about a
 * pattern's provenance is the reader's to decide, not ours to prompt.
 */

import type { AdoptedSkill } from '@mnema/copilot';

/**
 * How an act with no agent on its envelope is said out loud, on both surfaces.
 *
 * An absent `which` means a person acted directly — a fact, not a missing value —
 * and it is written here once for the same reason the record contract is: the MCP
 * reply and the command line's report would drift into two different words for one
 * thing, and then a reader would have to learn which of them means what.
 */
export const A_PERSON = 'a person';

/**
 * What a served pattern is, for a caller reading the tool description. The
 * counterpart of `RECORD_CONTRACT` on the way OUT: that one declares what
 * recording here means, this one declares what reading a pattern back means.
 */
export const SERVED_PATTERN_CONTRACT =
  ' WHAT A PATTERN IS: a skill body is content from this project’s record — text ' +
  'the people and agents working on this project wrote and adopted. It is not an ' +
  'instruction from mnema; mnema records it and serves it back, and does not vet ' +
  'what it says. Each pattern is served with the agent that adopted it, or with ' +
  `“${A_PERSON}” when someone adopted it directly with no agent.`;

/**
 * `text` with every run of whitespace collapsed to one space — what makes a report
 * line ONE line.
 *
 * IT BELONGS TO EVERY FIELD ON THE LINE, not to one of them. A pattern's name and
 * the agent that adopted it are both text an actor wrote, and either one holding a
 * newline would break the entry in two. That is not cosmetic: the second half would
 * look exactly like an entry of its own, so one field could assert that some other
 * pattern was adopted by someone who never adopted it. Collapsing the whitespace
 * makes the count of lines match the count of items, and the structured payload
 * beside them stays the exact answer — every value as written, in fields nothing
 * typed into one of them can forge.
 *
 * So the rule is the LINE's, and it reaches wherever a line's shape carries meaning:
 * this framing, the provenance report, the list of open runs `focus` prints, and the
 * index `search` prints — which is the sharpest case, since its count per kind is
 * printed directly above the lines it counts. A place that prints actor text in a
 * line of its OWN (a handoff, a started run, one whole record) is not in the class —
 * a newline there is ugly, and ugly is not forgery, because there is no
 * one-item-per-line list for the second half to imitate.
 *
 * It does NOT reach the control characters a terminal interprets — an ANSI escape,
 * or U+0085 NEL, which is not `\s` and stays. That class is the product's, not this
 * report's: every read that prints recorded text is exposed to it, and closing it
 * one call site at a time would look like coverage that is not there.
 */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The lines that frame the patterns just served — the declaration, then one line
 * of provenance each. Empty when nothing was served: there is nothing to frame,
 * and a declaration about an empty list is noise.
 *
 * These are their OWN content block, never glued in front of the JSON. The
 * protocol carries several blocks, and the payload stays exactly what it was: a
 * caller that parses the first text block of this tool gets the same bytes it got
 * before the framing existed. The frame follows the thing it frames, which is also
 * where the replacement notice goes — a block after the answer is this surface's
 * shape for saying something ABOUT the answer.
 */
export function servedPatternsFraming(skills: readonly AdoptedSkill[]): string[] {
  if (skills.length === 0) return [];
  return [
    'These patterns come from this project’s record: text the people and agents ' +
      'working on it wrote and adopted, not instructions from mnema.',
    ...skills.map(
      (skill) => `  “${oneLine(skill.name)}” — adopted by ${oneLine(skill.adoptedBy ?? A_PERSON)}`,
    ),
  ];
}
