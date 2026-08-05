/**
 * The exposure report: a header with the count and how much was read, then one
 * line per record — where it is, when it was written, and WHICH CLASS was found.
 *
 * The line carries no value, because the report carries none. It leads with the
 * tree, because that is what decides how far the exposure travelled: a `public`
 * finding is committed and on every machine that cloned the repository, and a
 * `global` one is on this disk. Then the instruction, once, at the bottom: the record
 * is permanent, so rotating is the remedy — nothing here deletes a fact, and
 * pretending otherwise would send someone looking for a command that does not
 * exist. The empty answer says "nothing RECOGNIZABLE", never "nothing": the
 * detector reads formats, and a password in prose has no format.
 *
 * And it says WHERE IT LOOKED, which the count alone does not. A denominator beside an
 * empty list reads as ground covered, and this command covers one project — the one
 * `cwd` resolves to — plus the machine-global tree. Naming that is what keeps "nothing
 * recognizable here" from being read as "nothing anywhere"; the MCP tool, which a
 * client can open on several projects at once, answers with one count per project for
 * the same reason.
 */

import type { Exposure } from '@mnema/copilot';
import { fact } from './detail.js';
import { itemLine } from './items.js';
import type { Render } from './render.js';

/** How many characters of an instant are the date — what a list column shows. */
const DATE_LENGTH = 10;

/** The lines an exposure report prints for a person. */
export function exposureReport(render: Render, report: Exposure): string[] {
  if (report.findings.length === 0) {
    return [
      `Nothing recognizable in ${report.scanned} record(s).`,
      render(
        fact('Read here: this project’s trees and the machine-global tree — no other project.'),
      ),
      render(
        fact('That is not the same as nothing: only known credential formats are recognized.'),
      ),
    ];
  }
  const lines = [
    `${report.findings.length} of ${report.scanned} record(s) hold a credential format:`,
  ];
  for (const finding of report.findings) {
    lines.push(
      render(
        itemLine([
          finding.scope,
          finding.at.slice(0, DATE_LENGTH),
          finding.kind,
          finding.id,
          finding.classes.join(', '),
        ]),
      ),
    );
  }
  lines.push('');
  lines.push(
    render(fact('These records are permanent — nothing deletes a fact. Rotate the credentials.')),
  );
  lines.push(
    render(fact('A public record is committed and on every machine that cloned the repository.')),
  );
  return lines;
}
