/**
 * bootstrap: the opening read of a session, focused on the actor.
 *
 * When an agent starts, it needs five things: where the actor left off, what can
 * be done next, what patterns it is expected to work by, what has already been
 * decided, and what is waiting on somebody to decide. bootstrap composes exactly
 * those — {@link resume} for the "where was I" (the actor's latest run and open
 * focus), the live pieces of work for the "what now", the NAMES of the adopted
 * skills ({@link adoptedSkills}) for the "how we do things here", the NAMES of the
 * decisions in force ({@link decisionsInForce}) for the "what governs here", and
 * the NAMES of what awaits a judgement for the "what is still open". It is the
 * "serve lean" of the design: a filtered opening context, not a dump of the whole
 * record.
 *
 * THE HALVES THAT WERE MISSING, and the measurement is what said so. The product
 * has three state machines (task, decision, skill) with two sides each — what
 * already holds, and what waits — and this read served two of those six cells: the
 * waiting side of tasks and the holding side of skills. Decision appeared on
 * neither. Over a real record that held two ADRs, and nothing else worth reading,
 * the answer was `work: []`, `skills: []` — an empty answer about a full record, in
 * the exact shape this module already names as the worst one an opening read can
 * have. Both ADRs were `proposed`, so the holding side of decision, filled first,
 * still did not see them.
 *
 * The table is closed here. Five of the six cells are served and the sixth — the
 * holding side of TASK — is deliberately empty: a task that holds is a terminal
 * one, and there is nothing to be done about it. What later split in two is the
 * task machine's WAITING side: a task can wait on a move (the work list) or on a
 * verdict (the waiting list), and until the disposition decided it, both were the
 * work list and one of them was wrong there.
 *
 * BOTH LISTS ASK THE DISPOSITION, WHICH IS ONE RULE AND NOT TWO. A disposition is
 * what a state MEANS to a reader — derived from the machine's own transition table,
 * classified once per machine (`core`'s `TASK_DISPOSITION`, this package's
 * {@link DECISION_DISPOSITION} and {@link SKILL_DISPOSITION}) — and it is exactly
 * the question these two lists ask. {@link Bootstrap.work} carries the tasks whose
 * disposition still has something to do about it (`advancing`, `stalled`);
 * {@link Bootstrap.awaitingJudgement} carries everything, of any machine, whose
 * disposition is `awaiting-judgement`. Neither list writes out a set of states, and
 * the two sets are disjoint by construction — a state has one disposition.
 *
 * THIS PARAGRAPH USED TO SAY THE WORK LIST'S RULE WAS "HAS AT LEAST ONE LEGAL MOVE",
 * and it used that rule to explain why the WAITING list needed a different one: a
 * decision that is `accepted` still accepts `supersede`, and a skill that is
 * `adopted` still accepts `deprecate`, so under it both would be pendencies for as
 * long as they exist and the list would grow and never empty. That argument was
 * right, and the premise underneath it — that the rule at least held for the machine
 * it came from — was false. `reopen` is legal from `DONE` (`TRANSITIONS`) with
 * nothing to make it happen, so this read called a completed task live work forever:
 * the very shape the paragraph was written to avoid, in the list the paragraph was
 * pointing AT. What falsified it was a person reading the list on a terminal instead
 * of an agent parsing it — `5 actionable task(s)`, and one of them said `(DONE)`.
 * The proxy is gone from both lists; see `tasks.ts` for the machine it came from.
 *
 * THE WAITING LIST REACHES FOUR STATES, ACROSS ALL THREE MACHINES: a task
 * `IN_REVIEW`, a decision `proposed`, a skill `proposed` or `reviewed`. It used to
 * say three and leave the task machine out, which was the same defect from the other
 * side: `core` classified `IN_REVIEW` as `awaiting-judgement` — both its exits demand
 * a proof field, so every way out is a verdict somebody owes — and this list asked
 * two machines out of three, so a task submitted for review appeared as one more job
 * to pick up and on nobody's list of what they owed a ruling on. Every one of the
 * four has a way out that does not come back, proved from the transition tables in
 * `disposition.test.ts` ("nothing can wait forever", and the DAG case beside it), so
 * the list still empties. ONE list discriminated by `kind`, not three: the criterion
 * is one sentence, and a criterion written twice is two criteria that come to
 * disagree about what "waiting" means. Asserted in `bootstrap.test.ts` — "lists what
 * awaits a judgement across ALL THREE machines, with the state that says which ruling
 * is missing".
 *
 * NAMES, NEVER BODIES. The skills appear as name + id and nothing else, and the
 * decisions as title + `adr` + id. A body is the pattern, or the argument, in full
 * — paragraphs of it — and putting twenty of those in every session's opening
 * context would bury what matters and charge for what rarely applies. A name is one
 * line: it is both the index and the trigger, and an agent cannot ask for what it
 * does not know exists. The body comes from a separate read, when a name turns out
 * to match the task at hand: a pattern's from {@link adoptedSkills} (the `skills`
 * tool), and a decision's — its `rationale` and the `alternatives` it turned down —
 * from {@link readRecord} (the `read_record` tool).
 *
 * AND ON THE MIXED LIST, THE `kind` SAYS WHAT THE SECOND READ WILL HAND BACK. An
 * index is only an index if its reader knows where the rest is, and one list holding
 * three sorts of item has to say which is which per line or the reader has to guess:
 * `decision` → the argument and the alternatives, `skill` → the pattern itself,
 * `task` → the verdicts its position allows and the proof each demands. The
 * discriminant that makes the union readable in TypeScript and the label that makes
 * it usable by an agent are the same field, which is why there is no second one.
 *
 * EVERY ITEM ON THIS LIST HAS A SECOND READ THAT ANSWERS IT: a decision's is
 * {@link readRecord} (the `read_record` tool), a pattern's is
 * {@link lookupServedSkill} (the `skills` tool, with the id), and a task's is
 * {@link nextActions} (the `next_actions` tool) — the pair of verdicts `IN_REVIEW`
 * allows and the proof each one demands, which is the same second read a task on the
 * work list has. Each serves the rest of something still being decided, and that is
 * the point of naming them here — an index that points at a door which refuses its
 * own items is an index that lies.
 *
 * THIS PARAGRAPH USED TO SAY THE OPPOSITE, and what falsified it is worth keeping.
 * It read: "A PATTERN'S IS NOT SERVED TO AN AGENT AT ALL, and that is measured, not
 * assumed" — measured correctly, on a `skills` tool that refused every state on this
 * list, and then generalized into an axis. It was not one. The gate never required a
 * consultation, so the body was two writes away (`review`, `adopt`) and those two
 * writes were false: a ruling by somebody who could not read what they ruled on. The
 * refusal did not keep a body in, it made the record lie about how the body was
 * reached. And `read_record` was already serving the whole `rationale` of a decision
 * `proposed` on this very list — the same disposition, the same reader, one half
 * given the text of what it must judge and the other half nothing.
 *
 * What did NOT change is the door being ONE: `read_record` still refuses a skill
 * (`USE_SKILLS_TOOL`), because the `skills` tool records the consultation and a
 * second door would let the body out without the fact. Asserted in `mcp-e2e.test.ts`
 * — "answers the SECOND READ each kind names, for every item awaiting a judgement".
 *
 * The CLI is unchanged and still serves any state to a person (`mnema show <id>`),
 * recording nothing, because a command line has no session to attribute a
 * consultation to.
 *
 * A TASK HAS A BODY TOO, AND IT IS THE MOVES. The same rule now governs the work
 * list, because it is the same distinction: a work item carries id, title, state
 * and when it last moved — the NAME of a piece of work — and not the moves the
 * workflow allows from it. Those moves are its body: the whole row set out of its
 * state, each action with the proof it demands, ten lines for one task. They come
 * from {@link nextActions} (or {@link nextActionsForTask}), asked about the ONE
 * task the agent decided to act on — the same second read a skill's body comes
 * through. The trade is deliberate and it is not symmetric: one extra call on the
 * path where an agent ACTS, against the whole table for every task on the path
 * where it only LOOKS.
 *
 * No count of the moves takes their place, either. A number beside each item would
 * be a second, weaker statement of the position the item already carries: the state
 * IS what decides which moves exist, and `next_actions` answers it exactly. It used
 * to be argued the other way round — that a count would "restate the definition of
 * the list", because membership WAS having a legal move — and that definition is the
 * one this read no longer uses.
 *
 * FILTERING WAS NOT A LIMIT, AND MEASUREMENT IS WHAT SAID SO. This doc used to
 * claim, under the heading LEAN, NOT MEASURED, that "the economy is a CONSEQUENCE
 * of serving only what matters, never a budget this layer manages". The premise
 * beneath that was that being live bounds the work list. It does not: a healthy
 * backlog is mostly live, and excluding what is over excludes almost nothing. The
 * number that falsified it was 854 — the lines of ONE payload over a modest record
 * (30 live tasks, 15 decisions, 25 adopted patterns, 20 memories, 10 observations),
 * of which the work list alone was 742, some 25 lines per task, against the ~200
 * lines the market publishes for a whole project memory. A hundred live tasks would
 * have been ~2,500 lines.
 *
 * So the limit is STATED now, in two halves, and neither of them is a tokenizer:
 *   - each item is a NAME, which is what fixes the per-item cost at a handful of
 *     fields instead of a transition table or an argument;
 *   - THREE of the four lists are CUT (see {@link capped}) and each says how many
 *     there were — `work`/{@link Bootstrap.workTotal},
 *     `decisions`/{@link Bootstrap.decisionsTotal}, and
 *     `awaitingJudgement`/{@link Bootstrap.awaitingJudgementTotal}. A cut that does
 *     not declare itself is the same failure as an empty answer that reads like an
 *     answer.
 *
 * `skills` IS THE FOURTH, AND IT IS NOT CUT. It has no total either, and that is a
 * known gap rather than a distinction: nothing bounds it, so a record with two
 * hundred adopted patterns puts two hundred lines here. It is left alone because
 * cutting it is not a slice of this rule but a decision about ORDER. The other
 * three are ordered by an instant, so a cut discards the stalest and reads as "the
 * rest is older"; this one is ordered by NAME, so a cut would discard the end of
 * the alphabet, which says nothing at all. Ordering it by recency instead would
 * invert an observable that callers already depend on — a stable alphabetical list
 * is what keeps a host's cache of that prompt prefix valid — so the fix is a change
 * with its own reasoning, not a fourth call to {@link capped}.
 *
 * What has NOT changed is the part that was right: nothing here estimates tokens
 * or measures bytes. A count of items is a property this layer can be correct
 * about; a token budget is not. Asserted in `bootstrap.test.ts` — "cuts the work
 * list at the convention's limit and says how many there were", "serves every
 * item, and no new field, below the limit", "cuts the decisions at the same
 * limit and says how many there were", "cuts what awaits a judgement at the same
 * limit and says how many there were", and "serves EVERY adopted pattern, uncut and
 * uncounted — the list this limit does not reach".
 *
 * ONE number and ONE cut, for every list that has one. The limit is the search's own
 * default taken by reference (see {@link SERVED_LIMIT}), because a second number for
 * "how many items does a read hand back when nobody said" is a second convention that
 * drifts from the first; and the cut is one function ({@link capped}) rather than
 * one per list, because a slice written twice is a rule written twice.
 *
 * What still makes the rest lean is the filtering:
 *   - the actor's focus comes from `resume`, already scoped to the actor;
 *   - the work list carries ONLY live tasks — those a reader still has something to
 *     do about, which is `advancing` or `stalled` (see {@link liveWork}) — most
 *     recently touched first, so the freshest work leads and the cut falls on the
 *     stalest;
 *   - the skill list carries ONLY adopted patterns, by name;
 *   - the decision list carries ONLY decisions in force (`accepted`), by name,
 *     most recently settled first — see {@link decisionsInForce} for why one state
 *     is the whole filter;
 *   - the awaiting list carries ONLY what a person still owes a ruling on, by name
 *     and by the state that says which ruling — `core`'s `TASK_DISPOSITION` and this
 *     package's {@link DECISION_DISPOSITION} and {@link SKILL_DISPOSITION}, one
 *     table per machine, each total in the compiler.
 *
 * AN HONEST LIMIT. The work list is workspace-wide, not the actor's own: a task
 * projection carries no `who`, so the tasks cannot be attributed to the actor
 * the way the runs can (see {@link focus}). bootstrap surfaces the actor's focus
 * (their runs) AND the workspace's live work — the two honest halves the
 * read model supports today. When a future slice ties a task to the actor, the
 * work list can narrow to the actor with no change to this shape.
 *
 * ONE WORLD NOW, AND THAT IS THE CORRECTION. The four halves read the SAME caches:
 * every tree the caller can see. The split used to be deliberate — skills from every
 * tree (a pattern is a capability), work and runs from the actor's single tree
 * (because "work is scoped to a tree") — and the second half of that sentence stopped
 * being true when routing became a function of the KIND. A task lands in the tree
 * that travels and a memory in the machine's own, whoever wrote either; so "the
 * actor's tree" names no tree in particular, and a work list read from one of them
 * came back EMPTY while looking like an answer. That is the worst shape an opening
 * read can have: an agent told there is nothing to do proceeds as if that were true.
 *
 * Concatenating per-tree projections is not an approximation of the union: a task's
 * whole history lands in one tree (a move follows the entity), so the per-tree fold
 * and the union fold see the same events for it. Ordering is by CONTENT
 * (`updatedAt`, then id), so which trees are passed, and in what order, cannot
 * reshuffle the list.
 */

