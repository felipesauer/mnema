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
  /**
   * Everything on the standard input, for the one verb a host feeds a payload to
   * (`before-a-write`). Absent is empty — the in-process harness has no input to give, and a
   * verb that read the real stream there would wait on a pipe its test runner never closes
   * (it did: the suite hung on the first run of that verb in process).
   */
  readonly input?: () => Promise<string>;
}

/** The real streams, and a non-zero exit code on failure. */
export const processIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  fail: () => {
    process.exitCode = 1;
  },
  input: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString('utf-8');
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
