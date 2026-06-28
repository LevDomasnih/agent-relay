# @agent-coordinator/cli

Command-line interface for Agent Coordinator: a project-local coordination layer
for parallel AI coding agents.

Use it to create tasks, claim file scopes, exchange handoffs, verify commits,
and keep agent work visible without a hosted service.

## Install

```bash
npm install -g @agent-coordinator/cli
```

or run it directly:

```bash
npx @agent-coordinator/cli init
```

## Quick Start

```bash
agent-coordinator init
agent-coordinator create --title "Fix checkout" --scope "frontend" --files "src/checkout/**"
agent-coordinator claim --task AGT-20260628-001 --agent codex --agent-instance codex_1
agent-coordinator verify-worktree --agent-instance codex_1
agent-coordinator doctor
```

## Useful Commands

```text
status, create, claim, update, heartbeat, release
mine, conflicts, message, inbox, presence, watch
handoff request, handoff respond, handoff list
verify-worktree, verify-commit, verify-commit-range
doctor, migrate, install-hooks
```

Full documentation: https://github.com/LevDomasnih/agent-coordinator#readme
