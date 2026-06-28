# Release Checklist

This project is a pnpm workspace with three publishable packages:

- `@agent-relay/core`
- `@agent-relay/cli`
- `@agent-relay/mcp-server`

## Before Publishing

1. Confirm the package scope and ownership on npm.
2. Run `pnpm install`.
3. Run `pnpm run release:check`.
4. Smoke-test the CLI in a clean git repository.
5. Smoke-test the MCP server with a real MCP client.
6. Check package contents with `pnpm run pack:dry-run`.
7. Confirm `doctor` and `migrate` work against a legacy state fixture.
8. Tag the release after publish.

## Publish Order

Publish core first, then CLI and MCP server:

```bash
pnpm --filter @agent-relay/core publish --access public
pnpm --filter @agent-relay/cli publish --access public
pnpm --filter @agent-relay/mcp-server publish --access public
```

## Post-Publish Smoke

```bash
tmp="$(mktemp -d)"
cd "$tmp"
git init
npx @agent-relay/cli init
npx @agent-relay/cli doctor
npx @agent-relay/cli create --title "Smoke" --scope "src" --files "src/**"
npx @agent-relay/cli status
```

## Notes

- Do not publish `.agent-relay/`, `node_modules/`, or `dist` from the
  repository root.
- Keep generated snapshots as human-readable output only.
- Commit trailers are part of the public workflow contract; do not remove them
  from docs or examples.
