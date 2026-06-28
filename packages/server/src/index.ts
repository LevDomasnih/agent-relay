#!/usr/bin/env node
import {
  CURRENT_STATE_VERSION,
  type CoordinatorConfig,
  type CoordinatorState,
  type Event,
  type Message,
} from "@agent-relay/core";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type TokenGrant = {
  team: string;
  role: "admin" | "member" | "read";
};

type RouteContext = {
  team: string;
  project: string;
  tail: string[];
};

const port = Number(process.env.AGENT_RELAY_SERVER_PORT ?? 3737);
const host = process.env.AGENT_RELAY_SERVER_HOST ?? "127.0.0.1";
const dataDir =
  process.env.AGENT_RELAY_SERVER_DATA_DIR ??
  path.resolve(".agent-relay-server");
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "relay.sqlite"), {
  timeout: 5000,
});
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    team TEXT NOT NULL,
    project TEXT NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(team, project, kind)
  );
  CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    team TEXT NOT NULL,
    project TEXT NOT NULL,
    id TEXT NOT NULL,
    at TEXT NOT NULL,
    json TEXT NOT NULL,
    UNIQUE(team, project, id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    team TEXT NOT NULL,
    project TEXT NOT NULL,
    id TEXT NOT NULL,
    at TEXT NOT NULL,
    json TEXT NOT NULL,
    UNIQUE(team, project, id)
  );
  CREATE TABLE IF NOT EXISTS backups (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    team TEXT NOT NULL,
    project TEXT NOT NULL,
    at TEXT NOT NULL,
    state_json TEXT
  );
`);

const grants = readGrants();

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  console.error(`agent-relay-server listening on http://${host}:${port}`);
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  const route = parseRoute(request.url);
  if (!route) {
    sendJson(response, 404, { ok: false, error: "not found" });
    return;
  }
  const grant = authenticate(request, route.team);
  if (!grant) {
    sendJson(response, 401, { ok: false, error: "unauthorized" });
    return;
  }
  if (grant.role === "read" && request.method !== "GET") {
    sendJson(response, 403, { ok: false, error: "read-only token" });
    return;
  }

  const [resource] = route.tail;
  if (resource === "config") {
    await handleDocument(request, response, route, "config");
    return;
  }
  if (resource === "state") {
    await handleDocument(request, response, route, "state");
    return;
  }
  if (resource === "events") {
    await handleLog(request, response, route, "events");
    return;
  }
  if (resource === "messages") {
    await handleLog(request, response, route, "messages");
    return;
  }
  if (resource === "backups" && request.method === "POST") {
    const state = readDocument(route, "state");
    db.prepare(
      "INSERT INTO backups(team, project, at, state_json) VALUES (?, ?, ?, ?)",
    ).run(
      route.team,
      route.project,
      new Date().toISOString(),
      state?.value ?? null,
    );
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { ok: false, error: "not found" });
}

async function handleDocument(
  request: IncomingMessage,
  response: ServerResponse,
  route: RouteContext,
  kind: "config" | "state",
): Promise<void> {
  if (request.method === "GET") {
    const row = readDocument(route, kind);
    if (!row) {
      sendJson(response, 404, { ok: false, error: `${kind} not found` });
      return;
    }
    sendJson(response, 200, JSON.parse(row.value) as unknown, {
      etag: row.updatedAt,
    });
    return;
  }
  if (request.method === "PUT") {
    const value = await readJsonBody(request);
    if (kind === "state") validateState(value);
    if (kind === "config") validateConfig(value);
    const existing = readDocument(route, kind);
    const ifMatch = request.headers["if-match"];
    if (
      existing &&
      typeof ifMatch === "string" &&
      ifMatch !== existing.updatedAt
    ) {
      sendJson(response, 409, {
        ok: false,
        error: `${kind} was modified by another client`,
      });
      return;
    }
    const updatedAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO documents(team, project, kind, value, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(team, project, kind) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).run(route.team, route.project, kind, JSON.stringify(value), updatedAt);
    sendJson(response, 200, { ok: true }, { etag: updatedAt });
    return;
  }
  sendJson(response, 405, { ok: false, error: "method not allowed" });
}

