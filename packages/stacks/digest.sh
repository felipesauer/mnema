#!/bin/sh
# The digest of a stack, with no mnema: sh, find, sort and sha256sum (or `shasum -a 256` on macOS). Usage: digest.sh <stack-directory>
# Every file but .git/ and the signature at the root; each as  path NUL sha256(file) LF ; paths in byte order.
H=$(command -v sha256sum >/dev/null && echo sha256sum || echo 'shasum -a 256')
cd "$1" && find . \( -path ./.git -o -path ./stack.sigstore.json \) -prune -o -type f -print | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r f; do printf '%s\0%s\n' "$f" "$($H -- "$f" | cut -d' ' -f1)"; done | $H | cut -d' ' -f1
