// Tests of reading a finished session again from what the run left. It uses the live edit check of Qwen Code of 30 October (results/qwen-edit-check),
// whose fourth request was the host's memory pass, a helper agent that the first reading took for the agent's final message.
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { rejudge } from './rejudge.mjs';

const SOURCE = join(import.meta.dirname, '..', 'results', 'qwen-edit-check');
const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

test('reading the live Qwen edit check again takes the loop\'s final message, keeps the first reading beside, and keeps the verdict', { skip: !existsSync(join(SOURCE, 'editcheck.json')) }, () => {
  const root = mkdtempSync(join(process.env.ABFB_TMP ?? tmpdir(), 'abfb-rejudge-'));
  roots.push(root);
  const dir = join(root, 'qwen-edit-check');
  cpSync(SOURCE, dir, { recursive: true });
  // The folder in the kit has been read again already: its editcheck.json is the second reading and editcheck.as-run.json the first. The test starts from the
  // first one, as the folder was when the run left it, so that it shows what the second reading does to it.
  copyFileSync(join(dir, 'editcheck.as-run.json'), join(dir, 'editcheck.json'));
  rmSync(join(dir, 'editcheck.as-run.json'));
  const before = JSON.parse(readFileSync(join(dir, 'editcheck.json'), 'utf8'));
  assert.match(before.final_message, /^After reviewing the conversation/, 'the first reading took the memory pass for the answer');
  const done = rejudge(dir);
  const after = JSON.parse(readFileSync(join(dir, 'editcheck.json'), 'utf8'));
  assert.equal(done.label, 'edits');
  assert.equal(after.label, before.label);
  assert.equal(after.verdict, true);
  assert.match(after.final_message, /^Done\. Changed the first line of `README\.md`/);
  assert.ok(existsSync(join(dir, 'editcheck.as-run.json')));
  const again = rejudge(dir);
  assert.equal(again.label, 'edits');
  assert.equal(JSON.parse(readFileSync(join(dir, 'editcheck.as-run.json'), 'utf8')).final_message, before.final_message, 'the first reading is kept once, not overwritten by the second');
});
