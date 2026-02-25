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

MODE_FLAG="--dry-run"
if [[ "${1:-}" == "--execute" ]]; then
  MODE_FLAG="--execute"
  shift
elif [[ "${1:-}" == "--dry-run" ]]; then
  shift
fi

BEFORE_YEAR="${CLEANUP_BEFORE_YEAR:-$(date +%Y)}"
DELETE_ORPHAN="${CLEANUP_DELETE_ORPHAN_CLIENTS:-false}"
EXECUTION_MODE="${CLEANUP_EXECUTION_MODE:-auto}"   # auto | docker | host
CONTAINER_NAME="${CLEANUP_CONTAINER_NAME:-sgm_api}"
CONTAINER_WORKDIR="${CLEANUP_CONTAINER_WORKDIR:-}"

echo "[yearly-cleanup] requested mode=${MODE_FLAG} beforeYear=${BEFORE_YEAR}"
echo "[yearly-cleanup] execution mode=${EXECUTION_MODE}"

docker_container_running() {
  command -v docker >/dev/null 2>&1 || return 1
  docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

run_in_docker() {
  local workdir="${CONTAINER_WORKDIR}"
  local npm_script="ops:cleanup:yearly:dry-run"
  if [[ "${MODE_FLAG}" == "--execute" ]]; then
    npm_script="ops:cleanup:yearly"
  fi
  if [[ -z "${workdir}" ]]; then
    workdir="$(docker inspect --format '{{.Config.WorkingDir}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
    workdir="${workdir:-/app}"
  fi

  echo "[yearly-cleanup] running inside docker container=${CONTAINER_NAME} workdir=${workdir} script=${npm_script}"
  exec docker exec \
    -w "${workdir}" \
    -e CLEANUP_BEFORE_YEAR="${BEFORE_YEAR}" \
    -e CLEANUP_DELETE_ORPHAN_CLIENTS="${DELETE_ORPHAN}" \
    "${CONTAINER_NAME}" \
    npm run "${npm_script}" -- "$@"
}

run_on_host() {
  if ! command -v node >/dev/null 2>&1; then
    echo "[yearly-cleanup] node not found in PATH (host mode)" >&2
    exit 1
  fi

  local args=("${MODE_FLAG}" "--before-year" "${BEFORE_YEAR}")
  if [[ "${DELETE_ORPHAN}" == "true" ]]; then
    args+=("--delete-orphan-clients")
  fi
  if [[ -n "${CLEANUP_SUMMARY_FILE:-}" ]]; then
    args+=("--summary-file" "${CLEANUP_SUMMARY_FILE}")
  fi

  echo "[yearly-cleanup] running on host node (fallback/manual mode)"
  exec node "${REPO_ROOT}/ops/yearly-cleanup.js" "${args[@]}" "$@"
}

case "${EXECUTION_MODE}" in
  docker)
    if ! docker_container_running; then
      echo "[yearly-cleanup] ERROR: docker container '${CONTAINER_NAME}' is not running" >&2
      exit 1
    fi
    run_in_docker "$@"
    ;;
  host)
    run_on_host "$@"
    ;;
  auto)
    if docker_container_running; then
      run_in_docker "$@"
    fi
    run_on_host "$@"
    ;;
  *)
    echo "[yearly-cleanup] invalid CLEANUP_EXECUTION_MODE='${EXECUTION_MODE}' (expected auto|docker|host)" >&2
    exit 1
    ;;
esac