import { newestFirst, type ProjectionCache, SEARCH_DEFAULT_LIMIT } from '@mnema/core';
import {
  type DecisionAwaitingJudgement,
  type DecisionRef,
  decisionsAwaitingJudgement,
  decisionsInForce,
} from './decisions.js';
import { type ActorScope, type Resume, resume } from './focus.js';
import {
  adoptedSkills,
  type SkillAwaitingJudgement,
  type SkillRef,
  skillsAwaitingJudgement,
} from './skills.js';
import {
  liveWork,
  type TaskAwaitingJudgement,
  tasksAwaitingJudgement,
  type WorkItem,
} from './tasks.js';

/**
 * How many items of ONE list an opening context serves.
 *
 * It is the search's own default, taken BY REFERENCE and not restated: that
 * constant is already this product's published answer to "how many items does a
 * read hand back when nobody said", and a second number for the same question is
 * a second convention that drifts from the first. The same reasoning makes it one
 * constant for every list here rather than one per list — the question a second
 * number would answer differently is the same question.
 */
const SERVED_LIMIT: number = SEARCH_DEFAULT_LIMIT;

/**
 * One thing waiting on a person's ruling, NAMED, from any of the three machines —
 * all of which have a waiting side.
 *
 * A discriminated union and not a widened record: the machines name their items
 * differently (a decision by title and `ADR-<n>`, a pattern by its name, a task by
 * its title) and flattening them into one optional-everything shape would let a
 * consumer read a field that is never there. The `kind` narrows it, and it is the
 * same field that tells an agent which read serves the rest (see the module doc). A
 * consumer that says something per item therefore does not compile until it has an
 * answer for all three — which is how the surface that prints this list met the task
 * arm rather than dropping it into whichever branch was last.
 */
