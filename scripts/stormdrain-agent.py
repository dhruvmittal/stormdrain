#!/usr/bin/env python3
"""
StormDrain Thin Agent (Python 3.6+ Zero-Dependency MCP Client)

Connects an AI Agent on a remote client machine to a canonical StormDrain
server over an SSH tunnel (default: http://localhost:3456).

Features:
- 100% Python 3.6+ standard library only (no pip, no venv, no npm, no gcc).
- Native MCP JSON-RPC 2.0 stdio server for Cursor, Claude, Antigravity, Cline, etc.
- Hybrid execution:
    * sd_read reads local files from the client disk, extracts symbol outlines,
      and queries the server to inject topological invariants.
    * Memory tools (recall, search, get, add, update, delete, relate, consolidate)
      are proxied to the central StormDrain REST API over the tunnel.
"""

import sys
import os
import time
import subprocess
import json
import re
import ast
import argparse
import hashlib
from typing import Dict, Any, List, Optional, Tuple

import urllib.request as url_request
import urllib.error as url_error
import urllib.parse as url_parse


DEFAULT_SERVER_URL = os.environ.get("STORMDRAIN_SERVER_URL", "http://localhost:3456")
DEFAULT_CONTEXT = os.environ.get("STORMDRAIN_CONTEXT", "")
DEFAULT_TIMEOUT = int(os.environ.get("STORMDRAIN_TIMEOUT", "10"))

_GIT_CACHE: Dict[str, Dict[str, Any]] = {}
_GIT_CACHE_MAX = 50

def get_git_info(cwd: Optional[str] = None) -> Tuple[Optional[str], Optional[str]]:
    """Returns (workspace_root, branch_name) with an in-memory 10-second TTL cache keyed by directory."""
    now = time.time()
    target_dir = os.path.abspath(cwd or os.getcwd())

    cached = _GIT_CACHE.get(target_dir)
    if cached and (now - cached["ts"] < 10.0):
        return cached["root"], cached["branch"]

    root = None
    branch = None

    # Fast check: read .git/HEAD directly
    try:
        curr = os.path.abspath(target_dir)
        while True:
            candidate = os.path.join(curr, ".git")
            if os.path.exists(candidate):
                head_file = None
                if os.path.isdir(candidate):
                    root = curr
                    head_file = os.path.join(candidate, "HEAD")
                elif os.path.isfile(candidate):
                    root = curr
                    try:
                        with open(candidate, "r", encoding="utf-8", errors="replace") as f:
                            line = f.read().strip()
                            if line.startswith("gitdir:"):
                                raw_gitdir = line[7:].strip()
                                gitdir = raw_gitdir if os.path.isabs(raw_gitdir) else os.path.normpath(os.path.join(curr, raw_gitdir))
                                head_file = os.path.join(gitdir, "HEAD")
                    except Exception:
                        pass
                if head_file and os.path.isfile(head_file):
                    with open(head_file, "r", encoding="utf-8", errors="replace") as f:
                        line = f.read().strip()
                        if line.startswith("ref: refs/heads/"):
                            branch = line[16:].strip()
                if root:
                    break
            parent = os.path.dirname(curr)
            if parent == curr:
                break
            curr = parent
    except Exception:
        pass

    # Fallback to git subprocess if root or branch was not found
    if not root or not branch:
        try:
            res = subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                cwd=target_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=2
            )
            if res.returncode == 0:
                root = res.stdout.strip()
        except Exception:
            pass

        if not branch:
            try:
                res = subprocess.run(
                    ["git", "symbolic-ref", "-q", "--short", "HEAD"],
                    cwd=target_dir,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=2
                )
                if res.returncode == 0:
                    b = res.stdout.strip()
                    if b and b != "HEAD":
                        branch = b
            except Exception:
                pass

        if not branch:
            branch = (
                os.getenv("GITHUB_HEAD_REF")
                or os.getenv("GITHUB_REF_NAME")
                or os.getenv("CI_COMMIT_REF_NAME")
                or os.getenv("CI_COMMIT_BRANCH")
                or os.getenv("GIT_BRANCH")
            )

    if len(_GIT_CACHE) >= _GIT_CACHE_MAX:
        _GIT_CACHE.clear()
    _GIT_CACHE[target_dir] = {"root": root, "branch": branch, "ts": now}
    return root, branch

