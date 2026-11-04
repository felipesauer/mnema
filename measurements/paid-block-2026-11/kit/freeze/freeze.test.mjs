import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { namesScan } from '../lib/redact.mjs';
import { KIT } from '../lib/token.mjs';

test('the names scan finds the maintainer\'s other projects, accounts, employer and machine, and says only which pattern hit and how often', () => {
  const dirty = 'rules-[PROJECT].yaml and [PROJECT] and /home/[FIXTURE]/x and [EMAIL]';
  const hits = namesScan(dirty, ['someone']);
  assert.ok(hits.length >= 4);
  assert.ok(hits.every((h) => Object.keys(h).sort().join() === 'hits,pattern'));
  assert.deepEqual(namesScan('inline and fiscal and a noreply 120697114+x@users.noreply.github.com', []), []);
});

test('the frozen manifest, if it is there, carries no such name and every hash it cites is what it cites', async () => {
  if (!existsSync(join(KIT, 'freeze', 'prereg.json'))) return;
  const { verify } = await import('./verify-prereg.mjs');
  assert.deepEqual(verify(), []);
});
