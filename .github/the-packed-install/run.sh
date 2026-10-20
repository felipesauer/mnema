#!/usr/bin/env bash
# Packs the publishable packages, installs them TOGETHER into an empty prefix the way the release
# notes tell a person to, and drives the installed binary through `init`, `decision record` and
# `verify` in a project and a HOME that are empty. It needs the workspace built (`pnpm build`)
# and it touches nothing outside the temporary directory it makes.
#
# WHY IT IS A SCRIPT AND NOT A TEST. Every test of the suite runs the workspace's own `dist`, with
# its own `node_modules`: a package missing from the tarballs, a file `files` leaves out, a
# dependency declared as `workspace:*` that never became a version, all resolve there. Only a
# package installed from what `pnpm pack` made, with nothing of the workspace beside it, finds them.
#
# Usage: run.sh            (from the root of the workspace)
set -euo pipefail

root="$(pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

failed=0
fail() {
  echo "FAIL: $1"
  failed=1
}

# The publishable packages are the ones of `packages/*` that are not private.
mapfile -t dirs < <(node -e '
  const fs = require("node:fs");
  for (const d of fs.readdirSync("packages").sort()) {
    const p = `packages/${d}/package.json`;
    if (!fs.existsSync(p)) continue;
    if (!JSON.parse(fs.readFileSync(p, "utf8")).private) console.log(`packages/${d}`);
  }')
echo "publishable: ${dirs[*]}"
if [ "${#dirs[@]}" -ne 5 ]; then
  fail "expected five publishable packages, found ${#dirs[@]}"
fi

mkdir "$work/tarballs"
for dir in "${dirs[@]}"; do
  (cd "$dir" && pnpm pack --pack-destination "$work/tarballs" >/dev/null) || fail "could not pack $dir"
done
tarballs=("$work"/tarballs/*.tgz)
# A source map in a tarball points at sources the package does not ship.
for tarball in "${tarballs[@]}"; do
  maps="$(tar -tzf "$tarball" | grep -c '\.map$' || true)"
  [ "$maps" -eq 0 ] || fail "$(basename "$tarball") carries $maps source map file(s)"
done
echo "packed: $(basename -a "${tarballs[@]}" | tr '\n' ' ')"
[ "${#tarballs[@]}" -eq "${#dirs[@]}" ] || fail "packed ${#tarballs[@]} tarballs for ${#dirs[@]} packages"

# An empty HOME, an empty global prefix and a cache of their own: nothing of the workspace or of the
# runner is visible to the install or to the binary after it.
home="$work/home"
prefix="$work/prefix"
mkdir "$home" "$prefix"
base_env=(env -i HOME="$home" PATH="$prefix/bin:$PATH" npm_config_cache="$work/npm-cache")

"${base_env[@]}" npm i -g --prefix "$prefix" --no-audit --no-fund "${tarballs[@]}" >"$work/install.log" 2>&1 ||
  {
    cat "$work/install.log"
    fail "npm i -g of the tarballs together failed"
    # Past this point a `mnema` found on the PATH would be some other install, not the one tested.
    exit 1
  }

want="$(node -p 'require("./packages/code/package.json").version')"
got="$("${base_env[@]}" mnema --version 2>&1)" || true
[ "$got" = "$want" ] || fail "the installed binary says '$got', the package is $want"

project="$work/project"
mkdir "$project"
cd "$project" || exit 1

run() {
  echo "\$ mnema $*"
  local status=0
  "${base_env[@]}" mnema "$@" >"$work/out.txt" 2>&1 || status=$?
  cat "$work/out.txt"
  [ "$status" -eq 0 ] || fail "mnema $1 exited $status"
}

run init
run decision record "Keep money as integer cents" "Float sums drift; cents are exact."
run verify
grep -q "local integrity verified" "$work/out.txt" || fail "verify did not say the record is intact"

cd "$root" || exit 1
exit "$failed"
