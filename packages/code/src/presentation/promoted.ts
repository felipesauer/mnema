/**
 * What `mnema promote` says: the candidates, and the copy that was made.
 *
 * Both name the PROJECTS by their directory, because the person who typed the verb named
 * them and needs to know which one an id is in. That is why this is the CLI's alone: the
 * console says only that there are candidates, never where (`promotable.ts`).
 */

import type { PromoteDone, PromoteListed } from '../commands/promote.js';
import { oneLine } from '../one-line.js';
import { aside, fact, subjectLine } from './detail.js';
import type { Line } from './line.js';
import type { Render } from './render.js';

/** The sentence under a list of candidates, and under none. */
function ending(listed: PromoteListed): Line[] {
  if (listed.candidates.length === 0) {
    return [
      fact(
        `Nothing recurs, with the same words and in force, in the committed record of ${listed.projects} project${listed.projects === 1 ? '' : 's'}.`,
        0,
      ),
    ];
  }
  return [
    fact(
      'Promote one from inside a project that holds it: `mnema promote <id> --evidence <path>:<id> …`, citing the other projects. It is copied to this machine’s global tree as a proposal; nothing is moved.',
      0,
    ),
  ];
}

/** The candidates the caller's named projects share, one block each. */
export function promotionCandidates(render: Render, listed: PromoteListed): string[] {
  const lines: Line[] = [];
  for (const missing of listed.withoutRecord) {
    lines.push(fact(`${oneLine(missing)} holds no record; it was left out.`, 0));
  }
  for (const candidate of listed.candidates) {
    lines.push(
      subjectLine(
        `${candidate.kind} "${oneLine(candidate.title)}"`,
        ` — in force in ${new Set(candidate.instances.map((i) => i.project)).size} projects`,
      ),
    );
    for (const instance of candidate.instances) {
      lines.push(fact(`${oneLine(instance.project)}  ${instance.id}`));
    }
  }
  lines.push(...ending(listed));
  return lines.map(render);
}

/** What was written, and how the person adopts it. */
export function promotionDone(render: Render, done: PromoteDone): string[] {
  const adopt =
    done.kind === 'skill'
      ? `\`mnema skill move review ${done.id} --note "<why>"\`, then \`mnema skill move adopt ${done.id} --note "<why>"\``
      : `\`mnema decision move accept ${done.id} --note "<why>"\``;
  const lines: Line[] = [
    subjectLine(`Promoted ${done.kind} "${oneLine(done.title)}" (${done.id})`),
    fact('It is in the global tree, born proposed, and carries no address.'),
    fact(`It cites ${done.derivedFrom.length} instances as derived-from:`),
    ...done.derivedFrom.map((from) => fact(`${oneLine(from.project)}  ${from.id}`, 2)),
    aside(`To put it in force: ${adopt}`),
  ];
  return lines.map(render);
}
