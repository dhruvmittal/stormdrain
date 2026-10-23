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
        [sys.executable, "scripts/stormdrain-agent.py", "--server-url", server_url],
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

        # Step 0b: Test tools/list has 3 consolidated tools
        print("Testing tools/list...")
        tools_res = send_rpc({"jsonrpc": "2.0", "id": "tools-1", "method": "tools/list", "params": {}})
        tool_names = [t["name"] for t in tools_res.get("result", {}).get("tools", [])]
        print("Tools returned:", tool_names)
        assert len(tool_names) == 3, f"Expected 3 tools, got {len(tool_names)}: {tool_names}"
        for expected in ["sd_read", "sd_recall", "sd_memory"]:
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
            "type": "fact",
            "title": "Matrix Multiplication Block Size",
            "content": "Tile sizes for GEMM kernels must be multiples of 16 for tensor cores.",
            "target_file": "sim/kernel.cu",
            "tags": ["gpu", "cuda", "invariant"],
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

        mem_id = [part for part in text.split() if part.startswith("mem_")][0]

        # Step F: Test sd_memory action=add
        print("Testing sd_memory action=add...")
        res_mem_add = call_tool(6, "sd_memory", {
            "action": "add",
            "type": "warning",
            "title": "Consolidated Memory Action Test",
            "content": "Verify that sd_memory routes correctly in thin agent.",
            "target": "sim/kernel.cu",
            "tags": ["testing", "sd_memory"]
        })
        mem_add_text = res_mem_add.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_memory add result:", mem_add_text)
        assert "Successfully added memory" in mem_add_text
        sd_mem_id = [part for part in mem_add_text.split() if part.startswith("mem_")][0]

        # Step G: Test sd_memory action=search
        print("Testing sd_memory action=search...")
        res_mem_search = call_tool(7, "sd_memory", {
            "action": "search",
            "query": "Consolidated Memory Action Test"
        })
        mem_search_text = res_mem_search.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_memory search result:", mem_search_text)
        assert "Consolidated Memory Action Test" in mem_search_text

        # Step H: Test sd_memory action=get
        print("Testing sd_memory action=get...")
        res_mem_get = call_tool(8, "sd_memory", {
            "action": "get",
            "id": sd_mem_id
        })
        mem_get_text = res_mem_get.get("result", {}).get("content", [{}])[0].get("text", "")
        assert sd_mem_id in mem_get_text

        # Step H2: Test sd_memory action=delete
        print("Testing sd_memory action=delete...")
        res_mem_del = call_tool(81, "sd_memory", {
            "action": "delete",
            "id": sd_mem_id
        })
        mem_del_text = res_mem_del.get("result", {}).get("content", [{}])[0].get("text", "")
        assert "Successfully deleted memory" in mem_del_text

        # Step H3: Test sd_memory action=consolidate
        print("Testing sd_memory action=consolidate...")
        for i in range(3):
            call_tool(82 + i, "sd_memory", {
                "action": "add",
                "type": "fact",
                "title": f"Consolidation Item {i}",
                "content": f"Detail {i} for consolidation verification.",
                "target": "sim/kernel.cu"
            })
        res_mem_cons = call_tool(85, "sd_memory", {
            "action": "consolidate",
            "target": "sim/kernel.cu"
        })
        mem_cons_text = res_mem_cons.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_memory consolidate result:", mem_cons_text)
        assert "Successfully consolidated" in mem_cons_text

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
