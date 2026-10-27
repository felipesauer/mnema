import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SITE, theFacts } from './build/the-build.mjs';
import { copyOf, docNames, pitchOf, sidebarOf, withoutWhatIsNotOnTheSite } from './build/the-pages.mjs';

const facts = theFacts();
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const docs = docNames(readdirSync(join(ROOT, 'docs')).map((f) => `docs/${f}`));
const microcopy = copyOf(readFileSync(join(SITE, 'copy.md'), 'utf8'));
// The record page goes inside the group of the README that holds the verifier, under the label `copy.md` gives it.
const sidebar = sidebarOf({ readme, facts, docs, record: { label: microcopy.get('record'), link: '/record/' } });
// The social card: one picture for every page, at its address on the published site, and the README's line as its alt.
const card = `${facts.siteUrl}${facts.base}/og.png`;
const { title: cardAlt } = pitchOf(withoutWhatIsNotOnTheSite(readme, 'README.md'));

export default defineConfig({
  site: facts.siteUrl,
  base: facts.base,
  integrations: [
    starlight({
      title: 'mnema',
      favicon: '/favicon.png',
      logo: { dark: './src/assets/wordmark-dark.svg', light: './src/assets/wordmark-light.svg', alt: '', replacesTitle: true },
      social: [{ icon: 'github', label: 'GitHub', href: facts.repoUrl }],
      sidebar,
      customCss: ['./src/generated/theme.css', './src/styles/site.css'],
      components: { Footer: './src/components/Footer.astro', Hero: './src/components/Hero.astro' },
      head: [
        { tag: 'meta', attrs: { name: 'description', content: facts.description } },
        { tag: 'meta', attrs: { property: 'og:image', content: card } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { property: 'og:image:alt', content: cardAlt } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: card } },
        { tag: 'meta', attrs: { name: 'twitter:image:alt', content: cardAlt } },
      ],
      lastUpdated: false,
      pagination: true,
    }),
  ],
});
