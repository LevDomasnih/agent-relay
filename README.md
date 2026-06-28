# Agent Coordinator

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Project-local coordination for parallel AI coding agents.

Agent Coordinator gives Codex, Claude Code, Cursor, and other coding agents a
shared task protocol inside a git repository: atomic-ish claims, scoped locks,
leases, handoffs, messages, generated Markdown snapshots, verification checks,
and git attribution.

It is designed for teams running more than one agent in the same codebase, where
plain Markdown task boards become fragile.

## Why Agent Coordinator?

Markdown task boards are readable, but they are a poor source of truth for
parallel agents:

| Problem                                 | What Agent Coordinator does                                  |
| --------------------------------------- | ------------------------------------------------------------ |
| Two agents claim the same work          | Claims fail when active scopes conflict                      |
| Stale locks stay forever                | Leases expire and takeover requires a reason                 |
| Shared files get silently merged        | Handoff requests are explicit and logged                     |
| Thread identity disappears after resume | Agent instances are stable owners; thread ids are metadata   |
| Commits lose context                    | Commit trailers link changes back to task, agent, and thread |
| Humans still want a board               | Markdown snapshots are generated from state                  |

State lives in the project, not in `/tmp` and not in a hosted service.

```text
.agent-coordinator/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

## Status

This is an early MVP. The CLI, core library, and MCP server are implemented and
covered by smoke-level tests. The storage backend is currently JSON +
append-only JSONL behind a `Storage` interface, with room for SQLite or a remote
backend later.

## Installation

From this workspace:

```bash
pnpm install
pnpm run build
pnpm --filter @agent-coordinator/cli agent-coordinator --help
```

After npm publish, the intended usage is:

```bash
npx @agent-coordinator/cli init
npx @agent-coordinator/cli doctor
```

MCP server:

```bash
npx @agent-coordinator/mcp-server
```

## Quick Start

Initialize a repository:

```bash
agent-coordinator init
agent-coordinator doctor
```

Create and claim a task:

```bash
agent-coordinator create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"

agent-coordinator claim \
  --task AGT-20260628-001 \
  --agent visual-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

Work loop:

```bash
agent-coordinator heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-coordinator update --task AGT-20260628-001 --status fixing --next "patch layout drift"
agent-coordinator verify-worktree --agent-instance agent_123
```

Before handing off or finishing:

```bash
agent-coordinator update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-coordinator release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-coordinator snapshot
```

## Core Concepts

### Tasks

Tasks have two identifiers:

- `id`: stable machine id, used as the primary key.
- `displayId`: human-facing id such as `AGT-20260628-001`.

CLI commands accept either value when it is unambiguous.

### Agent Instances

Agent names are for humans. Agent instances own mutations and locks.

```ts
type AgentInstance = {
  id: string;
  name: string;
  threadId?: string;
  tool: "codex" | "claude" | "cursor" | "unknown";
  startedAt: string;
  lastSeenAt: string;
};
```

Use a stable `--agent-instance` value for the duration of an agent run.

### Lock Modes

| Mode          | Use for                                        | Conflict behavior                |
| ------------- | ---------------------------------------------- | -------------------------------- |
| `exclusive`   | Code, package manifests, lockfiles, registries | Blocks overlapping active claims |
| `shared-docs` | Documentation with explicit coordination       | Can overlap with `shared-docs`   |
| `shared-read` | Read-oriented shared work                      | Can overlap with `shared-read`   |
| `advisory`    | Interest tracking                              | Never blocks                     |

Expired leases are visible but not silently ignored. Taking over an expired
scope requires `--takeover-reason`.

## Handoffs

When a second agent needs a scope owned by another active claim, it should
request handoff instead of editing.

```bash
agent-coordinator handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

The owner can respond:

```bash
agent-coordinator handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent visual-codex \
  --response "will release after current verification"
