# Agent Guidelines & Project Context: StormDrain

## Project Overview
StormDrain is an MCP-based persistent memory system for AI software engineering agents. It provides a graph-backed SQLite storage engine, Git versioning, SHA-256 confidence decay, automated micro-memory consolidation, and a Vite-based React Web UI with an interactive graph visualizer and memory browser.

---

## StormDrain Persistent Memory Protocol
This project uses StormDrain for persistent cross-session architectural memory. You have access to StormDrain MCP tools (`sd_read`, `sd_recall`, `sd_add`, `sd_search`, `sd_get`, `sd_delete`, `sd_consolidate`, `sd_consolidation_candidates`, `sd_scan`).

### Mandatory Sandboxing & MCP-First Rules:
1. **Strict Sandboxing (CRITICAL)**: NEVER directly access, inspect, or modify files inside the `~/.stormdrain` directory or the StormDrain internal source code. The internal storage engine (SQLite DBs, Git history, cache files) is managed exclusively by the StormDrain daemon.
2. **MCP-First Execution**: ALWAYS interact with StormDrain exclusively through the MCP server tools (`sd_*`). Do not attempt to bypass MCP tools by writing direct database queries or raw filesystem edits to the storage repository.

### Mandatory Workflow:
- **Primary Source Reader (MANDATORY)**: Always use `sd_read(path="path/to/file")` instead of default read tools. It automatically injects topological invariants, upstream caller constraints, and symbol outlines into the file stream.
- **Pre-Edit Invariant Check**: Call `sd_recall(target_file="path/to/file")` before modifying or refactoring any file to inspect multi-hop caller contracts and dependency rules.
- **Record High-Signal Discoveries**: Call `sd_add(type, title, content, target_file)` when discovering non-obvious bugs, architectural decisions, invariants, or reusable patterns.
- **Harvest Session Discoveries (`/sd_harvest`)**: Run `/sd_harvest` (or CLI `stormdrain harvest`) at the end of a feature, bugfix, or coding session to capture and persist newly established invariants, gotchas, failure modes, or architectural decisions directly via `sd_add`.
- **Curate, Consolidate & Promote (`/sd_curate`)**: Run `/sd_curate` to review candidate micro-memories for surgical consolidation (`sd_consolidate`), generalize and promote environment-wide knowledge to global (`sd_add(..., context="_global")`), or connect related concepts (`sd_relate`).
- **Sync Code Graph**: Call `sd_scan()` whenever new source files, exports, or imports are added or reorganized.

### Memory Curation & Editorial Rubric:
- **High-Signal (DO RECORD)**: Non-obvious invariants, architectural decisions (ADRs/trade-offs), edge-case gotchas, failure modes, negative findings (disproven hypotheses), and performance thresholds.
- **Low-Signal (DO NOT RECORD)**: Routine implementation summaries, syntax notes, transient progress, or facts obvious from reading the code.
- **Tags**: Use semantic tags like `#decision`, `#invariant`, `#hypothesis`, `#environment`, `#anti-pattern`, and `#performance` for precise filtering.
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
# Run all Vitest test suites (15 test suites, 70+ tests)
npm test

# Run a specific test suite
npx vitest run src/core/context.test.ts
```

### 3. Server Execution
```bash
# Start MCP server over stdio
node dist/index.js mcp

# Start Web UI server on port 3000
node dist/index.js web -p 3000
```

---

## Architecture & Conventions

### Key Layers
- `src/core/`: Storage layer (`better-sqlite3`), SQLite FTS5 search, Git history manager (`git.ts`), SHA-256 confidence decay & consolidation engine (`context.ts`).
- `src/mcp/`: MCP protocol server implementation exposing `sd_recall`, `sd_add`, `sd_scan`, `sd_init`, `sd_update`, `sd_search`, `sd_consolidate`.
- `src/web/`: Express REST API endpoints (`/api/memories`, `/api/contexts`, `/api/graph`) and static SPA handler.
- `src/utils/`: AST multi-language dependency scanner, codemap generator, and `AGENTS.md` scaffolder.
- `ui/`: React 18 frontend built with Vite, featuring collapsible icon-rail navigation, segmented type pills, bidirectional table sorting, and dynamic confidence visualization.

### Guardrails & Development Standards
- **Test Isolation**: In test suites, always isolate SQLite databases and Git repositories using `os.tmpdir()` and `process.env.STORMDRAIN_TEST_DIR`.
- **Non-Destructive Operations**: Memory operations and `init` commands must be strictly additive and idempotent. Never drop or wipe user databases.
- **Styling**: All Web UI components must use the CSS design tokens defined in `ui/src/index.css`.
