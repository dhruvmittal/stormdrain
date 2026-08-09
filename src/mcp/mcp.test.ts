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

  it('should list available StormDrain MCP tools', async () => {
    const response = await client.listTools();
    const toolNames = response.tools.map(t => t.name);

    expect(toolNames).toContain('sd_recall');
    expect(toolNames).toContain('sd_search');
    expect(toolNames).toContain('sd_add');
    expect(toolNames).toContain('sd_update');
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
        type: 'pattern',
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
        type: 'pattern',
        title: 'MCP Caller Protocol',
        content: 'Caller rule',
        target_file: fileConsumer
      }
    });

    await client.callTool({
      name: 'sd_add',
      arguments: {
        type: 'lesson',
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
});
