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
import { onOneLine } from './on-one-line.js';
import { reportRefusal, reportReplacement } from './report.js';
import { type Declared, mutatesTheRecord, type Wiring } from './verb.js';

/** Registers `mnema key` on the program. */
export function registerKey(program: Command, wiring: Wiring): Declared {
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
        // Two PATHS, and the second one is the positional this verb was handed: it is
        // echoed back to say the copy was not consumed, so it reaches the line exactly
        // as it was typed (see {@link onOneLine}). The fingerprint and the anchor above
        // are hex and `mnid:` — neither can hold a break.
        io.out(render(fact(onOneLine`private half installed at ${result.installedAt}`)));
        io.out(
          render(fact(onOneLine`Your copy at ${file} was read, not moved — keep it where it is.`)),
        );
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
    .option(
      '--checker',
      "ask to sign check results only, under this key's own identity, instead of joining " +
        '(for the machine that runs `mnema check run`, such as a CI runner)',
    )
    .action(async (opts: { anchor: string; key?: string; checker?: boolean }) => {
      const { runKeyRequest } = await import('../commands/key-request.js');
      const asChecker = opts.checker === true;
      const result = runKeyRequest(here(), {
        anchor: opts.anchor,
        ...(opts.key !== undefined ? { privateKeyPath: opts.key } : {}),
        ...(asChecker ? { asChecker: true } : {}),
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
      io.out(
        render(
          fact(
            asChecker
              ? `to sign check results, vouched for by ${result.anchor}`
              : `to join ${result.anchor}`,
          ),
        ),
      );
      // The request itself, alone on its line so it can be selected and pasted.
      io.out('');
      io.out(result.request);
      io.out('');
      io.out(render(fact('Hand that line to a machine already in that identity, which runs:')));
      io.out(
        render(
          fact(
            asChecker ? 'mnema key enroll --checker <the line>' : 'mnema key enroll <the line>',
            2,
          ),
        ),
      );
      io.out(
        render(
          fact(
            asChecker
              ? 'It proves consent to check for that ONE identity and is not a secret. The key is.'
              : 'It proves consent to join that ONE identity and is not a secret.',
          ),
        ),
      );
    });

  // `mnema key enroll <request>` — on a machine that is already a member. The
  // request is a POSITIONAL: it is the whole subject of the command. It is long,
  // which is exactly why it is not typed but pasted.
  key
    .command('enroll')
    .description('vouch for a requesting key so it joins this identity (run this on a member)')
    .argument('<request>', 'the line `mnema key request` printed on the joining machine')
    .option(
      '--checker',
      'enroll a key that signs check results only (the line `mnema key request --checker --anchor <id>` printed)',
    )
    .action(async (request: string, opts: { checker?: boolean }) => {
      if (opts.checker === true) {
        const { runCheckerEnroll } = await import('../commands/key-enroll.js');
        const result = runCheckerEnroll(here(), { request });
        if (result.ok) {
          if (result.alreadyChecker) {
            io.out(`Key ${result.fingerprint} is already a checker — nothing recorded.`);
            return;
          }
          io.out(`Enrolled checker ${result.fingerprint}`);
          io.out(render(fact(`it signs check results only, as ${result.checker}`)));
          io.out(render(fact(`vouched for by ${result.vouchedBy}`)));
          io.out(render(fact(onOneLine`recorded in ${result.root}`)));
          io.out(
            render(fact('Commit and share the record: the runner reads it to know it may sign.')),
          );
          return;
        }
        reportRefusal(wiring, result, {
          NO_PROJECT:
            'No mnema project here. Run `mnema key enroll` inside the project to record it.',
        });
        return;
      }
      const { runKeyEnroll } = await import('../commands/key-enroll.js');
      const result = runKeyEnroll(here(), { request });
      if (result.ok) {
        if (result.alreadyMember) {
          io.out(`Key ${result.fingerprint} is already in ${result.anchor} — nothing recorded.`);
          return;
        }
        io.out(`Enrolled key ${result.fingerprint}`);
        io.out(render(fact(`into ${result.anchor}`)));
        // The project ROOT, discovered from the cwd — the same value `init` prints, and
        // the same reason it is collapsed there (see {@link onOneLine}).
        io.out(render(fact(onOneLine`recorded in ${result.root}`)));
        io.out(render(fact('Commit and share the record: the other machine joins by reading it.')));
        return;
      }
      reportRefusal(wiring, result, {
        NO_PROJECT:
          'No mnema project here. Run `mnema key enroll` inside the project to record it.',
      });
    });

  // `mnema key github <name>` — this identity names its GitHub account. A signed claim and
  // nothing else: no network is asked here; `verify --against-github` asks github.com later.
  key
    .command('github')
    .description(
      'record that this identity is a GitHub account, so `mnema verify --against-github` ' +
        'can compare the keys that signed with the keys that account publishes',
    )
    .argument('<name>', 'the GitHub account name')
    .action(async (name: string) => {
      const { runKeyGithub } = await import('../commands/key-github.js');
      const result = runKeyGithub(here(), { account: name });
      if (result.ok) {
        io.out(onOneLine`Linked ${result.anchor} to github.com/${result.account}`);
        reportReplacement(result, io);
        io.out(
          render(
            fact(
              'A claim, signed: `mnema verify --against-github` compares it with the keys the ' +
                'account publishes.',
            ),
          ),
        );
        io.out(
          render(fact('Commit and share the record: a claim others cannot read says nothing.')),
        );
        return;
      }
      reportRefusal(wiring, result, {
        NO_PROJECT:
          'No mnema project here. Run `mnema key github` inside the project to record it.',
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
        if (result.self && result.keyFile !== undefined) {
          // The person just retired the key this machine signs with, and this checkout goes on
          // recording the identity it left. THIS SAID "anything it writes as that identity fails
          // verification", and it was true while nothing read a recorded anchor again: the write
          // exited 0 and left the whole record failing `verify` for good. Every write asks now
          // whether the identity a checkout recorded still counts its key, and refuses when it
          // does not (the core's `ensureFounded`), so the sentence says the refusal.
          //
          // AND IT SAID "what it writes here is refused", which is more than the refusal is. The
          // retirement is recorded in the public tree alone (`key-revoke.ts`), and each tree asks
          // its own roster, so a `--scope private` write from this checkout lands — measured on
          // the binary. So the sentence names the public tree, as `init` does where it says the
          // same refusal; `the-refusal-names-the-way-out.test.ts` runs both writes.
          io.out(
            render(
              fact(
                "That is THIS machine's key: this checkout still records the identity it left, " +
                  'so what it writes to the public tree here is refused until it records another.',
              ),
            ),
          );
          // Where the record still proves the key in one other identity, a restore points the
          // checkout there — the way out of an identity whose only key this was, which the
          // refusal of a fresh clone hands over and `the-refusal-names-the-way-out.test.ts`
          // follows to the letter.
          //
          // Where it proves none, or more than one, THIS SAID "it must not write to this project
          // again" and "Bring another key in first", and the record it read is the copy this
          // checkout holds: a checkout that had not pulled the other identity's enrollment of the
          // key was told there was nothing, while a pull and the same restore made it write as
          // that identity — measured on the binary, and followed to the letter in
          // `the-checkout-a-key-left.test.ts`. So it says the pull, and the file either way.
          io.out(
            render(
              fact(
                result.stillMemberOf !== undefined
                  ? `The record proves the key a member of ${result.stillMemberOf}: ` +
                      '`mnema key restore "<the key file>"` here makes this checkout write as it.'
                  : 'The record this checkout holds proves the key a member of no single other ' +
                      'identity: if the record, once pulled, proves it a member of one, ' +
                      '`mnema key restore "<the key file>"` here makes this checkout write as it.',
              ),
            ),
          );
          // Loaded here, on the one path that says it, so every other command's floor does not
          // grow an edge for a line only a revocation of this machine's own key prints.
          const { keyFileLine } = await import('../key-file.js');
          io.out(render(fact(keyFileLine(result.keyFile, here().env.mnemaHome))));
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
  // `mnema key protect` / `unprotect` — put a passphrase on this machine's private keys at
  // rest, or take it off. The passphrase is `MNEMA_KEY_PASSPHRASE`, read where signing reads
  // it (`commands/key-protect.ts` says why it is not a flag). These touch key files and no
  // record, and sit under the group's `mutatesTheRecord` declaration as `key restore` does.
  key
    .command('protect')
    .description(
      "encrypt this machine's private keys at rest with the passphrase in MNEMA_KEY_PASSPHRASE",
    )
    .action(async () => {
      const { runKeyProtect } = await import('../commands/key-protect.js');
      reportKeyFiles(runKeyProtect(here()), 'Protected');
    });

  key
    .command('unprotect')
    .description("write this machine's private keys back in the clear (needs MNEMA_KEY_PASSPHRASE)")
    .action(async () => {
      const { runKeyUnprotect } = await import('../commands/key-protect.js');
      reportKeyFiles(runKeyUnprotect(here()), 'Unprotected');
    });

  /** What the two verbs print: the files that changed, the ones that already were, and the rest. */
  function reportKeyFiles(
    result: ReturnType<typeof import('../commands/key-protect.js').runKeyProtect>,
    did: 'Protected' | 'Unprotected',
  ): void {
    if (!result.ok) {
      reportRefusal(wiring, result);
      return;
    }
    const changed = result.files.filter((one) => one.changed);
    if (result.files.length === 0) {
      io.out('This machine holds no private key.');
      return;
    }
    io.out(`${did} ${changed.length} of ${result.files.length} private key file(s)`);
    for (const file of result.files) {
      io.out(
        render(fact(onOneLine`${file.changed ? did.toLowerCase() : 'unchanged'} ${file.path}`)),
      );
    }
    if (did === 'Protected' && changed.length > 0) {
      io.out(
        render(
          fact(
            'Anything that signs now needs MNEMA_KEY_PASSPHRASE set to the same passphrase: this shell, the host an agent runs in, a hook. The record and its verification are as they were.',
          ),
        ),
      );
    }
  }

  return mutatesTheRecord(key);
}
