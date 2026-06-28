# Agent Relay

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

1 つの git リポジトリ内で複数の AI coding agents を調整します。

Agent Relay は Codex、Claude Code、Cursor などの coding agents に、
project-local な小さなプロトコルを提供します。Tasks、scoped locks、leases、
handoffs、messages、verification checks、Markdown snapshots、git attribution を
扱えます。

これは「全員が `AGENT_TASKS.md` を手で編集する」状態と、「ホスト型の
orchestration platform が必要」な状態の間にあるレイヤーです。

```text
agent-relay claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-relay verify-worktree --agent-instance agent_123
agent-relay release --task AGT-20260628-001 --reason "iteration finished"
```

## 解決すること

Markdown の task board は人には読みやすいですが、並列 agents には壊れやすい
source of truth です。

| Coordinator なし                               | Agent Relay あり                                     |
| ---------------------------------------------- | ---------------------------------------------------- |
| 2 つの agents が同じファイルを黙って編集できる | 重複する active claims は conflict になる            |
| 終了した agent の stale ownership が残る       | Leases は期限切れになり、takeover には reason が必要 |
| Shared files が偶発的な merge zone になる      | Handoff requests が明示的に記録される                |
| Resume 後に thread identity が失われる         | Agent instances が安定した owner になる              |
| Commits から "誰がなぜ" が消える               | Commit trailers が code と task history を結ぶ       |
| 人には読みやすい board が必要                  | Markdown snapshots は state から生成される           |

State はプロジェクト内に保存されます。

```text
.agent-relay/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

Daemon なし。Database server なし。`/tmp` state なし。

## Status

これは v0.1-ready バージョンです。CLI、core package、MCP server、state migrations、CI checks、package dry-runs は実装済みでテスト済みです。npm packages はまだ公開されていません。

Source から使う:

```bash
git clone https://github.com/LevDomasnih/agent-relay.git
cd agent-relay
pnpm install
pnpm run build
pnpm --filter @agent-relay/cli agent-relay --help
```

最初の npm release 後の想定:

```bash
npx @agent-relay/cli init
npx @agent-relay/cli doctor
```

## Quick Start

Repository を初期化:

```bash
agent-relay init
agent-relay doctor
```

複数の git worktrees では shared state directory を使えます。

```bash
agent-relay init --state-dir ../.agent-relay-shared
```

Task を作成:

```bash
agent-relay create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

編集前に claim:

```bash
agent-relay claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

作業中:

```bash
agent-relay heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-relay update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

Handoff、commit、final response の前に確認:

```bash
agent-relay verify-worktree --agent-instance agent_123
```

Iteration を終了:

```bash
agent-relay update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-relay release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-relay snapshot
```

## Agent Protocol

Agents は同じ Markdown ファイルを同時に編集して調整する必要はありません。
小さな lifecycle だけです。

1. `status` で現在の状態を見る。
2. `claim` で task と file scope を取る。
3. 作業中に `heartbeat` を送る。
4. Shared file が別の active claim に属していれば handoff を依頼する。
5. `verify-worktree` または `verify-commit` で変更範囲を確認する。
6. Lease を release する、blocker を記録する、または task を完了する。
7. 次の agent が理解できるよう commit trailers を残す。

Markdown snapshot は人間向けです。Source of truth は JSON state と JSONL logs
です。

## Handoff

別の agent が owner の scope が必要な場合:

```bash
agent-relay handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

Owner が応答:

```bash
agent-relay handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent frontend-codex \
  --response "will release after current verification"
```

Status: `grant_after_commit`, `handoff_now`, `denied`, `cancelled`。

## Inbox と Presence

Agents は inbox で通信できます。

```bash
agent-relay message \
  --from-agent frontend-codex \
  --from-agent-instance agent_123 \
  --to-agent-instance agent_456 \
  --kind question \
  --text "Can you take package.json after this commit?"

agent-relay inbox --agent-instance agent_456
agent-relay inbox-read --agent-instance agent_456 --messages msg_...
```

Broadcast、mentions、presence、watch もサポートしています。

```bash
agent-relay message --from-agent release-codex --broadcast --kind blocker --text "Release branch is frozen."
agent-relay presence
agent-relay watch --limit 20
```

## Verification と Git Hooks

```bash
agent-relay verify-worktree --agent-instance agent_123
agent-relay verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Hooks をインストール:

```bash
agent-relay install-hooks
export AGENT_RELAY_INSTANCE=agent_123
```

PR/CI 用:

```bash
agent-relay verify-commit-range --range "origin/main..HEAD"
```

Design rule:

```text
MCP is the protocol. Hooks and checks are the enforcement.
```

## Git Attribution

```bash
agent-relay git-identity \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --task AGT-20260628-001
```

Commit trailers:

```text
Agent: frontend-codex
Agent-Instance: agent_123
Agent-Thread: 019eff77
Agent-Task: AGT-20260628-001
```

以前の git identity に戻す:

```bash
agent-relay git-identity-reset
```

## MCP Server

```bash
agent-relay-mcp
```

```json
{
  "mcpServers": {
    "agent-relay": {
      "command": "agent-relay-mcp",
      "args": []
    }
  }
}
```

ほとんどの tools は optional `root` を受け取ります。Server が間違った場所に
state を書かないように、repository root を明示的に渡すことを推奨します。

## Main Commands

```text
init, status, create, claim, update, heartbeat, release
mine, conflicts, message, inbox, inbox-read, presence, watch
handoff request, handoff respond, handoff list
snapshot, explain, doctor, migrate
git-identity, git-identity-reset
install-hooks, verify-worktree, verify-commit, verify-commit-range
```

## Development

```bash
pnpm install
pnpm run format
pnpm run check
pnpm run test
pnpm run build
```

## License

MIT
