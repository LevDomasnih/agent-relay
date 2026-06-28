# Release Checklist

This project is a pnpm workspace with four publishable packages:

- `@coordinaut/core`
- `@coordinaut/cli`
- `@coordinaut/mcp-server`
- `@coordinaut/server`

## Automated Publishing

Releases are prepared from Conventional Commits on `main` by GitHub Actions.
npm publishing is enabled for the `@coordinaut` scope through GitHub Actions.
The release workflow can use npm Trusted Publishing or the `NPM_TOKEN` GitHub
Actions secret:

1. Merge or push conventional commits to `main`.
2. `.github/workflows/conventional-release.yml` looks at commits since the latest
   `v*` tag and decides the bump:
   - `feat:` -> minor
   - `fix:` or `perf:` -> patch
   - `type!:` or `BREAKING CHANGE:` -> major
3. If a release is needed, it bumps every package version, commits the change,
   creates the matching `v*` tag, pushes it, and dispatches
   `.github/workflows/release.yml`.
4. `.github/workflows/release.yml` creates or updates the GitHub Release and
   publishes the packages.

For every release it:

1. Checks that the tag version matches all workspace package versions.
2. Runs `pnpm run release:check`.
3. Checks package contents with `npm pack --dry-run`.
4. Publishes packages to npm in dependency order.
5. Creates or updates the GitHub Release.

The workflow supports npm Trusted Publishing via GitHub OIDC. In npm, configure
each package with this trusted publisher:

- Repository: `LevDomasnih/coordinaut`
- Workflow: `release.yml`
- Environment: empty

Packages:

- `@coordinaut/core`
- `@coordinaut/cli`
- `@coordinaut/mcp-server`
- `@coordinaut/server`

If Trusted Publishing is not enabled yet, add a GitHub Actions secret named
`NPM_TOKEN` with publish access to these packages. For accounts with 2FA, this
must be a granular automation token that can bypass two-factor authentication
for publish operations; a regular login token will fail with npm `EOTP`.
Trusted Publishing is preferred because it avoids long-lived npm tokens.

## Before Releasing

1. Confirm package ownership on npm.
2. Run `pnpm install`.
3. Run `pnpm run release:check`.
4. Smoke-test the CLI in a clean git repository.
5. Smoke-test the MCP server with a real MCP client.
6. Smoke-test the hosted sync server.
7. Check package contents with `pnpm run pack:dry-run`.
8. Confirm `doctor` and `migrate` work against a legacy state fixture.
9. Merge a conventional commit to `main`, or run `Conventional Release` manually
   if you need to re-check the current commit range.

```bash
git commit -m "feat: add hosted sync"
git push origin main
```

`Prepare Release` is kept as a manual fallback when you need to force a specific
`patch`, `minor`, or `major` bump.

## Manual Publish Fallback

Use the commands below only as a fallback after npm scope ownership is resolved.
Publish core first, then CLI, MCP server, and hosted server:

```bash
pnpm --filter @coordinaut/core publish --access public --provenance
pnpm --filter @coordinaut/cli publish --access public --provenance
pnpm --filter @coordinaut/mcp-server publish --access public --provenance
pnpm --filter @coordinaut/server publish --access public --provenance
```

## Post-Publish Smoke

```bash
tmp="$(mktemp -d)"
cd "$tmp"
git init
npx @coordinaut/cli init
npx @coordinaut/cli doctor
npx @coordinaut/cli create --title "Smoke" --scope "src" --files "src/**"
npx @coordinaut/cli status
```

## Notes

- Do not publish `.coordinaut/`, `node_modules/`, or `dist` from the
  repository root.
- Keep generated snapshots as human-readable output only.
- Commit trailers are part of the public workflow contract; do not remove them
  from docs or examples.
