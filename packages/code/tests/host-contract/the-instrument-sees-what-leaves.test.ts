/**
 * THE INSTRUMENT SEES WHAT LEAVES, and a round that measured another binary is red.
 *
 * Every other case here is evidence only if two things are true of the harness itself, so they
 * are cases of their own. NOTHING MAY LEAVE THE MACHINE: the host is started where only loopback
 * exists, and every address it connects or sends to is read back off `strace`. A reader that is
 * blind reads an empty list as a clean one, so this starts a process that DOES try to leave and
 * requires the instrument to name where it tried, and requires the namespace to have stopped it.
 * And THE VERSION IS DATA: the host's attribution block says which binary spoke, and a run that
 * names another version than the one that answered is refused, in every case, by the harness.
 *
 * WHAT THE FIRST ONE DOES NOT PROVE: that the host, in some code path no case takes, never
 * reaches out. It proves the instrument would see it in the paths that are taken. The address it
 * tries is a documentation address (RFC 5737) that is not routed anywhere.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aHostForEachCase,
  destinationsIn,
  expectTheVersionRun,
  isLoopback,
  refuseUnlessLoopbackOnly,
  theHostUnderTest,
  theVersionTheRequestNames,
} from './support/the-host.js';

describe('the instrument sees what leaves', () => {
  it('reads an address that is not loopback off a process that tries to connect to one', () => {
    const outside = '192.0.2.1';
    const dir = mkdtempSync(join(tmpdir(), 'mnema-instrument-'));
    const log = join(dir, 'connect.strace');
    const tried = spawnSync(
      'strace',
      [
        '-f',
        '-qq',
        '-e',
        'trace=connect,sendto,sendmsg',
        '-s',
        '120',
        '-o',
        log,
        process.execPath,
        '-e',
        `const s = require('node:net').connect({ host: '${outside}', port: 443 });
         s.on('error', (e) => { console.error(e.code); process.exit(0); });
         s.on('connect', () => { console.error('CONNECTED'); process.exit(0); });`,
      ],
      { encoding: 'utf-8', timeout: 30_000 },
    );
    // The instrument names the address, and the address is not one it calls loopback...
    const destinations = destinationsIn(readFileSync(log, 'utf-8'));
    rmSync(dir, { recursive: true, force: true });
    expect(destinations).toContain(outside);
    expect(destinations.filter((address) => !isLoopback(address))).toContain(outside);
    // ...and the namespace is what stopped it: no route, so never connected.
    expect(tried.stderr).not.toContain('CONNECTED');
    expect(tried.stderr).toMatch(/ENETUNREACH|EHOSTUNREACH|ECONNREFUSED/);
  }, 60_000);

  it('refuses to start a host in a process that can see a route out', () => {
    const route = {
      lo: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4' as const,
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
      eth0: [
        {
          address: '10.0.0.7',
          netmask: '255.255.255.0',
          family: 'IPv4' as const,
          mac: '02:00:00:00:00:01',
          internal: false,
          cidr: '10.0.0.7/24',
        },
      ],
    };
    expect(() => refuseUnlessLoopbackOnly(route)).toThrow(/eth0 10\.0\.0\.7/);
    expect(() => refuseUnlessLoopbackOnly({ lo: route.lo })).not.toThrow();
  });

  it('is running where only loopback exists', () => {
    expect(() => refuseUnlessLoopbackOnly()).not.toThrow();
  });
});

describe('a round that measured another binary is red', () => {
  const start = aHostForEachCase();

  it('names the version the binary reports, in the attribution block of every request', async () => {
    const host = theHostUnderTest();
    const session = await start();
    // `claude --version` and the attribution block say the same version, and the run names it.
    const reported = spawnSync(host.binary, ['--version'], { encoding: 'utf-8' }).stdout;
    expect(reported.trim().startsWith(host.version)).toBe(true);
    for (const request of session.messages) {
      expect(theVersionTheRequestNames(request)?.startsWith(`${host.version}.`)).toBe(true);
    }
  }, 120_000);

  it('refuses a run that names another version than the one that answered', async () => {
    const host = theHostUnderTest();
    const session = await start();
    expect(() => expectTheVersionRun(session, host.version)).not.toThrow();
    // The same session, read as if the run had been started for another release.
    expect(() => expectTheVersionRun(session, '0.0.1')).toThrow(
      /this round measured .*run names 0\.0\.1/,
    );
    // A version that only shares its first digits is another version: `2.1.28` is not `2.1.281`.
    const named =
      session.messages.map(theVersionTheRequestNames).find((v) => v !== undefined) ?? '';
    const shorter = host.version.slice(0, -1);
    expect(named.startsWith(shorter)).toBe(true);
    expect(() => expectTheVersionRun(session, shorter)).toThrow(/this round measured/);
  }, 120_000);
});
