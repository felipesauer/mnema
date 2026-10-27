/**
 * What the site tests read: the tree git tracks, the pages of `docs/`, and the HTML the build wrote.
 * Plain readings over text, with no HTML parser: the pages are the output of one generator, and what is
 * read from them (a link, an id, a block of prose) has one shape in it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './published-examples.js';

export { ROOT };
export const SITE = join(ROOT, 'site');
export const DIST = join(SITE, 'dist');

/** The Markdown the site and the README are made of, read from git's own list. */
export function tracked(...patterns: string[]): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', ...patterns], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();
}

export const head = (): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

/** Every `.html` under a directory, as a path relative to it. */
export function htmlFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(path, base));
    else if (entry.name.endsWith('.html')) out.push(path.slice(base.length + 1));
  }
  return out.sort();
}

/**
 * What is left of a text when only its letters and numbers remain, so a rendering cannot differ from its
 * source. The address of a Markdown link is dropped first: the page shows the words of a link and not where it goes.
 */
export const norm = (text: string): string =>
  text
    .replace(/\]\([^)\s]*(?:\s+"[^"]*")?\)/g, ']')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** The text of a piece of HTML: no tags, the entities undone. */
export function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/g, (m, n: string) => ENTITIES[n] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The prose blocks of the page's content: each paragraph, list item, heading and table cell, outside code. */
export function proseBlocks(html: string): string[] {
  const content = /<div class="sl-markdown-content">([\s\S]*?)<footer/.exec(html)?.[1] ?? '';
  const cleaned = content
    .replace(/<p class="the-build">[\s\S]*?<\/p>/g, '')
    .replace(/<a class="sl-anchor-link"[\s\S]*?<\/a>/g, '')
    .replace(/<div class="expressive-code">[\s\S]*?<\/figure><\/div>/g, '')
    .replace(/<pre[\s\S]*?<\/pre>/g, '');
  return [...cleaned.matchAll(/<(p|li|h[1-6]|td|th|dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => textOf(m[2] ?? ''))
    .filter((t) => t !== '');
}

/** Every address a page points at: links, images, stylesheets and scripts. */
export function addressesOf(html: string): string[] {
  return [...html.matchAll(/<(?:a|img|link|script)\b[^>]*?\s(?:href|src)="([^"]*)"/g)].map((m) =>
    (m[1] ?? '').replace(/&amp;/g, '&'),
  );
}

/** The ids a page carries, which is what `#fragment` can name. */
export function idsOf(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? ''));
}

export const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile();
export const isDirectory = (path: string): boolean =>
  existsSync(path) && statSync(path).isDirectory();
export const readText = (path: string): string => readFileSync(path, 'utf8');
