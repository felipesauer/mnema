# Windows and macOS

Every pull request runs one job on `windows-latest` and one on `macos-latest`, each on Node 24.15.0 (the floor)
and on the latest 24. The job packs the five packages, installs them together with `npm i -g` into an empty
home (so the launcher is the one npm writes there, `mnema.cmd` on Windows), and drives the installed binary:

- `mnema init`, recording a decision and accepting it, linking a rule that refuses a write at a folder, and
  `mnema verify --require signed`, which must say the record is intact;
- the same record in a clone git checked out with `core.autocrlf=true`: every record file must come out with LF
  (the record's `.gitattributes` says `* -text`), and `mnema verify` and the Python reader (3.9, the floor: its
  self-test and the record) must accept it. That shows the attribute holds the line endings; it does not show that a
  reader accepts CRLF;
- `mnema doctor`;
- two of the plugin's hook scripts, started as Node starts them: `session-start.mjs` must hand over a decision in
  force, and `edit-refuses-a-write.mjs`, with Cursor's arguments (`--host cursor`) and a Cursor payload, must refuse
  a write under a rule, naming that rule (a refusal that says `mnema` could not answer fails the check), when the
  host names the file with backslashes and a drive letter, with forward slashes, with the drive letter in lower
  case, in the 8.3 short spelling of the temp directory (`RUNNER~1`), and, for a folder that exists, in another
  letter case. The same scripts for the other hosts (Claude Code, VS Code, Codex, Copilot) take other arguments and
  payloads, and OpenCode's module and Gemini's extension are separate files: none of those was run.

Not run there: the test suite (about ten minutes on Linux, and it leans on `sh`, a pty and `unshare`, so it runs
on Linux only), the `sh` lines of the plugin's `hooks.json` (a host's shell runs them), the Python reader on any
version but 3.9, and any host itself. A rule addressed at a folder that is not on disk yet is matched by its
letters as written, so on a case-insensitive volume a write that spells that folder in other case goes round it.

Two things were found by that job, and are the reason the lines above are not a guess. Node cannot start npm's
`mnema.cmd` without a shell, so every hook answered `could not be started` on Windows; and a path written with a
drive letter and backslashes never matched a rule's address, so no rule applied to a Windows write at all. Both are
fixed. One limit remains, computed from the names the format gives and not run into: a witnessed record names a
file `tails/<id>/witness/<digest>.sigstore.json`, 190 characters below `.mnema/` (197 with `.mnema\`), and Windows
stops at 260 for a whole path, drive and separators included, so the project folder must fit in about 61 characters.
Past that, `git checkout` or `git clone` can fail with `Filename too long` unless `git config core.longpaths true` is
set, and the Python reader may fail to open the file unless the system's `LongPathsEnabled` is on. The job turns
`core.longpaths` on for the repository's own fixtures, and its record holds no witness, so neither failure is
exercised for the installed product.

On Windows the hooks start `mnema.cmd` through `cmd.exe`, which cannot be given a `"`, a `%`, a `^` or a line break
inside a word. A path of `mnema` (the plugin's `mnema_path`) that has one is not run: the opening is silent, and a
write under a rule that refuses it is refused with a reason that says so.
