#!/bin/sh
# Give git read access to the private @mieweb/harness-core dependency for npm.
#
# npm resolves the dependency as ssh://git@github.com/mieweb/harness-core.git (that is
# how it records GitHub git deps in package-lock.json), so the preferred credential is
# an SSH key with read access to mieweb/harness-core — the same arrangement
# Ozwell-workspace uses for its harness-core submodule. A token is accepted as a
# fallback and applied via URL rewrite (also covers the https form).
#
# Usage (one of):
#   HARNESS_CORE_SSH_KEY="$(cat key)" ./scripts/ci/git-auth-harness-core.sh
#   HARNESS_CORE_TOKEN=<fine-grained PAT, Contents: read> ./scripts/ci/git-auth-harness-core.sh
#
# In GitHub Actions the key is written to the runner's ~/.ssh and GIT_SSH_COMMAND is
# exported to later steps via $GITHUB_ENV (works on Linux, macOS, and Git Bash on Windows).
# Safe to source (`. script.sh`) so GIT_SSH_COMMAND applies to the current shell.
set -u

if [ -n "${HARNESS_CORE_SSH_KEY:-}" ]; then
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  key_file="$HOME/.ssh/harness_core_deploy_key"
  printf '%s\n' "$HARNESS_CORE_SSH_KEY" > "$key_file"
  chmod 600 "$key_file"
  if ! grep -qs "github.com" "$HOME/.ssh/known_hosts" 2>/dev/null; then
    ssh-keyscan -t ed25519,ecdsa,rsa github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null
  fi
  ssh_cmd="ssh -i $key_file -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  export GIT_SSH_COMMAND="$ssh_cmd"
  if [ -n "${GITHUB_ENV:-}" ]; then
    printf 'GIT_SSH_COMMAND=%s\n' "$ssh_cmd" >> "$GITHUB_ENV"
  fi
  echo "git-auth-harness-core: ssh key installed; GIT_SSH_COMMAND set"
elif [ -n "${HARNESS_CORE_TOKEN:-}" ]; then
  target="https://x-access-token:${HARNESS_CORE_TOKEN}@github.com/mieweb/harness-core"
  git config --global "url.${target}.insteadOf" "ssh://git@github.com/mieweb/harness-core"
  git config --global --add "url.${target}.insteadOf" "https://github.com/mieweb/harness-core"
  echo "git-auth-harness-core: https token rewrite configured"
else
  echo "git-auth-harness-core: neither HARNESS_CORE_SSH_KEY nor HARNESS_CORE_TOKEN set; leaving git untouched" >&2
fi
