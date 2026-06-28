import { constants, existsSync } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const TASK_STATUSES = [
  "todo",
  "claimed",
  "fixing",
  "verifying",
  "blocked",
  "done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Task = {
  id: string;
  title: string;
  repo: string;
  scope: string;
  status: TaskStatus;
  agent?: string;
  threadId?: string;
  branch?: string;
  filesGlobs: string[];
  checks: string[];
  next?: string;
  blocker?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type Event = {
  id: string;
  at: string;
  taskId?: string;
  agent?: string;
  threadId?: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
};

export type Message = {
  id: string;
  at: string;
  fromAgent: string;
  fromThreadId?: string;
  toThreadId?: string;
  taskId?: string;
  text: string;
};

export type CoordinatorConfig = {
  version: 1;
  projectName: string;
  defaultLeaseMinutes: number;
  snapshotPath: string;
};

export type CoordinatorState = {
  version: 1;
  tasks: Task[];
};

export type CoordinatorPaths = {
  root: string;
  dir: string;
  config: string;
  state: string;
  events: string;
  messages: string;
  lock: string;
};

export type CreateTaskInput = {
  id?: string;
  title: string;
  scope: string;
  filesGlobs?: string[];
  checks?: string[];
  next?: string;
};

export type ClaimTaskInput = {
  taskId: string;
  agent: string;
  threadId?: string;
  branch?: string;
  filesGlobs?: string[];
  leaseMinutes?: number;
};

export type UpdateTaskInput = {
  taskId: string;
  status: TaskStatus;
  agent?: string;
  threadId?: string;
  scope?: string;
  filesGlobs?: string[];
  checks?: string[];
  next?: string;
  blocker?: string;
};

export type Conflict = {
  taskId: string;
  agent?: string;
  threadId?: string;
  status: TaskStatus;
  matched: string[];
  leaseExpiresAt?: string;
};

export class AgentCoordinator {
  readonly paths: CoordinatorPaths;

  constructor(root: string) {
    this.paths = createPaths(root);
  }

  async init(
    projectName = path.basename(this.paths.root),
  ): Promise<CoordinatorConfig> {
    await mkdir(this.paths.dir, { recursive: true });
    await mkdir(path.join(this.paths.dir, "snapshots"), { recursive: true });
    const config: CoordinatorConfig = {
      version: 1,
      projectName,
      defaultLeaseMinutes: 120,
      snapshotPath: ".agent-coordinator/snapshots/TASKS.md",
    };
    if (!existsSync(this.paths.config)) {
      await writeJsonAtomic(this.paths.config, config);
    }
    if (!existsSync(this.paths.state)) {
      await writeJsonAtomic(this.paths.state, {
        version: 1,
        tasks: [],
      } satisfies CoordinatorState);
    }
    await ensureJsonl(this.paths.events);
    await ensureJsonl(this.paths.messages);
    await this.exportSnapshot();
    return config;
  }

  async readConfig(): Promise<CoordinatorConfig> {
    await this.ensureInitialized();
    return readJson<CoordinatorConfig>(this.paths.config);
  }

  async readState(): Promise<CoordinatorState> {
    await this.ensureInitialized();
    return readJson<CoordinatorState>(this.paths.state);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.mutate(`create task ${input.title}`, async (state) => {
      const now = timestamp();
      const task: Task = {
        id: input.id ?? createTaskId(state.tasks.length + 1),
        title: input.title,
        repo: path.basename(this.paths.root),
        scope: input.scope,
        status: "todo",
        filesGlobs: input.filesGlobs ?? [],
        checks: input.checks ?? [],
        next: input.next,
        createdAt: now,
        updatedAt: now,
      };
      if (state.tasks.some((item) => item.id === task.id)) {
        throw new Error(`Task already exists: ${task.id}`);
      }
      state.tasks.push(task);
      await this.appendEvent({
        taskId: task.id,
        type: "task.created",
        message: task.title,
        data: { scope: task.scope, filesGlobs: task.filesGlobs },
      });
      return task;
    });
  }

  async claimTask(input: ClaimTaskInput): Promise<Task> {
    return this.mutate(`claim task ${input.taskId}`, async (state, config) => {
      const task = getTask(state, input.taskId);
      const filesGlobs = input.filesGlobs ?? task.filesGlobs;
      const conflicts = findConflicts(state.tasks, filesGlobs, task.id);
      if (conflicts.length > 0) {
        throw new Error(`Scope conflict: ${formatConflicts(conflicts)}`);
      }
      const now = timestamp();
      task.status = "claimed";
      task.agent = input.agent;
      task.threadId = input.threadId;
      task.branch = input.branch;
      task.filesGlobs = filesGlobs;
      task.leaseExpiresAt = addMinutes(
        now,
        input.leaseMinutes ?? config.defaultLeaseMinutes,
      );
      task.updatedAt = now;
      await this.appendEvent({
        taskId: task.id,
        agent: input.agent,
        threadId: input.threadId,
        type: "task.claimed",
        message: `Claimed ${task.scope}`,
        data: {
          filesGlobs: task.filesGlobs,
          leaseExpiresAt: task.leaseExpiresAt,
        },
      });
      return task;
    });
  }

  async updateTask(input: UpdateTaskInput): Promise<Task> {
    return this.mutate(`update task ${input.taskId}`, async (state) => {
      const task = getTask(state, input.taskId);
      const now = timestamp();
      task.status = input.status;
      task.agent = input.agent ?? task.agent;
      task.threadId = input.threadId ?? task.threadId;
      task.scope = input.scope ?? task.scope;
      task.filesGlobs = input.filesGlobs ?? task.filesGlobs;
      task.checks = input.checks ?? task.checks;
      task.next = input.next ?? task.next;
      task.blocker = input.blocker;
      task.updatedAt = now;
      if (input.status === "done") {
        task.leaseExpiresAt = undefined;
      }
      await this.appendEvent({
        taskId: task.id,
        agent: task.agent,
        threadId: task.threadId,
        type: `task.${input.status}`,
        message: input.next ?? input.blocker ?? input.status,
        data: { filesGlobs: task.filesGlobs, checks: task.checks },
      });
      return task;
    });
  }

  async heartbeat(
    taskId: string,
    agent?: string,
    threadId?: string,
    leaseMinutes?: number,
  ): Promise<Task> {
    return this.mutate(`heartbeat task ${taskId}`, async (state, config) => {
      const task = getTask(state, taskId);
      const now = timestamp();
      task.agent = agent ?? task.agent;
      task.threadId = threadId ?? task.threadId;
      task.leaseExpiresAt = addMinutes(
        now,
        leaseMinutes ?? config.defaultLeaseMinutes,
      );
      task.updatedAt = now;
      await this.appendEvent({
        taskId,
        agent: task.agent,
        threadId: task.threadId,
        type: "task.heartbeat",
        message: `Lease extended until ${task.leaseExpiresAt}`,
      });
      return task;
    });
  }

  async releaseTask(
    taskId: string,
    agent?: string,
    reason = "released",
  ): Promise<Task> {
    return this.mutate(`release task ${taskId}`, async (state) => {
      const task = getTask(state, taskId);
      const now = timestamp();
      task.leaseExpiresAt = undefined;
      task.updatedAt = now;
      if (task.status !== "done" && task.status !== "blocked") {
        task.status = "todo";
      }
      await this.appendEvent({
        taskId,
        agent: agent ?? task.agent,
        threadId: task.threadId,
        type: "task.released",
        message: reason,
      });
      return task;
    });
  }

  async listTasks(status?: TaskStatus): Promise<Task[]> {
    const state = await this.readState();
    return status
      ? state.tasks.filter((task) => task.status === status)
      : state.tasks;
  }

  async listMyTasks(agent?: string, threadId?: string): Promise<Task[]> {
    const state = await this.readState();
    return state.tasks.filter((task) => {
      return (
        (agent && task.agent === agent) ||
        (threadId && task.threadId === threadId)
      );
    });
  }

  async detectConflicts(
    filesGlobs: string[],
    excludeTaskId?: string,
  ): Promise<Conflict[]> {
    const state = await this.readState();
    return findConflicts(state.tasks, filesGlobs, excludeTaskId);
  }

  async postMessage(input: Omit<Message, "id" | "at">): Promise<Message> {
    await this.ensureInitialized();
    const message: Message = { id: randomId("msg"), at: timestamp(), ...input };
    await appendFile(this.paths.messages, `${JSON.stringify(message)}\n`);
    await this.appendEvent({
      taskId: input.taskId,
      agent: input.fromAgent,
      threadId: input.fromThreadId,
      type: "message.posted",
      message: input.text,
      data: { toThreadId: input.toThreadId },
    });
    return message;
  }

  async exportSnapshot(): Promise<string> {
    await this.ensureInitialized(false);
    const config = existsSync(this.paths.config)
      ? await readJson<CoordinatorConfig>(this.paths.config)
      : {
          version: 1 as const,
          projectName: path.basename(this.paths.root),
          defaultLeaseMinutes: 120,
          snapshotPath: ".agent-coordinator/snapshots/TASKS.md",
        };
    const state = existsSync(this.paths.state)
      ? await readJson<CoordinatorState>(this.paths.state)
      : ({ version: 1, tasks: [] } satisfies CoordinatorState);
    const snapshot = renderSnapshot(config, state);
    const snapshotPath = path.join(this.paths.root, config.snapshotPath);
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, snapshot);
    return snapshotPath;
  }

  async configureGitIdentity(
    agent: string,
    threadId?: string,
    taskId?: string,
  ): Promise<{ name: string; email: string; trailers: string[] }> {
    const safeThread = threadId
      ? sanitizeEmailPart(threadId)
      : "unknown-thread";
    const email = `codex+${safeThread}@agent-coordinator.local`;
    await execFileAsync("git", ["config", "user.name", agent], {
      cwd: this.paths.root,
    });
    await execFileAsync("git", ["config", "user.email", email], {
      cwd: this.paths.root,
    });
    const trailers = [`Agent: ${agent}`];
    if (threadId) trailers.push(`Agent-Thread: ${threadId}`);
    if (taskId) trailers.push(`Agent-Task: ${taskId}`);
    return { name: agent, email, trailers };
  }

  private async mutate<T>(
    description: string,
    fn: (state: CoordinatorState, config: CoordinatorConfig) => Promise<T>,
  ): Promise<T> {
    await this.ensureInitialized();
    return withProjectLock(
      this.paths,
      async () => {
        const config = await readJson<CoordinatorConfig>(this.paths.config);
        const state = await readJson<CoordinatorState>(this.paths.state);
        const result = await fn(state, config);
        await writeJsonAtomic(this.paths.state, state);
        await this.exportSnapshot();
        return result;
      },
      description,
    );
  }

  private async ensureInitialized(requireState = true): Promise<void> {
    if (!existsSync(this.paths.dir)) {
      if (requireState)
        throw new Error(
          `Agent Coordinator is not initialized in ${this.paths.root}`,
        );
      await mkdir(this.paths.dir, { recursive: true });
    }
    if (
      requireState &&
      (!existsSync(this.paths.config) || !existsSync(this.paths.state))
    ) {
      throw new Error(
        `Agent Coordinator is not initialized in ${this.paths.root}`,
      );
    }
  }

  private async appendEvent(input: Omit<Event, "id" | "at">): Promise<Event> {
    const event: Event = { id: randomId("evt"), at: timestamp(), ...input };
    await ensureJsonl(this.paths.events);
    await appendFile(this.paths.events, `${JSON.stringify(event)}\n`);
    return event;
  }
}