def normalize_client_path(file_path: str, workspace_root: Optional[str] = None) -> str:
    """Normalize file path to POSIX workspace-relative path."""
    p = os.path.normpath(file_path)
    if workspace_root:
        try:
            rel = os.path.relpath(p, workspace_root)
            if not rel.startswith(".."):
                p = rel
        except ValueError:
            pass
    norm = p.replace("\\", "/")
    while norm.startswith("./"):
        norm = norm[2:]
    return norm.lstrip("/")


class StormDrainApiClient:
    def __init__(self, base_url: str = DEFAULT_SERVER_URL, context: str = DEFAULT_CONTEXT, timeout: int = DEFAULT_TIMEOUT):
        self.base_url = base_url.rstrip("/")
        self.context = context
        self.timeout = timeout

    def _build_url(self, endpoint: str, params: Optional[Dict[str, Any]] = None, explicit_context: Optional[str] = None) -> str:
        ctx = explicit_context or self.context
        query_params = {}
        if params:
            for k, v in params.items():
                if v is not None:
                    query_params[k] = str(v)
        if ctx and "context" not in query_params:
            query_params["context"] = ctx

        qs = url_parse.urlencode(query_params)
        url = "{}{}".format(self.base_url, endpoint)
        if qs:
            url = "{}?{}".format(url, qs)
        return url

    def request(self, method: str, endpoint: str, params: Optional[Dict[str, Any]] = None, data: Optional[Dict[str, Any]] = None, context: Optional[str] = None) -> Tuple[int, Any]:
        url = self._build_url(endpoint, params=params, explicit_context=context)
        body_bytes = None
        headers = {"Accept": "application/json"}

        if data is not None:
            body_bytes = json.dumps(data).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = url_request.Request(url, data=body_bytes, headers=headers)
        req.get_method = lambda: method.upper()

        try:
            with url_request.urlopen(req, timeout=self.timeout) as resp:
                status = resp.getcode()
                raw = resp.read().decode("utf-8")
                try:
                    parsed = json.loads(raw)
                except Exception:
                    parsed = raw
                return status, parsed
        except url_error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(err_body)
            except Exception:
                parsed = {"error": err_body or str(e)}
            return e.code, parsed
        except url_error.URLError as e:
            return 503, {
                "error": "Cannot connect to StormDrain server at {} ({}). Ensure your SSH tunnel is active (e.g. ssh -L 3456:localhost:3456 user@server).".format(
                    self.base_url, e.reason
                )
            }
        except Exception as e:
            return 500, {"error": "Request failed: {}".format(str(e))}


def extract_symbols_from_source(file_path: str, content: str) -> List[str]:
    """Extract lightweight symbol outline using Python AST or simple regex."""
    symbols = []
    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".py":
        try:
            tree = ast.parse(content, filename=file_path)
            for node in ast.iter_child_nodes(tree):
                if isinstance(node, ast.ClassDef):
                    symbols.append("class {} (line {})".format(node.name, node.lineno))
                    for item in node.body:
                        if isinstance(item, (ast.FunctionDef, getattr(ast, "AsyncFunctionDef", ast.FunctionDef))):
                            symbols.append("  def {}.{} (line {})".format(node.name, item.name, item.lineno))
                elif isinstance(node, (ast.FunctionDef, getattr(ast, "AsyncFunctionDef", ast.FunctionDef))):
                    symbols.append("def {} (line {})".format(node.name, node.lineno))
        except Exception:
            pass

    if not symbols and ext in (".c", ".cpp", ".cc", ".cxx", ".h", ".hpp", ".cu", ".cuh"):
        class_regex = re.compile(r"^\s*(?:class|struct)\s+([A-Za-z_][A-Za-z0-9_]*)\b", re.MULTILINE)
        func_regex = re.compile(r"^\s*(?:[A-Za-z_][A-Za-z0-9_:*&<>\s]+)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^;{}]*\)\s*[{;]", re.MULTILINE)
        for m in class_regex.finditer(content):
            symbols.append("class/struct {}".format(m.group(1)))
        for m in func_regex.finditer(content):
            name = m.group(1)
            if name not in ("if", "for", "while", "switch", "catch", "return"):
                symbols.append("function {}()".format(name))

    return symbols[:30]


