/**
 * The one comment the Action keeps on a pull request, as text.
 *
 * Pure: a report in, markdown out. The marker on its first line is how a later run finds the
 * comment it wrote and replaces it rather than adding a second.
 */

import type { GovernedFile, RuleHit } from './governed.js';
import type { DecisionMoved, WhatItDoes } from './record.js';

/** The first line of the comment, and the only thing a later run looks for. */
export const MARKER = '<!-- mnema-record-report -->';

/** What one run found, ready to be written down. */
export interface Report {
  /** What `verify --require=signed --since <base>` said, and whether it passed. */
  readonly verification: { readonly passed: boolean; readonly said: string };
  readonly record: WhatItDoes;
  readonly governed: readonly GovernedFile[];
  /** How many changed files were not asked about, when the pull request is larger than the cap. */
  readonly notAsked: number;
  /** Present only when the approval check was switched on. */
  readonly approval:
    | { readonly asking: readonly GovernedFile[]; readonly approved: boolean }
    | undefined;
  /** What `mnema check run` said and whether it passed; present only when the checks were asked for. */
  readonly checks?: { readonly passed: boolean; readonly said: string };
}

/** The most characters GitHub accepts in one comment. */
const MOST_IN_A_COMMENT = 65536;

const CUT_NOTICE =
  '\n\nThe rest of this comment was cut: GitHub accepts at most 65536 characters.\n';

/** Whether there is anything on the pull request worth a comment of its own. */
export const worthSaying = (report: Report): boolean =>
  !report.verification.passed ||
  report.record.total > 0 ||
  report.governed.length > 0 ||
  report.checks?.passed === false;

/** The longest stretch of `verify`'s own words the comment quotes. */
const MOST_QUOTED = 1500;

/** The longest title or name the comment repeats. */
const MOST_REPEATED = 120;

/**
 * Text that came out of the record or the tree, made safe to print on a pull request: one line,
 * no markup that opens a tag or a comment, no `@` that would notify somebody, no backtick that
 * would end the code span it sits in, no Markdown link, image, emphasis, heading or table-cell
 * character left unescaped, and cut at a length.
 */
export function plain(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  const cut = one.length > MOST_REPEATED ? `${one.slice(0, MOST_REPEATED)}…` : one;
  return cut
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, "'")
    .replace(/@/g, '@\u200b')
    .replace(/[\\[\]()!*_|#]/g, '\\$&');
}

const rule = (hit: RuleHit): string =>
  hit.name === undefined ? `\`${plain(hit.id)}\`` : `${plain(hit.name)} (\`${plain(hit.id)}\`)`;

function decisionLine(decision: DecisionMoved): string {
  const label = plain(decision.adr ?? decision.id);
  const title = decision.title === undefined ? '' : ` — ${plain(decision.title)}`;
  return `- ${label}${title}: ${decision.to.map(plain).join(', ')}`;
}

function governedLines(file: GovernedFile): string[] {
  const by = (verb: string, hits: readonly RuleHit[]): string[] =>
    hits.map((hit) => `- \`${plain(file.path)}\` — ${verb} ${rule(hit)}`);
  return [
    ...by('governed by', file.governs),
    ...by('asks for a person:', file.asks),
    ...by('a write is refused by', file.refuses),
  ];
}

/** One line `check run` prints per rule: `passed <rule>` or `failed <rule>: <why>`. */
const RULE_RESULT = /^\s*(passed|failed) (\S+?)(?:: (.*))?$/;

function checkLines(checks: { passed: boolean; said: string }): string[] {
  const lines = checks.said.split('\n');
  const results = lines.flatMap((line) => {
    const m = RULE_RESULT.exec(line);
    if (m === null) return [];
    const why = m[3] === undefined || m[3].trim() === '' ? '' : ` — ${plain(m[3])}`;
    return [`- ${m[1]} \`${plain(m[2] ?? '')}\`${why}`];
  });
  if (results.length === 0) {
    const first = lines.find((line) => line.trim() !== '') ?? 'it said nothing';
    return [`No check ran: ${plain(first)}`];
  }
  const summary = lines.find((line) => / passed · \d+ failed at /.test(line));
  return [...(summary === undefined ? [] : [plain(summary), '']), ...results];
}

/** The comment body when the repository holds no record at all. */
export const renderNoRecord = (): string =>
  `${MARKER}\n### mnema — this pull request and the record\n\nThis repository holds no mnema record.\n`;

/** The comment body. */
export function renderComment(report: Report): string {
  const out: string[] = [MARKER, '### mnema — this pull request and the record', ''];

  const { passed, said } = report.verification;
  out.push(
    `**Verification** (\`verify --require=signed --since <base>\`): ${passed ? 'passed' : 'failed'}`,
  );
  if (!passed && said.trim() !== '') {
    out.push('', '```', said.trim().slice(0, MOST_QUOTED).replaceAll('```', "'''"), '```');
  }

  out.push('', '**The record**');
  if (report.record.total === 0) {
    out.push('', 'This pull request adds no events to the record.');
  } else {
    out.push('', `${report.record.total} new event${report.record.total === 1 ? '' : 's'}:`, '');
    out.push('| kind | new events |', '| --- | ---: |');
    for (const [kind, count] of report.record.byKind) out.push(`| \`${plain(kind)}\` | ${count} |`);
    if (report.record.decisions.length > 0) {
      out.push('', 'Decisions moved:', '', ...report.record.decisions.map(decisionLine));
    }
  }

  out.push('', '**Changed files a rule in force addresses**', '');
  if (report.governed.length === 0) {
    out.push('None of the files asked about.');
  } else {
    out.push(...report.governed.flatMap(governedLines));
  }
  if (report.notAsked > 0) {
    out.push(
      '',
      `${report.notAsked} changed file${report.notAsked === 1 ? ' was' : 's were'} not asked about.`,
    );
  }

  if (report.approval !== undefined) {
    out.push('', '**Approval for rules that ask for a person**', '');
    if (report.approval.asking.length === 0) {
      out.push('No changed file is addressed by such a rule.');
    } else if (report.approval.approved) {
      out.push('Approved by a reviewer other than the author.');
    } else {
      out.push(
        'No reviewer other than the author has approved, and these files ask for a person:',
        '',
        ...report.approval.asking.map((file) => `- \`${plain(file.path)}\``),
      );
    }
  }
  if (report.checks !== undefined) {
    out.push('', '**Checks the rules carry**', '', ...checkLines(report.checks));
  }
  const body = `${out.join('\n')}\n`;
  if (body.length <= MOST_IN_A_COMMENT) return body;
  const room = MOST_IN_A_COMMENT - CUT_NOTICE.length;
  return `${body.slice(0, body.lastIndexOf('\n', room))}${CUT_NOTICE}`;
}
