import type { StateMachine } from '../domain/state-machine/state-machine.js';
import type { DependencyService } from './dependency-service.js';
import type { IdentityService } from './identity-service.js';
import type { TaskService } from './task-service.js';

/** A compact, re-pullable answer to "what am I doing right now". */
export interface Focus {
  /** A single actionable line, ready to drop into a reminder. */
  readonly line: string;
  /** The task the actor should be on, if any. */
  readonly activeTask: { readonly key: string; readonly title: string } | null;
  /** The highest-priority ready task, when nothing is in progress. */
  readonly nextTask: { readonly key: string; readonly title: string } | null;
  /** Machine-readable disposition, mirroring context_bootstrap.next_action. */
  readonly focus: 'resume' | 'start' | 'idle';
  /**
   * Whether `activeTask` is assigned to the querying actor (vs. a fallback to
   * ANY actor's in-progress task). The generic focus line resumes whatever is
   * in progress, but an authorization gate like `mnema guard` must not pass on
   * someone else's task — it reads this to scope the pass to the actor's own.
   */
  readonly activeIsMine: boolean;
}

/**
 * Reconstructs the current focus for a session, condensed to one line.
 *
 * `context_bootstrap` answers this once at session start, but a long
 * session drifts: the agent forgets it has a task open, or which one.
 * Mnema cannot push a reminder into the client, so instead it makes focus
 * cheap to re-pull at any point — a `focus` MCP tool and `mnema focus`
 * both return this. A client can wire the CLI into a periodic or
 * pre-edit reminder; the cadence is the client's to choose.
 *
 * The rule matches `next_action`: resume an in-progress task before
 * starting new work, else point at the top ready task, else idle. The
 * untracked-work signal the report asks for (files edited without a task)
 * is deferred to drift detection and simply omitted until it exists —
 * the line stays correct, just quieter.
 */
export class FocusService {
  constructor(
    private readonly tasks: TaskService,
    private readonly dependencies: DependencyService,
    private readonly identity: IdentityService,
    private readonly stateMachine: StateMachine,
  ) {}

  /**
   * Builds the current focus.
   *
   * @param actorHandle - Handle to scope in-progress work to; defaults to
   *   the configured default actor. Falls back to any in-progress task
   *   when none is assigned to this actor.
   * @returns The {@link Focus}
   */
  current(actorHandle?: string): Focus {
    const handle = actorHandle ?? this.identity.getDefaultActor();
    const all = this.tasks.list();

    // In-progress state name varies by workflow (IN_PROGRESS / DOING).
    const inProgressStateName =
      ['IN_PROGRESS', 'DOING'].find((s) => this.stateMachine.getWorkflow().states.includes(s)) ??
      null;
    const inProgress =
      inProgressStateName === null ? [] : all.filter((t) => t.state === inProgressStateName);

    const myActorId = handle === null ? null : this.identity.findActorIdByHandle(handle);
    const mine = inProgress.filter((t) => t.assigneeId !== null && t.assigneeId === myActorId);
    const ownActive = mine[0];
    const active = ownActive ?? inProgress[0];

    if (active !== undefined) {
      return {
        focus: 'resume',
        activeTask: { key: active.key, title: active.title },
        nextTask: null,
        activeIsMine: ownActive !== undefined,
        line: `active: ${active.key} (${active.title}) — resume it; finish before starting new work`,
      };
    }

    const readyResult = this.dependencies.ready();
    const ready = readyResult.ok ? readyResult.value : [];
    const top = [...ready].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))[0];
    if (top !== undefined) {
      return {
        focus: 'start',
        activeTask: null,
        nextTask: { key: top.key, title: top.title },
        activeIsMine: false,
        line: `no task in progress — next: task_start ${top.key} (${top.title})`,
      };
    }

    return {
      focus: 'idle',
      activeTask: null,
      nextTask: null,
      activeIsMine: false,
      line: 'no task in progress and nothing ready — plan work or submit a DRAFT',
    };
  }
}
