# StormDrain 🧠

StormDrain is a persistent memory layer and architectural invariant tracker for AI software engineering agents. It pairs graph-backed SQLite storage and automated Git versioning with an **Asymmetric Localized PageRank** engine, SHA-256 confidence decay, automated micro-memory consolidation, and a Vite-based React Web UI.

StormDrain supports both terminal and MCP agent workflows:
- **CLI-First**: Native CLI commands (`read`, `recall`, `add`, `search`, `consolidate`) with pure `--json` flags and stdin/file pipes for terminal agents.
- **Lean MCP Server**: 3 core tools (`sd_read`, `sd_recall`, `sd_memory`) with backward compatibility for legacy granular calls.
- **Remote Thin Agent**: Zero-dependency Python client (`scripts/stormdrain-agent.py`, stock Python 3.6+) for remote VMs over SSH tunnels.

---

## Key Features

- **Context Isolation**: Independent namespaces under `~/.stormdrain/contexts/` with workspace directory bindings. What an agent learns in Project A never bleeds into Project B.
- **Automated Git Versioning**: Every memory update is committed to a local, isolated Git repository automatically with SHA-256 drift detection.
- **Topological Invariant Injection (`sd_read` / `stormdrain read`)**: Automatically injects architectural invariants, upstream caller constraints, and symbol outlines when viewing source code.
- **Multi-Hop Pre-Action Recall (`sd_recall` / `stormdrain recall`)**: Andersen-Chung-Lang (ACL) PageRank push traverses repository dependency DAGs to warn agents of breaking contracts and caller risks before edits occur.
- **Micro-Memory Consolidation**: Merges fragmented micro-memories attached to a file or concept vertex into a consolidated architectural guide.
- **Interactive Web UI**: Local React dark-mode dashboard with bidirectional sorting, type filtering, confidence decay visualization, and D3 force-directed knowledge graph inspection.

---

## Installation

### Prerequisites
- Node.js (v20+)
- SQLite3 build tools (Python 3, GCC/Make)

### Build from Source
```bash
git clone https://github.com/dhruvmittal/stormdrain.git
cd stormdrain
npm install
npm run build
npm link
```
This installs the `stormdrain` CLI globally on your system.

---

## 🖥️ Command Line Interface

StormDrain provides a first-class CLI designed for human developers and autonomous terminal agents (such as OpenCode, Claude Code, and Aider). Primary querying and mutation commands support pure `--json` output and stdin/file piping.

### Quick Start
```bash
# Read source code with automatic topological invariant injection
stormdrain read src/core/context.ts

# Multi-hop pre-action recall before modifying code
stormdrain recall -t src/core/context.ts [--json]

# Record discoveries, invariants, or ADRs (supports stdin "-" and "--file")
stormdrain add warning "Lock Contention" "High write concurrency causes BUSY in WAL mode" -t src/core/context.ts
stormdrain add fact "Architecture Rule" --file ./docs/invariants.md -t src/cli/index.ts --json
echo "Pipe content directly" | stormdrain add decision "ADR 004" - -t src/core/context.ts --json

# Search, inspect, and consolidate
stormdrain search "WAL lock" [--json]
stormdrain get mem_83050d448bb2 [--json]
stormdrain consolidate src/core/context.ts [--json]

# Start MCP stdio server or Web UI
stormdrain serve [dir]   # MCP server over stdio (alias: stormdrain mcp)
stormdrain web -p 3456   # Web UI dashboard & REST API
```

<details>
<summary><b>📖 Full CLI Command Reference & Flags</b></summary>

<br>

#### 1. File Reader (`read`)
Read source code from disk with injected architectural invariants, upstream caller constraints, and AST symbol outlines:
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

#### 2. Pre-Action Recall (`recall`)
Traverse the codebase dependency graph to retrieve invariants before modifying code:
```bash
# Recall invariants and caller constraints for a target file
stormdrain recall -t src/core/context.ts

# Limit results count (-l) or hop depth (-d)
stormdrain recall -t src/core/context.ts -l 5 -d 2

# Output machine-readable JSON for agents
stormdrain recall -t src/core/context.ts --json

# Recall top memories across the active context without a file anchor
stormdrain recall -l 10
```

