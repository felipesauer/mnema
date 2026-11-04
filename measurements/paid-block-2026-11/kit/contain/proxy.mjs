// The allow-list proxy of a session, outside the box: an HTTPS CONNECT proxy on a unix socket, port 443 of the listed hosts only (a port of
// AllowProxy of the 27 October kits, sandbox.py). The session has no network of its own: a bridge inside (netbridge.py, unchanged) forwards its
// loopback port to this socket. Every decision is a line of the log, with the bytes each way for an allowed one: that is the traffic record
// (a tunnel is TLS, so the log says whom the session spoke to and how much, and the stream-json of the session is the record of what was said).
import { appendFileSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import net from 'node:net';

export const ALLOW_DEFAULT = ['api.anthropic.com', '*.anthropic.com', 'claude.ai', '*.claude.ai', 'claude.com', '*.claude.com', 'registry.npmjs.org'];

export function hostAllowed(host, patterns = ALLOW_DEFAULT) {
  const h = host.toLowerCase().replace(/\.$/, '');
  return patterns.some((p) => (p.startsWith('*.') ? h.endsWith(p.slice(1)) : h === p));
}

/**
 * @param {{sock: string, log: string, allow?: string[], dial?: (host: string, port: number) => net.Socket, now?: () => Date}} o
 * `dial` is the way out to the allowed host; the tests give it a local stand-in.
 */
export function startProxy({ sock, log, allow = ALLOW_DEFAULT, dial = (host, port) => net.connect(port, host), now = () => new Date() }) {
  if (existsSync(sock)) unlinkSync(sock);
  const write = (verdict, target, extra = '') => appendFileSync(log, `${now().toISOString().slice(0, 19)} ${verdict} ${target}${extra}\n`);
  const conns = new Set();
  const server = net.createServer((conn) => {
    conns.add(conn);
    conn.on('close', () => conns.delete(conn));
    conn.on('error', () => {});
    let head = Buffer.alloc(0);
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return head.length < 16384 ? undefined : conn.destroy();
      conn.off('data', onData);
      conn.pause();
      const first = head.subarray(0, end).toString('latin1').split('\r\n')[0];
      const rest = head.subarray(end + 4);
      const [method, target] = first.split(' ');
      if (method?.toUpperCase() !== 'CONNECT' || !target) {
        write('DENY', `not-connect ${first.slice(0, 60)}`);
        return void conn.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n');
      }
      const i = target.lastIndexOf(':');
      const host = target.slice(0, i);
      const port = target.slice(i + 1);
      if (!hostAllowed(host, allow) || port !== '443') {
        write('DENY', target);
        return void conn.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      }
      const up = dial(host, 443);
      conns.add(up);
      up.on('close', () => conns.delete(up));
      let toUp = rest.length;
      let toDown = 0;
      up.on('error', () => {
        write('FAIL', target);
        conn.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      });
      up.once('connect', () => {
        write('ALLOW', target);
        conn.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) up.write(rest);
        conn.on('data', (d) => (toUp += d.length));
        up.on('data', (d) => (toDown += d.length));
        conn.pipe(up);
        up.pipe(conn);
        conn.resume();
      });
      const done = () => {
        if (up.listenerCount('__done')) return;
        up.once('__done', () => {});
        write('CLOSE', target, ` up=${toUp} down=${toDown}`);
        up.destroy();
        conn.destroy();
      };
      conn.once('close', done);
      up.once('close', done);
    };
    conn.on('data', onData);
  });
  return new Promise((resolve) => {
    server.listen(sock, () => {
      chmodSync(sock, 0o600);
      resolve({
        close: () =>
          new Promise((r) => {
            for (const c of conns) c.destroy();
            server.close(() => {
              if (existsSync(sock)) unlinkSync(sock);
              r();
            });
          }),
      });
    });
  });
}
