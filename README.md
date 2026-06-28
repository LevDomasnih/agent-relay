# Agent Relay

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/badge/npm-v0.1.4-cb3837.svg)](https://www.npmjs.com/package/@agent-relay/cli)

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

Coordinate multiple AI coding agents inside one git repository.

Agent Relay gives Codex, Claude Code, Cursor, and other coding agents a
small shared protocol for task ownership, scoped locks, handoffs, messages,
leases, verification checks, generated snapshots, and git attribution.

It is the missing layer between "everyone edits `AGENT_TASKS.md` by hand" and
"we need a hosted orchestration platform".

```text
agent-relay claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-relay verify-worktree --agent-instance agent_123
agent-relay release --task AGT-20260628-001 --reason "iteration finished"
```

## What It Solves

Markdown task boards are great for people and brittle for parallel agents.

| Without a coordinator                      | With Agent Relay                               |
| ------------------------------------------ | ---------------------------------------------- |
| Two agents can grab the same file silently | Overlapping active claims return a conflict    |
| A dead agent leaves stale ownership behind | Leases expire, and takeover requires a reason  |
| Shared files become accidental merge zones | Handoff requests are explicit and logged       |
| Thread identity disappears after resume    | Agent instances remain stable owners           |
| Commits lose the "who and why"             | Commit trailers link code back to task history |
| Humans still need a readable board         | Markdown snapshots are generated from state    |

State is project-local and portable:

```text
.agent-relay/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

No daemon. No database server. No `/tmp` state.

## Status

Agent Relay v0.1.4 is published to npm. The CLI, core package, MCP server,
state migrations, CI checks, release dry-runs, and npm smoke test are
implemented and verified.

Install the CLI with `npx`:

```bash
npx @agent-relay/cli init
npx @agent-relay/cli doctor
```

Or run it from source:

```bash
git clone https://github.com/LevDomasnih/agent-relay.git
cd agent-relay
pnpm install
pnpm run build
pnpm --filter @agent-relay/cli agent-relay --help
```

## Quick Start

Initialize a repository:

```bash
agent-relay init
agent-relay doctor
```

For a family of git worktrees, put shared coordinator state in one directory:

```bash
agent-relay init --state-dir ../.agent-relay-shared
```

Create a task:

```bash
agent-relay create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

Claim it before editing:

```bash
agent-relay claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

Keep the lease alive while working:

```bash
agent-relay heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-relay update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

Verify before handoff, commit, or final response:

```bash
agent-relay verify-worktree --agent-instance agent_123
```

Finish the iteration:

```bash
agent-relay update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-relay release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-relay snapshot
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
agent-relay handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

The owner responds:

```bash
agent-relay handoff respond \
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
agent-relay message \
  --from-agent frontend-codex \
  --from-agent-instance agent_123 \
  --to-agent-instance agent_456 \
  --kind question \
  --text "Can you take package.json after this commit?"

agent-relay inbox --agent-instance agent_456
agent-relay inbox-read --agent-instance agent_456 --messages msg_...
```

Broadcasts and mentions are supported too:

```bash
agent-relay message \
  --from-agent release-codex \
  --broadcast \
  --kind blocker \
  --text "Release branch is frozen until CI recovers."
```

See who is active and what they hold:

```bash
agent-relay presence
agent-relay watch --limit 20
```

## Verification And Git Hooks

MCP makes the protocol easy to call, but MCP alone cannot force agents to use
it. Agent Relay includes local checks for the boring-but-important part:
"are these files actually claimed by this agent?"

```bash
agent-relay verify-worktree --agent-instance agent_123
agent-relay verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Install local hooks:

```bash
agent-relay install-hooks
export AGENT_RELAY_INSTANCE=agent_123
```

The design rule:

```text
MCP is the protocol. Hooks and checks are the enforcement.
```

For PR and CI checks, verify the commit range:

```bash
agent-relay verify-commit-range --range "origin/main..HEAD"
```

This checks commit trailers and, when the referenced task exists in local
coordinator state, verifies changed files against that task's claimed scope.

## Git Attribution

Set local git identity for the current agent:

```bash
agent-relay git-identity \
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
agent-relay git-identity-reset
```

Commit trailers are the durable attribution layer. Local git identity is only a
convenience.

## Explain What Happened

The next agent can reconstruct context from task events, messages, handoffs,
and commit trailers:

```bash
agent-relay explain --task AGT-20260628-001
agent-relay explain --commit 0c464bc
```

Use this before resuming old work, reviewing a suspicious commit, or deciding
whether a stale lease can be taken over.

## MCP Server

Run the server:

```bash
agent-relay-mcp
```

Example client configuration:

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

Most tools accept optional `root`. Prefer passing the repository root from the
client so the server never writes coordinator state in the wrong directory.

### MCP Tools

| Tool                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `init_project`        | Initialize `.agent-relay`                            |
| `create_task`         | Create a task                                        |
| `claim_task`          | Claim task scopes                                    |
| `update_task`         | Update status, checks, blockers, and next steps      |
| `heartbeat`           | Extend a lease                                       |
| `release_task`        | Release a lease                                      |
| `list_tasks`          | List tasks                                           |
| `list_my_tasks`       | List tasks by agent, instance, or thread             |
| `detect_conflicts`    | Detect active scope conflicts                        |
| `request_handoff`     | Request a handoff                                    |
| `respond_handoff`     | Respond to a handoff                                 |
| `list_handoffs`       | List handoff requests                                |
| `post_message`        | Append a message                                     |
| `export_snapshot`     | Generate `TASKS.md`                                  |
| `explain`             | Explain a task or commit                             |
| `git_identity`        | Set local git identity                               |
| `git_identity_reset`  | Restore previous git identity                        |
| `doctor`              | Diagnose setup                                       |
| `migrate_state`       | Normalize state schema and write a backup if needed  |
| `verify_worktree`     | Check modified files against claims                  |
| `verify_commit`       | Check staged files and trailers                      |
| `verify_commit_range` | Check commit trailers and task scopes across a range |
| `install_hooks`       | Install local git hooks                              |

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
migrate
verify-worktree
verify-commit
verify-commit-range
```

Run `agent-relay <command> --help` for command-specific options.

## Multi-Worktree Caveat

By default one checkout has one `.agent-relay` state. If agents work in
separate worktrees or clones, initialize each checkout with the same state
directory:

```bash
agent-relay init --state-dir /path/to/shared-agent-relay-state
```

`agent-relay doctor` prints the resolved root and state path so this is
visible.

## State Migrations

`agent-relay doctor` checks the state schema version. If it reports that
state requires migration, run:

```bash
agent-relay migrate
```

Migration normalizes `state.json` to the current schema and writes a
`state.json.bak-*` backup before changing the file.

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
node /path/to/agent-relay/packages/cli/dist/index.js init
node /path/to/agent-relay/packages/cli/dist/index.js doctor
```

Release notes live in [docs/release.md](docs/release.md).

Releases are automated from Conventional Commits on `main`: `feat` creates a
minor release, `fix`/`perf` create a patch release, and `!` or
`BREAKING CHANGE:` creates a major release. The workflow bumps versions, commits
the release, tags it, publishes npm packages, and creates or updates the GitHub
Release. See [docs/release.md](docs/release.md) for details.

## Roadmap

- First npm release.
- SQLite storage adapter.
- Shared state directory for worktree families.
- Remote backend for distributed teams.
- Richer MCP client smoke tests.
- Generated shell completions.

## License

MIT
