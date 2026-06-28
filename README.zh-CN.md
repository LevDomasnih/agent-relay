# Agent Coordinator

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

在同一个 git 仓库中协调多个 AI coding agents。

Agent Coordinator 为 Codex、Claude Code、Cursor 和其他 coding agents 提供一个
project-local 协议：任务归属、scoped locks、leases、handoffs、消息、校验、
Markdown snapshots 和 git attribution。

它位于“所有 agent 手动编辑 `AGENT_TASKS.md`”和“需要完整托管编排平台”之间。

```text
agent-coordinator claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator release --task AGT-20260628-001 --reason "iteration finished"
```

## 解决什么问题

Markdown task board 对人友好，但对并行 agent 很脆弱。

| 没有 coordinator                | 使用 Agent Coordinator                  |
| ------------------------------- | --------------------------------------- |
| 两个 agent 可能同时修改同一文件 | 重叠的 active claims 会返回 conflict    |
| 已退出的 agent 留下 stale lock  | Lease 会过期，takeover 必须给出 reason  |
| Shared files 变成隐式 merge 区  | Handoff 请求会被明确记录                |
| Resume 后 thread identity 丢失  | Agent instance 是稳定 owner             |
| Commit 看不出谁为什么修改       | Commit trailers 连接代码和 task history |
| 人仍然需要可读看板              | Markdown snapshot 从 state 生成         |

State 保存在项目内：

```text
.agent-coordinator/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

不需要 daemon，不需要数据库服务，也不会把 state 放到 `/tmp`。

## 状态

这是 early MVP。CLI、core package 和 MCP server 已实现、已测试，并已准备好发布。
npm packages 尚未发布。

从源码使用：

```bash
git clone https://github.com/LevDomasnih/agent-coordinator.git
cd agent-coordinator
pnpm install
pnpm run build
pnpm --filter @agent-coordinator/cli agent-coordinator --help
```

首次 npm release 后的预期用法：

```bash
npx @agent-coordinator/cli init
npx @agent-coordinator/cli doctor
```

## 快速开始

初始化仓库：

```bash
agent-coordinator init
agent-coordinator doctor
```

创建任务：

```bash
agent-coordinator create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

修改代码前先 claim：

```bash
agent-coordinator claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

工作中保持 lease：

```bash
agent-coordinator heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-coordinator update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

handoff、commit 或 final response 前检查：

```bash
agent-coordinator verify-worktree --agent-instance agent_123
```

结束一次迭代：

```bash
agent-coordinator update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-coordinator release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-coordinator snapshot
```

## Agent 协议

Agent 不需要同时编辑同一个 Markdown 文件。生命周期很小：

1. 用 `status` 查看当前工作。
2. 用 `claim` 获取 task 和 file scope。
3. 工作时发送 `heartbeat`。
4. 如果 shared file 被其他 active claim 占用，请求 handoff。
5. 用 `verify-worktree` 或 `verify-commit` 校验修改范围。
6. Release lease、记录 blocker，或完成 task。
7. 在 commit 中留下 trailers，方便后续 agent 解释历史。

Markdown snapshot 给人看。真正的 source of truth 是 JSON state 和 JSONL logs。

## Handoff

需要另一个 agent 拥有的 scope 时：

```bash
agent-coordinator handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

Owner 回复：

```bash
agent-coordinator handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent frontend-codex \
  --response "will release after current verification"
```

支持的状态：`grant_after_commit`、`handoff_now`、`denied`、`cancelled`。

## Inbox 和 Presence

Agents 可以通过 inbox 通信：

```bash
agent-coordinator message \
  --from-agent frontend-codex \
  --from-agent-instance agent_123 \
  --to-agent-instance agent_456 \
  --kind question \
  --text "Can you take package.json after this commit?"

agent-coordinator inbox --agent-instance agent_456
agent-coordinator inbox-read --agent-instance agent_456 --messages msg_...
```

也支持 broadcast、mentions、presence 和 watch：

```bash
agent-coordinator message --from-agent release-codex --broadcast --kind blocker --text "Release branch is frozen."
agent-coordinator presence
agent-coordinator watch --limit 20
```

## 校验和 Git Hooks

```bash
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

安装 hooks：

```bash
agent-coordinator install-hooks
export AGENT_COORDINATOR_INSTANCE=agent_123
```

设计原则：

```text
MCP is the protocol. Hooks and checks are the enforcement.
```

## Git Attribution

```bash
agent-coordinator git-identity \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --task AGT-20260628-001
```

Commit trailers：

```text
Agent: frontend-codex
Agent-Instance: agent_123
Agent-Thread: 019eff77
Agent-Task: AGT-20260628-001
```

恢复之前的 git identity：

```bash
agent-coordinator git-identity-reset
```

## MCP Server

```bash
agent-coordinator-mcp
```

```json
{
  "mcpServers": {
    "agent-coordinator": {
      "command": "agent-coordinator-mcp",
      "args": []
    }
  }
}
```

大多数 tools 接受 optional `root`。建议显式传入 repository root，避免 server
把 state 写入错误目录。

## 常用命令

```text
init, status, create, claim, update, heartbeat, release
mine, conflicts, message, inbox, inbox-read, presence, watch
handoff request, handoff respond, handoff list
snapshot, explain, doctor
git-identity, git-identity-reset
install-hooks, verify-worktree, verify-commit
```

## Development

```bash
pnpm install
pnpm run format
pnpm run check
pnpm run test
pnpm run build
```

## License

MIT
