#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  AgentCoordinator,
  TASK_STATUSES,
  findProjectRoot,
  type AgentTool,
  type HandoffStatus,
  type LockMode,
  type MessageKind,
  type TaskStatus,
} from "@levdomasnih/agent-relay-core";
import { z } from "zod";

const server = new McpServer({ name: "agent-relay", version: "0.1.0" });

const taskStatusSchema = z.enum(TASK_STATUSES);
const listSchema = z.array(z.string()).optional();
const lockModeSchema = z
  .enum(["exclusive", "shared-read", "shared-docs", "advisory"])
  .optional();
const toolSchema = z.enum(["codex", "claude", "cursor", "unknown"]).optional();
const handoffStatusSchema = z.enum([
  "requested",
  "grant_after_commit",
  "handoff_now",
  "denied",
  "cancelled",
]);
const handoffResponseStatusSchema = z.enum([
  "grant_after_commit",
  "handoff_now",
  "denied",
  "cancelled",
]);
const messageKindSchema = z
  .enum([
    "note",
    "question",
    "blocker",
    "ready_for_review",
    "handoff",
    "decision",
  ])
  .optional();

server.registerTool(
  "init_project",
  {
    title: "Initialize Project",
    description: "Initialize Agent Relay in the current project.",
    inputSchema: z.object({
      projectName: z.string().optional(),
      stateDir: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ projectName, stateDir, root }) => {
    const coordinator = new AgentCoordinator(root ?? process.cwd(), undefined, {
      stateDir,
    });
    const config = await coordinator.init(projectName, { stateDir });
    return jsonResult({ ok: true, config });
  },
);

server.registerTool(
  "create_task",
  {
    title: "Create Task",
    description: "Create a project-local coordination task.",
    inputSchema: z.object({
      id: z.string().optional(),
      displayId: z.string().optional(),
      title: z.string(),
      scope: z.string(),
      filesGlobs: listSchema,
      lockMode: lockModeSchema,
      checks: listSchema,
      next: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async (input) => {
    const coordinator = await loadCoordinator(input.root);
    return jsonResult({
      ok: true,
      task: await coordinator.createTask({
        ...input,
        lockMode: input.lockMode as LockMode | undefined,
      }),
    });
  },
);

server.registerTool(
  "claim_task",
  {
    title: "Claim Task",
    description:
      "Claim a task and active files/globs. Fails if active leases conflict.",
    inputSchema: z.object({
      taskId: z.string(),
      agent: z.string(),
      agentInstanceId: z.string().optional(),
      threadId: z.string().optional(),
      tool: toolSchema,
      branch: z.string().optional(),
      filesGlobs: listSchema,
      lockMode: lockModeSchema,
      leaseMinutes: z.number().int().positive().optional(),
      takeoverReason: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async (input) => {
    const coordinator = await loadCoordinator(input.root);
    return jsonResult({
      ok: true,
      task: await coordinator.claimTask({
        ...input,
        tool: input.tool as AgentTool | undefined,
        lockMode: input.lockMode as LockMode | undefined,
      }),
    });
  },
);

server.registerTool(
  "update_task",
  {
    title: "Update Task",
    description: "Update task status, blockers, checks, and handoff fields.",
    inputSchema: z.object({
      taskId: z.string(),
      status: taskStatusSchema,
      agent: z.string().optional(),
      agentInstanceId: z.string().optional(),
      threadId: z.string().optional(),
      scope: z.string().optional(),
      filesGlobs: listSchema,
      lockMode: lockModeSchema,
      checks: listSchema,
      next: z.string().optional(),
      blocker: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async (input) => {
    const coordinator = await loadCoordinator(input.root);
    return jsonResult({
      ok: true,
      task: await coordinator.updateTask({
        ...input,
        status: input.status as TaskStatus,
        lockMode: input.lockMode as LockMode | undefined,
      }),
    });
  },
);

server.registerTool(
  "heartbeat",
  {
    title: "Heartbeat",
    description: "Extend the current task lease.",
    inputSchema: z.object({
      taskId: z.string(),
      agent: z.string().optional(),
      agentInstanceId: z.string().optional(),
      threadId: z.string().optional(),
      leaseMinutes: z.number().int().positive().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ taskId, agent, agentInstanceId, threadId, leaseMinutes, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      task: await coordinator.heartbeat(
        taskId,
        agent,
        threadId,
        leaseMinutes,
        agentInstanceId,
      ),
    });
  },
);

server.registerTool(
  "release_task",
  {
    title: "Release Task",
    description: "Release a task lease.",
    inputSchema: z.object({
      taskId: z.string(),
      agent: z.string().optional(),
      agentInstanceId: z.string().optional(),
      reason: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ taskId, agent, agentInstanceId, reason, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      task: await coordinator.releaseTask(
        taskId,
        agent,
        reason,
        agentInstanceId,
      ),
    });
  },
);

server.registerTool(
  "list_tasks",
  {
    title: "List Tasks",
    description: "List project tasks.",
    inputSchema: z.object({
      status: taskStatusSchema.optional(),
      root: z.string().optional(),
    }),
  },
  async ({ status, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      tasks: await coordinator.listTasks(status as TaskStatus | undefined),
    });
  },
);

server.registerTool(
  "list_my_tasks",
  {
    title: "List My Tasks",
    description: "List tasks by agent name or thread id.",
    inputSchema: z.object({
      agent: z.string().optional(),
      agentInstanceId: z.string().optional(),
      threadId: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ agent, agentInstanceId, threadId, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      tasks: await coordinator.listMyTasks(agent, threadId, agentInstanceId),
    });
  },
);

server.registerTool(
  "detect_conflicts",
  {
    title: "Detect Conflicts",
    description: "Detect active task conflicts for files/globs.",
    inputSchema: z.object({
      filesGlobs: z.array(z.string()),
      excludeTaskId: z.string().optional(),
      lockMode: lockModeSchema,
      root: z.string().optional(),
    }),
  },
  async ({ filesGlobs, excludeTaskId, lockMode, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      conflicts: await coordinator.detectConflicts(
        filesGlobs,
        excludeTaskId,
        lockMode as LockMode | undefined,
      ),
    });
  },
);

server.registerTool(
  "post_message",
  {
    title: "Post Message",
    description: "Post an agent, task, or thread message.",
    inputSchema: z.object({
      kind: messageKindSchema,
      fromAgent: z.string(),
      fromAgentInstanceId: z.string().optional(),
      fromThreadId: z.string().optional(),
      toAgent: z.string().optional(),
      toAgentInstanceId: z.string().optional(),
      toThreadId: z.string().optional(),
      broadcast: z.boolean().optional(),
      replyToMessageId: z.string().optional(),
      mentions: z.array(z.string()).optional(),
      taskId: z.string().optional(),
      text: z.string(),
      root: z.string().optional(),
    }),
  },
  async (input) => {
    const coordinator = await loadCoordinator(input.root);
    const { root: _root, ...messageInput } = input;
    return jsonResult({
      ok: true,
      message: await coordinator.postMessage({
        ...messageInput,
        kind: messageInput.kind as MessageKind | undefined,
      }),
    });
  },
);

server.registerTool(
  "inbox",
  {
    title: "Inbox",
    description: "List unread or all messages for an agent.",
    inputSchema: z.object({
      agent: z.string().optional(),
      agentInstanceId: z.string().optional(),
      threadId: z.string().optional(),
      includeRead: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ agent, agentInstanceId, threadId, includeRead, limit, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      inbox: await coordinator.inbox({
        agent,
        agentInstanceId,
        threadId,
        includeRead,
        limit,
      }),
    });
  },
);

server.registerTool(
  "mark_inbox_read",
  {
    title: "Mark Inbox Read",
    description: "Mark inbox messages as read for an agent instance.",
    inputSchema: z.object({
      agentInstanceId: z.string(),
      messageIds: z.array(z.string()).optional(),
      root: z.string().optional(),
    }),
  },
  async ({ agentInstanceId, messageIds, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      receipts: await coordinator.markInboxRead({
        agentInstanceId,
        messageIds,
      }),
    });
  },
);

server.registerTool(
  "presence",
  {
    title: "Presence",
    description: "List known agent instances and active claims.",
    inputSchema: z.object({
      activeWithinMinutes: z.number().positive().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ activeWithinMinutes, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      agents: await coordinator.presence(activeWithinMinutes),
    });
  },
);

server.registerTool(
  "watch",
  {
    title: "Watch",
    description: "Return recent coordinator events, messages, and handoffs.",
    inputSchema: z.object({
      since: z.string().optional(),
      limit: z.number().int().positive().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ since, limit, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      ...(await coordinator.watch({ since, limit })),
    });
  },
);

server.registerTool(
  "request_handoff",
  {
    title: "Request Handoff",
    description: "Request handoff for files owned by another active claim.",
    inputSchema: z.object({
      taskId: z.string(),
      agent: z.string(),
      agentInstanceId: z.string().optional(),
      threadId: z.string().optional(),
      filesGlobs: listSchema,
      reason: z.string(),
      root: z.string().optional(),
    }),
  },
  async (input) => {
    const coordinator = await loadCoordinator(input.root);
    return jsonResult({
      ok: true,
      handoff: await coordinator.requestHandoff(input),
    });
  },
);

server.registerTool(
  "respond_handoff",
  {
    title: "Respond Handoff",
    description: "Respond to a handoff request.",
    inputSchema: z.object({
      handoffId: z.string(),
      status: handoffResponseStatusSchema,
      agent: z.string().optional(),
      agentInstanceId: z.string().optional(),
      threadId: z.string().optional(),
      response: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async (input) => {
    const coordinator = await loadCoordinator(input.root);
    return jsonResult({
      ok: true,
      handoff: await coordinator.respondHandoff({
        ...input,
        status: input.status as Exclude<HandoffStatus, "requested">,
      }),
    });
  },
);

server.registerTool(
  "list_handoffs",
  {
    title: "List Handoffs",
    description: "List handoff requests.",
    inputSchema: z.object({
      status: handoffStatusSchema.optional(),
      root: z.string().optional(),
    }),
  },
  async ({ status, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      handoffs: await coordinator.listHandoffs(
        status as HandoffStatus | undefined,
      ),
    });
  },
);

server.registerTool(
  "export_snapshot",
  {
    title: "Export Snapshot",
    description: "Export a generated Markdown snapshot.",
    inputSchema: z.object({ root: z.string().optional() }),
  },
  async ({ root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      snapshotPath: await coordinator.exportSnapshot(),
    });
  },
);

server.registerTool(
  "git_identity",
  {
    title: "Git Identity",
    description: "Set local git user.name/user.email for an agent task.",
    inputSchema: z.object({
      agent: z.string(),
      agentInstanceId: z.string().optional(),
      threadId: z.string().optional(),
      taskId: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ agent, agentInstanceId, threadId, taskId, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      ...(await coordinator.configureGitIdentity(
        agent,
        threadId,
        taskId,
        agentInstanceId,
      )),
    });
  },
);

server.registerTool(
  "explain",
  {
    title: "Explain",
    description:
      "Explain a task or commit from events, messages, and trailers.",
    inputSchema: z.object({
      taskId: z.string().optional(),
      commit: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ taskId, commit, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      ...(await coordinator.explain({ taskId, commit })),
    });
  },
);

server.registerTool(
  "git_identity_reset",
  {
    title: "Git Identity Reset",
    description: "Restore git identity saved before git_identity.",
    inputSchema: z.object({ root: z.string().optional() }),
  },
  async ({ root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({ ok: true, ...(await coordinator.resetGitIdentity()) });
  },
);

server.registerTool(
  "install_hooks",
  {
    title: "Install Hooks",
    description: "Install local git hooks that run verify_commit.",
    inputSchema: z.object({
      agentInstanceEnv: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ agentInstanceEnv, root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult({
      ok: true,
      hooks: await coordinator.installHooks(agentInstanceEnv),
    });
  },
);

server.registerTool(
  "doctor",
  {
    title: "Doctor",
    description: "Inspect coordinator setup and common local hazards.",
    inputSchema: z.object({ root: z.string().optional() }),
  },
  async ({ root }) => {
    const coordinator = await loadCoordinator(root);
    const report = await coordinator.doctor();
    return jsonResult({
      ok: report.checks.every((item) => item.ok),
      ...report,
    });
  },
);

server.registerTool(
  "migrate_state",
  {
    title: "Migrate State",
    description:
      "Normalize coordinator state to the current schema and write a backup if changed.",
    inputSchema: z.object({ root: z.string().optional() }),
  },
  async ({ root }) => {
    const coordinator = await loadCoordinator(root);
    return jsonResult(await coordinator.migrateState());
  },
);

server.registerTool(
  "verify_worktree",
  {
    title: "Verify Worktree",
    description:
      "Verify modified files are covered by the current agent claim.",
    inputSchema: z.object({
      agent: z.string().optional(),
      agentInstanceId: z.string().optional(),
      threadId: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ agent, agentInstanceId, threadId, root }) => {
    const coordinator = await loadCoordinator(root);
    const report = await coordinator.verifyWorktree({
      agent,
      agentInstanceId,
      threadId,
    });
    return jsonResult(report);
  },
);

server.registerTool(
  "verify_commit",
  {
    title: "Verify Commit",
    description: "Verify staged files and optional commit message trailers.",
    inputSchema: z.object({
      agent: z.string().optional(),
      agentInstanceId: z.string().optional(),
      threadId: z.string().optional(),
      message: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ agent, agentInstanceId, threadId, message, root }) => {
    const coordinator = await loadCoordinator(root);
    const report = await coordinator.verifyCommit({
      agent,
      agentInstanceId,
      threadId,
      message,
    });
    return jsonResult(report);
  },
);

server.registerTool(
  "verify_commit_range",
  {
    title: "Verify Commit Range",
    description:
      "Verify commit trailers and changed files across a git revision range.",
    inputSchema: z.object({
      range: z.string(),
      requireKnownTasks: z.boolean().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ range, requireKnownTasks, root }) => {
    const coordinator = await loadCoordinator(root);
    const report = await coordinator.verifyCommitRange({
      range,
      requireKnownTasks,
    });
    return jsonResult(report);
  },
);

async function loadCoordinator(root?: string): Promise<AgentCoordinator> {
  return new AgentCoordinator(root ?? (await findProjectRoot()));
}

function jsonResult(value: Record<string, unknown>) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent: value,
  };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("Fatal error in agent-relay MCP server:", error);
  process.exit(1);
});
