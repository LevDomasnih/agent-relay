#!/usr/bin/env node
import { Command } from "commander";
import {
  AgentCoordinator,
  type HandoffStatus,
  type LockMode,
  type MessageKind,
  TASK_STATUSES,
  findProjectRoot,
  type TaskStatus,
} from "@agent-coordinator/core";
import { readFile } from "node:fs/promises";

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
  .option("--display-id <id>", "Human-facing task id")
  .option("--files <files>", "Comma-separated files/globs")
  .option(
    "--lock-mode <mode>",
    "Lock mode: exclusive, shared-read, shared-docs, advisory",
  )
  .option("--checks <checks>", "Comma-separated checks")
  .option("--next <next>", "Next step")
  .action(
    async (options: {
      id?: string;
      displayId?: string;
      title: string;
      scope: string;
      files?: string;
      lockMode?: string;
      checks?: string;
      next?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const task = await coordinator.createTask({
        id: options.id,
        displayId: options.displayId,
        title: options.title,
        scope: options.scope,
        filesGlobs: splitList(options.files),
        lockMode: parseLockMode(options.lockMode),
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
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--thread <id>", "Thread id")
  .option("--tool <tool>", "Agent tool: codex, claude, cursor, unknown")
  .option("--branch <name>", "Branch name")
  .option("--files <files>", "Comma-separated files/globs")
  .option(
    "--lock-mode <mode>",
    "Lock mode: exclusive, shared-read, shared-docs, advisory",
  )
  .option("--lease-minutes <minutes>", "Lease length in minutes")
  .option(
    "--takeover-reason <reason>",
    "Required when taking over an expired lease",
  )
  .action(
    async (options: {
      task: string;
      agent: string;
      agentInstance?: string;
      thread?: string;
      tool?: "codex" | "claude" | "cursor" | "unknown";
      branch?: string;
      files?: string;
      lockMode?: string;
      leaseMinutes?: string;
      takeoverReason?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const task = await coordinator.claimTask({
        taskId: options.task,
        agent: options.agent,
        agentInstanceId: options.agentInstance,
        threadId: options.thread,
        tool: options.tool,
        branch: options.branch,
        filesGlobs: options.files ? splitList(options.files) : undefined,
        lockMode: parseLockMode(options.lockMode),
        leaseMinutes: options.leaseMinutes
          ? Number(options.leaseMinutes)
          : undefined,
        takeoverReason: options.takeoverReason,
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
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--thread <id>", "Thread id")
  .option("--scope <scope>", "Scope")
  .option("--files <files>", "Comma-separated files/globs")
  .option(
    "--lock-mode <mode>",
    "Lock mode: exclusive, shared-read, shared-docs, advisory",
  )
  .option("--checks <checks>", "Comma-separated checks")
  .option("--next <next>", "Next step")
  .option("--blocker <reason>", "Blocker reason")
  .action(
    async (options: {
      task: string;
      status: string;
      agent?: string;
      agentInstance?: string;
      thread?: string;
      scope?: string;
      files?: string;
      lockMode?: string;
      checks?: string;
      next?: string;
      blocker?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const task = await coordinator.updateTask({
        taskId: options.task,
        status: parseRequiredStatus(options.status),
        agent: options.agent,
        agentInstanceId: options.agentInstance,
        threadId: options.thread,
        scope: options.scope,
        filesGlobs: options.files ? splitList(options.files) : undefined,
        lockMode: parseLockMode(options.lockMode),
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
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--thread <id>", "Thread id")
  .option("--lease-minutes <minutes>", "Lease length in minutes")
  .action(
    async (options: {
      task: string;
      agent?: string;
      agentInstance?: string;
      thread?: string;
      leaseMinutes?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const task = await coordinator.heartbeat(
        options.task,
        options.agent,
        options.thread,
        options.leaseMinutes ? Number(options.leaseMinutes) : undefined,
        options.agentInstance,
      );
      console.log(JSON.stringify({ ok: true, task }, null, 2));
    },
  );

program
  .command("release")
  .description("Release a task lease.")
  .requiredOption("--task <id>", "Task id")
  .option("--agent <name>", "Agent name")
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--reason <reason>", "Release reason", "released")
  .action(
    async (options: {
      task: string;
      agent?: string;
      agentInstance?: string;
      reason: string;
    }) => {
      const coordinator = await loadCoordinator();
      const task = await coordinator.releaseTask(
        options.task,
        options.agent,
        options.reason,
        options.agentInstance,
      );
      console.log(JSON.stringify({ ok: true, task }, null, 2));
    },
  );

program
  .command("mine")
  .description("List tasks by agent or thread id.")
  .option("--agent <name>", "Agent name")
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--thread <id>", "Thread id")
  .action(
    async (options: {
      agent?: string;
      agentInstance?: string;
      thread?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const tasks = await coordinator.listMyTasks(
        options.agent,
        options.thread,
        options.agentInstance,
      );
      console.log(JSON.stringify({ ok: true, tasks }, null, 2));
    },
  );

program
  .command("conflicts")
  .description("Detect active scope conflicts.")
  .requiredOption("--files <files>", "Comma-separated files/globs")
  .option("--exclude-task <id>", "Task id to exclude")
  .option(
    "--lock-mode <mode>",
    "Lock mode: exclusive, shared-read, shared-docs, advisory",
  )
  .action(
    async (options: {
      files: string;
      excludeTask?: string;
      lockMode?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const conflicts = await coordinator.detectConflicts(
        splitList(options.files),
        options.excludeTask,
        parseLockMode(options.lockMode),
      );
      console.log(JSON.stringify({ ok: true, conflicts }, null, 2));
    },
  );

program
  .command("message")
  .description("Post an agent, task, or thread message.")
  .requiredOption("--from-agent <name>", "Sender agent")
  .requiredOption("--text <text>", "Message text")
  .option(
    "--kind <kind>",
    "note, question, blocker, ready_for_review, handoff, decision",
  )
  .option("--from-agent-instance <id>", "Sender agent instance id")
  .option("--from-thread <id>", "Sender thread id")
  .option("--to-agent <name>", "Recipient agent name")
  .option("--to-agent-instance <id>", "Recipient agent instance id")
  .option("--to-thread <id>", "Recipient thread id")
  .option("--broadcast", "Send to every agent inbox")
  .option("--reply-to <id>", "Message id this replies to")
  .option("--mentions <items>", "Comma-separated agent/thread mentions")
  .option("--task <id>", "Task id")
  .action(
    async (options: {
      fromAgent: string;
      text: string;
      kind?: string;
      fromAgentInstance?: string;
      fromThread?: string;
      toAgent?: string;
      toAgentInstance?: string;
      toThread?: string;
      broadcast?: boolean;
      replyTo?: string;
      mentions?: string;
      task?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const message = await coordinator.postMessage({
        kind: parseMessageKind(options.kind),
        fromAgent: options.fromAgent,
        fromAgentInstanceId: options.fromAgentInstance,
        fromThreadId: options.fromThread,
        toAgent: options.toAgent,
        toAgentInstanceId: options.toAgentInstance,
        toThreadId: options.toThread,
        broadcast: options.broadcast,
        replyToMessageId: options.replyTo,
        mentions: splitList(options.mentions),
        taskId: options.task,
        text: options.text,
      });
      console.log(JSON.stringify({ ok: true, message }, null, 2));
    },
  );

program
  .command("inbox")
  .description("List unread or all messages for an agent.")
  .option("--agent <name>", "Agent name")
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--thread <id>", "Thread id")
  .option("--include-read", "Include messages already marked read")
  .option("--limit <n>", "Maximum number of messages", "50")
  .action(
    async (options: {
      agent?: string;
      agentInstance?: string;
      thread?: string;
      includeRead?: boolean;
      limit: string;
    }) => {
      const coordinator = await loadCoordinator();
      const inbox = await coordinator.inbox({
        agent: options.agent,
        agentInstanceId: options.agentInstance,
        threadId: options.thread,
        includeRead: options.includeRead,
        limit: Number(options.limit),
      });
      console.log(JSON.stringify({ ok: true, inbox }, null, 2));
    },
  );

program
  .command("inbox-read")
  .description("Mark inbox messages as read for an agent instance.")
  .requiredOption("--agent-instance <id>", "Stable agent instance id")
  .option("--messages <ids>", "Comma-separated message ids; defaults to all")
  .action(async (options: { agentInstance: string; messages?: string }) => {
    const coordinator = await loadCoordinator();
    const receipts = await coordinator.markInboxRead({
      agentInstanceId: options.agentInstance,
      messageIds: options.messages ? splitList(options.messages) : undefined,
    });
    console.log(JSON.stringify({ ok: true, receipts }, null, 2));
  });

program
  .command("presence")
  .description("List known agent instances and active claims.")
  .option("--active-within-minutes <n>", "Presence active window", "15")
  .action(async (options: { activeWithinMinutes: string }) => {
    const coordinator = await loadCoordinator();
    const agents = await coordinator.presence(
      Number(options.activeWithinMinutes),
    );
    console.log(JSON.stringify({ ok: true, agents }, null, 2));
  });

program
  .command("watch")
  .description("Show recent coordinator events, messages, and handoffs.")
  .option("--since <iso>", "Only items after this timestamp")
  .option("--limit <n>", "Maximum items per stream", "50")
  .action(async (options: { since?: string; limit: string }) => {
    const coordinator = await loadCoordinator();
    const result = await coordinator.watch({
      since: options.since,
      limit: Number(options.limit),
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  });

const handoff = program
  .command("handoff")
  .description("Request or respond to a scoped handoff.");

handoff
  .command("request")
  .description("Request handoff for files owned by another active claim.")
  .requiredOption("--task <id>", "Requesting task id")
  .requiredOption("--agent <name>", "Requesting agent name")
  .requiredOption("--reason <reason>", "Why this handoff is needed")
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--thread <id>", "Thread id")
  .option("--files <files>", "Comma-separated files/globs")
  .action(
    async (options: {
      task: string;
      agent: string;
      reason: string;
      agentInstance?: string;
      thread?: string;
      files?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const request = await coordinator.requestHandoff({
        taskId: options.task,
        agent: options.agent,
        agentInstanceId: options.agentInstance,
        threadId: options.thread,
        filesGlobs: options.files ? splitList(options.files) : undefined,
        reason: options.reason,
      });
      console.log(JSON.stringify({ ok: true, handoff: request }, null, 2));
    },
  );

handoff
  .command("respond")
  .description("Respond to a handoff request.")
  .requiredOption("--id <id>", "Handoff id")
  .requiredOption(
    "--status <status>",
    "grant_after_commit, handoff_now, denied, cancelled",
  )
  .option("--agent <name>", "Responding agent name")
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--thread <id>", "Thread id")
  .option("--response <text>", "Response text")
  .action(
    async (options: {
      id: string;
      status: string;
      agent?: string;
      agentInstance?: string;
      thread?: string;
      response?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const result = await coordinator.respondHandoff({
        handoffId: options.id,
        status: parseHandoffResponseStatus(options.status),
        agent: options.agent,
        agentInstanceId: options.agentInstance,
        threadId: options.thread,
        response: options.response,
      });
      console.log(JSON.stringify({ ok: true, handoff: result }, null, 2));
    },
  );

handoff
  .command("list")
  .description("List handoff requests.")
  .option("--status <status>", "Filter by handoff status")
  .action(async (options: { status?: string }) => {
    const coordinator = await loadCoordinator();
    const handoffs = await coordinator.listHandoffs(
      parseOptionalHandoffStatus(options.status),
    );
    console.log(JSON.stringify({ ok: true, handoffs }, null, 2));
  });

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
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--thread <id>", "Thread id")
  .option("--task <id>", "Task id")
  .action(
    async (options: {
      agent: string;
      agentInstance?: string;
      thread?: string;
      task?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const result = await coordinator.configureGitIdentity(
        options.agent,
        options.thread,
        options.task,
        options.agentInstance,
      );
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    },
  );

program
  .command("explain")
  .description("Explain a task or commit from events, messages, and trailers.")
  .option("--task <id>", "Task id or display id")
  .option("--commit <sha>", "Commit sha")
  .action(async (options: { task?: string; commit?: string }) => {
    if (!options.task && !options.commit) {
      throw new Error("Use --task or --commit");
    }
    const coordinator = await loadCoordinator();
    const explanation = await coordinator.explain({
      taskId: options.task,
      commit: options.commit,
    });
    console.log(JSON.stringify({ ok: true, ...explanation }, null, 2));
  });

program
  .command("git-identity-reset")
  .description("Restore the git identity saved before git-identity.")
  .action(async () => {
    const coordinator = await loadCoordinator();
    const result = await coordinator.resetGitIdentity();
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  });

program
  .command("install-hooks")
  .description("Install local git hooks that run verify-commit.")
  .option(
    "--agent-instance-env <name>",
    "Environment variable used by hooks",
    "AGENT_COORDINATOR_INSTANCE",
  )
  .action(async (options: { agentInstanceEnv: string }) => {
    const coordinator = await loadCoordinator();
    const hooks = await coordinator.installHooks(options.agentInstanceEnv);
    console.log(JSON.stringify({ ok: true, hooks }, null, 2));
  });

program
  .command("doctor")
  .description("Inspect coordinator setup and common local hazards.")
  .action(async () => {
    const coordinator = await loadCoordinator();
    const report = await coordinator.doctor();
    console.log(
      JSON.stringify(
        { ok: report.checks.every((item) => item.ok), ...report },
        null,
        2,
      ),
    );
  });

program
  .command("verify-worktree")
  .description("Verify modified files are covered by the current agent claim.")
  .option("--agent <name>", "Agent name")
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--thread <id>", "Thread id")
  .action(
    async (options: {
      agent?: string;
      agentInstance?: string;
      thread?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const report = await coordinator.verifyWorktree({
        agent: options.agent,
        agentInstanceId: options.agentInstance,
        threadId: options.thread,
      });
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    },
  );

program
  .command("verify-commit")
  .description("Verify staged files and optional commit message trailers.")
  .option("--agent <name>", "Agent name")
  .option("--agent-instance <id>", "Stable agent instance id")
  .option("--thread <id>", "Thread id")
  .option("--message <text>", "Commit message text")
  .option("--message-file <path>", "Commit message file, for commit-msg hooks")
  .action(
    async (options: {
      agent?: string;
      agentInstance?: string;
      thread?: string;
      message?: string;
      messageFile?: string;
    }) => {
      const coordinator = await loadCoordinator();
      const message = options.messageFile
        ? await readFile(options.messageFile, "utf8")
        : options.message;
      const report = await coordinator.verifyCommit({
        agent: options.agent,
        agentInstanceId: options.agentInstance,
        threadId: options.thread,
        message,
      });
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
    },
  );

program
  .command("verify-commit-range")
  .description(
    "Verify commit trailers and changed files across a git revision range.",
  )
  .requiredOption(
    "--range <rev>",
    "Git revision range, for example origin/main..HEAD",
  )
  .option(
    "--require-known-tasks",
    "Fail when Agent-Task does not resolve to a local coordinator task",
  )
  .action(async (options: { range: string; requireKnownTasks?: boolean }) => {
    const coordinator = await loadCoordinator();
    const report = await coordinator.verifyCommitRange({
      range: options.range,
      requireKnownTasks: options.requireKnownTasks,
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  });

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

function parseLockMode(mode?: string): LockMode | undefined {
  if (!mode) return undefined;
  if (
    mode === "exclusive" ||
    mode === "shared-read" ||
    mode === "shared-docs" ||
    mode === "advisory"
  ) {
    return mode;
  }
  throw new Error(
    `Invalid lock mode "${mode}". Expected one of: exclusive, shared-read, shared-docs, advisory`,
  );
}

function parseMessageKind(kind?: string): MessageKind | undefined {
  if (!kind) return undefined;
  if (
    kind === "note" ||
    kind === "question" ||
    kind === "blocker" ||
    kind === "ready_for_review" ||
    kind === "handoff" ||
    kind === "decision"
  ) {
    return kind;
  }
  throw new Error(
    `Invalid message kind "${kind}". Expected one of: note, question, blocker, ready_for_review, handoff, decision`,
  );
}

function parseOptionalHandoffStatus(
  status?: string,
): HandoffStatus | undefined {
  return status ? parseHandoffStatus(status) : undefined;
}

function parseHandoffResponseStatus(
  status: string,
): Exclude<HandoffStatus, "requested"> {
  const parsed = parseHandoffStatus(status);
  if (parsed === "requested") {
    throw new Error(
      "Use one of: grant_after_commit, handoff_now, denied, cancelled",
    );
  }
  return parsed;
}

function parseHandoffStatus(status: string): HandoffStatus {
  if (
    status === "requested" ||
    status === "grant_after_commit" ||
    status === "handoff_now" ||
    status === "denied" ||
    status === "cancelled"
  ) {
    return status;
  }
  throw new Error(
    `Invalid handoff status "${status}". Expected one of: requested, grant_after_commit, handoff_now, denied, cancelled`,
  );
}
