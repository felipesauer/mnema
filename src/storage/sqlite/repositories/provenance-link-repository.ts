import type {
  ProvenanceKind,
  ProvenanceLink,
  ProvenanceNode,
} from '../../../domain/entities/provenance-link.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface ProvenanceRow {
  readonly id: string;
  readonly source_kind: string;
  readonly source_ref: string;
  readonly target_kind: string;
  readonly target_ref: string;
  readonly created_at: string;
}

/**
 * Persistence for {@link ProvenanceLink} over the `provenance_links`
 * table (migration 019). Edges are refs, not FKs, so the same store
 * links notes, observations, decisions and memories uniformly. Writes
 * are idempotent — the table's UNIQUE constraint makes a repeated link a
 * no-op via `INSERT OR IGNORE`.
 */
export class ProvenanceLinkRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Records a directed edge `source → target`. Idempotent: a duplicate
   * edge is ignored, and the existing row is returned.
   *
   * @param source - The edge's source node
   * @param target - The edge's target node
   * @returns The stored link
   */
  link(source: ProvenanceNode, target: ProvenanceNode): ProvenanceLink {
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO provenance_links
           (id, source_kind, source_ref, target_kind, target_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(generateUuid(), source.kind, source.ref, target.kind, target.ref, isoNow());
    const stored = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM provenance_links
          WHERE source_kind = ? AND source_ref = ? AND target_kind = ? AND target_ref = ?`,
      )
      .get(source.kind, source.ref, target.kind, target.ref) as ProvenanceRow;
    return rowToLink(stored);
  }

  /**
   * Edges leaving a node (its downstream: what it produced).
   *
   * @param node - The source node
   */
  findFrom(node: ProvenanceNode): ProvenanceLink[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        'SELECT * FROM provenance_links WHERE source_kind = ? AND source_ref = ? ORDER BY created_at',
      )
      .all(node.kind, node.ref) as ProvenanceRow[];
    return rows.map(rowToLink);
  }

  /**
   * Edges entering a node (its upstream: what produced it).
   *
   * @param node - The target node
   */
  findTo(node: ProvenanceNode): ProvenanceLink[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        'SELECT * FROM provenance_links WHERE target_kind = ? AND target_ref = ? ORDER BY created_at',
      )
      .all(node.kind, node.ref) as ProvenanceRow[];
    return rows.map(rowToLink);
  }
}

function rowToLink(row: ProvenanceRow): ProvenanceLink {
  return {
    id: row.id,
    sourceKind: row.source_kind as ProvenanceKind,
    sourceRef: row.source_ref,
    targetKind: row.target_kind as ProvenanceKind,
    targetRef: row.target_ref,
    createdAt: row.created_at,
  };
}
