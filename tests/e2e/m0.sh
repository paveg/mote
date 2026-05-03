#!/usr/bin/env bash
# M0 walking skeleton e2e smoke test.
#
# Verifies the four M0 done criteria from roadmap.md:
#   1. `bun run agent` starts and accepts input
#   2. read_file (built-in tool) is dispatched and returns content
#   3. Session log is written to ~/.mote/sessions/<id>.jsonl with 0o600
#   4. (Resume is covered by the JsonlState unit tests; not duplicated here)
#
# Skipped automatically if no LLM API key is set.
#
# Run from the repo root:
#   bash tests/e2e/m0.sh
#
# Cost: one Anthropic API call (cheap; ~few hundred tokens at default model).

set -euo pipefail

# --- M5: Telegram gateway fail-closed startup ---
#
# We don't try a real Telegram bot here (would require BotFather +
# a master phone). Instead, prove the gateway entry refuses to start
# when env is missing / malformed — the security invariant ADR-0012
# D2 promises before any HTTP request is issued.

# Sub-case A: missing MOTE_TELEGRAM_TOKEN -> exit non-zero
M5_OUT_A="$(MOTE_TELEGRAM_TOKEN= MOTE_TELEGRAM_MASTER_ID= bun run src/entry/gateway.ts 2>&1 || true)"
if ! grep -q "MOTE_TELEGRAM_TOKEN" <<< "$M5_OUT_A"; then
  echo "FAIL: M5 — gateway should mention MOTE_TELEGRAM_TOKEN in error when token missing"
  echo "$M5_OUT_A"
  exit 1
fi

# Sub-case B: malformed MOTE_TELEGRAM_TOKEN -> format error
M5_OUT_B="$(MOTE_TELEGRAM_TOKEN="not-a-token" MOTE_TELEGRAM_MASTER_ID="12345" bun run src/entry/gateway.ts 2>&1 || true)"
if ! grep -qi "format" <<< "$M5_OUT_B"; then
  echo "FAIL: M5 — malformed token should yield a 'format' error"
  echo "$M5_OUT_B"
  exit 1
fi

# Sub-case C: missing master id with valid token -> error mentions master
M5_OUT_C="$(MOTE_TELEGRAM_TOKEN="1234567890:$(printf 'a%.0s' $(seq 1 35))" MOTE_TELEGRAM_MASTER_ID= bun run src/entry/gateway.ts 2>&1 || true)"
if ! grep -q "MOTE_TELEGRAM_MASTER_ID" <<< "$M5_OUT_C"; then
  echo "FAIL: M5 — gateway should mention MOTE_TELEGRAM_MASTER_ID when missing"
  echo "$M5_OUT_C"
  exit 1
fi

echo "PASS: M5 gateway fail-closed startup (token missing/malformed + master id missing rejected)"

