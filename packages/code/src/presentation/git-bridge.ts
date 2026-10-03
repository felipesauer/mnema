/**
 * The pages of the git bridge: `commits`, `why` and `aging`.
 *
 * EVERY VALUE ON A PAGE CAME OUT OF THE RECORD OR OUT OF GIT, and a commit message is the most
 * writable text there is: so each is collapsed to one line before it is a part of one. The words
 * between them are this surface's own.
 *
 * NOTHING HERE CONCLUDES. A commit is listed because a trailer in its message names a decision or
 * because it touched a path the decision addresses, and the page says which of the two; a
 * decision is listed by `aging` because commits landed on its paths, and the page says that and
 * stops — it does not say the decision is wrong, stale or due for a review.
 *
 * WHEN THERE IS NO GIT, THE PAGE SAYS SO AND THE VERB EXITS CLEAN. Absence of git is a fact about
 * the place, not a failure of the question.
 */

import type { AgingDone } from '../commands/aging.js';
import type { CommitPage, CommitsDone } from '../commands/commits.js';
import type { WhyCitation, WhyCommit, WhyCommitDone, WhyFile, WhyRule } from '../commands/why.js';
import { oneLine } from '../one-line.js';
import { aside, fact, subjectLine } from './detail.js';
import { asId, asWhen, itemLine } from './items.js';
import type { Render } from './render.js';

/** The sentence for a place with no git work tree. */
export const NO_GIT = 'There is no git work tree here, so no commits were read.';

/** The sentence for a clone that holds only part of the history: the counts are of that part. */
export const SHALLOW = 'This is a shallow clone: only the commits it holds were counted.';

/** What every page ends with: the reading is the git's as of now, and nothing was recorded. */
const READ_NOW = 'Read from git just now; nothing was written to the record.';

/** The one quote a shell reads literally. */
const QUOTE = "'";

/** A value, already one line, as a shell would take it whole — for a recipe a person pastes. */
function shellWord(one: string): string {
  if (/^[\w@%+=:,./-]+$/.test(one)) return one;
  return QUOTE + one.split(QUOTE).join(QUOTE + '\\' + QUOTE + QUOTE) + QUOTE;
}

/** A short hash — enough to find the commit, the full one is in `--json`. */
function short(sha: string): string {
  return sha.slice(0, 10);
}

/** One commit as a row. */
function commitRow(render: Render, commit: { sha: string; at: string; subject: string }): string {
  return render(itemLine([asId(short(commit.sha)), asWhen(commit.at), oneLine(commit.subject)]));
}

/** A group of commits under a heading, or nothing when empty. */
function commitGroup(render: Render, heading: string, page: CommitPage): string[] {
  if (page.commits.length === 0) return [];
  return [
    '',
    `${heading} (${page.commits.length}${page.more ? ' shown, newest first, more not shown' : ''})`,
    ...page.commits.map((commit) => commitRow(render, commit)),
  ];
}

/** The page for `mnema commits`. */
export function commitsReport(render: Render, done: CommitsDone): string[] {
  const { decision } = done;
  const lines = [
    render(subjectLine(oneLine(decision.adr), oneLine(decision.title), oneLine(decision.state))),
  ];
  if (!done.git) {
    lines.push(render(fact(NO_GIT)));
    return lines;
  }
  lines.push(
    render(
      fact(
        `${done.cited.commits.length}${done.cited.more ? '+' : ''} cite it by trailer · ` +
          `${done.touching.commits.length}${done.touching.more ? '+' : ''} touched a path it addresses`,
      ),
    ),
  );
  if (done.addresses.length === 0) {
    lines.push(
      render(fact('It addresses no path in force, so only the trailers were read for commits.')),
    );
  }
  if (done.shallow) lines.push(render(fact(SHALLOW)));
  lines.push(...commitGroup(render, 'citing it', done.cited));
  lines.push(...commitGroup(render, 'touching what it addresses', done.touching));
  lines.push('', render(aside(READ_NOW)));
  return lines;
}

/** What a trailer value named, as a phrase. */
function citation(cite: WhyCitation): string {
  if (cite.decision !== undefined) {
    return `${oneLine(cite.decision.adr)} ${oneLine(cite.decision.title)} (${oneLine(cite.decision.state)}, ${oneLine(cite.decision.id)})`;
  }
  if (cite.ambiguous !== undefined) {
    return `${oneLine(cite.value)} (a label ${cite.ambiguous.length} decisions here carry: ${cite.ambiguous.map((id) => oneLine(id)).join(', ')})`;
  }
  return `${oneLine(cite.value)} (no decision here by that name)`;
}