#### 3. Adding Memories (`add`)
Persist new architectural discoveries, invariants, gotchas, or decisions:
```bash
# Direct arguments: <type> <title> [content]
stormdrain add warning "Lock Contention" "High concurrency write locks cause BUSY timeout in SQLite WAL mode" -t src/core/context.ts

# Ingest content from a file
stormdrain add decision "ADR 005 - ACL PageRank" --file ./docs/adr-005.md -t src/core/context.ts

# Pipe content via stdin ("-", buffered up to 256 KB)
git diff HEAD~1 | stormdrain add fact "Recent Migration Invariants" - -t src/core/context.ts --json

# Machine-readable JSON output returns assigned ID
stormdrain add fact "Memory Invariant" "Always check null on targetFile" -t src/core/context.ts --json
```

#### 4. Search & Inspection (`search`, `get`, `delete`)
```bash
# Full-text search (FTS5) across titles, tags, and content
stormdrain search "WAL lock"
stormdrain search "timeout" -T warning      # Filter by canonical type
stormdrain search "WAL lock" --json        # Pure JSON output

# Inspect full details, timestamps, scores, and incoming/outgoing edges
stormdrain get mem_83050d448bb2
stormdrain get src/core/context.ts          # Inspect a file vertex in the DAG
stormdrain get mem_83050d448bb2 --json

# Delete a memory and cascade clean its relational links
stormdrain delete mem_83050d448bb2
```

#### 5. Consolidation & Curation (`candidates`, `consolidate`, `harvest`, `curate`)
```bash
# Find file vertices with clustered micro-memories
stormdrain candidates
stormdrain candidates --threshold 5
stormdrain candidates --json

# Synthesize clustered micro-memories into a consolidated guide
stormdrain consolidate src/core/context.ts
stormdrain consolidate src/core/context.ts mem_123 mem_456 --json

# End-of-session guided prompt instructions
stormdrain harvest   # Prompts agent to extract invariants from recent work
stormdrain curate    # Holistic memory curation and pruning sweep
```

</details>

<details>
<summary><b>📁 Context & Workspace Management</b></summary>

<br>

Contexts isolate project knowledge under `~/.stormdrain/contexts/`:

```bash
# Initialize and bind a project repository
stormdrain init my-project /path/to/project

# Scaffold or refresh AGENTS.md instruction guidelines
stormdrain agents -f

# List registered contexts and bound filesystem paths
stormdrain context list

# Bind a workspace directory to an existing context
stormdrain context bind my-project /path/to/project

# Unbind a workspace directory
stormdrain context unbind my-project /path/to/old

# Set active context for current shell session
stormdrain context use my-project
```

</details>

<details>
<summary><b>⚡ Shell Autocompletion Setup</b></summary>

<br>

StormDrain supports dynamic shell autocompletion for subcommands, context names, memory types, and relation types:

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

</details>

<details>
<summary><b>🤖 Agent Scripting Recipes</b></summary>

<br>

#### Capturing Created Memory IDs with `jq`
```bash
MEM_ID=$(stormdrain add fact "CI Test Timeout" "Set Vitest testTimeout to 10000ms" -t vitest.config.ts --json | jq -r .id)
echo "Created memory ID: ${MEM_ID}"
```

#### Automated Pre-Edit Recall Verification in Bash Loops
Before modifying a file, check for active caller constraints:
```bash
INVARIANTS=$(stormdrain recall -t "$TARGET_FILE" --json)
if [ "$INVARIANTS" != "[]" ]; then
  echo "Active constraints found for $TARGET_FILE:"
  echo "$INVARIANTS" | jq -r '.[] | "- [\(.type | ascii_upcase)] \(.title)"'
fi
```

</details>

---

## 🔌 MCP Client Configuration

StormDrain runs an MCP server over `stdio` exposing 3 primary tools (`sd_read`, `sd_recall`, `sd_memory`) with backward compatibility for legacy granular tool calls:

### 1. OpenCode
Add to `opencode.json` (global) or `.opencode/opencode.json` (workspace):

```json
{
  "mcpServers": {
    "stormdrain": {
      "command": "stormdrain",
      "args": ["serve"]
    }
  }
}
```

To pin to the current workspace root in project-local configuration:
```json
{
  "mcpServers": {
    "stormdrain": {
      "command": "stormdrain",
      "args": ["serve", "."]
    }
  }
}
```

### 2. Antigravity
Add to `~/.gemini/antigravity/mcp_config.json`:

```json
{
  "mcpServers": {
    "stormdrain": {
      "command": "stormdrain",
      "args": ["serve"]
    }
  }
}
```

