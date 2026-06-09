#!/usr/bin/env bash
#
# Records a 60s asciinema of the Mnema quickstart. Produces a .cast
# file that can be hosted on asciinema.org or rendered to SVG via `agg`.
#
# Prerequisites:
#   - `asciinema` installed (https://asciinema.org/docs/installation)
#   - `mnema` on PATH at >= 0.3.0-alpha.1
#   - empty /tmp/mnema-demo/ (or set DEMO_DIR)
#
# Usage:
#   bash scripts/record-quickstart.sh
#   # → produces docs/quickstart.cast (gitignored)
#
# To render an SVG for the README:
#   agg --speed 1.5 docs/quickstart.cast docs/quickstart.svg

set -euo pipefail

DEMO_DIR="${DEMO_DIR:-/tmp/mnema-demo}"
CAST_OUT="${CAST_OUT:-$(pwd)/docs/quickstart.cast}"

if ! command -v asciinema >/dev/null 2>&1; then
  echo "error: asciinema not installed. See https://asciinema.org/docs/installation" >&2
  exit 1
fi
if ! command -v mnema >/dev/null 2>&1; then
  echo "error: mnema not on PATH. Run \`pnpm pack && npm i -g ./saurim-mnema-*.tgz\`" >&2
  exit 1
fi

rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"
cd "$DEMO_DIR"

cat > /tmp/mnema-demo-script.sh <<'DEMO'
#!/usr/bin/env bash
set -e
PS1='$ '

step() {
  echo
  echo "# $1"
  sleep 1.5
}

step "1. Initialize a project"
mnema init --name "Demo" --key DEMO --workflow default
sleep 1.2

step "2. Capture the first task"
mnema task create --title "Add OAuth login"
sleep 1.2

step "3. Drive it through the workflow"
mnema task move DEMO-1 submit title='Add OAuth login' description='Add Google OAuth to the sign-in page' acceptance_criteria='Users authenticate,Token persists' estimate=5
sleep 1.5

step "4. Record an architecture decision"
mnema decision record --title "Use Postgres in prod" --decision "Adopt Postgres for the write-heavy path"
sleep 1.5

step "5. Inspect the audit trail"
mnema audit query --since 5m --limit 5
sleep 2

step "6. Doctor confirms integrity"
mnema doctor | head -10
sleep 3
DEMO
chmod +x /tmp/mnema-demo-script.sh

asciinema rec --title "Mnema quickstart" --idle-time-limit 2 --command /tmp/mnema-demo-script.sh "$CAST_OUT"

echo
echo "✓ Recording saved to $CAST_OUT"
echo "  Upload: asciinema upload $CAST_OUT"
echo "  Render to SVG: agg --speed 1.5 $CAST_OUT ${CAST_OUT%.cast}.svg"
