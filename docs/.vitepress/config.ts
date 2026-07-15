import { defineConfig } from 'vitepress';

/**
 * VitePress site for the mnema docs (MNEMA-ADR-59). Reads the existing docs/
 * markdown natively and gives them a sidebar/home without rewriting them.
 *
 * Hard constraints from the ADR (brand coherence, same discipline as the
 * dashboard): offline-first — no analytics, no external font/CDN request. The
 * `verify-docs-site` CI check asserts the built site references no external
 * host. Hosted under GitHub Pages at felipesauer.github.io/mnema, so `base`
 * is '/mnema/'.
 *
 * Scope: only the 5 published docs + README-extracted reference (later, via
 * MNEMA-301) — never docs-local (frozen/divergent, cites internal phases).
 */
export default defineConfig({
  title: 'mnema',
  description: 'A tamper-evident audit trail for AI-agent work',
  base: '/mnema/',
  lang: 'en-US',
  // Fail the build on a dead internal link rather than shipping one.
  ignoreDeadLinks: false,
  // No analytics, no external head tags — offline-first.
  head: [],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/client-integration' },
      { text: 'Reference', link: '/configuration' },
      { text: 'npm', link: 'https://www.npmjs.com/package/@felipesauer/mnema' },
    ],
    sidebar: [
      {
        text: 'Concepts',
        items: [
          { text: 'Integrity model', link: '/integrity' },
          { text: 'Project layout', link: '/project-layout' },
        ],
      },
      {
        text: 'Using mnema with an agent',
        items: [
          { text: 'Client integration', link: '/client-integration' },
          { text: 'Guard (PreToolUse)', link: '/guard' },
          { text: 'Skills & memory', link: '/skills-and-memory' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI commands', link: '/cli' },
          { text: 'Configuration', link: '/configuration' },
          { text: 'MCP tools', link: '/mcp-tools' },
        ],
      },
    ],
    // No socialLinks: VitePress renders their icons via an api.iconify.design
    // CSS url(), a runtime external fetch that breaks the offline-first rule
    // (ADR-59). The GitHub link lives in the nav instead (a plain anchor).
    search: { provider: 'local' },
  },
});
