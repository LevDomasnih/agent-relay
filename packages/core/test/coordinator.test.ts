import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

test("shared stateDir lets separate checkouts use the same coordinator state", async () => {
  const rootA = await tempGitRepo();
  const rootB = await tempGitRepo();
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "agent-state-"));
  const coordinatorA = new AgentCoordinator(rootA, undefined, { stateDir });
  const coordinatorB = new AgentCoordinator(rootB, undefined, { stateDir });

  await coordinatorA.init("shared", { stateDir });
  await coordinatorB.init("shared", { stateDir });
  await coordinatorA.createTask({
    displayId: "AGT-20260628-001",
    title: "Shared state",
    scope: "shared",
    filesGlobs: ["src/**"],
  });

  const reloadedB = new AgentCoordinator(rootB);
  const tasks = await reloadedB.listTasks();
  const doctor = await reloadedB.doctor();

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.displayId, "AGT-20260628-001");
  assert.equal(doctor.statePath, path.join(stateDir, "state.json"));
  assert.ok(
    doctor.checks.some((check) => check.name === "state dir" && check.ok),
  );
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

test("glob matcher detects nested and extension scopes", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");
  await coordinator.createTask({
    displayId: "AGT-20260628-001",
    title: "Vue files",
    scope: "frontend",
    filesGlobs: ["src/**/*.vue"],
  });
  await coordinator.createTask({
    displayId: "AGT-20260628-002",
    title: "Settings page",
    scope: "frontend",
    filesGlobs: ["src/pages/settings/Profile.vue"],
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

test("handoff request and response are stored with messages and events", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");
  await coordinator.createTask({
    displayId: "AGT-20260628-001",
    title: "Owner",
    scope: "owner",
    filesGlobs: ["src/**"],
  });
  await coordinator.createTask({
    displayId: "AGT-20260628-002",
    title: "Requester",
    scope: "requester",
    filesGlobs: ["src/page.ts"],
  });
  await coordinator.claimTask({
    taskId: "AGT-20260628-001",
    agent: "owner",
    agentInstanceId: "owner_1",
    threadId: "thread_owner",
  });

  const handoff = await coordinator.requestHandoff({
    taskId: "AGT-20260628-002",
    agent: "requester",
    agentInstanceId: "requester_1",
    threadId: "thread_requester",
    filesGlobs: ["src/page.ts"],
    reason: "need to patch page",
  });
  const response = await coordinator.respondHandoff({
    handoffId: handoff.id,
    status: "grant_after_commit",
    agent: "owner",
    response: "after current verification",
  });
  const listed = await coordinator.listHandoffs();
  const explanation = await coordinator.explain({ taskId: "AGT-20260628-002" });

  assert.equal(handoff.ownerAgent, "owner");
  assert.equal(response.status, "grant_after_commit");
  assert.equal(listed.length, 1);
  assert.equal(explanation.handoffs[0]?.id, handoff.id);
  assert.ok(
    explanation.events.some((event) => event.type === "handoff.requested"),
  );
  assert.ok(
    explanation.messages.some((message) =>
      message.text.includes("Handoff requested"),
    ),
  );
});

test("agent inbox supports directed messages and read receipts", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");

  const message = await coordinator.postMessage({
    kind: "question",
    fromAgent: "agent-a",
    fromAgentInstanceId: "agent_a",
    toAgent: "agent-b",
    toAgentInstanceId: "agent_b",
    mentions: ["agent-b"],
    text: "Can you take package.json after this commit?",
  });
  await coordinator.postMessage({
    fromAgent: "agent-c",
    fromAgentInstanceId: "agent_c",
    broadcast: true,
    text: "Heads up: release branch is frozen.",
  });

  const unread = await coordinator.inbox({ agentInstanceId: "agent_b" });
  const receipts = await coordinator.markInboxRead({
    agentInstanceId: "agent_b",
    messageIds: [message.id],
  });
  const afterRead = await coordinator.inbox({ agentInstanceId: "agent_b" });
  const all = await coordinator.inbox({
    agentInstanceId: "agent_b",
    includeRead: true,
  });

  assert.equal(unread.length, 2);
  assert.equal(unread[0]?.message.broadcast, true);
  assert.equal(unread[1]?.message.id, message.id);
  assert.equal(receipts.length, 1);
  assert.equal(afterRead.length, 1);
  assert.equal(all.length, 2);
  assert.equal(all.find((item) => item.message.id === message.id)?.read, true);
});

test("presence and watch expose active agents and recent streams", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");
  await coordinator.createTask({
    displayId: "AGT-20260628-001",
    title: "Presence task",
    scope: "code",
    filesGlobs: ["src/**"],
  });
  await coordinator.claimTask({
    taskId: "AGT-20260628-001",
    agent: "agent-a",
    agentInstanceId: "agent_a",
    threadId: "thread_a",
  });
  await coordinator.postMessage({
    fromAgent: "agent-a",
    fromAgentInstanceId: "agent_a",
    broadcast: true,
    text: "I am active.",
  });

  const presence = await coordinator.presence(15);
  const watched = await coordinator.watch({ limit: 10 });

  assert.equal(presence[0]?.id, "agent_a");
  assert.equal(presence[0]?.active, true);
  assert.deepEqual(presence[0]?.activeTaskDisplayIds, ["AGT-20260628-001"]);
  assert.ok(watched.events.some((event) => event.type === "task.claimed"));
  assert.ok(watched.messages.some((item) => item.text === "I am active."));
});

