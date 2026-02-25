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

BEFORE_YEAR="${CLEANUP_BEFORE_YEAR:-$(date +%Y)}"
DELETE_ORPHAN="${CLEANUP_DELETE_ORPHAN_CLIENTS:-false}"
EXECUTION_MODE="${CLEANUP_EXECUTION_MODE:-auto}"   # auto | docker | host
CONTAINER_NAME="${CLEANUP_CONTAINER_NAME:-sgm_api}"
CONTAINER_WORKDIR="${CLEANUP_CONTAINER_WORKDIR:-}"
CONTAINER_SUMMARY_DIR="${CLEANUP_CONTAINER_SUMMARY_DIR:-/tmp/sgm-yearly-cleanup}"
HOST_SUMMARY_DIR="${CLEANUP_HOST_SUMMARY_DIR:-${REPO_ROOT}/logs/yearly-cleanup}"
DEFAULT_MODE="${CLEANUP_DEFAULT_MODE:-execute}"    # dry-run | execute

MODE_FLAG="--dry-run"
if [[ "${DEFAULT_MODE}" == "execute" ]]; then
  MODE_FLAG="--execute"
fi
if [[ "${1:-}" == "--execute" ]]; then
  MODE_FLAG="--execute"
  shift
elif [[ "${1:-}" == "--dry-run" ]]; then
  MODE_FLAG="--dry-run"
  shift
fi

echo "[yearly-cleanup] requested mode=${MODE_FLAG} beforeYear=${BEFORE_YEAR}"
echo "[yearly-cleanup] execution mode=${EXECUTION_MODE}"

docker_container_running() {
  command -v docker >/dev/null 2>&1 || return 1
  docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

run_in_docker() {
  local workdir="${CONTAINER_WORKDIR}"
  local npm_script="ops:cleanup:yearly:dry-run"
  local ts
  local container_summary_file
  local host_summary_file
  local exit_code=0
  if [[ "${MODE_FLAG}" == "--execute" ]]; then
    npm_script="ops:cleanup:yearly"
  fi
  if [[ -z "${workdir}" ]]; then
    workdir="$(docker inspect --format '{{.Config.WorkingDir}}' "${CONTAINER_NAME}" 2>/dev/null || true)"
    workdir="${workdir:-/app}"
  fi

  ts="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  container_summary_file="${CONTAINER_SUMMARY_DIR}/before-${BEFORE_YEAR}-${ts}.json"
  mkdir -p "${HOST_SUMMARY_DIR}"
  host_summary_file="${HOST_SUMMARY_DIR}/$(basename "${container_summary_file}")"

  echo "[yearly-cleanup] running inside docker container=${CONTAINER_NAME} workdir=${workdir} script=${npm_script}"
  echo "[yearly-cleanup] host summary target=${host_summary_file}"

  docker exec \
    -w "${workdir}" \
    -e CLEANUP_BEFORE_YEAR="${BEFORE_YEAR}" \
    -e CLEANUP_DELETE_ORPHAN_CLIENTS="${DELETE_ORPHAN}" \
    -e CLEANUP_SUMMARY_FILE="${container_summary_file}" \
    "${CONTAINER_NAME}" \
    npm run "${npm_script}" -- "$@" || exit_code=$?

  if docker cp "${CONTAINER_NAME}:${container_summary_file}" "${host_summary_file}" >/dev/null 2>&1; then
    echo "[yearly-cleanup] host summary copied to ${host_summary_file}"
  else
    echo "[yearly-cleanup] warning: could not copy summary from container path ${container_summary_file}" >&2
  fi

  return "${exit_code}"
}

run_on_host() {
  if ! command -v node >/dev/null 2>&1; then
    echo "[yearly-cleanup] node not found in PATH (host mode)" >&2
    exit 1
  fi

  local args=("${MODE_FLAG}" "--before-year" "${BEFORE_YEAR}")
  local ts
  local host_summary_file
  if [[ "${DELETE_ORPHAN}" == "true" ]]; then
    args+=("--delete-orphan-clients")
  fi
  mkdir -p "${HOST_SUMMARY_DIR}"
  ts="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  host_summary_file="${CLEANUP_SUMMARY_FILE:-${HOST_SUMMARY_DIR}/before-${BEFORE_YEAR}-${ts}.json}"
  args+=("--summary-file" "${host_summary_file}")

  echo "[yearly-cleanup] running on host node (fallback/manual mode)"
  echo "[yearly-cleanup] host summary target=${host_summary_file}"
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
      exit $?
    fi
    run_on_host "$@"
    ;;
  *)
    echo "[yearly-cleanup] invalid CLEANUP_EXECUTION_MODE='${EXECUTION_MODE}' (expected auto|docker|host)" >&2
    exit 1
    ;;
esac
