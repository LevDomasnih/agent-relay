# @agent-relay/mcp-server

MCP server for Agent Relay. It exposes project-local coordination tools to
Codex, Claude, Cursor, and other Model Context Protocol clients.

This is the intended agent-native install path. Use `@agent-relay/cli` only
when you want terminal commands, git hooks, CI checks, or local debugging.

## Install From Source

Until npm publishing is enabled:

```bash
git clone https://github.com/LevDomasnih/agent-relay.git
cd agent-relay
pnpm install
pnpm run build
```

Codex MCP configuration:

```json
{
  "mcpServers": {
    "agent-relay": {
      "command": "node",
      "args": [
        "/absolute/path/to/agent-relay/packages/mcp-server/dist/index.js"
      ]
    }
  }
}
```

## Install From npm

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
