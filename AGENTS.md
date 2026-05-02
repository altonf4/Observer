# AGENTS.md — altfong/Observer fork

Instructions for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repo.

## Fork context

This is **altonf4/Observer**, a personal fork of [Roy3838/Observer](https://github.com/Roy3838/Observer).

- `origin` → `git@github.com:altonf4/Observer.git` (push here)
- `upstream` → `git@github.com:Roy3838/Observer.git` (sync from here, never push)
- Default branch: `main` — kept in lockstep with upstream, never directly committed to.
- All personal changes live on **`altfong/enhancements`**, a single long-lived branch off `main`. One atomic commit per logical change. To upstream a single fix back to Roy: `git cherry-pick <sha>` onto a fresh `upstream/<topic>` branch off `main`.

## Working in this fork

- **Always branch from `altfong/enhancements`** for new work, then merge/rebase back. Never commit directly to `main`.
- Use **conventional-commit style** subjects: `fix(...)`, `feat(...)`, `chore(...)`, `docs(...)`. Scope = component (e.g. `ai-builder`, `ollama-proxy`, `desktop`, `app-runtime`).
- Body explains the *why* and includes verified results when behavior changes (see existing commits on `altfong/enhancements` for the format).
- Keep commits atomic — one logical change per commit. This makes upstreaming via cherry-pick painless.

## Project layout (quick map)

| Path | What | Stack |
|---|---|---|
| `app/` | Main webapp + Tauri shell. Agent runtime lives here. | Vite + React + TS |
| `app/src/utils/main_loop.ts` | Core agent execution loop — `setInterval` metronome, sensor capture, model call, code-tab execution | TS |
| `app/src/utils/conversational_system_prompt.ts` | System prompt for the in-app AI agent builder. Edit cautiously — the LLM treats its examples as defaults. | TS |
| `app/src/utils/multi_agent_creator.ts` | System prompt for AI Studio multi-agent builder | TS |
| `app/src/utils/handlers/javascript.ts` | JS sandbox for the agent's Code tab — exposes `sleep`, `appendMemory`, `sendDiscord`, etc. | TS |
| `app/src/utils/ModelManager.ts` | Model registry. Reads `multimodal`/`thinking`/`tools` flags from `/v1/models`. Defaults missing flags to `false`. | TS |
| `app/desktop/src-tauri/` | Tauri Rust shell — overlay window, native notifications, CLI installer | Rust |
| `observer-ollama/` | HTTPS+CORS proxy in front of Ollama. **This fork patches it to inject capability flags** (see `handler.py: _handle_models_with_capabilities`). | Python (stdlib http.server) |
| `api/` | FastAPI server (marketplace, payments, Twilio tools) | Python |
| `cli/` | Standalone `observe` CLI — wraps a shell command and notifies on completion | Rust |

## Run / build commands

| Goal | Command |
|---|---|
| Web app dev | `cd app && pnpm dev` |
| Tauri desktop dev | `cd app && pnpm desktop:dev` (auto-builds the Rust CLI first) |
| Tauri desktop release build | `cd app && pnpm desktop:build` |
| Lint TS | `cd app && pnpm lint` |
| Format | `cd app && pnpm format` |
| Run patched ollama proxy | `cd observer-ollama && python3 -m observer_ollama --no-ssl --port 3838 --ollama-host <ollama-host> --ollama-port 11434` |
| FastAPI server | `cd api && uvicorn api:app --reload` |
| Rust CLI build | `cargo build --manifest-path cli/Cargo.toml --release` |

## Pitfalls baked into upstream that bite often

These are why most of this fork's commits exist. **Watch for them when editing.**

- **`sleep(600000)` (10 min) in agent code** — copy-pasted from the AI builder's example patterns. This fork defaults templates to `sleep(180000)` (3 min). Existing user agents in IndexedDB still have the old value; they need manual UI deletion.
- **Loop interval is captured at agent-start time** — editing `loop_interval_seconds` while an agent is running has no effect until you stop and restart. The setter doesn't reschedule `setInterval`. (Bug, not yet fixed in this fork. Workaround: always stop before editing.)
- **`/v1/models` `multimodal` flag** — vanilla Ollama doesn't expose this. The patched `observer-ollama` proxy now queries `/api/show` per model and injects `multimodal`/`thinking`/`tools` flags. Without the proxy, every Ollama model shows the false-positive "may not support images" warning.
- **Thinking-mode models** (Qwen 3.6, DeepSeek-R1, GLM, Gemma 4 with `<|think|>`) wrap output in `<think>...</think>`. Naive `response.includes("KEYWORD")` fires on the model *thinking about* the keyword, not deciding. Always strip first: `const cleaned = response.replace(/<think>[\s\S]*?<\/think>/g, '').trim();`
- **Agent IDs in `$MEMORY@id` / `$IMEMORY@id`** must match the agent's own `id` (or, deliberately, another agent's). Mismatches silently return empty memory.

## Where to test changes

- **Agent runtime changes** (sensors, prompt building, code sandbox) → run `pnpm dev`, create a test agent in the UI, check the Activity log
- **AI builder prompt changes** (`conversational_system_prompt.ts`, `multi_agent_creator.ts`) → run `pnpm dev`, click "Generate Agent" or "AI Edit", verify the produced YAML
- **observer-ollama changes** → boot proxy locally, `curl http://localhost:3838/v1/models | jq` and inspect

## Skill-related work

This fork is being prepared to route the AI Edit / Generate Agent buttons through Claude CLI, using the **`observer-agent-builder` skill** at `~/workspace/altfong-skills/observer-agent-builder/` (symlinked into `~/.claude/skills/`). When that wiring lands here, the skill becomes the source of truth — `conversational_system_prompt.ts` and friends will become thin shims that read it.

Until then, keep parity manually: any pattern/sensor/tool you teach the in-app prompts, also teach the skill, and vice versa.

## Things you do NOT need to do

- Don't rebuild upstream's docs (`README.md`, `JUPYTER.md`, `DOCKER.md`) — they're fine as-is and rebase clean from upstream.
- Don't add tests for trivial fixes; the upstream codebase has minimal test coverage and that's acceptable.
- Don't reformat unrelated code "while you're in there" — keeps diffs cherry-pickable.
- Don't reach into IndexedDB-stored agent state from the codebase. User-modified agents stay user-owned.
