#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT_DEFAULT="$(cd "${SCRIPT_DIR}/.." && pwd)"

RUN_USER="${SUDO_USER:-$(whoami)}"
REPO_ROOT="${REPO_ROOT_DEFAULT}"
UNITS_DIR="/etc/systemd/system"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      RUN_USER="${2:-}"
      shift 2
      ;;
    --repo-root)
      REPO_ROOT="${2:-}"
      shift 2
      ;;
    --units-dir)
      UNITS_DIR="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --help|-h)
      cat <<'EOF'
Usage: bash ops/install-jobs.sh [--user USER] [--repo-root PATH] [--dry-run]

Installs/updates the systemd yearly cleanup timer from versioned files in this repo.
EOF
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

SERVICE_NAME="sgm-yearly-cleanup.service"
TIMER_NAME="sgm-yearly-cleanup.timer"
SERVICE_TEMPLATE="${REPO_ROOT}/ops/systemd/${SERVICE_NAME}.template"
TIMER_TEMPLATE="${REPO_ROOT}/ops/systemd/${TIMER_NAME}"

if [[ ! -f "${SERVICE_TEMPLATE}" ]]; then
  echo "Missing template: ${SERVICE_TEMPLATE}" >&2
  exit 1
fi
if [[ ! -f "${TIMER_TEMPLATE}" ]]; then
  echo "Missing timer: ${TIMER_TEMPLATE}" >&2
  exit 1
fi

if [[ -z "${RUN_USER}" ]]; then
  echo "Run user cannot be empty" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

service_out="${tmp_dir}/${SERVICE_NAME}"
timer_out="${tmp_dir}/${TIMER_NAME}"

escaped_repo="$(printf '%s' "${REPO_ROOT}" | sed 's/[\/&]/\\&/g')"
escaped_user="$(printf '%s' "${RUN_USER}" | sed 's/[\/&]/\\&/g')"

sed \
  -e "s/__REPO_ROOT__/${escaped_repo}/g" \
  -e "s/__RUN_USER__/${escaped_user}/g" \
  "${SERVICE_TEMPLATE}" > "${service_out}"
cp "${TIMER_TEMPLATE}" "${timer_out}"

echo "[install-jobs] repo=${REPO_ROOT}"
echo "[install-jobs] user=${RUN_USER}"
echo "[install-jobs] units-dir=${UNITS_DIR}"

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "[install-jobs] dry-run: generated files in ${tmp_dir}"
  echo "--- ${SERVICE_NAME} ---"
  cat "${service_out}"
  echo "--- ${TIMER_NAME} ---"
  cat "${timer_out}"
  exit 0
fi

run_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Need root or sudo to install systemd units." >&2
    exit 1
  fi
}

run_root install -D -m 0644 "${service_out}" "${UNITS_DIR}/${SERVICE_NAME}"
run_root install -D -m 0644 "${timer_out}" "${UNITS_DIR}/${TIMER_NAME}"
run_root systemctl daemon-reload
run_root systemctl enable --now "${TIMER_NAME}"

echo "[install-jobs] installed ${SERVICE_NAME} and ${TIMER_NAME}"
run_root systemctl list-timers "${TIMER_NAME}" --no-pager || true
