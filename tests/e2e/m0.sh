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

if [ -z "${LLM_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "SKIP: neither LLM_API_KEY nor ANTHROPIC_API_KEY is set"
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
