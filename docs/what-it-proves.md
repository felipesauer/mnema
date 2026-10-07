# What it proves — and what it does not

Being exact about this is what the product is for, so it is the section worth
reading twice. `mnema verify` reads the events and the committed public keys of
a project's trees — no private key, no network — and prints each verdict
verbatim. The surfaces never turn a verdict into a stronger claim than it is.

**What holds.** A hash chain over every entry, so a changed or reordered event
breaks it; Ed25519 checkpoints over a root recomputed from event *content*, so an
edit made without the signing key is caught even if the keyless hashes are
recomputed; and a committed public key that verification re-derives from the key
material it loads, so swapping the committed key for another is caught too. The
verdict names the **level** it reached rather than saying yes or no.

**What does not hold, stated as plainly as the rest.**

| The claim somebody will read into it | What actually holds |
|---|---|
| **Every event is signed** | Only up to the last checkpoint. Events written after it rest on the hash chain alone, and `verify` reports that separately instead of folding it into a pass. |
| **Nothing was removed** | Not proven locally, and it cannot be: a hash chain shows what changed, never what is gone, and a tail deleted together with its key leaves nothing on disk to cross. Committing the record to a git remote is what preserves the files a deletion would take. |
| **The record is who it says it is** | No. A record forged whole — deleted and refounded under a fresh key, with the opposite decision written into it — verifies clean and word for word like an honest one, and the [second reader](verify-without-installing.md) cannot tell them apart either. What would distinguish them is not in the record for any reader to find. Where somebody asked, `verify --against-github` compares the signing keys with the SSH keys the GitHub account each identity named publishes: that says an account publishes the key *today*, not that it was the account's when it signed, and only on github.com's word. |
| **The record is as old as it says** | Only where somebody asked for it. `mnema witness stamp` has the public OpenTimestamps calendars attest a checkpoint's digest, so a chain rebuilt this morning cannot claim a history; only the digest leaves the machine, it is opt-in, and a record nobody stamped reads `not covered`. |
| **A Sigstore signature names the person** | It names an e-mail, not a GitHub login: whoever could sign in with that verified address countersigned the checkpoint (`mnema witness sigstore`). In GitHub Actions it names a workflow of a repository, not a person. It speaks for an identity of the record only where that identity named the same address in a signed, covered fact (`mnema key sigstore`), and `verify --against-sigstore` says whether it did. |
| **A Sigstore bundle dates the checkpoint** | On the word of Sigstore's log: the time is Rekor's clock, signed with Rekor's key in a public log anybody can audit — not the Bitcoin work behind `witness stamp`, which is why it is no witness level and `--require witnessed` does not count it. It dates that checkpoint and every one below it; events written after are counted, not dated. |
| **Whoever holds the e-mail wrote the record** | No. Anybody can countersign the digest of a checkpoint they can compute, which is any checkpoint of a public repository. Without the record's own claim, a bundle dates the checkpoint and says nothing about who wrote it. |
| **Only the digest leaves the machine, with Sigstore too** | Of the record, yes. The identity leaves by design: the e-mail, or the repository and the workflow, goes into a public log that does not forget, and into the committed bundle. In GitHub Actions the act refuses a private repository. |
| **The record does not keep my e-mail** | It keeps its hash: `mnema key sigstore` writes the SHA-256 of the address (`sha256:<hex>`, trimmed and in lower case), never the address. The hash protects the record and nothing else: the committed bundle and Sigstore's public log name the address itself. And it is no secret from somebody who already suspects the address — they hash their guess and compare. |
| **Checking a Sigstore bundle needs the network** | Signing does; reading does not. `verify --against-sigstore` checks against the trust root this binary carries, so a bundle signed after Sigstore turns its keys over reads `not covered` on an older binary — never verified. The [second reader](verify-without-installing.md) names each bundle and does not check it. |
| **A signed and countersigned record is honest** | Whoever holds the key and the e-mail can rebuild the record and countersign it again; the date is then the date of the rebuild, which is what exposes it. Omission stays uncovered, as everywhere else. |
| **A green `verify` means the record is honest** | It means nothing *verifiable* is broken. The default rules on the hash chain, which a crude edit fails and a patient rebuild passes — `--require=signed` catches checkpoints taken out from under the events they signed, and it is one flag, not extra work. It does not catch a cut that took the newest events together with their checkpoint: what is left is a shorter record honest in every byte, and only a copy from before the cut — the history a git remote keeps — shows it was longer. |
| **The gate protects what is recorded** | It protects the *shape* of a change, not its contents, and it is not access control. Anyone who can run the command line writes as this machine's identity. |
| **Only whoever wrote a note can take it back** | Only for a binary from this version on. A retraction signed by another identity is refused when written, not applied when read, and named by `verify` in a census line — but it is a well-formed signed event, and an older binary reading the same record applies it and stops serving the note. |
| **Secrets stay out** | Only the ones mnema recognizes by their format. A value in a known shape never reaches the chain; a proprietary token or a password written out in prose does, and nothing deletes a fact afterwards. It reduces the damage; it does not make the record safe to paste secrets into. |
| **A key that signs only check results can do no harm** | The role narrows what the key can sign, and only that. A leaked checker key can say that any rule's check passed at any commit until somebody retires it (`mnema key revoke --checker <fingerprint> --reason "<why>"`); from the retirement on, `verify` refuses what it signs. What it signed before still verifies — a leaked key can date a result before its own retirement — so `verify` names those results in its census, and the record no longer vouches for them. Keep the key in a secret scoped to the job that runs the checks. |
| **Any version of the tool can read the record** | A binary from before a kind existed stops reading the whole record once that kind is in the committed tree, as it does for any kind it does not know (`packages/chain/FORMAT.md` §4.1). Read a record written by a newer version with a newer binary. |

The pattern underneath all of it: **local cryptography covers alteration; the
history a git remote keeps covers omission and gives the signing key a history
someone else can check; `mnema witness` dates the record.**
[`packages/code/README.md`](../packages/code/README.md) carries the long form of this
table, claim by claim.
