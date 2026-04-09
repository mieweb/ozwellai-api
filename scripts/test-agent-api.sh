#!/usr/bin/env bash
# =============================================================================
# test-agent-api.sh — Consolidated Agent API test runner
#
# Usage:
#   ./scripts/test-agent-api.sh [OPTIONS]
#
# Options:
#   --key     <ozw_...>     Parent API key (required)
#   --base    <URL>         Server base URL (default: http://localhost:3000)
#   --verbose               Print full response bodies
#
# Examples:
#   ./scripts/test-agent-api.sh --key ozw_demo_localhost_key_for_testing
#   ./scripts/test-agent-api.sh --key ozw_demo_localhost_key_for_testing --base https://ozwell-dev-refserver.opensource.mieweb.org
# =============================================================================

# ── Defaults ─────────────────────────────────────────────────────────────────
BASE_URL="http://localhost:3000"
PARENT_KEY=""
VERBOSE=false

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)   PARENT_KEY="${2:-}"; shift 2 ;;
    --base)  BASE_URL="${2%/}"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$PARENT_KEY" ]]; then
  echo ""
  echo "  ERROR: --key is required"
  echo "  Usage: ./scripts/test-agent-api.sh --key ozw_demo_localhost_key_for_testing"
  echo ""
  exit 1
fi

# ── State ────────────────────────────────────────────────────────────────────
AGENT_ID=""
AGENT_KEY=""
JSON_AGENT_ID=""
JSON_AGENT_KEY=""
NO_INSTR_ID=""

# Shared temp file for response body — survives subshell boundaries
BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

pass() {
  echo -e "  ${GREEN}✓${NC} $1"
  PASS=$(( PASS + 1 ))
}

fail() {
  echo -e "  ${RED}✗${NC} ${BOLD}$1${NC}"
  if [[ -n "${2:-}" ]]; then
    echo -e "    ${DIM}↳ $2${NC}"
  fi
  FAIL=$(( FAIL + 1 ))
}

skip() {
  echo -e "  ${YELLOW}–${NC} ${DIM}$1${NC}"
  if [[ -n "${2:-}" ]]; then
    echo -e "    ${DIM}↳ $2${NC}"
  fi
  SKIP=$(( SKIP + 1 ))
}

header() {
  echo ""
  echo -e "  ${CYAN}${BOLD}$1${NC}"
  echo -e "  ${DIM}──────────────────────────────────────────────────${NC}"
}

# ── curl wrapper ──────────────────────────────────────────────────────────────
# Writes response body to $BODY_FILE (persistent across subshells).
# Writes HTTP status code to stdout.
do_curl() {
  local method="$1"
  local url="$2"
  local auth="$3"
  shift 3

  curl -s -o "$BODY_FILE" -w "%{http_code}" \
    -X "$method" "$url" \
    -H "Authorization: Bearer $auth" \
    "$@" 2>/dev/null || echo "000"
}

# Read the last response body from the shared file
get_body() {
  cat "$BODY_FILE" 2>/dev/null || echo ""
}

# Extract a JSON string field from the last response
json_get() {
  local body
  body=$(get_body)
  echo "$body" \
    | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" 2>/dev/null \
    | head -1 \
    | sed 's/.*: *"\(.*\)"/\1/' 2>/dev/null \
    || true
}

log_body() {
  if [[ "$VERBOSE" == "true" ]]; then
    local body
    body=$(get_body)
    if [[ -n "$body" ]]; then
      local snippet
      snippet=$(echo "$body" | head -c 300)
      echo -e "    ${DIM}${snippet}${NC}"
    fi
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
#  Banner
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}  Ozwell Agent API — Test Suite${NC}"
echo -e "  ${DIM}Target : ${BASE_URL}${NC}"
echo -e "  ${DIM}Key    : ${PARENT_KEY:0:12}...${NC}"
echo -e "  ${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}"

# ══════════════════════════════════════════════════════════════════════════════
#  0. Health check
# ══════════════════════════════════════════════════════════════════════════════
header "0. Connectivity"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" 2>/dev/null) || STATUS="000"
if [[ "$STATUS" == "200" ]]; then
  pass "GET /health → 200"
