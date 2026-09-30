# StormDrain CLI Usage & Scripting Guide

StormDrain provides a first-class command-line interface designed for both human developers and autonomous terminal-based AI agents (such as OpenCode, Claude Code, Aider, or custom shell scripts).

All querying and mutation commands support pure `--json` output to allow programmatic parsing without ANSI escapes or human-targeted formatting.

---

## Table of Contents
1. [Core Workflows & Daily Use](#1-core-workflows--daily-use)
2. [Adding Memories & Ingestion](#2-adding-memories--ingestion)
3. [Search, Inspection & Recall](#3-search-inspection--recall)
4. [Consolidation & Curation](#4-consolidation--curation)
5. [Context & Workspace Management](#5-context--workspace-management)
6. [Daemons & Servers](#6-daemons--servers)
7. [Shell Autocompletion](#7-shell-autocompletion)
8. [Agent Scripting Recipes](#8-agent-scripting-recipes)

---

## 1. Core Workflows & Daily Use

### File Reader with Invariant Injection (`read`)
Read source code files from disk with automatic injection of connected architectural invariants, upstream caller constraints, and AST symbol outlines:

```bash
# Read entire file with invariant header and symbols
stormdrain read src/core/context.ts

# Slice line ranges (1-indexed)
stormdrain read src/core/context.ts -s 10 -e 45
stormdrain read src/core/context.ts --offset 50 --limit 20

# Disable symbol outline or invariant injection if needed
stormdrain read src/core/context.ts --no-invariants
stormdrain read src/core/context.ts --no-symbols
```

### Pre-Action Topological Recall (`recall`)
Query multi-hop topological invariants before modifying, refactoring, or investigating code:

```bash
# Recall invariants and caller constraints for a target file
stormdrain recall -t src/core/context.ts

# Limit results or hop depth
stormdrain recall -t src/core/context.ts -l 5 -d 2

# Output pure machine-readable JSON for agents
stormdrain recall -t src/core/context.ts --json

# Recall top memories across the active context (unanchored)
stormdrain recall -l 10
```

---

## 2. Adding Memories & Ingestion (`add`)

StormDrain supports canonical memory types: `fact`, `decision`, `guide`, `warning`, and `concept`.

### Direct Argument Ingestion
```bash
stormdrain add warning "Lock Contention" "High concurrency write locks cause BUSY timeout in SQLite WAL mode" -t src/core/context.ts
```

### Ingesting from a File (`--file`)
Pass documentation, notes, or code comments from a file:
```bash
stormdrain add decision "ADR 005 - ACL PageRank" --file ./docs/adr-005.md -t src/core/context.ts
```

### Ingesting from Standard Input (`-`)
Pipe content directly from terminal commands or agent execution logs (buffered up to 256 KB):
```bash
git diff HEAD~1 | stormdrain add fact "Recent Migration Invariants" - -t src/core/context.ts --json
```

### Programmatic Capture with `--json`
The `--json` flag outputs a pure JSON object containing the assigned memory ID:
```bash
stormdrain add fact "Memory Invariant" "Always check null on targetFile" -t src/core/context.ts --json
```
Output:
```json
{
  "id": "mem_2028753235b2",
  "title": "Memory Invariant",
  "type": "fact",
  "context": "my_project",
  "status": "added",
  "relations": [
    {
      "target": "src/core/context.ts",
      "type": "affects"
    }
  ]
}
```

---

## 3. Search, Inspection & Recall

### Full-Text Search (`search`)
Search across titles, content, and tags using the SQLite FTS5 index:
```bash
# Interactive formatted output
stormdrain search "WAL lock"

# Filter by canonical type
stormdrain search "timeout" -T warning

# Pure JSON output
stormdrain search "WAL lock" --json
```

### Detailed Inspection (`get`)
Inspect full node metadata, creation timestamp, confidence score, and incoming/outgoing edges:
```bash
# Inspect by memory ID
stormdrain get mem_83050d448bb2

# Inspect a file vertex in the DAG
stormdrain get src/core/context.ts

# Pure JSON output
stormdrain get mem_83050d448bb2 --json
```

### Deleting Memories (`delete`)
Remove a memory and cascade clean its relational links and search index entries:
```bash
stormdrain delete mem_83050d448bb2
```

---

## 4. Consolidation & Curation

As agents work, micro-memories cluster around active files. StormDrain provides tools to detect clusters and consolidate them into cohesive guides.

### Find Consolidation Candidates (`candidates`)
```bash
# Show file vertices with 3 or more micro-memories
stormdrain candidates

# Adjust minimum threshold
stormdrain candidates --threshold 5

# JSON output
stormdrain candidates --json
```

### Consolidate Micro-Memories (`consolidate`)
Merge clustered memories into a unified super-memory attached to the target:
```bash
# Consolidate all attached memories for a target file
stormdrain consolidate src/core/context.ts

# Consolidate specific memory IDs explicitly
stormdrain consolidate src/core/context.ts mem_123 mem_456 mem_789

# JSON output
stormdrain consolidate src/core/context.ts --json
```

### End-of-Session Prompts
```bash
# Harvest: guided prompt instructions for extracting discoveries from recent work
stormdrain harvest

# Curate: holistic review prompt to consolidate or prune knowledge across the graph
stormdrain curate
stormdrain curate src/core/context.ts
```

---

## 5. Context & Workspace Management

Contexts isolate project knowledge under `~/.stormdrain/contexts/`.

```bash
# Initialize and bind a project repository
stormdrain init my-project /path/to/project

# Scaffold or refresh AGENTS.md instruction guidelines
stormdrain agents -f

# List contexts and bound filesystem paths
stormdrain context list

# Bind a workspace directory to an existing context
stormdrain context bind my-project /path/to/project

# Unbind a workspace directory
stormdrain context unbind my-project /path/to/old

# Set active context for current shell session
stormdrain context use my-project
```

---

## 6. Daemons & Servers

```bash
# Start MCP server over stdio (alias: stormdrain mcp [dir])
stormdrain serve
stormdrain serve /path/to/workspace

# Start Web UI dashboard & REST API (default port 3456)
stormdrain web -p 3456
```

---

## 7. Shell Autocompletion

Enable tab autocompletion for subcommands, context names, memory types, and relation types:

```bash
# Bash (add to ~/.bashrc)
source <(stormdrain completion bash)

# Zsh (add to ~/.zshrc)
source <(stormdrain completion zsh)

# Fish
stormdrain completion fish | source

# PowerShell
stormdrain completion powershell | Out-String | Invoke-Expression
```

---

## 8. Agent Scripting Recipes

### Capturing Added Memory ID in Shell Scripts
```bash
MEM_ID=$(stormdrain add fact "CI Test Timeout" "Set Vitest testTimeout to 10000ms" -t vitest.config.ts --json | jq -r .id)
echo "Created memory: ${MEM_ID}"
```

### Automated Pre-Edit Verification in Agent Loops
Before an agent edits a target file, execute:
```bash
INVARIANTS=$(stormdrain recall -t "$TARGET_FILE" --json)
if [ "$INVARIANTS" != "[]" ]; then
  echo "Found invariants for $TARGET_FILE:"
  echo "$INVARIANTS" | jq -r '.[] | "- [\(.type | ascii_upcase)] \(.title)"'
fi
```
