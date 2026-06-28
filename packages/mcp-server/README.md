# @agent-coordinator/mcp-server

MCP server for Agent Coordinator. It exposes project-local coordination tools to
Codex, Claude, Cursor, and other Model Context Protocol clients.

## Install

```bash
npm install -g @agent-coordinator/mcp-server
```

## MCP Configuration

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

You can also run it without global install:

```json
{
  "mcpServers": {
    "agent-coordinator": {
      "command": "npx",
      "args": ["@agent-coordinator/mcp-server"]
    }
  }
}
```

## Tool Surface

The server exposes task creation, claiming, status updates, conflict detection,
handoffs, directed messages, inbox reads, presence, snapshots, git identity
helpers, worktree verification, commit-range verification, diagnostics, and
state migration.

Full documentation: https://github.com/LevDomasnih/agent-coordinator#readme
