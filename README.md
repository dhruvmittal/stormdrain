# StormDrain 🧠

StormDrain is a persistent memory layer for software engineering agents. It combines the compounding knowledge base of an LLM Wiki with the cross-session memory of Lemma, and the deep code intelligence of TokenSave into a unified Model Context Protocol (MCP) tool.

StormDrain acts as the long-term memory for your AI pair programmer. Everything your agent learns (facts, patterns, architectural decisions, mistakes) is saved as Markdown files, tracked in Git, and instantly recalled via a fast SQLite FTS5 index.

## Features

- **Context Isolation:** Keep client projects separate. What an agent learns on Project A won't bleed into Project B.
- **Auto-Versioning:** Every memory update is debounced and committed to a local Git repository automatically.
- **Hybrid Injection:** Crucial memories are seamlessly injected into the agent's tool descriptions for zero-effort recall.
- **Web UI & Graph Visualization:** A local, dark-mode React dashboard to browse your memories and see how they connect via D3.js force-directed graphs.
- **TokenSave Integration:** Seamlessly delegates to TokenSave when available for deep code graph analysis.

---

## Installation

### Prerequisites
- Node.js (v24+)
- SQLite3 build tools (Python 3, GCC/Make)

### Build from Source
```bash
git clone <your-repo>/stormdrain.git
cd stormdrain
npm install
npm run build
npm link
```
This will install `stormdrain` globally on your system.

---

## 🔌 MCP Client Configuration

StormDrain runs as an MCP server over `stdio`. It automatically routes requests to the correct project context by introspecting file paths, or can be explicitly pinned to a workspace root by passing a directory argument (`stormdrain serve [dir]` or alias `stormdrain mcp [dir]`).

### OpenCode

Add to your global `opencode.json` or project-local `.opencode/opencode.json`:

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

*(If you didn't run `npm link`, replace `"stormdrain"` with `"node"` and `"serve"` with `"/path/to/stormdrain/dist/index.js", "serve"`)*

### Antigravity

For Google's Antigravity, add to `~/.gemini/antigravity/mcp_config.json`:

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

To pin to a specific workspace root:

```json
{
  "mcpServers": {
    "stormdrain": {
      "command": "stormdrain",
      "args": ["serve", "/path/to/project"]
    }
  }
}
```

### Claude Code

Register via the CLI (global or pinned to current workspace):

```bash
# Global
claude mcp add stormdrain -- stormdrain serve

# Pinned to current workspace
claude mcp add stormdrain -- stormdrain serve .
```

### Remote Hosts (Python Thin Client)

For remote VMs or environments without Node.js, StormDrain includes a zero-dependency Python client (`scripts/stormdrain-agent.py`, stock Python 3.6+) that connects to a central `stormdrain web` instance:

```bash
stormdrain export-agent > stormdrain-agent.py
```

See the **[Remote Setup Guide](docs/remote-client-setup.md)** for SSH tunneling and client configuration.

---

## 🖥️ Usage

### Command Line Interface

StormDrain comes with a powerful CLI for project setup and human interaction:

```bash
# Initialize and bind a project repository
stormdrain init my-project /path/to/project

# Manage context path bindings
stormdrain context list                              # List contexts and bound filesystem paths
stormdrain context bind my-project /path/to/project  # Bind a workspace directory to a context
stormdrain context unbind my-project /path/to/old    # Unbind a workspace directory
stormdrain context use my-project                    # Set default context for interactive CLI commands

# Manage memories
stormdrain add lesson "NixOS mkDefault" "Always use mkDefault in NixOS module options to prevent priority conflicts."
stormdrain search "NixOS"
stormdrain recall

# Start servers
stormdrain serve [dir]   # Starts MCP stdio server (alias: stormdrain mcp [dir])
stormdrain web           # Starts Web UI on http://localhost:3456
```

### Shell Autocompletion

StormDrain supports full shell autocompletion for Bash, Zsh, Fish, and PowerShell with dynamic context-aware suggestions (subcommands, memory types, relation types, and registered context names):

```bash
# Bash (add to ~/.bashrc for persistence)
source <(stormdrain completion bash)

# Zsh (add to ~/.zshrc for persistence)
source <(stormdrain completion zsh)

# Fish
stormdrain completion fish | source

# PowerShell
stormdrain completion powershell | Out-String | Invoke-Expression
```

### The Web UI

To visualize the knowledge graph or manage memories visually, start the Web UI:
```bash
stormdrain web
```
Then navigate to [http://localhost:3456](http://localhost:3456) in your browser to view the Dashboard, the Memory Browser, and the Interactive Graph View.

---

## 🏗️ Architecture & Concepts

1. **Memories**: Typed markdown files (`fact`, `decision`, `guide`, `warning`, `concept`, `codemap`) with YAML frontmatter containing metadata like confidence scores and relationships.
2. **Contexts & Isolation**: Separate namespaces under `~/.stormdrain/contexts/` with 1:1 project path bindings. Requests route via target path introspection, and mutating operations on unmapped directories fail closed to prevent cross-project crosstalk.
3. **The Engine**: Uses `better-sqlite3` with WAL mode and `busy_timeout` to maintain an instantaneous FTS5 search index alongside the markdown source of truth.

---

## 🧭 Multi-Hop Topological Recall

To retrieve relevant context across interconnected codebases without the context explosion of recursive BFS, StormDrain models the repository as a directed dependency graph $G = (V, E)$ and applies an **Asymmetric Localized PageRank (Andersen-Chung-Lang / ACL Push)** algorithm:

* **Asymmetric Propagation**: Traversal pushes residual mass from a target file with directional weights—prioritizing downstream dependencies ($W = 0.80$) over upstream callers ($W = 0.25$) to avoid repository-wide fan-out.
* **Capacity-Conditioned Push**: Pushes require $\frac{r(u)}{W_{\text{total}}(u)} \ge \epsilon$ where $W_{\text{total}}(u) = d_{\text{in}}(u) + d_{\text{out}}(u)$ ($\epsilon = 10^{-4}$), preventing high-degree utility sinks (e.g., global loggers) from triggering runaway exploration.
* **Cumulative Mass Truncation**: Vertices are sorted by PageRank mass $p(v)$ and cut off once cumulative mass reaches a target threshold ($1 - \delta \ge 0.85$), strictly bounding frontier size.
* **Hop-Layer Normalization**: Nodes are grouped by shortest-path distance $h(v)$. Mass is normalized against the layer's aggregate mass ($\psi(v) = \frac{p(v)}{\text{LayerMass}_{h(v)}}$) to prevent deep-hop starvation caused by exponential damping.
* **Consolidation Shield & Tiered Briefings**: Suppresses micro-memories when an attached consolidated guide is present, partitioning context into **Direct Invariants** ($h=0$), **Upstream Caller Constraints** ($h \ge 1$), and **Downstream Dependency Invariants** ($h \ge 1$).

---

*Built for advanced agentic coding workflows.*
