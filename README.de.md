# Agent Coordinator

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

Koordiniere mehrere AI Coding Agents in einem git Repository.

Agent Coordinator gibt Codex, Claude Code, Cursor und anderen Coding Agents ein
kleines project-local Protokoll: Tasks, scoped locks, leases, handoffs,
Nachrichten, Prüfungen, Markdown snapshots und git attribution.

Es ist die Schicht zwischen "alle editieren `AGENT_TASKS.md` per Hand" und "wir
brauchen eine gehostete Orchestrierungsplattform".

```text
agent-coordinator claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator release --task AGT-20260628-001 --reason "iteration finished"
```

## Was es löst

Markdown Task Boards sind gut lesbar, aber für parallele Agents fragil.

| Ohne Coordinator                                | Mit Agent Coordinator                             |
| ----------------------------------------------- | ------------------------------------------------- |
| Zwei Agents greifen still auf dieselbe Datei zu | Überlappende active claims liefern einen conflict |
| Ein beendeter Agent hinterlässt stale ownership | Leases laufen ab, takeover braucht einen reason   |
| Shared files werden zu versteckten merge zones  | Handoff requests werden explizit geloggt          |
| Thread identity geht nach resume verloren       | Agent instances bleiben stabile owner             |
| Commits verlieren Kontext                       | Commit trailers verknüpfen Code mit task history  |
| Menschen brauchen weiterhin ein Board           | Markdown snapshots werden aus state erzeugt       |

State liegt direkt im Projekt:

```text
.agent-coordinator/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

Kein daemon. Kein database server. Kein state in `/tmp`.

## Status

Dies ist ein early MVP. CLI, core package und MCP server sind implementiert,
getestet und publish-ready. Die npm packages sind noch nicht veröffentlicht.

Aus dem Source verwenden:

```bash
git clone https://github.com/LevDomasnih/agent-coordinator.git
cd agent-coordinator
pnpm install
pnpm run build
pnpm --filter @agent-coordinator/cli agent-coordinator --help
```

Geplante npm Nutzung nach dem ersten Release:

```bash
npx @agent-coordinator/cli init
npx @agent-coordinator/cli doctor
```

## Quick Start

Repository initialisieren:

```bash
agent-coordinator init
agent-coordinator doctor
```

Task erstellen:

```bash
agent-coordinator create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

Vor Änderungen claimen:

```bash
agent-coordinator claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

Während der Arbeit:

```bash
agent-coordinator heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-coordinator update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

Vor handoff, commit oder final response prüfen:

```bash
agent-coordinator verify-worktree --agent-instance agent_123
```

Iteration beenden:

```bash
agent-coordinator update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-coordinator release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-coordinator snapshot
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
agent-coordinator handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

Der owner antwortet:

```bash
agent-coordinator handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent frontend-codex \
  --response "will release after current verification"
```

Statuswerte: `grant_after_commit`, `handoff_now`, `denied`, `cancelled`.

## Checks und Git Hooks

```bash
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Hooks installieren:

```bash
agent-coordinator install-hooks
export AGENT_COORDINATOR_INSTANCE=agent_123
```

Designregel:

```text
MCP is the protocol. Hooks and checks are the enforcement.
```

## Git Attribution

```bash
agent-coordinator git-identity \
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
agent-coordinator git-identity-reset
```

## MCP Server

```bash
agent-coordinator-mcp
```

```json
{
  "mcpServers": {
    "agent-coordinator": {
      "command": "agent-coordinator-mcp",
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
mine, conflicts, message
handoff request, handoff respond, handoff list
snapshot, explain, doctor
git-identity, git-identity-reset
install-hooks, verify-worktree, verify-commit
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
