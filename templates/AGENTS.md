# Agent Coordination

This project uses Agent Coordinator as the source of truth for parallel agent
work.

Before editing:

1. Run `agent-coordinator status`.
2. Claim a task and files/globs with `agent-coordinator claim`.
3. If another active task owns the same scope, request handoff instead of
   editing.
4. Run `agent-coordinator verify-worktree` before broad edits or handoff.

Before final response, pause, or handoff:

1. Update task status.
2. Release locks that are no longer needed.
3. Record blockers with exact missing input.
4. Export a snapshot if the user or reviewer needs a Markdown view.

Commit rules:

- Commits must include `Agent` and `Agent-Task` trailers.
- Prefer adding `Agent-Instance` and `Agent-Thread` trailers too.
- Staged files must fit the active claim for the agent instance.
- If a commit touches a shared file, the handoff or takeover reason must be in
  coordinator events/messages.

Do not treat generated Markdown snapshots as the source of truth.
