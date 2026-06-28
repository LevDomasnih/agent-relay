#!/usr/bin/env node
import {
  CURRENT_STATE_VERSION,
  type CoordinatorConfig,
  type CoordinatorState,
  type Event,
  type Message,
} from "@coordinaut/core";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, timingSafeEqual } from "node:crypto";

type TokenGrant = {
  team: string;
  role: "admin" | "member" | "read";
};

type RequestContext = {
  id: string;
  startedAt: number;
};

type TeamRouteContext = {
  team: string;
  tail: string[];
};

type RouteContext = {
  team: string;
  project: string;
  tail: string[];
};

const port = Number(process.env.COORDINAUT_SERVER_PORT ?? 3737);
const host = process.env.COORDINAUT_SERVER_HOST ?? "127.0.0.1";
const maxBodyBytes = Number(
  process.env.COORDINAUT_SERVER_MAX_BODY_BYTES ?? 1_000_000,
);
const allowedOrigins = parseAllowedOrigins(
  process.env.COORDINAUT_SERVER_ALLOWED_ORIGINS,
);
const dataDir =
  process.env.COORDINAUT_SERVER_DATA_DIR ?? path.resolve(".coordinaut-server");
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
  CREATE TABLE IF NOT EXISTS audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    request_id TEXT NOT NULL,
    team TEXT,
    project TEXT,
    role TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    message TEXT
  );
`);

const grants = readGrants();

const server = createServer(async (request, response) => {
  const context: RequestContext = {
    id: randomUUID(),
    startedAt: Date.now(),
  };
  try {
    await handleRequest(request, response, context);
  } catch (error) {
    sendJson(
      request,
      response,
      500,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      {},
      context,
    );
  }
});

server.listen(port, host, () => {
  console.error(`coordinaut-server listening on http://${host}:${port}`);
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<void> {
  if (request.method === "OPTIONS") {
    sendEmpty(request, response, 204, {}, context);
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(request, response, 200, { ok: true }, {}, context);
    return;
  }

  if (request.method === "GET" && isDashboardPath(request.url)) {
    sendHtml(request, response, dashboardHtml(), context);
    return;
  }

  const teamRoute = parseTeamRoute(request.url);
  if (
    teamRoute &&
    teamRoute.tail.length === 1 &&
    teamRoute.tail[0] === "projects"
  ) {
    const grant = authenticate(request, teamRoute.team);
    if (!grant) {
      audit(context, request, 401, {
        team: teamRoute.team,
        message: "unauthorized",
      });
      sendJson(
        request,
        response,
        401,
        { ok: false, error: "unauthorized" },
        {},
        context,
      );
      return;
    }
    if (request.method !== "GET") {
      sendJson(
        request,
        response,
        405,
        { ok: false, error: "method not allowed" },
        {},
        context,
      );
      return;
    }
    sendJson(
      request,
      response,
      200,
      {
        ok: true,
        team: teamRoute.team,
        projects: listProjects(teamRoute.team),
      },
      {},
      context,
    );
    return;
  }

  const route = parseRoute(request.url);
  if (!route) {
    sendJson(
      request,
      response,
      404,
      { ok: false, error: "not found" },
      {},
      context,
    );
    return;
  }
  const grant = authenticate(request, route.team);
  if (!grant) {
    audit(context, request, 401, {
      team: route.team,
      project: route.project,
      message: "unauthorized",
    });
    sendJson(
      request,
      response,
      401,
      { ok: false, error: "unauthorized" },
      {},
      context,
    );
    return;
  }
  if (grant.role === "read" && request.method !== "GET") {
    audit(context, request, 403, {
      team: route.team,
      project: route.project,
      role: grant.role,
      message: "read-only token",
    });
    sendJson(
      request,
      response,
      403,
      { ok: false, error: "read-only token" },
      {},
      context,
    );
    return;
  }

  const [resource] = route.tail;
  if (resource === "summary") {
    if (request.method !== "GET") {
      sendJson(
        request,
        response,
        405,
        { ok: false, error: "method not allowed" },
        {},
        context,
      );
      return;
    }
    sendJson(request, response, 200, readProjectSummary(route), {}, context);
    return;
  }
  if (resource === "audit") {
    if (request.method !== "GET") {
      sendJson(
        request,
        response,
        405,
        { ok: false, error: "method not allowed" },
        {},
        context,
      );
      return;
    }
    sendJson(
      request,
      response,
      200,
      {
        ok: true,
        audit: readAuditLog(route, grant),
      },
      {},
      context,
    );
    return;
  }
  if (resource === "config") {
    await handleDocument(request, response, route, "config", context, grant);
    return;
  }
  if (resource === "state") {
    await handleDocument(request, response, route, "state", context, grant);
    return;
  }
  if (resource === "events") {
    await handleLog(request, response, route, "events", context, grant);
    return;
  }
  if (resource === "messages") {
    await handleLog(request, response, route, "messages", context, grant);
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
    audit(context, request, 200, {
      team: route.team,
      project: route.project,
      role: grant.role,
      message: "backup.created",
    });
    sendJson(request, response, 200, { ok: true }, {}, context);
    return;
  }

  sendJson(
    request,
    response,
    404,
    { ok: false, error: "not found" },
    {},
    context,
  );
}

