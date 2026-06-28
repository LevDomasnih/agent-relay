# Agent Relay

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md) ·
[Deutsch](README.de.md) · [Español](README.es.md) ·
[Português do Brasil](README.pt-BR.md) · [日本語](README.ja.md)

Coordina varios AI coding agents dentro de un mismo repositorio git.

Agent Relay da a Codex, Claude Code, Cursor y otros coding agents un
protocolo project-local para tareas, scoped locks, leases, handoffs, mensajes,
verificaciones, snapshots Markdown y git attribution.

Es la capa intermedia entre "todos editan `AGENT_TASKS.md` a mano" y "ya
necesitamos una plataforma de orquestación hospedada".

```text
agent-relay claim --task AGT-20260628-001 --agent frontend-codex --files "src/pages/settings/**"
agent-relay verify-worktree --agent-instance agent_123
agent-relay release --task AGT-20260628-001 --reason "iteration finished"
```

## Qué resuelve

Un tablero Markdown es cómodo para humanos, pero frágil para agents en paralelo.

| Sin coordinator                                      | Con Agent Relay                                        |
| ---------------------------------------------------- | ------------------------------------------------------ |
| Dos agents pueden tomar el mismo archivo en silencio | Los active claims solapados devuelven conflict         |
| Un agent muerto deja ownership obsoleto              | Los leases expiran y takeover requiere reason          |
| Shared files se vuelven zonas de merge accidental    | Los handoff requests son explícitos y quedan logueados |
| Thread identity se pierde después de resume          | Agent instances siguen siendo owners estables          |
| Los commits pierden el "quién y por qué"             | Commit trailers conectan código con task history       |
| Las personas todavía necesitan un board legible      | Markdown snapshots se generan desde state              |

El state vive dentro del proyecto:

```text
.agent-relay/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

Sin daemon. Sin database server. Sin state en `/tmp`.

## Estado

Esta es una versión v0.1-ready. CLI, core package, MCP server, state migrations, CI checks y package dry-runs están implementados y probados. Los packages npm todavía no se publicaron.

Usar desde source:

```bash
git clone https://github.com/LevDomasnih/agent-relay.git
cd agent-relay
pnpm install
pnpm run build
pnpm --filter @levdomasnih/agent-relay-cli agent-relay --help
```

Uso previsto después del primer npm release:

```bash
npx @levdomasnih/agent-relay-cli init
npx @levdomasnih/agent-relay-cli doctor
```

## Quick Start

Inicializa el repositorio:

```bash
agent-relay init
agent-relay doctor
```

Para varios git worktrees, usa un state compartido:

```bash
agent-relay init --state-dir ../.agent-relay-shared
```

Crea una tarea:

```bash
agent-relay create \
  --title "Fix settings layout" \
  --scope "settings page" \
  --files "src/pages/settings/**"
```

Haz claim antes de editar:

```bash
agent-relay claim \
  --task AGT-20260628-001 \
  --agent frontend-codex \
  --agent-instance agent_123 \
  --thread 019eff77 \
  --files "src/pages/settings/**"
```

Durante el trabajo:

```bash
agent-relay heartbeat --task AGT-20260628-001 --agent-instance agent_123
agent-relay update --task AGT-20260628-001 --status fixing --next "patch layout drift"
```

Antes de handoff, commit o final response:

```bash
agent-relay verify-worktree --agent-instance agent_123
```

Termina la iteración:

```bash
agent-relay update --task AGT-20260628-001 --status verifying --next "run focused regression"
agent-relay release --task AGT-20260628-001 --agent-instance agent_123 --reason "iteration finished"
agent-relay snapshot
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
agent-relay handoff request \
  --task AGT-20260628-002 \
  --agent backend-codex \
  --agent-instance agent_456 \
  --files "package.json,pnpm-lock.yaml" \
  --reason "need dependency for API client generation"
```

El owner responde:

```bash
agent-relay handoff respond \
  --id handoff_... \
  --status grant_after_commit \
  --agent frontend-codex \
  --response "will release after current verification"
```

Estados: `grant_after_commit`, `handoff_now`, `denied`, `cancelled`.

## Inbox y Presence

Los agents pueden comunicarse mediante inbox:

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

También hay broadcast, mentions, presence y watch:

```bash
agent-relay message --from-agent release-codex --broadcast --kind blocker --text "Release branch is frozen."
agent-relay presence
agent-relay watch --limit 20
```

## Verificaciones y Git Hooks

```bash
agent-relay verify-worktree --agent-instance agent_123
agent-relay verify-commit --agent-instance agent_123 --message-file .git/COMMIT_EDITMSG
```

Instalar hooks:

```bash
agent-relay install-hooks
export AGENT_RELAY_INSTANCE=agent_123
```

Para PR/CI:

```bash
agent-relay verify-commit-range --range "origin/main..HEAD"
```

Regla de diseño:

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

Restaurar git identity anterior:

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

La mayoría de tools acepta `root` opcional. Es mejor pasar el repository root
explícitamente para que el server no escriba state en el directorio equivocado.

## Comandos principales

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
