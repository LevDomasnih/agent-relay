# @agent-relay/mcp-server

MCP server for Agent Relay. It exposes project-local coordination tools to
Codex, Claude, Cursor, and other Model Context Protocol clients.

## Install

```bash
npm install -g @agent-relay/mcp-server
```

## MCP Configuration

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

You can also run it without global install:

```json
{
  "mcpServers": {
    "agent-relay": {
      "command": "npx",
      "args": ["@agent-relay/mcp-server"]
    }
  }
}
```

## Tool Surface

The server exposes task creation, claiming, status updates, conflict detection,
handoffs, directed messages, inbox reads, presence, snapshots, git identity
helpers, worktree verification, commit-range verification, diagnostics, and
state migration.

Full documentation: https://github.com/LevDomasnih/agent-relay#readme
