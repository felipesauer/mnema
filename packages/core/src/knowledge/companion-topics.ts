/**
 * The topics of the observations a call records beside the fact it is about.
 *
 * A handoff event carries only the two agent labels and a task event only its title, so the
 * prose that belongs with them (what the next agent must read, what the task is) is recorded in
 * the same call as an observation about the task. These are the two topics, named once so the
 * writes that record them and the reads that serve them cannot come to spell them differently.
 */

/** The topic of the observation that carries a handoff's brief. */
export const BRIEF_TOPIC = 'brief';

/** The topic of the observation that carries a task's description. */
export const DESCRIPTION_TOPIC = 'description';
