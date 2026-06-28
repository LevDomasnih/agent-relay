# @coordinaut/server

Hosted sync backend and read-only dashboard for Coordinaut teams.

It stores team/project coordinator documents in SQLite and exposes the remote
storage API used by `@coordinaut/core`.

## Run

```bash
COORDINAUT_SERVER_TOKEN="<set-a-local-token>" \
COORDINAUT_SERVER_DATA_DIR=.coordinaut-server \
coordinaut-server
```

Open the dashboard:

```text
http://localhost:3737/dashboard
```

Then initialize a project against the backend:

```bash
COORDINAUT_TOKEN="<set-a-local-token>" coordinaut init \
  --storage remote \
  --remote-url http://localhost:3737 \
  --team my-team \
  --project my-project
```

## Multi-Tenant Tokens

For multiple teams or roles, use `COORDINAUT_SERVER_TOKENS`:

```json
{
  "<admin-token>": { "team": "platform", "role": "admin" },
  "<member-token>": { "team": "platform", "role": "member" },
  "<read-token>": { "team": "platform", "role": "read" }
}
```

Roles:

- `admin` and `member` can read and write.
- `read` can only read team/project state and dashboard data.
- Team-scoped tokens cannot access another team.

## Dashboard And Hardening

The server exposes:

```text
GET /dashboard
GET /v1/teams/:team/projects
GET /v1/teams/:team/projects/:project/summary
GET /v1/teams/:team/projects/:project/audit
```

Hosted safeguards include ETag/`If-Match` stale-write protection, request ids,
security headers, no-store responses, body-size limits through
`COORDINAUT_SERVER_MAX_BODY_BYTES`, and an optional CORS allowlist through
`COORDINAUT_SERVER_ALLOWED_ORIGINS`.
