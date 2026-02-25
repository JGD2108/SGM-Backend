#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${REPO_ROOT}/.env"
  set +a
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[yearly-cleanup] node not found in PATH" >&2
  exit 1
fi

BEFORE_YEAR="${CLEANUP_BEFORE_YEAR:-$(date +%Y)}"
SUMMARY_DIR="${CLEANUP_SUMMARY_DIR:-${REPO_ROOT}/logs/yearly-cleanup}"
SUMMARY_FILE="${CLEANUP_SUMMARY_FILE:-${SUMMARY_DIR}/before-${BEFORE_YEAR}.json}"

MODE_FLAG="--execute"
if [[ "${1:-}" == "--dry-run" ]]; then
  MODE_FLAG="--dry-run"
  shift
elif [[ "${1:-}" == "--execute" ]]; then
  shift
fi

EXTRA_ARGS=()
if [[ "${CLEANUP_DELETE_ORPHAN_CLIENTS:-false}" == "true" ]]; then
  EXTRA_ARGS+=("--delete-orphan-clients")
fi

echo "[yearly-cleanup] running ${MODE_FLAG} beforeYear=${BEFORE_YEAR}"

exec node "${REPO_ROOT}/ops/yearly-cleanup.js" \
  "${MODE_FLAG}" \
  --before-year "${BEFORE_YEAR}" \
  --summary-file "${SUMMARY_FILE}" \
  "${EXTRA_ARGS[@]}" \
  "$@"
