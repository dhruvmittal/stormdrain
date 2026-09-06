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

    def call_tool(req_id, tool_name, args):
        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": args
            }
        }
        agent_proc.stdin.write(json.dumps(payload) + "\n")
        agent_proc.stdin.flush()
        line = agent_proc.stdout.readline()
        return json.loads(line)

    try:
        # Step A: Add a memory
        print("Testing sd_add...")
        res = call_tool(1, "sd_add", {
            "type": "invariant",
            "title": "Matrix Multiplication Block Size",
            "content": "Tile sizes for GEMM kernels must be multiples of 16 for tensor cores.",
            "target_file": "sim/kernel.cu",
            "tags": ["gpu", "cuda"]
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

        # Step F: Update memory canonical status via sd_update
        print("Testing sd_update with is_canonical...")
        # Extract memory ID from Step A result
        mem_id = [part for part in text.split() if part.startswith("mem_")][0]
        res = call_tool(6, "sd_update", {
            "id": mem_id,
            "is_canonical": True
        })
        update_text = res.get("result", {}).get("content", [{}])[0].get("text", "")
        print("sd_update result:", update_text)
        assert "Successfully updated memory" in update_text

        # Step G: Search with unpromoted_only filter
        print("Testing sd_search with unpromoted_only filter...")
        res = call_tool(7, "sd_search", {
            "query": "",
            "unpromoted_only": True
        })
        search_unpromoted = res.get("result", {}).get("content", [{}])[0].get("text", "")
        # Since the memory was promoted to canonical, unpromoted search should return no results
        assert "No results found." in search_unpromoted

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