```

Response statuses:

- `grant_after_commit`
- `handoff_now`
- `denied`
- `cancelled`

All handoff requests and responses are written to events/messages.

## Git Attribution

Set local git identity for an agent task:

```bash
agent-coordinator git-identity \
  --agent visual-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --task AGT-20260628-001
```

Use commit trailers:

```text
Agent: visual-codex
Agent-Instance: agent_123
Agent-Thread: 019eff77
Agent-Task: AGT-20260628-001
```

Restore the previous local identity:

```bash
agent-coordinator git-identity-reset
```

Commit trailers are the durable attribution layer. Local git identity is a
convenience.

## Verification And Hooks

Agent Coordinator includes local enforcement commands:

```bash
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Install local hooks:

```bash
agent-coordinator install-hooks
export AGENT_COORDINATOR_INSTANCE=agent_123
```

The intended product rule is:

```text
MCP is the protocol. Hooks and checks are the enforcement.
```

## Explain History

Explain a task from coordinator events and messages:

```bash
agent-coordinator explain --task AGT-20260628-001
```

Explain a commit by reading its trailers:

```bash
agent-coordinator explain --commit 0c464bc
```

This helps the next agent answer: who changed this, for which task, under which
claim, and what handoff or evidence exists?

## MCP Usage

Run the server:

```bash
agent-coordinator-mcp
```

Example MCP configuration:

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

Most tools accept optional `root`. Prefer passing the repository root from the
client so the server never writes state in the wrong directory.

Available MCP tools:

| Tool                 | Purpose                                     |
| -------------------- | ------------------------------------------- |
| `init_project`       | Initialize `.agent-coordinator`             |
| `create_task`        | Create a task                               |
| `claim_task`         | Claim task scopes                           |
| `update_task`        | Update status, checks, blockers, next steps |
| `heartbeat`          | Extend a lease                              |
| `release_task`       | Release a lease                             |
| `list_tasks`         | List tasks                                  |
| `list_my_tasks`      | List tasks by agent, instance, or thread    |
| `detect_conflicts`   | Detect active scope conflicts               |
| `request_handoff`    | Request a handoff                           |
| `respond_handoff`    | Respond to a handoff                        |
| `list_handoffs`      | List handoff requests                       |
| `post_message`       | Append a message                            |
| `export_snapshot`    | Generate `TASKS.md`                         |
| `explain`            | Explain a task or commit                    |
| `git_identity`       | Set local git identity                      |
| `git_identity_reset` | Restore previous git identity               |
| `doctor`             | Diagnose setup                              |
| `verify_worktree`    | Check modified files against claims         |
| `verify_commit`      | Check staged files and trailers             |
| `install_hooks`      | Install local git hooks                     |

## CLI Reference

```text
init
status
create
claim
update
heartbeat
release
mine
conflicts
message
handoff request
handoff respond
handoff list
snapshot
explain
git-identity
git-identity-reset
install-hooks
doctor
verify-worktree
verify-commit
```

Run `agent-coordinator <command> --help` for command-specific options.

## Multi-Worktree Caveat

The MVP is project-local: one checkout has one `.agent-coordinator` state. If
agents work in separate worktrees or clones, they will not see each other's
locks unless the team uses a shared state directory or a future shared backend.

`agent-coordinator doctor` prints the resolved root and state path so this is
visible.

## Development

```bash
pnpm install
pnpm run format
pnpm run check
pnpm run test
pnpm run build
```

Smoke-test the CLI:

```bash
tmp="$(mktemp -d)"
cd "$tmp"
git init
node /path/to/agent-coordinator/packages/cli/dist/index.js init
node /path/to/agent-coordinator/packages/cli/dist/index.js doctor
```

Release notes live in [docs/release.md](docs/release.md).

## Roadmap

- SQLite storage adapter.
- Shared state directory for worktree families.
- Remote backend for distributed teams.
- `verify-commit-range` / PR checks.
- Richer MCP client smoke tests.
- Generated shell completions.

## License

MIT