if [ -z "${LLM_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "SKIP: neither LLM_API_KEY nor ANTHROPIC_API_KEY is set (M0–M4 skipped)"
  exit 0
fi

TMP_HOME=$(mktemp -d -t mote-e2e-XXXXXX)
trap 'rm -rf "$TMP_HOME"' EXIT

# Redirect mote's workspace into the temp dir.
export HOME="$TMP_HOME"

# Pre-seed a known file inside the workspace.
WORKSPACE="$TMP_HOME/.mote/agents/default"
mkdir -p "$WORKSPACE"
MARKER="mote-e2e-marker-$(date +%s)"
echo "$MARKER" > "$WORKSPACE/note.txt"

# Construct a prompt that should make the model call read_file.
PROMPT="Use the read_file tool to read note.txt from the workspace and reply with exactly the contents you read."

# Pipe the prompt and /exit; capture combined output.
RESPONSE="$(printf '%s\n/exit\n' "$PROMPT" | bun run src/entry/agent.ts 2>&1 || true)"

if [ -z "$RESPONSE" ]; then
  echo "FAIL: agent produced no output"
  echo "---"
  echo "TMP_HOME=$TMP_HOME"
  exit 1
fi

# Check session jsonl exists.
SESSIONS_DIR="$WORKSPACE/sessions"
if [ ! -d "$SESSIONS_DIR" ]; then
  echo "FAIL: sessions/ directory was not created"
  echo "---"
  echo "$RESPONSE"
  exit 1
fi

SESSION_FILE="$(find "$SESSIONS_DIR" -name '*.jsonl' -type f | head -n 1)"
if [ -z "$SESSION_FILE" ]; then
  echo "FAIL: no .jsonl file found under $SESSIONS_DIR"
  echo "---"
  echo "$RESPONSE"
  exit 1
fi

# Check 0o600 mode (works on both macOS `stat -f '%Lp'` and Linux `stat -c '%a'`).
if PERMS="$(stat -f '%Lp' "$SESSION_FILE" 2>/dev/null)"; then
  : # macOS path
else
  PERMS="$(stat -c '%a' "$SESSION_FILE")"
fi

if [ "$PERMS" != "600" ]; then
  echo "FAIL: session file mode is $PERMS (expected 600)"
  exit 1
fi

# Check the agent's reply contains the marker.
if ! grep -q "$MARKER" <<< "$RESPONSE"; then
  echo "FAIL: response did not include the marker string"
  echo "marker: $MARKER"
  echo "---response---"
  echo "$RESPONSE"
  echo "---"
  exit 1
fi

echo "PASS: M0 walking skeleton e2e"
echo "  - bun run agent accepted stdin and exited cleanly"
echo "  - read_file dispatched (marker $MARKER present in response)"
echo "  - session log at $SESSION_FILE (mode $PERMS)"

# --- M1: slash-command path -----------------------------------------------

# Add a hello skill in the temp workspace, then invoke it via /hello
SKILL_DIR="$WORKSPACE/skills/hello"
mkdir -p "$SKILL_DIR"
cat > "$SKILL_DIR/SKILL.md" <<'EOF'
---
name: hello
description: Reply with the literal text mote-hello-marker.
---
Reply with exactly the text `mote-hello-marker` and nothing else.
EOF

SLASH_RESPONSE="$(printf '/hello\n/exit\n' | bun run src/entry/agent.ts 2>&1 || true)"

if ! grep -q "mote-hello-marker" <<< "$SLASH_RESPONSE"; then
  echo "FAIL: /hello slash command did not invoke the skill"
  echo "---"
  echo "$SLASH_RESPONSE"
  echo "---"
  exit 1
fi

echo "PASS: M1 slash command e2e (/hello dispatched and skill body executed)"

# --- M2: memory_append e2e -------------------------------------------------

# Use a fresh marker so the test passes regardless of prior runs leaving state.
M2_MARKER="memory-marker-$(date +%s)"
M2_PROMPT="The user has just told you their favorite color is blue. Use memory_append to record exactly: \"$M2_MARKER user color: blue\"."

M2_RESPONSE="$(printf '%s\n/exit\n' "$M2_PROMPT" | bun run src/entry/agent.ts 2>&1 || true)"

MEMORY_FILE="$WORKSPACE/MEMORY.md"
if [ ! -f "$MEMORY_FILE" ]; then
  echo "FAIL: M2 — MEMORY.md was not created"
  echo "---"
  echo "$M2_RESPONSE"
  exit 1
fi

# Permission check (handles both macOS and Linux stat)
if M2_PERMS="$(stat -f '%Lp' "$MEMORY_FILE" 2>/dev/null)"; then
  : # macOS path
else
  M2_PERMS="$(stat -c '%a' "$MEMORY_FILE")"
fi
if [ "$M2_PERMS" != "600" ]; then
  echo "FAIL: M2 — MEMORY.md mode is $M2_PERMS (expected 600)"
  exit 1
fi

if ! grep -q "$M2_MARKER" "$MEMORY_FILE"; then
  echo "FAIL: M2 — MEMORY.md does not contain the marker"
  echo "---marker---"
  echo "$M2_MARKER"
  echo "---memory---"
  cat "$MEMORY_FILE"
  exit 1
fi

echo "PASS: M2 memory_append e2e (MEMORY.md created with marker, mode $M2_PERMS)"

# --- M4: A2A endpoint smoke ---

if [ -n "${MOTE_A2A_TOKEN:-}" ]; then
  M4_TOKEN="$MOTE_A2A_TOKEN"
elif [ -n "${LLM_API_KEY:-}" ]; then
  # No A2A token — generate ephemeral one for the smoke
  M4_TOKEN="$(openssl rand -base64 32 2>/dev/null | tr -d '\n=' | head -c 40)"
fi

if [ -z "${M4_TOKEN:-}" ] || [ ${#M4_TOKEN} -lt 32 ]; then
  echo "SKIP: M4 — no token available (set MOTE_A2A_TOKEN or LLM_API_KEY)"
else
  export MOTE_A2A_TOKEN="$M4_TOKEN"
  export MOTE_A2A_PORT="8788"  # avoid clashing with default 8787
  bun run src/entry/a2a-serve.ts &
  M4_PID=$!
  sleep 2
  trap "kill $M4_PID 2>/dev/null || true" EXIT
  M4_CARD="$(curl -s http://127.0.0.1:8788/.well-known/agent-card.json || echo '{}')"
  if ! grep -q '"name":"mote"' <<< "$M4_CARD"; then
    echo "FAIL: M4 — agent card endpoint did not respond with mote card"
    echo "$M4_CARD"
    kill $M4_PID 2>/dev/null || true
    exit 1
  fi
  M4_AUTH="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8788/ -H 'Content-Type: application/json' -d '{}')"
  if [ "$M4_AUTH" != "401" ] && [ "$M4_AUTH" != "403" ]; then
    echo "FAIL: M4 — unauth POST should return 401/403, got $M4_AUTH"
    kill $M4_PID 2>/dev/null || true
    exit 1
  fi
  kill $M4_PID 2>/dev/null || true
  echo "PASS: M4 a2a-serve e2e (agent card public, JSON-RPC POST requires auth)"
fi
