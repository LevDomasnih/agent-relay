# @agent-relay/cli

Command-line interface for Agent Relay: a project-local coordination layer
for parallel AI coding agents.

Use it to create tasks, claim file scopes, exchange handoffs, verify commits,
and keep agent work visible without a hosted service.

Prefer `@agent-relay/mcp-server` when Codex or another MCP client should call
the protocol directly. Use this CLI for humans, git hooks, CI checks, shell
completions, and debugging.

## Install

```bash
npm install -g @agent-relay/cli
```

or run it directly:

```bash
npx @agent-relay/cli init
```

## Quick Start

```bash
agent-relay init
agent-relay create --title "Fix checkout" --scope "frontend" --files "src/checkout/**"
agent-relay claim --task AGT-20260628-001 --agent codex --agent-instance codex_1
agent-relay verify-worktree --agent-instance codex_1
agent-relay doctor
```

## Useful Commands

```text
status, create, claim, update, heartbeat, release
mine, conflicts, message, inbox, presence, watch
handoff request, handoff respond, handoff list
verify-worktree, verify-commit, verify-commit-range
doctor, migrate, install-hooks
```

Full documentation: https://github.com/LevDomasnih/agent-relay#readme
