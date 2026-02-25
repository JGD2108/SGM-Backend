#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOK_PATH="${REPO_ROOT}/.git/hooks/post-merge"

if [[ ! -d "${REPO_ROOT}/.git" ]]; then
  echo "This script must be run inside the git checkout on the server." >&2
  exit 1
fi

mkdir -p "$(dirname "${HOOK_PATH}")"

cat > "${HOOK_PATH}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ ! -x "${REPO_ROOT}/ops/install-jobs.sh" ]]; then
  chmod +x "${REPO_ROOT}/ops/install-jobs.sh" 2>/dev/null || true
fi

if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  bash "${REPO_ROOT}/ops/install-jobs.sh" --user "${USER}" || true
else
  echo "[post-merge] skipping job sync (sudo without password not available)"
fi
EOF

chmod +x "${HOOK_PATH}"

echo "[install-post-merge-hook] installed ${HOOK_PATH}"
echo "[install-post-merge-hook] post-merge will try to sync systemd timer after git pull"
