import { readFileSync } from 'node:fs';
import { ConfigLoader } from '@mnema/core/config/config-loader.js';
import { ErrorCode } from '@mnema/core/errors/error-codes.js';
import { printError } from '@mnema/core/errors/error-printer.js';
import { ProjectSecretService } from '@mnema/core/services/integrity/project-secret.js';
import { pc } from '@mnema/core/utils/colors.js';
import type { Command } from 'commander';
import { resolveProjectRoot } from '../project-root.js';

interface ImportOptions {
  readonly force?: boolean;
}

/**
 * Registers `mnema project`, the command group for project-scoped
 * credentials. Today it manages the per-project HMAC secret
 * (a shareable team credential):
 *
 * - `secret export` prints the current secret as a labelled envelope for
 *   out-of-band transmission to a teammate;
 * - `secret import` installs an envelope received out-of-band, after checking
 *   it matches the committed fingerprint.
 *
 * It resolves the project root and key from the config file WITHOUT opening
 * the SQLite container — like `commit`, it must work on a drifted or
 * un-migrated database, and it only touches the filesystem.
 */
export class ProjectCommand {
  /**
   * Attaches the `project` command group to the root program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const group = program.command('project').description('Manage project-scoped credentials');
    const secret = group.command('secret').description('Manage the per-project HMAC secret');

    secret
      .command('export')
      .description('Print the project HMAC secret as an envelope for out-of-band sharing')
      .action(() => {
        const service = makeService();
        let envelope: string;
        try {
          envelope = service.exportEnvelope();
        } catch (error) {
          process.stderr.write(`${pc.red('error:')} ${(error as Error).message}\n`);
          process.exit(2);
        }
        // The envelope goes to STDOUT alone (pipeable); the sensitivity
        // warning goes to STDERR so it never contaminates a redirect.
        process.stderr.write(
          `${pc.yellow('warning:')} this is SECRET key material. Anyone who holds it can forge ` +
            `authentic-looking project events. Send it over a trusted channel; never commit it or ` +
            `paste it where it is logged. (Per-machine Ed25519 attestation still catches ` +
            `cross-machine forgery.)\n`,
        );
        process.stdout.write(`${envelope}\n`);
      });

    secret
      .command('import [envelope]')
      .description('Install an HMAC secret envelope received out-of-band (reads stdin if omitted)')
      .option('--force', 'Overwrite an existing local secret')
      .action((envelopeArg: string | undefined, options: ImportOptions) => {
        const service = makeService();
        const raw = envelopeArg ?? readStdin();
        if (raw.trim().length === 0) {
          process.stderr.write(
            `${pc.red('error:')} no envelope given — pass it as an argument or on stdin\n`,
          );
          process.exit(2);
        }
        try {
          const decoded = service.parseEnvelope(raw);
          service.install(decoded, { force: options.force === true });
        } catch (error) {
          process.stderr.write(`${pc.red('error:')} ${(error as Error).message}\n`);
          process.exit(2);
        }
        process.stdout.write(
          `${pc.green('✓')} project secret installed ${pc.dim(`(${service.secretPath()})`)}\n`,
        );
      });
  }
}

/**
 * Builds a {@link ProjectSecretService} for the current project, resolving
 * the root and key from the config file without opening the database. Exits
 * with the canonical config-not-found error when run outside a project.
 */
function makeService(): ProjectSecretService {
  const configFile = new ConfigLoader().findConfigFile();
  if (configFile === null) {
    process.exit(printError({ kind: ErrorCode.ConfigNotFound, currentDir: process.cwd() }));
  }
  // load() parses + schema-validates the config and throws on a malformed
  // file; present that as a clean error (exit 2), consistent with the rest of
  // the command, rather than letting a raw stack trace escape.
  let config: ReturnType<ConfigLoader['load']>;
  try {
    config = new ConfigLoader().load();
  } catch (error) {
    process.stderr.write(`${pc.red('error:')} ${(error as Error).message}\n`);
    process.exit(2);
  }
  const projectRoot = resolveProjectRoot(configFile);
  return new ProjectSecretService(projectRoot, config.project.key);
}

/** Reads all of stdin synchronously (for a piped envelope). */
function readStdin(): string {
  // On an interactive terminal with nothing piped, reading fd 0 would BLOCK
  // waiting for the user to type + Ctrl-D. Bail early so `import` with no
  // argument fails fast with the "no envelope given" error instead of hanging.
  if (process.stdin.isTTY === true) return '';
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    // fd 0 closed / redirected from an empty source → treat as empty.
    return '';
  }
}
