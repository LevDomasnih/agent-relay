# Agent Relay

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

Koordiniere mehrere AI Coding Agents in einem git Repository.

Agent Relay gibt Codex, Claude Code, Cursor und anderen Coding Agents ein
kleines project-local Protokoll: Tasks, scoped locks, leases, handoffs,
Nachrichten, Prüfungen, Markdown snapshots und git attribution.

Es ist die Schicht zwischen "alle editieren `AGENT_TASKS.md` per Hand" und "wir
brauchen eine gehostete Orchestrierungsplattform".

```text
agent-relay claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-relay verify-worktree --agent-instance agent_123
agent-relay release --task AGT-20260628-001 --reason "iteration finished"
```

## Was es löst

Markdown Task Boards sind gut lesbar, aber für parallele Agents fragil.

| Ohne Coordinator                                | Mit Agent Relay                                   |
| ----------------------------------------------- | ------------------------------------------------- |
| Zwei Agents greifen still auf dieselbe Datei zu | Überlappende active claims liefern einen conflict |
| Ein beendeter Agent hinterlässt stale ownership | Leases laufen ab, takeover braucht einen reason   |
| Shared files werden zu versteckten merge zones  | Handoff requests werden explizit geloggt          |
| Thread identity geht nach resume verloren       | Agent instances bleiben stabile owner             |
| Commits verlieren Kontext                       | Commit trailers verknüpfen Code mit task history  |
| Menschen brauchen weiterhin ein Board           | Markdown snapshots werden aus state erzeugt       |

State liegt direkt im Projekt:

```text
.agent-relay/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

Kein daemon. Kein database server. Kein state in `/tmp`.

## Status

Dies ist eine v0.1-ready Version. CLI, core package, MCP server, state migrations, CI checks und package dry-runs sind implementiert und getestet. Die npm packages sind noch nicht veröffentlicht.

Aus dem Source verwenden:

```bash
git clone https://github.com/LevDomasnih/agent-relay.git
cd agent-relay
pnpm install
pnpm run build
pnpm --filter @agent-relay/cli agent-relay --help
```

Geplante npm Nutzung nach dem ersten Release:

```bash
npx @agent-relay/cli init
npx @agent-relay/cli doctor
```

## Quick Start

Repository initialisieren:

```bash
agent-relay init
agent-relay doctor
```

Für mehrere git worktrees kann ein gemeinsames state directory genutzt werden:

```bash
agent-relay init --state-dir ../.agent-relay-shared
```

Task erstellen:

```bash
agent-relay create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

Vor Änderungen claimen:

```bash
agent-relay claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

Während der Arbeit:

```bash
agent-relay heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-relay update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

Vor handoff, commit oder final response prüfen:

```bash
agent-relay verify-worktree --agent-instance agent_123
```

Iteration beenden:

```bash
agent-relay update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-relay release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-relay snapshot
```

## Agent Protocol

Agents müssen nicht dieselbe Markdown Datei bearbeiten. Der Ablauf ist klein:

1. Mit `status` aktuellen Stand prüfen.
2. Mit `claim` task und file scope übernehmen.
3. Während der Arbeit `heartbeat` senden.
4. Handoff anfragen, wenn ein shared file bereits einem active claim gehört.
5. Änderungen mit `verify-worktree` oder `verify-commit` prüfen.
6. Lease freigeben, blocker notieren oder task abschließen.
7. Commit trailers hinterlassen, damit der nächste Agent Kontext hat.

Markdown snapshots sind für Menschen. Source of truth sind JSON state und JSONL
logs.

## Handoff

Wenn du einen scope brauchst, der einem anderen Agent gehört:

```bash
agent-relay handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

Der owner antwortet:

```bash
agent-relay handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent frontend-codex \
  --response "will release after current verification"
```

Statuswerte: `grant_after_commit`, `handoff_now`, `denied`, `cancelled`.

## Inbox und Presence

Agents können über inbox kommunizieren:

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

Broadcast, mentions, presence und watch werden ebenfalls unterstützt:

```bash
agent-relay message --from-agent release-codex --broadcast --kind blocker --text "Release branch is frozen."
agent-relay presence
agent-relay watch --limit 20
```

## Checks und Git Hooks

```bash
agent-relay verify-worktree --agent-instance agent_123
agent-relay verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Hooks installieren:

```bash
agent-relay install-hooks
export AGENT_RELAY_INSTANCE=agent_123
```

Für PR/CI:

```bash
agent-relay verify-commit-range --range "origin/main..HEAD"
```

Designregel:

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

Vorherige git identity wiederherstellen:

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

Die meisten tools akzeptieren optional `root`. Übergib möglichst den repository
root, damit der server state nicht in das falsche Verzeichnis schreibt.

## Wichtige Befehle

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
