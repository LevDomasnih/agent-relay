# @agent-relay/server

Hosted sync backend for Agent Relay teams.

It stores team/project coordinator documents in SQLite and exposes the remote
storage API used by `@agent-relay/core`.

## Run

```bash
AGENT_RELAY_SERVER_TOKEN=secret \
AGENT_RELAY_SERVER_DATA_DIR=.agent-relay-server \
agent-relay-server
```

Then initialize a project against the backend:

```bash
AGENT_RELAY_TOKEN=secret agent-relay init \
  --storage remote \
  --remote-url http://localhost:3737 \
  --team my-team \
  --project my-project
```