async function handleDocument(
  request: IncomingMessage,
  response: ServerResponse,
  route: RouteContext,
  kind: "config" | "state",
  context: RequestContext,
  grant: TokenGrant,
): Promise<void> {
  if (request.method === "GET") {
    const row = readDocument(route, kind);
    if (!row) {
      sendJson(
        request,
        response,
        404,
        { ok: false, error: `${kind} not found` },
        {},
        context,
      );
      return;
    }
    sendJson(
      request,
      response,
      200,
      JSON.parse(row.value) as unknown,
      {
        etag: row.updatedAt,
      },
      context,
    );
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
      sendJson(
        request,
        response,
        409,
        {
          ok: false,
          error: `${kind} was modified by another client`,
        },
        {},
        context,
      );
      return;
    }
    const updatedAt = new Date().toISOString();
    db.prepare(
      "INSERT INTO documents(team, project, kind, value, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(team, project, kind) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).run(route.team, route.project, kind, JSON.stringify(value), updatedAt);
    audit(context, request, 200, {
      team: route.team,
      project: route.project,
      role: grant.role,
      message: `${kind}.updated`,
    });
    sendJson(
      request,
      response,
      200,
      { ok: true },
      { etag: updatedAt },
      context,
    );
    return;
  }
  sendJson(
    request,
    response,
    405,
    { ok: false, error: "method not allowed" },
    {},
    context,
  );
}

