import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hostAllowed, startProxy } from './proxy.mjs';

const connect = (sock, line) =>
  new Promise((resolve) => {
    const c = net.connect(sock);
    let out = '';
    c.on('data', (d) => (out += d));
    c.on('close', () => resolve(out));
    c.write(line);
    setTimeout(() => c.destroy(), 300);
  });

test('the allow-list is by name: the listed hosts and the wildcard, not a look-alike', () => {
  assert.ok(hostAllowed('api.anthropic.com'));
  assert.ok(hostAllowed('x.anthropic.com'));
  assert.ok(hostAllowed('registry.npmjs.org'));
  assert.ok(!hostAllowed('evilanthropic.com'));
  assert.ok(!hostAllowed('api.anthropic.com.evil.test'));
  assert.ok(!hostAllowed('example.com'));
});

test('the proxy refuses a host off the list and a port other than 443, a method other than CONNECT, and logs each; an allowed host is dialled and logged with its bytes', async () => {
  const d = mkdtempSync(join(tmpdir(), 'abp-proxy-'));
  const sock = join(d, 'p.sock');
  const log = join(d, 'proxy.log');
  const dialled = [];
  const stand = net.createServer((s) => s.on('data', (x) => s.write(Buffer.concat([Buffer.from('echo:'), x])))).listen(0, '127.0.0.1');
  await new Promise((r) => stand.once('listening', r));
  const p = await startProxy({ sock, log, dial: (host, port) => (dialled.push(`${host}:${port}`), net.connect(stand.address().port, '127.0.0.1')) });
  assert.match(await connect(sock, 'CONNECT example.com:443 HTTP/1.1\r\n\r\n'), /403/);
  assert.match(await connect(sock, 'CONNECT api.anthropic.com:80 HTTP/1.1\r\n\r\n'), /403/);
  assert.match(await connect(sock, 'GET / HTTP/1.1\r\n\r\n'), /405/);
  const ok = await connect(sock, 'CONNECT api.anthropic.com:443 HTTP/1.1\r\n\r\nhello');
  assert.match(ok, /200 Connection Established/);
  assert.match(ok, /echo:hello/);
  await new Promise((r) => setTimeout(r, 100));
  await p.close();
  stand.close();
  assert.deepEqual(dialled, ['api.anthropic.com:443']);
  const text = readFileSync(log, 'utf8');
  assert.match(text, /DENY example\.com:443/);
  assert.match(text, /DENY api\.anthropic\.com:80/);
  assert.match(text, /ALLOW api\.anthropic\.com:443/);
  assert.match(text, /CLOSE api\.anthropic\.com:443 up=\d+ down=\d+/);
});
