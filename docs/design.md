# Design

Agent Relay is a local coordination layer for agents working in one
repository.

The first implementation stores state under `.agent-relay/` using JSON
state plus JSONL events. Mutations acquire a short-lived lock file so concurrent
agent processes do not write at the same time.

The storage boundary is intentionally small. A later SQLite storage adapter can
replace the JSON store without changing the MCP tool contract.

## State

- tasks
- events
- messages
- leases
- project config

## Locking

Each task can own `filesGlobs`. Conflict detection uses conservative path/glob
overlap heuristics. Agents should prefer narrow scopes and release them as soon
as the current iteration no longer needs them.

## Thread identity

`threadId` is optional because not every agent runtime exposes a thread id.
When available, agents should set it on claim and in commit trailers.
