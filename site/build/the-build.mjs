// The steps of the build that touch the disk. The readings themselves are in `the-pages.mjs`.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accentCss, docNames, factsOf, landingOf, llmsTxt, pageOf } from './the-pages.mjs';

export const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(SITE, '..');

/** Everything `prepare` writes, and nothing else: all of it is ignored by git. */
export const WRITTEN = Object.freeze([
  'src/content/docs/docs',
  'src/content/docs/index.md',
  'src/assets',
  'src/generated',
  'public',
]);

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** What the site is built from, read now: the commit and the packages say it, nothing is typed here. */
export function theFacts(root = ROOT) {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
  return factsOf({ rootPackage: json('package.json'), codePackage: json('packages/code/package.json'), sha });
}

/** Writes the pages, the pictures, the colour and the build's facts under `site/`. */
export async function prepare({ root = ROOT, site = SITE } = {}) {
  const facts = theFacts(root);
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const names = readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md'));
  const docs = docNames(names.map((f) => `docs/${f}`));

  for (const path of WRITTEN) rmSync(join(site, path), { recursive: true, force: true });
  const into = (path) => {
    mkdirSync(dirname(join(site, path)), { recursive: true });
    return join(site, path);
  };

  for (const file of names) {
    const name = file.slice(0, -3);
    const markdown = readFileSync(join(root, 'docs', file), 'utf8');
    writeFileSync(into(`src/content/docs/docs/${file}`), pageOf({ name, markdown, facts, docs }));
  }

  const template = readFileSync(join(site, 'landing.md'), 'utf8');
  writeFileSync(into('src/content/docs/index.md'), landingOf({ template, readme, facts, docs }));

  for (const file of readdirSync(join(root, 'docs/assets'))) {
    cpSync(join(root, 'docs/assets', file), into(`public/assets/${file}`));
  }
  for (const file of ['banner-dark.svg', 'banner-light.svg']) {
    cpSync(join(root, 'docs/assets', file), into(`src/assets/${file}`));
  }

  const { ACCENT } = await import(pathToFileURL(join(root, '.github/the-front-page/accent.mjs')).href);
  writeFileSync(into('src/generated/accent.css'), accentCss(ACCENT));
  const { drawIcon } = await import(pathToFileURL(join(root, 'packages/vscode/build/icon.mjs')).href);
  const { THE_BLOCKS } = await import(pathToFileURL(join(root, 'packages/code/dist/presentation/banner.js')).href);
  writeFileSync(into('public/favicon.png'), drawIcon(THE_BLOCKS));
  writeFileSync(into('src/generated/the-build.json'), `${JSON.stringify({ version: facts.version, sha: facts.sha, repoUrl: facts.repoUrl })}\n`);
  return facts;
}

/** What goes beside the built pages: `llms.txt` and `robots.txt`, from the same sources. */
export function writeTheRest({ root = ROOT, out = join(SITE, 'dist') } = {}) {
  const facts = theFacts(root);
  const readme = read('README.md');
  writeFileSync(join(out, 'llms.txt'), llmsTxt({ readme, facts }));
  writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${facts.siteUrl}${facts.base}/sitemap-index.xml\n`);
}

