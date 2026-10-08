import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readStackSource } from './stack-source.js';

/**
 * A git host on this machine: HTTPS on 127.0.0.1 with a certificate made for the case, serving
 * hello-stack through `git http-backend`, and a second host the first one redirects to. Nothing
 * here leaves the machine.
 */
const HELLO = join(dirname(fileURLToPath(import.meta.url)), '../../../stacks/fixtures/hello-stack');

let dir: string;
let caFile: string;
let origin: Server;
let elsewhere: Server;
let elsewhereAsked = 0;
let base: string;

const quiet = { stdio: 'ignore' as const, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } };

function listen(server: Server): Promise<number> {
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port)),
  );
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mnema-stack-git-'));
  caFile = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      caFile,
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ],
    { stdio: 'ignore' },
  );
  const work = join(dir, 'work');
  cpSync(HELLO, work, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work, ...quiet });
  execFileSync('git', ['add', '.'], { cwd: work, ...quiet });
  execFileSync(
    'git',
    ['-c', 'user.name=a', '-c', 'user.email=a@example.com', 'commit', '-q', '-m', 'hello'],
    { cwd: work, ...quiet },
  );
  mkdirSync(join(dir, 'served'));
  execFileSync('git', ['clone', '-q', '--bare', work, join(dir, 'served', 'hello.git')], quiet);
  const tls = { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(caFile) };

  elsewhere = createServer(tls, (_, res) => {
    elsewhereAsked += 1;
    res.writeHead(404).end();
  });
  const elsewherePort = await listen(elsewhere);

  origin = createServer(tls, (req, res) => {
    const url = new URL(req.url ?? '/', 'https://127.0.0.1');
    if (url.pathname.startsWith('/moved/')) {
      res
        .writeHead(302, {
          location: `https://localhost:${elsewherePort}${url.pathname.slice('/moved'.length)}${url.search}`,
        })
        .end();
      return;
    }
    // The CGI the git project ships, answering one request.
    const cgi = spawn('git', ['http-backend'], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: join(dir, 'served'),
        GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.slice(1),
        REQUEST_METHOD: req.method ?? 'GET',
        CONTENT_TYPE: req.headers['content-type'] ?? '',
        HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
        GIT_PROTOCOL: String(req.headers['git-protocol'] ?? ''),
      },
    });
    req.pipe(cgi.stdin);
    const out: Buffer[] = [];
    cgi.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    cgi.on('close', () => {
      const all = Buffer.concat(out);
      const split = all.indexOf('\r\n\r\n');
      const head = all.subarray(0, split).toString('latin1').split('\r\n');
      const headers: Record<string, string> = {};
      let status = 200;
      for (const line of head) {
        const [k, ...v] = line.split(':');
        if (k === undefined) continue;
        if (k.toLowerCase() === 'status') status = Number.parseInt(v.join(':').trim(), 10);
        else headers[k] = v.join(':').trim();
      }
      res.writeHead(status, headers).end(all.subarray(split + 4));
    });
  });
  base = `https://127.0.0.1:${await listen(origin)}`;
});

afterAll(() => {
  origin.close();
  elsewhere.close();
  rmSync(dir, { recursive: true, force: true });
});

const trusting = (): NodeJS.ProcessEnv => ({ ...process.env, GIT_SSL_CAINFO: caFile });

describe('a stack fetched with git', () => {
  it('is read from the host the person named, and shown with its commit', async () => {
    const read = await readStackSource(`${base}/hello.git`, dir, trusting());
    if (!read.ok) throw new Error(read.message);
    expect(read.problems).toEqual([]);
    expect(read.files.map((f) => f.path).sort()).toEqual([
      'LICENSE',
      'agents/greeter.md',
      'skills/hello/SKILL.md',
      'stack.json',
    ]);
    expect(read.shown).toMatch(/^git 127\.0\.0\.1:\d+\/hello\.git at [0-9a-f]{40}$/);
  });

  it('is refused when the host redirects, and the other host is never asked', async () => {
    const read = await readStackSource(`${base}/moved/hello.git`, dir, trusting());
    expect(read.ok ? 'read' : read.code).toBe('STACK_SOURCE_REFUSED');
    expect(elsewhereAsked).toBe(0);
  });

  it.each([
    ['an address with a credential', 'https://someone:hunter2@HOST/hello.git'],
    ['an address that is not https', 'http://127.0.0.1/hello.git'],
    ['a transport git would run a program for', 'ext::sh -c touch% /tmp/pwned'],
  ])('refuses %s before fetching anything', async (_, address) => {
    const read = await readStackSource(
      address.replace('HOST', base.slice('https://'.length)),
      dir,
      trusting(),
    );
    expect(read.ok ? 'read' : read.code).toBe('STACK_SOURCE_REFUSED');
    expect(read.ok ? '' : read.message).not.toContain('hunter2');
  });
});
