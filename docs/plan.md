# Coordinaut: план проекта

## Что делаем

`Coordinaut` - отдельный standalone-инструмент для координации
параллельных AI coding agents внутри одного git-проекта.

Цель: заменить хрупкую схему, где агенты руками редактируют общий
`AGENT_TASKS.md`, на project-local coordination layer с CLI и MCP server.

Инструмент должен быть переносимым: любой разработчик сможет поставить его в
свой репозиторий, и агенты смогут работать через одинаковый протокол задач,
locks, handoff, сообщений и git attribution.

## Проблема

Markdown task board удобен человеку, но плох как source of truth:

- нет атомарного `claim`;
- два агента могут перетереть одну строку;
- stale locks не протухают сами;
- конфликт по одному файлу надо отслеживать глазами;
- agent/thread identity теряется после resume;
- после commit сложно понять, какой агент и зачем сделал изменение;
- агентам неудобно искать свои прошлые задачи;
- общение между агентами превращается в ручной handoff в тексте.

## Целевая модель

MCP/CLI - source of truth для агентов.

Markdown snapshot - generated view для людей.

Состояние хранится рядом с проектом:

```text
.coordinaut/
  config.json
  state.json
  events.jsonl
  messages.jsonl
  snapshots/
    TASKS.md
```

Состояние не должно жить в `/tmp`. Инструмент не должен быть завязан на
Skillspace или конкретный репозиторий.

## Основные сценарии

### Перед работой

Агент проверяет статус и берет задачу:

```bash
coordinaut status
coordinaut claim \
  --task AGT-20260625-014 \
  --agent visual-settings-codex \
  --thread 019eff77-... \
  --files "src/pages/foo/**"
```

Если другой агент держит пересекающийся scope, `claim` должен вернуть conflict.

### Во время работы

Агент обновляет lease и статус:

```bash
coordinaut heartbeat --task AGT-20260625-014
coordinaut update \
  --task AGT-20260625-014 \
  --status fixing \
  --next "patch layout drift and run focused regression"
```

### В конце итерации

Перед final response, pause или handoff агент обязан:

```bash
coordinaut update --task AGT-20260625-014 --status verifying --next "..."
coordinaut release --task AGT-20260625-014 --reason "iteration finished"
coordinaut snapshot
```

Если задача заблокирована:

```bash
coordinaut update \
  --task AGT-20260625-014 \
  --status blocked \
  --blocker "need live account with populated SMTP/domain state"
```

## Git attribution

Агент может выставить локальную git identity под задачу:

```bash
coordinaut git-identity \
  --agent visual-settings-codex \
  --thread 019eff77-... \
  --task AGT-20260625-014
```

Это ставит:

```text
git config user.name  visual-settings-codex
git config user.email codex+019eff77@coordinaut.local
```

Commit message должен поддерживать trailers:

```text
Agent: visual-settings-codex
Agent-Thread: 019eff77-...
Agent-Task: AGT-20260625-014
```

Так следующий агент сможет понять, кто сделал изменение, зачем, и найти
связанную историю task/events/messages.

## Текущий статус

Проект создан:

```text
/Users/lev/domain-projects/coordinaut
```

Структура:

```text
packages/core       # tasks, leases, conflicts, events, git identity
packages/cli        # CLI coordinaut
packages/mcp-server # MCP server
docs/
templates/
README.md
```

Уже есть CLI команды:

```text
init
status
create
claim
update
heartbeat
release
mine
conflicts
message
snapshot
git-identity
```

Уже есть MCP tools:

```text
init_project
create_task
claim_task
update_task
heartbeat
release_task
list_tasks
list_my_tasks
detect_conflicts
post_message
export_snapshot
git_identity
```

Проверки пройдены:

```bash
pnpm run check
pnpm run format
```

Smoke-test CLI в sample repo прошел для:

```text
init/create/claim/conflicts
```

Git:

```text
commit: 33b7939 feat: scaffold agent coordinator
remote: git@github.com:LevDomashnih/coordinaut.git
```

GitHub repo пока не создан. `git ls-remote origin` вернул `Repository not
found`. После создания пустого repo `LevDomashnih/coordinaut` нужно:

```bash
cd /Users/lev/domain-projects/coordinaut
git push -u origin main
```

## Почему сейчас JSON, а не SQLite

Первая версия использует `state.json + events.jsonl`, потому что:

