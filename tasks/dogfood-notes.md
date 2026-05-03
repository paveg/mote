# Dogfood notes

実利用で問題を洗い出すためのメモ。動かす手順 + 観点 + 診断場所。発見した issue はこのファイル末尾の "Findings" セクションか GitHub issue に積む。

## Prerequisites

```bash
bun install
mkdir -p ~/.mote/agents/default
```

最低限の workspace を用意:

```bash
cat > ~/.mote/agents/default/SOUL.md <<'EOF'
You are a helpful assistant for ryota.
Be concise. Prefer Japanese for chat, English for code.
EOF
```

`MEMORY.md` は agent が `memory_append` で書く。最初は空でよい。

API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# あるいは:
export LLM_API_KEY=sk-ant-...
export LLM_PROVIDER=openai-compat   # OpenAI / 自前 vLLM 等を使う場合
export LLM_MODEL=claude-sonnet-4-6  # default
```

## Channel ごとの smoke

### 1. CLI agent (M0+)

```bash
bun run agent
```

期待: REPL が立ち上がる。`Hello` と打つと応答が返る。`Ctrl+C` で第一回は abort、第二回で exit。

観点:

- response の速度感 (1 turn の round-trip 時間)
- session log が `~/.mote/agents/default/state.db` に書かれているか (`sqlite3 ~/.mote/agents/default/state.db 'SELECT * FROM messages ORDER BY rowid DESC LIMIT 5'`)
- `Ctrl+C` mid-call の挙動 — pentest M10 で abort signal 非伝搬を flag 済。in-flight LLM call が即停止する？(おそらく iteration 終了まで待つ)
- skill 自動 register: `~/.mote/agents/default/skills/<name>/SKILL.md` を置いて再起動 → tool list に出るか
- `/skill-name` slash command で skill を直接 invoke できるか
- memory_append が走った後、次セッションで MEMORY.md が system prompt の `<memory>` fence 内に入っているか (logs を見るか、prompt を inspect する手段が今ないので debug 仕込み要)

### 2. MCP server (M3+)

```bash
bun run mcp-serve   # stdio で listen
```

Claude Desktop / Claude Code の MCP config に登録する場合:

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
{
  "mcpServers": {
    "mote": {
      "command": "bun",
      "args": ["run", "/Users/ryota/repos/github.com/paveg/mote/src/entry/mcp-serve.ts"]
    }
  }
}
```

期待: Claude Desktop / Claude Code から 6 ツール (`list_sessions`, `get_session`, `search_sessions`, `read_memory`, `list_skills`, `invoke_skill`) が見える。

観点:

- `list_skills` が `mcp: public` skill のみ返すか (private / 未設定は隠れているか)
- `invoke_skill` 経由で skill body が想定どおり実行されるか — 結果の output が `<skill-output skill="...">` で fence されているか (M5 / ADR-0014 D3)
- `list_sessions` が default 100 で cap されるか (`MOTE_MCP_LIST_SESSIONS_LIMIT` で上書き効くか)
- `llms.txt` が `~/.mote/agents/default/llms.txt` に生成されているか、内容が SKILL.md の name/description を反映しているか
- skill body に `</skill-output>` を含めて injection 試行 → 親 LLM が騙されないか (ADR-0014 D3 は defense-in-depth、airtight 保証はしない)

### 3. A2A endpoint (M4+) — ローカル

```bash
export MOTE_A2A_TOKEN="$(openssl rand -base64 32 | tr -d '\n=')"
bun run a2a-serve   # default 127.0.0.1:8787
```

別 terminal で smoke:

```bash
# Agent card (auth 不要)
curl http://127.0.0.1:8787/.well-known/agent-card.json | jq

# 認証なし POST → 401 (allowlist auth、ADR-0011 D2 + W1 修正)
curl -X POST http://127.0.0.1:8787/ -H 'Content-Type: application/json' -d '{}' -i | head -3

# 認証あり message/send
curl -X POST http://127.0.0.1:8787/ \
  -H "Authorization: Bearer $MOTE_A2A_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "role": "user",
        "parts": [{"kind": "text", "text": "summarize: hello world"}],
        "messageId": "test-1"
      }
    }
  }' | jq
```

観点:

- `MOTE_A2A_TOKEN` 未設定 / 32 char 未満 / `testtest...` で startup fail-closed
- 非 localhost bind (`MOTE_A2A_BIND=0.0.0.0`) + TLS env なし → fail-closed
- `Authorization` header が log に出ない (W1 で実 redact 化済)
- `read_file` / `memory_*` を呼べと prompt injection しても registry に無いので空振り
- agent card は `mcp: public` skill のみ列挙
- 接続が長時間アイドルしたとき task store がメモリ食ってないか (`SqliteTaskStore` の `a2a_tasks` テーブル size: `sqlite3 ~/.mote/agents/default/state.db 'SELECT COUNT(*) FROM a2a_tasks'`)

