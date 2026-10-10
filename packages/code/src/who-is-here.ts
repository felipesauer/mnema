/**
 * What the edge of an edit says about the OTHER runs of this machine that were charged at the
 * same path: one sentence, derived from the record's runs and charges and written nowhere.
 *
 * WHAT IT CARRIES, AND WHY NO MORE. The agent's name as the run declared it (`codex`,
 * `claude-code`), and how many minutes ago. Not the run's id, not its goal, not the rule that
 * charged it, not a count of what it wrote. The name is what `mnema resume` and the opening
 * document already hand every agent of this machine about the open runs of the same identity,
 * so the sentence discloses nothing a session could not read by asking; the id opens a run's
 * whole history and the goal is prose another agent wrote, which a sentence pushed at somebody's
 * edit would carry into a conversation. Nor does it name a person: the reading is over the runs
 * of this machine's own identity (`runsHere`, `@mnema/context`), so a teammate's run, which a
 * committed record also holds, is not in it.
 *
 * WHAT IT SAYS IS WHAT THE RECORD HOLDS. A run is "charged at a path" when a rule asked for a
 * person there or refused a write there, in that run (`channel.asked`, `channel.refused`): the
 * only facts that carry a path and a run. The sentence says "consulted" because the rule was
 * consulted at that path; it does not say the run wrote the file, and it does not say the run is
 * still working. A path no rule ever charged anyone at leaves no fact, and the edge of its edit
 * says nothing — see `@mnema/context`'s `runsHere`.
 *
 * IT STATES AND DOES NOT INSTRUCT, like every sentence this product pushes at a model
 * (`record-framing.ts`, `tellsWhatToDo`): somebody else's work is not this product's to
 * direct.
 *
 * IT NEVER TAKES A RULE'S ROOM. The sentence rides after the text the call already had to say
 * and only when the whole stays inside the hook's ceiling ({@link withWhoIsHere}); at the
 * ceiling it is the sentence that is left out, never a rule and never what a write founded.
 * Its own length is bounded whatever the record holds: at most three names, each cut at
 * {@link NAME_CUT} characters.
 */

import type { RunHere } from '@mnema/context';
import { oneLine } from './one-line.js';
import { CLAUDE_CODE_CEILING, type HookCeiling } from './presentation/within-a-hook.js';
import {
  ASKS_A_PERSON_CHANNEL,
  FIRST_WRITE_GATE_CHANNEL,
  REFUSES_A_WRITE_CHANNEL,
} from './record-framing.js';

/** The channels whose charges say a run was at a path: asking, refusing, and the first-write hold. */
export const CHARGING_CHANNELS: readonly string[] = [
  ASKS_A_PERSON_CHANNEL,
  REFUSES_A_WRITE_CHANNEL,
  FIRST_WRITE_GATE_CHANNEL,
];

/** How many agent names the sentence prints; the rest are counted. */
const NAMES_SHOWN = 3;

/** How many characters of an agent's name the sentence prints. */
export const NAME_CUT = 40;

/** What separates the text a call has to say from the sentence beside it. */
const BESIDE = '\n\n';

/**
 * A name as a line prints it: only letters, digits, dot, underscore and hyphen, every other
 * character a `?`, cut at {@link NAME_CUT} whole characters. An agent name is a client's own
 * string, and a client's names are identifiers (`claude-code`, `vscode-copilot`); anything else
 * in one is not something to hand to another model as prose. The cut and the alphabet are not a
 * defence against every wording an identifier can spell, only against a sentence: no space
 * survives, so a name cannot read as one.
 */
function printed(agent: string): string {
  const safe = Array.from(oneLine(agent), (character) =>
    /^[A-Za-z0-9._-]$/.test(character) ? character : '?',
  );
  return safe.length <= NAME_CUT ? safe.join('') : `${safe.slice(0, NAME_CUT).join('')}…`;
}

/** Whole minutes as a person counts them, never "0 min ago". */
function minutesAgo(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes < 1 ? 'less than a minute ago' : `${minutes} min ago`;
}

/**
 * The sentence for `here`, or `undefined` when no other run was charged at the path.
 *
 * One run: `Another run (codex) consulted this path 12 min ago.` More than one: how many, the
 * names of the most recent three, and the age of the latest.
 */
export function hereSentence(here: readonly RunHere[]): string | undefined {
  const [latest] = here;
  if (latest === undefined) return undefined;
  if (here.length === 1) {
    return `Another run (${printed(latest.agent)}) consulted this path ${minutesAgo(latest.secondsAgo)}.`;
  }
  const names = [...new Set(here.map((run) => printed(run.agent)))];
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  const more = names.length > NAMES_SHOWN ? `, and ${names.length - NAMES_SHOWN} more` : '';
  return `${here.length} other runs (${shown}${more}) consulted this path, the latest ${minutesAgo(latest.secondsAgo)}.`;
}

/**
 * `text` with the sentence for `here` after it, or `text` itself when there is none or when the
 * two together would cross the host's ceiling, measured in the host's own unit (`ceiling`:
 * UTF-16 units for Claude Code, UTF-8 bytes for Codex): the sentence gives way, the text does
 * not.
 */
export function withWhoIsHere(
  text: string,
  here: readonly RunHere[],
  ceiling: HookCeiling = CLAUDE_CODE_CEILING,
): string {
  const sentence = hereSentence(here);
  if (sentence === undefined) return text;
  const whole = `${text}${BESIDE}${sentence}`;
  return ceiling.lengthOf(whole) <= ceiling.most ? whole : text;
}
