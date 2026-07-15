import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from '@/dashboard/App.js';

/**
 * MNEMA-333 — the dashboard shell (design system + module rail). Rendered via
 * react-dom/server; the App's data fetch does not run under SSR, so it renders
 * the loading state — but the module rail, brand, and header are present
 * regardless, which is exactly the shell contract this slice ships.
 */
describe('dashboard shell', () => {
  const html = renderToStaticMarkup(<App />);

  it('renders the brand and the module-grouped rail', () => {
    expect(html).toContain('mnema');
    // Module group labels (not a flat tab list).
    for (const group of ['Work', 'Flow', 'Integrity', 'Knowledge', 'Agents']) {
      expect(html, `rail must group by module "${group}"`).toContain(group);
    }
  });

  it('lists every module destination in the rail', () => {
    for (const item of [
      'Overview',
      'Needs you',
      'Board',
      'Epics &amp; sprints',
      'Graph',
      'Metrics',
      'Activity',
      'Audit trail',
      'Drift',
      'Decisions',
      'Skills &amp; memory',
      'Runs',
    ]) {
      expect(html, `rail must offer "${item}"`).toContain(item);
    }
  });

  it('ships the header frame (search + theme toggle); all modules are now built', () => {
    // Every module is wired as of slice 6, so no "soon" placeholder remains.
    expect(html).not.toContain('>soon<');
    // The header search + theme toggle are part of the frame.
    expect(html).toContain('Toggle theme');
    expect(html.toLowerCase()).toContain('search');
  });

  it('shows the chain-integrity card frame in the rail', () => {
    // Before data loads it reads "verifying…"; the card frame is always present.
    expect(html).toMatch(/integrity/i);
  });
});
