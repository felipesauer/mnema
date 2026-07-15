import { describe, expect, it } from 'vitest';

import { verifyCheckGlyph } from '@/cli/commands/audit-command.js';
import type { IntegrityCheck } from '@/services/integrity/audit-integrity.js';

/**
 * `audit verify` used to render a green ✔ on a dormant/unverifiable
 * content-attestation line (ok:true but severity:'warning'), so a human
 * skimming a green screen read "all good" when authenticity was in fact
 * unverifiable. The glyph now keys off severity first: a warning is ⚠ even
 * when ok. The exit code is derived elsewhere from error-severity only, so
 * this is display-only and the "errors fail, warnings pass" contract holds.
 */
function check(partial: Partial<IntegrityCheck>): IntegrityCheck {
  return { name: 'x', ok: true, detail: '', ...partial };
}

describe('verifyCheckGlyph', () => {
  it('renders a dormant (ok:true, warning) check as ⚠, not ✔', () => {
    expect(verifyCheckGlyph(check({ ok: true, severity: 'warning' }))).toBe('⚠');
  });

  it('renders a genuinely-ok non-warning check as ✔', () => {
    expect(verifyCheckGlyph(check({ ok: true }))).toBe('✔');
    expect(verifyCheckGlyph(check({ ok: true, severity: undefined }))).toBe('✔');
  });

  it('renders an error-severity failure as ✘', () => {
    expect(verifyCheckGlyph(check({ ok: false, severity: 'error' }))).toBe('✘');
    // default severity is error
    expect(verifyCheckGlyph(check({ ok: false }))).toBe('✘');
  });

  it('renders a failed warning as ⚠ too (never ✘ for a warning)', () => {
    expect(verifyCheckGlyph(check({ ok: false, severity: 'warning' }))).toBe('⚠');
  });
});