async function handleLog(
  request: IncomingMessage,
  response: ServerResponse,
  route: RouteContext,
  kind: "events" | "messages",
): Promise<void> {
  if (request.method === "GET") {
    const rows = db
      .prepare(
        `SELECT json FROM ${kind} WHERE team = ? AND project = ? ORDER BY seq ASC`,
      )
      .all(route.team, route.project) as Array<{ json: string }>;
    sendJson(
      response,
      200,
      rows.map((row) => JSON.parse(row.json) as unknown),
    );
    return;
  }
  if (request.method === "POST") {
    const value = await readJsonBody(request);
    const id = objectString(value, "id");
    const at = objectString(value, "at");
    db.prepare(
      `INSERT OR IGNORE INTO ${kind}(team, project, id, at, json) VALUES (?, ?, ?, ?, ?)`,
    ).run(route.team, route.project, id, at, JSON.stringify(value));
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 405, { ok: false, error: "method not allowed" });
}

function parseRoute(urlValue?: string): RouteContext | undefined {
  if (!urlValue) return undefined;
  const url = new URL(urlValue, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length < 6 ||
    parts[0] !== "v1" ||
    parts[1] !== "teams" ||
    parts[3] !== "projects"
  ) {
    return undefined;
  }
  const team = decodeURIComponent(parts[2] ?? "");
  const project = decodeURIComponent(parts[4] ?? "");
  if (!safeSlug(team) || !safeSlug(project)) return undefined;
  return { team, project, tail: parts.slice(5) };
}

function authenticate(
  request: IncomingMessage,
  requestedTeam: string,
): TokenGrant | undefined {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return undefined;
  const grant = grants.get(token);
  if (!grant) return undefined;
  if (grant.team !== "*" && grant.team !== requestedTeam) return undefined;
  return grant;
}

function readGrants(): Map<string, TokenGrant> {
  const map = new Map<string, TokenGrant>();
  const single = process.env.AGENT_RELAY_SERVER_TOKEN;
  if (single) map.set(single, { team: "*", role: "admin" });
  const raw = process.env.AGENT_RELAY_SERVER_TOKENS;
  if (raw) {
    const parsed = JSON.parse(raw) as Record<
      string,
      string | Partial<TokenGrant>
    >;
    for (const [token, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        map.set(token, { team: value, role: "member" });
      } else if (value.team) {
        map.set(token, {
          team: value.team,
          role: value.role ?? "member",
        });
      }
    }
  }
  if (map.size === 0) {
    console.error(
      "warning: no AGENT_RELAY_SERVER_TOKEN or AGENT_RELAY_SERVER_TOKENS configured; all project routes will reject",
    );
  }
  return map;
}

function readDocument(
  route: RouteContext,
  kind: "config" | "state",
): { value: string; updatedAt: string } | undefined {
  const row = db
    .prepare(
      "SELECT value, updated_at as updatedAt FROM documents WHERE team = ? AND project = ? AND kind = ?",
    )
    .get(route.team, route.project, kind) as
    { value: string; updatedAt: string } | undefined;
  return row;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function validateConfig(value: unknown): asserts value is CoordinatorConfig {
  if (!value || typeof value !== "object") throw new Error("invalid config");
  if ((value as Partial<CoordinatorConfig>).version !== CURRENT_STATE_VERSION) {
    throw new Error("unsupported config version");
  }
}

function validateState(value: unknown): asserts value is CoordinatorState {
  if (!value || typeof value !== "object") throw new Error("invalid state");
  if ((value as Partial<CoordinatorState>).version !== CURRENT_STATE_VERSION) {
    throw new Error("unsupported state version");
  }
}

function objectString(value: unknown, key: string): string {
  if (!value || typeof value !== "object") {
    throw new Error(`invalid ${key}`);
  }
  const result = (value as Record<string, unknown>)[key];
  if (typeof result !== "string" || !result) {
    throw new Error(`missing ${key}`);
  }
  return result;
}

function safeSlug(value: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/u.test(value);
}
