#!/usr/bin/env bash
# Installs, from the pins of kit.json: Claude Code (installed/claude), mnema 0.1.4 from npm (mnema-pkg) and the plugin of the commit of the
# tag v0.1.4 (plugin-tag). Holds no token and asks for none. Prints the sha256 of the Claude Code binary it installed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
pin() { node -e "const k=require('./kit.json');console.log($1)"; }
pkg="$(pin 'k.claude_code.package')"; ver="$(pin 'k.claude_code.version')"
mkdir -p installed/claude
npm install --prefix installed/claude --ignore-scripts --no-audit --no-fund --save-exact "$pkg@$ver"
bin="$(pin 'k.claude_code.bin')"
[ "$(HOME="$(mktemp -d)" CLAUDE_CONFIG_DIR="$(mktemp -d)" DISABLE_AUTOUPDATER=1 "$bin" --version | head -n 1 | cut -d' ' -f1)" = "$ver" ] || { echo "claude does not report $ver" >&2; exit 1; }
want="$(pin 'k.claude_code.binary_sha256')"; got="$(sha256sum "$bin" | cut -d' ' -f1)"
[ "$got" = "$want" ] || { echo "binary sha256 $got is not the pinned $want" >&2; exit 1; }
echo "claude $ver binary sha256: $got"
mver="$(pin 'k.mnema.version')"
mkdir -p mnema-pkg
npm install --prefix mnema-pkg --ignore-scripts --no-audit --no-fund --save-exact "@mnema/code@$mver"
[ "$(node mnema-pkg/node_modules/.bin/mnema --version)" = "$mver" ] || { echo "mnema does not report $mver" >&2; exit 1; }
tag="$(pin 'k.mnema.tag')"
clone="${MNEMA_CLONE:-$(cd "$here/../../../mnema" && pwd)}"
rm -rf plugin-tag && mkdir plugin-tag
git -C "$clone" archive "$tag" .claude-plugin plugin plugin-server-only | tar -x -C plugin-tag
echo "tag $tag is commit $(git -C "$clone" rev-parse "$tag^{commit}")" > plugin-tag/COMMIT
echo installed
