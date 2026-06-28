import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { AgentCoordinator } from "../src/index.ts";

const execFileAsync = promisify(execFile);

test("init creates coordinator files and a generated snapshot", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);

  await coordinator.init("sample");

  const state = JSON.parse(
    await readFile(path.join(root, ".agent-coordinator/state.json"), "utf8"),
  ) as { tasks: unknown[]; agents: unknown[] };
  const snapshot = await readFile(
    path.join(root, ".agent-coordinator/snapshots/TASKS.md"),
    "utf8",
  );

  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.agents, []);
  assert.match(snapshot, /Generated\. Do not edit\./u);
});

test("create and claim use display ids while storing stable machine ids", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");

  const task = await coordinator.createTask({
    id: "AGT-20260628-001",
    title: "Fix page",
    scope: "frontend",
    filesGlobs: ["src/page.ts"],
  });
  const claimed = await coordinator.claimTask({
    taskId: "AGT-20260628-001",
    agent: "visual-codex",
    agentInstanceId: "agent_1",
    threadId: "thread_1",
  });

  assert.equal(task.displayId, "AGT-20260628-001");
  assert.notEqual(task.id, task.displayId);
  assert.equal(claimed.agentInstanceId, "agent_1");
  assert.equal(claimed.lockScopes[0]?.mode, "exclusive");
});

test("claim rejects active exclusive scope conflicts", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");
  await coordinator.createTask({
    displayId: "AGT-20260628-001",
    title: "Task A",
    scope: "a",
    filesGlobs: ["src/**"],
  });
  await coordinator.createTask({
    displayId: "AGT-20260628-002",
    title: "Task B",
    scope: "b",
    filesGlobs: ["src/page.ts"],
  });

  await coordinator.claimTask({
    taskId: "AGT-20260628-001",
    agent: "agent-a",
    agentInstanceId: "agent_a",
  });

  await assert.rejects(
    coordinator.claimTask({
      taskId: "AGT-20260628-002",
      agent: "agent-b",
      agentInstanceId: "agent_b",
    }),
    /Scope conflict/u,
  );
});

test("shared docs scopes can overlap without conflict", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");
  await coordinator.createTask({
    displayId: "AGT-20260628-001",
    title: "Docs A",
    scope: "docs",
    filesGlobs: ["docs/**"],
    lockMode: "shared-docs",
  });
  await coordinator.createTask({
    displayId: "AGT-20260628-002",
    title: "Docs B",
    scope: "docs",
    filesGlobs: ["docs/guide.md"],
    lockMode: "shared-docs",
  });

  await coordinator.claimTask({
    taskId: "AGT-20260628-001",
    agent: "agent-a",
    agentInstanceId: "agent_a",
  });
  const claimed = await coordinator.claimTask({
    taskId: "AGT-20260628-002",
    agent: "agent-b",
    agentInstanceId: "agent_b",
  });

  assert.equal(claimed.status, "claimed");
});

test("heartbeat extends lease, release clears it, blocked stores blocker", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");
  await coordinator.createTask({
    displayId: "AGT-20260628-001",
    title: "Fix",
    scope: "code",
    filesGlobs: ["src/**"],
  });
  const claimed = await coordinator.claimTask({
    taskId: "AGT-20260628-001",
    agent: "agent-a",
    agentInstanceId: "agent_a",
    leaseMinutes: 1,
  });
  const heartbeat = await coordinator.heartbeat(
    "AGT-20260628-001",
    "agent-a",
    undefined,
    30,
    "agent_a",
  );
  const blocked = await coordinator.updateTask({
    taskId: "AGT-20260628-001",
    status: "blocked",
    blocker: "need account",
  });
  const released = await coordinator.releaseTask(
    "AGT-20260628-001",
    "agent-a",
    "iteration finished",
    "agent_a",
  );

  assert.ok(claimed.leaseExpiresAt);
  assert.notEqual(heartbeat.leaseExpiresAt, claimed.leaseExpiresAt);
  assert.equal(blocked.blocker, "need account");
  assert.equal(released.status, "blocked");
  assert.equal(released.leaseExpiresAt, undefined);
});

test("git identity can be set and restored in a test repo", async () => {
  const root = await tempGitRepo();
  await execFileAsync("git", ["config", "user.name", "Human"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "human@example.test"], {
    cwd: root,
  });
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");

  const identity = await coordinator.configureGitIdentity(
    "agent-a",
    "thread_1",
    "AGT-20260628-001",
    "agent_a",
  );
  const setName = await gitConfig(root, "user.name");
  const setEmail = await gitConfig(root, "user.email");
  const reset = await coordinator.resetGitIdentity();

  assert.equal(identity.email, "codex+thread_1@agent-coordinator.local");
  assert.equal(setName, "agent-a");
  assert.equal(setEmail, "codex+thread_1@agent-coordinator.local");
  assert.equal(reset.restored, true);
  assert.equal(await gitConfig(root, "user.name"), "Human");
  assert.equal(await gitConfig(root, "user.email"), "human@example.test");
});

test("verify-worktree reports unclaimed files and accepts claimed scopes", async () => {
  const root = await tempGitRepo();
  await writeFile(path.join(root, "owned.ts"), "owned\n");
  await writeFile(path.join(root, "other.ts"), "other\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: root });
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");
  await coordinator.createTask({
    displayId: "AGT-20260628-001",
    title: "Owned",
    scope: "code",
    filesGlobs: ["owned.ts"],
  });
  await coordinator.claimTask({
    taskId: "AGT-20260628-001",
    agent: "agent-a",
    agentInstanceId: "agent_a",
  });

  await writeFile(path.join(root, "owned.ts"), "owned changed\n");
  await writeFile(path.join(root, "other.ts"), "other changed\n");
  const report = await coordinator.verifyWorktree({
    agentInstanceId: "agent_a",
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.unclaimedFiles, ["other.ts"]);
});

async function tempGitRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-coordinator-"));
  await execFileAsync("git", ["init"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: root,
  });
  await execFileAsync("git", ["config", "user.email", "test@example.test"], {
    cwd: root,
  });
  return root;
}

async function gitConfig(root: string, key: string): Promise<string> {
  return (
    await execFileAsync("git", ["config", "--get", key], { cwd: root })
  ).stdout.trim();
}
