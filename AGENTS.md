# Agent Guidelines & Project Context: StormDrain

## Project Overview
StormDrain is an MCP-based persistent memory system for AI software engineering agents. It provides a graph-backed SQLite storage engine, Git versioning, SHA-256 confidence decay, automated micro-memory consolidation, and a Vite-based React Web UI with an interactive graph visualizer and memory browser.

---

## StormDrain Persistent Memory Protocol
This project uses StormDrain for persistent cross-session architectural memory via MCP tools (`sd_*`) or CLI (`stormdrain <cmd>`).

### Mandatory Sandboxing & Execution Rules:
1. **Strict Sandboxing (CRITICAL)**: NEVER directly access, inspect, or modify files inside the `~/.stormdrain` directory. The internal storage engine is managed exclusively by StormDrain.
2. **Authorized Execution (MCP or CLI)**: Always interact with StormDrain exclusively through official MCP server tools (`sd_*`) or the official `stormdrain` CLI. Never bypass these interfaces with raw SQLite queries or direct file edits to the storage repository.

### Workflow:
- **Primary Source Reader**: Use `sd_read(path="...")` or CLI `stormdrain read <path>` to inject topological invariants and caller constraints.
- **Pre-Edit Invariant Check**: Call `sd_recall(target_file="...")` or CLI `stormdrain recall -t <path> [--json]` before modifying code.
- **Record Discoveries**: Call `sd_memory(action="add", ...)` / `sd_add(...)` or CLI `stormdrain add <type> <title> [content|--file <path>|-] [--json]` on non-obvious invariants (canonical types: `fact`, `decision`, `guide`, `warning`, `concept`).
- **Query & Inspect**: Call `sd_memory(action="search"|"get", ...)` or CLI `stormdrain search <query> [--json]`, `stormdrain get <id> [--json]`.
- **Harvest & Curate**: Run `/sd_harvest` (or CLI `stormdrain harvest`) at session end; run `/sd_curate` (or CLI `stormdrain curate`) and `stormdrain consolidate <target> [ids...]` to consolidate candidate micro-memories.

### Editorial Rule:
Record non-obvious invariants, architectural trade-offs, and critical gotchas; do NOT record routine implementation summaries or transient task progress.

---

## Tooling & Build Commands

### 1. Build & Compilation
```bash
# Build main CLI and MCP server bundle into dist/index.js
npm run build

# Build React Web UI bundle into ui/dist/
npm --prefix ui run build
```

### 2. Testing & Verification
```bash
# Run all Vitest test suites (30 test suites, 244 tests)
npm test

# Run a specific test suite
npx vitest run src/core/context.test.ts
```

### 3. Server Execution
```bash
# Start MCP server over stdio (exposes lean sd_read, sd_recall, sd_memory surface)
node dist/index.js mcp

# Start Web UI server on port 3000
node dist/index.js web -p 3000
```

---

## Architecture & Conventions

### Key Layers
- `src/core/`: Storage layer (`better-sqlite3`), SQLite FTS5 search, Git history manager (`git.ts`), SHA-256 confidence decay & consolidation engine (`context.ts`).
- `src/mcp/`: Lean 3-tool MCP server implementation (`sd_read`, `sd_recall`, `sd_memory`) with universal legacy backward compatibility for granular tools (`sd_add`, `sd_search`, etc.).
- `src/cli/`: First-class CLI interface (`src/cli/index.ts`) with multi-hop recall, pure `--json` outputs, stdin/file ingestion, and consolidation.
- `src/web/`: Express REST API endpoints (`/api/memories`, `/api/contexts`, `/api/graph`) and static SPA handler.
- `src/utils/`: AST multi-language dependency scanner, codemap generator, and `AGENTS.md` scaffolder.
- `ui/`: React 18 frontend built with Vite, featuring collapsible icon-rail navigation, segmented type pills, bidirectional table sorting, and dynamic confidence visualization.

### Guardrails & Development Standards
- **Test Isolation**: In test suites, always isolate SQLite databases and Git repositories using `os.tmpdir()` and `process.env.STORMDRAIN_TEST_DIR`.
- **Non-Destructive Operations**: Memory operations and `init` commands must be strictly additive and idempotent. Never drop or wipe user databases.
- **Styling**: All Web UI components must use the CSS design tokens defined in `ui/src/index.css`.
