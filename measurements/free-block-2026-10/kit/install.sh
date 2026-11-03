#!/usr/bin/env bash
# Installs, from the pins of kit.json, the four hosts (each in a folder of its own under installed/), mnema from npm
# (mnema-pkg/) and the plugin of the commit of mnema's tag (plugin-tag/). Needs the main clone of mnema beside this
# kit's repository, for `git archive` of the tag only. Holds no key and asks for none.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
pin() { node -e "const k=require('./kit.json');console.log($1)"; }
for host in codex copilot opencode qwen; do
  pkg="$(pin "k.hosts.$host.package")"; ver="$(pin "k.hosts.$host.version")"
  mkdir -p "installed/$host"
  npm install --prefix "installed/$host" --ignore-scripts --no-audit --no-fund --save-exact "$pkg@$ver"
  bin="$(pin "k.hosts.$host.bin")"
  [ -x "$bin" ] || { echo "no executable at $bin" >&2; exit 1; }
done
mnema_ver="$(pin 'k.mnema.version')"
mkdir -p mnema-pkg
npm install --prefix mnema-pkg --ignore-scripts --no-audit --no-fund --save-exact "@mnema/code@$mnema_ver"
[ "$(node mnema-pkg/node_modules/.bin/mnema --version)" = "$mnema_ver" ] || { echo "mnema does not report $mnema_ver" >&2; exit 1; }
tag="$(pin 'k.mnema.tag')"
clone="${MNEMA_CLONE:-$(cd "$here/../../../mnema" && pwd)}"
rm -rf plugin-tag && mkdir plugin-tag
git -C "$clone" archive "$tag" .claude-plugin plugin plugin-server-only | tar -x -C plugin-tag
echo "tag $tag is commit $(git -C "$clone" rev-parse "$tag^{commit}")" > plugin-tag/COMMIT
echo installed
