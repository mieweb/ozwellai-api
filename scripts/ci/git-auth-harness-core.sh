#!/bin/sh
# Give git read access to the private @mieweb/harness-core dependency for npm.
#
# npm resolves the dependency as ssh://git@github.com/mieweb/harness-core.git (that is
# how it records GitHub git deps in package-lock.json), so the preferred credential is
# an SSH key with read access to mieweb/harness-core — the same arrangement
# Ozwell-workspace uses for its harness-core submodule. A token is accepted as a
# fallback and applied via URL rewrite (also covers the https form).
#
# Usage — credentials are tried in this order, first one set wins:
#   HARNESS_CORE_SSH_KEY   dedicated SSH key with read access to mieweb/harness-core
#   HARNESS_CORE_TOKEN     fine-grained PAT, Contents: read on mieweb/harness-core
#   FALLBACK_SSH_KEY       shared SSH key that may or may not have that access
#
# In GitHub Actions the key is written to the runner's ~/.ssh and GIT_SSH_COMMAND is
# exported to later steps via $GITHUB_ENV (works on Linux, macOS, and Git Bash on Windows).
# Safe to source (`. script.sh`) so GIT_SSH_COMMAND applies to the current shell.
set -u

install_ssh_key() {
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  key_file="$HOME/.ssh/harness_core_deploy_key"
  printf '%s\n' "$1" > "$key_file"
  chmod 600 "$key_file"
  if ! grep -qs "github.com" "$HOME/.ssh/known_hosts" 2>/dev/null; then
    ssh-keyscan -t ed25519,ecdsa,rsa github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null
  fi
  ssh_cmd="ssh -i $key_file -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  export GIT_SSH_COMMAND="$ssh_cmd"
  if [ -n "${GITHUB_ENV:-}" ]; then
    printf 'GIT_SSH_COMMAND=%s\n' "$ssh_cmd" >> "$GITHUB_ENV"
  fi
  echo "git-auth-harness-core: $2 ssh key installed; GIT_SSH_COMMAND set"
}

if [ -n "${HARNESS_CORE_SSH_KEY:-}" ]; then
  install_ssh_key "$HARNESS_CORE_SSH_KEY" dedicated
elif [ -n "${HARNESS_CORE_TOKEN:-}" ]; then
  target="https://x-access-token:${HARNESS_CORE_TOKEN}@github.com/mieweb/harness-core"
  git config --global "url.${target}.insteadOf" "ssh://git@github.com/mieweb/harness-core"
  git config --global --add "url.${target}.insteadOf" "https://github.com/mieweb/harness-core"
  echo "git-auth-harness-core: https token rewrite configured"
elif [ -n "${FALLBACK_SSH_KEY:-}" ]; then
  install_ssh_key "$FALLBACK_SSH_KEY" shared
else
  echo "git-auth-harness-core: no harness-core credential set (HARNESS_CORE_SSH_KEY / HARNESS_CORE_TOKEN / FALLBACK_SSH_KEY); leaving git untouched" >&2
fi
