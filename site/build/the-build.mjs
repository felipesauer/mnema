// The steps of the build that touch the disk. The readings themselves are in `the-pages.mjs`.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  cardsOf,
  copyOf,
  docNames,
  factsOf,
  installLineOf,
  llmsTxt,
  pageOf,
  pitchOf,
  recordingOf,
  stepsOf,
  templateOf,
  themeCss,
  verifyCommandOf,
  withoutWhatIsNotOnTheSite,
} from './the-pages.mjs';
import { theVerdictOfTheCommit } from './the-record.mjs';

export const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(SITE, '..');

/** Everything `prepare` writes, and nothing else: all of it is ignored by git. */
export const WRITTEN = Object.freeze([
  'src/content/docs/docs',
  'src/content/docs/index.md',
  'src/content/docs/404.md',
  'src/assets',
  'src/generated',
  'public',
]);

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** The recording the landing shows beside the verdict: one of those the repository already holds. */
export const RECORDING = 'recordings/a-write-refused.gif';

/** The width and the height of a GIF, from its header (bytes 6 to 9, little-endian). */
export function sizeOfGif(bytes) {
  if (bytes.subarray(0, 3).toString('latin1') !== 'GIF') throw new Error(`${RECORDING} is not a GIF`);
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

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

  // The microcopy: each key the build takes is written down, so a key nothing takes is found.
  const microcopy = copyOf(readFileSync(join(site, 'copy.md'), 'utf8'));
  const taken = new Set();
  const copy = (key) => {
    const text = microcopy.get(key);
    if (text === undefined) throw new Error(`site/copy.md has no entry "${key}"`);
    taken.add(key);
    return text;
  };

  // The two pages that are not a page of `docs/`: each is a tracked template, filled the same way.
  for (const [template, page] of [['landing.md', 'index.md'], ['not-found.md', '404.md']]) {
    const text = readFileSync(join(site, template), 'utf8');
    writeFileSync(into(`src/content/docs/${page}`), templateOf({ template: text, readme, facts, docs, copy }));
  }

  // The proof: the verdict of the record committed at this sha, run with the command the Quick start shows, and
  // the recording the README holds, copied as it is.
  const command = verifyCommandOf(readme);
  const output = theVerdictOfTheCommit({ root, sha: facts.sha, command });
  const gif = readFileSync(join(root, RECORDING));
  writeFileSync(into(`public/${RECORDING}`), gif);
  const recording = { ...recordingOf({ readme, path: RECORDING, facts, docs }), ...sizeOfGif(gif), src: `${facts.base}/${RECORDING}` };
  const caption = copy('verdict-caption');
  writeFileSync(
    into('src/generated/proof.json'),
    `${JSON.stringify({ command, output, sha: facts.sha, repoUrl: facts.repoUrl, caption, recording, copyTaken: [...taken].sort() }, null, 2)}\n`,
  );

  // What the hero reads of the README: the line that installs, the three cards and the four steps.
  const top = withoutWhatIsNotOnTheSite(readme, 'README.md');
  writeFileSync(
    into('src/generated/hero.json'),
    `${JSON.stringify({ install: installLineOf(top), cards: cardsOf(top), how: stepsOf(top, 'How it works') }, null, 2)}\n`,
  );

  for (const file of readdirSync(join(root, 'docs/assets'))) {
    cpSync(join(root, 'docs/assets', file), into(`public/assets/${file}`));
  }
  for (const file of ['banner-dark.svg', 'banner-light.svg']) {
    cpSync(join(root, 'docs/assets', file), into(`src/assets/${file}`));
  }

  const { ACCENT } = await import(pathToFileURL(join(root, '.github/the-front-page/accent.mjs')).href);
  const { PAGE, headerWordmark } = await import(pathToFileURL(join(root, '.github/the-front-page/draw.mjs')).href);
  writeFileSync(into('src/generated/theme.css'), themeCss({ ACCENT, PAGE }));
  const { drawIcon } = await import(pathToFileURL(join(root, 'packages/vscode/build/icon.mjs')).href);
  const { THE_BLOCKS } = await import(pathToFileURL(join(root, 'packages/code/dist/presentation/banner.js')).href);
  writeFileSync(into('public/favicon.png'), drawIcon(THE_BLOCKS));
  // The head's wordmark: the banner's letters alone, from the same rows.
  for (const theme of ['dark', 'light']) writeFileSync(into(`src/assets/wordmark-${theme}.svg`), headerWordmark(THE_BLOCKS, theme));
  writeFileSync(into('src/generated/the-build.json'), `${JSON.stringify({ version: facts.version, sha: facts.sha, repoUrl: facts.repoUrl })}\n`);
  return facts;
}

/**
 * The social card, `og.png` at the root of the built site: the front page's `socialCard` of the banner's rows and the
 * README's pitch, rasterized by `sharp` (which `astro` already installs; `site/package.json` names it). Run after
 * `astro build` and from `site/`, where `sharp` is: the main suite runs `prepare` with no `site/node_modules`, so
 * the card is not part of it.
 * @returns {Promise<Buffer>} the PNG written
 */
export async function writeTheCard({ root = ROOT, out = join(SITE, 'dist') } = {}) {
  const { socialCard } = await import(pathToFileURL(join(root, '.github/the-front-page/draw.mjs')).href);
  const { THE_BLOCKS } = await import(pathToFileURL(join(root, 'packages/code/dist/presentation/banner.js')).href);
  const { default: sharp } = await import('sharp');
  const pitch = pitchOf(withoutWhatIsNotOnTheSite(readFileSync(join(root, 'README.md'), 'utf8'), 'README.md'));
  const png = await sharp(Buffer.from(socialCard({ blocks: THE_BLOCKS, pitch }))).png().toBuffer();
  writeFileSync(join(out, 'og.png'), png);
  return png;
}

/** What goes beside the built pages: `llms.txt` and `robots.txt`, from the same sources. */
export function writeTheRest({ root = ROOT, out = join(SITE, 'dist') } = {}) {
  const facts = theFacts(root);
  const readme = read('README.md');
  writeFileSync(join(out, 'llms.txt'), llmsTxt({ readme, facts }));
  writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${facts.siteUrl}${facts.base}/sitemap-index.xml\n`);
}

