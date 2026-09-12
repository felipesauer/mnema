/**
 * THE LINK CANNOT COME BACK — the attribution footer, refused before it reaches the trunk.
 *
 * THE RULE IS OLD AND IT WAS BROKEN ANYWAY. This repository does not credit the tool that wrote
 * a change in the change's own record: no `Co-Authored-By:` naming the assistant, no `Generated
 * with [Claude Code]` under a pull request. That held for 243 pull requests because somebody
 * remembered it each time. On 2026-09-11 a sweep of `main-v1` found ONE co-author trailer and
 * THIRTEEN generated-with lines in the trunk's own commits, and NINETEEN more in the descriptions
 * of merged pull requests, from #361 to #616. Of the four deliveries around the leak, three were
 * read by hand before the merge and the one that was not is the one that carried it.
 *
 * WHAT IT COST TO UNDO: 194 commits rewritten, a force-push onto a protected branch with the
 * protection opened and closed around it, and 19 API calls. Nothing in that list is expensive
 * because the footer is expensive. It is expensive because NOTHING WAS LOOKING, and the rule
 * lived in a person's memory rather than in a machine — which is what this file changes.
 *
 * IT IS TWO SURFACES AND THE SECOND IS THE ONE THAT ESCAPES. The commit message is the half
 * everybody thinks of and the half that is dear to repair. The pull request BODY is not git at
 * all — it is a field of the GitHub API — and it carried 19 of the 33 leaks. A guard over commits
 * alone leaves the larger half open, so both are read here, by ONE rule (`attributionIn`), and a
 * case below fails if either surface stops being handed to it.
 *
 * THE RULE IS OVER THE FOOTER, NEVER OVER THE WORD. `claude` is a legitimate value of this
 * product — `which: 'claude'` appears in fixtures and examples, and `plugin/` documents a host
 * plugin — so a scan for the word accuses the product it is defending. Worse, the trunk holds 13
 * dependabot commits and three of them quote upstream release notes that credit `Claude Opus 4.8`
 * for somebody else's pull request, and six more quote `This PR was generated with [Release
 * Please]`. Both spellings below are anchored so that neither shape is reachable: the co-author
 * rule requires the line to BE a trailer, and the generated-with rule requires the tool's own
 * name inside the brackets or its own URL.
 *
 * AND THERE IS NO ALLOWLIST, WHICH IS THE POINT. `Co-authored-by: dependabot[bot]` is not
 * exempted here; it is simply not reached, because its value names neither the vendor nor the
 * tool. An exemption is a hole with a name on it — anything that learns to write the exempted
 * shape walks through — and this way the 13 legitimate trailers pass for the same reason a
 * human co-author's would. `the-link-cannot-come-back.test.ts` pins that in both directions.
 *
 * IT REFUSES RATHER THAN GUESSES, in the mould of `.github/why-it-went-red/` and
 * `.github/what-the-suite-left-behind/`: 0 nothing to report, 1 something to report, 2 it could
 * not tell. A scan that examined no commit is the dangerous one — an empty range, a shallow
 * checkout, a base that was never fetched all read as "the trunk is clean" — so zero commits is
 * a REFUSAL with a phrase of its own (`THE_CANARY`), never an exit 0.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * ONE FOOTER THIS TRUNK REFUSES, and `holds` is asked one LINE at a time.
 *
 * `what` is prose for the person reading a red build; it is printed beside every finding so the
 * page says which of the two rules fired without anyone opening this file.
 *
 * @typedef {{ name: string, what: string, holds: (line: string) => boolean }} Footer
 */

/**
 * WHERE ONE FOOTER WAS FOUND. `where` names the surface in the words a person would use to go
 * fix it — `commit 2fe28887 (…)`, `the pull request body` — because the two surfaces are
 * repaired by completely different means and a finding that does not say which is half a finding.
 *
 * @typedef {{ footer: string, what: string, where: string, at: number, line: string }} Finding
 */

/**
 * A COMMIT AS THIS SCAN NEEDS IT. `message` is the whole thing, subject and body together, which
 * is what `git show -s --format=%B` gives.
 *
 * @typedef {{ sha: string, subject: string, message: string }} Commit
 */

/**
 * THE PULL REQUEST AS IT WAS WRITTEN. `null` means no pull request was handed over at all, which
 * is a refusal rather than an empty reading — see `judge`.
 *
 * @typedef {{ title: string, body: string }} PullRequest
 */

/**
 * WHAT A SCAN CAN SAY. `ruler-broken` is a THIRD value rather than a clean reading with an empty
 * list, for the reason the whole family of instruments in `.github/` exists: an instrument that
 * cannot say it broke reads exactly like one that found nothing.
 *
 * @typedef {'clean' | 'attribution-found' | 'ruler-broken'} Verdict
 */

