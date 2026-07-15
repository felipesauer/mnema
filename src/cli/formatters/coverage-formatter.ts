import type { CoverageReport } from '../../services/backlog/coverage-service.js';
import { pc } from '../../utils/colors.js';

/**
 * Renders a {@link CoverageReport} as a compact, human-readable block:
 * a percent headline, the per-state breakdown, and the list of open
 * (non-terminal) task keys when any remain.
 *
 * @param label - Heading for the report, e.g. `Epic WEBAPP-EPIC-3`
 * @param report - Computed coverage
 * @returns Multi-line string ready for stdout
 */
export function formatCoverage(label: string, report: CoverageReport): string {
  const lines: string[] = [];
  lines.push(
    `${pc.bold(label)} — ${report.percent}% complete (${report.terminal}/${report.total})`,
  );

  if (report.total === 0) {
    lines.push(`${pc.dim('  no tasks')}`);
    return lines.join('\n');
  }

  const breakdown = Object.entries(report.byState)
    .map(([state, count]) => `${state}: ${count}`)
    .join('  ·  ');
  lines.push(`${pc.dim('  states:')} ${breakdown}`);

  if (report.open.length > 0) {
    lines.push(`${pc.dim('  open:')} ${report.open.join(', ')}`);
  }

  return lines.join('\n');
}
