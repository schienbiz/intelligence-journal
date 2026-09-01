#!/bin/bash
# Launcher for com.intelligence-journal.dev.
#
# The plist used to name /usr/local/bin/node directly. That binary was removed at
# some point (this machine now has node only under nvm), but the already-running
# process held the deleted file's inode and kept serving — so the service looked
# healthy for weeks while being unable to survive its next restart. Resolving
# node at launch time means an nvm version bump cannot silently re-break it.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"

NODE=""
if [ -s "${NVM_DIR}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR}/nvm.sh" --no-use
  NODE="$(nvm which default 2>/dev/null || true)"
fi
[ -x "${NODE}" ] || NODE="$(command -v node || true)"

if [ ! -x "${NODE}" ]; then
  echo "[intelligence-journal] FATAL: no usable node found (NVM_DIR=${NVM_DIR})" >&2
  exit 78   # EX_CONFIG — a config problem, not a crash to restart-loop on
fi

echo "[intelligence-journal] launching with ${NODE} ($("${NODE}" -v))"
exec "${NODE}" --env-file=.env server.js
