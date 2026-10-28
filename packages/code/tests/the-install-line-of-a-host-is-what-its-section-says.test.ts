// @reads-the-tree
/**
 * THE INSTALL LINE OF A HOST IS WHAT ITS SECTION SAYS.
 *
 * `docs/install.md` carries one row for each host, generated from the `install` of the host's row
 * in `src/host-names.ts`, and the row links to the host's section in `docs/hosts.md`. The page
 * with the table and the page with the section are two files, and a command written in one and
 * changed in the other would leave a reader typing what the section never said. So: every command
 * of a row is, letter for letter, a line of a fenced block in the section the row points to, and
 * every command a row names in backticks instead of giving a line is one that section also names.
 * The anchor of each row is a heading of `docs/hosts.md`. The two lines that install the Claude Code plugin
 * are also written as a block on the README, `docs/first-record.md` and `plugin/README.md`: each carries
 * the host table's commands, so the four places cannot part.
 *
 * What this does not hold: that the host runs the command. How each host is known is the rung
 * table of `docs/evidence.md`, and the row says the rung beside the line.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOST_NAMES, HOSTS, type Install } from '../src/host-names.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const HOSTS_PAGE = readFileSync(join(ROOT, 'docs', 'hosts.md'), 'utf-8');

/** The anchor a heading gets on GitHub: lower case, no punctuation, a hyphen for each space. */
function anchorOf(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-');
}

/** The text of the `## ` section of `page` whose anchor is `at`, or undefined. */
function sectionOf(page: string, at: string): string | undefined {
  const lines = page.split('\n');
  const start = lines.findIndex((line) => line.startsWith('## ') && anchorOf(line.slice(3)) === at);
  if (start === -1) return undefined;
  const length = lines.slice(start + 1).findIndex((line) => line.startsWith('## '));
  return lines.slice(start, length === -1 ? undefined : start + 1 + length).join('\n');
}

/** Every line of every fenced block of `section`, trimmed. */
function fencedLinesOf(section: string): string[] {
  const lines: string[] = [];
  let inside = false;
  for (const line of section.split('\n')) {
    if (line.startsWith('```')) {
      inside = !inside;
    } else if (inside) {
      lines.push(line.trim());
    }
  }
  return lines;
}

/** What of a row's install is not said by its section: a command that is no line of a block. */
function unsaid(section: string, install: Install) {
  if ('commands' in install) {
    const written = fencedLinesOf(section);
    return install.commands.filter((command) => !written.includes(command));
  }
  const spans = [...install.words.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
  return spans.filter((span) => !section.includes(span));
}

describe('the install line of a host', () => {
  it.each(HOST_NAMES)('%s: its anchor is a section of docs/hosts.md', (name) => {
    expect(sectionOf(HOSTS_PAGE, HOSTS[name].install.at)).toBeDefined();
  });

  it.each(HOST_NAMES)('%s: says nothing its section does not', (name) => {
    const install = HOSTS[name].install;
    const section = sectionOf(HOSTS_PAGE, install.at) ?? '';
    expect(unsaid(section, install)).toEqual([]);
  });

  // The Claude Code plugin is installed by two lines that four pages write as a block. The host
  // table is the one source: each of those blocks carries its commands, letter for letter.
  it.each(['README.md', 'docs/first-record.md', 'docs/hosts.md', 'plugin/README.md'])(
    '%s writes the Claude Code install lines of the host table',
    (page) => {
      const written = fencedLinesOf(readFileSync(join(ROOT, page), 'utf-8'));
      const install = HOSTS.claude.install;
      expect('commands' in install ? install.commands : []).toHaveLength(2);
      expect(
        ('commands' in install ? install.commands : []).filter((line) => !written.includes(line)),
      ).toEqual([]);
    },
  );

  it('is not vacuous: most hosts give a command, and a changed letter is seen', () => {
    const given = HOST_NAMES.filter((name) => 'commands' in HOSTS[name].install);
    expect(given.length).toBeGreaterThanOrEqual(5);
    const codex = HOSTS.codex.install;
    const section = sectionOf(HOSTS_PAGE, codex.at) ?? '';
    expect(section).toContain('codex plugin add mnema@mnema');
    expect(
      unsaid(section, { at: codex.at, commands: ['codex plugin install mnema@mnema'] }),
    ).toEqual(['codex plugin install mnema@mnema']);
    expect(unsaid(section, { at: codex.at, words: 'Run `codex plugin install`' })).toEqual([
      'codex plugin install',
    ]);
  });
});
