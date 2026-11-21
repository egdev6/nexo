#!/usr/bin/env bash
# Runs the full local verification and keeps complete logs so a failing test
# is always reported by name, including intermittent failures.
#
# Usage:
#   scripts/check.sh                 Linux checks + frontend
#   scripts/check.sh --windows       also native Windows tests and clippy (WSL)
#   scripts/check.sh --repeat N      run the Rust workspace tests N times and
#                                    count failures per test name (flake hunt)
#
# Logs: target/check-logs/<timestamp>/ (one file per step, plus failures.txt).
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
windows=0
repeat=0
while [ $# -gt 0 ]; do
  case "$1" in
    --windows) windows=1 ;;
    --repeat) repeat="${2:?--repeat needs a count}"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

logs="$root/target/check-logs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$logs"
failures="$logs/failures.txt"
: > "$failures"
status=0

# Names of failed Rust tests from a full (non -q) cargo test log.
rust_failures() {
  grep -E '^test .+ \.\.\. FAILED$' "$1" | sed -E 's/^test (.+) \.\.\. FAILED$/\1/' | sort -u
}

# Panic messages and captured output for each failed Rust test.
rust_details() {
  awk '/^---- .* stdout ----$/{show=1} /^failures:$/{if(show)exit} show' "$1"
}

step() {
  local name="$1"; shift
  local log="$logs/$name.log"
  if "$@" > "$log" 2>&1; then
    echo "ok    $name"
  else
    echo "FAIL  $name (log: $log)"
    status=1
    return 1
  fi
}

report_rust() {
  local name="$1" log="$logs/$1.log"
  local names
  names="$(rust_failures "$log")"
  if [ -n "$names" ]; then
    { echo "## $name"; echo "$names"; echo; rust_details "$log"; echo; } >> "$failures"
    echo "$names" | sed 's/^/      failed: /'
  fi
}

if [ "$repeat" -gt 0 ]; then
  declare -A count=()
  cargo test --workspace --locked --no-run > "$logs/build.log" 2>&1 || { echo "build failed: $logs/build.log"; exit 1; }
  for i in $(seq 1 "$repeat"); do
    log="$logs/run-$i.log"
    if ! cargo test --workspace --locked --no-fail-fast > "$log" 2>&1; then
      while read -r t; do
        [ -n "$t" ] || continue
        count[$t]=$(( ${count[$t]:-0} + 1 ))
        { echo "## run $i: $t"; rust_details "$log"; echo; } >> "$failures"
      done <<< "$(rust_failures "$log")"
    else
      rm -f "$log"
    fi
  done
  if [ "${#count[@]}" -eq 0 ]; then
    echo "no failures in $repeat runs"
    exit 0
  fi
  echo "failures in $repeat runs:"
  for t in "${!count[@]}"; do echo "  ${count[$t]}x $t"; done | sort -rn
  echo "details: $failures"
  exit 1
fi

step fmt cargo fmt --all -- --check
step clippy cargo clippy --workspace --all-targets --locked -- -D warnings
step rust-linux cargo test --workspace --locked --no-fail-fast || report_rust rust-linux

if [ "$windows" -eq 1 ]; then
  manifest="$(wslpath -w "$root/Cargo.toml")"
  target="$(wslpath -w "$root/target/windows-ws")"
  step rust-windows powershell.exe -NoProfile -NonInteractive -Command \
    "\$env:CARGO_INCREMENTAL='0'; & cargo.exe test --manifest-path '$manifest' --target-dir '$target' --workspace --locked --no-fail-fast; exit \$LASTEXITCODE" \
    || report_rust rust-windows
  step clippy-windows powershell.exe -NoProfile -NonInteractive -Command \
    "\$env:CARGO_INCREMENTAL='0'; & cargo.exe clippy --manifest-path '$manifest' --target-dir '$target' --workspace --all-targets --locked -- -D warnings; exit \$LASTEXITCODE"
fi

(
  cd apps/hub || exit 1
  export npm_config_update_notifier=false
  step biome npx biome ci
  step tsc npx tsc --noEmit
  step ds-doctor npm run -s ds:doctor
  # --configLoader runner avoids writing node_modules/.vite-temp, so parallel runs do not collide.
  if ! step vitest npx vitest run --configLoader runner --reporter=verbose; then
    { echo "## vitest"; grep -E '^\s*(×|FAIL)' "$logs/vitest.log" | sort -u; echo; } >> "$failures"
    grep -E '^\s*(×|FAIL)' "$logs/vitest.log" | sort -u | sed 's/^/      failed: /'
  fi
  step build npm run build
  exit $status
) || status=1

step diff-check git diff --check

if [ "$status" -eq 0 ]; then
  echo "all checks passed (logs: $logs)"
else
  echo "checks failed; failing tests and output: $failures"
fi
exit "$status"
