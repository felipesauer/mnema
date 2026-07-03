import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';

/**
 * Redirects `$HOME` (and `USERPROFILE`) to a throwaway temp dir for the
 * whole test process, so anything that resolves the user-level dir
 * (`~/.config/mnema` via `os.homedir()`) — the project HMAC secret, hook
 * approvals, identity — writes into an isolated sandbox instead of the
 * developer's real home.
 *
 * Without this, a test that builds a ServiceContainer and writes an audit
 * event mints a real per-project HMAC secret under the developer's
 * `~/.config/mnema/projects/`, polluting their machine and risking a
 * stale-secret flake across runs. Isolating at the `HOME` level covers
 * every current and future test in one place, rather than requiring each
 * of the ~38 container tests to pass an explicit `userDir`.
 *
 * Tests that need their OWN isolated home (they pass an explicit dir or
 * set HOME themselves) are unaffected — they override this default.
 */
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let sandboxHome: string | null = null;

beforeAll(() => {
  sandboxHome = mkdtempSync(path.join(tmpdir(), 'mnema-test-home-'));
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  if (sandboxHome !== null) rmSync(sandboxHome, { recursive: true, force: true });
});
