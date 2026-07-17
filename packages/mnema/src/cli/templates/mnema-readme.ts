import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Config } from '@mnema/core/config/config-schema.js';

/** File name of the committed source-of-truth map inside `.mnema/`. */
const MNEMA_README = 'README.md';

/**
 * The committed `.mnema/README.md` body: a short map of what each directory
 * is and — the part nothing else on disk says — which directories are the
 * authoritative record versus the rebuildable cache versus public
 * verification material. The top-level project README and docs explain this,
 * but they do not travel uniformly into a clone; this file does, so a
 * teammate who opens `.mnema/` in a cloned repo can tell at a glance what is
 * safe to edit, what is regenerated, and where the secrets are NOT.
 *
 * @param config - Resolved project config (for the actual `paths.*`)
 */
export function mnemaReadmeBody(config: Config): string {
  const p = config.paths;
  return [
    '# .mnema/',
    '',
    "This directory is Mnema's on-disk home for this project. It mixes three",
    'kinds of file — knowing which is which tells you what to edit, what is',
    'regenerated, and what must never hold a secret.',
    '',
    '## Source of truth (committed — the record of the work)',
    '',
    'Authoritative. Change them through the `mnema` CLI / MCP tools, commit',
    'them, and they survive a fresh clone:',
    '',
    `- \`${p.audit}/\` — the hash-chained audit log (JSONL). The canonical trail.`,
    `- \`${p.backlog}/\` — task markdown, by state.`,
    `- \`${p.roadmap}/\` — epics and decisions (ADRs).`,
    `- \`${p.sprints}/\` — sprint markdown.`,
    `- \`${p.memory}/\`, \`${p.skills}/\`, \`${p.observations}/\` — captured knowledge.`,
    '  RECORD-ONLY: change these via the `mnema memory/skill/observation`',
    '  commands, not by hand-editing the file — a stray edit to an',
    '  already-cached knowledge file is not folded back on `sync`.',
    '',
    '## Rebuildable cache (git-ignored — safe to delete)',
    '',
    `- \`${p.state}/\` — the SQLite cache, sync buffer and attachment blobs, all`,
    '  derived from the markdown above. Delete it and run `mnema sync` to',
    '  rebuild. It is git-ignored, never travels in a clone, and is not the',
    '  source of truth.',
    '',
    '## Public verification material (committed — carries NO secret)',
    '',
    '- `.mnema/keys/` — public keys and a non-reversible project fingerprint',
    '  used to VERIFY the audit chain. Public by design. The private signing',
    '  key and the project HMAC secret live only in `~/.config/mnema/` (outside',
    '  the repo) and are never written here.',
    '',
    'Run `mnema doctor` to check the project health, and `mnema sync` to rebuild',
    'the cache from the committed record.',
    '',
  ].join('\n');
}

/**
 * Writes `.mnema/README.md` if it is absent. Idempotent and non-destructive:
 * an existing README (a project may have customised it) is left untouched, so
 * re-running `init` never clobbers edits.
 *
 * @param cwd - Project root
 * @param config - Resolved project config
 * @returns `'created'` when written, `'present'` when it already existed
 */
export function writeMnemaReadme(cwd: string, config: Config): 'created' | 'present' {
  // `.mnema/` is the parent of the state dir (e.g. `.mnema/state` -> `.mnema`).
  const mnemaDir = path.dirname(path.join(cwd, config.paths.state));
  const target = path.join(mnemaDir, MNEMA_README);
  if (existsSync(target)) return 'present';
  writeFileSync(target, mnemaReadmeBody(config), 'utf-8');
  return 'created';
}