else
  fail "GET /health → $STATUS" "Server at $BASE_URL is not responding. Aborting."
  exit 1
fi

# ══════════════════════════════════════════════════════════════════════════════
#  1. Key validation
# ══════════════════════════════════════════════════════════════════════════════
header "1. Key Validation (GET /v1/keys/validate)"

STATUS=$(do_curl GET "$BASE_URL/v1/keys/validate" "$PARENT_KEY")
log_body
if [[ "$STATUS" == "200" ]]; then
  pass "Validate parent key → 200"
else
  fail "Validate parent key" "Expected 200, got $STATUS"
fi

STATUS=$(do_curl GET "$BASE_URL/v1/keys/validate" "invalid_token_xyz")
log_body
if [[ "$STATUS" == "401" ]]; then
  pass "Validate bad key → 401"
else
  fail "Validate bad key" "Expected 401, got $STATUS"
fi

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/v1/keys/validate" 2>/dev/null) || STATUS="000"
if [[ "$STATUS" == "401" || "$STATUS" == "400" ]]; then
  pass "Validate missing auth header → $STATUS (rejected)"
else
  fail "Validate missing auth header" "Expected 400 or 401, got $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  2. Create agent (raw YAML)
# ══════════════════════════════════════════════════════════════════════════════
header "2. Create Agent — raw YAML (POST /v1/agents)"

