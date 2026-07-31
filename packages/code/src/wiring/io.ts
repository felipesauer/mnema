/**
 * Where the CLI writes, and how it signals failure.
 *
 * The port is injected so the whole program can be driven in a test without
 * spawning a process or writing to the real streams — which is what lets the
 * golden compare every line the surface produces, in the order the streams would
 * have received them.
 *
 * It is a PORT and not a formatter: nothing here decides what a line says. The
 * shape of a line belongs to `presentation/`, which returns lines and writes
 * none, and the wiring here is what puts them on a stream.
 */

/** Where the CLI writes, and how it signals failure — injected for testing. */
export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Records a non-zero exit intent without killing the process under test. */
  readonly fail: () => void;
}

/** The real streams, and a non-zero exit code on failure. */
export const processIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  fail: () => {
    process.exitCode = 1;
  },
};

/**
 * Writes a report — every line a presentation function returned, in order.
 *
 * Every read that prints for a person goes through this, which is what makes "one
 * line per item" a property of the array a printer builds rather than of how many
 * times a verb remembered to call `out`.
 */
export function writeLines(io: CliIo, lines: readonly string[]): void {
  for (const line of lines) io.out(line);
}
