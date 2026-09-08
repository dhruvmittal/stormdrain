# Remote Client-Server Setup Guide

This guide explains how to use StormDrain in a client-server model across two machines:
1. **Server**: Hosts the canonical SQLite database, Git versioning, and Web UI/API.
2. **Client**: The environment where development, debugging, or execution occurs, and where installing heavy runtimes or modern Node.js versions is restricted or undesirable.

By running the **zero-dependency Python MCP thin agent** on the client and connecting over an SSH tunnel to the server, you get:
- Single source of truth (no database sync drift or SQLite network-locking issues).
- Zero dependencies on the client (runs on stock Python 3.6+ without `pip`, `venv`, `npm`, or root access).
- Local file reading (`sd_read`) directly on the client disk with automatic topological invariant injection from the server.

---

## 1. Start the StormDrain Daemon on the Server

On the server machine, start the StormDrain Web API server:

```bash
stormdrain web -p 3456
```

*(Tip: You can run this inside `tmux`, `screen`, or a `systemd --user` service to keep it running in the background).*

---

## 2. Set Up the Persistent SSH Tunnel

If you SSH into both machines from a local workstation (e.g., a laptop), you can configure your SSH config to automatically keep the tunnel open whenever you are working.

Edit your `~/.ssh/config` (or `C:\Users\<username>\.ssh\config` on Windows):

```sshconfig
# Central Server (StormDrain daemon)
Host stormdrain-server
    HostName server.example.com
    User <remote-user>
    LocalForward 3456 localhost:3456

# Remote Client (Performer / Agent)
Host stormdrain-client
    HostName client.example.com
    User <remote-user>
    RemoteForward 3456 localhost:3456
```

### How it works:
1. When you connect to `stormdrain-server`, port 3456 is forwarded to your local workstation.
2. When you connect to `stormdrain-client`, that port is forwarded into the client machine.
3. On the client, `http://localhost:3456` immediately reaches the StormDrain daemon on the server.
4. On your local workstation, opening `http://localhost:3456` in your browser opens the interactive StormDrain Web UI and graph visualizer!

*(Alternative: If the client can connect to the server directly over the network, you can simply run `autossh -M 0 -f -N -L 3456:localhost:3456 <user>@server.example.com` directly from the client).*

---

## 3. Deploy the Thin Agent to the Client

From the server machine, export the self-contained agent script:

```bash
stormdrain export-agent > stormdrain-agent.py
scp stormdrain-agent.py client:~/bin/
```

Or copy the script directly from `scripts/stormdrain-agent.py` in the StormDrain repository.

On the client:
```bash
chmod +x ~/bin/stormdrain-agent.py
```

---

## 4. Configure Your AI Agent on the Client

In your AI editor/agent configuration on the client (e.g. Cursor, Claude Code, Cline, Antigravity, Roo Code):

### Example MCP Configuration (`mcp_servers.json`):
```json
{
  "mcpServers": {
    "stormdrain": {
      "command": "python3",
      "args": [
        "/path/to/stormdrain-agent.py"
      ],
      "env": {
        "STORMDRAIN_SERVER_URL": "http://localhost:3456",
        "STORMDRAIN_CONTEXT": "my_project"
      }
    }
  }
}
```

### Command Line Options
You can also pass arguments directly:
```bash
python3 /path/to/stormdrain-agent.py --server-url http://localhost:3456 --context my_project --timeout 10
```

---

## 5. Available Tools

The thin agent provides the full StormDrain tool suite:
- **`sd_read`**: Reads files from the local client disk, extracts symbol outlines, slices line ranges (1-indexed), and automatically injects topological invariants from the server.
- **`sd_recall`**: Recalls multi-hop DAG caller constraints and invariants for a target file.
- **`sd_search`**: Full-text search across central memories.
- **`sd_get`**: Detailed node and memory inspection by ID.
- **`sd_add`**: Records architectural decisions, invariants, gotchas, and patterns to central memory.
- **`sd_update`**: Updates memory content, title, tags, or type.
- **`sd_delete`**: Deletes a memory by ID.
- **`sd_relate`**: Links memories and files with graph edges (`affects`, `applies_to`, `depends_on`, `related_to`).
- **`sd_consolidate`**: Synthesizes multiple micro-memories into a consolidated guide.
- **`sd_consolidation_candidates`**: Finds clusters of micro-memories ready for consolidation.
