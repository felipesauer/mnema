import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeRedactor, isClean } from './redact.mjs';
import { holdsToken, scanFolder } from './token.mjs';

const TOKEN = 'sk-ant-oat01-' + 'A1b2C3d4'.repeat(8);
test('holdsToken sees the token in every form it takes in a log, and scanFolder answers with numbers only', () => {
  const b64 = Buffer.from(TOKEN).toString('base64');
  assert.ok(holdsToken(`x ${TOKEN} y`, TOKEN));
  assert.ok(holdsToken(`x ${b64} y`, TOKEN));
  assert.ok(holdsToken(`x ${encodeURIComponent(TOKEN)} y`, TOKEN));
  assert.ok(!holdsToken('nothing', TOKEN));
  const d = mkdtempSync(join(tmpdir(), 'abp-scan-'));
  writeFileSync(join(d, 'a'), `a ${TOKEN}`);
  writeFileSync(join(d, 'b'), 'clean');
  assert.deepEqual(scanFolder(d, [TOKEN, 'another-secret-not-there-0000']), { files: 2, hits: 1 });
});

test('the dashed form of a machine path (the project folder Claude Code names after it) and the home folder is redacted too', () => {
  const redact = makeRedactor({ paths: ['/srv/kit/runs/a.b'], user: 'someuser', host: 'somehost', uid: 1 });
  const out = redact('config/projects/-srv-kit-runs-a-b/x and -home-someuser-Documents-Me--projects--mnema-private');
  assert.ok(!/srv-kit|someuser|mnema-private/.test(out), out);
});

test('the redactor takes out the token, an address, an organization id, the machine and keeps a GitHub noreply address', () => {
  const redact = makeRedactor({ token: TOKEN, paths: ['/srv/kit/runs/abc'], user: 'someuser', host: 'somehost', uid: 4242, env: { MNEMA_HOME: '/srv/kit/runs/abc/mnema-home' } });
  const text = [
    `Authorization: Bearer ${TOKEN}`,
    `token=${Buffer.from(TOKEN).toString('base64')}`,
    'mail [EMAIL] and 120697114+[ACCOUNT]@users.noreply.github.com',
    'anthropic-organization-id: 123e4567-e89b-12d3-a456-426614174000',
    '/srv/kit/runs/abc/repo and /home/[FIXTURE]/.cache on somehost as someuser uid=4242',
    '/srv/kit/runs/abc/mnema-home/x',
  ].join('\n');
  const out = redact(text);
  for (const leak of [TOKEN, '[EMAIL]', '123e4567', '/srv/kit', 'someuser', 'somehost', 'uid=4242']) assert.ok(!out.includes(leak), `left ${leak} in ${out}`);
  assert.ok(out.includes('120697114+[ACCOUNT]@users.noreply.github.com'));
  assert.ok(isClean(out, redact));
});
