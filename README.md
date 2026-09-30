# StormDrain 🧠

StormDrain is a persistent memory layer and architectural invariant tracker for AI software engineering agents. It pairs graph-backed SQLite storage and automated Git versioning with an **Asymmetric Localized PageRank** engine, SHA-256 confidence decay, automated micro-memory consolidation, and a Vite-based React Web UI.

StormDrain is built for **lightweight, fast agents**:
- **Dual Architecture**: Native, first-class CLI with pure `--json` outputs and stdin/file pipes for terminal-native agents (OpenCode, Claude Code, Aider, terminal scripts).
- **Consolidated 3-Tool MCP Surface**: Slashes MCP handshake schema token tax from **~3,500+ tokens to ~800 tokens** (`sd_read`, `sd_recall`, `sd_memory`), dramatically boosting tool-calling reliability for fast reasoning models like GLM Flash 5.3.
- **Zero-Dependency Remote Thin Agent**: Single-file Python client (`scripts/stormdrain-agent.py`, stock Python 3.6+) for remote VM execution over SSH tunnels.

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

## 🖥️ CLI Usage (Terminal & Scripted Workflows)

StormDrain provides a first-class CLI designed for humans and autonomous terminal agents. All primary querying commands support pure `--json` output for programmatic consumption.

### Invariant & Memory Workflows

```bash
# Read file with topological invariant injection and AST outline
stormdrain read src/core/context.ts

# Multi-hop architectural recall before modifying code
stormdrain recall -t src/core/context.ts
stormdrain recall -t src/core/context.ts --json

# Record new architectural discoveries, invariants, or warnings
stormdrain add warning "Lock Contention" "High concurrency write locks cause BUSY timeout in WAL mode" -t src/core/context.ts
stormdrain add fact "Buffer Cap" --file ./docs/invariants.md -t src/cli/index.ts --json
echo "Pipe content directly" | stormdrain add decision "ADR 004" - -t src/core/context.ts --json

# Search memories across active context and _global
stormdrain search "WAL lock"
stormdrain search "WAL lock" --json

# Inspect details for a specific memory or file vertex
stormdrain get mem_83050d448bb2
stormdrain get mem_83050d448bb2 --json

# Delete a memory
stormdrain delete mem_83050d448bb2

# Find consolidation candidates and synthesize micro-memories
stormdrain candidates
stormdrain candidates --json
stormdrain consolidate src/core/context.ts --json

# Guided session harvest & curation prompts
stormdrain harvest   # Prompts agent to extract invariants from recent work
stormdrain curate    # Holistic memory curation and pruning sweep
```

### Context & Project Management

```bash
# Initialize and bind a project repository
stormdrain init my-project /path/to/project

# Scaffold or refresh AGENTS.md instruction guidelines
stormdrain agents -f

# Manage context bindings
stormdrain context list                              # List registered contexts and bound filesystem paths
stormdrain context bind my-project /path/to/project  # Bind a workspace directory to a context
stormdrain context unbind my-project /path/to/old    # Unbind a workspace directory
stormdrain context use my-project                    # Set default context for interactive CLI commands
```

### Servers & Daemons

```bash
# Start lean MCP server over stdio (alias: stormdrain mcp [dir])
stormdrain serve [dir]

# Start Web UI & REST API on http://localhost:3456
stormdrain web -p 3456
```

### Shell Autocompletion
StormDrain supports dynamic shell autocompletion for Bash, Zsh, Fish, and PowerShell:

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

## 🔌 MCP Client Configuration

StormDrain exposes a consolidated **3-tool surface** (`sd_read`, `sd_recall`, `sd_memory`) over `stdio`, consuming only ~800 tokens of initial schema context while preserving universal backward compatibility for legacy granular tool calls.

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
