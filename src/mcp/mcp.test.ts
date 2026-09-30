import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StormDrainMcpServer } from './index';

describe('StormDrainMcpServer Protocol', () => {
  let testDir: string;
  let client: Client;
  let mcpServer: StormDrainMcpServer;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `stormdrain_mcp_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
    process.env.STORMDRAIN_TEST_DIR = testDir;

    mcpServer = new StormDrainMcpServer();
    client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.getServer().connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    if (client) {
      await client.close();
    }
    await new Promise(r => setTimeout(r, 50));
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.STORMDRAIN_TEST_DIR;
  });

  it('should list lean consolidated StormDrain MCP tools', async () => {
    const response = await client.listTools();
    const toolNames = response.tools.map(t => t.name);

    expect(toolNames).toEqual(['sd_read', 'sd_recall', 'sd_memory']);
    expect(toolNames.length).toBe(3);
  });

  it('should execute sd_memory tool with action: add, search, get, delete', async () => {
    // 1. Add memory via sd_memory
    const addRes = await client.callTool({
      name: 'sd_memory',
      arguments: {
        action: 'add',
        type: 'fact',
        title: 'Consolidated Fact',
        content: 'Content created via sd_memory add action',
        tags: ['consolidated', 'mcp']
      }
    });
    const addText = (addRes as any).content[0].text;
    expect(addText).toContain('Successfully added memory mem_');
    const memId = addText.match(/mem_[a-f0-9]+/)?.[0];
    expect(memId).toBeDefined();

    // 2. Search via sd_memory
    const searchRes = await client.callTool({
      name: 'sd_memory',
      arguments: {
        action: 'search',
        query: 'Consolidated Fact'
      }
    });
    expect((searchRes as any).content[0].text).toContain('Consolidated Fact');

    // 3. Get via sd_memory
    const getRes = await client.callTool({
      name: 'sd_memory',
      arguments: {
        action: 'get',
        id: memId
      }
    });
    expect((getRes as any).content[0].text).toContain('Consolidated Fact');

    // 4. Delete via sd_memory
    const delRes = await client.callTool({
      name: 'sd_memory',
      arguments: {
        action: 'delete',
        id: memId
      }
    });
    expect((delRes as any).content[0].text).toContain('Successfully deleted memory');

    // 5. Validation error handling
    const invalidRes = await client.callTool({
      name: 'sd_memory',
      arguments: {
        action: 'add',
        title: 'Missing Content'
      }
    });
    expect((invalidRes as any).isError).toBe(true);
    expect((invalidRes as any).content[0].text).toContain('Validation Error');
  });


  it('should execute sd_add tool to create a memory', async () => {
    const res = await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'fact',
        title: 'MCP Fact',
        content: 'Content created via MCP tool call',
        tags: ['mcp', 'test']
      }
    });

    const contentObj = (res as any).content[0] as { type: string; text: string };
    expect(contentObj.type).toBe('text');
    expect(contentObj.text).toContain('Successfully added memory mem_');
  });

  it('should execute sd_search tool to find memories', async () => {
    // Add memory first
    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'guide',
        title: 'MCP Search Target',
        content: 'Unique search term zebra'
      }
    });

    const searchRes = await client.callTool({
      name: 'sd_search',
      arguments: {
        query: 'zebra'
      }
    });

    const contentObj = (searchRes as any).content[0] as { type: string; text: string };
    expect(contentObj.text).toContain('MCP Search Target');
  });

  it('should execute sd_recall tool to fetch top memories', async () => {
    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'warning',
        title: 'Recall Item',
        content: 'Recall content'
      }
    });

    const recallRes = await client.callTool({
      name: 'sd_recall',
      arguments: {
        limit: 5
      }
    });

    const contentObj = (recallRes as any).content[0] as { type: string; text: string };
    expect(contentObj.text).toContain('Recall Item');
  });

  it('should execute sd_update tool to modify memory', async () => {
    const addRes = await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'concept',
        title: 'Original Title',
        content: 'Original Content'
      }
    });

    const addText = ((addRes as any).content[0] as { type: string; text: string }).text;
    const memId = addText.split('Successfully added memory ')[1].split(' ')[0].trim();

    const updateRes = await client.callTool({
      name: 'sd_update',
      arguments: {
        id: memId,
        title: 'Updated Title via MCP'
      }
    });

    const updateText = ((updateRes as any).content[0] as { type: string; text: string }).text;
    expect(updateText).toContain(`Successfully updated memory ${memId}`);
  });

  it('should return error response when invoking non-existent tool', async () => {
    const res = await client.callTool({
      name: 'sd_invalid_tool',
      arguments: {}
    });

    expect(res.isError).toBe(true);
    const contentObj = (res as any).content[0] as { type: string; text: string };
    expect(contentObj.text).toContain('Error: Tool not found');
  });

  it('should support explicit context override parameter in tool calls', async () => {
    // Add memory to custom explicit context 'custom-ctx'
    const configManager = (mcpServer as any).config;
    configManager.addContext('custom-ctx', []);

    const addRes = await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'fact',
        title: 'Custom Context Fact',
        content: 'This memory belongs to custom-ctx',
        context: 'custom-ctx'
      }
    });

    const addText = ((addRes as any).content[0] as { type: string; text: string }).text;
    expect(addText).toContain('to context "custom-ctx"');

    // Recall from custom-ctx
    const recallRes = await client.callTool({
      name: 'sd_recall',
      arguments: {
        context: 'custom-ctx'
      }
    });

    const recallText = ((recallRes as any).content[0] as { type: string; text: string }).text;
    expect(recallText).toContain('Custom Context Fact');
  });

  it('should execute sd_init and sd_scan tools successfully via MCP', async () => {
    const initRes = await client.callTool({
      name: 'sd_init',
      arguments: {
        name: 'test-mcp-init',
        directory: testDir
      }
    });

    const initText = ((initRes as any).content[0] as { type: string; text: string }).text;
    expect(initText).toContain('Successfully initialized context "test-mcp-init"');

    const scanRes = await client.callTool({
      name: 'sd_scan',
      arguments: {
        directory: testDir,
        context: 'test-mcp-init'
      }
    });

    const scanText = ((scanRes as any).content[0] as { type: string; text: string }).text;
    expect(scanText).toContain('Successfully scanned workspace');
  });

  it('should execute sd_recall with target_file to return structured multi-hop sections', async () => {
    // Add memories linked to files
    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'warning',
        title: 'Core DB Invariant',
        content: 'WAL journal mode required',
        target_file: 'src/core/context.ts'
      }
    });

    const recallRes = await client.callTool({
      name: 'sd_recall',
      arguments: {
        target_file: 'src/core/context.ts'
      }
    });

    const text = ((recallRes as any).content[0] as { type: string; text: string }).text;
    expect(text).toContain('Direct File Invariants');
    expect(text).toContain('Core DB Invariant');
  });

  it('should return helpful message when sd_recall target_file has no memories', async () => {
    const recallRes = await client.callTool({
      name: 'sd_recall',
      arguments: {
        target_file: 'src/unknown/nonexistent.ts'
      }
    });

    const text = ((recallRes as any).content[0] as { type: string; text: string }).text;
    expect(text).toContain('No memories found for target file');
  });

  it('should format upstream and downstream multi-hop recall sections in sd_recall', async () => {
    const fileTarget = 'src/core/context.ts';
    const fileConsumer = 'src/mcp/index.ts';
    const fileDep = 'src/core/git.ts';

    // Add memories targeting each file
    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'warning',
        title: 'Context Direct',
        content: 'Direct rule',
        target_file: fileTarget
      }
    });

    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'concept',
        title: 'MCP Caller Protocol',
        content: 'Caller rule',
        target_file: fileConsumer
      }
    });

    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'warning',
        title: 'Git Subsystem Lesson',
        content: 'Git rule',
        target_file: fileDep
      }
    });

    // Manually register relations in database for topology
    const ctx = (mcpServer as any).config;
    const resolvedContext = ctx.resolveContext();
    const { ContextManager } = await import('../core/context');
    const dbCtx = new ContextManager(resolvedContext);
    const db = dbCtx.getDb();

    const { makeFileVertexId } = await import('../utils/fileGraphScanner');
    const idConsumer = makeFileVertexId(fileConsumer);
    const idTarget = makeFileVertexId(fileTarget);
    const idDep = makeFileVertexId(fileDep);

    dbCtx.addMemory('codemap', fileConsumer, 'consumer', ['file-vertex'], 'indexer', idConsumer);
    dbCtx.addMemory('codemap', fileTarget, 'target', ['file-vertex'], 'indexer', idTarget);
    dbCtx.addMemory('codemap', fileDep, 'dep', ['file-vertex'], 'indexer', idDep);

    db.prepare(`INSERT OR IGNORE INTO relations (source_id, target_id, type) VALUES (?, ?, 'imports')`).run(idConsumer, idTarget);
    db.prepare(`INSERT OR IGNORE INTO relations (source_id, target_id, type) VALUES (?, ?, 'imports')`).run(idTarget, idDep);
    await dbCtx.close();

    const recallRes = await client.callTool({
      name: 'sd_recall',
      arguments: {
        target_file: fileTarget
      }
    });

    const text = ((recallRes as any).content[0] as { type: string; text: string }).text;
    expect(text).toContain('Direct File Invariants');
    expect(text).toContain('Upstream Consumer Constraints');
    expect(text).toContain('Downstream Dependency Invariants');
    expect(text).toContain('Context Direct');
    expect(text).toContain('MCP Caller Protocol');
    expect(text).toContain('Git Subsystem Lesson');
  });

  it('should execute sd_consolidate tool via MCP', async () => {
    const file = 'src/core/cache.ts';
    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'fact',
        title: 'Cache Micro 1',
        content: 'Cache line 1',
        target_file: file
      }
    });
    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'fact',
        title: 'Cache Micro 2',
        content: 'Cache line 2',
        target_file: file
      }
    });

    const consolidateRes = await client.callTool({
      name: 'sd_consolidate',
      arguments: {
        target_file: file
      }
    });

    const text = ((consolidateRes as any).content[0] as { type: string; text: string }).text;
    expect(text).toContain('Successfully consolidated 2 micro-memories');
  });

  it('should execute sd_read tool to read file and inject invariants', async () => {
    const samplePath = path.join(testDir, 'sample_read.ts');
    fs.writeFileSync(samplePath, 'export function calculateMetrics() {\n  return 42;\n}\n', 'utf8');

    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'warning',
        title: 'Metrics Calculation Invariant',
        content: 'Must normalize inputs before calculating',
        target_file: 'sample_read.ts'
      }
    });

    const readRes = await client.callTool({
      name: 'sd_read',
      arguments: {
        path: samplePath,
        start_line: 1,
        end_line: 3
      }
    });

    const text = ((readRes as any).content[0] as { type: string; text: string }).text;
    expect(text).toContain('1: export function calculateMetrics() {');
    expect(text).toContain('2:   return 42;');
    expect(text).toContain('StormDrain Architectural Invariants & Caller Constraints');
    expect(text).toContain('Metrics Calculation Invariant');
  });

  it('should execute sd_prune tool to prune orphan codemaps', async () => {
    const wsDir = path.join(testDir, 'safe_workspace');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'app.ts'), 'export const app = 1;', 'utf8');

    // Add an orphan codemap memory via storage engine
    const mcpConfig = (mcpServer as any).config;
    const resolvedContext = mcpConfig.resolveContext();
    const { ContextManager } = await import('../core/context');
    const dbCtx = new ContextManager(resolvedContext);
    try {
      dbCtx.addMemory('codemap', '[File] foreign/path.ts', 'File Node: `foreign/path.ts`');
    } finally {
      await dbCtx.close();
    }

    const pruneRes = await client.callTool({
      name: 'sd_prune',
      arguments: {
        directory: wsDir
      }
    });

    const text = ((pruneRes as any).content[0] as { type: string; text: string }).text;
    expect(text).toContain('Successfully pruned 1 orphaned codemap vertices');
  });

  it('should list available StormDrain MCP prompts including sd_curate', async () => {
    const response = await client.listPrompts();
    const promptNames = response.prompts.map(p => p.name);

    expect(promptNames).toContain('sd_curate');
    const curatePrompt = response.prompts.find(p => p.name === 'sd_curate');
    expect(curatePrompt?.description).toContain('curation');
    expect(curatePrompt?.arguments?.some(a => a.name === 'target')).toBe(true);
    expect(curatePrompt?.arguments?.some(a => a.name === 'threshold')).toBe(true);
  });

  it('should execute getPrompt for sd_curate in graph sweep mode', async () => {
    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'fact',
        title: 'Environment Clang Fact',
        content: 'Clang requires -stdlib=libc++ on macOS.',
        tags: ['#environment', '#compiler']
      }
    });

    const promptRes = await client.getPrompt({
      name: 'sd_curate',
      arguments: {}
    });

    expect(promptRes.messages.length).toBeGreaterThan(0);
    const text = (promptRes.messages[0].content as any).text;
    expect(text).toContain('StormDrain Graph-Wide Curation Sweep');
    expect(text).toContain('Environment Clang Fact');
    expect(text).toContain('Step-by-Step Curation Workflow');
  });

  it('should execute getPrompt for sd_curate on focused target', async () => {
    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'warning',
        title: 'Target Guardrail',
        content: 'Must guard against concurrent writes.',
        target_file: 'src/core/store.ts'
      }
    });

    const promptRes = await client.getPrompt({
      name: 'sd_curate',
      arguments: {
        target: 'src/core/store.ts'
      }
    });

    expect(promptRes.messages.length).toBeGreaterThan(0);
    const text = (promptRes.messages[0].content as any).text;
    expect(text).toContain('StormDrain Knowledge Curation: Target "src/core/store.ts"');
    expect(text).toContain('Target Guardrail');
  });

  it('should strictly isolate mutating writes across multiple registered contexts by target path', async () => {
    const configManager = (mcpServer as any).config;
    const projADir = path.join(testDir, 'proj-a');
    const projBDir = path.join(testDir, 'proj-b');
    fs.mkdirSync(projADir, { recursive: true });
    fs.mkdirSync(projBDir, { recursive: true });

    configManager.addContext('tenant-a', [projADir]);
    configManager.addContext('tenant-b', [projBDir]);

    // Write targeting Project A
    const resA = await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'fact',
        title: 'Project A Architectural Axiom',
        content: 'Exclusive to Project A',
        target_file: path.join(projADir, 'index.ts')
      }
    });
    expect((resA as any).isError).toBeFalsy();
    const textA = ((resA as any).content[0] as any).text;
    expect(textA).toContain('to context "tenant-a"');

    // Write targeting Project B
    const resB = await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'decision',
        title: 'Project B Decision Record',
        content: 'Exclusive to Project B',
        target_file: path.join(projBDir, 'index.ts')
      }
    });
    expect((resB as any).isError).toBeFalsy();
    const textB = ((resB as any).content[0] as any).text;
    expect(textB).toContain('to context "tenant-b"');

    // Search Project A: should not see Project B
    const searchA = await client.callTool({
      name: 'sd_search',
      arguments: {
        query: 'Exclusive',
        context: 'tenant-a'
      }
    });
    const searchTextA = ((searchA as any).content[0] as any).text;
    expect(searchTextA).toContain('Project A Architectural Axiom');
    expect(searchTextA).not.toContain('Project B Decision Record');

    // Search Project B: should not see Project A
    const searchB = await client.callTool({
      name: 'sd_search',
      arguments: {
        query: 'Exclusive',
        context: 'tenant-b'
      }
    });
    const searchTextB = ((searchB as any).content[0] as any).text;
    expect(searchTextB).toContain('Project B Decision Record');
    expect(searchTextB).not.toContain('Project A Architectural Axiom');
  });

  it('should fail closed when performing mutating operations on unmapped workspaces in a multi-tenant environment', async () => {
    const configManager = (mcpServer as any).config;
    configManager.addContext('some-active-tenant', [path.join(testDir, 'active-tenant')]);

    const unmappedDir = path.join(testDir, 'completely-unmapped');
    fs.mkdirSync(unmappedDir, { recursive: true });

    const res = await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'fact',
        title: 'Unmapped Write Attempt',
        content: 'Should fail closed',
        target_file: path.join(unmappedDir, 'file.ts')
      }
    });

    expect((res as any).isError).toBe(true);
    const text = ((res as any).content[0] as any).text;
    expect(text).toContain('Cannot perform mutating operation "sd_add"');
    expect(text).toContain('workspace path does not belong to any registered StormDrain context');
  });

  it('should resolve context by probing memory ID in multi-tenant environments', async () => {
    const configManager = (mcpServer as any).config;
    const projCDir = path.join(testDir, 'proj-c');
    fs.mkdirSync(projCDir, { recursive: true });
    configManager.addContext('tenant-c', [projCDir]);

    // Add memory to tenant-c
    const addRes = await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'fact',
        title: 'Probed Memory',
        content: 'Memory to probe by ID',
        target_file: path.join(projCDir, 'module.ts')
      }
    });
    const addText = ((addRes as any).content[0] as any).text;
    const memId = addText.split('Successfully added memory ')[1].split(' ')[0].trim();

    // Call sd_get with only memory ID and no context or path clues
    const getRes = await client.callTool({
      name: 'sd_get',
      arguments: {
        id: memId
      }
    });

    expect((getRes as any).isError).toBeFalsy();
    const getText = ((getRes as any).content[0] as any).text;
    expect(getText).toContain('Probed Memory');
    expect(getText).toContain('tenant-c');
  });
});