async function handleLog(
  request: IncomingMessage,
  response: ServerResponse,
  route: RouteContext,
  kind: "events" | "messages",
  context: RequestContext,
  grant: TokenGrant,
): Promise<void> {
  if (request.method === "GET") {
    const rows = db
      .prepare(
        `SELECT json FROM ${kind} WHERE team = ? AND project = ? ORDER BY seq ASC`,
      )
      .all(route.team, route.project) as Array<{ json: string }>;
    sendJson(
      request,
      response,
      200,
      rows.map((row) => JSON.parse(row.json) as unknown),
      {},
      context,
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
    audit(context, request, 200, {
      team: route.team,
      project: route.project,
      role: grant.role,
      message: `${kind}.appended`,
    });
    sendJson(request, response, 200, { ok: true }, {}, context);
    return;
  }
  sendJson(
    request,
    response,
    405,
    { ok: false, error: "method not allowed" },
    {},
    context,
  );
}

function parseTeamRoute(urlValue?: string): TeamRouteContext | undefined {
  if (!urlValue) return undefined;
  const url = new URL(urlValue, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "v1" || parts[1] !== "teams") {
    return undefined;
  }
  const team = decodeURIComponent(parts[2] ?? "");
  if (!safeSlug(team)) return undefined;
  return { team, tail: parts.slice(3) };
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
  const grant = findGrant(token);
  if (!grant) return undefined;
  if (grant.team !== "*" && grant.team !== requestedTeam) return undefined;
  return grant;
}

function findGrant(token: string): TokenGrant | undefined {
  for (const [candidate, grant] of grants.entries()) {
    if (constantTimeEqual(candidate, token)) return grant;
  }
  return undefined;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function readGrants(): Map<string, TokenGrant> {
  const map = new Map<string, TokenGrant>();
  const single = process.env.COORDINAUT_SERVER_TOKEN;
  if (single) map.set(single, { team: "*", role: "admin" });
  const raw = process.env.COORDINAUT_SERVER_TOKENS;
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
      "warning: no COORDINAUT_SERVER_TOKEN or COORDINAUT_SERVER_TOKENS configured; all project routes will reject",
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

function listProjects(team: string): Array<{
  project: string;
  updatedAt?: string;
  hasConfig: boolean;
  hasState: boolean;
}> {
  const rows = db
    .prepare(
      `SELECT
        project,
        MAX(updated_at) AS updatedAt,
        MAX(CASE WHEN kind = 'config' THEN 1 ELSE 0 END) AS hasConfig,
        MAX(CASE WHEN kind = 'state' THEN 1 ELSE 0 END) AS hasState
      FROM documents
      WHERE team = ?
      GROUP BY project
      ORDER BY project ASC`,
    )
    .all(team) as unknown as Array<{
    project: string;
    updatedAt?: string;
    hasConfig: number;
    hasState: number;
  }>;
  return rows.map((row) => ({
    project: row.project,
    updatedAt: row.updatedAt,
    hasConfig: Boolean(row.hasConfig),
    hasState: Boolean(row.hasState),
  }));
}

function readProjectSummary(route: RouteContext): unknown {
  const config = readOptionalJson<CoordinatorConfig>(route, "config");
  const state = readOptionalJson<CoordinatorState>(route, "state");
  const eventCount = countRows("events", route);
  const messageCount = countRows("messages", route);
  const backupCount = countRows("backups", route);
  const taskStatuses: Record<string, number> = {};
  for (const task of state?.tasks ?? []) {
    taskStatuses[task.status] = (taskStatuses[task.status] ?? 0) + 1;
  }
  return {
    ok: true,
    team: route.team,
    project: route.project,
    projectName: config?.projectName,
    updatedAt:
      readDocument(route, "state")?.updatedAt ??
      readDocument(route, "config")?.updatedAt,
    counts: {
      tasks: state?.tasks.length ?? 0,
      agents: state?.agents.length ?? 0,
      handoffs: state?.handoffs.length ?? 0,
      events: eventCount,
      messages: messageCount,
      backups: backupCount,
    },
    taskStatuses,
    activeTasks: (state?.tasks ?? [])
      .filter((task) => task.status !== "done")
      .slice(0, 25),
    agents: state?.agents ?? [],
    recentEvents: readRecentJsonRows<Event>("events", route, 20),
    recentMessages: readRecentJsonRows<Message>("messages", route, 20),
  };
}

function readOptionalJson<T>(
  route: RouteContext,
  kind: "config" | "state",
): T | undefined {
  const row = readDocument(route, kind);
  return row ? (JSON.parse(row.value) as T) : undefined;
}

function countRows(
  table: "events" | "messages" | "backups",
  route: RouteContext,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM ${table} WHERE team = ? AND project = ?`,
    )
    .get(route.team, route.project) as { count: number };
  return row.count;
}

function readRecentJsonRows<T>(
  table: "events" | "messages",
  route: RouteContext,
  limit: number,
): T[] {
  return (
    db
      .prepare(
        `SELECT json FROM ${table} WHERE team = ? AND project = ? ORDER BY seq DESC LIMIT ?`,
      )
      .all(route.team, route.project, limit) as Array<{ json: string }>
  ).map((row) => JSON.parse(row.json) as T);
}

function readAuditLog(route: RouteContext, grant: TokenGrant): unknown[] {
  if (grant.role !== "admin") return [];
  return db
    .prepare(
      "SELECT at, request_id AS requestId, team, project, role, method, path, status, message FROM audit_log WHERE team = ? AND project = ? ORDER BY seq DESC LIMIT 100",
    )
    .all(route.team, route.project) as unknown[];
}

function audit(
  context: RequestContext,
  request: IncomingMessage,
  status: number,
  details: {
    team?: string;
    project?: string;
    role?: string;
    message?: string;
  } = {},
): void {
  db.prepare(
    "INSERT INTO audit_log(at, request_id, team, project, role, method, path, status, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    new Date().toISOString(),
    context.id,
    details.team ?? null,
    details.project ?? null,
    details.role ?? null,
    request.method ?? "UNKNOWN",
    request.url ?? "/",
    status,
    details.message ?? null,
  );
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (contentLength > maxBodyBytes) {
    throw new Error(`request body exceeds ${maxBodyBytes} bytes`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) {
      throw new Error(`request body exceeds ${maxBodyBytes} bytes`);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  context?: RequestContext,
): void {
  response.writeHead(status, {
    ...baseHeaders(request, context),
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendHtml(
  request: IncomingMessage,
  response: ServerResponse,
  body: string,
  context: RequestContext,
): void {
  response.writeHead(200, {
    ...baseHeaders(request, context),
    "content-type": "text/html; charset=utf-8",
  });
  response.end(body);
}

function sendEmpty(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  headers: Record<string, string> = {},
  context?: RequestContext,
): void {
  response.writeHead(status, {
    ...baseHeaders(request, context),
    ...headers,
  });
  response.end();
}

function baseHeaders(
  request: IncomingMessage,
  context?: RequestContext,
): Record<string, string> {
  return {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy":
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    "x-coordinaut-request-id": context?.id ?? randomUUID(),
    "server-timing": context
      ? `app;dur=${Math.max(0, Date.now() - context.startedAt)}`
      : "app;dur=0",
    ...corsHeaders(request),
  };
}

function corsHeaders(request: IncomingMessage): Record<string, string> {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers":
      "authorization, content-type, if-match, x-requested-with",
    "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
    "access-control-expose-headers": "etag, x-coordinaut-request-id",
    vary: "Origin",
  };
}

function parseAllowedOrigins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function isDashboardPath(urlValue?: string): boolean {
  if (!urlValue) return false;
  const url = new URL(urlValue, "http://localhost");
  return url.pathname === "/" || url.pathname === "/dashboard";
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Coordinaut Dashboard</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #0f172a; color: #e5e7eb; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 48px; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: 0; }
    p { color: #a7b0c0; }
    label { display: grid; gap: 6px; color: #cbd5e1; font-size: 13px; }
    input, button { border: 1px solid #334155; border-radius: 6px; background: #111827; color: #f8fafc; font: inherit; padding: 10px 12px; }
    button { cursor: pointer; background: #2563eb; border-color: #3b82f6; font-weight: 700; }
    button.secondary { background: #172033; border-color: #334155; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .panel { background: #111827; border: 1px solid #263244; border-radius: 8px; padding: 16px; }
    .toolbar { display: grid; grid-template-columns: 1fr 1fr 2fr auto; gap: 12px; align-items: end; margin-bottom: 16px; }
    .metric { font-size: 28px; font-weight: 800; color: #ffffff; }
    .muted { color: #94a3b8; font-size: 13px; }
    .status { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .pill { border: 1px solid #334155; border-radius: 999px; padding: 5px 9px; color: #cbd5e1; font-size: 12px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid #263244; padding: 10px 8px; text-align: left; vertical-align: top; }
    th { color: #93c5fd; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    code { color: #bfdbfe; }
    .stack { display: grid; gap: 16px; }
    .error { color: #fecaca; }
    @media (max-width: 860px) { .toolbar, .grid { grid-template-columns: 1fr; } header { display: block; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Coordinaut Dashboard</h1>
        <p>Read-only hosted sync view for teams, projects, tasks, agents, messages, and audit trails.</p>
      </div>
      <button class="secondary" id="refresh">Refresh</button>
    </header>
    <section class="panel toolbar">
      <label>Team <input id="team" value="platform" autocomplete="off"></label>
      <label>Project <input id="project" value="web-app" autocomplete="off"></label>
      <label>Bearer token <input id="token" type="password" autocomplete="off" placeholder="COORDINAUT_TOKEN"></label>
      <button id="load">Load</button>
    </section>
    <section id="output" class="stack"></section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const output = $("output");
    $("token").value = localStorage.getItem("coordinaut.token") || "";
    $("team").value = localStorage.getItem("coordinaut.team") || $("team").value;
    $("project").value = localStorage.getItem("coordinaut.project") || $("project").value;
    $("load").addEventListener("click", load);
    $("refresh").addEventListener("click", load);

    async function api(path) {
      const token = $("token").value.trim();
      const response = await fetch(path, { headers: { authorization: "Bearer " + token } });
      const text = await response.text();
      const body = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(body.error || response.statusText);
      return body;
    }

    async function load() {
      const team = $("team").value.trim();
      const project = $("project").value.trim();
      const token = $("token").value.trim();
      localStorage.setItem("coordinaut.team", team);
      localStorage.setItem("coordinaut.project", project);
      localStorage.setItem("coordinaut.token", token);
      output.innerHTML = '<div class="panel muted">Loading...</div>';
      try {
        const summary = await api('/v1/teams/' + encodeURIComponent(team) + '/projects/' + encodeURIComponent(project) + '/summary');
        render(summary);
      } catch (error) {
        output.innerHTML = '<div class="panel error">' + escapeHtml(error.message) + '</div>';
      }
    }

    function render(summary) {
      const statuses = Object.entries(summary.taskStatuses || {}).map(([name, count]) => '<span class="pill">' + escapeHtml(name) + ': ' + count + '</span>').join('');
      const tasks = (summary.activeTasks || []).map((task) => '<tr><td><code>' + escapeHtml(task.displayId) + '</code></td><td>' + escapeHtml(task.title) + '</td><td>' + escapeHtml(task.status) + '</td><td>' + escapeHtml(task.agent || '') + '</td><td>' + escapeHtml((task.filesGlobs || []).join(', ')) + '</td></tr>').join('');
      const agents = (summary.agents || []).map((agent) => '<tr><td>' + escapeHtml(agent.name) + '</td><td><code>' + escapeHtml(agent.id) + '</code></td><td>' + escapeHtml(agent.tool || '') + '</td><td>' + escapeHtml(agent.lastSeenAt || '') + '</td></tr>').join('');
      const events = (summary.recentEvents || []).map((event) => '<tr><td>' + escapeHtml(event.at) + '</td><td>' + escapeHtml(event.type) + '</td><td>' + escapeHtml(event.message) + '</td></tr>').join('');
      output.innerHTML =
        '<section class="grid">' +
          metric('Tasks', summary.counts.tasks) + metric('Agents', summary.counts.agents) + metric('Events', summary.counts.events) + metric('Messages', summary.counts.messages) +
        '</section>' +
        '<section class="panel"><h2>' + escapeHtml(summary.projectName || summary.project) + '</h2><div class="muted">' + escapeHtml(summary.team) + ' / ' + escapeHtml(summary.project) + '</div><div class="status">' + statuses + '</div></section>' +
        table('Active Tasks', '<tr><th>ID</th><th>Title</th><th>Status</th><th>Agent</th><th>Files</th></tr>' + tasks) +
        table('Agents', '<tr><th>Name</th><th>Instance</th><th>Tool</th><th>Last seen</th></tr>' + agents) +
        table('Recent Events', '<tr><th>At</th><th>Type</th><th>Message</th></tr>' + events);
    }

    function metric(label, value) { return '<div class="panel"><div class="muted">' + label + '</div><div class="metric">' + value + '</div></div>'; }
    function table(title, rows) { return '<section class="panel"><h2>' + title + '</h2><table>' + rows + '</table></section>'; }
    function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  </script>
</body>
</html>`;
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
