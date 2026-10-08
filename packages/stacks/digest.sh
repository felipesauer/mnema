#!/bin/sh
# The digest of a stack, with no mnema: sh, find, sort, sha256sum. Usage: digest.sh <stack-directory>
# Every file but .git/ and the signature at the root; each as  path NUL sha256(file) LF ; paths in byte order.
cd "$1" && find . \( -path ./.git -o -path ./stack.sigstore.json \) -prune -o -type f -print | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r f; do printf '%s\0%s\n' "$f" "$(sha256sum -- "$f" | cut -d' ' -f1)"; done | sha256sum | cut -d' ' -f1