/**
 * A SCAN'S READING.
 *
 * @typedef {{
 *   verdict: Verdict,
 *   code: 0 | 1 | 2,
 *   why: string,
 *   examinedCommits: number,
 *   examinedPullRequest: boolean,
 *   found: Finding[],
 * }} Scan
 */

/**
 * THE TWO SPELLINGS MEASURED IN THIS REPOSITORY'S OWN HISTORY, and the list is open on purpose:
 * the rule is "a footer that credits the tool", and each entry below declares which shape of that
 * it recognises. A third spelling is a third entry, and `attributionIn` needs no other change.
 *
 * THE CO-AUTHOR RULE READS A TRAILER, NOT A SENTENCE. `holds` requires the line to START with the
 * trailer key — leading whitespace allowed, because a quoted message is indented and a footer
 * smuggled in under two spaces is still a footer — and then requires the VALUE to name the vendor
 * or the tool. `Co-authored-by: dependabot[bot] <…@users.noreply.github.com>` therefore passes,
 * and so would a human co-author; `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` does
 * not. The three dependabot commits that quote `<strong>Claude Opus 4.8</strong>` out of an
 * upstream release note are not reachable, because that line is not a trailer.
 *
 * THE GENERATED-WITH RULE READS THE TOOL'S NAME OR ITS URL. `Generated with [Release Please]`
 * appears in six dependabot bodies on this trunk and is not this product's footer; the bracketed
 * name is what separates them. The URL is checked too and separately, because the emoji, the
 * spacing and the bracket text are all cosmetic and the link is the thing that must not come back
 * — which is what this delivery is named after.
 *
 * BOTH ARE ANCHORED RATHER THAN SUBSTRING-MATCHED, AND THAT IS THE HALF THAT CAN GO WRONG. A
 * guard that refuses too much is switched off by the first person it blocks, which on this
 * repository would be the next dependency bump. `the-link-cannot-come-back.test.ts` spends as
 * many cases on what must stay GREEN as on what must go red.
 *
 * @type {readonly Footer[]}
 */
export const THE_FOOTERS = [
  {
    name: 'co-authored-by-the-tool',
    what: 'a co-author trailer whose value names the assistant or its vendor',
    holds: (line) =>
      /^[ \t>]*co-authored-by[ \t]*:/i.test(line) && /anthropic|\bclaude\b/i.test(line),
  },
  {
    name: 'generated-with-claude-code',
    what: "the tool's own generated-with footer, by its name or by its link",
    holds: (line) =>
      /generated with[ \t]*\[[^\]]*claude[^\]]*\]/i.test(line) ||
      /claude\.com\/claude-code/i.test(line),
  },
];

/**
 * THE PHRASE A SCAN THAT EXAMINED NOTHING PRINTS, and it is exported so a case can pin it rather
 * than pin a substring of prose that a later edit would silently drift away from.
 *
 * It exists because of trap that this bench has now been bitten by three times: an instrument
 * handed an empty universe reports the property it was asked about as HOLDING. A shallow
 * `actions/checkout`, a base ref that was never fetched, or a range written the wrong way round
 * all produce zero commits, and zero commits carry no footer.
 */
export const THE_CANARY =
  'no commit was examined, so this reading would say the trunk is clean when what is actually true is that the range was empty — check the range and that the base commit was fetched';

/**
 * THE PHRASE A SCAN WITH NO PULL REQUEST PRINTS. The body half is 19 of the 33 leaks this
 * delivery cleaned up, so a run that silently skipped it would be the smaller guard wearing the
 * larger one's name.
 */
export const NO_PULL_REQUEST =
  'no pull request was handed to this scan, so the half of the rule that reads the description examined nothing — run it on a `pull_request` event, or pass --commits-only to say out loud that only the commits were read';

/**
 * EVERY FOOTER IN ONE TEXT — THE SINGLE READING OF THE RULE (A3).
 *
 * Both surfaces come through here and nothing else decides what a footer is. Two readings of one
 * rule is the shape that lets the commit half and the body half drift apart, which is precisely
 * how this repository ended up with a trunk that was clean of one spelling and not the other.
 *
 * @param {string} text
 * @param {string} where
 * @returns {Finding[]}
 */
export function attributionIn(text, where) {
  /** @type {Finding[]} */
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    for (const footer of THE_FOOTERS) {
      if (footer.holds(line)) {
        found.push({
          footer: footer.name,
          what: footer.what,
          where,
          at: index + 1,
          line: line.trim(),
        });
      }
    }
  }
  return found;
}