export type AwaitingJudgement =
  | DecisionAwaitingJudgement
  | SkillAwaitingJudgement
  | TaskAwaitingJudgement;

/**
 * The opening context: where the actor is, the live work, the patterns to
 * work by, and the decisions that govern.
 */
export interface Bootstrap {
  /** Where the actor left off and what they have open. */
  readonly resume: Resume;
  /**
   * The workspace's LIVE tasks — those a reader still has something to do about,
   * which is what {@link liveWork} answers — most recently touched first, NAMED and
   * not spelled out: the moves each one allows come from {@link nextActions}, asked
   * per task (see the module doc). A task that has arrived or was called off is
   * omitted, one waiting on a verdict is on {@link Bootstrap.awaitingJudgement}
   * instead, and so is everything past {@link Bootstrap.workTotal}'s cut omitted.
   * NOT attributed to the actor (see below).
   */
  readonly work: readonly WorkItem[];
  /**
   * How many live tasks there are in all. Greater than `work.length` means
   * the list was cut, and the items missing are the STALEST — the order is
   * freshest-first, so a cut answer is always the top of it.
   *
   * Named for the list it counts rather than called `total`, which is what the
   * one-list read this borrows the shape from ({@link searchRecords}) can afford:
   * several lists arrive here, and a bare total beside them would leave a reader to
   * guess which one it was about.
   */
  readonly workTotal: number;
  /**
   * The adopted patterns, by NAME and id — never the body (see the module doc).
   * Ordered by name, so the list is stable whatever order the trees are read in.
   */
  readonly skills: readonly SkillRef[];
  /**
   * The decisions in force — `accepted`, and nothing else — by title, `adr` label
   * and id, never the body — neither the `rationale` nor the `alternatives` (see
   * the module doc; both come from {@link readRecord}). Most recently settled
   * first, so the freshest calls lead
   * and the cut falls on the oldest, and everything past
   * {@link Bootstrap.decisionsTotal}'s cut is omitted.
   */
  readonly decisions: readonly DecisionRef[];
  /**
   * How many decisions are in force in all. Greater than `decisions.length` means
   * the list was cut, and what is missing is the OLDEST of them.
   *
   * Which is worth one warning to whoever reads this number: an old decision is not
   * a weak one. A call settled two years ago and never superseded governs exactly as
   * much as one settled today, and this cut keeps the recent end because recency is
   * the only ordering the record proves — not because age ranks authority. `search`
   * (kind `decision`, state `accepted`) reaches past it.
   */
  readonly decisionsTotal: number;
  /**
   * What is waiting on a person: the tasks `IN_REVIEW`, the decisions still
   * `proposed` and the patterns still `proposed` or `reviewed`, in ONE list, each
   * carrying the `kind` that says which read serves the rest of it and the `state`
   * that says which ruling is missing. Never a body — the argument, the pattern and
   * a task's moves are all a second read.
   *
   * Most recently moved first, ACROSS the three kinds: it is one list ordered by one
   * property of the content, not tasks and then decisions and then skills.
   * Everything past {@link Bootstrap.awaitingJudgementTotal}'s cut is omitted.
   *
   * NOT the same question as `work`, though both now ask the disposition. That list
   * means "there is still something to do about this"; this one means "somebody owes
   * a ruling", and no record is on both — see the module doc.
   */
  readonly awaitingJudgement: readonly AwaitingJudgement[];
  /**
   * How many things await a judgement in all. Greater than
   * `awaitingJudgement.length` means the list was cut, and what is missing is the
   * STALEST — which for this list is the part most worth knowing about, since a
   * proposal nobody has touched for a year is the one most likely to have been
   * forgotten. `search` (kind `decision` or `skill`, with a `state`) reaches past
   * the cut.
   */
  readonly awaitingJudgementTotal: number;
}

