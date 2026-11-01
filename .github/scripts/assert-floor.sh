#!/usr/bin/env bash
# Usage: assert-floor.sh <script output file> <minimum passing checks>
# Fails when the script reported fewer passing checks than the floor, so a
# check that is deleted or stops running cannot leave the job green.
set -euo pipefail
passed=$(grep -oE '([0-9]+) passed' "$1" | tail -1 | grep -oE '[0-9]+' || true)
echo "$1: ${passed:-0} passing checks (floor: $2)"
if [ -z "$passed" ] || [ "$passed" -lt "$2" ]; then
  echo "::error::$1 reported ${passed:-0} passing checks, expected at least $2"
  exit 1
fi