export async function findProjectRoot(start = process.cwd()): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, ".agent-coordinator", "config.json")))
      return current;
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export function createPaths(root: string): CoordinatorPaths {
  const dir = path.join(root, ".agent-coordinator");
  return {
    root,
    dir,
    config: path.join(dir, "config.json"),
    state: path.join(dir, "state.json"),
    events: path.join(dir, "events.jsonl"),
    messages: path.join(dir, "messages.jsonl"),
    lock: path.join(dir, "state.lock"),
  };
}

function getTask(state: CoordinatorState, id: string): Task {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`Task not found: ${id}`);
  return task;
}

function findConflicts(
  tasks: Task[],
  filesGlobs: string[],
  excludeTaskId?: string,
): Conflict[] {
  const now = new Date();
  const conflicts: Conflict[] = [];
  for (const task of tasks
    .filter((task) => task.id !== excludeTaskId)
    .filter((task) => ["claimed", "fixing", "verifying"].includes(task.status))
    .filter(
      (task) => !task.leaseExpiresAt || new Date(task.leaseExpiresAt) > now,
    )) {
    const matched = task.filesGlobs.filter((owned) =>
      filesGlobs.some((candidate) => scopesOverlap(owned, candidate)),
    );
    if (matched.length > 0) {
      conflicts.push({
        taskId: task.id,
        agent: task.agent,
        threadId: task.threadId,
        status: task.status,
        matched,
        leaseExpiresAt: task.leaseExpiresAt,
      });
    }
  }
  return conflicts;
}

