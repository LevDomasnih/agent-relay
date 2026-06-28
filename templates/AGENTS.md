# Agent Coordination

This project uses Agent Coordinator as the source of truth for parallel agent
work.

Before editing:

1. Run `agent-coordinator status`.
2. Claim a task and files/globs with `agent-coordinator claim`.
3. If another active task owns the same scope, request handoff instead of
   editing.

Before final response, pause, or handoff:

1. Update task status.
2. Release locks that are no longer needed.
3. Record blockers with exact missing input.
4. Export a snapshot if the user or reviewer needs a Markdown view.

Do not treat generated Markdown snapshots as the source of truth.
