import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const server = path.join(packageRoot, "dist/index.js");
const cli = path.join(repoRoot, "packages/cli/dist/index.js");
const token = `smoke-${randomUUID()}`;
const readToken = `smoke-read-${randomUUID()}`;
const otherTeamToken = `smoke-other-${randomUUID()}`;
const port = 3977 + Math.floor(Math.random() * 1000);
const remoteUrl = `http://127.0.0.1:${port}`;
const allowedOrigin = "https://dashboard.example.test";

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });
  return result.stdout.trim();
}

async function runJson(args, cwd) {
  return JSON.parse(
    await run(process.execPath, [cli, ...args], {
      cwd,
      env: { COORDINAUT_TOKEN: token },
    }),
  );
}

async function tempGitRepo(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await run("git", ["init"], { cwd: root });
  await run("git", ["config", "user.name", "Server Smoke"], { cwd: root });
  await run("git", ["config", "user.email", "server-smoke@example.test"], {
    cwd: root,
  });
  return root;
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${remoteUrl}/health`);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy");
}

async function main() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "coordinaut-server-"));
  const child = execFile(process.execPath, [server], {
    cwd: repoRoot,
    env: {
      ...process.env,
      COORDINAUT_SERVER_TOKENS: JSON.stringify({
        [token]: { team: "smoke-team", role: "admin" },
        [readToken]: { team: "smoke-team", role: "read" },
        [otherTeamToken]: { team: "other-team", role: "admin" },
      }),
      COORDINAUT_SERVER_ALLOWED_ORIGINS: allowedOrigin,
      COORDINAUT_SERVER_PORT: String(port),
      COORDINAUT_SERVER_DATA_DIR: dataDir,
    },
  });
  const stderr = [];
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));

  try {
    await waitForHealth();
    const dashboard = await fetch(`${remoteUrl}/dashboard`);
    const dashboardHtml = await dashboard.text();
    if (!dashboard.ok || !dashboardHtml.includes("Coordinaut Dashboard")) {
      throw new Error("dashboard did not render");
    }
    if (dashboard.headers.get("x-frame-options") !== "DENY") {
      throw new Error("dashboard is missing frame protection");
    }

    const repoA = await tempGitRepo("coordinaut-remote-a-");
    const repoB = await tempGitRepo("coordinaut-remote-b-");

    await runJson(
      [
        "init",
        "--project-name",
        "remote-smoke",
        "--storage",
        "remote",
        "--remote-url",
        remoteUrl,
        "--team",
        "smoke-team",
        "--project",
        "smoke-project",
      ],
      repoA,
    );
    const staleState = await fetch(
      `${remoteUrl}/v1/teams/smoke-team/projects/smoke-project/state`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    const staleEtag = staleState.headers.get("etag");
    const staleBody = await staleState.json();

    const created = await runJson(
      [
        "create",
        "--display-id",
        "AGT-20260628-001",
        "--title",
        "Remote task",
        "--scope",
        "sync",
        "--files",
        "src/**",
      ],
      repoA,
    );
    const staleWrite = await fetch(
      `${remoteUrl}/v1/teams/smoke-team/projects/smoke-project/state`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(staleEtag ? { "if-match": staleEtag } : {}),
        },
        body: JSON.stringify(staleBody),
      },
    );
    if (staleWrite.status !== 409) {
      throw new Error(
        `expected stale state write to return 409, got ${staleWrite.status}`,
      );
    }

    await runJson(
      [
        "init",
        "--project-name",
        "remote-smoke",
        "--storage",
        "remote",
        "--remote-url",
        remoteUrl,
        "--team",
        "smoke-team",
        "--project",
        "smoke-project",
      ],
      repoB,
    );
    const status = await runJson(["status"], repoB);
    const doctor = await runJson(["doctor"], repoB);

    if (status.tasks.length !== 1) {
      throw new Error(
        `expected remote task in repoB, got ${status.tasks.length}`,
      );
    }
    if (status.tasks[0].displayId !== created.task.displayId) {
      throw new Error("remote task id mismatch");
    }
    if (!doctor.ok) {
      throw new Error(`remote doctor failed: ${JSON.stringify(doctor.checks)}`);
    }

    const projects = await fetch(`${remoteUrl}/v1/teams/smoke-team/projects`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const projectsBody = await projects.json();
    if (
      !projects.ok ||
      projectsBody.projects.length !== 1 ||
      projectsBody.projects[0].project !== "smoke-project"
    ) {
      throw new Error(
        `project listing failed: ${JSON.stringify(projectsBody)}`,
      );
    }

    const summary = await fetch(
      `${remoteUrl}/v1/teams/smoke-team/projects/smoke-project/summary`,
      {
        headers: {
          authorization: `Bearer ${readToken}`,
          origin: allowedOrigin,
        },
      },
    );
    const summaryBody = await summary.json();
    if (!summary.ok || summaryBody.counts.tasks !== 1) {
      throw new Error(`summary failed: ${JSON.stringify(summaryBody)}`);
    }
    if (summary.headers.get("access-control-allow-origin") !== allowedOrigin) {
      throw new Error("allowed CORS origin was not echoed");
    }

    const readOnlyWrite = await fetch(
      `${remoteUrl}/v1/teams/smoke-team/projects/smoke-project/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${readToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: randomUUID(),
          at: new Date().toISOString(),
        }),
      },
    );
    if (readOnlyWrite.status !== 403) {
      throw new Error(
        `expected read-only write to return 403, got ${readOnlyWrite.status}`,
      );
    }

    const crossTeam = await fetch(
      `${remoteUrl}/v1/teams/smoke-team/projects/smoke-project/summary`,
      {
        headers: { authorization: `Bearer ${otherTeamToken}` },
      },
    );
    if (crossTeam.status !== 401) {
      throw new Error(
        `expected cross-team access to return 401, got ${crossTeam.status}`,
      );
    }

    const audit = await fetch(
      `${remoteUrl}/v1/teams/smoke-team/projects/smoke-project/audit`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    const auditBody = await audit.json();
    if (
      !audit.ok ||
      !auditBody.audit.some((row) => row.message === "read-only token")
    ) {
      throw new Error(
        `audit log missing read-only denial: ${JSON.stringify(auditBody)}`,
      );
    }

    console.log(
      JSON.stringify({
        ok: true,
        remoteUrl,
        team: "smoke-team",
        project: "smoke-project",
        task: created.task.displayId,
        dashboard: true,
        summary: summaryBody.counts,
      }),
    );
  } finally {
    child.kill("SIGTERM");
    if (stderr.length) process.stderr.write(stderr.join(""));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