/**
 * Builds the opening context for `actor` over every tree the caller can see:
 * their resume, the freshest live tasks by name, the names of the adopted
 * patterns, the names of the decisions in force, and the names of what awaits a
 * judgement. Reads caches only; composes pure derivations. The five halves are
 * independent — an actor with no runs still gets the work list, and a record with
 * no patterns still gets the other four.
 */
export function bootstrap(caches: readonly ProjectionCache[], scope: ActorScope): Bootstrap {
  // Ordered HERE and not in `tasks.ts`, for the reason the awaiting halves give: the
  // order belongs to the list that is served and cut, and the same comparator settles
  // both, so "most recently moved first, ties by id DESC" is one rule in one function
  // — the core's `newestFirst`, which every recency listing in the product now asks.
  const live = liveWork(caches).sort(byUpdatedDesc);
  // Named, never spelled out: the body is dropped here and served by its own
  // read, so the opening context stays one line per pattern.
  const skills = adoptedSkills(caches).map(({ id, name }) => ({ id, name }));
  const work = capped(live);
  // The rule for which decisions govern is NOT here: it is `decisionsInForce`, so
  // the brief that serves that same derivation into a file cannot answer "in force"
  // differently. What the brief does differ in is the trees it asks about — it
  // carries only the one that travels, and it filters its own sources to do it, so
  // this answer keeps every tree the caller can see.
  const decisions = capped(decisionsInForce(caches));
  // ONE list from three machines, and the ordering happens HERE rather than in
  // any half: interleaving by when each item last moved is a property of the
  // composed list, and a half that sorted itself would be asserting an order this
  // line discards. Same comparator the work list uses — "most recently moved
  // first, ties by id DESC" is one rule, so it is one function.
  const awaiting = capped(
    [
      ...tasksAwaitingJudgement(caches),
      ...decisionsAwaitingJudgement(caches),
      ...skillsAwaitingJudgement(caches),
    ].sort(byUpdatedDesc),
  );
  return {
    resume: resume(caches, scope),
    work: work.served,
    workTotal: work.total,
    skills,
    decisions: decisions.served,
    decisionsTotal: decisions.total,
    awaitingJudgement: awaiting.served,
    awaitingJudgementTotal: awaiting.total,
  };
}

