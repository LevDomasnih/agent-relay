import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "packages/cli/dist/index.js");

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });
  return result.stdout.trim();
}

async function runJson(args, cwd) {
  return JSON.parse(await run(process.execPath, [cli, ...args], { cwd }));
}

async function main() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "coordinaut-smoke-"));
  await run("git", ["init"], { cwd: repo });
  await run("git", ["config", "user.name", "Smoke User"], { cwd: repo });
  await run("git", ["config", "user.email", "smoke@example.test"], {
    cwd: repo,
  });
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src/file.ts"), "initial\n");
  await run("git", ["add", "."], { cwd: repo });
  await run("git", ["commit", "-m", "chore: initial"], { cwd: repo });

  await runJson(["init", "--project-name", "smoke"], repo);
  const taskResult = await runJson(
    [
      "create",
      "--title",
      "Smoke task",
      "--scope",
      "src",
      "--files",
      "src/**",
      "--checks",
      "pnpm test",
    ],
    repo,
  );
  const taskId = taskResult.task.displayId;
  await runJson(
    [
      "claim",
      "--task",
      taskId,
      "--agent",
      "smoke-codex",
      "--agent-instance",
      "agent_smoke",
      "--files",
      "src/**",
    ],
    repo,
  );
  await writeFile(path.join(repo, "src/file.ts"), "changed\n");

  const worktree = await runJson(
    ["verify-worktree", "--agent-instance", "agent_smoke"],
    repo,
  );
  if (!worktree.ok) {
    throw new Error(`verify-worktree failed: ${JSON.stringify(worktree)}`);
  }

  const message = await runJson(
    [
      "message",
      "--from-agent",
      "smoke-codex",
      "--from-agent-instance",
      "agent_smoke",
      "--broadcast",
      "--text",
      "smoke ready",
    ],
    repo,
  );
  if (!message.message.id) throw new Error("message id missing");

  const inbox = await runJson(
    ["inbox", "--agent-instance", "agent_other"],
    repo,
  );
  if (inbox.inbox.length !== 1) {
    throw new Error(
      `expected one broadcast message, got ${inbox.inbox.length}`,
    );
  }

  await runJson(["snapshot"], repo);
  const snapshot = await readFile(
    path.join(repo, ".coordinaut/snapshots/TASKS.md"),
    "utf8",
  );
  if (!snapshot.includes(taskId)) {
    throw new Error("snapshot does not include smoke task");
  }

  const doctor = await runJson(["doctor"], repo);
  if (!doctor.ok) {
    throw new Error(`doctor failed: ${JSON.stringify(doctor.checks)}`);
  }

  const completion = await run(process.execPath, [cli, "completion", "bash"], {
    cwd: repo,
  });
  if (
    !completion.includes("_coordinaut_completion") ||
    !completion.includes("verify-worktree")
  ) {
    throw new Error("bash completion output is missing expected commands");
  }

  console.log(
    JSON.stringify({
      ok: true,
      repo,
      task: taskId,
      checks: doctor.checks.length,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
