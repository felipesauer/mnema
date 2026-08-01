/**
 * How often a pattern was actually read: the count of `skill.consulted`.
 *
 * The fact exists because whether work was informed by a pattern is not derivable
 * afterwards — the moment of serving is the only moment it can be captured, and the
 * serving read records one. Until this derivation the record held those facts and
 * NOTHING read them back: a pattern consulted in every session and one nobody has
 * ever opened were indistinguishable on every surface. A captured fact with no
 * reader is a cost with no benefit.
 *
 * IT COUNTS RUNS, NOT FACTS. A run is one agent's working session, and "how many
 * sessions has this pattern informed" is the question a person curating patterns is
 * asking. Counting runs also makes the answer independent of the writer: the serving
 * read deduplicates per (run, skill) in the session's own memory, so a session that
 * reconnected and re-served the same pattern would put a second fact on the chain,
 * and a count of facts would report one session as two. The record is the same
 * either way; what changes is whether the reading says something true about it.
 *
 * A consultation with NO run counts on its own. Nothing merges it with another,
 * because nothing says it was the same session — and a fact the record holds is not
 * dropped from a count for being harder to attribute.
 *
 * It COUNTS, it does not judge. A pattern nobody has consulted may be new, narrow,
 * or dead, and only the reader has the context to tell — which is exactly why the
 * number goes to the surface a person uses and no adjective goes with it.
 */

import type { ScopedCache } from '../sources.js';

/** The event whose subject is the pattern that was read. */
const CONSULTED = 'skill.consulted';

/**
 * How many distinct runs consulted each pattern, keyed by the pattern's id.
 *
 * A pattern with no consultation is ABSENT from the map rather than present with a
 * zero: the map is built from the facts there are, and a caller asking about a
 * pattern reads the absence as the zero it is. That also keeps it a map over the
 * consultations rather than over the skills, so it costs nothing on a record that
 * has never served one.
 *
 * The runs are unioned across trees, not summed. A consultation lands in the tree
 * the READING session writes to, which is not necessarily the tree the pattern
 * lives in, so one session reaching two trees would otherwise be counted twice.
 */
export function consultationsByRun(sources: readonly ScopedCache[]): Map<string, number> {
  // A consultation with no run is counted on its own rather than folded into a
  // shared bucket: nothing says two of them were the same session.
  const runsBySkill = new Map<string, Set<string>>();
  const unattributed = new Map<string, number>();
  for (const source of sources) {
    for (const { entity, run } of source.cache.subjectRuns(CONSULTED)) {
      if (run === null) {
        unattributed.set(entity, (unattributed.get(entity) ?? 0) + 1);
        continue;
      }
      const runs = runsBySkill.get(entity) ?? new Set<string>();
      runs.add(run);
      runsBySkill.set(entity, runs);
    }
  }
  const counts = new Map<string, number>();
  for (const [skill, runs] of runsBySkill) counts.set(skill, runs.size);
  for (const [skill, loose] of unattributed) counts.set(skill, (counts.get(skill) ?? 0) + loose);
  return counts;
}
