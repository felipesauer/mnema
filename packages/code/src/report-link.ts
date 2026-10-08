/**
 * The link a person can follow to put a report in front of the project — and nothing else.
 *
 * It is a STRING. mnema opens no browser and makes no request: the link is printed, and the
 * person who clicks it lands on GitHub's own form, with the report already in its fields,
 * where GitHub's "Submit" is the only consent there is. The destination is fixed here, in the
 * binary: no flag, variable or file names another one.
 *
 * WHAT IS IN IT is the text `renderReport` made (title and body) and the name of the form —
 * the same bytes the person was shown, percent-encoded, so there is no second rendering to
 * drift from the first. The form it opens (`.github/ISSUE_TEMPLATE/internal_error.yml`) has
 * one field the link fills, `report`, and one left to the person.
 *
 * HOW LONG IT MAY BE. GitHub documents a limit and no number: a URL "that exceeds the server
 * limit" answers `414 URI Too Long`. Read-only GETs of the public form with a growing `body`
 * (8 October 2026) were taken as far as the page's front door: up to 7,021 characters it
 * answered (the sign-in redirect), from 7,041 it failed with a 500, and from 8,211 it said 414.
 * The ceiling here is {@link LINK_LIMIT}, under the lowest of those with a margin: a report that
 * would not fit gets no link, and the person is sent to the saved file instead.
 */

/** The repository a report goes to. Fixed in the binary. */
export const ISSUE_REPO = 'felipesauer/mnema';

/** The form of `.github/ISSUE_TEMPLATE/` the link opens. */
export const ISSUE_TEMPLATE = 'internal_error.yml';

/** The id of the form's field the link fills with the report's body. */
export const REPORT_FIELD = 'report';

/** The longest link, in characters, that mnema prints. */
export const LINK_LIMIT = 6000;

const NEW_ISSUE = `https://github.com/${ISSUE_REPO}/issues/new`;

/** The form with nothing filled in — where a report too long for a link is pasted. */
export function emptyForm(): string {
  return `${NEW_ISSUE}?template=${ISSUE_TEMPLATE}`;
}

/** The link that opens the form with `report` in it, or `undefined` when it would not fit. */
export function issueLink(
  report: { readonly title: string; readonly body: string },
  limit: number = LINK_LIMIT,
): string | undefined {
  const link =
    `${emptyForm()}&title=${encodeURIComponent(report.title)}` +
    `&${REPORT_FIELD}=${encodeURIComponent(report.body)}`;
  return link.length <= limit ? link : undefined;
}
