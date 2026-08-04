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
});
