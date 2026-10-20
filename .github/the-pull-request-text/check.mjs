/**
 * Refuses a pull request whose title, description or commit message carries the em dash.
 *
 * The text is read from the event payload the runner wrote (a FILE), and the commits from
 * `git log` over `<base.sha>..<head.sha>`. Nothing a stranger wrote is ever interpolated into a
 * shell, and nothing of it is executed. The character is built from its code point, so this file
 * carries no dash of its own for the prose guard to count.
 *
 * Exit 0: clean. Exit 1: the lines that carry it, each with where. Exit 2: it could not tell.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const THE_DASH = String.fromCharCode(0x2014);

/**
 * Every place the character appears.
 *
 * @param {{ title?: string, body?: string | null, commits?: { sha: string, message: string }[] }} text
 * @returns {string[]} one finding per offending line, naming where it is
 */
export function dashesIn({ title = '', body = '', commits = [] }) {
  const found = [];
  if (title.includes(THE_DASH)) found.push(`title: ${title}`);
  (body ?? '').split(/\r?\n/).forEach((line, index) => {
    if (line.includes(THE_DASH)) found.push(`body, line ${index + 1}: ${line}`);
  });
  for (const { sha, message } of commits) {
    message.split(/\r?\n/).forEach((line, index) => {
      if (line.includes(THE_DASH)) {
        found.push(`commit ${sha.slice(0, 12)}, line ${index + 1}: ${line}`);
      }
    });
  }
  return found;
}

/**
 * The commits of `range`, one entry each, read by git and not by a shell.
 *
 * @param {string} range
 * @param {string} [cwd]
 */
export function commitsIn(range, cwd = process.cwd()) {
  const shas = execFileSync('git', ['rev-list', range], { cwd, encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean);
  return shas.map((sha) => ({
    sha,
    message: execFileSync('git', ['show', '-s', '--format=%B', sha], { cwd, encoding: 'utf-8' }),
  }));
}

export function main(eventPath = process.env.GITHUB_EVENT_PATH) {
  if (!eventPath) {
    console.error('RULER BROKEN: no event payload, so there is no pull request to read.');
    return 2;
  }
  const pr = JSON.parse(readFileSync(eventPath, 'utf-8')).pull_request;
  if (!pr) {
    console.error('RULER BROKEN: the event carries no pull request.');
    return 2;
  }
  let commits;
  try {
    commits = commitsIn(`${pr.base.sha}..${pr.head.sha}`);
  } catch {
    console.error('RULER BROKEN: git could not read the range of the pull request.');
    return 2;
  }
  if (commits.length === 0) {
    console.error('RULER BROKEN: the range holds no commit, so there is nothing it examined.');
    return 2;
  }
  const found = dashesIn({ title: pr.title, body: pr.body, commits });
  if (found.length === 0) {
    console.log('NO EM DASH in the title, the description or the commits.');
    return 0;
  }
  console.error('EM DASH FOUND. Replace it with a comma, a colon, a period or a hyphen:');
  for (const one of found) console.error(`  ${one}`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main();