function scopesOverlap(left: string, right: string): boolean {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  if (a === b) return true;
  if (a === "**" || b === "**") return true;
  const aPrefix = a.replace(/\*\*?$/u, "");
  const bPrefix = b.replace(/\*\*?$/u, "");
  return (
    aPrefix.length > 0 &&
    bPrefix.length > 0 &&
    (aPrefix.startsWith(bPrefix) || bPrefix.startsWith(aPrefix))
  );
}

function normalizeScope(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "").trim();
}

function formatConflicts(conflicts: Conflict[]): string {
  return conflicts
    .map(
      (item) =>
        `${item.taskId}${item.agent ? ` by ${item.agent}` : ""} (${item.matched.join(", ")})`,
    )
    .join("; ");
}

function renderSnapshot(
  config: CoordinatorConfig,
  state: CoordinatorState,
): string {
  const lines = [
    `# Agent Coordinator Snapshot`,
    ``,
    `Project: ${config.projectName}`,
    `Generated: ${timestamp()}`,
    ``,
    `This file is generated. Do not use it as the source of truth.`,
    ``,
  ];
  for (const status of TASK_STATUSES) {
    const tasks = state.tasks.filter((task) => task.status === status);
    lines.push(`## ${status}`, ``);
    if (tasks.length === 0) {
      lines.push(`_empty_`, ``);
      continue;
    }
    lines.push(
      `| ID | Updated | Agent | Thread | Scope | Files/globs | Next |`,
    );
    lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
    for (const task of tasks) {
      lines.push(
        `| ${escapeMd(task.id)} | ${escapeMd(task.updatedAt)} | ${escapeMd(task.agent ?? "")} | ${escapeMd(task.threadId ?? "")} | ${escapeMd(task.scope)} | ${escapeMd(task.filesGlobs.join(", "))} | ${escapeMd(task.next ?? task.blocker ?? "")} |`,
      );
    }
    lines.push(``);
  }
  return `${lines.join("\n")}\n`;
}

async function withProjectLock<T>(
  paths: CoordinatorPaths,
  fn: () => Promise<T>,
  description: string,
): Promise<T> {
  await mkdir(paths.dir, { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      const handle = await open(paths.lock, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, description, at: timestamp() }),
      );
      await handle.close();
      break;
    } catch (error) {
      if (Date.now() - started > 10_000) {
        throw new Error(
          `Timed out waiting for coordinator lock: ${(error as Error).message}`,
        );
      }
      await sleep(100);
    }
  }
  try {
    return await fn();
  } finally {
    await rm(paths.lock, { force: true });
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tempPath, filePath);
}

async function ensureJsonl(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await access(filePath, constants.F_OK);
  } catch {
    await writeFile(filePath, "");
  }
}

function createTaskId(index: number): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/gu, "");
  return `AGT-${date}-${String(index).padStart(3, "0")}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeEmailPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/gu, "-")
    .slice(0, 64);
}

function escapeMd(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\n/gu, " ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