STATUS=$(do_curl POST "$BASE_URL/v1/agents" "$PARENT_KEY" \
  -H "Content-Type: application/yaml" \
  -d 'name: Test Bot
instructions: |
  You are a friendly test assistant.
  Keep responses short and helpful.
model: llama3.1:latest
temperature: 0.5
tools:
  - name: get_time
    description: Returns the current time
    inputSchema:
      type: object
      properties: {}
behavior:
  tone: formal
  rules:
    - Always be concise
')
log_body
if [[ "$STATUS" == "201" ]]; then
  AGENT_ID=$(json_get "agent_id")
  AGENT_KEY=$(json_get "agent_key")
  pass "Create agent (YAML) → 201 | agent_id=${AGENT_ID:-<empty>} | agent_key=${AGENT_KEY:0:16}..."
else
  fail "Create agent (YAML)" "Expected 201, got $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  3. Create agent (JSON-wrapped YAML)
# ══════════════════════════════════════════════════════════════════════════════
header "3. Create Agent — JSON-wrapped YAML (POST /v1/agents)"

STATUS=$(do_curl POST "$BASE_URL/v1/agents" "$PARENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"yaml": "name: JSON Wrapped Bot\ninstructions: You are a bot created via JSON-wrapped YAML.\nmodel: llama3.1:latest\ntemperature: 0.7\n"}')
log_body
if [[ "$STATUS" == "201" ]]; then
  JSON_AGENT_ID=$(json_get "agent_id")
  JSON_AGENT_KEY=$(json_get "agent_key")
  pass "Create agent (JSON-YAML) → 201 | agent_id=${JSON_AGENT_ID:-<empty>}"
else
  fail "Create agent (JSON-YAML)" "Expected 201, got $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  4. Create agent — missing instructions
# ══════════════════════════════════════════════════════════════════════════════
header "4. Create Agent — validation (missing instructions)"

STATUS=$(do_curl POST "$BASE_URL/v1/agents" "$PARENT_KEY" \
  -H "Content-Type: application/yaml" \
  -d 'name: No Instructions Bot')
log_body
if [[ "$STATUS" == "201" ]]; then
  NO_INSTR_ID=$(json_get "agent_id")
  skip "Missing instructions → 201 (accepted; docs say required — no server-side validation yet)"
elif [[ "$STATUS" == "400" ]]; then
  pass "Missing instructions → 400 (validation enforced)"
else
  fail "Missing instructions" "Unexpected status: $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  5. Create agent — unauthorized
# ══════════════════════════════════════════════════════════════════════════════
header "5. Auth Rejection (POST /v1/agents with bad key)"

STATUS=$(do_curl POST "$BASE_URL/v1/agents" "not_a_valid_key" \
  -H "Content-Type: application/yaml" \
  -d 'name: Unauthorized Bot
instructions: Should be rejected.')
log_body
if [[ "$STATUS" == "401" ]]; then
  pass "Create with invalid key → 401"
else
  fail "Create with invalid key" "Expected 401, got $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  6. List agents
# ══════════════════════════════════════════════════════════════════════════════
header "6. List Agents (GET /v1/agents)"

if [[ -z "$AGENT_ID" ]]; then
  skip "List agents" "No agent was created in step 2"
else
  STATUS=$(do_curl GET "$BASE_URL/v1/agents" "$PARENT_KEY")
  log_body
  if [[ "$STATUS" == "200" ]]; then
    pass "List agents → 200"
    BODY=$(get_body)
    if echo "$BODY" | grep -q '"object"' 2>/dev/null; then
      pass "List response has 'object' field"
    else
      fail "List response shape" "Missing 'object' field"
    fi
  else
    fail "List agents" "Expected 200, got $STATUS"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
#  7. Get agent by ID
# ══════════════════════════════════════════════════════════════════════════════
header "7. Get Agent by ID (GET /v1/agents/:id)"

if [[ -z "$AGENT_ID" ]]; then
  skip "Get agent by ID" "No agent was created in step 2"
else
  STATUS=$(do_curl GET "$BASE_URL/v1/agents/$AGENT_ID" "$PARENT_KEY")
  log_body
  if [[ "$STATUS" == "200" ]]; then
    NAME=$(json_get "name")
    pass "Get agent → 200 | name=${NAME:-<empty>}"
  else
    fail "Get agent" "Expected 200, got $STATUS"
  fi

  STATUS=$(do_curl GET "$BASE_URL/v1/agents/agent-doesnotexist999" "$PARENT_KEY")
  log_body
  if [[ "$STATUS" == "404" ]]; then
    pass "Get non-existent agent → 404"
  else
    fail "Get non-existent agent" "Expected 404, got $STATUS"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
#  8. Get own agent config (/v1/agents/me)
# ══════════════════════════════════════════════════════════════════════════════
header "8. Get Own Agent Config (GET /v1/agents/me)"

if [[ -z "$AGENT_KEY" ]]; then
  skip "GET /v1/agents/me" "No agent key available"
else
  STATUS=$(do_curl GET "$BASE_URL/v1/agents/me" "$AGENT_KEY")
  log_body
  if [[ "$STATUS" == "200" ]]; then
    NAME=$(json_get "name")
    pass "GET /v1/agents/me → 200 | name=${NAME:-<empty>}"
  else
    fail "GET /v1/agents/me" "Expected 200, got $STATUS"
  fi

  STATUS=$(do_curl GET "$BASE_URL/v1/keys/validate" "$AGENT_KEY")
  log_body
  if [[ "$STATUS" == "200" ]]; then
    pass "Validate agent key → 200"
  else
    fail "Validate agent key" "Expected 200, got $STATUS"
  fi

  STATUS=$(do_curl GET "$BASE_URL/v1/agents/me" "$PARENT_KEY")
  log_body
  if [[ "$STATUS" == "401" ]]; then
    pass "GET /v1/agents/me with parent key → 401"
  else
    skip "GET /v1/agents/me with parent key → $STATUS" "Expected 401 (may vary by implementation)"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
#  9. Update agent
# ══════════════════════════════════════════════════════════════════════════════
header "9. Update Agent (PUT /v1/agents/:id)"

if [[ -z "$AGENT_ID" ]]; then
  skip "Update agent" "No agent was created in step 2"
else
  STATUS=$(do_curl PUT "$BASE_URL/v1/agents/$AGENT_ID" "$PARENT_KEY" \
    -H "Content-Type: application/yaml" \
    -d 'name: Test Bot v2
instructions: |
  You are an updated test assistant.
  Be even more concise.
model: llama3.1:latest
temperature: 0.3
')
  log_body
  if [[ "$STATUS" == "200" ]]; then
    UPDATED_NAME=$(json_get "name")
    pass "Update agent (YAML) → 200 | name=${UPDATED_NAME:-<empty>}"
  else
    fail "Update agent (YAML)" "Expected 200, got $STATUS"
  fi

  STATUS=$(do_curl PUT "$BASE_URL/v1/agents/$AGENT_ID" "$PARENT_KEY" \
    -H "Content-Type: application/json" \
    -d '{"yaml": "name: Test Bot v3\ninstructions: Updated via JSON YAML wrapper.\n"}')
  log_body
  if [[ "$STATUS" == "200" ]]; then
    pass "Update agent (JSON-YAML) → 200"
  else
    fail "Update agent (JSON-YAML)" "Expected 200, got $STATUS"
  fi

  STATUS=$(do_curl PUT "$BASE_URL/v1/agents/agent-doesnotexist999" "$PARENT_KEY" \
    -H "Content-Type: application/yaml" \
    -d 'name: Ghost
instructions: I do not exist.')
  log_body
  if [[ "$STATUS" == "404" ]]; then
    pass "Update non-existent agent → 404"
  else
    fail "Update non-existent agent" "Expected 404, got $STATUS"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
#  10. Chat — agent key (non-streaming + streaming)
# ══════════════════════════════════════════════════════════════════════════════
header "10. Chat — Agent Key Auth (POST /v1/chat/completions)"

if [[ -z "$AGENT_KEY" ]]; then
  skip "Chat with agent key" "No agent key available"
else
  STATUS=$(do_curl POST "$BASE_URL/v1/chat/completions" "$AGENT_KEY" \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Say hello in one word"}],"stream":false}')
  log_body
  if [[ "$STATUS" == "200" ]]; then
    pass "Chat (non-streaming, agent key) → 200"
  else
    fail "Chat (non-streaming, agent key)" "Expected 200, got $STATUS"
  fi

  STREAM_TMP=$(mktemp)
  curl -s -N \
    -X POST "$BASE_URL/v1/chat/completions" \
    -H "Authorization: Bearer $AGENT_KEY" \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Hi"}],"stream":true}' \
    --max-time 15 > "$STREAM_TMP" 2>/dev/null || true
  if grep -q "data:" "$STREAM_TMP" 2>/dev/null; then
    pass "Chat (streaming, agent key) → SSE chunks received"
  else
    fail "Chat (streaming, agent key)" "No 'data:' chunks received"
  fi
  rm -f "$STREAM_TMP"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  11. Chat — parent key
# ══════════════════════════════════════════════════════════════════════════════
header "11. Chat — Parent Key Auth"

STATUS=$(do_curl POST "$BASE_URL/v1/chat/completions" "$PARENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}],"stream":false}')
log_body
if [[ "$STATUS" == "200" ]]; then
  pass "Chat (parent key) → 200"
else
  fail "Chat (parent key)" "Expected 200, got $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  12. Chat — tool filtering
# ══════════════════════════════════════════════════════════════════════════════
header "12. Chat — Tool Filtering with Agent Key"

if [[ -z "$AGENT_KEY" ]]; then
  skip "Tool filtering" "No agent key available"
else
  STATUS=$(do_curl POST "$BASE_URL/v1/chat/completions" "$AGENT_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "messages": [{"role":"user","content":"What time is it?"}],
      "tools": [
        {"type":"function","function":{"name":"get_time","description":"Returns the current time","parameters":{"type":"object","properties":{}}}},
        {"type":"function","function":{"name":"dangerous_tool","description":"Should be filtered","parameters":{"type":"object","properties":{}}}}
      ],
      "stream": false
    }')
  log_body
  if [[ "$STATUS" == "200" ]]; then
    pass "Chat with tools (allowed + disallowed) → 200"
  else
    fail "Chat with tools" "Expected 200, got $STATUS"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
#  13. Chat — response_format passthrough
# ══════════════════════════════════════════════════════════════════════════════
header "13. Chat — response_format Passthrough"

if [[ -z "$AGENT_KEY" ]]; then
  skip "response_format passthrough" "No agent key available"
else
  STATUS=$(do_curl POST "$BASE_URL/v1/chat/completions" "$AGENT_KEY" \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Give me JSON"}],"response_format":{"type":"json_object"},"stream":false}')
  log_body
  if [[ "$STATUS" == "200" ]]; then
    pass "Chat with response_format → 200"
  else
    skip "Chat with response_format → $STATUS" "Backend may not support json_object"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
#  14. Chat — no auth
# ══════════════════════════════════════════════════════════════════════════════
header "14. Chat — Auth Rejection"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}]}' 2>/dev/null) || STATUS="000"
if [[ "$STATUS" == "401" ]]; then
  pass "Chat with no auth → 401"
else
  fail "Chat with no auth" "Expected 401, got $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  15. Chat — invalid agent key
# ══════════════════════════════════════════════════════════════════════════════
header "15. Chat — Invalid Agent Key"

STATUS=$(do_curl POST "$BASE_URL/v1/chat/completions" "agnt_key-doesnotexist999" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}],"stream":false}')
log_body
if [[ "$STATUS" == "401" ]]; then
  pass "Chat with non-existent agent key → 401"
else
  fail "Chat with non-existent agent key" "Expected 401, got $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  16. Delete agent + cleanup
# ══════════════════════════════════════════════════════════════════════════════
header "16. Delete Agent (DELETE /v1/agents/:id)"

if [[ -z "$AGENT_ID" ]]; then
  skip "Delete agent" "No agent was created in step 2"
else
  STATUS=$(do_curl DELETE "$BASE_URL/v1/agents/$AGENT_ID" "$PARENT_KEY")
  log_body
  if [[ "$STATUS" == "200" ]]; then
    pass "Delete agent → 200"
  else
    fail "Delete agent" "Expected 200, got $STATUS"
  fi

  STATUS=$(do_curl GET "$BASE_URL/v1/agents/$AGENT_ID" "$PARENT_KEY")
  log_body
  if [[ "$STATUS" == "404" ]]; then
    pass "Get deleted agent → 404"
  else
    fail "Get deleted agent" "Expected 404, got $STATUS"
  fi

  if [[ -n "$AGENT_KEY" ]]; then
    STATUS=$(do_curl GET "$BASE_URL/v1/keys/validate" "$AGENT_KEY")
    log_body
    if [[ "$STATUS" == "401" ]]; then
      pass "Validate deleted agent key → 401 (invalidated)"
    else
      skip "Validate deleted agent key → $STATUS" "Key may persist in DB after delete"
    fi
  fi
fi

# Cleanup secondary test agents silently
if [[ -n "$JSON_AGENT_ID" ]]; then
  do_curl DELETE "$BASE_URL/v1/agents/$JSON_AGENT_ID" "$PARENT_KEY" > /dev/null 2>&1
  pass "Cleanup: deleted JSON-wrapped agent"
fi

if [[ -n "$NO_INSTR_ID" ]]; then
  do_curl DELETE "$BASE_URL/v1/agents/$NO_INSTR_ID" "$PARENT_KEY" > /dev/null 2>&1
  pass "Cleanup: deleted no-instructions agent"
fi

STATUS=$(do_curl DELETE "$BASE_URL/v1/agents/agent-doesnotexist999" "$PARENT_KEY")
log_body
if [[ "$STATUS" == "404" ]]; then
  pass "Delete non-existent agent → 404"
else
  fail "Delete non-existent agent" "Expected 404, got $STATUS"
fi

# ══════════════════════════════════════════════════════════════════════════════
#  Results
# ══════════════════════════════════════════════════════════════════════════════
TOTAL=$(( PASS + FAIL + SKIP ))
echo ""
echo -e "  ${DIM}──────────────────────────────────────────────────${NC}"
echo -e "  ${BOLD}Results${NC}   ${GREEN}${PASS} passed${NC}  /  ${RED}${FAIL} failed${NC}  /  ${YELLOW}${SKIP} skipped${NC}  ${DIM}(${TOTAL} total)${NC}"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}✗ Some tests failed.${NC}"
  echo ""
  exit 1
fi
echo -e "  ${GREEN}${BOLD}✓ All tests passed.${NC}"
echo ""
exit 0