- нет native dependency;
- проще установка через `npx`;
- меньше шанс падений на `node-gyp`;
- storage boundary небольшой;
- позже можно добавить SQLite adapter без изменения CLI/MCP контракта.

Правильный следующий шаг - выделить `Storage` interface и оставить текущую
реализацию как `JsonFileStorage`.

## Актуальные оставшиеся риски

- conflict detection пока простая: prefix/glob heuristic;
- lock file есть, но stale lock recovery еще не доделан;
- MCP server теперь прогоняется через реальный MCP client smoke test;
- есть автоматические unit tests, CLI smoke и MCP smoke, но нет отдельной
  матрицы интеграционных сценариев по реальным MCP clients;
- `doctor` и `explain` реализованы;
- npm-публикация ожидает финальный public package scope или rename.

## Как не наступить на известные проблемы

### 1. Не использовать agent name как identity

Проблема: два агента могут выбрать одинаковое имя, например
`visual-codex`. Тогда смешаются `list_my_tasks`, git authorship, messages и
handoff.

Решение: разделить human-readable имя и машинную identity.

```ts
type AgentInstance = {
  id: string;
  name: string;
  threadId?: string;
  tool?: "codex" | "claude" | "cursor" | "unknown";
  startedAt: string;
  lastSeenAt: string;
};
```

Правило:

- `agentName` нужен человеку;
- `agentInstanceId` нужен для всех мутаций;
- `threadId` - searchable metadata, но не primary key.

CLI/MCP должны принимать `--agent` для удобства, но внутри создавать или
требовать `agentInstanceId`.

### 2. Не делать красивый task id primary key

Проблема: `AGT-YYYYMMDD-NNN` может столкнуться при параллельном создании задач,
разных worktree или будущем shared backend.

Решение: разделить machine id и display id.

```ts
type Task = {
  id: string; // ULID/UUID, primary key
  displayId: string; // AGT-20260628-001, human-facing
};
```

В UI/snapshot можно показывать `displayId`, но все update/claim/release должны
уметь работать по стабильному `id`. Для CLI можно поддержать оба варианта, если
они однозначны.

### 3. Не считать thread id надежной identity

Проблема: thread id может отсутствовать, быть обрезанным, повториться между
инструментами или быть недоступным в конкретном MCP client.

Решение:

- хранить `threadId` как optional metadata;
- индексировать по нему поиск;
- не использовать его как owner key;
- связывать task -> agentInstance -> threadId.

### 4. Сделать явную модель lock modes

Проблема: не все файлы одинаковые. Для `src/foo.ts` нужен exclusive lock, а
для docs иногда допустима параллельная работа.

Решение:

```ts
type LockMode = "exclusive" | "shared-read" | "shared-docs" | "advisory";
```

Правила MVP:

- code files default `exclusive`;
- generated snapshots default `advisory`;
- docs можно разрешать как `shared-docs`, но только с явным handoff/comment;
- lockfiles (`package-lock`, `pnpm-lock.yaml`) лучше считать `exclusive`.

### 5. Shared files требуют protocol, а не silent merge

Проблема: `package.json`, lockfiles, route registries, public API indexes и
README часто нужны нескольким задачам.

Решение:

- `detect_conflicts` должен возвращать owner task/agent/thread;
- второй агент создает `request_handoff`;
- первый агент выбирает `grant_after_commit`, `handoff_now` или
  `deny_with_reason`;
- takeover после expired lease требует reason и event log.

Нельзя позволять двум агентам тихо править один shared file без записи в
events/messages.

### 6. Lease должен протухать, но takeover должен быть явным

Проблема: агент может умереть, а lock останется. Если просто игнорировать lock
после TTL, можно потерять контекст.

Решение:

```ts
type TakeoverEvent = {
  taskId: string;
  previousAgentInstanceId: string;
  previousLeaseExpiresAt: string;
  newAgentInstanceId: string;
  reason: string;
};
```

`claim` после expired lease должен:

- показать previous owner;
- требовать takeover reason;
- писать event;
- не удалять старые messages/events.

### 7. Multi-worktree нужно явно ограничить или поддержать

Проблема: project-local `.coordinaut/state.json` общий только для одного
checkout. Если агенты работают в разных worktree/clone, они не видят locks друг
друга.

Решение для MVP:

