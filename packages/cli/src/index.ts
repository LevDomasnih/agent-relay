#!/usr/bin/env node
import { Command } from "commander";
import {
  AgentCoordinator,
  TASK_STATUSES,
  findProjectRoot,
  type TaskStatus,
} from "@agent-coordinator/core";

const program = new Command();

program
  .name("agent-coordinator")
  .description("Project-local coordination for parallel AI coding agents.")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize Agent Coordinator in the current project.")
  .option("--project-name <name>", "Project name")
  .action(async (options: { projectName?: string }) => {
    const coordinator = new AgentCoordinator(process.cwd());
    const config = await coordinator.init(options.projectName);
    console.log(JSON.stringify({ ok: true, config }, null, 2));
  });

program
  .command("status")
  .description("List tasks grouped by status.")
  .option("--status <status>", "Filter by status")
  .action(async (options: { status?: string }) => {
    const coordinator = await loadCoordinator();
    const status = parseStatus(options.status);
    const tasks = await coordinator.listTasks(status);
    console.log(JSON.stringify({ ok: true, tasks }, null, 2));
  });

program
  .command("create")
  .description("Create a task.")
  .requiredOption("--title <title>", "Task title")
  .requiredOption("--scope <scope>", "Task scope")
  .option("--id <id>", "Task id")
  .option("--files <files>", "Comma-separated files/globs")
  .option("--checks <checks>", "Comma-separated checks")
  .option("--next <next>", "Next step")
  .action(
    async (options: {
      id?: string;
      title: string;
      scope: string;
      files?: string;
      checks?: string;
      next?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const task = await coordinator.createTask({
        id: options.id,
        title: options.title,
        scope: options.scope,
        filesGlobs: splitList(options.files),
        checks: splitList(options.checks),
        next: options.next,
      });
      console.log(JSON.stringify({ ok: true, task }, null, 2));
    },
  );

program
  .command("claim")
  .description("Claim a task and its files/globs.")
  .requiredOption("--task <id>", "Task id")
  .requiredOption("--agent <name>", "Agent name")
  .option("--thread <id>", "Thread id")
  .option("--branch <name>", "Branch name")
  .option("--files <files>", "Comma-separated files/globs")
  .option("--lease-minutes <minutes>", "Lease length in minutes")
  .action(
    async (options: {
      task: string;
      agent: string;
      thread?: string;
      branch?: string;
      files?: string;
      leaseMinutes?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const task = await coordinator.claimTask({
        taskId: options.task,
        agent: options.agent,
        threadId: options.thread,
        branch: options.branch,
        filesGlobs: options.files ? splitList(options.files) : undefined,
        leaseMinutes: options.leaseMinutes
          ? Number(options.leaseMinutes)
          : undefined,
      });
      console.log(JSON.stringify({ ok: true, task }, null, 2));
    },
  );

program
  .command("update")
  .description("Update task status and handoff fields.")
  .requiredOption("--task <id>", "Task id")
  .requiredOption("--status <status>", `Status: ${TASK_STATUSES.join(", ")}`)
  .option("--agent <name>", "Agent name")
  .option("--thread <id>", "Thread id")
  .option("--scope <scope>", "Scope")
  .option("--files <files>", "Comma-separated files/globs")
  .option("--checks <checks>", "Comma-separated checks")
  .option("--next <next>", "Next step")
  .option("--blocker <reason>", "Blocker reason")
  .action(
    async (options: {
      task: string;
      status: string;
      agent?: string;
      thread?: string;
      scope?: string;
      files?: string;
      checks?: string;
      next?: string;
      blocker?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const task = await coordinator.updateTask({
        taskId: options.task,
        status: parseRequiredStatus(options.status),
        agent: options.agent,
        threadId: options.thread,
        scope: options.scope,
        filesGlobs: options.files ? splitList(options.files) : undefined,
        checks: options.checks ? splitList(options.checks) : undefined,
        next: options.next,
        blocker: options.blocker,
      });
      console.log(JSON.stringify({ ok: true, task }, null, 2));
    },
  );

program
  .command("heartbeat")
  .description("Extend a task lease.")
  .requiredOption("--task <id>", "Task id")
  .option("--agent <name>", "Agent name")
  .option("--thread <id>", "Thread id")
  .option("--lease-minutes <minutes>", "Lease length in minutes")
  .action(
    async (options: {
      task: string;
      agent?: string;
      thread?: string;
      leaseMinutes?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const task = await coordinator.heartbeat(
        options.task,
        options.agent,
        options.thread,
        options.leaseMinutes ? Number(options.leaseMinutes) : undefined,
      );
      console.log(JSON.stringify({ ok: true, task }, null, 2));
    },
  );

program
  .command("release")
  .description("Release a task lease.")
  .requiredOption("--task <id>", "Task id")
  .option("--agent <name>", "Agent name")
  .option("--reason <reason>", "Release reason", "released")
  .action(async (options: { task: string; agent?: string; reason: string }) => {
    const coordinator = await loadCoordinator();
    const task = await coordinator.releaseTask(
      options.task,
      options.agent,
      options.reason,
    );
    console.log(JSON.stringify({ ok: true, task }, null, 2));
  });

program
  .command("mine")
  .description("List tasks by agent or thread id.")
  .option("--agent <name>", "Agent name")
  .option("--thread <id>", "Thread id")
  .action(async (options: { agent?: string; thread?: string }) => {
    const coordinator = await loadCoordinator();
    const tasks = await coordinator.listMyTasks(options.agent, options.thread);
    console.log(JSON.stringify({ ok: true, tasks }, null, 2));
  });

program
  .command("conflicts")
  .description("Detect active scope conflicts.")
  .requiredOption("--files <files>", "Comma-separated files/globs")
  .option("--exclude-task <id>", "Task id to exclude")
  .action(async (options: { files: string; excludeTask?: string }) => {
    const coordinator = await loadCoordinator();
    const conflicts = await coordinator.detectConflicts(
      splitList(options.files),
      options.excludeTask,
    );
    console.log(JSON.stringify({ ok: true, conflicts }, null, 2));
  });

program
  .command("message")
  .description("Post a task or thread message.")
  .requiredOption("--from-agent <name>", "Sender agent")
  .requiredOption("--text <text>", "Message text")
  .option("--from-thread <id>", "Sender thread id")
  .option("--to-thread <id>", "Recipient thread id")
  .option("--task <id>", "Task id")
  .action(
    async (options: {
      fromAgent: string;
      text: string;
      fromThread?: string;
      toThread?: string;
      task?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const message = await coordinator.postMessage({
        fromAgent: options.fromAgent,
        fromThreadId: options.fromThread,
        toThreadId: options.toThread,
        taskId: options.task,
        text: options.text,
      });
      console.log(JSON.stringify({ ok: true, message }, null, 2));
    },
  );

program
  .command("snapshot")
  .description("Export a generated Markdown snapshot.")
  .action(async () => {
    const coordinator = await loadCoordinator();
    const snapshotPath = await coordinator.exportSnapshot();
    console.log(JSON.stringify({ ok: true, snapshotPath }, null, 2));
  });

program
  .command("git-identity")
  .description("Set local git identity for an agent task.")
  .requiredOption("--agent <name>", "Agent name")
  .option("--thread <id>", "Thread id")
  .option("--task <id>", "Task id")
  .action(
    async (options: { agent: string; thread?: string; task?: string }) => {
      const coordinator = await loadCoordinator();
      const result = await coordinator.configureGitIdentity(
        options.agent,
        options.thread,
        options.task,
      );
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    },
  );

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function loadCoordinator(): Promise<AgentCoordinator> {
  return new AgentCoordinator(await findProjectRoot());
}

function splitList(value?: string): string[] {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function parseStatus(status?: string): TaskStatus | undefined {
  return status ? parseRequiredStatus(status) : undefined;
}

function parseRequiredStatus(status: string): TaskStatus {
  if (TASK_STATUSES.includes(status as TaskStatus)) return status as TaskStatus;
  throw new Error(
    `Invalid status "${status}". Expected one of: ${TASK_STATUSES.join(", ")}`,
  );
}
