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

StormDrain runs as an MCP server over `stdio`. Below are the configuration snippets to connect StormDrain to your favorite AI agent environments.

### OpenCode

Add the following to your `opencode.json` configuration file:

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
*(If you didn't run `npm link`, replace the command with `"node"` and the args with `["/absolute/path/to/stormdrain/dist/index.js", "serve"]`)*

### Antigravity

For Google's Antigravity, add this server block to your `~/.gemini/antigravity/mcp_config.json`:

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

### Claude Code

For Anthropic's Claude Code, you can register the MCP server directly via the CLI:

```bash
claude mcp add stormdrain -- stormdrain serve
```

---

## 🖥️ Usage

### Command Line Interface

StormDrain comes with a powerful CLI for human interaction:

```bash
# Manage contexts
stormdrain context list
stormdrain context create my-project
stormdrain context use my-project

# Manage memories
stormdrain add lesson "NixOS mkDefault" "Always use mkDefault in NixOS module options to prevent priority conflicts."
stormdrain search "NixOS"
stormdrain recall

# Start servers
stormdrain serve   # Starts the MCP stdio server (for agents)
stormdrain web     # Starts the Web UI on http://localhost:3456 (for humans)
```

### The Web UI

To visualize the knowledge graph or manage memories visually, start the Web UI:
```bash
stormdrain web
```
Then navigate to [http://localhost:3456](http://localhost:3456) in your browser to view the Dashboard, the Memory Browser, and the Interactive Graph View.

---

## 🏗️ Architecture & Concepts

1. **Memories**: Typed markdown files (`fact`, `pattern`, `lesson`, `warning`, `guide`, `codemap`) with YAML frontmatter containing metadata like confidence scores and relationships.
2. **Contexts**: Separate namespaces stored under `~/.stormdrain/contexts/`. Each context contains its own Git repository and SQLite index.
3. **The Engine**: Uses `better-sqlite3` to maintain an instantaneous FTS5 search index alongside the markdown source of truth.

---

*Built for advanced agentic coding workflows.*
