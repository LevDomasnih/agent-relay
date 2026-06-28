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

Installed package usage is intended to look like this after publish:

```bash
npx @agent-coordinator/cli init
npx @agent-coordinator/cli create --title "Fix settings layout" --scope "settings" --files "src/pages/settings/**"
npx @agent-coordinator/cli claim --task AGT-20260628-001 --agent visual-codex --agent-instance agent_123 --thread 019eff77 --files "src/pages/settings/**"
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
- Human task ids and machine task ids are separate: `displayId` is shown to
  people, `id` is the stable primary key.
- Human agent names and machine agent instances are separate:
  `agentInstanceId` owns mutations and locks, `agent` is display metadata.
- Leases expire if agents stop heartbeating.
- Every iteration ends with a status update or release.
- Git commits can carry agent identity and thread/task trailers.
- Markdown is generated output, not the database.

## Lock modes

Claims use explicit lock modes:

- `exclusive`: default for code, package manifests, lockfiles, generated route
  registries, and public API indexes.
- `shared-docs`: allows parallel documentation edits when agents coordinate in
  messages or handoff notes.
- `shared-read`: allows read-oriented shared claims.
- `advisory`: records interest without blocking another claim.

Expired leases are not silently ignored. Taking over an expired scope requires
`--takeover-reason`, and the takeover is written to the event log.

## Enforcement model

MCP tools make coordination easy, but MCP alone cannot force an agent to use
them. Agent Coordinator should enforce the workflow in layers:

- repository policy in `AGENTS.md`: agents must claim before editing and update
  or release before handoff;
- `verify-worktree`: compare modified files with active claimed scopes;
- `verify-commit`: block commits when staged files are outside the claimed
  scope or commit trailers are missing;
- git hooks and CI checks: catch agents that skipped the MCP/CLI protocol.

The intended rule is simple: an agent can forget to call MCP, but it should not
be able to commit or hand off unchecked work quietly.

```bash
agent-coordinator doctor
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Minimal hook examples:

```sh
# .git/hooks/pre-commit
agent-coordinator verify-commit --agent-instance "$AGENT_COORDINATOR_INSTANCE"
```

```sh
# .git/hooks/commit-msg
agent-coordinator verify-commit --agent-instance "$AGENT_COORDINATOR_INSTANCE" --message-file "$1"
```

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
- `git_identity_reset`
- `doctor`
- `verify_worktree`
- `verify_commit`

MCP clients should pass an explicit project root whenever possible:

```json
{
  "mcpServers": {
    "agent-coordinator": {
      "command": "agent-coordinator-mcp",
      "args": [],
      "env": {
        "AGENT_COORDINATOR_INSTANCE": "agent_123"
      }
    }
  }
}
```

Each tool accepts optional `root`. Prefer passing the repository root instead of
relying on the MCP client's current working directory.

## Git attribution

```bash
agent-coordinator git-identity --agent visual-settings-codex --agent-instance agent_123 --thread 019eff77 --task AGT-20260625-014
```

This sets local repository identity:

```text
user.name = visual-settings-codex
user.email = codex+019eff77@agent-coordinator.local
```

Use commit trailers:

```text
Agent: visual-settings-codex
Agent-Instance: agent_123
Agent-Thread: 019eff77
Agent-Task: AGT-20260625-014
```

Restore the previous local identity:

```bash
agent-coordinator git-identity-reset
```

Commit trailers are the durable attribution layer. Changing local git identity
is convenience, not the source of truth.

## Multi-worktree caveat

The MVP is project-local: one checkout has one `.agent-coordinator` state. If
agents work in separate worktrees or clones, they will not see each other's
locks unless the team configures a shared state directory in a future storage
adapter. `doctor` prints the resolved root and state path so this is visible.

## Statuses

- `todo`
- `claimed`
- `fixing`
- `verifying`
- `blocked`
- `done`

## Repository policy snippet

See [`templates/AGENTS.md`](templates/AGENTS.md) for a paste-ready agent policy.
