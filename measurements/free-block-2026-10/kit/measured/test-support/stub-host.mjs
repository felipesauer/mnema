// A stand-in for a host, for the tests of the runner: it behaves as a host does towards the relay (an OpenAI-compatible chat loop with one
// shell tool) and nothing else. argv: <relay url> <prompt>. STUB_MODE: loop (default: run what the model asks, answer when it answers),
// hang (never ends), always-call (never accepts an answer: the model is asked again until the relay stops it), dump-env (prints the names
// of its environment and any value that looks like a key, then loops).
import { execSync } from 'node:child_process';

const [relayUrl, prompt] = process.argv.slice(2);
const mode = process.env.STUB_MODE ?? 'loop';
if (mode === 'hang') {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (mode === 'dump-env') {
  console.log(`env names: ${Object.keys(process.env).sort().join(',')}`);
  for (const [k, v] of Object.entries(process.env)) if (/sk-or-/.test(String(v))) console.log(`KEY-SHAPED VALUE IN ${k}`);
}
const tools = [{ type: 'function', function: { name: 'bash', parameters: { type: 'object', properties: { command: { type: 'string' } } } } }];
const messages = [{ role: 'user', content: prompt }];
for (let turn = 0; turn < 60; turn++) {
  const res = await fetch(`${relayUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer stand-in-key-0000' },
    body: JSON.stringify({ model: process.env.STUB_MODEL, stream: true, messages, tools }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.log(`the relay answered ${res.status}: ${text.slice(0, 200)}`);
    process.exit(3);
  }
  let content = '';
  const calls = [];
  for (const block of text.split('\n\n')) {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
    if (data === '' || data === '[DONE]') continue;
    const ev = JSON.parse(data);
    for (const c of ev.choices ?? []) {
      if (typeof c.delta?.content === 'string') content += c.delta.content;
      for (const tc of c.delta?.tool_calls ?? []) calls.push(tc);
    }
  }
  if (calls.length === 0) {
    console.log(content);
    process.exit(0);
  }
  messages.push({ role: 'assistant', content: null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: c.function })) });
  for (const c of calls) {
    const { command } = JSON.parse(c.function.arguments);
    let out;
    try {
      out = execSync(command, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `exit ${e.status}: ${e.stderr}`;
    }
    messages.push({ role: 'tool', tool_call_id: c.id, content: out });
  }
  if (mode === 'always-call' && turn > 58) break;
}