- явно задокументировать: "один checkout = одна coordinator state";
- `doctor` должен показывать `projectRoot` и `statePath`;
- добавить config option `stateDir`, чтобы команда могла вынести state в общий
  путь для family of worktrees.

Future:

- SQLite/shared file backend;
- remote backend;
- Git-backed event sync.

### 8. JSON storage оставить, но спрятать за interface

Проблема: JSON storage прост, но не идеален для больших state, сетевых FS и
сложной конкурентности.

Решение:

- вынести `JsonFileStorage`;
- добавить `Storage` interface;
- все core операции писать через storage abstraction;
- lock manager вынести отдельно;
- SQLite добавлять как adapter, не меняя CLI/MCP contract.

### 9. Git identity должна иметь reset/restore

Проблема: `git-identity` меняет local `user.name`/`user.email`. Агент может
закончить, а identity останется для человека или следующего агента.

Решение:

- перед изменением сохранять previous identity в coordinator state;
- добавить `git-identity reset`;
- `doctor` должен предупреждать, если текущий git identity выглядит как agent;
- commit trailers обязательнее, чем постоянная смена git config.

Возможный future mode: не менять git config навсегда, а дать wrapper
`coordinaut commit`, который временно выставляет env/config только на
один commit.

### 10. Snapshot не должен стать второй базой данных

Проблема: человек или агент может руками поправить generated `TASKS.md`, и
состояние разойдется.

Решение:

- писать вверху snapshot: `Generated. Do not edit.`;
- всегда перегенерировать snapshot из state;
- по умолчанию держать snapshot gitignored или явно documented как generated;
- `doctor` может предупреждать, если snapshot новее state/events.

### 11. MCP root должен быть явным

Проблема: разные MCP clients по-разному задают cwd. Server может начать писать
state не в тот проект.

Решение:

- каждый MCP tool должен принимать optional `root`;
- MCP config examples должны передавать root;
- `doctor` должен показывать resolved root;
- `init_project` не должен молча инициализировать домашнюю директорию.

### 12. Security boundary должен оставаться узким

Проблема: MCP tool с записью в проект может стать опасным, если разрешить
произвольные shell commands или paths вне repo.

Решение:

- не добавлять arbitrary shell execution;
- валидировать paths относительно project root;
- не писать секреты в messages/events;
- messages должны быть plain text, но docs обязаны предупреждать не класть туда
  cookies/tokens/private payloads;
- все destructive операции должны быть explicit и event-logged.

### 13. MCP сам по себе не принуждает агента

Проблема: если MCP tool просто доступен, агент все равно может забыть или
решить не вызывать `claim_task`, отредактировать файлы напрямую и уйти в final
response.

Решение: enforcement должен быть многослойным.

Слой 1 - инструкции:

```text
Before editing any file, call agent_relay.claim_task.
Before final response, call agent_relay.update_task or release_task.
If claim_task reports conflict, do not edit the conflicting files.
```

Слой 2 - локальные проверки:

```bash
coordinaut verify-worktree
coordinaut verify-commit
```

`verify-worktree` должен сравнивать:

- `git diff --name-only`;
- active claims текущего `agentInstanceId`;
- чужие active locks;
- stale leases;
- modified files outside claimed scopes.

`verify-commit` должен проверять:

- staged files входят в claimed `filesGlobs`;
- commit message содержит `Agent`, `Agent-Task` и по возможности
  `Agent-Thread`;
- current git identity не противоречит active agent identity;
- нет конфликтующего active lock на staged files.

Слой 3 - git hooks:

```bash
#!/bin/sh
coordinaut verify-commit
```

MVP должен уметь генерировать или документировать pre-commit / commit-msg hook.
Так агент может забыть MCP protocol, но commit должен остановиться.

Слой 4 - CI/MR check:

В future mode можно запускать `coordinaut verify-commit-range` или
`verify-pr`, чтобы проверить commit trailers и claimed scopes по истории MR.

Правило продукта:

```text
MCP is the protocol. Hooks and checks are the enforcement.
```

## План работ

### 1. Опубликовать базу

- Создать пустой GitHub repo `LevDomashnih/coordinaut`.
- Выполнить `git push -u origin main`.
- Проверить, что README нормально отображается.

### 2. Добавить тесты

Покрыть core/CLI сценарии:

