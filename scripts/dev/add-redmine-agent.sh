#!/usr/bin/env bash
# Creates a dev agent wired to the Redmine MCP server.
# Usage: REDMINE_TOKEN=... ./scripts/dev/add-redmine-agent.sh
# Server must run with TRUST_FORWARD_AUTH_HEADERS=true and MCP_ALLOWED_HOSTS including rm.os.mieweb.org.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
MCP_URL="${MCP_URL:-https://rm.os.mieweb.org/mcp}"
MANAGER_USER="${MANAGER_USER:-rgara}"
MANAGER_EMAIL="${MANAGER_EMAIL:-rgara@mieweb.com}"

if [[ -z "${REDMINE_TOKEN:-}" ]]; then
  read -rsp "Redmine API token: " REDMINE_TOKEN
  echo
fi

YAML=$(cat <<EOF
name: Redmine Agent
instructions: Use the Redmine tools to look up and manage tickets. Always cite issue links.
mcp_servers:
  - name: redmine
    url: ${MCP_URL}
    auth: { type: bearer, token: "\${{ secrets.REDMINE_TOKEN }}" }
    tools: [list_projects, get_project, list_issues, get_issue, create_issue, update_issue, set_custom_fields, attach_file, update_checklist, add_issue_note, list_users, current_user, search, list_time_entries, get_time_entry_options, create_time_entry, list_issue_attachments, get_attachment]
EOF
)

BODY=$(YAML="$YAML" TOKEN="$REDMINE_TOKEN" node -e \
  'process.stdout.write(JSON.stringify({ yaml: process.env.YAML, secrets: { REDMINE_TOKEN: process.env.TOKEN } }))')

# Set AGENT_ID to update an existing agent instead of creating a new one.
if [[ -n "${AGENT_ID:-}" ]]; then
  METHOD=PUT; URL="${BASE_URL}/v1/manager/agents/${AGENT_ID}"
else
  METHOD=POST; URL="${BASE_URL}/v1/manager/agents"
fi

curl -sS -X "$METHOD" "$URL" \
  -H 'Content-Type: application/json' \
  -H "x-user: ${MANAGER_USER}" \
  -H "x-email: ${MANAGER_EMAIL}" \
  -H "x-preferred-username: ${MANAGER_USER}" \
  --data-binary @- <<<"$BODY"
echo
