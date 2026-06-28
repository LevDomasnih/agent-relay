# @coordinaut/core

Core project-local state, locking, handoff, verification, and git attribution
logic for Coordinaut.

Use this package when you want to embed coordination into a custom CLI, MCP
server, agent runtime, or repository automation.

```bash
npm install @coordinaut/core
```

```ts
import { AgentCoordinator } from "@coordinaut/core";

const coordinator = new AgentCoordinator(process.cwd());
await coordinator.init("my-project");
await coordinator.createTask({
  title: "Refactor checkout flow",
  scope: "frontend",
  filesGlobs: ["src/checkout/**"],
});
```

## What It Provides

- JSON-backed project state with lock-file protected writes.
- Stable machine task ids plus human-friendly display ids.
- Lease-based claims, lock modes, handoffs, and agent presence.
- Directed messages, inbox read receipts, and watch streams.
- Worktree and commit-range verification against task scopes.
- State schema migration helpers with backup creation.

## Related Packages

- `@coordinaut/cli` for terminal workflows.
- `@coordinaut/mcp-server` for Codex, Claude, Cursor, and other MCP
  clients.
- `@coordinaut/server` for hosted sync, auth, and team/project namespaces.

Full documentation: https://github.com/LevDomasnih/coordinaut#readme
