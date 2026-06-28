import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const server = path.join(packageRoot, "dist/index.js");

async function run(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });
  return result.stdout.trim();
}

async function callTool(client, name, args) {
  const result = await client.callTool({
    name,
    arguments: args,
  });
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error(`tool ${name} did not return JSON content`);
  return JSON.parse(text);
}

async function main() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "coordinaut-mcp-"));
  await run("git", ["init"], { cwd: repo });
  await run("git", ["config", "user.name", "MCP Smoke"], { cwd: repo });
  await run("git", ["config", "user.email", "mcp-smoke@example.test"], {
    cwd: repo,
  });
  await mkdir(path.join(repo, "src"), { recursive: true });
  await writeFile(path.join(repo, "src/file.ts"), "initial\n");
  await run("git", ["add", "."], { cwd: repo });
  await run("git", ["commit", "-m", "chore: initial"], { cwd: repo });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: repoRoot,
    stderr: "pipe",
  });
  const stderr = [];
  transport.stderr?.on("data", (chunk) => stderr.push(String(chunk)));

  const client = new Client({ name: "coordinaut-smoke", version: "0.0.0" });
  await client.connect(transport);

  try {
    const tools = await client.listTools();
    const toolNames = new Set(tools.tools.map((tool) => tool.name));
    for (const expected of [
      "init_project",
      "create_task",
      "claim_task",
      "post_message",
      "inbox",
      "export_snapshot",
      "doctor",
      "verify_worktree",
    ]) {
      if (!toolNames.has(expected)) {
        throw new Error(`MCP tool missing: ${expected}`);
      }
    }

    await callTool(client, "init_project", {
      root: repo,
      projectName: "mcp-smoke",
    });
    const taskResult = await callTool(client, "create_task", {
      root: repo,
      title: "MCP smoke task",
      scope: "src",
      filesGlobs: ["src/**"],
      checks: ["pnpm test"],
    });
    const taskId = taskResult.task.displayId;

    await callTool(client, "claim_task", {
      root: repo,
      taskId,
      agent: "mcp-codex",
      agentInstanceId: "agent_mcp_smoke",
      filesGlobs: ["src/**"],
    });
    await writeFile(path.join(repo, "src/file.ts"), "changed\n");

    const worktree = await callTool(client, "verify_worktree", {
      root: repo,
      agentInstanceId: "agent_mcp_smoke",
    });
    if (!worktree.ok) {
      throw new Error(`verify_worktree failed: ${JSON.stringify(worktree)}`);
    }

    const message = await callTool(client, "post_message", {
      root: repo,
      fromAgent: "mcp-codex",
      fromAgentInstanceId: "agent_mcp_smoke",
      broadcast: true,
      text: "mcp smoke ready",
    });
    if (!message.message.id) throw new Error("message id missing");

    const inbox = await callTool(client, "inbox", {
      root: repo,
      agentInstanceId: "agent_other",
    });
    if (inbox.inbox.length !== 1) {
      throw new Error(`expected one inbox item, got ${inbox.inbox.length}`);
    }

    const snapshotResult = await callTool(client, "export_snapshot", {
      root: repo,
    });
    const snapshot = await readFile(snapshotResult.snapshotPath, "utf8");
    if (!snapshot.includes(taskId)) {
      throw new Error("snapshot does not include MCP smoke task");
    }

    const doctor = await callTool(client, "doctor", { root: repo });
    if (!doctor.ok) {
      throw new Error(`doctor failed: ${JSON.stringify(doctor.checks)}`);
    }

    console.log(
      JSON.stringify({
        ok: true,
        repo,
        task: taskId,
        tools: toolNames.size,
        checks: doctor.checks.length,
      }),
    );
  } finally {
    await client.close();
    if (stderr.length) {
      process.stderr.write(stderr.join(""));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
