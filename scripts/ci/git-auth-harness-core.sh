#!/bin/sh
# Point git at an HTTPS token for the private @mieweb/harness-core dependency.
#
# npm records GitHub git dependencies as ssh://git@github.com/... in package-lock.json
# regardless of how package.json spells them, so both the ssh and https forms are
# rewritten. Used by CI workflows and the Dockerfile; safe to run locally too.
#
# Usage: HARNESS_CORE_TOKEN=<token with read access to mieweb/harness-core> ./scripts/ci/git-auth-harness-core.sh
set -eu

if [ -z "${HARNESS_CORE_TOKEN:-}" ]; then
  echo "git-auth-harness-core: HARNESS_CORE_TOKEN not set; leaving git config untouched" >&2
  exit 0
fi

target="https://x-access-token:${HARNESS_CORE_TOKEN}@github.com/mieweb/harness-core"
git config --global "url.${target}.insteadOf" "ssh://git@github.com/mieweb/harness-core"
git config --global --add "url.${target}.insteadOf" "https://github.com/mieweb/harness-core"
