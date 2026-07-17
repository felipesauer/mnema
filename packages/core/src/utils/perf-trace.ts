/**
 * Lightweight phase timer enabled by `DEBUG_PERF=1`.
 *
 * Used to break down where the CLI spends time on cold-start commands.
 * In normal runs the calls are no-ops and have negligible cost.
 *
 * Usage:
 *   const t = perfTrace('task move');
 *   t.mark('config loaded');
 *   ...
 *   t.mark('container built');
 *   ...
 *   t.end();
 */

const enabled = process.env.DEBUG_PERF === '1';

interface PerfTrace {
  mark(label: string): void;
  end(): void;
}

class NoopTrace implements PerfTrace {
  mark(): void {}
  end(): void {}
}

class RealTrace implements PerfTrace {
  private readonly start: number;
  private last: number;
  private readonly name: string;
  private readonly events: Array<{ readonly label: string; readonly delta: number }> = [];

  constructor(name: string) {
    this.name = name;
    this.start = performance.now();
    this.last = this.start;
  }

  mark(label: string): void {
    const now = performance.now();
    this.events.push({ label, delta: now - this.last });
    this.last = now;
  }

  end(): void {
    const total = performance.now() - this.start;
    process.stderr.write(`[perf] ${this.name}\n`);
    for (const event of this.events) {
      process.stderr.write(
        `[perf]   ${event.label.padEnd(28)} ${event.delta.toFixed(0).padStart(5)}ms\n`,
      );
    }
    process.stderr.write(`[perf]   ${'TOTAL'.padEnd(28)} ${total.toFixed(0).padStart(5)}ms\n`);
  }
}

const NOOP = new NoopTrace();

export function perfTrace(name: string): PerfTrace {
  return enabled ? new RealTrace(name) : NOOP;
}
