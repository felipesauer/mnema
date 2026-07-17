/**
 * Lazy wiring primitives for the service container.
 *
 * Each service is built on first access and memoised; the registry
 * records which pieces have actually been constructed so tests (and
 * diagnostics) can assert that touching one domain does not pay for
 * the others.
 */
export interface LazyRegistry {
  /** Names of the pieces that have been built so far, in build order. */
  readonly built: () => readonly string[];
  /** Wraps a builder: runs once on first call, records `name` when it does. */
  readonly lazy: <T>(name: string, build: () => T) => () => T;
}

/**
 * Creates an isolated registry (one per container instance).
 *
 * @returns A {@link LazyRegistry} whose `lazy` wrapper memoises builders
 */
export function createLazyRegistry(): LazyRegistry {
  const built: string[] = [];
  return {
    built: () => [...built],
    lazy: <T>(name: string, build: () => T): (() => T) => {
      let value: T;
      let has = false;
      return () => {
        if (!has) {
          value = build();
          has = true;
          built.push(name);
        }
        return value;
      };
    },
  };
}
