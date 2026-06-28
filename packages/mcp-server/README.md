# @coordinaut/mcp-server

MCP server for Coordinaut. It exposes project-local coordination tools to
Codex, Claude, Cursor, and other Model Context Protocol clients.

This is the intended agent-native install path. Use `@coordinaut/cli` only
when you want terminal commands, git hooks, CI checks, or local debugging.

## Install From npm

Use it directly from npm in your MCP client:

```json
{
  "mcpServers": {
    "coordinaut": {
      "command": "npx",
      "args": ["@coordinaut/mcp-server"]
    }
  }
}
```

or install it globally:

```bash
npm install -g @coordinaut/mcp-server
```

## MCP Configuration

```json
{
  "mcpServers": {
    "coordinaut": {
      "command": "coordinaut-mcp",
      "args": []
    }
  }
}
```

## Install From Source

For local development from a checkout:

```bash
git clone https://github.com/LevDomasnih/coordinaut.git
cd coordinaut
pnpm install
pnpm run build
```

Then point your MCP client at the built server:

```json
{
  "mcpServers": {
    "coordinaut": {
      "command": "node",
      "args": ["/absolute/path/to/coordinaut/packages/mcp-server/dist/index.js"]
    }
  }
}
```

## Tool Surface

The server exposes task creation, claiming, status updates, conflict detection,
handoffs, directed messages, inbox reads, presence, snapshots, git identity
helpers, worktree verification, commit-range verification, diagnostics, and
state migration.

Full documentation: https://github.com/LevDomasnih/coordinaut#readme
