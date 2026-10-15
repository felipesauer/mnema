/**
 * THE GUARD THAT REFUSES A HOST THAT LEFT THE MACHINE SAYS WHAT IT SAW. It used to name only the
 * address; the call and the port were in an strace log that went with the sandbox. The refusal now
 * carries the whole line. What counts as beyond loopback is unchanged, and these cases hold both:
 * the message by value, and the set of destinations that is the same as it was.
 *
 * The lines are fixed text, one of them the one a runner of the Azure kind produced: a name
 * resolution to the resolver its `resolv.conf` names, refused for want of a route.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  destinationsIn,
  destinationsOrRefuse,
  EVIDENCE_DIRECTORY,
  isLoopback,
  theRefusalFor,
} from './host-contract/support/the-host.js';

const AZURE =
  '4242 connect(3, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("168.63.129.16")}, 16) = -1 ENETUNREACH (Network is unreachable)';
const LOOPBACK =
  '4242 connect(5, {sa_family=AF_INET, sin_port=htons(41737), sin_addr=inet_addr("127.0.0.1")}, 16) = 0';
const UNIX =
  '4242 connect(6, {sa_family=AF_UNIX, sun_path="/run/systemd/resolve/io.systemd.Resolve"}, 110) = -1 ENOENT';
const V6 =
  '4243 connect(7, {sa_family=AF_INET6, sin6_port=htons(443), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2606:4700::6810:84e5", &sin6_addr), sin6_scope_id=0}, 28) = -1 ENETUNREACH (Network is unreachable)';
const V6_LOOPBACK =
  '4243 connect(8, {sa_family=AF_INET6, sin6_port=htons(8080), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "::1", &sin6_addr), sin6_scope_id=0}, 28) = 0';

const LOG = [LOOPBACK, UNIX, AZURE, V6, V6_LOOPBACK, AZURE].join('\n');

describe('the refusal for a host that reached beyond loopback', () => {
  it('names the call, the address and the port, whole, for every line that left', () => {
    const refusal = theRefusalFor(LOG);
    expect(refusal).toBe(
      [
        'the host reached beyond loopback: ["168.63.129.16","2606:4700::6810:84e5"]',
        `  ${AZURE.trim()}`,
        `  ${V6.trim()}`,
      ].join('\n'),
    );
    expect(refusal).toContain('connect(3,');
    expect(refusal).toContain('sin_port=htons(53)');
    expect(refusal).toContain('inet_addr("168.63.129.16")');
    expect(refusal).toContain('ENETUNREACH');
  });

  it('is not raised for loopback, a unix socket, or nothing', () => {
    expect(theRefusalFor([LOOPBACK, UNIX, V6_LOOPBACK].join('\n'))).toBeUndefined();
    expect(theRefusalFor('')).toBeUndefined();
  });

  it('counts what it does not print', () => {
    const many = Array.from(
      { length: 23 },
      (_, i) =>
        `1 connect(3, {sa_family=AF_INET, sin_port=htons(${1000 + i}), sin_addr=inet_addr("10.0.0.1")}, 16) = -1 ENETUNREACH`,
    ).join('\n');
    const lines = (theRefusalFor(many) ?? '').split('\n');
    expect(lines).toHaveLength(1 + 20 + 1);
    expect(lines.at(-1)).toBe('  ... and 3 more');
  });

  it('leaves the set of destinations beyond loopback what it was', () => {
    expect(destinationsIn(LOG)).toEqual([
      '127.0.0.1',
      '168.63.129.16',
      '2606:4700::6810:84e5',
      '::1',
    ]);
    expect(destinationsIn(LOG).filter((address) => !isLoopback(address))).toEqual([
      '168.63.129.16',
      '2606:4700::6810:84e5',
    ]);
  });
});

describe('the strace outlives the sandbox of a case that failed', () => {
  const dirs: string[] = [];
  const before = process.env[EVIDENCE_DIRECTORY];
  afterEach(() => {
    if (before === undefined) delete process.env[EVIDENCE_DIRECTORY];
    else process.env[EVIDENCE_DIRECTORY] = before;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const aDirectory = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'mnema-guard-'));
    dirs.push(dir);
    return dir;
  };

  it('is copied whole to the evidence directory, and the case still fails', () => {
    const sandbox = aDirectory();
    const keep = join(aDirectory(), 'kept');
    const file = join(sandbox, 'connect.strace');
    writeFileSync(file, `${LOG}\n`);
    process.env[EVIDENCE_DIRECTORY] = keep;
    expect(() => destinationsOrRefuse(file)).toThrow(/beyond loopback: \["168\.63\.129\.16"/);
    const copies = readdirSync(keep);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(/\.connect\.strace$/);
    expect(readFileSync(join(keep, copies[0] ?? ''), 'utf-8')).toBe(`${LOG}\n`);
  });

  it('keeps nothing when the host stayed on loopback, and returns where it connected', () => {
    const sandbox = aDirectory();
    const keep = join(aDirectory(), 'kept');
    const file = join(sandbox, 'connect.strace');
    writeFileSync(file, `${LOOPBACK}\n`);
    process.env[EVIDENCE_DIRECTORY] = keep;
    expect(destinationsOrRefuse(file)).toEqual(['127.0.0.1']);
    expect(existsSync(keep)).toBe(false);
  });

  it('fails the same when nothing says where to keep the log', () => {
    const file = join(aDirectory(), 'connect.strace');
    writeFileSync(file, `${AZURE}\n`);
    delete process.env[EVIDENCE_DIRECTORY];
    expect(() => destinationsOrRefuse(file)).toThrow(/sin_port=htons\(53\)/);
  });
});
