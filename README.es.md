# Agent Coordinator

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

Coordina varios AI coding agents dentro de un mismo repositorio git.

Agent Coordinator da a Codex, Claude Code, Cursor y otros coding agents un
protocolo project-local para tareas, scoped locks, leases, handoffs, mensajes,
verificaciones, snapshots Markdown y git attribution.

Es la capa intermedia entre "todos editan `AGENT_TASKS.md` a mano" y "ya
necesitamos una plataforma de orquestación hospedada".

```text
agent-coordinator claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator release --task AGT-20260628-001 --reason "iteration finished"
```

## Qué resuelve

Un tablero Markdown es cómodo para humanos, pero frágil para agents en paralelo.

| Sin coordinator                                      | Con Agent Coordinator                                  |
| ---------------------------------------------------- | ------------------------------------------------------ |
| Dos agents pueden tomar el mismo archivo en silencio | Los active claims solapados devuelven conflict         |
| Un agent muerto deja ownership obsoleto              | Los leases expiran y takeover requiere reason          |
| Shared files se vuelven zonas de merge accidental    | Los handoff requests son explícitos y quedan logueados |
| Thread identity se pierde después de resume          | Agent instances siguen siendo owners estables          |
| Los commits pierden el "quién y por qué"             | Commit trailers conectan código con task history       |
| Las personas todavía necesitan un board legible      | Markdown snapshots se generan desde state              |

El state vive dentro del proyecto:

```text
.agent-coordinator/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

Sin daemon. Sin database server. Sin state en `/tmp`.

## Estado

Este es un early MVP. CLI, core package y MCP server están implementados,
probados y listos para publicar. Los packages npm todavía no se publicaron.

Usar desde source:

```bash
git clone https://github.com/LevDomasnih/agent-coordinator.git
cd agent-coordinator
pnpm install
pnpm run build
pnpm --filter @agent-coordinator/cli agent-coordinator --help
```

Uso previsto después del primer npm release:

```bash
npx @agent-coordinator/cli init
npx @agent-coordinator/cli doctor
```

## Quick Start

Inicializa el repositorio:

```bash
agent-coordinator init
agent-coordinator doctor
```

Crea una tarea:

```bash
agent-coordinator create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

Haz claim antes de editar:

```bash
agent-coordinator claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

Durante el trabajo:

```bash
agent-coordinator heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-coordinator update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

Antes de handoff, commit o final response:

```bash
agent-coordinator verify-worktree --agent-instance agent_123
```

Termina la iteración:

```bash
agent-coordinator update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-coordinator release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-coordinator snapshot
```

## Protocolo del agent

Los agents no necesitan coordinarse editando el mismo Markdown. El ciclo es
pequeño:

1. Revisar el estado con `status`.
2. Tomar task y file scope con `claim`.
3. Enviar `heartbeat` mientras trabaja.
4. Pedir handoff si un shared file pertenece a otro active claim.
5. Verificar cambios con `verify-worktree` o `verify-commit`.
6. Liberar lease, registrar blocker o completar la task.
7. Dejar commit trailers para que el próximo agent entienda el contexto.

El Markdown snapshot es para humanos. La fuente de verdad es JSON state y JSONL
logs.

## Handoff

Si necesitas un scope que pertenece a otro agent:

```bash
agent-coordinator handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

El owner responde:

```bash
agent-coordinator handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent frontend-codex \
  --response "will release after current verification"
```

Estados: `grant_after_commit`, `handoff_now`, `denied`, `cancelled`.

## Verificaciones y Git Hooks

```bash
agent-coordinator verify-worktree --agent-instance agent_123
agent-coordinator verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Instalar hooks:

```bash
agent-coordinator install-hooks
export AGENT_COORDINATOR_INSTANCE=agent_123
```

Regla de diseño:

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

La mayoría de tools acepta `root` opcional. Es mejor pasar el repository root
explícitamente para que el server no escriba state en el directorio equivocado.

## Comandos principales

```text
init, status, create, claim, update, heartbeat, release
mine, conflicts, message
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
