// What a finished session LEFT in its repository, as plain data (no git needed to read it afterwards): for each file that differs from the
// starting commit, its status, the lines added and removed, and the hash of its content at the end. Tracked changes come from `git diff`
// against the STARTING COMMIT (not HEAD: a host may commit), untracked ones from `git ls-files --others` with their whole content as
// "added". Files the kit itself placed in the working directory for the host (a baseline of path -> sha256 taken after the host's
// configuration was written) are left out while they are unchanged; the files a host OWNS (its own configuration, which it may rewrite when
// it starts, as OpenCode does with opencode.json) are left out whatever they hold, and said so (`left_out_host_owned`).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** The untracked files of a working directory with their hashes: taken after the kit wrote the host's configuration, before the host ran. */
export function untrackedBaseline(project, env) {
  const files = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: project, env, encoding: 'utf8' }).split('\0').filter(Boolean);
  return Object.fromEntries(files.map((f) => [f, sha(readFileSync(join(project, f)))]));
}

function linesOfDiff(text) {
  const added = [];
  const removed = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added, removed };
}

export function collectRepoFacts(project, { start, env, baseline = {}, hostOwned = [], maxBytes = 262144 }) {
  const owned = (path) => hostOwned.some((h) => (h.endsWith('/') ? path.startsWith(h) : path === h));
  const git = (...args) => execFileSync('git', args, { cwd: project, env, encoding: 'utf8', maxBuffer: 1 << 27 });
  const changed = [];
  const parts = git('diff', '--name-status', '-z', '--no-renames', start).split('\0').filter(Boolean);
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i];
    const path = parts[i + 1];
    const { added, removed } = linesOfDiff(git('diff', '-U0', '--no-renames', '--no-color', start, '--', path));
    let sha256End = null;
    try {
      if (status !== 'D') sha256End = sha(readFileSync(join(project, path)));
    } catch {
      sha256End = null;
    }
    changed.push({ path, status, added, removed, sha256_end: sha256End });
  }
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  let leftOut = 0;
  const leftOutOwned = [];
  for (const path of untracked) {
    if (owned(path)) {
      leftOutOwned.push(path);
      continue;
    }
    const buf = readFileSync(join(project, path));
    const hash = sha(buf);
    if (baseline[path] === hash) {
      leftOut += 1;
      continue;
    }
    const big = statSync(join(project, path)).size > maxBytes;
    const text = big || buf.includes(0) ? '' : buf.toString('utf8');
    changed.push({ path, status: 'A', added: text === '' ? [] : text.replace(/\n$/, '').split('\n'), removed: [], sha256_end: hash, untracked: true, ...(big ? { truncated: true } : {}) });
  }
  changed.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { start, changed, left_out_unchanged_kit_files: leftOut, left_out_host_owned: leftOutOwned };
}
