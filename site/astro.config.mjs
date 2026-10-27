import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, theFacts } from './build/the-build.mjs';
import { docNames, sidebarOf } from './build/the-pages.mjs';

const facts = theFacts();
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
const docs = docNames(readdirSync(join(ROOT, 'docs')).map((f) => `docs/${f}`));
const sidebar = sidebarOf({ readme, facts, docs });

export default defineConfig({
  site: facts.siteUrl,
  base: facts.base,
  integrations: [
    starlight({
      title: 'mnema',
      favicon: '/favicon.png',
      logo: { dark: './src/assets/wordmark-dark.svg', light: './src/assets/wordmark-light.svg', alt: facts.name, replacesTitle: true },
      social: [{ icon: 'github', label: 'GitHub', href: facts.repoUrl }],
      sidebar: [...sidebar, { label: 'Record', link: '/record/' }],
      customCss: ['./src/generated/theme.css', './src/styles/site.css'],
      components: { Footer: './src/components/Footer.astro', Hero: './src/components/Hero.astro' },
      head: [{ tag: 'meta', attrs: { name: 'description', content: facts.description } }],
      lastUpdated: false,
      pagination: true,
    }),
  ],
});
