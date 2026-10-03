// Does a SessionStart document reach the model twice in a resumed Claude Code session? No model: a stand-in API on loopback.
// Usage: node resume-probe.mjs [matcher]   (no matcher = the plugin's own declaration)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeApi } from '../p1/harness/lib/fake-api.mjs';

const KEY = 'sk-ant-stand-in-0000000000000000000000';
const MARK = 'OPENING-DOCUMENT-MARKER-7731';
const root = mkdtempSync(join(tmpdir(), 'resume-probe-'));
const home = join(root, 'home');
const repo = join(root, 'repo');
mkdirSync(join(home, '.claude'), { recursive: true });
mkdirSync(repo, { recursive: true });
writeFileSync(join(home, '.claude.json'), JSON.stringify({
  hasCompletedOnboarding: true, bypassPermissionsModeAccepted: true,
  customApiKeyResponses: { approved: [KEY.slice(-20)], rejected: [] }, projects: {},
}));
const hook = join(root, 'hook.mjs');
writeFileSync(hook, `import { appendFileSync } from 'node:fs';
let s=''; process.stdin.on('data',c=>s+=c); process.stdin.on('end',()=>{
  const src = JSON.parse(s).source;
  appendFileSync(${JSON.stringify(join(root, 'fired.log'))}, src + '\\n');
  process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'${MARK}'}}));
});`);
const settings = join(root, 'settings.json');
writeFileSync(settings, JSON.stringify({ hooks: { SessionStart: [{ ...(process.argv[2] ? { matcher: process.argv[2] } : {}), hooks: [{ type: 'command', command: `node ${hook}` }] }] } }));

const run = async (extra) => {
  const api = await startFakeApi({});
  const env = {
    PATH: process.env.PATH, HOME: home, ANTHROPIC_BASE_URL: api.url, ANTHROPIC_API_KEY: KEY,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost',
  };
  const argv = ['-p', 'hello', '--settings', settings, '--dangerously-skip-permissions', ...extra];
  const out = await new Promise((resolve) => {
    const c = spawn('/usr/bin/claude', argv, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let so = ''; let se = '';
    c.stdout.on('data', (d) => (so += d)); c.stderr.on('data', (d) => (se += d));
    const t = setTimeout(() => c.kill('SIGKILL'), 60000);
    c.on('close', (status) => { clearTimeout(t); resolve({ status, so, se }); });
  });
  await api.close();
  const turns = api.requests.filter((r) => Array.isArray(r.body?.tools) && r.body.tools.length > 0);
  const last = turns.at(-1)?.body;
  const text = JSON.stringify(last?.messages ?? []);
  return { status: out.status, stderr: out.se.slice(0, 200), sessionRequests: turns.length, copiesInLastRequest: text.split(MARK).length - 1, messages: last?.messages?.length };
};

const id = '3f2b1c9e-5a4d-4c1b-9e2a-0d6f7a8b9c10';
console.log('first', JSON.stringify(await run(['--session-id', id])));
console.log('resume', JSON.stringify(await run(['--resume', id])));
console.log('fired', (await import('node:fs')).readFileSync(join(root, 'fired.log'), 'utf8').trim().split('\n').join(','));