### 4. A2A endpoint (Workers)

```bash
# 初回:
wrangler secret put MOTE_A2A_TOKEN     # CLI で対話的に投入
bun run a2a-deploy                      # = wrangler deploy
```

観点:

- Workers 上で `process.env` mutation が起きていないこと (W1 修正)
- `InMemoryTaskStore` 採用なので再起動で task 消失 — 長時間 task は client 側 retry 必要
- HTTPS は Workers default、`MOTE_A2A_TLS_*` env は不要
- `wrangler tail` で稼働ログが見える、token は出ない

### 5. Telegram gateway (M5+)

[@BotFather](https://t.me/BotFather) で bot 作成 → token 入手。自分の Telegram user id を取得:

```bash
TOKEN="<bot token>"
# 自分の bot に DM 送ってから:
curl -s "https://api.telegram.org/bot${TOKEN}/getUpdates" | jq '.result[].message.from.id'
```

```bash
export MOTE_TELEGRAM_TOKEN="$TOKEN"
export MOTE_TELEGRAM_MASTER_ID="<取得した数値>"
bun run gateway
```

観点:

- master の DM が `<skill-output>` で wrap された応答を返すか
- master 以外の Telegram 友人に DM してもらう → pairing code が両者に届くか
- `/approve <code>` で paired user が以後普通に DM できる
- paired user が `read_file` 系を呼ぼうとしても registry にいない
- `/revoke <userId>` 後、その user が DM 再送 → pairing code 再発行 (W3 修正)
- voice / photo / file → "Sorry, text only." 応答
- group chat / channel post → 無反応 (silently ignored)
- audit log: `cat ~/.mote/agents/default/telegram-audit.log` で token が出ない、code が SHA-prefix のみ
- pending pairing 連投 (W3 修正で per-user dedup) — 同一 user の DM が pending Map を膨らまさないこと
- master の DM でも `read_file` / `memory_*` は呼べない (D5 always-restricted)

## 診断場所

| 場所 | 内容 |
|---|---|
| `~/.mote/agents/default/state.db` | session log + a2a_tasks + FTS5 index (`sqlite3` で覗く) |
| `~/.mote/agents/default/MEMORY.md` | agent が書き換える user-derived 記憶。`<memory>` fence は読み込み時に付く (永続化形態は素のまま) |
| `~/.mote/agents/default/SOUL.md` | persona、operator が手動配置 (trusted at install time) |
| `~/.mote/agents/default/telegram-allowlist.json` | Telegram 承認済 user 一覧 (mode 0o600) |
| `~/.mote/agents/default/telegram-audit.log` | Telegram dispatch ごとの結果 (token 非含、code は SHA-8 prefix) |
| `~/.mote/agents/default/llms.txt` | MCP server 起動時に再生成される skill カタログ |
| `~/.mote/agents/default/skills/<name>/SKILL.md` | 自前 skill。frontmatter: `name`, `description`, optional `mcp: public/private` |

debug 出力:

```bash
MOTE_DEBUG=1 bun run agent          # 各層で console.error が増える (token redact 済、ただし err 全体表示なので W1/W2 で flag した M9 風 pattern echo は注意)
LLM_MODEL=claude-haiku-4-5-20251001 bun run agent  # 高速・低コスト
LLM_PROVIDER=openai-compat OPENAI_BASE_URL=http://localhost:11434/v1 LLM_API_KEY=ollama bun run agent  # ローカル LLM
```

## 既知の摩擦点 (pentest follow-up)

merge 済の HIGH 8 件以外で、まだ MEDIUM 6 件が hardening 待ち。実利用で表面化しそうな順:

1. **M10**: SIGINT で長 LLM call が即停止しない。`Ctrl+C` 連打しても 1 iteration 終わるまで待つ。気になったら issue 化
2. **M3**: `memory_edit` の `replace` 引数に length 制限なし。LLM が狂って巨大文字列を流すと MEMORY.md が肥大化
3. **M8**: Telegram audit log rotate なし。長期運用で disk 圧迫
4. **M9**: openai-compat の error body に upstream proxy が token 反射する場合 redact なし (現実で出るかは provider 次第)
5. **M5**: skill 名/description に改行を埋め込んだ細工 SKILL.md で llms.txt 構造が崩れる
6. **M12**: `/revoke` で unsafe integer (`-99999...`) を投げると master 側で奇妙な reply

詳細は `tasks/todo.md` の "Pentest 2026-05-03 follow-up" セクション。

## Findings (実利用で発見した問題を追記)

### YYYY-MM-DD

- **<channel>**: 一行で症状
  - 再現: <command / 状況>
  - 期待: ...
  - 実際: ...
  - 仮説: ...
  - issue: <未起票 / #N / 修正済 commit>

(template は適宜複製)