- `init` создает `.coordinaut`;
- `create` добавляет task;
- `claim` ставит owner/thread/lease;
- `claim` падает при конфликтующем scope;
- `heartbeat` продлевает lease;
- `release` снимает lease;
- `update --status blocked` записывает blocker;
- `git-identity` ставит local git config в тестовом repo.

### 3. Выделить storage boundary

Добавить интерфейс:

```ts
interface Storage {
  readState(): Promise<CoordinatorState>;
  writeState(state: CoordinatorState): Promise<void>;
  appendEvent(event: Event): Promise<void>;
  appendMessage(message: Message): Promise<void>;
}
```

Перенести текущую реализацию в `JsonFileStorage`.

Оставить место под будущий `SQLiteStorage`.

### 4. Улучшить conflict engine

- Подключить нормальный glob matcher.
- Поддержать `exclusive` и `shared` locks.
- Добавить `request_handoff` flow.
- Явно показывать, какой task/agent/thread держит конфликтующий scope.

### 5. Добавить `doctor`

Команда должна проверять:

- проект внутри git repo;
- `.coordinaut/config.json` существует;
- state читается;
- lock file не stale;
- MCP server command доступен;
- generated snapshot path валиден.

### 6. Добавить enforcement commands

Добавить:

```bash
coordinaut verify-worktree
coordinaut verify-commit
```

`verify-worktree`:

- проверяет modified files against active claim;
- показывает unclaimed changes;
- показывает files locked by another active agent;
- предупреждает про stale leases;
- выводит actionable next command.

`verify-commit`:

- проверяет staged files;
- проверяет commit trailers или готовит инструкцию для commit-msg hook;
- проверяет current git identity;
- должен быть пригоден для pre-commit/commit-msg hooks.

### 7. Добавить `explain`

Команды:

```bash
coordinaut explain --task AGT-...
coordinaut explain --commit <sha>
```

Ожидаемое поведение:

- читает events/messages по task;
- читает commit trailers;
- показывает agent/thread/task/checks/evidence;
- помогает следующему агенту понять, зачем было сделано изменение.

### 8. Документация

Добавить:

- install guide;
- MCP config examples для Codex, Claude Code, Cursor;
- agent protocol;
- end-of-iteration checklist;
- conflict/handoff protocol;
- git attribution guide;
- fallback workflow без MCP через CLI.
- enforcement guide: AGENTS.md policy, hooks, `verify-worktree`,
  `verify-commit`, CI/MR check.

### 9. Подготовить npm publish

- Проверить package names.
- Решить public package naming.
- Добавить `files` в package manifests.
- Добавить release checklist.
- Проверить `npx` usage в чистом проекте.

## Промпт для следующего агента

```text
Работай в /Users/lev/domain-projects/coordinaut.

Это отдельный standalone проект Coordinaut: project-local coordination
layer для параллельных AI coding agents. Не привязывай его к Skillspace.

Перед изменениями:
1. cd /Users/lev/domain-projects/coordinaut
2. git status --short
3. pnpm install
4. pnpm run check
5. pnpm run format

Текущий статус:
- initial commit: 33b7939 feat: scaffold agent coordinator
- pnpm monorepo
- core: packages/core/src/index.ts
- CLI: packages/cli/src/index.ts
- MCP server: packages/mcp-server/src/index.ts
- docs: README.md, docs/design.md, docs/plan.md, templates/AGENTS.md
- remote: git@github.com:LevDomashnih/coordinaut.git
- GitHub repo еще надо создать, потом git push -u origin main

Главная цель следующей итерации:
сделать installable MVP, который другой человек сможет поставить в свой repo и
использовать через CLI/MCP.

Приоритет:
1. Перепроверь identity/id модель: добавь AgentInstance и раздели task id /
   display id.
2. Опиши и начни lock modes: exclusive/shared-docs/advisory.
3. Добавь автоматические тесты для init/create/claim/conflicts/release.
4. Добавь git-identity reset/restore или хотя бы зафиксируй contract.
5. Добавь verify-worktree и verify-commit как enforcement layer.
6. Добавь команду doctor с resolved root/state path/git identity warnings.
7. Выдели Storage interface и JsonFileStorage.
8. Улучши README с install, MCP config examples, enforcement и
   multi-worktree caveat.
9. Прогони pnpm run check и pnpm run format.

Не коммить node_modules, dist, .coordinaut state.
```
