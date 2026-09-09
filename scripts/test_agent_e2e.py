#!/usr/bin/env python3
"""
End-to-end verification test for StormDrain Thin Agent (scripts/stormdrain-agent.py)
against a live StormDrain Web server.
"""

import sys
import os
import time
import json
import subprocess
import urllib.request

def main():
    # 1. Start stormdrain web server on port 3999 in a temporary test directory
    test_dir = "/tmp/sd_test_e2e_{}".format(int(time.time()))
    os.makedirs(test_dir, exist_ok=True)
    env = dict(os.environ)
    env["STORMDRAIN_TEST_DIR"] = test_dir

    port = 3999
    server_url = "http://localhost:{}".format(port)

    # Start the server via node dist/index.js web -p 3999 (or npx ts-node)
    # First ensure build exists
    print("Starting StormDrain Web API on port {}...".format(port))
    server_proc = subprocess.Popen(
        ["node", "dist/index.js", "web", "-p", str(port)],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    # Wait for server to become ready
    ready = False
    for _ in range(30):
        try:
            with urllib.request.urlopen("{}/api/contexts".format(server_url), timeout=1) as r:
                if r.getcode() == 200:
                    ready = True
                    break
        except Exception:
            time.sleep(0.2)

    if not ready:
        server_proc.terminate()
        print("FAIL: Server failed to start on port {}".format(port))
        sys.exit(1)

    print("Server ready! Starting StormDrain Thin Agent...")

    # 2. Start stormdrain-agent.py pointing to port 3999
    agent_proc = subprocess.Popen(
        ["python3", "scripts/stormdrain-agent.py", "--server-url", server_url],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    def send_rpc(payload):
        agent_proc.stdin.write(json.dumps(payload) + "\n")
        agent_proc.stdin.flush()
        line = agent_proc.stdout.readline()
        return json.loads(line)

    def call_tool(req_id, tool_name, args):
        return send_rpc({
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": args
            }
        })

    try:
        # Step 0: Initialize & check capabilities
        print("Testing MCP initialize...")
        init_res = send_rpc({"jsonrpc": "2.0", "id": "init-1", "method": "initialize", "params": {}})
        assert init_res.get("result", {}).get("capabilities", {}).get("prompts") is not None, "Prompts capability missing"
        assert init_res.get("result", {}).get("capabilities", {}).get("tools") is not None, "Tools capability missing"

        # Step 0b: Test tools/list has all 13 tools
        print("Testing tools/list...")
        tools_res = send_rpc({"jsonrpc": "2.0", "id": "tools-1", "method": "tools/list", "params": {}})
        tool_names = [t["name"] for t in tools_res.get("result", {}).get("tools", [])]
        print("Tools returned:", tool_names)
        assert len(tool_names) == 13, f"Expected 13 tools, got {len(tool_names)}: {tool_names}"
        for expected in ["sd_read", "sd_recall", "sd_search", "sd_get", "sd_delete", "sd_consolidation_candidates", "sd_add", "sd_update", "sd_relate", "sd_scan", "sd_init", "sd_consolidate", "sd_prune"]:
            assert expected in tool_names, f"Missing tool: {expected}"

        # Step 0c: Test prompts/list
        print("Testing prompts/list...")
        prompts_res = send_rpc({"jsonrpc": "2.0", "id": "prompts-1", "method": "prompts/list", "params": {}})
        prompt_names = [p["name"] for p in prompts_res.get("result", {}).get("prompts", [])]
        print("Prompts returned:", prompt_names)
        assert "sd_curate" in prompt_names
        assert "sd_harvest" in prompt_names

        # Step 0d: Test prompts/get
        print("Testing prompts/get for sd_harvest...")
        harvest_prompt = send_rpc({"jsonrpc": "2.0", "id": "prompts-2", "method": "prompts/get", "params": {"name": "sd_harvest", "arguments": {"limit": 2}}})
        assert harvest_prompt.get("result", {}).get("messages") is not None
        assert "StormDrain" in harvest_prompt["result"]["messages"][0]["content"]["text"]

        print("Testing prompts/get for sd_curate...")
        curate_prompt = send_rpc({"jsonrpc": "2.0", "id": "prompts-3", "method": "prompts/get", "params": {"name": "sd_curate", "arguments": {"threshold": 2}}})
        assert curate_prompt.get("result", {}).get("messages") is not None
        assert "StormDrain" in curate_prompt["result"]["messages"][0]["content"]["text"]

        # Step A: Add a memory (non-canonical on feature/cuda branch)
        print("Testing sd_add...")
        res = call_tool(1, "sd_add", {
            "type": "invariant",
            "title": "Matrix Multiplication Block Size",
            "content": "Tile sizes for GEMM kernels must be multiples of 16 for tensor cores.",
            "target_file": "sim/kernel.cu",
            "tags": ["gpu", "cuda"],
            "is_canonical": False
        })
        text = res.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_add result:", text)
        assert "Successfully added memory" in text

        # Step B: Recall the memory
        print("Testing sd_recall with target_file...")
        res = call_tool(2, "sd_recall", {
            "target_file": "sim/kernel.cu"
        })
        recall_text = res.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_recall result:\n", recall_text)
        assert "Matrix Multiplication Block Size" in recall_text

        # Step C: Search memories
        print("Testing sd_search...")
        res = call_tool(3, "sd_search", {
            "query": "tensor cores"
        })
        search_text = res.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_search result:\n", search_text)
        assert "Matrix Multiplication Block Size" in search_text

        # Step D: Read a local file with topological invariant injection
        # Create dummy file sim/kernel.cu
        os.makedirs("sim", exist_ok=True)
        with open("sim/kernel.cu", "w") as f:
            f.write("// GPU GEMM Kernel\n__global__ void gemm() {\n    // compute\n}\n")

        print("Testing sd_read with topological invariants...")
        res = call_tool(4, "sd_read", {
            "path": "sim/kernel.cu",
            "include_invariants": True
        })
        read_text = res.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_read result:\n", read_text)
        assert "StormDrain Architectural Invariants" in read_text
        assert "Matrix Multiplication Block Size" in read_text

        # Step E: Read with leading dot path normalization
        print("Testing sd_read with leading ./ path normalization...")
        res = call_tool(5, "sd_read", {
            "path": "./sim/kernel.cu",
            "include_invariants": True
        })
        read_text_norm = res.get("result", {}).get("content", [{}])[0].get("text", "")
        assert "StormDrain Architectural Invariants" in read_text_norm
        assert "Matrix Multiplication Block Size" in read_text_norm

        # Step F: Pre-promotion verification - assert unpromoted memory IS found
        print("Testing sd_search with unpromoted_only filter (pre-promotion)...")
        res_pre = call_tool(6, "sd_search", {
            "query": "",
            "unpromoted_only": True
        })
        search_unpromoted_pre = res_pre.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_search pre-promotion result:\n", search_unpromoted_pre)
        assert "Matrix Multiplication Block Size" in search_unpromoted_pre

        # Step G: Update memory canonical status via sd_update
        print("Testing sd_update with is_canonical...")
        mem_id = [part for part in text.split() if part.startswith("mem_")][0]
        res = call_tool(7, "sd_update", {
            "id": mem_id,
            "is_canonical": True
        })
        update_text = res.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_update result:", update_text)
        assert "Successfully updated memory" in update_text

        # Step H: Post-promotion verification - assert memory is NO LONGER unpromoted
        print("Testing sd_search with unpromoted_only filter (post-promotion)...")
        res_post = call_tool(8, "sd_search", {
            "query": "",
            "unpromoted_only": True
        })
        search_unpromoted_post = res_post.get("result", {}).get("content", [{}])[0].get("text", "")
        assert "No results found." in search_unpromoted_post

        # Step I: Slashed branch promotion test via HTTP REST API body
        print("Testing slashed branch promote route (POST /api/branches/promote)...")
        promote_req = urllib.request.Request(
            f"{server_url}/api/branches/promote",
            data=json.dumps({"branch": "feature/slashed-test"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(promote_req, timeout=2) as r:
            assert r.getcode() == 200
            promote_data = json.loads(r.read().decode("utf-8"))
            assert promote_data.get("success") is True
            assert promote_data.get("branch") == "feature/slashed-test"

        print("Testing branch query param route (POST /api/branches/promote?branch=standard-branch)...")
        param_req = urllib.request.Request(
            f"{server_url}/api/branches/promote?branch=standard-branch",
            data=b"",
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(param_req, timeout=2) as r:
            assert r.getcode() == 200
            param_data = json.loads(r.read().decode("utf-8"))
            assert param_data.get("success") is True
            assert param_data.get("branch") == "standard-branch"

        # Step J: Test GET /api/branches
        print("Testing GET /api/branches...")
        branches_req = urllib.request.Request(f"{server_url}/api/branches")
        with urllib.request.urlopen(branches_req, timeout=2) as r:
            assert r.getcode() == 200
            b_data = json.loads(r.read().decode("utf-8"))
            assert "branches" in b_data
            assert isinstance(b_data["branches"], list)

        # Step K: Test sd_update with add_targets forwarding
        print("Testing sd_update with add_targets...")
        res_up = call_tool(9, "sd_update", {
            "id": mem_id,
            "add_targets": ["sim/kernel2.cu"]
        })
        up_content = res_up.get("result", {}).get("content", [{}])[0].get("text", "")
        assert "Successfully updated memory" in up_content

        # Step L: Test sd_relate with mem_ ID without path mangling
        print("Testing sd_relate with memory ID target...")
        res_rel = call_tool(10, "sd_relate", {
            "source_id": mem_id,
            "target": "mem_dummy123456",
            "relation_type": "related_to"
        })
        rel_content = res_rel.get("result", {}).get("content", [{}])[0].get("text", "")
        assert "Successfully linked" in rel_content
        assert "mem_dummy123456" in rel_content

        # Step M: Test sd_read with offset and limit
        print("Testing sd_read with offset and limit...")
        res_read_slice = call_tool(11, "sd_read", {
            "path": "sim/kernel.cu",
            "offset": 2,
            "limit": 2
        })
        read_slice_text = res_read_slice.get("result", {}).get("content", [{}])[0].get("text", "")
        assert "Lines 2-3 of" in read_slice_text

        # Step N: Test sd_recall with max_depth
        print("Testing sd_recall with max_depth...")
        res_recall_depth = call_tool(12, "sd_recall", {
            "target_file": "sim/kernel.cu",
            "max_depth": 2
        })
        recall_depth_text = res_recall_depth.get("result", {}).get("content", [{}])[0].get("text", "")
        assert "Matrix Multiplication Block Size" in recall_depth_text

        # Step O: Test sd_relate with 'type' parameter alias
        print("Testing sd_relate with 'type' parameter...")
        res_rel2 = call_tool(13, "sd_relate", {
            "source_id": mem_id,
            "target": "sim/kernel2.cu",
            "type": "affects"
        })
        rel2_content = res_rel2.get("result", {}).get("content", [{}])[0].get("text", "")
        assert "Successfully linked" in rel2_content or "already exists" in rel2_content

        # Step P: Test sd_consolidation_candidates with 'min_memories' alias
        print("Testing sd_consolidation_candidates with min_memories...")
        res_cand = call_tool(14, "sd_consolidation_candidates", {
            "min_memories": 1
        })
        cand_text = res_cand.get("result", {}).get("content", [{}])[0].get("text", "")
        assert "Consolidation Candidates" in cand_text or "No consolidation candidates" in cand_text

        # Step Q: Test sd_init
        print("Testing sd_init...")
        init_proj_dir = os.path.join(test_dir, "e2e_init_proj")
        os.makedirs(init_proj_dir, exist_ok=True)
        with open(os.path.join(init_proj_dir, "app.py"), "w") as f:
            f.write("def main(): pass\n")
        res_init = call_tool(15, "sd_init", {
            "name": "e2e-init-context",
            "directory": init_proj_dir
        })
        init_text = res_init.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_init result:", init_text)
        assert "Successfully initialized context" in init_text
        assert os.path.exists(os.path.join(init_proj_dir, "AGENTS.md"))

        # Step R: Test sd_scan
        print("Testing sd_scan...")
        res_scan = call_tool(16, "sd_scan", {
            "directory": init_proj_dir,
            "context": "e2e-init-context"
        })
        scan_text = res_scan.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_scan result:", scan_text)
        assert "Successfully scanned workspace" in scan_text

        # Step S: Test sd_prune
        print("Testing sd_prune...")
        res_prune = call_tool(17, "sd_prune", {
            "directory": init_proj_dir,
            "context": "e2e-init-context"
        })
        prune_text = res_prune.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_prune result:", prune_text)
        assert "Successfully pruned" in prune_text

        print("\nALL CLIENT-SERVER INTEGRATION TESTS PASSED SUCCESSFULLY!")

    finally:
        agent_proc.terminate()
        server_proc.terminate()
        if os.path.exists("sim/kernel.cu"):
            os.remove("sim/kernel.cu")
        if os.path.exists("sim"):
            os.rmdir("sim")
        subprocess.run(["rm", "-rf", test_dir], check=False)

if __name__ == "__main__":
    main()
