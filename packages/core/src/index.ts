import { constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  chmod,
  copyFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { minimatch } from "minimatch";
import type { DatabaseSync } from "node:sqlite";

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

export type AgentTool = "codex" | "claude" | "cursor" | "unknown";

export type AgentInstance = {
  id: string;
  name: string;
  threadId?: string;
  tool: AgentTool;
  startedAt: string;
  lastSeenAt: string;
};

export type LockMode = "exclusive" | "shared-read" | "shared-docs" | "advisory";

export type LockScope = {
  glob: string;
  mode: LockMode;
};

export type Task = {
  id: string;
  displayId: string;
  title: string;
  repo: string;
  scope: string;
  status: TaskStatus;
  agent?: string;
  agentInstanceId?: string;
  threadId?: string;
  branch?: string;
  filesGlobs: string[];
  lockScopes: LockScope[];
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
  taskDisplayId?: string;
  agent?: string;
  agentInstanceId?: string;
  threadId?: string;
  type: string;
  message: string;
  data?: Record<string, unknown>;
};

export type Message = {
  id: string;
  at: string;
  kind: MessageKind;
  fromAgent: string;
  fromAgentInstanceId?: string;
  fromThreadId?: string;
  toAgent?: string;
  toAgentInstanceId?: string;
  toThreadId?: string;
  broadcast?: boolean;
  replyToMessageId?: string;
  mentions: string[];
  taskId?: string;
  text: string;
};

export type MessageKind =
  "note" | "question" | "blocker" | "ready_for_review" | "handoff" | "decision";

export type MessageReceipt = {
  messageId: string;
  agentInstanceId: string;
  readAt: string;
};

export type HandoffStatus =
  "requested" | "grant_after_commit" | "handoff_now" | "denied" | "cancelled";

export type HandoffRequest = {
  id: string;
  status: HandoffStatus;
  taskId: string;
  taskDisplayId: string;
  requestedByAgent: string;
  requestedByAgentInstanceId?: string;
  requestedByThreadId?: string;
  ownerTaskId?: string;
  ownerTaskDisplayId?: string;
  ownerAgent?: string;
  ownerAgentInstanceId?: string;
  ownerThreadId?: string;
  filesGlobs: string[];
  reason: string;
  response?: string;
  createdAt: string;
  updatedAt: string;
};

export type CoordinatorConfig = {
  version: 1;
  projectName: string;
  defaultLeaseMinutes: number;
  snapshotPath: string;
  stateDir?: string;
  storage?: StorageOptions;
};

export type GitIdentityBackup = {
  name?: string;
  email?: string;
  savedAt: string;
};

export type CoordinatorState = {
  version: 1;
  tasks: Task[];
  agents: AgentInstance[];
  handoffs: HandoffRequest[];
  messageReceipts: MessageReceipt[];
  gitIdentityBackup?: GitIdentityBackup;
};

export const CURRENT_STATE_VERSION = 1 as const;

export type CoordinatorPaths = {
  root: string;
  dir: string;
  stateDir: string;
  config: string;
  state: string;
  events: string;
  messages: string;
  lock: string;
};

export type Storage = {
  readonly type: StorageType;
  statePath(): string;
  sourcePaths(): string[];
  hasState(): Promise<boolean>;
  readRawState(): Promise<Partial<CoordinatorState>>;
  backupState(): Promise<string | undefined>;
  readConfig(): Promise<CoordinatorConfig>;
  writeConfig(config: CoordinatorConfig): Promise<void>;
  readState(): Promise<CoordinatorState>;
  writeState(state: CoordinatorState): Promise<void>;
  appendEvent(event: Event): Promise<void>;
  appendMessage(message: Message): Promise<void>;
  readEvents(): Promise<Event[]>;
  readMessages(): Promise<Message[]>;
};

export type AgentCoordinatorOptions = {
  stateDir?: string;
  storage?: StorageOptions;
};

export type StorageType = "json" | "sqlite" | "remote";

export type StorageOptions =
  | {
      type: "json";
    }
  | {
      type: "sqlite";
      sqlitePath?: string;
    }
  | {
      type: "remote";
      url: string;
      team: string;
      project: string;
      token?: string;
    };

export type CreateTaskInput = {
  id?: string;
  displayId?: string;
  title: string;
  scope: string;
  filesGlobs?: string[];
  lockMode?: LockMode;
  lockScopes?: LockScope[];
  checks?: string[];
  next?: string;
};

export type ClaimTaskInput = {
  taskId: string;
  agent: string;
  agentInstanceId?: string;
  threadId?: string;
  tool?: AgentTool;
  branch?: string;
  filesGlobs?: string[];
  lockMode?: LockMode;
  lockScopes?: LockScope[];
  leaseMinutes?: number;
  takeoverReason?: string;
};

export type UpdateTaskInput = {
  taskId: string;
  status: TaskStatus;
  agent?: string;
  agentInstanceId?: string;
  threadId?: string;
  scope?: string;
  filesGlobs?: string[];
  lockMode?: LockMode;
  lockScopes?: LockScope[];
  checks?: string[];
  next?: string;
  blocker?: string;
};

export type Conflict = {
  taskId: string;
  taskDisplayId: string;
  agent?: string;
  agentInstanceId?: string;
  threadId?: string;
  status: TaskStatus;
  matched: string[];
  leaseExpiresAt?: string;
};

export type DoctorCheck = {
  name: string;
  ok: boolean;
  message: string;
};

export type DoctorReport = {
  root: string;
  statePath: string;
  snapshotPath: string;
  checks: DoctorCheck[];
};

export type MigrationReport = {
  ok: boolean;
  fromVersion?: number;
  toVersion: typeof CURRENT_STATE_VERSION;
  changed: boolean;
  statePath: string;
  backupPath?: string;
  messages: string[];
};

export type VerifyWorktreeInput = {
  agent?: string;
  agentInstanceId?: string;
  threadId?: string;
};

export type VerifyWorktreeReport = {
  ok: boolean;
  modifiedFiles: string[];
  claimedFilesGlobs: string[];
  unclaimedFiles: string[];
  conflictingFiles: Array<{ file: string; conflict: Conflict }>;
  staleLeases: Conflict[];
  next: string[];
};

export type VerifyCommitInput = VerifyWorktreeInput & {
  message?: string;
};

export type VerifyCommitReport = VerifyWorktreeReport & {
  stagedFiles: string[];
  gitIdentity: { name?: string; email?: string };
  missingTrailers: string[];
};

export type VerifyCommitRangeInput = {
  range: string;
  requireKnownTasks?: boolean;
};

export type VerifyCommitRangeCommit = {
  sha: string;
  subject: string;
  files: string[];
  trailers: Record<string, string>;
  missingTrailers: string[];
  taskId?: string;
  taskDisplayId?: string;
  unknownTask: boolean;
  filesOutsideTaskScope: string[];
};

export type VerifyCommitRangeReport = {
  ok: boolean;
  range: string;
  commits: VerifyCommitRangeCommit[];
};

export type RequestHandoffInput = {
  taskId: string;
  agent: string;
  agentInstanceId?: string;
  threadId?: string;
  filesGlobs?: string[];
  reason: string;
};

export type PostMessageInput = {
  kind?: MessageKind;
  fromAgent: string;
  fromAgentInstanceId?: string;
  fromThreadId?: string;
  toAgent?: string;
  toAgentInstanceId?: string;
  toThreadId?: string;
  broadcast?: boolean;
  replyToMessageId?: string;
  mentions?: string[];
  taskId?: string;
  text: string;
};

export type InboxInput = {
  agent?: string;
  agentInstanceId?: string;
  threadId?: string;
  includeRead?: boolean;
  limit?: number;
};

export type InboxItem = {
  message: Message;
  read: boolean;
  directed: boolean;
};

export type MarkReadInput = {
  agentInstanceId: string;
  messageIds?: string[];
};

export type AgentPresence = AgentInstance & {
  active: boolean;
  activeTaskIds: string[];
  activeTaskDisplayIds: string[];
};

export type WatchInput = {
  since?: string;
  limit?: number;
};

export type WatchResult = {
  events: Event[];
  messages: Message[];
  handoffs: HandoffRequest[];
};

export type RespondHandoffInput = {
  handoffId: string;
  status: Exclude<HandoffStatus, "requested">;
  agent?: string;
  agentInstanceId?: string;
  threadId?: string;
  response?: string;
};

export type ExplainResult = {
  task?: Task;
  commit?: {
    sha: string;
    subject: string;
    trailers: Record<string, string>;
  };
  events: Event[];
  messages: Message[];
  handoffs: HandoffRequest[];
};

export class JsonFileStorage implements Storage {
  readonly type = "json" as const;

  constructor(private readonly paths: CoordinatorPaths) {}

  statePath(): string {
    return this.paths.state;
  }

  sourcePaths(): string[] {
    return [this.paths.state, this.paths.events, this.paths.messages];
  }

  async hasState(): Promise<boolean> {
    return existsSync(this.paths.state);
  }

  async readRawState(): Promise<Partial<CoordinatorState>> {
    return readJson<Partial<CoordinatorState>>(this.paths.state);
  }

  async backupState(): Promise<string> {
    const backupPath = `${this.paths.state}.bak-${timestamp().replace(/[:.]/gu, "-")}`;
    await copyFile(this.paths.state, backupPath);
    return backupPath;
  }

  async readConfig(): Promise<CoordinatorConfig> {
    return readJson<CoordinatorConfig>(this.paths.config);
  }

  async writeConfig(config: CoordinatorConfig): Promise<void> {
    await writeJsonAtomic(this.paths.config, config);
  }

  async readState(): Promise<CoordinatorState> {
    return normalizeState(
      await readJson<Partial<CoordinatorState>>(this.paths.state),
    );
  }

  async writeState(state: CoordinatorState): Promise<void> {
    await writeJsonAtomic(this.paths.state, normalizeState(state));
  }

  async appendEvent(event: Event): Promise<void> {
    await ensureJsonl(this.paths.events);
    await appendFile(this.paths.events, `${JSON.stringify(event)}\n`);
  }

  async appendMessage(message: Message): Promise<void> {
    await ensureJsonl(this.paths.messages);
    await appendFile(this.paths.messages, `${JSON.stringify(message)}\n`);
  }

  async readEvents(): Promise<Event[]> {
    return readJsonl<Event>(this.paths.events);
  }

  async readMessages(): Promise<Message[]> {
    return (await readJsonl<Partial<Message>>(this.paths.messages)).map(
      normalizeMessage,
    );
  }
}

export class SqliteStorage implements Storage {
  readonly type = "sqlite" as const;
  private db?: DatabaseSync;

  constructor(
    private readonly paths: CoordinatorPaths,
    private readonly sqlitePath = path.join(paths.stateDir, "state.sqlite"),
  ) {}

  statePath(): string {
    return this.sqlitePath;
  }

  sourcePaths(): string[] {
    return [this.sqlitePath];
  }

  async hasState(): Promise<boolean> {
    if (!existsSync(this.sqlitePath)) return false;
    await this.ensureSchema();
    const row = (await this.database())
      .prepare("SELECT value FROM documents WHERE kind = ?")
      .get("state") as { value: string } | undefined;
    return Boolean(row);
  }

  async readRawState(): Promise<Partial<CoordinatorState>> {
    await this.ensureSchema();
    const row = (await this.database())
      .prepare("SELECT value FROM documents WHERE kind = ?")
      .get("state") as { value: string } | undefined;
    if (!row) throw new Error(`Missing SQLite coordinator state`);
    return JSON.parse(row.value) as Partial<CoordinatorState>;
  }

  async backupState(): Promise<string | undefined> {
    if (!existsSync(this.sqlitePath)) return undefined;
    const backupPath = `${this.sqlitePath}.bak-${timestamp().replace(/[:.]/gu, "-")}`;
    await copyFile(this.sqlitePath, backupPath);
    return backupPath;
  }

  async readConfig(): Promise<CoordinatorConfig> {
    return readJson<CoordinatorConfig>(this.paths.config);
  }

  async writeConfig(config: CoordinatorConfig): Promise<void> {
    await writeJsonAtomic(this.paths.config, config);
  }

  async readState(): Promise<CoordinatorState> {
    return normalizeState(await this.readRawState());
  }

  async writeState(state: CoordinatorState): Promise<void> {
    await this.ensureSchema();
    (await this.database())
      .prepare(
        "INSERT INTO documents(kind, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(kind) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run("state", JSON.stringify(normalizeState(state)), timestamp());
  }

  async appendEvent(event: Event): Promise<void> {
    await this.ensureSchema();
    (await this.database())
      .prepare("INSERT INTO events(id, at, json) VALUES (?, ?, ?)")
      .run(event.id, event.at, JSON.stringify(event));
  }

  async appendMessage(message: Message): Promise<void> {
    await this.ensureSchema();
    (await this.database())
      .prepare("INSERT INTO messages(id, at, json) VALUES (?, ?, ?)")
      .run(message.id, message.at, JSON.stringify(message));
  }

  async readEvents(): Promise<Event[]> {
    await this.ensureSchema();
    const rows = (await this.database())
      .prepare("SELECT json FROM events ORDER BY seq ASC")
      .all() as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as Event);
  }

  async readMessages(): Promise<Message[]> {
    await this.ensureSchema();
    const rows = (await this.database())
      .prepare("SELECT json FROM messages ORDER BY seq ASC")
      .all() as Array<{ json: string }>;
    return rows.map((row) =>
      normalizeMessage(JSON.parse(row.json) as Partial<Message>),
    );
  }

  private async database(): Promise<DatabaseSync> {
    if (!this.db) {
      mkdirSync(path.dirname(this.sqlitePath), { recursive: true });
      const { DatabaseSync } = await import("node:sqlite");
      this.db = new DatabaseSync(this.sqlitePath, { timeout: 5000 });
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA busy_timeout = 5000");
    }
    return this.db;
  }

  private async ensureSchema(): Promise<void> {
    const db = await this.database();
    db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        kind TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        at TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        at TEXT NOT NULL,
        json TEXT NOT NULL
      );
    `);
  }
}

export class RemoteStorage implements Storage {
  readonly type = "remote" as const;
  private readonly baseUrl: string;
  private configEtag?: string;
  private stateEtag?: string;

  constructor(
    private readonly paths: CoordinatorPaths,
    private readonly options: Extract<StorageOptions, { type: "remote" }>,
  ) {
    this.baseUrl = `${options.url.replace(/\/+$/u, "")}/v1/teams/${encodeURIComponent(options.team)}/projects/${encodeURIComponent(options.project)}`;
  }

  statePath(): string {
    return this.baseUrl;
  }

  sourcePaths(): string[] {
    return [];
  }

  async hasState(): Promise<boolean> {
    const response = await this.request("GET", "state", undefined, {
      allowNotFound: true,
    });
    return response !== undefined;
  }

  async readRawState(): Promise<Partial<CoordinatorState>> {
    const result = await this.requestWithHeaders("GET", "state");
    this.stateEtag = result.etag;
    return result.body as Partial<CoordinatorState>;
  }

  async backupState(): Promise<string | undefined> {
    await this.request("POST", "backups", undefined);
    return undefined;
  }

  async readConfig(): Promise<CoordinatorConfig> {
    if (existsSync(this.paths.config)) {
      return readJson<CoordinatorConfig>(this.paths.config);
    }
    const result = await this.requestWithHeaders("GET", "config");
    this.configEtag = result.etag;
    return result.body as CoordinatorConfig;
  }

  async writeConfig(config: CoordinatorConfig): Promise<void> {
    await mkdir(this.paths.dir, { recursive: true });
    await writeJsonAtomic(this.paths.config, config);
    const result = await this.requestWithHeaders("PUT", "config", config, {
      etag: this.configEtag,
    });
    this.configEtag = result.etag;
  }

  async readState(): Promise<CoordinatorState> {
    return normalizeState(await this.readRawState());
  }

  async writeState(state: CoordinatorState): Promise<void> {
    const result = await this.requestWithHeaders(
      "PUT",
      "state",
      normalizeState(state),
      {
        etag: this.stateEtag,
      },
    );
    this.stateEtag = result.etag;
  }

  async appendEvent(event: Event): Promise<void> {
    await this.request("POST", "events", event);
  }

  async appendMessage(message: Message): Promise<void> {
    await this.request("POST", "messages", message);
  }

  async readEvents(): Promise<Event[]> {
    return this.requestJson<Event[]>("GET", "events");
  }

  async readMessages(): Promise<Message[]> {
    return (
      await this.requestJson<Array<Partial<Message>>>("GET", "messages")
    ).map(normalizeMessage);
  }

  private async requestJson<T>(
    method: string,
    route: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.request(method, route, body);
    return response as T;
  }

  private async requestWithHeaders(
    method: string,
    route: string,
    body?: unknown,
    options: { etag?: string; allowNotFound?: boolean } = {},
  ): Promise<{ body: unknown; etag?: string }> {
    const response = await this.fetch(method, route, body, options);
    if (response.status === 404 && options.allowNotFound) {
      return { body: undefined };
    }
    await assertRemoteOk(response, method, route);
    const etag = response.headers.get("etag") ?? undefined;
    return {
      body:
        response.status === 204
          ? undefined
          : ((await response.json()) as unknown),
      etag,
    };
  }

  private async request(
    method: string,
    route: string,
    body?: unknown,
    options: { allowNotFound?: boolean } = {},
  ): Promise<unknown> {
    const response = await this.fetch(method, route, body);
    if (response.status === 404 && options.allowNotFound) return undefined;
    await assertRemoteOk(response, method, route);
    if (response.status === 204) return undefined;
    return (await response.json()) as unknown;
  }

  private async fetch(
    method: string,
    route: string,
    body?: unknown,
    options: { etag?: string } = {},
  ): Promise<Response> {
    return fetch(`${this.baseUrl}/${route}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.etag ? { "if-match": options.etag } : {}),
        ...remoteAuthHeaders(this.options),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

export class AgentCoordinator {
  readonly paths: CoordinatorPaths;
  readonly storage: Storage;

  constructor(
    root: string,
    storage?: Storage,
    options?: AgentCoordinatorOptions,
  ) {
    this.paths = createPaths(root, options?.stateDir);
    const storageOptions =
      options?.storage ?? readConfiguredStorage(this.paths.dir);
    this.storage = storage ?? createStorage(this.paths, storageOptions);
  }

  async init(
    projectName = path.basename(this.paths.root),
    options: AgentCoordinatorOptions = {},
  ): Promise<CoordinatorConfig> {
    await mkdir(this.paths.dir, { recursive: true });
    await mkdir(this.paths.stateDir, { recursive: true });
    await mkdir(path.join(this.paths.dir, "snapshots"), { recursive: true });
    const config: CoordinatorConfig = {
      version: CURRENT_STATE_VERSION,
      projectName,
      defaultLeaseMinutes: 120,
      snapshotPath: ".coordinaut/snapshots/TASKS.md",
      stateDir: options.stateDir,
      storage: options.storage,
    };
    if (!existsSync(this.paths.config)) {
      await this.storage.writeConfig(config);
    } else if (options.stateDir || options.storage) {
      const existing = await this.storage.readConfig();
      await this.storage.writeConfig({
        ...existing,
        stateDir: options.stateDir,
        storage: options.storage ?? existing.storage,
      });
    }
    if (!(await this.storage.hasState())) {
      await this.storage.writeState({
        version: CURRENT_STATE_VERSION,
        tasks: [],
        agents: [],
        handoffs: [],
        messageReceipts: [],
      });
    }
    if (this.storage.type === "json") {
      await ensureJsonl(this.paths.events);
      await ensureJsonl(this.paths.messages);
    }
    await this.exportSnapshot();
    return existsSync(this.paths.config) ? this.storage.readConfig() : config;
  }

  async readConfig(): Promise<CoordinatorConfig> {
    await this.ensureInitialized();
    return this.storage.readConfig();
  }

  async readState(): Promise<CoordinatorState> {
    await this.ensureInitialized();
    return this.storage.readState();
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.mutate(`create task ${input.title}`, async (state) => {
      const now = timestamp();
      const displayId =
        input.displayId ??
        displayIdFromInput(input.id) ??
        createDisplayTaskId(state.tasks);
      const task: Task = {
        id: stableTaskId(input.id),
        displayId,
        title: input.title,
        repo: path.basename(this.paths.root),
        scope: input.scope,
        status: "todo",
        filesGlobs: input.filesGlobs ?? [],
        lockScopes: normalizeLockScopes(
          input.lockScopes,
          input.filesGlobs,
          input.lockMode,
        ),
        checks: input.checks ?? [],
        next: input.next,
        createdAt: now,
        updatedAt: now,
      };
      if (
        state.tasks.some(
          (item) => item.id === task.id || item.displayId === task.displayId,
        )
      ) {
        throw new Error(`Task already exists: ${task.displayId}`);
      }
      state.tasks.push(task);
      await this.appendEvent({
        taskId: task.id,
        taskDisplayId: task.displayId,
        type: "task.created",
        message: task.title,
        data: {
          scope: task.scope,
          filesGlobs: task.filesGlobs,
          lockScopes: task.lockScopes,
        },
      });
      return task;
    });
  }

  async claimTask(input: ClaimTaskInput): Promise<Task> {
    return this.mutate(`claim task ${input.taskId}`, async (state, config) => {
      const task = getTask(state, input.taskId);
      const lockScopes =
        input.lockScopes || input.filesGlobs || input.lockMode
          ? normalizeLockScopes(
              input.lockScopes,
              input.filesGlobs ?? task.filesGlobs,
              input.lockMode,
            )
          : task.lockScopes;
      const conflicts = findConflicts(state.tasks, lockScopes, task.id);
      const expiredConflicts = findExpiredConflicts(
        state.tasks,
        lockScopes,
        task.id,
      );
      if (conflicts.length > 0) {
        throw new Error(`Scope conflict: ${formatConflicts(conflicts)}`);
      }
      if (expiredConflicts.length > 0 && !input.takeoverReason) {
        throw new Error(
          `Expired lease takeover requires --takeover-reason. Previous owner: ${formatConflicts(expiredConflicts)}`,
        );
      }
      const now = timestamp();
      const agent = ensureAgentInstance(state, {
        id: input.agentInstanceId,
        name: input.agent,
        threadId: input.threadId,
        tool: input.tool,
        now,
      });
      task.status = "claimed";
      task.agent = input.agent;
      task.agentInstanceId = agent.id;
      task.threadId = input.threadId;
      task.branch = input.branch;
      task.filesGlobs = lockScopes.map((scope) => scope.glob);
      task.lockScopes = lockScopes;
      task.leaseExpiresAt = addMinutes(
        now,
        input.leaseMinutes ?? config.defaultLeaseMinutes,
      );
      task.updatedAt = now;
      for (const conflict of expiredConflicts) {
        await this.appendEvent({
          taskId: task.id,
          taskDisplayId: task.displayId,
          agent: input.agent,
          agentInstanceId: agent.id,
          threadId: input.threadId,
          type: "task.takeover",
          message: input.takeoverReason ?? "takeover",
          data: { previous: conflict },
        });
      }
      await this.appendEvent({
        taskId: task.id,
        taskDisplayId: task.displayId,
        agent: input.agent,
        agentInstanceId: agent.id,
        threadId: input.threadId,
        type: "task.claimed",
        message: `Claimed ${task.scope}`,
        data: {
          filesGlobs: task.filesGlobs,
          lockScopes: task.lockScopes,
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
      if (input.agent) {
        const agent = ensureAgentInstance(state, {
          id: input.agentInstanceId,
          name: input.agent,
          threadId: input.threadId,
          now,
        });
        task.agentInstanceId = agent.id;
      }
      task.status = input.status;
      task.agent = input.agent ?? task.agent;
      task.threadId = input.threadId ?? task.threadId;
      task.scope = input.scope ?? task.scope;
      if (input.filesGlobs || input.lockScopes || input.lockMode) {
        task.lockScopes = normalizeLockScopes(
          input.lockScopes,
          input.filesGlobs ?? task.filesGlobs,
          input.lockMode,
        );
        task.filesGlobs = task.lockScopes.map((scope) => scope.glob);
      }
      task.checks = input.checks ?? task.checks;
      task.next = input.next ?? task.next;
      task.blocker = input.blocker;
      task.updatedAt = now;
      if (input.status === "done") {
        task.leaseExpiresAt = undefined;
      }
      await this.appendEvent({
        taskId: task.id,
        taskDisplayId: task.displayId,
        agent: task.agent,
        agentInstanceId: task.agentInstanceId,
        threadId: task.threadId,
        type: `task.${input.status}`,
        message: input.next ?? input.blocker ?? input.status,
        data: {
          filesGlobs: task.filesGlobs,
          lockScopes: task.lockScopes,
          checks: task.checks,
        },
      });
      return task;
    });
  }

  async heartbeat(
    taskId: string,
    agent?: string,
    threadId?: string,
    leaseMinutes?: number,
    agentInstanceId?: string,
  ): Promise<Task> {
    return this.mutate(`heartbeat task ${taskId}`, async (state, config) => {
      const task = getTask(state, taskId);
      const now = timestamp();
      if (agent) {
        const instance = ensureAgentInstance(state, {
          id: agentInstanceId,
          name: agent,
          threadId,
          now,
        });
        task.agentInstanceId = instance.id;
      }
      task.agent = agent ?? task.agent;
      task.threadId = threadId ?? task.threadId;
      touchAgent(state, task.agentInstanceId, now);
      task.leaseExpiresAt = addMinutes(
        now,
        leaseMinutes ?? config.defaultLeaseMinutes,
      );
      task.updatedAt = now;
      await this.appendEvent({
        taskId: task.id,
        taskDisplayId: task.displayId,
        agent: task.agent,
        agentInstanceId: task.agentInstanceId,
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
    agentInstanceId?: string,
  ): Promise<Task> {
    return this.mutate(`release task ${taskId}`, async (state) => {
      const task = getTask(state, taskId);
      const now = timestamp();
      task.leaseExpiresAt = undefined;
      task.updatedAt = now;
      if (task.status !== "done" && task.status !== "blocked") {
        task.status = "todo";
      }
      touchAgent(state, agentInstanceId ?? task.agentInstanceId, now);
      await this.appendEvent({
        taskId: task.id,
        taskDisplayId: task.displayId,
        agent: agent ?? task.agent,
        agentInstanceId: agentInstanceId ?? task.agentInstanceId,
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

  async listMyTasks(
    agent?: string,
    threadId?: string,
    agentInstanceId?: string,
  ): Promise<Task[]> {
    const state = await this.readState();
    return state.tasks.filter((task) => {
      return (
        (agentInstanceId && task.agentInstanceId === agentInstanceId) ||
        (agent && task.agent === agent) ||
        (threadId && task.threadId === threadId)
      );
    });
  }

  async detectConflicts(
    filesGlobs: string[],
    excludeTaskId?: string,
    lockMode?: LockMode,
  ): Promise<Conflict[]> {
    const state = await this.readState();
    return findConflicts(
      state.tasks,
      normalizeLockScopes(undefined, filesGlobs, lockMode),
      excludeTaskId,
    );
  }

  async postMessage(input: PostMessageInput): Promise<Message> {
    return this.mutate("post message", async (state) => {
      const task = input.taskId ? getTask(state, input.taskId) : undefined;
      const now = timestamp();
      if (input.fromAgent) {
        ensureAgentInstance(state, {
          id: input.fromAgentInstanceId,
          name: input.fromAgent,
          threadId: input.fromThreadId,
          now,
        });
      }
      const message: Message = {
        id: randomId("msg"),
        at: now,
        kind: input.kind ?? "note",
        fromAgent: input.fromAgent,
        fromAgentInstanceId: input.fromAgentInstanceId,
        fromThreadId: input.fromThreadId,
        toAgent: input.toAgent,
        toAgentInstanceId: input.toAgentInstanceId,
        toThreadId: input.toThreadId,
        broadcast: input.broadcast,
        replyToMessageId: input.replyToMessageId,
        mentions: input.mentions ?? [],
        taskId: task?.id ?? input.taskId,
        text: input.text,
      };
      await this.storage.appendMessage(message);
      await this.appendEvent({
        taskId: task?.id ?? input.taskId,
        taskDisplayId: task?.displayId,
        agent: input.fromAgent,
        agentInstanceId: input.fromAgentInstanceId,
        threadId: input.fromThreadId,
        type: "message.posted",
        message: input.text,
        data: {
          kind: message.kind,
          toAgent: input.toAgent,
          toAgentInstanceId: input.toAgentInstanceId,
          toThreadId: input.toThreadId,
          broadcast: input.broadcast,
          mentions: message.mentions,
        },
      });
      return message;
    });
  }

  async inbox(input: InboxInput): Promise<InboxItem[]> {
    await this.ensureInitialized();
    const state = await this.storage.readState();
    const messages = await this.storage.readMessages();
    const receiptIds = new Set(
      state.messageReceipts
        .filter((receipt) => receipt.agentInstanceId === input.agentInstanceId)
        .map((receipt) => receipt.messageId),
    );
    return messages
      .filter((message) => messageTargetsAgent(message, input))
      .map((message) => ({
        message,
        read: input.agentInstanceId ? receiptIds.has(message.id) : false,
        directed: messageDirectedToAgent(message, input),
      }))
      .filter((item) => input.includeRead || !item.read)
      .slice(-(input.limit ?? 50))
      .reverse();
  }

  async markInboxRead(input: MarkReadInput): Promise<MessageReceipt[]> {
    return this.mutate("mark inbox read", async (state) => {
      const now = timestamp();
      const messages = await this.storage.readMessages();
      const messageIds =
        input.messageIds ?? messages.map((message) => message.id);
      const existing = new Set(
        state.messageReceipts
          .filter(
            (receipt) => receipt.agentInstanceId === input.agentInstanceId,
          )
          .map((receipt) => receipt.messageId),
      );
      const added: MessageReceipt[] = [];
      for (const messageId of messageIds) {
        if (existing.has(messageId)) continue;
        const receipt: MessageReceipt = {
          messageId,
          agentInstanceId: input.agentInstanceId,
          readAt: now,
        };
        state.messageReceipts.push(receipt);
        added.push(receipt);
      }
      await this.appendEvent({
        agentInstanceId: input.agentInstanceId,
        type: "inbox.read",
        message: `Marked ${added.length} message(s) read`,
        data: { messageIds: added.map((receipt) => receipt.messageId) },
      });
      return added;
    });
  }

  async presence(activeWithinMinutes = 15): Promise<AgentPresence[]> {
    const state = await this.readState();
    const cutoff = Date.now() - activeWithinMinutes * 60_000;
    return state.agents.map((agent) => {
      const activeTasks = state.tasks.filter(
        (task) => task.agentInstanceId === agent.id && isActive(task),
      );
      return {
        ...agent,
        active: new Date(agent.lastSeenAt).getTime() >= cutoff,
        activeTaskIds: activeTasks.map((task) => task.id),
        activeTaskDisplayIds: activeTasks.map((task) => task.displayId),
      };
    });
  }

  async watch(input: WatchInput = {}): Promise<WatchResult> {
    await this.ensureInitialized();
    const since = input.since ? new Date(input.since) : undefined;
    const limit = input.limit ?? 50;
    const state = await this.storage.readState();
    const events = (await this.storage.readEvents())
      .filter((event) => !since || new Date(event.at) > since)
      .slice(-limit);
    const messages = (await this.storage.readMessages())
      .filter((message) => !since || new Date(message.at) > since)
      .slice(-limit);
    const handoffs = state.handoffs
      .filter((handoff) => !since || new Date(handoff.updatedAt) > since)
      .slice(-limit);
    return { events, messages, handoffs };
  }

  async requestHandoff(input: RequestHandoffInput): Promise<HandoffRequest> {
    return this.mutate(`request handoff for ${input.taskId}`, async (state) => {
      const task = getTask(state, input.taskId);
      const requestedScopes = normalizeLockScopes(
        undefined,
        input.filesGlobs ?? task.filesGlobs,
      );
      const conflicts = findConflicts(state.tasks, requestedScopes, task.id);
      const owner = conflicts[0];
      const now = timestamp();
      const handoff: HandoffRequest = {
        id: randomId("handoff"),
        status: "requested",
        taskId: task.id,
        taskDisplayId: task.displayId,
        requestedByAgent: input.agent,
        requestedByAgentInstanceId: input.agentInstanceId,
        requestedByThreadId: input.threadId,
        ownerTaskId: owner?.taskId,
        ownerTaskDisplayId: owner?.taskDisplayId,
        ownerAgent: owner?.agent,
        ownerAgentInstanceId: owner?.agentInstanceId,
        ownerThreadId: owner?.threadId,
        filesGlobs: input.filesGlobs ?? task.filesGlobs,
        reason: input.reason,
        createdAt: now,
        updatedAt: now,
      };
      state.handoffs.push(handoff);
      await this.appendEvent({
        taskId: task.id,
        taskDisplayId: task.displayId,
        agent: input.agent,
        agentInstanceId: input.agentInstanceId,
        threadId: input.threadId,
        type: "handoff.requested",
        message: input.reason,
        data: { handoff },
      });
      await this.storage.appendMessage({
        id: randomId("msg"),
        at: now,
        kind: "handoff",
        fromAgent: input.agent,
        fromAgentInstanceId: input.agentInstanceId,
        fromThreadId: input.threadId,
        toAgent: owner?.agent,
        toAgentInstanceId: owner?.agentInstanceId,
        toThreadId: owner?.threadId,
        mentions: [owner?.agent, owner?.agentInstanceId].filter(
          Boolean,
        ) as string[],
        taskId: task.id,
        text: `Handoff requested for ${handoff.filesGlobs.join(", ")}: ${input.reason}`,
      });
      return handoff;
    });
  }

  async respondHandoff(input: RespondHandoffInput): Promise<HandoffRequest> {
    return this.mutate(`respond handoff ${input.handoffId}`, async (state) => {
      const handoff = getHandoff(state, input.handoffId);
      const now = timestamp();
      handoff.status = input.status;
      handoff.response = input.response;
      handoff.updatedAt = now;
      if (input.status === "handoff_now" && handoff.ownerTaskId) {
        const ownerTask = getTask(state, handoff.ownerTaskId);
        ownerTask.leaseExpiresAt = undefined;
        ownerTask.updatedAt = now;
        if (ownerTask.status !== "done" && ownerTask.status !== "blocked") {
          ownerTask.status = "todo";
        }
      }
      await this.appendEvent({
        taskId: handoff.taskId,
        taskDisplayId: handoff.taskDisplayId,
        agent: input.agent,
        agentInstanceId: input.agentInstanceId,
        threadId: input.threadId,
        type: `handoff.${input.status}`,
        message: input.response ?? input.status,
        data: { handoff },
      });
      await this.storage.appendMessage({
        id: randomId("msg"),
        at: now,
        kind: "handoff",
        fromAgent: input.agent ?? handoff.ownerAgent ?? "unknown",
        fromAgentInstanceId:
          input.agentInstanceId ?? handoff.ownerAgentInstanceId,
        fromThreadId: input.threadId ?? handoff.ownerThreadId,
        toAgent: handoff.requestedByAgent,
        toAgentInstanceId: handoff.requestedByAgentInstanceId,
        toThreadId: handoff.requestedByThreadId,
        mentions: [
          handoff.requestedByAgent,
          handoff.requestedByAgentInstanceId,
        ].filter(Boolean) as string[],
        taskId: handoff.taskId,
        text: `Handoff ${input.status}: ${input.response ?? ""}`.trim(),
      });
      return handoff;
    });
  }

  async listHandoffs(status?: HandoffStatus): Promise<HandoffRequest[]> {
    const state = await this.readState();
    return status
      ? state.handoffs.filter((handoff) => handoff.status === status)
      : state.handoffs;
  }

  async explain(input: {
    taskId?: string;
    commit?: string;
  }): Promise<ExplainResult> {
    await this.ensureInitialized();
    const state = await this.storage.readState();
    const events = await this.storage.readEvents();
    const messages = await this.storage.readMessages();
    const commit = input.commit
      ? await readCommitExplanation(this.paths.root, input.commit)
      : undefined;
    const trailerTaskId = commit?.trailers["Agent-Task"];
    const taskLookup = input.taskId ?? trailerTaskId;
    const task = taskLookup ? getTask(state, taskLookup) : undefined;
    const taskIds = new Set([task?.id, task?.displayId].filter(Boolean));
    const relatedEvents = events.filter(
      (event) =>
        !task || taskIds.has(event.taskId) || taskIds.has(event.taskDisplayId),
    );
    const relatedMessages = messages.filter(
      (message) => !task || taskIds.has(message.taskId),
    );
    const handoffs = state.handoffs.filter(
      (handoff) =>
        !task ||
        taskIds.has(handoff.taskId) ||
        taskIds.has(handoff.taskDisplayId) ||
        taskIds.has(handoff.ownerTaskId) ||
        taskIds.has(handoff.ownerTaskDisplayId),
    );
    return {
      task,
      commit,
      events: relatedEvents,
      messages: relatedMessages,
      handoffs,
    };
  }

  async exportSnapshot(): Promise<string> {
    await this.ensureInitialized(false);
    const config = existsSync(this.paths.config)
      ? await this.storage.readConfig()
      : defaultConfig(this.paths.root);
    const state = (await this.storage.hasState())
      ? await this.storage.readState()
      : ({
          version: CURRENT_STATE_VERSION,
          tasks: [],
          agents: [],
          handoffs: [],
          messageReceipts: [],
        } satisfies CoordinatorState);
    const snapshot = renderSnapshot(config, state);
    const snapshotPath = resolveInsideRoot(
      this.paths.root,
      config.snapshotPath,
      "snapshotPath",
    );
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, snapshot);
    return snapshotPath;
  }

  async configureGitIdentity(
    agent: string,
    threadId?: string,
    taskId?: string,
    agentInstanceId?: string,
  ): Promise<{ name: string; email: string; trailers: string[] }> {
    await this.ensureInitialized();
    const safeThread = threadId
      ? sanitizeEmailPart(threadId)
      : "unknown-thread";
    const email = `codex+${safeThread}@coordinaut.local`;
    const previous = await readGitIdentity(this.paths.root);
    await this.mutate("save git identity backup", async (state) => {
      if (!state.gitIdentityBackup) {
        state.gitIdentityBackup = { ...previous, savedAt: timestamp() };
      }
      return state.gitIdentityBackup;
    });
    await execFileAsync("git", ["config", "user.name", agent], {
      cwd: this.paths.root,
    });
    await execFileAsync("git", ["config", "user.email", email], {
      cwd: this.paths.root,
    });
    const trailers = [`Agent: ${agent}`];
    if (agentInstanceId) trailers.push(`Agent-Instance: ${agentInstanceId}`);
    if (threadId) trailers.push(`Agent-Thread: ${threadId}`);
    if (taskId) trailers.push(`Agent-Task: ${taskId}`);
    return { name: agent, email, trailers };
  }

  async resetGitIdentity(): Promise<{
    restored: boolean;
    name?: string;
    email?: string;
  }> {
    return this.mutate("reset git identity", async (state) => {
      const backup = state.gitIdentityBackup;
      if (!backup) return { restored: false };
      if (backup.name) {
        await execFileAsync("git", ["config", "user.name", backup.name], {
          cwd: this.paths.root,
        });
      } else {
        await execFileAsync("git", ["config", "--unset", "user.name"], {
          cwd: this.paths.root,
        }).catch(() => undefined);
      }
      if (backup.email) {
        await execFileAsync("git", ["config", "user.email", backup.email], {
          cwd: this.paths.root,
        });
      } else {
        await execFileAsync("git", ["config", "--unset", "user.email"], {
          cwd: this.paths.root,
        }).catch(() => undefined);
      }
      state.gitIdentityBackup = undefined;
      await this.appendEvent({
        type: "git.identity.reset",
        message: "Restored previous local git identity",
      });
      return { restored: true, name: backup.name, email: backup.email };
    });
  }

  async migrateState(): Promise<MigrationReport> {
    await this.ensureInitialized();
    const raw = await this.storage.readRawState();
    const fromVersion =
      typeof raw.version === "number" ? raw.version : undefined;
    const normalized = normalizeState(raw);
    const changed = JSON.stringify(raw) !== JSON.stringify(normalized);
    const messages = [];
    let backupPath: string | undefined;
    if (changed) {
      backupPath = await this.storage.backupState();
      await this.storage.writeState(normalized);
      await this.appendEvent({
        type: "state.migrated",
        message: `Migrated state from ${fromVersion ?? "unknown"} to ${CURRENT_STATE_VERSION}`,
        data: { fromVersion, toVersion: CURRENT_STATE_VERSION, backupPath },
      });
      messages.push("state normalized and backup written");
    } else {
      messages.push("state already matches current schema");
    }
    return {
      ok: true,
      fromVersion,
      toVersion: CURRENT_STATE_VERSION,
      changed,
      statePath: this.storage.statePath(),
      backupPath,
      messages,
    };
  }

  async doctor(): Promise<DoctorReport> {
    const checks: DoctorCheck[] = [];
    checks.push(
      await check("git repo", async () => {
        const root = (
          await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
            cwd: this.paths.root,
          })
        ).stdout.trim();
        return `git root: ${root}`;
      }),
    );
    checks.push({
      name: "config",
      ok: existsSync(this.paths.config),
      message: existsSync(this.paths.config)
        ? this.paths.config
        : "missing .coordinaut/config.json",
    });
    checks.push({
      name: "state dir",
      ok: existsSync(this.paths.stateDir),
      message: this.paths.stateDir,
    });
    checks.push(
      await check("state", async () => {
        const raw = await this.storage.readRawState();
        if (raw.version !== CURRENT_STATE_VERSION) {
          throw new Error(
            `state schema version ${raw.version ?? "unknown"} requires migration to ${CURRENT_STATE_VERSION}`,
          );
        }
        const state = normalizeState(raw);
        return `${state.tasks.length} task(s), ${state.agents.length} agent instance(s)`;
      }),
    );
    checks.push(
      await check("lock", async () => {
        if (!existsSync(this.paths.lock)) return "no active state lock";
        const info = await stat(this.paths.lock);
        const ageMs = Date.now() - info.mtimeMs;
        if (ageMs > 10 * 60 * 1000)
          throw new Error(`stale lock: ${this.paths.lock}`);
        return `active lock age ${Math.round(ageMs / 1000)}s`;
      }),
    );
    checks.push(
      await check("mcp command", async () => {
        const pkg = path.join(
          this.paths.root,
          "packages/mcp-server/package.json",
        );
        if (existsSync(pkg)) return "workspace MCP package present";
        return "install @coordinaut/mcp-server for MCP usage";
      }),
    );
    const config = existsSync(this.paths.config)
      ? await this.storage.readConfig()
      : defaultConfig(this.paths.root);
    let snapshotPath = path.resolve(this.paths.root, config.snapshotPath);
    checks.push(
      await check("snapshot path", async () => {
        snapshotPath = resolveInsideRoot(
          this.paths.root,
          config.snapshotPath,
          "snapshotPath",
        );
        return snapshotPath;
      }),
    );
    checks.push(
      await check("snapshot", async () => {
        if (!existsSync(snapshotPath)) return "snapshot not generated yet";
        const content = await readFile(snapshotPath, "utf8");
        if (!content.includes("Generated. Do not edit.")) {
          throw new Error("snapshot is missing generated-file marker");
        }
        const snapshotInfo = await stat(snapshotPath);
        const sourceTimes = await Promise.all(
          this.storage
            .sourcePaths()
            .filter((item) => existsSync(item))
            .map(async (item) => (await stat(item)).mtimeMs),
        );
        const newestSource = Math.max(0, ...sourceTimes);
        if (snapshotInfo.mtimeMs + 1000 < newestSource) {
          throw new Error("snapshot is older than coordinator state/logs");
        }
        return "generated snapshot is present and fresh";
      }),
    );
    const identity = await readGitIdentity(this.paths.root);
    checks.push({
      name: "git identity",
      ok: !identity.email?.endsWith("@coordinaut.local"),
      message: identity.email?.endsWith("@coordinaut.local")
        ? `agent identity still active: ${identity.name} <${identity.email}>`
        : `${identity.name ?? "(unset)"} <${identity.email ?? "unset"}>`,
    });
    return {
      root: this.paths.root,
      statePath: this.storage.statePath(),
      snapshotPath,
      checks,
    };
  }

  async verifyWorktree(
    input: VerifyWorktreeInput = {},
  ): Promise<VerifyWorktreeReport> {
    const modifiedFiles = await gitFiles(this.paths.root, [
      "diff",
      "--name-only",
    ]);
    return this.verifyFiles(modifiedFiles, input);
  }

  async verifyCommit(
    input: VerifyCommitInput = {},
  ): Promise<VerifyCommitReport> {
    const stagedFiles = await gitFiles(this.paths.root, [
      "diff",
      "--cached",
      "--name-only",
    ]);
    const base = await this.verifyFiles(stagedFiles, input);
    const gitIdentity = await readGitIdentity(this.paths.root);
    const missingTrailers = missingCommitTrailers(input.message);
    const ok = base.ok && missingTrailers.length === 0;
    return { ...base, ok, stagedFiles, gitIdentity, missingTrailers };
  }

  async verifyCommitRange(
    input: VerifyCommitRangeInput,
  ): Promise<VerifyCommitRangeReport> {
    await this.ensureInitialized();
    const state = await this.storage.readState();
    const commits = await listCommitRange(this.paths.root, input.range);
    const checked = commits.map((commit) => {
      const taskId = commit.trailers["Agent-Task"];
      const task = taskId
        ? state.tasks.find(
            (item) => item.id === taskId || item.displayId === taskId,
          )
        : undefined;
      const filesOutsideTaskScope = task
        ? commit.files.filter(
            (file) =>
              !task.lockScopes.some((scope) =>
                pathMatchesScope(file, scope.glob),
              ),
          )
        : [];
      return {
        ...commit,
        missingTrailers: missingCommitTrailersFromMap(commit.trailers),
        taskId: task?.id ?? taskId,
        taskDisplayId: task?.displayId,
        unknownTask: Boolean(taskId && !task),
        filesOutsideTaskScope,
      };
    });
    const ok = checked.every((commit) => {
      return (
        commit.missingTrailers.length === 0 &&
        commit.filesOutsideTaskScope.length === 0 &&
        (!input.requireKnownTasks || !commit.unknownTask)
      );
    });
    return { ok, range: input.range, commits: checked };
  }

  async installHooks(agentInstanceEnv = "COORDINAUT_INSTANCE"): Promise<{
    preCommit: string;
    commitMsg: string;
  }> {
    const gitDir = (
      await execFileAsync("git", ["rev-parse", "--git-dir"], {
        cwd: this.paths.root,
      })
    ).stdout.trim();
    const hooksDir = path.resolve(this.paths.root, gitDir, "hooks");
    await mkdir(hooksDir, { recursive: true });
    const preCommit = path.join(hooksDir, "pre-commit");
    const commitMsg = path.join(hooksDir, "commit-msg");
    await writeFile(
      preCommit,
      `#!/bin/sh\ncoordinaut verify-commit --agent-instance "$${agentInstanceEnv}"\n`,
    );
    await writeFile(
      commitMsg,
      `#!/bin/sh\ncoordinaut verify-commit --agent-instance "$${agentInstanceEnv}" --message-file "$1"\n`,
    );
    await chmod(preCommit, 0o755);
    await chmod(commitMsg, 0o755);
    return { preCommit, commitMsg };
  }

  private async verifyFiles(
    files: string[],
    input: VerifyWorktreeInput,
  ): Promise<VerifyWorktreeReport> {
    await this.ensureInitialized();
    const state = await this.storage.readState();
    const ownerTasks = state.tasks.filter(
      (task) => taskMatchesAgent(task, input) && isActive(task),
    );
    const claimedScopes = ownerTasks.flatMap((task) => task.lockScopes);
    const claimedFilesGlobs = claimedScopes.map(
      (scope) => `${scope.glob}:${scope.mode}`,
    );
    const unclaimedFiles = files.filter(
      (file) =>
        !claimedScopes.some((scope) => pathMatchesScope(file, scope.glob)),
    );
    const activeForeignTasks = state.tasks.filter(
      (task) => !taskMatchesAgent(task, input) && isActive(task),
    );
    const conflictingFiles = files.flatMap((file) =>
      activeForeignTasks
        .flatMap((task) => conflictForFile(task, file))
        .map((conflict) => ({ file, conflict })),
    );
    const staleLeases = state.tasks.filter(isStale).map(taskToConflict);
    const next: string[] = [];
    if (unclaimedFiles.length > 0) {
      next.push(
        `claim files: coordinaut claim --task <task> --files "${unclaimedFiles.join(",")}"`,
      );
    }
    if (conflictingFiles.length > 0) {
      next.push(
        "request handoff from the owning agent before editing conflicting files",
      );
    }
    if (staleLeases.length > 0) {
      next.push(
        "use --takeover-reason when claiming scopes held by expired leases",
      );
    }
    return {
      ok: unclaimedFiles.length === 0 && conflictingFiles.length === 0,
      modifiedFiles: files,
      claimedFilesGlobs,
      unclaimedFiles,
      conflictingFiles,
      staleLeases,
      next,
    };
  }

  private async mutate<T>(
    description: string,
    fn: (state: CoordinatorState, config: CoordinatorConfig) => Promise<T>,
  ): Promise<T> {
    await this.ensureInitialized();
    return withProjectLock(
      this.paths,
      async () => {
        const config = await this.storage.readConfig();
        const state = await this.storage.readState();
        const result = await fn(state, config);
        await this.storage.writeState(state);
        await this.exportSnapshot();
        return result;
      },
      description,
    );
  }

  private async ensureInitialized(requireState = true): Promise<void> {
    if (!existsSync(this.paths.dir)) {
      if (requireState) {
        throw new Error(`Coordinaut is not initialized in ${this.paths.root}`);
      }
      await mkdir(this.paths.dir, { recursive: true });
    }
    if (
      requireState &&
      (!existsSync(this.paths.config) || !(await this.storage.hasState()))
    ) {
      throw new Error(`Coordinaut is not initialized in ${this.paths.root}`);
    }
  }

  private async appendEvent(input: Omit<Event, "id" | "at">): Promise<Event> {
    const event: Event = { id: randomId("evt"), at: timestamp(), ...input };
    await this.storage.appendEvent(event);
    return event;
  }
}

export async function findProjectRoot(start = process.cwd()): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, ".coordinaut", "config.json")))
      return current;
    if (existsSync(path.join(current, ".agent-relay", "config.json")))
      return current;
    if (existsSync(path.join(current, ".agent-coordinator", "config.json")))
      return current;
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export function createPaths(
  root: string,
  stateDirInput?: string,
): CoordinatorPaths {
  const dir = resolveCoordinatorDir(root);
  const stateDir = resolveStateDir(root, dir, stateDirInput);
  return {
    root,
    dir,
    stateDir,
    config: path.join(dir, "config.json"),
    state: path.join(stateDir, "state.json"),
    events: path.join(stateDir, "events.jsonl"),
    messages: path.join(stateDir, "messages.jsonl"),
    lock: path.join(stateDir, "state.lock"),
  };
}

function resolveCoordinatorDir(root: string): string {
  const currentDir = path.join(root, ".coordinaut");
  const legacyRelayDir = path.join(root, ".agent-relay");
  const legacyCoordinatorDir = path.join(root, ".agent-coordinator");
  if (!existsSync(currentDir)) {
    if (existsSync(path.join(legacyRelayDir, "config.json")))
      return legacyRelayDir;
    if (existsSync(path.join(legacyCoordinatorDir, "config.json")))
      return legacyCoordinatorDir;
  }
  return currentDir;
}

function defaultConfig(root: string): CoordinatorConfig {
  return {
    version: 1,
    projectName: path.basename(root),
    defaultLeaseMinutes: 120,
    snapshotPath: ".coordinaut/snapshots/TASKS.md",
  };
}

function createStorage(
  paths: CoordinatorPaths,
  options?: StorageOptions,
): Storage {
  if (options?.type === "sqlite") {
    return new SqliteStorage(
      paths,
      options.sqlitePath
        ? path.resolve(paths.root, options.sqlitePath)
        : undefined,
    );
  }
  if (options?.type === "remote") {
    return new RemoteStorage(paths, options);
  }
  return new JsonFileStorage(paths);
}

function resolveStateDir(
  root: string,
  defaultDir: string,
  stateDirInput?: string,
): string {
  const configured =
    stateDirInput ??
    process.env.COORDINAUT_STATE_DIR ??
    process.env.AGENT_COORDINATOR_STATE_DIR ??
    readConfiguredStateDir(defaultDir);
  if (!configured) return defaultDir;
  return path.resolve(root, configured);
}

function resolveInsideRoot(root: string, value: string, label: string): string {
  const resolved = path.resolve(root, value);
  if (!isPathInside(root, resolved)) {
    throw new Error(`${label} must stay inside project root: ${value}`);
  }
  return resolved;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function readConfiguredStateDir(defaultDir: string): string | undefined {
  const configPath = path.join(defaultDir, "config.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const config = JSON.parse(
      readFileSync(configPath, "utf8"),
    ) as Partial<CoordinatorConfig>;
    return config.stateDir;
  } catch {
    return undefined;
  }
}

function readConfiguredStorage(defaultDir: string): StorageOptions | undefined {
  const configPath = path.join(defaultDir, "config.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const config = JSON.parse(
      readFileSync(configPath, "utf8"),
    ) as Partial<CoordinatorConfig>;
    return normalizeStorageOptions(config.storage);
  } catch {
    return undefined;
  }
}

function normalizeStorageOptions(
  storage: CoordinatorConfig["storage"],
): StorageOptions | undefined {
  if (!storage) return undefined;
  if (storage.type === "sqlite") {
    return {
      type: "sqlite",
      sqlitePath: storage.sqlitePath,
    };
  }
  if (storage.type === "remote") {
    if (!storage.url || !storage.team || !storage.project) return undefined;
    return {
      type: "remote",
      url: storage.url,
      team: storage.team,
      project: storage.project,
      token: storage.token,
    };
  }
  return { type: "json" };
}

function remoteAuthHeaders(
  options: Extract<StorageOptions, { type: "remote" }>,
): Record<string, string> {
  const token = options.token ?? process.env.COORDINAUT_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function assertRemoteOk(
  response: Response,
  method: string,
  route: string,
): Promise<void> {
  if (response.ok) return;
  const text = await response.text();
  throw new Error(
    `Remote storage ${method} ${route} failed: ${response.status} ${text}`,
  );
}

function normalizeState(input: Partial<CoordinatorState>): CoordinatorState {
  const tasks = (input.tasks ?? []).map((task, index) => {
    const legacy = task as Partial<Task> & { id: string };
    const displayId =
      legacy.displayId ??
      (legacy.id?.startsWith("AGT-")
        ? legacy.id
        : createDisplayTaskId(input.tasks ?? [], index + 1));
    return {
      ...legacy,
      id: legacy.id?.startsWith("AGT-") ? randomId("task") : legacy.id,
      displayId,
      filesGlobs: legacy.filesGlobs ?? [],
      lockScopes: normalizeLockScopes(
        legacy.lockScopes,
        legacy.filesGlobs ?? [],
        undefined,
      ),
      checks: legacy.checks ?? [],
    } as Task;
  });
  return {
    version: CURRENT_STATE_VERSION,
    tasks,
    agents: input.agents ?? [],
    handoffs: input.handoffs ?? [],
    messageReceipts: input.messageReceipts ?? [],
    gitIdentityBackup: input.gitIdentityBackup,
  };
}

function normalizeMessage(input: Partial<Message>): Message {
  return {
    id: input.id ?? randomId("msg"),
    at: input.at ?? timestamp(),
    kind: input.kind ?? "note",
    fromAgent: input.fromAgent ?? "unknown",
    fromAgentInstanceId: input.fromAgentInstanceId,
    fromThreadId: input.fromThreadId,
    toAgent: input.toAgent,
    toAgentInstanceId: input.toAgentInstanceId,
    toThreadId: input.toThreadId,
    broadcast: input.broadcast,
    replyToMessageId: input.replyToMessageId,
    mentions: input.mentions ?? [],
    taskId: input.taskId,
    text: input.text ?? "",
  };
}

function getTask(state: CoordinatorState, id: string): Task {
  const task = state.tasks.find(
    (item) => item.id === id || item.displayId === id,
  );
  if (!task) throw new Error(`Task not found: ${id}`);
  return task;
}

function getHandoff(state: CoordinatorState, id: string): HandoffRequest {
  const handoff = state.handoffs.find((item) => item.id === id);
  if (!handoff) throw new Error(`Handoff not found: ${id}`);
  return handoff;
}

function stableTaskId(input?: string): string {
  if (input && !input.startsWith("AGT-")) return input;
  return randomId("task");
}

function displayIdFromInput(input?: string): string | undefined {
  return input?.startsWith("AGT-") ? input : undefined;
}

function createDisplayTaskId(
  tasks: Array<Partial<Task>>,
  index?: number,
): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/gu, "");
  const next =
    index ??
    tasks.filter(
      (task) =>
        task.displayId?.startsWith(`AGT-${date}-`) ||
        task.id?.startsWith(`AGT-${date}-`),
    ).length + 1;
  return `AGT-${date}-${String(next).padStart(3, "0")}`;
}

function normalizeLockScopes(
  lockScopes?: LockScope[],
  filesGlobs: string[] = [],
  lockMode: LockMode = "exclusive",
): LockScope[] {
  if (lockScopes && lockScopes.length > 0) {
    return lockScopes.map((scope) => ({
      glob: normalizeScope(scope.glob),
      mode: scope.mode ?? lockMode,
    }));
  }
  return filesGlobs.map((glob) => ({
    glob: normalizeScope(glob),
    mode: lockMode,
  }));
}

function ensureAgentInstance(
  state: CoordinatorState,
  input: {
    id?: string;
    name: string;
    threadId?: string;
    tool?: AgentTool;
    now: string;
  },
): AgentInstance {
  const existing =
    (input.id
      ? state.agents.find((agent) => agent.id === input.id)
      : undefined) ??
    state.agents.find(
      (agent) => agent.name === input.name && agent.threadId === input.threadId,
    );
  if (existing) {
    existing.name = input.name;
    existing.threadId = input.threadId ?? existing.threadId;
    existing.tool = input.tool ?? existing.tool;
    existing.lastSeenAt = input.now;
    return existing;
  }
  const agent: AgentInstance = {
    id: input.id ?? randomId("agent"),
    name: input.name,
    threadId: input.threadId,
    tool: input.tool ?? "unknown",
    startedAt: input.now,
    lastSeenAt: input.now,
  };
  state.agents.push(agent);
  return agent;
}

function touchAgent(
  state: CoordinatorState,
  agentInstanceId: string | undefined,
  now: string,
): void {
  const agent = agentInstanceId
    ? state.agents.find((item) => item.id === agentInstanceId)
    : undefined;
  if (agent) agent.lastSeenAt = now;
}

function findConflicts(
  tasks: Task[],
  requested: LockScope[],
  excludeTaskId?: string,
): Conflict[] {
  return tasks
    .filter(
      (task) => task.id !== excludeTaskId && task.displayId !== excludeTaskId,
    )
    .filter(isActive)
    .flatMap((task) => conflictWithTask(task, requested));
}

function findExpiredConflicts(
  tasks: Task[],
  requested: LockScope[],
  excludeTaskId?: string,
): Conflict[] {
  return tasks
    .filter(
      (task) => task.id !== excludeTaskId && task.displayId !== excludeTaskId,
    )
    .filter(isStale)
    .flatMap((task) => conflictWithTask(task, requested));
}

function conflictWithTask(task: Task, requested: LockScope[]): Conflict[] {
  const matched = task.lockScopes
    .filter((owned) =>
      requested.some((candidate) => lockScopesConflict(owned, candidate)),
    )
    .map((scope) => `${scope.glob}:${scope.mode}`);
  return matched.length > 0 ? [{ ...taskToConflict(task), matched }] : [];
}

function conflictForFile(task: Task, file: string): Conflict[] {
  const matched = task.lockScopes.filter(
    (scope) => scope.mode !== "advisory" && pathMatchesScope(file, scope.glob),
  );
  return matched.length > 0
    ? [
        {
          ...taskToConflict(task),
          matched: matched.map((scope) => `${scope.glob}:${scope.mode}`),
        },
      ]
    : [];
}

function taskToConflict(task: Task): Conflict {
  return {
    taskId: task.id,
    taskDisplayId: task.displayId,
    agent: task.agent,
    agentInstanceId: task.agentInstanceId,
    threadId: task.threadId,
    status: task.status,
    matched: [],
    leaseExpiresAt: task.leaseExpiresAt,
  };
}

function isActive(task: Task): boolean {
  return (
    ["claimed", "fixing", "verifying"].includes(task.status) && !isStale(task)
  );
}

function isStale(task: Task): boolean {
  return (
    ["claimed", "fixing", "verifying"].includes(task.status) &&
    Boolean(task.leaseExpiresAt) &&
    new Date(task.leaseExpiresAt as string) <= new Date()
  );
}

function lockScopesConflict(left: LockScope, right: LockScope): boolean {
  if (!scopesOverlap(left.glob, right.glob)) return false;
  if (left.mode === "advisory" || right.mode === "advisory") return false;
  if (left.mode === "exclusive" || right.mode === "exclusive") return true;
  if (left.mode === "shared-docs" && right.mode === "shared-docs") return false;
  if (left.mode === "shared-read" && right.mode === "shared-read") return false;
  return true;
}

function scopesOverlap(left: string, right: string): boolean {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  if (a === b) return true;
  if (a === "**" || b === "**") return true;
  return (
    globIntersectsByPrefix(a, b) ||
    pathMatchesScope(a, b) ||
    pathMatchesScope(b, a)
  );
}

function pathMatchesScope(file: string, scope: string): boolean {
  const normalizedFile = normalizeScope(file);
  const normalizedScope = normalizeScope(scope);
  if (normalizedScope === "**") return true;
  if (!normalizedScope.includes("*"))
    return (
      normalizedFile === normalizedScope ||
      normalizedFile.startsWith(`${normalizedScope}/`)
    );
  return minimatch(normalizedFile, normalizedScope, {
    dot: true,
    nocase: false,
    nonegate: true,
  });
}

function globIntersectsByPrefix(left: string, right: string): boolean {
  const aPrefix = staticGlobPrefix(left);
  const bPrefix = staticGlobPrefix(right);
  return (
    aPrefix === "" ||
    bPrefix === "" ||
    aPrefix.startsWith(bPrefix) ||
    bPrefix.startsWith(aPrefix)
  );
}

function staticGlobPrefix(value: string): string {
  const normalized = normalizeScope(value);
  const globIndex = normalized.search(/[*?[{]/u);
  const prefix = globIndex === -1 ? normalized : normalized.slice(0, globIndex);
  const slash = prefix.lastIndexOf("/");
  return slash === -1 ? "" : prefix.slice(0, slash + 1);
}

function normalizeScope(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "").trim();
}

function taskMatchesAgent(task: Task, input: VerifyWorktreeInput): boolean {
  return (
    Boolean(
      input.agentInstanceId && task.agentInstanceId === input.agentInstanceId,
    ) ||
    Boolean(input.agent && task.agent === input.agent) ||
    Boolean(input.threadId && task.threadId === input.threadId)
  );
}

function messageTargetsAgent(message: Message, input: InboxInput): boolean {
  if (
    message.fromAgentInstanceId &&
    message.fromAgentInstanceId === input.agentInstanceId
  ) {
    return false;
  }
  if (message.broadcast) return true;
  if (messageDirectedToAgent(message, input)) return true;
  return message.mentions.some(
    (mention) =>
      Boolean(input.agent && mention === input.agent) ||
      Boolean(input.agentInstanceId && mention === input.agentInstanceId) ||
      Boolean(input.threadId && mention === input.threadId),
  );
}

function messageDirectedToAgent(message: Message, input: InboxInput): boolean {
  return (
    Boolean(
      input.agentInstanceId &&
      message.toAgentInstanceId === input.agentInstanceId,
    ) ||
    Boolean(input.agent && message.toAgent === input.agent) ||
    Boolean(input.threadId && message.toThreadId === input.threadId)
  );
}

function formatConflicts(conflicts: Conflict[]): string {
  return conflicts
    .map(
      (item) =>
        `${item.taskDisplayId} (${item.taskId})${item.agent ? ` by ${item.agent}` : ""}${item.threadId ? ` thread ${item.threadId}` : ""} [${item.matched.join(", ")}]`,
    )
    .join("; ");
}

function renderSnapshot(
  config: CoordinatorConfig,
  state: CoordinatorState,
): string {
  const lines = [
    `# Coordinaut Snapshot`,
    ``,
    `Project: ${config.projectName}`,
    `Generated: ${timestamp()}`,
    ``,
    `Generated. Do not edit. Source of truth: .coordinaut/state.json and events.jsonl.`,
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
      `| ID | Machine ID | Updated | Agent | Instance | Thread | Scope | Locks | Next |`,
    );
    lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
    for (const task of tasks) {
      lines.push(
        `| ${escapeMd(task.displayId)} | ${escapeMd(task.id)} | ${escapeMd(task.updatedAt)} | ${escapeMd(task.agent ?? "")} | ${escapeMd(task.agentInstanceId ?? "")} | ${escapeMd(task.threadId ?? "")} | ${escapeMd(task.scope)} | ${escapeMd(task.lockScopes.map((scope) => `${scope.glob}:${scope.mode}`).join(", "))} | ${escapeMd(task.next ?? task.blocker ?? "")} |`,
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
  await mkdir(paths.stateDir, { recursive: true });
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

async function check(
  name: string,
  fn: () => Promise<string>,
): Promise<DoctorCheck> {
  try {
    return { name, ok: true, message: await fn() };
  } catch (error) {
    return {
      name,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function gitFiles(root: string, args: string[]): Promise<string[]> {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readGitIdentity(
  root: string,
): Promise<{ name?: string; email?: string }> {
  const name = await execFileAsync("git", ["config", "--get", "user.name"], {
    cwd: root,
  })
    .then((result) => result.stdout.trim() || undefined)
    .catch(() => undefined);
  const email = await execFileAsync("git", ["config", "--get", "user.email"], {
    cwd: root,
  })
    .then((result) => result.stdout.trim() || undefined)
    .catch(() => undefined);
  return { name, email };
}

async function readCommitExplanation(
  root: string,
  sha: string,
): Promise<{ sha: string; subject: string; trailers: Record<string, string> }> {
  const message = (
    await execFileAsync("git", ["show", "-s", "--format=%B", sha], {
      cwd: root,
    })
  ).stdout.trimEnd();
  const resolvedSha = (
    await execFileAsync("git", ["rev-parse", sha], { cwd: root })
  ).stdout.trim();
  const [subject = ""] = message.split("\n");
  return { sha: resolvedSha, subject, trailers: parseTrailers(message) };
}

async function listCommitRange(
  root: string,
  range: string,
): Promise<
  Array<{
    sha: string;
    subject: string;
    files: string[];
    trailers: Record<string, string>;
  }>
> {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-list", "--reverse", range],
    { cwd: root },
  );
  const shas = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const commits = [];
  for (const sha of shas) {
    const message = (
      await execFileAsync("git", ["show", "-s", "--format=%B", sha], {
        cwd: root,
      })
    ).stdout.trimEnd();
    const files = (
      await execFileAsync("git", ["show", "--format=", "--name-only", sha], {
        cwd: root,
      })
    ).stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const [subject = ""] = message.split("\n");
    commits.push({ sha, subject, files, trailers: parseTrailers(message) });
  }
  return commits;
}

function parseTrailers(message: string): Record<string, string> {
  const trailers: Record<string, string> = {};
  for (const line of message.split("\n")) {
    const match = /^([A-Za-z][A-Za-z-]*):\s+(.+)$/u.exec(line.trim());
    if (match) trailers[match[1] as string] = match[2] as string;
  }
  return trailers;
}

function missingCommitTrailers(message?: string): string[] {
  if (!message) return [];
  return missingCommitTrailersFromMap(parseTrailers(message));
}

function missingCommitTrailersFromMap(
  trailers: Record<string, string>,
): string[] {
  return ["Agent", "Agent-Task"].filter((trailer) => !trailers[trailer]);
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
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

function randomId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function addMinutes(dateIso: string, minutes: number): string {
  return new Date(new Date(dateIso).getTime() + minutes * 60_000).toISOString();
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
