# @coordinaut/server

Hosted sync backend for Coordinaut teams.

It stores team/project coordinator documents in SQLite and exposes the remote
storage API used by `@coordinaut/core`.

## Run

```bash
COORDINAUT_SERVER_TOKEN="<set-a-local-token>" \
COORDINAUT_SERVER_DATA_DIR=.coordinaut-server \
coordinaut-server
```

Then initialize a project against the backend:

```bash
COORDINAUT_TOKEN="<set-a-local-token>" coordinaut init \
  --storage remote \
  --remote-url http://localhost:3737 \
  --team my-team \
  --project my-project
```
