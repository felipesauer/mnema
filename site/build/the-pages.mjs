// What the site says is READ, never typed: from the README, the pages of `docs/`, the root
// `package.json`, `.github/the-front-page/accent.mjs` and the SVGs `draw.mjs` made. This file holds the
// readings, as plain functions over text, so a test can run them over a fixture and over the real tree.
//
// There are three changes to a page of `docs/`, and no fourth:
//   1. its title moves from the first `# ` line to the frontmatter, because the site draws the title itself;
//   2. each relative link is rewritten to where it lands on the site: a page of `docs/` to the site's page
//      for it, anything else to the same file on GitHub, at the commit the site was built from;
//   3. the stretches between a `not-on-the-site` marker pair are taken out (what is true of the next version
//      on GitHub and npm and not of the published one the site describes).

import { posix } from 'node:path';

/** The Markdown outside fenced code: `fn` is called for each such run of lines, the fences pass through. */
function outsideFences(markdown, fn) {
  const lines = markdown.split('\n');
  const out = [];
  let fence = null;
  let run = [];
  const flush = () => {
    if (run.length > 0) out.push(fn(run.join('\n')));
    run = [];
  };
  for (const line of lines) {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence === null && open) {
      flush();
      fence = open[1];
      out.push(line);
    } else if (fence !== null) {
      out.push(line);
      const t = line.trim();
      if (/^(`{3,}|~{3,})$/.test(t) && t[0] === fence[0] && t.length >= fence.length) fence = null;
    } else {
      run.push(line);
    }
  }
  flush();
  return out.join('\n');
}

/** The name of the marker: a line `<!-- not-on-the-site -->` opens a stretch, `<!-- /not-on-the-site -->` closes it. */
export const NOT_ON_THE_SITE = 'not-on-the-site';

/**
 * The source without the stretches it marks as true on GitHub and npm and false on the site (the site describes the
 * published version, the repository's pages the next one). A marker is a whole line of its own, and each stretch
 * goes with its two marker lines and nothing else. A marker that is not alone on its line, a stretch that is
 * not closed, a close with no open and a stretch inside a stretch stop the build.
 */
export function withoutWhatIsNotOnTheSite(markdown, from) {
  const marker = new RegExp(`^\\s*<!--\\s*(/?)${NOT_ON_THE_SITE}\\s*-->\\s*$`);
  const mention = new RegExp(`<!--\\s*/?${NOT_ON_THE_SITE}`);
  const kept = [];
  let open = null;
  markdown.split('\n').forEach((line, i) => {
    const m = marker.exec(line);
    if (m === null) {
      if (mention.test(line)) throw new Error(`${from}:${i + 1}: a ${NOT_ON_THE_SITE} marker must be alone on its line`);
      if (open === null) kept.push(line);
    } else if (m[1] === '') {
      if (open !== null) throw new Error(`${from}:${i + 1}: ${NOT_ON_THE_SITE} opens inside the one opened at line ${open}`);
      open = i + 1;
    } else {
      if (open === null) throw new Error(`${from}:${i + 1}: ${NOT_ON_THE_SITE} closes what was not opened`);
      open = null;
    }
  });
  if (open !== null) throw new Error(`${from}:${open}: ${NOT_ON_THE_SITE} is never closed`);
  return kept.join('\n');
}

/** What the root `package.json` and the package of the binary say, which the site is built around. */
export function factsOf({ rootPackage, codePackage, sha }) {
  const repo = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(rootPackage.repository?.url ?? rootPackage.homepage ?? '');
  if (!repo) throw new Error('package.json names no GitHub repository');
  const [, owner, name] = repo;
  return {
    version: codePackage.version,
    description: codePackage.description,
    owner,
    name,
    sha,
    repoUrl: `https://github.com/${owner}/${name}`,
    siteUrl: `https://${owner}.github.io`,
    base: `/${name}`,
  };
}

/** The first `# ` heading of a page, outside code. */
export function titleOf(markdown) {
  let title = null;
  outsideFences(markdown, (text) => {
    if (title === null) {
      const m = /^# (.+)$/m.exec(text);
      if (m) title = m[1].trim();
    }
    return text;
  });
  if (title === null) throw new Error('a page of docs/ has no title');
  return title;
}

/** Where a relative target lands: a site page, a site asset, or the file on GitHub. */
export function whereItLands(target, from, facts, docs) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return target;
  const hash = target.indexOf('#');
  const path = hash === -1 ? target : target.slice(0, hash);
  const fragment = hash === -1 ? '' : target.slice(hash);
  const resolved = posix.normalize(posix.join(posix.dirname(from), path));
  if (resolved.startsWith('..')) throw new Error(`${from}: ${target} leaves the repository`);
  const page = /^docs\/([^/]+)\.md$/.exec(resolved);
  if (page && docs.has(page[1])) return `${facts.base}/docs/${page[1]}/${fragment}`;
  const asset = /^docs\/assets\/([^/]+)$/.exec(resolved);
  if (asset) return `${facts.base}/assets/${asset[1]}${fragment}`;
  const kept = target.endsWith('/') && !resolved.endsWith('/') ? `${resolved}/` : resolved;
  return `${facts.repoUrl}/blob/${facts.sha}/${kept}${fragment}`;
}

/** Every `](target)` outside code, rewritten. Inline code is left as it is. */
export function rewriteLinks(markdown, from, facts, docs) {
  return outsideFences(markdown, (text) =>
    text
      .split(/(`+[^`\n]*?`+)/)
      .map((piece, i) =>
        i % 2 === 1
          ? piece
          : piece.replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_all, target, title) => `](${whereItLands(target, from, facts, docs)}${title})`),
      )
      .join(''),
  );
}

/** A page of `docs/` as the site holds it: the title in the frontmatter, the links rewritten. */
export function pageOf({ name, markdown: source, facts, docs }) {
  const markdown = withoutWhatIsNotOnTheSite(source, `docs/${name}.md`);
  const title = titleOf(markdown);
  let dropped = false;
  const body = outsideFences(markdown, (text) =>
    dropped
      ? text
      : text.replace(/^# .+\n?/m, () => {
          dropped = true;
          return '';
        }),
  ).replace(/^\n+/, '');
  const editUrl = `${facts.repoUrl}/edit/main/docs/${name}.md`;
  const front = `---\ntitle: ${JSON.stringify(title)}\neditUrl: ${JSON.stringify(editUrl)}\n---\n\n`;
  return front + rewriteLinks(body, `docs/${name}.md`, facts, docs);
}

/** The text of a `## ` section of the README, without its heading, up to the next `## `. */
export function sectionOf(readme, heading) {
  const lines = readme.split('\n');
  const start = lines.findIndex((l) => l === `## ${heading}`);
  if (start === -1) throw new Error(`README has no section "${heading}"`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** Plain text of a fragment of HTML: no tags, entities undone, white space as one space. */
export function textOfHtml(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the README's top says: the line under the picture, the paragraph under it, and the picture's words. */
export function pitchOf(readme) {
  const title = /<h3>([\s\S]*?)<\/h3>/.exec(readme);
  const paragraph = /<\/h3>\s*<p>([\s\S]*?)<\/p>/.exec(readme);
  const banner = /<img src="docs\/assets\/banner-light\.svg" alt="([^"]*)"/.exec(readme);
  if (!title || !paragraph || !banner) throw new Error('the top of the README is not in the shape the site reads');
  return { title: textOfHtml(title[1]), body: textOfHtml(paragraph[1]), bannerAlt: textOfHtml(banner[1]) };
}

/** The groups under the README's "Docs": `- **Use.** [Label](target) · ...`, each link in order. */
export function groupsOf(readme) {
  const text = sectionOf(readme, 'Docs');
  const groups = [];
  for (const chunk of text.split(/\n(?=- \*\*)/)) {
    const head = /^- \*\*([^*]+?)\.\*\*/.exec(chunk);
    if (!head) continue;
    const items = [...chunk.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)].map((m) => ({ label: m[1], target: m[2] }));
    groups.push({ label: head[1], items });
  }
  return groups;
}

/** A line of the README's picture markup, as two images that answer the SITE's theme and not the system's. */
export function pictureAsTwoImages(html) {
  return html.replace(
    /<picture>\s*<source media="\(prefers-color-scheme: dark\)" srcset="([^"]+)">\s*<img src="([^"]+)" alt="([^"]*)"([^>]*)>\s*<\/picture>/g,
    (_all, dark, light, alt, rest) =>
      `<img class="only-dark" src="${dark}" alt="${alt}"${rest}><img class="only-light" src="${light}" alt=""${rest} aria-hidden="true">`,
  );
}

/**
 * The landing: `landing.md` is the template (tracked, so the guards that read every Markdown page reach it),
 * and each directive is replaced by what a source says:
 *   {{pitch.title}} {{pitch.body}} {{pitch.bannerAlt}} {{description}} {{version}}
 *   {{section Heading of the README}}  the section, under its own heading, links rewritten
 *   {{link Label of the README's Docs}} the site address of that link
 * In the frontmatter a value goes in as a JSON string, so no value can break the YAML.
 */
export function landingOf({ template, readme: source, facts, docs }) {
  const readme = withoutWhatIsNotOnTheSite(source, 'README.md');
  const pitch = pitchOf(readme);
  const groups = groupsOf(readme);
  const [, front, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(template) ?? [];
  if (front === undefined) throw new Error('the landing template has no frontmatter');
  const simple = {
    'pitch.title': pitch.title,
    'pitch.body': pitch.body,
    'pitch.bannerAlt': pitch.bannerAlt,
    description: facts.description,
    version: facts.version,
    record: `${facts.base}/record/`,
  };
  const label = (name) => {
    for (const g of groups) for (const item of g.items) if (item.label === name) return item;
    throw new Error(`the README's Docs has no link labelled "${name}"`);
  };
  const fill = (text, frontmatter) =>
    text.replace(/\{\{([^}]+)\}\}/g, (_all, raw) => {
      const key = raw.trim();
      let value;
      if (key in simple) value = simple[key];
      else if (key.startsWith('link ')) value = whereItLands(label(key.slice(5)).target, 'README.md', facts, docs);
      else if (key.startsWith('section ')) {
        const heading = key.slice(8);
        value = `## ${heading}\n\n${rewriteLinks(pictureAsTwoImages(sectionOf(readme, heading)), 'README.md', facts, docs)}`;
      } else throw new Error(`the landing template asks for {{${key}}}, which no source gives`);
      return frontmatter ? JSON.stringify(value) : value;
    });
  return `---\n${fill(front, true)}\n---\n${fill(body, false)}`;
}

/** Where /record/ links back to: the root of the site, under its base path. */
export function recordBackLink(facts) {
  return `${facts.base}/`;
}

/** The sidebar: the README's groups, a page of `docs/` as the site's page and anything else on GitHub. */
export function sidebarOf({ readme, facts, docs }) {
  const groups = groupsOf(readme).map((g) => ({
    label: g.label,
    items: g.items.map((item) => {
      const there = whereItLands(item.target, 'README.md', facts, docs);
      const internal = there.startsWith(`${facts.base}/`) ? there.slice(facts.base.length) : null;
      return { label: item.label, link: internal ?? there };
    }),
  }));
  return groups;
}

/** The pages `docs/` holds, by name without `.md`. */
export function docNames(files) {
  return new Set(files.filter((f) => /^docs\/[^/]+\.md$/.test(f)).map((f) => f.slice(5, -3)));
}

/** The colour file: the accent of each theme, from the one constant the front page is painted with. */
export function accentCss(ACCENT) {
  return [
    ':root {',
    `  --sl-color-accent: ${ACCENT.dark};`,
    '  --sl-color-accent-high: var(--sl-color-accent);',
    '  --sl-color-accent-low: color-mix(in srgb, var(--sl-color-accent) 22%, var(--sl-color-black));',
    '}',
    ":root[data-theme='light'] {",
    `  --sl-color-accent: ${ACCENT.light};`,
    '  --sl-color-accent-high: color-mix(in srgb, var(--sl-color-accent) 70%, var(--sl-color-black));',
    '  --sl-color-accent-low: color-mix(in srgb, var(--sl-color-accent) 20%, var(--sl-color-white));',
    '}',
    '',
  ].join('\n');
}

/** `llms.txt`: the convention's shape, from the pitch and the README's groups, each link to the raw page. */
export function llmsTxt({ readme, facts }) {
  const raw = (path) => `https://raw.githubusercontent.com/${facts.owner}/${facts.name}/${facts.sha}/${path}`;
  const lines = ['# mnema', '', `> ${facts.description}`, ''];
  for (const g of groupsOf(readme)) {
    lines.push(`## ${g.label}`, '');
    for (const item of g.items) {
      const resolved = posix.normalize(item.target.split('#')[0]);
      if (!resolved.endsWith('.md')) continue;
      lines.push(`- [${item.label}](${raw(resolved)})`);
    }
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
