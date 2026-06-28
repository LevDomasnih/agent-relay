# Agent Relay

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

在同一个 git 仓库中协调多个 AI coding agents。

Agent Relay 为 Codex、Claude Code、Cursor 和其他 coding agents 提供一个
project-local 协议：任务归属、scoped locks、leases、handoffs、消息、校验、
Markdown snapshots 和 git attribution。

它位于“所有 agent 手动编辑 `AGENT_TASKS.md`”和“需要完整托管编排平台”之间。

```text
agent-relay claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-relay verify-worktree --agent-instance agent_123
agent-relay release --task AGT-20260628-001 --reason "iteration finished"
```

## 解决什么问题

Markdown task board 对人友好，但对并行 agent 很脆弱。

| 没有 coordinator                | 使用 Agent Relay                        |
| ------------------------------- | --------------------------------------- |
| 两个 agent 可能同时修改同一文件 | 重叠的 active claims 会返回 conflict    |
| 已退出的 agent 留下 stale lock  | Lease 会过期，takeover 必须给出 reason  |
| Shared files 变成隐式 merge 区  | Handoff 请求会被明确记录                |
| Resume 后 thread identity 丢失  | Agent instance 是稳定 owner             |
| Commit 看不出谁为什么修改       | Commit trailers 连接代码和 task history |
| 人仍然需要可读看板              | Markdown snapshot 从 state 生成         |

State 保存在项目内：

```text
.agent-relay/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

不需要 daemon，不需要数据库服务，也不会把 state 放到 `/tmp`。

## 状态

Agent Relay v0.1.3 已发布到 npm。CLI、core package、MCP server、state migrations、CI checks、release dry-runs 和 npm smoke test 都已实现并验证。

通过 `npx` 运行 CLI：

```bash
npx @levdomasnih/agent-relay-cli init
npx @levdomasnih/agent-relay-cli doctor
```

从源码使用：

```bash
git clone https://github.com/LevDomasnih/agent-relay.git
cd agent-relay
pnpm install
pnpm run build
pnpm --filter @levdomasnih/agent-relay-cli agent-relay --help
```

## 快速开始

初始化仓库：

```bash
agent-relay init
agent-relay doctor
```

多个 git worktree 可以使用同一个 shared state：

```bash
agent-relay init --state-dir ../.agent-relay-shared
```

创建任务：

```bash
agent-relay create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

修改代码前先 claim：

```bash
agent-relay claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

工作中保持 lease：

```bash
agent-relay heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-relay update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

handoff、commit 或 final response 前检查：

```bash
agent-relay verify-worktree --agent-instance agent_123
```

结束一次迭代：

```bash
agent-relay update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-relay release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-relay snapshot
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
agent-relay handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

Owner 回复：

```bash
agent-relay handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent frontend-codex \
  --response "will release after current verification"
```

支持的状态：`grant_after_commit`、`handoff_now`、`denied`、`cancelled`。

## Inbox 和 Presence

Agents 可以通过 inbox 通信：

```bash
agent-relay message \
  --from-agent frontend-codex \
  --from-agent-instance agent_123 \
  --to-agent-instance agent_456 \
  --kind question \
  --text "Can you take package.json after this commit?"

agent-relay inbox --agent-instance agent_456
agent-relay inbox-read --agent-instance agent_456 --messages msg_...
```

也支持 broadcast、mentions、presence 和 watch：

```bash
agent-relay message --from-agent release-codex --broadcast --kind blocker --text "Release branch is frozen."
agent-relay presence
agent-relay watch --limit 20
```

## 校验和 Git Hooks

```bash
agent-relay verify-worktree --agent-instance agent_123
agent-relay verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

安装 hooks：

```bash
agent-relay install-hooks
export AGENT_RELAY_INSTANCE=agent_123
```

用于 PR/CI：

```bash
agent-relay verify-commit-range --range "origin/main..HEAD"
```

设计原则：

```text
MCP is the protocol. Hooks and checks are the enforcement.
```

## Git Attribution

```bash
agent-relay git-identity \
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
agent-relay git-identity-reset
```

## MCP Server

```bash
agent-relay-mcp
```

```json
{
  "mcpServers": {
    "agent-relay": {
      "command": "agent-relay-mcp",
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
snapshot, explain, doctor, migrate
git-identity, git-identity-reset
install-hooks, verify-worktree, verify-commit, verify-commit-range
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
