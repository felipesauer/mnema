import type { AnchorRepository } from '../../storage/sqlite/repositories/anchor-repository.js';
import type { IntegrityCheck } from '../integrity/audit-integrity.js';
import type { AnchorRegistry } from './anchor-registry.js';
import { NONE_PROVIDER } from './none-anchor-provider.js';

/**
 * Produces the anchor (layer-3) portion of the integrity report. Two modes:
 *
 * - status-only (`verifyOnline: false`): reports how many anchors are
 *   pending vs anchored from the local `anchors` table, WITHOUT contacting
 *   any provider. Offline, always safe — this is what `doctor` shows.
 * - online (`verifyOnline: true`): additionally calls each anchor's provider
 *   `verify(head, receipt)` and reports the strongest problem found. This is
 *   the `mnema audit verify --verify-anchors` path.
 *
 * A clone with no anchors, or the `none` provider, yields a single neutral
 * "anchoring disabled / none recorded" line — never an error, so a clone is
 * never red for a missing anchor (ADR-37 asymmetric verification).
 *
 * @param anchors - The anchor-state repository
 * @param registry - Resolves a provider by name for online verification
 * @param configuredProvider - The project's configured provider name
 * @param verifyOnline - Whether to contact providers to verify each anchor
 * @returns One or more integrity-check rows for the anchor layer
 */
export function anchorStatusCheck(
  anchors: AnchorRepository,
  configuredProvider: string,
): IntegrityCheck {
  // Disabled project: nothing to report, and never an error.
  if (configuredProvider === NONE_PROVIDER) {
    return {
      name: 'audit anchoring',
      ok: true,
      detail: 'anchoring disabled (provider: none)',
      severity: 'warning',
    };
  }
  const all = anchors.listAll();
  if (all.length === 0) {
    return {
      name: 'audit anchoring',
      ok: true,
      detail: `no anchors recorded yet (provider: ${configuredProvider})`,
      severity: 'warning',
    };
  }
  const pending = all.filter((a) => a.status === 'pending').length;
  const anchored = all.filter((a) => a.status === 'anchored').length;
  // Pending is a warning (still maturing / not yet pushed), not an error.
  return {
    name: 'audit anchoring',
    ok: true,
    detail: `${anchored} anchored, ${pending} pending (provider: ${configuredProvider})${pending > 0 ? ' — run `audit verify --verify-anchors` to check them' : ''}`,
    severity: pending > 0 ? 'warning' : undefined,
  };
}

export async function inspectAnchors(
  anchors: AnchorRepository,
  registry: AnchorRegistry,
  configuredProvider: string,
  verifyOnline: boolean,
): Promise<IntegrityCheck[]> {
  if (configuredProvider === NONE_PROVIDER || !verifyOnline) {
    return [anchorStatusCheck(anchors, configuredProvider)];
  }
  const all = anchors.listAll();
  if (all.length === 0) return [anchorStatusCheck(anchors, configuredProvider)];

  // Online: verify each anchored/pending receipt against its provider.
  let verified = 0;
  let stillPending = 0;
  let cannotVerify = 0;
  const broken: string[] = [];
  for (const rec of all) {
    if (rec.receipt === null) {
      stillPending += 1;
      continue;
    }
    if (!registry.has(rec.provider)) {
      cannotVerify += 1;
      continue;
    }
    const provider = registry.resolve(rec.provider);
    const result = await provider.verify(rec.headHash, {
      provider: rec.provider,
      head: rec.headHash,
      blob: rec.receipt,
      status: rec.status === 'failed' ? 'pending' : rec.status,
    });
    if (result.state === 'anchored') verified += 1;
    else if (result.state === 'pending') stillPending += 1;
    else if (result.state === 'broken')
      broken.push(`${rec.headHash.slice(0, 12)}: ${result.detail}`);
    else cannotVerify += 1; // not-anchored / cannot-verify
  }

  if (broken.length > 0) {
    return [
      {
        name: 'audit anchoring',
        ok: false,
        detail: `${broken.length} anchor(s) failed verification — ${broken.join('; ')}`,
        severity: 'error',
      },
    ];
  }
  const notes = [`${verified} verified`];
  if (stillPending > 0) notes.push(`${stillPending} pending`);
  if (cannotVerify > 0) notes.push(`${cannotVerify} unverifiable offline`);
  return [
    {
      name: 'audit anchoring',
      ok: true,
      detail: `${notes.join(', ')} (provider: ${configuredProvider})`,
      severity: cannotVerify > 0 || stillPending > 0 ? 'warning' : undefined,
    },
  ];
}
