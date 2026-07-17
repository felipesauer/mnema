import { ErrorCode, ExitCode, type ExitCodeValue } from '@mnema/core/errors/error-codes.js';
import { printError } from '@mnema/core/errors/error-printer.js';
import type { MnemaError } from '@mnema/core/errors/mnema-error.js';
import { recordError } from '@mnema/core/services/agent/error-log.js';
import { pc } from '@mnema/core/utils/colors.js';

const KNOWN_CODES = new Set<string>(Object.values(ErrorCode));

/**
 * True when a thrown value is a structured {@link MnemaError}. `MnemaError`
 * is a discriminated-union *type* (not a class), so it is recognised
 * structurally: an object whose `kind` is one of the known
 * {@link ErrorCode} values.
 *
 * @param value - The thrown value
 */
export function isMnemaError(value: unknown): value is MnemaError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof (value as { kind: unknown }).kind === 'string' &&
    KNOWN_CODES.has((value as { kind: string }).kind)
  );
}

/**
 * Renders an uncaught error and returns the process exit code, without
 * exiting — kept side-effect-light so it is unit-testable.
 *
 * A structured {@link MnemaError} goes through {@link printError} (its
 * friendly message + mapped exit code). Anything else prints a clean
 * one-line message and {@link ExitCode.Internal}; the raw stack is shown
 * only when `MNEMA_DEBUG` is set, so a normal user never sees one.
 *
 * @param error - The thrown value
 * @param debug - Whether to include the stack (defaults to `MNEMA_DEBUG`)
 * @returns The exit code the process should use
 */
export function reportUncaught(
  error: unknown,
  debug: boolean = process.env.MNEMA_DEBUG !== undefined && process.env.MNEMA_DEBUG !== '',
): ExitCodeValue {
  if (isMnemaError(error)) {
    return printError(error);
  }

  // Only genuinely unexpected crashes reach here (structured MnemaErrors
  // returned above). Persist them to the local, never-transmitted error log
  // so a bug report has something to attach — best-effort, never changes the
  // exit code or masks the error (MNEMA-ADR-46).
  recordError(error);

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${pc.red('error:')} ${message}\n`);
  if (debug && error instanceof Error && error.stack !== undefined) {
    process.stderr.write(`${error.stack}\n`);
  } else {
    process.stderr.write(
      `${pc.dim('hint:')} unexpected internal error — re-run with MNEMA_DEBUG=1 for the stack\n`,
    );
  }
  return ExitCode.Internal;
}

/**
 * Installs process-level `uncaughtException` / `unhandledRejection`
 * handlers so a throw that escapes a command is reported through
 * {@link reportUncaught} and exits with a defined code, instead of Node's
 * default unhandled-rejection stack dump. Expected Commander exits
 * (`--help`, `--version`, bad args) are handled where they occur and do
 * not reach here.
 */
export function installGlobalErrorHandlers(): void {
  const handle = (error: unknown): void => {
    process.exit(reportUncaught(error));
  };
  process.on('uncaughtException', handle);
  process.on('unhandledRejection', handle);
}