### 3. Claude Code
Register via the CLI:

```bash
# Global
claude mcp add stormdrain -- stormdrain serve

# Pinned to workspace
claude mcp add stormdrain -- stormdrain serve .
```

---

## 🛠️ MCP Tool Surface

Agents interacting with StormDrain over MCP use 3 lean, consolidated tools:

| Tool | Purpose | Key Parameters |
| :--- | :--- | :--- |
| **`sd_read`** | **Primary File Reader**: Reads source files with automatic topological invariant injection, AST symbol outlines, and line slicing. | `path`, `start_line`, `end_line`, `limit`, `include_invariants`, `include_symbols` |
| **`sd_recall`** | **Pre-Action Recall**: Mandatory check before modifying code. Recalls multi-hop invariants, upstream caller constraints, and downstream rules. | `target_file`, `limit`, `max_depth` |
| **`sd_memory`** | **Consolidated Memory Manager**: Performs add, search, get, delete, or consolidate actions. | `action` (`add` \| `search` \| `get` \| `delete` \| `consolidate`), `type`, `title`, `content`, `target`, `relation_type`, `query`, `id` |

*(Note: Legacy calls to `sd_add`, `sd_search`, `sd_get`, `sd_delete`, `sd_update`, `sd_relate`, `sd_consolidate`, `sd_scan`, `sd_init`, and `sd_prune` remain fully supported via transparent backward-compatible routing).*

---

## 🌐 Remote Hosts (Zero-Dependency Python Thin Client)

For remote VMs, cloud GPU clusters, or sandboxed environments where Node.js is unavailable, StormDrain includes a standalone, zero-dependency Python 3.6+ client (`scripts/stormdrain-agent.py`):

```bash
# Export thin agent from central server
stormdrain export-agent > stormdrain-agent.py
scp stormdrain-agent.py remote-vm:~/bin/
chmod +x ~/bin/stormdrain-agent.py
```

Configure your remote agent (`mcpServers`):
```json
{
  "mcpServers": {
    "stormdrain": {
      "command": "python3",
      "args": ["/path/to/stormdrain-agent.py"],
      "env": {
        "STORMDRAIN_SERVER_URL": "http://localhost:3456",
        "STORMDRAIN_CONTEXT": "my_project"
      }
    }
  }
}
```
See the **[Remote Setup Guide](docs/remote-client-setup.md)** for SSH tunneling and production configuration.

---

## 🏗️ Architecture & Concepts

### Canonical Memory Types
- **`fact`**: Verified architectural facts, invariants, and hard constraints.
- **`decision`**: Architectural Decision Records (ADRs) explaining trade-offs.
- **`guide`**: Workflows, runbooks, and consolidated super-memories.
- **`warning`**: Critical gotchas, edge cases, and traps.
- **`concept`**: Domain models and architectural components.

### Storage Sandboxing (CRITICAL INVARIANT)
The storage engine under `~/.stormdrain/` is managed strictly by StormDrain. AI agents and scripts must **never** directly inspect, edit, or delete files in `~/.stormdrain`. All interactions must occur via the official CLI (`stormdrain <cmd>`) or MCP tools (`sd_*`).

### Multi-Hop Topological Recall (ACL PageRank)
To retrieve relevant context across interconnected codebases without recursive BFS context explosions, StormDrain models the repository as a directed dependency graph $G = (V, E)$ and applies an **Asymmetric Localized PageRank (Andersen-Chung-Lang / ACL Push)** algorithm:
- **Asymmetric Weights**: Downstream dependencies ($W = 0.80$) are weighted higher than upstream callers ($W = 0.25$) to prevent broad utility fan-out.
- **Capacity-Conditioned Pushes**: Pushes require $\frac{r(u)}{W_{\text{total}}(u)} \ge \epsilon$ where $\epsilon = 10^{-4}$, isolating high-degree sinks.
- **Consolidation Shield & Tiered Output**: Suppresses micro-memories when a consolidated guide exists, partitioning recall into **Direct Invariants** ($h=0$), **Upstream Caller Constraints** ($h \ge 1$), and **Downstream Dependency Invariants** ($h \ge 1$).

---

## 🎨 Web UI

Start the local Web UI:
```bash
stormdrain web -p 3456
```
Open [http://localhost:3456](http://localhost:3456) to access the interactive dashboard, D3 force-directed dependency graph, and memory browser.

---

*Built for robust agentic software engineering.*