test("explain can resolve task from commit trailers", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");
  await coordinator.createTask({
    displayId: "AGT-20260628-001",
    title: "Commit task",
    scope: "code",
    filesGlobs: ["src/**"],
  });
  await writeFile(path.join(root, "file.ts"), "hello\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync(
    "git",
    [
      "commit",
      "-m",
      "feat: test trailers",
      "-m",
      "Agent: test-agent\nAgent-Task: AGT-20260628-001",
    ],
    { cwd: root },
  );
  const sha = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })
  ).stdout.trim();

  const explanation = await coordinator.explain({ commit: sha });

  assert.equal(explanation.task?.displayId, "AGT-20260628-001");
  assert.equal(explanation.commit?.trailers["Agent"], "test-agent");
});

test("verify-commit-range checks trailers and task scopes", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");
  await coordinator.createTask({
    displayId: "AGT-20260628-001",
    title: "Scoped task",
    scope: "src",
    filesGlobs: ["src/**"],
  });
  await writeFile(path.join(root, "README.md"), "initial\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "chore: initial"], { cwd: root });
  const base = (
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })
  ).stdout.trim();
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src/file.ts"), "ok\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync(
    "git",
    [
      "commit",
      "-m",
      "feat: scoped",
      "-m",
      "Agent: agent-a\nAgent-Task: AGT-20260628-001",
    ],
    { cwd: root },
  );
  await writeFile(path.join(root, "outside.ts"), "bad\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync(
    "git",
    [
      "commit",
      "-m",
      "feat: outside",
      "-m",
      "Agent: agent-a\nAgent-Task: AGT-20260628-001",
    ],
    { cwd: root },
  );

  const report = await coordinator.verifyCommitRange({
    range: `${base}..HEAD`,
    requireKnownTasks: true,
  });

  assert.equal(report.ok, false);
  assert.equal(report.commits.length, 2);
  assert.deepEqual(report.commits[0]?.filesOutsideTaskScope, []);
  assert.deepEqual(report.commits[1]?.filesOutsideTaskScope, ["outside.ts"]);
});

test("install-hooks writes executable local git hooks", async () => {
  const root = await tempGitRepo();
  const coordinator = new AgentCoordinator(root);
  await coordinator.init("sample");

  const hooks = await coordinator.installHooks("AGENT_ID");

  await access(hooks.preCommit);
  await access(hooks.commitMsg);
  assert.match(await readFile(hooks.preCommit, "utf8"), /AGENT_ID/u);
  assert.match(
    await readFile(hooks.commitMsg, "utf8"),
    /--message-file "\$1"/u,
  );
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
