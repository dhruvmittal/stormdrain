import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextManager } from './context';
import { ConfigManager } from './config';

describe('ContextManager', () => {
  let testDir: string;
  let config: ConfigManager;
  let ctx: ContextManager;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `stormdrain_test_${Date.now()}`);
    process.env.STORMDRAIN_TEST_DIR = testDir;
    
    config = new ConfigManager();
    config.addContext('test-context');
    ctx = new ContextManager('test-context');
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

  it('should add a memory and sync it to db', () => {
    const id = ctx.addMemory('fact', 'A test fact', 'This is content', ['tag1']);
    expect(id).toBeDefined();

    // Fetch memory
    const mem = ctx.getMemory(id);
    expect(mem).not.toBeNull();
    expect(mem?.metadata.title).toBe('A test fact');
    expect(mem?.metadata.tags).toContain('tag1');
    expect(mem?.metadata.type).toBe('fact');

    // Test search
    const results = ctx.searchMemories('content');
    expect(results.length).toBeGreaterThan(0);
    expect((results[0] as any).id).toBe(id);
  });

  it('should update a memory and search it via FTS', () => {
    const id = ctx.addMemory('lesson', 'Original', 'content 1');
    
    ctx.updateMemory(id, 'content updated', 'Updated Title', ['new-tag']);
    
    const mem = ctx.getMemory(id);
    expect(mem?.metadata.title).toBe('Updated Title');
    expect(mem?.metadata.tags).toContain('new-tag');
    expect(mem?.content).toBe('content updated');

    // Verify FTS update
    const results = ctx.searchMemories('updated');
    expect(results.length).toBe(1);
    expect((results[0] as any).id).toBe(id);
  });

  it('should correctly delete a memory', () => {
    const id = ctx.addMemory('lesson', 'To be deleted', 'content');
    expect(ctx.getMemory(id)).not.toBeNull();
    
    ctx.deleteMemory(id);
    expect(ctx.getMemory(id)).toBeNull();
    
    const results = ctx.searchMemories('deleted');
    expect(results.length).toBe(0);
  });

  it('should correctly recall top memories', () => {
    const id1 = ctx.addMemory('fact', 'Memory 1', 'first');
    const id2 = ctx.addMemory('fact', 'Memory 2', 'second');
    
    // Simulate access to id2
    ctx.markAccessed(id2);
    ctx.markAccessed(id2);
    
    const top = ctx.recallTopMemories(5);
    expect(top.length).toBe(2);
    
    // id2 should be first because of access boost
    expect((top[0] as any).id).toBe(id2);
    expect((top[1] as any).id).toBe(id1);
  });
});
