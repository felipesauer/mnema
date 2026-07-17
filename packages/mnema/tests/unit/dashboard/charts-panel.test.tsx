import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Charts } from '@/dashboard/Charts.js';
import type { DashboardContract } from '@/dashboard/contract.js';

/**
 * MNEMA-292 — the charts panel. The legacy chart showed only the top-12 of
 * ~29 event kinds with NO "+N more", so 17 categories vanished silently. The
 * fix's contract: a truncated series must ALWAYS show an explicit "+N more"
 * so a truncated view never reads as complete. Rendered via react-dom/server.
 */

function series(over: Partial<DashboardContract['series']> = {}): DashboardContract['series'] {
  return { activityByDay: [], throughputByDay: [], eventsByKind: [], ...over };
}

function kinds(n: number): ReadonlyArray<{ label: string; value: number }> {
  return Array.from({ length: n }, (_, i) => ({ label: `kind_${i}`, value: n - i }));
}

describe('Charts panel', () => {
  it('shows an explicit "+N more" when a series is truncated past 12 rows', () => {
    const html = renderToStaticMarkup(<Charts series={series({ eventsByKind: kinds(29) })} />);
    // 29 kinds → top 12 shown, 17 hidden, stated explicitly.
    expect(html).toContain('+17 more');
    // The highest-value kind is shown; a below-cutoff one is not.
    expect(html).toContain('data-bar="kind_0"');
    expect(html).not.toContain('data-bar="kind_28"');
  });

  it('shows no "+N more" when the series fits', () => {
    const html = renderToStaticMarkup(<Charts series={series({ eventsByKind: kinds(5) })} />);
    expect(html).not.toContain('more');
    expect(html).toContain('data-bar="kind_0"');
    expect(html).toContain('data-bar="kind_4"');
  });

  it('renders an empty state per series with no data', () => {
    const html = renderToStaticMarkup(<Charts series={series()} />);
    expect(html).toContain('No data in this window');
  });

  it('orders bars by value (highest first)', () => {
    const html = renderToStaticMarkup(
      <Charts
        series={series({
          activityByDay: [
            { label: 'lo', value: 1 },
            { label: 'hi', value: 99 },
          ],
        })}
      />,
    );
    // 'hi' bar markup appears before 'lo'.
    expect(html.indexOf('data-bar="hi"')).toBeLessThan(html.indexOf('data-bar="lo"'));
  });
});
