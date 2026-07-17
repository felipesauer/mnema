import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Search } from '@/dashboard/Search.js';

/**
 * MNEMA-339 — the global search overlay. Its results are fetched client-side,
 * so under react-dom/server we assert the initial frame: the dialog, the input,
 * and the "type more" hint. (The /api/search route + query behaviour are
 * covered by the dashboard-server integration test.)
 */
describe('Search overlay', () => {
  it('renders the search dialog with an input and the initial hint', () => {
    const html = renderToStaticMarkup(
      <Search
        onClose={() => {
          /* noop */
        }}
        onOpenKey={() => {
          /* noop */
        }}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('search-input');
    expect(html).toContain('Type at least 2 characters');
  });
});
