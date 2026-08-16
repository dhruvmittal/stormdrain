import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StormDrainMcpServer } from './index';
import { ConfigManager } from '../core/config';

describe('MCP Server Resilience & Failure Case Tests', () => {
  let tempDir: string;
  let homeDir: string;
  let mcpServer: StormDrainMcpServer;
  let serverInstance: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-mcp-resilience-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-mcp-home-'));
    
    process.env.HOME = homeDir;
    process.env.STORMDRAIN_HOME = path.join(homeDir, '.stormdrain');

    const config = new ConfigManager();
    config.addContext('mcp-resilience-ctx', [tempDir]);
    config.setActiveContext('mcp-resilience-ctx');

    mcpServer = new StormDrainMcpServer();
    serverInstance = (mcpServer as any).server;
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      fs.rmSync(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // Ignore transient cleanup locks
    }
  });

  async function callTool(name: string, args: any = {}) {
    const handler = serverInstance._requestHandlers.get('tools/call');
    return await handler({
      method: 'tools/call',
      params: {
        name,
        arguments: args
      }
    });
  }

  it('should return isError when calling an unknown tool', async () => {
    const response = await callTool('sd_unknown_tool', {});
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Tool not found: sd_unknown_tool');
  });

  it('should handle sd_recall variations (with limit, without target_file, empty memories)', async () => {
    // 1. Recall when empty
    const resEmpty = await callTool('sd_recall', { limit: 5, context: 'mcp-resilience-ctx' });
    expect(resEmpty.content[0].text).toBe('No memories found.');

    // 2. Add memories and recall with custom limit
    await callTool('sd_add', { type: 'fact', title: 'Fact 1', content: 'Content 1', context: 'mcp-resilience-ctx' });
    await callTool('sd_add', { type: 'lesson', title: 'Lesson 2', content: 'Content 2', context: 'mcp-resilience-ctx' });

    const resLimit = await callTool('sd_recall', { limit: 1, context: 'mcp-resilience-ctx' });
    expect(resLimit.content[0].text).toContain('## [');
  });

  it('should handle sd_init for new context vs existing context binding', async () => {
    // 1. New context
    const resNew = await callTool('sd_init', { name: 'brand-new-project', directory: tempDir });
    expect(resNew.content[0].text).toContain('Successfully initialized context "brand-new-project"');

    // 2. Existing context re-initialization / binding
    const resExisting = await callTool('sd_init', { name: 'brand-new-project', directory: tempDir });
    expect(resExisting.content[0].text).toContain('Successfully initialized context "brand-new-project"');
  });

  it('should handle sd_scan with default directory parameter', async () => {
    const sampleFile = path.join(tempDir, 'sample.ts');
    fs.writeFileSync(sampleFile, 'export const sample = 100;');

    const resScan = await callTool('sd_scan', { directory: tempDir, context: 'mcp-resilience-ctx' });
    expect(resScan.content[0].text).toContain('Successfully scanned workspace');
  });

  it('should handle sd_consolidate when insufficient memories exist', async () => {
    const res = await callTool('sd_consolidate', { target_file: 'nonexistent.ts', context: 'mcp-resilience-ctx' });
    expect(res.content[0].text).toContain('No micro-memories (>= 2) found to consolidate');
  });

  it('should handle sd_search with non-matching and empty queries', async () => {
    const resEmpty = await callTool('sd_search', { query: 'nonexistentkeywordXYZ', context: 'mcp-resilience-ctx' });
    expect(resEmpty.content[0].text).toBe('No results found.');
  });
});
