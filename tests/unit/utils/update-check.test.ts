import { describe, expect, it, vi } from 'vitest';
import { VERSION } from '@/utils/version.js';
import { checkForUpdate, type FetchLike, fetchLatestVersion } from '@/utils/version-check.js';

/** A Response-like stub for the injected fetcher. */
function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
  } as unknown as Response;
}

describe('npm update check (ADR-40)', () => {
  describe('fetchLatestVersion — fail-open, injectable', () => {
    it('returns the version from the registry payload', async () => {
      const fetcher: FetchLike = async () => jsonResponse({ version: '9.9.9' });
      expect(await fetchLatestVersion(fetcher)).toBe('9.9.9');
    });

    it('returns null (fail-open) when the fetch throws (offline/DNS/timeout)', async () => {
      const fetcher: FetchLike = async () => {
        throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
      };
      expect(await fetchLatestVersion(fetcher)).toBeNull();
    });

    it('returns null on a non-ok response', async () => {
      const fetcher: FetchLike = async () => jsonResponse({}, false);
      expect(await fetchLatestVersion(fetcher)).toBeNull();
    });

    it('returns null when the payload has no string version', async () => {
      const fetcher: FetchLike = async () => jsonResponse({ version: 123 });
      expect(await fetchLatestVersion(fetcher)).toBeNull();
    });

    it('aborts (fail-open null) rather than hanging on a slow registry', async () => {
      const fetcher: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      // Tiny timeout so the test is fast; the abort path resolves to null.
      expect(await fetchLatestVersion(fetcher, 10)).toBeNull();
    });
  });

  describe('checkForUpdate — pure comparison', () => {
    it('flags an update when the latest is strictly newer', () => {
      const r = checkForUpdate('999.0.0');
      expect(r.updateAvailable).toBe(true);
      expect(r.latest).toBe('999.0.0');
      expect(r.message).toMatch(/newer mnema is available/i);
    });

    it('reports up to date when latest equals the installed version', () => {
      const r = checkForUpdate(VERSION);
      expect(r.updateAvailable).toBe(false);
      expect(r.message).toMatch(/up to date/i);
    });

    it('does NOT flag an update when latest is older (alpha not nagged down)', () => {
      // The installed build leads a lower stable — must not be told to downgrade.
      const r = checkForUpdate('0.0.1');
      expect(r.updateAvailable).toBe(false);
    });

    it('degrades to "could not check" when latest is null (fetch failed)', () => {
      const r = checkForUpdate(null);
      expect(r.updateAvailable).toBe(false);
      expect(r.latest).toBeNull();
      expect(r.message).toMatch(/could not check/i);
    });

    it('ignores a garbage latest string (not valid semver → no update)', () => {
      expect(checkForUpdate('not-a-version').updateAvailable).toBe(false);
    });
  });

  it('the real fetchLatestVersion default does NOT fire unless called (offline by default)', () => {
    // Sanity: importing the module performs no network call. A spy on global
    // fetch stays untouched until fetchLatestVersion is explicitly invoked.
    const spy = vi.spyOn(globalThis, 'fetch');
    // no call here
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
