# Release Checklist

This project is a pnpm workspace with three publishable packages:

- `@agent-relay/core`
- `@agent-relay/cli`
- `@agent-relay/mcp-server`

## Automated Publishing

Releases are prepared and published by GitHub Actions:

1. Run the `Prepare Release` workflow from GitHub Actions and choose `patch`,
   `minor`, or `major`.
2. The workflow bumps every package version, commits the change, creates the
   matching `v*` tag, and pushes it.
3. The pushed tag starts `.github/workflows/release.yml`, which publishes npm
   packages and creates or updates the GitHub Release.

For every release it:

1. Checks that the tag version matches all workspace package versions.
2. Runs `pnpm run release:check`.
3. Publishes packages to npm in dependency order.
4. Creates or updates the GitHub Release.

The workflow supports npm Trusted Publishing via GitHub OIDC. In npm, configure
each package with this trusted publisher:

- Repository: `LevDomasnih/agent-relay`
- Workflow: `release.yml`
- Environment: empty

Packages:

- `@agent-relay/core`
- `@agent-relay/cli`
- `@agent-relay/mcp-server`

If Trusted Publishing is not enabled yet, add a GitHub Actions secret named
`NPM_TOKEN` with publish access to these packages. Trusted Publishing is
preferred because it avoids long-lived npm tokens.

## Before Releasing

1. Confirm the package scope and ownership on npm.
2. Run `pnpm install`.
3. Run `pnpm run release:check`.
4. Smoke-test the CLI in a clean git repository.
5. Smoke-test the MCP server with a real MCP client.
6. Check package contents with `pnpm run pack:dry-run`.
7. Confirm `doctor` and `migrate` work against a legacy state fixture.
8. Start `Prepare Release` from GitHub Actions.

```bash
gh workflow run prepare-release.yml -f release_type=patch
```

## Manual Publish Fallback

The release workflow publishes automatically. Use the commands below only as a
fallback. Publish core first, then CLI and MCP server:

```bash
pnpm --filter @agent-relay/core publish --access public --provenance
pnpm --filter @agent-relay/cli publish --access public --provenance
pnpm --filter @agent-relay/mcp-server publish --access public --provenance
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
