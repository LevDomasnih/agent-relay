# Agent Relay

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/LevDomasnih/agent-relay/actions/workflows/agent-relay.yml/badge.svg)](https://github.com/LevDomasnih/agent-relay/actions/workflows/agent-relay.yml)

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

Agent Relay is a coordination layer for parallel AI coding agents working in
the same repository.

It gives Codex, Claude Code, Cursor, and other agents one shared protocol for
task ownership, scoped file locks, handoffs, inbox messages, leases,
verification checks, generated human snapshots, and git attribution.

```text
agent-relay claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-relay verify-worktree --agent-instance agent_123
agent-relay release --task AGT-20260628-001 --reason "iteration finished"
```

Use it when one agent is no longer enough, but a full hosted orchestration
platform is too much.

## At A Glance

| Need                                      | Agent Relay gives you                                 |
| ----------------------------------------- | ----------------------------------------------------- |
| Run 2-5 coding agents in one repo         | Explicit task claims and scoped file ownership        |
| Avoid accidental overlap                  | Conflict checks for active leases and file scopes     |
| Let agents ask each other for handoff     | Handoff requests, directed messages, broadcasts       |
| Keep work explainable after thread resume | Events, inbox history, snapshots, and commit trailers |
| Start local, grow into a team setup       | JSON, SQLite, or hosted remote storage behind one API |
| Use CLI or MCP clients                    | Same protocol through terminal commands and MCP tools |

## Install

npm publishing is pending until the final public package scope is available or
renamed. For now, run from source:

```bash
git clone https://github.com/LevDomasnih/agent-relay.git
cd agent-relay
pnpm install
pnpm run build
pnpm --filter @agent-relay/cli agent-relay --help
```

Once packages are published, the intended CLI flow is:

```bash
npx @agent-relay/cli init
npx @agent-relay/cli doctor
```

## 60-Second Workflow

```bash
agent-relay init

agent-relay create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"

agent-relay claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"

# edit code...

agent-relay verify-worktree --agent-instance agent_123
agent-relay update --task AGT-20260628-001 --status verifying --next "run regression"
agent-relay release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-relay snapshot
```

## How Agents Coordinate

```mermaid
flowchart LR
  A["Agent starts"] --> B["status / inbox"]
  B --> C["claim task + files"]
  C --> D{"scope conflict?"}
  D -- "yes" --> E["handoff request"]
  E --> F["owner responds"]
  F --> C
  D -- "no" --> G["edit + heartbeat"]
  G --> H["verify-worktree / verify-commit"]
  H --> I{"checks pass?"}
  I -- "no" --> G
  I -- "yes" --> J["commit trailers + release"]
  J --> K["snapshot + explainable history"]
```

The important rule is simple: agents do not coordinate by racing to edit the
same Markdown file. They coordinate through a small state machine, and the
generated Markdown snapshot is just the human-readable view.

## Storage Choices

| Mode     | Best for                         | Command                                 |
| -------- | -------------------------------- | --------------------------------------- |
| `json`   | Default local use                | `agent-relay init`                      |
| `sqlite` | Larger long-lived local projects | `agent-relay init --storage sqlite`     |
| `remote` | Distributed teams / hosted sync  | `agent-relay init --storage remote ...` |

Remote team setup:

```bash
AGENT_RELAY_SERVER_TOKEN="<set-a-local-token>" agent-relay-server

AGENT_RELAY_TOKEN="<set-a-local-token>" agent-relay init \
  --storage remote \
  --remote-url http://localhost:3737 \
  --team platform \
  --project web-app
```

The hosted server stores team/project state in SQLite, uses Bearer-token auth,
supports `admin`, `member`, and `read` roles, and protects stale writes with
ETag/`If-Match`.

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
  state.json          # default JSON storage
  state.sqlite        # optional SQLite storage
  snapshots/
    TASKS.md
```

No `/tmp` state. Start with local files, move to SQLite for long-lived projects,
or point the same CLI/MCP protocol at a hosted team backend.

## Status

Agent Relay is source-ready for a first public release. The CLI, core package,
MCP server, hosted sync server, JSON/SQLite/remote storage adapters, state
migrations, CI checks, package dry-runs, CLI smoke test, real MCP client smoke
test, and hosted server smoke test are implemented and verified.

npm publishing is intentionally pending until the final public package scope is
available or renamed.

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

The generated Markdown snapshot is for humans. The coordinator state, event
log, and message log are the source of truth.

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

Agents can talk through an inbox instead of scraping raw event logs:

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
completion
```

Run `agent-relay <command> --help` for command-specific options.

Generate shell completions:

```bash
agent-relay completion bash > ~/.agent-relay-completion.bash
agent-relay completion zsh > _agent-relay
agent-relay completion fish > ~/.config/fish/completions/agent-relay.fish
```

## Storage Modes

| Mode     | Use for                           | State location                         |
| -------- | --------------------------------- | -------------------------------------- |
| `json`   | Default local projects            | `.agent-relay/state.json` + JSONL logs |
| `sqlite` | Larger long-lived local projects  | `.agent-relay/state.sqlite`            |
| `remote` | Distributed teams and hosted sync | `agent-relay-server` over HTTP         |

This is the same choice shown near the top, with the operational details kept
here for people wiring real projects.

`agent-relay init --storage sqlite` keeps the same CLI and MCP behavior while
storing state, events, and messages in SQLite.

`agent-relay init --storage remote` writes a local config that points to a
hosted backend. All normal commands (`create`, `claim`, `message`, `doctor`,
MCP tools, and verification) use the remote team/project state.

## Hosted Sync Server

Run the backend:

```bash
AGENT_RELAY_SERVER_TOKEN="<set-a-local-token>" \
AGENT_RELAY_SERVER_DATA_DIR=.agent-relay-server \
agent-relay-server
```

The server stores team/project data in SQLite and exposes:

```text
GET  /health
GET  /v1/teams/:team/projects/:project/config
PUT  /v1/teams/:team/projects/:project/config
GET  /v1/teams/:team/projects/:project/state
PUT  /v1/teams/:team/projects/:project/state
GET  /v1/teams/:team/projects/:project/events
POST /v1/teams/:team/projects/:project/events
GET  /v1/teams/:team/projects/:project/messages
POST /v1/teams/:team/projects/:project/messages
POST /v1/teams/:team/projects/:project/backups
```

Auth is Bearer-token based. For one admin token, set
`AGENT_RELAY_SERVER_TOKEN`. For multiple teams or roles, set
`AGENT_RELAY_SERVER_TOKENS`:

```json
{
  "<admin-token>": { "team": "platform", "role": "admin" },
  "<read-token>": { "team": "platform", "role": "read" }
}
```

Roles:

- `admin` and `member` can read and write.
- `read` can only read team/project state.

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

Migration normalizes coordinator state to the current schema and writes a
storage-specific backup before changing it.

## Development

```bash
pnpm install
pnpm run format
pnpm run check
pnpm run test
pnpm run build
```

Smoke-test the built CLI, MCP server, and hosted sync backend:

```bash
pnpm run smoke:cli
pnpm run smoke:mcp
pnpm run smoke:server
```

Release notes live in [docs/release.md](docs/release.md).

Releases are automated from Conventional Commits on `main`: `feat` creates a
minor release, `fix`/`perf` create a patch release, and `!` or
`BREAKING CHANGE:` creates a major release. The workflow bumps versions, commits
the release, tags it, and creates or updates the GitHub Release. npm publishing
is enabled once the public package scope is available and `NPM_TOKEN` is
configured. See [docs/release.md](docs/release.md) for details.

## First-Version Baseline

Implemented:

- Shared state directory for worktree families.
- SQLite storage adapter for larger long-lived projects.
- Remote backend for distributed teams.
- Hosted sync with Bearer auth and team/project namespaces.
- Richer MCP client smoke tests.
- Generated shell completions.

## Roadmap

- First npm release after the public package scope is available or renamed.
- Web dashboard.
- Hosted multi-tenant deployment hardening.

## License

MIT