class StormDrainMcpServer:
    def __init__(self, client: StormDrainApiClient):
        self.client = client

    def get_tool_definitions(self) -> List[Dict[str, Any]]:
        context_prop = {
            "type": "string",
            "description": "Optional target context namespace override (e.g. '_global' or specific project context name)."
        }
        return [
            {
                "name": "sd_read",
                "description": "PRIMARY FILE READER: Read source file contents from local cluster disk with automatic topological invariant injection from central StormDrain server, symbol outlines, and line slicing.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Path to file to read. Can be relative to workspace or absolute."
                        },
                        "start_line": {
                            "type": "number",
                            "description": "Optional start line number (1-indexed)"
                        },
                        "end_line": {
                            "type": "number",
                            "description": "Optional end line number (1-indexed)"
                        },
                        "offset": {
                            "type": "number",
                            "description": "Optional start line offset (alias for start_line)"
                        },
                        "limit": {
                            "type": "number",
                            "description": "Optional line count limit"
                        },
                        "include_invariants": {
                            "type": "boolean",
                            "description": "Whether to query central server for architectural invariants (default: true)"
                        },
                        "include_symbols": {
                            "type": "boolean",
                            "description": "Whether to extract and prepend symbol outlines (default: true)"
                        },
                        "context": context_prop
                    },
                    "required": ["path"]
                }
            },
            {
                "name": "sd_recall",
                "description": "ARCHITECTURAL RECALL TOOL: Recall invariants, caller constraints, and high-confidence memories for a target file or project.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "target_file": {
                            "type": "string",
                            "description": "Optional file path to inspect multi-hop topological invariants"
                        },
                        "limit": {
                            "type": "number",
                            "description": "Maximum number of memories to recall (default: 10)"
                        },
                        "max_depth": {
                            "type": "number",
                            "description": "Optional maximum graph hop depth (default: 3)"
                        },
                        "depth": {
                            "type": "number",
                            "description": "Optional maximum graph hop depth (alias for max_depth)"
                        },
                        "include_codemaps": {
                            "type": "boolean",
                            "description": "Whether to include codemap symbol outlines"
                        },
                        "context": context_prop
                    }
                }
            },
            {
                "name": "sd_memory",
                "description": "Manage memories in the knowledge graph: add invariants/decisions, search memories, inspect nodes, delete memories, or consolidate micro-memories.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": ["add", "search", "get", "delete", "consolidate"],
                            "description": "The memory operation to execute: \"add\" to record knowledge, \"search\" to query, \"get\" to inspect full details, \"delete\" to remove, \"consolidate\" to merge micro-memories."
                        },
                        "type": {
                            "type": "string",
                            "enum": ["fact", "decision", "guide", "warning", "concept"],
                            "description": "Memory type for \"add\" action: fact, decision, guide, warning, concept"
                        },
                        "title": {
                            "type": "string",
                            "description": "Title of the memory for \"add\" action"
                        },
                        "content": {
                            "type": "string",
                            "description": "Markdown content for \"add\" action"
                        },
                        "target": {
                            "type": "string",
                            "description": "Target file path or memory ID to link (for \"add\") or consolidate (for \"consolidate\")"
                        },
                        "relation_type": {
                            "type": "string",
                            "description": "Relation type for \"add\" action linking to target (e.g. affects, supports, related_to)"
                        },
                        "tags": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Categorization tags for \"add\" action"
                        },
                        "query": {
                            "type": "string",
                            "description": "Search query for \"search\" action"
                        },
                        "id": {
                            "type": "string",
                            "description": "Memory ID (e.g. mem_123456) or file path for \"get\" or \"delete\" action"
                        },
                        "memory_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Specific memory IDs to merge for \"consolidate\" action (optional)"
                        },
                        "context": context_prop
                    },
                    "required": ["action"]
                }
            }
        ]

    def handle_tool_call(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        context = arguments.get("context")

        git_root, current_branch = get_git_info()

        if name == "sd_memory":
            action = arguments.get("action")
            if not action:
                return {
                    "isError": True,
                    "content": [{"type": "text", "text": 'Validation Error: "action" parameter is required for sd_memory ("add", "search", "get", "delete", "consolidate").'}]
                }

            if action == "add":
                if not arguments.get("title") or not arguments.get("content"):
                    return {
                        "isError": True,
                        "content": [{"type": "text", "text": 'Validation Error: "title" and "content" are required for action "add".'}]
                    }
                name = "sd_add"
                if not arguments.get("type"):
                    arguments["type"] = "decision"
                arguments["target_file"] = arguments.get("target") or arguments.get("target_file")
                arguments["relation_type"] = arguments.get("relation_type") or arguments.get("relationType", "affects")
            elif action == "search":
                if arguments.get("query") is None:
                    return {
                        "isError": True,
                        "content": [{"type": "text", "text": 'Validation Error: "query" is required for action "search".'}]
                    }
                name = "sd_search"
            elif action == "get":
                target_id = arguments.get("id") or arguments.get("target")
                if not target_id:
                    return {
                        "isError": True,
                        "content": [{"type": "text", "text": 'Validation Error: "id" or "target" is required for action "get".'}]
                    }
                name = "sd_get"
                arguments["id"] = target_id
            elif action == "delete":
                if not arguments.get("id"):
                    return {
                        "isError": True,
                        "content": [{"type": "text", "text": 'Validation Error: "id" is required for action "delete".'}]
                    }
                name = "sd_delete"
            elif action == "consolidate":
                target = arguments.get("target") or arguments.get("target_file")
                if not target:
                    return {
                        "isError": True,
                        "content": [{"type": "text", "text": 'Validation Error: "target" is required for action "consolidate".'}]
                    }
                name = "sd_consolidate"
                arguments["target_file"] = target
            else:
                return {
                    "isError": True,
                    "content": [{"type": "text", "text": 'Unknown action "{}" for sd_memory. Supported actions: add, search, get, delete, consolidate.'.format(action)}]
                }

        if name == "sd_read":
            file_path = arguments.get("path") or arguments.get("filePath")
            if not file_path:
                return {"isError": True, "content": [{"type": "text", "text": "Argument 'path' is required for sd_read."}]}

            norm_path = os.path.normpath(file_path)
            if not os.path.exists(norm_path):
                return {"isError": True, "content": [{"type": "text", "text": "File not found: {} (resolved: {})".format(file_path, os.path.abspath(norm_path))}]}

            if os.path.isdir(norm_path):
                return {"isError": True, "content": [{"type": "text", "text": "Path is a directory, not a file: {}".format(file_path)}]}

            try:
                with open(norm_path, "r", encoding="utf-8", errors="replace") as f:
                    file_content = f.read()
            except Exception as e:
                return {"isError": True, "content": [{"type": "text", "text": "Error reading file {}: {}".format(file_path, str(e))}]}

            all_lines = file_content.splitlines()
            total_lines = len(all_lines)

            start_line = arguments.get("start_line") or arguments.get("startLine")
            end_line = arguments.get("end_line") or arguments.get("endLine")
            if start_line is None and "offset" in arguments and arguments["offset"] is not None:
                start_line = max(1, int(arguments["offset"]))
            if end_line is None and "limit" in arguments and arguments["limit"] is not None and start_line is not None:
                end_line = start_line + int(arguments["limit"]) - 1
            start_line = start_line or 1
            end_line = end_line or total_lines
            start_line = max(1, min(start_line, total_lines if total_lines > 0 else 1))
            end_line = max(start_line, min(end_line, total_lines))

            sliced_lines = all_lines[start_line - 1:end_line]
            pad_width = len(str(end_line))
            numbered_content = "\n".join(
                "{:>{width}}: {}".format(start_line + idx, line, width=pad_width)
                for idx, line in enumerate(sliced_lines)
            )

            output_sections = []

            # 1. Topological Invariant Injection from central server
            include_invariants = arguments.get("include_invariants", True)
            if include_invariants:
                norm_inv_target = normalize_client_path(file_path, git_root)
                inv_params = {"target": norm_inv_target, "tokenBudget": 500}
                status, inv_data = self.client.request(
                    "GET",
                    "/api/invariants",
                    params=inv_params,
                    context=context
                )
                if status == 200 and isinstance(inv_data, dict) and inv_data.get("header"):
                    output_sections.append(inv_data["header"].rstrip())
                elif status == 503:
                    output_sections.append("> [StormDrain: Remote server unreachable on {} - run SSH tunnel to enable invariants]\n".format(self.client.base_url))

            # 2. Symbol Outline
            include_symbols = arguments.get("include_symbols", True)
            if include_symbols:
                symbols = extract_symbols_from_source(norm_path, file_content)
                if symbols:
                    sym_section = "### Symbol Outline: {} ###\n{}".format(
                        os.path.basename(file_path),
                        "\n".join("- " + s for s in symbols)
                    )
                    output_sections.append(sym_section)

            # 3. Source file content
            header_line = "=== File: {} (Lines {}-{} of {}) ===".format(file_path, start_line, end_line, total_lines)
            output_sections.append(header_line)
            output_sections.append(numbered_content)

            return {"content": [{"type": "text", "text": "\n\n".join(output_sections)}]}

        elif name == "sd_recall":
            target = arguments.get("target_file") or arguments.get("target")
            limit = arguments.get("limit", 10)
            params = {"limit": limit}
            depth = arguments.get("max_depth") or arguments.get("depth") or arguments.get("maxDepth")
            if depth:
                params["depth"] = depth
            if target:
                params["target"] = normalize_client_path(target, git_root)
            status, data = self.client.request(
                "GET",
                "/api/recall",
                params=params,
                context=context
            )
            if status != 200:
                err_msg = data.get("error", "Failed to recall memories") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}
            return {"content": [{"type": "text", "text": data.get("text", "No memories found.")}]}

        elif name == "sd_search":
            query = arguments.get("query", "")
            type_filter = arguments.get("type")
            params = {"q": query}
            if type_filter:
                params["type"] = type_filter

            status, data = self.client.request(
                "GET",
                "/api/memories",
                params=params,
                context=context
            )
            if status != 200:
                err_msg = data.get("error", "Search failed") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}

            if not data or not isinstance(data, list):
                return {"content": [{"type": "text", "text": "No results found."}]}

            items = []
            for m in data:
                t = m.get("type", "memory").upper()
                title = m.get("title", "Untitled")
                mid = m.get("id", "")
                snippet = m.get("content_snippet") or m.get("content", "")
                if len(snippet) > 200:
                    snippet = snippet[:200] + "..."
                items.append("## [{}] {} (ID: {})\n{}\n---".format(t, title, mid, snippet))

            return {"content": [{"type": "text", "text": "\n\n".join(items)}]}

        elif name == "sd_get":
            mid = arguments.get("id")
            if not mid:
                return {"isError": True, "content": [{"type": "text", "text": "Argument 'id' is required for sd_get."}]}

            # Try memory first, fallback to node
            status, data = self.client.request("GET", "/api/memories/{}".format(mid), context=context)
            if status == 404:
                status, data = self.client.request("GET", "/api/nodes/{}".format(mid), context=context)

            if status != 200:
                err_msg = data.get("error", "Node or memory not found") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}

            return {"content": [{"type": "text", "text": json.dumps(data, indent=2)}]}

        elif name == "sd_add":
            target_file = arguments.get("target_file")
            if target_file and not (target_file.startswith("mem_") or target_file.startswith("file_") or target_file.startswith("node_") or target_file.startswith("mem-") or target_file.startswith("node-")):
                target_file = normalize_client_path(target_file, git_root)
            targets = arguments.get("targets")
            if isinstance(targets, list):
                targets = [normalize_client_path(t, git_root) if isinstance(t, str) and not (t.startswith("mem_") or t.startswith("file_") or t.startswith("node_")) else t for t in targets]
            elif isinstance(targets, str):
                targets = normalize_client_path(targets, git_root) if not (targets.startswith("mem_") or targets.startswith("file_") or targets.startswith("node_")) else targets

            payload = {
                "type": arguments.get("type"),
                "title": arguments.get("title"),
                "content": arguments.get("content"),
                "tags": arguments.get("tags", []),
                "targetFile": target_file,
                "targets": targets,
                "relationType": arguments.get("relation_type", "affects"),
            }

            if "relations" in arguments and isinstance(arguments["relations"], list):
                norm_relations = []
                for r in arguments["relations"]:
                    if isinstance(r, dict) and "target" in r:
                        t = r["target"]
                        if isinstance(t, str) and not (t.startswith("mem_") or t.startswith("file_") or t.startswith("node_")):
                            t = normalize_client_path(t, git_root)
                        norm_relations.append({"target": t, "type": r.get("type", "affects")})
                    else:
                        norm_relations.append(r)
                payload["relations"] = norm_relations

            status, data = self.client.request("POST", "/api/memories", data=payload, context=context)
            if status not in (200, 201):
                err_msg = data.get("error", "Failed to add memory") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}

            mid = data.get("id", "unknown")
            return {"content": [{"type": "text", "text": "Successfully added memory {} to central StormDrain".format(mid)}]}

        elif name == "sd_update":
            mid = arguments.get("id")
            if not mid:
                return {"isError": True, "content": [{"type": "text", "text": "Argument 'id' is required for sd_update."}]}
            payload = {}
            for field in (
                "title", "content", "tags", "type",
                "add_targets", "remove_targets", "relations",
                "add_relations", "remove_relations"
            ):
                if field in arguments and arguments[field] is not None:
                    payload[field] = arguments[field]

            if "add_targets" in payload and isinstance(payload["add_targets"], list):
                payload["add_targets"] = [
                    normalize_client_path(t, git_root) if isinstance(t, str) and not (t.startswith("mem_") or t.startswith("file_") or t.startswith("node_")) else t
                    for t in payload["add_targets"]
                ]
            if "remove_targets" in payload and isinstance(payload["remove_targets"], list):
                payload["remove_targets"] = [
                    normalize_client_path(t, git_root) if isinstance(t, str) and not (t.startswith("mem_") or t.startswith("file_") or t.startswith("node_")) else t
                    for t in payload["remove_targets"]
                ]
            if "relations" in payload and isinstance(payload["relations"], list):
                norm_relations = []
                for r in payload["relations"]:
                    if isinstance(r, dict) and "target" in r:
                        t = r["target"]
                        if isinstance(t, str) and not (t.startswith("mem_") or t.startswith("file_") or t.startswith("node_")):
                            t = normalize_client_path(t, git_root)
                        norm_relations.append({"target": t, "type": r.get("type", "affects")})
                    else:
                        norm_relations.append(r)
                payload["relations"] = norm_relations

            status, data = self.client.request("PUT", "/api/memories/{}".format(mid), data=payload, context=context)
            if status != 200:
                err_msg = data.get("error", "Failed to update memory") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}
            return {"content": [{"type": "text", "text": "Successfully updated memory {}".format(mid)}]}

        elif name == "sd_delete":
            mid = arguments.get("id")
            if not mid:
                return {"isError": True, "content": [{"type": "text", "text": "Argument 'id' is required for sd_delete."}]}
            status, data = self.client.request("DELETE", "/api/memories/{}".format(mid), context=context)
            if status != 200:
                err_msg = data.get("error", "Failed to delete memory") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}
            return {"content": [{"type": "text", "text": "Successfully deleted memory {}".format(mid)}]}

        elif name == "sd_relate":
            target = arguments.get("target")
            if target and not (
                target.startswith("mem_") or target.startswith("file_") or
                target.startswith("node_") or target.startswith("mem-") or
                target.startswith("node-")
            ):
                target = normalize_client_path(target, git_root)
            rel_type = arguments.get("type") or arguments.get("relation_type", "related_to")
            payload = {
                "source": arguments.get("source_id"),
                "target": target,
                "type": rel_type
            }
            status, data = self.client.request("POST", "/api/relations", data=payload, context=context)
            if status != 200:
                err_msg = data.get("error", "Failed to link relation") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}
            return {"content": [{"type": "text", "text": "Successfully linked {} -> {} ({})".format(payload['source'], payload['target'], payload['type'])}]}

        elif name == "sd_consolidate":
            target_file = arguments.get("target_file")
            if target_file:
                target_file = normalize_client_path(target_file, git_root)
            payload = {
                "targetFile": target_file,
                "memoryIds": arguments.get("memory_ids")
            }
            status, data = self.client.request("POST", "/api/consolidate", data=payload, context=context)
            if status != 200:
                err_msg = data.get("error", "Failed to consolidate") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}
            cid = data.get("consolidatedId", "unknown")
            count = data.get("mergedCount", 0)
            return {"content": [{"type": "text", "text": "Successfully consolidated {} micro-memories into super-memory {}".format(count, cid)}]}

        elif name == "sd_consolidation_candidates":
            thresh = arguments.get("threshold") or arguments.get("min_memories", 3)
            status, data = self.client.request("GET", "/api/consolidation-candidates", params={"threshold": thresh}, context=context)
            if status != 200:
                err_msg = data.get("error", "Failed to fetch candidates") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}

            if not data or not isinstance(data, list):
                return {"content": [{"type": "text", "text": "No consolidation candidates found matching threshold."}]}

            sections = ["## 🎯 Consolidation Candidates ({} target node(s) found)".format(len(data))]
            for cand in data:
                title = cand.get("targetTitle") or cand.get("target")
                target_path = cand.get("target", "")
                mems = cand.get("memories", [])
                sections.append("\n### Target: {} (`{}`, {} micro-memories)".format(title, target_path, len(mems)))
                for m in mems:
                    tags = " ".join("#" + t for t in m.get("tags", []))
                    if tags:
                        tags = " [{}]".format(tags)
                    sections.append("- **[{}] {}** (ID: `{}`){}\n  {}...".format(
                        m.get("type", "memory").upper(),
                        m.get("title", ""),
                        m.get("id", ""),
                        tags,
                        m.get("summarySnippet", "")
                    ))

            return {"content": [{"type": "text", "text": "\n".join(sections)}]}

        elif name == "sd_scan":
            dir_arg = arguments.get("directory")
            if dir_arg:
                dir_arg = os.path.abspath(dir_arg)
            policy = arguments.get("submodule_policy", "sum")
            payload = {"directory": dir_arg, "submodule_policy": policy}
            status, data = self.client.request("POST", "/api/scan", data=payload, context=context)
            if status != 200:
                err_msg = data.get("error", "Scan failed") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}
            target_ctx = context or self.client.context or "default"
            created = data.get("createdCount", 0)
            decayed = data.get("decayedCount", 0)
            scanned_dir = data.get("directory", dir_arg or os.getcwd())
            return {"content": [{"type": "text", "text": "Successfully scanned workspace \"{}\" and updated {} file vertices ({} memories decayed) in context \"{}\".".format(scanned_dir, created, decayed, target_ctx)}]}

        elif name == "sd_init":
            ctx_name = arguments.get("name")
            if not ctx_name:
                return {"isError": True, "content": [{"type": "text", "text": "Argument 'name' is required for sd_init."}]}
            dir_arg = arguments.get("directory")
            if dir_arg:
                dir_arg = os.path.abspath(dir_arg)
            else:
                dir_arg = os.getcwd()
            policy = arguments.get("submodule_policy", "sum")
            payload = {"name": ctx_name, "directory": dir_arg, "submodule_policy": policy}
            status, data = self.client.request("POST", "/api/init", data=payload)
            if status != 200:
                err_msg = data.get("error", "Init failed") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}
            created = data.get("createdCount", 0)
            return {"content": [{"type": "text", "text": "Successfully initialized context \"{}\", bound path \"{}\", scaffolded AGENTS.md, and created {} file vertices in DAG skeleton.".format(ctx_name, dir_arg, created)}]}

        elif name == "sd_prune":
            dir_arg = arguments.get("directory")
            if dir_arg:
                dir_arg = os.path.abspath(dir_arg)
            payload = {"directory": dir_arg}
            status, data = self.client.request("POST", "/api/prune", data=payload, context=context)
            if status != 200:
                err_msg = data.get("error", "Prune failed") if isinstance(data, dict) else str(data)
                return {"isError": True, "content": [{"type": "text", "text": "Error: {}".format(err_msg)}]}
            target_ctx = context or self.client.context or "default"
            pruned = data.get("prunedCount", 0)
            return {"content": [{"type": "text", "text": "Successfully pruned {} orphaned codemap vertices from context \"{}\".".format(pruned, target_ctx)}]}

        else:
            return {"isError": True, "content": [{"type": "text", "text": "Tool not found: {}".format(name)}]}

    def get_prompt_definitions(self) -> List[Dict[str, Any]]:
        status, data = self.client.request("GET", "/api/prompts")
        if status == 200 and isinstance(data, dict) and "prompts" in data:
            return data["prompts"]
        return [
            {
                "name": "sd_curate",
                "description": "Holistic memory curation prompt: guided review to consolidate micro-memories, promote generalized rules to _global, and link or prune graph concepts.",
                "arguments": [
                    {
                        "name": "target",
                        "description": "Optional target file path or memory ID to focus curation on. Leave empty for a prioritized graph-wide sweep.",
                        "required": False,
                    },
                    {
                        "name": "threshold",
                        "description": "Optional micro-memory threshold for consolidation candidate detection (default: 3).",
                        "required": False,
                    },
                    {
                        "name": "context",
                        "description": "Optional context namespace override (defaults to active workspace context).",
                        "required": False,
                    },
                ],
            },
            {
                "name": "sd_harvest",
                "description": "Discovery harvest prompt: extracts and persists architectural invariants, gotchas, decisions, and patterns discovered during recent work.",
                "arguments": [
                    {
                        "name": "limit",
                        "description": "Optional maximum number of recent commits and files to inspect (default: 5).",
                        "required": False,
                    },
                    {
                        "name": "context",
                        "description": "Optional context namespace override (defaults to active workspace context).",
                        "required": False,
                    },
                ],
            },
        ]

    def handle_prompt_get(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        raw_ctx = arguments.get("context") if arguments else None
        if name == "sd_curate":
            payload = {
                "target": arguments.get("target") if arguments else None,
                "threshold": arguments.get("threshold") if arguments else None,
                "maxCandidates": (arguments.get("max_candidates") or arguments.get("maxCandidates")) if arguments else None
            }
            status, data = self.client.request("POST", "/api/prompts/curate", data=payload, context=raw_ctx)
            if status != 200:
                err_msg = data.get("error", "Failed to generate curate prompt") if isinstance(data, dict) else str(data)
                raise Exception(err_msg)
            return data
        elif name == "sd_harvest":
            client_diff = ""
            try:
                diff_res = subprocess.run(
                    ["git", "diff", "HEAD"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=3
                )
                if diff_res.returncode == 0:
                    client_diff = diff_res.stdout
            except Exception:
                pass
            payload = {
                "limit": arguments.get("limit") if arguments else None,
                "gitDiff": client_diff
            }
            status, data = self.client.request("POST", "/api/prompts/harvest", data=payload, context=raw_ctx)
            if status != 200:
                err_msg = data.get("error", "Failed to generate harvest prompt") if isinstance(data, dict) else str(data)
                raise Exception(err_msg)
            return data
        else:
            raise Exception("Unknown prompt: {}".format(name))

    def run_stdio(self):
        """Standard JSON-RPC 2.0 stdio server loop."""
        sys.stderr.write("StormDrain Thin Agent running on stdio (server: {})\n".format(self.client.base_url))
        sys.stderr.flush()

        while True:
            line = sys.stdin.readline()
            if not line:
                break

            line = line.strip()
            if not line:
                continue

            # Support Content-Length headers if sent by some client wrappers
            if line.lower().startswith("content-length:"):
                try:
                    length = int(line.split(":", 1)[1].strip())
                    # Consume all subsequent header lines until empty separator line
                    while True:
                        hdr = sys.stdin.readline()
                        if not hdr:
                            break
                        hdr_stripped = hdr.strip()
                        if hdr_stripped == "":
                            break
                        if hdr_stripped.lower().startswith("content-length:"):
                            length = int(hdr_stripped.split(":", 1)[1].strip())
                    body = sys.stdin.read(length)
                    req = json.loads(body)
                except Exception as e:
                    sys.stderr.write("Framing read error: {}\n".format(e))
                    continue
            else:
                try:
                    req = json.loads(line)
                except Exception as e:
                    sys.stderr.write("JSON decode error: {}\n".format(e))
                    continue

            req_id = req.get("id")
            method = req.get("method")
            params = req.get("params", {})

            # Notification (no id)
            if req_id is None:
                if method == "notifications/initialized":
                    pass
                continue

            resp = {"jsonrpc": "2.0", "id": req_id}

            try:
                if method == "initialize":
                    resp["result"] = {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {},
                            "prompts": {}
                        },
                        "serverInfo": {
                            "name": "stormdrain-agent",
                            "version": "1.0.0"
                        }
                    }
                elif method == "ping":
                    resp["result"] = {}
                elif method == "tools/list":
                    resp["result"] = {"tools": self.get_tool_definitions()}
                elif method == "tools/call":
                    tool_name = params.get("name")
                    tool_args = params.get("arguments", {})
                    resp["result"] = self.handle_tool_call(tool_name, tool_args)
                elif method == "prompts/list":
                    resp["result"] = {"prompts": self.get_prompt_definitions()}
                elif method == "prompts/get":
                    prompt_name = params.get("name")
                    prompt_args = params.get("arguments", {})
                    resp["result"] = self.handle_prompt_get(prompt_name, prompt_args)
                else:
                    resp["error"] = {
                        "code": -32601,
                        "message": "Method not found: {}".format(method)
                    }
            except Exception as e:
                resp["error"] = {
                    "code": -32603,
                    "message": "Internal error: {}".format(str(e))
                }

            out_str = json.dumps(resp) + "\n"
            sys.stdout.write(out_str)
            sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser(description="StormDrain Zero-Dependency Python MCP Thin Agent")
    parser.add_argument("--server-url", "-s", default=DEFAULT_SERVER_URL, help="StormDrain server URL (default: http://localhost:3456)")
    parser.add_argument("--context", "-c", default=DEFAULT_CONTEXT, help="Target context namespace override")
    parser.add_argument("--timeout", "-t", type=int, default=DEFAULT_TIMEOUT, help="HTTP timeout in seconds (default: 10)")
    args = parser.parse_args()

    context = args.context
    if not context:
        git_root, _ = get_git_info()
        if git_root:
            context = os.path.basename(os.path.abspath(git_root))

    client = StormDrainApiClient(base_url=args.server_url, context=context, timeout=args.timeout)
    server = StormDrainMcpServer(client)
    server.run_stdio()


if __name__ == "__main__":
    main()