/**
 * The verdict, given a world: the commits of the change and the pull request as written.
 *
 * BOTH REFUSALS COME FIRST AND NEITHER IS AN EXIT 0. Zero commits is `THE_CANARY`; no pull
 * request at all is `NO_PULL_REQUEST`. A caller that genuinely has only commits to offer says so
 * by handing `pullRequest: 'not-asked'`, and the reading it gets back says the body was not
 * examined — `main` reaches that only through `--commits-only`, and the case that reads `ci.yml`
 * fails if the workflow ever passes it.
 *
 * @param {{
 *   commits: readonly Commit[],
 *   pullRequest: PullRequest | null | 'not-asked',
 * }} world
 * @returns {Scan}
 */
export function judge({ commits, pullRequest }) {
  if (commits.length === 0) {
    return {
      verdict: 'ruler-broken',
      code: 2,
      why: THE_CANARY,
      examinedCommits: 0,
      examinedPullRequest: false,
      found: [],
    };
  }
  if (pullRequest === null) {
    return {
      verdict: 'ruler-broken',
      code: 2,
      why: NO_PULL_REQUEST,
      examinedCommits: commits.length,
      examinedPullRequest: false,
      found: [],
    };
  }
  const found = commits.flatMap((commit) =>
    attributionIn(commit.message, `commit ${commit.sha.slice(0, 8)} (${commit.subject})`),
  );
  if (pullRequest !== 'not-asked') {
    found.push(
      ...attributionIn(pullRequest.title, 'the pull request title'),
      ...attributionIn(pullRequest.body, 'the pull request body'),
    );
  }
  const examinedPullRequest = pullRequest !== 'not-asked';
  return found.length === 0
    ? {
        verdict: 'clean',
        code: 0,
        why: '',
        examinedCommits: commits.length,
        examinedPullRequest,
        found,
      }
    : {
        verdict: 'attribution-found',
        code: 1,
        why: 'this repository does not credit the tool in the record of a change',
        examinedCommits: commits.length,
        examinedPullRequest,
        found,
      };
}

/**
 * The verdict as the page a person reads.
 *
 * A FINDING PRINTS ITS OWN LINE. The leak this guard exists to stop was invisible for seven weeks
 * because nobody was looking; a red that says only "attribution found" would make the reader go
 * looking again. Every row carries the surface, the line number within it, and the text.
 *
 * @param {Scan} result
 * @returns {string}
 */
export function asProse(result) {
  if (result.verdict === 'ruler-broken') return `RULER BROKEN — ${result.why}.`;
  const examined = result.examinedPullRequest
    ? `${result.examinedCommits} commit(s) and the pull request as written`
    : `${result.examinedCommits} commit(s), with the pull request NOT examined`;
  if (result.verdict === 'clean') {
    return `NO ATTRIBUTION FOOTER — none of the ${THE_FOOTERS.length} footers this trunk refuses appears in ${examined}.`;
  }
  return [
    `ATTRIBUTION FOUND — ${result.found.length} line(s) credit the tool, out of ${examined}:`,
    '',
    ...result.found.flatMap((one) => [
      `  ${one.where}, line ${one.at}`,
      `    ${one.line}`,
      `    (${one.what})`,
      '',
    ]),
    'This repository keeps the tool out of the record of a change. Amend the commit, or edit the',
    'description, and push again.',
  ].join('\n');
}

/**
 * THE VALUE AFTER `--name`, or the fallback. Lifted from
 * `.github/what-the-suite-left-behind/sweep.mjs`, whose comment carries the argument for
 * carrying the fallback's type through instead of widening it.
 *
 * @template {string | null} T
 * @param {readonly string[]} argv
 * @param {string} name
 * @param {T} fallback
 * @returns {string | T}
 */
function optionOf(argv, name, fallback) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : (argv[at + 1] ?? fallback);
}

/**
 * THE COMMITS OF A RANGE, one `git show` per commit.
 *
 * NOT ONE `git log` WITH A SEPARATOR, and the reason is that the text being parsed is the text
 * being judged: any byte chosen as a record separator is a byte a commit message can contain, and
 * a message that contains it splits into two records with the footer in the half that is dropped.
 * `git rev-list` gives 40 hex characters per line and cannot be confused by its own input; the
 * per-commit read is then unambiguous. A pull request of five commits costs six spawns.
 *
 * @param {string} range
 * @param {string} [cwd]
 * @returns {Commit[]}
 */
export function commitsIn(range, cwd = process.cwd()) {
  const shas = execFileSync('git', ['rev-list', range], { cwd, encoding: 'utf-8' })
    .split('\n')
    .filter((one) => /^[0-9a-f]{40}$/.test(one));
  return shas.map((sha) => ({
    sha,
    subject: execFileSync('git', ['show', '-s', '--format=%s', sha], {
      cwd,
      encoding: 'utf-8',
    }).trim(),
    message: execFileSync('git', ['show', '-s', '--format=%B', sha], { cwd, encoding: 'utf-8' }),
  }));
}

