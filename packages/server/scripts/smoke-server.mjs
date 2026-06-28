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
const port = 3977 + Math.floor(Math.random() * 1000);
const remoteUrl = `http://127.0.0.1:${port}`;

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
      COORDINAUT_SERVER_TOKEN: token,
      COORDINAUT_SERVER_PORT: String(port),
      COORDINAUT_SERVER_DATA_DIR: dataDir,
    },
  });
  const stderr = [];
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));

  try {
    await waitForHealth();
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

    console.log(
      JSON.stringify({
        ok: true,
        remoteUrl,
        team: "smoke-team",
        project: "smoke-project",
        task: created.task.displayId,
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
