# Agent Coordinator

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-early_MVP-f59e0b.svg)](#status)

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

Coordinate multiple AI coding agents inside one git repository.

Agent Coordinator gives Codex, Claude Code, Cursor, and other coding agents a
small shared protocol for task ownership, scoped locks, handoffs, messages,
leases, verification checks, generated snapshots, and git attribution.

It is the missing layer between "everyone edits `AGENT_TASKS.md` by hand" and
"we need a hosted orchestration platform".

```text
agent-coordinator claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator release --task AGT-20260628-001 --reason "iteration finished"
```

## What It Solves

Markdown task boards are great for people and brittle for parallel agents.

| Without a coordinator                      | With Agent Coordinator                         |
| ------------------------------------------ | ---------------------------------------------- |
| Two agents can grab the same file silently | Overlapping active claims return a conflict    |
| A dead agent leaves stale ownership behind | Leases expire, and takeover requires a reason  |
| Shared files become accidental merge zones | Handoff requests are explicit and logged       |
| Thread identity disappears after resume    | Agent instances remain stable owners           |
| Commits lose the "who and why"             | Commit trailers link code back to task history |
| Humans still need a readable board         | Markdown snapshots are generated from state    |

State is project-local and portable:

```text
.agent-coordinator/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

No daemon. No database server. No `/tmp` state.

## Status

Agent Coordinator is an early MVP. The CLI, core package, and MCP server are
implemented, tested, and publish-ready, but the packages have not been released
to npm yet.

Use it from source today:

```bash
git clone https://github.com/LevDomasnih/agent-coordinator.git
cd agent-coordinator
pnpm install
pnpm run build
pnpm --filter @agent-coordinator/cli agent-coordinator --help
```

Planned npm usage after the first release:

```bash
npx @agent-coordinator/cli init
npx @agent-coordinator/cli doctor
```

## Quick Start

Initialize a repository:

```bash
agent-coordinator init
agent-coordinator doctor
```

Create a task:

```bash
agent-coordinator create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

Claim it before editing:

```bash
agent-coordinator claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

Keep the lease alive while working:

```bash
agent-coordinator heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-coordinator update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

Verify before handoff, commit, or final response:

```bash
agent-coordinator verify-worktree --agent-instance agent_123
```

Finish the iteration:

```bash
agent-coordinator update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-coordinator release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-coordinator snapshot
```

## The Agent Protocol

Agents do not need to coordinate by editing the same Markdown file. They follow
a small lifecycle:

1. Inspect current work with `status`.
2. Claim a task and file scope before editing.
3. Heartbeat while working.
4. Request handoff if a shared file is owned by another active claim.
5. Check `inbox` for questions, blockers, handoffs, and broadcasts.
6. Verify modified or staged files against the active claim.
7. Release the lease, record a blocker, or mark the task done.
8. Leave commit trailers so future agents can explain the change.

The generated Markdown snapshot is for humans. The JSON state and JSONL logs are
the source of truth.

## Handoffs

When another agent owns a scope you need, ask for it:

```bash
agent-coordinator handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

The owner responds:

```bash
agent-coordinator handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent frontend-codex \
  --response "will release after current verification"
```

Supported responses:

- `grant_after_commit`
- `handoff_now`
- `denied`
- `cancelled`

Every request and response is written to the event log and message log.

## Agent Inbox And Presence

Agents can talk through an inbox instead of scraping JSONL logs:

```bash
agent-coordinator message \
  --from-agent frontend-codex \
  --from-agent-instance agent_123 \
  --to-agent-instance agent_456 \
  --kind question \
  --text "Can you take package.json after this commit?"

agent-coordinator inbox --agent-instance agent_456
agent-coordinator inbox-read --agent-instance agent_456 --messages msg_...
```

Broadcasts and mentions are supported too:

```bash
agent-coordinator message \
  --from-agent release-codex \
  --broadcast \
  --kind blocker \
  --text "Release branch is frozen until CI recovers."
```

See who is active and what they hold:

```bash
agent-coordinator presence
agent-coordinator watch --limit 20
```

## Verification And Git Hooks

MCP makes the protocol easy to call, but MCP alone cannot force agents to use
it. Agent Coordinator includes local checks for the boring-but-important part:
"are these files actually claimed by this agent?"

```bash
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Install local hooks:

```bash
agent-coordinator install-hooks
export AGENT_COORDINATOR_INSTANCE=agent_123
```

The design rule:

```text
MCP is the protocol. Hooks and checks are the enforcement.
```

## Git Attribution

Set local git identity for the current agent:

```bash
agent-coordinator git-identity \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --task AGT-20260628-001
```

Use commit trailers:

```text
Agent: frontend-codex
Agent-Instance: agent_123
Agent-Thread: 019eff77
Agent-Task: AGT-20260628-001
```

Restore the previous local identity:

```bash
agent-coordinator git-identity-reset
```

Commit trailers are the durable attribution layer. Local git identity is only a
convenience.

## Explain What Happened

The next agent can reconstruct context from task events, messages, handoffs,
and commit trailers:

```bash
agent-coordinator explain --task AGT-20260628-001
agent-coordinator explain --commit 0c464bc
```

Use this before resuming old work, reviewing a suspicious commit, or deciding
whether a stale lease can be taken over.

## MCP Server

Run the server:

```bash
agent-coordinator-mcp
```

Example client configuration:

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
client so the server never writes coordinator state in the wrong directory.

### MCP Tools

| Tool                 | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `init_project`       | Initialize `.agent-coordinator`                 |
| `create_task`        | Create a task                                   |
| `claim_task`         | Claim task scopes                               |
| `update_task`        | Update status, checks, blockers, and next steps |
| `heartbeat`          | Extend a lease                                  |
| `release_task`       | Release a lease                                 |
| `list_tasks`         | List tasks                                      |
| `list_my_tasks`      | List tasks by agent, instance, or thread        |
| `detect_conflicts`   | Detect active scope conflicts                   |
| `request_handoff`    | Request a handoff                               |
| `respond_handoff`    | Respond to a handoff                            |
| `list_handoffs`      | List handoff requests                           |
| `post_message`       | Append a message                                |
| `export_snapshot`    | Generate `TASKS.md`                             |
| `explain`            | Explain a task or commit                        |
| `git_identity`       | Set local git identity                          |
| `git_identity_reset` | Restore previous git identity                   |
| `doctor`             | Diagnose setup                                  |
| `verify_worktree`    | Check modified files against claims             |
| `verify_commit`      | Check staged files and trailers                 |
| `install_hooks`      | Install local git hooks                         |

## Concepts

### Tasks

Tasks have two identifiers:

- `id`: stable machine id, used as the primary key.
- `displayId`: human-facing id such as `AGT-20260628-001`.

CLI commands accept either value when it is unambiguous.

### Agent Instances

Agent names are display metadata. Agent instances own mutations and locks.

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

Use a stable `--agent-instance` value for the duration of one agent run.

### Lock Modes

| Mode          | Use for                                        | Conflict behavior                |
| ------------- | ---------------------------------------------- | -------------------------------- |
| `exclusive`   | Code, package manifests, lockfiles, registries | Blocks overlapping active claims |
| `shared-docs` | Documentation with explicit coordination       | Can overlap with `shared-docs`   |
| `shared-read` | Read-oriented shared work                      | Can overlap with `shared-read`   |
| `advisory`    | Interest tracking                              | Never blocks                     |

Expired leases are visible but not silently ignored. Taking over an expired
scope requires `--takeover-reason`.

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
inbox
inbox-read
presence
watch
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

Smoke-test the built CLI:

```bash
tmp="$(mktemp -d)"
cd "$tmp"
git init
node /path/to/agent-coordinator/packages/cli/dist/index.js init
node /path/to/agent-coordinator/packages/cli/dist/index.js doctor
```

Release notes live in [docs/release.md](docs/release.md).

## Roadmap

- First npm release.
- SQLite storage adapter.
- Shared state directory for worktree families.
- Remote backend for distributed teams.
- `verify-commit-range` and PR checks.
- Richer MCP client smoke tests.
- Generated shell completions.

## License

MIT
