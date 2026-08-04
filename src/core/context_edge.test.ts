import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ContextManager } from './context';
import { ConfigManager } from './config';

describe('ContextManager Edge Cases & Security', () => {
  let testDir: string;
  let config: ConfigManager;
  let ctx: ContextManager;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `stormdrain_edge_test_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
    process.env.STORMDRAIN_TEST_DIR = testDir;
    
    config = new ConfigManager();
    config.addContext('edge-context');
    ctx = new ContextManager('edge-context');
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

  it('should safely handle FTS5 queries with special characters and symbols', () => {
    ctx.addMemory('fact', 'SQLite FTS5', 'Testing special characters like colons: foo:bar, stars: *, quotes: "test", and operators: NOT AND OR');

    // These queries should not throw SQLite FTS syntax errors
    expect(() => ctx.searchMemories('foo:bar')).not.toThrow();
    expect(() => ctx.searchMemories('*')).not.toThrow();
    expect(() => ctx.searchMemories('"test"')).not.toThrow();
    expect(() => ctx.searchMemories('NOT OR AND')).not.toThrow();
    expect(() => ctx.searchMemories('??? !!! $$$')).not.toThrow();

    const results = ctx.searchMemories('SQLite');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should prevent path traversal attacks on memory lookup and deletion', () => {
    const id = ctx.addMemory('lesson', 'Path Traversal Guard', 'Safe Content');
    
    // Attempt relative traversal
    const memPathTraversal = ctx.getMemory(`../../${id}`);
    expect(memPathTraversal?.metadata.id).toBe(id);

    // Attempt traversal to non-existent location outside directory
    expect(ctx.getMemory('../../../etc/passwd')).toBeNull();
  });

  it('should throw an error when updating a non-existent memory ID', () => {
    expect(() => {
      ctx.updateMemory('mem_nonexistent_123', 'new content');
    }).toThrow('Memory mem_nonexistent_123 not found');
  });

  it('should cap confidence score at 1.0 when marked as accessed multiple times', () => {
    const id = ctx.addMemory('fact', 'Confidence Cap', 'Testing cap');
    
    // Initial confidence is 1.0
    for (let i = 0; i < 5; i++) {
      ctx.markAccessed(id);
    }

    const mem = ctx.getMemory(id);
    expect(mem?.metadata.confidence).toBeLessThanOrEqual(1.0);
    expect(mem?.metadata.access_count).toBe(5);
  });
});
