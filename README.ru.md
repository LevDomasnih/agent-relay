# Agent Relay

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

Координация нескольких AI coding agents внутри одного git-репозитория.

Agent Relay дает Codex, Claude Code, Cursor и другим агентам общий
project-local протокол: задачи, scoped locks, lease, handoff, сообщения,
проверки, Markdown snapshot и git attribution.

Это слой между "все руками редактируют `AGENT_TASKS.md`" и "нам уже нужна
отдельная hosted orchestration platform".

```text
agent-relay claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-relay verify-worktree --agent-instance agent_123
agent-relay release --task AGT-20260628-001 --reason "iteration finished"
```

## Что решает

Markdown-доска удобна человеку, но хрупкая для параллельных агентов.

| Без coordinator                                | С Agent Relay                                    |
| ---------------------------------------------- | ------------------------------------------------ |
| Два агента могут молча взять один файл         | Active claims с пересечением возвращают conflict |
| Умерший агент оставляет вечный lock            | Lease протухает, takeover требует reason         |
| Shared files становятся зоной случайного merge | Handoff явно запрашивается и логируется          |
| Thread identity теряется после resume          | Agent instance остается стабильным owner         |
| В commit непонятно кто и зачем менял код       | Trailers связывают commit с task history         |
| Людям все равно нужна читаемая доска           | Markdown snapshot генерируется из state          |

State живет рядом с проектом:

```text
.agent-relay/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

Без daemon, без database server, без state в `/tmp`.

## Статус

Agent Relay готов к первому публичному release из исходников. CLI, core package, MCP server, state migrations, CI checks, package dry-runs, CLI smoke test и реальный MCP client smoke test реализованы и проверены.

npm publishing пока ожидает финального публичного package scope или rename.

Установка CLI через `npx`:

```bash
npx @agent-relay/cli init
npx @agent-relay/cli doctor
```

Запуск из исходников:

```bash
git clone https://github.com/LevDomasnih/agent-relay.git
cd agent-relay
pnpm install
pnpm run build
pnpm --filter @agent-relay/cli agent-relay --help
```

## Быстрый старт

Инициализировать repo:

```bash
agent-relay init
agent-relay doctor
```

Для нескольких git worktree можно вынести общий state:

```bash
agent-relay init --state-dir ../.agent-relay-shared
```

Создать задачу:

```bash
agent-relay create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

Взять задачу перед правками:

```bash
agent-relay claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

Во время работы:

```bash
agent-relay heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-relay update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

Перед handoff, commit или final response:

```bash
agent-relay verify-worktree --agent-instance agent_123
```

Закончить итерацию:

```bash
agent-relay update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-relay release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-relay snapshot
```

## Протокол агента

Агентам не нужно одновременно редактировать один Markdown-файл. Жизненный цикл
короткий:

1. Проверить состояние через `status`.
2. Взять task и file scope через `claim`.
3. Делать `heartbeat` во время работы.
4. Запросить handoff, если shared file уже занят другим active claim.
5. Проверить modified/staged files через `verify-worktree` или `verify-commit`.
6. Освободить lease, записать blocker или закрыть задачу.
7. Оставить commit trailers, чтобы следующий агент понял историю.

Generated Markdown snapshot нужен людям. Источник правды: JSON state и JSONL
logs.

## Handoff

Если другой агент владеет нужным scope:

```bash
agent-relay handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

Owner отвечает:

```bash
agent-relay handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent frontend-codex \
  --response "will release after current verification"
```

Статусы ответа: `grant_after_commit`, `handoff_now`, `denied`, `cancelled`.

## Inbox и Presence

Агенты могут общаться через inbox:

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

Broadcast, mentions, presence и watch тоже поддержаны:

```bash
agent-relay message --from-agent release-codex --broadcast --kind blocker --text "Release branch is frozen."
agent-relay presence
agent-relay watch --limit 20
```

## Проверки и Git Hooks

```bash
agent-relay verify-worktree --agent-instance agent_123
agent-relay verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Установить hooks:

```bash
agent-relay install-hooks
export AGENT_RELAY_INSTANCE=agent_123
```

Для PR/CI:

```bash
agent-relay verify-commit-range --range "origin/main..HEAD"
```

Правило продукта:

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

Commit trailers:

```text
Agent: frontend-codex
Agent-Instance: agent_123
Agent-Thread: 019eff77
Agent-Task: AGT-20260628-001
```

Вернуть прежний git identity:

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

Большинство tools принимают optional `root`. Лучше передавать root репозитория
явно, чтобы server не записал state не туда.

## Ключевые команды

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

Релизы автоматизированы от Conventional Commits в `main`: `feat` дает minor,
`fix`/`perf` дают patch, а `!` или `BREAKING CHANGE:` дают major. Workflow сам
bump-ит версии, коммитит релиз, ставит tag, публикует npm-пакеты и создает или
обновляет GitHub Release. Детали: [docs/release.md](docs/release.md).

## License

MIT
