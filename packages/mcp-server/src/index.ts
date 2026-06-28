#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  AgentCoordinator,
  TASK_STATUSES,
  findProjectRoot,
  type TaskStatus,
} from "@agent-coordinator/core";
import { z } from "zod";

const server = new McpServer({ name: "agent-coordinator", version: "0.1.0" });

const taskStatusSchema = z.enum(TASK_STATUSES);
const listSchema = z.array(z.string()).optional();

server.registerTool(
  "init_project",
  {
    title: "Initialize Project",
    description: "Initialize Agent Coordinator in the current project.",
    inputSchema: z.object({
      projectName: z.string().optional(),
      root: z.string().optional(),
    }),
  },
  async ({ projectName, root }) => {
    const coordinator = new AgentCoordinator(root ?? process.cwd());
    const config = await coordinator.init(projectName);
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
      title: z.string(),
      scope: z.string(),
      filesGlobs: listSchema,
      checks: listSchema,
      next: z.string().optional(),
    }),
  },
  async (input) => {
    const coordinator = await loadCoordinator();
    return jsonResult({ ok: true, task: await coordinator.createTask(input) });
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
      threadId: z.string().optional(),
      branch: z.string().optional(),
      filesGlobs: listSchema,
      leaseMinutes: z.number().int().positive().optional(),
    }),
  },
  async (input) => {
    const coordinator = await loadCoordinator();
    return jsonResult({ ok: true, task: await coordinator.claimTask(input) });
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
      threadId: z.string().optional(),
      scope: z.string().optional(),
      filesGlobs: listSchema,
      checks: listSchema,
      next: z.string().optional(),
      blocker: z.string().optional(),
    }),
  },
  async (input) => {
    const coordinator = await loadCoordinator();
    return jsonResult({
      ok: true,
      task: await coordinator.updateTask({
        ...input,
        status: input.status as TaskStatus,
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
      threadId: z.string().optional(),
      leaseMinutes: z.number().int().positive().optional(),
    }),
  },
  async ({ taskId, agent, threadId, leaseMinutes }) => {
    const coordinator = await loadCoordinator();
    return jsonResult({
      ok: true,
      task: await coordinator.heartbeat(taskId, agent, threadId, leaseMinutes),
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
      reason: z.string().optional(),
    }),
  },
  async ({ taskId, agent, reason }) => {
    const coordinator = await loadCoordinator();
    return jsonResult({
      ok: true,
      task: await coordinator.releaseTask(taskId, agent, reason),
    });
  },
);

server.registerTool(
  "list_tasks",
  {
    title: "List Tasks",
    description: "List project tasks.",
    inputSchema: z.object({ status: taskStatusSchema.optional() }),
  },
  async ({ status }) => {
    const coordinator = await loadCoordinator();
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
      threadId: z.string().optional(),
    }),
  },
  async ({ agent, threadId }) => {
    const coordinator = await loadCoordinator();
    return jsonResult({
      ok: true,
      tasks: await coordinator.listMyTasks(agent, threadId),
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
    }),
  },
  async ({ filesGlobs, excludeTaskId }) => {
    const coordinator = await loadCoordinator();
    return jsonResult({
      ok: true,
      conflicts: await coordinator.detectConflicts(filesGlobs, excludeTaskId),
    });
  },
);

server.registerTool(
  "post_message",
  {
    title: "Post Message",
    description: "Post a task comment or directed thread message.",
    inputSchema: z.object({
      fromAgent: z.string(),
      fromThreadId: z.string().optional(),
      toThreadId: z.string().optional(),
      taskId: z.string().optional(),
      text: z.string(),
    }),
  },
  async (input) => {
    const coordinator = await loadCoordinator();
    return jsonResult({
      ok: true,
      message: await coordinator.postMessage(input),
    });
  },
);

server.registerTool(
  "export_snapshot",
  {
    title: "Export Snapshot",
    description: "Export a generated Markdown snapshot.",
    inputSchema: z.object({}),
  },
  async () => {
    const coordinator = await loadCoordinator();
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
      threadId: z.string().optional(),
      taskId: z.string().optional(),
    }),
  },
  async ({ agent, threadId, taskId }) => {
    const coordinator = await loadCoordinator();
    return jsonResult({
      ok: true,
      ...(await coordinator.configureGitIdentity(agent, threadId, taskId)),
    });
  },
);

async function loadCoordinator(): Promise<AgentCoordinator> {
  return new AgentCoordinator(await findProjectRoot());
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
  console.error("Fatal error in agent-coordinator MCP server:", error);
  process.exit(1);
});