/**
 * What one list of an opening context serves, and how many there were — the CUT and
 * the report of it, made in one place so they cannot come to disagree.
 *
 * A cut computed here and a total computed at the call site is how a list starts
 * declaring the wrong number: the total has to be of the list BEFORE the cut, which
 * is a fact only the caller of the cut still holds.
 *
 * ONE function for every list, not one per list. Three lists are cut here — the
 * third arrived without this function changing, which is the point; a `slice` and a
 * `length` written per list is the same rule written that many times, and the
 * failure mode of a rule written twice is that one copy is amended. What the caller
 * still owns is naming the pair (`work`/`workTotal`, `decisions`/`decisionsTotal`,
 * `awaitingJudgement`/`awaitingJudgementTotal`), and a total attached to the wrong
 * list is caught by a fixture where the lists have DIFFERENT totals — "counts each
 * list, and the totals are not each other's" in `bootstrap.test.ts`.
 */
function capped<T>(items: readonly T[]): {
  readonly served: readonly T[];
  readonly total: number;
} {
  return { served: items.slice(0, SERVED_LIMIT), total: items.length };
}

/**
 * Most recently touched first, by the core's {@link newestFirst} — this file names the
 * field the instant lives in and asks nothing else.
 *
 * Taken by the two lists ordered this way — the work items and the mixed awaiting
 * list — so it is stated over the two fields the rule reads rather than over one
 * list's type. A second copy specialized to the other list would be the same
 * sentence twice, and the copies would decide the tie differently the day one of
 * them is amended; that matters more than it looks, because for a CUT list the
 * tie-break decides what is left out.
 *
 * It used to write the rule out here, and said the tie "keeps a stable (id) order" —
 * which was the SIXTH writing of one comparison and, like the other five, broke the
 * tie by id ASCENDING, serving the oldest item of a millisecond at the top of a
 * newest-first list. See `newest-first.ts` for what falsified it.
 */
function byUpdatedDesc(
  a: { readonly id: string; readonly updatedAt: string },
  b: { readonly id: string; readonly updatedAt: string },
): number {
  return newestFirst({ at: a.updatedAt, id: a.id }, { at: b.updatedAt, id: b.id });
}
