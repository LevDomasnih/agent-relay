# Agent Coordinator

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

Coordene vários AI coding agents dentro de um único repositório git.

Agent Coordinator dá a Codex, Claude Code, Cursor e outros coding agents um
protocolo project-local para tarefas, scoped locks, leases, handoffs, mensagens,
verificações, snapshots Markdown e git attribution.

Ele fica entre "todo mundo edita `AGENT_TASKS.md` manualmente" e "precisamos de
uma plataforma hospedada de orquestração".

```text
agent-coordinator claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator release --task AGT-20260628-001 --reason "iteration finished"
```

## O que resolve

Um quadro Markdown é ótimo para pessoas, mas frágil para agents em paralelo.

| Sem coordinator                                     | Com Agent Coordinator                            |
| --------------------------------------------------- | ------------------------------------------------ |
| Dois agents podem pegar o mesmo arquivo em silêncio | Active claims sobrepostos retornam conflict      |
| Um agent morto deixa ownership obsoleto             | Leases expiram e takeover exige reason           |
| Shared files viram zonas de merge acidental         | Handoff requests são explícitos e logados        |
| Thread identity some depois de resume               | Agent instances continuam owners estáveis        |
| Commits perdem o "quem e por quê"                   | Commit trailers conectam código à task history   |
| Pessoas ainda precisam de um board legível          | Markdown snapshots são gerados a partir do state |

O state vive dentro do projeto:

```text
.agent-coordinator/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

Sem daemon. Sem database server. Sem state em `/tmp`.

## Status

Este é um early MVP. CLI, core package e MCP server estão implementados,
testados e prontos para publicação. Os packages npm ainda não foram publicados.

Usar a partir do source:

```bash
git clone https://github.com/LevDomasnih/agent-coordinator.git
cd agent-coordinator
pnpm install
pnpm run build
pnpm --filter @agent-coordinator/cli agent-coordinator --help
```

Uso planejado depois do primeiro npm release:

```bash
npx @agent-coordinator/cli init
npx @agent-coordinator/cli doctor
```

## Quick Start

Inicialize o repositório:

```bash
agent-coordinator init
agent-coordinator doctor
```

Para vários git worktrees, use um state compartilhado:

```bash
agent-coordinator init --state-dir ../.agent-coordinator-shared
```

Crie uma tarefa:

```bash
agent-coordinator create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

Faça claim antes de editar:

```bash
agent-coordinator claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

Durante o trabalho:

```bash
agent-coordinator heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-coordinator update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

Antes de handoff, commit ou final response:

```bash
agent-coordinator verify-worktree --agent-instance agent_123
```

Finalize a iteração:

```bash
agent-coordinator update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-coordinator release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-coordinator snapshot
```

## Protocolo do agent

Agents não precisam se coordenar editando o mesmo Markdown. O ciclo é pequeno:

1. Verificar estado com `status`.
2. Pegar task e file scope com `claim`.
3. Enviar `heartbeat` enquanto trabalha.
4. Pedir handoff se um shared file pertence a outro active claim.
5. Verificar mudanças com `verify-worktree` ou `verify-commit`.
6. Liberar lease, registrar blocker ou concluir a task.
7. Deixar commit trailers para o próximo agent entender o contexto.

O Markdown snapshot é para humanos. A fonte da verdade é JSON state e JSONL
logs.

## Handoff

Se você precisa de um scope que pertence a outro agent:

```bash
agent-coordinator handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

O owner responde:

```bash
agent-coordinator handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent frontend-codex \
  --response "will release after current verification"
```

Status: `grant_after_commit`, `handoff_now`, `denied`, `cancelled`.

## Inbox e Presence

Agents podem se comunicar por inbox:

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

Broadcast, mentions, presence e watch também são suportados:

```bash
agent-coordinator message --from-agent release-codex --broadcast --kind blocker --text "Release branch is frozen."
agent-coordinator presence
agent-coordinator watch --limit 20
```

## Verificações e Git Hooks

```bash
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Instalar hooks:

```bash
agent-coordinator install-hooks
export AGENT_COORDINATOR_INSTANCE=agent_123
```

Para PR/CI:

```bash
agent-coordinator verify-commit-range --range "origin/main..HEAD"
```

Regra de design:

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

Commit trailers:

```text
Agent: frontend-codex
Agent-Instance: agent_123
Agent-Thread: 019eff77
Agent-Task: AGT-20260628-001
```

Restaurar git identity anterior:

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

A maioria das tools aceita `root` opcional. Prefira passar o repository root
explicitamente para o server não gravar state no diretório errado.

## Comandos principais

```text
init, status, create, claim, update, heartbeat, release
mine, conflicts, message, inbox, inbox-read, presence, watch
handoff request, handoff respond, handoff list
snapshot, explain, doctor
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
