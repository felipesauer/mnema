/**
 * The `mnema key` wiring: what it declares, and what it prints.
 *
 * `key` is a group, and the only one whose subject is not the record but the
 * machine's key material: `restore` brings a key back onto a machine, and
 * `request`/`enroll`/`revoke` operate the identity's roster — the three steps of
 * putting a second machine on one identity, and taking a key back out.
 *
 * The split across machines is not cosmetic: `request` runs where the key wants
 * IN and needs no project, while `enroll` and `revoke` run on a machine that is
 * already a member and write to the committed tree. Membership is granted by a
 * member's signature, so no machine can admit itself.
 */

import type { Command } from 'commander';
import { fact } from '../presentation/detail.js';
import { RECORD_CONTRACT_HELP } from '../recorded-content.js';
import { here } from './context.js';
import { reportRefusal, reportReplacement } from './report.js';
import type { Wiring } from './verb.js';

/** Registers `mnema key` on the program. */
export function registerKey(program: Command, wiring: Wiring): void {
  const { io, render } = wiring;
  const key = program.command('key').description("manage this machine's signing keys");

  // `mnema key restore <file>` — install a key from a copy of its private half and
  // adopt, in this project, the identity the record proves it belongs to. The file
  // is a POSITIONAL: it is the whole subject of the command and competes with
  // nothing. It is READ, never moved or consumed — the output says so, because this
  // is the moment a person would think the copy has done its job and delete it.
  key
    .command('restore')
    .description("restore this machine's identity from a copy of a key's private half")
    .argument('<file>', 'the PEM file holding the private half (your backup copy)')
    .action(async (file: string) => {
      const { runKeyRestore } = await import('../commands/key-restore.js');
      const result = runKeyRestore(here(), { privateKeyPath: file });
      if (result.ok) {
        io.out(`Restored key ${result.fingerprint}`);
        io.out(
          render(
            fact(
              `identity: ${result.anchor}` +
                `${result.membership === 'founded' ? ' (this project was founded by this key)' : ' (this project enrolled this key)'}`,
            ),
          ),
        );
        io.out(render(fact(`private half installed at ${result.installedAt}`)));
        io.out(render(fact(`Your copy at ${file} was read, not moved — keep it where it is.`)));
        return;
      }
      // A recovery names ITSELF rather than `mnema init`: a machine bringing a key
      // back is not a machine founding a project, and telling it to found one is
      // telling it to start a second identity.
      reportRefusal(wiring, result, {
        NO_PROJECT: 'No mnema project here. Run `mnema key restore` inside the project to recover.',
      });
    });

  // `mnema key request --anchor <id> [--key <file>]` — on the machine that wants
  // in. The anchor is a REQUIRED flag, not a positional: it is not the subject of
  // the command (the subject is this machine's key), and it is a value the person
  // pastes from elsewhere, so naming it keeps a mis-paste from reading as a path.
  // `--key` points at a private key to speak for INSTEAD of this machine's own —
  // the way out of a machine that already minted the wrong key.
  key
    .command('request')
    .description('ask to bring this machine into an identity (run this on the joining machine)')
    .requiredOption(
      '--anchor <id>',
      'the identity to join (the `mnid:…` its machine prints) — a prefix of one this ' +
        'record knows also names it; the request is signed over the whole value either way',
    )
    .option('--key <file>', "a private key to speak for instead of this machine's own")
    .action(async (opts: { anchor: string; key?: string }) => {
      const { runKeyRequest } = await import('../commands/key-request.js');
      const result = runKeyRequest(here(), {
        anchor: opts.anchor,
        ...(opts.key !== undefined ? { privateKeyPath: opts.key } : {}),
      });
      if (!result.ok) {
        reportRefusal(wiring, result);
        return;
      }
      if (result.minted) {
        io.out(`Created this machine's key ${result.fingerprint}`);
      } else {
        io.out(
          `Requesting for key ${result.fingerprint}` +
            `${result.source === 'file' ? ' (read from the file you named, not installed)' : ''}`,
        );
      }
      io.out(render(fact(`to join ${result.anchor}`)));
      // The request itself, alone on its line so it can be selected and pasted.
      io.out('');
      io.out(result.request);
      io.out('');
      io.out(render(fact('Hand that line to a machine already in that identity, which runs:')));
      io.out(render(fact('mnema key enroll <the line>', 2)));
      io.out(render(fact('It proves consent to join that ONE identity and is not a secret.')));
    });

  // `mnema key enroll <request>` — on a machine that is already a member. The
  // request is a POSITIONAL: it is the whole subject of the command. It is long,
  // which is exactly why it is not typed but pasted.
  key
    .command('enroll')
    .description('vouch for a requesting key so it joins this identity (run this on a member)')
    .argument('<request>', 'the line `mnema key request` printed on the joining machine')
    .action(async (request: string) => {
      const { runKeyEnroll } = await import('../commands/key-enroll.js');
      const result = runKeyEnroll(here(), { request });
      if (result.ok) {
        if (result.alreadyMember) {
          io.out(`Key ${result.fingerprint} is already in ${result.anchor} — nothing recorded.`);
          return;
        }
        io.out(`Enrolled key ${result.fingerprint}`);
        io.out(render(fact(`into ${result.anchor}`)));
        io.out(render(fact(`recorded in ${result.root}`)));
        io.out(render(fact('Commit and share the record: the other machine joins by reading it.')));
        return;
      }
      reportRefusal(wiring, result, {
        NO_PROJECT:
          'No mnema project here. Run `mnema key enroll` inside the project to record it.',
      });
    });

  // `mnema key revoke <fingerprint> --reason <text>` — retire a key. The
  // fingerprint is a positional (the subject); the reason is a required flag, as
  // every other verb that demands its evidence does. It is the full fingerprint,
  // and it stays whole even though an ANCHOR may now be named by a prefix: an
  // anchor is an identity the record lists, so a prefix resolves against something
  // and an ambiguous one is refused by name — a fingerprint names a physical key,
  // and guessing which key a short value means is not a guess to make about key
  // material.
  key
    .command('revoke')
    .description('retire a key from this identity, from this point forward')
    .argument('<fingerprint>', 'the full fingerprint of the key to retire')
    .requiredOption('--reason <text>', 'why it is being retired (recorded in the fact)')
    .addHelpText('after', RECORD_CONTRACT_HELP)
    .action(async (fingerprint: string, opts: { reason: string }) => {
      const { runKeyRevoke } = await import('../commands/key-revoke.js');
      const result = runKeyRevoke(here(), { fingerprint, reason: opts.reason });
      if (result.ok) {
        io.out(`Revoked key ${result.fingerprint}`);
        reportReplacement(result, io);
        io.out(render(fact(`from ${result.anchor} — ${result.remaining} key(s) left`)));
        if (result.self) {
          // The person just retired the key this machine signs with. Nothing stops
          // it from writing again, and anything it writes now fails verification —
          // so say it plainly, at the only moment it can still be acted on.
          io.out(
            render(fact("That is THIS machine's key: it must not write to this project again.")),
          );
          io.out(
            render(fact('Bring another key in first if this machine is to keep working here.')),
          );
        }
        io.out(
          render(
            fact('Commit and share the record: a retirement others cannot read retires nothing.'),
          ),
        );
        return;
      }
      reportRefusal(wiring, result, {
        NO_PROJECT:
          'No mnema project here. Run `mnema key revoke` inside the project to record it.',
      });
    });
}