/**
 * THE PULL REQUEST OUT OF THE EVENT FILE THE RUNNER WROTE, never out of the API.
 *
 * NOTHING IS INTERPOLATED INTO A SHELL, which is the whole reason this reads a file rather than
 * taking `${{ github.event.pull_request.body }}` as an input. A pull request description is text
 * a stranger wrote; on a public repository, putting it on a command line is how a workflow hands
 * a stranger the runner. It also needs no token and makes no network call.
 *
 * `body` is `null` on a pull request opened with an empty description — that is an examined empty
 * body, not a missing one, and the two must not read the same.
 *
 * @param {string | undefined} [eventPath]
 * @returns {PullRequest | null}
 */
export function pullRequestFrom(eventPath = process.env.GITHUB_EVENT_PATH) {
  if (eventPath === undefined || eventPath === '') return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf-8'));
    const pull = event?.pull_request;
    if (pull === undefined || pull === null) return null;
    return { title: String(pull.title ?? ''), body: String(pull.body ?? '') };
  } catch {
    return null;
  }
}

/**
 * THE RANGE, from the flag or from the event.
 *
 * On a `pull_request` event the runner has already written both ends into the payload, so this
 * needs no API call and no guess about what the base branch is called. What it DOES need is for
 * the base commit to be in the local history, which a default `actions/checkout` does not
 * guarantee — the workflow asks for `fetch-depth: 0` and a case reads `ci.yml` and fails if that
 * line goes away. When the base is missing, `git rev-list` exits non-zero and `main` refuses.
 *
 * @param {readonly string[]} argv
 * @param {string | undefined} [eventPath]
 * @returns {string | null}
 */
export function rangeFrom(argv, eventPath = process.env.GITHUB_EVENT_PATH) {
  const given = optionOf(argv, 'range', null);
  if (given !== null) return given;
  if (eventPath === undefined || eventPath === '') return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf-8'));
    const base = event?.pull_request?.base?.sha;
    const head = event?.pull_request?.head?.sha;
    if (typeof base !== 'string' || typeof head !== 'string') return null;
    return `${base}..${head}`;
  } catch {
    return null;
  }
}

/**
 * The whole instrument from the command line.
 *
 * `world` is a seam and only a seam: the real one shells out to git and reads the runner's event
 * file, and a caller that wants to exercise the reporting supplies its own. The cases that
 * exercise the RULE build a real repository in a sandbox of their own and use the real reader,
 * because a seam that is never checked against git is a second definition of what a commit is.
 *
 * @param {readonly string[]} [argv]
 * @param {{
 *   commits?: (range: string) => Commit[],
 *   pullRequest?: () => PullRequest | null,
 * }} [world]
 * @returns {0 | 1 | 2}
 */
export function main(argv = process.argv.slice(2), world = {}) {
  const readCommits = world.commits ?? ((range) => commitsIn(range));
  const readPullRequest = world.pullRequest ?? (() => pullRequestFrom());
  const summaryAt = optionOf(argv, 'summary', null);
  const jsonAt = optionOf(argv, 'json', null);

  const range = rangeFrom(argv);
  if (range === null) {
    return report(
      {
        verdict: 'ruler-broken',
        code: 2,
        why: 'no range was given and the event on this runner names no pull request, so there is nothing to read — pass --range <base>..<head>',
        examinedCommits: 0,
        examinedPullRequest: false,
        found: [],
      },
      summaryAt,
      jsonAt,
    );
  }

  /** @type {Commit[]} */
  let commits;
  try {
    commits = readCommits(range);
  } catch (reason) {
    return report(
      {
        verdict: 'ruler-broken',
        code: 2,
        why: `the commits of ${range} could not be read (${String(reason)}), which on a runner usually means the base commit was never fetched — see \`fetch-depth\``,
        examinedCommits: 0,
        examinedPullRequest: false,
        found: [],
      },
      summaryAt,
      jsonAt,
    );
  }

  const pullRequest = argv.includes('--commits-only') ? 'not-asked' : readPullRequest();
  return report(judge({ commits, pullRequest }), summaryAt, jsonAt);
}

/**
 * Print a reading, write it where it was asked for, and hand back its exit code.
 *
 * @param {Scan} result
 * @param {string | null} summaryAt
 * @param {string | null} jsonAt
 * @returns {0 | 1 | 2}
 */
function report(result, summaryAt, jsonAt) {
  const prose = asProse(result);
  process.stdout.write(`${prose}\n`);
  if (summaryAt !== null) {
    appendFileSync(summaryAt, `## The link cannot come back\n\n\`\`\`\n${prose}\n\`\`\`\n`);
  }
  if (jsonAt !== null) writeFileSync(jsonAt, `${JSON.stringify(result, null, 2)}\n`);
  return result.code;
}

if (process.argv[1]?.endsWith('scan.mjs')) process.exit(main());