/** The rows of the rules that address something. */
function ruleRows(render: Render, rules: readonly WhyRule[]): string[] {
  return rules.map((rule) =>
    render(
      itemLine([
        oneLine(rule.address === '' ? '.' : rule.address),
        oneLine(rule.name),
        asId(oneLine(rule.id)),
        ...(rule.files !== undefined
          ? [`${rule.files} changed file${rule.files === 1 ? '' : 's'}`]
          : []),
      ]),
    ),
  );
}

/** A commit with the decisions its trailers cite, as rows. */
function citedRows(render: Render, commit: WhyCommit): string[] {
  return [
    commitRow(render, commit),
    ...commit.cites.map((cite) => render(fact(`cites ${citation(cite)}`, 2))),
  ];
}

/** The page for `mnema why`. */
export function whyReport(render: Render, done: WhyFile | WhyCommitDone): string[] {
  if (done.about === 'commit') {
    const lines = [render(subjectLine(short(done.commit.sha), oneLine(done.commit.subject)))];
    lines.push(
      render(
        fact(
          done.commit.cites.length === 0
            ? 'It carries no Mnema-Decision trailer.'
            : `It carries ${done.commit.cites.length} Mnema-Decision trailer${done.commit.cites.length === 1 ? '' : 's'}.`,
        ),
      ),
    );
    for (const cite of done.commit.cites) lines.push(render(fact(`cites ${citation(cite)}`, 2)));
    lines.push(
      render(
        fact(
          `rules in force that address what it changed: ${done.rules.length} ` +
            `(${done.files}${done.moreFiles ? '+' : ''} file${done.files === 1 ? '' : 's'} read)`,
        ),
      ),
    );
    if (done.shallow) lines.push(render(fact(SHALLOW)));
    if (done.rules.length > 0) lines.push('', ...ruleRows(render, done.rules));
    lines.push('', render(aside(READ_NOW)));
    return lines;
  }
  const lines = [
    render(
      subjectLine(
        oneLine(done.relative ?? 'outside this project'),
        done.exists ? 'in the working tree' : 'not in the working tree',
      ),
    ),
    render(
      fact(
        `rules in force that address this path: ${done.rules.length}` +
          (done.git
            ? ` · commits touching it with a trailer: ${done.commits.length}${done.more ? '+' : ''}`
            : ''),
      ),
    ),
  ];
  if (!done.git) lines.push(render(fact(NO_GIT)));
  if (done.shallow) lines.push(render(fact(SHALLOW)));
  if (done.rules.length > 0) lines.push('', ...ruleRows(render, done.rules));
  if (done.commits.length > 0) {
    lines.push(
      '',
      `commits touching it that cite a decision${done.more ? ' (newest first, more not shown)' : ''}`,
    );
    for (const commit of done.commits) lines.push(...citedRows(render, commit));
  }
  lines.push('', render(aside(READ_NOW)));
  return lines;
}

/** The page for `mnema aging`. */
export function agingReport(render: Render, done: AgingDone): string[] {
  if (!done.git) return [render(fact(NO_GIT, 0))];
  const lines = [
    render(
      subjectLine(
        `${done.aged.length} of ${done.looked} accepted decision${done.looked === 1 ? '' : 's'} with an address`,
        `listed at ${done.minCommits} or more commits on their paths since they were accepted`,
      ),
    ),
  ];
  if (done.shallow) lines.push(render(fact(SHALLOW)));
  if (done.aged.length > 0) lines.push('');
  for (const aged of done.aged) {
    lines.push(
      render(
        itemLine([
          oneLine(aged.adr),
          oneLine(aged.title),
          asId(oneLine(aged.id)),
          `accepted ${oneLine(aged.acceptedAt)}`,
          `${aged.touching} of ${aged.all} commits since touched ${aged.addresses.map((a) => oneLine(a === '' ? '.' : a)).join(', ')}`,
        ]),
      ),
    );
  }
  lines.push(
    '',
    render(
      aside(
        'This counts commits and says nothing about the decisions: code that moves under a decision is ' +
          'also code that follows it. Read from git just now; nothing was written to the record.',
      ),
    ),
  );
  for (const aged of done.aged) {
    lines.push(
      render(
        aside(
          `To redo ${oneLine(aged.adr)}: git rev-list --count --since=${shellWord(oneLine(aged.acceptedAt))} HEAD -- ${aged.addresses.map((a) => shellWord(oneLine(a === '' ? '.' : a))).join(' ')}`,
        ),
      ),
    );
  }
  return lines;
}
