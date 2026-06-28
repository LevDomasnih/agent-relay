# @coordinaut/cli

Command-line interface for Coordinaut: a project-local coordination layer
for parallel AI coding agents.

Use it to create tasks, claim file scopes, exchange handoffs, verify commits,
and keep agent work visible without a hosted service.

Prefer `@coordinaut/mcp-server` when Codex or another MCP client should call
the protocol directly. Use this CLI for humans, git hooks, CI checks, shell
completions, and debugging.

## Install

```bash
npm install -g @coordinaut/cli
```

or run it directly:

```bash
npx @coordinaut/cli init
```

## Quick Start

```bash
coordinaut init
coordinaut create --title "Fix checkout" --scope "frontend" --files "src/checkout/**"
coordinaut claim --task AGT-20260628-001 --agent codex --agent-instance codex_1
coordinaut verify-worktree --agent-instance codex_1
coordinaut doctor
```

## Useful Commands

```text
status, create, claim, update, heartbeat, release
mine, conflicts, message, inbox, presence, watch
handoff request, handoff respond, handoff list
verify-worktree, verify-commit, verify-commit-range
doctor, migrate, install-hooks
```

Full documentation: https://github.com/LevDomasnih/coordinaut#readme
