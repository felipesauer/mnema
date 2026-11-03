// THE EDIT CHECK of a host (the maintainer's call of 29 October, observation 01a1899b-87e6: before the pre-registration each host gets a cheap
// edit check, so a host that will not edit is "incapable of editing" BEFORE a measured day is spent). The capability check edits nothing, so
// no host was seen to write a file of a repository with nobody answering.
//
// The task: change ONE line of ONE file of the synthetic repository, and nothing else. The criterion is in code, over what the session left
// in the repository (analysis/repo-facts.mjs) and not over what the model said: the file changed exactly as asked, and no other file changed.
// A run sends at most 6 requests, counted in the account's units at the host's measured cost, and stops the day at 40 used (measured/session.mjs).
import { finalMessageOf, itemsOf, mainLoopOf } from '../analysis/labels.mjs';
import { ENDINGS } from '../measured/protocol.mjs';

export const FILE = 'README.md';
export const OLD_LINE = '# synthetic-accessors';
export const NEW_LINE = '# Synthetic Accessors';
/** The whole of the first user turn. It names no rule, no package and no record. */
export const PROMPT = `In \`${FILE}\`, change the first line from \`${OLD_LINE}\` to \`${NEW_LINE}\`. Change nothing else: no other line of that file and no other file.`;

const REFUSAL = /permission denied|read-only file system|operation not permitted|not permitted|not allowed|sandbox|requires? approval|approval (is )?required|blocked|refused|cannot write|can't write|EACCES|EROFS/i;

/** What the finished session left, against the task. */
export function editedAsAsked(repo) {
  const touched = repo.changed.map((c) => c.path);
  const readme = repo.changed.find((c) => c.path === FILE);
  const asked = readme !== undefined && readme.status === 'M' && readme.removed.length === 1 && readme.removed[0] === OLD_LINE && readme.added.length === 1 && readme.added[0] === NEW_LINE;
  const others = touched.filter((p) => p !== FILE);
  return { changed_files: touched, changed_as_asked: asked, readme_changed: readme !== undefined, other_files_changed: others, nothing_else: others.length === 0 };
}

/** Lines of tool results that look like the host or its sandbox refusing a write: kept as a diagnosis, never as the verdict. */
export function refusalSignals(wire) {
  const last = mainLoopOf(wire.filter((r) => r.forwarded === true)).at(-1);
  if (last === undefined) return [];
  return itemsOf(last.request)
    .filter((it) => it.role === 'tool')
    .flatMap((it) => it.text.split('\n').filter((l) => REFUSAL.test(l)).map((l) => l.trim().slice(0, 160)))
    .slice(0, 5);
}

export function judgeEdit({ repo, wire, meta, outcome, capability = 'passed' }) {
  const requests = wire.filter((r) => r.forwarded === true).length;
  const base = { kind: 'edit-check', read_by: 'CODE', ended: outcome.ended, requests_read: requests, account_units_spent: meta.account_units_spent ?? null };
  if (capability !== 'passed') return { ...base, label: 'incapable', verdict: false, why: `the capability check was not passed (${capability})` };
  const ending = ENDINGS[outcome.ended];
  if (ending?.label === 'discarded') return { ...base, label: 'discarded', verdict: null, why: ending.why };
  // The check reads the STATE: a host that edited and then ran out of its few requests, or of its minutes, can edit.
  const facts = editedAsAsked(repo);
  const final = finalMessageOf(wire);
  let label;
  if (facts.changed_as_asked && facts.nothing_else) label = 'edits';
  else if (facts.changed_as_asked) label = 'edits, but also changed other files';
  else if (facts.readme_changed) label = 'edited, but not as asked';
  else if (facts.changed_files.length > 0) label = 'edited a file other than the one asked';
  else label = 'incapable of editing';
  return {
    ...base,
    label,
    verdict: label === 'edits',
    ...facts,
    session_note: outcome.ended === 'exited' ? null : `ended: ${outcome.ended} (${ending?.why ?? 'unknown'}); the state of the repository is what counts`,
    refusal_signals: label === 'incapable of editing' ? refusalSignals(wire) : [],
    final_message: final.text === null ? null : final.text.slice(0, 600),
  };
}
