# Agent Coordinator

Project-local coordination for parallel AI coding agents.

Agent Coordinator gives agents a shared backlog, scoped locks, heartbeat,
handoff messages, generated Markdown snapshots, and git attribution without
requiring an external service.

## Why

Markdown task boards are readable, but they are weak as a source of truth:
agents can overwrite each other, stale locks are hard to detect, and thread
identity gets lost after commits. Agent Coordinator keeps machine state in the
project and exports Markdown only as a human-readable snapshot.

## Quick start

```bash
pnpm install
pnpm build
pnpm --filter @agent-coordinator/cli agent-coordinator init
pnpm --filter @agent-coordinator/cli agent-coordinator status
pnpm --filter @agent-coordinator/mcp-server agent-coordinator-mcp
```

After `init`, the target project contains:

```text
.agent-coordinator/
  config.json
  state.json       # gitignored project-local state
  events.jsonl     # gitignored append-only event log
  snapshots/
    TASKS.md       # generated human snapshot
```

## Core ideas

- The project owns the coordination state.
- Agents claim scopes before editing.
- Leases expire if agents stop heartbeating.
- Every iteration ends with a status update or release.
- Git commits can carry agent identity and thread/task trailers.
- Markdown is generated output, not the database.

## MCP tools

- `init_project`
- `create_task`
- `claim_task`
- `update_task`
- `heartbeat`
- `release_task`
- `list_tasks`
- `list_my_tasks`
- `detect_conflicts`
- `post_message`
- `export_snapshot`
- `git_identity`

## Git attribution

```bash
agent-coordinator git-identity --agent visual-settings-codex --thread 019eff77 --task AGT-20260625-014
```

This sets local repository identity:

```text
user.name = visual-settings-codex
user.email = codex+019eff77@agent-coordinator.local
```

Use commit trailers:

```text
Agent: visual-settings-codex
Agent-Thread: 019eff77
Agent-Task: AGT-20260625-014
```

## Statuses

- `todo`
- `claimed`
- `fixing`
- `verifying`
- `blocked`
- `done`

## Repository policy snippet

See [`templates/AGENTS.md`](templates/AGENTS.md) for a paste-ready agent policy.
