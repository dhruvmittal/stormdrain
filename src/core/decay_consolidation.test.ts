import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextManager } from './context';
import { ConfigManager } from './config';
import { StormDrainMcpServer } from '../mcp';

describe('Memory Decay & Neighborhood Consolidation Engine', () => {
  let tempDir: string;
  let homeDir: string;
  let ctx: ContextManager;
  let config: ConfigManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stormdrain-decay-test-'));
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stormdrain-home-test-'));
    
    process.env.HOME = homeDir;
    process.env.STORMDRAIN_HOME = path.join(homeDir, '.stormdrain');

    config = new ConfigManager();
    config.addContext('test-context', [tempDir]);
    config.setActiveContext('test-context');

    ctx = new ContextManager('test-context');
  });

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('should detect file content hash changes during syncFileGraph and decay attached memory confidence', async () => {
    const srcFile = path.join(tempDir, 'math_utils.ts');
    fs.writeFileSync(srcFile, '// Version 1\nexport const add = (a: number, b: number) => a + b;\n');

    // 1. Initial graph scan
    const res1 = ctx.syncFileGraph(tempDir);
    expect(res1.createdCount).toBe(1);
    expect(res1.decayedCount).toBe(0);

    // 2. Add domain warning memory glommed onto math_utils.ts
    const memId = ctx.addMemory(
      'warning',
      'Floating point edge case in math_utils',
      'Be careful with precision when adding floats.',
      ['math', 'gotcha'],
      'manual',
      undefined,
      'math_utils.ts'
    );

    const memBefore = ctx.getMemory(memId);
    expect(memBefore?.metadata.confidence).toBe(1.0);
    expect(memBefore?.metadata.tags).not.toContain('stale');

    // 3. Modify source file content to change its SHA-256 hash
    fs.writeFileSync(srcFile, '// Version 2 - Modified!\nexport const add = (a: number, b: number) => a + b;\nexport const multiply = (a: number, b: number) => a * b;\n');

    // 4. Re-scan graph
    const res2 = ctx.syncFileGraph(tempDir);
    expect(res2.createdCount).toBe(1);
    expect(res2.decayedCount).toBe(1);

    // 5. Verify confidence score decayed and 'stale' tag added
    const memAfter = ctx.getMemory(memId);
    expect(memAfter?.metadata.confidence).toBeLessThan(1.0);
    expect(memAfter?.metadata.confidence).toBe(0.75);
    expect(memAfter?.metadata.tags).toContain('stale');
  });

  it('should consolidate multiple micro-memories into a super-memory guide via consolidateNeighborhood', async () => {
    const srcFile = path.join(tempDir, 'data_processor.ts');
    fs.writeFileSync(srcFile, '// Data Processor Module\nexport class Processor {}\n');

    ctx.syncFileGraph(tempDir);

    // Add 2 micro-memories glommed onto data_processor.ts
    const mem1 = ctx.addMemory(
      'warning',
      'Memory Leak Warning in Processor',
      'Ensure buffers are released after stream processing.',
      ['leak'],
      'manual',
      undefined,
      'data_processor.ts'
    );

    const mem2 = ctx.addMemory(
      'lesson',
      'Stream Chunking Optimization',
      'Chunk size of 64KB yields best throughput.',
      ['perf'],
      'manual',
      undefined,
      'data_processor.ts'
    );

    // Execute consolidation
    const result = ctx.consolidateNeighborhood('data_processor.ts');
    expect(result.mergedCount).toBe(2);
    expect(result.consolidatedId).toMatch(/^mem_/);

    // Verify consolidated super-memory content and tags
    const superMem = ctx.getMemory(result.consolidatedId);
    expect(superMem).not.toBeNull();
    expect(superMem?.metadata.type).toBe('guide');
    expect(superMem?.metadata.title).toBe('data_processor.ts');
    expect(superMem?.content).toContain('Memory Leak Warning in Processor');
    expect(superMem?.content).toContain('Stream Chunking Optimization');
    expect(superMem?.metadata.tags).toContain('consolidated-guide');

    // Verify source memories marked as consolidated
    const updatedMem1 = ctx.getMemory(mem1);
    const updatedMem2 = ctx.getMemory(mem2);
    expect(updatedMem1?.metadata.tags).toContain('consolidated');
    expect(updatedMem2?.metadata.tags).toContain('consolidated');

    // Verify source memories are disconnected from the target file vertex both on disk and in DB
    const targetId = ctx.resolveTargetId('data_processor.ts');
    expect(updatedMem1?.metadata.relations.some(r => r.target === targetId)).toBe(false);
    expect(updatedMem2?.metadata.relations.some(r => r.target === targetId)).toBe(false);

    const rels1 = ctx.getRelations(mem1);
    const rels2 = ctx.getRelations(mem2);
    expect(rels1.outgoing.some(r => r.target === targetId)).toBe(false);
    expect(rels2.outgoing.some(r => r.target === targetId)).toBe(false);
  });

  it('should handle sd_consolidate via MCP tool server', async () => {
    const srcFile = path.join(tempDir, 'config_parser.ts');
    fs.writeFileSync(srcFile, '// Config Parser\n');
    ctx.syncFileGraph(tempDir);

    ctx.addMemory('warning', 'Gotcha 1', 'Detail 1', ['tag1'], 'manual', undefined, 'config_parser.ts');
    ctx.addMemory('fact', 'Gotcha 2', 'Detail 2', ['tag2'], 'manual', undefined, 'config_parser.ts');

    const mcpServer = new StormDrainMcpServer();
    const serverInstance = (mcpServer as any).server;

    // Call sd_consolidate via MCP handler
    const response = await serverInstance._requestHandlers.get('tools/call')({
      method: 'tools/call',
      params: {
        name: 'sd_consolidate',
        arguments: {
          target_file: 'config_parser.ts',
          context: 'test-context'
        }
      }
    });

    expect(response.content[0].text).toContain('Successfully consolidated 2 micro-memories');
  });
});
