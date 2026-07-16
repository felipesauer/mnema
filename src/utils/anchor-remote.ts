/**
 * Pure validator for the `audit.anchor.remote` config value. Lives in utils/
 * (a leaf) so the config schema can enforce it at load WITHOUT importing the
 * git-signed anchor provider — which pulls in `node:child_process` at module
 * load just to validate a regex. No side effects, no imports.
 */

/**
 * Transport schemes a push remote may safely use. `ext::`/`fd::` and any
 * other remote-helper transport are deliberately absent: `git push
 * 'ext::sh -c <payload>'` runs an ARBITRARY command via git's transport
 * helpers, so a repo-writable config naming such a remote is command
 * execution. Only network/file transports git dereferences without spawning
 * a shell are allowed.
 */
const SAFE_REMOTE_SCHEMES = ['https://', 'ssh://', 'git://', 'file://'];

/**
 * A plain remote NAME (e.g. `origin`, `upstream-2`): a letter, then letters,
 * digits, `.`, `_`, `-`. No scheme, no path, no leading `-` (which git could
 * parse as a flag). A named remote resolves through the repo's own config, so
 * it can never smuggle a transport helper.
 */
const REMOTE_NAME = /^[a-zA-Z][\w.-]*$/;

/**
 * True when `remote` is safe to hand to `git push`: either a plain remote
 * name or a URL on an allowed transport scheme. Everything else — `ext::`,
 * `fd::`, a leading `-`, or any other/unschemed value — is rejected so a
 * remote-helper transport can never reach git. Shared by the config schema
 * (fail closed at load) and the git-signed anchor provider (defence in depth),
 * so a bad value can never slip through one layer.
 *
 * @param remote - The configured push remote
 * @returns Whether it is safe to pass to `git push`
 */
export function isSafeAnchorRemote(remote: string): boolean {
  if (remote.length === 0 || remote.startsWith('-')) return false;
  if (REMOTE_NAME.test(remote)) return true;
  return SAFE_REMOTE_SCHEMES.some((scheme) => remote.startsWith(scheme));
}
