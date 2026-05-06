import pino, { type Logger } from 'pino';

/**
 * Resolves the desired log level from the environment.
 *
 * - `MNEMA_LOG_LEVEL` overrides explicitly when set
 * - `NODE_ENV=test` defaults to `silent`
 * - otherwise `info`
 */
function resolveLevel(): string {
  const explicit = process.env.MNEMA_LOG_LEVEL;
  if (explicit !== undefined && explicit.length > 0) return explicit;
  if (process.env.NODE_ENV === 'test') return 'silent';
  return 'info';
}

/**
 * Project-wide Pino logger.
 *
 * Writes to **stderr** exclusively. The MCP server uses stdout for its
 * JSON-RPC envelope; printing logs to stdout would corrupt the protocol
 * stream and crash the client. Every log path in Mnema must go through
 * this instance.
 */
export const logger: Logger = pino(
  {
    name: 'mnema',
    level: resolveLevel(),
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({ dest: 2, sync: true }),
);
