import pc from 'picocolors';

import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import { formatTimestamp, type TimestampMode } from './timestamp-formatter.js';

/**
 * Output format for the audit log views.
 */
export type HistoryFormat = 'human' | 'table' | 'json';

/**
 * Renders an audit event in the chosen format.
 *
 * Used both for static `mnema history` listings and the live tail
 * produced by `mnema watch`. The formatter is stateless — it does not
 * track which events were already shown.
 *
 * @param event - Event to render
 * @param format - Desired output format
 * @param mode - Timestamp display mode (default `relative`)
 * @returns A line ready to be written to stdout
 */
export function formatEvent(
  event: AuditEvent,
  format: HistoryFormat,
  mode: TimestampMode = 'relative',
): string {
  if (format === 'json') {
    return JSON.stringify(event);
  }
  if (format === 'table') {
    return [
      formatTimestamp(event.at, mode),
      event.kind.padEnd(20),
      event.actor.padEnd(16),
      (event.via ?? '').padEnd(20),
      summariseData(event),
    ].join('  ');
  }
  return formatHuman(event, mode);
}

/**
 * Renders an array of events, applying intelligent aggregation so
 * agent runs and their plans appear as compact summary lines instead
 * of dozens of individual mutations.
 *
 * Aggregation rules (only in `human` format):
 * - `run_started` events show goal and number of plans declared later
 * - consecutive task creates inside the same run collapse to a single
 *   `created N tasks` line
 *
 * @param events - Events sorted chronologically (oldest first)
 * @param format - Output format
 * @param mode - Timestamp display mode (default `relative`)
 * @returns Multi-line string suitable for stdout
 */
export function formatHistory(
  events: readonly AuditEvent[],
  format: HistoryFormat,
  mode: TimestampMode = 'relative',
): string {
  if (format !== 'human') {
    return events.map((e) => formatEvent(e, format, mode)).join('\n');
  }
  return aggregateHuman(events, mode);
}

function formatHuman(event: AuditEvent, mode: TimestampMode): string {
  const time = formatTimestamp(event.at, mode);
  const subject = event.via !== undefined ? `${event.actor} via ${event.via}` : event.actor;
  const runHint = event.run !== undefined ? pc.dim(` [${event.run.slice(0, 8)}]`) : '';
  return `${pc.dim(time)}  ${subject}${runHint}  ${describe(event)}`;
}

function describe(event: AuditEvent): string {
  const data = event.data as Record<string, unknown>;
  switch (event.kind) {
    case 'task_created':
      return `created ${stringify(data.key)} ${pc.dim(`"${stringify(data.title)}"`)}`;
    case 'task_transitioned':
      return `${stringify(data.action)} ${stringify(data.key)} ${stringify(data.from)} → ${pc.cyan(stringify(data.to))}`;
    case 'run_started': {
      const goal = stringify(data.goal);
      return `${pc.cyan('run started')} "${goal}"`;
    }
    case 'run_ended': {
      const status = stringify(data.status);
      const colour = status === 'completed' ? pc.green : status === 'failed' ? pc.red : pc.yellow;
      return `${colour(`run ${status}`)}`;
    }
    default:
      return `${event.kind} ${pc.dim(JSON.stringify(data))}`;
  }
}

function stringify(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function summariseData(event: AuditEvent): string {
  const data = event.data as Record<string, unknown>;
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    pairs.push(`${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  }
  return pairs.join(' ');
}

/**
 * Builds the human-format aggregation: groups events by run and
 * collapses repeated kinds into compact summary lines.
 */
function aggregateHuman(events: readonly AuditEvent[], mode: TimestampMode): string {
  const lines: string[] = [];
  let i = 0;
  while (i < events.length) {
    const event = events[i];
    if (event === undefined) break;

    if (event.kind === 'task_created' && event.run !== undefined) {
      const runId = event.run;
      const grouped: AuditEvent[] = [];
      while (i < events.length) {
        const next = events[i];
        if (next === undefined || next.kind !== 'task_created' || next.run !== runId) break;
        grouped.push(next);
        i += 1;
      }
      if (grouped.length > 1) {
        const first = grouped[0];
        if (first === undefined) continue;
        const keys = grouped
          .map((g) => stringify((g.data as Record<string, unknown>).key))
          .join(', ');
        const time = formatTimestamp(first.at, mode);
        const subject = first.via !== undefined ? `${first.actor} via ${first.via}` : first.actor;
        lines.push(
          `${pc.dim(time)}  ${subject}  created ${grouped.length} tasks ${pc.dim(`(${keys})`)}`,
        );
        continue;
      }
      lines.push(formatHuman(grouped[0] as AuditEvent, mode));
      continue;
    }

    lines.push(formatHuman(event, mode));
    i += 1;
  }
  return lines.join('\n');
}
