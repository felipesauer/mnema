/** The entity types a provenance edge can connect. */
export type ProvenanceKind = 'observation' | 'note' | 'decision' | 'memory' | 'skill';

/** One directed provenance edge: `source → target`. */
export interface ProvenanceLink {
  readonly id: string;
  readonly sourceKind: ProvenanceKind;
  readonly sourceRef: string;
  readonly targetKind: ProvenanceKind;
  readonly targetRef: string;
  readonly createdAt: string;
}

/** A (kind, ref) pair identifying one node in the provenance graph. */
export interface ProvenanceNode {
  readonly kind: ProvenanceKind;
  readonly ref: string;
}
