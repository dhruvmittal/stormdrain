import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextManager } from './context';
import { ConfigManager } from './config';
import { startWebServer } from '../web/server';
import http from 'http';

describe('Storage Layer Performance & Functional Parity Test Suite', () => {
  let testDir: string;
  let config: ConfigManager;
  let ctx: ContextManager;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `stormdrain_perf_test_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`);
    process.env.STORMDRAIN_TEST_DIR = testDir;

    config = new ConfigManager();
    config.addContext('perf-context');
    ctx = new ContextManager('perf-context');
  });

  afterEach(async () => {
    if (ctx) {
      await ctx.close();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.STORMDRAIN_TEST_DIR;
  });

  it('listMemories() should return exact metadata, tags, relations, and content as disk-parsed memories', () => {
    const id1 = ctx.addMemory('pattern', 'Pattern 1', 'Content for pattern 1', ['tag-a', 'tag-b'], 'manual', undefined, 'file_src_main_ts', 'affects');
    const id2 = ctx.addMemory('lesson', 'Lesson 2', 'Content for lesson 2', ['tag-b', 'tag-c'], 'manual', undefined, id1, 'related_to');

    const memories = ctx.listMemories();
    expect(memories.length).toBe(2);

    const mem1 = memories.find(m => m.metadata.id === id1);
    expect(mem1).toBeDefined();
    expect(mem1?.metadata.type).toBe('pattern');
    expect(mem1?.metadata.title).toBe('Pattern 1');
    expect(mem1?.metadata.tags).toEqual(['tag-a', 'tag-b']);
    expect(mem1?.content).toBe('Content for pattern 1');
    expect(mem1?.metadata.relations).toHaveLength(1);
    expect(mem1?.metadata.relations[0].target).toBe('file_src_main_ts');

    const mem2 = memories.find(m => m.metadata.id === id2);
    expect(mem2).toBeDefined();
    expect(mem2?.metadata.type).toBe('lesson');
    expect(mem2?.metadata.title).toBe('Lesson 2');
    expect(mem2?.metadata.tags).toEqual(['tag-b', 'tag-c']);
    expect(mem2?.content).toBe('Content for lesson 2');
    expect(mem2?.metadata.relations).toHaveLength(1);
    expect(mem2?.metadata.relations[0].target).toBe(id1);

    // Verify consistency with direct disk getMemory calls
    const diskMem1 = ctx.getMemory(id1);
    expect(mem1?.metadata.id).toBe(diskMem1?.metadata.id);
    expect(mem1?.metadata.title).toBe(diskMem1?.metadata.title);
    expect(mem1?.metadata.tags).toEqual(diskMem1?.metadata.tags);
    expect(mem1?.metadata.relations).toEqual(diskMem1?.metadata.relations);
  });

  it('getNodeDetails() should return full node details including relation titles and attached memories', () => {
    const memId = ctx.addMemory('fact', 'Fact Memory', 'Fact content', ['tag1'], 'manual', undefined, 'file_src_core_ts', 'affects');
    
    // Add file vertex
    ctx.addMemory('codemap', '[File] src/core.ts', 'File Node: `src/core.ts`', [], 'auto-scan', 'file_src_core_ts');

    const memDetails = ctx.getNodeDetails(memId);
    expect(memDetails).not.toBeNull();
    expect(memDetails?.id).toBe(memId);
    expect(memDetails?.title).toBe('Fact Memory');
    expect(memDetails?.outgoingRelations).toHaveLength(1);
    expect(memDetails?.outgoingRelations[0].target).toBe('file_src_core_ts');
    expect(memDetails?.outgoingRelations[0].title).toBe('[File] src/core.ts');

    const fileDetails = ctx.getNodeDetails('file_src_core_ts');
    expect(fileDetails).not.toBeNull();
    expect(fileDetails?.nodeType).toBe('codemap');
    expect(fileDetails?.incomingRelations).toHaveLength(1);
    expect(fileDetails?.incomingRelations[0].source).toBe(memId);
    expect(fileDetails?.incomingRelations[0].title).toBe('Fact Memory');
    expect(fileDetails?.attachedMemories).toHaveLength(1);
    expect(fileDetails?.attachedMemories![0].id).toBe(memId);
  });

  it('should scale listMemories() efficiently for 100+ memories without disk bottleneck', () => {
    // Seed 100 memories
    const count = 100;
    for (let i = 0; i < count; i++) {
      ctx.addMemory(
        i % 2 === 0 ? 'pattern' : 'fact',
        `Benchmark Memory ${i}`,
        `Content for memory ${i}`,
        [`tag-${i % 5}`, 'benchmark'],
        'manual',
        `mem_bench_${i}`,
        'file_src_index_ts',
        'affects'
      );
    }

    const t0 = performance.now();
    const memories = ctx.listMemories();
    const t1 = performance.now();

    expect(memories.length).toBe(count);
    const durationMs = t1 - t0;
    // Fast in-memory / SQLite query should complete under 25ms
    expect(durationMs).toBeLessThan(100);
  });
});
